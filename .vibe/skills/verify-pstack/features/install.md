# Install and remove the plugin

Install copies the generated plugin tree into a Vibe home so the next session loads
pstack. A user can install at user scope or project scope, reinstall over an existing
copy, preview without writing, and remove the plugin with or without its model sheet
and agent profiles.

## Sub-features

- `install-user` copies `generated/vibe/` to `$VIBE_HOME/plugins/pstack`.
- `install-project` copies it to `./.vibe/plugins/pstack` in the current directory.
- `install-update` reinstalls over an existing pstack copy.
- `install-dry-run` prints the writes without performing them.
- `install-uninstall` removes the plugin directory.
- `install-purge` also removes the model sheet and `pstack-*.toml` profiles.
- `install-refuse` refuses to replace a directory that is not a pstack plugin.

## How to get to it (user POV)

- Run `node bin/pstack-vibe.mjs install` from the repository root.
- Run `node bin/pstack-vibe.mjs install --project` from the repository you want to pin.
- Run `node bin/pstack-vibe.mjs update`.
- Run `node bin/pstack-vibe.mjs uninstall`, adding `--purge` to remove the sheet and
  profiles too.
- Add `--dry-run` to any of the above.

## Driving it with control-pstack

Preconditions:

- A launched run: `control-pstack launch` has created `$RUN_DIR/home`.
- `$RUN_DIR/home/plugins/pstack` exists from that launch.

- **Install at user scope.** Run `VIBE_HOME=$RUN_DIR/home node bin/pstack-vibe.mjs install`.
  Stdout reads `install: pstack installed at $RUN_DIR/home/plugins/pstack (user scope).`
  and exit code is `0`. `$RUN_DIR/home/plugins/pstack/plugin.json` exists and names
  `pstack`.
- **Reinstall over it.** Run `VIBE_HOME=$RUN_DIR/home node bin/pstack-vibe.mjs update`.
  Stdout reads `update: pstack updated at ...` and exit code is `0`. The directory is
  replaced, not merged.
- **Preview a write.** Run `VIBE_HOME=$RUN_DIR/home node bin/pstack-vibe.mjs install
  --dry-run`. Stdout lines start with `dry-run:` and end with
  `install: dry run; nothing written`. The plugin directory's mtime is unchanged.
- **Refuse a foreign directory.** Create `$RUN_DIR/home/plugins/pstack` containing a
  `plugin.json` that does not name pstack, then run
  `VIBE_HOME=$RUN_DIR/home node bin/pstack-vibe.mjs install`. Exit code is `1` and stderr
  reads `exists and is not a pstack plugin; rerun with --force to replace it`. The
  directory is untouched.
- **Install at project scope.** From a scratch directory, run
  `node <repo>/bin/pstack-vibe.mjs install --project`. `./.vibe/plugins/pstack/plugin.json`
  appears in that scratch directory and `$RUN_DIR/home/plugins/pstack` is unchanged.
- **Uninstall.** Run `VIBE_HOME=$RUN_DIR/home node bin/pstack-vibe.mjs uninstall`. Stdout
  reads `uninstall: removed ...`. The plugin directory is gone and
  `$RUN_DIR/home/pstack-models.md` still exists.
- **Purge.** Relaunch, then run `VIBE_HOME=$RUN_DIR/home node bin/pstack-vibe.mjs uninstall
  --purge`. The plugin directory, `$RUN_DIR/home/pstack-models.md`, and
  `$RUN_DIR/home/agents/pstack-*.toml` are all gone.
- **Proof.** Keep the stdout and exit code of each command under
  `$RUN_DIR/artifacts/install/`, and a `find $RUN_DIR/home -name plugin.json` listing
  after each mutation.

## Gotchas

- `--project` writes into the **current** directory, not the repository the CLI
  lives in. Run it from a scratch directory or you will dirty this repo.
- `install` and `update` differ only in `--force`; `update` on a foreign directory
  replaces it without asking.
- `uninstall` without `--purge` leaves the sheet and profiles behind, so the next
  session still injects a sheet for a plugin that is no longer installed. That is
  expected, not a bug.
- The installer prints `Run /reload or start a new session.` A running session does not
  pick up the change.
- `--dry-run` still runs the Vibe version gate and validates the source tree, so a dry
  run can fail where a real run would.
