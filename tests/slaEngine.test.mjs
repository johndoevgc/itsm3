import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SlaEngine,
  computeSlaStatus,
  computeSlaStatus_v2,
  getBusinessHoursElapsed,
  DEFAULT_SLA_POLICY,
} from "../slaEngine.js";

// ─── getBusinessHoursElapsed ────────────────────────────────────────────
describe("getBusinessHoursElapsed", () => {
  it("returns 0 for null/undefined createdAt", () => {
    expect(getBusinessHoursElapsed(null)).toBe(0);
    expect(getBusinessHoursElapsed(undefined)).toBe(0);
  });

  it("returns 0 for invalid date string", () => {
    expect(getBusinessHoursElapsed("not-a-date")).toBe(0);
  });

  it("calculates hours within a single business day (Mon-Fri 9-18)", () => {
    // Wednesday 9AM → Wednesday 2PM = 5 business hours
    const created = new Date("2026-04-22T09:00:00+08:00"); // Wed
    const now = new Date("2026-04-22T14:00:00+08:00");     // Wed 2PM
    const hrs = getBusinessHoursElapsed(created, now, { start: 9, end: 18, days: "Mon-Fri" });
    expect(hrs).toBe(5);
  });

  it("clips to business hours when created before BH start", () => {
    // Wed 7AM → Wed 11AM = only 2 business hours (9-11)
    const created = new Date("2026-04-22T07:00:00+08:00");
    const now = new Date("2026-04-22T11:00:00+08:00");
    const hrs = getBusinessHoursElapsed(created, now, { start: 9, end: 18, days: "Mon-Fri" });
    expect(hrs).toBe(2);
  });

  it("skips weekends (Fri 4PM → Mon 10AM)", () => {
    // Friday 16:00 → Monday 10:00 = 2h (Fri 16-18) + 1h (Mon 9-10) = 3h
    const created = new Date("2026-04-24T16:00:00+08:00"); // Fri
    const now = new Date("2026-04-27T10:00:00+08:00");     // Mon
    const hrs = getBusinessHoursElapsed(created, now, { start: 9, end: 18, days: "Mon-Fri" });
    expect(hrs).toBe(3);
  });

  it("excludes holidays", () => {
    // Mon 9AM → Tue 18PM with Mon as holiday = only 9h (Tue only)
    const created = new Date("2026-04-27T09:00:00+08:00"); // Mon
    const now = new Date("2026-04-28T18:00:00+08:00");     // Tue
    const hrs = getBusinessHoursElapsed(created, now, {
      start: 9, end: 18, days: "Mon-Fri",
      holidays: ["2026-04-27"],
    });
    expect(hrs).toBe(9);
  });

  it("handles 24/7 mode", () => {
    // 24 hours straight
    const created = new Date("2026-04-25T10:00:00+08:00"); // Sat
    const now = new Date("2026-04-26T10:00:00+08:00");     // Sun
    const hrs = getBusinessHoursElapsed(created, now, { days: "24/7" });
    expect(hrs).toBe(24);
  });

  it("handles 24/7 mode with holidays excluded", () => {
    // Sat→Mon = 48h, but Sat is holiday → 24h
    const created = new Date("2026-04-25T00:00:00+08:00"); // Sat
    const now = new Date("2026-04-27T00:00:00+08:00");     // Mon
    const hrs = getBusinessHoursElapsed(created, now, {
      days: "24/7",
      holidays: ["2026-04-25"],
    });
    expect(hrs).toBe(24);
  });

  it("subtracts paused time from elapsed hours", () => {
    // Wed 9AM → Wed 5PM = 8h, but paused 12-14 (2 biz hrs) = 6h
    const created = new Date("2026-04-22T09:00:00+08:00");
    const now = new Date("2026-04-22T17:00:00+08:00");
    const hrs = getBusinessHoursElapsed(created, now, {
      start: 9, end: 18, days: "Mon-Fri",
      slaPauseHistory: [
        { pausedAt: "2026-04-22T12:00:00+08:00", resumedAt: "2026-04-22T14:00:00+08:00" },
      ],
    });
    expect(hrs).toBe(6);
  });

  it("handles ongoing pause (no resumedAt)", () => {
    // Wed 9AM → Wed 5PM = 8h, paused at noon still ongoing → 8 - 5(noon-5pm) = 3h
    const created = new Date("2026-04-22T09:00:00+08:00");
    const now = new Date("2026-04-22T17:00:00+08:00");
    const hrs = getBusinessHoursElapsed(created, now, {
      start: 9, end: 18, days: "Mon-Fri",
      slaPauseHistory: [
        { pausedAt: "2026-04-22T12:00:00+08:00" }, // no resumedAt
      ],
    });
    expect(hrs).toBe(3);
  });

  it("never returns negative", () => {
    // Edge: paused longer than elapsed
    const created = new Date("2026-04-22T09:00:00+08:00");
    const now = new Date("2026-04-22T10:00:00+08:00");
    const hrs = getBusinessHoursElapsed(created, now, {
      start: 9, end: 18, days: "Mon-Fri",
      slaPauseHistory: [
        { pausedAt: "2026-04-22T08:00:00+08:00", resumedAt: "2026-04-22T12:00:00+08:00" },
      ],
    });
    expect(hrs).toBeGreaterThanOrEqual(0);
  });
});

