import { execFile, execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { assessRequests } from "../scripts/mock-drive.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DRIVE = join(ROOT, "scripts/mock-drive.mjs");
const GENERATED = join(ROOT, "generated/vibe");
const REMOVE_TREE = join(ROOT, "scripts/remove-tree.sh");

const SENTINEL = "pstack-sentinel-0123456789abcdef";
const PROMPT = "Reply with the single word: ok";

const sheetInUserMessage = [
  {
    messages: [
      { role: "system", content: "pstack is installed." },
      { role: "user", content: `# pstack model configuration\nsecurity review: ${SENTINEL}\n\n${PROMPT}` },
    ],
  },
];
const noSentinel = [
  {
    messages: [
      { role: "system", content: "pstack is installed." },
      { role: "user", content: PROMPT },
    ],
  },
];
const sheetInSystemMessage = [
  {
    messages: [
      { role: "system", content: `security review: ${SENTINEL}` },
      { role: "user", content: PROMPT },
    ],
  },
];

test("a sentinel in a user message passes when the hook is expected", () => {
  const verdict = assessRequests({ id: "hook-on", expectSentinel: true, exitCode: 0 }, sheetInUserMessage, SENTINEL);
  assert.equal(verdict.ok, true);
  assert.match(verdict.detail, /sentinel in a role=user message/);
  assert.match(verdict.detail, /1 request, exit 0/);
});

test("a sentinel in a user message fails when the hook is disabled", () => {
  const verdict = assessRequests({ id: "hook-off", expectSentinel: false, exitCode: 0 }, sheetInUserMessage, SENTINEL);
  assert.equal(verdict.ok, false);
});

test("an absent sentinel passes when the hook is disabled", () => {
  const verdict = assessRequests({ id: "hook-off", expectSentinel: false, exitCode: 0 }, noSentinel, SENTINEL);
  assert.equal(verdict.ok, true);
  assert.match(verdict.detail, /sentinel absent/);
});

test("a sentinel only in a system message fails when the hook is expected", () => {
  const verdict = assessRequests({ id: "hook-on", expectSentinel: true, exitCode: 0 }, sheetInSystemMessage, SENTINEL);
  assert.equal(verdict.ok, false);
});

test("zero requests fails", () => {
  const verdict = assessRequests({ id: "hook-on", expectSentinel: true, exitCode: 1 }, [], SENTINEL);
  assert.equal(verdict.ok, false);
  assert.match(verdict.detail, /no request reached the mock provider/);
});

const VIBE_SKIP = hasVibe() ? false : "vibe is not on PATH";

test("the drive passes against the generated plugin", { skip: VIBE_SKIP }, async () => {
  const result = await runDrive([]);
  assert.equal(result.exitCode, 0, result.output);
  assert.match(lastLine(result.stdout), /^mock-drive: PASS/);
});

test("the drive fails when the installed plugin has no hook", { skip: VIBE_SKIP }, async () => {
  const work = mkdtempSync(join(tmpdir(), "pstack-mock-red-"));
  const plugin = join(work, "plugin");
  cpSync(GENERATED, plugin, { recursive: true });
  rmSync(join(plugin, "ai.mistral.vibe/hooks.toml"));

  let result;
  try {
    result = await runDrive(["--plugin", plugin]);
    assert.equal(result.exitCode, 1, result.output);
    assert.match(result.stdout, /^FAIL {2}hook-on:/m);
  } finally {
    for (const dir of keptDirs(result?.stdout ?? "")) {
      execFileSync("sh", [REMOVE_TREE, dir]);
    }
    execFileSync("sh", [REMOVE_TREE, work]);
  }
});

function hasVibe() {
  try {
    execFileSync("vibe", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runDrive(args) {
  return new Promise((resolvePromise) => {
    execFile(process.execPath, [DRIVE, ...args], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const exitCode = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolvePromise({ stdout, stderr, exitCode, output: `${stdout}${stderr}` });
    });
  });
}

function lastLine(stdout) {
  return stdout.trimEnd().split("\n").pop() ?? "";
}

function keptDirs(stdout) {
  const match = lastLine(stdout).match(/; kept (.+)$/);
  return match ? match[1].split(" ") : [];
}
