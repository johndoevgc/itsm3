import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createZendeskRoutes = require("../routes/zendesk.js");

function makeJsonCapture() {
  const captured = { status: null, data: null };
  return {
    captured,
    json(_res, status, data) {
      captured.status = status;
      captured.data = data;
      return true;
    },
  };
}

describe("Zendesk route authentication", () => {
  it("rejects anonymous non-webhook reads", async () => {
    const { captured, json } = makeJsonCapture();
    const handler = createZendeskRoutes({ json });

    const handled = await handler(
      { method: "GET" },
      {},
      "/api/zendesk/me",
      { role: "Read Only" },
      { authenticated: false, role: "Read Only", user: null },
      new URL("http://localhost/api/zendesk/me")
    );

    expect(handled).toBe(true);
    expect(captured.status).toBe(401);
    expect(captured.data.error).toBe("Authentication required");
  });
});