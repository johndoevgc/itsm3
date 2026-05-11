import React, { useState, useMemo } from "react";
import { PRIORITY_COLORS, STATUS_COLORS, inputStyle, btnStyle } from "../constants/theme.js";
import { APP_VERSION } from "../constants/version.js";
import { genId, timeAgo } from "../utils/slaHelpers.js";
import {
  Badge, PriorityDot, DataTable, WorkflowHeader, SearchBar, useStableComponent,
} from "../components/SharedComponents.jsx";

// Incidents Module — extracted from itsm-tool.jsx
/* ─── Inline HTML sanitizer (XSS-safe allowlist) ────────────────────── */
const ALLOWED_TAGS = /^(p|br|b|i|strong|em|ul|ol|li|a|h[1-6]|div|span|table|thead|tbody|tr|td|th|hr|img)$/i;
const ALLOWED_ATTRS = { a: ["href", "target"], img: ["src", "alt", "width", "height"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"], "*": ["style"] };
function sanitizeHtml(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  function walk(node) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) continue; // text
      if (child.nodeType !== 1) { child.remove(); continue; }
      if (!ALLOWED_TAGS.test(child.tagName)) { child.replaceWith(...child.childNodes); continue; }
      const allowed = [...(ALLOWED_ATTRS[child.tagName.toLowerCase()] || []), ...(ALLOWED_ATTRS["*"] || [])];
      for (const attr of Array.from(child.attributes)) { if (!allowed.includes(attr.name)) child.removeAttribute(attr.name); }
      if (child.tagName === "A") { child.setAttribute("target", "_blank"); child.setAttribute("rel", "noopener noreferrer"); }
      walk(child);
    }
  }
  walk(doc.body);
  return doc.body.innerHTML;
}

/* ─── Rejection reason presets ──────────────────────────────────────── */
const REJECTION_REASONS = [
  "Incorrect diagnosis",
  "Wrong customer / incident",
  "Resolution incomplete",
  "Needs human escalation",
  "Duplicate suggestion",
  "Other",
];

