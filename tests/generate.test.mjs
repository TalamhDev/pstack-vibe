// tests/generate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applySubstitutions, generatePlugin } from "../scripts/generate.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

const rules = [
  { id: "literal", kind: "literal", find: "`Task`", replace: "`agents.spawn`" },
  { id: "regex", kind: "regex", find: "claude-opus-5-5-[a-z-]+", replace: "pstack-deepseek" },
];

/** Windows has no POSIX mode bits; chmod there only toggles the read-only attribute. */
function assertMode(path, expected, label) {
  if (process.platform === "win32") return;
  assert.equal(statSync(path).mode & 0o777, expected, label);
}

async function generateRealPlugin() {
  const out = mkdtempSync(join(tmpdir(), "pstack-real-"));
  await generatePlugin({
    vendorDir: join(root, "vendor/pstack"),
    adaptersDir: join(root, "adapters"),
    outDir: out,
  });
  return out;
}

test("literal and regex substitutions apply", () => {
  const input = "Spawn `Task` with claude-opus-5-5-xhigh.";
  assert.equal(
    applySubstitutions(input, rules, "skills/example/SKILL.md"),
    "Spawn `agents.spawn` with pstack-deepseek.",
  );
});

test("a rule with an include glob only applies to matching files", () => {
  const scoped = [{ ...rules[0], include: ["skills/alpha/**"] }];
  assert.equal(applySubstitutions("`Task`", scoped, "skills/beta/SKILL.md"), "`Task`");
  assert.equal(applySubstitutions("`Task`", scoped, "skills/alpha/SKILL.md"), "`agents.spawn`");
});

test("generatePlugin copies skills, applies rules, and adds the header", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pstack-gen-"));
  const vendor = join(dir, "vendor");
  const adapters = join(dir, "adapters");
  const out = join(dir, "out");
  mkdirSync(join(vendor, "skills/alpha"), { recursive: true });
  writeFileSync(join(vendor, "skills/alpha/SKILL.md"), "---\nname: alpha\ndescription: x\n---\n\nSpawn `Task`.\n");
  writeFileSync(join(vendor, "plugin.json"), JSON.stringify({ name: "pstack", version: "0.15.42" }));
  writeFileSync(join(vendor, "LICENSE"), "MIT License\n");
  mkdirSync(adapters, { recursive: true });
  writeFileSync(join(adapters, "substitutions.json"), JSON.stringify({
    version: 1,
    upstream: { commit: "bf0c7cd", version: "0.15.42" },
    rules: [{ id: "task", kind: "literal", find: "`Task`", replace: "`agents.spawn`" }],
    forks: [],
  }));

  await generatePlugin({ vendorDir: vendor, adaptersDir: adapters, outDir: out });

  const generated = readFileSync(join(out, "skills/alpha/SKILL.md"), "utf8");
  assert.match(generated, /`agents\.spawn`/);
  assert.match(generated, /<!-- pstack-vibe: upstream bf0c7cd, substitutions v1 -->/);
  assert.ok(existsSync(join(out, "plugin.json")));

  const manifest = JSON.parse(readFileSync(join(out, "plugin.json"), "utf8"));
  assert.equal(manifest.version, "0.15.42-vibe.1");
  assert.equal(manifest.author.name, "telamh");
  assert.equal(manifest.homepage, "https://github.com/telamh/pstack-vibe");
  assert.equal(manifest.repository, "https://github.com/telamh/pstack-vibe");
  assert.match(manifest.description, /Lauren Tan/);
  assert.ok(existsSync(join(out, "NOTICE.md")));
  assert.match(
    readFileSync(join(out, "NOTICE.md"), "utf8"),
    /not endorsed by Lauren Tan, Mistral, or Cursor/,
  );
});

