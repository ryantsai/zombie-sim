/* P5 general-ability command UI integration.

   Verifies the actual DOM buttons, hotkey mode, pointer targeting and shared
   cooldown feedback against a live ScenarioSanguo battle. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
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

(async () => {
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
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto("http://127.0.0.1:" + server.address().port + "/index.html");
  await page.waitForFunction(() => window.ZS && ZS.App && ZS.App.booted);

  await page.evaluate(() => {
    const setup = ZS.ScenarioSanguo.defaultSetup(55119);
    setup.sides[0].onField = 900;
    setup.sides[0].reserve = 100;
    setup.sides[0].generals[0].skillIds = ZS.BattleAbilities.IDS.slice();
    setup.field = { kind: "open", biome: "plain", variant: 0 };
    ZS.App.go("battle", { setup });
    ZS.engine.speed = 0;
  });
  await page.waitForTimeout(120);

  const initial = await page.evaluate(() => ({
    state: ZS.App.state,
    shown: document.getElementById("battle-abilities").classList.contains("on"),
    ids: Array.from(document.querySelectorAll("#battle-abilities [data-ability]")).map((b) =>
      b.getAttribute("data-ability"),
    ),
    enabled: Array.from(document.querySelectorAll("#battle-abilities [data-ability]")).every(
      (b) => !b.disabled,
    ),
  }));
  console.log("\n[ability bar]");
  ok(
    "the live battle exposes the ability bar",
    initial.state === "battle" && initial.shown,
    initial,
  );
  ok(
    "all five active abilities are present in command order",
    initial.ids.join(",") === "charge,fire,ambush,inspire,disorder",
    initial.ids,
  );
  ok("learned abilities begin enabled", initial.enabled, initial);

  await page.keyboard.press("q");
  const chargeMode = await page.evaluate(() => ({
    mode: ZS.Command.abilityMode,
    on: document.querySelector('[data-ability="charge"]').classList.contains("on"),
  }));
  console.log("\n[target modes]");
  ok("Q enters charge targeting and marks its chip", chargeMode.mode === "charge" && chargeMode.on);
  await page.keyboard.press("Escape");
  ok(
    "Escape cancels a targeted ability",
    await page.evaluate(() => ZS.Command.abilityMode === null),
  );

  async function worldClick(pointExpression) {
    const point = await page.evaluate(pointExpression);
    await page.mouse.click(point.x, point.y);
  }

  await page.click('[data-ability="fire"]');
  await worldClick(() => {
    const g = ZS.Command.playerGeneral();
    const cam = ZS.debug.cam;
    return {
      x: (g.x + 120 - cam.x) * cam.zoom + innerWidth / 2,
      y: (g.y - cam.y) * cam.zoom + innerHeight / 2,
    };
  });
  const fire = await page.evaluate(() => ({
    mode: ZS.Command.abilityMode,
    log: ZS.engine.scenario.orderLog.at(-1),
    patches: ZS.engine.scenario.firePatches.filter((p) => p.active).length,
    cooldown: ZS.Command.playerGeneral().abilityCd,
    disabled: document.querySelector('[data-ability="fire"]').disabled,
  }));
  ok(
    "button + world click casts fire and consumes targeting mode",
    fire.mode === null && fire.log.id === "fire" && fire.patches > 0,
    fire,
  );
  ok(
    "a cast starts cooldown and disables the command bar",
    fire.cooldown > 0 && fire.disabled,
    fire,
  );

  await page.evaluate(() => {
    ZS.Command.playerGeneral().abilityCd = 0;
    ZS.UI.updateBattleAbilities();
  });
  await page.click('[data-ability="inspire"]');
  const inspire = await page.evaluate(() => ZS.engine.scenario.orderLog.at(-1));
  ok(
    "Inspire casts immediately without a target click",
    inspire && inspire.id === "inspire",
    inspire,
  );

  await page.evaluate(() => {
    ZS.Command.playerGeneral().abilityCd = 0;
    ZS.UI.updateBattleAbilities();
  });
  await page.click('[data-ability="ambush"]');
  await worldClick(() => {
    const cam = ZS.debug.cam;
    return {
      x: (30 - cam.x) * cam.zoom + innerWidth / 2,
      y: (ZS.Command.playerGeneral().y - cam.y) * cam.zoom + innerHeight / 2,
    };
  });
  const ambush = await page.evaluate(() => ({
    log: ZS.engine.scenario.orderLog.at(-1),
    left: ZS.engine.scenario.reserves[0].left,
  }));
  ok(
    "Ambush enters from a clicked battlefield edge",
    ambush.log.id === "ambush" && ambush.left < 100,
    ambush,
  );

  await page.evaluate(() => {
    const scenario = ZS.engine.scenario;
    const general = ZS.Command.playerGeneral();
    const enemy = scenario.units.find((unit) => unit.side === 1 && unit.alive > 0);
    general.abilityCd = 0;
    enemy.cx = general.x + 180;
    enemy.cy = general.y;
    const pick = enemy.mem.find((member) => !member.dead && !member.routFlag);
    pick.x = enemy.cx;
    pick.y = enemy.cy;
    window.__abilityEnemy = enemy;
    ZS.UI.updateBattleAbilities();
  });
  await page.keyboard.press("r");
  await worldClick(() => {
    const cam = ZS.debug.cam;
    return {
      x: (__abilityEnemy.cx - cam.x) * cam.zoom + innerWidth / 2,
      y: (__abilityEnemy.cy - cam.y) * cam.zoom + innerHeight / 2,
    };
  });
  const disorder = await page.evaluate(() => ({
    log: ZS.engine.scenario.orderLog.at(-1),
    timer: __abilityEnemy.abilityDisorderT,
  }));
  ok(
    "R + enemy click applies Disorder to that formation",
    disorder.log.id === "disorder" && disorder.timer > 0,
    disorder,
  );

  const unlearned = await page.evaluate(() => {
    const general = ZS.Command.playerGeneral();
    general.abilityCd = 0;
    general.skillIds = ["inspire"];
    ZS.UI.updateBattleAbilities();
    return {
      fire: document.querySelector('[data-ability="fire"]').disabled,
      inspire: document.querySelector('[data-ability="inspire"]').disabled,
    };
  });
  ok(
    "unlearned skills are disabled while learned skills remain usable",
    unlearned.fire && !unlearned.inspire,
    unlearned,
  );

  console.log("\n[console]");
  ok("the command UI emits no page errors", errors.length === 0, errors);

  await browser.close();
  server.close();
  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exitCode = failed ? 1 : 0;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
