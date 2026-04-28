// ─── Phase H4 — Shadow Workflow Engine ───────────────────────────────
// Mirror of shadowMode.js but for the workflow engine. Evaluates a
// CANDIDATE rule set (workflow_rules_v2) alongside the live engine for
// each open incident. Diffs are written to shadow_diffs with kind:"workflow"
// and reuse the existing /api/shadow/diffs viewer.
//
// The candidate's outputs are NEVER acted on — diff-only.
//
// Default candidate rule (when collection workflow_rules_v2 is empty):
//   - auto_close_v2: close Resolved tickets after 48h (live = 72h)
//   - auto_escalate_v2: bump Sev-A no-response window to 10 min (live = 15 min)
//
// Wire from workflowEngine.runCycle():
//   const sw = require("./shadowWorkflow");
//   await sw.runShadow({ db, featureFlags, incidents: this._cycleIncidents });
//
// Stats expose runs/diffs/errors via getStats().

const _stats = { runs: 0, errors: 0, diffs: 0, lastRunAt: null, lastDiffAt: null };

function getStats() { return { ..._stats }; }

const DEFAULT_RULES = [
  {
    id: "WF_V2_AUTO_CLOSE",
    name: "Auto-Close Resolved (48h candidate)",
    when: { status: "Resolved" },
    thresholdHours: 48,
    candidateAction: "close",
  },
  {
    id: "WF_V2_AUTO_ESCALATE",
    name: "Auto-Escalate Sev-A No-Response (10min candidate)",
    when: { priority: "Sev-A", status: ["New", "Open"] },
    thresholdMinutes: 10,
    candidateAction: "escalate",
  },
];

async function _loadCandidateRules(db) {
  try {
    const rows = await db.getAll("workflow_rules_v2");
    if (rows && rows.length) {
      return rows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
    }
  } catch { /* fall through to defaults */ }
  return DEFAULT_RULES;
}

function _ageMs(inc) {
  const ref = inc.resolvedAt || inc.lastUpdated || inc.updatedAt || inc.createdAt;
  if (!ref) return 0;
  const t = new Date(ref).getTime();
  return Number.isFinite(t) ? Date.now() - t : 0;
}

function _liveDecision(rule, inc) {
  // What the LIVE engine would do today (must match workflowEngine.js).
  const ageMs = _ageMs(inc);
  if (rule.candidateAction === "close") {
    const liveThresholdMs = 72 * 60 * 60 * 1000; // workflowEngine.js _autoCloseResolved
    return inc.status === "Resolved" && ageMs >= liveThresholdMs ? "close" : "noop";
  }
  if (rule.candidateAction === "escalate") {
    const liveThresholdMs = 15 * 60 * 1000; // workflowEngine.js _autoEscalateCritical
    const matches = inc.priority === "Sev-A" && (inc.status === "New" || inc.status === "Open");
    return matches && ageMs >= liveThresholdMs ? "escalate" : "noop";
  }
  return "noop";
}

function _candidateDecision(rule, inc) {
  const ageMs = _ageMs(inc);
  const thresholdMs = (rule.thresholdHours || 0) * 3600_000 + (rule.thresholdMinutes || 0) * 60_000;
  if (rule.candidateAction === "close") {
    return inc.status === "Resolved" && ageMs >= thresholdMs ? "close" : "noop";
  }
  if (rule.candidateAction === "escalate") {
    const matches = inc.priority === "Sev-A" && (inc.status === "New" || inc.status === "Open");
    return matches && ageMs >= thresholdMs ? "escalate" : "noop";
  }
  return "noop";
}

async function runShadow({ db, featureFlags, incidents }) {
  if (!featureFlags || !featureFlags.isEnabled("shadow_workflow_v2")) return { skipped: true };
  if (!Array.isArray(incidents) || incidents.length === 0) return { skipped: true, reason: "no_incidents" };
  if (!db || typeof db.getAll !== "function" || typeof db.upsert !== "function") return { skipped: true, reason: "no_db" };

  _stats.runs++;
  _stats.lastRunAt = new Date().toISOString();
  const rules = await _loadCandidateRules(db);

  let diffsWritten = 0;
  for (const inc of incidents) {
    if (!inc || inc._deleted) continue;
    for (const rule of rules) {
      try {
        const live = _liveDecision(rule, inc);
        const candidate = _candidateDecision(rule, inc);
        if (live === candidate) continue;
        // Diff: candidate would act differently from live
        const at = new Date().toISOString();
        await db.upsert("shadow_diffs", `wf_${rule.id}_${inc.id}_${Date.now()}`, JSON.stringify({
          flag: "shadow_workflow_v2",
          kind: "workflow",
          ruleId: rule.id,
          ruleName: rule.name,
          incidentId: inc.id,
          incidentTitle: inc.title,
          status: inc.status,
          priority: inc.priority,
          ageMs: _ageMs(inc),
          control: live,
          candidate,
          at,
        }));
        diffsWritten++;
        _stats.diffs++;
        _stats.lastDiffAt = at;
      } catch (e) {
        _stats.errors++;
      }
    }
  }
  return { ran: true, rules: rules.length, incidents: incidents.length, diffsWritten };
}

module.exports = { runShadow, getStats, _DEFAULT_RULES: DEFAULT_RULES };
