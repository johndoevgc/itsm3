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
  it("ships 6 built-in actions", () => {
    const ids = runbookActions.list().map(a => a.id);
    expect(ids).toEqual(expect.arrayContaining([
      "unlockAccount", "resetMfa", "clearPrintQueue",
      "extendMailboxQuota", "forceVpnReauth", "restartSpoolerOnDevice",
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
                    "extendMailboxQuota", "forceVpnReauth", "restartSpoolerOnDevice"]) {
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
    it(`${id}: real exec throws not-implemented`, async () => {
      const a = runbookActions.get(id);
      await expect(a.exec({}, {})).rejects.toThrow(/exec-not-implemented/);
    });
  }
});
