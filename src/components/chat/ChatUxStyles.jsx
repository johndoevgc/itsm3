// ─── Chat UX Styles — WhatsApp-style message bubbles & animations ─────
// Provides CSS-in-JS styles for the chat panel with smooth transitions,
// message slide-in animations, and modern bubble styling.
import React from "react";

export const chatUxStyles = {
  // ─── Message Bubble Animations ───
  messageSlideIn: {
    animation: "chatMsgSlideIn 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
  },
  proactiveSlideIn: {
    animation: "chatProactiveSlideIn 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
  },
  cardFadeIn: {
    animation: "chatCardFadeIn 0.35s ease-out",
  },

  // ─── User Message Bubble (right-aligned, WhatsApp green-tinted) ───
  userBubble: {
    background: "linear-gradient(135deg, #1A2744 0%, #1E3054 100%)",
    borderRadius: "16px 16px 4px 16px",
    padding: "10px 14px",
    marginLeft: "auto",
    maxWidth: "80%",
    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
    position: "relative",
    wordBreak: "break-word",
  },

  // ─── AI Message Bubble (left-aligned, subtle dark) ───
  aiBubble: {
    background: "linear-gradient(135deg, #0F1629 0%, #151D33 100%)",
    borderRadius: "16px 16px 16px 4px",
    padding: "10px 14px",
    marginRight: "auto",
    maxWidth: "85%",
    boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
    position: "relative",
    wordBreak: "break-word",
    border: "1px solid rgba(99,102,241,0.08)",
  },

  // ─── Proactive/System Message (centered, accent border) ───
  proactiveBubble: {
    background: "linear-gradient(135deg, #0D1225 0%, #121A30 100%)",
    borderRadius: "12px",
    padding: "10px 14px",
    margin: "8px auto",
    maxWidth: "90%",
    boxShadow: "0 1px 4px rgba(99,102,241,0.15)",
    border: "1px solid rgba(99,102,241,0.15)",
    position: "relative",
  },

  // ─── Typing Indicator ───
  typingIndicator: {
    display: "inline-flex",
    gap: 4,
    padding: "8px 14px",
    background: "rgba(99,102,241,0.06)",
    borderRadius: "16px 16px 16px 4px",
    alignItems: "center",
  },
  typingDot: (delay) => ({
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#6366F1",
    animation: `chatTypingBounce 1.4s ease-in-out ${delay}s infinite`,
  }),

  // ─── Message Timestamp ───
  timestamp: {
    fontSize: 10,
    color: "rgba(255,255,255,0.3)",
    marginTop: 4,
    textAlign: "right",
  },

  // ─── Suggestion Chips (WhatsApp quick-reply style) ───
  suggestionChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 12px",
    borderRadius: 20,
    border: "1px solid rgba(99,102,241,0.25)",
    background: "rgba(99,102,241,0.06)",
    color: "#A5B4FC",
    fontSize: 12,
    cursor: "pointer",
    transition: "all 0.2s ease",
    whiteSpace: "nowrap",
  },
  suggestionChipHover: {
    background: "rgba(99,102,241,0.15)",
    borderColor: "rgba(99,102,241,0.5)",
    transform: "translateY(-1px)",
    boxShadow: "0 2px 8px rgba(99,102,241,0.2)",
  },

  // ─── Input Area ───
  inputArea: {
    display: "flex",
    gap: 8,
    padding: "10px 12px",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(10,12,20,0.6)",
    backdropFilter: "blur(8px)",
    alignItems: "flex-end",
  },
  inputField: {
    flex: 1,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 20,
    padding: "8px 14px",
    color: "#E8ECF4",
    fontSize: 13,
    outline: "none",
    resize: "none",
    minHeight: 36,
    maxHeight: 100,
    lineHeight: "1.4",
    transition: "border-color 0.2s, box-shadow 0.2s",
  },
  inputFieldFocus: {
    borderColor: "rgba(99,102,241,0.4)",
    boxShadow: "0 0 0 2px rgba(99,102,241,0.1)",
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: "#6366F1",
    border: "none",
    color: "#fff",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s",
    flexShrink: 0,
  },
  sendButtonDisabled: {
    background: "rgba(99,102,241,0.3)",
    cursor: "not-allowed",
  },
};

/**
 * Inject keyframe animations into the document (call once on mount).
 */
let injected = false;
export function injectChatAnimations() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes chatMsgSlideIn {
      from { opacity: 0; transform: translateY(12px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes chatProactiveSlideIn {
      from { opacity: 0; transform: translateY(-8px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes chatCardFadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes chatTypingBounce {
      0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
      40% { transform: translateY(-6px); opacity: 1; }
    }
    .chat-suggestion-chip:hover {
      background: rgba(99,102,241,0.15) !important;
      border-color: rgba(99,102,241,0.5) !important;
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(99,102,241,0.2);
    }
    .chat-msg-bubble { animation: chatMsgSlideIn 0.3s cubic-bezier(0.22,1,0.36,1); }
    .chat-proactive-bubble { animation: chatProactiveSlideIn 0.4s cubic-bezier(0.22,1,0.36,1); }
    .chat-card-anim { animation: chatCardFadeIn 0.35s ease-out; }
  `;
  document.head.appendChild(style);
}

/**
 * TypingIndicator component — three bouncing dots.
 */
export function TypingIndicator() {
  return (
    <div style={chatUxStyles.typingIndicator}>
      <span style={chatUxStyles.typingDot(0)} />
      <span style={chatUxStyles.typingDot(0.2)} />
      <span style={chatUxStyles.typingDot(0.4)} />
    </div>
  );
}
