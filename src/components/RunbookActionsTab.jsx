import { useCallback, useEffect, useState } from "react";
import { COLORS } from "../constants/theme.js";

// RunbookActionsTab — Phase 4.1 admin panel for the self-healing runbook
// registry shipped in v3.34.0.
//
// Backend endpoints used:
//   GET  /api/runbook/actions                 (list registry + per-action flag)
//   POST /api/runbook/action/execute          (admin-only; flag-gated)
//   GET  /api/runbook/action/executions       (admin-only; recent runs)
//
// Safety stance:
//   * Real exec() is stubbed in v3.34.0 — every Run goes through the action's
//     shadow() simulation unless the per-action flag payload sets
//     shadowOnly:false (which itself requires v3.34.1+ security sign-off).
//   * Operator must explicitly select "Run shadow" — there is no "Run real"
//     button until exec() implementations land.
//   * Daily-cap and idempotency are enforced server-side; we just surface the
//     resulting status code.

const card = {
  background: "#0F1117",
  border: "1px solid #1E2130",
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
};

const sectionTitle = {
  margin: 0,
  fontSize: 13,
  color: "#E8ECF4",
  fontFamily: "'Space Grotesk', sans-serif",
  fontWeight: 600,
};

const subText = {
  fontSize: 10,
  color: "#5A6178",
  marginTop: 2,
  fontFamily: "'JetBrains Mono', monospace",
};

const codeBox = {
  background: "#0A0C14",
  border: "1px solid #1E2130",
  borderRadius: 4,
  padding: 10,
  fontSize: 11,
  fontFamily: "'JetBrains Mono', monospace",
  color: "#A8B0C4",
  whiteSpace: "pre-wrap",
  maxHeight: 320,
  overflow: "auto",
};

const inputStyle = {
  background: "#0A0C14",
  border: "1px solid #1E2130",
  borderRadius: 4,
  padding: "6px 8px",
  fontSize: 12,
  color: "#E8ECF4",
  fontFamily: "'JetBrains Mono', monospace",
};

const btn = (variant = "primary") => ({
  background: variant === "primary" ? COLORS.gold : "#1E2130",
  color: variant === "primary" ? "#0A0C14" : "#E8ECF4",
  border: "1px solid " + (variant === "primary" ? COLORS.gold : "#2A2F45"),
  borderRadius: 4,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "'Space Grotesk', sans-serif",
});

const tierColor = (t) => (t === 1 ? "#10B981" : t === 2 ? "#F59E0B" : "#EF4444");

