// live-demo.cjs — LIVE browser demo of full ITSM lifecycle
// Runs slowly with pauses so you can watch each step in the UI
const https = require("https");
const readline = require("readline");

const BASE = "https://vgc-itsm1-app.azurewebsites.net";
const TEST_ID = "INC-DEMO-VPN-" + Date.now().toString(36).toUpperCase();
const AUTH_TOKEN = "local-hash:0493aa48e5f4856762afe7203c0edcd844d7aff683d9a810dc25de7c2c4627b5";
const cleanup = [];

// ─── Helpers ───────────────────────────────────────────────────────
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${path}`);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname, port: 443,
      path: url.pathname + url.search, method,
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${AUTH_TOKEN}` },
    };
    if (data) opts.headers["Content-Length"] = Buffer.byteLength(data);
    const req = https.request(opts, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        let json = {};
        try { json = JSON.parse(buf); } catch {}
        resolve({ status: res.statusCode, json, body: buf });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
const GET = (p) => request("GET", p);
const POST = (p, b) => request("POST", p, b);
const PUT = (p, b) => request("PUT", p, b);
const DEL = (p, b) => request("DELETE", p, b || {});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function waitForEnter(msg) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(msg || "\n  ⏸️  Press ENTER to continue...", () => { rl.close(); resolve(); });
  });
}

function banner(text) {
  const line = "═".repeat(64);
  console.log(`\n\x1b[36m${line}\x1b[0m`);
  console.log(`\x1b[1;36m  ${text}\x1b[0m`);
  console.log(`\x1b[36m${line}\x1b[0m`);
}

function info(text) { console.log(`\x1b[33m  → ${text}\x1b[0m`); }
function ok(text)   { console.log(`\x1b[32m  ✅ ${text}\x1b[0m`); }
function look(text) { console.log(`\x1b[1;35m  👀 ${text}\x1b[0m`); }

