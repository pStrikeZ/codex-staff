#!/usr/bin/env python3
"""Generate the pixel wordmark assets/logo/codex-staff.svg.

CODEX carries a blue -> indigo -> violet sweep per pixel column, the hyphen
becomes a terminal prompt glyph (>_), STAFF is theme-flipping ink. Built on
the bitmap machinery of scripts/gen_badges.py (5x7 glyph font, merged rect
runs, hard shadow), adapted from agy-staff / agy-crew (MIT, keli-wen).

Light/dark GitHub: ink and shadow flip via a prefers-color-scheme media
query inside the SVG; the gradient hues hold on both. Deterministic, stdlib
only. Run from anywhere: `python3 scripts/gen_logo.py`.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from gen_badges import INK, _glyph, _prects, _pw, _rects_svg, _runs  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "logo"

FIRST, SECOND = "CODEX", "STAFF"
PROMPT = (
    "......",
    "X.....",
    ".X....",
    "..X...",
    ".X....",
    "X.....",
    "..XXX.",
)
PROMPT_COLOR = "#5B5BF0"
# Codex-like sweep, one stop per band of glyph columns
STOPS = ("#4F8BFF", "#4F7BFF", "#5B6BF5", "#5B5BF0", "#7557F2", "#8B5CF6")

STYLE = ("<style>.ink{fill:%s}.sh{fill:#BDC1C6}"
         "@media (prefers-color-scheme:dark){.ink{fill:#E8EAED}"
         ".sh{fill:#3C4043}}</style>" % INK)


def sweep(x, y, text, u):
    cols = sum(len(_glyph(ch)[0]) + 1 for ch in text) - 1
    by = {}
    col, cx = 0, x
    for ch in text:
        g = _glyph(ch)
        for r, row in enumerate(g):
            for c, bit in enumerate(row):
                if bit == "X":
                    stop = STOPS[min((col + c) * len(STOPS) // cols,
                                     len(STOPS) - 1)]
                    by.setdefault(stop, []).append(
                        '<rect x="{}" y="{}" width="{}" height="{}"/>'.format(
                            cx + c * u, y + r * u, u, u))
        cx += (len(g[0]) + 1) * u
        col += len(g[0]) + 1
    return "".join('<g fill="{}">{}</g>'.format(k, "".join(v))
                   for k, v in sorted(by.items()))


def logo():
    u, sh, pad = 8, 3, 8
    y = pad
    w1 = _pw(FIRST, u)
    pw = (len(PROMPT[0]) + 1) * u
    px = pad + w1 + 2 * u
    sx = px + pw + 2 * u
    total = sx - pad + _pw(SECOND, u)
    shadow = _prects(pad, y, FIRST, u) + _prects(sx, y, SECOND, u) + _runs(
        PROMPT, px, y, u)
    body = '<g class="sh" transform="translate({0},{0})">{1}</g>'.format(
        sh, _rects_svg(shadow))
    body += sweep(pad, y, FIRST, u)
    body += '<g fill="{}">{}</g>'.format(PROMPT_COLOR,
                                         _rects_svg(_runs(PROMPT, px, y, u)))
    body += '<g class="ink">{}</g>'.format(_rects_svg(_prects(sx, y, SECOND, u)))
    W, H = pad * 2 + total + sh, pad * 2 + 7 * u + sh
    aria = "CODEX-STAFF pixel wordmark with a terminal prompt"
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
            'viewBox="0 0 {W} {H}" role="img" aria-label="{a}"><title>{a}'
            '</title>{s}<g shape-rendering="crispEdges">{b}</g></svg>\n'
            ).format(W=W, H=H, a=aria, s=STYLE, b=body)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "codex-staff.svg"
    path.write_text(logo())
    print("wrote", path)


if __name__ == "__main__":
    main()
