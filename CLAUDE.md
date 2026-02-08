# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MMM-Openclaw is a MagicMirror² module that connects to OpenClaw Gateway via WebSocket, turning a smart mirror into an AI-powered family command center. The system runs on a three-tier architecture:

- **Mac (Development)**: VS Code, local testing with mock gateway
- **Raspberry Pi (Display)**: MagicMirror² running on Samsung Frame TV with the MMM-Openclaw module
- **AWS (Backend)**: OpenClaw Gateway + Claude agent + Skills

## ⚠️ CRITICAL SECURITY RULES

**NEVER do the following without EXPLICIT user permission:**

1. **❌ DO NOT download OpenClaw files from AWS to local Mac**
   - OpenClaw configuration files (`~/.openclaw/*`) contain sensitive data
   - Gateway tokens, API keys, credentials, session data
   - These files must stay on AWS only

2. **❌ DO NOT download OpenClaw files from AWS to Raspberry Pi**
   - The Pi only runs MagicMirror module code
   - OpenClaw runtime stays on AWS
   - Only the MMM-Openclaw module belongs on the Pi

3. **❌ DO NOT move code between devices without explicit permission**
   - Always ask before: `scp`, `rsync`, file transfers
   - **ASK LOUDLY** and clearly state what you're about to move and why
   - Example: "⚠️ WARNING: About to copy skills/ from Mac to AWS. This will overwrite existing skills on AWS. Proceed? (yes/no)"

4. **❌ DO NOT commit secrets, keys, or PII to Git**
   - API keys, tokens, passwords NEVER go in Git
   - Gateway tokens, AWS credentials, SSH keys stay local
   - Personal information (names, phone numbers, addresses) stays local
   - Use `.env` for secrets (already git-ignored)
   - If you see credentials in code, **STOP and warn the user immediately**

5. **✅ ALLOWED operations:**
   - Deploying MMM-Openclaw module from Mac → Pi (via `./scripts/deploy.sh`)
   - Deploying skills from Mac → AWS (when explicitly requested)
   - Reading files for analysis (but not downloading)
   - Committing code changes (after verifying no secrets)

**When in doubt: ASK FIRST, MOVE LATER.**

### Files That Must NEVER Be Committed:
- `.env` - Contains all secrets and tokens
- `*.pem` - SSH private keys
- `*_key`, `*_secret` - Any credential files
- `openclaw.json` - Contains OpenClaw configuration with tokens
- Any file containing API keys, passwords, or personal information

These are already in `.gitignore` but verify before any commit.

## Development Commands

### Initial Setup (One-Time)
```bash
./scripts/setup-mac.sh
```
Clones MagicMirror to `.magicmirror-dev/`, symlinks the module, installs dependencies, creates config and `.env` file.

### Daily Development
```bash
# Test with mock gateway (no OpenClaw needed)
./scripts/dev.sh --mock

# Test with real OpenClaw Gateway
./scripts/dev.sh

# Server-only mode (access at localhost:8080)
./scripts/dev.sh --server
```

### Deployment
```bash
# Deploy module to Pi and restart MagicMirror
./scripts/deploy.sh

# Also deploy skills to OpenClaw
./scripts/deploy.sh --skills

# Preview what would sync
./scripts/deploy.sh --dry-run

# Deploy without restart
./scripts/deploy.sh --no-restart
```

### Testing in Browser Console
When MagicMirror is running (Cmd+Option+I for DevTools):
```javascript
// Get module instance
const openclaw = MM.getModules().withClass("MMM-Openclaw")[0];

// Send test queries
openclaw.sendQuery("Hello!");
openclaw.sendQuery("morning briefing");
openclaw.sendQuery("quiz me on math");

// Inspect state
openclaw.messages       // Message history
openclaw.isConnected    // Connection status
openclaw.config         // Current configuration
```

Monitor WebSocket frames in DevTools Network tab → WS.

## Architecture Deep Dive

### Dual Process Model
MagicMirror modules run in two processes:

1. **Frontend (`MMM-Openclaw.js`)**: Runs in Electron renderer, handles DOM and UI
2. **Backend (`node_helper.js`)**: Runs in Node.js, handles WebSocket connection to Gateway

Communication between them uses `sendSocketNotification()` and `socketNotificationReceived()`.

### OpenClaw Gateway Protocol
The node_helper implements the full Gateway protocol (v3):

**Connection Flow:**
1. WebSocket opens
2. Gateway may send `event: connect.challenge` with nonce
3. Client sends `req: connect` with auth token + optional nonce signature
4. Gateway responds `res: hello-ok` with protocol version and policy (tick interval)
5. Client is now connected and can send `req: chat.send`

**Frame Types:**
- `req` (client → gateway): Request with id, method, params
- `res` (gateway → client): Response with id, ok, payload/error
- `event` (gateway → client): Async events (agent status, chat messages, presence)

