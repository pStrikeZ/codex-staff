# Install Codex Staff from a local checkout

The plugin root is the directory containing `package.json`, `companion/` and `.codex-plugin/`. Use its absolute path in commands below. Do not install Node, Codex, packages or host plugins unless the user's installation request covers those changes.

## Prerequisites and direct use

Check `node --version` (20+), `codex --version` and `codex login status`. Authentication stays with Codex. `setup` probes CLI availability and repository policy; it does not make a model request or prove authentication.

No npm dependencies need installation. From the user's target workspace:

```bash
node /absolute/path/to/codex-staff/companion/codex-companion.mjs setup
```

When a model smoke test is authorized, run `ask --prompt "Reply with OK"` through the same companion. It uses the configured Codex account. `CODEX_BIN` can select another executable or `.mjs` / `.cjs` / `.js` Node entrypoint; it is a path, not a shell command with embedded flags.

## Codex

For CLI 0.157.0, the local marketplace and install commands are:

```bash
codex plugin marketplace add /absolute/path/to/codex-staff
codex plugin add codex-staff@codex-staff
```

Open a new thread. The host loads canonical skills from `skills/`; invoke `$codex-staff:ask` or `$codex-staff:staffer`. Check `codex plugin --help` if another CLI version exposes different subcommands. The included marketplace resolves its plugin source from the checkout root (`.`), allowing the requested checkout layout to remain self-contained.

For local development, Codex caches a versioned copy. A changed checkout is not proof the installed copy changed. Bump the plugin and package versions together, then refresh the installation using the current CLI's plugin commands. On 0.157.0, `codex plugin remove codex-staff@codex-staff` followed by `codex plugin add codex-staff@codex-staff` reloads the copy. Start a new thread afterwards.

## Claude Code

```bash
claude plugin marketplace add /absolute/path/to/codex-staff
claude plugin install codex-staff@codex-staff
```

Restart Claude Code. Invoke `/codex-staff:ask`, `/codex-staff:staffer`, `/codex-staff:researcher`, `/codex-staff:reviewer`, `/codex-staff:implementer` or `/codex-staff:lead`. The `jobs` skill handles follow-ups and collection. Temporary local loading is available through `claude --plugin-dir /absolute/path/to/codex-staff`.

For a released version update, refresh the marketplace and plugin with `claude plugin marketplace update codex-staff` and `claude plugin update codex-staff@codex-staff`, then restart. Local changes require a refreshed installed copy or a `--plugin-dir` session.

## Pi

```bash
pi install /absolute/path/to/codex-staff
```

Run `/reload`. The package's `pi.skills` field exposes only `pi-skills/`, with flat names such as `/skill:codex-staffer` and `/skill:codex-jobs`. The generated skills refer to companion files relative to their installed locations. Keep the entire package together.

`npm run generate:pi` updates generated skills after canonical edits; `npm run check:pi` detects drift. For package-based distribution, `npm pack` includes all seven skills, references, templates and companion modules. Publishing the package is a separate action.

## Acceptance

Verify the host discovers the seven skills, run `setup` from a separate target workspace, and collect an authorized smoke job to completion. `wait` exit 2 means observation expired: continue waiting on that job. A plugin inventory or successful process exit alone does not prove a delegated assignment achieved its requested outcome.
