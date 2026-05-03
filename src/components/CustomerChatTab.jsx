import { useState, useCallback, useRef, useEffect } from "react";

// CustomerChatTab — VGC AI Assist self-service portal widget.
// Customer-channel sessions follow the guided 8-stage flow: greeting →
// category → intake fields → confirm → ticket-created → solution →
// resolved/escalated → CSAT. Cards are rendered inline (custom action
// semantics route to /intake-action, /create-ticket, /csat, /book-slot).

const card = {
  background: "#0F1117",
  border: "1px solid #1E2130",
  borderRadius: 8,
  padding: 16,
};

// ─── Inline card components ────────────────────────────────────────────────

function CategoryGrid({ options, onPick, disabled }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
      gap: 6,
      marginTop: 8,
    }}>
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onPick(o.value)}
          disabled={disabled}
          style={{
            background: "#0A0C14",
            border: "1px solid #2A2F44",
            borderRadius: 8,
            padding: "10px 8px",
            color: "#E8ECF4",
            fontSize: 11,
            cursor: disabled ? "default" : "pointer",
            textAlign: "left",
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <div style={{ fontSize: 18 }}>{o.icon}</div>
          <div style={{ marginTop: 4 }}>{o.label}</div>
        </button>
      ))}
    </div>
  );
}

function QuickReplyChips({ options, onPick, disabled }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      {options.map(o => (
        <button
          key={String(o.value)}
          onClick={() => onPick(o.value)}
          disabled={disabled}
          style={{
            background: "#1E2130",
            border: "1px solid #2A2F44",
            borderRadius: 999,
            padding: "6px 12px",
            color: "#E8ECF4",
            fontSize: 11,
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.5 : 1,
          }}
        >
          {o.icon ? `${o.icon} ` : ""}{o.label}
        </button>
      ))}
    </div>
  );
}

