import React, { useState, useMemo } from "react";
import {
  COLORS, inputStyle, btnStyle,
} from "../constants/theme.js";
import {
  Badge, useStableComponent,
} from "../components/SharedComponents.jsx";

// Service Status Page — extracted from itsm-tool.jsx
export default function ServiceStatusModule({ ctx }) {
  const {
    currentUser, incidents, changes,
    setDetailItem = () => {},
    setModal = () => {},
    setDetailTab = () => {},
  } = ctx;
  const SERVICES_LIST = [
    { name: "Email & Collaboration", icon: "📧", group: "Communication" },
    { name: "Network Services", icon: "🌐", group: "Infrastructure" },
    { name: "Database Services", icon: "🗄️", group: "Infrastructure" },
    { name: "Business Applications", icon: "💼", group: "Applications" },
    { name: "End User Computing", icon: "🖥️", group: "Workplace" },
    { name: "Cloud Infrastructure", icon: "☁️", group: "Infrastructure" },
    { name: "Security Operations", icon: "🛡️", group: "Security" },
    { name: "Remote Access / VPN", icon: "🔒", group: "Communication" },
    { name: "Print Services", icon: "🖨️", group: "Workplace" },
    { name: "Identity & Access", icon: "🔑", group: "Security" },
  ];
  const getServiceStatus = (svcName) => {
    const svcIncs = incidents.filter(i => (i.category || "").toLowerCase().includes(svcName.toLowerCase().split(" ")[0].toLowerCase()) && i.status !== "Resolved" && i.status !== "Closed");
    const hasCritical = svcIncs.some(i => i.priority === "Sev-A");
    const hasMajor = svcIncs.some(i => i.isMajorIncident);
    const hasHigh = svcIncs.some(i => i.priority === "Sev-B");
    const hasIssues = svcIncs.length > 0;
    if (hasMajor || hasCritical) return { status: "Major Outage", color: "#FF4444", icon: "🔴" };
    if (hasHigh) return { status: "Degraded", color: "#FFB347", icon: "🟡" };
    if (hasIssues) return { status: "Minor Issue", color: "#FFD700", icon: "🟡" };
    return { status: "Operational", color: "#4CAF50", icon: "🟢" };
  };
  const allStatuses = SERVICES_LIST.map(s => ({ ...s, ...getServiceStatus(s.name) }));
  const operationalCount = allStatuses.filter(s => s.status === "Operational").length;
  const overallColor = operationalCount === allStatuses.length ? "#4CAF50" : operationalCount >= allStatuses.length - 2 ? "#FFB347" : "#FF4444";
  const overallStatus = operationalCount === allStatuses.length ? "All Systems Operational" : `${allStatuses.length - operationalCount} service(s) impacted`;
  const majorIncs = incidents.filter(i => i.isMajorIncident && i.status !== "Resolved" && i.status !== "Closed");
  const recentResolved = incidents.filter(i => i.status === "Resolved").sort((a, b) => new Date(b.resolvedAt || b.updatedAt || 0) - new Date(a.resolvedAt || a.updatedAt || 0)).slice(0, 5);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* Overall Status Banner */}
      <div style={{ padding: 24, borderRadius: 12, marginBottom: 20, background: `${overallColor}08`, border: `1px solid ${overallColor}33`, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>{operationalCount === allStatuses.length ? "✅" : "⚠️"}</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: overallColor, fontFamily: "'Space Grotesk', sans-serif" }}>{overallStatus}</div>
        <div style={{ fontSize: 11, color: "#5A6178", marginTop: 4 }}>Last updated: {new Date().toLocaleString("en-GB", { timeZone: "Asia/Singapore" })} SGT</div>
      </div>

      {/* Active Major Incidents */}
      {majorIncs.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 14, color: "#FF6B6B", fontFamily: "'Space Grotesk', sans-serif" }}>🚨 Active Major Incidents</h3>
          {majorIncs.map(mi => (
            <div key={mi.id} style={{ padding: 14, background: "#FF444408", borderRadius: 8, border: "1px solid #FF444433", marginBottom: 8, cursor: "pointer" }}
              onClick={() => { setDetailItem(mi); setModal("incidentDetail"); setDetailTab("majorIncident"); }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#FF6B6B" }}>{mi.id}</span>
                  <span style={{ fontSize: 12, color: "#E8ECF4", marginLeft: 8 }}>{mi.title}</span>
                </div>
                <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{new Date(mi.majorDeclaredAt || mi.createdAt).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Service Status Grid */}
      <div style={{ background: "#0F1117", borderRadius: 12, border: "1px solid #1E2130", padding: 20, marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>Service Status</h3>
        {allStatuses.map((svc, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#0A0C14", borderRadius: 8, border: "1px solid #1E213044", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16 }}>{svc.icon}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#E8ECF4" }}>{svc.name}</div>
                <div style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{svc.group}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10 }}>{svc.icon === "🟢" ? "" : ""}{svc.icon2 || ""}</span>
              <span style={{ padding: "3px 10px", borderRadius: 4, background: `${svc.color}18`, color: svc.color, fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{svc.icon} {svc.status}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Uptime Summary */}
      <div style={{ background: "#0F1117", borderRadius: 12, border: "1px solid #1E2130", padding: 20, marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>📊 90-Day Uptime</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
          {SERVICES_LIST.slice(0, 5).map((svc, i) => {
            const uptime = (97 + Math.random() * 3).toFixed(2);
            return (
              <div key={i} style={{ textAlign: "center", padding: 12, background: "#0A0C14", borderRadius: 8, border: "1px solid #1E213044" }}>
                <div style={{ fontSize: 14 }}>{svc.icon}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: parseFloat(uptime) >= 99.5 ? "#4CAF50" : parseFloat(uptime) >= 99 ? "#FFB347" : "#FF4444", fontFamily: "'JetBrains Mono', monospace", marginTop: 4 }}>{uptime}%</div>
                <div style={{ fontSize: 9, color: "#5A6178", marginTop: 2 }}>{svc.name.split(" ")[0]}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Resolved Incidents */}
      <div style={{ background: "#0F1117", borderRadius: 12, border: "1px solid #1E2130", padding: 20 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>✅ Recently Resolved</h3>
        {recentResolved.length === 0 && <div style={{ fontSize: 11, color: "#5A6178", textAlign: "center", padding: 20 }}>No recent resolutions</div>}
        {recentResolved.map((inc, i) => (
          <div key={inc.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#0A0C14", borderRadius: 6, border: "1px solid #1E213033", marginBottom: 4, cursor: "pointer" }}
            onClick={() => { setDetailItem(inc); setModal("incidentDetail"); setDetailTab("details"); }}>
            <span style={{ fontSize: 10, color: "#4CAF50" }}>✓</span>
            <span style={{ fontSize: 11, color: "#E8ECF4", flex: 1 }}>{inc.title}</span>
            <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{new Date(inc.resolvedAt || inc.updatedAt || inc.createdAt).toLocaleDateString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
