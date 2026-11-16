// tests/chain-audit.test.mjs
//
// The audit as behavior, not as a model of it: every case runs the real
// `chain.sh audit` against real files. The table covers the `when` predicates,
// the `scope` filter, the `field` dispatch, the `forbid` inversion, the
// always-on `opening-a-pr` set, and the `contested` cross-check, because each of
// those is a place where a wrong answer silently allows a skipped step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SCRIPT = join(ROOT, "generated/vibe/ai.mistral.vibe/scripts/chain.sh");

const read = (path) => `file_system.read_file\tpath=${path}`;
const bash = (command) => `file_system.bash\tcmd=${command}`;
const spawn = (name) => `agents.spawn\tname=${name}\tconfig=pstack:poteto-agent`;

const OPENED = [
  read("/p/skills/poteto-mode/SKILL.md"),
  read("/p/skills/poteto-mode/playbooks/feature.md"),
  read("/p/skills/poteto-mode/playbooks/opening-a-pr.md"),
];

const SIGNED = [
  read("/p/skills/architect/SKILL.md"),
  read("/p/skills/arena/SKILL.md"),
  read("/p/skills/interrogate/SKILL.md"),
  read("/p/skills/no-comments/SKILL.md"),
  read("/p/skills/technical-writing/SKILL.md"),
  read("/p/skills/unslop/SKILL.md"),
  bash("git worktree add ../wt"),
  bash('git commit -m "feat(pstack): record"'),
];

const THREE_SPAWNS = [spawn("architect-1"), spawn("architect-2"), spawn("architect-3")];

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

const TITLE = "feat(pstack): record chain evidence";

