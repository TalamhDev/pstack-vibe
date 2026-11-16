# pstack-vibe

pstack for the Mistral Vibe CLI.

pstack is Lauren Tan's ([@poteto](https://x.com/poteto)) engineering workflow for AI coding
agents. This repository ports it to Vibe: the skills, playbooks, principles, subagent
profiles, and session-start context that make `/poteto-mode` route work through a rigorous
playbook instead of a single confident pass.

The port is independent. It is not endorsed by Lauren Tan, Mistral, or Cursor. The upstream
project is [cursor/plugins/pstack](https://github.com/cursor/plugins/tree/main/pstack), and
the vendored copy, pin, and license are recorded in [NOTICE.md](./NOTICE.md).

## Install

Clone the repository, then run the installer:

```sh
git clone https://github.com/telamh/pstack-vibe.git
cd pstack-vibe
./scripts/install.sh install
```

That copies the generated plugin to `~/.vibe/plugins/pstack` (user scope). The installer is
POSIX `sh` and needs no runtime dependencies.

Project scope installs into the current repository instead, so the plugin travels with it:

```sh
./scripts/install.sh install --project
```

That writes `.vibe/plugins/pstack` and leaves the user-level install alone. Use project scope
when a team wants one pinned pstack version per repository.

Other installer commands:

```sh
./scripts/install.sh update      # reinstall over the existing copy
./scripts/install.sh uninstall   # remove the plugin directory
./scripts/install.sh doctor      # check Vibe, the manifest, skills, hook, sheet, and profiles
```

`uninstall --purge` also removes the model sheet and the `pstack-*.toml` agent profiles.
`--dry-run` prints what would be written without writing it.

Release tarballs contain the same repository, including `scripts/install.sh` and the
prebuilt `generated/vibe/` tree. Unpack one and run `./scripts/install.sh install`; there is
no build step. If you only have the plugin tree, copy `generated/vibe/` to
`~/.vibe/plugins/pstack` by hand.

Start a new session, or run `/reload-plugins`, after installing. Vibe reads plugins at
session start.

## Setup

Run setup once:

```text
/pstack:setup-pstack
```

Vibe prefixes plugin commands with the plugin name, so `/setup-pstack` also works when the
short form is unambiguous. Setup detects the model aliases in `~/.vibe/config.toml`, asks for
a reasoning budget, and asks you to confirm three roles:

1. **Main orchestrator.** Runs the playbook, the router, and the default code delegates.
   Default: the DeepSeek alias.
2. **Adversarial reviewer.** Leads the adversarial seats in arena, architect, and interrogate
   panels. Default: the GLM alias.
3. **Security reviewer.** Handles security-specific review and security review-thread triage.
   Default: the Mistral Large 4 alias.

It then writes the model sheet and one agent profile per family:

- `~/.vibe/pstack-models.md` (or `.vibe/pstack-models.md` for a project install) maps each
  role to an agent profile.
- `~/.vibe/agents/pstack-deepseek.toml`, `pstack-glm.toml`, `pstack-ml4.toml`, and any other
  confirmed family are the subagent profiles. Each fixes one `active_model` alias and one
  thinking level.

The plugin also ships three inherit-parent profiles: `pstack:poteto-agent` for code
delegates, `pstack:comment-sicko` for the comment reviewer, and `pstack:readonly` for
read-only exploration.

Every `active_model` must be an alias you confirmed with `vibe -p "reply ok" --model <alias>`.
Vibe rejects a profile whose alias it cannot resolve, and it does not fall back. Setup checks
this before it writes anything. If a family is missing, setup says so and substitutes the
best available family rather than writing a broken profile.

The sheet and profiles apply to new sessions. Start a new session after setup.

## First task

Start with something real but small, and state how you will know it worked:

```text
/pstack:poteto-mode add a --json flag to the export command. text output stays byte-identical. verify both forms.
```

`/poteto-mode` matches the task to a playbook, copies that playbook's steps into the todo
list, and runs the other skills as the steps need them. For the prompt above it picks the
Feature playbook and asks for the data shape before it writes code. A step it skips stays in
the list as `skip: <reason>`, so you can see what it chose not to do.

Keep the mode on for the session by starting each task with `/pstack:poteto-mode`. Vibe has
no Custom Modes, so the skill attaches to the turn that invokes it and the session-start
hook keeps the model sheet and adapter doc in context. Say `new task` when you change
subjects so the mode re-matches instead of continuing the prior playbook.

The [guide](./docs/guide/README.md) walks through a first real task, from setup and prompting
through verification and overnight runs. If you are unsure which skill fits, ask
`/pstack:poteto-help`.

## Model policy

The port ships a three-family policy:

- **DeepSeek V4.1 Flash 1017 is the default** for code, judgment, prose, swarm workers, and
  the hardest tasks. It leads the agentic coding benchmarks the decision used, and it is
  much cheaper than the alternatives.
- **GLM 5.3 is the adversarial reviewer** and a cross-judge. A different family finds
  different failures. GLM wins HLE, a knowledge-heavy reasoning benchmark, but that is not
  the shape of most pstack tasks.
- **Mistral Large 4 is the security reviewer and an arena runner.** It leads vulnerability
  reproduction and patching, and it adds a third design family to arena panels.

Arena runs DeepSeek, GLM, and Mistral Large 4. The cross-judge pool is GLM, Mistral Large 4,
and DeepSeek, so the judge comes from a family other than the parent. Architect runs DeepSeek
and GLM. Interrogate reviews with GLM and DeepSeek.

The evidence, benchmark table, prices, caveats, and sources are in
[docs/model-selection.md](./docs/model-selection.md). `/setup-pstack` can override any role,
and a role set to `inherit-parent` runs on the session's active model.

## Exit conditions

- `/exit` ends the Vibe session. Background subagents stop with it.
- `/clear` clears the conversation. The plugin stays installed, and the next task starts with
  a fresh context. Run `/pstack:poteto-mode` again for the new task.
- `/pstack:setup-pstack` and the other skills apply to new sessions. Start a new session
  after changing the model sheet or profiles. Run `/reload-plugins` only after changing the
  plugin tree itself.

The mode pauses for irreversible writes and nothing else. Its always-pause list is:

- force-pushing a shared branch
- a deploy
- data deletion
- a customer message

Reversible work proceeds without asking. A session override such as "don't stop", "going to
bed", "run until done", or "be fully autonomous" keeps the run going. It does not cover the
pause list.

## Troubleshooting

**The plugin is not found.** Check that `~/.vibe/plugins/pstack/plugin.json` exists and names
`pstack`. Run `./scripts/install.sh doctor`; it checks the manifest, all 58 skills, the hook,
the model sheet, the profiles, and the aliases. A project install lives at
`.vibe/plugins/pstack`, so run the installer from that repository with `--project`.

**Skills do not show up.** Run `/reload-plugins` or start a new session. Most pstack skills
set `disable-model-invocation: true`, so the `skill` tool does not load them on its own. Type
the command, or let `/poteto-mode` read the skill by path. A skill that still does not appear
means the plugin directory is incomplete; reinstall with `./scripts/install.sh update`.

**A model alias is missing.** Vibe rejects an agent profile whose `active_model` is not in
`~/.vibe/config.toml`, and it does not fall back. Run `./scripts/install.sh doctor` to see
which alias is missing, add the model entry to the config, or rerun `/pstack:setup-pstack`
and pick an alias you have. Do not hand-edit a profile to an alias you have not confirmed.

**The session-start hook does not fire.** Check that
`~/.vibe/plugins/pstack/ai.mistral.vibe/hooks.toml` exists and that
`ai.mistral.vibe/scripts/session-start.sh` is executable. The hook runs `sh` on that script,
so a missing file or a bad `$PLUGIN_ROOT` leaves the session without the model sheet. Start a
new session after fixing it; hooks load at session start.

**A change had no effect.** Start a new session. Model sheets and agent profiles are read
when a session starts, not while one is running. Run `/reload-plugins` only after changing
the plugin tree itself.

## Upstream fidelity

This port keeps upstream's skill content wherever Vibe can run it. Two mechanisms do the
adaptation:

- **Substitutions.** `adapters/substitutions.json` lists every literal and regex rewrite,
  such as `Task` to `agents.spawn`, `~/.cursor/rules/pstack-models.mdc` to
  `~/.vibe/pstack-models.md`, and model slugs to pstack profiles. Each rule has an id and,
  where it is scoped, an include list.
- **Forks.** `adapters/forks.json` lists the files that need more than a substitution, with
  the reason for each. The fork sources live under `adapters/forks/` and are copied verbatim.
  They cover Vibe's spawn fields, asynchronous reports, model profiles, skill loading by
  path, and the three key setup roles.

The upstream pin is commit `bf0c7cd80abdbf7fe47b634978a7d1b4071f71a7`, version `0.15.42`.
`vendor/pstack/` holds that tree, and `vendor/pstack/LICENSE` reproduces the MIT notice.
`npm run generate` rebuilds `generated/vibe/`; `npm run check` fails when the committed tree
drifts from a fresh build. The tests assert that every fork matches its source exactly and
that the generated skills contain no Cursor tool names or `.cursor` paths.

The vendored tree is refreshed with `node scripts/sync.mjs --commit <sha>` (or `--latest`).
The script refuses on a dirty tree, replaces `vendor/pstack/`, updates the pin in
`adapters/substitutions.json`, regenerates `generated/vibe/`, and appends a changelog entry.
The network path is manual; review the diff and run the gate before committing.

The adapter doc is [docs/harness/vibe.md](./docs/harness/vibe.md). It maps the remaining
Cursor tool names, lists the Cursor-only features and how a run skips them, and explains the
agent profiles, skill loading, and paths. The installed plugin carries the same doc at
`ai.mistral.vibe/knowledge/pstack-vibe/KNOWLEDGE.md`, and the session-start hook points the
model at it.

## Credits and license

pstack is by Lauren Tan ([@poteto](https://x.com/poteto)), with the upstream source at
[cursor/plugins/pstack](https://github.com/cursor/plugins/tree/main/pstack). The skills,
playbooks, principles, and prose are hers. This port only adapts them to Vibe.

The port, adapter code, generated plugin tree, scripts, tests, and docs are MIT, copyright
2026 telamh. The upstream MIT license is preserved in [vendor/pstack/LICENSE](./vendor/pstack/LICENSE)
and summarized in [NOTICE.md](./NOTICE.md). See [LICENSE](./LICENSE) for this repository's
license.

The port is independent and is not endorsed by Lauren Tan, Mistral, or Cursor.

## Limitations

- **macOS and Linux only.** The installer, hook, and doctor use POSIX `sh` and `awk`. Windows
  support is a follow-up.
- **Experimental plugin format.** The port targets the Vibe 3.1.2 plugin format: `plugin.json`,
  `skills/`, and `ai.mistral.vibe/{hooks.toml,agents/*.toml}`. The format can change, and a
  change can break the generated tree.
- **Cursor-only features are skipped.** Bugbot, Cursor Automations, cloud agents, Custom
  Modes, `cursor-team-kit` (`deslop`, `control-cli`, `control-ui`), and Cursor's built-in
  `/create-skill` have no direct Vibe equivalent. A run skips the step with one line,
  `Skipped in Vibe: <step>. <reason>.`, and keeps going. GitHub security review threads
  replace Bugbot triage. Vibe's `skill-creator` replaces `/create-skill`.
- **`/loop` is session-bound.** Vibe's `/loop` runs only while the session is live and idle.
  An overnight run that must survive a restart needs a fresh session and a new loop.
- **No Cursor Plan Mode.** pstack has no planning skill by design. For work that spans
  phases, ask `/poteto-mode` for a plan; it runs the Multi-phase plan playbook.
