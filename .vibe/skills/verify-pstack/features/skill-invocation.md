# Skill invocation

pstack ships 58 skills. A user invokes one by typing `/pstack:<name>` (or the short
`/<name>` when unambiguous). Most set `disable-model-invocation: true`, so the model
cannot load them on its own — the user types the command, or `/poteto-mode` reads the
skill by path. A user sees the skill's own output, not a generic acknowledgement.

## Sub-features

- `skill-slash` runs a skill from its `/pstack:<name>` command.
- `skill-short` runs it from the short `/<name>` form when unambiguous.
- `skill-hidden` keeps a `disable-model-invocation: true` skill out of the model's
  catalog while leaving it user-invocable.
- `skill-path` lets `/poteto-mode` read a skill by absolute path.
- `skill-setup` runs `/pstack:setup-pstack`, the one model-invocable skill, which
  writes the model sheet and the agent profiles.

## How to get to it (user POV)

- Type `/pstack:poteto-help` in a session to get the orientation menu.
- Type `/pstack:poteto-mode <task>` to start a task through the playbook.
- Type `/pstack:setup-pstack` to configure model roles.
- Type `/pstack:<any-skill-name>` for the rest.

## Driving it with control-pstack

Preconditions:

- A launched run: `control-pstack launch` has created `$RUN_DIR/home` and installed
  the plugin into it.
- `control-pstack doctor` reports seven `PASS` lines.

- **Run a skill from its full command.** Run `control-pstack drive
  "/pstack:poteto-help"`. Stdout contains the orientation menu — the numbered list
  starting `1. **Get set up**` — and `exit_code.txt` is `0`. A reply that says the
  command is unknown means the plugin did not load.
- **Confirm the skill read the run's sheet.** In the same stdout, the opening line
  names the model sheet path and the budget. With a planted scratch sheet it names
  `scratch/.vibe/pstack-models.md`; with none it names the user-level sheet.
- **Run a skill that does work.** Run `control-pstack drive
  "/pstack:poteto-mode add a --json flag to the export command. text output stays
  byte-identical. verify both forms."`. Stdout shows a matched playbook and a todo
  list, not a single confident pass. This drive needs `--auto-approve` to write files;
  without it, expect denied tool calls rather than a pstack failure.
- **Confirm a hidden skill stays hidden.** Run `control-pstack drive "List the pstack
  skills you can load with the skill tool."`. The answer names `setup-pstack` and does
  not claim to load the other 57, which set `disable-model-invocation: true`.
- **Proof.** Keep `prompt.txt`, `stdout.txt`, `exit_code.txt`, and
  `export/export.json` under `$RUN_DIR/artifacts/drive-<n>/`. The skill's own output is
  the proof; the fact that the command was accepted is not.

## Gotchas

- Most pstack skills are hidden from the model on purpose. A model that says it cannot
  find `/pstack:arena` is behaving correctly; the user types it.
- A built-in Vibe command wins over a skill with the same name, so such a skill is left
  out of the slash menu even though it is installed.
- `/pstack:setup-pstack` writes to the **real** home, not the run home, unless `HOME`
  is overridden. Never drive it against a run home and assume the run home changed.
- Skills are read at session start. A skill added or edited on disk needs a new session
  or `/reload-plugins`.
- `vibe -p` denies tool calls that need approval. A skill that writes files needs
  `--auto-approve`; the helper does not pass it.
- A skill that produces no output is not proof it ran. Require output that only that
  skill could produce.
