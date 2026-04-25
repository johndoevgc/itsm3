// ─── Server-Side SLA Engine ─────────────────────────────────────────────
// Computes SLA compliance, tracks breaches, and auto-escalates.
// Runs as a periodic timer on the server.

// ─── Default SLA Policy (matches client-side DEFAULT_SLA_POLICY) ────────
const DEFAULT_SLA_POLICY = {
  supportHours: { start: 9, end: 18, days: "Mon-Fri", tz: "Asia/Singapore" },
  severities: {
    "Sev-A": { firstResponse: 0.5, worstResponse: 4 },
    "Sev-B": { firstResponse: 1,   worstResponse: 4 },
    "Sev-C": { firstResponse: 4,   worstResponse: 9 },
    "Sev-D": { firstResponse: 9,   worstResponse: 27 },
  },
};

// ─── Business Hours Elapsed Calculator (server-side mirror) ─────────────
function getBusinessHoursElapsed(createdAt, now, options = {}) {
  if (!createdAt) return 0;
  const start = new Date(createdAt);
  const end = now || new Date();
  if (isNaN(start.getTime())) return 0;
  const BH_START = options.start || 9;
  const BH_END = options.end || 18;
  const daysStr = options.days || "Mon-Fri";
  const holidays = options.holidays || [];
  const holidaySet = new Set(holidays.map(h => typeof h === "string" ? h : h.date));

  // Parse working days
  let workingDays;
  if (daysStr === "24/7") {
    workingDays = new Set([0,1,2,3,4,5,6]);
  } else {
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const parts = daysStr.split("-");
    if (parts.length === 2) {
      const s = dayMap[parts[0]] ?? 1, e = dayMap[parts[1]] ?? 5;
      workingDays = new Set();
      for (let d = s; d !== (e + 1) % 7; d = (d + 1) % 7) workingDays.add(d);
      workingDays.add(e);
    } else {
      workingDays = new Set([1,2,3,4,5]);
    }
  }

  let elapsed = 0;
  let cursor = new Date(start);
  const maxIter = 366 * 24; // safety limit
  let iter = 0;
  while (cursor < end && iter++ < maxIter) {
    const day = cursor.getDay();
    const dateStr = cursor.toISOString().slice(0, 10);
    const isWorkDay = workingDays.has(day) && !holidaySet.has(dateStr);

    if (daysStr === "24/7") {
      // 24/7 mode — all hours count, skip holidays only
      if (holidaySet.has(dateStr)) {
        cursor.setDate(cursor.getDate() + 1); cursor.setHours(0, 0, 0, 0);
      } else {
        const endOfDay = new Date(cursor); endOfDay.setDate(endOfDay.getDate() + 1); endOfDay.setHours(0, 0, 0, 0);
        const chunkEnd = endOfDay < end ? endOfDay : end;
        elapsed += (chunkEnd - cursor) / 3600000;
        cursor = new Date(chunkEnd);
      }
    } else if (isWorkDay) {
      const hrs = cursor.getHours() + cursor.getMinutes() / 60;
      if (hrs >= BH_START && hrs < BH_END) {
        const endOfBH = new Date(cursor); endOfBH.setHours(BH_END, 0, 0, 0);
        const chunkEnd = endOfBH < end ? endOfBH : end;
        elapsed += (chunkEnd - cursor) / 3600000;
        cursor = new Date(chunkEnd);
      } else if (hrs < BH_START) {
        cursor.setHours(BH_START, 0, 0, 0);
      } else {
        cursor.setDate(cursor.getDate() + 1); cursor.setHours(BH_START, 0, 0, 0);
      }
    } else {
      cursor.setDate(cursor.getDate() + 1); cursor.setHours(BH_START, 0, 0, 0);
    }
    if (cursor >= end) break;
  }
  return Math.round(elapsed * 100) / 100;
}

// ─── Compute SLA status for a single incident ──────────────────────────
function computeSlaStatus(incident, policy) {
  const sev = policy.severities[incident.priority] || policy.severities["Sev-C"];
  const createdAt = incident.createdAt || incident.created_at || incident.created;
  const now = new Date();

  // If created is already a number (hours elapsed, from seed data), use it directly
  let hoursElapsed;
  if (typeof createdAt === "number") {
    hoursElapsed = createdAt;
  } else {
    const bhOptions = policy.supportHours ? { start: policy.supportHours.start, end: policy.supportHours.end, days: policy.supportHours.days, holidays: policy.holidays || [] } : {};
    hoursElapsed = getBusinessHoursElapsed(createdAt, now, bhOptions);
  }

  const firstResponseTarget = sev.firstResponse;
  const worstResponseTarget = sev.worstResponse;

  const firstResponsePct = Math.min((hoursElapsed / firstResponseTarget) * 100, 999);
  const resolutionPct = Math.min((hoursElapsed / worstResponseTarget) * 100, 999);

  // Determine breach status
  let status = "on_track"; // green
  if (resolutionPct >= 100) status = "breached";
  else if (resolutionPct >= 90) status = "critical";
  else if (resolutionPct >= 80) status = "at_risk";

  return {
    incidentId: incident.id,
    priority: incident.priority,
    hoursElapsed,
    firstResponseTarget,
    worstResponseTarget,
    firstResponsePct: Math.round(firstResponsePct * 10) / 10,
    resolutionPct: Math.round(resolutionPct * 10) / 10,
    status,
    remainingHours: Math.max(0, Math.round((worstResponseTarget - hoursElapsed) * 100) / 100),
    breached: resolutionPct >= 100,
    computedAt: now.toISOString(),
  };
}

