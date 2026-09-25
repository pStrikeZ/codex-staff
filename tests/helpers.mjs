/**
 * Black-box harness for the companion CLI.
 *
 * Every test gets its own sandbox: a throwaway git repo under os.tmpdir() plus
 * a throwaway HOME, so `.codex-staff/` state and any `~/.codex` writes can never
 * land in the real repo or the real home directory. `codex` is replaced with
 * tests/fake-codex.mjs via CODEX_BIN — no test ever reaches the network.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const COMPANION = path.join(HERE, '..', 'companion', 'codex-companion.mjs');
export const FAKE_CODEX = path.join(HERE, 'fake-codex.mjs');

/**
 * Create an isolated {repo, home, argvFile} sandbox.
 *
 * `{ git: false }` skips `git init`, so the workspace is a plain directory with
 * no repository anywhere above it (os.tmpdir() is not inside one) — the shape
 * the round-2 "implement outside a git repo warns and proceeds" rule needs.
 */
export function sandbox(label = 'case', { git = true } = {}) {
  // .native also expands Windows 8.3 short names (RUNNER~1), which git and
  // realpath'd companion output report in long form.
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), `codex-staff-test-${label}-`))
  );
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  fs.mkdirSync(repo);
  fs.mkdirSync(home);

  if (git) {
    const init = spawnSync('git', ['init', '-q'], { cwd: repo, encoding: 'utf8' });
    if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);

    // Most fixtures start with state already ignored. A separate test checks
    // the companion's automatic exclusion on first use.
    fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '\n.codex-staff/\n');
  }

  return { root, repo, home, git, argvFile: path.join(root, 'codex-argv.jsonl') };
}

/** Run the companion CLI in a sandbox. Returns {code, stdout, stderr}.
 *  `input` feeds the child's stdin (for --stdin). */
export function run(sb, args, extraEnv = {}, { input } = {}) {
  const r = spawnSync(process.execPath, [COMPANION, ...args], {
    cwd: sb.repo,
    input,
    encoding: 'utf8',
    timeout: 90_000,
    env: {
      ...process.env,
      HOME: sb.home,
      CODEX_HOME: path.join(sb.home, '.codex'),
      USERPROFILE: sb.home, // os.homedir() reads this on Windows, HOME elsewhere
      CODEX_BIN: FAKE_CODEX,
      FAKE_CODEX_ARGV_FILE: sb.argvFile,
      // Keep enough latency to inspect a running job before completion.
      FAKE_CODEX_SLEEP_MS: '300',
      ...extraEnv,
    },
  });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** Every argv the fake codex has seen so far, oldest first. */
export function codexCalls(sb) {
  if (!fs.existsSync(sb.argvFile)) return [];
  return fs
    .readFileSync(sb.argvFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Prompt input corresponding to one invocation, recorded separately from argv. */
export function prompts(sb) {
  return fs.readFileSync(sb.argvFile + '.stdin', 'utf8').trim().split('\n').map(line => JSON.parse(line));
}

/**
 * The worker's log file for a job. Both stdout and stderr of the detached
 * worker land here, so this is where a background run's `[codex-staff]`
 * telemetry lives (it is deliberately absent from the result file).
 */
export function jobLog(sb, jobId) {
  const logFile = path.join(sb.repo, '.codex-staff', 'jobs', `${jobId}.log`);
  return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
}

/** The stored result file of a job, exactly as wait/result print it. */
export function jobResultFile(sb, jobId) {
  const f = path.join(sb.repo, '.codex-staff', 'jobs', `${jobId}.result.md`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
}

/** The `job id: <id>` printed by a background dispatch. */
export function jobIdOf(stdout) {
  const m = /job id:\s*(\S+)/.exec(stdout);
  if (!m) throw new Error(`no job id in output:\n${stdout}`);
  return m[1];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for a durable result before assertions that need terminal metadata. */
// Windows workers pay for PowerShell process-table queries at startup and on
// cleanup; a cold runner can spend most of the 10 s POSIX budget on those.
async function waitForWorker(sb, jobId, { tries = process.platform === 'win32' ? 600 : 200, delayMs = 50 } = {}) {
  const resultFile = path.join(sb.repo, '.codex-staff', 'jobs', `${jobId}.result.md`);
  for (let i = 0; i < tries; i++) {
    if (fs.existsSync(resultFile)) {
      await sleep(200);
      return;
    }
    await sleep(delayMs);
  }
  throw new Error(`worker for ${jobId} never produced ${resultFile}`);
}

/**
 * Poll `status <id>` until the job leaves "running". Returns the terminal
 * status string.
 */
export async function waitForJob(sb, jobId, { tries = 40, delayMs = 100 } = {}) {
  await waitForWorker(sb, jobId);
  let last = 'unknown';
  for (let i = 0; i < tries; i++) {
    const r = run(sb, ['status', jobId]);
    const m = /"status":\s*"([a-z]+)"/.exec(r.stdout);
    last = m ? m[1] : `unknown (${r.stdout.trim() || r.stderr.trim()})`;
    if (last === 'done' || last === 'error' || last === 'crashed' || last === 'canceled' || last === 'attention') return last;
    await sleep(delayMs);
  }
  throw new Error(`job ${jobId} never left "running" (last: ${last})`);
}

/** Wait until at least n codex calls have been recorded. */
export async function waitForCalls(sb, n, { tries = 150, delayMs = 50 } = {}) {
  for (let i = 0; i < tries; i++) {
    const calls = codexCalls(sb);
    if (calls.length >= n) return calls;
    await sleep(delayMs);
  }
  throw new Error(`only ${codexCalls(sb).length} codex call(s) recorded, wanted ${n}`);
}