// ─── Main Demo ─────────────────────────────────────────────────────
async function main() {
  console.log("\x1b[1;37m");
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║     🖥️  VGC-ITSM LIVE DEMO — VPN Connectivity Failure          ║");
  console.log("║     Watch each step happen in the browser in real time!         ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log("\x1b[0m");
  console.log(`  Test Incident ID: \x1b[1;33m${TEST_ID}\x1b[0m`);
  console.log(`  Target: ${BASE}`);
  console.log(`  Time: ${new Date().toISOString()}\n`);
  
  look("Open the ITSM dashboard in your browser (demo mode — no production data):");
  console.log(`  \x1b[4;34m${BASE}?demo=true\x1b[0m\n`);
  
  await waitForEnter("  ⏸️  Press ENTER when browser is ready...");

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 1: Create & Triage
  // ═══════════════════════════════════════════════════════════════════
  banner("PHASE 1: INCIDENT CREATION & AI TRIAGE");

  // Step 1: Create Incident
  console.log("\n  📝 Step 1: Creating VPN Failure Incident...\n");
  const incident = {
    id: TEST_ID,
    title: "VPN Connection Failure — Singapore Office (LIVE DEMO)",
    description: "Multiple users in Singapore office reporting VPN connection failures since 09:30 SGT. Cisco AnyConnect shows 'Connection attempt has failed'. Approximately 15 users affected across Engineering and Sales teams.",
    priority: "Sev-B",
    status: "Open",
    category: "Network",
    subcategory: "VPN",
    requesterEmail: "johndoe@vgcsg.com",
    requesterName: "John Doe",
    customer: "VGC Technology",
    assignmentGroup: "Network Team",
    source: "Self-Service Portal",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const createRes = await PUT(`/api/db/incidents/${TEST_ID}`, incident);
  ok(`Incident ${TEST_ID} created (${createRes.status})`);
  info(`Title: "${incident.title}"`);
  info(`Priority: ${incident.priority} | Category: ${incident.category} | Status: ${incident.status}`);
  cleanup.push({ collection: "incidents", id: TEST_ID });

  await sleep(1500);
  look("BROWSER: Click 'Incidents' tab → you should see the new VPN incident in the list!");
  await waitForEnter();

  // Step 2: AI Triage
  console.log("\n  🤖 Step 2: Running AI Auto-Triage & Assignment...\n");
  const triage = await POST("/api/ai/auto-triage-assign", { ticket: incident, requestedBy: "VGC Dev Admin" });
  if (triage.status === 200) {
    ok("AI triage completed successfully!");
    if (triage.json.triage) {
      info(`AI Category: ${triage.json.triage.category || "—"}`);
      info(`AI Priority: ${triage.json.triage.priority || "—"}`);
      info(`AI Assignment: ${triage.json.triage.assignmentGroup || "—"}`);
    }
    if (triage.json.summary) info(`AI Summary: ${triage.json.summary.substring(0, 100)}...`);
  } else {
    console.log(`  ⚠️  AI triage returned ${triage.status}`);
  }

  await sleep(1500);
  look("BROWSER: Click the incident → see AI triage results in the details panel!");
  await waitForEnter();

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2: SLA & MONITORING
  // ═══════════════════════════════════════════════════════════════════
  banner("PHASE 2: SLA TRACKING & MONITORING");

  // Step 3: SLA Status
  console.log("\n  ⏱️  Step 3: Checking SLA configuration for Sev-B...\n");
  const slaConfig = await GET("/api/sla/config");
  if (slaConfig.json.severities?.["Sev-B"]) {
    const sevB = slaConfig.json.severities["Sev-B"];
    ok("SLA Policy loaded for Sev-B:");
    info(`First Response Target: ${sevB.firstResponse}h`);
    info(`Resolution Target: ${sevB.resolution}h`);
  }

  const sla = await GET("/api/sla/status");
  const slaEntry = (sla.json.data || []).find(e => e.incidentId === TEST_ID);
  if (slaEntry) {
    ok(`SLA tracking active — Status: ${slaEntry.status}`);
  } else {
    info("SLA engine cycle pending — entry will appear on next cycle");
  }

  await sleep(1500);
  look("BROWSER: Click 'SLA Dashboard' tab → view SLA policies and status!");
  await waitForEnter();

  // Step 4: CSV Export
  console.log("\n  📊 Step 4: Exporting incident data...\n");
  const csv = await GET("/api/export/incidents");
  ok(`CSV export available (${csv.body.split("\n").length} rows)`);
  info("Includes test incident in export data");

  await sleep(1000);
  look("BROWSER: Try the 'Export CSV' button in the Incidents tab!");
  await waitForEnter();

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 3: APPROVAL & CMDB
  // ═══════════════════════════════════════════════════════════════════
  banner("PHASE 3: APPROVAL WORKFLOW & CMDB");

  // Step 5: Submit for Approval
  console.log("\n  📋 Step 5: Submitting incident for approval (Chain AC-001)...\n");
  const approvalSubmit = await POST("/api/approvals/submit", {
    chainId: "AC-001",
    targetCollection: "incidents",
    targetId: TEST_ID,
    createdBy: "VGC Dev Admin",
  });
  const approvalId = approvalSubmit.json.instanceId;
  ok(`Approval submitted — Instance: ${approvalId}`);
  info("Chain AC-001: Service Desk Lead → Change Manager");
  if (approvalId) cleanup.push({ collection: "approval_instances", id: approvalId });

  await sleep(1500);
  look("BROWSER: Click 'Approvals' tab → see pending approval for the VPN incident!");
  await waitForEnter();

  // Step 6: Approve Level 1
  console.log("\n  ✍️  Step 6: Level 1 Approval — Service Desk Lead...\n");
  await sleep(1000);
  if (approvalId) {
    const approve1 = await POST(`/api/approvals/${approvalId}/action`, {
      action: "approved",
      comment: "VPN fix approved — critical for business operations",
      approvedBy: "Service Desk Lead",
    });
    ok("Level 1 APPROVED by Service Desk Lead");
    info(`Comment: "VPN fix approved — critical for business operations"`);
    let inst = approve1.json.instance;

    await sleep(1500);
    look("BROWSER: Refresh → approval status changed to Level 2!");
    await waitForEnter();

    // Step 7: Approve Level 2
    if (inst && inst.status === "pending" && inst.currentLevel === 2) {
      console.log("\n  ✍️  Step 7: Level 2 Approval — Change Manager...\n");
      await sleep(1000);
      const approve2 = await POST(`/api/approvals/${approvalId}/action`, {
        action: "approved",
        comment: "Change Manager approves VPN remediation",
        approvedBy: "Change Manager",
      });
      ok("Level 2 APPROVED by Change Manager");
      inst = approve2.json.instance;
    }

    if (inst && inst.status === "pending" && inst.currentLevel === 3) {
      console.log("\n  ✍️  Step 7b: Level 3 Approval — Tenant Admin...\n");
      const approve3 = await POST(`/api/approvals/${approvalId}/action`, {
        action: "approved",
        comment: "Tenant Admin final approval",
        approvedBy: "Tenant Admin",
      });
      ok("Level 3 APPROVED by Tenant Admin");
      inst = approve3.json.instance;
    }

    ok(`Approval chain COMPLETED — Final status: ${inst?.status?.toUpperCase()}`);
    await sleep(1000);
    look("BROWSER: Refresh → approval is now fully APPROVED!");
    await waitForEnter();
  }

  // Step 8: CMDB Relationship
  console.log("\n  🔗 Step 8: Creating CMDB relationship...\n");
  const cmdbRel = await POST("/api/cmdb/relationships", {
    sourceId: TEST_ID,
    targetId: "AST-001",
    type: "affected_by",
    createdBy: "VGC Dev Admin",
  });
  ok("CMDB relationship created");
  info(`${TEST_ID} ──affected_by──▶ AST-001`);
  const relId = cmdbRel.json.relationship?.id;
  if (relId) cleanup.push({ collection: "cmdb_relationships", id: relId });

  // Step 9: Impact Analysis
  console.log("\n  💥 Step 9: Running impact analysis...\n");
  const impact = await GET(`/api/cmdb/impact/${TEST_ID}`);
  ok("Impact analysis completed");
  info(`Asset: ${impact.json.assetId || TEST_ID}`);
  info(`Relationships found: ${impact.json.relationships?.length || 0}`);

  await sleep(1500);
  look("BROWSER: Click 'CMDB' tab → see the relationship and impact analysis!");
  await waitForEnter();

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 4: RUNBOOK & RESOLUTION
  // ═══════════════════════════════════════════════════════════════════
  banner("PHASE 4: RUNBOOK EXECUTION & RESOLUTION");

  // Step 10: Execute Runbook
  console.log("\n  📖 Step 10: Finding KB article and executing runbook...\n");
  const kbList = await GET("/api/db/kb");
  const kbItems = Array.isArray(kbList.json) ? kbList.json : (kbList.json.data || []);
  const kbParsed = kbItems.map(k => { try { return typeof k.data === "string" ? JSON.parse(k.data) : k; } catch { return k; } });
  const runbookId = kbParsed.length > 0 ? (kbParsed[0].id || kbItems[0].id) : "KB-DOC-001";
  info(`KB Article: ${runbookId}`);

  const rbExec = await POST("/api/runbook/execute", {
    runbookId,
    incidentId: TEST_ID,
    executedBy: "VGC Dev Admin",
  });
  const execId = rbExec.json.execution?.id;
  const stepCount = rbExec.json.execution?.steps?.length || 0;
  ok(`Runbook started — Execution: ${execId} (${stepCount} steps)`);
  if (execId) cleanup.push({ collection: "runbook_executions", id: execId });

  await sleep(1500);
  look("BROWSER: Click 'Runbook' tab → see the execution in progress!");
  await waitForEnter();

  // Step 11: Complete runbook steps one by one
  if (execId && stepCount > 0) {
    console.log("\n  🔧 Step 11: Completing runbook steps one-by-one...\n");
    const stepNotes = [
      "VPN gateway connectivity verified — responding to ping",
      "SSL certificate status checked — expired cert identified",
      "Certificate renewed and installed on gateway FW-SG-01",
      "VPN service restarted successfully",
      "User connectivity restored — 15/15 users reconnected",
    ];
    for (let i = 1; i <= stepCount; i++) {
      await sleep(1200);
      await PUT(`/api/runbook/execution/${execId}/step/${i}`, {
        status: "completed",
        notes: stepNotes[i - 1] || `Step ${i} completed`,
        updatedBy: "VGC Dev Admin",
      });
      ok(`Step ${i}/${stepCount}: ${stepNotes[i - 1] || "Completed"}`);
    }
    ok("All runbook steps completed!");

    await sleep(1000);
    look("BROWSER: Refresh → runbook execution shows all steps COMPLETED!");
    await waitForEnter();
  }

  // Step 12: Resolve Incident
  console.log("\n  🎯 Step 12: Resolving the incident...\n");
  await sleep(1000);
  const resolveBody = {
    ...incident,
    status: "Resolved",
    resolution: "VPN gateway service restarted. Root cause: Cisco AnyConnect SSL certificate expired on gateway FW-SG-01. Certificate renewed and VPN connections restored for all 15 affected users.",
    resolvedAt: new Date().toISOString(),
    resolvedBy: "VGC Dev Admin",
    updatedAt: new Date().toISOString(),
  };
  await PUT(`/api/db/incidents/${TEST_ID}`, resolveBody);
  ok("Incident RESOLVED!");
  info("Root cause: Expired SSL certificate on VPN gateway FW-SG-01");
  info("Resolution: Certificate renewed, VPN connections restored for 15 users");

  await sleep(1500);
  look("BROWSER: Click 'Incidents' → incident status is now 'Resolved'!");
  await waitForEnter();

  // Step 13: Compliance & Audit
  console.log("\n  📈 Step 13: Final compliance & audit check...\n");
  const compliance = await GET("/api/audit/compliance-summary");
  ok("Compliance Summary:");
  info(`Total Incidents: ${compliance.json.totalIncidents}`);
  info(`SLA Compliance Rate: ${compliance.json.slaComplianceRate}%`);
  info(`Approval Rate: ${compliance.json.approvalRate}%`);

  const audit = await GET("/api/audit/report");
  const testEntries = (audit.json.data || []).filter(e =>
    e.record_id === TEST_ID || e.action === TEST_ID ||
    (e.data && e.data.includes(TEST_ID))
  );
  ok(`Audit trail: ${testEntries.length} entries for this incident`);

  await sleep(1000);
  look("BROWSER: Check 'Audit Log' & 'Reports' tabs for full compliance data!");
  await waitForEnter();

  // ═══════════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════════
  banner("DEMO COMPLETE — CLEANUP");
  console.log("\n  🧹 Cleaning up demo data...\n");
  
  for (const item of cleanup.reverse()) {
    try {
      if (item.collection === "cmdb_relationships") {
        await DEL(`/api/cmdb/relationships/${item.id}`, { deletedBy: "Live Demo" });
      } else {
        await DEL(`/api/db/${item.collection}/${item.id}`);
      }
      ok(`Deleted ${item.collection}/${item.id}`);
    } catch (e) {
      console.log(`  ⚠️  Failed: ${item.collection}/${item.id}`);
    }
  }

  console.log("\n\x1b[1;32m" + "═".repeat(64));
  console.log("  🎉 LIVE DEMO COMPLETE — ALL 4 PHASES DEMONSTRATED!");
  console.log("═".repeat(64) + "\x1b[0m\n");
  console.log("  Phase 1: Incident Creation & AI Triage     ✅");
  console.log("  Phase 2: SLA Tracking & Monitoring          ✅");
  console.log("  Phase 3: Approval Workflow & CMDB            ✅");
  console.log("  Phase 4: Runbook Execution & Resolution      ✅\n");
}

main().catch(err => { console.error("Demo error:", err); process.exit(1); });
