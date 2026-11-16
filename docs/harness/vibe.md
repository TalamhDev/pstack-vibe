# pstack on the Mistral Vibe CLI

This is the adapter doc for the Vibe port of pstack. Read it once per session. It maps the Cursor names that remain in pstack's prose to their Vibe equivalents, lists the Cursor-only features and how a run skips them, and explains the agent profiles, skill loading, and paths the port uses.

The port rewrites every load-bearing Cursor reference in the skills. Incidental prose that names Cursor as pstack's origin stays, because it is history, not an instruction.

## Tool mapping

| Cursor | Vibe |
| --- | --- |
| `Task` | `agents.spawn` |
| `Read` | `read_file` |
| `Write` | `write_file` |
| `Edit` | `edit` |
| `Grep` | shell `rg` (or `grep`) |
| `Glob` | shell `rg --files` (or `find`) |
| `Shell` | `bash` |
| `AskQuestion` | `ask_user_question` |

Vibe has no dedicated `grep` or `glob` tool. Search and list files with the shell. A read-only search uses `rg` or `find`; a write uses `write_file` or `edit`.

## Spawning a subagent

`agents.spawn` takes four fields:

- `name`: a short label for the child.
- `message`: the consolidated brief.
- `config_name`: the agent profile, such as `pstack:poteto-agent`.
- `instructions`: extra instructions for this child.

There is no `model`, `run_in_background`, `readonly`, or `environment` field. A profile fixes the model and thinking level. Every spawn runs in the background. There is no foreground mode.

Read-only work uses `config_name: "pstack:readonly"`. A code delegate uses `pstack:poteto-agent` or the role's profile from the model sheet. The comment reviewer uses `pstack:comment-sicko`.

## Asynchronous reports

A spawn returns immediately. The child runs in the background, and its report reaches you as a message. Do not poll `agents.list` in a loop. Continue with independent work, or end the turn and read the report when it arrives.

To continue an existing child, use `agents.send_message`. To start a fresh child with the prior report, spawn a new one and paste the report into its brief. A fresh spawn with the prior report replaces Cursor's `resume`.

A child's report is evidence, not a verdict. Review the diff and write your own summary. Do not pass the child's words through.

## Model profiles

The plugin ships three inherit-parent profiles:

- `pstack:poteto-agent`: the code-writing delegate. It loads the `pstack:poteto-mode` skill before work.
- `pstack:comment-sicko`: the comment reviewer.
- `pstack:readonly`: the read-only explorer. It enables `read_file`, `skill`, and a bash allowlist of read-only commands, and it never modifies files.

`/setup-pstack` writes user-level profiles for model-specific roles:

- `pstack-deepseek`: the default for code, judgment, and the hardest tasks.
- `pstack-glm`: the adversarial reviewer and a cross-judge.
- `pstack-ml4`: the `security review` role and an arena runner.

The model sheet maps each role to one of these names. `inherit-parent` means the session's active model, which runs on `pstack:poteto-agent`. If setup has not run, use `pstack:poteto-agent` and tell the user to run `/setup-pstack`.

The default role table is at `ai.mistral.vibe/knowledge/pstack-models/KNOWLEDGE.md` under the plugin root.

## Loading a skill

Most pstack skills are `disable-model-invocation: true`, so the `skill` tool does not load them. Read the file instead:

- `../<name>/SKILL.md` relative to the current skill.
- `$PLUGIN_ROOT/skills/<name>/SKILL.md`.

The session-start hook names the plugin root. The router and the subagents load `poteto-mode` by path, not through the `skill` tool.

## Cursor-only features

These have no Vibe equivalent. Skip the step with one line and keep going:

`Skipped in Vibe: <step>. <reason>.`

Do not stop, retry, or substitute a different feature silently. Examples:

- `Skipped in Vibe: deslop. It ships in the Cursor-only cursor-team-kit.`
- `Skipped in Vibe: control-ui and control-cli. They ship in the Cursor-only cursor-team-kit.`
- `Skipped in Vibe: Cursor Automations. Run the playbook manually, or use /loop while the session is live.`

The full list:

- **Bugbot.** Use GitHub security review threads through `gh`. Triage them per `skills/poteto-mode/references/bugbot-triage.md`. Security findings route to the `security review` role, `pstack-ml4`.
- **Cursor Automations.** Run the playbook manually, or use `/loop` while the session is live.
- **Cloud agents.** Use a git worktree.
- **`SendToUser`.** Print the message in the reply.
- **`cursor-team-kit` (`deslop`, `control-cli`, `control-ui`).** Skip the step. `no-comments` stays its own step.
- **Custom Modes.** Start each task with `/poteto-mode`. The loaded skill and the session-start hook keep the mode in context.
- **`/create-skill`.** Use Vibe's builtin `skill-creator`.
- **`/babysit`, `/verify`, `/automate`, `/recall`, `/teach`.** Use pstack's Babysit playbook, verification skills, `automate-me`, `recall`, and `teach`.
- **PR and CI event subscriptions.** Check with `gh pr view` and `gh pr checks`.

## Paths

| Cursor | Vibe |
| --- | --- |
| `~/.cursor/` | `~/.vibe/` |
| `.cursor/` | `.vibe/` |
| `~/.cursor/rules/pstack-models.mdc` | `~/.vibe/pstack-models.md` |
| `~/.cursor/projects/<slug>/agent-transcripts/` | `~/.vibe/logs/session/` |
| `~/.cursor/plugins/` | `~/.vibe/plugins/` |
| `.cursor/skills/`, `~/.cursor/skills/` | `.vibe/skills/`, `~/.vibe/skills/` |
| `.cursor/settings.json` | `.vibe/config.toml` |

The plugin installs at `~/.vibe/plugins/pstack` (user scope) or `.vibe/plugins/pstack` (project scope). The model sheet is `~/.vibe/pstack-models.md` or `.vibe/pstack-models.md`. Session logs are under `~/.vibe/logs/session/`.

## `/loop`

Vibe has `/loop`, backed by the `cron` tool. It runs only while the session is live and idle, and its schedules stop when Vibe closes. A loop needs a check that can pass or fail, not a duration. For an overnight run that must survive a restart, start a fresh session and start the loop again.
