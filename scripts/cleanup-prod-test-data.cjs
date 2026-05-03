// scripts/cleanup-prod-test-data.cjs
// Permanent cleanup of high-confidence non-production E2E/test residue
// from production. Default mode is dry-run + evidence export. Pass
// --execute to actually DELETE incidents and assets via /api/db/:collection/:id.
//
// Audit-trace removal lives in scripts/cleanup-prod-audit-trace.cjs (run after
// data deletion). DELETE via the API also writes its own "delete" audit row
// per collection — those will be handled in the trace pass.
//
// Usage:
//   node scripts/cleanup-prod-test-data.cjs            (dry-run + export)
//   node scripts/cleanup-prod-test-data.cjs --execute  (perform deletes)

const https = require("https");
const fs = require("fs");
const path = require("path");

const BASE = process.env.CLEANUP_BASE || "https://vgc-itsm1-app.azurewebsites.net";
// SECURITY (#8 follow-up, 2026-05-03): hardcoded fallback hash removed.
const AUTH_HASH = process.env.LOCAL_ADMIN_PASSWORD_HASH_HEX;
if (!AUTH_HASH) {
  console.error("[cleanup-prod-test-data] LOCAL_ADMIN_PASSWORD_HASH_HEX env var not set. Aborting.");
  process.exit(2);
}
const AUTH_HEADER = `Bearer local-hash:${AUTH_HASH}`;
const EXECUTE = process.argv.includes("--execute");

// High-confidence candidate sets locked from evidence in:
//   - e2e-azure-test.cjs line 640 (email ingest user@test.com / printer jam)
//   - e2e-azure-test.cjs line 708 (self-service enduser@test.com / laptop slow)
//   - e2e-azure-test.cjs line 775 (CMDB discovery srv-e2e-001/002)
const INCIDENT_IDS = [
  // self-service enduser@test.com "My laptop is slow"
  "INC-MOLLFLYJ", "INC-MOLQ31ZI", "INC-MOLQC7NN",
  // email ingest user@test.com "Printer not working in floor 3" (open/new)
  "INC-MOLLFB4Q", "INC-MOLQ2MZD", "INC-MOLQBYEL",
  // email ingest user@test.com printer-jam cluster (resolved/closed dupes)
  "INC-MOGT2EDF", "INC-MOGT4XCN", "INC-MOGT6616", "INC-MOGT77YK",
  "INC-MOGTI9PE", "INC-MOGV9KJS", "INC-MOGVDCOM", "INC-MOGW4M5C",
  "INC-MOGW8FBQ", "INC-MOGWI8D4", "INC-MOGWJLSK", "INC-MOGWL79W",
  "INC-MOH1LPD5", "INC-MOGT1B6L", "INC-MOGT8E4C", "INC-MOGTAIDH",
  "INC-MOGTBN5V", "INC-MOGTCRZL", "INC-MOGTF87B", "INC-MOGV68P9",
  "INC-MOGVATAE", "INC-MOGVC40M", "INC-MOGVEJZ7", "INC-MOGW3DSK",
];

const ASSET_IDS = ["srv-e2e-001", "srv-e2e-002"];

const REQUIRED_INCIDENT_MARKERS = ["enduser@test.com", "user@test.com"];
const REQUIRED_ASSET_MARKER = "e2e-test"; // discoverySource

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const data = body ? JSON.stringify(body) : null;
    const headers = { Authorization: AUTH_HEADER };
    if (data) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(data);
    }
    const r = https.request(
      { hostname: url.hostname, port: 443, path: url.pathname + url.search, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let json = null;
          try { json = JSON.parse(buf); } catch { /* ignore */ }
          resolve({ status: res.statusCode, body: buf, json });
        });
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

async function fetchOne(collection, id) {
  const r = await req("GET", `/api/db/${collection}/${encodeURIComponent(id)}`);
  return { id, status: r.status, record: r.json };
}

