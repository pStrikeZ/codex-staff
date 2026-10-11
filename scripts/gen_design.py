#!/usr/bin/env python3
"""Generate assets/design.svg (host agents -> codex-staff worker panel).

Style adapted from the hand-written agy-crew design diagram (agy-staff /
agy-crew, MIT, keli-wen): dotted background, pixel sprites, ID card. The
host icons are original pixel sprites, not product artwork.
Render the PNG with scripts/gen_design_png.sh. Stdlib only.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from gen_badges import _prects, _rects_svg, _runs  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "design.svg"

INK, MUTED, BORDER = "#202124", "#5F6368", "#DADCE0"
BLUE, INDIGO, VIOLET = "#4F7BFF", "#5B5BF0", "#8B5CF6"
TINT = "#EEF0FF"
CLAY, GREEN, RED = "#D97757", "#34A853", "#D93025"


def spr(rows, x, y, u, fill):
    return '<g fill="{}" shape-rendering="crispEdges">{}</g>'.format(
        fill, _rects_svg(_runs(rows, x, y, u)))


def text_px(x, y, s, u, fill):
    return '<g fill="{}" shape-rendering="crispEdges">{}</g>'.format(
        fill, _rects_svg(_prects(x, y, s, u)))


BLOCK = ["XXXXXXXXXX"] * 8
PROMPT_CUT = ["..........", "..........", "..X.......", "...X......",
              "..X.......", "....XXX...", "..........", ".........."]
PI_CUT = ["..........", ".XXXXXXX..", "...X..X...", "...X..X...",
          "...X..X...", "...X..XX..", "..........", ".........."]
PERSON = ["..XX..", ".XXXX.", ".XXXX.", "..XX..", "XXXXXX", "XXXXXX"]
MAGN = [".XXX....", "X...X...", "X...X...", "X...X...", ".XXXX...",
        ".....XX.", "......XX"]
CHECK = ["......XX", ".....XX.", "X...XX..", "XX.XX...", ".XXX....", "..X....."]
CODE = ["..X...X..", ".X.....X.", "X.......X", ".X.....X.", "..X...X.."]
LEAD = ["X.........", "XXXXXXX...", "XXXXXXXXX.", "XXXXXXXXX.", "XXXXXXX...", "X........."]
SHIELD = [".XXXXXXXX.", "XXXXXXXXXX", "XXXXXXXXXX", "XXXXXXXXXX", ".XXXXXXXX.",
          "..XXXXXX..", "...XXXX..."]
JOBS = ["XXXXXXXXXXXX", "X..........X", "X.XXXXXXXX.X", "X..........X",
        "X.XXXXXX...X", "XXXXXXXXXXXX"]


def persona(x, y, name, desc, sprite, color, border=BORDER, bw=1.5, dcolor=MUTED):
    return ('<rect x="{x}" y="{y}" width="216" height="58" rx="8" fill="#FFFFFF" '
            'stroke="{b}" stroke-width="{bw}"/>{s}'
            '<text x="{tx}" y="{ty}" font-size="15" font-weight="700" class="mono">{n}'
            '<tspan x="{tx}" dy="18" font-size="11" font-weight="400" fill="{dc}" '
            'class="sans">{d}</tspan></text>').format(
        x=x, y=y, b=border, bw=bw, n=name, d=desc, dc=dcolor,
        tx=x + 52, ty=y + 25, s=spr(sprite, x + 16, y + 19, 3, color))


def id_card():
    p = []
    a = p.append
    a('<g transform="translate(406,68) scale(0.72)" shape-rendering="crispEdges">')
    a('<rect fill="#202124" x="115" y="4" width="26" height="22"/>'
      '<rect fill="#BDC1C6" x="121" y="9" width="14" height="5"/>')
    a('<path fill="#BDC1C6" d="M25,25 H237 V30 H242 V35 H247 V147 H242 V152 H237 V157 H25 V152 H20 V147 H15 V35 H20 V30 H25 Z"/>')
    a('<path fill="#202124" d="M22,22 H234 V27 H239 V32 H244 V144 H239 V149 H234 V154 H22 V149 H17 V144 H12 V32 H17 V27 H22 Z"/>')
    a('<path fill="#FFFFFF" d="M24,24 H232 V29 H237 V34 H242 V142 H237 V147 H232 V152 H24 V147 H19 V142 H14 V34 H19 V29 H24 Z"/>')
    a('<rect fill="{}" x="20" y="30" width="72" height="10"/><rect fill="{}" x="92" y="30" width="72" height="10"/><rect fill="{}" x="164" y="30" width="72" height="10"/>'.format(BLUE, INDIGO, VIOLET))
    a('<rect fill="#FFFFFF" x="117" y="32" width="22" height="6"/>')
    a('<rect fill="{}" x="24" y="52" width="52" height="52"/>'.format(TINT))
    a(spr(PROMPT_CUT, 32, 56, 4, INDIGO))
    a(text_px(88, 52, "CODEX-STAFF", 2, INK))
    a(text_px(88, 72, "WORKER", 2, INDIGO))
    bx = 88
    for ch in "CODEXSTAFF" * 2:
        wbar = 2 + (ord(ch) % 3) * 2
        if bx + wbar > 226:
            break
        a('<rect fill="#202124" x="{}" y="98" width="{}" height="24"/>'.format(bx, wbar))
        bx += wbar + 3
    a("</g>")
    return "".join(p)


def build():
    o = []
    a = o.append
    aria = ("codex-staff: Claude Code (/codex-staff:*) and Pi (/skill:codex-*) delegate work to "
            "Codex CLI running as a background worker through codex exec --json. Four persona "
            "workers: staffer for general tasks, researcher for evidence-backed research with "
            "explicit uncertainty, reviewer for code, plan or decision review, implementer for "
            "scoped changes with verification. /codex-staff:lead lets the host agent orchestrate "
            "an ongoing task with Codex. Unrestricted by default with a sandbox on request, "
            "inherits your Codex model and reasoning settings, resumable threads and persistent "
            "jobs.")
    a('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 448" role="img" aria-label="{}">'.format(aria))
    a('''<style>
text { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; fill: #202124; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.sans { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.muted { fill: #5F6368; }
</style>
<defs>
<marker id="arrow" markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="16" refX="11" refY="5.5" orient="auto"><path d="M0,0 L12,5.5 L0,11 Z" fill="#4338CA"/></marker>
<pattern id="grid" width="18" height="18" patternUnits="userSpaceOnUse"><rect x="8" y="8" width="1.6" height="1.6" fill="#DADCE0"/></pattern>
</defs>
<rect x="1" y="1" width="918" height="446" rx="8" fill="#F8F9FA" stroke="#202124" stroke-width="1.5"/>
<rect x="2" y="2" width="916" height="444" rx="8" fill="url(#grid)"/>
<g stroke="#5B5BF0" stroke-width="1.5" opacity="0.85"><line x1="20" y1="26" x2="32" y2="26"/><line x1="26" y1="20" x2="26" y2="32"/></g>
<g stroke="#5B5BF0" stroke-width="1.5" opacity="0.85"><line x1="888" y1="422" x2="900" y2="422"/><line x1="894" y1="416" x2="894" y2="428"/></g>''')
    # left column
    a('<text x="48" y="118" font-size="13" font-weight="700" fill="#4338CA" letter-spacing="1.5">SENIOR AGENTS</text>')
    a('<text x="48" y="137" font-size="12.5" class="muted">your host agents</text>')
    for y, name, sub, cut, col in ((152, "Claude Code", "/codex-staff:&lt;persona&gt;", PROMPT_CUT, CLAY),
                                   (226, "Pi", "/skill:codex-&lt;persona&gt;", PI_CUT, VIOLET)):
        a('<rect x="48" y="{}" width="210" height="62" rx="8" fill="#FFFFFF" stroke="#DADCE0" stroke-width="1.5"/>'.format(y))
        a(spr(BLOCK, 64, y + 19, 3, col))
        a(spr(cut, 64, y + 19, 3, "#FFFFFF"))
        a('<text x="108" y="{}" font-size="15.5" font-weight="600">{}</text>'.format(y + 28, name))
        a('<text x="108" y="{}" font-size="10" class="mono muted">{}</text>'.format(y + 45, sub))
    a('<text x="313" y="188" font-size="12.5" text-anchor="middle" class="muted">delegate via'
      '<tspan x="313" dy="19" class="mono" font-size="13" font-weight="700" fill="#4338CA">/codex-staff:*</tspan></text>')
    a('<line x1="264" y1="220" x2="352" y2="220" stroke="#4338CA" stroke-width="1.8" stroke-dasharray="7 5" marker-end="url(#arrow)"/>')
    a('<g shape-rendering="crispEdges"><rect x="272" y="228" width="5" height="5" fill="{}"/><rect x="286" y="232" width="5" height="5" fill="{}"/><rect x="300" y="228" width="5" height="5" fill="{}"/></g>'.format(BLUE, INDIGO, VIOLET))
    a('<g stroke="#5F6368" stroke-width="1"><line x1="48" y1="311" x2="258" y2="311"/><line x1="48" y1="306" x2="48" y2="316"/><line x1="258" y1="306" x2="258" y2="316"/></g>')
    a('<rect x="66" y="300" width="174" height="22" rx="4" fill="{}"/>'.format(TINT))
    a(spr(LEAD, 74, 305, 2, INDIGO))
    a('<text x="96" y="315" font-size="12.5" font-weight="700" fill="#4338CA" class="mono">/codex-staff:lead</text>')
    a('<text x="153" y="338" font-size="11" text-anchor="middle" class="muted">task orchestration with Codex</text>')
    # worker panel
    a('<rect x="388" y="56" width="484" height="292" rx="10" fill="#FFFFFF" stroke="#5B5BF0" stroke-width="1.5"/>')
    a('<g shape-rendering="crispEdges"><rect x="826" y="72" width="8" height="8" fill="{}"/><rect x="836" y="80" width="8" height="8" fill="{}"/><rect x="846" y="88" width="8" height="8" fill="{}"/></g>'.format(BLUE, INDIGO, VIOLET))
    a(id_card())
    a('<text x="608" y="102" font-size="24" font-weight="700">codex staff</text>')
    a('<text x="608" y="124" font-size="12" class="mono muted">Codex CLI &#183; codex exec --json</text>')
    a('<rect x="608" y="138" width="248" height="22" rx="4" fill="{}"/>'.format(TINT))
    a('<text x="732" y="153" font-size="9.5" font-weight="700" fill="#4338CA" letter-spacing="1.0" text-anchor="middle">THE THOROUGH WORKER &#183; STAFF #001</text>')
    a('<path d="M608,170 q 32,4 64,1.2 t 64,-0.4" fill="none" stroke="{}" stroke-width="1.6" stroke-linecap="round" opacity="0.9"/>'.format(VIOLET))
    a(persona(412, 196, "staffer", "general task &#183; minimal brief", PERSON, BLUE))
    a(persona(640, 196, "researcher", "evidence &#183; explicit uncertainty", MAGN, GREEN))
    a(persona(412, 266, "reviewer", "code, plan or decision review", CHECK, VIOLET))
    a(persona(640, 266, "implementer", "scoped change &#183; verification", CODE, RED, RED, 1.8, RED))
    # footer
    a('<g stroke="#5F6368" stroke-width="1"><line x1="388" y1="362" x2="872" y2="362"/><line x1="388" y1="357" x2="388" y2="367"/><line x1="872" y1="357" x2="872" y2="367"/></g>')
    a('<rect x="468" y="354" width="324" height="15" fill="#F8F9FA"/>')
    a('<text x="630" y="366" font-size="10.5" text-anchor="middle" class="mono muted">background jobs &#183; wait / observe / cancel</text>')
    a(spr(SHIELD, 44, 398, 2, RED))
    a('<g shape-rendering="crispEdges"><rect x="326" y="406" width="5" height="5" fill="{}"/><rect x="331" y="402" width="5" height="5" fill="{}"/><rect x="336" y="398" width="5" height="5" fill="{}"/></g>'.format(BLUE, INDIGO, VIOLET))
    a(spr(JOBS, 616, 399, 2, INDIGO))
    a('<text x="68" y="412" font-size="12"><tspan font-weight="700" fill="#D93025">unrestricted</tspan> by default &#183; sandbox on request</text>')
    a('<text x="348" y="412" font-size="12">inherits your Codex model &amp; reasoning</text>')
    a('<text x="644" y="412" font-size="12">resumable threads &#183; persistent jobs</text>')
    a("</svg>")
    return "\n".join(o) + "\n"


if __name__ == "__main__":
    OUT.write_text(build(), encoding="utf-8")
    print("wrote", OUT)
