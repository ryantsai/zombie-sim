/* Render the authored Sanguo battlefield families for visual review.

   This is intentionally a screenshot tool rather than an assertion suite:
   topology/connectivity are covered by sanguo-p4-maps.js, while these images
   make sketch composition, visual hierarchy and camera framing inspectable.

   Run: node test/sanguo-map-shots.js */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, ".verify", "sanguo-maps");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("http://127.0.0.1:" + server.address().port + "/index.html");
  await page.waitForFunction(() => window.ZS && ZS.App && ZS.App.booted);

  const fields = [
    ["open-plain", { kind: "open", biome: "plain", variant: 1 }],
    ["open-hill", { kind: "open", biome: "hill", variant: 0 }],
    ["open-river", { kind: "open", biome: "river", variant: 1 }],
    ["open-wood", { kind: "open", biome: "wood", variant: 2 }],
    ["open-marsh", { kind: "open", biome: "marsh", variant: 2 }],
    ["town-crossroads", { kind: "town", biome: "plain", variant: 0 }],
    ["town-market", { kind: "town", biome: "hill", variant: 1 }],
    ["town-river", { kind: "town", biome: "river", variant: 2 }],
    ["fort-gatehouse", { kind: "fort", biome: "plain", variant: 0, wallTier: 1 }],
    ["fort-walled-city", { kind: "fort", biome: "wood", variant: 1, wallTier: 2 }],
    ["fort-citadel", { kind: "fort", biome: "hill", variant: 2, wallTier: 2 }],
  ];

  for (let i = 0; i < fields.length; i++) {
    const [name, field] = fields[i];
    await page.evaluate(
      ({ field, seed }) => {
        if (ZS.App.state === "battle") ZS.App.go("menu");
        const setup = ZS.ScenarioSanguo.defaultSetup(seed);
        setup.field = Object.assign(
          {
            attackerSide: 0,
            defenderSide: 1,
            terrain: field.biome,
            layout: "visual_review",
          },
          field,
        );
        setup.duels = true;
        ZS.App.go("battle", { setup });
        ZS.engine.speed = 0;
        ZS.debug.cam.auto = false;
        ZS.debug.cam.fit(ZS.engine.W, ZS.engine.H);
        ZS.debug.cam.clamp(ZS.engine.W, ZS.engine.H);
      },
      { field, seed: 9100 + i * 97 },
    );
    await page.waitForTimeout(260);
    await page.screenshot({ path: path.join(OUT, name + ".png") });
    console.log(name);
  }

  if (errors.length) throw new Error(errors.join("\n"));
  await browser.close();
  server.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