**Key Methods:**
- `connect`: Handshake (node_helper.js:122-188)
- `chat.send`: Send user message (node_helper.js:340-379)
- `chat.history`: Fetch recent messages (node_helper.js:381-398)
- `health`: Keepalive ping (used in tick timer node_helper.js:449-463)

**Agent Events** (node_helper.js:274-304):
- `thinking`: Agent is processing (show typing indicator)
- `streaming`: Streaming text delta (could display in real-time)
- `tool_use`: Agent is calling a tool
- `done`: Final response with summary
- `error`: Agent error

### Message Flow Example
```
User types in console →
  openclaw.sendQuery() →
    sendSocketNotification("OPENCLAW_SEND_MESSAGE") →
      node_helper receives →
        _sendChatMessage() →
          _sendRequest("chat.send") →
            WebSocket frame to Gateway →
              Gateway processes →
                Agent thinks/uses tools →
                  Gateway sends agent events →
                    node_helper _handleAgentEvent() →
                      sendSocketNotification("OPENCLAW_RESPONSE") →
                        frontend socketNotificationReceived() →
                          _addMessage() →
                            updateDom() →
                              User sees response
```

### Reconnection Strategy
node_helper.js:468-489 implements exponential backoff:
- Starts at 1s delay
- Doubles on each attempt (max 60s)
- Max 15 attempts before giving up
- Resets counter on successful connection

### Skill System
Skills live in `skills/*/SKILL.md` and follow OpenClaw SKILL.md format:
- YAML frontmatter: name, description, metadata (emoji, requires)
- Markdown body: Natural language instructions for the agent

**Four Built-in Skills:**
1. **magic-mirror**: Display-aware formatting (always active, optimizes all responses for TV viewing)
2. **family-briefing**: Scheduled morning/evening briefings with calendar + weather + tasks
3. **task-manager**: Natural language task CRUD with family assignment
4. **study-companion**: Interactive quizzes and homework help for kids

Skills are deployed to `~/.openclaw/skills/` on the OpenClaw host (Pi or AWS) via `./scripts/deploy.sh --skills`.

### Configuration Priority
`.magicmirror-dev/config/config.js` (line 189-190):
```javascript
gatewayUrl: process.env.OPENCLAW_GATEWAY_URL || "ws://127.0.0.1:18789",
gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN || "",
```

Load `.env` file → environment variables → fallback to defaults.

## Critical Code Locations

> **Note:** Line numbers below are approximate and may drift as code evolves. Use them as starting points.

### Frontend (MMM-Openclaw.js)
- Line 153-215: Socket notification handlers (processes messages from node_helper)
- Line 112-131: Message rendering with markdown parsing
- Line 254-270: Message history management and trimming
- Line 42-44: CSS themes (`openclaw-theme-{default|minimal|briefing}`)

### Backend (node_helper.js)
- Line 68-117: WebSocket lifecycle (open, message, close, error)
- Line 193-272: Message routing (events, responses, gateway requests)
- Line 274-304: Agent event handler (streaming, thinking, done states)
- Line 403-444: Request/response infrastructure with timeout handling
- Line 501-509: Device ID generation and idempotency keys

### Mock Gateway (tools/mock-gateway.js)
- Line 166-189: Response generation for testing
- Line 191-207: Briefing generation
- Line 137-158: Demo mode (proactive briefings every 30s)

### Skills
Each SKILL.md has:
- Trigger phrases in `description` field (used by agent to activate skill)
- Display formatting rules (max 3 lines per paragraph, bold key info)
- Data source integration (Google Calendar, Todoist, weather APIs)
- Example outputs optimized for 32" Samsung Frame TV at 3-8 feet viewing distance

## Display Constraints

The Samsung Frame TV 32" has specific UX requirements (see skills/magic-mirror/SKILL.md):
- **Viewing distance**: 3-8 feet (people walking past)
- **Glance time**: 3-10 seconds typical interaction
- **Max paragraph length**: 3 lines
- **Response length**: Under 150 words ideal
- **Formatting**: Bold key info, one emoji per section, skip pleasantries

When editing skills or responses, always format for **glanceable reading on a wall display**, not desktop/mobile.

## Cross-Module Communication

Other MagicMirror modules can interact via notifications:

**Send query to OpenClaw:**
```javascript
this.sendNotification("OPENCLAW_QUERY", "What's the weather?");
```

**Receive responses:**
```javascript
notificationReceived(notification, payload) {
  if (notification === "OPENCLAW_RESPONSE") {
    console.log(payload.content);
  }
}
```

Toggle with config: `allowNotificationTriggers: true`, `broadcastResponses: true`

## Cron Integration

