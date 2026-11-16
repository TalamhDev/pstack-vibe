// tests/chain-manifest.test.mjs
//
// The manifest is the requirement list the gate enforces, and it ships in the
// plugin's pinned read-only copy. A row the audit cannot read is a step that
// silently stops being required, so the shape is checked here rather than
// discovered at the first `gh pr create`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = join(root, "adapters/vibe/chain.tsv");
const playbooksDir = join(root, "vendor/pstack/skills/poteto-mode/playbooks");

const COLUMNS = ["playbook", "step", "scope", "when", "field", "kind", "match", "reason"];
const SCOPE = new Set(["ship", "guard"]);
const WHEN = new Set(["always", "contested", "no-babysit", "subagents", "optional"]);
const FIELD = new Set(["evidence", "title", "body", "command"]);
const KIND = new Set(["require", "forbid"]);

function readManifest() {
  const lines = readFileSync(manifestPath, "utf8").split("\n");
  const rows = [];
  let header = null;
  for (const line of lines) {
    if (line.startsWith("#") || line.trim() === "") continue;
    const cells = line.split("\t");
    if (!header) {
      header = cells;
      continue;
    }
    const row = {};
    for (const [index, name] of header.entries()) row[name] = cells[index] ?? "";
    rows.push(row);
  }
  return { header, rows };
}

test("the header names the eight columns in order", () => {
  const { header } = readManifest();
  assert.deepEqual(header, COLUMNS);
});

test("every row has eight non-empty cells", () => {
  const { rows } = readManifest();
  assert.ok(rows.length > 0, "the manifest has no rows");
  for (const row of rows) {
    for (const column of COLUMNS) {
      assert.ok(
        typeof row[column] === "string" && row[column].length > 0,
        `${row.playbook}/${row.step} has an empty ${column}`,
      );
    }
  }
});

test("every playbook is session or a real playbook file", () => {
  const { rows } = readManifest();
  for (const row of rows) {
    if (row.playbook === "session") continue;
    assert.ok(
      existsSync(join(playbooksDir, `${row.playbook}.md`)),
      `${row.step} names a playbook that does not exist: ${row.playbook}`,
    );
  }
});

test("scope, when, field, and kind are each in their closed set", () => {
  const { rows } = readManifest();
  for (const row of rows) {
    assert.ok(SCOPE.has(row.scope), `${row.playbook}/${row.step} has scope=${row.scope}`);
    assert.ok(WHEN.has(row.when), `${row.playbook}/${row.step} has when=${row.when}`);
    assert.ok(FIELD.has(row.field), `${row.playbook}/${row.step} has field=${row.field}`);
    assert.ok(KIND.has(row.kind), `${row.playbook}/${row.step} has kind=${row.kind}`);
  }
});

test("scope is ship or guard, with no third value", () => {
  const { rows } = readManifest();
  assert.deepEqual([...SCOPE].sort(), ["guard", "ship"]);
  for (const row of rows) {
    assert.ok(
      row.scope === "ship" || row.scope === "guard",
      `${row.playbook}/${row.step} has scope=${row.scope}`,
    );
  }
  assert.doesNotMatch(readFileSync(manifestPath, "utf8"), /\tboth\t/);
});

test("an evidence row is ship, so a guard call is not judged on it", () => {
  const { rows } = readManifest();
  for (const row of rows) {
    if (row.field !== "evidence") continue;
    assert.equal(row.scope, "ship", `${row.playbook}/${row.step} is an evidence row that is not ship`);
  }
  const guard = rows.filter((row) => row.scope === "guard").map((row) => `${row.playbook}/${row.step}`);
  assert.deepEqual(guard.sort(), ["opening-a-pr/no-ci-watch", "session/install-update"]);
});

test("every match compiles as a regular expression", () => {
  const { rows } = readManifest();
  for (const row of rows) {
    assert.doesNotThrow(
      () => new RegExp(row.match),
      `${row.playbook}/${row.step} has an uncompilable match: ${row.match}`,
    );
  }
});

test("no playbook and step pair repeats", () => {
  const { rows } = readManifest();
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.playbook}/${row.step}`;
    assert.ok(!seen.has(key), `duplicate row: ${key}`);
    seen.add(key);
  }
});

test("there is no waiver row", () => {
  const { rows } = readManifest();
  for (const row of rows) {
    assert.notEqual(row.kind, "waive", `${row.playbook}/${row.step} is a waiver`);
    assert.notEqual(row.when, "waived", `${row.playbook}/${row.step} is waived`);
  }
  assert.doesNotMatch(readFileSync(manifestPath, "utf8"), /^waive\t/m);
});

test("the unchecked steps are listed as comments, not rows", () => {
  const text = readFileSync(manifestPath, "utf8");
  for (const step of ["first-message-goal", "fix-round-fresh", "throughput-checkpoint", "verify-surface"]) {
    assert.match(text, new RegExp(`^# unchecked\\t${step}\\t`, "m"));
  }
});
