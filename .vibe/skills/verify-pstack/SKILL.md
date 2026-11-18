---
name: verify-pstack
description: Drive the pstack Vibe plugin the way a user does — install it into a disposable VIBE_HOME, run the doctor, and prove the session-start hook and skills reach a real Vibe session. Use when a change touches scripts/, adapters/, model-sheet/, generated/vibe/, or the plugin's skills, hooks, or agent profiles, and you need proof beyond `npm test`.
user-invocable: false
---

# Verify pstack

pstack is a Vibe CLI plugin, not a server. There is no port to open and no page to
load. The user-facing surface is three things: the installer (`bin/pstack-vibe.mjs`),
the plugin tree it copies into a Vibe home, and what a real `vibe` session does with
that tree — the session-start hook injecting the model sheet, and `/pstack:*` skills
loading and running.

A change is proven when a disposable Vibe home, built from this checkout, passes the
doctor and then answers a question only the installed plugin could answer.

This skill is hidden from the `/` menu (`user-invocable: false`) so it adds nothing to
what pstack already brings. Load it with the `skill` tool. The hook's JSON contract is
covered separately by `tests/session-start-json.test.mjs`, which runs in `npm test` and
needs no session.

## Launch

Run from the repository root. `control-pstack` lives at
`.vibe/skills/verify-pstack/control-pstack` and resolves the repo root itself.

```sh
.vibe/skills/verify-pstack/control-pstack launch
```

That does four things and prints the run directory:

1. Creates `$RUN_DIR/home` (the Vibe home) and `$RUN_DIR/scratch` (the drive cwd),
   under `/tmp/pstack-verify-<timestamp>-<pid>` by default.
2. Copies `config.toml`, `pstack-models.md`, and `agents/pstack-*.toml` from
   `$SRC_HOME` (default `~/.vibe`) into the home. These are environment, not repo
   state: the aliases must exist for Vibe to resolve an agent profile.
3. Runs `npm install` if `node_modules` is missing. A fresh clone has none, and
   `npm run check` and `npm test` both fail with `ERR_MODULE_NOT_FOUND` without it.
4. Runs `node bin/pstack-vibe.mjs install` with `VIBE_HOME` pointed at the run home.

Ready means the doctor passes, not that the copy finished. Go straight to Doctor.

Teardown is `control-pstack cleanup`. It removes the home and the scratch cwd, and
keeps `$RUN_DIR/artifacts`.

## Doctor

```sh
.vibe/skills/verify-pstack/control-pstack doctor
```

One read-only check that answers "is this instance worth driving?". It prints one
`PASS` line per check and exits 0:

```
PASS  vibe is on PATH: vibe 3.1.2
PASS  plugin manifest at <home>/plugins/pstack/plugin.json names pstack
PASS  skills: 58 SKILL.md files match skills.manifest
PASS  hook file at <home>/plugins/pstack/ai.mistral.vibe/hooks.toml
PASS  chain: chain.tsv is installed and names only installed playbooks
PASS  chain: <home>/plugin-data/pstack is writable
PASS  model sheet at <home>/pstack-models.md
PASS  agent profiles named in the sheet exist in the agents directory or the plugin
PASS  model aliases recorded in the sheet exist in <home>/config.toml
PASS  vibe 3.1.2 is within the tested range >=3.1.2 <3.2.0
```

Any `FAIL` line means the instance is not worth driving. Fix the cause, do not drive
past it. A `FAIL` on the sheet or the aliases is an environment problem: run
`/pstack:setup-pstack` against the real home, then relaunch.

## Drive

```sh
.vibe/skills/verify-pstack/control-pstack drive "<prompt>"
```

Runs `vibe -p "<prompt>" --trust --output-dir <artifacts>/drive-<n>/export` from
`$RUN_DIR/scratch` with `VIBE_HOME` set to the run home, and writes `prompt.txt`,
`stdout.txt`, `stderr.txt`, `exit_code.txt`, and the export directory beside it.

Driving from the scratch cwd matters. The session-start hook resolves the sheet from
the session's cwd first, so a sheet planted there would win. `sheet` plants into the
run home instead, which the hook reaches through `VIBE_HOME`.

`--trust` is required. `vibe -p` never prompts for trust, so without it the folder is
untrusted and project-local config is skipped.

The cheapest proof that the plugin is live is a question only the injected sheet can
answer. Plant a sheet whose answer differs from the real one, so a correct answer
cannot come from `~/.vibe`:

