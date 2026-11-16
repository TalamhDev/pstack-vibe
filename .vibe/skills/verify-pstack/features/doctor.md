# Doctor

Doctor answers one question: is this pstack install worth driving? It runs seven
read-only checks and prints one `PASS` or `FAIL` line per check, exiting non-zero if
any check failed. A user runs it after installing, and again whenever a skill or a
model alias seems to be missing.

## Sub-features

- `doctor-vibe` checks that `vibe` is on `PATH` and reports a version.
- `doctor-manifest` checks that `plugin.json` exists and names `pstack`.
- `doctor-skills` compares the installed skills tree against `skills.manifest`.
- `doctor-hook` checks that `ai.mistral.vibe/hooks.toml` exists.
- `doctor-sheet` checks that the model sheet exists.
- `doctor-profiles` checks that every `pstack-*` profile named on a role line is installed.
- `doctor-aliases` checks that every family the sheet names has an alias, and that the alias
  exists in `config.toml`.

## How to get to it (user POV)

- Run `./scripts/install.sh doctor` from the repository root.
- Run `sh scripts/doctor.sh` directly, with `VIBE_HOME` and optionally `PLUGIN_DIR` set.

## Driving it with control-pstack

Preconditions:

- A launched run: `control-pstack launch` has created `$RUN_DIR/home` and installed
  the plugin into it.

- **Healthy install.** Run `control-pstack doctor`. Seven `PASS` lines, no `FAIL`, exit
  code `0`. The skills line reads `PASS  skills: 58 SKILL.md files match skills.manifest`.
- **Missing sheet.** Remove `$RUN_DIR/home/pstack-models.md`, then run
  `control-pstack doctor`. Exit code is `1`. The sheet line reads `FAIL  model sheet at
  ... is missing; run /setup-pstack`, and both the profiles and aliases lines read
  `FAIL  ... cannot check without a model sheet`.
- **Missing profile.** Restore the sheet, then remove
  `$RUN_DIR/home/agents/pstack-glm.toml`, then run `control-pstack doctor`. Exit code
  is `1` and the profiles line reads `FAIL  agent profiles missing for: pstack-glm`.
- **Missing alias.** Restore the profile, then delete the `[[models]]` entry whose
  `alias` is `glm-5-3` from `$RUN_DIR/home/config.toml`, then run
  `control-pstack doctor`. Exit code is `1` and the aliases line reads
  `FAIL  model aliases missing from ...: glm:glm-5-3`.
- **Missing plugin.** Remove `$RUN_DIR/home/plugins/pstack`, then run
  `control-pstack doctor`. Exit code is `1` and the manifest, skills, and hook lines
  all `FAIL`. The skills line reads `FAIL  skills: skills.manifest is missing from
  ...; reinstall the plugin`.
- **Missing skills directory.** Restore the plugin, then remove
  `$RUN_DIR/home/plugins/pstack/skills`, then run `control-pstack doctor`. Exit code is
  `1` and the skills line reads `FAIL  skills: no skills directory at
  .../plugins/pstack/skills`.
- **Removed skill.** Restore the skills directory, then remove
  `$RUN_DIR/home/plugins/pstack/skills/arena`, then run `control-pstack doctor`. Exit
  code is `1` and the skills line reads `FAIL  skills: missing from the install: arena`.
- **Unexpected skill.** Restore the skill, then add
  `$RUN_DIR/home/plugins/pstack/skills/extra/SKILL.md`, then run
  `control-pstack doctor`. Exit code is `1` and the skills line reads
  `FAIL  skills: not in skills.manifest: extra`.
- **Fourth family.** Remove the extra skill, then add a `# qwen: qwen-3` line and a role
  naming `pstack-qwen` to `$RUN_DIR/home/pstack-models.md`, and add
  `$RUN_DIR/home/agents/pstack-qwen.toml`. Leave `qwen-3` out of
  `$RUN_DIR/home/config.toml`, then run `control-pstack doctor`. Exit code is `1` and
  the aliases line reads `FAIL  model aliases missing from ...: qwen:qwen-3`.
- **No family lines.** Keep the `pstack-qwen` role, delete every `# <family>: <alias>`
  line from the sheet, then run `control-pstack doctor`. Exit code is `1` and the
  aliases line reads `FAIL  model aliases: no alias recorded for family: deepseek glm
  ml4 qwen`, naming every family the roles name. Deleting only the `# qwen: qwen-3`
  line reads `FAIL  model aliases: no alias recorded for family: qwen`. A sheet with no
  family lines and no role naming a profile reads `PASS  model aliases: the sheet
  records no aliases`.
- **Proof.** Keep the full stdout and exit code of each run under
  `$RUN_DIR/artifacts/doctor/`. A single `PASS` line is not proof; the seven-line block
  and the exit code are.

## Gotchas

- Doctor never starts a session. It cannot tell you whether the hook fires or whether a
  skill loads; that is what the session-context and skill-invocation features are for.
- Doctor reads `$VIBE_HOME`, so it does check the run home. The session-start hook does
  not — see the session-context gotchas.
