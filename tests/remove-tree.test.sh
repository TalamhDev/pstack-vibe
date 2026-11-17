#!/bin/sh
# tests/remove-tree.test.sh
#
# The 0500/0400 shape a driven session leaves; see scripts/remove-tree.sh.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT

helper="$root/scripts/remove-tree.sh"

plant_snapshot() {
  home=$1
  pkg="$home/logs/session/plugins/packages/59/594b4f3ff6cc67052de979b1986085e3bbf63280bc959c4c20b64de87e0f5eb0"
  mkdir -p "$pkg/skills/vibe"
  printf '{"name":"pstack"}\n' > "$pkg/plugin.json"
  printf -- '---\nname: vibe\n---\n' > "$pkg/skills/vibe/SKILL.md"
  chmod 400 "$pkg/plugin.json" "$pkg/skills/vibe/SKILL.md"
  chmod 500 "$pkg/skills/vibe" "$pkg/skills" "$pkg"
}

home="$tmp/control/home"
plant_snapshot "$home"
if rm -rf "$home" 2>/dev/null; then
  echo "remove-tree: FAIL (a plain rm -rf removed the read-only snapshot; the fixture is wrong)" >&2
  exit 1
fi
test -d "$home"
echo "remove-tree: PASS (a plain rm -rf leaves the read-only snapshot behind)"

home="$tmp/run/home"
art="$tmp/run/artifacts/drive-0"
mkdir -p "$art"
printf 'ok\n' > "$art/stdout.txt"
printf '0\n' > "$art/exit_code.txt"
plant_snapshot "$home"
sh "$helper" "$home"
if [ -e "$home" ]; then
  echo "remove-tree: FAIL (the home survived the helper)" >&2
  exit 1
fi
test -f "$art/stdout.txt"
test -f "$art/exit_code.txt"
echo "remove-tree: PASS (removes a read-only snapshot and leaves artifacts outside it)"

home="$tmp/stuck/home"
plant_snapshot "$home"
mkdir -p "$tmp/fakebin"
printf '#!/bin/sh\nexit 0\n' > "$tmp/fakebin/rm"
chmod +x "$tmp/fakebin/rm"
status=0
PATH="$tmp/fakebin:$PATH" sh "$helper" "$home" > "$tmp/stuck.out" 2> "$tmp/stuck.err" || status=$?
if [ "$status" -eq 0 ]; then
  echo "remove-tree: FAIL (a surviving home exited 0)" >&2
  exit 1
fi
if ! grep -q "$home" "$tmp/stuck.err"; then
  echo "remove-tree: FAIL (the failure did not name the surviving path)" >&2
  cat "$tmp/stuck.err" >&2
  exit 1
fi
test -d "$home"
echo "remove-tree: PASS (reports failure and names the path when the home survives)"

sh "$helper" "$tmp/never-existed"
echo "remove-tree: PASS (an absent tree is a no-op success)"

# Refusing must not touch the tree on the way out.
for bad in "" "/" "." ".." "./" "../"; do
  status=0
  sh "$helper" "$bad" > /dev/null 2>&1 || status=$?
  if [ "$status" -eq 0 ]; then
    echo "remove-tree: FAIL (accepted the unsafe path '$bad')" >&2
    exit 1
  fi
done
guard="$tmp/guard"
mkdir -p "$guard/victim"
printf 'x\n' > "$guard/victim/file"
chmod 400 "$guard/victim/file"
chmod 500 "$guard/victim"
( cd "$guard" && sh "$helper" . > /dev/null 2>&1 ) || true
if [ -w "$guard/victim/file" ]; then
  echo "remove-tree: FAIL (refusing '.' still chmodded the tree)" >&2
  exit 1
fi
echo "remove-tree: PASS (refuses an unsafe path without touching the tree)"

if [ "${PSTACK_DRIVE:-0}" != 1 ]; then
  echo "remove-tree: SKIP (real-session drive; set PSTACK_DRIVE=1 to run it)"
  echo "remove-tree: PASS"
  exit 0
fi
if ! command -v vibe > /dev/null 2>&1; then
  echo "remove-tree: SKIP (real-session drive; vibe is not on PATH)"
  echo "remove-tree: PASS"
  exit 0
fi

run="$tmp/drive"
mkdir -p "$run/home" "$run/scratch"
VIBE_HOME="$run/home" sh "$root/scripts/install.sh" install > /dev/null
if ! ( cd "$run/scratch" && VIBE_HOME="$run/home" vibe -p "Reply with the single word: ok" --trust ) > "$run/out.txt" 2>&1; then
  echo "remove-tree: SKIP (real-session drive; the session did not run, see $run/out.txt)"
  echo "remove-tree: PASS"
  exit 0
fi
if [ ! -d "$run/home/logs/session/plugins/packages" ]; then
  echo "remove-tree: FAIL (the session pinned no plugin snapshot; the drive proves nothing)" >&2
  exit 1
fi
if rm -rf "$run/home" 2>/dev/null; then
  echo "remove-tree: FAIL (a plain rm -rf removed a driven home; the bug is gone, retire this test)" >&2
  exit 1
fi
sh "$helper" "$run/home"
if [ -e "$run/home" ]; then
  echo "remove-tree: FAIL (the driven home survived the helper)" >&2
  exit 1
fi
echo "remove-tree: PASS (removes a home a real session ran in)"

echo "remove-tree: PASS"
