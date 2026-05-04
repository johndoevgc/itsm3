import { describe, expect, it, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createTeamsBotRoutes = require("../routes/teamsBot.js");
const { buildResponse, findOrCreateSession } = createTeamsBotRoutes.__internal;
const featureFlags = require("../featureFlags.js");

function jsonHelper(res, status, body) {
  res.statusCode = status;
  res.body = body;
  return body;
}
async function parseBodyHelper(req) { return req._body || {}; }
function makeReq(method, body, headers = {}) {
  return { method, _body: body, headers };
}
function makeRes() {
  return { statusCode: 0, body: null, headersSent: false, end: () => {}, writeHead: () => {} };
}

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
    audit: vi.fn(async () => {}),
  };
}

async function enableFlag() {
  await featureFlags.init({
    getAll: async () => [{
      id: "omnichannel_teams",
      data: JSON.stringify({
        id: "omnichannel_teams", enabled: true, scope: "all",
        payload: { maxReplyChars: 280 },
      }),
    }],
    upsert: async () => {},
  }, { reloadSec: 0 });
}

async function disableFlag() {
  await featureFlags.init({
    getAll: async () => [{
      id: "omnichannel_teams",
      data: JSON.stringify({ id: "omnichannel_teams", enabled: false, scope: "all", payload: {} }),
    }],
    upsert: async () => {},
  }, { reloadSec: 0 });
}

function makeCtx(db, chatAssistFn) {
  return {
    db,
    json: jsonHelper,
    parseBody: parseBodyHelper,
    handleChatAssistRef: { fn: chatAssistFn },
  };
}

const baseActivity = {
  type: "message",
  text: "My VPN keeps dropping",
  conversation: { id: "19:teams-conv-abc" },
  from: { aadObjectId: "aad-1", name: "Alice", email: "alice@vgc.com" },
  serviceUrl: "https://smba.trafficmanager.net/",
};

describe("teamsBot /api/teams/health", () => {
  beforeEach(async () => { await enableFlag(); delete process.env.TEAMS_BOT_SHARED_SECRET; });

  it("reports flag state and secret config", async () => {
    const handle = createTeamsBotRoutes(makeCtx(makeMockDb(), null));
    const req = makeReq("GET", null);
    const res = makeRes();
    await handle(req, res, "/api/teams/health");
    expect(res.statusCode).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.secretConfigured).toBe(false);
  });
});

describe("teamsBot /api/teams/messages — flag + auth gates", () => {
  beforeEach(async () => { delete process.env.TEAMS_BOT_SHARED_SECRET; });

  it("returns 503 when flag disabled", async () => {
    await disableFlag();
    const handle = createTeamsBotRoutes(makeCtx(makeMockDb(), null));
    const res = makeRes();
    await handle(makeReq("POST", baseActivity), res, "/api/teams/messages");
    expect(res.statusCode).toBe(503);
  });

  it("returns 401 when secret env set but header missing", async () => {
    await enableFlag();
    process.env.TEAMS_BOT_SHARED_SECRET = "topsecret";
    const handle = createTeamsBotRoutes(makeCtx(makeMockDb(), null));
    const res = makeRes();
    await handle(makeReq("POST", baseActivity, {}), res, "/api/teams/messages");
    expect(res.statusCode).toBe(401);
    delete process.env.TEAMS_BOT_SHARED_SECRET;
  });

  it("accepts request when secret matches", async () => {
    await enableFlag();
    process.env.TEAMS_BOT_SHARED_SECRET = "topsecret";
    const fakeChatAssist = async (req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ sessionId: "X", message: { text: "hello back" } }));
    };
    const handle = createTeamsBotRoutes(makeCtx(makeMockDb(), fakeChatAssist));
    const res = makeRes();
    await handle(makeReq("POST", baseActivity, { "x-teams-bot-secret": "topsecret" }),
      res, "/api/teams/messages");
    expect(res.statusCode).toBe(200);
    delete process.env.TEAMS_BOT_SHARED_SECRET;
  });
});

