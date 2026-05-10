// ─── Workflow Automation Engine ──────────────────────────────────────────
// Evaluates workflow rules against real-time events and executes actions.
// Runs server-side with periodic rule evaluation + event-driven triggers.

const { computeSlaStatus_v2 } = require("./slaEngine.js");

class WorkflowEngine {
  constructor(db, options = {}) {
    this.db = db;
    this.notifyEngine = options.notifyEngine || null;
    this.wsServer = options.wsServer || null;
    this.graphSendMail = options.graphSendMail || null;
    this.interval = options.interval || 5 * 60 * 1000; // 5 min default
    this.timer = null;
    this.lastRun = null;
    this._lastDataHash = null; // change-detection: skip cycle if no data changed
    this._cachedRules = null;
    this._cachedRulesExpiry = 0;
    this._cycleTimeMs = 0; // last cycle duration
    this.stats = {
      rulesEvaluated: 0,
      actionsExecuted: 0,
      autoClosedTickets: 0,
      autoEscalated: 0,
      errors: 0,
      cyclesSkipped: 0,
    };
    this.executionLog = []; // last 200 entries
  }

  // ─── Start periodic evaluation ────────────────────────────────────────
  async start() {
    console.log("[WorkflowEngine] Starting with interval", this.interval / 1000, "s");
    await this.runCycle();
    this.timer = setInterval(() => this.runCycle(), this.interval);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    console.log("[WorkflowEngine] Stopped");
  }

  // ─── Main evaluation cycle ────────────────────────────────────────────
  async runCycle() {
    const cycleStart = Date.now();
    try {
      this.lastRun = new Date().toISOString();

      // Change-detection: skip if no incidents modified since last cycle
      if (this.db.getMaxUpdatedAt) {
        try {
          const maxUpd = await this.db.getMaxUpdatedAt("incidents");
          const hash = String(maxUpd);
          if (hash === this._lastDataHash) {
            this.stats.cyclesSkipped++;
            return; // no changes — skip entire cycle
          }
          this._lastDataHash = hash;
        } catch { /* ignore */ }
      }

      // Load ALL open incidents ONCE for the entire cycle
      const incidentRows = this.db.getOpen ? await this.db.getOpen("incidents") : await this.db.getAll("incidents");
      this._cycleIncidents = incidentRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(i => i && !i._deleted);

      const rules = await this._loadRules();
      const activeRules = rules.filter(r => r.status === "Active" && !r._deleted);

      for (const rule of activeRules) {
        this.stats.rulesEvaluated++;
        try {
          await this._evaluateRule(rule);
        } catch (err) {
          this.stats.errors++;
          this._log("error", rule.id, `Rule evaluation failed: ${err.message}`);
        }
      }

      // ─── Phase H4 — Shadow workflow harness (diff-only) ─────────────
      try {
        const _shadowWf = require("./shadowWorkflow");
        const _ff = require("./featureFlags");
        await _shadowWf.runShadow({ db: this.db, featureFlags: _ff, incidents: this._cycleIncidents });
      } catch { /* shadow is non-fatal */ }

      // ─── AI Auto-Resolve for idle incidents (Production Pipeline) ─────
      await this._triggerAutoResolveForIdle();

      // ─── Daily Summary Email (6 PM SGT / 10:00 UTC) ──────────────────
      try {
        const nowSGT = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
        const hour = nowSGT.getHours();
        const todayKey = nowSGT.toISOString().slice(0, 10);
        if (hour >= 18 && (!this.lastDailySummary || !this.lastDailySummary.startsWith(todayKey))) {
          await this.sendDailySummary();
        }
      } catch (dsErr) {
        this._log("error", "DAILY_SUMMARY", `Schedule check failed: ${dsErr.message}`);
      }

      // ─── Phase J1 — Daily compliance evidence snapshot (00:05 SGT) ───
      try {
        const nowSGT = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
        const hour = nowSGT.getHours();
        const todayKey = nowSGT.toISOString().slice(0, 10);
        if (hour >= 0 && (!this.lastEvidenceDay || this.lastEvidenceDay !== todayKey)) {
          await this._captureComplianceEvidence(todayKey);
          this.lastEvidenceDay = todayKey;
        }
      } catch (evErr) {
        this._log("error", "COMPLIANCE_EVIDENCE", `Snapshot failed: ${evErr.message}`);
      }

      // ─── Email-to-Ticket: poll inbound emails ────────────────────────
      if (this._processInboundEmails) {
        try {
          const result = await this._processInboundEmails();
          if (result.processed > 0) {
            this._log("action", "EMAIL_TO_TICKET", `Processed ${result.processed} inbound emails → ${result.incidents.join(", ")}`);
          }
        } catch (inErr) {
          this._log("error", "EMAIL_TO_TICKET", `Inbox scan failed: ${inErr.message}`);
        }
      }

      // ─── Phase 10.1: Run scheduled tasks ──────────────────────────────
      await this.runScheduledTasks();

      // ─── Phase 10.2: Multi-tier escalation chain ─────────────────────
      await this._runEscalationChain();

      // ─── Phase 10.3: Skill-based auto-assignment ─────────────────────
      await this._autoAssignBySkill();

      // ─── v3.35.0 Phase C: auto-apply reassign for Sev-A/B unassigned (flag-gated, shadow-first) ───
      await this._autoApplyReassignSuggestions();

      // ─── Phase 10.4: Change approval pipeline ────────────────────────
      await this._processChangeApprovals();

      // ─── ITIL4: Check overdue PIR action items ────────────────────────
      await this._checkPirDueActions();

      // ─── ITIL4: CSAT survey trigger on resolved incidents ─────────────
      await this._triggerCsatSurveys();

      // Clean up cycle-scoped data
      this._cycleIncidents = null;
    } catch (err) {
      this.stats.errors++;
      console.error("[WorkflowEngine] Cycle error:", err.message);
    }
    this._cycleTimeMs = Date.now() - cycleStart;
    if (this._cycleTimeMs > 10000) {
      console.warn(`[WorkflowEngine] Slow cycle: ${this._cycleTimeMs}ms`);
    }
  }

