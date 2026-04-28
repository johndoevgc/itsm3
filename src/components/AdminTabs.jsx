import React, { useState, useEffect } from "react";
import { inputStyle, btnStyle } from "../constants/theme.js";

// ─── Phase H1 — Email & Sync Audit Tab ──────────────────────────────────
export const EmailAuditTab = () => {
  const [tab, setTab] = useState("suppressions");
  const [prefs, setPrefs] = useState([]);
  const [throttle, setThrottle] = useState([]);
  const [zdAudit, setZdAudit] = useState({ items: [], todayCount: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [seedDryRun, setSeedDryRun] = useState(null);
  const reload = async () => {
    setLoading(true);
    try {
      const [p, c, z] = await Promise.all([
        fetch("/api/email-preferences").then(r => r.json()),
        fetch("/api/email-confirm-log?limit=100").then(r => r.json()),
        fetch("/api/audit/zd-suppressions?limit=100").then(r => r.json()),
      ]);
      setPrefs(p.preferences || []);
      setThrottle(c.items || []);
      setZdAudit({ items: z.items || [], todayCount: z.todayCount || 0, total: z.total || 0 });
    } catch (e) { console.warn("[EmailAudit] reload failed", e); }
    setLoading(false);
  };
  useEffect(() => { reload(); }, []);

  const togglePref = async (email, currentlyOptedOut) => {
    const url = currentlyOptedOut ? "/api/email-preferences/subscribe" : "/api/email-preferences/unsubscribe";
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    reload();
  };

  const runBulkSeed = async (dryRun) => {
    setLoading(true);
    try {
      const r = await fetch("/api/email-preferences/bulk-seed", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun, source: "bulk_seed_phase_h_ui" }),
      });
      const d = await r.json();
      if (dryRun) setSeedDryRun(d); else { setSeedDryRun(null); reload(); alert(`Seeded ${d.inserted} (skipped ${d.skipped})`); }
    } catch (e) { alert("Bulk seed failed: " + e.message); }
    setLoading(false);
  };

  const tabBtn = (id, label, count) => (
    <button onClick={() => setTab(id)} style={{
      padding: "8px 14px", borderRadius: 6, border: "none", cursor: "pointer",
      background: tab === id ? "#1E2130" : "transparent",
      color: tab === id ? "#E8ECF4" : "#5A6178",
      fontSize: 12, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif",
    }}>{label}{count != null && <span style={{ marginLeft: 6, color: "#818CF8", fontFamily: "'JetBrains Mono', monospace" }}>{count}</span>}</button>
  );

  const cellStyle = { padding: "8px 12px", borderBottom: "1px solid #1E213044", color: "#C4CAD6", fontSize: 12 };
  const thStyle = { ...cellStyle, color: "#5A6178", textTransform: "uppercase", fontSize: 10, letterSpacing: 0.8, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 };

  return (
    <div>
      <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>🔇 Email & Sync Audit</h3>
          <div style={{ display: "flex", gap: 8 }}>
            {zdAudit.todayCount > 0 && (
              <span style={{ padding: "4px 10px", background: "#22C55E22", color: "#22C55E", borderRadius: 6, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                {zdAudit.todayCount} ZD comments suppressed today
              </span>
            )}
            <button onClick={reload} disabled={loading} style={{ ...btnStyle("#6366F1"), padding: "6px 14px", fontSize: 11 }}>{loading ? "⏳" : "🔄 Refresh"}</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "#0A0C14", padding: 4, borderRadius: 6 }}>
          {tabBtn("suppressions", "Suppressions", prefs.length)}
          {tabBtn("throttle", "Throttle Log", throttle.length)}
          {tabBtn("zdAudit", "ZD Push Audit", zdAudit.total)}
        </div>

        {tab === "suppressions" && (
          <div>
            <div style={{ marginBottom: 12, padding: 12, background: "#0A0C14", borderRadius: 6, border: "1px dashed #1E2130", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: "#C4CAD6", fontSize: 12 }}>Bulk pre-seed unsubscribe for internal users (vgctechnology.com, vgcsg.com):</span>
              <button onClick={() => runBulkSeed(true)} disabled={loading} style={{ ...btnStyle("#FFB347"), padding: "6px 12px", fontSize: 11 }}>Dry Run</button>
              {seedDryRun && (
                <>
                  <span style={{ color: "#FFB347", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                    eligible: {seedDryRun.eligible} (existing skipped: {seedDryRun.skipped})
                  </span>
                  <button onClick={() => runBulkSeed(false)} disabled={loading} style={{ ...btnStyle("#EC4899"), padding: "6px 12px", fontSize: 11 }}>Confirm Seed</button>
                </>
              )}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Space Grotesk', sans-serif" }}>
              <thead><tr><th style={thStyle}>Email</th><th style={thStyle}>Status</th><th style={thStyle}>Source</th><th style={thStyle}>Updated</th><th style={thStyle}>Action</th></tr></thead>
              <tbody>
                {prefs.length === 0 && <tr><td style={cellStyle} colSpan={5}>No preferences recorded.</td></tr>}
                {prefs.map(p => (
                  <tr key={p.id || p.email}>
                    <td style={cellStyle}>{p.email}</td>
                    <td style={cellStyle}>{p.autoConfirm ? <span style={{ color: "#22C55E" }}>● Subscribed</span> : <span style={{ color: "#EF4444" }}>● Opted-out</span>}</td>
                    <td style={cellStyle}><code style={{ color: "#5A6178", fontSize: 11 }}>{p.source || "-"}</code></td>
                    <td style={cellStyle}><code style={{ color: "#5A6178", fontSize: 11 }}>{p.updatedAt ? p.updatedAt.slice(0, 19).replace("T", " ") : "-"}</code></td>
                    <td style={cellStyle}>
                      <button onClick={() => togglePref(p.email, !p.autoConfirm)} style={{ ...btnStyle(p.autoConfirm ? "#EF4444" : "#22C55E"), padding: "4px 10px", fontSize: 10 }}>
                        {p.autoConfirm ? "Unsubscribe" : "Re-subscribe"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "throttle" && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Space Grotesk', sans-serif" }}>
            <thead><tr><th style={thStyle}>Email</th><th style={thStyle}>Incident</th><th style={thStyle}>Source</th><th style={thStyle}>Sent</th><th style={thStyle}>Window</th></tr></thead>
            <tbody>
              {throttle.length === 0 && <tr><td style={cellStyle} colSpan={5}>No confirmation emails logged yet.</td></tr>}
              {throttle.map((t, i) => {
                const ageH = t.sentAt ? (Date.now() - new Date(t.sentAt).getTime()) / 3600000 : null;
                const within24 = ageH != null && ageH < 24;
                return (
                  <tr key={i}>
                    <td style={cellStyle}>{t.email || "-"}</td>
                    <td style={cellStyle}><code style={{ color: "#818CF8", fontSize: 11 }}>{t.incidentId || "-"}</code></td>
                    <td style={cellStyle}><code style={{ color: "#5A6178", fontSize: 11 }}>{t.source || "-"}</code></td>
                    <td style={cellStyle}><code style={{ color: "#5A6178", fontSize: 11 }}>{t.sentAt ? t.sentAt.slice(0, 19).replace("T", " ") : "-"}</code></td>
                    <td style={cellStyle}>{within24 ? <span style={{ color: "#FFB347" }}>● Throttled (&lt;24h)</span> : <span style={{ color: "#5A6178" }}>○ Open</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {tab === "zdAudit" && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Space Grotesk', sans-serif" }}>
            <thead><tr><th style={thStyle}>When</th><th style={thStyle}>Ticket</th><th style={thStyle}>Reason</th><th style={thStyle}>Detail</th></tr></thead>
            <tbody>
              {zdAudit.items.length === 0 && <tr><td style={cellStyle} colSpan={4}>No ZD push suppressions yet.</td></tr>}
              {zdAudit.items.map((r, i) => {
                let parsed = {}; try { parsed = typeof r.data === "string" ? JSON.parse(r.data) : (r.data || {}); } catch {}
                return (
                  <tr key={i}>
                    <td style={cellStyle}><code style={{ color: "#5A6178", fontSize: 11 }}>{r.timestamp ? String(r.timestamp).slice(0, 19).replace("T", " ") : "-"}</code></td>
                    <td style={cellStyle}><code style={{ color: "#818CF8", fontSize: 11 }}>#{r.record_id || "-"}</code></td>
                    <td style={cellStyle}>{r.action === "push_suppressed_flag" ? <span style={{ color: "#EF4444" }}>flag off</span> : <span style={{ color: "#FFB347" }}>dedup 60s</span>}</td>
                    <td style={cellStyle}><code style={{ color: "#5A6178", fontSize: 11 }}>{parsed.action || "-"} {parsed.status ? `→ ${parsed.status}` : ""}</code></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ─── Phase H2 — Feature Flags Tab ──────────────────────────────────────

// ─── Phase H2 — Feature Flags Tab ──────────────────────────────────────
export const FeatureFlagsTab = () => {
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editPayload, setEditPayload] = useState({}); // name -> JSON string
  const reload = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/feature-flags").then(r => r.json());
      setFlags(r.flags || []);
    } catch (e) { console.warn("[FeatureFlags] reload failed", e); }
    setLoading(false);
  };
  useEffect(() => { reload(); }, []);

  const update = async (name, patch) => {
    const r = await fetch("/api/feature-flags", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ...patch }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(`Update failed: ${d.error || r.statusText}`); return; }
    reload();
  };
  const savePayload = (name) => {
    const txt = editPayload[name];
    if (!txt) return;
    try {
      const obj = JSON.parse(txt);
      update(name, { payload: obj });
      setEditPayload(p => { const n = { ...p }; delete n[name]; return n; });
    } catch (e) { alert("Invalid JSON: " + e.message); }
  };

  const cellStyle = { padding: "10px 12px", borderBottom: "1px solid #1E213044", color: "#C4CAD6", fontSize: 12, verticalAlign: "top" };

  return (
    <div>
      <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>🚩 Feature Flags</h3>
            <p style={{ margin: "4px 0 0", color: "#5A6178", fontSize: 11 }}>Toggle live system behavior. Every change is audited (who/when/before/after).</p>
          </div>
          <button onClick={reload} disabled={loading} style={{ ...btnStyle("#6366F1"), padding: "6px 14px", fontSize: 11 }}>{loading ? "⏳" : "🔄 Refresh"}</button>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Space Grotesk', sans-serif" }}>
          <thead>
            <tr style={{ background: "#0A0C14" }}>
              <th style={{ ...cellStyle, fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, fontFamily: "'JetBrains Mono', monospace" }}>Flag</th>
              <th style={{ ...cellStyle, fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, fontFamily: "'JetBrains Mono', monospace" }}>Enabled</th>
              <th style={{ ...cellStyle, fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, fontFamily: "'JetBrains Mono', monospace" }}>Scope</th>
              <th style={{ ...cellStyle, fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, fontFamily: "'JetBrains Mono', monospace" }}>Payload</th>
            </tr>
          </thead>
          <tbody>
            {flags.map(f => (
              <tr key={f.name}>
                <td style={cellStyle}>
                  <code style={{ color: "#818CF8", fontSize: 12, fontWeight: 600 }}>{f.name}</code>
                </td>
                <td style={cellStyle}>
                  <div onClick={() => update(f.name, { enabled: !f.enabled })}
                    style={{ width: 44, height: 24, borderRadius: 12, cursor: "pointer", background: f.enabled ? "#22C55E" : "#1E2130", padding: 2, transition: "background 0.2s" }}>
                    <div style={{ width: 20, height: 20, borderRadius: 10, background: "#fff", transform: f.enabled ? "translateX(20px)" : "translateX(0)", transition: "transform 0.2s" }} />
                  </div>
                </td>
                <td style={cellStyle}>
                  <select value={f.scope || "all"} onChange={e => update(f.name, { scope: e.target.value })} style={{ ...inputStyle, padding: "5px 8px", fontSize: 11, width: "auto" }}>
                    <option value="all">all</option><option value="prod">prod</option><option value="staging">staging</option>
                  </select>
                </td>
                <td style={cellStyle}>
                  {f.payload != null ? (
                    <div>
                      <textarea
                        value={editPayload[f.name] != null ? editPayload[f.name] : JSON.stringify(f.payload, null, 2)}
                        onChange={e => setEditPayload(p => ({ ...p, [f.name]: e.target.value }))}
                        style={{ ...inputStyle, fontSize: 11, fontFamily: "'JetBrains Mono', monospace", minHeight: 60, width: 280 }} />
                      {editPayload[f.name] != null && (
                        <div style={{ marginTop: 4, display: "flex", gap: 6 }}>
                          <button onClick={() => savePayload(f.name)} style={{ ...btnStyle("#22C55E"), padding: "4px 10px", fontSize: 10 }}>Save</button>
                          <button onClick={() => setEditPayload(p => { const n = { ...p }; delete n[f.name]; return n; })} style={{ ...btnStyle("#5A6178"), padding: "4px 10px", fontSize: 10 }}>Cancel</button>
                        </div>
                      )}
                    </div>
                  ) : <span style={{ color: "#5A6178", fontSize: 11 }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Phase I1 — AI Decisions Tab ───────────────────────────────────────

// ─── Phase I1 — AI Decisions Tab ───────────────────────────────────────
export const AIDecisionsTab = ({ currentUser }) => {
  const [tab, setTab] = useState("outbox");
  const [outbox, setOutbox] = useState({ items: [], counts: {}, total: 0 });
  const [aiAudit, setAiAudit] = useState([]);
  const [shadow, setShadow] = useState({ diffs: [], flagStats: {}, total: 0 });
  const [loading, setLoading] = useState(false);
  const [shadowFilter, setShadowFilter] = useState("");

  const reload = async () => {
    setLoading(true);
    try {
      const [o, a, s] = await Promise.all([
        fetch("/api/ai/outbox").then(r => r.json()),
        fetch("/api/ai/audit?limit=100").then(r => r.json()).catch(() => ({ data: [] })),
        fetch(`/api/shadow/diffs?limit=200${shadowFilter ? `&flag=${encodeURIComponent(shadowFilter)}` : ""}`).then(r => r.json()),
      ]);
      setOutbox({ items: o.items || [], counts: o.counts || {}, total: o.total || 0 });
      setAiAudit(Array.isArray(a.data) ? a.data : (a.entries || []));
      setShadow({ diffs: s.diffs || [], flagStats: s.flagStats || {}, total: s.total || 0 });
    } catch (e) { console.warn("[AIDecisions] reload failed", e); }
    setLoading(false);
  };
  useEffect(() => { reload(); }, [shadowFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const approver = (currentUser && (currentUser.email || currentUser.name)) || "admin";

  const outboxAction = async (id, action) => {
    let body = { approvedBy: approver };
    if (action === "reject") {
      const reason = window.prompt("Rejection reason?", "Not appropriate");
      if (reason == null) return; body.reason = reason;
    } else if (action === "reschedule") {
      const m = window.prompt("Delay (minutes)?", "30");
      if (m == null) return; body.delayMinutes = parseInt(m, 10) || 30;
    }
    const r = await fetch(`/api/ai/outbox/${encodeURIComponent(id)}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(`Failed: ${d.error || r.statusText}`); return; }
    reload();
  };

  const promote = async (flag, decision) => {
    const notes = window.prompt(`${decision === "promote" ? "Promote" : "Reject"} ${flag}? Notes:`, "");
    if (notes == null) return;
    const r = await fetch("/api/shadow/promote", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flag, decision, approvedBy: approver, notes }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(`Failed: ${d.error || r.statusText}`); return; }
    const d = await r.json();
    alert(`Recorded. Recommendation:\n${d.recommendation}\n\nApply via Feature Flags tab.`);
    reload();
  };

  const tabBtn = (id, label, count) => (
    <button onClick={() => setTab(id)} style={{
      padding: "8px 14px", borderRadius: 6, border: "none", cursor: "pointer",
      background: tab === id ? "#1E2130" : "transparent",
      color: tab === id ? "#E8ECF4" : "#5A6178",
      fontSize: 12, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif",
    }}>{label}{count != null && <span style={{ marginLeft: 6, color: "#818CF8", fontFamily: "'JetBrains Mono', monospace" }}>{count}</span>}</button>
  );
  const cellStyle = { padding: "8px 12px", borderBottom: "1px solid #1E213044", color: "#C4CAD6", fontSize: 12, verticalAlign: "top" };
  const thStyle = { ...cellStyle, color: "#5A6178", textTransform: "uppercase", fontSize: 10, letterSpacing: 0.8, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 };

  return (
    <div>
      <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>🤖 AI Decisions</h3>
            <p style={{ margin: "4px 0 0", color: "#5A6178", fontSize: 11 }}>Operator review surface for cooling-off queue, AI audit, and shadow harness diffs.</p>
          </div>
          <button onClick={reload} disabled={loading} style={{ ...btnStyle("#6366F1"), padding: "6px 14px", fontSize: 11 }}>{loading ? "⏳" : "🔄 Refresh"}</button>
        </div>
        <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "#0A0C14", padding: 4, borderRadius: 6 }}>
          {tabBtn("outbox", "Cooling-off Queue", outbox.counts.queued || 0)}
          {tabBtn("audit", "AI Audit", aiAudit.length)}
          {tabBtn("shadow", "Shadow Diffs", shadow.total)}
        </div>

        {tab === "outbox" && (
          <div>
            <div style={{ marginBottom: 8, color: "#5A6178", fontSize: 11 }}>
              Counts: queued <b style={{ color: "#FFB347" }}>{outbox.counts.queued || 0}</b> · sent <b style={{ color: "#22C55E" }}>{outbox.counts.sent || 0}</b> · rejected <b style={{ color: "#EF4444" }}>{outbox.counts.rejected || 0}</b> · failed <b style={{ color: "#EF4444" }}>{outbox.counts.failed || 0}</b>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Space Grotesk', sans-serif" }}>
              <thead><tr><th style={thStyle}>Incident</th><th style={thStyle}>Sev</th><th style={thStyle}>To</th><th style={thStyle}>Subject</th><th style={thStyle}>Send After</th><th style={thStyle}>Status</th><th style={thStyle}>Actions</th></tr></thead>
              <tbody>
                {outbox.items.length === 0 && <tr><td style={cellStyle} colSpan={7}>No outbox entries.</td></tr>}
                {outbox.items.map(o => {
                  const due = o.sendAfter ? (new Date(o.sendAfter).getTime() - Date.now()) / 60000 : null;
                  return (
                    <tr key={o.id}>
                      <td style={cellStyle}><code style={{ color: "#818CF8", fontSize: 11 }}>{o.incidentId}</code></td>
                      <td style={cellStyle}>{o.severity}</td>
                      <td style={cellStyle}>{Array.isArray(o.opts?.to) ? o.opts.to[0] : o.opts?.to || "-"}</td>
                      <td style={cellStyle} title={o.opts?.subject}>{(o.opts?.subject || "").slice(0, 50)}</td>
                      <td style={cellStyle}><code style={{ color: "#5A6178", fontSize: 11 }}>{o.sendAfter ? `${o.sendAfter.slice(11, 16)} (${due > 0 ? `+${Math.round(due)}m` : "due"})` : "-"}</code></td>
                      <td style={cellStyle}>{o.status === "queued" ? <span style={{ color: "#FFB347" }}>● queued</span> : o.status === "sent" ? <span style={{ color: "#22C55E" }}>● sent</span> : o.status === "rejected" ? <span style={{ color: "#EF4444" }}>● rejected</span> : <span style={{ color: "#5A6178" }}>{o.status}</span>}</td>
                      <td style={cellStyle}>
                        {o.status === "queued" && (
                          <div style={{ display: "flex", gap: 4 }}>
                            <button onClick={() => outboxAction(o.id, "approve")} style={{ ...btnStyle("#22C55E"), padding: "4px 8px", fontSize: 10 }}>Send</button>
                            <button onClick={() => outboxAction(o.id, "reschedule")} style={{ ...btnStyle("#FFB347"), padding: "4px 8px", fontSize: 10 }}>Delay</button>
                            <button onClick={() => outboxAction(o.id, "reject")} style={{ ...btnStyle("#EF4444"), padding: "4px 8px", fontSize: 10 }}>Reject</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === "audit" && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Space Grotesk', sans-serif" }}>
            <thead><tr><th style={thStyle}>When</th><th style={thStyle}>Decision</th><th style={thStyle}>Model</th><th style={thStyle}>Subject</th><th style={thStyle}>Cost</th></tr></thead>
            <tbody>
              {aiAudit.length === 0 && <tr><td style={cellStyle} colSpan={5}>No AI audit entries.</td></tr>}
              {aiAudit.slice(0, 100).map((a, i) => (
                <tr key={i}>
                  <td style={cellStyle}><code style={{ color: "#5A6178", fontSize: 11 }}>{(a.timestamp || a.at || "").slice(0, 19).replace("T", " ")}</code></td>
                  <td style={cellStyle}>{a.decision || a.action || "-"}</td>
                  <td style={cellStyle}><code style={{ color: "#5A6178", fontSize: 11 }}>{a.model || "-"}</code></td>
                  <td style={cellStyle}>{(a.subject || a.summary || "").slice(0, 60)}</td>
                  <td style={cellStyle}><code style={{ color: "#5A6178", fontSize: 11 }}>{a.cost != null ? `$${a.cost}` : "-"}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === "shadow" && (
          <div>
            <div style={{ marginBottom: 12, padding: 12, background: "#0A0C14", borderRadius: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: "#5A6178", fontSize: 11 }}>By flag:</span>
              <button onClick={() => setShadowFilter("")} style={{ ...btnStyle(shadowFilter === "" ? "#6366F1" : "#1E2130"), padding: "4px 10px", fontSize: 10 }}>All ({shadow.total})</button>
              {Object.entries(shadow.flagStats).map(([f, c]) => (
                <React.Fragment key={f}>
                  <button onClick={() => setShadowFilter(f)} style={{ ...btnStyle(shadowFilter === f ? "#6366F1" : "#1E2130"), padding: "4px 10px", fontSize: 10 }}>
                    {f} ({c})
                  </button>
                  <button onClick={() => promote(f, "promote")} style={{ ...btnStyle("#22C55E"), padding: "4px 8px", fontSize: 10 }}>Promote</button>
                  <button onClick={() => promote(f, "reject")} style={{ ...btnStyle("#EF4444"), padding: "4px 8px", fontSize: 10 }}>Reject</button>
                </React.Fragment>
              ))}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Space Grotesk', sans-serif" }}>
              <thead><tr><th style={thStyle}>When</th><th style={thStyle}>Flag</th><th style={thStyle}>Kind</th><th style={thStyle}>Incident</th><th style={thStyle}>Control</th><th style={thStyle}>Candidate</th></tr></thead>
              <tbody>
                {shadow.diffs.length === 0 && <tr><td style={cellStyle} colSpan={6}>No shadow diffs yet.</td></tr>}
                {shadow.diffs.slice(0, 200).map((d, i) => (
                  <tr key={i}>
                    <td style={cellStyle}><code style={{ color: "#5A6178", fontSize: 11 }}>{(d.at || "").slice(0, 19).replace("T", " ")}</code></td>
                    <td style={cellStyle}><code style={{ color: "#818CF8", fontSize: 11 }}>{d.flag}</code></td>
                    <td style={cellStyle}>{d.kind || "diff"}</td>
                    <td style={cellStyle}><code style={{ color: "#5A6178", fontSize: 11 }}>{d.incidentId || "-"}</code></td>
                    <td style={cellStyle}><code style={{ color: "#22C55E", fontSize: 11 }}>{typeof d.control === "object" ? JSON.stringify(d.control).slice(0, 60) : String(d.control || "-").slice(0, 60)}</code></td>
                    <td style={cellStyle}><code style={{ color: "#FFB347", fontSize: 11 }}>{typeof d.candidate === "object" ? JSON.stringify(d.candidate).slice(0, 60) : String(d.candidate || "-").slice(0, 60)}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Phase J3 — Compliance Evidence Pack Tab ──────────────────────────

// ─── Phase J3 — Compliance Evidence Pack Tab ──────────────────────────
export const ComplianceTab = () => {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [snap, setSnap] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/compliance/evidence?from=${from}&to=${to}`).then(r => r.json());
      setItems(r.items || []);
    } catch (e) { console.warn("[Compliance] reload", e); }
    setLoading(false);
  };
  useEffect(() => { reload(); }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerSnapshot = async () => {
    setSnap(true);
    try {
      const r = await fetch("/api/compliance/snapshot-now", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(`Failed: ${d.error || r.statusText}`); }
      else { await reload(); alert("Snapshot captured."); }
    } catch (e) { alert(`Failed: ${e.message}`); }
    setSnap(false);
  };

  const exportUrl = (format) => `/api/compliance/export?from=${from}&to=${to}&format=${format}`;
  const cellStyle = { padding: "8px 12px", borderBottom: "1px solid #1E213044", color: "#C4CAD6", fontSize: 12 };
  const thStyle = { ...cellStyle, color: "#5A6178", textTransform: "uppercase", fontSize: 10, letterSpacing: 0.8, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 };

  return (
    <div>
      <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>📜 Compliance Evidence Pack</h3>
            <p style={{ margin: "4px 0 0", color: "#5A6178", fontSize: 11 }}>ITIL 4 / ISO 20000 daily metric snapshots. Captured 00:05 SGT.</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={triggerSnapshot} disabled={snap} style={{ ...btnStyle("#FFB347"), padding: "6px 14px", fontSize: 11 }}>{snap ? "⏳" : "📸 Snapshot now"}</button>
            <button onClick={reload} disabled={loading} style={{ ...btnStyle("#6366F1"), padding: "6px 14px", fontSize: 11 }}>{loading ? "⏳" : "🔄 Refresh"}</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, padding: 12, background: "#0A0C14", borderRadius: 6, flexWrap: "wrap" }}>
          <label style={{ color: "#5A6178", fontSize: 11 }}>From: <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ marginLeft: 4, padding: "4px 8px", background: "#1E2130", border: "1px solid #2A2E42", borderRadius: 4, color: "#E8ECF4", fontSize: 11 }} /></label>
          <label style={{ color: "#5A6178", fontSize: 11 }}>To: <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ marginLeft: 4, padding: "4px 8px", background: "#1E2130", border: "1px solid #2A2E42", borderRadius: 4, color: "#E8ECF4", fontSize: 11 }} /></label>
          <span style={{ marginLeft: "auto", color: "#5A6178", fontSize: 11 }}>Export:</span>
          <a href={exportUrl("html")} target="_blank" rel="noopener noreferrer" style={{ ...btnStyle("#22C55E"), padding: "4px 10px", fontSize: 10, textDecoration: "none", display: "inline-block" }}>HTML</a>
          <a href={exportUrl("csv")} target="_blank" rel="noopener noreferrer" style={{ ...btnStyle("#818CF8"), padding: "4px 10px", fontSize: 10, textDecoration: "none", display: "inline-block" }}>CSV</a>
          <a href={exportUrl("json")} target="_blank" rel="noopener noreferrer" style={{ ...btnStyle("#5A6178"), padding: "4px 10px", fontSize: 10, textDecoration: "none", display: "inline-block" }}>JSON</a>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Space Grotesk', sans-serif" }}>
          <thead><tr><th style={thStyle}>Date</th><th style={thStyle}>SLA %</th><th style={thStyle}>MTTR h</th><th style={thStyle}>CSAT</th><th style={thStyle}>Created</th><th style={thStyle}>Resolved</th><th style={thStyle}>Changes</th><th style={thStyle}>Freeze viol.</th><th style={thStyle}>Captured</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td style={cellStyle} colSpan={9}>No evidence in range. Click "Snapshot now" to capture today's metrics.</td></tr>}
            {items.map(i => (
              <tr key={i.id || i.date}>
                <td style={cellStyle}><b style={{ color: "#E8ECF4" }}>{i.date}</b></td>
                <td style={cellStyle}><span style={{ color: ((i.metrics||{}).slaAttainmentPct ?? 0) >= 95 ? "#22C55E" : "#FFB347" }}>{(i.metrics||{}).slaAttainmentPct ?? "-"}%</span></td>
                <td style={cellStyle}>{(i.metrics||{}).mttrHours ?? "-"}</td>
                <td style={cellStyle}>{(i.metrics||{}).csatAvg30d ?? "-"}</td>
                <td style={cellStyle}>{(i.metrics||{}).incidentsCreated ?? 0}</td>
                <td style={cellStyle}>{(i.metrics||{}).incidentsResolved ?? 0}</td>
                <td style={cellStyle}>{(i.metrics||{}).totalChanges ?? 0}</td>
                <td style={cellStyle}><span style={{ color: ((i.metrics||{}).changeFreezeViolations ?? 0) > 0 ? "#EF4444" : "#22C55E" }}>{(i.metrics||{}).changeFreezeViolations ?? 0}</span></td>
                <td style={cellStyle}><code style={{ color: "#5A6178", fontSize: 11 }}>{(i.capturedAt || "").slice(11, 19)}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Main App ────────────────────────────────────────────────────────────