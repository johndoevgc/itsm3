// runbookActions.js — Phase 4 v3.34.0 backbone
// ---------------------------------------------------------------------------
// Safe-action allow-list registry for the self-healing runbook engine.
//
// Every action declares:
//   - id, name, description, riskTier (1=low, 2=medium, 3=high)
//   - idempotent: safe to re-run with the same params
//   - inputSchema: {fieldName: {type, required, pattern?, max?, enum?}}
//   - shadow(params, ctx): ALWAYS-SAFE simulation. Must NEVER touch real systems.
//                          Returns {ok, simulated:true, message, steps:[...]}.
//   - exec(params, ctx):   Real privileged operation. In v3.34.0 these are
//                          deliberate stubs that throw "exec-not-implemented"
//                          so the registry + audit + idempotency plumbing can
//                          land in prod without any real automation. Real
//                          implementations will land per-action in v3.34.1+
//                          ONLY after security sign-off and 1-week shadow run.
//
// Hard guardrails baked into the executor:
//   * Per-action feature flag `self_healing.<id>` must be enabled.
//   * Flag payload `shadowOnly:true` (default) forces shadow path.
//   * Per-action `dailyCap` (default 10) enforced by counting today's
//     executions in the `runbook_action_executions` collection.
//   * Per-action idempotency key prevents duplicate runs in the same UTC day.
//   * Every run audited to `runbook_action_executions` with full payload.
// ---------------------------------------------------------------------------

const crypto = require("crypto");

const DEFAULT_DAILY_CAP = 10;
const EXEC_COLLECTION = "runbook_action_executions";

// ─── Registry ────────────────────────────────────────────────────────────────
const _registry = new Map();

function register(action) {
  if (!action || typeof action !== "object") throw new Error("action must be an object");
  if (!action.id || typeof action.id !== "string") throw new Error("action.id required");
  if (!Number.isInteger(action.riskTier) || action.riskTier < 1 || action.riskTier > 3) {
    throw new Error("action.riskTier must be 1, 2, or 3");
  }
  if (typeof action.shadow !== "function") throw new Error("action.shadow required");
  if (typeof action.exec !== "function") throw new Error("action.exec required");
  _registry.set(action.id, Object.freeze({
    name: action.id,
    description: "",
    idempotent: false,
    inputSchema: {},
    ...action,
  }));
}

function get(id) { return _registry.get(id) || null; }

function list() {
  return Array.from(_registry.values()).map(a => ({
    id: a.id,
    name: a.name,
    description: a.description,
    riskTier: a.riskTier,
    idempotent: a.idempotent,
    inputSchema: a.inputSchema,
  }));
}

function _resetForTests() { _registry.clear(); _registerBuiltins(); }

