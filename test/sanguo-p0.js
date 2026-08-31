/* P0 verification (SANGUO-DESIGN.md §10).

   Asserts the P0 row of the phase table:
     index.html boots to a MENU
     the brush-kai subset loads (skipped with a warning until the asset exists)
     ZS.i18n toggles zh-tw <-> en
     ZS.Auth = AnonAuth mints a stable deviceId
     ZS.Store + LocalStore + SaveManager round-trip a snapshot across a reload

   Run:  node test/sanguo-p0.js
         node test/sanguo-p0.js --headed      (real Chrome, for eyeballing)

   Served over http on a throwaway port: localStorage is unavailable on a
   file:// opaque origin in Chromium, and the persistence assertions need it.
   A separate case at the end loads the same page over file:// to prove it
   still boots there (into MemoryStore). */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { chromium } = require("playwright");
const manifest = require("../tools/module-manifest.js");

const ROOT = path.resolve(__dirname, "..");
const HEADED = process.argv.includes("--headed");

function pythonCommand() {
  const explicit = process.env.PYTHON;
  if (explicit && fs.existsSync(explicit)) return { command: explicit, prefix: [] };
  const local = process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, ".local", "bin", "python.exe")
    : null;
  if (local && fs.existsSync(local)) return { command: local, prefix: [] };
  return {
    command: process.platform === "win32" ? "py" : "python3",
    prefix: process.platform === "win32" ? ["-3"] : [],
  };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

