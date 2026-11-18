import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isFile, readPayload, stringField } from "./hook-payload.mjs";

function sheetLines(text) {
  const parts = text.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
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
 * arrives in the payload's `cwd`.
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
  context.push(`Model sheet: ${sheet}`, "", ...sheetLines(readText(sheet)));
} else {
  context.push("No model sheet found. Run /pstack:setup-pstack to configure model roles.");
}

process.stdout.write(
  JSON.stringify({ hook_specific_output: { additional_context: `${context.join("\n")}\n` } }),
);
