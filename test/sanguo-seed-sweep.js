/* Second pass: why does a passive-player battle not resolve, and how often?
   node .verify/sanguo-audit2.js */
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
  const p = await b.newPage();
  p.on("console", (m) => m.type() === "error" && console.log("ERR", m.text()));
  await p.goto("http://127.0.0.1:" + server.address().port + "/index.html");
  await p.waitForFunction(() => window.ZS && ZS.App && ZS.App.booted);

  /* How many of N seeds resolve within 200 s with a completely passive player? */
  const sweep = await p.evaluate(() => {
    const ST = ["HOLD", "MOVE", "ATTACK", "CHARGE", "ROUT"];
    const step = 1 / 30;
    const rows = [];
    for (const seed of [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]) {
      ZS.App.go("menu");
      ZS.App.go("battle", { setup: ZS.ScenarioSanguo.defaultSetup(seed) });
      const eng = ZS.engine,
        s = eng.scenario;
      for (let i = 0; i < 200 * 30 && !s.over; i++) eng.step(step);
      const stuck = s.units
        .filter((u) => u.alive > 0)
        .map((u) => ({
          side: u.side,
          st: ST[u.st],
          n: u.alive,
          ord: u.orders.length,
          reach: u.reach,
          hunting: u.hunting,
          d: Math.round(Math.hypot(u.tx - u.cx, u.ty - u.cy)),
          at: [Math.round(u.cx), Math.round(u.cy)],
        }));
      rows.push({
        seed,
        over: s.over,
        t: Math.round(s.bt),
        s0: s.sides[0].alive,
        s1: s.sides[1].alive,
        units: s.over ? [] : stuck,
      });
    }
    ZS.App.go("menu");
    return rows;
  });

  for (const r of sweep) {
    console.log(
      `seed ${r.seed}: over=${r.over} t=${r.t}s  standing ${r.s0} vs ${r.s1}` +
        (r.over ? "" : "   <-- STALLED"),
    );
    for (const u of r.units) {
      console.log(
        `    side${u.side} ${u.st.padEnd(6)} n=${String(u.n).padStart(3)} ord=${u.ord} reach=${u.reach ? 1 : 0} hunt=${u.hunting ? 1 : 0} d=${u.d} at=${u.at}`,
      );
    }
  }

  await b.close();
  server.close();
})();
