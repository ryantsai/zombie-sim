/* ZS.Roster — the general seam (docs/SANGUO-DESIGN.md §4.1, §9).

   The general model itself (`js/campaign/general.js`) and the almanac
   (`js/campaign/data/generals.js`) are P5's RPG work and are being built
   separately. P3 still has to *refer* to generals: a faction has a leader, an
   army carries 1-3 of them, and the province panel wants to say who is
   governing.

   So the campaign never touches a general record directly. It stores ids and
   asks here, and this file answers from whatever is loaded:

     ZS.data.generals present  -> the real roster
     ZS.General present        -> its derived stats win over the plain fields
     neither                   -> a neutral stand-in, so a campaign still runs

   That is the whole point: dropping the roster in lights the campaign up with
   no edit to map.js / army.js / turn.js / ai.js. The stand-in is deliberately
   flat (all 60s) rather than random, so a campaign played without the roster
   is boring but never wrong.

   `snapshot(id)` returns the §4.3 general shape that BattleSetup wants, which
   is the one place P4 has to agree with P5. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const NEUTRAL = { wu: 60, tong: 60, zhi: 60, zheng: 60 };
  const STAT_KEYS = ["wu", "tong", "zhi", "zheng"];

  /* The almanac is an array or a keyed object depending on how P5 writes it;
     both are indexed once, lazily, and re-indexed if the roster shows up after
     boot (a verify script may inject one). */
  let index = null;
  let indexedFrom = null;

  function build() {
    const src = ZS.data && ZS.data.generals;
    if (src === indexedFrom && index) return index;
    indexedFrom = src;
    index = new Map();
    if (!src) return index;
    if (Array.isArray(src)) {
      for (const g of src) if (g && g.id) index.set(g.id, g);
    } else {
      for (const k in src) {
        const g = src[k];
        if (g) index.set(g.id || k, g);
      }
    }
    return index;
  }

  const Roster = {
    NEUTRAL,

    /* True once a real almanac is loaded. UI uses it to decide whether to
       offer a general list at all, rather than showing rows of stand-ins. */
    available() {
      return build().size > 0;
    },

    /* The raw almanac record, or null. Callers must tolerate null. */
    get(id) {
      if (!id) return null;
      return build().get(id) || null;
    },

    /* Display name. Falls back to the id so a missing entry is visible and
       greppable rather than blank — the same rule ZS.i18n.t() follows. */
    name(id) {
      const g = this.get(id);
      if (g && g.name) return ZS.i18n.t(g.name);
      return String(id || "");
    },

    /* Base attributes, always a complete record. When P5's ZS.General is
       loaded its derived read wins, so items and injuries are already folded
       in by the time the campaign sees a number. */
    stats(id) {
      const g = this.get(id);
      if (!g) return NEUTRAL;
      if (ZS.General && typeof ZS.General.derive === "function") {
        const d = ZS.General.derive(g);
        if (d) return d;
      }
      let out = null;
      for (const k of STAT_KEYS) {
        if (typeof g[k] === "number") {
          if (!out) out = { ...NEUTRAL };
          out[k] = g[k];
        }
      }
      return out || NEUTRAL;
    },

    /* Every general the almanac files under this faction. Empty until the
       roster lands; the campaign seeds leaders from ZS.data.factions instead,
       so an empty answer is not a broken campaign. */
    forFaction(factionId) {
      const out = [];
      for (const g of build().values()) if (g.faction === factionId) out.push(g.id);
      out.sort();
      return out;
    },

    /* The §4.3 BattleSetup general snapshot. P4 hands this straight to
       ScenarioSanguo, which already reads exactly these fields (its
       defaultSetup() builds the same shape by hand). */
    snapshot(id, opts) {
      const o = opts || {};
      const g = this.get(id);
      const s = this.stats(id);
      return {
        id: id,
        name: g && g.name ? g.name : o.name || "battle.general.unknown",
        wu: s.wu,
        tong: s.tong,
        zhi: s.zhi,
        unitType: (g && g.unitType) || o.unitType || "dao",
      };
    },

    /* Governing a province is `zheng` work (§4.1's province_income). Kept here
       so the one formula lives beside the stat read. */
    governBonus(id) {
      if (!id) return 1;
      return 1 + this.stats(id).zheng * 0.01;
    },
  };

  ZS.Roster = Roster;
})();
