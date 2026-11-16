// scripts/generate.mjs
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "smol-toml";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODEL_SHEET = join(ROOT, "model-sheet", "roles.toml");
const ADAPTER_DOC = join(ROOT, "docs", "harness", "vibe.md");

// Vibe's reasoning effort for each pstack budget label. Only the default
// budget ships with this port.
const BUDGET_EFFORT = { large: "high" };

const RUNTIME_NOTE = [
  "## Runtime",
  "",
  "The core plugin has no runtime dependency. The optional `watch-pr` helper under",
  "`skills/poteto-mode/scripts/` requires bun and `npm install` in that directory.",
].join("\n");

const MODEL_KNOWLEDGE_FRONTMATTER = [
  "---",
  "name: pstack-models",
  "description: The default pstack role table and the setup contract for model profiles.",
  "---",
  "",
].join("\n");

const ADAPTER_KNOWLEDGE_FRONTMATTER = [
  "---",
  "name: pstack-vibe",
  "description: The Cursor-to-Vibe adapter: tool mapping, agent profiles, skill loading, and skipped Cursor-only features.",
  "---",
  "",
].join("\n");

export function applySubstitutions(text, rules, filePath) {
  let out = text;
  for (const rule of rules) {
    if (rule.include && !rule.include.some((glob) => matchGlob(filePath, glob))) continue;
    if (rule.exclude && rule.exclude.some((glob) => matchGlob(filePath, glob))) continue;
    out = rule.kind === "regex"
      ? out.replace(new RegExp(rule.find, rule.flags ?? "g"), rule.replace)
      : out.split(rule.find).join(rule.replace);
  }
  return out;
}

