import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installPlugin, uninstallPlugin } from "../src/install.mjs";
import { resolveLayout } from "../src/layout.mjs";
import { removeTree } from "../src/tree.mjs";
import { UnsupportedVibeError, VibeMissingError, parseVibeVersion } from "../src/vibe.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED = join(ROOT, "generated/vibe");
const CLI = join(ROOT, "bin/pstack-vibe.mjs");

const probeOf = (text) => async () => ({ kind: "ok", version: parseVibeVersion(text) });
const supported = probeOf("vibe 3.1.2");
const unsupported = probeOf("vibe 3.9.9");
const absent = async () => ({ kind: "absent" });

function scratch() {
  return mkdtempSync(join(tmpdir(), "pstack-install-"));
}

function userLayout(home) {
  return resolveLayout({ scope: "user", env: { VIBE_HOME: home }, cwd: ROOT });
}

async function install(layout, overrides = {}) {
  return installPlugin({
    layout,
    source: GENERATED,
    force: false,
    dryRun: false,
    vibe: supported,
    ...overrides,
  });
}

test("install writes the plugin manifest, a skill, and the hook file", async () => {
  const work = scratch();
  try {
    const layout = userLayout(join(work, "home"));
    const result = await install(layout);

    assert.equal(result.kind, "installed");
    assert.equal(result.target, layout.pluginDir);
    assert.equal(result.scope, "user");
    assert.equal(existsSync(join(layout.pluginDir, "plugin.json")), true);
    assert.equal(existsSync(join(layout.pluginDir, "skills/poteto-mode/SKILL.md")), true);
    assert.equal(existsSync(join(layout.pluginDir, "ai.mistral.vibe/hooks.toml")), true);
  } finally {
    await removeTree(work);
  }
});

test("install keeps the hook scripts executable", async () => {
  const work = scratch();
  try {
    const layout = userLayout(join(work, "home"));
    await install(layout);
    const mode = statSync(join(layout.pluginDir, "ai.mistral.vibe/scripts/chain.sh")).mode;
    assert.notEqual(mode & 0o111, 0, "the installed chain.sh is not executable");
  } finally {
    await removeTree(work);
  }
});

test("install leaves no staging or old directory behind", async () => {
  const work = scratch();
  try {
    const layout = userLayout(join(work, "home"));
    await install(layout);
    await install(layout, { force: true });
    const leftovers = readdirSync(layout.pluginsDir).filter((name) => name.startsWith(".pstack-"));
    assert.deepEqual(leftovers, []);
  } finally {
    await removeTree(work);
  }
});

test("uninstall removes the plugin directory", async () => {
  const work = scratch();
  try {
    const layout = userLayout(join(work, "home"));
    await install(layout);
    const result = await uninstallPlugin({ layout, purge: false, dryRun: false });
    assert.equal(result.kind, "removed");
    assert.equal(existsSync(layout.pluginDir), false);
  } finally {
    await removeTree(work);
  }
});

test("uninstall reports an absent install", async () => {
  const work = scratch();
  try {
    const layout = userLayout(join(work, "home"));
    const result = await uninstallPlugin({ layout, purge: false, dryRun: false });
    assert.equal(result.kind, "absent");
  } finally {
    await removeTree(work);
  }
});

test("uninstall --purge removes the sheet and the pstack profiles", async () => {
  const work = scratch();
  try {
    const layout = userLayout(join(work, "home"));
    await install(layout);
    mkdirSync(layout.agentsDir, { recursive: true });
    writeFileSync(layout.sheetPath, "# deepseek: deepseek-flash\n");
    writeFileSync(join(layout.agentsDir, "pstack-deepseek.toml"), "schema_version = 1\n");
    writeFileSync(join(layout.agentsDir, "other.toml"), "schema_version = 1\n");

    const result = await uninstallPlugin({ layout, purge: true, dryRun: false });

    assert.equal(result.kind, "removed");
    assert.deepEqual(result.purged, [layout.sheetPath, join(layout.agentsDir, "pstack-deepseek.toml")]);
    assert.equal(existsSync(layout.sheetPath), false);
    assert.equal(existsSync(join(layout.agentsDir, "pstack-deepseek.toml")), false);
    assert.equal(existsSync(join(layout.agentsDir, "other.toml")), true);
  } finally {
    await removeTree(work);
  }
});

