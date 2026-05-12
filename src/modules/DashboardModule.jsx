import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  COLORS, PRIORITY_COLORS, STATUS_COLORS, PERM_COLORS, inputStyle, btnStyle,
} from "../constants/theme.js";
import {
  STATUS, OPEN_STATUSES, PRIORITY, SLA_TARGETS,
} from "../constants/status.js";
import {
  RBAC_ROLES, RBAC_PERMISSIONS, DEV_ADMIN_EMAILS, ADMIN_EMAILS, USERS,
} from "../constants/rbac.js";
import {
  CATEGORIES, SERVICES, SECURITY_ALERTS, AI_FEATURE_EXPLAINERS,
} from "../constants/categories.js";
import { APP_VERSION } from "../constants/version.js";
import {
  getBusinessHoursElapsed, formatSlaCountdown, computeIncidentSla, computeMTTR,
  genId, timeAgo, sanitizeHTML,
} from "../utils/slaHelpers.js";
import {
  Badge, PriorityDot, StatCard, DataTable, Modal, FormField, SearchBar, WorkflowHeader,
} from "../components/SharedComponents.jsx";

/* ─── Sub-components (hooks-safe) ────────────────────────── */

function CsatAiInsightsWidget({ incidents, btnStyle }) {
  const [csatAiInsights, setCsatAiInsights] = React.useState(null);
  const [csatAiLoading, setCsatAiLoading] = React.useState(false);
  const csatMetrics = useMemo(() => {
    const resolved = incidents.filter(i => ["Resolved", "Closed"].includes(i.status));
    const avgResTime = resolved.length > 0 ? resolved.reduce((s, i) => {
      const created = new Date(i.createdAt || i.created || 0).getTime();
      const res = new Date(i.resolvedAt || i.updatedAt || Date.now()).getTime();
      return s + (res - created);
    }, 0) / resolved.length / 3600000 : 0;
    const reopened = incidents.filter(i => (i.activityLog || []).some(a => (a.message || "").toLowerCase().includes("reopen"))).length;
    const escalated = incidents.filter(i => (i.activityLog || []).some(a => (a.message || "").toLowerCase().includes("escalat"))).length;
    const catCounts = {};
    incidents.forEach(i => { const c = i.category || "Other"; catCounts[c] = (catCounts[c] || 0) + 1; });
    const worstCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
    const satisfactionScore = Math.max(0, Math.min(100, Math.round(100 - (reopened / Math.max(resolved.length, 1)) * 100 - (escalated / Math.max(incidents.length, 1)) * 50)));
    return { resolved: resolved.length, total: incidents.length, avgResTime: Math.round(avgResTime * 10) / 10, reopened, escalated, worstCat, satisfactionScore };
  }, [incidents]);
  return (
    <div style={{ background: "#0A0C14", borderRadius: 8, padding: 16, border: "1px solid #EC489922", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h4 style={{ margin: 0, fontSize: 12, color: "#EC4899", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
          🧠 AI Customer Satisfaction Insights
        </h4>
        <button disabled={csatAiLoading} onClick={async () => {
          setCsatAiLoading(true);
          try {
            const r = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: `Analyze CSAT metrics and provide 3-4 actionable insights:\n- Total tickets: ${csatMetrics.total}, Resolved: ${csatMetrics.resolved}\n- Avg resolution: ${csatMetrics.avgResTime}h\n- Reopened: ${csatMetrics.reopened}, Escalated: ${csatMetrics.escalated}\n- Top category: ${csatMetrics.worstCat?.[0] || "N/A"} (${csatMetrics.worstCat?.[1] || 0} tickets)\n- Satisfaction score: ${csatMetrics.satisfactionScore}%\nProvide brief insights as JSON array: [{"title":"...","detail":"...","impact":"high|medium|low","action":"..."}]` })
            });
            const d = await r.json();
            try { setCsatAiInsights(JSON.parse(d.reply || "[]")); } catch { setCsatAiInsights([{ title: "AI Analysis", detail: d.reply || d.message || "No insights", impact: "medium", action: "Review manually" }]); }
          } catch { setCsatAiInsights([{ title: "Service Unavailable", detail: "AI analysis service is currently unavailable", impact: "low", action: "Try again later" }]); }
          setCsatAiLoading(false);
        }} style={{ ...btnStyle("#EC4899"), fontSize: 9, padding: "3px 10px" }}>
          {csatAiLoading ? "⏳ Analyzing..." : "🧠 Analyze"}
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 12 }}>
        {[
          { label: "Satisfaction", value: `${csatMetrics.satisfactionScore}%`, color: csatMetrics.satisfactionScore >= 80 ? "#81C784" : csatMetrics.satisfactionScore >= 60 ? "#FFB347" : "#FF6B6B" },
          { label: "Resolution Rate", value: `${csatMetrics.total > 0 ? Math.round((csatMetrics.resolved / csatMetrics.total) * 100) : 0}%`, color: "#64B5F6" },
          { label: "Avg Res. Time", value: `${csatMetrics.avgResTime}h`, color: csatMetrics.avgResTime < 24 ? "#81C784" : "#FFB347" },
          { label: "Reopened", value: csatMetrics.reopened, color: csatMetrics.reopened > 0 ? "#FF6B6B" : "#81C784" },
          { label: "Escalated", value: csatMetrics.escalated, color: csatMetrics.escalated > 0 ? "#FFB347" : "#81C784" },
        ].map((m, i) => (
          <div key={i} style={{ textAlign: "center", padding: "8px 4px", borderRadius: 6, background: `${m.color}08`, border: `1px solid ${m.color}22` }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: m.color, fontFamily: "'JetBrains Mono', monospace" }}>{m.value}</div>
            <div style={{ fontSize: 8, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>{m.label}</div>
          </div>
        ))}
      </div>
      {csatAiInsights ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {csatAiInsights.map((ins, i) => {
            const impactColor = ins.impact === "high" ? "#FF6B6B" : ins.impact === "medium" ? "#FFB347" : "#64B5F6";
            return (
              <div key={i} style={{ padding: 10, borderRadius: 6, background: "#0F1117", border: `1px solid ${impactColor}22` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: `${impactColor}18`, color: impactColor, fontWeight: 600, textTransform: "uppercase" }}>{ins.impact}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#E8ECF4" }}>{ins.title}</span>
                </div>
                <div style={{ fontSize: 10, color: "#8A94A6", lineHeight: 1.5, marginBottom: 6 }}>{ins.detail}</div>
                <div style={{ fontSize: 9, color: "#EC4899", fontFamily: "'JetBrains Mono', monospace" }}>→ {ins.action}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: 12, color: "#5A6178", fontSize: 10 }}>Click "Analyze" for AI-powered insights on customer satisfaction drivers</div>
      )}
    </div>
  );
}

function SentimentAnalysisWidget({ incidents }) {
  const sentimentData = useMemo(() => {
    const recent = incidents.filter(i => {
      const d = new Date(i.createdAt || i.created || 0);
      return !isNaN(d.getTime()) && Date.now() - d.getTime() < 30 * 86400000;
    });
    const analyze = (text = "") => {
      const t = text.toLowerCase();
      const negWords = ["urgent","critical","broken","down","fail","error","crash","angry","frustrated","terrible","worst","unacceptable","outage","stuck","impossible","slow","delay"];
      const posWords = ["thank","great","resolved","fixed","excellent","appreciate","wonderful","helpful","good","happy","satisfied","quick","fast","smooth"];
      const neg = negWords.filter(w => t.includes(w)).length;
      const pos = posWords.filter(w => t.includes(w)).length;
      if (neg > pos) return "negative";
      if (pos > neg) return "positive";
      return "neutral";
    };
    let positive = 0, neutral = 0, negative = 0;
    recent.forEach(i => {
      const s = analyze(`${i.title} ${i.description || ""}`);
      if (s === "positive") positive++;
      else if (s === "negative") negative++;
      else neutral++;
    });
    const total = positive + neutral + negative || 1;
    const weeks = [0, 1, 2, 3].map(w => {
      const start = Date.now() - (w + 1) * 7 * 86400000;
      const end = Date.now() - w * 7 * 86400000;
      const wk = incidents.filter(i => {
        const d = new Date(i.createdAt || i.created || 0).getTime();
        return d >= start && d < end;
      });
      let wp = 0, wn = 0;
      wk.forEach(i => { const s = analyze(`${i.title} ${i.description || ""}`); if (s === "positive") wp++; if (s === "negative") wn++; });
      return { week: `W-${w}`, positive: wp, negative: wn, total: wk.length || 1 };
    }).reverse();
    const catNeg = {};
    recent.filter(i => analyze(`${i.title} ${i.description || ""}`) === "negative").forEach(i => {
      const cat = i.category || "Other";
      catNeg[cat] = (catNeg[cat] || 0) + 1;
    });
    const topNegCats = Object.entries(catNeg).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { positive, neutral, negative, total, weeks, topNegCats, score: Math.round((positive / total) * 100) };
  }, [incidents]);

  const score = sentimentData.score;
  const scoreColor = score >= 60 ? "#4CAF50" : score >= 40 ? "#FFB347" : "#FF6B6B";

  return (
    <div style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", padding: 20, marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>💬</span> AI Sentiment Analysis
          <span style={{ fontSize: 10, color: "#5A6178", fontWeight: 400 }}>Last 30 days</span>
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: scoreColor, fontFamily: "'JetBrains Mono', monospace" }}>{score}%</span>
          <span style={{ fontSize: 10, color: "#5A6178" }}>positive</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
        {[
          { label: "Positive", value: sentimentData.positive, icon: "😊", color: "#4CAF50", bg: "#0D2D1A" },
          { label: "Neutral", value: sentimentData.neutral, icon: "😐", color: "#FFB347", bg: "#3B1F00" },
          { label: "Negative", value: sentimentData.negative, icon: "😠", color: "#FF6B6B", bg: "#2D0D0D" },
        ].map((s, i) => (
          <div key={i} style={{ background: s.bg, borderRadius: 8, padding: "12px 14px", border: `1px solid ${s.color}22`, textAlign: "center" }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</div>
            <div style={{ fontSize: 10, color: "#5A6178", marginTop: 2 }}>{s.label}</div>
            <div style={{ fontSize: 9, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{Math.round((s.value / sentimentData.total) * 100)}%</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div style={{ background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #1E213044" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#C4CAD6", marginBottom: 10 }}>Weekly Sentiment Trend</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 60 }}>
            {sentimentData.weeks.map((w, i) => {
              const posPct = (w.positive / w.total) * 100;
              const negPct = (w.negative / w.total) * 100;
              return (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                  <div style={{ width: "80%", display: "flex", flexDirection: "column", gap: 1 }}>
                    <div style={{ height: `${Math.max(2, posPct * 0.5)}px`, background: "#4CAF50", borderRadius: "2px 2px 0 0", transition: "height 0.3s" }} />
                    <div style={{ height: `${Math.max(2, negPct * 0.5)}px`, background: "#FF6B6B", borderRadius: "0 0 2px 2px", transition: "height 0.3s" }} />
                  </div>
                  <span style={{ fontSize: 8, color: "#5A6178" }}>{w.week}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 8, justifyContent: "center" }}>
            <span style={{ fontSize: 9, color: "#4CAF50", display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 6, height: 6, borderRadius: 2, background: "#4CAF50", display: "inline-block" }} /> Positive</span>
            <span style={{ fontSize: 9, color: "#FF6B6B", display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 6, height: 6, borderRadius: 2, background: "#FF6B6B", display: "inline-block" }} /> Negative</span>
          </div>
        </div>

        <div style={{ background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #1E213044" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#C4CAD6", marginBottom: 10 }}>Top Pain Points</div>
          {sentimentData.topNegCats.length === 0 && <div style={{ fontSize: 11, color: "#5A6178", textAlign: "center", padding: 10 }}>No negative sentiment detected 🎉</div>}
          {sentimentData.topNegCats.map(([cat, count], i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: i < sentimentData.topNegCats.length - 1 ? "1px solid #1E213033" : "none" }}>
              <span style={{ fontSize: 11, color: "#C4CAD6", flex: 1 }}>{cat}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#FF6B6B", fontFamily: "'JetBrains Mono', monospace" }}>{count}</span>
              <div style={{ width: 40, height: 4, background: "#1E2130", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, (count / (sentimentData.topNegCats[0]?.[1] || 1)) * 100)}%`, height: "100%", background: "#FF6B6B", borderRadius: 2 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PredictiveAnalyticsWidget({ incidents }) {
  const predData = useMemo(() => {
    const weeklyVols = [];
    for (let w = 7; w >= 0; w--) {
      const start = Date.now() - (w + 1) * 7 * 86400000;
      const end = Date.now() - w * 7 * 86400000;
      const count = incidents.filter(i => {
        const d = new Date(i.createdAt || i.created || 0).getTime();
        return d >= start && d < end;
      }).length;
      weeklyVols.push({ week: `W-${w}`, count });
    }
    const n = weeklyVols.length;
    const sumX = weeklyVols.reduce((s, _, i) => s + i, 0);
    const sumY = weeklyVols.reduce((s, w) => s + w.count, 0);
    const sumXY = weeklyVols.reduce((s, w, i) => s + i * w.count, 0);
    const sumX2 = weeklyVols.reduce((s, _, i) => s + i * i, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX || 1);
    const intercept = (sumY - slope * sumX) / n;
    const forecast = [1, 2, 3, 4].map(fw => ({
      week: `F+${fw}`,
      predicted: Math.max(0, Math.round(intercept + slope * (n + fw - 1))),
    }));
    const trend = slope > 0.5 ? "increasing" : slope < -0.5 ? "decreasing" : "stable";
    const trendColor = slope > 0.5 ? "#FF6B6B" : slope < -0.5 ? "#4CAF50" : "#FFB347";
    const catCounts = {};
    incidents.forEach(i => { const c = i.category || "Other"; catCounts[c] = (catCounts[c] || 0) + 1; });
    const topCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const hourCounts = new Array(24).fill(0);
    incidents.forEach(i => {
      const d = new Date(i.createdAt || i.created || 0);
      if (!isNaN(d.getTime())) hourCounts[d.getHours()]++;
    });
    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
    return { weeklyVols, forecast, trend, trendColor, slope: Math.round(slope * 10) / 10, topCats, peakHour, hourCounts, avgWeekly: Math.round(sumY / n) };
  }, [incidents]);

  const maxVol = Math.max(...predData.weeklyVols.map(w => w.count), ...predData.forecast.map(f => f.predicted), 1);

  return (
    <div style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", padding: 20, marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>📈</span> AI Predictive Analytics
          <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: `${predData.trendColor}15`, color: predData.trendColor, fontWeight: 600 }}>
            {predData.trend === "increasing" ? "↗ Increasing" : predData.trend === "decreasing" ? "↘ Decreasing" : "→ Stable"} ({predData.slope > 0 ? "+" : ""}{predData.slope}/wk)
          </span>
        </h3>
        <div style={{ fontSize: 10, color: "#5A6178" }}>Avg {predData.avgWeekly} tickets/week · Peak hour: {predData.peakHour}:00</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div style={{ background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #1E213044" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#C4CAD6", marginBottom: 10 }}>Volume Trend & 4-Week Forecast</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 80 }}>
            {predData.weeklyVols.map((w, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <span style={{ fontSize: 8, color: "#64B5F6", fontFamily: "'JetBrains Mono', monospace" }}>{w.count}</span>
                <div style={{ width: "100%", height: `${(w.count / maxVol) * 60}px`, background: "linear-gradient(180deg, #64B5F6, #64B5F644)", borderRadius: "3px 3px 0 0", minHeight: 2, transition: "height 0.3s" }} />
                <span style={{ fontSize: 7, color: "#5A6178" }}>{w.week}</span>
              </div>
            ))}
            <div style={{ width: 1, height: 60, background: "#5A617844", margin: "0 2px" }} />
            {predData.forecast.map((f, i) => (
              <div key={`f-${i}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <span style={{ fontSize: 8, color: "#8B5CF6", fontFamily: "'JetBrains Mono', monospace" }}>{f.predicted}</span>
                <div style={{ width: "100%", height: `${(f.predicted / maxVol) * 60}px`, background: "linear-gradient(180deg, #8B5CF6, #8B5CF644)", borderRadius: "3px 3px 0 0", minHeight: 2, transition: "height 0.3s", borderStyle: "dashed", borderWidth: "1px 1px 0 1px", borderColor: "#8B5CF644" }} />
                <span style={{ fontSize: 7, color: "#8B5CF6" }}>{f.week}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 8, justifyContent: "center" }}>
            <span style={{ fontSize: 9, color: "#64B5F6", display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 6, height: 6, borderRadius: 2, background: "#64B5F6", display: "inline-block" }} /> Actual</span>
            <span style={{ fontSize: 9, color: "#8B5CF6", display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 6, height: 6, borderRadius: 2, background: "#8B5CF6", display: "inline-block", borderStyle: "dashed", borderWidth: 1 }} /> Forecast</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #1E213044", flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#C4CAD6", marginBottom: 8 }}>Predicted Hot Categories</div>
            {predData.topCats.map(([cat, count], i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
                <span style={{ fontSize: 11, color: "#C4CAD6", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cat}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#FFB347", fontFamily: "'JetBrains Mono', monospace", minWidth: 24, textAlign: "right" }}>{count}</span>
                <div style={{ width: 30, height: 4, background: "#1E2130", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${(count / (predData.topCats[0]?.[1] || 1)) * 100}%`, height: "100%", background: i === 0 ? "#FF6B6B" : i === 1 ? "#FFB347" : "#64B5F6", borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #1E213044" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#C4CAD6", marginBottom: 6 }}>Peak Activity Hours</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 30 }}>
              {predData.hourCounts.map((c, h) => {
                const maxH = Math.max(...predData.hourCounts, 1);
                return <div key={h} title={`${h}:00 — ${c} tickets`} style={{ flex: 1, height: `${(c / maxH) * 28}px`, background: h === predData.peakHour ? "#FF6B6B" : c > maxH * 0.7 ? "#FFB347" : "#64B5F644", borderRadius: "1px 1px 0 0", minHeight: c > 0 ? 2 : 0 }} />;
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
              <span style={{ fontSize: 7, color: "#5A6178" }}>0h</span>
              <span style={{ fontSize: 7, color: "#5A6178" }}>12h</span>
              <span style={{ fontSize: 7, color: "#5A6178" }}>23h</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Phase 11.1: SLA Countdown Tracker ─────────────────── */
function SlaCountdownWidget({ incidents, computeIncidentSla, setActiveModule }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 30000); return () => clearInterval(id); }, []);

  const atRisk = useMemo(() => {
    return incidents
      .filter(i => i.status !== "Resolved" && i.status !== "Closed")
      .map(i => {
        const sla = computeIncidentSla(i);
        return { ...i, sla };
      })
      .filter(i => i.sla.isAtRisk || i.sla.isBreached)
      .sort((a, b) => (a.sla.remainingMs || 0) - (b.sla.remainingMs || 0))
      .slice(0, 8);
  }, [incidents, tick]);

  const fmtTime = (ms) => {
    if (ms == null) return "—";
    const neg = ms < 0;
    const abs = Math.abs(ms);
    const h = Math.floor(abs / 3600000);
    const m = Math.floor((abs % 3600000) / 60000);
    return `${neg ? "-" : ""}${h}h ${m}m`;
  };

  if (atRisk.length === 0) return (
    <div style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #4CAF5033", padding: 20, marginBottom: 20, textAlign: "center" }}>
      <div style={{ fontSize: 14, color: "#4CAF50", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>✅</span> All SLAs On Track
      </div>
      <div style={{ fontSize: 11, color: "#5A6178", marginTop: 4 }}>No incidents approaching SLA breach</div>
    </div>
  );

  return (
    <div role="region" aria-label="SLA Countdown Tracker" style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #FF6B6B22", padding: 20, marginBottom: 20, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, #FF6B6B, #FFB347, #4CAF50)" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>⏱️</span> SLA Countdown Tracker
          <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 8, background: "#FF6B6B22", color: "#FF6B6B", fontWeight: 600 }}>{atRisk.length} AT RISK</span>
        </h3>
        <button onClick={() => setActiveModule("sla")} aria-label="Open SLA module" style={{ padding: "5px 12px", borderRadius: 6, background: "#FFB34718", border: "1px solid #FFB34733", color: "#FFB347", cursor: "pointer", fontSize: 10, fontWeight: 600 }}>View All →</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
        {atRisk.map(inc => {
          const breached = inc.sla.isBreached;
          const pct = inc.sla.percentUsed || 0;
          const barColor = breached ? "#FF4444" : pct >= 90 ? "#FF6B6B" : pct >= 75 ? "#FFB347" : "#4CAF50";
          const remaining = inc.sla.remainingMs;
          return (
            <div key={inc.id} role="listitem" style={{ background: "#0A0C14", borderRadius: 8, padding: "12px 14px", border: `1px solid ${barColor}33`, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: barColor }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: barColor, fontFamily: "'JetBrains Mono', monospace" }}>{inc.id}</div>
                  <div style={{ fontSize: 10, color: "#C4CAD6", maxWidth: 160, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{inc.title || inc.subject || "Untitled"}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: barColor, fontFamily: "'Space Grotesk', sans-serif", lineHeight: 1 }}>{fmtTime(remaining)}</div>
                  <div style={{ fontSize: 8, color: breached ? "#FF4444" : "#FFB347", fontWeight: 600, textTransform: "uppercase" }}>{breached ? "BREACHED" : "REMAINING"}</div>
                </div>
              </div>
              <div style={{ background: "#1E2130", borderRadius: 3, height: 4, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: barColor, borderRadius: 3, transition: "width 0.5s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                <span style={{ fontSize: 9, color: "#5A6178" }}>{inc.priority}</span>
                <span style={{ fontSize: 9, color: "#5A6178" }}>{inc.assignee || "Unassigned"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── v3.28.0: Reassign Suggestions Quick-View ─────────── */
function ReassignSuggestionsWidget({ setActiveModule }) {
  const [suggestions, setSuggestions] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/sla/reassign-suggestions", { credentials: "include" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (!cancelled) setSuggestions(Array.isArray(d?.suggestions) ? d.suggestions : []);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading || !suggestions || suggestions.length === 0) return null;
  const top = suggestions.slice(0, 3);
  return (
    <div role="region" aria-label="Reassign Suggestions" style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #6366F133", padding: 16, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>🔄</span> Reassign Suggestions
          <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 8, background: "#6366F122", color: "#A5B4FC", fontWeight: 600 }}>{suggestions.length}</span>
        </h3>
        <button onClick={() => setActiveModule("sla")} aria-label="Open SLA module" style={{ padding: "5px 12px", borderRadius: 6, background: "#6366F118", border: "1px solid #6366F133", color: "#A5B4FC", cursor: "pointer", fontSize: 10, fontWeight: 600 }}>Review →</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
        {top.map(s => (
          <div key={s.incidentId || s.id} onClick={() => setActiveModule("sla")} style={{ background: "#0A0C14", borderRadius: 8, padding: "10px 12px", border: "1px solid #6366F122", cursor: "pointer" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#A5B4FC", fontFamily: "'JetBrains Mono', monospace" }}>{s.incidentId || s.id}</div>
            <div style={{ fontSize: 10, color: "#C4CAD6", marginTop: 2 }}>
              {s.currentAssignee || "Unassigned"} → <span style={{ color: "#6EE7B7", fontWeight: 600 }}>{s.suggestedAssignee || s.recommendedAssignee || "?"}</span>
            </div>
            {s.reason && <div style={{ fontSize: 9, color: "#5A6178", marginTop: 4 }}>{String(s.reason).substring(0, 80)}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── v3.31.1 (Phase 1) — Anomaly Alert Widget ─────────────────────── */
function AnomalyAlertWidget({ setActiveModule }) {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      const r = await fetch("/api/ai/anomaly-summary", { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
    // Live refresh on WS anomaly_detected event (best-effort; tolerate missing global).
    const handler = () => load();
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("vgc-anomaly-detected", handler);
    }
    const poll = setInterval(load, 60000); // 60s safety net
    return () => {
      if (typeof window !== "undefined" && window.removeEventListener) {
        window.removeEventListener("vgc-anomaly-detected", handler);
      }
      clearInterval(poll);
    };
  }, [load]);

  if (loading || !data) return null;
  const totalDelta = Number(data.deltas?.totalPct || 0);
  const p1Delta = Number(data.deltas?.p1Pct || 0);
  const p2Delta = Number(data.deltas?.p2Pct || 0);
  const spikes = Array.isArray(data.categorySpikes) ? data.categorySpikes : [];
  const slaBreach = Number(data.slaBreachActive || 0);
  // Only render when SOMETHING is anomalous (avoid noise on quiet days).
  const anomalous = totalDelta >= 25 || p1Delta >= 50 || p2Delta >= 50 || spikes.length > 0 || slaBreach >= 3;
  if (!anomalous) return null;

  const Tile = ({ label, value, suffix, accent }) => (
    <div style={{ background: "#0A0C14", borderRadius: 8, padding: "10px 12px", border: `1px solid ${accent}33`, minWidth: 110 }}>
      <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent, fontFamily: "'JetBrains Mono', monospace" }}>{value}{suffix || ""}</div>
    </div>
  );

  return (
    <div role="region" aria-label="Anomaly Alerts" style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #F59E0B44", padding: 16, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>📊</span> Anomaly Alerts
          <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 8, background: "#F59E0B22", color: "#FBBF24", fontWeight: 600 }}>vs 7-day avg</span>
        </h3>
        <button onClick={() => setActiveModule && setActiveModule("incidents")} aria-label="Open incidents module" style={{ padding: "5px 12px", borderRadius: 6, background: "#F59E0B18", border: "1px solid #F59E0B44", color: "#FBBF24", cursor: "pointer", fontSize: 10, fontWeight: 600 }}>Drill down →</button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: spikes.length ? 10 : 0 }}>
        <Tile label="Today vol" value={data.today?.total ?? 0} accent="#06B6D4" />
        <Tile label="vs avg" value={(totalDelta >= 0 ? "+" : "") + totalDelta} suffix="%" accent={totalDelta >= 25 ? "#FF6B6B" : totalDelta <= -25 ? "#22C55E" : "#A5B4FC"} />
        <Tile label="P1 today" value={data.today?.p1 ?? 0} accent={p1Delta >= 50 ? "#FF6B6B" : "#A5B4FC"} />
        <Tile label="P2 today" value={data.today?.p2 ?? 0} accent={p2Delta >= 50 ? "#FBBF24" : "#A5B4FC"} />
        <Tile label="SLA breach" value={slaBreach} accent={slaBreach >= 3 ? "#FF6B6B" : "#A5B4FC"} />
      </div>
      {spikes.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
          {spikes.slice(0, 4).map(s => (
            <div key={s.category} style={{ background: "#0A0C14", borderRadius: 8, padding: "8px 10px", border: "1px solid #F59E0B33" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#FBBF24" }}>📈 {s.category}</div>
              <div style={{ fontSize: 10, color: "#C4CAD6", marginTop: 2 }}>
                {s.today} today · avg {s.weeklyAvg}/day
                <span style={{ marginLeft: 6, color: "#FF6B6B", fontWeight: 700 }}>{s.deltaPct >= 0 ? "+" : ""}{s.deltaPct}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Phase 11.2: Incident Heatmap ──────────────────────── */
function IncidentHeatmapWidget({ incidents }) {
  const heatData = useMemo(() => {
    const cats = ["Network", "Hardware", "Software", "Email", "Security", "Database", "Cloud", "Other"];
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const grid = cats.map(() => new Array(7).fill(0));
    let maxVal = 0;
    incidents.forEach(i => {
      const d = new Date(i.createdAt || i.created || 0);
      if (isNaN(d.getTime())) return;
      let cat = i.category || "Other";
      let ci = cats.indexOf(cat);
      if (ci < 0) ci = cats.length - 1;
      const day = (d.getDay() + 6) % 7; // Mon=0
      grid[ci][day]++;
      if (grid[ci][day] > maxVal) maxVal = grid[ci][day];
    });
    // Also compute hourly distribution for the mini chart
    const hours = new Array(24).fill(0);
    incidents.forEach(i => {
      const d = new Date(i.createdAt || i.created || 0);
      if (!isNaN(d.getTime())) hours[d.getHours()]++;
    });
    return { cats, days, grid, maxVal: maxVal || 1, hours };
  }, [incidents]);

  const cellColor = (val) => {
    if (val === 0) return "#1E213033";
    const intensity = val / heatData.maxVal;
    if (intensity > 0.75) return "#FF6B6B";
    if (intensity > 0.5) return "#FFB347";
    if (intensity > 0.25) return "#06B6D4";
    return "#06B6D444";
  };

  return (
    <div role="region" aria-label="Incident Heatmap" style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", padding: 20, flex: 1, minWidth: 0 }}>
      <h3 style={{ margin: "0 0 14px", fontSize: 13, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>🗺️</span> Incident Heatmap
        <span style={{ fontSize: 10, color: "#5A6178", fontWeight: 400 }}>Category × Day</span>
      </h3>
      {/* Header row */}
      <div style={{ display: "grid", gridTemplateColumns: "70px repeat(7, 1fr)", gap: 3, marginBottom: 3 }}>
        <div />
        {heatData.days.map(d => (
          <div key={d} style={{ textAlign: "center", fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{d}</div>
        ))}
      </div>
      {/* Grid */}
      {heatData.cats.map((cat, ci) => (
        <div key={cat} style={{ display: "grid", gridTemplateColumns: "70px repeat(7, 1fr)", gap: 3, marginBottom: 3 }}>
          <div style={{ fontSize: 10, color: "#C4CAD6", display: "flex", alignItems: "center", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cat}</div>
          {heatData.grid[ci].map((val, di) => (
            <div key={di} title={`${cat} · ${heatData.days[di]}: ${val} incidents`} style={{
              height: 22, borderRadius: 3, background: cellColor(val), display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9, fontWeight: 600, color: val > 0 ? "#fff" : "transparent",
              fontFamily: "'JetBrains Mono', monospace", cursor: "default", transition: "transform 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.transform = "scale(1.15)"}
            onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
              {val > 0 ? val : ""}
            </div>
          ))}
        </div>
      ))}
      {/* Legend */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, justifyContent: "flex-end" }}>
        <span style={{ fontSize: 9, color: "#5A6178" }}>Less</span>
        {["#1E213066", "#06B6D444", "#06B6D4", "#FFB347", "#FF6B6B"].map((c, i) => (
          <div key={i} style={{ width: 14, height: 14, borderRadius: 2, background: c }} />
        ))}
        <span style={{ fontSize: 9, color: "#5A6178" }}>More</span>
      </div>
    </div>
  );
}

/* ─── Phase 11.3: AI Confidence Trend Sparklines ────────── */
function AiConfidenceWidget({ incidents }) {
  const trendData = useMemo(() => {
    const days = 14;
    const daily = [];
    const now = Date.now();
    for (let d = days - 1; d >= 0; d--) {
      const start = now - (d + 1) * 86400000;
      const end = now - d * 86400000;
      const dayIncs = incidents.filter(i => {
        const t = new Date(i.createdAt || i.created || 0).getTime();
        return t >= start && t < end && i.aiTriaged;
      });
      const avgConf = dayIncs.length > 0
        ? Math.round(dayIncs.reduce((s, i) => s + (i.aiConfidence || 0), 0) / dayIncs.length)
        : null;
      const dt = new Date(end);
      daily.push({ day: `${dt.getDate()}/${dt.getMonth() + 1}`, avgConf, count: dayIncs.length });
    }
    // Category breakdown
    const catConf = {};
    incidents.filter(i => i.aiTriaged && i.aiConfidence).forEach(i => {
      const cat = i.category || "Other";
      if (!catConf[cat]) catConf[cat] = { total: 0, count: 0 };
      catConf[cat].total += i.aiConfidence;
      catConf[cat].count++;
    });
    const catAvgs = Object.entries(catConf)
      .map(([cat, v]) => ({ cat, avg: Math.round(v.total / v.count), count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const triaged = incidents.filter(i => i.aiTriaged).length;
    const total = incidents.length;
    const overallAvg = triaged > 0
      ? Math.round(incidents.filter(i => i.aiTriaged).reduce((s, i) => s + (i.aiConfidence || 0), 0) / triaged)
      : 0;

    return { daily, catAvgs, overallAvg, triaged, total };
  }, [incidents]);

  // Sparkline SVG
  const sparkW = 280, sparkH = 50;
  const validPts = trendData.daily.filter(d => d.avgConf != null);
  const minConf = validPts.length > 0 ? Math.min(...validPts.map(d => d.avgConf)) : 0;
  const maxConf = validPts.length > 0 ? Math.max(...validPts.map(d => d.avgConf)) : 100;
  const range = (maxConf - minConf) || 1;
  const points = trendData.daily.map((d, i) => {
    if (d.avgConf == null) return null;
    const x = (i / (trendData.daily.length - 1)) * sparkW;
    const y = sparkH - ((d.avgConf - minConf) / range) * (sparkH - 6);
    return { x, y, ...d };
  }).filter(Boolean);

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const overallColor = trendData.overallAvg >= 80 ? "#4CAF50" : trendData.overallAvg >= 60 ? "#FFB347" : "#FF6B6B";

  return (
    <div role="region" aria-label="AI Confidence Trends" style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", padding: 20, flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>🎯</span> AI Confidence Trends
          <span style={{ fontSize: 10, color: "#5A6178", fontWeight: 400 }}>14-day</span>
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: overallColor, fontFamily: "'Space Grotesk', sans-serif" }}>{trendData.overallAvg}%</span>
          <span style={{ fontSize: 10, color: "#5A6178" }}>avg</span>
        </div>
      </div>
      {/* Sparkline */}
      <div style={{ background: "#0A0C14", borderRadius: 8, padding: "12px 14px", border: "1px solid #1E213044", marginBottom: 14 }}>
        <svg width="100%" height={sparkH + 10} viewBox={`-4 -4 ${sparkW + 8} ${sparkH + 12}`} preserveAspectRatio="none" style={{ display: "block" }}>
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => (
            <line key={i} x1="0" y1={sparkH - pct * (sparkH - 6)} x2={sparkW} y2={sparkH - pct * (sparkH - 6)} stroke="#1E2130" strokeWidth="0.5" />
          ))}
          {/* Area fill */}
          {points.length > 1 && (
            <path d={`${pathD} L ${points[points.length - 1].x.toFixed(1)} ${sparkH} L ${points[0].x.toFixed(1)} ${sparkH} Z`} fill="url(#confGrad)" opacity="0.3" />
          )}
          <defs><linearGradient id="confGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366F1" /><stop offset="100%" stopColor="#6366F100" /></linearGradient></defs>
          {/* Line */}
          {points.length > 1 && <path d={pathD} fill="none" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" />}
          {/* Dots */}
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="3" fill={p.avgConf >= 80 ? "#4CAF50" : p.avgConf >= 60 ? "#FFB347" : "#FF6B6B"} stroke="#0A0C14" strokeWidth="1">
              <title>{p.day}: {p.avgConf}% ({p.count} tickets)</title>
            </circle>
          ))}
        </svg>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontSize: 8, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{trendData.daily[0]?.day}</span>
          <span style={{ fontSize: 8, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{trendData.daily[trendData.daily.length - 1]?.day}</span>
        </div>
      </div>
      {/* Category breakdown */}
      <div style={{ fontSize: 11, fontWeight: 700, color: "#C4CAD6", marginBottom: 8 }}>Confidence by Category</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {trendData.catAvgs.map((c, i) => {
          const cColor = c.avg >= 80 ? "#4CAF50" : c.avg >= 60 ? "#FFB347" : "#FF6B6B";
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "#0A0C14", borderRadius: 6, border: `1px solid ${cColor}18` }}>
              <span style={{ fontSize: 10, color: "#C4CAD6", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.cat}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: cColor, fontFamily: "'JetBrains Mono', monospace", minWidth: 32, textAlign: "right" }}>{c.avg}%</span>
              <div style={{ width: 30, height: 4, background: "#1E2130", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${c.avg}%`, height: "100%", background: cColor, borderRadius: 2 }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Dashboard module — extracted from itsm-tool.jsx
// Receives all parent state/setters via ctx prop object
export default function Dashboard({ ctx }) {
  const {
    currentUser, showToast, _save, incidents, problems, changes, requests,
    assets, kbArticles, serviceCatalog, customers, users, vendors, search,
    setActiveModule, setDetailItem, setModal, setSearch,
    slaPolicy, slaTick, proactiveAlerts, dismissedProactiveAlerts, setDismissedProactiveAlerts,
    dashboardThreats, dismissedThreats, setDismissedThreats, threatEmailDraft, setThreatEmailDraft,
    graphEmails, graphCalendar, graphUnread, graphPresence,
    cardVisibility, setCardVisibility, showCardSettings, setShowCardSettings,
    dashboardEditMode, setDashboardEditMode,
    cardLayout, setCardLayout, dragState, setDragState,
    merakiData, merakiLoading, setMerakiLoading, setMerakiData,
    solarwindsData, solarwindsLoading, setSolarwindsLoading, setSolarwindsData,
    sophosData, sophosLoading, setSophosLoading, setSophosData,
    expandedMerakiOrg, setExpandedMerakiOrg,
    networkSecTab, setNetworkSecTab,
    workflowHubTab, setWorkflowHubTab,
    wfAnimStep, setWfAnimStep, wfAnimPlaying, setWfAnimPlaying,
    wsConnected, globalLastSync, globalSyncActive,
    aiActions, showAiActionsPanel, setShowAiActionsPanel,
    setTicketsSubTab, setAnalyticsSubTab,
    approvalInstances, escalationConfig,
    prodTestMode, runtimeConfig,
    aiPipelineStats,
    setVendors, softDelete,
    zdConnected, wsBridgeConnected, zdAutoStats, zdAiQueue, setZdTab,
    showAiPanel, setShowAiPanel,
    fetchCsatScores, csatLoading, csatScores,
    fetchAiActions, setIncidents,
    zdStats: _zdStats, aiConfig: _aiConfig,
  } = ctx;

// Local UI state for vendor card section
const [showVendorCard, setShowVendorCard] = useState(false);
const [showAddVendor, setShowAddVendor] = useState(false);
const [vendorDetailId, setVendorDetailId] = useState(null);

// Local UI state for workload/correlation cards
const [workloadData, setWorkloadData] = useState(null);
const [workloadLoading, setWorkloadLoading] = useState(false);
const [correlationData, setCorrelationData] = useState(null);
const [correlationLoading, setCorrelationLoading] = useState(false);

// Feature 1: AI Autopilot
const [autopilotStatus, setAutopilotStatus] = useState(null);
const [autopilotOpen, setAutopilotOpen] = useState(false);
useEffect(() => {
  fetch("/api/ai/autopilot/status", { credentials: "include" })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) setAutopilotStatus(d); })
    .catch(() => {});
}, []);

// Feature 36: AI Standup
const [standupData, setStandupData] = useState(null);
const [standupOpen, setStandupOpen] = useState(false);
useEffect(() => {
  if (!currentUser?.name) return;
  fetch("/api/ai/standup", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ engineerName: currentUser.name }) })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) setStandupData(d); })
    .catch(() => {});
}, [currentUser?.name]);

// Feature 11: Volume Forecast
const [volumeForecast, setVolumeForecast] = useState(null);
const [volumeForecastOpen, setVolumeForecastOpen] = useState(false);
useEffect(() => {
  fetch("/api/ai/forecast-volume", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}) })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) setVolumeForecast(d); })
    .catch(() => {});
}, []);

// Feature 13: Recurring Issues
const [recurringIssues, setRecurringIssues] = useState(null);
const [recurringOpen, setRecurringOpen] = useState(false);
useEffect(() => {
  fetch("/api/ai/recurring-issues", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}) })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) setRecurringIssues(d); })
    .catch(() => {});
}, []);

