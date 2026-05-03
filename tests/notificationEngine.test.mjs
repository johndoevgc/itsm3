import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { NotificationEngine } = require("../notificationEngine.js");

describe("NotificationEngine quiet hours (v3.25 Phase B9)", () => {
  let mockDb;
  let mockWs;
  let engine;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    mockDb = { upsert: vi.fn().mockResolvedValue() };
    mockWs = { broadcast: vi.fn() };
    engine = new NotificationEngine({ db: mockDb, wsServer: mockWs });
    process.env.QUIET_HOURS_ENABLED = "true";
    process.env.QUIET_HOURS_WEEKEND = "false"; // disable weekend rule for deterministic test
  });

  afterEach(() => {
    Object.keys(process.env).forEach(k => delete process.env[k]);
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it("suppresses email/teams/slack during quiet hours for non-critical severity", async () => {
    // Force quiet-hours by setting a wide range covering the current hour
    vi.spyOn(engine, "_isQuietHours").mockReturnValue(true);
    const rec = await engine.send({
      channels: ["inapp", "email", "teams", "slack"],
      title: "Test", body: "test", severity: "warning", type: "test",
    });
    expect(rec.suppressedDuringQuietHours).toBe(true);
    expect(rec.channels).toEqual(["inapp"]);
  });

  it("does NOT suppress for critical severity even during quiet hours", async () => {
    vi.spyOn(engine, "_isQuietHours").mockReturnValue(true);
    const rec = await engine.send({
      channels: ["inapp", "email"],
      title: "Sev-A breach", body: "urgent", severity: "critical", type: "sla_breach",
      recipients: ["test@example.com"],
    });
    expect(rec.suppressedDuringQuietHours).toBe(false);
    expect(rec.channels).toContain("email");
  });

  it("does NOT suppress when outside quiet hours", async () => {
    vi.spyOn(engine, "_isQuietHours").mockReturnValue(false);
    const rec = await engine.send({
      channels: ["inapp", "email"],
      title: "Test", body: "test", severity: "warning", type: "test",
    });
    expect(rec.suppressedDuringQuietHours).toBe(false);
    expect(rec.channels).toContain("email");
  });

  it("falls back to inapp if all channels suppressed", async () => {
    vi.spyOn(engine, "_isQuietHours").mockReturnValue(true);
    const rec = await engine.send({
      channels: ["email", "teams", "slack"],
      title: "Info", body: "noise", severity: "info", type: "test",
    });
    expect(rec.suppressedDuringQuietHours).toBe(true);
    expect(rec.channels).toEqual(["inapp"]);
  });

  it("can be disabled via QUIET_HOURS_ENABLED=false env", () => {
    process.env.QUIET_HOURS_ENABLED = "false";
    const eng2 = new NotificationEngine({ db: mockDb });
    expect(eng2._isQuietHours()).toBe(false);
  });
});
