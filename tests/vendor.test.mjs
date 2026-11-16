// tests/vendor.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vendor = join(root, "vendor/pstack");

test("vendored pstack is at the pinned version", () => {
  const manifest = JSON.parse(readFileSync(join(vendor, "plugin.json"), "utf8"));
  assert.equal(manifest.name, "pstack");
  assert.equal(manifest.version, "0.15.42");
  assert.equal(manifest.license, "MIT");
});

test("vendored pstack keeps the upstream license", () => {
  const license = readFileSync(join(vendor, "LICENSE"), "utf8");
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Lauren Tan/);
});

test("vendored pstack has all 58 skills", () => {
  const skills = readdirSync(join(vendor, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(join(vendor, "skills", entry.name, "SKILL.md")));
  assert.equal(skills.length, 58);
});
