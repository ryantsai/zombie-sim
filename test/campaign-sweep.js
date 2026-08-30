/* Campaign pacing probe — ISSUES.md #10.

   Run:  node test/campaign-sweep.js
         node test/campaign-sweep.js --seeds 24 --seasons 60

   **This asserts nothing.** It runs N campaigns for M seasons with a completely
   passive player and prints what the board did, because the way to fix "the
   auto-resolve is too decisive" is to measure it, not to read the constants and
   guess — the same method that broke open the battle stall family
   (PROGRESS.md, "The stall family": the tell was an instrumented number, not
   the code).

   What each number is for:

     flips/season    how fast ground changes hands. A campaign where a
                     commandery falls every season is a campaign with no
                     front line.
     chains          a stack taking a second province within 3 seasons of its
                     last. This is the specific symptom: conquest should cost
                     enough that a stack has to stop.
     longest chain   the worst case of the same thing.
     garrison p50    the median garrison still standing at the end. Grinding
                     every city to double digits means assaults are too cheap.
     men on board    total troops at the end against the start. The campaign
                     should not be a slow extermination.
     alive           factions still holding ground. 22 start.
     player          the passive player's commanderies at the end, from 4. A
                     passive player *should* lose ground; they should not be
                     erased by season 20.

   Deterministic per seed, so a tuning change is compared against the same
   twenty campaigns rather than against noise. */
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

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}
const SEEDS = arg("seeds", 20);
const SEASONS = arg("seasons", 40);

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

function median(xs) {
  if (!xs.length) return 0;
  const a = xs.slice().sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}
function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function fmt(n, d) {
  return Number(n).toFixed(d === undefined ? 1 : d);
}

async function main() {
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(base + "/index.html");
  await page.waitForFunction(() => window.ZS && ZS.App && ZS.App.booted === true, null, {
    timeout: 15000,
  });

  console.log("\ncampaign sweep — " + SEEDS + " seeds x " + SEASONS + " seasons, passive player\n");

  const rows = await page.evaluate(
    ({ seeds, seasons }) => {
      const out = [];
      for (let s = 0; s < seeds; s++) {
        const seed = 1000 + s * 97;
        const c = ZS.Campaign.create(seed, "cao_cao");
        const startMen = (() => {
          let n = 0;
          for (const fid in c.factions) n += c.troopsOf(fid);
          return n;
        })();

        let flips = 0,
          chains = 0,
          longest = 1;
        const lastTake = new Map(); // army id -> { turn, run }
        let playerGoneAt = 0;

        for (let i = 0; i < seasons; i++) {
          const rep = ZS.Turn.end(c);
          flips += rep.captured.length;
          for (const cap of rep.captured) {
            const prev = lastTake.get(cap.by);
            if (prev && c.turn - prev.turn <= 3) {
              chains++;
              prev.run += 1;
              if (prev.run > longest) longest = prev.run;
              prev.turn = c.turn;
            } else {
              lastTake.set(cap.by, { turn: c.turn, run: 1 });
            }
          }
          if (!playerGoneAt && c.provincesOf("cao_cao").length === 0) playerGoneAt = i + 1;
          if (c.over) break;
        }

        const garrisons = [];
        let endMen = 0,
          alive = 0;
        for (const pid in c.provinces) {
          if (c.provinces[pid].owner) garrisons.push(c.provinces[pid].garrison);
        }
        for (const fid in c.factions) {
          if (c.factions[fid].alive) alive++;
          endMen += c.troopsOf(fid);
        }
        out.push({
          seed,
          seasons: c.turn - 1,
          flips,
          chains,
          longest,
          garrisons,
          startMen,
          endMen,
          alive,
          player: c.provincesOf("cao_cao").length,
          playerGoneAt,
          over: !!c.over,
        });
      }
      return out;
    },
    { seeds: SEEDS, seasons: SEASONS },
  );

  console.log(
    "  seed   seasons  flips  f/season  chains  longest  garr p50  men end/start  alive  player",
  );
  for (const r of rows) {
    console.log(
      "  " +
        String(r.seed).padEnd(7) +
        String(r.seasons).padEnd(9) +
        String(r.flips).padEnd(7) +
        fmt(r.flips / Math.max(1, r.seasons), 2).padEnd(10) +
        String(r.chains).padEnd(8) +
        String(r.longest).padEnd(9) +
        String(median(r.garrisons)).padEnd(10) +
        (fmt((100 * r.endMen) / Math.max(1, r.startMen), 0) + "%").padEnd(15) +
        String(r.alive).padEnd(7) +
        String(r.player) +
        (r.playerGoneAt ? " (out at " + r.playerGoneAt + ")" : ""),
    );
  }

  const agg = {
    flipsPerSeason: mean(rows.map((r) => r.flips / Math.max(1, r.seasons))),
    chains: mean(rows.map((r) => r.chains)),
    longest: Math.max(...rows.map((r) => r.longest)),
    garrison: median(rows.flatMap((r) => r.garrisons)),
    menPct: mean(rows.map((r) => (100 * r.endMen) / Math.max(1, r.startMen))),
    alive: mean(rows.map((r) => r.alive)),
    player: mean(rows.map((r) => r.player)),
    wipedOut: rows.filter((r) => r.playerGoneAt).length,
    decided: rows.filter((r) => r.over).length,
  };

  console.log("\n  ---- across " + rows.length + " campaigns ----");
  console.log("  commanderies changing hands   " + fmt(agg.flipsPerSeason, 2) + " per season");
  console.log("  chained conquests (<=3 turns) " + fmt(agg.chains, 1) + " per campaign");
  console.log("  longest single-stack run      " + agg.longest + " provinces");
  console.log("  median garrison at the end    " + agg.garrison + " men");
  console.log("  men left on the board         " + fmt(agg.menPct, 0) + "% of the opening");
  console.log("  factions still holding ground " + fmt(agg.alive, 1) + " of 22");
  console.log(
    "  passive player's commanderies " +
      fmt(agg.player, 1) +
      " of 4, wiped out in " +
      agg.wipedOut +
      "/" +
      rows.length,
  );
  console.log("  campaigns already decided     " + agg.decided + "/" + rows.length + "\n");

  await browser.close();
  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
