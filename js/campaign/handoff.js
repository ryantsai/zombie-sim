/* ZS.Handoff — the campaign <-> real-time battle contract (§4.3).

   This module is deliberately independent of the turn/UI state machine. It
   builds a plain-data context that a caller may hold while ScenarioSanguo owns
   the frame loop, converts the finished scenario back into a BattleResult,
   and applies that result to the exact campaign participants once.

   Three distinctions are important:

     factionId   stable campaign id ("cao_cao"), used by saves/results
     colorSlot   numeric 0-7 figure wash, used only to draw a side
     banner      flag preset key, also presentation only

   Conflating those was harmless in the Liu-v-Cao skirmish (ids 0 and 1) and
   would make a campaign battle draw the wrong colours or return side numbers
   where the campaign expects faction ids.

   `apply()` expects a non-mutating result, such as `resultFromScenario()`.
   The P3 AutoResolve implementation currently mutates armies while computing
   its result; its future P4 caller must use a pure path before passing that
   result here, or it would quite correctly count the losses a second time. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  const OPEN_LAYOUTS = {
    plain: ["broad_plain", "farm_tracks", "low_ridges", "dry_creek"],
    hill: ["twin_ridges", "broken_hills", "long_slope", "saddle_pass"],
    river: ["river_bend", "ford", "split_bank", "island_crossing"],
    wood: ["forest_edge", "woodland_lanes", "three_groves", "logging_road"],
    marsh: ["reed_beds", "marsh_channels", "causeway", "flooded_fields"],
  };
  const TOWN_LAYOUTS = ["crossroads", "market_ward", "river_ward"];
  const FORT_LAYOUTS = ["gatehouse", "walled_city", "citadel"];
  const APPROACHES = ["west", "north", "east", "south"];

  class HandoffError extends Error {
    constructor(code, message) {
      super(message || code);
      this.code = code;
    }
  }

  function mix(h, value) {
    const text = String(value === undefined || value === null ? "" : value);
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h | 0;
  }

  function armyIdList(camp, armies) {
    return resolveArmies(camp, armies).map((a) => a.id);
  }

  /* Public deterministic seed helper. Input order does not matter: participant
     ids are sorted before hashing, while attacker/defender roles remain
     distinct. The setup and order stream are the rest of battle determinism. */
  function seedFor(camp, provinceId, attackers, defenders, salt) {
    let h = 2166136261;
    h = mix(h, camp && camp.seed);
    h = mix(h, camp && camp.turn);
    h = mix(h, provinceId);
    h = mix(h, salt || "field");
    h = mix(h, "attack");
    for (const id of armyIdList(camp, attackers)) h = mix(h, id);
    h = mix(h, "defend");
    for (const id of armyIdList(camp, defenders)) h = mix(h, id);
    h |= 0;
    return h || 0x51a7c3d;
  }

  function resolveArmies(camp, source) {
    const out = [];
    const seen = new Set();
    for (const item of source || []) {
      const a = typeof item === "string" ? camp && camp.armies[item] : item;
      if (!a || !a.id || seen.has(a.id) || a.troops <= 0) continue;
      seen.add(a.id);
      out.push(a);
    }
    out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return out;
  }

  function oneFaction(armies, role) {
    if (!armies.length) throw new HandoffError("handoff_empty_" + role);
    const id = armies[0].faction;
    if (!id) throw new HandoffError("handoff_missing_faction", role + " has no faction");
    for (let i = 1; i < armies.length; i++) {
      if (armies[i].faction !== id) {
        throw new HandoffError("handoff_mixed_faction", role + " contains a coalition");
      }
    }
    return id;
  }

  function factionDef(camp, id) {
    if (camp && typeof camp.factionDef === "function") return camp.factionDef(id);
    return (ZS.data.factions || []).find((f) => f.id === id) || null;
  }

  function colorSlot(camp, factionId) {
    const fd = factionDef(camp, factionId);
    if (fd && Number.isInteger(fd.slot)) return fd.slot;
    let h = 0;
    for (let i = 0; i < String(factionId).length; i++) {
      h = Math.imul(h ^ String(factionId).charCodeAt(i), 31);
    }
    return Math.abs(h) % 8;
  }

  function bannerKey(camp, factionId) {
    const fd = factionDef(camp, factionId);
    return (fd && fd.flag) || null;
  }

  function generalSnapshot(camp, id) {
    const catalogue = ZS.Generals && ZS.Generals.snapshot ? ZS.Generals.snapshot(id) : null;
    const seam = ZS.Roster && ZS.Roster.snapshot ? ZS.Roster.snapshot(id, { camp: camp }) : null;
    if (!catalogue && !seam) return { id };
    /* Catalogue supplies model/portrait/skills; the roster seam supplies any
       future campaign-derived stats and therefore wins on overlapping keys. */
    return Object.assign({}, catalogue || null, seam || null);
  }

  function participantFromArmies(camp, role, armies) {
    const list = resolveArmies(camp, armies);
    const factionId = oneFaction(list, role);
    return {
      role,
      side: -1,
      factionId,
      armyIds: list.map((a) => a.id),
      armies: list.map((a) => ({ id: a.id, troops: Math.max(0, a.troops | 0) })),
      garrison: null,
    };
  }

  function participantFromGarrison(camp, provinceId) {
    const pr = camp && camp.prov(provinceId);
    if (!pr || !pr.owner) throw new HandoffError("handoff_no_garrison_owner");
    return {
      role: "defender",
      side: -1,
      factionId: pr.owner,
      armyIds: [],
      armies: [],
      garrison: {
        provinceId,
        factionId: pr.owner,
        troops: Math.max(0, pr.garrison | 0),
        governor: pr.governor || null,
      },
    };
  }

  function aggregateArmies(armies) {
    const counts = {};
    const keys = (ZS.Army && ZS.Army.ARMS) || ["spear", "dao", "crossbow", "cav"];
    for (const key of keys) counts[key] = 0;
    let total = 0;
    for (const a of armies) {
      const men = ZS.Army.men(a);
      total += Math.max(0, a.troops | 0);
      for (const key of keys) counts[key] += Math.max(0, (men && men[key]) | 0);
    }
    return { total, comp: ratios(counts, total) };
  }

  function aggregateGarrison(garrison) {
    const total = Math.max(0, garrison.troops | 0);
    const comp = ZS.Army.defaultComp();
    return { total, comp: Object.assign({}, comp) };
  }

  function ratios(counts, total) {
    if (total <= 0) return Object.assign({}, ZS.Army.defaultComp());
    const out = {};
    for (const key of ZS.Army.ARMS) out[key] = (counts[key] || 0) / total;
    return out;
  }

  function generalsFor(camp, participant, armies) {
    const ids = [];
    const seen = new Set();
    for (const a of armies) {
      for (const id of a.generals || []) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    }
    if (participant.garrison && participant.garrison.governor) {
      const id = participant.garrison.governor;
      if (!seen.has(id)) ids.push(id);
    }
    return ids.map((id) => generalSnapshot(camp, id));
  }

  function sideSpec(camp, participant, armies) {
    const strength = participant.garrison
      ? aggregateGarrison(participant.garrison)
      : aggregateArmies(armies);
    const cap = (ZS.ScenarioSanguo && ZS.ScenarioSanguo.FIELD_CAP) || Math.max(1, strength.total);
    const onField = Math.min(strength.total, cap);
    return {
      role: participant.role,
      factionId: participant.factionId,
      colorSlot: colorSlot(camp, participant.factionId),
      banner: bannerKey(camp, participant.factionId),
      comp: strength.comp,
      troops: strength.total,
      onField,
      reserve: Math.max(0, strength.total - onField),
      generals: generalsFor(camp, participant, armies),
      armyIds: participant.armyIds.slice(),
      garrison: !!participant.garrison,
    };
  }

  function approachFor(camp, provinceId, attackers, seed) {
    const site = ZS.CampaignMap && ZS.CampaignMap.province(provinceId);
    for (const a of attackers) {
      if (!a.from || a.from === provinceId) continue;
      const source = ZS.CampaignMap.province(a.from);
      if (!site || !source) continue;
      const dx = source.x - site.x;
      const dy = source.y - site.y;
      if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "west" : "east";
      return dy < 0 ? "north" : "south";
    }
    return APPROACHES[(seed >>> 8) % APPROACHES.length];
  }

  function fieldMeta(camp, provinceId, kind, seed, attackers) {
    const pd = ZS.CampaignMap.province(provinceId);
    const pr = camp.prov(provinceId);
    if (!pd || !pr) throw new HandoffError("handoff_no_province", provinceId);
    const biome = pd.biome || "plain";
    const wallTier = ZS.clamp(
      pr.dev && pr.dev.wall !== undefined ? pr.dev.wall | 0 : pd.wall | 0,
      0,
      2,
    );
    let layouts;
    if (kind === "town") layouts = TOWN_LAYOUTS;
    else if (kind === "fort") layouts = FORT_LAYOUTS;
    else layouts = OPEN_LAYOUTS[biome] || OPEN_LAYOUTS.plain;
    const variant = (seed >>> 3) % layouts.length;
    return {
      kind,
      terrain: biome,
      biome,
      layout: layouts[variant],
      variant,
      approach: approachFor(camp, provinceId, attackers, seed),
      season: camp.season | 0,
      wallTier,
      siteSize: pd.size | 0,
      provinceId,
    };
  }

  function orient(camp, attacker, defender) {
    const player = camp.playerFactionId;
    const attackerSide = player && defender.factionId === player ? 1 : 0;
    const defenderSide = 1 - attackerSide;
    attacker.side = attackerSide;
    defender.side = defenderSide;
    return { attackerSide, defenderSide };
  }

  function makeContext(camp, kind, provinceId, attacker, defender, attackArmies, defendArmies) {
    if (attacker.factionId === defender.factionId) {
      throw new HandoffError("handoff_same_faction");
    }
    const salt = kind === "field" ? "field" : "assault";
    const seed = seedFor(camp, provinceId, attackArmies, defendArmies, salt);
    const roles = orient(camp, attacker, defender);
    const mapKind =
      kind === "field" ? "open" : camp.prov(provinceId).dev.wall > 0 ? "fort" : "town";
    const specs = [];
    specs[attacker.side] = sideSpec(camp, attacker, attackArmies);
    specs[defender.side] = sideSpec(camp, defender, defendArmies);
    const field = fieldMeta(camp, provinceId, mapKind, seed, attackArmies);
    field.attackerSide = roles.attackerSide;
    field.defenderSide = roles.defenderSide;
    const context = {
      id: "hsg:" + (seed >>> 0).toString(16) + ":" + provinceId,
      seed,
      kind,
      provinceId,
      attackerSide: roles.attackerSide,
      defenderSide: roles.defenderSide,
      roles,
      participants: { attacker, defender },
      participantArmyIds: {
        attackers: attacker.armyIds.slice(),
        defenders: defender.armyIds.slice(),
      },
      garrisonDefense: defender.garrison ? Object.assign({}, defender.garrison) : null,
      setup: {
        seed,
        attackerSide: roles.attackerSide,
        defenderSide: roles.defenderSide,
        field,
        sides: specs,
        objective: mapKind === "fort" ? "break_through" : "rout",
      },
      applied: null,
    };
    return context;
  }

  function buildField(camp, attackers, defenders, provinceId) {
    const attackArmies = resolveArmies(camp, attackers);
    const defendArmies = resolveArmies(camp, defenders);
    return makeContext(
      camp,
      "field",
      provinceId,
      participantFromArmies(camp, "attacker", attackArmies),
      participantFromArmies(camp, "defender", defendArmies),
      attackArmies,
      defendArmies,
    );
  }

  function buildAssault(camp, attackers, provinceId) {
    const attackArmies = resolveArmies(camp, attackers);
    return makeContext(
      camp,
      "assault",
      provinceId,
      participantFromArmies(camp, "attacker", attackArmies),
      participantFromGarrison(camp, provinceId),
      attackArmies,
      [],
    );
  }

  function canonicalWinner(context, winner) {
    if (winner === "draw" || winner === null || winner === undefined || winner === -1) {
      return "draw";
    }
    if (Number.isInteger(winner)) {
      const side = context.setup.sides[winner];
      if (!side) throw new HandoffError("handoff_bad_winner");
      return side.factionId;
    }
    const id = String(winner);
    if (
      id !== context.participants.attacker.factionId &&
      id !== context.participants.defender.factionId
    ) {
      throw new HandoffError("handoff_bad_winner", id);
    }
    return id;
  }

  function territoryFor(context, winner) {
    if (winner === "draw") return "defender_holds";
    if (winner === context.participants.attacker.factionId) return "attacker_takes";
    return context.kind === "assault" ? "defender_holds" : "attacker_retreats";
  }

  function resultFromScenario(scenario, context) {
    if (!scenario || !scenario.over) throw new HandoffError("handoff_battle_not_over");
    const winner = canonicalWinner(context, scenario.result);
    const sideLosses = [0, 0];
    const losses = {};
    for (let side = 0; side < 2; side++) {
      const dead = Math.max(0, ((scenario.sides[side] && scenario.sides[side].dead) || 0) | 0);
      const factionId = context.setup.sides[side].factionId;
      sideLosses[side] = dead;
      losses[factionId] = (losses[factionId] || 0) + dead;
    }
    const generals = [];
    const seen = new Set();
    for (const g of scenario.generals || []) {
      const id = g.generalId || g.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const reported = ZS.General && ZS.General.OUTCOMES.includes(g.outcome) ? g.outcome : null;
      const unresolved = !reported && (g.dead || g.routFlag);
      generals.push({
        id,
        outcome: reported || (g.dead ? "killed" : "ok"),
        outcomeFinal: !unresolved,
        xpGained: 0,
        killScore: 0,
        battleState: g.dead ? "dead" : g.gone ? "escaped" : g.routFlag ? "routed" : "standing",
      });
    }
    return {
      winner,
      losses,
      sideLosses,
      generals,
      territory: territoryFor(context, winner),
      duelLog: Array.isArray(scenario.duelLog) ? scenario.duelLog.slice() : [],
      kind: context.kind,
      province: context.provinceId,
      contextId: context.id,
      stalemate: !!scenario.stalemate,
      elapsed: Number(scenario.bt) || 0,
    };
  }

  function lossFor(result, participant) {
    if (result.losses && result.losses[participant.factionId] !== undefined) {
      return Math.max(0, result.losses[participant.factionId] | 0);
    }
    if (Array.isArray(result.sideLosses)) {
      return Math.max(0, result.sideLosses[participant.side] | 0);
    }
    if (result.losses && result.losses[participant.side] !== undefined) {
      return Math.max(0, result.losses[participant.side] | 0);
    }
    return 0;
  }

  function bleedArmies(camp, participant, requested) {
    const rows = [];
    for (const snap of participant.armies) {
      const a = camp.armies[snap.id];
      if (!a || a.faction !== participant.factionId || a.troops <= 0) continue;
      rows.push({ a, weight: Math.max(0, snap.troops | 0), applied: 0 });
    }
    let available = 0,
      weight = 0;
    for (const row of rows) {
      available += row.a.troops;
      weight += row.weight;
    }
    const target = Math.min(Math.max(0, requested | 0), available);
    let remaining = target,
      remainingWeight = weight;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let share =
        i === rows.length - 1 || remainingWeight <= 0
          ? remaining
          : Math.round((remaining * row.weight) / remainingWeight);
      share = Math.min(row.a.troops, Math.max(0, share));
      row.applied = ZS.Army.takeLosses(row.a, share);
      remaining -= row.applied;
      remainingWeight -= row.weight;
    }
    /* A stack can have changed while the battle view was open. If an earlier
       proportional share hit its current cap, finish only from the remaining
       exact participants; never spill into an unrelated army. */
    if (remaining > 0) {
      for (const row of rows) {
        if (remaining <= 0) break;
        const got = ZS.Army.takeLosses(row.a, Math.min(remaining, row.a.troops));
        row.applied += got;
        remaining -= got;
      }
    }
    const byArmy = {};
    let applied = 0;
    for (const row of rows) {
      byArmy[row.a.id] = row.applied;
      applied += row.applied;
    }
    return { requested, applied, byArmy, clamped: applied !== requested };
  }

  function bleedGarrison(camp, participant, requested) {
    const g = participant.garrison;
    const pr = g && camp.prov(g.provinceId);
    if (!g || !pr || pr.owner !== g.factionId) {
      return { requested, applied: 0, provinceId: g && g.provinceId, clamped: requested > 0 };
    }
    const applied = Math.min(Math.max(0, requested | 0), Math.max(0, pr.garrison | 0));
    pr.garrison -= applied;
    return { requested, applied, provinceId: g.provinceId, clamped: applied !== requested };
  }

  function retreatParticipant(camp, participant) {
    const moved = [];
    for (const id of participant.armyIds) {
      const a = camp.armies[id];
      if (!a || a.faction !== participant.factionId || a.troops <= 0) continue;
      ZS.Army.halt(a);
      const from = a.at;
      const back = a.from;
      if (back && back !== a.at && ZS.CampaignMap.isNeighbour(a.at, back)) {
        a.at = back;
        a.since = camp.turn;
      }
      a.fatigue = Math.min(1, a.fatigue + 0.2);
      moved.push({ id, from, to: a.at });
    }
    return moved;
  }

  function occupyAssault(camp, context) {
    const attacker = context.participants.attacker;
    const defender = context.participants.defender;
    const pr = camp.prov(context.provinceId);
    if (!pr) return { applied: false, reason: "missing_province", men: 0 };
    if (pr.owner === attacker.factionId) return { applied: false, reason: "already_owned", men: 0 };
    if (pr.owner !== defender.factionId) return { applied: false, reason: "owner_changed", men: 0 };
    const candidates = [];
    for (const id of attacker.armyIds) {
      const a = camp.armies[id];
      if (a && a.faction === attacker.factionId && a.at === context.provinceId && a.troops > 0) {
        candidates.push(a);
      }
    }
    candidates.sort((a, b) => b.troops - a.troops || String(a.id).localeCompare(String(b.id)));
    if (!candidates.length) return { applied: false, reason: "no_occupier", men: 0 };
    const before = candidates[0].troops;
    const men = camp.occupy(context.provinceId, candidates[0]);
    return {
      applied: camp.owner(context.provinceId) === attacker.factionId,
      reason: null,
      men,
      armyId: candidates[0].id,
      armyLoss: before - candidates[0].troops,
    };
  }

  function appliedLedger(camp) {
    if (!camp.__handoffApplied) {
      Object.defineProperty(camp, "__handoffApplied", {
        value: new Map(),
        configurable: true,
      });
    }
    return camp.__handoffApplied;
  }

  function generalSide(context, id) {
    for (let side = 0; side < context.setup.sides.length; side++) {
      for (const g of context.setup.sides[side].generals || []) {
        if (g && g.id === id) return side;
      }
    }
    return -1;
  }

  function enemyZhi(context, side) {
    let best = 60;
    const enemy = context.setup.sides[1 - side];
    for (const g of (enemy && enemy.generals) || []) {
      if (typeof g.zhi === "number" && g.zhi > best) best = g.zhi;
    }
    return best;
  }

  function injuryTurns(context, id) {
    return 2 + ((mix(context.seed, id + ":injury") >>> 0) % 3);
  }

  function applyGeneralResults(camp, context, result, winner) {
    const out = [];
    if (!ZS.General || !camp.generals || typeof camp.applyGeneralResult !== "function") {
      return out;
    }
    const seen = new Set();
    for (const entry of result.generals || []) {
      const id = entry && entry.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const side = generalSide(context, id);
      if (side < 0) {
        out.push({ ok: false, err: "general_not_participant", id });
        continue;
      }
      const record = camp.generals[id];
      if (!record) {
        out.push({ ok: false, err: "unknown_general", id });
        continue;
      }
      const ownFaction = context.setup.sides[side].factionId;
      const opposingFaction = context.setup.sides[1 - side].factionId;
      const outcomeReport =
        entry.outcomeFinal === false ? Object.assign({}, entry, { outcome: null }) : entry;
      const resolution = ZS.General.resolveOutcome(record, outcomeReport, {
        seed: context.seed,
        enemyZhi: enemyZhi(context, side),
      });
      const loyaltyDelta =
        typeof entry.loyaltyDelta === "number"
          ? entry.loyaltyDelta
          : winner === "draw"
            ? 0
            : winner === ownFaction
              ? 1
              : -4;
      const applied = camp.applyGeneralResult(id, {
        outcome: resolution.outcome,
        xpGained: entry.xpGained,
        injury: entry.injury,
        injuryT: entry.injuryT || injuryTurns(context, id),
        captor: winner !== "draw" && winner !== ownFaction ? winner : opposingFaction,
        loyaltyDelta,
      });
      out.push(
        Object.assign({}, applied, {
          reported: entry.outcome || null,
          resolved: resolution.outcome,
          resolution: resolution.reason,
          roll: resolution.roll,
          chance: resolution.chance,
          killScore: Math.max(0, entry.killScore | 0),
        }),
      );
    }
    return out;
  }

  function apply(camp, context, result) {
    if (!camp || !context || !result) throw new HandoffError("handoff_bad_apply");
    if (context.applied) return context.applied;
    const ledger = appliedLedger(camp);
    if (ledger.has(context.id)) {
      context.applied = ledger.get(context.id);
      return context.applied;
    }

    const winner = canonicalWinner(context, result.winner);
    const territory = territoryFor(context, winner);
    const attacker = context.participants.attacker;
    const defender = context.participants.defender;
    const receipt = {
      contextId: context.id,
      winner,
      territory,
      losses: {},
      generals: [],
      retreats: [],
      occupation: null,
    };

    const attackLoss = lossFor(result, attacker);
    const defendLoss = lossFor(result, defender);
    receipt.losses[attacker.factionId] = bleedArmies(camp, attacker, attackLoss);
    receipt.losses[defender.factionId] = defender.garrison
      ? bleedGarrison(camp, defender, defendLoss)
      : bleedArmies(camp, defender, defendLoss);
    receipt.generals = applyGeneralResults(camp, context, result, winner);

    if (context.kind === "assault") {
      if (winner === attacker.factionId) receipt.occupation = occupyAssault(camp, context);
      else if (winner === defender.factionId) receipt.retreats = retreatParticipant(camp, attacker);
    } else if (winner === attacker.factionId) {
      receipt.retreats = retreatParticipant(camp, defender);
    } else if (winner === defender.factionId) {
      receipt.retreats = retreatParticipant(camp, attacker);
    }

    if (typeof camp.recount === "function") camp.recount();
    context.applied = receipt;
    ledger.set(context.id, receipt);
    return receipt;
  }

  ZS.HandoffError = HandoffError;
  ZS.Handoff = {
    seedFor,
    seed: seedFor,
    buildField,
    buildAssault,
    resultFromScenario,
    apply,
  };
})();
