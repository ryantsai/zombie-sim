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

   Personality is `temper` from js/campaign/data/factions.js and it is one
   number: how much of an advantage this warlord wants before committing.
   曹操 moves on a hair; 劉表 wants to be sure. */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  /* Strength ratio the AI wants before it attacks. */
  const NERVE = { bold: 1.1, steady: 1.35, wary: 1.8 };
  /* Fraction of the treasury a faction is willing to hold rather than spend. */
  const RESERVE = 150;
  const MIN_FIELD_ARMY = 800;

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

  const CampaignAI = {
    NERVE,

    plan(camp, factionId) {
      const f = camp.faction(factionId);
      const fd = camp.factionDef(factionId);
      if (!f || !f.alive) return;
      const rng = ZS.rng32(seedFor(camp, factionId));
      const nerve = NERVE[(fd && fd.temper) || "steady"] || NERVE.steady;

      this.economy(camp, factionId, f, rng);
      this.forces(camp, factionId, f, rng);
      this.movement(camp, factionId, nerve, rng);
    },

    /* Spend on the ground you are going to have to hold. Development first —
       it compounds — then men, and only from what is left. */
    economy(camp, factionId, f, rng) {
      const front = frontier(camp, factionId);
      const owned = camp.provincesOf(factionId);
      if (!owned.length) return;

      /* One development a season, at most. Prefer food when short, income
         otherwise, and walls on the frontier. */
      if (f.gold > RESERVE + 120) {
        const short = f.food < 600;
        const pool = front.length ? front : owned;
        const pid = pool[Math.floor(rng() * pool.length) % pool.length];
        const pr = camp.prov(pid);
        const order = short
          ? ["food", "income", "wall", "recruit"]
          : front.indexOf(pid) >= 0
            ? ["wall", "recruit", "income", "food"]
            : ["income", "food", "recruit", "wall"];
        for (const track of order) {
          const cost = camp.devCost(pid, track);
          if (isFinite(cost) && f.gold - cost >= RESERVE) {
            f.gold -= cost;
            pr.dev[track] += 1;
            pr.loyalty = ZS.clamp(pr.loyalty + 3, 0, 100);
            break;
          }
        }
      }

      /* Recruit into whichever frontier province is thinnest. */
      if (f.gold > RESERVE + 200 && f.food > 400) {
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
            if (f.gold - price.gold >= RESERVE && f.food - price.food >= 200) {
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

    /* Turn surplus garrison into a field army. A warlord with everything
       behind walls never takes anything. */
    forces(camp, factionId, f, rng) {
      const armies = camp.armiesOf(factionId);
      const owned = camp.provincesOf(factionId);
      if (!owned.length) return;
      if (armies.length >= Math.max(1, Math.ceil(owned.length / 2))) return;

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
        /* The leader rides with the first stack raised, if nobody has them. */
        const fd = camp.factionDef(factionId);
        if (fd && fd.leader && !armies.length) {
          let taken = false;
          for (const other of camp.armiesOf(factionId)) {
            if (other.generals.indexOf(fd.leader) >= 0) taken = true;
          }
          if (!taken) ZS.Army.assign(a, fd.leader);
        }
      }
    },

    /* Where the stacks go. One decision per idle army: take the cheapest
       neighbouring prize it can afford, otherwise reinforce the weakest
       frontier it owns, otherwise sit. */
    movement(camp, factionId, nerve, rng) {
      for (const a of camp.armiesOf(factionId)) {
        if (ZS.Army.isMarching(a) || a.troops <= 0) continue;
        const strength = ZS.Army.strength(a);

        let prize = null,
          prizeScore = -Infinity;
        for (const n of ZS.CampaignMap.neighbours(a.at)) {
          const owner = camp.owner(n.id);
          if (owner === factionId) continue;
          const def = defenceOf(camp, n.id);
          if (strength < def * nerve) continue;
          const pd = ZS.CampaignMap.province(n.id);
          /* Worth = what the province is, discounted by what it costs to get
             there and how hard it will be. A tiny nudge from the RNG breaks
             ties without making the AI flighty. */
          const score = pd.size * 100 - def * 0.05 - n.cost * 30 + rng() * 20;
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

  CampaignAI.defenceOf = defenceOf;
  CampaignAI.frontier = frontier;
  ZS.CampaignAI = CampaignAI;
})();
