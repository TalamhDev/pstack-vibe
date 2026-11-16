// tests/sync.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendChangelog,
  changelogEntry,
  isDirty,
  parseArgs,
} from "../scripts/sync.mjs";

test("parseArgs reads a commit and version", () => {
  const options = parseArgs(["--commit", "abc123", "--version", "0.16.0", "--no-generate"]);
  assert.equal(options.commit, "abc123");
  assert.equal(options.version, "0.16.0");
  assert.equal(options.generate, false);
  assert.equal(options.latest, false);
});

test("parseArgs supports --latest and keeps the default commit otherwise", () => {
  const options = parseArgs(["--latest"], { commit: "def456" });
  assert.equal(options.latest, true);
  assert.equal(options.commit, null);
  assert.equal(options.generate, true);
});

test("parseArgs rejects unknown arguments and missing values", () => {
  assert.throws(() => parseArgs(["--nope"]), /Unknown argument/);
  assert.throws(() => parseArgs(["--commit"]), /--commit needs a value/);
  assert.throws(() => parseArgs(["--version"]), /--version needs a value/);
  assert.throws(() => parseArgs(["--commit", "--latest"]), /--commit needs a value/);
});

test("isDirty detects a dirty tree but ignores the agent scratch directory", () => {
  assert.equal(isDirty(""), false);
  assert.equal(isDirty("   \n"), false);
  assert.equal(isDirty("?? .superpowers/\n"), false);
  assert.equal(isDirty(" M vendor/pstack/plugin.json\n"), true);
});

test("changelogEntry records the commit, version, and date", () => {
  const entry = changelogEntry({
    commit: "abc1234",
    version: "0.16.0",
    date: "2026-11-16",
  });
  assert.match(entry, /## \[Unreleased\]/);
  assert.match(entry, /abc1234/);
  assert.match(entry, /0\.16\.0/);
  assert.match(entry, /2026-11-16/);
});

test("appendChangelog separates the new entry from the existing file", () => {
  const entry = changelogEntry({
    commit: "abc1234",
    version: "0.16.0",
    date: "2026-11-16",
  });
  const combined = appendChangelog("# Changelog\n", entry);
  assert.match(combined, /# Changelog\n\n## \[Unreleased\]/);
  assert.match(combined, /abc1234/);
});
