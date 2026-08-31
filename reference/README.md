# Reference simulations

This directory preserves the three prototypes that preceded 火柴三國. They are
reference material and regression fixtures, not active products or roadmap
targets. The repository root and `index.html` belong to Matchstick Sanguo.

## Runnable pages

- [The Outbreak](zombiesim.html) — zombie horde and paper-town simulation
- [Cannae, 216 BC](battle.html) — the original 781-figure formation battle
- [The Hold](hold.html) — tile-based zombie base-defense prototype

Each page remains double-clickable over `file://`. Its dedicated scenario pack
lives in [`js/scenarios/`](js/scenarios/); engine modules that Sanguo also uses
remain in the root [`js/`](../js/) directory and are loaded through `../js/...`
script paths.

## Historical material

- [Outbreak design](docs/OUTBREAK-DESIGN.md)
- [Hold design](docs/HOLD-DESIGN.md)
- [Pre-split Outbreak original](example/index.html)

The reference-only Playwright guards live in [`test/`](test/). Run them with
`npm run test:reference`; the root `npm test` command includes them to catch
shared-engine regressions without treating these prototypes as current game
work.
