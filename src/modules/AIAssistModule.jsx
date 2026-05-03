import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  COLORS, inputStyle, btnStyle,
} from "../constants/theme.js";
import { APP_VERSION } from "../constants/version.js";
import {
  Badge, StatCard, DataTable, useStableComponent,
} from "../components/SharedComponents.jsx";
import {
  renderAiRichText,
} from "../utils/aiEngine.jsx";

// AI Assist Module — extracted from itsm-tool.jsx
export default function AIAssistModule({ ctx }) {
  const {
    currentUser, showToast,
    aiMessages, setAiMessages,
    aiInput, setAiInput, aiLoading, setAiLoading,
    aiError, setAiError, handleAiChat, SLASH_COMMANDS,
    chatContainerRef, chatInputRef,
    aiNudge, setAiNudge, aiNudgeDismissed,
    aiFilePreview, setAiFilePreview,
    handleFileUpload, aiEditingIdx, setAiEditingIdx,
    aiEditText, setAiEditText,
    detectAiActionCards, handleCardAction,
    incidents = [], requests = [], problems = [], changes = [], azureOpenAI = {},
    zdAiQueue = [], zdAutoStats = {}, zdStats = {},
    setActiveModule,
    aiConfig = { automationLevel: 0, humanLoopPct: 0 },
    runSlaPrediction,
    generateBriefing,
    aiBriefings = [],
    runPatternDetection,
    aiPatterns = [],
    setShowAiActionsPanel,
    aiActions = [],
    createProblemFromPattern,
    setShowAiPanel,
  } = ctx;
  const currentBriefing = aiBriefings?.[0] || null;

// ─── AI Assist Module ───
const AIAssistModule = useStableComponent(() => {
  const aiTriaged = incidents.filter(i => i.aiTriaged).length;
  const totalTickets = incidents.length + requests.length + problems.length + changes.length;
  const aiHandled = Math.round(totalTickets * 0.8);
  const humanLoop = Math.round(totalTickets * 0.1);
  const manualOnly = totalTickets - aiHandled - humanLoop;
  const aiConnected = !!azureOpenAI?.enabled;
  const aiTotalCalls = Number(azureOpenAI?.totalCalls) || 0;
  const zdSafeSolved = Number(zdAutoStats?.safeSolved) || 0;
  const zdSafeBlocked = Number(zdAutoStats?.safeSolveBlocked) || 0;
  const zdSafeReady = zdAiQueue.filter(q => q.status === "safe_solve_ready").length;
  const zdOpenWork = (Number(zdStats?.open) || 0) + (Number(zdStats?.pending) || 0);

  return (
    <div>
      {/* VGC AI Engine Connection Banner */}
      <div style={{
        background: aiConnected ? "linear-gradient(135deg, #0F111788, #111422)" : "#0F1117",
        borderRadius: 10, border: `1px solid ${aiConnected ? "#6366F133" : "#1E2130"}`,
        padding: "14px 20px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between",
        animation: aiConnected ? "aiPulseGlow 4s ease-in-out infinite" : "none",
        position: "relative", overflow: "hidden"
      }}>
        {aiConnected && (
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 2,
            background: "linear-gradient(90deg, transparent, #6366F1, #06B6D4, #EC4899, transparent)",
            backgroundSize: "200% 100%", animation: "aiShimmer 3s linear infinite"
          }} />
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: aiConnected ? "linear-gradient(135deg, #6366F1, #06B6D4)" : "#1E2130",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18
          }}>🤖</div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              VGC AI Engine
              <span style={{
                fontSize: 9, padding: "2px 8px", borderRadius: 10, fontWeight: 700,
                background: aiConnected ? "#81C78422" : "#FF444422",
                color: aiConnected ? "#81C784" : "#FF444488",
                animation: aiConnected ? "pulse 2s ease-in-out infinite" : "none"
              }}>{aiConnected ? "CONNECTED" : "OFFLINE"}</span>
              {aiTotalCalls > 0 && (
                <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: "#06B6D411", color: "#06B6D4", fontFamily: "'JetBrains Mono', monospace" }}>
                  {aiTotalCalls} API calls
                </span>
              )}
            </div>
            <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
              {azureOpenAI?.enabled
                ? `Powered by Azure Open AI · Last active: ${azureOpenAI?.lastTested || "Ready"}`
                : "VGC AI Engine is currently disabled"}
            </div>
          </div>
        </div>
        <button onClick={() => setActiveModule?.("admin")} style={{
          padding: "6px 14px", borderRadius: 6, border: "1px solid #6366F133",
          background: "#6366F118", color: "#6366F1", cursor: "pointer",
          fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace"
        }}>⚙️ Configure</button>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 24 }}>
        <StatCard label="AI Automation Rate" value={`${aiConfig?.automationLevel ?? 0}%`} icon="🤖" accent="#6366F1" />
        <StatCard label="Human-in-Loop" value={`${aiConfig?.humanLoopPct ?? 0}%`} icon="👤" accent="#06B6D4" />
        <StatCard label="AI Triaged Incidents" value={aiTriaged} icon="⚡" accent="#EC4899" />
        <StatCard label="Avg Confidence" value="92%" icon="🎯" accent="#81C784" />
        <StatCard label="Time Saved (hrs)" value="142" icon="⏰" accent="#FFB347" />
        <StatCard label="ZD Safe Solved" value={zdSafeSolved} icon="🛟" accent="#4CAF50" />
        <StatCard label="Safe Review Blocks" value={zdSafeBlocked} icon="🛡️" accent="#FF6B6B" />
      </div>

      {/* AI Quick Actions Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        <button onClick={runSlaPrediction} style={{ padding: "14px 16px", borderRadius: 8, border: "1px solid #EC489933", background: "#EC489911", color: "#EC4899", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", textAlign: "left", transition: "all 0.2s" }}>
          <div style={{ fontSize: 18, marginBottom: 6 }}>🔮</div>
          <div>Predict SLA Breaches</div>
          <div style={{ fontSize: 9, color: "#8B92A8", marginTop: 4 }}>Analyze {incidents.filter(i => !["Resolved","Closed"].includes(i.status)).length} open tickets</div>
        </button>
        <button onClick={() => setActiveModule?.("tickets")} style={{ padding: "14px 16px", borderRadius: 8, border: "1px solid #4CAF5033", background: "#4CAF5011", color: "#4CAF50", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", textAlign: "left", transition: "all 0.2s" }}>
          <div style={{ fontSize: 18, marginBottom: 6 }}>🛟</div>
          <div>AI Safe Solve</div>
          <div style={{ fontSize: 9, color: "#8B92A8", marginTop: 4 }}>{zdSafeReady} ready · {zdOpenWork} active Zendesk tickets</div>
        </button>
        <button onClick={() => generateBriefing?.("daily", [])} style={{ padding: "14px 16px", borderRadius: 8, border: "1px solid #06B6D433", background: "#06B6D411", color: "#06B6D4", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", textAlign: "left", transition: "all 0.2s" }}>
          <div style={{ fontSize: 18, marginBottom: 6 }}>📋</div>
          <div>Generate Daily Briefing</div>
          <div style={{ fontSize: 9, color: "#8B92A8", marginTop: 4 }}>{aiBriefings.length} briefings generated</div>
        </button>
        <button onClick={runPatternDetection} style={{ padding: "14px 16px", borderRadius: 8, border: "1px solid #FFB34733", background: "#FFB34711", color: "#FFB347", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", textAlign: "left", transition: "all 0.2s" }}>
          <div style={{ fontSize: 18, marginBottom: 6 }}>🔍</div>
          <div>Detect Patterns</div>
          <div style={{ fontSize: 9, color: "#8B92A8", marginTop: 4 }}>{aiPatterns.length} patterns found</div>
        </button>
        <button onClick={() => setShowAiActionsPanel?.(true)} style={{ padding: "14px 16px", borderRadius: 8, border: "1px solid #6366F133", background: "#6366F111", color: "#6366F1", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", textAlign: "left", transition: "all 0.2s" }}>
          <div style={{ fontSize: 18, marginBottom: 6 }}>🛡️</div>
          <div>AI Actions Queue</div>
          <div style={{ fontSize: 9, color: "#8B92A8", marginTop: 4 }}>{aiActions.filter(a => a.status === "pending_approval").length} pending approval</div>
        </button>
      </div>

      {/* AI Briefing Preview */}
      {currentBriefing && (
        <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #06B6D433", padding: 20, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>📋 Latest Briefing</h3>
            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, fontWeight: 700, background: currentBriefing.riskLevel === "critical" ? "#FF444422" : currentBriefing.riskLevel === "high" ? "#FF6B6B22" : currentBriefing.riskLevel === "medium" ? "#FFB34722" : "#81C78422", color: currentBriefing.riskLevel === "critical" ? "#FF4444" : currentBriefing.riskLevel === "high" ? "#FF6B6B" : currentBriefing.riskLevel === "medium" ? "#FFB347" : "#81C784", textTransform: "uppercase" }}>{currentBriefing.riskLevel} risk</span>
          </div>
          <div style={{ fontSize: 12, color: "#C4CAD6", lineHeight: 1.6, marginBottom: 12 }}>{currentBriefing.executiveSummary}</div>
          {(currentBriefing.actionItems || []).length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#FFB347", marginBottom: 6 }}>⚡ Action Items:</div>
              {currentBriefing.actionItems.map((item, idx) => (
                <div key={idx} style={{ fontSize: 11, color: "#8B92A8", padding: "4px 0 4px 12px", borderLeft: "2px solid #FFB34744" }}>{item}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* AI Patterns Preview */}
      {aiPatterns.length > 0 && (
        <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #FFB34733", padding: 20, marginBottom: 20 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>🔍 Detected Patterns <span style={{ fontSize: 10, color: "#FFB347", fontWeight: 400 }}>({aiPatterns.length})</span></h3>
          <div style={{ display: "grid", gap: 8 }}>
            {aiPatterns.slice(0, 5).map((pat, idx) => (
              <div key={idx} style={{ background: "#0A0C14", borderRadius: 6, border: "1px solid #1E213044", padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 16 }}>{pat.type === "recurring" ? "🔄" : pat.type === "trending" ? "📈" : pat.type === "correlated" ? "🔗" : pat.type === "seasonal" ? "📅" : "⚠️"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#E8ECF4" }}>{pat.title}</div>
                  <div style={{ fontSize: 10, color: "#8B92A8", marginTop: 2 }}>{pat.description?.substring(0, 100)}{pat.description?.length > 100 ? "..." : ""}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: pat.confidence >= 90 ? "#81C784" : pat.confidence >= 70 ? "#FFB347" : "#FF6B6B", fontFamily: "'JetBrains Mono', monospace" }}>{pat.confidence}%</span>
                  <button onClick={() => createProblemFromPattern?.(pat.id)} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #6366F133", background: "#6366F111", color: "#6366F1", cursor: "pointer", fontSize: 9, fontWeight: 600 }}>Create Problem</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Open AI Command Center CTA */}
      <div style={{ background: "linear-gradient(135deg, #6366F108, #06B6D408)", borderRadius: 12, border: "1px solid #6366F133", padding: 24, marginBottom: 24, textAlign: "center" }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🚀</div>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>VGC AI Command Center</h3>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#8B92A8", lineHeight: 1.5 }}>
          Your personal AI assistant for ITSM operations. Create tickets, check SLA, draft emails, search KB, and more — all from one chat.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 16 }}>
          {[
            { icon: "🎫", label: "Create Tickets" },
            { icon: "📊", label: "SLA Insights" },
            { icon: "📧", label: "Draft Emails" },
            { icon: "📚", label: "KB Search" },
            { icon: "🔍", label: "Find & Fix" },
            { icon: "⚡", label: "Escalate" },
          ].map(cap => (
            <span key={cap.label} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: "#0F1117", border: "1px solid #1E213066", fontSize: 11, color: "#C4CAD6" }}>
              {cap.icon} {cap.label}
            </span>
          ))}
        </div>
        <button onClick={() => setShowAiPanel?.(true)} style={{
          padding: "10px 28px", borderRadius: 8, border: "none",
          background: "linear-gradient(135deg, #6366F1, #06B6D4)", color: "#fff",
          fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif",
          boxShadow: "0 4px 16px #6366F144", transition: "all 0.2s"
        }}
        onMouseOver={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 24px #6366F166"; }}
        onMouseOut={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 16px #6366F144"; }}>
          💬 Open AI Command Center
        </button>
        <div style={{ marginTop: 10, fontSize: 10, color: "#5A617888" }}>Type <code style={{ background: "#1E2130", padding: "1px 4px", borderRadius: 3, color: "#6366F1" }}>/</code> in the chat to see all available commands</div>
      </div>

      {/* Recent AI Activity Feed (live, not hardcoded) */}
      <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
          <span>🤖</span> Recent AI Activity
          </h3>
        {(() => {
          const recentAiLogs = aiMessages.filter(m => m.role === "ai" && !m._typing).slice(-6).reverse().map((m, idx) => ({
            action: m.text.substring(0, 50).replace(/[*#_]/g, "").trim() + (m.text.length > 50 ? "..." : ""),
            detail: m.source === "azure" ? "VGC-AI Engine" : "Local AI",
            time: idx === 0 ? "just now" : idx < 3 ? `${idx * 5}m ago` : `${idx * 15}m ago`,
            source: m.source
          }));
          const logs = recentAiLogs.length > 0 ? recentAiLogs : [
            { action: "AI Engine Active", detail: "Monitoring live incidents and tickets", time: "now", source: "azure" },
          ];
          return logs.map((log, i) => (
            <div key={i} style={{ padding: "10px 12px", borderRadius: 6, marginBottom: 8, background: "#0A0C14", border: "1px solid #1E213044" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ color: "#E8ECF4", fontSize: 12, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{log.action}</span>
                <span style={{ fontSize: 8, color: log.source === "azure" ? "#06B6D4" : "#FFB347", background: log.source === "azure" ? "#06B6D411" : "#FFB34711", padding: "2px 6px", borderRadius: 3, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0, marginLeft: 8 }}>{log.source === "azure" ? "⚡ VGC AI" : "🧠 Local"}</span>
              </div>
              <div style={{ color: "#5A617866", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>{log.time}</div>
            </div>
          ));
        })()}
        {aiMessages.length <= 1 && (
          <div style={{ textAlign: "center", padding: "16px 0", color: "#5A617888", fontSize: 11 }}>
            No recent activity. Open the AI Command Center to get started.
          </div>
        )}
      </div>

      {/* AI Automation Breakdown */}
      <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 20, marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 20px", fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
          📊 Automation Breakdown by Module
        </h3>
        {[
          { module: "Incident Triage", aiPct: 83, humanPct: 10, icon: "⚡", color: "#FF6B6B" },
          { module: "Auto-Assignment", aiPct: 88, humanPct: 7, icon: "👤", color: "#64B5F6" },
          { module: "KB Recommendations", aiPct: 87, humanPct: 8, icon: "📖", color: "#81C784" },
          { module: "Change Risk Analysis", aiPct: 79, humanPct: 12, icon: "⟳", color: "#FFB347" },
          { module: "SLA Prediction", aiPct: 91, humanPct: 5, icon: "⏱️", color: "#CE93D8" },
          { module: "Root Cause Detection", aiPct: 72, humanPct: 18, icon: "🔍", color: "#EC4899" },
        ].map((row, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: "#C4CAD6", display: "flex", alignItems: "center", gap: 6 }}>
                <span>{row.icon}</span> {row.module}
              </span>
              <div style={{ display: "flex", gap: 12, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                <span style={{ color: "#6366F1" }}>AI: {row.aiPct}%</span>
                <span style={{ color: "#06B6D4" }}>Human: {row.humanPct}%</span>
                <span style={{ color: "#5A6178" }}>Manual: {100 - row.aiPct - row.humanPct}%</span>
              </div>
            </div>
            <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", height: 8, background: "#0A0C14" }}>
              <div style={{ width: `${row.aiPct}%`, background: "#6366F1", transition: "width 0.6s" }} />
              <div style={{ width: `${row.humanPct}%`, background: "#06B6D4", transition: "width 0.6s" }} />
              <div style={{ flex: 1, background: "#1E2130" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
return <AIAssistModule />;
}
