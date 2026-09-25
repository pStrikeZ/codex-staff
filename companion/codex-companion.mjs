#!/usr/bin/env node
// codex-staff companion: task dispatch, durable job state and result collection.
// Adapted from agy-staff; see NOTICE and LICENSE.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { codexCommand, codexArgs, validateReview } from './codex.mjs';
import { boundSnapshot, excerpt } from './observation.mjs';
import { atomicJSON, runStreaming, processIdentity } from './stream-worker.mjs';
import { withStateLock, replaceFile, readTextRetry } from './state-lock.mjs';

const SELF = fileURLToPath(import.meta.url);
const TEMPLATES_DIR = path.join(path.dirname(SELF), '..', 'templates');

const MODES = ['staffer', 'research', 'review', 'implement', 'ask'];
const DEFAULTS = {
  profile: { staffer: 'unrestricted', research: 'unrestricted', review: 'unrestricted', implement: 'unrestricted', ask: 'restricted' },
  timeout: { staffer: '60m', research: '60m', review: '60m', implement: '60m', ask: '2m' },
  background: { staffer: true, research: true, review: true, implement: true, ask: false },
};
const MAX_PROMPT_BYTES = 2 * 1024 * 1024;
const MAX_DIRTY_STATUS_LINES = 100;
const MAX_DIRTY_STATUS_BYTES = 16 * 1024;
const REVIEW_SCHEMA = path.join(TEMPLATES_DIR, 'review.schema.json');

// ---------------------------------------------------------------------------
// small utils
// ---------------------------------------------------------------------------