// ─── SLA Engine Class ───────────────────────────────────────────────────
class SlaEngine {
  constructor(db, options = {}) {
    this.db = db;
    this.interval = options.interval || 5 * 60 * 1000; // 5 minutes default
    this.timer = null;
    this.policy = { ...DEFAULT_SLA_POLICY, ...(options.policy || {}) };
    this.lastRun = null;
    this.stats = { totalChecked: 0, atRisk: 0, breached: 0, escalated: 0 };
    this.onBreach = options.onBreach || null; // callback(escalation) for notification
    this._notifiedBreaches = new Set(); // dedup: track incident IDs already notified this session
  }

  async start() {
    console.log(`[SLA Engine] Started — checking every ${this.interval / 60000} minutes`);
    // Load custom policy from DB if saved
    await this.loadPolicy();
    // Run immediately, then on interval
    await this.runCycle();
    this.timer = setInterval(() => this.runCycle(), this.interval);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    console.log("[SLA Engine] Stopped");
  }

  async loadPolicy() {
    try {
      const row = await this.db.getOne("sla_config", "active_policy");
      if (row) {
        const saved = JSON.parse(row.data);
        if (saved.severities) {
          this.policy.severities = { ...this.policy.severities, ...saved.severities };
        }
        if (saved.supportHours) {
          this.policy.supportHours = { ...this.policy.supportHours, ...saved.supportHours };
        }
        if (saved.holidays) {
          this.policy.holidays = saved.holidays;
        }
      }
    } catch (err) {
      console.warn("[SLA Engine] Could not load policy:", err.message);
    }
    this.currentPolicy = this.policy;
  }

  getSlaMap() {
    const p = this.currentPolicy || this.policy;
    return Object.fromEntries(Object.entries(p.severities).map(([k, v]) => [k, v.worstResponse]));
  }

  async runCycle() {
    try {
      const now = new Date();
      this.lastRun = now.toISOString();

      // Get open incidents (use optimized query if available)
      const incidentRows = this.db.getOpen ? await this.db.getOpen("incidents") : await this.db.getAll("incidents");
      const incidents = incidentRows.map(r => {
        try { return JSON.parse(r.data); } catch { return null; }
      }).filter(Boolean);

      const openStatuses = new Set(["Open", "In Progress", "Pending", "Assigned", "open", "in_progress", "pending", "assigned", "new"]);
      const openIncidents = incidents.filter(i => openStatuses.has(i.status));

      let atRisk = 0, breached = 0, escalated = 0;
      const escalations = [];

      for (const inc of openIncidents) {
        const sla = computeSlaStatus(inc, this.policy);

        // Track SLA state in a separate collection
        await this.db.upsert("sla_tracking", inc.id, JSON.stringify({
          ...sla,
          title: inc.title,
          assignee: inc.assignee,
          assignmentGroup: inc.assignmentGroup,
          category: inc.category,
          customer: inc.customer,
        }));

        if (sla.status === "at_risk") atRisk++;
        if (sla.status === "critical") { atRisk++; }
        if (sla.breached) {
          breached++;
          // Auto-escalate on breach — deduplicate to avoid notification flood
          if (!this._notifiedBreaches.has(inc.id)) {
            this._notifiedBreaches.add(inc.id);
            escalations.push({
              id: `ESC-${inc.id}-${Date.now()}`,
              incidentId: inc.id,
              title: inc.title,
              priority: inc.priority,
              assignee: inc.assignee,
              reason: `SLA breached — ${sla.hoursElapsed}h elapsed vs ${sla.worstResponseTarget}h target`,
              type: "sla_breach",
              timestamp: now.toISOString(),
            });
            escalated++;
          }
        }
      }

      // Store escalations
      for (const esc of escalations) {
        await this.db.upsert("escalation_log", esc.id, JSON.stringify(esc));
        await this.db.audit("escalation_log", esc.id, "auto_escalate", JSON.stringify(esc), "sla_engine");
        if (this.onBreach) {
          try { await this.onBreach(esc); } catch (e) { console.warn("[SLA Engine] onBreach callback failed:", e.message); }
        }
      }

      this.stats = { totalChecked: openIncidents.length, atRisk, breached, escalated, lastRun: this.lastRun };

      if (atRisk > 0 || breached > 0) {
        console.log(`[SLA Engine] Checked ${openIncidents.length} incidents — ${atRisk} at-risk, ${breached} breached, ${escalated} escalated`);
      }
    } catch (err) {
      console.error("[SLA Engine] Cycle failed:", err.message);
    }
  }

  getStats() {
    return { ...this.stats, policy: this.policy };
  }
}

module.exports = { SlaEngine, computeSlaStatus, getBusinessHoursElapsed, DEFAULT_SLA_POLICY };