function audit({ evidence, claim, command, body = BODY }) {
  const work = mkdtempSync(join(tmpdir(), "pstack-audit-"));
  try {
    const evidencePath = join(work, "evidence.tsv");
    const claimPath = join(work, "claim.tsv");
    const bodyPath = join(work, "body.md");
    writeFileSync(evidencePath, evidence.map((line) => `${line}\n`).join(""));
    writeFileSync(claimPath, claim.map((line) => `${line}\n`).join(""));
    if (body !== null) writeFileSync(bodyPath, body);
    const full = command.replace("$BODY", bodyPath);
    try {
      const stdout = execFileSync(
        "sh",
        [SCRIPT, "audit", "--evidence", evidencePath, "--claim", claimPath, "--command", full, "--cwd", work],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      return { status: 0, stdout };
    } catch (error) {
      return { status: error.status, stdout: String(error.stdout ?? "") };
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const ship = (extra = "") => `gh pr create --title "${TITLE}" --body-file $BODY${extra}`;

const CASES = [
  {
    name: "full evidence and a valid body allow",
    evidence: [...OPENED, ...SIGNED, ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: ship(),
    allow: true,
  },
  {
    name: "a missing architect step denies",
    evidence: [...OPENED, ...SIGNED.filter((line) => !line.includes("architect")), ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: ship(),
    denies: ["feature/architect"],
  },
  {
    name: "the opening-a-pr rows apply to a run that never opened the playbook",
    evidence: [
      ...OPENED.filter((line) => !line.includes("playbooks/opening-a-pr.md")),
      ...SIGNED.filter((line) => !line.includes("no-comments")),
      ...THREE_SPAWNS,
    ],
    claim: ["contested no 3/3 three runners"],
    command: ship(),
    denies: ["opening-a-pr/no-comments"],
  },
  {
    name: "the feature rows do not apply to a run that never opened the playbook",
    evidence: [
      ...OPENED.filter((line) => !line.includes("playbooks/feature.md")),
      ...SIGNED.filter((line) => !line.includes("architect")),
      ...THREE_SPAWNS,
    ],
    claim: ["contested no 3/3 three runners"],
    command: ship(),
    allow: true,
  },
  {
    name: "contested no with 2/3 falls back to the expensive path",
    evidence: [...OPENED, ...SIGNED.filter((line) => !line.includes("interrogate")), ...THREE_SPAWNS],
    claim: ["contested no 2/3 two of three"],
    command: ship(),
    denies: ["feature/interrogate"],
  },
  {
    name: "contested no with 3/3 and three spawns allows",
    evidence: [...OPENED, ...SIGNED.filter((line) => !line.includes("interrogate")), ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: ship(),
    allow: true,
  },
  {
    name: "contested no whose m does not match the spawn count falls back",
    evidence: [...OPENED, ...SIGNED.filter((line) => !line.includes("interrogate")), ...THREE_SPAWNS],
    claim: ["contested no 2/2 two runners"],
    command: ship(),
    denies: ["feature/interrogate"],
  },
  {
    name: "an absent contested claim defaults to yes",
    evidence: [...OPENED, ...SIGNED.filter((line) => !line.includes("interrogate")), ...THREE_SPAWNS.slice(0, 2)],
    claim: [],
    command: ship(),
    denies: ["feature/interrogate"],
  },
  {
    name: "the arena row follows the same contested predicate",
    evidence: [...OPENED, ...SIGNED.filter((line) => !line.includes("arena")), ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: ship(),
    allow: true,
  },
  {
    name: "the worktree row needs a spawn, not a waiver",
    evidence: [...OPENED, ...SIGNED.filter((line) => !line.includes("git worktree add")), ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: ship(),
    denies: ["opening-a-pr/worktree"],
  },
  {
    name: "the worktree row is skipped when the run spawned nothing",
    evidence: [
      ...OPENED,
      ...SIGNED.filter((line) => !line.includes("git worktree add")),
    ],
    claim: ["contested yes 0/0 no runners"],
    command: ship(),
    allow: true,
  },
  {
    name: "the forbid inversion catches --draft",
    evidence: [...OPENED, ...SIGNED, ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: ship(" --draft"),
    denies: ["opening-a-pr/not-draft"],
  },
  {
    name: "no --body-file denies on that row alone",
    evidence: [...OPENED, ...SIGNED, ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: `gh pr create --title "${TITLE}"`,
    denies: ["opening-a-pr/body-file"],
    deniesNot: ["opening-a-pr/body-why", "opening-a-pr/title"],
  },
  {
    name: "an unreadable body file denies with the fix",
    evidence: [...OPENED, ...SIGNED, ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: `gh pr create --title "${TITLE}" --body-file /nonexistent/pr-body.md`,
    denies: ["opening-a-pr/body-file", "cannot read"],
  },
  {
    name: "a relative body file resolves against the cwd",
    evidence: [...OPENED, ...SIGNED, ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: `gh pr create --title "${TITLE}" --body-file body.md`,
    allow: true,
  },
  {
    name: "the title field rejects a trailing period",
    evidence: [...OPENED, ...SIGNED, ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: `gh pr create --title "feat(pstack): record chain evidence." --body-file $BODY`,
    denies: ["opening-a-pr/title"],
  },
  {
    name: "the title field accepts a scope-less subject",
    evidence: [...OPENED, ...SIGNED, ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: `gh pr create --title "fix: make doctor fail" --body-file $BODY`,
    allow: true,
  },
  {
    name: "the title field rejects a non-conventional title",
    evidence: [...OPENED, ...SIGNED, ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: `gh pr create --title "Record chain evidence" --body-file $BODY`,
    denies: ["opening-a-pr/title"],
  },
  {
    name: "the body field rejects a missing heading",
    evidence: [...OPENED, ...SIGNED, ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: ship(),
    body: BODY.replace("## Why\n", ""),
    denies: ["opening-a-pr/body-why"],
  },
  {
    name: "an optional row never denies",
    evidence: [...OPENED, ...SIGNED, ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: ship(),
    body: BODY,
    allow: true,
  },
  {
    name: "the commit-scope row needs a Conventional Commits subject",
    evidence: [
      ...OPENED,
      ...SIGNED.filter((line) => !line.includes("git commit")),
      bash('git commit -m "record the chain"'),
      ...THREE_SPAWNS,
    ],
    claim: ["contested no 3/3 three runners"],
    command: ship(),
    denies: ["opening-a-pr/commit-scope"],
  },
  {
    name: "the commit-scope row accepts a scope-less subject",
    evidence: [
      ...OPENED,
      ...SIGNED.filter((line) => !line.includes("git commit")),
      bash('git commit -m "fix: make doctor fail"'),
      ...THREE_SPAWNS,
    ],
    claim: ["contested no 3/3 three runners"],
    command: ship(),
    allow: true,
  },
  {
    name: "a guard call checks only the guard rows",
    evidence: [...OPENED, ...SIGNED, ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: "gh pr checks 42 --watch",
    denies: ["opening-a-pr/no-ci-watch"],
    deniesNot: ["opening-a-pr/body-file", "opening-a-pr/title"],
  },
  {
    name: "a claimed babysit allows the CI watch",
    evidence: [...OPENED, ...SIGNED, ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners", "babysit yes"],
    command: "gh pr checks 42 --watch",
    allow: true,
  },
  {
    name: "install.sh update is forbidden outright",
    evidence: [...OPENED, ...SIGNED, ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: "./scripts/install.sh update",
    denies: ["session/install-update"],
  },
  {
    name: "a grep of the README is not an install.sh update",
    evidence: [...OPENED, ...SIGNED, ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: 'grep -n "install.sh update" README.md',
    allow: true,
  },
  {
    name: "gh pr create --help is not a ship call",
    evidence: [],
    claim: [],
    command: "gh pr create --help",
    allow: true,
  },
  {
    name: "gh pr create --dry-run is not a ship call",
    evidence: [],
    claim: [],
    command: "gh pr create --dry-run --title x",
    allow: true,
  },
  {
    name: "a gh api read is not a ship call",
    evidence: [],
    claim: [],
    command: "gh api repos/o/r/pulls/12",
    allow: true,
  },
  {
    name: "a gh api POST to /pulls is a ship call",
    evidence: [...OPENED, ...SIGNED, ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: "gh api repos/o/r/pulls -f title=x",
    denies: ["opening-a-pr/body-file"],
  },
  {
    name: "gh run watch is a guard call",
    evidence: [...OPENED, ...SIGNED, ...THREE_SPAWNS],
    claim: ["contested no 3/3 three runners"],
    command: "gh run watch",
    denies: ["opening-a-pr/no-ci-watch"],
  },
  {
    name: "a command the chain does not classify is not audited",
    evidence: [],
    claim: [],
    command: "ls -la",
    allow: true,
  },
];

for (const testCase of CASES) {
  test(testCase.name, () => {
    const { status, stdout } = audit(testCase);
    if (testCase.allow) {
      assert.equal(status, 0, `expected an allow, got:\n${stdout}`);
      assert.equal(stdout, "", "an allow prints nothing");
      return;
    }
    assert.equal(status, 1, `expected a deny, got status ${status}:\n${stdout}`);
    for (const needle of testCase.denies ?? []) {
      assert.ok(stdout.includes(needle), `deny does not name ${needle}:\n${stdout}`);
    }
    for (const needle of testCase.deniesNot ?? []) {
      assert.ok(!stdout.includes(needle), `deny names ${needle}:\n${stdout}`);
    }
  });
}

test("a malformed manifest is an internal error, not a deny", () => {
  const work = mkdtempSync(join(tmpdir(), "pstack-audit-bad-"));
  try {
    const plugin = join(work, "plugin");
    const evidencePath = join(work, "evidence.tsv");
    writeFileSync(evidencePath, "");
    mkdirSync(join(plugin, "ai.mistral.vibe"), { recursive: true });
    writeFileSync(join(plugin, "ai.mistral.vibe/chain.tsv"), "playbook\tstep\twhen\nfeature\tarchitect\talways\n");
    let status = 0;
    let stdout = "";
    try {
      stdout = execFileSync(
        "sh",
        [SCRIPT, "audit", "--evidence", evidencePath, "--claim", evidencePath, "--command", ship()],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PLUGIN_ROOT: plugin } },
      );
    } catch (error) {
      status = error.status;
      stdout = String(error.stdout ?? "");
    }
    assert.notEqual(status, 0, "a malformed manifest must not exit 0");
    assert.equal(stdout, "", "a malformed manifest must not print a deny");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("a row outside its closed set is an internal error, not a deny", () => {
  const work = mkdtempSync(join(tmpdir(), "pstack-audit-scope-"));
  try {
    const plugin = join(work, "plugin");
    const evidencePath = join(work, "evidence.tsv");
    writeFileSync(evidencePath, "");
    mkdirSync(join(plugin, "ai.mistral.vibe"), { recursive: true });
    writeFileSync(
      join(plugin, "ai.mistral.vibe/chain.tsv"),
      "playbook\tstep\tscope\twhen\tfield\tkind\tmatch\treason\n" +
        "session\tinstall-update\tsometimes\talways\tcommand\tforbid\tx\ty\n",
    );
    let status = 0;
    let stdout = "";
    try {
      stdout = execFileSync(
        "sh",
        [SCRIPT, "audit", "--evidence", evidencePath, "--claim", evidencePath, "--command", "./scripts/install.sh update"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PLUGIN_ROOT: plugin } },
      );
    } catch (error) {
      status = error.status;
      stdout = String(error.stdout ?? "");
    }
    assert.notEqual(status, 0, "an unknown scope must not exit 0");
    assert.equal(stdout, "", "an unknown scope must not print a deny");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
