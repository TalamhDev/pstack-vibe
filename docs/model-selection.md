# Model selection

This page records the evidence behind pstack-vibe's default model policy and the role table
that `/setup-pstack` writes. It is a decision record, not a live leaderboard. Recheck the
sources before you change a default.

## Decision

The port defaults to three model families:

| Role | Default family | Profile |
| --- | --- | --- |
| Main orchestrator, code delegates, judgment, prose, swarm workers, formal verification | DeepSeek V4.1 Flash 1017 | `pstack-deepseek` |
| Adversarial reviewer, interrogate and architect panels, cross-judge | GLM 5.3 | `pstack-glm` |
| Security review, arena runner | Mistral Large 4 | `pstack-ml4` |

DeepSeek is the default because pstack's work is agentic coding: long-horizon edits, bug
fixes, refactors, and verification against a real artifact. DeepSeek leads the coding and
agentic benchmarks in the table below, and it is substantially cheaper. GLM's value is a
different family in an adversarial panel, where a second model finds different failures. GLM
wins HLE, a knowledge-heavy reasoning benchmark, but that is not the shape of most pstack
tasks. Mistral Large 4 leads vulnerability reproduction and patching, so it owns security
review, and its design judgment earns it an arena seat.

Arena runs all three families. The cross-judge pool is GLM, Mistral Large 4, and DeepSeek, so
the judge comes from a family other than the parent. Architect runs DeepSeek and GLM.
Interrogate reviews with GLM and DeepSeek.

## Benchmark table

The table is the comparison recorded when the port chose its defaults. Higher is better
unless a row says otherwise.

| Signal | DeepSeek V4.1 Flash 1017 | GLM 5.3 |
| --- | ---: | ---: |
| DeepSWE v1.1 | 77.0 | 66.9 |
| Terminal-Bench 3.0 / 2.1 | 30.0 / 90.6 | 28.3 / 88.2 |
| AutomationBench | 60.5 | 48.8 |
| NL2Repo | 68.2 | 58.0 |
| ProgramBench | 29.1 | 19.0 |
| CursorBench 4.0 | 47.7 | 42.6 |
| Bug Hunt | 39.1 | 19.0 |
| HLE (no tools) | 36.8 | 42.0 |
| Published price, input/output per M | $0.30 / $1.20 | $1.40 / $4.40 |
| Cached input per M | $0.007 | $0.26 |

DeepSeek leads every coding and agentic benchmark row in the table. GLM wins HLE, a
knowledge-heavy reasoning benchmark; that is not the shape of most pstack tasks, so it does
not justify making GLM the default. GLM's value is a different family in an adversarial panel,
where a second model finds different failures.

### Security

Mistral Large 4 leads the security signals the decision used:

| Signal | Mistral Large 4 | Source |
| --- | ---: | --- |
| CyberGym-E2E, reproduce and patch a real vulnerability | 82% | Mistral; Artificial Analysis |
| Cybench, 40 security challenges | 93% | Mistral |

Mistral reports 82% as the highest score of any model on the reproduce-and-patch test. Closed
peers score near zero on some runs because they refuse the task, so read the gap as a
capability and policy difference, not only a capability difference. Artificial Analysis
measured 82% for Mistral Large 4 Preview and 79% for Mistral Large 4 (High) on
CyberGym-E2E-AA.

## Cost and local checks

Published prices at decision time were $0.30 input and $1.20 output per million tokens for
DeepSeek, and $1.40 and $4.40 for GLM. Cached input was $0.007 per million for DeepSeek and
$0.26 for GLM. The gap is large enough that a default role on DeepSeek saves real money on a
long run.

Two local agentic tasks passed on both models. DeepSeek was 4.4x and 5.9x cheaper on those
tasks, and 1.3x and 1.5x faster. Two tasks are a smoke test, not a benchmark. They support the
price and latency direction, and they do not prove a quality difference on their own.

