/**
 * Chat Assist routes (/api/chat-assist/*)
 *
 * Conversational helper used by two surfaces:
 *   1. Agents — side-panel co-pilot inside the ticket view (channel="agent")
 *   2. Customers — self-service portal widget          (channel="customer")
 *
 * Sessions persist in the `chat_assist_sessions` collection. Each user message
 * is PII-redacted (when the `pii_redact` flag is on) before being sent to the
 * model. KB grounding is pulled from the existing `kb` and `ai_knowledge`
 * collections. All write paths are audited.
 *
 * Endpoints:
 *   POST   /api/chat-assist/session           — create a session
 *   POST   /api/chat-assist/message           — append user msg, get AI reply
 *   POST   /api/chat-assist/handoff           — flip session to live agent
 *   POST   /api/chat-assist/insert            — push assistant text into a ticket
 *   POST   /api/chat-assist/feedback          — thumbs up/down on a message
 *   POST   /api/chat-assist/intake-action     — VGC AI Assist card action (customer)
 *   POST   /api/chat-assist/create-ticket     — finalize intake → create INC- row
 *   POST   /api/chat-assist/csat              — submit 1-5 star CSAT
 *   POST   /api/chat-assist/book-slot         — pick remote-session slot
 *   GET    /api/chat-assist/sessions/:id      — fetch one session
 *   GET    /api/chat-assist/sessions          — list (filter by channel/owner)
 *
 * Customer-channel sessions follow the VGC AI Assist guided flow:
 *   greeting → category → field:title → field:description → field:errorMsg →
 *   field:devices → field:impact → field:priority → field:startedAt →
 *   field:triedSteps → confirm → ticket-created → solution → followup →
 *   resolved | escalated → csat → closed
 */

const piiRedact = require("../piiRedact");
const featureFlags = require("../featureFlags");

const SESSION_COLLECTION = "chat_assist_sessions";
const FUNNEL_COLLECTION = "ai_assist_funnel_events";

// ─── Multi-language support (en / zh / ms / hi) ─────────────────────────
// VGC SG market: English (default), Mandarin Chinese, Bahasa Melayu, Hindi.
// We detect language from the first user message via Unicode-range +
// keyword heuristics, persist on the session, and use it to:
//   1. Pick localized canned strings (greetings, acks, CSAT thanks).
//   2. Append a "Reply in <language>" line to the AI system prompt.
const SUPPORTED_LANGS = ["en", "zh", "ms", "hi"];
const LANG_NAMES = { en: "English", zh: "Mandarin Chinese", ms: "Bahasa Melayu", hi: "Hindi" };
const MS_KEYWORDS = /\b(saya|tidak|boleh|tolong|masalah|terima\s*kasih|sila|apa|bagaimana|selamat|pagi|petang|malam)\b/i;

function detectLang(text) {
  if (!text || typeof text !== "string") return "en";
  // Chinese (CJK Unified Ideographs)
  if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(text)) return "zh";
  // Hindi (Devanagari)
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  // Malay — keyword heuristic (Latin script, can't go on Unicode alone)
  if (MS_KEYWORDS.test(text)) return "ms";
  return "en";
}

const I18N = {
  greetingTemplate: {
    en: (n) => `Hi ${n}, I'm VGC AI Assist. I'm here to help you resolve your IT issue quickly. Please tap the category that best describes your problem — or type your question below.`,
    zh: (n) => `${n} 您好，我是 VGC AI 智能助理。我会协助您快速解决 IT 问题。请点选最符合您问题的类别 — 或在下方输入您的问题。`,
    ms: (n) => `Hai ${n}, saya VGC AI Assist. Saya di sini untuk membantu menyelesaikan masalah IT anda dengan cepat. Sila pilih kategori yang paling sesuai dengan masalah anda — atau taip soalan anda di bawah.`,
    hi: (n) => `नमस्ते ${n}, मैं VGC AI Assist हूँ। मैं आपकी IT समस्या को जल्दी सुलझाने में मदद करने के लिए यहाँ हूँ। कृपया अपनी समस्या से मेल खाने वाली श्रेणी पर टैप करें — या नीचे अपना प्रश्न लिखें।`,
  },
  categorySelected: {
    en: (c) => `Great, you've selected ${c}. Let me collect a few details so I can assist you effectively.`,
    zh: (c) => `好的，您选择了 ${c}。请让我收集一些资料，以便有效地协助您。`,
    ms: (c) => `Bagus, anda telah memilih ${c}. Izinkan saya mengumpulkan beberapa butiran untuk membantu anda dengan berkesan.`,
    hi: (c) => `बहुत अच्छा, आपने ${c} चुना है। बेहतर सहायता के लिए मुझे कुछ विवरण एकत्र करने दें।`,
  },
  ticketCreated: {
    en: (id, sev, sla) => `Your ticket ${id} has been created (severity ${sev}, SLA ${sla}). Now let me walk you through what to try first — just type 'help' or describe the issue and I'll suggest steps.`,
    zh: (id, sev, sla) => `您的工单 ${id} 已建立（级别 ${sev}，SLA ${sla}）。现在让我引导您先尝试一些步骤 — 输入「help」或描述问题，我会建议解决方法。`,
    ms: (id, sev, sla) => `Tiket anda ${id} telah dicipta (keterukan ${sev}, SLA ${sla}). Sekarang izinkan saya memandu anda — taip 'help' atau terangkan masalah anda dan saya akan cadangkan langkah-langkah.`,
    hi: (id, sev, sla) => `आपका टिकट ${id} बना दिया गया है (गंभीरता ${sev}, SLA ${sla})। अब मैं आपको आगे की प्रक्रिया बताऊंगा — 'help' टाइप करें या समस्या बताएं और मैं चरण सुझाऊंगा।`,
  },
  csatThanksHigh: {
    en: "Thank you so much for the kind rating — it really helps the team. Have a great day!",
    zh: "非常感谢您给予好评 — 这对团队很有帮助。祝您有美好的一天！",
    ms: "Terima kasih banyak atas penilaian baik anda — ia sangat membantu pasukan kami. Semoga hari anda menyenangkan!",
    hi: "आपकी अच्छी रेटिंग के लिए बहुत-बहुत धन्यवाद — यह टीम के लिए बहुत मददगार है। आपका दिन शुभ हो!",
  },
  csatThanksLow: {
    en: "Thank you for the honest feedback — we'll review and do better. A VGC team member may follow up shortly.",
    zh: "感谢您坦诚的反馈 — 我们会检讨并加以改进。VGC 团队成员稍后将跟进。",
    ms: "Terima kasih atas maklum balas jujur anda — kami akan semak dan perbaiki. Seorang ahli pasukan VGC akan menghubungi anda tidak lama lagi.",
    hi: "ईमानदार प्रतिक्रिया के लिए धन्यवाद — हम समीक्षा करेंगे और बेहतर करेंगे। VGC टीम सदस्य जल्द ही संपर्क करेगा।",
  },
  acks: {
    en: ["Got it.", "Understood.", "Thanks for that detail.", "Noted."],
    zh: ["好的。", "明白了。", "感谢您提供详情。", "已记下。"],
    ms: ["Baik.", "Difahami.", "Terima kasih atas butirannya.", "Sudah dicatat."],
    hi: ["समझ गया।", "ठीक है।", "विवरण के लिए धन्यवाद।", "दर्ज कर लिया।"],
  },
};

function t(key, lang, ...args) {
  const dict = I18N[key];
  if (!dict) return "";
  const v = dict[SUPPORTED_LANGS.includes(lang) ? lang : "en"] ?? dict.en;
  return typeof v === "function" ? v(...args) : v;
}