test("generatePlugin writes skills.manifest from the skill directories", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pstack-manifest-"));
  const vendor = join(dir, "vendor");
  const adapters = join(dir, "adapters");
  const out = join(dir, "out");
  for (const name of ["beta", "alpha"]) {
    mkdirSync(join(vendor, "skills", name), { recursive: true });
    writeFileSync(join(vendor, "skills", name, "SKILL.md"), `---\nname: ${name}\n---\n\nBody.\n`);
  }
  mkdirSync(join(vendor, "skills", "not-a-skill"), { recursive: true });
  writeFileSync(join(vendor, "plugin.json"), JSON.stringify({ name: "pstack", version: "0.15.42" }));
  writeFileSync(join(vendor, "LICENSE"), "MIT License\n");
  mkdirSync(adapters, { recursive: true });
  writeFileSync(join(adapters, "substitutions.json"), JSON.stringify({
    version: 1,
    upstream: { commit: "bf0c7cd", version: "0.15.42" },
    rules: [],
    forks: [],
  }));

  await generatePlugin({ vendorDir: vendor, adaptersDir: adapters, outDir: out });

  assert.equal(readFileSync(join(out, "skills.manifest"), "utf8"), "alpha\nbeta\n");
});

test("generatePlugin --check reports a stale tree", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pstack-check-"));
  const vendor = join(dir, "vendor");
  const adapters = join(dir, "adapters");
  const out = join(dir, "out");
  mkdirSync(join(vendor, "skills/alpha"), { recursive: true });
  writeFileSync(join(vendor, "skills/alpha/SKILL.md"), "---\nname: alpha\ndescription: x\n---\n\nSpawn `Task`.\n");
  writeFileSync(join(vendor, "plugin.json"), JSON.stringify({ name: "pstack", version: "0.15.42" }));
  writeFileSync(join(vendor, "LICENSE"), "MIT License\n");
  mkdirSync(adapters, { recursive: true });
  writeFileSync(join(adapters, "substitutions.json"), JSON.stringify({
    version: 1,
    upstream: { commit: "bf0c7cd", version: "0.15.42" },
    rules: [{ id: "task", kind: "literal", find: "`Task`", replace: "`agents.spawn`" }],
    forks: [],
  }));

  await generatePlugin({ vendorDir: vendor, adaptersDir: adapters, outDir: out });
  writeFileSync(join(out, "skills/alpha/SKILL.md"), "stale");
  const result = await generatePlugin({ vendorDir: vendor, adaptersDir: adapters, outDir: out, check: true });
  assert.deepEqual(result.changed, ["skills/alpha/SKILL.md"]);
});

test("combined readonly rules keep one config_name per spawn", async () => {
  const out = await generateRealPlugin();

  const how = readFileSync(join(out, "skills/how/SKILL.md"), "utf8");
  const howSpawn = how.split("\n").find((line) => line.includes("Spawn one"));
  assert.ok(howSpawn);
  assert.equal((howSpawn.match(/config_name: "pstack:readonly"/g) ?? []).length, 1);
  assert.doesNotMatch(howSpawn, /pstack:poteto-agent/);
  assert.doesNotMatch(how, /readonly: true/);

  const reflect = readFileSync(join(out, "skills/reflect/SKILL.md"), "utf8");
  assert.match(reflect, /config_name: "pstack:poteto-agent"/);
  assert.match(reflect, /pstack-deepseek/);
  assert.doesNotMatch(reflect, /readonly:/);
});

