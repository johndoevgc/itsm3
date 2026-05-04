import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { aiParseInboundEmail, ALLOWED_CATEGORIES, ALLOWED_PRIORITIES, SYMPTOM_FORM_MAP } = require("../emailParseAI.js");
const createAIRoutes = require("../routes/ai.js");

function jsonHelper(res, status, body) { res.statusCode = status; res.body = body; return body; }
async function parseBodyHelper(req) { return req._body || {}; }
function makeReq(method, body) { return { method, _body: body, headers: {} }; }
function makeRes() { return { statusCode: 0, body: null }; }

describe("emailParseAI helper", () => {
  it("returns null when callAI is not a function", async () => {
    const out = await aiParseInboundEmail("subj", "body", null);
    expect(out).toBeNull();
  });

  it("returns null when both subject and body are empty", async () => {
    const out = await aiParseInboundEmail("", "", vi.fn());
    expect(out).toBeNull();
  });

  it("returns null when AI throws", async () => {
    const callAI = vi.fn(async () => { throw new Error("boom"); });
    const out = await aiParseInboundEmail("VPN broken", "details", callAI);
    expect(out).toBeNull();
  });

  it("returns null on unparseable AI output", async () => {
    const callAI = vi.fn(async () => ({ text: "I cannot help" }));
    const out = await aiParseInboundEmail("VPN", "details", callAI);
    expect(out).toBeNull();
  });

  it("clamps unknown category/priority to defaults", async () => {
    const callAI = vi.fn(async () => ({ text: JSON.stringify({ symptom: "explode", category: "Bogus", priority: "Mega", confidence: 1.5 }) }));
    const out = await aiParseInboundEmail("Hi", "x", callAI);
    expect(out.category).toBe("General");
    expect(out.priority).toBe("Sev-C");
    expect(out.symptom).toBeNull();
    expect(out.suggestedFormKey).toBeNull();
    expect(out.confidence).toBe(1);
  });

  it("maps known symptom to form key and keeps allowed values", async () => {
    const callAI = vi.fn(async () => ({
      text: JSON.stringify({
        symptom: "vpn-wont-connect",
        category: "VPN",
        priority: "Sev-B",
        fields: { userName: "Alice", clientVer: "5.4" },
        confidence: 0.85,
      }),
    }));
    const out = await aiParseInboundEmail("VPN broken", "Cannot connect after MFA", callAI);
    expect(out.symptom).toBe("vpn-wont-connect");
    expect(out.category).toBe("VPN");
    expect(out.priority).toBe("Sev-B");
    expect(out.suggestedFormKey).toBe("vpn-form");
    expect(out.fields.userName).toBe("Alice");
    expect(out.confidence).toBeCloseTo(0.85);
  });

  it("salvages JSON from extra prose around the object", async () => {
    const callAI = vi.fn(async () => ({
      text: "Sure! Here is the JSON:\n```json\n{\"symptom\":\"printer-offline\",\"category\":\"Printer\",\"priority\":\"Sev-C\",\"fields\":{\"printer\":\"HP-3F\"},\"confidence\":0.7}\n```\nDone.",
    }));
    const out = await aiParseInboundEmail("Printer", "HP-3F offline", callAI);
    expect(out.symptom).toBe("printer-offline");
    expect(out.suggestedFormKey).toBe("printer-form");
    expect(out.fields.printer).toBe("HP-3F");
  });

  it("ignores non-object fields and caps long field values", async () => {
    const long = "x".repeat(500);
    const callAI = vi.fn(async () => ({
      text: JSON.stringify({ category: "Software", priority: "Sev-C", fields: { note: long, junk: null }, confidence: 0.5 }),
    }));
    const out = await aiParseInboundEmail("install", "stuff", callAI);
    expect(out.fields.note.length).toBe(200);
    expect(out.fields.junk).toBeUndefined();
  });
});

describe("v3.33.0 POST /api/ai/parse-email", () => {
  function setup(callAIImpl) {
    const callAI = callAIImpl || vi.fn(async () => ({ text: "{}" }));
    const handle = createAIRoutes({
      db: { getOne: async () => null, getAll: async () => [], upsert: async () => {}, audit: async () => {} },
      json: jsonHelper, parseBody: parseBodyHelper, readBody: parseBodyHelper, sendText: () => {},
      callAI, extractAIText: () => "", wsServer: { broadcast: () => {} },
      AI_THRESHOLDS: {}, AI_MODELS: {}, getAIModel: () => null,
      shouldSkipAction: () => false, trackNewAction: () => {},
      getAiActionsDedupState: () => ({}), getSlaMap: () => ({}),
      getSlaDescription: () => "", getBusinessHoursElapsed: () => 0,
    });
    return { handle, callAI };
  }
  const userAuth = { authenticated: true, role: "user", name: "Bob" };
  const anonAuth = { authenticated: false };

  it("401 when unauthenticated", async () => {
    const { handle } = setup();
    const res = makeRes();
    await handle(makeReq("POST", { subject: "x", body: "y" }), res, "/api/ai/parse-email", anonAuth, null);
    expect(res.statusCode).toBe(401);
  });

  it("400 when subject and body both missing", async () => {
    const { handle } = setup();
    const res = makeRes();
    await handle(makeReq("POST", {}), res, "/api/ai/parse-email", userAuth, null);
    expect(res.statusCode).toBe(400);
  });

  it("422 when AI returns nothing parseable", async () => {
    const { handle } = setup(async () => ({ text: "huh?" }));
    const res = makeRes();
    await handle(makeReq("POST", { subject: "VPN", body: "broken" }), res, "/api/ai/parse-email", userAuth, null);
    expect(res.statusCode).toBe(422);
  });

  it("200 + parsed payload on success", async () => {
    const { handle } = setup(async () => ({
      text: JSON.stringify({ symptom: "paper-jam", category: "Printer", priority: "Sev-C", fields: { printer: "HP-3F" }, confidence: 0.9 }),
    }));
    const res = makeRes();
    await handle(makeReq("POST", { subject: "Printer jam", body: "HP-3F has paper jam in tray 2" }), res, "/api/ai/parse-email", userAuth, null);
    expect(res.statusCode).toBe(200);
    expect(res.body.symptom).toBe("paper-jam");
    expect(res.body.suggestedFormKey).toBe("printer-form");
    expect(res.body.category).toBe("Printer");
    expect(res.body.parsedAt).toMatch(/T/);
  });
});

describe("emailParseAI constants", () => {
  it("exports allowed categories and priorities", () => {
    expect(ALLOWED_CATEGORIES).toContain("General");
    expect(ALLOWED_PRIORITIES).toEqual(["Sev-A", "Sev-B", "Sev-C", "Sev-D"]);
    expect(SYMPTOM_FORM_MAP["vpn-wont-connect"]).toBe("vpn-form");
  });
});
