import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctor } from "./doctor.mjs";
import { installPlugin } from "./install.mjs";
import { resolveLayout } from "./layout.mjs";
import { removeTree } from "./tree.mjs";
import { TESTED_VIBE_VERSIONS, rangeText, supportedBounds } from "./vibe.mjs";

const FIXTURE_SHEET = [
  "# pstack model configuration",
  "# deepseek: deepseek-flash",
  "feature, refactoring: pstack-deepseek",
  "",
].join("\n");

const FIXTURE_PROFILE = [
  "schema_version = 1",
  'agent_type = "subagent"',
  'display_name = "pstack deepseek"',
  'description = "pstack code delegate on deepseek-flash."',
  'active_model = "deepseek-flash"',
  "",
].join("\n");

const FIXTURE_CONFIG = [
  "[[models]]",
  'name = "deepseek-v4-1-flash-1017"',
  'provider = "mistral"',
  'alias = "deepseek-flash"',
  "",
].join("\n");

/** The minimal home the doctor's sheet, profile, and alias checks need. */
async function seedFixtureHome(layout) {
  await mkdir(layout.agentsDir, { recursive: true });
  await writeFile(layout.sheetPath, FIXTURE_SHEET);
  await writeFile(join(layout.agentsDir, "pstack-deepseek.toml"), FIXTURE_PROFILE);
  await writeFile(layout.configPath, FIXTURE_CONFIG);
}

function toDriveOutcome(driven) {
  return {
    ok: driven.ok,
    cases: driven.cases.map(({ id, ok, detail }) => ({ id, ok, detail })),
  };
}

/**
 * @typedef {object} VerifyRequest
 * @property {import("./layout.mjs").Env} env
 * @property {string} cwd
 * @property {string} plugin
 * @property {import("./vibe.mjs").VibeProbe} vibe
 * @property {(options: { plugin: string }) => Promise<{ ok: boolean, cases: readonly { id: string, ok: boolean, detail: string }[] }>} drive
 *
 * @typedef {object} VerifyReport
 * @property {boolean} ok
 * @property {string} vibeVersion
 * @property {string} supported
 * @property {{ checks: readonly { id: string, ok: boolean, detail: string }[], ok: boolean }} doctor
 * @property {{ ok: boolean, cases: readonly { id: string, ok: boolean, detail: string }[] }} drive
 * @property {string | null} home
 */

/**
 * The one command that answers "does this work here". It never touches the real
 * Vibe home: it builds a throwaway one, and keeps it only when something failed.
 *
 * @param {VerifyRequest} request
 * @returns {Promise<VerifyReport>}
 */
export async function verify({ env, cwd, plugin, vibe, drive }) {
  const home = await mkdtemp(join(tmpdir(), "pstack-verify-"));
  const layout = resolveLayout({ scope: "user", env: { ...env, VIBE_HOME: home }, cwd });

  const probe = await vibe();
  const bounds = supportedBounds(TESTED_VIBE_VERSIONS);
  const once = async () => probe;

  try {
    await seedFixtureHome(layout);
    await installPlugin({ layout, source: plugin, force: false, dryRun: false, vibe: once });
  } catch (error) {
    await removeTree(home);
    throw error;
  }

  const report = await doctor({ layout, vibe: once });
  const driven = await drive({ plugin });
  const ok = report.ok && driven.ok;

  if (ok) await removeTree(home);

  return {
    ok,
    vibeVersion: probe.kind === "ok" ? probe.version.text : probe.kind,
    supported: rangeText(bounds),
    doctor: report,
    drive: toDriveOutcome(driven),
    home: ok ? null : home,
  };
}
