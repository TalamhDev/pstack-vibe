// tests/session-start-json.test.mjs
//
// Bounded exhaustive check of the pstack session-start hook's JSON contract.
//
// Property: for every model sheet S in the scope below, running the hook emits
// stdout that parses as JSON, and hook_specific_output.additional_context
// contains S verbatim.
//
// Why this property: Vibe fails a session_start hook open. A hook that emits
// invalid JSON is dropped with a warning, so the session silently loses the
// model sheet and the model never learns the role table. Nothing crashes, and
// the transcript looks normal.
//
// Why this tool: no verifier runs on POSIX sh plus awk, so this checks the real
// script with generated inputs rather than a hand model of the escaper. The
// search is bounded and exhaustive over the alphabet below, not random.
//
// Scope: every sheet of length 1..3 over ALPHABET, every sheet of length 4 over
// CORE, plus TARGETED. It does not cover sheets longer than 4 characters beyond
// the targeted cases, and it does not cover the hook's sheet-resolution order
// (tests/session-start.test.sh does).
//
// Confirmed able to fail: removing the control-character branch from escape()
// makes 1549 of these sheets report invalid JSON.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const GENERATED = join(ROOT, "generated/vibe");
const HOOK = join(GENERATED, "ai.mistral.vibe/scripts/session-start.sh");
const SOURCE = join(ROOT, "adapters/vibe/scripts/session-start.sh");
const ESCAPER = join(GENERATED, "ai.mistral.vibe/scripts/json.sh");
const ESCAPER_SOURCE = join(ROOT, "adapters/vibe/scripts/json.sh");

// Every character the escaper treats specially, plus a plain ASCII character,
// a two-byte character, and a four-byte character.
const ALPHABET = ["\\", '"', "\t", "\r", "\b", "\f", "\x01", "\x1f", "\x7f", "a", "é", "😀"];
// The characters most likely to interact, searched one level deeper.
const CORE = ["\\", '"', "\t", "\x01", "a", "é"];

const TARGETED = [
  ["empty sheet", ""],
  ["no trailing newline", "role: pstack-deepseek"],
  ["crlf line endings", "role: a\r\nrole2: b\r\n"],
  ["literal backslash-u", 'role: \\u0041 \\\\ \\" end\n'],
  ["triple quote", 'role: """ end\n'],
  ["long line", "x".repeat(100000) + "\n"],
  ["every control character", Array.from({ length: 31 }, (_, i) => String.fromCharCode(i + 1)).join("") + "\n"],
  ["utf8 heavy", "café € 😀 日本語\n"],
];

function* strings(alphabet, maxLen) {
  for (let len = 1; len <= maxLen; len++) {
    const idx = new Array(len).fill(0);
    for (;;) {
      yield idx.map((i) => alphabet[i]).join("");
      let p = len - 1;
      while (p >= 0 && idx[p] === alphabet.length - 1) {
        idx[p] = 0;
        p -= 1;
      }
      if (p < 0) break;
      idx[p] += 1;
    }
  }
}

test("generated hook is byte-identical to its source", () => {
  assert.equal(
    readFileSync(HOOK, "utf8"),
    readFileSync(SOURCE, "utf8"),
    "generated hook differs from adapters/vibe/scripts/session-start.sh; run `npm run generate`",
  );
});

test("generated escaper is byte-identical to its source", () => {
  assert.equal(
    readFileSync(ESCAPER, "utf8"),
    readFileSync(ESCAPER_SOURCE, "utf8"),
    "generated escaper differs from adapters/vibe/scripts/json.sh; run `npm run generate`",
  );
});

test("hook emits valid JSON carrying the sheet verbatim, for every sheet in scope", () => {
  const work = mkdtempSync(join(tmpdir(), "pstack-hook-"));
  const emptyHome = join(work, "home");
  const sheetDir = join(work, "sheet");
  mkdirSync(emptyHome, { recursive: true });
  mkdirSync(join(sheetDir, ".vibe"), { recursive: true });
  const sheetPath = join(sheetDir, ".vibe/pstack-models.md");

  const run = (sheet) => {
    writeFileSync(sheetPath, sheet);
    let stdout;
    try {
      stdout = execFileSync("sh", [HOOK], {
        cwd: sheetDir,
        env: { ...process.env, HOME: emptyHome, PLUGIN_ROOT: GENERATED },
        input: "",
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      return `hook exited ${error.status}: ${String(error.stderr || "").trim()}`;
    }
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (error) {
      return `invalid JSON: ${error.message}`;
    }
    const context = parsed?.hook_specific_output?.additional_context;
    if (typeof context !== "string" || context.length === 0) {
      return "missing hook_specific_output.additional_context";
    }
    if (sheet.length > 0 && !context.includes(sheet)) {
      return "additional_context does not contain the sheet verbatim";
    }
    return null;
  };

  const failures = [];
  let checked = 0;

  const cases = [
    ...TARGETED.map(([name, sheet]) => ({ name, sheet })),
    ...[...strings(ALPHABET, 3)].map((sheet) => ({ name: `alphabet len<=3 ${JSON.stringify(sheet)}`, sheet })),
    ...[...strings(CORE, 4)].map((sheet) => ({ name: `core len<=4 ${JSON.stringify(sheet)}`, sheet })),
  ];

  try {
    for (const { name, sheet } of cases) {
      checked += 1;
      const reason = run(sheet);
      if (reason) failures.push(`${name}: ${reason}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  assert.equal(
    failures.length,
    0,
    `${failures.length} of ${checked} sheets broke the contract:\n  ${failures.slice(0, 20).join("\n  ")}`,
  );
  assert.ok(checked > 3000, `expected a broad search, only ran ${checked} sheets`);
});
