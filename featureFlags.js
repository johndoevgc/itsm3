// ─── Feature Flags (lightweight, DB-backed) ────────────────────────────
// Stores flags in the existing `feature_flags` collection of `itsm_data`.
// No schema migration required — works on MySQL, MSSQL, and SQLite.
//
// Flag record shape (per row in itsm_data, collection="feature_flags"):
//   {
//     id:        "shadow_sla_v2",     // also the row id
//     enabled:   true,                // global on/off
//     scope:     "all" | "staging" | "prod" | "user:<email>",
//     payload:   { ... }              // optional config blob
//     updatedAt: "2026-04-28T..."
//   }
//
// Usage:
//   const ff = require("./featureFlags");
//   await ff.init(db, { reloadSec: 30 });
//   if (ff.isEnabled("shadow_sla_v2")) { ... }
//   app.use(ff.middleware());        // adds req.flag(name) and req.flagPayload(name)

const DEFAULTS = {
  // Phase 2 shadow-mode flags — v2 SLA promoted to prod-ready
  shadow_sla_v2:       { enabled: true,  scope: "all" },
  shadow_workflow_v2:  { enabled: false, scope: "staging" },

  // Phase B — operational maturity gates
  // Auto customer email on incident CRUD: OFF in prod by default (safer).
  // Engineers can flip to true once cooling-off + redaction are validated.
  auto_customer_email: { enabled: false, scope: "prod" },
  // Cooling-off queue: hold AI customer emails for N minutes by severity.
  // Default ON — payload defines per-severity delay (minutes).
  ai_cooling_off:      { enabled: true,  scope: "all",
                         payload: { sevA: -1, sevB: 10, sevC: 5, sevD: 2 } },
  // PII redaction before OpenAI prompts. Default ON.
  pii_redact:          { enabled: true,  scope: "all" },

  // Phase C — continual improvement
  // CSAT survey loop on AI-resolved incidents. Default OFF (staging first).
  // payload.delayHours = hours after resolution to send the survey.
  csat_ai_loop:        { enabled: false, scope: "staging", payload: { delayHours: 24 } },

  // Phase D5 — Sev-A MIM Teams webhook fan-out (off by default; enable per-slot
  // once webhook URLs are populated in `teams_webhooks` collection).
  mim_teams_webhook:   { enabled: false, scope: "staging" },

  // Phase E5 — per-sender 24h throttle on auto-confirmation emails.
  // payload.windowHours = throttle window (default 24).
  internal_quiet_hours:{ enabled: true, scope: "all", payload: { windowHours: 24 } },

  // Phase G — Outbound push from ITSM → Zendesk (status changes, escalations,
  // sync-incident comments). Default OFF in prod to stop "[ITSM Sync] Status
  // changed to ..." comment spam on linked ZD tickets. UI "Push to Zendesk"
  // button uses the same endpoint, so when off, manual pushes no-op too —
  // engineers must edit in ZD directly. Flip on per-tenant when bidirectional
  // sync is wanted.
  zd_push_back:        { enabled: false, scope: "prod" },

  // AI Autopilot rollout: server-side scheduler that runs the safe Week 1-4
  // operating model. Customer-facing actions still require human approval.
  ai_autopilot:        { enabled: true, scope: "all",
                         payload: { rolloutWeek: 4, intervalMin: 15, maxTicketsPerRun: 5, kbEveryHours: 6, briefingHourSGT: 8 } },

  // Zendesk AI Safe Solve: guarded AI resolution for routine Zendesk tickets.
  // The backend owns eligibility, SLA, audit, and customer-contact safety.
  zendesk_ai_safe_solve: { enabled: true, scope: "all",
                           payload: { confidenceThreshold: 90, solveThreshold: 95, atRiskMinutes: 60 } },

  // Chat Assist — KB-grounded conversational helper for both agents (ticket
  // co-pilot side panel) and customers (self-service portal widget). Sessions
  // persist in `chat_assist_sessions`; messages are PII-redacted before each
  // OpenAI call. Off in prod by default — enable per slot once tuned.
  chat_assist:         { enabled: false, scope: "staging",
                         payload: { confidenceThreshold: 75, maxSuggestions: 3,
                                    customerWidgetEnabled: false, kbGroundingTopK: 5,
                                    rateLimitPerMin: 20 } },

  // M365/Azure Expert Agent V1 — ticket-linked Entra sign-in diagnostics.
  // Read-only diagnostics are gated separately from real runbook actions;
  // force sign-out remains controlled by self_healing.forceVpnReauth.
  "m365_agent.enabled": { enabled: false, scope: "staging", payload: { pilotDomains: ["vgcsg.com"] } },
  "m365_agent.entraDiagnostics": { enabled: false, scope: "staging", payload: { maxSignIns: 10 } },

  // v3.33.1 — Omnichannel intake: Microsoft Teams bot adapter.
  omnichannel_teams:   { enabled: false, scope: "staging",
                         payload: { maxReplyChars: 280, requireSecret: true } },

  // v3.33.2 — Omnichannel intake: ACS SMS webhook adapter. Off by default.
  // payload.dailyCapPerNumber caps inbound messages per phone per day to bound
  // ACS billing exposure. payload.maxSmsLen caps outbound SMS body (~3 segs).
  omnichannel_sms:     { enabled: false, scope: "staging",
                         payload: { dailyCapPerNumber: 30, maxSmsLen: 480, requireSecret: true } },

  // v3.33.2 — Browser voice input (Web Speech API) for self-service portal.
  // payload.lang controls SpeechRecognition.lang. Off in prod until UX vetted.
  omnichannel_voice:   { enabled: false, scope: "staging",
                         payload: { lang: "en-SG", maxSeconds: 30, autoStop: true } },

  // Phase B8 — Auto-attach top-K published KB articles to a new incident at
  // create time, based on title/category keyword overlap. Helps the assignee
  // start with relevant context. Off by default in prod; enable per-slot.
  // payload.topK = max articles to attach (default 3).
  kb_auto_attach:      { enabled: false, scope: "staging", payload: { topK: 3 } },

  // ─── Phase 4 v3.34.0 — Self-healing runbook actions ─────────────────
  // Each action has its own kill-switch. payload.shadowOnly defaults to TRUE
  // until v3.34.1 lands real exec() implementations after security sign-off.
  // payload.dailyCap bounds blast radius (per-action, per-UTC-day).
  // RISK: real exec() of these actions performs privileged Graph/Intune
  // operations. Never flip shadowOnly:false without runbook actions registry
  // exec() being implemented AND security review of the specific action.
  "self_healing.unlockAccount":         { enabled: false, scope: "staging", payload: { shadowOnly: true, dailyCap: 10 } },
  "self_healing.resetMfa":              { enabled: false, scope: "staging", payload: { shadowOnly: true, dailyCap: 5 } },
  "self_healing.clearPrintQueue":       { enabled: false, scope: "staging", payload: { shadowOnly: true, dailyCap: 20 } },
  "self_healing.extendMailboxQuota":    { enabled: false, scope: "staging", payload: { shadowOnly: true, dailyCap: 5 } },
  "self_healing.forceVpnReauth":        { enabled: false, scope: "staging", payload: { shadowOnly: true, dailyCap: 20 } },
  "self_healing.restartSpoolerOnDevice":{ enabled: false, scope: "staging", payload: { shadowOnly: true, dailyCap: 10 } },

  // v3.35.0 Phase C — auto-apply skill-based reassign for stuck Sev-A/B unassigned tickets.
  // shadowOnly:true logs to auto_reassign_history without mutating incidents. Promotion criteria same
  // as runbook actions: ≥1wk telemetry, ≥20 runs, 0 errors. Sev-A 24/7, Sev-B business-hours only.
  // dailyCap bounds blast radius. minAgeMinutes = grace period before triggering (lets human triage win).
  "auto_reassign_sev_ab": { enabled: false, scope: "staging", payload: { shadowOnly: true, dailyCap: 50, minAgeMinutes: 15 } },
};

