/* ZS.CampaignPolitics — seasonal officer recovery and loyalty consequences.
 *
 * Battle outcomes move loyalty immediately; this World-phase pass supplies
 * the longer arc. Wounds recover, unpaid households lose faith, and an
 * officer at truly broken loyalty may cross to a neighbouring rival. Every
 * roll derives from campaign seed + turn + officer id. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  function hashText(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h | 0;
  }

  function roll(camp, id) {
    const seed =
      ((camp.seed | 0) ^ Math.imul(camp.turn | 0, 0x9e3779b1) ^ hashText(id + ":defect")) | 0;
    return ZS.rng32(seed)();
  }

  function locationProvince(camp, general) {
    const loc = general && general.location;
    if (!loc) return null;
    if (loc.startsWith("army:")) {
      const army = camp.armies[loc.slice(5)];
      return army ? army.at : null;
    }
    return camp.prov(loc) ? loc : null;
  }

  function rivalCandidates(camp, general) {
    const out = [];
    const seen = new Set();
    const at = locationProvince(camp, general);
    const add = (id) => {
      if (!id || id === general.allegiance || seen.has(id)) return;
      const faction = camp.faction(id);
      if (!faction || !faction.alive) return;
      seen.add(id);
      out.push(id);
    };
    if (at) {
      add(camp.owner(at));
      const rows = ZS.CampaignMap.neighbours(at);
      for (let i = 0; i < rows.length; i++) add(camp.owner(rows[i].id));
    }
    if (!out.length) {
      const live = [];
      for (const id in camp.factions) {
        const faction = camp.factions[id];
        if (id !== general.allegiance && faction.alive) live.push(id);
      }
      live.sort(
        (a, b) => camp.provincesOf(b).length - camp.provincesOf(a).length || a.localeCompare(b),
      );
      for (let i = 0; i < live.length; i++) add(live[i]);
    }
    return out;
  }

  function advance(camp, report) {
    const news = { healed: [], defected: [] };
    if (!camp || !ZS.General || !camp.generals) return news;

    const before = {};
    for (const id in camp.generals) before[id] = camp.generals[id].injury;
    if (camp.advanceGenerals) camp.advanceGenerals(1);
    if (ZS.CampaignLogistics) {
      for (const id in camp.generals) {
        const general = camp.generals[id];
        if (general.injury !== "wounded") continue;
        const provinceId = locationProvince(camp, general);
        const province = provinceId && ZS.CampaignMap.province(provinceId);
        const specialty = province && ZS.CampaignLogistics.specialty(province);
        if (specialty && specialty.healing) {
          ZS.General.advanceInjury(general, specialty.healing);
        }
      }
    }
    for (const id in camp.generals) {
      const g = camp.generals[id];
      if (before[id] !== "none" && g.injury === "none") news.healed.push(id);
    }

    const starved = new Set((report && report.starved) || []);
    for (const id in camp.generals) {
      const g = camp.generals[id];
      if (g.dead || g.capturedBy || !g.allegiance) continue;
      if (starved.has(g.allegiance)) ZS.General.adjustLoyalty(g, -6);
    }

    const ids = Object.keys(camp.generals).sort();
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const g = camp.generals[id];
      if (!ZS.General.canDefect(g)) continue;
      const current = camp.factionDef(g.allegiance);
      if (current && current.leader === id) continue;
      const chance = ZS.clamp(0.18 + (25 - g.loyalty) * 0.022, 0.18, 0.72);
      if (roll(camp, id) >= chance) continue;
      const rivals = rivalCandidates(camp, g);
      if (!rivals.length) continue;
      const pick = Math.floor(roll(camp, id + ":target") * rivals.length) % rivals.length;
      const from = g.allegiance;
      const to = rivals[pick];
      if (camp.defectGeneral(id, to, false)) news.defected.push({ id, from, to });
    }

    if (report && (news.healed.length || news.defected.length)) report.generalNews = news;
    camp.syncGeneralLocations();
    return news;
  }

  ZS.CampaignPolitics = {
    advance,
    rivalCandidates,
  };
})();
