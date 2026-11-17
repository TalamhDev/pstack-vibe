// The gate as behavior: every case runs the real `chain.mjs gate` against real
// files.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SCRIPT = join(ROOT, "generated/vibe/ai.mistral.vibe/scripts/chain.mjs");
const PLUGIN = join(ROOT, "generated/vibe");

const tmp = mkdtempSync(join(tmpdir(), "pstack-gate-"));
const data = join(tmp, "data");
after(() => rmSync(tmp, { recursive: true, force: true }));

function run(args, input = "", env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PLUGIN_DATA: data, PLUGIN_ROOT: PLUGIN, ...env },
    });
    return { status: 0, stdout };
  } catch (error) {
    return {
      status: error.status,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? ""),
    };
  }
}

function gatePayload(session, command, cwd = tmp) {
  return JSON.stringify({
    session_id: session,
    transcript_path: "/tmp/t",
    cwd,
    parent_session_id: null,
    hook_event_name: "pre_tool",
    tool_name: "file_system.bash",
    tool_call_id: "call_gate",
    tool_input: { command, timeout: 120 },
  });
}

function armPayload(session, prompt) {
  return JSON.stringify({
    session_id: session,
    transcript_path: "/tmp/t",
    cwd: tmp,
    parent_session_id: null,
    hook_event_name: "pre_agent",
    agent_name: "accept-edits",
    turn_id: "turn-1",
    prompt,
  });
}

const gate = (session, command, cwd = tmp) => run(["gate"], gatePayload(session, command, cwd));

function runDir(name) {
  mkdirSync(join(data, "runs", name), { recursive: true });
  writeFileSync(join(data, "runs", name, "ready"), "");
  writeFileSync(join(data, "runs", name, "armed"), "");
}

const read = (path) => `file_system.read_file\tpath=${path}`;

const EVIDENCE_FULL = [
  read("/p/skills/poteto-mode/SKILL.md"),
  read("/p/skills/poteto-mode/playbooks/feature.md"),
  read("/p/skills/poteto-mode/playbooks/opening-a-pr.md"),
  read("/p/skills/architect/SKILL.md"),
  read("/p/skills/arena/SKILL.md"),
  read("/p/skills/interrogate/SKILL.md"),
  read("/p/skills/no-comments/SKILL.md"),
  read("/p/skills/technical-writing/SKILL.md"),
  read("/p/skills/unslop/SKILL.md"),
  "file_system.bash\tcmd=git worktree add ../wt",
  'file_system.bash\tcmd=git commit -m "feat(pstack): record"',
  "agents.spawn\tname=architect-1\tconfig=pstack:poteto-agent",
  "agents.spawn\tname=architect-2\tconfig=pstack:poteto-agent",
  "agents.spawn\tname=architect-3\tconfig=pstack:poteto-agent",
];

const without = (lines, ...needles) =>
  lines.filter((line) => !needles.some((needle) => line.includes(needle)));

const tsv = (lines) => `${lines.join("\n")}\n`;

const EVIDENCE_NO_INTERROGATE = without(EVIDENCE_FULL, "interrogate");
const EVIDENCE_TWOS = without(EVIDENCE_NO_INTERROGATE, "architect-3");
const EVIDENCE_NO_SUBAGENTS = without(EVIDENCE_FULL, "git worktree add", "agents.spawn");
const EVIDENCE_NO_OPENING = without(EVIDENCE_FULL, "playbooks/opening-a-pr.md", "no-comments");

const BODY = [
  "## Why",
  "The chain was skippable.",
  "",
  "## What changed",
  "- a thing",
  "",
  "## Scope",
  "- covers this",
  "",
  "## Blast Radius",
  "- low",
  "",
  "## Verification",
  "- npm test",
  "",
].join("\n");

const body = join(tmp, "body.md");
writeFileSync(body, BODY);

const TITLE = "feat(pstack): record chain evidence";
const ship = `gh pr create --title "${TITLE}" --body-file ${body}`;