test("project scope installs into ./.vibe and uninstalls from it", async () => {
  const work = scratch();
  try {
    const project = join(work, "project");
    mkdirSync(project, { recursive: true });
    const layout = resolveLayout({ scope: "project", env: {}, cwd: project });

    await install(layout);
    assert.equal(existsSync(join(project, ".vibe/plugins/pstack/plugin.json")), true);

    await uninstallPlugin({ layout, purge: false, dryRun: false });
    assert.equal(existsSync(join(project, ".vibe/plugins/pstack")), false);
  } finally {
    await removeTree(work);
  }
});

test("the gate refuses a Vibe outside the tested range and writes nothing", async () => {
  const work = scratch();
  try {
    const layout = userLayout(join(work, "home"));
    await assert.rejects(install(layout, { vibe: unsupported }), (error) => {
      assert.ok(error instanceof UnsupportedVibeError);
      assert.match(error.message, /outside the tested range >=3\.1\.2 <3\.2\.0/);
      assert.match(error.message, /detected: vibe 3\.9\.9/);
      return true;
    });
    assert.equal(existsSync(layout.pluginDir), false);
    assert.equal(existsSync(layout.pluginsDir), false);
  } finally {
    await removeTree(work);
  }
});

test("the gate refuses a missing Vibe and writes nothing", async () => {
  const work = scratch();
  try {
    const layout = userLayout(join(work, "home"));
    await assert.rejects(install(layout, { vibe: absent }), VibeMissingError);
    assert.equal(existsSync(layout.pluginsDir), false);
  } finally {
    await removeTree(work);
  }
});

test("a dry run still gates", async () => {
  const work = scratch();
  try {
    const layout = userLayout(join(work, "home"));
    await assert.rejects(install(layout, { vibe: unsupported, dryRun: true }), UnsupportedVibeError);
  } finally {
    await removeTree(work);
  }
});

test("a dry run plans the writes without performing them", async () => {
  const work = scratch();
  try {
    const layout = userLayout(join(work, "home"));
    const result = await install(layout, { dryRun: true });

    assert.equal(result.kind, "planned");
    assert.deepEqual(result.actions, [
      `mkdir -p ${layout.pluginsDir}`,
      `copy ${GENERATED} -> ${layout.pluginDir}`,
    ]);
    assert.equal(existsSync(layout.pluginsDir), false);
  } finally {
    await removeTree(work);
  }
});

test("a dry run over an existing install plans the removal too", async () => {
  const work = scratch();
  try {
    const layout = userLayout(join(work, "home"));
    await install(layout);
    const result = await install(layout, { dryRun: true });
    assert.deepEqual(result.actions, [
      `mkdir -p ${layout.pluginsDir}`,
      `remove ${layout.pluginDir}`,
      `copy ${GENERATED} -> ${layout.pluginDir}`,
    ]);
  } finally {
    await removeTree(work);
  }
});

test("a foreign directory at the target is refused without --force", async () => {
  const work = scratch();
  try {
    const layout = userLayout(join(work, "home"));
    mkdirSync(layout.pluginDir, { recursive: true });
    writeFileSync(join(layout.pluginDir, "plugin.json"), '{"name":"something-else"}\n');

    await assert.rejects(install(layout), /exists and is not a pstack plugin; rerun with --force/);
    assert.equal(existsSync(join(layout.pluginDir, "plugin.json")), true);
  } finally {
    await removeTree(work);
  }
});

test("--force replaces a foreign directory at the target", async () => {
  const work = scratch();
  try {
    const layout = userLayout(join(work, "home"));
    mkdirSync(layout.pluginDir, { recursive: true });
    writeFileSync(join(layout.pluginDir, "plugin.json"), '{"name":"something-else"}\n');

    const result = await install(layout, { force: true });
    assert.equal(result.kind, "installed");
    assert.equal(existsSync(join(layout.pluginDir, "skills/poteto-mode/SKILL.md")), true);
  } finally {
    await removeTree(work);
  }
});

