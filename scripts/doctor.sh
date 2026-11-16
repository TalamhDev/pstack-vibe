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

# 3. The installed skills match the generated manifest.
skills_dir="$plugin_dir/skills"
manifest="$plugin_dir/skills.manifest"

# Names in $1 (newline separated) that are absent from the newline separated
# list $2, space separated with a leading space.
absent_names() {
  printf '%s\n' "$1" | have="$2" awk '
    BEGIN {
      count = split(ENVIRON["have"], lines, "\n")
      for (i = 1; i <= count; i += 1) seen[lines[i]] = 1
    }
    NF && !($0 in seen) { out = out " " $0 }
    END { print out }
  '
}

if [ ! -f "$manifest" ]; then
  fail "skills: skills.manifest is missing from $plugin_dir; reinstall the plugin"
elif [ ! -d "$skills_dir" ]; then
  fail "skills: no skills directory at $skills_dir"
else
  installed=$(find "$skills_dir" -mindepth 2 -maxdepth 2 -type f -name SKILL.md 2>/dev/null |
    sed -e 's|/SKILL\.md$||' -e 's|.*/||' | sort)
  manifest_names=$(cat "$manifest")
  skills_missing=$(absent_names "$manifest_names" "$installed")
  skills_extra=$(absent_names "$installed" "$manifest_names")

  if [ -n "$skills_missing" ]; then
    fail "skills: missing from the install:$skills_missing"
  elif [ -n "$skills_extra" ]; then
    fail "skills: not in skills.manifest:$skills_extra"
  else
    skills=$(printf '%s\n' "$installed" | awk 'NF' | wc -l | tr -d ' ')
    pass "skills: $skills SKILL.md files match skills.manifest"
  fi
fi

# 4. The session-start hook is present.
if [ -f "$plugin_dir/ai.mistral.vibe/hooks.toml" ]; then
  pass "hook file at $plugin_dir/ai.mistral.vibe/hooks.toml"
else
  fail "hook file at $plugin_dir/ai.mistral.vibe/hooks.toml is missing"
fi

# 5. The chain manifest is installed and names only playbooks that are.
chain="$plugin_dir/ai.mistral.vibe/chain.tsv"
if [ ! -f "$chain" ]; then
  fail "chain: chain.tsv is missing from $plugin_dir/ai.mistral.vibe; reinstall the plugin"
else
  playbooks=$(awk -F'\t' '
    /^#/ || /^[[:space:]]*$/ { next }
    !header { header = 1; next }
    $1 != "session" && !seen[$1]++ { print $1 }
  ' "$chain")
  missing_playbooks=""
  for name in $playbooks; do
    if [ ! -f "$plugin_dir/skills/poteto-mode/playbooks/$name.md" ]; then
      missing_playbooks="$missing_playbooks $name"
    fi
  done
  if [ -n "$missing_playbooks" ]; then
    fail "chain: chain.tsv names playbooks that are not installed:$missing_playbooks"
  else
    pass "chain: chain.tsv is installed and names only installed playbooks"
  fi
fi

# 6. The chain recorder can write its evidence.
data="${PLUGIN_DATA:-$base/plugin-data/pstack}"
if mkdir -p "$data" 2>/dev/null && [ -w "$data" ]; then
  pass "chain: $data is writable"
else
  fail "chain: $data is not writable; the chain recorder cannot write evidence"
fi

# 7. The model sheet is present.
if [ -f "$sheet" ]; then
  pass "model sheet at $sheet"
else
  fail "model sheet at $sheet is missing; run /setup-pstack"
fi

# A family line is "# <family>: <alias>" with the alias as the whole value, so a
# prose note that happens to start with a key is not read as a family. The
# metadata keys are closed by the sheet format; the family set is not. A role
# line is any non-blank line that is not a comment, and its pstack-* tokens are
# profile names.
tab=$(printf '\t')
sheet_records=""
if [ -f "$sheet" ]; then
  sheet_records=$(awk '
    {
      line = $0
      if (line ~ /^[[:space:]]*#/) {
        sub(/^[[:space:]]*#[[:space:]]*/, "", line)
        if (line !~ /^[a-z][a-z0-9-]*:[[:space:]]*[^[:space:]]+[[:space:]]*$/) next
        key = line
        sub(/:.*/, "", key)
        if (key == "defaults" || key == "budget" || key == "parent") next
        value = line
        sub(/^[^:]*:[[:space:]]*/, "", value)
        sub(/[[:space:]].*/, "", value)
        print "family\t" key "\t" value
        next
      }
      if (line ~ /^[[:space:]]*$/) next
      while (match(line, /pstack-[a-z0-9][a-z0-9-]*/)) {
        print "role\t" substr(line, RSTART, RLENGTH)
        line = substr(line, RSTART + RLENGTH)
      }
    }
  ' "$sheet")
fi

profiles=""
families=""
aliases=""
while IFS="$tab" read -r kind first second; do
  case $kind in
    role) profiles="$profiles $first" ;;
    family)
      families="$families $first"
      aliases="$aliases $first:$second"
      ;;
  esac
done <<EOF
$sheet_records
EOF

profiles=$(printf '%s\n' "$profiles" | tr ' ' '\n' | awk 'NF' | sort -u)
for profile in $profiles; do
  family=${profile#pstack-}
  # setup-pstack step 8 writes pstack-<family>-<level> profiles, and the family
  # line still records the base alias.
  case $family in
    *-max|*-high|*-medium|*-low) family=${family%-*} ;;
  esac
  families="$families $family"
done
families=$(printf '%s\n' "$families" | tr ' ' '\n' | awk 'NF' | sort -u)

alias_for() {
  for pair in $aliases; do
    case $pair in
      "$1":*)
        printf '%s\n' "${pair#*:}"
        return 0
        ;;
    esac
  done
  return 1
}

# 8. Every pstack-* profile named on a role line is installed.
if [ ! -f "$sheet" ]; then
  fail "agent profiles: cannot check without a model sheet"
else
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

# 9. Every family the sheet names has an alias, and that alias exists in config.toml.
if [ ! -f "$sheet" ]; then
  fail "model aliases: cannot check without a model sheet"
else
  no_alias=""
  alias_missing=""
  for family in $families; do
    if ! model_alias=$(alias_for "$family"); then
      no_alias="$no_alias $family"
      continue
    fi
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

  if [ -n "$no_alias" ]; then
    fail "model aliases: no alias recorded for family:$no_alias"
  elif [ -n "$alias_missing" ]; then
    fail "model aliases missing from $config:$alias_missing"
  elif [ -z "$families" ]; then
    pass "model aliases: the sheet records no aliases"
  else
    pass "model aliases recorded in the sheet exist in $config"
  fi
fi

if [ "$failed" -ne 0 ]; then
  exit 1
fi
exit 0
