/* Focused P5 battle-character verification.
 *
 * Exercises the five data-defined active abilities and the deterministic duel
 * resolver without depending on ScenarioSanguo's later integration wiring.
 * The real classic-script modules run in the index page's browser realm.
 *
 * Run: node test/sanguo-p5-battle.js
 */
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

let pass = 0;
let fail = 0;
function ok(name, condition, detail) {
  if (condition) {
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("weberror", (event) => errors.push(String(event.error())));

  try {
    await page.goto(base + "/index.html");
    await page.waitForFunction(
      () => window.ZS && ZS.App && ZS.App.booted === true && ZS.BattleAbilities,
      null,
      { timeout: 15000 },
    );
    if (!(await page.evaluate(() => !!ZS.BattleDuels))) {
      await page.addScriptTag({ url: base + "/js/battle/duel.js" });
    }

    const audit = await page.evaluate(() => {
      const ALL_ACTIVES = ["charge", "fire", "ambush", "inspire", "disorder"];

      function abilityScenario(options) {
        const opts = options || {};
        const own = {
          uid: 11,
          side: 0,
          cx: 100,
          cy: 100,
          alive: 20,
          routAlive: 0,
          morale: 50,
          moraleMax: 100,
          moraleShock: 0,
          morState: ZS.BattleMorale.STEADY,
          rallyProgress: 0,
          cohesion: 0.82,
        };
        const enemy = {
          uid: 22,
          side: 1,
          cx: 240,
          cy: 120,
          alive: 20,
          routAlive: 0,
          morale: 70,
          moraleMax: 100,
          moraleShock: 0,
          morState: ZS.BattleMorale.STEADY,
          rallyProgress: 0,
          cohesion: 0.8,
        };
        const general = {
          general: true,
          generalId: "ability_general",
          side: 0,
          x: 100,
          y: 100,
          un: 0,
          zhi: opts.zhi === undefined ? 80 : opts.zhi,
          seed: 71,
          skillIds: opts.skillIds || ALL_ACTIVES.slice(),
          dead: false,
          routFlag: 0,
          gone: false,
        };
        const scenario = {
          w: 1000,
          h: 800,
          bt: 12.345,
          over: false,
          generals: [general],
          units: [own, enemy],
          reserves: [{ left: 60 }, { left: 60 }],
          orderLog: [],
          fx: [],
          orders: [],
          fires: [],
          ambushes: [],
          losPass: opts.losPass !== false,
          abilityLOS(_g, _x, _y, id) {
            this.lastLOS = id;
            return this.losPass;
          },
          order(unit, kind, x, y) {
            this.orders.push({ uid: unit.uid, kind, x, y });
            return opts.orderRefused !== true;
          },
          abilityFire(g, x, y, potency, definition) {
            this.fires.push({ g: g.generalId, x, y, potency, radius: definition.radius });
            return opts.fireRefused !== true;
          },
          abilityAmbush(g, x, y, potency, definition) {
            this.ambushes.push({ g: g.generalId, x, y, potency, count: definition.count });
            return opts.ambushRefused !== true;
          },
        };
        const abilities = new ZS.BattleAbilities(scenario);
        abilities.init();
        return { scenario, abilities, general, own, enemy };
      }

      function deterministicAbilityLog() {
        const h = abilityScenario();
        const a = h.abilities;
        a.use("inspire", h.general);
        h.general.abilityCd = 0;
        a.use("charge", h.general, h.enemy);
        h.general.abilityCd = 0;
        a.use("fire", h.general, { x: 310, y: 130 });
        h.general.abilityCd = 0;
        a.use("ambush", h.general, { x: 12, y: 400 });
        h.general.abilityCd = 0;
        a.use("disorder", h.general, h.enemy);
        return JSON.stringify(h.scenario.orderLog);
      }

      const out = {};

      const legacy = abilityScenario({ skillIds: ["inspire"], zhi: 80 });
      const legacyUsed = legacy.abilities.use("inspire", legacy.general);
      out.inspire = {
        used: legacyUsed,
        morale: legacy.own.morale,
        cooldown: legacy.general.abilityCd,
        flash: legacy.general.flash,
        log: legacy.scenario.orderLog[0],
        fx: legacy.scenario.fx[0],
      };

      const capped = abilityScenario({ skillIds: ["inspire"], zhi: 120 });
      capped.abilities.use("inspire", capped.general);
      out.inspireCap = capped.own.morale;

      const rejected = abilityScenario();
      const startLog = rejected.scenario.orderLog.length;
      const noTarget = rejected.abilities.use("charge", rejected.general);
      const noTargetError = rejected.abilities.lastError;
      rejected.scenario.losPass = false;
      const noLOS = rejected.abilities.use("fire", rejected.general, { x: 250, y: 100 });
      const noLOSError = rejected.abilities.lastError;
      rejected.scenario.losPass = true;
      const outside = rejected.abilities.use("fire", rejected.general, { x: 1200, y: 100 });
      const outsideError = rejected.abilities.lastError;
      const friendly = rejected.abilities.use("disorder", rejected.general, rejected.own);
      const friendlyError = rejected.abilities.lastError;
      const interior = rejected.abilities.use("ambush", rejected.general, { x: 500, y: 400 });
      const interiorError = rejected.abilities.lastError;
      out.reject = {
        noTarget,
        noTargetError,
        noLOS,
        noLOSError,
        outside,
        outsideError,
        friendly,
        friendlyError,
        interior,
        interiorError,
        cooldown: rejected.general.abilityCd,
        logGrowth: rejected.scenario.orderLog.length - startLog,
      };

      const learned = abilityScenario({ skillIds: ["inspire"] });
      out.unlearned = {
        used: learned.abilities.use("fire", learned.general, { x: 200, y: 100 }),
        error: learned.abilities.lastError,
      };

      const active = abilityScenario();
      const charge = active.abilities.use("charge", active.general, active.enemy);
      const chargeCd = active.general.abilityCd;
      const cooldownLog = active.scenario.orderLog.length;
      const duringCooldown = active.abilities.use("fire", active.general, { x: 200, y: 100 });
      const cooldownError = active.abilities.lastError;
      const cooldownNoLog = active.scenario.orderLog.length === cooldownLog;
      active.general.abilityCd = 0;
      const fire = active.abilities.use("fire", active.general, { x: 300, y: 130 });
      active.general.abilityCd = 0;
      const ambush = active.abilities.use("ambush", active.general, { x: 10, y: 400 });
      active.general.abilityCd = 0;
      const beforeCohesion = active.enemy.cohesion;
      const disorder = active.abilities.use("disorder", active.general, active.enemy);
      const duringCohesion = active.enemy.cohesion;
      const disorderT = active.enemy.abilityDisorderT;
      const shock = active.enemy.moraleShock;
      const logBeforeTicks = active.scenario.orderLog.length;
      const fxBeforeTicks = active.scenario.fx.length;
      const keysBeforeTicks = Object.keys(active.enemy).length;
      for (let i = 0; i < 300; i++) active.abilities.update(1 / 30);
      out.actives = {
        ids: ZS.BattleAbilities.IDS.slice(),
        charge,
        chargeCd,
        order: active.scenario.orders[0],
        ownMorale: active.own.morale,
        enemyShockAfterCharge: active.enemy.moraleShock > 0,
        duringCooldown,
        cooldownError,
        cooldownNoLog,
        fire,
        fireHook: active.scenario.fires[0],
        ambush,
        ambushHook: active.scenario.ambushes[0],
        disorder,
        beforeCohesion,
        duringCohesion,
        restoredCohesion: active.enemy.cohesion,
        disorderT,
        shock,
        updateLogStable: active.scenario.orderLog.length === logBeforeTicks,
        updateFxStable: active.scenario.fx.length === fxBeforeTicks,
        updateShapeStable: Object.keys(active.enemy).length === keysBeforeTicks,
      };
      out.abilityDeterministic = deterministicAbilityLog() === deterministicAbilityLog();

      function general(id, side, wu, x) {
        return {
          general: true,
          generalId: id,
          side,
          x,
          y: 180,
          un: side,
          hp: 12,
          wu,
          zhi: 70,
          skillIds: [],
          duelWilling: true,
          dead: false,
          routFlag: 0,
          gone: false,
        };
      }

      function duelScenario(seed, options) {
        const opts = options || {};
        const a = general("alpha", 0, opts.wuA || 82, 200);
        const b = general("beta", 1, opts.wuB || 78, opts.xB === undefined ? 250 : opts.xB);
        const scenario = {
          setup: { seed },
          seed,
          bt: 0,
          over: false,
          paused: false,
          simHold: false,
          generals: opts.reverseGenerals ? [b, a] : [a, b],
          units: [
            { moraleMax: 100, moraleShock: 0 },
            { moraleMax: 100, moraleShock: 0 },
          ],
          duelLog: [],
          killCalls: 0,
          routCalls: 0,
          roundCalls: 0,
          duelLOS() {
            return opts.los !== false;
          },
          duelRound() {
            this.roundCalls++;
          },
          duelKill(loser) {
            this.killCalls++;
            loser.dead = true;
            loser.hp = 0;
          },
          duelRout(loser) {
            this.routCalls++;
            loser.routFlag = 1;
          },
        };
        if (opts.noCallbacks) {
          delete scenario.duelKill;
          delete scenario.duelRout;
        }
        return { scenario, a, b };
      }

      function resolveDuel(seed, reverseStart, options) {
        const h = duelScenario(seed, options);
        const duels = new ZS.BattleDuels(h.scenario, {
          reach: 80,
          bestOf: 5,
          roundTime: 0.1,
          scanEvery: 0.2,
          cameraAfter: 0.9,
        });
        duels.init();
        const activeRef = duels.active;
        const cameraRef = duels.camera;
        const started = reverseStart ? duels.tryStart(h.b, h.a) : duels.tryStart(h.a, h.b);
        const cameraStart = duels.cameraInterest();
        for (let i = 0; i < 20 && duels.active.on; i++) {
          h.scenario.bt += 0.1;
          duels.update(0.1);
        }
        const cameraAfter = duels.cameraInterest();
        const row = h.scenario.duelLog[0] || null;
        const participantA = row && row.loser === h.a.generalId ? h.a : h.b;
        return {
          started,
          log: row,
          json: JSON.stringify(row),
          logLength: h.scenario.duelLog.length,
          killCalls: h.scenario.killCalls,
          routCalls: h.scenario.routCalls,
          roundCalls: h.scenario.roundCalls,
          loserDead: !!(participantA && participantA.dead),
          loserRouted: !!(participantA && participantA.routFlag),
          activeIdentity: duels.active === activeRef,
          cameraIdentity: cameraStart === cameraRef && cameraAfter === cameraRef,
          cameraStart,
          paused: h.scenario.paused,
          simHold: h.scenario.simHold,
          duels,
          harness: h,
        };
      }

      const deterministicA = resolveDuel(73001, false);
      const deterministicB = resolveDuel(73001, true, { reverseGenerals: true });
      out.duelDeterminism = {
        same: deterministicA.json === deterministicB.json,
        first: deterministicA.log,
        second: deterministicB.log,
        oneLog: deterministicA.logLength,
        roundCalls: deterministicA.roundCalls,
        activeIdentity: deterministicA.activeIdentity,
        cameraIdentity: deterministicA.cameraIdentity,
        cameraMidpoint:
          deterministicA.cameraStart &&
          deterministicA.cameraStart.x === 225 &&
          deterministicA.cameraStart.y === 180,
        paused: deterministicA.paused,
        simHold: deterministicA.simHold,
      };

      const outcomes = { killed: null, routed: null };
      for (let seed = 1; seed <= 300 && (!outcomes.killed || !outcomes.routed); seed++) {
        const result = resolveDuel(seed, false, { wuA: 80, wuB: 80 });
        if (result.log && !outcomes[result.log.outcome]) {
          outcomes[result.log.outcome] = {
            seed,
            killCalls: result.killCalls,
            routCalls: result.routCalls,
            loserDead: result.loserDead,
            loserRouted: result.loserRouted,
          };
        }
      }
      out.duelOutcomes = outcomes;

      const far = duelScenario(81, { xB: 500 });
      const farDuel = new ZS.BattleDuels(far.scenario);
      farDuel.init();
      const farStart = farDuel.tryStart(far.a, far.b);
      const farError = farDuel.lastError;
      far.b.x = 250;
      far.a.duelWilling = false;
      const unwilling = farDuel.tryStart(far.a, far.b);
      const unwillingError = farDuel.lastError;
      far.a.duelWilling = true;
      far.scenario.duelLOS = () => false;
      const blocked = farDuel.tryStart(far.a, far.b);
      const blockedError = farDuel.lastError;
      const unsupportedH = duelScenario(82, { noCallbacks: true });
      const unsupportedD = new ZS.BattleDuels(unsupportedH.scenario);
      unsupportedD.init();
      const unsupported = unsupportedD.tryStart(unsupportedH.a, unsupportedH.b);
      out.duelReject = {
        farStart,
        farError,
        unwilling,
        unwillingError,
        blocked,
        blockedError,
        unsupported,
        unsupportedError: unsupportedD.lastError,
        noLog: far.scenario.duelLog.length,
      };

      const autoH = duelScenario(901);
      const autoD = new ZS.BattleDuels(autoH.scenario, { roundTime: 1 });
      autoD.init();
      const noCameraBefore = autoD.cameraInterest() === null;
      autoD.update(0.21);
      const autoStarted = autoD.active.on;
      const activeRef = autoD.active;
      const cameraRef = autoD.cameraInterest();
      const activeKeys = Object.keys(autoD.active).length;
      const cameraKeys = Object.keys(autoD.camera).length;
      for (let i = 0; i < 20; i++) autoD.update(0.01);
      const coldStable =
        autoH.scenario.duelLog.length === 0 &&
        autoD.active === activeRef &&
        autoD.cameraInterest() === cameraRef &&
        Object.keys(autoD.active).length === activeKeys &&
        Object.keys(autoD.camera).length === cameraKeys;
      autoH.scenario.bt = 8;
      autoD.update(20);
      const cameraHeld = autoD.cameraInterest() === cameraRef;
      const oneCompletion = autoH.scenario.duelLog.length;
      for (let i = 0; i < 300; i++) autoD.update(1 / 30);
      const noRepeatGrowth = autoH.scenario.duelLog.length;
      const cameraReleased = autoD.cameraInterest() === null;
      out.duelRuntime = {
        noCameraBefore,
        autoStarted,
        coldStable,
        cameraHeld,
        cameraReleased,
        oneCompletion,
        noRepeatGrowth,
      };

      const raw = ZS.BattleDuels.attackOf({ wu: 80, skillIds: [] });
      const valiant = ZS.BattleDuels.attackOf({ wu: 80, skillIds: ["valiant"] });
      const equipped = ZS.BattleDuels.attackOf({
        baseWu: 80,
        itemIds: ["weapon:green_dragon"],
        skillIds: ["valiant"],
      });
      const supplied = ZS.BattleDuels.attackOf({
        duelAttack: 231,
        wu: 1,
        itemIds: ["weapon:green_dragon"],
        skillIds: ["valiant"],
      });
      out.attack = { raw, valiant, equipped, supplied };
      out.requiredCallbacks = ZS.BattleDuels.REQUIRED_CALLBACKS.slice();
      return out;
    });

    console.log("\n[ability compatibility + validation]");
    ok(
      "all five data-defined actives are exposed",
      audit.actives.ids.join(",") === "charge,fire,ambush,inspire,disorder",
      audit.actives.ids,
    );
    ok("legacy inspire API succeeds", audit.inspire.used, audit.inspire);
    eq("legacy inspire cooldown stays 24s", audit.inspire.cooldown, 24);
    ok(
      "legacy inspire morale formula is unchanged",
      Math.abs(audit.inspire.morale - 75.6) < 1e-9,
      audit.inspire.morale,
    );
    eq(
      "legacy inspire keeps the exact compact log kind",
      JSON.stringify(audit.inspire.log),
      JSON.stringify({ t: 12.35, k: "ability", id: "inspire", g: "ability_general" }),
    );
    ok(
      "legacy inspire emits its established FX shape",
      audit.inspire.fx.inspire === true &&
        audit.inspire.fx.r === 190 &&
        audit.inspire.fx.t === 0.85,
      audit.inspire.fx,
    );
    ok(
      "inspire retains its original 100-zhi potency cap",
      Math.abs(audit.inspireCap - 78) < 1e-9,
      audit.inspireCap,
    );
    eq("missing target is rejected", audit.reject.noTargetError, "invalid_target");
    eq("blocked LOS is rejected", audit.reject.noLOSError, "no_los");
    eq("out-of-world target is rejected", audit.reject.outsideError, "invalid_target");
    eq("friendly disorder target is rejected", audit.reject.friendlyError, "invalid_enemy");
    eq("ambush target must lie on an edge", audit.reject.interiorError, "not_edge");
    ok(
      "rejections consume neither cooldown nor log",
      audit.reject.cooldown === 0 && audit.reject.logGrowth === 0,
      audit.reject,
    );
    eq("unlearned active is rejected", audit.unlearned.error, "unlearned");

    console.log("\n[all active effects + cold update path]");
    ok(
      "charge issues the existing charge order",
      audit.actives.charge && audit.actives.order.kind === "charge",
      audit.actives.order,
    );
    eq("charge applies its data cooldown", audit.actives.chargeCd, 28);
    ok(
      "charge adds friendly morale and enemy shock",
      audit.actives.ownMorale > 50 && audit.actives.enemyShockAfterCharge,
      audit.actives,
    );
    ok(
      "cooldown rejects a second cast without a log",
      !audit.actives.duringCooldown &&
        audit.actives.cooldownError === "cooldown" &&
        audit.actives.cooldownNoLog,
      audit.actives,
    );
    ok(
      "fire validates then calls the narrow fire hook",
      audit.actives.fire &&
        audit.actives.fireHook.potency === 0.8 &&
        audit.actives.fireHook.radius === 70,
      audit.actives.fireHook,
    );
    ok(
      "ambush validates then calls the narrow ambush hook",
      audit.actives.ambush &&
        audit.actives.ambushHook.potency === 0.8 &&
        audit.actives.ambushHook.count === 24,
      audit.actives.ambushHook,
    );
    ok(
      "disorder immediately lowers cohesion and adds shock",
      audit.actives.disorder &&
        audit.actives.duringCohesion < audit.actives.beforeCohesion &&
        audit.actives.shock > 0,
      audit.actives,
    );
    ok(
      "disorder expires and restores its pre-cast ceiling",
      Math.abs(audit.actives.restoredCohesion - audit.actives.beforeCohesion) < 1e-9,
      audit.actives,
    );
    ok(
      "ability maintenance grows no records or object shape",
      audit.actives.updateLogStable &&
        audit.actives.updateFxStable &&
        audit.actives.updateShapeStable,
      audit.actives,
    );
    ok("ability order logs replay deterministically", audit.abilityDeterministic);

    console.log("\n[deterministic duel exchange]");
    ok(
      "same seed is stable across participant/list order",
      audit.duelDeterminism.same,
      audit.duelDeterminism,
    );
    eq("one completed exchange emits one duel record", audit.duelDeterminism.oneLog, 1);
    ok(
      "best-of-five completes in at most five rounds",
      audit.duelDeterminism.first.rounds <= 5 &&
        audit.duelDeterminism.roundCalls === audit.duelDeterminism.first.rounds,
      audit.duelDeterminism,
    );
    ok(
      "active and camera-interest records are reused",
      audit.duelDeterminism.activeIdentity && audit.duelDeterminism.cameraIdentity,
      audit.duelDeterminism,
    );
    ok(
      "duel camera targets the pair midpoint",
      audit.duelDeterminism.cameraMidpoint,
      audit.duelDeterminism.cameraStart,
    );
    ok(
      "duels never pause or hold the battle sim",
      !audit.duelDeterminism.paused && !audit.duelDeterminism.simHold,
      audit.duelDeterminism,
    );
    ok(
      "deterministic seeds exercise kill callback",
      audit.duelOutcomes.killed &&
        audit.duelOutcomes.killed.killCalls === 1 &&
        audit.duelOutcomes.killed.loserDead,
      audit.duelOutcomes.killed,
    );
    ok(
      "deterministic seeds exercise rout callback",
      audit.duelOutcomes.routed &&
        audit.duelOutcomes.routed.routCalls === 1 &&
        audit.duelOutcomes.routed.loserRouted,
      audit.duelOutcomes.routed,
    );

    console.log("\n[duel validation + allocation guard]");
    eq("distant generals cannot duel", audit.duelReject.farError, "out_of_reach");
    eq("unwilling generals cannot duel", audit.duelReject.unwillingError, "unwilling");
    eq("map LOS can block a duel through walls", audit.duelReject.blockedError, "no_los");
    eq(
      "missing outcome callbacks disables duels safely",
      audit.duelReject.unsupportedError,
      "unsupported",
    );
    eq("rejected duels emit no logs", audit.duelReject.noLog, 0);
    ok(
      "proximity scan starts a willing duel",
      audit.duelRuntime.noCameraBefore && audit.duelRuntime.autoStarted,
      audit.duelRuntime,
    );
    ok(
      "sub-round ticks grow no logs/state records",
      audit.duelRuntime.coldStable,
      audit.duelRuntime,
    );
    ok(
      "camera interest holds briefly then releases",
      audit.duelRuntime.cameraHeld && audit.duelRuntime.cameraReleased,
      audit.duelRuntime,
    );
    ok(
      "resolved participants cannot grow repeat logs",
      audit.duelRuntime.oneCompletion === 1 && audit.duelRuntime.noRepeatGrowth === 1,
      audit.duelRuntime,
    );

    console.log("\n[duel stat layers + integration contract]");
    eq("raw duel attack is wu * 2", audit.attack.raw, 160);
    ok(
      "valiant passive adds its 12% modifier",
      Math.abs(audit.attack.valiant - 179.2) < 1e-9,
      audit.attack,
    );
    ok(
      "raw baseWu layers weapon and valiant modifiers",
      Math.abs(audit.attack.equipped - 194.88) < 1e-9,
      audit.attack,
    );
    eq("pre-derived campaign duelAttack wins over fallback layers", audit.attack.supplied, 231);
    eq(
      "duel callback contract is explicit",
      audit.requiredCallbacks.join(","),
      "duelKill,duelRout",
    );
    eq("browser console remains clean", errors.length, 0);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  if (fail) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
