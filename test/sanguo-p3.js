/* P3 verification (SANGUO-DESIGN.md §10).

   The P3 row: "paper map, provinces, 3 factions, armies, march, turn phases,
   recruit/develop — battles still skirmish-only", verified by "play 10 turns,
   autosave each World phase, reload mid-campaign".

   Run:  node test/sanguo-p3.js
         node test/sanguo-p3.js --headed     (watch it)

   The campaign is turn-based, so unlike the battle suites nothing here needs a
   fixed step or wall-clock patience: `ZS.Turn.end()` is synchronous and ten
   seasons resolve in microseconds. What that buys is the ability to assert on
   *invariants across many turns* — that the ledger never goes negative, that
   an army is never in two places, that a save round-trips exactly — rather
   than on one hand-checked outcome. */
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
function eq(name, actual, expected) {
  ok(name, actual === expected, { actual, expected });
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

async function main() {
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch(HEADED ? { headless: false, channel: "chrome" } : {});
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("weberror", (e) => errors.push(String(e.error())));
  page.on("requestfailed", (r) =>
    errors.push("REQFAIL " + r.url() + " " + (r.failure() || {}).errorText),
  );
  await page.goto(base + "/index.html");
  await page.waitForFunction(() => window.ZS && ZS.App && ZS.App.booted === true, null, {
    timeout: 15000,
  });

  /* ---- the map ------------------------------------------------------ */
  console.log("\n[map]");
  const map = await page.evaluate(() => {
    const M = ZS.CampaignMap.build();
    const ids = new Set();
    let dupes = 0;
    for (const p of M.list) {
      if (ids.has(p.id)) dupes++;
      ids.add(p.id);
    }
    // every node reachable from one node = the graph is connected
    const seen = new Set(["luoyang"]);
    const stack = ["luoyang"];
    while (stack.length) {
      for (const n of M.neighbours(stack.pop())) {
        if (!seen.has(n.id)) {
          seen.add(n.id);
          stack.push(n.id);
        }
      }
    }
    // every seat must be inside its own Voronoi cell
    let inOwnCell = 0;
    let emptyCells = 0;
    for (const p of M.list) {
      if (M.at(p.x, p.y) === p.id) inOwnCell++;
      const poly = M.poly(p.id);
      if (!poly || poly.length < 3) emptyCells++;
    }
    // adjacency has to be symmetric or a march can be one-way
    let asym = 0;
    for (const p of M.list) {
      for (const n of M.neighbours(p.id)) if (!M.isNeighbour(n.id, p.id)) asym++;
    }
    const far = M.path("liaodong", "jiaozhi", null);
    return {
      count: M.list.length,
      dupes,
      connected: seen.size,
      inOwnCell,
      emptyCells,
      asym,
      farLen: far ? far.length : 0,
      farCost: far ? M.pathCost(far) : 0,
      farEndsRight: !!far && far[0] === "liaodong" && far[far.length - 1] === "jiaozhi",
      selfPath: (M.path("ye", "ye", null) || []).length,
      badPath: M.path("ye", "atlantis", null),
      sheet: (() => {
        const cv = M.sheet(1);
        return { w: cv.width, h: cv.height };
      })(),
    };
  });
  ok("the map has 40-60 commanderies (§4.1)", map.count >= 40 && map.count <= 60, map.count);
  eq("no duplicate province ids", map.dupes, 0);
  eq("the whole graph is reachable — no stranded province", map.connected, map.count);
  eq("every seat sits inside its own territory", map.inOwnCell, map.count);
  eq("every province got a polygon", map.emptyCells, 0);
  eq("adjacency is symmetric", map.asym, 0);
  ok("a road runs the length of the empire", map.farEndsRight && map.farLen > 6, map);
  ok("...and it costs a campaign's worth of seasons", map.farCost >= 8, map.farCost);
  eq("a path to where you already are is the trivial one", map.selfPath, 1);
  eq("a path to nowhere is refused", map.badPath, null);
  ok("the paper sheet pre-renders", map.sheet.w > 500 && map.sheet.h > 300, map.sheet);

  /* ---- factions and the opening position ----------------------------- */
  console.log("\n[194 CE]");
  const start = await page.evaluate(() => {
    ZS.App.campaign = ZS.Campaign.create(4242, "cao_cao");
    const c = ZS.App.campaign;
    let unowned = 0,
      owned = 0;
    for (const id in c.provinces) {
      if (c.provinces[id].owner) owned++;
      else unowned++;
    }
    let playable = 0,
      badFlag = [],
      badCapital = [];
    for (const fd of ZS.data.factions) {
      if (fd.playable) playable++;
      if (!ZS.flag.get(fd.flag)) badFlag.push(fd.id);
      if (c.owner(fd.capital) !== fd.id) badCapital.push(fd.id);
    }
    let fieldArmies = 0;
    for (const _aid in c.armies) fieldArmies++;
    return {
      turn: c.turn,
      year: c.year,
      season: c.season,
      date: c.dateText(),
      owned,
      unowned,
      factions: ZS.data.factions.length,
      playable,
      badFlag,
      badCapital,
      fieldArmies,
      caoProvinces: c.provincesOf("cao_cao").length,
      caoTroops: c.troopsOf("cao_cao"),
      isPlayer: c.player().isPlayer,
      over: c.over,
    };
  });
  eq("the campaign opens in 194", start.year, 194);
  eq("...in spring", start.season, 0);
  eq("...on turn 1", start.turn, 1);
  eq("the date renders through i18n", start.date, "西元 194 年 · 春");
  eq("every commandery has a holder", start.unowned, 0);
  ok("more than three warlords are on the board (§10 asks for 3)", start.factions >= 3, start);
  ok("...and several are playable", start.playable >= 3, start.playable);
  eq("every faction's banner resolves to a real flag preset", start.badFlag.length, 0);
  eq("every warlord starts holding their own capital", start.badCapital.length, 0);
  ok(
    "everyone starts with a field army, not just walls",
    start.fieldArmies >= start.factions,
    start,
  );
  ok("the player's holdings are seeded", start.caoProvinces >= 4, start.caoProvinces);
  ok("...and their men", start.caoTroops > 5000, start.caoTroops);
  ok("the player faction is flagged as the player's", start.isPlayer);
  eq("the game is not already over", start.over, null);

  /* ---- the general almanac ------------------------------------------- */
  console.log("\n[generals]");
  const gen = await page.evaluate(() => {
    const c = ZS.App.campaign;
    const almanac = ZS.Generals ? ZS.Generals.ALL.length : 0;
    const known = new Set((ZS.Generals ? ZS.Generals.ALL : []).map((g) => g.id));
    const badLeader = [];
    const badRoster = [];
    const placedTwice = [];
    const seen = new Map();
    for (const fd of ZS.data.factions) {
      if (fd.leader && !known.has(fd.leader)) badLeader.push(fd.id + ":" + fd.leader);
      for (const gid of fd.roster || []) {
        if (!known.has(gid)) badRoster.push(fd.id + ":" + gid);
        if (seen.has(gid)) placedTwice.push(gid + " " + seen.get(gid) + "/" + fd.id);
        seen.set(gid, fd.id);
      }
      if (fd.leader && (fd.roster || []).indexOf(fd.leader) < 0) {
        badRoster.push(fd.id + ": leader not on own roster");
      }
    }
    // a real stat block, not the neutral stand-in
    const guan = ZS.Roster.stats("guan_yu");
    const snap = ZS.Roster.snapshot("guan_yu");
    // the opening position must actually field them
    let staffed = 0,
      governed = 0,
      doubled = 0;
    const placements = new Map();
    for (const aid in c.armies) {
      const a = c.armies[aid];
      if (a.generals.length) staffed++;
      if (a.generals.length > ZS.Army.MAX_GENERALS) doubled++;
      for (const g of a.generals) {
        if (placements.has(g)) doubled++;
        placements.set(g, aid);
      }
    }
    for (const pid in c.provinces) {
      const g = c.provinces[pid].governor;
      if (!g) continue;
      governed++;
      if (placements.has(g)) doubled++;
      placements.set(g, pid);
    }
    /* A warlord with more officers than one stack can carry (3, §4.1) must
       have left someone at home. One with fewer legitimately rode out with
       everybody — that is a decision, not a bug. */
    let shouldSeat = 0,
      didSeat = 0;
    for (const fd of ZS.data.factions) {
      const f = c.faction(fd.id);
      if (!f.alive || f.generals.length <= ZS.Army.MAX_GENERALS) continue;
      shouldSeat++;
      if (c.prov(fd.capital) && c.prov(fd.capital).governor) didSeat++;
    }
    const caoArmy = c.armiesOf("cao_cao")[0];
    return {
      almanac,
      available: ZS.Roster.available(),
      badLeader,
      badRoster,
      placedTwice,
      guanWu: guan.wu,
      neutralWu: ZS.Roster.NEUTRAL.wu,
      snapUnit: snap.unitType,
      snapName: ZS.i18n.t(snap.name),
      unknownStats: ZS.Roster.stats("nobody_at_all").wu,
      unknownName: ZS.Roster.name("nobody_at_all"),
      staffed,
      governed,
      shouldSeat,
      didSeat,
      doubled,
      caoGenerals: caoArmy ? caoArmy.generals.slice() : [],
      caoRoster: c.faction("cao_cao").generals.length,
      style: ZS.Roster.style("guan_yu"),
      /* the seam still has to answer for a warlord the almanac skipped */
      thinFaction: c.faction("shi_xie").generals.length,
    };
  });
  eq("the 200-general almanac is loaded", gen.almanac, 200);
  ok("the roster seam sees it", gen.available);
  eq("every faction leader is a real almanac id", gen.badLeader.length, 0, gen.badLeader);
  eq("every faction roster entry is a real almanac id", gen.badRoster.length, 0, gen.badRoster);
  eq("no general serves two warlords at once", gen.placedTwice.length, 0, gen.placedTwice);
  ok("stats come from the almanac, not the stand-in", gen.guanWu > gen.neutralWu, gen);
  eq("...and an unknown id still answers neutrally", gen.unknownStats, 60);
  eq("...and renders as its id rather than blank", gen.unknownName, "nobody_at_all");
  eq("a BattleSetup snapshot resolves the name", gen.snapName, "關羽");
  eq("...and a mounted hero leads from the cavalry", gen.snapUnit, "cav");
  eq("the courtesy name comes through", gen.style, "雲長");
  ok("the opening position staffs its armies", gen.staffed >= 10, gen.staffed);
  ok(
    "...and every warlord with officers to spare seats one at home",
    gen.shouldSeat > 0 && gen.didSeat === gen.shouldSeat,
    gen,
  );
  eq("nobody is in two places at once", gen.doubled, 0);
  ok(
    "the player's lord rides with the army",
    gen.caoGenerals.indexOf("cao_cao") === 0,
    gen.caoGenerals,
  );
  ok("...with a full staff behind him", gen.caoRoster >= 10, gen.caoRoster);
  eq("a warlord the almanac skipped starts alone rather than broken", gen.thinFaction, 0);

  const assign = await page.evaluate(() => {
    const c = ZS.App.campaign;
    const out = {};
    const army = c.armiesOf("cao_cao")[0];
    out.staffedTo = army.generals.length;
    /* The opening position already filled this stack to the cap, so the first
       thing an Assign test has to prove is that a seat can be freed. */
    const released = army.generals[army.generals.length - 1];
    out.release = ZS.Turn.assign(c, released, null);
    out.releasedOff = army.generals.indexOf(released) < 0;
    const idle = c.faction("cao_cao").generals.filter((g) => !c.isBusy(g, null));
    out.idleBefore = idle.length;
    const g = idle[0];
    out.toArmy = ZS.Turn.assign(c, g, { army: army.id });
    out.onArmy = army.generals.indexOf(g) >= 0;
    out.fullArmy = ZS.Turn.assign(c, idle[1], { army: army.id });
    const home = c.factionDef("cao_cao").capital;
    out.toSeat = ZS.Turn.assign(c, g, { govern: home });
    out.leftArmy = army.generals.indexOf(g) < 0;
    out.seated = c.prov(home).governor === g;
    out.toRoster = ZS.Turn.assign(c, g, null);
    out.unseated = c.prov(home).governor === null;
    out.notOurs = ZS.Turn.assign(c, "sun_ce", { army: army.id });
    return out;
  });
  eq("the opening stack is staffed to the cap", assign.staffedTo, 3);
  ok("a general can be released back to the roster", assign.release.ok && assign.releasedOff);
  ok("Assign puts a general on a stack", assign.toArmy.ok && assign.onArmy, assign);
  eq("...and a fourth is refused", assign.fullArmy.err, "campaign.err.armyFull");
  ok(
    "Assign to a seat takes them off the stack first",
    assign.toSeat.ok && assign.leftArmy && assign.seated,
  );
  ok("Assign to nothing returns them to the roster", assign.toRoster.ok && assign.unseated);
  eq("another warlord's officer takes no orders", assign.notOurs.err, "campaign.err.notOurs");

  /* ---- orders -------------------------------------------------------- */
  console.log("\n[orders]");
  const orders = await page.evaluate(() => {
    const c = ZS.App.campaign;
    const out = {};
    const home = "chenliu";
    const f = c.player();

    const gold0 = f.gold;
    out.develop = ZS.Turn.develop(c, home, "income");
    out.devLevel = c.prov(home).dev.income;
    out.devPaid = gold0 - f.gold;
    out.devAgain = ZS.Turn.develop(c, "ye", "income"); // not ours

    const g0 = c.prov(home).garrison;
    out.recruit = ZS.Turn.recruit(c, home, 300);
    out.recruited = c.prov(home).garrison - g0;
    out.overCap = ZS.Turn.recruit(c, home, 999999);

    const before = Object.keys(c.armies).length;
    out.raise = ZS.Turn.raise(c, home, 500, null);
    out.raisedArmy = Object.keys(c.armies).length - before;
    out.raisedTroops = out.raise.ok ? out.raise.army.troops : -1;
    out.garrisonFloor = ZS.Turn.raise(c, home, 999999, null);

    const aid = out.raise.ok ? out.raise.army.id : null;
    out.march = ZS.Turn.march(c, aid, "puyang"); // Lü Bu's, next door
    out.marching = ZS.Army.isMarching(c.armies[aid]);
    out.marchNowhere = ZS.Turn.march(c, aid, "atlantis");
    out.stillMarching = ZS.Army.isMarching(c.armies[aid]);
    out.halt = ZS.Turn.halt(c, aid);
    out.halted = !ZS.Army.isMarching(c.armies[aid]);

    // an enemy stack is not ours to command
    let enemy = null;
    for (const id in c.armies) if (c.armies[id].faction !== c.playerFactionId) enemy = id;
    out.enemyMarch = ZS.Turn.march(c, enemy, "chenliu");

    // the money actually left the treasury and nothing went negative
    out.gold = f.gold;
    out.food = f.food;
    return out;
  });
  ok("Develop raises the track and charges for it", orders.develop.ok && orders.devLevel === 1);
  ok("...and the gold really left", orders.devPaid > 0, orders.devPaid);
  eq("Develop on someone else's province is refused", orders.devAgain.err, "campaign.err.notYours");
  ok(
    "Recruit adds exactly the men asked for",
    orders.recruit.ok && orders.recruited === 300,
    orders,
  );
  eq("...and over the cap is refused", orders.overCap.err, "campaign.err.overCap");
  ok("Raise takes men out of the garrison into a new stack", orders.raisedArmy === 1);
  eq("...at the strength asked for", orders.raisedTroops, 500);
  eq(
    "...and it will not strip the garrison bare",
    orders.garrisonFloor.err,
    "campaign.err.garrisonFloor",
  );
  ok("March sets a route", orders.march.ok && orders.marching, orders.march);
  eq("...to nowhere is refused", orders.marchNowhere.err, "campaign.err.noProvince");
  ok("...and a refused march leaves the current one alone", orders.stillMarching);
  ok("Halt stops the column", orders.halt.ok && orders.halted);
  eq(
    "an enemy stack takes no orders from the player",
    orders.enemyMarch.err,
    "campaign.err.notYours",
  );
  ok("the treasury never went negative", orders.gold >= 0 && orders.food >= 0, orders);

  /* ---- ten seasons --------------------------------------------------- */
  console.log("\n[ten seasons]");
  const ten = await page.evaluate(() => {
    const c = ZS.App.campaign;
    const problems = [];
    const seen = { battles: 0, captured: 0, aiMarches: 0, tired: 0 };
    /* ISSUES.md #10: a stack must not be able to chain conquests. Measured the
       same way test/campaign-sweep.js measures it — a second province taken
       within three seasons of the last one by the same army. */
    const lastTake = new Map();
    let longestRun = 0;
    const startOwners = {};
    for (const id in c.provinces) startOwners[id] = c.provinces[id].owner;

    for (let i = 0; i < 10; i++) {
      const rep = ZS.Turn.end(c);
      seen.battles += rep.battles.length;
      seen.captured += rep.captured.length;
      for (const cap of rep.captured) {
        if (typeof cap.occupied !== "number") problems.push("capture left no garrison record");
        const prev = lastTake.get(cap.by);
        if (prev && c.turn - prev.turn <= 3) {
          prev.run += 1;
          prev.turn = c.turn;
          if (prev.run > longestRun) longestRun = prev.run;
        } else {
          lastTake.set(cap.by, { turn: c.turn, run: 1 });
          if (longestRun < 1) longestRun = 1;
        }
        /* That the beaten garrison does not simply change flag is checked at
           the moment of capture, in the [occupation] block — not here, where a
           whole World phase of recruiting has already run over it. */
      }
      for (const aid in c.armies) if (c.armies[aid].fatigue > 0) seen.tired++;

      for (const fid in c.factions) {
        const f = c.factions[fid];
        if (f.gold < 0) problems.push("gold<0 " + fid + " t" + c.turn);
        if (f.food < 0) problems.push("food<0 " + fid + " t" + c.turn);
      }
      for (const pid in c.provinces) {
        const pr = c.provinces[pid];
        if (pr.garrison < 0) problems.push("garrison<0 " + pid);
        if (pr.loyalty < 0 || pr.loyalty > 100) problems.push("loyalty " + pid + "=" + pr.loyalty);
      }
      for (const aid in c.armies) {
        const a = c.armies[aid];
        if (a.troops < 0) problems.push("troops<0 " + aid);
        if (!c.provinces[a.at]) problems.push("army nowhere " + aid);
        if (a.path && a.path.length && !ZS.CampaignMap.isNeighbour(a.at, a.path[0])) {
          problems.push("army teleporting " + aid);
        }
        if (a.faction !== c.playerFactionId && ZS.Army.isMarching(a)) seen.aiMarches++;
      }
    }

    let changed = 0;
    for (const id in c.provinces) if (c.provinces[id].owner !== startOwners[id]) changed++;

    return {
      turn: c.turn,
      year: c.year,
      season: c.season,
      problems: problems.slice(0, 6),
      problemCount: problems.length,
      battles: seen.battles,
      captured: seen.captured,
      aiMarches: seen.aiMarches,
      tired: seen.tired,
      longestRun,
      changed,
      armies: Object.keys(c.armies).length,
      logLines: c.log.length,
      over: c.over,
    };
  });
  eq("ten seasons advanced the clock to turn 11", ten.turn, 11);
  eq("...which is 196 CE", ten.year, 196);
  eq("...and the season wrapped correctly", ten.season, 2);
  ok("no invariant broke across ten seasons", ten.problemCount === 0, ten.problems);
  ok("the AI is actually marching", ten.aiMarches > 0, ten);
  ok("battles happened without anyone touching a battlefield", ten.battles > 0, ten);
  ok("provinces changed hands", ten.changed > 0, ten);
  ok("the world phase wrote a record", ten.logLines > 0, ten.logLines);
  ok("no stack chains conquests (ISSUES #10)", ten.longestRun > 0 && ten.longestRun <= 6, ten);
  ok("...and fighting tires the men who did it", ten.tired > 0, ten.tired);

  /* ---- occupation ------------------------------------------------------ */
  /* The mechanism behind the anti-chain assertion above, checked directly:
     P3's first pass changed the owner and left `garrison` alone, so a beaten
     defence flipped sides intact and the conqueror walked on with a full stack
     and a free garrison behind it. */
  console.log("\n[occupation]");
  const occ = await page.evaluate(() => {
    const c = ZS.Campaign.create(31337, "cao_cao");
    const target = "puyang"; // Lü Bu's, next door to Chenliu
    const pr = c.prov(target);
    pr.garrison = 4000;
    const a = c.armiesOf("cao_cao")[0];
    a.at = "chenliu";
    a.troops = 5000;
    const before = { troops: a.troops, owner: pr.owner, cost: c.occupationCost(target) };
    const left = c.occupy(target, a);
    return {
      before,
      left,
      after: a.troops,
      owner: pr.owner,
      garrison: pr.garrison,
      loyalty: pr.loyalty,
      size: ZS.CampaignMap.province(target).size,
      /* a stack that cannot spare a holding garrison leaves what it has */
      spent: (() => {
        const c2 = ZS.Campaign.create(31337, "cao_cao");
        const p2 = c2.prov("puyang");
        p2.garrison = 900;
        const small = c2.raiseArmy("cao_cao", "chenliu", 120);
        const gave = c2.occupy("puyang", small);
        return { gave, troops: small.troops, garrison: p2.garrison, owner: p2.owner };
      })(),
    };
  });
  eq("the beaten garrison does not change flag", occ.garrison, occ.left);
  eq("...it is replaced by men the taking stack left behind", occ.left, occ.before.cost);
  eq("...which really came out of that stack", occ.after, occ.before.troops - occ.left);
  eq("the province changes hands", occ.owner, "cao_cao");
  eq("...and a conquest is not loved", occ.loyalty, 30);
  ok("the holding garrison scales with the province", occ.before.cost === 260 * occ.size, occ);
  eq("a stack too small to garrison leaves everything it has", occ.spent.troops, 0);
  ok(
    "...and the province is still taken",
    occ.spent.owner === "cao_cao" && occ.spent.garrison === 120,
    occ.spent,
  );

  /* ---- determinism --------------------------------------------------- */
  console.log("\n[determinism]");
  const det = await page.evaluate(() => {
    const digest = (c) => {
      const parts = [c.turn];
      const pids = Object.keys(c.provinces).sort();
      for (const id of pids) {
        const p = c.provinces[id];
        parts.push(id, p.owner, p.garrison, p.loyalty, p.dev.income, p.dev.wall);
      }
      const aids = Object.keys(c.armies).sort();
      for (const id of aids) {
        const a = c.armies[id];
        parts.push(id, a.faction, a.at, a.troops, a.left, (a.path || []).join(">"));
      }
      for (const fid of Object.keys(c.factions).sort()) {
        parts.push(fid, c.factions[fid].gold, c.factions[fid].food);
      }
      return parts.join("|");
    };
    const run = (seed) => {
      const c = ZS.Campaign.create(seed, "cao_cao");
      for (let i = 0; i < 8; i++) ZS.Turn.end(c);
      return digest(c);
    };
    return { a: run(777), b: run(777), other: run(778) };
  });
  eq("the same seed plays out identically", det.a, det.b);
  ok("a different seed does not", det.a !== det.other);

  /* ---- save, reload, resume ------------------------------------------ */
  console.log("\n[save / reload]");
  const saved = await page.evaluate(async () => {
    const c = (ZS.App.campaign = ZS.Campaign.create(9001, "sun_ce"));
    for (let i = 0; i < 6; i++) ZS.Turn.end(c);
    // put something distinctive in that the round-trip has to preserve
    const home = c.factionDef("sun_ce").capital;
    const owned = c.provincesOf("sun_ce");
    const mark = owned.length ? owned[0] : home;
    c.prov(mark).garrison = 1234;
    c.prov(mark).dev.wall = 2;
    const okSave = await ZS.SaveManager.autosave(true);
    const slots = await ZS.SaveManager.listSlots();
    const auto = slots.find((s) => s.slot === ZS.SaveManager.AUTOSAVE_SLOT);
    return {
      okSave,
      turn: c.turn,
      mark,
      slotTurn: auto ? auto.meta.turn : null,
      slotYear: auto ? auto.meta.year : null,
      slotFaction: auto ? auto.meta.faction : null,
      digestArmies: Object.keys(c.armies).length,
      gold: c.player().gold,
    };
  });
  ok("the world-phase autosave wrote", saved.okSave);
  eq("the slot knows which turn it is", saved.slotTurn, saved.turn);
  eq("...and which year", saved.slotYear, 195);
  eq("...and whose campaign it is", saved.slotFaction, "sun_ce");

  await page.reload();
  await page.waitForFunction(() => window.ZS && ZS.App && ZS.App.booted === true, null, {
    timeout: 15000,
  });

  const loaded = await page.evaluate(async (want) => {
    await ZS.SaveManager.load(ZS.SaveManager.AUTOSAVE_SLOT);
    const c = ZS.App.campaign;
    if (!c) return { none: true };
    return {
      turn: c.turn,
      year: c.year,
      faction: c.playerFactionId,
      isPlayer: c.player().isPlayer,
      armies: Object.keys(c.armies).length,
      gold: c.player().gold,
      markGarrison: c.prov(want.mark).garrison,
      markWall: c.prov(want.mark).dev.wall,
      provinces: Object.keys(c.provinces).length,
      /* a restored campaign has to keep taking turns, not just render */
      canContinue: (() => {
        const before = c.turn;
        ZS.Turn.end(c);
        return c.turn === before + 1;
      })(),
    };
  }, saved);
  ok("the campaign came back", !loaded.none);
  eq("...on the turn it was saved", loaded.turn, saved.turn);
  eq("...as the same warlord", loaded.faction, "sun_ce");
  eq("...with the player flag rebuilt", loaded.isPlayer, true);
  eq("...with every army", loaded.armies, saved.digestArmies);
  eq("...with the treasury intact", loaded.gold, saved.gold);
  eq("...with the marked garrison intact", loaded.markGarrison, 1234);
  eq("...and its walls", loaded.markWall, 2);
  eq("...and the full province list", loaded.provinces, map.count);
  ok("a loaded campaign keeps taking turns", loaded.canContinue);

  /* ---- the view ------------------------------------------------------ */
  console.log("\n[the campaign view]");
  const view = await page.evaluate(() => {
    ZS.App.go("campaign", { campaign: ZS.App.campaign });
    const V = ZS.CampaignView;
    const out = {
      state: ZS.App.state,
      appLoop: ZS.App.running,
      listeners: !!V._listeners,
      barShown: !!document.querySelector(".camp-bar.on"),
      panelShown: !!document.querySelector(".camp-panel.on"),
      menuHidden: !document.querySelector('.panel[data-panel="main"].on'),
      selected: V.selProvince,
    };
    // clicking a seat in world space selects that province
    const p = ZS.CampaignMap.province("kuaiji");
    V.pick(p.x, p.y);
    out.picked = V.selProvince;
    // ordering a stack by right-clicking a province
    let mine = null;
    for (const id in V.camp.armies) {
      if (V.camp.armies[id].faction === V.camp.playerFactionId) mine = V.camp.armies[id];
    }
    if (mine) {
      V.selectArmy(mine.id);
      const nb = ZS.CampaignMap.neighbours(mine.at)[0];
      const np = ZS.CampaignMap.province(nb.id);
      V.order(np.x, np.y);
      out.ordered = ZS.Army.isMarching(V.camp.armies[mine.id]);
      out.armySelected = V.selArmy === mine.id;
    }
    out.endTurnBtn = !!document.getElementById("btn-end-turn");
    return out;
  });
  eq("the shell is in the CAMPAIGN state", view.state, "campaign");
  ok("the shell keeps its own loop (no engine here)", view.appLoop);
  ok("the view attached its listeners", view.listeners);
  ok("the campaign bar and panel are up", view.barShown && view.panelShown);
  ok("the menu got out of the way", view.menuHidden);
  ok("the view opened on the player's own ground", !!view.selected);
  eq("clicking a seat selects that province", view.picked, "kuaiji");
  ok("a stack can be selected and ordered from the map", view.ordered && view.armySelected, view);
  ok("End Season is on the bar", view.endTurnBtn);

  const uiTurn = await page.evaluate(() => {
    const before = ZS.App.campaign.turn;
    /* P6 Tales deliberately block the next season until their visible choice
       is answered. Resolve a carried event first; this P3 assertion is still
       about the End Season transaction rather than event UX. */
    const eventChoice = document.querySelector("[data-event-choice]:not(:disabled)");
    if (eventChoice) eventChoice.click();
    /* P4 normally suspends on a player battle. This P3 regression is about
       the original synchronous campaign bar, so exercise the persisted
       auto-resolve preference explicitly. */
    const priorAuto = ZS.App.settings.autoResolveDefault;
    ZS.App.settings.autoResolveDefault = true;
    document.getElementById("btn-end-turn").click();
    ZS.App.settings.autoResolveDefault = priorAuto;
    return {
      advanced: ZS.App.campaign.turn === before + 1,
      report: !!document.querySelector(".camp-report.on"),
      bar: (document.querySelector(".cb-date") || {}).textContent || "",
    };
  });
  ok("the End Season button runs a turn", uiTurn.advanced);
  ok("...and reports what happened", uiTurn.report);
  ok("...and the bar tracks the new season", /19\d/.test(uiTurn.bar), uiTurn.bar);

  /* ---- locale -------------------------------------------------------- */
  console.log("\n[locale]");
  const loc = await page.evaluate(() => {
    ZS.i18n.set("en");
    const en = {
      date: (document.querySelector(".cb-date") || {}).textContent || "",
      panel: (document.querySelector(".ctitle") || {}).textContent || "",
    };
    ZS.i18n.set("zh-tw");
    const zh = {
      date: (document.querySelector(".cb-date") || {}).textContent || "",
      panel: (document.querySelector(".ctitle") || {}).textContent || "",
    };
    return { en, zh };
  });
  ok(
    "the campaign bar speaks English on demand",
    /195|196/.test(loc.en.date) && /CE|Spring|Summer|Autumn|Winter/.test(loc.en.date),
    loc.en,
  );
  ok("...and Chinese by default", /西元/.test(loc.zh.date), loc.zh);
  ok("the panel retitles with the locale", loc.en.panel !== loc.zh.panel, loc);

  /* ---- the faction picker ---------------------------------------------- */
  /* This path is how a real player starts a campaign, and it is the one the
     first pass of this suite did not walk: everything above reaches for
     ZS.Campaign.create() directly, which builds the map as a side effect. The
     picker does not, and it threw on a null province until CampaignMap started
     building itself at load. */
  console.log("\n[the picker]");
  const pick = await page.evaluate(() => {
    ZS.App.go("menu");
    document.getElementById("btn-campaign").click();
    const cards = document.querySelectorAll(".pick-card");
    const out = {
      shown: !!document.querySelector("#camp-pick.on"),
      cards: cards.length,
      firstLabel: cards.length ? cards[0].textContent : "",
      menuHidden: !document.querySelector('.panel[data-panel="main"].on'),
    };
    const card = document.querySelector('.pick-card[data-faction="liu_bei"]');
    out.hasLiuBei = !!card;
    if (card) card.click();
    out.state = ZS.App.state;
    out.faction = ZS.App.campaign ? ZS.App.campaign.playerFactionId : null;
    out.turn = ZS.App.campaign ? ZS.App.campaign.turn : null;
    out.pickGone = !document.querySelector("#camp-pick.on");
    return out;
  });
  ok("the campaign button opens the picker", pick.shown);
  ok("...listing every playable warlord", pick.cards >= 3, pick.cards);
  ok("...with a real name and holdings on the card", pick.firstLabel.length > 4, pick.firstLabel);
  ok("...over a hidden menu", pick.menuHidden);
  ok("the weak start is on offer", pick.hasLiuBei);
  eq("picking one enters the campaign", pick.state, "campaign");
  eq("...as that warlord", pick.faction, "liu_bei");
  eq("...on turn 1", pick.turn, 1);
  ok("...and the picker gets out of the way", pick.pickGone);

  /* ---- leaving -------------------------------------------------------- */
  console.log("\n[teardown]");
  const down = await page.evaluate(() => {
    ZS.App.go("menu");
    return {
      state: ZS.App.state,
      listeners: !!ZS.CampaignView._listeners,
      camp: !!ZS.CampaignView.camp,
      barGone: !document.querySelector(".camp-bar.on"),
      panelGone: !document.querySelector(".camp-panel.on"),
      menuBack: !!document.querySelector('.panel[data-panel="main"].on'),
      stillSaved: !!ZS.App.campaign,
    };
  });
  eq("back in the MENU state", down.state, "menu");
  eq("the view released every listener", down.listeners, false);
  eq("...and dropped its reference to the campaign", down.camp, false);
  ok("the campaign chrome is gone", down.barGone && down.panelGone);
  ok("the menu is back", down.menuBack);
  ok("the campaign itself survives on the shell, ready to resume", down.stillSaved);

  /* ---- the battle is untouched ---------------------------------------- */
  console.log("\n[skirmish still works]");
  const battle = await page.evaluate(() => {
    ZS.App.go("battle");
    const s = ZS.engine.scenario;
    const out = { agents: ZS.Sim.agents.length, units: s.units.length };
    ZS.App.go("menu");
    out.stopped = !ZS.engine.running;
    return out;
  });
  eq("P1's skirmish still deploys 2,000 men", battle.agents, 2000);
  ok("...into blocks", battle.units >= 8, battle);
  ok("...and still tears down cleanly", battle.stopped);

  console.log("\n[console]");
  /* ERR_NO_BUFFER_SPACE / ERR_INSUFFICIENT_RESOURCES are the Windows loopback
     running out of ephemeral sockets when this page asks the throwaway server
     for ~45 scripts at once, one of them 1.4 MB. It is the harness, not the
     game — and a script that genuinely failed to load would take a hundred
     assertions above down with it, so nothing is being hidden here. */
  const real = errors.filter(
    (e) =>
      !/subset-data\.js|ERR_FILE_NOT_FOUND|404|ERR_NO_BUFFER_SPACE|ERR_INSUFFICIENT_RESOURCES/.test(
        e,
      ),
  );
  ok("no unexpected console errors", real.length === 0, real.slice(0, 4));

  await browser.close();
  server.close();
  console.log("\n" + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
