// tests/forks.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const forks = JSON.parse(readFileSync(join(root, "adapters/forks.json"), "utf8"));

test("every fork exists and is copied", () => {
  for (const fork of forks.forks) {
    const generated = readFileSync(join(root, "generated/vibe", fork.path), "utf8");
    const source = readFileSync(join(root, fork.source), "utf8");
    assert.equal(generated, source, `${fork.path} is not the fork source`);
  }
});

test("poteto-mode uses Vibe subagent fields", () => {
  const text = readFileSync(join(root, "generated/vibe/skills/poteto-mode/SKILL.md"), "utf8");
  assert.match(text, /agents\.spawn/);
  assert.match(text, /config_name/);
  assert.doesNotMatch(text, /subagent_type/);
  assert.doesNotMatch(text, /claude-opus/);
  assert.doesNotMatch(text, /AskQuestion/);
});

test("setup-pstack writes the Vibe sheet", () => {
  const text = readFileSync(join(root, "generated/vibe/skills/setup-pstack/SKILL.md"), "utf8");
  assert.match(text, /~\/\.vibe\/pstack-models\.md/);
  assert.match(text, /ask_user_question/);
  assert.match(text, /pstack-deepseek/);
  assert.match(text, /pstack-glm/);
  assert.match(text, /pstack-ml4/);
});

test("architect uses the Vibe model sheet path", () => {
  const text = readFileSync(join(root, "generated/vibe/skills/architect/SKILL.md"), "utf8");
  assert.doesNotMatch(text, /\.mdc/);
  assert.match(text, /pstack-models\.md/);
});

test("arena uses three families and a cross-judge pool", () => {
  const text = readFileSync(join(root, "generated/vibe/skills/arena/SKILL.md"), "utf8");
  assert.match(text, /pstack-deepseek/);
  assert.match(text, /pstack-glm/);
  assert.match(text, /pstack-ml4/);
  assert.match(text, /arena cross-judge pool/);
});

test("interrogate is adversarial on GLM and DeepSeek", () => {
  const text = readFileSync(join(root, "generated/vibe/skills/interrogate/SKILL.md"), "utf8");
  assert.match(text, /interrogate reviewers: pstack-glm, pstack-deepseek/);
  assert.match(text, /security review/);
  assert.match(text, /pstack-ml4/);
});

test("swarm and reflect use Vibe spawn fields", () => {
  for (const name of ["swarm", "reflect"]) {
    const text = readFileSync(join(root, `generated/vibe/skills/${name}/SKILL.md`), "utf8");
    assert.match(text, /agents\.spawn|config_name/);
    assert.doesNotMatch(text, /subagent_type/);
    assert.doesNotMatch(text, /run_in_background/);
  }
});

test("reflect reads the model sheet from both scopes", () => {
  const text = readFileSync(join(root, "generated/vibe/skills/reflect/SKILL.md"), "utf8");
  assert.match(text, /~\/\.vibe\/pstack-models\.md/);
  assert.match(text, /or `\.vibe\/pstack-models\.md` for a project install/);
});

test("feature.md is a fork carrying the chain gate contract", () => {
  const fork = forks.forks.find((entry) => entry.path === "skills/poteto-mode/playbooks/feature.md");
  assert.ok(fork, "feature.md is not a fork");
  assert.equal(fork.reason, "the chain audit's gate contract");

  const text = readFileSync(join(root, "generated/vibe/skills/poteto-mode/playbooks/feature.md"), "utf8");
  assert.match(text, /The chain audit blocks `gh pr create` until every `feature` and `opening-a-pr` row/);
  assert.doesNotMatch(text, /waive/);
});

test("the playbooks name the chain gate where the run reads it", () => {
  const skill = readFileSync(join(root, "generated/vibe/skills/poteto-mode/SKILL.md"), "utf8");
  assert.match(skill, /The list is the plan; the chain audit is the proof\./);
  assert.match(skill, /Read each skill's `SKILL\.md` by path, because the `skill` tool cannot load them\./);
  assert.match(skill, /A step you choose not to do is a conversation with the user, not a line in the reply\./);
  assert.doesNotMatch(skill, /stays in the list with a one-line `skip: <reason>`/);
  assert.doesNotMatch(skill, /waive/);

  const pr = readFileSync(join(root, "generated/vibe/skills/poteto-mode/playbooks/opening-a-pr.md"), "utf8");
  assert.match(pr, /pass `--body-file \.vibe\/pr-body\.md`/);

  const architect = readFileSync(join(root, "generated/vibe/skills/architect/SKILL.md"), "utf8");
  assert.match(architect, /Name each runner `architect-<n>`/);
});
