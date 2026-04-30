import React, { useState, useMemo, useCallback } from "react";
import { btnStyle, inputStyle } from "../constants/theme.js";
import { Badge, SearchBar, DataTable, Modal, FormField } from "../components/SharedComponents.jsx";
import { genId } from "../utils/slaHelpers.js";

export default function VendorPortalModule({ ctx }) {
  const {
    currentUser, showToast, _save,
    vendors, setVendors, incidents,
  } = ctx;

  const [vpTab, setVpTab] = useState("overview");
  const [vpSearch, setVpSearch] = useState("");
  const [vpVendor, setVpVendor] = useState(null);
  const [showAddVendor, setShowAddVendor] = useState(false);
  const [vpForm, setVpForm] = useState({ name: "", category: "", supportEmail: "", supportPhone: "", responseExpectation: "", escalationSOP: "", notes: "", contractExpiry: "", slaTarget: "99.5" });
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiInsights, setAiInsights] = useState(null);

  // Vendor performance metrics computed from incidents
  const vendorMetrics = useMemo(() => {
    const metrics = {};
    vendors.forEach(v => {
      const vInc = incidents.filter(i => (i.vendor || i.assignedVendor || "").toLowerCase().includes(v.name.toLowerCase()));
      const resolved = vInc.filter(i => i.status === "Resolved" || i.status === "Closed");
      const total = vInc.length || 1;
      const avgResTime = resolved.length > 0
        ? Math.round(resolved.reduce((s, i) => {
            const c = new Date(i.createdAt || i.created || 0);
            const r = new Date(i.resolvedAt || i.updatedAt || Date.now());
            return s + (r - c) / 3600000;
          }, 0) / resolved.length)
        : 0;
      metrics[v.id] = {
        totalTickets: vInc.length,
        openTickets: vInc.filter(i => i.status !== "Resolved" && i.status !== "Closed").length,
        resolvedTickets: resolved.length,
        resolutionRate: Math.round((resolved.length / total) * 100),
        avgResolutionHours: avgResTime,
        criticalTickets: vInc.filter(i => i.priority === "Sev-A").length,
        score: Math.min(100, Math.max(0, 100 - vInc.filter(i => i.priority === "Sev-A").length * 10 - vInc.filter(i => i.status !== "Resolved" && i.status !== "Closed").length * 5 + resolved.length * 2)),
      };
    });
    return metrics;
  }, [vendors, incidents]);

  const q = vpSearch.toLowerCase();
  const filtered = q ? vendors.filter(v => v.name.toLowerCase().includes(q) || (v.category || "").toLowerCase().includes(q)) : vendors;

  const scoreColor = (score) => score >= 80 ? "#4CAF50" : score >= 60 ? "#FFB347" : "#FF6B6B";

  const getAiInsights = async () => {
    setAiAnalyzing(true);
    try {
      const resp = await fetch("/api/ai/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Analyze vendor performance data and provide insights. Vendors: ${vendors.map(v => `${v.name} (${v.category}): ${vendorMetrics[v.id]?.totalTickets || 0} tickets, ${vendorMetrics[v.id]?.resolutionRate || 0}% resolution rate, score ${vendorMetrics[v.id]?.score || 0}`).join("; ")}. Provide: 1) Top performing vendor 2) Vendor needing attention 3) Risk assessment 4) Cost optimization suggestions. Format as JSON with keys: topPerformer, needsAttention, risks, costTips.`,
          context: "vendor_analysis"
        })
      });
      const data = await resp.json();
      try { setAiInsights(JSON.parse(data.reply || data.response || "{}")); } catch { setAiInsights({ summary: data.reply || data.response || "Analysis complete" }); }
    } catch { setAiInsights({ summary: "Unable to get AI insights at this time." }); }
    setAiAnalyzing(false);
  };

  const addVendor = () => {
    if (!vpForm.name) { showToast("Vendor name is required", "error"); return; }
    const newVendor = { id: genId("V"), ...vpForm, docLinks: [], createdAt: new Date().toISOString(), createdBy: currentUser.name };
    setVendors(prev => [...prev, newVendor]);
    setShowAddVendor(false);
    setVpForm({ name: "", category: "", supportEmail: "", supportPhone: "", responseExpectation: "", escalationSOP: "", notes: "", contractExpiry: "", slaTarget: "99.5" });
    showToast(`✅ Vendor ${vpForm.name} added`, "success");
  };

  const tabs = [
    { id: "overview", label: "Overview", icon: "📊" },
    { id: "directory", label: "Directory", icon: "🏢" },
    { id: "contracts", label: "Contracts & SLA", icon: "📋" },
    { id: "performance", label: "Performance", icon: "📈" },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 10, background: "linear-gradient(135deg, #8B5CF6, #6366F1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🏢</div>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>Vendor Portal</h2>
            <div style={{ fontSize: 11, color: "#5A6178" }}>{vendors.length} vendors · Contract management & performance tracking</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={getAiInsights} disabled={aiAnalyzing} style={{ ...btnStyle("#8B5CF6"), fontSize: 11, opacity: aiAnalyzing ? 0.6 : 1 }}>
            {aiAnalyzing ? "⏳ Analyzing..." : "🤖 AI Insights"}
          </button>
          <button onClick={() => setShowAddVendor(true)} style={btnStyle()}>+ Add Vendor</button>
        </div>
      </div>

      {/* AI Insights Banner */}
      {aiInsights && (
        <div style={{ background: "linear-gradient(135deg, #8B5CF608, #6366F108)", borderRadius: 10, border: "1px solid #8B5CF622", padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 16 }}>🤖</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#8B5CF6", fontFamily: "'Space Grotesk', sans-serif" }}>AI Vendor Insights</span>
            <button onClick={() => setAiInsights(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#5A6178", cursor: "pointer", fontSize: 14 }}>✕</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {aiInsights.topPerformer && (
              <div style={{ background: "#0D2D1A", borderRadius: 8, padding: 10, border: "1px solid #4CAF5022" }}>
                <div style={{ fontSize: 10, color: "#4CAF50", fontWeight: 700, marginBottom: 4 }}>🏆 TOP PERFORMER</div>
                <div style={{ fontSize: 12, color: "#C4CAD6" }}>{aiInsights.topPerformer}</div>
              </div>
            )}
            {aiInsights.needsAttention && (
              <div style={{ background: "#3B1F00", borderRadius: 8, padding: 10, border: "1px solid #FFB34722" }}>
                <div style={{ fontSize: 10, color: "#FFB347", fontWeight: 700, marginBottom: 4 }}>⚠️ NEEDS ATTENTION</div>
                <div style={{ fontSize: 12, color: "#C4CAD6" }}>{aiInsights.needsAttention}</div>
              </div>
            )}
            {aiInsights.risks && (
              <div style={{ background: "#2D0D0D", borderRadius: 8, padding: 10, border: "1px solid #FF6B6B22" }}>
                <div style={{ fontSize: 10, color: "#FF6B6B", fontWeight: 700, marginBottom: 4 }}>🔴 RISKS</div>
                <div style={{ fontSize: 12, color: "#C4CAD6" }}>{Array.isArray(aiInsights.risks) ? aiInsights.risks.join(", ") : aiInsights.risks}</div>
              </div>
            )}
            {aiInsights.costTips && (
              <div style={{ background: "#0D2137", borderRadius: 8, padding: 10, border: "1px solid #06B6D422" }}>
                <div style={{ fontSize: 10, color: "#06B6D4", fontWeight: 700, marginBottom: 4 }}>💰 COST OPTIMIZATION</div>
                <div style={{ fontSize: 12, color: "#C4CAD6" }}>{Array.isArray(aiInsights.costTips) ? aiInsights.costTips.join(", ") : aiInsights.costTips}</div>
              </div>
            )}
            {aiInsights.summary && !aiInsights.topPerformer && (
              <div style={{ gridColumn: "1 / -1", background: "#0A0C14", borderRadius: 8, padding: 10, border: "1px solid #1E213044" }}>
                <div style={{ fontSize: 12, color: "#C4CAD6", whiteSpace: "pre-wrap" }}>{aiInsights.summary}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #1E2130", marginBottom: 20 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setVpTab(t.id)}
            style={{ padding: "10px 20px", background: vpTab === t.id ? "#12141E" : "transparent", border: "none", borderBottom: vpTab === t.id ? "2px solid #8B5CF6" : "2px solid transparent", color: vpTab === t.id ? "#E8ECF4" : "#5A6178", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6 }}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {vpTab === "overview" && (
        <div>
          {/* KPI Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Total Vendors", value: vendors.length, icon: "🏢", color: "#8B5CF6" },
              { label: "Active Contracts", value: vendors.filter(v => !v.contractExpiry || new Date(v.contractExpiry) > new Date()).length, icon: "📋", color: "#4CAF50" },
              { label: "Vendor Tickets", value: Object.values(vendorMetrics).reduce((s, m) => s + m.totalTickets, 0), icon: "🎫", color: "#FFB347" },
              { label: "Avg Score", value: `${vendors.length > 0 ? Math.round(Object.values(vendorMetrics).reduce((s, m) => s + m.score, 0) / vendors.length) : 0}%`, icon: "⭐", color: "#06B6D4" },
            ].map((kpi, i) => (
              <div key={i} style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", padding: "16px 18px", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: -10, right: -10, fontSize: 48, opacity: 0.06 }}>{kpi.icon}</div>
                <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{kpi.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: kpi.color, fontFamily: "'JetBrains Mono', monospace" }}>{kpi.value}</div>
              </div>
            ))}
          </div>

          {/* Vendor Cards Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {vendors.map(v => {
              const m = vendorMetrics[v.id] || {};
              return (
                <div key={v.id} onClick={() => { setVpVendor(v); setVpTab("directory"); }}
                  style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", padding: 16, cursor: "pointer", transition: "border-color 0.2s, transform 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#8B5CF644"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#1E2130"; e.currentTarget.style.transform = "none"; }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg, #8B5CF620, #6366F120)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#8B5CF6" }}>{v.name.charAt(0)}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>{v.name}</div>
                      <div style={{ fontSize: 10, color: "#5A6178" }}>{v.category}</div>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: scoreColor(m.score || 0), fontFamily: "'JetBrains Mono', monospace" }}>{m.score || 0}</div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 10 }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ color: "#5A6178" }}>Tickets</div>
                      <div style={{ color: "#E8ECF4", fontWeight: 700 }}>{m.totalTickets || 0}</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ color: "#5A6178" }}>Resolved</div>
                      <div style={{ color: "#4CAF50", fontWeight: 700 }}>{m.resolutionRate || 0}%</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ color: "#5A6178" }}>Avg Hrs</div>
                      <div style={{ color: "#FFB347", fontWeight: 700 }}>{m.avgResolutionHours || 0}h</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Directory Tab */}
      {vpTab === "directory" && (
        <div>
          <SearchBar value={vpSearch} onChange={setVpSearch} placeholder="Search vendors..." />
          <div style={{ marginTop: 16 }}>
            {filtered.map(v => {
              const m = vendorMetrics[v.id] || {};
              const isExpanded = vpVendor?.id === v.id;
              return (
                <div key={v.id} style={{ background: "#0F1117", borderRadius: 10, border: `1px solid ${isExpanded ? "#8B5CF644" : "#1E2130"}`, marginBottom: 10, overflow: "hidden" }}>
                  <div onClick={() => setVpVendor(isExpanded ? null : v)} style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 8, background: "linear-gradient(135deg, #8B5CF620, #6366F120)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#8B5CF6" }}>{v.name.charAt(0)}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4" }}>{v.name}</div>
                      <div style={{ fontSize: 11, color: "#5A6178" }}>{v.category}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: scoreColor(m.score || 0), fontFamily: "'JetBrains Mono', monospace" }}>{m.score || 0}</div>
                        <div style={{ fontSize: 9, color: "#5A6178" }}>score</div>
                      </div>
                      <span style={{ color: "#5A6178", transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: "0 18px 18px", borderTop: "1px solid #1E2130" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 14 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#8B5CF6", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace" }}>Contact Information</div>
                          <div style={{ fontSize: 12, color: "#C4CAD6", marginBottom: 4 }}>📧 {v.supportEmail || "—"}</div>
                          <div style={{ fontSize: 12, color: "#C4CAD6", marginBottom: 4 }}>📞 {v.supportPhone || "—"}</div>
                          <div style={{ fontSize: 12, color: "#C4CAD6", marginBottom: 4 }}>⏱️ {v.responseExpectation || "—"}</div>
                          {v.docLinks && v.docLinks.length > 0 && (
                            <div style={{ marginTop: 8 }}>
                              <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 4 }}>Quick Links:</div>
                              {v.docLinks.map((link, i) => (
                                <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" style={{ display: "block", fontSize: 11, color: "#64B5F6", textDecoration: "none", marginBottom: 2 }}>🔗 {link.label}</a>
                              ))}
                            </div>
                          )}
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#FFB347", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace" }}>Escalation SOP</div>
                          <div style={{ fontSize: 11, color: "#C4CAD6", whiteSpace: "pre-wrap", lineHeight: 1.6, background: "#0A0C14", borderRadius: 6, padding: 10, border: "1px solid #1E213044" }}>{v.escalationSOP || "No SOP defined"}</div>
                          {v.notes && (
                            <div style={{ marginTop: 8, fontSize: 11, color: "#5A6178", fontStyle: "italic" }}>📝 {v.notes}</div>
                          )}
                        </div>
                      </div>
                      {/* Performance strip */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginTop: 14, background: "#0A0C14", borderRadius: 8, padding: 12, border: "1px solid #1E213044" }}>
                        {[
                          { label: "Total Tickets", value: m.totalTickets || 0, color: "#8B5CF6" },
                          { label: "Open", value: m.openTickets || 0, color: "#FF6B6B" },
                          { label: "Resolved", value: m.resolvedTickets || 0, color: "#4CAF50" },
                          { label: "Resolution %", value: `${m.resolutionRate || 0}%`, color: "#06B6D4" },
                          { label: "Critical", value: m.criticalTickets || 0, color: "#FF6B6B" },
                        ].map((s, i) => (
                          <div key={i} style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase" }}>{s.label}</div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Contracts & SLA Tab */}
      {vpTab === "contracts" && (
        <div>
          <div style={{ display: "grid", gap: 10 }}>
            {vendors.map(v => {
              const expiry = v.contractExpiry ? new Date(v.contractExpiry) : null;
              const daysLeft = expiry ? Math.ceil((expiry - Date.now()) / 86400000) : null;
              const expiryColor = daysLeft === null ? "#5A6178" : daysLeft < 0 ? "#FF6B6B" : daysLeft < 30 ? "#FFB347" : "#4CAF50";
              return (
                <div key={v.id} style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg, #8B5CF620, #6366F120)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#8B5CF6" }}>{v.name.charAt(0)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4" }}>{v.name}</div>
                    <div style={{ fontSize: 10, color: "#5A6178" }}>{v.category}</div>
                  </div>
                  <div style={{ textAlign: "center", minWidth: 80 }}>
                    <div style={{ fontSize: 10, color: "#5A6178" }}>SLA Target</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#06B6D4", fontFamily: "'JetBrains Mono', monospace" }}>{v.slaTarget || v.responseExpectation || "—"}</div>
                  </div>
                  <div style={{ textAlign: "center", minWidth: 100 }}>
                    <div style={{ fontSize: 10, color: "#5A6178" }}>Contract Expiry</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: expiryColor, fontFamily: "'JetBrains Mono', monospace" }}>
                      {daysLeft === null ? "No contract" : daysLeft < 0 ? `Expired ${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`}
                    </div>
                  </div>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: expiryColor }} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Performance Tab */}
      {vpTab === "performance" && (
        <div>
          <div style={{ display: "grid", gap: 12 }}>
            {vendors.sort((a, b) => (vendorMetrics[b.id]?.score || 0) - (vendorMetrics[a.id]?.score || 0)).map((v, rank) => {
              const m = vendorMetrics[v.id] || {};
              return (
                <div key={v.id} style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", padding: "16px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: rank === 0 ? "#FFD70020" : "#1E2130", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: rank === 0 ? "#FFD700" : "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>#{rank + 1}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4" }}>{v.name}</div>
                      <div style={{ fontSize: 10, color: "#5A6178" }}>{v.category}</div>
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: scoreColor(m.score || 0), fontFamily: "'JetBrains Mono', monospace" }}>{m.score || 0}<span style={{ fontSize: 10, color: "#5A6178" }}>/100</span></div>
                  </div>
                  {/* Score bar */}
                  <div style={{ height: 6, background: "#1E2130", borderRadius: 3, overflow: "hidden", marginBottom: 12 }}>
                    <div style={{ width: `${m.score || 0}%`, height: "100%", background: `linear-gradient(90deg, ${scoreColor(m.score || 0)}, ${scoreColor(m.score || 0)}88)`, borderRadius: 3, transition: "width 0.5s" }} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                    {[
                      { label: "Total", value: m.totalTickets || 0, color: "#8B5CF6" },
                      { label: "Open", value: m.openTickets || 0, color: "#FF6B6B" },
                      { label: "Resolution", value: `${m.resolutionRate || 0}%`, color: "#4CAF50" },
                      { label: "Avg Time", value: `${m.avgResolutionHours || 0}h`, color: "#FFB347" },
                      { label: "Critical", value: m.criticalTickets || 0, color: m.criticalTickets > 0 ? "#FF6B6B" : "#4CAF50" },
                    ].map((s, i) => (
                      <div key={i} style={{ textAlign: "center", background: "#0A0C14", borderRadius: 6, padding: "8px 4px" }}>
                        <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase", marginBottom: 2 }}>{s.label}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Vendor Modal */}
      {showAddVendor && (
        <Modal title="Add New Vendor" onClose={() => setShowAddVendor(false)} width={500}>
          <div style={{ display: "grid", gap: 12, padding: 20 }}>
            <FormField label="Vendor Name *" value={vpForm.name} onChange={v => setVpForm(f => ({ ...f, name: v }))} />
            <FormField label="Category" value={vpForm.category} onChange={v => setVpForm(f => ({ ...f, category: v }))} placeholder="e.g. Cloud & Productivity" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <FormField label="Support Email" value={vpForm.supportEmail} onChange={v => setVpForm(f => ({ ...f, supportEmail: v }))} />
              <FormField label="Support Phone" value={vpForm.supportPhone} onChange={v => setVpForm(f => ({ ...f, supportPhone: v }))} />
            </div>
            <FormField label="Response Expectation" value={vpForm.responseExpectation} onChange={v => setVpForm(f => ({ ...f, responseExpectation: v }))} placeholder="e.g. Sev-A: 1hr, Sev-B: 4hrs" />
            <div>
              <label style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>Escalation SOP</label>
              <textarea value={vpForm.escalationSOP} onChange={e => setVpForm(f => ({ ...f, escalationSOP: e.target.value }))} rows={4} style={{ ...inputStyle, resize: "vertical" }} placeholder="Step-by-step escalation procedure..." />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <FormField label="Contract Expiry" type="date" value={vpForm.contractExpiry} onChange={v => setVpForm(f => ({ ...f, contractExpiry: v }))} />
              <FormField label="SLA Target (%)" value={vpForm.slaTarget} onChange={v => setVpForm(f => ({ ...f, slaTarget: v }))} />
            </div>
            <FormField label="Notes" value={vpForm.notes} onChange={v => setVpForm(f => ({ ...f, notes: v }))} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => setShowAddVendor(false)} style={btnStyle("#3A3F55")}>Cancel</button>
              <button onClick={addVendor} style={btnStyle("#4CAF50")}>✅ Add Vendor</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
