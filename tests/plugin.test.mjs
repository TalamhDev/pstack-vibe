// tests/plugin.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";

const root = fileURLToPath(new URL("..", import.meta.url));
const plugin = join(root, "generated/vibe");

test("plugin.json has the required fields", () => {
  const manifest = JSON.parse(readFileSync(join(plugin, "plugin.json"), "utf8"));
  assert.equal(manifest.name, "pstack");
  assert.equal(manifest.version, "0.15.42-vibe.1");
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.author.name, "telamh");
  assert.equal(manifest.extensions["ai.mistral.vibe"].schemaVersion, 1);
});

test("hooks.toml wires the context, arm, record, and gate hooks", () => {
  const hooks = parse(readFileSync(join(plugin, "ai.mistral.vibe/hooks.toml"), "utf8"));
  assert.equal(hooks.hooks.length, 4);
  assert.deepEqual(
    hooks.hooks.map((hook) => hook.type),
    ["session_start", "pre_agent", "post_tool", "pre_tool"],
  );

  const gate = hooks.hooks.find((hook) => hook.type === "pre_tool");
  assert.equal(gate.match, "re:bash|process_start");
  assert.equal(gate.strict, undefined, "a strict gate would deny every shell command on a script error");

  const arm = hooks.hooks.find((hook) => hook.type === "pre_agent");
  assert.equal(arm.match, undefined, "the arming hook must see every turn");

  const recorder = hooks.hooks.find((hook) => hook.type === "post_tool");
  assert.equal(recorder.strict, undefined);

  for (const hook of hooks.hooks) {
    const named = hook.command.match(/\$PLUGIN_ROOT\/(\S+?)"/);
    assert.ok(named, `hook command names no plugin script: ${hook.command}`);
    assert.ok(existsSync(join(plugin, named[1])), `missing script: ${named[1]}`);
  }
});

test("agent TOMLs are subagent profiles", () => {
  for (const name of ["poteto-agent", "comment-sicko", "readonly"]) {
    const agent = parse(readFileSync(join(plugin, `ai.mistral.vibe/agents/${name}.toml`), "utf8"));
    assert.equal(agent.agent_type, "subagent");
    assert.ok(agent.description.length > 0);
    assert.ok(agent.instructions.length > 0);
  }
});

test("every generated agent description fits Vibe's 1-300 character limit", () => {
  for (const name of ["poteto-agent", "comment-sicko", "readonly"]) {
    const agent = parse(readFileSync(join(plugin, `ai.mistral.vibe/agents/${name}.toml`), "utf8"));
    assert.ok(
      agent.description.length >= 1 && agent.description.length <= 300,
      `${name} description is ${agent.description.length} characters`,
    );
  }
});

test("the readonly profile's bash allowlist excludes write-capable commands", () => {
  const agent = parse(readFileSync(join(plugin, "ai.mistral.vibe/agents/readonly.toml"), "utf8"));
  const allowlist = agent.tools.bash.allowlist;
  assert.ok(!allowlist.includes("git"), "git can write to the repository");
  assert.ok(!allowlist.includes("sed"), "sed can write in place");
  for (const command of ["rg", "grep", "find", "ls", "cat", "head", "tail", "wc"]) {
    assert.ok(allowlist.includes(command), `missing ${command}`);
  }
});

function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "missing frontmatter");
  const meta = {};
  for (const line of match[1].split("\n")) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    meta[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return meta;
}

test("knowledge entries have folder frontmatter and a header after it", () => {
  for (const folder of ["pstack-models", "pstack-vibe"]) {
    const text = readFileSync(
      join(plugin, `ai.mistral.vibe/knowledge/${folder}/KNOWLEDGE.md`),
      "utf8",
    );
    const meta = frontmatter(text);
    assert.equal(meta.name, folder);
    assert.ok(
      meta.description.length >= 5 && meta.description.length <= 300,
      `${folder} description is ${meta.description.length} characters`,
    );
    const frontmatterEnd = text.indexOf("\n---\n", 3);
    const header = text.indexOf("<!-- pstack-vibe:");
    assert.ok(header > frontmatterEnd, `${folder} header is not after the frontmatter`);
  }
});

test("knowledge entries exist", () => {
  assert.ok(readFileSync(join(plugin, "ai.mistral.vibe/knowledge/pstack-vibe/KNOWLEDGE.md"), "utf8").length > 0);
  assert.ok(readFileSync(join(plugin, "ai.mistral.vibe/knowledge/pstack-models/KNOWLEDGE.md"), "utf8").length > 0);
});
