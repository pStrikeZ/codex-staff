import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { sandbox, run, jobIdOf, codexCalls, prompts, waitForCalls, COMPANION, FAKE_CODEX } from './helpers.mjs';
import { createParser, createProjection, bytes, boundSnapshot } from '../companion/observation.mjs';
import { createResult } from '../companion/codex.mjs';

const state = sb => JSON.parse(fs.readFileSync(path.join(sb.repo, '.codex-staff/state.json'), 'utf8'));
const record = (sb, id) => {
  const job = state(sb).jobs.find(job => job.id === id);
  try { return { ...job, ...JSON.parse(fs.readFileSync(job.result_file + '.status.json', 'utf8')) }; }
  catch { return job; }
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 10_000;
  while (!predicate() && Date.now() < deadline) await pause(25);
  assert.ok(predicate(), 'checkpoint not reached');
}
const complete = (sb, args, env) => {
  const started = run(sb, args, env);
  assert.equal(started.code, 0, started.stdout + started.stderr);
  const id = jobIdOf(started.stdout);
  return { id, result: run(sb, ['wait', id, '--timeout', '40s']) };
};
const config = argv => argv.flatMap((arg, i) => arg === '-c' ? [argv[i + 1]] : []);

test('Codex events require a completed turn, and use the final message and thread', () => {
  const result = createResult();
  result.accept({ type: 'thread.started', thread_id: 'thread-1' });
  result.accept({ type: 'turn.started' });
  result.accept({ type: 'item.completed', item: { type: 'agent_message', text: 'commentary' } });
  assert.equal(result.result(), null);
  result.accept({ type: 'item.completed', item: { type: 'agent_message', text: 'final' } });
  result.accept({ type: 'turn.completed', usage: { input_tokens: 8, output_tokens: 3 } });
  assert.equal(result.result().response, 'final');
  assert.equal(result.result().conversation_id, 'thread-1');
  result.accept({ type: 'turn.started' });
  result.accept({ type: 'turn.failed', error: { message: 'provider rejected' } });
  assert.equal(result.result().status, 'ERROR');
  assert.equal(result.result().response, '');
});

test('JSONL parser preserves split UTF-8, skips bad records and resumes after oversized input', () => {
  const events = [], warnings = [];
  const parser = createParser(event => events.push(event), warning => warnings.push(warning), 160);
  const input = Buffer.from('{"text":"日🧪"}\nnot JSON\n' + 'x'.repeat(200) + '\n{"tail":true}');
  for (const byte of input) parser.write(Buffer.from([byte]));
  parser.end();
  assert.deepEqual(events, [{ text: '日🧪' }, { tail: true }]);
  assert.equal(warnings.length, 2);
});

test('observation merges Codex activities, omits reasoning and stays within its byte budget', () => {
  const threads = [], projection = createProjection(id => threads.push(id));
  projection.accept({ type: 'thread.started', thread_id: 'thread' });
  projection.accept({ type: 'item.started', item: { id: 'cmd', type: 'command_execution', command: 'ls' } });
  projection.accept({ type: 'item.completed', item: { id: 'cmd', type: 'command_execution', command: 'ls', exit_code: 1, aggregated_output: 'failed' } });
  assert.equal(projection.snapshot().recent_activities.length, 1);
  assert.equal(projection.snapshot().recent_activities[0].status, 'error');
  projection.accept({ type: 'item.completed', item: { id: 'reason', type: 'reasoning', text: 'private' } });
  projection.accept({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: '文\\"'.repeat(5000) } });
  for (let i = 0; i < 10; i++) projection.accept({ type: 'item.completed', item: { id: `tool-${i}`, type: 'mcp_tool_call', tool: 'read', arguments: 'x'.repeat(5000), result: 'y'.repeat(5000) } });
  const snapshot = boundSnapshot(projection.snapshot());
  assert.deepEqual(threads, ['thread']);
  assert.equal(snapshot.recent_activities.length, 5);
  assert.ok(snapshot.latest_text.truncated);
  assert.ok(bytes(snapshot) + 1 <= 8192);
  assert.doesNotMatch(JSON.stringify(snapshot), /private/);
});