// ─── computeSlaStatus ───────────────────────────────────────────────────
describe("computeSlaStatus", () => {
  const policy = DEFAULT_SLA_POLICY;

  it("returns on_track for a Sev-A incident with low elapsed hours", () => {
    const incident = { id: "INC-1", priority: "Sev-A", createdAt: 1 }; // 1h elapsed (numeric shortcut)
    const result = computeSlaStatus(incident, policy);
    expect(result.status).toBe("on_track");
    expect(result.breached).toBe(false);
    expect(result.hoursElapsed).toBe(1);
    expect(result.worstResponseTarget).toBe(4); // Sev-A worst = 4h
    expect(result.firstResponseTarget).toBe(0.5);
  });

  it("returns at_risk when resolution ≥80% used", () => {
    // Sev-A worst = 4h. 80% of 4h = 3.2h
    const incident = { id: "INC-2", priority: "Sev-A", createdAt: 3.3 };
    const result = computeSlaStatus(incident, policy);
    expect(result.status).toBe("at_risk");
    expect(result.resolutionPct).toBeGreaterThanOrEqual(80);
    expect(result.resolutionPct).toBeLessThan(90);
  });

  it("returns critical when resolution ≥90% used", () => {
    // Sev-A worst = 4h. 90% of 4h = 3.6h
    const incident = { id: "INC-3", priority: "Sev-A", createdAt: 3.7 };
    const result = computeSlaStatus(incident, policy);
    expect(result.status).toBe("critical");
    expect(result.resolutionPct).toBeGreaterThanOrEqual(90);
  });

  it("returns breached when resolution ≥100%", () => {
    // Sev-A worst = 4h. 100% = 4h
    const incident = { id: "INC-4", priority: "Sev-A", createdAt: 5 };
    const result = computeSlaStatus(incident, policy);
    expect(result.status).toBe("breached");
    expect(result.breached).toBe(true);
  });

  it("uses Sev-C defaults for unknown priority", () => {
    const incident = { id: "INC-5", priority: "Unknown", createdAt: 1 };
    const result = computeSlaStatus(incident, policy);
    expect(result.worstResponseTarget).toBe(9); // Sev-C worst
    expect(result.firstResponseTarget).toBe(4); // Sev-C first
  });

  it("computes correct remainingHours", () => {
    // Sev-D worst = 27h, elapsed = 10h → remaining = 17h
    const incident = { id: "INC-6", priority: "Sev-D", createdAt: 10 };
    const result = computeSlaStatus(incident, policy);
    expect(result.remainingHours).toBe(17);
  });

  it("remainingHours is 0 when breached", () => {
    const incident = { id: "INC-7", priority: "Sev-A", createdAt: 50 };
    const result = computeSlaStatus(incident, policy);
    expect(result.remainingHours).toBe(0);
  });

  it("includes incidentId and computedAt in result", () => {
    const incident = { id: "INC-8", priority: "Sev-B", createdAt: 0.5 };
    const result = computeSlaStatus(incident, policy);
    expect(result.incidentId).toBe("INC-8");
    expect(result.computedAt).toBeTruthy();
  });
});

