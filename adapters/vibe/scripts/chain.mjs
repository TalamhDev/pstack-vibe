import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { isFile, readPayload, stringField } from "./hook-payload.mjs";

/** @typedef {"none" | "ship" | "guard"} Mode */
/** @typedef {"ship" | "guard"} Scope */
/** @typedef {"always" | "contested" | "no-babysit" | "subagents" | "optional"} When */
/** @typedef {"evidence" | "title" | "body" | "command"} Field */
/** @typedef {"require" | "forbid"} Kind */

/**
 * @typedef {object} ChainRow
 * @property {string} playbook
 * @property {string} step
 * @property {Scope} scope
 * @property {When} when
 * @property {Field} field
 * @property {Kind} kind
 * @property {RegExp} match
 * @property {string} reason
 */

/**
 * @typedef {object} Snapshot
 * @property {Mode} mode
 * @property {readonly string[]} evidence
 * @property {boolean} contested
 * @property {string} babysit
 * @property {boolean} subagents
 * @property {ReadonlySet<string>} playbooks
 * @property {string} command
 * @property {string} title
 * @property {string} bodyFile
 * @property {boolean} bodyOk
 * @property {readonly string[]} body
 */

/** A malformed manifest is an internal error, never a decision. */
class ChainError extends Error {}

function rootSession(payload) {
  const parent = stringField(payload, "parent_session_id");
  return parent === "" ? stringField(payload, "session_id") : parent;
}

function homeDir(env) {
  return env.HOME || homedir();
}

function pluginData(env) {
  if (env.PLUGIN_DATA) return env.PLUGIN_DATA;
  if (env.VIBE_HOME) return join(env.VIBE_HOME, "plugin-data/pstack");
  return join(homeDir(env), ".vibe/plugin-data/pstack");
}

function manifestPath(env) {
  if (env.PLUGIN_ROOT) return join(env.PLUGIN_ROOT, "ai.mistral.vibe/chain.tsv");
  return join(import.meta.dirname, "..", "chain.tsv");
}

