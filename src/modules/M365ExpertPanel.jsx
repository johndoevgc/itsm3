import React, { useEffect, useState } from "react";
import { btnStyle, inputStyle } from "../constants/theme.js";

const ADMIN_ROLES = new Set(["Administrator", "VGC Dev Admin"]);

function defaultTargetUpn(inc) {
  return inc?.reporterEmail || inc?.customerEmail || inc?.requesterEmail || "";
}

function FindingBadge({ severity }) {
  const colors = { critical: "#FF4444", high: "#FF6B6B", medium: "#FFB347", low: "#81C784", info: "#64B5F6" };
  const color = colors[String(severity || "info").toLowerCase()] || colors.info;
  return <span style={{ padding: "2px 8px", borderRadius: 10, background: `${color}22`, border: `1px solid ${color}44`, color, fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>{severity || "info"}</span>;
}

export default function M365ExpertPanel({ inc, currentUser, showToast, addActivity }) {
  const [targetUpn, setTargetUpn] = useState(defaultTargetUpn(inc));
  const [diagnostic, setDiagnostic] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const isAdmin = ADMIN_ROLES.has(currentUser?.rbacRole);

  useEffect(() => {
    setTargetUpn(defaultTargetUpn(inc));
    setDiagnostic(null);
    setProposal(null);
  }, [inc?.id]);

  useEffect(() => {
    if (!inc?.id) return;
    fetch(`/api/m365/actions?incidentId=${encodeURIComponent(inc.id)}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && Array.isArray(d.data)) setActions(d.data); })
      .catch(() => {});
  }, [inc?.id, proposal?.id]);

  const postJson = async (url, body) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
    return data;
  };

  const runDiagnostics = async () => {
    if (!inc?.id || !targetUpn.trim()) return;
    setLoading(true);
    try {
      const data = await postJson("/api/m365/entra/diagnose", { incidentId: inc.id, targetUpn: targetUpn.trim() });
      setDiagnostic(data);
      addActivity?.("m365_action", `M365 diagnostics completed for ${data.targetUpn}`, { runId: data.runId });
      showToast?.("M365 diagnostics completed", "success");
    } catch (err) {
      setDiagnostic({ ok: false, error: err.message });
      showToast?.(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const proposeAction = async () => {
    setActionLoading(true);
    try {
      const data = await postJson("/api/m365/actions/propose", {
        incidentId: inc.id,
        targetUpn: targetUpn.trim(),
        actionId: "forceSignOut",
        diagnosticRunId: diagnostic?.runId,
      });
      setProposal(data.proposal);
      addActivity?.("m365_action", `M365 force sign-out pending approval for ${targetUpn.trim()}`, { proposalId: data.proposal.id });
      showToast?.("M365 action proposal created", "success");
    } catch (err) {
      showToast?.(err.message, "error");
    } finally {
      setActionLoading(false);
    }
  };

  const executeProposal = async (proposalId) => {
    setActionLoading(true);
    try {
      const data = await postJson("/api/m365/actions/approve-execute", { proposalId });
      setProposal(data.proposal);
      addActivity?.("m365_action", `M365 force sign-out ${data.proposal.status} for ${data.proposal.targetUpn}`, { proposalId });
      showToast?.(`M365 action ${data.proposal.status}`, data.ok ? "success" : "error");
    } catch (err) {
      showToast?.(err.message, "error");
    } finally {
      setActionLoading(false);
    }
  };

  const latestProposal = proposal || actions.find(a => a.actionId === "forceSignOut" && a.status === "pending_approval") || null;
  const forceAction = diagnostic?.recommendedActions?.find(a => a.id === "forceSignOut");

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 16, marginBottom: 16 }}>
        <div style={{ background: "#0F1117", border: "1px solid #1E2130", borderRadius: 8, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, color: "#E8ECF4", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>M365/Azure Expert</div>
              <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{inc?.customer || inc?.company || inc?.organization || "Unmapped customer"}</div>
            </div>
            <span style={{ padding: "3px 9px", borderRadius: 10, background: "#06B6D422", color: "#06B6D4", fontSize: 9, fontWeight: 700 }}>ENTRA AUTH</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={targetUpn} onChange={e => setTargetUpn(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="user@vgcsg.com" />
            <button onClick={runDiagnostics} disabled={loading || !targetUpn.trim()} style={{ ...btnStyle("#6366F1"), minWidth: 140 }}>{loading ? "Checking..." : "Diagnose"}</button>
          </div>
        </div>
        <div style={{ background: "#0F1117", border: "1px solid #1E2130", borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Approval</div>
          <div style={{ fontSize: 12, color: isAdmin ? "#81C784" : "#FFB347", fontWeight: 700 }}>{isAdmin ? "Administrator" : "Administrator required"}</div>
          <div style={{ fontSize: 11, color: "#8B8FA3", marginTop: 6 }}>{latestProposal ? `Proposal ${latestProposal.status}` : "No pending M365 action"}</div>
        </div>
      </div>

      {diagnostic?.error && <div style={{ background: "#FF6B6B12", border: "1px solid #FF6B6B33", borderRadius: 8, padding: 12, color: "#FF8A8A", fontSize: 12, marginBottom: 16 }}>{diagnostic.error}</div>}

      {diagnostic?.ok && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "#0F1117", border: "1px solid #1E2130", borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Evidence</div>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontSize: 12, color: "#C4CAD6" }}>Account: <strong style={{ color: diagnostic.diagnostics?.account?.accountEnabled === false ? "#FF6B6B" : "#81C784" }}>{diagnostic.diagnostics?.account?.accountEnabled === false ? "Disabled" : "Enabled"}</strong></div>
              <div style={{ fontSize: 12, color: "#C4CAD6" }}>Recent sign-ins: {diagnostic.diagnostics?.signIns?.recent?.length || 0}</div>
              <div style={{ fontSize: 12, color: "#C4CAD6" }}>Auth methods: {diagnostic.diagnostics?.authenticationMethods?.methods?.length || 0}</div>
              <div style={{ fontSize: 12, color: "#C4CAD6" }}>GDAP: {diagnostic.customer?.gdapStatus || "unknown"}</div>
              <div style={{ fontSize: 11, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{diagnostic.customer?.primaryDomain} - {diagnostic.customer?.m365TenantId}</div>
            </div>
          </div>
          <div style={{ background: "#0F1117", border: "1px solid #1E2130", borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Findings</div>
            {(diagnostic.findings || []).map((finding, index) => (
              <div key={`${finding.title}-${index}`} style={{ padding: "8px 0", borderBottom: index === diagnostic.findings.length - 1 ? "none" : "1px solid #1E213066" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}><FindingBadge severity={finding.severity} /><span style={{ color: "#E8ECF4", fontSize: 12, fontWeight: 700 }}>{finding.title}</span></div>
                <div style={{ color: "#8B8FA3", fontSize: 11, lineHeight: 1.45 }}>{finding.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {diagnostic?.ok && forceAction && (
        <div style={{ marginTop: 16, background: "#0F1117", border: "1px solid #1E2130", borderRadius: 8, padding: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ color: "#E8ECF4", fontSize: 13, fontWeight: 700 }}>Force sign-out</div>
            <div style={{ color: forceAction.enabled ? "#8B8FA3" : "#FFB347", fontSize: 11, marginTop: 3 }}>{forceAction.reason}</div>
          </div>
          {!latestProposal && <button onClick={proposeAction} disabled={actionLoading || !forceAction.enabled} style={btnStyle("#FFB347")}>{actionLoading ? "Creating..." : "Request Approval"}</button>}
          {latestProposal && isAdmin && latestProposal.status === "pending_approval" && <button onClick={() => executeProposal(latestProposal.id)} disabled={actionLoading} style={btnStyle("#10B981")}>{actionLoading ? "Running..." : "Approve & Execute"}</button>}
          {latestProposal && (!isAdmin || latestProposal.status !== "pending_approval") && <span style={{ color: "#8B8FA3", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{latestProposal.status}</span>}
        </div>
      )}
    </div>
  );
}
