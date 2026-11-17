#!/bin/sh
set -eu

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck disable=SC1091 # json.sh is checked on its own in the same glob
. "$script_dir/json.sh"

plugin_data() {
  if [ -n "${PLUGIN_DATA:-}" ]; then
    printf '%s\n' "$PLUGIN_DATA"
    return 0
  fi
  if [ -n "${VIBE_HOME:-}" ]; then
    printf '%s\n' "$VIBE_HOME/plugin-data/pstack"
    return 0
  fi
  printf '%s\n' "${HOME:-.}/.vibe/plugin-data/pstack"
}

manifest_path() {
  if [ -n "${PLUGIN_ROOT:-}" ]; then
    printf '%s\n' "$PLUGIN_ROOT/ai.mistral.vibe/chain.tsv"
    return 0
  fi
  printf '%s\n' "$(CDPATH='' cd -- "$script_dir/.." && pwd)/chain.tsv"
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

# Every arm is anchored at a command boundary, so a command that merely mentions
# one of these strings (`git log --grep='gh pr create'`) is not gated.
classify() {
  if printf '%s\n' "$1" | grep -Eq '(^|[;&|] )(gh|origin) pr create.*--(help|dry-run)'; then
    printf 'none\n'
  elif printf '%s\n' "$1" | grep -Eq '(^|[;&|] )(gh|origin) pr create'; then
    printf 'ship\n'
  elif printf '%s\n' "$1" | grep -Eq '(^|[;&|] )gh api[^;&|]*/pulls' &&
    printf '%s\n' "$1" | grep -Eq '(-f |--field |--method POST|-X POST)'; then
    printf 'ship\n'
  elif printf '%s\n' "$1" | grep -Eq '(^|[;&|] )(gh|origin) (pr checks[^;&|]*--watch|run watch)'; then
    printf 'guard\n'
  elif printf '%s\n' "$1" | grep -Eq '(^|[;&|] )(sh )?\.?/?scripts/install\.sh update'; then
    printf 'guard\n'
  else
    printf 'none\n'
  fi
}

# The only arming path. A slash-invoked skill produces no hook events, and the
# skills the chain names are disable-model-invocation, so the prompt is the one
# signal that a poteto-mode run started.
arm() {
  payload=""
  if [ ! -t 0 ]; then
    payload="$(cat)"
  fi
  [ -n "$payload" ] || return 0

  prompt=$(field "$payload" prompt)
  case $prompt in
    *poteto-mode*) ;;
    *) return 0 ;;
  esac

  root=$(root_session "$payload")
  [ -n "$root" ] || return 0

  dir="$(plugin_data)/runs/$root"
  mkdir -p "$dir" 2>/dev/null || return 0
  : > "$dir/armed" 2>/dev/null || return 0
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

  # `flat` caps each field at 1024 bytes, so a spawn's multi-kilobyte message
  # never reaches the file.
  printf '%s\n' "$line" >> "$dir/evidence.tsv"
}

