/* P1 verification (SANGUO-DESIGN.md §10).

   The P1 row: ScanarioSanguo fields Cannae-scale figures, the command layer
   selects and orders them, one formation works, and a fixed-seed battle
   replays identically.

   Run:  node test/sanguo-p1.js
         node test/sanguo-p1.js --headed     (watch it)

   Battles are driven through `ZS.engine.step(dt)` rather than in real time, so
   a 90-second fight resolves in a couple of seconds of wall clock and the
   determinism check compares two runs of the exact same tick sequence. */
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
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

/* Run one battle head-to-tail off the fixed step, with an optional script of
   player orders applied at given simulated times. Returns a fingerprint. */
const RUN_BATTLE = (seed, script, maxSec) => {
  const S = ZS.ScenarioSanguo.defaultSetup(seed);
  ZS.App.go("menu");
  ZS.App.go("battle", { setup: S });
  const eng = ZS.engine;
  const scen = eng.scenario;
  const step = 1 / 30;
  let t = 0;
  let si = 0;
  const marks = [];
  while (t < maxSec && !scen.over) {
    while (si < script.length && script[si].t <= t) {
      const s = script[si++];
      const own = scen.units.filter((u) => u.side === 0 && u.alive > 0);
      const foe = scen.units.filter((u) => u.side === 1 && u.alive > 0);
      const u = own[s.unit % (own.length || 1)];
      if (u && foe.length) {
        let fx = 0, fy = 0;
        for (const e of foe) { fx += e.cx; fy += e.cy; }
        fx /= foe.length;
        fy /= foe.length;
        if (s.form) scen.setFormation(u, s.form);
        else scen.order(u, s.kind, fx + (s.dx || 0), fy + (s.dy || 0));
      }
    }
    eng.step(step);
    t += step;
    if (Math.abs(t % 10) < step) {
      marks.push([Math.round(t), scen.sides[0].alive, scen.sides[1].alive, scen.sides[0].dead, scen.sides[1].dead]);
    }
  }
  /* A positional digest of every living man: the strongest statement that two
     runs produced the same battle, not just the same score. */
  let digest = 0;
  const agents = ZS.Sim.agents;
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    digest = (digest * 31 + Math.round(a.x * 8)) | 0;
    digest = (digest * 31 + Math.round(a.y * 8)) | 0;
    digest = (digest * 31 + (a.dead ? 1 : 0) + (a.routFlag ? 2 : 0)) | 0;
  }
  return {
    seed,
    over: scen.over,
    result: scen.result,
    t: Math.round(t * 100) / 100,
    units: scen.units.length,
    agents: agents.length,
    s0: { ...scen.sides[0] },
    s1: { ...scen.sides[1] },
    orders: scen.orderLog.length,
    marks,
    digest,
  };
};

