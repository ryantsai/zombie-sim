# AGENTS.md — archived simulation references

This subtree contains The Outbreak, Cannae, and The Hold. They are preserved as
runnable engineering references and regression fixtures for shared Sanguo
engine work. They are not active products or roadmap targets. Do not implement
their unfinished feature plans unless the user explicitly asks.

## Layout

- `zombiesim.html` + `js/scenarios/zombie.js` — The Outbreak
- `battle.html` + `js/scenarios/cannae.js` — Cannae, 216 BC
- `hold.html` + `js/scenarios/hold.js` — The Hold through P4
- `docs/` — historical Outbreak and Hold designs
- `example/index.html` — frozen pre-split Outbreak original
- `test/` — reference-page and Hold P4 Playwright guards

The pages intentionally load shared engine modules from root `../js/`. Do not
copy those modules into this subtree: Sanguo owns the live shared copies.

## Preservation constraints

1. Every page must remain double-clickable over `file://`, using classic
   scripts and an explicit `window.ZS_SCEN` value.
2. Keep the sketch primitives and paper palette. The Outbreak agent drawing in
   `js/scenarios/zombie.js` is a verbatim port of `example/index.html`; do not
   restyle it or change the frozen original.
3. Keep scenario rules in the archived pack, never in the shared root engine.
4. Avoid per-frame allocations in the legacy hot loops (up to 910 agents).
5. The Hold's P5/P6 notes are historical. P1–P4 preservation is the tested
   boundary, not an invitation to continue the clicker.

## Verification

From the repository root, run:

```bash
npm run format
npm run lint
npm run test:reference
```

`reference/test/pages-regression.js` boots all three pages over HTTP and
`file://`, checks every local script and promised `ZS` export, advances the live
loop, and requires a clean console. `reference/test/hold-p4.js` preserves the
completed Hold night/dawn rules. The root `npm test` includes both.

Shared-core edits made outside this subtree still require this reference gate.
Reference-only tests stay in `reference/test/`; screenshots may go in an
ignored `.verify/` directory.
