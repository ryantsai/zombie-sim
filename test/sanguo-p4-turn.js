/* P4 turn-transaction verification.

   Run:  node test/sanguo-p4-turn.js
         node test/sanguo-p4-turn.js --headed

   This suite stays below the UI seam. It verifies that a campaign season may
   pause for one or more player battles without moving twice or closing the
   AI/World phases early, while the original synchronous Turn.end() remains a
   stable compatibility path. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const HEADED = process.argv.includes("--headed");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
};

let pass = 0,
  fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name + (detail === undefined ? "" : "  -> " + JSON.stringify(detail)));
  }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, { actual, expected });
}

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    const file = path.join(ROOT, rel || "index.html");
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function main() {
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch(HEADED ? { headless: false, channel: "chrome" } : {});
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("weberror", (e) => errors.push(String(e.error())));
  await page.goto(base + "/index.html");
  await page.waitForFunction(() => window.ZS && ZS.App && ZS.App.booted === true, null, {
    timeout: 15000,
  });

  await page.evaluate(() => {
    const T = {};

    T.campaign = (seed, player) => {
      const c = ZS.Campaign.create(seed, player || "cao_cao");
      c.armies = {};
      c.nextArmyId = 1;
      c.over = null;
      return c;
    };

    T.own = (c, provinceId, factionId, garrison) => {
      const pr = c.prov(provinceId);
      pr.owner = factionId;
      pr.garrison = garrison === undefined ? 900 : garrison;
      return pr;
    };

    T.army = (c, factionId, provinceId, troops, from) => {
      const a = c.raiseArmy(factionId, provinceId, troops);
      a.from = from || provinceId;
      a.since = c.turn;
      return a;
    };

    T.field = (c, provinceId, attackerFaction, defenderFaction, owner) => {
      T.own(c, provinceId, owner || defenderFaction, 700);
      const attacker = T.army(c, attackerFaction, provinceId, 1800, provinceId);
      const defender = T.army(c, defenderFaction, provinceId, 1500, provinceId);
      defender.since = c.turn - 1;
      return { attacker, defender };
    };

    T.digest = (c) => {
      const parts = [c.turn];
      for (const id of Object.keys(c.provinces).sort()) {
        const p = c.provinces[id];
        parts.push(id, p.owner, p.garrison, p.loyalty, p.dev.income, p.dev.wall);
      }
      for (const id of Object.keys(c.armies).sort()) {
        const a = c.armies[id];
        parts.push(id, a.faction, a.at, a.troops, a.left, (a.path || []).join(">"));
      }
      for (const id of Object.keys(c.factions).sort()) {
        parts.push(id, c.factions[id].gold, c.factions[id].food);
      }
      const text = parts.join("|");
      let h = 2166136261;
      for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
      return (h >>> 0).toString(16).padStart(8, "0");
    };

    window.__P4TurnTest = T;
  });

  console.log("\n[legacy compatibility]");
  const legacy = await page.evaluate(() => {
    const run = () => {
      const c = ZS.Campaign.create(777, "cao_cao");
      let shape = null;
      for (let i = 0; i < 8; i++) {
        const report = ZS.Turn.end(c);
        if (i === 0) shape = Object.keys(report).sort().join(",");
      }
      return { digest: __P4TurnTest.digest(c), shape, turn: c.turn };
    };
    return { a: run(), b: run() };
  });
  eq("Turn.end() still advances eight synchronous seasons", legacy.a.turn, 9);
  eq("the legacy report shape is unchanged", legacy.a.shape, "battles,captured,over,starved,turn");
  eq("the synchronous path remains deterministic", legacy.a.digest, legacy.b.digest);
  eq("the terrain-aware synchronous campaign digest stays stable", legacy.a.digest, "700e3505");

  console.log("\n[pure auto-resolve previews]");
  const pure = await page.evaluate(() => {
    const T = __P4TurnTest;
    const c = T.campaign(4101);
    const pair = T.field(c, "puyang", "cao_cao", "liu_bei", "liu_bei");
    const before = JSON.stringify(c.capture());
    const preview = ZS.AutoResolve.previewField(c, [pair.attacker], [pair.defender], "puyang");
    const after = JSON.stringify(c.capture());
    const mutating = ZS.AutoResolve.field(c, [pair.attacker], [pair.defender], "puyang");

    const assault = T.campaign(4102);
    T.own(assault, "runan", "liu_bei", 500);
    const storm = T.army(assault, "cao_cao", "runan", 4000, "runan");
    const assaultBefore = JSON.stringify(assault.capture());
    const assaultPreview = ZS.AutoResolve.previewAssault(assault, [storm], "runan");
    const assaultAfter = JSON.stringify(assault.capture());
    const assaultMutating = ZS.AutoResolve.assault(assault, [storm], "runan");
    return {
      fieldPure: before === after,
      fieldSame: JSON.stringify(preview) === JSON.stringify(mutating),
      preview,
      mutating,
      assaultPure: assaultBefore === assaultAfter,
      assaultSame: JSON.stringify(assaultPreview) === JSON.stringify(assaultMutating),
    };
  });
  ok("previewField does not mutate campaign state", pure.fieldPure);
  ok("...and predicts the exact legacy field result", pure.fieldSame, {
    preview: pure.preview,
    mutating: pure.mutating,
  });
  ok("previewAssault does not mutate campaign state", pure.assaultPure);
  ok("...and predicts the exact legacy assault result", pure.assaultSame);

  console.log("\n[player attacker / transaction guards]");
  const attacker = await page.evaluate(() => {
    const T = __P4TurnTest;
    const c = T.campaign(4201);
    const pair = T.field(c, "puyang", "cao_cao", "liu_bei", "liu_bei");
    T.own(c, "beihai", "sun_ce", 700);
    const probe = T.army(c, "sun_ce", "beihai", 600, "beihai");
    const next = ZS.CampaignMap.neighbours("beihai")[0].id;
    ZS.Army.setPath(probe, ["beihai", next]);
    probe.left = 3;
    const turn0 = c.turn;
    const gold0 = c.player().gold;
    const started = ZS.Turn.begin(c, { interactive: true });
    const context = ZS.Turn.pending(c);
    const atPause = {
      kind: context && context.kind,
      attacker: context && context.participants.attacker.factionId,
      troops: [pair.attacker.troops, pair.defender.troops],
      owner: c.owner("puyang"),
      turn: c.turn,
      probeLeft: probe.left,
      savedHasSession: /session|pending/i.test(JSON.stringify(c.capture())),
    };
    const again = ZS.Turn.begin(c, { interactive: true });
    const sync = ZS.Turn.end(c);
    const stale = ZS.Turn.resolvePending(c, {
      contextId: "an-old-battle",
      winner: "cao_cao",
      losses: { cao_cao: 999 },
    });
    const afterGuards = {
      turn: c.turn,
      probeLeft: probe.left,
      troops: pair.attacker.troops,
      owner: c.owner("puyang"),
    };
    const result = {
      contextId: context.id,
      winner: "cao_cao",
      losses: { cao_cao: 100, liu_bei: 200 },
      generals: [],
      territory: "defender_holds", // Handoff must ignore this unsafe claim.
      duelLog: [],
      kind: "field",
      province: "puyang",
    };
    const resumed = ZS.Turn.resolvePending(c, result);
    const replay = ZS.Turn.resolvePending(c, result);
    return {
      started: started.ok && !started.done,
      atPause,
      again: again.err,
      sync: sync.err,
      stale: stale.err,
      afterGuards,
      resumed: {
        ok: resumed.ok,
        done: resumed.done,
        turn: c.turn,
        battles: resumed.report.battles.length,
        territory: resumed.report.battles[0].territory,
        attackerTroops: pair.attacker.troops,
        defenderTroops: pair.defender.troops,
        goldChanged: c.player().gold !== gold0,
      },
      replay: replay.err,
      turn0,
    };
  });
  ok("a player attacker suspends the season", attacker.started, attacker);
  ok(
    "the pending field has not applied casualties or territory",
    attacker.atPause.troops[0] === 1800 &&
      attacker.atPause.troops[1] === 1500 &&
      attacker.atPause.owner === "liu_bei",
    attacker.atPause,
  );
  eq("movement ran exactly once before suspension", attacker.atPause.probeLeft, 2);
  eq("a second begin is refused", attacker.again, "turn_in_progress");
  eq("the synchronous path cannot jump an active transaction", attacker.sync, "turn_in_progress");
  eq("a stale battle result is refused", attacker.stale, "stale_battle_result");
  ok(
    "the guards caused no second movement or battle mutation",
    attacker.afterGuards.turn === attacker.turn0 &&
      attacker.afterGuards.probeLeft === 2 &&
      attacker.afterGuards.troops === 1800,
    attacker.afterGuards,
  );
  ok("a valid result resumes and closes the season", attacker.resumed.ok && attacker.resumed.done);
  eq("the turn increments once after the queue", attacker.resumed.turn, attacker.turn0 + 1);
  eq("campaign losses are applied once to the attacker", attacker.resumed.attackerTroops, 1700);
  eq(
    "campaign battle and cut-supply losses apply once to the defender",
    attacker.resumed.defenderTroops,
    1261,
  );
  eq("unsafe result territory is canonicalized", attacker.resumed.territory, "attacker_takes");
  eq("replaying a completed result is harmless", attacker.replay, "no_pending_battle");
  ok(
    "the transient transaction is absent from Campaign.capture",
    !attacker.atPause.savedHasSession,
  );

  console.log("\n[player defender]");
  const defender = await page.evaluate(() => {
    const T = __P4TurnTest;
    const c = T.campaign(4301);
    const pair = T.field(c, "chenliu", "liu_bei", "cao_cao", "cao_cao");
    const turn0 = c.turn;
    const started = ZS.Turn.begin(c, { interactive: true });
    const context = ZS.Turn.pending(c);
    const result = {
      contextId: context.id,
      winner: "cao_cao",
      losses: { liu_bei: 0, cao_cao: 0 },
      kind: "field",
      province: context.provinceId,
    };
    const resumed = ZS.Turn.resolvePending(c, result);
    return {
      paused: started.ok && !started.done,
      attacker: context.participants.attacker.factionId,
      defender: context.participants.defender.factionId,
      playerSide: context.participants.defender.side,
      setupSide0: context.setup.sides[0].factionId,
      done: resumed.done,
      turn: c.turn,
      turn0,
      attackerTroops: pair.attacker.troops,
    };
  });
  ok("a player defender suspends too", defender.paused, defender);
  ok(
    "roles stay attacker/defender while the player is normalized to battle side 0",
    defender.attacker === "liu_bei" &&
      defender.defender === "cao_cao" &&
      defender.playerSide === 0 &&
      defender.setupSide0 === "cao_cao",
    defender,
  );
  ok(
    "the defender result resumes and advances once",
    defender.done && defender.turn === defender.turn0 + 1,
  );

  console.log("\n[serial queue / AI timing / determinism]");
  const serial = await page.evaluate(() => {
    const T = __P4TurnTest;
    const run = (seed) => {
      const c = T.campaign(seed);
      T.field(c, "beihai", "liu_bei", "cao_cao", "cao_cao");
      T.field(c, "chenliu", "sun_ce", "cao_cao", "cao_cao");
      const turn0 = c.turn;
      const gold0 = c.player().gold;
      let state = ZS.Turn.begin(c, { interactive: true });
      const order = [];
      const contextIds = [];
      const timing = [];
      while (ZS.Turn.pending(c)) {
        const pending = ZS.Turn.pending(c);
        order.push(pending.provinceId);
        contextIds.push(pending.id);
        timing.push({ turn: c.turn, gold: c.player().gold });
        state = ZS.Turn.retreatPending(c);
      }
      return {
        order,
        contextIds,
        timing,
        done: state.done,
        battles: state.report.battles.length,
        turn0,
        turn: c.turn,
        gold0,
      };
    };
    const a = run(4401);
    const b = run(4401);

    const ai = T.campaign(4402);
    const aiPair = T.field(ai, "beihai", "sun_ce", "liu_bei", "liu_bei");
    T.field(ai, "chenliu", "liu_bei", "cao_cao", "cao_cao");
    const aiBefore = aiPair.attacker.troops + aiPair.defender.troops;
    const aiState = ZS.Turn.begin(ai, { interactive: true });
    const aiAfter = aiPair.attacker.troops + aiPair.defender.troops;
    const pending = ZS.Turn.pending(ai);
    const partialBattles = aiState.report.battles.length;
    ZS.Turn.retreatPending(ai);
    return {
      a,
      b,
      ai: {
        pausedAt: pending && pending.provinceId,
        partialBattles,
        casualties: aiBefore - aiAfter,
      },
    };
  });
  eq("two player battles resume serially", serial.a.order.length, 2);
  eq("the queue is in deterministic province order", serial.a.order.join(","), "beihai,chenliu");
  eq(
    "an identical campaign builds the identical queue",
    serial.a.contextIds.join("|"),
    serial.b.contextIds.join("|"),
  );
  ok(
    "AI/World wait until every player battle is resolved",
    serial.a.timing.every((x) => x.turn === serial.a.turn0 && x.gold === serial.a.gold0),
    serial.a,
  );
  ok(
    "the serial queue closes one season exactly once",
    serial.a.done && serial.a.battles === 2 && serial.a.turn === serial.a.turn0 + 1,
    serial.a,
  );
  ok(
    "AI-v-AI encounters auto-resolve before the next player suspension",
    serial.ai.partialBattles === 1 && serial.ai.casualties > 0 && serial.ai.pausedAt === "chenliu",
    serial.ai,
  );

  console.log("\n[auto and retreat]");
  const choices = await page.evaluate(() => {
    const T = __P4TurnTest;

    const auto = T.campaign(4501);
    T.own(auto, "puyang", "liu_bei", 100);
    const storm = T.army(auto, "cao_cao", "puyang", 10000, "puyang");
    const autoTurn = auto.turn;
    const autoStart = ZS.Turn.begin(auto, { interactive: true });
    const autoContext = ZS.Turn.pending(auto);
    const before = { troops: storm.troops, garrison: auto.prov("puyang").garrison };
    const autoDone = ZS.Turn.autoPending(auto);

    const retreat = T.campaign(4502);
    T.own(retreat, "runan", "liu_bei", 1200);
    const source = ZS.CampaignMap.neighbours("runan")[0].id;
    const ra = T.army(retreat, "cao_cao", "runan", 3000, source);
    const retreatTurn = retreat.turn;
    ZS.Turn.begin(retreat, { interactive: true });
    const retreatContext = ZS.Turn.pending(retreat);
    const retreatDone = ZS.Turn.retreatPending(retreat);

    const forfeit = T.campaign(4503);
    T.own(forfeit, "chenliu", "cao_cao", 100);
    const invader = T.army(forfeit, "liu_bei", "chenliu", 10000, "chenliu");
    ZS.Turn.begin(forfeit, { interactive: true });
    const forfeitContext = ZS.Turn.pending(forfeit);
    const forfeitDone = ZS.Turn.retreatPending(forfeit);

    return {
      auto: {
        paused: autoStart.ok && !autoStart.done,
        kind: autoContext.kind,
        before,
        done: autoDone.done,
        turn: auto.turn,
        turn0: autoTurn,
        owner: auto.owner("puyang"),
        captured: autoDone.report.captured.length,
        appliedLoss: autoDone.receipt.losses.cao_cao.applied,
        reportLoss: autoDone.report.battles[0].losses.cao_cao,
      },
      retreat: {
        kind: retreatContext.kind,
        done: retreatDone.done,
        turn: retreat.turn,
        turn0: retreatTurn,
        owner: retreat.owner("runan"),
        at: ra.at,
        source,
        troops: ra.troops,
      },
      forfeit: {
        kind: forfeitContext.kind,
        playerSide: forfeitContext.participants.defender.side,
        done: forfeitDone.done,
        owner: forfeit.owner("chenliu"),
        captured: forfeitDone.report.captured.length,
        invaderTroops: invader.troops,
      },
    };
  });
  ok(
    "autoPending previews then applies an assault once",
    choices.auto.paused &&
      choices.auto.kind === "assault" &&
      choices.auto.done &&
      choices.auto.appliedLoss === choices.auto.reportLoss,
    choices.auto,
  );
  ok(
    "a successful skipped assault occupies and advances",
    choices.auto.owner === "cao_cao" &&
      choices.auto.captured === 1 &&
      choices.auto.turn === choices.auto.turn0 + 1,
    choices.auto,
  );
  ok(
    "an attacking player may retreat without casualties or capture",
    choices.retreat.kind === "assault" &&
      choices.retreat.done &&
      choices.retreat.owner === "liu_bei" &&
      choices.retreat.at === choices.retreat.source &&
      choices.retreat.troops === 3000 &&
      choices.retreat.turn === choices.retreat.turn0 + 1,
    choices.retreat,
  );
  ok(
    "a defending player may forfeit a garrison assault",
    choices.forfeit.kind === "assault" &&
      choices.forfeit.playerSide === 0 &&
      choices.forfeit.done &&
      choices.forfeit.owner === "liu_bei" &&
      choices.forfeit.captured === 1,
    choices.forfeit,
  );

  const realErrors = errors.filter(
    (e) =>
      !/subset-data\.js|ERR_FILE_NOT_FOUND|404|ERR_NO_BUFFER_SPACE|ERR_INSUFFICIENT_RESOURCES/.test(
        e,
      ),
  );
  ok("no unexpected console errors", realErrors.length === 0, realErrors.slice(0, 5));

  await browser.close();
  server.close();
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
