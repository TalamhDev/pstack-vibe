// tests/no-cursor.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const skills = join(root, "generated/vibe/skills");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const forbidden = [
  { pattern: /subagent_type/ },
  { pattern: /claude-opus/ },
  { pattern: /claude-fable/ },
  { pattern: /gemini-4-carbon/ },
  { pattern: /\.cursor\// },
  { pattern: /\.mdc\b/ },
  { pattern: /`Task`/ },
  { pattern: /`Read`/ },
  { pattern: /`Grep`/ },
  { pattern: /`Glob`/ },
  { pattern: /`Shell`/ },
  {
    pattern: /\bcreate-skill\b/,
    allow: ["reflect/SKILL.md"],
  },
  { pattern: /(?<![\w./])\/babysit\b/ },
  { pattern: /(?<![\w./])\/verify(?![\w-])/ },
  { pattern: /(?<![\w./])\/automate(?![\w-])/ },
  { pattern: /reasoning level|fast or standard speed/ },
  { pattern: /cloud[ -]agent/i },
  { pattern: /cloud[ -]VM/i },
  { pattern: /lane VM/ },
  { pattern: /Assume the VM dies/ },
  { pattern: /Cursor's `\/loop`/ },
  { pattern: /agent-transcripts/ },
  {
    pattern: /api2\.cursor\.sh/,
    allow: ["make-bot-ui/SKILL.md"],
  },
  {
    pattern: /SendToUser/,
    allow: ["make-bot-ui/SKILL.md"],
  },
  {
    pattern: /cursor-team-kit/i,
    allow: [
      "poteto-mode/SKILL.md",
      "poteto-help/SKILL.md",
      "poteto-mode/playbooks/opening-a-pr.md",
    ],
  },
  { pattern: /explicit model per the Subagents section/i },
];

test("generated skills have no load-bearing Cursor references", () => {
  for (const path of walk(skills)) {
    const relativePath = relative(skills, path).split(sep).join("/");
    const text = readFileSync(path, "utf8");
    for (const { pattern, allow = [] } of forbidden) {
      if (allow.includes(relativePath)) continue;
      assert.doesNotMatch(text, pattern, `${path} matches ${pattern}`);
    }
  }
});

test("the adapter doc is generated", () => {
  const text = readFileSync(
    join(root, "generated/vibe/ai.mistral.vibe/knowledge/pstack-vibe/KNOWLEDGE.md"),
    "utf8",
  );
  assert.match(text, /<!-- pstack-vibe: upstream bf0c7cd, substitutions v1 -->/);
  assert.match(text, /agents\.spawn/);
  assert.match(text, /pstack:readonly/);
  assert.match(text, /Skipped in Vibe/);
});

test("the generated plugin README is Vibe-specific", () => {
  const text = readFileSync(join(root, "generated/vibe/README.md"), "utf8");
  for (const pattern of [
    /\/add-plugin/,
    /\/plugin marketplace/i,
    /claude code/i,
    /opus 5\.5/i,
    /fable 5\.2/i,
    /gemini 4 carbon/i,
    /xhigh/i,
    /auto/i,
  ]) {
    assert.doesNotMatch(text, pattern, `generated README matches ${pattern}`);
  }
  assert.match(text, /https:\/\/github\.com\/telamh\/pstack-vibe/);
});

test("make-bot-ui tells the model to stop", () => {
  const text = readFileSync(join(skills, "make-bot-ui/SKILL.md"), "utf8");
  assert.match(
    text,
    /Skipped in Vibe: Cursor Automations and SendToUser\. No Vibe equivalent\./,
  );
  assert.match(text, /Stop here/);
});
