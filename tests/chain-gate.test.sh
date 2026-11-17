#!/bin/sh
# tests/chain-gate.test.sh
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

script="$root/generated/vibe/ai.mistral.vibe/scripts/chain.sh"
export PLUGIN_DATA="$tmp/data"
export PLUGIN_ROOT="$root/generated/vibe"

fail() {
  printf 'chain-gate: FAIL (%s)\n' "$1" >&2
  exit 1
}

# The payload's string values are JSON-escaped, so a command's own quotes arrive
# as \" and the gate has to read through them.
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# Prints the hook's stdout and returns its exit status.
gate() {
  printf '{"session_id": "%s", "transcript_path": "/tmp/t", "cwd": "%s", "parent_session_id": null, "hook_event_name": "pre_tool", "tool_name": "file_system.bash", "tool_call_id": "call_gate", "tool_input": {"command": "%s", "timeout": 120}}' \
    "$1" "${3:-$tmp}" "$(json_escape "$2")" | sh "$script" gate
}

run_dir() {
  mkdir -p "$PLUGIN_DATA/runs/$1"
  : > "$PLUGIN_DATA/runs/$1/ready"
  : > "$PLUGIN_DATA/runs/$1/armed"
}

# The pre_agent payload carries the text the user typed.
arm() {
  printf '{"session_id": "%s", "transcript_path": "/tmp/t", "cwd": "%s", "parent_session_id": null, "hook_event_name": "pre_agent", "agent_name": "accept-edits", "turn_id": "turn-1", "prompt": "%s"}' \
    "$1" "$tmp" "$(json_escape "$2")" | sh "$script" arm
}

body="$tmp/body.md"
cat > "$body" <<'EOF'
## Why
The chain was skippable.

## What changed
- a thing

## Scope
- covers this

## Blast Radius
- low

## Verification
- npm test
EOF

# The full evidence set: every playbook opened, every step signed.
cat > "$tmp/evidence-full.tsv" <<'EOF'
file_system.read_file	path=/p/skills/poteto-mode/SKILL.md
file_system.read_file	path=/p/skills/poteto-mode/playbooks/feature.md
file_system.read_file	path=/p/skills/poteto-mode/playbooks/opening-a-pr.md
file_system.read_file	path=/p/skills/architect/SKILL.md
file_system.read_file	path=/p/skills/arena/SKILL.md
file_system.read_file	path=/p/skills/interrogate/SKILL.md
file_system.read_file	path=/p/skills/no-comments/SKILL.md
file_system.read_file	path=/p/skills/technical-writing/SKILL.md
file_system.read_file	path=/p/skills/unslop/SKILL.md
file_system.bash	cmd=git worktree add ../wt
file_system.bash	cmd=git commit -m "feat(pstack): record"
agents.spawn	name=architect-1	config=pstack:poteto-agent
agents.spawn	name=architect-2	config=pstack:poteto-agent
agents.spawn	name=architect-3	config=pstack:poteto-agent
EOF

# The same set with the interrogate read removed, so `contested` decides.
grep -v 'interrogate' "$tmp/evidence-full.tsv" > "$tmp/evidence-nointerrogate.tsv"
# And with the third architect spawn removed.
grep -v 'architect-3' "$tmp/evidence-nointerrogate.tsv" > "$tmp/evidence-twos.tsv"
# And with the worktree call and every spawn removed, so `subagents` decides.
grep -v -e 'git worktree add' -e 'agents.spawn' "$tmp/evidence-full.tsv" > "$tmp/evidence-nosubagents.tsv"
# And with the Opening a PR playbook never opened, and /no-comments never read.
grep -v -e 'playbooks/opening-a-pr.md' -e 'no-comments' "$tmp/evidence-full.tsv" \
  > "$tmp/evidence-nopening.tsv"

ship="gh pr create --title \"feat(pstack): record chain evidence\" --body-file $body"

mkdir -p "$PLUGIN_DATA/runs/sess-arm"
arm sess-arm "/pstack:poteto-mode do a thing"
[ -f "$PLUGIN_DATA/runs/sess-arm/armed" ] || fail "a poteto-mode prompt did not arm the gate"
echo "chain-gate: PASS (a poteto-mode prompt arms the gate)"

mkdir -p "$PLUGIN_DATA/runs/sess-noarm"
arm sess-noarm "fix the doctor"
if [ -e "$PLUGIN_DATA/runs/sess-noarm/armed" ]; then
  fail "an unrelated prompt armed the gate"
fi
echo "chain-gate: PASS (an unrelated prompt does not arm the gate)"

