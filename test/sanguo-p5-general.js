/* Focused P5 check: campaign-owned general progression and battle outcomes. */
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
  const base = "http://127.0.0.1:" + server.address().port;
  await page.goto(base + "/index.html");
  await page.waitForFunction(() => window.ZS && ZS.App && ZS.App.booted && ZS.Handoff);

  /* The coordinating agent owns final index reconstruction. These conditional
     loads keep this focused suite runnable before its two tags are restored. */
  if (!(await page.evaluate(() => !!ZS.GeneralItems))) {
    await page.addScriptTag({ url: base + "/js/campaign/data/items.js" });
  }
  if (!(await page.evaluate(() => !!ZS.General))) {
    await page.addScriptTag({ url: base + "/js/campaign/general.js" });
  }

  const audit = await page.evaluate(() => {
    function fieldCamp(seed) {
      const camp = ZS.Campaign.create(seed, "cao_cao");
      const attacker = camp.armiesOf("cao_cao")[0];
      const defender = camp.armiesOf("liu_bei")[0];
      defender.at = attacker.at;
      defender.from = ZS.CampaignMap.neighbours(defender.at)[0].id;
      ZS.Army.halt(attacker);
      ZS.Army.halt(defender);
      return {
        camp,
        attacker,
        defender,
        context: ZS.Handoff.buildField(camp, [attacker], [defender], attacker.at),
      };
    }

    const out = {};

    /* ---- one mutable record for the complete almanac ---------------- */
    const c = ZS.Campaign.create(51001, "cao_cao");
    const assigned = new Set();
    let duplicate = false;
    for (const fid in c.factions) {
      for (const id of c.factions[fid].generals) {
        if (assigned.has(id)) duplicate = true;
        assigned.add(id);
      }
    }
    const missingItems = [];
    for (const def of ZS.Generals.ALL) {
      for (const id of def.itemIds) if (!ZS.GeneralItems.get(id)) missingItems.push(id);
    }
    out.roster = {
      records: Object.keys(c.generals).length,
      catalogue: ZS.Generals.ALL.length,
      duplicate,
      free: c.freeGenerals().length,
      missingItems,
      plain: JSON.parse(JSON.stringify(c.capture())).generals.cao_cao.id,
    };

    /* Future arrivals cannot become permanent unreachable catalogue rows. */
    const cLate = ZS.Campaign.create(51002, "cao_cao");
    const lateId = cLate.freeGenerals()[0];
    const late = cLate.general(lateId);
    late.fromYear = 195;
    late.location = "unavailable";
    const beforeLate = cLate.freeGenerals().includes(lateId);
    cLate.turn = 5;
    cLate.recount();
    out.late = {
      before: beforeLate,
      after: cLate.freeGenerals().includes(lateId),
      location: late.location,
    };

    /* ---- XP, skill gates and reversible item layers ----------------- */
    const cProgress = ZS.Campaign.create(51003, "cao_cao");
    const prog = cProgress.general("guan_yu");
    const baseStats = { wu: prog.wu, zhi: prog.zhi, zheng: prog.zheng };
    const skill1 = prog.skillIds.slice();
    const progress = ZS.General.gainXp(prog, 3000);
    const skill5 = prog.skillIds.slice();
    const greenDragon = ZS.General.derive(prog).wu;
    const weaponSwap = ZS.General.equip(prog, "weapon:sword");
    const commonSword = ZS.General.derive(prog).wu;
    const book1 = ZS.General.equip(prog, "book:art_of_war");
    const artStats = ZS.General.derive(prog);
    const book2 = ZS.General.equip(prog, "book:governance");
    const governanceStats = ZS.General.derive(prog);
    const booksEquipped = prog.itemIds.filter((id) => ZS.GeneralItems.get(id).slot === "book");
    const noBook = ZS.General.unequip(prog, "book");
    const cleanStats = ZS.General.derive(prog);
    const model = ZS.General.snapshot(prog).model;
    const baseAfter = { wu: prog.wu, zhi: prog.zhi, zheng: prog.zheng };
    out.progress = {
      threshold1: ZS.General.xpToNext(1),
      threshold5: ZS.General.xpToNext(5),
      level: prog.level,
      xp: prog.xp,
      levels: progress.levels,
      unlocked: progress.unlocked,
      skill1,
      skill5,
      greenDragon,
      commonSword,
      weaponPrevious: weaponSwap.previous,
      bookPrevious: book2.previous,
      booksEquipped,
      artZhi: artStats.zhi,
      artZheng: artStats.zheng,
      governanceZhi: governanceStats.zhi,
      governanceZheng: governanceStats.zheng,
      cleanZhi: cleanStats.zhi,
      cleanZheng: cleanStats.zheng,
      modelWeapon: model.weapon,
      bookOk: book1.ok && book2.ok && noBook.ok,
      baseStats,
      baseAfter,
      duelA: ZS.General.duelAttack(prog, 77),
      duelB: ZS.General.duelAttack(prog, 77),
    };

    /* ---- injury timers, Rest, loyalty and defection APIs ------------ */
    const cStatus = ZS.Campaign.create(51004, "cao_cao");
    let restPid = null,
      restId = null;
    for (const pid in cStatus.provinces) {
      if (cStatus.prov(pid).governor) {
        restPid = pid;
        restId = cStatus.prov(pid).governor;
        break;
      }
    }
    const resting = cStatus.general(restId);
    ZS.General.wound(resting, "wounded", 2);
    resting.loyalty = 50;
    const woundedStats = ZS.General.derive(resting);
    const rested = cStatus.restGeneral(restId, restPid, 1);
    const healedStats = ZS.General.derive(resting);

    const defectorId = "cao_cao";
    const defector = cStatus.general(defectorId);
    ZS.General.adjustLoyalty(defector, -999);
    const canDefect = ZS.General.canDefect(defector);
    const defected = cStatus.defectGeneral(defectorId, "liu_bei", false);
    ZS.General.adjustLoyalty(defector, 999);
    const capped = defector.loyalty;
    out.status = {
      restId,
      wounded: woundedStats.wu < healedStats.wu,
      rested,
      canDefect,
      defected,
      allegiance: defector.allegiance,
      oldRoster: cStatus.faction("cao_cao").generals.includes(defectorId),
      newRoster: cStatus.faction("liu_bei").generals.includes(defectorId),
      location: cStatus.generalLocation(defectorId),
      capped,
    };

    /* ---- explicit battle outcomes and idempotent application -------- */
    const live = fieldCamp(52001);
    const atkId = live.attacker.generals[0];
    const deadId = live.defender.generals[0];
    const capturedId = live.defender.generals[1];
    const executedId = live.defender.generals[2];
    const atkRecord = live.camp.general(atkId);
    ZS.General.equip(atkRecord, "book:art_of_war");
    ZS.General.gainXp(atkRecord, 100);
    /* Rebuild after progression so BattleSetup is an authoritative snapshot. */
    live.context = ZS.Handoff.buildField(
      live.camp,
      [live.attacker],
      [live.defender],
      live.attacker.at,
    );
    const setupGeneral = live.context.setup.sides[live.context.attackerSide].generals.find(
      (g) => g.id === atkId,
    );
    const setupRuntimeZhi = ZS.General.derive(atkRecord).zhi;
    const result = {
      winner: "cao_cao",
      losses: { cao_cao: 0, liu_bei: 0 },
      generals: [
        { id: atkId, outcome: "wounded", injuryT: 4, xpGained: 300, killScore: 2 },
        { id: deadId, outcome: "killed", xpGained: 0, killScore: 0 },
        { id: capturedId, outcome: "captured", xpGained: 0, killScore: 0 },
        { id: executedId, outcome: "captured", xpGained: 0, killScore: 0 },
        { id: "zhuge_liang", outcome: "killed", xpGained: 9999, killScore: 9 },
      ],
    };
    const receipt = ZS.Handoff.apply(live.camp, live.context, result);
    const xpAfter = live.camp.general(atkId).xp;
    const capturedBeforeRecruit = Object.assign({}, live.camp.general(capturedId));
    const again = ZS.Handoff.apply(live.camp, live.context, {
      winner: "liu_bei",
      losses: { cao_cao: 9999 },
      generals: [{ id: atkId, outcome: "killed", xpGained: 9999 }],
    });
    out.outcomes = {
      setupLevel: setupGeneral.level,
      setupZhi: setupGeneral.zhi,
      runtimeZhi: setupRuntimeZhi,
      setupSkills: setupGeneral.skillIds.slice(),
      wounded: live.camp.general(atkId),
      dead: live.camp.general(deadId),
      captured: capturedBeforeRecruit,
      deadStillAssigned: live.defender.generals.includes(deadId),
      capturedStillAssigned: live.defender.generals.includes(capturedId),
      receipt: receipt.generals,
      sameReceipt: receipt === again,
      xpAfter,
      xpAfterAgain: live.camp.general(atkId).xp,
      recruited: live.camp.recruitCaptured(capturedId, "cao_cao"),
      recruitedRecord: live.camp.general(capturedId),
      executed: live.camp.executeCaptured(executedId, "cao_cao"),
      executedRecord: live.camp.general(executedId),
    };

    /* ---- missing played outcomes resolve from one deterministic seed */
    function unresolved(seed) {
      const live = fieldCamp(seed);
      const ids = live.defender.generals.slice(0, 2);
      const receipt = ZS.Handoff.apply(live.camp, live.context, {
        winner: "cao_cao",
        losses: { cao_cao: 0, liu_bei: 0 },
        generals: [
          { id: ids[0], battleState: "dead", xpGained: 0 },
          { id: ids[1], battleState: "routed", xpGained: 0 },
        ],
      });
      return receipt.generals.map((g) => ({
        id: g.id,
        outcome: g.resolved,
        resolution: g.resolution,
        roll: g.roll,
        chance: g.chance,
      }));
    }
    out.determinism = {
      a: unresolved(53001),
      b: unresolved(53001),
    };

    /* ---- P3 saves hydrate the new section; P5 saves round-trip it ---- */
    const saved = JSON.parse(JSON.stringify(live.camp.capture()));
    const restored = ZS.Campaign.restore(saved);
    const old = JSON.parse(JSON.stringify(ZS.Campaign.create(54001, "cao_cao").capture()));
    delete old.generals;
    const upgraded = ZS.Campaign.restore(old);
    const sweep = ZS.Campaign.create(54002, "cao_cao");
    for (let i = 0; i < 10; i++) ZS.Turn.end(sweep);
    const swept = ZS.Campaign.restore(JSON.parse(JSON.stringify(sweep.capture())));
    const addOns = {
      logistics: ZS.CampaignLogistics,
      politics: ZS.CampaignPolitics,
      events: ZS.CampaignEvents,
    };
    ZS.CampaignLogistics = null;
    ZS.CampaignPolitics = null;
    ZS.CampaignEvents = null;
    const compatibility = ZS.Campaign.create(777, "cao_cao");
    for (let i = 0; i < 8; i++) ZS.Turn.end(compatibility);
    const parts = [compatibility.turn];
    for (const id of Object.keys(compatibility.provinces).sort()) {
      const p = compatibility.provinces[id];
      parts.push(id, p.owner, p.garrison, p.loyalty, p.dev.income, p.dev.wall);
    }
    for (const id of Object.keys(compatibility.armies).sort()) {
      const a = compatibility.armies[id];
      parts.push(id, a.faction, a.at, a.troops, a.left, (a.path || []).join(">"));
    }
    for (const id of Object.keys(compatibility.factions).sort()) {
      parts.push(id, compatibility.factions[id].gold, compatibility.factions[id].food);
    }
    let digest = 2166136261;
    const digestText = parts.join("|");
    for (let i = 0; i < digestText.length; i++) {
      digest = Math.imul(digest ^ digestText.charCodeAt(i), 16777619);
    }
    ZS.CampaignLogistics = addOns.logistics;
    ZS.CampaignPolitics = addOns.politics;
    ZS.CampaignEvents = addOns.events;
    out.save = {
      restoredCount: Object.keys(restored.generals).length,
      restoredDead: restored.general(deadId).dead,
      restoredWound: restored.general(atkId).injury,
      oldCount: Object.keys(upgraded.generals).length,
      oldLeader: !!upgraded.general("cao_cao"),
      oldRoster: upgraded.faction("cao_cao").generals.includes("cao_cao"),
      sweepTurn: sweep.turn,
      sweepCount: Object.keys(sweep.generals).length,
      sweepRestored: Object.keys(swept.generals).length,
      legacyDigest: (digest >>> 0).toString(16).padStart(8, "0"),
    };

    return out;
  });

  console.log("\n[roster]");
  eq(
    "every catalogue general has one campaign record",
    audit.roster.records,
    audit.roster.catalogue,
  );
  eq("the complete almanac remains 200 people", audit.roster.records, 200);
  ok("no officer starts in two faction rosters", !audit.roster.duplicate);
  ok("officers outside 194 faction staffs remain reachable", audit.roster.free > 0, audit.roster);
  eq("every default equipment id resolves", audit.roster.missingItems.length, 0);
  eq("general records serialize as plain data", audit.roster.plain, "cao_cao");
  ok("a future officer is not released early", !audit.late.before, audit.late);
  ok("a future officer enters the free pool in their year", audit.late.after, audit.late);
  eq("released officers have a usable location", audit.late.location, "free");

  console.log("\n[progression]");
  eq("level 1 costs 100 XP", audit.progress.threshold1, 100);
  eq("the curve is 100 * level squared", audit.progress.threshold5, 2500);
  eq("3,000 XP advances level 1 to 5", audit.progress.level, 5);
  eq("level thresholds consume XP rather than duplicating it", audit.progress.xp, 0);
  eq("the gain receipt reports four levels", audit.progress.levels, 4);
  eq("level 1 begins with one unlocked skill", audit.progress.skill1.length, 1);
  ok("levels 3 and 5 unlock more skills", audit.progress.skill5.length >= 3, audit.progress);
  ok("the level receipt names newly unlocked skills", audit.progress.unlocked.length >= 2);
  ok(
    "the named weapon modifier is active",
    audit.progress.greenDragon > audit.progress.commonSword,
  );
  eq("equipping replaces the prior weapon", audit.progress.weaponPrevious, "weapon:green_dragon");
  eq("equipping a second book replaces the first", audit.progress.bookPrevious, "book:art_of_war");
  eq("only one item occupies a slot", audit.progress.booksEquipped.length, 1);
  eq("Art of War adds intelligence", audit.progress.artZhi, audit.progress.baseStats.zhi + 5);
  eq("Art of War adds governance", audit.progress.artZheng, audit.progress.baseStats.zheng + 2);
  eq(
    "the governance book has its own intelligence layer",
    audit.progress.governanceZhi,
    audit.progress.baseStats.zhi + 2,
  );
  eq(
    "the governance book has its own governance layer",
    audit.progress.governanceZheng,
    audit.progress.baseStats.zheng + 5,
  );
  eq("unequipping restores intelligence", audit.progress.cleanZhi, audit.progress.baseStats.zhi);
  eq("unequipping restores governance", audit.progress.cleanZheng, audit.progress.baseStats.zheng);
  eq("equipment changes the battle silhouette snapshot", audit.progress.modelWeapon, "sword");
  ok("equipment operations return useful receipts", audit.progress.bookOk);
  eq(
    "item layers never edit base attributes",
    JSON.stringify(audit.progress.baseAfter),
    JSON.stringify(audit.progress.baseStats),
  );
  eq(
    "duel attack is deterministic for a supplied seed",
    audit.progress.duelA,
    audit.progress.duelB,
  );

  console.log("\n[status]");
  ok("wounds penalize derived stats until healed", audit.status.wounded);
  ok("Rest is available through Campaign", audit.status.rested.ok, audit.status.rested);
  eq("one city Rest clears a two-tick wound", audit.status.rested.injury, "none");
  eq("Rest also recovers loyalty", audit.status.rested.loyalty, 58);
  ok("low loyalty makes a general eligible to defect", audit.status.canDefect);
  ok("Campaign can execute a valid defection", audit.status.defected);
  eq("defection changes stable allegiance", audit.status.allegiance, "liu_bei");
  ok("the old roster loses the defector", !audit.status.oldRoster);
  ok("the new roster gains the defector", audit.status.newRoster);
  ok("the defector receives a province location", !audit.status.location.startsWith("army:"));
  eq("loyalty clamps at 100", audit.status.capped, 100);

  console.log("\n[handoff outcomes]");
  eq("BattleSetup reads mutable level", audit.outcomes.setupLevel, 2);
  eq("BattleSetup reads layered item stats", audit.outcomes.setupZhi, audit.outcomes.runtimeZhi);
  eq("BattleSetup carries only unlocked skills", audit.outcomes.setupSkills.length, 1);
  eq("wounded results set injury", audit.outcomes.wounded.injury, "wounded");
  eq("wounded results carry their timer", audit.outcomes.wounded.injuryT, 4);
  ok("killed generals are permanently marked dead", audit.outcomes.dead.dead);
  eq("killed generals leave every location", audit.outcomes.dead.location, "dead");
  eq("captured generals name their holder", audit.outcomes.captured.capturedBy, "cao_cao");
  eq(
    "captured generals use a captured location",
    audit.outcomes.captured.location,
    "captured:cao_cao",
  );
  ok("killed generals are detached from the army", !audit.outcomes.deadStillAssigned);
  ok("captured generals are detached from the army", !audit.outcomes.capturedStillAssigned);
  ok(
    "an unrelated result cannot mutate a nonparticipant",
    audit.outcomes.receipt.some((g) => g.err === "general_not_participant"),
  );
  ok("Handoff.apply returns the same idempotent receipt", audit.outcomes.sameReceipt);
  eq(
    "an idempotent replay grants no extra XP",
    audit.outcomes.xpAfterAgain,
    audit.outcomes.xpAfter,
  );
  ok("the captor can recruit a held general later", audit.outcomes.recruited);
  eq(
    "recruitment changes the captive's allegiance",
    audit.outcomes.recruitedRecord.allegiance,
    "cao_cao",
  );
  ok(
    "the captor can execute a held general permanently",
    audit.outcomes.executed &&
      audit.outcomes.executedRecord.dead &&
      audit.outcomes.executedRecord.location === "dead",
    audit.outcomes.executedRecord,
  );

  console.log("\n[deterministic fallback]");
  eq(
    "missing outcomes resolve identically from the same battle seed",
    JSON.stringify(audit.determinism.a),
    JSON.stringify(audit.determinism.b),
  );
  eq(
    "a fallen figure uses the deterministic death save",
    audit.determinism.a[0].resolution,
    "death_save",
  );
  ok(
    "the death save produces a final campaign outcome",
    ["wounded", "killed"].includes(audit.determinism.a[0].outcome),
  );
  eq(
    "a routed figure uses the deterministic hunt sweep",
    audit.determinism.a[1].resolution,
    "rout_sweep",
  );
  ok(
    "the hunt sweep produces capture or escape",
    ["captured", "ok"].includes(audit.determinism.a[1].outcome),
  );

  console.log("\n[save compatibility]");
  eq("P5 saves restore all records", audit.save.restoredCount, 200);
  ok("permadeath survives reload", audit.save.restoredDead);
  eq("injury state survives reload", audit.save.restoredWound, "wounded");
  eq("a P3 save with no general section hydrates all records", audit.save.oldCount, 200);
  ok("the old save receives catalogue leaders", audit.save.oldLeader);
  ok("the old faction roster remains compatible", audit.save.oldRoster);
  eq("ten legacy synchronous seasons still complete", audit.save.sweepTurn, 11);
  eq("a ten-season campaign retains every general", audit.save.sweepCount, 200);
  eq("the ten-season save restores every general", audit.save.sweepRestored, 200);
  eq(
    "P5 campaign progression keeps a stable synchronous digest",
    audit.save.legacyDigest,
    "a7698cb6",
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
