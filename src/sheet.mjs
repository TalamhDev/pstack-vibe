import { readFile } from "node:fs/promises";

const FAMILY_LINE = /^[a-z][a-z0-9-]*:\s*[^\s]+\s*$/;
const COMMENT_PREFIX = /^\s*#\s*/;
const PROFILE_TOKEN = /pstack-[a-z0-9][a-z0-9-]*/g;
const LEVEL_SUFFIX = /-(max|high|medium|low)$/;

/** The sheet format closes its metadata keys; the family set stays open. */
const METADATA_KEYS = new Set(["defaults", "budget", "parent"]);

/**
 * `setup-pstack` writes `pstack-<family>-<level>` profiles while the family line
 * still records the base alias, so the level suffix is not part of the family.
 *
 * @param {string} profile
 * @returns {string}
 */
export function familyForProfile(profile) {
  return profile.replace(/^pstack-/, "").replace(LEVEL_SUFFIX, "");
}

/**
 * @typedef {object} Sheet
 * @property {ReadonlyMap<string, string>} aliases
 * @property {readonly string[]} profiles
 * @property {readonly string[]} families
 */

/**
 * The port of the doctor's sheet awk. A family line is `# <family>: <alias>`
 * with the alias as the whole value, so a prose note that happens to start with
 * a key is not read as a family. A role line is any non-blank line that is not a
 * comment, and its `pstack-*` tokens are profile names.
 *
 * @param {string} text
 * @returns {Sheet}
 */
export function parseSheet(text) {
  const aliases = new Map();
  const profiles = new Set();

  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) {
      const body = line.replace(COMMENT_PREFIX, "");
      if (!FAMILY_LINE.test(body)) continue;
      const separator = body.indexOf(":");
      const key = body.slice(0, separator);
      if (METADATA_KEYS.has(key)) continue;
      const value = body.slice(separator + 1).trim().split(/\s+/)[0];
      if (!aliases.has(key)) aliases.set(key, value);
      continue;
    }

    if (/^\s*$/.test(line)) continue;

    for (const match of line.matchAll(PROFILE_TOKEN)) profiles.add(match[0]);
  }

  const families = new Set(aliases.keys());
  for (const profile of profiles) families.add(familyForProfile(profile));

  return {
    aliases,
    profiles: [...profiles].sort(),
    families: [...families].sort(),
  };
}

/**
 * The port of the doctor's config.toml alias awk: strip comments, take the value
 * of every `alias =` line, and drop the surrounding quotes.
 *
 * @param {string} text
 * @returns {ReadonlySet<string>}
 */
export function parseConfigAliases(text) {
  const aliases = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s*#.*/, "");
    if (!/^\s*alias\s*=/.test(line)) continue;
    const value = line
      .replace(/^[^=]*=\s*/, "")
      .replace(/^"/, "")
      .replace(/"\s*$/, "");
    aliases.add(value);
  }
  return aliases;
}

/** `null` when the sheet is absent or unreadable, matching the shell's `[ -f ]`. */
export async function readSheet(path) {
  try {
    return parseSheet(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/** An empty set when `config.toml` is absent, matching the shell's `[ ! -f ]`. */
export async function readConfigAliases(path) {
  try {
    return parseConfigAliases(await readFile(path, "utf8"));
  } catch {
    return new Set();
  }
}
