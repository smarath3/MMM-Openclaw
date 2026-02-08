# MMM-Openclaw 🦞

A [MagicMirror²](https://magicmirror.builders/) module that connects to [OpenClaw](https://github.com/openclaw/openclaw) — turning your smart mirror into a family command center with AI-powered briefings, task management, and interactive study help.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![MagicMirror²](https://img.shields.io/badge/MagicMirror²-Module-blueviolet.svg)
![OpenClaw](https://img.shields.io/badge/OpenClaw-Skills-orange.svg)

## Features

- **🗓️ Family Briefings** — Scheduled morning/evening summaries with calendar, weather, and tasks
- **✅ Task Manager** — Natural language task creation, assignment, and tracking
- **📚 Study Companion** — Age-appropriate per-child quizzes with configurable curriculum and STEM subjects
- **🪞 Display-Aware** — Responses optimized for glanceable reading on a wall display
- **📱 Multi-Channel Input** — Send messages from WhatsApp or Telegram; responses display on the mirror with channel badges
- **👤 Sender Context** — Channel badges ("via WhatsApp") and sender names shown on message bubbles
- **🎯 Content-Aware Formatting** — Quiz, task, and summary content get distinct visual treatment
- **🔌 Cross-Module** — Other MagicMirror modules can query OpenClaw via notifications
- **⚡ Real-Time** — WebSocket connection to OpenClaw Gateway with streaming responses
- **🎨 Three Themes** — Default (chat bubbles), Minimal (clean text), Briefing (large format)

## How It Works

```
Raspberry Pi (Display)              Your Server (OpenClaw)
┌──────────────────────┐            ┌──────────────────────┐
│  MagicMirror²        │    WS     │  OpenClaw Gateway    │
│  └─ MMM-Openclaw    │◄═════════►│  └─ Agent (Claude)   │
│     └─ Your Display  │            │     └─ Skills        │
│     └─ Microphone    │            │     └─ Tools         │
└──────────────────────┘            └──────────────────────┘
```

The module connects to your OpenClaw Gateway as a WebSocket operator client, sends messages via `chat.send`, and displays agent responses on the mirror. Cron jobs on OpenClaw push proactive briefings at scheduled times.

**What is OpenClaw?** [OpenClaw](https://docs.openclaw.ai) is a personal AI assistant framework that runs a Claude-powered agent with custom skills and tool access. It provides a Gateway WebSocket server that clients like this module connect to for real-time AI interactions.

## Prerequisites

- [MagicMirror²](https://docs.magicmirror.builders/getting-started/installation.html) running on Raspberry Pi (or any supported platform)
- [OpenClaw](https://docs.openclaw.ai/start/getting-started) Gateway running and accessible from your Pi
- Node.js >= 18

## Installation

### 1. Install the module

```bash
cd ~/MagicMirror/modules
git clone https://github.com/smarath3/MMM-Openclaw.git
cd MMM-Openclaw && npm install --production
```

### 2. Add to MagicMirror config

Edit `~/MagicMirror/config/config.js`:

```javascript
{
  module: "MMM-Openclaw",
  position: "bottom_bar",
  config: {
    gatewayUrl: "ws://YOUR_OPENCLAW_HOST:18789",
    gatewayToken: "your-gateway-token",
    sessionName: "family-mirror",
    maxMessages: 8,
    theme: "default",

    // Multi-channel
    displayChannels: [],               // empty = show all channels
    showChannelBadge: true,
    showSenderName: true,

    // Study sessions
    studyStudents: [
      { name: "Emma", age: 12 },
      { name: "Jake", age: 9 },
    ],
    studySubjects: ["Math", "Science"],
    studyQuestionCount: 3,
    studyStandard: "California Common Core",
  }
}
```

### 3. Install OpenClaw skills (optional)

Copy the included skills to your OpenClaw workspace on the machine running the OpenClaw agent (e.g., your AWS server):

```bash
# If OpenClaw runs on the same machine:
cp -r skills/* ~/.openclaw/skills/

# If OpenClaw runs on a remote server:
scp -r skills/* user@openclaw-host:~/.openclaw/skills/
```

### 4. Restart MagicMirror

```bash
pm2 restart MagicMirror
# or
cd ~/MagicMirror && npm start
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `gatewayUrl` | `ws://127.0.0.1:18789` | OpenClaw Gateway WebSocket URL |
| `gatewayToken` | `""` | Gateway authentication token |
| `sessionName` | `"family-mirror"` | Session identifier |
| `maxMessages` | `8` | Max messages shown on display |
| `showTypingIndicator` | `true` | Show animated dots while agent thinks |
| `showConnectionStatus` | `true` | Show green/red connection dot |
| `showTimestamps` | `false` | Show time on each message |
| `theme` | `"default"` | `default`, `minimal`, or `briefing` |
| `allowNotificationTriggers` | `true` | Let other modules send queries |
| `broadcastResponses` | `true` | Broadcast responses to other modules |
| `hideAfterInactivity` | `0` | Auto-hide after ms of inactivity (0 = never) |
| `displayChannels` | `[]` | Filter channels to display (empty = all). E.g. `["whatsapp", "webchat"]` |
| `showChannelBadge` | `true` | Show "via WhatsApp" badge below messages from non-webchat channels |
| `showSenderName` | `true` | Show sender name above message bubbles |
| `studyStudents` | `[]` | Student names and ages. E.g. `[{ name: "Emma", age: 12 }, { name: "Jake", age: 9 }]` |
| `studySubjects` | `["Math", "Science"]` | STEM subjects to rotate through |
| `studyQuestionCount` | `3` | Questions per study session (3-5 recommended) |
| `studyStandard` | `"California Common Core"` | Curriculum standard for grade-level alignment |

## Themes

- **Default** — Chat-style message bubbles with color-coded roles
- **Minimal** — Clean text, no bubbles, user messages dimmed
- **Briefing** — Large format, assistant-only, left-bordered cards

## OpenClaw Skills

Four skills are included for common family mirror use cases:

| Skill | Triggers | What it does |
|-------|----------|--------------|
| `family-briefing` | "morning briefing", "what's today" | Combines calendar + weather + tasks into a summary |
| `task-manager` | "add to the list", "what needs to be done" | Natural language task CRUD with family assignment |
| `study-companion` | "quiz me", "homework help" | Age-appropriate per-child quizzes with configurable curriculum, STEM subjects, and progress tracking |
| `magic-mirror` | Always active | Formats all responses for glanceable display |

### Scheduled briefings

Add cron jobs to your OpenClaw config for automatic briefings:

```jsonc
// ~/.openclaw/cron/jobs.json
[
  {
    "name": "morning-briefing",
    "schedule": "0 7 * * 1-5",
    "message": "Generate a morning family briefing for the mirror display.",
    "channel": "webchat"
  }
]
```

#### Scheduled Study Sessions

Add an afternoon study session alongside your briefings:

```jsonc
{
  "name": "afternoon-study",
  "schedule": "0 16 * * 1-5",
  "message": "Run a study session for Emma (age 12) and Jake (age 9) on Math, Science. Use 3 questions aligned to California Common Core.",
  "channel": "webchat"
}
```

> **Note:** OpenClaw cron jobs use literal values, not template variables. The `{{studyStudents}}`, `{{studySubjects}}`, etc. placeholders only work when messages are sent through the MagicMirror module (which expands them from your `config.js`). For cron jobs, write the actual student names and subjects directly in the message.

## Cross-Module Communication

Other MagicMirror modules can interact with OpenClaw:

```javascript
// Send a query from any module
this.sendNotification("OPENCLAW_QUERY", "What's the weather today?");

// Listen for responses
notificationReceived(notification, payload) {
  if (notification === "OPENCLAW_RESPONSE") {
    console.log("OpenClaw said:", payload.content);
  }
}
```

## Multi-Channel Input

Messages sent to OpenClaw from any channel — WhatsApp, Telegram, webchat console, or cron jobs — appear on the mirror. The display shows ALL agent responses regardless of where the input originated, with channel badges and sender names for context.

**Example flow:**

1. Parent sends "quiz Emma on math" via WhatsApp
2. OpenClaw agent processes the request
3. Response appears on the Samsung Frame TV with a "via WhatsApp" badge and sender name
4. Any channel works — WhatsApp, Telegram, webchat console, cron jobs

Use `displayChannels` config to filter which channels appear on the mirror (empty array = show all). Set `showChannelBadge: false` or `showSenderName: false` to hide the metadata.

## Quick Start (Without OpenClaw)

You can try the module locally with the included mock gateway — no OpenClaw server needed:

```bash
git clone https://github.com/smarath3/MMM-Openclaw.git
cd MMM-Openclaw
./scripts/setup-mac.sh        # One-time: installs local MagicMirror + symlinks module
./scripts/dev.sh --mock        # Starts mock gateway + MagicMirror
```

MagicMirror opens in Electron. Open DevTools (Cmd+Option+I) and run:

```javascript
MM.getModules().withClass("MMM-Openclaw")[0].sendQuery("Hello!");
```

Use `--whatsapp` or `--demo` flags with `--mock` to simulate multi-channel input or proactive briefings:

```bash
./scripts/dev.sh --mock --whatsapp   # Simulate WhatsApp/Telegram messages
./scripts/dev.sh --mock --demo       # Auto-send briefings every 30s
```

## Development

### Local setup (Mac)

```bash
git clone https://github.com/smarath3/MMM-Openclaw.git
cd MMM-Openclaw
./scripts/setup-mac.sh     # One-time: installs local MagicMirror + symlinks module
./scripts/dev.sh --mock     # Daily: runs mock gateway + MagicMirror
```

### Deploy to Pi

```bash
cp .env.example .env        # Edit with your Pi host + OpenClaw URL
./scripts/deploy.sh --skills # Syncs module + skills to Pi
```

### Testing in browser console

```javascript
// After MagicMirror opens, open DevTools and run:
MM.getModules().withClass("MMM-Openclaw")[0].sendQuery("Hello!");
```

See [docs/architecture.md](docs/architecture.md) for the full system design and Gateway protocol details.

## Project Structure

```
MMM-Openclaw/
├── MMM-Openclaw.js          # Frontend (Electron renderer)
├── MMM-Openclaw.css         # Styles (3 themes)
├── node_helper.js           # Backend (Gateway WebSocket client)
├── package.json
├── tools/
│   └── mock-gateway.js      # Local testing server
├── skills/                  # OpenClaw skills (SKILL.md format)
│   ├── family-briefing/
│   ├── task-manager/
│   ├── study-companion/
│   └── magic-mirror/
├── scripts/                 # Dev workflow scripts
│   ├── setup-mac.sh
│   ├── dev.sh
│   └── deploy.sh
├── docs/
│   └── architecture.md
├── CONTRIBUTING.md
├── CHANGELOG.md
└── LICENSE
```

## Roadmap / TODOs

Contributions welcome! Here are known areas for improvement:

### Streaming Display
- [ ] Show real-time streaming text as the agent types (currently accumulates in `streamBuffer` but doesn't render live)
- [ ] Progressive rendering for long responses

### Challenge-Response Auth
- [ ] Implement nonce signing for Gateway challenge-based authentication (currently only token auth is supported)

### Voice Integration
- [ ] OpenClaw Talk Mode integration for voice input via ReSpeaker mic on Pi
- [ ] TTS output for spoken responses (framework exists via `TTS_SPEAK` notification)

### Study Companion Enhancements
- [ ] Persist quiz progress to `progress.json` on the OpenClaw host
- [ ] Subject rotation based on past session data
- [ ] Multiple-student turn-taking (display one student's quiz at a time)

### Display & UX
- [ ] Dark/light mode auto-switching based on time of day
- [ ] Touch/gesture input support for quiz answers on touchscreen displays
- [ ] Transition animations between content types (briefing → quiz → tasks)
- [ ] Localization / i18n support (currently English-only)

### Testing
- [ ] Unit tests for `_detectContentType()`, `_renderMarkdown()`, `_extractSummary()`
- [ ] Integration tests with mock gateway
- [ ] ESLint configuration and CI pipeline

### Infrastructure
- [ ] Docker-based development environment
- [ ] Automated skill deployment to AWS (currently manual `scp`)
- [ ] Health monitoring dashboard for Gateway connection status

## Troubleshooting

**Module not visible on the mirror**
- Verify `position` is set in config (e.g., `"bottom_bar"`)
- Check console: `MM.getModules().withClass("MMM-Openclaw")` should return an array with one entry
- Ensure `npm install` was run inside the module directory

**WebSocket connection fails**
- Check that `gatewayUrl` and `gatewayToken` are correct
- Verify the Gateway is running: `wscat -c wss://your-host:18789`
- If using Tailscale, ensure both Pi and server are on the same tailnet

**Skills not working**
- Skills must be deployed to the machine running the OpenClaw agent (e.g., AWS), not the Pi
- Verify skills are in `~/.openclaw/skills/` on the agent host
- Check `openclaw skills status` on the agent host

**Deploy fails**
- Ensure `PI_HOST` and `PI_MODULE_PATH` are set in `.env`
- Test SSH access: `ssh $PI_HOST`
- Try `./scripts/deploy.sh --dry-run` to preview what would sync

**Changes not showing after editing**
- Restart MagicMirror (Ctrl+C and `./scripts/dev.sh` again)
- For CSS-only changes, try Cmd+Shift+R in the Electron window

## Related Projects

- [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror) — The smart mirror platform
- [OpenClaw](https://github.com/openclaw/openclaw) — Personal AI assistant framework
- [ClawHub](https://clawhub.ai) — OpenClaw skill registry

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. The easiest way to contribute is by adding new OpenClaw skills.

## License

[MIT](LICENSE)
