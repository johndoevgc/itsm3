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
  // Phase 2 shadow-mode flags — default OFF in prod, can be enabled per slot
  shadow_sla_v2:       { enabled: false, scope: "staging" },
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
  // Also ensure each default exists as a row (so admins can toggle from the UI)
  for (const [name, def] of Object.entries(DEFAULTS)) {
    if (!_cache.has(name) || _cache.get(name).enabled !== def.enabled) {
      try {
        await db.upsert("feature_flags", name, JSON.stringify({
          id: name, ...def, payload: null, updatedAt: new Date().toISOString(),
        }));
      } catch { /* ignore */ }
    }
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
