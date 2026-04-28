import React, { useState, useMemo, useEffect } from "react";
import {
  COLORS, PRIORITY_COLORS, STATUS_COLORS, inputStyle, btnStyle,
} from "../constants/theme.js";
import {
  STATUS, OPEN_STATUSES, PRIORITY, SLA_TARGETS,
} from "../constants/status.js";
import { APP_VERSION } from "../constants/version.js";
import {
  computeIncidentSla, formatSlaCountdown, genId, timeAgo,
} from "../utils/slaHelpers.js";
import {
  Badge, PriorityDot, DataTable, WorkflowHeader, SearchBar, useStableComponent,
} from "../components/SharedComponents.jsx";

// Incidents Module — extracted from itsm-tool.jsx
export default function IncidentsModule({ ctx }) {
  const {
    incidents, setIncidents, search, setSearch, currentUser, showToast,
    _save, setDetailItem, setModal, setActiveModule,
    computeIncidentSlaFn, users,
  } = ctx;

const STATUS_SORT_ORDER = { "New": 0, "Open": 1, "In Progress": 2, "Pending": 3, "On Hold": 4, "Reopened": 5, "Resolved": 6, "Closed": 7 };
const IncidentsModule = useStableComponent(() => {
  // Phase S1d — defer filter computation so commits don't block typing
  const deferredSearch = React.useDeferredValue(search);
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
  }, [incidents, deferredSearch]);
  return (
    <div>
      <WorkflowHeader module="incidents" version={APP_VERSION.version} stepCounts={[incidents.filter(i => i.status === "Open" && !i.aiTriaged).length, incidents.filter(i => i.aiTriaged && i.status === "Open").length, incidents.filter(i => i.assignee && ["Open","Assigned"].includes(i.status)).length, incidents.filter(i => i.status === "In Progress").length, incidents.filter(i => i.status === "Resolved" || i.status === "Closed").length]} />
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <SearchBar value={search} onChange={setSearch} placeholder="Search incidents..." />
        <button style={btnStyle()} onClick={() => setModal("newIncident")}>+ New Incident</button>
        <button style={{ ...btnStyle("#0EA5E9"), fontSize: 11, display: "flex", alignItems: "center", gap: 4 }} onClick={() => window.open("/api/export/incidents?format=csv", "_blank")}>📥 Export CSV</button>
        <button style={{ ...btnStyle("#EC4899"), fontSize: 11, display: "flex", alignItems: "center", gap: 4 }} onClick={() => {
          if (isLocalDemoUser) { showToast("Demo mode — Zendesk import unavailable", "info"); return; }
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
          }).catch(() => {});
        }}>🎫 Import from Zendesk</button>
        <button style={{ ...btnStyle("#4CAF50"), fontSize: 11, display: "flex", alignItems: "center", gap: 4 }} onClick={async () => {
          if (isDemoModeRef.current) { showToast("🎭 Demo mode — Zendesk sync disabled", "info"); return; }
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
          if (isDemoModeRef.current) { showToast("🎭 Demo mode — dedup unavailable", "info"); return; }
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
        {zdStats.open + zdStats.pending > 0 && <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: "#FFB347", fontFamily: "'JetBrains Mono', monospace" }}>Zendesk Live: {zdStats.open} open · {zdStats.pending} pending</span>
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
                {group.incidents.map((inc, ii) => (
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

      {/* ─── AI Auto-Resolve Queue ─────────────────────────────────── */}
      {aiResolveQueue.length > 0 && (() => {
        const pendingItems = aiResolveQueue.filter(i => i.status === "pending_approval");
        const dismissedItems = aiResolveQueue.filter(i => i.status === "auto_dismissed");
        const filteredItems = aiResolveFilter === "pending" ? pendingItems : aiResolveFilter === "dismissed" ? dismissedItems : aiResolveQueue;
        const relevanceColors = { customer_critical: "#FF4444", customer_important: "#FFB347", internal_routine: "#06B6D4", noise_informational: "#5A6178" };
        const relevanceLabels = { customer_critical: "🔴 Critical", customer_important: "🟠 Important", internal_routine: "🔵 Routine", noise_informational: "⚪ Noise" };
        return (
        <div style={{ marginBottom: 16, background: "linear-gradient(135deg, #0F1117 0%, #1A1040 100%)", borderRadius: 10, border: "1px solid #7C3AED44", padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 13, color: "#C084FC", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
              🤖 AI Auto-Resolve Queue
              <span style={{ fontSize: 10, background: "#7C3AED33", color: "#C084FC", padding: "2px 8px", borderRadius: 10 }}>{pendingItems.length} pending</span>
              {dismissedItems.length > 0 && <span style={{ fontSize: 10, background: "#5A617822", color: "#5A6178", padding: "2px 8px", borderRadius: 10 }}>{dismissedItems.length} dismissed</span>}
            </h3>
            <span style={{ fontSize: 9, color: "#5A6178" }}>Human approval required for customer items • Noise auto-dismissed</span>
          </div>
          {/* Filter tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {[{ key: "pending", label: `Pending (${pendingItems.length})` }, { key: "dismissed", label: `Dismissed (${dismissedItems.length})` }, { key: "all", label: `All (${aiResolveQueue.length})` }].map(f => (
              <button key={f.key} onClick={() => setAiResolveFilter(f.key)}
                style={{ ...btnStyle(aiResolveFilter === f.key ? "#7C3AED" : "#1E2130"), fontSize: 9, padding: "3px 10px", border: aiResolveFilter === f.key ? "1px solid #7C3AED" : "1px solid #1E213066" }}>
                {f.label}
              </button>
            ))}
            {pendingItems.length > 3 && (
              <button disabled={aiBulkDismissLoading} onClick={handleBulkDismiss}
                style={{ ...btnStyle("#FF6B6B"), fontSize: 9, padding: "3px 10px", marginLeft: "auto", opacity: aiBulkDismissLoading ? 0.5 : 1 }}>
                {aiBulkDismissLoading ? "⏳ Classifying..." : `🧹 AI Smart Dismiss (${pendingItems.length})`}
              </button>
            )}
          </div>
          {filteredItems.length === 0 && <div style={{ fontSize: 11, color: "#5A6178", textAlign: "center", padding: 16 }}>No items in this view</div>}
          {filteredItems.map(s => (
            <div key={s.id} style={{ background: "#0A0C14", borderRadius: 8, border: `1px solid ${s.status === "auto_dismissed" ? "#5A617833" : "#1E213066"}`, padding: 12, marginBottom: 8, opacity: s.status === "auto_dismissed" ? 0.6 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <span style={{ fontSize: 11, color: "#64B5F6", fontFamily: "'JetBrains Mono', monospace" }}>{s.incidentId}</span>
                  <span style={{ fontSize: 11, color: "#C4CAD6", marginLeft: 8 }}>{s.incidentTitle}</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                    <span style={{ fontSize: 10, color: "#5A6178" }}>Confidence: <span style={{ color: s.confidence >= 80 ? "#4CAF50" : s.confidence >= 60 ? "#FFB347" : "#FF6B6B", fontWeight: 600 }}>{s.confidence}%</span></span>
                    {s.relevance && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: (relevanceColors[s.relevance] || "#5A6178") + "22", color: relevanceColors[s.relevance] || "#5A6178", fontWeight: 600 }}>{relevanceLabels[s.relevance] || s.relevance}</span>}
                    {s.status === "auto_dismissed" && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "#FF6B6B22", color: "#FF6B6B" }}>Auto-Dismissed</span>}
                  </div>
                  {s.classificationReasoning && <div style={{ fontSize: 9, color: "#5A617899", marginTop: 2, fontStyle: "italic" }}>AI: {s.classificationReasoning.substring(0, 120)}</div>}
                </div>
                {s.status === "pending_approval" && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button disabled={aiResolveLoading} onClick={() => handleAiResolveAction(s.id, "approve")}
                      style={{ ...btnStyle("#4CAF50"), fontSize: 10, padding: "4px 12px", opacity: aiResolveLoading ? 0.5 : 1 }}>✅ Approve</button>
                    <button disabled={aiResolveLoading} onClick={() => handleAiResolveAction(s.id, "reject")}
                      style={{ ...btnStyle("#FF6B6B"), fontSize: 10, padding: "4px 12px", opacity: aiResolveLoading ? 0.5 : 1 }}>❌ Reject</button>
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11, color: "#A0A8B8", background: "#0F111766", padding: 8, borderRadius: 6, border: "1px solid #1E213033" }}>
                <div style={{ marginBottom: 4 }}><strong style={{ color: "#C084FC" }}>Resolution:</strong> {s.resolution}</div>
                {s.rootCause && <div style={{ marginBottom: 4 }}><strong style={{ color: "#FFB347" }}>Root Cause:</strong> {s.rootCause}</div>}
                {s.customerEmail && s.status !== "auto_dismissed" && <div><strong style={{ color: "#06B6D4" }}>Customer Email Draft:</strong> {s.customerEmail}</div>}
              </div>
            </div>
          ))}
        </div>
        );
      })()}

      {/* AI Auto-Resolve Scan Button */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button disabled={aiResolveScanLoading} onClick={runAiAutoResolve}
          style={{ ...btnStyle("#7C3AED"), fontSize: 11, display: "flex", alignItems: "center", gap: 4, opacity: aiResolveScanLoading ? 0.5 : 1 }}>
          {aiResolveScanLoading ? "⏳ Scanning..." : "🤖 AI Auto-Resolve Scan"}
        </button>
        <button disabled={aiWorkflowScanLoading} onClick={runAiWorkflowAssist}
          style={{ ...btnStyle("#06B6D4"), fontSize: 11, display: "flex", alignItems: "center", gap: 4, opacity: aiWorkflowScanLoading ? 0.5 : 1 }}>
          {aiWorkflowScanLoading ? "⏳ Analyzing..." : "🔄 AI Workflow Assist"}
        </button>
        <button disabled={historicalCloseRunning} onClick={() => runBulkCloseTickets(true)}
          style={{ ...btnStyle("#FF6B6B"), fontSize: 11, display: "flex", alignItems: "center", gap: 4, opacity: historicalCloseRunning ? 0.5 : 1 }}>
          {historicalCloseRunning ? "⏳ Processing..." : "🗄️ AI Close Past Tickets"}
        </button>
        {aiResolveQueue.filter(i => i.status === "pending_approval").length > 0 && <span style={{ fontSize: 10, color: "#C084FC", alignSelf: "center" }}>{aiResolveQueue.filter(i => i.status === "pending_approval").length} resolve suggestions</span>}
        {aiWorkflowQueue.length > 0 && <span style={{ fontSize: 10, color: "#06B6D4", alignSelf: "center" }}>{aiWorkflowQueue.length} workflow suggestions</span>}
      </div>

      {/* ─── AI Workflow Assist Queue ────────────────────────────────── */}
      {aiWorkflowQueue.length > 0 && (
        <div style={{ marginBottom: 16, background: "linear-gradient(135deg, #0F1117 0%, #0A2030 100%)", borderRadius: 10, border: "1px solid #06B6D444", padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 13, color: "#22D3EE", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
              🔄 AI Workflow Assist Queue <span style={{ fontSize: 10, background: "#06B6D433", color: "#22D3EE", padding: "2px 8px", borderRadius: 10 }}>{aiWorkflowQueue.length} pending</span>
            </h3>
            <span style={{ fontSize: 9, color: "#5A6178" }}>Internal notes only • No customer emails</span>
          </div>
          {aiWorkflowQueue.map(s => (
            <div key={s.id} style={{ background: "#0A0C14", borderRadius: 8, border: "1px solid #1E213066", padding: 12, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <span style={{ fontSize: 11, color: "#64B5F6", fontFamily: "'JetBrains Mono', monospace" }}>{s.incidentId}</span>
                  <span style={{ fontSize: 11, color: "#C4CAD6", marginLeft: 8 }}>{s.incidentTitle}</span>
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: s.action === "escalate" ? "#FF6B6B22" : s.action === "reassign" ? "#FFB34722" : "#06B6D422", color: s.action === "escalate" ? "#FF6B6B" : s.action === "reassign" ? "#FFB347" : "#22D3EE", fontWeight: 600 }}>{s.action}</span>
                    <span style={{ fontSize: 10, color: "#5A6178" }}>Confidence: <span style={{ color: s.confidence >= 80 ? "#4CAF50" : s.confidence >= 60 ? "#FFB347" : "#FF6B6B", fontWeight: 600 }}>{s.confidence}%</span></span>
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
          ))}
        </div>
      )}

      <DataTable
        columns={[
          { label: "ID", key: "id", mono: true, render: r => (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#64B5F6" }}>{r.id}</span>
              {r.aiTriaged && <span title={`AI Triaged (${r.aiConfidence}% confidence)`} style={{ fontSize: 10, cursor: "help" }}>🤖</span>}
              {r.zdTicketId && <span title={`Zendesk #${r.zdTicketId}`} onClick={e => { e.stopPropagation(); setActiveModule("zendesk"); }} style={{ fontSize: 9, cursor: "pointer", color: "#EC4899", fontWeight: 600, padding: "1px 4px", borderRadius: 3, background: "#EC489918" }}>ZD</span>}
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
}
