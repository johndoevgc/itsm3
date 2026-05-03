import { useState, useEffect, useCallback } from "react";

// KbReviewTab — engineer review queue for ai_knowledge entries auto-seeded by
// the VGC AI Assist CSAT loop (rating ≥ 4 + AI-generated resolving turn).
// Endpoints:
//   GET  /api/ai/knowledge/pending
//   POST /api/ai/knowledge/:id/review { action: "approve"|"reject", reviewer, notes?, edits? }

const card = {
  background: "#0F1117",
  border: "1px solid #1E2130",
  borderRadius: 8,
  padding: 16,
  marginBottom: 10,
};

export function KbReviewTab({ currentUser, showToast }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState({}); // id -> { title, content, category, tags }
  const [busy, setBusy] = useState({});       // id -> bool

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/ai/knowledge/pending");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setEntries(d.entries || []);
    } catch (e) {
      showToast?.(`Load failed: ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { reload(); }, [reload]);

  const startEdit = (entry) => {
    setEditing(prev => ({
      ...prev,
      [entry.id]: {
        title: entry.title || "",
        content: entry.content || "",
        category: entry.category || "General",
        tags: (entry.tags || []).join(", "),
        screenshotUrl: entry.screenshotUrl || "",
        videoUrl: entry.videoUrl || "",
      },
    }));
  };

  const cancelEdit = (id) => {
    setEditing(prev => { const n = { ...prev }; delete n[id]; return n; });
  };

  const submitReview = async (entry, action) => {
    if (busy[entry.id]) return;
    setBusy(prev => ({ ...prev, [entry.id]: true }));
    try {
      const edits = editing[entry.id] ? {
        title: editing[entry.id].title,
        content: editing[entry.id].content,
        category: editing[entry.id].category,
        tags: editing[entry.id].tags.split(",").map(t => t.trim()).filter(Boolean),
        screenshotUrl: editing[entry.id].screenshotUrl || null,
        videoUrl: editing[entry.id].videoUrl || null,
      } : undefined;
      const reviewer = currentUser?.email || currentUser?.name || "Unknown";
      const r = await fetch(`/api/ai/knowledge/${encodeURIComponent(entry.id)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reviewer, edits }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      showToast?.(action === "approve" ? "✅ Approved & published" : "🗑️ Rejected", "success");
      cancelEdit(entry.id);
      await reload();
    } catch (e) {
      showToast?.(`${action} failed: ${e.message}`, "error");
    } finally {
      setBusy(prev => { const n = { ...prev }; delete n[entry.id]; return n; });
    }
  };

  const inputStyle = {
    width: "100%",
    background: "#0A0C14",
    border: "1px solid #1E2130",
    borderRadius: 6,
    color: "#E8ECF4",
    padding: "8px 10px",
    fontSize: 12,
    fontFamily: "inherit",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>
            📚 AI Knowledge Review Queue
          </h3>
          <div style={{ fontSize: 10, color: "#5A6178", marginTop: 2 }}>
            Entries auto-captured by the VGC AI Assist CSAT loop (rating ≥ 4 + AI-resolved). Approve to publish, reject to discard.
          </div>
        </div>
        <button
          onClick={reload}
          disabled={loading}
          style={{
            background: "transparent", border: "1px solid #1E2130", color: "#A8B0C4",
            borderRadius: 6, padding: "6px 14px", fontSize: 11, cursor: "pointer",
          }}
        >
          {loading ? "Loading…" : "🔄 Refresh"}
        </button>
      </div>

      {!loading && entries.length === 0 && (
        <div style={{ ...card, textAlign: "center", color: "#5A6178", fontSize: 12, padding: 32 }}>
          🎉 No pending entries. The AI Assist learning loop has nothing waiting for review.
        </div>
      )}

      {entries.map(entry => {
        const ed = editing[entry.id];
        const isBusy = !!busy[entry.id];
        return (
          <div key={entry.id} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", marginBottom: 4 }}>
                  {ed ? (
                    <input style={{ ...inputStyle, fontSize: 13, fontWeight: 700 }}
                      value={ed.title}
                      onChange={e => setEditing(p => ({ ...p, [entry.id]: { ...p[entry.id], title: e.target.value } }))} />
                  ) : (
                    entry.title || "(untitled)"
                  )}
                </div>
                <div style={{ fontSize: 10, color: "#5A6178", display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <span>📂 {entry.category || "General"}</span>
                  {entry.sourceTicketId && <span>🎫 {entry.sourceTicketId}</span>}
                  {entry.createdAt && <span>📅 {new Date(entry.createdAt).toLocaleString()}</span>}
                  {(entry.tags || []).map(t => (
                    <span key={t} style={{ background: "#1E2130", padding: "1px 6px", borderRadius: 999 }}>#{t}</span>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {!ed && (
                  <button
                    onClick={() => startEdit(entry)}
                    disabled={isBusy}
                    style={{ background: "transparent", border: "1px solid #2A2F44", color: "#A8B0C4",
                      borderRadius: 6, padding: "5px 10px", fontSize: 10, cursor: "pointer" }}
                  >✏️ Edit</button>
                )}
              </div>
            </div>

            {ed ? (
              <>
                <textarea
                  style={{ ...inputStyle, minHeight: 100, resize: "vertical", whiteSpace: "pre-wrap" }}
                  value={ed.content}
                  onChange={e => setEditing(p => ({ ...p, [entry.id]: { ...p[entry.id], content: e.target.value } }))}
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8, marginTop: 8 }}>
                  <input style={{ ...inputStyle, fontSize: 11 }} placeholder="Category"
                    value={ed.category}
                    onChange={e => setEditing(p => ({ ...p, [entry.id]: { ...p[entry.id], category: e.target.value } }))} />
                  <input style={{ ...inputStyle, fontSize: 11 }} placeholder="tags, comma, separated"
                    value={ed.tags}
                    onChange={e => setEditing(p => ({ ...p, [entry.id]: { ...p[entry.id], tags: e.target.value } }))} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                  <input style={{ ...inputStyle, fontSize: 11 }} placeholder="Screenshot URL (https://…)"
                    value={ed.screenshotUrl}
                    onChange={e => setEditing(p => ({ ...p, [entry.id]: { ...p[entry.id], screenshotUrl: e.target.value } }))} />
                  <input style={{ ...inputStyle, fontSize: 11 }} placeholder="Video URL (https://…)"
                    value={ed.videoUrl}
                    onChange={e => setEditing(p => ({ ...p, [entry.id]: { ...p[entry.id], videoUrl: e.target.value } }))} />
                </div>
              </>
            ) : (
              <div style={{
                background: "#0A0C14",
                border: "1px solid #1E2130",
                borderRadius: 6,
                padding: 10,
                fontSize: 12,
                color: "#A8B0C4",
                whiteSpace: "pre-wrap",
                maxHeight: 220,
                overflow: "auto",
              }}>{entry.content || "(empty)"}</div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              {ed && (
                <button
                  onClick={() => cancelEdit(entry.id)}
                  disabled={isBusy}
                  style={{ background: "transparent", border: "1px solid #2A2F44", color: "#A8B0C4",
                    borderRadius: 6, padding: "6px 14px", fontSize: 11, cursor: "pointer" }}
                >Cancel edits</button>
              )}
              <button
                onClick={() => submitReview(entry, "reject")}
                disabled={isBusy}
                style={{ background: "transparent", border: "1px solid #DC2626", color: "#FCA5A5",
                  borderRadius: 6, padding: "6px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
              >🗑️ Reject</button>
              <button
                onClick={() => submitReview(entry, "approve")}
                disabled={isBusy}
                style={{ background: "#22C55E", border: "none", color: "#fff",
                  borderRadius: 6, padding: "6px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
              >✅ Approve {ed ? "with edits" : "as-is"}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default KbReviewTab;