# A session that only touches the skill file is not a poteto-mode run.
mkdir -p "$PLUGIN_DATA/runs/sess-edit"
printf 'file_system.read_file\tpath=/p/skills/poteto-mode/SKILL.md\nfile_system.edit\tpath=/p/skills/poteto-mode/SKILL.md\n' \
  > "$PLUGIN_DATA/runs/sess-edit/evidence.tsv"
out=$(gate sess-edit "gh pr create --title x") || fail "an unarmed session was blocked"
[ -z "$out" ] || fail "editing the skill file armed the gate: $out"
echo "chain-gate: PASS (editing poteto-mode/SKILL.md does not arm the gate)"

run_dir sess-unarmed
rm -f "$PLUGIN_DATA/runs/sess-unarmed/armed"
printf 'file_system.bash\tcmd=ls\n' > "$PLUGIN_DATA/runs/sess-unarmed/evidence.tsv"
out=$(gate sess-unarmed "gh pr create --title x") || fail "unarmed session was blocked"
[ -z "$out" ] || fail "unarmed session emitted output"
echo "chain-gate: PASS (unarmed session allows)"

run_dir sess-bare
grep -v 'architect' "$tmp/evidence-full.tsv" > "$PLUGIN_DATA/runs/sess-bare/evidence.tsv"
out=$(gate sess-bare "$ship") || fail "gate exited non-zero on a deny"
case $out in
  '{"decision":"deny"'*) ;;
  *) fail "deny is not a JSON decision: $out" ;;
esac
case $out in
  *feature/architect*) ;;
  *) fail "deny does not name feature/architect: $out" ;;
esac
echo "chain-gate: PASS (armed with no architect read denies naming feature/architect)"

run_dir sess-ok
cp "$tmp/evidence-full.tsv" "$PLUGIN_DATA/runs/sess-ok/evidence.tsv"
printf 'contested no 3/3 three runners\n' > "$PLUGIN_DATA/runs/sess-ok/claim.tsv"
out=$(gate sess-ok "$ship") || fail "full evidence was blocked"
[ -z "$out" ] || fail "full evidence emitted output: $out"
echo "chain-gate: PASS (full evidence and a valid body allow)"

out=$(gate sess-ok "gh pr create --help") || fail "gh pr create --help was blocked"
[ -z "$out" ] || fail "gh pr create --help emitted output: $out"
echo "chain-gate: PASS (gh pr create --help allows)"

out=$(gate sess-ok "gh api repos/o/r/pulls/12") || fail "a gh api read was blocked"
[ -z "$out" ] || fail "a gh api read emitted output: $out"
out=$(gate sess-ok "gh api repos/o/r/pulls -f title=x") || fail "gate exited non-zero on a deny"
case $out in
  *opening-a-pr/body-file*) ;;
  *) fail "a gh api POST was not audited as a ship call: $out" ;;
esac
echo "chain-gate: PASS (gh api reads allow, a POST to /pulls is a ship call)"

out=$(gate sess-ok "gh run watch") || fail "gate exited non-zero on a deny"
case $out in
  *opening-a-pr/no-ci-watch*) ;;
  *) fail "deny does not name opening-a-pr/no-ci-watch: $out" ;;
esac
echo "chain-gate: PASS (gh run watch denies)"

out=$(gate sess-ok "grep -n \"pstack-vibe update\" README.md") || fail "a README grep was blocked"
[ -z "$out" ] || fail "a README grep emitted output: $out"
out=$(gate sess-ok "./bin/pstack-vibe.mjs update") || fail "gate exited non-zero on a deny"
case $out in
  *session/install-update*) ;;
  *) fail "deny does not name session/install-update: $out" ;;
esac
echo "chain-gate: PASS (a README grep allows, ./bin/pstack-vibe.mjs update denies)"

out=$(gate sess-ok "gh pr create --title \"fix: make doctor fail\" --body-file $body") ||
  fail "a scope-less title was blocked"
[ -z "$out" ] || fail "a scope-less title emitted output: $out"
echo "chain-gate: PASS (a scope-less title allows)"

out=$(gate sess-ok "$ship") || fail "a complete body was blocked"
[ -z "$out" ] || fail "a complete body emitted output: $out"
grep -v '^## Why$' "$body" > "$tmp/body-nowhy.md"
out=$(gate sess-ok "gh pr create --title \"feat(pstack): record chain evidence\" --body-file $tmp/body-nowhy.md") ||
  fail "gate exited non-zero on a deny"
case $out in
  *opening-a-pr/body-why*) ;;
  *) fail "deny does not name opening-a-pr/body-why: $out" ;;
