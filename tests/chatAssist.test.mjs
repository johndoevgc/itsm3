import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createChatAssistRoutes = require("../routes/chatAssist.js");
const { rankKbArticles, estimateConfidence, buildSystemPrompt, buildUserPrompt,
  defaultIntake, advanceIntake, assessSeverity, mapPriorityToSev,
  newTicketId, findFieldIndex, nextFieldStage, INTAKE_FIELDS } =
  createChatAssistRoutes.__internal;
const piiRedact = require("../piiRedact.js");
const featureFlags = require("../featureFlags.js");

// ─── Pure helper coverage ────────────────────────────────────────────────

describe("ChatAssist KB ranker", () => {
  const articles = [
    { id: "KB0001", title: "VPN Connection Troubleshooting", content: "Reset VPN client, verify credentials.", tags: ["vpn"] },
    { id: "KB0002", title: "Password Reset Procedure", content: "Use portal.office.com.", tags: ["security"] },
    { id: "KB0099", title: "Printer Setup", content: "Add printer in Settings.", tags: ["printer"] },
  ];

  it("returns top-k by token overlap", () => {
    const top = rankKbArticles(articles, "my vpn keeps dropping connection", 2);
    expect(top.length).toBeGreaterThan(0);
    expect(top[0].article.id).toBe("KB0001");
  });

  it("returns empty when no tokens overlap", () => {
    const top = rankKbArticles(articles, "weather forecast tomorrow", 3);
    expect(top).toEqual([]);
  });

  it("ignores stop-short tokens", () => {
    const top = rankKbArticles(articles, "is my a", 3);
    expect(top).toEqual([]);
  });
});

describe("ChatAssist confidence estimator", () => {
  it("rewards KB citations", () => {
    const ctx = [{ id: "KB0001", title: "VPN", snippet: "x" }];
    const high = estimateConfidence("Try resetting the client [KB0001].", ctx);
    const low = estimateConfidence("Try resetting the client.", ctx);
    expect(high).toBeGreaterThan(low);
  });

  it("penalises 'I don't know' replies", () => {
    const ctx = [];
    const conf = estimateConfidence("I don't know how to help with that.", ctx);
    expect(conf).toBeLessThan(50);
  });
});

describe("ChatAssist prompt assembly", () => {
  it("agent system prompt mentions co-pilot", () => {
    expect(buildSystemPrompt("agent")).toMatch(/co-pilot/i);
  });

  it("customer system prompt mentions escalation", () => {
    expect(buildSystemPrompt("customer")).toMatch(/escalate|live agent|engineer/i);
  });

  it("user prompt embeds KB citations and dialog", () => {
    const session = {
      channel: "agent", ticketId: "INC-1",
      messages: [{ role: "user", text: "first" }, { role: "assistant", text: "ack" }],
    };
    const ctx = [{ id: "KB0001", title: "VPN", snippet: "reset client" }];
    const out = buildUserPrompt(session, ctx, "vpn down");
    expect(out).toMatch(/Linked ticket: INC-1/);
    expect(out).toMatch(/\[KB0001\] VPN/);
    expect(out).toMatch(/user: vpn down/);
  });
});

// ─── Route handler coverage ──────────────────────────────────────────────

function makeMockDb() {
  const store = new Map();
  return {
    _store: store,
    async getOne(coll, id) {
      const row = store.get(`${coll}::${id}`);
      return row ? { id, data: row } : null;
    },
    async getAll(coll) {
      const out = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(`${coll}::`)) out.push({ id: k.split("::")[1], data: v });
      }
      return out;
    },
    async upsert(coll, id, data) { store.set(`${coll}::${id}`, data); },
    async deleteOne(coll, id) { store.delete(`${coll}::${id}`); },
    audit: vi.fn(async () => {}),
  };
}

function jsonHelper(res, status, body) {
  res.statusCode = status;
  res.body = body;
  return body;
}
async function parseBodyHelper(req) { return req._body || {}; }
function makeReq(method, body) { return { method, _body: body, headers: {} }; }
function makeRes() { return { statusCode: 0, body: null, headersSent: false, end: () => {}, writeHead: () => {} }; }

async function setupHandler(callAIImpl) {
  // Force flag on (in-memory cache)
  await featureFlags.init({
    getAll: async () => [{ id: "chat_assist", data: JSON.stringify({
      id: "chat_assist", enabled: true, scope: "all",
      payload: { confidenceThreshold: 75, kbGroundingTopK: 3, customerWidgetEnabled: true },
    }) }],
    upsert: async () => {},
  }, { reloadSec: 0 });

  const db = makeMockDb();
  // Seed a KB article so grounding has something to find
  await db.upsert("kb", "KB0010", JSON.stringify({
    id: "KB0010", title: "Outlook Login Issues", content: "Reset Outlook profile and re-sign-in.", status: "Published", tags: ["email"],
  }));

  const callAI = callAIImpl || (async () => ({ choices: [{ message: { content: "Try [KB0010] and verify network." } }] }));
  const extractAIText = (resp) => resp?.choices?.[0]?.message?.content || "";

  const handle = createChatAssistRoutes({
    db, json: jsonHelper, parseBody: parseBodyHelper, callAI, extractAIText,
    wsServer: { broadcast: vi.fn() },
  });
  return { handle, db, callAI };
}

