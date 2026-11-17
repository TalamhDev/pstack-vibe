import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  familyForProfile,
  parseConfigAliases,
  parseSheet,
  readConfigAliases,
  readSheet,
} from "../src/sheet.mjs";

const sheet = (lines) => parseSheet(lines.join("\n"));

test("familyForProfile strips the prefix and one level suffix", () => {
  assert.equal(familyForProfile("pstack-deepseek"), "deepseek");
  assert.equal(familyForProfile("pstack-deepseek-high"), "deepseek");
  assert.equal(familyForProfile("pstack-deepseek-max"), "deepseek");
  assert.equal(familyForProfile("pstack-deepseek-medium"), "deepseek");
  assert.equal(familyForProfile("pstack-deepseek-low"), "deepseek");
});

test("familyForProfile keeps a name that only looks like a level", () => {
  assert.equal(familyForProfile("pstack-high"), "high");
  assert.equal(familyForProfile("pstack-deepseek-high-high"), "deepseek-high");
  assert.equal(familyForProfile("pstack-glm-5-3"), "glm-5-3");
});

test("a family line records an alias", () => {
  const parsed = sheet(["# pstack model configuration", "# deepseek: deepseek-flash"]);
  assert.deepEqual([...parsed.aliases], [["deepseek", "deepseek-flash"]]);
  assert.deepEqual(parsed.families, ["deepseek"]);
  assert.deepEqual(parsed.profiles, []);
});

test("the closed metadata keys are not families", () => {
  const parsed = sheet([
    "# defaults: 2",
    "# budget: large (high)",
    "# parent: deepseek-flash",
    "# deepseek: deepseek-flash",
  ]);
  assert.deepEqual([...parsed.aliases.keys()], ["deepseek"]);
});

test("a prose note that starts with a key is not a family line", () => {
  const parsed = sheet(["# note: pstack-ghost is unused", "# deepseek: deepseek-flash"]);
  assert.deepEqual([...parsed.aliases.keys()], ["deepseek"]);
  assert.deepEqual(parsed.profiles, []);
});

test("a family line with a multi-word value is not a family line", () => {
  const parsed = sheet(["# deepseek: two words"]);
  assert.deepEqual([...parsed.aliases], []);
});

test("a duplicate family line keeps the first alias", () => {
  const parsed = sheet(["# deepseek: first", "# deepseek: second"]);
  assert.equal(parsed.aliases.get("deepseek"), "first");
});

test("role lines yield profile names and derived families", () => {
  const parsed = sheet([
    "# pstack model configuration",
    "# deepseek: deepseek-flash",
    "feature, refactoring: pstack-deepseek",
    "arena runners: pstack-deepseek, pstack-qwen",
  ]);
  assert.deepEqual(parsed.profiles, ["pstack-deepseek", "pstack-qwen"]);
  assert.deepEqual(parsed.families, ["deepseek", "qwen"]);
});

test("a profile token on a comment line is not a profile", () => {
  const parsed = sheet(["# note: pstack-ghost is unused", "feature: pstack-deepseek"]);
  assert.deepEqual(parsed.profiles, ["pstack-deepseek"]);
});

test("role lines with no comment lines leave every family without an alias", () => {
  const parsed = sheet(["feature, refactoring: pstack-deepseek"]);
  assert.deepEqual(parsed.families, ["deepseek"]);
  assert.equal(parsed.aliases.size, 0);
});

test("a levelled profile derives the base family", () => {
  const parsed = sheet(["# deepseek: deepseek-flash", "feature: pstack-deepseek-high"]);
  assert.deepEqual(parsed.profiles, ["pstack-deepseek-high"]);
  assert.deepEqual(parsed.families, ["deepseek"]);
});

test("blank lines and CRLF endings are tolerated", () => {
  const parsed = parseSheet("# deepseek: deepseek-flash\r\n\r\nfeature: pstack-deepseek\r\n");
  assert.equal(parsed.aliases.get("deepseek"), "deepseek-flash");
  assert.deepEqual(parsed.profiles, ["pstack-deepseek"]);
});

test("parseConfigAliases reads alias values and drops quotes and comments", () => {
  const aliases = parseConfigAliases(
    [
      "[[models]]",
      'name = "deepseek-v4-1-flash-1017"',
      'alias = "deepseek-flash"',
      "",
      "[[models]]",
      'alias = "qwen-3-max"  # the qwen line',
      "",
      "[[models]]",
      "alias = bare",
    ].join("\n"),
  );
  assert.deepEqual([...aliases], ["deepseek-flash", "qwen-3-max", "bare"]);
});

test("parseConfigAliases ignores a commented-out alias", () => {
  const aliases = parseConfigAliases('# alias = "ghost"\nalias = "real"');
  assert.deepEqual([...aliases], ["real"]);
});

test("readSheet returns null for an absent sheet", async () => {
  const work = mkdtempSync(join(tmpdir(), "pstack-sheet-"));
  try {
    assert.equal(await readSheet(join(work, "pstack-models.md")), null);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("readConfigAliases returns an empty set for an absent config", async () => {
  const work = mkdtempSync(join(tmpdir(), "pstack-sheet-"));
  try {
    assert.deepEqual([...(await readConfigAliases(join(work, "config.toml")))], []);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("readSheet parses a sheet from disk", async () => {
  const work = mkdtempSync(join(tmpdir(), "pstack-sheet-"));
  try {
    const path = join(work, "pstack-models.md");
    writeFileSync(path, "# deepseek: deepseek-flash\nfeature: pstack-deepseek\n");
    const parsed = await readSheet(path);
    assert.equal(parsed.aliases.get("deepseek"), "deepseek-flash");
    assert.deepEqual(parsed.profiles, ["pstack-deepseek"]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