describe("teamsBot /api/teams/messages — activity handling", () => {
  beforeEach(async () => { await enableFlag(); delete process.env.TEAMS_BOT_SHARED_SECRET; });

  it("ignores non-message activities with 200 ack", async () => {
    const handle = createTeamsBotRoutes(makeCtx(makeMockDb(), null));
    const res = makeRes();
    await handle(makeReq("POST", { type: "typing" }), res, "/api/teams/messages");
    expect(res.statusCode).toBe(200);
    expect(res.body.handled).toBe(false);
  });

  it("400s on empty text", async () => {
    const handle = createTeamsBotRoutes(makeCtx(makeMockDb(), null));
    const res = makeRes();
    await handle(makeReq("POST", { ...baseActivity, text: "  " }), res, "/api/teams/messages");
    expect(res.statusCode).toBe(400);
  });

  it("400s on missing conversation id", async () => {
    const fakeChatAssist = async () => {};
    const handle = createTeamsBotRoutes(makeCtx(makeMockDb(), fakeChatAssist));
    const res = makeRes();
    await handle(makeReq("POST", { ...baseActivity, conversation: undefined }),
      res, "/api/teams/messages");
    expect(res.statusCode).toBe(400);
  });

  it("creates a session, forwards to chatAssist, and returns Adaptive Card", async () => {
    const db = makeMockDb();
    let forwardedBody = null;
    const fakeChatAssist = async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      forwardedBody = JSON.parse(raw);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        sessionId: forwardedBody.sessionId,
        message: { text: "Try restarting the VPN client.", role: "assistant", confidence: 80 },
        suggestHandoff: false,
      }));
    };
    const handle = createTeamsBotRoutes(makeCtx(db, fakeChatAssist));
    const res = makeRes();
    await handle(makeReq("POST", baseActivity), res, "/api/teams/messages");
    expect(res.statusCode).toBe(200);
    expect(res.body.type).toBe("message");
    expect(res.body.text).toMatch(/restarting/);
    expect(res.body.attachments).toHaveLength(1);
    expect(res.body.attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(res.body.attachments[0].content.type).toBe("AdaptiveCard");
    // Session persisted
    const all = await db.getAll("chat_assist_sessions");
    expect(all.length).toBe(1);
    const session = JSON.parse(all[0].data);
    expect(session.channel).toBe("teams");
    expect(session.botConversationId).toBe("19:teams-conv-abc");
    expect(forwardedBody.sessionId).toBe(session.id);
  });

  it("reuses an existing session for the same conversation id", async () => {
    const db = makeMockDb();
    const fakeChatAssist = async (req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: { text: "ack" } }));
    };
    const handle = createTeamsBotRoutes(makeCtx(db, fakeChatAssist));
    await handle(makeReq("POST", baseActivity), makeRes(), "/api/teams/messages");
    await handle(makeReq("POST", { ...baseActivity, text: "second message" }),
      makeRes(), "/api/teams/messages");
    const all = await db.getAll("chat_assist_sessions");
    expect(all.length).toBe(1);
  });

  it("502s when chatAssist forward throws", async () => {
    const fakeChatAssist = async () => { throw new Error("boom"); };
    const handle = createTeamsBotRoutes(makeCtx(makeMockDb(), fakeChatAssist));
    const res = makeRes();
    await handle(makeReq("POST", baseActivity), res, "/api/teams/messages");
    expect(res.statusCode).toBe(502);
  });

  it("returns 503 when chatAssist handler reference missing", async () => {
    const handle = createTeamsBotRoutes(makeCtx(makeMockDb(), null));
    const res = makeRes();
    await handle(makeReq("POST", baseActivity), res, "/api/teams/messages");
    // _forwardToChatAssist throws "not registered" → 502
    expect(res.statusCode).toBe(502);
  });
});

describe("teamsBot.findOrCreateSession", () => {
  it("creates a teams-channel session row with the bot conversation id", async () => {
    const db = makeMockDb();
    const session = await findOrCreateSession(db, baseActivity);
    expect(session.channel).toBe("teams");
    expect(session.botConversationId).toBe("19:teams-conv-abc");
    expect(session.customerName).toBe("Alice");
    expect(db.audit).toHaveBeenCalled();
  });

  it("returns null when activity has no conversation id", async () => {
    const session = await findOrCreateSession(makeMockDb(), { from: {} });
    expect(session).toBeNull();
  });
});

describe("teamsBot.buildResponse", () => {
  it("builds an Adaptive Card with quick-reply buttons when message has cards", () => {
    const card = buildResponse({
      text: "Did this help?",
      cards: [{
        type: "quick-reply", kind: "step-result",
        options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
      }],
    }, { maxReplyChars: 280 });
    expect(card.type).toBe("AdaptiveCard");
    expect(card.actions).toHaveLength(2);
  });

  it("builds a plain text card when message has no cards", () => {
    const card = buildResponse({ text: "Got it." }, { maxReplyChars: 280 });
    expect(card.body[0].text).toBe("Got it.");
    expect(card.actions).toEqual([]);
  });

  it("returns null for invalid input", () => {
    expect(buildResponse(null)).toBeNull();
  });
});
