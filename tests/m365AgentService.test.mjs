import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const m365Agent = require("../src/server/m365AgentService.js");

function dbWith(records) {
  return {
    async getOne(collection, id) {
      const item = records[collection]?.[id];
      return item ? { id, data: JSON.stringify(item) } : null;
    },
    async getAll(collection) {
      return Object.entries(records[collection] || {}).map(([id, data]) => ({ id, data: JSON.stringify(data) }));
    },
  };
}

describe("M365 agent service", () => {
  it("resolves VGC SG by customer record and validates vgcsg.com target UPN", async () => {
    const db = dbWith({
      incidents: { INC001: { id: "INC001", title: "Login issue", customer: "VGC SG", reporterEmail: "alice@vgcsg.com" } },
      customers: { CUS001: { id: "CUS001", name: "VGC SG", email: "helpdesk@vgcsg.com", primaryDomain: "vgcsg.com", m365TenantId: "11111111-1111-1111-1111-111111111111", m365AgentEnabled: true, allowedM365Actions: ["forceSignOut"] } },
    });
    const result = await m365Agent.resolveContext({ db, incidentId: "INC001", targetUpn: "alice@vgcsg.com" });
    expect(result.ok).toBe(true);
    expect(result.customer.name).toBe("VGC SG");
    expect(result.targetUpn).toBe("alice@vgcsg.com");
  });

  it("fails closed when tenant ID is missing", async () => {
    const db = dbWith({
      incidents: { INC001: { id: "INC001", title: "Login issue", customer: "VGC SG", reporterEmail: "alice@vgcsg.com" } },
      customers: { CUS001: { id: "CUS001", name: "VGC SG", email: "helpdesk@vgcsg.com", primaryDomain: "vgcsg.com", m365AgentEnabled: true, allowedM365Actions: ["forceSignOut"] } },
    });
    const result = await m365Agent.resolveContext({ db, incidentId: "INC001", targetUpn: "alice@vgcsg.com" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("tenant_id_missing");
  });

  it("blocks target UPNs outside the mapped customer domain", async () => {
    const db = dbWith({
      incidents: { INC001: { id: "INC001", title: "Login issue", customer: "VGC SG", reporterEmail: "alice@vgcsg.com" } },
      customers: { CUS001: { id: "CUS001", name: "VGC SG", email: "helpdesk@vgcsg.com", primaryDomain: "vgcsg.com", m365TenantId: "11111111-1111-1111-1111-111111111111", m365AgentEnabled: true, allowedM365Actions: ["forceSignOut"] } },
    });
    const result = await m365Agent.resolveContext({ db, incidentId: "INC001", targetUpn: "alice@example.com" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("target_domain_not_allowed");
  });

  it("runs read-only diagnostics without invoking write Graph endpoints", async () => {
    const calls = [];
    const db = dbWith({
      incidents: { INC001: { id: "INC001", title: "Login issue", customer: "VGC SG", reporterEmail: "alice@vgcsg.com" } },
      customers: { CUS001: { id: "CUS001", name: "VGC SG", email: "helpdesk@vgcsg.com", primaryDomain: "vgcsg.com", m365TenantId: "11111111-1111-1111-1111-111111111111", gdapStatus: "ready", m365AgentEnabled: true, allowedM365Actions: ["forceSignOut"] } },
    });
    const result = await m365Agent.diagnoseEntraSignIn({
      db,
      incidentId: "INC001",
      targetUpn: "alice@vgcsg.com",
      graphAppCallForTenant: async (_tenantId, endpoint, _headers, method) => {
        calls.push({ endpoint, method: method || "GET" });
        if (endpoint.startsWith("/users/alice%40vgcsg.com")) return { id: "u1", displayName: "Alice", userPrincipalName: "alice@vgcsg.com", accountEnabled: true };
        if (endpoint.startsWith("/auditLogs/signIns")) return { value: [] };
        if (endpoint.includes("/authentication/methods")) return { value: [{ id: "m1", "@odata.type": "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod" }] };
        if (endpoint.includes("/identityProtection/riskyUsers")) return { id: "u1", riskState: "none" };
        return {};
      },
    });
    expect(result.ok).toBe(true);
    expect(calls.every(call => call.method === "GET")).toBe(true);
    expect(calls.some(call => call.endpoint.includes("revokeSignInSessions"))).toBe(false);
  });
});
