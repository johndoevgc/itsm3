import { useState, useMemo } from "react";
import {
  COLORS, PRIORITY_COLORS, STATUS_COLORS, inputStyle, btnStyle,
} from "../constants/theme.js";
import {
  Badge, StatCard, useStableComponent,
} from "../components/SharedComponents.jsx";
import ReportingModule from "./ReportingModule.jsx";
import CyberNewsModule from "./CyberNewsModule.jsx";
import ArchitectureDiagram from "./ArchitectureDiagram.jsx";

const safeStatNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const confidenceColor = (value) => {
  const confidence = safeStatNumber(value);
  return confidence >= 80 ? "#81C784" : confidence >= 60 ? "#FFB347" : "#FF6B6B";
};

export default function AnalyticsModuleWrapper({ ctx }) {
  const {
    analyticsSubTab, setAnalyticsSubTab,
    serviceReports, setServiceReports,
    csatAiAnalysis,
    incidents,
    currentUser, customers, problems, requests, changes, assets,
    users, vendors,
    setActiveModule, showToast, softDelete,
    fetchAiLearningData, deleteAiFeedback,
    aiLearningLoading, aiLearningMetrics, aiModelHealth,
    aiLearningTrends, aiLearningTrendPeriod, setAiLearningTrendPeriod,
    aiLearningFeedback,
  } = ctx;

  const tabStyle = (id) => ({
    padding: "10px 20px", background: analyticsSubTab === id ? "#12141E" : "transparent",
    border: "none", borderBottom: analyticsSubTab === id ? "2px solid #64B5F6" : "2px solid transparent",
    color: analyticsSubTab === id ? "#E8ECF4" : "#5A6178", cursor: "pointer", fontSize: 12,
    fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6
  });

  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid #1E2130", marginBottom: 16 }}>
        <button onClick={() => setAnalyticsSubTab("reports")} style={tabStyle("reports")}>
          📊 Reports <span style={{ background: "#64B5F622", color: "#64B5F6", padding: "1px 6px", borderRadius: 8, fontSize: 9 }}>{serviceReports.filter(r => r.status === "Draft").length}</span>
        </button>
        <button onClick={() => setAnalyticsSubTab("cybernews")} style={tabStyle("cybernews")}>
          🛡️ Cyber News <span style={{ background: "#FF6B6B22", color: "#FF6B6B", padding: "1px 6px", borderRadius: 8, fontSize: 9 }}>!</span>
        </button>
        <button onClick={() => setAnalyticsSubTab("architecture")} style={tabStyle("architecture")}>
          🏗️ Architecture
        </button>
        <button onClick={() => setAnalyticsSubTab("insights")} style={tabStyle("insights")}>
          📈 Advanced Insights
        </button>
        <button onClick={() => { setAnalyticsSubTab("ailearning"); fetchAiLearningData(); }} style={tabStyle("ailearning")}>
          🧠 AI Learning
        </button>
      </div>
      {analyticsSubTab === "reports" && <ReportingModule assets={assets} changes={changes} csatAiAnalysis={csatAiAnalysis} currentUser={currentUser} customers={customers} incidents={incidents} problems={problems} requests={requests} serviceReports={serviceReports} setActiveModule={setActiveModule} setServiceReports={setServiceReports} showToast={showToast} softDelete={softDelete} />}
      {analyticsSubTab === "cybernews" && <CyberNewsModule users={users} vendors={vendors} />}
      {analyticsSubTab === "architecture" && <ArchitectureDiagram />}
      {analyticsSubTab === "insights" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 20 }}>
            {(() => {
              const total = incidents.length;
              const open = incidents.filter(i => !["Resolved","Closed"].includes(i.status)).length;
              const resolved = incidents.filter(i => i.status === "Resolved" || i.status === "Closed").length;
              const mttr = resolved > 0 ? incidents.filter(i => i.status === "Resolved" || i.status === "Closed").reduce((s, i) => s + (i.created || 0), 0) / resolved : 0;
              const slaHit = incidents.filter(i => !i.slaBreach).length;
              const slaPct = total > 0 ? Math.round(slaHit / total * 100) : 100;
              const aiTriaged = incidents.filter(i => i.aiTriaged).length;
              const aiPct = total > 0 ? Math.round(aiTriaged / total * 100) : 0;
              return [
                { label: "Total Incidents", value: total, icon: "🔥", color: "#FF6B6B" },
                { label: "Open / Active", value: open, icon: "📂", color: "#FFB347" },
                { label: "Resolved / Closed", value: resolved, icon: "✅", color: "#81C784" },
                { label: "Avg Resolution (hrs)", value: mttr.toFixed(1), icon: "⏱️", color: "#06B6D4" },
                { label: "SLA Compliance", value: `${slaPct}%`, icon: "📊", color: slaPct >= 90 ? "#81C784" : "#FF6B6B" },
                { label: "AI Triage Rate", value: `${aiPct}%`, icon: "🤖", color: "#EC4899" },
              ];
            })().map((m, i) => (
              <div key={i} style={{ padding: 16, background: "#0F1117", borderRadius: 8, border: `1px solid ${m.color}33`, borderTop: `2px solid ${m.color}` }}>
                <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>{m.icon} {m.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: m.color, fontFamily: "'Space Grotesk', sans-serif" }}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* Category Breakdown */}
          <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, marginBottom: 20 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>📊 Incidents by Category</h3>
            <div style={{ display: "grid", gap: 6 }}>
              {(() => {
                const cats = {};
                incidents.forEach(i => { const c = i.category || "Uncategorized"; cats[c] = (cats[c] || 0) + 1; });
                const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
                const max = sorted.length > 0 ? sorted[0][1] : 1;
                return sorted.map(([cat, count]) => (
                  <div key={cat} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 11, color: "#C4CAD6", minWidth: 120 }}>{cat}</span>
                    <div style={{ flex: 1, height: 18, background: "#0A0C14", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ width: `${(count / max) * 100}%`, height: "100%", background: "linear-gradient(90deg, #6366F1, #06B6D4)", borderRadius: 4, transition: "width 0.5s" }} />
                    </div>
                    <span style={{ fontSize: 11, color: "#6366F1", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, minWidth: 30, textAlign: "right" }}>{count}</span>
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* Priority Distribution */}
          <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, marginBottom: 20 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>🎯 Priority Distribution</h3>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              {["Sev-A","Sev-B","Sev-C","Sev-D"].map(sev => {
                const count = incidents.filter(i => i.priority === sev).length;
                const pct = incidents.length > 0 ? Math.round(count / incidents.length * 100) : 0;
                const colors = { "Sev-A": "#FF6B6B", "Sev-B": "#FFB347", "Sev-C": "#64B5F6", "Sev-D": "#81C784" };
                return (
                  <div key={sev} style={{ textAlign: "center", flex: 1, padding: 14, background: "#0A0C14", borderRadius: 8, border: `1px solid ${colors[sev]}33` }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: colors[sev], fontFamily: "'Space Grotesk', sans-serif" }}>{count}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: colors[sev], marginBottom: 4 }}>{sev}</div>
                    <div style={{ fontSize: 10, color: "#5A6178" }}>{pct}%</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Team Performance */}
          <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>👥 Team Performance</h3>
            <div style={{ display: "grid", gap: 6 }}>
              {(() => {
                const assignees = {};
                incidents.forEach(i => { const a = i.assignee || "Unassigned"; if (!assignees[a]) assignees[a] = { total: 0, resolved: 0 }; assignees[a].total++; if (i.status === "Resolved" || i.status === "Closed") assignees[a].resolved++; });
                return Object.entries(assignees).sort((a, b) => b[1].total - a[1].total).slice(0, 10).map(([name, stats]) => (
                  <div key={name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#0A0C14", borderRadius: 6 }}>
                    <span style={{ fontSize: 12, color: "#C4CAD6", flex: 1 }}>{name}</span>
                    <span style={{ fontSize: 11, color: "#64B5F6", fontFamily: "'JetBrains Mono', monospace" }}>{stats.total} total</span>
                    <span style={{ fontSize: 11, color: "#81C784", fontFamily: "'JetBrains Mono', monospace" }}>{stats.resolved} resolved</span>
                    <span style={{ fontSize: 11, color: stats.total > 0 ? (stats.resolved / stats.total >= 0.7 ? "#81C784" : "#FFB347") : "#5A6178", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{stats.total > 0 ? Math.round(stats.resolved / stats.total * 100) : 0}%</span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}
      {analyticsSubTab === "ailearning" && (
        <div>
          {aiLearningLoading && !aiLearningMetrics && <div style={{ textAlign: "center", padding: 40, color: "#5A6178" }}>Loading AI Learning data...</div>}
          {aiLearningMetrics && (
            <div>
              {/* Model Health Banner */}
              {aiModelHealth && (
                <div style={{ background: "linear-gradient(135deg, #0F111788, #111422)", borderRadius: 10, border: `1px solid ${aiModelHealth.healthStatus === "healthy" ? "#81C78433" : aiModelHealth.healthStatus === "moderate" ? "#FFB34733" : "#FF6B6B33"}`, padding: "14px 20px", marginBottom: 20, position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${aiModelHealth.healthStatus === "healthy" ? "#81C784" : aiModelHealth.healthStatus === "moderate" ? "#FFB347" : "#FF6B6B"}, #6366F1)` }} />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 42, height: 42, borderRadius: 10, background: `linear-gradient(135deg, ${aiModelHealth.healthStatus === "healthy" ? "#81C784" : "#FFB347"}, #6366F1)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🧠</div>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>AI Model Health: {aiModelHealth.healthScore}/100</div>
                        <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
                          Status: <span style={{ color: aiModelHealth.healthStatus === "healthy" ? "#81C784" : aiModelHealth.healthStatus === "moderate" ? "#FFB347" : "#FF6B6B", textTransform: "uppercase" }}>{aiModelHealth.healthStatus}</span>
                          {" · "}Trend: <span style={{ color: aiModelHealth.trend === "improving" ? "#81C784" : aiModelHealth.trend === "stable" ? "#64B5F6" : "#FF6B6B" }}>{aiModelHealth.trend === "improving" ? "📈" : aiModelHealth.trend === "stable" ? "➡️" : "📉"} {aiModelHealth.trend}</span>
                        </div>
                      </div>
                    </div>
                    <button onClick={() => fetchAiLearningData()} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #6366F133", background: "#6366F118", color: "#6366F1", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                      🔄 Refresh
                    </button>
                  </div>
                </div>
              )}

              {/* Key Metrics Cards */}
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 24 }}>
                <StatCard label="Total AI Triages" value={safeStatNumber(aiLearningMetrics.totalTriages)} icon="⚡" accent="#6366F1" />
                <StatCard label="Auto-Apply Rate" value={`${safeStatNumber(aiLearningMetrics.autoApplyRate)}%`} icon="🤖" accent="#81C784" />
                <StatCard label="Avg Confidence" value={`${safeStatNumber(aiLearningMetrics.avgConfidence)}%`} icon="🎯" accent="#06B6D4" />
                <StatCard label="Feedback Accuracy" value={`${aiLearningMetrics.feedbackStats?.accuracyRate || 0}%`} icon="✅" accent="#EC4899" />
                <StatCard label="Pending Actions" value={safeStatNumber(aiLearningMetrics.pendingActions)} icon="⏳" accent="#FFB347" />
              </div>

              {/* Confidence Distribution */}
              <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, marginBottom: 20 }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>🎯 Confidence Distribution</h3>
                <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                  {Object.entries(aiLearningMetrics.confidenceBuckets || {}).map(([range, count]) => {
                    const colors = { "0-20": "#FF4444", "21-40": "#FF6B6B", "41-60": "#FFB347", "61-80": "#64B5F6", "81-100": "#81C784" };
                    const maxCount = Math.max(...Object.values(aiLearningMetrics.confidenceBuckets || {}), 1);
                    return (
                      <div key={range} style={{ textAlign: "center", flex: 1 }}>
                        <div style={{ height: 120, display: "flex", alignItems: "flex-end", justifyContent: "center", marginBottom: 8 }}>
                          <div style={{ width: 36, background: `${colors[range]}44`, borderRadius: "4px 4px 0 0", height: `${Math.max(4, (count / maxCount) * 100)}%`, border: `1px solid ${colors[range]}66`, transition: "height 0.4s" }} />
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: colors[range], fontFamily: "'Space Grotesk', sans-serif" }}>{count}</div>
                        <div style={{ fontSize: 10, color: "#5A6178", marginTop: 2 }}>{range}%</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Category Breakdown */}
              <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, marginBottom: 20 }}>
                <h3 style={{ margin: "0 0 12px", fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>📊 Category Performance</h3>
                <div style={{ display: "grid", gap: 6 }}>
                  {Object.entries(aiLearningMetrics.categoryBreakdown || {}).sort((a, b) => safeStatNumber(b[1].total) - safeStatNumber(a[1].total)).map(([cat, stats]) => (
                    <div key={cat} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#0A0C14", borderRadius: 6, border: "1px solid #1E213033" }}>
                      <span style={{ fontSize: 13, color: "#E8ECF4", flex: 1, fontWeight: 600 }}>{cat}</span>
                      <span style={{ fontSize: 11, color: "#64B5F6", fontFamily: "'JetBrains Mono', monospace" }}>{safeStatNumber(stats.total)} triages</span>
                      <span style={{ fontSize: 11, color: "#81C784", fontFamily: "'JetBrains Mono', monospace" }}>{safeStatNumber(stats.autoApplied)} auto</span>
                      <span style={{ fontSize: 11, color: confidenceColor(stats.avgConfidence), fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{safeStatNumber(stats.avgConfidence)}% conf</span>
                    </div>
                  ))}
                  {Object.keys(aiLearningMetrics.categoryBreakdown || {}).length === 0 && (
                    <div style={{ textAlign: "center", padding: 20, color: "#5A6178", fontSize: 12 }}>No category data yet. AI triages will populate this.</div>
                  )}
                </div>
              </div>

              {/* Trends Chart */}
              <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>📈 Performance Trends</h3>
                  <div style={{ display: "flex", gap: 4 }}>
                    {["daily", "weekly", "monthly"].map(p => (
                      <button key={p} onClick={() => { setAiLearningTrendPeriod(p); }} style={{
                        padding: "4px 10px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                        background: aiLearningTrendPeriod === p ? "#6366F122" : "transparent",
                        border: `1px solid ${aiLearningTrendPeriod === p ? "#6366F144" : "#1E213044"}`,
                        color: aiLearningTrendPeriod === p ? "#6366F1" : "#5A6178", cursor: "pointer",
                        fontFamily: "'JetBrains Mono', monospace", textTransform: "capitalize"
                      }}>{p}</button>
                    ))}
                  </div>
                </div>
                {aiLearningTrends.length > 0 ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "100px repeat(4, 1fr)", gap: 8, padding: "6px 12px", fontSize: 10, fontWeight: 600, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", borderBottom: "1px solid #1E213044" }}>
                      <span>Period</span><span>Triages</span><span>Auto-Apply</span><span>Avg Conf</span><span>Feedback</span>
                    </div>
                    {aiLearningTrends.slice(-12).map((t, idx) => (
                      <div key={idx} style={{ display: "grid", gridTemplateColumns: "100px repeat(4, 1fr)", gap: 8, padding: "8px 12px", background: idx % 2 === 0 ? "#0A0C14" : "transparent", borderRadius: 4, fontSize: 11, color: "#C4CAD6", fontFamily: "'JetBrains Mono', monospace" }}>
                        <span style={{ color: "#64B5F6" }}>{t.period}</span>
                        <span>{safeStatNumber(t.triages)}</span>
                        <span style={{ color: "#81C784" }}>{safeStatNumber(t.autoApplyRate)}%</span>
                        <span style={{ color: confidenceColor(t.avgConfidence) }}>{safeStatNumber(t.avgConfidence)}%</span>
                        <span>{t.feedbackCorrect > 0 || t.feedbackIncorrect > 0 ? `✅${t.feedbackCorrect} ❌${t.feedbackIncorrect}` : "—"}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: 20, color: "#5A6178", fontSize: 12 }}>No trend data yet. Run AI triages to populate trends.</div>
                )}
              </div>

              {/* Feedback Log */}
              <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>💬 Human Feedback Log <span style={{ fontSize: 10, color: "#5A6178", fontWeight: 400 }}>({aiLearningFeedback.length})</span></h3>
                </div>
                {aiLearningFeedback.length > 0 ? (
                  <div style={{ display: "grid", gap: 6, maxHeight: 300, overflowY: "auto" }}>
                    {aiLearningFeedback.slice(0, 20).map(fb => (
                      <div key={fb.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#0A0C14", borderRadius: 6, border: `1px solid ${fb.verdict === "correct" ? "#81C78433" : "#FF6B6B33"}` }}>
                        <span style={{ fontSize: 16 }}>{fb.verdict === "correct" ? "✅" : "❌"}</span>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 11, color: "#C4CAD6", fontFamily: "'JetBrains Mono', monospace" }}>Triage: {fb.triageId}</span>
                          {fb.notes && <div style={{ fontSize: 10, color: "#5A6178", marginTop: 2 }}>{fb.notes}</div>}
                        </div>
                        <span style={{ fontSize: 9, color: "#5A6178" }}>{new Date(fb.createdAt).toLocaleDateString("en-SG")}</span>
                        <button onClick={() => deleteAiFeedback(fb.id)} style={{ background: "none", border: "1px solid #FF444433", borderRadius: 4, padding: "2px 6px", fontSize: 9, color: "#FF6B6B", cursor: "pointer" }}>✕</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: 20, color: "#5A6178", fontSize: 12 }}>No feedback recorded yet. Submit feedback on AI triage decisions to track accuracy.</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
