# Verification suites

Playwright checks that ship with the repo. `npm test` runs the four assertion
suites plus the almanac gate, in the order that fails fastest:

```bash
npm test
```

| File | What it guards |
|---|---|
| `sanguo-p0.js` | Boot, store/auth/save round-trip, i18n, **and the font subset coverage check** — over http *and* `file://` |
| `sanguo-p1.js` | The skirmish battle: deployment, the command layer, determinism, no hangs, clean teardown |
| `sanguo-p3.js` | The campaign: map invariants, the general almanac, every order and its refusals, ten seasons of invariants, save/reload/resume |
| `pages-regression.js` | That `zombiesim.html`, `battle.html` and `hold.html` still boot — this is the only thing standing between the three original pages and a core change |
| `sanguo-seed-sweep.js` | The long no-hang sweep. Slow; not in `npm test`, run it after touching battle movement |
| `campaign-sweep.js` | Campaign pacing probe — how fast ground changes hands (`ISSUES.md` #10). Reports numbers, asserts nothing |

Screenshot helpers (`sanguo-shot.js`, `sanguo-battle-shot.js`,
`sanguo-campaign-shot.js`, or `npm run shots`) write PNGs into `.verify/`,
which stays gitignored — the images are for looking at, not for keeping.

## The split with `.verify/`

`AGENTS.md` calls `.verify/` the scratch area: one-off diff scripts that get
deleted after use, fps probes, and screenshot output. **Reusable checks live
here instead**, because a suite nobody else can run is not a guard. That was
`ISSUES.md` #1, and it had already cost something — P3 added a fifth suite and
had to edit the P1 one, and none of it was visible to anyone else.

Each script resolves the repo root as `path.resolve(__dirname, "..")` and
serves it over a throwaway `http.createServer` on a random port, so nothing
here depends on where it is run from or on a dev server being up.
