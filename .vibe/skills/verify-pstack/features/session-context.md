# Session context

When a Vibe session starts, pstack's `session_start` hook injects context the model
would otherwise have to go looking for: a banner naming the plugin, the plugin root,
the adapter doc path, the role-table path, and the full model sheet. A user sees the
effect, not the hook: the model already knows the role table on the first turn.

## Sub-features

- `context-banner` names the plugin and points at `/pstack:poteto-mode`.
- `context-paths` gives the plugin root, the adapter doc, and the role table.
- `context-sheet` inlines the model sheet.
- `context-cwd-sheet` prefers a sheet in the session's cwd over the user-level one.
- `context-missing-sheet` says to run `/pstack:setup-pstack` when no sheet is found.
- `context-json` escapes control characters so the hook payload stays valid JSON.

## How to get to it (user POV)

- Start any Vibe session with the plugin installed. The hook runs on `startup`,
  `resume`, `clear`, and `fork`.
- Nothing to type. The context arrives before the first message reaches the model.

## Driving it with control-pstack

Preconditions:

- A launched run: `control-pstack launch` has created `$RUN_DIR/home` and
  `$RUN_DIR/scratch`.
- `~/.vibe/pstack-models.md` exists and names `pstack-ml4` for security review, so a
  planted sheet is distinguishable from the real one.

- **Plant a distinguishable sheet.** Run `control-pstack sheet pstack-glm`. Stdout
  reads `planted $RUN_DIR/scratch/.vibe/pstack-models.md with security review:
  pstack-glm`.
- **Prove the hook fired and read the planted sheet.** Run `control-pstack drive
  "Without reading any file, state the profile the pstack model sheet assigns to the
  'security review' role. Answer with just the profile name."`. Stdout is `pstack-glm`
  and `exit_code.txt` is `0`. An answer of `pstack-ml4` means the hook read
  `~/.vibe/pstack-models.md` instead; no answer at all means the hook did not fire.
- **Prove the banner reached the model.** Run `control-pstack drive "Quote the first
  line of the pstack context you were given at session start, verbatim."`. Stdout
  contains `pstack is installed. For rigorous work, invoke /pstack:poteto-mode`.
- **Prove the missing-sheet path.** Remove `$RUN_DIR/scratch/.vibe/pstack-models.md`
  and set `HOME` to an empty directory for the drive, then ask the same question.
  Stdout reports that no model sheet was found and to run `/pstack:setup-pstack`.
- **Proof.** Keep `prompt.txt`, `stdout.txt`, `exit_code.txt`, and
  `export/export.json` under `$RUN_DIR/artifacts/drive-<n>/`. The export's warnings
  array must be empty; a config issue there means Vibe rejected the hook payload.

## Gotchas

- **The hook reads `$HOME/.vibe`, not `$VIBE_HOME`.** `session-start.sh` resolves the
  sheet from the payload cwd, then `./.vibe/pstack-models.md`, then
  `$HOME/.vibe/pstack-models.md`. Overriding `VIBE_HOME` alone does not isolate the
  sheet, so a run without a planted sheet proves the real home's sheet and nothing
  about the run.
- The hook runs at session start only. Editing the sheet mid-session changes nothing
  until the next session.
- The hook cannot block a session. A failing hook shows a warning and the session
  continues without its context, so "the session worked" is not proof the hook ran.
- The hook's output is `hook_specific_output.additional_context`, which is invisible in
  the transcript. Ask the model about it rather than looking for it on screen.
- A sheet with control characters must still produce valid JSON. That path is covered
  by `tests/session-start.test.sh`, not by a drive.