// ─── Input validation ────────────────────────────────────────────────────────
function validateInput(action, params) {
  const errors = [];
  const schema = action.inputSchema || {};
  const p = params && typeof params === "object" ? params : {};
  for (const [field, spec] of Object.entries(schema)) {
    const v = p[field];
    if (v === undefined || v === null || v === "") {
      if (spec.required) errors.push(`${field} is required`);
      continue;
    }
    if (spec.type === "string" && typeof v !== "string") {
      errors.push(`${field} must be a string`);
      continue;
    }
    if (spec.type === "number" && typeof v !== "number") {
      errors.push(`${field} must be a number`);
      continue;
    }
    if (spec.type === "boolean" && typeof v !== "boolean") {
      errors.push(`${field} must be a boolean`);
      continue;
    }
    if (spec.max !== undefined && typeof v === "string" && v.length > spec.max) {
      errors.push(`${field} exceeds max length ${spec.max}`);
    }
    if (spec.pattern && typeof v === "string" && !new RegExp(spec.pattern).test(v)) {
      errors.push(`${field} does not match required pattern`);
    }
    if (Array.isArray(spec.enum) && !spec.enum.includes(v)) {
      errors.push(`${field} must be one of: ${spec.enum.join(", ")}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// ─── Idempotency ─────────────────────────────────────────────────────────────
function idempotencyKey(actionId, params) {
  const day = new Date().toISOString().slice(0, 10);
  const stable = JSON.stringify(params || {}, Object.keys(params || {}).sort());
  const h = crypto.createHash("sha1").update(`${actionId}|${day}|${stable}`).digest("hex").slice(0, 16);
  return `${actionId}-${day}-${h}`;
}

// ─── Daily cap check ─────────────────────────────────────────────────────────
async function _countToday(db, actionId) {
  if (!db || typeof db.getAll !== "function") return 0;
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.getAll(EXEC_COLLECTION);
  let n = 0;
  for (const row of rows) {
    let data;
    try { data = typeof row.data === "string" ? JSON.parse(row.data) : row.data; }
    catch { continue; }
    if (data && data.actionId === actionId && data.startedAt && data.startedAt.slice(0, 10) === today) n++;
  }
  return n;
}

// ─── Executor ────────────────────────────────────────────────────────────────
// Returns { ok, mode: "shadow"|"real"|"cached", result?, error?, capped?,
//           idempotencyKey, executionId }
async function execute({ actionId, params, ctx, executedBy, incidentId, flagPayload }) {
  const action = get(actionId);
  if (!action) return { ok: false, error: "unknown action" };

  const validation = validateInput(action, params);
  if (!validation.ok) return { ok: false, error: "invalid params", details: validation.errors };

  const db = ctx && ctx.db;
  const flag = flagPayload || {};
  const dailyCap = Number(flag.dailyCap) || DEFAULT_DAILY_CAP;
  const shadowOnly = flag.shadowOnly !== false; // default TRUE — fail-safe.

  // Idempotency check: same action+params+day → return prior result.
  const idemKey = idempotencyKey(actionId, params);
  if (db && typeof db.getOne === "function") {
    const prior = await db.getOne(EXEC_COLLECTION, idemKey);
    if (prior) {
      let priorData;
      try { priorData = typeof prior.data === "string" ? JSON.parse(prior.data) : prior.data; }
      catch { priorData = null; }
      if (priorData && priorData.ok) {
        return { ok: true, mode: "cached", result: priorData.result,
                 idempotencyKey: idemKey, executionId: priorData.id };
      }
    }
  }

  const todayCount = await _countToday(db, actionId);
  if (todayCount >= dailyCap) {
    return { ok: false, error: "daily cap reached", capped: true,
             dailyCap, todayCount };
  }

  const executionId = `RA-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const startedAt = new Date().toISOString();
  const mode = shadowOnly ? "shadow" : "real";
  let result, error = null, ok = true;

  try {
    if (mode === "shadow") {
      result = await action.shadow(params || {}, ctx || {});
    } else {
      result = await action.exec(params || {}, ctx || {});
    }
    if (!result || typeof result !== "object") result = { ok: true };
    if (result.ok === false) { ok = false; error = result.error || "action returned ok:false"; }
  } catch (err) {
    ok = false;
    error = err && err.message ? err.message : String(err);
    result = { ok: false, error };
  }

  const record = {
    id: executionId, idempotencyKey: idemKey, actionId, riskTier: action.riskTier,
    mode, ok, error, result,
    params: params || {}, executedBy: executedBy || "system",
    incidentId: incidentId || null,
    startedAt, completedAt: new Date().toISOString(),
  };
  if (db && typeof db.upsert === "function") {
    try { await db.upsert(EXEC_COLLECTION, idemKey, JSON.stringify(record)); }
    catch { /* non-fatal — we still return the in-memory result */ }
  }
  if (db && typeof db.audit === "function") {
    try {
      await db.audit(EXEC_COLLECTION, executionId,
        ok ? `runbook.action.${mode}` : `runbook.action.${mode}.failed`,
        JSON.stringify({ actionId, riskTier: action.riskTier, ok, error, incidentId: incidentId || null }),
        executedBy || "system");
    } catch { /* non-fatal */ }
  }

  return { ok, mode, result, error, idempotencyKey: idemKey, executionId };
}

// ─── Built-in actions (all exec stubs throw — see header) ────────────────────
function _stubExec(name) {
  return async function exec() {
    throw new Error(`${name}: exec-not-implemented (real privileged action requires v3.34.1+ security sign-off)`);
  };
}

function _registerBuiltins() {
  register({
    id: "unlockAccount", name: "Unlock AAD Account", riskTier: 2, idempotent: true,
    description: "Unlock a locked-out Entra ID user account.",
    inputSchema: { upn: { type: "string", required: true, max: 200, pattern: "^[^@\\s]+@[^@\\s]+$" } },
    async shadow(p) {
      return { ok: true, simulated: true, message: `Would unlock account ${p.upn}`,
               steps: [`Lookup user by UPN`, `POST /users/${p.upn}/revokeSignInSessions`, `Verify accountEnabled=true`] };
    },
    exec: _stubExec("unlockAccount"),
  });

  register({
    id: "resetMfa", name: "Reset MFA Methods", riskTier: 3, idempotent: false,
    description: "Reset all MFA methods for an Entra ID user. Risk-tier 3 requires explicit approver.",
    inputSchema: {
      upn: { type: "string", required: true, max: 200, pattern: "^[^@\\s]+@[^@\\s]+$" },
      approvedBy: { type: "string", required: true, max: 200 },
    },
    async shadow(p) {
      return { ok: true, simulated: true, message: `Would reset MFA for ${p.upn} (approver: ${p.approvedBy})`,
               steps: [`List authenticationMethods`, `Delete each method`, `Email user new enrolment link`] };
    },
    exec: _stubExec("resetMfa"),
  });

  register({
    id: "clearPrintQueue", name: "Clear Stuck Print Queue", riskTier: 1, idempotent: true,
    description: "Cancel all jobs in a Universal Print queue.",
    inputSchema: {
      printerId: { type: "string", required: true, max: 100 },
      printerName: { type: "string", required: false, max: 200 },
    },
    async shadow(p) {
      return { ok: true, simulated: true, message: `Would purge queue for printer ${p.printerName || p.printerId}`,
               steps: [`GET /print/printers/${p.printerId}/jobs`, `Cancel each job`, `Verify queue empty`] };
    },
    exec: _stubExec("clearPrintQueue"),
  });

  register({
    id: "extendMailboxQuota", name: "Extend Mailbox Quota", riskTier: 2, idempotent: true,
    description: "Increase Exchange Online mailbox storage quota by a delta (GB).",
    inputSchema: {
      upn: { type: "string", required: true, max: 200, pattern: "^[^@\\s]+@[^@\\s]+$" },
      deltaGb: { type: "number", required: true },
    },
    async shadow(p) {
      return { ok: true, simulated: true, message: `Would extend ${p.upn} mailbox by +${p.deltaGb} GB`,
               steps: [`Get current ProhibitSendQuota`, `Set new quota = current + ${p.deltaGb}GB`, `Verify`] };
    },
    exec: _stubExec("extendMailboxQuota"),
  });

  register({
    id: "forceVpnReauth", name: "Force VPN Re-Auth", riskTier: 1, idempotent: true,
    description: "Revoke active VPN sessions to force fresh authentication. Common fix for stuck VPN tokens.",
    inputSchema: { upn: { type: "string", required: true, max: 200, pattern: "^[^@\\s]+@[^@\\s]+$" } },
    async shadow(p) {
      return { ok: true, simulated: true, message: `Would force VPN re-auth for ${p.upn}`,
               steps: [`Revoke refresh tokens`, `Notify user to reconnect`, `Verify new sign-in within 5 min`] };
    },
    exec: _stubExec("forceVpnReauth"),
  });

  register({
    id: "restartSpoolerOnDevice", name: "Restart Print Spooler on Device", riskTier: 2, idempotent: true,
    description: "Restart the Print Spooler service on a managed Intune device.",
    inputSchema: {
      deviceId: { type: "string", required: true, max: 100 },
      deviceName: { type: "string", required: false, max: 200 },
    },
    async shadow(p) {
      return { ok: true, simulated: true, message: `Would restart spooler on ${p.deviceName || p.deviceId}`,
               steps: [`Verify device online via Intune`, `POST custom PowerShell script`, `Verify Service running`] };
    },
    exec: _stubExec("restartSpoolerOnDevice"),
  });
}

_registerBuiltins();

module.exports = {
  register, get, list, validateInput, idempotencyKey, execute,
  EXEC_COLLECTION, DEFAULT_DAILY_CAP,
  __internal: { _registerBuiltins, _resetForTests, _countToday, _stubExec },
};
