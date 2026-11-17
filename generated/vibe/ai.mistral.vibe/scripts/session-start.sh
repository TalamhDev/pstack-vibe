#!/bin/sh
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck disable=SC1091 # json.sh is checked on its own in the same glob
. "$script_dir/json.sh"

# Vibe runs plugin hooks from the plugin's pinned copy, so the session folder
# arrives in the payload's `cwd`. Read it when stdin is a pipe, then fall back
# to the current directory and the Vibe home sheet for a direct invocation.
payload=""
if [ ! -t 0 ]; then
  payload="$(cat)"
fi

cwd=""
if [ -n "$payload" ]; then
  cwd="$(printf '%s\n' "$payload" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
fi

session=""
if [ -n "$payload" ]; then
  session="$(printf '%s\n' "$payload" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
fi

# Vibe keeps user-level config under $VIBE_HOME, which defaults to ~/.vibe.
vibe_home=""
if [ -n "${VIBE_HOME:-}" ]; then
  vibe_home=$VIBE_HOME
elif [ -n "${HOME:-}" ]; then
  vibe_home="$HOME/.vibe"
fi

sheet=""
if [ -n "$cwd" ] && [ -f "$cwd/.vibe/pstack-models.md" ]; then
  sheet="$cwd/.vibe/pstack-models.md"
elif [ -f "./.vibe/pstack-models.md" ]; then
  sheet="./.vibe/pstack-models.md"
elif [ -n "$vibe_home" ] && [ -f "$vibe_home/pstack-models.md" ]; then
  sheet="$vibe_home/pstack-models.md"
fi

root="${PLUGIN_ROOT:-$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)}"

# The recorder writes only into a run directory that carries this marker, so a
# session that never opened one records nothing.
run_dir=""
if [ -n "$session" ]; then
  data="${PLUGIN_DATA:-${vibe_home:-${HOME:-.}/.vibe}/plugin-data/pstack}"
  run_dir="$data/runs/$session"
  if ! mkdir -p "$run_dir" 2>/dev/null || ! : > "$run_dir/ready" 2>/dev/null; then
    run_dir=""
  fi
fi

{
  printf '%s\n\n' "pstack is installed. For rigorous work, invoke /pstack:poteto-mode (or /poteto-mode)."
  printf 'Plugin root: %s\n' "$root"
  if [ -n "$run_dir" ]; then
    printf 'Run directory: %s\n' "$run_dir"
  fi
  printf 'Adapter: %s\n' "$root/ai.mistral.vibe/knowledge/pstack-vibe/KNOWLEDGE.md"
  printf 'Role table: %s\n' "$root/ai.mistral.vibe/knowledge/pstack-models/KNOWLEDGE.md"
  if [ -n "$sheet" ]; then
    printf 'Model sheet: %s\n\n' "$sheet"
    cat "$sheet"
  else
    printf '%s\n' "No model sheet found. Run /pstack:setup-pstack to configure model roles."
  fi
} | awk "$JSON_ESCAPE_AWK"'
BEGIN { printf "{\"hook_specific_output\":{\"additional_context\":\"" }
{
  printf "%s\\n", escape($0)
}
END { printf "\"}}" }
'
