import { describe, expect, it, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const runbookActions = require("../runbookActions.js");

function makeMockDb() {
  const store = new Map();
  const audits = [];
  return {
    _store: store, _audits: audits,
    async getOne(coll, id) { const r = store.get(`${coll}::${id}`); return r ? { id, data: r } : null; },
    async getAll(coll) {
      const out = [];
      for (const [k, v] of store.entries()) if (k.startsWith(`${coll}::`)) out.push({ id: k.split("::")[1], data: v });
      return out;
    },
    async upsert(coll, id, data) { store.set(`${coll}::${id}`, data); },
    async audit(coll, id, action, detail, user) { audits.push({ coll, id, action, detail, user }); },
  };
}

beforeEach(() => { runbookActions.__internal._resetForTests(); });

describe("registry", () => {
  it("ships 7 built-in actions", () => {
    const ids = runbookActions.list().map(a => a.id);
    expect(ids).toEqual(expect.arrayContaining([
      "unlockAccount", "resetMfa", "clearPrintQueue",
      "extendMailboxQuota", "forceVpnReauth", "restartSpoolerOnDevice",
      "resetPassword",
    ]));
  });
  it("get() returns null for unknown id", () => {
    expect(runbookActions.get("nope")).toBeNull();
  });
  it("register() validates required fields", () => {
    expect(() => runbookActions.register({})).toThrow(/id/);
    expect(() => runbookActions.register({ id: "x", riskTier: 5, shadow: () => {}, exec: () => {} })).toThrow(/riskTier/);
    expect(() => runbookActions.register({ id: "x", riskTier: 1, exec: () => {} })).toThrow(/shadow/);
  });
});

describe("validateInput", () => {
  it("rejects missing required field", () => {
    const a = runbookActions.get("unlockAccount");
    const r = runbookActions.validateInput(a, {});
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/upn is required/);
  });
  it("rejects bad UPN pattern", () => {
    const a = runbookActions.get("unlockAccount");
    const r = runbookActions.validateInput(a, { upn: "not-an-email" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/pattern/);
  });
  it("accepts well-formed input", () => {
    const a = runbookActions.get("unlockAccount");
    const r = runbookActions.validateInput(a, { upn: "alice@vgc.com" });
    expect(r.ok).toBe(true);
  });
  it("enforces enum constraint", () => {
    runbookActions.register({
      id: "_test_enum", riskTier: 1, idempotent: true,
      inputSchema: { mode: { type: "string", required: true, enum: ["a", "b"] } },
      shadow: async () => ({ ok: true }), exec: async () => ({ ok: true }),
    });
    const a = runbookActions.get("_test_enum");
    expect(runbookActions.validateInput(a, { mode: "c" }).ok).toBe(false);
    expect(runbookActions.validateInput(a, { mode: "a" }).ok).toBe(true);
  });
});

describe("idempotencyKey", () => {
  it("is stable for same params on same day", () => {
    const k1 = runbookActions.idempotencyKey("unlockAccount", { upn: "a@x" });
    const k2 = runbookActions.idempotencyKey("unlockAccount", { upn: "a@x" });
    expect(k1).toBe(k2);
  });
  it("differs for different params", () => {
    const k1 = runbookActions.idempotencyKey("unlockAccount", { upn: "a@x" });
    const k2 = runbookActions.idempotencyKey("unlockAccount", { upn: "b@x" });
    expect(k1).not.toBe(k2);
  });
  it("is order-independent in params", () => {
    const k1 = runbookActions.idempotencyKey("x", { a: 1, b: 2 });
    const k2 = runbookActions.idempotencyKey("x", { b: 2, a: 1 });
    expect(k1).toBe(k2);
  });
});

describe("execute (shadow path)", () => {
  it("returns simulated result and writes audit + execution row", async () => {
    const db = makeMockDb();
    const r = await runbookActions.execute({
      actionId: "unlockAccount", params: { upn: "alice@vgc.com" },
      ctx: { db }, executedBy: "admin@vgc.com",
      flagPayload: { shadowOnly: true, dailyCap: 10 },
    });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("shadow");
    expect(r.result.simulated).toBe(true);
    expect(r.result.message).toMatch(/Would unlock/);
    // Audit + execution row written.
    const auditActions = db._audits.map(a => a.action);
    expect(auditActions).toContain("runbook.action.shadow");
    const rows = await db.getAll(runbookActions.EXEC_COLLECTION);
    expect(rows).toHaveLength(1);
    const stored = JSON.parse(rows[0].data);
    expect(stored.actionId).toBe("unlockAccount");
    expect(stored.mode).toBe("shadow");
    expect(stored.executedBy).toBe("admin@vgc.com");
  });

  it("rejects invalid params before running shadow", async () => {
    const db = makeMockDb();
    const r = await runbookActions.execute({
      actionId: "unlockAccount", params: {},
      ctx: { db }, flagPayload: {},
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("invalid params");
    expect(r.details).toBeDefined();
    expect(await db.getAll(runbookActions.EXEC_COLLECTION)).toHaveLength(0);
  });

  it("returns cached result on second call with same idempotency key", async () => {
    const db = makeMockDb();
    const params = { upn: "bob@vgc.com" };
    const r1 = await runbookActions.execute({
      actionId: "unlockAccount", params, ctx: { db },
      flagPayload: { shadowOnly: true },
    });
    expect(r1.mode).toBe("shadow");
    const r2 = await runbookActions.execute({
      actionId: "unlockAccount", params, ctx: { db },
      flagPayload: { shadowOnly: true },
    });
    expect(r2.ok).toBe(true);
    expect(r2.mode).toBe("cached");
    expect(r2.executionId).toBe(r1.executionId);
  });

  it("enforces daily cap", async () => {
    const db = makeMockDb();
    // Pre-seed 5 executions today.
    const today = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      await db.upsert(runbookActions.EXEC_COLLECTION, `pre-${i}`,
        JSON.stringify({ actionId: "clearPrintQueue", startedAt: today, ok: true }));
    }
    const r = await runbookActions.execute({
      actionId: "clearPrintQueue", params: { printerId: "PRN-1" },
      ctx: { db }, flagPayload: { shadowOnly: true, dailyCap: 5 },
    });
    expect(r.ok).toBe(false);
    expect(r.capped).toBe(true);
    expect(r.dailyCap).toBe(5);
  });

  it("real exec() throws not-implemented (fail-safe)", async () => {
    const db = makeMockDb();
    const r = await runbookActions.execute({
      actionId: "unlockAccount", params: { upn: "carol@vgc.com" },
      ctx: { db }, flagPayload: { shadowOnly: false, dailyCap: 10 },
    });
    expect(r.ok).toBe(false);
    expect(r.mode).toBe("real");
    expect(r.error).toMatch(/exec-not-implemented/);
    // Failure is still audited.
    const auditActions = db._audits.map(a => a.action);
    expect(auditActions).toContain("runbook.action.real.failed");
  });

  it("returns ok:false for unknown action id", async () => {
    const r = await runbookActions.execute({
      actionId: "nope", params: {}, ctx: { db: makeMockDb() }, flagPayload: {},
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("unknown action");
  });
});

describe("built-in shadow surface", () => {
  for (const id of ["unlockAccount", "resetMfa", "clearPrintQueue",
                    "extendMailboxQuota", "forceVpnReauth", "restartSpoolerOnDevice",
                    "resetPassword"]) {
    it(`${id}: shadow returns ok:true with steps and message`, async () => {
      const a = runbookActions.get(id);
      const params = {
        upn: "alice@vgc.com", approvedBy: "manager@vgc.com",
        printerId: "PRN-1", deviceId: "DEV-1", deltaGb: 5,
      };
      const r = await a.shadow(params, {});
      expect(r.ok).toBe(true);
      expect(r.simulated).toBe(true);
      expect(r.message).toBeTruthy();
      expect(Array.isArray(r.steps)).toBe(true);
      expect(r.steps.length).toBeGreaterThan(0);
    });
    // forceVpnReauth has a real exec() shipped in v3.34.2 (Phase 4.2) — covered separately below.
    // resetPassword has a real exec() shipped in v3.35.2 — covered separately below.
    if (id === "forceVpnReauth" || id === "resetPassword") continue;
    it(`${id}: real exec throws not-implemented`, async () => {
      const a = runbookActions.get(id);
      await expect(a.exec({}, {})).rejects.toThrow(/exec-not-implemented/);
    });
  }
});

describe("forceVpnReauth real exec (v3.34.2 Phase 4.2)", () => {
  it("calls Graph user lookup then revokeSignInSessions and returns ok:true", async () => {
    const calls = [];
    const graphAppCall = async (endpoint, _hdrs, method) => {
      calls.push({ endpoint, method: method || "GET" });
      if (endpoint.startsWith("/users/") && endpoint.includes("?$select=")) {
        return { id: "USER-OID-1", userPrincipalName: "alice@vgc.com", accountEnabled: true };
      }
      if (endpoint.endsWith("/revokeSignInSessions")) return { ok: true, status: 204 };
      throw new Error(`unexpected graph call: ${endpoint}`);
    };
    const a = runbookActions.get("forceVpnReauth");
    const r = await a.exec({ upn: "alice@vgc.com" }, { graphAppCall });
    expect(r.ok).toBe(true);
    expect(r.simulated).toBe(false);
    expect(r.userId).toBe("USER-OID-1");
    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe("GET");
    expect(calls[1].method).toBe("POST");
    expect(calls[1].endpoint).toBe("/users/USER-OID-1/revokeSignInSessions");
  });

  it("returns ok:false when graphAppCall is missing from ctx", async () => {
    const a = runbookActions.get("forceVpnReauth");
    const r = await a.exec({ upn: "alice@vgc.com" }, {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/graphAppCall unavailable/);
  });

  it("returns ok:false when user lookup fails", async () => {
    const graphAppCall = async () => { throw new Error("404 Not Found"); };
    const a = runbookActions.get("forceVpnReauth");
    const r = await a.exec({ upn: "ghost@vgc.com" }, { graphAppCall });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/user lookup failed/);
  });

  it("returns ok:false when account is disabled", async () => {
    const graphAppCall = async () => ({ id: "U", userPrincipalName: "x@vgc.com", accountEnabled: false });
    const a = runbookActions.get("forceVpnReauth");
    const r = await a.exec({ upn: "x@vgc.com" }, { graphAppCall });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/account disabled/);
  });

  it("returns ok:false when revoke POST fails", async () => {
    const graphAppCall = async (endpoint, _h, method) => {
      if (!method || method === "GET") return { id: "U", userPrincipalName: "x@vgc.com", accountEnabled: true };
      throw new Error("Forbidden");
    };
    const a = runbookActions.get("forceVpnReauth");
    const r = await a.exec({ upn: "x@vgc.com" }, { graphAppCall });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/revoke failed/);
  });

  it("end-to-end execute() with shadowOnly:false records mode='real' and audits success", async () => {
    const db = makeMockDb();
    const graphAppCall = async (endpoint, _h, method) => {
      if (!method || method === "GET") return { id: "U", userPrincipalName: "alice@vgc.com", accountEnabled: true };
      return { ok: true, status: 204 };
    };
    const r = await runbookActions.execute({
      actionId: "forceVpnReauth", params: { upn: "alice@vgc.com" },
      ctx: { db, graphAppCall }, executedBy: "admin@vgc.com",
      flagPayload: { shadowOnly: false, dailyCap: 5 },
    });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("real");
    expect(r.result.simulated).toBe(false);
    const auditActions = db._audits.map(a => a.action);
    expect(auditActions).toContain("runbook.action.real");
  });
});

describe("resetPassword real exec", () => {
  it("resets password via Graph PATCH and revokes sessions", async () => {
    const calls = [];
    const graphAppCall = async (endpoint, _hdrs, method, body) => {
      calls.push({ endpoint, method: method || "GET", body });
      if (endpoint.includes("?$select=")) {
        return { id: "USER-1", userPrincipalName: "user@vgcsg.com", accountEnabled: true, displayName: "Test User" };
      }
      if (method === "PATCH") return { ok: true, status: 204 };
      if (endpoint.endsWith("/revokeSignInSessions")) return { ok: true, status: 204 };
      throw new Error(`unexpected graph call: ${endpoint}`);
    };
    const a = runbookActions.get("resetPassword");
    const r = await a.exec({ upn: "user@vgcsg.com", approvedBy: "admin@vgc.com" }, { graphAppCall });
    expect(r.ok).toBe(true);
    expect(r.simulated).toBe(false);
    expect(r.userId).toBe("USER-1");
    expect(r.displayName).toBe("Test User");
    expect(r.tempPassword).toBeTruthy();
    expect(r.tempPassword.length).toBe(16);
    expect(r.forceChangeOnNextSignIn).toBe(true);
    expect(r.approvedBy).toBe("admin@vgc.com");
    // Verify Graph calls: GET user, PATCH password, POST revoke
    expect(calls).toHaveLength(3);
    expect(calls[0].method).toBe("GET");
    expect(calls[1].method).toBe("PATCH");
    expect(calls[1].body.passwordProfile.forceChangePasswordNextSignIn).toBe(true);
    expect(calls[2].method).toBe("POST");
    expect(calls[2].endpoint).toContain("revokeSignInSessions");
  });

  it("returns ok:false when graphAppCall is missing from ctx", async () => {
    const a = runbookActions.get("resetPassword");
    const r = await a.exec({ upn: "user@vgcsg.com", approvedBy: "admin@vgc.com" }, {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/graphAppCall unavailable/);
  });

  it("returns ok:false when user lookup fails", async () => {
    const graphAppCall = async () => { throw new Error("404 Not Found"); };
    const a = runbookActions.get("resetPassword");
    const r = await a.exec({ upn: "ghost@vgcsg.com", approvedBy: "admin@vgc.com" }, { graphAppCall });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/user lookup failed/);
  });

  it("returns ok:false when account is disabled", async () => {
    const graphAppCall = async () => ({ id: "U", userPrincipalName: "x@vgcsg.com", accountEnabled: false });
    const a = runbookActions.get("resetPassword");
    const r = await a.exec({ upn: "x@vgcsg.com", approvedBy: "admin@vgc.com" }, { graphAppCall });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/account disabled/);
  });

  it("returns ok:false when PATCH fails", async () => {
    const graphAppCall = async (endpoint, _h, method) => {
      if (!method || method === "GET") return { id: "U", userPrincipalName: "x@vgcsg.com", accountEnabled: true, displayName: "X" };
      if (method === "PATCH") throw new Error("Insufficient privileges");
      return { ok: true };
    };
    const a = runbookActions.get("resetPassword");
    const r = await a.exec({ upn: "x@vgcsg.com", approvedBy: "admin@vgc.com" }, { graphAppCall });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/password reset failed/);
  });

  it("succeeds even if session revoke fails (non-fatal)", async () => {
    const graphAppCall = async (endpoint, _h, method) => {
      if (!method || method === "GET") return { id: "U", userPrincipalName: "x@vgcsg.com", accountEnabled: true, displayName: "X" };
      if (method === "PATCH") return { ok: true, status: 204 };
      if (method === "POST") throw new Error("Revoke timeout");
      return { ok: true };
    };
    const a = runbookActions.get("resetPassword");
    const r = await a.exec({ upn: "x@vgcsg.com", approvedBy: "admin@vgc.com" }, { graphAppCall });
    expect(r.ok).toBe(true);
    expect(r.tempPassword).toBeTruthy();
  });

  it("input validation requires both upn and approvedBy", () => {
    const a = runbookActions.get("resetPassword");
    expect(runbookActions.validateInput(a, {}).ok).toBe(false);
    expect(runbookActions.validateInput(a, { upn: "a@b.com" }).ok).toBe(false);
    expect(runbookActions.validateInput(a, { approvedBy: "admin" }).ok).toBe(false);
    expect(runbookActions.validateInput(a, { upn: "a@b.com", approvedBy: "admin@vgc.com" }).ok).toBe(true);
  });

  it("end-to-end execute() with shadowOnly:false records mode='real'", async () => {
    const db = makeMockDb();
    const graphAppCall = async (endpoint, _h, method) => {
      if (!method || method === "GET") return { id: "U", userPrincipalName: "user@vgcsg.com", accountEnabled: true, displayName: "User" };
      return { ok: true, status: 204 };
    };
    const r = await runbookActions.execute({
      actionId: "resetPassword", params: { upn: "user@vgcsg.com", approvedBy: "admin@vgc.com" },
      ctx: { db, graphAppCall }, executedBy: "admin@vgc.com",
      flagPayload: { shadowOnly: false, dailyCap: 5 },
    });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("real");
    expect(r.result.tempPassword).toBeTruthy();
    const auditActions = db._audits.map(a => a.action);
    expect(auditActions).toContain("runbook.action.real");
  });
});

describe("_generateTempPassword", () => {
  const { _generateTempPassword } = runbookActions.__internal;

  it("generates a password of the requested length", () => {
    expect(_generateTempPassword(16).length).toBe(16);
    expect(_generateTempPassword(20).length).toBe(20);
  });

  it("includes upper, lower, digit, and symbol", () => {
    // Run multiple times to reduce flakiness from shuffle
    for (let i = 0; i < 5; i++) {
      const pw = _generateTempPassword(16);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).toMatch(/[!@#$%&*\-_=+?]/);
    }
  });

  it("generates unique passwords each call", () => {
    const passwords = new Set();
    for (let i = 0; i < 20; i++) passwords.add(_generateTempPassword(16));
    expect(passwords.size).toBe(20);
  });
});
