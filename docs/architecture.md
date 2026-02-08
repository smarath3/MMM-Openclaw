# MMM-Openclaw Architecture

## System Overview

```
                                       ┌──────────────────────────────────┐
┌─────────────────┐                    │        AWS (OpenClaw)            │
│   Mac (Dev)     │                    │                                  │
│                 │                    │  ┌────────────────────────────┐  │
│  VS Code        │                    │  │   OpenClaw Gateway :18789  │  │
│  Module source  │                    │  │   ws:// control plane      │  │
│  Local MM test  │                    │  └──────────┬─────────────────┘  │
│                 │                    │        ▲    │    ▲               │
└────────┬────────┘                    │        │    │    │               │
         │                             │  messages   │   messages         │
         │ rsync                       │  from       │   from             │
         │                             │  phone      │   Pi               │
         ▼                             │        │    │    │               │
┌─────────────────┐     WebSocket      │        │    ▼    │               │
│  Raspberry Pi   │◄══════════════════►│  ┌─────┴────────────────────┐  │
│                 │    OpenClaw         │  │   Agent Runtime (Claude)   │  │
│  MagicMirror    │    Gateway          │  └──────────┬─────────────────┘  │
│  MMM-Openclaw   │    Protocol         │             │                    │
│  Samsung Frame  │                    │  ┌──────────▼─────────────────┐  │
│                 │                    │  │   Skills                   │  │
│  ReSpeaker Mic ─┼─ voice ──────────►│  │   • family-briefing        │  │
│  (optional)     │  (Talk Mode)       │  │   • task-manager           │  │
│                 │                    │  │   • study-companion        │  │
└─────────────────┘                    │  │   • magic-mirror           │  │
                                       │  └──────────┬─────────────────┘  │
┌─────────────────┐                    │             │                    │
│  Phone          │     messages       │  ┌──────────▼─────────────────┐  │
│                 │────────────────────►│  │   Tools (Todoist, Calendar) │  │
│  WhatsApp       │    (via OpenClaw   │  │   Cron Jobs (briefings)    │  │
│  Telegram       │     channels)      │  │   Memory / Workspace       │  │
│                 │                    │  └────────────────────────────┘  │
└─────────────────┘                    └──────────────────────────────────┘
```

### Multi-channel message flow (Phase 2)

```
Phone (WhatsApp/Telegram)       Pi (MagicMirror)         Cron (scheduled)
        │                              │                        │
        │ messages                     │ webchat                │ timed triggers
        ▼                              ▼                        ▼
┌───────────────────────────────────────────────────────────────────────┐
│                    OpenClaw Gateway on AWS                           │
│                                                                     │
│   Accepts messages from ALL channels ──► Agent processes once       │
│   Agent response fans out to ALL connected operator clients         │
└──────────────────────────────┬────────────────────────────────────────┘
                               │
                   response with channel metadata
                   (channel, sender, senderName)
                               │
                               ▼
                    ┌─────────────────────┐
                    │  MMM-Openclaw (Pi)  │
                    │  Displays response  │
                    │  + channel badge    │
                    │  + sender name      │
                    └─────────────────────┘
```

## Gateway Protocol

MMM-Openclaw connects as an **operator** client to the OpenClaw Gateway WebSocket.

### Connection flow

```
MMM-Openclaw                           OpenClaw Gateway
    │                                        │
    │──── WebSocket open ──────────────────►  │
    │                                        │
    │  ◄── event: connect.challenge ─────────│  (optional)
    │                                        │
    │──── req: connect ────────────────────► │
    │      {role: "operator",                │
    │       client.id: "webchat",             │
    │       auth: {token: "..."}}            │
    │                                        │
    │  ◄── res: hello-ok ───────────────────│
    │      {protocol: 3,                     │
    │       policy: {tickIntervalMs: 15000}} │
    │                                        │
    │──── req: chat.history ───────────────► │
    │  ◄── res: {messages: [...]} ──────────│
    │                                        │
    │                                        │
    │  ═══ Connected & ready ═══             │
    │                                        │
    │──── req: chat.send ──────────────────► │
    │      {message: "Good morning!",        │
    │       channel: "webchat"}              │
    │                                        │
    │  ◄── res: {accepted: true} ───────────│
    │  ◄── event: agent (thinking) ─────────│
    │  ◄── event: agent (streaming) ────────│  (optional)
    │  ◄── event: agent (done) ─────────────│
    │      {summary: "Here's your..."}       │
    │                                        │
    │                                        │
    │  ◄── event: chat.message ─────────────│  (proactive/cron)
    │      {role: "assistant",               │
    │       content: "Morning briefing..."}  │
```

