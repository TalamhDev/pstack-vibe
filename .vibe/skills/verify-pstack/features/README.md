# pstack verification map

This directory is the maintained source for verifying the user-facing behavior of the
pstack Vibe plugin. Read the index before driving, then use the matching feature file
as the recipe.

## Baseline preconditions

- Run from the repository root. `control-pstack` resolves the root itself.
- Launch a disposable home with `.vibe/skills/verify-pstack/control-pstack launch`.
- Set `RUN_ID` (or `RUN_DIR`) so concurrent runs do not share a home.
- Require `~/.vibe/config.toml` and `~/.vibe/pstack-models.md` to exist. They are the
  environment the plugin is verified against; run `/pstack:setup-pstack` if either is
  missing.
- Run `control-pstack doctor` and require every `PASS` line before driving.
- Never drive a home this run did not create. Never point `VIBE_HOME` at `~/.vibe`.

## Driving conventions

- Start every recipe from a launched, doctor-clean home unless its preconditions say
  otherwise.
- Treat every command as literal. Keep quoted prompts and flags unchanged.
- Run installer and doctor actions through `control-pstack doctor`, or directly as
  `VIBE_HOME=$RUN_DIR/home node bin/pstack-vibe.mjs <command>`.
- Run session actions through `control-pstack drive "<prompt>"`.
- Read `$RUN_DIR/artifacts/drive-<n>/` for the prompt, stdout, stderr, exit code, and
  export.
- Restore mutated state after a recipe. Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final line.
- Installer proof includes the command, stdout, and exit code.
- Doctor proof includes every line, not one `PASS`.
- Session proof includes stdout, exit code, and `export/export.json`, whose warnings
  array catches config issues the doctor cannot see.
- Hook proof is an answer that could only come from the injected sheet.
- Skill proof is the skill's own output, not the fact that its name was accepted.
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the
user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with control-pstack` starts with `Preconditions:` and uses labeled
   bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles,
required state, commands, and observable proof.

## Features

- [Install and remove the plugin](./install.md) covers user and project scope,
  update, dry-run, and purge.
- [Doctor](./doctor.md) covers the ten install checks and what each failure means.
- [Session context](./session-context.md) covers the session-start hook injecting the
  model sheet and the adapter doc into a real session.
- [Skill invocation](./skill-invocation.md) covers `/pstack:*` skills loading and
  running, including the model-sheet-driven setup skill.
- [Generated tree fidelity](./generate.md) covers `npm run generate` and
  `npm run check` keeping `generated/vibe/` in step with `vendor/` and `adapters/`.