Configure scheduled briefings in `~/.openclaw/cron/jobs.json` on OpenClaw host:
```json
[
  {
    "name": "morning-briefing",
    "schedule": "0 7 * * 1-5",
    "message": "Generate a morning family briefing for the mirror display.",
    "channel": "webchat"
  }
]
```

Responses arrive as `event: chat.message` via WebSocket, handled by node_helper.js:306-315.

## Briefing Tool Commands

Briefing prompts use `{{calendarCmd}}` and `{{taskCmd}}` template variables that are replaced at runtime from config. This keeps account-specific details out of the module code.

**In Pi `config.js`** (deployment-specific):
```javascript
calendarCmd: "gog calendar list --account you@gmail.com",
taskCmd: "todoist",
```

**In `MMM-Openclaw.js` defaults** (generic, no account):
```javascript
calendarCmd: "gog calendar list",
taskCmd: "todoist",
```

**How it works:**
- Briefing messages contain `{{calendarCmd}}` and `{{taskCmd}}` placeholders
- `node_helper.js:_expandMessage()` replaces them with config values before sending to Gateway
- The OpenClaw agent receives the expanded command and executes it via shell

**IMPORTANT — No hardcoding:**
- Account emails, API keys, and user-specific details belong ONLY in the Pi's `config.js`
- Module code (`MMM-Openclaw.js`, `node_helper.js`) must NEVER contain account-specific values
- If adding new tool integrations, use the same `{{placeholder}}` pattern

**AWS prerequisites for briefing tools:**
- `gog` CLI must be installed and authenticated (`gog auth add --manual --services calendar --readonly`)
- `gog` must be in the agent's PATH (symlink to `/usr/local/bin/gog` if installed via linuxbrew)
- `todoist` skill installed via `npx clawhub install todoist`
- `weather` skill must be eligible (check `openclaw skills status`)

## Environment Variables

Required in `.env`:
```bash
OPENCLAW_GATEWAY_URL=wss://your-openclaw.example.com:18789
OPENCLAW_GATEWAY_TOKEN=your-gateway-token
PI_HOST=pi@raspberrypi.local
PI_MODULE_PATH=/home/pi/MagicMirror/modules/MMM-Openclaw
```

Optional:
```bash
OPENCLAW_SKILLS_PATH=/home/pi/.openclaw/skills
```

## File Structure Notes

```
MMM-Openclaw/
├── MMM-Openclaw.js       # Frontend: DOM, UI, notifications FROM node_helper
├── node_helper.js        # Backend: WebSocket client, Gateway protocol
├── MMM-Openclaw.css      # Three themes (default, minimal, briefing)
├── package.json          # Only dependency: ws (WebSocket library)
└── tools/
    └── mock-gateway.js   # Local testing server (simulates OpenClaw Gateway)

skills/                   # OpenClaw skills (deploy separately)
├── magic-mirror/         # Display-aware formatting (always active)
├── family-briefing/      # Scheduled briefings
├── task-manager/         # Natural language task CRUD
└── study-companion/      # Interactive quizzes for kids

scripts/
├── setup-mac.sh          # One-time: clone MM, symlink module, install deps
├── dev.sh                # Daily: run MM with mock or real gateway
└── deploy.sh             # Deploy to Pi, optionally sync skills
```

The `.magicmirror-dev/` directory is git-ignored and contains a full MagicMirror installation for local testing.

## Common Pitfalls

1. **Editing wrong file**: The repo root is symlinked into `.magicmirror-dev/modules/MMM-Openclaw/`. Always edit files at the repo root (e.g., `./MMM-Openclaw.js`), not inside the symlink target.

2. **Skills not loading**: Skills must be deployed to the OpenClaw host (where the agent runs), not to the Pi running MagicMirror. Use `./scripts/deploy.sh --skills` if OpenClaw runs on the Pi, or manually sync to your AWS instance.

3. **WebSocket connection fails**: Check `.env` has correct `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN`. Verify Gateway is running and accessible (try `wscat -c wss://your-host:18789`).

4. **Changes not showing**: After editing JS files, restart MagicMirror (Ctrl+C and `./scripts/dev.sh` again). CSS changes may need a hard refresh (Cmd+Shift+R in Electron).

5. **Module not visible**: Check MagicMirror config has the module with correct `position` (e.g., `bottom_bar`). Verify module loaded with `MM.getModules().withClass("MMM-Openclaw")` in console.

## Theme System

Three themes in MMM-Openclaw.css:

- **default**: Chat-style bubbles, color-coded by role (user=blue, assistant=green, system=yellow)
- **minimal**: Clean text, no bubbles, dimmed user messages
- **briefing**: Large format, assistant-only, left-bordered cards for scheduled briefings

Switch with `theme: "default"` in config. The wrapper gets class `openclaw-theme-{themeName}`.