### Frame types

| Type | Direction | Purpose |
|------|-----------|---------|
| `req` | Client → Gateway | Request with id, method, params |
| `res` | Gateway → Client | Response with id, ok, payload/error |
| `event` | Gateway → Client | Async events (agent, chat, presence) |

### Key methods

| Method | Purpose |
|--------|---------|
| `connect` | Handshake with auth + role |
| `chat.send` | Send user message |
| `chat.history` | Fetch recent messages |
| `chat.inject` | Inject assistant note (no agent run) |
| `health` | Keepalive ping |

## Multi-Channel Architecture

The OpenClaw Gateway accepts messages from multiple input channels. The mirror
acts as a **display surface** -- any message sent from any channel triggers an
agent run whose response appears on the mirror.

### Supported channels

| Channel | Source | How it reaches Gateway |
|---------|--------|----------------------|
| `webchat` | MMM-Openclaw on Pi (or browser) | Direct WebSocket `chat.send` |
| `whatsapp` | WhatsApp on phone | OpenClaw WhatsApp bridge |
| `telegram` | Telegram on phone | OpenClaw Telegram bridge |
| `cron` | Scheduled jobs on AWS | `~/.openclaw/cron/jobs.json` |

### Response fan-out

When any channel sends a message, the Gateway runs the agent once and
broadcasts the final response to **all connected operator clients**. This means
a WhatsApp message sent from your phone produces a response that also appears
on the MagicMirror.

Each response carries channel metadata:

| Field | Type | Description |
|-------|------|-------------|
| `channel` | `string` | Originating channel (`"whatsapp"`, `"telegram"`, `"webchat"`, `"cron"`) |
| `sender` | `string` | Sender identifier (phone number hash, username, etc.) |
| `senderName` | `string` | Human-readable sender name (e.g. `"User"`) |

### Channel filtering

`config.displayChannels` controls which channels the mirror shows:

```javascript
displayChannels: []                       // empty = show ALL channels (default)
displayChannels: ["webchat", "whatsapp"]  // only these two
displayChannels: ["cron"]                 // scheduled briefings only
```

Filtering happens in `node_helper.js:_shouldDisplayChannel()`. Messages from
non-matching channels are silently dropped -- the agent still runs, but the
mirror does not display the response.

### Channel UI rendering

- **Sender name**: Rendered above the message bubble when `showSenderName: true`
  and `msg.senderName` is present (`.openclaw-sender-name`).
- **Channel badge**: Rendered below the message bubble when `showChannelBadge: true`
  and the channel is not `webchat` (`.openclaw-channel-badge`). Displays as
  "via WhatsApp", "via Telegram", etc.
- Channel names are formatted by `_formatChannelName()` in `MMM-Openclaw.js`.

## Content-Type Detection

The frontend classifies each assistant response to apply visual styling without
modifying the agent's output.

### Detection logic

`_detectContentType()` in `MMM-Openclaw.js` uses regex patterns:

| Content type | CSS class | Detection rules |
|--------------|-----------|-----------------|
| `quiz` | `.openclaw-content-quiz` | Contains `A) ` / `B) ` answer options, or words "quiz" / "question" |
| `tasks` | `.openclaw-content-tasks` | Contains task-related words ("task", "to-do", "chore") AND bullet markers (`- ` or `* `) |
| `summary` | `.openclaw-content-summary` | Contains "briefing", "schedule", or "forecast" |
| `null` | (none) | No pattern matched -- default styling |

### How it works

```
Agent response text
        │
        ▼
_detectContentType(content)    ◄── regex classification
        │
        ▼
bubble.classList.add("openclaw-content-quiz")
        │
        ▼
CSS applies visual differentiation
  (border color, icon, font weight, etc.)
```

The detection is purely cosmetic. It does not alter the message content or
affect routing. Themes in `MMM-Openclaw.css` can target these classes to
style quizzes, task lists, and briefing summaries differently.

## Study Session Configuration

Study sessions use the same template variable system as briefings, keeping
personal data (student names, ages) in the Pi's `config.js` and out of the
module source code.

### Template variables

