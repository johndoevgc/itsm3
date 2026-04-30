import React, { useState, useRef, useEffect, useCallback } from "react";
import { btnStyle, inputStyle } from "../constants/theme.js";

/* ═══════════════════════════════════════════════════════════════
   Floating AI Chat Widget — persistent chat bubble across all views
   Compact, draggable, streaming responses, context-aware
   ═══════════════════════════════════════════════════════════════ */

const WIDGET_W = 360;
const WIDGET_H = 480;

export default function AIChatWidget({ currentUser, incidents, kbArticles }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([
    { role: "ai", text: "Hi! I'm your AI assistant. Ask me anything about IT support, search the knowledge base, or get help with an issue." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [unread, setUnread] = useState(0);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && endRef.current) endRef.current.scrollIntoView({ behavior: "smooth" });
  }, [msgs, open]);

  useEffect(() => {
    if (open) { setUnread(0); inputRef.current?.focus(); }
  }, [open]);

  const sendMessage = useCallback(async () => {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    setMsgs(prev => [...prev, { role: "user", text: q }]);
    setLoading(true);

    // Build context summary
    const contextSummary = `User: ${currentUser?.name || "Agent"}. Open incidents: ${(incidents || []).filter(i => i.status !== "Closed" && i.status !== "Resolved").length}. KB articles: ${(kbArticles || []).length}.`;

    try {
      const resp = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: `You are VGC-ITSM AI Assistant. Be concise, helpful, and professional. Context: ${contextSummary}` },
            ...msgs.filter(m => m.role !== "ai" || msgs.indexOf(m) > msgs.length - 6).map(m => ({
              role: m.role === "ai" ? "assistant" : "user",
              content: m.text
            })),
            { role: "user", content: q }
          ]
        })
      });
      const data = await resp.json();
      const aiText = data.choices?.[0]?.message?.content || data.reply || data.answer || "I couldn't generate a response. Please try again.";
      setMsgs(prev => [...prev, { role: "ai", text: aiText }]);
      if (!open) setUnread(prev => prev + 1);
    } catch {
      setMsgs(prev => [...prev, { role: "ai", text: "⚠️ Connection issue. Please try again." }]);
    }
    setLoading(false);
  }, [input, loading, msgs, currentUser, incidents, kbArticles, open]);

  // Quick actions
  const quickActions = [
    { label: "📊 Status Summary", q: "Give me a quick summary of open incidents and their priorities" },
    { label: "🔍 Search KB", q: "What knowledge base articles do we have?" },
    { label: "⚡ Common Fixes", q: "What are the most common IT issues and their quick fixes?" },
  ];

  return (
    <>
      {/* Floating Bubble */}
      {!open && (
        <button onClick={() => setOpen(true)} style={{
          position: "fixed", bottom: 24, right: 24, width: 56, height: 56, borderRadius: "50%",
          background: "linear-gradient(135deg, #6366F1, #8B5CF6)", border: "none", cursor: "pointer",
          boxShadow: "0 4px 20px rgba(99,102,241,0.4)", zIndex: 9998,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24,
          transition: "transform 0.2s, box-shadow 0.2s",
          animation: "chatBubblePulse 3s ease-in-out infinite"
        }}
          onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.1)"; e.currentTarget.style.boxShadow = "0 6px 28px rgba(99,102,241,0.5)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(99,102,241,0.4)"; }}
        >
          🤖
          {unread > 0 && (
            <span style={{ position: "absolute", top: -2, right: -2, width: 20, height: 20, borderRadius: "50%", background: "#FF4444", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{unread}</span>
          )}
        </button>
      )}

      {/* Chat Panel */}
      {open && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, width: WIDGET_W, height: minimized ? 48 : WIDGET_H,
          background: "#0A0C14", borderRadius: 14, border: "1px solid #6366F133",
          boxShadow: "0 12px 48px rgba(0,0,0,0.6)", zIndex: 9999,
          display: "flex", flexDirection: "column", overflow: "hidden",
          transition: "height 0.25s ease"
        }}>
          {/* Header */}
          <div style={{
            padding: "10px 14px", background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
            display: "flex", alignItems: "center", gap: 10, cursor: "pointer", flexShrink: 0
          }} onClick={() => setMinimized(!minimized)}>
            <span style={{ fontSize: 18 }}>🤖</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: "'Space Grotesk', sans-serif" }}>AI Assistant</div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.7)" }}>{loading ? "Thinking..." : "Online · Ask me anything"}</div>
            </div>
            <button onClick={e => { e.stopPropagation(); setMinimized(!minimized); }} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 4, width: 24, height: 24, color: "#fff", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {minimized ? "▲" : "▼"}
            </button>
            <button onClick={e => { e.stopPropagation(); setOpen(false); }} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 4, width: 24, height: 24, color: "#fff", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>

          {!minimized && (
            <>
              {/* Messages */}
              <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                {msgs.map((m, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                    <div style={{
                      maxWidth: "85%", padding: "10px 14px", borderRadius: 12,
                      background: m.role === "user" ? "linear-gradient(135deg, #6366F1, #8B5CF6)" : "#1E2130",
                      color: m.role === "user" ? "#fff" : "#C4CAD6",
                      fontSize: 12, lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif",
                      borderBottomRightRadius: m.role === "user" ? 4 : 12,
                      borderBottomLeftRadius: m.role === "ai" ? 4 : 12,
                      whiteSpace: "pre-wrap", wordBreak: "break-word"
                    }}>
                      {m.text}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div style={{ display: "flex", justifyContent: "flex-start" }}>
                    <div style={{ padding: "10px 14px", borderRadius: 12, background: "#1E2130", borderBottomLeftRadius: 4 }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        {[0, 1, 2].map(i => (
                          <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#6366F1", animation: `chatDotBounce 1.2s ${i * 0.15}s ease-in-out infinite` }} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div ref={endRef} />
              </div>

              {/* Quick Actions (shown when few messages) */}
              {msgs.length <= 2 && !loading && (
                <div style={{ padding: "0 14px 8px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {quickActions.map((qa, i) => (
                    <button key={i} onClick={() => { setInput(qa.q); setTimeout(() => { setInput(qa.q); sendMessage(); }, 50); }} style={{ fontSize: 10, padding: "5px 10px", borderRadius: 16, background: "#1E2130", border: "1px solid #6366F122", color: "#818CF8", cursor: "pointer", transition: "all 0.15s", fontFamily: "'Space Grotesk', sans-serif" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "#6366F118"; e.currentTarget.style.borderColor = "#6366F144"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "#1E2130"; e.currentTarget.style.borderColor = "#6366F122"; }}>
                      {qa.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Input */}
              <div style={{ padding: "8px 14px 12px", borderTop: "1px solid #1E2130", display: "flex", gap: 8 }}>
                <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder="Type a message..."
                  style={{ ...inputStyle, flex: 1, fontSize: 12, height: 36, borderRadius: 18, paddingLeft: 14, paddingRight: 14, background: "#0F1117", border: "1px solid #1E2130" }}
                />
                <button onClick={sendMessage} disabled={loading || !input.trim()} style={{
                  width: 36, height: 36, borderRadius: "50%", border: "none", cursor: "pointer",
                  background: input.trim() ? "linear-gradient(135deg, #6366F1, #8B5CF6)" : "#1E2130",
                  color: "#fff", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center",
                  opacity: loading || !input.trim() ? 0.5 : 1, transition: "all 0.2s"
                }}>➤</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Keyframe animations */}
      <style>{`
        @keyframes chatBubblePulse { 0%, 100% { box-shadow: 0 4px 20px rgba(99,102,241,0.4); } 50% { box-shadow: 0 4px 28px rgba(99,102,241,0.6); } }
        @keyframes chatDotBounce { 0%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-6px); } }
      `}</style>
    </>
  );
}