// Feature 15: Burnout Risk
const [burnoutRisk, setBurnoutRisk] = useState(null);
const [burnoutOpen, setBurnoutOpen] = useState(false);
useEffect(() => {
  fetch("/api/ai/burnout-risk", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}) })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) setBurnoutRisk(d); })
    .catch(() => {});
}, []);

// Feature 37: Skill Gaps
const [skillGaps, setSkillGaps] = useState(null);
const [skillGapsOpen, setSkillGapsOpen] = useState(false);
useEffect(() => {
  fetch("/api/ai/skill-gaps", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}) })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) setSkillGaps(d); })
    .catch(() => {});
}, []);

// Feature 45: Customer Health
const [customerHealth, setCustomerHealth] = useState(null);
const [customerHealthOpen, setCustomerHealthOpen] = useState(false);
useEffect(() => {
  fetch("/api/ai/customer-health", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}) })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) setCustomerHealth(d); })
    .catch(() => {});
}, []);

// Feature 48: AI Performance Report
const [perfReport, setPerfReport] = useState(null);
const [perfReportOpen, setPerfReportOpen] = useState(false);
useEffect(() => {
  fetch("/api/ai/performance-report", { credentials: "include" })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) setPerfReport(d); })
    .catch(() => {});
}, []);

// Feature 50: Config Recommendations
const [configRecs, setConfigRecs] = useState(null);
const [configRecsOpen, setConfigRecsOpen] = useState(false);
useEffect(() => {
  fetch("/api/ai/config-recommendations", { credentials: "include" })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) setConfigRecs(d); })
    .catch(() => {});
}, []);

// Feature 14: Service Degradation Early Warning
const [degradationWarnings, setDegradationWarnings] = useState(null);
const [degradationOpen, setDegradationOpen] = useState(false);
useEffect(() => {
  fetch("/api/ai/service-degradation", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}) })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) setDegradationWarnings(d); })
    .catch(() => {});
}, []);

// Feature 49: AI Self-Monitor
const [selfMonitor, setSelfMonitor] = useState(null);
const [selfMonitorOpen, setSelfMonitorOpen] = useState(false);
useEffect(() => {
  fetch("/api/ai/self-monitor", { credentials: "include" })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) setSelfMonitor(d); })
    .catch(() => {});
}, []);

// Feature 39: Peer Learning
const [peerLearning, setPeerLearning] = useState(null);
const [peerLearningOpen, setPeerLearningOpen] = useState(false);
useEffect(() => {
  fetch("/api/ai/peer-learning", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}) })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d) setPeerLearning(d); })
    .catch(() => {});
}, []);

// Shift Handoff
const [shiftHandoff, setShiftHandoff] = useState(null);
const [shiftHandoffLoading, setShiftHandoffLoading] = useState(false);
const [shiftHandoffOpen, setShiftHandoffOpen] = useState(false);

// (#2 follow-up, 2026-05-03) live system status from /api/status — replaces
// the hardcoded System Health array. Refreshes every 60s. Falls back to the
// static placeholders if the fetch fails.
const [systemStatus, setSystemStatus] = useState(null);
useEffect(() => {
  let cancelled = false;
  const load = async () => {
    try {
      const r = await fetch("/api/status");
      if (!r.ok) return;
      const d = await r.json();
      if (!cancelled) setSystemStatus(d);
    } catch { /* ignore — keep last value */ }
  };
  load();
  const id = setInterval(load, 60000);
  return () => { cancelled = true; clearInterval(id); };
}, []);

// API helpers (relative paths, no base URL needed)
const API = "";
const authHeaders = () => ({ "Content-Type": "application/json" });

const zdStats = _zdStats || { open: 0, pending: 0, hold: 0, solved: 0 };
const aiConfig = _aiConfig || { automationLevel: 0, humanLoopPct: 0 };

const role = currentUser.rbacRole;
const isEditAdmin = !!(currentUser && ["VGC Dev Admin", "Tenant Admin", "Administrator"].includes(role));
const isEntraProductionUser = !!(currentUser && currentUser.authType === "entra");
const isManagement = ["VGC Dev Admin", "Tenant Admin", "Administrator", "Service Desk Lead", "Change Manager", "Problem Manager", "Asset Manager"].includes(role);
const isEngineer = ["L1 Support Engineer", "L2 Support Engineer", "Network Engineer"].includes(role);

// Shared metrics
const openInc = incidents.filter(i => i.status !== "Resolved" && i.status !== "Closed").length;
const critInc = incidents.filter(i => i.priority === "Sev-A" && i.status !== "Resolved").length;
const highInc = incidents.filter(i => i.priority === "Sev-B" && i.status !== "Resolved").length;
// Phase 8 — exclude historicalClose / archived / orphan rows from SLA scope so dashboard
// matches the SLAModule scope (no more 36% inflated by stale untracked tickets).
const _ninetyDaysMs = 90 * 86400000;
const _isOrphan = (i) => {
  if (i.zdTicketId) return false;
  const c = new Date(i.createdAt || i.created || 0);
  if (isNaN(c.getTime())) return true;
  if (Date.now() - c.getTime() < _ninetyDaysMs) return false;
  return !Array.isArray(i.activityLog) || i.activityLog.length === 0;
};
const activeWithSla = incidents.filter(i =>
  i.status !== "Resolved" && i.status !== "Closed" &&
  !i.historicalClose && !i.archived && !_isOrphan(i)
);
const slaBreaches = activeWithSla.filter(i => computeIncidentSla(i).isBreached).length;
const pendingApprovals = changes.filter(c => c.status === "Awaiting Approval").length + requests.filter(r => r.status === "Pending Approval").length;
const resolvedThisWeek = incidents.filter(i => i.status === "Resolved").length;
const totalIncidents = incidents.length;
const aiTriagedCount = incidents.filter(i => i.aiTriaged).length;
const aiTriagedPct = totalIncidents > 0 ? Math.round((aiTriagedCount / totalIncidents) * 100) : 0;
const avgConfidence = totalIncidents > 0 ? Math.round(incidents.reduce((s, i) => s + (i.aiConfidence || 0), 0) / totalIncidents) : 0;
const slaCompliance = activeWithSla.length > 0 ? Math.round(((activeWithSla.length - slaBreaches) / activeWithSla.length) * 100) : 100;

// AI Performance KPI — computed from real data
const kbSuggestPct = (() => { const withKb = incidents.filter(i => i.kbSuggested || (i.aiSuggestions && i.aiSuggestions.length > 0)); return totalIncidents > 0 ? Math.round((withKb.length / totalIncidents) * 100) : 0; })();
const autoAssignAccuracy = (() => { const aiAssigned = incidents.filter(i => i.aiTriaged && i.assignee); const kept = aiAssigned.filter(i => !i.reassigned); return aiAssigned.length > 0 ? Math.round((kept.length / aiAssigned.length) * 100) : 0; })();
const slaPredictAccuracy = (() => { const slaActions = aiActions.filter(a => a.type === "sla_prevention"); if (slaActions.length === 0) return slaCompliance; const accurate = slaActions.filter(a => a.status === "approved" || a.status === "auto_applied"); return Math.round((accurate.length / slaActions.length) * 100); })();
const sentimentPct = (() => { const withSent = incidents.filter(i => i.sentiment || i.aiSentiment); return totalIncidents > 0 ? Math.round((withSent.length / totalIncidents) * 100) : 0; })();
const slaAtRiskCount = (() => { const riskActions = aiActions.filter(a => a.type === "sla_prevention" && a.status === "pending_approval" && (a.breachProbability || 0) >= 70); return riskActions.length; })();
const lastAiActionTime = (() => { const sorted = [...aiActions].filter(a => a.createdAt).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); return sorted.length > 0 ? sorted[0].createdAt : null; })();
const lastAiActionLabel = (() => { if (!lastAiActionTime) return "No activity"; const diff = Date.now() - new Date(lastAiActionTime).getTime(); if (diff < 60000) return "Just now"; if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`; if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`; return `${Math.round(diff / 86400000)}d ago`; })();

// Zendesk ↔ ITSM sync metrics
const zdLinkedCount = incidents.filter(i => i.zdTicketId).length;
const zdTotalLive = zdStats.open + zdStats.pending + zdStats.hold + zdStats.solved;
const zdUnlinked = Math.max(0, zdTotalLive - zdLinkedCount);

// Computed metrics (from real data, not hardcoded)
const resolvedIncs = incidents.filter(i => i.status === "Resolved" || i.status === "Closed");
const computedMTTR = computeMTTR(resolvedIncs);
const computedFCR = totalIncidents > 0 ? Math.round((resolvedIncs.length / totalIncidents) * 100) : 0;

// Engineer-specific
const myTickets = incidents.filter(i => i.assignee === currentUser.name && i.status !== "Resolved" && i.status !== "Closed");
const myResolved = incidents.filter(i => i.assignee === currentUser.name && i.status === "Resolved").length;

// Security alerts mock
const securityAlerts = SECURITY_ALERTS;
const sevColors = { Critical: "#FF4444", High: "#FF6B6B", Medium: "#FFB347", Low: "#64B5F6" };

