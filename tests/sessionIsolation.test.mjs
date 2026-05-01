import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const root = path.resolve(".");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("session and customer-data isolation", () => {
  it("uses tab-scoped MSAL cache", () => {
    expect(read("msalConfig.js")).toContain('cacheLocation: "sessionStorage"');
  });

  it("registers active portal sessions and stale-session API protection", () => {
    const server = read("server.js");
    const core = read("routes/core.js");
    const main = read("main.jsx");
    expect(core).toContain("/api/auth/session/start");
    expect(core).toContain("/api/auth/session/heartbeat");
    expect(server).toContain("enforcePortalSession");
    expect(main).toContain("X-ITSM-Session-ID");
  });

  it("does not ship customer-looking default data in runtime UI state", () => {
    const runtimeSources = [
      "itsm-tool.jsx",
      "src/modules/CustomersModule.jsx",
      "src/modules/ProductivityDashboard.jsx",
    ].map(read).join("\n");
    const forbiddenTerms = [
      ["ABC", "Enterprise"].join(" "),
      ["Pioneer", "Street"].join(" "),
      ["abc", "enterprise"].join(""),
      ["Ms", "Carol"].join(" "),
      ["Monthly", "Service", "Report"].join(" "),
    ];
    for (const forbidden of forbiddenTerms) {
      expect(runtimeSources).not.toContain(forbidden);
    }
  });
});