// Fire-and-forget funnel event — never blocks the request.
function recordFunnelEvent(db, session, fromStage, toStage, extra) {
  if (!db || !session) return;
  if (fromStage === toStage) return;
  const id = `fnl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const payload = {
    id,
    sessionId: session.id,
    channel: session.channel,
    lang: session.intake?.lang || "en",
    fromStage: fromStage || null,
    toStage: toStage || null,
    ticketId: session.ticketId || session.intake?.ticketId || null,
    severity: session.intake?.severity || null,
    extra: extra || null,
    at: new Date().toISOString(),
  };
  // Detached promise — log but do not throw on failure.
  Promise.resolve()
    .then(() => db.upsert(FUNNEL_COLLECTION, id, JSON.stringify(payload)))
    .catch((e) => console.warn("[ChatAssist] funnel write failed:", e.message));
}

function getFlagPayload() {
  try {
    if (!featureFlags.isEnabled("chat_assist")) return null;
    return featureFlags.payload("chat_assist") || {};
  } catch {
    return null;
  }
}

function newSessionId() {
  return `cas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function newMessageId() {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function loadSession(db, id) {
  if (!id) return null;
  const row = await db.getOne(SESSION_COLLECTION, id);
  if (!row) return null;
  try {
    return typeof row.data === "string" ? JSON.parse(row.data) : row.data;
  } catch {
    return null;
  }
}

async function saveSession(db, session) {
  session.updatedAt = new Date().toISOString();
  await db.upsert(SESSION_COLLECTION, session.id, JSON.stringify(session));
  return session;
}

// Naive token-overlap KB scorer — keeps grounding deterministic and avoids
// pulling in an embeddings dep. Returns top-k articles with score > 0.
function rankKbArticles(articles, query, k) {
  if (!query) return [];
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);
  if (!tokens.length) return [];
  const scored = [];
  for (const a of articles) {
    const hay = `${a.title || ""}\n${a.content || a.body || ""}\n${(a.tags || []).join(" ")}`.toLowerCase();
    if (!hay) continue;
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score += 1;
      if ((a.title || "").toLowerCase().includes(t)) score += 1;
    }
    if (score > 0) scored.push({ article: a, score });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, k);
}

async function gatherKbGrounding(db, query, topK) {
  const out = [];
  try {
    const kbRows = await db.getAll("kb");
    const kb = kbRows
      .map(r => { try { return JSON.parse(r.data); } catch { return null; } })
      .filter(a => a && (a.status ? a.status === "Published" : true));
    out.push(...rankKbArticles(kb, query, topK));
  } catch { /* ignore */ }
  try {
    const aiKb = await db.getAll("ai_knowledge");
    const items = aiKb
      .map(r => { try { return JSON.parse(r.data); } catch { return null; } })
      .filter(Boolean);
    out.push(...rankKbArticles(items, query, topK));
  } catch { /* ignore */ }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, topK).map(({ article, score }) => ({
    id: article.id,
    title: article.title || "(untitled)",
    snippet: String(article.content || article.body || "").slice(0, 400),
    screenshotUrl: typeof article.screenshotUrl === "string" && /^https?:\/\//i.test(article.screenshotUrl) ? article.screenshotUrl : null,
    videoUrl: typeof article.videoUrl === "string" && /^https?:\/\//i.test(article.videoUrl) ? article.videoUrl : null,
    score,
  }));
}

// VGC AI Assist — full customer persona (see /memories/session/plan.md and
// the product spec). The state machine below owns greeting/intake/CSAT flow;
// the model is only used to generate solution steps + layman re-explanations.
const VGC_CUSTOMER_PERSONA = [
  "You are VGC AI Assist, an enterprise IT support assistant for VGC Technology Pte Ltd, a Singapore-based Microsoft Solutions Partner serving SMEs.",
  "Persona: calm, professional, approachable — like a senior IT support lead. Plain English, no unexplained jargon. Translate every technical step into layman instructions. Acknowledge frustration warmly when present. Reflect Singapore business culture: polite, efficient, solution-oriented.",
  "You are operating inside a guided conversational flow. The flow controls greeting, intake form, ticket creation, escalation, and CSAT — you do NOT need to ask those questions.",
  "Your job is: (1) generate clear, numbered, layman-friendly solution steps when asked; (2) re-explain a step in simpler terms when the customer is confused; (3) acknowledge customer messages warmly between steps.",
  "Rules: never invent ticket numbers, prices, or customer data. Never share other customers' information or internal credentials. Never request passwords or sensitive personal data beyond name/company/email. Never promise resolution times beyond stated SLA commitments.",
  "When citing a knowledge-base article, write the ID in square brackets, e.g. [KB0010]. Keep replies under 6 sentences unless walking through numbered solution steps.",
  "If the issue is outside your knowledge after a thorough KB check, say 'I'm checking further' or 'Let me connect you with an engineer' — never just 'I don't know'.",
].join(" ");

function buildSystemPrompt(channel, lang) {
  const base = channel === "customer" ? VGC_CUSTOMER_PERSONA : [
    "You are an IT service-desk co-pilot helping the on-call agent.",
    "Suggest the next best response or remediation step.",
    "Cite KB IDs in square brackets (e.g. [KB0010]) when grounded.",
    "Flag low confidence explicitly. Do not fabricate ticket data.",
    "Keep replies under 120 words. Use markdown bullets when listing steps.",
  ].join(" ");
  const useLang = SUPPORTED_LANGS.includes(lang) ? lang : "en";
  if (useLang === "en") return base;
  return `${base}\n\nIMPORTANT: Reply in ${LANG_NAMES[useLang]} (the language the customer is writing in). Keep KB IDs and ticket numbers in their original format.`;
}

// ─── VGC AI Assist intake state machine ──────────────────────────────────

const CATEGORY_OPTIONS = [
  { value: "Device & Hardware",       label: "Device & Hardware",       icon: "🖥️" },
  { value: "Email & Outlook",         label: "Email & Outlook",         icon: "📧" },
  { value: "Access & Login",          label: "Access & Login",          icon: "🔐" },
  { value: "Network & Connectivity",  label: "Network & Connectivity",  icon: "🌐" },
  { value: "Printer & Peripherals",   label: "Printer & Peripherals",   icon: "🖨️" },
  { value: "Mobile & Apps",           label: "Mobile & Apps",           icon: "📱" },
  { value: "Microsoft 365 & Cloud",   label: "Microsoft 365 & Cloud",   icon: "☁️" },
  { value: "Security & Virus",        label: "Security & Virus",        icon: "🔒" },
  { value: "File & Data",             label: "File & Data",             icon: "📂" },
  { value: "Other / Not Listed",      label: "Other / Not Listed",      icon: "❓" },
];

const IMPACT_OPTIONS = [
  { value: "Completely blocked",   label: "Completely blocked",   icon: "🛑" },
  { value: "Significant slowdown", label: "Significant slowdown", icon: "🐢" },
  { value: "Minor inconvenience",  label: "Minor inconvenience",  icon: "⚠️" },
  { value: "Just checking",        label: "Just checking",        icon: "💬" },
];

const PRIORITY_OPTIONS = [
  { value: "Critical – need it now", label: "Critical – need it now", icon: "🚨" },
  { value: "High – within today",    label: "High – within today",    icon: "🔴" },
  { value: "Normal – within 2 days", label: "Normal – within 2 days", icon: "🟡" },
  { value: "Low – no rush",          label: "Low – no rush",          icon: "🟢" },
];

