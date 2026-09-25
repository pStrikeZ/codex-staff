# Codex Staff

[简体中文](README.zh-CN.md)

Delegate work to **Codex CLI** from Claude Code or Pi. Adapted from [agy-staff](https://github.com/keli-wen/agy-staff), with a Codex JSONL execution adapter, persistent jobs, progress snapshots, cancellation and thread continuation. Node.js standard library only; no npm dependencies.

| Skill | Companion command | Purpose |
| --- | --- | --- |
| staffer | `staffer` | General task with a minimal brief |
| researcher | `research` | Research with evidence and explicit uncertainty |
| reviewer | `review` | Code, plan or decision review; optional JSON findings |
| implementer | `implement` | Scoped implementation and verification |
| ask | `ask` | Synchronous concise answer |
| lead | — | Host workflow for delegation, integration and delivery |
| jobs | Job commands | Collection, observation, cancellation and recovery |

## Requirements

- Node.js 20 or newer.
- Codex CLI installed and authenticated (`codex --version`, `codex login`). The adapter uses `codex exec --json`, `exec resume` and `--output-schema`; integration is tested with Codex CLI 0.157.0.
- Git is optional. In a repository, state is shared by commands within the same worktree; outside Git, it lives in the current directory.

The companion inherits your existing Codex provider, model and reasoning settings. `--model` and `--effort` independently override them. It never silently substitutes a model.

## Try the companion

Run from the workspace you want Codex to work in. Replace `/path/to/codex-staff` with this checkout's absolute path:

```bash
node /path/to/codex-staff/companion/codex-companion.mjs setup
node /path/to/codex-staff/companion/codex-companion.mjs ask --prompt "Reply with OK"
node /path/to/codex-staff/companion/codex-companion.mjs research --prompt "Explain the entrypoints in this project"
node /path/to/codex-staff/companion/codex-companion.mjs wait <job-id> --timeout 10m
```

Use exactly one task source: `--prompt <text>`, `--prompt-file <path>` or `--stdin`. Prompts reach Codex over stdin without a shell. Long briefs work best as files.

`ask` waits and prints its answer. The four other modes return a background job ID; `wait` prints the saved result. An expiring wait returns exit code **2** and leaves the same job running. Wait again for that ID. Use `observe <id>` for a bounded progress snapshot, `cancel <id>` to stop execution, and `continue --job <id> --prompt <text>` for a follow-up in the same Codex thread. `restart <id>` starts the saved task in a fresh thread.

## Install host skills

These commands install the local checkout; no published package or repository URL is assumed.

**Claude Code:**

```bash
claude plugin marketplace add /absolute/path/to/codex-staff
claude plugin install codex-staff@codex-staff
```

Restart the host and use `/codex-staff:staffer` or another persona. For a temporary session, `claude --plugin-dir /absolute/path/to/codex-staff` also loads the plugin.

**Pi:**

```bash
pi install /absolute/path/to/codex-staff
```

Run `/reload`, then `/skill:codex-staffer` (or `codex-researcher`, `codex-reviewer`, `codex-implementer`, `codex-ask`, `codex-lead`, `codex-jobs`). Pi entrypoints are generated from `skills/`.

Details: [installation for agents](docs/INSTALL_FOR_AGENTS.md).

## Permissions and state

Matching agy-staff, tool-using modes default to **unrestricted** execution. `ask` always uses a read-only sandbox. To configure restricted defaults:

```bash
node /path/to/codex-staff/companion/codex-companion.mjs setup --restrict staffer,research,review,implement
```

Restricted research/review use `read-only`; restricted staffer/implement use `workspace-write`. Every run disables interactive approvals (`approval_policy="never"`). Explicit `--restricted` / `--unrestricted` overrides repository defaults. MCP services retain their own permissions, and the launching host must permit Codex to run. `ask` requests no tools in its prompt; this is not a tool-free API.

State, prompts, reports and diagnostics live under `.codex-staff/`. The first run adds this directory to Git's local exclude file when possible. Success with no warnings removes raw event/progress files; warnings and failures retain them. Specs and reports remain for continuation and recovery. These files may contain task data; do not publish them.

The execution deadline defaults to **60 minutes** (ask: **2 minutes**), with a maximum of **120 minutes**. It is separate from `wait --timeout`. A hard deadline terminates execution and preserves diagnostics; it never automatically launches a retry. Cancellation stops work without reverting edits. See [command reference](docs/REFERENCE.md) for exit codes, JSON review and recovery.

## Development

```bash
npm run generate:pi
npm run check:pi
npm test
npm pack
```

No `npm install` is needed. Tests use an isolated fake Codex executable; the packaging test extracts the actual npm archive and runs its companion. Opt-in real CLI tests use your configured Codex account: see [tests](docs/TESTING.md).

Edit canonical skills in `skills/`, then regenerate `pi-skills/`. Main code is in `companion/`; task prompts and the review schema are in `templates/`. Keep `package.json` and both plugin manifest versions aligned when releasing. Windows process handling has offline coverage; real Windows Codex integration is not verified.

MIT licensed; original agy-staff attribution is preserved in [LICENSE](LICENSE) and [NOTICE](NOTICE).
