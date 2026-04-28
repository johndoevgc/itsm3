import React from "react";
import {
  COLORS, PRIORITY_COLORS, STATUS_COLORS, inputStyle, btnStyle,
} from "../constants/theme.js";
import {
  Badge, StatCard,
} from "../components/SharedComponents.jsx";

export default function EngineerReviewHub({ ctx }) {
  const {
    aiActions, aiActionsLoading,
    zdAiQueue,
    changes, requests,
    reviewTab, setReviewTab,
    runAiMonitor,
    setShowAiActionsPanel,
    approveAiAction, rejectAiAction, sendAiApprovalEmail,
    applyAiTriage, approveKBDraft,
    zdApproveAndSend,
    setActiveModule, setZdTab,
    setDetailItem, setModal,
  } = ctx;

  const pendingAiActions = aiActions.filter(a => a.status === "pending_approval");
  const pendingZdQueue = zdAiQueue.filter(q => q.status === "pending_approval");
  const pendingChanges = changes.filter(c => c.status === "Awaiting Approval");
  const pendingRequests = requests.filter(r => r.status === "Pending Approval");
  const totalPending = pendingAiActions.length + pendingZdQueue.length + pendingChanges.length + pendingRequests.length;

  const tabStyle = (id) => ({
    padding: "10px 18px", background: reviewTab === id ? "#12141E" : "transparent",
    border: "none", borderBottom: reviewTab === id ? "2px solid #EC4899" : "2px solid transparent",
    color: reviewTab === id ? "#E8ECF4" : "#5A6178", cursor: "pointer", fontSize: 12,
    fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6
  });

  const sevColors = { critical: "#FF4444", high: "#FF8800", medium: "#FFB347", low: "#4CAF50" };

  return (
    <div>
      {/* Header Stats */}
      <div style={{ background: "linear-gradient(135deg, #0F111788, #111422)", borderRadius: 10, border: "1px solid #EC489933", padding: "14px 20px", marginBottom: 20, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, #EC4899, #6366F1, #06B6D4)", backgroundSize: "200% 100%", animation: "aiShimmer 3s linear infinite" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #EC4899, #6366F1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>👨‍💻</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>Engineer Review Hub</div>
              <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
                All AI-generated items requiring engineer approval · {totalPending} pending review
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => runAiMonitor()} disabled={aiActionsLoading} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #6366F133", background: "#6366F118", color: "#6366F1", cursor: aiActionsLoading ? "wait" : "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
              {aiActionsLoading ? "⟳ Scanning..." : "🤖 Run AI Scan"}
            </button>
            <button onClick={() => setShowAiActionsPanel(true)} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #EC489933", background: "#EC489918", color: "#EC4899", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
              🛡️ Full AI Actions Panel
            </button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="AI Actions Pending" value={pendingAiActions.length} icon="🤖" accent="#6366F1" />
        <StatCard label="Zendesk Drafts Pending" value={pendingZdQueue.length} icon="🎫" accent="#EC4899" />
        <StatCard label="Change Approvals" value={pendingChanges.length} icon="🔄" accent="#FFB347" />
        <StatCard label="Request Approvals" value={pendingRequests.length} icon="📋" accent="#06B6D4" />
        <StatCard label="Total Pending" value={totalPending} icon="👤" accent={totalPending > 0 ? "#FF6B6B" : "#81C784"} />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #1E2130", marginBottom: 16 }}>
        <button onClick={() => setReviewTab("all")} style={tabStyle("all")}>
          📋 All Pending <span style={{ background: "#EC489922", color: "#EC4899", padding: "1px 6px", borderRadius: 8, fontSize: 9 }}>{totalPending}</span>
        </button>
        <button onClick={() => setReviewTab("ai")} style={tabStyle("ai")}>
          🤖 AI Actions <span style={{ background: "#6366F122", color: "#6366F1", padding: "1px 6px", borderRadius: 8, fontSize: 9 }}>{pendingAiActions.length}</span>
        </button>
        <button onClick={() => setReviewTab("zendesk")} style={tabStyle("zendesk")}>
          🎫 Zendesk Drafts <span style={{ background: "#EC489922", color: "#EC4899", padding: "1px 6px", borderRadius: 8, fontSize: 9 }}>{pendingZdQueue.length}</span>
        </button>
        <button onClick={() => setReviewTab("approvals")} style={tabStyle("approvals")}>
          ✓ Approvals <span style={{ background: "#FFB34722", color: "#FFB347", padding: "1px 6px", borderRadius: 8, fontSize: 9 }}>{pendingChanges.length + pendingRequests.length}</span>
        </button>
      </div>

      {/* ─── AI Actions Pending ─── */}
      {(reviewTab === "all" || reviewTab === "ai") && pendingAiActions.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#6366F1" }}>🤖</span> AI Actions Requiring Approval
            <span style={{ fontSize: 10, color: "#5A6178", fontWeight: 400 }}>({pendingAiActions.length})</span>
          </h3>
          {pendingAiActions.map(action => {
            const sevColor = sevColors[action.severity] || "#666";
            return (
              <div key={action.id} style={{ padding: "14px 16px", marginBottom: 10, borderRadius: 10, background: "#1E213044", border: `1px solid ${sevColor}44`, transition: "all 0.2s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: sevColor + "22", color: sevColor, fontWeight: 700, textTransform: "uppercase" }}>{action.severity}</span>
                      <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#6366F122", color: "#6366F1", fontWeight: 600 }}>{action.type}</span>
                      {action.incidentId && <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#EC489922", color: "#EC4899", fontWeight: 600 }}>🎫 {action.incidentId}</span>}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", marginBottom: 4 }}>{action.title}</div>
                    <div style={{ fontSize: 11, color: "#8B8FA3", lineHeight: 1.5 }}>{action.description}</div>
                  </div>
                  {action.confidence && <div style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "#81C78422", color: "#81C784", fontWeight: 600, whiteSpace: "nowrap" }}>🎯 {action.confidence}%</div>}
                </div>
                {action.suggestedAction && (
                  <div style={{ padding: "8px 12px", background: "#6366F108", borderRadius: 6, border: "1px solid #6366F122", marginBottom: 8 }}>
                    <div style={{ fontSize: 9, color: "#6366F1", fontWeight: 700, marginBottom: 2 }}>💡 AI Suggested Action</div>
                    <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.4 }}>{action.suggestedAction}</div>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  {action.type === "auto_triage" ? (
                    <>
                      <button onClick={() => applyAiTriage(action.id)} style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #6366F1, #06B6D4)", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>🤖 Apply Triage</button>
                      <button onClick={() => rejectAiAction(action.id, "Triage not applicable")} style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid #FF525244", background: "#FF525211", color: "#FF5252", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>❌ Reject</button>
                    </>
                  ) : action.type === "kb_draft" ? (
                    <>
                      <button onClick={() => approveKBDraft(action.id)} style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #81C784, #4CAF50)", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>📚 Publish KB</button>
                      <button onClick={() => rejectAiAction(action.id, "KB not needed")} style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid #FF525244", background: "#FF525211", color: "#FF5252", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>❌ Reject</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => approveAiAction(action.id)} style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #4CAF50, #45a049)", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>✅ Approve & Execute</button>
                      <button onClick={() => rejectAiAction(action.id, "Not needed")} style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid #FF525244", background: "#FF525211", color: "#FF5252", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>❌ Reject</button>
                      <button onClick={() => sendAiApprovalEmail(action.id)} title="Send approval request via Outlook" style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #06B6D444", background: "#06B6D411", color: "#06B6D4", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>📧</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Zendesk AI Drafts Pending Review ─── */}
      {(reviewTab === "all" || reviewTab === "zendesk") && pendingZdQueue.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#EC4899" }}>🎫</span> Zendesk AI Drafts — Engineer Review
            <span style={{ fontSize: 10, color: "#5A6178", fontWeight: 400 }}>({pendingZdQueue.length})</span>
          </h3>
          {pendingZdQueue.map(item => (
            <div key={item.id} style={{ padding: "14px 16px", marginBottom: 10, borderRadius: 10, background: "#1E213044", border: "1px solid #EC489933" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#EC489922", color: "#EC4899", fontWeight: 700 }}>{item.id}</span>
                    <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#FFB34722", color: "#FFB347", fontWeight: 600 }}>⏳ Pending Review</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", marginBottom: 4 }}>{item.ticketSubject || item.subject}</div>
                  <div style={{ fontSize: 11, color: "#8B8FA3", marginBottom: 4 }}>Customer: {item.requesterName || item.customerCompany || item.customer || "—"}{item.requesterEmail ? ` (${item.requesterEmail})` : ""}</div>
                </div>
                <div style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "#81C78422", color: "#81C784", fontWeight: 600 }}>🎯 {item.confidence}%</div>
              </div>
              {(item.draftResponse || item.aiDraft) && (
                <div style={{ padding: "8px 12px", background: "#06B6D408", borderRadius: 6, border: "1px solid #06B6D422", marginBottom: 8 }}>
                  <div style={{ fontSize: 9, color: "#06B6D4", fontWeight: 700, marginBottom: 2 }}>📝 AI Draft Response</div>
                  <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.4 }}>{item.draftResponse || item.aiDraft}</div>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => zdApproveAndSend(item.id)} style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #4CAF50, #45a049)", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>✅ Approve & Send</button>
                <button onClick={() => { setActiveModule("zendesk"); setTimeout(() => setZdTab("queue"), 50); }} style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid #06B6D444", background: "#06B6D411", color: "#06B6D4", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>✏️ Edit in Zendesk</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Change & Request Approvals ─── */}
      {(reviewTab === "all" || reviewTab === "approvals") && (pendingChanges.length > 0 || pendingRequests.length > 0) && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#FFB347" }}>✓</span> Change & Service Request Approvals
            <span style={{ fontSize: 10, color: "#5A6178", fontWeight: 400 }}>({pendingChanges.length + pendingRequests.length})</span>
          </h3>
          {pendingChanges.map(ch => (
            <div key={ch.id} style={{ padding: "14px 16px", marginBottom: 10, borderRadius: 10, background: "#1E213044", border: "1px solid #FFB34733", cursor: "pointer" }} onClick={() => { setDetailItem(ch); setModal("changeDetail"); }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#FFB34722", color: "#FFB347", fontWeight: 700 }}>{ch.id}</span>
                <Badge color={{ bg: "#2D1F0A", text: "#FFB347" }}>Awaiting Approval</Badge>
                <Badge color={PRIORITY_COLORS[ch.priority]}>{ch.risk} Risk</Badge>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", marginBottom: 4 }}>{ch.title}</div>
              <div style={{ fontSize: 11, color: "#8B8FA3" }}>Type: {ch.type} · Requested by: {ch.requestedBy}</div>
            </div>
          ))}
          {pendingRequests.map(req => (
            <div key={req.id} style={{ padding: "14px 16px", marginBottom: 10, borderRadius: 10, background: "#1E213044", border: "1px solid #06B6D433", cursor: "pointer" }} onClick={() => { setDetailItem(req); setModal("requestDetail"); }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#06B6D422", color: "#06B6D4", fontWeight: 700 }}>{req.id}</span>
                <Badge color={{ bg: "#2D1F0A", text: "#FFB347" }}>Pending Approval</Badge>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", marginBottom: 4 }}>{req.service}</div>
              <div style={{ fontSize: 11, color: "#8B8FA3" }}>Requested by: {req.requestedBy}</div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {totalPending === 0 && reviewTab === "all" && (
        <div style={{ textAlign: "center", padding: 60, color: "#5A6178" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#E8ECF4", marginBottom: 8 }}>All Clear — No Pending Reviews</div>
          <div style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 400, margin: "0 auto" }}>
            All AI actions, Zendesk drafts, and change/request approvals have been reviewed.
            The AI monitor will alert you when new items need attention.
          </div>
          <button onClick={() => runAiMonitor()} disabled={aiActionsLoading} style={{ marginTop: 20, padding: "10px 24px", borderRadius: 8, border: "1px solid #6366F133", background: "#6366F118", color: "#6366F1", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            🤖 Run AI Monitor Scan
          </button>
        </div>
      )}
      {((reviewTab === "ai" && pendingAiActions.length === 0) || (reviewTab === "zendesk" && pendingZdQueue.length === 0) || (reviewTab === "approvals" && pendingChanges.length === 0 && pendingRequests.length === 0)) && (
        <div style={{ textAlign: "center", padding: 40, color: "#5A6178" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>No pending items in this category</div>
        </div>
      )}
    </div>
  );
}