esac
echo "chain-gate: PASS (the body headings are checked per line)"

out=$(gate sess-ok "gh pr create --draft --title \"feat(pstack): record chain evidence\" --body-file $body") ||
  fail "gate exited non-zero on a deny"
case $out in
  *opening-a-pr/not-draft*) ;;
  *) fail "deny does not name opening-a-pr/not-draft: $out" ;;
esac
echo "chain-gate: PASS (--draft denies naming opening-a-pr/not-draft)"

out=$(gate sess-ok "gh pr create --title \"feat(pstack): record chain evidence\"") ||
  fail "gate exited non-zero on a deny"
case $out in
  *opening-a-pr/body-file*) ;;
  *) fail "deny does not name opening-a-pr/body-file: $out" ;;
esac
case $out in
  *opening-a-pr/body-why*|*opening-a-pr/title*) fail "deny named more than body-file: $out" ;;
esac
echo "chain-gate: PASS (no --body-file denies naming only opening-a-pr/body-file)"

mkdir -p "$tmp/session/.vibe"
cp "$body" "$tmp/session/.vibe/pr-body.md"
out=$(gate sess-ok "gh pr create --title \"feat(pstack): record chain evidence\" --body-file .vibe/pr-body.md" "$tmp/session") ||
  fail "a relative --body-file was blocked"
[ -z "$out" ] || fail "a relative --body-file emitted output: $out"
echo "chain-gate: PASS (a relative --body-file resolves against the payload cwd)"

out=$(gate sess-ok "gh pr checks 42 --watch") || fail "gate exited non-zero on a deny"
case $out in
  *opening-a-pr/no-ci-watch*) ;;
  *) fail "deny does not name opening-a-pr/no-ci-watch: $out" ;;
esac
case $out in
  *opening-a-pr/body-file*) fail "a guard call was told to pass --body-file: $out" ;;
esac
printf 'contested no 3/3 three runners\nbabysit yes\n' > "$PLUGIN_DATA/runs/sess-ok/claim.tsv"
out=$(gate sess-ok "gh pr checks 42 --watch") || fail "a claimed babysit was blocked"
[ -z "$out" ] || fail "a claimed babysit emitted output: $out"
printf 'contested no 3/3 three runners\n' > "$PLUGIN_DATA/runs/sess-ok/claim.tsv"
echo "chain-gate: PASS (gh pr checks --watch follows the babysit claim, and a guard call is never told to pass --body-file)"

run_dir sess-23
cp "$tmp/evidence-nointerrogate.tsv" "$PLUGIN_DATA/runs/sess-23/evidence.tsv"
printf 'contested no 2/3 two of three\n' > "$PLUGIN_DATA/runs/sess-23/claim.tsv"
out=$(gate sess-23 "$ship") || fail "gate exited non-zero on a deny"
case $out in
  *feature/interrogate*) ;;
  *) fail "deny does not name feature/interrogate: $out" ;;
esac
echo "chain-gate: PASS (contested no 2/3 denies naming feature/interrogate)"

run_dir sess-33
cp "$tmp/evidence-nointerrogate.tsv" "$PLUGIN_DATA/runs/sess-33/evidence.tsv"
printf 'contested no 3/3 three runners\n' > "$PLUGIN_DATA/runs/sess-33/claim.tsv"
out=$(gate sess-33 "$ship") || fail "contested no 3/3 was blocked"
[ -z "$out" ] || fail "contested no 3/3 emitted output: $out"
echo "chain-gate: PASS (contested no 3/3 with three spawns allows)"

run_dir sess-absent
cp "$tmp/evidence-twos.tsv" "$PLUGIN_DATA/runs/sess-absent/evidence.tsv"
out=$(gate sess-absent "$ship") || fail "gate exited non-zero on a deny"
case $out in
  *feature/interrogate*) ;;
  *) fail "deny does not name feature/interrogate: $out" ;;
esac
echo "chain-gate: PASS (absent contested with two spawns denies)"

run_dir sess-nosub
cp "$tmp/evidence-nosubagents.tsv" "$PLUGIN_DATA/runs/sess-nosub/evidence.tsv"
printf 'contested yes 0/0 no runners\n' > "$PLUGIN_DATA/runs/sess-nosub/claim.tsv"
out=$(gate sess-nosub "$ship") || fail "a run with no subagents was blocked"
[ -z "$out" ] || fail "a run with no subagents emitted output: $out"
echo "chain-gate: PASS (worktree applies only when the evidence holds a spawn)"