// ─── v3.23.1: Zendesk metrics override + Pending/On Hold pause behavior ──
describe("computeSlaStatus — zdMetrics override (v3.23.1)", () => {
  const policy = DEFAULT_SLA_POLICY;

  it("uses zdMetrics.fullResolutionBizMin when resolved", () => {
    // Sev-C worst = 9h. ZD says 3h biz (180 min) → resolutionPct = 33.3%
    const incident = {
      id: "INC-Z1", priority: "Sev-C",
      createdAt: "2026-04-22T09:00:00+08:00",
      resolvedAt: "2026-04-30T17:00:00+08:00", // many wall-clock hours later
      status: "Resolved",
      zdMetrics: { fullResolutionBizMin: 180, agentWaitBizMin: 60 },
    };
    const r = computeSlaStatus(incident, policy);
    expect(r.elapsedSource).toBe("zendesk_full_resolution");
    expect(r.hoursElapsed).toBe(3);
    expect(r.status).toBe("on_track");
  });

  it("does NOT use agentWaitBizMin for active tickets (it only counts Pending duration)", () => {
    // Active Sev-C with ZD agent_wait=4h. Must fall back to wall_clock so SLA reflects total elapsed.
    const incident = {
      id: "INC-Z2", priority: "Sev-C",
      createdAt: "2026-04-22T09:00:00+08:00",
      status: "Open",
      zdMetrics: { fullResolutionBizMin: 999999, agentWaitBizMin: 240 },
    };
    const r = computeSlaStatus(incident, policy);
    expect(r.elapsedSource).toBe("wall_clock");
  });

  it("falls back to wall-clock when zdMetrics absent", () => {
    const incident = { id: "INC-Z3", priority: "Sev-C", createdAt: 2 };
    const r = computeSlaStatus(incident, policy);
    expect(r.elapsedSource).toBe("wall_clock");
    expect(r.hoursElapsed).toBe(2);
  });

  it("ignores fullResolutionBizMin when not resolved", () => {
    const incident = { id: "INC-Z4", priority: "Sev-C", createdAt: 1, status: "Open", zdMetrics: { fullResolutionBizMin: 60 } };
    const r = computeSlaStatus(incident, policy);
    expect(r.elapsedSource).toBe("wall_clock");
    expect(r.hoursElapsed).toBe(1);
  });
});

describe("getBusinessHoursElapsed — Pending+On Hold pause chain (v3.23)", () => {
  it("subtracts BH across multiple closed pause entries (Pending then On Hold)", () => {
    // Wed 9AM → Wed 6PM = 9h. Pause 10-11 (1h, Pending) and 13-15 (2h, On Hold) = 6h.
    const created = new Date("2026-04-22T09:00:00+08:00");
    const now = new Date("2026-04-22T18:00:00+08:00");
    const hrs = getBusinessHoursElapsed(created, now, {
      start: 9, end: 18, days: "Mon-Fri",
      slaPauseHistory: [
        { pausedAt: "2026-04-22T10:00:00+08:00", resumedAt: "2026-04-22T11:00:00+08:00", reason: "→ pending" },
        { pausedAt: "2026-04-22T13:00:00+08:00", resumedAt: "2026-04-22T15:00:00+08:00", reason: "→ hold" },
      ],
    });
    expect(hrs).toBe(6);
  });

  it("respects ongoing pause from On Hold transition (no resumedAt)", () => {
    // Wed 9AM → Wed 5PM = 8h. Paused at 14:00 (On Hold), still ongoing at 17:00 → 5h.
    const created = new Date("2026-04-22T09:00:00+08:00");
    const now = new Date("2026-04-22T17:00:00+08:00");
    const hrs = getBusinessHoursElapsed(created, now, {
      start: 9, end: 18, days: "Mon-Fri",
      slaPauseHistory: [
        { pausedAt: "2026-04-22T14:00:00+08:00", reason: "→ hold (webhook)" },
      ],
    });
    expect(hrs).toBe(5);
  });
});


