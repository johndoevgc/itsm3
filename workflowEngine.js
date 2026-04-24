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
    this.stats = {
      rulesEvaluated: 0,
      actionsExecuted: 0,
      autoClosedTickets: 0,
      autoEscalated: 0,
      errors: 0,
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
    try {
      this.lastRun = new Date().toISOString();
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

      // ─── AI Auto-Resolve for idle incidents (Production Pipeline) ─────
      await this._triggerAutoResolveForIdle();
    } catch (err) {
      this.stats.errors++;
      console.error("[WorkflowEngine] Cycle error:", err.message);
    }
  }

  // ─── Auto-resolve idle incidents via AI ───────────────────────────────
  async _triggerAutoResolveForIdle() {
    try {
      const http = require("http");
      const rows = await this.db.getAll("incidents");
      const now = Date.now();
      const IDLE_THRESHOLD = 2 * 60 * 60 * 1000; // 2 hours idle

      for (const row of rows) {
        try {
          const inc = JSON.parse(row.data);
          if (inc._deleted) continue;
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

  // ─── Load rules from DB ───────────────────────────────────────────────
  async _loadRules() {
    try {
      const rows = await this.db.getAll("workflow_rules");
      return rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
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
      const rows = await this.db.getAll("incidents");
      const now = Date.now();
      const THRESHOLD = 72 * 60 * 60 * 1000; // 72 hours

      for (const row of rows) {
        try {
          const inc = JSON.parse(row.data);
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
      const rows = await this.db.getAll("incidents");
      const now = Date.now();
      const THRESHOLD = 15 * 60 * 1000; // 15 minutes

      for (const row of rows) {
        try {
          const inc = JSON.parse(row.data);
          if (inc._deleted) continue;
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
      const rows = await this.db.getAll("incidents");
      const title = (newIncident.title || "").toLowerCase();
      if (!title || title.length < 5) return;

      const words = title.split(/\s+/).filter(w => w.length > 3);
      if (words.length === 0) return;

      for (const row of rows) {
        try {
          const existing = JSON.parse(row.data);
          if (existing._deleted || existing.id === newIncident.id) continue;
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
      ...this.stats,
      logSize: this.executionLog.length,
    };
  }

  getLog(limit = 50) {
    return this.executionLog.slice(-limit);
  }
}

module.exports = { WorkflowEngine };
