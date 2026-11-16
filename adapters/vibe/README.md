# pstack for the Vibe CLI

This is the installed Vibe plugin tree for pstack, Lauren Tan's engineering workflow for AI
coding agents, ported to the Mistral Vibe CLI. It ships the skills, playbooks, principles,
subagent profiles, and the session-start hook that loads the model sheet.

The port is independent and is not endorsed by Lauren Tan, Mistral, or Cursor. The source,
issues, and full documentation live at
<https://github.com/telamh/pstack-vibe>. Upstream pstack is at
<https://github.com/cursor/plugins/tree/main/pstack>.

## Install

From a checkout of the repository:

```sh
./scripts/install.sh install
```

That copies this tree to `~/.vibe/plugins/pstack`. For a project-local install, run
`./scripts/install.sh install --project` to write `.vibe/plugins/pstack`. Start a new session
after installing.

## Setup

Run `/pstack:setup-pstack` once. It detects the model aliases in `~/.vibe/config.toml`, asks
for a reasoning budget, and confirms the three key roles: main orchestrator (DeepSeek),
adversarial reviewer (GLM), and security reviewer (Mistral Large 4). It writes the model sheet
to `~/.vibe/pstack-models.md` and one profile per family to `~/.vibe/agents/`. Start a new
session after setup.

## First task

```text
/pstack:poteto-mode add a --json flag to the export command. text output stays byte-identical. verify both forms.
```

`/poteto-mode` matches the task to a playbook and copies its steps into the todo list. A
skipped step stays in the list as `skip: <reason>`.

## Model policy

DeepSeek V4.1 Flash 1017 is the default for code, judgment, prose, swarm workers, and the
hardest tasks. GLM 5.3 is the adversarial reviewer and a cross-judge. Mistral Large 4 is the
security reviewer and an arena runner. See the repository's `docs/model-selection.md` for the
evidence.

## Credits

pstack is by Lauren Tan ([@poteto](https://x.com/poteto)). The skills, playbooks, principles,
and prose are hers. This port only adapts them to Vibe. The port code and generated tree are
MIT, copyright 2026 telamh; upstream's MIT notice is in `LICENSE`.

## Limitations

- macOS and Linux only.
- The Vibe plugin format is experimental and can change.
- Cursor-only features are skipped with a one-line note: Bugbot, Cursor webhook routines,
  cloud agents, Custom Modes, and Cursor's built-in `/create-skill`.
- `/loop` runs only while the session is live.

## More

The full README, guide, adapter doc, and installer live at
<https://github.com/telamh/pstack-vibe>.
