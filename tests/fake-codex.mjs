#!/usr/bin/env node
// Deterministic Codex JSONL fixture; no network or user configuration.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const env = process.env;
const argv = process.argv.slice(2);
if (argv.includes('--version')) { console.log('codex-cli 0.157.0-fake'); process.exit(0); }
if (argv[0] !== 'exec' || !argv.includes('--json') || argv.at(-1) !== '-') {
  console.error('Expected codex exec [resume] --json ... -'); process.exit(2);
}
const input = fs.readFileSync(0, 'utf8');
if (env.FAKE_CODEX_ARGV_FILE) {
  fs.appendFileSync(env.FAKE_CODEX_ARGV_FILE, JSON.stringify(argv) + '\n');
  fs.appendFileSync(env.FAKE_CODEX_ARGV_FILE + '.stdin', JSON.stringify(input) + '\n');
}
if (env.FAKE_CODEX_CWD_FILE) fs.writeFileSync(env.FAKE_CODEX_CWD_FILE, process.cwd());
if (env.FAKE_CODEX_TOUCH_FILE) {
  const target = path.resolve(env.FAKE_CODEX_TOUCH_FILE);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'written by fake Codex\n');
}
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
if (!env.FAKE_CODEX_NO_JSON) {
  emit({ type: 'thread.started', thread_id: env.FAKE_CODEX_CONVERSATION_ID ?? 'conv-1' });
  emit({ type: 'turn.started' });
  for (const event of JSON.parse(env.FAKE_CODEX_EVENTS || '[]')) emit(event);
}
if (process.env.FAKE_CODEX_CHILD_PID_FILE) {
  const descendantCode = "process.on('SIGTERM', () => {}); setTimeout(() => process.exit(0), 30000); setInterval(() => {}, 1000)";
  if (process.env.FAKE_CODEX_ORPHAN_RELEASE_FILE) {
    const intermediary = `const fs = require('fs'); const child = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendantCode)}], { detached: true, stdio: 'ignore' }); child.unref(); fs.writeFileSync(process.env.FAKE_CODEX_CHILD_PID_FILE, String(child.pid)); setInterval(() => { if (fs.existsSync(process.env.FAKE_CODEX_ORPHAN_RELEASE_FILE)) process.exit(0); }, 25);`;
    spawn(process.execPath, ['-e', intermediary], { stdio: 'ignore' });
  } else {
    const child = spawn(process.execPath, ['-e', descendantCode], { detached: !process.env.FAKE_CODEX_INHERIT_STDIO, stdio: process.env.FAKE_CODEX_INHERIT_STDIO ? ['ignore', 1, 2] : 'ignore' });
    fs.writeFileSync(process.env.FAKE_CODEX_CHILD_PID_FILE, String(child.pid));
  }
}
if (process.env.FAKE_CODEX_IGNORE_TERM) process.on('SIGTERM', () => {});

const sleepMs = Number(process.env.FAKE_CODEX_SLEEP_MS || 0);
if (sleepMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, sleepMs));
}
if (process.env.FAKE_CODEX_RELEASE_FILE) {
  while (!fs.existsSync(process.env.FAKE_CODEX_RELEASE_FILE)) await new Promise(resolve => setTimeout(resolve, 25));
}


if (env.FAKE_CODEX_STDERR) process.stderr.write(env.FAKE_CODEX_STDERR + '\n');
if (env.FAKE_CODEX_NO_JSON) {
  if (env.FAKE_CODEX_STDOUT) console.log(env.FAKE_CODEX_STDOUT);
  process.exit(Number(env.FAKE_CODEX_EXIT || 1));
}
const response = env.FAKE_CODEX_RESPONSE ?? (argv.includes('--output-schema')
  ? JSON.stringify({ verdict: 'approve', summary: 'fixture review', findings: [], could_not_verify: [] }) : 'fake answer');
if (response) emit({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: response } });
if (!env.FAKE_CODEX_NO_TURN) {
  emit(env.FAKE_CODEX_STATUS === 'ERROR'
    ? { type: 'turn.failed', error: { message: env.FAKE_CODEX_ERROR || 'fixture failure' } }
    : { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0 } });
}
if (env.FAKE_CODEX_RESULT_FILE) fs.writeFileSync(env.FAKE_CODEX_RESULT_FILE, 'result sent');
if (env.FAKE_CODEX_AFTER_RESULT_MS) await new Promise(resolve => setTimeout(resolve, Number(env.FAKE_CODEX_AFTER_RESULT_MS)));
process.exit(Number(env.FAKE_CODEX_EXIT || 0));
