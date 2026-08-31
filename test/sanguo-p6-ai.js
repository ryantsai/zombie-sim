/* P6 campaign doctrine verification.

   The production script belongs immediately before js/campaign/ai.js. This
   focused suite injects it after index boot to avoid owning index.html while
   still exercising CampaignAI's runtime integration.

   Run: node test/sanguo-p6-ai.js
        node test/sanguo-p6-ai.js --headed */
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
  await page.addScriptTag({ url: base + "/js/campaign/doctrine.js" });

  const result = await page.evaluate(() => {
    const D = ZS.CampaignDoctrine;
    const AI = ZS.CampaignAI;
    const out = {
      doctrineCount: D.list.length,
      bilingual: D.list.every(
        (item) => item.name["zh-tw"] && item.name.en && item.summary["zh-tw"] && item.summary.en,
      ),
      missingFactions: ZS.data.factions
        .map((faction) => faction.id)
        .filter((id) => !D.factionMap[id]),
      unknownA: D.forFaction("modded_warlord").id,
      unknownB: D.forFaction("modded_warlord").id,
      sunDoctrine: AI.doctrineFor("sun_ce").id,
    };

    function economyCamp(factionId, gold) {
      const faction = { id: factionId, gold, food: 1000, alive: true };
      const province = {
        id: "home",
        owner: factionId,
        dev: { income: 0, food: 0, recruit: 0, wall: 0 },
        loyalty: 60,
        garrison: 1000,
      };
      const camp = {
        provincesOf: (id) => (id === factionId ? ["home"] : []),
        owner: () => factionId,
        prov: () => province,
        devCost: () => 120,
        recruitCap: () => 0,
      };
      AI.economy(camp, factionId, faction, () => 0);
      return { gold: faction.gold, dev: province.dev };
    }

    /* Reserve policy: the shock doctrine spends this purse, the fortress
       doctrine protects it. */
    out.reserveShock = economyCamp("lv_bu", 430);
    out.reserveFortress = economyCamp("liu_biao", 430);

    /* Development priorities on the same safe, well-fed province. */
    out.devShock = economyCamp("lv_bu", 700).dev;
    out.devFortress = economyCamp("liu_biao", 700).dev;
    out.devSteward = economyCamp("liu_bei", 700).dev;

    function massCamp(factionId) {
      const army = ZS.Army.make("army", factionId, "home", 2000);
      const province = {
        id: "home",
        owner: factionId,
        dev: { income: 0, food: 0, recruit: 0, wall: 0 },
        loyalty: 60,
        garrison: 4000,
      };
      const camp = {
        armiesOf: () => [army],
        provincesOf: () => ["home"],
        owner: () => factionId,
        prov: () => province,
        occupationCost: () => 260,
      };
      AI.forces(camp, factionId, { id: factionId }, () => 0);
      return { troops: army.troops, garrison: province.garrison };
    }

    out.massShock = massCamp("lv_bu");
    out.massFortress = massCamp("liu_biao");

    /* Movement tests use a three-node public board. No fog, hidden armies, or
       production data is exposed to the planner. */
    const oldNeighbours = ZS.CampaignMap.neighbours;
    const oldProvince = ZS.CampaignMap.province;
    const oldPath = ZS.CampaignMap.path;
    try {
      function movementCamp(factionId, troops, targets) {
        const army = ZS.Army.make("army", factionId, "home", troops);
        const provinces = {
          home: {
            id: "home",
            owner: factionId,
            dev: { wall: 0 },
            garrison: 1000,
          },
        };
        for (const target of targets) {
          provinces[target.id] = {
            id: target.id,
            owner: "enemy",
            dev: { wall: target.wall || 0 },
            garrison: target.garrison,
          };
        }
        const camp = {
          armiesOf: () => [army],
          provincesOf: () => ["home"],
          owner: (id) => provinces[id].owner,
          prov: (id) => provinces[id],
          armiesAt: (id) => (id === "home" ? [army] : []),
        };
        ZS.CampaignMap.neighbours = (id) =>
          id === "home" ? targets.map((target) => ({ id: target.id, cost: 1 })) : [];
        ZS.CampaignMap.province = (id) => {
          if (id === "home") return { id, size: 2, wall: 0, biome: "plain", port: false };
          const target = targets.find((item) => item.id === id);
          return target
            ? {
                id,
                size: target.size || 2,
                wall: target.wall || 0,
                biome: target.biome,
                port: !!target.port,
              }
            : null;
        };
        ZS.CampaignMap.path = (from, to) => [from, to];
        const doctrine = D.forFaction(factionId);
        AI.movement(camp, factionId, doctrine.nerve, () => 0, doctrine);
        return army.path ? army.path[0] : null;
      }

      const contested = [{ id: "target", biome: "plain", garrison: 1000 }];
      out.nerveShock = movementCamp("lv_bu", 800, contested);
      out.nerveFortress = movementCamp("liu_biao", 800, contested);

      const terrainTargets = [
        { id: "river", biome: "river", port: true, garrison: 400 },
        { id: "hill", biome: "hill", port: false, garrison: 400 },
      ];
      out.terrainRiver = movementCamp("sun_ce", 3000, terrainTargets);
      out.terrainFrontier = movementCamp("ma_teng", 3000, terrainTargets);
    } finally {
      ZS.CampaignMap.neighbours = oldNeighbours;
      ZS.CampaignMap.province = oldProvince;
      ZS.CampaignMap.path = oldPath;
    }

    function digest(camp) {
      const parts = [camp.turn];
      for (const id of Object.keys(camp.provinces).sort()) {
        const p = camp.provinces[id];
        parts.push(
          id,
          p.owner,
          p.garrison,
          p.loyalty,
          p.dev.income,
          p.dev.food,
          p.dev.recruit,
          p.dev.wall,
        );
      }
      for (const id of Object.keys(camp.armies).sort()) {
        const army = camp.armies[id];
        parts.push(
          id,
          army.faction,
          army.at,
          army.troops,
          army.left,
          army.fatigue,
          (army.path || []).join(">"),
        );
      }
      for (const id of Object.keys(camp.factions).sort()) {
        const faction = camp.factions[id];
        parts.push(id, faction.gold, faction.food);
      }
      return parts.join("|");
    }

    function replay(seed) {
      const camp = ZS.Campaign.create(seed, "cao_cao");
      let marches = 0;
      let battles = 0;
      for (let turn = 0; turn < 8; turn++) {
        const report = ZS.Turn.end(camp);
        battles += report.battles.length;
        for (const id in camp.armies) {
          if (ZS.Army.isMarching(camp.armies[id])) marches++;
        }
      }
      const problems = [];
      for (const id in camp.factions) {
        const faction = camp.factions[id];
        if (faction.gold < 0 || faction.food < 0) problems.push("ledger:" + id);
      }
      for (const id in camp.provinces) {
        const province = camp.provinces[id];
        if (province.garrison < 0) problems.push("garrison:" + id);
      }
      for (const id in camp.armies) {
        if (camp.armies[id].troops < 0) problems.push("army:" + id);
      }
      return { digest: digest(camp), marches, battles, problems, turn: camp.turn };
    }

    out.replayA = replay(6060);
    out.replayB = replay(6060);
    out.replayOther = replay(6061);
    return out;
  });

  console.log("\n[content + API]");
  ok("at least four doctrine archetypes ship", result.doctrineCount >= 4, result.doctrineCount);
  eq("every doctrine carries bilingual name and summary", result.bilingual, true);
  eq("every built-in faction has an explicit doctrine", result.missingFactions.length, 0);
  eq("unknown mod factions map deterministically", result.unknownA, result.unknownB);
  eq("CampaignAI resolves doctrine content at runtime", result.sunDoctrine, "river_lords");

  console.log("\n[distinct decisions]");
  eq("shock doctrine spends past a shallow reserve", result.reserveShock.gold, 310);
  eq("fortress doctrine protects a deeper reserve", result.reserveFortress.gold, 430);
  eq("shock doctrine develops recruitment first", result.devShock.recruit, 1);
  eq("fortress doctrine develops walls first", result.devFortress.wall, 1);
  eq("steward doctrine develops income first", result.devSteward.income, 1);
  eq("shock doctrine treats a 2,000-man stack as massed", result.massShock.troops, 2000);
  eq("fortress doctrine masses the same stack to 3,000", result.massFortress.troops, 3000);
  eq("shock nerve accepts a marginal attack", result.nerveShock, "target");
  eq("fortress nerve refuses the same marginal attack", result.nerveFortress, null);
  eq("river doctrine chooses the port corridor", result.terrainRiver, "river");
  eq("frontier doctrine chooses hill country", result.terrainFrontier, "hill");

  console.log("\n[determinism]");
  eq(
    "same seed replays all doctrine decisions exactly",
    result.replayA.digest,
    result.replayB.digest,
  );
  ok(
    "a different seed remains a different campaign",
    result.replayA.digest !== result.replayOther.digest,
  );
  eq("eight doctrine seasons advance exactly once each", result.replayA.turn, 9);
  eq("doctrine replay preserves campaign ledgers", result.replayA.problems.length, 0);
  ok("doctrine factions still march", result.replayA.marches > 0, result.replayA);
  ok("doctrine factions still meet in battle", result.replayA.battles > 0, result.replayA);

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
