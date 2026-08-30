#!/usr/bin/env python3
"""Build the brush-kai glyph subset the game ships (docs/SANGUO-DESIGN.md §6.3).

Dev tooling, same category as oxfmt/oxlint — it is NOT part of running the
game. Run it whenever any file index.html loads gains new text.

    python tools/subset-font.py --source path/to/LXGWWenKaiTC-Regular.ttf

Face: LXGW WenKai TC (霞鶩文楷), SIL Open Font License 1.1
      https://github.com/lxgw/LxgwWenkaiTC/releases

Outputs
  fonts/lxgw-wenkai-tc.subset.woff2   the asset (used when served over http)
  js/fonts/subset-data.js             the same bytes as a data: URI, so the
                                      page still gets real kai when it is
                                      double-clicked (file:// refuses a
                                      CORS-mode @font-face fetch)

The character set is harvested from index.html and every script it loads, so
the subset tracks the game's actual vocabulary instead of a hand-kept list of
where text is allowed to live (ISSUES.md #2). `--sources` prints that list.
"""

from __future__ import annotations

import argparse
import base64
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# This script prints Han characters (the missing-glyph report). A Windows
# console defaults to cp1252 and would raise UnicodeEncodeError mid-report.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

# Every file that may contain player-visible text — derived, not listed.
#
# ISSUES.md #2: this used to be a hand-kept TEXT_GLOBS, and "the check is only
# as good as the list of places text can live" was the whole hazard. It went
# stale twice. Between P7 and P3 it did not cover the art modules, and 120
# glyphs the game drew on every page fell back to system kai while --check
# cheerfully reported the subset complete, because the check was asking the
# same too-narrow question the build was.
#
# The list is now read from the page itself. index.html is the only page that
# loads the subset (the other three are the original sketch pages and use a
# system stack), so what it can render is exactly index.html plus the files in
# its <script src> tags. Add a module and the harvest picks it up when you add
# the tag; forget the tag and tools/module-manifest.js fails instead.
#
# Files are harvested whole, comments included. That over-covers by a handful
# of glyphs — the four in this repo are all in comments — and it is worth it
# for a rule with no false negatives and no parsing.
PAGE = "index.html"

# Generated, and its header comment would feed its own next build.
EXCLUDE = {"js/fonts/subset-data.js"}

_SCRIPT_SRC = re.compile(r"""<script[^>]*\ssrc=["']([^"']+)["']""")


def sources() -> list[pathlib.Path]:
    """index.html and every local script it loads, in load order."""
    page = ROOT / PAGE
    html = page.read_text(encoding="utf-8")
    out = [page]
    for m in _SCRIPT_SRC.finditer(html):
        rel = m.group(1)
        if re.match(r"^[a-z]+://", rel) or rel in EXCLUDE:
            continue
        path = ROOT / rel
        if path.exists():
            out.append(path)
    return out


# Always present regardless of what the tables happen to use today.
ALWAYS = (
    "".join(chr(c) for c in range(0x20, 0x7F))
    + "0123456789"
    + "·—…、。，；：？！「」『』（）〈〉《》〇"
    + "年月日春夏秋冬回合金糧兵將軍城"
)


def harvest() -> set[str]:
    chars: set[str] = set(ALWAYS)
    files = sources()
    if len(files) < 2:
        sys.exit("no text sources matched; run this from the repo root")
    for path in files:
        chars.update(path.read_text(encoding="utf-8"))
    # Control characters are not glyphs.
    return {c for c in chars if c.isprintable()}


def check(out: pathlib.Path) -> int:
    """Fail if the game's text needs a glyph the built subset does not carry.

    §6.3 wants this: an out-of-subset glyph silently falls back to system kai,
    and we want to know. Run it after touching any file index.html loads; it
    needs only the built subset, not the source font.
    """
    from fontTools.ttLib import TTFont  # noqa: PLC0415

    if not out.exists():
        sys.exit(f"no subset at {out} — build it first")
    covered: set[int] = set()
    for table in TTFont(out, lazy=True)["cmap"].tables:
        covered.update(table.cmap.keys())
    missing = sorted(c for c in harvest() if ord(c) not in covered)
    if missing:
        print(f"MISSING {len(missing)} glyph(s) from {out.name}: {''.join(missing)}")
        print("rebuild:  python tools/subset-font.py --source <LXGWWenKaiTC-Regular.ttf>")
        return 1
    print(f"subset covers all {len(harvest())} glyphs the game can render")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--source",
        help="path to the full LXGWWenKaiTC-Regular.ttf (OFL 1.1); required unless --check",
    )
    ap.add_argument(
        "--check",
        action="store_true",
        help="verify the existing subset covers every glyph the game uses, and stop",
    )
    ap.add_argument(
        "--sources",
        action="store_true",
        help="print the files the harvest reads (derived from index.html), and stop",
    )
    ap.add_argument("--out", default="fonts/lxgw-wenkai-tc.subset.woff2")
    ap.add_argument("--data-js", default="js/fonts/subset-data.js")
    args = ap.parse_args()

    if args.sources:
        files = sources()
        for p in files:
            print(p.relative_to(ROOT).as_posix())
        print(f"{len(files)} files, {len(harvest())} glyphs")
        return 0

    try:
        from fontTools import subset  # noqa: PLC0415
    except ImportError:
        sys.exit("missing dependency: pip install 'fonttools[woff]' brotli")

    if args.check:
        return check(ROOT / args.out)
    if not args.source:
        sys.exit("--source is required unless --check is given")

    src = pathlib.Path(args.source)
    if not src.exists():
        sys.exit(f"source font not found: {src}")

    chars = harvest()
    text = "".join(sorted(chars))
    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)

    print(f"subsetting {len(chars)} glyphs from {src.name}")
    subset.main(
        [
            str(src),
            f"--text={text}",
            "--flavor=woff2",
            "--layout-features=kern,liga,vert,vrt2",
            "--no-hinting",
            "--desubroutinize",
            f"--output-file={out}",
        ]
    )

    blob = out.read_bytes()
    kb = len(blob) / 1024
    print(f"wrote {out.relative_to(ROOT)} ({kb:.0f} KB)")

    data_url = "data:font/woff2;base64," + base64.b64encode(blob).decode("ascii")
    js = ROOT / args.data_js
    js.parent.mkdir(parents=True, exist_ok=True)
    js.write_text(
        "/* GENERATED by tools/subset-font.py — do not edit.\n"
        "   LXGW WenKai TC (霞鶩文楷), SIL Open Font License 1.1.\n"
        f"   Subset of {len(chars)} glyphs, {kb:.0f} KB woff2, as a data: URI so the\n"
        "   page gets real kai when double-clicked (file:// refuses a CORS-mode\n"
        "   @font-face fetch). See docs/SANGUO-DESIGN.md §6.3. */\n"
        "(() => {\n"
        '  "use strict";\n'
        "  const ZS = (window.ZS = window.ZS || {});\n"
        # Wrapped exactly as oxfmt wants it: the generated file lives under
        # js/, so `npm run format` would otherwise rewrite it every rebuild.
        "  ZS.FONT_DATA_URL =\n"
        f'    "{data_url}";\n'
        "})();\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"wrote {js.relative_to(ROOT)} ({len(data_url) / 1024:.0f} KB base64)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