describe("ChatAssist /session endpoint", () => {
  it("creates an agent session and audits it", async () => {
    const { handle, db } = await setupHandler();
    const req = makeReq("POST", { channel: "agent", ticketId: "INC-42" });
    const res = makeRes();
    const ok = await handle(req, res, "/api/chat-assist/session", null, { authenticated: true, user: { email: "agent@vgc.com" } });
    expect(ok).not.toBe(false);
    expect(res.statusCode).toBe(201);
    expect(res.body.session.channel).toBe("agent");
    expect(res.body.session.ticketId).toBe("INC-42");
    expect(db.audit).toHaveBeenCalled();
  });

  it("rejects customer sessions when customerWidgetEnabled=false", async () => {
    await featureFlags.init({
      getAll: async () => [{ id: "chat_assist", data: JSON.stringify({
        id: "chat_assist", enabled: true, scope: "all", payload: { customerWidgetEnabled: false },
      }) }],
      upsert: async () => {},
    }, { reloadSec: 0 });
    const db = makeMockDb();
    const handle = createChatAssistRoutes({
      db, json: jsonHelper, parseBody: parseBodyHelper,
      callAI: async () => ({}), extractAIText: () => "",
    });
    const req = makeReq("POST", { channel: "customer" });
    const res = makeRes();
    await handle(req, res, "/api/chat-assist/session", null, { authenticated: true, user: { email: "u@x" } });
    expect(res.statusCode).toBe(503);
  });
});

