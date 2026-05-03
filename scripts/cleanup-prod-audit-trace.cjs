// scripts/cleanup-prod-audit-trace.cjs
// Purge audit_log rows for the previously deleted test incidents and assets.
// Targets the new admin endpoint added in routes/core.js:
//   POST /api/admin/purge-audit-records
//
// Usage:
//   node scripts/cleanup-prod-audit-trace.cjs            (dry-run)
//   node scripts/cleanup-prod-audit-trace.cjs --execute  (delete rows)

const https = require("https");
const fs = require("fs");
const path = require("path");

const BASE = process.env.CLEANUP_BASE || "https://vgc-itsm1-app.azurewebsites.net";
// SECURITY (#8 follow-up, 2026-05-03): hardcoded fallback hash removed.
const HASH = process.env.LOCAL_ADMIN_PASSWORD_HASH_HEX;
if (!HASH) {
  console.error("[cleanup-prod-audit-trace] LOCAL_ADMIN_PASSWORD_HASH_HEX env var not set. Aborting.");
  process.exit(2);
}
const AUTH = `Bearer local-hash:${HASH}`;
const EXECUTE = process.argv.includes("--execute");

const INCIDENT_IDS = [
  "INC-MOLLFLYJ","INC-MOLQ31ZI","INC-MOLQC7NN","INC-MOLLFB4Q","INC-MOLQ2MZD",
  "INC-MOLQBYEL","INC-MOGT2EDF","INC-MOGT4XCN","INC-MOGT6616","INC-MOGT77YK",
  "INC-MOGTI9PE","INC-MOGV9KJS","INC-MOGVDCOM","INC-MOGW4M5C","INC-MOGW8FBQ",
  "INC-MOGWI8D4","INC-MOGWJLSK","INC-MOGWL79W","INC-MOH1LPD5","INC-MOGT1B6L",
  "INC-MOGT8E4C","INC-MOGTAIDH","INC-MOGTBN5V","INC-MOGTCRZL","INC-MOGTF87B",
  "INC-MOGV68P9","INC-MOGVATAE","INC-MOGVC40M","INC-MOGVEJZ7","INC-MOGW3DSK",
];
const ASSET_IDS = ["srv-e2e-001", "srv-e2e-002"];
// Side-effect collections we already purged via API DELETE — those generated
// new "delete" audit rows that we also need to scrub.
const AI_ACTIONS_IDS = [
  "SLA-momxzxpn-823v","SLA-momxzxpd-46se","COR-mome9f8n-ljev","COR-mome9f8x-l0ak",
  "AIT-mome2lvo-nylu","AIT-mome2lvs-2inm","AIT-mome1xr8-ytdu","COR-momd5zvi-l2r7",
  "COR-momd5zvu-o7ww","SLA-momd3rt2-iuct",
];
const AI_RESOLVE_QUEUE_IDS = [
  "AIR-INC-MOLQC7NN-1777606538767","AIR-INC-MOLQ31ZI-1777606533124","AIR-INC-MOLQ2MZD-1777606532746",
  "AIR-INC-MOLLFB4Q-1777606531136","AIR-INC-MOLLFLYJ-1777606531839","AIR-INC-MOLQBYEL-1777606531766",
  "AIR-INC-MOGW3DSK-1777283589809","AIR-INC-MOH1LPD5-1777425454811","AIR-INC-MOGV68P9-1777281789082",
  "AIR-INC-MOGVATAE-1777281789145","AIR-INC-MOGVC40M-1777281788769","AIR-INC-MOGTBN5V-1777279091276",
  "AIR-INC-MOGTCRZL-1777279091284","AIR-INC-MOGTF87B-1777279091060","AIR-INC-MOGTAIDH-1777279090725",
  "AIR-INC-MOGT1B6L-1777278193733","AIR-INC-MOGT8E4C-1777278190036","AIR-INC-MOH1LPD5-1777292472620",
  "AIR-INC-MOGWL79W-1777284489187","AIR-INC-MOGWI8D4-1777284488644","AIR-INC-MOGWJLSK-1777284488014",
  "AIR-INC-MOGW4M5C-1777283590812","AIR-INC-MOGW8FBQ-1777283588874","AIR-INC-MOGVEJZ7-1777282692717",
  "AIR-INC-MOGVDCOM-1777281790418","AIR-INC-MOGV9KJS-1777281789625","AIR-INC-MOGTI9PE-1777279091973",
  "AIR-INC-MOGT77YK-1777278193149","AIR-INC-MOGT2EDF-1777278192252","AIR-INC-MOGT4XCN-1777278192119",
  "AIR-INC-MOGT6616-1777278192532",
];
const AI_TRIAGE_HISTORY_IDS = ["AIT-mome2lvo-nylu","AIT-mome2lvs-2inm","AIT-mome1xr8-ytdu"];

const TARGETS = {
  incidents: INCIDENT_IDS,
  assets: ASSET_IDS,
  ai_actions: AI_ACTIONS_IDS,
  ai_resolve_queue: AI_RESOLVE_QUEUE_IDS,
  ai_triage_history: AI_TRIAGE_HISTORY_IDS,
};

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const data = body ? JSON.stringify(body) : null;
    const headers = { Authorization: AUTH };
    if (data) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(data);
    }
    const r = https.request({ hostname: url.hostname, port: 443, path: url.pathname, method, headers }, (res) => {
      let buf = ""; res.on("data", c => buf += c);
      res.on("end", () => {
        let j = null; try { j = JSON.parse(buf); } catch { /* ignore */ }
        resolve({ status: res.statusCode, body: buf, json: j });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  console.log("====== Audit-Log Trace Purge ======");
  console.log(`Target: ${BASE}`);
  console.log(`Mode:   ${EXECUTE ? "EXECUTE" : "DRY-RUN"}`);
  console.log("");

  const health = await req("GET", "/api/health");
  if (health.status !== 200 || !/vgc-itsm1-mysql/i.test(health.json?.dbLabel || "")) {
    console.error("Health gate failed:", health.status, health.json?.dbLabel);
    process.exit(2);
  }
  console.log(`Health OK — db=${health.json.dbLabel}`);
  console.log("");

  const r = await req("POST", "/api/admin/purge-audit-records", {
    dryRun: !EXECUTE,
    targets: TARGETS,
  });
  console.log("HTTP", r.status);
  console.log(JSON.stringify(r.json, null, 2));

  if (r.status !== 200) process.exit(3);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(__dirname, "..", "app-logs", "cleanup");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `prod-audit-trace-${EXECUTE ? "result" : "dryrun"}-${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), targets: TARGETS, response: r.json }, null, 2));
  console.log(`Written: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
