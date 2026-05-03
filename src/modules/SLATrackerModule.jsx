import { useState, useMemo } from "react";
import {
  COLORS, PRIORITY_COLORS, STATUS_COLORS, inputStyle, btnStyle,
} from "../constants/theme.js";
import {
  STATUS, OPEN_STATUSES, SLA_TARGETS,
} from "../constants/status.js";
import { APP_VERSION } from "../constants/version.js";
import {
  computeIncidentSla, formatSlaCountdown, getBusinessHoursElapsed,
} from "../utils/slaHelpers.js";
import {
  Badge, PriorityDot, StatCard, DataTable, SearchBar, useStableComponent,
} from "../components/SharedComponents.jsx";

// SLA Tracker — extracted from itsm-tool.jsx
export default function SLATrackerModule({ ctx }) {
  const {
    incidents, slaPolicy, currentUser, showToast, search, setSearch,
    setIncidents = () => {},
    setActiveModule = () => {},
    requests = [],
    changes = [],
    problems = [],
    zdConnected = false,
    runSlaPrediction = () => {},
    slaPredictions = [],
  } = ctx;

// ─── SLA Tracker ──────────────────────────────────────────────────────
const SLAModule = useStableComponent(() => {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- hooks inside useStableComponent render callback are valid
  const [slaRefreshing, setSlaRefreshing] = useState(false);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [slaLastSync, setSlaLastSync] = useState(null);
  // Phase 8 — tighten SLA scope. Exclude:
  // - already Resolved/Closed/Cancelled
  // - historicalClose / archived flags (defensive — should already be Closed)
  // - genuine orphans: no Zendesk link AND >90 days old AND empty activity
  //   log. These are stale ITSM rows that were never linked to anything
  //   real and skew the compliance metric.
  const NINETY_DAYS_MS = 90 * 86400000;
  const isOrphan = (i) => {
    if (i.zdTicketId) return false;
    const created = new Date(i.createdAt || i.created || 0);
    if (isNaN(created.getTime())) return true;
    if (Date.now() - created.getTime() < NINETY_DAYS_MS) return false;
    const acts = Array.isArray(i.activityLog) ? i.activityLog : [];
    return acts.length === 0;
  };
  const allOpenIncidents = incidents.filter(i => i.status !== "Resolved" && i.status !== "Closed" && i.status !== "Cancelled");
  const excludedHistorical = allOpenIncidents.filter(i => i.historicalClose || i.archived).length;
  const excludedOrphans = allOpenIncidents.filter(i => !i.historicalClose && !i.archived && isOrphan(i)).length;
  const activeInc = allOpenIncidents.filter(i =>
    !i.historicalClose && !i.archived && !isOrphan(i) && computeIncidentSla(i).hasValidSla
  );
  // Unified SLA calculation via computeIncidentSla helper
  const getElapsed = (inc) => computeIncidentSla(inc).hoursElapsed;
  const getRemaining = (inc) => computeIncidentSla(inc).remainingHours;
  const getSlaPercent = (inc) => computeIncidentSla(inc).pctUsed;
  const isSlaCompliant = (inc) => !computeIncidentSla(inc).isBreached;

  const refreshSlaFromZendesk = async () => {
    // (#4 follow-up, 2026-05-03) demo-mode guard removed; isLocalDemoUser was always false.
    setSlaRefreshing(true);
    try {
      await fetch("/api/zendesk/incremental-sync", { method: "POST" });
      const r = await fetch("/api/db/incidents");
      if (r.ok) {
        const data = await r.json();
        const items = Array.isArray(data) ? data.map(d => typeof d.data === "string" ? JSON.parse(d.data) : (d.data || d)) : (data.data || []);
        const seedPattern = /^(INC000|PRB000)\d$/;
        const prodItems = items.filter(item => !seedPattern.test(item.id));
        if (prodItems.length > 0) setIncidents(prodItems);
      }
      setSlaLastSync(new Date());
      showToast("SLA data refreshed from Zendesk", "success");
    } catch (e) { showToast("Failed to refresh: " + e.message, "error"); }
    setSlaRefreshing(false);
  };

  const compliant = activeInc.filter(isSlaCompliant).length;
  const total = activeInc.length;
  const compliancePct = total > 0 ? Math.round((compliant / total) * 100) : 100;
  const firstResponseMet = activeInc.filter(i => i.firstResponseTime != null && slaPolicy.severities[i.priority] && i.firstResponseTime <= slaPolicy.severities[i.priority].firstResponse).length;
  const firstResponseTotal = activeInc.filter(i => i.firstResponseTime != null).length;
  const firstResponsePct = firstResponseTotal > 0 ? Math.round((firstResponseMet / firstResponseTotal) * 100) : 100;

  const byPriority = ["Sev-A", "Sev-B", "Sev-C", "Sev-D"].map(p => {
    const items = activeInc.filter(i => i.priority === p);
    const met = items.filter(isSlaCompliant).length;
    const sev = slaPolicy.severities[p];
    return { priority: p, total: items.length, met, pct: items.length > 0 ? Math.round((met / items.length) * 100) : 100, firstResponse: sev?.firstResponse, worstResponse: sev?.worstResponse, definition: sev?.definition };
  });

  return (
    <div>
      {/* VGC SLA Policy Banner */}
      <div style={{ background: "linear-gradient(135deg, #6366F110, #06B6D410)", borderRadius: 8, border: "1px solid #6366F133", padding: "14px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 18 }}>📋</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>VGC Technology Helpdesk SLA Policy</div>
          <div style={{ fontSize: 11, color: "#8B92A8", marginTop: 2 }}>Business Hours: Mon–Fri 9:00 AM – 6:00 PM (SGT) · Channels: Email, Phone, Portal, Chat</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {slaLastSync && <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>Synced: {slaLastSync.toLocaleTimeString("en-SG", { hour12: false, timeZone: "Asia/Singapore" })}</span>}
          <button style={{ ...btnStyle("#6366F1"), fontSize: 11, padding: "6px 14px", opacity: slaRefreshing ? 0.6 : 1 }} onClick={refreshSlaFromZendesk} disabled={slaRefreshing}>
            {slaRefreshing ? "⏳ Syncing..." : "🔄 Refresh from Zendesk"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 24 }}>
        <StatCard label="Overall SLA Compliance" value={`${compliancePct}%`} icon="📊" accent={compliancePct >= 90 ? "#4CAF50" : compliancePct >= 70 ? "#FFB347" : "#FF4444"} onClick={() => setActiveModule("incidents")} />
        <StatCard label="First Response SLA" value={`${firstResponsePct}%`} icon="⚡" accent={firstResponsePct >= 90 ? "#4CAF50" : firstResponsePct >= 70 ? "#FFB347" : "#FF4444"} onClick={() => setActiveModule("incidents")} />
        <StatCard label="Active Tickets" value={total} icon="🎫" accent="#64B5F6" onClick={() => setActiveModule("incidents")} />
        <StatCard label="SLA Met" value={compliant} icon="✅" accent="#4CAF50" onClick={() => setActiveModule("incidents")} />
        <StatCard label="SLA Breached" value={total - compliant} icon="🚨" accent="#FF4444" onClick={() => setActiveModule("incidents")} />
      </div>
      {(excludedHistorical > 0 || excludedOrphans > 0) && (
        <div style={{ fontSize: 11, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginTop: -16, marginBottom: 18, paddingLeft: 4 }}>
          Scope: counting <span style={{ color: "#64B5F6" }}>{total}</span> active ticket{total !== 1 ? "s" : ""}
          {excludedOrphans > 0 && <> · excluding <span style={{ color: "#8B92A8" }}>{excludedOrphans}</span> orphan{excludedOrphans !== 1 ? "s" : ""} (&gt;90d, no Zendesk link)</>}
          {excludedHistorical > 0 && <> · <span style={{ color: "#8B92A8" }}>{excludedHistorical}</span> historically closed</>}
        </div>
      )}

      {/* Severity SLA Targets Overview */}
      <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>⏱️ SLA Targets by Severity (Business Hours)</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {byPriority.map(bp => {
            const col = PRIORITY_COLORS[bp.priority]?.dot || "#5A6178";
            return (
              <div key={bp.priority} style={{ background: "#0A0C14", borderRadius: 8, border: `1px solid ${col}33`, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: col, boxShadow: `0 0 6px ${col}66` }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: col, fontFamily: "'Space Grotesk', sans-serif" }}>{bp.priority}</span>
                </div>
                <div style={{ fontSize: 11, color: "#8B92A8", marginBottom: 4 }}>{bp.definition}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
                  <div style={{ background: "#0F1117", borderRadius: 4, padding: "6px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase", marginBottom: 2 }}>First Response</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4", fontFamily: "'JetBrains Mono', monospace" }}>{bp.firstResponse}h</div>
                  </div>
                  <div style={{ background: "#0F1117", borderRadius: 4, padding: "6px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase", marginBottom: 2 }}>Worst Response</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4", fontFamily: "'JetBrains Mono', monospace" }}>{bp.worstResponse}h</div>
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#5A6178", marginBottom: 3 }}>
                    <span>{bp.total} ticket{bp.total !== 1 ? "s" : ""}</span>
                    <span style={{ color: bp.pct >= 90 ? "#4CAF50" : bp.pct >= 70 ? "#FFB347" : "#FF4444", fontWeight: 600 }}>{bp.pct}% met</span>
                  </div>
                  <div style={{ background: "#0F1117", borderRadius: 3, height: 4, overflow: "hidden" }}>
                    <div style={{ width: `${bp.pct}%`, height: "100%", background: bp.pct >= 90 ? "#4CAF50" : bp.pct >= 70 ? "#FFB347" : "#FF4444", borderRadius: 3 }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>Detailed Incident SLA Status</h3>
        <DataTable
          columns={[
            { label: "ID", key: "id", mono: true, minWidth: 90, render: r => <span style={{ color: r.zdTicketId ? "#EC4899" : "#64B5F6" }}>{r.id}{r.zdTicketId ? " 🎫" : ""}</span> },
            { label: "Title", key: "title", maxWidth: 300, wrap: true },
            { label: "Severity", render: r => <PriorityDot priority={r.priority} /> },
            { label: "1st Resp", render: r => {
              const sev = slaPolicy.severities[r.priority];
              const target = sev?.firstResponse;
              const actual = r.firstResponseTime;
              if (actual == null) return <span style={{ fontSize: 11, color: "#5A6178" }}>Pending</span>;
              const met = actual <= target;
              return <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600, color: met ? "#4CAF50" : "#FF4444" }}>{actual}h / {target}h</span>;
            }},
            { label: "Elapsed", render: r => {
              const el = getElapsed(r);
              return <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#C4CAD6" }}>{el.toFixed(1)}h</span>;
            }},
            { label: "SLA Target", render: r => <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#C4CAD6" }}>{r.slaTarget}h</span> },
            { label: "Remaining", render: r => {
              const rem = getRemaining(r);
              const col = rem <= 0 ? "#FF4444" : rem <= 1 ? "#FF6B6B" : rem <= 2 ? "#FFB347" : "#81C784";
              return <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600, color: col }}>
                {formatSlaCountdown(rem)}
              </span>;
            }},
            { label: "Source", render: r => r.zdTicketId ? <Badge color={{ bg: "#2D0A2D", text: "#EC4899" }}>Zendesk</Badge> : <Badge color={{ bg: "#0D2137", text: "#64B5F6" }}>ITSM</Badge> },
            { label: "Status", render: r => {
              const pct = getSlaPercent(r);
              return <Badge color={pct >= 100 ? PRIORITY_COLORS["Sev-A"] : pct >= 75 ? PRIORITY_COLORS["Sev-B"] : PRIORITY_COLORS["Sev-D"]}>
                {pct >= 100 ? "BREACHED" : pct >= 75 ? "AT RISK" : "ON TRACK"}
              </Badge>;
            }},
          ]}
          data={activeInc}
        />
      </div>

      {/* Service Request SLA Tracking */}
      {(() => {
        const activeReqs = requests.filter(r => r.status !== "Fulfilled" && r.status !== "Closed");
        const reqCompliant = activeReqs.filter(r => r.slaTarget && r.createdAt ? getBusinessHoursElapsed(r.createdAt) <= r.slaTarget : r.slaTarget && r.created <= r.slaTarget).length;
        const reqTotal = activeReqs.length;
        const reqPct = reqTotal > 0 ? Math.round((reqCompliant / reqTotal) * 100) : 100;
        return reqTotal > 0 ? (
          <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #81C78433", padding: 20, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>📋 Service Request SLA Tracking</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{reqCompliant}/{reqTotal} within SLA</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: reqPct >= 90 ? "#4CAF50" : reqPct >= 70 ? "#FFB347" : "#FF4444", fontFamily: "'JetBrains Mono', monospace" }}>{reqPct}%</span>
              </div>
            </div>
            <DataTable
              columns={[
                { label: "ID", key: "id", mono: true, render: r => <span style={{ color: "#81C784" }}>{r.id}</span> },
                { label: "Service", key: "service" },
                { label: "Priority", render: r => <PriorityDot priority={r.priority} /> },
                { label: "Requester", key: "requester" },
                { label: "Customer", render: r => <span style={{ color: "#A0AEC0", fontSize: 11 }}>{r.customer || "—"}</span> },
                { label: "Elapsed", render: r => {
                  const el = r.createdAt ? getBusinessHoursElapsed(r.createdAt) : (r.created || 0);
                  return <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#C4CAD6" }}>{el.toFixed(1)}h</span>;
                }},
                { label: "SLA Target", render: r => <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#C4CAD6" }}>{r.slaTarget || "—"}h</span> },
                { label: "Status", render: r => {
                  if (!r.slaTarget) return <Badge color={STATUS_COLORS[r.status]}>{r.status}</Badge>;
                  const el = r.createdAt ? getBusinessHoursElapsed(r.createdAt) : (r.created || 0);
                  const pct = Math.round((el / r.slaTarget) * 100);
                  return <Badge color={pct >= 100 ? PRIORITY_COLORS["Sev-A"] : pct >= 75 ? PRIORITY_COLORS["Sev-B"] : PRIORITY_COLORS["Sev-D"]}>
                    {pct >= 100 ? "BREACHED" : pct >= 75 ? "AT RISK" : "ON TRACK"}
                  </Badge>;
                }},
              ]}
              data={activeReqs}
            />
          </div>
        ) : null;
      })()}

      {/* Change Request SLA */}
      {(() => {
        const pendingChanges = changes.filter(c => !["Closed", "Implemented"].includes(c.status));
        return pendingChanges.length > 0 ? (
          <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #FFB34733", padding: 20, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>🔄 Change Request SLA</h3>
              <span style={{ fontSize: 10, color: "#FFB347", fontFamily: "'JetBrains Mono', monospace" }}>{pendingChanges.filter(c => c.status === "Awaiting Approval").length} awaiting approval</span>
            </div>
            <DataTable
              columns={[
                { label: "ID", key: "id", mono: true, render: r => <span style={{ color: "#FFB347" }}>{r.id}</span> },
                { label: "Title", key: "title" },
                { label: "Type", render: r => <Badge color={r.type === "Emergency" ? PRIORITY_COLORS["Sev-A"] : { bg: "#0D2137", text: "#64B5F6" }}>{r.type}</Badge> },
                { label: "Risk", render: r => <Badge color={PRIORITY_COLORS[r.risk === "High" ? "Sev-A" : r.risk === "Medium" ? "Sev-B" : "Sev-D"]}>{r.risk}</Badge> },
                { label: "Status", render: r => <Badge color={STATUS_COLORS[r.status]}>{r.status}</Badge> },
                { label: "Scheduled", render: r => <span style={{ fontSize: 11, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{r.scheduledStart || "—"}</span> },
                { label: "Approvers", render: r => (
                  <div style={{ display: "flex", gap: 4 }}>
                    {(r.approvers || []).map((a, i) => (
                      <span key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: a.status === "Approved" ? "#4CAF50" : a.status === "Rejected" ? "#FF4444" : "#FFB347" }} title={`${a.name}: ${a.status}`} />
                    ))}
                  </div>
                )},
              ]}
              data={pendingChanges}
            />
          </div>
        ) : null;
      })()}

      {/* Zendesk SLA Integration */}
      <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #EC489933", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>🎫 Zendesk ↔ ITSM SLA Cross-Reference</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {zdConnected && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4CAF50", boxShadow: "0 0 6px #4CAF5066" }} />}
            <span style={{ fontSize: 10, color: zdConnected ? "#4CAF50" : "#FF6B6B", fontFamily: "'JetBrains Mono', monospace" }}>{zdConnected ? "Connected" : "Not connected"}</span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
          {[
            { label: "ITSM Incidents", value: incidents.length, color: "#64B5F6", icon: "📊" },
            { label: "ZD-Linked", value: incidents.filter(i => i.zdTicketId).length, color: "#EC4899", icon: "🔗" },
            { label: "SLA Compliant", value: `${compliancePct}%`, color: compliancePct >= 90 ? "#4CAF50" : "#FFB347", icon: "✅" },
            { label: "Active Requests", value: requests.filter(r => r.status !== "Fulfilled" && r.status !== "Closed").length, color: "#81C784", icon: "📋" },
            { label: "Pending Approvals", value: changes.filter(c => c.status === "Awaiting Approval").length + requests.filter(r => r.status === "Pending Approval").length, color: "#FFB347", icon: "⏳" },
            { label: "Problems Open", value: problems.filter(p => !["Resolved","Closed"].includes(p.status)).length, color: "#CE93D8", icon: "🔍" },
          ].map((s, i) => (
            <div key={i} style={{ padding: "10px 12px", background: "#0A0C14", borderRadius: 6, border: `1px solid ${s.color}22` }}>
              <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: "'Space Grotesk', sans-serif" }}>{s.value}</div>
            </div>
          ))}
        </div>
        {!zdConnected && (
          <div style={{ padding: "16px 20px", background: "#FF6B6B08", borderRadius: 8, border: "1px solid #FF6B6B22", textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "#FF6B6B", marginBottom: 4 }}>Zendesk not connected</div>
            <div style={{ fontSize: 11, color: "#5A6178" }}>Go to <span style={{ color: "#EC4899", cursor: "pointer", textDecoration: "underline" }} onClick={() => setActiveModule("zendesk")}>Zendesk AI Command Center</span> to connect and enable real-time SLA sync</div>
          </div>
        )}
        {zdConnected && (
          <div style={{ padding: "12px 16px", background: "#4CAF5008", borderRadius: 8, border: "1px solid #4CAF5022" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 10, color: "#4CAF50", fontFamily: "'JetBrains Mono', monospace" }}>✅ Zendesk SLA data synced — auto-triage every 2min</span>
              <span style={{ marginLeft: "auto", fontSize: 9, color: "#5A617866" }}>Linked incidents inherit Zendesk ticket SLA timers</span>
            </div>
          </div>
        )}
      </div>

      {/* AI SLA Predictions */}
      <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, marginTop: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
            🔮 AI SLA Breach Predictions
          </h3>
          <button onClick={runSlaPrediction} style={{ ...btnStyle("#EC4899"), fontSize: 10, padding: "5px 12px" }}>⚡ Run Prediction</button>
        </div>
        {slaPredictions.length === 0 ? (
          <div style={{ textAlign: "center", padding: 20, color: "#5A6178", fontSize: 11 }}>No SLA predictions yet — click "Run Prediction" to analyze open tickets</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {slaPredictions.map((pred, idx) => (
              <div key={idx} style={{ background: "#0A0C14", borderRadius: 8, border: `1px solid ${pred.breachProbability >= 90 ? "#FF444444" : pred.breachProbability >= 70 ? "#FFB34744" : "#6366F133"}`, padding: "12px 16px", display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ fontSize: 22, width: 44, height: 44, borderRadius: 10, background: pred.breachProbability >= 90 ? "#FF444422" : pred.breachProbability >= 70 ? "#FFB34722" : "#FFD70022", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {pred.breachProbability >= 90 ? "🔴" : pred.breachProbability >= 70 ? "🟠" : "🟡"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#E8ECF4" }}>{pred.ticketId} — {pred.breachProbability}% breach risk</div>
                  <div style={{ fontSize: 10, color: "#8B92A8", marginTop: 2 }}>{pred.reasoning}</div>
                  <div style={{ display: "flex", gap: 10, marginTop: 4, fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>
                    <span style={{ color: "#FF6B6B" }}>⏱ Breach in: {pred.predictedBreachIn}</span>
                    <span style={{ color: "#06B6D4" }}>📋 Action: {pred.suggestedAction}</span>
                    {pred.escalationTarget && <span style={{ color: "#FFB347" }}>👤 Escalate to: {pred.escalationTarget}</span>}
                  </div>
                </div>
                <div style={{ width: 50, height: 50, borderRadius: "50%", background: `conic-gradient(${pred.breachProbability >= 90 ? "#FF4444" : pred.breachProbability >= 70 ? "#FFB347" : "#FFD700"} ${pred.breachProbability * 3.6}deg, #1E2130 0deg)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#E8ECF4", fontFamily: "'JetBrains Mono', monospace" }}>{pred.breachProbability}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
return <SLAModule />;
}
