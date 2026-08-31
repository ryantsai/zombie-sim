/* Screenshot the campaign for eyeballing. node test/sanguo-campaign-shot.js

   The map is a drawn object, so the only real check on it is looking at it:
   the faction picker, the opening position, a zoomed seat, and the board a few
   seasons in once the AI has moved. */
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
  const base = "http://127.0.0.1:" + server.address().port;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const shot = (name) => p.screenshot({ path: path.join(ROOT, ".verify", name) });

  await p.goto(base + "/index.html");
  await p.waitForFunction(() => window.ZS && ZS.App && ZS.App.booted);
  await p.waitForTimeout(400);

  await p.click("#btn-campaign");
  await p.waitForTimeout(300);
  await shot("sanguo-campaign-pick.png");

  await p.click('.pick-card[data-faction="cao_cao"]');
  await p.waitForTimeout(600);
  await shot("sanguo-campaign-open.png");

  // the whole empire, fit
  await p.evaluate(() => {
    const V = ZS.CampaignView;
    V.cam.fit(V.W, V.H);
    V.cam.clamp(V.W, V.H);
  });
  await p.waitForTimeout(400);
  await shot("sanguo-campaign-fit.png");

  // close on the capital, where the seats and banners have to hold up
  await p.evaluate(() => {
    const V = ZS.CampaignView;
    const c = ZS.CampaignMap.province("chenliu");
    V.cam.zoom = 2.4;
    V.cam.x = c.x;
    V.cam.y = c.y;
    V.cam.clamp(V.W, V.H);
    V.selectProvince("chenliu");
  });
  await p.waitForTimeout(400);
  await shot("sanguo-campaign-close.png");

  // eight seasons on, with the AI having moved
  await p.evaluate(() => {
    const camp = ZS.App.campaign;
    for (let i = 0; i < 8 && !camp.over; i++) {
      ZS.CampaignAI.plan(camp, camp.playerFactionId);
      ZS.Turn.end(camp);
      const pending = ZS.CampaignEvents.pending(camp);
      if (pending) {
        for (let k = 0; k < pending.event.choices.length; k++) {
          if (ZS.CampaignEvents.canChoose(camp, k)) {
            ZS.CampaignEvents.choose(camp, k);
            break;
          }
        }
      }
    }
    ZS.CampaignUI.encounter.classList.remove("on");
    ZS.CampaignUI.refresh();
    const V = ZS.CampaignView;
    V.cam.fit(V.W, V.H);
    V.cam.clamp(V.W, V.H);
  });
  await p.waitForTimeout(600);
  await shot("sanguo-campaign-turn9.png");

  console.log(
    "turn:",
    await p.evaluate(() => ZS.App.campaign.turn + " / " + ZS.App.campaign.dateText()),
  );
  await b.close();
  server.close();
})();