function evidenceLines(text) {
  const parts = text.split(/\r?\n/);
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function readLines(path) {
  if (path === "") return [];
  try {
    return evidenceLines(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

function readManifest(env) {
  try {
    return readFileSync(manifestPath(env), "utf8");
  } catch {
    return "";
  }
}

/**
 * Every arm is anchored at a command boundary, so a command that merely mentions
 * one of these strings (`git log --grep='gh pr create'`) is not gated. The `m`
 * flag is load-bearing: without it `^` matches only at index 0, so a multi-line
 * command escapes on its second line.
 */
const ARMS = [
  {
    mode: "none",
    matches: (command) => /(^|[;&|] )(gh|origin) pr create.*--(help|dry-run)/m.test(command),
  },
  {
    mode: "ship",
    matches: (command) => /(^|[;&|] )(gh|origin) pr create/m.test(command),
  },
  {
    mode: "ship",
    matches: (command) =>
      /(^|[;&|] )gh api[^;&|]*\/pulls/m.test(command) &&
      /(-f |--field |--method POST|-X POST)/.test(command),
  },
  {
    mode: "guard",
    matches: (command) => /(^|[;&|] )(gh|origin) (pr checks[^;&|]*--watch|run watch)/m.test(command),
  },
  {
    mode: "guard",
    matches: (command) =>
      /(^|[;&|] )(npx( -y)? |npm exec )?(node )?([^ ]*\/)?pstack-vibe(\.mjs)? (update|install[^;&|]*--force)/m.test(
        command,
      ),
  },
];

/**
 * @param {string} command
 * @returns {Mode}
 */
export function classify(command) {
  return ARMS.find((arm) => arm.matches(command))?.mode ?? "none";
}

const FLAT_LIMIT = 1024;

function flat(value) {
  return value.replace(/[\t\r\n]/g, " ").slice(0, FLAT_LIMIT);
}

function pathOf(input) {
  const path = stringField(input, "file_path");
  return path === "" ? stringField(input, "path") : path;
}

const EVIDENCE_FIELDS = {
  "file_system.bash": (input) => `\tcmd=${flat(stringField(input, "command"))}`,
  "process.start": (input) => `\tcmd=${flat(stringField(input, "command"))}`,
  "file_system.read_file": (input) => `\tpath=${flat(pathOf(input))}`,
  "file_system.write_file": (input) => `\tpath=${flat(pathOf(input))}`,
  "file_system.edit": (input) => `\tpath=${flat(pathOf(input))}`,
  "agents.spawn": (input) =>
    `\tname=${flat(stringField(input, "name"))}\tconfig=${flat(stringField(input, "config_name"))}`,
  "skill.read": (input) => `\tname=${flat(stringField(input, "name"))}`,
};

/**
 * One structured line per call, so the manifest never sees JSON. `null` when the
 * payload names no tool.
 *
 * @param {object} payload
 * @returns {string | null}
 */
export function evidenceLine(payload) {
  const tool = stringField(payload, "tool_name");
  if (tool === "") return null;
  if (!Object.hasOwn(EVIDENCE_FIELDS, tool)) return tool;
  return `${tool}${EVIDENCE_FIELDS[tool](payload.tool_input)}`;
}

const COLUMNS = ["playbook", "step", "scope", "when", "field", "kind", "match", "reason"];

const SCOPE = {
  ship: (mode) => mode === "ship",
  guard: (mode) => mode === "guard",
};

const WHEN = {
  always: () => true,
  contested: (snap) => snap.contested,
  "no-babysit": (snap) => snap.babysit === "no",
  subagents: (snap) => snap.subagents,
  optional: () => false,
};

/** `null` means the row is not judged; `[]` means it was read and is empty. */
const FIELD = {
  evidence: (snap) => snap.evidence,
  title: (snap) => (snap.title === "" ? [] : [snap.title]),
  body: (snap) => (snap.bodyOk ? snap.body : null),
  command: (snap) => [snap.command],
};

const FAILS_ON_HIT = { require: false, forbid: true };

function closed(registry, what, value) {
  if (!Object.hasOwn(registry, value)) {
    throw new ChainError(`chain.tsv: ${what} is not one of its values: ${value}`);
  }
  return value;
}

function compileMatch(source) {
  try {
    return new RegExp(source);
  } catch {
    throw new ChainError(`chain.tsv: match is not a valid regular expression: ${source}`);
  }
}

function compileRow(cells, columns) {
  const cell = (name) => cells[columns.get(name)];
  return {
    playbook: cell("playbook"),
    step: cell("step"),
    scope: closed(SCOPE, "scope", cell("scope")),
    when: closed(WHEN, "when", cell("when")),
    field: closed(FIELD, "field", cell("field")),
    kind: closed(FAILS_ON_HIT, "kind", cell("kind")),
    match: compileMatch(cell("match")),
    reason: cell("reason"),
  };
}

/**
 * The whole table is compiled before any row is judged, so a bad manifest never
 * emits a partial decision.
 *
 * @param {string} text
 * @returns {ChainRow[]}
 */
export function parseChain(text) {
  const rows = [];
  let columns = null;
  for (const line of evidenceLines(text)) {
    if (line.startsWith("#") || /^\s*$/.test(line)) continue;
    const cells = line.split("\t");
    if (columns === null) {
      columns = new Map(cells.map((name, index) => [name, index]));
      for (const name of COLUMNS) {
        if (!columns.has(name)) throw new ChainError(`chain.tsv has no ${name} column`);
      }
      continue;
    }
    if (cells.length < COLUMNS.length) {
      throw new ChainError(
        `chain.tsv row ${rows.length + 1} has ${cells.length} cells, not ${COLUMNS.length}`,
      );
    }
    rows.push(compileRow(cells, columns));
  }
  if (columns === null) throw new ChainError("chain.tsv has no header row");
  return rows;
}

const SPAWN = /^agents\.spawn\t/;
const ARCHITECT_SPAWN = /name=architect-/;
const READ_FILE = /^file_system\.read_file\t/;
const PLAYBOOK = /playbooks\/[A-Za-z0-9._-]+\.md/g;

/**
 * @param {string} command
 * @param {string} flag
 * @returns {string}
 */
export function flagValue(command, flag) {
  const at = command.indexOf(flag);
  if (at === -1) return "";
  const rest = command.slice(at + flag.length).replace(/^[\t\n\v\f\r ]*=?[\t\n\v\f\r ]*/, "");
  if (rest === "") return "";
  const quote = rest[0];
  if (quote === '"' || quote === "'") {
    const body = rest.slice(1);
    const end = body.indexOf(quote);
    return end === -1 ? body : body.slice(0, end);
  }
  const space = rest.search(/[\t\n\v\f\r ]/);
  return space === -1 ? rest : rest.slice(0, space);
}

/** The hook runs in the plugin root, so a relative path resolves against the payload cwd. */
export function resolveBodyFile(value, cwd) {
  if (value === "" || isAbsolute(value) || cwd === "") return value;
  return resolve(cwd, value);
}

function readBody(path) {
  try {
    return evidenceLines(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function claimFacts(claim) {
  let value = "";
  let fraction = "";
  let babysit = "no";
  for (const line of claim) {
    const cells = line.split(" ");
    if (cells[0] === "contested") {
      value = cells[1] ?? "";
      fraction = cells[2] ?? "";
    } else if (cells[0] === "babysit") {
      babysit = cells[1] ?? "";
    }
  }
  return { value, fraction, babysit };
}

/**
 * @param {object} input
 * @param {Mode} input.mode
 * @param {readonly string[]} input.evidence
 * @param {readonly string[]} input.claim
 * @param {string} input.command
 * @param {string} input.cwd
 * @returns {Snapshot}
 */
export function snapshot({ mode, evidence, claim, command, cwd }) {
  const facts = claimFacts(claim);

  let spawns = 0;
  let subagents = false;
  for (const line of evidence) {
    if (!SPAWN.test(line)) continue;
    subagents = true;
    if (ARCHITECT_SPAWN.test(line)) spawns += 1;
  }

  // An unbacked `contested no` falls back to the expensive path rather than
  // buying a cheaper run with a claim the evidence contradicts.
  let contested = true;
  if (facts.value === "no") {
    const parts = facts.fraction.split("/");
    const m = Number.parseInt(parts[0]) || 0;
    const n = Number.parseInt(parts[1]) || 0;
    contested = !(m === n && n === spawns);
  }

  // A `gh pr create` is itself the claim that Opening a PR is happening, and the
  // session rows hold for every armed run.
  const playbooks = new Set(["session", "opening-a-pr"]);
  for (const line of evidence) {
    if (!READ_FILE.test(line)) continue;
    for (const match of line.matchAll(PLAYBOOK)) {
      playbooks.add(match[0].slice("playbooks/".length, -".md".length));
    }
  }

  const bodyFile = resolveBodyFile(flagValue(command, "--body-file"), cwd);
  const body = bodyFile === "" ? null : readBody(bodyFile);

  return {
    mode,
    evidence,
    contested,
    babysit: facts.babysit,
    subagents,
    playbooks,
    command,
    title: flagValue(command, "--title"),
    bodyFile,
    bodyOk: body !== null,
    body: body ?? [],
  };
}

function bodyFileFailure(rows, snap) {
  if (snap.mode !== "ship" || snap.bodyFile === "" || snap.bodyOk) return null;
  const row = rows.find((entry) => entry.playbook === "opening-a-pr" && entry.step === "body-file");
  if (row === undefined) throw new ChainError("chain.tsv has no opening-a-pr/body-file row");
  return `opening-a-pr/body-file: cannot read ${snap.bodyFile}; ${row.reason}`;
}

/**
 * One `<playbook>/<step>: <reason>` line per failure.
 *
 * @param {readonly ChainRow[]} rows
 * @param {Snapshot} snap
 * @returns {string[]}
 */
export function audit(rows, snap) {
  const failures = [];
  for (const row of rows) {
    if (!snap.playbooks.has(row.playbook)) continue;
    if (!SCOPE[row.scope](snap.mode)) continue;
    if (!WHEN[row.when](snap)) continue;
    const lines = FIELD[row.field](snap);
    if (lines === null) continue;
    const hit = lines.some((line) => row.match.test(line));
    if (FAILS_ON_HIT[row.kind] === hit) failures.push(`${row.playbook}/${row.step}: ${row.reason}`);
  }
  const bodyFailure = bodyFileFailure(rows, snap);
  if (bodyFailure !== null) failures.push(bodyFailure);
  return failures;
}

function auditRun(evidencePath, claimPath, command, cwd) {
  const mode = classify(command);
  if (mode === "none") return [];
  return audit(
    parseChain(readManifest(process.env)),
    snapshot({
      mode,
      evidence: readLines(evidencePath),
      claim: readLines(claimPath),
      command,
      cwd,
    }),
  );
}

function arm() {
  const payload = readPayload();
  if (payload === null) return 0;
  if (!stringField(payload, "prompt").includes("poteto-mode")) return 0;
  const root = rootSession(payload);
  if (root === "") return 0;
  const dir = join(pluginData(process.env), "runs", root);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "armed"), "");
  } catch {
    return 0;
  }
  return 0;
}

function record() {
  const payload = readPayload();
  if (payload === null) return 0;
  const root = rootSession(payload);
  if (root === "") return 0;
  const dir = join(pluginData(process.env), "runs", root);
  if (!isFile(join(dir, "ready"))) return 0;
  const line = evidenceLine(payload);
  if (line === null || line === "") return 0;
  try {
    appendFileSync(join(dir, "evidence.tsv"), `${line}\n`);
  } catch {
    return 0;
  }
  return 0;
}

function gate() {
  const payload = readPayload();
  if (payload === null) return 0;
  const command = stringField(payload.tool_input, "command");
  if (command === "") return 0;
  if (classify(command) === "none") return 0;
  const root = rootSession(payload);
  if (root === "") return 0;
  const dir = join(pluginData(process.env), "runs", root);
  if (!isFile(join(dir, "armed"))) return 0;

  let failures;
  try {
    failures = auditRun(
      join(dir, "evidence.tsv"),
      join(dir, "claim.tsv"),
      command,
      stringField(payload, "cwd"),
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.stderr.write("pstack chain audit failed internally (exit 2)\n");
    return 2;
  }

  if (failures.length === 0) return 0;
  process.stdout.write(
    JSON.stringify({
      decision: "deny",
      reason: `pstack chain audit blocked this call:\n${failures.join("\n")}\n`,
    }),
  );
  return 0;
}

function auditCommand(argv) {
  const options = { evidence: "", claim: "", command: "", cwd: "" };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const key = flag.startsWith("--") ? flag.slice(2) : "";
    if (!Object.hasOwn(options, key)) {
      process.stderr.write(`chain.mjs audit: unknown argument: ${flag}\n`);
      return 2;
    }
    options[key] = argv[index + 1] ?? "";
  }
  if (options.command === "") {
    process.stderr.write("chain.mjs audit: --command is required\n");
    return 2;
  }
  const failures = auditRun(options.evidence, options.claim, options.command, options.cwd);
  for (const failure of failures) process.stdout.write(`${failure}\n`);
  return failures.length === 0 ? 0 : 1;
}

function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case "arm":
      return arm();
    case "record":
      return record();
    case "gate":
      return gate();
    case "audit":
      return auditCommand(rest);
    default:
      process.stderr.write("usage: chain.mjs arm|record|gate|audit\n");
      return 2;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
