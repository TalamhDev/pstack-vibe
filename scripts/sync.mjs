// scripts/sync.mjs
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SUBSTITUTIONS = join(ROOT, "adapters", "substitutions.json");
const CHANGELOG = join(ROOT, "CHANGELOG.md");
const UPSTREAM_REPO = "https://github.com/cursor/plugins.git";

export function parseArgs(argv, defaults = {}) {
  const options = {
    commit: defaults.commit ?? null,
    version: defaults.version ?? null,
    latest: false,
    generate: true,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--commit") {
      const value = argv[(index += 1)];
      if (!value || value.startsWith("--")) throw new Error("--commit needs a value");
      options.commit = value;
      options.latest = false;
    } else if (arg === "--version") {
      const value = argv[(index += 1)];
      if (!value || value.startsWith("--")) throw new Error("--version needs a value");
      options.version = value;
    } else if (arg === "--latest") {
      options.latest = true;
      options.commit = null;
    } else if (arg === "--no-generate") {
      options.generate = false;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function isDirty(status) {
  return status
    .split("\n")
    .map((line) => line.trim())
    .some((line) => line.length > 0 && !line.includes(".superpowers/"));
}

export function changelogEntry({ commit, version, date }) {
  const day = date ?? new Date().toISOString().slice(0, 10);
  return [
    "## [Unreleased]",
    "",
    "### Changed",
    "",
    `- Synced the vendored pstack tree to upstream commit \`${commit}\` (pstack ${version}) on ${day}.`,
    "",
  ].join("\n");
}

export function appendChangelog(existing, entry) {
  const base = existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${base}\n${entry}`;
}

function run(command, args, cwd = ROOT) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export async function syncUpstream(options = {}) {
  const substitutions = JSON.parse(readFileSync(SUBSTITUTIONS, "utf8"));
  const commit = options.latest ? null : (options.commit ?? substitutions.upstream?.commit);
  if (!commit && !options.latest) {
    throw new Error("No commit to sync. Pass --commit <sha> or --latest.");
  }

  if (isDirty(run("git", ["status", "--porcelain"]))) {
    throw new Error("Refusing to sync: the working tree is dirty. Commit or stash first.");
  }

  const tmp = mkdtempSync(join(tmpdir(), "pstack-sync-"));
  try {
    const checkout = join(tmp, "plugins");
    run("git", [
      "clone",
      "--depth",
      "1",
      "--filter=blob:none",
      "--sparse",
      UPSTREAM_REPO,
      checkout,
    ]);
    run("git", ["-C", checkout, "sparse-checkout", "set", "pstack"]);

    if (commit) {
      run("git", ["-C", checkout, "fetch", "--depth", "1", "origin", commit]);
      run("git", ["-C", checkout, "checkout", commit]);
    }

    const vendor = join(ROOT, "vendor", "pstack");
    rmSync(vendor, { recursive: true, force: true });
    cpSync(join(checkout, "pstack"), vendor, { recursive: true });

    const manifest = JSON.parse(readFileSync(join(vendor, "plugin.json"), "utf8"));
    const version = options.version ?? manifest.version;
    const resolvedCommit = commit ?? run("git", ["-C", checkout, "rev-parse", "HEAD"]).trim();

    const updated = {
      ...substitutions,
      upstream: { ...substitutions.upstream, commit: resolvedCommit, version },
    };
    writeFileSync(SUBSTITUTIONS, `${JSON.stringify(updated, null, 2)}\n`);

    if (options.generate !== false) {
      run(process.execPath, [join(ROOT, "scripts", "generate.mjs")]);
    }

    writeFileSync(
      CHANGELOG,
      appendChangelog(
        readFileSync(CHANGELOG, "utf8"),
        changelogEntry({ commit: resolvedCommit, version }),
      ),
    );

    return { commit: resolvedCommit, version };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function usage() {
  console.log(
    "Usage: node scripts/sync.mjs [--commit <sha> | --latest] [--version <version>] [--no-generate]",
  );
}

async function main() {
  const substitutions = JSON.parse(readFileSync(SUBSTITUTIONS, "utf8"));
  const options = parseArgs(process.argv.slice(2), {
    commit: substitutions.upstream?.commit,
  });

  if (options.help) {
    usage();
    return;
  }

  const result = await syncUpstream(options);
  console.log(`synced vendor/pstack to ${result.commit} (pstack ${result.version})`);
}

const isMain =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
