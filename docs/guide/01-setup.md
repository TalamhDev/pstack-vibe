# Set up pstack

In this page you install the plugin, pick which models pstack uses, and run your first task.
Setup is one command plus a short conversation.

## Install the plugin

From a checkout of this repository:

```sh
./scripts/install.sh install
```

That copies the generated plugin to `~/.vibe/plugins/pstack`. For a project-local install,
run `./scripts/install.sh install --project` to write `.vibe/plugins/pstack` instead. Start a
new session, or run `/reload-plugins`, so Vibe loads it.

Vibe prefixes plugin commands with the plugin name, so the commands in this guide take a
`pstack:` prefix, such as `/pstack:setup-pstack`. The short form, `/setup-pstack`, also works
when the name is unambiguous.

Check the install at any time:

```sh
./scripts/install.sh doctor
```

It checks Vibe, the manifest, all 58 skills, the hook, the model sheet, the profiles, and the
model aliases.

## Pick your models

Run:

```text
/pstack:setup-pstack
```

[`/setup-pstack`](../../generated/vibe/skills/setup-pstack/SKILL.md) reads the `[[models]]`
entries in `~/.vibe/config.toml`, confirms each alias with a one-turn headless call, and asks
for a reasoning budget. Then it asks you to confirm three roles:

1. **Main orchestrator.** Runs the playbook, the router, and the default code delegates.
2. **Adversarial reviewer.** Leads the adversarial seats in arena, architect, and interrogate.
3. **Security reviewer.** Handles security-specific review and security review-thread triage.

The defaults are DeepSeek for the orchestrator, GLM for the adversarial reviewer, and Mistral
Large 4 for security. [Model selection](../model-selection.md) has the evidence.

Setup writes `~/.vibe/pstack-models.md`, a small sheet that maps each role to an agent
profile. It also writes one profile per confirmed family to `~/.vibe/agents/`, such as
`pstack-deepseek.toml`, `pstack-glm.toml`, and `pstack-ml4.toml`. A project install writes
`.vibe/pstack-models.md` and `.vibe/agents/` instead.

The sheet applies to new sessions. Start a new session after setup.

You only override what you care about. A role with no line in the sheet keeps the skill's
default. To restore a default, delete that role's line. A rerun of `/setup-pstack` keeps any
role whose model differs from the default.

A role set to `inherit-parent` runs on the session's active model. It is not a model slug,
and it is always valid. For a panel role the value is a list, and one subagent runs per
entry, so the list length sets the panel size.

## Effort

Vibe fixes a model's thinking level in its `[[models]]` entry. The budget you pick maps to a
level:

- `unlimited` to `max`
- `large` to `high` (the default)
- `medium` to `medium`, or `high` where the model has no medium level
- `small` to `low`

If the base alias does not carry the chosen level, setup offers to add a variant alias. It
shows the exact `[[models]]` entry and asks before writing it. If you decline, the role uses
the base alias and setup says which level it used.

## Accept the verification offers, or not

At the end of setup, `/setup-pstack` looks for a way to prove app behavior in your project,
either a `verify-*` skill or an existing harness. If it finds neither, it offers once to
generate one with
[`/create-verification-skill`](../../generated/vibe/skills/create-verification-skill/SKILL.md).

Say yes and it writes `.vibe/skills/verify-<app>/`, a project-local skill that teaches agents
to drive your app the way a user does. It proves the skill works once before handing it over.
Say no and setup moves on. You can run `/create-verification-skill` yourself any time.
[Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers it.

If you are new to pstack, say yes. An agent that can check its own work keeps going until the
check passes. An agent that cannot hands every result back to you to check by hand. Of
everything in this guide, the verification skill pays off the most.

Then setup offers once to generate a formal verification skill with
[`/create-formal-verification-skill`](../../generated/vibe/skills/create-formal-verification-skill/SKILL.md),
unless the project already has one. Tests check the cases someone thought to write. A formal
verification skill checks one key property, such as "a job never runs twice at once", in
every case within a stated scope. Say yes when your code has concurrency, retries, a state
machine, or a parser, where a bug is costly and tests rarely reach the case that breaks.
Otherwise say no, and run it later if that changes.

## Keep the cost in check

pstack spends extra tokens on subagents and review panels. That is the price of the rigor. To
spend fewer:

- Rerun `/pstack:setup-pstack` and pick a smaller budget or cheaper models. A strong model in
  the main chat with cheaper, faster models in the code roles is a good split.
- Set a role to `inherit-parent` so it runs on the chat's own model.
- Shorten a panel list. Each entry runs one subagent.
- Save `/poteto-mode` for work that needs rigor. A small, obvious edit does not.

## Run your first task

Pick something real but small, and describe it the way you would describe it to a colleague:

```text
/pstack:poteto-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the todo list. Its first items are the matched playbook's steps copied in, the Feature
playbook for this prompt. If `/poteto-mode` skips a step, the step stays in the list with
`skip: <reason>`, so you can see what it chose not to do.

From here you can type normal follow-ups. Vibe has no Custom Modes, so `/poteto-mode` attaches
to the turn that invokes it. The loaded skill and the session-start hook keep the mode in
context for the session, but start each new task with `/pstack:poteto-mode` to be sure. Say
`new task` when you change subjects.

Next: [Route work through `/poteto-mode`](./02-poteto-mode.md).
