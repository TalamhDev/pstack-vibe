import { join } from "node:path";
import { installPlugin, uninstallPlugin } from "./install.mjs";
import { PACKAGE_ROOT, resolveLayout } from "./layout.mjs";
import { createVibeProbe } from "./vibe.mjs";

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
    this.exitCode = 2;
  }
}

const USAGE = `usage: pstack-vibe <command> [options]

  install    copy the generated plugin into the Vibe plugin directory (default)
  update     reinstall over an existing copy (same as install --force)
  uninstall  remove the plugin directory

  --project  use ./.vibe instead of $VIBE_HOME (or ~/.vibe)
  --force    replace a directory that is not a pstack plugin
  --dry-run  print what would be written without writing it
  --purge    with uninstall, also remove the model sheet and pstack-*.toml agents`;

const PLUGIN_SOURCE = join(PACKAGE_ROOT, "generated/vibe");

const defaultIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

function layoutFor(scope) {
  return resolveLayout({ scope, env: process.env, cwd: process.cwd() });
}

async function runInstall(command, io) {
  const layout = layoutFor(command.scope);
  const result = await installPlugin({
    layout,
    source: PLUGIN_SOURCE,
    force: command.force,
    dryRun: command.dryRun,
    vibe: createVibeProbe(),
  });

  if (result.kind === "planned") {
    for (const action of result.actions) io.out(`dry-run: ${action}`);
    io.out(`${command.verb}: dry run; nothing written`);
    return 0;
  }

  const past = command.verb === "update" ? "updated" : "installed";
  io.out(
    `${command.verb}: pstack ${past} at ${result.target} (${result.scope} scope). Run /reload or start a new session.`,
  );
  return 0;
}

async function runUninstall(command, io) {
  const result = await uninstallPlugin({
    layout: layoutFor(command.scope),
    purge: command.purge,
    dryRun: command.dryRun,
  });

  if (result.kind === "planned") {
    for (const action of result.actions) io.out(`dry-run: ${action}`);
    io.out("uninstall: dry run; nothing removed");
    return 0;
  }
  if (result.kind === "removed") {
    io.out(`uninstall: removed ${result.target}. Start a new session to unload pstack.`);
    return 0;
  }
  io.out(`uninstall: pstack is not installed at ${result.target}`);
  return 0;
}

const COMMANDS = {
  install: { force: false, run: runInstall },
  update: { force: true, run: runInstall },
  uninstall: { force: false, run: runUninstall },
};

/**
 * @typedef {{ kind: "install", verb: "install" | "update", scope: string, force: boolean, dryRun: boolean }
 *   | { kind: "uninstall", scope: string, purge: boolean, dryRun: boolean }
 *   | { kind: "help" }} Command
 */

/** @returns {Command} */
export function parseArgs(argv) {
  let verb = "install";
  let scope = "user";
  let force = null;
  let dryRun = false;
  let purge = false;

  for (const arg of argv) {
    if (Object.hasOwn(COMMANDS, arg)) {
      verb = arg;
      continue;
    }
    switch (arg) {
      case "--project":
        scope = "project";
        break;
      case "--force":
        force = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--purge":
        purge = true;
        break;
      case "-h":
      case "--help":
        return { kind: "help" };
      default:
        throw new UsageError(`unknown argument: ${arg}`);
    }
  }

  if (verb === "uninstall") return { kind: "uninstall", scope, purge, dryRun };
  return { kind: "install", verb, scope, force: force ?? COMMANDS[verb].force, dryRun };
}

export async function main(argv, io = defaultIo) {
  let command;
  try {
    command = parseArgs(argv);
  } catch (error) {
    if (typeof error?.exitCode !== "number") throw error;
    io.err(`pstack-vibe: ${error.message}`);
    io.err(USAGE);
    return error.exitCode;
  }

  if (command.kind === "help") {
    io.out(USAGE);
    return 0;
  }

  try {
    return await COMMANDS[command.kind].run(command, io);
  } catch (error) {
    if (typeof error?.exitCode !== "number") throw error;
    io.err(`pstack-vibe: ${error.message}`);
    return error.exitCode;
  }
}