| Variable | Config key | Default | Example expansion |
|----------|-----------|---------|-------------------|
| `{{studyStudents}}` | `studyStudents` | `"a student (age 8)"` | `"Aarav (age 8), Priya (age 6)"` |
| `{{studySubjects}}` | `studySubjects` | `"Math, Science"` | `"Math, Science, Reading"` |
| `{{studyQuestionCount}}` | `studyQuestionCount` | `3` | `5` |
| `{{studyStandard}}` | `studyStandard` | `"California Common Core"` | `"Texas TEKS"` |
| `{{calendarCmd}}` | `calendarCmd` | `"gog calendar list"` | `"gog calendar list --account you@gmail.com"` |
| `{{taskCmd}}` | `taskCmd` | `"todoist"` | `"todoist tasks list"` |
| `{{date}}` | *(computed)* | *(today)* | `"Saturday, February 7, 2026"` |

### Expansion flow

```
scheduledBriefings[].message         ◄── contains {{studyStudents}}, {{calendarCmd}}, etc.
        │
        ▼
node_helper._expandMessage()         ◄── replaces all {{...}} placeholders
        │                                 using values from this.config.*
        ▼
Expanded string sent via chat.send   ◄── "Students: Aarav (age 8), Priya (age 6). ..."
        │
        ▼
Agent receives expanded prompt       ◄── no template variables remain
```

### Pi config.js (deployment-specific)

```javascript
{
  module: "MMM-Openclaw",
  position: "bottom_bar",
  config: {
    studyStudents: [
      { name: "Aarav", age: 8 },
      { name: "Priya", age: 6 },
    ],
    studySubjects: ["Math", "Science", "Reading"],
    studyQuestionCount: 5,
    studyStandard: "California Common Core",
    calendarCmd: "gog calendar list --account you@gmail.com",
    taskCmd: "todoist",
  }
}
```

Personal details (names, ages, email accounts) exist **only** in the Pi's
`config.js`. The module source code (`MMM-Openclaw.js`, `node_helper.js`)
contains only generic defaults and `{{placeholder}}` references.

## Skills Architecture

Skills live in `~/.openclaw/skills/` on the AWS host (or workspace skills dir).

```
~/.openclaw/skills/
├── family-briefing/
│   └── SKILL.md          # Morning/evening briefing generator
├── task-manager/
│   └── SKILL.md          # Family task coordination
├── study-companion/
│   └── SKILL.md          # Homework help + quiz engine
└── magic-mirror/
    └── SKILL.md          # Display-aware response formatting
```

Each SKILL.md has:
- **YAML frontmatter**: name, description, metadata (emoji, requires)
- **Markdown body**: Instructions the agent follows

Skills are injected into the agent's system prompt at session start.

## Voice Flow (via OpenClaw Talk Mode)

```
[ReSpeaker Mic on Pi]
        │
        │ USB audio
        ▼
[OpenClaw Talk Mode on AWS]    ◄── Voice Wake detection
        │                          (ElevenLabs / Whisper)
        │ STT → text
        ▼
[Agent processes query]
        │
        │ text response
        ▼
[Gateway → MMM-Openclaw]      ◄── Display on mirror
        │
        │ TTS
        ▼
[Speaker output]               ◄── Optional: Pi speaker
```

Voice is handled entirely by OpenClaw — the Pi just needs a mic connected
and configured as an audio node.

## Cron Jobs (Scheduled Briefings)

Configure in `~/.openclaw/cron/jobs.json` on the AWS host:

```json
[
  {
    "name": "morning-briefing",
    "schedule": "0 7 * * 1-5",
    "message": "Generate a morning family briefing for the mirror display.",
    "channel": "webchat"
  },
  {
    "name": "weekend-briefing",
    "schedule": "0 9 * * 0,6",
    "message": "Generate a weekend morning briefing. Include fun activity suggestions.",
    "channel": "webchat"
  },
  {
    "name": "evening-recap",
    "schedule": "0 19 * * *",
    "message": "Generate an evening recap and tomorrow preview.",
    "channel": "webchat"
  }
]
```

These trigger agent runs whose responses arrive at MMM-Openclaw via the
Gateway WebSocket as `chat.message` events.

## Multi-Channel Message Flow (Phase 2)

