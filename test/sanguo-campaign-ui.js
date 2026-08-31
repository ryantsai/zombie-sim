/* The campaign map as an interface (SANGUO-DESIGN.md §4.1).

   `sanguo-p3.js` asserts the campaign's *rules* — every order and its refusals,
   ten seasons of invariants, a save that round-trips. This suite asserts the
   layer above them: whether a player who has never read a manual can find the
   verb. The redesign that prompted it replaced "right-click somewhere to
   march, and good luck" with three things that have to keep working together:

     the guide    a line that always names the next thing to do, and changes
                  when the selection changes
     the tooltip  what the pointer is over, so the map can stop printing a
                  garrison under all fifty-seven seats
     one gesture  take a stack in hand, then click (or drag onto) the province
                  it should march to

   All three are load-bearing. A stale guide is worse than no guide, a tooltip
   that lies about march cost sends an army somewhere the player did not
   choose, and the click path and the drag path have to give the *same* order —
   they went out of step once already, when pressing a token both selected it
   and armed a click that then deselected it.

   Run:  node test/sanguo-campaign-ui.js
         node test/sanguo-campaign-ui.js --headed     (watch it) */
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

/* Where a province's seat lands on screen, so the mouse can be aimed at the
   drawn map rather than at a world coordinate. */
const SEAT_AT = (id) => {
  const V = window.ZS.CampaignView,
    p = window.ZS.CampaignMap.province(id);
  return { x: (p.x - V.cam.x) * V.cam.zoom + V.W / 2, y: (p.y - V.cam.y) * V.cam.zoom + V.H / 2 };
};

/* And where a standing stack's token is — offset from its seat, and fanned
   right of any stack already sharing it. */
const TOKEN_AT = (armyId) => {
  const V = window.ZS.CampaignView,
    a = V.camp.armies[armyId];
  const pos = window.ZS.Army.position(a, window.ZS.CampaignMap);
  const wx = pos.x + V.tokenDX(a),
    wy = pos.y - 11;
  return { x: (wx - V.cam.x) * V.cam.zoom + V.W / 2, y: (wy - V.cam.y) * V.cam.zoom + V.H / 2 };
};

