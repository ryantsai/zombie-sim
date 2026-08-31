# Open issues

Known-open items across the repo. Bugs that have been **fixed** are not here —
they live in `PROGRESS.md` under "Bugs worth remembering", which is the record
of what went wrong and why. This file is only what is still outstanding.

Design decisions that were made deliberately live in `SANGUO-DESIGN.md` §11.
Something only belongs here if it is genuinely unresolved, or is a limitation
someone could reasonably trip over.

| Status | Meaning |
|---|---|
| **DECIDE** | blocked on a call the maintainer has to make |
| **OPEN** | real, actionable, nobody is on it |
| **DEFERRED** | known limitation, already scheduled into a later phase |
| **NIT** | minor; fix if you are in the area |

| # | Status | Area | Summary |
|---|---|---|---|
| [1](#1) | ~~RESOLVED~~ | tooling | ~~`.verify/` is gitignored, so no test suite is committed~~ — suites moved to committed `test/` trees, `npm test` |
| [2](#2) | ~~RESOLVED~~ | tooling | GitHub verification now forces the font-subset check on every push and pull request |
| [3](#3) | ~~RESOLVED~~ | battle | Reference and seeded battles resolve inside the design pacing window |
| [4](#4) | ~~RESOLVED~~ | battle | Five open biomes, three town plans and three fort plans ship |
| [7](#7) | ~~RESOLVED~~ | structure | Deterministic duels live in `js/battle/duel.js` |
| [8](#8) | ~~RESOLVED~~ | tooling | ~~`oxfmt js/` rewrites line endings across every core file~~ — `.gitattributes` pins LF |
| [9](#9) | ~~RESOLVED~~ | render | Every scenario now reuses its HUD, callback, parameter and overlay records |
| [10](#10) | ~~RESOLVED~~ | campaign | Auto-resolve, occupation and long-campaign convergence have committed guards |
| [11](#11) | ~~RESOLVED~~ | campaign | All 200 officers have mutable records and dated free-pool release |
| [12](#12) | ~~RESOLVED~~ | campaign | Tales, Rest and a pluggable capital-mandate victory ship; diplomacy remains v2 |
| [13](#13) | NIT | campaign | The campaign has no fog of war |
| [14](#14) | ~~RESOLVED~~ | tooling | ~~A script that fails to parse is a silent no-op~~ — `npm test` lints first, and a module manifest is asserted |

---

## 1

**RESOLVED · tooling · the verification suites are now committed**

*Was: `.gitignore` excludes `.verify/`, so a fresh clone got the game and none
of its tests.*

Fixed 2026-08-31. The reusable suites moved to a committed `test/`; `.verify/`
went back to being what `AGENTS.md` describes — one-off diff scripts, fps
probes and screenshot output, all still ignored.

```
test/sanguo-p0.js             48 assertions
test/sanguo-p1.js             63 assertions
test/sanguo-p3.js            131 assertions
reference/test/pages-regression.js  35 assertions — guards all reference pages + file://
reference/test/hold-p4.js           22 assertions — guards the Hold through dawn
test/sanguo-seed-sweep.js     16-seed no-hang sweep (slow; not in npm test)
test/campaign-sweep.js        campaign pacing probe for issue 10
test/sanguo-*-shot.js         screenshot helpers; PNGs still land in .verify/
```

`npm test` runs `oxlint`, then every phase/regression suite plus
`tools/check-generals.js`. The two non-Sanguo suites now resolve the repo root
from `reference/test/` and run together through `npm run test:reference`.

This also closes the enforcement half of issue 2: `npm test` is now a single
command that runs the font `--check`, which makes a pre-commit hook or CI step
a one-liner if anyone wants one.

---

## 2

**RESOLVED · tooling · CI forces the subset check to run**

Resolved 2026-08-31. `.github/workflows/verify.yml` runs the complete
`npm test` gate on every push and pull request (and on manual dispatch), so the
font coverage check in `test/sanguo-p0.js` is no longer dependent on someone
remembering to invoke it locally. The workflow installs the committed Node
dependencies, Chromium, and the small Python font-tooling dependency before
running the same command contributors run on their workstation.

`fonts/lxgw-wenkai-tc.subset.woff2` is cut to exactly the characters the game
can render. Add a string with a new Han character and that glyph falls back to
system kai — visibly a different face, with no error anywhere.

### The stale-harvest half is fixed

*Was: the harvest read a hand-kept `TEXT_GLOBS` at the top of
`tools/subset-font.py`. **That is the shape of this issue to watch for** — the
check is only as good as the list of places text can live, and that list was
maintained by hand. It went stale twice. Between P7 and P3 it listed only
`js/i18n/*.js`, `js/campaign/data/*.js` and `index.html`, while `js/art/flag.js`
drew a house glyph on every banner and `js/figure/portrait.js` carried general
names — 120 glyphs falling back to system kai on every page while `--check`
cheerfully reported the subset complete, because the check was asking the same
too-narrow question the build was.*

Fixed 2026-08-31. The list is now derived from the page rather than kept beside
it. `index.html` is the only page that loads the subset — the three archived
reference pages use a system stack — so the set of files that can put kai on
screen is exactly `index.html` plus its `<script src>` tags. That is what
`sources()` reads.

```
python tools/subset-font.py --sources    # 67 files, 1240 glyphs
```

Files are harvested whole, comments included: it over-covers by a handful of
glyphs and needs no JavaScript parsing, which is the right trade for a check
whose only real failure mode is a false negative.

**It found a live gap immediately.** Four glyphs the old globs never saw —
`撤楷霞鶩`, from comments in `js/sound.js` and `js/fonts/font.js` — were outside
the subset. The rebuild is 1,022 glyphs, 287 KB, and the new harvest is a
verified strict superset of the old one (0 glyphs dropped).

This half can no longer regress by omission: a new module is picked up when its
`<script>` tag is added, and a module with no tag fails
`tools/module-manifest.js` instead (issue 14). The two checks close each
other's blind spot.

### Enforcement (fixed)

`npm test` runs `--check` (via `test/sanguo-p0.js`) and lints first, so a single
local command covers it. The committed GitHub workflow now runs that command
automatically even when the local check was skipped.

A rebuild is no longer expensive, which changes the arithmetic on this: the
source face is committed at `assets/fonts/LXGWWenKaiTC-Regular.ttf`, so the
fix for a failed check is one command with no download. This issue previously
said the opposite, following `FONTS.md`, which was wrong; both are corrected.

CI was chosen over a repository-local pre-commit hook: clones require no
`core.hooksPath` opt-in, and the remote result is visible on the exact pushed
revision.

Separately and not a bug: **whether a 15 MB `.ttf` belongs in the history** is
worth deciding. It packs to 8.8 MB of a 15.0 MiB pack.

## 3

**RESOLVED · battle · pacing and no-hang behavior have committed coverage**

Resolved in P7. The unchanged reference battle and deterministic seed sweep
exercise the watchdog, ledger, rout and 60–180 second design window. The notes
below are the tuning history that led to those guards.

Three numbers were picked to make the battle stop hanging, not because they are
right:

| Constant | File | Value | Concern |
|---|---|---|---|
| `STALEMATE` | `js/scenarios/sanguo.js` | 45 s | how long with no casualty before the field is called |
| `STALL_GIVEUP` | `js/scenarios/sanguo.js` | 12 s | how long a unit may make no progress before its order is dropped |
| `HP` | `js/scenarios/sanguo.js` | `[5,6,3,5,7,4]` | the main pacing lever |

The old P1 16-seed sweep resolved in **30–186 s**. With P2 morale and the new
commander active, a six-seed passive-player sample resolves in **62–119 s**,
inside the design's 60–180 s target. That sample was encouraging but was not a
retune; the subsequent committed sweep now covers the settled pressure curve.

`STALL_GIVEUP` in particular is a backstop, not a mechanism: if it is firing
often in normal play, something else is wrong and it is hiding it.

The formation pass added a per-battle `scenario.stallGiveups` counter. A
16-seed deliberately aggressive opening (every player block attack-moves at its
nearest enemy, then receives no more orders) resolved all battles in
**40.8–129.6 s** with no stalemates, but recorded **20 watchdog drops across 15
battles**. That order pattern intentionally creates congestion, so it proves the
backstop is active but does not yet prove ordinary play is broken. The exact
documented passive-player suite is absent from this checkout because of issue
1, so its earlier 62–119 s sample could not be rerun with the new counter.

**Next step:** recover or commit the canonical seed probe, record which units
and order modes trigger each drop, then fix the movement/congestion cause before
retuning `STALL_GIVEUP` or `HP`.

---

## 4

**RESOLVED · battle · authored terrain, towns and forts ship**

Resolved in P4. `ZS.Battlefield` now supplies plain/hill/river/wood/marsh open
country, three street topologies, and three gated castle variants with terrain
costs, LOS, collision, role-aware deployment, reserves, rout exits and breach
validation. `test/sanguo-p4-maps.js`, `sanguo-p4-battle.js` and
`sanguo-map-shots.js` cover the result. The text below records the original gap.

§4.3 wants `open` to lay plain / river / hills / forest. It currently lays a
plain and nothing else.

`world.water()` only runs its pinned, scenario-placed path when given **both**
`riverBaseX` and `lake`; with one missing it falls through to the generative
branch, which put a river diagonally across the middle of the battlefield. Both
armies then deployed on opposite banks, and remnants that drifted into the
water were pinned there by the core's walkability clamp — a battle that could
never end.

`_findField` (ported from `cannae.js`) already searches for dry ground, so the
seam for bringing terrain back exists. Scheduled for **P4**, alongside `town`
(reuses `ZS.Buildings`, the Outbreak) and `fort` (reuses `ZS.Tiles` + blocks,
the Hold), by which point the flow field routes around obstacles and the
deployment respects them.

Recorded as decision 9 in `PROGRESS.md`.

---

## 7

**RESOLVED · structure · duels have their §9 file**

Resolved in P5 by `js/battle/duel.js`: deterministic best-of-five exchanges,
kill/rout callbacks, camera interest, stable records and campaign result logs.

The file plan lists `js/battle/morale.js`, `js/battle/duel.js`,
`js/battle/commander-ai.js` and `js/battle/ability.js`. P2 has now split morale,
the first active ability and the influence-map commander into those intended
files. Duels do not exist yet.

The remaining structural work follows its feature phase: duels arrive with
general RPG depth in P5. `js/battle/flowfield.js`, `formation.js`, `command.js`,
`morale.js`, `ability.js` and `commander-ai.js` are already self-contained.

---

## 8

**RESOLVED · tooling · `oxfmt js/` no longer rewrites every core file**

*Was: running it across the whole directory normalised all 17 pre-existing
core files to LF, so they showed as modified with no content change. The
workaround was `npm run format` listing the sanguo paths by hand.*

Fixed 2026-08-31. It was never really about oxfmt. Everything in the index was
**already LF**; `core.autocrlf=true` was checking the working copy out as CRLF,
so the first tool to write a file converted it and git reported the whole file
as changed.

`.gitattributes` now pins the working copy too:

```
* text=auto eol=lf
```

plus explicit `binary` for the font, audio and image assets, so git cannot ever
decide to convert one. Because the index was already LF, `git add
--renormalize .` was a no-op — the commit is the attributes file alone, and
`git rm -r --cached . && git reset --hard` refreshed the working copy in place.
The tree is now LF end to end (97 text files, 3 binary, 1 with no newline).

`npm run format` is the canonical formatter command and `format:all` is gone.
It covers product code, tests, tools, and the JavaScript kept under
`reference/`; `.gitattributes` keeps the whole tracked tree on LF.

## 9

**RESOLVED · render · `scenario.hud()` reuses its records**

Resolved 2026-08-31 while finishing the Hold's P4 night. `js/draw.js` calls
`scenario.hud()` every frame, so the product pack and all three archived packs
keep one HUD record and stable legend/overlay callbacks, updating only their
dynamic strings and numbers. End overlays, dawn-card wrappers and Sanguo's
i18n parameter objects are reused too; the archived zombie HUD also fills a
reusable counts record. The P1 and reference-page regressions call all four
packs twice and assert identity for the HUD and both callbacks, so a
literal-with-closures cannot quietly return here.

---

## 10

**RESOLVED · campaign · auto-resolve and convergence are guarded**

Resolved across P4–P7. Pure previews match applied results, the campaign and
played battle share one handoff contract, losses apply idempotently, occupation
costs men, supply affects isolated armies, and the 240-season replay sweep
reaches a mandate winner without violating ledgers or collapsing implausibly
early. The analysis below is retained as tuning history.

`js/campaign/autoresolve.js` decides every campaign battle until P4, and its
numbers were chosen to produce a moving board rather than because they are
right. The **shape** is settled and is not the open question: it returns the
§4.3 `BattleResult`, so P4 replaces arithmetic rather than a contract.

### The structural half is fixed

The first probe (`test/campaign-sweep.js`, 20 seeds × 40 seasons, passive
player) said the problem was not really the constants:

| | before | after |
|---|---|---|
| commanderies changing hands | **3.53** / season | 1.58 / season |
| chained conquests (≤3 seasons apart) | **86.9** / campaign | 17.6 |
| longest single-stack run | **15** provinces | **4** |
| median garrison at the end | 1,187 | 1,100 |
| men left on the board | 78% of the opening | 106% |
| factions still holding ground (120 seasons) | — | 12.8 of 22 |

Three things, none of them a constant, were letting one stack sweep a third of
the empire:

1. **The conqueror inherited the beaten garrison.** `setOwner` changed the flag
   and left `garrison` untouched, so the defenders flipped sides intact and
   taking ground cost nothing to hold. `Campaign.occupy()` now disperses them
   and detaches a holding garrison from the stack that took the place.
2. **Fighting produced no fatigue.** It was added only by marching and
   retreating, so a stack that had just stormed a walled city was at full
   strength the next season. `Army.tire()` is called after both battle paths.
3. **The AI could not concentrate force.** It split every levy into a fresh
   column and never topped one up, so once garrisons outgrew attack stacks the
   war simply stopped — 0.40 flips/season and 110% of the men still alive after
   100 seasons. It now masses toward `MASS_TARGET`, rests a spent stack, and
   will not strip a frontier province below twice its holding garrison.

`test/sanguo-p3.js` asserts the anti-chain property and the occupation
mechanics directly, so this cannot silently come back.

### Historical tuning gate (now closed)

The numbers themselves. `WALL_BONUS`, `GARRISON_QUALITY`, `ASSAULT_TAX`, the
±6% band, `loserFrac` / `winnerFrac`, `OCCUPY_PER_SIZE` and `MASS_TARGET` are
all still picked by feel — they now produce a war that sustains itself and
consolidates (22 → 12.8 factions over 30 years) instead of one that thrashes or
freezes, which is what P3 needed, and no more than that.

The real gate is §4.3's: *"the closed-form model is tuned to roughly match
played-out results so skipping isn't strictly better or worse."* That cannot be
judged until P4 makes both paths exist. The probe to write then is a fixed
`BattleSetup` fought both ways across a spread of seeds, comparing winner rate
and loss ratio; `test/campaign-sweep.js` is the harness pattern to copy.

Interacts with issue 3: a played-out battle's losses are whatever the sim
produced, so tuning the closed form against it inherits whatever the pacing
constants are doing.

**Raised:** 2026-08-31 with P3. Structural causes fixed the same day; the
tuning stays open for P4.

---

## 11

**RESOLVED · campaign · the complete almanac is reachable**

Resolved in P5. Every catalogue entry receives a mutable campaign record;
historically later officers remain unavailable until their release year, then
enter the free pool. Allegiance, location, injury, capture and death all
serialize. The notes below describe the old flat-roster limitation.

`js/campaign/data/factions.js` places 92 of the almanac's 200 officers with a
warlord for 194. The remaining 108 are real records with real stats that no
campaign can ever field.

Most of that is correct and deliberate — the almanac spans the whole war, and
姜維, 鄧艾, 陸抗 and 司馬昭 are not available in 194 to anybody. But some of it
is simply unwritten: 張燕 and 士燮 lead factions whose leader is `null` because
the almanac has no entry for them, and several minor warlords hold a province
with one officer or none.

Three things could close it, and they are not the same decision:

1. **Free officers.** Unplaced generals sit in their historical province and
   can be recruited — the obvious use for most of the 108, and the reason
   §4.1's `Recruit` order exists alongside `Assign`.
2. **A join-by-date table.** 諸葛亮 should not be recruitable in 194. Needs a
   `from` year per record, which is almanac data and therefore P5's call.
3. **Two more almanac entries** for 張燕 and 士燮, or accepting that those two
   factions are led by nobody.

None of it blocks P3 — `ZS.Roster` filters unknown ids and a leaderless
faction plays — but a campaign where two thirds of the roster is unreachable is
not the game §4.1 describes. Scheduled thinking: P5, with the rest of the RPG
layer.

**Raised:** 2026-08-31, with P3.

---

## 12

**RESOLVED · campaign · v1 events, Rest and victory ship**

P5–P7 added injury Rest, twelve visible choice-driven Tales, and a pluggable
capital-mandate goal with persistent victory/defeat UI. Diplomacy-lite remains
the design's explicit v2 scope, not unfinished v1 work. The list below records
the P3 gap.

P3 is the skeleton §10 asked for and deliberately stops there. Missing, each
already scheduled:

- **Diplomacy-lite** (truce, gift, demand) — §4.1 marks it v2.
- **Random events** — `js/campaign/data/events.js` is in the §9 file plan and
  does not exist yet; P6.
- **A win condition.** `Campaign.recount()` ends the game when one faction is
  left standing, which on a 57-commandery map is a very long time. §10 files
  "full campaign playable start to a win condition" under P7.
- **Rest**, the sixth order in §4.1's list, which heals injuries and recovers
  loyalty. It has nothing to do until P5 gives generals injuries.

Not a bug. Recorded so nobody re-derives the gap.

---

## 13

**NIT · campaign · no fog of war**

The map shows every faction's armies, garrisons and treasury-funded
development at all times. The design does not ask for fog, and hiding the board
would make the AI's marches — the main sign that the world is alive — invisible.

Worth revisiting if it turns out that seeing every stack makes the campaign
trivial rather than legible. It is a rendering decision, not a data one: the
campaign state is already the single source, so a visibility filter would sit
in `js/campaign/view.js` alone.

---

## 14

**RESOLVED · tooling · a script that failed to parse was a silent no-op**

*Was: `index.html` loads ~50 classic `<script src>` files — constraint 1, no
modules and no bundler. If one failed to parse, the browser logged an uncaught
`SyntaxError`, **skipped that file, and carried on**. Every other script still
ran, the page still booted to the menu, and the module was simply not on
`window.ZS`. The failure then surfaced a long way from its cause:*

```
page.evaluate: TypeError: Cannot read properties of undefined (reading 'create')
```

*— which is `ZS.Campaign` being absent, three files and one verify suite away
from a stray comma in `js/campaign/campaign.js`. It happened twice while
building P3, both times the same way: `ZS.Campaign` is a `class`, unlike nearly
every other module here, so a method pasted in with the object-literal `},` is
a syntax error that takes the whole file out.*

Fixed 2026-08-31, with both options the issue recommended.

### 1. `npm test` lints first

```json
"lint": "oxlint js/ test/ tools/ reference/js/ reference/test/",
"test": "npm run lint && node test/sanguo-p0.js && ..."
```

Detection was never the gap — `oxlint` always caught this exactly. The gap was
that nothing made you run it, so the cheapest possible failure was reported as
the most expensive one. Re-injecting the original trap now gives:

```
js/campaign/campaign.js:343:34: error: Unexpected token
```

before Playwright launches at all. `test/` and `tools/` were added to the lint
path at the same time — a suite that fails to parse is the same trap one level
out.

### 2. A module manifest, harvested rather than hand-kept

`tools/module-manifest.js` reads each page for its `<script src>` list, and
each of those files for the exports it promises — assignments to `ZS.<name>` at
indent ≤ 2, which is this codebase's universal module-export convention.
Deeper assignments (`ZS.engine`, `ZS.scenario`, `ZS.debug`) are runtime handles
set inside a function once a scenario is live, and are correctly excluded.

`test/sanguo-p0.js` asserts index.html delivers all 89 of its names;
`reference/test/pages-regression.js` does the same for the three archived pages
(29, 30 and 28). Both name the offending file in the failure detail:

```
FAIL  all 89 modules index.html loads are on ZS  -> ["Campaign (js/campaign/campaign.js)"]
```

The manifest also catches what lint structurally cannot: a module under `js/`
or `reference/js/` that exports to `ZS` and appears in no page's script list —
a new file with a forgotten `<script>` tag, which produces the same `undefined`
symptom and which no static check of the file itself can see.

```
FAIL  no js/ module exports to ZS without a <script> tag on some page
        -> ["js/campaign/__probe.js"]
```

Both failure modes were injected deliberately and confirmed to fire before the
guards were called done.

**Nothing here is hand-maintained**, which was the point. Issue 2's equivalent
list — `TEXT_GLOBS` in `tools/subset-font.py` — is maintained by hand and has
silently gone stale twice; this one is derived from the source, so adding a
module extends the check by itself. `npm run test:manifest` prints it.

**Raised:** 2026-08-31, after hitting it twice in one session. **Resolved** the
same day.
