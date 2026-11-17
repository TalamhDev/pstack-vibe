import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { readConfigAliases, readSheet } from "./sheet.mjs";
import { TESTED_VIBE_VERSIONS, isSupported, rangeText, supportedBounds } from "./vibe.mjs";

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readJsonField(path, field) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"))?.[field];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

async function listSkillNames(skillsDir) {
  const names = [];
  for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (await exists(join(skillsDir, entry.name, "SKILL.md"))) names.push(entry.name);
  }
  return names.sort();
}

function parseChainPlaybooks(text) {
  const names = [];
  let header = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^#/.test(line) || /^\s*$/.test(line)) continue;
    if (!header) {
      header = true;
      continue;
    }
    const name = line.split("\t")[0];
    if (name !== "session" && !names.includes(name)) names.push(name);
  }
  return names;
}

const vibeOnPath = {
  id: "vibe",
  run({ probe }) {
    switch (probe.kind) {
      case "absent":
        return { ok: false, detail: "vibe is not on PATH" };
      case "failed":
        return { ok: false, detail: "vibe is on PATH but 'vibe --version' failed" };
      case "unparseable":
        return { ok: true, detail: `vibe is on PATH: ${probe.text}` };
      default:
        return { ok: true, detail: `vibe is on PATH: ${probe.version.text}` };
    }
  },
};

const pluginManifest = {
  id: "plugin-manifest",
  async run({ pluginDir }) {
    const path = join(pluginDir, "plugin.json");
    const name = await readJsonField(path, "name");
    return name === "pstack"
      ? { ok: true, detail: `plugin manifest at ${path} names pstack` }
      : { ok: false, detail: `plugin manifest at ${path} is missing or does not name pstack` };
  },
};

const skillsMatchManifest = {
  id: "skills",
  async run({ pluginDir }) {
    const manifestPath = join(pluginDir, "skills.manifest");
    const skillsDir = join(pluginDir, "skills");
    if (!(await exists(manifestPath))) {
      return { ok: false, detail: `skills: skills.manifest is missing from ${pluginDir}; reinstall the plugin` };
    }
    if (!(await isDirectory(skillsDir))) {
      return { ok: false, detail: `skills: no skills directory at ${skillsDir}` };
    }

    const installed = await listSkillNames(skillsDir);
    const declared = (await readFile(manifestPath, "utf8"))
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean);

    const missing = declared.filter((name) => !installed.includes(name));
    const extra = installed.filter((name) => !declared.includes(name));

    if (missing.length) return { ok: false, detail: `skills: missing from the install: ${missing.join(" ")}` };
    if (extra.length) return { ok: false, detail: `skills: not in skills.manifest: ${extra.join(" ")}` };
    return { ok: true, detail: `skills: ${installed.length} SKILL.md files match skills.manifest` };
  },
};

const hookFile = {
  id: "hook",
  async run({ pluginDir }) {
    const path = join(pluginDir, "ai.mistral.vibe/hooks.toml");
    return (await exists(path))
      ? { ok: true, detail: `hook file at ${path}` }
      : { ok: false, detail: `hook file at ${path} is missing` };
  },
};

const chainManifest = {
  id: "chain",
  async run({ pluginDir }) {
    const dir = join(pluginDir, "ai.mistral.vibe");
    const path = join(dir, "chain.tsv");
    if (!(await exists(path))) {
      return { ok: false, detail: `chain: chain.tsv is missing from ${dir}; reinstall the plugin` };
    }

    const missing = [];
    for (const name of parseChainPlaybooks(await readFile(path, "utf8"))) {
      if (!(await exists(join(pluginDir, "skills/poteto-mode/playbooks", `${name}.md`)))) missing.push(name);
    }
    return missing.length
      ? { ok: false, detail: `chain: chain.tsv names playbooks that are not installed: ${missing.join(" ")}` }
      : { ok: true, detail: "chain: chain.tsv is installed and names only installed playbooks" };
  },
};

const dataWritable = {
  id: "plugin-data",
  async run({ dataDir }) {
    try {
      await mkdir(dataDir, { recursive: true });
      await access(dataDir, constants.W_OK);
      return { ok: true, detail: `chain: ${dataDir} is writable` };
    } catch {
      return {
        ok: false,
        detail: `chain: ${dataDir} is not writable; the chain recorder cannot write evidence`,
      };
    }
  },
};