async function main() {
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch(HEADED ? { headless: false, channel: "chrome" } : {});
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("weberror", (e) => errors.push(String(e.error())));
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(base + "/index.html");
  await page.waitForFunction(() => window.ZS && window.ZS.App && window.ZS.App.booted);
  await page.click("#btn-campaign");
  await page.waitForTimeout(200);
  await page.click('.pick-card[data-faction="cao_cao"]');
  await page.waitForTimeout(500);

  /* ---- the colours ---------------------------------------------------- */
  /* The map's only legend is that a colour is a warlord, which is a promise
     the data has to keep: two warlords sharing a border must not share a hue,
     and no warlord may be a near-twin of any other. */
  console.log("\n[the palette]");
  const palette = await page.evaluate(() => {
    const map = window.ZS.CampaignMap;
    const list = window.ZS.data.factions;
    const owner = new Map();
    for (const fd of list) for (const id of fd.start.provinces) owner.set(id, fd.id);

    /* Visual adjacency, not march adjacency. The eye compares two washes that
       share a line on the sheet, and the Voronoi cells touch in places the road
       graph does not — so this asks the cells. Two share an edge exactly when
       the midpoint between their seats falls in one of the two, since that
       point sits on their bisector by construction. */
    const touch = new Set();
    const P = map.list;
    for (let i = 0; i < P.length; i++) {
      for (let j = i + 1; j < P.length; j++) {
        const mid = map.at((P[i].x + P[j].x) / 2, (P[i].y + P[j].y) / 2);
        if (mid !== P[i].id && mid !== P[j].id) continue;
        const x = owner.get(P[i].id),
          y = owner.get(P[j].id);
        if (x && y && x !== y) touch.add(x < y ? x + "|" + y : y + "|" + x);
      }
    }

    const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    let worst = { d: Infinity },
      worstNeighbour = { d: Infinity };
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].id,
          b = list[j].id;
        const d = D(list[i].tint, list[j].tint);
        if (d < worst.d) worst = { d, a, b };
        const key = a < b ? a + "|" + b : b + "|" + a;
        if (touch.has(key) && d < worstNeighbour.d) worstNeighbour = { d, a, b };
      }
    }
    return { worst, worstNeighbour, count: list.length };
  });
  /* The thresholds are RGB distance on the raw tint. The wash is drawn at
     roughly a third opacity over cream, so what the eye gets is about 40% of
     these numbers — which is why the bar for two warlords who actually share a
     border is set so much higher than the bar for two who never meet. */
  ok("no two warlords wear the same colour", palette.worst.d > 35, palette.worst);
  ok(
    "...and two who share a border are nowhere near each other",
    palette.worstNeighbour.d > 70,
    palette.worstNeighbour,
  );

  /* ---- the guide ------------------------------------------------------- */
  console.log("\n[the guide]");
  const guide0 = await page.evaluate(() => document.getElementById("camp-guide").textContent);
  ok("the guide is up before anything is clicked", guide0.length > 8, guide0);

  /* ---- the tooltip ------------------------------------------------------ */
  console.log("\n[the tooltip]");
  const capital = await page.evaluate(() => {
    const camp = window.ZS.App.campaign;
    return camp.factionDef(camp.playerFactionId).capital;
  });
  let at = await page.evaluate(SEAT_AT, capital);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(150);
  const tip = await page.evaluate(() => ({
    on: document.getElementById("camp-tip").classList.contains("on"),
    text: document.getElementById("camp-tip").textContent,
    hover: window.ZS.CampaignView.hoverProvince,
  }));
  ok("hovering a seat opens the tooltip", tip.on, tip);
  ok("...on the province under the pointer", tip.hover === capital, tip);
  ok("...carrying the garrison the map no longer prints", /\d/.test(tip.text), tip.text);

  /* ---- click to march ---------------------------------------------------- */
  console.log("\n[click to march]");
  const first = await page.evaluate(() => {
    const camp = window.ZS.App.campaign;
    const fd = camp.factionDef(camp.playerFactionId);
    const res = window.ZS.Turn.raise(camp, fd.capital, 300, null);
    return {
      armyId: res.ok ? res.army.id : null,
      to: window.ZS.CampaignMap.neighbours(fd.capital)[0].id,
    };
  });
  ok("a stack was raised to command", !!first.armyId, first);

  at = await page.evaluate(TOKEN_AT, first.armyId);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
  const held = await page.evaluate(() => ({
    sel: window.ZS.CampaignView.selArmy,
    guide: document.getElementById("camp-guide").textContent,
    cursor: window.ZS.App.cv.style.cursor,
    banner: !!document.querySelector(".cblock.army.held .cbanner"),
  }));
  ok("clicking your own token takes the stack in hand", held.sel === first.armyId, held);
  ok(
    "...the cursor turns into a target without waiting for a move",
    held.cursor === "crosshair",
    held,
  );
  ok("...the guide switches to the march instruction", held.guide !== guide0, held.guide);
  ok("...and the panel repeats it where the eye already is", held.banner, held);

  at = await page.evaluate(SEAT_AT, first.to);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(150);
  const plan = await page.evaluate(() => ({
    plan: window.ZS.CampaignView._plan,
    tip: document.getElementById("camp-tip").textContent,
  }));
  ok("hovering with a stack in hand plans the march", !!(plan.plan && plan.plan.path), plan);
  ok("...and the tooltip prices it before the order is given", /\d/.test(plan.tip), plan.tip);

  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(200);
  const marched = await page.evaluate((o) => {
    const a = window.ZS.App.campaign.armies[o.armyId];
    return {
      marching: window.ZS.Army.isMarching(a),
      dest: a.path ? a.path[a.path.length - 1] : null,
      sel: window.ZS.CampaignView.selArmy,
    };
  }, first);
  ok("clicking a province marches the stack there", marched.marching, marched);
  ok("...to the province that was clicked", marched.dest === first.to, { marched, first });
  ok("...and the stack goes back down once the order is given", marched.sel === null, marched);

  /* ---- drag to march ------------------------------------------------------ */
  /* The same order by the other gesture. It has to reach the same province and
     it must not pan the map on the way. */
  console.log("\n[drag to march]");
  const second = await page.evaluate(() => {
    const camp = window.ZS.App.campaign;
    const fd = camp.factionDef(camp.playerFactionId);
    const res = window.ZS.Turn.raise(camp, fd.capital, 300, null);
    const nb = window.ZS.CampaignMap.neighbours(fd.capital);
    return { armyId: res.ok ? res.army.id : null, to: nb[nb.length - 1].id };
  });
  const from = await page.evaluate(TOKEN_AT, second.armyId);
  const onto = await page.evaluate(SEAT_AT, second.to);
  const camBefore = await page.evaluate(() => ({
    x: window.ZS.CampaignView.cam.x,
    y: window.ZS.CampaignView.cam.y,
  }));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + onto.x) / 2, (from.y + onto.y) / 2, { steps: 5 });
  await page.mouse.move(onto.x, onto.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const dragged = await page.evaluate((o) => {
    const a = window.ZS.App.campaign.armies[o.armyId];
    return {
      marching: window.ZS.Army.isMarching(a),
      dest: a.path ? a.path[a.path.length - 1] : null,
      cam: { x: window.ZS.CampaignView.cam.x, y: window.ZS.CampaignView.cam.y },
    };
  }, second);
  ok("dragging a token onto a province marches it", dragged.marching, dragged);
  ok("...to the province it was dropped on", dragged.dest === second.to, { dragged, second });
  ok(
    "...and the map stays put underneath the gesture",
    Math.abs(dragged.cam.x - camBefore.x) < 0.5 && Math.abs(dragged.cam.y - camBefore.y) < 0.5,
    { dragged, camBefore },
  );

  /* Two stacks in one seat used to be one token with the other hidden exactly
     underneath it, and the buried one could never be clicked. */
  const fanned = await page.evaluate(() => {
    const camp = window.ZS.App.campaign;
    const V = window.ZS.CampaignView;
    const fd = camp.factionDef(camp.playerFactionId);
    const a = window.ZS.Turn.raise(camp, fd.capital, 300, null);
    const b = window.ZS.Turn.raise(camp, fd.capital, 300, null);
    if (!a.ok || !b.ok) return { skipped: true };
    return { dxA: V.tokenDX(a.army), dxB: V.tokenDX(b.army) };
  });
  ok(
    "two stacks in one seat are two things you can point at",
    fanned.skipped || fanned.dxA !== fanned.dxB,
    fanned,
  );

  /* ---- panning still pans -------------------------------------------------- */
  console.log("\n[the map still moves]");
  /* Zoomed out the viewport is wider than the sheet and the camera clamp pins
     it, so a pan would be a no-op for a reason that has nothing to do with the
     gesture. Zoom in first, then drag empty paper. */
  await page.evaluate(() => {
    const V = window.ZS.CampaignView;
    V.cam.zoom = 2.6;
    V.cam.clamp(V.W, V.H);
  });
  await page.waitForTimeout(120);
  const camPan = await page.evaluate(() => window.ZS.CampaignView.cam.x);
  await page.mouse.move(300, 500);
  await page.mouse.down();
  await page.mouse.move(360, 520, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  ok(
    "dragging paper still pans the sheet",
    await page.evaluate((x) => Math.abs(window.ZS.CampaignView.cam.x - x) > 5, camPan),
  );

  /* ---- the halo ------------------------------------------------------------ */
  /* The glow on the player's own ground is a claim about whose move it is, so
     it has to stop being true while the season resolves. */
  console.log("\n[the halo follows the season]");
  const turn = await page.evaluate(() => {
    window.ZS.App.settings.autoResolveDefault = true;
    const before = window.ZS.CampaignView.playerTurn;
    const choice = document.querySelector("[data-event-choice]:not(:disabled)");
    if (choice) choice.click();
    document.getElementById("btn-end-turn").click();
    return { before, after: window.ZS.CampaignView.playerTurn };
  });
  ok("the halo is on while the board waits on the player", turn.before, turn);
  ok("...and back on once the season has landed", turn.after, turn);

  console.log("\n[letting go]");
  await page.evaluate(() => {
    const camp = window.ZS.App.campaign;
    for (const id in camp.armies) {
      if (camp.armies[id].faction === camp.playerFactionId) {
        window.ZS.CampaignView.selectArmy(id);
        return;
      }
    }
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  ok(
    "Escape puts the stack back down",
    await page.evaluate(() => window.ZS.CampaignView.selArmy === null),
  );

  ok("no console errors along the way", errors.length === 0, errors.slice(0, 4));

  console.log("\n" + pass + " passed, " + fail + " failed");
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