test('all modes pass explicit permissions; model and effort otherwise remain inherited', () => {
  const sb = sandbox('permissions');
  for (const mode of ['staffer', 'research', 'review', 'implement', 'ask']) {
    for (const restricted of [false, true]) {
      const args = [mode, ...(restricted ? ['--restricted'] : []), '--prompt', 'task'];
      const result = mode === 'ask' ? run(sb, args) : complete(sb, args).result;
      assert.equal(result.code, 0, result.stdout + result.stderr);
      const argv = codexCalls(sb).at(-1);
      const sandboxMode = mode === 'ask' ? 'read-only' : !restricted ? 'danger-full-access'
        : ['staffer', 'implement'].includes(mode) ? 'workspace-write' : 'read-only';
      assert.ok(config(argv).includes(`sandbox_mode="${sandboxMode}"`));
      assert.ok(config(argv).includes('approval_policy="never"'));
      assert.equal(argv.includes('--model'), false);
      assert.equal(config(argv).some(value => value.startsWith('model_reasoning_effort=')), false);
    }
  }
  assert.equal(run(sb, ['ask', '--unrestricted', '--prompt', 'task']).code, 0);
  assert.ok(config(codexCalls(sb).at(-1)).includes('sandbox_mode="read-only"'));
});

test('task inputs stay opaque on stdin, including flag-like text and shell syntax', () => {
  const sb = sandbox('input');
  const task = '--model malicious $(touch should-not-exist) `commands` 日本語';
  const file = path.join(sb.repo, 'brief.md'); fs.writeFileSync(file, task);
  for (const [args, input] of [[['--prompt', task]], [['--prompt-file', file]], [['--stdin'], task]]) {
    const result = run(sb, ['ask', ...args], {}, { input });
    assert.equal(result.code, 0, result.stderr);
    assert.ok(prompts(sb).at(-1).includes(task));
    assert.equal(codexCalls(sb).at(-1).includes('--model'), false);
    assert.equal(fs.existsSync(path.join(sb.repo, 'should-not-exist')), false);
  }
  const before = codexCalls(sb).length;
  for (const args of [
    ['ask', 'positional'], ['ask', '--prompt', 'a', '--stdin'],
    ['ask', '--restricted', '--unrestricted', '--prompt', 'a'],
    ['staffer', '--timeout', '121m', '--prompt', 'a'],
    ['ask', '--timeout', '0s', '--prompt', 'a'],
    ['research', '--json', '--prompt', 'a'], ['ask', '--effort', 'typo', '--prompt', 'a'],
  ]) assert.equal(run(sb, args).code, 1, args.join(' '));
  assert.equal(codexCalls(sb).length, before);
});

test('project profiles are reversible, validated and overridden by explicit flags', () => {
  const sb = sandbox('policy');
  assert.equal(run(sb, ['setup', '--restrict', 'review,research']).code, 0);
  let job = complete(sb, ['research', '--prompt', 'task']);
  assert.equal(record(sb, job.id).profile, 'restricted');
  job = complete(sb, ['research', '--unrestricted', '--prompt', 'task']);
  assert.equal(record(sb, job.id).profile, 'unrestricted');
  assert.equal(run(sb, ['setup', '--restrict', 'none']).code, 0);
  assert.equal(run(sb, ['setup', '--restrict', 'ask']).code, 1);
  fs.writeFileSync(path.join(sb.repo, '.codex-staff/config.json'), '{broken');
  assert.equal(run(sb, ['research', '--prompt', 'task']).code, 1);
});

