import { useState, useCallback, useRef, useEffect } from "react";

// ChatAssistTab — agent-side AI co-pilot. Lets a service-desk engineer ask the
// assistant for triage suggestions, KB lookups, and customer-reply drafts. Each
// session is grounded in the KB and audited server-side. Optionally bound to a
// ticket so an "Insert into ticket" action is available.
//
// Props:
//   currentUser : { name, email, rbacRole }
//   showToast   : (msg, type?) => void
//   ticketId?   : string — if provided, enables "Insert into ticket"
//   compact?    : boolean — render in a tighter layout (for side panels)

const card = {
  background: "#0F1117",
  border: "1px solid #1E2130",
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
};

const inputStyle = {
  flex: 1,
  background: "#0A0C14",
  border: "1px solid #1E2130",
  borderRadius: 6,
  color: "#E8ECF4",
  padding: "10px 12px",
  fontSize: 12,
  fontFamily: "'JetBrains Mono', monospace",
  resize: "vertical",
  minHeight: 60,
};

const btnPrimary = {
  background: "#6366F1",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "10px 16px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const btnSecondary = {
  background: "transparent",
  color: "#A8B0C4",
  border: "1px solid #1E2130",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 11,
  cursor: "pointer",
};

function MessageBubble({ msg, ticketId, onInsert, onPromote }) {
  const isUser = msg.role === "user";
  return (
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 10,
    }}>
      <div style={{
        maxWidth: "82%",
        background: isUser ? "#1E2130" : "#0A0C14",
        border: `1px solid ${isUser ? "#2A2F44" : "#1E2130"}`,
        borderRadius: 8,
        padding: "10px 12px",
        fontSize: 12,
        color: "#E8ECF4",
        whiteSpace: "pre-wrap",
        fontFamily: isUser ? "'Space Grotesk', sans-serif" : "'JetBrains Mono', monospace",
      }}>
        <div>{msg.text}</div>
        {!isUser && msg.citations && msg.citations.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 10, color: "#5A6178" }}>
            Sources: {msg.citations.map(c => c.id).join(", ")}
          </div>
        )}
        {!isUser && typeof msg.confidence === "number" && (
          <div style={{
            marginTop: 6,
            fontSize: 10,
            color: msg.lowConfidence ? "#F59E0B" : "#34D399",
          }}>
            Confidence: {msg.confidence}%{msg.lowConfidence ? " — consider handoff" : ""}
          </div>
        )}
        {!isUser && (ticketId || onPromote) && (
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {ticketId && onInsert && (
              <button onClick={() => onInsert(msg.text)} style={btnSecondary}>
                ➕ Insert into ticket
              </button>
            )}
            {onPromote && (
              <button onClick={() => onPromote(msg)} style={btnSecondary} title="Send to AI KB review queue">
                📚 Promote to KB
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatAssistTab({ currentUser, showToast, ticketId, compact }) {
  const [session, setSession] = useState(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  const startSession = useCallback(async () => {
    try {
      const r = await fetch("/api/chat-assist/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "agent", ticketId: ticketId || null }),
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`HTTP ${r.status}: ${txt}`);
      }
      const d = await r.json();
      setSession(d.session);
      setError(null);
    } catch (e) {
      setError(e.message);
      showToast?.(`Chat Assist unavailable: ${e.message}`, "error");
    }
  }, [ticketId, showToast]);

  useEffect(() => { startSession(); }, [startSession]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [session?.messages?.length]);

  const sendMessage = async () => {
    if (!input.trim() || !session || sending) return;
    const text = input.trim();
    setSending(true);
    // Optimistic local append
    setSession(prev => ({
      ...prev,
      messages: [...(prev.messages || []), { id: `tmp_${Date.now()}`, role: "user", text, createdAt: new Date().toISOString() }],
    }));
    setInput("");
    try {
      const r = await fetch("/api/chat-assist/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, text }),
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`HTTP ${r.status}: ${txt}`);
      }
      const d = await r.json();
      setSession(prev => ({
        ...prev,
        messages: [...(prev.messages || []), d.message],
      }));
      if (d.suggestHandoff) showToast?.("Low confidence reply — consider escalating", "warning");
    } catch (e) {
      showToast?.(`Send failed: ${e.message}`, "error");
    } finally {
      setSending(false);
    }
  };

  const insertIntoTicket = async (text) => {
    if (!ticketId) return;
    try {
      const r = await fetch("/api/chat-assist/insert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, text, source: "agent-copilot" }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      showToast?.("Inserted into ticket activity log", "success");
    } catch (e) {
      showToast?.(`Insert failed: ${e.message}`, "error");
    }
  };

  const promoteToKb = async (msg) => {
    if (!session) return;
    const title = window.prompt("KB title (auto-defaults to first line):",
      String(msg.text || "").split(/\n/)[0].slice(0, 120));
    if (title === null) return;
    const category = window.prompt("Category:", "General") || "General";
    try {
      const r = await fetch("/api/chat-assist/promote-to-kb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          messageId: msg.id,
          title: title || "Agent-promoted resolution",
          category,
          tags: ["agent-promoted", "chat-assist"],
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`HTTP ${r.status}: ${txt.slice(0, 120)}`);
      }
      const d = await r.json();
      showToast?.(`Sent to KB review queue (${d.kbId})`, "success");
    } catch (e) {
      showToast?.(`Promote failed: ${e.message}`, "error");
    }
  };

  const requestHandoff = async () => {
    if (!session) return;
    try {
      const r = await fetch("/api/chat-assist/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, agentId: currentUser?.email || null }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setSession(d.session);
      showToast?.("Session handed off", "success");
    } catch (e) {
      showToast?.(`Handoff failed: ${e.message}`, "error");
    }
  };

  if (error && !session) {
    return (
      <div style={card}>
        <div style={{ color: "#F87171", fontSize: 12 }}>Chat Assist failed to start: {error}</div>
        <div style={{ color: "#5A6178", fontSize: 11, marginTop: 6 }}>
          The <code>chat_assist</code> feature flag may be disabled for this slot.
        </div>
        <button onClick={startSession} style={{ ...btnSecondary, marginTop: 10 }}>Retry</button>
      </div>
    );
  }

  return (
    <div style={compact ? { ...card, padding: 12 } : card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>
            🤖 Chat Assist {ticketId ? `· Ticket ${ticketId}` : ""}
          </div>
          <div style={{ fontSize: 10, color: "#5A6178", marginTop: 2 }}>
            KB-grounded co-pilot · session {session?.id || "starting…"}
          </div>
        </div>
        {session && session.status !== "handoff" && (
          <button onClick={requestHandoff} style={btnSecondary}>Hand off</button>
        )}
      </div>

      <div ref={scrollRef} style={{
        maxHeight: compact ? 280 : 420,
        overflowY: "auto",
        background: "#0A0C14",
        border: "1px solid #1E2130",
        borderRadius: 6,
        padding: 12,
        marginBottom: 10,
      }}>
        {(!session?.messages || session.messages.length === 0) && (
          <div style={{ color: "#5A6178", fontSize: 11, textAlign: "center", padding: "30px 0" }}>
            Ask the co-pilot for triage steps, customer-reply drafts, or KB suggestions.
          </div>
        )}
        {(session?.messages || []).map(m => (
          <MessageBubble
            key={m.id}
            msg={m}
            ticketId={ticketId}
            onInsert={ticketId ? insertIntoTicket : null}
            onPromote={m.role === "assistant" ? promoteToKb : null}
          />
        ))}
        {sending && (
          <div style={{ color: "#5A6178", fontSize: 11, fontStyle: "italic" }}>Assistant is thinking…</div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask the AI co-pilot…"
          style={inputStyle}
          disabled={!session || session.status === "handoff" || sending}
          onKeyDown={e => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendMessage(); }
          }}
        />
        <button
          onClick={sendMessage}
          disabled={!session || sending || !input.trim()}
          style={{ ...btnPrimary, opacity: (!session || sending || !input.trim()) ? 0.5 : 1 }}
        >
          {sending ? "…" : "Send"}
        </button>
      </div>
      <div style={{ fontSize: 10, color: "#5A6178", marginTop: 6 }}>
        Ctrl/Cmd+Enter to send. PII is redacted before the AI call.
      </div>
    </div>
  );
}

export default ChatAssistTab;
