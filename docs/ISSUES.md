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
| [1](#1) | ~~RESOLVED~~ | tooling | ~~`.verify/` is gitignored, so no test suite is committed~~ — suites moved to `test/`, `npm test` |
| [2](#2) | OPEN | tooling | The font subset can silently fall out of date |
| [3](#3) | OPEN | battle | Battle pacing constants are untuned guesses |
| [4](#4) | DEFERRED | battle | `open` battlefields are a bare plain — no river, hills or forest |
| [7](#7) | DEFERRED | structure | Duels still need their §9 file |
| [8](#8) | NIT | tooling | `oxfmt js/` rewrites line endings across every core file |
| [9](#9) | NIT | render | `scenario.hud()` allocates per frame |
| [10](#10) | OPEN | campaign | Auto-resolve constants are still by feel — the conquest-chaining causes are fixed, the tuning is P4's |
| [11](#11) | OPEN | campaign | 108 of the 200 generals serve nobody |
| [12](#12) | DEFERRED | campaign | No diplomacy, no events, no win condition beyond last-one-standing |
| [13](#13) | NIT | campaign | The campaign has no fog of war |
| [14](#14) | OPEN | tooling | A script that fails to parse is a silent no-op, and `npm test` never runs the lint that would catch it |

---

## 1

**RESOLVED · tooling · the verification suites are now committed**

*Was: `.gitignore` excludes `.verify/`, so a fresh clone got the game and none
of its tests.*

Fixed 2026-08-31. The reusable suites moved to a committed `test/`; `.verify/`
went back to being what `AGENTS.md` describes — one-off diff scripts, fps
probes and screenshot output, all still ignored.

```
test/sanguo-p0.js             45 assertions
test/sanguo-p1.js             62 assertions
test/sanguo-p3.js            121 assertions
test/pages-regression.js      23 assertions — guards the other three pages
test/sanguo-seed-sweep.js     16-seed no-hang sweep (slow; not in npm test)
test/campaign-sweep.js        campaign pacing probe for issue 10
test/sanguo-*-shot.js         screenshot helpers; PNGs still land in .verify/
```

`npm test` runs the four assertion suites plus `tools/check-generals.js`. Each
script resolves the repo root itself, so the move needed no edits inside them.

This also closes the enforcement half of issue 2: `npm test` is now a single
command that runs the font `--check`, which makes a pre-commit hook or CI step
a one-liner if anyone wants one.

---

## 2

**OPEN · tooling · the font subset can silently fall out of date**

`fonts/lxgw-wenkai-tc.subset.woff2` is cut to exactly the characters found in
`js/i18n/*.js`, `js/campaign/data/*.js` and `index.html`. Add a string with a
new Han character and that glyph falls back to system kai — visibly a different
face, with no error anywhere.

`python tools/subset-font.py --check` catches it, and `test/sanguo-p0.js`
runs that check, so it is caught **if someone runs the suite**. Nothing enforces
it. It has already happened twice.

Once at P1, when the battle strings added 44 glyphs outside the subset. And
again, invisibly, from P7 until P3: `TEXT_GLOBS` only listed `js/i18n/*.js`,
`js/campaign/data/*.js` and `index.html`, but `js/art/flag.js` draws a house
glyph on every banner and `js/figure/portrait.js` carries general names — 120
characters between them and the other art files, none of them harvested. They
fell back to system kai on every page while `--check` cheerfully reported the
subset complete, because the check was asking the same too-narrow question the
build was. The globs now cover every file that can draw text.

**That is the shape of this issue to watch for.** The check is only as good as
the list of places text can live, and that list is maintained by hand. A new
module that draws a Han character and is not in `TEXT_GLOBS` reintroduces the
whole problem with the gate still green.

Rebuilding also needs the ~15 MB source face re-downloaded (deliberately not
committed — see `FONTS.md`), so the fix is not something a contributor
can do without going and fetching it.

**Options:** a pre-commit hook running `--check`, or CI. Issue 1 is resolved,
so the suite is in the repo and `npm test` runs the check — a hook is now a
one-liner rather than a blocked idea. Left OPEN because nothing *enforces* it
yet, and because the harvest-glob hazard above cannot be fixed by enforcement
at all.

---

## 3

**OPEN · battle · pacing constants are untuned guesses**

Three numbers were picked to make the battle stop hanging, not because they are
right:

| Constant | File | Value | Concern |
|---|---|---|---|
| `STALEMATE` | `js/scenarios/sanguo.js` | 45 s | how long with no casualty before the field is called |
| `STALL_GIVEUP` | `js/scenarios/sanguo.js` | 12 s | how long a unit may make no progress before its order is dropped |
| `HP` | `js/scenarios/sanguo.js` | `[5,6,3,5,7,4]` | the main pacing lever |

The old P1 16-seed sweep resolved in **30–186 s**. With P2 morale and the new
commander active, a six-seed passive-player sample resolves in **62–119 s**,
inside the design's 60–180 s target. That is encouraging but not a retune: the
full sweep still needs to run after formation work stops moving the pressure
curve.

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

**DEFERRED · battle · `open` battlefields are a bare plain**

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

**DEFERRED · structure · duels still need their §9 file**

The file plan lists `js/battle/morale.js`, `js/battle/duel.js`,
`js/battle/commander-ai.js` and `js/battle/ability.js`. P2 has now split morale,
the first active ability and the influence-map commander into those intended
files. Duels do not exist yet.

The remaining structural work follows its feature phase: duels arrive with
general RPG depth in P5. `js/battle/flowfield.js`, `formation.js`, `command.js`,
`morale.js`, `ability.js` and `commander-ai.js` are already self-contained.

---

## 8

**NIT · tooling · `oxfmt js/` rewrites every core file**

Running it across the whole directory normalises all 17 pre-existing core files
to LF, so they show as modified with no content change. Format only the sanguo
paths:

```bash
node node_modules/oxfmt/bin/oxfmt js/app.js js/text.js js/store js/auth js/save js/i18n js/ui js/fonts js/figure js/battle js/scenarios/sanguo.js
```

`node node_modules/oxlint/bin/oxlint js/` over everything is safe.

A `.gitattributes` pinning line endings would settle it properly.

---

## 9

**NIT · render · `scenario.hud()` allocates per frame**

`js/draw.js` calls it every frame and `ScenarioSanguo.hud()` builds a fresh
object with two closures each time. `AGENTS.md` constraint 5 bans per-frame
allocation in hot loops; this is once per frame rather than once per agent, and
the zombie, cannae and hold packs all do the same, so it is consistent with the
codebase rather than a new sin. Worth hoisting into a reused record if the HUD
grows.

---

## 10

**OPEN · campaign · the auto-resolve model is untuned**

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

### What is still open

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

**OPEN · campaign · 108 of the 200 generals serve nobody**

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

**DEFERRED · campaign · no diplomacy, events, or real win condition**

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

**OPEN · tooling · a script that fails to parse is a silent no-op**

`index.html` loads about fifty classic `<script src>` files — constraint 1, no
modules and no bundler. If one of them fails to parse, the browser logs an
uncaught `SyntaxError`, **skips that file, and carries on**. Every other script
still runs, the page still boots to the menu, and the module is simply not on
`window.ZS`.

The failure then surfaces a long way from its cause. It happened twice while
building P3, both times the same way:

```
page.evaluate: TypeError: Cannot read properties of undefined (reading 'create')
```

— which is `ZS.Campaign` being absent, three files and one verify suite away
from a stray comma in `js/campaign/campaign.js`.

**The specific trap that caused both.** `ZS.Campaign` is a `class`, unlike
nearly every other module here, which are object literals on `ZS`. A method
pasted in with the object-literal `},` is a syntax error in a class body:

```js
class Campaign {
  occupationCost(id) { ... },   // <- takes the whole file out
  occupy(id, army) { ... }
}
```

**Detection is not the gap.** `npm run lint` catches it exactly, with the file
and the line, and exits 1:

```
js/campaign/campaign.js:331:6: error: Unexpected token
```

The gap is that nothing makes you run it. `npm test` goes straight to
Playwright, so the cheapest possible failure — a parse error — is reported as
the most expensive and most confusing one.

**Options**

1. Put `oxlint js/` at the front of `npm test`. One line, and it turns a
   baffling `TypeError` into a file and a line number. Covers this case
   entirely.
2. A boot-time module manifest: `index.html` (or a small list) declares what it
   expects on `ZS`, and the P0 suite asserts every name is present. This
   catches a *different* silent failure that option 1 does not — writing a new
   `js/campaign/foo.js` and forgetting to add the `<script>` tag, which no lint
   can see and which produces the same `undefined` symptom.
3. Both.

**Recommendation:** both, in that order. (1) is a one-line change with an
immediate payoff. (2) is worth doing before the file count grows again — P3
added eleven script tags, and nothing but a failing assertion somewhere
downstream would have told anyone if one had been missed.

Interacts with issue 1 only in that the suites now exist in the repo to be run.

**Raised:** 2026-08-31, after hitting it twice in one session.
