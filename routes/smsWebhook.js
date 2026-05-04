/**
 * routes/smsWebhook.js — Azure Communication Services (ACS) SMS adapter.
 *
 * Receives ACS Event Grid SMS-received events at POST /api/sms/webhook,
 * maps the inbound phone number to a chat_assist_sessions row keyed by
 * E.164 number (channel:"sms"), forwards the body in-process to the
 * existing chatAssist message handler, and returns a numbered SMS reply
 * built by src/utils/chatCards.cjs#buildSmsText.
 *
 * v3.33.2 (Phase 3 — Omnichannel intake). Same architectural pattern as
 * routes/teamsBot.js (v3.33.1): NO outbound ACS SMS send is wired here —
 * the webhook returns the reply payload to the caller, and a separate
 * scheduled relay (TODO v3.33.2a) will push it back via the ACS SDK.
 *
 *   POST /api/sms/webhook       — Event Grid webhook
 *                                 (CloudEvents 1.0 + Event Grid v1 schema)
 *   GET  /api/sms/health        — readiness ping
 *   GET  /api/sms/sessions      — admin-only list of sms sessions
 *
 * Per-customer daily message cap (defaults to 30/day) lives in the
 * `omnichannel_sms` flag payload to keep ACS billing predictable. When
 * the cap is hit the webhook still 200s but returns a "limit hit" reply.
 */

"use strict";

const featureFlags = require("../featureFlags");
const chatCards = require("../src/utils/chatCards.cjs");

const SESSION_COLLECTION = "chat_assist_sessions";
const SMS_DAILY_CAP_DEFAULT = 30;

function getFlagPayload() {
  try {
    if (!featureFlags.isEnabled("omnichannel_sms")) return null;
    return featureFlags.payload("omnichannel_sms") || {};
  } catch { return null; }
}

function newSessionId() {
  return "SMS-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// ─── E.164 normalisation ──────────────────────────────────────────────
// ACS gives us numbers in "+65XXXXXXXX" form; strip whitespace just in case.
function normalisePhone(num) {
  if (!num) return null;
  const s = String(num).trim().replace(/\s+/g, "");
  if (!/^\+[1-9]\d{6,14}$/.test(s)) return null;
  return s;
}

// ─── Find/create a session keyed to the originating phone number ─────
async function findOrCreateSession(db, fromNumber, opts = {}) {
  const phone = normalisePhone(fromNumber);
  if (!phone) return null;

  const all = (await db.getAll(SESSION_COLLECTION)) || [];
  for (const row of all) {
    let data;
    try { data = JSON.parse(row.data); } catch { continue; }
    if (data && data.channel === "sms" && data.customerPhone === phone) {
      return data;
    }
  }

  const session = {
    id: newSessionId(),
    channel: "sms",
    customerPhone: phone,
    customerName: opts.customerName || null,
    customerEmail: null,
    createdBy: phone,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "open",
    messages: [],
    intake: null,
    history: [],
    smsLastOptions: [],   // last numbered options sent (for resolveSmsReply)
    smsDailyCount: 0,
    smsDailyResetAt: new Date().toISOString().slice(0, 10), // YYYY-MM-DD
  };
  await db.upsert(SESSION_COLLECTION, session.id, JSON.stringify(session));
  try {
    await db.audit(SESSION_COLLECTION, session.id, "create",
      JSON.stringify({ channel: "sms", phone }), phone);
  } catch { /* non-fatal */ }
  return session;
}

// Daily cap enforcement — increments the per-session counter. Resets at
// the UTC date boundary (good enough for SG/MY at GMT+8 — the cap is a
// soft cost guard, not a regulatory limit).
function _bumpDailyCap(session, capPerDay) {
  const today = new Date().toISOString().slice(0, 10);
  if (session.smsDailyResetAt !== today) {
    session.smsDailyResetAt = today;
    session.smsDailyCount = 0;
  }
  session.smsDailyCount = (session.smsDailyCount || 0) + 1;
  return session.smsDailyCount > capPerDay;
}

// In-process forward to chatAssist (mirrors teamsBot pattern).
function _fakeReq(method, url, body) {
  const { Readable } = require("stream");
  const payload = body ? Buffer.from(JSON.stringify(body), "utf8") : Buffer.alloc(0);
  const r = Readable.from(payload.length ? [payload] : []);
  r.method = method;
  r.url = url;
  r.headers = { "content-type": "application/json", "content-length": String(payload.length) };
  r.socket = { remoteAddress: "127.0.0.1" };
  r.connection = r.socket;
  // Expose the parsed body directly so in-process handlers/tests don't need
  // to drain the stream a second time.
  r._parsedBody = body;
  return r;
}

function _fakeRes() {
  let chunks = [];
  let status = 200;
  const headers = {};
  const res = {
    headersSent: false,
    statusCode: 200,
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    removeHeader(k) { delete headers[String(k).toLowerCase()]; },
    writeHead(s, h) { status = s; res.statusCode = s; if (h) for (const k of Object.keys(h)) headers[k.toLowerCase()] = h[k]; res.headersSent = true; },
    write(c) { if (c != null) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c), "utf8")); },
    end(c) { if (c != null) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c), "utf8")); res.headersSent = true; res._done = true; },
    get _status() { return status; },
    get _body() { return Buffer.concat(chunks).toString("utf8"); },
  };
  return res;
}

