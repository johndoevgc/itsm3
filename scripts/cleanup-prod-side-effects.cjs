// scripts/cleanup-prod-side-effects.cjs
// Scan and clean up rows in side-effect itsm_data collections that
// reference the already-purged 30 test incidents and 2 test assets.
// audit_log lives in its own SQL table and is handled by a separate
// admin endpoint (added in routes/core.js).
//
// Usage:
//   node scripts/cleanup-prod-side-effects.cjs            (scan only)
//   node scripts/cleanup-prod-side-effects.cjs --execute  (delete refs)

const https = require("https");
const fs = require("fs");
const path = require("path");

const BASE = process.env.CLEANUP_BASE || "https://vgc-itsm1-app.azurewebsites.net";
// SECURITY (#8 follow-up, 2026-05-03): hardcoded fallback hash removed.
// LOCAL_ADMIN_PASSWORD_HASH is no longer set on the production app, so this
// script will only succeed if a caller explicitly provides the hex hash via
// LOCAL_ADMIN_PASSWORD_HASH_HEX (and the same hash is set on the target slot).
const AUTH_HASH = process.env.LOCAL_ADMIN_PASSWORD_HASH_HEX;
if (!AUTH_HASH) {
  console.error("[cleanup-prod-side-effects] LOCAL_ADMIN_PASSWORD_HASH_HEX env var not set. Aborting.");
  process.exit(2);
}
const AUTH = `Bearer local-hash:${AUTH_HASH}`;
const EXECUTE = process.argv.includes("--execute");

const PURGED_INCIDENTS = [
  "INC-MOLLFLYJ","INC-MOLQ31ZI","INC-MOLQC7NN","INC-MOLLFB4Q","INC-MOLQ2MZD",
  "INC-MOLQBYEL","INC-MOGT2EDF","INC-MOGT4XCN","INC-MOGT6616","INC-MOGT77YK",
  "INC-MOGTI9PE","INC-MOGV9KJS","INC-MOGVDCOM","INC-MOGW4M5C","INC-MOGW8FBQ",
  "INC-MOGWI8D4","INC-MOGWJLSK","INC-MOGWL79W","INC-MOH1LPD5","INC-MOGT1B6L",
  "INC-MOGT8E4C","INC-MOGTAIDH","INC-MOGTBN5V","INC-MOGTCRZL","INC-MOGTF87B",
  "INC-MOGV68P9","INC-MOGVATAE","INC-MOGVC40M","INC-MOGVEJZ7","INC-MOGW3DSK",
];
const PURGED_ASSETS = ["srv-e2e-001", "srv-e2e-002"];
const PURGED_SET = new Set([...PURGED_INCIDENTS, ...PURGED_ASSETS]);

// Collections that may carry references to incidents/assets by id.
// All of these are in itsm_data table and reachable via /api/db/:collection.
const SIDE_COLLECTIONS = [
  "sla_tracking",
  "ai_actions",
  "ai_resolve_queue",
  "ai_workflow_queue",
  "ai_triage_history",
  "ai_briefings",
  "ai_learning_feedback",
  "notifications",
  "workflow_executions",
  "approval_instances",
  "runbook_executions",
];

function req(method, urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    https.request({
      hostname: url.hostname, port: 443, path: url.pathname + url.search,
      method, headers: { Authorization: AUTH },
    }, (res) => {
      let buf = ""; res.on("data", c => buf += c);
      res.on("end", () => {
        let j = null; try { j = JSON.parse(buf); } catch { /* ignore */ }
        resolve({ status: res.statusCode, body: buf, json: j });
      });
    }).on("error", reject).end();
  });
}

function refsPurged(rec) {
  if (!rec || typeof rec !== "object") return null;
  // Direct id match (e.g., sla_tracking uses incidentId as the row id)
  if (PURGED_SET.has(rec.id)) return `id=${rec.id}`;
  // Common reference fields
  const fields = ["incidentId","ticketId","recordId","relatedId","assetId","entityId","ref","incident","incident_id","asset_id"];
  for (const f of fields) {
    if (PURGED_SET.has(rec[f])) return `${f}=${rec[f]}`;
  }
  // Last resort: scan stringified content for any purged id
  const blob = JSON.stringify(rec);
  for (const id of PURGED_SET) {
    if (blob.includes(`"${id}"`)) return `contains:${id}`;
  }
  return null;
}

async function main() {
  console.log("====== Side-Effect Cleanup ======");
  console.log(`Mode: ${EXECUTE ? "EXECUTE" : "SCAN ONLY"}`);
  console.log("");

  const findings = {};
  for (const coll of SIDE_COLLECTIONS) {
    const r = await req("GET", `/api/db/${coll}`);
    if (r.status !== 200) {
      console.log(`  ${coll}: HTTP ${r.status} — skipping`);
      continue;
    }
    const rows = Array.isArray(r.json?.data) ? r.json.data : (Array.isArray(r.json) ? r.json : []);
    const matches = [];
    for (const row of rows) {
      // routes return either record directly or {id, data}
      const rec = row.data || row;
      const reason = refsPurged(rec);
      if (reason) matches.push({ id: rec.id || row.id, reason });
    }
    findings[coll] = { total: rows.length, matched: matches };
    console.log(`  ${coll.padEnd(24)} total=${String(rows.length).padStart(5)}  matched=${matches.length}`);
    for (const m of matches.slice(0, 10)) {
      console.log(`    - ${m.id}  (${m.reason})`);
    }
    if (matches.length > 10) console.log(`    ... +${matches.length - 10} more`);
  }

  // Persist scan
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(__dirname, "..", "app-logs", "cleanup");
  fs.mkdirSync(outDir, { recursive: true });
  const scanPath = path.join(outDir, `prod-side-effects-${ts}.json`);
  fs.writeFileSync(scanPath, JSON.stringify({ scannedAt: new Date().toISOString(), findings }, null, 2));
  console.log(`\nScan written: ${scanPath}`);

  if (!EXECUTE) {
    console.log("\nSCAN-ONLY complete. Re-run with --execute to delete matched rows.");
    return;
  }

  console.log("\n--- Deleting matched side-effect rows ---");
  const deleted = {};
  for (const [coll, info] of Object.entries(findings)) {
    deleted[coll] = [];
    for (const m of info.matched) {
      if (!m.id) continue;
      const r = await req("DELETE", `/api/db/${coll}/${encodeURIComponent(m.id)}`);
      const ok = r.status === 200 && r.json?.ok === true;
      console.log(`  ${ok ? "DEL OK " : "DEL FAIL"} ${coll}/${m.id} HTTP ${r.status}`);
      if (ok) deleted[coll].push(m.id);
    }
  }
  const resultPath = scanPath.replace(/\.json$/, "-result.json");
  fs.writeFileSync(resultPath, JSON.stringify({ executedAt: new Date().toISOString(), deleted }, null, 2));
  console.log(`\nResult written: ${resultPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
