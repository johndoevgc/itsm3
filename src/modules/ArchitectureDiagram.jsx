import { useState } from "react";
import {
  COLORS, inputStyle, btnStyle,
} from "../constants/theme.js";

// Architecture Diagram — extracted from itsm-tool.jsx
export default function ArchitectureDiagram() {
  const [selectedLayer, setSelectedLayer] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);

  const layers = [
    { id: "frontend", label: "Frontend Layer", icon: "⚛️", color: "#6366F1", nodes: [
      { id: "spa", icon: "🌐", label: "React SPA", tech: "React 19 + Vite 8", desc: "Single-page app with module-based architecture" },
      { id: "msal", icon: "🔐", label: "MSAL Auth", tech: "MSAL.js 2.x", desc: "Azure AD authentication with token management" },
      { id: "ui", icon: "🎨", label: "Dark UI", tech: "CSS-in-JS", desc: "Premium dark theme with animations" },
    ]},
    { id: "api", label: "API Layer", icon: "⚡", color: "#3B82F6", nodes: [
      { id: "rest", icon: "🔌", label: "REST API", tech: "Node.js HTTP", desc: "Custom HTTP server with route handling" },
      { id: "graph", icon: "📧", label: "Graph API", tech: "Microsoft Graph", desc: "Email, calendar, and user data integration" },
      { id: "zendesk", icon: "🎫", label: "Zendesk API", tech: "REST + Webhook", desc: "Bidirectional ticket sync" },
    ]},
    { id: "services", label: "Service Layer", icon: "⚙️", color: "#EC4899", nodes: [
      { id: "ai", icon: "🧠", label: "AI Engine", tech: "VGC-AI Engine", desc: "Triage, drafting, and knowledge extraction" },
      { id: "workflow", icon: "🔄", label: "Workflow Engine", tech: "Rule-based", desc: "Automated escalation and routing" },
      { id: "sla", icon: "⏱️", label: "SLA Monitor", tech: "Real-time", desc: "SLA tracking with breach alerting" },
    ]},
    { id: "data", label: "Data Layer", icon: "💾", color: "#FFB347", nodes: [
      { id: "db", icon: "🐬", label: "Database", tech: "MySQL / SQLite", desc: "Primary data store with audit logging" },
      { id: "cache", icon: "📦", label: "Local Cache", tech: "localStorage", desc: "Client-side state persistence" },
      { id: "audit", icon: "📋", label: "Audit Log", tech: "Immutable", desc: "Complete change tracking" },
    ]},
    { id: "cloud", label: "Cloud Infrastructure", icon: "☁️", color: "#81C784", nodes: [
      { id: "appservice", icon: "🏗️", label: "App Service", tech: "Azure B1", desc: "Windows hosting with Node.js 20" },
      { id: "entra", icon: "🔒", label: "Entra ID", tech: "OAuth 2.0", desc: "Identity and access management" },
      { id: "monitor", icon: "📊", label: "Monitor", tech: "Azure Monitor", desc: "Application insights and alerting" },
    ]},
  ];

  const connections = [
    { from: "spa", to: "rest", color: "#6366F166" },
    { from: "rest", to: "ai", color: "#3B82F666" },
    { from: "rest", to: "db", color: "#3B82F666" },
    { from: "ai", to: "db", color: "#EC489966" },
    { from: "db", to: "appservice", color: "#FFB34766" },
  ];

  return (
    <div style={{ padding: 0 }}>
      <style>{`
        @keyframes archFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes archNodeFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        @keyframes archPulse { 0%, 100% { box-shadow: 0 0 0 0 var(--pulse-color); } 50% { box-shadow: 0 0 8px 2px var(--pulse-color); } }
        @keyframes archGlow { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
        @keyframes archFlowDash { to { stroke-dashoffset: -20; } }
        @keyframes archConnectorPulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
        @keyframes archLabelSlide { from { opacity: 0; transform: translateX(-12px); } to { opacity: 1; transform: translateX(0); } }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 24, animation: "archFadeIn 0.6s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 28, animation: "archNodeFloat 3s ease-in-out infinite" }}>🏛️</span>
          <div>
            <h2 style={{ margin: 0, color: "#E8ECF4", fontSize: 18, fontFamily: "'Space Grotesk', sans-serif" }}>VGC-ITSM Platform Architecture</h2>
            <div style={{ fontSize: 11, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>End-to-end system architecture with live component status</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={() => setSelectedLayer(null)} style={{ padding: "5px 12px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", background: !selectedLayer ? "#6366F122" : "#ffffff06", color: !selectedLayer ? "#6366F1" : "#5A6178", border: `1px solid ${!selectedLayer ? "#6366F144" : "#1E2130"}`, fontFamily: "'JetBrains Mono', monospace" }}>ALL LAYERS</button>
          {layers.map(l => (
            <button key={l.id} onClick={() => setSelectedLayer(selectedLayer === l.id ? null : l.id)} style={{ padding: "5px 12px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", background: selectedLayer === l.id ? l.color + "22" : "#ffffff06", color: selectedLayer === l.id ? l.color : "#5A6178", border: `1px solid ${selectedLayer === l.id ? l.color + "44" : "#1E2130"}`, fontFamily: "'JetBrains Mono', monospace" }}>{l.label}</button>
          ))}
        </div>
      </div>

      {/* Architecture Layers */}
      <div style={{ position: "relative" }}>
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }}>
          {connections.map((c, i) => (
            <line key={i} x1="50%" y1={`${layers.findIndex(l => l.nodes.some(n => n.id === c.from)) * 140 + 60}px`}
              x2="50%" y2={`${layers.findIndex(l => l.nodes.some(n => n.id === c.to)) * 140 + 60}px`}
              stroke={c.color} strokeWidth="1" strokeDasharray="6 4"
              style={{ animation: `archFlowDash 1.5s linear infinite, archConnectorPulse 3s ease-in-out ${i * 0.3}s infinite` }} />
          ))}
        </svg>

        {layers.filter(l => !selectedLayer || l.id === selectedLayer).map((layer, li) => (
          <div key={layer.id} style={{ marginBottom: 16, position: "relative", zIndex: 1, animation: `archFadeIn 0.5s ease ${li * 0.12}s both` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, animation: `archLabelSlide 0.4s ease ${li * 0.12}s both` }}>
              <span style={{ fontSize: 16, animation: "archNodeFloat 4s ease-in-out infinite" }}>{layer.icon}</span>
              <div style={{ fontSize: 10, fontWeight: 700, color: layer.color, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1.5, textTransform: "uppercase" }}>{layer.label}</div>
              <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${layer.color}44, transparent)` }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: `repeat(${layer.nodes.length}, 1fr)`, gap: 12 }}>
              {layer.nodes.map((node, ni) => {
                const isHovered = hoveredNode === node.id;
                return (
                  <div key={node.id}
                    onMouseEnter={() => setHoveredNode(node.id)}
                    onMouseLeave={() => setHoveredNode(null)}
                    style={{
                      background: isHovered ? `linear-gradient(135deg, ${layer.color}12, #12141E)` : "#0F1117",
                      borderRadius: 10, padding: 16,
                      border: `1px solid ${isHovered ? layer.color + "55" : "#1E213044"}`,
                      cursor: "default", position: "relative", overflow: "hidden",
                      transition: "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
                      transform: isHovered ? "translateY(-4px) scale(1.02)" : "translateY(0) scale(1)",
                      boxShadow: isHovered ? `0 12px 32px ${layer.color}15` : "none",
                      animation: `archFadeIn 0.4s ease ${li * 0.12 + ni * 0.08}s both`,
                      "--pulse-color": layer.color + "40",
                    }}>
                    {isHovered && <div style={{ position: "absolute", top: 0, right: 0, width: 40, height: 40, background: `linear-gradient(135deg, transparent 50%, ${layer.color}15 50%)`, animation: "archGlow 2s ease-in-out infinite" }} />}
                    <div style={{ position: "absolute", top: 12, right: 12, width: 7, height: 7, borderRadius: "50%", background: "#4CAF50", animation: "archPulse 2s infinite", "--pulse-color": "#4CAF5040" }} />
                    <div style={{ fontSize: 22, marginBottom: 8, transition: "transform 0.3s", transform: isHovered ? "scale(1.15)" : "scale(1)" }}>{node.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#E8ECF4", marginBottom: 3, fontFamily: "'Space Grotesk', sans-serif" }}>{node.label}</div>
                    <div style={{ fontSize: 9, color: layer.color, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, marginBottom: 8, padding: "2px 6px", background: layer.color + "12", borderRadius: 4, display: "inline-block" }}>{node.tech}</div>
                    <div style={{ fontSize: 10, color: "#A0AEC0", lineHeight: 1.5, transition: "color 0.3s", ...(isHovered ? { color: "#C4CAD6" } : {}) }}>{node.desc}</div>
                  </div>
                );
              })}
            </div>

            {li < layers.filter(l => !selectedLayer || l.id === selectedLayer).length - 1 && (
              <div style={{ textAlign: "center", padding: "6px 0", position: "relative", zIndex: 2 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" style={{ animation: `archNodeFloat 2s ease-in-out ${li * 0.3}s infinite` }}>
                  <path d="M12 4 L12 18 M6 14 L12 20 L18 14" fill="none" stroke={layer.color + "66"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ animation: "archFlowDash 1.5s linear infinite" }} strokeDasharray="4 3" />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Data Flow Summary */}
      <div style={{ marginTop: 20, background: "#0A0C14", borderRadius: 10, border: "1px solid #1E213044", padding: 18, animation: "archFadeIn 0.6s ease 1s both" }}>
        <div style={{ fontSize: 11, color: "#06B6D4", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>🔗 DATA FLOW — REQUEST LIFECYCLE</div>
        <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap" }}>
          {[
            { label: "User", icon: "👤", color: "#6366F1" },
            { label: "Browser SPA", icon: "🌐", color: "#6366F1" },
            { label: "HTTPS", icon: "→", color: "#3B82F6", isArrow: true },
            { label: "REST API", icon: "⚡", color: "#3B82F6" },
            { label: "Auth Check", icon: "→", color: "#EC4899", isArrow: true },
            { label: "Service Layer", icon: "⚙️", color: "#EC4899" },
            { label: "Query", icon: "→", color: "#FFB347", isArrow: true },
            { label: "MySQL", icon: "🐬", color: "#FFB347" },
            { label: "Response", icon: "←", color: "#81C784", isArrow: true },
            { label: "Render UI", icon: "✨", color: "#81C784" },
          ].map((step, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, animation: `archFadeIn 0.3s ease ${1.1 + i * 0.08}s both` }}>
              {step.isArrow ? (
                <div style={{ padding: "0 6px", color: step.color, fontSize: 14, fontWeight: 700, animation: `archGlow 2s ease-in-out ${i * 0.2}s infinite` }}>{step.icon}</div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", background: step.color + "12", borderRadius: 6, border: `1px solid ${step.color}22` }}>
                  <span style={{ fontSize: 12 }}>{step.icon}</span>
                  <span style={{ fontSize: 9, color: step.color, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{step.label}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Tech Stack Summary */}
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, animation: "archFadeIn 0.6s ease 1.2s both" }}>
        {[
          { label: "Frontend", items: ["React 19", "Vite 8", "MSAL.js"], color: "#6366F1", icon: "⚛️" },
          { label: "Backend", items: ["Node.js 20", "HTTP Server", "Graph API"], color: "#3B82F6", icon: "🔧" },
          { label: "Database", items: ["Azure MySQL", "JSON Store", "Audit Log"], color: "#FFB347", icon: "💾" },
          { label: "Cloud", items: ["Azure App Service", "Entra ID", "Monitor"], color: "#81C784", icon: "☁️" },
        ].map((stack, i) => (
          <div key={i} style={{ background: "#0F1117", borderRadius: 8, padding: 14, border: `1px solid ${stack.color}22`, animation: `archFadeIn 0.4s ease ${1.3 + i * 0.1}s both` }}>
            <div style={{ fontSize: 14, marginBottom: 6 }}>{stack.icon}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: stack.color, fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>{stack.label}</div>
            {stack.items.map((item, j) => (
              <div key={j} style={{ fontSize: 10, color: "#A0AEC0", padding: "2px 0", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 4, height: 4, borderRadius: "50%", background: stack.color, flexShrink: 0, animation: `archPulse 2s ease ${j * 0.5}s infinite`, "--pulse-color": stack.color + "40" }} />
                {item}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
