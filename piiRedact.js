// ─── PII Redaction Layer (Phase B4) ─────────────────────────────────────
// Strips personally identifiable information before sending text to OpenAI.
// Returns { redacted, map } so callers can reverse-map AI output if needed.
//
// Redacts (in order):
//   - emails               → [EMAIL_n]
//   - SG/INTL phones       → [PHONE_n]
//   - SG NRIC/FIN          → [NRIC_n]
//   - IPv4 addresses       → [IP_n]
//   - long digit runs (≥9) → [NUM_n]      (catches account #s, badge IDs)
//
// Use sparingly — caller decides which prompts get redaction. Reversibility:
// `restore(text, map)` swaps tokens back to original values for the FINAL
// customer-facing email body (never log raw values).

const PATTERNS = [
  { tag: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { tag: "NRIC",  re: /\b[STFGstfg]\d{7}[A-Za-z]\b/g },
  { tag: "IP",    re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  // Phone: require + country code OR explicit "phone:"/"tel:" prefix OR SG-style 8/9-prefixed 8-digit
  // Conservative to avoid grabbing arbitrary digit runs.
  { tag: "PHONE", re: /\+\d{1,3}[\s-]?\d{2,4}[\s-]?\d{3,4}(?:[\s-]?\d{2,4})?|\b[89]\d{3}[\s-]?\d{4}\b/g },
  { tag: "NUM",   re: /\b\d{9,}\b/g },
];

function redact(input) {
  if (!input || typeof input !== "string") return { redacted: input || "", map: {} };
  let text = input;
  const map = {};
  const counters = {};
  for (const { tag, re } of PATTERNS) {
    text = text.replace(re, (match) => {
      // Skip very short numeric matches that are obviously not PII (years, ports, etc.)
      if (tag === "NUM" && match.length < 9) return match;
      counters[tag] = (counters[tag] || 0) + 1;
      const token = `[${tag}_${counters[tag]}]`;
      if (!map[token]) map[token] = match;
      return token;
    });
  }
  return { redacted: text, map };
}

function restore(text, map) {
  if (!text || typeof text !== "string" || !map) return text || "";
  let out = text;
  for (const [token, original] of Object.entries(map)) {
    // Replace ALL occurrences (AI may repeat the token)
    out = out.split(token).join(original);
  }
  return out;
}

function summary(map) {
  const counts = {};
  for (const k of Object.keys(map || {})) {
    const tag = k.match(/^\[([A-Z]+)_/)?.[1] || "OTHER";
    counts[tag] = (counts[tag] || 0) + 1;
  }
  return counts;
}

module.exports = { redact, restore, summary };
