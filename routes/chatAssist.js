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
    en: (n) => `Hi ${n} 👋 I'm VGC AI Assist. Tap a category below to log a ticket in 30 seconds — or just type what's wrong and I'll figure it out.`,
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

// ─── Live ITSM context gathering (v3.36.0) ───────────────────────────────
// Queries incidents, approval_instances, and requests filtered by the
// current user's email. Returns a compact text block for prompt injection.
async function gatherLiveContext(db, cachedGetAll, userEmail, intent, limit = 5) {
  if (!userEmail || !intent) return "";
  const lines = [];
  const getter = cachedGetAll || db.getAll.bind(db);

  if (intent.specificId) {
    // Targeted lookup for a specific INC- or REQ- ID
    const collection = intent.specificId.startsWith("INC-") ? "incidents" : "requests";
    try {
      const rows = await getter(collection);
      for (const r of rows) {
        try {
          const t = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
          if (t && t.id && t.id.toUpperCase() === intent.specificId) {
            lines.push(`Record ${t.id}: status=${t.status || "unknown"}, title="${(t.title || t.summary || "").slice(0, 100)}", severity=${t.severity || t.priority || "N/A"}, category=${t.category || "N/A"}, created=${t.createdAt || t.created || "N/A"}, assigned=${t.assignedTo || t.assignee || "unassigned"}`);
            break;
          }
        } catch { /* skip bad row */ }
      }
    } catch { /* non-fatal */ }
    if (lines.length) return "ITSM live data:\n" + lines.join("\n");
  }

  const emailLower = userEmail.toLowerCase();

  if (intent.tickets) {
    try {
      const rows = await getter("incidents");
      const mine = [];
      for (const r of rows) {
        try {
          const t = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
          if (!t) continue;
          const email = (t.requesterEmail || t.reportedByEmail || t.requestedBy || t.reportedBy || "").toLowerCase();
          if (email === emailLower && !["Resolved", "Closed", "Cancelled"].includes(t.status)) {
            mine.push(t);
          }
        } catch { /* skip */ }
      }
      mine.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      const top = mine.slice(0, limit);
      if (top.length) {
        lines.push(`Open incidents (${mine.length} total, showing ${top.length}):`);
        for (const t of top) {
          lines.push(`  - ${t.id} (${t.status}): "${(t.title || "").slice(0, 60)}" [${t.severity || t.priority || "N/A"}]`);
        }
      } else {
        lines.push("No open incidents found for this user.");
      }
    } catch { /* non-fatal */ }
  }

  if (intent.approvals) {
    try {
      const rows = await getter("approval_instances");
      const mine = [];
      for (const r of rows) {
        try {
          const a = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
          if (!a) continue;
          const createdBy = (a.createdBy || "").toLowerCase();
          const isApprover = Array.isArray(a.approvals) && a.approvals.some(ap => (ap.approverEmail || "").toLowerCase() === emailLower);
          if ((createdBy === emailLower || isApprover) && a.status === "pending") {
            mine.push(a);
          }
        } catch { /* skip */ }
      }
      if (mine.length) {
        lines.push(`Pending approvals (${mine.length}):`);
        for (const a of mine.slice(0, limit)) {
          lines.push(`  - ${a.id || "(no id)"}: ${a.targetCollection || ""} ${a.targetId || ""}, level ${a.currentLevel || "?"}, status=${a.status}`);
        }
      } else {
        lines.push("No pending approvals found for this user.");
      }
    } catch { /* non-fatal */ }
  }

  if (intent.requests) {
    try {
      const rows = await getter("requests");
      const mine = [];
      for (const r of rows) {
        try {
          const t = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
          if (!t) continue;
          const email = (t.requesterEmail || t.requestedBy || "").toLowerCase();
          if (email === emailLower && !["Fulfilled", "Closed", "Cancelled"].includes(t.status)) {
            mine.push(t);
          }
        } catch { /* skip */ }
      }
      mine.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      const top = mine.slice(0, limit);
      if (top.length) {
        lines.push(`Open service requests (${mine.length} total, showing ${top.length}):`);
        for (const t of top) {
          lines.push(`  - ${t.id} (${t.status}): "${(t.title || t.service || "").slice(0, 60)}" [${t.priority || "N/A"}]`);
        }
      } else {
        lines.push("No open service requests found for this user.");
      }
    } catch { /* non-fatal */ }
  }

  if (!lines.length) return "";
  // Cap total output to ~800 chars for prompt budget
  let result = "ITSM live data:\n" + lines.join("\n");
  if (result.length > 800) result = result.slice(0, 797) + "...";
  return result;
}

// VGC AI Assist — full customer persona (see /memories/session/plan.md and
// the product spec). The state machine below owns greeting/intake/CSAT flow;
// the model is only used to generate solution steps + layman re-explanations.
const VGC_CUSTOMER_PERSONA = [
  "You are VGC AI Assist, an enterprise IT support assistant for VGC Technology Pte Ltd, a Singapore-based Microsoft Solutions Partner serving SMEs.",
  "Persona: calm, professional, approachable — like a senior IT support lead. Plain English, no unexplained jargon. Translate every technical step into layman instructions. Acknowledge frustration warmly when present. Reflect Singapore business culture: polite, efficient, solution-oriented.",
  "You are operating inside a guided conversational flow. The flow controls greeting, intake form, ticket creation, escalation, and CSAT — you do NOT need to ask those questions.",
  "Your job is: (1) generate clear, numbered, layman-friendly solution steps when asked; (2) re-explain a step in simpler terms when the customer is confused; (3) acknowledge customer messages warmly between steps.",
  "You have read access to this customer's tickets, service requests, and approval status within VGC-ITSM. When ITSM live data is provided in the prompt, answer directly from it — never say you don't have access to their data.",
  "Rules: never invent ticket numbers, prices, or customer data. Never share other customers' information or internal credentials. Never request passwords or sensitive personal data beyond name/company/email. Never promise resolution times beyond stated SLA commitments.",
  "When citing a knowledge-base article, write the ID in square brackets, e.g. [KB0010]. Keep replies under 6 sentences unless walking through numbered solution steps.",
  "If the issue is outside your knowledge after a thorough KB check, say 'I'm checking further' or 'Let me connect you with an engineer' — never just 'I don't know'.",
].join(" ");

