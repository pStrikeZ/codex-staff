# Verification

`npm test` runs offline Node.js tests with `tests/fake-codex.mjs` in temporary workspaces. No npm install, model request, or third-party test runner is required. It covers:

- Codex argv, stdin prompts, model/effort and permission profiles.
- JSONL parsing, Unicode boundaries, bounded observation and success/failure classification.
- Persistent jobs, status/result/wait, clean versus retained diagnostics.
- Thread occupancy and simultaneous continuation, cwd/settings inheritance and restart.
- Hard deadlines, cancellation after a result event, process identity and descendant cleanup.
- Atomic state updates, lock contention, Windows process-table parsing and PID reuse.
- Generated Pi skills, npm archive contents and companion execution from an extracted package.

`npm run check:pi` verifies generated entrypoints. Tests use temporary directories so failures can be inspected without changing the checkout or personal authentication. The helper has a per-command timeout; Windows cleanup queries are slower, so some waits allow extra time. Actual Windows Codex execution is not certified by parser/unit tests.

## Real CLI test

This opt-in suite uses your installed Codex, existing authentication, provider and model settings. It runs four small turns (ask, resume, implementation, structured review), consuming the account's normal quota:

```bash
CODEX_STAFF_REAL_TESTS=1 npm run test:real
```

PowerShell:

```powershell
$env:CODEX_STAFF_REAL_TESTS = '1'
npm run test:real
```

The test prints its isolated workspace path and retains reports for inspection. The implementation creates only `proof.txt` there; it must contain an exact marker. Resume must recover the marker from the preceding turn, and review must produce parseable JSON. With the environment flag unset, `npm run test:real` skips rather than contacting a model. `CODEX_BIN` may select the real CLI executable to test.

Plugin manifests can additionally be checked with Codex's plugin validator and `claude plugin validate .`. Installing the local marketplace in a temporary `CODEX_HOME` verifies the actual Codex loader without changing your normal installation. Pi's package contract is tested by extracting `npm pack`; live Pi UI discovery requires a Pi host.