const modelSheet = {
  id: "model-sheet",
  run({ sheetPath, sheet }) {
    return sheet
      ? { ok: true, detail: `model sheet at ${sheetPath}` }
      : { ok: false, detail: `model sheet at ${sheetPath} is missing; run /setup-pstack` };
  },
};

const agentProfiles = {
  id: "agent-profiles",
  async run({ sheet, agentsDir, pluginDir }) {
    if (!sheet) return { ok: false, detail: "agent profiles: cannot check without a model sheet" };

    const missing = [];
    for (const profile of sheet.profiles) {
      const inHome = join(agentsDir, `${profile}.toml`);
      const inPlugin = join(pluginDir, "ai.mistral.vibe/agents", `${profile}.toml`);
      if (!(await exists(inHome)) && !(await exists(inPlugin))) missing.push(profile);
    }
    return missing.length
      ? { ok: false, detail: `agent profiles missing for: ${missing.join(" ")}` }
      : { ok: true, detail: "agent profiles named in the sheet are installed" };
  },
};

const modelAliases = {
  id: "model-aliases",
  run({ sheet, configPath, configAliases }) {
    if (!sheet) return { ok: false, detail: "model aliases: cannot check without a model sheet" };

    const noAlias = [];
    const aliasMissing = [];
    for (const family of sheet.families) {
      const alias = sheet.aliases.get(family);
      if (alias === undefined) {
        noAlias.push(family);
        continue;
      }
      if (!configAliases.has(alias)) aliasMissing.push(`${family}:${alias}`);
    }

    if (noAlias.length) {
      return { ok: false, detail: `model aliases: no alias recorded for family: ${noAlias.join(" ")}` };
    }
    if (aliasMissing.length) {
      return { ok: false, detail: `model aliases missing from ${configPath}: ${aliasMissing.join(" ")}` };
    }
    if (sheet.families.length === 0) {
      return { ok: true, detail: "model aliases: the sheet records no aliases" };
    }
    return { ok: true, detail: `model aliases recorded in the sheet exist in ${configPath}` };
  },
};

const vibeCompat = {
  id: "vibe-compat",
  run({ probe, bounds, range }) {
    switch (probe.kind) {
      case "absent":
        return { ok: false, detail: "vibe is not on PATH; cannot prove it is a tested version" };
      case "failed":
        return { ok: false, detail: "'vibe --version' failed; cannot prove it is a tested version" };
      case "unparseable":
        return { ok: false, detail: `cannot parse a version from '${probe.text}'; the tested range is ${range}` };
      default:
        return isSupported(probe.version, bounds)
          ? { ok: true, detail: `${probe.version.text} is within the tested range ${range}` }
          : { ok: false, detail: `${probe.version.text} is outside the tested range ${range}` };
    }
  },
};

/**
 * @typedef {object} DoctorContext
 * @property {string} pluginDir
 * @property {string} sheetPath
 * @property {string} configPath
 * @property {string} agentsDir
 * @property {string} dataDir
 * @property {import("./sheet.mjs").Sheet | null} sheet
 * @property {ReadonlySet<string>} configAliases
 * @property {import("./vibe.mjs").VibeProbeResult} probe
 * @property {import("./vibe.mjs").SupportedBounds} bounds
 * @property {string} range
 *
 * @typedef {{ id: string, run: (ctx: DoctorContext) => { ok: boolean, detail: string } | Promise<{ ok: boolean, detail: string }> }} DoctorCheck
 */

export const CHECKS = [
  vibeOnPath,
  pluginManifest,
  skillsMatchManifest,
  hookFile,
  chainManifest,
  dataWritable,
  modelSheet,
  agentProfiles,
  modelAliases,
  vibeCompat,
];

export async function doctor({ layout, vibe }) {
  const bounds = supportedBounds(TESTED_VIBE_VERSIONS);
  const ctx = {
    pluginDir: layout.pluginDir,
    sheetPath: layout.sheetPath,
    configPath: layout.configPath,
    agentsDir: layout.agentsDir,
    dataDir: layout.dataDir,
    sheet: await readSheet(layout.sheetPath),
    configAliases: await readConfigAliases(layout.configPath),
    probe: await vibe(),
    bounds,
    range: rangeText(bounds),
  };

  const checks = [];
  for (const check of CHECKS) {
    checks.push({ id: check.id, ...(await check.run(ctx)) });
  }
  return { checks, ok: checks.every((entry) => entry.ok) };
}