export function RunbookActionsTab({ currentUser, showToast }) {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [executions, setExecutions] = useState([]);
  const [stats, setStats] = useState({ days: 7, actions: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [paramValues, setParamValues] = useState({});
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const isAdmin = ["Administrator", "VGC Dev Admin", "Tenant Admin"].includes(currentUser?.rbacRole);
  const statsById = (id) => stats.actions.find(s => s.actionId === id) || null;

  const loadActions = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/runbook/actions");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setActions(Array.isArray(d.actions) ? d.actions : []);
    } catch (e) {
      showToast?.(`Load actions failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadExecutions = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const r = await fetch("/api/runbook/action/executions");
      if (!r.ok) return;
      const d = await r.json();
      setExecutions(Array.isArray(d.data) ? d.data : []);
    } catch { /* non-fatal */ }
  }, [isAdmin]);

  const loadStats = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const r = await fetch("/api/runbook/action/stats?days=7");
      if (!r.ok) return;
      const d = await r.json();
      setStats({ days: d.days || 7, actions: Array.isArray(d.actions) ? d.actions : [] });
    } catch { /* non-fatal */ }
  }, [isAdmin]);

  useEffect(() => {
    loadActions();
    loadExecutions();
    loadStats();
  }, [loadActions, loadExecutions, loadStats]);

  const selected = actions.find(a => a.id === selectedId) || null;

  // Reset params whenever a different action is picked.
  useEffect(() => {
    if (!selected) { setParamValues({}); return; }
    const next = {};
    for (const [field, spec] of Object.entries(selected.inputSchema || {})) {
      next[field] = spec.type === "number" ? "" : "";
    }
    setParamValues(next);
    setLastResult(null);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const runAction = async () => {
    if (!isAdmin || !selected) return;
    if (!selected.flag?.enabled) {
      showToast?.(`Flag self_healing.${selected.id} is disabled — toggle it on in Feature Flags first.`);
      return;
    }
    // Server-side flag.payload.shadowOnly drives mode. The button label reflects what
    // WILL happen; for REAL runs we add a confirm() — there is no UI override.
    const willBeReal = selected.flag?.payload?.shadowOnly === false;
    if (willBeReal) {
      // eslint-disable-next-line no-alert
      const ok = typeof window !== "undefined" && window.confirm
        ? window.confirm(`⚠️ This will run ${selected.id} for REAL on the target system.\n\nProceed?`)
        : true;
      if (!ok) return;
    }
    setRunning(true);
    setLastResult(null);
    try {
      // Coerce numeric fields per schema before sending.
      const params = {};
      for (const [field, spec] of Object.entries(selected.inputSchema || {})) {
        const raw = paramValues[field];
        if (raw === "" || raw === undefined || raw === null) continue;
        params[field] = spec.type === "number" ? Number(raw) : raw;
      }
      const r = await fetch("/api/runbook/action/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: selected.id, params }),
      });
      const d = await r.json().catch(() => ({}));
      setLastResult({ status: r.status, body: d });
      if (r.ok) showToast?.(`Run completed (${d.mode}).`);
      else showToast?.(`Run failed: ${d.error || `HTTP ${r.status}`}`);
      await Promise.all([loadExecutions(), loadStats()]);
    } catch (e) {
      showToast?.(`Run error: ${e.message}`);
      setLastResult({ status: 0, body: { error: e.message } });
    } finally {
      setRunning(false);
    }
  };

  if (!isAdmin) {
    return (
      <div style={card}>
        <h3 style={sectionTitle}>Runbook Actions</h3>
        <p style={{ ...subText, marginTop: 8 }}>Admin role required.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={sectionTitle}>🛠️ Runbook Action Registry</h3>
            <p style={subText}>Phase 4.1 · shadow-only · per-action flag-gated · daily-capped · audited</p>
          </div>
          <button style={btn("ghost")} onClick={() => { loadActions(); loadExecutions(); loadStats(); }} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
          {actions.map(a => {
            const s = statsById(a.id);
            const totalRuns = s ? (s.shadowRuns + s.realRuns) : 0;
            return (
            <div
              key={a.id}
              onClick={() => setSelectedId(a.id)}
              style={{
                background: a.id === selectedId ? "#1A1F30" : "#161927",
                border: "1px solid " + (a.id === selectedId ? COLORS.gold : "#1E2130"),
                borderRadius: 6,
                padding: 12,
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#E8ECF4" }}>{a.name || a.id}</div>
                <div style={{
                  fontSize: 10, padding: "2px 6px", borderRadius: 3, fontWeight: 700,
                  background: tierColor(a.riskTier) + "20", color: tierColor(a.riskTier),
                }}>
                  TIER {a.riskTier}
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#A8B0C4", marginTop: 4 }}>{a.description}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", flexWrap: "wrap" }}>
                <span style={{ color: a.flag?.enabled ? "#10B981" : "#5A6178" }}>
                  {a.flag?.enabled ? "● flag ON" : "○ flag OFF"}
                </span>
                <span style={{ color: a.flag?.payload?.shadowOnly === false ? "#EF4444" : "#5A6178" }}>
                  {a.flag?.payload?.shadowOnly === false ? "REAL" : "shadow"}
                </span>
                <span style={{ color: "#5A6178" }}>cap={a.flag?.payload?.dailyCap ?? "—"}</span>
                {a.idempotent && <span style={{ color: "#5A6178" }}>idempotent</span>}
              </div>
              {/* v3.34.2 promotion-readiness pill */}
              <div style={{ marginTop: 6, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "#5A6178" }}>
                {s ? (
                  <>
                    <span style={{ color: s.errors === 0 ? "#10B981" : "#EF4444" }}>
                      {totalRuns}{"\u00A0"}runs / {s.errors}{"\u00A0"}err
                    </span>
                    {s.p95LatencyMs != null && <> · p95 {s.p95LatencyMs}ms</>}
                    {s.promotionReady && <span style={{ color: "#10B981", marginLeft: 6 }}>✓ ready to promote</span>}
                    {!s.promotionReady && totalRuns > 0 && (
                      <span style={{ marginLeft: 6 }}>· {Math.max(0, 20 - totalRuns)} more for promo</span>
                    )}
                  </>
                ) : <>no telemetry yet ({stats.days}d window)</>}
              </div>
            </div>
            );
          })}
          {actions.length === 0 && !loading && (
            <div style={{ ...subText, gridColumn: "span 2" }}>No actions registered.</div>
          )}
        </div>
      </div>

      {selected && (() => {
        const willBeReal = selected.flag?.payload?.shadowOnly === false;
        return (
        <div style={card}>
          <h3 style={sectionTitle}>
            {willBeReal ? "⚠️ Run REAL" : "Run shadow"} · {selected.name || selected.id}
          </h3>
          <p style={subText}>
            {willBeReal
              ? "Real privileged action — flag payload.shadowOnly is FALSE. A confirmation dialog will appear before submit."
              : "Simulation only. Flag payload.shadowOnly stays true until security sign-off promotes this action."}
          </p>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {Object.entries(selected.inputSchema || {}).map(([field, spec]) => (
              <label key={field} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, color: "#A8B0C4" }}>
                  {field}{spec.required ? " *" : ""}
                  <span style={{ color: "#5A6178", marginLeft: 6 }}>
                    ({spec.type}{spec.max ? `, ≤${spec.max}` : ""}{spec.enum ? `, enum:${spec.enum.join("|")}` : ""})
                  </span>
                </span>
                <input
                  type={spec.type === "number" ? "number" : "text"}
                  value={paramValues[field] ?? ""}
                  onChange={e => setParamValues(p => ({ ...p, [field]: e.target.value }))}
                  style={inputStyle}
                />
              </label>
            ))}
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
            <button
              style={{
                ...btn("primary"),
                ...(willBeReal ? { background: "#EF4444", borderColor: "#EF4444", color: "#fff" } : {}),
              }}
              onClick={runAction}
              disabled={running || !selected.flag?.enabled}
            >
              {running ? "Running…" : (willBeReal ? "⚠️ Run REAL" : "Run shadow")}
            </button>
            {!selected.flag?.enabled && (
              <span style={{ ...subText, color: "#F59E0B" }}>
                Enable flag <code>self_healing.{selected.id}</code> first.
              </span>
            )}
          </div>

          {lastResult && (
            <div style={{ ...codeBox, marginTop: 12 }}>
              {`HTTP ${lastResult.status}\n` + JSON.stringify(lastResult.body, null, 2)}
            </div>
          )}
        </div>
        );
      })()}

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={sectionTitle}>Recent executions ({executions.length})</h3>
          <button style={btn("ghost")} onClick={loadExecutions}>Refresh</button>
        </div>
        {executions.length === 0 ? (
          <p style={subText}>No runs recorded yet.</p>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
            {executions.slice(0, 25).map(e => (
              <div key={e.id} style={{
                background: "#161927", border: "1px solid #1E2130", borderRadius: 4,
                padding: 8, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                display: "grid", gridTemplateColumns: "auto 1fr auto auto auto", gap: 10, alignItems: "center",
              }}>
                <span style={{ color: e.ok ? "#10B981" : "#EF4444" }}>{e.ok ? "✓" : "✗"}</span>
                <span style={{ color: "#E8ECF4" }}>{e.actionId}</span>
                <span style={{
                  color: e.mode === "real" ? "#EF4444" : "#A8B0C4",
                  textTransform: "uppercase", fontSize: 10,
                }}>{e.mode}</span>
                <span style={{ color: "#5A6178" }}>{e.executedBy}</span>
                <span style={{ color: "#5A6178" }}>{(e.startedAt || "").slice(11, 19)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default RunbookActionsTab;
