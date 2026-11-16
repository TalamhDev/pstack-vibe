#!/bin/sh
# tests/install.test.sh
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export VIBE_HOME="$tmp/vibe home"
mkdir -p "$VIBE_HOME"

sh "$root/scripts/install.sh" install
test -f "$VIBE_HOME/plugins/pstack/plugin.json"
test -f "$VIBE_HOME/plugins/pstack/skills/poteto-mode/SKILL.md"
test -f "$VIBE_HOME/plugins/pstack/ai.mistral.vibe/hooks.toml"

sh "$root/scripts/install.sh" uninstall
test ! -e "$VIBE_HOME/plugins/pstack"

# project scope
mkdir -p "$tmp/project"
cd "$tmp/project"
sh "$root/scripts/install.sh" install --project
test -f ".vibe/plugins/pstack/plugin.json"
sh "$root/scripts/install.sh" uninstall --project
test ! -e ".vibe/plugins/pstack"

echo "install: PASS"