const INTAKE_FIELDS = [
  { key: "title",       prompt: "In one sentence, what is the main problem you are experiencing?" },
  { key: "description", prompt: "Please describe what happened in more detail. What were you doing when this started?" },
  { key: "errorMsg",    prompt: "Do you see any error message on screen? If yes, please describe it. (Type 'no' or 'skip' if none.)" },
  { key: "devices",     prompt: "Which device or system is affected? (e.g. laptop, desktop, mobile, server)" },
  { key: "impact",      prompt: "How is this affecting your work right now?", card: "impact" },
  { key: "priority",    prompt: "How urgently do you need this resolved?", card: "priority" },
  { key: "startedAt",   prompt: "Roughly when did this issue first occur?" },
  { key: "triedSteps",  prompt: "Have you already tried anything to fix this? What happened? (Type 'no' if nothing tried.)" },
];

const SLA_BY_SEVERITY = { P1: "1 hour", P2: "4 hours", P3: "8 hours", P4: "Next business day" };

function newTicketId() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `INC-${ymd}-${rand}`;
}

// Severity heuristic per spec §4. Returns 'P1' .. 'P4'.
function assessSeverity(intake) {
  const fields = intake?.fields || {};
  const impact = String(fields.impact || "").toLowerCase();
  const priority = String(fields.priority || "").toLowerCase();
  const text = `${fields.title || ""} ${fields.description || ""} ${fields.errorMsg || ""}`.toLowerCase();
  if (/\b(breach|ransomware|data\s+loss|exfiltrat|hacked)\b/.test(text)) return "P1";
  if (impact.startsWith("completely") && (priority.startsWith("critical") || /\b(down|outage|server|production|business[-\s]wide)\b/.test(text))) return "P1";
  if (impact.startsWith("completely") || priority.startsWith("critical")) return "P2";
  if (impact.startsWith("significant") || priority.startsWith("high")) return "P2";
  if (impact.startsWith("minor") || priority.startsWith("normal")) return "P3";
  return "P4";
}

// Map customer priority → standard ITSM severity badge for the incidents row.
function mapPriorityToSev(priorityText) {
  const p = String(priorityText || "").toLowerCase();
  if (p.startsWith("critical")) return "Sev-A";
  if (p.startsWith("high"))     return "Sev-B";
  if (p.startsWith("normal"))   return "Sev-C";
  return "Sev-D";
}

function defaultIntake() {
  return {
    stage: "greeting",
    lang: "en",         // detected from first user message
    category: null,
    fields: {},
    attempts: 0,        // failed solution rounds (auto-escalate at >=2)
    severity: null,
    ticketId: null,
    csat: null,
  };
}

function findFieldIndex(stage) {
  const m = /^field:(.+)$/.exec(stage || "");
  if (!m) return -1;
  return INTAKE_FIELDS.findIndex(f => f.key === m[1]);
}

function nextFieldStage(currentStage) {
  if (currentStage === "category") return `field:${INTAKE_FIELDS[0].key}`;
  const idx = findFieldIndex(currentStage);
  if (idx < 0) return null;
  if (idx + 1 >= INTAKE_FIELDS.length) return "confirm";
  return `field:${INTAKE_FIELDS[idx + 1].key}`;
}

function fieldCardFor(field) {
  if (field.card === "impact")   return { type: "quick-reply", kind: "pick-impact",   options: IMPACT_OPTIONS };
  if (field.card === "priority") return { type: "quick-reply", kind: "pick-priority", options: PRIORITY_OPTIONS };
  return null;
}

function buildAssistantMessage({ text, cards }) {
  return {
    id: newMessageId(),
    role: "assistant",
    text: text || "",
    cards: Array.isArray(cards) ? cards : [],
    createdAt: new Date().toISOString(),
  };
}

function firstName(s) {
  if (!s) return "there";
  return String(s).split(/[\s@]/)[0] || "there";
}

function summaryCard(intake) {
  return {
    type: "intake-summary",
    kind: "confirm-intake",
    fields: { category: intake.category, ...intake.fields },
    actions: [
      { kind: "confirm-intake", value: "confirm", label: "✅ Looks right — create my ticket" },
      { kind: "confirm-intake", value: "edit",    label: "✏️ Let me change something" },
    ],
  };
}

function escalationCard(reason, severity) {
  return {
    type: "escalated",
    reason,
    sla: SLA_BY_SEVERITY[severity] || SLA_BY_SEVERITY.P3,
    severity: severity || "P3",
  };
}

function slotPickerCard() {
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  const at = (d, h, m) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x.toISOString(); };
  return {
    type: "slot-picker",
    kind: "book-slot",
    options: [
      { value: at(today, 14, 0),     label: "Today 2:00 PM SGT",     icon: "🕑" },
      { value: at(today, 15, 30),    label: "Today 3:30 PM SGT",     icon: "🕒" },
      { value: at(tomorrow, 10, 0),  label: "Tomorrow 10:00 AM SGT", icon: "🕙" },
      { value: at(tomorrow, 14, 0),  label: "Tomorrow 2:00 PM SGT",  icon: "🕑" },
      { value: "other",              label: "Other — let me know",    icon: "✏️" },
    ],
  };
}

function csatCard() {
  return {
    type: "csat",
    kind: "csat-rate",
    options: [1, 2, 3, 4, 5].map(n => ({ value: n, label: "⭐".repeat(n), icon: null })),
  };
}

