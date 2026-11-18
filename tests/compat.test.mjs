import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TESTED_VIBE_VERSIONS,
  UnsupportedVibeError,
  VibeMissingError,
  assertSupported,
  createVibeProbe,
  isSupported,
  parseVibeVersion,
  rangeText,
  supportedBounds,
} from "../src/vibe.mjs";

const version = (text) => parseVibeVersion(text);

/** The fixture is a shell script, which Windows cannot execute; the compat job drives the real probe there. */
const SHELL_FIXTURE =
  process.platform === "win32" ? "a shell-script fixture is not executable on Windows" : false;

test("parseVibeVersion reads the triple out of a version line", () => {
  assert.deepEqual(version("vibe 3.1.2"), { major: 3, minor: 1, patch: 2, text: "vibe 3.1.2" });
  assert.deepEqual(version("3.1.2"), { major: 3, minor: 1, patch: 2, text: "3.1.2" });
  assert.deepEqual(version("vibe 3.1.2 (build 7)"), {
    major: 3,
    minor: 1,
    patch: 2,
    text: "vibe 3.1.2 (build 7)",
  });
});

test("parseVibeVersion rejects a line with no triple", () => {
  assert.equal(version("vibe"), null);
  assert.equal(version("3.1"), null);
  assert.equal(version(""), null);
  assert.equal(version(undefined), null);
});

test("the tested list is non-empty and spans one minor line", () => {
  assert.ok(TESTED_VIBE_VERSIONS.length > 0);
  const lines = new Set(TESTED_VIBE_VERSIONS.map((entry) => version(entry)).map((v) => `${v.major}.${v.minor}`));
  assert.equal(lines.size, 1, `vibe.tested spans ${[...lines].join(", ")}`);
});

test("supportedBounds derives the range from the tested list", () => {
  const bounds = supportedBounds(["3.1.2"]);
  assert.equal(rangeText(bounds), ">=3.1.2 <3.2.0");
  assert.equal(bounds.min.text, "3.1.2");
  assert.deepEqual(
    [bounds.maxExclusive.major, bounds.maxExclusive.minor, bounds.maxExclusive.patch],
    [3, 2, 0],
  );
});

test("supportedBounds takes the lowest and highest of a multi-entry list", () => {
  const bounds = supportedBounds(["3.1.5", "3.1.2", "3.1.9"]);
  assert.equal(rangeText(bounds), ">=3.1.2 <3.2.0");
});

test("supportedBounds refuses an empty, unparseable, or cross-minor list", () => {
  assert.throws(() => supportedBounds([]), /vibe\.tested is empty/);
  assert.throws(() => supportedBounds(["3.1"]), /unparseable version/);
  assert.throws(() => supportedBounds(["3.1.2", "3.2.0"]), /more than one minor line/);
});

test("isSupported is inclusive at the floor and exclusive at the ceiling", () => {
  const bounds = supportedBounds(["3.1.2"]);
  assert.equal(isSupported(version("3.1.2"), bounds), true);
  assert.equal(isSupported(version("3.1.9"), bounds), true);
  assert.equal(isSupported(version("3.1.1"), bounds), false);
  assert.equal(isSupported(version("3.2.0"), bounds), false);
  assert.equal(isSupported(version("2.9.9"), bounds), false);
  assert.equal(isSupported(version("4.0.0"), bounds), false);
});

test("an untested patch inside the minor line is supported", () => {
  const bounds = supportedBounds(["3.1.2"]);
  assert.equal(isSupported(version("3.1.3"), bounds), true);
});

test("the gate passes a version inside the range", () => {
  const passed = assertSupported({ kind: "ok", version: version("vibe 3.1.2") });
  assert.equal(passed.text, "vibe 3.1.2");
});

test("the gate refuses a version outside the range and names both sides", () => {
  assert.throws(
    () => assertSupported({ kind: "ok", version: version("vibe 3.9.9") }),
    (error) => {
      assert.ok(error instanceof UnsupportedVibeError);
      assert.match(error.message, /Vibe 3\.9\.9 is outside the tested range >=3\.1\.2 <3\.2\.0\./);
      assert.match(error.message, /detected: vibe 3\.9\.9/);
      assert.match(error.message, /tested: {3}3\.1\.2/);
      assert.equal(error.detected, "vibe 3.9.9");
      assert.equal(error.supported, ">=3.1.2 <3.2.0");
      return true;
    },
  );
});

test("the gate fails closed when vibe is absent, failing, or unparseable", () => {
  assert.throws(() => assertSupported({ kind: "absent" }), VibeMissingError);
  assert.throws(() => assertSupported({ kind: "failed" }), UnsupportedVibeError);
  assert.throws(
    () => assertSupported({ kind: "unparseable", text: "vibe nightly" }),
    /cannot parse a version from 'vibe nightly'/,
  );
});

test("the probe reports absent for a command that is not on PATH", async () => {
  const probe = createVibeProbe({ command: "pstack-no-such-vibe-binary" });
  assert.deepEqual(await probe(), { kind: "absent" });
});

test("the probe reports failed for a command that exits non-zero", async () => {
  const probe = createVibeProbe({ command: "false" });
  assert.deepEqual(await probe(), { kind: "failed" });
});

test("the probe reports unparseable for a command that prints no version", { skip: SHELL_FIXTURE }, async () => {
  const bin = mkdtempSync(join(tmpdir(), "pstack-probe-"));
  const command = join(bin, "vibe");
  writeFileSync(command, "#!/bin/sh\necho 'vibe nightly'\n");
  chmodSync(command, 0o755);
  try {
    assert.deepEqual(await createVibeProbe({ command })(), {
      kind: "unparseable",
      text: "vibe nightly",
    });
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});

test("the probe reports ok for a command that prints a version", { skip: SHELL_FIXTURE }, async () => {
  const bin = mkdtempSync(join(tmpdir(), "pstack-probe-"));
  const command = join(bin, "vibe");
  writeFileSync(command, "#!/bin/sh\necho 'vibe 3.1.2'\n");
  chmodSync(command, 0o755);
  try {
    const result = await createVibeProbe({ command })();
    assert.equal(result.kind, "ok");
    assert.equal(result.version.text, "vibe 3.1.2");
    assert.equal(result.version.minor, 1);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});
