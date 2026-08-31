/* P7 deterministic campaign balance sweep.

   Runs the production campaign path — CampaignAI player-phase orders,
   Turn.end(), AutoResolve, World/logistics, then the first affordable Tale
   choice — across fixed seeds. The suite measures pacing as well as safety:
   campaigns must move, conquer, diverge by seed, and sometimes finish without
   invalidating a ledger, province, army, route, or officer assignment.

   Run: node test/sanguo-p7-campaign-sweep.js
        node test/sanguo-p7-campaign-sweep.js --headed */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const HEADED = process.argv.includes("--headed");
const HORIZON = Math.max(1, Number(process.env.SANGUO_SWEEP_HORIZON) || 240);
const SEEDS = [194, 777, 1337, 2024, 4096, 9001, 12021, 194194, 314159, 424242];
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

let pass = 0;
let fail = 0;

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

function median(values) {
  const rows = values.slice().sort((a, b) => a - b);
  if (!rows.length) return 0;
  const mid = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[mid] : (rows[mid - 1] + rows[mid]) / 2;
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("weberror", (error) => errors.push(String(error.error())));

  await page.goto(base + "/index.html");
  await page.waitForFunction(() => window.ZS && ZS.App && ZS.App.booted === true, null, {
    timeout: 15000,
  });
  if (!(await page.evaluate(() => !!ZS.CampaignDoctrine))) {
    await page.addScriptTag({ url: base + "/js/campaign/doctrine.js" });
  }

  const sweep = await page.evaluate(
    ({ seeds, horizon }) => {
      const playerIds = ["cao_cao", "sun_ce", "liu_bei", "ma_teng", "yuan_shao"];

      function chooseEvent(camp) {
        if (!ZS.CampaignEvents) return { chosen: 0, blocked: 0 };
        let chosen = 0;
        for (let guard = 0; guard < 4; guard++) {
          const pending = ZS.CampaignEvents.pending(camp);
          if (!pending) return { chosen, blocked: 0 };
          let pick = -1;
          for (let i = 0; i < pending.event.choices.length; i++) {
            if (ZS.CampaignEvents.canChoose(camp, i)) {
              pick = i;
              break;
            }
          }
          if (pick < 0) return { chosen, blocked: 1 };
          const result = ZS.CampaignEvents.choose(camp, pick);
          if (!result.ok) return { chosen, blocked: 1 };
          chosen++;
        }
        return { chosen, blocked: ZS.CampaignEvents.pending(camp) ? 1 : 0 };
      }

      function invariantProblems(camp) {
        const problems = [];
        const ownerCount = {};
        const officerPlaces = new Map();
        const add = (problem) => {
          if (problems.length < 20) problems.push(problem);
        };

        for (const id in camp.provinces) {
          const province = camp.provinces[id];
          if (province.owner && !camp.factions[province.owner]) add("bad owner " + id);
          if (province.owner) ownerCount[province.owner] = (ownerCount[province.owner] || 0) + 1;
          if (!Number.isInteger(province.garrison) || province.garrison < 0) {
            add("bad garrison " + id + "=" + province.garrison);
          }
          if (
            !Number.isFinite(province.loyalty) ||
            province.loyalty < 0 ||
            province.loyalty > 100
          ) {
            add("bad loyalty " + id + "=" + province.loyalty);
          }
          for (const track of ZS.Campaign.DEV_TRACKS) {
            const level = province.dev[track];
            if (!Number.isInteger(level) || level < 0 || level > ZS.Campaign.DEV_MAX[track]) {
              add("bad dev " + id + ":" + track + "=" + level);
            }
          }
          if (province.governor) {
            if (officerPlaces.has(province.governor)) add("officer twice " + province.governor);
            officerPlaces.set(province.governor, "govern:" + id);
          }
        }

        for (const id in camp.factions) {
          const faction = camp.factions[id];
          if (!Number.isInteger(faction.gold) || faction.gold < 0) {
            add("bad gold " + id + "=" + faction.gold);
          }
          if (!Number.isInteger(faction.food) || faction.food < 0) {
            add("bad food " + id + "=" + faction.food);
          }
          if ((faction.provinceCount | 0) !== (ownerCount[id] || 0)) {
            add("bad province count " + id);
          }
          const shouldLive = (ownerCount[id] || 0) > 0 || camp.armiesOf(id).length > 0;
          if (faction.alive !== shouldLive) add("bad alive flag " + id);
        }

        for (const id in camp.armies) {
          const army = camp.armies[id];
          if (!camp.factions[army.faction]) add("bad army faction " + id);
          if (!camp.provinces[army.at]) add("bad army location " + id);
          if (!Number.isInteger(army.troops) || army.troops <= 0) {
            add("bad army troops " + id + "=" + army.troops);
          }
          if (!Number.isFinite(army.fatigue) || army.fatigue < 0 || army.fatigue > 1) {
            add("bad fatigue " + id + "=" + army.fatigue);
          }
          let comp = 0;
          for (const arm of ZS.Army.ARMS) {
            if (!Number.isFinite(army.comp[arm]) || army.comp[arm] < 0) add("bad comp " + id);
            comp += army.comp[arm];
          }
          if (Math.abs(comp - 1) > 0.0001) add("bad comp sum " + id + "=" + comp);
          if (
            army.path &&
            army.path.length &&
            (!camp.provinces[army.path[0]] || !ZS.CampaignMap.isNeighbour(army.at, army.path[0]))
          ) {
            add("bad route " + id);
          }
          if (army.generals.length > ZS.Army.MAX_GENERALS) add("too many generals " + id);
          for (const generalId of army.generals) {
            if (officerPlaces.has(generalId)) add("officer twice " + generalId);
            officerPlaces.set(generalId, "army:" + id);
          }
        }
        if (camp.over && (!camp.over.winner || !camp.factions[camp.over.winner])) {
          add("bad winner");
        }
        return problems;
      }

      function digest(camp) {
        const text = JSON.stringify(camp.capture());
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) {
          hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, "0");
      }

      function run(seed, index) {
        const player = playerIds[index % playerIds.length];
        const camp = ZS.Campaign.create(seed, player);
        const initialOwners = {};
        for (const id in camp.provinces) initialOwners[id] = camp.provinces[id].owner;
        const changed = new Set();
        const captors = new Set();
        const problems = [];
        let captures = 0;
        let battles = 0;
        let starved = 0;
        let events = 0;
        let blockedEvents = 0;
        let marches = 0;
        let firstCapture = null;
        let maxLeaderShare = 0;
        let minAlive = Object.keys(camp.factions).length;
        let seasons = 0;

        for (let step = 1; step <= horizon && !camp.over; step++) {
          const playerFaction = camp.faction(player);
          if (playerFaction && playerFaction.alive) ZS.CampaignAI.plan(camp, player);
          const beforeTurn = camp.turn;
          const report = ZS.Turn.end(camp);
          seasons++;
          if (camp.turn !== beforeTurn + 1) problems.push("turn did not advance once at " + step);
          battles += report.battles.length;
          starved += report.starved.length;
          captures += report.captured.length;
          if (report.captured.length && firstCapture === null) firstCapture = step;
          for (const capture of report.captured) {
            changed.add(capture.province);
            captors.add(capture.to);
          }
          const eventResult = chooseEvent(camp);
          events += eventResult.chosen;
          blockedEvents += eventResult.blocked;

          const counts = {};
          let alive = 0;
          for (const id in camp.provinces) {
            const owner = camp.provinces[id].owner;
            if (owner) counts[owner] = (counts[owner] || 0) + 1;
            if (owner !== initialOwners[id]) changed.add(id);
          }
          for (const id in camp.factions) if (camp.factions[id].alive) alive++;
          minAlive = Math.min(minAlive, alive);
          for (const id in counts) {
            maxLeaderShare = Math.max(
              maxLeaderShare,
              counts[id] / Object.keys(camp.provinces).length,
            );
          }
          for (const id in camp.armies) if (ZS.Army.isMarching(camp.armies[id])) marches++;
          const invalid = invariantProblems(camp);
          if (invalid.length) {
            problems.push("t" + camp.turn + ": " + invalid.join(", "));
            break;
          }
        }

        const finalHoldings = {};
        for (const id in camp.provinces) {
          const owner = camp.provinces[id].owner;
          if (owner) finalHoldings[owner] = (finalHoldings[owner] || 0) + 1;
        }
        const capitalHoldings = {};
        if (ZS.CampaignVictory) {
          for (const id of ZS.CampaignVictory.capitalIds()) {
            const owner = camp.owner(id);
            if (owner) capitalHoldings[owner] = (capitalHoldings[owner] || 0) + 1;
          }
        }
        let leaderId = null;
        for (const id in finalHoldings) {
          if (!leaderId || finalHoldings[id] > finalHoldings[leaderId]) leaderId = id;
        }
        const rivalSeats = leaderId ? ZS.CampaignVictory.rivalCapitalIds(camp, leaderId) : [];
        return {
          seed,
          player,
          seasons,
          winner: camp.over ? camp.over.winner : null,
          winnerTurn: camp.over ? seasons : null,
          captures,
          battles,
          starved,
          events,
          blockedEvents,
          marches,
          firstCapture,
          changed: changed.size,
          captors: captors.size,
          minAlive,
          maxLeaderShare: Math.round(maxLeaderShare * 1000) / 1000,
          finalAlive: Object.values(camp.factions).filter((faction) => faction.alive).length,
          finalProvinceFactions: Object.keys(finalHoldings).length,
          orphanFactions: Object.values(camp.factions).filter(
            (faction) => faction.alive && !finalHoldings[faction.id],
          ).length,
          finalLeader: Math.max(0, ...Object.values(finalHoldings)),
          finalCapitalLeader: Math.max(0, ...Object.values(capitalHoldings)),
          leaderId,
          rivalSeatsHeld: rivalSeats.filter((id) => camp.owner(id) === leaderId).length,
          rivalSeatsNeeded: rivalSeats.length,
          finalArmies: Object.keys(camp.armies).length,
          problems,
          digest: digest(camp),
        };
      }

      function runAll() {
        return seeds.map((seed, index) => run(seed, index));
      }

      return { first: runAll(), replay: runAll() };
    },
    { seeds: SEEDS, horizon: HORIZON },
  );

  const rows = sweep.first;
  const replay = sweep.replay;
  const winners = rows.filter((row) => row.winner);
  const captures = rows.map((row) => row.captures);
  const firstCaptures = rows.map((row) => row.firstCapture || HORIZON + 1);
  const changed = rows.map((row) => row.changed);
  const captors = rows.map((row) => row.captors);
  const metrics = {
    seeds: rows.length,
    horizon: HORIZON,
    winners: winners.length,
    winnerTurns: winners.map((row) => row.winnerTurn),
    winnerIds: winners.map((row) => row.winner),
    medianCaptures: median(captures),
    minCaptures: Math.min(...captures),
    maxCaptures: Math.max(...captures),
    medianFirstCapture: median(firstCaptures),
    medianChangedProvinces: median(changed),
    medianCapturingFactions: median(captors),
    totalBattles: rows.reduce((sum, row) => sum + row.battles, 0),
    totalEvents: rows.reduce((sum, row) => sum + row.events, 0),
    blockedEvents: rows.reduce((sum, row) => sum + row.blockedEvents, 0),
    finalAlive: rows.map((row) => row.finalAlive),
    finalProvinceFactions: rows.map((row) => row.finalProvinceFactions),
    orphanFactions: rows.map((row) => row.orphanFactions),
    finalLeader: rows.map((row) => row.finalLeader),
    finalCapitalLeader: rows.map((row) => row.finalCapitalLeader),
    rivalSeatProgress: rows.map((row) => [row.leaderId, row.rivalSeatsHeld, row.rivalSeatsNeeded]),
    leaderShares: rows.map((row) => row.maxLeaderShare),
  };
  console.log("\n[metrics]");
  console.log(JSON.stringify(metrics, null, 2));

  console.log("\n[safety + replay]");
  const problems = rows.flatMap((row) => row.problems.map((problem) => row.seed + ": " + problem));
  eq("all campaign invariants survive the sweep", problems.length, 0);
  eq("every queued Tale found an affordable deterministic choice", metrics.blockedEvents, 0);
  eq(
    "every seed replays to the same campaign digest",
    JSON.stringify(rows.map((row) => row.digest)),
    JSON.stringify(replay.map((row) => row.digest)),
  );
  eq(
    "replay preserves winner and timing",
    JSON.stringify(rows.map((row) => [row.winner, row.winnerTurn])),
    JSON.stringify(replay.map((row) => [row.winner, row.winnerTurn])),
  );

  console.log("\n[pacing]");
  ok("every campaign sees conquest", metrics.minCaptures > 0, rows);
  ok(
    "the median first conquest arrives within three years",
    metrics.medianFirstCapture <= 12,
    metrics,
  );
  ok(
    "the median campaign changes at least one third of the map",
    metrics.medianChangedProvinces >= 19,
    metrics,
  );
  ok("conquest is contested by several factions", metrics.medianCapturingFactions >= 4, metrics);
  ok("battle volume remains meaningful", metrics.totalBattles >= SEEDS.length * 20, metrics);
  ok("the sweep exercises campaign Tales", metrics.totalEvents >= SEEDS.length * 8, metrics);
  ok("at least one campaign crowns a winner within sixty years", winners.length >= 1, metrics);
  ok(
    "no winner collapses the whole map implausibly early",
    winners.every((row) => row.winnerTurn >= 24),
    metrics,
  );

  console.log("\n[console]");
  ok("no unexpected browser errors", errors.length === 0, errors);

  await browser.close();
  server.close();
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
