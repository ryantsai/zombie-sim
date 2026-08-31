/* Campaign logistics + commandery specialties.
 *
 * RTK-style strategy becomes legible when geography changes more than travel
 * time. This module keeps the rules derived from the campaign map: specialties
 * are content archetypes selected from immutable province data, while supply
 * is traced over the live ownership graph. Nothing here is stored as truth.
 */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const SPECIALTIES = {
    granary: {
      id: "granary",
      name: { "zh-tw": "沃野糧倉", en: "Granary Plain" },
      description: { "zh-tw": "平原秋收豐厚。", en: "Open farmland yields a richer harvest." },
      food: 1.16,
    },
    horse_market: {
      id: "horse_market",
      name: { "zh-tw": "邊郡馬市", en: "Horse Market" },
      description: {
        "zh-tw": "邊地善養戰馬，募騎兵較易。",
        en: "Frontier horse stock eases cavalry recruitment.",
      },
      recruit: 1.1,
      cavalry: 1.14,
    },
    ironworks: {
      id: "ironworks",
      name: { "zh-tw": "山中鐵冶", en: "Hill Ironworks" },
      description: {
        "zh-tw": "山鐵利於軍備與築城。",
        en: "Mountain iron supports arms and fortification.",
      },
      recruit: 1.08,
      wallCost: 0.86,
    },
    river_port: {
      id: "river_port",
      name: { "zh-tw": "水陸商埠", en: "River Port" },
      description: { "zh-tw": "舟楫商旅帶來額外金收入。", en: "River trade raises gold income." },
      income: 1.18,
    },
    timber: {
      id: "timber",
      name: { "zh-tw": "林木工坊", en: "Timber Works" },
      description: {
        "zh-tw": "木材可供城防與攻城器。",
        en: "Timber supports walls and siege equipment.",
      },
      wallCost: 0.9,
      siege: 1.14,
    },
    apothecary: {
      id: "apothecary",
      name: { "zh-tw": "澤國藥圃", en: "Marsh Apothecary" },
      description: {
        "zh-tw": "水澤藥草使傷將復原較快。",
        en: "Wetland herbs speed recovery from wounds.",
      },
      healing: 1,
      food: 1.06,
    },
    fortress: {
      id: "fortress",
      name: { "zh-tw": "雄關要塞", en: "Fortress Pass" },
      description: {
        "zh-tw": "險關城工深厚，守軍易於堅守。",
        en: "A strategic pass is cheaper to reinforce and defend.",
      },
      wallCost: 0.78,
      garrison: 1.12,
    },
    metropolis: {
      id: "metropolis",
      name: { "zh-tw": "都會百工", en: "Great Metropolis" },
      description: {
        "zh-tw": "大郡百業雲集，金糧徵募皆盛。",
        en: "A great city supports trade, grain, and recruitment.",
      },
      income: 1.1,
      food: 1.08,
      recruit: 1.08,
    },
  };

  function specialty(province) {
    const p = typeof province === "string" ? ZS.CampaignMap.province(province) : province;
    if (!p) return SPECIALTIES.granary;
    if ((p.wall | 0) >= 2) return SPECIALTIES.fortress;
    if ((p.size | 0) >= 3) return SPECIALTIES.metropolis;
    if (p.biome === "river") return SPECIALTIES.river_port;
    if (p.biome === "hill") {
      return p.x < ZS.CampaignMap.size.w * 0.42 ? SPECIALTIES.horse_market : SPECIALTIES.ironworks;
    }
    if (p.biome === "wood") return SPECIALTIES.timber;
    if (p.biome === "marsh") return SPECIALTIES.apothecary;
    return SPECIALTIES.granary;
  }

  function owned(camp, provinceId, factionId) {
    return camp.owner(provinceId) === factionId;
  }

  function capitalOf(camp, factionId) {
    const f = camp.factionDef(factionId);
    return f && owned(camp, f.capital, factionId) ? f.capital : null;
  }

  function starts(camp, army) {
    const out = [];
    if (army.at && owned(camp, army.at, army.faction)) out.push(army.at);
    if (army.at) {
      const rows = ZS.CampaignMap.neighbours(army.at);
      for (let i = 0; i < rows.length; i++) {
        const id = rows[i].id;
        if (owned(camp, id, army.faction) && out.indexOf(id) < 0) out.push(id);
      }
    }
    return out;
  }

  /* Cold-path BFS, run once per army per World phase. The returned path is
     useful to the campaign overlay; simulation code normally reads state and
     distance only. */
  function status(camp, army) {
    if (!camp || !army || army.troops <= 0 || !army.at) {
      return { state: "cut", distance: Infinity, source: null, path: [] };
    }
    const begin = starts(camp, army);
    if (!begin.length) return { state: "cut", distance: Infinity, source: null, path: [] };
    const capital = capitalOf(camp, army.faction);
    const queue = begin.slice();
    const prev = new Map();
    const dist = new Map();
    for (let i = 0; i < begin.length; i++) {
      prev.set(begin[i], null);
      dist.set(begin[i], 0);
    }
    let source = null;
    for (let qi = 0; qi < queue.length; qi++) {
      const at = queue[qi];
      const pr = camp.prov(at);
      if (at === capital || (!capital && pr && pr.garrison >= 400)) {
        source = at;
        break;
      }
      const rows = ZS.CampaignMap.neighbours(at);
      for (let i = 0; i < rows.length; i++) {
        const id = rows[i].id;
        if (!owned(camp, id, army.faction) || prev.has(id)) continue;
        prev.set(id, at);
        dist.set(id, dist.get(at) + 1);
        queue.push(id);
      }
    }
    if (!source) return { state: "cut", distance: Infinity, source: null, path: [] };
    const path = [];
    let at = source;
    while (at !== null) {
      path.push(at);
      at = prev.get(at);
    }
    path.reverse();
    const distance = dist.get(source) || 0;
    return {
      state: distance > 3 ? "strained" : "normal",
      distance,
      source,
      path,
    };
  }

  function applyWorld(camp, report) {
    const rows = [];
    const ids = Object.keys(camp.armies).sort();
    for (let i = 0; i < ids.length; i++) {
      const army = camp.armies[ids[i]];
      const supply = status(camp, army);
      army.supply = supply.state;
      army.supplyDistance = Number.isFinite(supply.distance) ? supply.distance : -1;
      if (supply.state === "cut") {
        const lost = Math.min(army.troops, Math.max(1, Math.round(army.troops * 0.03)));
        ZS.Army.takeLosses(army, lost);
        ZS.Army.tire(army, 0.12);
        rows.push({ army: army.id, state: supply.state, lost });
      } else if (supply.state === "strained") {
        ZS.Army.tire(army, 0.04);
        rows.push({ army: army.id, state: supply.state, lost: 0 });
      }
    }
    /* Preserve the P3 report shape when nothing happened. A supply incident
       is appended only when it is actionable UI information. */
    if (report && rows.length) report.supply = rows;
    return rows;
  }

  ZS.CampaignLogistics = {
    SPECIALTIES,
    specialty,
    status,
    applyWorld,
  };
})();
