// tests/chain-record.test.mjs
//
// The recorder as behavior: every case runs the real `chain.mjs record` against
// a real run directory, exactly as tests/chain-record.test.sh did through `sh`.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SCRIPT = join(ROOT, "generated/vibe/ai.mistral.vibe/scripts/chain.mjs");
const PLUGIN = join(ROOT, "generated/vibe");

const tmp = mkdtempSync(join(tmpdir(), "pstack-record-"));
const data = join(tmp, "data");
after(() => rmSync(tmp, { recursive: true, force: true }));

const env = { ...process.env, PLUGIN_DATA: data, PLUGIN_ROOT: PLUGIN };

function record(input) {
  try {
    execFileSync(process.execPath, [SCRIPT, "record"], {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
  } catch (error) {
    assert.fail(`record exited ${error.status}: ${String(error.stderr ?? "")}`);
  }
}

function recordAsync(input) {
  return new Promise((settle, fail) => {
    const child = spawn(process.execPath, [SCRIPT, "record"], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", fail);
    child.on("close", (status) => settle({ status, stderr }));
    child.stdin.end(input);
  });
}

/** A run directory with the marker the recorder requires. */
function newRun(session) {
  mkdirSync(join(data, "runs", session), { recursive: true });
  writeFileSync(join(data, "runs", session, "ready"), "");
}

function postTool(session, parent, toolName, toolInput) {
  return JSON.stringify({
    session_id: session,
    transcript_path: "/tmp/t",
    cwd: "/tmp",
    parent_session_id: parent === "" ? null : parent,
    hook_event_name: "post_tool",
    tool_name: toolName,
    tool_call_id: "call_1",
    tool_input: toolInput,
    tool_status: "success",
    tool_output: null,
    tool_output_text: "ok",
    tool_error: null,
    duration_ms: 0,
  });
}

const content = (path) => readFileSync(path, "utf8");
const lineCount = (path) => content(path).split("\n").length - 1;
const lastLine = (path) => content(path).split("\n").at(-2);

test("read_file records path=", () => {
  newRun("sess-a");
  record(postTool("sess-a", "", "file_system.read_file", { file_path: "/p/skills/poteto-mode/SKILL.md" }));
  const evidence = join(data, "runs/sess-a/evidence.tsv");
  assert.ok(existsSync(evidence), "no evidence file");
  assert.equal(lineCount(evidence), 1, "expected one line");
  assert.equal(
    content(evidence),
    "file_system.read_file\tpath=/p/skills/poteto-mode/SKILL.md\n",
    `read_file did not record one structured path line: ${content(evidence)}`,
  );
});

test("a 6000-byte spawn message still records name=architect-1", () => {
  newRun("sess-spawn");
  record(
    postTool("sess-spawn", "", "agents.spawn", {
      config_name: "pstack:poteto-agent",
      message: "x".repeat(6000),
      name: "architect-1",
    }),
  );
  const spawn = join(data, "runs/sess-spawn/evidence.tsv");
  assert.equal(lineCount(spawn), 1, "the spawn payload split across lines");
  assert.equal(
    content(spawn),
    "agents.spawn\tname=architect-1\tconfig=pstack:poteto-agent\n",
    `a 6000-byte message erased the spawn name: ${content(spawn)}`,
  );
});

test("write_file and edit record the path, never the content", () => {
  const evidence = join(data, "runs/sess-a/evidence.tsv");
  record(
    postTool("sess-a", "", "file_system.write_file", {
      file_path: "/p/out.md",
      content: "SECRET-BODY-MARKER",
    }),
  );
  record(
    postTool("sess-a", "", "file_system.edit", {
      file_path: "/p/edit.md",
      new_string: "SECRET-NEW-MARKER",
      old_string: "SECRET-OLD-MARKER",
    }),
  );
  const lines = content(evidence).split("\n");
  assert.equal(lines.at(-3), "file_system.write_file\tpath=/p/out.md", "write_file did not record its path alone");
  assert.equal(lines.at(-2), "file_system.edit\tpath=/p/edit.md", "edit did not record its path alone");
  assert.ok(!content(evidence).includes("SECRET"), "a write recorded the file content");
});

test("cmd truncates at 1024 bytes and stays one line", () => {
  const evidence = join(data, "runs/sess-a/evidence.tsv");
  record(postTool("sess-a", "", "file_system.bash", { command: "x".repeat(10240) }));
  assert.ok(
    Buffer.byteLength(lastLine(evidence)) <= 1100,
    "the cmd field is longer than 1024 bytes plus its prefix",
  );
  assert.equal(lineCount(evidence), 4, "truncation split the line");
});

test("literal newline flattened", () => {
  const evidence = join(data, "runs/sess-a/evidence.tsv");
  record(postTool("sess-a", "", "file_system.bash", { command: "echo one\necho two" }));
  assert.equal(lineCount(evidence), 5, "a literal newline split the line");
  assert.equal(
    lastLine(evidence),
    "file_system.bash\tcmd=echo one echo two",
    `the newline payload was not flattened: ${lastLine(evidence)}`,
  );
});

test("fifty concurrent appends stay intact", async () => {
  newRun("sess-c");
  const results = await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      recordAsync(postTool("sess-c", "", "file_system.bash", { command: `echo ${index + 1}` })),
    ),
  );
  for (const result of results) assert.equal(result.status, 0, `record exited ${result.status}: ${result.stderr}`);

  const concurrent = join(data, "runs/sess-c/evidence.tsv");
  assert.equal(lineCount(concurrent), 50, "concurrent appends lost lines");
  const torn = content(concurrent)
    .split("\n")
    .filter((line) => line !== "" && !/^file_system\.bash\tcmd=echo [0-9]+$/.test(line));
  assert.equal(torn.length, 0, `concurrent appends tore ${torn.length} lines`);
});

test("no ready marker, no evidence", () => {
  mkdirSync(join(data, "runs/sess-noready"), { recursive: true });
  record(postTool("sess-noready", "", "file_system.bash", { command: "ls" }));
  assert.equal(existsSync(join(data, "runs/sess-noready/evidence.tsv")), false, "recorded without a ready marker");
});

test("subagent folds into the parent run", () => {
  newRun("sess-parent");
  record(postTool("sess-child", "sess-parent", "file_system.bash", { command: "ls" }));
  assert.ok(
    content(join(data, "runs/sess-parent/evidence.tsv")).includes("file_system.bash\tcmd=ls\n"),
    "subagent evidence did not reach the parent run",
  );
  assert.equal(existsSync(join(data, "runs/sess-child/evidence.tsv")), false, "subagent evidence landed in its own run");
});
