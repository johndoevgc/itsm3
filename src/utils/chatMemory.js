// ─── Conversational Memory Engine ─────────────────────────────────────
// Maintains context across chat messages so AI can reference prior topics,
// incidents, and user intent within the same session.

const MAX_HISTORY = 20; // max messages to retain for context
const MAX_ENTITIES = 50; // max tracked entities (incidents, users, etc.)
const STORAGE_KEY = "vgc_chat_memory";

/**
 * Create a new conversation memory instance.
 * Tracks: message history summary, mentioned entities, active topic, user preferences.
 */
export function createChatMemory() {
  // Try restore from sessionStorage (survives page refresh within tab)
  let stored = null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw);
  } catch { /* ignore */ }

  return {
    history: stored?.history || [],       // [{role, summary, timestamp, intent}]
    entities: stored?.entities || {},      // {type: [{id, label, lastMentioned}]}
    activeTopic: stored?.activeTopic || null, // current conversation topic
    topicStack: stored?.topicStack || [],  // previous topics for "go back"
    userPrefs: stored?.userPrefs || {},    // learned preferences (verbosity, format)
    sessionId: stored?.sessionId || crypto.randomUUID?.() || Date.now().toString(36),
  };
}

/**
 * Add a message to conversational memory.
 */
export function addToMemory(memory, message) {
  const entry = {
    role: message.role,
    summary: summarizeMessage(message.text || ""),
    timestamp: Date.now(),
    intent: message._intent || null,
    hasCards: !!(message.cards?.length),
  };

  memory.history.push(entry);
  if (memory.history.length > MAX_HISTORY) {
    memory.history = memory.history.slice(-MAX_HISTORY);
  }

  // Extract entities from message text
  const extracted = extractEntities(message.text || "");
  for (const [type, items] of Object.entries(extracted)) {
    if (!memory.entities[type]) memory.entities[type] = [];
    for (const item of items) {
      const existing = memory.entities[type].find(e => e.id === item.id);
      if (existing) {
        existing.lastMentioned = Date.now();
        existing.count = (existing.count || 1) + 1;
      } else {
        memory.entities[type].push({ ...item, lastMentioned: Date.now(), count: 1 });
      }
    }
    // Trim to max
    if (memory.entities[type].length > MAX_ENTITIES) {
      memory.entities[type] = memory.entities[type]
        .sort((a, b) => b.lastMentioned - a.lastMentioned)
        .slice(0, MAX_ENTITIES);
    }
  }

  // Detect topic changes
  const topic = detectTopic(message.text || "");
  if (topic && topic !== memory.activeTopic) {
    if (memory.activeTopic) memory.topicStack.push(memory.activeTopic);
    if (memory.topicStack.length > 10) memory.topicStack = memory.topicStack.slice(-10);
    memory.activeTopic = topic;
  }

  persistMemory(memory);
  return memory;
}

/**
 * Build context string for AI prompt injection.
 * Returns a concise summary of conversation state for the system prompt.
 */
export function buildMemoryContext(memory) {
  const parts = [];

  // Active topic
  if (memory.activeTopic) {
    parts.push(`[Active Topic: ${memory.activeTopic}]`);
  }

  // Recent history (last 5 messages summarized)
  const recent = memory.history.slice(-5);
  if (recent.length > 0) {
    const histStr = recent
      .map(h => `${h.role === "user" ? "User" : "AI"}: ${h.summary}`)
      .join(" → ");
    parts.push(`[Recent Context: ${histStr}]`);
  }

  // Mentioned entities
  const entityTypes = Object.keys(memory.entities);
  if (entityTypes.length > 0) {
    const entStr = entityTypes.map(type => {
      const items = memory.entities[type]
        .sort((a, b) => b.lastMentioned - a.lastMentioned)
        .slice(0, 3);
      return `${type}: ${items.map(i => i.label || i.id).join(", ")}`;
    }).join("; ");
    parts.push(`[Referenced: ${entStr}]`);
  }

  return parts.length > 0 ? "\n" + parts.join("\n") : "";
}

/**
 * Clear conversation memory (new session).
 */
export function clearMemory(memory) {
  memory.history = [];
  memory.entities = {};
  memory.activeTopic = null;
  memory.topicStack = [];
  memory.sessionId = crypto.randomUUID?.() || Date.now().toString(36);
  persistMemory(memory);
  return memory;
}

// ─── Internal Helpers ─────────────────────────────────────────────────

function summarizeMessage(text) {
  if (!text) return "";
  // Truncate to ~80 chars, preserving word boundaries
  const clean = text.replace(/\n+/g, " ").trim();
  if (clean.length <= 80) return clean;
  return clean.slice(0, 77).replace(/\s+\S*$/, "") + "...";
}

function extractEntities(text) {
  const entities = {};
  // Incident IDs: INC-001, INC001, etc.
  const incMatches = text.match(/INC[-\s]?\d{3,}/gi);
  if (incMatches) {
    entities.incidents = incMatches.map(m => ({
      id: m.replace(/\s/g, "").toUpperCase(),
      label: m.replace(/\s/g, "").toUpperCase(),
    }));
  }
  // Change IDs: CHG-001
  const chgMatches = text.match(/CHG[-\s]?\d{3,}/gi);
  if (chgMatches) {
    entities.changes = chgMatches.map(m => ({
      id: m.replace(/\s/g, "").toUpperCase(),
      label: m.replace(/\s/g, "").toUpperCase(),
    }));
  }
  // Problem IDs: PRB-001
  const prbMatches = text.match(/PRB[-\s]?\d{3,}/gi);
  if (prbMatches) {
    entities.problems = prbMatches.map(m => ({
      id: m.replace(/\s/g, "").toUpperCase(),
      label: m.replace(/\s/g, "").toUpperCase(),
    }));
  }
  // SLA references
  if (/\bsla\b/i.test(text)) {
    if (!entities.topics) entities.topics = [];
    entities.topics.push({ id: "sla", label: "SLA" });
  }
  return entities;
}

function detectTopic(text) {
  const lower = text.toLowerCase();
  const topicMap = [
    [/\b(incident|ticket|issue|outage|down)\b/, "incidents"],
    [/\b(sla|breach|response time|resolution time)\b/, "sla"],
    [/\b(change|deployment|release|rollback)\b/, "changes"],
    [/\b(approval|approve|reject)\b/, "approvals"],
    [/\b(report|analytics|metrics|kpi)\b/, "reports"],
    [/\b(knowledge|kb|article|documentation)\b/, "knowledge"],
    [/\b(asset|cmdb|hardware|software)\b/, "assets"],
    [/\b(team|workload|assignment|assign)\b/, "team"],
    [/\b(escalat|priority|urgent|critical)\b/, "escalation"],
    [/\b(customer|end.?user|self.?service)\b/, "customer"],
    [/\b(password|reset|account|access)\b/, "account"],
  ];
  for (const [pattern, topic] of topicMap) {
    if (pattern.test(lower)) return topic;
  }
  return null;
}

function persistMemory(memory) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch { /* ignore quota errors */ }
}
