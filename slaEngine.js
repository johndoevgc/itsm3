// ─── Server-Side SLA Engine ─────────────────────────────────────────────
// Computes SLA compliance, tracks breaches, and auto-escalates.
// Runs as a periodic timer on the server.

// Optional integrations (loaded lazily — slaEngine is also imported by tests)
let _featureFlags = null, _shadow = null;
try { _featureFlags = require("./featureFlags"); } catch {}
try { _shadow = require("./shadowMode"); } catch {}

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
  const slaPauseHistory = options.slaPauseHistory || [];

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

  const calcBH = (from, to) => {
    let elapsed = 0;
    let cursor = new Date(from);
    const maxIter = 366 * 24;
    let iter = 0;
    while (cursor < to && iter++ < maxIter) {
      const day = cursor.getDay();
      const dateStr = cursor.toISOString().slice(0, 10);
      const isWorkDay = workingDays.has(day) && !holidaySet.has(dateStr);

      if (daysStr === "24/7") {
        if (holidaySet.has(dateStr)) {
          cursor.setDate(cursor.getDate() + 1); cursor.setHours(0, 0, 0, 0);
        } else {
          const endOfDay = new Date(cursor); endOfDay.setDate(endOfDay.getDate() + 1); endOfDay.setHours(0, 0, 0, 0);
          const chunkEnd = endOfDay < to ? endOfDay : to;
          elapsed += (chunkEnd - cursor) / 3600000;
          cursor = new Date(chunkEnd);
        }
      } else if (isWorkDay) {
        const hrs = cursor.getHours() + cursor.getMinutes() / 60;
        if (hrs >= BH_START && hrs < BH_END) {
          const endOfBH = new Date(cursor); endOfBH.setHours(BH_END, 0, 0, 0);
          const chunkEnd = endOfBH < to ? endOfBH : to;
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
      if (cursor >= to) break;
    }
    return elapsed;
  };

  let elapsed = calcBH(start, end);

  // Subtract paused business hours
  if (Array.isArray(slaPauseHistory) && slaPauseHistory.length > 0) {
    for (const pause of slaPauseHistory) {
      if (!pause.pausedAt) continue;
      const pStart = new Date(pause.pausedAt);
      const pEnd = pause.resumedAt ? new Date(pause.resumedAt) : end;
      if (pStart < end && pEnd > start) {
        const effStart = pStart < start ? start : pStart;
        const effEnd = pEnd > end ? end : pEnd;
        elapsed -= calcBH(effStart, effEnd);
      }
    }
  }

  return Math.max(0, Math.round(elapsed * 100) / 100);
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
    const bhOptions = policy.supportHours ? { start: policy.supportHours.start, end: policy.supportHours.end, days: policy.supportHours.days, holidays: policy.holidays || [], slaPauseHistory: incident.slaPauseHistory || [] } : { slaPauseHistory: incident.slaPauseHistory || [] };
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

// ─── Phase D1: Candidate v2 — status driven by WORST of response/resolution ──
// v1 only watches resolutionPct; v2 also escalates when firstResponsePct breaches
// before responder acknowledges. If incident has firstAckAt set, firstResponsePct
// is excluded (already met). Output shape matches v1 for clean diffing.
function computeSlaStatus_v2(incident, policy) {
  const base = computeSlaStatus(incident, policy);
  const acked = !!(incident.firstAckAt || incident.firstResponseAt || incident.acknowledgedAt);
  const worstPct = acked ? base.resolutionPct : Math.max(base.resolutionPct, base.firstResponsePct);
  let status = "on_track";
  if (worstPct >= 100) status = "breached";
  else if (worstPct >= 90) status = "critical";
  else if (worstPct >= 80) status = "at_risk";
  return {
    ...base,
    status,
    breached: worstPct >= 100,
    worstPct: Math.round(worstPct * 10) / 10,
    ackConsidered: !acked,
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
    this.stats = { totalChecked: 0, atRisk: 0, breached: 0, escalated: 0, cyclesSkipped: 0, lastCycleMs: 0 };
    this.onBreach = options.onBreach || null; // callback(escalation) for notification
    this._notifiedBreaches = new Set(); // dedup: track incident IDs already notified this session
    this._lastDataHash = null; // change-detection
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
    const cycleStart = Date.now();
    try {
      const now = new Date();
      this.lastRun = now.toISOString();

      // Change-detection: skip if no incidents modified since last cycle
      if (this.db.getMaxUpdatedAt) {
        try {
          const maxUpd = await this.db.getMaxUpdatedAt("incidents");
          const hash = String(maxUpd);
          if (hash === this._lastDataHash) {
            this.stats.cyclesSkipped++;
            return; // no changes
          }
          this._lastDataHash = hash;
        } catch {}
      }

      // Get open incidents (use optimized query if available)
      const incidentRows = this.db.getOpen ? await this.db.getOpen("incidents") : await this.db.getAll("incidents");
      const incidents = incidentRows.map(r => {
        try { return JSON.parse(r.data); } catch { return null; }
      }).filter(Boolean);

      const openStatuses = new Set(["Open", "In Progress", "Pending", "Assigned", "open", "in_progress", "pending", "assigned", "new"]);
      const openIncidents = incidents.filter(i => openStatuses.has(i.status));

      // Clean up _notifiedBreaches for incidents that are no longer open
      const openIds = new Set(openIncidents.map(i => i.id));
      for (const notifiedId of this._notifiedBreaches) {
        if (!openIds.has(notifiedId)) this._notifiedBreaches.delete(notifiedId);
      }

      let atRisk = 0, breached = 0, escalated = 0;
      const escalations = [];
      const slaUpdates = []; // batch SLA tracking upserts

      for (const inc of openIncidents) {
        // Phase 2 shadow mode: when `shadow_sla_v2` flag is on, run a
        // candidate computeSlaStatus_v2 alongside and log diffs. The
        // control implementation's value is always what we use.
        const shadowOn = _featureFlags && _shadow && _featureFlags.isEnabled("shadow_sla_v2");
        let sla;
        if (shadowOn) {
          sla = await _shadow.run({
            name:      "shadow_sla_v2",
            enabled:   true,
            control:   () => computeSlaStatus(inc, this.policy),
            candidate: () => computeSlaStatus_v2(inc, this.policy),
            keys:      ["status", "breached", "hoursElapsed", "firstResponseTarget", "worstResponseTarget"],
            onDiff:    async (d) => {
              try {
                await this.db.upsert("shadow_diffs", `sla_${inc.id}_${Date.now()}`, JSON.stringify({
                  flag: "shadow_sla_v2", incidentId: inc.id, ...d, at: new Date().toISOString(),
                }));
              } catch { /* non-fatal */ }
            },
          });
        } else {
          sla = computeSlaStatus(inc, this.policy);
        }

        // Collect SLA tracking update (batch later)
        slaUpdates.push({ id: inc.id, data: {
          ...sla,
          title: inc.title,
          assignee: inc.assignee,
          assignmentGroup: inc.assignmentGroup,
          category: inc.category,
          customer: inc.customer,
        }});

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

      // Batch write all SLA tracking records
      if (this.db.bulkUpsert && slaUpdates.length > 0) {
        try {
          const items = slaUpdates.map(u => ({ ...u.data, id: u.id }));
          await this.db.bulkUpsert("sla_tracking", items);
        } catch {
          // Fallback to individual upserts
          for (const u of slaUpdates) {
            await this.db.upsert("sla_tracking", u.id, JSON.stringify(u.data));
          }
        }
      } else {
        for (const u of slaUpdates) {
          await this.db.upsert("sla_tracking", u.id, JSON.stringify(u.data));
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

      this.stats = { totalChecked: openIncidents.length, atRisk, breached, escalated, cyclesSkipped: this.stats.cyclesSkipped, lastRun: this.lastRun };

      if (atRisk > 0 || breached > 0) {
        console.log(`[SLA Engine] Checked ${openIncidents.length} incidents — ${atRisk} at-risk, ${breached} breached, ${escalated} escalated`);
      }
    } catch (err) {
      console.error("[SLA Engine] Cycle failed:", err.message);
    }
    this.stats.lastCycleMs = Date.now() - cycleStart;
    if (this.stats.lastCycleMs > 10000) {
      console.warn(`[SLA Engine] Slow cycle: ${this.stats.lastCycleMs}ms`);
    }
  }

  getStats() {
    return { ...this.stats, policy: this.policy };
  }
}

module.exports = { SlaEngine, computeSlaStatus, computeSlaStatus_v2, getBusinessHoursElapsed, DEFAULT_SLA_POLICY };
