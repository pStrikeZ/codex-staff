---
name: codex-lead
description: Coordinate an ongoing task using Codex CLI workers when the user invokes Codex Staff lead or explicitly asks for this delegation workflow.
---

<!-- Generated from skills/lead/SKILL.md; run npm run generate:pi. Do not edit here. -->

# Codex lead

Own communication, task decisions, acceptance, integration and delivery in the current host. Use the user's assignment as the scope; apply the workflow beyond it only when asked.

1. Orient enough to write a concrete brief with the desired outcome, relevant context, existing authorizations and completion evidence. Workers see their own brief and thread, not intervening host discussion.
2. Delegate substantive work to staffer by default. Use researcher, reviewer or implementer when its guidance improves the assignment. Keep small work local when handing it off and reviewing it would cost more.
3. Keep related context in one thread. Settle shared interfaces before parallel work. Editing workers need separate Git worktrees; otherwise run them sequentially. Include necessary verification in implementation assignments.
4. Read [jobs](../codex-jobs/SKILL.md), dispatch, then collect the final result. Advance already identified independent host work while waiting. Use observe for explicit progress requests or diagnosis.
5. Assess results against the brief. Inspect artifacts, diffs and verification. Continue the existing thread for focused revisions, including new user decisions; use a fresh thread when independent context is needed.
6. Integrate accepted work, disclose meaningful limits, and complete the user's requested delivery. Do not treat worker process success as proof that the task is complete.

This file lives at `<plugin-root>/pi-skills/codex-lead/SKILL.md`. Resolve the companion relative to the skill directory and run from the worker's workspace:

```bash
node "<skill-dir>/../../companion/codex-companion.mjs" staffer --prompt-file "<brief-path>"
```

Use `research`, `review`, or `implement` for a specialist. Preserve requested model and effort selections; otherwise inherit the user's Codex settings. Follow actual host permissions. The lead is a workflow for the host, not a separate companion subcommand or scheduler.

## Host compatibility

When this skill or its referenced instructions require a tool that the current environment does not provide, use available capabilities to achieve an equivalent result. Adapt only the tool-specific execution method; preserve the task goal, authorization requirements, explicit confirmation steps, result delivery, and stopping conditions.

If an equivalent result cannot be achieved, or you cannot establish that an alternative is equivalent, explain the missing capability and its impact, and ask the user for help. Do not silently skip requirements or bypass the environment's restrictions.
