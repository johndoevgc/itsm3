import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createCoreRoutes = require("../routes/core.js");

function makeDb(seed = {}) {
  const store = new Map();
  for (const [collection, items] of Object.entries(seed)) {
    for (const [id, item] of Object.entries(items)) store.set(`${collection}:${id}`, { id, data: JSON.stringify(item) });
  }
  return {
    store,
    audits: [],
    async getOne(collection, id) { return store.get(`${collection}:${id}`) || null; },
    async getAll(collection) { return [...store.entries()].filter(([key]) => key.startsWith(`${collection}:`)).map(([, value]) => value); },
    async upsert(collection, id, data) { store.set(`${collection}:${id}`, { id, data }); },
    async audit(collection, id, action, detail, user) { this.audits.push({ collection, id, action, detail, user }); },
  };
}

function makeHandler({ db, role = "Administrator", graphAppCallForTenant, flagEnabled = true }) {
  const captured = { status: null, data: null };
  const handler = createCoreRoutes({
    db,
    json(_res, status, data) { captured.status = status; captured.data = data; return true; },
    readBody: async req => req.body || {},
    featureFlags: { isEnabled: () => flagEnabled, payload: () => ({ shadowOnly: true, dailyCap: 10 }) },
    graphAppCallForTenant,
    ENTRA_TENANT_ID: "11111111-1111-1111-1111-111111111111",
    cacheLayer: { invalidatePrefix() {} },
  });
  const authResult = { authenticated: true, role, user: { email: "admin@vgctechnology.com" }, name: "Admin" };
  return { handler, captured, authResult };
}

function seedDb() {
  return makeDb({
    incidents: { INC001: { id: "INC001", title: "Login issue", customer: "VGC SG", reporterEmail: "alice@vgcsg.com", activityLog: [] } },
    customers: { CUS001: { id: "CUS001", name: "VGC SG", email: "helpdesk@vgcsg.com", primaryDomain: "vgcsg.com", m365TenantId: "11111111-1111-1111-1111-111111111111", gdapStatus: "ready", m365AgentEnabled: true, allowedM365Actions: ["forceSignOut"] } },
  });
}

describe("M365 agent routes", () => {
  it("diagnoses Entra sign-in without write Graph calls", async () => {
    const calls = [];
    const db = seedDb();
    const { handler, captured, authResult } = makeHandler({
      db,
      graphAppCallForTenant: async (_tenantId, endpoint, _headers, method) => {
        calls.push({ endpoint, method: method || "GET" });
        if (endpoint.startsWith("/users/alice%40vgcsg.com")) return { id: "u1", displayName: "Alice", userPrincipalName: "alice@vgcsg.com", accountEnabled: true };
        if (endpoint.startsWith("/auditLogs/signIns")) return { value: [] };
        if (endpoint.includes("/authentication/methods")) return { value: [] };
        if (endpoint.includes("/identityProtection/riskyUsers")) return { id: "u1", riskState: "none" };
        return {};
      },
    });
    await handler({ method: "POST", body: { incidentId: "INC001", targetUpn: "alice@vgcsg.com" } }, {}, "/api/m365/entra/diagnose", {}, authResult, new URL("http://localhost/api/m365/entra/diagnose"));
    expect(captured.status).toBe(200);
    expect(captured.data.ok).toBe(true);
    expect(calls.every(call => call.method === "GET")).toBe(true);
  });

  it("blocks non-admin execution of an approved action route", async () => {
    const db = seedDb();
    const { handler, captured, authResult } = makeHandler({ db, role: "L1 Support Engineer", graphAppCallForTenant: async () => ({}) });
    await handler({ method: "POST", body: { proposalId: "M365A-1" } }, {}, "/api/m365/actions/approve-execute", {}, authResult, new URL("http://localhost/api/m365/actions/approve-execute"));
    expect(captured.status).toBe(403);
    expect(captured.data.error).toBe("Administrator approval required");
  });
});