let inWorker = false;
function die(msg, code = 1) {
  if (inWorker) throw new Error(msg);
  process.stderr.write(`codex-staff error: ${msg}\n`);
  throw Object.assign(new Error(msg), { exitCode: code, alreadyPrinted: true });
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...opts });
  return { code: r.status ?? -1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

const repoRootCache = new Map();
function repoRoot() {
  const cwd = process.cwd();
  if (repoRootCache.has(cwd)) return repoRootCache.get(cwd);
  const r = sh('git', ['rev-parse', '--show-toplevel']);
  // git prints forward slashes even on Windows; normalize so the root compares
  // equal to process.cwd()-derived paths and reads naturally in codex arguments.
  const root = r.code === 0 && r.out ? path.normalize(r.out) : cwd;
  repoRootCache.set(cwd, root);
  return root;
}

function stateDir() {
  return path.join(repoRoot(), '.codex-staff');
}

function statePath() {
  return path.join(stateDir(), 'state.json');
}

function configPath() {
  return path.join(stateDir(), 'config.json');
}

// Modes whose default profile can be set per repo. ask uses a read-only sandbox and
// always restricted, so it is not configurable.
const CONFIGURABLE_MODES = ['staffer', 'research', 'review', 'implement'];

/** Project policy (per-repo default profiles), written by `setup --restrict`.
 *  Missing file → null. Invalid file → die: a policy that is silently ignored
 *  is worse than an error. */
function loadProjectConfig() {
  let raw;
  try {
    raw = fs.readFileSync(configPath(), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    die(`cannot read project config: ${error.message}`);
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch {
    die(`project config is corrupt: ${configPath()} — fix or delete it, then retry`);
  }
  for (const [m, p] of Object.entries(cfg.profiles || {})) {
    if (!CONFIGURABLE_MODES.includes(m)) {
      die(
        `project config: unknown mode "${m}" in ${configPath()} ` +
          `(configurable: ${CONFIGURABLE_MODES.join(', ')}; ask is always restricted)`
      );
    }
    if (p !== 'restricted' && p !== 'unrestricted') {
      die(`project config: profile for ${m} must be "restricted" or "unrestricted", got "${p}" (${configPath()})`);
    }
  }
  return cfg;
}

/** Create .codex-staff/ on first use and keep it out of `git status`.
 *  .git/info/exclude is repo-local and untracked — never the team's
 *  .gitignore. Best-effort: a read-only .git must not block a run. */
function ensureStateDir() {
  const dir = stateDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    if (sh('git', ['check-ignore', '-q', dir]).code !== 0) {
      const p = sh('git', ['rev-parse', '--git-path', 'info/exclude']);
      if (p.code === 0 && p.out) {
        try {
          fs.appendFileSync(path.resolve(p.out), '.codex-staff/\n');
        } catch {}
      }
    }
  }
  return dir;
}

function loadState() {
  let raw;
  try {
    raw = readTextRetry(statePath());
  } catch (error) {
    // Only a missing file means "no state yet". Anything else must not be
    // mistaken for an empty state: callers write it back and would wipe jobs.
    if (error.code === 'ENOENT') return { conversations: {}, last: null, jobs: [] };
    die(`cannot read state file ${statePath()}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    // Never silently reset: every caller writes the state back, which would
    // wipe all job records and conversation ids.
    die(`state file is corrupt: ${statePath()} — fix or delete it, then retry`);
  }
}

function saveState(state) {
  ensureStateDir();
  // Atomic replace: a detached worker and a status/result call can read this
  // file at any moment; a plain truncate-then-write leaves a torn window.
  const tmp = statePath() + `.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  replaceFile(tmp, statePath());
}

function updateState(change) {
  ensureStateDir();
  return withStateLock(statePath() + '.lock', () => {
    const state = loadState();
    const value = change(state);
    saveState(state);
    return value;
  });
}

function updateJob(id, fields, terminal = false) {
  return updateState((state) => {
    const job = state.jobs?.find((j) => j.id === id);
    if (!job) throw new Error(`Missing job ${id}`);
    if (terminal && job.status !== 'running') return job;
    Object.assign(job, fields);
    return job;
  });
}

function finishJob(id, output, fields) {
  return updateState((state) => {
    const job = state.jobs?.find((j) => j.id === id);
    if (!job) throw new Error(`Missing job ${id}`);
    if (typeof fields === 'function') fields = fields(job);
    if (job.status !== 'running' && !(job.status === 'canceled' && fields.status === 'canceled')) return job;
    if (job.cancel_requested_at && fields.status !== 'canceled') throw Object.assign(new Error('Execution canceled.'), { reason: 'canceled' });
    const final = { ...fields, finished_at: new Date().toISOString() };
    const completed = { ...job, ...final };
    fs.writeFileSync(job.result_file, typeof output === 'function' ? output(completed) : output);
    atomicJSON(job.result_file + '.status.json', final);
    Object.assign(job, final);
    return job;
  });
}

function rememberConversation(resolved, id, jobId) {
  if (!id) return;
  updateState((state) => {
    state.conversations ||= {};
    state.conversations[resolved.mode] = id;
    state.last = { mode: resolved.mode, id, model: resolved.model, effort: resolved.effort, profile: resolved.profile };
    state.conversation_configs ||= {};
    state.conversation_configs[id] = { mode: resolved.mode, model: resolved.model, effort: resolved.effort,
      profile: resolved.profile, cwd: process.cwd() };
    const job = state.jobs?.find((j) => j.id === jobId);
    if (job) job.conversation_id = id;
  });
}

function pidAlive(pid) {
  if (pid == null) return true; // registered, pid backfill pending — treat as running
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

const VALUE_FLAGS = new Set(['job', 'conversation', 'model', 'effort', 'timeout', 'restrict', 'prompt', 'prompt-file']);
const BOOL_FLAGS = new Set(['continue', 'restricted', 'unrestricted', 'json', 'stdin']);

function checkValue(name, v) {
  if (v === undefined || v === '') die(`flag --${name} needs a value`);
  if (!v.startsWith('--')) return;
  if (name === 'prompt') {
    if (/\s/.test(v)) return;
    die(
      `flag --prompt needs a value (if your prompt really starts with --, ` +
        `quote the full sentence or use --prompt-file)`
    );
  }
  die(`flag --${name} needs a value`);
}

/**
 * Parse the shell's argv once. Values are taken verbatim: nothing is re-split,
 * no quotes are interpreted, no byte of a value is inspected for flags.
 *
 * `taskCommand` only changes what a positional means. Run commands take their
 * task from --prompt/--prompt-file/--stdin, so a positional there is a caller
 * mistake and dies loudly. Management commands (status/wait/result/cancel/
 * setup) keep collecting positionals as ids and values.
 */
function parseFlags(argv, { taskCommand = false } = {}) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      let name = t.slice(2);
      if (VALUE_FLAGS.has(name)) {
        const v = argv[++i];
        checkValue(name, v);
        opts[name] = v;
      } else if (BOOL_FLAGS.has(name)) {
        opts[name] = true;

      } else {
        die(`unknown flag --${name}`);
      }
    } else if (taskCommand) {
      die(
        `positional task text was removed; pass the task with --prompt <text>, ` +
          `--prompt-file <path>, or --stdin`
      );
    } else {
      opts._.push(t);
    }
  }
  return opts;
}

function fmtTokens(usage) {
  if (!usage) return 'n/a';
  const parts = [`in ${usage.input_tokens ?? '?'}`, `out ${usage.output_tokens ?? '?'}`];
  if (usage.reasoning_output_tokens) parts.push(`think ${usage.reasoning_output_tokens}`);
  if (usage.cached_input_tokens) parts.push(`cache ${usage.cached_input_tokens}`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// prompt building
// ---------------------------------------------------------------------------

function fillTemplate(mode, vars) {
  const file = path.join(TEMPLATES_DIR, `${mode}.md`);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    die(`template not found: ${file}`);
  }
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function gatherContext() {
  const branch = sh('git', ['branch', '--show-current']).out || '(no git branch)';
  return [
    `Working directory: ${process.cwd()}`,
    `Git branch: ${branch}`,
    `Date: ${new Date().toISOString().slice(0, 10)}`,
  ].join('\n');
}

function dirtyWorkspacePrompt() {
  if (!inGitRepo()) return '';
  const status = porcelainSnapshot();
  if (!status?.length) return '';
  const lines = [];
  let bytes = 0;
  for (const line of status) {
    const next = Buffer.byteLength(`${line}\n`);
    if (lines.length >= MAX_DIRTY_STATUS_LINES || bytes + next > MAX_DIRTY_STATUS_BYTES) break;
    lines.push(line);
    bytes += next;
  }
  const truncated = lines.length < status.length;
  const limitNote = truncated
    ? `\n\nThe status list was truncated to ${lines.length} of ${status.length} entries and ${bytes} bytes. Run \`git status --porcelain\` and inspect relevant diffs before editing or delivering changes.`
    : '';
  return (
    '## Existing workspace changes\n\n' +
    'The workspace was already dirty before this implement run. Treat these paths as user-owned context. Build on them only when the task clearly includes them; otherwise pause and ask for confirmation before overwriting, cleaning, stashing, resetting, deleting, committing, pushing, or opening a PR with them. Use `git status --porcelain` and `git diff` as ground truth when path ownership is unclear.\n\n' +
    '`git status --porcelain` before this run (bounded summary):\n' +
    '```text\n' +
    lines.join('\n') +
    '\n```' +
    limitNote
  );
}

// ---------------------------------------------------------------------------
// codex invocation
// ---------------------------------------------------------------------------

function durationToMs(d) {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(d);
  if (!m) return null;
  const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2]];
  return Math.round(parseFloat(m[1]) * mult);
}


function triageResult({ payload, stderr, exit }) {
  if (payload.status !== 'SUCCESS' || exit !== 0) {
    throw Object.assign(new Error(
      `Codex execution failed (exit ${exit}).\n${payload.error || stderr || 'Turn did not complete.'}` +
      (payload.response ? `\n\nPartial response:\n${payload.response}` : '')
    ), { reason: 'codex_error' });
  }
  if (!payload.response?.trim()) throw Object.assign(new Error('Codex completed without a final answer.'), { reason: 'empty_response' });
  return payload.response;
}

// A follow-up targets a conversation whose execution has stopped. While the
// job is still running, report its status and id instead of queueing: the
// orchestrator decides whether to wait or cancel first.
function refuseRunningFollowUp(state, conversation, jobId = null) {
  if (!conversation && !jobId) return;
  const active = (state.jobs || []).find(j =>
    ((conversation && j.conversation_id === conversation) || (jobId && j.id === jobId)) &&
    liveJobStatus(j) === 'running');
  if (!active) return;
  die(`job ${active.id} is still running (status: running); the follow-up was not accepted or queued. ` +
    `Collect it with \`wait ${active.id}\` and continue afterwards, or \`cancel ${active.id}\` first for an immediate change of direction.`);
}

// run (research / review / implement / continue)
// ---------------------------------------------------------------------------

function resolveRun(mode, opts, priorJob = null) {
  if (opts.json && mode !== 'review') die('--json is supported only for review');
  // likely a typo for --restricted; --restrict (per-repo policy) belongs to setup
  if (opts.restrict !== undefined) {
    die(`--restrict is a setup flag (per-repo policy: \`setup --restrict <modes|none>\`). For a single ${mode} run use --restricted.`);
  }

  if (opts.effort && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(opts.effort)) {
    die('--effort must be none|minimal|low|medium|high|xhigh|max|ultra (support depends on the model)');
  }
  let model = opts.model || null;
  let effort = opts.effort || null;

  // profile: CLI flag > project policy (.codex-staff/config.json) > built-in default
  if (opts.restricted && opts.unrestricted) die('--restricted and --unrestricted are mutually exclusive');
  const policyProfile = mode === 'ask' ? null : loadProjectConfig()?.profiles?.[mode] || null;
  let profile;
  let profileSource; // 'flag' | 'project' | 'default' | 'inherited'
  if (opts.restricted || opts.unrestricted) {
    profile = opts.restricted ? 'restricted' : 'unrestricted';
    profileSource = 'flag';
  } else if (policyProfile) {
    profile = policyProfile;
    profileSource = 'project';
  } else {
    profile = DEFAULTS.profile[mode];
    profileSource = 'default';
  }
  if (mode === 'ask' && (opts.unrestricted || opts.restricted)) {
    if (opts.unrestricted) process.stderr.write('codex-staff: ask uses a read-only sandbox; --unrestricted ignored\n');
    profile = 'restricted';
  }

  // execution style is a property of the mode; no flag overrides it
  const background = DEFAULTS.background[mode];

  const timeout = opts.timeout || DEFAULTS.timeout[mode];
  const budget = durationToMs(timeout);
  if (!Number.isFinite(budget) || budget <= 0 || budget > 7200000) die('invalid --timeout: use a positive duration, at most 120m');

  // conversation
  const state = loadState();
  let conversation = opts.conversation || null;
  if (!conversation && opts.continue) {
    conversation = state.conversations?.[mode] || null;
    if (!conversation) die(`--continue given but no previous ${mode} conversation is recorded in state.json`);
  }

  const recorded = state.conversation_configs?.[conversation];
  const prior = priorJob || (conversation ? [...(state.jobs || [])].reverse().find((j) => j.conversation_id === conversation && j.mode === mode) : null)
    || (recorded?.mode === mode ? recorded : null)
    || (state.last?.id === conversation && state.last?.mode === mode ? { model: state.last.model, profile: state.last.profile } : null);
  // Configuration may come from an earlier job; occupancy belongs to the
  // whole conversation, including jobs launched through another mode.
  refuseRunningFollowUp(state, conversation);
  if (prior) {
    if (!opts.model && prior.model) model = prior.model;
    if (!opts.effort && prior.effort) effort = prior.effort;
    if (!opts.restricted && !opts.unrestricted && prior.profile) { profile = prior.profile; profileSource = 'inherited'; }
  }
  if (profileSource === 'project') process.stderr.write(`codex-staff: profile=${profile} set by project policy (${configPath()})\n`);
  return { mode, model, effort, profile, profileSource, background, timeout, conversation, parentJobId: prior?.id || null, originalCwd: prior?.cwd || null };
}

/** Task text comes from exactly one source: --prompt, --prompt-file, or
 *  --stdin. Long prompts should use the latter two instead of shell quoting.
 *  Whatever the source, the contents are opaque here: already a single string
 *  by the time they arrive, and never scanned for companion flags. */
function taskText(opts) {
  const task = readTaskText(opts);
  if (Buffer.byteLength(task) > MAX_PROMPT_BYTES) die(`task text exceeds the ${MAX_PROMPT_BYTES / 1024}KB prompt limit`);
  return task;
}

function readTaskText(opts) {
  const sources = [
    opts.prompt !== undefined && '--prompt',
    opts['prompt-file'] !== undefined && '--prompt-file',
    opts.stdin && '--stdin',
  ].filter(Boolean);
  if (sources.length > 1) die(`task text given more than one way (${sources.join(', ')}) — use exactly one`);
  if (opts.prompt !== undefined) return opts.prompt.trim();
  if (opts['prompt-file'] !== undefined) {
    try {
      return fs.readFileSync(opts['prompt-file'], 'utf8').trim();
    } catch (e) {
      die(`cannot read --prompt-file ${opts['prompt-file']}: ${e.message}`);
    }
  }
  if (opts.stdin) {
    try {
      return fs.readFileSync(0, 'utf8').trim();
    } catch (e) {
      die(`cannot read task text from stdin: ${e.message}`);
    }
  }
  return '';
}

function buildPrompt(mode, opts) {
  const task = taskText(opts);
  const context = gatherContext();

  if (!task) {
    if (mode === 'ask') die('ask needs a question');
    if (mode === 'review') {
      die(
        'review needs a subject description, e.g. review --prompt "Review PR #730" or review --prompt "Review the current working tree"'
      );
    }
    die(`${mode} needs a task description`);
  }
  // ask requests an answer without tools and includes only the question
  if (mode === 'ask') return fillTemplate('ask', { TASK: task });
  return fillTemplate(mode, {
    TASK: task,
    CONTEXT: context,
    WORKSPACE: mode === 'implement' ? dirtyWorkspacePrompt() : '',
  });
}

// ---------------------------------------------------------------------------
// tiered guards (unrestricted runs only; ask is forced restricted upstream)
//
//   implement → it is meant to edit files. Dirty workspaces are prompt context,
//               not a hard companion refusal: codex can continue when the task
//               clearly includes the existing changes, and must ask when it
//               would overwrite or deliver unrelated user work.
//   review /  → no gate at all, never blocked. They should not be touching
//   research    files, so we snapshot `git status --porcelain` around the run
//               and report any delta with the result.
//   staffer   → same snapshot/report, but neutrally worded: a general task may
//               legitimately edit files, so the delta is information for the
//               caller, not an accusation.
// ---------------------------------------------------------------------------

function inGitRepo() {
  const r = sh('git', ['rev-parse', '--is-inside-work-tree']);
  return r.code === 0 && r.out === 'true';
}

/** Porcelain lines as an array, or null when git can't tell us (no repo). */
function porcelainSnapshot() {
  const r = sh('git', ['status', '--porcelain']);
  if (r.code !== 0) return null;
  return r.out ? r.out.split('\n') : [];
}

/** Lines that appeared during the run, plus lines whose status changed for a
 *  path that was already dirty (e.g. " M f" → "MM f"). */
function porcelainDelta(before, after) {
  const seen = new Map();
  for (const line of before) seen.set(line.slice(3), line);
  return after.filter((line) => seen.get(line.slice(3)) !== line);
}

function implementGuardApplies(resolved) {
  return resolved.profile === 'unrestricted' && resolved.mode === 'implement';
}

function treeReportApplies(resolved) {
  return resolved.profile === 'unrestricted' && ['staffer', 'review', 'research'].includes(resolved.mode);
}

function implementDispatchWarning() {
  if (!inGitRepo()) {
    process.stderr.write(
      'codex-staff warning: not a git repository — codex\'s edits cannot be reviewed or rolled back via git.\n' +
        'Proceeding anyway; back up anything you care about, or run implement from inside a repository.\n'
    );
  }
}

function implementPostcondition(before) {
  if (!inGitRepo()) return '';
  const after = porcelainSnapshot() || [];
  if (!after.length) return '\n[unrestricted] Working tree clean after implement.';
  const diffStat = sh('git', ['diff', '--stat']).out;
  const delta = before ? porcelainDelta(before, after) : after;
  const untracked = delta
    .filter((l) => l.startsWith('??'))
    .map((l) => l.slice(3))
    .join(', ');
  let out;
  if (before?.length) {
    out =
      '\n[unrestricted] Working tree is dirty after implement. Existing pre-run changes may be part of the task context.\n' +
      'Status entries that appeared or changed during the run:\n' +
      (delta.length ? delta.map((l) => `  ${l}`).join('\n') : '  (none detected by porcelain status)') +
      '\n`git diff --stat`:\n' +
      (diffStat || '(only new files or committed by codex)');
  } else {
    out =
      '\n[unrestricted] codex modified the working tree. `git diff --stat`:\n' +
      (diffStat || '(only new files or committed by codex)');
  }
  if (untracked) out += `\nNew untracked files: ${untracked}`;
  out += '\nACTION FOR THE CALLING AGENT: inspect the current workspace (`git status --short`, `git diff`) and distinguish pre-run dirty paths from this run\'s delta. Continue the same codex conversation for follow-up work. If committing or opening a PR, first verify the task explicitly authorized that delivery.';
  return out;
}

/** Tree-delta warning for staffer/review/research: silent unless codex dirtied
 *  the tree. review/research should never edit, so the report blames codex; a
 *  staffer task may legitimately edit, so its wording is neutral. */
function treeDeltaReport(mode, before, after) {
  if (!before || !after) return '';
  const delta = porcelainDelta(before, after);
  if (!delta.length) return '';
  const blame =
    mode === 'staffer'
      ? `codex modified the working tree during this ${mode} run — verify the task asked for it. `
      : `codex modified the working tree during this ${mode} — it should not have. `;
  return (
    `\n[unrestricted] ${blame}` +
    `Delta (\`git status --porcelain\` entries that appeared or changed during the run):\n` +
    delta.map((l) => `  ${l}`).join('\n') +
    `\nACTION FOR THE CALLING AGENT: inspect these changes (\`git diff\`) before trusting this ${mode}. ` +
    `Preserve pre-existing changes. No automatic rollback was performed.`
  );
}

async function executeRun(resolved, prompt, opts, execution = null) {
  const started = Date.now();
  const workspaceBefore = resolved.mode === 'ask' ? null : porcelainSnapshot();
  const implementBefore = implementGuardApplies(resolved) ? workspaceBefore : null;
  const treeBefore = treeReportApplies(resolved) ? workspaceBefore : null;

  const invoke = {
    prompt,
    model: resolved.model, effort: resolved.effort,
    conversation: resolved.conversation,
    mode: resolved.mode,
    unrestricted: resolved.profile === 'unrestricted',
    jsonSchema: opts.json && resolved.mode === 'review' ? REVIEW_SCHEMA : null,
  };
  let result, response;
  try {
    result = await execution(invoke);
    rememberConversation(resolved, result.payload.conversation_id, opts.jobId);
    response = triageResult(result);
    if (opts.json) validateReview(response, JSON.parse(fs.readFileSync(REVIEW_SCHEMA, 'utf8')));
  } catch (error) {
    error.workspace = {
      before: excerpt(workspaceBefore?.join('\n') ?? 'Git status unavailable', 3000),
      after: excerpt(porcelainSnapshot()?.join('\n') ?? 'Git status unavailable', 3000),
      note: 'Inspect git status --short, git diff and git diff --cached. Status cannot detect further edits to already dirty files; no workspace rollback was performed.' };
    throw error;
  }
  const payload = result.payload;
  const treeAfter = treeBefore ? porcelainSnapshot() : null;
  opts.warnings = !!(result.stderr || result.observationWarnings?.length || result.exit !== 0 || (payload.status && payload.status.toUpperCase() !== 'SUCCESS'));

  // Telemetry is plumbing, not content: it goes to stderr so it never mixes
  // into the deliverable. Foreground runs put it on the caller's stderr;
  // background workers have stdout and stderr both wired to jobs/<id>.log, so
  // it lands there as the job's provenance record.
  process.stderr.write(
    `[codex-staff] mode=${resolved.mode} profile=${resolved.profile} model=${resolved.model || '(Codex-config)'} ` +
      `codex_status=${payload.status || 'unknown'} codex_exit=${result.exit} ` +
      `duration=${((Date.now() - started) / 1000).toFixed(1)}s tokens(${fmtTokens(payload.usage)})\n` +
      `conversation: ${payload.conversation_id || 'unknown'} (follow up with --continue)\n`
  );

  // Guard output is part of the body: the calling agent must act on it.
  let guard = '';
  if (implementGuardApplies(resolved)) guard += implementPostcondition(implementBefore);
  if (treeReportApplies(resolved)) guard += treeDeltaReport(resolved.mode, treeBefore, treeAfter);
  opts.warnings ||= !!guard;
  if (opts.json && guard) { process.stderr.write(guard + '\n'); return response; }
  return guard ? response + '\n' + guard : response;
}

function cmdRun(mode, opts) {
  const task = taskText(opts); // Resolve prompt-file/stdin in the caller's cwd.
  const resolved = resolveRun(mode, opts);
  enterOriginalWorkspace(resolved.originalCwd);
  if (resolved.parentJobId) {
    const prior = findJob(resolved.parentJobId);
    enterOriginalWorkspace(prior.cwd);
    if (prior.spec_file) { try { opts.json ||= JSON.parse(fs.readFileSync(prior.spec_file, 'utf8')).opts.json; } catch {} }
  }
  const prompt = buildPrompt(mode, { prompt: task });
  return dispatch(resolved, prompt, { ...opts, promptSource: { kind: 'template', task } });
}

async function dispatch(resolved, prompt, opts) {
  const mode = resolved.mode;

  if (implementGuardApplies(resolved)) implementDispatchWarning();

  // background: write a job spec, spawn ourselves detached as _worker
  const jobId = `${mode}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const jobsDir = path.join(ensureStateDir(), 'jobs');
  fs.mkdirSync(jobsDir, { recursive: true });
  const logFile = path.join(jobsDir, `${jobId}.log`);
  const specFile = path.join(jobsDir, `${jobId}.spec.json`);
  const resultFile = path.join(jobsDir, `${jobId}.result.md`);

  // Register the job BEFORE spawning: a fast worker's own state update must
  // find the record already present, or it gets lost in its read-modify-write.
  const record = {
    id: jobId, mode, pid: null, status: 'running', cwd: process.cwd(),
    model: resolved.model, effort: resolved.effort, profile: resolved.profile, profileSource: resolved.profileSource,
    timeout: resolved.timeout, json: !!opts.json, conversation_id: resolved.conversation || null,
    parent_job_id: opts.parentJobId || resolved.parentJobId || null,
    started_at: new Date().toISOString(), log_file: logFile, result_file: resultFile,
    spec_file: specFile,
    events_file: path.join(jobsDir, `${jobId}.events.jsonl`),
    progress_file: path.join(jobsDir, `${jobId}.progress.json`),
  };
  updateState((state) => {
    // Two callers can both resolve an idle conversation. Recheck under the
    // registration lock before accepting either the job or its prompt file.
    refuseRunningFollowUp(state, resolved.conversation);
    fs.writeFileSync(specFile, JSON.stringify({ resolved, prompt, prompt_source: opts.promptSource || null, opts: { json: !!opts.json }, cwd: process.cwd() }, null, 2));
    state.jobs ||= [];
    state.jobs.push(record);
  });
  fs.appendFileSync(logFile, `[codex-staff] dispatch registered ${jobId} at ${record.started_at}\n`);

  const logFd = fs.openSync(logFile, 'a');
  // detached on every platform: on POSIX it isolates the process group; on
  // Windows it is DETACHED_PROCESS, so the worker has no console (with
  // windowsHide its own children get none either) and outlives the terminal
  // that dispatched it, including its Ctrl+C.
  const child = spawn(process.execPath, [SELF, '_worker', jobId], {
    cwd: process.cwd(),
    detached: true,
    windowsHide: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);

  // Backfill the pid, preserving whatever status the worker may have written.
  updateJob(jobId, { pid: child.pid });
  child.on('error', (error) => {
    fs.writeFileSync(resultFile, `Job failed: worker launch: ${error.message}\n`);
    updateJob(jobId, { status: 'error', reason: 'worker_launch_error', finished_at: new Date().toISOString() }, true);
  });

  if (!resolved.background) {
    await cmdWait({ _: [jobId], timeout: `${durationToMs(resolved.timeout) + 30000}ms`, plain: true });
    const log = readTail(logFile);
    process.stderr.write(log.split('\n').filter(line => line.startsWith('[codex-staff] mode=') || line.startsWith('conversation:')).join('\n') + '\n');
    return;
  }

  process.stdout.write(
    `Started background ${mode} job.\n` +
      `job id: ${jobId} (pid ${child.pid})\n` +
      `model: ${resolved.model || '(Codex-config)'}  effort: ${resolved.effort || '(Codex-config)'}  profile: ${resolved.profile}  timeout: ${resolved.timeout}\n` +
      `result file (written when the job finishes): ${resultFile}\n` +
      `Collect: run \`wait ${jobId} --timeout 10m\` as a background command ` +
      `(one background wait per job; exit 0 = result printed, 2 = still running — wait again for the same job, without extra progress checks).\n` +
      `Progress only if the user asks: \`observe ${jobId}\`   Stop: \`cancel ${jobId}\`\n`
  );
}

async function workerMain(jobId) {
  inWorker = true;
  const started = Date.now();
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
  let job, cancelTimer;
  try {
    job = updateJob(jobId, { worker_started_at: new Date().toISOString(), worker_pid: process.pid, worker_identity: processIdentity(process.pid) });
    process.stderr.write(`[codex-staff] worker started ${jobId} pid=${process.pid} at ${job.worker_started_at}\n`);
    if (job.status !== 'running') return;
    const checkCancellation = () => {
      if (job.cancel_requested_at || fs.existsSync(job.spec_file + '.cancel')) controller.abort();
    };
    checkCancellation();
    cancelTimer = setInterval(checkCancellation, 100);
    if (controller.signal.aborted) throw Object.assign(new Error('Execution canceled.'), { reason: 'canceled' });
    const spec = JSON.parse(fs.readFileSync(job.spec_file, 'utf8'));
    const opts = { ...spec.opts, jobId };
    const output = await executeRun(spec.resolved, spec.prompt, opts, (invoke) => {
      const codex = codexCommand(codexArgs(invoke));
      return runStreaming({ binary: codex.cmd, args: codex.args, input: invoke.prompt, job,
        budget: durationToMs(spec.resolved.timeout) - (Date.now() - started), signal: controller.signal,
        update: (fields) => updateJob(jobId, fields),
        conversation: (id) => rememberConversation(spec.resolved, id, jobId),
      });
    });
    if (controller.signal.aborted) throw Object.assign(new Error('Execution canceled.'), { reason: 'canceled' });
    // Result and conversation metadata are durable before completion is visible.
    job = finishJob(jobId, output + '\n', { status: 'done', warnings: opts.warnings });
    if (job.status === 'done' && !job.warnings) {
      for (const file of [job.events_file, job.progress_file]) {
        try { fs.unlinkSync(file); } catch (error) { process.stderr.write(`cleanup: ${error.message}\n`); }
      }
    }
  } catch (error) {
    if (!job) throw error;
    job = loadState().jobs?.find((j) => j.id === jobId);
    if (!job) throw error;
    const reason = job.cancel_requested_at ? 'canceled' : error.reason || 'codex_error';
    const status = job.status === 'canceled' || reason === 'canceled' ? 'canceled'
      : isTimeoutReason(reason) && job.conversation_id ? 'attention' : 'error';
    job = finishJob(jobId, (completed) => {
      const report = { ...diagnosticPacket(completed), result_exists: true, reason: completed.reason,
        workspace: error.workspace, last_snapshot: readObservation(completed) };
      return `${completed.status === 'attention' ? 'Job needs attention' : 'Job failed'}:\n${completed.reason === 'canceled' ? 'Execution canceled.' : error.message}\n\n${JSON.stringify(report, null, 2)}\n`;
    }, (current) => current.cancel_requested_at ? { status: 'canceled', reason: 'canceled' } : { status, reason });
    process.exitCode = JOB_EXIT_CODES[job.status] ?? 1;
  } finally {
    clearInterval(cancelTimer);
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('SIGINT', onSignal);
  }
}

// ---------------------------------------------------------------------------
// jobs: status / result / cancel
// ---------------------------------------------------------------------------

const CRASH_SANDBOX_HINT =
  'The worker pid is not visible from this process. If the job may have been started from a different harness permission or sandbox context, rerun wait/status/result from the same unsandboxed context before treating it as crashed.';

function refreshJobs(state) {
  for (const job of state.jobs || []) job.status = liveJobStatus(job);
}

function liveJobStatus(job) {
  if (['done', 'canceled', 'error', 'attention'].includes(job.status)) return job.status;
  try {
    const final = JSON.parse(fs.readFileSync(job.result_file + '.status.json', 'utf8'));
    if (['done', 'error', 'canceled', 'attention'].includes(final.status)) return final.status;
  } catch {}
  if (pidAlive(job.pid)) return 'running';
  // New jobs publish an explicit result status; never infer success from an
  // error report left behind by a worker that died before updating state.
  return !job.spec_file && fs.existsSync(job.result_file) ? 'done' : 'crashed';
}

// Machine-readable job exit codes shared by `status <id>` and `wait`.
// 1 stays the generic companion error, so callers can loop on "code 2"
// without parsing any output.
const JOB_EXIT_CODES = { done: 0, running: 2, error: 3, crashed: 3, canceled: 4, attention: 5 };

function cmdStatus(opts) {
  const state = loadState();
  refreshJobs(state);
  const jobs = state.jobs || [];
  const id = opts._[0];

  if (id) {
    const job = jobs.find((j) => j.id === id);
    if (!job) die(`no job ${id} in this repository`);
    process.stdout.write(JSON.stringify(job, null, 2) + '\n');
    if (job.status === 'running') {
      process.stdout.write(`\nStill running. Log tail:\n`);
      const log = readTail(job.log_file);
      process.stdout.write(log.split('\n').slice(-10).join('\n') + '\n');
    } else if (job.status === 'crashed' && !fs.existsSync(job.result_file)) {
      process.stdout.write(JSON.stringify(diagnosticPacket(job), null, 2) + '\n');
      process.stdout.write(`\n${CRASH_SANDBOX_HINT}\n`);
    }
    // machine-readable outcome so callers never have to parse the JSON
    process.exitCode = JOB_EXIT_CODES[job.status] ?? 1;
    return;
  }

  if (!jobs.length) {
    process.stdout.write('No codex-staff jobs recorded in this repository.\n');
    return;
  }
  process.stdout.write('id | mode | status | started | finished\n');
  for (const j of jobs.slice(-20)) {
    process.stdout.write(`${j.id} | ${j.mode} | ${j.status} | ${j.started_at} | ${j.finished_at || '-'}\n`);
  }
  process.stdout.write('\nDetails: `status <id>`   Output: `result <id>`\n');
  if (jobs.slice(-20).some((j) => j.status === 'crashed' && !fs.existsSync(j.result_file))) {
    process.stdout.write(`\n${CRASH_SANDBOX_HINT}\n`);
  }
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/** Block until the job reaches a terminal state, then print its result —
 *  `wait` + `result` in one call. Bounded by its own --timeout (default 100s,
 *  chosen to sit under a typical harness per-command timeout); expiring is NOT
 *  a failure: exit code 2 means "still running — call wait again". */
async function cmdWait(opts) {
  const id = opts._[0] || null;
  const timeout = opts.timeout || '100s';
  const budget = durationToMs(timeout);
  if (!Number.isFinite(budget) || budget < 0) die(`invalid --timeout "${timeout}" (examples: 100s, 5m)`);

  // Wait silently: callers use observe for progress, not periodic liveness text.
  // Read-only lookup: the poll loop must never write state.json, or it races
  // the worker's own final read-modify-write (see liveJobStatus).
  const findJob = () => {
    const jobs = loadState().jobs || [];
    if (id) return jobs.find((j) => j.id === id) || null;
    return jobs.length ? jobs[jobs.length - 1] : null;
  };
  let job = findJob();
  if (!job) die(id ? `no job ${id} in this repository` : 'no codex-staff jobs recorded in this repository');

  const POLL_MS = 200;
  const start = Date.now();
  let status = liveJobStatus(job);
  while (status === 'running' && Date.now() - start < budget) {
    await sleepMs(Math.min(POLL_MS, budget - (Date.now() - start)));
    job = findJob();
    if (!job) die(`job record disappeared from state.json`);
    status = liveJobStatus(job);
  }

  return renderJobResponse(job, { plain: opts.plain });
}

function findJob(id) {
  const jobs = loadState().jobs || [];
  const job = id ? jobs.find((j) => j.id === id) : jobs.at(-1);
  if (!job) die(id ? `no job ${id} in this repository` : 'no codex-staff jobs recorded in this repository');
  return job;
}

function readObservation(job) {
  let snapshot = { recent_activities: [], latest_text: null, last_event_at: null, warnings: ['No activity record is available for this job.'] };
  try { snapshot = JSON.parse(fs.readFileSync(job.progress_file, 'utf8')); } catch {}
  return boundSnapshot({ ...snapshot, job_id: job.id, mode: job.mode, status: liveJobStatus(job),
    started_at: job.started_at, observed_at: new Date().toISOString(),
    elapsed_seconds: Math.max(0, Math.round((Date.now() - Date.parse(job.started_at)) / 1000)),
    details: { raw_output: job.events_file || null, diagnostics: job.log_file, result: job.result_file },
  });
}

function readTail(file, limit = 8192) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const buffer = Buffer.alloc(Math.min(size, limit));
    fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
    return buffer.toString('utf8');
  } catch { return ''; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function isTimeoutReason(reason) {
  return reason === 'response_timeout' || reason === 'hard_timeout';
}

function shellArg(value) {
  return /^[a-zA-Z0-9_./:-]+$/.test(value) ? value : "'" + String(value).replaceAll("'", "'\\''") + "'";
}

function timeoutRecovery(job) {
  const previous = durationToMs(job.timeout) || durationToMs(DEFAULTS.timeout[job.mode]) || 3600000;
  const next = Math.min(previous * 2, 7200000);
  const suggested = next % 60000 === 0 ? `${next / 60000}m` : `${next / 1000}s`;
  const target = job.id ? `--job ${shellArg(job.id)}` : `--conversation ${shellArg(job.conversation_id || '')}`;
  return {
    inspect: 'git status --short; git diff; git diff --cached', spec_file: job.spec_file || null,
    requires_user_confirmation: true, suggested_timeout: suggested, at_timeout_ceiling: next <= previous,
    continue: job.conversation_id ? `continue ${target} --timeout ${suggested} --prompt "Continue after inspecting partial workspace changes"` : null,
    restart: job.id ? `restart ${shellArg(job.id)} --timeout ${suggested}` : null,
    note: job.conversation_id
      ? 'Ask the user whether to continue ' + (next <= previous ? 'with a narrower task at the 120m ceiling' : `with a larger timeout (suggested: ${suggested})`) +
        ' or stop and inspect the current workspace. No automatic retry or continuation.'
      : 'No conversation ID is available. Inspect partial workspace changes and ask the user before restarting. No retry was started.',
  };
}

function diagnosticPacket(job) {
  let logBytes = null;
  try { logBytes = fs.statSync(job.log_file).size; } catch {}
  return { job_id: job.id, mode: job.mode, cwd: job.cwd || process.cwd(), status: liveJobStatus(job),
    started_at: job.started_at, worker_started_at: job.worker_started_at || null, finished_at: job.finished_at || null,
    pid: job.pid, codex_pid: job.codex_pid || null, log_bytes: logBytes,
    log_state: logBytes === null ? 'missing' : logBytes === 0 ? 'empty' : 'present',
    result_exists: fs.existsSync(job.result_file), log_file: job.log_file, events_file: job.events_file || null,
    conversation_id: job.conversation_id || null, model: job.model || null, profile: job.profile || null,
    recovery: isTimeoutReason(job.reason) ? timeoutRecovery(job) : { inspect: 'git status --short; git diff', spec_file: job.spec_file || null,
      continue: job.conversation_id ? `continue --job ${job.id} --prompt "Continue after inspecting partial workspace changes"` : null,
      restart: `restart ${job.id}`, note: 'Inspect partial workspace changes first. Recovery creates a linked new job with a fresh budget; nothing is retried automatically.' },
  };
}

/** Observation never reads the result body, even when completion races a read.
 *  A separate wait/result owns delivery; observers cannot consume its output. */
function readTerminalObservation(job, status) {
  // A result sidecar may be visible just before the shared registry commit.
  let final = {};
  try { final = JSON.parse(fs.readFileSync(job.result_file + '.status.json', 'utf8')); } catch {}
  const finishedAt = job.finished_at || final.finished_at || null;
  const snapshot = {
    job_id: job.id, mode: job.mode, status,
    started_at: job.started_at, finished_at: finishedAt, observed_at: new Date().toISOString(),
    elapsed_seconds: Math.max(0, Math.round(((Date.parse(finishedAt) || Date.now()) - Date.parse(job.started_at)) / 1000)),
    result_file: job.result_file, result_available: fs.existsSync(job.result_file),
    collection: {
      command: `result ${job.id}`,
      instruction: 'Collect the existing wait session if one is pending; otherwise use result for the full output.',
    },
  };
  if (status !== 'done') {
    const reason = job.reason || final.reason || (status === 'crashed' ? 'worker_crashed' : status === 'canceled' ? 'canceled' : 'job_error');
    const packet = diagnosticPacket({ ...job, ...final, reason });
    Object.assign(snapshot, {
      reason,
      summary: status === 'attention' ? 'Timeout with a resumable conversation; ask the user whether to continue.'
        : reason === 'hard_timeout' ? 'Execution stopped at its hard limit.' : `Job ${status}; inspect the retained report and diagnostics.`,
      conversation_id: job.conversation_id || null, model: job.model || null, profile: job.profile || null,
      worker_started_at: job.worker_started_at || null, pid: job.pid, codex_pid: job.codex_pid || null,
      log_state: packet.log_state, log_bytes: packet.log_bytes,
      details: { diagnostics: job.log_file, raw_output: job.events_file || null, snapshot: job.progress_file || null },
      recovery: packet.recovery,
    });
    if (status === 'crashed') snapshot.liveness_note = CRASH_SANDBOX_HINT;
  }
  // Intermediate tool errors remain internal when the overall job succeeds.
  return boundSnapshot(snapshot);
}

function renderJobResponse(initial, { observeOnly = false, plain = false } = {}) {
  let job = findJob(initial.id);
  let status = liveJobStatus(job);
  if (status === 'running') {
    const snapshot = readObservation(job);
    // Success cleanup can race the snapshot read; terminal state wins.
    job = findJob(job.id);
    status = liveJobStatus(job);
    if (status === 'running') {
      process.stdout.write(JSON.stringify(snapshot) + '\n');
      process.exitCode = 2;
      return;
    }
  }
  if (observeOnly) {
    process.stdout.write(JSON.stringify(readTerminalObservation(job, status)) + '\n');
    process.exitCode = JOB_EXIT_CODES[status] ?? 1;
    return;
  }
  if (fs.existsSync(job.result_file)) {
    if (!plain && !(job.json && status === 'done')) process.stdout.write(`# Job ${job.id} (${job.mode}, ${status})\n\n`);
    process.stdout.write(fs.readFileSync(job.result_file, 'utf8'));
  } else {
    process.stdout.write(`Job ${job.id} (${job.mode}) finished with status ${status} and no stored result. Log: ${job.log_file}\n`);
    process.stdout.write(JSON.stringify(diagnosticPacket(job), null, 2) + '\n');
    if (status === 'crashed') process.stdout.write(`\n${CRASH_SANDBOX_HINT}\n`);
  }
  // Deliver reports on one stream. Diagnostics remain in job.log_file; emitting
  // them on stderr can splice them into large reports when hosts merge streams.
  process.exitCode = JOB_EXIT_CODES[status] ?? 1;
}


function cmdResult(opts) {
  const state = loadState();
  refreshJobs(state);
  const jobs = state.jobs || [];
  let job;
  if (opts._[0]) {
    job = jobs.find((j) => j.id === opts._[0]);
    if (!job) die(`no job ${opts._[0]} in this repository`);
  } else {
    job = [...jobs].reverse().find((j) => j.status !== 'running');
    if (!job) die('no finished jobs in this repository');
  }
  if (job.status === 'running') {
    die(`job ${job.id} is still running — collect it with \`wait ${job.id}\` or peek with \`status ${job.id}\``);
  }
  if (!fs.existsSync(job.result_file)) {
    let msg = `job ${job.id} (${job.status}) has no stored result. Log: ${job.log_file}`;
    if (job.status === 'crashed') {
      msg += `\n${JSON.stringify(diagnosticPacket(job), null, 2)}\n\n${CRASH_SANDBOX_HINT}`;
    }
    die(msg);
  }
  renderJobResponse(job);
}

async function cmdCancel(opts) {
  const id = opts._[0];
  if (!id) die('cancel needs a job id (see `status`)');
  let changed = false, status;
  const job = updateState((state) => {
    const job = state.jobs?.find((j) => j.id === id);
    if (!job) die(`no job ${id} in this repository`);
    status = liveJobStatus(job);
    if (status === 'running') {
      if (!job.spec_file) die('this legacy job has no cancellation request channel; cannot safely signal an unverified stored PID');
      const identity = job.worker_identity;
      const current = identity ? processIdentity(job.pid) : null;
      if (identity && (identity.pid !== job.pid || (current && identity.born !== current.born))) {
        die('worker identity no longer matches this job; refusing to signal a reused or unrelated PID');
      }
      // Keep running visible until the worker stores the cancellation report.
      job.cancel_requested_at ||= new Date().toISOString();
      fs.writeFileSync(job.spec_file + '.cancel', job.cancel_requested_at);
      changed = true;
    }
    return job;
  });
  if (!changed) { process.stdout.write(`Job ${id} is not running (status: ${status}).\n`); return; }
  // The worker polls the request even if PID inspection/signaling is blocked.
  // Never send signals to the stored Codex PID: the worker owns that child.
  // On Windows process.kill() is TerminateProcess: the worker would die without
  // running its cleanup and orphan the codex tree, so rely on the marker alone there.
  const current = job.worker_identity && process.platform !== 'win32' ? processIdentity(job.pid) : null;
  if (current && current.pid === job.worker_identity.pid && current.born === job.worker_identity.born) {
    try { process.kill(current.pid, 'SIGTERM'); } catch {}
  }
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const latest = findJob(id);
    status = liveJobStatus(latest);
    if (status === 'canceled') { process.stdout.write(`Canceled job ${id} (pid ${job.pid}).\n`); return; }
    if (status !== 'running') die(`Cancellation requested, but job is ${status}; inspect \`observe ${id}\` and the retained diagnostics.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  die(`Cancellation requested but the worker has not published a terminal report; inspect \`observe ${id}\` from the original unsandboxed context.`);
}

// ---------------------------------------------------------------------------
// continue
// ---------------------------------------------------------------------------

function enterOriginalWorkspace(cwd) {
  if (!cwd) return; // Legacy records did not store a cwd.
  const root = fs.realpathSync(repoRoot());
  let target;
  try { target = fs.realpathSync(cwd); } catch { die(`original workspace directory is unavailable: ${cwd}`); }
  const git = sh('git', ['rev-parse', '--show-toplevel'], { cwd: target });
  const targetRoot = fs.realpathSync(git.code === 0 && git.out ? git.out : target);
  if (root !== targetRoot) die(`recovery cannot switch worktrees; run from the original workspace: ${cwd}`);
  process.chdir(target);
  repoRootCache.set(target, git.code === 0 && git.out ? git.out : target);
  repoRootCache.set(process.cwd(), git.code === 0 && git.out ? git.out : target);
}

function cmdContinue(opts) {
  const state = loadState();
  const targetId = opts.conversation || state.last?.id;
  const prior = opts.job ? findJob(opts.job) : [...(state.jobs || [])].reverse().find((j) => j.conversation_id === targetId)
    || state.conversation_configs?.[targetId];
  const legacyMode = Object.entries(state.conversations || {}).find(([, id]) => id === targetId)?.[0];
  const mode = prior?.mode || legacyMode || (state.last?.id === targetId ? state.last?.mode : null);
  const conversation = prior?.conversation_id || targetId;
  if (opts.job) refuseRunningFollowUp(state, prior?.conversation_id, prior?.id);
  if (!mode || !conversation) die('no previous codex-staff conversation recorded in this repository for this target; use restart <job-id> when no conversation is available');
  if (opts.job && opts.conversation && opts.conversation !== prior.conversation_id) die('--job and --conversation identify different conversations');
  if (opts.job && !prior.conversation_id) die('this job has no known conversation; use restart <job-id>');
  const task = taskText(opts);
  if (!task) die('continue needs follow-up text');
  enterOriginalWorkspace(prior?.cwd);
  const resolved = resolveRun(mode, { ...opts, conversation }, prior);
  const workspace = mode === 'implement' ? dirtyWorkspacePrompt() : '';
  const prompt = `${workspace ? `${workspace}\n\n` : ''}Follow-up in the same conversation:\n\n${task}`;
  let json = opts.json;
  if (prior?.spec_file) { try { json ||= JSON.parse(fs.readFileSync(prior.spec_file, 'utf8')).opts.json; } catch {} }
  return dispatch(resolved, prompt, { ...opts, json, parentJobId: prior?.id, promptSource: { kind: 'followup', task } });
}

function cmdRestart(opts) {
  if (!opts._[0]) die('restart needs a job id');
  const job = findJob(opts._[0]);
  if (liveJobStatus(job) === 'running') die('job is still running; cancel it before restarting');
  if (!job.spec_file) die('this legacy job has no stored restart specification');
  const spec = JSON.parse(fs.readFileSync(job.spec_file, 'utf8'));
  enterOriginalWorkspace(spec.cwd);
  const resolved = { ...spec.resolved, conversation: null, timeout: DEFAULTS.timeout[job.mode] };
  if (opts.timeout) {
    resolved.timeout = resolveRun(job.mode, { ...opts, model: resolved.model, effort: resolved.effort, [resolved.profile]: true }).timeout;
  }
  // Rebuild saved task sources with fresh context. For legacy prompts, label
  // historical snapshots and append current facts without parsing task text.
  const source = spec.prompt_source || { kind: 'legacy', text: spec.prompt };
  let prompt;
  if (source.kind === 'template') prompt = buildPrompt(job.mode, { prompt: source.task });
  else if (source.kind === 'followup') prompt = `${job.mode === 'implement' ? dirtyWorkspacePrompt() + '\n\n' : ''}Follow-up task in a fresh conversation:\n\n${source.task}`;
  else {
    const current = `${gatherContext()}\n\n${job.mode === 'implement' ? dirtyWorkspacePrompt() || 'Working tree is currently clean.' : ''}`;
    prompt = `Restart the original task below. Its embedded workspace/environment snapshots are historical. Use the current workspace section at the end for this execution; preserve existing partial work.\n\n${source.text}\n\n## Current workspace for this restart\n\n${current}`;
  }
  return dispatch(resolved, prompt, { ...spec.opts, parentJobId: job.id, promptSource: source });
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

/** `setup --restrict <modes|none>`: write the per-repo policy. Declarative —
 *  the listed modes become restricted-by-default, every unlisted mode falls
 *  back to the built-in default. Written directly (no --apply): the file is
 *  repo-local, git-ignored by convention, and trivially reversible. */
function applyProjectPolicy(value) {
  const cfg = loadProjectConfig() || {};
  if (value === 'none') {
    delete cfg.profiles;
    if (Object.keys(cfg).length) {
      fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + '\n');
    } else {
      try {
        fs.unlinkSync(configPath());
      } catch {}
    }
    process.stdout.write(`Project policy cleared — all modes use the built-in defaults again.\n\n`);
    return false;
  }

  const modes = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (!modes.length) die('--restrict needs a value: a comma-separated list of modes, or "none" to clear');
  for (const m of modes) {
    if (m === 'ask') die('ask uses a read-only sandbox and always restricted; it cannot be configured');
    if (!CONFIGURABLE_MODES.includes(m)) {
      die(`--restrict: unknown mode "${m}" (configurable: ${CONFIGURABLE_MODES.join(', ')}, or "none" to clear)`);
    }
  }
  cfg.profiles = {};
  for (const m of modes) cfg.profiles[m] = 'restricted';
  ensureStateDir();
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + '\n');

  process.stdout.write(`Project policy written: ${configPath()}\n`);
  for (const m of modes) process.stdout.write(`  ${m}: restricted (default for this repository)\n`);
  process.stdout.write(
    'Unlisted modes keep the built-in default (unrestricted). A --restricted/--unrestricted flag on a\n' +
      'call still overrides the policy. This is a per-repo, per-machine preference (.codex-staff/ is\n' +
      'normally git-ignored, so it is not shared with the team) and a run policy, not a security\n' +
      'boundary — for untrusted input use an isolated checkout.\n\n'
  );
  return true;
}

function cmdSetup(opts) {
  const probe = codexCommand(['--version']);
  const version = sh(probe.cmd, probe.args);
  if (version.code !== 0) die(`Codex CLI not found or not working: ${version.err || probe.cmd}`);
  if (opts.restrict !== undefined) applyProjectPolicy(opts.restrict);
  process.stdout.write(`Codex CLI: ${version.out}\n`);
  process.stdout.write(`Project policy: ${JSON.stringify(loadProjectConfig()?.profiles || {})}\n`);
  process.stdout.write('Uses existing Codex login and model configuration. Run codex login if authentication is needed.\n');
  process.stdout.write('Restricted runs use read-only for ask/research/review and workspace-write for staffer/implement.\n');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === 'help') {
    process.stdout.write(`Usage: codex-staff <command> [flags]
Tasks: staffer | research | review | implement | ask | continue
Jobs: status | wait | observe | result | cancel | restart
Setup: setup [--restrict staffer,research,review,implement|none]
Task input: --prompt <text> | --prompt-file <path> | --stdin
Options: --model <id> --effort <level> --restricted | --unrestricted
         --timeout <duration> --conversation <id> --continue --json (review)
Continue: continue --job <id> --prompt <text>
Models and effort default to your Codex configuration.
Tool-using modes default to unrestricted; ask always uses read-only.
Ask waits for its answer; other modes return a background job ID.
`);
    return;
  }
  const opts = parseFlags(rest, { taskCommand: MODES.includes(cmd) || cmd === 'continue' });

  if (MODES.includes(cmd)) return cmdRun(cmd, opts);
  switch (cmd) {
    case 'continue':
      return cmdContinue(opts);
    case 'restart':
      return cmdRestart(opts);
    case 'observe':
      return renderJobResponse(findJob(opts._[0]), { observeOnly: true });
    case 'status':
      return cmdStatus(opts);
    case 'wait':
      return cmdWait(opts);
    case 'result':
      return cmdResult(opts);
    case 'cancel':
      return cmdCancel(opts);
    case 'setup':
      return cmdSetup(opts);
    case '_worker':
      return workerMain(rest[0]);
    default:
      die(`unknown subcommand: ${cmd}`);
  }
}

Promise.resolve().then(main).catch((error) => {
  if (!error.alreadyPrinted) process.stderr.write(`codex-staff error: ${error?.message || String(error)}\n`);
  process.exitCode = error.exitCode || 1;
});
