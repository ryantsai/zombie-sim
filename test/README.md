# Verification suites

Playwright checks that ship with the repo. `npm test` runs `oxlint` first, then the four
assertion suites and the almanac gate, in the order that fails fastest:

```bash
npm test
```

| File                    | What it guards                                                                                                                                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sanguo-p0.js`          | Boot, store/auth/save round-trip, i18n, **the module manifest** (`ISSUES.md` #14) **and the font subset coverage check** — over http _and_ `file://`                                                                                                                                         |
| `sanguo-p1.js`          | The skirmish battle: deployment, the command layer, determinism, no hangs, clean teardown                                                                                                                                                                                                    |
| `sanguo-p3.js`          | The campaign: map invariants, the general almanac, every order and its refusals, ten seasons of invariants, save/reload/resume                                                                                                                                                               |
| `sanguo-campaign-ui.js` | The campaign map as an _interface_: that the warlord palette stays separable (and further apart still where two of them share a border), that the guide line and the tooltip track what is selected, and that click-to-march and drag-to-march give the same order without panning the sheet |
| `pages-regression.js`   | That `zombiesim.html`, `battle.html` and `hold.html` still boot, and that each one delivers every module it loads — this is the only thing standing between the three original pages and a core change                                                                                       |
| `sanguo-seed-sweep.js`  | The long no-hang sweep. Slow; not in `npm test`, run it after touching battle movement                                                                                                                                                                                                       |
| `campaign-sweep.js`     | Campaign pacing probe — how fast ground changes hands (`ISSUES.md` #10). Reports numbers, asserts nothing                                                                                                                                                                                    |

Screenshot helpers (`sanguo-shot.js`, `sanguo-battle-shot.js`,
`sanguo-campaign-shot.js`, or `npm run shots`) write PNGs into `.verify/`,
which stays gitignored — the images are for looking at, not for keeping.

## Why lint runs first, and what the manifest adds

`index.html` loads ~50 classic `<script src>` files. If one fails to parse the
browser logs a `SyntaxError`, **skips that file, and carries on** — the page
still boots and the module is simply missing from `ZS`, so the real failure
surfaces as a `TypeError` several files away. That was `ISSUES.md` #14, and it
cost two debugging sessions in one day.

Two guards, because they catch different things:

1. **`oxlint js/ test/ tools/` at the front of `npm test`.** A parse error is
   the cheapest possible failure and now gets reported as one, with a file and
   a line, before Playwright ever launches.
2. **The module manifest.** `tools/module-manifest.js` reads each page for its
   `<script src>` list and each of those files for the `ZS.<name> =` exports it
   promises at module indent; the suites assert the booted page delivered every
   name. It also flags the reverse — a `js/` module that exports to `ZS` and is
   in no page's script list, which is a forgotten `<script>` tag and which no
   lint can see.

Nothing is hand-maintained: add a module and the manifest picks it up from the
source. Run `npm run test:manifest` to print what each page promises.

## The split with `.verify/`

`AGENTS.md` calls `.verify/` the scratch area: one-off diff scripts that get
deleted after use, fps probes, and screenshot output. **Reusable checks live
here instead**, because a suite nobody else can run is not a guard. That was
`ISSUES.md` #1, and it had already cost something — P3 added a fifth suite and
had to edit the P1 one, and none of it was visible to anyone else.

Each script resolves the repo root as `path.resolve(__dirname, "..")` and
serves it over a throwaway `http.createServer` on a random port, so nothing
here depends on where it is run from or on a dev server being up.
