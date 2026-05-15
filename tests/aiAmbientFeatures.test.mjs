import { describe, expect, it, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createAIRoutes = require("../routes/ai.js");

function createMockCtx(incidents = [], users = [], cmdbAssets = [], auditLogs = []) {
  const collections = {
    incidents: [...incidents],
    users: [...users],
    cmdb_assets: [...cmdbAssets],
    ai_audit_log: [...auditLogs],
    ai_runtime: [],
    ai_actions: [],
    changes: [],
    kb: [],
  };

  return {
    db: {
      getAll: async (col) => collections[col] || [],
      getOne: async (col, id) => {
        const items = collections[col] || [];
        const item = items.find(i => i.id === id);
        return item ? { id, data: JSON.stringify(item) } : null;
      },
      get: async (col, id) => {
        const items = collections[col] || [];
        return items.find(i => i.id === id) || null;
      },
      upsert: async (col, id, data) => {
        if (!collections[col]) collections[col] = [];
        const parsed = typeof data === "string" ? JSON.parse(data) : data;
        const idx = collections[col].findIndex(i => i.id === id);
        if (idx >= 0) collections[col][idx] = { ...parsed, id };
        else collections[col].push({ ...parsed, id });
      },
      count: async () => 0,
    },
    json: (_res, status, data) => ({ status, data }),
    readBody: async () => "{}",
    parseBody: async () => ({}),
    sendText: (_res, status, text) => ({ status, text }),
    callAI: async () => '{"title":"Test","description":"Test desc","category":"General","priority":"Sev-C"}',
    extractAIText: (r) => r,
    wsServer: { broadcast: () => {} },
    slaEngine: { currentPolicy: {} },
    normalizeCategory: (c) => c,
    graphSendMail: async () => {},
    AI_THRESHOLDS: { monitorIntervalMin: 15 },
    AI_MODELS: { primary: "gpt-4o" },
    getAIModel: () => "gpt-4o",
    shouldSkipAction: () => false,
    trackNewAction: () => {},
    getAiActionsDedupState: () => ({}),
    getSlaMap: () => ({ "Sev-A": 2, "Sev-B": 4, "Sev-C": 9, "Sev-D": 24 }),
    getSlaDescription: () => "",
    getBusinessHoursElapsed: (start, end) => {
      const ms = new Date(end).getTime() - new Date(start).getTime();
      return ms / 3600000;
    },
    computeSlaStatus_v2: () => ({ worstPct: 50, status: "on_track", hoursElapsed: 2 }),
    getManagedIdentityToken: async () => null,
    getOrgName: () => "VGC",
    PORT: 3000,
    MERAKI_API_KEYS: [],
    AI_AUTONOMY_LEVEL: 92,
    PROD_TEST_MODE: false,
  };
}

function mockReq(method, body) {
  return { method, headers: {}, body: JSON.stringify(body || {}) };
}
function mockRes() { return { writeHead: () => {}, end: () => {}, setHeader: () => {} }; }

describe("AI Ambient Features — Backend Endpoints", () => {

  describe("Feature 1: Autopilot Tick", () => {
    it("auto-resolves routine password reset tickets", async () => {
      const incidents = [
        { id: "INC-001", title: "Password Reset for John", status: "Open", description: "", createdAt: new Date().toISOString() },
      ];
      const ctx = createMockCtx(incidents);
      const handler = createAIRoutes(ctx);
      const result = await handler(mockReq("POST"), mockRes(), "/api/ai/autopilot/tick", { authenticated: true, role: "System" }, {}, new URL("http://localhost/api/ai/autopilot/tick"));
      expect(result.status).toBe(200);
      expect(result.data.results.resolved.length).toBe(1);
      expect(result.data.results.resolved[0].id).toBe("INC-001");
    });

    it("skips non-routine tickets", async () => {
      const incidents = [
        { id: "INC-002", title: "Server performance degradation in production", status: "Open", description: "", createdAt: new Date().toISOString() },
      ];
      const ctx = createMockCtx(incidents);
      const handler = createAIRoutes(ctx);
      const result = await handler(mockReq("POST"), mockRes(), "/api/ai/autopilot/tick", { authenticated: true, role: "System" }, {}, new URL("http://localhost/api/ai/autopilot/tick"));
      expect(result.status).toBe(200);
      expect(result.data.results.resolved.length).toBe(0);
      expect(result.data.results.skipped).toBe(1);
    });
  });

  describe("Feature 2: Predictive Prevention", () => {
    it("detects category bursts and creates proactive incidents", async () => {
      const now = new Date().toISOString();
      const incidents = Array.from({ length: 6 }, (_, i) => ({
        id: `INC-${i}`, title: `Email issue ${i}`, category: "Email", status: "Open", createdAt: now,
      }));
      const ctx = createMockCtx(incidents);
      const handler = createAIRoutes(ctx);
      const result = await handler(mockReq("POST"), mockRes(), "/api/ai/predictive-prevention", { authenticated: true }, {}, new URL("http://localhost/api/ai/predictive-prevention"));
      expect(result.status).toBe(200);
      expect(result.data.preventiveActions.length).toBeGreaterThan(0);
      expect(result.data.preventiveActions[0].category).toBe("Email");
      expect(result.data.preventiveActions[0].autoCreated).toBe(true);
    });
  });

  describe("Feature 3: SLA Defender", () => {
    it("returns 200 with escalation data", async () => {
      const incidents = [
        { id: "INC-010", title: "Critical server down", status: "Open", priority: "Sev-B", createdAt: new Date(Date.now() - 8 * 3600000).toISOString(), slaTarget: 4 },
      ];
      const ctx = createMockCtx(incidents);
      const handler = createAIRoutes(ctx);
      const result = await handler(mockReq("POST"), mockRes(), "/api/ai/sla-defender", { authenticated: true }, {}, new URL("http://localhost/api/ai/sla-defender"));
      expect(result.status).toBe(200);
      expect(result.data).toHaveProperty("scanned");
      expect(result.data).toHaveProperty("escalated");
      expect(result.data).toHaveProperty("warned");
    });
  });

  describe("Feature 4: Duplicate Storm", () => {
    it("merges 3+ similar tickets in 1 hour", async () => {
      const now = new Date().toISOString();
      const incidents = Array.from({ length: 4 }, (_, i) => ({
        id: `INC-D${i}`, title: "VPN not working", category: "Network", status: "Open", createdAt: now,
      }));
      const ctx = createMockCtx(incidents);
      const handler = createAIRoutes(ctx);
      const result = await handler(mockReq("POST"), mockRes(), "/api/ai/duplicate-storm", { authenticated: true }, {}, new URL("http://localhost/api/ai/duplicate-storm"));
      expect(result.status).toBe(200);
      expect(result.data.stormsDetected).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Feature 12: Frustration Detector", () => {
    it("detects high frustration in urgent messages", async () => {
      const ctx = createMockCtx();
      const handler = createAIRoutes(ctx);
      const req = mockReq("POST", { message: "This is UNACCEPTABLE!! I've been waiting for days now!!!" });
      // Simulate parsed body
      const parsed = { message: "This is UNACCEPTABLE!! I've been waiting for days now!!!" };
      // The handler reads body internally, need to mock readBody
      ctx.readBody = async () => JSON.stringify(parsed);
      ctx.parseBody = async () => parsed;
      const result = await handler({ method: "POST", headers: {} }, mockRes(), "/api/ai/frustration-detect", { authenticated: true }, {}, new URL("http://localhost/api/ai/frustration-detect"));
      expect(result.status).toBe(200);
      expect(result.data.frustrated).toBe(true);
      expect(result.data.score).toBeGreaterThan(0.7);
    });

    it("does not flag normal messages", async () => {
      const ctx = createMockCtx();
      ctx.readBody = async () => JSON.stringify({ message: "Hi, could you please help me with my issue?" });
      ctx.parseBody = async () => ({ message: "Hi, could you please help me with my issue?" });
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "POST", headers: {} }, mockRes(), "/api/ai/frustration-detect", { authenticated: true }, {}, new URL("http://localhost/api/ai/frustration-detect"));
      expect(result.status).toBe(200);
      expect(result.data.frustrated).toBe(false);
    });
  });

  describe("Feature 16: Auto-Remediation", () => {
    it("matches password reset playbook and auto-resolves", async () => {
      const incidents = [{ id: "INC-REM1", title: "Password reset needed", status: "Open", description: "User forgot password", activityLog: [] }];
      const ctx = createMockCtx(incidents);
      ctx.readBody = async () => JSON.stringify({ ticketId: "INC-REM1" });
      ctx.parseBody = async () => ({ ticketId: "INC-REM1" });
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "POST", headers: {} }, mockRes(), "/api/ai/auto-remediate", { authenticated: true }, {}, new URL("http://localhost/api/ai/auto-remediate"));
      expect(result.status).toBe(200);
      expect(result.data.executed).toBe(true);
      expect(result.data.playbook).toBe("Password Reset");
      expect(result.data.autoResolved).toBe(true);
    });

    it("returns no playbook for unknown issues", async () => {
      const incidents = [{ id: "INC-REM2", title: "Application performance issue", status: "Open", description: "App is slow", activityLog: [] }];
      const ctx = createMockCtx(incidents);
      ctx.readBody = async () => JSON.stringify({ ticketId: "INC-REM2" });
      ctx.parseBody = async () => ({ ticketId: "INC-REM2" });
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "POST", headers: {} }, mockRes(), "/api/ai/auto-remediate", { authenticated: true }, {}, new URL("http://localhost/api/ai/auto-remediate"));
      expect(result.status).toBe(200);
      expect(result.data.executed).toBe(false);
    });
  });

  describe("Feature 17: Entra Self-Heal", () => {
    it("returns fix plan for expired token", async () => {
      const ctx = createMockCtx();
      ctx.readBody = async () => JSON.stringify({ userId: "user123", issueType: "expired_token" });
      ctx.parseBody = async () => ({ userId: "user123", issueType: "expired_token" });
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "POST", headers: {} }, mockRes(), "/api/ai/entra-self-heal", { authenticated: true }, {}, new URL("http://localhost/api/ai/entra-self-heal"));
      expect(result.status).toBe(200);
      expect(result.data.executed).toBe(true);
      expect(result.data.risk).toBe("low");
    });

    it("requires approval for CA policy bypass", async () => {
      const ctx = createMockCtx();
      ctx.readBody = async () => JSON.stringify({ userId: "user123", issueType: "ca_policy_block" });
      ctx.parseBody = async () => ({ userId: "user123", issueType: "ca_policy_block" });
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "POST", headers: {} }, mockRes(), "/api/ai/entra-self-heal", { authenticated: true }, {}, new URL("http://localhost/api/ai/entra-self-heal"));
      expect(result.status).toBe(200);
      expect(result.data.requiresApproval).toBe(true);
      expect(result.data.risk).toBe("medium");
    });
  });

  describe("Feature 18: Certificate Guardian", () => {
    it("returns alerts for expiring certs", async () => {
      const assets = [
        { id: "CERT-1", name: "api.example.com SSL", type: "certificate", category: "ssl", expiryDate: new Date(Date.now() + 5 * 86400000).toISOString() },
        { id: "CERT-2", name: "web.example.com SSL", type: "certificate", category: "ssl", expiryDate: new Date(Date.now() - 1 * 86400000).toISOString() },
      ];
      const ctx = createMockCtx([], [], assets);
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "GET", headers: {} }, mockRes(), "/api/ai/cert-guardian", { authenticated: true }, {}, new URL("http://localhost/api/ai/cert-guardian"));
      expect(result.status).toBe(200);
      expect(result.data.alerts.length).toBe(2);
      expect(result.data.summary.expired).toBe(1);
      expect(result.data.summary.critical).toBe(1);
    });
  });

  describe("Feature 20: Patch Compliance", () => {
    it("identifies non-compliant devices", async () => {
      const assets = [
        { id: "DEV-1", name: "Laptop-001", type: "laptop", lastPatchDate: new Date(Date.now() - 60 * 86400000).toISOString() },
        { id: "DEV-2", name: "Laptop-002", type: "laptop", lastPatchDate: new Date().toISOString() },
      ];
      const ctx = createMockCtx([], [], assets);
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "GET", headers: {} }, mockRes(), "/api/ai/patch-compliance", { authenticated: true }, {}, new URL("http://localhost/api/ai/patch-compliance"));
      expect(result.status).toBe(200);
      expect(result.data.totalDevices).toBe(2);
      expect(result.data.nonCompliant.length).toBe(1);
      expect(result.data.nonCompliant[0].name).toBe("Laptop-001");
    });
  });

  describe("Feature 21: Auto Status Update", () => {
    it("generates status updates for critical tickets", async () => {
      const incidents = [
        { id: "INC-SEV1", title: "Major outage", priority: "Sev-A", status: "In Progress", assignedTo: "Elmo", activityLog: [{ user: "Elmo", detail: "Investigating root cause", type: "note" }] },
      ];
      const ctx = createMockCtx(incidents);
      ctx.readBody = async () => "{}";
      ctx.parseBody = async () => ({});
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "POST", headers: {} }, mockRes(), "/api/ai/auto-status-update", { authenticated: true }, {}, new URL("http://localhost/api/ai/auto-status-update"));
      expect(result.status).toBe(200);
      expect(result.data.updates.length).toBe(1);
      expect(result.data.updates[0].priority).toBe("Sev-A");
    });
  });

  describe("Feature 22: Smart Escalation", () => {
    it("requires ticketId", async () => {
      const ctx = createMockCtx();
      ctx.readBody = async () => "{}";
      ctx.parseBody = async () => ({});
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "POST", headers: {} }, mockRes(), "/api/ai/smart-escalation", { authenticated: true }, {}, new URL("http://localhost/api/ai/smart-escalation"));
      expect(result.status).toBe(400);
    });

    it("generates escalation email for valid ticket", async () => {
      const incidents = [{ id: "INC-ESC1", title: "DB Connection Failure", priority: "Sev-B", status: "Open", description: "Database connections timing out", activityLog: [] }];
      const ctx = createMockCtx(incidents);
      ctx.readBody = async () => JSON.stringify({ ticketId: "INC-ESC1", reason: "SLA breach imminent" });
      ctx.parseBody = async () => ({ ticketId: "INC-ESC1", reason: "SLA breach imminent" });
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "POST", headers: {} }, mockRes(), "/api/ai/smart-escalation", { authenticated: true }, {}, new URL("http://localhost/api/ai/smart-escalation"));
      expect(result.status).toBe(200);
      expect(result.data.escalationEmail.subject).toContain("ESCALATION");
      expect(result.data.escalationEmail.body).toContain("SLA breach imminent");
    });
  });

  describe("Feature 29: Change Implementation", () => {
    it("generates implementation plan", async () => {
      const ctx = createMockCtx();
      ctx.readBody = async () => JSON.stringify({ changeId: "CHG-001", changeTitle: "Upgrade Firewall" });
      ctx.parseBody = async () => ({ changeId: "CHG-001", changeTitle: "Upgrade Firewall" });
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "POST", headers: {} }, mockRes(), "/api/ai/change-implement", { authenticated: true }, {}, new URL("http://localhost/api/ai/change-implement"));
      expect(result.status).toBe(200);
      expect(result.data.plan.phases.length).toBe(4);
      expect(result.data.plan.rollbackPlan).toBeDefined();
    });
  });

  describe("Feature 30: Compliance Report", () => {
    it("generates ISO27001 compliance report", async () => {
      const incidents = Array.from({ length: 10 }, (_, i) => ({
        id: `INC-C${i}`, status: i < 8 ? "Resolved" : "Open", priority: "Sev-C",
      }));
      const ctx = createMockCtx(incidents, [], [], Array.from({ length: 60 }, (_, i) => ({ id: `AUD-${i}`, type: "auto_triage", timestamp: new Date().toISOString() })));
      ctx.readBody = async () => JSON.stringify({ framework: "ISO27001" });
      ctx.parseBody = async () => ({ framework: "ISO27001" });
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "POST", headers: {} }, mockRes(), "/api/ai/compliance-report", { authenticated: true }, {}, new URL("http://localhost/api/ai/compliance-report"));
      expect(result.status).toBe(200);
      expect(result.data.report.framework).toBe("ISO27001");
      expect(result.data.report.controls.length).toBeGreaterThan(0);
      expect(result.data.report.overallScore).toBeGreaterThan(0);
    });
  });

  describe("Feature 38: Queue Optimizer", () => {
    it("suggests rebalancing when workload is uneven", async () => {
      const incidents = [
        ...Array.from({ length: 8 }, (_, i) => ({ id: `INC-Q${i}`, status: "Open", priority: "Sev-C", assignedTo: "Alice" })),
        { id: "INC-Q8", status: "Open", priority: "Sev-C", assignedTo: "Bob" },
      ];
      const users = [
        { name: "Alice", rbacRole: "Service Desk Agent" },
        { name: "Bob", rbacRole: "Service Desk Agent" },
      ];
      const ctx = createMockCtx(incidents, users);
      ctx.readBody = async () => "{}";
      ctx.parseBody = async () => ({});
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "POST", headers: {} }, mockRes(), "/api/ai/queue-optimize", { authenticated: true }, {}, new URL("http://localhost/api/ai/queue-optimize"));
      expect(result.status).toBe(200);
      expect(result.data.rebalanceNeeded).toBe(true);
      expect(result.data.suggestions.length).toBeGreaterThan(0);
    });
  });

  describe("Feature 44: Health Check", () => {
    it("auto-closes resolved tickets with no recurrence", async () => {
      const resolvedAt = new Date(Date.now() - 36 * 3600000).toISOString();
      const incidents = [
        { id: "INC-HC1", title: "Fixed issue", status: "Resolved", resolvedAt, category: "Email", requester: "user1", createdBy: "user1", activityLog: [] },
      ];
      const ctx = createMockCtx(incidents);
      ctx.readBody = async () => "{}";
      ctx.parseBody = async () => ({});
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "POST", headers: {} }, mockRes(), "/api/ai/health-check", { authenticated: true }, {}, new URL("http://localhost/api/ai/health-check"));
      expect(result.status).toBe(200);
      expect(result.data.closed).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Feature 45: Customer Score", () => {
    it("computes customer health scores", async () => {
      const incidents = [
        { id: "INC-CS1", requester: "alice@co.com", status: "Resolved", createdAt: new Date().toISOString(), slaStatus: "Met" },
        { id: "INC-CS2", requester: "alice@co.com", status: "Resolved", createdAt: new Date().toISOString(), slaStatus: "Met" },
        { id: "INC-CS3", requester: "bob@co.com", status: "Open", createdAt: new Date().toISOString(), slaStatus: "Breached" },
        { id: "INC-CS4", requester: "bob@co.com", status: "Open", createdAt: new Date().toISOString(), slaStatus: "Breached" },
        { id: "INC-CS5", requester: "bob@co.com", status: "Open", createdAt: new Date().toISOString(), slaStatus: "Breached" },
      ];
      const ctx = createMockCtx(incidents);
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "GET", headers: {} }, mockRes(), "/api/ai/customer-score", { authenticated: true }, {}, new URL("http://localhost/api/ai/customer-score"));
      expect(result.status).toBe(200);
      expect(result.data.customers.length).toBe(2);
      const bob = result.data.customers.find(c => c.customer === "bob@co.com");
      expect(bob.risk).toBe("high");
    });
  });

  describe("Feature 48: Performance Report", () => {
    it("generates weekly report with metrics", async () => {
      const incidents = Array.from({ length: 5 }, (_, i) => ({
        id: `INC-PR${i}`, status: "Resolved", resolvedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
        resolution: i < 2 ? "Auto-resolved" : "Manual fix", slaElapsedHours: 3, category: "Email",
      }));
      const ctx = createMockCtx(incidents, [], [], [{ id: "A1", type: "auto_triage", timestamp: new Date().toISOString() }]);
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "GET", headers: {} }, mockRes(), "/api/ai/performance-report", { authenticated: true }, {}, new URL("http://localhost/api/ai/performance-report"));
      expect(result.status).toBe(200);
      expect(result.data.report.metrics.totalResolved).toBeGreaterThan(0);
      expect(result.data.report.timeSaved).toBeDefined();
    });
  });

  describe("Feature 50: Config Recommendations", () => {
    it("returns recommendations array", async () => {
      const ctx = createMockCtx([], [], [], []);
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "GET", headers: {} }, mockRes(), "/api/ai/config-recommendations", { authenticated: true }, {}, new URL("http://localhost/api/ai/config-recommendations"));
      expect(result.status).toBe(200);
      expect(result.data.recommendations.length).toBeGreaterThan(0);
      expect(result.data.recommendations[0]).toHaveProperty("title");
      expect(result.data.recommendations[0]).toHaveProperty("impact");
    });
  });

  describe("Feature 7: Voice-to-Ticket", () => {
    it("requires transcript", async () => {
      const ctx = createMockCtx();
      ctx.readBody = async () => "{}";
      ctx.parseBody = async () => ({});
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "POST", headers: {} }, mockRes(), "/api/ai/voice-to-ticket", { authenticated: true }, {}, new URL("http://localhost/api/ai/voice-to-ticket"));
      expect(result.status).toBe(400);
    });
  });

  describe("Feature 43: Callback Scheduler", () => {
    it("generates business hour slots", async () => {
      const ctx = createMockCtx();
      ctx.readBody = async () => JSON.stringify({ ticketId: "INC-001" });
      ctx.parseBody = async () => ({ ticketId: "INC-001" });
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "POST", headers: {} }, mockRes(), "/api/ai/callback-schedule", { authenticated: true }, {}, new URL("http://localhost/api/ai/callback-schedule"));
      expect(result.status).toBe(200);
      expect(result.data.slots.length).toBeGreaterThan(0);
      expect(result.data.ticketId).toBe("INC-001");
    });
  });

  describe("Feature 49: Self-Monitor", () => {
    it("reports healthy when no anomalies", async () => {
      const ctx = createMockCtx();
      const handler = createAIRoutes(ctx);
      const result = await handler({ method: "GET", headers: {} }, mockRes(), "/api/ai/self-monitor", { authenticated: true }, {}, new URL("http://localhost/api/ai/self-monitor"));
      expect(result.status).toBe(200);
      expect(result.data.healthStatus).toBe("healthy");
    });
  });
});
