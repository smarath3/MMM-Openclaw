#!/usr/bin/env node
/**
 * Mock OpenClaw Gateway — for MMM-Openclaw local development
 *
 * Simulates the OpenClaw Gateway WebSocket protocol so you can develop
 * the MagicMirror module without a live OpenClaw instance.
 *
 * Usage:
 *   node tools/mock-gateway.js              # default port 18789
 *   node tools/mock-gateway.js 19000        # custom port
 *   node tools/mock-gateway.js --demo       # sends proactive briefings
 *   node tools/mock-gateway.js --whatsapp   # adds channel metadata to responses
 *   node tools/mock-gateway.js --demo --whatsapp  # combine flags
 */

const WebSocket = require("ws");

const PORT = parseInt(process.argv.find((a) => /^\d+$/.test(a))) || 18789;
const DEMO = process.argv.includes("--demo");
const WHATSAPP = process.argv.includes("--whatsapp");

const wss = new WebSocket.Server({ port: PORT });
console.log(`🦞 Mock OpenClaw Gateway running on ws://127.0.0.1:${PORT}`);
if (DEMO) console.log("   Demo mode: proactive briefings every 30s");
if (WHATSAPP) console.log("   WhatsApp mode: proactive messages include channel metadata");

wss.on("connection", (ws) => {
  console.log("→ Client connected");
  let authenticated = false;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      console.warn("  Bad JSON:", raw.toString().substring(0, 80));
      return;
    }

    if (msg.type !== "req") return;

    const { id, method, params } = msg;

    switch (method) {
      // --- Handshake ---
      case "connect":
        authenticated = true;
        console.log(`  ✓ Handshake from ${params?.client?.id || "unknown"}`);
        ws.send(
          JSON.stringify({
            type: "res",
            id,
            ok: true,
            payload: {
              type: "hello-ok",
              protocol: 3,
              policy: { tickIntervalMs: 30000 },
            },
          })
        );
        break;

      // --- Send a chat message ---
      case "chat.send":
        if (!authenticated) return sendError(ws, id, "Not connected");
        console.log(`  💬 User: "${params.message}"`);

        // Ack the send
        ws.send(JSON.stringify({ type: "res", id, ok: true, payload: { accepted: true } }));

        // Simulate agent thinking
        ws.send(
          JSON.stringify({
            type: "event",
            event: "agent",
            payload: { status: "thinking", runId: `run-${Date.now()}` },
          })
        );

        // Simulate response after delay
        const response = generateResponse(params.message);
        const delay = 800 + Math.random() * 1500;

        setTimeout(() => {
          const agentPayload = {
            status: "done",
            runId: `run-${Date.now()}`,
            summary: response,
            text: response,
          };
          if (WHATSAPP) {
            agentPayload.channel = "whatsapp";
            agentPayload.sender = "user-whatsapp-1";
            agentPayload.senderName = "User";
          }
          ws.send(
            JSON.stringify({
              type: "event",
              event: "agent",
              payload: agentPayload,
            })
          );
          console.log(`  🦞 Agent: "${response.substring(0, 60)}..."`);
        }, delay);
        break;

      // --- Chat history ---
      case "chat.history":
        ws.send(
          JSON.stringify({
            type: "res",
            id,
            ok: true,
            payload: {
              messages: [
                {
                  role: "assistant",
                  content: "Welcome! I'm your family assistant. Ask me anything! 🦞",
                  timestamp: Date.now() - 60000,
                },
              ],
            },
          })
        );
        break;

      // --- Health ---
      case "health":
        ws.send(
          JSON.stringify({
            type: "res",
            id,
            ok: true,
            payload: { status: "healthy" },
          })
        );
        break;

      default:
        console.log(`  ? Unknown method: ${method}`);
        sendError(ws, id, `Unknown method: ${method}`);
    }
  });

  ws.on("close", () => console.log("← Client disconnected"));

  // Demo mode: send proactive briefings
  if (DEMO) {
    const briefingInterval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(briefingInterval);
        return;
      }
      const briefingPayload = {
        role: "assistant",
        content: generateBriefing(),
        timestamp: Date.now(),
        channel: WHATSAPP ? "whatsapp" : "cron",
      };
      if (WHATSAPP) {
        briefingPayload.sender = "user-whatsapp-1";
        briefingPayload.senderName = "User";
      }
      ws.send(
        JSON.stringify({
          type: "event",
          event: "chat.message",
          payload: briefingPayload,
        })
      );
      console.log("  📋 Sent proactive briefing");
    }, 30000);
  }
});

