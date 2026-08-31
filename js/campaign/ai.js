/* ZS.CampaignAI — the AI faction planner (docs/SANGUO-DESIGN.md §4.1, §9).

   v1 is greedy heuristics on purpose. The design files a real planner under
   P6; what P3 needs is that the other twenty warlords are not statues — that
   armies march, provinces change hands, and the board the player wakes up to
   has moved.

   It runs the **same order set the player has** (§4.1's player phase list):
   recruit, raise, march, develop, assign. It does not get extra income, see
   through fog it should not, or move twice. The only thing it is allowed that
   the player is not is speed — it decides in a millisecond.

   Deterministic: the tie-break RNG is seeded from (campaign seed, turn,
   faction), so replaying a campaign from a save gives the same AI turn. No
   bare Math.random() (§3 constraint 6).

   Personality begins with `temper` from data/factions.js and is refined by
   ZS.CampaignDoctrine when that content module is loaded. Doctrines are
   decision weights, never bonuses: every faction sees the same public board
   and issues the same legal orders, but values reserves, mass, development,
   and visible terrain differently. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  /* Strength ratio the AI wants before it attacks. */
  const NERVE = { bold: 1.1, steady: 1.35, wary: 1.8 };
  /* Gold an AI without a loaded doctrine is willing to hold rather than spend. */
  const RESERVE = 150;
  const MIN_FIELD_ARMY = 800;
  const PROVINCES_PER_ARMY = 3;
  /* What a stack is trying to grow to before it is worth marching anywhere.
     A walled size-3 city holds ~2,400 men, which a `steady` warlord will not
     touch under ~2,900 of strength — so a warlord who splits every levy into a
     fresh column never has enough anywhere and the whole map freezes. This is
     the number that makes a winning faction compound. */
  const MASS_TARGET = 2200;
  /* A stack this tired stays where it is and recovers (fatigue sheds 0.25 a
     season). Marching a spent column into a fight is how a faction loses its
     field army for nothing. */
  const RESTING = 0.5;
  /* Public-board consolidation weights. Without a reason to close a pocket or
     finish a failing rival, every border commandery is roughly equivalent and
     realms trade the same fringe ground forever. */
  const FINISH_PRESSURE = 5000;
  const SUPPORT_BONUS = 100;
  const CAPITAL_BONUS = 1500;

  function doctrineFor(factionId) {
    const D = ZS.CampaignDoctrine;
    return D && typeof D.forFaction === "function" ? D.forFaction(factionId) : null;
  }

  function knob(doctrine, name, fallback) {
    const value = doctrine && doctrine[name];
    return typeof value === "number" && isFinite(value) ? value : fallback;
  }

  function developmentOrder(doctrine, short, atFrontier) {
    const preferred = doctrine && doctrine.development;
    if (!Array.isArray(preferred)) {
      return short
        ? ["food", "income", "wall", "recruit"]
        : atFrontier
          ? ["wall", "recruit", "income", "food"]
          : ["income", "food", "recruit", "wall"];
    }
    if (!short || preferred[0] === "food") return preferred;
    /* A doctrine is a preference, not permission to ignore starvation. */
    return ["food"].concat(preferred.filter((track) => track !== "food"));
  }

  function seedFor(camp, factionId) {
    let h = (camp.seed | 0) ^ Math.imul(camp.turn, 0x9e3779b1);
    for (let i = 0; i < factionId.length; i++) {
      h = Math.imul(h ^ factionId.charCodeAt(i), 0x85ebca6b) | 0;
    }
    return h | 0;
  }

  /* What it costs to take a province, in men-equivalent. Garrison behind a
     wall is worth more than garrison in the open — the same WALL_BONUS the
     auto-resolve model uses, so the AI is estimating the fight it will
     actually get rather than a different one. */
  function defenceOf(camp, pid) {
    const pr = camp.prov(pid);
    if (!pr) return Infinity;
    const wall = ZS.AutoResolve.WALL_BONUS[ZS.clamp(pr.dev.wall | 0, 0, 2)];
    let d = pr.garrison * ZS.AutoResolve.GARRISON_QUALITY * wall;
    for (const a of camp.armiesAt(pid)) {
      if (a.faction !== pr.owner) continue;
      d += ZS.Army.strength(a);
    }
    return d;
  }

  /* Own provinces that touch someone else's. Where the money and the men go. */
  function frontier(camp, factionId) {
    const out = [];
    for (const pid of camp.provincesOf(factionId)) {
      for (const n of ZS.CampaignMap.neighbours(pid)) {
        if (camp.owner(n.id) !== factionId) {
          out.push(pid);
          break;
        }
      }
    }
    return out;
  }

  function targetScore(pd, pr, defence, routeCost, doctrine, jitter, strategic) {
    if (!pd) return -Infinity;
    const target = doctrine && doctrine.target;
    if (!target) {
      return pd.size * 100 - defence * 0.05 - routeCost * 30 + (jitter || 0) + (strategic || 0);
    }
    const biome = (target.biome && target.biome[pd.biome]) || 0;
    const wall = pr && pr.dev ? pr.dev.wall | 0 : pd.wall | 0;
    return (
      pd.size * knob(target, "size", 100) -
      defence * knob(target, "defence", 0.05) -
      routeCost * knob(target, "route", 30) +
      wall * knob(target, "wall", 0) +
      (pd.port ? knob(target, "port", 0) : 0) +
      biome +
      (jitter || 0) +
      (strategic || 0)
    );
  }

  function strategicScore(camp, factionId, ownerId, provinceId) {
    if (!ownerId || ownerId === factionId) return 0;
    const enemyLands = Math.max(1, camp.provincesOf(ownerId).length);
    let score = FINISH_PRESSURE / enemyLands;
    /* A founding seat remains strategically decisive even after a third
       house has occupied it. Scoring only the current owner's own capital
       made the late game wander around obsolete fringe targets while the
       mandate's remaining rival seats were ignored. */
    const rivalSeats =
      ZS.CampaignVictory && ZS.CampaignVictory.rivalCapitalIds
        ? ZS.CampaignVictory.rivalCapitalIds(camp, factionId)
        : [];
    if (rivalSeats.indexOf(provinceId) >= 0) score += CAPITAL_BONUS;
    let support = 0;
    for (const neighbour of ZS.CampaignMap.neighbours(provinceId)) {
      if (camp.owner(neighbour.id) === factionId) support++;
    }
    if (support > 1) score += (support - 1) * SUPPORT_BONUS;
    return score;
  }

  const CampaignAI = {
    NERVE,

    plan(camp, factionId) {
      const f = camp.faction(factionId);
      const fd = camp.factionDef(factionId);
      if (!f || !f.alive) return;
      const rng = ZS.rng32(seedFor(camp, factionId));
      const doctrine = doctrineFor(factionId);
      const nerve = knob(doctrine, "nerve", NERVE[(fd && fd.temper) || "steady"] || NERVE.steady);

      this.economy(camp, factionId, f, rng, doctrine);
      this.forces(camp, factionId, f, rng, doctrine);
      this.movement(camp, factionId, nerve, rng, doctrine);
    },

    /* Spend on the ground you are going to have to hold. Development first —
       it compounds — then men, and only from what is left. */
    economy(camp, factionId, f, rng, doctrine) {
      doctrine = doctrine || doctrineFor(factionId);
      const reserve = knob(doctrine, "reserveGold", RESERVE);
      const front = frontier(camp, factionId);
      const owned = camp.provincesOf(factionId);
      if (!owned.length) return;

      /* One development a season, at most. Prefer food when short, income
         otherwise, and walls on the frontier. */
      if (f.gold > reserve + 120) {
        const short = f.food < 600;
        const pool = front.length ? front : owned;
        const pid = pool[Math.floor(rng() * pool.length) % pool.length];
        const pr = camp.prov(pid);
        const order = developmentOrder(doctrine, short, front.indexOf(pid) >= 0);
        for (const track of order) {
          const cost = camp.devCost(pid, track);
          if (isFinite(cost) && f.gold - cost >= reserve) {
            f.gold -= cost;
            pr.dev[track] += 1;
            pr.loyalty = ZS.clamp(pr.loyalty + 3, 0, 100);
            break;
          }
        }
      }

      /* Recruit into whichever frontier province is thinnest. */
      if (f.gold > reserve + 200 && f.food > 400) {
        const pool = front.length ? front : owned;
        let target = null,
          thin = Infinity;
        for (const pid of pool) {
          const g = camp.prov(pid).garrison;
          if (g < thin) {
            thin = g;
            target = pid;
          }
        }
        if (target) {
          const cap = camp.recruitCap(target);
          let want = Math.min(cap, 700);
          while (want > 0) {
            const price = ZS.Army.cost(ZS.Turn.splitByComp(want, ZS.Army.defaultComp()));
            if (f.gold - price.gold >= reserve && f.food - price.food >= 200) {
              f.gold -= price.gold;
              f.food -= price.food;
              camp.prov(target).garrison += want;
              break;
            }
            want -= 100;
          }
        }
      }
    },

    /* Turn surplus garrison into field armies — and, first, into *bigger*
       field armies. A warlord with everything behind walls never takes
       anything, but one with five under-strength columns takes nothing either. */
    forces(camp, factionId, f, rng, doctrine) {
      doctrine = doctrine || doctrineFor(factionId);
      const massTarget = knob(doctrine, "massTarget", MASS_TARGET);
      const armies = camp.armiesOf(factionId);
      const owned = camp.provincesOf(factionId);
      if (!owned.length) return;

      /* Top up a stack standing at home before raising another one. This is
         the AI using the player's own "raise into an existing army" order, and
         it is what lets a faction mass rather than sprinkle. */
      const front = frontier(camp, factionId);
      for (const a of armies) {
        if (ZS.Army.isMarching(a) || a.troops >= massTarget) continue;
        const pr = camp.prov(a.at);
        if (!pr || pr.owner !== factionId) continue;
        /* Only genuine surplus goes to the field. A province has to keep the
           garrison it takes to hold it, which in a city this stack has just
           stormed is exactly the men it left there — otherwise the column
           occupies, immediately drains its own occupation force back, and
           marches on, which is the chaining this was supposed to stop. */
        /* A province on the frontier keeps twice its holding garrison: those
           men are already doing a job, and stripping the border to build the
           column that defends the border is how every province ends up at its
           floor and every marginal attack starts succeeding. */
        const keep = camp.occupationCost(a.at) * (front.indexOf(a.at) >= 0 ? 2 : 1);
        const floor = Math.max(ZS.Campaign.GARRISON_MIN, keep);
        const spare = pr.garrison - floor;
        if (spare < 300) continue;
        const take = Math.min(spare, massTarget - a.troops);
        pr.garrison -= take;
        ZS.Army.reinforce(a, ZS.Turn.splitByComp(take, a.comp));
      }

      /* Expansion should fund stronger hosts, not one under-strength token in
         every commandery. Existing armies are never deleted; this only limits
         how quickly surplus garrisons are split into new columns. */
      const armyLimit = Math.max(1, Math.ceil(owned.length / PROVINCES_PER_ARMY));
      if (armies.length >= armyLimit) return;

      let best = null,
        most = 0;
      for (const pid of owned) {
        const spare = camp.prov(pid).garrison - ZS.Campaign.GARRISON_MIN * 2;
        if (spare > most) {
          most = spare;
          best = pid;
        }
      }
      if (!best || most < MIN_FIELD_ARMY) return;
      const take = Math.min(most, MIN_FIELD_ARMY + Math.floor(rng() * 900));
      camp.prov(best).garrison -= take;
      const a = camp.raiseArmy(factionId, best, take);
      if (a) {
        a.since = camp.turn;
        /* Officers who are not already leading a stack or minding a province
           ride with it — the same rule the opening position uses. */
        camp.staffArmy(a, camp.factionDef(factionId));
      }
    },

    /* Where the stacks go. One decision per idle army: take the cheapest
       neighbouring prize it can afford, otherwise reinforce the weakest
       frontier it owns, otherwise sit. */
    movement(camp, factionId, nerve, rng, doctrine) {
      doctrine = doctrine || doctrineFor(factionId);
      /* A realm that has survived into the multi-front late game can accept
         closer odds than a one-city house. This is not a combat bonus: it
         only stops a dominant AI from guarding every border forever while
         the campaign waits decades for one risk-free attack. */
      const realmSize = camp.provincesOf(factionId).length;
      const momentum = ZS.clamp((realmSize - 6) / 48, 0, 0.48);
      const attackNerve = nerve * (1 - momentum);
      for (const a of camp.armiesOf(factionId)) {
        if (ZS.Army.isMarching(a) || a.troops <= 0) continue;
        /* Spent columns rest. Fatigue sheds a quarter per quiet season, so
           this is two seasons at most, and it stops a faction from feeding a
           worn-out stack into the next city. */
        if (a.fatigue > RESTING) continue;
        const strength = ZS.Army.strength(a);

        let prize = null,
          prizeScore = -Infinity;
        for (const n of ZS.CampaignMap.neighbours(a.at)) {
          const owner = camp.owner(n.id);
          if (owner === factionId) continue;
          const def = defenceOf(camp, n.id);
          if (strength < def * attackNerve) continue;
          const pd = ZS.CampaignMap.province(n.id);
          /* Worth = what the province is, discounted by what it costs to get
             there and how hard it will be. A tiny nudge from the RNG breaks
             ties without making the AI flighty. */
          const score = targetScore(
            pd,
            camp.prov(n.id),
            def,
            n.cost,
            doctrine,
            rng() * 20,
            strategicScore(camp, factionId, owner, n.id),
          );
          if (score > prizeScore) {
            prizeScore = score;
            prize = n.id;
          }
        }
        if (prize) {
          const path = ZS.CampaignMap.path(a.at, prize, (id) => {
            const o = camp.owner(id);
            return o !== null && o !== factionId;
          });
          if (path) {
            ZS.Army.setPath(a, path);
            continue;
          }
        }

        /* Nothing worth taking. Stand on the thinnest frontier instead. */
        const front = frontier(camp, factionId);
        if (!front.length) continue;
        let target = null,
          thin = Infinity;
        for (const pid of front) {
          const d = defenceOf(camp, pid);
          if (d < thin) {
            thin = d;
            target = pid;
          }
        }
        if (target && target !== a.at) {
          const path = ZS.CampaignMap.path(a.at, target, (id) => {
            const o = camp.owner(id);
            return o !== null && o !== factionId;
          });
          if (path) ZS.Army.setPath(a, path);
        }
      }
    },
  };

  CampaignAI.MASS_TARGET = MASS_TARGET;
  CampaignAI.RESERVE = RESERVE;
  CampaignAI.PROVINCES_PER_ARMY = PROVINCES_PER_ARMY;
  CampaignAI.defenceOf = defenceOf;
  CampaignAI.frontier = frontier;
  CampaignAI.doctrineFor = doctrineFor;
  CampaignAI.targetScore = targetScore;
  CampaignAI.strategicScore = strategicScore;
  ZS.CampaignAI = CampaignAI;
})();