function matchGlob(filePath, glob) {
  const pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${pattern}$`).test(filePath);
}

function toPosix(filePath) {
  return filePath.split(sep).join("/");
}

function walk(dir) {
  const files = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function headerFor(substitutions) {
  const commit = String(substitutions.upstream.commit).slice(0, 7);
  return `<!-- pstack-vibe: upstream ${commit}, substitutions v${substitutions.version} -->`;
}

function insertHeader(text, header) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end !== -1) {
      const before = lines.slice(0, end + 1);
      const rest = lines.slice(end + 1);
      if (rest[0] === "") rest.shift();
      return [...before, header, "", ...rest].join(eol);
    }
  }
  return `${header}${eol}${eol}${text}`;
}

function addTree(entries, vendorDir, sourceDir, destinationDir, { markdown }) {
  const sourceRoot = join(vendorDir, sourceDir);
  if (!existsSync(sourceRoot)) return;

  for (const file of walk(sourceRoot)) {
    const sourcePath = toPosix(relative(vendorDir, file));
    const outPath = toPosix(join(destinationDir, relative(sourceRoot, file)));
    const isMarkdown = markdown && file.endsWith(".md");
    entries.set(outPath, {
      content: isMarkdown ? readFileSync(file, "utf8") : readFileSync(file),
      mode: isMarkdown ? 0o644 : statSync(file).mode & 0o777,
      transform: isMarkdown,
      sourcePath,
    });
  }
}

function addRootFile(entries, vendorDir, name) {
  const source = join(vendorDir, name);
  if (!existsSync(source)) return;
  entries.set(name, {
    content: readFileSync(source),
    mode: statSync(source).mode & 0o777,
    transform: false,
    sourcePath: name,
  });
}

function addMarkdownFile(entries, vendorDir, name) {
  const source = join(vendorDir, name);
  if (!existsSync(source)) return;
  entries.set(name, {
    content: readFileSync(source, "utf8"),
    mode: 0o644,
    transform: true,
    sourcePath: name,
  });
}

function addReadme(entries, vendorDir, adaptersDir, substitutions) {
  const adapterReadme = join(adaptersDir, "vibe", "README.md");
  if (existsSync(adapterReadme)) {
    const content = insertHeader(readFileSync(adapterReadme, "utf8"), headerFor(substitutions));
    entries.set("README.md", {
      content: `${content.trimEnd()}\n`,
      mode: 0o644,
      transform: false,
      sourcePath: "vibe/README.md",
    });
    return;
  }
  addMarkdownFile(entries, vendorDir, "README.md");
}

function addForks(entries, adaptersDir) {
  const manifestPath = join(adaptersDir, "forks.json");
  if (!existsSync(manifestPath)) return;

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const projectRoot = dirname(adaptersDir);
  for (const fork of manifest.forks ?? []) {
    const sourcePath = join(projectRoot, ...fork.source.split("/"));
    if (!existsSync(sourcePath)) {
      throw new Error(`Missing fork source for ${fork.path}: ${sourcePath}`);
    }
    entries.set(fork.path, {
      content: readFileSync(sourcePath),
      mode: statSync(sourcePath).mode & 0o777,
      transform: false,
      sourcePath: fork.source,
    });
  }
}

export function renderTemplate(template, values) {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

function splitFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return { meta: [], body: text };
  const end = lines.indexOf("---", 1);
  if (end === -1) return { meta: [], body: text };
  return { meta: lines.slice(1, end), body: lines.slice(end + 1).join("\n") };
}

export function readAgentBody(filePath) {
  return splitFrontmatter(readFileSync(filePath, "utf8")).body.trim();
}

function readAgentDescription(filePath) {
  const line = splitFrontmatter(readFileSync(filePath, "utf8")).meta.find((entry) =>
    entry.startsWith("description:"),
  );
  if (!line) throw new Error(`Missing description in agent frontmatter: ${filePath}`);
  return line.slice("description:".length).trim().replace(/^(["'])(.*)\1$/, "$2");
}

function escapeTomlBasic(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function escapeTomlMultilineLiteral(value) {
  if (value.includes('"""')) {
    throw new Error("agent instructions contain a TOML multi-line literal delimiter");
  }
  return value;
}

export function renderAgentToml({ name, displayName, description, instructions, template }) {
  if (!template) throw new Error(`Missing agent template for ${name}`);
  return renderTemplate(template, {
    DISPLAY_NAME: escapeTomlBasic(displayName),
    DESCRIPTION: escapeTomlBasic(description),
    INSTRUCTIONS: escapeTomlMultilineLiteral(instructions),
  });
}

function portPotetoAgentInstructions(instructions) {
  const find =
    "With no path, before any other work, search `~/.cursor/plugins/` for a file whose path ends in `skills/poteto-mode/SKILL.md`. If more than one file matches, use the copy whose `.cursor-plugin/plugin.json` has the highest `version`.";
  const replace =
    "With no path, before any other work, read the `pstack:poteto-mode` skill at `$PLUGIN_ROOT/skills/poteto-mode/SKILL.md`. If `PLUGIN_ROOT` is unset, try `~/.vibe/plugins/pstack/skills/poteto-mode/SKILL.md` and `.vibe/plugins/pstack/skills/poteto-mode/SKILL.md`.";
  if (!instructions.includes(find)) {
    throw new Error("poteto-agent instructions no longer match the upstream search paragraph");
  }
  return instructions.split(find).join(replace);
}

const AGENT_SOURCES = [
  {
    name: "poteto-agent",
    displayName: "pstack poteto-agent",
    source: "agents/poteto-agent.md",
    template: "vibe/agents/poteto-agent.toml.tmpl",
    // Vibe's plugin agent schema limits descriptions to 300 characters. The
    // upstream description is longer, so this override keeps the two points
    // that matter and drops the rest.
    description:
      "Delegate subagent for code-writing and helper tasks spawned during a `/poteto-mode` run. Use a fresh subagent per task; do not use it to run `/poteto-mode` itself. Read the `poteto-mode` SKILL.md in full before any work, including its inline Principles index.",
    port: portPotetoAgentInstructions,
  },
  {
    name: "comment-sicko",
    displayName: "pstack comment-sicko",
    source: "agents/comment-sicko.md",
    template: "vibe/agents/comment-sicko.toml.tmpl",
  },
  {
    name: "readonly",
    displayName: "pstack readonly",
    description: "Read-only explorer for pstack. Never modifies files.",
    instructions:
      "You are a read-only explorer for pstack. Never modify files. Use only the allowed read-only commands.",
    template: "vibe/agents/readonly.toml.tmpl",
  },
];

export function renderModelKnowledge(sheet) {
  const roles = sheet.roles ?? {};
  const effort = BUDGET_EFFORT[sheet.budget];
  if (!effort) {
    throw new Error(`Unknown budget "${sheet.budget}" in model-sheet/roles.toml`);
  }

  const aliases = [];
  for (const profiles of Object.values(roles)) {
    for (const profile of profiles) {
      if (!aliases.includes(profile)) aliases.push(profile);
    }
  }

  return [
    "# pstack model configuration",
    "",
    "Default role table for this port. `/pstack:setup-pstack` writes the user's sheet to",
    "`~/.vibe/pstack-models.md` (or `.vibe/pstack-models.md` for a project install).",
    "",
    "# defaults: 2",
    `# budget: ${sheet.budget} (${effort})`,
    `# parent: ${sheet.parent}`,
    ...aliases.map((profile) => `# ${profile.replace(/^pstack-/, "")}: ${profile}`),
    "",
    ...Object.entries(roles).map(([role, profiles]) => `${role}: ${profiles.join(", ")}`),
    "",
  ].join("\n");
}

