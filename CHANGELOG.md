# Changelog

All notable changes to pstack-vibe are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses a
`<upstream-version>-vibe.<n>` version scheme.

## [Unreleased]

### Added

- `npx pstack-vibe`, a Node CLI with `install`, `update`, `uninstall`, `doctor`, and `verify`.
- A Vibe compatibility gate. The installer reads `vibe --version` and refuses to install
  outside the range derived from the `vibe.tested` list in `package.json`, naming both the
  range and the version it found.
- `verify`, which installs into a temporary Vibe home, runs the doctor, drives a real session
  against the local mock provider to prove the session-start hook delivered the model sheet,
  and removes the home.
- A tenth doctor check, `vibe-compat`, so a Vibe that upgraded past the tested range shows up
  in `doctor` and not only at install time.
- A CI `compat` matrix that runs `verify` against every version in `vibe.tested`, so the
  declared range cannot drift from the versions that actually pass.
- Windows support. `install`, `doctor`, and `verify` work on Windows, and CI runs the test
  suite and `verify` there.

### Changed

- The installer and doctor are Node, not POSIX `sh`. `bin/pstack-vibe.mjs` replaces
  `scripts/install.sh` and `scripts/doctor.sh`.
- The install is atomic. It stages a copy inside the plugins directory and renames it into
  place, so an interrupted install never leaves a half-written plugin.
- `install` requires `vibe` on `PATH`, including under `--dry-run`, because the gate runs
  before the dry-run branch.
- The chain gate forbids `pstack-vibe install --force` as well as `update`, since `update` is
  `install --force`.
- The package is publishable. `private` is removed, and `bin`, `exports`, `files`, and
  `engines` are set.
- The session-start hook and the chain scripts are Node, not POSIX `sh`. `hooks.toml` invokes
  `node` on a path relative to the plugin root, so the hook commands work everywhere Vibe
  runs them, including PowerShell on Windows.

### Removed

- `scripts/install.sh`, `scripts/doctor.sh`, `scripts/remove-tree.sh`, and their three shell
  tests, replaced by `src/` and the Node test suites.
- `adapters/vibe/scripts/session-start.sh`, `chain.sh`, and `json.sh`, and their three shell
  tests, replaced by `session-start.mjs`, `chain.mjs`, and the Node test suites.

### Fixed

- The agent profiles pstack writes no longer carry `schema_version`. Vibe does not read it, so
  it landed in the profile's config overrides and raised `UnusedConfigKeysError`, which Vibe
  logged as a warning on every session start.
- `doctor`'s agent-profiles line says what it checked. It proves the file exists, not that Vibe
  binds the profile, and it now says so instead of reporting the profiles as installed.

## [0.15.42-vibe.1] - 2026-11-16

The first release. pstack 0.15.42, ported to the Mistral Vibe CLI.

### Added

- The generated Vibe plugin tree at `generated/vibe/`: `plugin.json`, 58 skills, the guide,
  the `session_start` hook, and the `poteto-agent`, `comment-sicko`, and `readonly` agent
  profiles.
- The Cursor-to-Vibe adapter at `docs/harness/vibe.md`, also installed as
  `ai.mistral.vibe/knowledge/pstack-vibe/KNOWLEDGE.md`.
- The default role table at `model-sheet/roles.toml`, installed as
  `ai.mistral.vibe/knowledge/pstack-models/KNOWLEDGE.md`.
- `/setup-pstack` for Vibe: model detection, a reasoning budget, the three key roles, the
  model sheet at `~/.vibe/pstack-models.md`, and the `pstack-<family>` agent profiles.
- Forks for the skills that need more than a name substitution: `poteto-mode`,
  `setup-pstack`, `arena`, `swarm`, `reflect`, `interrogate`, `how`, `no-comments`,
  `poteto-help`, `architect`, the `poteto-mode` playbooks, the bugbot triage reference, the
  reflect synthesizer, and the worktree audit script.
- `scripts/install.sh` for install, update, uninstall, and doctor, with user and project
  scope, `--dry-run`, `--force`, and `--purge`.
- `scripts/doctor.sh` checks for Vibe, the manifest, the skills, the hook, the model sheet,
  the profiles, and the model aliases.
- The README, security notes, model evidence, and the Vibe-specific guide.

### Changed

- `Task` becomes `agents.spawn`, with `name`, `message`, `config_name`, and `instructions`.
  Every spawn is asynchronous, and a child's report arrives as a message.
- Cursor model slugs become pstack agent profiles. DeepSeek V4.1 Flash 1017 is the default,
  GLM 5.3 is the adversarial reviewer, and Mistral Large 4 is the security reviewer and an
  arena runner.
- Cursor paths become Vibe paths: `~/.vibe/plugins/`, `~/.vibe/skills/`, `~/.vibe/agents/`,
  `~/.vibe/pstack-models.md`, and `~/.vibe/logs/session/`.
- Tool names become Vibe names: `read_file`, `write_file`, `edit`, `ask_user_question`, and
  shell `rg` or `find` for search and listing.

### Fixed

- The `poteto-agent` description now fits Vibe's 300-character plugin agent limit.
- The session-start hook reads the session folder from the hook payload's `cwd`, so a
  project-scope model sheet is found when Vibe runs the hook from its pinned plugin copy.
- The generated knowledge entries carry the required `name` and `description` frontmatter.
- The installed plugin ships a Vibe-specific README and no longer ships the upstream Cursor
  guide.
- `make-bot-ui` carries a skip note for Cursor Automations, and session pickup points at
  `~/.vibe/logs/session/` instead of Cursor agent transcripts.
- The model evidence records GLM's HLE win instead of claiming DeepSeek leads every row.
- Setup and the docs say to start a new session for model sheets and agent profiles.
- The `readonly` profile's bash allowlist no longer permits `git` or `sed`.
- Added `scripts/sync.mjs` for upstream syncs.

### Removed

- Cursor-only steps are skipped with a one-line note: Bugbot, Cursor Automations, cloud
  agents, Custom Modes, `cursor-team-kit` (`deslop`, `control-cli`, `control-ui`), and
  Cursor's built-in `/create-skill`. Vibe's `skill-creator` replaces the last one.

### Upstream

- Repository: https://github.com/cursor/plugins/tree/main/pstack
- Pin: `bf0c7cd80abdbf7fe47b634978a7d1b4071f71a7`
- Version: `0.15.42`
- License: MIT, copyright 2026 Lauren Tan. The notice is preserved in
  `vendor/pstack/LICENSE` and summarized in `NOTICE.md`.

[0.15.42-vibe.1]: https://github.com/telamh/pstack-vibe/releases/tag/v0.15.42-vibe.1
