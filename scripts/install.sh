#!/bin/sh
# Install, update, or remove the pstack plugin for the Mistral Vibe CLI.
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)
PLUGIN_SRC="$ROOT_DIR/generated/vibe"

command_name=install
scope=user
force=0
dry_run=0
purge=0

usage() {
  cat <<'EOF'
usage: install.sh [install|update|uninstall|doctor] [--project] [--force] [--dry-run] [--purge]

  install    copy the generated plugin into the Vibe plugin directory (default)
  update     reinstall over an existing copy (same as install --force)
  uninstall  remove the plugin directory
  doctor     check the install and print one PASS or FAIL line per check

  --project  use ./.vibe instead of $VIBE_HOME (or ~/.vibe)
  --force    replace a directory that is not a pstack plugin
  --dry-run  print what would be written without writing it
  --purge    with uninstall, also remove the model sheet and pstack-*.toml agents
EOF
}

for arg in "$@"; do
  case "$arg" in
    install|update|uninstall|doctor) command_name=$arg ;;
    --project) scope=project ;;
    --force) force=1 ;;
    --dry-run) dry_run=1 ;;
    --purge) purge=1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      printf 'install: unknown argument: %s\n' "$arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ "$scope" = project ]; then
  base="./.vibe"
elif [ -n "${VIBE_HOME:-}" ]; then
  base=$VIBE_HOME
elif [ -n "${HOME:-}" ]; then
  base="$HOME/.vibe"
else
  echo "install: set VIBE_HOME or HOME" >&2
  exit 1
fi

target="$base/plugins/pstack"
sheet="$base/pstack-models.md"
agents="$base/agents"

show() {
  printf 'dry-run:'
  for word in "$@"; do
    printf ' %s' "$word"
  done
  printf '\n'
}

run() {
  if [ "$dry_run" -eq 1 ]; then
    show "$@"
  else
    "$@"
  fi
}

is_pstack_plugin() {
  [ -f "$target/plugin.json" ] &&
    grep -q '"name"[[:space:]]*:[[:space:]]*"pstack"' "$target/plugin.json"
}

install_plugin() {
  verb=$1

  if [ -e "$target" ] && ! is_pstack_plugin; then
    if [ "$force" -ne 1 ]; then
      printf 'install: %s exists and is not a pstack plugin; rerun with --force to replace it\n' "$target" >&2
      exit 1
    fi
  fi

  if [ ! -d "$PLUGIN_SRC" ]; then
    printf 'install: generated plugin not found at %s\n' "$PLUGIN_SRC" >&2
    exit 1
  fi

  run mkdir -p "$base/plugins"
  if [ -e "$target" ]; then
    run rm -rf "$target"
  fi
  run cp -R "$PLUGIN_SRC" "$target"

  if [ "$dry_run" -eq 1 ]; then
    printf '%s: dry run; nothing written\n' "$command_name"
  else
    printf '%s: pstack %s at %s (%s scope). Run /reload or start a new session.\n' \
      "$command_name" "$verb" "$target" "$scope"
  fi
}

uninstall_plugin() {
  removed=0

  if [ -e "$target" ]; then
    run rm -rf "$target"
    removed=1
  fi

  if [ "$purge" -eq 1 ]; then
    if [ -e "$sheet" ]; then
      run rm -f "$sheet"
    fi
    for profile in "$agents"/pstack-*.toml; do
      [ -e "$profile" ] || continue
      run rm -f "$profile"
    done
  fi

  if [ "$dry_run" -eq 1 ]; then
    printf 'uninstall: dry run; nothing removed\n'
  elif [ "$removed" -eq 1 ]; then
    printf 'uninstall: removed %s. Start a new session to unload pstack.\n' "$target"
  else
    printf 'uninstall: pstack is not installed at %s\n' "$target"
  fi
}

run_doctor() {
  VIBE_HOME="$base" PLUGIN_DIR="$target" sh "$SCRIPT_DIR/doctor.sh"
}

case "$command_name" in
  install) install_plugin installed ;;
  update)
    force=1
    install_plugin updated
    ;;
  uninstall) uninstall_plugin ;;
  doctor) run_doctor ;;
esac
