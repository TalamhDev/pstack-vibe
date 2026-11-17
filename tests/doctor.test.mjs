import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKS, doctor } from "../src/doctor.mjs";
import { installPlugin } from "../src/install.mjs";
import { resolveLayout } from "../src/layout.mjs";
import { removeTree } from "../src/tree.mjs";
import { parseVibeVersion } from "../src/vibe.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED = join(ROOT, "generated/vibe");

const probeOf = (text) => async () => ({ kind: "ok", version: parseVibeVersion(text) });
const supported = probeOf("vibe 3.1.2");

/** chmod cannot deny write access to a directory on Windows, so the fixture cannot be built there. */
const READ_ONLY_DIR =
  process.platform === "win32" ? "chmod cannot make a directory read-only on Windows" : false;

const PASSING_SHEET = [
  "# pstack model configuration",
  "# deepseek: deepseek-flash",
  "feature, refactoring: pstack-deepseek",
  "",
].join("\n");

const DEEPSEEK_PROFILE = [
  "schema_version = 1",
  'agent_type = "subagent"',
  'display_name = "pstack deepseek"',
  'description = "pstack code delegate on deepseek-flash."',
  'active_model = "deepseek-flash"',
  "",
].join("\n");

const PASSING_CONFIG = [
  "[[models]]",
  'name = "deepseek-v4-1-flash-1017"',
  'provider = "mistral"',
  'alias = "deepseek-flash"',
  "",
].join("\n");

async function fixture() {
  const work = mkdtempSync(join(tmpdir(), "pstack-doctor-"));
  const layout = resolveLayout({ scope: "user", env: { VIBE_HOME: join(work, "vibe home") }, cwd: ROOT });
  mkdirSync(layout.base, { recursive: true });
  await installPlugin({
    layout,
    source: GENERATED,
    force: false,
    dryRun: false,
    vibe: supported,
  });
  mkdirSync(layout.agentsDir, { recursive: true });
  writeFileSync(layout.sheetPath, PASSING_SHEET);
  writeFileSync(join(layout.agentsDir, "pstack-deepseek.toml"), DEEPSEEK_PROFILE);
  writeFileSync(layout.configPath, PASSING_CONFIG);

  return {
    layout,
    async run(vibe = supported) {
      const report = await doctor({ layout, vibe });
      const out = report.checks.map((entry) => `${entry.ok ? "PASS" : "FAIL"}  ${entry.detail}`).join("\n");
      return { status: report.ok ? 0 : 1, out, report };
    },
    async cleanup() {
      await removeTree(work);
    },
  };
}

function expect(result, status, pattern) {
  assert.equal(result.status, status, `expected exit ${status}, got ${result.status}\n${result.out}`);
  assert.match(result.out, pattern);
}

test("the check registry has ten uniquely identified checks", () => {
  assert.equal(CHECKS.length, 10);
  const ids = CHECKS.map((check) => check.id);
  assert.deepEqual([...new Set(ids)], ids, `duplicate check id in ${ids.join(", ")}`);
  assert.deepEqual(ids, [
    "vibe",
    "plugin-manifest",
    "skills",
    "hook",
    "chain",
    "plugin-data",
    "model-sheet",
    "agent-profiles",
    "model-aliases",
    "vibe-compat",
  ]);
});

test("a complete install passes every check", async () => {
  const home = await fixture();
  try {
    const result = await home.run();
    expect(result, 0, /^PASS {2}agent profiles named in the sheet are installed$/m);
    expect(result, 0, /^PASS {2}model aliases recorded in the sheet exist in /m);
    expect(result, 0, /^PASS {2}chain: chain\.tsv is installed and names only installed playbooks$/m);
    expect(result, 0, /^PASS {2}chain: .* is writable$/m);
    expect(result, 0, /^PASS {2}vibe is on PATH: vibe 3\.1\.2$/m);
    expect(result, 0, /^PASS {2}vibe 3\.1\.2 is within the tested range >=3\.1\.2 <3\.2\.0$/m);
    assert.equal(result.report.checks.length, 10);
  } finally {
    await home.cleanup();
  }
});

test("a named profile with no TOML fails", async () => {
  const home = await fixture();
  try {
    rmSync(join(home.layout.agentsDir, "pstack-deepseek.toml"));
    expect(await home.run(), 1, /^FAIL {2}agent profiles missing for: pstack-deepseek$/m);
  } finally {
    await home.cleanup();
  }
});