function sendError(ws, id, message) {
  ws.send(JSON.stringify({ type: "res", id, ok: false, error: { message } }));
}

// --- Response generation ---
function generateResponse(input) {
  const lower = (input || "").toLowerCase();

  if (/hello|hi|hey|morning|good/.test(lower)) {
    return "Good morning! ☀️ The family calendar looks manageable today. Want me to run through the highlights?";
  }
  if (/briefing|schedule|today|calendar/.test(lower)) {
    return generateBriefing();
  }
  if (/add\b.*\b(to|task|list|shopping|chore)/i.test(lower) || /shopping/i.test(lower)) {
    return generateTaskAdd(input);
  }
  if (/task|todo|remind|what needs|chore/i.test(lower)) {
    return generateTaskList();
  }
  if (/quiz|study|homework|learn|practice|question/i.test(lower)) {
    return generateQuiz(lower);
  }
  if (/weather|temperature|rain/.test(lower)) {
    return "It's currently **62°F** and partly cloudy in your area. High of 68°F expected today. No rain in the forecast — great day to be outside! 🌤️";
  }
  if (/recipe|dinner|cook|meal/.test(lower)) {
    return "Based on what's usually in the pantry, how about **Lemon Herb Chicken** tonight? It's quick (30 min) and the kids usually like it. I can pull up the full recipe if you want!";
  }

  return `Great question! Let me think about that...\n\nI'd be happy to help with "${input.substring(0, 50)}". In a full setup, this would go through your OpenClaw agent with access to all your configured tools and skills. 🦞`;
}

function generateTaskList() {
  return "**✅ Family Task List**\n\n" +
    "🔴 **Due today:**\n" +
    "- Pick up groceries (assigned: Parent)\n" +
    "- Submit school permission slip\n\n" +
    "🟡 **This week:**\n" +
    "- Schedule dentist appointment\n" +
    "- Review ADU contractor proposal\n\n" +
    "🟢 **Upcoming:**\n" +
    "- Plan weekend hike\n" +
    "- Order birthday present for Grandma\n\n" +
    "Want me to add or update anything?";
}

function generateTaskAdd(input) {
  const item = input.replace(/^(add|put)\s+/i, "").replace(/\s+(to|on)\s+(the\s+)?(list|tasks?|shopping)/i, "").trim();
  return `**✅ Added to list:**\n- ${item || "New item"}\n\n` +
    "**Current shopping list:**\n" +
    "- Milk\n" +
    "- Bread\n" +
    `- ${item || "New item"}\n\n` +
    "Anything else?";
}

