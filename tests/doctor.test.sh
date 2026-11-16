#!/bin/sh
# tests/doctor.test.sh
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export VIBE_HOME="$tmp/vibe home"
mkdir -p "$VIBE_HOME" "$tmp/bin"
cat > "$tmp/bin/vibe" <<'EOF'
#!/bin/sh
echo "vibe 3.1.2"
EOF
chmod +x "$tmp/bin/vibe"
PATH="$tmp/bin:$PATH" sh "$root/scripts/install.sh" install

out="$tmp/doctor.out"
doctor_status=0

run_doctor() {
  if PATH="$tmp/bin:$PATH" sh "$root/scripts/doctor.sh" > "$out" 2>&1; then
    doctor_status=0
  else
    doctor_status=$?
  fi
  cat "$out"
}

expect_status() {
  if [ "$doctor_status" -ne "$1" ]; then
    printf 'doctor.test: expected exit %s, got %s\n' "$1" "$doctor_status" >&2
    exit 1
  fi
}

expect_output() {
  if ! grep -q "$1" "$out"; then
    printf 'doctor.test: expected output matching: %s\n' "$1" >&2
    exit 1
  fi
}

# pass path: the sheet names a profile that has a TOML
cat > "$VIBE_HOME/pstack-models.md" <<'EOF'
# pstack model configuration
# deepseek: deepseek-flash
feature, refactoring: pstack-deepseek
EOF
mkdir -p "$VIBE_HOME/agents"
cat > "$VIBE_HOME/agents/pstack-deepseek.toml" <<'EOF'
schema_version = 1
agent_type = "subagent"
display_name = "pstack deepseek"
description = "pstack code delegate on deepseek-flash."
active_model = "deepseek-flash"
EOF
cat > "$VIBE_HOME/config.toml" <<'EOF'
[[models]]
name = "deepseek-v4-1-flash-1017"
provider = "mistral"
alias = "deepseek-flash"
EOF
run_doctor
expect_status 0
expect_output 'PASS  agent profiles named in the sheet are installed'

# a named profile with no TOML fails
rm "$VIBE_HOME/agents/pstack-deepseek.toml"
run_doctor
expect_status 1
expect_output 'FAIL  agent profiles missing for: pstack-deepseek'

# restore the profile and record an alias that exists in config.toml
cat > "$VIBE_HOME/agents/pstack-deepseek.toml" <<'EOF'
schema_version = 1
agent_type = "subagent"
display_name = "pstack deepseek"
description = "pstack code delegate on deepseek-flash."
active_model = "deepseek-flash"
EOF
cat > "$VIBE_HOME/pstack-models.md" <<'EOF'
# pstack model configuration
# deepseek: deepseek-flash
feature, refactoring: pstack-deepseek
EOF
run_doctor
expect_status 0
expect_output 'PASS  model aliases recorded in the sheet exist in'

# an alias recorded in the sheet but absent from config.toml fails
cat > "$VIBE_HOME/config.toml" <<'EOF'
[[models]]
name = "deepseek-v4-1-flash-1017"
provider = "mistral"
EOF
run_doctor
expect_status 1
expect_output 'FAIL  model aliases missing from'

# restore a passing install before the negative controls
cat > "$VIBE_HOME/config.toml" <<'EOF'
[[models]]
name = "deepseek-v4-1-flash-1017"
provider = "mistral"
alias = "deepseek-flash"
EOF
run_doctor
expect_status 0

# a skill directory missing from the install fails
mv "$VIBE_HOME/plugins/pstack/skills/arena" "$tmp/arena"
run_doctor
expect_status 1
expect_output 'FAIL  skills: missing from the install: arena'
mv "$tmp/arena" "$VIBE_HOME/plugins/pstack/skills/arena"

# an unexpected skill directory fails
mkdir -p "$VIBE_HOME/plugins/pstack/skills/zzz-unexpected"
cp "$VIBE_HOME/plugins/pstack/skills/why/SKILL.md" \
  "$VIBE_HOME/plugins/pstack/skills/zzz-unexpected/SKILL.md"
run_doctor
expect_status 1
expect_output 'FAIL  skills: not in skills.manifest:'
rm -rf "$VIBE_HOME/plugins/pstack/skills/zzz-unexpected"

# a fourth family with no alias in config.toml fails, then passes once added
cat > "$VIBE_HOME/pstack-models.md" <<'EOF'
# pstack model configuration
# deepseek: deepseek-flash
# qwen: qwen-3-max
feature, refactoring: pstack-deepseek
arena runners: pstack-deepseek, pstack-qwen
EOF
cat > "$VIBE_HOME/agents/pstack-qwen.toml" <<'EOF'
schema_version = 1
agent_type = "subagent"
display_name = "pstack qwen"
description = "pstack code delegate on qwen-3-max."
active_model = "qwen-3-max"
EOF
run_doctor
expect_status 1
expect_output 'FAIL  model aliases missing from .*qwen:qwen-3-max'
cat >> "$VIBE_HOME/config.toml" <<'EOF'

[[models]]
name = "qwen-3-max-2025"
provider = "mistral"
alias = "qwen-3-max"
EOF
run_doctor
expect_status 0

# role lines with no comment lines leave every family without an alias
cat > "$VIBE_HOME/pstack-models.md" <<'EOF'
feature, refactoring: pstack-deepseek
EOF
run_doctor
expect_status 1
expect_output 'FAIL  model aliases: no alias recorded for family: deepseek'

# a comment line naming a profile does not satisfy the profile check, and a
# prose note is not read as a family line
cat > "$VIBE_HOME/pstack-models.md" <<'EOF'
# pstack model configuration
# deepseek: deepseek-flash
# note: pstack-ghost is unused
feature, refactoring: pstack-deepseek
EOF
run_doctor
expect_status 0
expect_output 'PASS  agent profiles named in the sheet are installed'

# the same token on a role line does
cat > "$VIBE_HOME/pstack-models.md" <<'EOF'
# pstack model configuration
# deepseek: deepseek-flash
feature, refactoring: pstack-deepseek, pstack-ghost
EOF
run_doctor
expect_status 1
expect_output 'FAIL  agent profiles missing for: pstack-ghost'

echo "doctor: PASS"