test("a poteto-mode prompt arms the gate", () => {
  mkdirSync(join(data, "runs/sess-arm"), { recursive: true });
  run(["arm"], armPayload("sess-arm", "/pstack:poteto-mode do a thing"));
  assert.ok(existsSync(join(data, "runs/sess-arm/armed")), "a poteto-mode prompt did not arm the gate");
});

test("an unrelated prompt does not arm the gate", () => {
  mkdirSync(join(data, "runs/sess-noarm"), { recursive: true });
  run(["arm"], armPayload("sess-noarm", "fix the doctor"));
  assert.equal(existsSync(join(data, "runs/sess-noarm/armed")), false, "an unrelated prompt armed the gate");
});

test("editing poteto-mode/SKILL.md does not arm the gate", () => {
  mkdirSync(join(data, "runs/sess-edit"), { recursive: true });
  writeFileSync(
    join(data, "runs/sess-edit/evidence.tsv"),
    tsv([read("/p/skills/poteto-mode/SKILL.md"), "file_system.edit\tpath=/p/skills/poteto-mode/SKILL.md"]),
  );
  const { status, stdout } = gate("sess-edit", "gh pr create --title x");
  assert.equal(status, 0, "an unarmed session was blocked");
  assert.equal(stdout, "", `editing the skill file armed the gate: ${stdout}`);
});

test("unarmed session allows", () => {
  runDir("sess-unarmed");
  rmSync(join(data, "runs/sess-unarmed/armed"));
  writeFileSync(join(data, "runs/sess-unarmed/evidence.tsv"), tsv(["file_system.bash\tcmd=ls"]));
  const { status, stdout } = gate("sess-unarmed", "gh pr create --title x");
  assert.equal(status, 0, "unarmed session was blocked");
  assert.equal(stdout, "", "unarmed session emitted output");
});

test("armed with no architect read denies naming feature/architect", () => {
  runDir("sess-bare");
  writeFileSync(join(data, "runs/sess-bare/evidence.tsv"), tsv(without(EVIDENCE_FULL, "architect")));
  const { status, stdout } = gate("sess-bare", ship);
  assert.equal(status, 0, "gate exited non-zero on a deny");
  assert.ok(stdout.startsWith('{"decision":"deny"'), `deny is not a JSON decision: ${stdout}`);
  assert.ok(stdout.includes("feature/architect"), `deny does not name feature/architect: ${stdout}`);
});

test("full evidence and a valid body allow", () => {
  runDir("sess-ok");
  writeFileSync(join(data, "runs/sess-ok/evidence.tsv"), tsv(EVIDENCE_FULL));
  writeFileSync(join(data, "runs/sess-ok/claim.tsv"), "contested no 3/3 three runners\n");
  const { status, stdout } = gate("sess-ok", ship);
  assert.equal(status, 0, "full evidence was blocked");
  assert.equal(stdout, "", `full evidence emitted output: ${stdout}`);
});

test("gh pr create --help allows", () => {
  const { status, stdout } = gate("sess-ok", "gh pr create --help");
  assert.equal(status, 0, "gh pr create --help was blocked");
  assert.equal(stdout, "", `gh pr create --help emitted output: ${stdout}`);
});

test("gh api reads allow, a POST to /pulls is a ship call", () => {
  const readCall = gate("sess-ok", "gh api repos/o/r/pulls/12");
  assert.equal(readCall.status, 0, "a gh api read was blocked");
  assert.equal(readCall.stdout, "", `a gh api read emitted output: ${readCall.stdout}`);

  const postCall = gate("sess-ok", "gh api repos/o/r/pulls -f title=x");
  assert.equal(postCall.status, 0, "gate exited non-zero on a deny");
  assert.ok(
    postCall.stdout.includes("opening-a-pr/body-file"),
    `a gh api POST was not audited as a ship call: ${postCall.stdout}`,
  );
});