# Prints one `<playbook>/<step>: <reason>` line per failure. Exit 0 allows, 1
# denies, anything else is an internal error the caller must not read as a deny.
audit_run() {
  mode=$(classify "$3")
  if [ "$mode" = none ]; then
    return 0
  fi

  CHAIN_MODE=$mode \
    CHAIN_MANIFEST=$(manifest_path) \
    CHAIN_EVIDENCE=$1 \
    CHAIN_CLAIM=$2 \
    CHAIN_COMMAND=$3 \
    CHAIN_CWD=$4 \
    LC_ALL=C awk '
function flag_value(cmd, flag,   i, rest, q, j) {
  i = index(cmd, flag)
  if (i == 0) return ""
  rest = substr(cmd, i + length(flag))
  sub(/^[[:space:]]*=?[[:space:]]*/, "", rest)
  if (rest == "") return ""
  q = substr(rest, 1, 1)
  if (q == "\"" || q == "\047") {
    rest = substr(rest, 2)
    j = index(rest, q)
    if (j == 0) return rest
    return substr(rest, 1, j - 1)
  }
  sub(/[[:space:]].*/, "", rest)
  return rest
}

function bad(what, value) {
  printf "chain.tsv: %s is not one of its values: %s\n", what, value > "/dev/stderr"
  exit 2
}

BEGIN {
  mode = ENVIRON["CHAIN_MODE"]
  manifest = ENVIRON["CHAIN_MANIFEST"]
  evidence = ENVIRON["CHAIN_EVIDENCE"]
  claim = ENVIRON["CHAIN_CLAIM"]
  command = ENVIRON["CHAIN_COMMAND"]
  cwd = ENVIRON["CHAIN_CWD"]

  header = 0
  rows = 0
  while ((getline line < manifest) > 0) {
    if (line ~ /^#/ || line ~ /^[[:space:]]*$/) continue
    n = split(line, f, "\t")
    if (!header) {
      for (i = 1; i <= n; i++) col[f[i]] = i
      header = 1
      split("playbook step scope when field kind match reason", need, " ")
      for (i = 1; i <= 8; i++) {
        if (!(need[i] in col)) {
          printf "chain.tsv has no %s column\n", need[i] > "/dev/stderr"
          exit 2
        }
      }
      continue
    }
    if (n < 8) {
      printf "chain.tsv row %d has %d cells, not 8\n", rows + 1, n > "/dev/stderr"
      exit 2
    }
    rows++
    pb[rows] = f[col["playbook"]]
    st[rows] = f[col["step"]]
    sc[rows] = f[col["scope"]]
    wh[rows] = f[col["when"]]
    fd[rows] = f[col["field"]]
    kd[rows] = f[col["kind"]]
    mt[rows] = f[col["match"]]
    rs[rows] = f[col["reason"]]
    if (sc[rows] != "ship" && sc[rows] != "guard") bad("scope", sc[rows])
    if (wh[rows] != "always" && wh[rows] != "contested" && wh[rows] != "no-babysit" && wh[rows] != "subagents" && wh[rows] != "optional") bad("when", wh[rows])
    if (fd[rows] != "evidence" && fd[rows] != "title" && fd[rows] != "body" && fd[rows] != "command") bad("field", fd[rows])
    if (kd[rows] != "require" && kd[rows] != "forbid") bad("kind", kd[rows])
  }
  close(manifest)
  if (!header) {
    print "chain.tsv has no header row" > "/dev/stderr"
    exit 2
  }

  evn = 0
  while ((getline line < evidence) > 0) {
    evn++
    ev[evn] = line
  }
  close(evidence)

  contested = "yes"
  babysit = "no"
  cval = ""
  cfrac = ""
  while ((getline line < claim) > 0) {
    n = split(line, c, " ")
    if (c[1] == "contested") {
      cval = c[2]
      cfrac = c[3]
    } else if (c[1] == "babysit") {
      babysit = c[2]
    }
  }
  close(claim)

  spawns = 0
  subagents = 0
  for (i = 1; i <= evn; i++) {
    if (ev[i] !~ /^agents\.spawn\t/) continue
    subagents = 1
    if (ev[i] ~ /name=architect-/) spawns++
  }
  # An unbacked `contested no` falls back to the expensive path rather than
  # buying a cheaper run with a claim the evidence contradicts.
  if (cval == "no") {
    split(cfrac, parts, "/")
    if (parts[1] + 0 == parts[2] + 0 && parts[2] + 0 == spawns) contested = "no"
  }

  # A `gh pr create` is itself the claim that Opening a PR is happening, and the
  # session rows hold for every armed run. A feature row applies only to a run
  # that opened the Feature playbook.
  pb_set["session"] = 1
  pb_set["opening-a-pr"] = 1
  for (i = 1; i <= evn; i++) {
    if (ev[i] !~ /^file_system\.read_file\t/) continue
    s = ev[i]
    while (match(s, /playbooks\/[A-Za-z0-9._-]+\.md/)) {
      pb_set[substr(s, RSTART + 10, RLENGTH - 13)] = 1
      s = substr(s, RSTART + RLENGTH)
    }
  }

  body_file = flag_value(command, "--body-file")
  title = flag_value(command, "--title")
  bdn = 0
  body_ok = 0
  if (body_file != "") {
    # The hook runs in the plugin root, so a relative path resolves against the
    # cwd in the payload, which is the session folder.
    if (body_file !~ /^\// && cwd != "") body_file = cwd "/" body_file
    if ((getline probe < body_file) >= 0) {
      body_ok = 1
      close(body_file)
      while ((getline line < body_file) > 0) {
        bdn++
        bd[bdn] = line
      }
      close(body_file)
    }
  }

  fails = 0
  for (r = 1; r <= rows; r++) {
    if (!(pb[r] in pb_set)) continue
    if (mode == "ship" && sc[r] == "guard") continue
    if (mode == "guard" && sc[r] == "ship") continue
    if (wh[r] == "optional") continue
    if (wh[r] == "contested" && contested != "yes") continue
    if (wh[r] == "no-babysit" && babysit != "no") continue
    if (wh[r] == "subagents" && !subagents) continue

    n = 0
    if (fd[r] == "evidence") {
      for (i = 1; i <= evn; i++) lines[++n] = ev[i]
    } else if (fd[r] == "body") {
      if (!body_ok) continue
      for (i = 1; i <= bdn; i++) lines[++n] = bd[i]
    } else if (fd[r] == "title") {
      if (title != "") lines[++n] = title
    } else {
      lines[++n] = command
    }

    hit = 0
    for (i = 1; i <= n; i++) {
      if (lines[i] ~ mt[r]) {
        hit = 1
        break
      }
    }
    if (kd[r] == "forbid") hit = !hit
    if (!hit) {
      fails++
      out[fails] = pb[r] "/" st[r] ": " rs[r]
    }
  }

  if (mode == "ship" && body_file != "" && !body_ok) {
    fails++
    out[fails] = "opening-a-pr/body-file: cannot read " body_file "; write the body to a file and pass --body-file"
  }

  for (i = 1; i <= fails; i++) print out[i]
  exit (fails > 0 ? 1 : 0)
}
'
}

deny() {
  printf '%s\n' "$1" | awk "$JSON_ESCAPE_AWK"'
    BEGIN { printf "{\"decision\":\"deny\",\"reason\":\"" }
    { printf "%s\\n", escape($0) }
    END { printf "\"}" }
  '
}

gate() {
  payload=""
  if [ ! -t 0 ]; then
    payload="$(cat)"
  fi
  [ -n "$payload" ] || return 0

  command=$(field "$payload" command)
  [ -n "$command" ] || return 0

  mode=$(classify "$command")
  if [ "$mode" = none ]; then
    return 0
  fi

  root=$(root_session "$payload")
  [ -n "$root" ] || return 0

  dir="$(plugin_data)/runs/$root"
  [ -f "$dir/armed" ] || return 0

  evidence="$dir/evidence.tsv"
  [ -f "$evidence" ] || evidence=/dev/null
  claim="$dir/claim.tsv"
  [ -f "$claim" ] || claim=/dev/null

  cwd=$(field "$payload" cwd)

  status=0
  reason=$(audit_run "$evidence" "$claim" "$command" "$cwd") || status=$?

  if [ "$status" -eq 0 ]; then
    return 0
  fi
  if [ "$status" -ne 1 ]; then
    printf 'pstack chain audit failed internally (exit %s)\n' "$status" >&2
    exit "$status"
  fi

  deny "pstack chain audit blocked this call:
$reason"
}

audit() {
  evidence=""
  claim=""
  command=""
  cwd=""
  while [ "$#" -gt 0 ]; do
    case $1 in
      --evidence)
        evidence=$2
        shift 2
        ;;
      --claim)
        claim=$2
        shift 2
        ;;
      --command)
        command=$2
        shift 2
        ;;
      --cwd)
        cwd=$2
        shift 2
        ;;
      *)
        printf 'chain.sh audit: unknown argument: %s\n' "$1" >&2
        exit 2
        ;;
    esac
  done
  if [ -z "$command" ]; then
    printf 'chain.sh audit: --command is required\n' >&2
    exit 2
  fi
  [ -n "$evidence" ] || evidence=/dev/null
  [ -n "$claim" ] || claim=/dev/null
  audit_run "$evidence" "$claim" "$command" "$cwd"
}

prune() {
  days=${1:-7}
  runs="$(plugin_data)/runs"
  [ -d "$runs" ] || return 0
  find "$runs" -mindepth 1 -maxdepth 1 -type d -mtime +"$days" -exec rm -rf {} +
}

case "${1:-}" in
  arm) arm ;;
  record) record ;;
  gate) gate ;;
  audit)
    shift
    audit "$@"
    ;;
  prune)
    shift
    prune "$@"
    ;;
  *)
    printf 'usage: chain.sh arm|record|gate|audit|prune\n' >&2
    exit 2
    ;;
esac
