# Generated tree fidelity

`generated/vibe/` is built from `vendor/pstack/` plus `adapters/`. A user never edits
it by hand. `npm run generate` rebuilds it, and `npm run check` fails when the
committed tree drifts from a fresh build, so a change to a substitution, a fork, or the
model sheet cannot land without the generated tree following.

## Sub-features

- `generate-build` rebuilds `generated/vibe/` from vendor and adapters.
- `generate-check` fails when the committed tree differs from a fresh build.
- `generate-idempotent` produces the same tree on a second run.
- `generate-forks` copies each fork verbatim from `adapters/forks/`.
- `generate-no-cursor` keeps Cursor tool names and `.cursor` paths out of the output.
- `generate-sheet` renders the role table from `model-sheet/roles.toml`.

## How to get to it (user POV)

- Run `npm run generate` after changing `adapters/`, `model-sheet/`, or `vendor/`.
- Run `npm run check` before committing, and in CI.
- Run `npm test` for the fork, vendor, and no-Cursor assertions.

## Driving it with control-pstack

Preconditions:

- `npm install` has run, so `smol-toml` resolves. A fresh clone fails with
  `ERR_MODULE_NOT_FOUND` until it does.
- The working tree is clean apart from the change under test.

- **Clean tree passes.** Run `npm run check`. Stdout ends `generated tree is up to
  date` and the exit code is `0`.
- **Drift fails.** Append a newline to `generated/vibe/plugin.json`, then run
  `npm run check`. Exit code is `1` and stdout lists `plugin.json` — the drifted path,
  one per line. Restore the file and re-run; exit code returns to `0`.
- **Regenerate restores.** Instead of restoring by hand, run `npm run generate`. Stdout
  reads `generated N files in <out>`, and `npm run check` then passes. `git status`
  shows no change to `generated/vibe/`.
- **Idempotent.** Run `npm run generate` twice. The second run reports the same file
  count and `git status` stays clean.
- **Forks match their sources.** Run `npm test`. The fork assertions pass, meaning each
  file under `adapters/forks/` is byte-identical to its copy in `generated/vibe/`.
- **No Cursor leakage.** Run `npm test`. The no-Cursor assertions pass, meaning the
  generated skills contain no Cursor tool names and no `.cursor` paths.
- **Proof.** Keep the stdout and exit code of each command under
  `$RUN_DIR/artifacts/generate/`, plus `git status --porcelain` before and after.

## Gotchas

- `npm run check` exits `1` on drift but prints only the drifted paths. Read the exit
  code, not just the last line.
- A piped `npm run check` reports the pipe's exit code, not npm's. Capture the exit code
  directly or the drift gate looks like a pass.
- `npm install` is required first. Without `node_modules`, both `check` and `test` fail
  with `ERR_MODULE_NOT_FOUND`, which looks like a code failure and is not.
- `npm run generate` rewrites the whole tree. Review `git status` before committing; a
  stale vendor pin shows up as a large diff, not an error.
- The doctor's skills check and the generated tree are coupled. Adding or removing a skill
  regenerates `skills.manifest` with the tree, and the doctor compares against it.
- `scripts/sync.mjs` refuses on a dirty tree. Commit or stash before refreshing the
  vendor pin.
