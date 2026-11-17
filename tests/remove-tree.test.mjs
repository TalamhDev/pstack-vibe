import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TreeSurvivedError, UnsafePathError, removeTree } from "../src/tree.mjs";

const SNAPSHOT = "logs/session/plugins/packages/59/594b4f3ff6cc67052de979b1986085e3bbf63280bc959c4c20b64de87e0f5eb0";

function scratch() {
  return mkdtempSync(join(tmpdir(), "pstack-tree-"));
}

/** The 0500/0400 shape a driven session leaves behind. */
function plantSnapshot(home) {
  const pkg = join(home, SNAPSHOT);
  mkdirSync(join(pkg, "skills/vibe"), { recursive: true });
  writeFileSync(join(pkg, "plugin.json"), '{"name":"pstack"}\n');
  writeFileSync(join(pkg, "skills/vibe/SKILL.md"), "---\nname: vibe\n---\n");
  chmodSync(join(pkg, "plugin.json"), 0o400);
  chmodSync(join(pkg, "skills/vibe/SKILL.md"), 0o400);
  chmodSync(join(pkg, "skills/vibe"), 0o500);
  chmodSync(join(pkg, "skills"), 0o500);
  chmodSync(pkg, 0o500);
}

async function cleanup(path) {
  await removeTree(path);
}

test("a plain recursive removal leaves the read-only snapshot behind", async () => {
  const work = scratch();
  try {
    const home = join(work, "control/home");
    plantSnapshot(home);
    await rm(home, { recursive: true, force: true }).catch(() => {});
    assert.equal(existsSync(home), true, "the fixture is wrong: a plain rm removed the snapshot");
  } finally {
    await cleanup(work);
  }
});

test("removes a read-only snapshot and leaves artifacts outside it", async () => {
  const work = scratch();
  try {
    const home = join(work, "run/home");
    const artifacts = join(work, "run/artifacts/drive-0");
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(join(artifacts, "stdout.txt"), "ok\n");
    writeFileSync(join(artifacts, "exit_code.txt"), "0\n");
    plantSnapshot(home);

    await removeTree(home);

    assert.equal(existsSync(home), false);
    assert.equal(existsSync(join(artifacts, "stdout.txt")), true);
    assert.equal(existsSync(join(artifacts, "exit_code.txt")), true);
  } finally {
    await cleanup(work);
  }
});

test("reports failure and names the path when the tree survives", async () => {
  const work = scratch();
  try {
    const parent = join(work, "stuck");
    const home = join(parent, "home");
    plantSnapshot(home);
    chmodSync(parent, 0o500);

    await assert.rejects(removeTree(home), (error) => {
      assert.ok(error instanceof TreeSurvivedError);
      assert.match(error.message, /survived removal/);
      assert.ok(error.message.includes(home), `the failure did not name ${home}: ${error.message}`);
      return true;
    });
    assert.equal(existsSync(home), true);
  } finally {
    chmodSync(join(work, "stuck"), 0o700);
    await cleanup(work);
  }
});

test("an absent tree is a no-op success", async () => {
  const work = scratch();
  try {
    await removeTree(join(work, "never-existed"));
  } finally {
    await cleanup(work);
  }
});

test("refuses an unsafe path", async () => {
  for (const bad of ["", "/", ".", "..", "./", "../"]) {
    await assert.rejects(removeTree(bad), UnsafePathError, `accepted the unsafe path '${bad}'`);
  }
});

test("refusing an unsafe path does not touch the tree", async () => {
  const work = scratch();
  try {
    const guard = join(work, "guard");
    mkdirSync(join(guard, "victim"), { recursive: true });
    writeFileSync(join(guard, "victim/file"), "x\n");
    chmodSync(join(guard, "victim/file"), 0o400);
    chmodSync(join(guard, "victim"), 0o500);

    const previous = process.cwd();
    process.chdir(guard);
    try {
      await assert.rejects(removeTree("."), UnsafePathError);
    } finally {
      process.chdir(previous);
    }

    assert.equal(statSync(join(guard, "victim/file")).mode & 0o200, 0, "refusing '.' still chmodded the tree");
    assert.equal(existsSync(join(guard, "victim/file")), true);
  } finally {
    chmodSync(join(work, "guard/victim"), 0o700);
    await cleanup(work);
  }
});
