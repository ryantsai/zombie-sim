/* Focused P6 integration check: campaign Tales, logistics, politics and victory. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const manifest = require("../tools/module-manifest.js");

const ROOT = path.resolve(__dirname, "..");
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

let passed = 0;
let failed = 0;

function ok(name, condition, detail) {
  if (condition) {
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

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    const file = path.join(ROOT, rel || "index.html");
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function main() {
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  context.on("weberror", (event) => errors.push(String(event.error())));
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto(base + "/index.html");
  await page.waitForFunction(
    () =>
      window.ZS &&
      ZS.App &&
      ZS.App.booted === true &&
      ZS.CampaignEvents &&
      ZS.CampaignLogistics &&
      ZS.CampaignPolitics &&
      ZS.CampaignVictory,
    null,
    { timeout: 15000 },
  );

  console.log("\n[module wiring]");
  const expected = manifest.expected("index.html");
  ok("every script named by index.html exists", expected.missing.length === 0, expected.missing);
  const exports = await page.evaluate(() => Object.keys(window.ZS || {}));
  const absent = expected.names.filter((name) => !exports.includes(name));
  ok("every module promised by index.html reached ZS", absent.length === 0, absent);
  const orphans = manifest.orphans();
  ok(
    "no ZS module is orphaned without a page script tag",
    orphans.length === 0,
    orphans.map((entry) => entry.file),
  );

  const audit = await page.evaluate(() => {
    const out = {};

    /* ---- deterministic, choice-driven campaign Tales ---------------- */
    function forcedTale(seed) {
      const camp = ZS.Campaign.create(seed, "cao_cao");
      camp.turn = 7;
      const first = ZS.CampaignEvents.queueWorld(camp, true);
      const second = ZS.CampaignEvents.queueWorld(camp, true);
      return {
        first: JSON.parse(JSON.stringify(first)),
        second: JSON.parse(JSON.stringify(second)),
        queueLength: camp.eventQueue.length,
      };
    }

    const taleA = forcedTale(61001);
    const taleB = forcedTale(61001);
    out.eventsDeterministic = {
      a: taleA,
      b: taleB,
      definition: ZS.CampaignEvents.def(taleA.first.id),
    };

    const choiceCamp = ZS.Campaign.create(61002, "cao_cao");
    const choiceFaction = choiceCamp.player();
    const choiceProvince = choiceCamp.prov("chenliu");
    choiceFaction.food = 1000;
    choiceProvince.garrison = 1000;
    choiceProvince.loyalty = 50;
    choiceCamp.eventQueue.push({
      id: "refugee_column",
      turn: choiceCamp.turn,
      provinceId: "chenliu",
    });
    const choiceBefore = {
      food: choiceFaction.food,
      garrison: choiceProvince.garrison,
      loyalty: choiceProvince.loyalty,
    };
    const choiceResult = ZS.CampaignEvents.choose(choiceCamp, 0);
    out.eventChoice = {
      before: choiceBefore,
      after: {
        food: choiceFaction.food,
        garrison: choiceProvince.garrison,
        loyalty: choiceProvince.loyalty,
      },
      result: choiceResult,
      queueLength: choiceCamp.eventQueue.length,
      history: choiceCamp.eventHistory.slice(),
      log: choiceCamp.log[choiceCamp.log.length - 1],
    };

    const poorCamp = ZS.Campaign.create(61003, "liu_bei");
    const poorFaction = poorCamp.player();
    const poorProvince = poorCamp.prov("pengcheng");
    poorFaction.food = 179;
    poorProvince.loyalty = 50;
    poorProvince.unrest = 0;
    poorCamp.eventQueue.push({
      id: "refugee_column",
      turn: poorCamp.turn,
      provinceId: "pengcheng",
    });
    const unaffordableBefore = JSON.stringify({
      food: poorFaction.food,
      loyalty: poorProvince.loyalty,
      unrest: poorProvince.unrest,
      queue: poorCamp.eventQueue,
    });
    const canPay = ZS.CampaignEvents.canChoose(poorCamp, 0);
    const refused = ZS.CampaignEvents.choose(poorCamp, 0);
    const unaffordableAfter = JSON.stringify({
      food: poorFaction.food,
      loyalty: poorProvince.loyalty,
      unrest: poorProvince.unrest,
      queue: poorCamp.eventQueue,
    });
    const fallbackAvailable = ZS.CampaignEvents.canChoose(poorCamp, 1);
    out.eventAffordability = {
      canPay,
      refused,
      unchanged: unaffordableBefore === unaffordableAfter,
      fallbackAvailable,
    };

    const saveCamp = ZS.Campaign.create(61004, "cao_cao");
    saveCamp.eventQueue.push({
      id: "harvest_surplus",
      turn: 9,
      provinceId: "chenliu",
    });
    saveCamp.eventHistory.push("frontier_bandits", "merchant_guild");
    const saveData = JSON.parse(JSON.stringify(saveCamp.capture()));
    const restored = ZS.Campaign.restore(saveData);
    const restoredPending = ZS.CampaignEvents.pending(restored);
    out.eventSave = {
      queue: restored.eventQueue,
      history: restored.eventHistory,
      pendingId: restoredPending && restoredPending.event.id,
      pendingRecord: restoredPending && restoredPending.record,
    };

    /* ---- specialties and live supply lines --------------------------- */
    const logistics = ZS.CampaignLogistics;
    out.specialties = {
      plain: logistics.specialty("qiao").id,
      horse: logistics.specialty("anding").id,
      iron: logistics.specialty("danyang").id,
      port: logistics.specialty("henei").id,
      timber: logistics.specialty("wuling").id,
      herbs: logistics.specialty("guangling").id,
      fortress: logistics.specialty("taishan").id,
      metropolis: logistics.specialty("chenliu").id,
    };

    const specialtyCamp = ZS.Campaign.create(62001, "cao_cao");
    specialtyCamp.prov("anding").garrison = 0;
    specialtyCamp.prov("anding").loyalty = 80;
    specialtyCamp.prov("taishan").dev.wall = 0;
    const withSpecialty = {
      food: specialtyCamp.foodYield("qiao"),
      income: specialtyCamp.income("henei"),
      recruit: specialtyCamp.recruitCap("anding"),
      wall: specialtyCamp.devCost("taishan", "wall"),
    };
    let withoutSpecialty;
    ZS.CampaignLogistics = null;
    try {
      withoutSpecialty = {
        food: specialtyCamp.foodYield("qiao"),
        income: specialtyCamp.income("henei"),
        recruit: specialtyCamp.recruitCap("anding"),
        wall: specialtyCamp.devCost("taishan", "wall"),
      };
    } finally {
      ZS.CampaignLogistics = logistics;
    }

    const horseCamp = ZS.Campaign.create(62002, "ma_teng");
    const horseRaised = ZS.Turn.raise(horseCamp, "anding", 500, null);
    out.specialtyEffects = {
      withSpecialty,
      withoutSpecialty,
      horseRaised: horseRaised.ok,
      horseCavalry: horseRaised.ok ? horseRaised.army.comp.cav : 0,
      ordinaryCavalry: ZS.Army.defaultComp().cav,
    };

    function supplyCamp(seed, at, owned) {
      const camp = ZS.Campaign.create(seed, "cao_cao");
      camp.armies = {};
      camp.nextArmyId = 1;
      for (const id in camp.provinces) {
        camp.provinces[id].owner = null;
        camp.provinces[id].garrison = 0;
      }
      for (let i = 0; i < owned.length; i++) camp.provinces[owned[i]].owner = "cao_cao";
      const army = camp.raiseArmy("cao_cao", at, 1000, null);
      army.fatigue = 0;
      return { camp, army };
    }

    const normal = supplyCamp(62003, "xuchang", ["chenliu", "xuchang"]);
    const normalStatus = logistics.status(normal.camp, normal.army);
    const normalReport = {};
    const normalRows = logistics.applyWorld(normal.camp, normalReport);

    const chain = [
      "chenliu",
      "luoyang",
      "nanyang",
      "xiangyang",
      "jiangling",
      "wuling",
      "lingling",
      "jiaozhi",
    ];
    const strained = supplyCamp(62004, "jiaozhi", chain);
    const strainedStatus = logistics.status(strained.camp, strained.army);
    const strainedReport = {};
    const strainedRows = logistics.applyWorld(strained.camp, strainedReport);

    const cut = supplyCamp(62005, "jiaozhi", ["chenliu", "jiaozhi"]);
    const cutStatus = logistics.status(cut.camp, cut.army);
    const cutReport = {};
    const cutRows = logistics.applyWorld(cut.camp, cutReport);
    const cutMen = ZS.Army.men(cut.army);
    out.supply = {
      normal: {
        status: normalStatus,
        rows: normalRows,
        report: normalReport,
        troops: normal.army.troops,
        fatigue: normal.army.fatigue,
      },
      strained: {
        status: strainedStatus,
        rows: strainedRows,
        report: strainedReport,
        troops: strained.army.troops,
        fatigue: strained.army.fatigue,
      },
      cut: {
        status: cutStatus,
        rows: cutRows,
        report: cutReport,
        troops: cut.army.troops,
        fatigue: cut.army.fatigue,
        men: ZS.Army.ARMS.reduce((sum, arm) => sum + cutMen[arm], 0),
      },
    };

    /* ---- wounds, Rest and deterministic loyalty consequences -------- */
    const recoveryCamp = ZS.Campaign.create(63001, "cao_cao");
    const recoveryGeneral = recoveryCamp.general("xun_yu");
    ZS.General.wound(recoveryGeneral, "wounded", 1);
    const recoveryReport = { starved: [] };
    const recoveryNews = ZS.CampaignPolitics.advance(recoveryCamp, recoveryReport);

    const restCamp = ZS.Campaign.create(63002, "cao_cao");
    let restProvince = null;
    let restGeneralId = null;
    for (const id in restCamp.provinces) {
      const province = restCamp.provinces[id];
      if (province.owner === restCamp.playerFactionId && province.governor) {
        restProvince = id;
        restGeneralId = province.governor;
        break;
      }
    }
    const resting = restCamp.general(restGeneralId);
    ZS.General.wound(resting, "wounded", 2);
    resting.loyalty = 50;
    restCamp.player().food = 500;
    const restBeforeFood = restCamp.player().food;
    const restResult = ZS.Turn.rest(restCamp, restGeneralId, restProvince);

    const starvedCamp = ZS.Campaign.create(63003, "cao_cao");
    const starvedGeneral = starvedCamp.general("xun_yu");
    starvedGeneral.loyalty = 70;
    ZS.CampaignPolitics.advance(starvedCamp, { starved: ["cao_cao"] });
    out.politicsStatus = {
      recoveryNews,
      recoveryReport,
      recoveryInjury: recoveryGeneral.injury,
      recoveryTimer: recoveryGeneral.injuryT,
      restGeneralId,
      restProvince,
      restResult,
      restInjury: resting.injury,
      restLoyalty: resting.loyalty,
      restFoodSpent: restBeforeFood - restCamp.player().food,
      starvedLoyalty: starvedGeneral.loyalty,
    };

    function defectionCamp(seed) {
      const camp = ZS.Campaign.create(seed, "cao_cao");
      camp.turn = 8;
      for (const id in camp.generals) camp.generals[id].loyalty = 100;
      camp.general("xun_yu").loyalty = 0;
      return camp;
    }

    let defectionSeed = null;
    let firstDefection = null;
    for (let seed = 1; seed <= 256; seed++) {
      const camp = defectionCamp(seed);
      const news = ZS.CampaignPolitics.advance(camp, { starved: [] });
      if (news.defected.some((entry) => entry.id === "xun_yu")) {
        defectionSeed = seed;
        firstDefection = { camp, news };
        break;
      }
    }
    let secondDefection = null;
    if (defectionSeed !== null) {
      const camp = defectionCamp(defectionSeed);
      secondDefection = {
        camp,
        news: ZS.CampaignPolitics.advance(camp, { starved: [] }),
      };
    }
    const firstRecord = firstDefection && firstDefection.news.defected[0];
    const firstTarget = firstRecord && firstDefection.camp.faction(firstRecord.to);
    out.defection = {
      seed: defectionSeed,
      first: firstDefection && firstDefection.news.defected,
      second: secondDefection && secondDefection.news.defected,
      allegiance: firstDefection && firstDefection.camp.general("xun_yu").allegiance,
      oldRoster:
        firstDefection && firstDefection.camp.faction("cao_cao").generals.includes("xun_yu"),
      newRoster: !!(firstTarget && firstTarget.generals.includes("xun_yu")),
      location: firstDefection && firstDefection.camp.general("xun_yu").location,
    };

    /* ---- mandate progress and campaign completion ------------------- */
    const victoryCamp = ZS.Campaign.create(64001, "cao_cao");
    const capitals = ZS.CampaignVictory.capitalIds();
    const initialProgress = ZS.CampaignVictory.progress(victoryCamp, "cao_cao");
    const rivalCapital = capitals.find((id) => victoryCamp.owner(id) !== "cao_cao");
    victoryCamp.setOwner(rivalCapital, "cao_cao");
    const advancedProgress = ZS.CampaignVictory.progress(victoryCamp, "cao_cao");
    for (let i = 0; i < capitals.length; i++) {
      victoryCamp.prov(capitals[i]).owner = "cao_cao";
    }
    victoryCamp.recount();
    const finalProgress = ZS.CampaignVictory.progress(victoryCamp, "cao_cao");
    const victory = ZS.CampaignVictory.check(victoryCamp);
    const liveRivals = Object.keys(victoryCamp.factions).filter(
      (id) => id !== "cao_cao" && victoryCamp.factions[id].alive,
    );
    const victoryRestored = ZS.Campaign.restore(JSON.parse(JSON.stringify(victoryCamp.capture())));
    out.victory = {
      capitalCount: capitals.length,
      uniqueCapitals: new Set(capitals).size,
      initialProgress,
      advancedProgress,
      finalProgress,
      victory,
      campaignOver: victoryCamp.over,
      liveRivals: liveRivals.length,
      restoredOver: victoryRestored.over,
      restoredGoal: victoryRestored.goal,
    };

    return out;
  });

  console.log("\n[campaign Tales]");
  eq(
    "the same seed and turn enqueue the same Tale and target",
    JSON.stringify(audit.eventsDeterministic.a.first),
    JSON.stringify(audit.eventsDeterministic.b.first),
  );
  eq(
    "asking twice returns the existing Tale instead of duplicating it",
    audit.eventsDeterministic.a.queueLength,
    1,
  );
  eq(
    "the existing queue record is stable",
    JSON.stringify(audit.eventsDeterministic.a.first),
    JSON.stringify(audit.eventsDeterministic.a.second),
  );
  ok("a queued content id resolves to a definition", !!audit.eventsDeterministic.definition);
  ok("an affordable choice resolves", audit.eventChoice.result.ok, audit.eventChoice.result);
  eq("the choice spends its exact food preview", audit.eventChoice.after.food, 820);
  eq("the choice adds its exact garrison preview", audit.eventChoice.after.garrison, 1180);
  eq("the choice adds its exact loyalty preview", audit.eventChoice.after.loyalty, 56);
  eq("a resolved Tale leaves the queue", audit.eventChoice.queueLength, 0);
  eq("a resolved Tale enters history", audit.eventChoice.history[0], "refugee_column");
  eq(
    "a resolved Tale writes a campaign log entry",
    audit.eventChoice.log.key,
    "campaign.log.event",
  );
  eq("an unaffordable choice is disabled by the rules", audit.eventAffordability.canPay, false);
  eq(
    "directly attempting it returns the affordability error",
    audit.eventAffordability.refused.err,
    "campaign.err.cannotAfford",
  );
  ok("a refused choice changes no campaign state", audit.eventAffordability.unchanged);
  ok("the no-cost alternative remains available", audit.eventAffordability.fallbackAvailable);
  eq("a pending Tale survives capture/restore", audit.eventSave.pendingId, "harvest_surplus");
  eq(
    "its target record survives capture/restore",
    audit.eventSave.pendingRecord.provinceId,
    "chenliu",
  );
  eq("Tale history survives capture/restore", audit.eventSave.history.length, 2);

  console.log("\n[logistics]");
  eq("an open plain is a granary", audit.specialties.plain, "granary");
  eq("a western hill supports a horse market", audit.specialties.horse, "horse_market");
  eq("an eastern hill supports ironworks", audit.specialties.iron, "ironworks");
  eq("a river commandery is a river port", audit.specialties.port, "river_port");
  eq("woodland supplies timber", audit.specialties.timber, "timber");
  eq("marshland supports an apothecary", audit.specialties.herbs, "apothecary");
  eq("a tier-two wall takes fortress precedence", audit.specialties.fortress, "fortress");
  eq("a great city takes metropolis precedence", audit.specialties.metropolis, "metropolis");
  ok(
    "granary food changes the derived yield",
    audit.specialtyEffects.withSpecialty.food > audit.specialtyEffects.withoutSpecialty.food,
    audit.specialtyEffects,
  );
  ok(
    "river trade changes the derived income",
    audit.specialtyEffects.withSpecialty.income > audit.specialtyEffects.withoutSpecialty.income,
    audit.specialtyEffects,
  );
  ok(
    "horse markets change the derived recruit cap",
    audit.specialtyEffects.withSpecialty.recruit > audit.specialtyEffects.withoutSpecialty.recruit,
    audit.specialtyEffects,
  );
  ok(
    "fortress iron discounts wall development",
    audit.specialtyEffects.withSpecialty.wall < audit.specialtyEffects.withoutSpecialty.wall,
    audit.specialtyEffects,
  );
  ok("a horse-market province can raise a field army", audit.specialtyEffects.horseRaised);
  ok(
    "that raised army receives the cavalry specialty",
    audit.specialtyEffects.horseCavalry > audit.specialtyEffects.ordinaryCavalry,
    audit.specialtyEffects,
  );
  eq("a capital-connected army has normal supply", audit.supply.normal.status.state, "normal");
  eq("normal supply causes no incident", audit.supply.normal.rows.length, 0);
  eq("normal supply causes no losses", audit.supply.normal.troops, 1000);
  eq("normal supply causes no fatigue", audit.supply.normal.fatigue, 0);
  eq("a long owned chain is strained", audit.supply.strained.status.state, "strained");
  ok("strained supply records a distance beyond three", audit.supply.strained.status.distance > 3);
  eq("strained supply causes no attrition", audit.supply.strained.troops, 1000);
  eq("strained supply adds 4% fatigue", audit.supply.strained.fatigue, 0.04);
  eq("an isolated army is cut", audit.supply.cut.status.state, "cut");
  eq("cut supply removes exactly 3% of 1,000 men", audit.supply.cut.troops, 970);
  eq("cut supply keeps composition at 1:1 men", audit.supply.cut.men, 970);
  eq("cut supply adds 12% fatigue", audit.supply.cut.fatigue, 0.12);
  eq("the attrition incident reports the exact loss", audit.supply.cut.rows[0].lost, 30);
  eq(
    "cut supply serializes its infinite distance safely",
    audit.supply.cut.report.supply[0].state,
    "cut",
  );

  console.log("\n[politics]");
  eq("seasonal politics clears an expired wound", audit.politicsStatus.recoveryInjury, "none");
  eq(
    "healed officers are named in the seasonal report",
    audit.politicsStatus.recoveryNews.healed[0],
    "xun_yu",
  );
  ok(
    "Rest is accepted for an officer physically in a friendly city",
    audit.politicsStatus.restResult.ok,
  );
  eq("Rest advances a two-tick wound to healed", audit.politicsStatus.restInjury, "none");
  eq("Rest restores eight loyalty", audit.politicsStatus.restLoyalty, 58);
  eq("Rest spends its advertised provisions", audit.politicsStatus.restFoodSpent, 80);
  eq("a starving household loses six loyalty", audit.politicsStatus.starvedLoyalty, 64);
  ok("a deterministic low-loyalty defection seed is reachable", audit.defection.seed !== null);
  eq(
    "the same seed and turn produce the same defection",
    JSON.stringify(audit.defection.first),
    JSON.stringify(audit.defection.second),
  );
  ok("the defector leaves the old roster", !audit.defection.oldRoster, audit.defection);
  ok("the defector joins the target roster", audit.defection.newRoster, audit.defection);
  eq(
    "the mutable allegiance follows the defection",
    audit.defection.allegiance,
    audit.defection.first[0].to,
  );
  ok("the defector receives a usable location", !audit.defection.location.startsWith("army:"));

  console.log("\n[victory]");
  ok("the capital goal has at least one rival seat", audit.victory.capitalCount > 1);
  eq("capital ids are unique", audit.victory.uniqueCapitals, audit.victory.capitalCount);
  eq("capital progress reports its type", audit.victory.initialProgress.type, "capitals");
  eq(
    "taking a rival seat advances progress by one",
    audit.victory.advancedProgress.held,
    audit.victory.initialProgress.held + 1,
  );
  eq(
    "holding every seat completes progress",
    audit.victory.finalProgress.held,
    audit.victory.finalProgress.total,
  );
  eq("the capital predicate names the winner", audit.victory.victory.winner, "cao_cao");
  eq("the capital predicate names its reason", audit.victory.victory.reason, "all_capitals");
  ok(
    "capital victory can occur while rival factions still field armies",
    audit.victory.liveRivals > 0,
  );
  eq("Campaign.recount latches the victory", audit.victory.campaignOver.winner, "cao_cao");
  eq("the latched victory survives restore", audit.victory.restoredOver.winner, "cao_cao");
  eq("the capital goal survives restore", audit.victory.restoredGoal.type, "capitals");

  console.log("\n[event modal]");
  const modalSetup = await page.evaluate(() => {
    const camp = ZS.Campaign.create(65001, "liu_bei");
    camp.player().food = 0;
    const province = camp.prov("pengcheng");
    province.loyalty = 50;
    province.unrest = 0;
    camp.eventQueue.push({
      id: "refugee_column",
      turn: camp.turn,
      provinceId: "pengcheng",
    });
    ZS.App.campaign = camp;
    ZS.App.go("campaign", { campaign: camp });
    const modal = document.getElementById("camp-encounter");
    const choices = Array.from(modal.querySelectorAll("[data-event-choice]"));
    return {
      state: ZS.App.state,
      shown: modal.classList.contains("on"),
      role: modal.getAttribute("role"),
      ariaModal: modal.getAttribute("aria-modal"),
      title: (modal.querySelector("h2") || {}).textContent || "",
      expectedTitle: ZS.i18n.t(ZS.CampaignEvents.def("refugee_column").title),
      choices: choices.length,
      firstDisabled: choices[0] && choices[0].disabled,
      secondDisabled: choices[1] && choices[1].disabled,
      endDisabled: document.getElementById("btn-end-turn").disabled,
    };
  });
  eq("the queued Tale opens in the campaign state", modalSetup.state, "campaign");
  ok("the queued Tale opens the encounter modal", modalSetup.shown);
  eq("the Tale uses an accessible dialog role", modalSetup.role, "dialog");
  eq("the Tale identifies itself as modal", modalSetup.ariaModal, "true");
  eq("the modal resolves the Tale title", modalSetup.title, modalSetup.expectedTitle);
  eq("the modal renders every choice", modalSetup.choices, 2);
  ok("the UI disables an unaffordable choice", modalSetup.firstDisabled);
  ok("the UI leaves an affordable alternative enabled", !modalSetup.secondDisabled);
  ok("the End Season button is locked behind the decision", modalSetup.endDisabled);

  await page.locator('[data-event-choice="1"]').click();
  await page.waitForFunction(
    () => !document.getElementById("camp-encounter").classList.contains("on"),
  );
  const modalResult = await page.evaluate(() => {
    const camp = ZS.App.campaign;
    const province = camp.prov("pengcheng");
    const result = {
      queueLength: camp.eventQueue.length,
      history: camp.eventHistory.slice(),
      loyalty: province.loyalty,
      unrest: province.unrest,
      modalShown: document.getElementById("camp-encounter").classList.contains("on"),
      endDisabled: document.getElementById("btn-end-turn").disabled,
    };
    ZS.App.go("menu");
    result.leftCampaign = ZS.App.state === "menu";
    result.modalOrphaned = document.getElementById("camp-encounter").classList.contains("on");
    return result;
  });
  eq("clicking a choice consumes the queued Tale", modalResult.queueLength, 0);
  eq("the modal choice records history", modalResult.history[0], "refugee_column");
  eq("the modal choice applies its loyalty effect", modalResult.loyalty, 45);
  eq("the modal choice applies its unrest effect", modalResult.unrest, 1);
  ok("the resolved modal closes", !modalResult.modalShown);
  ok("resolving the Tale unlocks End Season", !modalResult.endDisabled);
  ok("the campaign view tears down after the modal", modalResult.leftCampaign);
  ok("no event modal is orphaned after teardown", !modalResult.modalOrphaned);

  console.log("\n[prisoner actions]");
  const prisonerCard = await page.evaluate(() => {
    const camp = ZS.Campaign.create(65501, "cao_cao");
    const captive = camp.faction("liu_bei").generals[0];
    camp.applyGeneralResult(captive, { outcome: "captured", captor: "cao_cao" });
    ZS.App.campaign = camp;
    ZS.App.go("campaign", { campaign: camp });
    ZS.CampaignUI.showRoster();
    const card = document.querySelector('[data-prisoner="' + captive + '"]');
    window.__p6Captive = captive;
    return {
      captive,
      shown: !!card,
      actions: card ? card.querySelectorAll("button").length : 0,
    };
  });
  ok("captured officers appear in the player's roster", prisonerCard.shown, prisonerCard);
  eq("a prisoner offers recruit, release and execute", prisonerCard.actions, 3);
  await page
    .locator('[data-prisoner="' + prisonerCard.captive + '"] button')
    .first()
    .click();
  const recruitedPrisoner = await page.evaluate(() => ({
    allegiance: ZS.App.campaign.general(__p6Captive).allegiance,
    capturedBy: ZS.App.campaign.general(__p6Captive).capturedBy,
    inRoster: ZS.App.campaign.player().generals.includes(__p6Captive),
  }));
  ok(
    "the Recruit action transfers allegiance and clears captivity",
    recruitedPrisoner.allegiance === "cao_cao" &&
      !recruitedPrisoner.capturedBy &&
      recruitedPrisoner.inRoster,
    recruitedPrisoner,
  );
  await page.evaluate(() => ZS.App.go("menu"));

  console.log("\n[victory card]");
  const victoryCard = await page.evaluate(() => {
    const camp = ZS.Campaign.create(66001, "cao_cao");
    camp.over = { winner: "cao_cao", reason: "all_capitals" };
    ZS.App.campaign = camp;
    ZS.App.go("campaign", { campaign: camp });
    ZS.CampaignUI.showOver(camp.over);
    const modal = document.getElementById("camp-encounter");
    return {
      shown: modal.classList.contains("on"),
      title: (modal.querySelector("h2") || {}).textContent,
      expected: ZS.i18n.t("campaign.over.title.win"),
      buttons: modal.querySelectorAll(".enc-actions button").length,
      endDisabled: document.getElementById("btn-end-turn").disabled,
    };
  });
  ok("campaign completion opens a persistent result card", victoryCard.shown, victoryCard);
  eq("the result card names the victory", victoryCard.title, victoryCard.expected);
  eq("the result card offers review and menu actions", victoryCard.buttons, 2);
  ok("the finished campaign cannot advance another season", victoryCard.endDisabled);
  await page.locator("#camp-encounter .enc-actions button").first().click();
  ok(
    "reviewing the finished realm closes the card",
    await page.evaluate(() => !document.getElementById("camp-encounter").classList.contains("on")),
  );
  await page.evaluate(() => ZS.App.go("menu"));

  console.log("\n[console]");
  const realErrors = errors.filter(
    (error) =>
      !/subset-data\.js|ERR_FILE_NOT_FOUND|404|ERR_NO_BUFFER_SPACE|ERR_INSUFFICIENT_RESOURCES/.test(
        error,
      ),
  );
  ok("no unexpected console or page errors", realErrors.length === 0, realErrors.slice(0, 6));

  await browser.close();
  server.close();
  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
