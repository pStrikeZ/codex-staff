#!/usr/bin/env node
// Generates the codex-staff integration diagram at assets/integration.svg.
// Adapted from the agy-crew generator (agy-staff, MIT, keli-wen).
// Regenerate: node scripts/gen-diagrams.mjs
// Render PNG (Edge headless, 3x): bash scripts/gen_design_png.sh integration
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const INK = '#202124', MUTED = '#5F6368', BORDER = '#DADCE0', BLUE = '#5B5BF0', LINK = '#4338CA',
  PURPLE = '#9B72CB', YELLOW = '#FBBC04', GREEN = '#34A853', RED = '#D93025', LIGHT = '#E8F0FE', BG = '#F8F9FA';
// lane / command colours for the integration diagram
const INDIGO_ICON = '#5B5BF0';
const CLAY = '#D97757', CLAY_DARK = '#B5573A';                      // terracotta: the host agent loop
const GREEN_DARK = '#188038', GREEN_LIGHT = '#E6F4EA';              // launch
const AMBER = '#F29900', AMBER_DARK = '#B06000', AMBER_LIGHT = '#FEF7E0'; // wait (pending)
const PURPLE_DARK = '#6A3AB2', PURPLE_LIGHT = '#F3EDFA';            // observe
const RAINBOW = ['#4F8BFF', '#4F7BFF', '#5B6BF5', '#5B5BF0', '#7557F2', '#8B5CF6', '#A78BFA']; // Codex-style sweep

// ---------- pixel helpers ----------
// bitmap -> merged rects. '.' = empty, anything else = pixel (one colour per call)
function px(bitmap, x, y, u, fill) {
  const rows = bitmap.trim().split('\n').map(r => r.trim());
  const out = [];
  rows.forEach((row, ry) => {
    let cx = 0;
    while (cx < row.length) {
      if (row[cx] === '.') { cx++; continue; }
      const start = cx; while (cx < row.length && row[cx] !== '.') cx++;
      out.push(`<rect x="${x + start * u}" y="${y + ry * u}" width="${(cx - start) * u}" height="${u}"/>`);
    }
  });
  return `<g fill="${fill}" shape-rendering="crispEdges">${out.join('')}</g>`;
}

const LOOP = `
...#####....
..#.....#...
.#.......#..
.#.......###
#........###
#.........#.
#...........
#...........
.#.........#
.#........#.
..#......#..
...######...`;

const PLUG = `
..#...#...
..#...#...
.########.
.########.
.########.
..######..
...####...
....##....
....##....`;

const FLAG = `
#.........
#.##..##..
#...##..##
#.##..##..
#...##..##
#.##..##..
#.........
#.........
#.........`;

const CLOCK = `
...####...
..#....#..
.#......#.
#....#...#
#....#...#
#....##..#
#........#
.#......#.
..#....#..
...####...`;

const CHEVRON = `
#..
.#.
..#
.#.
#..`;

// original pixel icons (not product artwork)
const BLOCK = Array(8).fill('##########').join('\n');
const PROMPT_CUT = `
..........
..........
..#.......
...#......
..#.......
....###...
..........
..........`;
const PI_CUT = `
..........
.#######..
...#..#...
...#..#...
...#..#...
...#..##..
..........
..........`;
function icon(cut, x, y, u, color) { return px(BLOCK, x, y, u, color) + px(cut, x, y, u, '#FFFFFF'); }

// host row (Claude Code + Pi), right-aligned so that the text ends at `right`
function harnessLogos(right, y) {
  const piText = right - 12, piIcon = piText - 28, claudeText = piIcon - 20 - 76, claudeIcon = claudeText - 28;
  return `${icon(PROMPT_CUT, claudeIcon, y + 4, 2, CLAY)}
  <text x="${claudeText}" y="${y + 17}" font-size="12.5" font-weight="600">Claude Code</text>
  ${icon(PI_CUT, piIcon, y + 4, 2, PURPLE)}
  <text x="${piText}" y="${y + 17}" font-size="12.5" font-weight="600">Pi</text>`;
}

