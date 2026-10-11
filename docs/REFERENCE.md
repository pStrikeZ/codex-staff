# Command reference

All examples below use `codex-staff` for `node /absolute/path/to/codex-staff/companion/codex-companion.mjs`. If installed as an npm executable, the `codex-staff` bin provides the same entrypoint.

## Tasks

```text
staffer | research | review | implement | ask
  --prompt <text> | --prompt-file <path> | --stdin
  [--model <id>] [--effort <level>]
  [--restricted | --unrestricted] [--timeout <duration>]
  [--continue | --conversation <thread-id>]
  [--json]  (review only)
```

Use one input source, at most 2 MiB. There is no positional task text or shell re-parsing. Prompt files are resolved from the caller's directory before returning to a resumed job's original cwd. `--continue` selects the last thread for that mode; `--conversation` explicitly selects a Codex thread. Generic `continue` only accepts a locally recorded thread so the mode and settings can be recovered.

Model and effort are independent; omitted options use Codex configuration/session behavior. Supported effort spellings are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra`; the selected provider/model must support the chosen value. An unsupported selection fails with diagnostics and no fallback.

Durations use `ms`, `s`, `m` or `h`. Execution limits must be positive and at most 120m; defaults are 2m for ask and 60m otherwise. `wait` has its own observation timeout (default 100s, zero allowed for an immediate check).

## Permissions

| Mode | Default | With `--restricted` |
| --- | --- | --- |
| ask | read-only | read-only |
| research, review | danger-full-access | read-only |
| staffer, implement | danger-full-access | workspace-write |

`approval_policy="never"` is explicit for new and resumed turns. Ask ignores `--unrestricted`. The host sandbox and MCP server permissions remain independent. The ask prompt requests no tools; it does not remove configured tools.

`setup --restrict research,review` writes defaults under `.codex-staff/config.json`; `setup --restrict none` clears them. Explicit flags override repository defaults. Continuation inherits the selected prior job's profile unless a flag overrides it.

## Review JSON

`review --json` supplies `templates/review.schema.json` to `codex exec --output-schema` and validates the final response. Successful `wait` / `result` output and the saved result contain only JSON, with diagnostics retained in the job log (the `log_file` shown by `status <id>`):

```json
{
  "verdict": "approve",
  "summary": "What was checked and the conclusion",
  "findings": [],
  "could_not_verify": []
}
```

Verdicts: `approve`, `request_changes`, `comment`. Each finding has string fields `severity`, `file`, `line`, `title`, `detail`; severity is `critical`, `high`, `medium`, `low` or `nit`. All fields are required and extra keys are rejected. Failures return a diagnostic report with a nonzero exit code. Continue and restart retain the schema.

## Jobs

| Command | Result |
| --- | --- |
| `status [id]` | Recent jobs, or full record and bounded log tail |
| `observe [id]` | JSON snapshot, at most 8 KiB; latest job by default |
| `wait [id] --timeout 10m` | Wait and print saved report; latest job by default |
| `result [id]` | Saved report; most recent finished job by default |
| `cancel <id>` | Request cancellation and await worker cleanup |
| `continue --job <id> --prompt <text>` | New linked job in the original thread |
| `continue --conversation <thread-id> --prompt <text>` | Resume a locally recorded thread |
| `continue --prompt <text>` | Resume last recorded thread |
| `restart <id> [--timeout <duration>]` | Saved task in a new thread, with fresh context |

`wait` and `result` deliver the complete report on stdout. Successful delivery does not replay diagnostics on stderr; inspect the `log_file` returned by `status <id>` for retained warnings and logs. A successful `wait` already delivers the report, so a separate `result` call is unnecessary.

`continue` also accepts model, effort, profile, timeout and review JSON options. It inherits the selected job's original cwd, mode, explicit model/effort, profile and schema. Restart retains saved settings and uses a fresh default execution budget unless `--timeout` is supplied. Running threads reject follow-ups; no request is queued. Cancel and confirm terminal status before redirecting active work.

| Exit | Meaning |
| --- | --- |
| 0 | Success; wait/result delivered the report |
| 1 | Invalid invocation, unavailable result or state error |
| 2 | Running; observation timeout expired |
| 3 | Execution error or crashed worker |
| 4 | Canceled |
| 5 | Hard timeout with a recorded resumable thread |

`status <id>`, `observe` and `wait` use job state codes. `result` on a running job or one without a saved report is an unavailable-result error (1). Listing status is 0; `cancel` is 0 after confirmed cancellation or when already stopped. `observe` does not read or deliver the full result. A successful Codex turn still needs acceptance against the task's requirements.

## OpenCode

The dependency-free `opencode.mjs` entrypoint implements the OpenCode V1 plugin config hook (range `>=1.18.34 <2`, the same as upstream agy-staff; the opt-in integration test `npm run test:opencode` checks it against a real OpenCode install). Install the full package with `opencode plugin 'codex-staff@git+https://github.com/pStrikeZ/codex-staff.git' --global`, then restart OpenCode and run `/codex-ask reply with OK`. The companion requires Node.js and an authenticated `codex` on PATH. OpenCode V2 is not covered.

The native installer adds a package entry to the `plugin` array in the OpenCode config. The equivalent configuration is:

```json
{
  "plugin": ["codex-staff@git+https://github.com/pStrikeZ/codex-staff.git"]
}
```

The plugin appends its absolute bundled `opencode-skills/` directory to `skills.paths`, preserving existing paths and avoiding duplicates. OpenCode discovers seven branded skills and exposes them as same-named slash commands: `/codex-ask`, `/codex-staffer`, `/codex-researcher`, `/codex-reviewer`, `/codex-implementer`, `/codex-jobs` and `/codex-lead`. No command wrappers are installed; existing skill permissions still apply.

`npm run generate:opencode` generates these entrypoints from canonical `skills/` (same mechanism as Pi: asset copying, invocation and sibling-path rewriting, appended `templates/harness-compatibility.md`). `npm run generate:skills` generates both hosts and `npm run check:skills` verifies them. Install the whole package; copying only the plugin file would lose its relative resources. The package intentionally has no `prepack` or `prepare` hook, since those make OpenCode's Git installer invoke nested npm and fail; use `npm run pack:checked` (validates, then packs) and `prepublishOnly` for release checks.

For local development, run `opencode plugin /absolute/path/to/checkout --global`, regenerate with `npm run generate:skills`, and restart OpenCode. For Git installs, OpenCode caches by the full package spec; restart or `--force` alone does not refresh an unchanged spec. Upgrade by choosing a newer tag or commit and running `opencode plugin 'codex-staff@git+https://github.com/pStrikeZ/codex-staff.git#<tag-or-commit>' --global --force`, then restart. The selected ref must contain this adapter.

## State and recovery

`.codex-staff/state.json` is a locked, atomically replaced registry. `jobs/<id>` files include `.spec.json`, `.log`, `.result.md`, `.result.md.status.json`, `.events.jsonl` and `.progress.json`. Final status is published after the report is durable. Job registration precedes spawning, and thread occupancy is rechecked while holding the registry lock.

Progress shows at most five recent tools and a bounded response excerpt. Unknown/malformed events produce warnings and remain in raw output. Raw events and progress are removed only for clean success. Reports and specs remain. Codex itself owns its sessions under `CODEX_HOME`; a companion job ID is different from its Codex thread ID.

The hard deadline and cancellation terminate the worker's identified execution tree before publication of a terminal report. A completion event without process success cannot mark the job done. Cleanup checks process birth identities to avoid signaling reused PIDs. If process inspection is unavailable, diagnostics say so; terminal metadata does not prove escaped descendants stopped. Host permission changes can hide a live worker: collect from the original execution context before restarting.

Timeout reports retain thread/settings, partial activity, workspace status and suggested recovery. They never retry automatically. Inspect partial work and obtain direction for the next execution. `continue` uses the existing thread; `restart` rebuilds the stored task against current workspace context. Cancellation and failures never roll back files. Git porcelain summaries can miss further edits to already dirty files: inspect actual diffs and artifacts.

## Protocol reference

The adapter follows the [official Codex non-interactive documentation](https://developers.openai.com/codex/noninteractive/) and the installed CLI help. It consumes `thread.started`, `turn.started`, `item.*`, `turn.completed`, `turn.failed` and `error`. Success requires a nonempty final `agent_message`, `turn.completed`, a zero process exit, and no intervening hard timeout or cancellation. Authentication, provider configuration and session persistence stay with Codex.