test('first run excludes state locally and can run without Git', () => {
  const sb = sandbox('ignore');
  const exclude = path.join(sb.repo, '.git/info/exclude'); fs.writeFileSync(exclude, '');
  assert.equal(run(sb, ['ask', '--prompt', 'task']).code, 0);
  assert.match(fs.readFileSync(exclude, 'utf8'), /\.codex-staff\//);
  assert.equal(fs.existsSync(path.join(sb.repo, '.gitignore')), false);
  const plain = sandbox('plain', { git: false });
  assert.equal(run(plain, ['ask', '--prompt', 'task']).code, 0);
  assert.ok(codexCalls(plain)[0].includes('--skip-git-repo-check'));
});

test('failed, incomplete, empty and nonzero-exit turns cannot pass as successful jobs', () => {
  for (const env of [
    { FAKE_CODEX_STATUS: 'ERROR', FAKE_CODEX_RESPONSE: 'partial answer' },
    { FAKE_CODEX_NO_TURN: '1' }, { FAKE_CODEX_RESPONSE: '' },
    { FAKE_CODEX_EXIT: '1' }, { FAKE_CODEX_NO_JSON: '1', FAKE_CODEX_STDERR: 'launch failure' },
  ]) {
    const sb = sandbox('failure');
    const { id, result } = complete(sb, ['research', '--prompt', 'task'], env);
    assert.equal(result.code, 3, result.stdout + result.stderr);
    assert.ok(fs.existsSync(record(sb, id).events_file));
    assert.equal(run(sb, ['observe', id]).code, 3);
  }
});

test('structured review stays JSON through result, warnings, continuation and restart', () => {
  const sb = sandbox('schema');
  const { id, result } = complete(sb, ['review', '--json', '--model', 'chosen-model', '--effort', 'low', '--prompt', 'review'], { FAKE_CODEX_TOUCH_FILE: 'changed.txt' });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).verdict, 'approve');
  assert.match(result.stderr, /modified the working tree/);
  assert.deepEqual(JSON.parse(run(sb, ['result', id]).stdout), JSON.parse(result.stdout));
  const next = complete(sb, ['continue', '--job', id, '--prompt', 'again']);
  assert.equal(next.result.code, 0, next.result.stdout);
  assert.equal(JSON.parse(next.result.stdout).verdict, 'approve');
  const argv = codexCalls(sb).at(-1);
  assert.equal(argv[1], 'resume');
  assert.equal(argv[argv.indexOf('--model') + 1], 'chosen-model');
  assert.ok(config(argv).includes('model_reasoning_effort="low"'));
  assert.ok(argv.includes('--output-schema'));
  const fresh = complete(sb, ['restart', id]);
  assert.equal(JSON.parse(fresh.result.stdout).verdict, 'approve');
  assert.equal(codexCalls(sb).at(-1).includes('resume'), false);
  for (const response of ['not json', '{"verdict":"approve"}']) {
    const invalid = complete(sb, ['review', '--json', '--prompt', 'review'], { FAKE_CODEX_RESPONSE: response });
    assert.equal(invalid.result.code, 3);
    assert.match(invalid.result.stdout, /requested JSON schema/);
  }
});

test('continue and restart preserve cwd and selected settings while refreshing dirty context', () => {
  const sb = sandbox('cwd');
  const sub = path.join(sb.repo, 'sub'), caller = path.join(sb.repo, 'caller');
  fs.mkdirSync(sub); fs.mkdirSync(caller);
  const cwdFile = path.join(sb.root, 'cwd');
  const first = complete({ ...sb, repo: sub }, ['implement', '--restricted', '--model', 'chosen', '--effort', 'high', '--prompt', 'original task'], { FAKE_CODEX_CWD_FILE: cwdFile });
  fs.writeFileSync(path.join(sub, 'partial.txt'), 'keep');
  fs.writeFileSync(path.join(caller, 'brief.txt'), 'followup task');
  for (const args of [
    ['continue', '--job', first.id, '--prompt-file', 'brief.txt'],
    ['implement', '--continue', '--prompt-file', 'brief.txt'], ['restart', first.id],
  ]) {
    const { id, result } = complete({ ...sb, repo: caller }, args, { FAKE_CODEX_CWD_FILE: cwdFile });
    assert.equal(result.code, 0, result.stdout);
    assert.equal(fs.readFileSync(cwdFile, 'utf8'), sub);
    assert.equal(record(sb, id).model, 'chosen');
    assert.equal(record(sb, id).effort, 'high');
    assert.equal(record(sb, id).profile, 'restricted');
    assert.match(prompts(sb).at(-1), /Existing workspace changes/);
    assert.equal(fs.readFileSync(path.join(sub, 'partial.txt'), 'utf8'), 'keep');
  }
});

