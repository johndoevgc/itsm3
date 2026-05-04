/**
 * routes/teamsBot.js — Microsoft Teams bot webhook.
 *
 * Receives Bot Framework activities at POST /api/teams/messages, maps the
 * conversation to a chat_assist_sessions row (channel:"teams"), forwards
 * the user text into the existing /api/chat-assist/message handler, and
 * returns the AI/intake response rendered as an Adaptive Card.
 *
 * v3.33.1 (Phase 3 — Omnichannel intake). This file ships the channel-
 * agnostic plumbing only — there is NO Bot Framework SDK dependency, no
 * outbound `serviceUrl` callback, and no Teams app catalog wiring. A real
 * Teams bot front-door (BotFrameworkAdapter, JWT validation, sendActivity
 * back to serviceUrl) is layered in v3.33.1a once the manifest is approved
 * in Microsoft Partner Center.
 *
 *   POST /api/teams/messages    — webhook (Adaptive Card response)
 *   GET  /api/teams/health      — readiness ping
 *   GET  /api/teams/sessions    — admin-only list of teams sessions
 *
 * Auth: requires `omnichannel_teams` feature flag enabled. The webhook
 * itself authenticates via the `TEAMS_BOT_SHARED_SECRET` env var sent in
 * the `X-Teams-Bot-Secret` request header. In prod, replace with proper
 * Bot Framework JWT validation (TODO v3.33.1a).
 */

"use strict";

const featureFlags = require("../featureFlags");
const chatCards = require("../src/utils/chatCards.cjs");

const SESSION_COLLECTION = "chat_assist_sessions";

function getFlagPayload() {
  try {
    if (!featureFlags.isEnabled("omnichannel_teams")) return null;
    return featureFlags.payload("omnichannel_teams") || {};
  } catch { return null; }
}

function newSessionId() {
  return "TEAMS-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function newMessageId() {
  return "MSG-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// ─── Find/create a session keyed to the Teams conversation ───────────────
async function findOrCreateSession(db, activity, opts = {}) {
  const conversationId = activity?.conversation?.id;
  if (!conversationId) return null;

  // Lightweight scan — chat_assist_sessions is small (~thousands max).
  // Add a secondary index when Teams traffic justifies it.
  const all = (await db.getAll(SESSION_COLLECTION)) || [];
  for (const row of all) {
    let data;
    try { data = JSON.parse(row.data); } catch { continue; }
    if (data && data.botConversationId === conversationId && data.channel === "teams") {
      return data;
    }
  }

  const from = activity.from || {};
  const upn = from.aadObjectId || from.email || from.id || "anonymous";
  const session = {
    id: newSessionId(),
    channel: "teams",
    botConversationId: conversationId,
    botServiceUrl: activity.serviceUrl || null,
    customerName: from.name || null,
    customerEmail: from.email || null,
    customerUpn: upn,
    createdBy: from.name || "teams-user",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "open",
    messages: [],
    intake: null, // teams channel uses free-form chat; intake form lives in customer portal
    history: [],
  };
  await db.upsert(SESSION_COLLECTION, session.id, JSON.stringify(session));
  try {
    await db.audit(SESSION_COLLECTION, session.id, "create",
      JSON.stringify({ channel: "teams", botConversationId: conversationId, upn }),
      session.createdBy);
  } catch { /* non-fatal */ }
  if (opts.onCreated) try { opts.onCreated(session); } catch { /* ignore */ }
  return session;
}

// Synthesize a Node http req/res pair so we can call the chatAssist handler
// in-process without spinning a localhost socket. Keeps a single source of
// truth for AI grounding, PII redaction, rate-limit, etc.
function _fakeReq(method, url, body) {
  const { Readable } = require("stream");
  const payload = body ? Buffer.from(JSON.stringify(body), "utf8") : Buffer.alloc(0);
  const r = Readable.from(payload.length ? [payload] : []);
  r.method = method;
  r.url = url;
  r.headers = { "content-type": "application/json", "content-length": String(payload.length) };
  r.socket = { remoteAddress: "127.0.0.1" };
  r.connection = r.socket;
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
    get _headers() { return headers; },
  };
  return res;
}

// ─── Forward into the chatAssist message handler ─────────────────────────
async function _forwardToChatAssist(ctx, session, text, authResult) {
  if (!ctx.handleChatAssistRef || !ctx.handleChatAssistRef.fn) {
    throw new Error("chatAssist handler not registered");
  }
  const req = _fakeReq("POST", "/api/chat-assist/message", { sessionId: session.id, text });
  const res = _fakeRes();
  await ctx.handleChatAssistRef.fn(req, res, "/api/chat-assist/message",
    { authenticated: true, name: session.customerName || "teams-user", role: "Customer" },
    authResult || { authenticated: true, user: session.customerName || "teams-user", role: "Customer" });
  let parsed = {};
  try { parsed = JSON.parse(res._body || "{}"); } catch { /* ignore */ }
  return { status: res._status, body: parsed };
}

