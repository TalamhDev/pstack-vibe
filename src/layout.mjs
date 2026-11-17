import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The package root, so the CLI can find the generated plugin it ships. */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export class LayoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "LayoutError";
    this.exitCode = 1;
  }
}

/**
 * @typedef {"user" | "project"} Scope
 * @typedef {{ VIBE_HOME?: string, HOME?: string, PLUGIN_DATA?: string }} Env
 * @typedef {object} Layout
 * @property {Scope} scope
 * @property {string} base
 * @property {string} pluginsDir
 * @property {string} pluginDir
 * @property {string} sheetPath
 * @property {string} configPath
 * @property {string} agentsDir
 * @property {string} dataDir
 */

/**
 * Every path this package reasons about, resolved once. `cwd` is a parameter so
 * the CLI is the only caller that reads ambient state.
 *
 * @param {{ scope: Scope, env: Env, cwd: string }} options
 * @returns {Layout}
 */
export function resolveLayout({ scope, env, cwd }) {
  let base;
  if (scope === "project") {
    base = resolve(cwd, ".vibe");
  } else if (env.VIBE_HOME) {
    base = resolve(cwd, env.VIBE_HOME);
  } else if (env.HOME) {
    base = resolve(env.HOME, ".vibe");
  } else {
    throw new LayoutError("set VIBE_HOME or HOME");
  }

  return {
    scope,
    base,
    pluginsDir: join(base, "plugins"),
    pluginDir: join(base, "plugins", "pstack"),
    sheetPath: join(base, "pstack-models.md"),
    configPath: join(base, "config.toml"),
    agentsDir: join(base, "agents"),
    dataDir: env.PLUGIN_DATA ? resolve(cwd, env.PLUGIN_DATA) : join(base, "plugin-data", "pstack"),
  };
}
