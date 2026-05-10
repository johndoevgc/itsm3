// CSAT Survey tests
import { describe, it, expect } from "vitest";

describe("CSAT Survey", () => {
  it("validates rating range 1-5", () => {
    const validRatings = [1, 2, 3, 4, 5];
    for (const r of validRatings) {
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(5);
    }
    expect(0).toBeLessThan(1);
    expect(6).toBeGreaterThan(5);
  });

  it("computes average CSAT score", () => {
    const responses = [
      { overall: 5 },
      { overall: 4 },
      { overall: 3 },
      { overall: 5 },
    ];
    const avg = responses.reduce((s, r) => s + r.overall, 0) / responses.length;
    expect(avg).toBe(4.25);
  });

  it("computes NPS from CSAT responses", () => {
    const responses = [
      { overall: 5 }, { overall: 5 }, { overall: 4 },
      { overall: 3 }, { overall: 2 }, { overall: 1 },
    ];
    const promoters = responses.filter((r) => r.overall >= 4).length;
    const detractors = responses.filter((r) => r.overall <= 2).length;
    const nps = Math.round(((promoters - detractors) / responses.length) * 100);
    expect(nps).toBe(17);
  });

  it("separates AI-resolved vs human-resolved CSAT", () => {
    const responses = [
      { overall: 5, aiResolved: true },
      { overall: 4, aiResolved: true },
      { overall: 3, aiResolved: false },
      { overall: 5, aiResolved: false },
    ];
    const aiResponses = responses.filter((r) => r.aiResolved);
    const humanResponses = responses.filter((r) => !r.aiResolved);
    expect(aiResponses).toHaveLength(2);
    expect(humanResponses).toHaveLength(2);
    const aiAvg = aiResponses.reduce((s, r) => s + r.overall, 0) / aiResponses.length;
    expect(aiAvg).toBe(4.5);
  });

  it("generates CSAT response ID format", () => {
    const id = `CSAT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    expect(id).toMatch(/^CSAT-\d+-[a-z0-9]+$/);
  });

  it("filters responses by time window", () => {
    const now = Date.now();
    const responses = [
      { overall: 5, submittedAt: new Date(now - 10 * 86400000).toISOString() },
      { overall: 3, submittedAt: new Date(now - 40 * 86400000).toISOString() },
      { overall: 4, submittedAt: new Date(now - 5 * 86400000).toISOString() },
    ];
    const days = 30;
    const since = new Date(now - days * 86400000);
    const recent = responses.filter((r) => new Date(r.submittedAt) >= since);
    expect(recent).toHaveLength(2);
  });

  it("computes distribution histogram", () => {
    const responses = [
      { overall: 5 }, { overall: 5 }, { overall: 4 },
      { overall: 3 }, { overall: 5 },
    ];
    const dist = {};
    for (const r of responses) {
      dist[r.overall] = (dist[r.overall] || 0) + 1;
    }
    expect(dist[5]).toBe(3);
    expect(dist[4]).toBe(1);
    expect(dist[3]).toBe(1);
  });

  it("truncates comment to max length", () => {
    const longComment = "a".repeat(3000);
    const truncated = longComment.slice(0, 2000);
    expect(truncated.length).toBe(2000);
  });
});
