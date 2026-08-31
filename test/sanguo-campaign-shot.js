/* Screenshot the campaign for eyeballing. node test/sanguo-campaign-shot.js

   The map is a drawn object, so the only real check on it is looking at it:
   the faction picker, the opening position, a zoomed seat, the board a few
   seasons in once the AI has moved — and, since the redesign, the two states
   that only exist while a hand is on the mouse: a stack in hand with its route
   under the cursor, and the whole thing on a phone. */
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

  // a stack in hand: the route preview, the reticle and the tooltip are the
  // three things the player is meant to read before letting go
  const aimed = await p.evaluate(() => {
    const V = ZS.CampaignView,
      camp = V.camp;
    const fd = camp.factionDef(camp.playerFactionId);
    V.cam.zoom = 1.6;
    const seat = ZS.CampaignMap.province(fd.capital);
    V.cam.x = seat.x + 40;
    V.cam.y = seat.y;
    V.cam.clamp(V.W, V.H);
    const raised = ZS.Turn.raise(camp, fd.capital, 800, null);
    if (!raised.ok) return { err: raised.err };
    if (!raised.army) return { err: "no army" };
    V.selectArmy(raised.army.id);
    const to = ZS.CampaignMap.neighbours(fd.capital).slice(-1)[0].id;
    const t = ZS.CampaignMap.province(to);
    return { x: (t.x - V.cam.x) * V.cam.zoom + V.W / 2, y: (t.y - V.cam.y) * V.cam.zoom + V.H / 2 };
  });
  if (aimed && !aimed.err) {
    await p.mouse.move(aimed.x, aimed.y);
    await p.waitForTimeout(400);
    await shot("sanguo-campaign-aim.png");
  } else {
    console.log("aim shot skipped:", aimed && aimed.err);
  }
  await p.keyboard.press("Escape");

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

  // the season report, as the player gets it: through the button, not the API
  await p.evaluate(() => {
    ZS.App.settings.autoResolveDefault = true;
    const choice = document.querySelector("[data-event-choice]:not(:disabled)");
    if (choice) choice.click();
    document.getElementById("btn-end-turn").click();
  });
  await p.waitForTimeout(500);
  await shot("sanguo-campaign-report.png");

  // and on a phone, where the panel comes up from the bottom and the tooltip
  // (which has no pointer to follow) stands down
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    const V = ZS.CampaignView;
    V.focusCapital();
    ZS.CampaignUI.refresh();
  });
  await p.waitForTimeout(400);
  await shot("sanguo-campaign-mobile.png");

  console.log(
    "turn:",
    await p.evaluate(() => ZS.App.campaign.turn + " / " + ZS.App.campaign.dateText()),
  );
  await b.close();
  server.close();
})();
