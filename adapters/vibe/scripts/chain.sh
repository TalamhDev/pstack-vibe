#!/bin/sh
# The poteto-mode chain audit: record one line of evidence per tool call.
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
. "$script_dir/json.sh"

plugin_data() {
  if [ -n "${PLUGIN_DATA:-}" ]; then
    printf '%s\n' "$PLUGIN_DATA"
    return 0
  fi
  printf '%s\n' "${HOME:-.}/.vibe/plugin-data/pstack"
}

# The value of a top-level payload key, decoded. Leftmost wins, so a key spelled
# inside a tool argument cannot shadow the real one. The scan stops at the first
# unescaped quote, because a command's own quotes arrive as `\"`.
field() {
  printf '%s\n' "$1" | LC_ALL=C awk -v key="\"$2\"" '
    function decode(s,   out, c, n) {
      out = ""
      while (length(s) > 0) {
        c = substr(s, 1, 1)
        if (c != "\\") {
          out = out c
          s = substr(s, 2)
          continue
        }
        n = substr(s, 2, 1)
        if (n == "n") out = out "\n"
        else if (n == "t") out = out "\t"
        else if (n == "r") out = out "\r"
        else if (n == "b") out = out "\b"
        else if (n == "f") out = out "\f"
        else if (n == "u") {
          out = out "\\" n
          s = substr(s, 3)
          continue
        } else out = out n
        s = substr(s, 3)
      }
      return out
    }
    {
      i = index($0, key)
      if (i == 0) next
      rest = substr($0, i + length(key))
      if (rest !~ /^[[:space:]]*:[[:space:]]*"/) next
      sub(/^[[:space:]]*:[[:space:]]*"/, "", rest)
      out = ""
      while (length(rest) > 0) {
        c = substr(rest, 1, 1)
        if (c == "\\") {
          out = out c substr(rest, 2, 1)
          rest = substr(rest, 3)
          continue
        }
        if (c == "\"") break
        out = out c
        rest = substr(rest, 2)
      }
      print decode(out)
    }'
}

# A subagent's calls fold into its parent's run.
root_session() {
  parent=$(field "$1" parent_session_id)
  if [ -n "$parent" ]; then
    printf '%s\n' "$parent"
    return 0
  fi
  field "$1" session_id
}

record() {
  payload=""
  if [ ! -t 0 ]; then
    payload="$(cat)"
  fi
  [ -n "$payload" ] || return 0

  root=$(root_session "$payload")
  [ -n "$root" ] || return 0

  dir="$(plugin_data)/runs/$root"
  [ -f "$dir/ready" ] || return 0

  # One structured line per call, parsed here so the manifest never sees JSON.
  # `name` is read from the whole payload, not a prefix: post_tool re-serializes
  # tool_input alphabetically, so a spawn's name lands after a multi-kilobyte
  # message.
  line=$(printf '%s\n' "$payload" | LC_ALL=C awk '
    function decode(s,   out, c, n) {
      out = ""
      while (length(s) > 0) {
        c = substr(s, 1, 1)
        if (c != "\\") {
          out = out c
          s = substr(s, 2)
          continue
        }
        n = substr(s, 2, 1)
        if (n == "n") out = out "\n"
        else if (n == "t") out = out "\t"
        else if (n == "r") out = out "\r"
        else if (n == "b") out = out "\b"
        else if (n == "f") out = out "\f"
        else if (n == "u") {
          out = out "\\" n
          s = substr(s, 3)
          continue
        } else out = out n
        s = substr(s, 3)
      }
      return out
    }
    function str(s, key,   i, rest, out, c) {
      i = index(s, key)
      if (i == 0) return ""
      rest = substr(s, i + length(key))
      if (rest !~ /^[[:space:]]*:[[:space:]]*"/) return ""
      sub(/^[[:space:]]*:[[:space:]]*"/, "", rest)
      out = ""
      while (length(rest) > 0) {
        c = substr(rest, 1, 1)
        if (c == "\\") {
          out = out c substr(rest, 2, 1)
          rest = substr(rest, 3)
          continue
        }
        if (c == "\"") break
        out = out c
        rest = substr(rest, 2)
      }
      return decode(out)
    }
    function flat(s) {
      gsub(/[\t\r\n]/, " ", s)
      return substr(s, 1, 1024)
    }
    function path_of(s,   v) {
      v = str(s, "\"file_path\"")
      if (v == "") v = str(s, "\"path\"")
      return v
    }
    { buf = buf $0 " " }
    END {
      tool = str(buf, "\"tool_name\"")
      if (tool == "") exit
      line = tool
      if (tool == "file_system.bash" || tool == "process.start") {
        line = line "\tcmd=" flat(str(buf, "\"command\""))
      } else if (tool == "file_system.read_file" || tool == "file_system.write_file" || tool == "file_system.edit") {
        line = line "\tpath=" flat(path_of(buf))
      } else if (tool == "agents.spawn") {
        line = line "\tname=" flat(str(buf, "\"name\""))
        line = line "\tconfig=" flat(str(buf, "\"config_name\""))
      } else if (tool == "skill.read") {
        line = line "\tname=" flat(str(buf, "\"name\""))
      }
      print line
    }')
  [ -n "$line" ] || return 0

  # One printf to an O_APPEND descriptor. A structured line is under 1100 bytes,
  # so concurrent calls cannot interleave.
  printf '%s\n' "$line" >> "$dir/evidence.tsv"
}

prune() {
  days=${1:-7}
  runs="$(plugin_data)/runs"
  [ -d "$runs" ] || return 0
  find "$runs" -mindepth 1 -maxdepth 1 -type d -mtime +"$days" -exec rm -rf {} +
}

case "${1:-}" in
  record) record ;;
  prune)
    shift
    prune "$@"
    ;;
  *)
    printf 'usage: chain.sh record|prune\n' >&2
    exit 2
    ;;
esac
