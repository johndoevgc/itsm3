/**
 * chatCards.cjs — channel translators for ChatAssist message payloads.
 *
 * ChatAssist returns "messages" of various shapes: plain text, quick-reply
 * pickers, category-grids, confirm-intake, book-slot, csat-rate. Each channel
 * (Teams, SMS, etc.) needs to render those in its own card vocabulary.
 *
 *   buildAdaptiveCard(message, opts) → { type:"AdaptiveCard", ... } v1.5
 *   buildSmsText(message, opts)      → { text, options? }
 *
 * Both translators are PURE — no I/O, no globals, no side effects. They
 * accept the raw ChatAssist message and return a serializable structure.
 *
 * v3.33.1 (Phase 3 — Omnichannel intake backbone). Translators are reused
 * by routes/teamsBot.js and routes/smsWebhook.js (v3.33.2).
 */

"use strict";

const ADAPTIVE_VERSION = "1.5";
const ADAPTIVE_SCHEMA = "http://adaptivecards.io/schemas/adaptive-card.json";

// Hard caps to keep cards under Teams' 28KB message limit.
const MAX_OPTIONS = 12;
const MAX_TEXT_LEN = 2800;
const MAX_OPTION_LABEL = 60;

function _truncate(s, n) {
  s = String(s == null ? "" : s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function _safeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.slice(0, MAX_OPTIONS).map((o) => {
    if (o == null || typeof o !== "object") return null;
    const value = String(o.value == null ? o.label || "" : o.value).slice(0, 200);
    const label = _truncate(o.label || o.value || "", MAX_OPTION_LABEL);
    if (!value || !label) return null;
    const out = { value, label };
    if (o.icon) out.icon = String(o.icon).slice(0, 8);
    return out;
  }).filter(Boolean);
}

/**
 * buildAdaptiveCard(message, opts={}) → Adaptive Card v1.5 envelope or null
 *
 *   message.type ∈ "text" | "quick-reply" | "category-grid" | "confirm-intake"
 *                | "book-slot" | "csat-rate"
 *   opts.maxReplyChars — cap text body (default MAX_TEXT_LEN)
 *   opts.actionVerb    — verb returned to bot on Action.Submit (default "submit")
 */
function buildAdaptiveCard(message, opts = {}) {
  if (!message || typeof message !== "object") return null;
  const maxText = Math.min(MAX_TEXT_LEN, Number(opts.maxReplyChars) || MAX_TEXT_LEN);
  const verb = String(opts.actionVerb || "submit");
  const body = [];
  const actions = [];

  // Pick the displayable text. ChatAssist messages may have `.text` (most),
  // `.title` (intake prompt), or fall back to a derived prompt.
  const text = _truncate(message.text || message.title || message.prompt || "", maxText);
  if (text) {
    body.push({
      type: "TextBlock",
      text,
      wrap: true,
      size: "Default",
    });
  }

  const kind = message.kind || message.type || "text";
  const options = _safeOptions(message.options);

  if (options.length > 0) {
    // Render as Action.Submit buttons for ≤6 options, ChoiceSet for more.
    if (options.length <= 6) {
      for (const o of options) {
        actions.push({
          type: "Action.Submit",
          title: o.icon ? `${o.icon} ${o.label}` : o.label,
          data: { verb, kind, value: o.value },
        });
      }
    } else {
      body.push({
        type: "Input.ChoiceSet",
        id: "choice",
        style: "compact",
        isRequired: true,
        choices: options.map((o) => ({
          title: o.icon ? `${o.icon} ${o.label}` : o.label,
          value: o.value,
        })),
      });
      actions.push({
        type: "Action.Submit",
        title: "Continue",
        data: { verb, kind },
      });
    }
  }

  // Special handling for csat-rate — render 1..5 star buttons.
  if (kind === "csat-rate" && options.length === 0) {
    for (let n = 5; n >= 1; n--) {
      actions.push({
        type: "Action.Submit",
        title: "★".repeat(n),
        data: { verb, kind: "csat-rate", value: String(n) },
      });
    }
  }

  // confirm-intake gets two prominent positive/negative buttons (already in
  // options above; nothing extra needed).

  if (body.length === 0 && actions.length === 0) return null;

  return {
    $schema: ADAPTIVE_SCHEMA,
    type: "AdaptiveCard",
    version: ADAPTIVE_VERSION,
    body,
    actions,
  };
}

/**
 * buildSmsText(message, opts={}) → { text, options? }
 *
 * SMS has no rich UI — collapse cards to a numbered list. Receiver replies
 * with the number (1, 2, 3...) which the bot maps back to the option value
 * via the returned `options` array.
 *
 *   opts.maxLen   — total char budget (default 480, ~3 SMS segments).
 *   opts.bullet   — bullet glyph (default ").")
 */
function buildSmsText(message, opts = {}) {
  if (!message || typeof message !== "object") return { text: "", options: [] };
  const maxLen = Math.max(80, Number(opts.maxLen) || 480);
  const bullet = String(opts.bullet || ").");
  const text = _truncate(message.text || message.title || message.prompt || "", maxLen - 80);
  const options = _safeOptions(message.options);

  if (options.length === 0) {
    return { text: _truncate(text || "(no message)", maxLen), options: [] };
  }

  let out = text ? text + "\n\nReply with a number:\n" : "Reply with a number:\n";
  const used = [];
  for (let i = 0; i < options.length && i < 9; i++) {
    const o = options[i];
    const line = `${i + 1}${bullet} ${o.label}\n`;
    if (out.length + line.length > maxLen) break;
    out += line;
    used.push({ ...o, smsIndex: i + 1 });
  }
  return { text: _truncate(out, maxLen), options: used };
}

/**
 * resolveSmsReply(reply, options) — given an SMS body like "2" and the
 * `options` returned by buildSmsText, return the matching option (or null
 * if the reply is non-numeric / out of range).
 */
function resolveSmsReply(reply, options) {
  if (!Array.isArray(options) || options.length === 0) return null;
  const m = String(reply || "").trim().match(/^(\d{1,2})\b/);
  if (!m) return null;
  const idx = Number(m[1]);
  if (!Number.isInteger(idx) || idx < 1 || idx > options.length) return null;
  return options[idx - 1];
}

module.exports = {
  buildAdaptiveCard,
  buildSmsText,
  resolveSmsReply,
  // exposed for tests
  _internal: { _truncate, _safeOptions, MAX_OPTIONS, MAX_TEXT_LEN, MAX_OPTION_LABEL },
};