let pass = 0,
  fail = 0,
  warn = 0;

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
function skip(name, why) {
  warn++;
  console.log("  WARN  " + name + "  -> " + why);
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
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/* The app boots asynchronously (store probe, identity, font). */
function booted(page) {
  return page.waitForFunction(
    () => window.ZS && window.ZS.App && window.ZS.App.booted === true,
    null,
    {
      timeout: 10000,
    },
  );
}

async function main() {
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch(HEADED ? { headless: false, channel: "chrome" } : {});
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  ctx.on("weberror", (e) => errors.push(String(e.error())));

  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  /* ---- boot ------------------------------------------------------- */
  console.log("\n[boot]");
  await page.goto(base + "/index.html");
  await booted(page);

  const boot = await page.evaluate(() => ({
    state: ZS.App.state,
    store: ZS.debug.store.name,
    locale: ZS.i18n.locale,
    lang: document.documentElement.getAttribute("lang"),
    deviceId: ZS.Auth.deviceId,
    minted: ZS.Auth.minted,
    lsDevice: localStorage.getItem("hsg:v1:device"),
    title: ZS.i18n.t("app.title"),
    schema: ZS.SaveManager.SCHEMA_VERSION,
    canvas: document.getElementById("c").width > 0,
    menuVisible: !!document.querySelector('.panel[data-panel="main"].on'),
    fontOk: ZS.Fonts.ok,
    fontVia: ZS.Fonts.via,
  }));

  eq("boots into the MENU state", boot.state, "menu");
  ok("the main menu panel is on screen", boot.menuVisible);
  ok("the canvas is sized", boot.canvas);
  eq("LocalStore is the bound backend", boot.store, "local");
  eq("zh-tw is the default locale", boot.locale, "zh-tw");
  eq("<html lang> follows the locale", boot.lang, "zh-tw");
  eq("the title resolves through i18n", boot.title, "火柴三國");
  ok("a deviceId was minted", !!boot.deviceId && boot.deviceId.length >= 8, boot.deviceId);
  ok("the deviceId is persisted under hsg:v1:device", boot.lsDevice === boot.deviceId);
  eq("schema version is an integer >= 1", boot.schema >= 1, true);

  /* ---- module manifest --------------------------------------------- */
  /* Issue 14: a script that fails to parse is skipped silently — the page
     still boots and the module is just missing from ZS, so the failure
     surfaces as a TypeError somewhere else entirely. A forgotten <script>
     tag looks the same and no lint can see it. tools/module-manifest.js
     reads what each file promises; here we check the page delivered it. */
  console.log("\n[manifest]");
  const want = manifest.expected("index.html");
  ok("every <script src> in index.html exists", want.missing.length === 0, want.missing);

  const got = await page.evaluate(() => Object.keys(window.ZS || {}));
  const absent = want.names.filter((n) => !got.includes(n));
  ok(
    "all " + want.names.length + " modules index.html loads are on ZS",
    absent.length === 0,
    absent.map((n) => {
      const src = Object.keys(want.byFile).find((k) => want.byFile[k].includes(n));
      return n + " (" + src + ")";
    }),
  );

  const orphans = manifest.orphans();
  ok(
    "no product/reference module exports to ZS without a page script tag",
    orphans.length === 0,
    orphans.map((o) => o.file),
  );

  /* ---- font ------------------------------------------------------- */
  console.log("\n[font]");
  const asset = fs.existsSync(path.join(ROOT, "fonts", "lxgw-wenkai-tc.subset.woff2"));
  const dataJs = fs.existsSync(path.join(ROOT, "js", "fonts", "subset-data.js"));
  if (!asset && !dataJs) {
    skip(
      "LXGW WenKai TC subset renders (not the system fallback)",
      "no subset built yet — run tools/subset-font.py",
    );
    eq("the loader reports the fallback honestly", boot.fontVia, "fallback");
  } else {
    ok("LXGW WenKai TC subset renders (not the system fallback)", boot.fontOk, boot.fontVia);
    /* §6.3: a glyph outside the subset silently falls back to system kai, and
       we want to know. The tool re-harvests the same sources the build used. */
    const py = pythonCommand();
    const cov = spawnSync(py.command, py.prefix.concat(["tools/subset-font.py", "--check"]), {
      cwd: ROOT,
      encoding: "utf-8",
    });
    ok(
      "every glyph the game can render is in the subset",
      cov.status === 0,
      (cov.stdout || "").trim() + (cov.error ? " " + cov.error.message : ""),
    );
  }

  /* ---- locale ----------------------------------------------------- */
  console.log("\n[locale]");
  await page.click("#btn-settings");
  await page.click("#btn-lang-en");
  const en = await page.evaluate(() => ({
    locale: ZS.i18n.locale,
    lang: document.documentElement.getAttribute("lang"),
    campaign: document.getElementById("btn-campaign").textContent,
    stored: localStorage.getItem("hsg:v1:locale"),
    chipOn: document.getElementById("btn-lang-en").classList.contains("on"),
    n: ZS.i18n.n(80000),
    nc: ZS.i18n.nc(80000),
  }));
  eq("switching to en changes the locale", en.locale, "en");
  eq("<html lang> follows the switch", en.lang, "en");
  eq("DOM text refills from the en table", en.campaign, "New Campaign");
  eq("the locale is persisted standalone", en.stored, "en");
  ok("the active language chip is marked", en.chipOn);
  eq("en grouping", en.n, "80,000");
  eq("en compact", en.nc, "80K");

  await page.click("#btn-lang-zh-tw");
  const zh = await page.evaluate(() => ({
    campaign: document.getElementById("btn-campaign").textContent,
    nc: ZS.i18n.nc(80000),
    missing: ZS.i18n.t("no.such.key.at.all"),
    content: ZS.i18n.t({ "zh-tw": "關羽", en: "Guan Yu" }),
  }));
  eq("switching back refills the zh-tw table", zh.campaign, "開創霸業");
  eq("zh-tw compact uses 萬", zh.nc, "8萬");
  eq("an unknown key renders visibly, never blank", zh.missing, "no.such.key.at.all");
  eq("bilingual content objects resolve by locale", zh.content, "關羽");

  /* ---- save round-trip -------------------------------------------- */
  console.log("\n[save]");
  const saved = await page.evaluate(async () => {
    ZS.App.settings.master = 0.42;
    ZS.i18n.set("en");
    await ZS.App.persistSettings(); // what the settings UI does on change
    await ZS.SaveManager.save(1);
    await ZS.SaveManager.save(1); // twice, so the :bak rung is exercised
    const keys = await ZS.SaveManager.store.keys("hsg:v1:slot:");
    return { keys, slots: await ZS.SaveManager.listSlots() };
  });
  ok("the slot key was written", saved.keys.includes("hsg:v1:slot:1"), saved.keys);
  ok("a :bak rung exists after the second write", saved.keys.includes("hsg:v1:slot:1:bak"));
  ok("no :shadow is left behind", !saved.keys.some((k) => k.endsWith(":shadow")), saved.keys);
  eq("listSlots sees one slot", saved.slots.length, 1);
  eq("listSlots reports the slot id", saved.slots[0].slot, "1");

  const deviceBefore = boot.deviceId;
  await page.reload();
  await booted(page);

  const after = await page.evaluate(async () => {
    const before = { locale: ZS.i18n.locale, master: ZS.App.settings.master };
    await ZS.SaveManager.load(1);
    return {
      before,
      deviceId: ZS.Auth.deviceId,
      minted: ZS.Auth.minted,
      locale: ZS.i18n.locale,
      master: ZS.App.settings.master,
      campaign: document.getElementById("btn-campaign").textContent,
    };
  });
  eq("the deviceId survives a reload", after.deviceId, deviceBefore);
  eq("a returning device does not re-mint", after.minted, false);
  eq("standalone settings survive a reload on their own", after.before.master, 0.42);
  eq("loading the slot restores the locale", after.locale, "en");
  eq("loading the slot restores a setting", after.master, 0.42);
  eq("the loaded locale reaches the DOM", after.campaign, "New Campaign");

  /* ---- durability + versioning ------------------------------------ */
  console.log("\n[durability]");
  const dur = await page.evaluate(async () => {
    const out = {};
    /* A torn main key must fall back to :bak rather than lose the save. */
    localStorage.setItem("hsg:v1:slot:1", "{ not json");
    out.recovered = (await ZS.SaveManager.load(1)) !== null;

    /* A save from a newer build is refused whole. */
    localStorage.setItem("hsg:v1:slot:9", JSON.stringify({ version: 99, meta: {} }));
    try {
      await ZS.SaveManager.load(9);
      out.future = "loaded";
    } catch (e) {
      out.future = e.code;
    }

    /* Missing slot. */
    try {
      await ZS.SaveManager.load(7);
      out.missing = "loaded";
    } catch (e) {
      out.missing = e.code;
    }

    /* The MemoryStore honours the same contract. */
    const mem = new ZS.MemoryStore();
    await mem.set("hsg:v1:x", "1");
    out.mem = [
      await mem.get("hsg:v1:x"),
      await mem.get("hsg:v1:nope"),
      (await mem.keys("hsg:v1:")).length,
    ];

    await ZS.SaveManager.deleteSlot(9);
    out.afterDelete = (await ZS.SaveManager.store.keys("hsg:v1:slot:9")).length;
    return out;
  });
  ok("a torn main key recovers from :bak", dur.recovered);
  eq("a future-version save is refused", dur.future, "future_version");
  eq("a missing slot reports not_found", dur.missing, "not_found");
  eq("MemoryStore get/miss/keys", JSON.stringify(dur.mem), JSON.stringify(["1", null, 1]));
  eq("deleteSlot clears main + shadow + bak", dur.afterDelete, 0);

  /* ---- file:// ----------------------------------------------------- */
  console.log("\n[file://]");
  const filePage = await ctx.newPage();
  filePage.on("console", (m) => {
    if (m.type() === "error") errors.push("file:// " + m.text());
  });
  await filePage.goto("file://" + path.join(ROOT, "index.html").replace(/\\/g, "/"));
  await booted(filePage);
  const f = await filePage.evaluate(() => ({
    state: ZS.App.state,
    store: ZS.debug.store.name,
    title: ZS.i18n.t("app.title"),
    warned: ZS.App.storageWarning,
    fontOk: ZS.Fonts.ok,
    fontVia: ZS.Fonts.via,
  }));
  eq("double-clicked page still boots to the menu", f.state, "menu");
  eq("it renders the title", f.title, "火柴三國");
  ok(
    "storage degrades honestly on an opaque origin",
    f.store === "local" || (f.store === "memory" && f.warned),
    f,
  );
  if (dataJs) {
    /* The whole point of the data: URI path — a CORS-mode @font-face fetch
       from an opaque origin is refused, so this is the only way real kai
       reaches a double-clicked page. */
    ok("brush-kai still renders on file://", f.fontOk, f.fontVia);
    eq("...and it came from the data: URI, not the CSS rule", f.fontVia, "data");
  } else {
    skip("brush-kai still renders on file://", "js/fonts/subset-data.js not built");
  }

  /* ---- console ----------------------------------------------------- */
  console.log("\n[console]");
  const real = errors.filter((e) => !/subset-data\.js|net::ERR_FILE_NOT_FOUND|404/.test(e));
  ok("no unexpected console errors", real.length === 0, real);

  await browser.close();
  server.close();

  console.log("\n" + pass + " passed, " + fail + " failed, " + warn + " warned\n");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
