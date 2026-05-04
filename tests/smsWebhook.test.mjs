import { describe, expect, it, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createSmsWebhookRoutes = require("../routes/smsWebhook.js");
const {
  extractSmsEvents, normalisePhone, findOrCreateSession,
  resolveNumberedReply, _bumpDailyCap, _detectValidation,
} = createSmsWebhookRoutes.__internal;
const featureFlags = require("../featureFlags.js");

function jsonHelper(res, status, body) { res.statusCode = status; res.body = body; return body; }
async function parseBodyHelper(req) { return req._body || {}; }
function makeReq(method, body, headers = {}) { return { method, _body: body, headers }; }
function makeRes() { return { statusCode: 0, body: null, headersSent: false, end: () => {}, writeHead: () => {} }; }

function makeMockDb() {
  const store = new Map();
  return {
    _store: store,
    async getOne(coll, id) { const r = store.get(`${coll}::${id}`); return r ? { id, data: r } : null; },
    async getAll(coll) {
      const out = [];
      for (const [k, v] of store.entries()) if (k.startsWith(`${coll}::`)) out.push({ id: k.split("::")[1], data: v });
      return out;
    },
    async upsert(coll, id, data) { store.set(`${coll}::${id}`, data); },
    audit: vi.fn(async () => {}),
  };
}

async function enableFlag(payload = {}) {
  await featureFlags.init({
    getAll: async () => [{
      id: "omnichannel_sms",
      data: JSON.stringify({
        id: "omnichannel_sms", enabled: true, scope: "all",
        payload: { dailyCapPerNumber: 30, maxSmsLen: 480, ...payload },
      }),
    }],
    upsert: async () => {},
  }, { reloadSec: 0 });
}
async function disableFlag() {
  await featureFlags.init({
    getAll: async () => [{
      id: "omnichannel_sms",
      data: JSON.stringify({ id: "omnichannel_sms", enabled: false, scope: "all", payload: {} }),
    }],
    upsert: async () => {},
  }, { reloadSec: 0 });
}
function makeCtx(db, chatAssistFn) {
  return {
    db, json: jsonHelper, parseBody: parseBodyHelper,
    handleChatAssistRef: { fn: chatAssistFn },
  };
}

const smsEvent = (overrides = {}) => {
  const { data: dataOverrides, ...rest } = overrides;
  return [{
    eventType: "Microsoft.Communication.SMSReceived",
    id: "evt-1",
    data: {
      messageId: "m-1",
      from: "+6591234567",
      to: "+6580000000",
      message: "VPN keeps dropping",
      receivedTimestamp: "2026-05-04T03:00:00Z",
      ...(dataOverrides || {}),
    },
    ...rest,
  }];
};

describe("normalisePhone", () => {
  it("accepts E.164", () => {
    expect(normalisePhone("+6591234567")).toBe("+6591234567");
    expect(normalisePhone("  +14155550100  ")).toBe("+14155550100");
  });
  it("rejects malformed numbers", () => {
    expect(normalisePhone("91234567")).toBeNull();
    expect(normalisePhone("not-a-number")).toBeNull();
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone("+")).toBeNull();
  });
});

describe("extractSmsEvents", () => {
  it("extracts ACS SMSReceived events from an array payload", () => {
    const out = extractSmsEvents(smsEvent());
    expect(out).toHaveLength(1);
    expect(out[0].from).toBe("+6591234567");
    expect(out[0].text).toBe("VPN keeps dropping");
  });
  it("ignores non-SMS event types", () => {
    expect(extractSmsEvents([{ eventType: "Other.Type", data: { from: "+1", message: "x" } }])).toEqual([]);
  });
  it("ignores events with empty text or missing from", () => {
    expect(extractSmsEvents(smsEvent({ data: { message: "" } }))).toEqual([]);
    expect(extractSmsEvents(smsEvent({ data: { from: null } }))).toEqual([]);
  });
});

