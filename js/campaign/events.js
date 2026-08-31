/* ZS.CampaignEvents — deterministic, choice-driven campaign Tales.
 *
 * World phase may enqueue one content id plus its target ids. The choice is
 * deliberately resolved later by the campaign UI: no hidden die silently
 * spends the player's treasury, and pending Tales survive save/load. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const EVERY = 3;
  const HISTORY_MAX = 8;

  function hashText(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h | 0;
  }

  function seedFor(camp) {
    return ((camp.seed | 0) ^ Math.imul(camp.turn | 0, 0x9e3779b1) ^ hashText("tales")) | 0;
  }

  function defs() {
    return (ZS.data && ZS.data.campaignEvents) || [];
  }

  function def(id) {
    const list = defs();
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function playerProvinces(camp) {
    return camp.provincesOf(camp.playerFactionId).sort();
  }

  function isFrontier(camp, id) {
    const rows = ZS.CampaignMap.neighbours(id);
    for (let i = 0; i < rows.length; i++) {
      if (camp.owner(rows[i].id) !== camp.playerFactionId) return true;
    }
    return false;
  }

  function generalRows(camp, test) {
    const faction = camp.player();
    const out = [];
    if (!faction) return out;
    for (let i = 0; i < faction.generals.length; i++) {
      const id = faction.generals[i];
      const g = camp.generals && camp.generals[id];
      if (g && !g.dead && !g.capturedBy && (!test || test(g))) out.push(id);
    }
    return out.sort();
  }

  function targets(camp, event) {
    if (event.scope === "province") {
      return playerProvinces(camp).filter((id) => {
        const pd = ZS.CampaignMap.province(id);
        if (!pd) return false;
        if (event.requires === "frontier") return isFrontier(camp, id);
        if (event.requires === "river") return pd.biome === "river";
        if (event.requires === "hill") return pd.biome === "hill";
        if (event.requires === "port") return !!pd.port;
        return true;
      });
    }
    if (event.scope === "army") {
      return camp
        .armiesOf(camp.playerFactionId)
        .filter((army) => {
          if (event.requires !== "strained_army") return true;
          return army.supply === "strained" || army.supply === "cut";
        })
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .map((army) => army.id);
    }
    if (event.scope === "general") {
      if (event.requires === "wounded") {
        return generalRows(camp, (g) => g.injury === "wounded");
      }
      if (event.requires === "low_loyalty") {
        return generalRows(camp, (g) => (g.loyalty | 0) < 55);
      }
      return generalRows(camp);
    }
    return [];
  }

  function queueWorld(camp, force) {
    if (!camp || !camp.playerFactionId || camp.over) return null;
    camp.eventQueue = Array.isArray(camp.eventQueue) ? camp.eventQueue : [];
    camp.eventHistory = Array.isArray(camp.eventHistory) ? camp.eventHistory : [];
    if (camp.eventQueue.length) return camp.eventQueue[0];
    if (!force && ((camp.turn + Math.abs(camp.seed | 0)) % EVERY !== 0 || camp.turn <= 1)) {
      return null;
    }

    const recent = new Set(camp.eventHistory.slice(-4));
    let pool = [];
    const list = defs();
    for (let i = 0; i < list.length; i++) {
      const rows = targets(camp, list[i]);
      if (rows.length && !recent.has(list[i].id)) pool.push({ event: list[i], targets: rows });
    }
    if (!pool.length && recent.size) {
      for (let i = 0; i < list.length; i++) {
        const rows = targets(camp, list[i]);
        if (rows.length) pool.push({ event: list[i], targets: rows });
      }
    }
    if (!pool.length) return null;

    const rng = ZS.rng32(seedFor(camp));
    const pick = pool[Math.floor(rng() * pool.length) % pool.length];
    const target = pick.targets[Math.floor(rng() * pick.targets.length) % pick.targets.length];
    const record = { id: pick.event.id, turn: camp.turn };
    if (pick.event.scope === "province") record.provinceId = target;
    else if (pick.event.scope === "army") record.armyId = target;
    else if (pick.event.scope === "general") record.generalId = target;
    camp.eventQueue.push(record);
    return record;
  }

  function pending(camp) {
    if (!camp || !Array.isArray(camp.eventQueue) || !camp.eventQueue.length) return null;
    const record = camp.eventQueue[0];
    const event = def(record.id);
    return event ? { record, event } : null;
  }

  function canChoose(camp, index) {
    const p = pending(camp);
    if (!p || !p.event.choices[index]) return false;
    const fx = p.event.choices[index].effects || {};
    const faction = camp.player();
    if (!faction) return false;
    if ((fx.gold || 0) < 0 && faction.gold < -fx.gold) return false;
    if ((fx.food || 0) < 0 && faction.food < -fx.food) return false;
    const pr = p.record.provinceId ? camp.prov(p.record.provinceId) : null;
    if ((fx.garrison || 0) < 0 && (!pr || pr.garrison < -fx.garrison)) return false;
    return true;
  }

  function applyProvince(pr, fx) {
    if (!pr) return;
    if (fx.loyalty) pr.loyalty = ZS.clamp(pr.loyalty + fx.loyalty, 0, 100);
    if (fx.unrest) pr.unrest = Math.max(0, (pr.unrest | 0) + fx.unrest);
    if (fx.garrison) pr.garrison = Math.max(0, pr.garrison + fx.garrison);
    if (fx.wall) pr.dev.wall = ZS.clamp((pr.dev.wall | 0) + fx.wall, 0, ZS.Campaign.DEV_MAX.wall);
    if (fx.incomeDev) {
      pr.dev.income = ZS.clamp((pr.dev.income | 0) + fx.incomeDev, 0, ZS.Campaign.DEV_MAX.income);
    }
  }

  function applyArmy(army, fx) {
    if (!army) return;
    if (fx.fatigue) army.fatigue = ZS.clamp(army.fatigue + fx.fatigue, 0, 1);
    if (fx.armyLossPct) {
      ZS.Army.takeLosses(army, Math.max(1, Math.round(army.troops * fx.armyLossPct)));
    }
  }

  function applyGeneral(camp, general, fx) {
    if (!general) return;
    if (fx.generalLoyalty) {
      if (ZS.General && ZS.General.adjustLoyalty) {
        ZS.General.adjustLoyalty(general, fx.generalLoyalty);
      } else {
        general.loyalty = ZS.clamp((general.loyalty | 0) + fx.generalLoyalty, 0, 100);
      }
    }
    if (fx.generalXp) {
      if (ZS.General && ZS.General.gainXp) ZS.General.gainXp(general, fx.generalXp);
      else general.xp = Math.max(0, (general.xp | 0) + fx.generalXp);
    }
    if (fx.heal && ZS.General && ZS.General.advanceInjury) {
      ZS.General.advanceInjury(general, fx.heal);
    }
    if (fx.injuryTurns && general.injury && general.injury !== "none") {
      general.injuryT = Math.max(1, (general.injuryT | 0) + fx.injuryTurns);
    }
  }

  function choose(camp, index) {
    const p = pending(camp);
    if (!p) return { ok: false, err: "campaign.err.noEvent" };
    const choice = p.event.choices[index];
    if (!choice) return { ok: false, err: "campaign.err.badChoice" };
    if (!canChoose(camp, index)) return { ok: false, err: "campaign.err.cannotAfford" };

    const fx = choice.effects || {};
    const faction = camp.player();
    faction.gold = Math.max(0, faction.gold + (fx.gold || 0));
    faction.food = Math.max(0, faction.food + (fx.food || 0));
    const pr = p.record.provinceId ? camp.prov(p.record.provinceId) : null;
    const army = p.record.armyId ? camp.armies[p.record.armyId] : null;
    const general = p.record.generalId ? camp.generals[p.record.generalId] : null;
    applyProvince(pr, fx);
    applyArmy(army, fx);
    applyGeneral(camp, general, fx);

    camp.eventQueue.shift();
    camp.eventHistory.push(p.event.id);
    if (camp.eventHistory.length > HISTORY_MAX) {
      camp.eventHistory.splice(0, camp.eventHistory.length - HISTORY_MAX);
    }
    camp.note("campaign.log.event", { event: p.event.id, choice: index });
    return {
      ok: true,
      eventId: p.event.id,
      choice: index,
      effects: Object.assign({}, fx),
    };
  }

  function contextName(camp, record) {
    if (!record) return "";
    if (record.provinceId) {
      const pd = ZS.CampaignMap.province(record.provinceId);
      return pd ? ZS.i18n.t(pd.name) : record.provinceId;
    }
    if (record.armyId) {
      const army = camp.armies[record.armyId];
      const pd = army && ZS.CampaignMap.province(army.at);
      return pd ? ZS.i18n.t(pd.name) : record.armyId;
    }
    if (record.generalId) return ZS.Roster.name(record.generalId);
    return "";
  }

  ZS.CampaignEvents = {
    EVERY,
    def,
    targets,
    queueWorld,
    pending,
    canChoose,
    choose,
    contextName,
  };
})();
