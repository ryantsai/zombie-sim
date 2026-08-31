/* The Hold P4 — tiles, persistence, wave planning and the complete night loop.

   The reference-page regression only proves that reference/hold.html boots.
   This suite guards the rules a player can otherwise exploit: dig cannot
   exceed its budget or pass through buildings, reinforced saves keep their
   max HP, every planned walker exists, spawns enter from valid grass at the
   world edge, night controls lock, and a completed night cannot be replayed
   by reloading its dawn card.

   node reference/test/hold-p4.js */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../..");
const SAVE_KEY = "zs.hold.v1";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
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

async function boot(page) {
  await page.waitForFunction(() => window.ZS && ZS.debug && ZS.debug.scenario, null, {
    timeout: 10000,
  });
  await page.evaluate(() => ZS.engine.stop());
}

async function reset(page) {
  await page.evaluate((key) => {
    ZS.scenario._wiped = true;
    localStorage.removeItem(key);
  }, SAVE_KEY);
  await page.reload();
  await boot(page);
}

async function main() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    const file = path.join(ROOT, rel || "reference/hold.html");
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("weberror", (e) => errors.push(String(e.error())));
  await page.addInitScript(() => {
    window.ZS_NIGHT_LEN = 2;
  });
  await page.goto("http://127.0.0.1:" + server.address().port + "/reference/hold.html");
  await boot(page);

  console.log("\n[boot + tile rules]");
  const bootState = await page.evaluate(() => ({
    scenario: ZS.scenario.constructor.name,
    phase: ZS.scenario.phase,
    day: ZS.scenario.day,
    size: [ZS.debug.world.w, ZS.debug.world.h],
  }));
  ok(
    "The Hold boots into a playable day",
    bootState.scenario === "ScenarioHold" && bootState.phase === "day",
  );
  ok(
    "the authored tile world is 1600×1200",
    bootState.size[0] === 1600 && bootState.size[1] === 1200,
    bootState,
  );

  const dig = await page.evaluate(() => {
    const s = ZS.scenario;
    s.tool = ZS.Tiles.WATER;
    s.dig = 10;
    const changed = s.digTo(460, 60, { x: 60, y: 60 });
    let water = 0;
    for (let tx = 0; tx < s.tiles.cols; tx++) if (s.tiles.typeAt(tx, 1) === ZS.Tiles.WATER) water++;
    s.dig = 5;
    const coreBefore = s.tiles.typeAt(19, 14);
    const coreChanged = s.digTo(780, 580, null);
    return {
      changed,
      water,
      dig: s.dig,
      coreBefore,
      coreAfter: s.tiles.typeAt(19, 14),
      coreChanged,
    };
  });
  ok("a drag spends at most the available dig budget", dig.changed === 2 && dig.water === 2, dig);
  ok(
    "occupied core tiles cannot be dredged",
    dig.coreChanged === 0 && dig.coreAfter === dig.coreBefore && dig.dig === 5,
    dig,
  );

  console.log("\n[reinforced save]");
  await page.evaluate((key) => {
    ZS.scenario._wiped = true;
    localStorage.setItem(
      key,
      JSON.stringify({
        v: 2,
        day: 4,
        dig: 35,
        scrap: 500,
        food: 200,
        coreHp: 900,
        tiles: [],
        blocks: [[18, 14, "wall", 250]],
        up: { gloves: 0, weapon: 0, armor: 0, training: 0, morale: 0, reinforced: 1 },
        soldiers: [],
      }),
    );
  }, SAVE_KEY);
  await page.reload();
  await boot(page);
  const restored = await page.evaluate(() => {
    const wall = ZS.scenario.blocks.list.find((b) => b.kind === "wall");
    return { day: ZS.scenario.day, hp: wall && wall.hp, maxHp: wall && wall.maxHp };
  });
  ok(
    "a reinforced wall restores its upgraded max HP",
    restored.hp === 250 && restored.maxHp === 300,
    restored,
  );

  console.log("\n[wave plan + edge entry]");
  await reset(page);
  const plans = await page.evaluate(() => {
    const s = ZS.scenario;
    const rows = [];
    for (let day = 1; day <= 12; day++) {
      s.day = day;
      s._planNight();
      const first = JSON.stringify(s._sq);
      s._planNight();
      rows.push({
        day,
        expected: 10 + day * 4 + Math.floor(Math.pow(day, 1.4)),
        actual: s._sq.length,
        stable: first === JSON.stringify(s._sq),
        sorted: s._sq.every((row, i, all) => i === 0 || all[i - 1].t <= row.t),
      });
    }
    return rows;
  });
  ok(
    "every planned wave contains the full design count",
    plans.every((r) => r.actual === r.expected),
    plans,
  );
  ok(
    "wave schedules are deterministic and time-sorted",
    plans.every((r) => r.stable && r.sorted),
    plans,
  );

  const entries = await page.evaluate(() => {
    const s = ZS.scenario;
    for (let ty = 0; ty < s.tiles.rows; ty++) s.tiles.set(0, ty, ZS.Tiles.WATER);
    const rows = [];
    for (let i = 0; i < 120; i++) {
      const p = s._spawnPoint();
      const tx = Math.floor(p.x / ZS.Tiles.TILE);
      const ty = Math.floor(p.y / ZS.Tiles.TILE);
      rows.push({
        tx,
        ty,
        ground: s.tiles.typeAt(tx, ty),
        walkable: ZS.debug.nav.isWalkable(p.x, p.y, true),
        edge: tx === 0 || ty === 0 || tx === s.tiles.cols - 1 || ty === s.tiles.rows - 1,
      });
    }
    return rows;
  });
  ok(
    "walkers spawn on walkable grass at a world edge",
    entries.every((r) => r.edge && r.ground === 0 && r.walkable),
    entries.slice(0, 8),
  );
  ok(
    "a blocked edge redistributes its walkers",
    entries.every((r) => r.tx !== 0),
    entries.slice(0, 8),
  );

  console.log("\n[night controls]");
  const locked = await page.evaluate(() => {
    const s = ZS.scenario;
    s.phase = "night";
    s.scrap = 1000;
    const before = s.scrap;
    const weapon = s.up.weapon;
    document.querySelector("#pile").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.querySelector('[data-up="weapon"]').click();
    return { before, after: s.scrap, weapon, weaponAfter: s.up.weapon };
  });
  ok("the scrap pile is day-only", locked.after === locked.before, locked);
  ok("upgrades cannot be bought during a night", locked.weaponAfter === locked.weapon, locked);

  console.log("\n[scripted night]");
  await reset(page);
  const scripted = await page.evaluate(() => {
    const s = ZS.scenario;
    s.startNight();
    const planned = s._sq.length;
    const step = 1 / 30;
    for (let i = 0; i < Math.ceil(3.2 / step); i++) ZS.engine.step(step);
    const enteredNight = s.phase === "night" && s.nightT > 0;
    for (let i = 0; i < Math.ceil(2.2 / step); i++) ZS.engine.step(step);
    const saved = JSON.parse(localStorage.getItem("zs.hold.v1"));
    return {
      planned,
      enteredNight,
      phase: s.phase,
      paused: s.paused,
      title: s.card && s.card.title,
      queue: s._sq.length,
      savedDay: saved && saved.day,
    };
  });
  ok("darkness falls advances through dusk into the live wave", scripted.enteredNight, scripted);
  ok("night 1 schedules all 15 walkers", scripted.planned === 15, scripted);
  ok(
    "the night deadline clears the queue into a persisted dawn card",
    scripted.phase === "dawn" &&
      scripted.paused &&
      scripted.queue === 0 &&
      /survived/.test(scripted.title) &&
      scripted.savedDay === 2,
    scripted,
  );

  console.log("\n[night clear + dawn persistence]");
  await reset(page);
  const clear = await page.evaluate(() => {
    const s = ZS.scenario;
    s.scrap = 0;
    s.startNight();
    s.phase = "night";
    s.phaseT = 0;
    s._sq = [];
    for (let i = 0; i < 15; i++) {
      const z = s.debugSpawnZombie(80 + i * 5, 80);
      s._hitZombie(z, z.hp);
    }
    ZS.engine.step(1 / 30);
    const saved = JSON.parse(localStorage.getItem("zs.hold.v1"));
    return {
      phase: s.phase,
      paused: s.paused,
      title: s.card && s.card.title,
      kills: s._n && s._n.kills,
      scrap: s.scrap,
      savedDay: saved && saved.day,
      savedDig: saved && saved.dig,
    };
  });
  ok(
    "clearing every walker opens the dawn result card",
    clear.phase === "dawn" && clear.paused && /survived/.test(clear.title),
    clear,
  );
  ok(
    "kill rewards and the 10% early-clear bonus balance",
    clear.kills === 15 && clear.scrap === 33,
    clear,
  );
  ok(
    "the dawn save is already advanced to the next day",
    clear.savedDay === 2 && clear.savedDig === 25,
    clear,
  );

  await page.reload();
  await boot(page);
  const afterDawnReload = await page.evaluate(() => ({
    day: ZS.scenario.day,
    phase: ZS.scenario.phase,
    scrap: ZS.scenario.scrap,
  }));
  ok(
    "reloading a completed dawn cannot replay its rewarded night",
    afterDawnReload.day === 2 && afterDawnReload.phase === "day" && afterDawnReload.scrap === 33,
    afterDawnReload,
  );

  console.log("\n[soft fail]");
  await reset(page);
  const loss = await page.evaluate(() => {
    const s = ZS.scenario;
    s.scrap = 100;
    s.food = 100;
    s.day = 2;
    s._planNight();
    s.phase = "night";
    s.blocks.damage(s.blocks.core, 99999);
    ZS.engine.step(1 / 30);
    const saved = JSON.parse(localStorage.getItem("zs.hold.v1"));
    return {
      lost: s.card && s.card.lost,
      scrap: s.scrap,
      food: s.food,
      coreHp: s.blocks.core && s.blocks.core.hp,
      paused: s.paused,
      preview: s.card && s.card.lines.find((line) => line.startsWith("tomorrow:")),
      savedDay: saved && saved.day,
    };
  });
  ok(
    "core loss applies the documented 40% scrap / 30% food penalty",
    loss.lost && loss.scrap === 60 && loss.food === 70,
    loss,
  );
  ok(
    "soft fail rebuilds the core and pauses on a result",
    loss.coreHp === 1000 && loss.paused,
    loss,
  );
  ok(
    "the result previews tomorrow and persists the advanced day",
    !!loss.preview && loss.savedDay === 3,
    loss,
  );

  ok("the Hold emits no browser errors", errors.length === 0, errors);

  await browser.close();
  server.close();
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
