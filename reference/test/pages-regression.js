/* The three original pages must be byte-for-byte unaffected by the sanguo work.
   main.js was re-scoped into ZS.Engine.start() with an auto-start tail; this
   asserts each page still boots, populates, sims, and draws with no errors.

   node test/pages-regression.js */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const manifest = require("../tools/module-manifest.js");

const ROOT = path.resolve(__dirname, "..");
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

const PAGES = [
  { file: "zombiesim.html", scen: "ScenarioZombie", minAgents: 30 },
  { file: "battle.html", scen: "ScenarioCannae", minAgents: 400 },
  { file: "hold.html", scen: "ScenarioHold", minAgents: 0 },
];

async function main() {
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
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  for (const p of PAGES) {
    console.log("\n[" + p.file + "]");
    const errors = [];
    const page = await ctx.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("weberror", (e) => errors.push(String(e.error())));
    await page.goto(base + "/" + p.file);
    await page.waitForFunction(() => window.ZS && ZS.debug && ZS.debug.world, null, {
      timeout: 10000,
    });

    const boot = await page.evaluate((scen) => {
      const hud0 = ZS.debug.scenario.hud(ZS.Sim.agents, ZS.Sim.wave);
      const hud1 = ZS.debug.scenario.hud(ZS.Sim.agents, ZS.Sim.wave);
      return {
        scen: ZS.debug.scenario.constructor.name,
        agents: ZS.Sim.agents.length,
        worldW: ZS.debug.world.w,
        worldH: ZS.debug.world.h,
        zoom: ZS.debug.cam.zoom > 0,
        autoStarted: !!ZS.engine && ZS.engine.running,
        hudStable: hud0 === hud1 && hud0.legend === hud1.legend && hud0.overlay === hud1.overlay,
        expected: scen,
      };
    }, p.scen);
    ok("auto-starts without ZS_MANUAL_BOOT", boot.autoStarted);
    ok("runs " + p.scen, boot.scen === p.scen, boot.scen);
    ok("populated (" + boot.agents + " agents)", boot.agents >= p.minAgents, boot);
    ok("world built and camera fitted", boot.worldW > 0 && boot.worldH > 0 && boot.zoom, boot);
    ok("reuses its per-frame HUD record and callbacks", boot.hudStable, boot);

    /* Issue 14: a file that fails to parse is skipped silently, so assert
       every module this page loads actually landed on ZS. */
    const want = manifest.expected(p.file);
    const keys = await page.evaluate(() => Object.keys(window.ZS || {}));
    const absent = want.names.filter((n) => !keys.includes(n));
    ok("every <script src> exists", want.missing.length === 0, want.missing);
    ok("all " + want.names.length + " modules are on ZS", absent.length === 0, absent);

    /* Let it actually sim for a second of wall clock. */
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => ({
      agents: ZS.Sim.agents.length,
      moved: ZS.Sim.agents.some((a) => a.px !== a.x || a.py !== a.y),
      simT: ZS.engine.simT,
      fixedStep: ZS.engine.fixedStep,
    }));
    ok("the loop advances", after.simT > 0.5, after);
    ok("variable-dt path (no fixed step on the old pages)", after.fixedStep === 0, after);
    if (p.minAgents > 0) ok("agents are moving", after.moved, after);
    ok("no console errors", errors.length === 0, errors);
    await page.close();
  }

  await browser.close();
  server.close();
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
