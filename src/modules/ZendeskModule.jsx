import React, { useState } from "react";
import { Modal } from "../components/SharedComponents.jsx";
import { genId } from "../utils/slaHelpers.js";

export default function ZendeskModule({  assets, changes, currentUser, customers, incidents, requests, setActiveModule, setDetailItem, setModal, showToast, users,
  setIncidents, setCustomers, azureOpenAI, isLocalDemoUser
 }) {
  const [zdTab, setZdTab] = useState("tickets");
  const [zdTickets, setZdTickets] = useState([]);
  const [zdStats, setZdStats] = useState(null);
  const [zdConnected, setZdConnected] = useState(false);
  const [zdLoading, setZdLoading] = useState(false);
  const [zdError, setZdError] = useState(null);
  const [zdFilter, setZdFilter] = useState({ status: "All", priority: "All", type: "All" });
  const [zdSelectedTicket, setZdSelectedTicket] = useState(null);
  const [zdDetailItem, setZdDetailItem] = useState(null);
  const [zdPage, setZdPage] = useState(1);
  const [zdRenderLimit, setZdRenderLimit] = useState(20);
  const [zdExpandedSections, setZdExpandedSections] = useState({});
  const [zdComments, setZdComments] = useState([]);
  const [zdTriagedIds, setZdTriagedIds] = useState([]);
  const [zdAiQueue, setZdAiQueue] = useState([]);
  const [zdAutoMode, setZdAutoMode] = useState(false);
  const [zdAutoStats, setZdAutoStats] = useState({ processed: 0, success: 0, failed: 0 });
  const [zdAiProcessing, setZdAiProcessing] = useState(false);
  const [zdSyncInProgress, setZdSyncInProgress] = useState(false);
  const [zdSyncProgress, setZdSyncProgress] = useState(null);
  const [zdSyncStatus, setZdSyncStatus] = useState(null);
  const [zdImportProgress, setZdImportProgress] = useState(null);
  const [zdUser, setZdUser] = useState(null);
  const [zdAutoLog, setZdAutoLog] = useState([]);
  const [zdRealTimeEnabled, setZdRealTimeEnabled] = useState(false);
  const [zdRequireHumanApproval, setZdRequireHumanApproval] = useState(true);
  const [zdEditingDraft, setZdEditingDraft] = useState(null);
  const [zdEditedText, setZdEditedText] = useState("");
  const [zdExpandedRule, setZdExpandedRule] = useState(null);

  const addAutoLog = (msg) => setZdAutoLog(prev => [...prev, { time: new Date().toISOString(), msg }]);
  const zdFetchTickets = async () => { setZdLoading(true); try { const r = await fetch("/api/zendesk/tickets"); const d = await r.json(); setZdTickets(d.tickets || []); } catch(e) { setZdError(e.message); } finally { setZdLoading(false); } };
  const zdFetchStats = async () => { try { const r = await fetch("/api/zendesk/stats"); const d = await r.json(); setZdStats(d); } catch(e) { console.error(e); } };
  const zdConnect = async () => { setZdLoading(true); try { const r = await fetch("/api/zendesk/connect", { method: "POST" }); if (r.ok) { setZdConnected(true); await zdFetchTickets(); await zdFetchStats(); } } catch(e) { setZdError(e.message); } finally { setZdLoading(false); } };
  const zdAutoTriageBatch = async () => { setZdAiProcessing(true); try { for (const t of zdAiQueue) { await new Promise(r => setTimeout(r, 200)); } setZdAiQueue([]); } catch(e) { console.error(e); } finally { setZdAiProcessing(false); } };
  const zdAiTriageSingle = async (ticket) => { setZdAiProcessing(true); try { const r = await fetch("/api/zendesk/ai-triage", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ ticket }) }); return await r.json(); } catch(e) { console.error(e); return null; } finally { setZdAiProcessing(false); } };
  const zdSelectTicket = (t) => setZdSelectedTicket(t);
  const zdToggleSection = (key) => setZdExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

  // ── Human Approve & Send ──
  const zdApproveAndSend = async (queueItem) => {
    try {
      setZdLoading(true);
      const r = await fetch("/api/zendesk/auto-respond", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: queueItem.ticketId, response: queueItem.draftResponse, priority: queueItem.suggestedPriority, tags: queueItem.suggestedTags, internalNote: queueItem.internalNote, approvedBy: currentUser?.name || "Admin" }),
      });
      if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || "Failed to send"); }
      const result = await r.json();
      setZdAiQueue(prev => prev.map(q => q.id === queueItem.id ? { ...q, status: "sent", reviewedBy: currentUser?.name || "Admin" } : q));
      setZdAutoStats(prev => ({ ...prev, autoSent: prev.autoSent + 1 }));
      const emailNote = result.email?.sent ? ` ✉️ Email sent to ${result.email.to}` : result.email?.error ? ` ⚠️ Email failed: ${result.email.error}` : "";
      addAutoLog({ type: "human_approved", ticketId: queueItem.ticketId, subject: queueItem.ticketSubject, message: `#${queueItem.ticketId} approved & sent by ${currentUser?.name || "Admin"}${emailNote}` });
      zdFetchTickets(); zdFetchStats();
    } catch (e) { setZdError("Send failed: " + e.message); }
    finally { setZdLoading(false); }
  };

  // ── Edit & Send (human edits AI draft) ──

  const zdEditAndSend = async (queueItem) => {
    try {
      setZdLoading(true);
      const r = await fetch("/api/zendesk/auto-respond", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: queueItem.ticketId, response: zdEditedText, priority: queueItem.suggestedPriority, tags: queueItem.suggestedTags, internalNote: queueItem.internalNote, approvedBy: `${currentUser?.name || "Admin"} (edited)` }),
      });
      if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || "Failed to send"); }
      const result = await r.json();
      setZdAiQueue(prev => prev.map(q => q.id === queueItem.id ? { ...q, status: "sent", draftResponse: zdEditedText, reviewedBy: `${currentUser?.name || "Admin"} (edited)` } : q));
      setZdAutoStats(prev => ({ ...prev, autoSent: prev.autoSent + 1 }));
      setZdEditingDraft(null); setZdEditedText("");
      const emailNote = result.email?.sent ? ` ✉️ Email sent to ${result.email.to}` : result.email?.error ? ` ⚠️ Email failed: ${result.email.error}` : "";
      addAutoLog({ type: "human_edited", ticketId: queueItem.ticketId, message: `#${queueItem.ticketId} edited & sent by ${currentUser?.name || "Admin"}${emailNote}` });
      zdFetchTickets(); zdFetchStats();
    } catch (e) { setZdError("Send failed: " + e.message); }
    finally { setZdLoading(false); }
  };

  // ── Full Historical Import ──
  const zdFullImport = async (options = {}) => {
    if (isLocalDemoUser) { setZdError("⚠️ Data Isolation: Demo mode cannot run production imports."); return; }
    if (zdSyncInProgress) return;
    setZdSyncInProgress(true);
    setZdSyncProgress({ phase: "Starting", message: "Initiating full historical import from Zendesk..." });
    addAutoLog({ type: "config", message: "Full historical import started — importing all tickets, users, organizations, comments..." });
    try {
      const r = await fetch("/api/zendesk/full-import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeComments: true, includeUsers: true, includeOrgs: true, createIncidents: options.createIncidents || false }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Import failed");
      const data = await r.json();
      setZdSyncProgress({ phase: "Complete", message: data.message });
      addAutoLog({ type: "human_approved", message: `Full import complete: ${data.stats.tickets} tickets, ${data.stats.users} users, ${data.stats.orgs} orgs, ${data.stats.comments} comments` });
      // Sync orgs to customers
      setZdSyncProgress({ phase: "Syncing", message: "Syncing organizations to ITSM customers..." });
      await fetch("/api/zendesk/sync-organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      addAutoLog({ type: "info", message: "Organizations synced to ITSM customers" });
      // Refresh sync status
      const statusR = await fetch("/api/zendesk/sync-status");
      if (statusR.ok) setZdSyncStatus(await statusR.json());
      // Refresh incidents
      {
        const incR = await fetch("/api/db/incidents");
        if (incR.ok) { const incData = await incR.json(); if (incData.data) setIncidents(incData.data); }
        // Refresh customers
        const custR = await fetch("/api/db/customers");
        if (custR.ok) { const custData = await custR.json(); if (custData.data) setCustomers(custData.data); }
      }
      zdFetchTickets(); zdFetchStats();
    } catch (e) {
      setZdSyncProgress({ phase: "Error", message: e.message });
      addAutoLog({ type: "error", message: `Full import failed: ${e.message}` });
    } finally {
      setZdSyncInProgress(false);
    }
  };

  // ── Train AI from Zendesk Historical Data ──
  const zdTrainAi = async () => {
    setZdSyncProgress({ phase: "Training", message: "Training AI knowledge base from resolved Zendesk tickets..." });
    addAutoLog({ type: "config", message: "AI training from Zendesk resolved tickets started" });
    try {
      const r = await fetch("/api/zendesk/train-ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!r.ok) throw new Error((await r.json()).error || "Training failed");
      const data = await r.json();
      setZdSyncProgress({ phase: "Complete", message: `Trained ${data.trained} knowledge articles from ${data.totalResolved} resolved tickets` });
      addAutoLog({ type: "human_approved", message: `AI trained: ${data.trained} KB articles created from ${data.totalResolved} resolved Zendesk tickets` });
    } catch (e) {
      addAutoLog({ type: "error", message: `AI training failed: ${e.message}` });
    }
  };

  // ── Push ITSM changes to Zendesk ──
  const zdPushToZendesk = async (incidentId, changes) => {
    try {
      const r = await fetch("/api/zendesk/push-to-zendesk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId, ...changes, user: currentUser?.name || "System" }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Push failed");
      const data = await r.json();
      addAutoLog({ type: "info", message: `Pushed ${incidentId} → Zendesk #${data.zdTicketId} (${data.action})` });
      return data;
    } catch (e) {
      addAutoLog({ type: "error", message: `Push to Zendesk failed for ${incidentId}: ${e.message}` });
      return null;
    }
  };

  // ── Import Historical Zendesk Tickets into ITSM (cursor-based, no page limit) ──
  const zdImportHistorical = async () => {
    if (zdImportProgress?.running) return;
    setZdImportProgress({ running: true, page: 0, imported: 0, skipped: 0, total: 0, errors: 0, phase: "Starting..." });
    addAutoLog({ type: "info", message: "Historical Zendesk import started (cursor-based pagination, no page limit)..." });

    try {
      // Build a set of already-linked Zendesk ticket IDs from existing incidents
      const existingZdIds = new Set();
      incidents.forEach(inc => { if (inc.zdTicketId) existingZdIds.add(Number(inc.zdTicketId)); });
      zdAiQueue.forEach(q => { if (q.ticketId) existingZdIds.add(Number(q.ticketId)); });

      let page = 1;
      let hasMore = true;
      let cursor = null;
      let totalImported = 0;
      let totalSkipped = 0;
      let totalErrors = 0;
      let totalCount = 0;
      const newIncidents = [];
      const dbBatch = [];

      while (hasMore) {
        setZdImportProgress(prev => ({ ...prev, page, phase: `Fetching page ${page}${cursor ? " (cursor)" : ""}...` }));

        // Build URL with cursor-based pagination
        const url = cursor
          ? `/api/zendesk/historical-tickets?cursor=${encodeURIComponent(cursor)}&page=${page}`
          : `/api/zendesk/historical-tickets?page=${page}`;

        let r;
        try {
          r = await fetch(url);
        } catch (fetchErr) {
          // Network error — retry once after 5s
          addAutoLog({ type: "error", message: `Page ${page} network error, retrying in 5s...` });
          await new Promise(resolve => setTimeout(resolve, 5000));
          r = await fetch(url);
        }

        if (!r.ok) {
          const errText = await r.text().catch(() => "Unknown error");
          // If rate limited (429), wait and retry
          if (r.status === 429) {
            const retryAfter = parseInt(r.headers.get("retry-after") || "15", 10);
            setZdImportProgress(prev => ({ ...prev, phase: `Rate limited — waiting ${retryAfter}s before retry...` }));
            addAutoLog({ type: "info", message: `Zendesk rate limit hit at page ${page}, waiting ${retryAfter}s...` });
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            continue; // retry same page
          }
          throw new Error(`Failed to fetch page ${page}: HTTP ${r.status} - ${errText.substring(0, 200)}`);
        }
        const data = await r.json();
        const tickets = data.tickets || [];
        if (data.count) totalCount = data.count;

        if (tickets.length === 0) { hasMore = false; break; }

        for (const t of tickets) {
          if (existingZdIds.has(t.id)) { totalSkipped++; continue; }

          const statusMap = { new: "New", open: "Open", pending: "Pending", hold: "On Hold", solved: "Resolved", closed: "Closed" };
          const priMap = { urgent: "Sev-A", high: "Sev-B", normal: "Sev-C", low: "Sev-D" };
          const urgMap = { urgent: "Critical", high: "High", normal: "Medium", low: "Low" };
          const impMap = { urgent: "Enterprise", high: "Department", normal: "Multiple Users", low: "Single User" };
          const zdPri = t.priority || "normal";
          const sla = priMap[zdPri] || "Sev-D";
          const slaHours = { "Sev-A": 4, "Sev-B": 4, "Sev-C": 9, "Sev-D": 27 };

          let category = "General";
          const tagStr = (t.tags || []).join(" ").toLowerCase();
          const subj = (t.subject || "").toLowerCase();
          if (tagStr.includes("network") || subj.includes("network") || subj.includes("wifi") || subj.includes("vpn")) category = "Network";
          else if (tagStr.includes("security") || subj.includes("security") || subj.includes("phishing") || subj.includes("malware")) category = "Security";
          else if (tagStr.includes("hardware") || subj.includes("hardware") || subj.includes("laptop") || subj.includes("monitor") || subj.includes("printer")) category = "Hardware";
          else if (tagStr.includes("software") || subj.includes("software") || subj.includes("install") || subj.includes("update") || subj.includes("license")) category = "Software";
          else if (tagStr.includes("email") || subj.includes("email") || subj.includes("outlook") || subj.includes("mail")) category = "Email";
          else if (tagStr.includes("cloud") || subj.includes("azure") || subj.includes("aws") || subj.includes("cloud") || subj.includes("teams")) category = "Cloud";
          else if (tagStr.includes("access") || subj.includes("password") || subj.includes("login") || subj.includes("access") || subj.includes("mfa")) category = "Access/Identity";
          else if (tagStr.includes("print") || subj.includes("print")) category = "Printing";

          const createdAt = t.created_at || t.createdAt;
          const updatedAt = t.updated_at || t.updatedAt || createdAt;
          const inc = {
            id: `INC-ZD${t.id}`, title: `[ZD#${t.id}] ${t.subject || "Zendesk Ticket"}`,
            priority: sla, status: statusMap[t.status] || "Open",
            category, subcategory: "",
            urgency: urgMap[zdPri] || "Medium", impact: impMap[zdPri] || "Single User",
            assignee: "Unassigned", assignmentGroup: "Service Desk",
            reporter: t.requester?.name || "Zendesk", reporterEmail: t.requester?.email || "",
            customer: t.requester?.name || "",
            description: t.description || t.subject || "", contactMethod: "Zendesk",
            created: Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 3600000)) || 0,
            slaTarget: slaHours[sla] || 9,
            aiTriaged: false, aiConfidence: 0,
            zdTicketId: t.id, zdLastSync: new Date().toISOString(),
            workaround: "", linkedProblem: "",
            affectedAssets: [], activityLog: [
              { id: genId("AL"), type: "status", user: "Historical Import", time: new Date(createdAt).toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }).replace(",", ""), detail: `Imported from Zendesk #${t.id} (created ${new Date(createdAt).toLocaleDateString("en-SG")}, status: ${t.status}, priority: ${zdPri})` },
              ...(t.status === "solved" || t.status === "closed" ? [{ id: genId("AL"), type: "status", user: "Zendesk", time: new Date(updatedAt).toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }).replace(",", ""), detail: `Ticket ${t.status} in Zendesk` }] : []),
            ]
          };
          newIncidents.push(inc);
          dbBatch.push(inc);
          existingZdIds.add(t.id);
          totalImported++;
        }

        // Persist batch to DB every 5 pages (avoid losing data on failure)
        if (dbBatch.length >= 200 || !data.has_more) {
          if (dbBatch.length > 0) {
            try {
              await fetch("/api/db/incidents", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(dbBatch),
              });
            } catch (dbErr) {
              // Fallback: persist individually
              for (const inc of dbBatch) {
                try {
                  await fetch("/api/db/incidents", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(inc),
                  });
                } catch { totalErrors++; }
              }
            }
            dbBatch.length = 0;
          }
        }

        setZdImportProgress(prev => ({ ...prev, imported: totalImported, skipped: totalSkipped, errors: totalErrors, total: totalCount || (totalImported + totalSkipped), phase: `Page ${page} done — ${totalImported} imported, ${totalSkipped} skipped` }));

        // Check if there are more pages (cursor-based)
        if (data.has_more && data.next_cursor) {
          cursor = data.next_cursor;
          page++;
        } else {
          hasMore = false;
        }

        // Small delay to avoid rate-limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      // Add all new incidents to React state
      if (newIncidents.length > 0) {
        setIncidents(prev => [...newIncidents, ...prev]);
      }

      const finalTotal = totalCount || (totalImported + totalSkipped);
      setZdImportProgress({ running: false, page, imported: totalImported, skipped: totalSkipped, errors: totalErrors, total: finalTotal, phase: `Complete — ${totalImported} tickets imported, ${totalSkipped} already existed${totalErrors > 0 ? `, ${totalErrors} errors` : ""}` });
      addAutoLog({ type: "human_approved", message: `Historical import complete: ${totalImported} Zendesk tickets imported as ITSM incidents (${totalSkipped} already existed, ${finalTotal} total in Zendesk)` });
      if (typeof showToast === "function") showToast(`Imported ${totalImported} Zendesk tickets successfully`, "success");
    } catch (e) {
      setZdImportProgress(prev => ({ ...prev, running: false, phase: `Error: ${e.message}` }));
      addAutoLog({ type: "error", message: `Historical import failed: ${e.message}` });
      if (typeof showToast === "function") showToast(`Import failed: ${e.message}`, "error");
    }
  };

  const priorityColor = (p) => ({ urgent: "#FF6B6B", high: "#FFB347", normal: "#64B5F6", low: "#81C784" }[p] || "#5A6178");
  const slaPriorityColor = (p) => ({ "Sev-A": "#FF6B6B", "Sev-B": "#FFB347", "Sev-C": "#64B5F6", "Sev-D": "#81C784" }[p] || "#5A6178");
  const statusIcon = (s) => ({ new: "🆕", open: "📂", pending: "⏳", hold: "⏸️", solved: "✅", closed: "🔒" }[s] || "📋");
  const pendingQueue = zdAiQueue.filter(q => q.status === "pending_approval").sort((a, b) => {
    // Critical priority always first
    if (a.suggestedPriority === "urgent" && b.suggestedPriority !== "urgent") return -1;
    if (b.suggestedPriority === "urgent" && a.suggestedPriority !== "urgent") return 1;
    // Then sort by SLA deadline (nearest breach first)
    const aDeadline = a.slaDeadline ? new Date(a.slaDeadline).getTime() : Infinity;
    const bDeadline = b.slaDeadline ? new Date(b.slaDeadline).getTime() : Infinity;
    return aDeadline - bDeadline;
  });
  const approvedSentQueue = zdAiQueue.filter(q => q.status === "sent");
  const rejectedQueue = zdAiQueue.filter(q => q.status === "rejected");

  const cardStyle = { background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", overflow: "hidden" };
  const sectionLabel = (icon, text, count) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: "#E8ECF4", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1 }}>{text}</span>
      {count !== undefined && <span style={{ fontSize: 9, background: "#EC489922", color: "#EC4899", padding: "2px 8px", borderRadius: 10, fontWeight: 700 }}>{count}</span>}
    </div>
  );

  return (
    <div style={{ padding: 0 }}>
      <style>{`
        @keyframes zdPulse { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }
        @keyframes zdSlideIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes zdSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes zdGlow { 0%, 100% { box-shadow: 0 0 8px #4CAF5033; } 50% { box-shadow: 0 0 20px #4CAF5055; } }
        @keyframes zdFlow { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
      `}</style>

      {/* ── Top Banner: Connection + Automation Status ── */}
      <div style={{
        background: zdConnected ? "linear-gradient(135deg, #0F1117, #4CAF5008, #0F1117)" : "#0F1117",
        backgroundSize: "200% 100%", animation: zdConnected && zdAutoMode ? "zdFlow 8s linear infinite" : "none",
        borderRadius: 12, border: `1px solid ${zdConnected ? (zdAutoMode ? "#4CAF5044" : "#FFB34733") : "#FF6B6B33"}`,
        padding: "16px 22px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: zdAutoMode && zdConnected ? "#4CAF5022" : "#1E2130", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, animation: zdAutoMode && zdConnected ? "zdGlow 3s ease infinite" : "none" }}>🤖</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4", display: "flex", alignItems: "center", gap: 10 }}>
              Zendesk AI Command Center
              <span style={{ fontSize: 9, padding: "2px 10px", borderRadius: 10, fontWeight: 700, background: zdConnected ? (zdAutoMode ? "#4CAF5022" : "#81C78422") : "#FF444422", color: zdConnected ? (zdAutoMode ? "#4CAF50" : "#81C784") : "#FF4444", animation: zdConnected ? "zdPulse 2s infinite" : "none" }}>
                {zdConnected ? (zdAutoMode ? "🤖 AI TRIAGE ACTIVE" : "LIVE — MANUAL") : "OFFLINE"}
              </span>
            </div>
            <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginTop: 3 }}>
              {zdConnected ? `${zdUser?.name || "—"} · vgctech.zendesk.com · ${zdAutoMode ? `AI triage every 2min · ${zdRequireHumanApproval ? "🛡️ Human approval required" : "⚡ Auto-send ON"}` : "Manual triage mode"} · AI Calls: ${azureOpenAI.totalCalls || 0} · ${zdRealTimeEnabled ? "Real-time sync ON" : "Sync OFF"}` : zdError || "Not connected"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {zdConnected && (
            <div onClick={() => { const nv = !zdAutoMode; setZdAutoMode(nv); localStorage.setItem("vgc_zd_auto_mode", JSON.stringify(nv)); addAutoLog({ type: "config", message: nv ? "AI Auto-Triage ENABLED — tickets triaged automatically, all responses require engineer approval" : "AI Auto-Triage DISABLED — manual triage mode" }); }}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, cursor: "pointer", background: zdAutoMode ? "#4CAF5022" : "#1E2130", border: `1px solid ${zdAutoMode ? "#4CAF5044" : "#1E2130"}` }}>
              <div style={{ width: 32, height: 16, borderRadius: 8, background: zdAutoMode ? "#4CAF50" : "#333", position: "relative", transition: "all 0.3s" }}>
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: zdAutoMode ? 18 : 2, transition: "left 0.3s" }} />
              </div>
              <span style={{ fontSize: 9, fontWeight: 600, color: zdAutoMode ? "#4CAF50" : "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>AI TRIAGE</span>
            </div>
          )}
          {zdConnected && (
            <div onClick={() => { const nv = !zdRequireHumanApproval; setZdRequireHumanApproval(nv); localStorage.setItem("vgc_zd_require_human_approval", JSON.stringify(nv)); addAutoLog({ type: "config", message: nv ? "HUMAN APPROVAL REQUIRED — all AI responses must be reviewed by engineer before sending" : "⚠️ AUTO-SEND ENABLED — high-confidence AI responses will be sent without engineer review" }); }}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, cursor: "pointer", background: zdRequireHumanApproval ? "#FF634722" : "#4CAF5022", border: `1px solid ${zdRequireHumanApproval ? "#FF634744" : "#4CAF5044"}` }}>
              <div style={{ width: 32, height: 16, borderRadius: 8, background: zdRequireHumanApproval ? "#FF6347" : "#333", position: "relative", transition: "all 0.3s" }}>
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: zdRequireHumanApproval ? 18 : 2, transition: "left 0.3s" }} />
              </div>
              <span style={{ fontSize: 9, fontWeight: 600, color: zdRequireHumanApproval ? "#FF6347" : "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>🛡️ APPROVAL</span>
            </div>
          )}
          {zdConnected && azureOpenAI.enabled && (
            <button onClick={zdAutoTriageBatch} disabled={zdAiProcessing}
              style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #6366F133", background: zdAiProcessing ? "#6366F111" : "#6366F118", color: "#6366F1", cursor: zdAiProcessing ? "wait" : "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
              {zdAiProcessing ? "⟳ Processing..." : "⚡ Triage Now"}
            </button>
          )}
          <button onClick={() => { zdFetchTickets(); zdFetchStats(); }} disabled={zdLoading}
            style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #FFB34733", background: "#FFB34718", color: "#FFB347", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
            🔄 Sync
          </button>
          {!zdConnected && (
            <button onClick={zdConnect} disabled={zdLoading}
              style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #81C78433", background: "#81C78418", color: "#81C784", cursor: "pointer", fontSize: 10, fontWeight: 600 }}>Connect</button>
          )}
        </div>
      </div>

      {/* ── Automation Metrics Dashboard ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 20 }}>
        {[
          { label: "Open", value: zdStats.open, accent: "#64B5F6", icon: "📂", tab: "tickets" },
          { label: "Pending", value: zdStats.pending, accent: "#FFB347", icon: "⏳", tab: "tickets" },
          { label: "On Hold", value: zdStats.hold, accent: "#FF6B6B", icon: "⏸️", tab: "tickets" },
          { label: "Solved", value: zdStats.solved, accent: "#81C784", icon: "✅", tab: "tickets" },
          { label: "AI Triaged", value: zdAutoStats.totalTriaged, accent: "#EC4899", icon: "🤖", tab: "automation" },
          { label: "Approved & Sent", value: zdAutoStats.autoSent, accent: "#06B6D4", icon: "✅", tab: "history" },
          { label: "Pending Review", value: pendingQueue.length, accent: "#FFB347", icon: "👤", tab: "queue" },
          { label: "ITSM Created", value: zdAutoStats.incidentsCreated, accent: "#6366F1", icon: "🎫", tab: "history" },
          { label: "Avg Confidence", value: `${zdAutoStats.avgConfidence}%`, accent: "#81C784", icon: "📊", tab: "automation" },
        ].map((s, i) => (
          <div key={i} onClick={() => { if (s.tab === "tickets") { setZdFilter(s.label.toLowerCase() === "on hold" ? "hold" : s.label.toLowerCase() === "solved" ? "solved" : s.label.toLowerCase() === "pending" ? "pending" : "open"); zdFetchTickets(s.label.toLowerCase() === "on hold" ? "hold" : s.label.toLowerCase() === "solved" ? "solved" : s.label.toLowerCase() === "pending" ? "pending" : "open", 1); } setZdTab(s.tab); }}
            style={{ padding: "12px 14px", background: "#0F1117", borderRadius: 10, border: `1px solid ${s.accent}33`, cursor: "pointer", transition: "all 0.2s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = s.accent + "88"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 4px 12px ${s.accent}22`; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = s.accent + "33"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>
            <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>{s.icon} {s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.accent }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── AI 90% / Human 10% Work Split Indicator ── */}
      {zdAutoStats.totalTriaged > 0 && (() => {
        const aiPct = zdAutoStats.totalTriaged > 0 ? Math.round((zdAutoStats.autoSent / zdAutoStats.totalTriaged) * 100) : 0;
        const humanPct = 100 - aiPct;
        return (
        <div style={{ ...cardStyle, padding: "14px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#E8ECF4", whiteSpace: "nowrap" }}>🤖 AI {aiPct}% / 👨‍💻 Engineer {humanPct}%</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", background: "#1E2130" }}>
              <div style={{ width: `${Math.max(aiPct, 5)}%`, background: "linear-gradient(90deg, #6366F1, #818CF8)", borderRadius: "6px 0 0 6px", transition: "width 0.5s" }} />
              <div style={{ width: `${Math.max(humanPct, 5)}%`, background: "linear-gradient(90deg, #FFB347, #FFCC80)", borderRadius: "0 6px 6px 0", transition: "width 0.5s" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span onClick={() => setZdTab("automation")} style={{ fontSize: 9, color: "#818CF8", fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}>AI: Triage · Categorize · Draft · Auto-Send ({zdAutoStats.autoSent} auto-sent)</span>
              <span onClick={() => setZdTab("queue")} style={{ fontSize: 9, color: "#FFB347", fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}>Engineer: Review low-confidence ({zdAutoStats.humanReview} reviewed)</span>
            </div>
          </div>
          <div onClick={() => setZdTab("analytics")} style={{ textAlign: "center", minWidth: 60, cursor: "pointer", transition: "transform 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.transform = "scale(1.08)"}
            onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
            <div style={{ fontSize: 18, fontWeight: 700, color: aiPct >= 80 ? "#81C784" : "#FFB347" }}>{aiPct}%</div>
            <div style={{ fontSize: 8, color: "#5A6178" }}>AI Auto-Rate</div>
          </div>
        </div>
        );
      })()}

      {/* ── Tab Navigation ── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "#0A0C14", borderRadius: 10, padding: 4 }}>
        {[
          { id: "automation", label: "🤖 Automation", count: null },
          { id: "queue", label: "📝 AI Draft Queue", count: pendingQueue.length },
          { id: "tickets", label: "📋 All Tickets", count: zdStats.open + zdStats.pending },
          { id: "analytics", label: "📊 Analytics", count: null },
          { id: "sync", label: "🔄 Sync & Migration", count: zdSyncStatus?.counts?.zdTickets || null },
          { id: "history", label: "📜 AI History", count: approvedSentQueue.length },
          { id: "settings", label: "⚙️ Settings", count: null },
        ].map(tab => (
          <button key={tab.id} onClick={() => setZdTab(tab.id)}
            style={{ flex: 1, padding: "8px 12px", borderRadius: 8, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", background: zdTab === tab.id ? "#1E213066" : "transparent", color: zdTab === tab.id ? "#E8ECF4" : "#5A6178", border: zdTab === tab.id ? "1px solid #1E2130" : "1px solid transparent", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            {tab.label}
            {tab.count > 0 && <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 8, background: tab.id === "queue" ? "#FF6B6B33" : "#6366F133", color: tab.id === "queue" ? "#FF6B6B" : "#6366F1", fontWeight: 700 }}>{tab.count}</span>}
          </button>
        ))}
      </div>

      {/* ══════════ TAB: AUTOMATION (Live Feed) ══════════ */}
      {zdTab === "automation" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {/* Automation Pipeline */}
          <div style={{ ...cardStyle, padding: 16 }}>
            {sectionLabel("⚡", "AI Automation Pipeline")}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
              {[
                { label: "Ingest", desc: "Zendesk tickets pulled every 2min", icon: "📥", color: "#64B5F6", active: zdConnected, tab: "tickets" },
                { label: "AI Triage", desc: "Auto-categorize, draft & route (90%)", icon: "🧠", color: "#EC4899", active: azureOpenAI.enabled, tab: "history" },
                { label: "Auto-Send / Review", desc: "≥85% auto-sends, <85% engineer review", icon: "⚡", color: "#81C784", active: zdAutoMode, tab: "queue" },
              ].map((step, i) => (
                <div key={i} onClick={() => setZdTab(step.tab)} style={{ padding: "12px 10px", borderRadius: 8, background: step.active ? `${step.color}08` : "#12141E", border: `1px solid ${step.active ? step.color + "33" : "#1E213033"}`, textAlign: "center", cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 4px 12px ${step.color}22`; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{step.icon}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: step.active ? step.color : "#5A6178", marginBottom: 2 }}>{step.label}</div>
                  <div style={{ fontSize: 8, color: "#5A617888" }}>{step.desc}</div>
                  <div style={{ marginTop: 6, width: 6, height: 6, borderRadius: "50%", background: step.active ? "#4CAF50" : "#FF4444", margin: "0 auto", animation: step.active ? "zdPulse 2s infinite" : "none" }} />
                </div>
              ))}
            </div>

            {/* Routing Rules — Clickable & Expandable */}
            <div style={{ fontSize: 10, fontWeight: 700, color: "#FFB347", fontFamily: "'JetBrains Mono', monospace", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 }}>📋 Auto-Routing Rules</div>
            {[
              { id: "rule1", condition: "Confidence ≥85% + routine issue", action: "→ AI auto-sends response", color: "#81C784", detail: "High-confidence AI responses for routine issues (password resets, basic how-to, status inquiries) are automatically sent to the customer. This is the 90% AI automation rule — saving time and effort.", tab: "history" },
              { id: "rule2", condition: "Confidence <85% or complex/sensitive", action: "→ Engineer review queue", color: "#FFB347", detail: "Low-confidence or sensitive items go to the engineer review queue for manual approval. This is the 10% human oversight rule. Engineers review, edit if needed, then approve.", tab: "queue" },
              { id: "rule3", condition: "Priority = Urgent/High", action: "→ Auto-create ITSM Incident", color: "#FF6B6B", detail: "Tickets classified as Urgent or High priority automatically generate an ITSM Incident (INC####). This ensures SLA tracking begins immediately and escalation rules apply.", tab: "history" },
              { id: "rule4", condition: "Category = Network/Security", action: "→ Route to Network Engineering", color: "#6366F1", detail: "Network infrastructure and security-related tickets (VPN, firewall, phishing, MFA issues) are assigned to the Network Engineering team for specialized handling.", tab: "tickets" },
              { id: "rule5", condition: "Category = Hardware", action: "→ Route to L2 Support", color: "#06B6D4", detail: "Hardware issues (laptop, printer, monitor, peripheral) are escalated to L2 Support who manage physical assets and on-site visits.", tab: "tickets" },
              { id: "rule6", condition: "All other tickets", action: "→ Route to L1 Service Desk", color: "#EC4899", detail: "Default routing for general IT inquiries, software issues, access requests, and user account management. L1 handles first-response and basic troubleshooting.", tab: "tickets" },
            ].map((rule, i) => (
              <div key={rule.id}>
                <div onClick={() => setZdExpandedRule(zdExpandedRule === rule.id ? null : rule.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderBottom: i < 5 && zdExpandedRule !== rule.id ? "1px solid #1E213022" : "none", cursor: "pointer", borderRadius: zdExpandedRule === rule.id ? "6px 6px 0 0" : 0, background: zdExpandedRule === rule.id ? `${rule.color}08` : "transparent", transition: "all 0.2s" }}
                  onMouseEnter={e => { if (zdExpandedRule !== rule.id) e.currentTarget.style.background = `${rule.color}06`; }}
                  onMouseLeave={e => { if (zdExpandedRule !== rule.id) e.currentTarget.style.background = "transparent"; }}>
                  <div style={{ width: 4, height: 4, borderRadius: "50%", background: rule.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: "#A0AEC0", flex: 1 }}>{rule.condition}</span>
                  <span style={{ fontSize: 9, color: rule.color, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{rule.action}</span>
                  <span style={{ fontSize: 10, color: "#5A6178", marginLeft: 6, transition: "transform 0.2s", transform: zdExpandedRule === rule.id ? "rotate(180deg)" : "rotate(0)" }}>▾</span>
                </div>
                {zdExpandedRule === rule.id && (
                  <div style={{ padding: "8px 12px 10px 20px", background: `${rule.color}06`, borderRadius: "0 0 6px 6px", borderBottom: "1px solid #1E213022", marginBottom: 2 }}>
                    <div style={{ fontSize: 10, color: "#C4CAD6", lineHeight: 1.5, marginBottom: 8 }}>{rule.detail}</div>
                    <button onClick={() => setZdTab(rule.tab)} style={{ padding: "3px 10px", borderRadius: 4, border: `1px solid ${rule.color}33`, background: `${rule.color}11`, color: rule.color, fontSize: 9, cursor: "pointer", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                      View {rule.tab === "queue" ? "Review Queue" : rule.tab === "history" ? "AI History" : "Tickets"} →
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* AI Quick Actions */}
          <div style={{ ...cardStyle, padding: 16, marginBottom: 14 }}>
            {sectionLabel("⚡", "AI Quick Actions")}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
              {[
                { label: "AI Triage All Open", icon: "🧠", desc: "Auto-triage all unprocessed open tickets", color: "#6366F1", action: () => { if (zdConnected) zdAutoTriageBatch(); else addAutoLog({ type: "error", message: "Connect to Zendesk first" }); }, disabled: !zdConnected || zdLoading },
                { label: "AI Train Knowledge", icon: "📚", desc: "Train AI from all resolved ticket patterns", color: "#81C784", action: () => { if (zdConnected) zdTrainAi(); }, disabled: !zdConnected },
                { label: "AI Sync & Import", icon: "🔄", desc: "Full bi-directional sync with Zendesk", color: "#06B6D4", action: () => { if (zdConnected) zdFullImport({ createIncidents: true }); }, disabled: !zdConnected || zdSyncInProgress },
                { label: "AI Push Updates", icon: "📤", desc: "Push ITSM changes back to Zendesk", color: "#EC4899", action: () => { if (zdConnected) zdPushToZendesk(); }, disabled: !zdConnected },
                { label: "View SLA Risks", icon: "⏱️", desc: "Jump to SLA dashboard for at-risk tickets", color: "#FF6B6B", action: () => setActiveModule("sla"), disabled: false },
                { label: "Open Incidents", icon: "🎫", desc: "View all AI-created ITSM incidents", color: "#FFB347", action: () => setActiveModule("incidents"), disabled: false },
              ].map((qa, i) => (
                <button key={i} onClick={qa.action} disabled={qa.disabled}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 8, border: `1px solid ${qa.disabled ? "#1E2130" : qa.color + "33"}`, background: qa.disabled ? "#0A0C14" : `${qa.color}08`, color: qa.disabled ? "#5A6178" : qa.color, cursor: qa.disabled ? "not-allowed" : "pointer", textAlign: "left", transition: "all 0.2s", fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", width: "100%" }}
                  onMouseEnter={e => { if (!qa.disabled) { e.currentTarget.style.borderColor = qa.color + "66"; e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = `0 3px 10px ${qa.color}18`; } }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = qa.disabled ? "#1E2130" : qa.color + "33"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{qa.icon}</span>
                  <div>
                    <div>{qa.label}</div>
                    <div style={{ fontSize: 8, fontWeight: 400, color: "#5A617888", marginTop: 1 }}>{qa.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Live Activity Log */}
          <div style={{ ...cardStyle, padding: 16, maxHeight: 500, display: "flex", flexDirection: "column" }}>
            {sectionLabel("📡", "Live Activity Feed", zdAutoLog.length)}
            <div style={{ flex: 1, overflow: "auto" }}>
              {zdAutoLog.length === 0 ? (
                <div style={{ padding: 30, textAlign: "center", color: "#5A6178" }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>🤖</div>
                  <div style={{ fontSize: 11 }}>{zdAutoMode ? "AI Triage active — waiting for new tickets. All responses require your approval." : "Enable AI Triage or click 'Triage Now' to start"}</div>
                </div>
              ) : (
                zdAutoLog.slice(0, 50).map((log, i) => {
                  const typeConfig = {
                    auto_send: { icon: "⚡", color: "#81C784", bg: "#81C78408" },
                    human_review: { icon: "👤", color: "#FFB347", bg: "#FFB34708" },
                    human_approved: { icon: "✅", color: "#4CAF50", bg: "#4CAF5008" },
                    human_edited: { icon: "✏️", color: "#64B5F6", bg: "#64B5F608" },
                    incident_created: { icon: "🎫", color: "#6366F1", bg: "#6366F108" },
                    error: { icon: "❌", color: "#FF6B6B", bg: "#FF6B6B08" },
                    info: { icon: "ℹ️", color: "#5A6178", bg: "transparent" },
                    config: { icon: "⚙️", color: "#EC4899", bg: "#EC489908" },
                  }[log.type] || { icon: "📋", color: "#5A6178", bg: "transparent" };
                  return (
                    <div key={log.id} onClick={() => {
                      if (log.type === "incident_created") setActiveModule("incidents");
                      else if (log.type === "auto_send" || log.type === "human_approved" || log.type === "human_edited") setZdTab("history");
                      else if (log.type === "human_review") setZdTab("queue");
                    }} style={{ padding: "8px 10px", marginBottom: 4, borderRadius: 6, background: typeConfig.bg, borderLeft: `2px solid ${typeConfig.color}`, cursor: "pointer", transition: "all 0.15s" }}
                      onMouseEnter={e => { e.currentTarget.style.background = typeConfig.color + "12"; e.currentTarget.style.transform = "translateX(2px)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = typeConfig.bg; e.currentTarget.style.transform = "translateX(0)"; }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <span style={{ fontSize: 12, flexShrink: 0 }}>{typeConfig.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 10, color: "#C4CAD6", lineHeight: 1.4 }}>{log.message}</div>
                          <div style={{ fontSize: 8, color: "#5A617888", fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>{new Date(log.timestamp).toLocaleString("en-SG")}</div>
                        </div>
                        <span style={{ fontSize: 9, color: "#5A617844", flexShrink: 0, alignSelf: "center" }}>→</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════ TAB: ENGINEER REVIEW QUEUE ══════════ */}
      {zdTab === "queue" && (
        <div>
          {pendingQueue.length === 0 ? (
            <div style={{ ...cardStyle, padding: 40, textAlign: "center" }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#81C784", marginBottom: 4 }}>All Clear — No Items Pending Review</div>
              <div style={{ fontSize: 11, color: "#5A6178", marginBottom: 16 }}>All AI-drafted responses have been reviewed. New tickets will appear here for your approval.</div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <button onClick={() => { if (zdConnected) zdAutoTriageBatch(); }} disabled={!zdConnected}
                  style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #6366F133", background: "#6366F118", color: zdConnected ? "#6366F1" : "#5A6178", cursor: zdConnected ? "pointer" : "not-allowed", fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                  🧠 AI Triage New Tickets
                </button>
                <button onClick={() => setZdTab("tickets")}
                  style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #1E2130", background: "#12141E", color: "#A0AEC0", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                  📋 View All Tickets
                </button>
                <button onClick={() => setZdTab("analytics")}
                  style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #1E2130", background: "#12141E", color: "#A0AEC0", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                  📊 View Analytics
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {sectionLabel("👤", "Requires Your Approval", pendingQueue.length)}
                  {(() => {
                    const now = Date.now();
                    const breached = pendingQueue.filter(q => q.slaDeadline && new Date(q.slaDeadline).getTime() <= now).length;
                    const urgent = pendingQueue.filter(q => { const r = q.slaDeadline ? (new Date(q.slaDeadline).getTime() - now) / 3600000 : 99; return r > 0 && r < 1; }).length;
                    const atRisk = pendingQueue.filter(q => { const r = q.slaDeadline ? (new Date(q.slaDeadline).getTime() - now) / 3600000 : 99; return r >= 1 && r < 2; }).length;
                    return <>
                      {breached > 0 && <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#FF6B6B22", color: "#FF6B6B", fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>🚨 {breached} BREACHED</span>}
                      {urgent > 0 && <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#FF6B6B22", color: "#FF6B6B", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>⏰ {urgent} URGENT</span>}
                      {atRisk > 0 && <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#FFB34722", color: "#FFB347", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>⚠️ {atRisk} AT RISK</span>}
                    </>;
                  })()}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {pendingQueue.filter(q => q.autoSendable && q.confidence >= 85).length > 0 && (
                    <button onClick={async () => {
                      const highConf = pendingQueue.filter(q => q.autoSendable && q.confidence >= 85);
                      if (!confirm(`Approve & send ${highConf.length} high-confidence (≥85%) AI responses?\n\nThis will send responses for:\n${highConf.map(q => `  #${q.ticketId} — ${q.ticketSubject} (${q.confidence}%)`).join("\n")}`)) return;
                      addAutoLog({ type: "info", message: `Batch approving ${highConf.length} high-confidence items...` });
                      let sent = 0;
                      for (const q of highConf) {
                        try { await zdApproveAndSend(q); sent++; } catch (e) {}
                      }
                      addAutoLog({ type: "human_approved", message: `Batch approved: ${sent}/${highConf.length} responses sent successfully` });
                    }} disabled={zdLoading}
                      style={{ padding: "7px 16px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #4CAF50, #81C784)", color: "#fff", cursor: zdLoading ? "wait" : "pointer", fontSize: 10, fontWeight: 700, boxShadow: "0 2px 8px #4CAF5033", whiteSpace: "nowrap" }}>
                      ⚡ Batch Approve ({pendingQueue.filter(q => q.autoSendable && q.confidence >= 85).length} high-confidence)
                    </button>
                  )}
                  {(() => {
                    const routineCategories = ["Password Reset", "Access/Identity", "Software", "Email", "Printing", "General"];
                    const routineItems = pendingQueue.filter(q => q.autoSendable && routineCategories.includes(q.category) && (q.confidence || 0) >= 70);
                    return routineItems.length > 0 ? (
                      <button onClick={async () => {
                        if (!confirm(`Auto-approve ${routineItems.length} routine category tickets?\n\nCategories: ${[...new Set(routineItems.map(q => q.category))].join(", ")}\n\n${routineItems.map(q => `  #${q.ticketId} — ${q.category} (${q.confidence}%)`).join("\n")}`)) return;
                        addAutoLog({ type: "info", message: `Batch approving ${routineItems.length} routine category items...` });
                        let sent = 0;
                        for (const q of routineItems) {
                          try { await zdApproveAndSend(q); sent++; } catch (e) {}
                        }
                        addAutoLog({ type: "human_approved", message: `Routine batch: ${sent}/${routineItems.length} sent successfully` });
                      }} disabled={zdLoading}
                        style={{ padding: "7px 16px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #6366F1, #818CF8)", color: "#fff", cursor: zdLoading ? "wait" : "pointer", fontSize: 10, fontWeight: 700, boxShadow: "0 2px 8px #6366F133", whiteSpace: "nowrap" }}>
                        🏷️ Approve Routine ({routineItems.length})
                      </button>
                    ) : null;
                  })()}
                  <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>⚠️ Human approval required</span>
                </div>
              </div>
              {/* ── Category-grouped review queue ── */}
              {(() => {
                const categoryGroups = {};
                pendingQueue.forEach((q, i) => {
                  const cat = q.category || "Uncategorized";
                  if (!categoryGroups[cat]) categoryGroups[cat] = [];
                  categoryGroups[cat].push({ ...q, _origIdx: i });
                });
                const categoryOrder = Object.keys(categoryGroups).sort((a, b) => {
                  // Sort by highest priority item in each group
                  const priOrder = { "Sev-A": 0, "Sev-B": 1, "Sev-C": 2, "Sev-D": 3 };
                  const aMin = Math.min(...categoryGroups[a].map(q => priOrder[q.slaPriority] ?? 3));
                  const bMin = Math.min(...categoryGroups[b].map(q => priOrder[q.slaPriority] ?? 3));
                  return aMin - bMin || a.localeCompare(b);
                });
                return categoryOrder.map(cat => (
                  <div key={cat}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", margin: "8px 0 4px", background: "#1E213008", borderBottom: "1px solid #1E2130" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#818CF8", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1 }}>
                        🏷️ {cat}
                      </span>
                      <span style={{ fontSize: 9, padding: "1px 8px", borderRadius: 8, background: "#818CF822", color: "#818CF8", fontWeight: 600 }}>
                        {categoryGroups[cat].length}
                      </span>
                    </div>
                    {categoryGroups[cat].map((q, i) => {
                // SLA countdown calculation
                const slaDeadlineMs = q.slaDeadline ? new Date(q.slaDeadline).getTime() : 0;
                const nowMs = Date.now();
                const slaRemainingMs = slaDeadlineMs - nowMs;
                const slaRemainingHrs = slaRemainingMs > 0 ? (slaRemainingMs / 3600000) : 0;
                const slaTotalHrs = q.slaTargetHours || 9;
                const slaPct = Math.max(0, Math.min(100, (slaRemainingHrs / slaTotalHrs) * 100));
                const slaBreached = slaRemainingMs <= 0;
                const slaUrgent = slaRemainingHrs < 1 && !slaBreached;
                const slaAtRisk = slaRemainingHrs < 2 && !slaUrgent && !slaBreached;
                const slaBarColor = slaBreached ? "#FF6B6B" : slaUrgent ? "#FF6B6B" : slaAtRisk ? "#FFB347" : "#81C784";
                const slaLabel = slaBreached ? "SLA BREACHED" : slaRemainingHrs < 1 ? `${Math.round(slaRemainingMs / 60000)}m remaining` : `${slaRemainingHrs.toFixed(1)}h remaining`;
                const isCustomerExpanded = zdExpandedSections[`${q.id}:customer`];
                const isDescExpanded = zdExpandedSections[`${q.id}:desc`];
                const isCommentsExpanded = zdExpandedSections[`${q.id}:comments`];

                return (
                <div key={q.id} style={{ ...cardStyle, padding: 16, marginBottom: 12, border: `1px solid ${slaBreached ? "#FF6B6B55" : q.confidence < 70 ? "#FF6B6B33" : "#FFB34733"}` }}>
                  {/* ── Header: Ticket, Priority, SLA, Confidence, Company ── */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#E8ECF4" }}>Ticket #{q.ticketId}</span>
                        {q.customerCompany && <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#06B6D412", color: "#06B6D4", fontWeight: 600 }}>🏢 {q.customerCompany}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "#C4CAD6", marginBottom: 6 }}>{q.ticketSubject}</div>
                      {q.requesterName && <div style={{ fontSize: 10, color: "#A0AEC0", marginBottom: 6 }}>👤 {q.requesterName}{q.requesterEmail ? ` · ${q.requesterEmail}` : ""}{q.historicalTicketCount > 1 ? ` · ${q.historicalTicketCount} previous tickets` : q.historicalTicketCount === 1 ? " · First ticket" : ""}</div>}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: priorityColor(q.suggestedPriority) + "22", color: priorityColor(q.suggestedPriority), fontWeight: 600 }}>Priority: {q.suggestedPriority}</span>
                        <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#6366F122", color: "#6366F1", fontWeight: 600 }}>{q.category}</span>
                        <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: slaPriorityColor(q.slaPriority) + "22", color: slaPriorityColor(q.slaPriority), fontWeight: 600 }}>SLA: {q.slaPriority}</span>
                        <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: q.confidence >= 80 ? "#81C78422" : q.confidence >= 60 ? "#FFB34722" : "#FF6B6B22", color: q.confidence >= 80 ? "#81C784" : q.confidence >= 60 ? "#FFB347" : "#FF6B6B", fontWeight: 600 }}>🎯 {q.confidence}%</span>
                        <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#06B6D422", color: "#06B6D4", fontWeight: 600 }}>→ {q.suggestedAssignee}</span>
                        {q.itsmIncidentId && <span onClick={(e) => { e.stopPropagation(); const inc = incidents.find(i => i.id === q.itsmIncidentId); if (inc) { setDetailItem(inc); setModal("incidentDetail"); } else { setActiveModule("incidents"); } }} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#6366F122", color: "#6366F1", fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }} onMouseEnter={e => { e.currentTarget.style.background = "#6366F144"; e.currentTarget.style.transform = "scale(1.05)"; }} onMouseLeave={e => { e.currentTarget.style.background = "#6366F122"; e.currentTarget.style.transform = "scale(1)"; }} title={`Open ${q.itsmIncidentId} in Incident Detail`}>🎫 {q.itsmIncidentId} →</span>}
                        {(q.suggestedTags || []).map((tag, ti) => <span key={ti} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 4, background: "#ffffff08", color: "#A0AEC0" }}>{tag}</span>)}
                      </div>
                    </div>
                    <div style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textAlign: "right" }}>
                      <div>{!q.autoSendable ? "⚠️ Not auto-sendable" : ""}</div>
                      <div>{new Date(q.createdAt).toLocaleString("en-SG")}</div>
                    </div>
                  </div>

                  {/* ── SLA Impact Bar ── */}
                  <div style={{ background: "#0A0C14", borderRadius: 6, padding: "6px 10px", marginBottom: 10, border: `1px solid ${slaBarColor}22` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 9, color: slaBarColor, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{slaBreached ? "🚨" : slaUrgent ? "⏰" : "⏱️"} {slaLabel}</span>
                      <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{q.slaPriority} · {slaTotalHrs}h target</span>
                    </div>
                    <div style={{ width: "100%", height: 4, background: "#1E2130", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${slaPct}%`, height: "100%", background: slaBarColor, borderRadius: 2, transition: "width 0.3s" }} />
                    </div>
                  </div>

                  {/* ── Collapsible: Customer Context ── */}
                  {(q.customerCompany || q.customerContract || q.historicalTicketCount > 0) && (
                    <div style={{ marginBottom: 8 }}>
                      <div onClick={() => zdToggleSection(q.id, "customer")} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "6px 10px", background: "#06B6D408", border: "1px solid #06B6D418", borderRadius: isCustomerExpanded ? "8px 8px 0 0" : 8, userSelect: "none" }}>
                        <span style={{ fontSize: 9, color: "#06B6D4", transform: isCustomerExpanded ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>▶</span>
                        <span style={{ fontSize: 9, color: "#06B6D4", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>🏢 CUSTOMER CONTEXT</span>
                        {!isCustomerExpanded && q.customerCompany && <span style={{ fontSize: 9, color: "#5A6178", marginLeft: 8 }}>{q.customerCompany}{q.customerContract ? ` · ${q.customerContract}` : ""}</span>}
                      </div>
                      {isCustomerExpanded && (
                        <div style={{ padding: "8px 12px", background: "#06B6D406", border: "1px solid #06B6D418", borderTop: "none", borderRadius: "0 0 8px 8px" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                            {q.customerCompany && <div><span style={{ fontSize: 8, color: "#5A6178", display: "block" }}>COMPANY</span><span style={{ fontSize: 11, color: "#C4CAD6" }}>{q.customerCompany}</span></div>}
                            {q.customerContract && <div><span style={{ fontSize: 8, color: "#5A6178", display: "block" }}>CONTRACT</span><span style={{ fontSize: 11, color: "#C4CAD6" }}>{q.customerContract}</span></div>}
                            {q.customerCategory && <div><span style={{ fontSize: 8, color: "#5A6178", display: "block" }}>CATEGORY</span><span style={{ fontSize: 11, color: "#C4CAD6" }}>{q.customerCategory}</span></div>}
                            {q.customerServices && <div><span style={{ fontSize: 8, color: "#5A6178", display: "block" }}>SERVICES</span><span style={{ fontSize: 11, color: "#C4CAD6" }}>{q.customerServices}</span></div>}
                          </div>
                          {q.historicalTicketCount > 0 && (
                            <div style={{ marginTop: 6, fontSize: 10, color: "#A0AEC0" }}>📊 {q.historicalTicketCount} total ticket{q.historicalTicketCount > 1 ? "s" : ""} from this requester{q.lastTicketDate ? ` · Last: ${new Date(q.lastTicketDate).toLocaleDateString("en-SG")}` : ""}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Collapsible: Original Request ── */}
                  {q.ticketDescription && (
                    <div style={{ marginBottom: 8 }}>
                      <div onClick={() => zdToggleSection(q.id, "desc")} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "6px 10px", background: "#3B82F608", border: "1px solid #3B82F618", borderRadius: isDescExpanded ? "8px 8px 0 0" : 8, userSelect: "none" }}>
                        <span style={{ fontSize: 9, color: "#3B82F6", transform: isDescExpanded ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>▶</span>
                        <span style={{ fontSize: 9, color: "#3B82F6", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>📝 ORIGINAL REQUEST</span>
                        {!isDescExpanded && <span style={{ fontSize: 9, color: "#5A6178", marginLeft: 8 }}>{(q.ticketDescription || "").substring(0, 80)}{(q.ticketDescription || "").length > 80 ? "…" : ""}</span>}
                      </div>
                      {isDescExpanded && (
                        <div style={{ padding: "8px 12px", background: "#3B82F606", border: "1px solid #3B82F618", borderTop: "none", borderRadius: "0 0 8px 8px", maxHeight: 200, overflow: "auto" }}>
                          <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{q.ticketDescription}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Collapsible: Conversation History ── */}
                  {(q.ticketComments || []).length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div onClick={() => zdToggleSection(q.id, "comments")} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "6px 10px", background: "#A78BFA08", border: "1px solid #A78BFA18", borderRadius: isCommentsExpanded ? "8px 8px 0 0" : 8, userSelect: "none" }}>
                        <span style={{ fontSize: 9, color: "#A78BFA", transform: isCommentsExpanded ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>▶</span>
                        <span style={{ fontSize: 9, color: "#A78BFA", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>💬 CONVERSATION HISTORY ({q.ticketComments.length})</span>
                      </div>
                      {isCommentsExpanded && (
                        <div style={{ padding: "8px 12px", background: "#A78BFA06", border: "1px solid #A78BFA18", borderTop: "none", borderRadius: "0 0 8px 8px", maxHeight: 250, overflow: "auto" }}>
                          {q.ticketComments.map((c, ci) => (
                            <div key={ci} style={{ marginBottom: ci < q.ticketComments.length - 1 ? 10 : 0, paddingBottom: ci < q.ticketComments.length - 1 ? 10 : 0, borderBottom: ci < q.ticketComments.length - 1 ? "1px solid #1E213044" : "none" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                <span style={{ fontSize: 10, color: c.authorRole === "end-user" ? "#FFB347" : "#81C784", fontWeight: 600 }}>{c.authorName || "Unknown"} <span style={{ fontWeight: 400, color: "#5A6178" }}>({c.authorRole === "end-user" ? "Customer" : c.authorRole === "agent" ? "Agent" : c.authorRole || ""})</span></span>
                                <span style={{ fontSize: 9, color: "#5A6178" }}>{c.createdAt ? new Date(c.createdAt).toLocaleString("en-SG", { dateStyle: "short", timeStyle: "short" }) : ""}</span>
                              </div>
                              <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{c.body}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Internal AI Analysis */}
                  <div style={{ background: "#FFB34708", border: "1px solid #FFB34722", borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
                    <div style={{ fontSize: 9, color: "#FFB347", fontWeight: 600, marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>🔒 AI INTERNAL ANALYSIS</div>
                    <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.5 }}>{q.internalNote}</div>
                  </div>

                  {/* Draft Response (editable) */}
                  <div style={{ background: "#0A0C14", borderRadius: 8, padding: "10px 14px", marginBottom: 12, border: "1px solid #1E213044" }}>
                    <div style={{ fontSize: 9, color: "#81C784", fontWeight: 600, marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>📧 AI DRAFT — CUSTOMER RESPONSE</div>
                    {zdEditingDraft === q.id ? (
                      <textarea value={zdEditedText} onChange={e => setZdEditedText(e.target.value)}
                        style={{ width: "100%", minHeight: 150, background: "#12141E", border: "1px solid #6366F133", borderRadius: 6, padding: 10, color: "#E8ECF4", fontSize: 11, lineHeight: 1.6, resize: "vertical", fontFamily: "inherit", outline: "none" }} />
                    ) : (
                      <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto" }}>{q.draftResponse}</div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button onClick={() => { setZdAiQueue(prev => prev.map(item => item.id === q.id ? { ...item, status: "rejected", reviewedBy: currentUser?.name } : item)); addAutoLog({ type: "error", ticketId: q.ticketId, subject: q.ticketSubject, message: `#${q.ticketId} AI draft rejected by ${currentUser?.name || "Admin"} — response will not be sent` }); }}
                      style={{ padding: "7px 18px", borderRadius: 6, border: "1px solid #FF6B6B33", background: "#FF6B6B11", color: "#FF6B6B", cursor: "pointer", fontSize: 10, fontWeight: 600 }}>✕ Reject</button>
                    {zdEditingDraft === q.id ? (
                      <>
                        <button onClick={() => { setZdEditingDraft(null); setZdEditedText(""); }}
                          style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid #1E2130", background: "#12141E", color: "#A0AEC0", cursor: "pointer", fontSize: 10, fontWeight: 600 }}>Cancel</button>
                        <button onClick={() => zdEditAndSend(q)}
                          style={{ padding: "7px 18px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #6366F1, #818CF8)", color: "#fff", cursor: "pointer", fontSize: 10, fontWeight: 700, boxShadow: "0 2px 8px #6366F133" }}>📤 Send Edited Response</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { setZdEditingDraft(q.id); setZdEditedText(q.draftResponse); }}
                          style={{ padding: "7px 18px", borderRadius: 6, border: "1px solid #6366F133", background: "#6366F118", color: "#6366F1", cursor: "pointer", fontSize: 10, fontWeight: 600 }}>✏️ Edit Draft</button>
                        <button onClick={() => zdApproveAndSend(q)}
                          style={{ padding: "7px 20px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #4CAF50, #81C784)", color: "#fff", cursor: "pointer", fontSize: 10, fontWeight: 700, boxShadow: "0 2px 8px #4CAF5033" }}>✓ Approve & Send</button>
                      </>
                    )}
                  </div>
                </div>
                );
                    })}
                  </div>
                ));
              })()}
            </div>
          )}
        </div>
      )}

      {/* ══════════ TAB: ALL TICKETS ══════════ */}
      {zdTab === "tickets" && (
        <div>
          {/* Filter Tabs */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {["open", "pending", "hold", "solved", "closed"].map(f => (
              <button key={f} onClick={() => { setZdFilter(f); zdFetchTickets(f, 1); }}
                style={{ padding: "6px 16px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", textTransform: "capitalize", fontFamily: "'JetBrains Mono', monospace", background: zdFilter === f ? "#FFB34722" : "#ffffff06", color: zdFilter === f ? "#FFB347" : "#5A6178", border: `1px solid ${zdFilter === f ? "#FFB34744" : "#1E2130"}` }}>
                {statusIcon(f)} {f}
              </button>
            ))}
          </div>

          {/* Ticket List + Detail Split View */}
          <div style={{ display: "grid", gridTemplateColumns: zdSelectedTicket ? "1fr 1.3fr" : "1fr", gap: 14 }}>
            <div style={cardStyle}>
              {zdLoading && zdTickets.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "#5A6178" }}>
                  <div style={{ fontSize: 24, marginBottom: 8, animation: "zdSpin 1s linear infinite", display: "inline-block" }}>⟳</div>
                  <div style={{ fontSize: 12 }}>Loading tickets...</div>
                </div>
              ) : zdTickets.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "#5A6178", fontSize: 12 }}>No tickets found.</div>
              ) : (
                <>
                {zdTickets.slice(0, zdRenderLimit).map((ticket, i) => {
                  const aiItem = zdAiQueue.find(q => q.ticketId === ticket.id);
                  const triaged = zdTriagedIds.has(ticket.id);
                  return (
                    <div key={ticket.id} onClick={() => zdSelectTicket(ticket)}
                      style={{ padding: "12px 16px", borderBottom: "1px solid #1E213033", cursor: "pointer", background: zdSelectedTicket?.id === ticket.id ? "#1E213044" : "transparent", transition: "background 0.2s" }}
                      onMouseEnter={e => { if (zdSelectedTicket?.id !== ticket.id) e.currentTarget.style.background = "#1E213022"; }}
                      onMouseLeave={e => { if (zdSelectedTicket?.id !== ticket.id) e.currentTarget.style.background = "transparent"; }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>#{ticket.id}</span>
                            {ticket.priority && <span style={{ width: 6, height: 6, borderRadius: "50%", background: priorityColor(ticket.priority), flexShrink: 0 }} />}
                            {aiItem && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: aiItem.status === "pending_approval" ? "#FFB34722" : aiItem.status === "sent" ? "#81C78422" : "#FF6B6B22", color: aiItem.status === "pending_approval" ? "#FFB347" : aiItem.status === "sent" ? "#81C784" : "#FF6B6B", fontWeight: 600 }}>{aiItem.status === "pending_approval" ? "⚠️ AWAITING APPROVAL" : aiItem.status === "sent" ? "✅ APPROVED & SENT" : "❌"}</span>}
                            {triaged && !aiItem && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#81C78422", color: "#81C784", fontWeight: 600 }}>✅ TRIAGED</span>}
                          </div>
                          <div style={{ fontSize: 12, color: "#E8ECF4", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ticket.subject || "No subject"}</div>
                          <div style={{ fontSize: 10, color: "#5A617899", marginTop: 3 }}>{new Date(ticket.created_at).toLocaleDateString("en-SG")} · {ticket.status}</div>
                        </div>
                        {azureOpenAI.enabled && !triaged && (ticket.status === "open" || ticket.status === "new") && (
                          <button onClick={e => { e.stopPropagation(); zdAiTriageSingle(ticket.id); }}
                            style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #EC489933", background: "#EC489911", color: "#EC4899", cursor: "pointer", fontSize: 9, fontWeight: 600, flexShrink: 0 }}>
                            🤖 Triage
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {zdTickets.length > zdRenderLimit && (
                  <div style={{ padding: "10px 16px", textAlign: "center" }}>
                    <button onClick={() => setZdRenderLimit(l => l + 200)}
                      style={{ padding: "6px 14px", borderRadius: 4, border: "1px solid #1E2130", background: "#12141E", color: "#FFB347", cursor: "pointer", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
                      Showing {zdRenderLimit} of {zdTickets.length} — Load 200 more →
                    </button>
                  </div>
                )}
                </>
              )}
              {zdTickets.length > 0 && (
                <div style={{ padding: "10px 16px", display: "flex", justifyContent: "center", gap: 8 }}>
                  <button disabled={zdPage <= 1} onClick={() => zdFetchTickets(zdFilter, zdPage - 1)}
                    style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid #1E2130", background: "#12141E", color: zdPage <= 1 ? "#333" : "#A0AEC0", cursor: zdPage <= 1 ? "default" : "pointer", fontSize: 10 }}>← Prev</button>
                  <span style={{ fontSize: 10, color: "#5A6178", padding: "4px 8px" }}>Page {zdPage}</span>
                  <button onClick={() => zdFetchTickets(zdFilter, zdPage + 1)}
                    style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid #1E2130", background: "#12141E", color: "#A0AEC0", cursor: "pointer", fontSize: 10 }}>Next →</button>
                </div>
              )}
            </div>

            {/* Ticket Detail Panel */}
            {zdSelectedTicket && (
              <div style={{ ...cardStyle, display: "flex", flexDirection: "column", maxHeight: "70vh" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid #1E2130", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: "#FFB347", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>#{zdSelectedTicket.id}</span>
                      <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: priorityColor(zdSelectedTicket.priority) + "22", color: priorityColor(zdSelectedTicket.priority), fontWeight: 600, textTransform: "uppercase" }}>{zdSelectedTicket.priority || "—"}</span>
                      <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#1E2130", color: "#A0AEC0", textTransform: "uppercase" }}>{zdSelectedTicket.status}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "#E8ECF4", fontWeight: 600 }}>{zdSelectedTicket.subject || "No subject"}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {azureOpenAI.enabled && (zdSelectedTicket.status === "open" || zdSelectedTicket.status === "new") && (
                      <button onClick={() => zdAiTriageSingle(zdSelectedTicket.id)} disabled={zdAiProcessing}
                        style={{ padding: "5px 12px", borderRadius: 5, border: "1px solid #EC489933", background: "#EC489918", color: "#EC4899", cursor: "pointer", fontSize: 10, fontWeight: 600 }}>
                        {zdAiProcessing ? "⟳ Analyzing..." : "🤖 AI Triage"}
                      </button>
                    )}
                    <button onClick={() => setZdSelectedTicket(null)} style={{ background: "none", border: "none", color: "#5A6178", cursor: "pointer", fontSize: 16 }}>✕</button>
                  </div>
                </div>
                <div style={{ padding: "12px 18px", borderBottom: "1px solid #1E213022" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                    <div><span style={{ fontSize: 9, color: "#5A6178", display: "block", marginBottom: 2, fontFamily: "'JetBrains Mono', monospace" }}>CREATED</span><span style={{ fontSize: 11, color: "#C4CAD6" }}>{new Date(zdSelectedTicket.created_at).toLocaleString("en-SG")}</span></div>
                    <div><span style={{ fontSize: 9, color: "#5A6178", display: "block", marginBottom: 2, fontFamily: "'JetBrains Mono', monospace" }}>UPDATED</span><span style={{ fontSize: 11, color: "#C4CAD6" }}>{new Date(zdSelectedTicket.updated_at).toLocaleString("en-SG")}</span></div>
                    <div><span style={{ fontSize: 9, color: "#5A6178", display: "block", marginBottom: 2, fontFamily: "'JetBrains Mono', monospace" }}>TYPE</span><span style={{ fontSize: 11, color: "#C4CAD6" }}>{zdSelectedTicket.type || "—"}</span></div>
                  </div>
                  {zdSelectedTicket.tags?.length > 0 && (
                    <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {zdSelectedTicket.tags.map((tag, i) => <span key={i} style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#ffffff08", color: "#A0AEC0", border: "1px solid #1E213044" }}>{tag}</span>)}
                    </div>
                  )}
                  {/* Show AI triage results for this ticket */}
                  {zdAiQueue.find(q => q.ticketId === zdSelectedTicket.id) && (() => {
                    const ai = zdAiQueue.find(q => q.ticketId === zdSelectedTicket.id);
                    return (
                      <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, background: "#EC489908", border: "1px solid #EC489922" }}>
                        <div style={{ fontSize: 9, color: "#EC4899", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>🤖 AI TRIAGE RESULT</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#6366F122", color: "#6366F1", fontWeight: 600 }}>{ai.category}</span>
                          <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: priorityColor(ai.suggestedPriority) + "22", color: priorityColor(ai.suggestedPriority), fontWeight: 600 }}>{ai.suggestedPriority}</span>
                          <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#81C78422", color: "#81C784", fontWeight: 600 }}>🎯 {ai.confidence}%</span>
                          <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#06B6D422", color: "#06B6D4", fontWeight: 600 }}>→ {ai.suggestedAssignee}</span>
                          <span onClick={() => setZdTab(ai.status === "sent" || ai.status === "rejected" ? "history" : "queue")} style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: ai.status === "sent" ? "#81C78422" : ai.status === "rejected" ? "#FF6B6B22" : "#FFB34722", color: ai.status === "sent" ? "#81C784" : ai.status === "rejected" ? "#FF6B6B" : "#FFB347", fontWeight: 600, cursor: "pointer" }}>{ai.status === "sent" ? "✅ Approved & Sent" : ai.status === "rejected" ? "❌ Rejected" : "⏳ Awaiting Approval →"}</span>
                        </div>
                        <div style={{ fontSize: 10, color: "#A0AEC0", marginTop: 6, lineHeight: 1.4 }}>{ai.internalNote}</div>
                      </div>
                    );
                  })()}
                </div>
                <div style={{ flex: 1, overflow: "auto", padding: "14px 18px" }}>
                  <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>💬 CONVERSATION ({zdComments.length})</div>
                  {zdComments.map((comment, i) => (
                    <div key={comment.id || i} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: comment.public ? "#64B5F6" : "#FFB347" }}>{comment.public ? "📧" : "🔒"} {comment.author_name || comment.author_id}</span>
                        <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{new Date(comment.created_at).toLocaleString("en-SG")}</span>
                      </div>
                      <div style={{ background: comment.public ? "#0A0C14" : "#FFB34708", borderRadius: 6, padding: "8px 10px", border: `1px solid ${comment.public ? "#1E213044" : "#FFB34722"}`, fontSize: 11, color: "#C4CAD6", lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto" }}>
                        {(comment.body || "").replace(/<[^>]*>/g, "").substring(0, 2000)}
                      </div>
                    </div>
                  ))}
                  {zdComments.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#5A6178", fontSize: 11 }}>No comments loaded.</div>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════ TAB: AI HISTORY ══════════ */}
      {zdTab === "history" && (
        <div>
          {/* Detail Modal */}
          {zdDetailItem && (
            <div style={{ ...cardStyle, padding: 20, marginBottom: 16, border: "1px solid #6366F133", position: "relative" }}>
              <button onClick={() => setZdDetailItem(null)} style={{ position: "absolute", top: 10, right: 12, background: "none", border: "none", color: "#5A6178", cursor: "pointer", fontSize: 18 }}>✕</button>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <span style={{ fontSize: 22 }}>{zdDetailItem.status === "sent" ? "✅" : zdDetailItem.status === "rejected" ? "❌" : "⏳"}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4" }}>Ticket #{zdDetailItem.ticketId} — {zdDetailItem.ticketSubject}</div>
                  <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
                    👤 {zdDetailItem.requesterName} ({zdDetailItem.requesterEmail}) · {new Date(zdDetailItem.createdAt).toLocaleString("en-SG")}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#6366F122", color: "#6366F1", fontWeight: 600 }}>{zdDetailItem.category}</span>
                <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: priorityColor(zdDetailItem.suggestedPriority) + "22", color: priorityColor(zdDetailItem.suggestedPriority), fontWeight: 600 }}>{zdDetailItem.suggestedPriority}</span>
                <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#81C78422", color: "#81C784", fontWeight: 600 }}>🎯 {zdDetailItem.confidence}%</span>
                <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#06B6D422", color: "#06B6D4", fontWeight: 600 }}>→ {zdDetailItem.suggestedAssignee}</span>
                {zdDetailItem.itsmIncidentId && <span onClick={() => { const inc = incidents.find(i => i.id === zdDetailItem.itsmIncidentId); if (inc) { setDetailItem(inc); setModal("incidentDetail"); } else setActiveModule("incidents"); }} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#EC489922", color: "#EC4899", fontWeight: 600, cursor: "pointer" }}>🎫 {zdDetailItem.itsmIncidentId} →</span>}
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#FFB347", marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>🔒 INTERNAL NOTE</div>
                <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.5, padding: "8px 12px", background: "#FFB34708", borderRadius: 6, border: "1px solid #FFB34722" }}>{zdDetailItem.internalNote}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#64B5F6", marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>📧 AI DRAFT RESPONSE</div>
                <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.5, padding: "10px 14px", background: "#0A0C14", borderRadius: 6, border: "1px solid #1E2130", whiteSpace: "pre-wrap" }}>{zdDetailItem.draftResponse}</div>
              </div>
              {zdDetailItem.reviewedBy && (
                <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6, background: "#4CAF5008", border: "1px solid #4CAF5022", fontSize: 10, color: "#81C784" }}>
                  ✅ Reviewed by {zdDetailItem.reviewedBy} on {new Date(zdDetailItem.reviewedAt).toLocaleString("en-SG")}
                </div>
              )}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {/* Approved & Sent */}
            <div style={{ ...cardStyle, padding: 16 }}>
              {sectionLabel("✅", "Approved & Sent", approvedSentQueue.length)}
              {approvedSentQueue.length === 0 ? (
                <div style={{ padding: 20, textAlign: "center", color: "#5A6178", fontSize: 11 }}>No approved responses yet</div>
              ) : approvedSentQueue.slice(0, 20).map(q => (
                <div key={q.id} onClick={() => setZdDetailItem(q)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", borderBottom: "1px solid #1E213022", cursor: "pointer", borderRadius: 4, transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#81C78406"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                  <span style={{ fontSize: 12 }}>✅</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: "#C4CAD6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>#{q.ticketId} — {q.ticketSubject}</div>
                    <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
                      <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#81C78422", color: "#81C784", fontWeight: 600 }}>{q.confidence}%</span>
                      <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#6366F122", color: "#6366F1", fontWeight: 600 }}>{q.category}</span>
                      <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#4CAF5022", color: "#4CAF50", fontWeight: 600 }}>By: {q.reviewedBy}</span>
                      {q.itsmIncidentId && <span onClick={(e) => { e.stopPropagation(); const inc = incidents.find(i => i.id === q.itsmIncidentId); if (inc) { setDetailItem(inc); setModal("incidentDetail"); } else { setActiveModule("incidents"); } }} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#EC489922", color: "#EC4899", fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }} onMouseEnter={e => { e.currentTarget.style.background = "#EC489944"; }} onMouseLeave={e => { e.currentTarget.style.background = "#EC489922"; }} title={`Open ${q.itsmIncidentId}`}>🎫 {q.itsmIncidentId} →</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: 8, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{new Date(q.createdAt).toLocaleDateString("en-SG")}</span>
                </div>
              ))}
            </div>

            {/* Rejected */}
            <div style={{ ...cardStyle, padding: 16 }}>
              {sectionLabel("❌", "Rejected", rejectedQueue.length)}
              {rejectedQueue.length === 0 ? (
                <div style={{ padding: 20, textAlign: "center", color: "#5A6178", fontSize: 11 }}>No rejected responses yet</div>
              ) : rejectedQueue.slice(0, 20).map(q => (
                <div key={q.id} onClick={() => setZdDetailItem(q)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", borderBottom: "1px solid #1E213022", cursor: "pointer", borderRadius: 4, transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#FF6B6B06"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                  <span style={{ fontSize: 12 }}>{q.status === "sent" ? "✅" : "❌"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: "#C4CAD6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>#{q.ticketId} — {q.ticketSubject}</div>
                    <div style={{ fontSize: 8, color: "#5A6178" }}>{q.status === "sent" ? "Approved" : "Rejected"} by {q.reviewedBy}</div>
                  </div>
                  <span style={{ fontSize: 8, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{new Date(q.createdAt).toLocaleDateString("en-SG")}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════ TAB: ANALYTICS ══════════ */}
      {zdTab === "analytics" && (() => {
        const catBreakdown = {};
        const priBreakdown = {};
        zdAiQueue.forEach(q => {
          catBreakdown[q.category] = (catBreakdown[q.category] || 0) + 1;
          priBreakdown[q.suggestedPriority] = (priBreakdown[q.suggestedPriority] || 0) + 1;
        });
        const catColors = { Network: "#6366F1", Software: "#64B5F6", Security: "#FF6B6B", Hardware: "#FFB347", Access: "#81C784", General: "#EC4899" };
        const priColors = { Critical: "#FF6B6B", High: "#FF6B6B", Medium: "#FFB347", Normal: "#64B5F6", Low: "#81C784" };
        const totalQ = zdAiQueue.length || 1;
        return (
          <div>
            {/* Summary Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Total Processed", value: zdAutoStats.totalTriaged, color: "#6366F1", icon: "🤖", tab: "history" },
                { label: "Approved & Sent", value: zdAutoStats.autoSent, color: "#81C784", icon: "✅", tab: "history" },
                { label: "Pending Review", value: pendingQueue.length, color: "#FFB347", icon: "👤", tab: "queue" },
                { label: "ITSM Incidents", value: zdAutoStats.incidentsCreated, color: "#EC4899", icon: "🎫", tab: "_incidents" },
                { label: "Avg Confidence", value: `${zdAutoStats.avgConfidence}%`, color: "#06B6D4", icon: "🎯", tab: "history" },
              ].map((s, i) => (
                <div key={i} onClick={() => s.tab === "_incidents" ? setActiveModule("incidents") : setZdTab(s.tab)} style={{ padding: "16px", background: "#0F1117", borderRadius: 10, border: `1px solid ${s.color}33`, textAlign: "center", cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 4px 12px ${s.color}22`; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>
                  <div style={{ fontSize: 28, marginBottom: 4 }}>{s.icon}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: s.color, fontFamily: "'Space Grotesk', sans-serif" }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: "#5A6178", marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
              {/* Category Breakdown */}
              <div style={{ ...cardStyle, padding: 18 }}>
                {sectionLabel("📂", "Category Breakdown")}
                {Object.entries(catBreakdown).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
                  <div key={cat} onClick={() => { setZdTab("tickets"); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #1E213022", cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#ffffff04"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: catColors[cat] || "#5A6178", flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: "#E8ECF4", fontWeight: 600, flex: 1 }}>{cat}</span>
                    <span style={{ fontSize: 11, color: catColors[cat] || "#5A6178", fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{count}</span>
                    <div style={{ width: 80, height: 6, borderRadius: 3, background: "#1E2130", overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 3, background: catColors[cat] || "#5A6178", width: `${(count / totalQ) * 100}%` }} />
                    </div>
                  </div>
                ))}
                {Object.keys(catBreakdown).length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#5A6178", fontSize: 11 }}>No data yet — triage tickets to see breakdown</div>}
              </div>

              {/* Priority Breakdown */}
              <div style={{ ...cardStyle, padding: 18 }}>
                {sectionLabel("⚡", "Priority Breakdown")}
                {Object.entries(priBreakdown).sort((a, b) => b[1] - a[1]).map(([pri, count]) => (
                  <div key={pri} onClick={() => { setZdTab("tickets"); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #1E213022", cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#ffffff04"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: priColors[pri] || "#5A6178", flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: "#E8ECF4", fontWeight: 600, flex: 1 }}>{pri}</span>
                    <span style={{ fontSize: 11, color: priColors[pri] || "#5A6178", fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{count}</span>
                    <div style={{ width: 80, height: 6, borderRadius: 3, background: "#1E2130", overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 3, background: priColors[pri] || "#5A6178", width: `${(count / totalQ) * 100}%` }} />
                    </div>
                  </div>
                ))}
                {Object.keys(priBreakdown).length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#5A6178", fontSize: 11 }}>No data yet</div>}
              </div>
            </div>

            {/* Confidence Distribution */}
            <div style={{ ...cardStyle, padding: 18, marginBottom: 16 }}>
              {sectionLabel("🎯", "AI Confidence Distribution")}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                {[
                  { label: "High (≥90%)", range: [90, 100], color: "#81C784" },
                  { label: "Good (80-89%)", range: [80, 89], color: "#64B5F6" },
                  { label: "Moderate (70-79%)", range: [70, 79], color: "#FFB347" },
                  { label: "Low (<70%)", range: [0, 69], color: "#FF6B6B" },
                ].map((band, i) => {
                  const count = zdAiQueue.filter(q => q.confidence >= band.range[0] && q.confidence <= band.range[1]).length;
                  return (
                    <div key={i} onClick={() => setZdTab("queue")} style={{ padding: "14px", background: `${band.color}08`, borderRadius: 8, border: `1px solid ${band.color}33`, textAlign: "center", cursor: "pointer", transition: "all 0.2s" }}
                      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 4px 12px ${band.color}22`; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: band.color }}>{count}</div>
                      <div style={{ fontSize: 9, color: "#5A6178", marginTop: 4 }}>{band.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recent AI Triage Log */}
            <div style={{ ...cardStyle, padding: 18 }}>
              {sectionLabel("📡", "Recent AI Activity")}
              {zdAutoLog.slice(0, 10).map((log, i) => {
                const typeConfig = { auto_send: { icon: "⚡", color: "#81C784" }, human_review: { icon: "👤", color: "#FFB347" }, human_approved: { icon: "✅", color: "#4CAF50" }, human_edited: { icon: "✏️", color: "#64B5F6" }, incident_created: { icon: "🎫", color: "#6366F1" }, error: { icon: "❌", color: "#FF6B6B" }, info: { icon: "ℹ️", color: "#5A6178" }, config: { icon: "⚙️", color: "#EC4899" } }[log.type] || { icon: "📋", color: "#5A6178" };
                const logAction = () => {
                  if (log.type === "incident_created") setActiveModule("incidents");
                  else if (log.type === "auto_send" || log.type === "human_approved" || log.type === "human_edited") setZdTab("history");
                  else if (log.type === "human_review") setZdTab("queue");
                  else setZdTab("automation");
                };
                return (
                  <div key={log.id} onClick={logAction} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 0", borderBottom: i < 9 ? "1px solid #1E213022" : "none", cursor: "pointer", borderRadius: 4, transition: "background 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.background = typeConfig.color + "0A"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <span style={{ fontSize: 12, flexShrink: 0 }}>{typeConfig.icon}</span>
                    <div style={{ flex: 1, fontSize: 10, color: "#C4CAD6", lineHeight: 1.4 }}>{log.message}</div>
                    <span style={{ fontSize: 8, color: "#5A617888", fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>{new Date(log.timestamp).toLocaleString("en-SG", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ══════════ TAB: SYNC & MIGRATION ══════════ */}
      {zdTab === "sync" && (
        <div>
          {/* Sync Status Banner */}
          <div style={{ background: zdRealTimeEnabled ? "linear-gradient(135deg, #0F1117, #4CAF5008, #0F1117)" : "#0F1117", borderRadius: 12, border: `1px solid ${zdRealTimeEnabled ? "#4CAF5044" : "#1E2130"}`, padding: "16px 22px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: zdRealTimeEnabled ? "#4CAF5022" : "#1E2130", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🔄</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4", display: "flex", alignItems: "center", gap: 10 }}>
                  Real-Time Bidirectional Sync
                  <span style={{ fontSize: 9, padding: "2px 10px", borderRadius: 10, fontWeight: 700, background: zdRealTimeEnabled ? "#4CAF5022" : "#FF444422", color: zdRealTimeEnabled ? "#4CAF50" : "#FF4444", animation: zdRealTimeEnabled ? "zdPulse 2s infinite" : "none" }}>
                    {zdRealTimeEnabled ? "ACTIVE — Sync every 90s" : "PAUSED"}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginTop: 3 }}>
                  Zendesk ↔ ITSM · Changes in either system auto-sync · Webhook-ready for instant updates
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div onClick={() => { const nv = !zdRealTimeEnabled; setZdRealTimeEnabled(nv); localStorage.setItem("vgc_zd_realtime", JSON.stringify(nv)); addAutoLog({ type: "config", message: nv ? "Real-time sync ENABLED — incremental sync every 90s" : "Real-time sync DISABLED" }); }}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, cursor: "pointer", background: zdRealTimeEnabled ? "#4CAF5022" : "#1E2130", border: `1px solid ${zdRealTimeEnabled ? "#4CAF5044" : "#1E2130"}` }}>
                <div style={{ width: 32, height: 16, borderRadius: 8, background: zdRealTimeEnabled ? "#4CAF50" : "#333", position: "relative", transition: "all 0.3s" }}>
                  <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: zdRealTimeEnabled ? 18 : 2, transition: "left 0.3s" }} />
                </div>
                <span style={{ fontSize: 9, fontWeight: 600, color: zdRealTimeEnabled ? "#4CAF50" : "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>REAL-TIME</span>
              </div>
            </div>
          </div>

          {/* Sync Metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
            {[
              { label: "ZD Tickets (DB)", value: zdSyncStatus?.counts?.zdTickets || 0, color: "#64B5F6", icon: "🎫", tab: "tickets" },
              { label: "ZD Users (DB)", value: zdSyncStatus?.counts?.zdUsers || 0, color: "#EC4899", icon: "👤", tab: "settings" },
              { label: "ZD Orgs (DB)", value: zdSyncStatus?.counts?.zdOrgs || 0, color: "#FFB347", icon: "🏢", tab: "settings" },
              { label: "ZD Comments (DB)", value: zdSyncStatus?.counts?.zdComments || 0, color: "#81C784", icon: "💬", tab: "tickets" },
              { label: "ITSM Incidents", value: zdSyncStatus?.counts?.itsmIncidents || incidents.length, color: "#6366F1", icon: "📋", action: () => setActiveModule("incidents") },
              { label: "Last Full Import", value: zdSyncStatus?.lastFullImport?.completedAt ? new Date(zdSyncStatus.lastFullImport.completedAt).toLocaleDateString("en-SG") : "Never", color: "#CE93D8", icon: "📦", tab: "sync" },
              { label: "Last Sync", value: zdSyncStatus?.lastIncrementalSync?.completedAt ? new Date(zdSyncStatus.lastIncrementalSync.completedAt).toLocaleTimeString("en-SG") : "Never", color: "#06B6D4", icon: "🔄", tab: "sync" },
            ].map((s, i) => (
              <div key={i} onClick={() => s.action ? s.action() : s.tab && setZdTab(s.tab)} style={{ padding: "12px 14px", background: "#0F1117", borderRadius: 10, border: `1px solid ${s.color}33`, cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = s.color + "88"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 4px 12px ${s.color}22`; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = s.color + "33"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>
                <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>{s.icon} {s.label}</div>
                <div style={{ fontSize: typeof s.value === "number" ? 22 : 13, fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {/* Full Historical Import */}
            <div style={{ ...cardStyle, padding: 18 }}>
              {sectionLabel("📦", "Full Historical Import")}
              <div style={{ fontSize: 11, color: "#A0AEC0", lineHeight: 1.6, marginBottom: 16 }}>
                Import ALL Zendesk data into your ITSM database — tickets (including closed), users, organizations, comments, and attachments metadata.
                This enables AI-powered analysis using your full ticket history.
              </div>
              {zdSyncProgress && (
                <div style={{ padding: "10px 14px", borderRadius: 8, marginBottom: 14, background: zdSyncProgress.phase === "Error" ? "#FF6B6B08" : zdSyncProgress.phase === "Complete" ? "#81C78408" : "#6366F108", border: `1px solid ${zdSyncProgress.phase === "Error" ? "#FF6B6B33" : zdSyncProgress.phase === "Complete" ? "#81C78433" : "#6366F133"}` }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: zdSyncProgress.phase === "Error" ? "#FF6B6B" : zdSyncProgress.phase === "Complete" ? "#81C784" : "#6366F1", fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>
                    {zdSyncProgress.phase === "Error" ? "❌" : zdSyncProgress.phase === "Complete" ? "✅" : "⟳"} {zdSyncProgress.phase}
                  </div>
                  <div style={{ fontSize: 10, color: "#C4CAD6" }}>{zdSyncProgress.message}</div>
                </div>
              )}
              <div style={{ display: "grid", gap: 8 }}>
                <button onClick={() => zdFullImport({ createIncidents: false })} disabled={zdSyncInProgress || !zdConnected}
                  style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #6366F133", background: zdSyncInProgress ? "#6366F108" : "#6366F118", color: "#6366F1", cursor: zdSyncInProgress ? "wait" : "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", width: "100%" }}>
                  {zdSyncInProgress ? "⟳ Importing..." : "📦 Import All Zendesk Data (Data Only)"}
                </button>
                <button onClick={() => zdFullImport({ createIncidents: true })} disabled={zdSyncInProgress || !zdConnected}
                  style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #EC489933", background: zdSyncInProgress ? "#EC489908" : "#EC489918", color: "#EC4899", cursor: zdSyncInProgress ? "wait" : "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", width: "100%" }}>
                  {zdSyncInProgress ? "⟳ Importing..." : "📦 Import + Create ITSM Incidents for All Tickets"}
                </button>
                <button onClick={zdTrainAi} disabled={zdSyncInProgress || !zdConnected}
                  style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #81C78433", background: "#81C78418", color: "#81C784", cursor: zdSyncInProgress ? "wait" : "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", width: "100%" }}>
                  🧠 Train AI from Resolved Zendesk Tickets
                </button>
                <button onClick={async () => {
                  try {
                    const r = await fetch("/api/zendesk/sync-organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
                    if (r.ok) { const data = await r.json(); addAutoLog({ type: "info", message: `Orgs synced: ${data.synced} updated, ${data.created} new customers created` }); const custR = await fetch("/api/db/customers"); if (custR.ok) { const custData = await custR.json(); if (custData.data) setCustomers(custData.data); } }
                  } catch (e) { addAutoLog({ type: "error", message: `Org sync failed: ${e.message}` }); }
                }} disabled={!zdConnected}
                  style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #FFB34733", background: "#FFB34718", color: "#FFB347", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", width: "100%" }}>
                  🏢 Sync Organizations → ITSM Customers
                </button>
              </div>
            </div>

            {/* Sync Architecture & Webhook Setup */}
            <div style={{ ...cardStyle, padding: 18 }}>
              {sectionLabel("🏗️", "Sync Architecture")}
              <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
                {[
                  { icon: "📥", label: "Zendesk → ITSM", desc: "Tickets, users, orgs auto-sync to local DB. Linked incidents update status/priority in real-time.", color: "#64B5F6", active: zdRealTimeEnabled, action: () => setZdTab("tickets") },
                  { icon: "📤", label: "ITSM → Zendesk", desc: "Status, priority, comments on ITSM incidents auto-push to linked Zendesk tickets.", color: "#EC4899", active: zdRealTimeEnabled, action: () => setActiveModule("incidents") },
                  { icon: "🔔", label: "Webhook (Instant)", desc: "Configure Zendesk webhook to POST to /api/zendesk/webhook for instant sync on ticket events.", color: "#FFB347", active: true, action: null },
                  { icon: "🧠", label: "AI Knowledge", desc: "Resolved Zendesk tickets feed AI knowledge base. AI learns from historical resolutions.", color: "#81C784", active: true, action: () => setActiveModule("knowledge") },
                  { icon: "🔄", label: "Incremental Sync", desc: "Every 90s polls Zendesk incremental API for changes since last sync — minimal API usage.", color: "#6366F1", active: zdRealTimeEnabled, action: () => setZdTab("settings") },
                  { icon: "📊", label: "Full Data Mirror", desc: "Complete local copy of all Zendesk data for AI analysis, reporting, and Zendesk decommission prep.", color: "#CE93D8", active: (zdSyncStatus?.counts?.zdTickets || 0) > 0, action: () => setZdTab("sync") },
                ].map((item, i) => (
                  <div key={i} onClick={() => item.action && item.action()} style={{ display: "flex", gap: 10, padding: "8px 12px", borderRadius: 8, background: item.active ? `${item.color}08` : "#12141E", border: `1px solid ${item.active ? item.color + "22" : "#1E213033"}`, cursor: item.action ? "pointer" : "default", transition: "all 0.2s" }}
                    onMouseEnter={e => { if (item.action) { e.currentTarget.style.borderColor = item.color + "55"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = item.active ? item.color + "22" : "#1E213033"; e.currentTarget.style.transform = "translateY(0)"; }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: item.active ? item.color : "#5A6178", display: "flex", alignItems: "center", gap: 6 }}>
                        {item.label}
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: item.active ? "#4CAF50" : "#FF4444" }} />
                      </div>
                      <div style={{ fontSize: 9, color: "#5A617888", marginTop: 2 }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Webhook URL */}
              <div style={{ background: "#0A0C14", borderRadius: 8, padding: "12px 14px", border: "1px solid #1E213044" }}>
                <div style={{ fontSize: 9, color: "#FFB347", fontWeight: 600, marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>🔔 ZENDESK WEBHOOK URL (configure in Zendesk Admin)</div>
                <div style={{ fontSize: 10, color: "#64B5F6", fontFamily: "'JetBrains Mono', monospace", wordBreak: "break-all", background: "#12141E", padding: "8px 10px", borderRadius: 4, border: "1px solid #1E213044", cursor: "pointer" }}
                  onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/api/zendesk/webhook`); addAutoLog({ type: "info", message: "Webhook URL copied to clipboard" }); }}>
                  {window.location.origin}/api/zendesk/webhook
                  <span style={{ marginLeft: 8, fontSize: 8, color: "#5A6178" }}>(click to copy)</span>
                </div>
                <div style={{ fontSize: 9, color: "#5A6178", marginTop: 6, lineHeight: 1.5 }}>
                  In Zendesk Admin → Webhooks → Create Webhook: paste URL above, set to HTTP POST, JSON. Then create a Trigger that fires on ticket create/update/comment events.
                </div>
              </div>
            </div>
          </div>

          {/* Offboarding Readiness */}
          <div style={{ ...cardStyle, padding: 18, marginTop: 14 }}>
            {sectionLabel("🚀", "Zendesk Decommission Readiness")}
            <div style={{ fontSize: 11, color: "#A0AEC0", lineHeight: 1.5, marginBottom: 16 }}>
              Track progress toward fully replacing Zendesk with your ITSM tool. All items must be green before decommissioning.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              {[
                { label: "Historical Tickets Imported", value: zdSyncStatus?.counts?.zdTickets || 0, target: "all", ready: (zdSyncStatus?.counts?.zdTickets || 0) > 0, desc: "All past Zendesk tickets stored locally", action: () => setZdTab("tickets") },
                { label: "Users Imported", value: zdSyncStatus?.counts?.zdUsers || 0, target: "all", ready: (zdSyncStatus?.counts?.zdUsers || 0) > 0, desc: "Zendesk agents & end-users imported", action: () => setZdTab("settings") },
                { label: "Organizations Synced", value: zdSyncStatus?.counts?.zdOrgs || 0, target: "all", ready: (zdSyncStatus?.counts?.zdOrgs || 0) > 0, desc: "Orgs mapped to ITSM customers", action: () => setActiveModule("customers") },
                { label: "Comments Preserved", value: zdSyncStatus?.counts?.zdComments || 0, target: "all", ready: (zdSyncStatus?.counts?.zdComments || 0) > 0, desc: "Full conversation history preserved", action: () => setZdTab("tickets") },
                { label: "ITSM Incidents Active", value: incidents.length, target: ">0", ready: incidents.length > 0, desc: "ITSM managing incident lifecycle", action: () => setActiveModule("incidents") },
                { label: "AI Knowledge Trained", value: "Check KB", target: ">0", ready: true, desc: "AI trained from resolved ticket patterns", action: () => setActiveModule("knowledge") },
                { label: "Real-Time Sync Active", value: zdRealTimeEnabled ? "Yes" : "No", target: "yes", ready: zdRealTimeEnabled, desc: "Bidirectional sync operational", action: () => setZdTab("settings") },
                { label: "Webhook Configured", value: "Manual", target: "configured", ready: false, desc: "Zendesk webhook pointed to ITSM", action: () => setZdTab("sync") },
              ].map((item, i) => (
                <div key={i} onClick={item.action} style={{ padding: "12px 14px", borderRadius: 8, background: item.ready ? "#81C78408" : "#FF6B6B08", border: `1px solid ${item.ready ? "#81C78433" : "#FF6B6B33"}`, cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 4px 12px ${item.ready ? "#81C784" : "#FF6B6B"}22`; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: "#E8ECF4" }}>{item.label}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: item.ready ? "#81C784" : "#FF6B6B" }}>{typeof item.value === "number" ? item.value : item.value}</span>
                  </div>
                  <div style={{ fontSize: 9, color: "#5A6178" }}>{item.desc}</div>
                  <div style={{ fontSize: 8, color: item.ready ? "#81C784" : "#FF6B6B", marginTop: 4, fontWeight: 600 }}>{item.ready ? "✅ Ready" : "⚠️ Action Needed"}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════ TAB: SETTINGS ══════════ */}
      {zdTab === "settings" && (
        <div>
          {/* Connection Status Card */}
          <div style={{ ...cardStyle, padding: 18, marginBottom: 16 }}>
            {sectionLabel("🔗", "Zendesk Connection")}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>STATUS</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: zdConnected ? "#4CAF50" : "#FF6B6B", display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: zdConnected ? "#4CAF50" : "#FF6B6B", animation: zdConnected ? "zdPulse 2s infinite" : "none" }} />
                  {zdConnected ? "Connected" : "Disconnected"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>ACCOUNT</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4" }}>{zdUser?.name || "Not connected"}</div>
                <div style={{ fontSize: 10, color: "#5A6178" }}>{zdUser?.email || ""}</div>
              </div>
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
              <button onClick={zdConnect} disabled={zdLoading}
                style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #6366F133", background: "#6366F118", color: "#6366F1", cursor: zdLoading ? "wait" : "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                {zdLoading ? "⟳ Connecting..." : zdConnected ? "🔄 Reconnect" : "🔗 Connect to Zendesk"}
              </button>
            </div>
            {zdError && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, background: "#FF6B6B08", border: "1px solid #FF6B6B33", fontSize: 10, color: "#FF6B6B" }}>❌ {zdError}</div>}
          </div>

          {/* Automation Settings */}
          <div style={{ ...cardStyle, padding: 18, marginBottom: 16 }}>
            {sectionLabel("🤖", "Automation Settings")}
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#0F1117", borderRadius: 8, border: "1px solid #1E213044" }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#E8ECF4" }}>AI Auto-Triage Mode</div>
                  <div style={{ fontSize: 9, color: "#5A6178" }}>Auto-categorize, prioritize &amp; draft responses for incoming tickets</div>
                </div>
                <div onClick={() => { const nv = !zdAutoMode; setZdAutoMode(nv); localStorage.setItem("vgc_zd_auto_mode", JSON.stringify(nv)); addAutoLog({ type: "config", message: nv ? "AI auto-triage ENABLED" : "AI auto-triage DISABLED" }); }}
                  style={{ width: 36, height: 18, borderRadius: 9, background: zdAutoMode ? "#4CAF50" : "#333", position: "relative", cursor: "pointer", transition: "all 0.3s" }}>
                  <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: zdAutoMode ? 20 : 2, transition: "left 0.3s" }} />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: zdRequireHumanApproval ? "#FF634708" : "#0F1117", borderRadius: 8, border: `1px solid ${zdRequireHumanApproval ? "#FF634733" : "#1E213044"}` }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#E8ECF4" }}>🛡️ Require Human Approval Before Sending</div>
                  <div style={{ fontSize: 9, color: zdRequireHumanApproval ? "#FF6347" : "#5A6178" }}>{zdRequireHumanApproval ? "ON — All AI responses require engineer review before sending to customer" : "OFF — ≥85% confidence responses auto-send without review"}</div>
                </div>
                <div onClick={() => { const nv = !zdRequireHumanApproval; setZdRequireHumanApproval(nv); localStorage.setItem("vgc_zd_require_human_approval", JSON.stringify(nv)); addAutoLog({ type: "config", message: nv ? "Human approval REQUIRED for all responses" : "Auto-send ENABLED for high-confidence responses" }); }}
                  style={{ width: 36, height: 18, borderRadius: 9, background: zdRequireHumanApproval ? "#FF6347" : "#333", position: "relative", cursor: "pointer", transition: "all 0.3s" }}>
                  <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: zdRequireHumanApproval ? 20 : 2, transition: "left 0.3s" }} />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#0F1117", borderRadius: 8, border: "1px solid #1E213044" }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#E8ECF4" }}>Real-Time Bidirectional Sync</div>
                  <div style={{ fontSize: 9, color: "#5A6178" }}>Incremental sync every 90 seconds</div>
                </div>
                <div onClick={() => { const nv = !zdRealTimeEnabled; setZdRealTimeEnabled(nv); localStorage.setItem("vgc_zd_realtime", JSON.stringify(nv)); addAutoLog({ type: "config", message: nv ? "Real-time sync ENABLED" : "Real-time sync DISABLED" }); }}
                  style={{ width: 36, height: 18, borderRadius: 9, background: zdRealTimeEnabled ? "#4CAF50" : "#333", position: "relative", cursor: "pointer", transition: "all 0.3s" }}>
                  <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: zdRealTimeEnabled ? 20 : 2, transition: "left 0.3s" }} />
                </div>
              </div>
            </div>
          </div>

          {/* Ticket Stats */}
          <div style={{ ...cardStyle, padding: 18, marginBottom: 16 }}>
            {sectionLabel("📊", "Current Ticket Statistics")}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              {[
                { label: "Open", value: zdStats.open, color: "#FF6B6B", filter: "open" },
                { label: "Pending", value: zdStats.pending, color: "#FFB347", filter: "pending" },
                { label: "Hold", value: zdStats.hold, color: "#64B5F6", filter: "hold" },
                { label: "Solved", value: zdStats.solved, color: "#81C784", filter: "solved" },
              ].map((s, i) => (
                <div key={i} onClick={() => { setZdFilter(s.filter); zdFetchTickets(s.filter, 1); setZdTab("tickets"); }}
                  style={{ padding: "12px 14px", background: "#0F1117", borderRadius: 8, border: `1px solid ${s.color}33`, textAlign: "center", cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = s.color + "88"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = s.color + "33"; e.currentTarget.style.transform = "translateY(0)"; }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Historical Ticket Import */}
          <div style={{ ...cardStyle, padding: 18 }}>
            {sectionLabel("📥", "Historical Zendesk Import")}
            <div style={{ fontSize: 11, color: "#A0AEC0", lineHeight: 1.5, marginBottom: 14 }}>
              Import all past Zendesk tickets as ITSM incidents using cursor-based pagination (no page limit).
              Tickets already linked to ITSM will be skipped. Imported incidents are persisted to DB and mapped with priority, category, SLA, requester info, and status.
              Rate-limit retries and network error recovery are built in.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <button onClick={zdImportHistorical} disabled={!zdConnected || (zdImportProgress?.running)}
                style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: zdImportProgress?.running ? "#333" : "linear-gradient(135deg, #6366F1, #818CF8)", color: "#fff", cursor: zdImportProgress?.running ? "wait" : "pointer", fontSize: 12, fontWeight: 700, boxShadow: "0 2px 12px #6366F133" }}>
                {zdImportProgress?.running ? "⟳ Importing..." : "📥 Import All Historical Tickets"}
              </button>
              {!zdConnected && <span style={{ fontSize: 10, color: "#FF6B6B" }}>Connect to Zendesk first</span>}
            </div>
            {zdImportProgress && (
              <div style={{ background: "#0F1117", borderRadius: 8, padding: 14, border: `1px solid ${zdImportProgress.running ? "#6366F133" : zdImportProgress.imported > 0 ? "#81C78433" : "#FFB34733"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: zdImportProgress.running ? "#6366F1" : "#81C784" }}>{zdImportProgress.phase}</span>
                  {zdImportProgress.running && <span style={{ fontSize: 10, color: "#5A6178", animation: "zdSpin 1s linear infinite", display: "inline-block" }}>⟳</span>}
                </div>
                {zdImportProgress.running && zdImportProgress.total > 0 && (
                  <div style={{ height: 6, borderRadius: 3, background: "#1E2130", overflow: "hidden", marginBottom: 8 }}>
                    <div style={{ height: "100%", borderRadius: 3, background: "linear-gradient(90deg, #6366F1, #818CF8)", width: `${Math.min(100, ((zdImportProgress.imported + zdImportProgress.skipped) / zdImportProgress.total) * 100)}%`, transition: "width 0.3s" }} />
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#81C784" }}>{zdImportProgress.imported}</div>
                    <div style={{ fontSize: 8, color: "#5A6178" }}>IMPORTED</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#FFB347" }}>{zdImportProgress.skipped}</div>
                    <div style={{ fontSize: 8, color: "#5A6178" }}>SKIPPED</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#64B5F6" }}>{zdImportProgress.total}</div>
                    <div style={{ fontSize: 8, color: "#5A6178" }}>TOTAL IN ZD</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#6366F1" }}>{zdImportProgress.page}</div>
                    <div style={{ fontSize: 8, color: "#5A6178" }}>PAGES</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: zdImportProgress.errors > 0 ? "#FF6B6B" : "#5A6178" }}>{zdImportProgress.errors || 0}</div>
                    <div style={{ fontSize: 8, color: "#5A6178" }}>ERRORS</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
