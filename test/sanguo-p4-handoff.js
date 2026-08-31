/* Focused P4 contract check: campaign armies <-> BattleSetup/BattleResult.

   This suite does not exercise the turn/UI state machine. It proves the
   self-contained seam in js/campaign/handoff.js before those callers depend
   on it. */
"use strict";
const http = require("http"),
  fs = require("fs"),
  path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
};
let passed = 0,
  failed = 0;

function ok(name, cond, detail) {
  if (cond) {
    passed++;
    console.log("  PASS  " + name);
  } else {
    failed++;
    console.log("  FAIL  " + name + (detail === undefined ? "" : "  -> " + JSON.stringify(detail)));
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, { actual, expected });
}

(async () => {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    const file = path.join(ROOT, rel || "index.html");
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) return res.writeHead(404).end("not found");
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:" + server.address().port + "/index.html");
  await page.waitForFunction(() => window.ZS && ZS.App && ZS.App.booted && ZS.Handoff);

  const audit = await page.evaluate(() => {
    function army(camp, faction, at, troops, comp, generals, from) {
      const a = camp.raiseArmy(faction, at, troops, comp);
      a.generals = (generals || []).slice();
      a.from = from || at;
      a.since = camp.turn;
      return a;
    }

    function firstSite(camp, predicate) {
      for (const id in camp.provinces) {
        if (predicate(camp.prov(id), id)) return id;
      }
      return null;
    }

    const out = {};

    /* ---- setup/orientation/aggregation ----------------------------- */
    const c = ZS.Campaign.create(44004, "cao_cao");
    const pid = "chenliu";
    const a1 = army(c, "cao_cao", pid, 1200, { spear: 1 }, ["cao_cao", "xiahou_dun"]);
    const a2 = army(c, "cao_cao", pid, 1300, { cav: 1 }, ["xiahou_dun", "cao_ren"]);
    const d1 = army(c, "liu_bei", pid, 900, { dao: 1 }, ["liu_bei"]);
    const field = ZS.Handoff.buildField(c, [a2, a1], [d1], pid);
    const same = ZS.Handoff.buildField(c, [a1, a2], [d1], pid);
    const directSeed = ZS.Handoff.seedFor(c, pid, [a2, a1], [d1], "field");
    out.field = {
      attackerSide: field.attackerSide,
      setupAttackerSide: field.setup.attackerSide,
      setupDefenderSide: field.setup.defenderSide,
      mapAttackerSide: field.setup.field.attackerSide,
      mapDefenderSide: field.setup.field.defenderSide,
      side0Faction: field.setup.sides[0].factionId,
      side0ColorType: typeof field.setup.sides[0].colorSlot,
      side0BannerType: typeof field.setup.sides[0].banner,
      troops: field.setup.sides[0].troops,
      onField: field.setup.sides[0].onField,
      reserve: field.setup.sides[0].reserve,
      spear: field.setup.sides[0].comp.spear,
      cav: field.setup.sides[0].comp.cav,
      generals: field.setup.sides[0].generals.map((g) => g.id),
      exactIds: field.participantArmyIds.attackers.slice(),
      seed: field.seed,
      directSeed,
      stableSeed: same.seed,
      stableSetup: JSON.stringify(field.setup) === JSON.stringify(same.setup),
      meta: field.setup.field,
    };
    c.playerFactionId = "liu_bei";
    const playerDefends = ZS.Handoff.buildField(c, [a1, a2], [d1], pid);
    out.playerDefends = {
      attackerSide: playerDefends.attackerSide,
      setupAttackerSide: playerDefends.setup.attackerSide,
      mapAttackerSide: playerDefends.setup.field.attackerSide,
      side0: playerDefends.setup.sides[0].factionId,
      role0: playerDefends.setup.sides[0].role,
    };

    /* ---- town / fort metadata and garrison identity ---------------- */
    const cMaps = ZS.Campaign.create(55115, "cao_cao");
    const townId = firstSite(
      cMaps,
      (pr) => pr.owner && pr.owner !== "cao_cao" && pr.dev.wall === 0,
    );
    const fortId = firstSite(cMaps, (pr) => pr.owner && pr.owner !== "cao_cao" && pr.dev.wall > 0);
    const townFrom = ZS.CampaignMap.neighbours(townId)[0].id;
    const fortFrom = ZS.CampaignMap.neighbours(fortId)[0].id;
    const townArmy = army(cMaps, "cao_cao", townId, 1400, null, ["cao_cao"], townFrom);
    const fortArmy = army(cMaps, "cao_cao", fortId, 2400, null, ["cao_cao"], fortFrom);
    const town = ZS.Handoff.buildAssault(cMaps, [townArmy], townId);
    const fort = ZS.Handoff.buildAssault(cMaps, [fortArmy], fortId);
    out.maps = {
      town: town.setup.field,
      fort: fort.setup.field,
      townGarrison: town.garrisonDefense,
      townDefenderIds: town.participantArmyIds.defenders,
      fortReserve: fort.setup.sides[fort.attackerSide].reserve,
    };

    /* ---- scenario result translation ------------------------------- */
    const fake = {
      over: true,
      result: field.attackerSide,
      sides: [{ dead: 123 }, { dead: 321 }],
      generals: [
        { generalId: "cao_cao", dead: false, gone: false, routFlag: 0 },
        { generalId: "liu_bei", dead: true, gone: false, routFlag: 0 },
      ],
      duelLog: [],
      stalemate: false,
      bt: 88.5,
    };
    const translated = ZS.Handoff.resultFromScenario(fake, field);
    out.translated = translated;

    /* ---- exact proportional loss application + idempotence --------- */
    const cApply = ZS.Campaign.create(66226, "cao_cao");
    const battlePid = firstSite(cApply, (pr) => pr.owner === "liu_bei");
    const back = ZS.CampaignMap.neighbours(battlePid)[0].id;
    const p1 = army(cApply, "cao_cao", battlePid, 1200, { spear: 1 }, ["cao_cao"], back);
    const p2 = army(cApply, "cao_cao", battlePid, 800, { cav: 1 }, ["xiahou_dun"], back);
    const unrelated = army(cApply, "cao_cao", battlePid, 400, null, []);
    const foe = army(cApply, "liu_bei", battlePid, 1000, null, ["liu_bei"], back);
    const applyCtx = ZS.Handoff.buildField(cApply, [p1, p2], [foe], battlePid);
    const ownerBefore = cApply.owner(battlePid);
    const applied = ZS.Handoff.apply(cApply, applyCtx, {
      winner: "cao_cao",
      losses: { cao_cao: 300, liu_bei: 400 },
      territory: "defender_holds",
    });
    const afterFirst = [p1.troops, p2.troops, unrelated.troops, foe.troops];
    const appliedAgain = ZS.Handoff.apply(cApply, applyCtx, {
      winner: "cao_cao",
      losses: { cao_cao: 999, liu_bei: 999 },
      territory: "attacker_takes",
    });
    out.applyField = {
      ownerBefore,
      ownerAfter: cApply.owner(battlePid),
      afterFirst,
      afterSecond: [p1.troops, p2.troops, unrelated.troops, foe.troops],
      byArmy: applied.losses.cao_cao.byArmy,
      appliedOwn: applied.losses.cao_cao.applied,
      appliedFoe: applied.losses.liu_bei.applied,
      sameReceipt: appliedAgain === applied,
      territory: applied.territory,
    };

    /* ---- safe assault result: winner, not supplied territory, rules */
    const cHold = ZS.Campaign.create(77337, "cao_cao");
    const holdId = firstSite(
      cHold,
      (pr) => pr.owner && pr.owner !== "cao_cao" && pr.dev.wall === 0,
    );
    const originalOwner = cHold.owner(holdId);
    cHold.prov(holdId).garrison = 700;
    const holdBack = ZS.CampaignMap.neighbours(holdId)[0].id;
    const holdArmy = army(cHold, "cao_cao", holdId, 1200, null, [], holdBack);
    const holdCtx = ZS.Handoff.buildAssault(cHold, [holdArmy], holdId);
    const held = ZS.Handoff.apply(cHold, holdCtx, {
      winner: originalOwner,
      losses: { cao_cao: 100, [originalOwner]: 250 },
      territory: "attacker_takes",
    });
    out.hold = {
      originalOwner,
      owner: cHold.owner(holdId),
      garrison: cHold.prov(holdId).garrison,
      attacker: holdArmy.troops,
      territory: held.territory,
      occupation: held.occupation,
    };

    const cTake = ZS.Campaign.create(88448, "cao_cao");
    const takeId = firstSite(cTake, (pr) => pr.owner && pr.owner !== "cao_cao" && pr.dev.wall > 0);
    const oldOwner = cTake.owner(takeId);
    cTake.prov(takeId).garrison = 600;
    const takeBack = ZS.CampaignMap.neighbours(takeId)[0].id;
    const take1 = army(cTake, "cao_cao", takeId, 2200, null, ["cao_cao"], takeBack);
    const take2 = army(cTake, "cao_cao", takeId, 800, null, ["xiahou_dun"], takeBack);
    const takeCtx = ZS.Handoff.buildAssault(cTake, [take1, take2], takeId);
    const attackerBefore = take1.troops + take2.troops;
    const taken = ZS.Handoff.apply(cTake, takeCtx, {
      winner: "cao_cao",
      losses: { cao_cao: 300, [oldOwner]: 450 },
      territory: "defender_holds",
    });
    out.take = {
      oldOwner,
      owner: cTake.owner(takeId),
      attackerBefore,
      attackerAfterIncludingGarrison: take1.troops + take2.troops + cTake.prov(takeId).garrison,
      lossApplied: taken.losses.cao_cao.applied,
      occupation: taken.occupation,
      territory: taken.territory,
    };

    return out;
  });

  console.log("\n[setup]");
  eq("player attacker is side 0", audit.field.attackerSide, 0);
  eq("setup names the attacker side", audit.field.setupAttackerSide, 0);
  eq("setup names the defender side", audit.field.setupDefenderSide, 1);
  eq("field metadata names the attacker side", audit.field.mapAttackerSide, 0);
  eq("field metadata names the defender side", audit.field.mapDefenderSide, 1);
  eq("stable faction id stays a string", audit.field.side0Faction, "cao_cao");
  eq("render color is a separate number", audit.field.side0ColorType, "number");
  eq("banner is a separate preset key", audit.field.side0BannerType, "string");
  eq("multiple stacks aggregate every man", audit.field.troops, 2500);
  eq("FIELD_CAP controls on-field men", audit.field.onField, 2000);
  eq("overflow becomes reserve", audit.field.reserve, 500);
  ok("composition aggregates by exact men", Math.abs(audit.field.spear - 0.48) < 1e-9, audit.field);
  ok("cavalry aggregation is exact", Math.abs(audit.field.cav - 0.52) < 1e-9, audit.field);
  eq(
    "duplicate generals are included once",
    audit.field.generals.join(","),
    "cao_cao,xiahou_dun,cao_ren",
  );
  eq("participant army ids are stable and exact", audit.field.exactIds.length, 2);
  eq("public seed helper matches the context", audit.field.seed, audit.field.directSeed);
  eq("input order does not change the seed", audit.field.seed, audit.field.stableSeed);
  ok("input order does not change BattleSetup", audit.field.stableSetup);
  eq("field clashes are open", audit.field.meta.kind, "open");
  for (const key of [
    "terrain",
    "biome",
    "layout",
    "approach",
    "season",
    "wallTier",
    "siteSize",
    "provinceId",
  ]) {
    ok(
      "field metadata carries " + key,
      Object.prototype.hasOwnProperty.call(audit.field.meta, key),
    );
  }

  console.log("\n[orientation]");
  eq("player defender is still side 0", audit.playerDefends.side0, "liu_bei");
  eq("attacker role moves to side 1", audit.playerDefends.attackerSide, 1);
  eq("setup preserves a defending player's orientation", audit.playerDefends.setupAttackerSide, 1);
  eq(
    "map metadata preserves a defending player's orientation",
    audit.playerDefends.mapAttackerSide,
    1,
  );
  eq("side 0 keeps the defender role", audit.playerDefends.role0, "defender");

  console.log("\n[maps]");
  eq("an unwalled assault selects town", audit.maps.town.kind, "town");
  eq("a walled assault selects fort", audit.maps.fort.kind, "fort");
  eq("town carries wall tier 0", audit.maps.town.wallTier, 0);
  ok("fort carries a positive wall tier", audit.maps.fort.wallTier > 0, audit.maps.fort);
  ok("garrison defence is explicit", !!audit.maps.townGarrison);
  eq("garrison defence has no fake army id", audit.maps.townDefenderIds.length, 0);
  eq("large assault armies keep reserves", audit.maps.fortReserve, 400);

  console.log("\n[result]");
  eq("side winner translates to faction id", audit.translated.winner, "cao_cao");
  eq("side-0 dead become faction-keyed losses", audit.translated.losses.cao_cao, 123);
  eq("side-1 dead become faction-keyed losses", audit.translated.losses.liu_bei, 321);
  eq("scenario result derives territory", audit.translated.territory, "attacker_takes");
  eq("dead generals are reported", audit.translated.generals[1].outcome, "killed");

  console.log("\n[apply field]");
  eq("first exact stack takes its proportional loss", audit.applyField.afterFirst[0], 1020);
  eq("second exact stack takes its proportional loss", audit.applyField.afterFirst[1], 680);
  eq("an unrelated friendly stack is untouched", audit.applyField.afterFirst[2], 400);
  eq("the exact enemy stack takes its loss", audit.applyField.afterFirst[3], 600);
  eq("all requested attacker losses apply", audit.applyField.appliedOwn, 300);
  eq("all requested defender losses apply", audit.applyField.appliedFoe, 400);
  eq(
    "a field victory does not capture the province",
    audit.applyField.ownerAfter,
    audit.applyField.ownerBefore,
  );
  ok("a second apply returns the original receipt", audit.applyField.sameReceipt);
  eq(
    "a second apply changes no troops",
    audit.applyField.afterSecond.join(","),
    audit.applyField.afterFirst.join(","),
  );

  console.log("\n[apply assault]");
  eq("a forged attacker_takes cannot beat the winner", audit.hold.owner, audit.hold.originalOwner);
  eq("defender victory derives defender_holds", audit.hold.territory, "defender_holds");
  eq("garrison loss applies exactly when it holds", audit.hold.garrison, 450);
  eq("attacker loss also applies exactly", audit.hold.attacker, 1100);
  eq("no occupation occurs on a defender win", audit.hold.occupation, null);
  eq("attacker victory captures the site", audit.take.owner, "cao_cao");
  eq("winner overrides a stale defender_holds field", audit.take.territory, "attacker_takes");
  ok(
    "capture records its occupation transfer",
    audit.take.occupation && audit.take.occupation.applied,
  );
  eq(
    "occupation moves men but preserves 1:1 attacker accounting",
    audit.take.attackerAfterIncludingGarrison,
    audit.take.attackerBefore - audit.take.lossApplied,
  );

  const realErrors = errors.filter((e) => !/subset-data\.js|ERR_FILE_NOT_FOUND|404/.test(e));
  console.log("\n[console]");
  ok("no unexpected console errors", realErrors.length === 0, realErrors.slice(0, 4));

  await browser.close();
  server.close();
  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exitCode = failed ? 1 : 0;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