test("an alias recorded in the sheet but absent from config.toml fails", async () => {
  const home = await fixture();
  try {
    writeFileSync(home.layout.configPath, '[[models]]\nname = "deepseek-v4-1-flash-1017"\nprovider = "mistral"\n');
    expect(await home.run(), 1, /^FAIL {2}model aliases missing from /m);
  } finally {
    await home.cleanup();
  }
});

test("a skill directory missing from the install fails", async () => {
  const home = await fixture();
  try {
    const away = join(home.layout.base, "..", "arena");
    renameSync(join(home.layout.pluginDir, "skills/arena"), away);
    expect(await home.run(), 1, /^FAIL {2}skills: missing from the install: arena$/m);
    renameSync(away, join(home.layout.pluginDir, "skills/arena"));
    expect(await home.run(), 0, /^PASS {2}skills: \d+ SKILL\.md files match skills\.manifest$/m);
  } finally {
    await home.cleanup();
  }
});

test("an unexpected skill directory fails", async () => {
  const home = await fixture();
  try {
    const unexpected = join(home.layout.pluginDir, "skills/zzz-unexpected");
    mkdirSync(unexpected, { recursive: true });
    cpSync(join(home.layout.pluginDir, "skills/why/SKILL.md"), join(unexpected, "SKILL.md"));
    expect(await home.run(), 1, /^FAIL {2}skills: not in skills\.manifest:/m);
  } finally {
    await home.cleanup();
  }
});

