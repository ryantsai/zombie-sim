/* ZS.Roster — the general seam (docs/SANGUO-DESIGN.md §4.1, §9).

   The general model itself (`js/campaign/general.js`) and the almanac
   (`js/campaign/data/generals.js`) are P5's RPG work and are being built
   separately. P3 still has to *refer* to generals: a faction has a leader, an
   army carries 1-3 of them, and the province panel wants to say who is
   governing.

   So the campaign never touches a general record directly. It stores ids and
   asks here, and this file answers from whatever is loaded:

     ZS.Generals present       -> the 200-person almanac (js/campaign/data/generals.js)
     ZS.data.generals present  -> the same thing under the §9 name
     ZS.General present        -> its derived read wins over the plain fields
     none of them              -> a neutral stand-in, so a campaign still runs

   The stand-in is deliberately flat (all 60s) rather than random, so a
   campaign played without the almanac is boring but never wrong.

   **Which generals serve which warlord is campaign data, not almanac data.**
   The almanac's own `faction` field is a *culture* — "shu", "wei", "wu",
   "other" — which is what a portrait and a sash need, and is not the same
   question as who 陶謙 has on his staff in 194. That answer lives in
   `ZS.data.factions[].roster`, and `forFaction()` reads it from there.

   `snapshot(id)` returns the §4.3 general shape that BattleSetup wants, which
   is the one place P4 has to agree with P5. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const NEUTRAL = { wu: 60, tong: 60, zhi: 60, zheng: 60 };
  const STAT_KEYS = ["wu", "tong", "zhi", "zheng"];

  /* The almanac ships as `ZS.Generals` (an ordered ALL plus a CATALOGUE index);
     §9 named the file's export `ZS.data.generals`. Accept either, as an array
     or a keyed object. Indexed once, lazily, and re-indexed if the roster shows
     up after boot (a verify script may inject one). */
  let index = null;
  let indexedFrom = null;

  function source() {
    if (ZS.Generals && (ZS.Generals.ALL || ZS.Generals.CATALOGUE)) {
      return ZS.Generals.ALL || ZS.Generals.CATALOGUE;
    }
    return (ZS.data && ZS.data.generals) || null;
  }

  function build() {
    const src = source();
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

    /* Who serves this warlord at the start, as ids. Read from the campaign's
       own faction data, then filtered against the almanac so a name that is
       not (yet) in the roster is simply absent rather than a broken record. */
    forFaction(factionId) {
      const fd = (ZS.data.factions || []).find((f) => f.id === factionId);
      if (!fd || !fd.roster) return [];
      const idx = build();
      if (!idx.size) return fd.roster.slice();
      return fd.roster.filter((id) => idx.has(id));
    },

    /* The almanac's own grouping — a *culture* ("shu" / "wei" / "wu" /
       "other"), which is what a portrait and a sash key off. Not the same
       question as forFaction(); kept separate on purpose. */
    byCulture(culture) {
      const out = [];
      for (const g of build().values()) if (g.faction === culture) out.push(g.id);
      out.sort();
      return out;
    },

    /* Courtesy name (字) when the almanac carries one — 雲長 rather than 關羽,
       which is how a lord would actually address them. */
    style(id) {
      const g = this.get(id);
      return g && g.style ? ZS.i18n.t(g.style) : "";
    },

    /* A one-line read for the campaign panel. */
    line(id) {
      const s = this.stats(id);
      return ZS.i18n.t("campaign.general.line", {
        name: this.name(id),
        wu: s.wu,
        tong: s.tong,
        zhi: s.zhi,
        zheng: s.zheng,
      });
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
        /* The almanac describes a general as a mounted hero model rather than
           by unit type; a mounted general leads from the cavalry. P5 may say
           so directly with `unitType`, and that wins. */
        unitType:
          (g && g.unitType) ||
          (g && g.model && g.model.mounted ? "cav" : null) ||
          o.unitType ||
          "dao",
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
