import { describe, it, expect } from "vitest";

const BASE = "https://vgc-itsm1-app.azurewebsites.net";
const TIMEOUT = 10000;

const skipSmoke = !!process.env.SKIP_SMOKE;

describe.skipIf(skipSmoke)("Smoke — live Azure endpoints", () => {

  describe("GET endpoints return 200", () => {
    const getEndpoints = [
      "/api/health",
      "/api/ai/cert-guardian",
      "/api/ai/patch-compliance",
      "/api/ai/customer-score",
      "/api/ai/performance-report",
      "/api/ai/config-recommendations",
      "/api/ai/self-monitor",
    ];

    for (const path of getEndpoints) {
      it(`GET ${path} → 200`, async () => {
        const res = await fetch(`${BASE}${path}`, { method: "GET" });
        expect(res.status).toBe(200);
      }, TIMEOUT);
    }
  });

  describe("POST endpoints return 401 without auth", () => {
    const postEndpoints = [
      "/api/ai/autopilot/tick",
      "/api/ai/sla-defender",
      "/api/ai/duplicate-storm",
      "/api/ai/frustration-detect",
      "/api/ai/predictive-prevention",
      "/api/ai/auto-remediate",
    ];

    for (const path of postEndpoints) {
      it(`POST ${path} → 401 (no auth)`, async () => {
        const res = await fetch(`${BASE}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(401);
      }, TIMEOUT);
    }
  });
});
