import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isatty } from "node:tty";

function readPayload() {
  // `isatty` rather than `process.stdin.isTTY`: touching the stdin stream puts
  // fd 0 into non-blocking mode, and the read below then races the writer.
  if (isatty(0)) return null;
  let text;
  try {
    text = readFileSync(0, "utf8");
  } catch {
    return null;
  }
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function stringField(object, key) {
  if (object === null || typeof object !== "object") return "";
  const value = object[key];
  return typeof value === "string" ? value : "";
}

/** awk's `getline` loop, keeping a CR so a CRLF sheet survives verbatim. */
function lines(text) {
  const parts = text.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Vibe runs plugin hooks from the plugin's pinned copy, so the session folder
 * arrives in the payload's `cwd`. A project sheet beats the user's sheet, and a
 * `VIBE_HOME` sheet beats the one under `HOME`.
 */
function resolveSheet(cwd, vibeHome) {
  if (cwd !== "") {
    const inCwd = join(cwd, ".vibe/pstack-models.md");
    if (isFile(inCwd)) return inCwd;
  }
  if (isFile(".vibe/pstack-models.md")) return ".vibe/pstack-models.md";
  if (vibeHome !== "") {
    const inHome = join(vibeHome, "pstack-models.md");
    if (isFile(inHome)) return inHome;
  }
  return "";
}

/** The recorder writes only into a run directory that carries this marker. */
function prepareRunDir(data, session) {
  if (session === "") return "";
  const dir = join(data, "runs", session);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "ready"), "");
    return dir;
  } catch {
    return "";
  }
}

const env = process.env;
const payload = readPayload();
const cwd = stringField(payload, "cwd");
const session = stringField(payload, "session_id");
const vibeHome = env.VIBE_HOME || (env.HOME ? join(env.HOME, ".vibe") : "");
const sheet = resolveSheet(cwd, vibeHome);
const root = env.PLUGIN_ROOT || join(import.meta.dirname, "../..");
const data = env.PLUGIN_DATA || join(vibeHome || join(env.HOME || homedir(), ".vibe"), "plugin-data/pstack");
const runDir = prepareRunDir(data, session);

const context = [
  "pstack is installed. For rigorous work, invoke /pstack:poteto-mode (or /poteto-mode).",
  "",
  `Plugin root: ${root}`,
];
if (runDir !== "") context.push(`Run directory: ${runDir}`);
context.push(`Adapter: ${join(root, "ai.mistral.vibe/knowledge/pstack-vibe/KNOWLEDGE.md")}`);
context.push(`Role table: ${join(root, "ai.mistral.vibe/knowledge/pstack-models/KNOWLEDGE.md")}`);
if (sheet !== "") {
  context.push(`Model sheet: ${sheet}`, "", ...lines(readText(sheet)));
} else {
  context.push("No model sheet found. Run /pstack:setup-pstack to configure model roles.");
}

process.stdout.write(
  JSON.stringify({ hook_specific_output: { additional_context: `${context.join("\n")}\n` } }),
);
