import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnalyticsEngine } from "../analyticsEngine.js";

// ─── Helper: wrap data as DB rows ──────────────────────────────────────
function rows(items) {
  return items.map((item) => ({ data: JSON.stringify(item) }));
}

describe("AnalyticsEngine", () => {
  let db;

  beforeEach(() => {
    db = {
      getAll: vi.fn().mockResolvedValue([]),
    };
  });

  // ─── Cache ────────────────────────────────────────────────────────────
  describe("cache", () => {
    it("returns cached data on second call", async () => {
      db.getAll.mockResolvedValue([]);
      const engine = new AnalyticsEngine(db);

      await engine.getDashboardKPIs();
      await engine.getDashboardKPIs();

      // getAll should only be called during the first invocation
      const firstCallCount = db.getAll.mock.calls.length;
      expect(firstCallCount).toBeGreaterThan(0);

      // Reset and call again — should still use cache
      db.getAll.mockClear();
      await engine.getDashboardKPIs();
      expect(db.getAll).not.toHaveBeenCalled();
    });

    it("invalidateCache clears all cached data", async () => {
      const engine = new AnalyticsEngine(db);
      await engine.getDashboardKPIs();

      engine.invalidateCache();
      db.getAll.mockClear();

      await engine.getDashboardKPIs();
      expect(db.getAll).toHaveBeenCalled();
    });

    it("cache expires after TTL", async () => {
      const engine = new AnalyticsEngine(db, { cacheTTL: 100 }); // 100ms
      await engine.getDashboardKPIs();
      db.getAll.mockClear();

      // Wait for cache to expire
      await new Promise((r) => setTimeout(r, 150));
      await engine.getDashboardKPIs();
      expect(db.getAll).toHaveBeenCalled();
    });
  });

  // ─── getDashboardKPIs ─────────────────────────────────────────────────
  describe("getDashboardKPIs", () => {
    it("counts active incidents (excluding closed/resolved)", async () => {
      const incidents = [
        { id: "1", status: "Open", priority: "Sev-A", createdAt: new Date().toISOString() },
        { id: "2", status: "In Progress", priority: "Sev-B", createdAt: new Date().toISOString() },
        { id: "3", status: "Closed", priority: "Sev-C", createdAt: new Date().toISOString() },
        { id: "4", status: "Resolved", priority: "Sev-C", createdAt: new Date().toISOString() },
      ];

      db.getAll.mockImplementation((collection) => {
        if (collection === "incidents") return Promise.resolve(rows(incidents));
        return Promise.resolve([]);
      });

      const engine = new AnalyticsEngine(db);
      const kpis = await engine.getDashboardKPIs();

      expect(kpis.totalIncidents).toBe(4);
      expect(kpis.activeIncidents).toBe(2);
      expect(kpis.resolvedCount).toBe(2);
    });

    it("computes priority distribution for active incidents", async () => {
      const incidents = [
        { id: "1", status: "Open", priority: "Sev-A", createdAt: new Date().toISOString() },
        { id: "2", status: "Open", priority: "Sev-A", createdAt: new Date().toISOString() },
        { id: "3", status: "Open", priority: "Sev-B", createdAt: new Date().toISOString() },
      ];

      db.getAll.mockImplementation((collection) => {
        if (collection === "incidents") return Promise.resolve(rows(incidents));
        return Promise.resolve([]);
      });

      const engine = new AnalyticsEngine(db);
      const kpis = await engine.getDashboardKPIs();

      expect(kpis.priorityDistribution["Sev-A"]).toBe(2);
      expect(kpis.priorityDistribution["Sev-B"]).toBe(1);
    });

    it("computes SLA compliance from sla_tracking", async () => {
      const slaItems = [
        { status: "on_track" },
        { status: "met" },
        { status: "breached" },
      ];

      db.getAll.mockImplementation((collection) => {
        if (collection === "sla_tracking") return Promise.resolve(rows(slaItems));
        return Promise.resolve([]);
      });

      const engine = new AnalyticsEngine(db);
      const kpis = await engine.getDashboardKPIs();

      // 2 met out of 3 = 67%
      expect(kpis.slaCompliance).toBe(67);
    });

    it("returns 100% SLA compliance when no tracking data", async () => {
      const engine = new AnalyticsEngine(db);
      const kpis = await engine.getDashboardKPIs();
      expect(kpis.slaCompliance).toBe(100);
    });

    it("includes computedAt timestamp", async () => {
      const engine = new AnalyticsEngine(db);
      const kpis = await engine.getDashboardKPIs();
      expect(kpis.computedAt).toBeTruthy();
    });
  });

  // ─── getIncidentTrends ────────────────────────────────────────────────
  describe("getIncidentTrends", () => {
    it("returns correct number of days", async () => {
      const engine = new AnalyticsEngine(db);
      const result = await engine.getIncidentTrends(7);

      expect(result.period).toBe("7d");
      expect(result.data).toHaveLength(7);
    });

    it("buckets incidents by created date", async () => {
      const today = new Date().toISOString().split("T")[0];
      const incidents = [
        { id: "1", status: "Open", createdAt: `${today}T10:00:00Z` },
        { id: "2", status: "Open", createdAt: `${today}T14:00:00Z` },
      ];

      db.getAll.mockImplementation((collection) => {
        if (collection === "incidents") return Promise.resolve(rows(incidents));
        return Promise.resolve([]);
      });

      const engine = new AnalyticsEngine(db);
      const result = await engine.getIncidentTrends(7);

      const todayEntry = result.data.find((d) => d.date === today);
      expect(todayEntry.created).toBe(2);
    });

    it("counts resolved incidents by resolved date", async () => {
      const today = new Date().toISOString().split("T")[0];
      const incidents = [
        { id: "1", status: "Resolved", createdAt: "2026-04-01T10:00:00Z", resolvedAt: `${today}T10:00:00Z` },
      ];

      db.getAll.mockImplementation((collection) => {
        if (collection === "incidents") return Promise.resolve(rows(incidents));
        return Promise.resolve([]);
      });

      const engine = new AnalyticsEngine(db);
      const result = await engine.getIncidentTrends(7);

      const todayEntry = result.data.find((d) => d.date === today);
      expect(todayEntry.resolved).toBe(1);
    });
  });

  // ─── getSLAReport ─────────────────────────────────────────────────────
  describe("getSLAReport", () => {
    it("computes compliance by priority", async () => {
      const slaItems = [
        { priority: "Sev-A", status: "breached" },
        { priority: "Sev-A", status: "on_track" },
        { priority: "Sev-B", status: "on_track" },
      ];

      db.getAll.mockImplementation((collection) => {
        if (collection === "sla_tracking") return Promise.resolve(rows(slaItems));
        return Promise.resolve([]);
      });

      const engine = new AnalyticsEngine(db);
      const report = await engine.getSLAReport();

      expect(report.byPriority["Sev-A"].total).toBe(2);
      expect(report.byPriority["Sev-A"].breached).toBe(1);
      expect(report.byPriority["Sev-A"].compliance).toBe(50);
      expect(report.byPriority["Sev-B"].compliance).toBe(100);
    });

    it("returns 100% overall when no breaches", async () => {
      const slaItems = [
        { priority: "Sev-C", status: "on_track" },
      ];

      db.getAll.mockImplementation((collection) => {
        if (collection === "sla_tracking") return Promise.resolve(rows(slaItems));
        return Promise.resolve([]);
      });

      const engine = new AnalyticsEngine(db);
      const report = await engine.getSLAReport();
      expect(report.overallCompliance).toBe(100);
    });
  });

  // ─── getAgentPerformance ──────────────────────────────────────────────
  describe("getAgentPerformance", () => {
    it("groups incidents by assignee with resolution rates", async () => {
      const now = new Date();
      const incidents = [
        { id: "1", assignee: "Alice", status: "Resolved", createdAt: new Date(now - 5 * 3600000).toISOString(), resolvedAt: now.toISOString() },
        { id: "2", assignee: "Alice", status: "Open", createdAt: now.toISOString() },
        { id: "3", assignee: "Bob", status: "Closed", createdAt: new Date(now - 2 * 3600000).toISOString(), closedAt: now.toISOString() },
      ];

      db.getAll.mockImplementation((collection) => {
        if (collection === "incidents") return Promise.resolve(rows(incidents));
        return Promise.resolve([]);
      });

      const engine = new AnalyticsEngine(db);
      const result = await engine.getAgentPerformance();

      expect(result.agents["Alice"].assigned).toBe(2);
      expect(result.agents["Alice"].resolved).toBe(1);
      expect(result.agents["Alice"].resolutionRate).toBe(50);
      expect(result.agents["Bob"].assigned).toBe(1);
      expect(result.agents["Bob"].resolved).toBe(1);
    });
  });
});