This traces a message originating from WhatsApp through the full pipeline to
the mirror display.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  1. USER sends WhatsApp message                                         │
│     "What's on the calendar today?"                                     │
│                                                                         │
│  2. OpenClaw WhatsApp bridge receives message                           │
│     → forwards to Gateway with channel:"whatsapp", senderName:"User"    │
│                                                                         │
│  3. Gateway dispatches agent run                                        │
│     → Agent processes query, calls calendar tool, generates response    │
│                                                                         │
│  4. Gateway broadcasts agent events to ALL operator clients             │
│     → event: agent (thinking)                                           │
│     → event: agent (done)                                               │
│       payload: { summary: "You have 3 events...",                       │
│                  channel: "whatsapp",                                    │
│                  sender: "wa:+1234567890",                               │
│                  senderName: "User" }                                    │
│                                                                         │
│  5. node_helper._handleAgentEvent() receives event                      │
│     → _shouldDisplayChannel("whatsapp") checks config.displayChannels   │
│     → Extracts channel, sender, senderName from payload                 │
│     → sendSocketNotification("OPENCLAW_RESPONSE", {                     │
│         content, channel, sender, senderName })                         │
│                                                                         │
│  6. Frontend socketNotificationReceived("OPENCLAW_RESPONSE")            │
│     → _addMessage("assistant", content, { channel, sender, senderName })│
│     → Message object stored with metadata                               │
│                                                                         │
│  7. getDom() renders message                                            │
│     → _createMessageElement(msg)                                        │
│     → Sender name "User" above bubble     (.openclaw-sender-name)       │
│     → Content in bubble                                                 │
│     → "via WhatsApp" badge below bubble   (.openclaw-channel-badge)     │
│     → Content-type class applied           (.openclaw-content-summary)  │
│                                                                         │
│  8. User glances at Samsung Frame and sees:                             │
│     ┌──────────────────────────┐                                        │
│     │  User                    │                                        │
│     │ ┌──────────────────────┐ │                                        │
│     │ │ You have 3 events... │ │                                        │
│     │ └──────────────────────┘ │                                        │
│     │  via WhatsApp            │                                        │
│     └──────────────────────────┘                                        │
└──────────────────────────────────────────────────────────────────────────┘
```

### Key code paths for multi-channel

| Step | File | Function / Line area |
|------|------|---------------------|
| Receive agent event | `node_helper.js` | `_handleAgentEvent()` |
| Receive chat event | `node_helper.js` | `_handleChatEvent()` |
| Channel filter | `node_helper.js` | `_shouldDisplayChannel()` |
| Store metadata | `MMM-Openclaw.js` | `_addMessage()` with metadata spread |
| Render sender name | `MMM-Openclaw.js` | `_createMessageElement()` |
| Render channel badge | `MMM-Openclaw.js` | `_createMessageElement()` |
| Format channel name | `MMM-Openclaw.js` | `_formatChannelName()` |

## Development Workflow

```
┌─────────────────────────────────────────────────────┐
│  1. EDIT on Mac (VS Code)                           │
│     └── *.js, skills/**/SKILL.md                     │
│                                                     │
│  2. TEST locally                                    │
│     └── ./scripts/dev.sh --mock                     │
│     └── See UI in Electron window                   │
│     └── DevTools console for debugging              │
│                                                     │
│  3. DEPLOY to Pi                                    │
│     └── ./scripts/deploy.sh --skills                │
│     └── Syncs module + skills to Pi + OpenClaw      │
│                                                     │
│  4. VERIFY on Samsung Frame                         │
│     └── Check Gateway connection                    │
│     └── Test with real OpenClaw agent               │
│     └── Test voice (when mic connected)             │
│                                                     │
│  5. ITERATE → back to step 1                        │
└─────────────────────────────────────────────────────┘
```

## Configuration

### MagicMirror config.js (on Pi)

```javascript
{
  module: "MMM-Openclaw",
  position: "bottom_bar",
  config: {
    gatewayUrl: "wss://your-openclaw.example.com:18789",
    gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN,
    sessionName: "family-mirror",
    maxMessages: 8,
    theme: "default",
  }
}
```

### OpenClaw config (on AWS)

```jsonc
// ~/.openclaw/openclaw.json
{
  "gateway": {
    "port": 18789,
    "bind": "tailnet",  // or "lan" for local network
    "token": "your-gateway-token"
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-opus-4-5"
      }
    }
  },
  "channels": {
    "webchat": {}
  }
}
```

## Security

- Gateway token required for all WebSocket connections
- Use Tailscale for secure Pi ↔ AWS connectivity (recommended)
- Alternative: SSH tunnel from Pi to AWS
- Never expose the Gateway port directly to the internet without auth