test("gh run watch denies", () => {
  const { status, stdout } = gate("sess-ok", "gh run watch");
  assert.equal(status, 0, "gate exited non-zero on a deny");
  assert.ok(stdout.includes("opening-a-pr/no-ci-watch"), `deny does not name opening-a-pr/no-ci-watch: ${stdout}`);
});

test("a README grep allows, ./bin/pstack-vibe.mjs update denies", () => {
  const grep = gate("sess-ok", 'grep -n "pstack-vibe update" README.md');
  assert.equal(grep.status, 0, "a README grep was blocked");
  assert.equal(grep.stdout, "", `a README grep emitted output: ${grep.stdout}`);

  const update = gate("sess-ok", "./bin/pstack-vibe.mjs update");
  assert.equal(update.status, 0, "gate exited non-zero on a deny");
  assert.ok(
    update.stdout.includes("session/install-update"),
    `deny does not name session/install-update: ${update.stdout}`,
  );
});

test("a scope-less title allows", () => {
  const { status, stdout } = gate("sess-ok", `gh pr create --title "fix: make doctor fail" --body-file ${body}`);
  assert.equal(status, 0, "a scope-less title was blocked");
  assert.equal(stdout, "", `a scope-less title emitted output: ${stdout}`);
});

test("the body headings are checked per line", () => {
  const complete = gate("sess-ok", ship);
  assert.equal(complete.status, 0, "a complete body was blocked");
  assert.equal(complete.stdout, "", `a complete body emitted output: ${complete.stdout}`);

  const noWhy = join(tmp, "body-nowhy.md");
  writeFileSync(noWhy, BODY.split("\n").filter((line) => line !== "## Why").join("\n"));
  const { status, stdout } = gate("sess-ok", `gh pr create --title "${TITLE}" --body-file ${noWhy}`);
  assert.equal(status, 0, "gate exited non-zero on a deny");
  assert.ok(stdout.includes("opening-a-pr/body-why"), `deny does not name opening-a-pr/body-why: ${stdout}`);
});

test("--draft denies naming opening-a-pr/not-draft", () => {
  const { status, stdout } = gate("sess-ok", `gh pr create --draft --title "${TITLE}" --body-file ${body}`);
  assert.equal(status, 0, "gate exited non-zero on a deny");
  assert.ok(stdout.includes("opening-a-pr/not-draft"), `deny does not name opening-a-pr/not-draft: ${stdout}`);
});

test("no --body-file denies naming only opening-a-pr/body-file", () => {
  const { status, stdout } = gate("sess-ok", `gh pr create --title "${TITLE}"`);
  assert.equal(status, 0, "gate exited non-zero on a deny");
  assert.ok(stdout.includes("opening-a-pr/body-file"), `deny does not name opening-a-pr/body-file: ${stdout}`);
  assert.ok(
    !stdout.includes("opening-a-pr/body-why") && !stdout.includes("opening-a-pr/title"),
    `deny named more than body-file: ${stdout}`,
  );
});

test("a relative --body-file resolves against the payload cwd", () => {
  mkdirSync(join(tmp, "session/.vibe"), { recursive: true });
  writeFileSync(join(tmp, "session/.vibe/pr-body.md"), BODY);
  const { status, stdout } = gate(
    "sess-ok",
    `gh pr create --title "${TITLE}" --body-file .vibe/pr-body.md`,
    join(tmp, "session"),
  );
  assert.equal(status, 0, "a relative --body-file was blocked");
  assert.equal(stdout, "", `a relative --body-file emitted output: ${stdout}`);
});

