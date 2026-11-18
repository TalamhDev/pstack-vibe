// The session-start hook's sheet resolution and run-directory contract.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PLUGIN = join(ROOT, "generated/vibe");
const HOOK = join(PLUGIN, "ai.mistral.vibe/scripts/session-start.mjs");

const tmp = mkdtempSync(join(tmpdir(), "pstack-session-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

function runHook({ cwd = ROOT, input = "", env = {} } = {}) {
  const base = { ...process.env };
  delete base.VIBE_HOME;
  delete base.PLUGIN_DATA;
  delete base.PLUGIN_ROOT;
  try {
    const stdout = execFileSync(process.execPath, [HOOK], {
      cwd,
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...base, ...env },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? "") };
  }
}

function context(result) {
  assert.equal(result.status, 0, `hook exited ${result.status}: ${result.stderr.trim()}`);
  const parsed = JSON.parse(result.stdout);
  const text = parsed?.hook_specific_output?.additional_context;
  assert.equal(typeof text, "string", "missing hook_specific_output.additional_context");
  assert.ok(text.length > 0, "missing context");
  return text;
}

const sheet = (dir, body) => {
  mkdirSync(join(dir, ".vibe"), { recursive: true });
  writeFileSync(join(dir, ".vibe/pstack-models.md"), body);
};

mkdirSync(join(tmp, "home/.vibe"), { recursive: true });
writeFileSync(
  join(tmp, "home/.vibe/pstack-models.md"),
  "# pstack model configuration\n# budget: large (high)\nfeature, refactoring: pstack-deepseek\n",
);

test("home sheet", () => {
  const text = context(runHook({ env: { HOME: join(tmp, "home"), PLUGIN_ROOT: PLUGIN } }));
  assert.ok(text.includes("pstack-deepseek"), "missing: pstack-deepseek");
  assert.ok(text.includes("poteto-mode"), "missing: poteto-mode");
});

test("project sheet wins", () => {
  sheet(join(tmp, "project"), "feature, refactoring: pstack-local\n");
  const text = context(
    runHook({ cwd: join(tmp, "project"), env: { HOME: join(tmp, "home"), PLUGIN_ROOT: PLUGIN } }),
  );
  assert.ok(text.includes("pstack-local"), "missing: pstack-local");
  assert.ok(!text.includes("pstack-deepseek"), "project sheet did not win");
});

test("payload cwd sheet wins", () => {
  sheet(join(tmp, "payload"), "feature, refactoring: pstack-payload\n");
  mkdirSync(join(tmp, "elsewhere"), { recursive: true });
  const text = context(
    runHook({
      cwd: join(tmp, "elsewhere"),
      input: JSON.stringify({ cwd: join(tmp, "payload"), transcript_path: "/tmp/session.jsonl" }),
      env: { HOME: join(tmp, "home"), PLUGIN_ROOT: PLUGIN },
    }),
  );
  assert.ok(text.includes("pstack-payload"), "missing: pstack-payload");
  assert.ok(!text.includes("pstack-deepseek"), "payload cwd sheet did not win");
});

test("control characters stay valid JSON", () => {
  sheet(join(tmp, "control"), "feature, refactoring: pstack-control\fbell\n");
  mkdirSync(join(tmp, "control-home"), { recursive: true });
  const text = context(
    runHook({
      input: JSON.stringify({ cwd: join(tmp, "control") }),
      env: { HOME: join(tmp, "control-home"), PLUGIN_ROOT: PLUGIN },
    }),
  );
  assert.ok(text.includes("pstack-control"), "missing: pstack-control");
});

test("paths with spaces", () => {
  mkdirSync(join(tmp, "home with space/.vibe"), { recursive: true });
  copyFileSync(join(tmp, "home/.vibe/pstack-models.md"), join(tmp, "home with space/.vibe/pstack-models.md"));
  const text = context(
    runHook({ env: { HOME: join(tmp, "home with space"), PLUGIN_ROOT: join(tmp, "plugin root") } }),
  );
  assert.ok(text.includes("pstack-deepseek"), "missing: pstack-deepseek");
  assert.ok(text.includes("plugin root"), "missing: plugin root");
});

test("missing sheet", () => {
  mkdirSync(join(tmp, "empty-home"), { recursive: true });
  mkdirSync(join(tmp, "empty-project"), { recursive: true });
  const text = context(
    runHook({ cwd: join(tmp, "empty-project"), env: { HOME: join(tmp, "empty-home"), PLUGIN_ROOT: PLUGIN } }),
  );
  assert.ok(text.includes("/pstack:setup-pstack"), "missing: /pstack:setup-pstack");
});

test("derives plugin root", () => {
  const text = context(runHook({ cwd: join(tmp, "empty-project"), env: { HOME: join(tmp, "empty-home") } }));
  assert.ok(text.includes(PLUGIN), `missing: ${PLUGIN}`);
});

test("names the run directory and marks it ready", () => {
  mkdirSync(join(tmp, "rundir"), { recursive: true });
  const text = context(
    runHook({
      input: JSON.stringify({ session_id: "sess-run", cwd: join(tmp, "rundir") }),
      env: { HOME: join(tmp, "home"), PLUGIN_ROOT: PLUGIN, PLUGIN_DATA: join(tmp, "data") },
    }),
  );
  assert.ok(text.includes(join(tmp, "data/runs/sess-run")), "missing: the run directory");
  assert.ok(existsSync(join(tmp, "data/runs/sess-run/ready")), "no ready marker in the run directory");
});

test("VIBE_HOME sheet wins over the HOME sheet", () => {
  mkdirSync(join(tmp, "vibe-home"), { recursive: true });
  mkdirSync(join(tmp, "other-home/.vibe"), { recursive: true });
  writeFileSync(join(tmp, "vibe-home/pstack-models.md"), "feature, refactoring: pstack-vibe-home\n");
  writeFileSync(join(tmp, "other-home/.vibe/pstack-models.md"), "feature, refactoring: pstack-other-home\n");
  const text = context(
    runHook({
      cwd: join(tmp, "empty-project"),
      env: { VIBE_HOME: join(tmp, "vibe-home"), HOME: join(tmp, "other-home"), PLUGIN_ROOT: PLUGIN },
    }),
  );
  assert.ok(text.includes("pstack-vibe-home"), "missing: pstack-vibe-home");
  assert.ok(!text.includes("pstack-other-home"), "VIBE_HOME sheet did not win over the HOME sheet");
});

test("VIBE_HOME with no sheet does not fall back to the HOME sheet", () => {
  mkdirSync(join(tmp, "vibe-empty"), { recursive: true });
  mkdirSync(join(tmp, "fallback-home/.vibe"), { recursive: true });
  writeFileSync(join(tmp, "fallback-home/.vibe/pstack-models.md"), "feature, refactoring: pstack-fallback-home\n");
  const text = context(
    runHook({
      cwd: join(tmp, "empty-project"),
      env: { VIBE_HOME: join(tmp, "vibe-empty"), HOME: join(tmp, "fallback-home"), PLUGIN_ROOT: PLUGIN },
    }),
  );
  assert.ok(text.includes("/pstack:setup-pstack"), "missing: /pstack:setup-pstack");
  assert.ok(!text.includes("pstack-fallback-home"), "VIBE_HOME with no sheet fell back to the HOME sheet");
});
