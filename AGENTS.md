# AGENTS.md — 火柴三國 / Matchstick Sanguo

火柴三國 is the sole active product in this repository. It is a hand-drawn,
"boiling line" campaign RPG: turn-based strategy on a map, real-time tactical
battles, and persistent generals. `index.html` is the entry point. Design,
status, and open decisions live in `docs/SANGUO-DESIGN.md`,
`docs/SANGUO-ART.md`, `docs/PROGRESS.md`, and `docs/ISSUES.md`.

The Outbreak, Cannae, and The Hold are archived engineering references under
`reference/`. They remain runnable and regression-tested, but they are not
active products or roadmap targets. Read `reference/README.md` and the nested
`reference/AGENTS.md` before changing anything in that subtree.

Vanilla JavaScript and Canvas 2D only. No framework, build step, or bundler.

## Run it

Double-click `index.html` (`file://`) or serve the repository with any static
server. The reference pages can likewise be double-clicked from `reference/`.
`package.json` scripts are development tooling only.

## Hard constraints

1. **The game must stay double-clickable.** Use classic `<script src>` tags and
   IIFEs sharing `window.ZS`. No ES modules, imports, dynamic module loading, or
   required build output.
2. **The style is the product.** Draw through the sketch primitives in
   `js/sketch.js`: boiling ink, stable seeded jitter, paper palette, and subtle
   low-alpha landscape washes. Sanguo-specific art follows
   `docs/SANGUO-ART.md`.
3. **Battles are deterministic** from `(seed, armies, order log)`. No bare
   `Math.random()` in simulation code. Use the scenario's seeded `ZS.rng32` and
   the fixed 1/30 s step.
4. **No per-frame allocations in hot loops.** Reuse records and arrays; decay
   and prune rather than rebuilding. Battles can carry thousands of figures.
5. **Shared engine changes stay scenario-agnostic and opt-in.** Root `js/`
   contains reusable modules Sanguo actively consumes. A shared change must not
   embed Sanguo, zombie, Cannae, or Hold rules in the core.
6. **Format with oxfmt and lint with oxlint.** Run both before finishing; zero
   warnings and errors are required.

## Product layout

```text
index.html                         product entry; classic-script load order
js/app.js                          MENU → CAMPAIGN ↔ BATTLE → RESULT shell
js/scenarios/sanguo.js             real-time battle scenario
js/battle/                         command, formation, morale, abilities, AI
js/campaign/                       map-strategy RPG and turn simulation
js/campaign/data/                  provinces, factions, generals, content
js/ui/                             menu and campaign DOM/canvas interfaces
js/art/ + js/figure/               sketch environment, flags, UI, units, portraits
js/store/ + js/save/ + js/auth/    persistence seams and durable saves
js/i18n/ + js/fonts/               zh-tw default, English fallback, embedded font
js/music/ + js/sound.js            procedural/embedded audio
js/{sketch,grid,nav,camera,...}.js shared Canvas engine
reference/                         archived demos, packs, docs, and tests
test/                              Sanguo verification and screenshot helpers
tools/                             manifests, font tooling, validators
```

`js/tiles.js`, `js/blocks.js`, `js/buildings.js`, and the other generic engine
files stay at root even though earlier prototypes introduced some of them:
Sanguo's town and fort battlefields depend on those modules directly.

## Boot and frame ownership

`index.html` sets `window.ZS_MANUAL_BOOT = true`. It loads the shell and all
product modules before `ZS.App` creates a world. Each battle is started with a
`ScenarioSanguo` instance through `ZS.Engine.start(opts)` and torn down with
`engine.stop()` when the shell leaves the battle.

`ZS.Engine.start(opts)` owns the canvas, world, camera, input listeners, and
frame loop. Its handle exposes `stop()`, deterministic `step(dt)`, `speed`
(`0`, `1`, `2`, or `4`), and `fixedStep`. `stop()` must cancel the loop and
remove every listener it installed; there must never be two live engines.

The shared frame pipeline is:

1. advance the sketch boil epoch;
2. update `ZS.Sim` and scenario state;
3. rebuild the spatial grid and run hostile-first AI;
4. separate, clamp, integrate, and compact agents without hot-loop garbage;
5. draw paper terrain, stains, y-sorted world objects and agents, FX, overlays,
   speech, and the scenario HUD.

