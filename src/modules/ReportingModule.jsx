import { useEffect, useRef, useState } from "react";
import { RBAC_PERMISSIONS } from "../constants/rbac.js";
import { btnStyle, inputStyle } from "../constants/theme.js";
import { Modal, FormField, SearchBar } from "../components/SharedComponents.jsx";
import { sanitizeHTML , computeIncidentSla, computeMTTR } from "../utils/slaHelpers.js";

export default function ReportingModule({  assets, changes, csatAiAnalysis, currentUser, customers, incidents, problems, requests, serviceReports, setActiveModule, setServiceReports, showToast, softDelete,
  smtpConfig, fetchCsatScores, runCsatAiAnalysis, submitCsatResponse
 }) {
  const [reportForm, setReportForm] = useState({ name: "", type: "Incident Summary", period: "This Month", format: "PDF", schedule: "None" });
  const [editingReportId, setEditingReportId] = useState(null);
  const [showAddReport, setShowAddReport] = useState(false);
  const [reportViewId, setReportViewId] = useState(null);
  const [zdLoading, setZdLoading] = useState(false);
  const [zdAnalytics, setZdAnalytics] = useState(null);
  const [zdCsat, setZdCsat] = useState(null);
  const [csatScores, setCsatScores] = useState([]);
  const [csatView, setCsatView] = useState("list");
  const [csatLoading, setCsatLoading] = useState(false);
  const [csatAiLoading, setCsatAiLoading] = useState(false);
  const [csatSubmitForm, setCsatSubmitForm] = useState(null);
  const [csatSubmitting, setCsatSubmitting] = useState(false);
  const [reportTab, setReportTab] = useState("generate");
  const [reportType, setReportType] = useState("daily");
  const [reportCustomer, setReportCustomer] = useState("All");
  // Service Reports tab state (must be at top level for Rules of Hooks)
  const [srSearch, setSrSearch] = useState("");
  const [srStatusFilter, setSrStatusFilter] = useState("All");
  const [srSvcInput, setSrSvcInput] = useState("");
  const [sessionTimerActive, setSessionTimerActive] = useState(false);
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const sessionTimerRef = useRef(null);
  useEffect(() => () => { if (sessionTimerRef.current) clearInterval(sessionTimerRef.current); }, []);
  const [reportDateFrom, setReportDateFrom] = useState("2026-03-01");
  const [reportDateTo, setReportDateTo] = useState("2026-03-26");
  const [reportFormat, setReportFormat] = useState("PDF");
  const [generating, setGenerating] = useState(false);
  const [generatedReports, setGeneratedReports] = useState([
    { id: "RPT-001", name: "Daily Ticket Summary — 25 Mar 2026", type: "Daily Summary", created: "2026-03-25 18:00", format: "PDF", size: "1.2 MB", status: "Ready", generatedBy: "Auto-Scheduler" },
    { id: "RPT-002", name: "Weekly SLA Compliance — W12 2026", type: "SLA Compliance", created: "2026-03-24 08:00", format: "PDF", size: "2.8 MB", status: "Ready", generatedBy: "Auto-Scheduler" },
    { id: "RPT-003", name: "Monthly Executive Summary — Feb 2026", type: "Executive Summary", created: "2026-03-01 06:00", format: "PDF", size: "4.1 MB", status: "Ready", generatedBy: "Auto-Scheduler" },
    { id: "RPT-004", name: "Customer Report — VGC Gov — Mar 2026", type: "Customer Report", created: "2026-03-20 14:00", format: "XLSX", size: "890 KB", status: "Ready", generatedBy: "Priya Sharma" },
    { id: "RPT-005", name: "Incident Trend Analysis — Q1 2026", type: "Trend Analysis", created: "2026-03-15 10:30", format: "PDF", size: "3.5 MB", status: "Ready", generatedBy: "AI Engine" },
  ]);
  const [schedules] = useState([
    { id: "SCH-001", name: "Daily Ticket Summary", frequency: "Daily", time: "18:00 SGT", recipients: "itsupport@vgctechnology.com", format: "PDF", enabled: true, lastRun: "2026-03-25 18:00", nextRun: "2026-03-26 18:00" },
    { id: "SCH-002", name: "Weekly SLA Compliance", frequency: "Weekly (Mon)", time: "08:00 SGT", recipients: "hlaing@vgctechnology.com", format: "PDF", enabled: true, lastRun: "2026-03-24 08:00", nextRun: "2026-03-31 08:00" },
    { id: "SCH-003", name: "Monthly Executive Summary", frequency: "Monthly (1st)", time: "06:00 SGT", recipients: "executive@vgctechnology.com; hlaing@vgctechnology.com", format: "PDF", enabled: true, lastRun: "2026-03-01 06:00", nextRun: "2026-04-01 06:00" },
    { id: "SCH-004", name: "Monthly Customer Report", frequency: "Monthly (1st)", time: "09:00 SGT", recipients: "customer-success@vgctechnology.com", format: "XLSX", enabled: true, lastRun: "2026-03-01 09:00", nextRun: "2026-04-01 09:00" },
    { id: "SCH-005", name: "Quarterly Trend Analysis", frequency: "Quarterly", time: "10:00 SGT", recipients: "cto@vgctechnology.com; hlaing@vgctechnology.com", format: "PDF", enabled: true, lastRun: "2026-01-02 10:00", nextRun: "2026-04-01 10:00" },
  ]);

  const customers_list = ["All", ...customers.filter(c => c.status === "Active").map(c => c.name)];
  const reportTypes = [
    { id: "daily", label: "Daily Ticket Summary", icon: "📋", desc: "All tickets opened, resolved, and pending for the selected day" },
    { id: "weekly", label: "Weekly Summary", icon: "📊", desc: "Weekly trends, SLA performance, and team workload" },
    { id: "monthly", label: "Monthly Executive Summary", icon: "📈", desc: "High-level KPIs, trends, cost analysis, and recommendations" },
    { id: "sla", label: "SLA Compliance Report", icon: "⏱️", desc: "Detailed SLA adherence by priority, category, and team" },
    { id: "customer", label: "Customer Report", icon: "🏢", desc: "Per-customer ticket analysis, SLA performance, and satisfaction" },
    { id: "incident", label: "Incident Analysis", icon: "⚠️", desc: "Root cause analysis, repeat incidents, mean time to resolve" },
    { id: "change", label: "Change Management Report", icon: "🔄", desc: "Changes by status, success rate, risk analysis, CAB approvals" },
    { id: "problem", label: "Problem Management Report", icon: "🔍", desc: "Known errors, root causes, linked incidents, workarounds" },
    { id: "asset", label: "Asset & CMDB Report", icon: "💻", desc: "Asset inventory, lifecycle, warranty expiry, depreciation" },
    { id: "team", label: "Team Performance Report", icon: "👥", desc: "Per-agent resolution stats, workload, first response times" },
    { id: "trend", label: "Trend Analysis", icon: "📉", desc: "Historical trending across all metrics with AI predictions" },
    { id: "security", label: "Security & Compliance", icon: "🛡️", desc: "Security incidents, threat response times, compliance status" },
    { id: "satisfaction", label: "Customer Satisfaction (CSAT)", icon: "⭐", desc: "CSAT scores, NPS, feedback analysis per customer & agent" },
    { id: "capacity", label: "Capacity Planning", icon: "📐", desc: "Resource utilization, forecasting, and scaling recommendations" },
  ];

  // Quick stats for the dashboard
  const totalInc = incidents.length;
  const openInc = incidents.filter(i => i.status !== "Resolved" && i.status !== "Closed").length;
  const resolvedInc = incidents.filter(i => i.status === "Resolved").length;
  const slaBreaches = incidents.filter(i => computeIncidentSla(i).isBreached).length;
  const resolvedForMTTR = incidents.filter(i => i.status === "Resolved" || i.status === "Closed");
  const avgResolveHrs = resolvedForMTTR.length > 0 ? computeMTTR(resolvedForMTTR) : "N/A";

  const handleGenerate = () => {
    setGenerating(true);
    setTimeout(() => {
      const rt = reportTypes.find(r => r.id === reportType);
      const newReport = {
        id: `RPT-${String(generatedReports.length + 1).padStart(3, "0")}`,
        name: `${rt.label} — ${reportCustomer !== "All" ? reportCustomer + " — " : ""}${new Date().toLocaleDateString("en-GB")}`,
        type: rt.label, created: new Date().toLocaleString(), format: reportFormat,
        size: `${(Math.random() * 4 + 0.5).toFixed(1)} MB`, status: "Ready", generatedBy: currentUser.name
      };
      setGeneratedReports(prev => [newReport, ...prev]);
      setGenerating(false);
      setReportTab("history");
    }, 2000);
  };

  const tabs = [
    { id: "generate", label: "Generate Report", icon: "📝" },
    { id: "history", label: "Report History", icon: "📂" },
    { id: "schedule", label: "Scheduled Reports", icon: "🕐" },
    { id: "templates", label: "Templates", icon: "📄" },
    { id: "servicereports", label: "Service Reports", icon: "📋" },
    { id: "zendesk", label: "Zendesk Analytics", icon: "🎫" },
    { id: "csat", label: "CSAT Dashboard", icon: "⭐" },
  ];

  const inputStyle = { width: "100%", padding: "9px 12px", background: "#0A0C14", border: "1px solid #1E2130", borderRadius: 6, color: "#E8ECF4", fontSize: 12, fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box" };
  const labelStyle = { fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginBottom: 4, display: "block", textTransform: "uppercase" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 22 }}>📊</span>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontFamily: "'Space Grotesk', sans-serif" }}>Reports & Analytics</h2>
            <div style={{ fontSize: 11, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>Generate, schedule & manage ITSM reports</div>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 14 }}>
        {[
          { label: "Total Incidents", value: totalInc, color: "#6366F1", icon: "📋", link: "incidents" },
          { label: "Open Tickets", value: openInc, color: "#FF6B6B", icon: "🔴", link: "incidents" },
          { label: "Resolved", value: resolvedInc, color: "#4CAF50", icon: "✅", link: "incidents" },
          { label: "SLA Breaches", value: slaBreaches, color: "#FFB347", icon: "⚠️", link: "sla" },
          { label: "Avg Resolve (hrs)", value: avgResolveHrs, color: "#64B5F6", icon: "⏱️", link: "sla" },
        ].map((s, i) => (
          <div key={i} onClick={() => s.link && setActiveModule(s.link)} style={{ padding: "14px 16px", background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", borderTop: `2px solid ${s.color}`, cursor: s.link ? "pointer" : "default", transition: "transform 0.15s, border-color 0.2s" }}
            onMouseEnter={e => { if (s.link) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = s.color + "55"; } }}
            onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = "#1E2130"; }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 14 }}>{s.icon}</span>
              <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>{s.label}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: s.color, fontFamily: "'Space Grotesk', sans-serif" }}>{s.value}</div>
              {s.link && <span style={{ fontSize: 10, color: "#5A617866", fontFamily: "'JetBrains Mono', monospace" }}>→</span>}
            </div>
          </div>
        ))}
      </div>

      {/* ITSM Cross-Module Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Active Changes", value: changes.filter(c => !["Closed"].includes(c.status)).length, color: "#FFB347", icon: "🔄", link: "changes" },
          { label: "Service Requests", value: requests.filter(r => r.status !== "Fulfilled" && r.status !== "Closed").length, color: "#81C784", icon: "📝", link: "requests" },
          { label: "Open Problems", value: problems.filter(p => !["Resolved","Closed"].includes(p.status)).length, color: "#CE93D8", icon: "🔍", link: "problems" },
          { label: "CMDB Assets", value: assets.length, color: "#06B6D4", icon: "💻", link: "assets" },
          { label: "ZD-Linked", value: incidents.filter(i => i.zdTicketId).length, color: "#EC4899", icon: "🎫", link: "zendesk" },
        ].map((s, i) => (
          <div key={i} onClick={() => s.link && setActiveModule(s.link)} style={{ padding: "12px 14px", background: "#0F1117", borderRadius: 8, border: `1px solid ${s.color}22`, cursor: "pointer", transition: "transform 0.15s" }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 12 }}>{s.icon}</span>
              <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>{s.label}</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color, fontFamily: "'Space Grotesk', sans-serif" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#0A0C14", borderRadius: 8, padding: 4, border: "1px solid #1E2130" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setReportTab(t.id)} style={{
            flex: 1, padding: "10px 16px", borderRadius: 6, border: "none", cursor: "pointer",
            background: reportTab === t.id ? "#6366F118" : "transparent",
            color: reportTab === t.id ? "#E8ECF4" : "#5A6178",
            fontSize: 12, fontWeight: reportTab === t.id ? 600 : 400,
            fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            borderBottom: reportTab === t.id ? "2px solid #6366F1" : "2px solid transparent"
          }}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* Generate Tab */}
      {reportTab === "generate" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20 }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>Report Configuration</h3>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Report Type</label>
              <select value={reportType} onChange={e => setReportType(e.target.value)} style={inputStyle}>
                {reportTypes.map(r => <option key={r.id} value={r.id}>{r.icon} {r.label}</option>)}
              </select>
            </div>
            <div style={{ padding: "10px 12px", background: "#6366F108", borderRadius: 6, border: "1px solid #6366F122", marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#A0AEC0", lineHeight: 1.5 }}>{reportTypes.find(r => r.id === reportType)?.desc}</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Customer / Business Unit</label>
              <select value={reportCustomer} onChange={e => setReportCustomer(e.target.value)} style={inputStyle}>
                {customers_list.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Date From</label>
                <input type="date" value={reportDateFrom} onChange={e => setReportDateFrom(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Date To</label>
                <input type="date" value={reportDateTo} onChange={e => setReportDateTo(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Output Format</label>
              <div style={{ display: "flex", gap: 8 }}>
                {["PDF", "XLSX", "CSV", "JSON"].map(f => (
                  <button key={f} onClick={() => setReportFormat(f)} style={{
                    padding: "7px 16px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600,
                    fontFamily: "'JetBrains Mono', monospace",
                    background: reportFormat === f ? "#6366F118" : "#0A0C14",
                    border: `1px solid ${reportFormat === f ? "#6366F166" : "#1E2130"}`,
                    color: reportFormat === f ? "#6366F1" : "#5A6178"
                  }}>{f}</button>
                ))}
              </div>
            </div>
            <button onClick={handleGenerate} disabled={generating} style={{
              width: "100%", padding: "12px 20px", borderRadius: 8, border: "none",
              background: generating ? "#1E2130" : "linear-gradient(135deg, #6366F1, #06B6D4)",
              color: "#fff", cursor: generating ? "default" : "pointer", fontSize: 13, fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8
            }}>
              {generating ? <><span style={{ animation: "iconSpin 1s linear infinite", display: "inline-block" }}>⏳</span> Generating...</> : <>📊 Generate Report</>}
            </button>
          </div>

          {/* Report Types Grid */}
          <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20 }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>Available Report Types</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {reportTypes.map(r => (
                <button key={r.id} onClick={() => setReportType(r.id)} style={{
                  padding: "12px", borderRadius: 8, cursor: "pointer", textAlign: "left",
                  background: reportType === r.id ? "#6366F110" : "#0A0C14",
                  border: `1px solid ${reportType === r.id ? "#6366F144" : "#1E213044"}`,
                  display: "flex", alignItems: "center", gap: 10
                }}>
                  <span style={{ fontSize: 18 }}>{r.icon}</span>
                  <div>
                    <div style={{ fontSize: 11, color: reportType === r.id ? "#E8ECF4" : "#C4CAD6", fontWeight: 500 }}>{r.label}</div>
                    <div style={{ fontSize: 9, color: "#5A6178", marginTop: 2, lineHeight: 1.3 }}>{r.desc.substring(0, 60)}...</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* History Tab */}
      {reportTab === "history" && (
        <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>Generated Reports</h3>
            <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{generatedReports.length} reports</span>
          </div>
          <div style={{ borderRadius: 6, overflow: "hidden", border: "1px solid #1E213044" }}>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto auto auto auto", gap: 0 }}>
              <div style={{ display: "contents" }}>
                {["ID", "Report Name", "Type", "Format", "Size", "Generated By", "Actions"].map(h => (
                  <div key={h} style={{ padding: "10px 14px", background: "#0A0C14", fontSize: 10, color: "#5A6178", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", borderBottom: "1px solid #1E2130" }}>{h}</div>
                ))}
              </div>
              {generatedReports.map(r => (
                <div key={r.id} style={{ display: "contents" }}>
                  <div style={{ padding: "12px 14px", fontSize: 11, color: "#6366F1", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid #1E213033" }}>{r.id}</div>
                  <div style={{ padding: "12px 14px", borderBottom: "1px solid #1E213033" }}>
                    <div style={{ fontSize: 12, color: "#E8ECF4", fontWeight: 500 }}>{r.name}</div>
                    <div style={{ fontSize: 9, color: "#5A6178", marginTop: 2 }}>{r.created}</div>
                  </div>
                  <div style={{ padding: "12px 14px", fontSize: 10, color: "#A0AEC0", borderBottom: "1px solid #1E213033" }}>{r.type}</div>
                  <div style={{ padding: "12px 14px", borderBottom: "1px solid #1E213033" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 4, background: r.format === "PDF" ? "#FF6B6B18" : r.format === "XLSX" ? "#4CAF5018" : "#64B5F618", color: r.format === "PDF" ? "#FF6B6B" : r.format === "XLSX" ? "#4CAF50" : "#64B5F6", fontSize: 9, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{r.format}</span>
                  </div>
                  <div style={{ padding: "12px 14px", fontSize: 10, color: "#5A6178", borderBottom: "1px solid #1E213033" }}>{r.size}</div>
                  <div style={{ padding: "12px 14px", fontSize: 10, color: "#A0AEC0", borderBottom: "1px solid #1E213033" }}>{r.generatedBy}</div>
                  <div style={{ padding: "12px 14px", borderBottom: "1px solid #1E213033", display: "flex", gap: 6, alignItems: "center" }}>
                    <button style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #6366F133", background: "#6366F118", color: "#6366F1", cursor: "pointer", fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>⬇ Download</button>
                    <button style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #1E2130", background: "#0A0C14", color: "#5A6178", cursor: "pointer", fontSize: 9 }}>📧 Email</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Schedule Tab */}
      {reportTab === "schedule" && (
        <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>Scheduled Reports</h3>
            <button style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #6366F133", background: "#6366F118", color: "#6366F1", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>+ New Schedule</button>
          </div>
          {schedules.map(s => (
            <div key={s.id} style={{ padding: "16px 18px", marginBottom: 10, background: "#0A0C14", borderRadius: 8, border: "1px solid #1E213044", display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: s.enabled ? "#4CAF50" : "#5A6178", boxShadow: s.enabled ? "0 0 8px #4CAF5066" : "none", animation: s.enabled ? "pulse 2s infinite" : "none", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "#E8ECF4", fontWeight: 500, marginBottom: 4 }}>{s.name}</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, color: "#6366F1", fontFamily: "'JetBrains Mono', monospace" }}>🕐 {s.frequency} at {s.time}</span>
                  <span style={{ fontSize: 10, color: "#5A6178" }}>📧 {s.recipients}</span>
                  <span style={{ fontSize: 10, color: "#5A6178" }}>📄 {s.format}</span>
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>Last: {s.lastRun}</div>
                <div style={{ fontSize: 9, color: "#4CAF50", fontFamily: "'JetBrains Mono', monospace" }}>Next: {s.nextRun}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button style={{ padding: "5px 10px", borderRadius: 4, border: "1px solid #1E2130", background: "#0F1117", color: "#5A6178", cursor: "pointer", fontSize: 10 }}>✏️</button>
                <button style={{ padding: "5px 10px", borderRadius: 4, border: `1px solid ${s.enabled ? "#4CAF5033" : "#FF6B6B33"}`, background: s.enabled ? "#4CAF5010" : "#FF6B6B10", color: s.enabled ? "#4CAF50" : "#FF6B6B", cursor: "pointer", fontSize: 10 }}>{s.enabled ? "Active" : "Paused"}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Templates Tab */}
      {reportTab === "templates" && (
        <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>Report Templates</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {[
              { name: "Executive Dashboard", desc: "High-level KPIs with donut charts, trend lines, and AI insights for C-level stakeholders", icon: "📊", sections: ["KPI Summary", "Trend Analysis", "SLA Overview", "Cost Analysis", "AI Recommendations"] },
              { name: "Service Desk Daily", desc: "Detailed daily breakdown of all ticket activity with shift handover notes", icon: "📋", sections: ["New Tickets", "Resolved Tickets", "Pending Queue", "SLA Status", "Shift Handover"] },
              { name: "Customer SLA Report", desc: "Per-customer SLA performance with breach analysis and improvement plan", icon: "🏢", sections: ["SLA Metrics", "Breach Analysis", "Response Times", "Customer Satisfaction", "Action Items"] },
              { name: "Change Advisory Board", desc: "Change request summary for CAB review with risk assessment matrix", icon: "🔄", sections: ["Pending Changes", "Risk Matrix", "Impact Analysis", "Schedule", "Rollback Plans"] },
              { name: "Security Incident Report", desc: "Security event analysis with MITRE ATT&CK mapping and remediation status", icon: "🛡️", sections: ["Incident Timeline", "Attack Vectors", "Affected Assets", "Remediation", "Lessons Learned"] },
              { name: "Capacity & Resource", desc: "Infrastructure utilization, staffing levels, and forecasting for next quarter", icon: "📐", sections: ["Resource Utilization", "Staff Workload", "Ticket Forecast", "Growth Projections", "Recommendations"] },
            ].map((t, i) => (
              <div key={i} style={{ padding: "18px", background: "#0A0C14", borderRadius: 8, border: "1px solid #1E213044", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 22 }}>{t.icon}</span>
                  <div style={{ fontSize: 13, color: "#E8ECF4", fontWeight: 600 }}>{t.name}</div>
                </div>
                <div style={{ fontSize: 11, color: "#A0AEC0", lineHeight: 1.5 }}>{t.desc}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                  {t.sections.map((s, j) => (
                    <span key={j} style={{ padding: "2px 8px", borderRadius: 4, background: "#1E213044", fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{s}</span>
                  ))}
                </div>
                <button onClick={() => { setReportType(i === 0 ? "monthly" : i === 1 ? "daily" : i === 2 ? "customer" : i === 3 ? "change" : i === 4 ? "security" : "capacity"); setReportTab("generate"); }} style={{
                  marginTop: "auto", padding: "8px 14px", borderRadius: 6, border: "1px solid #6366F133",
                  background: "#6366F110", color: "#6366F1", cursor: "pointer", fontSize: 10, fontWeight: 600
                }}>Use Template</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Service Reports Tab */}
      {reportTab === "servicereports" && (() => {
        const perms = RBAC_PERMISSIONS[currentUser?.rbacRole] || {};
        const canEditSR = ["full","manage","edit"].includes(perms.reports);

        const filteredSR = serviceReports.filter(r => {
          const cust = customers.find(c => c.id === r.customerId);
          const matchSearch = !srSearch || (r.title || "").toLowerCase().includes(srSearch.toLowerCase()) || (cust && (cust.name || "").toLowerCase().includes(srSearch.toLowerCase()));
          const matchStatus = srStatusFilter === "All" || r.status === srStatusFilter;
          return matchSearch && matchStatus;
        });

        const resetReportForm2 = () => setReportForm({ customerId: "", title: "", reportDate: new Date().toISOString().slice(0,10), periodFrom: "", periodTo: "", engineer: currentUser?.name || "", summary: "", incidents: [], status: "Draft", supportHours: 0, sessionLog: [] });
        const openAddReport2 = () => { resetReportForm2(); setEditingReportId(null); setShowAddReport(true); };
        const openEditReport2 = (rpt) => {
          setReportForm({ customerId: rpt.customerId, title: rpt.title, reportDate: rpt.reportDate, periodFrom: rpt.periodFrom, periodTo: rpt.periodTo, engineer: rpt.engineer, summary: rpt.summary, incidents: rpt.incidents || [], status: rpt.status, supportHours: rpt.supportHours || 0, sessionLog: rpt.sessionLog || [] });
          setEditingReportId(rpt.id); setShowAddReport(true);
        };
        const handleSaveReport2 = () => {
          if (!reportForm.customerId || !reportForm.title) return;
          if (editingReportId) {
            setServiceReports(prev => prev.map(r => r.id === editingReportId ? { ...r, ...reportForm } : r));
          } else {
            const newId = "SR" + String(serviceReports.length + 1).padStart(3, "0");
            setServiceReports(prev => [...prev, { id: newId, ...reportForm, sentAt: "", createdBy: currentUser?.name || "System", createdAt: new Date().toISOString().slice(0, 10) }]);
          }
          setShowAddReport(false); resetReportForm2(); setEditingReportId(null);
        };
        const handleDeleteReport2 = (id) => { const item = serviceReports.find(r => r.id === id); if (item) softDelete("service_reports", item, setServiceReports, "vgc_service_reports"); };
        const markSent2 = (id) => { setServiceReports(prev => prev.map(r => r.id === id ? { ...r, status: "Sent", sentAt: new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore" }) } : r)); };

        // Support hours timer
        const startTimer = () => {
          setSessionTimerActive(true);
          setSessionElapsed(0);
          sessionTimerRef.current = setInterval(() => setSessionElapsed(prev => prev + 1), 1000);
        };
        const stopTimer = () => {
          setSessionTimerActive(false);
          if (sessionTimerRef.current) { clearInterval(sessionTimerRef.current); sessionTimerRef.current = null; }
          const hrs = parseFloat((sessionElapsed / 3600).toFixed(2));
          const logEntry = { start: new Date(Date.now() - sessionElapsed * 1000).toLocaleString("en-SG", { timeZone: "Asia/Singapore" }), end: new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore" }), duration: hrs, engineer: currentUser?.name || "System" };
          setReportForm(f => ({ ...f, supportHours: parseFloat(((f.supportHours || 0) + hrs).toFixed(2)), sessionLog: [...(f.sessionLog || []), logEntry] }));
          setSessionElapsed(0);
        };
        const fmtTime = (s) => { const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); const sec = s%60; return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`; };

        // Auto-populate customer info
        const selectedCust = reportForm.customerId ? customers.find(c => c.id === reportForm.customerId) : null;

        // PDF Export via print
        const exportPDF2 = (rpt) => {
          const cust = customers.find(c => c.id === rpt.customerId);
          const relatedIncidents = incidents.filter(i => (rpt.incidents || []).includes(i.id));
          const w = window.open("", "_blank", "width=800,height=900");
          w.document.write(`<!DOCTYPE html><html><head><title>Service Report - ${sanitizeHTML(rpt.id)}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
            body { font-family: 'Inter', Arial, sans-serif; margin: 0; padding: 30px; color: #1a1a2e; background: #fff; }
            .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; border-bottom: 3px solid #6366F1; padding-bottom: 20px; }
            .logo { font-size: 22px; font-weight: 700; color: #6366F1; }
            .logo-sub { font-size: 11px; color: #666; margin-top: 4px; }
            .report-title { font-size: 18px; font-weight: 700; color: #1a1a2e; margin-bottom: 6px; }
            .report-id { font-size: 12px; color: #6366F1; font-weight: 600; }
            .section { margin-bottom: 24px; }
            .section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #6366F1; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px; margin-bottom: 12px; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 30px; }
            .info-item { margin-bottom: 8px; }
            .info-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
            .info-value { font-size: 13px; color: #1a1a2e; font-weight: 500; }
            .summary-box { background: #f8f9ff; border: 1px solid #e0e2f0; border-radius: 8px; padding: 16px; font-size: 13px; line-height: 1.6; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { background: #6366F1; color: #fff; padding: 8px 12px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
            td { padding: 8px 12px; border-bottom: 1px solid #eee; }
            tr:nth-child(even) { background: #f8f9ff; }
            .footer { margin-top: 40px; border-top: 2px solid #e0e0e0; padding-top: 16px; font-size: 10px; color: #888; text-align: center; }
            .badge { display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 10px; font-weight: 600; }
            @media print { body { padding: 15px; } .no-print { display: none; } }
          </style></head><body>
          <div class="header">
            <div>
              <div class="logo">VGC Technology Pte Ltd</div>
              <div class="logo-sub">IT Service Management — Service Report</div>
            </div>
            <div style="text-align:right">
              <div class="report-id">${sanitizeHTML(rpt.id)}</div>
              <div style="font-size:11px;color:#666;margin-top:4px">${sanitizeHTML(rpt.reportDate)}</div>
            </div>
          </div>
          <div class="report-title">${sanitizeHTML(rpt.title)}</div>
          <div class="section">
            <div class="section-title">Customer Information</div>
            <div class="info-grid">
              <div class="info-item"><div class="info-label">Company</div><div class="info-value">${sanitizeHTML(cust?.name || "—")}</div></div>
              <div class="info-item"><div class="info-label">Category</div><div class="info-value">${sanitizeHTML(cust?.category || "—")}</div></div>
              <div class="info-item"><div class="info-label">Contact Person</div><div class="info-value">${sanitizeHTML(cust?.contactPerson || "—")}</div></div>
              <div class="info-item"><div class="info-label">Email</div><div class="info-value">${sanitizeHTML(cust?.email || "—")}</div></div>
              <div class="info-item"><div class="info-label">Phone</div><div class="info-value">${sanitizeHTML(cust?.phone || "—")}</div></div>
              <div class="info-item"><div class="info-label">Address</div><div class="info-value">${sanitizeHTML(cust?.address || "—")}</div></div>
            </div>
          </div>
          <div class="section">
            <div class="section-title">Report Details</div>
            <div class="info-grid">
              <div class="info-item"><div class="info-label">Reporting Period</div><div class="info-value">${sanitizeHTML(rpt.periodFrom)} — ${sanitizeHTML(rpt.periodTo)}</div></div>
              <div class="info-item"><div class="info-label">Prepared By</div><div class="info-value">${sanitizeHTML(rpt.engineer)}</div></div>
              <div class="info-item"><div class="info-label">Status</div><div class="info-value">${sanitizeHTML(rpt.status)}</div></div>
              <div class="info-item"><div class="info-label">Support Hours</div><div class="info-value">${rpt.supportHours || 0} hrs</div></div>
            </div>
          </div>
          <div class="section">
            <div class="section-title">Executive Summary</div>
            <div class="summary-box">${sanitizeHTML(rpt.summary)}</div>
          </div>
          ${(rpt.sessionLog || []).length > 0 ? `
          <div class="section">
            <div class="section-title">Remote Session Log (${rpt.sessionLog.length} sessions)</div>
            <table>
              <thead><tr><th>Start</th><th>End</th><th>Duration (hrs)</th><th>Engineer</th></tr></thead>
              <tbody>${rpt.sessionLog.map(s => `<tr><td>${sanitizeHTML(s.start)}</td><td>${sanitizeHTML(s.end)}</td><td>${s.duration}</td><td>${sanitizeHTML(s.engineer)}</td></tr>`).join("")}</tbody>
            </table>
          </div>` : ""}
          ${relatedIncidents.length > 0 ? `
          <div class="section">
            <div class="section-title">Related Incidents (${relatedIncidents.length})</div>
            <table>
              <thead><tr><th>ID</th><th>Title</th><th>Priority</th><th>Status</th><th>Assignee</th></tr></thead>
              <tbody>${relatedIncidents.map(inc => `<tr><td>${sanitizeHTML(inc.id)}</td><td>${sanitizeHTML(inc.title)}</td><td>${sanitizeHTML(inc.priority)}</td><td>${sanitizeHTML(inc.status)}</td><td>${sanitizeHTML(inc.assignee)}</td></tr>`).join("")}</tbody>
            </table>
          </div>` : ""}
          ${cust?.services?.length > 0 ? `
          <div class="section">
            <div class="section-title">Subscribed Services</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">${(cust.services || []).map(s => `<span class="badge" style="background:#6366F122;color:#6366F1;border:1px solid #6366F144">${sanitizeHTML(s)}</span>`).join("")}</div>
          </div>` : ""}
          <div class="footer">
            <p><strong>VGC Technology Pte Ltd</strong> — IT Service Management</p>
            <p>📧 help@vgctechnology.com | 📞 +65 6234 0000</p>
            <p>This report is confidential and intended solely for ${sanitizeHTML(cust?.name || "the recipient")}.</p>
          </div>
          <div class="no-print" style="text-align:center;margin-top:20px">
            <button onclick="window.print()" style="padding:10px 30px;background:#6366F1;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">🖨️ Print / Save as PDF</button>
          </div>
          </body></html>`);
          w.document.close();
        };

        // Email send
        const sendEmail2 = async (rpt) => {
          const cust = customers.find(c => c.id === rpt.customerId);
          if (!cust) return;
          try {
            const res = await fetch("/api/email/send", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ to: cust.email, subject: `Service Report: ${rpt.title}`, reportId: rpt.id, customerName: cust.name, smtpConfig })
            });
            if (res.ok) { markSent2(rpt.id); } else { markSent2(rpt.id); }
          } catch { markSent2(rpt.id); }
        };

        const viewReport = reportViewId ? serviceReports.find(r => r.id === reportViewId) : null;
        const viewCust = viewReport ? customers.find(c => c.id === viewReport.customerId) : null;

        // Total support hours across all reports
        const totalSupportHrs = serviceReports.reduce((sum, r) => sum + (r.supportHours || 0), 0);

        return (
          <div>
            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Total Reports", value: serviceReports.length, accent: "#6366F1", icon: "📋" },
                { label: "Drafts", value: serviceReports.filter(r => r.status === "Draft").length, accent: "#FFB347", icon: "✏️" },
                { label: "Sent", value: serviceReports.filter(r => r.status === "Sent").length, accent: "#81C784", icon: "✅" },
                { label: "Support Hours", value: totalSupportHrs.toFixed(1), accent: "#06B6D4", icon: "⏱️" },
              ].map((s, i) => (
                <div key={i} style={{ padding: "16px 18px", background: "#0F1117", borderRadius: 10, border: `1px solid ${s.accent}33` }}>
                  <div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>{s.icon} {s.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: s.accent }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Toolbar */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
              <SearchBar value={srSearch} onChange={setSrSearch} placeholder="Search reports..." />
              <select value={srStatusFilter} onChange={e => setSrStatusFilter(e.target.value)} style={{ ...inputStyle, width: 130 }}>
                <option value="All">All Status</option>
                <option value="Draft">Draft</option>
                <option value="Sent">Sent</option>
              </select>
              {canEditSR && <button onClick={openAddReport2} style={{ ...btnStyle("#6366F1"), fontSize: 12, padding: "8px 16px" }}>+ New Report</button>}
            </div>

            {/* Reports Table */}
            <div style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1E2130" }}>
                    {["ID","Title","Customer","Period","Engineer","Hours","Status","Actions"].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "#5A6178", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredSR.map(r => {
                    const cust = customers.find(c => c.id === r.customerId);
                    return (
                      <tr key={r.id} style={{ borderBottom: "1px solid #1E213066" }}>
                        <td style={{ padding: "10px 12px", color: "#6366F1", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{r.id}</td>
                        <td style={{ padding: "10px 12px", color: "#E8ECF4", fontWeight: 600, cursor: "pointer" }} onClick={() => setReportViewId(r.id)}>{sanitizeHTML(r.title)}</td>
                        <td style={{ padding: "10px 12px", color: "#C4CAD6" }}>{sanitizeHTML(cust?.name || "—")}</td>
                        <td style={{ padding: "10px 12px", color: "#8B8FA3", fontSize: 11 }}>{r.periodFrom} — {r.periodTo}</td>
                        <td style={{ padding: "10px 12px", color: "#8B8FA3" }}>{sanitizeHTML(r.engineer)}</td>
                        <td style={{ padding: "10px 12px", color: "#06B6D4", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{(r.supportHours || 0).toFixed(1)}h</td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ padding: "3px 10px", borderRadius: 12, fontSize: 10, fontWeight: 600, background: r.status === "Sent" ? "#81C78422" : "#FFB34722", color: r.status === "Sent" ? "#81C784" : "#FFB347" }}>{r.status}</span>
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => setReportViewId(r.id)} style={{ padding: "3px 8px", borderRadius: 4, background: "#06B6D411", border: "1px solid #06B6D433", color: "#06B6D4", fontSize: 10, cursor: "pointer" }}>👁️</button>
                            <button onClick={() => exportPDF2(r)} style={{ padding: "3px 8px", borderRadius: 4, background: "#6366F111", border: "1px solid #6366F133", color: "#6366F1", fontSize: 10, cursor: "pointer" }}>📄 PDF</button>
                            {r.status !== "Sent" && canEditSR && <button onClick={() => sendEmail2(r)} style={{ padding: "3px 8px", borderRadius: 4, background: "#81C78411", border: "1px solid #81C78433", color: "#81C784", fontSize: 10, cursor: "pointer" }}>📧 Send</button>}
                            {canEditSR && <button onClick={() => openEditReport2(r)} style={{ padding: "3px 8px", borderRadius: 4, background: "#FFB34711", border: "1px solid #FFB34733", color: "#FFB347", fontSize: 10, cursor: "pointer" }}>✏️</button>}
                            {canEditSR && <button onClick={() => handleDeleteReport2(r.id)} style={{ padding: "3px 8px", borderRadius: 4, background: "#FF6B6B11", border: "1px solid #FF6B6B33", color: "#FF6B6B", fontSize: 10, cursor: "pointer" }}>🗑️</button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredSR.length === 0 && <tr><td colSpan={8} style={{ padding: 30, textAlign: "center", color: "#5A6178" }}>No service reports found</td></tr>}
                </tbody>
              </table>
            </div>

            {/* Report Detail View Modal */}
            {viewReport && viewCust && (
              <Modal title={`Service Report — ${viewReport.id}`} onClose={() => setReportViewId(null)} width={700}>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#E8ECF4", marginBottom: 4 }}>{sanitizeHTML(viewReport.title)}</div>
                  <div style={{ fontSize: 11, color: "#5A6178" }}>{viewReport.reportDate} | Prepared by {sanitizeHTML(viewReport.engineer)}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
                  <div style={{ background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #1E2130" }}>
                    <div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>Customer</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#E8ECF4", marginBottom: 4 }}>{sanitizeHTML(viewCust.name)}</div>
                    <div style={{ fontSize: 11, color: "#8B8FA3" }}>👤 {sanitizeHTML(viewCust.contactPerson)}</div>
                    <div style={{ fontSize: 11, color: "#8B8FA3" }}>📧 {sanitizeHTML(viewCust.email)}</div>
                    <div style={{ fontSize: 11, color: "#8B8FA3" }}>📞 {sanitizeHTML(viewCust.phone)}</div>
                    <div style={{ fontSize: 11, color: "#8B8FA3" }}>📍 {sanitizeHTML(viewCust.address)}</div>
                    <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 9, fontWeight: 600, background: viewCust.category === "CSP" ? "#06B6D422" : "#FFB34722", color: viewCust.category === "CSP" ? "#06B6D4" : "#FFB347", marginTop: 6, display: "inline-block" }}>{viewCust.category}</span>
                  </div>
                  <div style={{ background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #1E2130" }}>
                    <div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>Report Info</div>
                    <div style={{ fontSize: 11, color: "#C4CAD6", marginBottom: 4 }}>📅 Period: {viewReport.periodFrom} → {viewReport.periodTo}</div>
                    <div style={{ fontSize: 11, color: "#C4CAD6", marginBottom: 4 }}>🔖 Status: <span style={{ color: viewReport.status === "Sent" ? "#81C784" : "#FFB347", fontWeight: 600 }}>{viewReport.status}</span></div>
                    <div style={{ fontSize: 11, color: "#06B6D4", marginBottom: 4 }}>⏱️ Support Hours: <span style={{ fontWeight: 700 }}>{(viewReport.supportHours || 0).toFixed(1)} hrs</span></div>
                    {viewReport.sentAt && <div style={{ fontSize: 11, color: "#81C784" }}>✅ Sent: {viewReport.sentAt}</div>}
                  </div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>Executive Summary</div>
                  <div style={{ background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #1E2130", fontSize: 12, color: "#C4CAD6", lineHeight: 1.6 }}>{sanitizeHTML(viewReport.summary)}</div>
                </div>
                {(viewReport.sessionLog || []).length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>Remote Session Log ({viewReport.sessionLog.length} sessions)</div>
                    {viewReport.sessionLog.map((ses, idx) => (
                      <div key={idx} style={{ display: "flex", justifyContent: "space-between", background: "#0A0C14", borderRadius: 6, padding: "8px 12px", border: "1px solid #1E2130", marginBottom: 6 }}>
                        <span style={{ color: "#06B6D4", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{ses.start} → {ses.end}</span>
                        <span style={{ color: "#FFB347", fontSize: 11, fontWeight: 600 }}>{ses.duration}h</span>
                        <span style={{ color: "#8B8FA3", fontSize: 11 }}>{sanitizeHTML(ses.engineer)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {(viewReport.incidents || []).length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>Related Incidents</div>
                    {incidents.filter(i => viewReport.incidents.includes(i.id)).map(inc => (
                      <div key={inc.id} style={{ display: "flex", justifyContent: "space-between", background: "#0A0C14", borderRadius: 6, padding: "8px 12px", border: "1px solid #1E2130", marginBottom: 6 }}>
                        <span style={{ color: "#6366F1", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{inc.id}</span>
                        <span style={{ color: "#E8ECF4", fontSize: 11, flex: 1, marginLeft: 12 }}>{sanitizeHTML(inc.title)}</span>
                        <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 9, fontWeight: 600, background: inc.status === "Resolved" ? "#81C78422" : "#FFB34722", color: inc.status === "Resolved" ? "#81C784" : "#FFB347" }}>{inc.status}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button onClick={() => exportPDF2(viewReport)} style={btnStyle("#6366F1")}>📄 Export PDF</button>
                  {viewReport.status !== "Sent" && <button onClick={() => { sendEmail2(viewReport); setReportViewId(null); }} style={btnStyle("#81C784")}>📧 Send to Customer</button>}
                </div>
              </Modal>
            )}

            {/* Add/Edit Report Modal */}
            {showAddReport && (
              <Modal title={editingReportId ? "Edit Service Report" : "New Service Report"} onClose={() => { setShowAddReport(false); resetReportForm2(); setEditingReportId(null); if (sessionTimerRef.current) { clearInterval(sessionTimerRef.current); sessionTimerRef.current = null; } setSessionTimerActive(false); setSessionElapsed(0); }} width={650}>
                <FormField label="Customer *">
                  <select value={reportForm.customerId} onChange={e => setReportForm(f => ({ ...f, customerId: e.target.value }))} style={inputStyle}>
                    <option value="">Select Customer...</option>
                    {customers.filter(c => c.status === "Active").map(c => <option key={c.id} value={c.id}>{c.name} ({c.category})</option>)}
                  </select>
                </FormField>
                {/* Auto-populated End User Info */}
                {selectedCust && (
                  <div style={{ background: "#06B6D408", border: "1px solid #06B6D422", borderRadius: 8, padding: 14, marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: "#06B6D4", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8, fontWeight: 600 }}>📋 End User Information (Auto-populated)</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div><div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase" }}>Company</div><div style={{ fontSize: 12, color: "#E8ECF4", fontWeight: 500 }}>{sanitizeHTML(selectedCust.name)}</div></div>
                      <div><div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase" }}>Person In Charge</div><div style={{ fontSize: 12, color: "#E8ECF4", fontWeight: 500 }}>{sanitizeHTML(selectedCust.contactPerson)}</div></div>
                      <div><div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase" }}>Contact Number</div><div style={{ fontSize: 12, color: "#E8ECF4", fontWeight: 500 }}>{sanitizeHTML(selectedCust.phone)}</div></div>
                      <div><div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase" }}>Email</div><div style={{ fontSize: 12, color: "#E8ECF4", fontWeight: 500 }}>{sanitizeHTML(selectedCust.email)}</div></div>
                      <div style={{ gridColumn: "1 / -1" }}><div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase" }}>Address</div><div style={{ fontSize: 12, color: "#E8ECF4", fontWeight: 500 }}>{sanitizeHTML(selectedCust.address)}</div></div>
                    </div>
                  </div>
                )}
                <FormField label="Report Title *">
                  <input value={reportForm.title} onChange={e => setReportForm(f => ({ ...f, title: e.target.value }))} style={inputStyle} placeholder="Service report title" />
                </FormField>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 16px" }}>
                  <FormField label="Report Date">
                    <input type="date" value={reportForm.reportDate} onChange={e => setReportForm(f => ({ ...f, reportDate: e.target.value }))} style={inputStyle} />
                  </FormField>
                  <FormField label="Period From">
                    <input type="date" value={reportForm.periodFrom} onChange={e => setReportForm(f => ({ ...f, periodFrom: e.target.value }))} style={inputStyle} />
                  </FormField>
                  <FormField label="Period To">
                    <input type="date" value={reportForm.periodTo} onChange={e => setReportForm(f => ({ ...f, periodTo: e.target.value }))} style={inputStyle} />
                  </FormField>
                </div>
                <FormField label="Engineer">
                  <input value={reportForm.engineer} onChange={e => setReportForm(f => ({ ...f, engineer: e.target.value }))} style={inputStyle} />
                </FormField>
                {/* Support Hours Timer */}
                <div style={{ background: "#0A0C14", border: "1px solid #1E2130", borderRadius: 8, padding: 14, marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: "#06B6D4", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>⏱️ Remote Session Timer</div>
                    <div style={{ fontSize: 11, color: "#8B8FA3" }}>Total: <span style={{ color: "#06B6D4", fontWeight: 700 }}>{(reportForm.supportHours || 0).toFixed(2)} hrs</span></div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: sessionTimerActive ? "#FF6B6B" : "#E8ECF4", minWidth: 120 }}>
                      {fmtTime(sessionElapsed)}
                      {sessionTimerActive && <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#FF6B6B", marginLeft: 8, animation: "pulse 1s infinite" }} />}
                    </div>
                    {!sessionTimerActive ? (
                      <button onClick={startTimer} style={{ ...btnStyle("#06B6D4"), fontSize: 11, padding: "8px 16px" }}>▶ Start Session</button>
                    ) : (
                      <button onClick={stopTimer} style={{ ...btnStyle("#FF6B6B"), fontSize: 11, padding: "8px 16px" }}>⏹ Stop & Record</button>
                    )}
                  </div>
                  {(reportForm.sessionLog || []).length > 0 && (
                    <div style={{ marginTop: 10, borderTop: "1px solid #1E2130", paddingTop: 8 }}>
                      <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase", marginBottom: 6 }}>Session Log</div>
                      {reportForm.sessionLog.map((ses, idx) => (
                        <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#8B8FA3", padding: "3px 0" }}>
                          <span>{ses.start} → {ses.end}</span>
                          <span style={{ color: "#06B6D4", fontWeight: 600 }}>{ses.duration}h</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <FormField label="Executive Summary">
                  <textarea value={reportForm.summary} onChange={e => setReportForm(f => ({ ...f, summary: e.target.value }))} rows={5} style={{ ...inputStyle, resize: "vertical" }} placeholder="Summary of services provided, incidents resolved, and overall status..." />
                </FormField>
                <FormField label="Related Incident IDs">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {(reportForm.incidents || []).map((inc, i) => (
                      <span key={i} style={{ padding: "3px 10px", borderRadius: 12, fontSize: 11, background: "#FF6B6B22", color: "#FF6B6B", border: "1px solid #FF6B6B33", display: "flex", alignItems: "center", gap: 4 }}>
                        {inc} <button onClick={() => setReportForm(f => ({ ...f, incidents: f.incidents.filter((_, j) => j !== i) }))} style={{ background: "none", border: "none", color: "#FF6B6B", cursor: "pointer", fontSize: 11, padding: 0 }}>✕</button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={srSvcInput} onChange={e => setSrSvcInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && srSvcInput.trim()) { setReportForm(f => ({ ...f, incidents: [...f.incidents, srSvcInput.trim()] })); setSrSvcInput(""); } }} style={{ ...inputStyle, flex: 1 }} placeholder="Type incident ID (e.g. INC1234) and press Enter" />
                    <button onClick={() => { if (srSvcInput.trim()) { setReportForm(f => ({ ...f, incidents: [...f.incidents, srSvcInput.trim()] })); setSrSvcInput(""); } }} style={{ ...btnStyle("#333"), fontSize: 11, padding: "8px 12px" }}>Add</button>
                  </div>
                </FormField>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                  <button onClick={() => { setShowAddReport(false); resetReportForm2(); setEditingReportId(null); if (sessionTimerRef.current) { clearInterval(sessionTimerRef.current); sessionTimerRef.current = null; } setSessionTimerActive(false); setSessionElapsed(0); }} style={{ ...btnStyle("#333"), color: "#8B8FA3" }}>Cancel</button>
                  <button onClick={handleSaveReport2} style={btnStyle("#6366F1")}>{editingReportId ? "Save Changes" : "Create Report"}</button>
                </div>
              </Modal>
            )}
          </div>
        );
      })()}

      {/* Zendesk Analytics Tab */}
      {reportTab === "zendesk" && (() => {
        const loadZdAnalytics = () => {
          // (#4 follow-up, 2026-05-03) demo-mode guard removed; isLocalDemoUser was always false.
          setZdLoading(true);
          Promise.all([
            fetch("/api/zendesk/stats").then(r => r.json()).catch(() => null),
            fetch("/api/zendesk/satisfaction_ratings").then(r => r.json()).catch(() => ({ satisfaction_ratings: [] })),
            fetch("/api/zendesk/organizations").then(r => r.json()).catch(() => ({ organizations: [] })),
          ]).then(([stats, csat, orgs]) => {
            setZdAnalytics({ stats, orgs: orgs.organizations || [] });
            setZdCsat(csat.satisfaction_ratings || []);
            setZdLoading(false);
          });
        };

        const csatAvg = zdCsat && zdCsat.length > 0 ? (zdCsat.filter(r => r.score === "good").length / zdCsat.length * 100).toFixed(1) : null;

        return (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, color: "#E8ECF4" }}>Zendesk Live Analytics</h3>
                <span style={{ fontSize: 11, color: "#5A6178" }}>Real-time data from Zendesk for reporting & offboarding readiness</span>
              </div>
              <button onClick={loadZdAnalytics} style={{ ...btnStyle("#EC4899"), display: "flex", alignItems: "center", gap: 6 }} disabled={zdLoading}>
                {zdLoading ? "Loading..." : "🔄 Fetch Zendesk Data"}
              </button>
            </div>

            {!zdAnalytics && !zdLoading && (
              <div style={{ padding: 40, textAlign: "center", color: "#5A6178", background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130" }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🎫</div>
                <div style={{ fontSize: 14, marginBottom: 4 }}>Click "Fetch Zendesk Data" to load live analytics</div>
                <div style={{ fontSize: 11, color: "#5A617888" }}>Includes ticket stats, CSAT scores, and organization data</div>
              </div>
            )}

            {zdAnalytics && (
              <>
                {/* Zendesk Ticket Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
                  {[
                    { label: "New Tickets", value: zdAnalytics.stats?.new || 0, color: "#64B5F6", icon: "🆕" },
                    { label: "Open", value: zdAnalytics.stats?.open || 0, color: "#FFB347", icon: "📂" },
                    { label: "Pending", value: zdAnalytics.stats?.pending || 0, color: "#CE93D8", icon: "⏳" },
                    { label: "On Hold", value: zdAnalytics.stats?.hold || 0, color: "#FF6B6B", icon: "⏸" },
                    { label: "Solved", value: zdAnalytics.stats?.solved || 0, color: "#81C784", icon: "✅" },
                    { label: "CSAT Score", value: csatAvg ? `${csatAvg}%` : "N/A", color: csatAvg && parseFloat(csatAvg) > 80 ? "#81C784" : "#FFB347", icon: "⭐" },
                  ].map((s, i) => (
                    <div key={i} style={{ padding: "14px 16px", background: "#0F1117", borderRadius: 8, border: `1px solid ${s.color}33` }}>
                      <div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", marginBottom: 4 }}>{s.icon} {s.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* CSAT Breakdown */}
                {zdCsat && zdCsat.length > 0 && (
                  <div style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", padding: 20, marginBottom: 20 }}>
                    <h4 style={{ margin: "0 0 12px", fontSize: 14, color: "#E8ECF4" }}>Customer Satisfaction Ratings</h4>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
                      <div style={{ padding: 12, background: "#81C78411", borderRadius: 8, border: "1px solid #81C78433", textAlign: "center" }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: "#81C784" }}>{zdCsat.filter(r => r.score === "good").length}</div>
                        <div style={{ fontSize: 10, color: "#81C784" }}>Good</div>
                      </div>
                      <div style={{ padding: 12, background: "#FF6B6B11", borderRadius: 8, border: "1px solid #FF6B6B33", textAlign: "center" }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: "#FF6B6B" }}>{zdCsat.filter(r => r.score === "bad").length}</div>
                        <div style={{ fontSize: 10, color: "#FF6B6B" }}>Bad</div>
                      </div>
                      <div style={{ padding: 12, background: "#6366F111", borderRadius: 8, border: "1px solid #6366F133", textAlign: "center" }}>
                        <div style={{ fontSize: 24, fontWeight: 700, color: "#6366F1" }}>{zdCsat.length}</div>
                        <div style={{ fontSize: 10, color: "#6366F1" }}>Total</div>
                      </div>
                    </div>
                    <div style={{ maxHeight: 200, overflow: "auto" }}>
                      {zdCsat.slice(0, 20).map((r, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #1E213044", fontSize: 11 }}>
                          <span style={{ color: "#C4CAD6" }}>Ticket #{r.ticket_id}</span>
                          <span style={{ color: r.score === "good" ? "#81C784" : "#FF6B6B", fontWeight: 600 }}>{r.score === "good" ? "👍 Good" : "👎 Bad"}</span>
                          <span style={{ color: "#5A6178", fontSize: 10 }}>{new Date(r.created_at).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Zendesk Organizations */}
                {zdAnalytics.orgs && zdAnalytics.orgs.length > 0 && (
                  <div style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", padding: 20, marginBottom: 20 }}>
                    <h4 style={{ margin: "0 0 12px", fontSize: 14, color: "#E8ECF4" }}>Zendesk Organizations ({zdAnalytics.orgs.length})</h4>
                    <div style={{ maxHeight: 300, overflow: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                        <thead><tr style={{ borderBottom: "1px solid #1E2130" }}>
                          {["Name", "Domains", "Tags", "Created"].map(h => (
                            <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#5A6178", fontWeight: 600, fontSize: 10, textTransform: "uppercase" }}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {zdAnalytics.orgs.map((org, i) => (
                            <tr key={i} style={{ borderBottom: "1px solid #1E213044" }}>
                              <td style={{ padding: "8px 10px", color: "#E8ECF4", fontWeight: 600 }}>{org.name}</td>
                              <td style={{ padding: "8px 10px", color: "#64B5F6", fontSize: 10 }}>{(org.domain_names || []).join(", ") || "—"}</td>
                              <td style={{ padding: "8px 10px" }}>
                                {(org.tags || []).map((t, j) => <span key={j} style={{ marginRight: 4, padding: "1px 6px", borderRadius: 8, fontSize: 9, background: "#6366F122", color: "#6366F1" }}>{t}</span>)}
                              </td>
                              <td style={{ padding: "8px 10px", color: "#5A6178", fontSize: 10 }}>{org.created_at ? new Date(org.created_at).toLocaleDateString() : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Offboarding Readiness */}
                <div style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #FFB34733", padding: 20 }}>
                  <h4 style={{ margin: "0 0 12px", fontSize: 14, color: "#FFB347" }}>⚠️ Zendesk Offboarding Readiness</h4>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {[
                      { label: "ITSM Incidents (local)", value: incidents.length, status: incidents.length > 0, desc: "Incidents created in ITSM" },
                      { label: "ZD-Linked Incidents", value: incidents.filter(i => i.zdTicketId).length, status: true, desc: "Incidents linked to Zendesk tickets" },
                      { label: "Customers Synced", value: customers.filter(c => c.zdOrgId).length, status: customers.filter(c => c.zdOrgId).length > 0, desc: "Customers with Zendesk org link" },
                      { label: "ZD Organizations", value: zdAnalytics.orgs.length, status: zdAnalytics.orgs.length <= customers.length, desc: "All orgs accounted for in ITSM" },
                    ].map((item, i) => (
                      <div key={i} style={{ padding: 12, background: item.status ? "#81C78408" : "#FF6B6B08", borderRadius: 8, border: `1px solid ${item.status ? "#81C78433" : "#FF6B6B33"}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <span style={{ fontSize: 11, color: "#C4CAD6", fontWeight: 600 }}>{item.label}</span>
                          <span style={{ fontSize: 16, fontWeight: 700, color: item.status ? "#81C784" : "#FF6B6B" }}>{item.value}</span>
                        </div>
                        <div style={{ fontSize: 10, color: "#5A6178" }}>{item.desc}</div>
                        <div style={{ fontSize: 9, color: item.status ? "#81C784" : "#FF6B6B", marginTop: 4 }}>{item.status ? "✅ Ready" : "⚠️ Action needed"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* CSAT Dashboard Tab (Phase 7) */}
      {reportTab === "csat" && (() => {
        if (!csatScores) fetchCsatScores();
        return (
          <div>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 22 }}>⭐</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>CSAT Survey Dashboard</h3>
                  <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>Customer satisfaction scores, trends & AI analysis</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {["overview", "agents", "categories", "comments", "submit"].map(v => (
                  <button key={v} onClick={() => setCsatView(v)} style={{ ...btnStyle(csatView === v ? "#6366F1" : undefined), fontSize: 10, padding: "5px 10px", opacity: csatView === v ? 1 : 0.6 }}>{v === "overview" ? "📊 Overview" : v === "agents" ? "👥 Agents" : v === "categories" ? "📁 Categories" : v === "comments" ? "💬 Comments" : "📝 Submit"}</button>
                ))}
                <button onClick={fetchCsatScores} style={{ ...btnStyle("#06B6D4"), fontSize: 10, padding: "5px 10px" }}>{csatLoading ? "⏳" : "🔄"}</button>
                <button onClick={runCsatAiAnalysis} style={{ ...btnStyle("#EC4899"), fontSize: 10, padding: "5px 10px" }}>{csatAiLoading ? "⏳ Analyzing..." : "🤖 AI Analysis"}</button>
              </div>
            </div>

            {csatLoading ? (
              <div style={{ textAlign: "center", padding: 40, color: "#5A6178" }}>⏳ Loading CSAT data...</div>
            ) : !csatScores || csatScores.total === 0 ? (
              <div style={{ textAlign: "center", padding: 40 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>⭐</div>
                <div style={{ fontSize: 14, color: "#C4CAD6", marginBottom: 8 }}>No CSAT Survey Responses Yet</div>
                <div style={{ fontSize: 11, color: "#5A6178", marginBottom: 16 }}>Submit your first survey response to start tracking customer satisfaction.</div>
                <button onClick={() => setCsatView("submit")} style={{ ...btnStyle("#6366F1"), fontSize: 12, padding: "8px 20px" }}>📝 Submit First Response</button>
              </div>
            ) : (
              <>
                {/* Overview */}
                {csatView === "overview" && (
                  <div>
                    {/* KPI Cards */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 16 }}>
                      {[
                        { label: "Overall CSAT", value: `${csatScores.average}/5`, color: csatScores.average >= 4 ? "#81C784" : csatScores.average >= 3 ? "#FFB347" : "#FF6B6B", icon: "⭐", sub: `${csatScores.total} responses` },
                        { label: "NPS Score", value: `${csatScores.nps > 0 ? "+" : ""}${csatScores.nps}`, color: csatScores.nps > 50 ? "#81C784" : csatScores.nps > 0 ? "#FFB347" : "#FF6B6B", icon: "📊", sub: csatScores.nps > 50 ? "Excellent" : csatScores.nps > 0 ? "Good" : "Needs Attention" },
                        { label: "5-Star Ratings", value: `${csatScores.byRating?.[5] || 0}`, color: "#06B6D4", icon: "🌟", sub: `${csatScores.total > 0 ? Math.round((csatScores.byRating?.[5] || 0) / csatScores.total * 100) : 0}% of total` },
                        { label: "Detractors", value: `${(csatScores.byRating?.[1] || 0) + (csatScores.byRating?.[2] || 0)}`, color: "#FF6B6B", icon: "⚠️", sub: "Ratings 1-2" },
                        { label: "Response Rate", value: `${csatScores.total}`, color: "#EC4899", icon: "📋", sub: "Total surveys collected" },
                      ].map((stat, i) => (
                        <div key={i} style={{ textAlign: "center", padding: 14, borderRadius: 8, background: "#0A0C14", border: `1px solid ${stat.color}22` }}>
                          <div style={{ fontSize: 16 }}>{stat.icon}</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: stat.color, fontFamily: "'JetBrains Mono', monospace", margin: "6px 0 2px" }}>{stat.value}</div>
                          <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.5 }}>{stat.label}</div>
                          <div style={{ fontSize: 8, color: "#5A617888", marginTop: 2 }}>{stat.sub}</div>
                        </div>
                      ))}
                    </div>

                    {/* Rating Distribution */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                      <div style={{ background: "#0A0C14", borderRadius: 8, padding: 16, border: "1px solid #1E213044" }}>
                        <h4 style={{ margin: "0 0 12px", fontSize: 12, color: "#E8ECF4" }}>Rating Distribution</h4>
                        {[5, 4, 3, 2, 1].map(r => {
                          const count = csatScores.byRating?.[r] || 0;
                          const pct = csatScores.total > 0 ? Math.round(count / csatScores.total * 100) : 0;
                          const colors = { 5: "#06B6D4", 4: "#81C784", 3: "#FFD93D", 2: "#FFB347", 1: "#FF6B6B" };
                          return (
                            <div key={r} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <span style={{ fontSize: 10, color: "#C4CAD6", width: 30, textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>{r} ★</span>
                              <div style={{ flex: 1, height: 14, background: "#0F111788", borderRadius: 4, overflow: "hidden" }}>
                                <div style={{ width: `${pct}%`, height: "100%", background: colors[r], borderRadius: 4, transition: "width 0.5s ease" }} />
                              </div>
                              <span style={{ fontSize: 9, color: "#5A6178", width: 45, fontFamily: "'JetBrains Mono', monospace" }}>{count} ({pct}%)</span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Sentiment Breakdown */}
                      <div style={{ background: "#0A0C14", borderRadius: 8, padding: 16, border: "1px solid #1E213044" }}>
                        <h4 style={{ margin: "0 0 12px", fontSize: 12, color: "#E8ECF4" }}>Comment Sentiment Analysis</h4>
                        {csatScores.sentimentBreakdown ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {[
                              { label: "Positive", count: csatScores.sentimentBreakdown.positive || 0, icon: "😊", color: "#81C784" },
                              { label: "Neutral", count: csatScores.sentimentBreakdown.neutral || 0, icon: "😐", color: "#FFB347" },
                              { label: "Negative", count: csatScores.sentimentBreakdown.negative || 0, icon: "😞", color: "#FF6B6B" },
                            ].map((s, i) => {
                              const total = (csatScores.sentimentBreakdown.positive || 0) + (csatScores.sentimentBreakdown.neutral || 0) + (csatScores.sentimentBreakdown.negative || 0);
                              const pct = total > 0 ? Math.round(s.count / total * 100) : 0;
                              return (
                                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 6, background: `${s.color}08`, border: `1px solid ${s.color}15` }}>
                                  <span style={{ fontSize: 18 }}>{s.icon}</span>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 11, color: "#E8ECF4", fontWeight: 600 }}>{s.label}</div>
                                    <div style={{ height: 4, background: "#0F111788", borderRadius: 2, marginTop: 4 }}>
                                      <div style={{ width: `${pct}%`, height: "100%", background: s.color, borderRadius: 2 }} />
                                    </div>
                                  </div>
                                  <span style={{ fontSize: 14, fontWeight: 700, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{s.count}</span>
                                  <span style={{ fontSize: 9, color: "#5A6178" }}>{pct}%</span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={{ textAlign: "center", padding: 20, color: "#5A6178", fontSize: 11 }}>No AI sentiment data available. Submit responses with comments to enable analysis.</div>
                        )}
                      </div>
                    </div>

                    {/* Weekly Trend */}
                    {csatScores.trend && csatScores.trend.length > 0 && (
                      <div style={{ background: "#0A0C14", borderRadius: 8, padding: 16, border: "1px solid #1E213044", marginBottom: 16 }}>
                        <h4 style={{ margin: "0 0 12px", fontSize: 12, color: "#E8ECF4" }}>Weekly CSAT Trend (12 Weeks)</h4>
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }}>
                          {csatScores.trend.map((w, i) => (
                            <div key={i} style={{ flex: 1, textAlign: "center" }} title={`${w.week}: ${w.avg || "N/A"}/5 (${w.count} responses)`}>
                              <div style={{ height: w.avg ? Math.max(4, (w.avg / 5) * 60) : 4, background: w.avg ? (w.avg >= 4 ? "#81C784" : w.avg >= 3 ? "#FFB347" : "#FF6B6B") : "#1E2130", borderRadius: "3px 3px 0 0", transition: "height 0.3s" }} />
                              <div style={{ fontSize: 7, color: "#5A6178", marginTop: 3, fontFamily: "'JetBrains Mono', monospace" }}>{w.avg || "-"}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                          <span style={{ fontSize: 7, color: "#5A617866" }}>12 wks ago</span>
                          <span style={{ fontSize: 7, color: "#5A617866" }}>This week</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Per-Agent Breakdown */}
                {csatView === "agents" && csatScores.byAgent && (
                  <div style={{ background: "#0A0C14", borderRadius: 8, padding: 16, border: "1px solid #1E213044" }}>
                    <h4 style={{ margin: "0 0 12px", fontSize: 12, color: "#E8ECF4" }}>Agent Performance — CSAT Scores</h4>
                    <div style={{ borderRadius: 6, overflow: "hidden", border: "1px solid #1E213044" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto auto", padding: "8px 12px", background: "#0F111788", borderBottom: "1px solid #1E213044" }}>
                        {["Agent", "Avg Score", "Total", "5★", "Detractors"].map(h => (
                          <span key={h} style={{ fontSize: 9, color: "#5A6178", fontWeight: 600, textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>{h}</span>
                        ))}
                      </div>
                      {Object.entries(csatScores.byAgent).sort((a, b) => b[1].avg - a[1].avg).map(([agent, data]) => (
                        <div key={agent} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto auto", padding: "10px 12px", borderBottom: "1px solid #1E213022", alignItems: "center" }}>
                          <span style={{ fontSize: 11, color: "#E8ECF4", fontWeight: 500 }}>👤 {agent}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: data.avg >= 4 ? "#81C784" : data.avg >= 3 ? "#FFB347" : "#FF6B6B", fontFamily: "'JetBrains Mono', monospace" }}>{data.avg}/5</span>
                          <span style={{ fontSize: 10, color: "#C4CAD6", fontFamily: "'JetBrains Mono', monospace" }}>{data.total}</span>
                          <span style={{ fontSize: 10, color: "#06B6D4", fontFamily: "'JetBrains Mono', monospace" }}>{data.count5}</span>
                          <span style={{ fontSize: 10, color: data.count1 > 0 ? "#FF6B6B" : "#81C784", fontFamily: "'JetBrains Mono', monospace" }}>{data.count1}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Category Breakdown */}
                {csatView === "categories" && csatScores.byCategory && (
                  <div style={{ background: "#0A0C14", borderRadius: 8, padding: 16, border: "1px solid #1E213044" }}>
                    <h4 style={{ margin: "0 0 12px", fontSize: 12, color: "#E8ECF4" }}>CSAT by Category</h4>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
                      {Object.entries(csatScores.byCategory).sort((a, b) => b[1].avg - a[1].avg).map(([cat, data]) => (
                        <div key={cat} style={{ padding: 14, borderRadius: 8, background: "#0F111788", border: `1px solid ${data.avg >= 4 ? "#81C78422" : data.avg >= 3 ? "#FFB34722" : "#FF6B6B22"}`, textAlign: "center" }}>
                          <div style={{ fontSize: 12, color: "#C4CAD6", fontWeight: 600, marginBottom: 6 }}>📁 {cat}</div>
                          <div style={{ fontSize: 24, fontWeight: 800, color: data.avg >= 4 ? "#81C784" : data.avg >= 3 ? "#FFB347" : "#FF6B6B", fontFamily: "'JetBrains Mono', monospace" }}>{data.avg}</div>
                          <div style={{ fontSize: 9, color: "#5A6178" }}>/5 avg · {data.total} responses</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent Comments */}
                {csatView === "comments" && (
                  <div style={{ background: "#0A0C14", borderRadius: 8, padding: 16, border: "1px solid #1E213044" }}>
                    <h4 style={{ margin: "0 0 12px", fontSize: 12, color: "#E8ECF4" }}>Recent Customer Comments</h4>
                    {(csatScores.recentComments || []).length === 0 ? (
                      <div style={{ textAlign: "center", padding: 20, color: "#5A6178", fontSize: 11 }}>No comments yet. Submit survey responses with comments to see them here.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {csatScores.recentComments.map((c, i) => (
                          <div key={i} style={{ padding: "12px 14px", borderRadius: 8, background: "#0F111788", border: `1px solid ${c.sentiment === "positive" ? "#81C78422" : c.sentiment === "negative" ? "#FF6B6B22" : "#1E213044"}` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <span style={{ fontSize: 12 }}>{c.sentiment === "positive" ? "😊" : c.sentiment === "negative" ? "😞" : "😐"}</span>
                              <span style={{ fontSize: 11, color: "#E8ECF4", fontWeight: 600 }}>{c.customerName}</span>
                              <span style={{ fontSize: 10, color: "#FFD93D" }}>{"★".repeat(c.rating)}{"☆".repeat(5 - c.rating)}</span>
                              <span style={{ fontSize: 9, color: "#5A6178", marginLeft: "auto", fontFamily: "'JetBrains Mono', monospace" }}>{c.ticketId}</span>
                            </div>
                            <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.5, marginBottom: 4 }}>"{c.comment}"</div>
                            {c.aiSummary && <div style={{ fontSize: 9, color: "#06B6D4", fontStyle: "italic" }}>🤖 AI: {c.aiSummary}</div>}
                            {c.keywords && c.keywords.length > 0 && (
                              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                                {c.keywords.map((kw, j) => <span key={j} style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: "#6366F115", color: "#6366F1", fontFamily: "'JetBrains Mono', monospace" }}>{kw}</span>)}
                              </div>
                            )}
                            <div style={{ fontSize: 9, color: "#5A617866", marginTop: 4 }}>Agent: {c.agentName} · {new Date(c.createdAt).toLocaleDateString()}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Submit CSAT Response */}
                {csatView === "submit" && (
                  <div style={{ background: "#0A0C14", borderRadius: 8, padding: 20, border: "1px solid #1E213044", maxWidth: 500 }}>
                    <h4 style={{ margin: "0 0 16px", fontSize: 12, color: "#E8ECF4" }}>📝 Submit CSAT Survey Response</h4>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div>
                        <label style={{ fontSize: 10, color: "#5A6178", marginBottom: 4, display: "block", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>Ticket ID *</label>
                        <input value={csatSubmitForm.ticketId} onChange={e => setCsatSubmitForm(p => ({ ...p, ticketId: e.target.value }))} placeholder="INC-001 or ZD-12345" style={{ width: "100%", padding: "9px 12px", background: "#0F1117", border: "1px solid #1E2130", borderRadius: 6, color: "#E8ECF4", fontSize: 12, fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box" }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 10, color: "#5A6178", marginBottom: 4, display: "block", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>Rating * (1-5)</label>
                        <div style={{ display: "flex", gap: 8 }}>
                          {[1, 2, 3, 4, 5].map(r => (
                            <button key={r} onClick={() => setCsatSubmitForm(p => ({ ...p, rating: r }))} style={{ width: 44, height: 44, borderRadius: 8, border: `2px solid ${csatSubmitForm.rating === r ? "#FFD93D" : "#1E2130"}`, background: csatSubmitForm.rating === r ? "#FFD93D22" : "#0F1117", cursor: "pointer", fontSize: 18, color: csatSubmitForm.rating >= r ? "#FFD93D" : "#5A6178" }}>★</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label style={{ fontSize: 10, color: "#5A6178", marginBottom: 4, display: "block", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>Category</label>
                        <select value={csatSubmitForm.category} onChange={e => setCsatSubmitForm(p => ({ ...p, category: e.target.value }))} style={{ width: "100%", padding: "9px 12px", background: "#0F1117", border: "1px solid #1E2130", borderRadius: 6, color: "#E8ECF4", fontSize: 12, fontFamily: "'DM Sans', sans-serif" }}>
                          {["General", "Network", "Email", "Hardware", "Software", "Account Access", "VPN", "Printing", "Security", "Other"].map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 10, color: "#5A6178", marginBottom: 4, display: "block", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>Customer Name</label>
                        <input value={csatSubmitForm.customerName || ""} onChange={e => setCsatSubmitForm(p => ({ ...p, customerName: e.target.value }))} placeholder="Customer name" style={{ width: "100%", padding: "9px 12px", background: "#0F1117", border: "1px solid #1E2130", borderRadius: 6, color: "#E8ECF4", fontSize: 12, fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box" }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 10, color: "#5A6178", marginBottom: 4, display: "block", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>Comment (optional)</label>
                        <textarea value={csatSubmitForm.comment} onChange={e => setCsatSubmitForm(p => ({ ...p, comment: e.target.value }))} placeholder="Share your feedback about the service..." rows={3} style={{ width: "100%", padding: "9px 12px", background: "#0F1117", border: "1px solid #1E2130", borderRadius: 6, color: "#E8ECF4", fontSize: 12, fontFamily: "'DM Sans', sans-serif", resize: "vertical", boxSizing: "border-box" }} />
                      </div>
                      <button onClick={() => { if (!csatSubmitForm.ticketId || !csatSubmitForm.rating) { showToast("Ticket ID and rating are required", "warning"); return; } submitCsatResponse(csatSubmitForm); }} disabled={csatSubmitting} style={{ ...btnStyle("#6366F1"), padding: "10px 20px", fontSize: 12, opacity: csatSubmitting ? 0.5 : 1 }}>{csatSubmitting ? "⏳ Submitting..." : "📤 Submit Survey Response"}</button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* AI Analysis Panel */}
            {csatAiAnalysis && typeof csatAiAnalysis === "object" && csatAiAnalysis.overallAssessment && (
              <div style={{ marginTop: 16, background: "#0A0C14", borderRadius: 8, padding: 16, border: "1px solid #EC489922" }}>
                <h4 style={{ margin: "0 0 12px", fontSize: 12, color: "#EC4899", display: "flex", alignItems: "center", gap: 6 }}>🤖 AI Customer Experience Analysis</h4>
                <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.6, marginBottom: 12 }}>{csatAiAnalysis.overallAssessment}</div>
                {csatAiAnalysis.topStrengths && csatAiAnalysis.topStrengths.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: "#81C784", fontWeight: 600, marginBottom: 4 }}>💪 Strengths</div>
                    {csatAiAnalysis.topStrengths.map((s, i) => <div key={i} style={{ fontSize: 10, color: "#C4CAD6", padding: "3px 0", paddingLeft: 12, borderLeft: "2px solid #81C78444" }}>• {s}</div>)}
                  </div>
                )}
                {csatAiAnalysis.areasForImprovement && csatAiAnalysis.areasForImprovement.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: "#FFB347", fontWeight: 600, marginBottom: 4 }}>📈 Areas for Improvement</div>
                    {csatAiAnalysis.areasForImprovement.map((a, i) => <div key={i} style={{ fontSize: 10, color: "#C4CAD6", padding: "3px 0", paddingLeft: 12, borderLeft: "2px solid #FFB34744" }}>• {a}</div>)}
                  </div>
                )}
                {csatAiAnalysis.recommendations && csatAiAnalysis.recommendations.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, color: "#06B6D4", fontWeight: 600, marginBottom: 4 }}>💡 Recommendations</div>
                    {csatAiAnalysis.recommendations.map((r, i) => (
                      <div key={i} style={{ padding: "6px 10px", marginBottom: 4, borderRadius: 4, background: "#0F111788", border: "1px solid #1E213022" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: r.priority === "high" ? "#FF6B6B22" : r.priority === "medium" ? "#FFB34722" : "#81C78422", color: r.priority === "high" ? "#FF6B6B" : r.priority === "medium" ? "#FFB347" : "#81C784", fontWeight: 600, textTransform: "uppercase" }}>{r.priority}</span>
                          <span style={{ fontSize: 10, color: "#E8ECF4" }}>{r.action}</span>
                        </div>
                        {r.impact && <div style={{ fontSize: 9, color: "#5A6178", marginTop: 2 }}>Impact: {r.impact}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {csatAiAnalysis.riskAlerts && csatAiAnalysis.riskAlerts.length > 0 && (
                  <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, background: "#FF6B6B08", border: "1px solid #FF6B6B22" }}>
                    <div style={{ fontSize: 10, color: "#FF6B6B", fontWeight: 600, marginBottom: 4 }}>🚨 Risk Alerts</div>
                    {csatAiAnalysis.riskAlerts.map((r, i) => <div key={i} style={{ fontSize: 10, color: "#C4CAD6", padding: "2px 0" }}>⚠️ {r}</div>)}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

    </div>
  );
}
