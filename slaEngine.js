// ─── Server-Side SLA Engine ─────────────────────────────────────────────
// Computes SLA compliance, tracks breaches, and auto-escalates.
// Runs as a periodic timer on the server.

// Optional integrations (loaded lazily — slaEngine is also imported by tests)
let _featureFlags = null, _shadow = null;
try { _featureFlags = require("./featureFlags"); } catch { /* ignore */ }
try { _shadow = require("./shadowMode"); } catch { /* ignore */ }

const { normalizePriority } = require("./src/utils/priorityNormalize.cjs");

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
  // Normalize priority so legacy P1..P4 / Critical / High / etc. map onto
  // canonical Sev-A..Sev-D before policy lookup. Avoids silent Sev-C fallback
  // when a record was created via the email or self-service path with a P-code.
  const canonicalPriority = normalizePriority(incident.priority);
  const sev = policy.severities[canonicalPriority] || policy.severities["Sev-C"];
  const createdAt = incident.createdAt || incident.created_at || incident.created;
  const now = new Date();

  // If created is already a number (hours elapsed, from seed data), use it directly
  let hoursElapsed;
  let elapsedSource = "wall_clock";
  if (typeof createdAt === "number") {
    hoursElapsed = createdAt;
  } else {
    // v3.23.1 (corrected v3.23.2): Prefer Zendesk's authoritative full_resolution_time
    // (business minutes) when the incident is RESOLVED. For active tickets we keep using
    // local BH calc — Zendesk's `agent_wait_time` only counts Pending duration, not total
    // active elapsed, so it would dramatically under-report SLA usage on Open tickets.
    const zm = incident.zdMetrics || null;
    const isResolved = !!incident.resolvedAt || ["resolved", "closed"].includes(String(incident.status || "").toLowerCase());
    if (zm && isResolved && Number.isFinite(zm.fullResolutionBizMin) && zm.fullResolutionBizMin >= 0) {
      hoursElapsed = Math.round((zm.fullResolutionBizMin / 60) * 100) / 100;
      elapsedSource = "zendesk_full_resolution";
    } else {
      const bhOptions = policy.supportHours ? { start: policy.supportHours.start, end: policy.supportHours.end, days: policy.supportHours.days, holidays: policy.holidays || [], slaPauseHistory: incident.slaPauseHistory || [] } : { slaPauseHistory: incident.slaPauseHistory || [] };
      hoursElapsed = getBusinessHoursElapsed(createdAt, now, bhOptions);
    }
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
    priority: canonicalPriority,
    rawPriority: incident.priority,
    hoursElapsed,
    firstResponseTarget,
    worstResponseTarget,
    firstResponsePct: Math.round(firstResponsePct * 10) / 10,
    resolutionPct: Math.round(resolutionPct * 10) / 10,
    status,
    remainingHours: Math.max(0, Math.round((worstResponseTarget - hoursElapsed) * 100) / 100),
    breached: resolutionPct >= 100,
    elapsedSource,
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
    this._notifiedBreaches = new Set(); // dedup: track incident IDs already notified — restored from DB on start()
    this._lastDataHash = null; // change-detection
    // v3.24: by default use computeSlaStatus_v2 (worst-of response/resolution).
    // Set feature flag `sla_v1_legacy` to roll back. Read once per cycle.
    this._useV1 = false;
  }

  async start() {
    console.log(`[SLA Engine] Started — checking every ${this.interval / 60000} minutes`);
    // Load custom policy from DB if saved
    await this.loadPolicy();
    // v3.24 Phase A1: restore breach-notification dedup so a process restart
    // doesn't re-fire alerts for incidents already notified within the last 7 days.
    await this._restoreNotifiedBreaches();
    // Run immediately, then on interval
    await this.runCycle();
    this.timer = setInterval(() => this.runCycle(), this.interval);
  }

  // v3.24 Phase A1: persisted breach dedup. Stored in `sla_breach_notifications`
  // collection: { id: incidentId, notifiedAt, hoursElapsed }.
  async _restoreNotifiedBreaches() {
    try {
      if (!this.db || !this.db.getAll) return;
      const rows = await this.db.getAll("sla_breach_notifications");
      const cutoffMs = Date.now() - 7 * 86400000;
      let restored = 0;
      for (const r of rows) {
        try {
          const rec = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
          if (!rec || !rec.id) continue;
          const notifiedMs = rec.notifiedAt ? new Date(rec.notifiedAt).getTime() : 0;
          if (notifiedMs >= cutoffMs) {
            this._notifiedBreaches.add(rec.id);
            restored++;
          }
        } catch { /* ignore */ }
      }
      if (restored > 0) console.log(`[SLA Engine] Restored ${restored} breach-dedup entries from DB`);
    } catch (err) {
      console.warn("[SLA Engine] Could not restore breach dedup:", err.message);
    }
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
    // Per-customer SLA tiers: load overrides keyed by customer name
    this._customerPolicies = {};
    try {
      const tiers = await this.db.getAll("sla_customer_tiers");
      for (const r of tiers) {
        try {
          const tier = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
          if (tier && tier.customer) {
            this._customerPolicies[tier.customer] = tier;
          }
        } catch { /* ignore */ }
      }
      if (Object.keys(this._customerPolicies).length > 0) {
        console.log(`[SLA Engine] Loaded ${Object.keys(this._customerPolicies).length} customer SLA tier overrides`);
      }
    } catch { /* ignore */ }
    this.currentPolicy = this.policy;
  }

  // Get effective policy for a specific incident (supports per-customer overrides)
  getPolicyForIncident(incident) {
    const customer = incident.customer || incident.company || incident.organization;
    if (customer && this._customerPolicies && this._customerPolicies[customer]) {
      const override = this._customerPolicies[customer];
      return {
        supportHours: override.supportHours || this.policy.supportHours,
        severities: { ...this.policy.severities, ...(override.severities || {}) },
        holidays: override.holidays || this.policy.holidays || [],
      };
    }
    return this.policy;
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
        } catch { /* ignore */ }
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
        // Use per-customer SLA policy if available
        const incPolicy = this.getPolicyForIncident(inc);

        // v3.24 Phase A2: v2 (worst-of response/resolution) is now DEFAULT.
        // Roll back via feature flag `sla_v1_legacy`. The `shadow_sla_v2` flag is
        // retained for compat but no longer changes behavior since v2 is default.
        const useV1 = _featureFlags && _featureFlags.isEnabled("sla_v1_legacy");
        const sla = useV1
          ? computeSlaStatus(inc, incPolicy)
          : computeSlaStatus_v2(inc, incPolicy);

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
            const esc = {
              id: `ESC-${inc.id}-${Date.now()}`,
              incidentId: inc.id,
              title: inc.title,
              priority: inc.priority,
              assignee: inc.assignee,
              reason: `SLA breached — ${sla.hoursElapsed}h elapsed vs ${sla.worstResponseTarget}h target`,
              type: "sla_breach",
              timestamp: now.toISOString(),
            };
            escalations.push(esc);
            // v3.24 Phase A1: persist dedup record so process restart doesn't re-fire.
            try {
              await this.db.upsert("sla_breach_notifications", inc.id, JSON.stringify({
                id: inc.id, notifiedAt: now.toISOString(), hoursElapsed: sla.hoursElapsed,
                worstResponseTarget: sla.worstResponseTarget, priority: inc.priority,
              }));
            } catch { /* non-fatal */ }
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

  // Daily SLA snapshot — called by server cron or compliance cycle
  async saveDailySnapshot() {
    try {
      const now = new Date();
      const dateKey = now.toISOString().slice(0, 10);
      const snapshotId = `sla_snap_${dateKey}`;

      // Check if already saved today
      try {
        const existing = await this.db.getOne("sla_history", snapshotId);
        if (existing) return; // already logged today
      } catch { /* ignore */ }

      const incRows = await this.db.getAll("incidents");
      const incidents = incRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);

      const resolved = incidents.filter(i => ["Resolved", "Closed"].includes(i.status));
      const open = incidents.filter(i => !["Resolved", "Closed"].includes(i.status));
      const slaMet = resolved.filter(i => i.slaStatus === "met" || i.slaStatus === "within").length;
      const slaBreached = resolved.filter(i => i.slaStatus === "breached").length;

      // Current open SLA statuses
      let openAtRisk = 0, openBreached = 0;
      for (const inc of open) {
        const policy = this.getPolicyForIncident(inc);
        const useV1 = _featureFlags && _featureFlags.isEnabled("sla_v1_legacy");
        const sla = useV1 ? computeSlaStatus(inc, policy) : computeSlaStatus_v2(inc, policy);
        if (sla.status === "at_risk" || sla.status === "critical") openAtRisk++;
        if (sla.breached) openBreached++;
      }

      const snapshot = {
        id: snapshotId,
        date: dateKey,
        totalIncidents: incidents.length,
        totalResolved: resolved.length,
        totalOpen: open.length,
        slaMet,
        slaBreached,
        complianceRate: resolved.length > 0 ? Math.round((slaMet / resolved.length) * 10000) / 100 : 100,
        openAtRisk,
        openBreached,
        timestamp: now.toISOString(),
      };

      await this.db.upsert("sla_history", snapshotId, JSON.stringify(snapshot));
      console.log(`[SLA Engine] Daily snapshot saved: ${dateKey} (compliance=${snapshot.complianceRate}%)`);
    } catch (e) {
      console.warn("[SLA Engine] Daily snapshot failed:", e.message);
    }
  }
}

module.exports = { SlaEngine, computeSlaStatus, computeSlaStatus_v2, getBusinessHoursElapsed, DEFAULT_SLA_POLICY, normalizePriority };