test("gh pr checks --watch follows the babysit claim, and a guard call is never told to pass --body-file", () => {
  const claim = join(data, "runs/sess-ok/claim.tsv");
  const watch = gate("sess-ok", "gh pr checks 42 --watch");
  assert.equal(watch.status, 0, "gate exited non-zero on a deny");
  assert.ok(
    watch.stdout.includes("opening-a-pr/no-ci-watch"),
    `deny does not name opening-a-pr/no-ci-watch: ${watch.stdout}`,
  );
  assert.ok(
    !watch.stdout.includes("opening-a-pr/body-file"),
    `a guard call was told to pass --body-file: ${watch.stdout}`,
  );

  writeFileSync(claim, "contested no 3/3 three runners\nbabysit yes\n");
  const claimed = gate("sess-ok", "gh pr checks 42 --watch");
  assert.equal(claimed.status, 0, "a claimed babysit was blocked");
  assert.equal(claimed.stdout, "", `a claimed babysit emitted output: ${claimed.stdout}`);
  writeFileSync(claim, "contested no 3/3 three runners\n");
});

test("contested no 2/3 denies naming feature/interrogate", () => {
  runDir("sess-23");
  writeFileSync(join(data, "runs/sess-23/evidence.tsv"), tsv(EVIDENCE_NO_INTERROGATE));
  writeFileSync(join(data, "runs/sess-23/claim.tsv"), "contested no 2/3 two of three\n");
  const { status, stdout } = gate("sess-23", ship);
  assert.equal(status, 0, "gate exited non-zero on a deny");
  assert.ok(stdout.includes("feature/interrogate"), `deny does not name feature/interrogate: ${stdout}`);
});

test("contested no 3/3 with three spawns allows", () => {
  runDir("sess-33");
  writeFileSync(join(data, "runs/sess-33/evidence.tsv"), tsv(EVIDENCE_NO_INTERROGATE));
  writeFileSync(join(data, "runs/sess-33/claim.tsv"), "contested no 3/3 three runners\n");
  const { status, stdout } = gate("sess-33", ship);
  assert.equal(status, 0, "contested no 3/3 was blocked");
  assert.equal(stdout, "", `contested no 3/3 emitted output: ${stdout}`);
});

test("absent contested with two spawns denies", () => {
  runDir("sess-absent");
  writeFileSync(join(data, "runs/sess-absent/evidence.tsv"), tsv(EVIDENCE_TWOS));
  const { status, stdout } = gate("sess-absent", ship);
  assert.equal(status, 0, "gate exited non-zero on a deny");
  assert.ok(stdout.includes("feature/interrogate"), `deny does not name feature/interrogate: ${stdout}`);
});

test("worktree applies only when the evidence holds a spawn", () => {
  runDir("sess-nosub");
  writeFileSync(join(data, "runs/sess-nosub/evidence.tsv"), tsv(EVIDENCE_NO_SUBAGENTS));
  writeFileSync(join(data, "runs/sess-nosub/claim.tsv"), "contested yes 0/0 no runners\n");
  const { status, stdout } = gate("sess-nosub", ship);
  assert.equal(status, 0, "a run with no subagents was blocked");
  assert.equal(stdout, "", `a run with no subagents emitted output: ${stdout}`);
});

test("a run that never read opening-a-pr.md is still denied on its rows", () => {
  runDir("sess-nopening");
  writeFileSync(join(data, "runs/sess-nopening/evidence.tsv"), tsv(EVIDENCE_NO_OPENING));
  writeFileSync(join(data, "runs/sess-nopening/claim.tsv"), "contested no 3/3 three runners\n");
  const { status, stdout } = gate("sess-nopening", ship);
  assert.equal(status, 0, "gate exited non-zero on a deny");
  assert.ok(stdout.includes("opening-a-pr/no-comments"), `deny does not name opening-a-pr/no-comments: ${stdout}`);
});

test("a malformed manifest exits non-zero", () => {
  const plugin = join(tmp, "badplugin");
  mkdirSync(join(plugin, "ai.mistral.vibe"), { recursive: true });
  writeFileSync(join(plugin, "ai.mistral.vibe/chain.tsv"), "playbook\tstep\twhen\nfeature\tarchitect\talways\n");
  const { status, stdout } = run(["gate"], gatePayload("sess-ok", ship), { PLUGIN_ROOT: plugin });
  assert.notEqual(status, 0, "a malformed manifest exited 0");
  assert.equal(stdout, "", `a malformed manifest emitted a decision: ${stdout}`);
});

