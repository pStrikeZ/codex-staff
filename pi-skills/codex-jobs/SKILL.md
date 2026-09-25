---
name: codex-jobs
description: Collect, inspect, cancel, continue or restart Codex Staff jobs, or configure their repository permission defaults.
---

<!-- Generated from skills/jobs/SKILL.md; run npm run generate:pi. Do not edit here. -->

# Codex jobs

This file lives at `<plugin-root>/pi-skills/codex-jobs/SKILL.md`. Run every command from the target worktree using:

```bash
node "<skill-dir>/../../companion/codex-companion.mjs" <command> [arguments]
```

Job state is under `.codex-staff/` at the Git worktree root, or cwd outside Git. Commands from subdirectories share the worktree state; continuation returns to the original launch directory. Use the same host permission context for dispatch and collection. Follow actual host restrictions; request help only when they prevent the task.

## Collect a result

After a task returns an ID, run `wait <id> --timeout 10m` using the host's supported background command mechanism. Keep one pending wait per job and collect that handle. If the host requires polling its command handle, use a long supported blocking wait. A host observation timeout does not stop or restart the worker.

| Exit | Meaning | Action |
| --- | --- | --- |
| 0 | Done; wait/result printed the stored response | Assess it and inspect required artifacts |
| 1 | Invalid invocation or state | Correct the command or diagnose the reported issue |
| 2 | Still running; wait's observation time expired | Wait again for the same job |
| 3 | Failed or worker crashed | Collect diagnostics and account for partial changes |
| 4 | Canceled | Inspect any partial changes |
| 5 | Hard timeout with a resumable thread | Inspect partial changes and decide recovery with the user |

`status <id>`, `observe` and `wait` use these state codes. `result` uses them for stored reports, but returns 1 when the job is running or no report exists. `cancel` returns 0 after confirmed cancellation or when already stopped. `observe` returning 0 only reports terminal metadata; it does not deliver the full response. Collect a pending wait or use result afterwards.

Follow through unless the user asked only to launch. Short results can be delivered faithfully; summarize long reports with their saved path. A successful Codex turn is execution success, not proof that its answer or changes meet the brief. For implementation, inspect `git status --short`, `git diff` and relevant verification, preserving prior user changes.

## Job commands

| Command | Purpose |
| --- | --- |
| `status [id]` | List recent jobs, or inspect one record and a bounded log tail |
| `observe [id]` | Bounded JSON progress snapshot, or terminal collection/recovery metadata |
| `wait [id] --timeout 10m` | Wait for completion and print the report; default observation limit is 100 seconds |
| `result [id]` | Print the stored report; defaults to the latest finished job |
| `cancel <id>` | Request stop and wait for the worker to terminate its process tree |
| `continue --job <id> --prompt-file <brief>` | Resume the recorded Codex thread with a linked new job |
| `continue --prompt <text>` | Resume the most recent recorded thread |
| `restart <id>` | Rerun the stored task in a fresh thread with current workspace context |
| `setup [--restrict review,research]` | Probe Codex and optionally set repository defaults |

Use observe when the user asks for progress, or when diagnosing a failure or intervention. It returns up to five recent activities, bounded input/output previews, timestamps and the latest response excerpt. It does not consume history or extend execution time. Avoid routine progress polling and redundant log reads.

## Continue, cancel and recover

Continue inherits mode, explicitly selected model/effort, permission profile, schema and original cwd. Model or effort flags can override their respective inherited values. With no recorded explicit model, Codex uses its own session/configuration behavior. A running thread refuses follow-ups; nothing is queued. If feedback can wait, collect the result first. If the user redirects active work immediately, cancel, confirm termination, then continue with the new brief. Existing authorization covers this sequence. Cancellation does not undo edits.

The hard deadline is separate from wait: 60 minutes by default, at most 120 minutes for every mode; ask defaults to 2 minutes. A hard timeout stops execution even if partial text exists. The report retains the thread ID, settings, logs and snapshot. Inspect partial artifacts before recovery. Prefer continue when the thread is available, otherwise restart. Each creates a new job and preserves the previous record. The suggested recovery doubles the deadline up to the 120-minute ceiling. Obtain the user's direction after an execution timeout before starting another paid run; a soft wait expiry needs no new execution or approval.

A crash or cancellation error is not proof all descendants stopped. Inspect the original worker and logs from the same execution context. Never signal a stored numeric PID yourself or assume a stale lock means the worker is dead.

See [setup](references/setup.md) for permission profiles and [troubleshooting](references/troubleshooting.md) for launch, authentication and protocol failures.

## Host compatibility

When this skill or its referenced instructions require a tool that the current environment does not provide, use available capabilities to achieve an equivalent result. Adapt only the tool-specific execution method; preserve the task goal, authorization requirements, explicit confirmation steps, result delivery, and stopping conditions.

If an equivalent result cannot be achieved, or you cannot establish that an alternative is equivalent, explain the missing capability and its impact, and ask the user for help. Do not silently skip requirements or bypass the environment's restrictions.
