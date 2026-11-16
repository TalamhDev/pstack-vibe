#!/bin/sh
# Check a pstack install for the Mistral Vibe CLI.
set -eu

if [ -n "${VIBE_HOME:-}" ]; then
  base=$VIBE_HOME
elif [ -n "${HOME:-}" ]; then
  base="$HOME/.vibe"
else
  echo "doctor: set VIBE_HOME or HOME" >&2
  exit 1
fi

plugin_dir="${PLUGIN_DIR:-$base/plugins/pstack}"
sheet="$base/pstack-models.md"
config="$base/config.toml"
agents="$base/agents"

failed=0

pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; failed=1; }

# 1. vibe is on PATH and reports a version.
if command -v vibe >/dev/null 2>&1; then
  if vibe --version >/dev/null 2>&1; then
    version=$(vibe --version 2>/dev/null | head -n 1) || version=""
    pass "vibe is on PATH: $version"
  else
    fail "vibe is on PATH but 'vibe --version' failed"
  fi
else
  fail "vibe is not on PATH"
fi

# 2. The plugin manifest exists and names pstack.
if [ -f "$plugin_dir/plugin.json" ] &&
  grep -q '"name"[[:space:]]*:[[:space:]]*"pstack"' "$plugin_dir/plugin.json"; then
  pass "plugin manifest at $plugin_dir/plugin.json names pstack"
else
  fail "plugin manifest at $plugin_dir/plugin.json is missing or does not name pstack"
fi

# 3. The plugin ships every skill.
skills=0
if [ -d "$plugin_dir/skills" ]; then
  skills=$(find "$plugin_dir/skills" -type f -name SKILL.md 2>/dev/null | wc -l | tr -d ' ')
fi
if [ "$skills" -eq 58 ]; then
  pass "skills: $skills SKILL.md files"
else
  fail "skills: expected 58 SKILL.md files, found $skills"
fi

# 4. The session-start hook is present.
if [ -f "$plugin_dir/ai.mistral.vibe/hooks.toml" ]; then
  pass "hook file at $plugin_dir/ai.mistral.vibe/hooks.toml"
else
  fail "hook file at $plugin_dir/ai.mistral.vibe/hooks.toml is missing"
fi

# 5. The model sheet is present.
if [ -f "$sheet" ]; then
  pass "model sheet at $sheet"
else
  fail "model sheet at $sheet is missing; run /setup-pstack"
fi

# 6. Every pstack-* profile named in the sheet is installed.
if [ ! -f "$sheet" ]; then
  fail "agent profiles: cannot check without a model sheet"
else
  profiles=$(awk '{
    line = $0
    while (match(line, /pstack-[a-z0-9][a-z0-9-]*/)) {
      print substr(line, RSTART, RLENGTH)
      line = substr(line, RSTART + RLENGTH)
    }
  }' "$sheet" | sort -u)

  missing=""
  for profile in $profiles; do
    if [ -f "$agents/$profile.toml" ] ||
      [ -f "$plugin_dir/ai.mistral.vibe/agents/$profile.toml" ]; then
      continue
    fi
    missing="$missing $profile"
  done

  if [ -n "$missing" ]; then
    fail "agent profiles missing for:$missing"
  else
    pass "agent profiles named in the sheet are installed"
  fi
fi

# 7. Every alias recorded in the sheet exists in config.toml.
if [ ! -f "$sheet" ]; then
  fail "model aliases: cannot check without a model sheet"
else
  alias_missing=""
  alias_checked=0
  for family in deepseek glm ml4; do
    model_alias=$(awk -v family="$family" '
      $1 == "#" {
        key = $2
        sub(/:$/, "", key)
        if (key == family) print $3
      }
    ' "$sheet" | head -n 1)
    [ -n "$model_alias" ] || continue
    alias_checked=$((alias_checked + 1))
    if [ ! -f "$config" ] || ! awk -v want="$model_alias" '
      {
        line = $0
        sub(/[[:space:]]*#.*/, "", line)
        if (line ~ /^[[:space:]]*alias[[:space:]]*=/) {
          sub(/^[^=]*=[[:space:]]*/, "", line)
          gsub(/^"|"[[:space:]]*$/, "", line)
          if (line == want) found = 1
        }
      }
      END { exit(found ? 0 : 1) }
    ' "$config"; then
      alias_missing="$alias_missing $family:$model_alias"
    fi
  done

  if [ -n "$alias_missing" ]; then
    fail "model aliases missing from $config:$alias_missing"
  elif [ "$alias_checked" -eq 0 ]; then
    pass "model aliases: none recorded in the sheet"
  else
    pass "model aliases recorded in the sheet exist in $config"
  fi
fi

if [ "$failed" -ne 0 ]; then
  exit 1
fi
exit 0