async function _forwardToChatAssist(ctx, session, text) {
  if (!ctx.handleChatAssistRef || !ctx.handleChatAssistRef.fn) {
    throw new Error("chatAssist handler not registered");
  }
  const req = _fakeReq("POST", "/api/chat-assist/message", { sessionId: session.id, text });
  const res = _fakeRes();
  await ctx.handleChatAssistRef.fn(req, res, "/api/chat-assist/message",
    { authenticated: true, name: session.customerPhone, role: "Customer" },
    { authenticated: true, user: session.customerPhone, role: "Customer" });
  let parsed = {};
  try { parsed = JSON.parse(res._body || "{}"); } catch { /* ignore */ }
  return { status: res._status, body: parsed };
}

// ─── ACS Event Grid event extraction ────────────────────────────────
// Event Grid sends an ARRAY of events. Each can be either CloudEvents 1.0
// or Event Grid v1 schema. ACS SMS receives use the type:
//   "Microsoft.Communication.SMSReceived"
// data shape: { messageId, from, to, message, receivedTimestamp }.
function extractSmsEvents(payload) {
  if (!payload) return [];
  const events = Array.isArray(payload) ? payload : [payload];
  const out = [];
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    const type = e.eventType || e.type || "";
    if (!/SMSReceived/i.test(type)) continue;
    const data = e.data || {};
    const text = String(data.message || "").trim();
    const from = data.from;
    const to = data.to;
    if (!from || !text) continue;
    out.push({
      messageId: data.messageId || e.id || null,
      from, to, text,
      receivedTimestamp: data.receivedTimestamp || e.eventTime || e.time || null,
    });
  }
  return out;
}

// Did the customer just answer a numbered list we sent earlier? If so,
// resolve "2" → the option they meant and use that as the forward text.
function resolveNumberedReply(session, text) {
  if (!Array.isArray(session.smsLastOptions) || !session.smsLastOptions.length) return null;
  return chatCards.resolveSmsReply(text, session.smsLastOptions);
}

