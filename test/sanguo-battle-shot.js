/* Screenshot a battle at a few moments, and time a frame. node test/sanguo-battle-shot.js */
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

(async () => {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    const file = path.join(ROOT, rel || "index.html");
    if (!fs.existsSync(file)) return res.writeHead(404).end("x");
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.on("console", (m) => m.type() === "error" && console.log("ERR", m.text()));
  await p.goto("http://127.0.0.1:" + server.address().port + "/index.html");
  await p.waitForFunction(() => window.ZS && ZS.App && ZS.App.booted);

  await p.evaluate(() => {
    ZS.App.go("battle", { setup: ZS.ScenarioSanguo.defaultSetup(4242) });
    ZS.engine.speed = 0; // hold while we set up
    // frame the whole field
    const s = ZS.engine.scenario;
    ZS.debug.cam.auto = false;
    ZS.debug.cam.x = s.field.x;
    ZS.debug.cam.y = s.field.y;
    ZS.debug.cam.zoom = 0.9;
    ZS.debug.cam.clamp(ZS.engine.W, ZS.engine.H);
    // select the line so the command overlay shows
    ZS.Command.key({ key: "a", preventDefault() {} });
  });
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(ROOT, ".verify", "sanguo-battle-deploy.png") });

  const shots = [12, 30, 55];
  let prev = 0;
  for (const at of shots) {
    await p.evaluate((sec) => {
      const eng = ZS.engine,
        s = eng.scenario;
      const step = 1 / 30;
      // one scripted advance so there is a battle to look at
      if (!s._scripted) {
        s._scripted = true;
        const own = s.units.filter((u) => u.side === 0);
        const foe = s.units.filter((u) => u.side === 1);
        let fx = 0,
          fy = 0;
        for (const e of foe) {
          fx += e.cx;
          fy += e.cy;
        }
        fx /= foe.length;
        fy /= foe.length;
        own.forEach((u, i) => s.order(u, "attack", fx, fy + (i - own.length / 2) * 70));
      }
      for (let t = 0; t < sec; t += step) eng.step(step);
    }, at - prev);
    prev = at;
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(ROOT, ".verify", "sanguo-battle-" + at + "s.png") });
    const st = await p.evaluate(() => {
      const s = ZS.engine.scenario;
      return {
        t: Math.round(s.bt),
        s0: s.sides[0].alive + "/" + s.sides[0].dead + "d/" + s.sides[0].routed + "r",
        s1: s.sides[1].alive + "/" + s.sides[1].dead + "d/" + s.sides[1].routed + "r",
        over: s.over,
      };
    });
    console.log("t=" + at + "s", JSON.stringify(st));
  }

  // a zoomed-in look at the figures
  await p.evaluate(() => {
    const s = ZS.engine.scenario;
    const u = s.units.find((x) => x.side === 0 && x.alive > 0) || s.units[0];
    ZS.debug.cam.x = u.cx;
    ZS.debug.cam.y = u.cy;
    ZS.debug.cam.zoom = 3;
    ZS.debug.cam.clamp(ZS.engine.W, ZS.engine.H);
  });
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(ROOT, ".verify", "sanguo-battle-close.png") });

  // frame cost with the whole field visible
  const perf = await p.evaluate(async () => {
    ZS.debug.cam.zoom = 0.9;
    ZS.debug.cam.clamp(ZS.engine.W, ZS.engine.H);
    ZS.engine.speed = 1;
    const t0 = performance.now();
    let n = 0;
    await new Promise((res) => {
      const tick = () => {
        n++;
        if (performance.now() - t0 > 1500) res();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return {
      fps: Math.round((n / (performance.now() - t0)) * 1000),
      agents: ZS.Sim.agents.length,
    };
  });
  console.log("headless fps (indicative only):", JSON.stringify(perf));

  await b.close();
  server.close();
})();
