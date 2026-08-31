/* ZS.BattleDuels — deterministic, non-pausing general duels.
 *
 * Scenario integration is intentionally narrow. A scenario that enables
 * duels must provide both callbacks below; each callback owns all agent,
 * unit, and side-ledger mutations for its outcome:
 *
 *   scenario.duelKill(loser, winner, summary)
 *   scenario.duelRout(loser, winner, summary)
 *
 * Optional seams are `duelLOS(a,b)`, for map-specific visibility, and
 * `duelRound(a,b,roundWinner,scoreA,scoreB,round)`, for cold event FX/audio.
 * `cameraInterest()` returns one reused `{x,y,zoom,ease}` record while the
 * exchange (and its short aftermath) is interesting. The resolver never
 * pauses or otherwise owns the surrounding simulation clock.
 *
 * General records may supply a pre-derived `duelAttack` (the preferred
 * campaign handoff). Without one, `wu * 2`, equipment/skill definitions, and
 * explicit `duelItemMod` / `duelAttackMul` fields are layered once at duel
 * start. update() mutates only preallocated numeric state; the sole runtime
 * record allocation is the completed-duel summary appended to `duelLog`.
 */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const EMPTY = [];
  const REQUIRED_CALLBACKS = ["duelKill", "duelRout"];
  const UINT = 4294967296;

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function mix(n) {
    n = Math.imul((n | 0) ^ ((n | 0) >>> 16), 0x7feb352d);
    n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
    return (n ^ (n >>> 16)) >>> 0;
  }

  function random(seed, salt) {
    return mix((seed | 0) ^ Math.imul(salt | 0, 0x9e3779b1)) / UINT;
  }

  function textHash(value) {
    const text = String(value);
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function hasSkill(general, id) {
    const ids = general.skillIds || EMPTY;
    for (let i = 0; i < ids.length; i++) if (ids[i] === id) return true;
    return false;
  }

  function attackOf(general) {
    const supplied = Number(general && general.duelAttack);
    if (Number.isFinite(supplied) && supplied > 0) return supplied;
    if (!general) return 1;

    let wu = Number(general.baseWu !== undefined ? general.baseWu : general.wu) || 1;
    /* itemIds are applied only when a raw baseWu is supplied. A battle record
       carrying effective wu has already had flat equipment modifiers layered;
       this avoids silently counting the weapon twice. */
    if (general.baseWu !== undefined && ZS.GeneralItems && ZS.GeneralItems.get) {
      const itemIds = general.itemIds || EMPTY;
      for (let i = 0; i < itemIds.length; i++) {
        const item = ZS.GeneralItems.get(itemIds[i]);
        const modifiers = (item && item.modifiers) || EMPTY;
        for (let j = 0; j < modifiers.length; j++) {
          const mod = modifiers[j];
          if (mod.stat !== "wu") continue;
          if (mod.type === "percent") wu *= 1 + Number(mod.value || 0);
          else wu += Number(mod.value || 0);
        }
      }
    }

    let skillMul = 1;
    const skills = general.skillIds || EMPTY;
    for (let i = 0; i < skills.length; i++) {
      const skill =
        ZS.GeneralSkills && ZS.GeneralSkills.get ? ZS.GeneralSkills.get(skills[i]) : null;
      skillMul += Number(skill && skill.battle && skill.battle.duelAttack) || 0;
    }
    const itemMod = Number(general.duelItemMod || general.weaponMod) || 0;
    const explicitMul = Number(general.duelAttackMul) || 1;
    return Math.max(1, (wu * 2 + itemMod) * skillMul * explicitMul);
  }

  function living(general) {
    if (!general || general.dead || general.routFlag || general.gone) return false;
    if (general.hp !== undefined && general.hp <= 0) return false;
    return true;
  }

  function oddBestOf(value) {
    let n = clamp((Number(value) || 5) | 0, 1, 9);
    if (!(n & 1)) n++;
    return Math.min(n, 9);
  }

  class BattleDuels {
    constructor(scenario, options) {
      const opts = options || {};
      this.scenario = scenario;
      this.reach = Math.max(20, Number(opts.reach) || 76);
      this.bestOf = oddBestOf(opts.bestOf);
      this.roundTime = Math.max(0.08, Number(opts.roundTime) || 0.42);
      this.scanEvery = Math.max(0.05, Number(opts.scanEvery) || 0.2);
      this.repeatCooldown = Math.max(
        0,
        opts.repeatCooldown === undefined ? 8 : Number(opts.repeatCooldown) || 0,
      );
      this.cameraZoom = Math.max(0.1, Number(opts.cameraZoom) || 1.72);
      this.cameraEase = Math.max(0.05, Number(opts.cameraEase) || 0.2);
      this.cameraAfter = Math.max(
        0,
        opts.cameraAfter === undefined ? 0.9 : Number(opts.cameraAfter) || 0,
      );
      this.seed = ((scenario.setup && scenario.setup.seed) || scenario.seed || 1) | 0;
      this.scanT = 0;
      this.cameraT = 0;
      this.lastError = null;
      this.last = null;
      this.log = scenario.duelLog || (scenario.duelLog = []);
      this.camera = { x: 0, y: 0, zoom: this.cameraZoom, ease: this.cameraEase };
      this.active = {
        on: false,
        a: null,
        b: null,
        seed: 0,
        round: 0,
        roundT: 0,
        winsA: 0,
        winsB: 0,
        need: (this.bestOf + 1) >> 1,
        attackA: 0,
        attackB: 0,
      };
    }

    init() {
      const active = this.active;
      active.on = false;
      active.a = null;
      active.b = null;
      active.round = 0;
      active.roundT = 0;
      active.winsA = 0;
      active.winsB = 0;
      this.scanT = 0;
      this.cameraT = 0;
      this.last = null;
      this.log.length = 0;
      const generals = this.scenario.generals || EMPTY;
      for (let i = 0; i < generals.length; i++) this._prime(generals[i], i);
      return this;
    }

    update(dt) {
      const step = Math.max(0, Number(dt) || 0);
      const generals = this.scenario.generals || EMPTY;
      for (let i = 0; i < generals.length; i++) {
        const general = generals[i];
        if (general.duelCooldown > 0) {
          general.duelCooldown = Math.max(0, general.duelCooldown - step);
        }
      }

      if (this.active.on) {
        this._syncCamera();
        if (!living(this.active.a) || !living(this.active.b) || this.scenario.over) {
          this._cancel();
          return;
        }
        this.active.roundT -= step;
        while (this.active.on && this.active.roundT <= 0) {
          this.active.roundT += this.roundTime;
          this._resolveRound();
        }
        return;
      }

      if (this.cameraT > 0) this.cameraT = Math.max(0, this.cameraT - step);
      if (this.scenario.over) return;
      this.scanT -= step;
      if (this.scanT > 0) return;
      this.scanT = this.scanEvery;
      this._scan(generals);
    }

    tryStart(first, second) {
      this.lastError = null;
      if (this.active.on) return this._reject("busy");
      if (!this._callbacksReady()) return this._reject("unsupported");
      if (!living(first) || !living(second) || first.side === second.side) {
        return this._reject("invalid_pair");
      }
      if ((first.duelCooldown || 0) > 0 || (second.duelCooldown || 0) > 0) {
        return this._reject("cooldown");
      }
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      if (dx * dx + dy * dy > this.reach * this.reach) {
        return this._reject("out_of_reach");
      }
      if (!this._los(first, second)) return this._reject("no_los");
      this._prime(first, this._generalIndex(first));
      this._prime(second, this._generalIndex(second));
      if (!this.willing(first, second) || !this.willing(second, first)) {
        return this._reject("unwilling");
      }

      let a = first;
      let b = second;
      if (this._after(a, b)) {
        a = second;
        b = first;
      }
      const active = this.active;
      active.on = true;
      active.a = a;
      active.b = b;
      active.seed = mix(this.seed ^ a.duelKey ^ Math.imul(b.duelKey, 0x85ebca6b));
      active.round = 0;
      active.roundT = this.roundTime;
      active.winsA = 0;
      active.winsB = 0;
      active.need = (this.bestOf + 1) >> 1;
      active.attackA = attackOf(a);
      active.attackB = attackOf(b);
      a.duelActive = true;
      b.duelActive = true;
      this.cameraT = 0;
      this._syncCamera();
      return true;
    }

    start(first, second) {
      return this.tryStart(first, second);
    }

    willing(general, enemy) {
      if (!living(general) || !living(enemy)) return false;
      if (general.duelWilling === true) return true;
      if (general.duelWilling === false) return false;
      let chance =
        typeof general.duelWilling === "number"
          ? general.duelWilling
          : 0.38 +
            ((Number(general.wu) || 50) - 50) * 0.003 +
            ((Number(general.zhi) || 50) - 50) * 0.0015 +
            ((Number(general.wu) || 50) - (Number(enemy.wu) || 50)) * 0.004;
      if (hasSkill(general, "valiant")) chance += 0.2;
      if (general.duelTrait === "brave" || general.duelTrait === "reckless") chance += 0.18;
      if (general.duelTrait === "cautious") chance -= 0.18;
      chance = clamp(chance, 0.08, 0.94);
      const seed = mix(this.seed ^ general.duelKey ^ Math.imul(enemy.duelKey, 0x27d4eb2d));
      return random(seed, 17) < chance;
    }

    cameraInterest() {
      return this.active.on || this.cameraT > 0 ? this.camera : null;
    }

    _scan(generals) {
      let bestA = null;
      let bestB = null;
      let bestD2 = Infinity;
      let bestTie = Infinity;
      const reach2 = this.reach * this.reach;
      for (let i = 0; i < generals.length; i++) {
        const a = generals[i];
        if (!living(a) || (a.duelCooldown || 0) > 0) continue;
        this._prime(a, i);
        for (let j = i + 1; j < generals.length; j++) {
          const b = generals[j];
          if (!living(b) || a.side === b.side || (b.duelCooldown || 0) > 0) continue;
          this._prime(b, j);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > reach2 || !this._los(a, b)) continue;
          if (!this.willing(a, b) || !this.willing(b, a)) continue;
          const tie = mix(a.duelKey ^ b.duelKey);
          if (d2 < bestD2 || (d2 === bestD2 && tie < bestTie)) {
            bestA = a;
            bestB = b;
            bestD2 = d2;
            bestTie = tie;
          }
        }
      }
      if (bestA) this.tryStart(bestA, bestB);
    }

    _resolveRound() {
      const active = this.active;
      active.round++;
      const salt = active.round * 8;
      const critA = random(active.seed, salt + 2) < this._critChance(active.a);
      const critB = random(active.seed, salt + 5) < this._critChance(active.b);
      const attackA =
        active.attackA * (0.9 + random(active.seed, salt + 1) * 0.2) * (critA ? 1.35 : 1);
      const attackB =
        active.attackB * (0.9 + random(active.seed, salt + 4) * 0.2) * (critB ? 1.35 : 1);
      let roundWinner;
      if (attackA > attackB) roundWinner = active.a;
      else if (attackB > attackA) roundWinner = active.b;
      else roundWinner = random(active.seed, salt + 7) < 0.5 ? active.a : active.b;
      if (roundWinner === active.a) active.winsA++;
      else active.winsB++;

      if (typeof this.scenario.duelRound === "function") {
        this.scenario.duelRound(
          active.a,
          active.b,
          roundWinner,
          active.winsA,
          active.winsB,
          active.round,
        );
      }
      if (active.winsA >= active.need || active.winsB >= active.need) this._finish();
    }

    _finish() {
      const active = this.active;
      const winner = active.winsA > active.winsB ? active.a : active.b;
      const loser = winner === active.a ? active.b : active.a;
      const margin = Math.abs(active.winsA - active.winsB);
      const winnerAttack = winner === active.a ? active.attackA : active.attackB;
      const loserAttack = winner === active.a ? active.attackB : active.attackA;
      const edge = Math.max(0, winnerAttack - loserAttack) / Math.max(1, winnerAttack);
      const killChance = clamp(0.1 + margin * 0.12 + edge * 0.3, 0.1, 0.68);
      const outcome = random(active.seed, 1000 + active.round) < killChance ? "killed" : "routed";
      const summary = {
        t: Math.round((Number(this.scenario.bt) || 0) * 100) / 100,
        k: "duel",
        a: active.a._duelId,
        b: active.b._duelId,
        winner: winner._duelId,
        loser: loser._duelId,
        scoreA: active.winsA,
        scoreB: active.winsB,
        rounds: active.round,
        bestOf: this.bestOf,
        outcome,
        seed: active.seed,
      };

      const unit = (this.scenario.units || EMPTY)[loser.un];
      if (unit && unit.moraleMax) {
        unit.moraleShock =
          (Number(unit.moraleShock) || 0) + unit.moraleMax * (0.17 + margin * 0.035);
      }
      if (outcome === "killed") this.scenario.duelKill(loser, winner, summary);
      else this.scenario.duelRout(loser, winner, summary);
      this.log.push(summary);
      this.last = summary;
      winner.flash = Math.max(Number(winner.flash) || 0, 0.55);
      winner.duelCooldown = this.repeatCooldown;
      loser.duelCooldown = this.repeatCooldown;
      winner.duelActive = false;
      loser.duelActive = false;
      this._syncCamera();
      this.cameraT = this.cameraAfter;
      active.on = false;
      active.a = null;
      active.b = null;
    }

    _cancel() {
      const active = this.active;
      if (active.a) active.a.duelActive = false;
      if (active.b) active.b.duelActive = false;
      active.on = false;
      active.a = null;
      active.b = null;
      this.cameraT = 0;
    }

    _critChance(general) {
      return clamp(
        0.07 + (Number(general.duelCrit) || 0) + ((Number(general.wu) || 50) - 50) * 0.0005,
        0.03,
        0.24,
      );
    }

    _prime(general, index) {
      if (general._duelId === undefined) {
        const fallback = "general:" + general.side + ":" + Math.max(0, index | 0);
        general._duelId = String(general.generalId || general.id || fallback);
      }
      if (general.duelKey === undefined) {
        general.duelKey = textHash(general._duelId);
      }
      if (!(general.duelCooldown >= 0)) general.duelCooldown = 0;
      if (general.duelActive !== true) general.duelActive = false;
    }

    _generalIndex(general) {
      const generals = this.scenario.generals || EMPTY;
      for (let i = 0; i < generals.length; i++) if (generals[i] === general) return i;
      return 0;
    }

    _after(a, b) {
      if (a.duelKey !== b.duelKey) return a.duelKey > b.duelKey;
      if (a.side !== b.side) return a.side > b.side;
      return a._duelId > b._duelId;
    }

    _los(a, b) {
      if (typeof this.scenario.duelLOS === "function") {
        return this.scenario.duelLOS(a, b) !== false;
      }
      const nav = this.scenario._nav || (this.scenario.map && this.scenario.map.nav);
      if (!nav || typeof nav.los !== "function") return true;
      const mask = this.scenario.map ? this.scenario.map.collisionMask(a.side, a.type) : true;
      return nav.los(a.x, a.y, b.x, b.y, mask, true);
    }

    _syncCamera() {
      const a = this.active.a;
      const b = this.active.b;
      if (!a || !b) return;
      this.camera.x = (a.x + b.x) * 0.5;
      this.camera.y = (a.y + b.y) * 0.5;
      this.camera.zoom = this.cameraZoom;
      this.camera.ease = this.cameraEase;
    }

    _callbacksReady() {
      return (
        typeof this.scenario.duelKill === "function" && typeof this.scenario.duelRout === "function"
      );
    }

    _reject(reason) {
      this.lastError = reason;
      return false;
    }
  }

  BattleDuels.attackOf = attackOf;
  BattleDuels.REQUIRED_CALLBACKS = REQUIRED_CALLBACKS.slice();
  ZS.BattleDuels = BattleDuels;
})();
