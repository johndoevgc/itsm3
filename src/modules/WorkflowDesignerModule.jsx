import { useState, useRef, useCallback, useMemo } from "react";

const NODE_TYPES = [
  { type: "trigger", label: "Trigger", icon: "⚡", color: "#F59E0B", desc: "Event that starts the workflow" },
  { type: "condition", label: "Condition", icon: "🔀", color: "#6366F1", desc: "If/else branch based on field values" },
  { type: "action", label: "Action", icon: "▶️", color: "#10B981", desc: "Execute an operation" },
  { type: "notification", label: "Notify", icon: "🔔", color: "#EC4899", desc: "Send email, Teams, or Slack alert" },
  { type: "delay", label: "Delay", icon: "⏱️", color: "#06B6D4", desc: "Wait before next step" },
  { type: "end", label: "End", icon: "🏁", color: "#EF4444", desc: "Workflow termination" },
];

const TRIGGER_OPTIONS = [
  "Incident Created", "Incident Updated", "Incident Assigned",
  "Priority Changed", "SLA At Risk", "SLA Breached",
  "Change Submitted", "Change Approved", "Problem Created",
];

const ACTION_OPTIONS = [
  "Set Priority", "Set Status", "Assign To", "Add Tag",
  "Escalate", "Auto-Resolve", "Create Child Ticket",
  "Update Field", "Run Script", "Call Webhook",
];

const CONDITION_FIELDS = [
  "priority", "status", "category", "assignee", "customer", "slaStatus", "impact", "urgency",
];

const CONDITION_OPS = ["equals", "not equals", "contains", "greater than", "less than", "in"];

const W = 200, H = 80;

function genNodeId() { return "n_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function NodeBox({ node, selected, onSelect, onDragStart }) {
  const meta = NODE_TYPES.find(t => t.type === node.type) || NODE_TYPES[0];
  return (
    <g
      transform={`translate(${node.x}, ${node.y})`}
      onMouseDown={e => { e.stopPropagation(); onDragStart(e, node.id); }}
      onClick={e => { e.stopPropagation(); onSelect(node.id); }}
      style={{ cursor: "grab" }}
    >
      <rect
        width={W} height={H} rx={12} ry={12}
        fill={selected ? `${meta.color}22` : "#12141E"}
        stroke={selected ? meta.color : "#1E2130"}
        strokeWidth={selected ? 2 : 1}
      />
      {/* Top accent bar */}
      <rect width={W} height={4} rx={2} fill={meta.color} y={0} clipPath="inset(0 round 12px 12px 0 0)" />
      <text x={14} y={30} fill={meta.color} fontSize={16}>{meta.icon}</text>
      <text x={36} y={30} fill="#E8ECF4" fontSize={12} fontWeight={700} fontFamily="Space Grotesk, sans-serif">{node.label || meta.label}</text>
      <text x={14} y={52} fill="#5A6178" fontSize={10} fontFamily="JetBrains Mono, monospace">
        {node.type === "trigger" ? (node.config?.event || "Select trigger...") :
         node.type === "condition" ? `${node.config?.field || "field"} ${node.config?.op || "?"} ${node.config?.value || "?"}` :
         node.type === "action" ? (node.config?.action || "Select action...") :
         node.type === "notification" ? (node.config?.channel || "Select channel...") :
         node.type === "delay" ? `${node.config?.minutes || 0} min` :
         "—"}
      </text>
      {/* Connection ports */}
      <circle cx={W / 2} cy={0} r={5} fill={meta.color} stroke="#0A0C14" strokeWidth={2} />
      {node.type !== "end" && <circle cx={W / 2} cy={H} r={5} fill={meta.color} stroke="#0A0C14" strokeWidth={2} />}
    </g>
  );
}

function ConnectorLine({ from, to, nodes }) {
  const a = nodes.find(n => n.id === from);
  const b = nodes.find(n => n.id === to);
  if (!a || !b) return null;
  const x1 = a.x + W / 2, y1 = a.y + H;
  const x2 = b.x + W / 2, y2 = b.y;
  const cy1 = y1 + Math.abs(y2 - y1) * 0.4;
  const cy2 = y2 - Math.abs(y2 - y1) * 0.4;
  return (
    <path
      d={`M${x1},${y1} C${x1},${cy1} ${x2},${cy2} ${x2},${y2}`}
      fill="none" stroke="#6366F166" strokeWidth={2} strokeDasharray="6 3"
      markerEnd="url(#arrowhead)"
    />
  );
}

