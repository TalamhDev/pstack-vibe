# Build the change and clean the diff

The build playbooks share one discipline. Say what you observed, and let the playbook demand
the evidence. This page shows what to put in the prompt for each common build task, then the
cleanup habit that keeps diffs reviewable.

## Prompt each build playbook with what you know

A bug prompt states the symptom and asks for a reproduction first:

```text
/pstack:poteto-mode this command emits two records after a retry. repro first, then fix and verify.
```

A feature prompt states the behavior and what must not change:

```text
/pstack:poteto-mode add a --json flag. text output stays byte-identical. verify both forms.
```

A refactoring prompt pins behavior before structure moves:

```text
/pstack:poteto-mode move parsing into one module, zero behavior change. record the current output first and prove it's unchanged after.
```

A perf prompt states the measurement, not an impression:

```text
/pstack:poteto-mode startup takes 1.8s on this fixture. trace it, fix the measured cause, show me before and after.
```

Each of these routes to its playbook
([Bug fix](../../generated/vibe/skills/poteto-mode/playbooks/bug-fix.md),
[Feature](../../generated/vibe/skills/poteto-mode/playbooks/feature.md),
[Refactoring](../../generated/vibe/skills/poteto-mode/playbooks/refactoring.md),
[Perf issue](../../generated/vibe/skills/poteto-mode/playbooks/perf-issue.md)), and the
playbook supplies the steps you did not type: reproduce before fixing, name the data shape
before implementing, pin behavior before restructuring, profile before optimizing.

For sustained improvement of one number, there is the
[Hillclimb playbook](../../generated/vibe/skills/poteto-mode/playbooks/hillclimb.md). Give it
the metric, a target, and a floor on attempts, and it loops one hypothesis at a time with a
frozen measurement harness. It keeps wins and reverts everything else.

Both perf playbooks run
[`/benchmark-checklist`](../../generated/vibe/skills/benchmark-checklist/SKILL.md) on their
numbers. Perf issue vets its baseline and every number after it, and Hillclimb vets its
harness before freezing it.
[Verify and ship](./06-verify-and-ship.md#vet-a-measured-number-with-benchmark-checklist)
shows when to type it yourself.

Sometimes you want the cause before any fix. For a live symptom, such as a leak, an idle CPU
spin, or a visual glitch, the
[Runtime forensics playbook](../../generated/vibe/skills/poteto-mode/playbooks/runtime-forensics.md)
instruments the running process. For a profile you already captured, the
[Trace forensics playbook](../../generated/vibe/skills/poteto-mode/playbooks/trace-forensics.md)
reads the artifact and maps the hot frame to source. Both return a diagnosis, not a fix:

```text
/pstack:poteto-mode here's a cpuprofile from the slow startup. tell me where the time goes and which source lines own it. no fix yet.
```

## Write the failing test first with `/tdd`

When a bug has a cheap local test path, the whole prompt can be two words:

```text
/tdd implement
```

In context, that is enough. [`/tdd`](../../generated/vibe/skills/tdd/SKILL.md) writes the
smallest test that fails for the intended reason, then the fix, then reruns the test. If a
test would need broad harness setup or brittle mocks, the skill says so and uses the closest
executable check instead. Do not force a test where a real command is stronger evidence.

## Load the TypeScript rules by name

[`typescript-best-practices`](../../generated/vibe/skills/typescript-best-practices/SKILL.md)
turns the type-system principles into concrete rules: discriminated unions, `unknown` at
boundaries, exhaustive variants, schema-derived types. It does not load on its own, so type
`/typescript-best-practices` when a task touches `.ts` or `.tsx` files.

## Clean before you commit

The
[Opening a PR playbook](../../generated/vibe/skills/poteto-mode/playbooks/opening-a-pr.md)
runs the cleanup step on the diff before each commit and applies
[`/unslop`](../../generated/vibe/skills/unslop/SKILL.md) to the PR description and commit
bodies.

Upstream runs `/deslop` here, which ships in the Cursor-only `cursor-team-kit` plugin. Vibe
does not have it, so the port skips that step with one line:

```text
Skipped in Vibe: deslop. It ships in the Cursor-only cursor-team-kit.
```

Ask for the same outcome in plain words: remove narrating comments, unsupported guards, dead
compatibility paths, and unrelated edits. The `no-comments` step below still runs.

For prose, `/unslop` takes a target and any extra rules you have:

```text
/unslop the readme changes, no emdashes
```

You will develop your own shorthand. The skill reads intent fine from terse prompts like
`unslop that, tighten it`.

## Strip the comments with `/no-comments`

Comments need their own pass, and not from the agent that wrote them. An author defends their
comments the way you would defend yours. So before review, hand them to fresh eyes:

```text
/no-comments the diff
```

[`/no-comments`](../../generated/vibe/skills/no-comments/SKILL.md) spawns
[Comment Sicko](../../generated/vibe/ai.mistral.vibe/agents/comment-sicko.toml) on the
`pstack:comment-sicko` profile, a read-only reviewer with a short keep list: license headers,
doc comments on a public API, links that explain what code cannot, behavior forced by an
external dependency you cannot reshape. Everything else goes. A surprise in your own code
gets no such pass. The comment comes back as a refactor flag, and `/no-comments` fixes the
flags it accepts at the root cause. When a comment claims a constraint, "do not remove", the
skill offers to encode the claim as a type, test, or lint. Either way, the comment comes out.

The division of labor is worth keeping straight. The cleanup step removes slop from the code,
`/unslop` removes it from prose, and `/no-comments` hands the comments to a reviewer who did
not write them.

**Pitfall:** cleanup is not optional polish. A diff with narrating comments and defensive dead
weight reads as unfinished to reviewers, and the extra code is where the next bug hides. If
the diff feels padded, say `deslop it` before you commit, not after review calls it out.

Next: [Verify and ship](./06-verify-and-ship.md).
