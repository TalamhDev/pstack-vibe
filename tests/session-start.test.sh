#!/bin/sh
# tests/session-start.test.sh
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

script="$root/generated/vibe/ai.mistral.vibe/scripts/session-start.sh"

check_context() {
  node -e '
    const fs = require("fs");
    const out = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const ctx = out.hook_specific_output.additional_context;
    if (typeof ctx !== "string" || ctx.length === 0) throw new Error("missing context");
    for (const expected of process.argv.slice(2)) {
      if (!ctx.includes(expected)) throw new Error("missing: " + expected);
    }
  ' "$@"
}

mkdir -p "$tmp/home/.vibe"
cat > "$tmp/home/.vibe/pstack-models.md" <<'EOF'
# pstack model configuration
# budget: large (high)
feature, refactoring: pstack-deepseek
EOF

HOME="$tmp/home" PLUGIN_ROOT="$root/generated/vibe" \
  sh "$script" < /dev/null > "$tmp/out.json"
check_context "$tmp/out.json" "pstack-deepseek" "poteto-mode"
echo "session-start: PASS (home sheet)"

mkdir -p "$tmp/project/.vibe"
cat > "$tmp/project/.vibe/pstack-models.md" <<'EOF'
feature, refactoring: pstack-local
EOF
(cd "$tmp/project" && HOME="$tmp/home" PLUGIN_ROOT="$root/generated/vibe" \
  sh "$script" < /dev/null > "$tmp/local.json")
check_context "$tmp/local.json" "pstack-local"
if grep -q "pstack-deepseek" "$tmp/local.json"; then
  echo "session-start: FAIL (project sheet did not win)" >&2
  exit 1
fi
echo "session-start: PASS (project sheet wins)"

mkdir -p "$tmp/payload/.vibe" "$tmp/elsewhere"
cat > "$tmp/payload/.vibe/pstack-models.md" <<'EOF'
feature, refactoring: pstack-payload
EOF
(cd "$tmp/elsewhere" && printf '{"cwd":"%s","transcript_path":"/tmp/session.jsonl"}\n' "$tmp/payload" \
  | HOME="$tmp/home" PLUGIN_ROOT="$root/generated/vibe" sh "$script" > "$tmp/payload.json")
check_context "$tmp/payload.json" "pstack-payload"
if grep -q "pstack-deepseek" "$tmp/payload.json"; then
  echo "session-start: FAIL (payload cwd sheet did not win)" >&2
  exit 1
fi
echo "session-start: PASS (payload cwd sheet wins)"

mkdir -p "$tmp/control/.vibe" "$tmp/control-home"
printf 'feature, refactoring: pstack-control\fbell\n' > "$tmp/control/.vibe/pstack-models.md"
printf '{"cwd":"%s"}\n' "$tmp/control" \
  | HOME="$tmp/control-home" PLUGIN_ROOT="$root/generated/vibe" sh "$script" > "$tmp/control.json"
check_context "$tmp/control.json" "pstack-control"
echo "session-start: PASS (control characters stay valid JSON)"

mkdir -p "$tmp/home with space/.vibe"
cp "$tmp/home/.vibe/pstack-models.md" "$tmp/home with space/.vibe/pstack-models.md"
HOME="$tmp/home with space" PLUGIN_ROOT="$tmp/plugin root" \
  sh "$script" < /dev/null > "$tmp/spaces.json"
check_context "$tmp/spaces.json" "pstack-deepseek" "plugin root"
echo "session-start: PASS (paths with spaces)"

mkdir -p "$tmp/empty-home" "$tmp/empty-project"
(cd "$tmp/empty-project" && HOME="$tmp/empty-home" PLUGIN_ROOT="$root/generated/vibe" \
  sh "$script" < /dev/null > "$tmp/missing.json")
check_context "$tmp/missing.json" "/pstack:setup-pstack"
echo "session-start: PASS (missing sheet)"

(cd "$tmp/empty-project" && env -u PLUGIN_ROOT HOME="$tmp/empty-home" \
  sh "$script" < /dev/null > "$tmp/derived.json")
check_context "$tmp/derived.json" "$root/generated/vibe"
echo "session-start: PASS (derives plugin root)"

echo "session-start: PASS"
