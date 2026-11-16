---
name: setup-pstack
description: Configure which models pstack uses per role and at what reasoning budget. Detects your Vibe model aliases, confirms them, and writes the pstack model sheet plus the agent profiles it names. Use for /setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---
<!-- pstack-vibe: upstream bf0c7cd, substitutions v1 -->

# Setup pstack

Write the pstack model sheet and the agent profiles it names. The sheet is `~/.vibe/pstack-models.md` for a user install, or `.vibe/pstack-models.md` for a project install. The agents live in `~/.vibe/agents/` or `.vibe/agents/`.

## Scope

Pick the scope from where the plugin is installed. If `$PLUGIN_ROOT` is under the current project's `.vibe/plugins/`, use project scope. Otherwise use user scope. If neither is clear, ask with `ask_user_question`.

- **User scope.** Sheet `~/.vibe/pstack-models.md`, agents `~/.vibe/agents/`, config `~/.vibe/config.toml`.
- **Project scope.** Sheet `.vibe/pstack-models.md`, agents `.vibe/agents/`, config `.vibe/config.toml`.

## Steps

### 1. Detect aliases

Read the `[[models]]` entries in the config file. Collect each entry's `alias`, `name`, and `provider`. The alias is what `--model` takes. Keep only entries that have an alias.

Confirm every candidate with a one-turn headless call:

```sh
vibe -p "reply ok" --model <alias>
```

A candidate is confirmed only when the command exits 0 and prints a reply. Drop any alias that fails. Never write an alias you did not confirm.

If the config has no `[[models]]` entries, or none confirm, ask the user to paste the aliases they use. Confirm each one with the same command before using it.

Classify the confirmed aliases by family. The defaults are DeepSeek, GLM, and Mistral Large 4. Match on the entry's `name` or `alias`: a name containing `deepseek` is DeepSeek, `glm` is GLM, and `mistral-large-4` or `ml4` is ML4. If a family has more than one confirmed alias, prefer the shortest base alias. If a family is missing, say so and continue. The user can still pick another confirmed alias for its roles.

### 2. Load current state

If the sheet exists, read it. Treat its `# budget` line and role values as the current choices, and keep them on a re-run. A sheet without `# defaults: 2` is from an older setup; keep its lines but tell the user to review them. Drop a line whose role is not in step 5.

### 3. Ask for the budget

Ask with `ask_user_question`. Offer these four options with these labels, and name the current budget when the sheet records one. With no sheet, say that `large` is the default.

- `unlimited — max reasoning`
- `large — high reasoning`
- `medium — medium reasoning`
- `small — low reasoning`

Map the choice to a thinking level:

- `unlimited` → `max`
- `large` → `high`
- `medium` → `medium`
- `small` → `low`

If a model has no `medium` level, `medium` uses `high` for that model and says so.

### 4. Ask the three key roles

Ask these three with `ask_user_question`, in this order. Offer only the confirmed aliases plus `inherit-parent`. State the default for each.

1. **Main orchestrator.** The model that runs the playbook, the router, and the default code delegates. Default: the DeepSeek alias.
2. **Adversarial reviewer.** The model that leads the adversarial seats in arena, architect, and interrogate panels. Default: the GLM alias.
3. **Security reviewer.** The model that handles security-specific review and review-thread triage. Default: the Mistral Large 4 alias.

If a default is missing, ask the user to choose from the confirmed aliases. If they do not choose, degrade: use the best available family for the missing role, repeat a family for a panel seat, and say what you substituted. The security reviewer never disappears silently. If the user picks `inherit-parent`, the role runs on the plugin's inherit-parent profile and the sheet uses `inherit-parent`.

### 5. Build the role table

Build the table from the three choices. The values are agent profile names, not raw aliases. Use `pstack-deepseek`, `pstack-glm`, and `pstack-ml4` for the default families, and `pstack-<family>` for any other family you detected.

- **Main orchestrator profile.** Every code and judgment role: `feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb`, `judgment and prose`, `hardest tasks`, `reflect tooling`, `reflect judgment, divergent, synthesizer`, `swarm workers`, and `formal verification`.
- **Arena runners.** The main, adversarial, and security profiles, in that order, with duplicates removed.
- **Arena cross-judge pool.** The adversarial, security, and main profiles, in that order, with duplicates removed. The judge comes from a family other than the parent's.
- **Architect runners.** The main and adversarial profiles, in that order, with duplicates removed.
- **Interrogate reviewers.** The adversarial and main profiles, in that order, with duplicates removed.
- **Security review.** The security profile.

