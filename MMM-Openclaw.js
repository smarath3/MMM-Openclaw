/**
 * MMM-Openclaw — Frontend Module
 *
 * Displays OpenClaw agent responses on MagicMirror.
 * Connects to the backend node_helper which manages the Gateway WebSocket.
 */

Module.register("MMM-Openclaw", {
  // -----------------------------------------------------------------------
  // Defaults
  // -----------------------------------------------------------------------
  requiresVersion: "2.27.0", // Minimum MagicMirror version (ES2020+ features, stable module API)

  defaults: {
    gatewayUrl: "ws://127.0.0.1:18789",
    gatewayToken: "",
    sessionKey: "mirror-display",
    maxMessages: 8,
    showTypingIndicator: true,
    showConnectionStatus: true,
    showTimestamps: false,
    allowNotificationTriggers: true,
    broadcastResponses: true,
    hideAfterInactivity: 0, // ms, 0 = disabled
    theme: "default", // default | minimal | briefing
    displayChannels: [], // empty = show all; e.g. ["whatsapp", "telegram", "webchat"]
    showChannelBadge: true,
    showSenderName: true,
    debug: false,

    // Tool commands used in briefing prompts (substituted into {{calendarCmd}} and {{taskCmd}})
    calendarCmd: "gog calendar list",    // e.g. "gog calendar list --account you@gmail.com"
    taskCmd: "todoist",                  // e.g. "todoist tasks list"

    // Scheduled briefings — the Mirror requests these on a timer
    // Each briefing fires once per day at the configured time (HH:MM in briefingTimezone)
    // Use {{calendarCmd}} and {{taskCmd}} in messages — replaced at runtime from config above
    scheduledBriefings: [
      {
        name: "morning",
        time: "07:00",
        message:
          "Today is {{date}}. Generate a morning family briefing for the Magic Mirror display. " +
          "First, use `{{calendarCmd}}` to fetch today's calendar events. " +
          "Use `{{taskCmd}}` to fetch tasks due today. " +
          "Use the weather skill for current forecast. " +
          "Check MEMORY.md and memory/ folder for any recent notes or reminders from WhatsApp. " +
          "Then format the briefing for glanceable reading on a wall-mounted TV.",
        enabled: true,
      },
      {
        name: "midday",
        time: "12:00",
        message:
          "Today is {{date}}. Generate a midday update for the Magic Mirror display. " +
          "First, use `{{calendarCmd}}` to fetch remaining events today. " +
          "Use `{{taskCmd}}` to check tasks. Use weather skill for updated forecast. " +
          "Check MEMORY.md for any recent notes. " +
          "Keep it brief and glanceable.",
        enabled: false,
      },
      {
        name: "evening",
        time: "18:00",
        message:
          "Today is {{date}}. Generate an evening family briefing for the Magic Mirror display. " +
          "First, use `{{calendarCmd}}` to fetch tomorrow's events. " +
          "Use `{{taskCmd}}` to fetch pending tasks. Use weather skill for tomorrow's forecast. " +
          "Check MEMORY.md and memory/ folder for notes and reminders from WhatsApp. " +
          "Include summary of today and tomorrow preview. Format for glanceable TV display.",
        enabled: true,
      },
      {
        name: "afternoon-study",
        time: "16:00",
        message:
          "Today is {{date}}. Start an interactive study session for the Magic Mirror. " +
          "Students: {{studyStudents}}. Use {{studyStandard}} grade-level standards. " +
          "Pick a subject from [{{studySubjects}}] that hasn't been practiced recently (check progress.json if available). " +
          "Generate {{studyQuestionCount}} age-appropriate quiz questions per student with A/B/C/D options. " +
          "Address each student by name. Format for the TV display — one question at a time, bold key terms, include a hint.",
        enabled: false, // enable per-deployment in config.js
      },
    ],
    briefingTimezone: "America/Los_Angeles", // IANA timezone for schedule times
    briefingIntervalMinutes: 0, // >0 = testing mode: fire every N minutes instead of schedule
    briefingCondenseAfterMs: 300000, // 5 min: condense full briefing to one-liner after this

    // Study session config — override per-deployment in Pi config.js
    studyStudents: [],                        // e.g. [{ name: "Aarav", age: 8 }, { name: "Priya", age: 6 }]
    studySubjects: ["Math", "Science"],       // STEM subjects to rotate through
    studyQuestionCount: 3,                    // questions per session (3-5 recommended)
    studyStandard: "California Common Core",  // curriculum standard for grade alignment
  },

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------
  start() {
    Log.info(`[${this.name}] Starting module...`);
    this.messages = [];
    this.isTyping = false;
    this.isConnected = false;
    this.streamBuffer = "";
    this.hideTimer = null;
    this.condenseTimer = null;
    this.isCondensed = false;
    this.condensedSummary = "";

    // Tell node_helper to connect
    this.sendSocketNotification("OPENCLAW_INIT", this.config);
  },

  getStyles() {
    return ["MMM-Openclaw.css"];
  },

  getScripts() {
    return [];
  },

  suspend() {
    // Halt timers when module is hidden (MagicMirror lifecycle)
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (this.condenseTimer) clearTimeout(this.condenseTimer);
  },

  resume() {
    // Restart condense timer if we have a visible assistant message
    if (this.messages.length > 0) {
      const last = this.messages[this.messages.length - 1];
      if (last.role === "assistant") {
        this._startCondenseTimer(last.content);
      }
    }
  },

  // -----------------------------------------------------------------------
  // DOM generation
  // -----------------------------------------------------------------------
  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = `openclaw-wrapper openclaw-theme-${this.config.theme}`;

    // Connection status
    if (this.config.showConnectionStatus) {
      const status = document.createElement("div");
      status.className = "openclaw-status";

      const dot = document.createElement("span");
      dot.className = `openclaw-status-dot ${this.isConnected ? "connected" : "disconnected"}`;
      status.appendChild(dot);

      const label = document.createElement("span");
      label.className = "openclaw-status-label";
      label.textContent = this.isConnected ? "Openclaw" : "Connecting...";
      status.appendChild(label);

      wrapper.appendChild(status);
    }

    // Condensed mode: show one-liner instead of full messages
    if (this.isCondensed && this.condensedSummary) {
      const condensed = document.createElement("div");
      condensed.className = "openclaw-condensed";
      condensed.innerHTML = this._renderMarkdown(this.condensedSummary);
      wrapper.appendChild(condensed);
      return wrapper;
    }

    // Messages
    const messageContainer = document.createElement("div");
    messageContainer.className = "openclaw-messages";

    if (this.messages.length === 0 && !this.isTyping) {
      const empty = document.createElement("div");
      empty.className = "openclaw-empty";
      empty.textContent = this.isConnected
        ? '🦞 Ask me anything!'
        : "Waiting for OpenClaw...";
      messageContainer.appendChild(empty);
    }

    // Render messages
    const displayMessages = this.messages.slice(-this.config.maxMessages);
    for (const msg of displayMessages) {
      messageContainer.appendChild(this._createMessageElement(msg));
    }

    // Typing indicator
    if (this.isTyping && this.config.showTypingIndicator) {
      const typing = document.createElement("div");
      typing.className = "openclaw-message openclaw-assistant";

      const bubble = document.createElement("div");
      bubble.className = "openclaw-bubble openclaw-typing-bubble";
      bubble.innerHTML =
        '<span class="openclaw-typing-dots">' +
        '<span class="dot"></span><span class="dot"></span><span class="dot"></span>' +
        "</span>";
      typing.appendChild(bubble);
      messageContainer.appendChild(typing);
    }

    wrapper.appendChild(messageContainer);
    return wrapper;
  },

  _createMessageElement(msg) {
    const container = document.createElement("div");
    container.className = `openclaw-message openclaw-${msg.role}`;

    // Sender name above bubble
    if (this.config.showSenderName && msg.senderName) {
      const sender = document.createElement("div");
      sender.className = "openclaw-sender-name";
      sender.textContent = msg.senderName;
      container.appendChild(sender);
    }

    const bubble = document.createElement("div");
    bubble.className = "openclaw-bubble";

    // Detect content type and add formatting class
    const contentType = this._detectContentType(msg.content);
    if (contentType) {
      bubble.classList.add(`openclaw-content-${contentType}`);
    }

    // Parse simple markdown (bold, italic, code, lists)
    bubble.innerHTML = this._renderMarkdown(msg.content);
    container.appendChild(bubble);

    if (this.config.showTimestamps && msg.timestamp) {
      const time = document.createElement("div");
      time.className = "openclaw-timestamp";
      time.textContent = this._formatTime(msg.timestamp);
      container.appendChild(time);
    }

    // Channel badge below bubble
    if (this.config.showChannelBadge && msg.channel && msg.channel !== "webchat") {
      const badge = document.createElement("div");
      badge.className = "openclaw-channel-badge";
      badge.textContent = `via ${this._formatChannelName(msg.channel)}`;
      container.appendChild(badge);
    }

    return container;
  },

  _detectContentType(content) {
    if (!content || typeof content !== "string") return null;
    if (/\b[A-D]\)\s/m.test(content) || /quiz|question/i.test(content)) return "quiz";
    if (/task|to-?do|shopping list|chore/i.test(content) && /[•\-]\s/.test(content)) return "tasks";
    if (/briefing|schedule|forecast/i.test(content)) return "summary";
    return null;
  },

  _formatChannelName(channel) {
    const names = { whatsapp: "WhatsApp", telegram: "Telegram", sms: "SMS", cron: "Scheduled" };
    return names[channel] || channel;
  },

  _renderMarkdown(text) {
    if (!text) return "";
    if (typeof text !== "string") {
      text = Array.isArray(text)
        ? text.filter((c) => c.type === "text").map((c) => c.text).join("\n")
        : String(text);
    }
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, '<code class="openclaw-inline-code">$1</code>')
      .replace(/\n/g, "<br>");
  },

  _formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  },

  // -----------------------------------------------------------------------
  // Socket notifications from node_helper
  // -----------------------------------------------------------------------
  socketNotificationReceived(notification, payload) {
    switch (notification) {
      case "OPENCLAW_CONNECTION_STATUS":
        this.isConnected = payload.connected;
        if (payload.connected) {
          // Request recent history on connect
          this.sendSocketNotification("OPENCLAW_GET_HISTORY", { limit: 5 });
        }
        this.updateDom(300);
        break;

      case "OPENCLAW_RESPONSE":
        this.isTyping = false;
        this.isCondensed = false;
        this.condensedSummary = "";
        if (this.condenseTimer) clearTimeout(this.condenseTimer);
        this.streamBuffer = "";
        this._addMessage("assistant", payload.content, {
          channel: payload.channel,
          sender: payload.sender,
          senderName: payload.senderName,
        });
        if (this.config.broadcastResponses) {
          this.sendNotification("OPENCLAW_RESPONSE", payload);
        }
        break;

      case "OPENCLAW_AGENT_STREAM":
        // Accumulate streaming delta
        this.streamBuffer += payload.delta || "";
        // Could update a "live" bubble here for real-time display
        break;

      case "OPENCLAW_TYPING":
        this.isTyping = true;
        this.updateDom(300);
        break;

      case "OPENCLAW_ERROR":
        this.isTyping = false;
        this._addMessage("system", `⚠ ${payload.message}`);
        break;

      case "OPENCLAW_HISTORY":
        if (payload.messages && payload.messages.length > 0) {
          // Prepend history (avoid duplicates)
          const existing = new Set(this.messages.map((m) => m.content));
          for (const m of payload.messages) {
            if (!existing.has(m.content)) {
              this.messages.push(m);
            }
          }
          this.updateDom(300);
        }
        break;

      case "OPENCLAW_PROACTIVE":
        this._addMessage("assistant", payload.content);
        if (payload.speakable) {
          this.sendNotification("TTS_SPEAK", payload.content);
        }
        if (this.config.broadcastResponses) {
          this.sendNotification("OPENCLAW_PROACTIVE", payload);
        }
        break;

      default:
        break;
    }
  },

  // -----------------------------------------------------------------------
  // Cross-module notifications (from other MM modules)
  // -----------------------------------------------------------------------
  notificationReceived(notification, payload) {
    if (!this.config.allowNotificationTriggers) return;

    switch (notification) {
      case "OPENCLAW_QUERY":
        // Another module wants to ask Openclaw something
        if (typeof payload === "string") {
          this.sendQuery(payload);
        } else if (payload?.content) {
          this.sendQuery(payload.content);
        }
        break;

      case "ALL_MODULES_STARTED":
        // Good time to initialize
        break;

      default:
        break;
    }
  },

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------
  sendQuery(text) {
    if (!text) return;
    this._addMessage("user", text);
    this.sendSocketNotification("OPENCLAW_SEND_MESSAGE", { content: text });
  },

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------
  _addMessage(role, content, metadata) {
    if (!content) return;

    // New message arrives — exit condensed mode
    if (this.isCondensed) {
      this.isCondensed = false;
      this.condensedSummary = "";
    }

    // Clear previous messages when a new briefing arrives so it replaces, not stacks
    if (role === "assistant") {
      this.messages = [];
    }

    this.messages.push({
      role,
      content,
      timestamp: Date.now(),
      ...(metadata || {}),
    });

    // Trim old messages
    while (this.messages.length > this.config.maxMessages * 2) {
      this.messages.shift();
    }

    this.updateDom(300);
    this._resetHideTimer();

    // Start condense timer for assistant messages
    if (role === "assistant") {
      this._startCondenseTimer(content);
    }
  },

  _resetHideTimer() {
    if (!this.config.hideAfterInactivity) return;

    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.show(300);
    this.hideTimer = setTimeout(() => {
      this.hide(1000);
    }, this.config.hideAfterInactivity);
  },

  // -----------------------------------------------------------------------
  // Condensed briefing mode
  // -----------------------------------------------------------------------
  _startCondenseTimer(content) {
    const delay = this.config.briefingCondenseAfterMs;
    if (!delay || delay <= 0) return;

    if (this.condenseTimer) clearTimeout(this.condenseTimer);

    this.condenseTimer = setTimeout(() => {
      this.isCondensed = true;
      this.condensedSummary = this._extractSummary(content);
      this.updateDom(1000); // slow fade transition
    }, delay);
  },

  _extractSummary(content) {
    if (!content) return "";

    const parts = [];

    // Time
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    parts.push(timeStr);

    // Weather: look for temperature pattern (e.g., "65°F", "18°C", "65 degrees")
    const tempMatch = content.match(/(\d{1,3})\s*°\s*[FCfc]/);
    const degMatch = !tempMatch && content.match(/(\d{1,3})\s*degrees/i);
    if (tempMatch) {
      parts.push(tempMatch[0]);
    } else if (degMatch) {
      parts.push(degMatch[0]);
    }

    // Weather emoji: look for common weather words
    if (/sunny|clear|sun/i.test(content)) parts[parts.length - 1] = "☀️ " + (parts[parts.length - 1] || "");
    else if (/rain|shower/i.test(content)) parts[parts.length - 1] = "🌧 " + (parts[parts.length - 1] || "");
    else if (/cloud|overcast/i.test(content)) parts[parts.length - 1] = "☁️ " + (parts[parts.length - 1] || "");
    else if (/snow/i.test(content)) parts[parts.length - 1] = "❄️ " + (parts[parts.length - 1] || "");

    // Events count: "3 events", "2 meetings", etc.
    const eventMatch = content.match(/(\d+)\s*(event|meeting|appointment|calendar item)/i);
    if (eventMatch) {
      parts.push(eventMatch[1] + " events");
    }

    // Tasks count: "4 tasks", "2 to-dos", etc.
    const taskMatch = content.match(/(\d+)\s*(task|to-?do|action item)/i);
    if (taskMatch) {
      parts.push(taskMatch[1] + " tasks");
    }

    // If we couldn't extract structured data, use first sentence
    if (parts.length <= 1) {
      const firstLine = content.split(/[.\n]/)[0].trim();
      parts.push(firstLine.length > 80 ? firstLine.substring(0, 77) + "..." : firstLine);
    }

    return "**Last briefing** " + parts.join(" · ");
  },
});