let _db = null;
let _cache = new Map();          // name -> { enabled, scope, payload }
let _timer = null;
let _slotName = process.env.SLOT_NAME || (process.env.PROD_TEST_MODE === "true" ? "staging" : "prod");

function _matchScope(scope, ctx = {}) {
  if (!scope || scope === "all") return true;
  if (scope === _slotName) return true;
  if (scope.startsWith("user:") && ctx.userEmail) {
    return scope.slice(5).toLowerCase() === String(ctx.userEmail).toLowerCase();
  }
  return false;
}

async function _reload() {
  if (!_db) return;
  try {
    const rows = await _db.getAll("feature_flags");
    const next = new Map();
    // Seed defaults first so missing rows fall back to safe defaults
    for (const [name, def] of Object.entries(DEFAULTS)) next.set(name, { ...def });
    for (const r of rows) {
      let obj;
      try { obj = JSON.parse(r.data); } catch { continue; }
      if (!obj || !obj.id) continue;
      next.set(obj.id, {
        enabled: !!obj.enabled,
        scope:   obj.scope || "all",
        payload: obj.payload || null,
      });
    }
    _cache = next;
  } catch (e) {
    // Leave _cache untouched on read errors; never crash the app.
    console.warn("[featureFlags] reload failed:", e.message);
  }
}