async function main() {
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch(HEADED ? { headless: false, channel: "chrome" } : {});
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("weberror", (e) => errors.push(String(e.error())));
  await page.goto(base + "/index.html");
  await page.waitForFunction(() => window.ZS && ZS.App && ZS.App.booted === true, null, {
    timeout: 15000,
  });

  /* ---- entering a battle ------------------------------------------- */
  console.log("\n[deploy]");
  await page.evaluate(() => ZS.App.go("battle"));
  await page.waitForFunction(() => ZS.engine && ZS.Sim.agents.length > 0, null, { timeout: 15000 });

  const dep = await page.evaluate(() => {
    const s = ZS.engine.scenario;
    const byType = {};
    for (const u of s.units) byType[u.type] = (byType[u.type] || 0) + u.size0;
    return {
      state: ZS.App.state,
      appLoop: ZS.App.running,
      engineRunning: ZS.engine.running,
      fixedStep: Math.round(ZS.engine.fixedStep * 1000) / 1000,
      agents: ZS.Sim.agents.length,
      units: s.units.length,
      side0: s.sides[0].total0,
      side1: s.sides[1].total0,
      byType,
      menuHidden: !document.querySelector(".panel.on"),
      barShown: !!document.querySelector(".battlebar.on"),
      commandBound: ZS.Command.bound,
      hudTitle: s.hud([], 1).title,
    };
  });
  eq("the shell is in the BATTLE state", dep.state, "battle");
  eq("the shell's own loop stood down", dep.appLoop, false);
  ok("the engine loop is running", dep.engineRunning);
  eq("the sim runs on a 1/30 s fixed step", dep.fixedStep, 0.033);
  eq("both sides deployed at 1 figure = 1 man", dep.side0 + dep.side1, 2000);
  eq("every man is an agent", dep.agents, 2000);
  ok("the army split into blocks", dep.units >= 8, dep);
  ok("all default unit types are fielded", Object.keys(dep.byType).length === 12, dep.byType);
  ok("the menu got out of the way", dep.menuHidden);
  ok("the battle bar is up", dep.barShown);
  ok("the command layer attached", dep.commandBound);
  eq("the HUD speaks the current locale", dep.hudTitle, "沙場試鋒");

  /* ---- selection and orders ---------------------------------------- */
  console.log("\n[command]");
  const cmd = await page.evaluate(() => {
    const s = ZS.engine.scenario;
    const C = ZS.Command;
    const own = s.units.filter((u) => u.side === 0);
    const foe = s.units.filter((u) => u.side === 1);
    const out = {};

    // click-select the first block by pointing at one of its men
    const m = own[0].mem.find((x) => !x.dead);
    C.pointerDown(m.x, m.y, { button: 0 });
    C.pointerUp(m.x, m.y, { button: 0 });
    out.clickSel = C.selection.length;
    out.clickedRight = C.selection[0] === own[0];

    // a box drawn around the player's deployment takes everything of ours
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const u of own) {
      for (const m of u.mem) {
        if (m.x < x0) x0 = m.x;
        if (m.y < y0) y0 = m.y;
        if (m.x > x1) x1 = m.x;
        if (m.y > y1) y1 = m.y;
      }
    }
    C.pointerDown(x0 - 20, y0 - 20, { button: 0 });
    C.pointerMove(x1 + 20, y1 + 20);
    C.pointerUp(x1 + 20, y1 + 20, { button: 0 });
    out.boxSel = C.selection.length;
    out.ownTotal = own.length;
    out.ownOnly = C.selection.every((u) => u.side === 0);

    // ...and the same gesture over the enemy half takes nothing
    let ex0 = Infinity, ey0 = Infinity, ex1 = -Infinity, ey1 = -Infinity;
    for (const u of foe) {
      for (const m of u.mem) {
        if (m.x < ex0) ex0 = m.x;
        if (m.y < ey0) ey0 = m.y;
        if (m.x > ex1) ex1 = m.x;
        if (m.y > ey1) ey1 = m.y;
      }
    }
    C.pointerDown(Math.max(ex0, x1 + 40), ey0, { button: 0 });
    C.pointerMove(ex1, ey1);
    C.pointerUp(ex1, ey1, { button: 0 });
    out.boxOverEnemy = C.selection.length;
    out.foeNeverSelectable = C.select(foe, false) === 0;

    // control groups
    C.select([own[0], own[1]], false);
    C.key({ key: "2", ctrlKey: true, preventDefault() {} });
    C.clear();
    C.key({ key: "2", preventDefault() {} });
    out.group = C.selection.length;

    // A selects everything alive we own
    C.key({ key: "a", preventDefault() {} });
    out.selectAll = C.selection.length;

    // an order reaches the unit and is logged for replay. The target has to
    // be genuinely empty ground — right-clicking near any enemy is a charge.
    const empty = { x: own[0].cx, y: own[0].cy - 600 };
    const before = s.orderLog.length;
    C.select([own[0]], false);
    C.issue(empty.x, empty.y, { button: 2 });
    out.orderKind = own[0].orders.length ? own[0].orders[0].kind : null;
    out.logged = s.orderLog.length - before;
    out.hasFlowField = !!own[0].ff && own[0].ff.built;

    // right-clicking an enemy block is a charge, not a march
    const fm = foe[0].mem.find((x) => !x.dead);
    C.issue(fm.x, fm.y, { button: 2 });
    out.chargeKind = own[0].orders.length ? own[0].orders[0].kind : null;

    // ctrl+right is a plain march
    C.issue(empty.x, empty.y, { button: 2, ctrlKey: true });
    out.moveKind = own[0].orders.length ? own[0].orders[0].kind : null;

    // shift queues instead of replacing
    C.issue(empty.x + 100, empty.y, { button: 2, shiftKey: true });
    out.queued = own[0].orders.length;

    // formations are data and can change mid-fight
    const f0 = own[0].form;
    C.select([own[0]], false);
    C.cycleFormation();
    out.formChanged = own[0].form !== f0;
    out.slotsRebuilt = own[0].slots.length === own[0].mem.length;

    // halt clears the queue
    C.halt();
    out.halted = own[0].st === ZS.ScenarioSanguo.STATES.HOLD;
    return out;
  });
  eq("click-select picks one block", cmd.clickSel, 1);
  ok("...and it is the block that was clicked", cmd.clickedRight);
  eq("box-select takes the whole line", cmd.boxSel, cmd.ownTotal);
  eq("a box over the enemy half takes nothing", cmd.boxOverEnemy, 0);
  ok("selection never contains the enemy", cmd.ownOnly && cmd.foeNeverSelectable);
  eq("ctrl+2 stores a control group, 2 recalls it", cmd.group, 2);
  ok("A selects everything you own", cmd.selectAll >= cmd.boxSel, cmd);
  eq("right-click on ground is attack-move", cmd.orderKind, "attack");
  eq("the order was logged for replay", cmd.logged, 1);
  ok("the order built a flow field", cmd.hasFlowField);
  eq("right-click on an enemy block charges it", cmd.chargeKind, "charge");
  eq("ctrl+right-click is a plain march", cmd.moveKind, "move");
  eq("shift queues behind the current order", cmd.queued, 2);
  ok("F changes the formation and re-cuts the slots", cmd.formChanged && cmd.slotsRebuilt);
  ok("H halts the selection", cmd.halted);

  /* ---- pause / speed ------------------------------------------------ */
  console.log("\n[tempo]");
  const tempo = await page.evaluate(() => {
    const C = ZS.Command;
    const out = {};
    ZS.engine.speed = 1;
    C.key({ key: " ", preventDefault() {} });
    out.paused = ZS.engine.speed;
    const t0 = ZS.engine.simT;
    // a paused engine advances no simulation, but orders still land (§4.4, Q5)
    const s = ZS.engine.scenario;
    const own = s.units.filter((u) => u.side === 0 && u.alive > 0)[0];
    const okOrder = s.order(own, "attack", 2000, 1300);
    out.orderedWhilePaused = okOrder;
    out.simStill = ZS.engine.simT === t0;
    C.key({ key: " ", preventDefault() {} });
    out.resumed = ZS.engine.speed;
    C.key({ key: ".", preventDefault() {} });
    C.key({ key: ".", preventDefault() {} });
    out.fast = ZS.engine.speed;
    ZS.engine.speed = 1;
    return out;
  });
  eq("space pauses", tempo.paused, 0);
  ok("orders still work while paused (active pause, Q5)", tempo.orderedWhilePaused);
  ok("...and no simulation ran", tempo.simStill);
  eq("space resumes", tempo.resumed, 1);
  eq(". steps the speed up to 4x", tempo.fast, 4);

  /* ---- a battle, end to end ---------------------------------------- */
  console.log("\n[battle]");
  /* Offsets are from the enemy army's centroid: march the two spear blocks
     onto their line, bring the sword block up behind, send the horse around
     the northern flank, then square up the first block. */
  const script = [
    { t: 1, unit: 0, kind: "attack", dx: 0, dy: -90 },
    { t: 1, unit: 1, kind: "attack", dx: 0, dy: 90 },
    { t: 2, unit: 2, kind: "attack", dx: -60, dy: 0 },
    { t: 6, unit: 4, kind: "charge", dx: 120, dy: -240 },
    { t: 12, unit: 3, kind: "attack", dx: -120, dy: 0 },
    { t: 30, unit: 0, form: "square" },
  ];
  const a = await page.evaluate(
    ({ src, script }) => new Function("seed", "script", "maxSec", "return (" + src + ")(seed, script, maxSec)")(4242, script, 240),
    { src: RUN_BATTLE.toString(), script },
  );
  console.log(
    "        " +
      a.t +
      "s · winner side " +
      a.result +
      " · yours " +
      a.s0.dead +
      "d/" +
      a.s0.routed +
      "r · theirs " +
      a.s1.dead +
      "d/" +
      a.s1.routed +
      "r",
  );
  ok("the battle reaches a decision", a.over, a);
  ok("it takes a battle's worth of time, not a moment", a.t > 20 && a.t < 240, a.t);
  ok("men actually died on both sides", a.s0.dead > 0 && a.s1.dead > 0, a);
  ok("the losing side broke rather than dying to the last man", a.s0.routed + a.s1.routed > 0, a);
  ok(
    "the ledger balances (dead + routed + standing = deployed)",
    a.s0.dead + a.s0.routed + a.s0.alive === a.s0.total0 &&
      a.s1.dead + a.s1.routed + a.s1.alive === a.s1.total0,
    { s0: a.s0, s1: a.s1 },
  );
  ok("player orders were recorded", a.orders >= script.length, a.orders);

  /* ---- determinism (§3.6) ------------------------------------------- */
  console.log("\n[determinism]");
  const b = await page.evaluate(
    ({ src, script }) => new Function("seed", "script", "maxSec", "return (" + src + ")(seed, script, maxSec)")(4242, script, 240),
    { src: RUN_BATTLE.toString(), script },
  );
  eq("same seed + same orders -> same duration", b.t, a.t);
  eq("...same winner", b.result, a.result);
  eq("...same casualties", JSON.stringify(b.s0) + JSON.stringify(b.s1), JSON.stringify(a.s0) + JSON.stringify(a.s1));
  eq("...same men in the same places (position digest)", b.digest, a.digest);
  eq("...same story along the way", JSON.stringify(b.marks), JSON.stringify(a.marks));

  const c = await page.evaluate(
    ({ src, script }) => new Function("seed", "script", "maxSec", "return (" + src + ")(seed, script, maxSec)")(99, script, 240),
    { src: RUN_BATTLE.toString(), script },
  );
  ok("a different seed fights a different battle", c.digest !== a.digest, { a: a.digest, c: c.digest });

  /* ---- robustness: every one of these is a bug that was shipped once ---- */
  console.log("\n[robustness]");

  /* A battle must always reach a decision, even against a player who never
     gives an order. Blocks used to wedge in map corners, brake to a halt for
     men running away, and chase routers off the field one at a time; any of
     those left a fight that ran for ever. */
  const sweep = await page.evaluate(() => {
    const step = 1 / 30;
    const rows = [];
    let ledgerBad = null;
    for (const seed of [11, 14, 15, 17, 19, 22, 24, 26]) {
      ZS.App.go("menu");
      ZS.App.go("battle", { setup: ZS.ScenarioSanguo.defaultSetup(seed) });
      const eng = ZS.engine,
        s = eng.scenario;
      for (let i = 0; i < 200 * 30 && !s.over; i++) {
        eng.step(step);
        for (let k = 0; k < 2; k++) {
          const sd = s.sides[k];
          if (!ledgerBad && (sd.alive < 0 || sd.routed < 0 || sd.dead < 0)) {
            ledgerBad = { seed, side: k, why: "negative", ...sd };
          }
          if (!ledgerBad && sd.dead + sd.routed + sd.alive !== sd.total0) {
            ledgerBad = { seed, side: k, why: "sum", ...sd };
          }
        }
      }
      rows.push({ seed, over: s.over, t: Math.round(s.bt) });
    }
    ZS.App.go("menu");
    return { rows, ledgerBad };
  });
  const unresolved = sweep.rows.filter((r) => !r.over);
  ok("every seed reaches a decision (8 battles, passive player)", unresolved.length === 0, unresolved);
  ok(
    "...in a battle's worth of time",
    sweep.rows.every((r) => r.t >= 20 && r.t <= 200),
    sweep.rows.map((r) => r.t),
  );
  ok("the side ledger never goes negative or stops summing", sweep.ledgerBad === null, sweep.ledgerBad);

  const robust = await page.evaluate(() => {
    const out = {};
    const step = 1 / 30;

    /* A man running away is cut down, not stopped for. */
    ZS.App.go("battle", { setup: ZS.ScenarioSanguo.defaultSetup(9) });
    {
      const s = ZS.engine.scenario;
      const u = s.units.find((x) => x.side === 0 && x.type === 0);
      const foe = s.units.find((x) => x.side === 1);
      for (const fu of s.units) {
        if (fu.side !== 1) continue;
        for (const m of fu.mem) if (!(fu === foe && m === foe.mem[0])) m.dead = true;
      }
      const r = foe.mem[0];
      r.fleeing = true;
      r.routFlag = 1;
      r.free = true;
      r.hp = 9999;
      for (let i = 0; i < 20; i++) ZS.engine.step(step);
      s.order(u, "attack", u.cx + 700, u.cy);
      const x0 = u.cx;
      for (let i = 0; i < 120; i++) {
        ZS.engine.step(step);
        r.x = u.cx + 8; // glued to the block's face
        r.y = u.cy;
        r.vx = 0;
        r.vy = 0;
      }
      out.stragglerMoved = Math.round(u.cx - x0);
    }
    ZS.App.go("menu");

    /* Battle hotkeys stay out of form fields. */
    ZS.App.go("battle");
    {
      const inp = document.getElementById("set-master");
      ZS.Command.clear();
      ZS.Command.key({ key: "a", target: inp, preventDefault() {} });
      out.selWhileTyping = ZS.Command.selection.length;
      ZS.Command.key({ key: "a", preventDefault() {} });
      out.selNormally = ZS.Command.selection.length;
    }

    /* Order markers fade on elapsed time, not on an assumed frame rate. */
    {
      const C = ZS.Command;
      const c2 = document.createElement("canvas").getContext("2d");
      C.marks.length = 0;
      C.lastT = null;
      C.marks.push({ x: 0, y: 0, t: 1.0, kind: "attack" });
      C.drawWorld(c2, ZS.engine.scenario, 100); // first draw only stamps the clock
      C.drawWorld(c2, ZS.engine.scenario, 100.2); // a fifth of a second later
      out.markAfterTick = C.marks.length ? +C.marks[0].t.toFixed(2) : "gone";
      C.marks.length = 0;
    }

    /* Going to a phase that does not exist yet must not disturb the battle.
       This was "campaign" until P3 built it; RESULT is the last phase in the
       §2 state machine that has no view, so it is the one that still tests
       the refusal path (bug 14). */
    {
      const scen = ZS.engine.scenario;
      const before = { agents: ZS.Sim.agents.length, running: ZS.engine.running };
      const ret = ZS.App.go("result");
      out.unknownState = {
        returned: ret,
        state: ZS.App.state,
        sameScenario: ZS.engine.scenario === scen,
        sameAgents: ZS.Sim.agents.length === before.agents,
        stillRunning: ZS.engine.running === before.running,
      };
    }
    ZS.App.go("menu");

    /* A refused goal leaves the unit's orders alone. */
    ZS.App.go("battle");
    {
      const s = ZS.engine.scenario;
      const u = s.units.find((x) => x.side === 0);
      s.order(u, "attack", u.cx + 200, u.cy);
      const tx = u.tx,
        ty = u.ty;
      const okGoal = s._setGoal(u, -5000, -5000); // nowhere
      out.refusedGoal = { accepted: okGoal, keptTarget: u.tx === tx && u.ty === ty };
    }
    ZS.App.go("menu");
    return out;
  });
  ok("an advance is not halted by a man running away", robust.stragglerMoved > 60, robust);
  eq("hotkeys do not fire while typing in a field", robust.selWhileTyping, 0);
  ok("...but do fire otherwise", robust.selNormally > 0, robust);
  eq("order markers fade on elapsed time", robust.markAfterTick, 0.8);
  eq("go() to an unbuilt phase is refused", robust.unknownState.returned, false);
  ok(
    "...and leaves the running battle untouched",
    robust.unknownState.state === "battle" &&
      robust.unknownState.sameScenario &&
      robust.unknownState.sameAgents &&
      robust.unknownState.stillRunning,
    robust.unknownState,
  );
  eq("an unreachable goal is refused", robust.refusedGoal.accepted, false);
  ok("...and leaves the current order intact", robust.refusedGoal.keptTarget, robust.refusedGoal);

  /* ---- leaving ------------------------------------------------------ */
  console.log("\n[teardown]");
  const down = await page.evaluate(() => {
    ZS.App.go("menu");
    return {
      state: ZS.App.state,
      appLoop: ZS.App.running,
      engineRunning: ZS.engine.running,
      commandBound: ZS.Command.bound,
      fx: ZS.fx.length,
      menuBack: !!document.querySelector('.panel[data-panel="main"].on'),
      barGone: !document.querySelector(".battlebar.on"),
    };
  });
  eq("back in the MENU state", down.state, "menu");
  ok("the shell's loop took over again", down.appLoop);
  eq("the battle engine stopped", down.engineRunning, false);
  eq("the command layer released its listeners", down.commandBound, false);
  eq("effects were cleared", down.fx, 0);
  ok("the menu is back and the battle bar is gone", down.menuBack && down.barGone);

  console.log("\n[console]");
  const real = errors.filter((e) => !/subset-data\.js|ERR_FILE_NOT_FOUND|404/.test(e));
  ok("no unexpected console errors", real.length === 0, real.slice(0, 4));

  await browser.close();
  server.close();
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
