import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_JSON = resolve(dirname(fileURLToPath(import.meta.url)), "../package.json");

export class VibeMissingError extends Error {
  constructor(message) {
    super(message);
    this.name = "VibeMissingError";
    this.exitCode = 1;
  }
}

export class UnsupportedVibeError extends Error {
  constructor(message, { detected, supported }) {
    super(message);
    this.name = "UnsupportedVibeError";
    this.exitCode = 1;
    this.detected = detected;
    this.supported = supported;
  }
}

/**
 * The tested list, read from package.json `vibe.tested`. One source of truth:
 * the range below is derived from it, and the CI compat matrix is a `fromJSON`
 * of it, so a version cannot be claimed as tested without a `verify` run.
 */
export const TESTED_VIBE_VERSIONS = Object.freeze(readTestedVersions());

function readTestedVersions() {
  const manifest = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
  const tested = manifest?.vibe?.tested;
  if (!Array.isArray(tested) || tested.length === 0) {
    throw new Error("package.json vibe.tested is missing or empty");
  }
  return tested;
}

const VERSION_PATTERN = /(\d+)\.(\d+)\.(\d+)/;

/**
 * @typedef {object} VibeVersion
 * @property {number} major
 * @property {number} minor
 * @property {number} patch
 * @property {string} text
 *
 * @typedef {{ kind: "absent" }
 *   | { kind: "failed" }
 *   | { kind: "unparseable", text: string }
 *   | { kind: "ok", version: VibeVersion }} VibeProbeResult
 * @typedef {() => Promise<VibeProbeResult>} VibeProbe
 * @typedef {{ min: VibeVersion, maxExclusive: VibeVersion }} SupportedBounds
 */

/** @returns {VibeVersion | null} */
export function parseVibeVersion(text) {
  if (typeof text !== "string") return null;
  const match = VERSION_PATTERN.exec(text);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    text: text.trim(),
  };
}

function compare(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/**
 * The range is computed from the list, never stored, so there is no range
 * string that can drift from the versions that actually passed.
 *
 * @param {readonly string[]} versions
 * @returns {SupportedBounds}
 */
export function supportedBounds(versions) {
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error("vibe.tested is empty");
  }
  const parsed = versions.map((entry) => parseVibeVersion(entry));
  if (parsed.some((entry) => entry === null)) {
    throw new Error("vibe.tested holds an unparseable version");
  }
  const lines = new Set(parsed.map((entry) => `${entry.major}.${entry.minor}`));
  if (lines.size !== 1) {
    throw new Error("vibe.tested spans more than one minor line");
  }
  const min = parsed.reduce((low, entry) => (compare(entry, low) < 0 ? entry : low));
  const max = parsed.reduce((high, entry) => (compare(entry, high) > 0 ? entry : high));
  return { min, maxExclusive: { major: max.major, minor: max.minor + 1, patch: 0, text: "" } };
}

/** @returns {string} */
export function rangeText(bounds) {
  const { min, maxExclusive } = bounds;
  return `>=${min.major}.${min.minor}.${min.patch} <${maxExclusive.major}.${maxExclusive.minor}.${maxExclusive.patch}`;
}

/** @returns {boolean} */
export function isSupported(version, bounds) {
  return compare(version, bounds.min) >= 0 && compare(version, bounds.maxExclusive) < 0;
}

/** @returns {VibeProbe} */
export function createVibeProbe({ command = "vibe" } = {}) {
  return async () => {
    const result = await new Promise((resolvePromise) => {
      execFile(command, ["--version"], { maxBuffer: 1024 * 1024 }, (error, stdout) => {
        if (!error) {
          resolvePromise({ exitCode: 0, stdout: stdout ?? "" });
          return;
        }
        if (error.code === "ENOENT") {
          resolvePromise({ spawnError: "ENOENT" });
          return;
        }
        resolvePromise({
          exitCode: typeof error.code === "number" ? error.code : 1,
          stdout: stdout ?? "",
        });
      });
    });

    if (result.spawnError) return { kind: "absent" };
    if (result.exitCode !== 0) return { kind: "failed" };
    const first = (result.stdout ?? "").split("\n")[0].trimEnd();
    const version = parseVibeVersion(first);
    return version ? { kind: "ok", version } : { kind: "unparseable", text: first };
  };
}

function outOfRangeMessage(version, bounds) {
  const detected = `${version.major}.${version.minor}.${version.patch}`;
  return [
    `Vibe ${detected} is outside the tested range ${rangeText(bounds)}.`,
    `  tested:   ${TESTED_VIBE_VERSIONS.join(", ")}`,
    `  detected: ${version.text}`,
    `Install a tested Vibe, or open an issue to add ${detected} to the tested list.`,
  ].join("\n");
}

/**
 * The gate. Fails closed on every probe outcome except a version inside the
 * derived range, so a caller that forgets to check compatibility still gets
 * checked.
 *
 * @param {VibeProbeResult} probe
 * @returns {VibeVersion}
 */
export function assertSupported(probe) {
  const bounds = supportedBounds(TESTED_VIBE_VERSIONS);
  const range = rangeText(bounds);

  switch (probe.kind) {
    case "absent":
      throw new VibeMissingError(
        "vibe is not on PATH; install it with `uv tool install mistral-vibe==3.1.2`",
      );
    case "failed":
      throw new UnsupportedVibeError(
        `'vibe --version' failed; cannot prove it is within the tested range ${range}`,
        { detected: "unknown", supported: range },
      );
    case "unparseable":
      throw new UnsupportedVibeError(
        `cannot parse a version from '${probe.text}'; the tested range is ${range}`,
        { detected: probe.text, supported: range },
      );
    default:
      if (isSupported(probe.version, bounds)) return probe.version;
      throw new UnsupportedVibeError(outOfRangeMessage(probe.version, bounds), {
        detected: probe.version.text,
        supported: range,
      });
  }
}
