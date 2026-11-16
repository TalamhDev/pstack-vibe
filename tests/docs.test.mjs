// tests/docs.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("README covers install, setup, first task, exit, and troubleshooting", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  for (const heading of ["Install", "Setup", "First task", "Exit", "Troubleshooting", "Credits"]) {
    assert.match(readme, new RegExp(`## ${heading}`, "i"));
  }
});

test("SECURITY explains hooks and skills", () => {
  const text = readFileSync(join(root, "SECURITY.md"), "utf8");
  assert.match(text, /hook/i);
  assert.match(text, /shell/i);
  assert.match(text, /prompt text/i);
});

test("CHANGELOG has the release", () => {
  const text = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  assert.match(text, /0\.15\.42-vibe\.1/);
});
