import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installPlugin } from "../src/install.mjs";
import { resolveLayout } from "../src/layout.mjs";
import { removeTree } from "../src/tree.mjs";
import { createVibeProbe } from "../src/vibe.mjs";
import { startMockProvider } from "./mock-provider.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT = "Reply with the single word: ok";
const HOOK_FILE = "ai.mistral.vibe/hooks.toml";

const CASES = [
  { id: "hook-on", disableHook: false, expectSentinel: true },
  { id: "hook-off", disableHook: true, expectSentinel: false },
];

export function assessRequests(caseSpec, requests, sentinel) {
  const messages = requests.flatMap((request) => (Array.isArray(request.messages) ? request.messages : []));
  const carries = (message) => typeof message?.content === "string" && message.content.includes(sentinel);
  const inUserMessage = messages.some((message) => message?.role === "user" && carries(message));
  const anywhere = messages.some(carries);
  const seen = `${requests.length} request${requests.length === 1 ? "" : "s"}${
    caseSpec.exitCode === undefined ? "" : `, exit ${caseSpec.exitCode}`
  }`;

  if (requests.length === 0) {
    return { ok: false, detail: `no request reached the mock provider (${seen})` };
  }
  if (caseSpec.expectSentinel) {
    return inUserMessage
      ? { ok: true, detail: `sentinel in a role=user message (${seen})` }
      : { ok: false, detail: `sentinel absent from every role=user message (${seen})` };
  }
  return anywhere
    ? { ok: false, detail: `sentinel present in a message (${seen})` }
    : { ok: true, detail: `sentinel absent (${seen})` };
}

export async function verifySessionContext({ plugin = join(ROOT, "generated/vibe") } = {}) {
  const started = Date.now();
  const vibeVersion = await requireVibe();
  await requirePlugin(plugin);

  const sentinel = `pstack-sentinel-${randomBytes(8).toString("hex")}`;
  const cases = [];
  for (const caseSpec of CASES) {
    cases.push(await runCase(caseSpec, { plugin, sentinel }));
  }

  return {
    ok: cases.every((entry) => entry.ok),
    sentinel,
    cases,
    kept: cases.filter((entry) => entry.runDir).map((entry) => entry.runDir),
    vibeVersion,
    elapsedMs: Date.now() - started,
  };
}

async function runCase(caseSpec, { plugin, sentinel }) {
  const runDir = await mkdtemp(join(tmpdir(), `pstack-mock-${caseSpec.id}-`));
  const home = join(runDir, "home");
  const scratch = join(runDir, "scratch");
  await mkdir(home, { recursive: true });
  await mkdir(scratch, { recursive: true });

  const provider = await startMockProvider();
  let session;
  let failure;
  try {
    await writeFile(join(home, "config.toml"), configToml(provider.apiBase));
    await writeFile(join(home, "pstack-models.md"), sheet(sentinel));

    await installPlugin({
      layout: resolveLayout({ scope: "user", env: { VIBE_HOME: home }, cwd: ROOT }),
      source: plugin,
      force: false,
      dryRun: false,
      vibe: createVibeProbe(),
    });
    if (caseSpec.disableHook) {
      await rm(join(home, "plugins/pstack", HOOK_FILE), { force: true });
    }

    session = await run("vibe", ["-p", PROMPT, "--trust"], { VIBE_HOME: home }, scratch);
    await writeFile(join(runDir, "stdout.txt"), session.stdout);
    await writeFile(join(runDir, "stderr.txt"), session.stderr);
  } catch (error) {
    failure = error;
  } finally {
    await provider.close();
  }

  const verdict = failure
    ? { ok: false, detail: failure.message }
    : assessRequests({ ...caseSpec, exitCode: session.exitCode }, provider.requests, sentinel);

  if (verdict.ok) {
    await removeTree(runDir);
    return { ...caseSpec, ...verdict, runDir: null };
  }
  return { ...caseSpec, ...verdict, runDir };
}

function configToml(apiBase) {
  return `active_model = "mock"
enable_telemetry = false
enable_update_checks = false
enable_connectors = false
enable_pr_monitoring = false

[[providers]]
name = "mock"
api_base = "${apiBase}"
api_key_env_var = ""

[[models]]
name = "mock-model"
provider = "mock"
alias = "mock"
`;
}

function sheet(sentinel) {
  return `# pstack model configuration
# defaults: 2
security review: ${sentinel}
`;
}

function run(command, args, env = {}, cwd = ROOT) {
  return new Promise((resolvePromise) => {
    const options = { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 };
    execFile(command, args, options, (error, stdout, stderr) => {
      const exitCode = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolvePromise({ stdout, stderr, exitCode });
    });
  });
}

async function requireVibe() {
  const result = await run("vibe", ["--version"]);
  if (result.exitCode !== 0) {
    throw new Error("vibe is not on PATH; install it with `uv tool install mistral-vibe==3.1.2`");
  }
  return result.stdout.trim().split("\n")[0];
}

async function requirePlugin(plugin) {
  try {
    await access(join(plugin, "plugin.json"));
  } catch {
    throw new Error(`no plugin tree at ${plugin}; run \`npm run generate\``);
  }
}

function usage() {
  return `usage: node scripts/mock-drive.mjs [--plugin <dir>] [--help]

Drives a real Vibe session against a local mock provider and asserts the
session-start hook delivered the model sheet.

  --plugin <dir>  plugin tree to install (default: generated/vibe)
  --help          print this message

Exit 0 when both cases pass, 1 when a case fails, 2 when the drive cannot run.`;
}

function parseArgs(argv) {
  const options = { plugin: join(ROOT, "generated/vibe"), help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--plugin") {
      index += 1;
      if (index >= argv.length) {
        throw new Error("--plugin needs a directory");
      }
      options.plugin = resolve(argv[index]);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`mock-drive: ${error.message}\n\n${usage()}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  let result;
  try {
    result = await verifySessionContext({ plugin: options.plugin });
  } catch (error) {
    process.stderr.write(`mock-drive: ${error.message}\n`);
    return 2;
  }

  const lines = [
    `mock-drive: ${result.vibeVersion}, node ${process.version}`,
    `mock-drive: sentinel ${result.sentinel}`,
    ...result.cases.map((entry) => `${entry.ok ? "PASS" : "FAIL"}  ${entry.id}: ${entry.detail}`),
  ];
  const seconds = (result.elapsedMs / 1000).toFixed(1);
  lines.push(
    result.ok
      ? `mock-drive: PASS (${result.cases.length} cases, ${seconds}s)`
      : `mock-drive: FAIL (${result.cases.filter((entry) => !entry.ok).length} of ${result.cases.length} cases); kept ${result.kept.join(" ")}`,
  );
  process.stdout.write(`${lines.join("\n")}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