describe("ChatAssist /message endpoint", () => {
  it("redacts PII in stored redactedText, calls AI, returns assistant reply", async () => {
    const { handle, db } = await setupHandler();
    // Bootstrap session
    let req = makeReq("POST", { channel: "agent", ticketId: null });
    let res = makeRes();
    await handle(req, res, "/api/chat-assist/session", null, { authenticated: true, user: { email: "agent@vgc.com" } });
    const sessionId = res.body.session.id;

    req = makeReq("POST", { sessionId, text: "User john.doe@example.com cannot log into Outlook." });
    res = makeRes();
    await handle(req, res, "/api/chat-assist/message", null, { authenticated: true, user: { email: "agent@vgc.com" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.message.role).toBe("assistant");
    expect(res.body.message.text).toBeTruthy();

    // Inspect persisted session to confirm PII was redacted in redactedText
    const stored = JSON.parse(db._store.get(`chat_assist_sessions::${sessionId}`));
    const userMsg = stored.messages.find(m => m.role === "user");
    expect(userMsg.text).toMatch(/john\.doe@example\.com/);          // raw kept
    expect(userMsg.redactedText).not.toMatch(/john\.doe@example\.com/); // redacted version sent to AI
    expect(userMsg.redactedText).toMatch(/\[EMAIL_/);
  });

  it("returns 404 for unknown session", async () => {
    const { handle } = await setupHandler();
    const res = makeRes();
    await handle(makeReq("POST", { sessionId: "nope", text: "hi" }), res, "/api/chat-assist/message", null, { authenticated: true });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 when text missing", async () => {
    const { handle } = await setupHandler();
    const res = makeRes();
    await handle(makeReq("POST", { sessionId: "x" }), res, "/api/chat-assist/message", null, { authenticated: true });
    expect(res.statusCode).toBe(400);
  });

  it("falls back gracefully when AI throws", async () => {
    const { handle } = await setupHandler(async () => { throw new Error("AI down"); });
    let req = makeReq("POST", { channel: "agent" });
    let res = makeRes();
    await handle(req, res, "/api/chat-assist/session", null, { authenticated: true, user: { email: "a@b" } });
    const sessionId = res.body.session.id;
    res = makeRes();
    await handle(makeReq("POST", { sessionId, text: "help" }), res, "/api/chat-assist/message", null, { authenticated: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.message.aiOk).toBe(false);
    expect(res.body.suggestHandoff).toBe(true);
  });
});

describe("ChatAssist /insert endpoint", () => {
  it("requires auth", async () => {
    const { handle } = await setupHandler();
    const res = makeRes();
    await handle(makeReq("POST", { ticketId: "INC-1", text: "hi" }), res, "/api/chat-assist/insert", null, { authenticated: false });
    expect(res.statusCode).toBe(401);
  });

  it("appends to incident activityLog and audits", async () => {
    const { handle, db } = await setupHandler();
    await db.upsert("incidents", "INC-7", JSON.stringify({ id: "INC-7", title: "x", activityLog: [] }));
    const res = makeRes();
    await handle(
      makeReq("POST", { ticketId: "INC-7", text: "Suggested fix: reboot router", source: "copilot" }),
      res, "/api/chat-assist/insert", null,
      { authenticated: true, user: { email: "agent@vgc.com" } },
    );
    expect(res.statusCode).toBe(200);
    const stored = JSON.parse(db._store.get("incidents::INC-7"));
    expect(stored.activityLog.length).toBe(1);
    expect(stored.activityLog[0].detail).toMatch(/Chat Assist/);
    expect(stored.activityLog[0].detail).toMatch(/Suggested fix: reboot router/);
    expect(db.audit).toHaveBeenCalledWith("incidents", "INC-7", "chat-assist:insert", expect.any(String), expect.any(String));
  });
});

describe("ChatAssist /handoff endpoint", () => {
  it("flips session status and broadcasts", async () => {
    const { handle, db } = await setupHandler();
    let res = makeRes();
    await handle(makeReq("POST", { channel: "customer" }), res, "/api/chat-assist/session", null, { authenticated: true, user: { email: "c@x" } });
    const sessionId = res.body.session.id;
    res = makeRes();
    await handle(makeReq("POST", { sessionId, agentId: "agent@x" }), res, "/api/chat-assist/handoff", null, { authenticated: true, user: { email: "c@x" } });
    expect(res.statusCode).toBe(200);
    const stored = JSON.parse(db._store.get(`chat_assist_sessions::${sessionId}`));
    expect(stored.status).toBe("handoff");
    expect(stored.handoff.agentId).toBe("agent@x");
  });
});

describe("ChatAssist disabled flag", () => {
  it("returns 503 when chat_assist flag is off", async () => {
    await featureFlags.init({
      getAll: async () => [{ id: "chat_assist", data: JSON.stringify({
        id: "chat_assist", enabled: false, scope: "all", payload: {},
      }) }],
      upsert: async () => {},
    }, { reloadSec: 0 });
    const db = makeMockDb();
    const handle = createChatAssistRoutes({
      db, json: jsonHelper, parseBody: parseBodyHelper,
      callAI: async () => ({}), extractAIText: () => "",
    });
    const res = makeRes();
    await handle(makeReq("POST", { channel: "agent" }), res, "/api/chat-assist/session", null, { authenticated: true });
    expect(res.statusCode).toBe(503);
  });
});

// Sanity check that piiRedact actually masks the patterns we depend on
describe("PII redaction sanity", () => {
  it("redacts emails", () => {
    const r = piiRedact.redact("contact: foo.bar@example.com please");
    expect(r.redacted).toMatch(/\[EMAIL_1\]/);
    expect(r.map["[EMAIL_1]"]).toBe("foo.bar@example.com");
  });
});

// new tests appended below

describe("ChatAssist rate limiting", () => {
  async function setupWithLimit(limit) {
    await featureFlags.init({
      getAll: async () => [{ id: "chat_assist", data: JSON.stringify({
        id: "chat_assist", enabled: true, scope: "all",
        payload: { rateLimitPerMin: limit, kbGroundingTopK: 3, customerWidgetEnabled: true },
      }) }],
      upsert: async () => {},
    }, { reloadSec: 0 });
    const db = makeMockDb();
    const handle = createChatAssistRoutes({
      db, json: jsonHelper, parseBody: parseBodyHelper,
      callAI: async () => ({ choices: [{ message: { content: "ok" } }] }),
      extractAIText: (r) => r?.choices?.[0]?.message?.content || "",
      wsServer: { broadcast: () => {} },
    });
    return { handle, db };
  }
  function makeReqWithIp(ip, body) {
    return { method: "POST", _body: body, headers: { "x-forwarded-for": ip }, socket: { remoteAddress: ip } };
  }

  it("returns 429 once limit is exceeded for an IP", async () => {
    const { handle } = await setupWithLimit(2);
    let res = makeRes();
    await handle(makeReqWithIp("1.1.1.1", { channel: "agent" }), res, "/api/chat-assist/session", null, { authenticated: true, user: { email: "a@b" } });
    const sessionId = res.body.session.id;
    // First two calls succeed
    for (let i = 0; i < 2; i++) {
      res = makeRes();
      await handle(makeReqWithIp("1.1.1.1", { sessionId, text: `msg ${i}` }), res, "/api/chat-assist/message", null, { authenticated: true });
      expect(res.statusCode).toBe(200);
    }
    // Third hits the limit
    res = makeRes();
    await handle(makeReqWithIp("1.1.1.1", { sessionId, text: "blocked" }), res, "/api/chat-assist/message", null, { authenticated: true });
    expect(res.statusCode).toBe(429);
    expect(res.body.retryAfter).toBeGreaterThan(0);
  });

  it("isolates buckets per IP", async () => {
    const { handle } = await setupWithLimit(1);
    let res = makeRes();
    await handle(makeReqWithIp("2.2.2.2", { channel: "agent" }), res, "/api/chat-assist/session", null, { authenticated: true, user: { email: "a@b" } });
    const sessionId = res.body.session.id;
    res = makeRes();
    await handle(makeReqWithIp("2.2.2.2", { sessionId, text: "first" }), res, "/api/chat-assist/message", null, { authenticated: true });
    expect(res.statusCode).toBe(200);
    // Different IP — fresh bucket
    res = makeRes();
    await handle(makeReqWithIp("3.3.3.3", { sessionId, text: "other ip" }), res, "/api/chat-assist/message", null, { authenticated: true });
    expect(res.statusCode).toBe(200);
  });
});

describe("ChatAssist /feedback endpoint", () => {
  async function bootstrapMessage() {
    const { handle, db } = await setupHandler();
    let res = makeRes();
    await handle(makeReq("POST", { channel: "agent" }), res, "/api/chat-assist/session", null, { authenticated: true, user: { email: "a@b" } });
    const sessionId = res.body.session.id;
    res = makeRes();
    await handle(makeReq("POST", { sessionId, text: "test" }), res, "/api/chat-assist/message", null, { authenticated: true, user: { email: "a@b" } });
    const messageId = res.body.message.id;
    return { handle, db, sessionId, messageId };
  }

  it("rejects bad rating", async () => {
    const { handle, sessionId, messageId } = await bootstrapMessage();
    const res = makeRes();
    await handle(makeReq("POST", { sessionId, messageId, rating: "maybe" }), res, "/api/chat-assist/feedback", null, { authenticated: true });
    expect(res.statusCode).toBe(400);
  });

  it("404s for unknown session", async () => {
    const { handle } = await bootstrapMessage();
    const res = makeRes();
    await handle(makeReq("POST", { sessionId: "nope", messageId: "x", rating: "up" }), res, "/api/chat-assist/feedback", null, { authenticated: true });
    expect(res.statusCode).toBe(404);
  });

  it("404s for unknown message in valid session", async () => {
    const { handle, sessionId } = await bootstrapMessage();
    const res = makeRes();
    await handle(makeReq("POST", { sessionId, messageId: "fake", rating: "up" }), res, "/api/chat-assist/feedback", null, { authenticated: true });
    expect(res.statusCode).toBe(404);
  });

  it("persists feedback row, audits, and annotates the message", async () => {
    const { handle, db, sessionId, messageId } = await bootstrapMessage();
    const res = makeRes();
    await handle(makeReq("POST", { sessionId, messageId, rating: "down", comment: "wrong KB cited" }),
      res, "/api/chat-assist/feedback", null, { authenticated: true, user: { email: "agent@vgc.com" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.feedbackId).toMatch(/^cafb_/);
    // Stored
    const fbKey = [...db._store.keys()].find(k => k.startsWith("ai_learning_feedback::"));
    expect(fbKey).toBeTruthy();
    const fb = JSON.parse(db._store.get(fbKey));
    expect(fb.rating).toBe("down");
    expect(fb.comment).toBe("wrong KB cited");
    expect(fb.sessionId).toBe(sessionId);
    expect(fb.messageId).toBe(messageId);
    // Annotated in session
    const stored = JSON.parse(db._store.get(`chat_assist_sessions::${sessionId}`));
    const msg = stored.messages.find(m => m.id === messageId);
    expect(msg.feedback.rating).toBe("down");
    // Audited
    expect(db.audit).toHaveBeenCalledWith(
      "ai_learning_feedback", expect.any(String), "create",
      expect.any(String), expect.any(String),
    );
  });
});


// ─── VGC AI Assist persona + state machine ───────────────────────────────

describe("VGC AI Assist persona prompt", () => {
  it("uses the full VGC persona for customer channel", () => {
    const p = buildSystemPrompt("customer");
    expect(p).toMatch(/VGC AI Assist/);
    expect(p).toMatch(/Singapore/);
    expect(p).toMatch(/never invent ticket numbers/i);
    expect(p).toMatch(/\[KB0010\]/);
  });
  it("keeps the agent prompt unchanged", () => {
    const p = buildSystemPrompt("agent");
    expect(p).toMatch(/co-pilot/);
    expect(p).not.toMatch(/VGC AI Assist/);
  });
});

describe("VGC AI Assist severity heuristic", () => {
  it("returns P1 for breach keyword", () => {
    expect(assessSeverity({ fields: { description: "We had a data breach!" } })).toBe("P1");
  });
  it("returns P1 for completely-blocked + critical + production keyword", () => {
    expect(assessSeverity({ fields: {
      impact: "Completely blocked", priority: "Critical – need it now",
      description: "Production server down",
    } })).toBe("P1");
  });
  it("returns P2 for completely-blocked alone", () => {
    expect(assessSeverity({ fields: { impact: "Completely blocked" } })).toBe("P2");
  });
  it("returns P3 for minor", () => {
    expect(assessSeverity({ fields: { impact: "Minor inconvenience" } })).toBe("P3");
  });
  it("returns P4 for low / no rush", () => {
    expect(assessSeverity({ fields: { priority: "Low – no rush", impact: "Just checking" } })).toBe("P4");
  });
});

describe("VGC AI Assist priority → severity badge", () => {
  it("maps priorities", () => {
    expect(mapPriorityToSev("Critical – need it now")).toBe("Sev-A");
    expect(mapPriorityToSev("High – within today")).toBe("Sev-B");
    expect(mapPriorityToSev("Normal – within 2 days")).toBe("Sev-C");
    expect(mapPriorityToSev("Low – no rush")).toBe("Sev-D");
  });
});

describe("VGC AI Assist intake state machine", () => {
  function freshSession() {
    return { id: "s1", channel: "customer", messages: [], intake: defaultIntake() };
  }

  it("emits greeting + category card on start-greeting", () => {
    const s = freshSession();
    const m = advanceIntake(s, { kind: "start-greeting" }, "Alice");
    expect(m).toBeTruthy();
    expect(m.text).toMatch(/Hi Alice/);
    expect(m.cards[0].type).toBe("category-grid");
    expect(m.cards[0].options.length).toBe(10);
    expect(s.intake.stage).toBe("category");
  });

  it("advances through category → first field on select-category", () => {
    const s = freshSession();
    advanceIntake(s, { kind: "start-greeting" }, "Alice");
    const m = advanceIntake(s, { kind: "select-category", value: "Email & Outlook" });
    expect(s.intake.category).toBe("Email & Outlook");
    expect(s.intake.stage).toBe("field:title");
    expect(m.text).toMatch(/Email & Outlook/);
  });

  it("walks every text field via answer-field then reaches confirm", () => {
    const s = freshSession();
    advanceIntake(s, { kind: "start-greeting" }, "Alice");
    advanceIntake(s, { kind: "select-category", value: "Device & Hardware" });
    // VGC AI Assist v3.28.4 — short intake: title, description, impact, priority
    advanceIntake(s, { kind: "answer-field", value: "Laptop won't start" });
    expect(s.intake.stage).toBe("field:description");
    advanceIntake(s, { kind: "answer-field", value: "Just won't power on" });
    expect(s.intake.stage).toBe("field:impact");
    advanceIntake(s, { kind: "pick-impact", value: "Completely blocked" });
    expect(s.intake.stage).toBe("field:priority");
    const last = advanceIntake(s, { kind: "pick-priority", value: "Critical – need it now" });
    expect(s.intake.stage).toBe("confirm");
    expect(last.cards[0].type).toBe("intake-summary");
    expect(last.cards[0].fields.title).toBe("Laptop won't start");
    expect(last.cards[0].fields.impact).toBe("Completely blocked");
  });

  it("step-failed escalates after attempts >= 2 (with slot picker)", () => {
    const s = freshSession();
    s.intake.severity = "P3";
    advanceIntake(s, { kind: "step-failed" });
    expect(s.intake.stage).not.toBe("escalated");
    const m = advanceIntake(s, { kind: "step-failed" });
    expect(s.intake.stage).toBe("escalated");
    expect(m.cards.some(c => c.type === "escalated")).toBe(true);
    expect(m.cards.some(c => c.type === "slot-picker")).toBe(true);
  });

  it("step-failed auto-escalates immediately for P1", () => {
    const s = freshSession();
    s.intake.severity = "P1";
    const m = advanceIntake(s, { kind: "step-failed" });
    expect(s.intake.stage).toBe("escalated");
    expect(m.cards.some(c => c.type === "slot-picker")).toBe(true);
  });

  it("mark-resolved transitions to csat with rating card", () => {
    const s = freshSession();
    const m = advanceIntake(s, { kind: "mark-resolved" });
    expect(s.intake.stage).toBe("csat");
    expect(m.cards[0].type).toBe("csat");
    expect(m.cards[0].options.length).toBe(5);
  });

  it("request-agent escalates on demand", () => {
    const s = freshSession();
    s.intake.fields = { impact: "Significant slowdown", priority: "High – within today" };
    const m = advanceIntake(s, { kind: "request-agent" });
    expect(s.intake.stage).toBe("escalated");
    expect(m.cards.some(c => c.type === "slot-picker")).toBe(true);
  });

  it("confirm-intake / edit restarts from category", () => {
    const s = freshSession();
    s.intake.stage = "confirm";
    s.intake.category = "Email & Outlook";
    const m = advanceIntake(s, { kind: "confirm-intake", value: "edit" });
    expect(s.intake.stage).toBe("category");
    expect(m.cards[0].type).toBe("category-grid");
  });

  it("step-result: 'worked' resolves to CSAT", () => {
    const s = freshSession();
    s.intake.stage = "solution";
    const m = advanceIntake(s, { kind: "step-result", value: "worked" });
    expect(s.intake.stage).toBe("csat");
    expect(m.cards[0].type).toBe("csat");
  });

  it("step-result: 'failed' increments attempts", () => {
    const s = freshSession();
    s.intake.stage = "solution";
    s.intake.severity = "P3";
    advanceIntake(s, { kind: "step-result", value: "failed" });
    expect(s.intake.attempts).toBe(1);
    expect(s.intake.stage).not.toBe("escalated");
  });

  it("step-result: 'agent' escalates with slot picker", () => {
    const s = freshSession();
    s.intake.stage = "solution";
    s.intake.fields = { priority: "High – within today" };
    const m = advanceIntake(s, { kind: "step-result", value: "agent" });
    expect(s.intake.stage).toBe("escalated");
    expect(m.cards.some(c => c.type === "slot-picker")).toBe(true);
  });
});

describe("VGC AI Assist newTicketId format", () => {
  it("matches INC-YYYYMMDD-XXXX", () => {
    const id = newTicketId();
    expect(id).toMatch(/^INC-\d{8}-\d{4}$/);
  });
});

describe("VGC AI Assist /create-ticket endpoint", () => {
  async function setupCustomer() {
    await featureFlags.init({
      getAll: async () => [{ id: "chat_assist", data: JSON.stringify({
        id: "chat_assist", enabled: true, scope: "all",
        payload: { kbGroundingTopK: 3, customerWidgetEnabled: true },
      }) }],
      upsert: async () => {},
    }, { reloadSec: 0 });
    const db = makeMockDb();
    const handle = createChatAssistRoutes({
      db, json: jsonHelper, parseBody: parseBodyHelper,
      callAI: async () => ({ choices: [{ message: { content: "ok" } }] }),
      extractAIText: (r) => r?.choices?.[0]?.message?.content || "",
      wsServer: { broadcast: vi.fn() },
    });

    // Create a customer session and walk it through intake.
    let res = makeRes();
    await handle(makeReq("POST", { channel: "customer", customerName: "Alice", customerEmail: "alice@acme.io" }),
      res, "/api/chat-assist/session", null, { authenticated: false });
    const sessionId = res.body.session.id;

    const act = async (kind, value) => {
      const r = makeRes();
      await handle(makeReq("POST", { sessionId, kind, value }), r, "/api/chat-assist/intake-action", null, { authenticated: false });
      return r;
    };
    await act("start-greeting");
    await act("select-category", "Network & Connectivity");
    // Walk fields via /message
    const sendMsg = async (text) => {
      const r = makeRes();
      await handle(makeReq("POST", { sessionId, text }), r, "/api/chat-assist/message", null, { authenticated: false });
      return r;
    };
    await sendMsg("Internet is down");          // title
    await sendMsg("Whole office offline");      // description
    await act("pick-impact", "Completely blocked");
    await act("pick-priority", "Critical – need it now");
    return { handle, db, sessionId };
  }

  it("creates an incident with INC-id, severity, source=chat_assist", async () => {
    const { handle, db, sessionId } = await setupCustomer();
    const res = makeRes();
    await handle(makeReq("POST", { sessionId }), res, "/api/chat-assist/create-ticket", null, { authenticated: false });
    expect(res.statusCode).toBe(201);
    expect(res.body.ticketId).toMatch(/^INC-\d{8}-\d{4}$/);
    expect(["P1", "P2"]).toContain(res.body.severity);
    const incRow = db._store.get(`incidents::${res.body.ticketId}`);
    expect(incRow).toBeTruthy();
    const inc = JSON.parse(incRow);
    expect(inc.source).toBe("chat_assist");
    expect(inc.aiTriaged).toBe(true);
    expect(inc.requesterEmail).toBe("alice@acme.io");
    expect(inc.category).toBe("Network & Connectivity");
    expect(inc.activityLog.length).toBeGreaterThan(0);
  });

  it("is idempotent on second call", async () => {
    const { handle, sessionId } = await setupCustomer();
    let res = makeRes();
    await handle(makeReq("POST", { sessionId }), res, "/api/chat-assist/create-ticket", null, { authenticated: false });
    const ticketId = res.body.ticketId;
    res = makeRes();
    await handle(makeReq("POST", { sessionId }), res, "/api/chat-assist/create-ticket", null, { authenticated: false });
    expect(res.body.alreadyCreated).toBe(true);
    expect(res.body.ticketId).toBe(ticketId);
  });

  it("rejects when intake is incomplete", async () => {
    await featureFlags.init({
      getAll: async () => [{ id: "chat_assist", data: JSON.stringify({
        id: "chat_assist", enabled: true, scope: "all",
        payload: { customerWidgetEnabled: true },
      }) }],
      upsert: async () => {},
    }, { reloadSec: 0 });
    const db = makeMockDb();
    const handle = createChatAssistRoutes({
      db, json: jsonHelper, parseBody: parseBodyHelper,
      callAI: async () => ({}), extractAIText: () => "",
      wsServer: { broadcast: () => {} },
    });
    let res = makeRes();
    await handle(makeReq("POST", { channel: "customer" }), res, "/api/chat-assist/session", null, { authenticated: false });
    const sessionId = res.body.session.id;
    res = makeRes();
    await handle(makeReq("POST", { sessionId }), res, "/api/chat-assist/create-ticket", null, { authenticated: false });
    expect(res.statusCode).toBe(400);
  });
});

describe("VGC AI Assist /csat endpoint", () => {
  async function setupResolved(rating) {
    await featureFlags.init({
      getAll: async () => [{ id: "chat_assist", data: JSON.stringify({
        id: "chat_assist", enabled: true, scope: "all",
        payload: { customerWidgetEnabled: true },
      }) }],
      upsert: async () => {},
    }, { reloadSec: 0 });
    const db = makeMockDb();
    const handle = createChatAssistRoutes({
      db, json: jsonHelper, parseBody: parseBodyHelper,
      callAI: async () => ({}), extractAIText: () => "",
      wsServer: { broadcast: () => {} },
    });
    // Synthesize a session with an aiOk-resolving message.
    const sessionRow = {
      id: "cas_csat_test", channel: "customer", status: "open",
      ticketId: "INC-20240101-0001",
      intake: { ...defaultIntake(), stage: "resolved", category: "Email & Outlook",
        fields: { title: "Outlook won't sync" }, ticketId: "INC-20240101-0001" },
      messages: [
        { id: "m1", role: "assistant", text: "Try resetting your Outlook profile per [KB0010].", aiOk: true },
      ],
    };
    await db.upsert("chat_assist_sessions", sessionRow.id, JSON.stringify(sessionRow));
    const res = makeRes();
    await handle(makeReq("POST", { sessionId: sessionRow.id, rating }), res, "/api/chat-assist/csat", null, { authenticated: false });
    return { handle, db, res, sessionId: sessionRow.id };
  }

  it("rating>=4 + aiOk seeds ai_knowledge with reviewStatus=pending", async () => {
    const { db, res } = await setupResolved(5);
    expect(res.statusCode).toBe(200);
    expect(res.body.kbSeeded).toMatch(/^aik_/);
    const kbRow = db._store.get(`ai_knowledge::${res.body.kbSeeded}`);
    expect(kbRow).toBeTruthy();
    const kb = JSON.parse(kbRow);
    expect(kb.reviewStatus).toBe("pending");
    expect(kb.tags).toContain("ai-generated");
    expect(kb.tags).toContain("csat-5");
  });

  it("low rating does not seed ai_knowledge", async () => {
    const { db, res } = await setupResolved(2);
    expect(res.statusCode).toBe(200);
    expect(res.body.kbSeeded).toBe(null);
    const kbKeys = [...db._store.keys()].filter(k => k.startsWith("ai_knowledge::"));
    expect(kbKeys.length).toBe(0);
  });

  it("rejects invalid rating", async () => {
    await featureFlags.init({
      getAll: async () => [{ id: "chat_assist", data: JSON.stringify({
        id: "chat_assist", enabled: true, scope: "all", payload: { customerWidgetEnabled: true },
      }) }],
      upsert: async () => {},
    }, { reloadSec: 0 });
    const db = makeMockDb();
    const handle = createChatAssistRoutes({
      db, json: jsonHelper, parseBody: parseBodyHelper,
      callAI: async () => ({}), extractAIText: () => "",
      wsServer: { broadcast: () => {} },
    });
    await db.upsert("chat_assist_sessions", "s_bad", JSON.stringify({ id: "s_bad", channel: "customer", messages: [] }));
    const res = makeRes();
    await handle(makeReq("POST", { sessionId: "s_bad", rating: 9 }), res, "/api/chat-assist/csat", null, { authenticated: false });
    expect(res.statusCode).toBe(400);
  });
});

describe("VGC AI Assist /book-slot endpoint", () => {
  async function setupTicket() {
    await featureFlags.init({
      getAll: async () => [{ id: "chat_assist", data: JSON.stringify({
        id: "chat_assist", enabled: true, scope: "all", payload: { customerWidgetEnabled: true },
      }) }],
      upsert: async () => {},
    }, { reloadSec: 0 });
    const db = makeMockDb();
    const broadcast = vi.fn();
    const handle = createChatAssistRoutes({
      db, json: jsonHelper, parseBody: parseBodyHelper,
      callAI: async () => ({}), extractAIText: () => "",
      wsServer: { broadcast },
    });
    await db.upsert("chat_assist_sessions", "s_slot",
      JSON.stringify({ id: "s_slot", channel: "customer", ticketId: "INC-20240101-0007",
        intake: { ...defaultIntake(), ticketId: "INC-20240101-0007" }, messages: [] }));
    await db.upsert("incidents", "INC-20240101-0007",
      JSON.stringify({ id: "INC-20240101-0007", title: "x", activityLog: [] }));
    return { handle, db, broadcast };
  }

  it("appends activityLog and broadcasts WS event", async () => {
    const { handle, db, broadcast } = await setupTicket();
    const res = makeRes();
    const slot = new Date(Date.now() + 86400000).toISOString();
    await handle(makeReq("POST", { sessionId: "s_slot", slotIso: slot }), res, "/api/chat-assist/book-slot", null, { authenticated: false });
    expect(res.statusCode).toBe(200);
    const inc = JSON.parse(db._store.get("incidents::INC-20240101-0007"));
    expect(inc.activityLog.length).toBe(1);
    expect(inc.activityLog[0].type).toBe("slot-booked");
    expect(inc.scheduledRemoteSession.slotIso).toBe(slot);
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: "chat_assist_slot_booked", ticketId: "INC-20240101-0007",
    }));
  });

  it("supports 'other' slot with note", async () => {
    const { handle, db } = await setupTicket();
    const res = makeRes();
    await handle(makeReq("POST", { sessionId: "s_slot", slotIso: "other", note: "Friday after 4pm" }),
      res, "/api/chat-assist/book-slot", null, { authenticated: false });
    expect(res.statusCode).toBe(200);
    const inc = JSON.parse(db._store.get("incidents::INC-20240101-0007"));
    expect(inc.scheduledRemoteSession.other).toBe(true);
    expect(inc.scheduledRemoteSession.customerNote).toBe("Friday after 4pm");
  });
});

describe("VGC AI Assist customer /message guides intake (no AI call)", () => {
  it("answer to a field stage advances stage without invoking AI", async () => {
    await featureFlags.init({
      getAll: async () => [{ id: "chat_assist", data: JSON.stringify({
        id: "chat_assist", enabled: true, scope: "all", payload: { customerWidgetEnabled: true },
      }) }],
      upsert: async () => {},
    }, { reloadSec: 0 });
    const db = makeMockDb();
    const aiSpy = vi.fn(async () => ({ choices: [{ message: { content: "should not be called" } }] }));
    const handle = createChatAssistRoutes({
      db, json: jsonHelper, parseBody: parseBodyHelper,
      callAI: aiSpy, extractAIText: (r) => r?.choices?.[0]?.message?.content || "",
      wsServer: { broadcast: () => {} },
    });
    // Setup customer session at field:title stage
    await db.upsert("chat_assist_sessions", "s_guided", JSON.stringify({
      id: "s_guided", channel: "customer", status: "open",
      intake: { ...defaultIntake(), stage: "field:title", category: "Email & Outlook" },
      messages: [],
    }));
    const res = makeRes();
    await handle(makeReq("POST", { sessionId: "s_guided", text: "Cannot send mail" }),
      res, "/api/chat-assist/message", null, { authenticated: false });
    expect(res.statusCode).toBe(200);
    expect(aiSpy).not.toHaveBeenCalled();
    const stored = JSON.parse(db._store.get("chat_assist_sessions::s_guided"));
    expect(stored.intake.fields.title).toBe("Cannot send mail");
    expect(stored.intake.stage).toBe("field:description");
  });
});

describe("VGC AI Assist field navigation helpers", () => {
  it("nextFieldStage walks all fields and ends at confirm", () => {
    let stage = "category";
    const seen = [];
    while (stage && stage !== "confirm") {
      stage = nextFieldStage(stage);
      seen.push(stage);
    }
    expect(seen[seen.length - 1]).toBe("confirm");
    expect(seen.length).toBe(INTAKE_FIELDS.length + 1);
  });
  it("findFieldIndex returns -1 for non-field stages", () => {
    expect(findFieldIndex("greeting")).toBe(-1);
    expect(findFieldIndex("confirm")).toBe(-1);
    expect(findFieldIndex("field:impact")).toBeGreaterThanOrEqual(0);
  });
});

// ─── Multi-language (en/zh/ms/hi) ────────────────────────────────────────
const { detectLang, t, SUPPORTED_LANGS, I18N } = createChatAssistRoutes.__internal;

describe("VGC AI Assist language detection", () => {
  it("detects Mandarin via CJK ideographs", () => {
    expect(detectLang("我无法登录到电子邮件")).toBe("zh");
  });
  it("detects Hindi via Devanagari", () => {
    expect(detectLang("मेरा कंप्यूटर काम नहीं कर रहा")).toBe("hi");
  });
  it("detects Bahasa Melayu via keywords", () => {
    expect(detectLang("Tolong, saya tidak boleh log masuk")).toBe("ms");
  });
  it("defaults to English", () => {
    expect(detectLang("My computer is broken")).toBe("en");
    expect(detectLang("")).toBe("en");
    expect(detectLang(null)).toBe("en");
  });
  it("supports exactly en/zh/ms/hi", () => {
    expect(SUPPORTED_LANGS.sort()).toEqual(["en", "hi", "ms", "zh"]);
  });
  it("translates greeting for every supported lang", () => {
    for (const lang of SUPPORTED_LANGS) {
      const greet = t("greetingTemplate", lang, "Alice");
      expect(greet).toBeTruthy();
      expect(typeof greet).toBe("string");
      expect(greet).toContain("Alice");
    }
  });
  it("falls back to English for unknown lang", () => {
    expect(t("csatThanksHigh", "fr")).toBe(I18N.csatThanksHigh.en);
  });
});

describe("VGC AI Assist /message detects language on first turn", () => {
  it("zh: stores lang on intake and replies in Chinese greeting", async () => {
    await featureFlags.init({
      getAll: async () => [{ id: "chat_assist", data: JSON.stringify({
        id: "chat_assist", enabled: true, scope: "all",
        payload: { customerWidgetEnabled: true },
      }) }],
      upsert: async () => {},
    }, { reloadSec: 0 });
    const db = makeMockDb();
    const handle = createChatAssistRoutes({
      db, json: jsonHelper, parseBody: parseBodyHelper,
      callAI: async () => ({}), extractAIText: () => "",
      wsServer: { broadcast: () => {} },
    });
    db._store.set("chat_assist_sessions::s_zh", JSON.stringify({
      id: "s_zh", channel: "customer", status: "open", messages: [],
      intake: defaultIntake(), customerName: "Wei",
    }));
    const res = makeRes();
    await handle(makeReq("POST", { sessionId: "s_zh", text: "我的电脑坏了" }),
      res, "/api/chat-assist/message", null, { authenticated: false });
    expect(res.statusCode).toBe(200);
    const stored = JSON.parse(db._store.get("chat_assist_sessions::s_zh"));
    expect(stored.intake.lang).toBe("zh");
    // Greeting should contain Chinese characters
    expect(/[\u4E00-\u9FFF]/.test(res.body.message.text)).toBe(true);
  });
});

// ─── Promote-to-KB ───────────────────────────────────────────────────────
describe("ChatAssist /promote-to-kb endpoint", () => {
  async function setup() {
    await featureFlags.init({
      getAll: async () => [{ id: "chat_assist", data: JSON.stringify({
        id: "chat_assist", enabled: true, scope: "all", payload: {},
      }) }],
      upsert: async () => {},
    }, { reloadSec: 0 });
    const db = makeMockDb();
    const handle = createChatAssistRoutes({
      db, json: jsonHelper, parseBody: parseBodyHelper,
      callAI: async () => ({}), extractAIText: () => "",
      wsServer: { broadcast: () => {} },
    });
    db._store.set("chat_assist_sessions::s_promote", JSON.stringify({
      id: "s_promote", channel: "agent", status: "open", ticketId: "INC-1",
      messages: [{ id: "m1", role: "assistant", text: "Restart the print spooler." }],
    }));
    return { handle, db };
  }
  it("creates ai_knowledge with reviewStatus=pending and source=agent_promote", async () => {
    const { handle, db } = await setup();
    const res = makeRes();
    await handle(makeReq("POST", {
      sessionId: "s_promote", messageId: "m1",
      title: "Print spooler fix", category: "Printer", tags: ["print", "windows"],
    }), res, "/api/chat-assist/promote-to-kb", null, { authenticated: true, user: { email: "agent@vgc" } });
    expect(res.statusCode).toBe(201);
    expect(res.body.kbId).toMatch(/^aik_/);
    const kbRow = db._store.get(`ai_knowledge::${res.body.kbId}`);
    const kb = JSON.parse(kbRow);
    expect(kb.reviewStatus).toBe("pending");
    expect(kb.title).toBe("Print spooler fix");
    expect(kb.category).toBe("Printer");
    expect(kb.tags).toEqual(["print", "windows"]);
    expect(kb.sourceTicketId).toBe("INC-1");
    expect(kb.sourceMessageId).toBe("m1");
    expect(kb.content).toBe("Restart the print spooler.");
    expect(db.audit).toHaveBeenCalledWith("ai_knowledge", res.body.kbId, "create",
      expect.any(String), "agent@vgc");
  });
  it("rejects unauthenticated", async () => {
    const { handle } = await setup();
    const res = makeRes();
    await handle(makeReq("POST", { sessionId: "s_promote", messageId: "m1" }),
      res, "/api/chat-assist/promote-to-kb", null, { authenticated: false });
    expect(res.statusCode).toBe(401);
  });
  it("rejects when content + messageId both missing", async () => {
    const { handle } = await setup();
    const res = makeRes();
    await handle(makeReq("POST", { sessionId: "s_promote" }),
      res, "/api/chat-assist/promote-to-kb", null, { authenticated: true });
    expect(res.statusCode).toBe(400);
  });
});

// ─── Funnel analytics ────────────────────────────────────────────────────
describe("ChatAssist /analytics/funnel endpoint", () => {
  it("aggregates funnel stages and language breakdown", async () => {
    await featureFlags.init({
      getAll: async () => [{ id: "chat_assist", data: JSON.stringify({
        id: "chat_assist", enabled: true, scope: "all", payload: {},
      }) }],
      upsert: async () => {},
    }, { reloadSec: 0 });
    const db = makeMockDb();
    const handle = createChatAssistRoutes({
      db, json: jsonHelper, parseBody: parseBodyHelper,
      callAI: async () => ({}), extractAIText: () => "",
      wsServer: { broadcast: () => {} },
    });
    const now = new Date().toISOString();
    db._store.set("ai_assist_funnel_events::e1", JSON.stringify({
      id: "e1", sessionId: "s1", channel: "customer", lang: "en", fromStage: "greeting", toStage: "category", at: now,
    }));
    db._store.set("ai_assist_funnel_events::e2", JSON.stringify({
      id: "e2", sessionId: "s1", channel: "customer", lang: "en", fromStage: "confirm", toStage: "solution", at: now,
    }));
    db._store.set("ai_assist_funnel_events::e3", JSON.stringify({
      id: "e3", sessionId: "s2", channel: "customer", lang: "zh", fromStage: "greeting", toStage: "category", at: now,
    }));
    const res = makeRes();
    await handle({ method: "GET", url: "/api/chat-assist/analytics/funnel", headers: { host: "x" } },
      res, "/api/chat-assist/analytics/funnel", null, { authenticated: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.totalEvents).toBe(3);
    expect(res.body.totalSessions).toBe(2);
    expect(res.body.languageBreakdown).toEqual({ en: 1, zh: 1 });
    const cat = res.body.funnel.find(f => f.stage === "category");
    expect(cat.sessions).toBe(2);
    const sol = res.body.funnel.find(f => f.stage === "solution");
    expect(sol.sessions).toBe(1);
  });
});

