# Troubleshooting

- CLI launch failure: run `codex --version`, check PATH, or set `CODEX_BIN` to an executable or Node entrypoint. Node.js 20+ is required by the companion.
- Authentication/provider/model error: inspect the stored job log and run Codex directly with the same configuration. Authenticate with `codex login` if required. The companion does not substitute models or retry failed paid tasks.
- Sandbox denial: check the host execution context and the job's restricted/unrestricted profile. Change permissions only within the user's authorization. Setup does not create global command allowlists.
- Missing JSONL completion: inspect `.events.jsonl` and `.log`. A final-looking message without `turn.completed` is not a successful job. Raw output survives failures and warnings.
- Continuation failure: ensure the original Codex session still exists under the same `CODEX_HOME`. `--conversation` is a Codex thread ID; `--job` is a companion job ID. Resume a stopped thread, not a running one.
- Suspected crash: collect in the same permission context as launch. A process invisible from a sandbox may still be running outside it. Inspect the worker handle before starting another run.
- Corrupt state: preserve `.codex-staff/state.json` and the per-job files before repair; parse failures never reset the registry automatically.
- Changing installation copies: restart the host after updating the plugin. Existing threads may retain their loaded skill instructions.
