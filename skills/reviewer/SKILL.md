---
name: reviewer
description: Delegate an independent review of code, a plan or a decision to Codex CLI when the user asks for a Codex review or invokes the Codex Staff reviewer.
---

# Codex reviewer

Identify the subject and intended outcome. For code, read [code review guidance](references/code-review.md); for a plan or decision, read [general review guidance](references/general-review.md). Include the relevant review criteria in the brief. Request evidence and concrete failure conditions; keep unverified concerns separate. `--json` requests schema-constrained findings with verdict, summary, findings and could_not_verify.

## Dispatch

Read [jobs](../jobs/SKILL.md) for collection, continuation and recovery. This file is at `<plugin-root>/skills/reviewer/SKILL.md`; resolve the companion relative to its directory and run from the target workspace:

```bash
node "<skill-dir>/../../companion/codex-companion.mjs" review --prompt-file "<brief-path>"
```

Pass the user's task and explicit authorizations accurately. A temporary brief file avoids shell quoting problems; `--prompt <text>` and `--stdin` are alternatives. Use exactly one input source. Do not add new side effects to the assignment.

Model and reasoning effort follow the user's Codex configuration. Pass `--model <id>` and `--effort <level>` only when requested or already specified for this task. They are independent options. Default execution is unrestricted, matching the source plugin; use `--restricted` when the task calls for sandboxing. Follow the host's actual execution permissions. The worker cannot grant the host additional access.

The command returns a job ID. Collect it with `wait <id>` as described in jobs. Default hard execution limit: 60 minutes, configurable with `--timeout`, up to 120 minutes. An expiring wait leaves the job running.

For direct invocations, deliver short results faithfully; summarize long reports and provide their saved path. Under lead, assess and synthesize the result. Review any workspace changes and check that external delivery was explicitly authorized.