describe("computeSlaStatus_v2", () => {
  const policy = DEFAULT_SLA_POLICY;

  it("uses resolutionPct only when incident is acknowledged", () => {
    // Sev-A: firstResponse=0.5, worst=4. Elapsed=1h.
    // firstResponsePct = 1/0.5 * 100 = 200% (breached)
    // resolutionPct = 1/4 * 100 = 25% (on_track)
    // With ack → only resolutionPct matters → on_track
    const incident = { id: "INC-V2-1", priority: "Sev-A", createdAt: 1, firstAckAt: "2026-04-22T10:00:00Z" };
    const result = computeSlaStatus_v2(incident, policy);
    expect(result.status).toBe("on_track");
    expect(result.ackConsidered).toBe(false); // ack exists, so first response not considered
  });

  it("uses worstPct (max of first+resolution) when NOT acknowledged", () => {
    // Sev-A: firstResponse=0.5, worst=4. Elapsed=1h.
    // firstResponsePct = 200%, resolutionPct = 25%
    // Without ack → worstPct = max(200, 25) = 200 → breached
    const incident = { id: "INC-V2-2", priority: "Sev-A", createdAt: 1 };
    const result = computeSlaStatus_v2(incident, policy);
    expect(result.status).toBe("breached");
    expect(result.ackConsidered).toBe(true);
    expect(result.worstPct).toBeGreaterThanOrEqual(100);
  });

  it("respects firstResponseAt as ack indicator", () => {
    const incident = { id: "INC-V2-3", priority: "Sev-A", createdAt: 1, firstResponseAt: "2026-04-22T10:00:00Z" };
    const result = computeSlaStatus_v2(incident, policy);
    expect(result.ackConsidered).toBe(false);
  });

  it("respects acknowledgedAt as ack indicator", () => {
    const incident = { id: "INC-V2-4", priority: "Sev-A", createdAt: 1, acknowledgedAt: "2026-04-22T10:00:00Z" };
    const result = computeSlaStatus_v2(incident, policy);
    expect(result.ackConsidered).toBe(false);
  });

  it("output shape includes worstPct and ackConsidered", () => {
    const incident = { id: "INC-V2-5", priority: "Sev-C", createdAt: 2 };
    const result = computeSlaStatus_v2(incident, policy);
    expect(result).toHaveProperty("worstPct");
    expect(result).toHaveProperty("ackConsidered");
    expect(result).toHaveProperty("incidentId");
    expect(result).toHaveProperty("status");
  });
});

// ─── SlaEngine class ────────────────────────────────────────────────────
describe("SlaEngine", () => {
  let mockDb;

  beforeEach(() => {
    mockDb = {
      getAll: vi.fn().mockResolvedValue([]),
      getOpen: vi.fn().mockResolvedValue([]),
      getOne: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(),
      bulkUpsert: vi.fn().mockResolvedValue(),
      audit: vi.fn().mockResolvedValue(),
      getMaxUpdatedAt: vi.fn().mockResolvedValue("hash-1"),
    };
  });

  it("constructs with default policy merged", () => {
    const engine = new SlaEngine(mockDb);
    expect(engine.policy.severities["Sev-A"].firstResponse).toBe(0.5);
    expect(engine.policy.severities["Sev-D"].worstResponse).toBe(27);
  });

  it("constructs with custom policy overrides", () => {
    const engine = new SlaEngine(mockDb, {
      policy: { severities: { "Sev-A": { firstResponse: 1, worstResponse: 8 } } },
    });
    expect(engine.policy.severities["Sev-A"].worstResponse).toBe(8);
  });

  it("loadPolicy merges DB policy into defaults", async () => {
    mockDb.getOne.mockResolvedValue({
      data: JSON.stringify({ severities: { "Sev-A": { firstResponse: 0.25, worstResponse: 2 } } }),
    });
    const engine = new SlaEngine(mockDb);
    await engine.loadPolicy();
    expect(engine.policy.severities["Sev-A"].worstResponse).toBe(2);
    // Other severities should still have defaults
    expect(engine.policy.severities["Sev-D"].worstResponse).toBe(27);
  });

  it("runCycle skips when data hash unchanged", async () => {
    const engine = new SlaEngine(mockDb);
    engine._lastDataHash = "hash-1"; // same as mock will return
    await engine.runCycle();
    expect(engine.stats.cyclesSkipped).toBe(1);
    expect(mockDb.getOpen).not.toHaveBeenCalled();
  });

  it("runCycle processes open incidents and writes SLA tracking", async () => {
    mockDb.getMaxUpdatedAt.mockResolvedValue("hash-new");
    const incident = {
      id: "INC-100",
      priority: "Sev-C",
      status: "Open",
      createdAt: 2, // numeric shortcut: 2h elapsed
    };
    mockDb.getOpen.mockResolvedValue([{ data: JSON.stringify(incident) }]);

    const engine = new SlaEngine(mockDb);
    await engine.runCycle();

    expect(engine.stats.totalChecked).toBe(1);
    expect(mockDb.bulkUpsert).toHaveBeenCalledWith(
      "sla_tracking",
      expect.arrayContaining([expect.objectContaining({ id: "INC-100" })]),
    );
  });

  it("runCycle triggers onBreach callback for breached incidents", async () => {
    mockDb.getMaxUpdatedAt.mockResolvedValue("hash-breach");
    const incident = {
      id: "INC-BREACH",
      priority: "Sev-A",
      status: "Open",
      title: "Critical outage",
      createdAt: 50, // way past 4h target
    };
    mockDb.getOpen.mockResolvedValue([{ data: JSON.stringify(incident) }]);

    const onBreach = vi.fn();
    const engine = new SlaEngine(mockDb, { onBreach });
    await engine.runCycle();

    expect(engine.stats.breached).toBe(1);
    expect(onBreach).toHaveBeenCalledWith(expect.objectContaining({ incidentId: "INC-BREACH" }));
  });

  it("runCycle does not re-notify already-breached incidents", async () => {
    mockDb.getMaxUpdatedAt
      .mockResolvedValueOnce("hash-a")
      .mockResolvedValueOnce("hash-b");
    const incident = {
      id: "INC-DEDUP",
      priority: "Sev-A",
      status: "Open",
      createdAt: 50,
    };
    mockDb.getOpen.mockResolvedValue([{ data: JSON.stringify(incident) }]);

    const onBreach = vi.fn();
    const engine = new SlaEngine(mockDb, { onBreach });
    await engine.runCycle();
    await engine.runCycle();

    // Should only fire once despite two cycles
    expect(onBreach).toHaveBeenCalledTimes(1);
  });

  it("getStats returns current stats with policy", () => {
    const engine = new SlaEngine(mockDb);
    const stats = engine.getStats();
    expect(stats).toHaveProperty("totalChecked");
    expect(stats).toHaveProperty("policy");
    expect(stats.policy.severities).toHaveProperty("Sev-A");
  });
});