// ---------- shared chrome ----------
function shell(W, H, ariaLabel, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${ariaLabel}">
  <style>
    text { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; fill: ${INK}; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .muted { fill: ${MUTED}; }
    .link { fill: ${LINK}; }
    .white { fill: #FFFFFF; }
    .silver { fill: #BDC1C6; }
    .label { font-size: 12px; font-weight: 700; fill: ${LINK}; letter-spacing: 1.5px; }
    .sub { font-size: 12px; fill: ${MUTED}; letter-spacing: 0; font-weight: 400; }
    .arrowlbl { font-size: 11px; font-weight: 700; fill: ${LINK}; }
  </style>
  <defs>
    ${Object.entries({ arrow: LINK, 'arrow-clay': CLAY, 'arrow-green': GREEN, 'arrow-amber': AMBER, 'arrow-purple': PURPLE, 'arrow-ink': INK })
      .map(([id, c]) => `<marker id="${id}" markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="16" refX="11" refY="5.5" orient="auto"><path d="M0,0 L12,5.5 L0,11 Z" fill="${c}"/></marker>`).join('\n    ')}
    <marker id="arrow-start" markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="16" refX="1" refY="5.5" orient="auto"><path d="M12,0 L0,5.5 L12,11 Z" fill="${LINK}"/></marker>
    <linearGradient id="rainbow" x1="0" x2="1" y1="0" y2="0">${RAINBOW.map((c, i) => `<stop offset="${(i / (RAINBOW.length - 1)).toFixed(3)}" stop-color="${c}"/>`).join('')}</linearGradient>
    <linearGradient id="rainbow-soft" x1="0" x2="1" y1="0" y2="0">${RAINBOW.map((c, i) => `<stop offset="${(i / (RAINBOW.length - 1)).toFixed(3)}" stop-color="${c}" stop-opacity="0.2"/>`).join('')}</linearGradient>
    <pattern id="grid" width="18" height="18" patternUnits="userSpaceOnUse"><rect x="8" y="8" width="1.6" height="1.6" fill="${BORDER}"/></pattern>
  </defs>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="8" fill="${BG}" stroke="${INK}" stroke-width="1.5"/>
  <rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="8" fill="url(#grid)"/>
  <g stroke="${BLUE}" stroke-width="1.5" opacity="0.85"><line x1="20" y1="26" x2="32" y2="26"/><line x1="26" y1="20" x2="26" y2="32"/></g>
  <g stroke="${BLUE}" stroke-width="1.5" opacity="0.85"><line x1="888" y1="${H - 26}" x2="900" y2="${H - 26}"/><line x1="894" y1="${H - 32}" x2="894" y2="${H - 20}"/></g>
${body}
</svg>
`;
}

function frame(f, label, sub, stroke = BLUE, labelColor = LINK) {
  return `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="10" fill="#FFFFFF" stroke="${stroke}" stroke-width="1.5"/>
  <text x="${f.x + 14}" y="${f.y + 25}" class="label" style="fill:${labelColor}">${label}<tspan class="sub" dx="7">· ${sub}</tspan></text>`;
}
function card(c, stroke = BORDER, sw = 1.5, dash = '') {
  return `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="8" fill="#FFFFFF" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
}
// a slot in a frame border where a connector passes through
function slot(x, y) {
  return `<g shape-rendering="crispEdges"><rect x="${x - 9}" y="${y - 4}" width="18" height="8" fill="${BG}"/><rect x="${x - 9}" y="${y - 4}" width="5" height="8" fill="${INK}"/><rect x="${x + 4}" y="${y - 4}" width="5" height="8" fill="${INK}"/></g>`;
}
function vline(x, y1, y2, { dash = '', marker = 'arrow', stroke = LINK } = {}) {
  return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${stroke}" stroke-width="1.8"${dash ? ` stroke-dasharray="${dash}"` : ''}${marker ? ` marker-end="url(#${marker})"` : ''}/>`;
}
function fact(iconSvg, x, textX, y, html) {
  return `${iconSvg}<text x="${textX}" y="${y}" font-size="12.5">${html}</text>`;
}

// Integration: a streaming async tool riding a sync tool loop.
function diagramIntegration() {
  const W = 920, H = 632;
  const A = { x: 48, y: 56, w: 824, h: 150 };    // agent loop, unrolled in time   (clay)
  const B = { x: 48, y: 260, w: 824, h: 112 };   // plugin: bash commands           (blue)
  const C = { x: 48, y: 406, w: 824, h: 166 };   // background job + files          (ink + rainbow)
  const cols = [80, 236, 392, 548, 704].map(x => ({ x, w: 136, cx: x + 68 }));
  const T = cols.map(c => ({ x: c.x, y: 96, w: c.w, h: 78, cx: c.cx }));
  const [T1, T2, T3, T4, T5] = T;
  // one colour per command
  const LAUNCH_C = { stroke: GREEN, text: GREEN_DARK, fill: GREEN_LIGHT, marker: 'arrow-green' };
  const WAIT_C = { stroke: AMBER, text: AMBER_DARK, fill: AMBER_LIGHT, marker: 'arrow-amber' };
  const OBS_C = { stroke: PURPLE, text: PURPLE_DARK, fill: PURPLE_LIGHT, marker: 'arrow-purple' };
  const DONE_C = { stroke: INK, text: INK, fill: '#FFFFFF', marker: 'arrow-ink' };

  const turn = (t, head, body, tag) => `${card(t, tag ? CLAY : BORDER, 1.5, tag ? '' : '4 3')}
  ${tag ? `<rect x="${t.x + t.w - 18}" y="${t.y + 10}" width="8" height="8" fill="${tag.stroke}" shape-rendering="crispEdges"/>` : ''}
  <text x="${t.x + 10}" y="${t.y + 18}" font-size="12" font-weight="700" class="mono" style="fill:${tag ? CLAY_DARK : MUTED}">${head}</text>
  ${body.map((l, i) => `<text x="${t.x + 10}" y="${t.y + 36 + i * 14}" font-size="11" class="muted">${l}</text>`).join('')}`;
  const chevron = (x, y) => px(CHEVRON, x - 3, y - 5, 2, CLAY);
  const midY = T1.y + T1.h / 2;
  const lbl = (x, y, txt, col, anchor = 'start') => `<text x="${x}" y="${y}" font-size="10" text-anchor="${anchor}" class="mono" style="fill:${col.text}">${txt}</text>`;

  // lane B chips
  const LAUNCH = { x: T1.x, y: 296, w: T1.w, h: 60 };
  const OBSERVE = { x: T4.x, y: 296, w: T4.w, h: 60 };
  const WAIT = { x: T2.x, y: 312, w: T5.x + T5.w - T2.x, h: 28 };
  const chip = (c, head, body, col) => `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="8" fill="${col.fill}" stroke="${col.stroke}" stroke-width="1.5"/>
  <text x="${c.x + 10}" y="${c.y + 17}" font-size="12" font-weight="700" class="mono" style="fill:${col.text}">${head}</text>
  ${body.map((l, i) => `<text x="${c.x + 10}" y="${c.y + 31 + i * 12.5}" font-size="9.5" class="${l.startsWith('`') ? 'mono' : ''}" style="fill:${INK}">${l.replace(/`/g, '')}</text>`).join('')}`;

  // lane C: files row + worker bar
  const FILES_Y = 444, FILES_H = 44;
  const EVENTS = { x: T2.x, y: FILES_Y, w: T3.x + T3.w - T2.x, h: FILES_H };
  const PROGRESS = { x: T4.x, y: FILES_Y, w: T4.w, h: FILES_H };
  const RESULT = { x: T5.x, y: FILES_Y, w: T5.w, h: FILES_H };
  const fileChip = (c, head, body, stroke = BORDER, fill = '#FFFFFF', headColor = INK) => `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
  <text x="${c.x + 10}" y="${c.y + 17}" font-size="11" font-weight="700" class="mono" style="fill:${headColor}">${head}</text>
  <text x="${c.x + 10}" y="${c.y + 33}" font-size="9.5" class="muted">${body}</text>`;
  const TILE = { x: 104, y: 498, w: 132, h: 44 };
  const BAR = { x: 254, y: 504, w: 586, h: 32 };
  const blips = [];
  for (let x = 560, i = 0; x <= 700; x += 28, i++) {
    const c = RAINBOW[i % RAINBOW.length];
    blips.push(`<rect x="${x}" y="${BAR.y + 12}" width="6" height="6" fill="${c}"/><rect x="${x + 10}" y="${BAR.y + 16}" width="4" height="4" fill="${c}" opacity="0.6"/>`);
  }
  const dots = (x, y1, y2, c) => { const o = []; for (let y = y1; y < y2; y += 5) o.push(`<rect x="${x - 1}" y="${y}" width="2" height="2" fill="${c}"/>`); return `<g shape-rendering="crispEdges">${o.join('')}</g>`; };

  const body = `
  <!-- ===== 01 · AGENT LOOP, unrolled in time (clay) ===== -->
  ${frame(A, '01 · AGENT LOOP', 'host turns over time →', CLAY, CLAY_DARK)}
  ${harnessLogos(A.x + A.w - 20, 64)}
  ${turn(T1, 'Delegate', ['Pick a persona skill.', 'Run its companion', 'command.'], LAUNCH_C)}
  ${chevron(T1.x + T1.w + 10, midY)}
  ${turn(T2, 'Start a wait', ['Use the job ID to', 'wait in background.', 'Continue other work.'], WAIT_C)}
  ${chevron(T2.x + T2.w + 10, midY)}
  ${turn(T3, 'Keep working', ['Use other tools,', 'delegate more work,', 'or talk to the user.'])}
  ${chevron(T3.x + T3.w + 10, midY)}
  ${turn(T4, 'If user asks', ['Observe only on a', 'user progress request.', 'Otherwise wait.'], OBS_C)}
  ${chevron(T4.x + T4.w + 10, midY)}
  ${turn(T5, 'Use the result', ['The wait finishes.', 'The host returns the', 'report to the agent.'], DONE_C)}

  <!-- call / return arrows between the loop and the plugin, coloured per command -->
  ${vline(T1.cx - 20, T1.y + T1.h, LAUNCH.y, { stroke: GREEN, marker: LAUNCH_C.marker })}
  ${vline(T1.cx + 20, LAUNCH.y, T1.y + T1.h, { stroke: GREEN, marker: LAUNCH_C.marker })}
  ${lbl(T1.cx - 26, 238, 'shell', LAUNCH_C, 'end')}
  ${lbl(T1.cx + 26, 238, 'job ID', LAUNCH_C)}
  ${vline(T2.cx, T2.y + T2.h, WAIT.y, { stroke: AMBER, marker: WAIT_C.marker })}
  ${lbl(T2.cx + 8, 238, 'background command', WAIT_C)}
  ${vline(T4.cx - 20, T4.y + T4.h, OBSERVE.y, { stroke: PURPLE, marker: OBS_C.marker })}
  ${vline(T4.cx + 20, OBSERVE.y, T4.y + T4.h, { stroke: PURPLE, marker: OBS_C.marker })}
  ${lbl(T4.cx - 26, 238, 'shell', OBS_C, 'end')}
  ${lbl(T4.cx + 26, 238, 'snapshot ≤ 8 KiB', OBS_C)}
  ${vline(T5.cx, WAIT.y, T5.y + T5.h, { stroke: INK, marker: DONE_C.marker })}
  ${lbl(T5.cx + 8, 238, 'full report', DONE_C)}
  ${[T1.cx - 20, T1.cx + 20, T2.cx, T4.cx - 20, T4.cx + 20, T5.cx].map(x => slot(x, A.y + A.h)).join('')}

  <!-- ===== 02 · PLUGIN: bash commands (blue) ===== -->
  ${frame(B, '02 · CODEX-STAFF', 'skills guide the agent; companion commands manage the job', BLUE, LINK)}
  <rect x="${WAIT.x}" y="${WAIT.y}" width="${WAIT.w}" height="${WAIT.h}" rx="6" fill="${WAIT_C.fill}" stroke="${WAIT_C.stroke}" stroke-width="1.5"/>
  <text x="${WAIT.x + 10}" y="${WAIT.y + 18}" font-size="11" font-weight="700" class="mono" style="fill:${WAIT_C.text}">wait &lt;id&gt; --timeout 10m</text>
  <text x="${T3.x + 6}" y="${WAIT.y + 18}" font-size="10" class="mono" style="fill:${WAIT_C.text}">exit 2: still running</text>
  <text x="${WAIT.x + WAIT.w - 10}" y="${WAIT.y + 18}" text-anchor="end" font-size="10" font-weight="700" class="mono" style="fill:${INK}">prints report</text>
  <text x="${WAIT.x + 10}" y="${B.y + B.h - 8}" font-size="9.5" class="muted">Expiring wait: exit 2, the job keeps running; wait again.</text>
  ${chip(LAUNCH, 'launch', ['`staffer --prompt "…"`', 'Start a background job.', 'Return a job ID.'], LAUNCH_C)}
  ${chip(OBSERVE, 'observe &lt;id&gt;', ['Bounded JSON snapshot:', '≤ 5 recent tools', '+ response excerpt'], OBS_C)}

  <!-- plugin <-> job arrows -->
  ${vline(T1.cx, LAUNCH.y + LAUNCH.h, TILE.y - 6, { stroke: GREEN, marker: LAUNCH_C.marker })}
  ${lbl(T1.cx + 8, 392, 'start worker', LAUNCH_C)}
  ${vline(T4.cx, PROGRESS.y, OBSERVE.y + OBSERVE.h, { stroke: PURPLE, marker: OBS_C.marker })}
  ${lbl(T4.cx + 8, 392, 'observe', OBS_C)}
  ${vline(T5.cx, RESULT.y, WAIT.y + WAIT.h, { stroke: INK, marker: DONE_C.marker })}
  ${lbl(T5.cx + 8, 392, 'on completion', DONE_C)}

  <!-- ===== 03 · BACKGROUND JOB (ink frame, rainbow worker) ===== -->
  ${frame(C, '03 · BACKGROUND JOB', 'runs independently of agent turns', INK, INK)}
  ${fileChip(EVENTS, 'Event log', 'Raw Codex JSONL · &lt;id&gt;.events.jsonl')}
  ${fileChip(PROGRESS, 'Progress', '&lt;id&gt;.progress.json', PURPLE, PURPLE_LIGHT, PURPLE_DARK)}
  ${fileChip(RESULT, 'Final report', '&lt;id&gt;.result.md', INK, '#FFFFFF', INK)}
  ${dots(T2.cx + 74, FILES_Y + FILES_H + 2, BAR.y, MUTED)}${dots(T4.cx, FILES_Y + FILES_H + 2, BAR.y, PURPLE)}${dots(T5.cx, FILES_Y + FILES_H + 2, BAR.y, INK)}
  <rect x="${BAR.x}" y="${BAR.y}" width="${BAR.w}" height="${BAR.h}" rx="6" fill="url(#rainbow-soft)" stroke="url(#rainbow)" stroke-width="1.5"/>
  <text x="${BAR.x + 12}" y="${BAR.y + 20}" font-size="10.5" class="mono" style="fill:${INK}">Worker · drains codex exec --json</text>
  <g shape-rendering="crispEdges">${blips.join('')}</g>
  ${px(FLAG, 806, BAR.y + 7, 2, INK)}
  <rect x="${TILE.x}" y="${TILE.y}" width="${TILE.w}" height="${TILE.h}" rx="6" fill="${INK}"/>
  ${icon(PROMPT_CUT, TILE.x + 10, TILE.y + 10, 3, INDIGO_ICON)}
  <text x="${TILE.x + 48}" y="${TILE.y + 18}" font-size="11" font-weight="700" class="mono white">Codex CLI</text>
  <text x="${TILE.x + 48}" y="${TILE.y + 32}" font-size="9" class="silver">exec --json</text>
  <text x="${BAR.x + 12}" y="${BAR.y + 50}" font-size="9.5" class="muted">Worker deadline: 60m default, 120m max (ask: 2m). Wait expiry leaves it running; cancel &lt;id&gt; stops the job.</text>

  <!-- Three equal footer columns; icons sit in 24px slots with an 8px text gap. -->
  ${fact(px(LOOP, 64, 590, 2, CLAY), 64, 96, 607, 'Delegate, then keep working')}
  ${fact(px(CLOCK, 340, 592, 2, AMBER), 338, 370, 607, 'Resume threads with continue')}
  ${px(PLUG, 615, 592, 2, LINK)}<text x="644" y="607" font-size="12.5"><tspan font-weight="700" fill="${LINK}">Skills + companion cmds</tspan></text>`;

  return shell(W, H, 'codex-staff exposes Codex CLI as a background worker through persona skills and ordinary companion commands. The host agent (Claude Code or Pi) delegates a task, receives a job ID, and waits for it in the background while it keeps working; only an explicit user progress question triggers a bounded snapshot of at most 8 KiB with up to five recent tools. The worker drains the codex exec --json event stream, writes events and progress files, and saves a final report that wait prints. An expiring wait exits with code 2 and leaves execution running. The worker enforces a separate deadline, 60 minutes by default and 120 at most, and 2 minutes for ask.', body);
}

// Keep the optional integration argument compatible with earlier regeneration commands.
const selected = process.argv.slice(2);
if (selected.length > 1 || (selected.length === 1 && selected[0] !== 'integration')) {
  throw new Error('Usage: node scripts/gen-diagrams.mjs [integration]');
}
const svg = diagramIntegration().replace(/[ \t]+$/gm, '');
fs.writeFileSync(path.join(ROOT, 'assets/integration.svg'), svg);
console.log('wrote assets/integration.svg', svg.length, 'bytes');
