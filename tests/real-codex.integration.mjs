// Opt in explicitly: this suite uses the installed Codex and its authentication.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { COMPANION, jobIdOf } from './helpers.mjs';

test('real Codex: answer, resume, implementation, structured review', {
  skip: process.env.CODEX_STAFF_REAL_TESTS !== '1' && 'set CODEX_STAFF_REAL_TESTS=1 to use your Codex account',
  timeout: 600_000,
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-staff-real-'));
  console.log(`Real integration workspace: ${root}`);
  const invoke = args => {
    const result = spawnSync(process.execPath, [COMPANION, ...args], {
      cwd: root, env: process.env, encoding: 'utf8', timeout: 160_000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${args[0]} failed:\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  const jobs = () => JSON.parse(fs.readFileSync(path.join(root, '.codex-staff/state.json'), 'utf8')).jobs;
  const first = invoke(['ask', '--timeout', '2m', '--prompt', 'Remember the marker ORCHID-731. Reply only with ORCHID-731.']);
  assert.match(first, /ORCHID-731/);
  const id = jobs().at(-1).id;
  const thread = jobs().at(-1).conversation_id;
  const resumed = invoke(['continue', '--job', id, '--timeout', '2m', '--prompt', 'Reply only with the marker I asked you to remember.']);
  assert.match(resumed, /ORCHID-731/);
  assert.equal(jobs().at(-1).conversation_id, thread);
  const implemented = jobIdOf(invoke(['implement', '--restricted', '--timeout', '2m', '--prompt',
    'Create only proof.txt in the current directory with exactly the text CODEX_STAFF_OK followed by a newline. Do not commit, access the network, delegate, or alter other files. Read it back and report completion.']));
  invoke(['wait', implemented, '--timeout', '130s']);
  assert.equal(fs.readFileSync(path.join(root, 'proof.txt'), 'utf8'), 'CODEX_STAFF_OK\n');
  const reviewed = jobIdOf(invoke(['review', '--restricted', '--json', '--timeout', '2m', '--prompt',
    'Review this complete statement provided inline: two plus two equals four. Do not use tools or delegate. Return approve if correct, an empty findings array, and no unverifiable claims.']));
  const review = JSON.parse(invoke(['wait', reviewed, '--timeout', '130s']));
  assert.equal(review.verdict, 'approve');
  assert.deepEqual(review.findings, []);
});