module.exports = function createSmsWebhookRoutes(ctx) {
  const { db, json, parseBody } = ctx;

  return async function handleSmsWebhook(req, res, pathname) {
    if (!pathname.startsWith("/api/sms/")) return false;

    // ─── GET /api/sms/health ────────────────────────────────────────
    if (pathname === "/api/sms/health" && req.method === "GET") {
      const flag = getFlagPayload();
      return json(res, 200, {
        ok: true,
        enabled: !!flag,
        payload: flag || null,
        secretConfigured: !!process.env.ACS_WEBHOOK_SHARED_SECRET,
      });
    }

    // ─── GET /api/sms/sessions (admin) ──────────────────────────────
    if (pathname === "/api/sms/sessions" && req.method === "GET") {
      const role = req._authRole;
      if (!["VGC Dev Admin", "Tenant Admin", "Administrator"].includes(role)) {
        return json(res, 403, { error: "Admin only" });
      }
      const all = (await db.getAll(SESSION_COLLECTION)) || [];
      const sms = all.map(r => { try { return JSON.parse(r.data); } catch { return null; } })
        .filter(s => s && s.channel === "sms")
        .map(s => ({
          id: s.id, customerPhone: s.customerPhone, customerName: s.customerName,
          status: s.status, msgCount: (s.messages || []).length,
          smsDailyCount: s.smsDailyCount || 0,
          createdAt: s.createdAt, updatedAt: s.updatedAt,
        }));
      return json(res, 200, { sessions: sms, count: sms.length });
    }

    // ─── POST /api/sms/webhook ──────────────────────────────────────
    if (pathname === "/api/sms/webhook" && req.method === "POST") {
      // Event Grid validation handshake. When configuring the subscription
      // Event Grid sends a Microsoft.EventGrid.SubscriptionValidationEvent;
      // we must echo back validationCode. Detected before flag check so the
      // subscription can be wired up before turning the flag on.
      let payload;
      try { payload = await parseBody(req); }
      catch (err) { return json(res, 400, { error: "Invalid JSON: " + err.message }); }
      const handshake = _detectValidation(payload);
      if (handshake) return json(res, 200, { validationResponse: handshake });

      const flag = getFlagPayload();
      if (!flag) return json(res, 503, { error: "omnichannel_sms disabled" });

      // Optional shared-secret header (replace with Event Grid signature
      // verification in v3.33.2a once the SDK is wired).
      const expected = process.env.ACS_WEBHOOK_SHARED_SECRET;
      if (expected) {
        const got = req.headers["x-acs-webhook-secret"];
        if (got !== expected) return json(res, 401, { error: "invalid webhook secret" });
      }

      const events = extractSmsEvents(payload);
      if (!events.length) return json(res, 200, { handled: 0 });

      const cap = Number(flag.dailyCapPerNumber) || SMS_DAILY_CAP_DEFAULT;
      const replies = [];
      for (const ev of events) {
        let session;
        try { session = await findOrCreateSession(db, ev.from); }
        catch (err) {
          replies.push({ from: ev.from, error: "session lookup failed: " + err.message });
          continue;
        }
        if (!session) {
          replies.push({ from: ev.from, error: "invalid phone number" });
          continue;
        }

        const overCap = _bumpDailyCap(session, cap);
        if (overCap) {
          await db.upsert(SESSION_COLLECTION, session.id, JSON.stringify(session));
          replies.push({
            from: ev.from, sessionId: session.id,
            text: "You've hit today's SMS limit. Reply tomorrow or open the portal: " +
                  (process.env.PORTAL_URL || "https://portal.vgc.com"),
            options: [],
            capped: true,
          });
          continue;
        }

        // Resolve numbered reply if the previous turn sent options.
        let forwardText = ev.text;
        const resolved = resolveNumberedReply(session, ev.text);
        if (resolved) forwardText = resolved.value;

        let forward;
        try { forward = await _forwardToChatAssist(ctx, session, forwardText); }
        catch (err) {
          replies.push({ from: ev.from, sessionId: session.id, error: err.message });
          continue;
        }
        if (forward.status >= 400) {
          replies.push({ from: ev.from, sessionId: session.id, error: "chatAssist " + forward.status });
          continue;
        }
        const message = forward.body && forward.body.message ? forward.body.message : null;
        // Pick the first quick-reply card if present so we can send a
        // numbered SMS list.
        const richCard = message && Array.isArray(message.cards)
          && message.cards.find(c => c && (c.type === "quick-reply" || c.type === "category-grid"));
        const sms = chatCards.buildSmsText({
          text: message?.text || "",
          options: richCard ? richCard.options : [],
        }, { maxLen: Number(flag.maxSmsLen) || 480 });

        // Persist the numbered options so the next inbound "2" can be resolved.
        // Reload session (chatAssist appended messages already).
        try {
          const fresh = await db.getOne(SESSION_COLLECTION, session.id);
          const data = fresh && fresh.data ? JSON.parse(fresh.data) : session;
          data.smsLastOptions = sms.options || [];
          data.smsDailyCount = session.smsDailyCount;
          data.smsDailyResetAt = session.smsDailyResetAt;
          data.updatedAt = new Date().toISOString();
          await db.upsert(SESSION_COLLECTION, session.id, JSON.stringify(data));
        } catch { /* non-fatal */ }

        try {
          await db.audit(SESSION_COLLECTION, session.id, "sms.message",
            JSON.stringify({ inLen: ev.text.length, outLen: sms.text.length, capped: false }),
            session.customerPhone);
        } catch { /* non-fatal */ }

        replies.push({
          from: ev.from, sessionId: session.id,
          text: sms.text, options: sms.options,
          suggestHandoff: !!forward.body.suggestHandoff,
        });
      }

      return json(res, 200, { handled: events.length, replies });
    }

    return false;
  };
};

// Event Grid subscription validation handshake. Returns the validationCode
// when the payload is a SubscriptionValidationEvent, otherwise null.
function _detectValidation(payload) {
  if (!payload) return null;
  const events = Array.isArray(payload) ? payload : [payload];
  for (const e of events) {
    const type = e?.eventType || e?.type || "";
    if (/SubscriptionValidation/i.test(type)) {
      const code = e?.data?.validationCode || e?.validationCode;
      if (code) return code;
    }
  }
  return null;
}

module.exports.__internal = {
  extractSmsEvents,
  normalisePhone,
  findOrCreateSession,
  resolveNumberedReply,
  _bumpDailyCap,
  _detectValidation,
  newSessionId,
};
