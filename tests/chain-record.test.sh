#!/bin/sh
# tests/chain-record.test.sh
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

script="$root/generated/vibe/ai.mistral.vibe/scripts/chain.sh"
export PLUGIN_DATA="$tmp/data"
export PLUGIN_ROOT="$root/generated/vibe"

fail() {
  printf 'chain-record: FAIL (%s)\n' "$1" >&2
  exit 1
}

# A run directory with the marker the recorder requires.
new_run() {
  mkdir -p "$PLUGIN_DATA/runs/$1"
  : > "$PLUGIN_DATA/runs/$1/ready"
}

# post_tool <session> <parent-or-empty> <tool_name> <tool_input-json>
post_tool() {
  parent=null
  if [ -n "$2" ]; then
    parent="\"$2\""
  fi
  printf '{"session_id": "%s", "transcript_path": "/tmp/t", "cwd": "/tmp", "parent_session_id": %s, "hook_event_name": "post_tool", "tool_name": "%s", "tool_call_id": "call_1", "tool_input": %s, "tool_status": "success", "tool_output": null, "tool_output_text": "ok", "tool_error": null, "duration_ms": 0}' \
    "$1" "$parent" "$3" "$4"
}

new_run sess-a
post_tool sess-a "" file_system.read_file '{"file_path": "/p/skills/poteto-mode/SKILL.md"}' |
  sh "$script" record
evidence="$PLUGIN_DATA/runs/sess-a/evidence.tsv"
[ -f "$evidence" ] || fail "no evidence file"
[ "$(wc -l < "$evidence" | tr -d ' ')" = 1 ] || fail "expected one line"
[ "$(cat "$evidence")" = "file_system.read_file	path=/p/skills/poteto-mode/SKILL.md" ] ||
  fail "read_file did not record one structured path line: $(cat "$evidence")"
echo "chain-record: PASS (read_file records path=)"

# post_tool re-serializes tool_input alphabetically, so a spawn's name lands
# after a multi-kilobyte message. A prefix cap would erase it.
big=$(awk 'BEGIN { s = ""; for (i = 0; i < 6000; i++) s = s "x"; print s }')
new_run sess-spawn
post_tool sess-spawn "" agents.spawn \
  "{\"config_name\": \"pstack:poteto-agent\", \"message\": \"$big\", \"name\": \"architect-1\"}" |
  sh "$script" record
spawn="$PLUGIN_DATA/runs/sess-spawn/evidence.tsv"
[ "$(wc -l < "$spawn" | tr -d ' ')" = 1 ] || fail "the spawn payload split across lines"
[ "$(cat "$spawn")" = "agents.spawn	name=architect-1	config=pstack:poteto-agent" ] ||
  fail "a 6000-byte message erased the spawn name: $(cat "$spawn")"
echo "chain-record: PASS (a 6000-byte spawn message still records name=architect-1)"

# A write_file payload carries the whole file; the evidence keeps the path only.
post_tool sess-a "" file_system.write_file \
  '{"file_path": "/p/out.md", "content": "SECRET-BODY-MARKER"}' |
  sh "$script" record
post_tool sess-a "" file_system.edit \
  '{"file_path": "/p/edit.md", "new_string": "SECRET-NEW-MARKER", "old_string": "SECRET-OLD-MARKER"}' |
  sh "$script" record
tail -n 2 "$evidence" | grep -q '^file_system.write_file	path=/p/out.md$' ||
  fail "write_file did not record its path alone"
tail -n 1 "$evidence" | grep -q '^file_system.edit	path=/p/edit.md$' ||
  fail "edit did not record its path alone"
if grep -q 'SECRET' "$evidence"; then
  fail "a write recorded the file content"
fi
echo "chain-record: PASS (write_file and edit record the path, never the content)"

# A 10 KiB command truncates at 1024 bytes and stays one line.
big=$(awk 'BEGIN { s = ""; for (i = 0; i < 10240; i++) s = s "x"; print s }')
post_tool sess-a "" file_system.bash "{\"command\": \"$big\"}" | sh "$script" record
last=$(tail -n 1 "$evidence")
[ "$(printf '%s' "$last" | wc -c | tr -d ' ')" -le 1100 ] ||
  fail "the cmd field is longer than 1024 bytes plus its prefix"
[ "$(wc -l < "$evidence" | tr -d ' ')" = 4 ] || fail "truncation split the line"
echo "chain-record: PASS (cmd truncates at 1024 bytes and stays one line)"

# A payload whose tool_input carries a literal newline still produces one line.
printf '{"session_id": "sess-a", "transcript_path": "/tmp/t", "cwd": "/tmp", "parent_session_id": null, "hook_event_name": "post_tool", "tool_name": "file_system.bash", "tool_call_id": "call_nl", "tool_input": {"command": "echo one\\necho two"}, "tool_status": "success", "tool_output": null, "tool_output_text": "ok", "tool_error": null, "duration_ms": 0}' |
  sh "$script" record
[ "$(wc -l < "$evidence" | tr -d ' ')" = 5 ] || fail "a literal newline split the line"
tail -n 1 "$evidence" | grep -q '^file_system.bash	cmd=echo one echo two$' ||
  fail "the newline payload was not flattened: $(tail -n 1 "$evidence")"
echo "chain-record: PASS (literal newline flattened)"

# Fifty concurrent appends produce fifty intact lines.
new_run sess-c
i=1
while [ "$i" -le 50 ]; do
  post_tool sess-c "" file_system.bash "{\"command\": \"echo $i\"}" |
    sh "$script" record &
  i=$((i + 1))
done
wait
concurrent="$PLUGIN_DATA/runs/sess-c/evidence.tsv"
[ "$(wc -l < "$concurrent" | tr -d ' ')" = 50 ] || fail "concurrent appends lost lines"
torn=$(grep -c -v '^file_system.bash	cmd=echo [0-9]*$' "$concurrent" || true)
[ "$torn" = 0 ] || fail "concurrent appends tore $torn lines"
echo "chain-record: PASS (fifty concurrent appends stay intact)"

# No ready marker means no file is written.
mkdir -p "$PLUGIN_DATA/runs/sess-noready"
post_tool sess-noready "" file_system.bash '{"command": "ls"}' | sh "$script" record
if [ -e "$PLUGIN_DATA/runs/sess-noready/evidence.tsv" ]; then
  fail "recorded without a ready marker"
fi
echo "chain-record: PASS (no ready marker, no evidence)"

# A subagent's calls fold into its parent's run.
new_run sess-parent
post_tool sess-child sess-parent file_system.bash '{"command": "ls"}' |
  sh "$script" record
grep -q '^file_system.bash	cmd=ls$' "$PLUGIN_DATA/runs/sess-parent/evidence.tsv" ||
  fail "subagent evidence did not reach the parent run"
if [ -e "$PLUGIN_DATA/runs/sess-child/evidence.tsv" ]; then
  fail "subagent evidence landed in its own run"
fi
echo "chain-record: PASS (subagent folds into the parent run)"

echo "chain-record: PASS"