function PropertyPanel({ node, onChange, onDelete }) {
  if (!node) return (
    <div style={{ padding: 20, textAlign: "center", color: "#5A6178", fontSize: 11 }}>
      Select a node to edit its properties
    </div>
  );
  const meta = NODE_TYPES.find(t => t.type === node.type) || NODE_TYPES[0];
  const config = node.config || {};
  const set = (key, val) => onChange({ ...node, config: { ...config, [key]: val } });
  const inputSt = { width: "100%", padding: "8px 10px", background: "#0A0C14", border: "1px solid #1E2130", borderRadius: 6, color: "#E8ECF4", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", boxSizing: "border-box" };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 18 }}>{meta.icon}</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: meta.color, fontFamily: "'Space Grotesk', sans-serif" }}>{meta.label} Node</div>
          <div style={{ fontSize: 9, color: "#5A6178" }}>{meta.desc}</div>
        </div>
      </div>

      <label style={{ fontSize: 10, color: "#8B92A8", display: "block", marginBottom: 4 }}>Label</label>
      <input value={node.label || ""} onChange={e => onChange({ ...node, label: e.target.value })} style={{ ...inputSt, marginBottom: 12 }} placeholder={meta.label} />

      {node.type === "trigger" && <>
        <label style={{ fontSize: 10, color: "#8B92A8", display: "block", marginBottom: 4 }}>Trigger Event</label>
        <select value={config.event || ""} onChange={e => set("event", e.target.value)} style={{ ...inputSt, marginBottom: 12 }}>
          <option value="">Select...</option>
          {TRIGGER_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </>}

      {node.type === "condition" && <>
        <label style={{ fontSize: 10, color: "#8B92A8", display: "block", marginBottom: 4 }}>Field</label>
        <select value={config.field || ""} onChange={e => set("field", e.target.value)} style={{ ...inputSt, marginBottom: 8 }}>
          <option value="">Select field...</option>
          {CONDITION_FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <label style={{ fontSize: 10, color: "#8B92A8", display: "block", marginBottom: 4 }}>Operator</label>
        <select value={config.op || ""} onChange={e => set("op", e.target.value)} style={{ ...inputSt, marginBottom: 8 }}>
          <option value="">Select...</option>
          {CONDITION_OPS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <label style={{ fontSize: 10, color: "#8B92A8", display: "block", marginBottom: 4 }}>Value</label>
        <input value={config.value || ""} onChange={e => set("value", e.target.value)} style={{ ...inputSt, marginBottom: 12 }} placeholder="e.g. Sev-A" />
      </>}

      {node.type === "action" && <>
        <label style={{ fontSize: 10, color: "#8B92A8", display: "block", marginBottom: 4 }}>Action</label>
        <select value={config.action || ""} onChange={e => set("action", e.target.value)} style={{ ...inputSt, marginBottom: 8 }}>
          <option value="">Select action...</option>
          {ACTION_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <label style={{ fontSize: 10, color: "#8B92A8", display: "block", marginBottom: 4 }}>Value</label>
        <input value={config.value || ""} onChange={e => set("value", e.target.value)} style={{ ...inputSt, marginBottom: 12 }} placeholder="e.g. L2 Support" />
      </>}

      {node.type === "notification" && <>
        <label style={{ fontSize: 10, color: "#8B92A8", display: "block", marginBottom: 4 }}>Channel</label>
        <select value={config.channel || ""} onChange={e => set("channel", e.target.value)} style={{ ...inputSt, marginBottom: 8 }}>
          <option value="">Select...</option>
          <option value="email">Email</option>
          <option value="teams">Microsoft Teams</option>
          <option value="slack">Slack</option>
          <option value="inApp">In-App</option>
        </select>
        <label style={{ fontSize: 10, color: "#8B92A8", display: "block", marginBottom: 4 }}>Recipient</label>
        <input value={config.recipient || ""} onChange={e => set("recipient", e.target.value)} style={{ ...inputSt, marginBottom: 8 }} placeholder="e.g. assignee or email" />
        <label style={{ fontSize: 10, color: "#8B92A8", display: "block", marginBottom: 4 }}>Message</label>
        <textarea value={config.message || ""} onChange={e => set("message", e.target.value)} rows={3} style={{ ...inputSt, marginBottom: 12, resize: "vertical" }} placeholder="Notification message..." />
      </>}

      {node.type === "delay" && <>
        <label style={{ fontSize: 10, color: "#8B92A8", display: "block", marginBottom: 4 }}>Delay (minutes)</label>
        <input type="number" min={1} value={config.minutes || 15} onChange={e => set("minutes", parseInt(e.target.value) || 1)} style={{ ...inputSt, marginBottom: 12 }} />
      </>}

      <button onClick={() => onDelete(node.id)} style={{
        width: "100%", padding: "8px 0", background: "#EF444418", border: "1px solid #EF444433",
        borderRadius: 6, color: "#EF4444", cursor: "pointer", fontSize: 11, fontWeight: 600, marginTop: 8
      }}>Delete Node</button>
    </div>
  );
}

export default function WorkflowDesignerModule({ workflowRules, setWorkflowRules, automationRules, setAutomationRules, currentUser, API, _save, toast }) {
  const [nodes, setNodes] = useState([
    { id: "start", type: "trigger", x: 300, y: 40, label: "On Incident Created", config: { event: "Incident Created" } },
    { id: "check", type: "condition", x: 300, y: 180, label: "High Priority?", config: { field: "priority", op: "equals", value: "Sev-A" } },
    { id: "escalate", type: "action", x: 300, y: 320, label: "Escalate to L2", config: { action: "Escalate", value: "L2 Support" } },
    { id: "notify", type: "notification", x: 300, y: 460, label: "Alert Manager", config: { channel: "teams", recipient: "manager", message: "Sev-A incident escalated" } },
  ]);
  const [edges, setEdges] = useState([
    { from: "start", to: "check" },
    { from: "check", to: "escalate" },
    { from: "escalate", to: "notify" },
  ]);
  const [selectedId, setSelectedId] = useState(null);
  const [connecting, setConnecting] = useState(null);
  const [dragNode, setDragNode] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [ruleName, setRuleName] = useState("New Workflow Rule");
  const svgRef = useRef(null);

  const selectedNode = useMemo(() => nodes.find(n => n.id === selectedId), [nodes, selectedId]);

  const addNode = useCallback((type) => {
    const id = genNodeId();
    const maxY = nodes.reduce((m, n) => Math.max(m, n.y), 0);
    setNodes(prev => [...prev, { id, type, x: 300, y: maxY + 120, label: "", config: {} }]);
    setSelectedId(id);
  }, [nodes]);

  const updateNode = useCallback((updated) => {
    setNodes(prev => prev.map(n => n.id === updated.id ? updated : n));
  }, []);

  const deleteNode = useCallback((id) => {
    setNodes(prev => prev.filter(n => n.id !== id));
    setEdges(prev => prev.filter(e => e.from !== id && e.to !== id));
    setSelectedId(null);
  }, []);

  const handleDragStart = useCallback((e, nodeId) => {
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    setDragNode(nodeId);
    setDragOffset({ x: svgP.x - node.x, y: svgP.y - node.y });
  }, [nodes]);

  const handleMouseMove = useCallback((e) => {
    if (!dragNode) return;
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
    setNodes(prev => prev.map(n => n.id === dragNode ? { ...n, x: svgP.x - dragOffset.x, y: svgP.y - dragOffset.y } : n));
  }, [dragNode, dragOffset]);

  const handleMouseUp = useCallback(() => { setDragNode(null); }, []);

  const startConnect = useCallback((nodeId) => {
    if (!connecting) {
      setConnecting(nodeId);
    } else {
      if (connecting !== nodeId && !edges.find(e => e.from === connecting && e.to === nodeId)) {
        setEdges(prev => [...prev, { from: connecting, to: nodeId }]);
      }
      setConnecting(null);
    }
  }, [connecting, edges]);

  const saveWorkflow = useCallback(async () => {
    const rule = {
      id: "WF_" + Date.now().toString(36),
      name: ruleName,
      status: "Active",
      nodes: nodes,
      edges: edges,
      createdBy: currentUser?.name || "Admin",
      createdAt: new Date().toISOString(),
      source: "designer",
    };
    try {
      const res = await fetch(`${API}/api/data/workflow_rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      });
      if (res.ok) {
        if (setWorkflowRules) setWorkflowRules(prev => [...prev, rule]);
        if (toast) toast("Workflow saved successfully", "success");
      } else {
        if (toast) toast("Failed to save workflow", "error");
      }
    } catch {
      // Save locally
      if (setWorkflowRules) setWorkflowRules(prev => [...prev, rule]);
      if (_save) _save("vgc_workflow_rules", [...(workflowRules || []), rule]);
      if (toast) toast("Workflow saved locally", "success");
    }
  }, [nodes, edges, ruleName, currentUser, API, setWorkflowRules, workflowRules, _save, toast]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 200px)" }}>
      {/* Toolbar */}
      <div style={{
        padding: "10px 16px", borderBottom: "1px solid #1E2130",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 18 }}>🎨</span>
          <input
            value={ruleName} onChange={e => setRuleName(e.target.value)}
            style={{
              background: "#0A0C14", border: "1px solid #1E2130", borderRadius: 6,
              color: "#E8ECF4", fontSize: 13, fontWeight: 700, padding: "6px 10px",
              fontFamily: "'Space Grotesk', sans-serif", width: 260
            }}
          />
          <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>
            {nodes.length} nodes · {edges.length} connections
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {connecting && (
            <span style={{ fontSize: 10, color: "#F59E0B", padding: "6px 10px", background: "#F59E0B18", borderRadius: 6, border: "1px solid #F59E0B33" }}>
              🔗 Click target node to connect...
              <button onClick={() => setConnecting(null)} style={{ background: "none", border: "none", color: "#F59E0B", cursor: "pointer", marginLeft: 6 }}>✕</button>
            </span>
          )}
          <button onClick={saveWorkflow} style={{
            padding: "6px 16px", background: "linear-gradient(135deg, #10B981, #059669)",
            border: "none", borderRadius: 6, color: "#fff", cursor: "pointer",
            fontSize: 11, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif"
          }}>💾 Save Workflow</button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Node Palette */}
        <div style={{
          width: 180, borderRight: "1px solid #1E2130", padding: "12px 10px",
          display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, overflowY: "auto"
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
            Add Node
          </div>
          {NODE_TYPES.map(nt => (
            <button
              key={nt.type}
              onClick={() => addNode(nt.type)}
              style={{
                padding: "10px 10px", background: "#12141E", border: `1px solid ${nt.color}33`,
                borderLeft: `3px solid ${nt.color}`, borderRadius: 6, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 8, textAlign: "left", transition: "all 0.2s"
              }}
              onMouseEnter={e => { e.currentTarget.style.background = `${nt.color}12`; e.currentTarget.style.borderColor = `${nt.color}66`; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#12141E"; e.currentTarget.style.borderColor = `${nt.color}33`; }}
            >
              <span style={{ fontSize: 16 }}>{nt.icon}</span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>{nt.label}</div>
                <div style={{ fontSize: 8, color: "#5A6178", marginTop: 1 }}>{nt.desc}</div>
              </div>
            </button>
          ))}
          <div style={{ borderTop: "1px solid #1E2130", paddingTop: 8, marginTop: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>
              Connect
            </div>
            <button
              onClick={() => { if (selectedId) startConnect(selectedId); }}
              disabled={!selectedId}
              style={{
                width: "100%", padding: "8px", background: selectedId ? "#6366F118" : "#0F1117",
                border: `1px solid ${selectedId ? "#6366F133" : "#1E2130"}`,
                borderRadius: 6, color: selectedId ? "#818CF8" : "#3A3F55",
                cursor: selectedId ? "pointer" : "not-allowed", fontSize: 10, fontWeight: 600
              }}
            >🔗 Connect From Selected</button>
          </div>
        </div>

        {/* SVG Canvas */}
        <div style={{ flex: 1, overflow: "auto", background: "#08090E" }}>
          <svg
            ref={svgRef}
            width="100%" height="100%"
            viewBox="0 0 900 700"
            style={{ minWidth: 900, minHeight: 700 }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onClick={() => setSelectedId(null)}
          >
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#6366F1" />
              </marker>
              <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1E213022" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
            {edges.map((e, i) => <ConnectorLine key={i} from={e.from} to={e.to} nodes={nodes} />)}
            {nodes.map(n => (
              <NodeBox key={n.id} node={n} selected={selectedId === n.id} onSelect={setSelectedId} onDragStart={handleDragStart} />
            ))}
          </svg>
        </div>

        {/* Property Panel */}
        <div style={{
          width: 260, borderLeft: "1px solid #1E2130", flexShrink: 0, overflowY: "auto",
          background: "#0C0D12"
        }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #1E2130" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1, textTransform: "uppercase" }}>
              Properties
            </div>
          </div>
          <PropertyPanel node={selectedNode} onChange={updateNode} onDelete={deleteNode} />
        </div>
      </div>
    </div>
  );
}