describe("_detectValidation", () => {
  it("returns the validation code for SubscriptionValidationEvent", () => {
    expect(_detectValidation([{
      eventType: "Microsoft.EventGrid.SubscriptionValidationEvent",
      data: { validationCode: "abc123" },
    }])).toBe("abc123");
  });
  it("returns null for normal SMS payload", () => {
    expect(_detectValidation(smsEvent())).toBeNull();
  });
});

describe("_bumpDailyCap", () => {
  it("resets counter at UTC date boundary", () => {
    const s = { smsDailyCount: 5, smsDailyResetAt: "1999-01-01" };
    expect(_bumpDailyCap(s, 10)).toBe(false);
    expect(s.smsDailyCount).toBe(1);
    expect(s.smsDailyResetAt).toBe(new Date().toISOString().slice(0, 10));
  });
  it("returns true once over cap", () => {
    const today = new Date().toISOString().slice(0, 10);
    const s = { smsDailyCount: 3, smsDailyResetAt: today };
    expect(_bumpDailyCap(s, 3)).toBe(true);
    expect(s.smsDailyCount).toBe(4);
  });
});

describe("resolveNumberedReply", () => {
  it("maps '2' to the second option from the previous turn", () => {
    const session = { smsLastOptions: [
      { value: "vpn", label: "VPN", smsIndex: 1 },
      { value: "email", label: "Email", smsIndex: 2 },
    ]};
    const r = resolveNumberedReply(session, "2");
    expect(r.value).toBe("email");
  });
  it("returns null if no previous options", () => {
    expect(resolveNumberedReply({ smsLastOptions: [] }, "1")).toBeNull();
  });
});

describe("findOrCreateSession", () => {
  it("creates an sms-channel row keyed to the phone number", async () => {
    const db = makeMockDb();
    const s = await findOrCreateSession(db, "+6591234567");
    expect(s.channel).toBe("sms");
    expect(s.customerPhone).toBe("+6591234567");
    expect(s.smsDailyCount).toBe(0);
    expect(db.audit).toHaveBeenCalled();
  });
  it("returns the same session for the same phone on a second call", async () => {
    const db = makeMockDb();
    const s1 = await findOrCreateSession(db, "+6591234567");
    const s2 = await findOrCreateSession(db, "+6591234567");
    expect(s2.id).toBe(s1.id);
  });
  it("returns null for invalid phone", async () => {
    expect(await findOrCreateSession(makeMockDb(), "not-a-number")).toBeNull();
  });
});

describe("/api/sms/webhook — gates and handshakes", () => {
  beforeEach(() => { delete process.env.ACS_WEBHOOK_SHARED_SECRET; });

  it("echoes Event Grid validation code BEFORE flag check", async () => {
    await disableFlag();
    const handle = createSmsWebhookRoutes(makeCtx(makeMockDb(), null));
    const res = makeRes();
    await handle(makeReq("POST", [{
      eventType: "Microsoft.EventGrid.SubscriptionValidationEvent",
      data: { validationCode: "ABC" },
    }]), res, "/api/sms/webhook");
    expect(res.statusCode).toBe(200);
    expect(res.body.validationResponse).toBe("ABC");
  });

  it("503 when flag disabled and not validation handshake", async () => {
    await disableFlag();
    const handle = createSmsWebhookRoutes(makeCtx(makeMockDb(), null));
    const res = makeRes();
    await handle(makeReq("POST", smsEvent()), res, "/api/sms/webhook");
    expect(res.statusCode).toBe(503);
  });

  it("401 when secret env set but header missing", async () => {
    await enableFlag();
    process.env.ACS_WEBHOOK_SHARED_SECRET = "topsecret";
    const handle = createSmsWebhookRoutes(makeCtx(makeMockDb(), null));
    const res = makeRes();
    await handle(makeReq("POST", smsEvent(), {}), res, "/api/sms/webhook");
    expect(res.statusCode).toBe(401);
    delete process.env.ACS_WEBHOOK_SHARED_SECRET;
  });
});

