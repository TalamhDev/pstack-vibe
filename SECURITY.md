# Security

pstack-vibe is a plugin for the Mistral Vibe CLI. It runs with the same permissions as the
Vibe session that loads it. This page describes what it writes, what executes, and how to
remove it.

## What the installer writes

`npx pstack-vibe install` writes one directory:

- `~/.vibe/plugins/pstack/` (user scope) or `.vibe/plugins/pstack/` (project scope). It
  contains `plugin.json`, the 58 skills, the guide, the hook, the agent profiles, the
  knowledge files, and the session-start script.

It does not edit `~/.vibe/config.toml`, your shell profile, or any file outside that plugin
directory.

`/pstack:setup-pstack` writes three more things, and only after you answer its questions:

- `~/.vibe/pstack-models.md` (or `.vibe/pstack-models.md`), the model sheet.
- `~/.vibe/agents/pstack-<family>.toml` (or `.vibe/agents/`), one subagent profile per
  confirmed model family.
- Optionally, an effort-variant `[[models]]` entry in `~/.vibe/config.toml`. Setup shows the
  exact entry and asks for consent before writing it. It never edits the config silently.

`npx pstack-vibe uninstall` removes the plugin directory. `uninstall --purge` also
removes the model sheet and the `pstack-*.toml` profiles. It does not remove model entries
that setup added to `config.toml`; delete those by hand if you added them.

## Hooks execute commands

The plugin registers one `session_start` hook:

```toml
[[hooks]]
name = "pstack-context"
type = "session_start"
command = "node ai.mistral.vibe/scripts/session-start.mjs"
```

That command runs a Node script at the start of every session. The script names the plugin
root, the adapter doc, and the role table, reads the model sheet, and points at
`/pstack:poteto-mode`. It does not make network calls, and it does not write files.

A hook is code, not configuration. Read
`~/.vibe/plugins/pstack/ai.mistral.vibe/scripts/session-start.mjs` before you install a
release you did not build. If you do not want the hook to run, remove the `[[hooks]]` entry
from `ai.mistral.vibe/hooks.toml` or uninstall the plugin.

## Skills are prompt text

A `SKILL.md` file is prompt text. It tells the model what to do; it is not sandboxed code.
The model can still run shell commands, edit files, and call tools that the session allows,
because the skill asks it to. Installing pstack does not grant new permissions. It changes
what the model is likely to attempt.

Most pstack skills set `disable-model-invocation: true`. The model does not load them from a
description. You type the command, or `/poteto-mode` reads the skill by path. That reduces
accidental invocation, not the skill's authority once it runs.

## Review write-capable skills

Some skills and playbooks write to your repository, your git history, or external services:

- `/poteto-mode` and its playbooks edit files, create commits, open PRs, and can push.
- `/architect`, `/arena`, and `/swarm` write in worktrees or scratch directories and may
  create branches.
- `/create-verification-skill`, `/maintain-verification-skill`,
  `/create-formal-verification-skill`, and `/maintain-formal-verification-skill` write
  project-local skills and may open a PR.
- `/automate-me`, `/reflect`, and `/correct` propose or write skill and repository changes.
- `/setup-pstack` writes the model sheet, agent profiles, and, with consent, model config
  entries.

Read a skill before you run it on a repository you care about. Prefer a worktree or a scratch
branch for a first run. Keep the mode's always-pause list in force: force-pushing a shared
branch, deploying, deleting data, and messaging customers wait for you.

The upstream skills were written for Cursor. This port rewrites the load-bearing tool and
path references, and it skips Cursor-only steps with a one-line note. It does not audit
upstream's intent. Treat a skill's instructions as you would any code you did not write.

## Disable or remove the plugin

To stop loading pstack without deleting it, move the plugin directory out of the plugin path:

```sh
mv ~/.vibe/plugins/pstack ~/.vibe/pstack.disabled
```

Or remove it:

```sh
npx pstack-vibe uninstall
```

For a project install, run the same command with `--project` from that repository. Start a
new session, or run `/reload-plugins`, so Vibe drops the plugin and its hook.

To remove everything setup wrote, including the model sheet and profiles:

```sh
npx pstack-vibe uninstall --purge
```

## Reporting a problem

Open an issue at https://github.com/telamh/pstack-vibe/issues. Include the Vibe version, the
pstack version, the command you ran, and the relevant output. Do not paste secrets, tokens,
or private repository contents.

For a vulnerability in the port itself, report it privately through GitHub's security
advisory flow rather than a public issue.
