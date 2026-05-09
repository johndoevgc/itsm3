/**
 * Zendesk integration routes (/api/zendesk/*)
 * Extracted from server.js — Phase 4
 */
const https = require("https");
const crypto = require("crypto");

const DEFAULT_CUSTOMER_REDIRECT_TARGET = "johndoe@vgcsg.com";
const SAFE_SOLVE_RISK_KEYWORDS = [
  "security", "phishing", "malware", "ransomware", "breach", "data loss", "data leak",
  "outage", "down", "offline", "production", "all users", "company wide", "company-wide",
  "vip", "executive", "ceo", "cfo", "director", "legal", "contract", "invoice",
  "complaint", "angry", "escalat", "urgent", "critical",
];
const SAFE_SOLVE_REVIEW_CATEGORIES = new Set(["security"]);

function safeSolveNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeSafeSolveSlaPriority(value, fallbackPriority) {
  const raw = String(value || fallbackPriority || "").toLowerCase().replace(/[\s_-]/g, "");
  if (["seva", "sev1", "p1", "critical", "urgent"].includes(raw)) return "Sev-A";
  if (["sevb", "sev2", "p2", "high"].includes(raw)) return "Sev-B";
  if (["sevd", "sev4", "p4", "low"].includes(raw)) return "Sev-D";
  return "Sev-C";
}

function computeSafeSolveSla(ticket, slaTargetHours, options = {}) {
  const targetHours = safeSolveNumber(slaTargetHours, 9);
  const createdAt = ticket?.created_at || ticket?.createdAt || new Date().toISOString();
  const createdMs = new Date(createdAt).getTime();
  const deadlineMs = Number.isFinite(createdMs) ? createdMs + targetHours * 3600000 : Date.now() + targetHours * 3600000;
  const minutesRemaining = Math.round((deadlineMs - Date.now()) / 60000);
  const atRiskMinutes = safeSolveNumber(options.atRiskMinutes, 60);
  return {
    targetHours,
    deadline: new Date(deadlineMs).toISOString(),
    minutesRemaining,
    state: minutesRemaining <= 0 ? "breached" : minutesRemaining <= atRiskMinutes ? "at_risk" : "on_track",
  };
}

function collectSafeSolveRiskFlags({ triage = {}, ticket = {}, requester = {}, recentComments = [] }) {
  const haystack = [
    triage.category, triage.itsm_category, triage.internal_note, triage.reasoning,
    ticket.subject, ticket.description, requester.name, requester.email,
    ...(ticket.tags || []),
    ...recentComments.map(c => c.body || c.plain_body || c.htmlBody || ""),
  ].map(stripHtml).join(" ").toLowerCase();
  const flags = [];
  for (const word of SAFE_SOLVE_RISK_KEYWORDS) {
    if (haystack.includes(word)) flags.push(word.replace(/\s+/g, "_"));
  }
  const category = String(triage.category || triage.itsm_category || "").toLowerCase();
  if (SAFE_SOLVE_REVIEW_CATEGORIES.has(category)) flags.push(`${category}_category`);
  return [...new Set(flags)].slice(0, 12);
}

function buildZendeskSafeSolveDecision(input = {}) {
  const {
    triage = {}, ticket = {}, requester = {}, recentComments = [], options = {},
    customerRedirectTarget = DEFAULT_CUSTOMER_REDIRECT_TARGET, emailRedirectMode = true,
  } = input;
  const confidenceThreshold = safeSolveNumber(options.confidenceThreshold, 90);
  const solveThreshold = safeSolveNumber(options.solveThreshold, 95);
  const confidence = safeSolveNumber(triage.confidence, 0);
  const autoSendable = triage.auto_sendable === true || triage.autoSendable === true;
  const routine = triage.routine === true || autoSendable;
  const slaPriority = normalizeSafeSolveSlaPriority(triage.sla_priority, triage.priority || ticket.priority);
  const sla = computeSafeSolveSla(ticket, options.slaTargetHours || input.slaTargetHours, options);
  const riskFlags = collectSafeSolveRiskFlags({ triage, ticket, requester, recentComments });
  const sentiment = String(triage.sentiment || "neutral").toLowerCase();
  const sentimentScore = safeSolveNumber(triage.sentimentScore, 5);
  const resolution = String(triage.resolution || triage.draft_response || triage.customer_response || "").trim();
  const blockedReasons = [];

  if (confidence < confidenceThreshold) blockedReasons.push("confidence_below_threshold");
  if (!autoSendable) blockedReasons.push("not_marked_auto_sendable");
  if (!routine) blockedReasons.push("not_routine_issue");
  if (slaPriority === "Sev-A" || slaPriority === "Sev-B") blockedReasons.push("major_priority_requires_review");
  if (sla.state === "breached") blockedReasons.push("sla_already_breached");
  if (sentiment === "frustrated" || sentimentScore <= 3) blockedReasons.push("frustrated_customer_requires_review");
  if (riskFlags.length > 0) blockedReasons.push("sensitive_or_high_risk_keywords");
  if (resolution.length < 40) blockedReasons.push("missing_concrete_resolution");

  const eligible = blockedReasons.length === 0;
  const targetStatus = confidence >= solveThreshold ? "solved" : "pending";
  const customerEmailTarget = customerRedirectTarget || DEFAULT_CUSTOMER_REDIRECT_TARGET;
  const customerResponse = String(triage.customer_response || triage.draft_response || triage.resolution || "").trim();
  const customerEmailPlanned = options.sendCustomerEmail === true && customerResponse.length > 0;
  const decision = eligible ? (targetStatus === "solved" ? "safe_solve" : "safe_pending") : "needs_review";

  return {
    eligible,
    decision,
    blockedReasons,
    riskFlags,
    confidence,
    threshold: confidenceThreshold,
    autoSendable,
    routine,
    category: triage.category || triage.itsm_category || "General",
    priority: triage.priority || ticket.priority || "normal",
    slaPriority,
    slaDecision: { ...sla, priority: slaPriority },
    targetStatus,
    resolution,
    internalNote: triage.internal_note || triage.reasoning || "AI safe solve analysis completed.",
    customerResponse,
    customerEmailPlanned,
    safeCustomerContact: {
      publicZendeskComment: false,
      customerEmailTarget,
      emailRedirectMode: emailRedirectMode !== false,
      originalRequester: requester?.email || null,
    },
    plannedActions: eligible ? [
      "add_internal_zendesk_note",
      `set_zendesk_status_${targetStatus}`,
      "write_ai_safe_solve_audit",
      customerEmailPlanned ? `send_customer_email_to_${customerEmailTarget}` : "no_customer_email",
    ] : ["queue_for_engineer_review", "preserve_customer_silence"],
  };
}

function zendeskInternalComment(body) {
  return { body, public: false };
}

function buildZendeskSafeSolveApplyPayload(decision, meta = {}) {
  const now = meta.now || new Date().toISOString();
  const requestedBy = meta.requestedBy || "AI Safe Solve";
  const note = [
    `[AI Safe Solve - ${requestedBy}]`,
    `Decision: ${decision.decision}`,
    `Confidence: ${decision.confidence}% (threshold ${decision.threshold}%)`,
    `SLA: ${decision.slaPriority} / ${decision.slaDecision.state} (${decision.slaDecision.minutesRemaining}m remaining)`,
    `Customer contact: no public Zendesk comment; email target ${decision.safeCustomerContact.customerEmailTarget}`,
    "",
    "Resolution:",
    decision.resolution || "No resolution text supplied.",
    "",
    "Internal analysis:",
    decision.internalNote || "No additional analysis.",
    "",
    `Applied at: ${now}`,
  ].join("\n");
  const ticket = {
    comment: zendeskInternalComment(note),
    status: decision.targetStatus,
  };
  if (["low", "normal", "high", "urgent"].includes(String(decision.priority || "").toLowerCase())) {
    ticket.priority = String(decision.priority).toLowerCase();
  }
  return { ticket };
}

function buildSafeSolveEmailBody({ decision, ticket, requester, requestedBy }) {
  return `<div style="font-family:Arial,sans-serif;max-width:640px;">
    <h3 style="color:#1a1a2e;">AI Safe Solve Preview: ${escapeHtml(ticket?.subject || "Zendesk Ticket")}</h3>
    <div style="background:#f8f9fa;padding:16px;border-radius:8px;border-left:4px solid #4CAF50;margin:12px 0;">
      ${escapeHtml(decision.customerResponse || decision.resolution || "AI resolved this routine ticket.").replace(/\n/g, "<br/>")}
    </div>
    <p style="color:#666;font-size:12px;line-height:1.5;">
      Ticket Reference: #${escapeHtml(ticket?.id || "")}<br/>
      Original requester: ${escapeHtml(requester?.email || "unknown")}<br/>
      Safe Solve applied by: ${escapeHtml(requestedBy || "AI Safe Solve")}<br/>
      This message was routed to the configured customer safety mailbox.
    </p>
  </div>`;
}

