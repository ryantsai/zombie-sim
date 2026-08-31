#!/usr/bin/env node
/* Which modules each page promises to put on `window.ZS`, harvested from the
   source rather than kept by hand.

   Issue 14: `index.html` loads ~50 classic `<script src>` files, and a file
   that fails to parse is skipped silently — the page still boots, the module
   is simply absent, and the failure surfaces as a `TypeError` several files
   away. A forgotten `<script>` tag looks identical and no lint can see it.

   Every module here ends the same way: an IIFE that hangs its exports off `ZS`
   at the closing indent.

       js/campaign/army.js        ->  ZS.Army = Army;
       js/store/store.js          ->  ZS.Store = ...; ZS.MemoryStore = ...;

   So the promise a file makes is readable statically: assignments to `ZS.<name>`
   at indent <= 2. Deeper ones are runtime handles set inside a function once a
   scenario is live (`ZS.engine`, `ZS.scenario`, `ZS.debug`) and are not part of
   what a page owes at boot.

   Used by test/sanguo-p0.js (the product page) and
   reference/test/pages-regression.js (the archived demos), which assert every
   promised name is actually there.

   Run standalone to see the manifest:  node tools/module-manifest.js */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PAGES = [
  "index.html",
  "reference/zombiesim.html",
  "reference/hold.html",
  "reference/battle.html",
];
const MODULE_ROOTS = ["js", "reference/js"];

/* Assignment to ZS.<name> at the module's own indent, not inside a function. */
const EXPORT_RE = /^ {0,2}(?:window\.)?ZS\.([A-Za-z_$][\w$]*)\s*=/gm;

function repoPath(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

/* Local `<script src>`, in load order and resolved relative to its HTML page. */
function scripts(page) {
  const pageFile = path.join(ROOT, page);
  const html = fs.readFileSync(pageFile, "utf-8");
  const out = [];
  const re = /<script[^>]*\ssrc=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (/^[a-z][a-z\d+.-]*:/i.test(m[1])) continue;
    const clean = m[1].split(/[?#]/, 1)[0];
    out.push(repoPath(path.resolve(path.dirname(pageFile), clean)));
  }
  return out;
}

/* The ZS names a single file declares. */
function exportsOf(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return null; // caller reports the missing file
  const src = fs.readFileSync(file, "utf-8");
  const names = new Set();
  let m;
  EXPORT_RE.lastIndex = 0;
  while ((m = EXPORT_RE.exec(src)) !== null) names.add(m[1]);
  return [...names];
}

/* Everything `page` promises: { names, missing, byFile }. */
function expected(page) {
  const names = new Set(),
    missing = [],
    byFile = {};
  for (const rel of scripts(page)) {
    const ex = exportsOf(rel);
    if (ex === null) {
      missing.push(rel);
      continue;
    }
    byFile[rel] = ex;
    for (const n of ex) names.add(n);
  }
  return { names: [...names].sort(), missing, byFile };
}

/* Every product or reference .js module that exports a ZS name but no page
   loads. A new module with no `<script>` tag is the silent failure a lint
   cannot catch. */
function orphans() {
  const loaded = new Set();
  for (const p of PAGES) for (const rel of scripts(p)) loaded.add(rel);

  const out = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(".js")) {
        const rel = repoPath(abs);
        if (loaded.has(rel)) continue;
        const ex = exportsOf(rel);
        if (ex && ex.length) out.push({ file: rel, exports: ex });
      }
    }
  }
  for (const rel of MODULE_ROOTS) walk(path.join(ROOT, rel));
  return out;
}

module.exports = { PAGES, scripts, exportsOf, expected, orphans };

if (require.main === module) {
  for (const p of PAGES) {
    const e = expected(p);
    console.log("\n" + p + "  (" + scripts(p).length + " scripts, " + e.names.length + " names)");
    console.log("  " + e.names.join(" "));
    if (e.missing.length) console.log("  MISSING FILES: " + e.missing.join(" "));
  }
  const orph = orphans();
  console.log("\norphans (export ZS names, loaded by no page): " + (orph.length || "none"));
  for (const o of orph) console.log("  " + o.file + "  -> " + o.exports.join(" "));
  console.log();
}