function addPluginManifest(entries, vendorDir, adaptersDir, substitutions) {
  const templatePath = join(adaptersDir, "vibe", "plugin.json.tmpl");
  if (existsSync(templatePath)) {
    const upstreamVersion =
      substitutions.upstream?.version ??
      JSON.parse(readFileSync(join(vendorDir, "plugin.json"), "utf8")).version;
    const content = renderTemplate(readFileSync(templatePath, "utf8"), {
      ADAPTER_VERSION: `${upstreamVersion}-vibe.${substitutions.version}`,
    });
    JSON.parse(content);
    entries.set("plugin.json", {
      content,
      mode: 0o644,
      transform: false,
      sourcePath: "vibe/plugin.json.tmpl",
    });
    return;
  }

  const source = join(vendorDir, "plugin.json");
  if (!existsSync(source)) {
    throw new Error(`Missing vendor plugin manifest: ${source}`);
  }
  const manifest = JSON.parse(readFileSync(source, "utf8"));
  const upstreamVersion = substitutions.upstream?.version ?? manifest.version;
  manifest.version = `${upstreamVersion}-vibe.${substitutions.version}`;
  manifest.description = "pstack by Lauren Tan, ported to the Mistral Vibe CLI by telamh.";
  manifest.author = { name: "telamh" };
  manifest.homepage = "https://github.com/telamh/pstack-vibe";
  manifest.repository = "https://github.com/telamh/pstack-vibe";
  entries.set("plugin.json", {
    content: `${JSON.stringify(manifest, null, 2)}\n`,
    mode: 0o644,
    transform: false,
    sourcePath: "plugin.json",
  });
}

function addHooks(entries, adaptersDir) {
  const template = join(adaptersDir, "vibe", "hooks.toml.tmpl");
  if (!existsSync(template)) return;
  entries.set("ai.mistral.vibe/hooks.toml", {
    content: readFileSync(template, "utf8"),
    mode: 0o644,
    transform: false,
    sourcePath: "vibe/hooks.toml.tmpl",
  });
}

function addAgents(entries, vendorDir, adaptersDir, substitutions) {
  for (const agent of AGENT_SOURCES) {
    const templatePath = join(adaptersDir, ...agent.template.split("/"));
    if (!existsSync(templatePath)) continue;

    let { description, instructions } = agent;
    if (agent.source) {
      const sourcePath = join(vendorDir, ...agent.source.split("/"));
      if (!existsSync(sourcePath)) continue;
      if (!description) description = readAgentDescription(sourcePath);
      instructions = readAgentBody(sourcePath);
      if (agent.port) instructions = agent.port(instructions);
      instructions = applySubstitutions(instructions, substitutions.rules ?? [], agent.source);
    }

    entries.set(`ai.mistral.vibe/agents/${agent.name}.toml`, {
      content: renderAgentToml({
        ...agent,
        description,
        instructions,
        template: readFileSync(templatePath, "utf8"),
      }),
      mode: 0o644,
      transform: false,
      sourcePath: agent.template,
    });
  }
}

function addKnowledge(entries, substitutions) {
  const sheet = parse(readFileSync(MODEL_SHEET, "utf8"));
  entries.set("ai.mistral.vibe/knowledge/pstack-models/KNOWLEDGE.md", {
    content: insertHeader(
      `${MODEL_KNOWLEDGE_FRONTMATTER}${renderModelKnowledge(sheet)}`,
      headerFor(substitutions),
    ),
    mode: 0o644,
    transform: false,
    sourcePath: "model-sheet/roles.toml",
  });

  if (!existsSync(ADAPTER_DOC)) {
    throw new Error(`Missing adapter doc: ${ADAPTER_DOC}`);
  }
  entries.set("ai.mistral.vibe/knowledge/pstack-vibe/KNOWLEDGE.md", {
    content: insertHeader(
      `${ADAPTER_KNOWLEDGE_FRONTMATTER}${readFileSync(ADAPTER_DOC, "utf8")}`,
      headerFor(substitutions),
    ),
    mode: 0o644,
    transform: false,
    sourcePath: "docs/harness/vibe.md",
  });
}

