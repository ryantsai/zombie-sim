# 火柴三國 — build progress

Living status file for the build described in [`SANGUO-DESIGN.md`](SANGUO-DESIGN.md).
**Read this first when resuming.** It is updated as work lands, so a fresh
session (or one after a usage-limit reset) can pick up mid-phase without
re-deriving anything.

- Design contract: `SANGUO-DESIGN.md` (§10 has the phase table)
- Engine rules: `AGENTS.md` (hard constraints — file://, no build step, oxfmt/oxlint)
- Open issues: [`ISSUES.md`](ISSUES.md)
- Verify: `npm test` (see [`test/README.md`](../test/README.md))

---

## Current position

| | |
|---|---|
| **Phase** | **P7 — complete v1 campaign** |
| **Status** | ✅ **complete** (P0–P7 ✅) |
| **Verify** | `npm test` runs every Sanguo phase suite: P0 boot/font/save/file://; P1 deterministic real-time battle; P3 campaign; P4 map/handoff/turn/battle; P5 generals/duels/abilities/UI; P6 doctrines/events/logistics/politics/victory/RemoteStore; P7 deterministic long-campaign sweep; 200-general validator. It also runs the quarantined reference regressions. `test/sanguo-map-shots.js` renders all five biomes, three towns and three forts for visual inspection. |
| **Updated** | 2026-08-31 |

### Product scope

火柴三國 is the only active game. The Outbreak, Cannae, and The Hold are
preserved under [`reference/`](../reference/README.md) as runnable engineering
references; their unfinished roadmaps are not Sanguo follow-on work. Root
`js/` keeps the generic engine pieces Sanguo consumes, while reference-only
scenario packs, pages, designs, and tests live entirely in that subtree.

### Completed v1 slice

- Campaign clashes now suspend the season, enter the exact generated real-time
  battlefield, and return losses, territory, XP, injury, capture, death and
  duel logs exactly once.
- Battlefields ship as five open-country biomes, three dense town street plans,
  and three gated fort/castle plans with real collision, LOS, terrain costs,
  breach state, reserve routes and rout exits.
- The 200-person roster has levels, quadratic XP, unlocks, equipment, loyalty,
  wounds, rest, capture/recruitment, defection, permadeath and deterministic
  best-of-five duels. Five active abilities are commandable from the HUD.
- Campaign depth includes visible choice-driven Tales, province specialties,
  capital/depot supply, seasonal politics, seven faction doctrines, a
  pluggable mandate goal, persistent victory card and tested RemoteStore
  fallback/conflict behavior.
- The design research translated into mechanics rather than copied chrome:
  terrain and supply shape operations, officer identity drives progression,
  Tales expose consequential choices, sieges stage combat through a gate, and
  doctrines give rival houses distinct strategic priorities.

---

## Phase ledger

Legend: ☐ not started · 🚧 in progress · ✅ done · ⛔ blocked

| Phase | Deliverable | Status |
|---|---|---|
| P0 | boot to MENU, font, i18n, Auth/Store/SaveManager round-trip | ✅ |
| P1 | Skirmish battle: `ScenarioSanguo` + command layer | ✅ |
| P2 | Battle depth: formations, morale, abilities, fixed step, LOD | ✅ |
| P3 | Campaign skeleton: map, provinces, armies, turn phases | ✅ |
| P4 | The handoff: `BattleSetup`/`BattleResult`, field kinds, auto-resolve | ✅ |
| P5 | Generals as RPG: xp, skills, items, loyalty, duels | ✅ |
| P6 | AI factions, events, after-action card, `RemoteStore` | ✅ |
| P7 | Balance, content, audio | ✅ |

### P7 partial: the art + audio system

The art + audio system is in. The full visual + sonic vocabulary of
the game is procedurally generated — no images, no sprite sheets, no
audio files, file:// stays single-click. See `SANGUO-ART.md` for the
design contract.

| # | Task | Status | Files |
|---|---|---|---|
| 7.1 | The unit / figure system — stickman baseline + 12 unit types (槍 / 刀盾 / 弩 / 戟 / 騎 / 弓騎 / 投石車 / 衝車 / 旗手 / 虎豹騎 / 諸葛弩 / 象兵) + 4 rank tiers | ✅ | `js/figure/figure.js` |
| 7.2 | The flag system — 7 shapes × 3 border styles × 3 text styles; **chrome and text are independent record fields, freely swappable** | ✅ | `js/art/flag.js` |
| 7.3 | Flag preset catalogue — 94 entries covering the 3 kingdoms, 14 major families, 22 194 CE warlords, 34 major generals, 13 Han provinces, 5 imperial + rebellion banners | ✅ | `ZS.flag.PRESETS` |
| 7.4 | Flag helpers — `plant()` for in-world markers, `bearer()` for STANDARD units, `forFaction()` for the campaign-pick panel | ✅ | `ZS.flag.{plant,bearer,forFaction}` |
| 7.5 | STANDARD units honour `a.flag` — `drawStandard` routes through `ZS.flag.draw` when set, falls back to the generic faction sash otherwise | ✅ | `js/figure/figure.js` |
| 7.6 | The portrait system — all 200 generals, expanded headgear × beard × expression × hero-feature vocabulary | ✅ | `js/figure/portrait.js`, `js/campaign/data/generals.js` |
| 7.7 | The environment catalogue — trees, hills, rivers, camps, walls, gates, bridges, ruins, roads | ✅ | `js/art/environment.js` |
| 7.8 | The UI art catalogue — banner, save-thumb, button glyphs, seal, tally, title banner | ✅ | `js/art/ui.js` |
| 7.9 | SFX kit — 16 battle events (sword clash, arrows, stone launch/impact, cavalry charge, drums, retreat horn, etc.) on top of the shared voice synth first built for the archived Outbreak | ✅ | `js/sound.js` |
| 7.10 | Music engine — procedural layered synth (pluck / bass / pad / drums) with `menu` / `battle` / `victory` / `defeat` / 8 `faction_sting_*` / `turn_change` tracks | ✅ | `js/music/music.js` |
| 7.11 | One real menu track — a 22.6 s guzheng piece (Karplus-Strong synthesis), generated offline, base64-embedded as `js/music/menu-track-data.js` | ✅ | `tools/build-menu-track.py` + `menu-track-data.js` |
| 7.12 | Brush-kai subset rebuilt from the official source face; `subset-font.py --check` covers all current i18n text | ✅ | `tools/subset-font.py`, `fonts/` |
| 7.13 | General almanac — exactly 200 bilingual records, four §4.1 stats, nine §4.2 skills, deterministic portraits, always-mounted 1.5× models, 38 hand-authored story silhouettes | ✅ | `js/campaign/data/{generals,skills}.js`, `tools/check-generals.js` |

The music wires into `ZS.App.go(state)` — each view declares its own
soundtrack (`menu: 'menu'`, `battle: 'battle'`) and the shell handles
the rest. Settings.music flows into `music.setVolume` automatically.

### P7 completion notes

- The unchanged P1 reference battle resolves inside its 60–180 second window.
- The 240-season deterministic AI sweep reaches a mandate winner without an
  early map collapse, replays byte-for-byte, exercises Tales and preserves all
  campaign/army/officer invariants. A human focusing rival seats can finish
  sooner; the long horizon is an AI-vs-AI safety and convergence guard.
- The bundled font now covers 1,233 harvested glyphs (348 KB WOFF2) after the
  complete campaign/event/battle vocabulary was added.

---

## P0 task board

| # | Task | Status | Files |
|---|---|---|---|
| 0.1 | `ZS.Store` contract + `MemoryStore` | ✅ | `js/store/store.js` |
| 0.2 | `ZS.LocalStore` | ✅ | `js/store/local.js` |
| 0.3 | `ZS.RemoteStore` (written, unexercised until P6) | ✅ | `js/store/remote.js` |
| 0.4 | `ZS.Auth` seam + `AnonAuth` deviceId | ✅ | `js/auth/auth.js` |
| 0.5 | `ZS.SaveManager` schema/migrate/capture/apply/autosave | ✅ | `js/save/save-manager.js` |
| 0.6 | `ZS.i18n` t/n/nc/set/fallback/date | ✅ | `js/i18n/i18n.js` |
| 0.7 | zh-tw + en string tables | ✅ | `js/i18n/zh-tw.js`, `js/i18n/en.js` |
| 0.8 | `ZS.App` state machine + MENU view | ✅ | `js/app.js` |
| 0.9 | DOM menu overlay (locale toggle, slots, about) | ✅ | `js/ui/menu.js` |
| 0.10 | `index.html` page + `@font-face` + palette CSS | ✅ | `index.html` |
| 0.11 | Boiling canvas type (`ZS.boilText`) | ✅ | `js/text.js` |
| 0.12 | Font loader (data-URI path for file://) | ✅ | `js/fonts/font.js` |
| 0.13 | Font subset tooling + `--check` coverage mode | ✅ | `tools/subset-font.py` |
| 0.14 | Font subset asset + OFL text (285 KB woff2, 1,018 glyphs as of P3) | ✅ | `fonts/`, `js/fonts/subset-data.js` |
| 0.15 | Playwright P0 verification | ✅ | `test/sanguo-p0.js` |
| 0.16 | oxfmt + oxlint clean | ✅ | — |

### What P0 actually proves (the verify script's assertions)

- boots into `MENU`, canvas sized, main panel on screen
- `LocalStore` is the bound backend, over **http and file://** alike
- zh-tw is the default; `<html lang>` tracks it; the title resolves through `t()`
- a `deviceId` is minted, persisted at `hsg:v1:device`, and **stable across reload**
- locale toggle refills the DOM both directions; locale persists standalone
- number formats: en `80,000` / `80K`, zh-tw `8萬`; unknown keys render visibly
- bilingual content objects (`{ "zh-tw": "關羽", en: "Guan Yu" }`) resolve by locale
- save → reload → load restores settings and locale
- the shadow→main→bak dance leaves no `:shadow` and does leave a `:bak`
- a **torn main key recovers from `:bak`**
- a **future-version save is refused whole** (`future_version`), a missing slot is `not_found`
- `MemoryStore` honours the same contract; `deleteSlot` clears all three rungs
- LXGW WenKai TC actually renders — over http **and** on `file://`, where the
  data-URI path is the only one that can work
- every glyph the i18n tables can produce is inside the built subset
- no unexpected console errors

---

## P1 task board

| # | Task | Status | Files |
|---|---|---|---|
| 1.1 | `ZS.Engine.start/stop` — the engine bootstrap made callable | ✅ | `js/main.js` |
| 1.2 | Fixed sim step + `speed` (0 / 1x / 2x / 4x) + headless `step(dt)` | ✅ | `js/main.js` |
| 1.3 | `ZS.FlowField` — Dijkstra group movement | ✅ | `js/battle/flowfield.js` |
| 1.4 | `ZS.Formation` — five slot generators + greedy re-solve | ✅ | `js/battle/formation.js` |
| 1.5 | `ZS.figure` — the §7 stickman baseline made executable | ✅ | `js/figure/figure.js` |
| 1.6 | `ScenarioSanguo` — orders, combat, morale, rout, deployment | ✅ | `js/scenarios/sanguo.js` |
| 1.7 | `ZS.Command` — selection, control groups, orders, overlay | ✅ | `js/battle/command.js` |
| 1.8 | BATTLE view + skirmish entry + battle bar | ✅ | `js/app.js`, `js/ui/menu.js` |
| 1.9 | Battle i18n keys (both tables) + font subset rebuild | ✅ | `js/i18n/*`, `fonts/` |
| 1.10 | Playwright P1 verification (63 assertions) | ✅ | `test/sanguo-p1.js` |
| 1.11 | Regression suite for the three archived reference pages | ✅ | `reference/test/pages-regression.js` |
| 1.12 | Bug sweep: 12 fixed, each one now an assertion | ✅ | see below |
| 1.13 | Seed sweep — no battle may hang | ✅ | `test/sanguo-seed-sweep.js` |
| 1.14 | Pooled ranged projectiles + four impact paths; logical three-line deployment; special corps; faction armour; selected-unit status box | ✅ | `js/scenarios/sanguo.js`, `js/figure/figure.js`, `js/ui/menu.js` |

### What P1 proves

- the shell hands the frame loop to the engine and takes it back; **never two
  loops**, and leaving a battle removes every listener the engine added
- 2,000 men deploy as two 1,000-strong armies, 1 figure = 1 man
- click-select, box-select, control groups, select-all, halt, formation cycle
- right-click attack-moves, right-click on an enemy charges, ctrl+right marches,
  shift queues — and every order lands in the replay log
- **active pause**: orders still work while the sim is frozen (Q5)
- a battle runs about 96 s to a decision, both sides bleed, the loser breaks
  rather than dying to the last man, and the ledger balances
- **determinism**: same seed + same orders gives the same duration, the same
  winner, the same casualties, and the same men in the same places (a position
  digest over every agent) — while a different seed fights a different battle
- **no battle hangs**: eight seeds fought out against a completely passive
  player all reach a decision, in 20-200 s
- the side ledger never goes negative and always sums to what was deployed
- an advance is not halted by a man running away; hotkeys stay out of form
  fields; order markers fade on elapsed time; `go()` to an unbuilt phase leaves
  a running battle untouched; an unreachable goal is refused and leaves the
  current order intact
- the three archived reference pages remain compatible with the shared core

---

## P2 task board

| # | Task | Status | Files |
|---|---|---|---|
| 2.1 | Unit morale pool: casualties, odds, flank/rear pressure and fatigue | ✅ | `js/battle/morale.js` |
| 2.2 | `steady → wavering → routing → rally`; rally only inside a living general's aura | ✅ | `js/battle/morale.js`, `js/scenarios/sanguo.js` |
| 2.3 | General figures from `BattleSetup.generals`: tier 將, name banner, derived aura/cohesion, command-loss shock | ✅ | `js/scenarios/sanguo.js`, `js/figure/figure.js` |
| 2.4 | First active ability: deterministic, cooldown-gated inspire / 將令 morale heal | ✅ | `js/battle/ability.js`, `js/battle/command.js` |
| 2.5 | Morale bar + inspire ring/tick feedback | ✅ | `js/battle/command.js`, `js/scenarios/sanguo.js` |
| 2.6 | Charge shake, general-kill hitstop and hit-vector bursts | ✅ | `js/battle/feel.js`, `js/camera.js`, `js/main.js`, `js/scenarios/sanguo.js` |
| 2.7 | Influence-map enemy commander | ✅ | `js/battle/commander-ai.js` |
| 2.8 | Render LOD + headed `FIELD_CAP` fps probe | ✅ | `js/figure/figure.js`, `js/scenarios/sanguo.js` |
| 2.9 | Tune column / square / skirmish formations | ✅ | `js/battle/formation.js`, `js/scenarios/sanguo.js` |

### What the P2 slice proves so far

- the default 2,000-man skirmish fields exactly 2,000 figures; one figure on
  each side is promoted to the general supplied by `BattleSetup`, not added as
  a free extra body
- morale is updated per unit four times per second rather than by a hot-loop
  neighbour scan on every agent; no per-frame records or arrays are allocated
- casualty rate, local odds, rear pressure and average fatigue lower the pool;
  a living general raises its ceiling/recovery and formation cohesion
- a general death or rout shocks every still-fighting friendly unit exactly
  once; routed blocks can recover only while on-field fugitives remain inside
  another living general's aura
- `G` invokes inspire through `js/battle/ability.js`; it scales from `zhi`,
  respects a 24 s cooldown, writes to the deterministic order log, and gives a
  short sketch-ring/tick response that returns to rest
- charge contact emits one directional sketch burst per order and adds
  render-only camera trauma; a general kill adds a stronger burst and a 90 ms
  real-time hitstop without advancing simulation time or consuming the battle
  PRNG. Pointer-to-world mapping remains exact while the camera is displaced
- the enemy commander's best `zhi` sets its decision cadence; three reused
  18×14 typed influence maps feed a shallow probe / hold / press / reserve /
  retreat tree, while all movement still goes through the existing flow field
- a six-seed passive-player probe resolves every battle in 62–119 s; seed 47
  replayed with the same duration, winner and agent-position digest. Forced
  branch probes cover hold, reserve commitment and retreat
- close zoom still uses the exact full stickman; mid zoom keeps
  head/torso/weapon silhouettes, and only large fit-view fields collapse formed
  ranks into reused `wpoly` washes. Routed troops stay as sparse individuals
- at 4,000 figures in headed Chrome, fit-view render submission fell from
  **12.4 ms to 0.8 ms** while close zoom stayed effectively flat
  (**7.2 → 7.0 ms**). The real rAF probe held **60.0 fps**, p95 16.8 ms and max
  17.7 ms, so `FIELD_CAP = 2000` per side is confirmed
- column width now scales with block size; square uses balanced concentric
  perimeter ranks whose soldiers face outward; skirmish uses bounded staggered
  ranks instead of inheriting another formation's depth option. All five shapes
  reassign immediately while paused, settle while marching, and regenerate
  an exact smaller footprint when casualties leave holes
- a 16-seed aggressive-order diagnostic resolves every battle without a
  stalemate in 40.8–129.6 s. It also records 20 `STALL_GIVEUP` watchdog drops in
  15 battles, which is why issue 3 remains open rather than hiding congestion
  behind a different timeout
- `reference/zombiesim.html`, `reference/battle.html`, and
  `reference/hold.html` still boot their own scenario with their expected
  populations, zero shake offsets, and no page errors

---

## P3 task board

| # | Task | Status | Files |
|---|---|---|---|
| 3.1 | Province data — 57 Han commanderies under the 13 州, bilingual, with size / wall / biome and the marching routes between them | ✅ | `js/campaign/data/provinces.js` |
| 3.2 | Faction data — 22 warlords of 194 CE: banner, tint, capital, opening holdings, purse, temper, and the officers who serve them | ✅ | `js/campaign/data/factions.js` |
| 3.3 | `ZS.CampaignMap` — graph, march cost in seasons, Dijkstra path, Voronoi province territory, pre-rendered paper sheet | ✅ | `js/campaign/map.js` |
| 3.4 | `ZS.Army` — stacks, four-arm composition, marching, fatigue, upkeep, losses | ✅ | `js/campaign/army.js` |
| 3.5 | `ZS.Campaign` — live state, derived economy, and the SaveManager `campaign` section | ✅ | `js/campaign/campaign.js` |
| 3.6 | `ZS.Turn` — the four phases and the player order set (recruit / raise / develop / march / halt / disband / assign) | ✅ | `js/campaign/turn.js` |
| 3.7 | `ZS.CampaignAI` — greedy planner, deterministic per (seed, turn, faction), `temper` as its one dial | ✅ | `js/campaign/ai.js` |
| 3.8 | `ZS.AutoResolve` — provisional closed-form field battle and assault, already in the §4.3 `BattleResult` shape | ✅ | `js/campaign/autoresolve.js` |
| 3.9 | `ZS.Roster` — the general seam; reads the 200-person almanac, degrades to a neutral stand-in without it | ✅ | `js/campaign/roster.js` |
| 3.10 | The CAMPAIGN view — sheet, ownership wash, banners, army tokens, routes, selection, pan / zoom / click / right-click | ✅ | `js/campaign/view.js` |
| 3.11 | The campaign overlay — bar, contextual province / army panel, season report, faction picker | ✅ | `js/ui/campaign.js` |
| 3.12 | Campaign i18n keys in both tables + font subset rebuild | ✅ | `js/i18n/*`, `fonts/` |
| 3.13 | Playwright P3 verification (131 assertions) | ✅ | `test/sanguo-p3.js` |
| 3.14 | Occupation, battle fatigue and a massing AI — the conquest-chaining fix behind issue 10 | ✅ | `js/campaign/{campaign,turn,ai,army}.js` |
| 3.15 | Campaign pacing probe | ✅ | `test/campaign-sweep.js` |

### What P3 proves

- the map is a real graph: 57 commanderies, no duplicates, **every one reachable
  from every other**, adjacency symmetric both ways, and a road from 遼東 to
  交趾 that costs a campaign's worth of seasons to walk
- province territory is Voronoi over the seats, so it is contiguous, every
  point of the empire belongs to exactly one commandery, and "what did I click"
  is "which seat is nearest" rather than a point-in-polygon test
- 194 opens with every commandery held, every warlord holding their own
  capital, every banner resolving to a real flag preset, and every faction with
  something in the field rather than only walls
- the 200-general almanac is wired in: leaders and rosters are all real ids,
  **no general serves two warlords**, stats come from the almanac rather than
  the stand-in, a `BattleSetup` snapshot resolves the name and puts a mounted
  hero in the cavalry, and a warlord the almanac has no entry for starts alone
  rather than broken
- the opening position staffs each army to the three-general cap and seats a
  governor at home wherever there are officers to spare; **nobody is in two
  places at once**, and Assign moves them between roster, stack and seat
- every order refuses what it should: someone else's province, someone else's
  stack, someone else's officer, over the recruit cap, past the garrison floor,
  a route that does not exist, a development already at its limit — and a
  refused march leaves the current one running
- **ten seasons pass with no invariant broken**: no negative treasury, garrison
  or stack, no loyalty outside 0-100, no army standing anywhere but a real
  province, and no army stepping to a province it is not adjacent to
- the AI marches, fights and takes ground, on the same order set the player has
- **determinism**: the same seed plays out to the same digest over every
  province, army and treasury eight seasons in; a different seed does not
- the World-phase autosave writes, the slot labels itself with the turn, year
  and warlord, and a reload restores the campaign exactly — treasury, armies,
  a marked garrison and its walls — and **keeps taking turns afterwards**
- the faction picker builds a campaign from the menu, and leaving the view
  releases every listener and drops its reference to the campaign
- P1's skirmish still deploys its 2,000 men and still tears down cleanly
- **taking a province is not the same as holding it**: the beaten garrison is
  dispersed rather than inherited, the stack that took the ground leaves men
  standing on it, and a stack too small to garrison leaves everything it has
  and is spent. No stack chains more than a handful of conquests

---

## Core changes made for P1

`AGENTS.md` allows core changes that stay scenario-agnostic. Three were needed;
all are opt-in and no-ops for `reference/zombiesim.html`,
`reference/battle.html`, and `reference/hold.html`; the guard now lives at
`reference/test/pages-regression.js`.

| File | Change | Why |
|---|---|---|
| `js/main.js` | body wrapped in `ZS.Engine.start(opts)`, auto-starting unless the page sets `ZS_MANUAL_BOOT`. Adds `stop()`, `step(dt)`, `speed`, `fixedStep`. | The shell has a MENU before it has a battle, and rebuilds the battle every time one is fought. |
| `js/draw.js` | `hand()` returns `ZS.scenario.hudFont` when a pack sets one; new `scenario.drawWorld(c, t)` hook after `drawFX`. | The HUD is Chinese and needs the kai stack; the command overlay has to draw even on a frame with no effects pending. |
| `js/agents.js` | the exact-overlap separation nudge is `ZS.hash(a.id, b.id)` instead of `Math.random()`. | It was the last thing keeping a fixed-seed battle from replaying identically. Just as arbitrary, now reproducible. |

P2 adds two more opt-in core hooks. `Camera` carries render offsets and removes
them again in `toWorld()`, so feedback never changes simulation coordinates or
pointer accuracy. The fixed-step rAF loop asks an optional
`scenario.frameFeedback(dt, t)` for those offsets and a real-time hold; packs
without the hook keep `[0, 0]` and run exactly as before. Headless
`engine.step(dt)` deliberately ignores feedback time, preserving fast,
deterministic probes.

---

## Decisions made during build

Implementation-level choices the design doc did not pin down. (Design decisions
live in `SANGUO-DESIGN.md` §11.)

1. **`SCHEMA_VERSION = 1`.** §5.3's snapshot example shows `version: 3`
   illustratively; the first shipped schema is 1. The `migrateUp` chain is in
   place and empty, per §5.4's "exists from v1".
2. **The shadow+bak dance lives in `SaveManager`, not `LocalStore`.** The Store
   contract stays "dumb key/blob persistence" (§5.2). `SaveManager` branches on
   `store.capabilities.atomic`: false (localStorage) → shadow→main→bak; true
   (a server `PUT`) → a single write. `_read` falls back to `:bak` when the main
   key is missing or unparseable.
3. **Snapshots are assembled from registered sections.** `SaveManager.register
   (name, {capture, apply})` instead of a hard-coded field list, so P3 adds the
   campaign and P5 the roster without editing `save-manager.js`. P0 registers
   `settings` only.
4. **Settings persist standalone as well** (`hsg:v1:settings`), alongside the
   designed `hsg:v1:locale` key. The menu has to remember volume and language
   before any campaign exists; the save snapshot stays authoritative once a game
   is loaded.
5. **The font ships two ways** (§6.3 assumed one). A `@font-face` whose `src` is
   a `file://` URL is a CORS-mode fetch from an opaque origin and browsers
   refuse it — which would silently kill the brush-kai on a double-clicked page,
   the exact case `AGENTS.md` constraint 1 protects. So `tools/subset-font.py`
   emits **both** `fonts/lxgw-wenkai-tc.subset.woff2` (used when served over
   http, via the `@font-face` rule) **and** `js/fonts/subset-data.js`, the same
   bytes as a `data:` URI loaded through the `FontFace` API. `ZS.Fonts.via`
   reports which path won (`"data" | "css" | "fallback"`).
6. **`js/text.js` is a new file** not in the §9 file plan. §6.3 requires canvas
   type drawn per-glyph with a jit offset/rotation; that is a drawing primitive,
   not stickman art, so it did not belong in `js/figure/figure.js`. It is
   additive — only `index.html` loads it, `js/sketch.js` is untouched.
7. **`ZS.App` runs its own rAF loop in P0.** `main.js` builds a world and a
   scenario at load, which the menu has no use for. P1 wires the engine loop for
   the BATTLE view; `App.stop()` exists so the two never run at once (§2).
8. **`ZS.i18n.nc()`** is the compact number form (`8萬` / `80K`); `n()` stays
   exact and grouped. §6.4 asked for locale-configured grouping without naming
   the split.
9. **`open` was intentionally a bare plain in P1; P4 replaced it with the
   complete river/hills/forest terrain system from §4.3.**
   `world.water()` only runs its pinned, scenario-placed path when *both*
   `riverBaseX` and `lake` are passed; with one of them missing it falls
   through to the generative branch, which laid a river diagonally across the
   middle of the battlefield. The two armies then deployed on opposite banks,
   and remnants that drifted into the water were pinned there by the core's
   walkability clamp — a battle that could never end. Terrain comes back at P4
   with `town` and `fort`, when the flow field routes around it and the
   deployment respects it. `_findField` (ported from `cannae.js`) already
   searches for dry ground, so the seam is in place.
10. **The battle ends on the rout, not on annihilation.** Cannae runs until one
    side is literally dead or off the field; a side here is beaten when nobody
    on it is still fighting (`sides[s].alive <= 0`). The same story told at
    skirmish length — about 96 s, inside the design's 60-180 s window (§1).
11. **`ScenarioSanguo` reads a `BattleSetup` from the start** (§4.3), even
    though P1 has no campaign to build one. `defaultSetup()` produces the
    skirmish, so P4's handoff has nothing left to invent.
12. **The fixed sim step landed in P1, not P2.** §8 files it under P2's
    performance work, but P1's own verify row asks for a "deterministic-seed
    replay test", which is not possible on a variable frame delta. It is
    `ZS.Engine`'s `fixedStep` option, off by default, and it also buys the
    active pause and 2x/4x for free.
13. **"Is the real face loaded?" is answered with pixels, not widths.** The usual
   trick — measure the string in the family, measure it in a generic, compare —
   cannot work for CJK: every glyph is exactly 1em wide in LXGW WenKai TC *and*
   in every system fallback, so both measure identically. `document.fonts.check`
   is also unreliable while the CSS `@font-face` sits unloaded beside the
   JS-added face. `ZS.Fonts.check()` rasterizes 火柴三國 twice and diffs the
   alpha channel instead.
14. **Battle feedback owns a separate deterministic sequence.** Charge and
    general-kill bursts derive their seeds from event geometry plus a local
    counter; they never call the scenario RNG. Turning a particle on or off
    therefore cannot change the next combat roll.
15. **The commander opens with two short probes before committing.** A fully
    coordinated six-block advance made contact too efficiently and collapsed
    sampled battles in 32–40 s. The staged probe remains active on screen,
    gives the player a first-command beat, and keeps passive-player battles in
    the designed 60–180 s window. A crisis can still promote a reserve before
    the opening completes.
16. **Far mass LOD is population-aware.** At the normal 2,000-man skirmish, fit
    view keeps individual mid-detail silhouettes; rank masses activate at fit
    zoom only on fields above 1,200 figures. Close zoom always uses the frozen
    full figure. This preserves the product look where the renderer has budget
    and spends the abstraction only where the 4,000-figure cap needs it.

17. **Administration is immediate; only movement takes seasons.** §4.1 pins the
    four phases but not which orders resolve when. Recruit, Raise, Develop and
    Assign are local acts and land the moment they are given, so the player
    phase answers while you are still thinking; March is the only order that
    resolves over turns, because distance is the whole point of it.
18. **Who serves whom is campaign data, not almanac data.** The general
    almanac's own `faction` field is a *culture* — `shu` / `wei` / `wu` /
    `other` — which is what a portrait and a sash key off, and is a different
    question from who 陶謙 has on his staff in 194. The answer lives in
    `ZS.data.factions[].roster` and is read through `ZS.Roster.forFaction()`.
19. **`js/campaign/roster.js` is a new file not in the §9 file plan.** The
    general model (`general.js`) and the almanac are P5's RPG work and were
    built on a separate branch. P3 still had to *refer* to generals, so it
    refers to them through one seam that reads whatever is loaded — the
    almanac, a P5 `ZS.General` derived read, or a flat neutral stand-in. That
    is what let both branches land without either editing the other's files.
20. **Province territory is Voronoi, not hand-drawn blobs.** Cells are the map
    rectangle clipped by the perpendicular bisector against every other seat,
    built once. It buys three things a hand-drawn blob would not: territory is
    contiguous, every point belongs to exactly one commandery, and hit-testing
    is "nearest seat" instead of point-in-polygon.
21. **The campaign map is drawn in two halves.** The static sheet — paper,
    rivers, hills, borders, routes — is pre-rendered into an offscreen canvas
    with the boil frozen, the way `js/app.js` pre-renders its paper wash,
    because a map is a drawn object rather than a live scene. Ownership,
    banners, tokens and selection draw per frame and keep their shimmer.
22. **`ZS.CampaignMap.build()` runs at load, not on first use.** Every lookup
    answers `null` until it has run, and the faction picker reached the map
    before anything had built it — a null province, and a picker that silently
    rendered nothing. Building at load is a few milliseconds and removes the
    whole class.
23. **P3's auto-resolve is provisional but its shape is not.** The arithmetic
    in `js/campaign/autoresolve.js` is untuned; the record it returns is the
    §4.3 `BattleResult`, the same one a played-out battle will return. P4 tunes
    numbers rather than inventing a contract.
24. **Conquest costs men to hold, not just to win.** P3's first pass changed
    the owner and left the garrison alone, so a beaten defence flipped sides
    intact and one stack swept fifteen commanderies in forty seasons.
    `Campaign.occupy()` disperses the defenders and detaches
    `OCCUPY_PER_SIZE × size` men from the taking stack. It is the single lever
    that turns a churn into a front line, and it is worth more than any of the
    auto-resolve constants.
25. **Balance was measured, not read.** `test/campaign-sweep.js` asserts
    nothing; it runs twenty passive campaigns and prints what the board did.
    Every change to the campaign's pacing went in against those numbers, and
    two of the four attempts made things worse in a way that reading the code
    would not have shown — massing let the AI drain back the garrison it had
    just left, which reintroduced chaining at *worse* than the baseline. Same
    method as the battle stall family.

---

## Gotchas for the next session

- **Do not run `oxfmt js/`.** It rewrites all 17 pre-existing core files to LF
  line endings (content unchanged, but 17 files show as modified). Format the
  sanguo files only:

  ```bash
  node node_modules/oxfmt/bin/oxfmt js/app.js js/text.js js/store js/auth js/save js/i18n js/ui js/fonts js/figure js/battle js/campaign js/scenarios/sanguo.js
  ```

  `node node_modules/oxlint/bin/oxlint js/` over everything is safe.
- **Backslashes get mangled in Bash heredocs here.** Write JS/regex files with
  the Write tool, not `cat <<'EOF'`.
- Chromium keeps `localStorage` working on `file://`, so a double-clicked page
  gets real `LocalStore`, not the memory fallback (the verify script asserts
  both paths).
- **Class bodies take no trailing commas.** `ZS.Campaign` is a `class`, unlike
  most of this codebase's object-literal modules; a method pasted in with the
  object-literal `},` is a syntax error that takes the whole file — and
  therefore the campaign — off the page with nothing but an `undefined` to show
  for it. **Run `npm run lint` before `npm test`**: oxlint reports it with the
  file and line and exits 1, where the suite reports it as
  `Cannot read properties of undefined` several files away. This cost two
  debugging detours in one session; it is issue 14.

## Open / blocked

Tracked in [`ISSUES.md`](ISSUES.md). Nothing blocks the completed v1 slice.
Issues 1–12 and 14 are resolved; issue 13 (fog of war) remains a v2 nit. The
GitHub verification workflow now runs the complete suite, including the font
subset check and archived reference guards, on pushes and pull requests.
- **Rebuild the font subset whenever any file `index.html` loads gains new
  text** — new glyphs silently fall back otherwise. `test/sanguo-p0.js` runs
  the coverage check for you; standalone it is
  `python tools/subset-font.py --check`, and `--sources` prints the 67 files it
  reads. Rebuilding is one line and needs no download — the source face is
  committed at `assets/fonts/LXGWWenKaiTC-Regular.ttf`:
  `python tools/subset-font.py --source assets/fonts/LXGWWenKaiTC-Regular.ttf`.
  See `FONTS.md`, which used to say the opposite.
- **Whether a 15 MB `.ttf` belongs in the history** is an open call. It packs
  to 8.8 MB of a 15.0 MiB pack.

---

## Bugs worth remembering

### The stall family

Six separate faults, every one of which presented as "the battle stalls and
never ends". They were found by sweeping seeds with a passive player and
watching where blocks ended up, not by reading code — the endpoints all looked
the same and the causes were all different. `test/sanguo-seed-sweep.js` is
that sweep, kept; the P1 suite runs a shorter version every time.

The tell that broke it open was instrumenting a stuck block: **unit drive 43
px/s, average member speed 4 px/s**. The unit was being commanded correctly and
the men were not going. Once that was measured the rest fell out quickly.

5. **Men braked to a halt to fight people who were running away.** The melee
   branch sheds momentum on purpose — that is how a line braces — but it fired
   for any enemy in reach, routers included. A block standing in a rout froze
   mid-march. Its mirror image: a *stationary* block's men chased routers
   individually (drive 0, member speed 55) and tore the formation across the
   map. Now a man in reach is struck either way, and only a *fighting* enemy is
   worth stopping for; pursuit is a unit decision, not each man's.
6. **Slot targets could fall outside the map.** A block pushed into a corner put
   half its slots off-world; those men could never reach them, kept pulling
   outward, and because the slot pull (58) beats the march drive (40) the whole
   block deadlocked against the edge. Slots are clamped inside the field now.
7. **`_setGoal` moved the goal before deciding it was reachable**, so a refused
   goal still overwrote `tx`/`ty` and left a HOLD block carrying a destination
   it would never march to.
8. **A `FlowField.build()` that failed left the previous field in place.**
   `built` stayed set, the old costs stayed in the arrays, and `distAt`
   cheerfully answered for a goal the field knew nothing about — so an
   impossible order was accepted as reachable. A failed build invalidates the
   field, `distAt` returns Infinity when it is not built, and `_setGoal` honours
   what `build()` returned.
9. **A battle neither side could finish had no ending.** Two spent remnants that
   cannot reach or break each other are a real outcome, not a bug — but running
   for ever is. A field where nobody has fallen for 45 s is now called: the
   stronger remnant holds it, or it is a draw. `BattleResult.winner` already
   admitted `"draw"` (§4.3).
10. **No watchdog.** Any *future* "unit wedged somewhere we did not predict" bug
    would again become an unkillable battle, so an order that has made no
    progress for 12 s is dropped and re-planned. This is the backstop, not the
    fix.

### The ledger

11. **The dead kept taking their AI turn.** The core's AI pass walks the whole
    array without skipping the dead, and compaction only runs at end of frame —
    so a man killed earlier in the same pass could still rout, decrementing
    `alive` for someone already counted in `dead`. Side counts drifted negative
    (`standing -3`). `update()` returns early for the dead now, and both
    `_kill` and `_setRout` are idempotent.

### The rest

12. **Battle hotkeys fired while typing in a form field** — pressing "A" in the
    settings panel selected the whole army.
13. **Order markers decayed by an assumed 1/60 per draw**, so they lasted twice
    as long at 30 fps and half as long at 120.
14. **`App.go()` to a phase with no view tore the current one down first**, then
    re-entered it on failure. From the menu that was invisible; from a battle it
    would have thrown the fight away and deployed a new one.
15. **`FlowField.isFor()` compared against the *resolved* goal**, so any order
    whose target had to be relocated onto open ground rebuilt an identical
    field on every issue.
16. **A save that ran out of quota part-way could leave a `:shadow` key behind**,
    which the next read would have to step over.
17. **`RemoteStore` slept out a backoff after its final attempt** before giving
    up.
18. **Halting left an order in the queue that could never complete** — the
    arrival test skips HOLD — so a halted block read as "busy" to anything
    asking whether it had orders.
19. **Nothing told the player how to move the camera.** Left-drag is box-select
    and right-drag is an order, so both are claimed; middle-drag and the wheel
    were the only ways to pan and neither was mentioned. The hint says so now.

### The original four, from the P1 build

Every one of these also presented as "the battle stalls":

1. **The flow field's heap was keyed by reading `cost[cell]` at compare time.**
   This is decrease-key-by-reinsertion, so improving a cell's cost silently
   re-keyed entries already sitting in the heap; the ordering broke and whole
   regions of the map stopped expanding. The key is now copied in at push time.
2. **The same heap was sized `n + 1`.** A cell is pushed once per improving
   edge, so the bound is edges, not cells — and a typed array drops
   out-of-range writes without a word. It grows on demand now.
3. **`Formation.slots()` did not centre its output.** The wedge grows backwards
   from its point, so every man sought a slot offset behind the unit centroid,
   the centroid followed them back, and the block crawled off the map under its
   own formation. Centring happens inside `slots()` now, so a new generator
   cannot reintroduce it.
4. **Retargeting did not rebuild the flow field.** The hunt and the AI wrote
   `u.tx` / `u.ty` directly, which left the block steering down the *previous*
   goal's field. Every goal change goes through `_setGoal()` now, which
   rebuilds and records whether the goal is reachable at all.

### Found while building P3

Neither was a P3 bug. Both were already shipping, and both were invisible
because the thing that should have complained was looking somewhere else.

20. **`ZS.flag.forFaction(5)` and `(6)` returned `undefined`.** They looked up
    `PRESETS.liu_biao` and `PRESETS.liu_zhang`, which only ever existed in
    `NAMED` — the colour table — and never in `PRESETS`. The function is
    documented as what the campaign-pick panel uses, so P3 was the first thing
    to call it. `plant()` returns early on a falsy flag, which is exactly why
    it had never thrown.
21. **120 Han glyphs the game already drew were outside the shipped subset.**
    `tools/subset-font.py` harvested text from `js/i18n/*`,
    `js/campaign/data/*` and `index.html`. But `js/art/flag.js` draws a house
    glyph on every banner and `js/figure/portrait.js` carries general names —
    85 and 66 characters respectively, none of them in the harvest. They fell
    back to system kai on every page, and `--check` reported the subset
    complete because it was asking the same narrow question. This is
    `ISSUES.md` #2's exact failure mode, already happening. The globs now cover
    every file that can draw text, which took the subset from 558 to 1,018
    glyphs.

### Found while wiring P3 to the almanac

22. **The faction picker rendered nothing, silently.** `showPick()` reads
    `ZS.CampaignMap.province(fd.capital).name` to label each card, and nothing
    had built the map yet — every other path into the campaign goes through
    `ZS.Campaign.create()`, whose constructor builds it as a side effect. The
    picker threw on a null province inside a click handler, so the panel was
    created, emptied, and left empty with no error anywhere the suite was
    looking. The map builds at load now, and the suite walks the picker.


### Found while closing the tooling issues

Three of these were the same shape: a gate that could only see part of what it
was gating, and could not tell you so.

23. **Four glyphs the game loads were outside the subset — again.** The same
    failure as #21, one layer out. `TEXT_GLOBS` was widened after #21 and was
    *still* a hand-kept list, so `js/sound.js` and `js/fonts/font.js` (Han in
    comments, but harvested files are read whole) were never looked at. The
    harvest is now derived from `index.html` and its `<script src>` tags, so
    there is no list left to go stale; `--sources` prints what it reads. 1,018
    → 1,022 glyphs, and the new harvest is a verified strict superset of the
    old. `ISSUES.md` #2 called this half unfixable by enforcement, which was
    true of enforcement and not of deleting the list.
24. **The generated `subset-data.js` was dirty the moment it was written.** It
    emitted `ZS.FONT_DATA_URL` on one line, which oxfmt wraps, and it lives
    under `js/` — so every rebuild left `npm run format` with something to do.
    Python's `write_text` also gave it CRLF against an LF-pinned tree. Both are
    now pinned in the generator, and oxfmt is a verified no-op on its output.
25. **`oxfmt js/` was never really the problem in `ISSUES.md` #8.** Everything
    in the index was already LF; `core.autocrlf=true` was checking the working
    copy out as CRLF, so the first tool to write a file converted it and git
    reported the whole file changed. The workaround had been to list format
    paths by hand. `.gitattributes` pinning `* text=auto eol=lf` settles it —
    `git add --renormalize .` was a no-op, which is the proof it was a
    checkout-side problem all along.

### The `<script>` trap, closed

26. **A script that failed to parse was a silent no-op** (`ISSUES.md` #14).
    The browser logs a `SyntaxError`, skips that file, and carries on: the page
    still boots and the module is simply missing from `ZS`, so the failure
    lands as a `TypeError` several files away. It cost two debugging sessions
    in one day, both times a `},` pasted into `class Campaign`. Two guards, and
    both failure modes were injected deliberately to confirm they fire:
    `oxlint` at the front of `npm test` (names the file and line in
    milliseconds), and `tools/module-manifest.js`, which reads what each page
    promises and asserts the booted page delivered it. The manifest also
    catches what no lint can — a module with no `<script>` tag on any page.

## Session log

- **2026-08-30** — read `SANGUO-DESIGN.md`; created this file; built P0:
  store/auth/save seams, i18n with both tables, the app shell and menu view,
  `index.html`, boiling canvas type, the font loader and subset tool, and the
  Playwright P0 check (42 pass / 0 fail / 1 warn). oxfmt + oxlint clean.
  Screenshots in `.verify/sanguo-menu-{zh,en}.png`, `.verify/sanguo-settings.png`.
  Then downloaded LXGW WenKai TC v1.522, built the 52 KB / 255-glyph subset
  (both the `.woff2` and the `data:` URI), added `--check` coverage mode and the
  OFL text, and fixed the font detector — the original width probe could never
  work, because every CJK glyph is exactly 1em wide in the real face *and* in
  every system fallback, so it now compares rasterized pixels. Final: 45 pass /
  0 fail / 0 warn. Committed to `main`.
- **2026-08-30 (cont.)** — built P1: the engine bootstrap seam, flow-field group
  movement, formations as data, the §7 stickman baseline, `ScenarioSanguo`, the
  command layer, the BATTLE view, and the fixed sim step that makes a battle
  replayable. Four movement bugs found and fixed (see above). 51 / 0 on P1,
  45 / 0 / 0 on P0, 23 / 0 on the pages regression. Screenshots in
  `.verify/sanguo-battle-*.png`.
- **2026-08-30 (cont.)** — bug sweep. 15 more fixed (see above), the worst of
  them a family of six that all showed up as a battle that would not end: half
  the seeds tested hung for ever. All 16 seeds now resolve in 30-186 s. Each fix
  is an assertion in the P1 suite, which is up from 51 to 62.
- **2026-08-30 (cont.)** — page rename: the outbreak moved to `zombiesim.html`
  and 火柴三國 became `index.html`, the entry point. 45 references updated
  across docs, the font tool, the scenario headers, the verify suites and
  `.vscode/launch.json` (which now has a config per page). That page and
  `example/index.html` were later archived under `reference/`; this entry
  records the layout at the time. All suites re-run green.
- **2026-08-30 (cont.)** — started P2. Replaced per-agent local-press morale
  with `js/battle/morale.js`: a unit pool driven by losses, odds, rear pressure,
  fatigue and commander presence, with wavering, routing and general-gated
  rally. Promoted `BattleSetup.generals` into real tier-將 figures with derived
  aura/cohesion and command-loss shock. Added the first cooldown active in
  `js/battle/ability.js` (`G`: inspire / 將令), its deterministic order-log
  entry, morale bar and sketch-ring feedback. Six fixed seeds resolve in
  80–151 s; seed 47 replays identically; the three earlier pages boot clean.
- **2026-08-30 (cont.)** — continued P2. Added proportional charge/general-kill
  feedback (`js/battle/feel.js`), render-only camera trauma, and a 90 ms
  real-time hitstop that leaves fixed simulation time and replay RNG alone.
  Replaced the nearest-target placeholder with `js/battle/commander-ai.js`:
  reused influence-map buffers, `zhi`-scaled planning, staged probes and a
  shallow morale-aware priority tree. Six seeds now resolve in 62–119 s; seed
  47 repeats exactly; forced hold/commit/retreat checks and all three legacy
  page boots pass.
- **2026-08-30 (cont.)** — completed P2 render LOD. Kept the close figure
  unchanged, added the specified mid silhouette and far rank-mass paths with
  reused geometry, and retained sparse individual fugitives for routed blocks.
  On headed Chrome at 2,000/side, fit render cost dropped 12.4 → 0.8 ms and an
  actual 180-frame rAF sample held 60.0 fps (p95 16.8 ms, max 17.7 ms), so the
  provisional `FIELD_CAP = 2000` is accepted. Normal 2,000-man fit view remains
  individual, not massed.
- **2026-08-31 (cont.)** — built P3, the campaign skeleton. 57 Han
  commanderies and their marching routes, 22 warlords of 194 with banners and
  opening positions, Voronoi province territory on a pre-rendered paper sheet,
  army stacks that march and fight, the four-phase season, the player order set
  and a greedy AI planner, the campaign save section, the map view and its
  overlay. Two already-shipping bugs fell out on the way: `forFaction()`
  handing back `undefined` for two factions, and 120 Han glyphs that the flag
  and portrait modules draw sitting outside the font subset because the
  harvester never looked at those files. New suite `test/sanguo-p3.js`.
  Then merged the 200-general almanac from `origin/main` and wired it in
  through `js/campaign/roster.js`: leaders and per-faction rosters validated
  against it, armies staffed to the three-general cap, governors seated, and
  Assign moving officers between roster, stack and seat. The merge conflicted
  only on the two generated font artifacts, which were resolved by rebuilding
  the subset from the source face — 1,018 glyphs, covering both branches'
  text. Final: P3 121 / 0, P0 45 / 0, P1 62 / 0, pages 23 / 0,
  `check-generals` 200 valid. oxlint clean.
- **2026-08-31 (cont.)** — closed issue 1 and the structural half of issue 10.
  The reusable suites moved to a committed `test/` with an `npm test` that runs
  p0 → p1 → p3 → pages → the almanac gate; `.verify/` went back to scratch and
  screenshot output. Then built `test/campaign-sweep.js` and measured the
  campaign before touching it: **3.53 commanderies changing hands per season**
  and one stack taking **15** provinces without stopping. The causes were
  structural, not constants — the conqueror inherited the beaten garrison,
  fighting produced no fatigue, and the AI could not mass. Fixing the first two
  killed the churn but froze the war (0.40 flips/season, 110% of the men alive
  after 100 seasons); letting the AI mass unfroze it but let stacks drain back
  their own occupation force, which was worse than the baseline. Holding the
  garrison floor on a frontier province settled it: **1.58 flips/season,
  longest run 4, 106% of the men on the board, 22 → 12.8 factions over 30
  years**. P3 suite up to 131.
- **2026-08-31** — completed P2 formation tuning. Column is adaptively narrow,
  square is a hollow concentric perimeter with outward facings, and skirmish is
  a bounded staggered loose order. Formation changes assign immediately while
  paused and casualty re-solves regenerate the footprint at the surviving
  count. An isolated browser pass marched all five shapes at 6–11 px mean slot
  error and shrank a 150-man square to 98 exact slots after 35% losses. Seed 47
  replayed identically at 78.367 s; all three archived pages booted clean. Added
  `stallGiveups` instrumentation: an aggressive 16-seed diagnostic resolved in
  40.8–129.6 s but invoked the watchdog 20 times across 15 battles, keeping
  pacing issue 3 open.
- **2026-08-31 (cont.)** — redesigned the campaign interface. The map had been
  drawing everything it knew at once — a garrison under all 57 seats, a troop
  count over every token, planted capital banners, two hills and two trees per
  province — over an ownership wash whose 22 tints included six browns and six
  blue-greys, so the two questions a strategy map has to answer at a glance
  ("whose is that" and "which of these is mine") both needed a squint.

  Four changes, in the order they mattered. **The palette** was re-solved
  rather than nudged: five warlord colours are pinned by tradition (Cao blue,
  Sun red, Liu Bei green, Yuan gold, Han wine) and the other seventeen chosen
  greedily against *Voronoi* adjacency — cells that touch on the sheet, not
  roads — judged on distance as washed onto cream rather than raw, because a
  third-opacity wash flattens hue three times faster than the numbers suggest.
  Result: no pair closer than 39 in RGB, no *touching* pair closer than 79.
  **One flag per province** replaced the capital-only planted banner, drawn in
  the owner's tint on a short pole rooted in the seat, so colour and flag say
  the same thing instead of competing. **The noise came out** — garrison and
  troop counts moved to hover-only (token size now carries strength), terrain
  dropped to one motif per province set clear of the seat, roads went under the
  borders at a third the contrast, and names became a final pass so nothing is
  ever drawn over a word. **The player's own ground glows** in their colour
  while the season is waiting on them, and stops while it resolves.

  Interaction was rebuilt around the fact that this is a real-time battle game
  wrapped in a season, not a board game: a guide line always names the next
  thing to do, a tooltip reads any province without a click, and a stack is
  taken in hand by clicking its token and sent by clicking (or dragging onto)
  a province — with the route and its cost in seasons drawn before the order is
  given. Right-click still marches. The panel leads with orders as full-width
  buttons and keeps the numbers under them, two to a line.

  Three real bugs fell out: pressing a token both selected it and armed a click
  that deselected it; two stacks in one seat were drawn at the same point, so
  the buried one could never be clicked; and hit-testing read a token layout
  that only the draw pass refreshed, so an order landing between frames missed.
  New suite `test/sanguo-campaign-ui.js` (25) covers the palette, the guide,
  the tooltip, both march gestures, panning, and the halo's turn state.
- **2026-08-31 (cont.)** — made the product boundary explicit. 火柴三國 remains
  at root as the sole active game; The Outbreak, Cannae, and The Hold moved to
  `reference/` with their scenario packs, design notes, regression suites, and
  frozen pre-split original. Shared engine modules stayed in `js/` because
  Sanguo consumes them directly. The archived pages now use explicit scenario
  selection and `../js/` paths, remain file:// compatible, and are still
  exercised by `npm run test:reference` and the full `npm test` gate.
