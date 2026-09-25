# Installing Codex Staff — a guide for coding agents

You have been asked to install or update **codex-staff** and verify it. Follow the applicable host section, verify the installed copy, and report the outcome in the user's language. The README's installation prompt authorizes the plugin installation/update and one minimal `ask` smoke test using the existing Codex account; carry those steps through without another confirmation. Respect any narrower instructions from the user.

Read this guide as raw text, not a rendered-page summary:

```bash
curl -fsSL https://raw.githubusercontent.com/pStrikeZ/codex-staff/master/docs/INSTALL_FOR_AGENTS.md
```

If the user supplied a local checkout, read its `docs/INSTALL_FOR_AGENTS.md` and install from that checkout. Otherwise use [pStrikeZ/codex-staff](https://github.com/pStrikeZ/codex-staff). The plugin root contains `package.json`, `companion/` and `skills/`.

## 1. Check prerequisites and identify the host

- Run `node --version` (20+), `codex --version` and `codex login status`. Authentication stays with Codex. If a prerequisite is missing or login requires user interaction, explain what is needed and let the user complete it; installing additional software is outside this plugin-install request.
- Preserve the existing Codex provider, model and reasoning settings. Do not replace credentials or choose a different model for verification. The companion needs no npm dependencies, so `npm install` is unnecessary.
- Use the host named by the user, otherwise the current host: **Claude Code** uses `/plugin` and `/codex-staff:...`; **Pi** uses `pi install` and `/skill:codex-...`. Follow only the matching section below. If the target is unclear, ask which host to install into. This guide installs into Claude Code or Pi; running the installer from another agent does not make that agent the installation target.

`CODEX_BIN` may select an existing executable or `.mjs` / `.cjs` / `.js` Node entrypoint. It is a path, not a shell command with embedded flags.

## 2a. Claude Code — install or update

Inspect `claude plugin marketplace list` and `claude plugin list --json` first. Use shell CLI commands, not the interactive `/plugin` slash commands. For a new installation, add the marketplace if it is not registered, then install:

```bash
claude plugin marketplace add https://github.com/pStrikeZ/codex-staff.git
claude plugin install codex-staff@codex-staff
```

Use the local checkout's absolute path instead of the Git URL when the user supplied one. Preserve the existing install scope on updates. For an already installed plugin, refresh it with:

```bash
claude plugin marketplace update codex-staff
claude plugin update codex-staff@codex-staff
```

Verify the resulting version, enabled state and source with `claude plugin list --json`. Check the registered `installPath` in the installed-plugin metadata when resolving the companion; do not select a cache directory by glob, since older versions can remain. An unchanged version can leave an older cached copy in use, so check the installed source before claiming an update succeeded. Use the current CLI's documented refresh/reinstall procedure if needed, preserving the selected scope and user configuration.

A fresh installation does not register skills in the already running session. Continue to the shell smoke test below, then tell the user to restart Claude Code. After restart, `/codex-staff:ask` and the other personas should be available. Temporary development loading also supports `claude --plugin-dir /absolute/path/to/codex-staff`.

## 2b. Pi — install or update

Inspect `pi list` first. For a new installation:

```bash
pi install https://github.com/pStrikeZ/codex-staff.git
```

For a user-supplied checkout, use `pi install /absolute/path/to/codex-staff`. If already registered, use the installed Pi version's package-update command for this package (`pi update --help` documents the available selection options); preserve any user-selected ref and installation scope. Local packages load the checkout directly. Run `npm run generate:pi` there only if canonical skills were edited and generated copies are stale.

Use `pi list` to confirm the registered source and resolve its package root. Its `pi.skills` field exposes `pi-skills/`. Verify the seven entrypoints: `codex-staffer`, `codex-researcher`, `codex-reviewer`, `codex-implementer`, `codex-ask`, `codex-lead`, `codex-jobs`. Keep the entire package together so the relative companion paths work.

Continue to the smoke test, then reload Pi with `/reload` or restart it. Slash commands belong in the host UI, not in a shell. Once reloaded, use `/skill:codex-ask` or another persona.

## 3. Verify the installed copy

Resolve the absolute root of the copy registered with the selected host, rather than an unrelated source checkout. Confirm its `package.json`, companion and skill files exist. Run the following commands from a temporary workspace, replacing the path with that installed root:

```bash
node /absolute/path/to/installed/codex-staff/companion/codex-companion.mjs setup
node /absolute/path/to/installed/codex-staff/companion/codex-companion.mjs ask --prompt "Reply with OK"
```

`setup` only probes availability and repository policy. The one `ask` call verifies actual model access with the existing account and configuration. Expect exit 0 and the requested answer on stdout; telemetry goes to stderr. It creates job state in the temporary workspace and a normal Codex session. Do not add `--model`, `--effort`, change project permission defaults or run the full real-CLI suite for this installation smoke test.

If a host command observation ends while the call is still running, collect the same command handle. If the original shell handle is lost, use the recorded job ID in that temporary workspace with `wait <id>`; exit 2 means keep waiting for the same job. Do not launch another smoke call merely because an observation timed out. On failure, report the relevant error and diagnose it; account/login problems may require the user. A hard execution timeout does not authorize automatic paid retries.

A successful direct-companion test verifies the installed execution path even before host reload. It does not prove the current session has loaded the new skills. Check discovery after reload if available; otherwise report reload as the remaining user action.

## 4. Report the result

In the user's language, state the target host, installed version and source, the smoke-test result, and whether restart/reload or login is still required. Include the installed path when it helps locate the copy. Do not claim verification succeeded based only on plugin registration or `setup` output.
