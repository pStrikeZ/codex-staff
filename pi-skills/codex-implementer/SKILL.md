---
name: codex-implementer
description: Delegate a scoped code change and its verification to Codex CLI when the user asks Codex to implement a task or invokes the Codex Staff implementer.
---

<!-- Generated from skills/implementer/SKILL.md; run npm run generate:pi. Do not edit here. -->

# Codex implementer

Include the desired behavior, relevant constraints and acceptance checks. Preserve existing workspace changes. The worker receives a bounded pre-run Git status summary. Inspect the resulting diff and verification before integrating it; an execution marked done is not acceptance of the implementation.

## Dispatch

Read [jobs](../codex-jobs/SKILL.md) for collection, continuation and recovery. This file is at `<plugin-root>/pi-skills/codex-implementer/SKILL.md`; resolve the companion relative to its directory and run from the target workspace:

```bash
node "<skill-dir>/../../companion/codex-companion.mjs" implement --prompt-file "<brief-path>"
```

Pass the user's task and explicit authorizations accurately. A temporary brief file avoids shell quoting problems; `--prompt <text>` and `--stdin` are alternatives. Use exactly one input source. Do not add new side effects to the assignment.

Model and reasoning effort follow the user's Codex configuration. Pass `--model <id>` and `--effort <level>` only when requested or already specified for this task. They are independent options. Default execution is unrestricted, matching the source plugin; use `--restricted` when the task calls for sandboxing. Follow the host's actual execution permissions. The worker cannot grant the host additional access.

The command returns a job ID. Collect it with `wait <id>` as described in jobs. Default hard execution limit: 60 minutes, configurable with `--timeout`, up to 120 minutes. An expiring wait leaves the job running.

For direct invocations, deliver short results faithfully; summarize long reports and provide their saved path. Under lead, assess and synthesize the result. Review any workspace changes and check that external delivery was explicitly authorized.

## Host compatibility

When this skill or its referenced instructions require a tool that the current environment does not provide, use available capabilities to achieve an equivalent result. Adapt only the tool-specific execution method; preserve the task goal, authorization requirements, explicit confirmation steps, result delivery, and stopping conditions.

If an equivalent result cannot be achieved, or you cannot establish that an alternative is equivalent, explain the missing capability and its impact, and ask the user for help. Do not silently skip requirements or bypass the environment's restrictions.
