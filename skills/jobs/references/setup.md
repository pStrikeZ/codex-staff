# Setup and permissions

`setup` runs `codex --version` and prints the repository policy. Codex must already be installed and authenticated; use `codex login` when needed. Setup does not change global Codex configuration or install software.

`setup --restrict review,research` writes `.codex-staff/config.json`, making the listed modes restricted by default. Unlisted modes use built-in defaults. `setup --restrict none` clears the policy. CLI profile flags override policy; continuation inherits its original profile unless explicitly overridden.

All tool-using modes default to unrestricted (`sandbox_mode="danger-full-access"`), matching agy-staff. Restricted research/review and ask use `read-only`; restricted staffer/implement use `workspace-write`. Every run sets `approval_policy="never"`, so a denied action fails without waiting for an interactive approval. Ask is always restricted.

Repository policy is a preference, not an immutable security boundary. Prompts request scope discipline and preserve existing user work. Codex's sandbox controls local execution; MCP services have their own permissions. The host still needs permission to launch Codex and access its authentication and session files. A worker flag cannot relax host restrictions.