export default function IncidentsModule({ ctx }) {
  const {
    incidents, setIncidents, search, setSearch, currentUser, showToast,
    _save, setDetailItem, setModal, setActiveModule,
    computeIncidentSlaFn: _computeIncidentSlaFn, users,
    aiResolveQueue, aiResolveFilter, setAiResolveFilter, aiResolveLoading,
    aiBulkDismissLoading, aiBulkApproveLoading,
    handleAiResolveAction, handleBulkDismiss, handleBulkApprove,
    runAiAutoResolve, aiResolveScanLoading,
    aiWorkflowQueue, aiWorkflowLoading, handleAiWorkflowAction,
    runAiWorkflowAssist, aiWorkflowScanLoading,
    historicalCloseRunning, runBulkCloseTickets,
    runAiAutoFollowUp, aiFollowUpLoading,
    runCleanupQueue, cleanupLoading,
    zdStats = { open: 0, pending: 0, hold: 0, solved: 0 },
    globalSyncActive = false,
    globalLastSync = null,
  } = ctx;
  const [dupScanning, setDupScanning] = useState(false);
  const [dupGroups, setDupGroups] = useState([]);
  const [showDupPanel, setShowDupPanel] = useState(false);
  const [dupMerging, setDupMerging] = useState(false);

const STATUS_SORT_ORDER = { "New": 0, "Open": 1, "In Progress": 2, "Pending": 3, "On Hold": 4, "Reopened": 5, "Resolved": 6, "Closed": 7 };
const IncidentsModule = useStableComponent(() => {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- hooks inside useStableComponent render callback are valid
  const [selectedIds, setSelectedIds] = useState(new Set());
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [bulkAction, setBulkAction] = useState(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [bulkValue, setBulkValue] = useState("");
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [bulkProcessing, setBulkProcessing] = useState(false);
  // ─── AI queue local UI state ──────────────────────────────────────
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [editingId, setEditingId] = useState(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [editResolution, setEditResolution] = useState(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [editEmail, setEditEmail] = useState(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [editConsultedBy, setEditConsultedBy] = useState("");
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [rejectingId, setRejectingId] = useState(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [rejectReason, setRejectReason] = useState("");
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [rejectFreetext, setRejectFreetext] = useState("");
  // Bulk approve RACI prompt
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [bulkApprovePromptOpen, setBulkApprovePromptOpen] = useState(false);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [bulkConsultedBy, setBulkConsultedBy] = useState("");
  // Phase S1d — defer filter computation so commits don't block typing
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const deferredSearch = React.useDeferredValue(search);
  // eslint-disable-next-line react-hooks/rules-of-hooks, react-hooks/exhaustive-deps
  const filtered = useMemo(() => {
    const q = (deferredSearch || "").toLowerCase();
    const list = q ? incidents.filter(i =>
      (i.title || "").toLowerCase().includes(q) ||
      (i.id || "").toLowerCase().includes(q) ||
      (i.category || "").toLowerCase().includes(q)
    ) : incidents.slice();
    return list.sort((a, b) => {
      const sa = STATUS_SORT_ORDER[a.status] ?? 5;
      const sb = STATUS_SORT_ORDER[b.status] ?? 5;
      if (sa !== sb) return sa - sb;
      const da = new Date(a.createdAt || a.created || 0).getTime();
      const db = new Date(b.createdAt || b.created || 0).getTime();
      if (da !== db) return db - da;
      return (a.id || "").localeCompare(b.id || "");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidents, deferredSearch]);
  return (
    <div>
      <WorkflowHeader module="incidents" version={APP_VERSION.version} stepCounts={[incidents.filter(i => i.status === "Open" && !i.aiTriaged).length, incidents.filter(i => i.aiTriaged && i.status === "Open").length, incidents.filter(i => i.assignee && ["Open","Assigned"].includes(i.status)).length, incidents.filter(i => i.status === "In Progress").length, incidents.filter(i => i.status === "Resolved" || i.status === "Closed").length]} />
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <SearchBar value={search} onChange={setSearch} placeholder="Search incidents..." />
        <button style={btnStyle()} onClick={() => setModal("newIncident")}>+ New Incident</button>
        <button style={{ ...btnStyle("#0EA5E9"), fontSize: 11, display: "flex", alignItems: "center", gap: 4 }} onClick={() => window.open("/api/export/incidents?format=csv", "_blank")}>📥 Export CSV</button>
        <button style={{ ...btnStyle("#EC4899"), fontSize: 11, display: "flex", alignItems: "center", gap: 4 }} onClick={() => {
          // (#4 follow-up, 2026-05-03) demo-mode guard removed; isLocalDemoUser was always false.
          fetch("/api/zendesk/tickets").then(r => r.json()).then(data => {
            const tickets = data.tickets || [];
            if (tickets.length === 0) return;
            const priorityMap = { "urgent": "Sev-A", "high": "Sev-B", "normal": "Sev-C", "low": "Sev-D" };
            const statusMap = { "new": "New", "open": "Open", "pending": "Pending", "hold": "On Hold", "solved": "Resolved", "closed": "Closed" };
            let imported = 0;
            tickets.forEach(t => {
              const exists = incidents.some(i => String(i.zdTicketId) === String(t.id) || i.id === `INC-ZD${t.id}`);
              if (!exists && t.status !== "closed") {
                imported++;
                const newInc = {
                  id: genId("INC"), title: t.subject || "Untitled", description: t.description || "",
                  category: (t.tags || [])[0] || "General", subcategory: "",
                  priority: priorityMap[t.priority] || "Sev-C", urgency: t.priority === "urgent" ? "Critical" : "Standard",
                  status: statusMap[t.status] || "New", assignee: currentUser.name,
                  assignmentGroup: "Service Desk", reporter: "Zendesk Import",
                  reporterName: "", reporterEmail: "", reporterRole: "",
                  customer: "", customerContact: "", customerPhone: "", customerAddress: "",
                  contactMethod: "Zendesk", impact: t.priority === "urgent" ? "Enterprise" : "Individual",
                  affectedService: "", affectedAsset: "", location: "",
                  created: Math.round((Date.now() - new Date(t.created_at).getTime()) / 3600000),
                  slaTarget: t.priority === "urgent" ? 4 : t.priority === "high" ? 8 : 24,
                  firstResponseTime: null, aiTriaged: false, aiConfidence: 0,
                  workaround: "", linkedProblem: "", linkedChange: "",
                  affectedAssets: [], zdTicketId: t.id,
                  activityLog: [{ id: genId("AL"), type: "sync", user: "Zendesk", time: new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }).replace(",", ""), detail: `Imported from Zendesk ticket #${t.id}` }]
                };
                setIncidents(prev => [newInc, ...prev]);
              }
            });
            if (imported > 0) showToast(`✅ Imported ${imported} ticket${imported === 1 ? "" : "s"} from Zendesk`, "success");
          }).catch(() => {});
        }}>🎫 Import from Zendesk</button>
        <button style={{ ...btnStyle("#4CAF50"), fontSize: 11, display: "flex", alignItems: "center", gap: 4 }} onClick={async () => {
          showToast("⏳ Syncing all statuses with Zendesk...", "info");
          try {
            const resp = await fetch("/api/zendesk/sync-all-statuses", { method: "POST" });
            const data = await resp.json();
            if (data.success) {
              showToast(`✅ Sync complete: ${data.cleaned} stale cleaned, ${data.updated} updated, ${data.alreadyMatched} matched`, "success");
              // Refresh incidents from server
              fetch("/api/db/incidents").then(r => r.json()).then(r => { if (r.data) setIncidents(r.data); }).catch(() => {});
            } else {
              showToast(`❌ Sync failed: ${data.error || "Unknown"}`, "error");
            }
          } catch (err) { showToast(`❌ Sync error: ${err.message}`, "error"); }
        }}>🔄 Sync & Align Statuses</button>
        <button style={{ ...btnStyle("#F59E0B"), fontSize: 11, display: "flex", alignItems: "center", gap: 4, position: "relative" }} onClick={async () => {
          setDupScanning(true);
          try {
            const resp = await fetch("/api/incidents/duplicates");
            const data = await resp.json();
            setDupGroups(data.groups || []);
            if ((data.groups || []).length > 0) {
              setShowDupPanel(true);
              showToast(`🔍 Found ${data.groups.length} potential duplicate group(s)`, "warning");
            } else {
              showToast("✅ No duplicate incidents detected", "success");
            }
          } catch (err) { showToast(`❌ Scan failed: ${err.message}`, "error"); }
          setDupScanning(false);
        }} disabled={dupScanning}>
          {dupScanning ? "⏳ Scanning..." : "🔍 Scan Duplicates"}
          {dupGroups.length > 0 && !dupScanning && <span style={{ position: "absolute", top: -6, right: -6, background: "#FF4444", color: "#fff", fontSize: 9, fontWeight: 700, borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>{dupGroups.length}</span>}
        </button>
        <button style={{ ...btnStyle("#E91E63"), fontSize: 11, display: "flex", alignItems: "center", gap: 4 }} onClick={async () => {
          showToast("⏳ Scanning for Zendesk duplicate incidents...", "info");
          try {
            const resp = await fetch("/api/incidents/dedup-by-zdticketid", { method: "POST" });
            const data = await resp.json();
            if (data.success && data.totalMerged > 0) {
              showToast(`✅ Cleaned ${data.totalMerged} duplicate(s) across ${data.groupsFound} Zendesk ticket(s)`, "success");
              fetch("/api/db/incidents").then(r => r.json()).then(r => { if (r.data) setIncidents(r.data); }).catch(() => {});
            } else if (data.success) {
              showToast("✅ No Zendesk duplicate incidents found", "success");
            } else {
              showToast(`❌ Dedup failed: ${data.error || "Unknown"}`, "error");
            }
          } catch (err) { showToast(`❌ ${err.message}`, "error"); }
        }}>🧹 Clean ZD Duplicates</button>
      </div>
      {/* Zendesk ↔ ITSM Quick Summary */}
      <div style={{ display: "flex", gap: 12, marginBottom: 14, padding: "8px 14px", background: "#0F1117", borderRadius: 8, border: "1px solid #1E213044", alignItems: "center", flexWrap: "wrap" }}>
        {[
          { label: "Total ITSM", value: incidents.length, color: "#6366F1" },
          { label: "Open", value: incidents.filter(i => !["Resolved","Closed"].includes(i.status)).length, color: "#FF6B6B" },
          { label: "Resolved", value: incidents.filter(i => i.status === "Resolved" || i.status === "Closed").length, color: "#81C784" },
          { label: "From Zendesk", value: incidents.filter(i => i.zdTicketId).length, color: "#EC4899" },
          { label: "AI Triaged", value: incidents.filter(i => i.aiTriaged).length, color: "#06B6D4" },
        ].map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{s.label}:</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: s.color, fontFamily: "'Space Grotesk', sans-serif" }}>{s.value}</span>
            {i < 4 && <span style={{ color: "#1E2130", margin: "0 4px" }}>|</span>}
          </div>
        ))}
        {(zdStats?.open || 0) + (zdStats?.pending || 0) > 0 && <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: "#FFB347", fontFamily: "'JetBrains Mono', monospace" }}>Zendesk Live: {zdStats?.open || 0} open · {zdStats?.pending || 0} pending</span>
          {globalSyncActive && <span style={{ fontSize: 8, color: "#06B6D4", animation: "pulse 1s infinite" }}>⟳</span>}
          {globalLastSync && <span style={{ fontSize: 8, color: "#5A617866", fontFamily: "'JetBrains Mono', monospace" }}>Synced {globalLastSync.toLocaleTimeString("en-SG", { hour12: false })}</span>}
        </div>}
      </div>

      {/* ─── Proactive Duplicate Alert Banner ───────────────────── */}
      {dupGroups.length > 0 && !showDupPanel && (
        <div onClick={() => setShowDupPanel(true)} style={{ cursor: "pointer", marginBottom: 14, padding: "10px 16px", background: "linear-gradient(135deg, #1A0E0011, #F59E0B11)", borderRadius: 8, border: "1px solid #F59E0B44", display: "flex", alignItems: "center", gap: 10, transition: "border-color 0.2s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor = "#F59E0B88"} onMouseLeave={e => e.currentTarget.style.borderColor = "#F59E0B44"}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#F59E0B", fontFamily: "'Space Grotesk', sans-serif" }}>
              {dupGroups.length} Potential Duplicate Group{dupGroups.length > 1 ? "s" : ""} Detected
            </span>
            <span style={{ fontSize: 10, color: "#5A6178", marginLeft: 8 }}>Click to review and merge</span>
          </div>
          <span style={{ fontSize: 10, color: "#F59E0B", fontFamily: "'JetBrains Mono', monospace" }}>Review →</span>
        </div>
      )}

      {/* ─── Duplicate Detection & Merge Panel ─────────────────── */}
      {showDupPanel && dupGroups.length > 0 && (
        <div style={{ marginBottom: 16, background: "linear-gradient(135deg, #0F1117 0%, #1A1205 100%)", borderRadius: 10, border: "1px solid #F59E0B44", padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 13, color: "#F59E0B", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
              🔍 Duplicate Detection & Merge
              <span style={{ fontSize: 10, background: "#F59E0B33", color: "#F59E0B", padding: "2px 8px", borderRadius: 10 }}>{dupGroups.length} group{dupGroups.length > 1 ? "s" : ""}</span>
            </h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={async () => {
                setDupScanning(true);
                try {
                  const resp = await fetch("/api/incidents/duplicates");
                  const data = await resp.json();
                  setDupGroups(data.groups || []);
                  if ((data.groups || []).length === 0) { setShowDupPanel(false); showToast("✅ No duplicates remaining", "success"); }
                  else showToast(`🔍 Refreshed: ${data.groups.length} group(s)`, "info");
                } catch (err) { showToast(`❌ ${err.message}`, "error"); }
                setDupScanning(false);
              }} style={{ ...btnStyle("#0EA5E9"), fontSize: 10, padding: "4px 10px" }}>🔄 Refresh</button>
              <button onClick={() => setShowDupPanel(false)} style={{ ...btnStyle("#5A6178"), fontSize: 10, padding: "4px 10px" }}>✕ Close</button>
            </div>
          </div>
          {dupGroups.map((group, gi) => (
            <div key={gi} style={{ marginBottom: 12, background: "#0A0C14", borderRadius: 8, border: "1px solid #1E213088", overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", background: "#12141E", borderBottom: "1px solid #1E213044", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#F59E0B", fontFamily: "'Space Grotesk', sans-serif" }}>
                    Group {gi + 1}
                  </span>
                  <span style={{ fontSize: 10, color: "#5A6178" }}>
                    {group.incidents.length} incidents · {group.similarity}% similar · {group.reporter}
                  </span>
                  <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: group.similarity >= 80 ? "#FF444422" : group.similarity >= 50 ? "#F59E0B22" : "#0EA5E922", color: group.similarity >= 80 ? "#FF6B6B" : group.similarity >= 50 ? "#F59E0B" : "#0EA5E9", fontWeight: 600 }}>
                    {group.similarity >= 80 ? "HIGH" : group.similarity >= 50 ? "MEDIUM" : "LOW"} MATCH
                  </span>
                </div>
                <button disabled={dupMerging === gi} onClick={async () => {
                  setDupMerging(gi);
                  try {
                    const primaryId = group.suggestedPrimary;
                    const duplicateIds = group.incidents.filter(i => i.id !== primaryId).map(i => i.id);
                    const resp = await fetch("/api/incidents/merge", {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ primaryId, duplicateIds, mergedBy: currentUser?.name || "Engineer" }),
                    });
                    const data = await resp.json();
                    if (data.success) {
                      showToast(`✅ Merged ${data.mergedCount} duplicate(s) into ${primaryId}`, "success");
                      setDupGroups(prev => prev.filter((_, idx) => idx !== gi));
                      // Refresh incidents
                      fetch("/api/db/incidents").then(r => r.json()).then(r => { if (r.data) setIncidents(r.data); }).catch(() => {});
                      if (dupGroups.length <= 1) setShowDupPanel(false);
                    } else {
                      showToast(`❌ Merge failed: ${data.error}`, "error");
                    }
                  } catch (err) { showToast(`❌ ${err.message}`, "error"); }
                  setDupMerging(null);
                }} style={{ ...btnStyle("#FF6B6B"), fontSize: 10, padding: "5px 12px", opacity: dupMerging === gi ? 0.6 : 1 }}>
                  {dupMerging === gi ? "⏳ Merging..." : `🔗 Merge into ${group.suggestedPrimary}`}
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(group.incidents.length, 3)}, 1fr)`, gap: 1, background: "#1E213044" }}>
                {group.incidents.map((inc, _ii) => (
                  <div key={inc.id} style={{ padding: "10px 12px", background: "#0A0C14", position: "relative" }}>
                    {inc.id === group.suggestedPrimary && (
                      <div style={{ position: "absolute", top: 4, right: 6, fontSize: 8, padding: "1px 6px", borderRadius: 4, background: "#4CAF5022", color: "#4CAF50", fontWeight: 700 }}>PRIMARY</div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: "#64B5F6", fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}
                        onClick={() => { const found = incidents.find(i => i.id === inc.id); if (found) { setDetailItem(found); setModal("incidentDetail"); } }}>
                        {inc.id}
                      </span>
                      <Badge color={STATUS_COLORS[inc.status] || { bg: "#1E2130", text: "#C4CAD6" }}>{inc.status}</Badge>
                    </div>
                    <div style={{ fontSize: 11, color: "#C4CAD6", marginBottom: 4, lineHeight: 1.3 }}>{inc.title}</div>
                    <div style={{ fontSize: 9, color: "#5A6178", display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span>📧 {inc.reporter || inc.reporterEmail}</span>
                      <span>📂 {inc.category || "—"}</span>
                      <span>🕒 {inc.createdAt ? new Date(inc.createdAt).toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                      <span>📝 {inc.activityCount} activit{inc.activityCount === 1 ? "y" : "ies"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ AI Command Center ═══════════════════════════════════════ */}
      {(() => {
        const pendingResolve = aiResolveQueue.filter(i => i.status === "pending_approval");
        const dismissedResolve = aiResolveQueue.filter(i => i.status === "auto_dismissed");
        const filteredResolve = aiResolveFilter === "pending" ? pendingResolve : aiResolveFilter === "dismissed" ? dismissedResolve : aiResolveQueue;
        const relevanceColors = { customer_critical: "#FF4444", customer_important: "#FFB347", internal_routine: "#06B6D4", noise_informational: "#5A6178" };
        const relevanceLabels = { customer_critical: "🔴 Critical", customer_important: "🟠 Important", internal_routine: "🔵 Routine", noise_informational: "⚪ Noise" };
        const anyScanRunning = aiResolveScanLoading || aiWorkflowScanLoading || historicalCloseRunning || aiFollowUpLoading || cleanupLoading;
        const pulseKeyframes = anyScanRunning ? "ai-pulse 1.5s ease-in-out infinite" : "none";
        return (
        <div style={{ marginBottom: 16, background: "linear-gradient(135deg, #0F1117 0%, #14102A 50%, #0A1628 100%)", borderRadius: 12, border: "1px solid #7C3AED44", overflow: "hidden" }}>
          {/* Command Center Header */}
          <div style={{ background: "linear-gradient(90deg, #7C3AED22, #06B6D422, #7C3AED22)", padding: "12px 16px", borderBottom: "1px solid #7C3AED33" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ animation: pulseKeyframes }}>🧠</span> AI Command Center
                {pendingResolve.length > 0 && <span style={{ fontSize: 10, background: "#7C3AED33", color: "#C084FC", padding: "2px 8px", borderRadius: 10 }}>{pendingResolve.length} resolve</span>}
                {aiWorkflowQueue.length > 0 && <span style={{ fontSize: 10, background: "#06B6D433", color: "#22D3EE", padding: "2px 8px", borderRadius: 10 }}>{aiWorkflowQueue.length} workflow</span>}
              </h3>
              <span style={{ fontSize: 9, color: "#5A6178" }}>Human-in-the-loop • RACI gated</span>
            </div>
            {/* Scan Buttons Row */}
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <style>{`@keyframes ai-pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }`}</style>
              <button disabled={aiResolveScanLoading} onClick={runAiAutoResolve}
                style={{ ...btnStyle("#7C3AED"), fontSize: 11, display: "flex", alignItems: "center", gap: 4, opacity: aiResolveScanLoading ? 0.7 : 1, animation: aiResolveScanLoading ? pulseKeyframes : "none" }}>
                {aiResolveScanLoading ? "⏳ Scanning..." : "🤖 Auto-Resolve Scan"}
              </button>
              <button disabled={aiWorkflowScanLoading} onClick={runAiWorkflowAssist}
                style={{ ...btnStyle("#06B6D4"), fontSize: 11, display: "flex", alignItems: "center", gap: 4, opacity: aiWorkflowScanLoading ? 0.7 : 1, animation: aiWorkflowScanLoading ? pulseKeyframes : "none" }}>
                {aiWorkflowScanLoading ? "⏳ Analyzing..." : "🔄 Workflow Assist"}
              </button>
              <button disabled={aiFollowUpLoading} onClick={runAiAutoFollowUp}
                style={{ ...btnStyle("#EC4899"), fontSize: 11, display: "flex", alignItems: "center", gap: 4, opacity: aiFollowUpLoading ? 0.7 : 1, animation: aiFollowUpLoading ? pulseKeyframes : "none" }}>
                {aiFollowUpLoading ? "⏳ Following up..." : "📨 AI Auto Follow-Up"}
              </button>
              <button disabled={cleanupLoading} onClick={runCleanupQueue}
                style={{ ...btnStyle("#FFB347"), fontSize: 11, display: "flex", alignItems: "center", gap: 4, opacity: cleanupLoading ? 0.7 : 1, animation: cleanupLoading ? pulseKeyframes : "none" }}>
                {cleanupLoading ? "⏳ Cleaning..." : "🧹 Cleanup Stale"}
              </button>
              <button disabled={historicalCloseRunning} onClick={() => runBulkCloseTickets(true)}
                style={{ ...btnStyle("#FF6B6B"), fontSize: 11, display: "flex", alignItems: "center", gap: 4, opacity: historicalCloseRunning ? 0.7 : 1, animation: historicalCloseRunning ? pulseKeyframes : "none" }}>
                {historicalCloseRunning ? "⏳ Processing..." : "🗄️ Close Past Tickets"}
              </button>
            </div>
          </div>

          {/* ─── AI Auto-Resolve Queue ─────────────────────────────────── */}
          <div style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h4 style={{ margin: 0, fontSize: 13, color: "#C084FC", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
                🤖 Auto-Resolve Queue
                <span style={{ fontSize: 10, background: "#7C3AED33", color: "#C084FC", padding: "2px 8px", borderRadius: 10 }}>{pendingResolve.length} pending</span>
                {dismissedResolve.length > 0 && <span style={{ fontSize: 10, background: "#5A617822", color: "#5A6178", padding: "2px 8px", borderRadius: 10 }}>{dismissedResolve.length} dismissed</span>}
              </h4>
              <span style={{ fontSize: 9, color: "#5A6178" }}>Human approval required for customer items • Noise auto-dismissed</span>
            </div>
            {/* Filter tabs */}
            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
              {[{ key: "pending", label: `Pending (${pendingResolve.length})` }, { key: "dismissed", label: `Dismissed (${dismissedResolve.length})` }, { key: "all", label: `All (${aiResolveQueue.length})` }].map(f => (
                <button key={f.key} onClick={() => setAiResolveFilter(f.key)}
                  style={{ ...btnStyle(aiResolveFilter === f.key ? "#7C3AED" : "#1E2130"), fontSize: 9, padding: "3px 10px", border: aiResolveFilter === f.key ? "1px solid #7C3AED" : "1px solid #1E213066" }}>
                  {f.label}
                </button>
              ))}
              {pendingResolve.length > 3 && (
                <button disabled={aiBulkDismissLoading} onClick={handleBulkDismiss}
                  style={{ ...btnStyle("#FF6B6B"), fontSize: 9, padding: "3px 10px", marginLeft: "auto", opacity: aiBulkDismissLoading ? 0.5 : 1 }}>
                  {aiBulkDismissLoading ? "⏳ Classifying..." : `🧹 AI Smart Dismiss (${pendingResolve.length})`}
                </button>
              )}
              {pendingResolve.filter(i => i.confidence >= 80).length > 0 && (
                <button disabled={aiBulkApproveLoading} onClick={() => setBulkApprovePromptOpen(v => !v)}
                  style={{ ...btnStyle("#4CAF50"), fontSize: 9, padding: "3px 10px", marginLeft: pendingResolve.length <= 3 ? "auto" : 0, opacity: aiBulkApproveLoading ? 0.5 : 1 }}>
                  {aiBulkApproveLoading ? "⏳ Approving..." : `✅ Bulk Approve (≥80% · ${pendingResolve.filter(i => i.confidence >= 80).length})`}
                </button>
              )}
            </div>
            {/* Bulk Approve RACI Prompt */}
            {bulkApprovePromptOpen && (
              <div style={{ background: "#0F111766", padding: 10, borderRadius: 8, border: "1px solid #4CAF5044", marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "#81C784", fontWeight: 600, marginBottom: 6 }}>
                  🛡️ RACI Required — Bulk Approve {pendingResolve.filter(i => i.confidence >= 80).length} item(s)
                </div>
                <div style={{ fontSize: 10, color: "#A0A8B8", marginBottom: 6 }}>
                  Sev-A items will be skipped. Sev-B+ items require a Consulted party. Will approve {pendingResolve.filter(i => i.confidence >= 80 && !/sev-?a|p1|critical/i.test(i.priority || "")).length}, skip {pendingResolve.filter(i => i.confidence >= 80 && /sev-?a|p1|critical/i.test(i.priority || "")).length}.
                </div>
                <label style={{ fontSize: 10, color: "#A0A8B8", display: "block", marginBottom: 2 }}>Consulted by (comma-separated names, required for Sev-B+):</label>
                <input value={bulkConsultedBy} onChange={e => setBulkConsultedBy(e.target.value)}
                  placeholder="e.g. Hlaing, Senior Engineer"
                  style={{ ...inputStyle, width: "100%", fontSize: 11, marginBottom: 8 }} />
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button onClick={() => { setBulkApprovePromptOpen(false); setBulkConsultedBy(""); }}
                    style={{ ...btnStyle("#333"), fontSize: 10, padding: "4px 12px" }}>Cancel</button>
                  <button disabled={aiBulkApproveLoading} onClick={() => {
                    const consulted = bulkConsultedBy.split(",").map(s => s.trim()).filter(Boolean);
                    handleBulkApprove(consulted);
                    setBulkApprovePromptOpen(false); setBulkConsultedBy("");
                  }} style={{ ...btnStyle("#4CAF50"), fontSize: 10, padding: "4px 14px", opacity: aiBulkApproveLoading ? 0.5 : 1 }}>
                    ✅ Confirm Bulk Approve
                  </button>
                </div>
              </div>
            )}
            {/* Empty state */}
            {aiResolveQueue.length === 0 && (
              <div style={{ textAlign: "center", padding: "24px 16px", background: "#0A0C1444", borderRadius: 8, border: "1px dashed #7C3AED33" }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>🤖</div>
                <div style={{ fontSize: 12, color: "#C084FC", fontWeight: 600, marginBottom: 4 }}>No AI Resolve Suggestions</div>
                <div style={{ fontSize: 10, color: "#5A6178" }}>Run "Auto-Resolve Scan" above to let AI analyze open incidents</div>
              </div>
            )}
            {filteredResolve.length === 0 && aiResolveQueue.length > 0 && <div style={{ fontSize: 11, color: "#5A6178", textAlign: "center", padding: 16 }}>No items in this view</div>}
            {filteredResolve.map(s => {
              const queueAge = s.createdAt ? timeAgo(s.createdAt) : null;
              const ageMinutes = s.createdAt ? (Date.now() - new Date(s.createdAt).getTime()) / 60000 : 0;
              const ageColor = ageMinutes > 1440 ? "#FF6B6B" : ageMinutes > 360 ? "#FFB347" : "#5A6178";
              return (
              <div key={s.id} style={{ background: "#0A0C14", borderRadius: 8, border: `1px solid ${s.status === "auto_dismissed" ? "#5A617833" : "#1E213066"}`, padding: 12, marginBottom: 8, opacity: s.status === "auto_dismissed" ? 0.6 : 1, transition: "all 0.3s ease" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: 11, color: "#64B5F6", fontFamily: "'JetBrains Mono', monospace" }}>{s.incidentId}</span>
                    <span style={{ fontSize: 11, color: "#C4CAD6", marginLeft: 8 }}>{s.incidentTitle}</span>
                    {(s.customerCompany || s.customer) && <span style={{ fontSize: 10, color: "#EC4899", marginLeft: 8 }}>🏢 {s.customerCompany || s.customer}</span>}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                      {queueAge && <span style={{ fontSize: 9, color: ageColor, fontWeight: 600 }}>⏱️ {queueAge}</span>}
                      {s.incidentCreatedAt && <span style={{ fontSize: 9, color: "#5A6178" }}>📅 {new Date(s.incidentCreatedAt).toLocaleDateString()} {new Date(s.incidentCreatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
                      {s.reporter && <span style={{ fontSize: 9, color: "#A0A8B8" }}>👤 {s.reporter}</span>}
                      {s.reporterEmail && <span style={{ fontSize: 9, color: "#64B5F6" }}>✉️ {s.reporterEmail}</span>}
                      {s.source && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: "#1E213044", color: "#64B5F6" }}>{s.source}</span>}
                      <span style={{ fontSize: 10, color: "#5A6178" }}>Confidence: <span style={{ color: s.confidence >= 80 ? "#4CAF50" : s.confidence >= 60 ? "#FFB347" : "#FF6B6B", fontWeight: 600 }}>{s.confidence}%</span></span>
                      {s.relevance && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: (relevanceColors[s.relevance] || "#5A6178") + "22", color: relevanceColors[s.relevance] || "#5A6178", fontWeight: 600 }}>{relevanceLabels[s.relevance] || s.relevance}</span>}
                      {s.status === "auto_dismissed" && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "#FF6B6B22", color: "#FF6B6B" }}>Auto-Dismissed</span>}
                    </div>
                    {s.classificationReasoning && <div style={{ fontSize: 9, color: "#5A617899", marginTop: 2, fontStyle: "italic" }}>AI: {s.classificationReasoning.substring(0, 120)}</div>}
                  </div>
                  {s.status === "pending_approval" && (
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button disabled={aiResolveLoading} onClick={() => {
                        const next = editingId === s.id ? null : s.id;
                        setEditingId(next);
                        if (next) setTimeout(() => { const el = document.getElementById(`edit-panel-${s.id}`); if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, 50);
                      }}
                        style={{ ...btnStyle(editingId === s.id ? "#333" : "#4CAF50"), fontSize: 10, padding: "4px 12px", opacity: aiResolveLoading ? 0.5 : 1 }}>{editingId === s.id ? "▲ Close Editor" : "✅ Approve"}</button>
                      <button disabled={aiResolveLoading} onClick={() => setRejectingId(rejectingId === s.id ? null : s.id)}
                        style={{ ...btnStyle("#FF6B6B"), fontSize: 10, padding: "4px 12px", opacity: aiResolveLoading ? 0.5 : 1 }}>{rejectingId === s.id ? "▲ Cancel" : "❌ Reject"}</button>
                    </div>
                  )}
                </div>
                {/* Edit-before-approve panel */}
                {editingId === s.id && s.status === "pending_approval" && (
                  <div id={`edit-panel-${s.id}`} style={{ background: "#0F111766", padding: 14, borderRadius: 8, border: "1px solid #4CAF5044", marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: "#81C784", fontWeight: 600, marginBottom: 8 }}>✏️ Review & Confirm Approval</div>
                    {/* Recipient info header */}
                    <div style={{ background: "#1A1D2344", padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 11, color: "#A0A8B8", border: "1px solid #2A2F3A", lineHeight: 1.6 }}>
                      <div><strong style={{ color: "#06B6D4" }}>To:</strong> {s.reporterEmail || s.reporter || "N/A"}</div>
                      {(s.customerCompany || s.customer) && <div><strong style={{ color: "#FFB347" }}>Company:</strong> {s.customerCompany || s.customer}</div>}
                      <div><strong style={{ color: "#81C784" }}>Subject:</strong> [VGC ITSM] Your incident {s.incidentId} has been resolved</div>
                    </div>
                    <label style={{ fontSize: 10, color: "#A0A8B8", display: "block", marginBottom: 2 }}>Resolution:</label>
                    <textarea value={editResolution ?? s.resolution} onChange={e => setEditResolution(e.target.value)}
                      style={{ ...inputStyle, width: "100%", fontSize: 11, minHeight: 80, marginBottom: 8, resize: "vertical" }} />
                    <label style={{ fontSize: 10, color: "#A0A8B8", display: "block", marginBottom: 2 }}>Customer Email (HTML):</label>
                    {/* Formatting toolbar */}
                    <div style={{ display: "flex", gap: 4, marginBottom: 4, flexWrap: "wrap" }}>
                      {[
                        { title: "Bold", label: "B", before: "<strong>", after: "</strong>" },
                        { title: "Paragraph", label: "\u00b6", before: "<p>", after: "</p>" },
                        { title: "Bullet list", label: "\u2022 List", before: "<ul>\n<li>", after: "</li>\n</ul>" },
                        { title: "Numbered list", label: "1. List", before: "<ol>\n<li>", after: "</li>\n</ol>" },
                        { title: "List item", label: "+ Item", before: "<li>", after: "</li>" },
                        { title: "Line break", label: "\u21b5", before: "<br/>", after: "" },
                      ].map(btn => (
                        <button key={btn.title} title={btn.title} type="button" onClick={() => {
                          const ta = document.getElementById(`email-edit-textarea-${s.id}`);
                          if (!ta) return;
                          const start = ta.selectionStart, end = ta.selectionEnd;
                          const text = ta.value;
                          const selected = text.substring(start, end);
                          const newText = text.substring(0, start) + btn.before + selected + btn.after + text.substring(end);
                          setEditEmail(newText);
                          setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + btn.before.length + selected.length; }, 0);
                        }} style={{ ...btnStyle("#2A2F3A"), fontSize: 10, padding: "2px 8px", minWidth: 28, fontWeight: btn.label === "B" ? 700 : 400 }}>
                          {btn.label}
                        </button>
                      ))}
                    </div>
                    <textarea id={`email-edit-textarea-${s.id}`}
                      value={editEmail ?? (s.customerEmailHtml || s.customerEmail || "")}
                      onChange={e => setEditEmail(e.target.value)}
                      style={{ ...inputStyle, width: "100%", fontSize: 12, minHeight: 200, marginBottom: 6, resize: "vertical", lineHeight: 1.6, fontFamily: "monospace" }} />
                    {/* Live preview */}
                    <details style={{ marginBottom: 8 }}>
                      <summary style={{ fontSize: 10, color: "#06B6D4", cursor: "pointer", marginBottom: 4 }}>Preview Email</summary>
                      <div style={{ background: "#ffffff", borderRadius: 6, padding: 12, maxHeight: 200, overflowY: "auto", border: "1px solid #2A2F3A" }}>
                        <div style={{ fontSize: 12, color: "#1a1a1a", lineHeight: 1.5 }}
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(editEmail ?? (s.customerEmailHtml || s.customerEmail || "")) }} />
                      </div>
                    </details>
                    {/* RACI consultedBy — required for Sev-B and above */}
                    {(() => {
                      const sev = String(s.priority || "").toLowerCase().replace(/[\s_-]/g, "");
                      const isSevBPlus = sev === "seva" || sev === "sevb" || sev === "p1" || sev === "p2" || sev === "critical" || sev === "high";
                      return isSevBPlus ? (
                        <div style={{ marginBottom: 8 }}>
                          <label style={{ fontSize: 10, color: "#FFB347", display: "block", marginBottom: 2 }}>Consulted by (required for {s.priority}):</label>
                          <input value={editConsultedBy} onChange={e => setEditConsultedBy(e.target.value)}
                            placeholder="e.g. Hlaing, Senior Engineer"
                            style={{ ...inputStyle, width: "100%", fontSize: 11 }} />
                        </div>
                      ) : null;
                    })()}
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", marginTop: 4 }}>
                      <button onClick={() => { setEditingId(null); setEditResolution(null); setEditEmail(null); setEditConsultedBy(""); }}
                        style={{ ...btnStyle("#333"), fontSize: 11, padding: "6px 16px" }}>Cancel</button>
                      <button disabled={aiResolveLoading} onClick={() => {
                        const consulted = editConsultedBy.split(",").map(x => x.trim()).filter(Boolean);
                        handleAiResolveAction(s.id, "approve", editResolution ?? s.resolution, editEmail ?? (s.customerEmailHtml || s.customerEmail), null, consulted);
                        setEditingId(null); setEditResolution(null); setEditEmail(null); setEditConsultedBy("");
                      }} style={{ ...btnStyle("#4CAF50"), fontSize: 12, padding: "8px 24px", fontWeight: 700, opacity: aiResolveLoading ? 0.5 : 1 }}>
                        ✅ Confirm Approve & Send Email
                      </button>
                    </div>
                  </div>
                )}
                {/* Rejection reason panel */}
                {rejectingId === s.id && s.status === "pending_approval" && (
                  <div style={{ background: "#0F111766", padding: 10, borderRadius: 8, border: "1px solid #FF6B6B44", marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: "#FF6B6B", fontWeight: 600, marginBottom: 6 }}>❌ Rejection Reason</div>
                    <select value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                      style={{ ...inputStyle, width: "100%", fontSize: 11, marginBottom: 6 }}>
                      <option value="">Select reason...</option>
                      {REJECTION_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    {rejectReason === "Other" && (
                      <textarea placeholder="Describe reason..." value={rejectFreetext} onChange={e => setRejectFreetext(e.target.value)}
                        style={{ ...inputStyle, width: "100%", fontSize: 11, minHeight: 36, marginBottom: 6, resize: "vertical" }} />
                    )}
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button onClick={() => { setRejectingId(null); setRejectReason(""); setRejectFreetext(""); }}
                        style={{ ...btnStyle("#333"), fontSize: 10, padding: "4px 12px" }}>Cancel</button>
                      <button disabled={aiResolveLoading || !rejectReason} onClick={() => {
                        const reason = rejectReason === "Other" ? (rejectFreetext || "Other") : rejectReason;
                        handleAiResolveAction(s.id, "reject", null, null, reason);
                        setRejectingId(null); setRejectReason(""); setRejectFreetext("");
                      }} style={{ ...btnStyle("#FF6B6B"), fontSize: 10, padding: "4px 14px", opacity: (aiResolveLoading || !rejectReason) ? 0.5 : 1 }}>
                        ❌ Confirm Reject
                      </button>
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 11, color: "#A0A8B8", background: "#0F111766", padding: 8, borderRadius: 6, border: "1px solid #1E213033" }}>
                  <div style={{ marginBottom: 4 }}><strong style={{ color: "#C084FC" }}>Resolution:</strong> {s.resolution}</div>
                  {s.rootCause && <div style={{ marginBottom: 4 }}><strong style={{ color: "#FFB347" }}>Root Cause:</strong> {s.rootCause}</div>}
                  {(s.customerEmailHtml || s.customerEmail) && s.status !== "auto_dismissed" && (
                    <div>
                      <strong style={{ color: "#06B6D4", cursor: "pointer" }} onClick={(e) => { const el = e.currentTarget.nextElementSibling; if (el) el.style.display = el.style.display === "none" ? "block" : "none"; }}>
                        📧 Customer Email Draft ▾
                      </strong>
                      <div style={{ display: "none", marginTop: 6, background: "#ffffff", borderRadius: 6, padding: 10, border: "1px solid #1E213066", maxHeight: 200, overflowY: "auto" }}>
                        {s.customerEmailHtml ? (
                          <div style={{ fontSize: 12, color: "#1a1a1a", lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(s.customerEmailHtml) }} />
                        ) : (
                          <div style={{ fontSize: 11, color: "#333", whiteSpace: "pre-wrap" }}>{s.customerEmail}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              );
            })}
          </div>

          {/* ─── AI Workflow Assist Queue ────────────────────────────────── */}
          <div style={{ padding: "0 16px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, borderTop: "1px solid #1E213044", paddingTop: 12 }}>
              <h4 style={{ margin: 0, fontSize: 13, color: "#22D3EE", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
                🔄 Workflow Assist Queue <span style={{ fontSize: 10, background: "#06B6D433", color: "#22D3EE", padding: "2px 8px", borderRadius: 10 }}>{aiWorkflowQueue.length} pending</span>
              </h4>
              <span style={{ fontSize: 9, color: "#5A6178" }}>Internal notes only • No customer emails</span>
            </div>
            {/* Empty state */}
            {aiWorkflowQueue.length === 0 && (
              <div style={{ textAlign: "center", padding: "24px 16px", background: "#0A0C1444", borderRadius: 8, border: "1px dashed #06B6D433" }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>🔄</div>
                <div style={{ fontSize: 12, color: "#22D3EE", fontWeight: 600, marginBottom: 4 }}>No Workflow Suggestions</div>
                <div style={{ fontSize: 10, color: "#5A6178" }}>Run "Workflow Assist" to get AI-powered escalation & routing suggestions</div>
              </div>
            )}
            {aiWorkflowQueue.map(s => {
              const queueAge = s.createdAt ? timeAgo(s.createdAt) : null;
              const ageMinutes = s.createdAt ? (Date.now() - new Date(s.createdAt).getTime()) / 60000 : 0;
              const ageColor = ageMinutes > 1440 ? "#FF6B6B" : ageMinutes > 360 ? "#FFB347" : "#5A6178";
              return (
              <div key={s.id} style={{ background: "#0A0C14", borderRadius: 8, border: "1px solid #1E213066", padding: 12, marginBottom: 8, transition: "all 0.3s ease" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: 11, color: "#64B5F6", fontFamily: "'JetBrains Mono', monospace" }}>{s.incidentId}</span>
                    <span style={{ fontSize: 11, color: "#C4CAD6", marginLeft: 8 }}>{s.incidentTitle}</span>
                    <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center" }}>
                      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: s.action === "escalate" ? "#FF6B6B22" : s.action === "reassign" ? "#FFB34722" : "#06B6D422", color: s.action === "escalate" ? "#FF6B6B" : s.action === "reassign" ? "#FFB347" : "#22D3EE", fontWeight: 600 }}>{s.action}</span>
                      <span style={{ fontSize: 10, color: "#5A6178" }}>Confidence: <span style={{ color: s.confidence >= 80 ? "#4CAF50" : s.confidence >= 60 ? "#FFB347" : "#FF6B6B", fontWeight: 600 }}>{s.confidence}%</span></span>
                      {queueAge && <span style={{ fontSize: 9, color: ageColor, fontWeight: 600 }}>⏱️ {queueAge}</span>}
                      {s.zdTicketId && <span style={{ fontSize: 9, color: "#EC4899" }}>ZD #{s.zdTicketId}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button disabled={aiWorkflowLoading} onClick={() => handleAiWorkflowAction(s.id, "approve")}
                      style={{ ...btnStyle("#4CAF50"), fontSize: 10, padding: "4px 12px", opacity: aiWorkflowLoading ? 0.5 : 1 }}>✅ Approve</button>
                    <button disabled={aiWorkflowLoading} onClick={() => handleAiWorkflowAction(s.id, "reject")}
                      style={{ ...btnStyle("#FF6B6B"), fontSize: 10, padding: "4px 12px", opacity: aiWorkflowLoading ? 0.5 : 1 }}>❌ Reject</button>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "#A0A8B8", background: "#0F111766", padding: 8, borderRadius: 6, border: "1px solid #1E213033" }}>
                  <div style={{ marginBottom: 4 }}><strong style={{ color: "#22D3EE" }}>Reasoning:</strong> {s.reasoning}</div>
                  {s.internalNote && <div style={{ marginBottom: 4 }}><strong style={{ color: "#FFB347" }}>Internal Note:</strong> {s.internalNote}</div>}
                  {s.suggestedAssignee && <div><strong style={{ color: "#81C784" }}>Suggested Assignee:</strong> {s.suggestedAssignee}</div>}
                </div>
              </div>
              );
            })}
          </div>
        </div>
        );
      })()}

      {/* ═══ Bulk Operations Toolbar ═══ */}
      {selectedIds.size > 0 && (
        <div style={{
          position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
          background: "linear-gradient(135deg, #6366F118, #06B6D408)", borderRadius: 10,
          border: "1px solid #6366F144", marginBottom: 12, flexWrap: "wrap"
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#818CF8", fontFamily: "'Space Grotesk', sans-serif" }}>
            {selectedIds.size} selected
          </span>
          <button style={{ ...btnStyle("#333"), fontSize: 11, padding: "5px 10px" }} onClick={() => setSelectedIds(new Set())}>✕ Clear</button>
          <button style={{ ...btnStyle("#333"), fontSize: 11, padding: "5px 10px" }} onClick={() => setSelectedIds(new Set(filtered.map(i => i.id)))}>Select All ({filtered.length})</button>
          <div style={{ width: 1, height: 24, background: "#1E2130" }} />
          <button style={{ ...btnStyle("#6366F1"), fontSize: 11, padding: "5px 12px" }} onClick={() => setBulkAction("assign")}>👤 Assign</button>
          <button style={{ ...btnStyle("#FFB347"), fontSize: 11, padding: "5px 12px" }} onClick={() => setBulkAction("priority")}>⚡ Priority</button>
          <button style={{ ...btnStyle("#4CAF50"), fontSize: 11, padding: "5px 12px" }} onClick={() => setBulkAction("status")}>📋 Status</button>
          <button style={{ ...btnStyle("#FF6B6B"), fontSize: 11, padding: "5px 12px" }} onClick={() => setBulkAction("close")}>✅ Close</button>
          {bulkAction && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8, padding: "4px 10px", background: "#0A0C14", borderRadius: 8, border: "1px solid #1E2130" }}>
              {bulkAction === "assign" && <select style={{ ...inputStyle, fontSize: 11, padding: "4px 8px", minWidth: 160 }} value={bulkValue} onChange={e => setBulkValue(e.target.value)}>
                <option value="">Select assignee...</option>
                {(users || []).filter(u => u.role !== "End User").map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
              </select>}
              {bulkAction === "priority" && <select style={{ ...inputStyle, fontSize: 11, padding: "4px 8px" }} value={bulkValue} onChange={e => setBulkValue(e.target.value)}>
                <option value="">Select priority...</option>
                {["Sev-A", "Sev-B", "Sev-C", "Sev-D"].map(p => <option key={p}>{p}</option>)}
              </select>}
              {bulkAction === "status" && <select style={{ ...inputStyle, fontSize: 11, padding: "4px 8px" }} value={bulkValue} onChange={e => setBulkValue(e.target.value)}>
                <option value="">Select status...</option>
                {["Open", "In Progress", "Pending", "On Hold", "Resolved"].map(s => <option key={s}>{s}</option>)}
              </select>}
              {bulkAction === "close" && <span style={{ fontSize: 11, color: "#FF6B6B" }}>Close {selectedIds.size} tickets?</span>}
              <button style={{ ...btnStyle("#4CAF50"), fontSize: 11, padding: "4px 10px", opacity: (bulkAction === "close" || bulkValue) ? 1 : 0.5 }}
                disabled={bulkAction !== "close" && !bulkValue || bulkProcessing}
                onClick={async () => {
                  setBulkProcessing(true);
                  const ids = [...selectedIds];
                  const now = new Date();
                  const updates = {};
                  if (bulkAction === "assign") updates.assignee = bulkValue;
                  if (bulkAction === "priority") updates.priority = bulkValue;
                  if (bulkAction === "status") updates.status = bulkValue;
                  if (bulkAction === "close") { updates.status = "Closed"; updates.closureCode = "Bulk closed"; }
                  setIncidents(prev => prev.map(inc => {
                    if (!ids.includes(inc.id)) return inc;
                    const log = { id: genId("AL"), type: "bulk", user: currentUser.name, time: now.toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }).replace(",", ""), detail: `Bulk ${bulkAction}: ${bulkAction === "close" ? "Closed" : bulkValue}` };
                    return { ...inc, ...updates, activityLog: [...(inc.activityLog || []), log] };
                  }));
                  // Persist each to DB
                  for (const id of ids) {
                    const inc = incidents.find(i => i.id === id);
                    if (inc) {
                      const updated = { ...inc, ...updates };
                      try { await fetch("/api/db/incidents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, data: updated }) }); } catch { /* fire-and-forget */ }
                    }
                  }
                  showToast(`✅ Bulk ${bulkAction} applied to ${ids.length} incidents`, "success");
                  setSelectedIds(new Set());
                  setBulkAction(null);
                  setBulkValue("");
                  setBulkProcessing(false);
                }}>{bulkProcessing ? "⏳..." : "Apply"}</button>
              <button style={{ ...btnStyle("#333"), fontSize: 11, padding: "4px 8px" }} onClick={() => { setBulkAction(null); setBulkValue(""); }}>Cancel</button>
            </div>
          )}
        </div>
      )}

      <DataTable
        columns={[
          { label: "", key: "_select", width: 36, render: r => (
            <input type="checkbox" checked={selectedIds.has(r.id)} onChange={e => {
              e.stopPropagation();
              setSelectedIds(prev => { const next = new Set(prev); if (next.has(r.id)) next.delete(r.id); else next.add(r.id); return next; });
            }} onClick={e => e.stopPropagation()} style={{ accentColor: "#6366F1", cursor: "pointer" }} />
          )},
          { label: "ID", key: "id", mono: true, render: r => (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#64B5F6" }}>{r.id}</span>
              {r.aiTriaged && <span title={`AI Triaged (${r.aiConfidence}% confidence)`} style={{ fontSize: 10, cursor: "help" }}>🤖</span>}
              {r.zdTicketId && <span title={`Zendesk #${r.zdTicketId}${r.zdLastSync ? ` — last sync ${new Date(r.zdLastSync).toLocaleString("en-SG", { timeZone: "Asia/Singapore", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}`} onClick={e => { e.stopPropagation(); setActiveModule("zendesk"); }} style={{ fontSize: 9, cursor: "pointer", color: "#EC4899", fontWeight: 600, padding: "1px 4px", borderRadius: 3, background: "#EC489918" }}>ZD</span>}
              {(() => {
                const pauses = Array.isArray(r.slaPauseHistory) ? r.slaPauseHistory : [];
                const active = pauses.find(p => p.pausedAt && !p.resumedAt);
                if (!active) return null;
                const ms = Date.now() - new Date(active.pausedAt).getTime();
                const mins = Math.max(1, Math.floor(ms / 60000));
                const label = mins >= 60 ? `${Math.floor(mins/60)}h ${mins%60}m` : `${mins}m`;
                return <span title={`SLA paused since ${active.pausedAt} — ${active.reason || "Pending"}`} style={{ fontSize: 9, color: "#FFB347", fontWeight: 600, padding: "1px 5px", borderRadius: 3, background: "#FFB34718", border: "1px solid #FFB34744" }}>⏸ {label}</span>;
              })()}
            </span>
          )},
          { label: "Title", key: "title" },
          { label: "Priority", render: r => <PriorityDot priority={r.priority} /> },
          { label: "Impact", render: r => <Badge color={r.impact === "Enterprise" ? PRIORITY_COLORS["Sev-A"] : r.impact === "Department" ? PRIORITY_COLORS["Sev-B"] : PRIORITY_COLORS["Sev-D"]}>{r.impact || "—"}</Badge> },
          { label: "Status", render: r => <Badge color={STATUS_COLORS[r.status]}>{r.status}</Badge> },
          { label: "Category", key: "category", mono: true },
          { label: "Assignee", key: "assignee" },
          { label: "Group", render: r => <span style={{ color: "#A0AEC0", fontSize: 11 }}>{r.assignmentGroup || "—"}</span> },
          { label: "Reporter", render: r => <span style={{ color: "#C4CAD6", fontSize: 12 }}>{r.reporter}</span> },
          { label: "AI", render: r => r.aiTriaged ? (
            <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: r.aiConfidence >= 90 ? "#81C784" : r.aiConfidence >= 75 ? "#FFB347" : "#FF6B6B", fontWeight: 600 }}>
              {r.aiConfidence}%
            </span>
          ) : <span style={{ color: "#5A617855", fontSize: 10 }}>—</span> },
          { label: "Tone", render: r => {
            const sent = r.aiSentiment || r.sentiment;
            if (!sent) return <span style={{ color: "#5A617855", fontSize: 10 }}>—</span>;
            const sentMap = { positive: { emoji: "😊", color: "#81C784" }, neutral: { emoji: "😐", color: "#A0AEC0" }, frustrated: { emoji: "😤", color: "#FFB347" }, angry: { emoji: "🔥", color: "#FF6B6B" } };
            const s = sentMap[sent] || sentMap.neutral;
            return <span title={`${sent}${r.aiSentimentScore ? ` (${r.aiSentimentScore}%)` : ""}`} style={{ fontSize: 14, cursor: "help" }}>{s.emoji}</span>;
          }},
          { label: "SLA", render: r => {
            const pct = Math.min(100, Math.round((r.created / r.slaTarget) * 100));
            const hrsLeft = Math.max(0, r.slaTarget - r.created);
            const isBreach = pct >= 100;
            const isCritical = pct > 90 && !isBreach;
            const isWarning = pct > 75 && !isCritical && !isBreach;
            return <span style={{
              color: isBreach ? "#FF4444" : isCritical ? "#FF6B6B" : isWarning ? "#FFB347" : "#81C784",
              fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700,
              animation: isBreach ? "slaBreachPulse 0.8s ease-in-out infinite" : isCritical ? "slaBlinkFast 0.6s ease-in-out infinite" : isWarning ? "slaBlink 1.2s ease-in-out infinite" : "none",
              display: "inline-flex", alignItems: "center", gap: 4,
              textShadow: isBreach ? "0 0 8px #FF444466" : isCritical ? "0 0 6px #FF6B6B44" : "none"
            }}>
              {isBreach && <span style={{ fontSize: 10 }}>🔴</span>}
              {isCritical && <span style={{ fontSize: 10 }}>🟠</span>}
              {isBreach ? "BREACH" : isCritical ? `${pct}% ⚠` : isWarning ? `${pct}%` : `${pct}%`}
              {(isCritical || isWarning) && <span style={{ fontSize: 8, color: "#5A6178", marginLeft: 2 }}>{hrsLeft.toFixed(1)}h</span>}
            </span>;
          }},
          { label: "Created", render: r => <span style={{ color: "#5A6178" }}>{timeAgo(r.created)}</span> },
        ]}
        data={filtered}
        onRowClick={row => { setDetailItem(row); setModal("incidentDetail"); }}
      />
    </div>
  );
});
return <IncidentsModule />;
}