// Pure state-machine. Mutates session.intake and returns an assistantMsg.
// `action` shape: { kind, value }
// kinds: start-greeting | select-category | answer-field | pick-impact |
//        pick-priority | skip-field | confirm-intake | request-solution |
//        step-worked | step-failed | request-agent | mark-resolved
function advanceIntake(session, action, customerName) {
  if (!session.intake) session.intake = defaultIntake();
  const intake = session.intake;
  const kind = action?.kind;
  const value = action?.value;

  // Helper: emit prompt for a given field stage.
  const promptForStage = (stage) => {
    const idx = findFieldIndex(stage);
    if (idx < 0) return null;
    const f = INTAKE_FIELDS[idx];
    const card = fieldCardFor(f);
    return buildAssistantMessage({ text: f.prompt, cards: card ? [card] : [] });
  };

  switch (kind) {
    case "start-greeting": {
      intake.stage = "category";
      const lang = intake.lang || "en";
      const greeting = t("greetingTemplate", lang, firstName(customerName));
      return buildAssistantMessage({
        text: greeting,
        cards: [{ type: "category-grid", kind: "select-category", options: CATEGORY_OPTIONS }],
      });
    }
    case "select-category": {
      intake.category = value || "Other / Not Listed";
      intake.stage = `field:${INTAKE_FIELDS[0].key}`;
      const lang = intake.lang || "en";
      return buildAssistantMessage({
        text: `${t("categorySelected", lang, intake.category)}\n\n${INTAKE_FIELDS[0].prompt}`,
      });
    }
    case "answer-field": {
      const idx = findFieldIndex(intake.stage);
      if (idx < 0) return null;
      const fieldKey = INTAKE_FIELDS[idx].key;
      intake.fields[fieldKey] = String(value || "").slice(0, 2000);
      const next = nextFieldStage(intake.stage);
      intake.stage = next;
      if (next === "confirm") {
        return buildAssistantMessage({
          text: "Thanks for that detail. Here's a quick summary — please review and confirm so I can log your ticket.",
          cards: [summaryCard(intake)],
        });
      }
      const ack = (I18N.acks[intake.lang || "en"] || I18N.acks.en)[idx % 4];
      const promptMsg = promptForStage(next);
      if (promptMsg) promptMsg.text = `${ack} ${promptMsg.text}`;
      return promptMsg;
    }
    case "pick-impact": {
      if (intake.stage !== "field:impact") return null;
      intake.fields.impact = value;
      intake.stage = nextFieldStage(intake.stage);
      return promptForStage(intake.stage);
    }
    case "pick-priority": {
      if (intake.stage !== "field:priority") return null;
      intake.fields.priority = value;
      intake.stage = nextFieldStage(intake.stage);
      if (intake.stage === "confirm") {
        return buildAssistantMessage({
          text: "Thanks. Here's a quick summary — please review and confirm so I can log your ticket.",
          cards: [summaryCard(intake)],
        });
      }
      return promptForStage(intake.stage);
    }
    case "skip-field": {
      const idx = findFieldIndex(intake.stage);
      if (idx < 0) return null;
      intake.fields[INTAKE_FIELDS[idx].key] = intake.fields[INTAKE_FIELDS[idx].key] || "(skipped)";
      intake.stage = nextFieldStage(intake.stage);
      if (intake.stage === "confirm") {
        return buildAssistantMessage({
          text: "No problem. Here's a quick summary — please review and confirm.",
          cards: [summaryCard(intake)],
        });
      }
      return promptForStage(intake.stage);
    }
    case "confirm-intake": {
      // Frontend will call /create-ticket on "confirm". On "edit" we restart.
      if (value === "edit") {
        intake.stage = "category";
        return buildAssistantMessage({
          text: "No problem — let's start over. Please pick the category again.",
          cards: [{ type: "category-grid", kind: "select-category", options: CATEGORY_OPTIONS }],
        });
      }
      return null; // "confirm" handled by /create-ticket endpoint.
    }
    case "step-worked":
    case "mark-resolved": {
      intake.stage = "csat";
      return buildAssistantMessage({
        text: "Wonderful! I'm glad we got that sorted. Before you go, would you mind rating your experience today?",
        cards: [csatCard()],
      });
    }
    case "step-failed": {
      intake.attempts = (intake.attempts || 0) + 1;
      const sev = intake.severity || assessSeverity(intake);
      if (intake.attempts >= 2 || sev === "P1" || sev === "P2") {
        intake.stage = "escalated";
        return buildAssistantMessage({
          text: `This issue requires our engineering team to assist you directly. I'm escalating your ticket ${intake.ticketId || ""} to a VGC engineer now. To assist you faster, please pick a remote-session slot:`,
          cards: [escalationCard("AI resolution unsuccessful", sev), slotPickerCard()],
        });
      }
      return buildAssistantMessage({
        text: "I understand — let me try a different approach. Could you tell me exactly what you saw on screen when you tried that step?",
      });
    }
    case "request-agent": {
      const sev = intake.severity || assessSeverity(intake);
      intake.stage = "escalated";
      return buildAssistantMessage({
        text: `Of course. I'm escalating ticket ${intake.ticketId || ""} to our engineering team now. Please pick a remote-session slot:`,
        cards: [escalationCard("Customer request", sev), slotPickerCard()],
      });
    }
    case "step-result": {
      // Inline card maps to existing kinds.
      if (value === "worked") return advanceIntake(session, { kind: "mark-resolved" }, customerName);
      if (value === "failed") return advanceIntake(session, { kind: "step-failed"  }, customerName);
      if (value === "agent")  return advanceIntake(session, { kind: "request-agent" }, customerName);
      return null;
    }
    default:
      return null;
  }
}

function buildUserPrompt(session, kbContext, redactedQuery) {
  const lines = [];
  lines.push(`Channel: ${session.channel}`);
  if (session.ticketId) lines.push(`Linked ticket: ${session.ticketId}`);
  if (kbContext.length) {
    lines.push("\nKnowledge base context:");
    for (const k of kbContext) {
      lines.push(`- [${k.id}] ${k.title}: ${k.snippet.replace(/\s+/g, " ").trim()}`);
    }
  }
  // Recent dialog (last 6 turns) for short-term memory.
  const tail = (session.messages || []).slice(-6);
  if (tail.length) {
    lines.push("\nRecent dialog:");
    for (const m of tail) lines.push(`${m.role}: ${m.text}`);
  }
  lines.push(`\nuser: ${redactedQuery}`);
  lines.push("\nReply now as the assistant.");
  return lines.join("\n");
}