test("poteto-help links point at the repo and README documents the optional runtime", async () => {
  const out = await generateRealPlugin();
  const skillPath = join(out, "skills/poteto-help/SKILL.md");
  const skill = readFileSync(skillPath, "utf8");
  assert.doesNotMatch(skill, /\.\.\/\.\.\/docs\/harness\/claude-code\.md/);
  assert.match(
    skill,
    /https:\/\/github\.com\/telamh\/pstack-vibe\/blob\/main\/docs\/harness\/vibe\.md/,
  );

  const links = [...skill.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
  assert.ok(
    !links.some((link) => link.startsWith("../../")),
    "relative up-links remain in the installed skill",
  );
  const guideLinks = links.filter((link) => link.includes("/docs/guide/"));
  assert.ok(guideLinks.length > 0, "guide links are missing");
  for (const link of guideLinks) {
    assert.match(
      link,
      /^https:\/\/github\.com\/telamh\/pstack-vibe\/blob\/main\/docs\/guide\//,
      `guide link is not a repo URL: ${link}`,
    );
  }

  const readme = readFileSync(join(out, "README.md"), "utf8");
  assert.match(readme, /## Runtime/);
  assert.match(readme, /requires bun/);
  assert.match(readme, /npm install/);
  assert.ok(existsSync(join(out, "skills/poteto-mode/scripts/watch-pr/watch-pr")));
});

test("the shipped README's runtime claim matches the hooks and the engines floor", async () => {
  const out = await generateRealPlugin();

  const hooks = readFileSync(join(out, "ai.mistral.vibe/hooks.toml"), "utf8");
  const interpreters = [...hooks.matchAll(/^command = "(\S+)/gm)].map((match) => match[1]);
  assert.deepEqual([...new Set(interpreters)], ["node"], "a hook does not run node");

  const engines = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).engines.node;
  const floor = engines.match(/\d+/)[0];

  const readme = readFileSync(join(out, "README.md"), "utf8");
  const runtime = readme.slice(readme.indexOf("## Runtime"));
  assert.match(runtime, new RegExp(`Node ${floor}`), `the Runtime section does not name Node ${floor}`);
  assert.doesNotMatch(readme, /no runtime dependency/, "the README still claims no runtime dependency");
  assert.doesNotMatch(readme, /macOS and Linux only/, "the README still claims macOS and Linux only");
});

test("the chain manifest and every vibe script are generated with their modes", async () => {
  const out = await generateRealPlugin();

  const manifest = join(out, "ai.mistral.vibe/chain.tsv");
  assert.ok(existsSync(manifest), "chain.tsv is not generated");
  assertMode(manifest, 0o644, "chain.tsv is not 0644");
  assert.equal(
    readFileSync(manifest, "utf8"),
    readFileSync(join(root, "adapters/vibe/chain.tsv"), "utf8"),
  );

  const sourceDir = join(root, "adapters/vibe/scripts");
  const names = readdirSync(sourceDir).filter((name) => name.endsWith(".mjs"));
  assert.ok(names.length >= 2, `expected the vibe scripts, found ${names.join(", ")}`);
  for (const name of names) {
    const target = join(out, "ai.mistral.vibe/scripts", name);
    assert.ok(existsSync(target), `${name} is not generated`);
    assertMode(target, 0o644, `${name} is not 0644`);
    assert.equal(readFileSync(target, "utf8"), readFileSync(join(sourceDir, name), "utf8"));
  }
});

test("generation removes stale files and leaves unrelated files alone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pstack-clean-"));
  const vendor = join(dir, "vendor");
  const adapters = join(dir, "adapters");
  const out = join(dir, "out");
  mkdirSync(join(vendor, "skills/alpha"), { recursive: true });
  writeFileSync(join(vendor, "skills/alpha/SKILL.md"), "---\nname: alpha\n---\n\nSpawn `Task`.\n");
  writeFileSync(join(vendor, "plugin.json"), JSON.stringify({ name: "pstack", version: "0.15.42" }));
  writeFileSync(join(vendor, "LICENSE"), "MIT License\n");
  mkdirSync(adapters, { recursive: true });
  writeFileSync(join(adapters, "substitutions.json"), JSON.stringify({
    version: 1,
    upstream: { commit: "bf0c7cd", version: "0.15.42" },
    rules: [],
    forks: [],
  }));

  await generatePlugin({ vendorDir: vendor, adaptersDir: adapters, outDir: out });
  writeFileSync(join(out, "skills/extra.md"), "extra");
  mkdirSync(join(out, "skills/empty-dir"), { recursive: true });
  writeFileSync(join(out, "unrelated.txt"), "keep");

  await generatePlugin({ vendorDir: vendor, adaptersDir: adapters, outDir: out });

  assert.ok(!existsSync(join(out, "skills/extra.md")));
  assert.ok(!existsSync(join(out, "skills/empty-dir")));
  assert.equal(readFileSync(join(out, "unrelated.txt"), "utf8"), "keep");
});