Show the full table with each role's profile. Let the user change any role with `ask_user_question`: offer the available profiles plus `inherit-parent`. If a change leaves a panel with one family, repeat the best available family at a different angle and say which seat was substituted. Do not refuse the task.

### 6. Write the model sheet

Write the sheet. Overwrite the whole file so re-runs are idempotent. Shape:

```markdown
# pstack model configuration
# Written by /pstack:setup-pstack. Delete a line to fall back to the default.
# defaults: 2
# budget: large (high)
# parent: deepseek-flash
# deepseek: deepseek-flash
# glm: glm-5-3
# ml4: mistral-large-4-0-3
feature, refactoring: pstack-deepseek
bug-fix: pstack-deepseek
perf-issue: pstack-deepseek
hillclimb: pstack-deepseek
judgment and prose: pstack-deepseek
hardest tasks: pstack-deepseek
reflect tooling: pstack-deepseek
reflect judgment, divergent, synthesizer: pstack-deepseek
arena runners: pstack-deepseek, pstack-glm, pstack-ml4
arena cross-judge pool: pstack-glm, pstack-ml4, pstack-deepseek
swarm workers: pstack-deepseek
architect runners: pstack-deepseek, pstack-glm
interrogate reviewers: pstack-glm, pstack-deepseek
security review: pstack-ml4
formal verification: pstack-deepseek
```

The `# parent:` line records the main orchestrator alias, or `inherit-parent` when that role inherits the session model. It is informational; the port does not require the parent to be DeepSeek. Write a `# <family>:` line only for a confirmed alias. Omit the line for a missing family and say what you substituted. The role values are profile names, so the sheet stays portable when an alias changes.

### 7. Write the agent profiles

For each distinct profile the table uses, write an agent TOML in the agents directory. Name it `<profile>.toml`, so `pstack-deepseek.toml`, `pstack-glm.toml`, `pstack-ml4.toml`, and any `pstack-<family>.toml`. Write a profile for each confirmed default-family alias even when the table does not use it, so a later re-run can switch roles without a new setup.

Read `$PLUGIN_ROOT/ai.mistral.vibe/agents/poteto-agent.toml`. Copy its `instructions` block verbatim. Write:

```toml
schema_version = 1
agent_type = "subagent"
display_name = "pstack deepseek"
description = "pstack code delegate on <alias>."
active_model = "<confirmed alias>"
instructions = """
<the poteto-agent instructions, verbatim>
"""
```

Set `active_model` to a confirmed alias only. An unknown alias rejects the profile and Vibe does not fall back. If a profile's alias was not confirmed, do not write the profile. Use `pstack:poteto-agent` in the sheet instead and say so.

### 8. Effort variants

A budget level lives in the `[[models]]` entry's `thinking` field. If the base alias already has the chosen level, use it and write no variant. If it does not, offer to add a variant alias. Show the exact entry first:

```toml
[[models]]
name = "<base entry name>"
provider = "<base entry provider>"
alias = "<base alias>-<level>"
thinking = "<level>"
```

Copy any other fields from the base entry (`temperature`, prices, `max_context_length`). Ask for consent with `ask_user_question` before writing it. Never edit the config file without consent.

If the user consents, append the entry, confirm the new alias with `vibe -p "reply ok" --model <alias>-<level>`, and write `pstack-<family>-<level>.toml` with that alias. Use the variant profile in the sheet. If the user declines, or the variant cannot be created, use the base alias and say which level was used.

### 9. Validate

Every `active_model` in an agent you wrote must be a confirmed alias. Every profile named in the sheet must exist in the agents directory or the plugin. `inherit-parent` is always valid. If a check fails, fix the sheet or the agent and show the corrected table.

### 10. Confirm

Tell the user the sheet and agents were written, that they apply to new sessions, and to start a new session. Re-running this skill updates them. To pick up changes to the plugin tree itself, run `/reload-plugins`.

### 11. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with the `create-verification-skill` skill." On yes, read `$PLUGIN_ROOT/skills/create-verification-skill/SKILL.md` and follow it. On no, move on without pushing.

### 12. Offer a formal verification skill (optional)

Check whether the project already has a formal verification skill (a project skill that runs a model checker, a proof, or another verifier against the code). If not, offer once: "want a formal verification skill, so agents can prove a key property of your code holds in every case in scope, not only the cases tests reach? I can generate one with the `create-formal-verification-skill` skill." On yes, read `$PLUGIN_ROOT/skills/create-formal-verification-skill/SKILL.md` and follow it. On no, move on without pushing.