async function init(db, { reloadSec = 30 } = {}) {
  _db = db;
  await _reload();
  if (_timer) clearInterval(_timer);
  if (reloadSec > 0) {
    _timer = setInterval(_reload, reloadSec * 1000);
    if (_timer.unref) _timer.unref();
  }
  // Also ensure each default exists as a row (so admins can toggle from the UI).
  // Only seed when the row is genuinely missing — never overwrite an existing
  // DB row, otherwise admin-toggled values get reverted on every restart.
  const _seedRows = await _db.getAll("feature_flags").catch(() => []);
  const _existingNames = new Set();
  for (const r of _seedRows) {
    try { const o = JSON.parse(r.data); if (o && o.id) _existingNames.add(o.id); } catch { /* ignore */ }
  }
  for (const [name, def] of Object.entries(DEFAULTS)) {
    if (_existingNames.has(name)) continue;
    try {
      await _db.upsert("feature_flags", name, JSON.stringify({
        id: name, ...def, updatedAt: new Date().toISOString(),
      }));
    } catch { /* ignore */ }
  }
  await _reload();
  return module.exports;
}

function isEnabled(name, ctx = {}) {
  const f = _cache.get(name);
  if (!f) return false;
  if (!f.enabled) return false;
  return _matchScope(f.scope, ctx);
}

function payload(name) {
  const f = _cache.get(name);
  return f ? f.payload : null;
}

function list() {
  const out = [];
  for (const [name, f] of _cache.entries()) out.push({ name, ...f });
  return out;
}

async function set(name, { enabled, scope, payload: p } = {}) {
  if (!_db) throw new Error("featureFlags not initialized");
  const cur = _cache.get(name) || { enabled: false, scope: "all", payload: null };
  const rec = {
    id: name,
    enabled: typeof enabled === "boolean" ? enabled : cur.enabled,
    scope:   scope ?? cur.scope,
    payload: p === undefined ? cur.payload : p,
    updatedAt: new Date().toISOString(),
  };
  await _db.upsert("feature_flags", name, JSON.stringify(rec));
  await _reload();
  return rec;
}

function middleware() {
  return (req, _res, next) => {
    const ctx = { userEmail: req.user?.email || req.user?.upn };
    req.flag        = (name) => isEnabled(name, ctx);
    req.flagPayload = (name) => payload(name);
    if (next) next();
  };
}

module.exports = { init, isEnabled, payload, list, set, middleware, _DEFAULTS: DEFAULTS };
