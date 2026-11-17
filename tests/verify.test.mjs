import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { removeTree } from "../src/tree.mjs";
import { verify } from "../src/verify.mjs";
import { UnsupportedVibeError, parseVibeVersion } from "../src/vibe.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED = join(ROOT, "generated/vibe");

const probeOf = (text) => async () => ({ kind: "ok", version: parseVibeVersion(text) });
const supported = probeOf("vibe 3.1.2");
const unsupported = probeOf("vibe 3.9.9");

const passingDrive = async () => ({
  ok: true,
  cases: [{ id: "hook-on", ok: true, detail: "sentinel in a role=user message (1 request, exit 0)" }],
});

const failingDrive = async () => ({
  ok: false,
  cases: [{ id: "hook-on", ok: false, detail: "no request reached the mock provider (0 requests)" }],
});

function verifyHomes() {
  return new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("pstack-verify-")));
}

function request(overrides = {}) {
  return {
    env: { HOME: mkdtempSync(join(tmpdir(), "pstack-home-")) },
    cwd: ROOT,
    plugin: GENERATED,
    vibe: supported,
    drive: passingDrive,
    ...overrides,
  };
}

test("a passing doctor and drive report ok and remove the throwaway home", async () => {
  const before = verifyHomes();
  const report = await verify(request());

  assert.equal(report.ok, true);
  assert.equal(report.home, null);
  assert.equal(report.vibeVersion, "vibe 3.1.2");
  assert.equal(report.supported, ">=3.1.2 <3.2.0");
  assert.equal(report.doctor.ok, true);
  assert.equal(report.doctor.checks.length, 10);
  assert.equal(report.drive.ok, true);

  const leaked = [...verifyHomes()].filter((name) => !before.has(name));
  assert.deepEqual(leaked, [], `verify left ${leaked.join(" ")} behind`);
});

test("a failing drive keeps the home and names it", async () => {
  const report = await verify(request({ drive: failingDrive }));
  try {
    assert.equal(report.ok, false);
    assert.equal(report.drive.ok, false);
    assert.equal(report.drive.cases[0].id, "hook-on");
    assert.ok(report.home, "a failed verify must keep its home");
    assert.equal(existsSync(report.home), true);
    assert.equal(existsSync(join(report.home, "plugins/pstack/plugin.json")), true);
  } finally {
    await removeTree(report.home);
  }
});

test("a failing doctor check keeps the home", async () => {
  const work = mkdtempSync(join(tmpdir(), "pstack-plugin-"));
  const plugin = join(work, "plugin");
  cpSync(GENERATED, plugin, { recursive: true });
  rmSync(join(plugin, "ai.mistral.vibe/hooks.toml"));

  const report = await verify(request({ plugin }));
  try {
    assert.equal(report.ok, false);
    assert.equal(report.doctor.ok, false);
    assert.equal(report.drive.ok, true);
    const hook = report.doctor.checks.find((check) => check.id === "hook");
    assert.equal(hook.ok, false);
    assert.match(hook.detail, /is missing$/);
    assert.ok(report.home);
    assert.equal(existsSync(report.home), true);
  } finally {
    await removeTree(report.home);
    await removeTree(work);
  }
});

test("the gate refuses before the drive runs and leaves no home behind", async () => {
  const before = verifyHomes();
  let driven = false;

  await assert.rejects(
    verify(
      request({
        vibe: unsupported,
        drive: async () => {
          driven = true;
          return passingDrive();
        },
      }),
    ),
    UnsupportedVibeError,
  );

  assert.equal(driven, false, "the drive ran against an unsupported Vibe");
  const leaked = [...verifyHomes()].filter((name) => !before.has(name));
  assert.deepEqual(leaked, [], `a refused verify left ${leaked.join(" ")} behind`);
});

test("the drive receives the plugin tree it was asked to verify", async () => {
  let received = null;
  const report = await verify(
    request({
      drive: async ({ plugin }) => {
        received = plugin;
        return passingDrive();
      },
    }),
  );
  assert.equal(received, GENERATED);
  assert.equal(report.ok, true);
});

test("the report carries only the drive's id, ok, and detail", async () => {
  const report = await verify(
    request({
      drive: async () => ({
        ok: true,
        sentinel: "pstack-sentinel-deadbeef",
        kept: ["/tmp/should-not-leak"],
        elapsedMs: 1234,
        cases: [{ id: "hook-on", ok: true, detail: "sentinel in a role=user message (1 request, exit 0)" }],
      }),
    }),
  );

  assert.deepEqual(Object.keys(report.drive).sort(), ["cases", "ok"]);
  assert.deepEqual(Object.keys(report.drive.cases[0]).sort(), ["detail", "id", "ok"]);
});
