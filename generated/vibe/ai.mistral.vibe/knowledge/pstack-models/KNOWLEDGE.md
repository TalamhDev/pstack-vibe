---
name: pstack-models
description: The default pstack role table and the setup contract for model profiles.
---
<!-- pstack-vibe: upstream bf0c7cd, substitutions v1 -->

# pstack model configuration

Default role table for this port. `/pstack:setup-pstack` writes the user's sheet to
`~/.vibe/pstack-models.md` (or `.vibe/pstack-models.md` for a project install).

# defaults: 2
# budget: large (high)
# parent: pstack-deepseek
# deepseek: pstack-deepseek
# glm: pstack-glm
# ml4: pstack-ml4

feature, refactoring: pstack-deepseek
bug-fix: pstack-deepseek
perf-issue: pstack-deepseek
hillclimb: pstack-deepseek
judgment and prose: pstack-deepseek
hardest tasks: pstack-deepseek
reflect tooling: pstack-deepseek
reflect judgment, divergent, synthesizer: pstack-deepseek
swarm workers: pstack-deepseek
arena runners: pstack-deepseek, pstack-glm, pstack-ml4
arena cross-judge pool: pstack-glm, pstack-ml4, pstack-deepseek
architect runners: pstack-deepseek, pstack-glm
interrogate reviewers: pstack-glm, pstack-deepseek
security review: pstack-ml4
formal verification: pstack-deepseek
