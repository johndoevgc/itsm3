// ─── Workflow Automation Engine ──────────────────────────────────────────
// Evaluates workflow rules against real-time events and executes actions.
// Runs server-side with periodic rule evaluation + event-driven triggers.

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
        } catch {}
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
          const req = http.request({ hostname: "127.0.0.1", port, path: "/api/ai/auto-resolve", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, (res) => {
            let d = ""; res.on("data", c => d += c);
            res.on("end", () => { console.log(`[WorkflowEngine] Auto-resolve for ${inc.id}: ${d.substring(0, 200)}`); });
          });
          req.on("error", e => console.warn(`[WorkflowEngine] Auto-resolve failed for ${inc.id}:`, e.message));
          req.setTimeout(35000, () => { req.destroy(); });
          req.write(payload);
          req.end();

          this._log("action", "AUTO_RESOLVE", `Triggered auto-resolve for idle incident ${inc.id} (idle ${Math.round(idle / 3600000)}h)`);
        } catch {}
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
        } catch {}
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

          const created = inc.createdAt || inc.created_at || inc.created;
          if (!created) continue;
          const elapsed = now - new Date(created).getTime();
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
        } catch {}
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
        } catch {}
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
        } catch {}
      }
    } catch {}
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
    };
  }

  getLog(limit = 50) {
    return this.executionLog.slice(-limit);
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
      } catch {}

      // Pending AI approvals
      let pendingAI = 0;
      try {
        const aiRows = await this.db.getAll("ai_resolve_queue");
        pendingAI = aiRows.filter(r => { try { const s = typeof r.data === "string" ? JSON.parse(r.data) : r.data; return s.status === "pending"; } catch { return false; } }).length;
      } catch {}

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
        to: ["hlaing@vgctechnology.com"],
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
}

module.exports = { WorkflowEngine };
