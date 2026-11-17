#!/bin/sh
# Remove a directory tree, including the read-only plugin snapshots a Vibe
# session pins under logs/session/plugins/. rm -rf needs write permission on a
# directory to unlink its entries, so the chmod has to come first.
set -eu

path=${1-}
while [ "${path%/}" != "$path" ]; do path=${path%/}; done
case $path in
  '' | / | . | .. | */. | */..)
    printf 'remove-tree: refusing to remove unsafe path: %s\n' "${1-}" >&2
    exit 1
    ;;
esac

[ -e "$path" ] || exit 0

chmod -R u+w "$path" 2>/dev/null || :
rm -rf -- "$path" || :
if [ -e "$path" ]; then
  printf 'remove-tree: %s survived removal\n' "$path" >&2
  exit 1
fi
