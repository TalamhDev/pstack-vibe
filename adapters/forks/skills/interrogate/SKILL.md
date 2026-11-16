---
name: interrogate
description: "Use for \"interrogate\", \"adversarial review\", \"multi-model review\", \"challenge this\", \"stress test this code\", \"find blind spots\", or \"tear this apart\". Adversaries try to break a change or design, and only findings proven by a run survive."
disable-model-invocation: true
---
<!-- pstack-vibe: upstream bf0c7cd, substitutions v1 -->

# Interrogate

Adversaries try to break a change or a design. A finding survives only when a run proves it. Report the findings. Do not apply fixes.

## Frame

The scope is what the user names. Otherwise it is the branch diff from its merge base with the base branch, through the working tree. State the intent with the **in-your-own-words** skill, from the user's message, the commits, and the PR description. Ask the user when the intent is unclear.

## Fan out

Run Phase A steps 3 and 4 and Phase B of the **arena** skill, with these changes. Read the `interrogate reviewers` line in place of `arena runners`. The default is `interrogate reviewers: pstack-glm, pstack-deepseek`. Run four adversaries: repeat the two families at different angles, so each family gets one correctness angle and one design or failure-mode angle. If a family's profile is not installed, repeat the available family at the other angle and say which seat was substituted. Copy the scope's uncommitted changes into each worktree. Spawn each adversary with `agents.spawn` and `config_name` set to its profile. In place of the arena task and rationale, give each adversary the scope, the intent, and this brief:

> Break this change. Prove each finding with a run against the real code, such as a failing test, a repro script, or command output that shows the wrong behavior. For a design or plan, run a prototype or probe the current tree. Keep repros in your own worktree. Report each finding with a title, the exact command, the output it printed, and the output the intent requires. Leave out anything you did not run. That covers style, naming, structure, and risks that need a future change to matter. No findings is a valid result.

Security findings route to the `security review` role. The default profile is `pstack-ml4`. A finding about auth, secrets, injection, data exposure, or another security-sensitive surface is not verified by the adversaries. Hand it to the profile on the `security review` line, and report it separately. It counts only when that run proves it.

## Verify

Verify each finding per arena Phase F by rerunning its command. Keep a finding when the output shows the failure and the failure breaks the intent. Drop the rest. Merge findings that share a root cause.

Skip arena Phases C, D, and E. Adversaries find different failures, so the verdict keeps every verified finding, not one adversary's list.

## Output

- **Intent**: the restatement.
- **Findings**: for each verified finding, the command, its output, how it breaks the intent, and the adversaries that found it. Say "no verified findings" when none survive.
- **Security findings**: for each security-sensitive finding, the command, its output, how it breaks the intent, and the `security review` profile that proved it. Report these separately from the verified findings.
- **Dropped**: for each adversary, the count of dropped findings and why.
