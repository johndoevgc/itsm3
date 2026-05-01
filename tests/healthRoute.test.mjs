import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createCoreRoutes = require("../routes/core.js");

describe("/api/health", () => {
  it("reports staging redirect email without throwing in prod test mode", async () => {
    let response = null;
    const handler = createCoreRoutes({
      db: { ping: async () => true, type: "mysql", label: "MySQL: itsm-vgc-mysql-stg.mysql.database.azure.com" },
      json: (_res, status, data) => {
        response = { status, data };
        return true;
      },
      APP_VERSION: { version: "3.20", build: "2026-05-01" },
      AI_MODELS: { primary: "gpt-5.4-pro", secondary: "gpt-5.4-mini", tertiary: "gpt-5.4-nano" },
      MERAKI_API_KEYS: [],
      EMAIL_REDIRECT_TARGET: "hlaing@vgctechnology.com",
      PROD_TEST_MODE: true,
      wsServer: { getStats: () => ({ totalConnections: 0 }) },
      notifyEngine: { getStats: () => ({ sent: 0, failed: 0, byChannel: {} }) },
      workflowEngine: { getStats: () => ({ running: true, errors: 0 }) },
      cacheLayer: { getStats: () => ({ size: 0, hits: 0, misses: 0 }) },
    });

    const handled = await handler({ method: "GET" }, {}, "/api/health", {}, {}, new URL("http://localhost/api/health"));

    expect(handled).toBe(true);
    expect(response.status).toBe(200);
    expect(response.data.prodTestMode).toBe(true);
    expect(response.data.prodTestEmail).toBe("hlaing@vgctechnology.com");
  });
});