// ─── Priority normalization regression tests ────────────────────────────
describe("computeSlaStatus priority normalization", () => {
  const policy = DEFAULT_SLA_POLICY;

  it("treats P1 as Sev-A (not Sev-C fallback)", () => {
    const r = computeSlaStatus({ id: "INC-P1", priority: "P1", createdAt: 1 }, policy);
    expect(r.priority).toBe("Sev-A");
    expect(r.firstResponseTarget).toBe(0.5);
    expect(r.worstResponseTarget).toBe(4);
    expect(r.rawPriority).toBe("P1");
  });

  it("treats P2 as Sev-B", () => {
    const r = computeSlaStatus({ id: "INC-P2", priority: "P2", createdAt: 1 }, policy);
    expect(r.priority).toBe("Sev-B");
    expect(r.worstResponseTarget).toBe(4);
  });

  it("treats P3 as Sev-C", () => {
    const r = computeSlaStatus({ id: "INC-P3", priority: "P3", createdAt: 1 }, policy);
    expect(r.priority).toBe("Sev-C");
    expect(r.worstResponseTarget).toBe(9);
  });

  it("treats P4 as Sev-D", () => {
    const r = computeSlaStatus({ id: "INC-P4", priority: "P4", createdAt: 1 }, policy);
    expect(r.priority).toBe("Sev-D");
    expect(r.worstResponseTarget).toBe(27);
  });

  it("treats Critical/Urgent as Sev-A", () => {
    expect(computeSlaStatus({ id: "INC-C", priority: "Critical", createdAt: 1 }, policy).priority).toBe("Sev-A");
    expect(computeSlaStatus({ id: "INC-U", priority: "urgent", createdAt: 1 }, policy).priority).toBe("Sev-A");
  });

  it("falls back to Sev-C for missing/blank/unknown priority", () => {
    expect(computeSlaStatus({ id: "INC-NULL", priority: null, createdAt: 1 }, policy).priority).toBe("Sev-C");
    expect(computeSlaStatus({ id: "INC-BLANK", priority: "", createdAt: 1 }, policy).priority).toBe("Sev-C");
    expect(computeSlaStatus({ id: "INC-WTF", priority: "wtf", createdAt: 1 }, policy).priority).toBe("Sev-C");
  });
});
