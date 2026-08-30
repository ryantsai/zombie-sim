/* Screenshot the menu (both locales) for eyeballing. node test/sanguo-shot.js */
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
const fileUrl = (p) => "file://" + path.resolve(p).split(path.sep).join("/");

(async () => {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    const file = path.join(ROOT, rel || "index.html");
    if (!fs.existsSync(file)) return res.writeHead(404).end("x");
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto(base + "/index.html");
  await p.waitForFunction(() => window.ZS && ZS.App && ZS.App.booted);
  await p.waitForTimeout(400);
  console.log("store over http:", await p.evaluate(() => ZS.debug.store.name));
  await p.screenshot({ path: path.join(ROOT, ".verify", "sanguo-menu-zh.png") });
  await p.click("#btn-settings");
  await p.waitForTimeout(250);
  await p.screenshot({ path: path.join(ROOT, ".verify", "sanguo-settings.png") });
  await p.click("#btn-lang-en");
  await p.click("#btn-settings-back");
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(ROOT, ".verify", "sanguo-menu-en.png") });

  const f = await b.newPage();
  await f.goto(fileUrl(path.join(ROOT, "index.html")));
  await f.waitForFunction(() => window.ZS && ZS.App && ZS.App.booted);
  console.log("store over file://:", await f.evaluate(() => ZS.debug.store.name));
  await b.close();
  server.close();
})();