describe("/api/sms/webhook — message flow", () => {
  beforeEach(async () => { await enableFlag(); delete process.env.ACS_WEBHOOK_SHARED_SECRET; });

  it("forwards inbound SMS to chatAssist and returns numbered SMS reply", async () => {
    const db = makeMockDb();
    const chatAssist = async (req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        sessionId: "X",
        message: {
          text: "Pick the symptom:",
          cards: [{
            type: "quick-reply", kind: "pick-symptom",
            options: [
              { value: "vpn", label: "VPN" },
              { value: "email", label: "Email" },
            ],
          }],
        },
        suggestHandoff: false,
      }));
    };
    const handle = createSmsWebhookRoutes(makeCtx(db, chatAssist));
    const res = makeRes();
    await handle(makeReq("POST", smsEvent()), res, "/api/sms/webhook");
    expect(res.statusCode).toBe(200);
    expect(res.body.handled).toBe(1);
    expect(res.body.replies[0].text).toMatch(/Reply with a number/);
    expect(res.body.replies[0].text).toMatch(/1\)\. VPN/);
    expect(res.body.replies[0].options).toHaveLength(2);
    // Session persisted with smsLastOptions
    const all = await db.getAll("chat_assist_sessions");
    const s = JSON.parse(all[0].data);
    expect(s.channel).toBe("sms");
    expect(s.smsLastOptions).toHaveLength(2);
    expect(s.smsDailyCount).toBe(1);
  });

  it("resolves a numeric reply against the previous turn's options", async () => {
    const db = makeMockDb();
    let forwardedText = null;
    const chatAssist = async (req, res) => {
      forwardedText = (req._parsedBody || {}).text;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: { text: "Got it." } }));
    };
    // Pre-seed a session that has smsLastOptions from a prior turn.
    const phone = "+6591234567";
    const seed = await findOrCreateSession(db, phone);
    seed.smsLastOptions = [
      { value: "vpn", label: "VPN", smsIndex: 1 },
      { value: "email", label: "Email", smsIndex: 2 },
    ];
    await db.upsert("chat_assist_sessions", seed.id, JSON.stringify(seed));

    const handle = createSmsWebhookRoutes(makeCtx(db, chatAssist));
    const res = makeRes();
    await handle(makeReq("POST", smsEvent({ data: { message: "2" } })),
      res, "/api/sms/webhook");
    expect(res.statusCode).toBe(200);
    // chatAssist should have received "email" (resolved), not "2".
    expect(forwardedText).toBe("email");
  });

  it("returns a capped reply when daily cap exceeded", async () => {
    await enableFlag({ dailyCapPerNumber: 1 });
    const db = makeMockDb();
    const chatAssist = async (req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: { text: "Hi" } }));
    };
    const handle = createSmsWebhookRoutes(makeCtx(db, chatAssist));
    // First message — under cap.
    await handle(makeReq("POST", smsEvent()), makeRes(), "/api/sms/webhook");
    // Second message — over cap.
    const res = makeRes();
    await handle(makeReq("POST", smsEvent({ data: { message: "again" } })),
      res, "/api/sms/webhook");
    expect(res.body.replies[0].capped).toBe(true);
    expect(res.body.replies[0].text).toMatch(/limit/i);
  });

  it("ignores unknown event types with handled:0", async () => {
    const handle = createSmsWebhookRoutes(makeCtx(makeMockDb(), null));
    const res = makeRes();
    await handle(makeReq("POST", [{ eventType: "Other.Type", data: {} }]),
      res, "/api/sms/webhook");
    expect(res.statusCode).toBe(200);
    expect(res.body.handled).toBe(0);
  });
});

describe("/api/sms/health", () => {
  it("reports flag state and secret config", async () => {
    await enableFlag();
    const handle = createSmsWebhookRoutes(makeCtx(makeMockDb(), null));
    const res = makeRes();
    await handle(makeReq("GET", null), res, "/api/sms/health");
    expect(res.statusCode).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.secretConfigured).toBe(false);
  });
});
