/**
 * MMM-Openclaw — Node Helper (Backend)
 *
 * Connects to the OpenClaw Gateway WebSocket as an operator client.
 * Uses the real Gateway protocol: connect handshake, chat.send, chat.history,
 * and event streaming for agent responses.
 *
 * OpenClaw Gateway Protocol Reference:
 * https://docs.openclaw.ai/gateway/protocol
 */

const NodeHelper = require("node_helper");
const WebSocket = require("ws");
const crypto = require("crypto");

module.exports = NodeHelper.create({
  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------
  start() {
    this.name = "MMM-Openclaw";
    this.ws = null;
    this.config = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 15;
    this.reconnectTimer = null;
    this.pendingRequests = new Map(); // id → {resolve, reject, timeout}
    this.messageQueue = [];
    this.deviceId = this._generateDeviceId();
    this.reqCounter = 0;
    this.tickTimer = null;
    this._firedBriefings = new Set();
    this._intervalInitialTimer = null;

    console.log(`[${this.name}] Node helper started`);
  },

  stop() {
    this._cleanup();
    console.log(`[${this.name}] Node helper stopped`);
  },

  // -----------------------------------------------------------------------
  // Socket notification handler (from frontend)
  // -----------------------------------------------------------------------
  socketNotificationReceived(notification, payload) {
    switch (notification) {
      case "OPENCLAW_INIT":
        this.config = payload;
        this._connect();
        break;

      case "OPENCLAW_SEND_MESSAGE":
        this._sendChatMessage(payload.content);
        break;

      case "OPENCLAW_GET_HISTORY":
        this._getChatHistory(payload?.limit || 20);
        break;

      default:
        break;
    }
  },

  // -----------------------------------------------------------------------
  // WebSocket connection to OpenClaw Gateway
  // -----------------------------------------------------------------------
  _connect() {
    if (this.ws) {
      this._cleanup();
    }

    const url = this.config.gatewayUrl || "ws://127.0.0.1:18789";
    console.log(`[${this.name}] Connecting to OpenClaw Gateway: ${url}`);

    try {
      this.ws = new WebSocket(url, {
        headers: { Origin: url },
      });
    } catch (err) {
      console.error(`[${this.name}] WebSocket creation failed:`, err.message);
      this._scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      console.log(`[${this.name}] WebSocket open, waiting for challenge...`);
      // Don't set connected yet — we need to complete the handshake.
      // The Gateway may send a connect.challenge event first.
      // If no challenge arrives within 3s, send connect anyway (some configs skip it).
      this._challengeTimeout = setTimeout(() => {
        if (!this.connected) {
          console.log(`[${this.name}] No challenge received, sending connect...`);
          this._sendHandshake();
        }
      }, 3000);
    });

    this.ws.on("message", (data) => {
      this._handleMessage(data.toString());
    });

    this.ws.on("close", (code, reason) => {
      const wasConnected = this.connected;
      this.connected = false;
      console.log(`[${this.name}] WebSocket closed: ${code} ${reason || ""}`);
      this.sendSocketNotification("OPENCLAW_CONNECTION_STATUS", {
        connected: false,
        code,
      });
      if (wasConnected || this.reconnectAttempts < this.maxReconnectAttempts) {
        this._scheduleReconnect();
      }
    });

    this.ws.on("error", (err) => {
      console.error(`[${this.name}] WebSocket error:`, err.message);
    });
  },

  // -----------------------------------------------------------------------
  // OpenClaw Gateway handshake
  // -----------------------------------------------------------------------
  _sendHandshake(nonce) {
    const pkg = require("./package.json");
    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: "webchat",
        version: pkg.version,
        platform: process.platform,
        mode: "webchat",
      },
      locale: "en-US",
      userAgent: `MMM-Openclaw/${pkg.version}`,
    };

    // TODO: Implement nonce signing for challenge-response auth
    // Currently the nonce is accepted but not signed — challenge-based
    // auth will fail. Token-based auth (the default) works fine.

    // Add auth token if configured
    const token = this.config.gatewayToken || process.env.OPENCLAW_GATEWAY_TOKEN;
    if (token) {
      params.auth = { token };
    }

    this._sendRequest("connect", params, (err, payload) => {
      if (err) {
        console.error(`[${this.name}] Handshake failed:`, err);
        this._scheduleReconnect();
        return;
      }

      if (payload?.type === "hello-ok") {
        this.connected = true;
        this.reconnectAttempts = 0;
        console.log(
          `[${this.name}] Connected to OpenClaw Gateway (protocol v${payload.protocol || "?"})`
        );
        if (this.config?.debug) {
          console.log(`[${this.name}] Hello payload:`, JSON.stringify(payload).substring(0, 500));
        }

        // Store device token if issued
        if (payload.auth?.deviceToken) {
          this._deviceToken = payload.auth.deviceToken;
        }

        // Store session key for chat messages
        if (payload.sessionKey) {
          this.sessionKey = payload.sessionKey;
          console.log(`[${this.name}] Session key: ${this.sessionKey}`);
        }

        // Start tick keepalive if server specified interval
        if (payload.policy?.tickIntervalMs) {
          this._startTick(payload.policy.tickIntervalMs);
        }

        this.sendSocketNotification("OPENCLAW_CONNECTION_STATUS", {
          connected: true,
        });

        // Flush queued messages
        this._flushQueue();

        // Start briefing scheduler
        this._startBriefingScheduler();
      }
    });
  },

  // -----------------------------------------------------------------------
  // Message handling
  // -----------------------------------------------------------------------
  _handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.warn(`[${this.name}] Non-JSON message:`, raw.substring(0, 100));
      return;
    }

    switch (msg.type) {
      // --- Challenge (pre-handshake) ---
      case "event":
        this._handleEvent(msg);
        break;

      // --- Response to a request ---
      case "res":
        this._handleResponse(msg);
        break;

      // --- Request from gateway (rare for operator) ---
      case "req":
        this._handleGatewayRequest(msg);
        break;

      default:
        break;
    }
  },

  _handleEvent(msg) {
    const event = msg.event;
    const payload = msg.payload || {};

    switch (event) {
      // Pre-connect challenge
      case "connect.challenge":
        if (this._challengeTimeout) {
          clearTimeout(this._challengeTimeout);
          this._challengeTimeout = null;
        }
        console.log(`[${this.name}] Received connect challenge`);
        this._sendHandshake(payload.nonce);
        break;

      // Agent streaming events
      case "agent":
      case "agent.stream":
        this._handleAgentEvent(payload);
        break;

      // Chat events (new messages from other channels)
      case "chat":
      case "chat.message":
        this._handleChatEvent(payload);
        break;

      // Presence updates
      case "presence":
        // Could show who's connected
        break;

      // Tick (keepalive from server)
      case "tick":
        // Gateway health tick — no action needed
        break;

      // Session events
      case "session":
      case "session.updated":
        break;

      default:
        if (this.config?.debug) {
          console.log(`[${this.name}] Event: ${event}`, JSON.stringify(payload).substring(0, 200));
        }
        break;
    }
  },

  _handleAgentEvent(payload) {
    // Agent run statuses: accepted, streaming, thinking, tool_use, done, error
    const status = payload.status || payload.state;

    if (status === "streaming" || payload.delta) {
      // Streaming text chunk
      this.sendSocketNotification("OPENCLAW_AGENT_STREAM", {
        delta: payload.delta || payload.text || "",
        runId: payload.runId,
      });
    } else if (status === "thinking") {
      this.sendSocketNotification("OPENCLAW_TYPING", { thinking: true });
    } else if (status === "tool_use") {
      this.sendSocketNotification("OPENCLAW_TYPING", {
        thinking: true,
        tool: payload.tool || payload.name,
      });
    } else if (status === "done" || status === "completed") {
      // Final response — extract string content safely
      const text = this._extractText(payload.summary || payload.text || payload.content);
      if (text) {
        const channel = payload.channel;
        if (this._shouldDisplayChannel(channel)) {
          this.sendSocketNotification("OPENCLAW_RESPONSE", {
            content: text,
            runId: payload.runId,
            timestamp: Date.now(),
            channel,
            sender: payload.sender,
            senderName: payload.senderName,
          });
        }
      }
    } else if (status === "error") {
      this.sendSocketNotification("OPENCLAW_ERROR", {
        message: payload.error || "Agent error",
        runId: payload.runId,
      });
    }
  },

  _handleChatEvent(payload) {
    // Incoming chat message (from another channel or proactive)

    // Only process final messages (skip deltas to avoid duplicates)
    if (payload.state === "delta") return;

    // Extract text from the message — handles multiple Gateway formats:
    // Format 1: { role: "assistant", content: "text" }
    // Format 2: { message: { role: "assistant", content: [{ type: "text", text: "..." }] } }
    // Format 3: { message: { content: "text" } }
    const msg = payload.message || payload;
    const role = msg.role || payload.role;
    const from = payload.from;

    if (role === "assistant" || from === "agent") {
      let text = "";
      if (typeof msg.content === "string") {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        text = msg.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
      } else {
        text = msg.text || payload.text || payload.content || "";
      }

      const channel = payload.channel;
      if (text && this._shouldDisplayChannel(channel)) {
        console.log(`[${this.name}] Displaying response (channel: ${channel || "webchat"}): ${text.substring(0, 100)}...`);
        this.sendSocketNotification("OPENCLAW_RESPONSE", {
          content: text,
          timestamp: msg.timestamp || payload.timestamp || Date.now(),
          channel,
          sender: payload.sender || msg.sender,
          senderName: payload.senderName || msg.senderName,
        });
      }
    }
  },

  _handleResponse(msg) {
    const pending = this.pendingRequests.get(msg.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(msg.id);
      if (msg.ok) {
        pending.resolve(msg.payload);
      } else {
        pending.reject(msg.error || { message: "Request failed" });
      }
    }
  },

  _handleGatewayRequest(msg) {
    // Gateway asking us something (e.g., exec approval) — not typical for display
    if (this.config?.debug) {
      console.log(`[${this.name}] Gateway request:`, msg.method);
    }
  },

  // -----------------------------------------------------------------------
  // Chat operations
  // -----------------------------------------------------------------------
  _sendChatMessage(content) {
    if (!content || !content.trim()) return;

    if (!this.connected) {
      this.messageQueue.push(content);
      console.log(`[${this.name}] Queued message (not connected): "${content.substring(0, 50)}"`);
      return;
    }

    // Notify frontend we're sending
    this.sendSocketNotification("OPENCLAW_TYPING", { thinking: true });

    // Use chat.send to send via WebChat channel
    this._sendRequest(
      "chat.send",
      {
        message: content,
        sessionKey: this.sessionKey || this.deviceId || "default",
        idempotencyKey: this._idempotencyKey(),
      },
      (err, payload) => {
        if (err) {
          console.error(`[${this.name}] chat.send failed:`, err);
          this.sendSocketNotification("OPENCLAW_ERROR", {
            message: `Send failed: ${err.message || err}`,
          });
          return;
        }

        // The response will arrive as agent events (streaming).
        // If the response includes an immediate reply, surface it.
        if (payload?.content || payload?.text) {
          this.sendSocketNotification("OPENCLAW_RESPONSE", {
            content: payload.content || payload.text,
            timestamp: Date.now(),
          });
        }
      }
    );
  },

  _getChatHistory(limit) {
    if (!this.connected) return;

    const params = {
      limit,
      sessionKey: this.sessionKey || this.deviceId || "default",
    };
    this._sendRequest("chat.history", params, (err, payload) => {
      if (err) {
        console.error(`[${this.name}] chat.history failed:`, err);
        return;
      }

      const messages = (payload?.messages || payload || []).map((m) => ({
        role: m.role || (m.from === "agent" ? "assistant" : "user"),
        content: m.content || m.text || m.message || "",
        timestamp: m.timestamp || m.ts,
      }));

      this.sendSocketNotification("OPENCLAW_HISTORY", { messages });
    });
  },

  // -----------------------------------------------------------------------
  // Low-level WebSocket request/response
  // -----------------------------------------------------------------------
  _sendRequest(method, params, callback) {
    const id = `mmm-${++this.reqCounter}-${Date.now()}`;

    const frame = {
      type: "req",
      id,
      method,
      params: params || {},
    };

    const promise = new Promise((resolve, reject) => {
      const cb = callback || (() => {});

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        const err = new Error(`Request ${method} timed out`);
        reject(err);
        cb(err);
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: (payload) => {
          resolve(payload);
          cb(null, payload);
        },
        reject: (err) => {
          reject(err);
          cb(err);
        },
        timeout,
      });

      try {
        this.ws.send(JSON.stringify(frame));
      } catch (err) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(err);
        cb(err);
      }
    });

    // When using callback style, suppress unhandled rejection
    if (callback) promise.catch(() => {});
    return promise;
  },

  // -----------------------------------------------------------------------
  // Keepalive
  // -----------------------------------------------------------------------
  _startTick(intervalMs) {
    if (this.tickTimer) clearInterval(this.tickTimer);

    // Send health ping at the server's tick interval
    this.tickTimer = setInterval(() => {
      if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
        this._sendRequest("health", {}).catch(() => {
          // Tick failure — connection might be dead
          console.warn(`[${this.name}] Tick failed, reconnecting...`);
          this._cleanup();
          this._scheduleReconnect();
        });
      }
    }, intervalMs || 15000);
  },

  // -----------------------------------------------------------------------
  // Reconnect logic
  // -----------------------------------------------------------------------
  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[${this.name}] Max reconnect attempts reached. Giving up.`);
      this.sendSocketNotification("OPENCLAW_CONNECTION_STATUS", {
        connected: false,
        gaveUp: true,
      });
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000);
    this.reconnectAttempts++;
    console.log(
      `[${this.name}] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, delay);
  },

  _flushQueue() {
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift();
      this._sendChatMessage(msg);
    }
  },

  // -----------------------------------------------------------------------
  // Scheduled briefings
  // -----------------------------------------------------------------------
  _startBriefingScheduler() {
    // Clear all existing timers to prevent duplicates on reconnect
    if (this.briefingTimer) clearInterval(this.briefingTimer);
    if (this.intervalBriefingTimer) clearInterval(this.intervalBriefingTimer);
    if (this._intervalInitialTimer) clearTimeout(this._intervalInitialTimer);
    this.briefingTimer = null;
    this.intervalBriefingTimer = null;
    this._intervalInitialTimer = null;

    const briefings = this.config.scheduledBriefings;
    if (!briefings || !Array.isArray(briefings)) return;

    const enabled = briefings.filter((b) => b.enabled !== false);
    if (enabled.length === 0) return;

    // Interval mode: fire every N minutes (for testing only)
    const intervalMin = this.config.briefingIntervalMinutes;
    if (intervalMin && intervalMin > 0) {
      const intervalMs = intervalMin * 60 * 1000;
      const message = this._expandMessage(enabled[0].message);
      console.log(
        `[${this.name}] Briefing INTERVAL mode: every ${intervalMin} min using "${enabled[0].name}" prompt`
      );

      // Fire first one after a short delay (let UI settle)
      this._intervalInitialTimer = setTimeout(() => {
        if (this.connected) {
          console.log(`[${this.name}] Triggering interval briefing (initial)`);
          this._sendChatMessage(message);
        }
      }, 10000);

      this.intervalBriefingTimer = setInterval(() => {
        if (this.connected) {
          console.log(`[${this.name}] Triggering interval briefing (every ${intervalMin} min)`);
          this._sendChatMessage(message);
        }
      }, intervalMs);

      return; // Skip time-based scheduler when interval mode is active
    }

    // Time-based schedule mode (production)
    const tz = this.config.briefingTimezone || "system";
    const names = enabled.map((b) => `${b.name}@${b.time}`).join(", ");
    console.log(`[${this.name}] Briefing scheduler started: ${names} (tz: ${tz})`);

    // Check every 30 seconds
    this.briefingTimer = setInterval(() => {
      this._checkBriefings();
    }, 30000);

    // Also check immediately
    this._checkBriefings();
  },

  _checkBriefings() {
    if (!this.connected) return;

    const briefings = this.config.scheduledBriefings || [];
    const now = new Date();

    // Get current time in configured timezone
    const tz = this.config.briefingTimezone || undefined;
    let hours, minutes;
    if (tz) {
      const timeStr = now.toLocaleTimeString("en-US", {
        timeZone: tz,
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      });
      [hours, minutes] = timeStr.split(":").map(Number);
    } else {
      hours = now.getHours();
      minutes = now.getMinutes();
    }

    // Date key to track which briefings fired today
    const dateKey = now.toLocaleDateString("en-CA", tz ? { timeZone: tz } : undefined);

    const nowMinutes = hours * 60 + minutes;

    // Find the most recent missed briefing for catch-up (only one, not all)
    let catchUpBriefing = null;
    let catchUpMinutes = -1;

    for (const briefing of briefings) {
      if (briefing.enabled === false) continue;
      if (!briefing.time || !briefing.message) continue;

      const [targetH, targetM] = briefing.time.split(":").map(Number);
      const targetMinutes = targetH * 60 + targetM;
      const firedKey = `${dateKey}:${briefing.name || briefing.time}`;

      // Exact match — fire immediately (normal scheduled trigger)
      if (nowMinutes === targetMinutes && !this._firedBriefings.has(firedKey)) {
        this._firedBriefings.add(firedKey);
        console.log(`[${this.name}] Triggering briefing: ${briefing.name} (${briefing.time})`);
        this._sendChatMessage(this._expandMessage(briefing.message));
        catchUpBriefing = null; // no catch-up needed, we just fired on time
        break;
      }

      // Past the target time and not yet fired — candidate for catch-up
      if (nowMinutes > targetMinutes && !this._firedBriefings.has(firedKey) && targetMinutes > catchUpMinutes) {
        catchUpBriefing = briefing;
        catchUpMinutes = targetMinutes;
      }
    }

    // Fire only the most recent missed briefing (e.g., if it's 8 AM, fire morning but not midday)
    if (catchUpBriefing) {
      const firedKey = `${dateKey}:${catchUpBriefing.name || catchUpBriefing.time}`;
      this._firedBriefings.add(firedKey);
      console.log(`[${this.name}] Triggering briefing: ${catchUpBriefing.name} (${catchUpBriefing.time}) [catch-up]`);
      this._sendChatMessage(this._expandMessage(catchUpBriefing.message));

      // Mark all earlier briefings as fired too (don't catch up old ones)
      for (const briefing of briefings) {
        if (briefing.enabled === false) continue;
        if (!briefing.time) continue;
        const [tH, tM] = briefing.time.split(":").map(Number);
        if (tH * 60 + tM <= catchUpMinutes) {
          this._firedBriefings.add(`${dateKey}:${briefing.name || briefing.time}`);
        }
      }
    }

    // Clean up old date keys (keep set from growing)
    for (const key of this._firedBriefings) {
      if (!key.startsWith(dateKey)) {
        this._firedBriefings.delete(key);
      }
    }
  },

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------
  _generateDeviceId() {
    // Stable device ID for this MagicMirror instance
    const hostname = require("os").hostname();
    return crypto.createHash("sha256").update(`mmm-openclaw-${hostname}`).digest("hex").slice(0, 16);
  },

  _idempotencyKey() {
    return `mmm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  },

  _shouldDisplayChannel(channel) {
    const allowed = this.config?.displayChannels;
    if (!allowed || !Array.isArray(allowed) || allowed.length === 0) return true;
    if (!channel) return true; // no channel metadata = always show
    return allowed.includes(channel);
  },

  _expandMessage(template) {
    if (!template) return template;
    const now = new Date();
    const tz = this.config.briefingTimezone;
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      ...(tz ? { timeZone: tz } : {}),
    });
    const subjects = Array.isArray(this.config.studySubjects)
      ? this.config.studySubjects.join(", ")
      : (this.config.studySubjects || "Math, Science");

    const students = Array.isArray(this.config.studyStudents) && this.config.studyStudents.length > 0
      ? this.config.studyStudents.map((s) => `${s.name} (age ${s.age})`).join(", ")
      : "a student (age 8)";

    return template
      .replace(/\{\{calendarCmd\}\}/g, this.config.calendarCmd || "gog calendar list")
      .replace(/\{\{taskCmd\}\}/g, this.config.taskCmd || "todoist")
      .replace(/\{\{date\}\}/g, dateStr)
      .replace(/\{\{studyStudents\}\}/g, students)
      .replace(/\{\{studySubjects\}\}/g, subjects)
      .replace(/\{\{studyQuestionCount\}\}/g, this.config.studyQuestionCount || 3)
      .replace(/\{\{studyStandard\}\}/g, this.config.studyStandard || "California Common Core");
  },

  _extractText(content) {
    if (!content) return "";
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
    }
    return String(content);
  },

  _cleanup() {
    if (this._challengeTimeout) {
      clearTimeout(this._challengeTimeout);
      this._challengeTimeout = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.briefingTimer) {
      clearInterval(this.briefingTimer);
      this.briefingTimer = null;
    }
    if (this.intervalBriefingTimer) {
      clearInterval(this.intervalBriefingTimer);
      this.intervalBriefingTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
    }
    this.pendingRequests.clear();
    this.connected = false;

    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  },
});
