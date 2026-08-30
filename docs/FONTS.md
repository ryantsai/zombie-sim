# fonts/

## LXGW WenKai TC — 霞鶩文楷 台灣繁體

The game's brush-kai face (`SANGUO-DESIGN.md` §6.3).

| | |
|---|---|
| Upstream | <https://github.com/lxgw/LxgwWenkaiTC> |
| Version | v1.522 (`LXGWWenKaiTC-Regular.ttf`, 25 764 glyphs, ~15 MB) |
| Licence | SIL Open Font License 1.1 — full text in [`OFL.txt`](../fonts/OFL.txt) |

### What is committed here

`lxgw-wenkai-tc.subset.woff2` — a glyph subset of the Regular weight, cut to
exactly the characters the game can render (1,022 of them as of P3, ~287 KB).
The full font is far too large to ship, and the game's vocabulary is bounded,
so `tools/subset-font.py` harvests every character in every file that can put
text on screen and cuts the font to those.

**That list is derived, not maintained.** It used to be a hand-kept `TEXT_GLOBS`
at the top of the script, and that was the whole correctness of the system —
"the check is only as good as the list of places text can live." It went stale
twice. Between P7 and P3 it did not cover the art modules, and 120 glyphs the
game drew on every page silently fell back to system kai while `--check`
reported the subset complete, because the check was asking the same too-narrow
question the build was.

The script now reads the page instead:

```bash
python tools/subset-font.py --sources   # 56 files, 1022 glyphs
```

`index.html` is the only page that loads the subset — `zombiesim.html`,
`battle.html` and `hold.html` are the original sketch pages and use a system
stack — so what the game can render is exactly `index.html` plus the files in
its `<script src>` tags. Add a module and the harvest picks it up when you add
the tag. Forget the tag and `tools/module-manifest.js` fails instead
(`ISSUES.md` #14), so neither half is silent any more.

Files are harvested whole, comments included. That over-covers by a handful of
glyphs — the four in this repo are all in comments — and it buys a rule with no
false negatives and no JavaScript parsing.

The same bytes are also committed as `js/fonts/subset-data.js`, a `data:` URI.
That exists because a `@font-face` whose `src` is a `file://` URL is a
CORS-mode fetch from an opaque origin and browsers refuse it — without the
data URI, a double-clicked `index.html` would silently drop to system kai.
`js/fonts/font.js` tries both and reports which won via `ZS.Fonts.via`.

### Rebuilding

Whenever any harvested file gains new text, new glyphs fall outside the subset
and quietly render in the fallback face. Check with:

```bash
python tools/subset-font.py --check
```

To rebuild:

```bash
python tools/subset-font.py --source assets/fonts/LXGWWenKaiTC-Regular.ttf
```

The source face **is** in the repo, at `assets/fonts/LXGWWenKaiTC-Regular.ttf`
— committed in `ca80a49` along with the menu-track tooling, which appears to
have been incidental rather than intended. This page previously said it was not
committed, and `ISSUES.md` #2 treated "the contributor has to go and fetch
15 MB" as part of the cost of a rebuild. Neither is true: a rebuild is the one
line above. **Whether a 15 MB binary belongs in the history is a separate call
for the maintainer** — it packs to 8.8 MB of a 15.0 MiB pack, so it is well
over half the repository — but while it is there, rebuilding needs no
download.

`test/sanguo-p0.js` runs `--check` as part of the P0 suite, so `npm test`
covers it.
