/* ZS.AutoResolve — the closed-form battle model (docs/SANGUO-DESIGN.md §4.3).

   Every campaign battle needs an answer. P4 gives the player the choice of
   *playing* one — building a `BattleSetup`, dropping into `ScenarioSanguo` and
   reading a `BattleResult` back. Until then every clash comes through here, and
   even after P4 this stays the path for AI-vs-AI fights and for a player who
   skips.

   So the contract is the one that matters, not the arithmetic: **this returns
   the §4.3 `BattleResult` shape**, the same record a played-out battle returns.
   P4 tunes the numbers so skipping is neither strictly better nor worse; it
   does not have to invent the seam.

   Deterministic. The RNG is seeded from (campaign seed, turn, province), so
   the same campaign state always resolves the same way — the same rule the
   real battle lives under (§3 constraint 6). No bare Math.random(). */
(() => {
  "use strict";
  const ZS = (window.ZS = window.ZS || {});

  /* How much a man behind a wall is worth. Level 0 is an open town, 2 is a
     fortress; P4 turns exactly this into `field.kind` = open / town / fort. */
  const WALL_BONUS = [1.0, 1.25, 1.6];
  const GARRISON_QUALITY = 0.75; // garrison troops are not field troops
  /* Storming a place costs the attacker more than beating the same men in the
     open would. §4.3 gives the defender of a `fort` a morale bonus for the same
     reason; this is the closed-form shadow of it. */
  const ASSAULT_TAX = 0.08;
  /* A routed side has to leave the field decisively. At the old 30% floor, a
     perfectly even fight cost the winner 28% and the loser 30%; both stacks
     returned next season at effectively the same ratio and fought forever.
     The winner curve is unchanged, while a defeated side now loses 48-88%
     from close fight to rout. */
  const LOSER_BASE = 0.48;
  const LOSER_EDGE = 0.4;
  const WINNER_BASE = 0.04;
  const WINNER_CLOSE = 0.14;

  function seedFor(camp, provinceId) {
    let h = (camp.seed | 0) ^ (camp.turn * 0x9e3779b1);
    for (let i = 0; i < provinceId.length; i++) {
      h = (Math.imul(h ^ provinceId.charCodeAt(i), 0x85ebca6b) | 0) >>> 0;
    }
    return h | 0;
  }

  function stackStrength(armies) {
    let s = 0;
    for (const a of armies) s += ZS.Army.strength(a);
    return s;
  }

  function troopTotal(armies) {
    let n = 0;
    for (const a of armies) n += a.troops;
    return n;
  }

  /* Spread `dead` across a set of stacks in proportion to their size, and
     report it per faction the way §4.3's `losses` wants. */
  function bleed(armies, dead, losses) {
    const total = troopTotal(armies);
    if (total <= 0) return;
    let spent = 0;
    for (let i = 0; i < armies.length; i++) {
      const a = armies[i];
      const share = i === armies.length - 1 ? dead - spent : Math.round((dead * a.troops) / total);
      const got = ZS.Army.takeLosses(a, share);
      spent += got;
      losses[a.faction] = (losses[a.faction] || 0) + got;
    }
  }

  /* The one place the odds turn into an outcome. `edge` is the attacker's
     share of total strength, nudged by a small seeded band so a marginal
     advantage is not a certainty. A close fight costs the winner; a lopsided
     one costs the loser. */
  function outcome(attStr, defStr, rng) {
    const total = attStr + defStr;
    const r = total > 0 ? attStr / total : 0.5;
    const edge = ZS.clamp(r + (rng() - 0.5) * 0.12, 0, 1);
    const attackerWins = edge > 0.5;
    const closeness = 1 - Math.abs(edge - 0.5) * 2;
    return {
      attackerWins,
      closeness,
      loserFrac: LOSER_BASE + LOSER_EDGE * (1 - closeness),
      winnerFrac: WINNER_BASE + WINNER_CLOSE * closeness,
    };
  }

  /* Generals share their stack's fate. P5 owns the real death save
     (§4.3: a zhi-vs-zhi roll, permadeath is real); P3 reports them all `ok`
     so nothing silently kills a general the roster branch has not defined yet. */
  function generalReport(armies) {
    const out = [];
    for (const a of armies) {
      for (const gid of a.generals) out.push({ id: gid, outcome: "ok", xpGained: 0, killScore: 0 });
    }
    return out;
  }

  /* Previewing a battle must not touch the campaign. Keep the resolver itself
     single-sourced and run it against these small detached records instead of
     maintaining a second, almost-the-same casualty formula. */
  function copyArmy(a) {
    return Object.assign({}, a, {
      comp: Object.assign({}, a.comp),
      generals: a.generals.slice(),
    });
  }

  function copyArmies(armies) {
    return armies.map(copyArmy);
  }

  function resolveField(camp, attackers, defenders, provinceId) {
    const rng = ZS.rng32(seedFor(camp, provinceId));
    const attStr = stackStrength(attackers);
    const defStr = stackStrength(defenders);
    const o = outcome(attStr, defStr, rng);
    const losses = {};

    const winners = o.attackerWins ? attackers : defenders;
    const losers = o.attackerWins ? defenders : attackers;
    bleed(losers, Math.round(troopTotal(losers) * o.loserFrac), losses);
    bleed(winners, Math.round(troopTotal(winners) * o.winnerFrac), losses);

    return {
      winner: winners.length ? winners[0].faction : "draw",
      losses,
      generals: generalReport(attackers.concat(defenders)),
      territory: o.attackerWins ? "attacker_takes" : "attacker_retreats",
      duelLog: [],
      kind: "field",
      province: provinceId,
    };
  }

  function resolveAssault(camp, attackers, provinceId, pr) {
    const rng = ZS.rng32(seedFor(camp, provinceId) ^ 0x5bf03635);
    const wall = WALL_BONUS[ZS.clamp(pr.dev.wall | 0, 0, WALL_BONUS.length - 1)];
    const attStr = stackStrength(attackers);
    const defStr = Math.round(pr.garrison * GARRISON_QUALITY * wall);
    const o = outcome(attStr, defStr, rng);
    const losses = {};

    if (o.attackerWins) {
      bleed(attackers, Math.round(troopTotal(attackers) * (o.winnerFrac + ASSAULT_TAX)), losses);
      const dead = Math.round(pr.garrison * o.loserFrac);
      pr.garrison = Math.max(0, pr.garrison - dead);
      if (pr.owner) losses[pr.owner] = (losses[pr.owner] || 0) + dead;
    } else {
      bleed(attackers, Math.round(troopTotal(attackers) * o.loserFrac), losses);
      const dead = Math.round(pr.garrison * o.winnerFrac);
      pr.garrison = Math.max(0, pr.garrison - dead);
      if (pr.owner) losses[pr.owner] = (losses[pr.owner] || 0) + dead;
    }

    return {
      winner: o.attackerWins ? attackers[0].faction : pr.owner,
      losses,
      generals: generalReport(attackers),
      territory: o.attackerWins ? "attacker_takes" : "defender_holds",
      duelLog: [],
      kind: "assault",
      province: provinceId,
    };
  }

  const AutoResolve = {
    WALL_BONUS,
    GARRISON_QUALITY,
    ASSAULT_TAX,
    LOSER_BASE,
    LOSER_EDGE,
    WINNER_BASE,
    WINNER_CLOSE,

    /* Two field armies meet. `territory` says what the campaign should do with
       the province afterwards; the caller applies it. */
    field(camp, attackers, defenders, provinceId) {
      return resolveField(camp, attackers, defenders, provinceId);
    },

    /* Same deterministic result, calculated against detached snapshots. The
       caller may inspect it, hand it to ZS.Handoff.apply(), or discard it. */
    previewField(camp, attackers, defenders, provinceId) {
      return resolveField(camp, copyArmies(attackers), copyArmies(defenders), provinceId);
    },

    /* A field army walks into a hostile province with no army in it. The wall
       and the garrison are the defence; taking the province is the point. */
    assault(camp, attackers, provinceId) {
      const pr = camp.prov(provinceId);
      return resolveAssault(camp, attackers, provinceId, pr);
    },

    previewAssault(camp, attackers, provinceId) {
      const src = camp.prov(provinceId);
      const pr = Object.assign({}, src, { dev: Object.assign({}, src.dev) });
      return resolveAssault(camp, copyArmies(attackers), provinceId, pr);
    },
  };

  ZS.AutoResolve = AutoResolve;
})();
