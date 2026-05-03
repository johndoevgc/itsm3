import React, { useState, useCallback } from "react";
import { COLORS, btnStyle } from "../constants/theme.js";

// DataHygieneTab — admin panel for surfacing & cleaning AI-side data drift.
// Backend endpoints:
//   GET  /api/admin/data-hygiene/summary
//   POST /api/admin/data-hygiene/normalize-priorities  { dryRun, onlyDrifted }
//   POST /api/purge-test-data                          { dryRun, targets }
//   POST /api/admin/purge-audit-records                { dryRun, targets }
//
// Safety: every destructive call defaults to dryRun=true. Operator must
// explicitly toggle "Apply changes" before the Run buttons execute.

const card = {
  background: "#0F1117",
  border: "1px solid #1E2130",
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
};

const sectionTitle = {
  margin: 0,
  fontSize: 13,
  color: "#E8ECF4",
  fontFamily: "'Space Grotesk', sans-serif",
  fontWeight: 600,
};

const subText = {
  fontSize: 10,
  color: "#5A6178",
  marginTop: 2,
  fontFamily: "'JetBrains Mono', monospace",
};

const stat = (label, value, color = "#E8ECF4") => (
  <div style={{ background: "#1E2130", padding: "10px 14px", borderRadius: 6, minWidth: 110 }}>
    <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
    <div style={{ fontSize: 20, color, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>{value}</div>
  </div>
);

const codeBox = {
  background: "#0A0C14",
  border: "1px solid #1E2130",
  borderRadius: 4,
  padding: 10,
  fontSize: 11,
  fontFamily: "'JetBrains Mono', monospace",
  color: "#A8B0C4",
  whiteSpace: "pre-wrap",
  maxHeight: 320,
  overflow: "auto",
};

export function DataHygieneTab({ currentUser, showToast }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [normRunning, setNormRunning] = useState(false);
  const [normResult, setNormResult] = useState(null);
  const [applyChanges, setApplyChanges] = useState(false);
  const [purgeOrphansRunning, setPurgeOrphansRunning] = useState(false);
  const [orphanResult, setOrphanResult] = useState(null);
  const [seedCleanRunning, setSeedCleanRunning] = useState(false);
  const [seedCleanResult, setSeedCleanResult] = useState(null);
  const [auditPurgeRunning, setAuditPurgeRunning] = useState(false);
  const [auditPurgeResult, setAuditPurgeResult] = useState(null);

  const isAdmin = ["Administrator", "VGC Dev Admin", "Tenant Admin"].includes(currentUser?.rbacRole);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/data-hygiene/summary");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setSummary(d);
    } catch (e) {
      showToast?.(`Summary failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  React.useEffect(() => { if (isAdmin) loadSummary(); }, [isAdmin, loadSummary]);

  const runNormalize = async () => {
    if (!isAdmin) return;
    setNormRunning(true);
    setNormResult(null);
    try {
      const r = await fetch("/api/admin/data-hygiene/normalize-priorities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: !applyChanges, onlyDrifted: true }),
      });
      const d = await r.json();
      setNormResult(d);
      showToast?.(applyChanges
        ? `Normalized ${d.applied || 0} of ${d.wouldChange || 0} incidents`
        : `Dry-run: ${d.wouldChange || 0} incidents would change`);
      if (applyChanges) loadSummary();
    } catch (e) {
      showToast?.(`Normalize failed: ${e.message}`);
    } finally {
      setNormRunning(false);
    }
  };

  const runOrphanPurge = async () => {
    if (!isAdmin || !summary) return;
    const targets = {};
    let total = 0;
    for (const [coll, info] of Object.entries(summary.orphanedAiRows?.byCollection || {})) {
      if (info.sampleIds && info.sampleIds.length > 0) {
        targets[coll] = info.sampleIds;
        total += info.sampleIds.length;
      }
    }
    if (total === 0) { showToast?.("No orphan IDs in current summary."); return; }
    setPurgeOrphansRunning(true);
    setOrphanResult(null);
    try {
      const r = await fetch("/api/purge-test-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: !applyChanges, targets }),
      });
      const d = await r.json();
      setOrphanResult(d);
      showToast?.(applyChanges
        ? `Purged ${d.totalPurged || 0} orphan rows (of ${total} requested)`
        : `Dry-run: ${total} orphan rows would be purged`);
      if (applyChanges) loadSummary();
    } catch (e) {
      showToast?.(`Orphan purge failed: ${e.message}`);
    } finally {
      setPurgeOrphansRunning(false);
    }
  };

  const runSeedClean = async () => {
    if (!isAdmin) return;
    if (applyChanges && !window.confirm(
      "This will permanently DELETE all rows in incidents/problems/changes/requests whose IDs match the seed pattern (INC0001..9, PRB0001..9, CHG0001..9, REQ0001..9) and any problems linked to seed incidents. Continue?"
    )) return;
    setSeedCleanRunning(true);
    setSeedCleanResult(null);
    try {
      const r = await fetch("/api/db-clean-seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: applyChanges }),
      });
      const d = await r.json();
      setSeedCleanResult(d);
      if (!r.ok) {
        showToast?.(`Seed cleanup failed: ${d.error || r.status}`);
      } else {
        showToast?.(applyChanges
          ? `Deleted ${d.deleted || 0} seed-pattern rows`
          : `Dry-run: ${d.matchCount || 0} seed-pattern rows would be deleted`);
        if (applyChanges) loadSummary();
      }
    } catch (e) {
      showToast?.(`Seed cleanup failed: ${e.message}`);
    } finally {
      setSeedCleanRunning(false);
    }
  };

  const runAuditPurge = async () => {
    if (!isAdmin) return;
    setAuditPurgeRunning(true);
    setAuditPurgeResult(null);
    try {
      const r = await fetch("/api/admin/audit-purge-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      setAuditPurgeResult(d);
      if (!r.ok) {
        showToast?.(`Audit purge failed: ${d.error || r.status}`);
      } else {
        showToast?.(`Pruned ${d.deleted || 0} audit_log rows (kept ${d.keepDays}d)`);
        loadSummary();
      }
    } catch (e) {
      showToast?.(`Audit purge failed: ${e.message}`);
    } finally {
      setAuditPurgeRunning(false);
    }
  };

  if (!isAdmin) {
    return (
      <div style={{ padding: 24, color: COLORS?.subtle || "#5A6178" }}>
        Admin role required for data-hygiene operations.
      </div>
    );
  }

  const driftValues = summary?.priorityDrift?.byValue || {};
  const driftEntries = Object.entries(driftValues);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h3 style={sectionTitle}>AI Front Data Hygiene</h3>
          <div style={subText}>
            Surfaces orphaned AI side-effect rows, priority drift, and test-pattern incidents.
            All cleanups default to <strong style={{ color: "#FFB347" }}>dry-run</strong>.
          </div>
        </div>
        <button onClick={loadSummary} disabled={loading} style={{ ...btnStyle, padding: "6px 12px", fontSize: 11 }}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Apply-changes safety toggle */}
      <div style={{ ...card, display: "flex", alignItems: "center", gap: 10, borderColor: applyChanges ? "#FFB347" : "#1E2130" }}>
        <input
          id="dh-apply"
          type="checkbox"
          checked={applyChanges}
          onChange={(e) => setApplyChanges(e.target.checked)}
        />
        <label htmlFor="dh-apply" style={{ fontSize: 12, color: "#E8ECF4", cursor: "pointer" }}>
          <strong>Apply changes</strong> &mdash; when off (default), every action runs as a dry-run preview only.
          {applyChanges && (
            <span style={{ color: "#FFB347", marginLeft: 8 }}>⚠ Destructive actions enabled</span>
          )}
        </label>
      </div>

      {/* Summary stats */}
      {summary && (
        <div style={{ ...card }}>
          <h4 style={{ ...sectionTitle, fontSize: 12, marginBottom: 10 }}>Snapshot</h4>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {stat("Incidents", summary.incidents?.total ?? 0)}
            {stat("Orphan AI rows", summary.orphanedAiRows?.totalOrphaned ?? 0,
              (summary.orphanedAiRows?.totalOrphaned || 0) > 0 ? "#FF6B6B" : "#81C784")}
            {stat("Priority drift", summary.priorityDrift?.totalDrifted ?? 0,
              (summary.priorityDrift?.totalDrifted || 0) > 0 ? "#FFB347" : "#81C784")}
            {stat("Test-pattern hits", summary.testPatternIncidents?.count ?? 0,
              (summary.testPatternIncidents?.count || 0) > 0 ? "#FFB347" : "#81C784")}
            {stat("Audit rows", summary.auditLog?.totalRows ?? "—")}
          </div>
          <div style={{ ...subText, marginTop: 10 }}>
            Generated: {summary.generatedAt}
            {summary.auditLog?.retentionDays != null && (
              <> · audit retention: {summary.auditLog.retentionDays}d
                {summary.auditLog.purgeStatus?.lastRun && (
                  <> · last purge: {new Date(summary.auditLog.purgeStatus.lastRun).toLocaleString()}
                    {summary.auditLog.purgeStatus.lastResult?.deleted != null && (
                      <> ({summary.auditLog.purgeStatus.lastResult.deleted} deleted)</>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Priority drift action */}
      <div style={card}>
        <h4 style={{ ...sectionTitle, fontSize: 12, marginBottom: 6 }}>
          Priority normalization
        </h4>
        <div style={{ ...subText, marginBottom: 10 }}>
          Rewrites <code>incidents.priority</code> through the canonical Sev-A..D mapping.
          Only touches rows that aren&rsquo;t already canonical.
        </div>
        {driftEntries.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {driftEntries.map(([k, v]) => (
              <span key={k} style={{ background: "#1E2130", color: "#FFB347", padding: "3px 8px", borderRadius: 3, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                {k} × {v}
              </span>
            ))}
          </div>
        )}
        <button onClick={runNormalize} disabled={normRunning} style={{ ...btnStyle, padding: "6px 12px", fontSize: 11 }}>
          {normRunning ? "Running…" : applyChanges ? "Apply normalization" : "Dry-run normalize"}
        </button>
        {normResult && (
          <pre style={{ ...codeBox, marginTop: 10 }}>{JSON.stringify(normResult, null, 2)}</pre>
        )}
      </div>

      {/* Orphan purge action */}
      <div style={card}>
        <h4 style={{ ...sectionTitle, fontSize: 12, marginBottom: 6 }}>
          Orphaned AI side-effect rows
        </h4>
        <div style={{ ...subText, marginBottom: 10 }}>
          Removes <code>ai_actions</code> / <code>ai_resolve_queue</code> / <code>ai_triage_history</code>
          rows whose parent incident no longer exists. Only the IDs surfaced in the snapshot above are
          touched (max 25 per collection — refresh to load the next batch).
        </div>
        <button onClick={runOrphanPurge} disabled={purgeOrphansRunning || !summary} style={{ ...btnStyle, padding: "6px 12px", fontSize: 11 }}>
          {purgeOrphansRunning ? "Running…" : applyChanges ? "Purge orphan rows" : "Dry-run orphan purge"}
        </button>
        {orphanResult && (
          <pre style={{ ...codeBox, marginTop: 10 }}>{JSON.stringify(orphanResult, null, 2)}</pre>
        )}
      </div>

      {/* Seed-pattern cleanup (replaces former auto-call from SPA boot) */}
      <div style={card}>
        <h4 style={{ ...sectionTitle, fontSize: 12, marginBottom: 6 }}>
          Seed-pattern incidents / problems / changes / requests
        </h4>
        <div style={{ ...subText, marginBottom: 10 }}>
          Removes rows whose IDs match the demo-seed pattern
          (<code>INC0001..9</code>, <code>PRB0001..9</code>, <code>CHG0001..9</code>, <code>REQ0001..9</code>)
          plus any problems linked to seed incidents. Was previously fired automatically on every login;
          now admin-triggered so a real prod ticket that happens to collide with the pattern can be
          spotted in the dry-run before deletion.
        </div>
        <button onClick={runSeedClean} disabled={seedCleanRunning} style={{ ...btnStyle, padding: "6px 12px", fontSize: 11 }}>
          {seedCleanRunning ? "Running…" : applyChanges ? "Delete seed rows" : "Dry-run seed cleanup"}
        </button>
        {seedCleanResult && (
          <pre style={{ ...codeBox, marginTop: 10 }}>{JSON.stringify(seedCleanResult, null, 2)}</pre>
        )}
      </div>

      {/* Audit log retention purge (manual trigger of the scheduled job) */}
      <div style={card}>
        <h4 style={{ ...sectionTitle, fontSize: 12, marginBottom: 6 }}>
          Audit log retention
        </h4>
        <div style={{ ...subText, marginBottom: 10 }}>
          A scheduled job prunes <code>audit_log</code> rows older than the retention window
          (env <code>AUDIT_RETENTION_DAYS</code>, default 30) every 6 hours. This button runs
          the same prune immediately. Always destructive — no dry-run flag.
          {summary?.auditLog?.purgeStatus?.totalDeleted != null && (
            <> &nbsp;·&nbsp; lifetime pruned: {summary.auditLog.purgeStatus.totalDeleted} ({summary.auditLog.purgeStatus.runCount || 0} runs)</>
          )}
        </div>
        <button onClick={runAuditPurge} disabled={auditPurgeRunning} style={{ ...btnStyle, padding: "6px 12px", fontSize: 11 }}>
          {auditPurgeRunning ? "Running…" : "Run audit purge now"}
        </button>
        {auditPurgeResult && (
          <pre style={{ ...codeBox, marginTop: 10 }}>{JSON.stringify(auditPurgeResult, null, 2)}</pre>
        )}
      </div>

      {/* Test-pattern evidence (read-only) */}
      {summary?.testPatternIncidents?.count > 0 && (
        <div style={card}>
          <h4 style={{ ...sectionTitle, fontSize: 12, marginBottom: 6 }}>
            Test-pattern incident matches (evidence only)
          </h4>
          <div style={{ ...subText, marginBottom: 10 }}>
            Heuristic match on title/id keywords (test, sample, demo, e2e, seed, fixture).
            <strong> Not auto-deleted.</strong> Review and use <code>POST /api/purge-test-data</code> with
            an explicit ID list if any of these are real waste.
          </div>
          <pre style={codeBox}>{JSON.stringify(summary.testPatternIncidents.sample, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default DataHygieneTab;
