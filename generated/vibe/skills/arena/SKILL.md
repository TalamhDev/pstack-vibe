---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---
<!-- pstack-vibe: upstream bf0c7cd, substitutions v1 -->

# Arena

Keep a todo list in your reply with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Pick the runners. Read the `arena runners` line in `~/.vibe/pstack-models.md`, or `.vibe/pstack-models.md` for a project install. The default is one each on `pstack-deepseek`, `pstack-glm`, and `pstack-ml4`. Each entry is an agent profile name, not a raw model slug. An `inherit-parent` entry means the parent model, so use `config_name: "pstack:poteto-agent"` for that seat. If the sheet is missing, run every seat on `pstack:poteto-agent` and tell the user to run `/setup-pstack`. If the line is missing, use the default profiles. If a profile is not installed, run that seat on another runner's profile and say which seat was substituted. If a spawn rejects a profile, use another runner's profile and say so. If dropped seats leave fewer than two runners, add runners until there are two, or one when the line has one entry. Run each added runner on a remaining runner's profile, or on `pstack:poteto-agent` when none remain, and say so. Spawn more runners when the arena covers multiple design directions. Use the same profile N times when the work is generation-bound rather than judgment-sensitive. Match each subagent's profile to the job per the Subagents section of the **poteto-mode** skill. A job that needs more reasoning than the role's profile provides uses a higher-effort profile from the sheet.
4. Give each candidate its own output location in its own git worktree, or `/tmp/arena-<slug>/candidate-<n>/` when the repo cannot use one, per the **separate-before-serializing-shared-state** principle skill.

## Phase B: Fan out

Spawn all N subagents in one message with `agents.spawn`, each with `config_name` from step 3, the task, the path to the shared grounding, its own worktree, and instructions to produce the artifact and a short rationale naming the alternatives it considered and what it rejected. Every spawn runs in the background; collect the reports when they arrive rather than polling `agents.list`.

If a candidate produces no output, proceed with N-1 and note the dropout.

## Phase C: Cross-judge

After all Phase B candidates complete, choose one profile from the `arena cross-judge pool` line in the model sheet. The default pool is `pstack-glm`, `pstack-ml4`, `pstack-deepseek`. Spawn one judge subagent with `config_name` set to the chosen pool profile and a do-not-edit instruction. The judge reviews by reading only and never modifies files. The judge is never from the parent's model family. Read a profile's family from its suffix: `pstack-deepseek` is DeepSeek, `pstack-glm` is GLM, and `pstack-ml4` is Mistral Large 4. Try only the entries from another family, in pool order. An `inherit-parent` entry is the parent model, so it never judges. With the default pool, a DeepSeek parent gets `pstack-glm` first, then `pstack-ml4`. A GLM parent gets `pstack-ml4` first, then `pstack-deepseek`. An ML4 parent gets `pstack-glm` first, then `pstack-deepseek`. If the sheet is missing, skip the judge, pick the base alone in Phase D, and tell the user to run `/setup-pstack`. If the pool line is missing, use the default pool. If a spawn rejects a profile, move to the next entry. If no entry from another family runs, skip the judge, pick the base alone in Phase D, and say so. If you do not know the parent's model, try the pool in order and say that the family check did not run. The judge sees the rubric and the candidates by path label, scores each criterion, and recommends a base with rationale. It runs in parallel with your reading in Phase D. Don't spawn it while candidates are still writing.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge when Phase C ran one. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per the Laziness Protocol.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Fold each graft in by hand, per the **redesign-from-first-principles** principle skill, so the result stays coherent under one mental model. Don't paste mechanically.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Verify the synthesized artifact like any other output, per the **prove-it-works** principle skill. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). Don't paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict or that Phase C skipped the judge, each graft with its source candidate, what was rejected and why, any convergence or dropouts, and the verification result.