Scenario callbacks include `terrain`, `drawGround`, `makeAgent`, `hostile`,
`walkBlocked`, `maxSpeed`, `frame`, `update`, `init`, `maintain`, `left`,
`counts`, `tap`, `hud`, `draw`, `drawFX`, and optional pointer/camera hooks.
Core-owned agent fields are documented beside `js/agents.js`; do not repurpose
them for scenario state.

## Sanguo invariants

- `ZS.App` owns the top-level state machine; a world does not exist in MENU.
- Campaign clashes suspend the season, enter the exact generated battlefield,
  and apply one `BattleResult` exactly once on return.
- Open, town, and fort fields all use the same `ScenarioSanguo`; terrain data
  selects the battlefield implementation.
- Group movement uses `ZS.FlowField`, not per-agent A*.
- Active pause accepts selection, orders, formations, abilities, and camera
  input while the simulation is frozen.
- Save writes follow shadow → main → backup durability and schema migrations.
- zh-tw is the default locale; English is the fallback.
- Every Sanguo figure is drawn through the §7 baseline in
  `js/figure/figure.js`; portraits, flags, environment, and UI follow the art
  catalogue rather than ad hoc canvas styling.
- The campaign map must keep ownership readable, labels unobscured, and click,
  drag, and right-click march paths behaviorally consistent.

## Font and file:// assets

LXGW WenKai TC is committed as `fonts/lxgw-wenkai-tc.subset.woff2` and again as
a `data:` URI in `js/fonts/subset-data.js`. The embedded copy is required
because browsers reject a font fetch from a `file://` opaque origin. When any
text-bearing file loaded by `index.html` changes, run:

```bash
python tools/subset-font.py --check
```

If glyphs are missing, rebuild from the committed source face as documented in
`docs/FONTS.md`. `tools/subset-font.py --sources` derives its source list from
`index.html`; do not maintain a second hand-written list.

## Tooling and verification

Run from the repository root:

```bash
npm run format
npm run lint
npm test
```

For non-TTY automation, call the local binaries directly rather than `npx`:

```bash
node node_modules/oxfmt/bin/oxfmt js/ test/ tools/ reference/js/ reference/test/
node node_modules/oxlint/bin/oxlint js/ test/ tools/ reference/js/ reference/test/
```

`npm test` lints first, then runs all Sanguo P0–P7 and campaign UI suites, the
archived reference guards, the font check, and the 200-general validator. The
GitHub workflow runs the same gate. Useful focused commands include:

- `npm run test:p0` — boot, file://, save, i18n, font, and module manifest
- `npm run test:p1` — deterministic commandable skirmish
- `npm run test:p3` through `test:p7` — campaign slices
- `npm run test:ui` — campaign interface behavior
- `npm run test:reference` — all archived pages and Hold P4 preservation
- `npm run test:seeds` — slower battle no-hang sweep
- `npm run shots` — Sanguo screenshots into ignored `.verify/`

`tools/module-manifest.js` resolves `<script src>` paths relative to each page,
checks every promised `ZS.*` export at boot, and rejects exported modules under
either `js/` or `reference/js/` that no page loads. A JavaScript file that
fails to parse can otherwise be skipped silently by a classic-script page, so
never bypass lint or the manifest.

Reusable checks belong in `test/` for Sanguo or `reference/test/` for archived
demos. `.verify/` is only for one-off probes and screenshot output.

## Change recipes

- **Campaign rule or UI** → keep the rule in `js/campaign/`, data in
  `js/campaign/data/`, and presentation in `js/campaign/view.js` or `js/ui/`.
- **Battle rule** → prefer `js/scenarios/sanguo.js` or a focused module under
  `js/battle/`; keep the fixed-step determinism and order log intact.
- **Shared engine change** → keep it generic, make new behavior opt-in when
  possible, then run both Sanguo and `npm run test:reference`.
- **New product module** → add its classic script tag to `index.html` in
  dependency order. The manifest must report no orphan export.
- **New visible text** → update both locale tables where applicable and run the
  font subset check.
- **Move files or pages** → update page-relative script paths, the module
  manifest, tests, VS Code launch targets, and documentation; verify file://.
- **Reference-only change** → read `reference/AGENTS.md`. Do not resume an
  archived prototype roadmap unless the user explicitly asks.

## Current status

P0–P7 are complete. `docs/PROGRESS.md` is the resumption source of truth.
`docs/ISSUES.md` currently keeps fog of war as a v2 nit; archived Hold P5/P6
ideas are not Sanguo work.