test("a malformed manifest at the target is not a pstack plugin", async () => {
  const work = scratch();
  try {
    const layout = userLayout(join(work, "home"));
    mkdirSync(layout.pluginDir, { recursive: true });
    writeFileSync(join(layout.pluginDir, "plugin.json"), "{not json\n");
    await assert.rejects(install(layout), /exists and is not a pstack plugin/);
  } finally {
    await removeTree(work);
  }
});

test("a missing plugin source is refused", async () => {
  const work = scratch();
  try {
    const layout = userLayout(join(work, "home"));
    await assert.rejects(install(layout, { source: join(work, "nope") }), /generated plugin not found at/);
  } finally {
    await removeTree(work);
  }
});

test("an interrupted install is swept by the next one", async () => {
  const work = scratch();
  try {
    const layout = userLayout(join(work, "home"));
    mkdirSync(join(layout.pluginsDir, ".pstack-staging-dead"), { recursive: true });
    mkdirSync(join(layout.pluginsDir, ".pstack-old-dead"), { recursive: true });

    await install(layout);

    const leftovers = readdirSync(layout.pluginsDir).filter((name) => name.startsWith(".pstack-"));
    assert.deepEqual(leftovers, []);
    assert.equal(existsSync(join(layout.pluginDir, "plugin.json")), true);
  } finally {
    await removeTree(work);
  }
});

test("the CLI refuses to install against an untested Vibe on PATH", async () => {
  const work = scratch();
  try {
    const bin = join(work, "bin");
    mkdirSync(bin, { recursive: true });
    const fake = join(bin, "vibe");
    writeFileSync(fake, "#!/bin/sh\necho 'vibe 3.9.9'\n");
    chmodSync(fake, 0o755);

    const home = join(work, "home");
    const result = await runCli(["install"], { VIBE_HOME: home, PATH: `${bin}:${process.env.PATH}` });

    assert.equal(result.exitCode, 1, result.output);
    assert.match(result.stderr, /outside the tested range >=3\.1\.2 <3\.2\.0/);
    assert.match(result.stderr, /detected: vibe 3\.9\.9/);
    assert.equal(existsSync(join(home, "plugins/pstack")), false);
  } finally {
    await removeTree(work);
  }
});

test("the CLI installs and uninstalls against a tested Vibe on PATH", async () => {
  const work = scratch();
  try {
    const bin = join(work, "bin");
    mkdirSync(bin, { recursive: true });
    const fake = join(bin, "vibe");
    writeFileSync(fake, "#!/bin/sh\necho 'vibe 3.1.2'\n");
    chmodSync(fake, 0o755);

    const home = join(work, "home");
    const env = { VIBE_HOME: home, PATH: `${bin}:${process.env.PATH}` };

    const installed = await runCli(["install"], env);
    assert.equal(installed.exitCode, 0, installed.output);
    assert.match(installed.stdout, /^install: pstack installed at .* \(user scope\)/m);
    assert.equal(existsSync(join(home, "plugins/pstack/plugin.json")), true);

    const removed = await runCli(["uninstall"], env);
    assert.equal(removed.exitCode, 0, removed.output);
    assert.match(removed.stdout, /^uninstall: removed /m);
    assert.equal(existsSync(join(home, "plugins/pstack")), false);
  } finally {
    await removeTree(work);
  }
});

test("the CLI rejects an unknown argument with exit 2", async () => {
  const result = await runCli(["--nope"], {});
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /unknown argument: --nope/);
  assert.match(result.stderr, /usage: pstack-vibe/);
});

test("verify rejects --project instead of ignoring it", async () => {
  const result = await runCli(["verify", "--project"], {});
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /drop --project/);
});

test("the CLI prints usage for --help", async () => {
  const result = await runCli(["--help"], {});
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /usage: pstack-vibe/);
});

function runCli(args, env) {
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { cwd: ROOT, env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const exitCode = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolvePromise({ stdout, stderr, exitCode, output: `${stdout}${stderr}` });
      },
    );
  });
}
