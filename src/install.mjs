import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { removeTree } from "./tree.mjs";
import { assertSupported } from "./vibe.mjs";

export class TargetOccupiedError extends Error {
  constructor(message) {
    super(message);
    this.name = "TargetOccupiedError";
    this.exitCode = 1;
  }
}

export class PluginSourceMissingError extends Error {
  constructor(message) {
    super(message);
    this.name = "PluginSourceMissingError";
    this.exitCode = 1;
  }
}

const LEFTOVER = /^\.pstack-(staging|old)-/;
const PSTACK_PROFILE = /^pstack-.*\.toml$/;

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isPstackPlugin(dir) {
  try {
    const manifest = JSON.parse(await readFile(join(dir, "plugin.json"), "utf8"));
    return manifest?.name === "pstack";
  } catch {
    return false;
  }
}

async function sweep(dir) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (LEFTOVER.test(name)) await removeTree(join(dir, name));
  }
}

async function listPstackProfiles(agentsDir) {
  try {
    return (await readdir(agentsDir)).filter((name) => PSTACK_PROFILE.test(name)).sort();
  } catch {
    return [];
  }
}

/**
 * @typedef {object} InstallRequest
 * @property {import("./layout.mjs").Layout} layout
 * @property {string} source
 * @property {boolean} force
 * @property {boolean} dryRun
 * @property {import("./vibe.mjs").VibeProbe} vibe
 *
 * @typedef {{ kind: "installed", target: string, scope: string }
 *   | { kind: "planned", actions: readonly string[] }} InstallResult
 * @typedef {{ kind: "removed", target: string, purged: readonly string[] }
 *   | { kind: "absent", target: string }
 *   | { kind: "planned", actions: readonly string[] }} UninstallResult
 */

/**
 * The only path that writes a plugin tree. The gate is the first statement, so
 * every caller that installs is gated whether or not it remembered to check.
 *
 * @param {InstallRequest} request
 * @returns {Promise<InstallResult>}
 */
export async function installPlugin({ layout, source, force, dryRun, vibe }) {
  assertSupported(await vibe());

  if (!(await isDirectory(source))) {
    throw new PluginSourceMissingError(`generated plugin not found at ${source}`);
  }

  const occupied = existsSync(layout.pluginDir);
  if (occupied && !(await isPstackPlugin(layout.pluginDir)) && !force) {
    throw new TargetOccupiedError(
      `${layout.pluginDir} exists and is not a pstack plugin; rerun with --force to replace it`,
    );
  }

  if (dryRun) {
    const actions = [`mkdir -p ${layout.pluginsDir}`];
    if (occupied) actions.push(`remove ${layout.pluginDir}`);
    actions.push(`copy ${source} -> ${layout.pluginDir}`);
    return { kind: "planned", actions };
  }

  await sweep(layout.pluginsDir);
  await mkdir(layout.pluginsDir, { recursive: true });

  // Staging inside pluginsDir keeps the swap below on one filesystem, so the
  // rename cannot degrade into a copy.
  const staging = join(layout.pluginsDir, `.pstack-staging-${randomUUID()}`);
  await cp(source, staging, { recursive: true });

  let previous = null;
  if (existsSync(layout.pluginDir)) {
    previous = join(layout.pluginsDir, `.pstack-old-${randomUUID()}`);
    await rename(layout.pluginDir, previous);
  }
  try {
    await rename(staging, layout.pluginDir);
  } catch (error) {
    if (previous) await rename(previous, layout.pluginDir);
    await removeTree(staging);
    throw error;
  }
  if (previous) await removeTree(previous);

  return { kind: "installed", target: layout.pluginDir, scope: layout.scope };
}

/**
 * Deliberately not gated: removing an install from a Vibe this release no longer
 * supports has to keep working.
 *
 * @param {{ layout: import("./layout.mjs").Layout, purge: boolean, dryRun: boolean }} request
 * @returns {Promise<UninstallResult>}
 */
export async function uninstallPlugin({ layout, purge, dryRun }) {
  const present = existsSync(layout.pluginDir);

  const purged = [];
  if (purge) {
    if (existsSync(layout.sheetPath)) purged.push(layout.sheetPath);
    for (const name of await listPstackProfiles(layout.agentsDir)) {
      purged.push(join(layout.agentsDir, name));
    }
  }

  if (dryRun) {
    const actions = [];
    if (present) actions.push(`remove ${layout.pluginDir}`);
    for (const path of purged) actions.push(`remove ${path}`);
    return { kind: "planned", actions };
  }

  if (present) await removeTree(layout.pluginDir);
  for (const path of purged) await rm(path, { force: true });

  return present
    ? { kind: "removed", target: layout.pluginDir, purged }
    : { kind: "absent", target: layout.pluginDir };
}