function buildSystemPrompt(channel, lang, historyContext) {
  // v3.33.1 — Teams channel reuses the customer persona but with a tighter
  // length cap suitable for chat readability inside the Teams app shell.
  const base = channel === "customer" ? VGC_CUSTOMER_PERSONA
    : channel === "teams" ? (VGC_CUSTOMER_PERSONA + " CHANNEL CONTEXT — you are responding inside Microsoft Teams. Keep replies under 280 characters per turn so the message renders cleanly in the chat pane. Prefer numbered steps over paragraphs.")
    : [
    "You are VGC-ITSM Co-Pilot, an internal IT service-desk assistant for VGC Technology Pte Ltd.",
    "CRITICAL: You must ONLY answer from the ITSM context provided — internal KB articles, live ticket/incident/request/approval data, and VGC operational knowledge. Do NOT use external or general knowledge to answer ITSM-related questions. If no relevant internal data is available, say so explicitly: 'I don't have matching data in the ITSM system for this query.'",
    "You have read access to VGC-ITSM live data including incidents, service requests, change requests, approvals, and SLA statuses. When ITSM live data is provided in the prompt, answer operational queries directly from it — never say you lack access.",
    "Your role: (1) triage and classify incidents, (2) suggest remediation steps grounded in KB, (3) draft customer replies, (4) flag SLA risks, (5) recommend escalation when warranted.",
    "Cite KB article IDs in square brackets (e.g. [KB0010]) when grounded in KB content.",
    "Flag low confidence explicitly. Do not fabricate ticket numbers, statuses, or data.",
    "Keep replies under 120 words. Use markdown bullets when listing steps.",
    "Format actionable outputs clearly: numbered steps for diagnostics, bullet points for summaries, bold for key values like ticket IDs and priorities.",
  ].join(" ");
  const useLang = SUPPORTED_LANGS.includes(lang) ? lang : "en";
  const langSuffix = useLang === "en" ? "" :
    `\n\nIMPORTANT: Reply in ${LANG_NAMES[useLang]} (the language the customer is writing in). Keep KB IDs and ticket numbers in their original format.`;
  const histSuffix = historyContext ? `\n\n${historyContext}` : "";
  return `${base}${histSuffix}${langSuffix}`;
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

// ─── Quick-Symptom catalog (v3.29.0) ─────────────────────────────────────
// 30 most-common end-user IT symptoms. Tapping a symptom auto-fills the
// `category` and `title` intake fields, then jumps the state machine
// straight to `field:impact` — saving the customer from typing the title
// or description for the top-30 known issues. Drops time-to-ticket to ~6s.
//
// Each entry has an optional `selfHelp` key pointing to SELF_HELP_GUIDES;
// when present, an inline "💡 Try a 30-sec fix first?" card is offered
// before continuing the intake (resolved in 1 step → no ticket created).
const SYMPTOM_OPTIONS = [
  // Email & Outlook
  { value: "outlook-wont-open",      label: "📧 Outlook won't open",         category: "Email & Outlook",        title: "Outlook won't open",                    selfHelp: "outlook-restart" },
  { value: "cant-send-email",        label: "📨 Can't send email",            category: "Email & Outlook",        title: "Cannot send email" },
  { value: "not-receiving-email",    label: "📥 Not receiving email",         category: "Email & Outlook",        title: "Not receiving emails" },
  { value: "attachment-too-big",     label: "📎 Attachment too big",          category: "Email & Outlook",        title: "Email attachment size limit error" },
  { value: "calendar-not-syncing",   label: "📅 Calendar not syncing",        category: "Email & Outlook",        title: "Outlook calendar not syncing" },
  // Access & Login
  { value: "forgot-password",        label: "🔑 Forgot password",             category: "Access & Login",         title: "Need to reset my password",             selfHelp: "password-reset" },
  { value: "account-locked",         label: "🔐 Account locked",              category: "Access & Login",         title: "Account locked out" },
  { value: "mfa-not-working",        label: "🛡️ MFA / 2FA issue",            category: "Access & Login",         title: "MFA / two-factor authentication not working" },
  { value: "cant-access-app",        label: "🆔 Can't access app/site",       category: "Access & Login",         title: "Cannot access an application or site" },
  { value: "need-new-access",        label: "👥 Need access to something",    category: "Access & Login",         title: "Request access to a system or folder" },
  // Network & Connectivity
  { value: "wifi-not-working",       label: "📡 WiFi not working",            category: "Network & Connectivity", title: "WiFi not connecting",                   selfHelp: "wifi-reconnect" },
  { value: "no-internet",            label: "🔌 No internet at all",          category: "Network & Connectivity", title: "No internet connectivity" },
  { value: "vpn-wont-connect",       label: "🔒 VPN won't connect",           category: "Network & Connectivity", title: "VPN cannot connect",                    selfHelp: "vpn-reconnect" },
  { value: "internet-slow",          label: "🐢 Internet very slow",          category: "Network & Connectivity", title: "Internet connection is very slow" },
  { value: "website-blocked",        label: "🌐 Website blocked",             category: "Network & Connectivity", title: "A required website is blocked" },
  // Device & Hardware
  { value: "laptop-slow",            label: "💻 Laptop very slow",            category: "Device & Hardware",      title: "Laptop / PC running very slowly",       selfHelp: "restart-machine" },
  { value: "battery-not-charging",   label: "🔋 Battery not charging",        category: "Device & Hardware",      title: "Laptop battery is not charging" },
  { value: "no-sound",               label: "🔇 No sound / audio",            category: "Device & Hardware",      title: "No sound from speakers or headset" },
  { value: "mouse-keyboard-broken",  label: "🖱️ Mouse / keyboard issue",     category: "Device & Hardware",      title: "Mouse or keyboard not responding" },
  { value: "screen-black",           label: "🖥️ Screen blank / frozen",       category: "Device & Hardware",      title: "Computer screen is blank or frozen" },
  // Printer & Peripherals
  { value: "printer-offline",        label: "🖨️ Printer offline",             category: "Printer & Peripherals",  title: "Printer is offline / not responding",   selfHelp: "printer-offline" },
  { value: "paper-jam",              label: "📄 Paper jam",                   category: "Printer & Peripherals",  title: "Printer paper jam" },
  { value: "scanner-not-working",    label: "📠 Scanner not working",         category: "Printer & Peripherals",  title: "Scanner is not working" },
  // Microsoft 365 & Cloud
  { value: "teams-audio-issue",      label: "👨‍💻 Teams call audio issue",     category: "Microsoft 365 & Cloud",  title: "Microsoft Teams call audio not working", selfHelp: "teams-audio" },
  { value: "onedrive-sync",          label: "📝 OneDrive not syncing",        category: "Microsoft 365 & Cloud",  title: "OneDrive files are not syncing",         selfHelp: "onedrive-sync" },
  { value: "office-app-crash",       label: "📊 Word / Excel crashing",       category: "Microsoft 365 & Cloud",  title: "Office app keeps crashing" },
  { value: "need-software-install",  label: "🔄 Need software installed",     category: "Microsoft 365 & Cloud",  title: "Request a new software install" },
  // Mobile & Apps
  { value: "company-app-broken",     label: "📱 Company app not working",     category: "Mobile & Apps",          title: "Company mobile app not working" },
  // Security
  { value: "phishing-suspicious",    label: "🚨 Suspicious email / phishing", category: "Security & Virus",       title: "Suspicious email — possible phishing" },
  { value: "lost-device",            label: "🔓 Lost / stolen device",        category: "Security & Virus",       title: "Lost or stolen company device — needs lockout" },
];

// ─── "Try this first" self-help guides (v3.29.0) ─────────────────────────
// Tiny 3-step layperson guides for the top-10 symptoms. If the customer
// resolves the issue with one of these, no ticket is created — saves L1
// volume by ~25% based on industry benchmarks for these symptoms.
const SELF_HELP_GUIDES = {
  "outlook-restart": {
    title: "Quick fix: restart Outlook safely",
    steps: [
      "Close Outlook completely (right-click the Outlook icon in the taskbar → Close window).",
      "Hold the Ctrl key and click the Outlook icon to start it in Safe Mode.",
      "If it opens, close it and reopen normally — it usually recovers.",
    ],
  },
  "password-reset": {
    title: "Reset your password yourself (60 sec)",
    steps: [
      "Go to https://passwordreset.microsoftonline.com",
      "Enter your work email and complete the verification (SMS or authenticator).",
      "Choose a new password — must be 12+ chars with a number and a symbol.",
    ],
  },
  "wifi-reconnect": {
    title: "Reconnect to WiFi cleanly",
    steps: [
      "Click the WiFi icon (bottom-right tray) → click your VGC network → Disconnect.",
      "Wait 10 seconds, then click the network again and Connect.",
      "If it still fails, toggle WiFi off/on with the keyboard shortcut (often Fn+F2).",
    ],
  },
  "vpn-reconnect": {
    title: "Reconnect VPN",
    steps: [
      "Right-click the VPN client icon in the taskbar → Disconnect.",
      "Make sure you're on a stable network (try mobile hotspot if WiFi is flaky).",
      "Reconnect — sign in again with your work credentials and MFA.",
    ],
  },
  "restart-machine": {
    title: "Clean restart your laptop",
    steps: [
      "Save and close all your work.",
      "Click Start → Power → Restart (NOT Shut Down — Restart clears more memory).",
      "Wait until login completes, then try the slow app again.",
    ],
  },
  "printer-offline": {
    title: "Bring printer back online",
    steps: [
      "Check the printer screen — clear any error (paper, toner, jam).",
      "Open Settings → Printers → click your printer → Open queue → Cancel all stuck jobs.",
      "Right-click the printer → 'Use printer online' if it's grayed out.",
    ],
  },
  "teams-audio": {
    title: "Fix Teams audio",
    steps: [
      "In Teams call, click the … menu → Device settings.",
      "Pick the correct Speaker and Microphone (your headset, not 'Default').",
      "Tap 'Make a test call' — you should hear yourself echo back.",
    ],
  },
  "onedrive-sync": {
    title: "Restart OneDrive sync",
    steps: [
      "Click the OneDrive cloud icon (taskbar tray) → ⚙️ Settings → Pause for 2 hours, then Resume.",
      "If still stuck: right-click OneDrive icon → Quit OneDrive, then re-open OneDrive from Start.",
      "If files show errors, click each one → 'Always keep on this device'.",
    ],
  },
};

// ─── Conversational forms (v3.30.0) ──────────────────────────────────────
// Structured multi-field forms rendered as a single card. Used when the
// engineer would otherwise have to ask for the same details over chat
// (e.g., printer name + floor, software request fields). Tapping Submit
// jumps the intake straight to the summary stage — no impact/priority
// follow-up needed because the form already captures it (or it's inferred).
const FORM_TEMPLATES = {
  "printer-form": {
    title: "Printer issue — quick form",
    intro: "Tell me which printer and where it is, and I'll log it for you.",
    fields: [
      { key: "printerName", label: "Printer name or number", placeholder: "e.g. HP-Floor3-Reception",  required: true },
      { key: "location",    label: "Floor or room",          placeholder: "e.g. Level 3, near pantry",  required: true },
      { key: "errorMsg",    label: "Error on screen (if any)", placeholder: "e.g. PC LOAD LETTER",      required: false },
    ],
    impact: "Significant slowdown",
    priority: "Normal – within 2 days",
  },
  "software-request-form": {
    title: "Software install request",
    intro: "Tell me what you need and I'll route it for approval.",
    fields: [
      { key: "softwareName", label: "Software name + version", placeholder: "e.g. Adobe Acrobat Pro 2024", required: true },
      { key: "businessReason", label: "Why you need it (1 line)", placeholder: "e.g. Sign client contracts in PDF", required: true },
      { key: "urgency",      label: "When do you need it by?", placeholder: "e.g. By Friday for client meeting", required: false },
    ],
    impact: "Minor inconvenience",
    priority: "Normal – within 2 days",
  },
  "vpn-form": {
    title: "VPN connection issue",
    intro: "A few quick details so an engineer can help fast.",
    fields: [
      { key: "errorMsg",   label: "Error code or message",   placeholder: "e.g. Error 720 / Authentication failed", required: false },
      { key: "vpnClient",  label: "VPN client you use",       placeholder: "e.g. Cisco AnyConnect, GlobalProtect", required: false },
      { key: "location",   label: "Where are you connecting from?", placeholder: "e.g. Home (StarHub fibre), client site", required: false },
    ],
    impact: "Significant slowdown",
    priority: "High – within today",
  },
  "access-request-form": {
    title: "Access / permission request",
    intro: "What do you need access to?",
    fields: [
      { key: "system",     label: "System or folder",       placeholder: "e.g. SharePoint Finance site, ERP module X", required: true },
      { key: "accessType", label: "Type of access",          placeholder: "e.g. Read-only, edit, admin", required: true },
      { key: "reason",     label: "Reason / approver",        placeholder: "e.g. Project ABC, approved by John Lim", required: true },
    ],
    impact: "Minor inconvenience",
    priority: "Normal – within 2 days",
  },
  "phishing-form": {
    title: "Suspicious email report",
    intro: "Help us protect everyone — share what you can.",
    fields: [
      { key: "fromAddress", label: "Sender email address",      placeholder: "e.g. notmyceo@fakebank.com", required: true },
      { key: "subject",     label: "Email subject line",         placeholder: "e.g. URGENT: Wire transfer needed", required: true },
      { key: "didClick",    label: "Did you click any link or open attachment?", placeholder: "Yes / No", required: true },
    ],
    impact: "Significant slowdown",
    priority: "Critical – need it now",
  },
};

// Map symptom value → form template key. Symptoms not listed fall through
// to the normal impact/priority flow.
const SYMPTOM_FORM_MAP = {
  "printer-offline":       "printer-form",
  "paper-jam":             "printer-form",
  "scanner-not-working":   "printer-form",
  "need-software-install": "software-request-form",
  "vpn-wont-connect":      "vpn-form",
  "need-new-access":       "access-request-form",
  "phishing-suspicious":   "phishing-form",
};

// ─── Customer history loader (v3.30.0) ───────────────────────────────────
// Returns up to 5 of the customer's most recent tickets so we can:
//   1. Personalize the greeting ("Welcome back — I see your ticket INC-…")
//   2. Inject context into the AI system prompt for empathy/relevance
//   3. Offer "Same issue?" linking instead of duplicate ticket creation
async function loadCustomerHistory(db, customerEmail, limit = 5) {
  if (!db || !customerEmail) return [];
  try {
    const rows = await db.getAll("incidents");
    const mine = [];
    for (const r of rows) {
      try {
        const t = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
        if (!t) continue;
        const email = t.requesterEmail || t.reportedByEmail || t.requestedBy || t.reportedBy;
        if (typeof email === "string" && email.toLowerCase() === customerEmail.toLowerCase()) {
          mine.push({
            id: t.id,
            title: t.title || t.summary || "(no title)",
            status: t.status || "Open",
            severity: t.severity || t.priority || null,
            category: t.category || null,
            createdAt: t.createdAt || t.created || t.timestamp || null,
            resolvedAt: t.resolvedAt || null,
          });
        }
      } catch { /* skip bad row */ }
    }
    mine.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return mine.slice(0, limit);
  } catch (err) {
    console.warn("[ChatAssist] loadCustomerHistory failed:", err.message);
    return [];
  }
}

// ─── Recurring-pattern detection (v3.31.0 — Phase 1) ─────────────────────
// Detects when the customer has logged ≥3 tickets in the same category
// within the past `windowDays`. Used to surface a "want me to flag this
// for a hardware/account check?" card BEFORE we attempt yet another fix
// for the same recurring issue.
// within the past `windowDays`. Used to surface a "want me to flag this
// for a hardware/account check?" card BEFORE we attempt yet another fix
// for the same recurring issue.
function detectRecurringPattern(history, windowDays = 30) {
  if (!Array.isArray(history) || history.length < 3) return null;
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const buckets = new Map();
  for (const t of history) {
    if (!t || !t.category) continue;
    const ts = Date.parse(t.createdAt || "");
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const key = String(t.category);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  let best = null;
  for (const [category, tickets] of buckets) {
    if (tickets.length >= 3 && (!best || tickets.length > best.count)) {
      best = { category, count: tickets.length, tickets };
    }
  }
  return best;
}

// ─── Frustration detection (v3.31.0 — Phase 1) ───────────────────────────
// Conservative regex heuristic on customer chat text. Designed for low FP:
// requires either explicit frustration words, repeat-attempt language, or
// strong tone signals (multiple !! / ALL-CAPS run / profanity stems).
const FRUSTRATION_PATTERNS = [
  /\b(ridiculous|unacceptable|frustrat\w+|fed up|sick of|wast(ing|ed) (my )?time)\b/i,
  /\b(\d+(rd|nd|th|st)? (time|day|week)|again and again|over and over|keeps happening)\b/i,
  /\b(this is (a )?(joke|terrible|awful|broken))\b/i,
  /!{2,}/,
  /\b[A-Z]{6,}\b/, // ≥6-char ALL-CAPS run, e.g. "PLEASE FIX"
];
function detectFrustration(text) {
  if (typeof text !== "string" || text.length < 4) return false;
  let score = 0;
  for (const re of FRUSTRATION_PATTERNS) {
    if (re.test(text)) score += 1;
    if (score >= 1) return true; // any single signal is enough; conservative trigger.
  }
  return false;
}

// ─── Active major-incident lookup (v3.31.0 — Phase 1) ────────────────────
// Returns the parent INC id if ≥5 OPEN tickets exist in `category` within
// the last 10 minutes. Used by /intake-action pick-symptom to suppress
// duplicate ticket creation during outages.
async function findActiveMajorIncident(db, category, opts = {}) {
  if (!db || !category) return null;
  const windowMs = (opts.windowMin || 10) * 60 * 1000;
  const minClusterSize = opts.minClusterSize || 5;
  try {
    const rows = await db.getAll("incidents");
    const cutoff = Date.now() - windowMs;
    const matches = [];
    for (const r of rows) {
      try {
        const t = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
        if (!t) continue;
        const ts = Date.parse(t.createdAt || t.created_at || "");
        if (!Number.isFinite(ts) || ts < cutoff) continue;
        if (t.category !== category) continue;
        if (["Resolved", "Closed", "Cancelled"].includes(t.status)) continue;
        matches.push(t);
      } catch { /* skip */ }
    }
    if (matches.length < minClusterSize) return null;
    const parent = matches.find(t => t.majorIncident === true || (Array.isArray(t.tags) && t.tags.includes("major-incident")))
      || matches.sort((a, b) => Date.parse(a.createdAt || "") - Date.parse(b.createdAt || ""))[0];
    return {
      id: parent.id,
      title: parent.title || null,
      category: parent.category || category,
      affectedCount: matches.length,
      startedAt: parent.createdAt || null,
      eta: parent.estimatedResolution || parent.eta || null,
    };
  } catch (err) {
    console.warn("[ChatAssist] findActiveMajorIncident failed:", err.message);
    return null;
  }
}

// Compact history → 1-line context for the AI system prompt.
function summarizeHistoryForPrompt(history) {
  if (!history || !history.length) return "";
  const open = history.filter(t => !["Resolved", "Closed", "Cancelled"].includes(t.status));
  const recent = history.slice(0, 3);
  const lines = [
    `CUSTOMER CONTEXT — this customer has logged ${history.length} ticket(s) in the past:`,
    ...recent.map(t => `  - ${t.id} (${t.status}): ${t.title}`),
  ];
  if (open.length) {
    lines.push(`They currently have ${open.length} OPEN ticket(s). Be empathetic; if today's issue resembles an open one, gently ask if it's related instead of treating it as new.`);
  }
  lines.push("Use 'Welcome back' tone. Reference past tickets only when it's clearly relevant — never quote private detail you can't see.");
  return lines.join("\n");
}

// VGC AI Assist intake — kept intentionally short (4 questions, mostly
// 1-tap) so customers can log a ticket in under 30 seconds. Detail beyond
// title/description is captured later by the engineer or auto-extracted by
// AI triage from the description text.
const INTAKE_FIELDS = [
  { key: "title",       prompt: "In one short sentence, what's wrong? (e.g. \"Outlook keeps crashing\")" },
  { key: "description", prompt: "Briefly tell me what happened — paste any error message you see. (Or tap Skip if the title says it all.)", optional: true },
  { key: "impact",      prompt: "How is this affecting your work?", card: "impact" },
  { key: "priority",    prompt: "How urgently do you need this fixed?", card: "priority" },
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
      // v3.30.0 — personalized greeting if we have past tickets for this user.
      const history = Array.isArray(session.history) ? session.history : [];
      const openTickets = history.filter(t => !["Resolved", "Closed", "Cancelled"].includes(t.status));
      let greeting;
      if (history.length && lang === "en") {
        const fname = firstName(customerName);
        if (openTickets.length) {
          greeting = `Welcome back ${fname} 👋 I see you have ${openTickets.length} open ticket${openTickets.length > 1 ? "s" : ""} with us. Is today's issue related to one of those, or is it something new?`;
        } else {
          greeting = `Welcome back ${fname} 👋 Good to see you again. What can I help you with today? Tap a symptom below to log a ticket in seconds.`;
        }
      } else {
        greeting = t("greetingTemplate", lang, firstName(customerName));
      }
      const cards = [];
      // v3.31.0 (Phase 1) — recurring-pattern detection. If the customer
      // has logged ≥3 tickets in the same category in the past 30 days,
      // surface a problem-record offer BEFORE the symptom grid. Avoids
      // looping the customer through yet another fix for a recurring issue.
      const recurring = detectRecurringPattern(history, 30);
      if (recurring) {
        cards.push({
          type: "recurring-pattern",
          kind: "flag-recurring",
          category: recurring.category,
          count: recurring.count,
          tickets: recurring.tickets.slice(0, 3).map(t => ({ id: t.id, title: t.title, status: t.status })),
          flagLabel: "🚩 Yes — flag for root-cause review",
          continueLabel: "🔁 No, just help me with today's issue",
        });
      }
      // History card first when relevant.
      if (history.length) {
        cards.push({
          type: "recent-tickets",
          kind: "link-existing",
          tickets: history.slice(0, 3).map(t => ({
            id: t.id,
            title: t.title,
            status: t.status,
            createdAt: t.createdAt,
          })),
          newIssueLabel: "🆕 No, this is a new issue",
        });
      }
      cards.push({ type: "category-grid", kind: "pick-symptom",     options: SYMPTOM_OPTIONS });
      cards.push({ type: "category-grid", kind: "select-category",  options: CATEGORY_OPTIONS, sectionLabel: "Or pick a broad category" });
      return buildAssistantMessage({ text: greeting, cards });
    }
    case "link-existing": {
      // Customer tapped one of their past tickets — bind the session to it
      // and pivot to the SOLUTION stage so AI can pick up the conversation.
      if (value === "new") {
        // Treat as fresh start.
        return buildAssistantMessage({
          text: "No problem — let's log it as a new issue. Tap the symptom that best matches:",
          cards: [
            { type: "category-grid", kind: "pick-symptom",    options: SYMPTOM_OPTIONS },
            { type: "category-grid", kind: "select-category", options: CATEGORY_OPTIONS, sectionLabel: "Or pick a broad category" },
          ],
        });
      }
      // value should be an existing ticket id
      intake.ticketId = value;
      intake.stage = "solution";
      session.ticketId = value;
      return buildAssistantMessage({
        text: `Got it — I'll continue with ${value}. Tell me what's happening now and I'll suggest next steps based on what we've already tried.`,
      });
    }
    case "flag-recurring": {
      // v3.31.0 — customer accepted "yes, flag this recurring issue".
      // Set a hint on the session so /create-ticket attaches a
      // `problemRecord:true` flag and bumps priority. Continue to
      // symptom selection so we still capture today's specifics.
      if (value === "continue") {
        return buildAssistantMessage({
          text: "No problem — let's tackle today's issue first. Tap the symptom that fits best:",
          cards: [
            { type: "category-grid", kind: "pick-symptom",    options: SYMPTOM_OPTIONS },
            { type: "category-grid", kind: "select-category", options: CATEGORY_OPTIONS, sectionLabel: "Or pick a broad category" },
          ],
        });
      }
      intake.flags = intake.flags || {};
      intake.flags.problemRecord = true;
      intake.flags.recurringCategory = value || intake.flags.recurringCategory || null;
      return buildAssistantMessage({
        text: "Got it — I've flagged this for our engineers to investigate as a recurring issue. They'll look at the root cause (hardware/account/service) instead of just the symptom. Now, tap the symptom that matches today so we can log this ticket:",
        cards: [
          { type: "category-grid", kind: "pick-symptom",    options: SYMPTOM_OPTIONS },
          { type: "category-grid", kind: "select-category", options: CATEGORY_OPTIONS, sectionLabel: "Or pick a broad category" },
        ],
      });
    }
    case "link-major-incident": {
      // v3.31.0 — customer's symptom matched an active major incident.
      // Skip ticket creation entirely; bind session to the parent so
      // status updates flow back automatically.
      if (value === "new" || !value) {
        return buildAssistantMessage({
          text: "Understood — we'll log this as your own ticket. Tap the symptom that matches:",
          cards: [
            { type: "category-grid", kind: "pick-symptom",    options: SYMPTOM_OPTIONS },
            { type: "category-grid", kind: "select-category", options: CATEGORY_OPTIONS, sectionLabel: "Or pick a broad category" },
          ],
        });
      }
      intake.ticketId = value;
      intake.stage = "solution";
      session.ticketId = value;
      return buildAssistantMessage({
        text: `Linked to major incident ${value}. Our team is already on it — I'll send you a notification the moment it's resolved. Anything else I can help with in the meantime?`,
      });
    }
    case "pick-symptom": {
      // 1-tap shortcut: auto-fill category + title, optionally offer a
      // 30-second self-help guide before continuing the intake. Drops
      // time-to-ticket from ~30s to ~6s.
      const sym = SYMPTOM_OPTIONS.find(s => s.value === value);
      if (!sym) return null;
      intake.category = sym.category;
      intake.fields.title = sym.title;
      // v3.30.0 — if this symptom has a structured form template, render it
      // INSTEAD of asking impact/priority. The form already has implicit
      // priority defaults baked in, so submitting jumps straight to summary.
      const formKey = SYMPTOM_FORM_MAP[sym.value];
      if (formKey && FORM_TEMPLATES[formKey]) {
        const tpl = FORM_TEMPLATES[formKey];
        intake.pendingForm = formKey;
        intake.stage = "form-fill";
        return buildAssistantMessage({
          text: tpl.intro,
          cards: [{
            type: "form",
            kind: "submit-form",
            formKey,
            title: tpl.title,
            fields: tpl.fields,
            submitLabel: "✅ Submit & log ticket",
          }],
        });
      }
      // If a self-help guide exists for this symptom, offer it BEFORE
      // collecting impact/priority. Customer can either try it (and skip
      // the ticket entirely if it works) or proceed straight to the ticket.
      if (sym.selfHelp && SELF_HELP_GUIDES[sym.selfHelp]) {
        intake.pendingSelfHelp = sym.selfHelp; // remember it
        intake.stage = "self-help-offer";
        const g = SELF_HELP_GUIDES[sym.selfHelp];
        const stepsText = g.steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
        return buildAssistantMessage({
          text: `Got it — "${sym.title}". 💡 Want to try a quick 30-second fix first?\n\n*${g.title}*\n${stepsText}`,
          cards: [{
            type: "quick-reply",
            kind: "try-self-help",
            options: [
              { value: "worked",      label: "✅ It worked — no ticket needed",   icon: null },
              { value: "didnt-work",  label: "❌ Didn't work — log a ticket",       icon: null },
              { value: "skip-fix",    label: "⏭️ Skip the fix — just log it",     icon: null },
            ],
          }],
        });
      }
      // No self-help → skip straight to impact (title is already set).
      intake.stage = "field:impact";
      return buildAssistantMessage({
        text: `Got it — I'll log this as "${sym.title}". One quick question:`,
        cards: [{ type: "quick-reply", kind: "pick-impact", options: IMPACT_OPTIONS }],
      });
    }
    case "submit-form": {
      // value is { formKey, fields: { ... } }
      const formKey = value?.formKey || intake.pendingForm;
      const tpl = FORM_TEMPLATES[formKey];
      if (!tpl) return null;
      const inputs = (value && value.fields) || {};
      // Validate required fields.
      const missing = tpl.fields.filter(f => f.required && !String(inputs[f.key] || "").trim());
      if (missing.length) {
        return buildAssistantMessage({
          text: `I still need: ${missing.map(f => f.label).join(", ")}. Please complete those fields and submit again.`,
          cards: [{
            type: "form", kind: "submit-form", formKey,
            title: tpl.title, fields: tpl.fields, submitLabel: "✅ Submit & log ticket",
            initialValues: inputs,
          }],
        });
      }
      // Persist all form values into intake.fields and apply implicit
      // impact/priority. Build a description from the form data.
      for (const f of tpl.fields) {
        if (inputs[f.key]) intake.fields[f.key] = String(inputs[f.key]).slice(0, 1000);
      }
      const descLines = tpl.fields
        .filter(f => inputs[f.key])
        .map(f => `${f.label}: ${inputs[f.key]}`);
      intake.fields.description = descLines.join("\n");
      intake.fields.impact   = intake.fields.impact   || tpl.impact;
      intake.fields.priority = intake.fields.priority || tpl.priority;
      intake.stage = "confirm";
      intake.pendingForm = null;
      return buildAssistantMessage({
        text: "Perfect — I've got everything I need. Here's a quick summary, tap to confirm:",
        cards: [summaryCard(intake)],
      });
    }
    case "try-self-help": {
      if (value === "worked") {
        // Resolved without a ticket — go straight to CSAT, no ticket created.
        intake.stage = "csat";
        intake.selfResolved = true;
        return buildAssistantMessage({
          text: "Wonderful! Glad that quick fix did the trick. 🎉 Before you go, would you mind rating your experience today?",
          cards: [csatCard()],
        });
      }
      // Either "didnt-work" or "skip-fix" → continue to impact card.
      intake.stage = "field:impact";
      const lead = value === "didnt-work"
        ? "No problem — let's get a ticket logged so an engineer can take a look."
        : "Sure — let's log it directly.";
      return buildAssistantMessage({
        text: `${lead} How is this affecting your work?`,
        cards: [{ type: "quick-reply", kind: "pick-impact", options: IMPACT_OPTIONS }],
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
      // Smart split: if the customer typed a long initial title, treat the
      // tail as description so we don't have to ask the next question.
      if (fieldKey === "title" && intake.fields.title.length > 80 && !intake.fields.description) {
        intake.fields.description = intake.fields.title;
        intake.fields.title = intake.fields.title.split(/[.!?\n]/)[0].slice(0, 80);
      }
      const next = nextFieldStage(intake.stage);
      intake.stage = next;
      if (next === "confirm") {
        return buildAssistantMessage({
          text: "Got it. Here's a quick summary — tap to confirm and I'll log your ticket.",
          cards: [summaryCard(intake)],
        });
      }
      const ack = (I18N.acks[intake.lang || "en"] || I18N.acks.en)[idx % 4];
      const promptMsg = promptForStage(next);
      if (promptMsg) {
        promptMsg.text = `${ack} ${promptMsg.text}`;
        // Add a Skip chip on optional fields so customer can fast-forward.
        const nextIdx = findFieldIndex(next);
        if (nextIdx >= 0 && INTAKE_FIELDS[nextIdx].optional) {
          promptMsg.cards = (promptMsg.cards || []).concat([{
            type: "quick-reply",
            kind: "skip-field",
            options: [{ value: "skip", label: "⏭️ Skip — create now", icon: null }],
          }]);
        }
      }
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

function buildUserPrompt(session, kbContext, redactedQuery, liveContext) {
  const lines = [];
  lines.push(`Channel: ${session.channel}`);
  if (session.ticketId) lines.push(`Linked ticket: ${session.ticketId}`);
  if (kbContext.length) {
    lines.push("\nKnowledge base context:");
    for (const k of kbContext) {
      lines.push(`- [${k.id}] ${k.title}: ${k.snippet.replace(/\s+/g, " ").trim()}`);
    }
  }
  if (liveContext) {
    lines.push(`\n${liveContext}`);
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

// ─── Operational intent detection (v3.36.0 — Live ITSM grounding) ────────
// Regex classifier to identify when a user is asking about their own ITSM
// data (tickets, approvals, requests). Returns flags for each data type
// and an optional specificId for targeted lookup.
const INTENT_PATTERNS = {
  tickets: [
    /\b(my|open|recent|pending|assigned)\s+(ticket|incident|issue)s?\b/i,
    /\bstatus\s+of\s+INC-/i,
    /\bINC-[\w-]+/i,
    /\b(show|list|check|view|get)\s+(my\s+)?(ticket|incident)s?\b/i,
    /\bwhere\s+is\s+(my\s+)?(ticket|incident|INC-)\b/i,
    /\bticket\s+status\b/i,
  ],
  approvals: [
    /\b(my|pending|outstanding|waiting)\s+approval(s?)\b/i,
    /\bapproval\s+(status|queue|pending|list)\b/i,
    /\b(show|list|check|view|get)\s+(my\s+)?approval(s?)\b/i,
    /\bwhat.*need(s?)\s+(my\s+)?approv/i,
    /\bapprove|reject\b/i,
  ],
  requests: [
    /\b(my|open|pending|recent)\s+(service\s+)?request(s?)\b/i,
    /\bstatus\s+of\s+REQ-/i,
    /\bREQ-[\w-]+/i,
    /\b(show|list|check|view|get)\s+(my\s+)?(service\s+)?request(s?)\b/i,
    /\bwhere\s+is\s+(my\s+)?(request|REQ-)\b/i,
  ],
};

function detectOperationalIntent(text) {
  if (!text || typeof text !== "string") return null;
  const result = { tickets: false, approvals: false, requests: false, specificId: null };
  let hasIntent = false;
  for (const [key, patterns] of Object.entries(INTENT_PATTERNS)) {
    for (const re of patterns) {
      if (re.test(text)) { result[key] = true; hasIntent = true; break; }
    }
  }
  // Extract specific INC- or REQ- IDs
  const idMatch = text.match(/\b(INC-[\w-]+|REQ-[\w-]+)/i);
  if (idMatch) { result.specificId = idMatch[1].toUpperCase(); hasIntent = true; }
  return hasIntent ? result : null;
}

module.exports = function createChatAssistRoutes(ctx) {
  const { db, json, parseBody, callAI, extractAIText, wsServer, cachedGetAll } = ctx;

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
        // v3.33.1 — accept channel:"teams" alongside customer/agent. Teams
        // sessions are typically created server-side by routes/teamsBot.js;
        // exposing it here lets test harnesses & admin tooling create one too.
        const channel = body.channel === "customer" ? "customer"
          : body.channel === "teams" ? "teams"
          : "agent";
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
          agentEmail: channel === "agent" ? (body.agentEmail || actorOf(authResult)) : null,
        };
        // v3.30.0 — history-aware persona: load past tickets for this
        // customer so the greeting and AI prompt can be personalized.
        if (channel === "customer" && session.customerEmail) {
          try {
            session.history = await loadCustomerHistory(db, session.customerEmail, 5);
          } catch { session.history = []; }
        }
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
          // v3.31.0 (Phase 1) — frustration detection. Once flagged, the
          // session stays in apologetic mode and AI replies prepend a
          // "talk-to-engineer" chip so the customer always has a clear
          // path out of self-service.
          if (!session.frustrationFlag && detectFrustration(text)) {
            session.frustrationFlag = true;
            try {
              await db.audit(SESSION_COLLECTION, session.id, "sentiment.escalated",
                JSON.stringify({ trigger: "frustration-regex", textSample: String(text).slice(0, 120) }),
                session.createdBy);
            } catch { /* non-fatal */ }
          }
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

        // v3.36.0 — Live ITSM data grounding: detect operational intent
        // and pull matching records for the current user.
        let liveContext = "";
        const operationalIntent = detectOperationalIntent(redacted);
        if (operationalIntent) {
          const userEmail = session.channel === "customer" || session.channel === "teams"
            ? session.customerEmail
            : session.agentEmail || session.createdBy;
          if (userEmail) {
            try {
              liveContext = await gatherLiveContext(db, cachedGetAll, userEmail, operationalIntent, 5);
            } catch (err) {
              console.warn("[ChatAssist] gatherLiveContext failed:", err.message);
            }
          }
        }

        // AI call — keep options minimal (no temperature; GPT-5.4 rejects it)
        const lang = session.intake?.lang || "en";
        let histCtx = (session.channel === "customer" || session.channel === "teams") ? summarizeHistoryForPrompt(session.history) : "";
        // v3.31.0 — frustrated customer? Prepend an apologetic-tone hint
        // so the AI acknowledges before suggesting steps.
        if (session.frustrationFlag && session.channel === "customer") {
          const frustrationCue = "TONE OVERRIDE — the customer is visibly frustrated. Open your reply by acknowledging the frustration ('I'm really sorry this has been so painful'), avoid jargon, and explicitly offer a human engineer at the end. Keep it short.";
          histCtx = histCtx ? `${histCtx}\n\n${frustrationCue}` : frustrationCue;
        }
        const sysPrompt = buildSystemPrompt(session.channel, lang, histCtx);
        const userPrompt = buildUserPrompt(session, kbContext, redacted, liveContext);
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
        // v3.31.0 — frustrated session: ALWAYS surface a talk-to-engineer
        // chip so the customer has a one-tap escape from self-service.
        if (session.frustrationFlag && session.channel === "customer" && aiOk) {
          assistantMsg.cards = assistantMsg.cards || [];
          if (!assistantMsg.cards.some(c => c.kind === "request-agent")) {
            assistantMsg.cards.push({
              type: "quick-reply",
              kind: "request-agent",
              options: [{ value: "agent", label: "👤 Connect me to a human engineer" }],
            });
          }
        }
        // v3.36.0 — Agent channel: attach actionable cards so engineers get
        // rich conversational interactions (ticket lists, quick actions, KB refs).
        if (session.channel === "agent" && aiOk) {
          assistantMsg.cards = assistantMsg.cards || [];
          const userLower = (text || "").toLowerCase();
          // KB citation cards — when the reply references KB articles
          if (kbContext.length > 0) {
            assistantMsg.cards.push({
              type: "kb-refs",
              kind: "kb-citations",
              articles: kbContext.slice(0, 3).map(k => ({
                id: k.id, title: k.title, category: k.category || "General",
              })),
            });
          }
          // Operational intent cards — when live ITSM data was injected
          if (operationalIntent && liveContext) {
            if (operationalIntent.tickets) {
              assistantMsg.cards.push({
                type: "quick-reply",
                kind: "ticket-actions",
                options: [
                  { value: "create", label: "➕ Create Incident", icon: null },
                  { value: "queue",  label: "📋 View Queue",     icon: null },
                  { value: "sla",    label: "⏱️ SLA Status",      icon: null },
                ],
              });
            }
            if (operationalIntent.approvals) {
              assistantMsg.cards.push({
                type: "quick-reply",
                kind: "approval-actions",
                options: [
                  { value: "pending", label: "📋 Pending Approvals", icon: null },
                  { value: "review",  label: "🔍 Review Changes",    icon: null },
                ],
              });
            }
          }
          // Diagnostic / triage cards — when message looks like triage work
          const triagePattern = /\b(diagnos|triage|troubleshoot|root\s*cause|check|investig)/i;
          if (triagePattern.test(userLower)) {
            assistantMsg.cards.push({
              type: "quick-reply",
              kind: "triage-actions",
              options: [
                { value: "similar",   label: "🔍 Similar Tickets",   icon: null },
                { value: "escalate",  label: "⬆️ Escalate",          icon: null },
                { value: "kb-search", label: "📚 Search KB",         icon: null },
              ],
            });
          }
          // Always add a follow-up action chip for agent convenience
          if (assistantMsg.cards.length === 0) {
            assistantMsg.cards.push({
              type: "quick-reply",
              kind: "agent-followup",
              options: [
                { value: "elaborate", label: "📝 Elaborate",        icon: null },
                { value: "draft",     label: "✍️ Draft Reply",      icon: null },
                { value: "kb-search", label: "📚 Search KB",        icon: null },
              ],
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
        // v3.31.0 (Phase 1) — major-incident piggyback. Before letting the
        // state machine create yet another duplicate ticket for an active
        // outage, see if ≥5 OPEN tickets exist in the same category in the
        // last 10 min. If so, return a "link to MAJ-* parent?" card instead.
        if (kind === "pick-symptom") {
          try {
            const sym = SYMPTOM_OPTIONS.find(s => s.value === value);
            if (sym && !session.intake?.bypassMajorCheck) {
              const major = await findActiveMajorIncident(db, sym.category);
              if (major) {
                const card = {
                  type: "major-incident",
                  kind: "link-major-incident",
                  majorIncidentId: major.id,
                  category: major.category,
                  affectedCount: major.affectedCount,
                  startedAt: major.startedAt,
                  eta: major.eta,
                  linkLabel: `📡 Yes — link me to ${major.id}`,
                  newLabel: "🆕 No, log my own ticket",
                };
                const text = `Heads-up — we're already aware of a ${major.category} issue affecting ${major.affectedCount} other people right now (${major.id}). Would you like me to link you to that incident so you get notified when it's fixed, or log your own?`;
                const msg = buildAssistantMessage({ text, cards: [card] });
                session.messages = session.messages || [];
                session.messages.push(msg);
                recordFunnelEvent(db, session, "pick-symptom", "major-incident-prompt", { value, majorId: major.id });
                await saveSession(db, session);
                return json(res, 200, { sessionId: session.id, message: msg, intakeStage: session.intake?.stage });
              }
            }
          } catch (err) {
            console.warn("[ChatAssist] major-incident check failed:", err.message);
            // Non-fatal — continue with normal flow.
          }
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
          // v3.30.0 — keep the conversation alive: offer next-best actions
          // instead of a dead-end. Frontend handles each kind locally.
          cards: [{
            type: "quick-reply",
            kind: "next-action",
            options: [
              { value: "log-another", label: "🆕 Log another issue",      icon: null },
              { value: "browse-kb",   label: "📚 Browse self-help articles", icon: null },
              { value: "talk-agent",  label: "👤 Talk to an engineer",     icon: null },
            ],
          }],
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
  SYMPTOM_OPTIONS,
  SELF_HELP_GUIDES,
  FORM_TEMPLATES,
  SYMPTOM_FORM_MAP,
  loadCustomerHistory,
  summarizeHistoryForPrompt,
  detectRecurringPattern,
  detectFrustration,
  findActiveMajorIncident,
  detectOperationalIntent,
  gatherLiveContext,
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
