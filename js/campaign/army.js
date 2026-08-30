/* ZS.Army — stacks, composition and marching (docs/SANGUO-DESIGN.md §4.1).

   An army is troops + a composition + up to three generals, and it is either
   **garrisoned** in a province or **marching** along a chain of edges. There is
   no third state: an army on the road is between two named places, and the map
   draws it there.

   Composition is the design's four arms — 槍 / 刀盾 / 弩 / 騎 — held as ratios
   that always sum to 1. §4.3 turns those ratios into integer men per type at
   handoff time, which is P4's job; nothing here needs to know about the twelve
   unit types the battle can actually field.

   Everything on an army record is plain JSON. The whole thing goes into the
   save verbatim (§5.3), which is why generals are stored as ids and the
   marching path as province ids. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const ARMS = ["spear", "dao", "crossbow", "cav"];
  const MAX_GENERALS = 3;

  /* Per 1,000 men per season. Food is the real constraint — an army in the
     field eats whether or not it fights, which is what makes a long march a
     decision rather than a formality. */
  const UPKEEP_GOLD = 8;
  const UPKEEP_FOOD = 30;
  const MARCH_FOOD_EXTRA = 1.5; // multiplier while on the road

  /* Recruit price per man, by arm. Cavalry costs what cavalry costs. */
  const COST = { spear: 0.9, dao: 1.1, crossbow: 1.4, cav: 3.2 };

  /* What a season of fighting takes out of a stack. Fatigue already docks up
     to 25% of `strength` and sheds 0.25 per quiet season, so this is the brake
     on a stack that wants to fight every season without ever resting: storming
     a city leaves it measurably weaker for the next two. */
  const FATIGUE_FIELD = 0.22;
  const FATIGUE_ASSAULT = 0.3;

  const Army = {
    ARMS,
    MAX_GENERALS,
    UPKEEP_GOLD,
    UPKEEP_FOOD,
    COST,
    FATIGUE_FIELD,
    FATIGUE_ASSAULT,

    defaultComp() {
      return { spear: 0.42, dao: 0.26, crossbow: 0.2, cav: 0.12 };
    },

    make(id, faction, at, troops, comp) {
      return {
        id,
        faction,
        troops: Math.max(0, troops | 0),
        comp: normalize(comp || Army.defaultComp()),
        generals: [],
        at: at || null,
        path: null, // [provinceId] remaining, path[0] is the next node
        left: 0, // turns until path[0] is reached
        fatigue: 0, // 0..1, climbs while marching, falls while garrisoned
        raised: 0, // turn the stack was raised; UI orders by it
        from: at || null, // the province it last stood in — where a beaten stack falls back to
        since: 0, // turn it reached `at`; the older stack is the defender
      };
    },

    /* Integer men per arm — the shape §4.3's `comp` becomes at handoff. The
       remainder goes to the largest arm so the parts always sum to `troops`. */
    men(a) {
      const out = {};
      let sum = 0,
        big = ARMS[0];
      for (const k of ARMS) {
        out[k] = Math.floor(a.troops * (a.comp[k] || 0));
        sum += out[k];
        if ((a.comp[k] || 0) > (a.comp[big] || 0)) big = k;
      }
      out[big] += a.troops - sum;
      return out;
    },

    /* What a stack is worth in a fight, before terrain and morale. Generals
       are the multiplier the RPG layer exists to grow: 統 raises the whole
       stack, 武 sharpens the edge. With no roster loaded ZS.Roster answers
       neutral, so the campaign still ranks armies by size alone. */
    strength(a) {
      const arms = Army.men(a);
      let base = arms.spear * 1.0 + arms.dao * 1.05 + arms.crossbow * 1.15 + arms.cav * 1.6;
      let tong = 0,
        wu = 0;
      for (const gid of a.generals) {
        const s = ZS.Roster.stats(gid);
        if (s.tong > tong) tong = s.tong;
        if (s.wu > wu) wu = s.wu;
      }
      if (a.generals.length) base *= 1 + tong * 0.004 + wu * 0.002;
      base *= 1 - a.fatigue * 0.25;
      return Math.round(base);
    },

    upkeep(a) {
      const k = a.troops / 1000;
      const marching = Army.isMarching(a);
      return {
        gold: Math.ceil(k * UPKEEP_GOLD),
        food: Math.ceil(k * UPKEEP_FOOD * (marching ? MARCH_FOOD_EXTRA : 1)),
      };
    },

    /* A stack that fought is tired whether it won or not. */
    tire(a, amount) {
      a.fatigue = Math.min(1, a.fatigue + amount);
      return a.fatigue;
    },

    isMarching(a) {
      return !!(a.path && a.path.length);
    },

    /* Where the token is drawn. A marching stack is interpolated between the
       province it left and the one it is walking to, so the map shows motion
       rather than teleporting stacks between nodes. */
    position(a, map) {
      const here = map.province(a.at);
      if (!here) return null;
      if (!Army.isMarching(a)) return { x: here.x, y: here.y, moving: false };
      const next = map.province(a.path[0]);
      if (!next) return { x: here.x, y: here.y, moving: false };
      const total = Math.max(1, map.cost(a.at, a.path[0]));
      const done = ZS.clamp((total - a.left) / total, 0, 1);
      return {
        x: here.x + (next.x - here.x) * done,
        y: here.y + (next.y - here.y) * done,
        moving: true,
      };
    },

    /* Give the stack a route. `path` includes the province it is standing in;
       an empty or one-node path is a halt. Re-ordering mid-march is allowed and
       restarts the leg, which is the honest cost of changing your mind. */
    setPath(a, path) {
      if (!path || path.length < 2) {
        a.path = null;
        a.left = 0;
        return false;
      }
      a.path = path.slice(1);
      a.left = 0; // filled by the first advance()
      return true;
    },

    halt(a) {
      a.path = null;
      a.left = 0;
    },

    /* One season of marching. Returns the province id the stack *arrived* at
       this turn, or null if it is still on the road (or was never moving).
       Fatigue climbs on the road and falls in quarters. */
    advance(a, map) {
      if (!Army.isMarching(a)) {
        a.fatigue = Math.max(0, a.fatigue - 0.25);
        return null;
      }
      if (a.left <= 0) a.left = Math.max(1, map.cost(a.at, a.path[0]));
      a.left -= 1;
      a.fatigue = Math.min(1, a.fatigue + 0.18);
      if (a.left > 0) return null;
      a.from = a.at;
      a.at = a.path.shift();
      if (!a.path.length) a.path = null;
      if (a.path) a.left = Math.max(1, map.cost(a.at, a.path[0]));
      return a.at;
    },

    /* ---- composition ------------------------------------------------ */

    /* Fold `add` (men per arm) into the stack, keeping comp a ratio. */
    reinforce(a, add) {
      const cur = Army.men(a);
      let total = 0;
      for (const k of ARMS) {
        cur[k] += Math.max(0, (add && add[k]) | 0);
        total += cur[k];
      }
      a.troops = total;
      if (total > 0) {
        const comp = {};
        for (const k of ARMS) comp[k] = cur[k] / total;
        a.comp = comp;
      }
      return a;
    },

    /* Losses come back from a battle as a single number (§4.3), so they are
       spread across the arms in proportion — the alternative is asking the
       campaign to care which men died, which is P4's `BattleResult` at most. */
    takeLosses(a, dead) {
      const d = Math.min(a.troops, Math.max(0, dead | 0));
      a.troops -= d;
      if (a.troops <= 0) {
        a.troops = 0;
        a.comp = Army.defaultComp();
      }
      return d;
    },

    cost(add) {
      let gold = 0,
        men = 0;
      for (const k of ARMS) {
        const n = Math.max(0, (add && add[k]) | 0);
        gold += n * COST[k];
        men += n;
      }
      return { gold: Math.ceil(gold), food: Math.ceil(men * 0.6), men };
    },

    /* ---- generals ---------------------------------------------------- */

    assign(a, gid) {
      if (!gid || a.generals.length >= MAX_GENERALS) return false;
      if (a.generals.indexOf(gid) >= 0) return false;
      a.generals.push(gid);
      return true;
    },

    unassign(a, gid) {
      const i = a.generals.indexOf(gid);
      if (i < 0) return false;
      a.generals.splice(i, 1);
      return true;
    },
  };

  function normalize(comp) {
    let sum = 0;
    for (const k of ARMS) sum += Math.max(0, comp[k] || 0);
    const out = {};
    if (sum <= 0) return Army.defaultComp();
    for (const k of ARMS) out[k] = Math.max(0, comp[k] || 0) / sum;
    return out;
  }

  Army.normalize = normalize;
  ZS.Army = Army;
})();
