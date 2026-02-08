# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-02-08

### Added
- `config/config.js.sample` — complete, copy-paste-ready MagicMirror config with `REPLACE_ME` markers
- "OpenClaw Setup" section in README covering minimum Gateway setup and optional skill/tool prerequisites

### Changed
- Flattened repo structure: module files (`MMM-Openclaw.js`, `node_helper.js`, etc.) now live at the repo root instead of a nested `MMM-Openclaw/` subdirectory, matching MagicMirror's expected module layout
- `scripts/setup-mac.sh`: updated paths for flat layout, added `.gitignore` guard to avoid overwriting, fixed VS Code launch config paths
- `scripts/deploy.sh`: replaced directory rsync with explicit file list (no `--delete` needed)
- `scripts/dev.sh`: fixed mock gateway path, added `--whatsapp` and `--demo` flag passthrough
- `README.md`: fixed installation instructions, added "What is OpenClaw?" explanation, added Quick Start section, added Troubleshooting section, updated project structure diagram, clarified skills deployment target, fixed template variable docs for cron jobs
- `docs/architecture.md`: fixed `client.id` from `"mmm-openclaw"` to `"webchat"`
- `docs/github-setup.md`: updated paths and username references
- `CLAUDE.md`: updated file structure, common pitfalls, added line number caveat

## [0.2.0] - 2026-02-07

### Added
- Multi-channel support: WhatsApp and Telegram messages display on the mirror with channel badges
- Sender name display above message bubbles (configurable via `showSenderName`)
- Channel badge display below messages — "via WhatsApp", "via Telegram", etc. (configurable via `showChannelBadge`)
- Channel filtering via `displayChannels` config (empty = show all)
- Content-aware display formatting: quiz, task, and summary content get distinct CSS classes
- Content-type detection via `_detectContentType()` with regex classification
- Configurable study sessions with per-child names and ages (`studyStudents` config)
- STEM subject selection (`studySubjects`), question count (`studyQuestionCount`), and curriculum standard (`studyStandard`)
- Scheduled afternoon study session (4 PM, disabled by default — enable in Pi config)
- Template variable expansion for study params: `{{studyStudents}}`, `{{studySubjects}}`, `{{studyQuestionCount}}`, `{{studyStandard}}`
- Mock gateway: `--whatsapp` flag for channel metadata simulation
- Mock gateway: content-aware responses for task list, task add, and age-appropriate STEM quizzes
- Updated study-companion skill with age/curriculum-aware Configuration section

### Changed
- `_addMessage()` now accepts optional metadata parameter (channel, sender, senderName)
- `_handleAgentEvent()` and `_handleChatEvent()` now extract and pass sender/senderName metadata
- `_expandMessage()` now expands study-related template variables
- Mock gateway `generateResponse()` enhanced with task and quiz content generators

## [0.1.0] - 2026-02-05

### Added
- Initial MMM-Openclaw MagicMirror module
- OpenClaw Gateway WebSocket integration (protocol v3)
- Three display themes: default, minimal, briefing
- Cross-module notification system (OPENCLAW_QUERY / OPENCLAW_RESPONSE)
- Mock gateway for local development and testing
- Mac development scripts (setup, dev runner, Pi deploy)
- OpenClaw skills:
  - `family-briefing` — Morning/evening family summaries
  - `task-manager` — Natural language task management
  - `study-companion` — Interactive quizzes and homework help
  - `magic-mirror` — Display-aware response formatting
- Architecture documentation
- Contributing guide
