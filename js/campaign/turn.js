/* ZS.Turn — the four phases of a season (docs/SANGUO-DESIGN.md §4.1).

     1. Player phase   — orders, unlimited thinking time
     2. Resolve phase  — marches move, then battles fire
     3. AI phase       — each AI faction issues its own orders
     4. World phase    — income, food, loyalty drift, season advance

   Note the order the design chose: the AI issues its orders *after* the
   resolve, so an AI march is already a token on the map before it lands. The
   player sees it coming for a season. That is why the AI phase is third and
   not second.

   **Administration is immediate; movement is not.** Recruit, Develop, Assign
   and Rest are local acts — the gold leaves the treasury and the effect lands
   the moment the order is given, so the player phase gives feedback while you
   are still thinking. March is the only order that resolves over time, because
   distance is the whole point of it. (Implementation decision — the design
   pins the phases, not which orders are instantaneous.)

   Everything here is synchronous and side-effect-free outside the campaign
   object it is handed. Autosaving is the caller's job: `end()` returns a
   report, and the CAMPAIGN view writes the autosave at the boundary the
   design asks for (§5.4 — end of a World phase, never mid-resolve). */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  /* Food eaten per 1,000 garrison per season. A garrison is cheaper than a
     field army — it is at home and it is not marching. */
  const GARRISON_FOOD = 10;
  const STARVE_ATTRITION = 0.08; // fraction of every stack lost per starving season
  const UNREST_DECAY = 1;

  function ok(extra) {
    return Object.assign({ ok: true }, extra || null);
  }
  function fail(key, params) {
    return { ok: false, err: key, params: params || null };
  }

  const Turn = {
    GARRISON_FOOD,

    /* ---- player-phase orders ------------------------------------------ */

    /* Recruit into the province garrison. Men join the garrison, not a field
       army — raising a stack is a separate act, so "who is defending this
       city" and "what am I marching with" stay different questions. */
    recruit(camp, provinceId, men) {
      const pr = camp.prov(provinceId);
      if (!pr) return fail("campaign.err.noProvince");
      if (pr.owner !== camp.playerFactionId) return fail("campaign.err.notYours");
      const want = Math.max(0, men | 0);
      if (want <= 0) return fail("campaign.err.noMen");
      const cap = camp.recruitCap(provinceId);
      if (want > cap) return fail("campaign.err.overCap", { cap });
      const f = camp.player();
      const price = ZS.Army.cost(splitByComp(want, ZS.Army.defaultComp()));
      if (f.gold < price.gold) return fail("campaign.err.noGold", { need: price.gold });
      if (f.food < price.food) return fail("campaign.err.noFood", { need: price.food });
      f.gold -= price.gold;
      f.food -= price.food;
      pr.garrison += want;
      pr.loyalty = ZS.clamp(pr.loyalty - Math.ceil(want / 400), 0, 100);
      return ok({ men: want, cost: price });
    },

    /* Take men out of a garrison and put them in the field as a new stack, or
       into one already standing there. */
    raise(camp, provinceId, men, intoArmyId) {
      const pr = camp.prov(provinceId);
      if (!pr) return fail("campaign.err.noProvince");
      if (pr.owner !== camp.playerFactionId) return fail("campaign.err.notYours");
      const want = Math.max(0, men | 0);
      if (want <= 0) return fail("campaign.err.noMen");
      const spare = pr.garrison - ZS.Campaign.GARRISON_MIN;
      if (want > spare) return fail("campaign.err.garrisonFloor", { spare: Math.max(0, spare) });
      pr.garrison -= want;
      if (intoArmyId) {
        const a = camp.armies[intoArmyId];
        if (!a || a.at !== provinceId || a.faction !== camp.playerFactionId) {
          pr.garrison += want;
          return fail("campaign.err.noArmy");
        }
        ZS.Army.reinforce(a, splitByComp(want, a.comp));
        return ok({ army: a });
      }
      const a = camp.raiseArmy(camp.playerFactionId, provinceId, want);
      a.since = camp.turn;
      return ok({ army: a });
    },

    develop(camp, provinceId, track) {
      const pr = camp.prov(provinceId);
      if (!pr) return fail("campaign.err.noProvince");
      if (pr.owner !== camp.playerFactionId) return fail("campaign.err.notYours");
      const cost = camp.devCost(provinceId, track);
      if (!isFinite(cost)) return fail("campaign.err.devMax");
      const f = camp.player();
      if (f.gold < cost) return fail("campaign.err.noGold", { need: cost });
      f.gold -= cost;
      pr.dev[track] += 1;
      pr.loyalty = ZS.clamp(pr.loyalty + 3, 0, 100);
      return ok({ track, level: pr.dev[track], cost });
    },

    /* Order a stack to a province. The route avoids hostile ground it does not
       have to enter — the destination itself is always allowed, because
       marching into it is usually the point. */
    march(camp, armyId, destId) {
      const a = camp.armies[armyId];
      if (!a) return fail("campaign.err.noArmy");
      if (a.faction !== camp.playerFactionId) return fail("campaign.err.notYours");
      if (!camp.prov(destId)) return fail("campaign.err.noProvince");
      if (destId === a.at && !ZS.Army.isMarching(a)) return fail("campaign.err.alreadyThere");
      const mine = camp.playerFactionId;
      const path = ZS.CampaignMap.path(a.at, destId, (id) => {
        const o = camp.owner(id);
        return o !== null && o !== mine;
      });
      if (!path) return fail("campaign.err.noRoute");
      ZS.Army.setPath(a, path);
      return ok({ path, turns: ZS.CampaignMap.pathCost(path) });
    },

    halt(camp, armyId) {
      const a = camp.armies[armyId];
      if (!a) return fail("campaign.err.noArmy");
      if (a.faction !== camp.playerFactionId) return fail("campaign.err.notYours");
      ZS.Army.halt(a);
      return ok();
    },

    disband(camp, armyId) {
      const a = camp.armies[armyId];
      if (!a) return fail("campaign.err.noArmy");
      if (a.faction !== camp.playerFactionId) return fail("campaign.err.notYours");
      if (ZS.Army.isMarching(a)) return fail("campaign.err.marching");
      camp.disbandArmy(armyId);
      return ok();
    },

    /* Move a general between the roster, an army and a governor's seat. All
       three are the same act — `to` is `{ army: id }`, `{ govern: id }` or
       null for "back to the roster" (§4.1's Assign). */
    assign(camp, generalId, to) {
      const f = camp.player();
      if (!f) return fail("campaign.err.noFaction");
      if (!generalId) return fail("campaign.err.noGeneral");
      if (f.generals.indexOf(generalId) < 0) return fail("campaign.err.notOurs");
      /* Whatever they were doing, they stop doing it first. */
      for (const a of camp.armiesOf(f.id)) ZS.Army.unassign(a, generalId);
      for (const id of camp.provincesOf(f.id)) {
        if (camp.prov(id).governor === generalId) camp.prov(id).governor = null;
      }
      if (!to) return ok({ where: null });
      if (to.army) {
        const a = camp.armies[to.army];
        if (!a || a.faction !== f.id) return fail("campaign.err.noArmy");
        if (!ZS.Army.assign(a, generalId)) return fail("campaign.err.armyFull");
        return ok({ where: "army" });
      }
      if (to.govern) {
        const pr = camp.prov(to.govern);
        if (!pr || pr.owner !== f.id) return fail("campaign.err.notYours");
        pr.governor = generalId;
        return ok({ where: "govern" });
      }
      return fail("campaign.err.badOrder");
    },

    /* ---- the turn ------------------------------------------------------ */

    /* Runs phases 2-4 and advances the clock. Returns a report the UI reads;
       the campaign's own `log` keeps the same events for the record. */
    end(camp) {
      if (camp.over) return { over: camp.over, battles: [], turn: camp.turn };
      const report = { turn: camp.turn, battles: [], captured: [], starved: [], over: null };
      this.resolve(camp, report);
      this.ai(camp);
      this.world(camp, report);
      camp.turn += 1;
      camp.recount();
      report.over = camp.over;
      return report;
    },

    /* Phase 2. Every stack takes one leg of its march, then every province
       that now holds two hostile flags settles it. */
    resolve(camp, report) {
      for (const id in camp.armies) {
        const a = camp.armies[id];
        const arrived = ZS.Army.advance(a, ZS.CampaignMap);
        if (arrived) a.since = camp.turn;
      }
      this.fight(camp, report);
      this.prune(camp);
    },

    /* Battles. Two passes, in this order: armies meeting armies, then armies
       standing on ground they do not own. A stack that has just beaten a field
       army does not also storm the walls in the same season — taking the
       province is next turn's work, which is what gives a defender time to
       march relief. */
    fight(camp, report) {
      const byProvince = new Map();
      for (const id in camp.armies) {
        const a = camp.armies[id];
        if (ZS.Army.isMarching(a) || !a.at || a.troops <= 0) continue;
        if (!byProvince.has(a.at)) byProvince.set(a.at, []);
        byProvince.get(a.at).push(a);
      }

      for (const [pid, here] of byProvince) {
        const factions = new Set(here.map((a) => a.faction));
        if (factions.size < 2) continue;
        /* The defender is whoever owns the ground; failing that, whoever was
           standing here first. */
        const owner = camp.owner(pid);
        let defFaction = factions.has(owner) ? owner : null;
        if (!defFaction) {
          let oldest = Infinity;
          for (const a of here) {
            if (a.since < oldest) {
              oldest = a.since;
              defFaction = a.faction;
            }
          }
        }
        const defenders = here.filter((a) => a.faction === defFaction);
        const attackers = here.filter((a) => a.faction !== defFaction);
        const res = ZS.AutoResolve.field(camp, attackers, defenders, pid);
        report.battles.push(res);
        camp.note("campaign.log.battle", {
          province: pid,
          winner: res.winner,
          dead: totalLosses(res.losses),
        });
        if (res.territory === "attacker_retreats") retreat(camp, attackers);
        else retreat(camp, defenders);
      }

      /* Assaults: a stack sitting on hostile ground with nobody left to stop
         it. Re-derived after the field battles so a beaten stack is not also
         credited with a siege. */
      for (const id in camp.armies) {
        const a = camp.armies[id];
        if (ZS.Army.isMarching(a) || !a.at || a.troops <= 0) continue;
        const owner = camp.owner(a.at);
        if (owner === null || owner === a.faction) continue;
        if (hostileArmyAt(camp, a.at, a.faction)) continue;
        const mine = camp.armiesAt(a.at).filter((x) => x.faction === a.faction && x.troops > 0);
        if (!mine.length || mine[0].id !== a.id) continue; // one assault per province
        const res = ZS.AutoResolve.assault(camp, mine, a.at);
        report.battles.push(res);
        if (res.territory === "attacker_takes") {
          const before = owner;
          camp.setOwner(a.at, a.faction);
          report.captured.push({ province: a.at, from: before, to: a.faction });
          camp.note("campaign.log.captured", { province: a.at, faction: a.faction });
        } else {
          camp.note("campaign.log.repulsed", { province: a.at, faction: a.faction });
          retreat(camp, mine);
        }
      }
    },

    /* Stacks that no longer exist. A wiped army leaves the board; a province
       with no garrison and no owner army is not automatically lost — someone
       still has to walk in and take it. */
    prune(camp) {
      for (const id in camp.armies) {
        if (camp.armies[id].troops <= 0) delete camp.armies[id];
      }
    },

    /* Phase 3. Every faction that is not the player plans with the same order
       set the player has (js/campaign/ai.js). */
    ai(camp) {
      if (!ZS.CampaignAI) return;
      for (const fid in camp.factions) {
        const f = camp.factions[fid];
        if (!f.alive || fid === camp.playerFactionId) continue;
        ZS.CampaignAI.plan(camp, fid);
      }
    },

    /* Phase 4. The books close: income in, upkeep out, loyalty drifts toward
       where the province is actually heading, and the season turns. */
    world(camp, report) {
      for (const fid in camp.factions) {
        const f = camp.factions[fid];
        if (!f.alive) continue;
        let gold = 0,
          food = 0,
          upGold = 0,
          upFood = 0;
        for (const pid of camp.provincesOf(fid)) {
          gold += camp.income(pid);
          food += camp.foodYield(pid);
          upFood += Math.ceil((camp.prov(pid).garrison / 1000) * GARRISON_FOOD);
        }
        for (const a of camp.armiesOf(fid)) {
          const u = ZS.Army.upkeep(a);
          upGold += u.gold;
          upFood += u.food;
        }
        f.gold = Math.max(0, f.gold + gold - upGold);
        f.food = f.food + food - upFood;

        if (f.food < 0) {
          /* Starvation. The men leave before they die: every stack sheds a
             fraction and every province loses patience. */
          f.food = 0;
          for (const a of camp.armiesOf(fid)) {
            ZS.Army.takeLosses(a, Math.round(a.troops * STARVE_ATTRITION));
          }
          for (const pid of camp.provincesOf(fid)) {
            const pr = camp.prov(pid);
            pr.loyalty = ZS.clamp(pr.loyalty - 6, 0, 100);
          }
          if (report) report.starved.push(fid);
          camp.note("campaign.log.starving", { faction: fid });
        }
      }

      for (const pid in camp.provinces) {
        const pr = camp.provinces[pid];
        if (!pr.owner) continue;
        const target = camp.loyaltyTarget(pid);
        const d = target - pr.loyalty;
        const step = Math.sign(d) * Math.min(Math.abs(d), ZS.Campaign.LOYALTY_DRIFT);
        pr.loyalty = ZS.clamp(pr.loyalty + step, 0, 100);
        if (pr.unrest > 0) pr.unrest = Math.max(0, pr.unrest - UNREST_DECAY);
      }

      this.prune(camp);
    },
  };

  /* ---- helpers -------------------------------------------------------- */

  function splitByComp(men, comp) {
    const out = {};
    let sum = 0,
      big = ZS.Army.ARMS[0];
    for (const k of ZS.Army.ARMS) {
      out[k] = Math.floor(men * (comp[k] || 0));
      sum += out[k];
      if ((comp[k] || 0) > (comp[big] || 0)) big = k;
    }
    out[big] += men - sum;
    return out;
  }

  function totalLosses(losses) {
    let n = 0;
    for (const k in losses) n += losses[k];
    return n;
  }

  function hostileArmyAt(camp, pid, factionId) {
    for (const a of camp.armiesAt(pid)) {
      if (a.faction !== factionId && a.troops > 0) return true;
    }
    return false;
  }

  /* A beaten stack falls back the way it came. If it has nowhere to fall back
     to — it was standing in its own province, or the road behind it is gone —
     it holds where it is and takes its chances next season. */
  function retreat(camp, armies) {
    for (const a of armies) {
      if (a.troops <= 0) continue;
      ZS.Army.halt(a);
      const back = a.from;
      if (back && back !== a.at && ZS.CampaignMap.isNeighbour(a.at, back)) {
        a.at = back;
        a.since = camp.turn;
      }
      a.fatigue = Math.min(1, a.fatigue + 0.2);
    }
  }

  Turn.splitByComp = splitByComp;
  Turn.retreat = retreat;
  ZS.Turn = Turn;
})();