## Caveats

- **Vendor-run benchmarks.** DeepSeek, Z.ai, and Mistral each publish their own comparison
  tables. The harness, prompts, and grading can differ between vendors, so treat a single
  row as a rough signal. Prefer a benchmark that an independent party ran.
- **DeepSWE is contested.** Epoch AI reviewed DeepSWE v1.1 and found issues in at least 23 of
  113 tasks, then designated the benchmark as flawed. DeepSWE carries much of the headline
  coding gap, so the decision does not rest on it alone. AutomationBench, NL2Repo,
  ProgramBench, CursorBench, and Bug Hunt point the same way.
- **A benchmark is not your repository.** The only reliable test is your own work. Run a task
  on both models, keep the prompts and checks identical, and compare the evidence. If your
  work is mostly prose or knowledge-heavy reasoning, GLM may deserve more roles than the
  default table gives it.

## Role table

`/setup-pstack` writes this table, with the three confirmed aliases substituted for the
default families. The build-time copy is `model-sheet/roles.toml`; the installed copy is
`ai.mistral.vibe/knowledge/pstack-models/KNOWLEDGE.md`.

| Role | Default profiles | Why |
| --- | --- | --- |
| `feature, refactoring` | `pstack-deepseek` | Agentic code execution; DeepSeek leads the coding rows. |
| `bug-fix` | `pstack-deepseek` | Same. |
| `perf-issue` | `pstack-deepseek` | Same. |
| `hillclimb` | `pstack-deepseek` | Same. |
| `judgment and prose` | `pstack-deepseek` | No benchmark shows GLM better at pstack's judgment work, and DeepSeek is cheaper. |
| `hardest tasks` | `pstack-deepseek` | The hardest tier is long-horizon coding, where DeepSeek leads. |
| `reflect tooling` | `pstack-deepseek` | Code-shaped work. |
| `reflect judgment, divergent, synthesizer` | `pstack-deepseek` | Judgment; DeepSeek is the default. |
| `swarm workers` | `pstack-deepseek` | Volume work; cheapest and fastest. |
| `arena runners` | `pstack-deepseek`, `pstack-glm`, `pstack-ml4` | Three families for design bakeoffs; ML4 adds design and security judgment. |
| `arena cross-judge pool` | `pstack-glm`, `pstack-ml4`, `pstack-deepseek` | The judge comes from a different family than the parent. |
| `architect runners` | `pstack-deepseek`, `pstack-glm` | Two families for design exploration. |
| `interrogate reviewers` | `pstack-glm`, `pstack-deepseek` | Adversarial review stays on the two strongest coding families. |
| `security review` | `pstack-ml4` | Security-specific review, security review-thread triage, and security-sensitive blast-radius work. |
| `formal verification` | `pstack-deepseek` | Rigor work, not security-specific. |

`security review` applies to security review-thread triage, a security-specific review
request, and a `blast-radius` run where the user names security, auth, privacy, or data risk.
It is not the default for general code review or adversarial review. Those stay on DeepSeek
and GLM.

## Sources

- DeepSeek V4.1 Flash 1017 model card: https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017
- DeepSeek V4.1 Flash 1017 on Artificial Analysis: https://artificialanalysis.ai/models/deepseek-v4-1-flash-1017
- Mistral Large 4 announcement: https://mistral.ai/news/mistral-large-4/
- Artificial Analysis CyberGym-E2E-AA: https://artificialanalysis.ai/evaluations/cybergym-e2e-aa
- CursorBench 4.0 leaderboard: https://cursor.com/cursorbench
- Bug Hunt Bench: https://github.com/phuryn/bug-hunt-bench
- Epoch AI benchmark reviews, including DeepSWE v1.1: https://epoch.ai/benchmarks
- Terminal-Bench leaderboard: https://www.tbench.ai/leaderboard

The local checks were run by the port author on two agentic tasks. They are not published.
