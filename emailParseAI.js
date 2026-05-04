// emailParseAI.js — v3.33.0 (Phase 3 step 1)
// AI-powered parser for inbound emails. Given subject + body, returns a
// best-guess { symptom, category, priority, suggestedFormKey, fields, confidence }.
// Used by server.js processInboundEmails to enrich auto-created incidents.
//
// On any failure (AI down, garbage output, timeout) returns null so caller can
// fall back to the existing defaults ("General"/"Sev-C") without a crash.

const ALLOWED_CATEGORIES = [
  "Network", "Hardware", "Software", "Access", "Email", "Security",
  "Phone", "Printer", "VPN", "General",
];
const ALLOWED_PRIORITIES = ["Sev-A", "Sev-B", "Sev-C", "Sev-D"];
const SYMPTOM_FORM_MAP = {
  "printer-offline":       "printer-form",
  "paper-jam":             "printer-form",
  "scanner-not-working":   "printer-form",
  "need-software-install": "software-request-form",
  "vpn-wont-connect":      "vpn-form",
  "need-new-access":       "access-request-form",
  "phishing-suspicious":   "phishing-form",
};
const ALLOWED_SYMPTOMS = Object.keys(SYMPTOM_FORM_MAP);

function _truncate(s, n) { return typeof s === "string" ? s.slice(0, n) : ""; }

async function aiParseInboundEmail(subject, body, callAI, opts = {}) {
  const { tier = "secondary", maxTokens = 350 } = opts;
  if (typeof callAI !== "function") return null;
  const subj = _truncate(subject, 200);
  const bod = _truncate(body, 1800);
  if (!subj && !bod) return null;
  const systemPrompt = `You are an IT service-desk triage classifier. Given an inbound email, return STRICT JSON ONLY (no prose) with this shape:
{
  "symptom": one of [${ALLOWED_SYMPTOMS.map(s => `"${s}"`).join(", ")}] OR null,
  "category": one of [${ALLOWED_CATEGORIES.map(c => `"${c}"`).join(", ")}],
  "priority": one of [${ALLOWED_PRIORITIES.map(p => `"${p}"`).join(", ")}] (Sev-A=outage/many users, Sev-B=major function down, Sev-C=single user impact, Sev-D=question/request),
  "fields": object of extracted fields, e.g. {"printerName":"HP-3F","errorCode":"E18","userName":"Alice"} (omit unknowns),
  "confidence": 0..1
}
Use null for symptom if no listed symptom matches. Default category="General", priority="Sev-C" if unsure.`;
  const userPrompt = `Subject: ${subj}\n\nBody:\n${bod}`;
  let raw;
  try {
    const out = await callAI(systemPrompt, userPrompt, { tier, maxTokens });
    raw = (out && (out.text || out.content)) || "";
  } catch { return null; }
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch { /* fall through */ } }
  }
  if (!parsed || typeof parsed !== "object") return null;

  // Sanitize / clamp
  const symptom = ALLOWED_SYMPTOMS.includes(parsed.symptom) ? parsed.symptom : null;
  const category = ALLOWED_CATEGORIES.includes(parsed.category) ? parsed.category : "General";
  const priority = ALLOWED_PRIORITIES.includes(parsed.priority) ? parsed.priority : "Sev-C";
  const suggestedFormKey = symptom ? SYMPTOM_FORM_MAP[symptom] : null;
  const fields = (parsed.fields && typeof parsed.fields === "object" && !Array.isArray(parsed.fields)) ? parsed.fields : {};
  // Cap each field value at 200 chars to limit injection / log bloat
  const cleanFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof k !== "string" || k.length > 60) continue;
    if (v == null) continue;
    cleanFields[k] = typeof v === "string" ? v.slice(0, 200) : v;
  }
  let confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  if (confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;

  return {
    symptom,
    category,
    priority,
    suggestedFormKey,
    fields: cleanFields,
    confidence,
  };
}

module.exports = {
  aiParseInboundEmail,
  ALLOWED_CATEGORIES,
  ALLOWED_PRIORITIES,
  ALLOWED_SYMPTOMS,
  SYMPTOM_FORM_MAP,
};
