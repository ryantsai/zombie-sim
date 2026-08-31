/* ZS.CampaignVictory — pluggable campaign goals and visible progress.
 *
 * v1 follows the design's conquest decision: taking every *living rival's*
 * founding seat is enough to claim the mandate. An extinct house no longer
 * has a rival claim, so its abandoned old capital is not an unrelated final
 * scavenger hunt. The predicate is kept outside Turn so future historical or
 * score goals do not rewrite the four-phase resolver. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const DEFAULT_GOAL = Object.freeze({ type: "capitals" });

  function capitalIds() {
    const out = [];
    const seen = new Set();
    const rows = (ZS.data && ZS.data.factions) || [];
    for (let i = 0; i < rows.length; i++) {
      const id = rows[i].capital;
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out.sort();
  }

  function liveFactions(camp) {
    const out = [];
    for (const id in camp.factions) {
      const f = camp.factions[id];
      if (f && f.alive) out.push(id);
    }
    return out.sort();
  }

  function rivalCapitalIds(camp, factionId) {
    const out = [];
    const rows = (ZS.data && ZS.data.factions) || [];
    if (!camp || !camp.factions) return out;
    for (let i = 0; i < rows.length; i++) {
      const faction = camp.factions[rows[i].id];
      if (!faction || !faction.alive || rows[i].id === factionId || !rows[i].capital) continue;
      out.push(rows[i].capital);
    }
    return out.sort();
  }

  function progress(camp, factionId, goal) {
    const type = (goal && goal.type) || DEFAULT_GOAL.type;
    if (type === "provinces") {
      const total = Object.keys(camp.provinces).length;
      return { type, held: camp.provincesOf(factionId).length, total };
    }
    const capitals = rivalCapitalIds(camp, factionId);
    let held = 0;
    for (let i = 0; i < capitals.length; i++) if (camp.owner(capitals[i]) === factionId) held++;
    return { type: "capitals", held, total: capitals.length };
  }

  function check(camp, goal) {
    if (!camp) return null;
    const live = liveFactions(camp);
    if (live.length <= 1) return { winner: live[0] || null, reason: "last_house" };

    const type = (goal && goal.type) || DEFAULT_GOAL.type;
    if (type === "provinces") {
      const total = Object.keys(camp.provinces).length;
      for (let i = 0; i < live.length; i++) {
        if (camp.provincesOf(live[i]).length === total) {
          return { winner: live[i], reason: "all_provinces" };
        }
      }
      return null;
    }

    for (let i = 0; i < live.length; i++) {
      const factionId = live[i];
      const capitals = rivalCapitalIds(camp, factionId);
      if (!capitals.length) return { winner: factionId, reason: "last_house" };
      let all = true;
      for (let k = 0; k < capitals.length; k++) {
        if (camp.owner(capitals[k]) !== factionId) {
          all = false;
          break;
        }
      }
      if (all) return { winner: factionId, reason: "all_capitals" };
    }
    return null;
  }

  ZS.CampaignVictory = {
    DEFAULT_GOAL,
    capitalIds,
    rivalCapitalIds,
    progress,
    check,
  };
})();
