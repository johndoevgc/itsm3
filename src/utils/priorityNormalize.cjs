// src/utils/priorityNormalize.cjs
// Canonical priority normalization: maps any common priority/severity input
// to the canonical "Sev-A".."Sev-D" form used by the SLA engine.
//
// Authoritative mapping
//   Sev-A  ↔  P1  ↔  Critical / Urgent / Sev1 / Sev-Critical / High*¹
//   Sev-B  ↔  P2  ↔  High
//   Sev-C  ↔  P3  ↔  Normal / Medium
//   Sev-D  ↔  P4  ↔  Low
//
// *¹ "High" by itself is ambiguous in the wild; we resolve it to Sev-B.
//    Use "Critical" / "Urgent" / "Sev1" / "P1" for Sev-A.
//
// Unknown / missing values fall back to Sev-C so nothing is silently
// promoted or demoted at the SLA boundary.

const SEV_VALUES = ["Sev-A", "Sev-B", "Sev-C", "Sev-D"];
const SEV_SET = new Set(SEV_VALUES);
const FALLBACK = "Sev-C";

const ALIAS_TO_SEV = {
  // Sev-A
  "sev-a": "Sev-A", "seva": "Sev-A", "sev1": "Sev-A", "sev-1": "Sev-A",
  "p1": "Sev-A", "priority1": "Sev-A", "p-1": "Sev-A",
  "critical": "Sev-A", "urgent": "Sev-A", "sev-critical": "Sev-A",
  "1": "Sev-A",
  // Sev-B
  "sev-b": "Sev-B", "sevb": "Sev-B", "sev2": "Sev-B", "sev-2": "Sev-B",
  "p2": "Sev-B", "priority2": "Sev-B", "p-2": "Sev-B",
  "high": "Sev-B", "major": "Sev-B",
  "2": "Sev-B",
  // Sev-C
  "sev-c": "Sev-C", "sevc": "Sev-C", "sev3": "Sev-C", "sev-3": "Sev-C",
  "p3": "Sev-C", "priority3": "Sev-C", "p-3": "Sev-C",
  "normal": "Sev-C", "medium": "Sev-C", "moderate": "Sev-C",
  "3": "Sev-C",
  // Sev-D
  "sev-d": "Sev-D", "sevd": "Sev-D", "sev4": "Sev-D", "sev-4": "Sev-D",
  "p4": "Sev-D", "priority4": "Sev-D", "p-4": "Sev-D",
  "low": "Sev-D", "minor": "Sev-D", "informational": "Sev-D", "info": "Sev-D",
  "4": "Sev-D",
};

const SEV_TO_P = { "Sev-A": "P1", "Sev-B": "P2", "Sev-C": "P3", "Sev-D": "P4" };
const SEV_TO_ZD = { "Sev-A": "urgent", "Sev-B": "high", "Sev-C": "normal", "Sev-D": "low" };

/**
 * Normalize any priority/severity-like value to canonical "Sev-A".."Sev-D".
 * Returns "Sev-C" for null/undefined/unknown inputs.
 */
function normalizePriority(value) {
  if (value == null) return FALLBACK;
  if (typeof value !== "string") {
    if (typeof value === "number") {
      const k = String(value);
      return ALIAS_TO_SEV[k] || FALLBACK;
    }
    return FALLBACK;
  }
  const trimmed = value.trim();
  if (!trimmed) return FALLBACK;
  if (SEV_SET.has(trimmed)) return trimmed;
  const key = trimmed.toLowerCase().replace(/\s+/g, "");
  return ALIAS_TO_SEV[key] || FALLBACK;
}

/** "P1".."P4" form. */
function priorityToPCode(value) {
  return SEV_TO_P[normalizePriority(value)];
}

/** Zendesk-style "urgent" / "high" / "normal" / "low". */
function priorityToZendesk(value) {
  return SEV_TO_ZD[normalizePriority(value)];
}

/**
 * True when the input matches Sev-A or Sev-B (i.e. a "major" priority).
 * Use this anywhere we need a single test for "P1/P2-class" tickets.
 */
function isMajorPriority(value) {
  const sev = normalizePriority(value);
  return sev === "Sev-A" || sev === "Sev-B";
}

module.exports = {
  SEV_VALUES,
  FALLBACK_PRIORITY: FALLBACK,
  normalizePriority,
  priorityToPCode,
  priorityToZendesk,
  isMajorPriority,
};
