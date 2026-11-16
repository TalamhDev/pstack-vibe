// tests/roles.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";

const root = fileURLToPath(new URL("..", import.meta.url));
const roles = parse(readFileSync(join(root, "model-sheet/roles.toml"), "utf8"));

const required = [
  "feature, refactoring", "bug-fix", "perf-issue", "hillclimb",
  "judgment and prose", "hardest tasks", "reflect tooling",
  "reflect judgment, divergent, synthesizer", "swarm workers",
  "arena runners", "arena cross-judge pool", "architect runners",
  "interrogate reviewers", "security review", "formal verification",
];

test("roles.toml has every role", () => {
  for (const role of required) assert.ok(roles.roles[role], `missing ${role}`);
});

test("the default model policy is DeepSeek first", () => {
  assert.deepEqual(roles.roles["feature, refactoring"], ["pstack-deepseek"]);
  assert.deepEqual(roles.roles["hardest tasks"], ["pstack-deepseek"]);
  assert.deepEqual(roles.roles["arena runners"], ["pstack-deepseek", "pstack-glm", "pstack-ml4"]);
  assert.deepEqual(roles.roles["interrogate reviewers"], ["pstack-glm", "pstack-deepseek"]);
  assert.deepEqual(roles.roles["security review"], ["pstack-ml4"]);
});

test("the generated knowledge matches the sheet", () => {
  const knowledge = readFileSync(
    join(root, "generated/vibe/ai.mistral.vibe/knowledge/pstack-models/KNOWLEDGE.md"),
    "utf8",
  );
  assert.match(knowledge, /feature, refactoring: pstack-deepseek/);
  assert.match(knowledge, /arena runners: pstack-deepseek, pstack-glm, pstack-ml4/);
  assert.match(knowledge, /# budget: large \(high\)/);
});