async function main() {
  console.log("====== VGC-ITSM Production Test-Data Cleanup ======");
  console.log(`Target:  ${BASE}`);
  console.log(`Mode:    ${EXECUTE ? "EXECUTE (deletes will happen)" : "DRY-RUN (no deletes)"}`);
  console.log("");

  // 1. Health gate
  const health = await req("GET", "/api/health");
  if (health.status !== 200 || health.json?.status !== "ok") {
    console.error("Health check failed; aborting.");
    process.exit(2);
  }
  if (!/vgc-itsm1-mysql/i.test(health.json.dbLabel || "")) {
    console.error(`Refusing to run: dbLabel=${health.json.dbLabel} is not production.`);
    process.exit(2);
  }
  console.log(`Health OK — db=${health.json.dbLabel}`);
  console.log(`prodTestMode=${health.json.prodTestMode} emailRedirectMode=${health.json.emailRedirectMode}`);
  console.log("");

  // 2. Pre-state stats
  const stats = await req("GET", "/api/db-stats");
  const incBefore = stats.json?.collections?.incidents;
  const astBefore = stats.json?.collections?.assets;
  console.log(`Pre-state: incidents=${incBefore} assets=${astBefore}`);
  console.log("");

  // 3. Fetch + validate candidate incidents
  console.log(`--- Validating ${INCIDENT_IDS.length} incident candidates ---`);
  const incRecords = [];
  const incMissing = [];
  const incRejected = [];
  for (const id of INCIDENT_IDS) {
    const r = await fetchOne("incidents", id);
    if (r.status === 404) { incMissing.push(id); console.log(`  MISSING ${id}`); continue; }
    if (r.status !== 200) { incRejected.push({ id, reason: `HTTP ${r.status}` }); console.log(`  ERR     ${id} HTTP ${r.status}`); continue; }
    const rec = r.record || {};
    const blob = JSON.stringify(rec).toLowerCase();
    const hasMarker = REQUIRED_INCIDENT_MARKERS.some((m) => blob.includes(m.toLowerCase()));
    if (!hasMarker) {
      incRejected.push({ id, reason: "no test marker", record: rec });
      console.log(`  REJECT  ${id} (no test.com marker)`);
      continue;
    }
    if (id.startsWith("INC-ZD")) {
      incRejected.push({ id, reason: "Zendesk-linked id" });
      console.log(`  REJECT  ${id} (Zendesk-linked)`);
      continue;
    }
    incRecords.push(rec);
    console.log(`  OK      ${id}  src=${rec.source}  req=${rec.requesterEmail}  status=${rec.status}`);
  }
  console.log(`Incidents validated for purge: ${incRecords.length}`);
  console.log("");

  // 4. Fetch + validate candidate assets
  console.log(`--- Validating ${ASSET_IDS.length} asset candidates ---`);
  const astRecords = [];
  const astMissing = [];
  const astRejected = [];
  for (const id of ASSET_IDS) {
    const r = await fetchOne("assets", id);
    if (r.status === 404) { astMissing.push(id); console.log(`  MISSING ${id}`); continue; }
    if (r.status !== 200) { astRejected.push({ id, reason: `HTTP ${r.status}` }); console.log(`  ERR     ${id} HTTP ${r.status}`); continue; }
    const rec = r.record || {};
    if (rec.discoverySource !== REQUIRED_ASSET_MARKER) {
      astRejected.push({ id, reason: `discoverySource=${rec.discoverySource}` });
      console.log(`  REJECT  ${id} (discoverySource=${rec.discoverySource})`);
      continue;
    }
    astRecords.push(rec);
    console.log(`  OK      ${id}  name=${rec.name}  source=${rec.discoverySource}`);
  }
  console.log(`Assets validated for purge: ${astRecords.length}`);
  console.log("");

  // 5. Export evidence package
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(__dirname, "..", "app-logs", "cleanup");
  fs.mkdirSync(outDir, { recursive: true });
  const evidencePath = path.join(outDir, `prod-test-data-purge-${ts}.json`);
  const evidence = {
    exportedAt: new Date().toISOString(),
    target: BASE,
    health: health.json,
    preStateCounts: { incidents: incBefore, assets: astBefore },
    candidates: {
      incidents: { ids: INCIDENT_IDS, validated: incRecords, missing: incMissing, rejected: incRejected },
      assets:    { ids: ASSET_IDS,    validated: astRecords, missing: astMissing, rejected: astRejected },
    },
    rules: {
      incidentMarkers: REQUIRED_INCIDENT_MARKERS,
      assetMarker: REQUIRED_ASSET_MARKER,
      protected: ["INC-ZD*", "AST-*"],
    },
    evidenceSources: [
      "e2e-azure-test.cjs L640 (email ingest user@test.com)",
      "e2e-azure-test.cjs L708 (self-service enduser@test.com)",
      "e2e-azure-test.cjs L775 (CMDB discovery srv-e2e-001/002)",
    ],
  };
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`Evidence written: ${evidencePath}`);
  console.log("");

  if (!EXECUTE) {
    console.log("DRY-RUN complete. Re-run with --execute to perform deletes.");
    return;
  }

  // 6. Hard guards before destructive deletes
  if (incRejected.length > 0 || astRejected.length > 0) {
    console.error("Refusing to execute: at least one candidate failed validation.");
    process.exit(3);
  }
  if (incRecords.length === 0 && astRecords.length === 0) {
    console.log("Nothing to delete; done.");
    return;
  }

  // 7. Execute deletes
  console.log(`--- DELETING ${incRecords.length} incidents ---`);
  const deletedIncidents = [];
  for (const rec of incRecords) {
    const r = await req("DELETE", `/api/db/incidents/${encodeURIComponent(rec.id)}`);
    const ok = r.status === 200 && r.json?.ok === true;
    console.log(`  ${ok ? "DEL OK " : "DEL FAIL"} ${rec.id} HTTP ${r.status}`);
    if (ok) deletedIncidents.push(rec.id);
  }

  console.log(`--- DELETING ${astRecords.length} assets ---`);
  const deletedAssets = [];
  for (const rec of astRecords) {
    const r = await req("DELETE", `/api/db/assets/${encodeURIComponent(rec.id)}`);
    const ok = r.status === 200 && r.json?.ok === true;
    console.log(`  ${ok ? "DEL OK " : "DEL FAIL"} ${rec.id} HTTP ${r.status}`);
    if (ok) deletedAssets.push(rec.id);
  }

  // 8. Post-state verification
  const stats2 = await req("GET", "/api/db-stats");
  console.log("");
  console.log(`Post-state: incidents=${stats2.json?.collections?.incidents} assets=${stats2.json?.collections?.assets}`);
  console.log(`Deleted incidents: ${deletedIncidents.length}/${incRecords.length}`);
  console.log(`Deleted assets:    ${deletedAssets.length}/${astRecords.length}`);

  const resultPath = evidencePath.replace(/\.json$/, "-result.json");
  fs.writeFileSync(resultPath, JSON.stringify({
    executedAt: new Date().toISOString(),
    deletedIncidents, deletedAssets,
    postStateCounts: stats2.json?.collections,
  }, null, 2));
  console.log(`Result written: ${resultPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