module.exports = function createTeamsBotRoutes(ctx) {
  const { db, json, parseBody } = ctx;

  return async function handleTeamsBot(req, res, pathname) {
    if (!pathname.startsWith("/api/teams/")) return false;

    // ─── GET /api/teams/health ────────────────────────────────────────
    if (pathname === "/api/teams/health" && req.method === "GET") {
      const flag = getFlagPayload();
      return json(res, 200, {
        ok: true,
        enabled: !!flag,
        payload: flag || null,
        secretConfigured: !!process.env.TEAMS_BOT_SHARED_SECRET,
      });
    }

    // ─── GET /api/teams/sessions (admin) ──────────────────────────────
    if (pathname === "/api/teams/sessions" && req.method === "GET") {
      // ctx may not pass authResult into routes that take 3 args; reach via req
      const role = req._authRole;
      if (!["VGC Dev Admin", "Tenant Admin", "Administrator"].includes(role)) {
        return json(res, 403, { error: "Admin only" });
      }
      const all = (await db.getAll(SESSION_COLLECTION)) || [];
      const teams = all.map(r => { try { return JSON.parse(r.data); } catch { return null; } })
        .filter(s => s && s.channel === "teams")
        .map(s => ({
          id: s.id, conversationId: s.botConversationId, customerName: s.customerName,
          customerUpn: s.customerUpn, status: s.status, msgCount: (s.messages || []).length,
          createdAt: s.createdAt, updatedAt: s.updatedAt,
        }));
      return json(res, 200, { sessions: teams, count: teams.length });
    }

    // ─── POST /api/teams/messages — Bot Framework webhook ─────────────
    if (pathname === "/api/teams/messages" && req.method === "POST") {
      const flag = getFlagPayload();
      if (!flag) return json(res, 503, { error: "omnichannel_teams disabled" });

      // Shared-secret gate (replace with Bot Framework JWT in v3.33.1a).
      const expected = process.env.TEAMS_BOT_SHARED_SECRET;
      if (expected) {
        const got = req.headers["x-teams-bot-secret"];
        if (got !== expected) return json(res, 401, { error: "invalid bot secret" });
      }

      let activity;
      try { activity = await parseBody(req); }
      catch (err) { return json(res, 400, { error: "Invalid JSON: " + err.message }); }

      if (!activity || typeof activity !== "object") {
        return json(res, 400, { error: "missing activity" });
      }
      const aType = String(activity.type || "").toLowerCase();
      // Only handle "message" activities — everything else (typing, conversationUpdate)
      // gets a 200 ACK so Teams doesn't retry.
      if (aType !== "message") {
        return json(res, 200, { handled: false, type: aType });
      }
      const text = String(activity.text || "").trim();
      if (!text) return json(res, 400, { error: "empty message text" });

      let session;
      try {
        session = await findOrCreateSession(db, activity);
      } catch (err) {
        console.error("[TeamsBot] session lookup failed:", err.message);
        return json(res, 500, { error: "session lookup failed" });
      }
      if (!session) return json(res, 400, { error: "missing conversation.id" });

      let forward;
      try {
        forward = await _forwardToChatAssist(ctx, session, text, null);
      } catch (err) {
        console.error("[TeamsBot] forward failed:", err.message);
        return json(res, 502, { error: "chatAssist forward failed: " + err.message });
      }

      if (forward.status >= 400) {
        return json(res, forward.status, forward.body);
      }
      const message = forward.body && forward.body.message ? forward.body.message : null;
      const card = buildResponse(message, flag);
      try {
        await db.audit(SESSION_COLLECTION, session.id, "teams.message",
          JSON.stringify({ inLen: text.length, outLen: (message?.text || "").length }),
          session.customerName || "teams-user");
      } catch { /* non-fatal */ }

      return json(res, 200, {
        type: "message",
        sessionId: session.id,
        text: message?.text || "",
        attachments: card ? [{
          contentType: "application/vnd.microsoft.card.adaptive",
          content: card,
        }] : [],
        suggestHandoff: !!forward.body.suggestHandoff,
      });
    }

    return false;
  };
};

// Build the outbound Adaptive Card for a chatAssist reply. Picks the first
// rich card in `message.cards` (if any) so quick-replies render as buttons.
function buildResponse(message, flag) {
  if (!message || typeof message !== "object") return null;
  const maxReplyChars = Number(flag?.maxReplyChars) || 2800;
  const richCard = Array.isArray(message.cards) && message.cards.find(c =>
    c && (c.type === "quick-reply" || c.type === "category-grid" || c.kind === "step-result"));
  if (richCard) {
    return chatCards.buildAdaptiveCard({
      text: message.text,
      kind: richCard.kind,
      type: richCard.type,
      options: richCard.options,
    }, { maxReplyChars });
  }
  return chatCards.buildAdaptiveCard({
    text: message.text,
    type: "text",
  }, { maxReplyChars });
}

module.exports.__internal = {
  buildResponse,
  findOrCreateSession,
  newSessionId,
  newMessageId,
  _fakeReq,
  _fakeRes,
};