run_dir sess-nopening
cp "$tmp/evidence-nopening.tsv" "$PLUGIN_DATA/runs/sess-nopening/evidence.tsv"
printf 'contested no 3/3 three runners\n' > "$PLUGIN_DATA/runs/sess-nopening/claim.tsv"
out=$(gate sess-nopening "$ship") || fail "gate exited non-zero on a deny"
case $out in
  *opening-a-pr/no-comments*) ;;
  *) fail "deny does not name opening-a-pr/no-comments: $out" ;;
esac
echo "chain-gate: PASS (a run that never read opening-a-pr.md is still denied on its rows)"

mkdir -p "$tmp/badplugin/ai.mistral.vibe"
printf 'playbook\tstep\twhen\nfeature\tarchitect\talways\n' > "$tmp/badplugin/ai.mistral.vibe/chain.tsv"
status=0
out=$(PLUGIN_ROOT="$tmp/badplugin" gate sess-ok "$ship" 2>/dev/null) || status=$?
[ "$status" -ne 0 ] || fail "a malformed manifest exited 0"
[ -z "$out" ] || fail "a malformed manifest emitted a decision: $out"
echo "chain-gate: PASS (a malformed manifest exits non-zero)"

# The arms are anchored at a command boundary, so a run that greps its own docs
# or reads its own git log is not blocked.
run_dir sess-thin
printf 'file_system.read_file\tpath=/p/skills/poteto-mode/SKILL.md\n' > "$PLUGIN_DATA/runs/sess-thin/evidence.tsv"
for c in "git log --grep='gh pr create'" "gh pr create --help" "gh api repos/o/r/pulls/12"; do
  out=$(gate sess-ok "$c") || fail "a mention of a gated string was blocked: $c"
  [ -z "$out" ] || fail "a mention of a gated string emitted output: $c -> $out"
done
out=$(gate sess-thin "grep -n 'pstack-vibe update' README.md") || fail "a README grep was blocked"
[ -z "$out" ] || fail "a README grep emitted output: $out"
echo "chain-gate: PASS (a command that mentions a gated string is not gated)"

for c in "gh pr create --title x" "cd /repo && gh pr create --title x"; do
  out=$(gate sess-ok "$c") || fail "gate exited non-zero on a deny: $c"
  case $out in
    *opening-a-pr/body-file*) ;;
    *) fail "not audited as a ship call: $c -> $out" ;;
  esac
done
for c in "gh run watch 1" "gh pr checks 42 --watch"; do
  out=$(gate sess-ok "$c") || fail "gate exited non-zero on a deny: $c"
  case $out in
    *opening-a-pr/no-ci-watch*) ;;
    *) fail "not audited as a guard call: $c -> $out" ;;
  esac
done
for c in "./bin/pstack-vibe.mjs update" "node bin/pstack-vibe.mjs update" \
  "npx pstack-vibe update" "npx -y pstack-vibe update" "npm exec pstack-vibe update" \
  "pstack-vibe update" "npx pstack-vibe install --force"; do
  out=$(gate sess-ok "$c") || fail "gate exited non-zero on a deny: $c"
  case $out in
    *session/install-update*) ;;
    *) fail "not audited as an install update: $c -> $out" ;;
  esac
done
out=$(gate sess-ok "npx pstack-vibe install && echo --force") || fail "gate exited non-zero on a deny"
[ -z "$out" ] || fail "a --force outside the install call was gated: $out"
echo "chain-gate: PASS (the anchored arms still catch the real call)"

out=$(gate sess-thin "gh run watch 12345") || fail "gate exited non-zero on a deny"
case $out in
  *opening-a-pr/no-ci-watch*) ;;
  *) fail "deny does not name opening-a-pr/no-ci-watch: $out" ;;
esac
for row in opening-a-pr/worktree opening-a-pr/commits opening-a-pr/commit-scope \
  opening-a-pr/no-comments opening-a-pr/technical-writing opening-a-pr/unslop \
  feature/architect; do
  case $out in
    *"$row"*) fail "a guard call was denied on the ship row $row: $out" ;;
  esac
done
printf 'babysit yes\n' > "$PLUGIN_DATA/runs/sess-thin/claim.tsv"
out=$(gate sess-thin "gh pr checks 42 --watch") || fail "a claimed babysit was blocked"
[ -z "$out" ] || fail "a claimed babysit emitted output: $out"
echo "chain-gate: PASS (a guard call is judged only on the command it is about to run)"

sh -n "$script" || fail "sh -n failed"
echo "chain-gate: PASS (sh -n)"

echo "chain-gate: PASS"