function addSessionStart(entries, adaptersDir) {
  const source = join(adaptersDir, "vibe", "scripts", "session-start.sh");
  if (!existsSync(source)) return;
  entries.set("ai.mistral.vibe/scripts/session-start.sh", {
    content: readFileSync(source),
    mode: 0o755,
    transform: false,
    sourcePath: "vibe/scripts/session-start.sh",
  });
}

function buildEntries(vendorDir, adaptersDir, substitutions) {
  const entries = new Map();
  addTree(entries, vendorDir, "skills", "skills", { markdown: true });
  addTree(entries, vendorDir, "assets", "assets", { markdown: false });
  addReadme(entries, vendorDir, adaptersDir, substitutions);
  addPluginManifest(entries, vendorDir, adaptersDir, substitutions);
  addHooks(entries, adaptersDir);
  addAgents(entries, vendorDir, adaptersDir, substitutions);
  addKnowledge(entries, substitutions);
  addSessionStart(entries, adaptersDir);
  addRootFile(entries, vendorDir, "LICENSE");
  addRootFile(entries, ROOT, "NOTICE.md");
  addForks(entries, adaptersDir);

  const header = headerFor(substitutions);
  for (const entry of entries.values()) {
    if (!entry.transform) continue;
    const substituted = applySubstitutions(entry.content, substitutions.rules ?? [], entry.sourcePath);
    entry.content = insertHeader(substituted, header);
  }

  const readme = entries.get("README.md");
  if (readme) {
    readme.content = `${readme.content.trimEnd()}\n\n${RUNTIME_NOTE}\n`;
  }
  return entries;
}

function expectedBuffer(content) {
  return Buffer.isBuffer(content) ? content : Buffer.from(content);
}

function sameContent(file, content) {
  if (!existsSync(file)) return false;
  return readFileSync(file).equals(expectedBuffer(content));
}

function pruneEmptyDirs(dir, keep) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneEmptyDirs(join(dir, entry.name), keep);
  }
  if (dir !== keep && readdirSync(dir).length === 0) rmdirSync(dir);
}

function listExtras(outDir, entries) {
  if (!existsSync(outDir)) return [];
  const managedRoots = new Set([...entries.keys()].map((file) => file.split("/")[0]));
  // The plugin no longer ships the upstream Cursor guide, so prune any stale
  // docs tree from an older generated copy.
  managedRoots.add("docs");
  return walk(outDir)
    .map((file) => toPosix(relative(outDir, file)))
    .filter((file) => managedRoots.has(file.split("/")[0]) && !entries.has(file));
}

export async function generatePlugin({ vendorDir, adaptersDir, outDir, check = false }) {
  const substitutions = JSON.parse(
    readFileSync(join(adaptersDir, "substitutions.json"), "utf8"),
  );
  const entries = buildEntries(vendorDir, adaptersDir, substitutions);
  const files = [...entries.keys()].sort();

  if (check) {
    const changed = files.filter((file) => !sameContent(join(outDir, ...file.split("/")), entries.get(file).content));
    changed.push(...listExtras(outDir, entries));
    return { files, changed: [...new Set(changed)].sort() };
  }

  for (const file of files) {
    const target = join(outDir, ...file.split("/"));
    const entry = entries.get(file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.content);
    if (entry.mode) chmodSync(target, entry.mode);
  }

  for (const extra of listExtras(outDir, entries)) {
    rmSync(join(outDir, ...extra.split("/")));
  }
  pruneEmptyDirs(outDir, outDir);

  return { files, changed: [] };
}

function parseArgs(argv) {
  const options = {
    check: false,
    vendorDir: join(ROOT, "vendor/pstack"),
    adaptersDir: join(ROOT, "adapters"),
    outDir: join(ROOT, "generated/vibe"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") options.check = true;
    else if (arg === "--vendor") options.vendorDir = resolve(argv[(index += 1)]);
    else if (arg === "--out") options.outDir = resolve(argv[(index += 1)]);
    else if (arg === "--adapters") options.adaptersDir = resolve(argv[(index += 1)]);
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/generate.mjs [--check] [--vendor <dir>] [--out <dir>]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await generatePlugin(options);

  if (options.check) {
    if (result.changed.length === 0) {
      console.log("generated tree is up to date");
      return;
    }
    for (const file of result.changed) console.log(file);
    process.exitCode = 1;
    return;
  }

  console.log(`generated ${result.files.length} files in ${options.outDir}`);
}

const isMain =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
