// ─── Shadow-Mode Harness ───────────────────────────────────────────────
// Run a candidate (new) implementation alongside the control (current)
// implementation, diff their outputs, and log differences for offline review.
// The candidate's return value is NEVER used — only the control's value is
// returned to the caller. This makes refactors safe to roll out incrementally.
//
// Usage:
//   const shadow = require("./shadowMode");
//   const result = await shadow.run({
//     name:      "sla_compute_v2",
//     enabled:   featureFlags.isEnabled("shadow_sla_v2"),
//     control:   () => computeSlaStatus(inc, policy),
//     candidate: () => computeSlaStatus_v2(inc, policy),
//     onDiff:    (diff) => audit("shadow_sla_v2", inc.id, diff),
//     keys:      ["status","breached","hoursElapsed","worstResponseTarget"],
//   });
//
// Stats can be inspected via getStats(name).

const _stats = new Map(); // name -> { runs, errors, diffs, lastDiffAt, sampleDiffs[] }
const SAMPLE_LIMIT = 25;

function _statsFor(name) {
  let s = _stats.get(name);
  if (!s) {
    s = { runs: 0, errors: 0, diffs: 0, lastDiffAt: null, sampleDiffs: [] };
    _stats.set(name, s);
  }
  return s;
}

function _safeStr(v) {
  if (v === undefined) return "<undef>";
  try { return JSON.stringify(v); } catch { return String(v); }
}

function _diff(a, b, keys) {
  const out = {};
  if (Array.isArray(keys) && keys.length) {
    for (const k of keys) {
      const av = a == null ? undefined : a[k];
      const bv = b == null ? undefined : b[k];
      if (_safeStr(av) !== _safeStr(bv)) out[k] = { control: av, candidate: bv };
    }
  } else {
    if (_safeStr(a) !== _safeStr(b)) {
      out.__value = { control: a, candidate: b };
    }
  }
  return out;
}

async function run({ name, enabled, control, candidate, onDiff, keys, sampleRate = 1 }) {
  if (typeof control !== "function") throw new Error("shadow.run: control() required");
  // Always run control first (it's authoritative).
  const controlResult = await control();
  if (!enabled || typeof candidate !== "function") return controlResult;
  if (sampleRate < 1 && Math.random() > sampleRate) return controlResult;

  const stats = _statsFor(name);
  stats.runs++;
  let candResult;
  try {
    candResult = await candidate();
  } catch (e) {
    stats.errors++;
    const sample = { at: new Date().toISOString(), error: e.message };
    stats.sampleDiffs.push(sample);
    if (stats.sampleDiffs.length > SAMPLE_LIMIT) stats.sampleDiffs.shift();
    if (typeof onDiff === "function") {
      try { await onDiff({ name, error: e.message, control: controlResult }); }
      catch { /* swallow */ }
    }
    return controlResult;
  }

  const diff = _diff(controlResult, candResult, keys);
  if (Object.keys(diff).length === 0) return controlResult;

  stats.diffs++;
  stats.lastDiffAt = new Date().toISOString();
  const sample = { at: stats.lastDiffAt, diff };
  stats.sampleDiffs.push(sample);
  if (stats.sampleDiffs.length > SAMPLE_LIMIT) stats.sampleDiffs.shift();

  if (typeof onDiff === "function") {
    try { await onDiff({ name, diff, control: controlResult, candidate: candResult }); }
    catch { /* swallow */ }
  }
  return controlResult;
}

function getStats(name) {
  if (name) return _statsFor(name);
  const out = {};
  for (const [k, v] of _stats.entries()) out[k] = v;
  return out;
}

function reset(name) {
  if (name) _stats.delete(name);
  else _stats.clear();
}

module.exports = { run, getStats, reset };