function IntakeSummaryCard({ fields, actions, onAction, disabled }) {
  const rows = [
    ["Category",     fields.category],
    ["Title",        fields.title],
    ["Description",  fields.description],
    ["Error",        fields.errorMsg],
    ["Device(s)",    fields.devices],
    ["Impact",       fields.impact],
    ["Priority",     fields.priority],
    ["Started",      fields.startedAt],
    ["Already tried", fields.triedSteps],
  ].filter(r => r[1] && r[1] !== "(skipped)");
  return (
    <div style={{
      background: "#0A0C14",
      border: "1px solid #2A2F44",
      borderRadius: 8,
      padding: 12,
      marginTop: 8,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#E8ECF4", marginBottom: 8 }}>
        📋 Please confirm
      </div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", gap: 8, marginBottom: 4, fontSize: 11 }}>
          <div style={{ color: "#5A6178", minWidth: 100 }}>{k}</div>
          <div style={{ color: "#E8ECF4", flex: 1, whiteSpace: "pre-wrap" }}>{v}</div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {actions.map(a => (
          <button
            key={a.value}
            onClick={() => onAction(a)}
            disabled={disabled}
            style={{
              background: a.value === "confirm" ? "#22C55E" : "transparent",
              border: a.value === "confirm" ? "none" : "1px solid #2A2F44",
              color: a.value === "confirm" ? "#fff" : "#A8B0C4",
              borderRadius: 6,
              padding: "8px 14px",
              fontSize: 11,
              fontWeight: 600,
              cursor: disabled ? "default" : "pointer",
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function IncidentTicketCard({ ticket }) {
  const sevColor = { P1: "#EF4444", P2: "#F59E0B", P3: "#3B82F6", P4: "#6B7280" }[ticket.severity] || "#6366F1";
  return (
    <div style={{
      background: "linear-gradient(135deg, #0A0C14, #1E2130)",
      border: `1px solid ${sevColor}`,
      borderRadius: 8,
      padding: 12,
      marginTop: 8,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4" }}>🎫 {ticket.id}</div>
        <div style={{
          background: sevColor, color: "#fff", borderRadius: 4,
          padding: "2px 8px", fontSize: 10, fontWeight: 700,
        }}>{ticket.severity}</div>
      </div>
      <div style={{ fontSize: 12, color: "#A8B0C4", marginBottom: 4 }}>{ticket.title}</div>
      <div style={{ fontSize: 10, color: "#5A6178" }}>SLA target: {ticket.sla} · Status: {ticket.status}</div>
    </div>
  );
}

function EscalatedCard({ reason, sla, severity }) {
  return (
    <div style={{
      background: "#7C2D12",
      border: "1px solid #EA580C",
      borderRadius: 8,
      padding: 12,
      marginTop: 8,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#FED7AA", marginBottom: 4 }}>
        🛟 Escalated to a VGC engineer
      </div>
      <div style={{ fontSize: 11, color: "#FEF3C7" }}>
        Reason: {reason} · Severity {severity} · SLA {sla}
      </div>
    </div>
  );
}

function CsatCard({ options, onPick, disabled }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: "#A8B0C4", marginBottom: 6 }}>
        How was your experience today?
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {options.map(o => (
          <button
            key={o.value}
            onClick={() => onPick(o.value)}
            disabled={disabled}
            style={{
              background: "#1E2130",
              border: "1px solid #2A2F44",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 14,
              cursor: disabled ? "default" : "pointer",
              opacity: disabled ? 0.5 : 1,
            }}
            title={`${o.value} star${o.value > 1 ? "s" : ""}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Inline media renderer for KB-attached screenshots / videos.
function MediaCard({ screenshotUrl, videoUrl, caption }) {
  const isSafe = (u) => /^https?:\/\//i.test(u || "");
  if (!isSafe(screenshotUrl) && !isSafe(videoUrl)) return null;
  return (
    <div style={{
      marginTop: 8, padding: 10, border: "1px solid #2A2F44", borderRadius: 8,
      background: "#0A0C14",
    }}>
      {isSafe(screenshotUrl) && (
        <img
          src={screenshotUrl}
          alt={caption || "KB screenshot"}
          style={{ maxWidth: "100%", borderRadius: 6, border: "1px solid #1E2130" }}
        />
      )}
      {isSafe(videoUrl) && (
        <video
          src={videoUrl}
          controls
          style={{ maxWidth: "100%", borderRadius: 6, marginTop: isSafe(screenshotUrl) ? 8 : 0 }}
        />
      )}
      {caption && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#A8B0C4" }}>{caption}</div>
      )}
    </div>
  );
}

function MessageCards({ cards, onAction, disabled }) {
  if (!cards || !cards.length) return null;
  return (
    <div>
      {cards.map((c, i) => {
        if (c.type === "category-grid") {
          return <CategoryGrid key={i} options={c.options} disabled={disabled}
            onPick={v => onAction({ kind: c.kind, value: v })} />;
        }
        if (c.type === "quick-reply") {
          return <QuickReplyChips key={i} options={c.options} disabled={disabled}
            onPick={v => onAction({ kind: c.kind, value: v })} />;
        }
        if (c.type === "intake-summary") {
          return <IntakeSummaryCard key={i} fields={c.fields} actions={c.actions}
            disabled={disabled} onAction={a => onAction(a)} />;
        }
        if (c.type === "incident-ticket") {
          return <IncidentTicketCard key={i} ticket={c.ticket} />;
        }
        if (c.type === "escalated") {
          return <EscalatedCard key={i} reason={c.reason} sla={c.sla} severity={c.severity} />;
        }
        if (c.type === "slot-picker") {
          return <QuickReplyChips key={i} options={c.options} disabled={disabled}
            onPick={v => onAction({ kind: c.kind, value: v })} />;
        }
        if (c.type === "csat") {
          return <CsatCard key={i} options={c.options} disabled={disabled}
            onPick={v => onAction({ kind: c.kind, value: v })} />;
        }
        if (c.type === "media") {
          return <MediaCard key={i} screenshotUrl={c.screenshotUrl} videoUrl={c.videoUrl} caption={c.caption} />;
        }
        return null;
      })}
    </div>
  );
}

export function CustomerChatTab({ currentUser, showToast }) {
  const [session, setSession] = useState(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const greetingFiredRef = useRef(false);

  const startSession = useCallback(async () => {
    try {
      const r = await fetch("/api/chat-assist/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "customer",
          customerName: currentUser?.name || null,
          customerEmail: currentUser?.email || null,
          customerCompany: currentUser?.company || null,
        }),
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
    }
  }, [currentUser]);

  useEffect(() => { startSession(); }, [startSession]);

  // Fire the greeting card on session ready (once).
  useEffect(() => {
    if (!session || greetingFiredRef.current) return;
    if (session.intake && session.intake.stage === "greeting" && (!session.messages || !session.messages.length)) {
      greetingFiredRef.current = true;
      (async () => {
        try {
          const r = await fetch("/api/chat-assist/intake-action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: session.id, kind: "start-greeting" }),
          });
          if (!r.ok) return;
          const d = await r.json();
          if (d.message) {
            setSession(prev => ({
              ...prev,
              intake: prev.intake ? { ...prev.intake, stage: d.intakeStage || prev.intake.stage } : prev.intake,
              messages: [...(prev.messages || []), d.message],
            }));
          }
        } catch { /* ignore */ }
      })();
    }
  }, [session]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [session?.messages?.length]);

  const sendMessage = async () => {
    if (!input.trim() || !session || sending) return;
    const text = input.trim();
    setSending(true);
    setSession(prev => ({
      ...prev,
      messages: [...(prev.messages || []), { id: `tmp_${Date.now()}`, role: "user", text }],
    }));
    setInput("");
    try {
      const r = await fetch("/api/chat-assist/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, text }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setSession(prev => ({
        ...prev,
        messages: [...(prev.messages || []), d.message],
      }));
      if (d.suggestHandoff) {
        showToast?.("Looks like you may need a human — tap 'Talk to an agent' below.", "info");
      }
    } catch (e) {
      showToast?.(`Send failed: ${e.message}`, "error");
    } finally {
      setSending(false);
    }
  };

  // ─── Card action dispatcher ──────────────────────────────────────────────
  const handleCardAction = async (action) => {
    if (!session || sending) return;
    const { kind, value } = action;
    setSending(true);
    try {
      // Confirm intake → call /create-ticket
      if (kind === "confirm-intake" && value === "confirm") {
        const r = await fetch("/api/chat-assist/create-ticket", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.id }),
        });
        if (!r.ok) {
          const txt = await r.text();
          throw new Error(`Create ticket failed: HTTP ${r.status} ${txt}`);
        }
        const d = await r.json();
        setSession(prev => ({
          ...prev,
          ticketId: d.ticketId,
          intake: prev.intake ? { ...prev.intake, ticketId: d.ticketId, severity: d.severity, stage: "solution" } : prev.intake,
          messages: d.message ? [...(prev.messages || []), d.message] : (prev.messages || []),
        }));
        showToast?.(`Ticket ${d.ticketId} created (${d.severity})`, "success");
        return;
      }
      // CSAT
      if (kind === "csat-rate") {
        const r = await fetch("/api/chat-assist/csat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.id, rating: value }),
        });
        if (!r.ok) throw new Error(`CSAT failed: HTTP ${r.status}`);
        const d = await r.json();
        setSession(prev => ({
          ...prev,
          intake: prev.intake ? { ...prev.intake, csat: value, stage: "closed" } : prev.intake,
          messages: d.message ? [...(prev.messages || []), d.message] : (prev.messages || []),
        }));
        showToast?.("Thank you for your feedback!", "success");
        return;
      }
      // Slot booking
      if (kind === "book-slot") {
        const r = await fetch("/api/chat-assist/book-slot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.id, slotIso: value }),
        });
        if (!r.ok) throw new Error(`Book slot failed: HTTP ${r.status}`);
        const d = await r.json();
        setSession(prev => ({
          ...prev,
          messages: d.message ? [...(prev.messages || []), d.message] : (prev.messages || []),
        }));
        return;
      }
      // All other intake-action kinds
      const r = await fetch("/api/chat-assist/intake-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, kind, value }),
      });
      if (!r.ok) throw new Error(`Action failed: HTTP ${r.status}`);
      const d = await r.json();
      setSession(prev => ({
        ...prev,
        intake: prev.intake ? { ...prev.intake, stage: d.intakeStage || prev.intake.stage } : prev.intake,
        messages: d.message ? [...(prev.messages || []), d.message] : (prev.messages || []),
      }));
    } catch (e) {
      showToast?.(e.message, "error");
    } finally {
      setSending(false);
    }
  };

  const escalate = async () => {
    if (!session) return;
    // If we have an intake state, prefer the request-agent action so the
    // server emits the slot-picker card too.
    if (session.intake && session.intake.stage !== "csat" && session.intake.stage !== "closed") {
      await handleCardAction({ kind: "request-agent" });
      return;
    }
    try {
      const r = await fetch("/api/chat-assist/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      showToast?.("Connecting you to a live agent…", "success");
      const d = await r.json();
      setSession(d.session);
    } catch (e) {
      showToast?.(`Escalation failed: ${e.message}`, "error");
    }
  };

  if (error && !session) {
    return (
      <div style={card}>
        <div style={{ color: "#F87171", fontSize: 12 }}>Chat unavailable: {error}</div>
        <div style={{ color: "#5A6178", fontSize: 11, marginTop: 6 }}>Please use "Report an Issue" instead.</div>
      </div>
    );
  }

  const handedOff = session?.status === "handoff";
  const ticketId = session?.ticketId || session?.intake?.ticketId;
  const stage = session?.intake?.stage;
  const closed = stage === "closed";

  return (
    <div style={card}>
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>
            💬 VGC AI Assist
          </div>
          <div style={{ fontSize: 11, color: "#5A6178", marginTop: 2 }}>
            Your guided IT support assistant. Tap a card or type below.
          </div>
        </div>
        {ticketId && (
          <div style={{
            background: "#1E2130", border: "1px solid #6366F1", borderRadius: 6,
            padding: "4px 10px", fontSize: 11, color: "#A5B4FC", fontWeight: 600,
          }}>
            🎫 {ticketId}
          </div>
        )}
      </div>

      <div ref={scrollRef} style={{
        maxHeight: 480,
        overflowY: "auto",
        background: "#0A0C14",
        border: "1px solid #1E2130",
        borderRadius: 6,
        padding: 12,
        marginBottom: 10,
      }}>
        {(!session?.messages || session.messages.length === 0) && (
          <div style={{ color: "#5A6178", fontSize: 12, textAlign: "center", padding: "30px 0" }}>
            👋 Connecting you with VGC AI Assist…
          </div>
        )}
        {(session?.messages || []).map(m => {
          const isUser = m.role === "user";
          return (
            <div key={m.id} style={{ marginBottom: 10 }}>
              <div style={{
                display: "flex",
                justifyContent: isUser ? "flex-end" : "flex-start",
              }}>
                <div style={{
                  maxWidth: isUser ? "82%" : "92%",
                  background: isUser ? "#6366F133" : "#1E2130",
                  border: `1px solid ${isUser ? "#6366F1" : "#2A2F44"}`,
                  borderRadius: 12,
                  padding: "8px 12px",
                  fontSize: 12,
                  color: "#E8ECF4",
                  whiteSpace: "pre-wrap",
                }}>
                  {m.text}
                  {!isUser && m.citations && m.citations.length > 0 && (
                    <div style={{ marginTop: 6, fontSize: 10, color: "#5A6178" }}>
                      Sources: {m.citations.map(c => c.title).join(" · ")}
                    </div>
                  )}
                </div>
              </div>
              {!isUser && m.cards && m.cards.length > 0 && (
                <MessageCards cards={m.cards} onAction={handleCardAction} disabled={sending || closed} />
              )}
            </div>
          );
        })}
        {sending && (
          <div style={{ color: "#5A6178", fontSize: 11, fontStyle: "italic" }}>Assistant is thinking…</div>
        )}
      </div>

      {handedOff ? (
        <div style={{ background: "#1E2130", padding: 12, borderRadius: 6, fontSize: 12, color: "#A8B0C4" }}>
          ✅ A live agent has been notified and will respond shortly. You can keep this tab open.
        </div>
      ) : closed ? (
        <div style={{ background: "#0A0C14", border: "1px solid #22C55E", padding: 12, borderRadius: 6, fontSize: 12, color: "#86EFAC" }}>
          ✅ This session is complete. Thank you for using VGC AI Assist.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Type your message…"
              style={{
                flex: 1,
                background: "#0A0C14",
                border: "1px solid #1E2130",
                borderRadius: 6,
                color: "#E8ECF4",
                padding: "10px 12px",
                fontSize: 12,
                resize: "vertical",
                minHeight: 50,
                fontFamily: "inherit",
              }}
              disabled={!session || sending}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
              }}
            />
            <button
              onClick={sendMessage}
              disabled={!session || sending || !input.trim()}
              style={{
                background: "#6366F1", color: "#fff", border: "none", borderRadius: 6,
                padding: "10px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                opacity: (!session || sending || !input.trim()) ? 0.5 : 1,
              }}
            >
              Send
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            <div style={{ fontSize: 10, color: "#5A6178" }}>Enter to send · Shift+Enter for new line</div>
            <button
              onClick={escalate}
              style={{
                background: "transparent", border: "1px solid #1E2130", color: "#A8B0C4",
                borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer",
              }}
            >
              👤 Talk to an agent
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default CustomerChatTab;