```sh
.vibe/skills/verify-pstack/control-pstack sheet pstack-glm
.vibe/skills/verify-pstack/control-pstack drive \
  "Without reading any file, state the profile the pstack model sheet assigns to the 'security review' role. Answer with just the profile name."
```

A correct run prints `pstack-glm` on stdout with exit 0, which proves the hook honored
`VIBE_HOME` rather than the real `~/.vibe`. If it prints `pstack-ml4`, the hook read
the real `~/.vibe/pstack-models.md` instead of the planted one. If it says it has no
model sheet, the hook did not fire at all.

## Evidence

Capture the action and the resulting state, not just the last line.

- **Installer and doctor proof** is the command, its stdout, and its exit code. Keep
  the full doctor block; a single `PASS` proves nothing.
- **Session proof** is `stdout.txt` plus `exit_code.txt` plus `export/export.json`,
  which records the effective config, token usage, and any warnings. Read the warnings
  array: a config issue there means Vibe rejected something the doctor cannot see.
- **Hook proof** is an answer that could only come from the planted sheet. Do not
  accept "the hook file exists" as proof that the hook ran.
- **Skill proof** is the skill's own output, not the fact that `/pstack:<name>` was
  accepted as input.
- Artifacts go under `$RUN_DIR/artifacts/drive-<n>/` and survive cleanup. Name the
  feature ID and the entry point used in whatever you report.

Do not weaken a journey to make it pass. If a precondition is missing, report the
failure and the reason.

## Cleanup

```sh
.vibe/skills/verify-pstack/control-pstack cleanup
```

Removes `$RUN_DIR/home` and `$RUN_DIR/scratch` only. Never kill by process name and
never remove `$RUN_DIR/artifacts`. Run cleanup after a failed iteration too, so a
broken attempt does not leave a home behind that the next run mistakes for its own.

Vibe pins read-only plugin snapshots under `$VIBE_HOME/logs/session/plugins/`, so a
plain `rm -rf` leaves the home behind with `Permission denied`. `cleanup` delegates to
`src/tree.mjs`, which chmods the tree writable first and fails loudly if the
home survives.

## Helpers

`control-pstack` is the only helper. It is executable and takes
`launch | doctor | drive | sheet | cleanup | status`. `sheet <profile>` plants a
sheet in the run home naming that profile for the security-review role. `status`
prints the run directory and whether it is launched. Set `RUN_ID` to name a run, or
`RUN_DIR` to place it, when you want two runs side by side — they do not share state.

## Gotchas

- **A project sheet shadows the run home's sheet.** `session-start.mjs` checks the
  session's cwd and `./.vibe` before `$VIBE_HOME`, so a `.vibe/pstack-models.md` in the
  scratch cwd wins over the planted one. Keep the scratch cwd free of one, or the run
  proves that sheet instead.
- **A driven session writes read-only snapshots into the home.** Vibe pins each plugin
  under `$VIBE_HOME/logs/session/plugins/` with no write bit, so `rm -rf` on the home
  fails with `Permission denied`. Chmod before removing; `src/tree.mjs` does,
  and `cleanup` calls it.
- **`npm install` first.** A fresh clone has no `node_modules`, so `npm run check` and
  `npm test` fail with `ERR_MODULE_NOT_FOUND`. `launch` handles it; a bare `npm test`
  does not.
- **The doctor compares skills against `skills.manifest`.** Adding or removing a skill
  means regenerating the tree, not editing `src/doctor.mjs`. A skill directory added
  by hand to an install fails check 3 until the manifest matches.
- **`--project` writes into the current directory.** `node bin/pstack-vibe.mjs install
  --project` creates `./.vibe/plugins/pstack` wherever you stand. Run it from a scratch
  directory, or you will dirty this repo.
- **The API key comes from the OS keychain**, not from the run home, so a fresh
  `VIBE_HOME` still authenticates. A key error is an environment failure, not a pstack
  failure. Never copy `.env` into a run home.
- **The sheet and profiles are read at session start.** A change to either has no
  effect on a running session. Relaunch, or start a new session.
- **`/reload-plugins` is for the plugin tree only.** It does not re-read the model
  sheet or the agent profiles.
- **`vibe -p` denies tool calls that need approval.** A drive that must write files
  needs `--auto-approve`; the helper does not pass it, so a drive that tries to edit
  will report a denied tool call rather than a pstack bug.