test('hard deadline stops a CLI and its resistant descendant, retaining resumable diagnostics', { skip: process.platform === 'win32' && 'uses POSIX signal semantics' }, async t => {
  const sb = sandbox('deadline');
  const pidFile = path.join(sb.root, 'child.pid');
  const started = run(sb, ['staffer', '--timeout', '3s', '--prompt', 'task'], {
    FAKE_CODEX_SLEEP_MS: '20000', FAKE_CODEX_IGNORE_TERM: '1', FAKE_CODEX_CHILD_PID_FILE: pidFile,
  });
  const id = jobIdOf(started.stdout);
  t.after(() => run(sb, ['cancel', id]));
  await until(() => fs.existsSync(pidFile));
  const result = run(sb, ['wait', id, '--timeout', '15s']);
  assert.equal(result.code, 5, result.stdout + result.stderr);
  assert.equal(record(sb, id).reason, 'hard_timeout');
  assert.equal(record(sb, id).conversation_id, 'conv-1');
  const packet = JSON.parse(run(sb, ['observe', id]).stdout);
  assert.equal(packet.recovery.suggested_timeout, '6s');
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  await until(() => spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim().match(/^Z|^$/));
});

test('cancel after turn.completed wins until the CLI process has exited', async t => {
  const sb = sandbox('late-cancel');
  const sent = path.join(sb.root, 'sent');
  const id = jobIdOf(run(sb, ['staffer', '--prompt', 'task'], { FAKE_CODEX_RESULT_FILE: sent, FAKE_CODEX_AFTER_RESULT_MS: '20000' }).stdout);
  t.after(() => run(sb, ['cancel', id]));
  await until(() => fs.existsSync(sent));
  assert.equal(run(sb, ['cancel', id]).code, 0);
  const result = run(sb, ['wait', id]);
  assert.equal(result.code, 4, result.stdout);
  assert.match(result.stdout, /Execution canceled/);
  assert.equal(record(sb, id).status, 'canceled');
  const next = complete(sb, ['continue', '--job', id, '--prompt', 'new direction']);
  assert.equal(next.result.code, 0, next.result.stdout);
  assert.equal(record(sb, next.id).parent_job_id, id);
});

test('a turn completion event alone cannot bypass the hard deadline', () => {
  const sb = sandbox('deadline-after-result');
  const { id, result } = complete(sb, ['staffer', '--timeout', '2s', '--prompt', 'task'], { FAKE_CODEX_AFTER_RESULT_MS: '10000' });
  assert.equal(result.code, 5, result.stdout);
  assert.equal(record(sb, id).reason, 'hard_timeout');
});

test('parallel dispatch and completion keep independent jobs and outputs', async () => {
  const sb = sandbox('parallel');
  const invoke = n => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [COMPANION, 'staffer', '--prompt', `task-${n}`], {
      cwd: sb.repo, env: { ...process.env, CODEX_BIN: FAKE_CODEX, FAKE_CODEX_CONVERSATION_ID: `thread-${n}`, FAKE_CODEX_RESPONSE: `response-${n}` },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.on('error', reject); child.on('close', code => { assert.equal(code, 0, stderr); resolve(jobIdOf(stdout)); });
  });
  const ids = await Promise.all([0, 1, 2, 3].map(invoke));
  ids.forEach((id, n) => {
    const result = run(sb, ['wait', id]);
    assert.equal(result.code, 0, result.stdout);
    assert.match(result.stdout, new RegExp(`response-${n}`));
    assert.equal(record(sb, id).conversation_id, `thread-${n}`);
  });
  assert.equal(state(sb).jobs.length, 4);
});