function estimateConfidence(replyText, kbContext) {
  if (!replyText) return 0;
  const cited = (replyText.match(/\[KB\d+/g) || []).length;
  const hasGrounding = kbContext.length > 0;
  let conf = 50;
  if (cited > 0) conf += 25;
  if (cited >= 2) conf += 10;
  if (hasGrounding && cited === 0) conf -= 15;
  if (/I (don'?t|do not) know|cannot|unable to/i.test(replyText)) conf -= 20;
  if (replyText.length < 30) conf -= 10;
  return Math.max(0, Math.min(100, conf));
}

module.exports = function createChatAssistRoutes(ctx) {
  const { db, json, parseBody, callAI, extractAIText, wsServer } = ctx;

  // Per-IP rolling-window rate limiter for AI message calls.
  // Map<ip, { count, windowStart }>. Window = 60s.
  const rateBuckets = new Map();
  function checkRateLimit(req, limitPerMin) {
    if (!limitPerMin || limitPerMin <= 0) return { ok: true };
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
      || req.socket?.remoteAddress
      || "unknown";
    const now = Date.now();
    const bucket = rateBuckets.get(ip);
    if (!bucket || now - bucket.windowStart >= 60000) {
      rateBuckets.set(ip, { count: 1, windowStart: now });
      return { ok: true };
    }
    bucket.count += 1;
    if (bucket.count > limitPerMin) {
      const retryAfter = Math.max(1, Math.ceil((60000 - (now - bucket.windowStart)) / 1000));
      return { ok: false, retryAfter };
    }
    return { ok: true };
  }
  // Periodic GC so the map can't grow unbounded.
  setInterval(() => {
    const cutoff = Date.now() - 120000;
    for (const [ip, b] of rateBuckets) {
      if (b.windowStart < cutoff) rateBuckets.delete(ip);
    }
  }, 60000).unref?.();

  function actorOf(authResult) {
    return authResult?.user?.email || authResult?.user?.name || authResult?.user || "anonymous";
  }

  return async function handleChatAssist(req, res, pathname, _auth, authResult) {
    if (!pathname.startsWith("/api/chat-assist")) return false;

    // ─── POST /api/chat-assist/session ────────────────────────────────
    if (pathname === "/api/chat-assist/session" && req.method === "POST") {
      const flag = getFlagPayload();
      if (!flag) return json(res, 503, { error: "chat_assist disabled" });
      try {
        const body = await parseBody(req);
        const channel = body.channel === "customer" ? "customer" : "agent";
        if (channel === "customer" && flag.customerWidgetEnabled === false) {
          return json(res, 503, { error: "customer chat widget disabled" });
        }
        const session = {
          id: newSessionId(),
          channel,
          ticketId: body.ticketId || null,
          createdBy: actorOf(authResult),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: "open",
          messages: [],
          // Customer channel uses the VGC AI Assist guided flow.
          intake: channel === "customer" ? defaultIntake() : null,
          customerName: body.customerName || null,
          customerCompany: body.customerCompany || null,
          customerEmail: body.customerEmail || null,
        };
        await saveSession(db, session);
        await db.audit(SESSION_COLLECTION, session.id, "create",
          JSON.stringify({ channel, ticketId: session.ticketId }), session.createdBy);
        return json(res, 201, { session });
      } catch (err) {
        console.error("[ChatAssist] session POST", err.message);
        return json(res, 500, { error: "Internal server error" });
      }
    }

    // ─── POST /api/chat-assist/message ────────────────────────────────
    if (pathname === "/api/chat-assist/message" && req.method === "POST") {
      const flag = getFlagPayload();
      if (!flag) return json(res, 503, { error: "chat_assist disabled" });
      // Per-IP rate limit (defaults to 20/min when payload omits it).
      const limit = Number(flag.rateLimitPerMin) || 20;
      const rl = checkRateLimit(req, limit);
      if (!rl.ok) {
        try { res.setHeader("Retry-After", String(rl.retryAfter)); } catch { /* ignore */ }
        return json(res, 429, { error: "rate limit exceeded", retryAfter: rl.retryAfter });
      }
      try {
        const body = await parseBody(req);
        const { sessionId, text } = body;
        if (!sessionId || !text || typeof text !== "string") {
          return json(res, 400, { error: "sessionId and text are required" });
        }
        if (text.length > 4000) {
          return json(res, 413, { error: "message too long (max 4000 chars)" });
        }
        const session = await loadSession(db, sessionId);
        if (!session) return json(res, 404, { error: "session not found" });
        if (session.status === "handoff") {
          return json(res, 409, { error: "session has been handed off to a live agent" });
        }

        // PII redaction (best-effort — flag-gated)
        let redacted = text;
        let piiMap = {};
        let piiSummary = {};
        try {
          if (featureFlags.isEnabled("pii_redact")) {
            const r = piiRedact.redact(text);
            redacted = r.redacted;
            piiMap = r.map;
            piiSummary = piiRedact.summary(r.map);
          }
        } catch { /* non-fatal */ }

        const userMsg = {
          id: newMessageId(),
          role: "user",
          text,                       // store original (DB is internal)
          redactedText: redacted,
          piiSummary,
          createdAt: new Date().toISOString(),
        };
        session.messages = session.messages || [];
        session.messages.push(userMsg);

        // ─── VGC AI Assist guided flow (customer channel) ────────────────
        // If the session is in a FIELD_* intake stage, treat the user text as
        // the answer to the current field — no AI call. The state machine
        // owns the conversation flow until we reach the SOLUTION stage.
        if (session.channel === "customer" && session.intake) {
          // Language detection on the first user message (best effort).
          if (!session.intake.lang || session.intake.lang === "en") {
            const detected = detectLang(text);
            if (detected !== "en" && SUPPORTED_LANGS.includes(detected)) {
              session.intake.lang = detected;
            } else if (!session.intake.lang) {
              session.intake.lang = "en";
            }
          }
          const stage = session.intake.stage;
          if (stage === "greeting") {
            // First-touch user typed instead of tapping a category.
            const greet = advanceIntake(session, { kind: "start-greeting" }, session.customerName || actorOf(authResult));
            session.messages.push(greet);
            recordFunnelEvent(db, session, "greeting", session.intake.stage, { trigger: "user-typed" });
            await saveSession(db, session);
            return json(res, 200, { sessionId: session.id, message: greet });
          }
          if (findFieldIndex(stage) >= 0) {
            const reply = advanceIntake(session, { kind: "answer-field", value: text }, session.customerName);
            if (reply) {
              session.messages.push(reply);
              recordFunnelEvent(db, session, stage, session.intake.stage, { trigger: "answer-field" });
              await saveSession(db, session);
              return json(res, 200, { sessionId: session.id, message: reply });
            }
          }
          // Other stages (solution, followup, escalated, csat) fall through
          // to the AI flow below.
        }

        // Grounding
        const topK = Number(flag.kbGroundingTopK) || 5;
        const kbContext = await gatherKbGrounding(db, redacted, topK);

        // AI call — keep options minimal (no temperature; GPT-5.4 rejects it)
        const lang = session.intake?.lang || "en";
        const sysPrompt = buildSystemPrompt(session.channel, lang);
        const userPrompt = buildUserPrompt(session, kbContext, redacted);
        let replyText = "";
        let aiOk = false;
        try {
          const aiResp = await callAI(sysPrompt, userPrompt, {
            tier: "secondary",
            maxTokens: 600,
            timeout: 25000,
          });
          replyText = (extractAIText ? extractAIText(aiResp) : "") || "";
          aiOk = !!replyText;
        } catch (err) {
          console.warn("[ChatAssist] AI call failed:", err.message);
        }
        if (!aiOk) {
          replyText = session.channel === "customer"
            ? "I'm having trouble reaching the assistant right now. Would you like me to connect you with a live agent?"
            : "AI backend unavailable. Use KB suggestions or escalate manually.";
        }

        const confidence = estimateConfidence(replyText, kbContext);
        const minConfidence = Number(flag.confidenceThreshold) || 0;

        // Restore PII tokens in the assistant reply so any echo is human-readable.
        // Customer channel: also restore so the persona can quote the customer
        // back warmly (per VGC AI Assist spec §8 "Match the customer's register").
        let finalReply = replyText;
        if (Object.keys(piiMap).length) {
          try { finalReply = piiRedact.restore(replyText, piiMap); } catch { /* ignore */ }
        }

        const assistantMsg = {
          id: newMessageId(),
          role: "assistant",
          text: finalReply,
          confidence,
          lowConfidence: confidence < minConfidence,
          citations: kbContext.map(k => ({ id: k.id, title: k.title })),
          createdAt: new Date().toISOString(),
          aiOk,
        };
        // Customer channel: when the AI is generating a solution turn, attach
        // an inline "Did this work?" card so the customer can answer with one
        // tap (drives the step-worked / step-failed state-machine actions).
        if (session.channel === "customer" && session.intake && aiOk
            && (session.intake.stage === "solution" || session.intake.stage === "followup")) {
          assistantMsg.cards = [{
            type: "quick-reply",
            kind: "step-result",
            options: [
              { value: "worked", label: "✅ Yes, that worked",       icon: null },
              { value: "failed", label: "❌ No, still not working",   icon: null },
              { value: "agent",  label: "👤 I'd like a human engineer", icon: null },
            ],
          }];
          // Attach media from the top KB hit if present (screenshot/video).
          const mediaHit = kbContext.find(k => k.screenshotUrl || k.videoUrl);
          if (mediaHit) {
            assistantMsg.cards.unshift({
              type: "media",
              screenshotUrl: mediaHit.screenshotUrl || null,
              videoUrl: mediaHit.videoUrl || null,
              caption: `From [${mediaHit.id}] ${mediaHit.title}`,
            });
          }
        }
        session.messages.push(assistantMsg);
        await saveSession(db, session);

        return json(res, 200, {
          sessionId: session.id,
          message: assistantMsg,
          suggestHandoff: assistantMsg.lowConfidence || !aiOk,
        });
      } catch (err) {
        console.error("[ChatAssist] message POST", err.message);
        return json(res, 500, { error: "Internal server error" });
      }
    }

    // ─── POST /api/chat-assist/handoff ────────────────────────────────
    if (pathname === "/api/chat-assist/handoff" && req.method === "POST") {
      if (!authResult?.authenticated && !ctx.PROD_TEST_MODE) {
        // Customers may also request handoff; allow when session belongs to them
        // (lightweight check: customer-channel sessions are always handoff-able).
      }
      try {
        const body = await parseBody(req);
        const { sessionId, agentId } = body;
        const session = await loadSession(db, sessionId);
        if (!session) return json(res, 404, { error: "session not found" });
        session.status = "handoff";
        session.handoff = {
          requestedAt: new Date().toISOString(),
          requestedBy: actorOf(authResult),
          agentId: agentId || null,
        };
        await saveSession(db, session);
        await db.audit(SESSION_COLLECTION, session.id, "handoff",
          JSON.stringify({ agentId: agentId || null }), actorOf(authResult));
        try {
          if (wsServer && typeof wsServer.broadcast === "function") {
            wsServer.broadcast({ type: "chat_assist_handoff", sessionId, agentId: agentId || null });
          }
        } catch { /* non-fatal */ }
        return json(res, 200, { ok: true, session });
      } catch (err) {
        console.error("[ChatAssist] handoff POST", err.message);
        return json(res, 500, { error: "Internal server error" });
      }
    }

    // ─── POST /api/chat-assist/insert ─────────────────────────────────
    if (pathname === "/api/chat-assist/insert" && req.method === "POST") {
      if (!authResult?.authenticated) return json(res, 401, { error: "auth required" });
      try {
        const body = await parseBody(req);
        const { ticketId, text, source } = body;
        if (!ticketId || !text) return json(res, 400, { error: "ticketId and text required" });
        const incRow = await db.getOne("incidents", ticketId);
        if (!incRow) return json(res, 404, { error: "incident not found" });
        let inc;
        try { inc = typeof incRow.data === "string" ? JSON.parse(incRow.data) : incRow.data; }
        catch { return json(res, 500, { error: "incident parse failure" }); }

        const actor = actorOf(authResult);
        const entry = {
          id: `AL_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: "comment",
          user: actor,
          time: new Date().toISOString(),
          detail: `[Chat Assist${source ? ` · ${source}` : ""}] ${text}`,
        };
        inc.activityLog = Array.isArray(inc.activityLog) ? inc.activityLog : [];
        inc.activityLog.push(entry);
        inc.updatedAt = new Date().toISOString();
        await db.upsert("incidents", ticketId, JSON.stringify(inc));
        await db.audit("incidents", ticketId, "chat-assist:insert",
          JSON.stringify({ source: source || null, len: text.length }), actor);
        return json(res, 200, { ok: true, entry });
      } catch (err) {
        console.error("[ChatAssist] insert POST", err.message);
        return json(res, 500, { error: "Internal server error" });
      }
    }

    // ─── GET /api/chat-assist/sessions/:id ────────────────────────────
    const sessionMatch = pathname.match(/^\/api\/chat-assist\/sessions\/([^/]+)$/);
    if (sessionMatch && req.method === "GET") {
      try {
        const session = await loadSession(db, decodeURIComponent(sessionMatch[1]));
        if (!session) return json(res, 404, { error: "session not found" });
        return json(res, 200, { session });
      } catch (err) {
        console.error("[ChatAssist] session GET", err.message);
        return json(res, 500, { error: "Internal server error" });
      }
    }

    // ─── GET /api/chat-assist/sessions ────────────────────────────────
    if (pathname === "/api/chat-assist/sessions" && req.method === "GET") {
      try {
        const rows = await db.getAll(SESSION_COLLECTION);
        const sessions = rows
          .map(r => { try { return JSON.parse(r.data); } catch { return null; } })
          .filter(Boolean)
          .map(s => ({
            id: s.id, channel: s.channel, ticketId: s.ticketId, status: s.status,
            createdBy: s.createdBy, createdAt: s.createdAt, updatedAt: s.updatedAt,
            messageCount: (s.messages || []).length,
          }))
          .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
        return json(res, 200, { sessions, total: sessions.length });
      } catch (err) {
        console.error("[ChatAssist] sessions GET", err.message);
        return json(res, 500, { error: "Internal server error" });
      }
    }

    // ─── POST /api/chat-assist/feedback ───────────────────────────────
    if (pathname === "/api/chat-assist/feedback" && req.method === "POST") {
      try {
        const body = await parseBody(req);
        const { sessionId, messageId, rating, comment } = body || {};
        if (!sessionId || !messageId || (rating !== "up" && rating !== "down")) {
          return json(res, 400, { error: "sessionId, messageId, and rating ('up'|'down') are required" });
        }
        const session = await loadSession(db, sessionId);
        if (!session) return json(res, 404, { error: "session not found" });
        const msg = (session.messages || []).find(m => m.id === messageId);
        if (!msg) return json(res, 404, { error: "message not found" });

        const actor = actorOf(authResult);
        const fbId = `cafb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const record = {
          id: fbId,
          source: "chat_assist",
          sessionId,
          messageId,
          channel: session.channel,
          ticketId: session.ticketId || null,
          rating,
          comment: typeof comment === "string" ? comment.slice(0, 1000) : null,
          confidence: typeof msg.confidence === "number" ? msg.confidence : null,
          createdBy: actor,
          createdAt: new Date().toISOString(),
        };
        await db.upsert("ai_learning_feedback", fbId, JSON.stringify(record));
        // Annotate the message in-session for quick UX recall.
        msg.feedback = { rating, by: actor, at: record.createdAt };
        await saveSession(db, session);
        await db.audit("ai_learning_feedback", fbId, "create",
          JSON.stringify({ sessionId, messageId, rating }), actor);
        return json(res, 200, { ok: true, feedbackId: fbId });
      } catch (err) {
        console.error("[ChatAssist] feedback POST", err.message);
        return json(res, 500, { error: "Internal server error" });
      }
    }

    // ─── POST /api/chat-assist/intake-action ──────────────────────
    // VGC AI Assist guided-flow card click. Pure state machine — no AI call.
    if (pathname === "/api/chat-assist/intake-action" && req.method === "POST") {
      const flag = getFlagPayload();
      if (!flag) return json(res, 503, { error: "chat_assist disabled" });
      try {
        const body = await parseBody(req);
        const { sessionId, kind, value } = body || {};
        if (!sessionId || !kind) return json(res, 400, { error: "sessionId and kind required" });
        const session = await loadSession(db, sessionId);
        if (!session) return json(res, 404, { error: "session not found" });
        if (session.channel !== "customer") {
          return json(res, 400, { error: "intake-action is customer-channel only" });
        }
        const reply = advanceIntake(
          session,
          { kind, value },
          session.customerName || actorOf(authResult)
        );
        const stageBefore = session.intake?.stage; // already mutated by advanceIntake — capture from card kind
        if (!reply) {
          // Some kinds (e.g. confirm-intake/confirm) intentionally return no
          // assistant message — the frontend will follow up with /create-ticket.
          await saveSession(db, session);
          return json(res, 200, { sessionId: session.id, message: null, intakeStage: session.intake?.stage });
        }
        session.messages = session.messages || [];
        session.messages.push(reply);
        recordFunnelEvent(db, session, kind, stageBefore, { value });
        await saveSession(db, session);
        return json(res, 200, { sessionId: session.id, message: reply, intakeStage: session.intake?.stage });
      } catch (err) {
        console.error("[ChatAssist] intake-action POST", err.message);
        return json(res, 500, { error: "Internal server error" });
      }
    }

    // ─── POST /api/chat-assist/create-ticket ───────────────────────
    // Finalize intake and write a real INC- row to incidents collection.
    if (pathname === "/api/chat-assist/create-ticket" && req.method === "POST") {
      const flag = getFlagPayload();
      if (!flag) return json(res, 503, { error: "chat_assist disabled" });
      try {
        const body = await parseBody(req);
        const { sessionId } = body || {};
        if (!sessionId) return json(res, 400, { error: "sessionId required" });
        const session = await loadSession(db, sessionId);
        if (!session) return json(res, 404, { error: "session not found" });
        if (session.channel !== "customer" || !session.intake) {
          return json(res, 400, { error: "create-ticket is customer-channel only" });
        }
        if (session.intake.ticketId) {
          // Idempotent: already created.
          return json(res, 200, { sessionId: session.id, ticketId: session.intake.ticketId, alreadyCreated: true });
        }
        const intake = session.intake;
        const fields = intake.fields || {};
        if (!intake.category || !fields.title) {
          return json(res, 400, { error: "intake incomplete — category and title required" });
        }
        const ticketId = newTicketId();
        const severity = assessSeverity(intake);
        const sevBadge = mapPriorityToSev(fields.priority);
        const actor = actorOf(authResult);
        const requester = session.customerEmail || session.customerName || actor || "anonymous";
        const now = new Date().toISOString();

        const incident = {
          id: ticketId,
          title: fields.title,
          description: [
            fields.description || "",
            fields.errorMsg ? `\n\nError observed: ${fields.errorMsg}` : "",
            fields.devices ? `\nAffected device(s): ${fields.devices}` : "",
            fields.startedAt ? `\nStarted: ${fields.startedAt}` : "",
            fields.triedSteps ? `\nAlready tried: ${fields.triedSteps}` : "",
          ].join("").trim(),
          category: intake.category,
          priority: fields.priority || "Normal – within 2 days",
          impact: fields.impact || null,
          severity: severity,                  // P1..P4
          severityBadge: sevBadge,             // Sev-A..Sev-D
          status: "New",
          requester,
          requesterName: session.customerName || null,
          requesterCompany: session.customerCompany || null,
          requesterEmail: session.customerEmail || null,
          source: "chat_assist",
          aiTriaged: true,
          chatSessionId: session.id,
          slaTarget: SLA_BY_SEVERITY[severity] || SLA_BY_SEVERITY.P3,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          activityLog: [{
            id: `AL_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: "create",
            user: "VGC AI Assist",
            time: now,
            detail: `Ticket created via VGC AI Assist guided intake (severity ${severity}).`,
          }],
        };
        await db.upsert("incidents", ticketId, JSON.stringify(incident));
        await db.audit("incidents", ticketId, "create",
          JSON.stringify({ source: "chat_assist", severity, sessionId: session.id }), actor);

        // Update session
        intake.ticketId = ticketId;
        intake.severity = severity;
        intake.stage = "solution";
        session.ticketId = ticketId;
        const ticketCard = {
          type: "incident-ticket",
          ticket: {
            id: ticketId,
            title: incident.title,
            severity,
            sla: incident.slaTarget,
            status: incident.status,
          },
        };
        const followup = buildAssistantMessage({
          text: t("ticketCreated", intake.lang || "en", ticketId, severity, incident.slaTarget),
          cards: [ticketCard],
        });
        session.messages = session.messages || [];
        session.messages.push(followup);
        recordFunnelEvent(db, session, "confirm", "solution", { ticketId, severity });
        await saveSession(db, session);

        // Broadcast to ticket-list listeners (engineer dashboards).
        try {
          if (wsServer && typeof wsServer.broadcast === "function") {
            wsServer.broadcast({ type: "chat_assist_ticket_created", ticketId, severity, sessionId: session.id });
          }
        } catch { /* non-fatal */ }

        return json(res, 201, { sessionId: session.id, ticketId, severity, message: followup });
      } catch (err) {
        console.error("[ChatAssist] create-ticket POST", err.message);
        return json(res, 500, { error: "Internal server error" });
      }
    }

    // ─── POST /api/chat-assist/csat ───────────────────────────────
    // Customer satisfaction rating after resolution. On rating>=4 with the
    // resolving turn marked aiOk=true, also seed ai_knowledge with reviewStatus=pending
    // (per VGC AI Assist spec §6 "Continuous learning loop").
    if (pathname === "/api/chat-assist/csat" && req.method === "POST") {
      const flag = getFlagPayload();
      if (!flag) return json(res, 503, { error: "chat_assist disabled" });
      try {
        const body = await parseBody(req);
        const { sessionId, rating, comment } = body || {};
        const r = Number(rating);
        if (!sessionId || !Number.isFinite(r) || r < 1 || r > 5) {
          return json(res, 400, { error: "sessionId and rating (1-5) required" });
        }
        const session = await loadSession(db, sessionId);
        if (!session) return json(res, 404, { error: "session not found" });

        const actor = actorOf(authResult);
        const fbId = `csat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const csatRecord = {
          id: fbId,
          source: "chat_assist_csat",
          sessionId,
          ticketId: session.ticketId || session.intake?.ticketId || null,
          rating: r,
          comment: typeof comment === "string" ? comment.slice(0, 2000) : null,
          createdBy: actor,
          createdAt: new Date().toISOString(),
        };
        await db.upsert("ai_learning_feedback", fbId, JSON.stringify(csatRecord));

        if (session.intake) {
          session.intake.csat = r;
          session.intake.stage = "closed";
        }

        // Auto-seed ai_knowledge when the customer rates highly AND the
        // resolving assistant turn was actually AI-generated.
        let kbSeeded = null;
        const lastAiOk = [...(session.messages || [])].reverse().find(m => m.role === "assistant" && m.aiOk);
        if (r >= 4 && lastAiOk) {
          const kbId = `aik_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const kbDoc = {
            id: kbId,
            title: session.intake?.fields?.title || "VGC AI Assist resolved issue",
            content: lastAiOk.text,
            category: session.intake?.category || "General",
            tags: ["ai-generated", "chat-assist", `csat-${r}`],
            sourceTicketId: session.ticketId || null,
            sourceSessionId: sessionId,
            reviewStatus: "pending",
            createdBy: "VGC AI Assist",
            createdAt: new Date().toISOString(),
          };
          try {
            await db.upsert("ai_knowledge", kbId, JSON.stringify(kbDoc));
            await db.audit("ai_knowledge", kbId, "create",
              JSON.stringify({ source: "csat_autoseed", sessionId, rating: r }), actor);
            kbSeeded = kbId;
          } catch (e) {
            console.warn("[ChatAssist] csat kb autoseed failed:", e.message);
          }
        }

        const thanksMsg = buildAssistantMessage({
          text: r >= 4
            ? t("csatThanksHigh", session.intake?.lang || "en")
            : t("csatThanksLow", session.intake?.lang || "en"),
        });
        session.messages = session.messages || [];
        session.messages.push(thanksMsg);
        recordFunnelEvent(db, session, "csat", "closed", { rating: r, kbSeeded });
        await saveSession(db, session);
        await db.audit("ai_learning_feedback", fbId, "create",
          JSON.stringify({ sessionId, rating: r, kbSeeded }), actor);

        return json(res, 200, { ok: true, feedbackId: fbId, kbSeeded, message: thanksMsg });
      } catch (err) {
        console.error("[ChatAssist] csat POST", err.message);
        return json(res, 500, { error: "Internal server error" });
      }
    }

    // ─── POST /api/chat-assist/book-slot ───────────────────────────
    // Customer picks a remote-session slot (or 'other'). Persists onto the
    // incident's activityLog, sets scheduledRemoteSession, broadcasts WS event.
    if (pathname === "/api/chat-assist/book-slot" && req.method === "POST") {
      const flag = getFlagPayload();
      if (!flag) return json(res, 503, { error: "chat_assist disabled" });
      try {
        const body = await parseBody(req);
        const { sessionId, slotIso, note } = body || {};
        if (!sessionId || !slotIso) return json(res, 400, { error: "sessionId and slotIso required" });
        const session = await loadSession(db, sessionId);
        if (!session) return json(res, 404, { error: "session not found" });
        const ticketId = session.ticketId || session.intake?.ticketId;
        if (!ticketId) return json(res, 400, { error: "no ticket linked to this session" });

        const incRow = await db.getOne("incidents", ticketId);
        if (!incRow) return json(res, 404, { error: "incident not found" });
        let inc;
        try { inc = typeof incRow.data === "string" ? JSON.parse(incRow.data) : incRow.data; }
        catch { return json(res, 500, { error: "incident parse failure" }); }

        const actor = actorOf(authResult);
        const isOther = slotIso === "other";
        const slotLabel = isOther
          ? `Other (customer note: ${note || "none"})`
          : new Date(slotIso).toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: true });
        const entry = {
          id: `AL_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: "slot-booked",
          user: session.customerEmail || session.customerName || actor || "customer",
          time: new Date().toISOString(),
          detail: `Customer picked remote-session slot: ${slotLabel}`,
        };
        inc.activityLog = Array.isArray(inc.activityLog) ? inc.activityLog : [];
        inc.activityLog.push(entry);
        inc.scheduledRemoteSession = isOther
          ? { other: true, customerNote: note || null, requestedAt: new Date().toISOString() }
          : { slotIso, requestedAt: new Date().toISOString() };
        inc.updatedAt = new Date().toISOString();
        await db.upsert("incidents", ticketId, JSON.stringify(inc));
        await db.audit("incidents", ticketId, "chat-assist:slot-booked",
          JSON.stringify({ slotIso: isOther ? null : slotIso, other: isOther }), actor);

        const confirmMsg = buildAssistantMessage({
          text: isOther
            ? `Thank you. I've notified our engineering team that you'd like to pick a different slot. They will reach out shortly to confirm.`
            : `Thank you. I've booked the slot (${slotLabel}) and notified our engineer. They will join you at that time.`,
        });
        session.messages = session.messages || [];
        session.messages.push(confirmMsg);
        await saveSession(db, session);

        try {
          if (wsServer && typeof wsServer.broadcast === "function") {
            wsServer.broadcast({
              type: "chat_assist_slot_booked",
              sessionId, ticketId,
              slotIso: isOther ? null : slotIso,
              other: isOther,
            });
          }
        } catch { /* non-fatal */ }

        return json(res, 200, { ok: true, ticketId, message: confirmMsg });
      } catch (err) {
        console.error("[ChatAssist] book-slot POST", err.message);
        return json(res, 500, { error: "Internal server error" });
      }
    }

    // ─── POST /api/chat-assist/promote-to-kb ──────────────────────
    // Agent-initiated promotion of any assistant or agent message into the
    // ai_knowledge review queue (reviewStatus="pending"). Closes the loop
    // for non-AI / manually-written resolutions per request #3.
    if (pathname === "/api/chat-assist/promote-to-kb" && req.method === "POST") {
      if (!authResult?.authenticated) return json(res, 401, { error: "auth required" });
      try {
        const body = await parseBody(req);
        const { sessionId, messageId, title, content, category, tags } = body || {};
        if (!sessionId) return json(res, 400, { error: "sessionId required" });
        const session = await loadSession(db, sessionId);
        if (!session) return json(res, 404, { error: "session not found" });

        let promoteText = typeof content === "string" ? content : "";
        let sourceMsgId = null;
        if (messageId) {
          const msg = (session.messages || []).find(m => m.id === messageId);
          if (!msg) return json(res, 404, { error: "message not found" });
          if (!promoteText) promoteText = msg.text || "";
          sourceMsgId = msg.id;
        }
        if (!promoteText.trim()) return json(res, 400, { error: "content or referenced messageId text required" });

        const actor = actorOf(authResult);
        const kbId = `aik_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const kbDoc = {
          id: kbId,
          title: (typeof title === "string" && title.trim()) ? title.trim().slice(0, 200) : "Agent-promoted resolution",
          content: promoteText.slice(0, 8000),
          category: (typeof category === "string" && category.trim()) ? category.trim() : "General",
          tags: Array.isArray(tags) ? tags.filter(Boolean).map(String).slice(0, 12) : ["agent-promoted", "chat-assist"],
          sourceTicketId: session.ticketId || session.intake?.ticketId || null,
          sourceSessionId: sessionId,
          sourceMessageId: sourceMsgId,
          reviewStatus: "pending",
          createdBy: actor,
          createdAt: new Date().toISOString(),
        };
        await db.upsert("ai_knowledge", kbId, JSON.stringify(kbDoc));
        await db.audit("ai_knowledge", kbId, "create",
          JSON.stringify({ source: "agent_promote", sessionId, messageId: sourceMsgId }), actor);
        return json(res, 201, { ok: true, kbId, entry: kbDoc });
      } catch (err) {
        console.error("[ChatAssist] promote-to-kb POST", err.message);
        return json(res, 500, { error: "Internal server error" });
      }
    }

    // ─── GET /api/chat-assist/analytics/funnel ─────────────────────
    // Returns aggregated stage transitions for the customer-channel guided flow.
    // Optional ?since=ISO filter; default last 30 days.
    if (pathname === "/api/chat-assist/analytics/funnel" && req.method === "GET") {
      try {
        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        const sinceParam = url.searchParams.get("since");
        const since = sinceParam
          ? new Date(sinceParam).getTime()
          : Date.now() - 30 * 24 * 60 * 60 * 1000;
        const rows = await db.getAll(FUNNEL_COLLECTION);
        const events = rows
          .map(r => { try { return JSON.parse(r.data); } catch { return null; } })
          .filter(e => e && new Date(e.at).getTime() >= since);
        // Funnel: count distinct sessions reaching each stage.
        const STAGE_ORDER = ["greeting", "category", "field:title", "confirm", "solution", "csat", "closed"];
        const seen = {};
        for (const stage of STAGE_ORDER) seen[stage] = new Set();
        const transitions = {}; // "from→to" -> count
        const langCounts = {};
        const sessionLangs = new Map();
        for (const e of events) {
          if (e.toStage && seen[e.toStage]) seen[e.toStage].add(e.sessionId);
          const key = `${e.fromStage}→${e.toStage}`;
          transitions[key] = (transitions[key] || 0) + 1;
          if (e.lang && !sessionLangs.has(e.sessionId)) {
            sessionLangs.set(e.sessionId, e.lang);
            langCounts[e.lang] = (langCounts[e.lang] || 0) + 1;
          }
        }
        const funnel = STAGE_ORDER.map(stage => ({ stage, sessions: seen[stage].size }));
        return json(res, 200, {
          since: new Date(since).toISOString(),
          totalEvents: events.length,
          totalSessions: new Set(events.map(e => e.sessionId)).size,
          funnel,
          transitions,
          languageBreakdown: langCounts,
        });
      } catch (err) {
        console.error("[ChatAssist] funnel GET", err.message);
        return json(res, 500, { error: "Internal server error" });
      }
    }

    return false;
  };
};

// Exported for unit tests
module.exports.__internal = {
  rankKbArticles,
  gatherKbGrounding,
  buildSystemPrompt,
  buildUserPrompt,
  estimateConfidence,
  // VGC AI Assist guided flow
  defaultIntake,
  advanceIntake,
  assessSeverity,
  mapPriorityToSev,
  newTicketId,
  findFieldIndex,
  nextFieldStage,
  INTAKE_FIELDS,
  CATEGORY_OPTIONS,
  IMPACT_OPTIONS,
  PRIORITY_OPTIONS,
  SLA_BY_SEVERITY,
  VGC_CUSTOMER_PERSONA,
  // i18n
  detectLang,
  SUPPORTED_LANGS,
  LANG_NAMES,
  I18N,
  t,
  // Analytics
  recordFunnelEvent,
  FUNNEL_COLLECTION,
};