test("a family with no alias in config.toml fails, then passes once added", async () => {
  const home = await fixture();
  try {
    writeFileSync(
      home.layout.sheetPath,
      [
        "# pstack model configuration",
        "# deepseek: deepseek-flash",
        "# qwen: qwen-3-max",
        "feature, refactoring: pstack-deepseek",
        "arena runners: pstack-deepseek, pstack-qwen",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(home.layout.agentsDir, "pstack-qwen.toml"),
      [
        "schema_version = 1",
        'agent_type = "subagent"',
        'display_name = "pstack qwen"',
        'description = "pstack code delegate on qwen-3-max."',
        'active_model = "qwen-3-max"',
        "",
      ].join("\n"),
    );

    expect(await home.run(), 1, /^FAIL {2}model aliases missing from .*qwen:qwen-3-max$/m);

    writeFileSync(
      home.layout.configPath,
      `${PASSING_CONFIG}\n[[models]]\nname = "qwen-3-max-2025"\nprovider = "mistral"\nalias = "qwen-3-max"\n`,
    );
    expect(await home.run(), 0, /^PASS {2}model aliases recorded in the sheet exist in /m);
  } finally {
    await home.cleanup();
  }
});

test("role lines with no comment lines leave every family without an alias", async () => {
  const home = await fixture();
  try {
    writeFileSync(home.layout.sheetPath, "feature, refactoring: pstack-deepseek\n");
    expect(await home.run(), 1, /^FAIL {2}model aliases: no alias recorded for family: deepseek$/m);
  } finally {
    await home.cleanup();
  }
});

test("a comment line naming a profile does not satisfy the profile check", async () => {
  const home = await fixture();
  try {
    writeFileSync(
      home.layout.sheetPath,
      [
        "# pstack model configuration",
        "# deepseek: deepseek-flash",
        "# note: pstack-ghost is unused",
        "feature, refactoring: pstack-deepseek",
        "",
      ].join("\n"),
    );
    expect(await home.run(), 0, /^PASS {2}agent profiles named in the sheet are installed$/m);
  } finally {
    await home.cleanup();
  }
});

test("the same token on a role line does fail the profile check", async () => {
  const home = await fixture();
  try {
    writeFileSync(
      home.layout.sheetPath,
      [
        "# pstack model configuration",
        "# deepseek: deepseek-flash",
        "feature, refactoring: pstack-deepseek, pstack-ghost",
        "",
      ].join("\n"),
    );
    expect(await home.run(), 1, /^FAIL {2}agent profiles missing for: pstack-ghost$/m);
  } finally {
    await home.cleanup();
  }
});

test("a missing chain manifest fails", async () => {
  const home = await fixture();
  try {
    const chain = join(home.layout.pluginDir, "ai.mistral.vibe/chain.tsv");
    const away = join(home.layout.base, "..", "chain.tsv");
    renameSync(chain, away);
    expect(await home.run(), 1, /^FAIL {2}chain: chain\.tsv is missing from /m);
    renameSync(away, chain);
    expect(await home.run(), 0, /^PASS {2}chain: chain\.tsv is installed/m);
  } finally {
    await home.cleanup();
  }
});

test("a chain manifest naming a playbook that is not installed fails", async () => {
  const home = await fixture();
  try {
    const chain = join(home.layout.pluginDir, "ai.mistral.vibe/chain.tsv");
    const saved = join(home.layout.base, "..", "chain.tsv");
    cpSync(chain, saved);
    writeFileSync(
      chain,
      `${readFileSync(chain, "utf8")}ghost-playbook\tghost\talways\tevidence\trequire\tghost\tno such playbook\n`,
    );
    expect(await home.run(), 1, /^FAIL {2}chain: chain\.tsv names playbooks that are not installed: ghost-playbook$/m);
    cpSync(saved, chain);
    expect(await home.run(), 0, /^PASS {2}chain: chain\.tsv is installed/m);
  } finally {
    await home.cleanup();
  }
});

test("a read-only plugin data directory fails", { skip: READ_ONLY_DIR }, async () => {
  const home = await fixture();
  try {
    mkdirSync(home.layout.dataDir, { recursive: true });
    chmodSync(home.layout.dataDir, 0o500);
    expect(await home.run(), 1, /^FAIL {2}chain: .* is not writable/m);
    chmodSync(home.layout.dataDir, 0o700);
    expect(await home.run(), 0, /^PASS {2}chain: .* is writable$/m);
  } finally {
    await home.cleanup();
  }
});

test("a missing model sheet fails checks 7, 8, and 9 separately", async () => {
  const home = await fixture();
  try {
    rmSync(home.layout.sheetPath);
    const result = await home.run();
    expect(result, 1, /^FAIL {2}model sheet at .* is missing; run \/setup-pstack$/m);
    expect(result, 1, /^FAIL {2}agent profiles: cannot check without a model sheet$/m);
    expect(result, 1, /^FAIL {2}model aliases: cannot check without a model sheet$/m);
  } finally {
    await home.cleanup();
  }
});

test("a missing plugin manifest fails", async () => {
  const home = await fixture();
  try {
    rmSync(join(home.layout.pluginDir, "plugin.json"));
    expect(await home.run(), 1, /^FAIL {2}plugin manifest at .* is missing or does not name pstack$/m);
  } finally {
    await home.cleanup();
  }
});

test("a missing hook file fails", async () => {
  const home = await fixture();
  try {
    rmSync(join(home.layout.pluginDir, "ai.mistral.vibe/hooks.toml"));
    expect(await home.run(), 1, /^FAIL {2}hook file at .* is missing$/m);
  } finally {
    await home.cleanup();
  }
});

test("a missing skills manifest fails", async () => {
  const home = await fixture();
  try {
    rmSync(join(home.layout.pluginDir, "skills.manifest"));
    expect(await home.run(), 1, /^FAIL {2}skills: skills\.manifest is missing from .*; reinstall the plugin$/m);
  } finally {
    await home.cleanup();
  }
});

test("the compat check fails when the installed Vibe is outside the range", async () => {
  const home = await fixture();
  try {
    const result = await home.run(probeOf("vibe 3.9.9"));
    expect(result, 1, /^FAIL {2}vibe 3\.9\.9 is outside the tested range >=3\.1\.2 <3\.2\.0$/m);
    expect(result, 1, /^PASS {2}vibe is on PATH: vibe 3\.9\.9$/m);
  } finally {
    await home.cleanup();
  }
});

test("the compat check fails closed when vibe is absent or unparseable", async () => {
  const home = await fixture();
  try {
    const absent = await home.run(async () => ({ kind: "absent" }));
    expect(absent, 1, /^FAIL {2}vibe is not on PATH$/m);
    expect(absent, 1, /^FAIL {2}vibe is not on PATH; cannot prove it is a tested version$/m);

    const unparseable = await home.run(async () => ({ kind: "unparseable", text: "vibe nightly" }));
    expect(unparseable, 1, /^PASS {2}vibe is on PATH: vibe nightly$/m);
    expect(unparseable, 1, /^FAIL {2}cannot parse a version from 'vibe nightly'; the tested range is >=3\.1\.2 <3\.2\.0$/m);
  } finally {
    await home.cleanup();
  }
});

test("the probe is resolved once per doctor run", async () => {
  const home = await fixture();
  try {
    let calls = 0;
    const counting = async () => {
      calls += 1;
      return { kind: "ok", version: parseVibeVersion("vibe 3.1.2") };
    };
    await doctor({ layout: home.layout, vibe: counting });
    assert.equal(calls, 1);
  } finally {
    await home.cleanup();
  }
});
