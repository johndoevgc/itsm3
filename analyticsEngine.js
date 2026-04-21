// ─── Analytics Engine ────────────────────────────────────────────────────
// Computes KPIs, trends, and operational metrics from ITSM data.
// Provides endpoints for dashboards, reports, and AI pattern detection.

class AnalyticsEngine {
  constructor(db, options = {}) {
    this.db = db;
    this.cache = new Map(); // key -> { data, expiry }
    this.cacheTTL = options.cacheTTL || 5 * 60 * 1000; // 5 min default
    this.lastComputed = null;
  }

  // ─── Cache helpers ────────────────────────────────────────────────────
  _cacheGet(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) { this.cache.delete(key); return null; }
    return entry.data;
  }

  _cacheSet(key, data) {
    this.cache.set(key, { data, expiry: Date.now() + this.cacheTTL });
    return data;
  }

  invalidateCache() {
    this.cache.clear();
  }

  // ─── Dashboard KPIs ──────────────────────────────────────────────────
  async getDashboardKPIs() {
    const cached = this._cacheGet("dashboard_kpis");
    if (cached) return cached;

    const [incidents, problems, changes, requests, sla] = await Promise.all([
      this._loadCollection("incidents"),
      this._loadCollection("problems"),
      this._loadCollection("changes"),
      this._loadCollection("requests"),
      this._loadCollection("sla_tracking"),
    ]);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeek = new Date(today); thisWeek.setDate(thisWeek.getDate() - 7);
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const activeIncidents = incidents.filter(i => !["closed", "resolved"].includes((i.status || "").toLowerCase()));
    const todayIncidents = incidents.filter(i => new Date(i.createdAt || i.created_at || i.created) >= today);
    const weekIncidents = incidents.filter(i => new Date(i.createdAt || i.created_at || i.created) >= thisWeek);
    const monthIncidents = incidents.filter(i => new Date(i.createdAt || i.created_at || i.created) >= thisMonth);

    // Resolution metrics
    const resolved = incidents.filter(i => (i.status || "").toLowerCase() === "resolved" || (i.status || "").toLowerCase() === "closed");
    const resolutionTimes = resolved.map(i => {
      const created = new Date(i.createdAt || i.created_at || i.created);
      const resolvedAt = new Date(i.resolvedAt || i.closedAt || i.lastModified);
      return isNaN(created) || isNaN(resolvedAt) ? null : (resolvedAt - created) / 3600000;
    }).filter(t => t !== null && t > 0 && t < 720);

    const avgResolutionHrs = resolutionTimes.length > 0 ? resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length : 0;

    // SLA compliance
    const slaActive = sla.filter(s => !s._deleted);
    const slaMet = slaActive.filter(s => s.status === "on_track" || s.status === "met").length;
    const slaCompliance = slaActive.length > 0 ? Math.round((slaMet / slaActive.length) * 100) : 100;

    // Priority distribution
    const priorityDist = {};
    for (const inc of activeIncidents) {
      const p = inc.priority || "Unassigned";
      priorityDist[p] = (priorityDist[p] || 0) + 1;
    }

    // Category distribution
    const categoryDist = {};
    for (const inc of incidents) {
      const c = inc.category || inc.itsmCategory || "Other";
      categoryDist[c] = (categoryDist[c] || 0) + 1;
    }

    // Assignee workload
    const assigneeWorkload = {};
    for (const inc of activeIncidents) {
      const a = inc.assignee || inc.assignedTo || "Unassigned";
      assigneeWorkload[a] = (assigneeWorkload[a] || 0) + 1;
    }

    const result = {
      totalIncidents: incidents.length,
      activeIncidents: activeIncidents.length,
      todayCreated: todayIncidents.length,
      weekCreated: weekIncidents.length,
      monthCreated: monthIncidents.length,
      resolvedCount: resolved.length,
      avgResolutionHrs: Math.round(avgResolutionHrs * 10) / 10,
      slaCompliance,
      slaTracked: slaActive.length,
      totalProblems: problems.length,
      activeProblems: problems.filter(p => (p.status || "").toLowerCase() !== "closed").length,
      totalChanges: changes.length,
      pendingChanges: changes.filter(c => (c.approvalStatus || "").toLowerCase() === "pending").length,
      totalRequests: requests.length,
      openRequests: requests.filter(r => (r.status || "").toLowerCase() !== "closed" && (r.status || "").toLowerCase() !== "fulfilled").length,
      priorityDistribution: priorityDist,
      categoryDistribution: categoryDist,
      assigneeWorkload,
      computedAt: now.toISOString(),
    };

    return this._cacheSet("dashboard_kpis", result);
  }

  // ─── Incident Trends (daily counts over N days) ───────────────────────
  async getIncidentTrends(days = 30) {
    const cacheKey = `trends_${days}`;
    const cached = this._cacheGet(cacheKey);
    if (cached) return cached;

    const incidents = await this._loadCollection("incidents");
    const now = new Date();
    const trends = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dayStr = date.toISOString().split("T")[0];

      const created = incidents.filter(inc => {
        const d = (inc.createdAt || inc.created_at || inc.created || "").substring(0, 10);
        return d === dayStr;
      }).length;

      const resolved = incidents.filter(inc => {
        const s = (inc.status || "").toLowerCase();
        if (s !== "resolved" && s !== "closed") return false;
        const d = (inc.resolvedAt || inc.closedAt || inc.lastModified || "").substring(0, 10);
        return d === dayStr;
      }).length;

      trends.push({ date: dayStr, created, resolved });
    }

    return this._cacheSet(cacheKey, { period: `${days}d`, data: trends });
  }

  // ─── SLA Performance Report ───────────────────────────────────────────
  async getSLAReport() {
    const cached = this._cacheGet("sla_report");
    if (cached) return cached;

    const sla = await this._loadCollection("sla_tracking");
    const active = sla.filter(s => !s._deleted);

    const byPriority = {};
    const breaches = [];

    for (const s of active) {
      const p = s.priority || "Unknown";
      if (!byPriority[p]) byPriority[p] = { total: 0, met: 0, breached: 0, atRisk: 0 };
      byPriority[p].total++;
      if (s.status === "breached") { byPriority[p].breached++; breaches.push(s); }
      else if (s.status === "at_risk" || s.status === "critical") byPriority[p].atRisk++;
      else byPriority[p].met++;
    }

    // Compliance percentages
    for (const key of Object.keys(byPriority)) {
      const b = byPriority[key];
      b.compliance = b.total > 0 ? Math.round((b.met / b.total) * 100) : 100;
    }

    const overall = active.length > 0
      ? Math.round((active.filter(s => s.status !== "breached").length / active.length) * 100)
      : 100;

    const result = {
      overallCompliance: overall,
      totalTracked: active.length,
      byPriority,
      recentBreaches: breaches.slice(-20).map(b => ({
        incidentId: b.incidentId,
        priority: b.priority,
        hoursElapsed: b.hoursElapsed,
        target: b.worstResponseTarget,
      })),
      computedAt: new Date().toISOString(),
    };

    return this._cacheSet("sla_report", result);
  }

  // ─── Agent/Team Performance ───────────────────────────────────────────
  async getAgentPerformance() {
    const cached = this._cacheGet("agent_performance");
    if (cached) return cached;

    const incidents = await this._loadCollection("incidents");
    const agents = {};

    for (const inc of incidents) {
      const agent = inc.assignee || inc.assignedTo || "Unassigned";
      if (!agents[agent]) agents[agent] = { assigned: 0, resolved: 0, avgResolutionHrs: 0, _times: [] };
      agents[agent].assigned++;

      const status = (inc.status || "").toLowerCase();
      if (status === "resolved" || status === "closed") {
        agents[agent].resolved++;
        const created = new Date(inc.createdAt || inc.created_at || inc.created);
        const resolvedAt = new Date(inc.resolvedAt || inc.closedAt || inc.lastModified);
        const hrs = (resolvedAt - created) / 3600000;
        if (hrs > 0 && hrs < 720) agents[agent]._times.push(hrs);
      }
    }

    // Compute averages
    const result = {};
    for (const [name, data] of Object.entries(agents)) {
      result[name] = {
        assigned: data.assigned,
        resolved: data.resolved,
        resolutionRate: data.assigned > 0 ? Math.round((data.resolved / data.assigned) * 100) : 0,
        avgResolutionHrs: data._times.length > 0
          ? Math.round((data._times.reduce((a, b) => a + b, 0) / data._times.length) * 10) / 10
          : null,
      };
    }

    return this._cacheSet("agent_performance", { agents: result, computedAt: new Date().toISOString() });
  }

  // ─── Pattern Detection (AI-ready data) ────────────────────────────────
  async getPatterns() {
    const cached = this._cacheGet("patterns");
    if (cached) return cached;

    const incidents = await this._loadCollection("incidents");
    const now = new Date();
    const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recent = incidents.filter(i => {
      const d = new Date(i.createdAt || i.created_at || i.created);
      return !isNaN(d) && d >= thirtyDaysAgo;
    });

    // Recurring categories
    const catCounts = {};
    for (const inc of recent) {
      const c = inc.category || inc.itsmCategory || "Other";
      catCounts[c] = (catCounts[c] || 0) + 1;
    }

    // Hourly distribution
    const hourDist = new Array(24).fill(0);
    for (const inc of recent) {
      const d = new Date(inc.createdAt || inc.created_at || inc.created);
      if (!isNaN(d)) hourDist[d.getHours()]++;
    }

    // Day of week distribution
    const dayDist = new Array(7).fill(0);
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (const inc of recent) {
      const d = new Date(inc.createdAt || inc.created_at || inc.created);
      if (!isNaN(d)) dayDist[d.getDay()]++;
    }

    // Repeated keywords in titles
    const wordFreq = {};
    for (const inc of recent) {
      const words = (inc.title || "").toLowerCase().split(/\s+/).filter(w => w.length > 3);
      for (const w of words) wordFreq[w] = (wordFreq[w] || 0) + 1;
    }
    const topWords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([word, count]) => ({ word, count }));

    // Severity trend
    const sevTrend = {};
    for (const inc of recent) {
      const week = this._getWeekKey(new Date(inc.createdAt || inc.created_at || inc.created));
      const sev = inc.priority || "Unknown";
      if (!sevTrend[week]) sevTrend[week] = {};
      sevTrend[week][sev] = (sevTrend[week][sev] || 0) + 1;
    }

    const result = {
      recentIncidents: recent.length,
      topCategories: Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([cat, count]) => ({ category: cat, count })),
      hourlyDistribution: hourDist.map((count, hour) => ({ hour, count })),
      dayOfWeekDistribution: dayDist.map((count, i) => ({ day: dayNames[i], count })),
      topKeywords: topWords,
      severityTrend: sevTrend,
      computedAt: new Date().toISOString(),
    };

    return this._cacheSet("patterns", result);
  }

  // ─── Collection Summary (for executive reports) ───────────────────────
  async getExecutiveSummary() {
    const cached = this._cacheGet("executive_summary");
    if (cached) return cached;

    const [kpis, slaReport, trends] = await Promise.all([
      this.getDashboardKPIs(),
      this.getSLAReport(),
      this.getIncidentTrends(7),
    ]);

    const result = {
      kpis: {
        activeIncidents: kpis.activeIncidents,
        slaCompliance: kpis.slaCompliance,
        avgResolutionHrs: kpis.avgResolutionHrs,
        weekCreated: kpis.weekCreated,
        pendingChanges: kpis.pendingChanges,
        openRequests: kpis.openRequests,
      },
      sla: {
        overall: slaReport.overallCompliance,
        breachCount: slaReport.recentBreaches.length,
      },
      weekTrend: trends.data,
      computedAt: new Date().toISOString(),
    };

    return this._cacheSet("executive_summary", result);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────
  async _loadCollection(name) {
    try {
      const rows = await this.db.getAll(name);
      return rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean).filter(r => !r._deleted);
    } catch { return []; }
  }

  _getWeekKey(date) {
    if (isNaN(date)) return "unknown";
    const d = new Date(date);
    d.setDate(d.getDate() - d.getDay());
    return d.toISOString().split("T")[0];
  }
}

module.exports = { AnalyticsEngine };