// Donut chart component
const DonutKPI = ({ value, max, label, color, sub }) => (
  <div style={{ textAlign: "center", padding: 16, background: "#0A0C14", borderRadius: 8, border: "1px solid #1E213044" }}>
    <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 8 }}>{label}</div>
    <div style={{ position: "relative", width: 72, height: 72, margin: "0 auto 8px" }}>
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r="30" fill="none" stroke="#1E2130" strokeWidth="5" />
        <circle cx="36" cy="36" r="30" fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${(value / (max || 1)) * 188.5} 188.5`}
          strokeLinecap="round" transform="rotate(-90 36 36)" style={{ transition: "stroke-dasharray 0.6s" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color, fontFamily: "'Space Grotesk', sans-serif" }}>{value}{typeof max === "number" && max <= 100 ? "%" : ""}</div>
    </div>
    {sub && <div style={{ fontSize: 10, color: color + "CC", fontWeight: 600 }}>{sub}</div>}
  </div>
);

const isAdmin = currentUser.rbacRole === "VGC Dev Admin" || currentUser.rbacRole === "Administrator" || currentUser.rbacRole === "Tenant Admin";
const isDevAdmin = currentUser.rbacRole === "VGC Dev Admin";
const canToggle = (cardId) => {
  const card = cardVisibility[cardId];
  if (!card) return false;
  if (isDevAdmin) return true;
  if (card.important) return isAdmin;
  return true;
};
const toggleCard = (cardId) => {
  if (!canToggle(cardId)) return;
  setCardVisibility(prev => ({ ...prev, [cardId]: { ...prev[cardId], on: !prev[cardId].on } }));
};

// ─── Draggable/Resizable Card Wrapper ────────────────────────────
const cardOrder = cardLayout.order || [];
const moveCard = (cardId, dir) => {
  const allCardIds = Object.keys(cardVisibility);
  const current = cardOrder.length > 0 ? [...cardOrder] : [...allCardIds];
  const idx = current.indexOf(cardId);
  if (idx < 0) { current.push(cardId); return; }
  const target = idx + dir;
  if (target < 0 || target >= current.length) return;
  [current[idx], current[target]] = [current[target], current[idx]];
  setCardLayout(prev => ({ ...prev, order: current }));
};
const cardSizes = cardLayout.sizes || {};
const cycleSize = (cardId) => {
  const sizes = ["normal", "compact", "expanded"];
  const cur = cardSizes[cardId] || "normal";
  const next = sizes[(sizes.indexOf(cur) + 1) % sizes.length];
  setCardLayout(prev => ({ ...prev, sizes: { ...prev.sizes, [cardId]: next } }));
};
const getCardSize = (cardId) => cardSizes[cardId] || "normal";
const DashCard = ({ id, children, noPad }) => {
  const size = getCardSize(id);
  return (
    <div style={{
      position: "relative",
      transform: size === "compact" ? "scale(0.95)" : size === "expanded" ? "none" : "none",
      transformOrigin: "top left",
      transition: "all 0.25s ease",
      marginBottom: size === "compact" ? 12 : 20,
    }}>
      {dashboardEditMode && (
        <div style={{
          position: "absolute", top: -10, right: 0, zIndex: 10, display: "flex", gap: 4,
          background: "#0F1117", border: "1px solid #6366F144", borderRadius: 6, padding: "3px 6px",
          boxShadow: "0 2px 8px #00000044"
        }}>
          <button onClick={() => moveCard(id, -1)} title="Move up" style={{ border: "none", background: "none", color: "#6366F1", cursor: "pointer", fontSize: 12, padding: "2px 4px" }}>▲</button>
          <button onClick={() => moveCard(id, 1)} title="Move down" style={{ border: "none", background: "none", color: "#6366F1", cursor: "pointer", fontSize: 12, padding: "2px 4px" }}>▼</button>
          <button onClick={() => cycleSize(id)} title={`Size: ${size}`} style={{ border: "none", background: "none", color: "#FFB347", cursor: "pointer", fontSize: 10, padding: "2px 4px", fontFamily: "'JetBrains Mono', monospace" }}>
            {size === "compact" ? "▫" : size === "expanded" ? "▣" : "◻"}
          </button>
          <button onClick={() => toggleCard(id)} title="Hide card" style={{ border: "none", background: "none", color: "#FF6B6B", cursor: "pointer", fontSize: 12, padding: "2px 4px" }}>✕</button>
        </div>
      )}
      {dashboardEditMode && (
        <div style={{ position: "absolute", inset: 0, border: "2px dashed #6366F133", borderRadius: 10, pointerEvents: "none", zIndex: 5 }} />
      )}
      {children}
    </div>
  );
};

const [dashExplainCard, setDashExplainCard] = useState(null);

const CardHeader = ({ cardId, children }) => {
  const explainer = AI_FEATURE_EXPLAINERS[cardId];
  return (
  <div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>{children}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {explainer && (
          <button onClick={() => setDashExplainCard(dashExplainCard === cardId ? null : cardId)} title="AI Explain this feature" style={{
            background: dashExplainCard === cardId ? "#6366F122" : "transparent", border: `1px solid ${dashExplainCard === cardId ? "#6366F166" : "#1E213066"}`,
            borderRadius: 6, padding: "2px 7px", cursor: "pointer", fontSize: 10, color: dashExplainCard === cardId ? "#6366F1" : "#5A6178",
            display: "flex", alignItems: "center", gap: 3, transition: "all 0.2s", fontFamily: "'Space Grotesk', sans-serif"
          }}>🤖 AI</button>
        )}
        {(canToggle(cardId) || isAdmin || isDevAdmin) && (
          <button onClick={() => toggleCard(cardId)} title={canToggle(cardId) ? "Toggle card visibility" : "Admin only"} style={{
            width: 32, height: 18, borderRadius: 9, border: "none", cursor: canToggle(cardId) ? "pointer" : "not-allowed",
            background: cardVisibility[cardId]?.on ? "#4CAF50" : "#3A3F55", position: "relative", transition: "background 0.2s", opacity: canToggle(cardId) ? 1 : 0.4
          }}>
            <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: cardVisibility[cardId]?.on ? 16 : 2, transition: "left 0.2s" }} />
          </button>
        )}
      </div>
    </div>
    {dashExplainCard === cardId && explainer && (
      <div style={{ margin: "8px 0 4px", padding: "10px 14px", background: "linear-gradient(135deg, #6366F108, #6366F115)", borderRadius: 8, border: "1px solid #6366F133" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#6366F1", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1 }}>🤖 {explainer.title}</div>
        <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.6 }}>{explainer.explain}</div>
      </div>
    )}
  </div>
  );
};

return (
  <div role="main" aria-label="ITSM Dashboard" className="vgc-dash">
    {/* Phase 11.4: Keyboard focus & accessibility */}
    <style>{`
      .vgc-dash button:focus-visible, .vgc-dash [role="button"]:focus-visible, .vgc-dash a:focus-visible {
        outline: 2px solid #6366F1; outline-offset: 2px; border-radius: 4px;
      }
      .vgc-dash [role="listitem"]:focus-visible { outline: 2px solid #6366F1; outline-offset: 1px; }
      @media (prefers-reduced-motion: reduce) { body.vgc-reduce-motion .vgc-dash * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
    `}</style>
    {/* ═══ VGC HELPDESK CONTACT — Always Visible ═══ */}
    <div style={{
      background: "linear-gradient(135deg, #0078D412, #6366F112, #06B6D412)", borderRadius: 10,
      border: "1px solid #0078D433", padding: "12px 20px", marginBottom: 16,
      display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 38, height: 38, borderRadius: 8, background: "linear-gradient(135deg, #0078D4, #6366F1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📞</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>VGC Helpdesk</div>
          <div style={{ fontSize: 10, color: "#8B8FA3" }}>Central IT Support Contact</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13 }}>📧</span>
          <a href="mailto:help@vgctechnology.com" style={{ fontSize: 12, color: "#64B5F6", textDecoration: "none", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>help@vgctechnology.com</a>
        </div>
        <div style={{ width: 1, height: 16, background: "#1E2130" }}/>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13 }}>☎️</span>
          <a href="tel:+6569781299" style={{ fontSize: 12, color: "#81C784", textDecoration: "none", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>+65 6978 1299</a>
        </div>
        <div style={{ width: 1, height: 16, background: "#1E2130" }}/>
        <div style={{ padding: "4px 10px", borderRadius: 5, background: "#FF6B6B18", border: "1px solid #FF6B6B33" }}>
          <span style={{ fontSize: 10, color: "#FF6B6B", fontWeight: 600 }}>⚠️ Always call for Sev-A / Urgent cases</span>
        </div>
        <div style={{ width: 1, height: 16, background: "#1E2130" }}/>
        <button onClick={() => setShowVendorCard(!showVendorCard)} style={{
          display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 6,
          background: showVendorCard ? "#FFB34722" : "#ffffff06", border: "1px solid " + (showVendorCard ? "#FFB34744" : "#1E2130"),
          color: showVendorCard ? "#FFB347" : "#8B8FA3", cursor: "pointer", fontSize: 10, fontWeight: 600
        }}>📋 Product Vendors Contact</button>
      </div>
    </div>

    {/* ═══ PRODUCT VENDORS REFERENCE CARD ═══ */}
    {showVendorCard && (
      <div style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #FFB34733", padding: 20, marginBottom: 16, position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>📋</span>
            <h3 style={{ margin: 0, fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>Product Vendors Contact</h3>
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#FFB34718", color: "#FFB347" }}>Quick Reference</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {isEditAdmin && (
              <button onClick={() => setShowAddVendor(!showAddVendor)} style={{ padding: "4px 10px", borderRadius: 5, background: "#6366F118", border: "1px solid #6366F133", color: "#6366F1", cursor: "pointer", fontSize: 10, fontWeight: 600 }}>{showAddVendor ? "✕ Cancel" : "＋ Add Vendor"}</button>
            )}
            <button onClick={() => setShowVendorCard(false)} style={{ background: "none", border: "none", color: "#5A6178", cursor: "pointer", fontSize: 14 }}>✕</button>
          </div>
        </div>
        {/* Add Vendor Form */}
        {showAddVendor && isEditAdmin && (
          <div style={{ background: "#0A0C14", borderRadius: 8, border: "1px solid #6366F122", padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#E8ECF4", marginBottom: 10 }}>➕ New Vendor Entry</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
              <input id="vnd-name" placeholder="Vendor Name *" style={{ padding: "6px 10px", borderRadius: 5, border: "1px solid #1E2130", background: "#0F1117", color: "#E8ECF4", fontSize: 11, outline: "none" }}/>
              <input id="vnd-email" placeholder="Support Email" style={{ padding: "6px 10px", borderRadius: 5, border: "1px solid #1E2130", background: "#0F1117", color: "#E8ECF4", fontSize: 11, outline: "none" }}/>
              <input id="vnd-phone" placeholder="Support Phone" style={{ padding: "6px 10px", borderRadius: 5, border: "1px solid #1E2130", background: "#0F1117", color: "#E8ECF4", fontSize: 11, outline: "none" }}/>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <input id="vnd-category" placeholder="Category (e.g. Cloud, Security)" style={{ padding: "6px 10px", borderRadius: 5, border: "1px solid #1E2130", background: "#0F1117", color: "#E8ECF4", fontSize: 11, outline: "none" }}/>
              <input id="vnd-response" placeholder="Response Expectations" style={{ padding: "6px 10px", borderRadius: 5, border: "1px solid #1E2130", background: "#0F1117", color: "#E8ECF4", fontSize: 11, outline: "none" }}/>
            </div>
            <textarea id="vnd-sop" placeholder="Escalation SOP (step by step)" rows={2} style={{ width: "100%", padding: "6px 10px", borderRadius: 5, border: "1px solid #1E2130", background: "#0F1117", color: "#E8ECF4", fontSize: 11, outline: "none", resize: "vertical", boxSizing: "border-box", marginBottom: 8 }}/>
            <button onClick={() => {
              const n = document.getElementById("vnd-name")?.value?.trim();
              if (!n) return;
              const nv = { id: genId("V"), name: n, category: document.getElementById("vnd-category")?.value || "", supportEmail: document.getElementById("vnd-email")?.value || "", supportPhone: document.getElementById("vnd-phone")?.value || "", escalationSOP: document.getElementById("vnd-sop")?.value || "", docLinks: [], responseExpectation: document.getElementById("vnd-response")?.value || "", notes: "" };
              const updated = [...vendors, nv]; setVendors(updated); _save("vgc_vendors", updated); setShowAddVendor(false);
            }} style={{ padding: "6px 16px", borderRadius: 5, background: "#6366F1", color: "#fff", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>Add Vendor</button>
          </div>
        )}
        {/* Vendor List */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {vendors.map(v => (
            <div key={v.id} style={{ background: "#0A0C14", borderRadius: 8, border: "1px solid #1E2130", padding: "12px 16px", cursor: "pointer", transition: "all 0.2s" }}
              onClick={() => setVendorDetailId(vendorDetailId === v.id ? null : v.id)}
              onMouseEnter={e => e.currentTarget.style.borderColor = "#0078D444"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "#1E2130"}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4" }}>{v.name}</div>
                <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "#0078D418", color: "#0078D4" }}>{v.category}</span>
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#8B8FA3" }}>
                {v.supportEmail && <span>📧 {v.supportEmail}</span>}
                {v.supportPhone && <span>☎️ {v.supportPhone}</span>}
              </div>
              {v.responseExpectation && <div style={{ fontSize: 9, color: "#06B6D4", marginTop: 4 }}>⏱️ {v.responseExpectation}</div>}
              {/* Expanded Detail */}
              {vendorDetailId === v.id && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #1E2130" }} onClick={e => e.stopPropagation()}>
                  {v.escalationSOP && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "#FFB347", marginBottom: 4 }}>📋 Escalation SOP</div>
                      <div style={{ fontSize: 10, color: "#C4CAD6", whiteSpace: "pre-wrap", lineHeight: 1.5, background: "#0F1117", borderRadius: 4, padding: 8 }}>{v.escalationSOP}</div>
                    </div>
                  )}
                  {v.docLinks && v.docLinks.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "#64B5F6", marginBottom: 4 }}>🔗 Documentation</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {v.docLinks.map((d, i) => <a key={i} href={d.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#64B5F6", textDecoration: "none", padding: "2px 8px", borderRadius: 4, background: "#64B5F608", border: "1px solid #64B5F622" }}>{d.label} ↗</a>)}
                      </div>
                    </div>
                  )}
                  {v.notes && <div style={{ fontSize: 9, color: "#5A6178", fontStyle: "italic" }}>📝 {v.notes}</div>}
                  {(currentUser.rbacRole === "VGC Dev Admin" || currentUser.rbacRole === "Tenant Admin") && (
                    <button onClick={() => { softDelete("vendors", v, setVendors, "vgc_vendors"); setVendorDetailId(null); }} style={{ marginTop: 6, padding: "3px 10px", borderRadius: 4, background: "#FF6B6B11", border: "1px solid #FF6B6B33", color: "#FF6B6B", fontSize: 9, cursor: "pointer" }}>🗑️ Remove Vendor</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {/* AI Vendor Guidance */}
        <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 6, background: "linear-gradient(135deg, #6366F108, #06B6D408)", border: "1px solid #6366F122" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#6366F1", marginBottom: 4 }}>🤖 AI Vendor Guidance</div>
          <div style={{ fontSize: 10, color: "#8B8FA3", lineHeight: 1.5 }}>AI Assist automatically references vendor SOPs based on case nature and urgency. During incident triage, AI will suggest when vendor escalation is required and provide official references and correct links to guide engineers. Goal: correct action, first time — SLA-compliant escalation, faster resolution.</div>
        </div>
      </div>
    )}

    {/* Role indicator + Personalize button */}
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
      <div style={{ fontSize: 11, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>DASHBOARD VIEW:</div>
      <div style={{ padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: isManagement ? "#6366F122" : "#06B6D422", color: isManagement ? "#6366F1" : "#06B6D4", fontFamily: "'JetBrains Mono', monospace" }}>
        {isManagement ? "MANAGEMENT" : isEngineer ? "ENGINEER" : role.toUpperCase()}
      </div>
      <div style={{ fontSize: 11, color: "#3A3F55" }}>|</div>
      <div style={{ fontSize: 11, color: "#5A6178" }}>{currentUser.name} · {role}</div>
      <button onClick={() => setDashboardEditMode(!dashboardEditMode)} style={{
        marginLeft: 6, display: "flex", alignItems: "center", gap: 6,
        padding: "5px 12px", borderRadius: 6, border: dashboardEditMode ? "1px solid #FFB34766" : "1px solid #1E2130", background: dashboardEditMode ? "#FFB34722" : "#0F1117",
        color: dashboardEditMode ? "#FFB347" : "#5A6178", cursor: "pointer", fontSize: 11, fontFamily: "'JetBrains Mono', monospace"
      }}>
        {dashboardEditMode ? "✓ Done Editing" : "✏️ Edit Layout"}
      </button>
      <button onClick={() => setShowCardSettings(!showCardSettings)} style={{
        marginLeft: "auto", display: "flex", alignItems: "center", gap: 6,
        padding: "5px 12px", borderRadius: 6, border: "1px solid #1E2130", background: showCardSettings ? "#6366F122" : "#0F1117",
        color: showCardSettings ? "#6366F1" : "#5A6178", cursor: "pointer", fontSize: 11, fontFamily: "'JetBrains Mono', monospace"
      }}>
        ⚙️ Personalize
      </button>
    </div>

    {/* Card Personalization Panel */}
    {showCardSettings && (
      <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #6366F133", padding: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
            ⚙️ Dashboard Card Personalization
          </h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isAdmin && <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#EC489922", color: "#EC4899", fontFamily: "'JetBrains Mono', monospace" }}>ADMIN — Can toggle important cards</span>}
            {isDevAdmin && <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#4CAF5022", color: "#4CAF50", fontFamily: "'JetBrains Mono', monospace" }}>DEV ADMIN — Full access</span>}
            {!isAdmin && !isDevAdmin && <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#1E2130", color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>🔒 Important cards locked by Admin</span>}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {Object.entries(cardVisibility).filter(([, c]) => {
            if (c.roles.includes("all")) return true;
            if (isManagement && c.roles.includes("management")) return true;
            if (isEngineer && c.roles.includes("engineer")) return true;
            return false;
          }).map(([id, card]) => (
            <div key={id} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 12px", background: "#0A0C14", borderRadius: 6,
              border: `1px solid ${card.important ? "#FF444422" : "#1E213044"}`,
              opacity: canToggle(id) ? 1 : 0.6
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {card.important && <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 3, background: "#FF444422", color: "#FF6B6B", fontFamily: "'JetBrains Mono', monospace" }}>IMPORTANT</span>}
                <span style={{ fontSize: 11, color: "#C4CAD6" }}>{card.label}</span>
              </div>
              <button onClick={() => toggleCard(id)} disabled={!canToggle(id)} style={{
                width: 32, height: 18, borderRadius: 9, border: "none",
                cursor: canToggle(id) ? "pointer" : "not-allowed",
                background: card.on ? "#4CAF50" : "#3A3F55", position: "relative", transition: "background 0.2s"
              }}>
                <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: card.on ? 16 : 2, transition: "left 0.2s" }} />
              </button>
            </div>
          ))}
        </div>
      </div>
    )}

    {/* ═══ MANAGEMENT VIEW ═══ */}
    {isManagement && (<>
      {/* Executive KPI Row */}
      {cardVisibility.execKpis.on && <div className="vgc-kpi-grid-6" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total Cases", value: totalIncidents, icon: "📊", accent: "#6366F1", trend: `${zdLinkedCount} from Zendesk`, link: "incidents" },
          { label: "Open Cases", value: openInc, icon: "📂", accent: "#FF6B6B", trend: critInc > 0 ? `${critInc} critical` : "0 critical", critical: critInc > 0, link: "incidents" },
          { label: "SLA Compliance", value: `${slaCompliance}%`, icon: "⏱️", accent: slaCompliance >= 90 ? "#4CAF50" : slaCompliance >= 75 ? "#FFB347" : "#FF4444", trend: slaCompliance >= 90 ? "On Track" : "At Risk", critical: slaCompliance < 75, link: "sla" },
          { label: "MTTR (hrs)", value: computedMTTR, icon: "🔧", accent: "#06B6D4", trend: `${resolvedIncs.length} resolved`, link: "reports" },
          { label: "Resolution Rate", value: `${computedFCR}%`, icon: "🎯", accent: "#81C784", trend: `${resolvedIncs.length}/${totalIncidents} cases`, link: "reports" },
          { label: "AI Triaged", value: `${aiTriagedPct}%`, icon: "🤖", accent: "#EC4899", trend: `${aiTriagedCount} of ${totalIncidents}`, link: "zendesk" },
        ].map((kpi, i) => (
          <div key={i} onClick={() => kpi.link && setActiveModule(kpi.link)} style={{ background: kpi.critical ? "#1A080811" : "#0F1117", borderRadius: 8, border: kpi.critical ? "1px solid #FF444444" : "1px solid #1E2130", padding: "14px 16px", position: "relative", overflow: "hidden", animation: kpi.critical ? "criticalGlow 2s ease-in-out infinite" : "none", cursor: kpi.link ? "pointer" : "default", transition: "transform 0.15s, border-color 0.2s" }}
            onMouseEnter={e => { if (kpi.link) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = kpi.accent + "55"; } }}
            onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = kpi.critical ? "#FF444444" : "#1E2130"; }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: kpi.critical ? 3 : 2, background: kpi.accent }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.5px" }}>{kpi.label}</span>
              <span style={{ fontSize: 16 }}>{kpi.icon}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: kpi.critical ? "#FF6B6B" : "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", marginBottom: 4 }}>{kpi.value}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 10, color: kpi.accent, fontWeight: 500 }}>{kpi.trend}</div>
              {kpi.link && <span style={{ fontSize: 10, color: "#5A617866", fontFamily: "'JetBrains Mono', monospace" }}>→</span>}
            </div>
          </div>
        ))}
      </div>}

      {/* ═══ ZENDESK ↔ ITSM SYNC STATUS ═══ */}
      {cardVisibility.zdSync.on && <DashCard id="zdSync"><div style={{ background: "#0F1117", borderRadius: 10, border: `1px solid ${zdConnected ? "#EC489933" : "#FF6B6B33"}`, padding: 20, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, #EC4899, #6366F1, #06B6D4)" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>🎫</span> Zendesk ↔ ITSM Sync
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 8, background: zdConnected ? "#4CAF5022" : "#FF444422", color: zdConnected ? "#4CAF50" : "#FF4444", fontWeight: 600 }}>
              {zdConnected ? "CONNECTED" : "OFFLINE"}
            </span>
            {globalSyncActive && <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 8, background: "#06B6D418", color: "#06B6D4", fontWeight: 600, animation: "pulse 1s infinite" }}>⟳ SYNCING</span>}
            <span title={wsBridgeConnected ? "Real-time push active — updates appear instantly" : "Real-time push offline — falling back to 60s polling"} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 8, background: wsBridgeConnected ? "#4CAF5022" : "#5A617822", color: wsBridgeConnected ? "#4CAF50" : "#5A6178", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
              {wsBridgeConnected ? "● LIVE" : "○ POLL"}
            </span>
          </h3>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {globalLastSync && <span style={{ fontSize: 9, color: "#5A617888", fontFamily: "'JetBrains Mono', monospace" }}>Last: {globalLastSync.toLocaleTimeString("en-SG", { hour12: false })}</span>}
            <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#06B6D411", color: "#06B6D4", fontFamily: "'JetBrains Mono', monospace" }}>Auto 60s</span>
            <button onClick={() => setActiveModule("zendesk")} style={{ padding: "5px 12px", borderRadius: 6, background: "#EC489918", border: "1px solid #EC489933", color: "#EC4899", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>Open Zendesk AI →</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          {[
            { label: "ZD Open", value: zdStats.open, accent: "#64B5F6", icon: "📂", source: "Zendesk", zdTab: "tickets" },
            { label: "ZD Pending", value: zdStats.pending, accent: "#FFB347", icon: "⏳", source: "Zendesk", zdTab: "tickets" },
            { label: "ZD On Hold", value: zdStats.hold, accent: "#FF6B6B", icon: "⏸️", source: "Zendesk", zdTab: "tickets" },
            { label: "ZD Solved", value: zdStats.solved, accent: "#81C784", icon: "✅", source: "Zendesk", zdTab: "tickets" },
            { label: "ITSM Total", value: totalIncidents, accent: "#6366F1", icon: "🎫", source: "ITSM" },
            { label: "ZD Linked", value: zdLinkedCount, accent: "#06B6D4", icon: "🔗", source: "Synced", zdTab: "sync" },
            { label: "AI Triaged", value: zdAutoStats.totalTriaged, accent: "#EC4899", icon: "🤖", source: "AI", zdTab: "analytics" },
            { label: "Pending Review", value: zdAiQueue.filter(q => q.status === "pending_approval").length, accent: "#FFB347", icon: "👤", source: "Queue", zdTab: "queue" },
          ].map((s, i) => (
            <div key={i} onClick={() => { if (s.source === "ITSM") { setActiveModule("incidents"); } else { setActiveModule("zendesk"); if (s.zdTab) setTimeout(() => setZdTab(s.zdTab), 50); } }} style={{ padding: "10px 12px", background: "#0A0C14", borderRadius: 8, border: `1px solid ${s.accent}22`, cursor: "pointer", transition: "all 0.2s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = s.accent + "55"; e.currentTarget.style.transform = "translateY(-1px)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = s.accent + "22"; e.currentTarget.style.transform = "translateY(0)"; }}>
              <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3, display: "flex", justifyContent: "space-between" }}>
                <span>{s.icon} {s.label}</span>
                <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: s.accent + "18", color: s.accent }}>{s.source}</span>
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.accent, fontFamily: "'Space Grotesk', sans-serif" }}>{s.value}</div>
            </div>
          ))}
        </div>
        {zdUnlinked > 0 && <div style={{ marginTop: 10, padding: "8px 14px", borderRadius: 6, background: "#FFB34708", border: "1px solid #FFB34722", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12 }}>⚠️</span>
          <span style={{ fontSize: 11, color: "#FFB347" }}>{zdUnlinked} Zendesk ticket(s) not yet imported to ITSM.</span>
          <button onClick={() => { setActiveModule("zendesk"); setTimeout(() => setZdTab && setZdTab("sync"), 50); }} style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: 4, background: "#EC489918", border: "1px solid #EC489933", color: "#EC4899", cursor: "pointer", fontSize: 9, fontWeight: 600 }}>Import →</button>
        </div>}
      </div></DashCard>}

      {/* Case Analysis & SLA Breakdown */}
      {(cardVisibility.caseAnalysis.on || cardVisibility.priorityDist.on || cardVisibility.slaStatus.on) && <div className="vgc-kpi-grid-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
        {/* Case Volume by Category */}
        <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20 }}>
          <h3 onClick={() => setActiveModule("incidents")} style={{ margin: "0 0 16px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.color = "#6366F1"} onMouseLeave={e => e.currentTarget.style.color = "#E8ECF4"}>
            <span style={{ color: "#6366F1" }}>📊</span> Case Analysis by Category <span style={{ fontSize: 10, color: "#5A617866", marginLeft: "auto" }}>View All →</span>
          </h3>
          {["Email", "Network", "Hardware", "Software", "Database", "Security"].map((cat, i) => {
            const count = incidents.filter(inc => inc.category === cat).length;
            const maxC = Math.max(3, ...["Email", "Network", "Hardware", "Software", "Database", "Security"].map(c => incidents.filter(inc => inc.category === c).length));
            const colors = ["#6366F1", "#06B6D4", "#81C784", "#FFB347", "#EC4899", "#FF6B6B"];
            return (
              <div key={cat} onClick={() => setActiveModule("incidents")} style={{ marginBottom: 10, cursor: "pointer", padding: "2px 4px", borderRadius: 4, transition: "background 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.background = colors[i] + "08"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                  <span style={{ color: "#C4CAD6" }}>{cat}</span>
                  <span style={{ color: colors[i], fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{count}</span>
                </div>
                <div style={{ background: "#0A0C14", borderRadius: 3, height: 6, overflow: "hidden" }}>
                  <div style={{ width: `${(count / maxC) * 100}%`, height: "100%", background: `linear-gradient(90deg, ${colors[i]}, ${colors[i]}88)`, borderRadius: 3, minWidth: count > 0 ? 4 : 0, transition: "width 0.4s" }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Priority Distribution */}
        <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20 }}>
          <h3 onClick={() => setActiveModule("incidents")} style={{ margin: "0 0 16px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.color = "#FF6B6B"} onMouseLeave={e => e.currentTarget.style.color = "#E8ECF4"}>
            <span style={{ color: "#FF6B6B" }}>🔥</span> Priority Distribution <span style={{ fontSize: 10, color: "#5A617866", marginLeft: "auto" }}>View All →</span>
          </h3>
          {["Sev-A", "Sev-B", "Sev-C", "Sev-D"].map(p => {
            const count = incidents.filter(i => i.priority === p).length;
            const pColor = PRIORITY_COLORS[p]?.dot || "#5A6178";
            return (
              <div key={p} onClick={() => setActiveModule("incidents")} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "8px 12px", background: "#0A0C14", borderRadius: 6, border: `1px solid ${pColor}22`, cursor: "pointer", transition: "background 0.15s, border-color 0.2s" }}
                onMouseEnter={e => { e.currentTarget.style.background = pColor + "0A"; e.currentTarget.style.borderColor = pColor + "44"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "#0A0C14"; e.currentTarget.style.borderColor = pColor + "22"; }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: pColor, boxShadow: `0 0 6px ${pColor}66` }} />
                <span style={{ flex: 1, fontSize: 12, color: "#C4CAD6" }}>{p}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: pColor, fontFamily: "'Space Grotesk', sans-serif" }}>{count}</span>
                <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", width: 36, textAlign: "right" }}>{totalIncidents > 0 ? Math.round((count / totalIncidents) * 100) : 0}%</span>
                <span style={{ fontSize: 10, color: "#5A617844" }}>→</span>
              </div>
            );
          })}
        </div>

        {/* SLA by Priority */}
        <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20 }}>
          <h3 onClick={() => setActiveModule("sla")} style={{ margin: "0 0 16px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.color = "#FFB347"} onMouseLeave={e => e.currentTarget.style.color = "#E8ECF4"}>
            <span style={{ color: "#FFB347" }}>⏱️</span> SLA Status by Priority <span style={{ fontSize: 10, color: "#5A617866", marginLeft: "auto" }}>View All →</span>
          </h3>
          {[
            { priority: "Sev-A", target: "4 biz hrs", met: critInc === 0 ? 100 : 50, breached: critInc > 0 ? 1 : 0 },
            { priority: "Sev-B", target: "4 biz hrs", met: 85, breached: slaBreaches > 0 ? 1 : 0 },
            { priority: "Sev-C", target: "9 biz hrs", met: 95, breached: 0 },
            { priority: "Sev-D", target: "27 biz hrs", met: 100, breached: 0 },
          ].map(s => {
            const barColor = s.met >= 90 ? "#4CAF50" : s.met >= 75 ? "#FFB347" : "#FF4444";
            return (
              <div key={s.priority} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                  <span style={{ color: "#C4CAD6" }}>{s.priority} <span style={{ color: "#5A6178" }}>({s.target})</span></span>
                  <span style={{ color: barColor, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{s.met}% met</span>
                </div>
                <div style={{ background: "#0A0C14", borderRadius: 3, height: 6, overflow: "hidden" }}>
                  <div style={{ width: `${s.met}%`, height: "100%", background: barColor, borderRadius: 3, transition: "width 0.4s" }} />
                </div>
                {s.breached > 0 && <div style={{ fontSize: 10, color: "#FF4444", marginTop: 2 }}>⚠ {s.breached} breached</div>}
              </div>
            );
          })}
        </div>
      </div>}

      {/* Duplicate / Mass Incident Detection */}
      {(() => {
        const oneHourAgo = Date.now() - 3600000;
        const recentOpen = incidents.filter(i => !["Resolved", "Closed"].includes(i.status) && new Date(i.createdAt || 0).getTime() > oneHourAgo);
        const wordCounts = {};
        recentOpen.forEach(i => {
          const words = (i.title || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(w => w.length > 3);
          words.forEach(w => { wordCounts[w] = (wordCounts[w] || []); if (!wordCounts[w].includes(i.id)) wordCounts[w].push(i.id); });
        });
        const clusters = Object.entries(wordCounts).filter(([, ids]) => ids.length >= 3).sort((a, b) => b[1].length - a[1].length).slice(0, 2);
        if (clusters.length === 0) return null;
        return clusters.map(([keyword, ids]) => {
          const clusterIncidents = recentOpen.filter(i => ids.includes(i.id));
          const topTitle = clusterIncidents[0]?.title || keyword;
          return (
            <div key={keyword} style={{ marginBottom: 12, padding: "12px 16px", borderRadius: 8, background: "linear-gradient(135deg, #FF6B6B08, #FFB34708)", border: "1px solid #FFB34744", animation: "aiBorderPulse 2s ease-in-out infinite" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 14, animation: "iconBounce 1.5s ease-in-out infinite" }}>🔗</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "#FFB347", fontWeight: 700 }}>Possible Mass Incident — {ids.length} similar tickets in the last hour</div>
                  <div style={{ fontSize: 11, color: "#A0AEC0", marginTop: 2 }}>"{topTitle.substring(0, 60)}{topTitle.length > 60 ? "..." : ""}"</div>
                </div>
                <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 6, background: "#FF6B6B22", color: "#FF6B6B", fontWeight: 700 }}>{ids.length} tickets</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => {
                  const now = new Date().toISOString();
                  const resolution = `Mass incident resolved. Root cause: ${keyword}-related service disruption affecting ${ids.length} users. All linked tickets resolved together.`;
                  setIncidents(prev => prev.map(i => ids.includes(i.id) ? { ...i, status: "Resolved", resolution, resolvedAt: now, linkedIncidents: ids.filter(x => x !== i.id), activityLog: [...(i.activityLog || []), { id: `AL-MASS-${Date.now().toString(36)}`, type: "resolution", user: currentUser?.name || "Engineer", time: now, detail: `Bulk-resolved as part of mass incident (${ids.length} tickets, keyword: ${keyword})` }] } : i));
                  showToast?.(`Resolved ${ids.length} linked tickets`, "success");
                }}
                  style={{ padding: "5px 12px", borderRadius: 6, background: "#10B98118", border: "1px solid #10B98144", color: "#10B981", cursor: "pointer", fontSize: 10, fontWeight: 600 }}>
                  ✓ Link & Resolve All ({ids.length})
                </button>
                <button onClick={() => setActiveModule("incidents")}
                  style={{ padding: "5px 12px", borderRadius: 6, background: "#6366F112", border: "1px solid #6366F133", color: "#6366F1", cursor: "pointer", fontSize: 10, fontWeight: 600 }}>
                  View Tickets
                </button>
              </div>
            </div>
          );
        });
      })()}

      {/* Team Performance */}
      {cardVisibility.teamWorkload.on && <div style={{ marginBottom: 20 }}>
        {/* Team Workload */}
        <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20 }}>
          <h3 onClick={() => setActiveModule("reports")} style={{ margin: "0 0 16px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.color = "#06B6D4"} onMouseLeave={e => e.currentTarget.style.color = "#E8ECF4"}>
            <span style={{ color: "#06B6D4" }}>👥</span> Team Workload & Performance
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: "#10B98122", border: "1px solid #10B98144", color: "#10B981", fontWeight: 600, marginLeft: 8, animation: "aiBreathe 4s ease-in-out infinite" }}>⚡ Smart Routing</span>
            <span style={{ fontSize: 10, color: "#5A617866", marginLeft: "auto" }}>Report →</span>
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
            {(users.length > 0 ? users : USERS).filter(u => u.rbacRole !== "End User" && u.rbacRole !== "Read Only").map((user, index) => {
              const assigned = incidents.filter(i => i.assignee === user.name && i.status !== "Resolved" && i.status !== "Closed").length;
              const resolved = incidents.filter(i => i.assignee === user.name && i.status === "Resolved").length;
              const load = Math.min(100, assigned * 25);
              const loadColor = load >= 75 ? "#FF6B6B" : load >= 50 ? "#FFB347" : "#4CAF50";
              const uColor = user.color || "#6366F1";
              return (
                <div key={user.id || user.name} onClick={() => setActiveModule("incidents")} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#0A0C14", borderRadius: 6, border: "1px solid #1E213044", cursor: "pointer", transition: "background 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.background = `${uColor}08`}
                  onMouseLeave={e => e.currentTarget.style.background = "#0A0C14"}>
                  <div style={{ position: "relative", width: 34, height: 38, flexShrink: 0 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg, ${uColor}CC, ${uColor}66)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", border: `2px solid ${uColor}88`, animation: "aiBreathe 3s ease-in-out infinite", animationDelay: `${index * 0.4}s` }}>{user.avatar || user.name?.split(" ").map(w => w[0]).join("").slice(0, 2)}</div>
                    {user.badge && <div style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)", padding: "1px 5px", borderRadius: 6, background: `${uColor}DD`, color: "#fff", fontSize: 7, fontWeight: 700, whiteSpace: "nowrap", border: "1px solid #0F111788" }}>{user.badge}</div>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "#E8ECF4", fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>{user.name} {user.team && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 4, background: `${uColor}18`, color: uColor, fontWeight: 600 }}>{user.team}</span>}</div>
                    <div style={{ fontSize: 10, color: "#5A6178" }}>{user.rbacRole}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: loadColor, fontFamily: "'JetBrains Mono', monospace" }}>{assigned} open</div>
                    <div style={{ fontSize: 10, color: "#81C784" }}>{resolved} resolved</div>
                  </div>
                  <div style={{ width: 50, flexShrink: 0 }}>
                    <div style={{ background: "#1E2130", borderRadius: 3, height: 4, overflow: "hidden" }}>
                      <div style={{ width: `${load}%`, height: "100%", background: loadColor, borderRadius: 3 }} />
                    </div>
                    <div style={{ fontSize: 9, color: "#5A6178", textAlign: "center", marginTop: 2 }}>{load}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>}

      {/* Feature 36: My Morning Brief */}
      {standupData && (
        <div style={{ background: "#12141E", borderRadius: 10, padding: 16, border: "1px solid #06B6D433", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: standupOpen ? 12 : 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14 }}>☀️</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#06B6D4" }}>My Morning Brief</span>
              <span style={{ fontSize: 10, color: "#A0AEC0" }}>{standupData.today?.openCount || 0} open | {standupData.slaRisks?.length || 0} at-risk</span>
            </div>
            <button onClick={() => setStandupOpen(!standupOpen)} style={{ background: "#06B6D412", border: "1px solid #06B6D433", borderRadius: 6, color: "#06B6D4", cursor: "pointer", padding: "4px 10px", fontSize: 10, fontWeight: 600 }}>
              {standupOpen ? "Collapse" : "Expand"}
            </button>
          </div>
          {standupOpen && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
              <div style={{ background: "#0A0C14", borderRadius: 6, padding: 10, border: "1px solid #1E2130" }}>
                <div style={{ fontSize: 9, color: "#10B981", fontWeight: 600, marginBottom: 6, textTransform: "uppercase" }}>Yesterday ({standupData.yesterday?.resolved || 0} resolved)</div>
                {(standupData.yesterday?.tickets || []).slice(0, 3).map((t, i) => (
                  <div key={i} style={{ fontSize: 10, color: "#A0AEC0", padding: "2px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span style={{ color: "#10B981", marginRight: 4 }}>✓</span> {t.title || t.id}</div>
                ))}
                {(standupData.yesterday?.resolved || 0) === 0 && <div style={{ fontSize: 10, color: "#5A6178" }}>No resolutions yesterday</div>}
              </div>
              <div style={{ background: "#0A0C14", borderRadius: 6, padding: 10, border: "1px solid #1E2130" }}>
                <div style={{ fontSize: 9, color: "#FFB347", fontWeight: 600, marginBottom: 6, textTransform: "uppercase" }}>Today's Queue (priority order)</div>
                {(standupData.today?.queue || []).slice(0, 5).map((t, i) => (
                  <div key={i} style={{ fontSize: 10, color: "#A0AEC0", padding: "2px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span style={{ color: t.priority === "Sev-A" ? "#FF6B6B" : t.priority === "Sev-B" ? "#FFB347" : "#06B6D4", marginRight: 4 }}>●</span> {t.title || t.id}</div>
                ))}
              </div>
              {standupData.slaRisks?.length > 0 && (
                <div style={{ gridColumn: "1 / -1", background: "#FF6B6B08", borderRadius: 6, padding: 8, border: "1px solid #FF6B6B33" }}>
                  <div style={{ fontSize: 9, color: "#FF6B6B", fontWeight: 600, marginBottom: 4 }}>⚠ SLA AT-RISK</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {standupData.slaRisks.map((t, i) => (
                      <span key={i} style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#FF6B6B12", color: "#FF6B6B", border: "1px solid #FF6B6B22" }}>{t.id} ({t.priority})</span>
                    ))}
                  </div>
                </div>
              )}
              {standupData.suggestedFocus && (
                <div style={{ gridColumn: "1 / -1", fontSize: 10, color: "#6366F1", fontWeight: 600 }}>
                  💡 Focus: {standupData.suggestedFocus}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Feature 1: AI Autopilot Activity Feed */}
      {autopilotStatus && (
        <div style={{ background: "#12141E", borderRadius: 10, padding: 16, border: "1px solid #10B98133", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: autopilotOpen ? 12 : 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, animation: "iconBounce 2s ease-in-out infinite" }}>🤖</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#10B981" }}>AI Autopilot</span>
              <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#10B98118", color: "#10B981", fontWeight: 600 }}>ACTIVE</span>
              {autopilotStatus.stats && (
                <span style={{ fontSize: 10, color: "#A0AEC0", marginLeft: 8 }}>
                  {autopilotStatus.stats.autoTriaged} triaged | {autopilotStatus.stats.autoResolved} resolved autonomously
                </span>
              )}
            </div>
            <button onClick={() => setAutopilotOpen(!autopilotOpen)} style={{ background: "#10B98112", border: "1px solid #10B98133", borderRadius: 6, color: "#10B981", cursor: "pointer", padding: "4px 10px", fontSize: 10, fontWeight: 600 }}>
              {autopilotOpen ? "Collapse" : "Details"}
            </button>
          </div>
          {autopilotOpen && (
            <div style={{ marginTop: 8 }}>
              {autopilotStatus.lastRun && (
                <div style={{ background: "#0A0C14", borderRadius: 6, padding: 10, marginBottom: 8, border: "1px solid #1E2130" }}>
                  <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 6 }}>Last Run: {new Date(autopilotStatus.lastRun.startedAt).toLocaleString()} (Week {autopilotStatus.lastRun.rolloutWeek})</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(autopilotStatus.lastRun.steps || []).map((step, i) => (
                      <div key={i} style={{ padding: "3px 8px", borderRadius: 4, fontSize: 9, fontWeight: 600, background: step.ok === false ? "#FF6B6B15" : step.skipped ? "#FFB34715" : "#10B98115", color: step.ok === false ? "#FF6B6B" : step.skipped ? "#FFB347" : "#10B981", border: `1px solid ${step.ok === false ? "#FF6B6B33" : step.skipped ? "#FFB34733" : "#10B98133"}` }}>
                        {step.step.replace("week", "W").replace(/_/g, " ")}
                        {step.ok === false ? " ✗" : step.skipped ? " ⊘" : " ✓"}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {autopilotStatus.recentRuns?.length > 1 && (
                <div style={{ fontSize: 10, color: "#5A6178" }}>
                  {autopilotStatus.totalRuns} total runs | Recent: {autopilotStatus.recentRuns.slice(1, 4).map(r => new Date(r.startedAt).toLocaleTimeString()).join(", ")}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Shift Handoff Summary */}
      {cardVisibility.teamWorkload.on && <div style={{ marginBottom: 20 }}>
        <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: shiftHandoffOpen ? 14 : 0 }}>
            <h4 style={{ margin: 0, fontSize: 12, color: "#FFB347", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
              🔄 Shift Handoff Briefing
            </h4>
            <button disabled={shiftHandoffLoading} onClick={async () => {
              if (shiftHandoff && shiftHandoffOpen) { setShiftHandoffOpen(false); return; }
              if (shiftHandoff) { setShiftHandoffOpen(true); return; }
              setShiftHandoffLoading(true);
              try {
                const r = await fetch("/api/ai/shift-handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engineer: currentUser?.name || "Engineer", incidents: incidents.filter(i => i.status !== "Closed").slice(0, 30).map(i => ({ id: i.id, title: i.title, priority: i.priority, status: i.status, assignee: i.assignee, category: i.category, createdAt: i.createdAt, slaBreached: i.slaBreached })) }) });
                const d = await r.json();
                setShiftHandoff(d);
                setShiftHandoffOpen(true);
              } catch { showToast("Shift handoff unavailable", "error"); }
              setShiftHandoffLoading(false);
            }} style={{ ...btnStyle("#FFB347"), fontSize: 9, padding: "4px 12px" }}>
              {shiftHandoffLoading ? "⏳ Generating..." : shiftHandoff ? (shiftHandoffOpen ? "▲ Hide" : "▼ Show") : "📋 Generate Briefing"}
            </button>
          </div>
          {shiftHandoffOpen && shiftHandoff && (
            <div style={{ display: "grid", gap: 10 }}>
              {shiftHandoff.immediateActions?.length > 0 && (
                <div style={{ padding: 10, borderRadius: 6, background: "#FF6B6B08", border: "1px solid #FF6B6B22" }}>
                  <div style={{ fontSize: 10, color: "#FF6B6B", fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>🚨 Immediate Actions</div>
                  {shiftHandoff.immediateActions.map((a, i) => <div key={i} style={{ fontSize: 11, color: "#E8ECF4", marginBottom: 4, paddingLeft: 10, borderLeft: "2px solid #FF6B6B44" }}>{a}</div>)}
                </div>
              )}
              {shiftHandoff.slaWarnings?.length > 0 && (
                <div style={{ padding: 10, borderRadius: 6, background: "#FFB34708", border: "1px solid #FFB34722" }}>
                  <div style={{ fontSize: 10, color: "#FFB347", fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>⏱ SLA Warnings</div>
                  {shiftHandoff.slaWarnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: "#E8ECF4", marginBottom: 4, paddingLeft: 10, borderLeft: "2px solid #FFB34744" }}>{w}</div>)}
                </div>
              )}
              {shiftHandoff.myTicketsSummary?.length > 0 && (
                <div style={{ padding: 10, borderRadius: 6, background: "#6366F108", border: "1px solid #6366F122" }}>
                  <div style={{ fontSize: 10, color: "#6366F1", fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>📋 Ticket Summary</div>
                  {shiftHandoff.myTicketsSummary.map((t, i) => <div key={i} style={{ fontSize: 11, color: "#C4CAD6", marginBottom: 4, paddingLeft: 10, borderLeft: "2px solid #6366F144" }}>{t}</div>)}
                </div>
              )}
              {shiftHandoff.recommendation && (
                <div style={{ padding: 10, borderRadius: 6, background: "#10B98108", border: "1px solid #10B98122" }}>
                  <div style={{ fontSize: 10, color: "#10B981", fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>💡 Recommendation</div>
                  <div style={{ fontSize: 11, color: "#E8ECF4" }}>{shiftHandoff.recommendation}</div>
                </div>
              )}
              {shiftHandoff.unacknowledgedAlerts?.length > 0 && (
                <div style={{ padding: 10, borderRadius: 6, background: "#EC489908", border: "1px solid #EC489922" }}>
                  <div style={{ fontSize: 10, color: "#EC4899", fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>🔔 Unacknowledged Alerts</div>
                  {shiftHandoff.unacknowledgedAlerts.map((a, i) => <div key={i} style={{ fontSize: 11, color: "#E8ECF4", marginBottom: 4, paddingLeft: 10, borderLeft: "2px solid #EC489944" }}>{a}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>}

      {/* Pending Approvals */}
      {cardVisibility.pendingApprovals.on && <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, marginBottom: 20 }}>
        <h3 onClick={() => setActiveModule("humanReview")} style={{ margin: "0 0 16px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
          onMouseEnter={e => e.currentTarget.style.color = "#EC4899"} onMouseLeave={e => e.currentTarget.style.color = "#E8ECF4"}>
          <span style={{ color: "#EC4899" }}>👨‍💻</span> Engineer Review — Pending Items <span style={{ fontSize: 11, color: "#5A6178", fontWeight: 400 }}>({pendingApprovals + aiActions.filter(a => a.status === "pending_approval").length + zdAiQueue.filter(q => q.status === "pending_approval").length})</span> <span style={{ fontSize: 10, color: "#5A617866", marginLeft: "auto" }}>Review All →</span>
        </h3>

        {/* AI Actions Pending */}
        {aiActions.filter(a => a.status === "pending_approval").length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "#6366F1", fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>🤖 AI Actions</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {aiActions.filter(a => a.status === "pending_approval").slice(0, 3).map(action => (
                <div key={action.id} style={{ padding: "14px 18px", borderRadius: 8, background: "#0A0C14", border: `1px solid ${(action.severity === "critical" ? "#FF4444" : action.severity === "high" ? "#FF8800" : "#FFB347")}33`, flex: "1 1 220px", minWidth: 220, cursor: "pointer" }} onClick={() => setShowAiActionsPanel(true)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: (action.severity === "critical" ? "#FF4444" : action.severity === "high" ? "#FF8800" : "#FFB347") + "22", color: action.severity === "critical" ? "#FF4444" : action.severity === "high" ? "#FF8800" : "#FFB347", fontWeight: 700, textTransform: "uppercase" }}>{action.severity}</span>
                    <span style={{ fontSize: 9, color: "#6366F1" }}>{action.type}</span>
                  </div>
                  <div style={{ color: "#C4CAD6", fontSize: 12, marginBottom: 4 }}>{action.title}</div>
                  {action.confidence && <span style={{ fontSize: 9, color: "#81C784" }}>🎯 {action.confidence}%</span>}
                </div>
              ))}
            </div>
            {aiActions.filter(a => a.status === "pending_approval").length > 3 && (
              <div style={{ fontSize: 10, color: "#6366F1", cursor: "pointer", marginTop: 8, textAlign: "right" }} onClick={() => setActiveModule("humanReview")}>+{aiActions.filter(a => a.status === "pending_approval").length - 3} more →</div>
            )}
          </div>
        )}

        {/* Zendesk Drafts Pending */}
        {zdAiQueue.filter(q => q.status === "pending_approval").length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "#EC4899", fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>🎫 Zendesk AI Drafts</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {zdAiQueue.filter(q => q.status === "pending_approval").slice(0, 3).map(item => (
                <div key={item.id} style={{ padding: "14px 18px", borderRadius: 8, background: "#0A0C14", border: "1px solid #EC489933", flex: "1 1 220px", minWidth: 220, cursor: "pointer" }} onClick={() => setActiveModule("humanReview")}>
                  <div style={{ fontSize: 11, color: "#EC4899", fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>{item.id}</div>
                  <div style={{ color: "#C4CAD6", fontSize: 12, marginBottom: 4 }}>{item.ticketSubject || item.subject}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Badge color={{ bg: "#2D1F0A", text: "#FFB347" }}>Pending Review</Badge>
                    <span style={{ fontSize: 9, color: "#81C784" }}>🎯 {item.confidence}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Change & Request Approvals */}
        {(pendingApprovals > 0) && (
          <div style={{ marginBottom: 0 }}>
            <div style={{ fontSize: 10, color: "#FFB347", fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>✓ Change & Request Approvals</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {changes.filter(c => c.status === "Awaiting Approval").map(ch => (
            <div key={ch.id} style={{ padding: "14px 18px", borderRadius: 8, background: "#0A0C14", border: "1px solid #1E213044", flex: "1 1 220px", minWidth: 220, cursor: "pointer" }} onClick={() => { setDetailItem(ch); setModal("changeDetail"); }}>
              <div style={{ fontSize: 11, color: "#64B5F6", fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>{ch.id}</div>
              <div style={{ color: "#C4CAD6", fontSize: 13, marginBottom: 8 }}>{ch.title}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <Badge color={{ bg: "#2D1F0A", text: "#FFB347" }}>Awaiting</Badge>
                <Badge color={PRIORITY_COLORS[ch.priority]}>{ch.risk} Risk</Badge>
              </div>
            </div>
          ))}
          {requests.filter(r => r.status === "Pending Approval").map(req => (
            <div key={req.id} style={{ padding: "14px 18px", borderRadius: 8, background: "#0A0C14", border: "1px solid #1E213044", flex: "1 1 220px", minWidth: 220, cursor: "pointer" }} onClick={() => { setDetailItem(req); setModal("requestDetail"); }}>
              <div style={{ fontSize: 11, color: "#64B5F6", fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>{req.id}</div>
              <div style={{ color: "#C4CAD6", fontSize: 13, marginBottom: 8 }}>{req.service}</div>
              <Badge color={{ bg: "#2D1F0A", text: "#FFB347" }}>Pending Approval</Badge>
            </div>
          ))}
            </div>
          </div>
        )}
          {pendingApprovals === 0 && aiActions.filter(a => a.status === "pending_approval").length === 0 && zdAiQueue.filter(q => q.status === "pending_approval").length === 0 && <div style={{ color: "#5A6178", fontSize: 12, padding: 16 }}>No pending reviews 🎉</div>}
      </div>}
    </>)}

    {/* ═══ ENGINEER VIEW ═══ */}
    {isEngineer && (<>
      {/* Personal KPI Row */}
      {cardVisibility.personalKpis.on && <div className="vgc-kpi-grid-5" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "My Open Tickets", value: myTickets.length, icon: "🎫", accent: "#6366F1", link: "incidents" },
          { label: "My Resolved", value: myResolved, icon: "✅", accent: "#4CAF50", link: "incidents" },
          { label: "Sev-A Assigned", value: myTickets.filter(t => t.priority === "Sev-A").length, icon: "🔥", accent: "#FF4444", critical: myTickets.some(t => t.priority === "Sev-A"), link: "incidents" },
          { label: "Avg Response (hrs)", value: "1.4", icon: "⚡", accent: "#06B6D4", link: "sla" },
          { label: "SLA On-Track", value: `${myTickets.filter(t => t.created <= t.slaTarget).length}/${myTickets.length}`, icon: "⏱️", accent: "#FFB347", link: "sla" },
        ].map((kpi, i) => (
          <div key={i} onClick={() => kpi.link && setActiveModule(kpi.link)} style={{ background: kpi.critical ? "#1A080811" : "#0F1117", borderRadius: 8, border: kpi.critical ? "1px solid #FF444444" : "1px solid #1E2130", padding: "14px 16px", position: "relative", overflow: "hidden", animation: kpi.critical ? "criticalGlow 2s ease-in-out infinite" : "none", cursor: kpi.link ? "pointer" : "default", transition: "transform 0.15s, border-color 0.2s" }}
            onMouseEnter={e => { if (kpi.link) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = kpi.accent + "55"; } }}
            onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = kpi.critical ? "#FF444444" : "#1E2130"; }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: kpi.critical ? 3 : 2, background: kpi.accent }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>{kpi.label}</span>
              <span style={{ fontSize: 14 }}>{kpi.icon}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: kpi.critical ? "#FF6B6B" : "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>{kpi.value}</div>
            {kpi.link && <div style={{ fontSize: 10, color: "#5A617866", fontFamily: "'JetBrains Mono', monospace", marginTop: 4 }}>→</div>}
          </div>
        ))}
      </div>}

      {/* My Ticket Queue & Quick Actions */}
      {(cardVisibility.ticketQueue.on || cardVisibility.quickActions.on) && <div className="vgc-grid-2-1" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 20 }}>
        <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20 }}>
          <h3 onClick={() => setActiveModule("incidents")} style={{ margin: "0 0 16px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.color = "#6366F1"} onMouseLeave={e => e.currentTarget.style.color = "#E8ECF4"}>
            <span style={{ color: "#6366F1" }}>🎫</span> My Ticket Queue <span style={{ fontSize: 10, color: "#5A617866", marginLeft: "auto" }}>All Tickets →</span>
          </h3>
          {myTickets.length === 0 && <div style={{ color: "#5A6178", fontSize: 12, padding: 20, textAlign: "center" }}>No open tickets assigned to you</div>}
          {myTickets.map(inc => {
            const pct = Math.min(100, Math.round((inc.created / inc.slaTarget) * 100));
            const barColor = pct >= 100 ? "#FF4444" : pct > 75 ? "#FFB347" : "#4CAF50";
            return (
              <div key={inc.id} style={{ padding: "10px 14px", borderRadius: 6, marginBottom: 8, background: "#0A0C14", border: "1px solid #1E213044", cursor: "pointer" }}
                onClick={() => { setDetailItem(inc); setModal("incidentDetail"); }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "#64B5F6", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{inc.id}</span>
                    <PriorityDot priority={inc.priority} />
                    <Badge color={STATUS_COLORS[inc.status] || { bg: "#1E2130", text: "#C4CAD6" }}>{inc.status}</Badge>
                    {inc.zdTicketId && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#EC489918", color: "#EC4899", fontWeight: 600 }}>ZD#{inc.zdTicketId}</span>}
                    {inc.aiTriaged && <span style={{ fontSize: 8, color: "#6366F1" }}>🤖</span>}
                    {inc.sentiment === "frustrated" && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#FF634718", border: "1px solid #FF634733", color: "#FF6347", fontWeight: 600 }}>😤</span>}
                    {inc.sentiment === "satisfied" && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#4CAF5018", border: "1px solid #4CAF5033", color: "#4CAF50", fontWeight: 600 }}>😊</span>}
                    {inc.duplicateOf && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#FF444418", border: "1px solid #FF444433", color: "#FF4444", fontWeight: 600 }}>🔗 DUP</span>}
                    {inc.possibleDuplicateOf && !inc.duplicateOf && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#F59E0B18", border: "1px solid #F59E0B33", color: "#F59E0B", fontWeight: 600 }}>⚠️ DUP?</span>}
                    {inc.kbCoverage === "gap" && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#8B5CF618", border: "1px solid #8B5CF633", color: "#8B5CF6", fontWeight: 600 }}>📚 Gap</span>}
                    {(() => { const sla = computeIncidentSla(inc); if (!sla.hasValidSla || inc.status === "Resolved" || inc.status === "Closed") return null; if (sla.isBreached) return <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#FF444422", border: "1px solid #FF444444", color: "#FF4444", fontWeight: 600 }}>🔴 SLA</span>; if (sla.pctUsed >= 90) return <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#FF634722", border: "1px solid #FF634744", color: "#FF6347", fontWeight: 600 }}>🟠 SLA</span>; if (sla.pctUsed >= 70) return <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#FFB34722", border: "1px solid #FFB34744", color: "#FFB347", fontWeight: 600 }}>🟡 SLA</span>; return null; })()}
                  </div>
                  <span style={{ fontSize: 10, color: "#5A6178" }}>{timeAgo(inc.created)}</span>
                </div>
                <div style={{ color: "#C4CAD6", fontSize: 12, marginBottom: 4 }}>{inc.title}</div>
                {inc.customer && <div style={{ fontSize: 10, color: "#CE93D8", marginBottom: 2 }}>🏢 {inc.customer}{inc.customerContact ? ` — ${inc.customerContact}` : ""}</div>}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, background: "#1E2130", borderRadius: 3, height: 4, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 10, color: barColor, fontFamily: "'JetBrains Mono', monospace" }}>{pct >= 100 ? "BREACHED" : `${pct}%`}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick Actions */}
        <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>⚡ Quick Actions</h3>
          {[
            { label: "New Incident", action: () => setModal("newIncident"), color: "#FF6B6B", icon: "🆕" },
            { label: "Browse KB", action: () => setActiveModule("knowledge"), color: "#64B5F6", icon: "📖" },
            { label: "View SLA Tracker", action: () => setActiveModule("sla"), color: "#FFB347", icon: "⏱️" },
            { label: "Service Catalog", action: () => setActiveModule("catalog"), color: "#CE93D8", icon: "📋" },
            { label: "VGC AI Assistant", action: () => setShowAiPanel(!showAiPanel), color: "#6366F1", icon: "🤖" },
          ].map((qa, i) => (
            <button key={i} onClick={qa.action} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 6, background: "#0A0C14", border: "1px solid #1E213044", borderRadius: 6, cursor: "pointer", color: "#C4CAD6", fontSize: 12, textAlign: "left" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = qa.color + "44"; e.currentTarget.style.background = qa.color + "08"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#1E213044"; e.currentTarget.style.background = "#0A0C14"; }}>
              <span style={{ fontSize: 15 }}>{qa.icon}</span>
              <span>{qa.label}</span>
            </button>
          ))}
        </div>
      </div>}

      {/* Unassigned Queue */}
      {cardVisibility.unassignedQueue.on && <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, marginBottom: 20 }}>
        <h3 onClick={() => setActiveModule("incidents")} style={{ margin: "0 0 14px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
          onMouseEnter={e => e.currentTarget.style.color = "#FFB347"} onMouseLeave={e => e.currentTarget.style.color = "#E8ECF4"}>
          <span style={{ color: "#FFB347" }}>📥</span> Queue — Unassigned & New Cases <span style={{ fontSize: 11, color: "#5A6178", fontWeight: 400 }}>({incidents.filter(i => i.status === "Open").length})</span> <span style={{ fontSize: 10, color: "#5A617866", marginLeft: "auto" }}>All Incidents →</span>
        </h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {incidents.filter(i => i.status === "Open").map(inc => (
            <div key={inc.id} style={{ padding: "10px 14px", borderRadius: 6, background: "#0A0C14", border: "1px solid #1E213044", flex: "1 1 280px", minWidth: 280, cursor: "pointer" }}
              onClick={() => { setDetailItem(inc); setModal("incidentDetail"); }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ color: "#64B5F6", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{inc.id}</span>
                <PriorityDot priority={inc.priority} />
              </div>
              <div style={{ color: "#C4CAD6", fontSize: 12, marginBottom: 4 }}>{inc.title}</div>
              {inc.customer && <div style={{ fontSize: 10, color: "#CE93D8", marginBottom: 2 }}>🏢 {inc.customer}{inc.customerContact ? ` — ${inc.customerContact}` : ""}</div>}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#5A6178" }}>
                <span>{inc.category}</span>
                <span>{timeAgo(inc.created)}</span>
              </div>
            </div>
          ))}
          {incidents.filter(i => i.status === "Open").length === 0 && <div style={{ color: "#4CAF50", fontSize: 12, padding: 12 }}>✓ Queue is empty — all cases assigned</div>}
        </div>
      </div>}
    </>)}

    {/* ═══ OPERATIONS HUB — Problems · Changes · Requests ═══ */}
    {cardVisibility.opsHub.on && <DashCard id="opsHub"><div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, #CE93D8, #FFB347, #81C784)" }} />
      <h3 style={{ margin: "0 0 16px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>⚙️</span> Operations Hub
          <span style={{ fontSize: 10, color: "#5A617888" }}>Problems · Changes · Requests</span>
        </span>
        <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>Unified Lifecycle View</span>
      </h3>

      {/* Animated Flow Diagram */}
      <div style={{ marginBottom: 20, padding: "16px 12px", background: "#0A0C14", borderRadius: 10, border: "1px solid #1E213044" }}>
        <div style={{ fontSize: 10, color: "#5A6178", textAlign: "center", marginBottom: 12, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1 }}>ITIL Lifecycle Flow</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0, flexWrap: "wrap" }}>
          {[
            { label: "Incident", icon: "🎫", color: "#FF6B6B", desc: "Issue reported", count: incidents.filter(i => i.status !== "Resolved" && i.status !== "Closed").length },
            null,
            { label: "Problem", icon: "🔍", color: "#CE93D8", desc: "Root cause analysis", count: problems.length },
            null,
            { label: "Change", icon: "📋", color: "#FFB347", desc: "Planned improvement", count: changes.length },
            null,
            { label: "Request", icon: "📝", color: "#81C784", desc: "Service fulfillment", count: requests.length },
            null,
            { label: "Resolved", icon: "✅", color: "#4CAF50", desc: "Completed & closed", count: incidents.filter(i => i.status === "Resolved" || i.status === "Closed").length },
          ].map((step, i) => step === null ? (
            <div key={`arrow-${i}`} style={{ display: "flex", alignItems: "center", padding: "0 2px" }}>
              <div style={{ width: 24, height: 2, background: "linear-gradient(90deg, #3A3F5500, #6366F1, #3A3F5500)", position: "relative" }}>
                <div style={{
                  position: "absolute", right: -3, top: -3, width: 0, height: 0,
                  borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: "6px solid #6366F1",
                }} />
                <div style={{
                  position: "absolute", left: 0, top: -1, width: 4, height: 4, borderRadius: "50%",
                  background: "#6366F1", animation: `flowDot ${2 + i * 0.3}s ease-in-out infinite`,
                }} />
              </div>
            </div>
          ) : (
            <div key={step.label} onClick={() => setActiveModule(step.label === "Incident" ? "incidents" : step.label === "Problem" ? "problems" : step.label === "Change" ? "changes" : step.label === "Request" ? "requests" : "incidents")}
              style={{ textAlign: "center", padding: "10px 12px", borderRadius: 8, background: `${step.color}08`, border: `1px solid ${step.color}33`, cursor: "pointer", minWidth: 90, transition: "all 0.2s", position: "relative" }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 4px 12px ${step.color}22`; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{step.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: step.color, fontFamily: "'Space Grotesk', sans-serif" }}>{step.label}</div>
              <div style={{ fontSize: 9, color: "#5A6178", marginBottom: 4 }}>{step.desc}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: step.color, fontFamily: "'JetBrains Mono', monospace" }}>{step.count}</div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 10, fontSize: 9, color: "#5A617866", fontFamily: "'JetBrains Mono', monospace" }}>
          Click any stage to navigate · Arrows show ITIL process flow
        </div>
      </div>

      {/* Three-column data: Problems | Changes | Requests */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        {/* Problems */}
        <div style={{ background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #CE93D822" }}>
          <div onClick={() => setActiveModule("problems")} style={{ fontSize: 12, fontWeight: 600, color: "#CE93D8", marginBottom: 10, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.7"} onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
            🔍 Problems <span style={{ marginLeft: "auto", fontSize: 9, color: "#5A617866" }}>View All →</span>
          </div>
          {problems.length === 0 ? (
            <div style={{ fontSize: 11, color: "#5A6178", padding: 10, textAlign: "center" }}>No active problems</div>
          ) : problems.slice(0, 4).map(p => (
            <div key={p.id} onClick={() => { setDetailItem(p); setModal("problemDetail"); }} style={{ padding: "8px 10px", marginBottom: 6, background: "#0F111708", borderRadius: 6, border: "1px solid #1E213022", cursor: "pointer", transition: "border-color 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "#CE93D844"} onMouseLeave={e => e.currentTarget.style.borderColor = "#1E213022"}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 10, color: "#CE93D8", fontFamily: "'JetBrains Mono', monospace" }}>{p.id}</span>
                <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: p.status === "Open" ? "#FF444422" : p.status === "Investigating" ? "#FFB34722" : "#4CAF5022", color: p.status === "Open" ? "#FF6B6B" : p.status === "Investigating" ? "#FFB347" : "#4CAF50", fontFamily: "'JetBrains Mono', monospace" }}>{p.status}</span>
              </div>
              <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.3 }}>{p.title}</div>
            </div>
          ))}
        </div>
        {/* Changes */}
        <div style={{ background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #FFB34722" }}>
          <div onClick={() => setActiveModule("changes")} style={{ fontSize: 12, fontWeight: 600, color: "#FFB347", marginBottom: 10, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.7"} onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
            📋 Changes <span style={{ marginLeft: "auto", fontSize: 9, color: "#5A617866" }}>View All →</span>
          </div>
          {changes.length === 0 ? (
            <div style={{ fontSize: 11, color: "#5A6178", padding: 10, textAlign: "center" }}>No scheduled changes</div>
          ) : changes.slice(0, 4).map(ch => (
            <div key={ch.id} onClick={() => { setDetailItem(ch); setModal("changeDetail"); }} style={{ padding: "8px 10px", marginBottom: 6, background: "#0F111708", borderRadius: 6, border: "1px solid #1E213022", cursor: "pointer", transition: "border-color 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "#FFB34744"} onMouseLeave={e => e.currentTarget.style.borderColor = "#1E213022"}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 10, color: "#FFB347", fontFamily: "'JetBrains Mono', monospace" }}>{ch.id}</span>
                <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: ch.status === "Awaiting Approval" ? "#FFB34722" : ch.status === "Approved" ? "#4CAF5022" : "#1E2130", color: ch.status === "Awaiting Approval" ? "#FFB347" : ch.status === "Approved" ? "#4CAF50" : "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{ch.status}</span>
              </div>
              <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.3 }}>{ch.title}</div>
              <div style={{ fontSize: 9, color: "#5A6178", marginTop: 3 }}>{ch.scheduled || "TBD"} · {ch.risk} Risk</div>
            </div>
          ))}
        </div>
        {/* Requests */}
        <div style={{ background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #81C78422" }}>
          <div onClick={() => setActiveModule("requests")} style={{ fontSize: 12, fontWeight: 600, color: "#81C784", marginBottom: 10, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.7"} onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
            📝 Requests <span style={{ marginLeft: "auto", fontSize: 9, color: "#5A617866" }}>View All →</span>
          </div>
          {requests.length === 0 ? (
            <div style={{ fontSize: 11, color: "#5A6178", padding: 10, textAlign: "center" }}>No active requests</div>
          ) : requests.slice(0, 4).map(req => (
            <div key={req.id} onClick={() => { setDetailItem(req); setModal("requestDetail"); }} style={{ padding: "8px 10px", marginBottom: 6, background: "#0F111708", borderRadius: 6, border: "1px solid #1E213022", cursor: "pointer", transition: "border-color 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "#81C78444"} onMouseLeave={e => e.currentTarget.style.borderColor = "#1E213022"}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 10, color: "#81C784", fontFamily: "'JetBrains Mono', monospace" }}>{req.id}</span>
                <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: req.status === "Pending Approval" ? "#FFB34722" : req.status === "Open" || req.status === "In Progress" ? "#64B5F622" : "#4CAF5022", color: req.status === "Pending Approval" ? "#FFB347" : req.status === "Open" || req.status === "In Progress" ? "#64B5F6" : "#4CAF50", fontFamily: "'JetBrains Mono', monospace" }}>{req.status}</span>
              </div>
              <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.3 }}>{req.service}</div>
              <div style={{ fontSize: 9, color: "#5A6178", marginTop: 3 }}>Requested by: {req.requestedBy || "—"}</div>
            </div>
          ))}
        </div>
      </div>
      {/* Summary Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 14 }}>
        {[
          { label: "Open Problems", value: problems.filter(p => p.status === "Open" || p.status === "Investigating").length, color: "#CE93D8" },
          { label: "Pending Changes", value: changes.filter(c => c.status === "Awaiting Approval").length, color: "#FFB347" },
          { label: "Active Requests", value: requests.filter(r => r.status === "Open" || r.status === "In Progress").length, color: "#81C784" },
          { label: "Total Lifecycle Items", value: problems.length + changes.length + requests.length, color: "#6366F1" },
        ].map((s, i) => (
          <div key={i} style={{ textAlign: "center", padding: "8px 10px", background: "#0A0C14", borderRadius: 6, border: `1px solid ${s.color}22` }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: "'Space Grotesk', sans-serif" }}>{s.value}</div>
            <div style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.5px" }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div></DashCard>}

    {/* ═══ MY AI CO-PILOT — Daily Briefing (Engineer View) ═══ */}
    {cardVisibility.aiCoPilot?.on && (() => {
      const myOpenTickets = incidents.filter(i => i.assignee === currentUser.name && i.status !== "Resolved" && i.status !== "Closed");
      const slaAtRisk = myOpenTickets.filter(i => { const s = computeIncidentSla(i); return s.isAtRisk; });
      const slaBreached = myOpenTickets.filter(i => computeIncidentSla(i).isBreached);
      const myResolvedIncs = incidents.filter(i => i.assignee === currentUser.name && (i.status === "Resolved" || i.status === "Closed"));
      const totalResolved = myResolvedIncs.length;
      const avgResolutionHrs = totalResolved > 0 ? Math.round(computeMTTR(myResolvedIncs)) : 0;
      const workloadScore = Math.min(100, Math.round((myOpenTickets.length / 6) * 100));
      const balanceStatus = workloadScore <= 40 ? "Healthy" : workloadScore <= 70 ? "Moderate" : "Heavy";
      const balanceColor = workloadScore <= 40 ? "#81C784" : workloadScore <= 70 ? "#FFB347" : "#FF6B6B";
      const balanceIcon = workloadScore <= 40 ? "🌿" : workloadScore <= 70 ? "⚡" : "🔥";
      const aiHandledPct = Math.round((incidents.filter(i => i.aiTriaged).length / Math.max(1, incidents.length)) * 100);
      const hour = new Date().getHours();
      const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
      return (
      <div style={{ background: "linear-gradient(135deg, #0F1117, #111422)", borderRadius: 10, border: "1px solid #6366F122", padding: 0, marginBottom: 20, overflow: "hidden" }}>
        {/* Gradient accent bar */}
        <div style={{ height: 3, background: "linear-gradient(90deg, #6366F1, #06B6D4, #81C784, #EC4899)" }} />
        <div style={{ padding: "20px 24px" }}>
          {/* Header with greeting */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 20 }}>🤝</span> My AI Co-Pilot — {greeting}, {currentUser.name.split(" ")[0]}!
              </h3>
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "#5A6178", fontStyle: "italic" }}>
                Your AI works alongside you — assisting, never replacing. Focus on what matters most.
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>Work-Life Balance</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 14 }}>{balanceIcon}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: balanceColor, fontFamily: "'Space Grotesk', sans-serif" }}>{balanceStatus}</span>
                </div>
              </div>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: `${balanceColor}15`, border: `2px solid ${balanceColor}44`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                <svg width="36" height="36" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="14" fill="none" stroke="#1E2130" strokeWidth="3" />
                  <circle cx="18" cy="18" r="14" fill="none" stroke={balanceColor} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${workloadScore * 0.88} 88`} transform="rotate(-90 18 18)" />
                </svg>
                <span style={{ position: "absolute", fontSize: 8, fontWeight: 700, color: balanceColor, fontFamily: "'JetBrains Mono', monospace" }}>{workloadScore}%</span>
              </div>
            </div>
          </div>

          {/* KPI Summary Row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 18 }}>
            {[
              { label: "My Open Tickets", value: myOpenTickets.length, icon: "🎫", color: "#6366F1" },
              { label: "SLA At Risk", value: slaAtRisk.length, icon: "⚠️", color: slaAtRisk.length > 0 ? "#FFB347" : "#81C784" },
              { label: "SLA Breached", value: slaBreached.length, icon: "🚨", color: slaBreached.length > 0 ? "#FF6B6B" : "#81C784" },
              { label: "Resolved Today", value: totalResolved, icon: "✅", color: "#81C784" },
              { label: "AI Assisted", value: `${aiHandledPct}%`, icon: "🤖", color: "#06B6D4" },
            ].map((kpi, i) => (
              <div key={i} style={{ background: "#0A0C14", borderRadius: 8, padding: "12px 10px", textAlign: "center", border: `1px solid ${kpi.color}15` }}>
                <div style={{ fontSize: 14, marginBottom: 4 }}>{kpi.icon}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: kpi.color, fontFamily: "'Space Grotesk', sans-serif" }}>{kpi.value}</div>
                <div style={{ fontSize: 9, color: "#5A6178", marginTop: 2 }}>{kpi.label}</div>
              </div>
            ))}
          </div>

          {/* Proactive AI Alerts — SLA, Complaints, Predictions */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
            {/* SLA Predictions & Warnings */}
            <div style={{ background: "#0A0C14", borderRadius: 8, padding: 16, border: "1px solid #1E213044" }}>
              <h4 style={{ margin: "0 0 12px", fontSize: 12, color: "#FFB347", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
                ⏱️ SLA Predictions & Warnings
              </h4>
              {slaAtRisk.length === 0 && slaBreached.length === 0 ? (
                <div style={{ padding: 12, textAlign: "center", color: "#81C784", fontSize: 11, background: "#81C78408", borderRadius: 6, border: "1px solid #81C78422" }}>
                  ✅ All your tickets are within SLA — great job!
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {slaBreached.map(t => (
                    <div key={t.id} onClick={() => { setDetailItem(t); setModal("incidentDetail"); }} style={{ padding: "8px 10px", borderRadius: 6, background: "#FF6B6B08", border: "1px solid #FF6B6B22", cursor: "pointer" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "#FF6B6B", fontWeight: 600 }}>🚨 {t.id} BREACHED</span>
                        <span style={{ fontSize: 9, color: "#FF6B6B88", fontFamily: "'JetBrains Mono', monospace" }}>{Math.round(t.created)}h / {t.slaTarget}h</span>
                      </div>
                      <div style={{ fontSize: 10, color: "#C4CAD6", marginTop: 2 }}>{t.title}</div>
                      <div style={{ fontSize: 9, color: "#FFB347", marginTop: 3, fontStyle: "italic" }}>💡 AI suggests: Escalate immediately or request extension</div>
                    </div>
                  ))}
                  {slaAtRisk.filter(t => t.created < t.slaTarget).map(t => {
                    const remaining = Math.round(t.slaTarget - t.created);
                    return (
                    <div key={t.id} onClick={() => { setDetailItem(t); setModal("incidentDetail"); }} style={{ padding: "8px 10px", borderRadius: 6, background: "#FFB34708", border: "1px solid #FFB34722", cursor: "pointer" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "#FFB347", fontWeight: 600 }}>⚠️ {t.id} at risk</span>
                        <span style={{ fontSize: 9, color: "#FFB34788", fontFamily: "'JetBrains Mono', monospace" }}>{remaining}h left</span>
                      </div>
                      <div style={{ fontSize: 10, color: "#C4CAD6", marginTop: 2 }}>{t.title}</div>
                      <div style={{ fontSize: 9, color: "#06B6D4", marginTop: 3, fontStyle: "italic" }}>💡 AI suggests: Prioritize now — KB match found for similar issues</div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Customer Satisfaction & Complaint Insights */}
            <div style={{ background: "#0A0C14", borderRadius: 8, padding: 16, border: "1px solid #1E213044" }}>
              <h4 style={{ margin: "0 0 12px", fontSize: 12, color: "#EC4899", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
                💬 Customer Insights & Complaints
              </h4>
              {[
                ...(isEntraProductionUser ? [
                  { type: "feedback", user: "System", detail: "No customer insights yet — real data populates as tickets flow in", severity: "positive", suggestion: "Connect Zendesk to start receiving live insights" },
                ] : [
                  { type: "complaint", user: "Priya Sharma", detail: "Follow-up on email server — 3rd contact", severity: "high", suggestion: "Personal follow-up call recommended to rebuild trust" },
                  { type: "feedback", user: "James Wright", detail: "Positive: SAP login resolved quickly", severity: "positive", suggestion: "Great response time! Template this resolution for KB" },
                  { type: "prediction", user: "David Kim", detail: "Laptop issue — similar pattern suggests GPU driver fault", severity: "medium", suggestion: "Pre-order replacement GPU cable — 78% match to known issue" },
                ]),
              ].map((item, i) => (
                <div key={i} style={{ padding: "8px 10px", borderRadius: 6, marginBottom: 6, background: item.severity === "positive" ? "#81C78408" : item.severity === "high" ? "#FF6B6B08" : "#FFB34708", border: `1px solid ${item.severity === "positive" ? "#81C78422" : item.severity === "high" ? "#FF6B6B22" : "#FFB34722"}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 10 }}>{item.type === "complaint" ? "😤" : item.type === "prediction" ? "🔮" : "😊"}</span>
                    <span style={{ fontSize: 11, color: "#E8ECF4", fontWeight: 600 }}>{item.user}</span>
                    <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: item.severity === "positive" ? "#81C78422" : item.severity === "high" ? "#FF6B6B22" : "#FFB34722", color: item.severity === "positive" ? "#81C784" : item.severity === "high" ? "#FF6B6B" : "#FFB347", fontWeight: 600, textTransform: "uppercase" }}>{item.type}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#C4CAD6", marginBottom: 3 }}>{item.detail}</div>
                  <div style={{ fontSize: 9, color: "#06B6D4", fontStyle: "italic" }}>💡 {item.suggestion}</div>
                </div>
              ))}
            </div>
          </div>

          {/* CSAT Live Score Card (Phase 7) */}
          <div style={{ background: "#0A0C14", borderRadius: 8, padding: 16, border: "1px solid #6366F122", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h4 style={{ margin: 0, fontSize: 12, color: "#6366F1", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
                ⭐ Customer Satisfaction (CSAT) — Live Score
              </h4>
              <button onClick={fetchCsatScores} style={{ ...btnStyle("#6366F1"), fontSize: 9, padding: "3px 8px" }}>{csatLoading ? "⏳" : "🔄"} Refresh</button>
            </div>
            {csatScores && csatScores.total > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                {[
                  { label: "Overall CSAT", value: `${csatScores.average}/5`, color: csatScores.average >= 4 ? "#81C784" : csatScores.average >= 3 ? "#FFB347" : "#FF6B6B", icon: "⭐" },
                  { label: "NPS Score", value: `${csatScores.nps > 0 ? "+" : ""}${csatScores.nps}`, color: csatScores.nps > 50 ? "#81C784" : csatScores.nps > 0 ? "#FFB347" : "#FF6B6B", icon: "📊" },
                  { label: "Total Responses", value: csatScores.total, color: "#06B6D4", icon: "📋" },
                  { label: "5-Star Ratings", value: csatScores.byRating?.[5] || 0, color: "#EC4899", icon: "🌟" },
                ].map((stat, i) => (
                  <div key={i} style={{ textAlign: "center", padding: "10px 6px", borderRadius: 6, background: `${stat.color}08`, border: `1px solid ${stat.color}22` }}>
                    <div style={{ fontSize: 14 }}>{stat.icon}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: stat.color, fontFamily: "'JetBrains Mono', monospace", margin: "4px 0" }}>{stat.value}</div>
                    <div style={{ fontSize: 8, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.5 }}>{stat.label}</div>
                  </div>
                ))}
                {/* Rating distribution bar */}
                <div style={{ gridColumn: "1 / -1", marginTop: 8, padding: "8px 10px", borderRadius: 6, background: "#0F111788", border: "1px solid #1E213033" }}>
                  <div style={{ fontSize: 9, color: "#5A6178", marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>Rating Distribution</div>
                  <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 32 }}>
                    {[1, 2, 3, 4, 5].map(r => {
                      const count = csatScores.byRating?.[r] || 0;
                      const pct = csatScores.total > 0 ? (count / csatScores.total * 100) : 0;
                      const colors = ["#FF6B6B", "#FFB347", "#FFD93D", "#81C784", "#06B6D4"];
                      return (
                        <div key={r} style={{ flex: 1, textAlign: "center" }}>
                          <div style={{ height: Math.max(4, pct * 0.3), background: colors[r - 1], borderRadius: "3px 3px 0 0", transition: "height 0.3s" }} />
                          <div style={{ fontSize: 8, color: "#C4CAD6", marginTop: 2 }}>{r}★ ({count})</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* Sentiment breakdown */}
                {csatScores.sentimentBreakdown && (
                  <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
                    {[
                      { label: "Positive", value: csatScores.sentimentBreakdown.positive || 0, icon: "😊", color: "#81C784" },
                      { label: "Neutral", value: csatScores.sentimentBreakdown.neutral || 0, icon: "😐", color: "#FFB347" },
                      { label: "Negative", value: csatScores.sentimentBreakdown.negative || 0, icon: "😞", color: "#FF6B6B" },
                    ].map((s, i) => (
                      <div key={i} style={{ flex: 1, textAlign: "center", padding: 6, borderRadius: 4, background: `${s.color}08`, border: `1px solid ${s.color}15` }}>
                        <span style={{ fontSize: 12 }}>{s.icon}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: s.color, marginLeft: 4, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</span>
                        <div style={{ fontSize: 8, color: "#5A6178" }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "16px 0", color: "#5A6178", fontSize: 11 }}>
                {csatLoading ? "⏳ Loading CSAT data..." : "No CSAT survey responses yet. Click Refresh to load data."}
              </div>
            )}
          </div>

          {/* AI Customer Satisfaction Insights Widget */}
          <CsatAiInsightsWidget incidents={incidents} btnStyle={btnStyle} />

          {/* AI Proactive Suggestions — Prevent future damage */}
          <div style={{ background: "#0A0C14", borderRadius: 8, padding: 16, border: "1px solid #06B6D422", marginBottom: 18 }}>
            <h4 style={{ margin: "0 0 12px", fontSize: 12, color: "#06B6D4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
              🔮 Predictive Insights — Avoid Future Incidents
              <span style={{ marginLeft: "auto", fontSize: 8, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>Assisted by {currentUser.name} AI</span>
            </h4>
            {[
              { icon: "🌐", title: "Network Outage Pattern Detected", confidence: 85, detail: "3 network incidents in past 7 days (Mon/Wed/Fri). Core switch firmware is 6 months outdated.", action: "Schedule firmware update during next maintenance window", impact: "Could prevent ~4 incidents/week", color: "#FF6B6B" },
              { icon: "📧", title: "Email Server Capacity Warning", confidence: 78, detail: "Exchange mailbox store at 82% capacity. Historical trend shows breach in ~18 days.", action: "Archive inactive mailboxes & increase storage quota", impact: "Prevents Sev-A email outage", color: "#FFB347" },
              { icon: "🔐", title: "Password Reset Surge Expected", confidence: 72, detail: "Company-wide password policy change in 5 days. Expect 40+ reset requests.", action: "Pre-send self-service password guide to all users", impact: "Reduce ticket volume by ~60%", color: "#6366F1" },
              { icon: "💻", title: "Laptop Hardware Lifecycle Alert", confidence: 91, detail: "12 laptops exceeding 3-year lifecycle. Failure probability increases 45% after 36 months.", action: "Initiate phased hardware refresh for high-risk devices", impact: "Prevent 5-8 hardware incidents/month", color: "#CE93D8" },
            ].map((pred, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "10px 12px", borderRadius: 6, marginBottom: 8, background: "#0F111788", border: "1px solid #1E213033" }}>
                <div style={{ fontSize: 18, flexShrink: 0, marginTop: 2 }}>{pred.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 12, color: "#E8ECF4", fontWeight: 600 }}>{pred.title}</span>
                    <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: `${pred.color}22`, color: pred.color, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{pred.confidence}% confidence</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#C4CAD6", marginBottom: 3 }}>{pred.detail}</div>
                  <div style={{ fontSize: 10, color: "#81C784" }}>✅ Recommended: {pred.action}</div>
                  <div style={{ fontSize: 9, color: "#5A6178", marginTop: 2 }}>📊 Impact: {pred.impact}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Work-Life Balance & AI Support Summary */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {/* What your AI handled today */}
            <div style={{ background: "#0A0C14", borderRadius: 8, padding: 16, border: "1px solid #81C78422" }}>
              <h4 style={{ margin: "0 0 12px", fontSize: 12, color: "#81C784", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
                🤖 What Your AI Handled For You
              </h4>
              {[
                ...(isEntraProductionUser ? [
                  { task: "AI engine ready — processing live data", saved: "Standby", icon: "🤖" },
                ] : [
                  { task: "Auto-triaged 3 incoming incidents", saved: "~15 min saved", icon: "⚡" },
                  { task: "Suggested KB articles for 2 tickets", saved: "~20 min saved", icon: "📚" },
                  { task: "Predicted SLA breach", saved: "Prevented escalation", icon: "⏱️" },
                  { task: "Drafted response email", saved: "~10 min saved", icon: "📧" },
                  { task: "Auto-categorized 4 new requests", saved: "~8 min saved", icon: "🏷️" },
                ]),
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: i < 4 ? "1px solid #1E213022" : "none" }}>
                  <span style={{ fontSize: 11 }}>{item.icon}</span>
                  <span style={{ fontSize: 10, color: "#C4CAD6", flex: 1 }}>{item.task}</span>
                  <span style={{ fontSize: 9, color: "#81C784", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" }}>{item.saved}</span>
                </div>
              ))}
              <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, background: "#81C78408", border: "1px solid #81C78422", textAlign: "center" }}>
                <span style={{ fontSize: 11, color: "#81C784", fontWeight: 600 }}>🕐 ~53 minutes saved today</span>
                <div style={{ fontSize: 9, color: "#5A6178", marginTop: 2 }}>That's time back for you — focus on complex problems, take a break, or learn something new.</div>
              </div>
            </div>

            {/* Work-Life Balance Tips */}
            <div style={{ background: "#0A0C14", borderRadius: 8, padding: 16, border: "1px solid #6366F122" }}>
              <h4 style={{ margin: "0 0 12px", fontSize: 12, color: "#6366F1", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
                🌿 Work-Life Balance
              </h4>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#5A6178", marginBottom: 4 }}>
                  <span>Today's Workload</span>
                  <span style={{ color: balanceColor, fontWeight: 600 }}>{balanceStatus}</span>
                </div>
                <div style={{ background: "#1E2130", borderRadius: 4, height: 8, overflow: "hidden" }}>
                  <div style={{ width: `${workloadScore}%`, height: "100%", background: `linear-gradient(90deg, #81C784, ${balanceColor})`, borderRadius: 4, transition: "width 0.5s ease" }} />
                </div>
              </div>
              <div style={{ padding: "10px 12px", borderRadius: 6, background: "#6366F108", border: "1px solid #6366F122", marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#E8ECF4", fontWeight: 600, marginBottom: 4 }}>💡 Your AI's Philosophy</div>
                <div style={{ fontSize: 10, color: "#C4CAD6", lineHeight: 1.6 }}>
                  "I'm here to <b style={{ color: "#81C784" }}>support</b> you, not replace you. I handle repetitive tasks so you can focus on meaningful work — solving complex problems, talking to users, and growing your skills."
                </div>
              </div>
              {[
                workloadScore > 70 ? { tip: "Heavy workload detected. Consider delegating low-priority tickets or using AI auto-responses.", icon: "⚠️", color: "#FFB347" } : null,
                hour >= 18 ? { tip: "It's after 6 PM. Your AI is monitoring tickets — log off and recharge!", icon: "🌙", color: "#CE93D8" } : null,
                { tip: myOpenTickets.length <= 2 ? "Light queue today! Perfect time for knowledge base contributions or training." : "Take 5-minute breaks between complex tickets for better focus.", icon: myOpenTickets.length <= 2 ? "📖" : "☕", color: "#06B6D4" },
              ].filter(Boolean).map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "6px 8px", borderRadius: 4, marginBottom: 4, background: `${item.color}06` }}>
                  <span style={{ fontSize: 11, flexShrink: 0 }}>{item.icon}</span>
                  <span style={{ fontSize: 10, color: "#C4CAD6", lineHeight: 1.4 }}>{item.tip}</span>
                </div>
              ))}
              <div style={{ marginTop: 8, textAlign: "center", fontSize: 9, color: "#5A617866", fontFamily: "'JetBrains Mono', monospace" }}>
                Your AI is always on — you don't have to be. 💜
              </div>
            </div>
          </div>
        </div>
      </div>
      );
    })()}


    {/* ═══ NETWORK & SECURITY HUB ═══ */}
    {cardVisibility.networkSecurity.on && <DashCard id="networkSecurity"><div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, #00BF6F, #FF8C00, #0050C8)" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>🔒</span> Network & Security
        </h3>
      </div>
      {/* Tab Selector */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "#0A0C14", padding: 3, borderRadius: 8 }}>
        {[
          { id: "meraki", label: "Cisco Meraki", icon: "🔥", color: "#00BF6F" },
          { id: "solarwinds", label: "SolarWinds RMM", icon: "🖥️", color: "#FF8C00" },
          { id: "sophos", label: "Sophos Firewall", icon: "🛡️", color: "#0050C8" },
        ].map(t => (
          <button key={t.id} onClick={() => setNetworkSecTab(t.id)}
            style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              background: networkSecTab === t.id ? `${t.color}15` : "transparent",
              color: networkSecTab === t.id ? t.color : "#5A6178",
              borderBottom: networkSecTab === t.id ? `2px solid ${t.color}` : "2px solid transparent",
            }}>
            <span style={{ fontSize: 12 }}>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* ── Meraki Tab ── */}
      {networkSecTab === "meraki" && <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {merakiData && <span style={{ padding: "2px 8px", borderRadius: 4, background: "#00BF6F22", color: "#00BF6F", fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{merakiData.summary?.totalOrgs || 0} Orgs</span>}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => fetch("/api/meraki?refresh=true").then(r => r.json()).then(d => { if (!d.error) setMerakiData(d); })} style={{ background: "none", border: "1px solid #1E2130", borderRadius: 4, padding: "2px 8px", fontSize: 9, color: "#5A6178", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace" }}>↻ Refresh</button>
          <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>Meraki Dashboard API</span>
        </span>
      </div>
      {merakiLoading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#5A6178" }}>
          <div style={{ fontSize: 24, marginBottom: 8, animation: "spin 1s linear infinite" }}>⟳</div>
          <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>Fetching Meraki data...</div>
        </div>
      ) : !merakiData ? (
        <div style={{ textAlign: "center", padding: 40, color: "#5A6178" }}>
          <div style={{ fontSize: 24, marginBottom: 8, animation: "spin 1s linear infinite" }}>⟳</div>
          <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>Loading Meraki data...</div>
        </div>
      ) : merakiData.error ? (
        <div style={{ textAlign: "center", padding: 30, color: "#FF6B6B" }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontSize: 11 }}>Unable to connect to Meraki API</div>
          <div style={{ fontSize: 9, color: "#5A6178", marginTop: 4 }}>{merakiData.error}</div>
        </div>
      ) : (() => {
        const s = merakiData.summary || {};
        const allDevices = merakiData.devices || [];
        const onlineDevs = allDevices.filter(d => d.status === "online").length;
        const totalDevs = s.totalDevices || 0;
        const vpnPeers = (merakiData.vpnStatus || []).reduce((n, v) => n + ((v.merakiPeers || []).length + (v.thirdPartyPeers || []).length), 0);
        const wanIps = [...new Set((merakiData.uplinks || []).flatMap(u => (u.uplinks || []).filter(ul => ul.status === "Active" || ul.status === "active").map(ul => ul.publicIp)).filter(Boolean))];
        // Group by organization
        const orgMap = {};
        allDevices.forEach(d => { const o = d.org || "Unknown"; if (!orgMap[o]) orgMap[o] = { devices: [], online: 0, offline: 0, dormant: 0 }; orgMap[o].devices.push(d); if (d.status === "online") orgMap[o].online++; else if (d.status === "dormant") orgMap[o].dormant++; else orgMap[o].offline++; });
        const orgNetworks = {};
        (merakiData.networks || []).forEach(n => { const o = n.org || "Unknown"; orgNetworks[o] = (orgNetworks[o] || 0) + 1; });
        const orgList = Object.entries(orgMap).sort((a, b) => b[1].devices.length - a[1].devices.length);
        return (<>
          {/* Status Overview */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 16 }}>
            {[
              { label: "Devices Online", value: `${onlineDevs}/${totalDevs}`, icon: "●", color: onlineDevs === totalDevs ? "#00BF6F" : "#FFB347" },
              { label: "Organizations", value: String(s.totalOrgs || 0), icon: "🏢", color: "#06B6D4" },
              { label: "Networks", value: String(s.totalNetworks || 0), icon: "🌐", color: "#6366F1" },
              { label: "WAN IPs", value: String(wanIps.length), icon: "📡", color: "#81C784" },
              { label: "VPN Peers", value: String(vpnPeers), icon: "🔒", color: "#FFB347" },
            ].map((st, i) => (
              <div key={i} style={{ textAlign: "center", padding: "10px 8px", background: "#0A0C14", borderRadius: 6, border: "1px solid #1E213044" }}>
                <div style={{ fontSize: 14, marginBottom: 4 }}>{st.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: st.color, fontFamily: "'Space Grotesk', sans-serif" }}>{st.value}</div>
                <div style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>{st.label}</div>
              </div>
            ))}
          </div>
          {/* Per-Customer / Organization Breakdown */}
          <div style={{ background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #1E213044", marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#06B6D4", marginBottom: 10, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6 }}>
              <span>🏢</span> Customers / Organizations
              <span style={{ marginLeft: "auto", fontSize: 9, color: "#5A617888" }}>{orgList.length} orgs</span>
            </div>
            <div style={{ maxHeight: 340, overflowY: "auto" }}>
            {orgList.map(([orgName, info], i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                <div onClick={() => setExpandedMerakiOrg(expandedMerakiOrg === orgName ? null : orgName)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 6, background: expandedMerakiOrg === orgName ? "#1E213044" : "#0F111708", border: "1px solid #1E213022", cursor: "pointer", transition: "background 0.15s" }}>
                  <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", width: 14, flexShrink: 0 }}>{expandedMerakiOrg === orgName ? "▾" : "▸"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: "#E8ECF4", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{orgName}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                    <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "#00BF6F18", color: "#00BF6F", fontFamily: "'JetBrains Mono', monospace" }}>⬆ {info.online}</span>
                    {info.offline > 0 && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "#FF444418", color: "#FF6B6B", fontFamily: "'JetBrains Mono', monospace" }}>⬇ {info.offline}</span>}
                    {info.dormant > 0 && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "#FFB34718", color: "#FFB347", fontFamily: "'JetBrains Mono', monospace" }}>💤 {info.dormant}</span>}
                    <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{info.devices.length} dev</span>
                    {orgNetworks[orgName] && <span style={{ fontSize: 9, color: "#6366F188", fontFamily: "'JetBrains Mono', monospace" }}>{orgNetworks[orgName]} net</span>}
                  </div>
                </div>
                {expandedMerakiOrg === orgName && (
                  <div style={{ padding: "6px 10px 6px 32px" }}>
                    {info.devices.map((dev, j) => (
                      <div key={j} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderRadius: 4, marginBottom: 3, background: "#0F111708" }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: dev.status === "online" ? "#00BF6F" : dev.status === "alerting" ? "#FF6B6B" : dev.status === "dormant" ? "#FFB347" : "#5A6178", boxShadow: dev.status === "online" ? "0 0 6px #00BF6F66" : "none", flexShrink: 0 }} />
                        <span style={{ fontSize: 10, color: "#C4CAD6", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dev.name || dev.serial || "Unnamed"}</span>
                        <span style={{ fontSize: 9, color: "#5A617888", fontFamily: "'JetBrains Mono', monospace" }}>{dev.model || ""}</span>
                        {dev.lanIp && <span style={{ fontSize: 9, color: "#6366F188", fontFamily: "'JetBrains Mono', monospace" }}>{dev.lanIp}</span>}
                        <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: dev.status === "online" ? "#4CAF5018" : dev.status === "dormant" ? "#FFB34718" : "#FF444418", color: dev.status === "online" ? "#4CAF50" : dev.status === "dormant" ? "#FFB347" : dev.status === "alerting" ? "#FF6B6B" : "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{dev.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            </div>
          </div>
          {/* VPN & WAN Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {/* VPN Status */}
            <div style={{ background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #1E213044" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#FFB347", marginBottom: 10, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6 }}>
                <span>🔐</span> VPN Tunnels
              </div>
              {(merakiData.vpnStatus || []).slice(0, 6).map((vpn, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: vpn.vpnMode === "hub" ? "#00BF6F" : "#06B6D4", flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: "#C4CAD6", fontWeight: 600 }}>{vpn.networkName || vpn.networkId}</span>
                    <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: vpn.vpnMode === "hub" ? "#00BF6F22" : "#06B6D422", color: vpn.vpnMode === "hub" ? "#00BF6F" : "#06B6D4", fontFamily: "'JetBrains Mono', monospace", marginLeft: "auto" }}>{vpn.vpnMode}</span>
                  </div>
                  {(vpn.merakiPeers || []).concat(vpn.thirdPartyPeers || []).slice(0, 3).map((peer, j) => (
                    <div key={j} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px 3px 20px", fontSize: 9 }}>
                      <div style={{ width: 4, height: 4, borderRadius: "50%", background: peer.reachability === "reachable" ? "#00BF6F" : "#FF6B6B", flexShrink: 0 }} />
                      <span style={{ color: "#8A8FA8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{peer.name || peer.ip || "Peer"}</span>
                      <span style={{ color: peer.reachability === "reachable" ? "#00BF6F" : "#FF6B6B", fontFamily: "'JetBrains Mono', monospace" }}>{peer.reachability || "—"}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          {/* WAN Uplinks */}
          {wanIps.length > 0 && (
            <div style={{ marginTop: 14, background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #1E213044" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#6366F1", marginBottom: 10, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6 }}>
                <span>🌐</span> Active WAN Uplinks
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {(merakiData.uplinks || []).flatMap(u => (u.uplinks || []).filter(ul => ul.status === "Active" || ul.status === "active").map(ul => ({ ...ul, device: u.serial }))).slice(0, 8).map((ul, i) => (
                  <div key={i} style={{ padding: "6px 10px", background: "#0F111708", borderRadius: 4, border: "1px solid #1E213022", fontSize: 10 }}>
                    <span style={{ color: "#6366F1", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{ul.publicIp}</span>
                    <span style={{ color: "#5A6178", marginLeft: 6 }}>{ul.interface} · {ul.connectionType || "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>);
      })()}
    </>}

      {/* ── SolarWinds Tab ── */}
      {networkSecTab === "solarwinds" && <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {solarwindsData && solarwindsData.authenticated && <span style={{ padding: "2px 8px", borderRadius: 4, background: "#00BF6F22", color: "#00BF6F", fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>Connected</span>}
          {solarwindsData && !solarwindsData.authenticated && <span style={{ padding: "2px 8px", borderRadius: 4, background: "#FF444422", color: "#FF6B6B", fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>Auth Issue</span>}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => fetch("/api/solarwinds?refresh=true").then(r => r.json()).then(d => setSolarwindsData(d))} style={{ background: "none", border: "1px solid #1E2130", borderRadius: 4, padding: "2px 8px", fontSize: 9, color: "#5A6178", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace" }}>↻ Refresh</button>
          <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>N-able RMM API</span>
        </span>
      </div>
      {solarwindsLoading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#5A6178" }}>
          <div style={{ fontSize: 24, marginBottom: 8, animation: "spin 1s linear infinite" }}>⟳</div>
          <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>Fetching SolarWinds RMM data...</div>
        </div>
      ) : !solarwindsData ? (
        <div style={{ textAlign: "center", padding: 40, color: "#5A6178" }}>
          <div style={{ fontSize: 24, marginBottom: 8, animation: "spin 1s linear infinite" }}>⟳</div>
          <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>Loading SolarWinds data...</div>
        </div>
      ) : solarwindsData.error ? (
        <div style={{ textAlign: "center", padding: 30 }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontSize: 11, color: "#FF6B6B" }}>Unable to connect to SolarWinds RMM API</div>
          <div style={{ fontSize: 9, color: "#5A6178", marginTop: 4 }}>{solarwindsData.error}</div>
          {!solarwindsData.authenticated && (
            <div style={{ marginTop: 12, padding: 12, background: "#FF444408", borderRadius: 6, border: "1px solid #FF444422" }}>
              <div style={{ fontSize: 10, color: "#FFB347", marginBottom: 6, fontWeight: 600 }}>Troubleshooting:</div>
              <div style={{ fontSize: 9, color: "#8A8FA8", lineHeight: 1.6 }}>
                • Verify API key in N-able RMM Dashboard → Settings → API Keys<br/>
                • Ensure key has not expired or been revoked<br/>
                • Check the correct regional endpoint is configured<br/>
                • Contact VGC admin to regenerate the API key if needed
              </div>
            </div>
          )}
        </div>
      ) : (() => {
        const clients = solarwindsData.clients || [];
        const servers = solarwindsData.servers || [];
        const workstations = solarwindsData.workstations || [];
        return (<>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
            {[
              { label: "Clients", value: String(clients.length), icon: "🏢", color: "#FF8C00" },
              { label: "Servers", value: String(servers.length), icon: "🖥️", color: "#06B6D4" },
              { label: "Workstations", value: String(workstations.length), icon: "💻", color: "#81C784" },
              { label: "Total Endpoints", value: String(servers.length + workstations.length), icon: "📊", color: "#CE93D8" },
            ].map((st, i) => (
              <div key={i} style={{ textAlign: "center", padding: "10px 8px", background: "#0A0C14", borderRadius: 6, border: "1px solid #1E213044" }}>
                <div style={{ fontSize: 14, marginBottom: 4 }}>{st.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: st.color, fontFamily: "'Space Grotesk', sans-serif" }}>{st.value}</div>
                <div style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>{st.label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div style={{ background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #1E213044" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#06B6D4", marginBottom: 10, fontFamily: "'JetBrains Mono', monospace" }}>🖥️ Managed Servers</div>
              {servers.slice(0, 6).map((srv, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 4, marginBottom: 4, background: "#0F111708" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#06B6D4", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: "#C4CAD6", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{srv.name || srv.description || "Server"}</span>
                </div>
              ))}
              {servers.length === 0 && <div style={{ fontSize: 10, color: "#5A617866", textAlign: "center", padding: 8 }}>No servers found</div>}
            </div>
            <div style={{ background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #1E213044" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#81C784", marginBottom: 10, fontFamily: "'JetBrains Mono', monospace" }}>💻 Workstations</div>
              {workstations.slice(0, 6).map((ws, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 4, marginBottom: 4, background: "#0F111708" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#81C784", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: "#C4CAD6", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ws.name || ws.description || "Workstation"}</span>
                </div>
              ))}
              {workstations.length === 0 && <div style={{ fontSize: 10, color: "#5A617866", textAlign: "center", padding: 8 }}>No workstations found</div>}
            </div>
          </div>
        </>);
      })()}
    </>}

      {/* ── Sophos Tab ── */}
      {networkSecTab === "sophos" && <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {sophosData && !sophosData.error && <span style={{ padding: "2px 8px", borderRadius: 4, background: "#0050C822", color: "#64B5F6", fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{(sophosData.firewalls || []).length} Firewalls</span>}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => fetch("/api/sophos?refresh=true").then(r => r.json()).then(d => { if (!d.error) setSophosData(d); })} style={{ background: "none", border: "1px solid #1E2130", borderRadius: 4, padding: "2px 8px", fontSize: 9, color: "#5A6178", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace" }}>↻ Refresh</button>
          <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>Sophos Central API</span>
        </span>
      </div>
      {sophosLoading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#5A6178" }}>
          <div style={{ fontSize: 24, marginBottom: 8, animation: "spin 1s linear infinite" }}>⟳</div>
          <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>Fetching Sophos data...</div>
        </div>
      ) : !sophosData ? (
        <div style={{ textAlign: "center", padding: 40, color: "#5A6178" }}>
          <div style={{ fontSize: 24, marginBottom: 8, animation: "spin 1s linear infinite" }}>⟳</div>
          <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>Loading Sophos data...</div>
        </div>
      ) : sophosData.error ? (
        <div style={{ textAlign: "center", padding: 30, color: "#FF6B6B" }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontSize: 11 }}>Unable to connect to Sophos Central API</div>
          <div style={{ fontSize: 9, color: "#5A6178", marginTop: 4 }}>{sophosData.error}</div>
        </div>
      ) : (() => {
        const fws = sophosData.firewalls || [];
        const groups = sophosData.groups || [];
        const connectedCount = fws.filter(f => f.connected).length;
        return (<>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
            {[
              { label: "Total Firewalls", value: String(fws.length), icon: "🛡️", color: "#0050C8" },
              { label: "Connected", value: String(connectedCount), icon: "●", color: "#00BF6F" },
              { label: "Disconnected", value: String(fws.length - connectedCount), icon: "○", color: fws.length - connectedCount > 0 ? "#FF6B6B" : "#5A6178" },
              { label: "Groups", value: String(groups.length), icon: "📁", color: "#FFB347" },
            ].map((st, i) => (
              <div key={i} style={{ textAlign: "center", padding: "10px 8px", background: "#0A0C14", borderRadius: 6, border: "1px solid #1E213044" }}>
                <div style={{ fontSize: 14, marginBottom: 4 }}>{st.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: st.color, fontFamily: "'Space Grotesk', sans-serif" }}>{st.value}</div>
                <div style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>{st.label}</div>
              </div>
            ))}
          </div>
          {/* Firewall List */}
          <div style={{ background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #1E213044" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64B5F6", marginBottom: 10, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6 }}>
              <span>🔥</span> Managed Firewalls
            </div>
            {fws.map((fw, i) => {
              const hostname = fw.hostname || fw.name || "Unknown";
              const model = fw.model || "—";
              const serial = fw.serialNumber || "—";
              const connected = fw.connected;
              const ip = (fw.externalIps && fw.externalIps[0]) || "—";
              const fwVersion = fw.firmware || "—";
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 6, marginBottom: 6, background: "#0F111708", border: "1px solid #1E213022" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: connected ? "#00BF6F" : "#FF6B6B", boxShadow: connected ? "0 0 6px #00BF6F66" : "0 0 6px #FF6B6B66", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: "#E8ECF4", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fw.name || hostname}</div>
                    <div style={{ fontSize: 9, color: "#64B5F6", marginTop: 1 }}>{hostname}</div>
                    <div style={{ fontSize: 9, color: "#5A6178", marginTop: 1 }}>Model: {model.split("_SFOS")[0]} · Serial: {serial}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: "#6366F1", fontFamily: "'JetBrains Mono', monospace" }}>{ip}</div>
                    <div style={{ fontSize: 8, color: "#5A617888", marginTop: 1 }}>v{fwVersion}</div>
                  </div>
                  <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: connected ? "#00BF6F22" : "#FF444422", color: connected ? "#00BF6F" : "#FF6B6B", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, flexShrink: 0 }}>{connected ? "Online" : "Offline"}</span>
                </div>
              );
            })}
            {fws.length === 0 && <div style={{ fontSize: 10, color: "#5A617866", textAlign: "center", padding: 10 }}>No firewalls found</div>}
          </div>
        </>);
      })()}
    </>}
    </div></DashCard>}

    {/* ═══ SECURITY ALERTS (Both views) ═══ */}
    {cardVisibility.securityAlerts.on && <div style={{ background: "#0F1117", borderRadius: 8, border: securityAlerts.some(a => a.severity === "Critical" && a.status === "Active") ? "1px solid #FF444433" : "1px solid #1E2130", padding: 20, marginBottom: 20, animation: securityAlerts.some(a => a.severity === "Critical" && a.status === "Active") ? "criticalGlow 3s ease-in-out infinite" : "none" }}>
      <h3 style={{ margin: "0 0 16px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span onClick={() => setActiveModule("cybernews")} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
          onMouseEnter={e => e.currentTarget.style.opacity = "0.8"} onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
          <span style={{ color: "#FF6B6B" }}>🛡️</span> Security & Compliance Alerts
          <span style={{ padding: "2px 8px", borderRadius: 4, background: "#FF444422", color: "#FF4444", fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{securityAlerts.filter(a => a.status === "Active").length} ACTIVE</span>
          <span style={{ fontSize: 10, color: "#5A617866", marginLeft: 4 }}>Cyber News →</span>
        </span>
        <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>LAST SCAN: {new Date().toLocaleTimeString()}</span>
      </h3>
      {securityAlerts.map((alert, i) => (
        <div key={alert.id} onClick={() => setActiveModule("cybernews")} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", marginBottom: 6, background: alert.severity === "Critical" && alert.status === "Active" ? "#1A0808" : "#0A0C14", borderRadius: 6, border: `1px solid ${sevColors[alert.severity]}18`, borderLeft: `3px solid ${sevColors[alert.severity]}`, animation: alert.severity === "Critical" && alert.status === "Active" ? "criticalRowFlash 2s ease-in-out infinite" : "none", cursor: "pointer", transition: "background 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.background = sevColors[alert.severity] + "0A"} onMouseLeave={e => e.currentTarget.style.background = alert.severity === "Critical" && alert.status === "Active" ? "#1A0808" : "#0A0C14"}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: sevColors[alert.severity], boxShadow: alert.status === "Active" ? `0 0 8px ${sevColors[alert.severity]}88` : "none", flexShrink: 0, animation: alert.severity === "Critical" && alert.status === "Active" ? "pulse 1.5s infinite" : "none" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "#C4CAD6", marginBottom: 2 }}>{alert.title}</div>
            <div style={{ display: "flex", gap: 8, fontSize: 10 }}>
              <span style={{ color: sevColors[alert.severity], fontWeight: 600 }}>{alert.severity}</span>
              <span style={{ color: "#3A3F55" }}>·</span>
              <span style={{ color: "#5A6178" }}>{alert.type}</span>
              <span style={{ color: "#3A3F55" }}>·</span>
              <span style={{ color: "#5A6178" }}>{alert.time}</span>
            </div>
          </div>
          <Badge color={alert.status === "Active" ? { bg: "#FF444422", text: "#FF6B6B" } : alert.status === "Investigating" ? { bg: "#FFB34722", text: "#FFB347" } : { bg: "#1E2130", text: "#5A6178" }}>{alert.status}</Badge>
        </div>
      ))}
    </div>}

    {/* ═══ AI PERFORMANCE KPI ═══ */}
    {cardVisibility.aiPerformance.on && <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, marginBottom: 20, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, #6366F1, #EC4899, #06B6D4)" }} />
      <h3 onClick={() => setActiveModule("ai")} style={{ margin: "0 0 16px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
        onMouseEnter={e => e.currentTarget.style.color = "#6366F1"} onMouseLeave={e => e.currentTarget.style.color = "#E8ECF4"}>
        <span style={{ color: "#6366F1" }}>🤖</span> AI Performance KPI
        {slaAtRiskCount > 0 && <span onClick={e => { e.stopPropagation(); setActiveModule("ai"); }} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "#FF444422", color: "#FF6B6B", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, cursor: "pointer", animation: "pulse 2s infinite" }}>{slaAtRiskCount} SLA At Risk</span>}
        <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginLeft: "auto" }}>VGC-AI ENGINE v4.0</span>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4CAF50", boxShadow: "0 0 6px #4CAF5088", animation: "pulse 2s infinite" }} />
        <span style={{ fontSize: 10, color: "#5A617866" }}>Configure →</span>
      </h3>
      <div className="vgc-donut-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
        <DonutKPI value={aiConfig.automationLevel} max={100} label="AI Automation" color="#6366F1" sub="Target: 90%" />
        <DonutKPI value={aiTriagedPct} max={100} label="AI Triaged" color="#EC4899" sub={`${incidents.filter(i => i.aiTriaged).length} tickets`} />
        <DonutKPI value={slaCompliance} max={100} label="SLA Compliance" color={slaCompliance >= 90 ? "#4CAF50" : "#FFB347"} sub={slaCompliance >= 90 ? "On track" : "Needs attention"} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 10 }}>
        {[
          { label: "Human-in-Loop", value: `${aiConfig.humanLoopPct}%`, trend: aiConfig.humanLoopPct <= 10 ? "✓ Good" : "Review", color: "#FFB347", icon: "🔄" },
          { label: "Avg Confidence", value: `${avgConfidence}%`, trend: avgConfidence >= 75 ? "✓ Strong" : "Below threshold", color: "#81C784", icon: "🎯" },
          { label: "Last AI Action", value: lastAiActionLabel, trend: lastAiActionTime ? new Date(lastAiActionTime).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" }) : "—", color: "#06B6D4", icon: "⚡" },
        ].map((m, i) => (
          <div key={i} style={{ padding: "10px 12px", background: "#0A0C14", borderRadius: 6, border: "1px solid #1E213044" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 12 }}>{m.icon}</span>
              <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>{m.label}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: m.color, fontFamily: "'Space Grotesk', sans-serif" }}>{m.value}</span>
              <span style={{ fontSize: 10, color: "#4CAF50", fontWeight: 600 }}>{m.trend}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {[
          { label: "KB Auto-Suggest", value: `${kbSuggestPct}%`, trend: kbSuggestPct >= 80 ? "✓ Good" : "Building", color: "#64B5F6", icon: "📖" },
          { label: "Auto-Assign Accuracy", value: `${autoAssignAccuracy}%`, trend: autoAssignAccuracy >= 90 ? "✓ Excellent" : "Learning", color: "#CE93D8", icon: "👤" },
          { label: "SLA Predict Accuracy", value: `${slaPredictAccuracy}%`, trend: slaPredictAccuracy >= 90 ? "✓ On Track" : "At Risk", color: "#4CAF50", icon: "⏱️" },
          { label: "Sentiment Analysis", value: `${sentimentPct}%`, trend: sentimentPct >= 70 ? "✓ Active" : "Building", color: "#FFB347", icon: "💬" },
        ].map((m, i) => (
          <div key={i} style={{ padding: "10px 12px", background: "#0A0C14", borderRadius: 6, border: "1px solid #1E213044" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 12 }}>{m.icon}</span>
              <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>{m.label}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: m.color, fontFamily: "'Space Grotesk', sans-serif" }}>{m.value}</span>
              <span style={{ fontSize: 10, color: "#4CAF50", fontWeight: 600 }}>{m.trend}</span>
            </div>
          </div>
        ))}
      </div>
    </div>}

    {/* ═══ AI WORKLOAD BALANCING & ROOT CAUSE CORRELATION ═══ */}
    {cardVisibility.aiPerformance?.on !== false && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
      {/* ── Workload Balancing Card ── */}
      <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 16, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, #22D3EE, #6366F1)" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 12, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 14 }}>⚖️</span> Workload Balancing
            <span style={{ padding: "1px 6px", borderRadius: 3, background: "#22D3EE22", color: "#22D3EE", fontSize: 9, fontWeight: 600 }}>AI</span>
          </h3>
          <button onClick={async () => {
            setWorkloadLoading(true);
            try {
              const r = await fetch(`${API}/api/ai/workload-rebalance`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ requestedBy: currentUser?.name || "System" }) });
              const d = await r.json();
              setWorkloadData(d);
              if (d.actions?.length) fetchAiActions();
            } catch (e) { console.error(e); }
            setWorkloadLoading(false);
          }} disabled={workloadLoading} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #22D3EE44", background: workloadLoading ? "#22D3EE11" : "#22D3EE18", color: "#22D3EE", fontSize: 10, cursor: workloadLoading ? "wait" : "pointer", fontWeight: 600 }}>
            {workloadLoading ? "Analyzing..." : "🔄 Analyze"}
          </button>
        </div>
        {!workloadData && !workloadLoading && <div style={{ color: "#5A6178", fontSize: 11, padding: "12px 0", textAlign: "center" }}>Click Analyze to scan team workload distribution</div>}
        {workloadData?.analysis && (() => {
          const a = workloadData.analysis;
          const imb = a.imbalanceScore || 0;
          const imbColor = imb >= 70 ? "#FF4444" : imb >= 40 ? "#FFB347" : "#81C784";
          return (<>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 10 }}>
              <div style={{ padding: 8, background: "#0A0C14", borderRadius: 6, textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: imbColor, fontFamily: "'Space Grotesk', sans-serif" }}>{imb}%</div>
                <div style={{ fontSize: 9, color: "#5A6178" }}>Imbalance</div>
              </div>
              <div style={{ padding: 8, background: "#0A0C14", borderRadius: 6, textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#64B5F6", fontFamily: "'Space Grotesk', sans-serif" }}>{(a.reassignments || []).length}</div>
                <div style={{ fontSize: 9, color: "#5A6178" }}>Suggestions</div>
              </div>
              <div style={{ padding: 8, background: "#0A0C14", borderRadius: 6, textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#CE93D8", fontFamily: "'Space Grotesk', sans-serif" }}>{Object.keys(workloadData.workloadMap || {}).length}</div>
                <div style={{ fontSize: 9, color: "#5A6178" }}>Agents</div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#A0AEC0", padding: 8, background: "#0A0C14", borderRadius: 6, marginBottom: 8 }}>{a.summary}</div>
            {(a.reassignments || []).slice(0, 3).map((r, i) => (
              <div key={i} style={{ padding: "6px 8px", marginBottom: 4, background: "#6366F108", borderRadius: 4, border: "1px solid #6366F122", fontSize: 11 }}>
                <span style={{ color: "#64B5F6", fontFamily: "'JetBrains Mono', monospace" }}>{r.ticketId}</span>
                <span style={{ color: "#5A6178", margin: "0 4px" }}>→</span>
                <span style={{ color: "#FF6B6B" }}>{r.from}</span>
                <span style={{ color: "#5A6178", margin: "0 4px" }}>→</span>
                <span style={{ color: "#81C784" }}>{r.to}</span>
                <span style={{ color: "#5A617899", marginLeft: 6, fontSize: 10 }}>{r.reason}</span>
              </div>
            ))}
            {(a.reassignments || []).length > 3 && <div style={{ fontSize: 10, color: "#6366F1", textAlign: "right", marginTop: 4, cursor: "pointer" }} onClick={() => setActiveModule("humanReview")}>+{(a.reassignments || []).length - 3} more in review queue →</div>}
          </>);
        })()}
      </div>

      {/* ── Root Cause Correlation Card ── */}
      <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 16, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, #EC4899, #FF6B6B)" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 12, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 14 }}>🔗</span> Root Cause Correlation
            <span style={{ padding: "1px 6px", borderRadius: 3, background: "#EC489922", color: "#EC4899", fontSize: 9, fontWeight: 600 }}>AI</span>
          </h3>
          <button onClick={async () => {
            setCorrelationLoading(true);
            try {
              const r = await fetch(`${API}/api/ai/correlate-incidents`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ requestedBy: currentUser?.name || "System" }) });
              const d = await r.json();
              setCorrelationData(d);
              if (d.actions?.length) fetchAiActions();
            } catch (e) { console.error(e); }
            setCorrelationLoading(false);
          }} disabled={correlationLoading} style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid #EC489944", background: correlationLoading ? "#EC489911" : "#EC489918", color: "#EC4899", fontSize: 10, cursor: correlationLoading ? "wait" : "pointer", fontWeight: 600 }}>
            {correlationLoading ? "Scanning..." : "🔍 Scan Patterns"}
          </button>
        </div>
        {!correlationData && !correlationLoading && <div style={{ color: "#5A6178", fontSize: 11, padding: "12px 0", textAlign: "center" }}>Click Scan to detect incident patterns & root causes</div>}
        {correlationData?.analysis && (() => {
          const a = correlationData.analysis;
          const risk = a.riskScore || 0;
          const riskColor = risk >= 70 ? "#FF4444" : risk >= 40 ? "#FFB347" : "#81C784";
          return (<>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 10 }}>
              <div style={{ padding: 8, background: "#0A0C14", borderRadius: 6, textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: riskColor, fontFamily: "'Space Grotesk', sans-serif" }}>{risk}%</div>
                <div style={{ fontSize: 9, color: "#5A6178" }}>Risk Score</div>
              </div>
              <div style={{ padding: 8, background: "#0A0C14", borderRadius: 6, textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#EC4899", fontFamily: "'Space Grotesk', sans-serif" }}>{(a.correlations || []).length}</div>
                <div style={{ fontSize: 9, color: "#5A6178" }}>Patterns</div>
              </div>
              <div style={{ padding: 8, background: "#0A0C14", borderRadius: 6, textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#FFB347", fontFamily: "'Space Grotesk', sans-serif" }}>{(a.trends || []).length}</div>
                <div style={{ fontSize: 9, color: "#5A6178" }}>Trends</div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#A0AEC0", padding: 8, background: "#0A0C14", borderRadius: 6, marginBottom: 8 }}>{a.summary}</div>
            {(a.correlations || []).slice(0, 3).map((cor, i) => (
              <div key={i} style={{ padding: "6px 8px", marginBottom: 4, background: cor.severity === "critical" ? "#FF444410" : cor.severity === "high" ? "#FFB34710" : "#6366F108", borderRadius: 4, border: `1px solid ${cor.severity === "critical" ? "#FF444433" : cor.severity === "high" ? "#FFB34733" : "#6366F122"}`, fontSize: 11 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: cor.severity === "critical" ? "#FF4444" : cor.severity === "high" ? "#FFB347" : "#6366F1", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>{cor.severity}</span>
                  <span style={{ color: "#C4CAD6", fontSize: 11 }}>{cor.title}</span>
                  <span style={{ marginLeft: "auto", fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{cor.confidence}%</span>
                </div>
                <div style={{ fontSize: 10, color: "#8B92A8" }}>{cor.description?.substring(0, 100)}</div>
                {cor.affectedTickets?.length > 0 && <div style={{ fontSize: 9, color: "#64B5F6", marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>Affects: {cor.affectedTickets.slice(0, 5).join(", ")}</div>}
              </div>
            ))}
            {(a.trends || []).length > 0 && (
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {(a.trends || []).slice(0, 4).map((t, i) => (
                  <span key={i} style={{ padding: "2px 8px", borderRadius: 10, background: t.direction === "increasing" ? "#FF444418" : t.direction === "decreasing" ? "#81C78418" : "#5A617818", fontSize: 9, color: t.direction === "increasing" ? "#FF6B6B" : t.direction === "decreasing" ? "#81C784" : "#A0AEC0" }}>
                    {t.direction === "increasing" ? "📈" : t.direction === "decreasing" ? "📉" : "➡️"} {t.category} ({t.count})
                  </span>
                ))}
              </div>
            )}
          </>);
        })()}
      </div>
    </div>}

    {/* ═══ Phase 11.1: SLA COUNTDOWN TRACKER ═══ */}
    {cardVisibility.slaCountdown?.on && <SlaCountdownWidget incidents={incidents} computeIncidentSla={computeIncidentSla} setActiveModule={setActiveModule} />}

    {/* ═══ v3.28.0: Reassign Suggestions ═══ */}
    <ReassignSuggestionsWidget setActiveModule={setActiveModule} />

    {/* ═══ v3.31.1 (Phase 1): Anomaly Alerts ═══ */}
    <AnomalyAlertWidget setActiveModule={setActiveModule} />

    {/* ═══ Phase 11.2 & 11.3: INCIDENT HEATMAP + AI CONFIDENCE TRENDS ═══ */}
    {(cardVisibility.incidentHeatmap?.on || cardVisibility.aiConfTrend?.on) && (
      <div style={{ display: "grid", gridTemplateColumns: cardVisibility.incidentHeatmap?.on && cardVisibility.aiConfTrend?.on ? "1fr 1fr" : "1fr", gap: 16, marginBottom: 20 }}>
        {cardVisibility.incidentHeatmap?.on && <IncidentHeatmapWidget incidents={incidents} />}
        {cardVisibility.aiConfTrend?.on && <AiConfidenceWidget incidents={incidents} />}
      </div>
    )}

    {/* ═══ GLOBAL CYBER SECURITY THREAT FEED ═══ */}
    {cardVisibility.threatFeed.on && <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, marginBottom: 20, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, #FF4444, #FF6B6B, #FFB347)" }} />
      <h3 style={{ margin: "0 0 16px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span onClick={() => setActiveModule("cybernews")} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
          onMouseEnter={e => e.currentTarget.style.opacity = "0.8"} onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
          <span style={{ fontSize: 16 }}>🌐</span> Global Cyber Security Threat Feed
          <span style={{ padding: "2px 8px", borderRadius: 4, background: "#FF444422", color: "#FF4444", fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>LIVE</span>
          <span style={{ fontSize: 10, color: "#5A617866", marginLeft: 4 }}>Cyber News →</span>
        </span>
        <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>Source: CISA · NVD · CVE · SingCERT · The Hacker News · SecurityWeek · Dark Reading</span>
      </h3>
      {(dashboardThreats.length > 0 ? dashboardThreats : [
        { id: "GTHR-001", severity: "Critical", title: "Active exploitation of CVE-2026-21413 — Microsoft Exchange RCE", source: "CISA", sourceUrl: "https://www.cisa.gov/news-events/cybersecurity-advisories", region: "Global", time: "28 min ago", isNew: true,
          aiSummary: "Zero-day RCE in Exchange Server 2019 CU14. Patch available (KB5035432). Our Exchange cluster CHG0001 upgrade should be prioritized. Recommend: 1) Apply emergency patch within 4 hours, 2) Enable WAF rule for OWA endpoints, 3) Scan mail server logs for indicators of compromise.",
          affectsUs: true },
        { id: "GTHR-002", severity: "High", title: "Ransomware campaign targeting APAC financial services — LockBit 4.0 variant", source: "SingCERT", sourceUrl: "https://www.csa.gov.sg/alerts-advisories", region: "APAC", time: "2 hr ago", isNew: true,
          aiSummary: "LockBit 4.0 variant using phishing emails with .iso attachments. Our DLP alert SEC-005 may be related. Recommend: 1) Block .iso attachments at email gateway, 2) Alert all staff via Teams, 3) Verify EDR signatures are updated, 4) Check backup integrity.",
          affectsUs: true },
        { id: "GTHR-003", severity: "High", title: "Critical vulnerability in Fortinet FortiOS SSL VPN — CVE-2026-48788", source: "NVD / CVE", sourceUrl: "https://nvd.nist.gov/", region: "Global", time: "5 hr ago", isNew: false,
          aiSummary: "Our VPN infrastructure uses Cisco, not FortiOS. Low direct risk but monitor for lateral exploitation patterns. Keep VPN client patched as a precaution.",
          affectsUs: false },
        { id: "GTHR-004", severity: "Medium", title: "DNS amplification attacks increase 340% across Southeast Asia ISPs", source: "CSA Singapore", sourceUrl: "https://www.csa.gov.sg/singcert", region: "SEA", time: "8 hr ago", isNew: false,
          aiSummary: "DNS amplification targeting SEA region. Our Azure Front Door WAF provides DDoS protection. Verify rate-limiting rules are active. No immediate action required.",
          affectsUs: false },
        { id: "GTHR-005", severity: "Low", title: "Updated IoC list for SolarWinds Serv-U FTP vulnerability", source: "CISA", sourceUrl: "https://www.cisa.gov/news-events/cybersecurity-advisories", region: "Global", time: "12 hr ago", isNew: false,
          aiSummary: "We do not use SolarWinds Serv-U. No action required. IoC list archived for reference.",
          affectsUs: false },
      ]).slice(0, 3).map((threat, i) => (
        <div key={threat.id} style={{
          padding: "12px 14px", marginBottom: 8, background: threat.isNew ? "#FF444408" : "#0A0C14",
          borderRadius: 8, border: `1px solid ${threat.isNew ? sevColors[threat.severity] + '33' : '#1E213044'}`,
          borderLeft: `3px solid ${sevColors[threat.severity]}`,
          position: "relative"
        }}>
          {threat.isNew && threat.severity === "Critical" && (
            <div style={{ position: "absolute", top: -1, right: -1, padding: "2px 8px", borderRadius: "0 8px 0 6px", background: "#FF4444", color: "#fff", fontSize: 9, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", animation: "pulse 2s infinite" }}>⚡ ACTION REQUIRED</div>
          )}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: sevColors[threat.severity], boxShadow: threat.isNew ? `0 0 8px ${sevColors[threat.severity]}88` : "none", marginTop: 4, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: sevColors[threat.severity], fontFamily: "'JetBrains Mono', monospace" }}>{threat.severity.toUpperCase()}</span>
                <span style={{ fontSize: 9, color: "#3A3F55" }}>·</span>
                <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{threat.id}</span>
                <span style={{ fontSize: 9, color: "#3A3F55" }}>·</span>
                <a href={threat.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ padding: "1px 6px", borderRadius: 3, background: "#1E2130", fontSize: 9, color: "#64B5F6", textDecoration: "none", cursor: "pointer" }} title={`View source: ${threat.sourceUrl}`}>{threat.source} ↗</a>
                <span style={{ padding: "1px 6px", borderRadius: 3, background: "#1E2130", fontSize: 9, color: "#64B5F6" }}>{threat.region}</span>
                {threat.affectsUs && <span style={{ padding: "1px 6px", borderRadius: 3, background: "#FF444422", fontSize: 9, color: "#FF6B6B", fontWeight: 600 }}>AFFECTS US</span>}
                <span style={{ fontSize: 9, color: "#5A6178", marginLeft: "auto" }}>{threat.time}</span>
              </div>
              <div style={{ fontSize: 12, color: "#C4CAD6", marginBottom: 6 }}>{threat.title}</div>
              <div style={{ padding: "8px 10px", background: "#6366F108", borderRadius: 6, border: "1px solid #6366F122" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 12 }}>🤖</span>
                  <span style={{ fontSize: 10, color: "#6366F1", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>AI ANALYSIS & RECOMMENDED ACTIONS</span>
                </div>
                <div style={{ fontSize: 11, color: "#A0AEC0", lineHeight: 1.5 }}>{threat.aiSummary}</div>
              </div>
            </div>
          </div>
        </div>
      ))}
      <div onClick={() => setActiveModule("cybernews")} style={{ textAlign: "center", padding: "8px 0", cursor: "pointer", fontSize: 11, color: "#64B5F6", fontFamily: "'JetBrains Mono', monospace", borderTop: "1px solid #1E213044", marginTop: 4 }}
        onMouseEnter={e => e.currentTarget.style.color = "#90CAF9"} onMouseLeave={e => e.currentTarget.style.color = "#64B5F6"}>
        View all threats in Cyber News →
      </div>
    </div>}

    {/* ═══ WORKFLOW & ARCHITECTURE HUB ═══ */}
    {cardVisibility.workflowHub.on && <DashCard id="workflowHub"><div style={{ background: "linear-gradient(135deg, #0C0D12 0%, #141419 50%, #0C0D12 100%)", borderRadius: 12, border: "1px solid #27272A", padding: 28, position: "relative", overflow: "hidden" }}>
      {/* Animated gradient top accent */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, #22D3EE, #818CF8, #EC4899, #FFB347, #4CAF50, #CE93D8, #22D3EE)", backgroundSize: "200% 100%", animation: "gradientSlide 4s linear infinite" }} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22, animation: "wfIconPulse 2s ease-in-out infinite" }}>🔄</span>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#FAFAFA", fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "-0.02em" }}>How ITSM Works</h3>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4CAF50", animation: "wfPulseLive 1.5s ease-in-out infinite" }} />
            <span style={{ fontSize: 9, color: "#4CAF50", fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}>ALL ENGINES ACTIVE</span>
          </div>
          <span style={{ fontSize: 9, color: "#71717A66", fontFamily: "'JetBrains Mono', monospace" }}>v{APP_VERSION.version}</span>
        </div>
      </div>

      {/* Tab Selector */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#09090B", padding: 4, borderRadius: 10, border: "1px solid #27272A44" }}>
        {[
          { id: "pipeline", label: "Pipeline Guide", icon: "🔄" },
          { id: "detail", label: "Email-to-Resolution", icon: "📬" },
          { id: "arch", label: "Architecture", icon: "🏗️" },
        ].map(t => (
          <button key={t.id} onClick={() => setWorkflowHubTab(t.id)}
            style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              background: workflowHubTab === t.id ? "linear-gradient(135deg, #818CF820, #22D3EE15)" : "transparent",
              color: workflowHubTab === t.id ? "#22D3EE" : "#71717A",
              borderBottom: workflowHubTab === t.id ? "2px solid #22D3EE" : "2px solid transparent",
            }}>
            <span style={{ fontSize: 14 }}>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* ── Pipeline Guide Tab ── */}
      {workflowHubTab === "pipeline" && <>
      {/* Pipeline Description */}
      <div style={{ fontSize: 12, color: "#A1A1AA", lineHeight: 1.7, marginBottom: 20, padding: "12px 16px", background: "#09090B", borderRadius: 10, border: "1px solid #27272A44" }}>
        <span style={{ color: "#818CF8", fontWeight: 700 }}>End-to-end automation pipeline:</span> Zendesk tickets automatically sync into ITSM, get AI-triaged for category & priority, monitored against SLA targets, processed by workflow rules, auto-resolved by AI when idle, and auto-closed after 72 hours. Click any step below to navigate.
      </div>

      {/* ── Animated 7-Step Pipeline Flow ── */}
      <div style={{ padding: "24px 12px", background: "linear-gradient(135deg, #09090B, #0C0D12)", borderRadius: 12, border: "1px solid #27272A44", marginBottom: 20 }}>
        <div style={{ fontSize: 9, color: "#71717A88", textAlign: "center", marginBottom: 18, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1.5 }}>AUTOMATION PIPELINE — CLICK ANY STEP TO NAVIGATE</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0, flexWrap: "wrap" }}>
          {[
            { label: "Zendesk Sync", icon: "📨", color: "#22D3EE", desc: "Auto-sync every 5min", metric: zdLinkedCount, metricLabel: "linked", target: "zendesk", delay: "0s" },
            null,
            { label: "AI Triage", icon: "🤖", color: "#EC4899", desc: "Category & priority", metric: aiTriagedCount, metricLabel: "triaged", target: "ai", delay: "0.4s" },
            null,
            { label: "SLA Monitor", icon: "⏱️", color: "#FFB347", desc: "Breach alerts at 75%", metric: `${slaCompliance}%`, metricLabel: "compliance", target: "slaApprovals", delay: "0.8s" },
            null,
            { label: "Workflow Rules", icon: "⚙️", color: "#818CF8", desc: "Escalate & auto-close", metric: 132, metricLabel: "rules", target: "admin", delay: "1.2s" },
            null,
            { label: "AI Resolve", icon: "🧠", color: "#4CAF50", desc: "GPT resolves idle >2hrs", metric: zdAiQueue.filter(q => q.status === "pending_approval").length, metricLabel: "pending", target: "humanReview", delay: "1.6s" },
            null,
            { label: "Notify", icon: "🔔", color: "#CE93D8", desc: "Email · Teams · In-App", metric: "Active", metricLabel: "", target: "admin", delay: "2.0s" },
            null,
            { label: "Auto-Close", icon: "✅", color: "#81C784", desc: "Resolved → Closed 72h", metric: resolvedIncs.length, metricLabel: "closed", target: "tickets", delay: "2.4s" },
          ].map((step, i) => step === null ? (
            <div key={`wf-arrow-${i}`} style={{ display: "flex", alignItems: "center", padding: "0 2px" }}>
              <div style={{ width: 28, height: 2, background: "linear-gradient(90deg, #27272A00, #818CF8, #27272A00)", position: "relative" }}>
                <div style={{ position: "absolute", right: -4, top: -3, width: 0, height: 0, borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: "7px solid #818CF8" }} />
                <div style={{ position: "absolute", left: 0, top: -1, width: 4, height: 4, borderRadius: "50%", background: "#818CF8", animation: `flowDot ${1.8 + i * 0.2}s ease-in-out infinite` }} />
              </div>
            </div>
          ) : (
            <div key={step.label} onClick={() => setActiveModule(step.target)}
              style={{
                textAlign: "center", padding: "14px 12px", borderRadius: 12, background: `linear-gradient(135deg, ${step.color}0A, ${step.color}05)`,
                border: `1px solid ${step.color}25`, cursor: "pointer", minWidth: 100, maxWidth: 115,
                transition: "all 0.25s ease", position: "relative",
                animation: `wfCardFloat 3s ease-in-out ${step.delay} infinite`,
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-5px) scale(1.04)"; e.currentTarget.style.boxShadow = `0 12px 32px ${step.color}22`; e.currentTarget.style.borderColor = `${step.color}55`; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = `${step.color}25`; }}>
              {/* Step number */}
              <div style={{ position: "absolute", top: 5, left: 7, fontSize: 8, color: `${step.color}55`, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{Math.floor(i/2)+1}</div>
              {/* Live pulse dot */}
              <div style={{ position: "absolute", top: 6, right: 6, width: 5, height: 5, borderRadius: "50%", background: "#4CAF50", animation: "wfPulseLive 1.5s ease-in-out infinite" }} />
              {/* Animated icon with glow */}
              <div style={{ fontSize: 26, marginBottom: 6, filter: `drop-shadow(0 2px 6px ${step.color}33)` }}>{step.icon}</div>
              {/* Label */}
              <div style={{ fontSize: 11, fontWeight: 700, color: step.color, fontFamily: "'Space Grotesk', sans-serif", marginBottom: 3, lineHeight: 1.2, letterSpacing: "-0.01em" }}>{step.label}</div>
              {/* Description */}
              <div style={{ fontSize: 8, color: "#71717A", lineHeight: 1.3, marginBottom: 6 }}>{step.desc}</div>
              {/* Live metric badge */}
              <div style={{ display: "inline-block", padding: "3px 10px", borderRadius: 6, background: `${step.color}15`, border: `1px solid ${step.color}33` }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: step.color, fontFamily: "'JetBrains Mono', monospace" }}>{step.metric}</span>
                {step.metricLabel && <span style={{ fontSize: 7, color: `${step.color}99`, marginLeft: 3, textTransform: "uppercase" }}>{step.metricLabel}</span>}
              </div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 14, fontSize: 9, color: "#71717A55", fontFamily: "'JetBrains Mono', monospace" }}>
          ← Click any step to navigate · Arrows show automated data flow →
        </div>
      </div>

      {/* ── Quick Start Actions ── */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 11, color: "#A1A1AA", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12 }}>⚡</span> Quick Start
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {[
            { icon: "🎫", title: "Create Ticket", desc: "Open a new incident", color: "#FF6B6B", hoverAnim: "iconBounce", action: () => { setActiveModule("incidents"); setModal("newIncident"); } },
            { icon: "🔄", title: "Sync Zendesk", desc: "Align all statuses now", color: "#22D3EE", hoverAnim: "iconSpin", action: async () => {
              try {
                const resp = await fetch("/api/zendesk/sync-all-statuses", { method: "POST" });
                const data = await resp.json();
                showToast(`✅ Sync complete: ${data.updated || 0} updated, ${data.alreadyMatched || 0} matched`, "success");
                const inc = await fetch("/api/db/incidents").then(r => r.json());
                if (Array.isArray(inc)) setIncidents(inc.filter(i => !i._deleted));
              } catch (err) { showToast("❌ Sync failed: " + err.message, "error"); }
            } },
            { icon: "📊", title: "View Analytics", desc: "Reports & dashboards", color: "#818CF8", hoverAnim: "iconBounce", action: () => setActiveModule("analytics") },
          ].map((card, i) => (
            <div key={i} onClick={card.action}
              style={{
                padding: "14px 16px", borderRadius: 10, background: "#09090B",
                border: `1px solid ${card.color}22`, borderLeft: `3px solid ${card.color}`,
                cursor: "pointer", transition: "all 0.2s ease", display: "flex", alignItems: "center", gap: 12,
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = `${card.color}44`; e.currentTarget.style.boxShadow = `0 4px 16px ${card.color}15`; const icon = e.currentTarget.querySelector('.qs-icon'); if (icon) icon.style.animation = `${card.hoverAnim} 0.5s ease`; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.borderColor = `${card.color}22`; e.currentTarget.style.boxShadow = "none"; const icon = e.currentTarget.querySelector('.qs-icon'); if (icon) icon.style.animation = "none"; }}>
              <span className="qs-icon" style={{ fontSize: 22, flexShrink: 0 }}>{card.icon}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#FAFAFA", fontFamily: "'Space Grotesk', sans-serif", marginBottom: 2 }}>{card.title}</div>
                <div style={{ fontSize: 10, color: "#71717A" }}>{card.desc}</div>
              </div>
              <span style={{ marginLeft: "auto", fontSize: 12, color: `${card.color}66`, transition: "transform 0.2s" }}>→</span>
            </div>
          ))}
        </div>
      </div>
    </>}

      {/* ── Email-to-Resolution Tab ── */}
      {workflowHubTab === "detail" && <>
      {/* Description */}
      <div style={{ fontSize: 12, color: "#A1A1AA", lineHeight: 1.7, marginBottom: 20, padding: "12px 16px", background: "#09090B", borderRadius: 10, border: "1px solid #27272A44" }}>
        <span style={{ color: "#4CAF50", fontWeight: 700 }}>Complete incident lifecycle:</span> When a user sends an email to <span style={{ color: "#22D3EE", fontFamily: "'JetBrains Mono', monospace" }}>helpdesk@vgctechnology.com</span>, the system processes it through a 10-step automated pipeline — from email filtering through AI-powered resolution to automatic closure. Every step is audited and tracked.
      </div>

      {/* ── 10-Step Detailed Vertical Flow ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* LEFT COLUMN — Steps 1-5 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {[
            { step: 1, label: "Email Received", icon: "📧", color: "#22D3EE", desc: "User sends email to helpdesk@vgctechnology.com", detail: "Microsoft Graph API polls inbox every 5 minutes for new emails from approved domains", status: "Auto" },
            { step: 2, label: "5-Gate Security Filter", icon: "🛡️", color: "#FF6B6B", desc: "Validates sender domain, format & duplicates", detail: "Gate 1: Allowed domain check · Gate 2: Valid email format · Gate 3: Non-empty body · Gate 4: Duplicate detection · Gate 5: Spam/auto-reply filter", status: "Strict" },
            { step: 3, label: "Ticket Created", icon: "🎫", color: "#818CF8", desc: "INC-XXXX auto-generated with all metadata", detail: "Incident ID assigned, email body mapped to description, sender → requester, attachments linked, source tagged as 'email'", status: "Instant" },
            { step: 4, label: "AI Auto-Triage", icon: "🤖", color: "#EC4899", desc: "GPT classifies category, priority & urgency", detail: "Azure OpenAI analyzes subject + body → assigns category (Network/Hardware/Software/Access), priority (P1-P4), and initial assessment", status: `${aiTriagedCount} done` },
            { step: 5, label: "Smart Assignment", icon: "👤", color: "#FFB347", desc: "Routes to correct team based on rules", detail: "Workflow engine matches category + priority to assignment rules → auto-assigns to team/individual based on skills matrix & workload", status: "Auto" },
          ].map((s, i) => (
            <React.Fragment key={s.step}>
              <div style={{
                padding: "14px 16px", borderRadius: 12, background: `linear-gradient(135deg, ${s.color}08, ${s.color}04)`,
                border: `1px solid ${s.color}20`, position: "relative",
                animation: `wfCardFloat 3s ease-in-out ${i * 0.3}s infinite`,
                transition: "all 0.25s ease", cursor: "default",
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateX(4px)"; e.currentTarget.style.borderColor = `${s.color}55`; e.currentTarget.style.boxShadow = `0 6px 24px ${s.color}15`; e.currentTarget.querySelector('.wfd-detail').style.maxHeight = "60px"; e.currentTarget.querySelector('.wfd-detail').style.opacity = "1"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.borderColor = `${s.color}20`; e.currentTarget.style.boxShadow = "none"; e.currentTarget.querySelector('.wfd-detail').style.maxHeight = "0"; e.currentTarget.querySelector('.wfd-detail').style.opacity = "0"; }}>
                {/* Step number badge */}
                <div style={{ position: "absolute", top: -8, left: 14, padding: "2px 8px", borderRadius: 6, background: s.color, fontSize: 9, fontWeight: 700, color: "#0C0D12", fontFamily: "'JetBrains Mono', monospace" }}>STEP {s.step}</div>
                {/* Status badge */}
                <div style={{ position: "absolute", top: 8, right: 10, fontSize: 8, color: s.color, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, background: `${s.color}15`, padding: "2px 6px", borderRadius: 4 }}>{s.status}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                  <span style={{ fontSize: 24, filter: `drop-shadow(0 2px 6px ${s.color}33)` }}>{s.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: s.color, fontFamily: "'Space Grotesk', sans-serif", marginBottom: 2 }}>{s.label}</div>
                    <div style={{ fontSize: 10, color: "#A1A1AA", lineHeight: 1.3 }}>{s.desc}</div>
                  </div>
                </div>
                {/* Expandable detail on hover */}
                <div className="wfd-detail" style={{ maxHeight: 0, opacity: 0, overflow: "hidden", transition: "all 0.3s ease", marginTop: 8, padding: "0 4px" }}>
                  <div style={{ fontSize: 9, color: "#71717A", lineHeight: 1.5, padding: "8px 10px", background: "#09090B", borderRadius: 8, border: `1px solid ${s.color}15` }}>{s.detail}</div>
                </div>
              </div>
              {/* Vertical connector arrow */}
              {i < 4 && <div style={{ display: "flex", justifyContent: "center", padding: "2px 0" }}>
                <div style={{ width: 2, height: 20, background: `linear-gradient(180deg, ${s.color}44, ${[
                  "#FF6B6B", "#818CF8", "#EC4899", "#FFB347"
                ][i]}44)`, position: "relative" }}>
                  <div style={{ position: "absolute", bottom: -4, left: -3, width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: `6px solid ${[
                    "#FF6B6B", "#818CF8", "#EC4899", "#FFB347"
                  ][i]}` }} />
                  <div style={{ position: "absolute", top: 0, left: -1, width: 4, height: 4, borderRadius: "50%", background: s.color, animation: `flowDotDown ${1.5 + i * 0.2}s ease-in-out infinite` }} />
                </div>
              </div>}
            </React.Fragment>
          ))}
        </div>

        {/* RIGHT COLUMN — Steps 6-10 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {[
            { step: 6, label: "SLA Timer Started", icon: "⏱️", color: "#FFB347", desc: "Response & resolution clocks begin", detail: `P1: 1hr response / 4hr resolve · P2: 4hr / 24hr · P3: 8hr / 72hr · P4: 24hr / 168hr — breach alerts at 75% threshold`, status: `${slaCompliance}%` },
            { step: 7, label: "Acknowledgement Email", icon: "✉️", color: "#4CAF50", desc: "Professional confirmation sent to requester", detail: "Enterprise-format HTML email with ticket number, category, priority, expected SLA, and point of contact — branded VGC template", status: "Auto" },
            { step: 8, label: "AI Follow-Up & Resolution", icon: "🧠", color: "#818CF8", desc: "AI generates customer response & workarounds", detail: "After analysis: AI drafts professional resolution email with step-by-step instructions, official references, and KB links — queued for auto-send or engineer review", status: "GPT" },
            { step: 9, label: "Notification & Escalation", icon: "🔔", color: "#CE93D8", desc: "Multi-channel alerts to all stakeholders", detail: "Email + Teams + In-App notifications — if SLA breaches: auto-escalate to senior engineer → manager → head of IT (3-tier escalation matrix)", status: "Active" },
            { step: 10, label: "Auto-Close & Archive", icon: "✅", color: "#81C784", desc: "Resolved tickets auto-close after 72 hours", detail: "Resolved incidents auto-close after 72hr inactivity. Final closure email sent. Full audit trail preserved. AI learns from resolution pattern for future automation", status: `${resolvedIncs.length} closed` },
          ].map((s, i) => (
            <React.Fragment key={s.step}>
              <div style={{
                padding: "14px 16px", borderRadius: 12, background: `linear-gradient(135deg, ${s.color}08, ${s.color}04)`,
                border: `1px solid ${s.color}20`, position: "relative",
                animation: `wfCardFloat 3s ease-in-out ${(i + 5) * 0.3}s infinite`,
                transition: "all 0.25s ease", cursor: "default",
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateX(4px)"; e.currentTarget.style.borderColor = `${s.color}55`; e.currentTarget.style.boxShadow = `0 6px 24px ${s.color}15`; e.currentTarget.querySelector('.wfd-detail').style.maxHeight = "60px"; e.currentTarget.querySelector('.wfd-detail').style.opacity = "1"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.borderColor = `${s.color}20`; e.currentTarget.style.boxShadow = "none"; e.currentTarget.querySelector('.wfd-detail').style.maxHeight = "0"; e.currentTarget.querySelector('.wfd-detail').style.opacity = "0"; }}>
                <div style={{ position: "absolute", top: -8, left: 14, padding: "2px 8px", borderRadius: 6, background: s.color, fontSize: 9, fontWeight: 700, color: "#0C0D12", fontFamily: "'JetBrains Mono', monospace" }}>STEP {s.step}</div>
                <div style={{ position: "absolute", top: 8, right: 10, fontSize: 8, color: s.color, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, background: `${s.color}15`, padding: "2px 6px", borderRadius: 4 }}>{s.status}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                  <span style={{ fontSize: 24, filter: `drop-shadow(0 2px 6px ${s.color}33)` }}>{s.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: s.color, fontFamily: "'Space Grotesk', sans-serif", marginBottom: 2 }}>{s.label}</div>
                    <div style={{ fontSize: 10, color: "#A1A1AA", lineHeight: 1.3 }}>{s.desc}</div>
                  </div>
                </div>
                <div className="wfd-detail" style={{ maxHeight: 0, opacity: 0, overflow: "hidden", transition: "all 0.3s ease", marginTop: 8, padding: "0 4px" }}>
                  <div style={{ fontSize: 9, color: "#71717A", lineHeight: 1.5, padding: "8px 10px", background: "#09090B", borderRadius: 8, border: `1px solid ${s.color}15` }}>{s.detail}</div>
                </div>
              </div>
              {i < 4 && <div style={{ display: "flex", justifyContent: "center", padding: "2px 0" }}>
                <div style={{ width: 2, height: 20, background: `linear-gradient(180deg, ${s.color}44, ${[
                  "#4CAF50", "#818CF8", "#CE93D8", "#81C784"
                ][i]}44)`, position: "relative" }}>
                  <div style={{ position: "absolute", bottom: -4, left: -3, width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: `6px solid ${[
                    "#4CAF50", "#818CF8", "#CE93D8", "#81C784"
                  ][i]}` }} />
                  <div style={{ position: "absolute", top: 0, left: -1, width: 4, height: 4, borderRadius: "50%", background: s.color, animation: `flowDotDown ${1.5 + i * 0.2}s ease-in-out infinite` }} />
                </div>
              </div>}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* ── Cross-connector between columns ── */}
      <div style={{ display: "flex", justifyContent: "center", margin: "-8px 0 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 16px", borderRadius: 8, background: "#09090B", border: "1px solid #27272A44" }}>
          <div style={{ width: 24, height: 2, background: "linear-gradient(90deg, #FFB34700, #FFB347)", position: "relative" }}>
            <div style={{ position: "absolute", right: -3, top: -3, width: 0, height: 0, borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: "6px solid #FFB347" }} />
          </div>
          <span style={{ fontSize: 9, color: "#71717A", fontFamily: "'JetBrains Mono', monospace" }}>Step 5 → Step 6 (Assignment triggers SLA)</span>
          <div style={{ width: 24, height: 2, background: "linear-gradient(90deg, #FFB347, #FFB34700)", position: "relative" }}>
            <div style={{ position: "absolute", right: -3, top: -3, width: 0, height: 0, borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: "6px solid #FFB34744" }} />
          </div>
        </div>
      </div>

      {/* ── Key Metrics Bar ── */}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px", background: "#09090B", borderRadius: 10, border: "1px solid #27272A44" }}>
        {[
          { label: "Avg Ticket Creation", value: "<30s", color: "#22D3EE" },
          { label: "AI Triage Accuracy", value: `${aiTriagedPct}%`, color: "#EC4899" },
          { label: "SLA Compliance", value: `${slaCompliance}%`, color: "#FFB347" },
          { label: "Auto-Resolve Rate", value: `${computedFCR}%`, color: "#4CAF50" },
          { label: "Avg Resolution", value: "<4hrs", color: "#818CF8" },
        ].map((m, i) => (
          <div key={i} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: m.color, fontFamily: "'Space Grotesk', sans-serif", animation: `wfCardFloat 3s ease-in-out ${i * 0.5}s infinite` }}>{m.value}</div>
            <div style={{ fontSize: 8, color: "#71717A", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>{m.label}</div>
          </div>
        ))}
      </div>
    </>}

      {/* ── Architecture Tab ── */}
      {workflowHubTab === "arch" && <>
      {/* 3-Layer Architecture */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1.5fr auto 1fr", alignItems: "center", gap: 0, padding: "16px 0" }}>
        {/* INPUT LAYER */}
        <div>
          <div style={{ fontSize: 9, color: "#22D3EE", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 12, textAlign: "center", fontWeight: 600 }}>INPUT SOURCES</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { icon: "🎫", label: "Zendesk", desc: "Ticket sync", color: "#22D3EE", metric: zdLinkedCount, click: () => setActiveModule("zendesk") },
              { icon: "📧", label: "Email", desc: "Inbound parse", color: "#818CF8", metric: "Auto", click: () => setActiveModule("admin") },
              { icon: "🌐", label: "Portal", desc: "Self-service", color: "#EC4899", metric: "Active", click: () => setActiveModule("incidents") },
            ].map((src, i) => (
              <div key={i} onClick={src.click} style={{
                padding: "10px 12px", borderRadius: 10, background: `${src.color}08`,
                border: `1px solid ${src.color}20`, cursor: "pointer", transition: "all 0.2s",
                display: "flex", alignItems: "center", gap: 8, animation: `subtleFloat ${3 + i * 0.5}s ease-in-out infinite`,
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = `${src.color}55`; e.currentTarget.style.boxShadow = `0 4px 16px ${src.color}15`; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = `${src.color}20`; e.currentTarget.style.boxShadow = "none"; }}>
                <span style={{ fontSize: 18 }}>{src.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: src.color, fontFamily: "'Space Grotesk', sans-serif" }}>{src.label}</div>
                  <div style={{ fontSize: 8, color: "#71717A" }}>{src.desc}</div>
                </div>
                <span style={{ fontSize: 10, color: src.color, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, background: `${src.color}15`, padding: "2px 6px", borderRadius: 4 }}>{src.metric}</span>
              </div>
            ))}
          </div>
        </div>

        {/* LEFT CONNECTOR */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "0 8px" }}>
          {[0,1,2].map(i => (
            <div key={i} style={{ width: 40, height: 2, background: "linear-gradient(90deg, #22D3EE44, #818CF8)", position: "relative" }}>
              <div style={{ position: "absolute", right: -3, top: -3, width: 0, height: 0, borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: "6px solid #818CF8" }} />
              <div style={{ position: "absolute", left: 0, top: -1.5, width: 5, height: 5, borderRadius: "50%", background: "#22D3EE", animation: `archDataFlow ${2 + i * 0.3}s ease-in-out infinite` }} />
            </div>
          ))}
        </div>

        {/* PROCESSING HUB */}
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 9, color: "#818CF8", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 12, textAlign: "center", fontWeight: 600 }}>PROCESSING ENGINE</div>
          {/* Central hub */}
          <div style={{
            position: "relative", padding: 16, borderRadius: 14,
            background: "linear-gradient(135deg, #141419, #18181B)",
            border: "1px solid #27272A", boxShadow: "0 8px 32px #00000044",
          }}>
            {/* Orbiting ring */}
            <div style={{ position: "absolute", inset: -4, borderRadius: 18, border: "1px dashed #818CF822", animation: "archHubOrbit 12s linear infinite" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { icon: "🤖", label: "AI Triage", color: "#EC4899", stat: `${aiTriagedCount}`, click: () => setActiveModule("ai") },
                { icon: "⏱️", label: "SLA Engine", color: "#FFB347", stat: `${slaCompliance}%`, click: () => setActiveModule("slaApprovals") },
                { icon: "⚙️", label: "Workflow", color: "#818CF8", stat: "132", click: () => setActiveModule("admin") },
                { icon: "🔔", label: "Notify", color: "#CE93D8", stat: "Active", click: () => setActiveModule("admin") },
              ].map((eng, i) => (
                <div key={i} onClick={eng.click} style={{
                  padding: "10px 8px", borderRadius: 10, background: `${eng.color}08`,
                  border: `1px solid ${eng.color}18`, textAlign: "center", cursor: "pointer",
                  transition: "all 0.2s", position: "relative",
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = `${eng.color}44`; e.currentTarget.style.boxShadow = `0 0 20px ${eng.color}15`; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = `${eng.color}18`; e.currentTarget.style.boxShadow = "none"; }}>
                  <div style={{ fontSize: 20, marginBottom: 4, filter: `drop-shadow(0 0 6px ${eng.color}33)` }}>{eng.icon}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: eng.color, fontFamily: "'Space Grotesk', sans-serif", marginBottom: 2 }}>{eng.label}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: eng.color, fontFamily: "'JetBrains Mono', monospace" }}>{eng.stat}</div>
                </div>
              ))}
            </div>
            {/* Central AI brain */}
            <div style={{
              position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
              width: 32, height: 32, borderRadius: "50%",
              background: "linear-gradient(135deg, #818CF8, #22D3EE)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 20px #818CF844, 0 0 40px #22D3EE22",
              animation: "archNodeGlow 3s ease-in-out infinite", fontSize: 14, zIndex: 2,
            }}>🧠</div>
          </div>
        </div>

        {/* RIGHT CONNECTOR */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "0 8px" }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ width: 40, height: 2, background: "linear-gradient(90deg, #818CF8, #4CAF5044)", position: "relative" }}>
              <div style={{ position: "absolute", right: -3, top: -3, width: 0, height: 0, borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: "6px solid #4CAF50" }} />
              <div style={{ position: "absolute", left: 0, top: -1.5, width: 5, height: 5, borderRadius: "50%", background: "#818CF8", animation: `archDataFlow ${2.2 + i * 0.25}s ease-in-out infinite` }} />
            </div>
          ))}
        </div>

        {/* OUTPUT LAYER */}
        <div>
          <div style={{ fontSize: 9, color: "#4CAF50", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 12, textAlign: "center", fontWeight: 600 }}>OUTPUT CHANNELS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { icon: "📧", label: "Email", desc: "Notifications", color: "#4CAF50" },
              { icon: "💬", label: "Teams", desc: "Channel alerts", color: "#6264A7" },
              { icon: "🔔", label: "In-App", desc: "Live updates", color: "#FFB347" },
              { icon: "📊", label: "Dashboard", desc: "Real-time KPIs", color: "#818CF8", click: () => setActiveModule("dashboard") },
            ].map((out, i) => (
              <div key={i} onClick={out.click} style={{
                padding: "8px 12px", borderRadius: 10, background: `${out.color}08`,
                border: `1px solid ${out.color}20`, cursor: out.click ? "pointer" : "default", transition: "all 0.2s",
                display: "flex", alignItems: "center", gap: 8, animation: `subtleFloat ${3.2 + i * 0.4}s ease-in-out infinite`,
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = `${out.color}55`; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = `${out.color}20`; }}>
                <span style={{ fontSize: 16 }}>{out.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: out.color, fontFamily: "'Space Grotesk', sans-serif" }}>{out.label}</div>
                  <div style={{ fontSize: 8, color: "#71717A" }}>{out.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer stats */}
      <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 16, padding: "10px 0", borderTop: "1px solid #27272A33" }}>
        {[
          { label: "Uptime", value: "99.9%", color: "#4CAF50" },
          { label: "Avg Response", value: "<2s", color: "#22D3EE" },
          { label: "AI Accuracy", value: `${aiTriagedPct}%`, color: "#EC4899" },
          { label: "Auto-Rate", value: `${computedFCR}%`, color: "#818CF8" },
        ].map((s, i) => (
          <div key={i} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: s.color, fontFamily: "'Space Grotesk', sans-serif" }}>{s.value}</div>
            <div style={{ fontSize: 8, color: "#71717A", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 0.5 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </>}
    </div></DashCard>}

    {/* ═══ COMPLIANCE & SYSTEM HEALTH (Management only) ═══ */}
    {isManagement && (cardVisibility.systemHealth.on || cardVisibility.changeCalendar.on) && (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}>

        {/* System Health */}
        <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20 }}>
          <h3 onClick={() => setActiveModule("admin")} style={{ margin: "0 0 14px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.color = "#06B6D4"} onMouseLeave={e => e.currentTarget.style.color = "#E8ECF4"}>
            <span style={{ color: "#06B6D4" }}>💻</span> System Health <span style={{ fontSize: 10, color: "#5A617866", marginLeft: "auto" }}>Infra →</span>
          </h3>
          {(() => {
            // Live components from /api/status, with sensible fallback colors.
            const comps = systemStatus?.components;
            const fmtRows = (n) => typeof n === "number" ? n.toLocaleString() : "";
            const items = comps ? [
              { label: "Database", status: comps.database?.status || "unknown" },
              { label: "API", status: comps.api?.status || "unknown" },
              { label: "AI Engine", status: comps.ai_engine?.status || "unknown" },
              { label: "SLA Engine", status: comps.sla_engine?.status || "unknown" },
              { label: "WebSocket", status: comps.websocket?.status || "unknown" },
              {
                label: "Audit Log",
                status: comps.audit_log?.status || "unknown",
                meta: comps.audit_log?.rows != null ? `${fmtRows(comps.audit_log.rows)} rows` : null,
              },
            ] : [
              { label: "Azure SQL Serverless", status: "loading" },
              { label: "App Service (P1v3)", status: "loading" },
              { label: "Entra ID SSO", status: "loading" },
              { label: "AI Engine", status: "loading" },
              { label: "Email Gateway", status: "loading" },
            ];
            const colorOf = (s) => s === "operational" ? "#4CAF50"
              : s === "stale" ? "#FFB347"
              : s === "disabled" ? "#5A6178"
              : s === "stopped" || s === "down" ? "#FF6B6B"
              : "#5A6178";
            return items.map((s, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: i < items.length - 1 ? "1px solid #1E213033" : "none" }}>
                <span style={{ fontSize: 11, color: "#C4CAD6" }}>{s.label}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {s.meta && <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{s.meta}</span>}
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: colorOf(s.status), boxShadow: `0 0 4px ${colorOf(s.status)}66` }} />
                  <span style={{ fontSize: 10, color: colorOf(s.status), fontWeight: 600, textTransform: "capitalize" }}>{s.status}</span>
                </div>
              </div>
            ));
          })()}
        </div>

        {/* Change Calendar — Visual Month View (4A) */}
        <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20 }}>
          <h3 onClick={() => setActiveModule("changes")} style={{ margin: "0 0 14px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.color = "#CE93D8"} onMouseLeave={e => e.currentTarget.style.color = "#E8ECF4"}>
            <span style={{ color: "#CE93D8" }}>📅</span> Change Calendar <span style={{ fontSize: 10, color: "#5A617866", marginLeft: "auto" }}>All Changes →</span>
          </h3>
          {(() => {
            const now = new Date();
            const year = now.getFullYear(), month = now.getMonth();
            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const days = Array.from({ length: 42 }, (_, i) => {
              const dayNum = i - firstDay + 1;
              if (dayNum < 1 || dayNum > daysInMonth) return null;
              return dayNum;
            });
            const changesByDay = {};
            changes.forEach(ch => {
              const sched = ch.scheduled || ch.created;
              if (!sched) return;
              const d = typeof sched === "number" ? new Date(Date.now() - sched * 3600000) : new Date(sched);
              if (d.getFullYear() === year && d.getMonth() === month) {
                const day = d.getDate();
                if (!changesByDay[day]) changesByDay[day] = [];
                changesByDay[day].push(ch);
              }
            });
            const monthName = now.toLocaleString("en-US", { month: "long", year: "numeric" });
            return (
              <div>
                <div style={{ textAlign: "center", fontSize: 12, fontWeight: 600, color: "#C4CAD6", marginBottom: 8 }}>{monthName}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
                  {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => <div key={d} style={{ textAlign: "center", fontSize: 9, color: "#5A6178", padding: 4 }}>{d}</div>)}
                  {days.map((day, i) => (
                    <div key={i} style={{ minHeight: 32, padding: 2, background: day === now.getDate() ? "#6366F118" : day ? "#0A0C14" : "transparent", borderRadius: 4, border: day === now.getDate() ? "1px solid #6366F144" : day ? "1px solid #1E213033" : "none", cursor: changesByDay[day] ? "pointer" : "default" }}
                      onClick={() => { if (changesByDay[day]) { setDetailItem(changesByDay[day][0]); setModal("changeDetail"); } }}>
                      {day && <div style={{ fontSize: 9, color: day === now.getDate() ? "#6366F1" : "#5A6178", textAlign: "right", padding: "0 2px" }}>{day}</div>}
                      {changesByDay[day] && changesByDay[day].slice(0, 2).map(ch => (
                        <div key={ch.id} style={{ fontSize: 7, padding: "1px 2px", marginTop: 1, borderRadius: 2, background: ch.status === "Implemented" ? "#0D2D1A" : ch.status === "Awaiting Approval" ? "#3B1F00" : "#0D2137", color: ch.status === "Implemented" ? "#81C784" : ch.status === "Awaiting Approval" ? "#FFB347" : "#64B5F6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ch.id}</div>
                      ))}
                      {changesByDay[day] && changesByDay[day].length > 2 && <div style={{ fontSize: 7, color: "#5A6178", textAlign: "center" }}>+{changesByDay[day].length - 2}</div>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    )}

    {/* ─── Feature 14: Service Degradation Early Warning ─── */}
    {degradationWarnings && degradationWarnings.warnings && degradationWarnings.warnings.length > 0 && (
      <div style={{ background: "#1A0A0A", borderRadius: 12, border: "1px solid #FF6B6B33", padding: 16, marginBottom: 16 }}>
        <div onClick={() => setDegradationOpen(!degradationOpen)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>🔥</span>
            <span style={{ fontWeight: 700, color: "#FF6B6B", fontSize: 13 }}>Service Degradation Alert</span>
            <span style={{ background: "#FF6B6B22", color: "#FF6B6B", borderRadius: 99, padding: "2px 8px", fontSize: 10 }}>{degradationWarnings.warnings.length} warning{degradationWarnings.warnings.length > 1 ? "s" : ""}</span>
          </div>
          <span style={{ color: "#5A6178", fontSize: 10 }}>{degradationOpen ? "▲" : "▼"}</span>
        </div>
        {degradationOpen && degradationWarnings.warnings.map((w, i) => (
          <div key={i} style={{ marginTop: 10, padding: 10, background: "#0F1117", borderRadius: 8, border: `1px solid ${w.severity === "critical" ? "#FF6B6B44" : w.severity === "high" ? "#FFB34744" : "#6366F144"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600, color: "#E2E8F0", fontSize: 12 }}>{w.service}</span>
              <span style={{ background: w.severity === "critical" ? "#FF6B6B22" : w.severity === "high" ? "#FFB34722" : "#6366F122", color: w.severity === "critical" ? "#FF6B6B" : w.severity === "high" ? "#FFB347" : "#6366F1", padding: "2px 6px", borderRadius: 4, fontSize: 9, fontWeight: 600, textTransform: "uppercase" }}>{w.severity}</span>
            </div>
            <div style={{ fontSize: 10, color: "#A0AEC0", marginTop: 4 }}>{w.ticketCount} related tickets · {w.affectedUsers} users affected</div>
            <div style={{ fontSize: 10, color: "#81C784", marginTop: 6, background: "#0D2D1A", padding: 6, borderRadius: 4 }}>{w.suggestedComms}</div>
          </div>
        ))}
      </div>
    )}

    {/* ─── Feature 11: Volume Forecast ─── */}
    {volumeForecast && (
      <div style={{ background: "#0F1117", borderRadius: 12, border: "1px solid #1E2130", padding: 16, marginBottom: 16 }}>
        <div onClick={() => setVolumeForecastOpen(!volumeForecastOpen)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>📊</span>
            <span style={{ fontWeight: 700, color: "#E2E8F0", fontSize: 13 }}>Ticket Volume Forecast</span>
          </div>
          <span style={{ color: "#5A6178", fontSize: 10 }}>{volumeForecastOpen ? "▲" : "▼"}</span>
        </div>
        {volumeForecastOpen && volumeForecast.forecast && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ background: "#6366F110", padding: "8px 14px", borderRadius: 8, border: "1px solid #6366F133" }}>
                <div style={{ fontSize: 9, color: "#5A6178" }}>Tomorrow</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#6366F1" }}>{volumeForecast.forecast.nextDay ?? "—"}</div>
              </div>
              <div style={{ background: "#EC489910", padding: "8px 14px", borderRadius: 8, border: "1px solid #EC489933" }}>
                <div style={{ fontSize: 9, color: "#5A6178" }}>Next Week</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#EC4899" }}>{volumeForecast.forecast.nextWeek ?? "—"}</div>
              </div>
            </div>
            {volumeForecast.forecast.topCategory && <div style={{ fontSize: 10, color: "#A0AEC0", marginTop: 8 }}>Top category: <span style={{ color: "#FFB347" }}>{volumeForecast.forecast.topCategory}</span></div>}
            {volumeForecast.forecast.staffingSuggestion && <div style={{ fontSize: 10, color: "#81C784", marginTop: 4 }}>{volumeForecast.forecast.staffingSuggestion}</div>}
          </div>
        )}
      </div>
    )}

    {/* ─── Feature 13: Recurring Issues ─── */}
    {recurringIssues && recurringIssues.recurring && recurringIssues.recurring.length > 0 && (
      <div style={{ background: "#0F1117", borderRadius: 12, border: "1px solid #1E2130", padding: 16, marginBottom: 16 }}>
        <div onClick={() => setRecurringOpen(!recurringOpen)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>🔄</span>
            <span style={{ fontWeight: 700, color: "#E2E8F0", fontSize: 13 }}>Recurring Issues</span>
            <span style={{ background: "#FFB34722", color: "#FFB347", borderRadius: 99, padding: "2px 8px", fontSize: 10 }}>{recurringIssues.recurring.length}</span>
          </div>
          <span style={{ color: "#5A6178", fontSize: 10 }}>{recurringOpen ? "▲" : "▼"}</span>
        </div>
        {recurringOpen && recurringIssues.recurring.slice(0, 8).map((r, i) => (
          <div key={i} style={{ marginTop: 8, padding: 8, background: "#080A12", borderRadius: 6, border: "1px solid #1E2130", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, color: "#E2E8F0", fontWeight: 500 }}>{r.user || r.requester || "Unknown"}</div>
              <div style={{ fontSize: 9, color: "#5A6178" }}>{r.category || "General"} · {r.count || 0} tickets in 30d</div>
            </div>
            <span style={{ background: "#FFB34718", color: "#FFB347", padding: "2px 8px", borderRadius: 4, fontSize: 9 }}>Recurring</span>
          </div>
        ))}
      </div>
    )}

    {/* ─── Feature 15: Burnout Risk ─── */}
    {burnoutRisk && burnoutRisk.engineers && burnoutRisk.engineers.length > 0 && (
      <div style={{ background: "#0F1117", borderRadius: 12, border: "1px solid #1E2130", padding: 16, marginBottom: 16 }}>
        <div onClick={() => setBurnoutOpen(!burnoutOpen)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>🫠</span>
            <span style={{ fontWeight: 700, color: "#E2E8F0", fontSize: 13 }}>Burnout Risk Monitor</span>
            {burnoutRisk.engineers.some(e => (e.riskScore || 0) > 70) && <span style={{ background: "#FF6B6B22", color: "#FF6B6B", borderRadius: 99, padding: "2px 8px", fontSize: 10 }}>At Risk</span>}
          </div>
          <span style={{ color: "#5A6178", fontSize: 10 }}>{burnoutOpen ? "▲" : "▼"}</span>
        </div>
        {burnoutOpen && burnoutRisk.engineers.map((eng, i) => {
          const risk = eng.riskScore || 0;
          const color = risk > 70 ? "#FF6B6B" : risk > 40 ? "#FFB347" : "#81C784";
          return (
            <div key={i} style={{ marginTop: 8, padding: 8, background: "#080A12", borderRadius: 6, border: "1px solid #1E2130" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#E2E8F0", fontWeight: 500 }}>{eng.name || eng.engineer}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color }}>{risk}%</span>
              </div>
              <div style={{ marginTop: 4, height: 4, background: "#1E2130", borderRadius: 2 }}>
                <div style={{ height: 4, borderRadius: 2, background: color, width: `${Math.min(risk, 100)}%`, transition: "width 0.5s" }} />
              </div>
              {eng.suggestion && <div style={{ fontSize: 9, color: "#5A6178", marginTop: 4 }}>{eng.suggestion}</div>}
            </div>
          );
        })}
      </div>
    )}

    {/* ─── Feature 37: Skill Gaps ─── */}
    {skillGaps && skillGaps.gaps && skillGaps.gaps.length > 0 && (
      <div style={{ background: "#0F1117", borderRadius: 12, border: "1px solid #1E2130", padding: 16, marginBottom: 16 }}>
        <div onClick={() => setSkillGapsOpen(!skillGapsOpen)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>🎯</span>
            <span style={{ fontWeight: 700, color: "#E2E8F0", fontSize: 13 }}>Skill Gap Analysis</span>
          </div>
          <span style={{ color: "#5A6178", fontSize: 10 }}>{skillGapsOpen ? "▲" : "▼"}</span>
        </div>
        {skillGapsOpen && skillGaps.gaps.slice(0, 8).map((g, i) => (
          <div key={i} style={{ marginTop: 8, padding: 8, background: "#080A12", borderRadius: 6, border: "1px solid #1E2130" }}>
            <div style={{ fontSize: 11, color: "#E2E8F0", fontWeight: 500 }}>{g.engineer}</div>
            <div style={{ fontSize: 9, color: "#5A6178", marginTop: 2 }}>Category: <span style={{ color: "#FFB347" }}>{g.category}</span> · {g.avgTime || "—"} avg resolution vs team {g.teamAvg || "—"}</div>
            {g.recommendation && <div style={{ fontSize: 9, color: "#6366F1", marginTop: 2 }}>{g.recommendation}</div>}
          </div>
        ))}
      </div>
    )}

    {/* ─── Feature 45: Customer Health ─── */}
    {customerHealth && customerHealth.customers && customerHealth.customers.length > 0 && (
      <div style={{ background: "#0F1117", borderRadius: 12, border: "1px solid #1E2130", padding: 16, marginBottom: 16 }}>
        <div onClick={() => setCustomerHealthOpen(!customerHealthOpen)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>💚</span>
            <span style={{ fontWeight: 700, color: "#E2E8F0", fontSize: 13 }}>Customer Health Scores</span>
          </div>
          <span style={{ color: "#5A6178", fontSize: 10 }}>{customerHealthOpen ? "▲" : "▼"}</span>
        </div>
        {customerHealthOpen && customerHealth.customers.slice(0, 10).map((c, i) => {
          const score = c.healthScore || c.score || 0;
          const color = score >= 80 ? "#81C784" : score >= 50 ? "#FFB347" : "#FF6B6B";
          return (
            <div key={i} style={{ marginTop: 8, padding: 8, background: "#080A12", borderRadius: 6, border: "1px solid #1E2130", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 11, color: "#E2E8F0", fontWeight: 500 }}>{c.name || c.customer || c.email}</div>
                <div style={{ fontSize: 9, color: "#5A6178" }}>{c.ticketCount || 0} tickets · {c.avgSatisfaction || "—"} CSAT</div>
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color }}>{score}</span>
            </div>
          );
        })}
      </div>
    )}

    {/* ─── Feature 39: Peer Learning ─── */}
    {peerLearning && peerLearning.suggestions && peerLearning.suggestions.length > 0 && (
      <div style={{ background: "#0F1117", borderRadius: 12, border: "1px solid #1E2130", padding: 16, marginBottom: 16 }}>
        <div onClick={() => setPeerLearningOpen(!peerLearningOpen)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>🤝</span>
            <span style={{ fontWeight: 700, color: "#E2E8F0", fontSize: 13 }}>Peer Learning</span>
            <span style={{ background: "#6366F122", color: "#6366F1", borderRadius: 99, padding: "2px 8px", fontSize: 10 }}>{peerLearning.suggestions.length} suggestion{peerLearning.suggestions.length > 1 ? "s" : ""}</span>
          </div>
          <span style={{ color: "#5A6178", fontSize: 10 }}>{peerLearningOpen ? "▲" : "▼"}</span>
        </div>
        {peerLearningOpen && peerLearning.suggestions.slice(0, 6).map((s, i) => (
          <div key={i} style={{ marginTop: 8, padding: 8, background: "#080A12", borderRadius: 6, border: "1px solid #1E2130" }}>
            <div style={{ fontSize: 10, color: "#81C784" }}>Resolved: <span style={{ color: "#E2E8F0" }}>{s.resolvedTicket.title}</span> by {s.resolvedTicket.resolvedBy}</div>
            <div style={{ fontSize: 10, color: "#FFB347", marginTop: 2 }}>Could help: <span style={{ color: "#E2E8F0" }}>{s.openTicket.title}</span> ({s.openTicket.assignedTo})</div>
            <div style={{ fontSize: 9, color: "#5A6178", marginTop: 2 }}>{s.matchReason}</div>
          </div>
        ))}
      </div>
    )}

    {/* ─── Feature 48: AI Performance Report ─── */}
    {perfReport && (
      <div style={{ background: "#0F1117", borderRadius: 12, border: "1px solid #1E2130", padding: 16, marginBottom: 16 }}>
        <div onClick={() => setPerfReportOpen(!perfReportOpen)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>📈</span>
            <span style={{ fontWeight: 700, color: "#E2E8F0", fontSize: 13 }}>AI Performance Report</span>
          </div>
          <span style={{ color: "#5A6178", fontSize: 10 }}>{perfReportOpen ? "▲" : "▼"}</span>
        </div>
        {perfReportOpen && perfReport.report && (
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {[
              { label: "Triage Accuracy", value: perfReport.report.triageAccuracy ?? "—", color: "#81C784" },
              { label: "Auto-Resolved", value: perfReport.report.autoResolved ?? "—", color: "#6366F1" },
              { label: "Time Saved (hrs)", value: perfReport.report.timeSaved ?? "—", color: "#EC4899" },
              { label: "KB Generated", value: perfReport.report.kbGenerated ?? "—", color: "#FFB347" },
              { label: "Override Rate", value: perfReport.report.overrideRate ?? "—", color: "#FF6B6B" },
              { label: "Total AI Actions", value: perfReport.report.totalActions ?? "—", color: "#64B5F6" },
            ].map((m, i) => (
              <div key={i} style={{ background: "#080A12", padding: 10, borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: 8, color: "#5A6178", textTransform: "uppercase" }}>{m.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: m.color, marginTop: 2 }}>{m.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    )}

    {/* ─── Feature 49: AI Self-Monitor ─── */}
    {selfMonitor && (
      <div style={{ background: "#0F1117", borderRadius: 12, border: `1px solid ${selfMonitor.healthStatus === "degraded" ? "#FF6B6B44" : selfMonitor.healthStatus === "warning" ? "#FFB34744" : "#1E2130"}`, padding: 16, marginBottom: 16 }}>
        <div onClick={() => setSelfMonitorOpen(!selfMonitorOpen)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>🩺</span>
            <span style={{ fontWeight: 700, color: "#E2E8F0", fontSize: 13 }}>AI Health Monitor</span>
            <span style={{ background: selfMonitor.healthStatus === "healthy" ? "#81C78422" : selfMonitor.healthStatus === "warning" ? "#FFB34722" : "#FF6B6B22", color: selfMonitor.healthStatus === "healthy" ? "#81C784" : selfMonitor.healthStatus === "warning" ? "#FFB347" : "#FF6B6B", borderRadius: 99, padding: "2px 8px", fontSize: 10, fontWeight: 600, textTransform: "uppercase" }}>{selfMonitor.healthStatus}</span>
          </div>
          <span style={{ color: "#5A6178", fontSize: 10 }}>{selfMonitorOpen ? "▲" : "▼"}</span>
        </div>
        {selfMonitorOpen && (
          <div style={{ marginTop: 10 }}>
            {selfMonitor.anomalies && selfMonitor.anomalies.length > 0 ? selfMonitor.anomalies.map((a, i) => (
              <div key={i} style={{ marginTop: 6, padding: 8, background: a.severity === "high" ? "#1A0A0A" : "#0F1117", borderRadius: 6, border: `1px solid ${a.severity === "high" ? "#FF6B6B33" : "#FFB34733"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: "#E2E8F0", fontWeight: 500 }}>{a.metric}</span>
                  <span style={{ fontSize: 10, color: a.severity === "high" ? "#FF6B6B" : "#FFB347" }}>{a.change || a.value}</span>
                </div>
                <div style={{ fontSize: 9, color: "#A0AEC0", marginTop: 2 }}>{a.message}</div>
              </div>
            )) : <div style={{ fontSize: 10, color: "#81C784", textAlign: "center", padding: 10 }}>All AI systems operating normally</div>}
            {selfMonitor.metrics && (
              <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 9, color: "#5A6178" }}>
                <div>This week: {selfMonitor.metrics.thisWeek?.triages || 0} triages, {selfMonitor.metrics.thisWeek?.overrides || 0} overrides</div>
                <div>Last week: {selfMonitor.metrics.lastWeek?.triages || 0} triages, {selfMonitor.metrics.lastWeek?.overrides || 0} overrides</div>
              </div>
            )}
          </div>
        )}
      </div>
    )}

    {/* ─── Feature 50: Config Recommendations ─── */}
    {configRecs && configRecs.recommendations && configRecs.recommendations.length > 0 && (
      <div style={{ background: "#0F1117", borderRadius: 12, border: "1px solid #1E2130", padding: 16, marginBottom: 16 }}>
        <div onClick={() => setConfigRecsOpen(!configRecsOpen)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>⚙️</span>
            <span style={{ fontWeight: 700, color: "#E2E8F0", fontSize: 13 }}>Configuration Optimizer</span>
            <span style={{ background: "#6366F122", color: "#6366F1", borderRadius: 99, padding: "2px 8px", fontSize: 10 }}>{configRecs.recommendations.length}</span>
          </div>
          <span style={{ color: "#5A6178", fontSize: 10 }}>{configRecsOpen ? "▲" : "▼"}</span>
        </div>
        {configRecsOpen && configRecs.recommendations.map((r, i) => (
          <div key={i} style={{ marginTop: 8, padding: 10, background: "#080A12", borderRadius: 6, border: "1px solid #1E2130" }}>
            <div style={{ fontSize: 11, color: "#6366F1", fontWeight: 600 }}>{r.setting}</div>
            <div style={{ fontSize: 9, color: "#5A6178", marginTop: 2 }}>Current: <span style={{ color: "#FF6B6B" }}>{r.current}</span> → Suggested: <span style={{ color: "#81C784" }}>{r.suggested}</span></div>
            <div style={{ fontSize: 9, color: "#A0AEC0", marginTop: 4 }}>{r.reason}</div>
            <div style={{ fontSize: 9, color: "#81C784", marginTop: 2 }}>Impact: {r.impact}</div>
          </div>
        ))}
      </div>
    )}

    {/* ─── AI Sentiment Analysis Widget ─── */}
    <SentimentAnalysisWidget incidents={incidents} />

    {/* ─── AI Predictive Analytics Widget ─── */}
    <PredictiveAnalyticsWidget incidents={incidents} />

  </div>
);
}
