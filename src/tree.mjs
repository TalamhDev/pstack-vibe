import { chmod, lstat, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export class UnsafePathError extends Error {
  constructor(input) {
    super(`refusing to remove unsafe path: ${input}`);
    this.name = "UnsafePathError";
    this.exitCode = 1;
  }
}

export class TreeSurvivedError extends Error {
  constructor(path) {
    super(`${path} survived removal`);
    this.name = "TreeSurvivedError";
    this.exitCode = 1;
  }
}

const UNSAFE = new Set(["", "/", ".", ".."]);

function stripTrailingSlashes(input) {
  let path = input;
  while (path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

/**
 * A driven session pins 0500 directories and 0400 files under
 * logs/session/plugins/, and unlinking an entry needs write permission on the
 * directory that holds it, so the chmod has to come before the removal.
 */
async function makeWritable(target) {
  const info = await lstat(target);
  if (info.isSymbolicLink()) return;
  await chmod(target, info.mode | (info.isDirectory() ? 0o700 : 0o600));
  if (!info.isDirectory()) return;
  for (const name of await readdir(target)) {
    await makeWritable(join(target, name));
  }
}

/**
 * The guard runs on the input string, not the resolved path, so `.` is refused
 * before any filesystem call touches the tree it names.
 */
export async function removeTree(input) {
  const stripped = stripTrailingSlashes(input);
  if (UNSAFE.has(stripped) || stripped.endsWith("/.") || stripped.endsWith("/..")) {
    throw new UnsafePathError(input);
  }

  const target = resolve(input);
  if (!existsSync(target)) return;

  await makeWritable(target).catch(() => {});
  await rm(target, { recursive: true, force: true }).catch(() => {});
  if (existsSync(target)) throw new TreeSurvivedError(target);
}
