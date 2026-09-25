---
name: codex-ask
description: Ask Codex CLI a concise question or run a Codex Staff installation smoke test when the user requests it.
---

<!-- Generated from skills/ask/SKILL.md; run npm run generate:pi. Do not edit here. -->

# Ask Codex

Run from the target workspace, resolving this file at `<plugin-root>/pi-skills/codex-ask/SKILL.md`:

```bash
node "<skill-dir>/../../companion/codex-companion.mjs" ask --prompt "reply with OK"
```

The call waits and prints the answer on stdout. It also records a job so an interrupted host wait can be recovered with jobs. For long questions, use `--prompt-file <path>` or `--stdin` instead. Default deadline is 2 minutes; `--timeout` overrides it. Model and effort inherit the user's Codex configuration unless explicitly selected.

The prompt asks for an answer without tools, and the CLI uses a read-only sandbox with approvals disabled. This is a prompt convention, not a tool-free API: configured MCP services can still exist and their permissions are separate. `--unrestricted` does not change ask's sandbox. Use researcher when the assignment requires investigation.

Return the answer faithfully, including uncertainty. Telemetry on stderr is for the host. `--continue` resumes the last ask thread; `continue --job <id> --prompt <text>` targets a particular run. Read [jobs](../codex-jobs/SKILL.md) for failure, timeout and continuation handling.

## Host compatibility

When this skill or its referenced instructions require a tool that the current environment does not provide, use available capabilities to achieve an equivalent result. Adapt only the tool-specific execution method; preserve the task goal, authorization requirements, explicit confirmation steps, result delivery, and stopping conditions.

If an equivalent result cannot be achieved, or you cannot establish that an alternative is equivalent, explain the missing capability and its impact, and ask the user for help. Do not silently skip requirements or bypass the environment's restrictions.
