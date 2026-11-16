---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---
<!-- pstack-vibe: upstream bf0c7cd, substitutions v1 -->

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active transcript

Before fanning out, find this conversation's transcript under `~/.vibe/logs/session/`. Do not read other projects' session directories. That crosses workspace boundaries and reads private chats from unrelated projects.

List the newest files under `~/.vibe/logs/session/`, newest first. For each candidate, read its opening user message. Take the file that contains this conversation's opening prompt. If none matches, pass a tight digest of the session instead.

## 2. Spawn three reviewers in parallel

One message, three `agents.spawn` calls, `config_name` from the role line. Reviewers need MCP access to look up the tickets, chat threads, and observability traces the transcript references. Run them on the role's profile, never on `pstack:readonly`, which has no MCP tools.

Each reviewer and the synthesizer read a role line in `~/.vibe/pstack-models.md`, or `.vibe/pstack-models.md` for a project install, and use the profile that line names. The default is `pstack-deepseek`. An `inherit-parent` line uses `config_name: "pstack:poteto-agent"`. If the sheet is missing, use `config_name: "pstack:poteto-agent"` and tell the user to run `/setup-pstack`. If the line is missing, use `pstack-deepseek`. If a spawn rejects a profile, use the default and say so. Match each reviewer's profile to the job per the Subagents section of the **poteto-mode** skill.

| Lens | Role line | Default profile | Prompt template |
|---|---|---|---|
| Judgment | `reflect judgment, divergent, synthesizer` | `pstack-deepseek` | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling` | `pstack-deepseek` | `references/tooling-reviewer.md` |
| Divergent | `reflect judgment, divergent, synthesizer` | `pstack-deepseek` | `references/divergent-reviewer.md` |

The default sheet lines are `reflect judgment, divergent, synthesizer: pstack-deepseek` and `reflect tooling: pstack-deepseek`.

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the `agents.spawn` report.

## 3. Synthesize

One `agents.spawn` call, `config_name` from the `reflect judgment, divergent, synthesizer` line (default `pstack-deepseek`). It spot-verifies citations through MCP, so it must keep MCP access and must not run on `pstack:readonly`. Pass `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. It returns an Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. See the **encode-lessons-in-structure** principle skill.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

File each Backlog item to your team's devex or backlog tracker without waiting. Only the Accepted list waits for approval.

Never edit a skill inside the installed plugin directory, `~/.vibe/plugins/pstack` or `.vibe/plugins/pstack`. Before approval, show its destination, `.vibe/skills/<skill>/` or `~/.vibe/skills/<skill>/`. After approval, copy the skill folder there and edit the copy. Never open a PR or push.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to Vibe's builtin `skill-creator` skill and run its draft / test / iterate loop.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to `skill-creator` and run its description-optimization loop.
- `new skill via create-skill: <kebab-name>`: hand creation to `skill-creator`. The routing label `create-skill` is the synthesizer's name for Vibe's builtin `skill-creator` skill. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
