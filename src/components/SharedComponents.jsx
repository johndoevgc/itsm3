import React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { PRIORITY_COLORS, inputStyle } from "../constants/theme.js";

export const Badge = ({ children, color }) => {
  const c = color || { bg: "#1A1A2E", text: "#A0AEC0" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "3px 10px",
      borderRadius: "4px", fontSize: "11px", fontWeight: 600,
      fontFamily: "'JetBrains Mono', monospace",
      background: c.bg, color: c.text, letterSpacing: "0.3px",
      border: `1px solid ${c.text}22`, whiteSpace: "nowrap"
    }}>{children}</span>
  );
};

export const PriorityDot = ({ priority }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px",
    fontWeight: 600, color: PRIORITY_COLORS[priority]?.text || "#A0AEC0",
    fontFamily: "'JetBrains Mono', monospace"
  }}>
    <span style={{
      width: 8, height: 8, borderRadius: "50%",
      background: PRIORITY_COLORS[priority]?.dot || "#666",
      boxShadow: `0 0 6px ${PRIORITY_COLORS[priority]?.dot || "#666"}55`,
      animation: priority === "Sev-A" ? "pulse 1.5s infinite" : "none"
    }} />
    {priority}{PRIORITY_COLORS[priority]?.label ? ` (${PRIORITY_COLORS[priority].label})` : ""}
  </span>
);


