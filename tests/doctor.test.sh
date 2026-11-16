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

echo "doctor: PASS"
