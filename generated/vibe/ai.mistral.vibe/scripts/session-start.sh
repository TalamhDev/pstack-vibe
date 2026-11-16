#!/bin/sh
set -eu

# Vibe runs plugin hooks from the plugin's pinned copy, so the session folder
# arrives in the payload's `cwd`. Read it when stdin is a pipe, then fall back
# to the current directory and the user-level sheet for a direct invocation.
payload=""
if [ ! -t 0 ]; then
  payload="$(cat)"
fi

cwd=""
if [ -n "$payload" ]; then
  cwd="$(printf '%s\n' "$payload" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
fi

sheet=""
if [ -n "$cwd" ] && [ -f "$cwd/.vibe/pstack-models.md" ]; then
  sheet="$cwd/.vibe/pstack-models.md"
elif [ -f "./.vibe/pstack-models.md" ]; then
  sheet="./.vibe/pstack-models.md"
elif [ -n "${HOME:-}" ] && [ -f "$HOME/.vibe/pstack-models.md" ]; then
  sheet="$HOME/.vibe/pstack-models.md"
fi

root="${PLUGIN_ROOT:-$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)}"

{
  printf '%s\n\n' "pstack is installed. For rigorous work, invoke /pstack:poteto-mode (or /poteto-mode)."
  printf 'Plugin root: %s\n' "$root"
  printf 'Adapter: %s\n' "$root/ai.mistral.vibe/knowledge/pstack-vibe/KNOWLEDGE.md"
  printf 'Role table: %s\n' "$root/ai.mistral.vibe/knowledge/pstack-models/KNOWLEDGE.md"
  if [ -n "$sheet" ]; then
    printf 'Model sheet: %s\n\n' "$sheet"
    cat "$sheet"
  else
    printf '%s\n' "No model sheet found. Run /pstack:setup-pstack to configure model roles."
  fi
} | awk '
function escape(s,   out, i, c, code) {
  out = ""
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (c == "\\") out = out "\\\\"
    else if (c == q) out = out "\\\""
    else if (c == "\t") out = out "\\t"
    else if (c == "\r") out = out "\\r"
    else if (c == bs) out = out "\\b"
    else if (c == ff) out = out "\\f"
    else {
      code = index(ctrl, c)
      if (code > 0) out = out sprintf("\\u%04x", code)
      else out = out c
    }
  }
  return out
}
BEGIN {
  ctrl = ""
  for (i = 1; i < 32; i++) ctrl = ctrl sprintf("%c", i)
  bs = sprintf("%c", 8)
  ff = sprintf("%c", 12)
  q = sprintf("%c", 34)
  printf "{\"hook_specific_output\":{\"additional_context\":\""
}
{
  printf "%s\\n", escape($0)
}
END { printf "\"}}" }
'
