import React, { useState, useEffect } from "react";
import {
  COLORS, inputStyle, btnStyle,
} from "../constants/theme.js";
import {
  Badge,
} from "../components/SharedComponents.jsx";

// Extracted Tab Components — from itsm-tool.jsx
// (fixes React Rules of Hooks violation)
const EmailWhitelistTab = ({ emailWhitelist, setEmailWhitelist, currentUser, showToast, DB_API }) => {
  const [wlInput, setWlInput] = React.useState("");
  const [wlType, setWlType] = React.useState("domain");
  const [wlLabel, setWlLabel] = React.useState("");
  const [wlFilter, setWlFilter] = React.useState("all");
  const [wlSearch, setWlSearch] = React.useState("");
  const [rejections, setRejections] = React.useState([]);
  const [rejLoading, setRejLoading] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  React.useEffect(() => {
    setRejLoading(true);
    fetch(`${DB_API}/email_rejections?limit=50`).then(r => r.json()).then(d => {
      if (d.data) setRejections(d.data.sort((a, b) => (b.processedAt || "").localeCompare(a.processedAt || "")));
    }).catch(() => {}).finally(() => setRejLoading(false));
  }, [DB_API]);

  const addEntry = () => {
    const val = wlInput.trim().toLowerCase();
    if (!val) return;
    if (wlType === "domain" && !val.includes(".")) return;
    if (wlType === "email" && (!val.includes("@") || !val.includes("."))) return;
    if (emailWhitelist.some(e => e.value === val && e.type === wlType)) return;
    const entry = {
      id: `WL-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: wlType, value: val, label: wlLabel.trim() || val,
      addedBy: currentUser?.name || currentUser?.email || "Admin",
      addedAt: new Date().toISOString(),
    };
    setEmailWhitelist(prev => [...prev, entry]);
    setWlInput(""); setWlLabel("");
  };

  const removeEntry = (id) => {
    const entry = emailWhitelist.find(e => e.id === id);
    if (entry?.internal) return;
    setEmailWhitelist(prev => prev.filter(e => e.id !== id));
    fetch(`${DB_API}/email_whitelist/${id}`, { method: "DELETE" }).catch(() => {});
  };

  const importFromCustomers = async () => {
    setImporting(true);
    try {
      const r = await fetch(`${DB_API}/customers`);
      if (!r.ok) return;
      const d = await r.json();
      const custs = d.data || d || [];
      const existingDomains = new Set(emailWhitelist.filter(e => e.type === "domain").map(e => e.value));
      const newEntries = [];
      for (const cust of custs) {
        const domain = (cust.email || "").split("@")[1]?.toLowerCase();
        if (domain && !existingDomains.has(domain)) {
          existingDomains.add(domain);
          newEntries.push({
            id: `WL-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            type: "domain", value: domain, label: cust.company || cust.name || domain,
            addedBy: currentUser?.name || "Admin", addedAt: new Date().toISOString(),
          });
        }
      }
      if (newEntries.length > 0) setEmailWhitelist(prev => [...prev, ...newEntries]);
      showToast(`Imported ${newEntries.length} new domain(s) from customers`, "info");
    } catch (e) { showToast("Import failed: " + e.message, "error"); }
    finally { setImporting(false); }
  };

  const domainCount = emailWhitelist.filter(e => e.type === "domain").length;
  const emailCount = emailWhitelist.filter(e => e.type === "email").length;
  const filtered = emailWhitelist
    .filter(e => wlFilter === "all" || e.type === wlFilter)
    .filter(e => !wlSearch || e.value.includes(wlSearch.toLowerCase()) || (e.label || "").toLowerCase().includes(wlSearch.toLowerCase()));

  return (
  <div>
    {/* Stats Bar */}
    <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
      {[
        { label: "Total Entries", value: emailWhitelist.length, icon: "📋", color: "#6366F1" },
        { label: "Domains", value: domainCount, icon: "🌐", color: "#06B6D4" },
        { label: "Email Addresses", value: emailCount, icon: "📧", color: "#EC4899" },
        { label: "Rejected (Recent)", value: rejections.length, icon: "🚫", color: "#FF6B6B" },
      ].map((s, i) => (
        <div key={i} style={{ flex: 1, background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: "14px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 20 }}>{s.icon}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</div>
          <div style={{ fontSize: 10, color: "#5A6178" }}>{s.label}</div>
        </div>
      ))}
    </div>

    {/* How It Works */}
    <div style={{ background: "linear-gradient(135deg, #06B6D408, #6366F108)", borderRadius: 8, border: "1px solid #06B6D422", padding: 14, marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#06B6D4", marginBottom: 8 }}>📨 Email Whitelist — How It Works</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
        {[
          { step: "1", title: "Email Arrives", desc: "Helpdesk mailbox receives email" },
          { step: "2", title: "Whitelist Check", desc: "Sender domain/email checked against whitelist" },
          { step: "3a", title: "✅ Whitelisted", desc: "Auto-creates incident + AI triage" },
          { step: "3b", title: "🚫 Not Listed", desc: "Silently ignored — no reply sent" },
        ].map((s, i) => (
          <div key={i} style={{ textAlign: "center", padding: 8, borderRadius: 6, background: "#0F1117" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#6366F1", marginBottom: 4 }}>{s.step}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#E8ECF4", marginBottom: 2 }}>{s.title}</div>
            <div style={{ fontSize: 9, color: "#5A6178" }}>{s.desc}</div>
          </div>
        ))}
      </div>
    </div>

    {/* Add Entry Form */}
    <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#E8ECF4", marginBottom: 12, fontFamily: "'Space Grotesk', sans-serif" }}>➕ Add Whitelist Entry</div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ flex: "0 0 120px" }}>
          <div style={{ fontSize: 9, color: "#5A6178", marginBottom: 4 }}>Type</div>
          <select value={wlType} onChange={e => setWlType(e.target.value)} style={{ ...inputStyle, width: "100%", fontSize: 11 }}>
            <option value="domain">🌐 Domain</option>
            <option value="email">📧 Email</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: "#5A6178", marginBottom: 4 }}>{wlType === "domain" ? "Domain (e.g. example.com)" : "Email (e.g. user@example.com)"}</div>
          <input value={wlInput} onChange={e => setWlInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addEntry()} placeholder={wlType === "domain" ? "example.com" : "user@example.com"} style={{ ...inputStyle, width: "100%", fontSize: 11 }} />
        </div>
        <div style={{ flex: "0 0 160px" }}>
          <div style={{ fontSize: 9, color: "#5A6178", marginBottom: 4 }}>Label (optional)</div>
          <input value={wlLabel} onChange={e => setWlLabel(e.target.value)} onKeyDown={e => e.key === "Enter" && addEntry()} placeholder="Customer name" style={{ ...inputStyle, width: "100%", fontSize: 11 }} />
        </div>
        <button onClick={addEntry} disabled={!wlInput.trim()} style={{ ...btnStyle("#6366F1"), fontSize: 11, padding: "7px 16px", opacity: !wlInput.trim() ? 0.4 : 1, whiteSpace: "nowrap" }}>➕ Add</button>
        <button onClick={importFromCustomers} disabled={importing} style={{ ...btnStyle("#06B6D4"), fontSize: 11, padding: "7px 16px", whiteSpace: "nowrap", opacity: importing ? 0.5 : 1 }}>
          {importing ? "⏳ Importing..." : "📥 Import from Customers"}
        </button>
      </div>
    </div>

    {/* Whitelist Entries */}
    <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>📋 Whitelist Entries ({filtered.length})</div>
        <div style={{ display: "flex", gap: 6 }}>
          <input value={wlSearch} onChange={e => setWlSearch(e.target.value)} placeholder="Search..." style={{ ...inputStyle, fontSize: 10, width: 140 }} />
          {["all", "domain", "email"].map(f => (
            <button key={f} onClick={() => setWlFilter(f)} style={{
              padding: "3px 10px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 600,
              background: wlFilter === f ? "#6366F1" : "#1E2130", color: wlFilter === f ? "#fff" : "#5A6178",
            }}>{f === "all" ? "All" : f === "domain" ? "🌐 Domains" : "📧 Emails"}</button>
          ))}
        </div>
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {filtered.length === 0 && <div style={{ textAlign: "center", color: "#5A6178", fontSize: 11, padding: 20 }}>No whitelist entries found. Add domains or emails above.</div>}
        {filtered.map(entry => (
          <div key={entry.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid #1E213033", fontSize: 11 }}>
            <span style={{ fontSize: 14 }}>{entry.type === "domain" ? "🌐" : "📧"}</span>
            <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 9, fontWeight: 600, background: entry.type === "domain" ? "#06B6D418" : "#EC489918", color: entry.type === "domain" ? "#06B6D4" : "#EC4899", textTransform: "uppercase" }}>{entry.type}</span>
            <span style={{ flex: 1, color: "#E8ECF4", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{entry.value}</span>
            <span style={{ color: "#5A6178", fontSize: 10, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.label || ""}</span>
            <span style={{ fontSize: 9, color: "#5A6178", minWidth: 80 }}>{entry.addedBy || "—"}</span>
            <span style={{ fontSize: 9, color: "#5A6178", minWidth: 80, fontFamily: "'JetBrains Mono', monospace" }}>{entry.addedAt ? new Date(entry.addedAt).toLocaleDateString("en-SG") : "—"}</span>
            {entry.internal ? (
              <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: "#FFB34718", color: "#FFB347" }}>INTERNAL</span>
            ) : (
              <button onClick={() => removeEntry(entry.id)} title="Remove from whitelist" style={{ background: "none", border: "1px solid #FF525233", borderRadius: 4, color: "#FF5252", cursor: "pointer", fontSize: 10, padding: "2px 6px" }}>✕</button>
            )}
          </div>
        ))}
      </div>
    </div>

    {/* Recent Rejected Emails */}
    <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#FF6B6B", fontFamily: "'Space Grotesk', sans-serif" }}>🚫 Recent Rejected Emails ({rejections.length})</div>
        <button onClick={() => { setRejLoading(true); fetch(`${DB_API}/email_rejections?limit=50`).then(r => r.json()).then(d => { if (d.data) setRejections(d.data.sort((a, b) => (b.processedAt || "").localeCompare(a.processedAt || ""))); }).catch(() => {}).finally(() => setRejLoading(false)); }} disabled={rejLoading} style={{ ...btnStyle("#1E2130"), fontSize: 10, padding: "3px 10px", color: "#A0AEC0" }}>
          {rejLoading ? "⏳" : "🔄"} Refresh
        </button>
      </div>
      <div style={{ maxHeight: 200, overflowY: "auto" }}>
        {rejections.length === 0 && <div style={{ textAlign: "center", color: "#5A6178", fontSize: 11, padding: 20 }}>No rejected emails found.</div>}
        {rejections.slice(0, 30).map((rej, i) => (
          <div key={rej.id || i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: "1px solid #1E213033", fontSize: 11 }}>
            <span style={{ fontSize: 12 }}>🚫</span>
            <span style={{ flex: 1, color: "#C4CAD6", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>{rej.from || "—"}</span>
            <span style={{ flex: 1, color: "#5A6178", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10 }}>{rej.subject || "—"}</span>
            <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 8, fontWeight: 600, background: "#FF6B6B18", color: "#FF6B6B" }}>{rej.reason || "—"}</span>
            <span style={{ fontSize: 9, color: "#5A6178", minWidth: 70, fontFamily: "'JetBrains Mono', monospace" }}>{rej.processedAt ? new Date(rej.processedAt).toLocaleString("en-SG", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
  );
};

// Phase 8 — Zendesk Cleanup & Reconciliation tab.
// Two silent-close operations: (1) reconcile open ITSM with current ZD status,
// (2) AI-archive aged orphans. Both run dryRun-first → preview → confirm.
// Zero customer/staff emails — only WS broadcasts for silent UI refresh.
const ZdCleanupTab = ({ currentUser, showToast }) => {
  const [reconcileBusy, setReconcileBusy] = React.useState(false);
  const [reconcilePreview, setReconcilePreview] = React.useState(null);
  const [reconcileResult, setReconcileResult] = React.useState(null);
  const [archiveBusy, setArchiveBusy] = React.useState(false);
  const [archivePreview, setArchivePreview] = React.useState(null);
  const [archiveResult, setArchiveResult] = React.useState(null);
  const [archiveDays, setArchiveDays] = React.useState(60);
  const [archiveInactivity, setArchiveInactivity] = React.useState(30);
  const [archiveSkipZdLink, setArchiveSkipZdLink] = React.useState(true);

  const requester = currentUser?.email || currentUser?.name || "admin";
  const sectionStyle = { background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 18, marginBottom: 16 };
  const headerStyle = { margin: 0, fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 };
  const subStyle = { fontSize: 11, color: "#8B92A8", marginTop: 4, lineHeight: 1.5 };
  const banner = (
    <div style={{ background: "linear-gradient(135deg, #4CAF5010, #06B6D410)", borderRadius: 6, border: "1px solid #4CAF5033", padding: "8px 12px", marginTop: 10, fontSize: 11, color: "#4CAF50" }}>
      🔇 <strong>Silent mode:</strong> 0 customer notifications · 0 staff emails · only internal audit log + dashboard refresh.
    </div>
  );

  const runReconcileDryRun = async () => {
    setReconcileBusy(true); setReconcilePreview(null); setReconcileResult(null);
    try {
      const r = await fetch("/api/zendesk/reconcile-open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dryRun: true, requestedBy: requester }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setReconcilePreview(d);
    } catch (e) { showToast("Preview failed: " + e.message, "error"); }
    setReconcileBusy(false);
  };
  const runReconcileLive = async () => {
    setReconcileBusy(true);
    try {
      const r = await fetch("/api/zendesk/reconcile-open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dryRun: false, requestedBy: requester }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setReconcileResult(d); setReconcilePreview(null);
      showToast(`Reconciled: closed ${d.closed}, marked ${d.markedDeleted} as deleted`, "success");
    } catch (e) { showToast("Reconcile failed: " + e.message, "error"); }
    setReconcileBusy(false);
  };

  const runArchiveDryRun = async () => {
    setArchiveBusy(true); setArchivePreview(null); setArchiveResult(null);
    try {
      const cutoffDate = new Date(Date.now() - archiveDays * 86400000).toISOString();
      const r = await fetch("/api/ai/historical-close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dryRun: true, requestedBy: requester, cutoffDate, requireNoZdLink: archiveSkipZdLink, noActivitySinceDays: archiveInactivity }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setArchivePreview(d);
    } catch (e) { showToast("Preview failed: " + e.message, "error"); }
    setArchiveBusy(false);
  };
  const runArchiveLive = async () => {
    setArchiveBusy(true);
    try {
      const cutoffDate = new Date(Date.now() - archiveDays * 86400000).toISOString();
      const r = await fetch("/api/ai/historical-close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dryRun: false, requestedBy: requester, cutoffDate, requireNoZdLink: archiveSkipZdLink, noActivitySinceDays: archiveInactivity, limit: 500 }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setArchiveResult(d); setArchivePreview(null);
      showToast(`Archived ${d.closedCount} of ${d.totalEligible} eligible (${d.remaining || 0} remaining)`, "success");
    } catch (e) { showToast("Archive failed: " + e.message, "error"); }
    setArchiveBusy(false);
  };

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h3 style={{ margin: 0, fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>🧽 Zendesk Cleanup & Reconciliation</h3>
        <div style={{ fontSize: 11, color: "#5A6178", marginTop: 4 }}>One-shot operations to fix stale SLA metrics caused by tickets already closed in Zendesk but still open in ITSM. All operations are silent — no customer or staff emails are sent.</div>
      </div>

      {/* Section 1 — Reconcile Open with Zendesk */}
      <div style={sectionStyle}>
        <h3 style={headerStyle}><span>🔄</span> Reconcile Open Incidents with Zendesk</h3>
        <div style={subStyle}>
          For every <strong style={{ color: "#E8ECF4" }}>open ITSM incident with a Zendesk link</strong>, fetch the current Zendesk status. If Zendesk shows <code style={{ color: "#06B6D4" }}>solved</code> or <code style={{ color: "#06B6D4" }}>closed</code>, silently mark the ITSM incident as Closed with reason "Zendesk reconciliation". Sev-A / P1 / Critical incidents are <strong style={{ color: "#FFB347" }}>never auto-closed</strong> — they're surfaced for manual review.
        </div>
        {banner}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button onClick={runReconcileDryRun} disabled={reconcileBusy} style={{ ...btnStyle("#06B6D4"), fontSize: 11, padding: "8px 14px", opacity: reconcileBusy ? 0.5 : 1 }}>
            {reconcileBusy ? "⏳ Working..." : "👁️ Preview (Dry Run)"}
          </button>
        </div>

        {reconcilePreview && (
          <div style={{ marginTop: 14, padding: 14, background: "#0A0C14", borderRadius: 6, border: "1px solid #06B6D433" }}>
            <div style={{ fontSize: 12, color: "#06B6D4", fontWeight: 600, marginBottom: 8 }}>Preview Results (no changes made)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 12 }}>
              <div><div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase" }}>Scanned</div><div style={{ fontSize: 18, color: "#E8ECF4", fontWeight: 700 }}>{reconcilePreview.scanned}</div></div>
              <div><div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase" }}>Will Close</div><div style={{ fontSize: 18, color: "#4CAF50", fontWeight: 700 }}>{reconcilePreview.wouldClose}</div></div>
              <div><div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase" }}>ZD Deleted</div><div style={{ fontSize: 18, color: "#FFB347", fontWeight: 700 }}>{reconcilePreview.wouldMarkDeleted}</div></div>
              <div><div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase" }}>Manual Review</div><div style={{ fontSize: 18, color: "#FF6347", fontWeight: 700 }}>{reconcilePreview.requiresManualReview}</div></div>
            </div>
            {reconcilePreview.sample && reconcilePreview.sample.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ fontSize: 11, color: "#8B92A8", cursor: "pointer" }}>Sample (first {reconcilePreview.sample.length})</summary>
                <div style={{ maxHeight: 180, overflowY: "auto", marginTop: 8, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "#8B92A8" }}>
                  {reconcilePreview.sample.map((s, i) => (
                    <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid #1E2130" }}>
                      <span style={{ color: "#64B5F6" }}>{s.id}</span> · {s.priority} · ZD#{s.zdTicketId} ({s.zdStatus}) — {(s.title || "").slice(0, 60)}
                    </div>
                  ))}
                </div>
              </details>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={runReconcileLive} disabled={reconcileBusy || reconcilePreview.wouldClose + reconcilePreview.wouldMarkDeleted === 0} style={{ ...btnStyle("#4CAF50"), fontSize: 11, padding: "8px 14px", opacity: reconcileBusy ? 0.5 : 1 }}>
                {reconcileBusy ? "⏳ Closing..." : `✓ Confirm — Close ${reconcilePreview.wouldClose + reconcilePreview.wouldMarkDeleted} Silently`}
              </button>
              <button onClick={() => setReconcilePreview(null)} disabled={reconcileBusy} style={{ ...btnStyle("#5A6178"), fontSize: 11, padding: "8px 14px" }}>Cancel</button>
            </div>
          </div>
        )}

        {reconcileResult && (
          <div style={{ marginTop: 14, padding: 14, background: "#0A0C14", borderRadius: 6, border: "1px solid #4CAF5033" }}>
            <div style={{ fontSize: 12, color: "#4CAF50", fontWeight: 600, marginBottom: 6 }}>✅ Reconciliation Complete</div>
            <div style={{ fontSize: 11, color: "#8B92A8" }}>
              Scanned <strong style={{ color: "#E8ECF4" }}>{reconcileResult.scanned}</strong> · Closed <strong style={{ color: "#4CAF50" }}>{reconcileResult.closed}</strong> · Marked deleted <strong style={{ color: "#FFB347" }}>{reconcileResult.markedDeleted}</strong> · Manual review <strong style={{ color: "#FF6347" }}>{reconcileResult.requiresManualReview}</strong>
            </div>
            <div style={{ fontSize: 10, color: "#5A6178", marginTop: 6 }}>{reconcileResult.timestamp} · by {reconcileResult.requestedBy}</div>
          </div>
        )}
      </div>

      {/* Section 2 — Archive Aged Orphans */}
      <div style={sectionStyle}>
        <h3 style={headerStyle}><span>🗄️</span> Archive Aged Orphan Incidents</h3>
        <div style={subStyle}>
          Bulk-close incidents older than the cutoff with no recent activity. AI generates a concise closure summary. Sev-A is excluded. Optionally exclude incidents that still have an active Zendesk link (recommended — those are handled by reconciliation above).
        </div>
        {banner}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 14 }}>
          <div>
            <label style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase" }}>Older than (days)</label>
            <input type="number" min="7" max="365" value={archiveDays} onChange={e => setArchiveDays(parseInt(e.target.value) || 60)} style={{ ...inputStyle, marginTop: 4 }} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase" }}>No activity (days)</label>
            <input type="number" min="0" max="180" value={archiveInactivity} onChange={e => setArchiveInactivity(parseInt(e.target.value) || 0)} style={{ ...inputStyle, marginTop: 4 }} />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <label style={{ fontSize: 11, color: "#E8ECF4", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={archiveSkipZdLink} onChange={e => setArchiveSkipZdLink(e.target.checked)} />
              Skip incidents with Zendesk link
            </label>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button onClick={runArchiveDryRun} disabled={archiveBusy} style={{ ...btnStyle("#06B6D4"), fontSize: 11, padding: "8px 14px", opacity: archiveBusy ? 0.5 : 1 }}>
            {archiveBusy ? "⏳ Working..." : "👁️ Preview (Dry Run)"}
          </button>
        </div>

        {archivePreview && (
          <div style={{ marginTop: 14, padding: 14, background: "#0A0C14", borderRadius: 6, border: "1px solid #06B6D433" }}>
            <div style={{ fontSize: 12, color: "#06B6D4", fontWeight: 600, marginBottom: 8 }}>Preview Results (no changes made)</div>
            <div style={{ fontSize: 11, color: "#E8ECF4", marginBottom: 8 }}>
              Eligible: <strong style={{ color: "#4CAF50" }}>{archivePreview.eligibleCount}</strong> incidents · Cutoff: <code style={{ color: "#8B92A8" }}>{archivePreview.cutoffDate?.split("T")[0]}</code>
            </div>
            {archivePreview.sample && archivePreview.sample.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ fontSize: 11, color: "#8B92A8", cursor: "pointer" }}>Sample (first {archivePreview.sample.length})</summary>
                <div style={{ maxHeight: 180, overflowY: "auto", marginTop: 8, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "#8B92A8" }}>
                  {archivePreview.sample.map((s, i) => (
                    <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid #1E2130" }}>
                      <span style={{ color: "#64B5F6" }}>{s.id}</span> · {s.priority || "—"} · {s.status} — {(s.title || "").slice(0, 60)}
                    </div>
                  ))}
                </div>
              </details>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={runArchiveLive} disabled={archiveBusy || archivePreview.eligibleCount === 0} style={{ ...btnStyle("#4CAF50"), fontSize: 11, padding: "8px 14px", opacity: archiveBusy ? 0.5 : 1 }}>
                {archiveBusy ? "⏳ Archiving..." : `✓ Confirm — Archive ${Math.min(archivePreview.eligibleCount, 500)} Silently`}
              </button>
              <button onClick={() => setArchivePreview(null)} disabled={archiveBusy} style={{ ...btnStyle("#5A6178"), fontSize: 11, padding: "8px 14px" }}>Cancel</button>
            </div>
            {archivePreview.eligibleCount > 500 && (
              <div style={{ fontSize: 10, color: "#FFB347", marginTop: 6 }}>⚠️ Processed in batches of 500. Re-run after first batch to continue.</div>
            )}
          </div>
        )}

        {archiveResult && (
          <div style={{ marginTop: 14, padding: 14, background: "#0A0C14", borderRadius: 6, border: "1px solid #4CAF5033" }}>
            <div style={{ fontSize: 12, color: "#4CAF50", fontWeight: 600, marginBottom: 6 }}>✅ Archive Complete</div>
            <div style={{ fontSize: 11, color: "#8B92A8" }}>
              Closed <strong style={{ color: "#4CAF50" }}>{archiveResult.closedCount}</strong> of <strong style={{ color: "#E8ECF4" }}>{archiveResult.totalEligible}</strong> eligible · Remaining <strong style={{ color: "#FFB347" }}>{archiveResult.remaining || 0}</strong>
            </div>
            {archiveResult.remaining > 0 && (
              <button onClick={runArchiveLive} disabled={archiveBusy} style={{ ...btnStyle("#06B6D4"), fontSize: 10, padding: "5px 12px", marginTop: 8 }}>Continue with next batch →</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const DataMaintenanceTab = ({ currentUser, showToast, setRecycleBin, _save }) => {
const [purgeData, setPurgeData] = React.useState(null);
const [purgeLoading, setPurgeLoading] = React.useState(false);
const [purgeError, setPurgeError] = React.useState(null);
// Flattened from nested purgeData IIFE
const [bulkPurging, setBulkPurging] = React.useState(false);
const [bulkResult, setBulkResult] = React.useState(null);
const [confirmPurge, setConfirmPurge] = React.useState(null);
const [actionsList, setActionsList] = React.useState([]);
const [actionsLoaded, setActionsLoaded] = React.useState(false);
const [actionsPage, setActionsPage] = React.useState(0);
// Flattened from nested thresholds IIFE
const [thresholds, setThresholds] = React.useState(null);

const PAGE_SIZE = 20;

const fetchPurgeStatus = React.useCallback(() => {
  setPurgeLoading(true);
  fetch("/api/purge-status").then(r => r.json()).then(d => { setPurgeData(d); setPurgeError(null); }).catch(e => setPurgeError(e.message)).finally(() => setPurgeLoading(false));
}, []);

const loadActions = React.useCallback(() => {
  fetch("/api/ai/actions").then(r => r.json()).then(d => { setActionsList(d.actions || []); setActionsLoaded(true); }).catch(() => {});
}, []);

React.useEffect(() => { fetchPurgeStatus(); const iv = setInterval(fetchPurgeStatus, 30000); return () => clearInterval(iv); }, [fetchPurgeStatus]);

React.useEffect(() => {
  fetch("/api/ai/thresholds").then(r => r.json()).then(d => setThresholds(d.thresholds)).catch(() => {});
}, []);

const fmtDate = (iso) => { if (!iso) return "Never"; try { return new Date(iso).toLocaleString(); } catch { return iso; } };
const fmtDuration = (ms) => { if (!ms && ms !== 0) return "-"; if (ms < 1000) return ms + "ms"; return (ms / 1000).toFixed(1) + "s"; };

const purgeJobs = purgeData ? [
  { key: "queueCleanup", label: "Queue Cleanup", icon: "🧹", desc: purgeData.schedules?.queueCleanup?.description || "", ...purgeData.purgeStatus?.queueCleanup },
  { key: "logPurge", label: "Log Purge", icon: "📜", desc: purgeData.schedules?.logPurge?.description || "", ...purgeData.purgeStatus?.logPurge },
  { key: "terminalPurge", label: "Terminal AI Purge", icon: "🤖", desc: purgeData.schedules?.terminalPurge?.description || "", ...purgeData.purgeStatus?.terminalPurge },
  { key: "auditPurge", label: "Audit Purge", icon: "📋", desc: purgeData.schedules?.auditPurge?.description || "", ...purgeData.purgeStatus?.auditPurge },
] : [];

const breakdown = purgeData?.aiActionsBreakdown || {};
const breakdownColors = { pending_approval: "#FFB347", auto_applied: "#06B6D4", auto_approved: "#81C784", approved: "#10B981", executed: "#6366F1", rejected: "#FF6B6B", dismissed: "#5A6178", failed: "#EF4444" };

const doBulkPurge = async (status) => {
  setBulkPurging(true);
  setBulkResult(null);
  try {
    const r = await fetch("/api/ai/purge-all-pending", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    const d = await r.json();
    setBulkResult(d);
    setConfirmPurge(null);
    fetchPurgeStatus();
    if (actionsLoaded) loadActions();
  } catch (e) { setBulkResult({ error: e.message }); }
  setBulkPurging(false);
};


const deleteOneAction = async (action) => {
  try {
    await fetch(`/api/ai/actions/${encodeURIComponent(action.id)}`, { method: "DELETE" });
    const entry = { ...action, _recycleType: "ai_actions", _deletedAt: new Date().toISOString(), _deletedBy: currentUser?.name || "System" };
    setRecycleBin(prev => { const updated = [entry, ...prev].slice(0, 200); _save("vgc_recycle_bin", updated); return updated; });
    setActionsList(prev => prev.filter(a => a.id !== action.id));
    showToast(`AI action "${action.title || action.id}" moved to recycle bin`, "info");
    fetchPurgeStatus();
  } catch (e) { showToast("Delete failed: " + e.message, "error"); }
};

const pendingCount = breakdown.pending_approval || 0;
const rejectedCount = breakdown.rejected || 0;
const failedCount = breakdown.failed || 0;
const dismissedCount = breakdown.dismissed || 0;
const paged = actionsList.slice(actionsPage * PAGE_SIZE, (actionsPage + 1) * PAGE_SIZE);
const totalPages = Math.ceil(actionsList.length / PAGE_SIZE);

return (
<div>
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
    <div>
      <h3 style={{ margin: 0, fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>🧹 Data Maintenance & Scheduled Purges</h3>
      <div style={{ fontSize: 10, color: "#5A6178", marginTop: 2 }}>Monitor automated cleanup jobs · AI action lifecycle · Database hygiene</div>
    </div>
    <button onClick={fetchPurgeStatus} disabled={purgeLoading} style={{ ...btnStyle("#6366F1"), fontSize: 10, padding: "5px 12px", opacity: purgeLoading ? 0.5 : 1 }}>
      {purgeLoading ? "⏳ Loading..." : "🔄 Refresh"}
    </button>
  </div>

  {purgeError && <div style={{ background: "#2D0A0A", border: "1px solid #FF6B6B33", borderRadius: 8, padding: 12, marginBottom: 16, color: "#FF6B6B", fontSize: 11 }}>⚠️ Error fetching purge status: {purgeError}</div>}

  {/* AI Actions Breakdown */}
  {purgeData && (
    <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 16, marginBottom: 16, minHeight: 100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h4 style={{ margin: 0, fontSize: 13, color: "#E8ECF4" }}>🤖 AI Actions Breakdown</h4>
        <Badge color={{ bg: "#1A1D2E", text: "#6366F1" }}>Total: {purgeData.aiActionsTotal || 0}</Badge>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {Object.entries(breakdown).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
          <div key={status} style={{ background: "#0A0C14", borderRadius: 6, padding: "8px 14px", border: "1px solid #1E2130", minWidth: 100 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: breakdownColors[status] || "#A0AEC0", fontFamily: "'JetBrains Mono', monospace" }}>{count}</div>
            <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase", letterSpacing: "0.5px" }}>{status.replace(/_/g, " ")}</div>
          </div>
        ))}
      </div>
      {purgeData.aiActionsTotal > 500 && (
        <div style={{ marginTop: 8, fontSize: 10, color: "#FFB347", background: "#FFB34711", borderRadius: 4, padding: "4px 8px" }}>
          ⚠️ AI actions count exceeds 500 cap — terminal records will be trimmed at next scheduled purge
        </div>
      )}
    </div>
  )}

  {/* AI Actions Bulk Management */}
  {purgeData && (
    <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #EC489933", padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h4 style={{ margin: 0, fontSize: 13, color: "#E8ECF4" }}>🗑️ AI Actions Bulk Management</h4>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={loadActions} style={{ ...btnStyle("#6366F1"), fontSize: 9, padding: "4px 10px" }}>📋 Load Actions List</button>
        </div>
      </div>

      {/* Bulk Purge Buttons */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {pendingCount > 0 && (
          confirmPurge === "pending_approval" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#FF444411", borderRadius: 6, border: "1px solid #FF444433" }}>
              <span style={{ fontSize: 11, color: "#FF6B6B" }}>Purge {pendingCount} pending? No email will be sent.</span>
              <button onClick={() => doBulkPurge("pending_approval")} disabled={bulkPurging} style={{ ...btnStyle("#FF4444"), fontSize: 10, padding: "3px 10px" }}>
                {bulkPurging ? "⏳ Purging..." : "✓ Confirm"}
              </button>
              <button onClick={() => setConfirmPurge(null)} style={{ ...btnStyle("#5A6178"), fontSize: 10, padding: "3px 8px" }}>Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmPurge("pending_approval")} style={{ ...btnStyle("#FFB347"), fontSize: 10, padding: "5px 12px" }}>
              🗑️ Purge All Pending ({pendingCount})
            </button>
          )
        )}
        {rejectedCount > 0 && (
          confirmPurge === "rejected" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#FF444411", borderRadius: 6, border: "1px solid #FF444433" }}>
              <span style={{ fontSize: 11, color: "#FF6B6B" }}>Purge {rejectedCount} rejected?</span>
              <button onClick={() => doBulkPurge("rejected")} disabled={bulkPurging} style={{ ...btnStyle("#FF4444"), fontSize: 10, padding: "3px 10px" }}>✓ Confirm</button>
              <button onClick={() => setConfirmPurge(null)} style={{ ...btnStyle("#5A6178"), fontSize: 10, padding: "3px 8px" }}>Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmPurge("rejected")} style={{ ...btnStyle("#FF6B6B"), fontSize: 10, padding: "5px 12px" }}>
              🗑️ Purge All Rejected ({rejectedCount})
            </button>
          )
        )}
        {dismissedCount > 0 && (
          <button onClick={() => { setConfirmPurge("dismissed"); }} style={{ ...btnStyle("#5A6178"), fontSize: 10, padding: "5px 12px" }}>
            🗑️ Purge Dismissed ({dismissedCount})
          </button>
        )}
        {confirmPurge === "dismissed" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#FF444411", borderRadius: 6, border: "1px solid #FF444433" }}>
            <span style={{ fontSize: 11, color: "#FF6B6B" }}>Purge {dismissedCount} dismissed?</span>
            <button onClick={() => doBulkPurge("dismissed")} disabled={bulkPurging} style={{ ...btnStyle("#FF4444"), fontSize: 10, padding: "3px 10px" }}>✓ Confirm</button>
            <button onClick={() => setConfirmPurge(null)} style={{ ...btnStyle("#5A6178"), fontSize: 10, padding: "3px 8px" }}>Cancel</button>
          </div>
        )}
        {failedCount > 0 && (
          <button onClick={() => doBulkPurge("failed")} disabled={bulkPurging} style={{ ...btnStyle("#EF4444"), fontSize: 10, padding: "5px 12px" }}>
            🗑️ Purge Failed ({failedCount})
          </button>
        )}
      </div>

      {bulkResult && (
        <div style={{ padding: "8px 12px", borderRadius: 6, marginBottom: 10, fontSize: 11, background: bulkResult.error ? "#FF444411" : "#4CAF5011", border: `1px solid ${bulkResult.error ? "#FF444433" : "#4CAF5033"}`, color: bulkResult.error ? "#FF6B6B" : "#81C784" }}>
          {bulkResult.error ? `⚠️ Error: ${bulkResult.error}` : `✅ Purged ${bulkResult.deleted} ${bulkResult.status} AI actions successfully`}
        </div>
      )}

      {/* Individual Actions List */}
      {actionsLoaded && (
        <div>
          <div style={{ fontSize: 11, color: "#5A6178", marginBottom: 8 }}>{actionsList.length} AI actions loaded · Delete → Recycle Bin · Page {actionsPage + 1}/{Math.max(1, totalPages)}</div>
          {paged.map(action => (
            <div key={action.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: "1px solid #1E213033", fontSize: 11 }}>
              <span style={{ width: 80, fontFamily: "'JetBrains Mono', monospace", color: "#64B5F6", fontSize: 10 }}>{action.id}</span>
              <span style={{ flex: 1, color: "#C4CAD6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{action.title || action.type || "—"}</span>
              <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 9, fontWeight: 600, background: (breakdownColors[action.status] || "#5A6178") + "22", color: breakdownColors[action.status] || "#5A6178" }}>{(action.status || "").replace(/_/g, " ")}</span>
              <span style={{ fontSize: 9, color: "#5A6178", minWidth: 60 }}>{action.createdAt ? new Date(action.createdAt).toLocaleDateString("en-SG") : "—"}</span>
              <button onClick={() => deleteOneAction(action)} title="Delete → Recycle Bin" style={{ background: "none", border: "1px solid #FF525233", borderRadius: 4, color: "#FF5252", cursor: "pointer", fontSize: 10, padding: "2px 6px" }}>🗑️</button>
            </div>
          ))}
          {totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 8 }}>
              <button disabled={actionsPage === 0} onClick={() => setActionsPage(p => p - 1)} style={{ ...btnStyle("#1E2130"), fontSize: 10, padding: "3px 8px", color: actionsPage === 0 ? "#5A617844" : "#A0AEC0" }}>← Prev</button>
              <button disabled={actionsPage >= totalPages - 1} onClick={() => setActionsPage(p => p + 1)} style={{ ...btnStyle("#1E2130"), fontSize: 10, padding: "3px 8px", color: actionsPage >= totalPages - 1 ? "#5A617844" : "#A0AEC0" }}>Next →</button>
            </div>
          )}
        </div>
      )}
    </div>
  )}

  {/* Scheduled Purge Jobs */}
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
    {purgeJobs.map(job => (
      <div key={job.key} style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 16, minHeight: 140 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 16 }}>{job.icon}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#E8ECF4" }}>{job.label}</span>
          </div>
          <Badge color={job.runCount > 0 ? { bg: "#0D2D1A", text: "#81C784" } : { bg: "#1A1D2E", text: "#5A6178" }}>
            {job.runCount > 0 ? `${job.runCount} runs` : "Pending"}
          </Badge>
        </div>
        <div style={{ fontSize: 9, color: "#5A6178", marginBottom: 10 }}>{job.desc}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <div>
            <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase" }}>Last Run</div>
            <div style={{ fontSize: 10, color: "#C4CAD6", fontFamily: "'JetBrains Mono', monospace" }}>{fmtDate(job.lastRun)}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase" }}>Next Run</div>
            <div style={{ fontSize: 10, color: "#06B6D4", fontFamily: "'JetBrains Mono', monospace" }}>{fmtDate(job.nextRun)}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase" }}>Total Processed</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#FFB347", fontFamily: "'JetBrains Mono', monospace" }}>{job.totalDismissed ?? job.totalDeleted ?? 0}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase" }}>Last Duration</div>
            <div style={{ fontSize: 10, color: "#C4CAD6", fontFamily: "'JetBrains Mono', monospace" }}>{fmtDuration(job.lastResult?.durationMs)}</div>
          </div>
        </div>
        {job.lastResult?.error && (
          <div style={{ marginTop: 6, fontSize: 9, color: "#FF6B6B", background: "#FF6B6B11", borderRadius: 4, padding: "3px 6px" }}>⚠️ {job.lastResult.error}</div>
        )}
      </div>
    ))}
  </div>

  {/* Retention Policy Summary */}
  {purgeData && (
    <div style={{ background: "linear-gradient(135deg, #06B6D408, #6366F108)", borderRadius: 8, border: "1px solid #06B6D422", padding: 14, marginTop: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#06B6D4", marginBottom: 8 }}>📐 Retention Policy</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
        {Object.entries(purgeData.schedules || {}).map(([key, sched]) => (
          <div key={key} style={{ textAlign: "center", padding: 8, borderRadius: 6, background: "#0F1117" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#6366F1", marginBottom: 4 }}>{sched.retentionDays}d</div>
            <div style={{ fontSize: 9, fontWeight: 600, color: "#E8ECF4" }}>{key.replace(/([A-Z])/g, " $1").trim()}</div>
            <div style={{ fontSize: 8, color: "#5A6178" }}>Every {sched.interval}</div>
          </div>
        ))}
      </div>
    </div>
  )}

  {/* AI Thresholds (read-only display, configurable via env vars on server) */}
  {thresholds && (
    <div style={{ background: "linear-gradient(135deg, #FFB34708, #6366F108)", borderRadius: 8, border: "1px solid #FFB34722", padding: 14, marginTop: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#FFB347", marginBottom: 4 }}>⚙️ AI Thresholds (Server Config)</div>
      <div style={{ fontSize: 9, color: "#5A6178", marginBottom: 10 }}>Configurable via environment variables · Changes require server restart</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
        {[
          { key: "autoApply", label: "Auto-Apply Triage", desc: "Confidence % to auto-apply triage", icon: "🎯" },
          { key: "slaRisk", label: "SLA Risk Alert", desc: "Breach probability % threshold", icon: "⏱️" },
          { key: "patternConfidence", label: "Pattern Confidence", desc: "Pattern detection confidence %", icon: "🔍" },
          { key: "autoResolveConfidence", label: "Auto-Resolve", desc: "Auto-resolve confidence %", icon: "✅" },
          { key: "maxPendingPerIncident", label: "Max Pending/Incident", desc: "Pending actions cap per incident", icon: "📌" },
          { key: "maxPendingTotal", label: "Max Pending Total", desc: "Global pending actions cap", icon: "📊" },
          { key: "staleDays", label: "Stale Cleanup Days", desc: "Days before auto-delete stale items", icon: "🗑️" },
          { key: "monitorIntervalMin", label: "Monitor Interval", desc: "AI monitor scan interval (minutes)", icon: "⏰" },
        ].map(it => (
          <div key={it.key} style={{ textAlign: "center", padding: 8, borderRadius: 6, background: "#0F1117", border: "1px solid #1E2130" }}>
            <div style={{ fontSize: 14 }}>{it.icon}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#FFB347", fontFamily: "'JetBrains Mono', monospace", margin: "4px 0" }}>{thresholds[it.key]}{it.key.includes("onfidence") || it.key === "autoApply" || it.key === "slaRisk" ? "%" : ""}</div>
            <div style={{ fontSize: 9, fontWeight: 600, color: "#E8ECF4" }}>{it.label}</div>
            <div style={{ fontSize: 8, color: "#5A6178" }}>{it.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )}
</div>
);
  };

export { EmailWhitelistTab, ZdCleanupTab, DataMaintenanceTab };