  // ─── Auto-resolve idle incidents via AI ───────────────────────────────
  async _triggerAutoResolveForIdle() {
    try {
      const http = require("http");
      const incidents = this._cycleIncidents || [];
      const now = Date.now();
      const IDLE_THRESHOLD = 2 * 60 * 60 * 1000; // 2 hours idle

      for (const inc of incidents) {
        try {
          const status = (inc.status || "").toLowerCase();
          if (["closed", "resolved"].includes(status)) continue;
          if (inc._autoResolveAttempted) continue;
          const lastActivity = inc.updatedAt || inc.lastModified || inc.createdAt;
          if (!lastActivity) continue;
          const idle = now - new Date(lastActivity).getTime();
          if (idle < IDLE_THRESHOLD) continue;

          // Mark so we don't re-trigger
          inc._autoResolveAttempted = new Date().toISOString();
          await this.db.upsert("incidents", inc.id, JSON.stringify(inc));

          // Fire auto-resolve via internal HTTP
          const payload = JSON.stringify({ requestedBy: "WorkflowEngine Auto-Resolve", maxItems: 1, incidentId: inc.id });
          const port = process.env.PORT || 8080;
          const req = http.request({ hostname: "127.0.0.1", port, path: "/api/ai/auto-resolve", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), "x-internal-scheduler-token": process.env.INTERNAL_SCHEDULER_TOKEN } }, (res) => {
            let d = ""; res.on("data", c => d += c);
            res.on("end", () => { console.log(`[WorkflowEngine] Auto-resolve for ${inc.id}: ${d.substring(0, 200)}`); });
          });
          req.on("error", e => console.warn(`[WorkflowEngine] Auto-resolve failed for ${inc.id}:`, e.message));
          req.setTimeout(35000, () => { req.destroy(); });
          req.write(payload);
          req.end();

          this._log("action", "AUTO_RESOLVE", `Triggered auto-resolve for idle incident ${inc.id} (idle ${Math.round(idle / 3600000)}h)`);
        } catch { /* ignore */ }
      }
    } catch (err) {
      console.warn("[WorkflowEngine] Auto-resolve scan error:", err.message);
    }
  }

  // ─── Event-driven trigger (called from server.js on DB writes) ────────
  async onEvent(eventType, collection, data) {
    try {
      const rules = await this._loadRules();
      const active = rules.filter(r => r.status === "Active" && !r._deleted);

      for (const rule of active) {
        if (this._matchesEvent(rule, eventType, collection, data)) {
          await this._executeAction(rule, data);
        }
      }
    } catch (err) {
      this.stats.errors++;
      console.error("[WorkflowEngine] Event processing error:", err.message);
    }
  }

  // ─── Load rules from DB (cached 5min) ──────────────────────────────────
  async _loadRules() {
    try {
      const now = Date.now();
      if (this._cachedRules && now < this._cachedRulesExpiry) return this._cachedRules;
      const rows = await this.db.getAll("workflow_rules");
      this._cachedRules = rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      this._cachedRulesExpiry = now + 5 * 60 * 1000; // 5min cache
      return this._cachedRules;
    } catch { return this._cachedRules || []; }
  }

  // ─── Evaluate time-based rules ────────────────────────────────────────
  async _evaluateRule(rule) {
    const ruleId = rule.id;

    // Auto-Close Resolved tickets after 72h
    if (ruleId === "WF004" || (rule.name || "").toLowerCase().includes("auto-close")) {
      await this._autoCloseResolved(rule);
      return;
    }

    // Critical Incident Auto-Escalate (no response in 15 min)
    if (ruleId === "WF001" || (rule.name || "").toLowerCase().includes("auto-escalat")) {
      await this._autoEscalateCritical(rule);
      return;
    }

    // SLA Breach Alert (>75% usage)
    if (ruleId === "WF003" || (rule.name || "").toLowerCase().includes("sla breach")) {
      await this._slaBreachAlert(rule);
      return;
    }
  }

  // ─── Auto-close resolved tickets after 72 hours ──────────────────────
  async _autoCloseResolved(rule) {
    try {
      // Also load resolved incidents (not in _cycleIncidents which is open-only)
      const rows = this.db.getByField ? await this.db.getByField("incidents", "status", "Resolved") : await this.db.getAll("incidents");
      const now = Date.now();
      const THRESHOLD = 72 * 60 * 60 * 1000; // 72 hours

      for (const row of rows) {
        try {
          const inc = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          if (inc._deleted) continue;
          if ((inc.status || "").toLowerCase() !== "resolved") continue;
          const resolvedAt = inc.resolvedAt || inc.updatedAt || inc.lastModified;
          if (!resolvedAt) continue;
          const elapsed = now - new Date(resolvedAt).getTime();
          if (elapsed < THRESHOLD) continue;

          // Auto-close
          inc.status = "Closed";
          inc.closedAt = new Date().toISOString();
          inc.closedBy = "Workflow Engine (WF004)";
          inc.lastModified = new Date().toISOString();
          await this.db.upsert("incidents", inc.id, JSON.stringify(inc));
          this.stats.autoClosedTickets++;
          this._log("action", rule.id, `Auto-closed ${inc.id} (resolved ${Math.round(elapsed / 3600000)}h ago)`);

          // Broadcast
          if (this.wsServer) this.wsServer.broadcast("incidents", { action: "auto_close", id: inc.id, rule: rule.id });

          // Send survey notification
          if (this.notifyEngine && inc.requesterEmail) {
            await this.notifyEngine.send({
              channels: ["inapp"],
              title: `Ticket ${inc.id} auto-closed`,
              body: `Your ticket "${inc.title || inc.id}" has been automatically closed after 72 hours in resolved status.`,
              severity: "info",
              type: "auto_close",
              incidentId: inc.id,
            }).catch(() => {});
          }
        } catch { /* ignore */ }
      }
    } catch (err) {
      this._log("error", rule.id, `Auto-close scan failed: ${err.message}`);
    }
  }

  // ─── Auto-escalate critical incidents without response ────────────────
  async _autoEscalateCritical(rule) {
    try {
      const incidents = this._cycleIncidents || [];
      const now = Date.now();
      const THRESHOLD = 15 * 60 * 1000; // 15 minutes

      for (const inc of incidents) {
        try {
          const status = (inc.status || "").toLowerCase();
          if (status === "closed" || status === "resolved") continue;
          if (inc.priority !== "Sev-A") continue;
          if (inc._escalatedByWF) continue; // already escalated

          const created = inc.createdAt || inc.created_at;
          if (!created) continue;
          const createdTime = new Date(created).getTime();
          if (isNaN(createdTime)) continue;
          const elapsed = now - createdTime;
          if (elapsed < THRESHOLD) continue;
          if (inc.firstResponseAt) continue; // has response

          // Escalate
          inc._escalatedByWF = true;
          inc.escalationLevel = Math.max((inc.escalationLevel || 0) + 1, 2);
          inc.lastModified = new Date().toISOString();
          await this.db.upsert("incidents", inc.id, JSON.stringify(inc));
          this.stats.autoEscalated++;
          this._log("action", rule.id, `Auto-escalated ${inc.id} to level ${inc.escalationLevel}`);

          // Log escalation
          const escEntry = {
            id: `ESC-WF-${Date.now()}`,
            incidentId: inc.id,
            level: inc.escalationLevel,
            reason: "No response within 15 minutes (Critical incident)",
            triggeredBy: "WorkflowEngine",
            ruleId: rule.id,
            timestamp: new Date().toISOString(),
          };
          await this.db.upsert("escalation_log", escEntry.id, JSON.stringify(escEntry));

          // Notify
          if (this.wsServer) this.wsServer.broadcast("escalations", { action: "auto_escalate", ...escEntry });
          if (this.notifyEngine) {
            await this.notifyEngine.send({
              channels: ["inapp", "email"],
              title: `Critical Escalation: ${inc.title || inc.id}`,
              body: `Sev-A incident ${inc.id} has been auto-escalated — no response in ${Math.round(elapsed / 60000)} minutes.`,
              severity: "critical",
              type: "escalation",
              incidentId: inc.id,
            }).catch(() => {});
          }
        } catch { /* ignore */ }
      }
    } catch (err) {
      this._log("error", rule.id, `Auto-escalation scan failed: ${err.message}`);
    }
  }

  // ─── SLA breach warning alerts (>75% usage) ──────────────────────────
  async _slaBreachAlert(rule) {
    try {
      const rows = await this.db.getAll("sla_tracking");
      const now = new Date().toISOString();

      for (const row of rows) {
        try {
          const sla = JSON.parse(row.data);
          if (sla._deleted) continue;
          if (sla.status === "breached" || sla.status === "closed") continue;
          const pct = sla.resolutionPct || 0;
          if (pct < 75 || pct >= 100) continue;
          if (sla._wfAlertSent && (Date.now() - new Date(sla._wfAlertSent).getTime()) < 30 * 60 * 1000) continue; // throttle 30min

          sla._wfAlertSent = now;
          await this.db.upsert("sla_tracking", sla.id || row.id, JSON.stringify(sla));

          this._log("action", rule.id, `SLA warning for ${sla.incidentId || row.id} at ${Math.round(pct)}%`);

          if (this.notifyEngine) {
            await this.notifyEngine.send({
              channels: ["inapp"],
              title: `SLA Warning: ${sla.incidentId || row.id}`,
              body: `SLA usage at ${Math.round(pct)}% — action required to avoid breach.`,
              severity: "warning",
              type: "sla_warning",
              incidentId: sla.incidentId,
            }).catch(() => {});
          }
        } catch { /* ignore */ }
      }
    } catch (err) {
      this._log("error", rule.id, `SLA breach alert scan failed: ${err.message}`);
    }
  }

  // ─── Check if a rule matches an incoming event ────────────────────────
  _matchesEvent(rule, eventType, collection, data) {
    // Auto-approve standard changes
    if ((rule.id === "WF002" || (rule.name || "").toLowerCase().includes("auto-approve")) &&
        collection === "changes" && (eventType === "upsert" || eventType === "update")) {
      const changeType = (data.type || data.changeType || "").toLowerCase();
      const risk = (data.riskLevel || data.risk || "").toLowerCase();
      return changeType === "standard" && risk === "low";
    }

    // VIP user fast-track
    if ((rule.id === "WF005" || (rule.name || "").toLowerCase().includes("vip")) &&
        (collection === "incidents" || collection === "requests") && eventType === "upsert") {
      const role = (data.reporterRole || data.userRole || "").toLowerCase();
      return role.includes("vip") || role.includes("executive") || role.includes("director");
    }

    // Duplicate detection (on new incident)
    if ((rule.id === "WF007" || (rule.name || "").toLowerCase().includes("duplicate")) &&
        collection === "incidents" && eventType === "upsert") {
      return true; // always check for duplicates on new incidents
    }

    return false;
  }

  // ─── Execute action for event-matched rule ────────────────────────────
  async _executeAction(rule, data) {
    this.stats.actionsExecuted++;

    // Auto-approve standard changes
    if (rule.id === "WF002" || (rule.name || "").toLowerCase().includes("auto-approve")) {
      data.approvalStatus = "Approved";
      data.approvedBy = "Workflow Engine (WF002)";
      data.approvedAt = new Date().toISOString();
      data.lastModified = new Date().toISOString();
      await this.db.upsert("changes", data.id, JSON.stringify(data));
      this._log("action", rule.id, `Auto-approved standard change ${data.id}`);
      if (this.wsServer) this.wsServer.broadcast("incidents", { action: "auto_approve", id: data.id, rule: rule.id });
      return;
    }

    // VIP fast-track
    if (rule.id === "WF005" || (rule.name || "").toLowerCase().includes("vip")) {
      if (data.priority !== "Sev-A") {
        data.priority = "Sev-B"; // upgrade to high
        data._vipFastTracked = true;
        data.lastModified = new Date().toISOString();
        await this.db.upsert(data._collection || "incidents", data.id, JSON.stringify(data));
        this._log("action", rule.id, `VIP fast-tracked ${data.id} to ${data.priority}`);
      }
      return;
    }

    // Duplicate detection
    if (rule.id === "WF007" || (rule.name || "").toLowerCase().includes("duplicate")) {
      await this._checkDuplicates(rule, data);
      return;
    }
  }

  // ─── Duplicate detection logic ────────────────────────────────────────
  async _checkDuplicates(rule, newIncident) {
    try {
      const incidents = this._cycleIncidents || [];
      const title = (newIncident.title || "").toLowerCase();
      if (!title || title.length < 5) return;

      const words = title.split(/\s+/).filter(w => w.length > 3);
      if (words.length === 0) return;

      for (const existing of incidents) {
        try {
          if (existing.id === newIncident.id) continue;
          const status = (existing.status || "").toLowerCase();
          if (status === "closed" || status === "resolved") continue;

          const existingTitle = (existing.title || "").toLowerCase();
          const matchCount = words.filter(w => existingTitle.includes(w)).length;
          const similarity = matchCount / words.length;

          if (similarity >= 0.6) {
            this._log("action", rule.id, `Potential duplicate: ${newIncident.id} ↔ ${existing.id} (${Math.round(similarity * 100)}% match)`);
            if (this.wsServer) {
              this.wsServer.broadcast("incidents", {
                action: "duplicate_detected",
                newId: newIncident.id,
                existingId: existing.id,
                similarity: Math.round(similarity * 100),
              });
            }

            // Auto-close email-sourced duplicates with ≥80% similarity from same reporter
            if (similarity >= 0.8 && newIncident.source === "email" && existing.source === "email" &&
                (newIncident.reporterEmail || "").toLowerCase() === (existing.reporterEmail || "").toLowerCase()) {
              // Mark the newer incident as duplicate of the older one
              newIncident.status = "Closed";
              newIncident.duplicateOf = existing.id;
              newIncident.closedReason = `Auto-closed: duplicate of ${existing.id} (${Math.round(similarity * 100)}% match)`;
              newIncident.updatedAt = new Date().toISOString();
              if (!newIncident.activityLog) newIncident.activityLog = [];
              newIncident.activityLog.push({
                id: `AL-DEDUP-${Date.now()}`,
                type: "auto_dedup_closed",
                user: "Workflow Engine",
                time: new Date().toISOString(),
                detail: `Auto-closed as duplicate of ${existing.id} — ${Math.round(similarity * 100)}% subject overlap, same reporter (${newIncident.reporterEmail})`,
              });
              if (this.db) {
                await this.db.upsert("incidents", newIncident.id, JSON.stringify(newIncident));
                this._log("action", rule.id, `Auto-closed duplicate ${newIncident.id} → linked to ${existing.id}`);
              }
            }

            break; // only report first match
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  // ─── Execution log ────────────────────────────────────────────────────
  _log(level, ruleId, message) {
    const entry = { timestamp: new Date().toISOString(), level, ruleId, message };
    this.executionLog.push(entry);
    if (this.executionLog.length > 200) this.executionLog = this.executionLog.slice(-200);
    console.log(`[WorkflowEngine] [${level}] ${ruleId}: ${message}`);
  }

  // ─── Stats ────────────────────────────────────────────────────────────
  getStats() {
    return {
      running: !!this.timer,
      lastRun: this.lastRun,
      lastDailySummary: this.lastDailySummary || null,
      lastCycleTimeMs: this._cycleTimeMs,
      ...this.stats,
      logSize: this.executionLog.length,
      escalationChainTiers: this._escalationChain ? this._escalationChain.length : 0,
      skillMapCategories: this._skillMap ? Object.keys(this._skillMap).length : 0,
      scheduledTasks: this.getScheduledTaskStats(),
    };
  }

  getLog(limit = 50) {
    return this.executionLog.slice(-limit);
  }

  // ─── Phase J1 — Daily compliance evidence snapshot ────────────────────
  // Captures key ITSM/ISO 20000 metrics into compliance_evidence collection.
  // Idempotent per day via id = "evidence_<YYYY-MM-DD>".
  async _captureComplianceEvidence(dayKey) {
    try {
      const id = `evidence_${dayKey}`;
      const existing = await this.db.getOne("compliance_evidence", id);
      if (existing) return; // already captured today
      const incRows = await this.db.getAll("incidents");
      const allInc = incRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(i => i && !i._deleted);
      const dayStart = new Date(`${dayKey}T00:00:00+08:00`).getTime();
      const dayEnd = dayStart + 86400000;
      const closedToday = allInc.filter(i => i.resolvedAt && new Date(i.resolvedAt).getTime() >= dayStart && new Date(i.resolvedAt).getTime() < dayEnd);
      const createdToday = allInc.filter(i => i.createdAt && new Date(i.createdAt).getTime() >= dayStart && new Date(i.createdAt).getTime() < dayEnd);

      // SLA attainment from sla_tracking
      let slaAttainment = null, mttrHours = null;
      try {
        const slaRows = await this.db.getAll("sla_tracking");
        const slaItems = slaRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
        const total = slaItems.length;
        if (total > 0) {
          const attained = slaItems.filter(s => !s.breached).length;
          slaAttainment = Math.round((attained / total) * 1000) / 10;
        }
      } catch { /* ignore */ }
      if (closedToday.length > 0) {
        const total = closedToday.reduce((sum, i) => {
          const t = new Date(i.resolvedAt).getTime() - new Date(i.createdAt || i.resolvedAt).getTime();
          return sum + Math.max(0, t);
        }, 0);
        mttrHours = Math.round((total / closedToday.length) / 3600000 * 10) / 10;
      }

      // CSAT
      let csatAvg = null;
      try {
        const csatRows = await this.db.getAll("csat_responses");
        const csatItems = csatRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
        const recent = csatItems.filter(c => c.respondedAt && new Date(c.respondedAt).getTime() >= dayStart - 30 * 86400000);
        if (recent.length > 0) {
          const sum = recent.reduce((s, c) => s + (Number(c.rating) || 0), 0);
          csatAvg = Math.round((sum / recent.length) * 10) / 10;
        }
      } catch { /* ignore */ }

      // Change freeze violations + total changes
      let totalChanges = 0, freezeViolations = 0;
      try {
        const chRows = await this.db.getAll("changes");
        const chItems = chRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(c => c && !c._deleted);
        totalChanges = chItems.length;
        freezeViolations = chItems.filter(c => c.freezeViolation === true).length;
      } catch { /* ignore */ }

      const evidence = {
        id, date: dayKey, capturedAt: new Date().toISOString(),
        metrics: {
          slaAttainmentPct: slaAttainment,
          mttrHours,
          csatAvg30d: csatAvg,
          incidentsCreated: createdToday.length,
          incidentsResolved: closedToday.length,
          totalIncidents: allInc.length,
          totalChanges,
          changeFreezeViolations: freezeViolations,
        },
        signedBy: "system",
      };
      await this.db.upsert("compliance_evidence", id, JSON.stringify(evidence));
      try { await this.db.audit("compliance_evidence", id, "snapshot", JSON.stringify(evidence.metrics), "system"); } catch { /* ignore */ }
      this._log("action", "COMPLIANCE_EVIDENCE", `Captured ${id}: SLA ${slaAttainment}%, MTTR ${mttrHours}h, CSAT ${csatAvg}`);
    } catch (err) {
      this._log("error", "COMPLIANCE_EVIDENCE", `Capture failed: ${err.message}`);
    }
  }

  // ─── Daily Summary Email ──────────────────────────────────────────────
  async sendDailySummary() {
    if (!this.graphSendMail) { this._log("warn", "DAILY_SUMMARY", "graphSendMail not available"); return { error: "Mail not configured" }; }
    try {
      const incRows = await this.db.getAll("incidents");
      const allInc = incRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(i => i && !i._deleted);

      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const open = allInc.filter(i => !["Resolved", "Closed"].includes(i.status));
      const resolvedToday = allInc.filter(i => i.status === "Resolved" && (i.resolvedAt || "").startsWith(todayStr));
      const createdToday = allInc.filter(i => (i.createdAt || i.created_at || "").startsWith(todayStr));
      const sevA = open.filter(i => i.priority === "Sev-A");
      const sevB = open.filter(i => i.priority === "Sev-B");

      // Check SLA breaches
      let slaBreaches = 0;
      try {
        const slaRows = await this.db.getAll("sla_tracking");
        slaBreaches = slaRows.filter(r => { try { const s = JSON.parse(r.data); return s.status === "breached" && !s._deleted; } catch { return false; } }).length;
      } catch { /* ignore */ }

      // Pending AI approvals
      let pendingAI = 0;
      try {
        const aiRows = await this.db.getAll("ai_resolve_queue");
        pendingAI = aiRows.filter(r => { try { const s = typeof r.data === "string" ? JSON.parse(r.data) : r.data; return s.status === "pending"; } catch { return false; } }).length;
      } catch { /* ignore */ }

      const summary = {
        date: todayStr,
        openIncidents: open.length,
        createdToday: createdToday.length,
        resolvedToday: resolvedToday.length,
        sevAOpen: sevA.length,
        sevBOpen: sevB.length,
        slaBreaches,
        pendingAIApprovals: pendingAI,
      };

      const html = `<div style="font-family:Arial,sans-serif;max-width:650px;">
        <div style="background:linear-gradient(135deg,#1E3A5F,#3B82F6);padding:20px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;color:#fff;font-size:20px;">📊 ITSM Daily Summary — ${todayStr}</h2>
          <p style="margin:6px 0 0;color:#93C5FD;font-size:13px;">Generated at ${now.toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false })}</p>
        </div>
        <div style="background:#f8f9fa;padding:20px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;">
          <table style="border-collapse:collapse;width:100%;margin-bottom:16px;">
            <tr style="background:#E5E7EB;"><th style="padding:10px 14px;text-align:left;color:#374151;" colspan="2">Incident Overview</th></tr>
            <tr><td style="padding:8px 14px;font-weight:bold;color:#6B7280;border-bottom:1px solid #eee;">Open Incidents</td><td style="padding:8px 14px;font-size:18px;font-weight:bold;color:#EF4444;border-bottom:1px solid #eee;">${open.length}</td></tr>
            <tr><td style="padding:8px 14px;font-weight:bold;color:#6B7280;border-bottom:1px solid #eee;">Created Today</td><td style="padding:8px 14px;border-bottom:1px solid #eee;">${createdToday.length}</td></tr>
            <tr><td style="padding:8px 14px;font-weight:bold;color:#6B7280;border-bottom:1px solid #eee;">Resolved Today</td><td style="padding:8px 14px;color:#10B981;font-weight:bold;border-bottom:1px solid #eee;">${resolvedToday.length}</td></tr>
            <tr><td style="padding:8px 14px;font-weight:bold;color:#6B7280;border-bottom:1px solid #eee;">Sev-A (Critical) Open</td><td style="padding:8px 14px;color:${sevA.length > 0 ? "#EF4444" : "#10B981"};font-weight:bold;border-bottom:1px solid #eee;">${sevA.length}</td></tr>
            <tr><td style="padding:8px 14px;font-weight:bold;color:#6B7280;border-bottom:1px solid #eee;">Sev-B (High) Open</td><td style="padding:8px 14px;border-bottom:1px solid #eee;">${sevB.length}</td></tr>
            <tr><td style="padding:8px 14px;font-weight:bold;color:#6B7280;border-bottom:1px solid #eee;">SLA Breaches</td><td style="padding:8px 14px;color:${slaBreaches > 0 ? "#EF4444" : "#10B981"};font-weight:bold;border-bottom:1px solid #eee;">${slaBreaches}</td></tr>
            <tr><td style="padding:8px 14px;font-weight:bold;color:#6B7280;">Pending AI Approvals</td><td style="padding:8px 14px;color:${pendingAI > 0 ? "#F59E0B" : "#10B981"};font-weight:bold;">${pendingAI}</td></tr>
          </table>
          ${sevA.length > 0 ? `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;padding:12px;margin-bottom:16px;">
            <strong style="color:#DC2626;">⚠️ Critical Incidents Requiring Attention:</strong>
            <ul style="margin:8px 0 0;padding-left:20px;color:#991B1B;">${sevA.slice(0, 5).map(i => `<li>${(i.id || "").replace(/</g, "&lt;")} — ${(i.title || "").substring(0, 60).replace(/</g, "&lt;")}</li>`).join("")}</ul>
          </div>` : ""}
          <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;"/>
          <p style="color:#888;font-size:11px;">VGC Technology Pte Ltd — IT Service Management<br/>This is an automated daily summary from the ITSM Workflow Engine.</p>
        </div>
      </div>`;

      await this.graphSendMail({
        to: ["hlaing@vgctechnology.com", "johndoe@vgcsg.com"],
        subject: `[VGC ITSM] Daily Summary — ${todayStr} | ${open.length} open, ${resolvedToday.length} resolved`,
        body: html,
        isCustomerEmail: false,
        from: process.env.MAIL_FROM_ALERTS || process.env.MAIL_FROM || "itsupport@vgctechnology.com",
      });

      this.lastDailySummary = now.toISOString();
      this._log("action", "DAILY_SUMMARY", `Sent daily summary: ${open.length} open, ${createdToday.length} new, ${resolvedToday.length} resolved`);
      return summary;
    } catch (err) {
      this.stats.errors++;
      this._log("error", "DAILY_SUMMARY", `Failed to send daily summary: ${err.message}`);
      return { error: err.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 10.1 — Scheduled Task Runner (cron-like recurring tasks)
  // ════════════════════════════════════════════════════════════════════════
  registerScheduledTask(taskId, { name, intervalMs, handler, enabled = true }) {
    if (!this._scheduledTasks) this._scheduledTasks = new Map();
    this._scheduledTasks.set(taskId, {
      id: taskId, name, intervalMs, handler, enabled,
      lastRun: null, nextRun: Date.now() + intervalMs, runCount: 0, errors: 0,
    });
    this._log("action", "SCHEDULER", `Registered task: ${name} (every ${Math.round(intervalMs / 60000)}min)`);
  }

  async runScheduledTasks() {
    if (!this._scheduledTasks || this._scheduledTasks.size === 0) return;
    const now = Date.now();
    for (const [, task] of this._scheduledTasks) {
      if (!task.enabled || now < task.nextRun) continue;
      try {
        await task.handler(this);
        task.lastRun = new Date().toISOString();
        task.nextRun = now + task.intervalMs;
        task.runCount++;
        this._log("action", "SCHEDULER", `Executed: ${task.name} (run #${task.runCount})`);
      } catch (err) {
        task.errors++;
        task.nextRun = now + task.intervalMs; // still advance to avoid infinite retries
        this._log("error", "SCHEDULER", `Task ${task.name} failed: ${err.message}`);
      }
    }
  }

  getScheduledTaskStats() {
    if (!this._scheduledTasks) return [];
    return Array.from(this._scheduledTasks.values()).map(t => ({
      id: t.id, name: t.name, enabled: t.enabled,
      intervalMin: Math.round(t.intervalMs / 60000),
      lastRun: t.lastRun, nextRun: new Date(t.nextRun).toISOString(),
      runCount: t.runCount, errors: t.errors,
    }));
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 10.2 — Multi-tier Escalation Chain
  // ════════════════════════════════════════════════════════════════════════
  setEscalationChain(chain) {
    // chain = [{ level: 1, thresholdMin: 15, notifyRoles: ["engineer"], channels: ["inapp"] },
    //          { level: 2, thresholdMin: 30, notifyRoles: ["team_lead"], channels: ["inapp","email"] },
    //          { level: 3, thresholdMin: 60, notifyRoles: ["manager"], channels: ["inapp","email","sms"] }]
    this._escalationChain = chain.sort((a, b) => a.level - b.level);
    this._log("action", "ESCALATION_CHAIN", `Configured ${chain.length}-tier escalation chain`);
  }

  async _runEscalationChain() {
    if (!this._escalationChain || this._escalationChain.length === 0) return;
    const incidents = this._cycleIncidents || [];
    const now = Date.now();

    for (const inc of incidents) {
      try {
        const status = (inc.status || "").toLowerCase();
        if (["closed", "resolved"].includes(status)) continue;
        if (inc.priority !== "Sev-A" && inc.priority !== "Sev-B") continue;

        const created = new Date(inc.createdAt || inc.created_at || inc.created || 0).getTime();
        if (!created) continue;
        const elapsedMin = (now - created) / 60000;
        const currentLevel = inc._escalationLevel || 0;

        // v3.25 Phase B6: also support SLA-pct-aware thresholds.
        // If a tier sets `slaPct`, trigger when SLA elapsed pct >= that value
        // (uses computeSlaStatus_v2 already wired into incidents via inc.slaPct or inc._slaPct).
        // Falls back to time-based thresholdMin when slaPct not set.
        let incSlaPct = typeof inc.slaPct === "number" ? inc.slaPct
          : typeof inc._slaPct === "number" ? inc._slaPct
          : null;
        if (incSlaPct === null) {
          try {
            const sla = computeSlaStatus_v2(inc, this._slaPolicy || undefined);
            if (sla && typeof sla.worstPct === "number") incSlaPct = sla.worstPct;
          } catch { /* ignore */ }
        }

        // Find next escalation tier that should trigger
        for (const tier of this._escalationChain) {
          if (tier.level <= currentLevel) continue;
          let triggered = false;
          let triggerReason = "";
          if (typeof tier.slaPct === "number" && incSlaPct !== null) {
            if (incSlaPct >= tier.slaPct) {
              triggered = true;
              triggerReason = `SLA elapsed ${Math.round(incSlaPct)}% ≥ tier threshold ${tier.slaPct}%`;
            } else break;
          } else {
            const threshold = inc.priority === "Sev-A" ? tier.thresholdMin : tier.thresholdMin * 2;
            if (elapsedMin < threshold) break; // not ready for this tier yet
            triggered = true;
            triggerReason = `No resolution after ${Math.round(elapsedMin)} min (${inc.priority} threshold: ${threshold}min)`;
          }
          if (!triggered) break;
          if (inc.firstResponseAt && tier.level <= 1) continue; // has response, skip L1

          // Escalate to this tier
          inc._escalationLevel = tier.level;
          inc.escalationLevel = tier.level;
          inc.lastModified = new Date().toISOString();
          await this.db.upsert("incidents", inc.id, JSON.stringify(inc));

          const escEntry = {
            id: `ESC-CHAIN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            incidentId: inc.id, level: tier.level,
            reason: triggerReason,
            notifyRoles: tier.notifyRoles, channels: tier.channels,
            triggeredBy: "EscalationChain", timestamp: new Date().toISOString(),
          };
          await this.db.upsert("escalation_log", escEntry.id, JSON.stringify(escEntry));

          this.stats.autoEscalated++;
          this._log("action", "ESCALATION_CHAIN", `${inc.id} → Level ${tier.level} (${Math.round(elapsedMin)}min elapsed, notifying: ${tier.notifyRoles.join(",")})`);

          if (this.wsServer) this.wsServer.broadcast("escalations", { action: "chain_escalate", ...escEntry });

          if (this.notifyEngine) {
            await this.notifyEngine.send({
              channels: tier.channels || ["inapp"],
              title: `Escalation L${tier.level}: ${inc.title || inc.id}`,
              body: `${inc.priority} incident ${inc.id} escalated to Level ${tier.level} — no resolution after ${Math.round(elapsedMin)} minutes.`,
              severity: tier.level >= 3 ? "critical" : "warning",
              type: "escalation_chain", incidentId: inc.id,
              targetRoles: tier.notifyRoles,
            }).catch(() => {});
          }

          if (tier.channels?.includes("email") && this.graphSendMail) {
            try {
              await this.graphSendMail({
                to: ["hlaing@vgctechnology.com", "johndoe@vgcsg.com"],
                subject: `[ESCALATION L${tier.level}] ${inc.priority} — ${inc.title || inc.id}`,
                body: `<div style="font-family:Arial;padding:16px;">
                  <h2 style="color:#FF4444;">⚠️ Escalation Level ${tier.level}</h2>
                  <p><strong>Incident:</strong> ${inc.id}</p>
                  <p><strong>Priority:</strong> ${inc.priority}</p>
                  <p><strong>Title:</strong> ${(inc.title || "").substring(0, 200)}</p>
                  <p><strong>Elapsed:</strong> ${Math.round(elapsedMin)} minutes</p>
                  <p><strong>Assigned to:</strong> ${inc.assignee || "Unassigned"}</p>
                  <p style="color:#666;font-size:12px;">Automated escalation by VGC ITSM Workflow Engine</p>
                </div>`,
                isCustomerEmail: false,
                from: process.env.MAIL_FROM_ALERTS || process.env.MAIL_FROM || "itsupport@vgctechnology.com",
              });
            } catch (mailErr) {
              this._log("error", "ESCALATION_CHAIN", `Email notification failed: ${mailErr.message}`);
            }
          }
          break; // only one level per cycle
        }
      } catch (err) {
        this._log("error", "ESCALATION_CHAIN", `Incident ${inc.id}: ${err.message}`);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 10.3 — Skill-based Auto-Assignment
  // ════════════════════════════════════════════════════════════════════════
  setSkillMap(skillMap) {
    // skillMap = { "Network": ["John Doe", "Jane Smith"], "Security": ["Alice"], ... }
    this._skillMap = skillMap;
    this._log("action", "SKILL_ASSIGN", `Configured skill map for ${Object.keys(skillMap).length} categories`);
  }

  // v3.35.0 — Pure picker reused by cycle + email-ingest inline path.
  // Returns { name, load } or null.
  pickSkillAssignee(category, workload, opts = {}) {
    if (!this._skillMap || !category) return null;
    const candidates = this._skillMap[category];
    if (!candidates || candidates.length === 0) return null;
    const exclude = opts.excludeName || null;
    let best = null, bestLoad = Infinity;
    for (const name of candidates) {
      if (name === exclude) continue;
      const load = workload[name] || 0;
      if (load < bestLoad) { bestLoad = load; best = name; }
    }
    return best ? { name: best, load: bestLoad } : null;
  }

  // v3.35.0 — Service Desk roster fallback (round-robin by lowest workload).
  // Roster persisted as `service_desk_roster.active.members:[name,...]`.
  async getServiceDeskRoster() {
    if (this._rosterCache && this._rosterCacheExpiry > Date.now()) return this._rosterCache;
    try {
      const row = await this.db.getOne("service_desk_roster", "active");
      const data = row && (typeof row.data === "string" ? JSON.parse(row.data) : row.data);
      const members = (data && Array.isArray(data.members)) ? data.members.filter(n => typeof n === "string" && n.trim()) : [];
      this._rosterCache = members;
      this._rosterCacheExpiry = Date.now() + 5 * 60 * 1000; // 5 min
      return members;
    } catch { return []; }
  }

  pickRoundRobinAgent(roster, workload, opts = {}) {
    if (!Array.isArray(roster) || roster.length === 0) return null;
    const exclude = opts.excludeName || null;
    let best = null, bestLoad = Infinity;
    for (const name of roster) {
      if (name === exclude) continue;
      const load = workload[name] || 0;
      if (load < bestLoad) { bestLoad = load; best = name; }
    }
    return best ? { name: best, load: bestLoad } : null;
  }

  async _autoAssignBySkill() {
    if (!this._skillMap || Object.keys(this._skillMap).length === 0) return;
    const incidents = this._cycleIncidents || [];

    // Build workload counts
    const workload = {};
    for (const inc of incidents) {
      if (inc.assignee && inc.assignee !== "Unassigned") {
        workload[inc.assignee] = (workload[inc.assignee] || 0) + 1;
      }
    }

    for (const inc of incidents) {
      try {
        if (inc.assignee && inc.assignee !== "Unassigned") continue; // already assigned
        if (inc._skillAssignAttempted) continue; // already tried

        const cat = inc.category || "";
        const pick = this.pickSkillAssignee(cat, workload);
        if (!pick) continue;
        const bestCandidate = pick.name;
        const bestLoad = pick.load;

        inc.assignee = bestCandidate;
        inc.assignedBy = "SkillEngine";
        inc._skillAssignAttempted = true;
        inc.lastModified = new Date().toISOString();
        if (!inc.activityLog) inc.activityLog = [];
        inc.activityLog.push({
          id: `AL-SKILL-${Date.now()}`,
          type: "auto_assign",
          user: "Workflow Engine (Skill-Based)",
          time: new Date().toISOString(),
          detail: `Auto-assigned to ${bestCandidate} (category: ${cat}, workload: ${bestLoad} tickets)`,
        });
        workload[bestCandidate] = (workload[bestCandidate] || 0) + 1;

        await this.db.upsert("incidents", inc.id, JSON.stringify(inc));
        this._log("action", "SKILL_ASSIGN", `${inc.id} → ${bestCandidate} (${cat}, load: ${bestLoad})`);

        if (this.wsServer) {
          this.wsServer.broadcast("incidents", { action: "skill_assign", id: inc.id, assignee: bestCandidate, category: cat });
        }
      } catch (err) {
        this._log("error", "SKILL_ASSIGN", `${inc.id}: ${err.message}`);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // v3.35.0 Phase C — Auto-apply skill-based reassign for Sev-A/B unassigned
  // Shadow-first via featureFlag `auto_reassign_sev_ab`. Mirrors v3.34.2 promotion gate.
  // Sev-A: 24/7. Sev-B: business-hours only (Mon-Fri 09:00-18:00 SGT).
  // ════════════════════════════════════════════════════════════════════════
  async _autoApplyReassignSuggestions() {
    let ff;
    try { ff = require("./featureFlags"); } catch { return; }
    if (typeof ff.isEnabled !== "function") return;
    const enabled = ff.isEnabled("auto_reassign_sev_ab");
    let payload = {};
    try { payload = (typeof ff.payload === "function" && ff.payload("auto_reassign_sev_ab")) || {}; } catch { /* ignore */ }
    const shadowOnly = payload.shadowOnly !== false; // default true
    const dailyCap = Math.max(1, Math.min(500, parseInt(payload.dailyCap || 50, 10)));
    const minAgeMin = Math.max(0, parseInt(payload.minAgeMinutes || 15, 10));
    if (!enabled) return; // hard disabled (default state)

    if (!this._skillMap || Object.keys(this._skillMap).length === 0) return;
    const incidents = this._cycleIncidents || [];
    if (incidents.length === 0) return;

    // Daily cap check (UTC day) via auto_reassign_history count
    const todayKey = new Date().toISOString().slice(0, 10);
    let todayCount = 0;
    try {
      const histRows = await this.db.getAll("auto_reassign_history");
      for (const r of histRows) {
        try {
          const h = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
          if (h && h.day === todayKey) todayCount++;
        } catch { /* ignore */ }
      }
    } catch { /* collection may not exist yet */ }
    if (todayCount >= dailyCap) {
      this._log("action", "AUTO_REASSIGN", `Daily cap reached (${todayCount}/${dailyCap}) — skipping`);
      return;
    }

    // Business hours check for Sev-B (SGT)
    const nowSGT = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
    const dow = nowSGT.getDay(); // 0=Sun, 6=Sat
    const hourSGT = nowSGT.getHours();
    const isBusinessHours = dow >= 1 && dow <= 5 && hourSGT >= 9 && hourSGT < 18;

    // Build current workload
    const workload = {};
    for (const i of incidents) {
      if (i.assignee && i.assignee !== "Unassigned") workload[i.assignee] = (workload[i.assignee] || 0) + 1;
    }

    const nowMs = Date.now();
    let processed = 0;
    for (const inc of incidents) {
      if (todayCount + processed >= dailyCap) break;
      try {
        const isUnassigned = !inc.assignee || inc.assignee === "Unassigned";
        if (!isUnassigned) continue;
        if (!["Sev-A", "Sev-B"].includes(inc.priority)) continue;
        if (inc.priority === "Sev-B" && !isBusinessHours) continue;
        if (inc._autoReassignAttempted) continue;
        const created = inc.createdAt ? new Date(inc.createdAt).getTime() : 0;
        if (!created) continue;
        const ageMin = (nowMs - created) / 60000;
        if (ageMin < minAgeMin) continue;

        const cat = inc.category || "";
        const pick = this.pickSkillAssignee(cat, workload);
        if (!pick) continue;

        const histRec = {
          id: `AR-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          incidentId: inc.id, priority: inc.priority, category: cat,
          previousAssignee: inc.assignee || "Unassigned", suggestedAssignee: pick.name,
          workload: pick.load, ageMinutes: Math.round(ageMin),
          mode: shadowOnly ? "shadow" : "real",
          day: todayKey, timestamp: new Date().toISOString(),
        };

        if (!shadowOnly) {
          inc.assignee = pick.name;
          inc.assignedBy = "AutoReassign-SevAB";
          inc._autoReassignAttempted = true;
          inc.lastModified = new Date().toISOString();
          if (!inc.activityLog) inc.activityLog = [];
          inc.activityLog.push({
            id: `AL-AR-${Date.now()}`,
            type: "auto_reassign",
            user: "Workflow Engine (Auto-Reassign Sev-A/B)",
            time: inc.lastModified,
            detail: `Auto-reassigned to ${pick.name} (${cat}, ${inc.priority} unassigned ${Math.round(ageMin)}min, workload ${pick.load})`,
          });
          workload[pick.name] = (workload[pick.name] || 0) + 1;
          await this.db.upsert("incidents", inc.id, JSON.stringify(inc));
          if (this.wsServer) this.wsServer.broadcast("incidents", { action: "auto_reassign", id: inc.id, assignee: pick.name });
        }

        try { await this.db.upsert("auto_reassign_history", histRec.id, JSON.stringify(histRec)); } catch { /* ignore */ }
        try { await this.db.audit("incidents", inc.id, shadowOnly ? "auto_reassign_shadow" : "auto_reassign", JSON.stringify(histRec), "WorkflowEngine"); } catch { /* ignore */ }
        this._log("action", "AUTO_REASSIGN", `${inc.id} ${shadowOnly ? "[shadow]" : "→"} ${pick.name} (${inc.priority} ${cat}, age ${Math.round(ageMin)}min, load ${pick.load})`);
        processed++;
      } catch (err) {
        this._log("error", "AUTO_REASSIGN", `${inc.id}: ${err.message}`);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 10.4 — Change Approval Pipeline (multi-stage)
  // ════════════════════════════════════════════════════════════════════════
  async _processChangeApprovals() {
    try {
      const rows = await this.db.getAll("changes");
      const changes = rows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(c => c && !c._deleted);

      for (const change of changes) {
        try {
          if (change.approvalStatus === "Approved" || change.approvalStatus === "Rejected") continue;
          if (change.status === "Closed" || change.status === "Cancelled") continue;

          const type = (change.type || change.changeType || "").toLowerCase();
          const risk = (change.riskLevel || change.risk || "").toLowerCase();

          // Stage 1: Auto-approve standard + low-risk changes
          if (type === "standard" && (risk === "low" || risk === "none" || !risk)) {
            if (change.approvalStatus !== "Approved") {
              change.approvalStatus = "Approved";
              change.approvalStage = "auto";
              change.approvedBy = "Workflow Engine (Auto-Approve)";
              change.approvedAt = new Date().toISOString();
              change.lastModified = new Date().toISOString();
              if (!change.approvalHistory) change.approvalHistory = [];
              change.approvalHistory.push({
                stage: "auto", action: "approved", by: "WorkflowEngine",
                reason: "Standard change, low risk — auto-approved per policy",
                timestamp: new Date().toISOString(),
              });
              await this.db.upsert("changes", change.id, JSON.stringify(change));
              this._log("action", "CHANGE_APPROVAL", `Auto-approved ${change.id} (${type}/${risk})`);
              if (this.wsServer) this.wsServer.broadcast("changes", { action: "auto_approve", id: change.id });
            }
            continue;
          }

          // Stage 2: Normal changes — require manager approval (create approval request if not exists)
          if ((type === "normal" || type === "standard") && !change._approvalRequested) {
            change._approvalRequested = true;
            change.approvalStatus = "Pending Approval";
            change.approvalStage = "manager";
            change.lastModified = new Date().toISOString();
            if (!change.approvalHistory) change.approvalHistory = [];
            change.approvalHistory.push({
              stage: "manager", action: "requested", by: "WorkflowEngine",
              reason: `${type}/${risk || "medium"} change requires manager approval`,
              timestamp: new Date().toISOString(),
            });
            await this.db.upsert("changes", change.id, JSON.stringify(change));
            this._log("action", "CHANGE_APPROVAL", `Approval requested for ${change.id} (${type}/${risk || "medium"})`);

            if (this.notifyEngine) {
              await this.notifyEngine.send({
                channels: ["inapp", "email"],
                title: `Change Approval Required: ${change.id}`,
                body: `Change "${change.title || change.id}" (${type}/${risk || "medium"}) requires manager approval.`,
                severity: "info", type: "change_approval", changeId: change.id,
              }).catch(() => {});
            }
            continue;
          }

          // Stage 3: Emergency changes — flag for CAB review
          if (type === "emergency" && !change._cabReviewRequested) {
            change._cabReviewRequested = true;
            change.approvalStatus = "CAB Review";
            change.approvalStage = "cab";
            change.lastModified = new Date().toISOString();
            if (!change.approvalHistory) change.approvalHistory = [];
            change.approvalHistory.push({
              stage: "cab", action: "escalated", by: "WorkflowEngine",
              reason: "Emergency change requires CAB review",
              timestamp: new Date().toISOString(),
            });
            await this.db.upsert("changes", change.id, JSON.stringify(change));
            this._log("action", "CHANGE_APPROVAL", `CAB review requested for emergency ${change.id}`);

            if (this.notifyEngine) {
              await this.notifyEngine.send({
                channels: ["inapp", "email"],
                title: `🚨 Emergency Change — CAB Review: ${change.id}`,
                body: `Emergency change "${change.title || change.id}" requires immediate CAB review.`,
                severity: "critical", type: "cab_review", changeId: change.id,
              }).catch(() => {});
            }
          }
        } catch (err) {
          this._log("error", "CHANGE_APPROVAL", `${change.id}: ${err.message}`);
        }
      }
    } catch (err) {
      this._log("error", "CHANGE_APPROVAL", `Pipeline scan failed: ${err.message}`);
    }
  }

  // ─── ITIL4: Check overdue PIR action items ────────────────────────────
  async _checkPirDueActions() {
    try {
      const rows = await this.db.getAll("pir_records");
      const now = Date.now();
      for (const row of rows) {
        try {
          const pir = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          if (!pir || pir.status === "Completed") continue;
          const actions = pir.actionItems || [];
          for (const action of actions) {
            if (action.status === "Completed" || action.status === "Overdue") continue;
            if (!action.dueDate) continue;
            if (new Date(action.dueDate).getTime() < now) {
              action.status = "Overdue";
              this._log("action", "PIR_DUE", `PIR ${pir.id} action "${(action.description || "").slice(0, 60)}" is overdue`);
              this.stats.autoEscalated = (this.stats.autoEscalated || 0) + 1;
            }
          }
          pir.actionItems = actions;
          await this.db.upsert("pir_records", pir.id, JSON.stringify(pir));
        } catch { /* ignore individual PIR errors */ }
      }
    } catch (err) {
      this._log("error", "PIR_DUE", `PIR due-action scan failed: ${err.message}`);
    }
  }

  // ─── ITIL4: Trigger CSAT surveys for recently resolved incidents ──────
  async _triggerCsatSurveys() {
    try {
      const ff = require("./featureFlags");
      if (!ff.isEnabled("csat_ai_loop")) return;
      const delayHours = (ff.getFlag("csat_ai_loop")?.payload?.delayHours) || 24;
      const incidents = this._cycleIncidents || [];
      const now = Date.now();
      const existingRows = await this.db.getAll("csat_responses");
      const surveyedIds = new Set();
      for (const r of existingRows) {
        try { const c = typeof r.data === "string" ? JSON.parse(r.data) : r.data; if (c && c.incidentId) surveyedIds.add(c.incidentId); } catch { /* ignore */ }
      }
      const allRows = this.db.getOpen ? [] : await this.db.getAll("incidents");
      const resolved = (this._cycleIncidents ? [] : allRows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean))
        .concat(incidents)
        .filter(i => i && (i.status === "Resolved" || i.status === "Closed") && i.resolvedAt && !surveyedIds.has(i.id));

      for (const inc of resolved) {
        const resolvedTime = new Date(inc.resolvedAt).getTime();
        const elapsed = (now - resolvedTime) / 3600000;
        if (elapsed >= delayHours && elapsed < delayHours + 24) {
          // Create a pending CSAT survey notification
          const surveyId = `CSAT-PENDING-${inc.id}`;
          if (surveyedIds.has(inc.id)) continue;
          surveyedIds.add(inc.id);
          const pending = { id: surveyId, incidentId: inc.id, status: "pending", createdAt: new Date().toISOString(), requester: inc.requester || inc.contactEmail };
          await this.db.upsert("csat_responses", surveyId, JSON.stringify(pending));
          this._log("action", "CSAT_SURVEY", `Survey triggered for resolved incident ${inc.id}`);
          if (this.notifyEngine) {
            await this.notifyEngine.send({
              channels: ["inapp"], title: `CSAT Survey: ${inc.title || inc.id}`,
              body: `Please rate your experience with incident ${inc.id}`, severity: "info",
              type: "csat_survey", incidentId: inc.id,
            }).catch(() => {});
          }
        }
      }
    } catch (err) {
      this._log("error", "CSAT_SURVEY", `Survey trigger scan failed: ${err.message}`);
    }
  }

  // ─── ITIL4: Get current on-call engineer for off-hours routing ────────
  async getOnCallForNow() {
    try {
      const rows = await this.db.getAll("oncall_schedules");
      const now = new Date();
      const currentDay = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()];

      for (const row of rows) {
        try {
          const sched = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          if (!sched || sched.status !== "Active") continue;
          // Check if current date is within schedule range
          if (sched.startDate && new Date(sched.startDate) > now) continue;
          if (sched.endDate && new Date(sched.endDate) < now) continue;
          // Find current rotation member
          const members = sched.members || [];
          if (members.length === 0) continue;
          let idx = 0;
          if (sched.rotationType === "Weekly") {
            const weekNum = Math.floor((now - new Date(sched.startDate || sched.createdAt)) / (7 * 86400000));
            idx = weekNum % members.length;
          } else if (sched.rotationType === "Daily") {
            const dayNum = Math.floor((now - new Date(sched.startDate || sched.createdAt)) / 86400000);
            idx = dayNum % members.length;
          }
          // Check holiday overrides
          const todayStr = now.toISOString().slice(0, 10);
          const holidays = sched.holidayOverrides || [];
          const holidayOverride = holidays.find(h => h.date === todayStr);
          if (holidayOverride && holidayOverride.assignee) {
            return { assignee: holidayOverride.assignee, schedule: sched.id, source: "holiday_override" };
          }
          return { assignee: members[idx], schedule: sched.id, source: "rotation" };
        } catch { /* ignore */ }
      }
      return null;
    } catch { return null; }
  }
}

module.exports = { WorkflowEngine };
