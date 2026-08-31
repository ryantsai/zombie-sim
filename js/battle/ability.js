/* ZS.BattleAbilities — active general abilities (docs/SANGUO-DESIGN.md §4.2).
 *
 * Public compatibility:
 *
 *   abilities.use("inspire", general)          // the P2 API, unchanged
 *   abilities.use(id, general, target)          // targeted P5 actives
 *
 * Target records are world points (`{x,y}`), except disorder, which takes an
 * enemy unit (or `{unit}`). Fire and ambush deliberately know nothing about a
 * scenario's fire stamps or reserve composition. A scenario that enables them
 * supplies these narrow hooks and returns false to refuse the cast:
 *
 *   scenario.abilityFire(general, x, y, potency, definition)
 *   scenario.abilityAmbush(general, x, y, potency, definition)
 *
 * Charge uses the existing `scenario.order(unit,"charge",x,y)` seam; inspire
 * uses the existing morale/rally fields; disorder uses the existing cohesion
 * and morale-shock fields. Ability use is cold-path. update() performs only
 * fixed numeric-field maintenance and allocates no records per simulation tick.
 */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const IDS = ["charge", "fire", "ambush", "inspire", "disorder"];
  const FALLBACK = {
    charge: {
      cooldown: 28,
      potency: "zhi",
      order: "charge",
      target: "ground",
      range: 900,
      los: true,
      moraleHeal: 0.06,
      moraleShock: 0.1,
    },
    fire: {
      cooldown: 38,
      potency: "zhi",
      target: "ground",
      range: 420,
      potencyRange: 180,
      radius: 70,
      potencyRadius: 65,
      duration: 5,
      potencyDuration: 5,
      los: true,
    },
    ambush: {
      cooldown: 52,
      potency: "zhi",
      target: "edge",
      edgeMargin: 260,
      count: 24,
      potencyCount: 28,
    },
    inspire: {
      cooldown: 24,
      potency: "zhi",
      target: "self",
      radius: 190,
      baseHeal: 0.16,
      potencyHeal: 0.12,
    },
    disorder: {
      cooldown: 34,
      potency: "zhi",
      target: "enemy_unit",
      range: 430,
      los: true,
      duration: 4.5,
      potencyDuration: 3,
      cohesionLoss: 0.18,
      potencyCohesionLoss: 0.17,
      moraleShock: 0.07,
      potencyMoraleShock: 0.08,
    },
  };

  function definition(id) {
    const fallback = FALLBACK[id];
    const source =
      ZS.GeneralSkills && ZS.GeneralSkills.get(id) ? ZS.GeneralSkills.get(id).battle : null;
    const out = {};
    for (const key in fallback) out[key] = fallback[key];
    for (const key in source || {}) out[key] = source[key];
    return out;
  }

  const DEFS = {};
  for (let i = 0; i < IDS.length; i++) DEFS[IDS[i]] = definition(IDS[i]);

  function activeUnit(units, general) {
    const unit = units[general.un];
    return unit && unit.side === general.side && (unit.alive > 0 || unit.routAlive > 0)
      ? unit
      : null;
  }

  function targetUnit(target) {
    return target && target.unit ? target.unit : target;
  }

  function pointOf(target) {
    if (!target) return null;
    const x = Number(target.x !== undefined ? target.x : target.cx);
    const y = Number(target.y !== undefined ? target.y : target.cy);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  class BattleAbilities {
    constructor(scenario) {
      this.scenario = scenario;
      this.lastError = null;
    }

    init() {
      const generals = this.scenario.generals;
      for (let i = 0; i < generals.length; i++) generals[i].abilityCd = 0;
      const units = this.scenario.units;
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        u.abilityDisorderT = 0;
        u.abilityDisorderLoss = 0;
        u.abilityDisorderBase = 0;
      }
    }

    update(dt) {
      const generals = this.scenario.generals;
      for (let i = 0; i < generals.length; i++) {
        const g = generals[i];
        g.abilityCd = Math.max(0, g.abilityCd - dt);
      }
      const units = this.scenario.units;
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (!(u.abilityDisorderT > 0)) continue;
        u.abilityDisorderT = Math.max(0, u.abilityDisorderT - dt);
        if (u.abilityDisorderT > 0) {
          const ceiling = u.abilityDisorderBase * (1 - u.abilityDisorderLoss);
          if (u.cohesion > ceiling) u.cohesion = ceiling;
        } else {
          if (u.cohesion < u.abilityDisorderBase) u.cohesion = u.abilityDisorderBase;
          u.abilityDisorderLoss = 0;
          u.abilityDisorderBase = 0;
        }
      }
    }

    use(id, general, target) {
      this.lastError = null;
      const def = DEFS[id];
      if (!def) return this._reject("unknown");
      if (this.scenario.over) return this._reject("battle_over");
      const g = general || this._playerGeneral();
      if (!g) return this._reject("no_general");
      if (g.dead || g.routFlag || g.gone) return this._reject("general_unavailable");
      if (g.abilityCd > 0) return this._reject("cooldown");
      if (!this._learned(g, id)) return this._reject("unlearned");

      const potency = ZS.clamp((Number(g.zhi) || 0) / 100, 0, id === "inspire" ? 1 : 1.2);
      let used = false;
      let point = null;
      let unit = null;
      if (id === "inspire") used = this._inspire(g, potency, def);
      else if (id === "charge") {
        point = this._pointTarget(g, target, def, id);
        if (point) used = this._charge(g, target, point, potency, def);
      } else if (id === "fire") {
        point = this._pointTarget(g, target, def, id);
        if (point) used = this._fire(g, point, potency, def);
      } else if (id === "ambush") {
        point = this._edgeTarget(target, def);
        if (point) used = this._ambush(g, point, potency, def);
      } else if (id === "disorder") {
        unit = this._enemyTarget(g, target, def);
        if (unit) used = this._disorder(g, unit, potency, def);
      }
      if (!used) return false;

      g.abilityCd = Number(def.cooldown) || 0;
      g.flash = 0.65;
      this._log(id, g, potency, point, unit);
      return true;
    }

    _learned(general, id) {
      const ids = general.skillIds;
      if (!ids) return true; // P2 probes and legacy setups had no skill list
      for (let i = 0; i < ids.length; i++) if (ids[i] === id) return true;
      return false;
    }

    _pointTarget(general, target, def, id) {
      const point = pointOf(targetUnit(target));
      if (!point || !this._inWorld(point.x, point.y)) {
        this._reject("invalid_target");
        return null;
      }
      const potency = ZS.clamp((Number(general.zhi) || 0) / 100, 0, 1.2);
      const range = (Number(def.range) || 0) + (Number(def.potencyRange) || 0) * potency;
      if (range > 0 && Math.hypot(point.x - general.x, point.y - general.y) > range) {
        this._reject("out_of_range");
        return null;
      }
      if (def.los && !this._los(general, point.x, point.y, id)) {
        this._reject("no_los");
        return null;
      }
      return point;
    }

    _edgeTarget(target, def) {
      const point = pointOf(targetUnit(target));
      if (!point || !this._inWorld(point.x, point.y)) {
        this._reject("invalid_target");
        return null;
      }
      const width = Number(this.scenario.w) || 0;
      const height = Number(this.scenario.h) || 0;
      const edge = Math.min(point.x, point.y, width - point.x, height - point.y);
      if (edge > (Number(def.edgeMargin) || 0)) {
        this._reject("not_edge");
        return null;
      }
      return point;
    }

    _enemyTarget(general, target, def) {
      const unit = targetUnit(target);
      const units = this.scenario.units;
      if (
        !unit ||
        units.indexOf(unit) < 0 ||
        unit.side === general.side ||
        (!unit.alive && !unit.routAlive)
      ) {
        this._reject("invalid_enemy");
        return null;
      }
      const x = Number(unit.cx);
      const y = Number(unit.cy);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        this._reject("invalid_enemy");
        return null;
      }
      if (Math.hypot(x - general.x, y - general.y) > (Number(def.range) || 0)) {
        this._reject("out_of_range");
        return null;
      }
      if (def.los && !this._los(general, x, y, "disorder")) {
        this._reject("no_los");
        return null;
      }
      return unit;
    }

    _charge(general, target, point, potency, def) {
      const unit = activeUnit(this.scenario.units, general);
      if (!unit || typeof this.scenario.order !== "function") {
        return this._reject("no_command_unit");
      }
      if (!this.scenario.order(unit, def.order || "charge", point.x, point.y)) {
        return this._reject("order_refused");
      }
      unit.morale = Math.min(
        unit.moraleMax,
        unit.morale + unit.moraleMax * (Number(def.moraleHeal) || 0) * (0.65 + potency * 0.35),
      );
      const enemy = targetUnit(target);
      if (enemy && enemy.side !== undefined && enemy.side !== general.side) {
        const enemyUnit = enemy.cx !== undefined ? enemy : this.scenario.units[enemy.un];
        if (enemyUnit && enemyUnit.moraleMax) {
          enemyUnit.moraleShock +=
            enemyUnit.moraleMax * (Number(def.moraleShock) || 0) * (0.65 + potency * 0.35);
        }
      }
      return true;
    }

    _fire(general, point, potency, def) {
      const hook = this.scenario.abilityFire;
      if (typeof hook !== "function") return this._reject("unsupported");
      const result = hook.call(this.scenario, general, point.x, point.y, potency, def);
      if (result === false) return this._reject("hook_refused");
      return true;
    }

    _ambush(general, point, potency, def) {
      const reserve = this.scenario.reserves && this.scenario.reserves[general.side];
      if (reserve && reserve.left <= 0) return this._reject("no_reserve");
      const hook = this.scenario.abilityAmbush;
      if (typeof hook !== "function") return this._reject("unsupported");
      const result = hook.call(this.scenario, general, point.x, point.y, potency, def);
      if (result === false) return this._reject("hook_refused");
      return true;
    }

    _inspire(general, potency, def) {
      const units = this.scenario.units;
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (u.side !== general.side || (!u.alive && !u.routAlive)) continue;
        const d = Math.hypot(u.cx - general.x, u.cy - general.y);
        if (d > def.radius) continue;
        const falloff = 1 - d / def.radius;
        const heal =
          u.moraleMax * (def.baseHeal + def.potencyHeal * potency) * (0.55 + falloff * 0.45);
        u.morale = Math.min(u.moraleMax, u.morale + heal);
        if (u.morState === ZS.BattleMorale.ROUTING) {
          u.rallyProgress += 0.35 + potency * 0.2;
        }
      }
      this.scenario.fx.push({
        x: general.x,
        y: general.y,
        r: def.radius,
        t: 0.85,
        inspire: true,
        seed: general.seed + this.scenario.bt,
      });
      return true;
    }

    _disorder(_general, unit, potency, def) {
      const loss = ZS.clamp(
        (Number(def.cohesionLoss) || 0) + (Number(def.potencyCohesionLoss) || 0) * potency,
        0,
        0.65,
      );
      if (!(unit.abilityDisorderT > 0)) unit.abilityDisorderBase = unit.cohesion || 0.72;
      unit.abilityDisorderLoss = Math.max(unit.abilityDisorderLoss || 0, loss);
      unit.abilityDisorderT = Math.max(
        unit.abilityDisorderT || 0,
        (Number(def.duration) || 0) + (Number(def.potencyDuration) || 0) * potency,
      );
      unit.cohesion = Math.min(
        unit.cohesion,
        unit.abilityDisorderBase * (1 - unit.abilityDisorderLoss),
      );
      unit.moraleShock +=
        unit.moraleMax *
        ((Number(def.moraleShock) || 0) + (Number(def.potencyMoraleShock) || 0) * potency);
      return true;
    }

    _los(general, x, y, id) {
      if (typeof this.scenario.abilityLOS === "function") {
        return this.scenario.abilityLOS(general, x, y, id) !== false;
      }
      const nav = this.scenario._nav || (this.scenario.map && this.scenario.map.nav);
      if (!nav || typeof nav.los !== "function") return false;
      const mask = this.scenario.map
        ? this.scenario.map.collisionMask(general.side, general.type)
        : true;
      return nav.los(general.x, general.y, x, y, mask, true);
    }

    _inWorld(x, y) {
      const width = Number(this.scenario.w) || 0;
      const height = Number(this.scenario.h) || 0;
      return x >= 0 && y >= 0 && x <= width && y <= height;
    }

    _log(id, general, potency, point, unit) {
      const row = {
        t: Math.round(this.scenario.bt * 100) / 100,
        k: "ability",
        id,
        g: general.generalId,
      };
      if (id !== "inspire") {
        row.p = Math.round(potency * 1000) / 1000;
        if (point) {
          row.x = Math.round(point.x);
          row.y = Math.round(point.y);
        }
        if (unit) row.u = unit.uid;
      }
      this.scenario.orderLog.push(row);
    }

    _reject(error) {
      this.lastError = error;
      return false;
    }

    _playerGeneral() {
      const selected = ZS.Command && ZS.Command.selection;
      if (selected) {
        for (let i = 0; i < selected.length; i++) {
          const g = selected[i].general;
          if (g && !g.dead && !g.routFlag && !g.gone) return g;
        }
      }
      const generals = this.scenario.generals;
      for (let i = 0; i < generals.length; i++) {
        const g = generals[i];
        if (g.side === 0 && !g.dead && !g.routFlag && !g.gone) return g;
      }
      return null;
    }
  }

  BattleAbilities.DEFS = DEFS;
  BattleAbilities.IDS = IDS.slice();
  ZS.BattleAbilities = BattleAbilities;
})();