module.exports = function createZendeskRoutes(ctx) {
  return async function handleZendeskRoutes(req, res, pathname, auth, authResult, urlObj) {
    const { db, json, readBody, parseBody, callAI, extractAIText, cacheLayer, wsServer, incidentIndex, normalizeCategory, graphSendMail, featureFlags, isHighSeverity, getAIModel, getSlaMap, getSlaDescription, cachedGetAll, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, MAIL_FROM, CUSTOMER_REDIRECT_TARGET, EMAIL_REDIRECT_MODE, _zdPushDedup, PROD_TEST_MODE, ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN, ZENDESK_WEBHOOK_SECRET } = ctx;

  if (!pathname.startsWith("/api/zendesk")) return false;

  // ─── Phase 8.1: RBAC enforcement on Zendesk routes ──────────────
  // Webhook endpoint is public (handled by PUBLIC_PREFIXES in authMiddleware).
  // All other Zendesk routes require authentication + role-based access.
  const isWebhook = pathname === "/api/zendesk/webhook";
  if (!isWebhook) {
    if (!authResult?.authenticated) {
      return json(res, 401, { error: "Authentication required" });
    }
    const role = authResult?.role || auth?.role || "anonymous";
    // Write operations: POST/PUT/DELETE — require manage-level incident access
    const WRITE_ROLES = new Set([
      "System",
      "VGC Dev Admin", "Tenant Admin", "Administrator",
      "Service Desk Lead", "L1 Support Engineer", "L2 Support Engineer",
      "Network Engineer",
    ]);
    const READ_ROLES = new Set([
      ...WRITE_ROLES, "Change Manager", "Problem Manager",
      "Asset Manager", "Read Only",
    ]);
    const isWrite = req.method === "POST" || req.method === "PUT" || req.method === "DELETE";
    if (isWrite && !WRITE_ROLES.has(role)) {
      return json(res, 403, { error: "Insufficient permissions for Zendesk write operations" });
    }
    if (!isWrite && !READ_ROLES.has(role)) {
      return json(res, 403, { error: "Insufficient permissions for Zendesk access" });
    }
  }

  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
    return json(res, 503, { error: "Zendesk not configured. Set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN." });
  }
  const zdBase = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
  const zdAuth = "Basic " + Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString("base64");

  const zdRequestOnce = (method, zdPath, body) => new Promise((resolve, reject) => {
    const url = new URL(zdBase + zdPath);
    const opts = {
      hostname: url.hostname, port: 443, path: url.pathname + url.search,
      method, headers: { "Authorization": zdAuth, "Content-Type": "application/json" },
    };
    const r = https.request(opts, (resp) => {
      let data = ""; resp.on("data", c => data += c);
      resp.on("end", () => {
        if (resp.statusCode === 429) {
          const retryAfter = parseInt(resp.headers["retry-after"] || "10", 10);
          reject({ status: 429, retryAfter });
        } else if (resp.statusCode >= 200 && resp.statusCode < 300) {
          resolve(data ? JSON.parse(data) : {});
        } else {
          reject(new Error(`Zendesk ${resp.statusCode}: ${data.substring(0, 500)}`));
        }
      });
    });
    r.on("error", reject);
    r.setTimeout(30000, () => { r.destroy(); reject(new Error("Zendesk API timeout")); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });

  const zdRequest = async (method, zdPath, body) => {
    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await zdRequestOnce(method, zdPath, body);
      } catch (err) {
        if (err.status === 429 && attempt < maxRetries) {
          const wait = Math.min((err.retryAfter || 10) * 1000, 60000);
          console.log(`[ZD] Rate limited, retrying in ${wait / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(r => setTimeout(r, wait));
        } else if (err.status === 429) {
          throw new Error(`Zendesk rate limited after ${maxRetries} retries`);
        } else {
          throw err;
        }
      }
    }
  };

  try {
      // Phase 8.3: Input validation helpers
      const VALID_ZD_STATUSES = new Set(["new", "open", "pending", "hold", "solved", "closed"]);
      const VALID_ZD_PRIORITIES = new Set(["urgent", "high", "normal", "low"]);
      const isValidTicketId = (id) => /^\d{1,15}$/.test(String(id));

      // ─── v3.23.0: Centralized Zendesk→ITSM sync helper ───────────────
      // Single source-of-truth used by webhook, sync-ticket, incremental sync, stale-check.
      // Tracks SLA pause for BOTH "Pending" and "On Hold" (Zendesk's two paused states),
      // anchors slaStartAt/firstResponseAt/resolvedAt to ZD timestamps, and captures
      // ZD metric_set business-hour values into inc.zdMetrics for accurate SLA reporting.
      const ZD_STATUS_MAP = { "new": "New", "open": "Open", "pending": "Pending", "hold": "On Hold", "solved": "Resolved", "closed": "Closed" };
      const ZD_PRIORITY_MAP = { "urgent": "Sev-A", "high": "Sev-B", "normal": "Sev-C", "low": "Sev-D" };
      const ZD_PAUSE_STATES = new Set(["Pending", "On Hold"]);
      function applyZendeskTicketSync(inc, t, ms, source) {
        if (!inc || !t) return false;
        const safeMs = ms || {};
        const newStatus = ZD_STATUS_MAP[t.status];
        const newPriority = ZD_PRIORITY_MAP[t.priority];
        let changed = false;
        // Status with SLA pause/resume tracking (Pending OR On Hold == paused)
        if (newStatus && newStatus !== inc.status) {
          inc.slaPauseHistory = inc.slaPauseHistory || [];
          const wasPaused = ZD_PAUSE_STATES.has(inc.status);
          const isPaused = ZD_PAUSE_STATES.has(newStatus);
          const nowIso = new Date().toISOString();
          if (isPaused && !wasPaused) {
            inc.slaPauseHistory.push({ pausedAt: nowIso, reason: `Zendesk status → ${t.status} (${source})` });
          } else if (!isPaused && wasPaused) {
            const last = inc.slaPauseHistory[inc.slaPauseHistory.length - 1];
            if (last && !last.resumedAt) last.resumedAt = nowIso;
          }
          inc.status = newStatus; changed = true;
        }
        if (newPriority && newPriority !== inc.priority) { inc.priority = newPriority; changed = true; }
        // Anchor SLA timestamps to Zendesk source-of-truth
        const fpc = t.first_public_comment_at || safeMs.first_public_comment_at || null;
        const solved = t.solved_at || safeMs.solved_at || null;
        if (t.created_at && inc.slaStartAt !== t.created_at) { inc.slaStartAt = t.created_at; changed = true; }
        if (fpc && inc.firstResponseAt !== fpc) { inc.firstResponseAt = fpc; changed = true; }
        if (solved && inc.resolvedAt !== solved) { inc.resolvedAt = solved; changed = true; }
        // v3.23: capture Zendesk business-hour metrics for accurate SLA.
        // CRITICAL: only store BUSINESS-hour values in `*BizMin` fields. Falling back to
        // calendar minutes here would cause computeSlaStatus to treat 24h calendar time
        // as 24h business time → massive over-count for tickets ZD hasn't computed biz metrics for yet.
        const pickBiz = (block) => (block && Number.isFinite(block.business)) ? block.business : null;
        const newMetrics = {
          replyTimeBizMin: pickBiz(safeMs.reply_time_in_minutes),
          fullResolutionBizMin: pickBiz(safeMs.full_resolution_time_in_minutes),
          agentWaitBizMin: pickBiz(safeMs.agent_wait_time_in_minutes),
          requesterWaitBizMin: pickBiz(safeMs.requester_wait_time_in_minutes),
          onHoldBizMin: pickBiz(safeMs.on_hold_time_in_minutes),
          updatedAt: t.updated_at || null,
          source,
        };
        // Skip the metrics update entirely when ZD provided no business numbers AND no prior metrics —
        // avoids writing a dummy all-null zdMetrics object that adds no information.
        const allNull = newMetrics.replyTimeBizMin == null
          && newMetrics.fullResolutionBizMin == null
          && newMetrics.agentWaitBizMin == null
          && newMetrics.requesterWaitBizMin == null
          && newMetrics.onHoldBizMin == null;
        const prev = inc.zdMetrics || {};
        const hadPrev = !!inc.zdMetrics;
        if (!(allNull && !hadPrev)) {
          if (prev.replyTimeBizMin !== newMetrics.replyTimeBizMin
              || prev.fullResolutionBizMin !== newMetrics.fullResolutionBizMin
              || prev.agentWaitBizMin !== newMetrics.agentWaitBizMin
              || prev.requesterWaitBizMin !== newMetrics.requesterWaitBizMin
              || prev.onHoldBizMin !== newMetrics.onHoldBizMin) {
            inc.zdMetrics = newMetrics;
            changed = true;
          }
        }
        if (changed) inc.zdLastSync = new Date().toISOString();
        return changed;
      }

      if (pathname === "/api/zendesk/me" && req.method === "GET") {
        const result = await zdRequest("GET", "/users/me.json");
        return json(res, 200, result);
      }

      // GET /api/zendesk/tickets?page=1&per_page=25&status=open&sort_by=created_at&sort_order=desc
      if (pathname === "/api/zendesk/tickets" && req.method === "GET") {
        const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const page = qs.get("page") || "1";
        const perPage = Math.min(parseInt(qs.get("per_page") || "25"), 100);
        const status = qs.get("status") || "";
        const sortBy = qs.get("sort_by") || "created_at";
        const sortOrder = qs.get("sort_order") || "desc";
        let zdPath = `/tickets.json?page=${page}&per_page=${perPage}&sort_by=${sortBy}&sort_order=${sortOrder}`;
        if (status) zdPath = `/search.json?query=type:ticket status:${encodeURIComponent(status)}&page=${page}&per_page=${perPage}&sort_by=${sortBy}&sort_order=${sortOrder}`;
        const result = await zdRequest("GET", zdPath);
        return json(res, 200, result);
      }

      // GET /api/zendesk/tickets/:id
      if (pathname.match(/^\/api\/zendesk\/tickets\/\d+$/) && req.method === "GET") {
        const ticketId = pathname.split("/").pop();
        if (!isValidTicketId(ticketId)) return json(res, 400, { error: "Invalid ticket ID" });
        const result = await zdRequest("GET", `/tickets/${ticketId}.json`);
        return json(res, 200, result);
      }

      // v3.13 Layer 2: POST /api/zendesk/sync-ticket/:id — on-demand single-ticket pull (used before AI triage)
      if (pathname.match(/^\/api\/zendesk\/sync-ticket\/\d+$/) && req.method === "POST") {
        const ticketId = pathname.split("/").pop();
        if (!isValidTicketId(ticketId)) return json(res, 400, { error: "Invalid ticket ID" });
        try {
          const result = await zdRequest("GET", `/tickets/${ticketId}.json?include=metric_sets`);
          const t = result.ticket;
          if (!t) return json(res, 404, { error: "Ticket not found in Zendesk" });
          const ms = (result.metric_sets && result.metric_sets[0]) || t.metric_set || {};
          const ticketData = {
            id: t.id, subject: t.subject, description: t.description,
            status: t.status, priority: t.priority || "normal", type: t.type,
            tags: t.tags || [], requesterId: t.requester_id, assigneeId: t.assignee_id,
            organizationId: t.organization_id, groupId: t.group_id,
            createdAt: t.created_at, updatedAt: t.updated_at,
            channel: t.via?.channel || "unknown",
            importedAt: new Date().toISOString(), source: "on_demand_sync",
          };
          await db.upsert("zendesk_tickets", String(t.id), JSON.stringify(ticketData));
          let updated = false, incId = null;
          const linked = incidentIndex && incidentIndex.getByZdTicketId ? incidentIndex.getByZdTicketId(t.id) : null;
          if (linked) {
            const inc = linked;
            updated = applyZendeskTicketSync(inc, t, ms, "on_demand_sync");
            if (updated) {
              await db.upsert("incidents", inc.id, JSON.stringify(inc));
            }
            incId = inc.id;
          }
          return json(res, 200, { ok: true, updated, incidentId: incId, zdTicketId: t.id });
        } catch (e) {
          console.warn(`[ZD sync-ticket] failed for ${ticketId}:`, e.message);
          return json(res, 502, { error: "Zendesk sync failed", detail: e.message });
        }
      }

      // GET /api/zendesk/tickets/:id/comments
      if (pathname.match(/^\/api\/zendesk\/tickets\/\d+\/comments$/) && req.method === "GET") {
        const ticketId = pathname.split("/")[4];
        if (!isValidTicketId(ticketId)) return json(res, 400, { error: "Invalid ticket ID" });
        const result = await zdRequest("GET", `/tickets/${ticketId}/comments.json`);
        // Resolve author_id numbers to display names (read-only, graceful fallback)
        const authorIds = [...new Set((result.comments || []).map(c => c.author_id).filter(Boolean))];
        if (authorIds.length > 0) {
          try {
            const u = await zdRequest("GET", `/users/show_many.json?ids=${authorIds.join(",")}`);
            const m = {}; (u.users || []).forEach(x => { m[x.id] = x.name; });
            (result.comments || []).forEach(c => { c.author_name = m[c.author_id] || null; });
          } catch (e) { /* silent fallback */ }
        }
        return json(res, 200, result);
      }

      // PUT /api/zendesk/tickets/:id — update ticket (status, priority, comment)
      if (pathname.match(/^\/api\/zendesk\/tickets\/\d+$/) && req.method === "PUT") {
        const ticketId = pathname.split("/").pop();
        if (!isValidTicketId(ticketId)) return json(res, 400, { error: "Invalid ticket ID" });
        const body = await parseBody(req);
        // Phase 8.3: Validate status/priority if provided
        if (body?.ticket?.status && !VALID_ZD_STATUSES.has(body.ticket.status)) {
          return json(res, 400, { error: `Invalid status. Allowed: ${[...VALID_ZD_STATUSES].join(", ")}` });
        }
        if (body?.ticket?.priority && !VALID_ZD_PRIORITIES.has(body.ticket.priority)) {
          return json(res, 400, { error: `Invalid priority. Allowed: ${[...VALID_ZD_PRIORITIES].join(", ")}` });
        }
        const result = await zdRequest("PUT", `/tickets/${ticketId}.json`, body);
        return json(res, 200, result);
      }

      // POST /api/zendesk/tickets — create new ticket
      if (pathname === "/api/zendesk/tickets" && req.method === "POST") {
        const body = await parseBody(req);
        // Phase 8.3: Require subject for new tickets
        if (!body?.ticket?.subject || typeof body.ticket.subject !== "string" || body.ticket.subject.trim().length === 0) {
          return json(res, 400, { error: "Ticket subject is required" });
        }
        if (body.ticket.priority && !VALID_ZD_PRIORITIES.has(body.ticket.priority)) {
          return json(res, 400, { error: `Invalid priority. Allowed: ${[...VALID_ZD_PRIORITIES].join(", ")}` });
        }
        const result = await zdRequest("POST", "/tickets.json", body);
        return json(res, 200, result);
      }

      // GET /api/zendesk/groups
      if (pathname === "/api/zendesk/groups" && req.method === "GET") {
        const result = await zdRequest("GET", "/groups.json");
        return json(res, 200, result);
      }

      // GET /api/zendesk/users?role=agent
      if (pathname === "/api/zendesk/users" && req.method === "GET") {
        const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const role = qs.get("role") || "";
        const zdPath = role ? `/users.json?role=${encodeURIComponent(role)}` : "/users.json";
        const result = await zdRequest("GET", zdPath);
        return json(res, 200, result);
      }

      // GET /api/zendesk/stats — ticket counts by status (Phase 9.5: cached 120s)
      if (pathname === "/api/zendesk/stats" && req.method === "GET") {
        const cacheKey = "zd_stats";
        const cached = cacheLayer && cacheLayer.get(cacheKey);
        if (cached) return json(res, 200, cached);
        const [open, pending, hold, solved] = await Promise.all([
          zdRequest("GET", "/search.json?query=type:ticket status:open").catch(() => ({ count: 0 })),
          zdRequest("GET", "/search.json?query=type:ticket status:pending").catch(() => ({ count: 0 })),
          zdRequest("GET", "/search.json?query=type:ticket status:hold").catch(() => ({ count: 0 })),
          zdRequest("GET", "/search.json?query=type:ticket status:solved").catch(() => ({ count: 0 })),
        ]);
        const stats = { open: open.count || 0, pending: pending.count || 0, hold: hold.count || 0, solved: solved.count || 0 };
        if (cacheLayer) cacheLayer.set(cacheKey, stats, 120000); // 2 minute TTL
        return json(res, 200, stats);
      }

      // POST /api/zendesk/auto-triage — AI auto-triage a ticket (server-side for automation)
      if (pathname === "/api/zendesk/auto-triage" && req.method === "POST") {
        if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
          return json(res, 503, { error: "Azure OpenAI not configured" });
        }
        const body = await parseBody(req, 100000);
        const { ticketId } = body;
        if (!ticketId || !isValidTicketId(ticketId)) return json(res, 400, { error: "Valid numeric ticketId required" });

        // Fetch ticket + comments + requester from Zendesk
        const ticket = await zdRequest("GET", `/tickets/${ticketId}.json`);
        const comments = await zdRequest("GET", `/tickets/${ticketId}/comments.json`).catch(() => ({ comments: [] }));
        const lastComment = (comments.comments || []).slice(-1)[0]?.body || "";
        // Build recent comments array (last 3) with author info
        const allComments = comments.comments || [];
        const recentComments = allComments.slice(-3).map(c => ({
          body: (c.body || "").substring(0, 1000),
          author: c.author_id,
          createdAt: c.created_at,
          isPublic: c.public !== false,
        }));
        // Resolve comment author names
        const authorIds = [...new Set(recentComments.map(c => c.author).filter(Boolean))];
        const authorMap = {};
        for (const aid of authorIds) {
          try {
            const u = await zdRequest("GET", `/users/${aid}.json`);
            if (u?.user) authorMap[aid] = { name: u.user.name, email: u.user.email, role: u.user.role };
          } catch { /* ignore */ }
        }
        for (const c of recentComments) {
          const a = authorMap[c.author];
          c.authorName = a?.name || `User ${c.author}`;
          c.authorRole = a?.role || "unknown";
        }
        // Fetch requester info for ITSM incident mapping
        let requester = null;
        if (ticket.ticket?.requester_id) {
          try {
            const reqData = await zdRequest("GET", `/users/${ticket.ticket.requester_id}.json`);
            requester = reqData?.user || null;
          } catch { /* ignore */ }
        }
        // Fetch Zendesk organization info
        let zdOrg = null;
        const orgId = requester?.organization_id || ticket.ticket?.organization_id;
        if (orgId) {
          try {
            const orgData = await zdRequest("GET", `/organizations/${orgId}.json`);
            zdOrg = orgData?.organization ? { name: orgData.organization.name, domains: orgData.organization.domain_names || [] } : null;
          } catch { /* ignore */ }
        }
        // Match ITSM customer by org name or requester email domain
        let itsmCustomer = null;
        try {
          const custRows = await db.getAll("customers");
          const reqDomain = (requester?.email || "").split("@")[1]?.toLowerCase();
          const orgName = (zdOrg?.name || "").toLowerCase();
          for (const row of custRows) {
            const cust = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
            if (!cust) continue;
            const custDomain = (cust.email || "").split("@")[1]?.toLowerCase();
            const custName = (cust.company || cust.name || "").toLowerCase();
            if ((reqDomain && custDomain && reqDomain === custDomain) || (orgName && custName && orgName.includes(custName))) {
              itsmCustomer = { name: cust.company || cust.name, category: cust.category, contract: cust.contract || cust.contractType, services: cust.services };
              break;
            }
          }
        } catch { /* ignore */ }
        // Count historical tickets from same requester
        let historicalTicketCount = 0;
        let lastTicketDate = null;
        if (requester?.email) {
          try {
            const histSearch = await zdRequest("GET", `/search.json?query=type:ticket requester:${encodeURIComponent(requester.email)}&sort_by=created_at&sort_order=desc&per_page=5`);
            const histResults = histSearch?.results || [];
            historicalTicketCount = histSearch?.count || histResults.length;
            if (histResults.length > 1) lastTicketDate = histResults[1]?.created_at; // [0] is current ticket
          } catch { /* ignore */ }
        }
        // SLA target hours mapping
        const slaHoursMap = { "Sev-A": 4, "Sev-B": 4, "Sev-C": 9, "Sev-D": 27 };

        const systemPrompt = `You are an expert IT support AI for VGC Technology Pte Ltd — a managed IT services company.
Analyze the support ticket and return a JSON object with:
1. category — one of: Network, Security, Hardware, Software, Email, Cloud, Access/Identity, Printing, General
2. priority — one of: low, normal, high, urgent  
3. tags — array of relevant tags
4. draft_response — professional customer-facing response (150-250 words), signed "VGC Technology Service Desk"
5. internal_note — brief internal analysis for the agent
6. confidence — 0-100 how confident you are
7. suggested_assignee — one of: L1 Support, L2 Support, Network Engineering, Security Team, based on complexity
8. auto_sendable — true if confidence >= 85 AND the response is safe to send without human review
9. itsm_category — ITIL category mapping
10. sla_priority — ${getSlaDescription()}
11. sentiment — one of: frustrated, neutral, satisfied (analyze customer tone)
12. sentimentScore — 1-10 (1=very negative, 5=neutral, 10=very positive)

IMPORTANT: Set auto_sendable=true ONLY for routine issues (password resets, basic how-to, status inquiries, simple troubleshooting). 
Set auto_sendable=false for: security incidents, data loss, system outages, escalations, angry customers, complex issues.
For sentiment: analyze the customer's tone from description and comments. Frustrated customers should get auto_sendable=false.

Respond ONLY with valid JSON, no markdown.`;

        const userPrompt = `Ticket #${ticketId}
Subject: ${ticket.ticket?.subject || "No subject"}
Status: ${ticket.ticket?.status}
Priority: ${ticket.ticket?.priority || "not set"}
Created: ${ticket.ticket?.created_at}
Description: ${ticket.ticket?.description || "No description"}
${lastComment ? `\nLatest comment:\n${lastComment.substring(0, 1500)}` : ""}`;

        const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 1500 };

        const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
        const aiResult = await new Promise((resolve, reject) => {
          const aiReq = https.request({
            hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
            method: "POST", headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY },
          }, (aiRes) => {
            let data = ""; aiRes.on("data", c => data += c);
            aiRes.on("end", () => {
              if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
              else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
            });
          });
          aiReq.on("error", reject);
          aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
          aiReq.write(JSON.stringify(payload));
          aiReq.end();
        });

        const text = extractAIText(aiResult);
        let parsed;
        try {
          parsed = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
        } catch {
          parsed = { category: "General", priority: "normal", tags: [], draft_response: text, internal_note: "Unstructured AI response", confidence: 50, suggested_assignee: "L1 Support", auto_sendable: false, itsm_category: "General", sla_priority: "Sev-D", sentiment: "neutral", sentimentScore: 5 };
        }

        const slaPri = parsed.sla_priority || "Sev-D";
        const slaTargetHours = slaHoursMap[slaPri] || 9;
        return json(res, 200, {
          triage: parsed, ticket: ticket.ticket,
          requester: requester ? { name: requester.name, email: requester.email, phone: requester.phone, organization_id: requester.organization_id } : null,
          ticketDescription: (ticket.ticket?.description || "").substring(0, 3000),
          recentComments,
          organization: zdOrg,
          itsmCustomer,
          historicalTicketCount,
          lastTicketDate,
          slaTargetHours,
        });
      }

      // POST /api/zendesk/create-incident — centralized, deduped, priority-filtered incident creation
      if (pathname === "/api/zendesk/create-incident" && req.method === "POST") {
        const body = await parseBody(req);
        const { ticketId, subject, description, priority, slaPriority, category, assignee, requesterName, requesterEmail, confidence, internalNote } = body;
        if (!ticketId || !isValidTicketId(ticketId)) return json(res, 400, { error: "Valid numeric ticketId required" });

        // Only allow Sev-A/Sev-B
        const _slaPri = slaPriority || "Sev-D";
        if (_slaPri !== "Sev-A" && _slaPri !== "Sev-B") {
          return json(res, 200, { skipped: true, reason: `${_slaPri} tickets do not require ITSM incidents` });
        }

        // Dedup: check if incident already exists for this ticket
        const existing = await db.getOne("incidents", `INC-ZD${ticketId}`);
        if (existing) {
          return json(res, 200, { skipped: true, reason: "Incident already exists", incident: JSON.parse(existing.data) });
        }
        // Phase 9.4: Use index for O(1) dedup by zdTicketId (fallback to scan)
        const _idxMatch = incidentIndex && incidentIndex.getByZdTicketId(ticketId);
        if (_idxMatch) {
          return json(res, 200, { skipped: true, reason: "Incident already exists (by zdTicketId)", incident: _idxMatch });
        }
        if (!_idxMatch) {
          const allIncs = await db.getAll("incidents");
          const dupInc = allIncs.find(i => { try { const d = JSON.parse(i.data); return String(d.zdTicketId) === String(ticketId); } catch { return false; } });
          if (dupInc) {
            return json(res, 200, { skipped: true, reason: "Incident already exists (by zdTicketId)", incident: JSON.parse(dupInc.data) });
          }
        }

        const slaMap = getSlaMap();
        const urgencyMap = { urgent: "Critical", high: "High", normal: "Medium", low: "Low" };
        const impactMap = { urgent: "Enterprise", high: "Department", normal: "Multiple Users", low: "Single User" };
        const assignmentGroup = assignee === "Network Engineering" ? "Network Engineering" : assignee === "Security Team" ? "Security Operations" : "Service Desk";
        const newInc = {
          id: `INC-ZD${ticketId}`, title: `[ZD#${ticketId}] ${subject || "Zendesk Ticket"}`,
          priority: _slaPri, status: "Open",
          category: category || "General", subcategory: "",
          urgency: urgencyMap[priority] || "Medium",
          impact: impactMap[priority] || "Single User",
          assignee: assignee || "Unassigned", assignmentGroup,
          reporter: requesterName || "Zendesk", reporterEmail: requesterEmail || "",
          customer: requesterName || "", contactMethod: "Zendesk",
          description: description || "",
          created: 0, slaTarget: slaMap[_slaPri] || 4,
          aiTriaged: true, aiConfidence: confidence || 75,
          zdTicketId: ticketId, workaround: "", linkedProblem: "",
          affectedAssets: [],
          activityLog: [
            { id: `AL-CI-${ticketId}`, type: "status", user: "AI Engine", time: new Date().toISOString(), detail: `Auto-created from Zendesk #${ticketId} — AI Triage (${confidence || 0}% confidence, ${priority} priority)` },
            ...(internalNote ? [{ id: `AL-CI-N-${ticketId}`, type: "note", user: "AI Engine", time: new Date().toISOString(), detail: internalNote, isInternal: true, body: internalNote }] : []),
          ],
        };
        await db.upsert("incidents", newInc.id, JSON.stringify(newInc));
        console.log(`[ZD Create-Incident] Created ITSM ${newInc.id} from Zendesk #${ticketId} (${_slaPri})`);
        return json(res, 201, { success: true, incident: newInc });
      }

      // POST /api/zendesk/ai-solve — guarded AI solve flow with no public customer comment
      if (pathname === "/api/zendesk/ai-solve" && req.method === "POST") {
        const flagCtx = { userEmail: authResult?.user?.email || authResult?.user?.upn || auth?.email };
        if (featureFlags?.isEnabled && !featureFlags.isEnabled("zendesk_ai_safe_solve", flagCtx)) {
          return json(res, 403, { error: "Zendesk AI Safe Solve is disabled" });
        }
        if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
          return json(res, 503, { error: "Azure OpenAI not configured" });
        }

        const body = await parseBody(req, 100000).catch(() => ({}));
        const { ticketId } = body;
        if (!ticketId || !isValidTicketId(ticketId)) return json(res, 400, { error: "Valid numeric ticketId required" });
        const dryRun = body.dryRun !== false;
        const requestedBy = body.requestedBy || authResult?.user?.email || authResult?.user?.name || "AI Safe Solve";
        if (!dryRun && body.confirmSafety !== true) {
          return json(res, 400, { error: "confirmSafety=true required to apply AI Safe Solve" });
        }

        const ticketResult = await zdRequest("GET", `/tickets/${ticketId}.json`);
        const ticket = ticketResult.ticket || {};
        const commentsResult = await zdRequest("GET", `/tickets/${ticketId}/comments.json`).catch(() => ({ comments: [] }));
        const recentComments = (commentsResult.comments || []).slice(-5).map(c => ({
          body: (c.body || c.plain_body || "").substring(0, 1200),
          author: c.author_id,
          createdAt: c.created_at,
          isPublic: c.public !== false,
        }));
        let requester = null;
        if (ticket.requester_id) {
          try {
            const requesterResult = await zdRequest("GET", `/users/${ticket.requester_id}.json`);
            requester = requesterResult.user || null;
          } catch { /* ignore */ }
        }

        const flagPayload = featureFlags?.payload ? featureFlags.payload("zendesk_ai_safe_solve") || {} : {};
        const userPrompt = `Ticket #${ticketId}\nSubject: ${ticket.subject || "No subject"}\nStatus: ${ticket.status}\nPriority: ${ticket.priority || "not set"}\nRequester: ${requester?.name || "unknown"} <${requester?.email || "unknown"}>\nCreated: ${ticket.created_at}\nDescription:\n${(ticket.description || "").substring(0, 2200)}\n\nRecent comments:\n${recentComments.map(c => `- ${stripHtml(c.body).substring(0, 700)}`).join("\n") || "(none)"}`;
        const systemPrompt = `You are the VGC ITSM AI Safe Solve policy engine. Decide whether this Zendesk ticket can be solved safely without disturbing the real customer.
Return ONLY valid JSON with: category, priority (low|normal|high|urgent), sla_priority (Sev-A|Sev-B|Sev-C|Sev-D), confidence (0-100), auto_sendable (boolean), routine (boolean), sentiment (frustrated|neutral|satisfied), sentimentScore (1-10), resolution, customer_response, internal_note, risk_flags array.
Allow auto_sendable only for routine IT support issues with a concrete, low-risk resolution. Set auto_sendable false for security, data loss, outage, VIP/executive, legal/billing, angry/frustrated customer, major priority, unclear root cause, or missing information.`;
        const aiPayload = { model: getAIModel("secondary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 1400 };
        const aiUrl = new URL(AZURE_OPENAI_ENDPOINT);
        const aiResult = await new Promise((resolve, reject) => {
          const aiReq = https.request({
            hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
            method: "POST", headers: { "Content-Type": "application/json", "api-key": AZURE_OPENAI_KEY },
          }, (aiRes) => {
            let data = "";
            aiRes.on("data", c => data += c);
            aiRes.on("end", () => {
              if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
              else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
            });
          });
          aiReq.on("error", reject);
          aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
          aiReq.write(JSON.stringify(aiPayload));
          aiReq.end();
        });

        const aiText = extractAIText(aiResult);
        let triage;
        try {
          triage = JSON.parse(aiText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
        } catch {
          triage = { confidence: 0, auto_sendable: false, routine: false, resolution: "", customer_response: "", internal_note: "AI response could not be parsed; routed to engineer review.", risk_flags: ["parse_failure"] };
        }

        const decision = buildZendeskSafeSolveDecision({
          triage, ticket, requester, recentComments,
          customerRedirectTarget: CUSTOMER_REDIRECT_TARGET || DEFAULT_CUSTOMER_REDIRECT_TARGET,
          emailRedirectMode: EMAIL_REDIRECT_MODE,
          slaTargetHours: flagPayload.slaTargetHours,
          options: {
            confidenceThreshold: body.confidenceThreshold || flagPayload.confidenceThreshold,
            solveThreshold: body.solveThreshold || flagPayload.solveThreshold,
            atRiskMinutes: body.atRiskMinutes || flagPayload.atRiskMinutes,
            sendCustomerEmail: body.sendCustomerEmail === true,
          },
        });
        const auditId = `ZDSAFE-${ticketId}-${Date.now()}`;
        const baseResponse = {
          success: decision.eligible,
          dryRun,
          applied: false,
          auditId,
          ticket: { id: ticket.id, subject: ticket.subject, status: ticket.status, priority: ticket.priority, created_at: ticket.created_at },
          requester: requester ? { id: requester.id, name: requester.name, email: requester.email } : null,
          triage,
          decision,
        };

        if (dryRun || !decision.eligible) {
          try {
            await db.upsert("zd_ai_safe_solve", auditId, JSON.stringify({ id: auditId, ticketId, dryRun: true, eligible: decision.eligible, decision, requestedBy, createdAt: new Date().toISOString() }));
          } catch { /* ignore */ }
          return json(res, 200, baseResponse);
        }

        const appliedActions = [];
        const applyPayload = buildZendeskSafeSolveApplyPayload(decision, { requestedBy });
        const updateResult = await zdRequest("PUT", `/tickets/${ticketId}.json`, applyPayload);
        appliedActions.push("internal_zendesk_note_added", `zendesk_status_${decision.targetStatus}`);

        let emailResult = null;
        if (decision.customerEmailPlanned && graphSendMail) {
          try {
            await graphSendMail({
              to: decision.safeCustomerContact.customerEmailTarget,
              subject: `AI Safe Solve: ${ticket.subject || `Ticket #${ticketId}`} [#${ticketId}]`,
              body: buildSafeSolveEmailBody({ decision, ticket, requester, requestedBy }),
              isCustomerEmail: true,
            });
            emailResult = { sent: true, to: decision.safeCustomerContact.customerEmailTarget };
            appliedActions.push("customer_email_routed_to_safe_target");
          } catch (emailErr) {
            emailResult = { sent: false, error: emailErr.message, to: decision.safeCustomerContact.customerEmailTarget };
          }
        }

        let linkedIncident = null;
        try {
          const existingRow = await db.getOne("incidents", `INC-ZD${ticketId}`);
          if (existingRow) {
            const inc = typeof existingRow.data === "string" ? JSON.parse(existingRow.data) : existingRow.data;
            inc.status = decision.targetStatus === "solved" ? "Resolved" : "Pending";
            inc.resolution = decision.resolution || inc.resolution;
            inc.resolvedAt = decision.targetStatus === "solved" ? new Date().toISOString() : inc.resolvedAt;
            inc.aiSafeSolved = decision.targetStatus === "solved";
            inc.skipZendeskSync = true;
            inc.updatedAt = new Date().toISOString();
            inc.activityLog = [...(inc.activityLog || []), { id: `AL-ZDSAFE-${Date.now()}`, type: "ai_solve", user: "AI Safe Solve", time: inc.updatedAt, detail: `AI Safe Solve applied to Zendesk #${ticketId}: ${decision.decision}, ${decision.confidence}% confidence. No public customer comment.` }];
            await db.upsert("incidents", inc.id, JSON.stringify(inc));
            linkedIncident = { id: inc.id, status: inc.status };
            appliedActions.push("linked_itsm_incident_updated");
          }
        } catch (incErr) {
          appliedActions.push(`linked_incident_update_failed:${incErr.message}`);
        }

        const auditRecord = { id: auditId, ticketId, requestedBy, dryRun: false, eligible: true, decision, appliedActions, emailResult, linkedIncident, createdAt: new Date().toISOString() };
        await db.upsert("zd_ai_safe_solve", auditId, JSON.stringify(auditRecord));
        try { await db.audit("zd_ai_safe_solve", auditId, "apply", JSON.stringify({ ticketId, decision: decision.decision, confidence: decision.confidence, targetStatus: decision.targetStatus, publicComment: false }), requestedBy); } catch { /* ignore */ }
        try { wsServer && wsServer.broadcast && wsServer.broadcast("zendesk/ai-safe-solve", { ticketId, decision: decision.decision, targetStatus: decision.targetStatus, auditId }); } catch { /* ignore */ }

        return json(res, 200, { ...baseResponse, success: true, applied: true, appliedActions, updateResult, email: emailResult, linkedIncident });
      }

      // POST /api/zendesk/auto-respond — send AI response to ticket (REQUIRES human approval)
      if (pathname === "/api/zendesk/auto-respond" && req.method === "POST") {
        const body = await parseBody(req);
        const { ticketId, response, priority, tags, internalNote, approvedBy } = body;
        if (!ticketId || !response) return json(res, 400, { error: "ticketId and response required" });
        if (!approvedBy) return json(res, 403, { error: "Human approval required — approvedBy field is mandatory. No auto-sending allowed." });

        const updatePayload = {
          ticket: {
            comment: zendeskInternalComment(response),
            ...(priority ? { priority } : {}),
            ...(tags && tags.length > 0 ? { tags } : {}),
          }
        };
        const result = await zdRequest("PUT", `/tickets/${ticketId}.json`, updatePayload);
        
        // Add internal note with approval audit trail
        const auditNote = `[AI Response — Approved by ${approvedBy}]\n${internalNote || "No additional analysis notes."}`;
        await zdRequest("PUT", `/tickets/${ticketId}.json`, {
          ticket: { comment: zendeskInternalComment(auditNote) }
        }).catch(() => {});

        // Also send email via M365 Graph to the ticket requester
        let emailResult = null;
        try {
          const ticket = await zdRequest("GET", `/tickets/${ticketId}.json`);
          const requesterId = ticket?.ticket?.requester_id;
          if (requesterId) {
            const requester = await zdRequest("GET", `/users/${requesterId}.json`);
            const requesterEmail = requester?.user?.email;
            const ticketSubject = ticket?.ticket?.subject || `Ticket #${ticketId} Response`;
            if (requesterEmail) {
              // Route all customer notification emails to designated IT support contact
              const notificationRecipient = "johndoe@vgcsg.com";
              const htmlBody = `<div style="font-family:Arial,sans-serif;max-width:600px;">
                <h3 style="color:#1a1a2e;">Re: ${ticketSubject}</h3>
                <div style="background:#f8f9fa;padding:16px;border-radius:8px;border-left:4px solid #4CAF50;margin:12px 0;">
                  ${response.replace(/\n/g, "<br/>")}
                </div>
                <hr style="border:none;border-top:1px solid #eee;margin:20px 0;"/>
                <p style="color:#666;font-size:12px;">This response was reviewed and approved by ${approvedBy}.<br/>
                Ticket Reference: #${ticketId} | Original requester: ${requesterEmail}<br/>
                VGC IT Support — <a href="mailto:${MAIL_FROM}">${MAIL_FROM}</a></p>
              </div>`;
              await graphSendMail({ to: notificationRecipient, subject: `Re: ${ticketSubject} [#${ticketId}]`, body: htmlBody, isCustomerEmail: true });
              emailResult = { sent: true, to: notificationRecipient };
              console.log(`[M365 Mail] Ticket #${ticketId} response emailed to ${notificationRecipient} (requester: ${requesterEmail})`);
            }
          }
        } catch (emailErr) {
          emailResult = { sent: false, error: emailErr.message };
          console.error(`[M365 Mail] Ticket #${ticketId} email failed: ${emailErr.message}`);
        }

        console.log(`[AUDIT] Ticket #${ticketId} response sent — approved by: ${approvedBy}`);
        return json(res, 200, { success: true, approvedBy, result, email: emailResult });
      }

      // PUT /api/zendesk/tickets/:id/status — update ticket status (e.g. set to pending after AI auto-send)
      const statusMatch = pathname.match(/^\/api\/zendesk\/tickets\/(\d+)\/status$/);
      if (statusMatch && req.method === "PUT") {
        const tktId = statusMatch[1];
        if (!isValidTicketId(tktId)) return json(res, 400, { error: "Invalid ticket ID" });
        const body = await parseBody(req);
        const { status } = body;
        if (!status || !VALID_ZD_STATUSES.has(status)) {
          return json(res, 400, { error: `Invalid status. Allowed: ${[...VALID_ZD_STATUSES].join(", ")}` });
        }
        const result = await zdRequest("PUT", `/tickets/${tktId}.json`, { ticket: { status } });
        console.log(`[ZD Status] Ticket #${tktId} status set to ${status}`);
        return json(res, 200, { success: true, ticketId: tktId, status, result });
      }

      // GET /api/zendesk/new-tickets — fetch only new/open tickets for automation polling
      if (pathname === "/api/zendesk/new-tickets" && req.method === "GET") {
        const result = await zdRequest("GET", "/search.json?query=type:ticket status:new status:open&sort_by=created_at&sort_order=desc&per_page=50");
        return json(res, 200, result);
      }

      // GET /api/zendesk/historical-tickets — cursor-based paginated fetch of ALL tickets for ITSM import
      if (pathname === "/api/zendesk/historical-tickets" && req.method === "GET") {
        const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const cursor = qs.get("cursor") || "";
        const page = parseInt(qs.get("page") || "1"); // display-only counter
        // Use cursor-based pagination (CBP) on /tickets.json — no 1000-result cap
        let zdUrl;
        if (cursor) {
          zdUrl = `/tickets.json?page[size]=100&page[after]=${encodeURIComponent(cursor)}`;
        } else {
          zdUrl = `/tickets.json?page[size]=100&sort_by=created_at&sort_order=desc`;
        }
        const result = await zdRequest("GET", zdUrl);
        const tickets = result.tickets || [];
        const hasMore = result.meta?.has_more || false;
        const nextCursor = result.meta?.after_cursor || null;
        // Batch-fetch unique requester IDs
        const requesterIds = [...new Set(tickets.map(t => t.requester_id).filter(Boolean))];
        const requesters = {};
        // Fetch in batches of 100 using show_many
        for (let i = 0; i < requesterIds.length; i += 100) {
          const batch = requesterIds.slice(i, i + 100);
          try {
            const usersResult = await zdRequest("GET", `/users/show_many.json?ids=${batch.join(",")}`);
            (usersResult.users || []).forEach(u => { requesters[u.id] = { name: u.name, email: u.email, phone: u.phone }; });
          } catch { /* ignore */ }
        }
        // Attach requester to each ticket
        const enriched = tickets.map(t => ({ ...t, requester: requesters[t.requester_id] || null }));
        return json(res, 200, { tickets: enriched, count: result.count || tickets.length, has_more: hasMore, next_cursor: nextCursor, page });
      }

      // GET /api/zendesk/agents — fetch Zendesk agents with groups
      if (pathname === "/api/zendesk/agents" && req.method === "GET") {
        const [agents, groups] = await Promise.all([
          zdRequest("GET", "/users.json?role=agent"),
          zdRequest("GET", "/groups.json"),
        ]);
        return json(res, 200, { agents: agents.users || [], groups: groups.groups || [] });
      }

      // GET /api/zendesk/organizations — fetch all organizations (customers)
      if (pathname === "/api/zendesk/organizations" && req.method === "GET") {
        const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
        const page = qs.get("page") || "1";
        const result = await zdRequest("GET", `/organizations.json?page=${page}&per_page=100`);
        return json(res, 200, result);
      }

      // GET /api/zendesk/organizations/:id — single organization
      if (pathname.match(/^\/api\/zendesk\/organizations\/\d+$/) && req.method === "GET") {
        const orgId = pathname.split("/").pop();
        const result = await zdRequest("GET", `/organizations/${orgId}.json`);
        return json(res, 200, result);
      }

      // GET /api/zendesk/organizations/:id/tickets — tickets for an org
      if (pathname.match(/^\/api\/zendesk\/organizations\/\d+\/tickets$/) && req.method === "GET") {
        const orgId = pathname.split("/")[4];
        const result = await zdRequest("GET", `/organizations/${orgId}/tickets.json`);
        return json(res, 200, result);
      }

      // GET /api/zendesk/satisfaction_ratings — CSAT data
      if (pathname === "/api/zendesk/satisfaction_ratings" && req.method === "GET") {
        const result = await zdRequest("GET", "/satisfaction_ratings.json?sort_by=created_at&sort_order=desc&per_page=100").catch(() => ({ satisfaction_ratings: [] }));
        return json(res, 200, result);
      }

      // GET /api/zendesk/ticket_fields — ticket custom fields
      if (pathname === "/api/zendesk/ticket_fields" && req.method === "GET") {
        const result = await zdRequest("GET", "/ticket_fields.json");
        return json(res, 200, result);
      }

      // GET /api/zendesk/users/:id — single user details
      if (pathname.match(/^\/api\/zendesk\/users\/\d+$/) && req.method === "GET") {
        const userId = pathname.split("/").pop();
        const result = await zdRequest("GET", `/users/${userId}.json`);
        return json(res, 200, result);
      }

      // POST /api/zendesk/sync-incident — sync an ITSM incident action to Zendesk
      if (pathname === "/api/zendesk/sync-incident" && req.method === "POST") {
        // Block outbound sync in Production Test Mode (one-way ZD→ITSM only)
        if (PROD_TEST_MODE) return json(res, 200, { skipped: true, reason: "Production Test Mode — one-way sync only (ZD→ITSM)" });
        // Phase G1+G2 — zd_push_back flag gates ALL outbound pushes
        if (!featureFlags.isEnabled("zd_push_back")) {
          try {
            const _b = await parseBody(req);
            await db.audit("zendesk_sync", String(_b && _b.zdTicketId || "unknown"), "push_suppressed_flag", JSON.stringify({ action: _b && _b.action, status: _b && _b.status }), "system");
          } catch { /* ignore */ }
          return json(res, 200, { suppressed: true, reason: "flag_off:zd_push_back" });
        }
        const body = await parseBody(req);
        const { zdTicketId, action, status, priority, comment, assignee } = body;
        if (!zdTicketId) return json(res, 400, { error: "zdTicketId required" });

        // Phase G3 — 60s duplicate-comment dedup (catches save→status→save bursts)
        if (comment) {
          const _key = `${zdTicketId}|${String(comment).trim().substring(0, 200)}`;
          const _last = _zdPushDedup.get(_key);
          if (_last && Date.now() - _last < 60_000) {
            try { await db.audit("zendesk_sync", String(zdTicketId), "push_suppressed_dedup", JSON.stringify({ action, withinSec: Math.round((Date.now()-_last)/1000) }), "system"); } catch { /* ignore */ }
            console.log(`[ZD Sync] Dedup-suppressed comment to #${zdTicketId} (within 60s)`);
            return json(res, 200, { suppressed: true, reason: "dedup_60s" });
          }
          _zdPushDedup.set(_key, Date.now());
          // GC old entries when map grows large
          if (_zdPushDedup.size > 500) {
            const cutoff = Date.now() - 120_000;
            for (const [k, t] of _zdPushDedup) if (t < cutoff) _zdPushDedup.delete(k);
          }
        }

        const priorityMap = { "Sev-A": "urgent", "Sev-B": "high", "Sev-C": "normal", "Sev-D": "low" };
        const statusMap = { "New": "new", "Open": "open", "In Progress": "open", "Pending": "pending", "On Hold": "hold", "Resolved": "solved", "Closed": "closed", "Reopened": "open" };
        const ticketUpdate = { ticket: {} };

        if (status) ticketUpdate.ticket.status = statusMap[status] || status;
        if (priority) ticketUpdate.ticket.priority = priorityMap[priority] || priority;
        if (comment) {
          ticketUpdate.ticket.comment = zendeskInternalComment(`[ITSM Sync] ${comment}`);
        }

        if (Object.keys(ticketUpdate.ticket).length === 0) {
          return json(res, 400, { error: "No changes to sync" });
        }

        const result = await zdRequest("PUT", `/tickets/${zdTicketId}.json`, ticketUpdate);
        console.log(`[ZD Sync] Ticket #${zdTicketId} updated — action: ${action}, status: ${status || '-'}, priority: ${priority || '-'}`);
        return json(res, 200, { success: true, result });
      }

      // GET /api/zendesk/ticket-updates/:id — get latest ticket state for sync back to ITSM
      if (pathname.match(/^\/api\/zendesk\/ticket-updates\/\d+$/) && req.method === "GET") {
        const ticketId = pathname.split("/").pop();
        const [ticketResult, commentsResult] = await Promise.all([
          zdRequest("GET", `/tickets/${ticketId}.json`),
          zdRequest("GET", `/tickets/${ticketId}/comments.json?sort_order=desc&per_page=5`).catch(() => ({ comments: [] })),
        ]);
        const ticket = ticketResult.ticket || {};
        const statusMap = { "new": "New", "open": "Open", "pending": "Pending", "hold": "On Hold", "solved": "Resolved", "closed": "Closed" };
        const priorityMap = { "urgent": "Sev-A", "high": "Sev-B", "normal": "Sev-C", "low": "Sev-D" };
        return json(res, 200, {
          zdTicketId: ticket.id,
          status: statusMap[ticket.status] || ticket.status,
          priority: priorityMap[ticket.priority] || "Sev-C",
          subject: ticket.subject,
          tags: ticket.tags || [],
          updatedAt: ticket.updated_at,
          assigneeId: ticket.assignee_id,
          requesterId: ticket.requester_id,
          organizationId: ticket.organization_id,
          latestComments: (commentsResult.comments || []).map(c => ({
            id: c.id, body: c.body || c.plain_body, author: c.author_id, public: c.public, createdAt: c.created_at
          })),
        });
      }

      // ═══════════════════════════════════════════════════════════════
      // FULL HISTORICAL IMPORT — Pull ALL Zendesk data into ITSM DB
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/full-import" && req.method === "POST") {
        if (ctx.zdSyncInProgress) return json(res, 409, { error: "Sync already in progress" });
        ctx.zdSyncInProgress = true;
        ctx.zdSyncStats = { tickets: 0, users: 0, orgs: 0, comments: 0, errors: 0 };

        try {
          const body = await parseBody(req);
          const includeComments = body.includeComments !== false;
          const includeUsers = body.includeUsers !== false;
          const includeOrgs = body.includeOrgs !== false;
          const createIncidents = body.createIncidents === true;

          // 1) Import ALL organizations
          if (includeOrgs) {
            let orgPage = 1; let hasMoreOrgs = true;
            while (hasMoreOrgs) {
              try {
                const orgResult = await zdRequest("GET", `/organizations.json?page=${orgPage}&per_page=100`);
                const orgs = orgResult.organizations || [];
                for (const org of orgs) {
                  await db.upsert("zendesk_orgs", String(org.id), JSON.stringify({
                    id: org.id, name: org.name, domains: org.domain_names || [],
                    tags: org.tags || [], details: org.details || "",
                    notes: org.notes || "", createdAt: org.created_at,
                    updatedAt: org.updated_at, sharedTickets: org.shared_tickets || false,
                    sharedComments: org.shared_comments || false,
                    importedAt: new Date().toISOString(), source: "zendesk_full_import",
                  }));
                  ctx.zdSyncStats.orgs++;
                }
                hasMoreOrgs = orgs.length === 100;
                orgPage++;
              } catch (e) { ctx.zdSyncStats.errors++; hasMoreOrgs = false; }
            }
            console.log(`[ZD Import] Organizations: ${ctx.zdSyncStats.orgs}`);
          }

          // 2) Import ALL users
          if (includeUsers) {
            let userPage = 1; let hasMoreUsers = true;
            while (hasMoreUsers) {
              try {
                const userResult = await zdRequest("GET", `/users.json?page=${userPage}&per_page=100`);
                const users = userResult.users || [];
                for (const u of users) {
                  await db.upsert("zendesk_users", String(u.id), JSON.stringify({
                    id: u.id, name: u.name, email: u.email, role: u.role,
                    phone: u.phone || "", organizationId: u.organization_id,
                    tags: u.tags || [], active: u.active, suspended: u.suspended,
                    createdAt: u.created_at, updatedAt: u.updated_at,
                    lastLoginAt: u.last_login_at, timeZone: u.time_zone || "",
                    importedAt: new Date().toISOString(), source: "zendesk_full_import",
                  }));
                  ctx.zdSyncStats.users++;
                }
                hasMoreUsers = users.length === 100;
                userPage++;
              } catch (e) { ctx.zdSyncStats.errors++; hasMoreUsers = false; }
            }
            console.log(`[ZD Import] Users: ${ctx.zdSyncStats.users}`);
          }

          // 3) Import ALL tickets (including closed)
          let ticketPage = 1; let hasMore = true;
          // Phase 9.4: Use incidentIndex for O(1) dedup where available, fallback to DB scan
          let _fiIncByZdId, _fiIncById;
          if (incidentIndex && incidentIndex.size() > 0) {
            _fiIncByZdId = new Set();
            _fiIncById = new Set();
            for (const inc of incidentIndex.all()) {
              if (inc.zdTicketId) _fiIncByZdId.add(String(inc.zdTicketId));
              _fiIncById.add(inc.id);
            }
          } else {
            const _fiIncRows = await db.getAll("incidents");
            _fiIncByZdId = new Set();
            _fiIncById = new Set();
            for (const row of _fiIncRows) {
              try {
                const inc = JSON.parse(row.data);
                if (inc.zdTicketId) _fiIncByZdId.add(String(inc.zdTicketId));
                _fiIncById.add(inc.id);
              } catch { /* ignore */ }
            }
          }
          while (hasMore) {
            try {
              const ticketResult = await zdRequest("GET", `/tickets.json?page=${ticketPage}&per_page=100&sort_by=created_at&sort_order=asc`);
              const tickets = ticketResult.tickets || [];
              for (const t of tickets) {
                const ticketData = {
                  id: t.id, subject: t.subject, description: t.description,
                  status: t.status, priority: t.priority || "normal", type: t.type,
                  tags: t.tags || [], customFields: t.custom_fields || [],
                  requesterId: t.requester_id, submitterId: t.submitter_id,
                  assigneeId: t.assignee_id, organizationId: t.organization_id,
                  groupId: t.group_id, collaboratorIds: t.collaborator_ids || [],
                  followerIds: t.follower_ids || [], forumTopicId: t.forum_topic_id,
                  problemId: t.problem_id, hasIncidents: t.has_incidents,
                  isPublic: t.is_public, satisfaction: t.satisfaction_rating,
                  channel: t.via?.channel || "unknown", viaSource: t.via?.source || {},
                  createdAt: t.created_at, updatedAt: t.updated_at,
                  dueAt: t.due_at, importedAt: new Date().toISOString(),
                  source: "zendesk_full_import",
                };
                await db.upsert("zendesk_tickets", String(t.id), JSON.stringify(ticketData));
                ctx.zdSyncStats.tickets++;

                // Import comments for each ticket
                if (includeComments) {
                  try {
                    const commentsResult = await zdRequest("GET", `/tickets/${t.id}/comments.json`);
                    const comments = commentsResult.comments || [];
                    for (const c of comments) {
                      await db.upsert("zendesk_comments", `${t.id}_${c.id}`, JSON.stringify({
                        id: c.id, ticketId: t.id, authorId: c.author_id,
                        body: c.body || c.plain_body || "", htmlBody: c.html_body || "",
                        public: c.public, createdAt: c.created_at,
                        attachments: (c.attachments || []).map(a => ({ id: a.id, name: a.file_name, url: a.content_url, size: a.size })),
                        importedAt: new Date().toISOString(),
                      }));
                      ctx.zdSyncStats.comments++;
                    }
                  } catch (e) { ctx.zdSyncStats.errors++; }
                }

                // Auto-create ITSM incidents from tickets — Sev-A/B only (routine handled by AI)
                if (createIncidents && !['closed', 'solved'].includes(t.status) && ['urgent', 'high'].includes(t.priority)) {
                  const existing = _fiIncById.has(`INC-ZD${t.id}`);
                  const existsByZd = _fiIncByZdId.has(String(t.id));
                  if (!existing && !existsByZd) {
                    const priorityMap = { "urgent": "Sev-A", "high": "Sev-B", "normal": "Sev-C", "low": "Sev-D" };
                    const statusMap = { "new": "New", "open": "Open", "pending": "Pending", "hold": "On Hold", "solved": "Resolved", "closed": "Closed" };
                    const slaMap = getSlaMap();
                    const itsmPriority = priorityMap[t.priority] || "Sev-C";
                    const zdStatus = statusMap[t.status] || "New";
                    const incident = {
                      id: `INC-ZD${t.id}`, title: t.subject || "Untitled",
                      description: t.description || "", category: normalizeCategory((t.tags || [])[0] || "General"),
                      subcategory: "", priority: itsmPriority,
                      status: zdStatus,
                      urgency: t.priority === "urgent" ? "Critical" : "Standard",
                      impact: t.priority === "urgent" ? "Enterprise" : "Individual",
                      assignee: "Unassigned", assignmentGroup: "Service Desk",
                      reporter: "Zendesk Import", reporterEmail: "",
                      customer: "", contactMethod: "Zendesk",
                      created: 0,
                      createdAt: t.created_at || new Date().toISOString(),
                      resolvedAt: ["Resolved", "Closed"].includes(zdStatus) ? (t.updated_at || new Date().toISOString()) : undefined,
                      slaTarget: slaMap[itsmPriority] || 9,
                      aiTriaged: false, aiConfidence: 0, zdTicketId: t.id,
                      zdLastSync: new Date().toISOString(),
                      workaround: "", linkedProblem: "", affectedAssets: [],
                      activityLog: [{ id: `AL-ZD${t.id}`, type: "sync", user: "Zendesk Import", time: new Date().toISOString(), detail: `Historical import from Zendesk #${t.id} (${t.status})` }],
                    };
                    await db.upsert("incidents", incident.id, JSON.stringify(incident));
                    _fiIncById.add(incident.id);
                    _fiIncByZdId.add(String(t.id));
                  }
                }
              }
              hasMore = tickets.length === 100;
              ticketPage++;
            } catch (e) { ctx.zdSyncStats.errors++; hasMore = false; }
          }
          console.log(`[ZD Import] Tickets: ${ctx.zdSyncStats.tickets}, Comments: ${ctx.zdSyncStats.comments}`);

          // Save sync state
          const syncState = {
            id: "last_full_import", type: "full_import",
            completedAt: new Date().toISOString(), stats: { ...ctx.zdSyncStats },
          };
          await db.upsert("zendesk_sync_state", "last_full_import", JSON.stringify(syncState));
          ctx.zdLastSyncTime = new Date().toISOString();

          await db.audit("zendesk_sync_state", "full_import", "full_import",
            JSON.stringify(ctx.zdSyncStats), "system");

          return json(res, 200, {
            success: true, stats: ctx.zdSyncStats,
            message: `Imported ${ctx.zdSyncStats.tickets} tickets, ${ctx.zdSyncStats.users} users, ${ctx.zdSyncStats.orgs} orgs, ${ctx.zdSyncStats.comments} comments`,
          });
        } catch (err) {
          console.error("[ZD Full Import]", err.message);
          return json(res, 500, { error: "Sync failed", stats: ctx.zdSyncStats });
        } finally {
          ctx.zdSyncInProgress = false;
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // INCREMENTAL SYNC — Only fetch changes since last sync
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/incremental-sync" && req.method === "POST") {
        if (ctx.zdSyncInProgress) return json(res, 409, { error: "Sync already in progress" });
        ctx.zdSyncInProgress = true;
        const syncResult = { ticketsUpdated: 0, ticketsCreated: 0, commentsAdded: 0, errors: 0 };

        try {
          // Get last sync timestamp
          const lastSyncRow = await db.getOne("zendesk_sync_state", "last_incremental_sync");
          let startTime;
          if (lastSyncRow) {
            const lastSync = JSON.parse(lastSyncRow.data);
            startTime = Math.floor(new Date(lastSync.completedAt).getTime() / 1000);
          } else {
            // Default to 30 days ago if no prior sync
            startTime = Math.floor((Date.now() - 30 * 86400000) / 1000);
          }

          // Use Zendesk incremental ticket export (include metric_sets for SLA timestamps)
          let url = `/incremental/tickets.json?start_time=${startTime}&include=metric_sets`;
          let hasMore = true;
          // Phase 9.4: Use incidentIndex for O(1) dedup where available
          let _incByZdId, _incById;
          if (incidentIndex && incidentIndex.size() > 0) {
            _incByZdId = new Map();
            _incById = new Map();
            for (const inc of incidentIndex.all()) {
              if (inc.zdTicketId) _incByZdId.set(String(inc.zdTicketId), { row: null, inc });
              _incById.set(inc.id, { row: null, inc });
            }
          } else {
            const _incRows = await db.getAll("incidents");
            _incByZdId = new Map();
            _incById = new Map();
            for (const row of _incRows) {
              try {
                const inc = JSON.parse(row.data);
                if (inc.zdTicketId) _incByZdId.set(String(inc.zdTicketId), { row, inc });
                _incById.set(inc.id, { row, inc });
              } catch { /* ignore */ }
            }
          }
          while (hasMore) {
            try {
              const result = await zdRequest("GET", url);
              const tickets = result.tickets || [];
              for (const t of tickets) {
                const existingRow = await db.getOne("zendesk_tickets", String(t.id));
                const ticketData = {
                  id: t.id, subject: t.subject, description: t.description,
                  status: t.status, priority: t.priority || "normal", type: t.type,
                  tags: t.tags || [], requesterId: t.requester_id,
                  assigneeId: t.assignee_id, organizationId: t.organization_id,
                  groupId: t.group_id, createdAt: t.created_at,
                  updatedAt: t.updated_at, channel: t.via?.channel || "unknown",
                  importedAt: new Date().toISOString(), source: "incremental_sync",
                };
                await db.upsert("zendesk_tickets", String(t.id), JSON.stringify(ticketData));

                if (existingRow) { syncResult.ticketsUpdated++; }
                else { syncResult.ticketsCreated++; }

                // Sync status/priority back to ITSM incidents if linked (uses pre-loaded map)
                let hasLinkedIncident = false;
                const _linked = _incByZdId.get(String(t.id));
                if (_linked) {
                  hasLinkedIncident = true;
                  const inc = _linked.inc;
                  const _ms = t.metric_set || {};
                  const changed = applyZendeskTicketSync(inc, t, _ms, "incremental_sync");
                  if (changed) {
                    inc.activityLog = [...(inc.activityLog || []), {
                      id: `AL-SYNC-${Date.now()}`, type: "sync", user: "Zendesk Sync",
                      time: new Date().toISOString(),
                      detail: `Auto-synced from Zendesk #${t.id}: status=${ZD_STATUS_MAP[t.status] || '-'}, priority=${ZD_PRIORITY_MAP[t.priority] || '-'}`,
                    }];
                    await db.upsert("incidents", inc.id, JSON.stringify(inc));
                  }
                }

                // Fast-path dedup: check pre-loaded map before creating
                if (!hasLinkedIncident) {
                  if (_incById.has(`INC-ZD${t.id}`)) hasLinkedIncident = true;
                }

                // Auto-create ITSM incident only for urgent/high priority (Sev-A/B) — routine tickets handled by AI
                if (!hasLinkedIncident && !["closed", "solved"].includes(t.status) && ["urgent", "high"].includes(t.priority)) {
                  const priorityMap = { "urgent": "Sev-A", "high": "Sev-B", "normal": "Sev-C", "low": "Sev-D" };
                  const slaMap = getSlaMap();
                  const itsmPriority = priorityMap[t.priority] || "Sev-C";
                  const statusMap = { "new": "New", "open": "Open", "pending": "Pending", "hold": "On Hold" };
                  const newInc = {
                    id: `INC-ZD${t.id}`, title: t.subject || "Untitled",
                    description: t.description || "", category: normalizeCategory((t.tags || [])[0] || "General"),
                    subcategory: "", priority: itsmPriority, status: statusMap[t.status] || "New",
                    urgency: t.priority === "urgent" ? "Critical" : "Standard",
                    impact: t.priority === "urgent" ? "Enterprise" : "Individual",
                    assignee: "Unassigned", assignmentGroup: "Service Desk",
                    reporter: "Zendesk Incremental Sync", reporterEmail: "",
                    customer: "", contactMethod: "Zendesk",
                    created: 0, createdAt: t.created_at, slaTarget: slaMap[itsmPriority] || 9,
                    // v3.13 Layer 1: anchor SLA timestamps to Zendesk
                    slaStartAt: t.created_at,
                    firstResponseAt: t.first_public_comment_at || (t.metric_set && t.metric_set.first_public_comment_at) || null,
                    resolvedAt: t.solved_at || (t.metric_set && t.metric_set.solved_at) || null,
                    aiTriaged: false, aiConfidence: 0, zdTicketId: t.id,
                    zdLastSync: new Date().toISOString(),
                    workaround: "", linkedProblem: "", affectedAssets: [],
                    activityLog: [{ id: `AL-IS-${t.id}`, type: "sync", user: "Zendesk Incremental Sync", time: new Date().toISOString(), detail: `Auto-created from incremental sync — Zendesk #${t.id}` }],
                  };
                  await db.upsert("incidents", newInc.id, JSON.stringify(newInc));
                  syncResult.incidentsCreated = (syncResult.incidentsCreated || 0) + 1;
                  console.log(`[ZD Incremental] Auto-created ITSM ${newInc.id} from Zendesk #${t.id}`);

                  // Fire AI auto-triage + workflow-assist pipeline
                  if (AZURE_OPENAI_KEY && AZURE_OPENAI_ENDPOINT) {
                    try {
                      const triagePayload = JSON.stringify({ ticket: newInc, requestedBy: "Zendesk Incremental Sync Auto-Triage" });
                      const triageReq = http.request({ hostname: "127.0.0.1", port: PORT, path: "/api/ai/auto-triage-assign", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(triagePayload), "x-internal-scheduler-token": process.env.INTERNAL_SCHEDULER_TOKEN } }, (triageRes) => {
                        let d = ""; triageRes.on("data", c => d += c);
                        triageRes.on("end", () => { console.log(`[ZD Incremental] AI auto-triage for ${newInc.id}: ${d.substring(0, 200)}`); });
                      });
                      triageReq.on("error", e => console.warn(`[ZD Incremental] AI triage failed for ${newInc.id}:`, e.message));
                      triageReq.setTimeout(35000, () => { triageReq.destroy(); });
                      triageReq.write(triagePayload);
                      triageReq.end();
                    } catch (triageErr) { console.warn("[ZD Incremental] AI triage error:", triageErr.message); }
                  }
                }

                // Fetch latest comments
                try {
                  const commentsResult = await zdRequest("GET", `/tickets/${t.id}/comments.json?sort_order=desc&per_page=10`);
                  for (const c of (commentsResult.comments || [])) {
                    const existing = await db.getOne("zendesk_comments", `${t.id}_${c.id}`);
                    if (!existing) {
                      await db.upsert("zendesk_comments", `${t.id}_${c.id}`, JSON.stringify({
                        id: c.id, ticketId: t.id, authorId: c.author_id,
                        body: c.body || c.plain_body || "", htmlBody: c.html_body || "",
                        public: c.public, createdAt: c.created_at,
                        importedAt: new Date().toISOString(),
                      }));
                      syncResult.commentsAdded++;
                    }
                  }
                } catch { /* ignore */ }
              }

              hasMore = !result.end_of_stream && result.next_page;
              if (hasMore) {
                const nextUrl = new URL(result.next_page);
                url = nextUrl.pathname.replace("/api/v2", "") + nextUrl.search;
              }
            } catch (e) { syncResult.errors++; hasMore = false; }
          }

          // Save sync state
          const syncState = {
            id: "last_incremental_sync", type: "incremental_sync",
            completedAt: new Date().toISOString(), stats: { ...syncResult },
          };
          await db.upsert("zendesk_sync_state", "last_incremental_sync", JSON.stringify(syncState));
          ctx.zdLastSyncTime = new Date().toISOString();

          // ─── Stale-check pass: catch ITSM incidents whose ZD tickets changed while sync was inactive ───
          try {
            const staleRows = await db.getAll("incidents");
            const staleNow = Date.now();
            const STALE_THRESHOLD = 60 * 60 * 1000; // 1 hour
            const staleCandidates = [];
            for (const row of staleRows) {
              try {
                const inc = JSON.parse(row.data);
                if (!inc.zdTicketId || inc._deleted) continue;
                if (["closed", "resolved"].includes((inc.status || "").toLowerCase())) continue;
                const lastSync = inc.zdLastSync ? new Date(inc.zdLastSync).getTime() : 0;
                if (staleNow - lastSync > STALE_THRESHOLD) staleCandidates.push(inc);
              } catch { /* ignore */ }
            }
            if (staleCandidates.length > 0) {
              const staleIds = [...new Set(staleCandidates.map(i => i.zdTicketId))];
              const zdCache = {};
              const zdMsCache = {};
              for (let si = 0; si < staleIds.length; si += 100) {
                try {
                  const batch = staleIds.slice(si, si + 100);
                  const res2 = await zdRequest("GET", `/tickets/show_many.json?ids=${batch.join(",")}&include=metric_sets`);
                  for (const t of (res2.tickets || [])) zdCache[t.id] = t;
                  // Sideloaded metric_sets come back as a top-level array; match by ticket_id.
                  for (const m of (res2.metric_sets || [])) {
                    if (m && m.ticket_id != null) zdMsCache[m.ticket_id] = m;
                  }
                } catch { /* ignore */ }
              }
              let staleFixed = 0;
              for (const inc of staleCandidates) {
                const zd = zdCache[inc.zdTicketId];
                if (!zd) continue;
                const ms = zdMsCache[inc.zdTicketId] || zd.metric_set || {};
                const ch = applyZendeskTicketSync(inc, zd, ms, "stale_check");
                if (ch) {
                  inc.updatedAt = inc.zdLastSync;
                  if (["Resolved", "Closed"].includes(inc.status) && !inc.resolvedAt) inc.resolvedAt = inc.zdLastSync;
                  if (inc.status === "Closed" && !inc.closedAt) inc.closedAt = inc.zdLastSync;
                  inc.activityLog = [...(inc.activityLog || []), { id: `AL-STALE-${Date.now()}`, type: "sync", user: "ZD Stale-Check", time: inc.zdLastSync, detail: `Stale-check: ZD #${inc.zdTicketId} → status=${ZD_STATUS_MAP[zd.status] || '-'}, priority=${ZD_PRIORITY_MAP[zd.priority] || '-'}` }];
                  await db.upsert("incidents", inc.id, JSON.stringify(inc));
                  staleFixed++;
                }
              }
              if (staleFixed > 0) { syncResult.staleFixed = staleFixed; console.log(`[ZD Incremental] Stale-check fixed ${staleFixed} incidents`); }
            }
          } catch (staleErr) { console.warn("[ZD Incremental] Stale-check error:", staleErr.message); }

          // ── Auto-close pending tickets with no new replies after 48 hours ──
          try {
            const allTickets = await db.getAll("zendesk_tickets");
            const now = Date.now();
            const STALE_PENDING_MS = 48 * 60 * 60 * 1000; // 48 hours
            let pendingClosed = 0;
            for (const row of allTickets) {
              try {
                const t = JSON.parse(row.data);
                if (t.status === "pending") {
                  const updatedAt = new Date(t.updated_at || t.updatedAt || t.created_at).getTime();
                  if (now - updatedAt > STALE_PENDING_MS) {
                    // Close in Zendesk
                    await zdRequest("PUT", `/tickets/${t.id}.json`, {
                      ticket: { status: "solved", comment: zendeskInternalComment("[Auto-Resolved] No customer reply received within 48 hours. This ticket has been automatically resolved by the AI support system. Please reopen if you still need assistance.") }
                    }).catch(() => {});
                    // Update local DB
                    t.status = "solved";
                    t.updated_at = new Date().toISOString();
                    await db.upsert("zendesk_tickets", String(t.id), JSON.stringify(t));
                    // Update linked ITSM incident if exists
                    const linkedInc = await db.getOne("incidents", `INC-ZD${t.id}`);
                    if (linkedInc) {
                      const inc = JSON.parse(linkedInc.data);
                      inc.status = "Resolved";
                      inc.closedAt = new Date().toISOString();
                      inc.activityLog = [...(inc.activityLog || []), { id: `AL-AC-${t.id}`, type: "auto_close", user: "AI Engine", time: new Date().toISOString(), detail: `Auto-resolved: no customer reply after 48h on Zendesk #${t.id}` }];
                      await db.upsert("incidents", inc.id, JSON.stringify(inc));
                    }
                    pendingClosed++;
                    console.log(`[ZD Auto-Close] Ticket #${t.id} auto-resolved (pending 48h+ with no reply)`);
                  }
                }
              } catch { /* skip malformed */ }
            }
            if (pendingClosed > 0) { syncResult.pendingAutoClosed = pendingClosed; console.log(`[ZD Incremental] Auto-closed ${pendingClosed} stale pending tickets`); }
          } catch (acErr) { console.warn("[ZD Auto-Close] Error:", acErr.message); }

          // ── Dedup: remove duplicate incidents with same zdTicketId ──
          try {
            const allIncs = await db.getAll("incidents");
            const zdTicketMap = new Map(); // zdTicketId -> best incident
            let dupsRemoved = 0;
            for (const row of allIncs) {
              try {
                const inc = JSON.parse(row.data);
                if (!inc.zdTicketId) continue;
                const key = String(inc.zdTicketId);
                if (zdTicketMap.has(key)) {
                  // Keep the one with INC-ZD prefix (canonical) or the one with more data
                  const existing = zdTicketMap.get(key);
                  const existingIsCanonical = existing.id.startsWith("INC-ZD");
                  const currentIsCanonical = inc.id.startsWith("INC-ZD");
                  if (currentIsCanonical && !existingIsCanonical) {
                    // Current is canonical, remove old
                    await db.deleteOne("incidents", existing.id);
                    zdTicketMap.set(key, inc);
                    dupsRemoved++;
                  } else {
                    // Existing is canonical or both non-canonical, remove current
                    await db.deleteOne("incidents", inc.id);
                    dupsRemoved++;
                  }
                } else {
                  zdTicketMap.set(key, inc);
                }
              } catch { /* skip malformed */ }
            }
            if (dupsRemoved > 0) { syncResult.duplicatesRemoved = dupsRemoved; console.log(`[ZD Incremental] Dedup: removed ${dupsRemoved} duplicate incidents`); }
          } catch (dedupErr) { console.warn("[ZD Dedup] Error:", dedupErr.message); }

          // ── Purge routine (Sev-C/D) INC-ZD* incidents — these should not exist ──
          try {
            const routineIncs = await db.getAll("incidents");
            let routinePurged = 0;
            for (const row of routineIncs) {
              try {
                const inc = JSON.parse(row.data);
                if (inc.id && inc.id.startsWith("INC-ZD") && (inc.priority === "Sev-C" || inc.priority === "Sev-D")) {
                  await db.deleteOne("incidents", inc.id);
                  routinePurged++;
                }
              } catch { /* skip malformed */ }
            }
            if (routinePurged > 0) { syncResult.routinePurged = routinePurged; console.log(`[ZD Incremental] Purged ${routinePurged} routine (Sev-C/D) INC-ZD* incidents`); }
          } catch (purgeErr) { console.warn("[ZD Purge] Error:", purgeErr.message); }

          console.log(`[ZD Incremental] Updated: ${syncResult.ticketsUpdated}, Created: ${syncResult.ticketsCreated}, Comments: ${syncResult.commentsAdded}`);
          return json(res, 200, { success: true, stats: syncResult });
        } catch (err) {
          console.error("[ZD Incremental Sync]", err.message);
          return json(res, 500, { error: "Sync failed", stats: syncResult });
        } finally {
          ctx.zdSyncInProgress = false;
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // CLEANUP EMAIL-INGESTED ORPHAN NOISE (Silent bulk-close)
      // POST /api/zendesk/cleanup-email-orphans
      // Closes INC-EMAIL-* incidents in open status with NO zdTicketId.
      // These are typically Zendesk auto-reply emails, [Request received]
      // confirmations, RE:/FW: noise that got parsed as new incidents.
      // Sev-A / P1 / Critical are never auto-closed.
      // Body: { dryRun?: bool, requestedBy?: string, idPrefix?: string }
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/cleanup-email-orphans" && req.method === "POST") {
        try {
          const body = await parseBody(req, 50000).catch(() => ({}));
          const dryRun = body.dryRun === true;
          const requestedBy = body.requestedBy || authResult?.user?.email || "admin";
          const idPrefix = body.idPrefix || "INC-EMAIL-";
          const explicitIds = Array.isArray(body.ids) ? new Set(body.ids) : null;
          const reasonOverride = typeof body.reason === "string" ? body.reason : null;

          // Phase 9 — use incident index instead of full table scan + parse.
          // Falls back to db.getAll if the index is unavailable for any reason.
          const openStatuses = new Set(["New", "Open", "In Progress", "Pending", "On Hold", "Reopened"]);
          const sourceList = (incidentIndex && incidentIndex.size() > 0)
            ? incidentIndex.openWithoutZdLink()
            : (await db.getAll("incidents")).map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(i => i && openStatuses.has((i.status || "").trim()) && !i.zdTicketId);

          const candidates = [];
          const skippedHighSev = [];
          for (const inc of sourceList) {
            if (explicitIds) {
              if (!explicitIds.has(inc.id)) continue;
            } else {
              if (!inc.id || !inc.id.startsWith(idPrefix)) continue;
            }
            if (isHighSeverity(inc.priority)) { skippedHighSev.push({ id: inc.id, title: inc.title, priority: inc.priority }); continue; }
            candidates.push(inc);
          }

          if (dryRun) {
            return json(res, 200, {
              dryRun: true,
              eligibleCount: candidates.length,
              skippedHighSev: skippedHighSev.length,
              skippedHighSevSample: skippedHighSev.slice(0, 10),
              sample: candidates.slice(0, 20).map(i => ({ id: i.id, title: (i.title || "").slice(0, 80), priority: i.priority, status: i.status, createdAt: i.createdAt }))
            });
          }

          const now = new Date().toISOString();
          let closed = 0;
          for (const inc of candidates) {
            inc.status = "Closed";
            inc.resolvedAt = inc.resolvedAt || now;
            inc.closedAt = now;
            inc.updatedAt = now;
            inc.historicalClose = true;
            inc.suppressNotification = true;
            inc.closureReason = reasonOverride || "Email-ingested orphan (no Zendesk link, auto-noise)";
            inc.resolution = inc.resolution || (reasonOverride ? `Bulk-closed: ${reasonOverride}` : "Bulk-closed: email-ingested orphan with no Zendesk linkage. Likely Zendesk auto-reply, system notification, or unparsable email.");
            inc.activityLog = [...(inc.activityLog || []), {
              id: `AL-CLEANUP-${Date.now()}-${closed}`,
              type: "close",
              user: "Email Orphan Cleanup",
              time: now,
              detail: `Silently closed by cleanup operation (requested by ${requestedBy}). No customer notification sent.`
            }];
            await db.upsert("incidents", inc.id, JSON.stringify(inc));
            try { await db.audit("incidents", inc.id, "silent-close-email-orphan", JSON.stringify({ reason: inc.closureReason, requestedBy }), requestedBy); } catch { /* ignore */ }
            try { wsServer && wsServer.broadcast && wsServer.broadcast("incidents/update", { id: inc.id, status: "Closed", silent: true }); } catch { /* ignore */ }
            closed++;
          }
          try { cacheLayer && cacheLayer.invalidatePrefix && cacheLayer.invalidatePrefix("incidents"); } catch { /* ignore */ }

          return json(res, 200, {
            success: true,
            scanned: candidates.length + skippedHighSev.length,
            closed,
            skippedHighSev: skippedHighSev.length,
            requestedBy,
            timestamp: now,
            notificationsSent: 0
          });
        } catch (err) {
          console.error("[Email Orphan Cleanup]", err);
          return json(res, 500, { error: "Internal server error" });
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // PURGE ROUTINE INCIDENTS — Delete Sev-C/D INC-ZD* noise
      // POST /api/zendesk/purge-routine-incidents
      // Body: { dryRun?: bool }
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/purge-routine-incidents" && req.method === "POST") {
        try {
          const body = await parseBody(req, 5000).catch(() => ({}));
          const dryRun = body.dryRun === true;
          const allIncs = await db.getAll("incidents");
          const toPurge = [];
          for (const row of allIncs) {
            try {
              const inc = JSON.parse(row.data);
              if (inc.id && inc.id.startsWith("INC-ZD") && (inc.priority === "Sev-C" || inc.priority === "Sev-D")) {
                toPurge.push(inc);
              }
            } catch { /* skip malformed */ }
          }
          if (dryRun) {
            return json(res, 200, {
              dryRun: true,
              wouldPurge: toPurge.length,
              sample: toPurge.slice(0, 30).map(i => ({ id: i.id, title: i.title, priority: i.priority, status: i.status, zdTicketId: i.zdTicketId })),
              breakdown: {
                sevC: toPurge.filter(i => i.priority === "Sev-C").length,
                sevD: toPurge.filter(i => i.priority === "Sev-D").length,
                open: toPurge.filter(i => ["New", "Open", "In Progress", "Pending"].includes(i.status)).length,
                closed: toPurge.filter(i => ["Resolved", "Closed"].includes(i.status)).length,
              },
            });
          }
          let purged = 0;
          for (const inc of toPurge) {
            await db.deleteOne("incidents", inc.id);
            await db.audit("incidents", inc.id, "purge_routine", JSON.stringify({ priority: inc.priority, zdTicketId: inc.zdTicketId }), "system");
            purged++;
          }
          if (cacheLayer) cacheLayer.invalidatePrefix("incidents");
          if (wsServer) wsServer.broadcast("incidents", { action: "bulk_delete", collection: "incidents", count: purged });
          console.log(`[ZD Purge] Deleted ${purged} routine (Sev-C/D) INC-ZD* incidents`);
          return json(res, 200, { success: true, purged, breakdown: { sevC: toPurge.filter(i => i.priority === "Sev-C").length, sevD: toPurge.filter(i => i.priority === "Sev-D").length } });
        } catch (err) {
          console.error("[ZD Purge]", err.message);
          return json(res, 500, { error: "Internal server error" });
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // RECONCILE OPEN INCIDENTS WITH ZENDESK (Silent backfill)
      // POST /api/zendesk/reconcile-open
      // For every open ITSM incident with a zdTicketId, fetch the current
      // Zendesk status and silently close any that are solved/closed in ZD.
      // Sev-A is never auto-closed (surfaced as requiresManualReview).
      // No emails, no notifications — only WS broadcasts for UI refresh.
      // Body: { dryRun?: bool, requestedBy?: string }
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/reconcile-open" && req.method === "POST") {
        try {
          const body = await parseBody(req, 5000).catch(() => ({}));
          const dryRun = body.dryRun === true;
          const requestedBy = body.requestedBy || authResult?.user?.email || "admin";

          // 1. Load all open incidents WITH a Zendesk link
          // Phase 9 — index-backed (instant) with full-scan fallback.
          const openStatuses = new Set(["New", "Open", "In Progress", "Pending", "On Hold", "Reopened"]);
          let openLinked;
          if (incidentIndex && incidentIndex.size() > 0) {
            openLinked = incidentIndex.openWithZdLink();
          } else {
            const allRows = await db.getAll("incidents");
            openLinked = [];
            for (const r of allRows) {
              try {
                const inc = JSON.parse(r.data);
                if (openStatuses.has((inc.status || "").trim()) && inc.zdTicketId) openLinked.push(inc);
              } catch { /* ignore */ }
            }
          }

          // 2. Batch-fetch current ZD status (chunks of 100 via show_many)
          const zdMap = {}; // ticketId -> { status, updated_at, exists }
          const ids = [...new Set(openLinked.map(i => String(i.zdTicketId)))];
          const missingIds = new Set(ids);
          for (let i = 0; i < ids.length; i += 100) {
            const batch = ids.slice(i, i + 100);
            try {
              const resp = await zdRequest("GET", `/tickets/show_many.json?ids=${batch.join(",")}`);
              for (const t of (resp.tickets || [])) {
                zdMap[String(t.id)] = { status: (t.status || "").toLowerCase(), updated_at: t.updated_at, exists: true };
                missingIds.delete(String(t.id));
              }
            } catch (e) { console.warn(`[ZD Reconcile] Batch ${i} fetch failed: ${e.message}`); }
          }
          // Tickets not returned by show_many = deleted in Zendesk
          for (const mid of missingIds) zdMap[mid] = { exists: false };

          // 3. Determine actions per incident
          const closedZdStatuses = new Set(["solved", "closed"]);
          const toClose = [];           // will be silently closed
          const requiresManualReview = []; // Sev-A — surface for human review
          const stillOpen = [];          // ZD also still open
          const deletedInZd = [];        // ZD ticket gone
          for (const inc of openLinked) {
            const zd = zdMap[String(inc.zdTicketId)];
            if (!zd) continue;
            if (!zd.exists) {
              if (isHighSeverity(inc.priority)) requiresManualReview.push({ id: inc.id, zdTicketId: inc.zdTicketId, reason: "ZD ticket deleted (high severity)" });
              else deletedInZd.push(inc);
              continue;
            }
            if (closedZdStatuses.has(zd.status)) {
              if (isHighSeverity(inc.priority)) {
                requiresManualReview.push({ id: inc.id, zdTicketId: inc.zdTicketId, zdStatus: zd.status, reason: "high severity — manual review required" });
              } else {
                toClose.push({ inc, zdStatus: zd.status, zdUpdatedAt: zd.updated_at });
              }
            } else {
              stillOpen.push({ id: inc.id, zdTicketId: inc.zdTicketId, zdStatus: zd.status });
            }
          }

          if (dryRun) {
            return json(res, 200, {
              dryRun: true,
              scanned: openLinked.length,
              wouldClose: toClose.length,
              wouldMarkDeleted: deletedInZd.length,
              requiresManualReview: requiresManualReview.length,
              stillOpen: stillOpen.length,
              sample: toClose.slice(0, 20).map(x => ({ id: x.inc.id, title: x.inc.title, priority: x.inc.priority, status: x.inc.status, zdTicketId: x.inc.zdTicketId, zdStatus: x.zdStatus })),
              manualReview: requiresManualReview.slice(0, 10),
              deleted: deletedInZd.slice(0, 10).map(i => ({ id: i.id, title: i.title, zdTicketId: i.zdTicketId })),
            });
          }

          // 4. Apply silent closures (no email, no notification)
          const nowISO = new Date().toISOString();
          let closedCount = 0;
          let deletedCount = 0;
          for (const { inc, zdStatus, zdUpdatedAt } of toClose) {
            const closedTs = zdUpdatedAt || nowISO;
            inc.status = "Closed";
            inc.resolvedAt = inc.resolvedAt || closedTs;
            inc.closedAt = closedTs;
            inc.closedBy = "ZD Reconciliation";
            inc.closureReason = `Zendesk reconciliation — already ${zdStatus} in Zendesk #${inc.zdTicketId}`;
            inc.resolution = inc.resolution || `Reconciled with Zendesk #${inc.zdTicketId} (${zdStatus}). No customer-facing action required.`;
            inc.historicalClose = true;
            inc.suppressNotification = true;
            inc.zdLastSync = nowISO;
            inc.updatedAt = nowISO;
            inc.activityLog = inc.activityLog || [];
            inc.activityLog.push({ id: `AL-RECON-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,5)}`, type: "status", user: "ZD Reconciliation", time: nowISO, detail: `Silent close — Zendesk #${inc.zdTicketId} is ${zdStatus} (no notifications sent)` });
            await db.upsert("incidents", inc.id, JSON.stringify(inc));
            await db.audit("incidents", inc.id, "zd_reconcile_close", JSON.stringify({ zdTicketId: inc.zdTicketId, zdStatus, requestedBy }), requestedBy);
            // WS broadcast for silent UI refresh — never on notifications channel
            if (wsServer) wsServer.broadcast("incidents", { action: "update", collection: "incidents", id: inc.id, silent: true });
            closedCount++;
          }
          for (const inc of deletedInZd) {
            inc.status = "Closed";
            inc.resolvedAt = inc.resolvedAt || nowISO;
            inc.closedAt = nowISO;
            inc.closedBy = "ZD Reconciliation";
            inc.closureReason = "Zendesk ticket no longer exists";
            inc.resolution = inc.resolution || "Linked Zendesk ticket no longer exists. Closed during reconciliation.";
            inc.historicalClose = true;
            inc.suppressNotification = true;
            inc.zdLastSync = nowISO;
            inc.updatedAt = nowISO;
            inc.activityLog = inc.activityLog || [];
            inc.activityLog.push({ id: `AL-RECON-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,5)}`, type: "status", user: "ZD Reconciliation", time: nowISO, detail: `Silent close — Zendesk #${inc.zdTicketId} no longer exists` });
            await db.upsert("incidents", inc.id, JSON.stringify(inc));
            await db.audit("incidents", inc.id, "zd_reconcile_delete", JSON.stringify({ zdTicketId: inc.zdTicketId, requestedBy }), requestedBy);
            if (wsServer) wsServer.broadcast("incidents", { action: "update", collection: "incidents", id: inc.id, silent: true });
            deletedCount++;
          }

          if (cacheLayer) cacheLayer.invalidatePrefix("incidents");
          console.log(`[ZD Reconcile] Closed ${closedCount} silent, ${deletedCount} ZD-deleted, ${requiresManualReview.length} flagged for review (by ${requestedBy})`);

          return json(res, 200, {
            success: true,
            scanned: openLinked.length,
            closed: closedCount,
            markedDeleted: deletedCount,
            requiresManualReview: requiresManualReview.length,
            stillOpen: stillOpen.length,
            requestedBy,
            timestamp: nowISO,
            manualReview: requiresManualReview.slice(0, 50),
          });
        } catch (err) {
          console.error("[ZD Reconcile]", err.message);
          return json(res, 500, { error: "Internal server error" });
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // WEBHOOK — Receive real-time Zendesk webhook events
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/webhook" && req.method === "POST") {
        try {
          // Phase 8.2: Webhook signature verification
          // Read raw body first for HMAC verification, then parse JSON
          const rawBody = await new Promise((resolve, reject) => {
            let d = ""; req.on("data", c => { d += c; if (d.length > 500000) reject(new Error("Webhook payload too large")); });
            req.on("end", () => resolve(d));
            req.on("error", reject);
          });
          if (ZENDESK_WEBHOOK_SECRET) {
            const sig = req.headers["x-zendesk-webhook-signature"];
            const ts = req.headers["x-zendesk-webhook-signature-timestamp"];
            if (!sig || !ts) {
              console.warn("[ZD Webhook] Missing signature headers — rejected");
              return json(res, 401, { error: "Missing webhook signature" });
            }
            const expected = crypto.createHmac("sha256", ZENDESK_WEBHOOK_SECRET)
              .update(ts + rawBody).digest("base64");
            const sigBuf = Buffer.from(sig);
            const expBuf = Buffer.from(expected);
            if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
              console.warn("[ZD Webhook] Invalid signature — rejected");
              return json(res, 401, { error: "Invalid webhook signature" });
            }
          }
          let event;
          try { event = JSON.parse(rawBody); } catch { return json(res, 400, { error: "Invalid JSON in webhook body" }); }
          const eventType = event.type || event.event || "unknown";
          const ticketId = event.ticket_id || event.ticket?.id || event.payload?.ticket?.id;

          console.log(`[ZD Webhook] Event: ${eventType}, Ticket: ${ticketId || "N/A"}`);

          if (ticketId) {
            // v3.14 Layer 5: include metric_sets for accurate SLA timestamps
            const ticketResult = await zdRequest("GET", `/tickets/${ticketId}.json?include=metric_sets`);
            const t = ticketResult.ticket;
            const _whMs = (ticketResult.metric_sets && ticketResult.metric_sets[0]) || (t && t.metric_set) || {};
            if (t) {
              // Update local Zendesk ticket store
              await db.upsert("zendesk_tickets", String(t.id), JSON.stringify({
                id: t.id, subject: t.subject, description: t.description,
                status: t.status, priority: t.priority || "normal",
                tags: t.tags || [], requesterId: t.requester_id,
                assigneeId: t.assignee_id, organizationId: t.organization_id,
                createdAt: t.created_at, updatedAt: t.updated_at,
                channel: t.via?.channel || "unknown",
                importedAt: new Date().toISOString(), source: "webhook",
              }));

              // Sync to ITSM incidents if linked (load once, reuse below)
              const incRows = await db.getAll("incidents");
              const _whIncByZdId = new Map();
              for (const row of incRows) {
                try {
                  const inc = JSON.parse(row.data);
                  if (inc.zdTicketId) _whIncByZdId.set(String(inc.zdTicketId), inc);
                } catch { /* ignore */ }
              }
              const _whLinked = _whIncByZdId.get(String(t.id));
              if (_whLinked) {
                const inc = _whLinked;
                const changed = applyZendeskTicketSync(inc, t, _whMs, "webhook");
                if (changed) {
                  inc.activityLog = [...(inc.activityLog || []), {
                    id: `AL-WH-${Date.now()}`, type: "sync", user: "Zendesk Webhook",
                    time: new Date().toISOString(),
                    detail: `Real-time sync: ${eventType} — status=${t.status}, priority=${t.priority}`,
                  }];
                  await db.upsert("incidents", inc.id, JSON.stringify(inc));
                  console.log(`[ZD Webhook] Updated ITSM ${inc.id} from Zendesk #${t.id}`);
                }
              }

              // If new ticket and no ITSM incident exists, auto-create one (Sev-A/B only)
              if (eventType === "ticket_created" || eventType === "zen:event-type:ticket.created") {
                // Use pre-loaded map for dedup (no second getAll)
                let hasIncident = _whIncByZdId.has(String(t.id));
                if (!hasIncident && ["urgent", "high"].includes(t.priority)) {
                  const priorityMap = { "urgent": "Sev-A", "high": "Sev-B", "normal": "Sev-C", "low": "Sev-D" };
                  const slaMap = getSlaMap();
                  const itsmPriority = priorityMap[t.priority] || "Sev-C";
                  const newInc = {
                    id: `INC-ZD${t.id}`, title: t.subject || "Untitled",
                    description: t.description || "", category: (t.tags || [])[0] || "General",
                    subcategory: "", priority: itsmPriority, status: "New",
                    urgency: t.priority === "urgent" ? "Critical" : "Standard",
                    impact: t.priority === "urgent" ? "Enterprise" : "Individual",
                    assignee: "Unassigned", assignmentGroup: "Service Desk",
                    reporter: "Zendesk Webhook", reporterEmail: "",
                    customer: "", contactMethod: "Zendesk",
                    created: 0, slaTarget: slaMap[itsmPriority] || 9,
                    aiTriaged: false, aiConfidence: 0, zdTicketId: t.id,
                    zdLastSync: new Date().toISOString(),
                    workaround: "", linkedProblem: "", affectedAssets: [],
                    activityLog: [{ id: `AL-WH-${t.id}`, type: "sync", user: "Zendesk Webhook", time: new Date().toISOString(), detail: `Auto-created from Zendesk webhook #${t.id}` }],
                  };
                  await db.upsert("incidents", newInc.id, JSON.stringify(newInc));
                  console.log(`[ZD Webhook] Auto-created ITSM ${newInc.id} from new Zendesk ticket #${t.id}`);

                  // AI Auto-Triage: automatically categorize, prioritize, and assign the new ticket
                  if (AZURE_OPENAI_KEY && AZURE_OPENAI_ENDPOINT) {
                    try {
                      const triagePayload = JSON.stringify({ ticket: newInc, requestedBy: "Zendesk Webhook Auto-Triage" });
                      const triageReq = http.request({ hostname: "127.0.0.1", port: PORT, path: "/api/ai/auto-triage-assign", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(triagePayload), "x-internal-scheduler-token": process.env.INTERNAL_SCHEDULER_TOKEN } }, (triageRes) => {
                        let d = ""; triageRes.on("data", c => d += c);
                        triageRes.on("end", () => { console.log(`[ZD Webhook] AI auto-triage for ${newInc.id}: ${d.substring(0, 200)}`); });
                      });
                      triageReq.on("error", e => console.warn(`[ZD Webhook] AI triage failed for ${newInc.id}:`, e.message));
                      triageReq.setTimeout(35000, () => { triageReq.destroy(); });
                      triageReq.write(triagePayload);
                      triageReq.end();
                    } catch (triageErr) { console.warn("[ZD Webhook] AI triage error:", triageErr.message); }
                  }
                }
              }

              // Store latest comments if ticket has new comment
              if (eventType.includes("comment") || eventType.includes("Comment")) {
                try {
                  const commentsResult = await zdRequest("GET", `/tickets/${t.id}/comments.json?sort_order=desc&per_page=5`);
                  for (const c of (commentsResult.comments || [])) {
                    await db.upsert("zendesk_comments", `${t.id}_${c.id}`, JSON.stringify({
                      id: c.id, ticketId: t.id, authorId: c.author_id,
                      body: c.body || c.plain_body || "", htmlBody: c.html_body || "",
                      public: c.public, createdAt: c.created_at,
                      importedAt: new Date().toISOString(),
                    }));
                  }
                } catch { /* ignore */ }
              }
            }
          }

          await db.audit("zendesk_sync_state", String(ticketId || "webhook"), "webhook",
            JSON.stringify({ eventType, ticketId }), "zendesk_webhook");

          return json(res, 200, { received: true, eventType, ticketId });
        } catch (err) {
          console.error("[ZD Webhook]", err.message);
          return json(res, 200, { received: true, error: "Webhook processing error" }); // 200 so Zendesk doesn't retry
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // SYNC STATUS — Current sync state and stats
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/sync-status" && req.method === "GET") {
        try {
          const lastFull = await db.getOne("zendesk_sync_state", "last_full_import");
          const lastIncremental = await db.getOne("zendesk_sync_state", "last_incremental_sync");
          const ticketCount = await db.count("zendesk_tickets");
          const userCount = await db.count("zendesk_users");
          const orgCount = await db.count("zendesk_orgs");
          const commentCount = await db.count("zendesk_comments");
          const incidentCount = await db.count("incidents");

          return json(res, 200, {
            syncInProgress: ctx.zdSyncInProgress,
            lastFullImport: lastFull ? JSON.parse(lastFull.data) : null,
            lastIncrementalSync: lastIncremental ? JSON.parse(lastIncremental.data) : null,
            counts: { zdTickets: ticketCount, zdUsers: userCount, zdOrgs: orgCount, zdComments: commentCount, itsmIncidents: incidentCount },
          });
        } catch (err) {
          return json(res, 500, { error: "Internal server error" });
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // SYNC ALL STATUSES — Align ITSM incident statuses with Zendesk
      // Deletes INC-ZD* stale incidents + batch-syncs all ZD-linked statuses
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/sync-all-statuses" && req.method === "POST") {
        try {
          const incRows = await db.getAll("incidents");
          let cleaned = 0, updated = 0, alreadyMatched = 0, errors = 0;
          const zdLinked = []; // { inc, zdTicketId }

          // Phase 1: Collect all ZD-linked incidents (INC-ZD* and zdTicketId-linked)
          for (const row of incRows) {
            try {
              const inc = JSON.parse(row.data);
              const zdId = inc.zdTicketId || (inc.id && inc.id.startsWith("INC-ZD") ? inc.id.replace("INC-ZD", "") : null);
              if (zdId && !inc._deleted) {
                zdLinked.push({ inc, zdTicketId: String(zdId) });
              }
            } catch { /* ignore */ }
          }
          console.log(`[ZD SyncAll] Phase 1: Found ${zdLinked.length} ZD-linked incidents`);

          // Phase 2: Batch-fetch ZD ticket statuses (100 per call)
          const statusMap = { "new": "New", "open": "Open", "pending": "Pending", "hold": "On Hold", "solved": "Resolved", "closed": "Closed" };
          const priorityMap = { "urgent": "Sev-A", "high": "Sev-B", "normal": "Sev-C", "low": "Sev-D" };
          const zdStatusCache = {};

          // Collect unique ZD ticket IDs
          const uniqueZdIds = [...new Set(zdLinked.map(x => x.zdTicketId))];
          for (let i = 0; i < uniqueZdIds.length; i += 100) {
            const batch = uniqueZdIds.slice(i, i + 100);
            try {
              const result = await zdRequest("GET", `/tickets/show_many.json?ids=${batch.join(",")}`);
              for (const t of (result.tickets || [])) {
                zdStatusCache[t.id] = { status: t.status, priority: t.priority };
              }
            } catch (batchErr) {
              console.warn(`[ZD SyncAll] Batch fetch failed for chunk ${i}:`, batchErr.message);
              errors++;
            }
          }
          console.log(`[ZD SyncAll] Phase 2: Fetched ${Object.keys(zdStatusCache).length} ZD ticket statuses`);

          // Phase 3: Update ITSM incidents to match ZD
          const nowISO = new Date().toISOString();
          for (const { inc, zdTicketId } of zdLinked) {
            const zd = zdStatusCache[zdTicketId];
            if (!zd) continue;
            const newStatus = statusMap[zd.status];
            const newPriority = priorityMap[zd.priority];
            let changed = false;
            if (newStatus && newStatus !== inc.status) { inc.status = newStatus; changed = true; }
            if (newPriority && newPriority !== inc.priority) { inc.priority = newPriority; changed = true; }
            if (changed) {
              inc.zdLastSync = nowISO;
              inc.updatedAt = nowISO;
              if (["Resolved", "Closed"].includes(inc.status) && !inc.resolvedAt) inc.resolvedAt = nowISO;
              if (inc.status === "Closed" && !inc.closedAt) inc.closedAt = nowISO;
              inc.activityLog = [...(inc.activityLog || []), {
                id: `AL-SYNCALL-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, type: "sync", user: "ZD Status Sync",
                time: nowISO, detail: `Bulk status sync: ZD #${zdTicketId} → status=${newStatus || '-'}, priority=${newPriority || '-'}`,
              }];
              await db.upsert("incidents", inc.id, JSON.stringify(inc));
              updated++;
            } else {
              alreadyMatched++;
            }
          }

          console.log(`[ZD SyncAll] Phase 3: Updated ${updated}, already matched ${alreadyMatched}, errors ${errors}`);
          return json(res, 200, { success: true, cleaned, updated, alreadyMatched, errors, totalZdLinked: zdLinked.length });
        } catch (err) {
          console.error("[ZD SyncAll]", err.message);
          return json(res, 500, { error: "Internal server error" });
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // PUSH ITSM → ZENDESK — Sync ITSM incident changes to Zendesk
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/push-to-zendesk" && req.method === "POST") {
        // Block outbound sync in Production Test Mode (one-way ZD→ITSM only)
        if (PROD_TEST_MODE) return json(res, 200, { skipped: true, reason: "Production Test Mode — one-way sync only (ZD→ITSM)" });
        const body = await parseBody(req);
        const { incidentId, status, priority, comment, assignee, user } = body;
        if (!incidentId) return json(res, 400, { error: "incidentId required" });

        // Find the incident
        const incRow = await db.getOne("incidents", incidentId);
        if (!incRow) return json(res, 404, { error: "Incident not found" });
        const inc = JSON.parse(incRow.data);

        // Create Zendesk ticket if none linked
        if (!inc.zdTicketId) {
          const priorityMap = { "Sev-A": "urgent", "Sev-B": "high", "Sev-C": "normal", "Sev-D": "low" };
          const newTicket = await zdRequest("POST", "/tickets.json", {
            ticket: {
              subject: inc.title, comment: zendeskInternalComment(inc.description || "Created from ITSM"),
              priority: priorityMap[inc.priority] || "normal",
              tags: ["itsm-synced", inc.category?.toLowerCase() || "general"],
            }
          });
          inc.zdTicketId = newTicket.ticket?.id;
          inc.zdLastSync = new Date().toISOString();
          inc.activityLog = [...(inc.activityLog || []), {
            id: `AL-PUSH-${Date.now()}`, type: "sync", user: user || "System",
            time: new Date().toISOString(),
            detail: `Created Zendesk ticket #${inc.zdTicketId} from ITSM`,
          }];
          await db.upsert("incidents", inc.id, JSON.stringify(inc));
          return json(res, 200, { success: true, action: "created", zdTicketId: inc.zdTicketId });
        }

        // Update existing Zendesk ticket
        const priorityMap = { "Sev-A": "urgent", "Sev-B": "high", "Sev-C": "normal", "Sev-D": "low" };
        const statusMap = { "New": "new", "Open": "open", "In Progress": "open", "Pending": "pending", "On Hold": "hold", "Resolved": "solved", "Closed": "closed", "Reopened": "open" };
        const ticketUpdate = { ticket: {} };
        if (status) ticketUpdate.ticket.status = statusMap[status] || status;
        if (priority) ticketUpdate.ticket.priority = priorityMap[priority] || priority;
        if (comment) ticketUpdate.ticket.comment = zendeskInternalComment(`[ITSM ${incidentId}] ${comment}`);

        if (Object.keys(ticketUpdate.ticket).length > 0) {
          await zdRequest("PUT", `/tickets/${inc.zdTicketId}.json`, ticketUpdate);
          inc.zdLastSync = new Date().toISOString();
          inc.activityLog = [...(inc.activityLog || []), {
            id: `AL-PUSH-${Date.now()}`, type: "sync", user: user || "System",
            time: new Date().toISOString(),
            detail: `Pushed to Zendesk #${inc.zdTicketId}: ${[status && `status=${status}`, priority && `priority=${priority}`, comment && "comment added"].filter(Boolean).join(", ")}`,
          }];
          await db.upsert("incidents", inc.id, JSON.stringify(inc));
        }

        return json(res, 200, { success: true, action: "updated", zdTicketId: inc.zdTicketId });
      }

      // ═══════════════════════════════════════════════════════════════
      // SYNC ORGANIZATIONS → ITSM CUSTOMERS
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/sync-organizations" && req.method === "POST") {
        try {
          const orgRows = await db.getAll("zendesk_orgs");
          // Pre-load customers ONCE (avoid N+1 inside org loop)
          const _custRows = await db.getAll("customers");
          const _custParsed = _custRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
          const _custByZdOrgId = new Map();
          const _custByName = new Map();
          for (const c of _custParsed) {
            if (c.zdOrgId) _custByZdOrgId.set(String(c.zdOrgId), c);
            if (c.name) _custByName.set(c.name.toLowerCase(), c);
          }
          let synced = 0; let created = 0;
          for (const row of orgRows) {
            const org = JSON.parse(row.data);
            const c = _custByZdOrgId.get(String(org.id)) || _custByName.get(org.name?.toLowerCase());
            if (c) {
              c.zdOrgId = org.id;
              c.zdDomains = org.domains || [];
              c.zdTags = org.tags || [];
              c.zdLastSync = new Date().toISOString();
              await db.upsert("customers", c.id, JSON.stringify(c));
              synced++;
            } else {
              const newCust = {
                id: `CUS-ZD${org.id}`, name: org.name, category: "Zendesk Import",
                contactPerson: "", email: "", phone: "",
                address: "", status: "Active",
                services: [], notes: org.notes || org.details || "",
                zdOrgId: org.id, zdDomains: org.domains || [],
                zdTags: org.tags || [], zdLastSync: new Date().toISOString(),
                createdBy: "Zendesk Sync", createdAt: org.createdAt || new Date().toISOString(),
              };
              await db.upsert("customers", newCust.id, JSON.stringify(newCust));
              created++;
            }
          }
          return json(res, 200, { success: true, synced, created, total: orgRows.length });
        } catch (err) {
          return json(res, 500, { error: "Internal server error" });
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // GET STORED ZENDESK DATA — Query local DB copies
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/stored/tickets" && req.method === "GET") {
        const qs = urlObj.searchParams;
        const limit = Math.min(parseInt(qs.get("limit") || "100"), 500);
        const status = qs.get("status");
        try {
          const rows = await cachedGetAll("zendesk_tickets");
          let tickets = rows.map(r => JSON.parse(r.data));
          if (status) tickets = tickets.filter(t => t.status === status);
          return json(res, 200, { tickets: tickets.slice(0, limit), total: tickets.length });
        } catch (err) {
          return json(res, 500, { error: "Internal server error" });
        }
      }

      if (pathname === "/api/zendesk/stored/users" && req.method === "GET") {
        try {
          const rows = await cachedGetAll("zendesk_users");
          const users = rows.map(r => JSON.parse(r.data));
          return json(res, 200, { users, total: users.length });
        } catch (err) {
          return json(res, 500, { error: "Internal server error" });
        }
      }

      if (pathname === "/api/zendesk/stored/orgs" && req.method === "GET") {
        try {
          const rows = await cachedGetAll("zendesk_orgs");
          const orgs = rows.map(r => JSON.parse(r.data));
          return json(res, 200, { orgs, total: orgs.length });
        } catch (err) {
          return json(res, 500, { error: "Internal server error" });
        }
      }

      if (pathname.match(/^\/api\/zendesk\/stored\/tickets\/\d+\/comments$/) && req.method === "GET") {
        const ticketId = pathname.split("/")[5];
        try {
          const rows = await cachedGetAll("zendesk_comments");
          const comments = rows.map(r => JSON.parse(r.data)).filter(c => String(c.ticketId) === ticketId);
          return json(res, 200, { comments, total: comments.length });
        } catch (err) {
          return json(res, 500, { error: "Internal server error" });
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // AI KNOWLEDGE TRAINING FROM ZENDESK DATA
      // ═══════════════════════════════════════════════════════════════
      if (pathname === "/api/zendesk/train-ai" && req.method === "POST") {
        try {
          const ticketRows = await db.getAll("zendesk_tickets");
          const tickets = ticketRows.map(r => JSON.parse(r.data));
          const resolved = tickets.filter(t => t.status === "solved" || t.status === "closed");
          let trained = 0;

          // Pre-load ALL comments ONCE (avoid N+1 inside ticket loop)
          const _allCommentRows = await db.getAll("zendesk_comments");
          const _allComments = _allCommentRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
          const _commentsByTicket = new Map();
          for (const c of _allComments) {
            const tid = c.ticketId;
            if (!_commentsByTicket.has(tid)) _commentsByTicket.set(tid, []);
            _commentsByTicket.get(tid).push(c);
          }

          for (const t of resolved.slice(0, 200)) {
            const ticketComments = _commentsByTicket.get(t.id) || [];
            const publicComments = ticketComments.filter(c => c.public);
            if (publicComments.length === 0) continue;

            const resolution = publicComments[publicComments.length - 1]?.body || "";
            if (resolution.length < 20) continue;

            const kbId = `kb_zd_${t.id}`;
            const existing = await db.getOne("ai_knowledge", kbId);
            if (existing) continue;

            const entry = {
              id: kbId, title: t.subject || `Zendesk #${t.id}`,
              category: normalizeCategory((t.tags || [])[0] || "General"),
              content: `Issue: ${t.subject}\n\nDescription: ${(t.description || "").substring(0, 500)}\n\nResolution: ${resolution.substring(0, 1000)}`,
              tags: [...(t.tags || []), "zendesk-import", "historical"],
              trainedBy: "Zendesk Historical Import",
              createdAt: t.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              source: "zendesk", zdTicketId: t.id,
            };
            await db.upsert("ai_knowledge", kbId, JSON.stringify(entry));
            trained++;
          }

          console.log(`[ZD AI Training] Trained from ${trained} resolved tickets`);
          return json(res, 200, { success: true, trained, totalResolved: resolved.length });
        } catch (err) {
          return json(res, 500, { error: "Internal server error" });
        }
      }

      return json(res, 404, { error: "Zendesk endpoint not found" });
    } catch (err) {
      console.error("[Zendesk Proxy]", err.message);
      return json(res, 502, { error: "Internal server error" });
    }
    return true;
  };
};

module.exports._internals = {
  buildZendeskSafeSolveDecision,
  buildZendeskSafeSolveApplyPayload,
  zendeskInternalComment,
  collectSafeSolveRiskFlags,
};