function generateQuiz(input) {
  // Age-appropriate STEM quizzes aligned to California Common Core / NGSS
  const quizBank = {
    math: [
      // ~Ages 6-7 (Grade 1-2)
      { age: 7, q: "What is 14 + 27?", opts: ["A) 39", "B) 41", "C) 43", "D) 31"], hint: "💡 Add the ones first, then the tens" },
      // ~Ages 8-9 (Grade 3)
      { age: 8, q: "What is 7 × 8?", opts: ["A) 54", "B) 56", "C) 58", "D) 64"], hint: "💡 Think of it as (7 × 7) + 7" },
      { age: 8, q: "Which fraction is larger: 2/3 or 3/5?", opts: ["A) 2/3", "B) 3/5", "C) They're equal", "D) Can't tell"], hint: "💡 Try finding a common denominator" },
      // ~Ages 9-10 (Grade 4)
      { age: 9, q: "What is the area of a rectangle with length 12 and width 5?", opts: ["A) 17", "B) 34", "C) 60", "D) 72"], hint: "💡 Area = length × width" },
      { age: 10, q: "Round 4,738 to the nearest hundred.", opts: ["A) 4,700", "B) 4,740", "C) 4,800", "D) 5,000"], hint: "💡 Look at the tens digit — is it 5 or more?" },
      // ~Ages 11-12 (Grade 5-6)
      { age: 11, q: "What is 3/4 × 2/5?", opts: ["A) 5/9", "B) 6/20", "C) 3/10", "D) 1/2"], hint: "💡 Multiply tops, multiply bottoms, then simplify" },
      { age: 12, q: "If a shirt costs $24 and is 25% off, what's the sale price?", opts: ["A) $6", "B) $18", "C) $20", "D) $19"], hint: "💡 25% of 24 = 24 ÷ 4" },
    ],
    science: [
      // ~Ages 7-8 (Grade 2 — life/earth science)
      { age: 7, q: "What do plants need to make food?", opts: ["A) Sunlight and water", "B) Soil and rocks", "C) Wind and rain", "D) Darkness and cold"], hint: "💡 Plants use a process called photosynthesis" },
      // ~Ages 8-9 (Grade 3 — NGSS: forces, life cycles)
      { age: 8, q: "What force pulls objects toward Earth?", opts: ["A) Magnetism", "B) Friction", "C) Gravity", "D) Wind"], hint: "💡 It's why things fall down, not up!" },
      { age: 9, q: "Which planet is closest to the Sun?", opts: ["A) Venus", "B) Mars", "C) Mercury", "D) Earth"], hint: "💡 It's named after the Roman messenger god" },
      // ~Ages 10-11 (Grade 4-5 — NGSS: matter, energy, ecosystems)
      { age: 10, q: "What is the powerhouse of the cell?", opts: ["A) Nucleus", "B) Mitochondria", "C) Ribosome", "D) Cell wall"], hint: "💡 It converts food into energy (ATP)" },
      { age: 10, q: "Water changing from liquid to gas is called:", opts: ["A) Condensation", "B) Freezing", "C) Evaporation", "D) Melting"], hint: "💡 Think about what happens to a puddle on a hot day" },
      { age: 11, q: "In a food chain, what do we call an organism that makes its own food?", opts: ["A) Consumer", "B) Decomposer", "C) Producer", "D) Predator"], hint: "💡 Plants do this using sunlight" },
      // ~Ages 12+ (Grade 6 — earth science, physics basics)
      { age: 12, q: "What type of rock forms from cooled magma or lava?", opts: ["A) Sedimentary", "B) Metamorphic", "C) Igneous", "D) Fossil"], hint: "💡 'Ignis' means fire in Latin" },
    ],
  };

  // Determine subject from input
  let subject;
  if (/math|number|multiply|fraction|area/i.test(input)) subject = "math";
  else if (/science|cell|planet|force|energy/i.test(input)) subject = "science";
  else subject = Math.random() < 0.5 ? "math" : "science";

  // Extract age from the prompt if present (e.g., "8 years old" from expanded template)
  const ageMatch = input.match(/(\d{1,2})\s*years?\s*old/i);
  const targetAge = ageMatch ? parseInt(ageMatch[1]) : 8;

  // Extract question count if present (e.g., "Generate 3 quiz questions")
  const countMatch = input.match(/(\d)\s*quiz\s*question/i);
  const count = countMatch ? parseInt(countMatch[1]) : 1;

  const pool = quizBank[subject];

  // Sort by closest age, then pick `count` questions
  const sorted = [...pool].sort((a, b) => Math.abs(a.age - targetAge) - Math.abs(b.age - targetAge));
  const picked = sorted.slice(0, Math.min(count, sorted.length));

  const subjectLabel = subject === "math" ? "Math" : "Science";
  let result = `**📚 ${subjectLabel} Quiz — California Standards (Age ${targetAge})**\n\n`;

  picked.forEach((q, i) => {
    result += `**Q${i + 1}: ${q.q}**\n\n`;
    result += q.opts.join("\n") + "\n\n";
    result += q.hint + "\n\n";
    if (i < picked.length - 1) result += "---\n\n";
  });

  result += "Tell me your answers! 🚀";
  return result;
}

function generateBriefing() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dateStr = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  return `**☀️ Family Briefing — ${dateStr}**\n\n` +
    `**📅 Today's Schedule:**\n` +
    `• 8:30 AM — School drop-off\n` +
    `• 10:00 AM — Team standup\n` +
    `• 3:15 PM — Pickup + soccer practice\n` +
    `• 6:00 PM — Family dinner\n\n` +
    `**✅ Action Items:**\n` +
    `• Permission slip due today\n` +
    `• ADU contractor responding by EOD\n\n` +
    `**🌤️ Weather:** 68°F, partly cloudy. No rain.\n\n` +
    `Have a great day! 🦞`;
}