test("a command that mentions a gated string is not gated", () => {
  runDir("sess-thin");
  writeFileSync(join(data, "runs/sess-thin/evidence.tsv"), tsv([read("/p/skills/poteto-mode/SKILL.md")]));
  for (const command of ["git log --grep='gh pr create'", "gh pr create --help", "gh api repos/o/r/pulls/12"]) {
    const { status, stdout } = gate("sess-ok", command);
    assert.equal(status, 0, `a mention of a gated string was blocked: ${command}`);
    assert.equal(stdout, "", `a mention of a gated string emitted output: ${command} -> ${stdout}`);
  }
  const grep = gate("sess-thin", "grep -n 'pstack-vibe update' README.md");
  assert.equal(grep.status, 0, "a README grep was blocked");
  assert.equal(grep.stdout, "", `a README grep emitted output: ${grep.stdout}`);
});

test("the anchored arms still catch the real call", () => {
  for (const command of ["gh pr create --title x", "cd /repo && gh pr create --title x"]) {
    const { status, stdout } = gate("sess-ok", command);
    assert.equal(status, 0, `gate exited non-zero on a deny: ${command}`);
    assert.ok(stdout.includes("opening-a-pr/body-file"), `not audited as a ship call: ${command} -> ${stdout}`);
  }
  for (const command of ["gh run watch 1", "gh pr checks 42 --watch"]) {
    const { status, stdout } = gate("sess-ok", command);
    assert.equal(status, 0, `gate exited non-zero on a deny: ${command}`);
    assert.ok(stdout.includes("opening-a-pr/no-ci-watch"), `not audited as a guard call: ${command} -> ${stdout}`);
  }
  for (const command of [
    "./bin/pstack-vibe.mjs update",
    "node bin/pstack-vibe.mjs update",
    "npx pstack-vibe update",
    "npx -y pstack-vibe update",
    "npm exec pstack-vibe update",
    "pstack-vibe update",
    "npx pstack-vibe install --force",
  ]) {
    const { status, stdout } = gate("sess-ok", command);
    assert.equal(status, 0, `gate exited non-zero on a deny: ${command}`);
    assert.ok(stdout.includes("session/install-update"), `not audited as an install update: ${command} -> ${stdout}`);
  }
  const outside = gate("sess-ok", "npx pstack-vibe install && echo --force");
  assert.equal(outside.status, 0, "gate exited non-zero on a deny");
  assert.equal(outside.stdout, "", `a --force outside the install call was gated: ${outside.stdout}`);
});

test("a guard call is judged only on the command it is about to run", () => {
  const { status, stdout } = gate("sess-thin", "gh run watch 12345");
  assert.equal(status, 0, "gate exited non-zero on a deny");
  assert.ok(stdout.includes("opening-a-pr/no-ci-watch"), `deny does not name opening-a-pr/no-ci-watch: ${stdout}`);
  for (const row of [
    "opening-a-pr/worktree",
    "opening-a-pr/commits",
    "opening-a-pr/commit-scope",
    "opening-a-pr/no-comments",
    "opening-a-pr/technical-writing",
    "opening-a-pr/unslop",
    "feature/architect",
  ]) {
    assert.ok(!stdout.includes(row), `a guard call was denied on the ship row ${row}: ${stdout}`);
  }

  writeFileSync(join(data, "runs/sess-thin/claim.tsv"), "babysit yes\n");
  const claimed = gate("sess-thin", "gh pr checks 42 --watch");
  assert.equal(claimed.status, 0, "a claimed babysit was blocked");
  assert.equal(claimed.stdout, "", `a claimed babysit emitted output: ${claimed.stdout}`);
});

test("the script parses as ESM", () => {
  execFileSync(process.execPath, ["--check", SCRIPT], { stdio: ["ignore", "pipe", "pipe"] });
});