export const StatCard = ({ label, value, trend, icon, accent, onClick }) => (
  <div onClick={onClick} style={{
    background: "linear-gradient(135deg, #0C0D12, #141419)", borderRadius: "10px", padding: "18px 20px",
    border: "1px solid #27272A", position: "relative", overflow: "hidden",
    flex: 1, minWidth: 160, cursor: onClick ? "pointer" : "default",
    transition: "transform 0.2s, border-color 0.2s, box-shadow 0.2s",
  }}
    onMouseEnter={e => { if (onClick) { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.borderColor = (accent || "#64B5F6") + "66"; e.currentTarget.style.boxShadow = `0 8px 24px ${(accent || "#64B5F6")}15`; } }}
    onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = "#27272A"; e.currentTarget.style.boxShadow = "none"; }}>
    <div style={{
      position: "absolute", top: 0, left: 0, right: 0, height: "3px",
      background: `linear-gradient(90deg, ${accent || "#64B5F6"}, ${accent || "#64B5F6"}88)`
    }} />
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <div>
        <div style={{ fontSize: "11px", color: "#A1A1AA", fontWeight: 500, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>{label}</div>
        <div style={{ fontSize: "28px", fontWeight: 700, color: "#FAFAFA", fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "-0.02em" }}>{value}</div>
      </div>
      <span style={{ fontSize: "22px", opacity: 0.5 }}>{icon}</span>
    </div>
    {trend && <div style={{ fontSize: "11px", color: trend > 0 ? "#FF6B6B" : "#81C784", marginTop: 6, fontFamily: "'JetBrains Mono', monospace" }}>
      {trend > 0 ? "▲" : "▼"} {Math.abs(trend)}% vs last week
    </div>}
  </div>
);


export const DataTable = React.memo(function DataTable({ columns, data, onRowClick, initialLimit = 200, virtualizeThreshold = 300, rowHeight = 40, viewportHeight = 600 }) {
  // Phase T (Phase 9) — true windowing for large lists.
  // Behaviour:
  //   data.length ≤ virtualizeThreshold  → original table layout (zero risk)
  //   data.length >  virtualizeThreshold → CSS-grid + react-virtual (renders ~20-30 rows max)
  const total = (data || []).length;
  const useVirtual = total > virtualizeThreshold;

  // ─── Hooks must be called unconditionally (before any early return) ──
  const [limit, setLimit] = React.useState(initialLimit);
  React.useEffect(() => { setLimit(initialLimit); }, [data, initialLimit]);

  // ─── Virtualized renderer (large lists) ────────────────────────────
  const parentRef = React.useRef(null);
  const rowVirtualizer = useVirtualizer({
    count: useVirtual ? total : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  if (useVirtual) {
    const gridTemplate = columns.map(c => c.width || c.minWidth || "minmax(120px, 1fr)").join(" ");
    const virtualItems = rowVirtualizer.getVirtualItems();
    const cellBaseStyle = {
      padding: "10px 14px", color: "#D4D4D8",
      borderBottom: "1px solid #27272A22",
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      display: "flex", alignItems: "center",
    };
    return (
      <div style={{ borderRadius: "10px", border: "1px solid #27272A", overflow: "hidden" }}>
        {/* Header row (sticky) */}
        <div style={{
          display: "grid", gridTemplateColumns: gridTemplate,
          background: "#09090B", borderBottom: "1px solid #27272A",
        }}>
          {columns.map((col, i) => (
            <div key={i} style={{
              padding: "10px 14px", color: "#A1A1AA",
              fontWeight: 500, fontSize: "10px", textTransform: "uppercase",
              letterSpacing: "1px", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis",
            }}>{col.label}</div>
          ))}
        </div>
        {/* Scrollable virtualized body */}
        <div ref={parentRef} style={{ maxHeight: viewportHeight, overflow: "auto", contain: "strict" }}>
          <div style={{ height: rowVirtualizer.getTotalSize(), width: "100%", position: "relative" }}>
            {virtualItems.map(vi => {
              const row = data[vi.index];
              if (!row) return null;
              const i = vi.index;
              return (
                <div key={row.id || row.Id || i}
                  onClick={() => onRowClick?.(row)}
                  style={{
                    position: "absolute", top: 0, left: 0, width: "100%",
                    transform: `translateY(${vi.start}px)`,
                    height: rowHeight,
                    display: "grid", gridTemplateColumns: gridTemplate,
                    background: i % 2 === 0 ? "#0C0D12" : "#09090B",
                    cursor: onRowClick ? "pointer" : "default",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => { if (onRowClick) e.currentTarget.style.background = "#1C1C22"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 0 ? "#0C0D12" : "#09090B"; }}
                >
                  {columns.map((col, j) => (
                    <div key={j} style={{
                      ...cellBaseStyle,
                      fontFamily: col.mono ? "'JetBrains Mono', monospace" : "inherit",
                      fontSize: col.mono ? "12px" : "13px",
                    }} title={!col.render ? String(row[col.key] ?? "") : undefined}>
                      {col.render ? col.render(row) : row[col.key]}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ padding: "6px 12px", background: "#09090B", borderTop: "1px solid #27272A", fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textAlign: "right" }}>
          {total.toLocaleString()} rows · virtualized
        </div>
      </div>
    );
  }

  // ─── Original table renderer (small lists, unchanged behaviour) ────
  const rows = total > limit ? data.slice(0, limit) : data;
  return (
  <div style={{ overflowX: "auto", borderRadius: "10px", border: "1px solid #27272A" }}>
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", tableLayout: "auto" }}>
      <thead>
        <tr style={{ background: "#09090B" }}>
          {columns.map((col, i) => (
            <th key={i} style={{
              padding: "10px 14px", textAlign: "left", color: "#A1A1AA",
              fontWeight: 500, fontSize: "10px", textTransform: "uppercase",
              letterSpacing: "1px", borderBottom: "1px solid #27272A",
              fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap",
              width: col.width || "auto", minWidth: col.minWidth || "auto",
              maxWidth: col.maxWidth || "none",
            }}>{col.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.id || row.Id || i}
            onClick={() => onRowClick?.(row)}
            style={{
              background: i % 2 === 0 ? "#0C0D12" : "#09090B",
              cursor: onRowClick ? "pointer" : "default",
              transition: "background 0.15s"
            }}
            onMouseEnter={e => { if (onRowClick) e.currentTarget.style.background = "#1C1C22" }}
            onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "#0C0D12" : "#09090B"}
          >
            {columns.map((col, j) => (
              <td key={j} style={{
                padding: "10px 14px", color: "#D4D4D8",
                borderBottom: "1px solid #27272A22",
                whiteSpace: col.wrap ? "normal" : "nowrap",
                fontFamily: col.mono ? "'JetBrains Mono', monospace" : "inherit",
                fontSize: col.mono ? "12px" : "13px",
                width: col.width || "auto", minWidth: col.minWidth || "auto",
                maxWidth: col.maxWidth || "none",
                overflow: col.maxWidth ? "hidden" : "visible",
                textOverflow: col.maxWidth ? "ellipsis" : "clip",
              }} title={col.maxWidth && !col.render ? (row[col.key] || "") : undefined}>
                {col.render ? col.render(row) : row[col.key]}
              </td>
            ))}
          </tr>
        ))}
        {total === 0 && (
          <tr><td colSpan={columns.length} style={{ padding: 40, textAlign: "center", color: "#A1A1AA" }}>No records found</td></tr>
        )}
      </tbody>
    </table>
    {total > limit && (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: "12px 16px", background: "#09090B", borderTop: "1px solid #27272A" }}>
        <span style={{ color: "#5A6178", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
          Showing {limit} of {total} rows
        </span>
        <button onClick={() => setLimit(l => l + 200)} style={{ padding: "5px 14px", borderRadius: 6, border: "1px solid #27272A", background: "#1C1C22", color: "#C4CAD6", fontSize: 11, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif" }}>+ Show 200 more</button>
        <button onClick={() => setLimit(total)} style={{ padding: "5px 14px", borderRadius: 6, border: "1px solid #27272A", background: "transparent", color: "#5A6178", fontSize: 11, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif" }}>Show all</button>
      </div>
    )}
  </div>
  );
});

// ─── Workflow Header Component ──────────────────────────────────────────

export const WORKFLOW_STEPS = {
  incidents: [
    { icon: "📥", title: "Ingest", desc: "Receive & log", color: "#6366F1" },
    { icon: "🤖", title: "AI Triage", desc: "Auto-classify", color: "#7C3AED" },
    { icon: "📋", title: "Assign", desc: "Route to team", color: "#06B6D4" },
    { icon: "🔧", title: "Resolve", desc: "Fix & verify", color: "#81C784" },
    { icon: "📊", title: "Close & Learn", desc: "KB & metrics", color: "#FFB347" },
  ],
  problems: [
    { icon: "🔍", title: "Detect", desc: "Identify trend", color: "#CE93D8" },
    { icon: "📊", title: "Analyze", desc: "Impact assess", color: "#6366F1" },
    { icon: "🔬", title: "Root Cause", desc: "Deep analysis", color: "#FF6B6B" },
    { icon: "🛠️", title: "Fix", desc: "Implement fix", color: "#81C784" },
    { icon: "✅", title: "Verify", desc: "Confirm resolved", color: "#06B6D4" },
  ],
  changes: [
    { icon: "📝", title: "Request", desc: "Submit RFC", color: "#FFB347" },
    { icon: "🔍", title: "Review", desc: "CAB review", color: "#6366F1" },
    { icon: "✅", title: "Approve", desc: "Authorization", color: "#81C784" },
    { icon: "🚀", title: "Deploy", desc: "Implement", color: "#06B6D4" },
    { icon: "📋", title: "PIR", desc: "Post review", color: "#CE93D8" },
  ],
  requests: [
    { icon: "📥", title: "Submit", desc: "User request", color: "#6366F1" },
    { icon: "📋", title: "Catalog", desc: "Match service", color: "#FFB347" },
    { icon: "👤", title: "Fulfill", desc: "Process", color: "#06B6D4" },
    { icon: "✅", title: "Deliver", desc: "Complete", color: "#81C784" },
    { icon: "⭐", title: "Survey", desc: "Feedback", color: "#CE93D8" },
  ],
  knowledge: [
    { icon: "📚", title: "Create", desc: "Author article", color: "#0078D4" },
    { icon: "🤖", title: "AI Enrich", desc: "Auto-enhance", color: "#7C3AED" },
    { icon: "📝", title: "Review", desc: "Peer review", color: "#FFB347" },
    { icon: "✅", title: "Publish", desc: "Go live", color: "#81C784" },
    { icon: "📈", title: "Track", desc: "Views & rating", color: "#06B6D4" },
  ],
};


export const WorkflowHeader = ({ module, version, stepCounts }) => {
  const steps = WORKFLOW_STEPS[module] || WORKFLOW_STEPS.incidents;
  // Compute active step from real data: the step with the most items (excluding last/completed step)
  const activeStep = stepCounts && stepCounts.length > 0
    ? stepCounts.slice(0, -1).reduce((maxIdx, v, i, arr) => v > arr[maxIdx] ? i : maxIdx, 0)
    : 0;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 0, marginBottom: 16, padding: "10px 16px",
      background: "linear-gradient(135deg, #0A0C14 0%, #0F1117 50%, #0A0C14 100%)",
      borderRadius: 10, border: "1px solid #1E213044", overflow: "hidden", position: "relative",
    }}>
      {steps.map((step, i) => (
        <React.Fragment key={i}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 8,
            background: i === activeStep ? `${step.color}15` : "transparent",
            border: i === activeStep ? `1px solid ${step.color}33` : "1px solid transparent",
            transition: "background 0.5s ease, border-color 0.5s ease", flex: 1, minWidth: 0, cursor: "default",
          }}>
            <span style={{
              fontSize: 16, display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 28, height: 28, borderRadius: 8,
              background: i === activeStep ? `${step.color}22` : "#1E213022",
              boxShadow: i === activeStep ? `0 0 12px ${step.color}33` : "none",
              transition: "background 0.5s ease, box-shadow 0.5s ease",
              animation: i === activeStep ? "wfIconPulse 2s ease-in-out infinite" : "none",
            }}>{step.icon}</span>
            <div style={{ overflow: "hidden" }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: i === activeStep ? step.color : "#5A6178",
                fontFamily: "'Space Grotesk', sans-serif", transition: "color 0.5s",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>{step.title}</div>
              <div style={{
                fontSize: 8, color: i === activeStep ? "#A0A8B8" : "#5A617855",
                transition: "color 0.5s", whiteSpace: "nowrap",
              }}>{stepCounts && stepCounts[i] > 0 ? `${stepCounts[i]} items` : step.desc}</div>
            </div>
          </div>
          {i < steps.length - 1 && (
            <div style={{
              width: 20, height: 2, flexShrink: 0,
              background: i < activeStep ? `linear-gradient(90deg, ${steps[i].color}, ${steps[i+1].color})` : "#1E213044",
              borderRadius: 1, transition: "background 0.5s",
            }} />
          )}
        </React.Fragment>
      ))}
      {version && (
        <div style={{
          position: "absolute", right: 12, top: 6, fontSize: 8, color: "#5A617866",
          fontFamily: "'JetBrains Mono', monospace", background: "#0A0C14", padding: "1px 6px",
          borderRadius: 4, border: "1px solid #1E213033",
        }}>v{version}</div>
      )}
    </div>
  );
};


export const Modal = ({ title, onClose, children, wide }) => (
  <div style={{
    position: "fixed", inset: 0, background: "#000000AA", zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center",
    backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", padding: 20,
  }} onClick={onClose}>
    <div style={{
      background: "#141419", borderRadius: "16px", border: "1px solid #27272A",
      width: wide ? 700 : 520, maxWidth: "95vw", maxHeight: "85vh",
      overflow: "auto", boxShadow: "0 24px 64px #000000AA, 0 0 0 1px #27272A",
      position: "relative"
    }} onClick={e => e.stopPropagation()}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, #818CF8, #22D3EE)", borderRadius: "16px 16px 0 0" }} />
      <div style={{
        padding: "18px 24px", borderBottom: "1px solid #27272A",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        position: "sticky", top: 0, background: "#141419", zIndex: 1
      }}>
        <h3 style={{ margin: 0, color: "#FAFAFA", fontSize: 16, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "-0.02em" }}>{title}</h3>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: "#71717A", cursor: "pointer",
          fontSize: 20, lineHeight: 1, padding: "4px 8px", transition: "color 0.15s"
        }} onMouseEnter={e => e.currentTarget.style.color = "#FAFAFA"} onMouseLeave={e => e.currentTarget.style.color = "#71717A"}>✕</button>
      </div>
      <div style={{ padding: "20px 24px" }}>{children}</div>
    </div>
  </div>
);


export const FormField = ({ label, children }) => (
  <div style={{ marginBottom: 16 }}>
    <label style={{
      display: "block", fontSize: "11px", fontWeight: 600,
      color: "#5A6178", marginBottom: 6, textTransform: "uppercase",
      letterSpacing: "0.8px", fontFamily: "'JetBrains Mono', monospace"
    }}>{label}</label>
    {children}
  </div>
);


// Phase S1f — Stable component identity helper.
// Inline-defined components inside ITSMApp get a NEW function reference each
// render. React diffs type !== prevType and UNMOUNTS the entire subtree —
// destroying child state, focus, scroll, and modals. With ~8 background
// timers (SLA tick, polls, AI monitor, websocket events) firing every
// 30–120 s, this happens constantly. Wrap each module render fn with this
// helper. The returned component has a stable identity (memoised once) but
// always invokes the LATEST closure (via a ref). Hook order inside the body
// must remain stable across renders — that's already how every module is
// written.
export function useStableComponent(renderFn) {
  const ref = React.useRef(renderFn);
  ref.current = renderFn;
  return React.useMemo(
    () => function StableComponent(props) { return ref.current(props); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
}

const __searchBarCache = new Map(); // key -> { value, focused, selStart, selEnd }
export const SearchBar = React.memo(function SearchBar({ value, onChange, placeholder }) {
  const cacheKey = placeholder || "__default__";
  const inputRef = React.useRef(null);
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // Read cached value (survives remount), but parent's controlled `value` wins
  // when it differs from the cache (e.g. route change clears search).
  const [local, setLocal] = React.useState(() => {
    const cached = __searchBarCache.get(cacheKey);
    if (cached && cached.value === (value || "")) return cached.value;
    if (cached && cached.value && (value || "") === "") return cached.value;
    return value || "";
  });

  // External clear / programmatic change → sync down.
  // CRITICAL: never override local state while the user is actively typing
  // (focused). Parent commits run in React.startTransition and may briefly
  // lag the local value — without this guard the user's keystrokes get
  // wiped out by the stale parent value, making the input feel unresponsive.
  React.useEffect(() => {
    const cached = __searchBarCache.get(cacheKey);
    if (cached?.focused) return;
    const cachedVal = cached?.value;
    if ((value || "") !== local && (value || "") !== cachedVal) {
      setLocal(value || "");
    }
  }, [value, cacheKey, local]);

  // After mount, restore focus + caret if this input was focused before unmount.
  React.useEffect(() => {
    const cached = __searchBarCache.get(cacheKey);
    if (cached?.focused && inputRef.current) {
      inputRef.current.focus();
      try {
        const pos = cached.selStart ?? cached.value.length;
        inputRef.current.setSelectionRange(pos, cached.selEnd ?? pos);
      } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (e) => {
    const next = e.target.value;
    setLocal(next);
    __searchBarCache.set(cacheKey, {
      value: next,
      focused: true,
      selStart: e.target.selectionStart,
      selEnd: e.target.selectionEnd,
    });
    // Commit parent in a transition so polling-driven parent re-renders never
    // race the user's keystroke commit. Falls back to direct call if the API
    // is unavailable.
    const fn = onChangeRef.current;
    if (!fn) return;
    if (React.startTransition) {
      React.startTransition(() => { try { fn(next); } catch { /* ignore */ } });
    } else {
      try { fn(next); } catch { /* ignore */ }
    }
  };

  const handleFocus = () => {
    const cached = __searchBarCache.get(cacheKey) || { value: local };
    __searchBarCache.set(cacheKey, { ...cached, focused: true });
  };
  const handleBlur = (e) => {
    const cached = __searchBarCache.get(cacheKey) || { value: local };
    __searchBarCache.set(cacheKey, {
      ...cached,
      focused: false,
      selStart: e.target.selectionStart,
      selEnd: e.target.selectionEnd,
    });
  };

  return (
    <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
      <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#5A6178", fontSize: 14 }}>⌕</span>
      <input
        ref={inputRef}
        value={local}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder || "Search..."}
        style={{ ...inputStyle, paddingLeft: 32 }}
      />
    </div>
  );
});

export class TabErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error(`[${this.props.label || "Tab"}] crash:`, error, info);
    try {
      fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tab: this.props.label, error: error.message, stack: error.stack }),
      });
    } catch (e) { /* ignore */ }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, textAlign: "center", color: "#A0AEC0" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠</div>
          <h3 style={{ color: "#E2E8F0", marginBottom: 8 }}>{this.props.label || "Tab"} encountered an error</h3>
          <p style={{ color: "#718096", fontSize: 13, marginBottom: 16 }}>{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })} style={{ padding: "8px 16px", background: "#2D3748", color: "#E2E8F0", border: "1px solid #4A5568", borderRadius: 4, cursor: "pointer" }}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
