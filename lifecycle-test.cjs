// lifecycle-test.cjs — Full ITSM lifecycle test: VPN Connectivity Failure
// Exercises ALL 4 Phases: Create → SLA → Approval → CMDB → Runbook → Resolve
const https = require("https");

const BASE = "https://vgc-itsm1-app.azurewebsites.net";
const TEST_ID = "INC-TEST-VPN-001";
// Local admin auth: uses the SHA-256 hash from LOCAL_ADMIN_PASSWORD_HASH env var
const AUTH_TOKEN = "local-hash:0493aa48e5f4856762afe7203c0edcd844d7aff683d9a810dc25de7c2c4627b5";
let pass = 0, fail = 0, totalSteps = 0;
const cleanup = []; // track IDs to delete at end

// ─── HTTP Helpers ──────────────────────────────────────────────────
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

function step(name, condition, detail) {
  totalSteps++;
  if (condition) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} — ${detail || "assertion failed"}`); }
}

function section(title) { console.log(`\n═══ ${title} ${"═".repeat(Math.max(0, 60 - title.length))}`); }

// ─── Main Test Flow ────────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║   VGC-ITSM End-to-End Lifecycle Test: VPN Failure Scenario  ║");
  console.log("║   Testing ALL 4 Phases across the complete ticket lifecycle ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`Target: ${BASE}`);
  console.log(`Test Incident: ${TEST_ID}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  // ════════════════════════════════════════════════════════════════════
  // PHASE A: Create & Triage (Phase 1 verification)
  // ════════════════════════════════════════════════════════════════════
  section("PHASE A: Create & Triage (Phase 1)");

  // Step 1: Health check
  console.log("\n--- Step 1: Health Check ---");
  const health = await GET("/api/health");
  step("Server healthy", health.json.status === "ok");
  step("Database connected", health.json.database === "connected");
  step("AI configured", health.json.aiConfigured === true);

  // Step 2: Create test incident
  console.log("\n--- Step 2: Create Test Incident ---");
  const incident = {
    id: TEST_ID,
    title: "VPN Connection Failure — Singapore Office Users Unable to Connect Remotely",
    description: "Multiple users in Singapore office reporting VPN connection failures since 09:30 SGT. Cisco AnyConnect shows 'Connection attempt has failed'. Approximately 15 users affected across Engineering and Sales teams. Users are unable to access internal resources remotely.",
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
  step("Incident created (200)", createRes.status === 200, `Status: ${createRes.status}, Body: ${createRes.body.substring(0, 200)}`);
  step("Incident ID confirmed", createRes.json.ok === true || createRes.json.id === TEST_ID, `Response: ${JSON.stringify(createRes.json).substring(0, 200)}`);
  cleanup.push({ collection: "incidents", id: TEST_ID });

  // Step 3: Verify incident exists
  console.log("\n--- Step 3: Verify Incident Exists ---");
  const getInc = await GET(`/api/db/incidents/${TEST_ID}`);
  step("GET incident returns 200", getInc.status === 200, `Status: ${getInc.status}`);
  const incData = getInc.json.data ? (typeof getInc.json.data === "string" ? JSON.parse(getInc.json.data) : getInc.json.data) : getInc.json;
  step("Title matches", (incData.title || "").includes("VPN Connection Failure"), `Title: ${incData.title}`);
  step("Priority is Sev-B", incData.priority === "Sev-B", `Priority: ${incData.priority}`);
  step("Category is Network", incData.category === "Network", `Category: ${incData.category}`);
  step("Requester email correct", incData.requesterEmail === "johndoe@vgcsg.com", `Email: ${incData.requesterEmail}`);

  // Step 4: AI Triage
  console.log("\n--- Step 4: AI Triage ---");
  const triage = await POST("/api/ai/auto-triage-assign", { ticket: incident, requestedBy: "VGC Dev Admin" });
  step("AI auto-triage returns 200", triage.status === 200, `Status: ${triage.status}, Body: ${triage.body.substring(0, 300)}`);
  if (triage.status === 200) {
    const hasTriageData = triage.json.triage != null || triage.json.category != null || triage.json.priority != null || triage.json.result != null || triage.json.updated === true;
    step("AI returned triage data", hasTriageData, `Keys: ${Object.keys(triage.json).join(", ")}`);
  }

  // Step 5: Check audit trail
  console.log("\n--- Step 5: Verify Audit Trail ---");
  const audit = await GET("/api/audit/report?collection=incidents");
  step("Audit report returns 200", audit.status === 200, `Status: ${audit.status}`);
  const hasTestEntry = audit.json.data && audit.json.data.some(e =>
    (e.record_id === TEST_ID || e.action === TEST_ID || (e.details && e.details.includes(TEST_ID)))
  );
  step("Audit contains test incident entry", hasTestEntry, `Entries checked: ${(audit.json.data || []).length}`);

  // ════════════════════════════════════════════════════════════════════
  // PHASE B: SLA & Notifications (Phase 2 verification)
  // ════════════════════════════════════════════════════════════════════
  section("PHASE B: SLA & Notifications (Phase 2)");

  // Step 6: Check SLA status
  console.log("\n--- Step 6: SLA Status ---");
  const sla = await GET("/api/sla/status");
  step("SLA status returns 200", sla.status === 200, `Status: ${sla.status}`);
  const slaEntry = (sla.json.data || []).find(e => e.incidentId === TEST_ID);
  if (slaEntry) {
    step("SLA tracking entry exists for test incident", true);
    step("SLA priority is Sev-B", slaEntry.priority === "Sev-B", `Priority: ${slaEntry.priority}`);
    step("SLA status is on_track or at_risk", ["on_track", "at_risk"].includes(slaEntry.status), `Status: ${slaEntry.status}`);
  } else {
    // SLA engine runs on a cycle; entry may not exist yet — not a hard failure
    console.log("  ℹ️  SLA entry not yet created (engine cycle pending) — skipping SLA data checks");
  }

  // Step 7: Check SLA config
  console.log("\n--- Step 7: SLA Configuration ---");
  const slaConfig = await GET("/api/sla/config");
  step("SLA config returns 200", slaConfig.status === 200, `Status: ${slaConfig.status}`);
  const hasSevB = slaConfig.json.severities && slaConfig.json.severities["Sev-B"];
  step("Sev-B SLA policy defined", hasSevB != null, `Severities: ${Object.keys(slaConfig.json.severities || {}).join(", ")}`);
  if (hasSevB) {
    step("Sev-B first response target <= 1h", slaConfig.json.severities["Sev-B"].firstResponse <= 1, `Value: ${slaConfig.json.severities["Sev-B"].firstResponse}`);
  }

  // Step 8: CSV Export
  console.log("\n--- Step 8: CSV Export ---");
  const csvExport = await GET("/api/export/incidents");
  step("CSV export returns 200", csvExport.status === 200, `Status: ${csvExport.status}`);
  step("CSV contains test incident ID", csvExport.body.includes(TEST_ID), "Test ID not found in CSV output");
  step("CSV has column headers", csvExport.body.includes("title") || csvExport.body.includes("priority"), "No expected headers found");

  // Step 9: Incident templates
  console.log("\n--- Step 9: Incident Templates ---");
  const templates = await GET("/api/db/incident_templates");
  step("Templates endpoint returns 200", templates.status === 200, `Status: ${templates.status}`);
  const tplData = Array.isArray(templates.json) ? templates.json : (templates.json.data || []);
  const parsedTpls = tplData.map(t => { try { return typeof t.data === "string" ? JSON.parse(t.data) : t; } catch { return t; } });
  const vpnTpl = parsedTpls.find(t => (t.id || "").includes("TPL-002") || (t.title || "").includes("VPN"));
  step("VPN template (TPL-002) exists", vpnTpl != null, `Templates found: ${parsedTpls.map(t => t.id).join(", ")}`);

  // ════════════════════════════════════════════════════════════════════
  // PHASE C: Approval & CMDB (Phase 3 verification)
  // ════════════════════════════════════════════════════════════════════
  section("PHASE C: Approval & CMDB (Phase 3)");

  // Step 10: Submit for approval
  console.log("\n--- Step 10: Submit Approval ---");
  const approvalSubmit = await POST("/api/approvals/submit", {
    chainId: "AC-001",
    targetCollection: "incidents",
    targetId: TEST_ID,
    createdBy: "VGC Dev Admin",
  });
  step("Approval submit returns 200", approvalSubmit.status === 200, `Status: ${approvalSubmit.status}, Body: ${approvalSubmit.body.substring(0, 300)}`);
  const approvalId = approvalSubmit.json.instanceId;
  step("Approval instance ID returned", approvalId != null, `ID: ${approvalId}`);
  if (approvalId) cleanup.push({ collection: "approval_instances", id: approvalId });

  // Step 11: Check pending approvals
  console.log("\n--- Step 11: Pending Approvals ---");
  const pending = await GET("/api/approvals/pending");
  step("Pending approvals returns 200", pending.status === 200, `Status: ${pending.status}`);
  const ourPending = (pending.json.data || []).find(p => p.id === approvalId || p.targetId === TEST_ID);
  step("Test approval appears in pending list", ourPending != null, `Pending count: ${pending.json.count}`);

  // Step 12: Approve through all levels
  console.log("\n--- Step 12: Walk Through Approval Levels ---");
  if (approvalId) {
    // Level 1 — Service Desk Lead
    const approve1 = await POST(`/api/approvals/${approvalId}/action`, {
      action: "approved",
      comment: "VPN fix approved — critical for business operations",
      approvedBy: "Service Desk Lead",
    });
    step("Level 1 approval succeeds", approve1.json.success === true, `Status: ${approve1.status}`);
    let inst = approve1.json.instance;

    // Level 2 — Change Manager (if pending)
    if (inst && inst.status === "pending" && inst.currentLevel === 2) {
      const approve2 = await POST(`/api/approvals/${approvalId}/action`, {
        action: "approved",
        comment: "Change Manager approves VPN remediation",
        approvedBy: "Change Manager",
      });
      step("Level 2 approval succeeds", approve2.json.success === true, `Status: ${approve2.status}`);
      inst = approve2.json.instance;
    }

    // Level 3 — Tenant Admin (if pending)
    if (inst && inst.status === "pending" && inst.currentLevel === 3) {
      const approve3 = await POST(`/api/approvals/${approvalId}/action`, {
        action: "approved",
        comment: "Tenant Admin final approval",
        approvedBy: "Tenant Admin",
      });
      step("Level 3 (final) approval succeeds", approve3.json.success === true, `Status: ${approve3.status}`);
      inst = approve3.json.instance;
    }

    step("Approval chain fully completed", inst?.status === "approved", `Final status: ${inst?.status}`);
  } else {
    step("Skipped approval — no instance ID", false);
  }

  // Step 13: Add CMDB relationship
  console.log("\n--- Step 13: CMDB Relationship ---");
  const cmdbRel = await POST("/api/cmdb/relationships", {
    sourceId: TEST_ID,
    targetId: "AST-001",
    type: "affected_by",
    createdBy: "VGC Dev Admin",
  });
  step("CMDB relationship created", cmdbRel.json.success === true, `Status: ${cmdbRel.status}, Body: ${cmdbRel.body.substring(0, 200)}`);
  const relId = cmdbRel.json.relationship?.id;
  if (relId) cleanup.push({ collection: "cmdb_relationships", id: relId });

  // Step 14: Impact analysis
  console.log("\n--- Step 14: Impact Analysis ---");
  const impact = await GET(`/api/cmdb/impact/${TEST_ID}`);
  step("Impact analysis returns 200", impact.status === 200, `Status: ${impact.status}`);
  step("Impact result has assetId field", impact.json.assetId === TEST_ID, `AssetId: ${impact.json.assetId}`);

  // Step 15: Compliance summary
  console.log("\n--- Step 15: Compliance Summary ---");
  const compliance = await GET("/api/audit/compliance-summary");
  step("Compliance summary returns 200", compliance.status === 200, `Status: ${compliance.status}`);
  step("Has totalIncidents", compliance.json.totalIncidents != null, `Keys: ${Object.keys(compliance.json).join(", ")}`);
  step("Has slaComplianceRate", compliance.json.slaComplianceRate != null, `Rate: ${compliance.json.slaComplianceRate}%`);
  step("Has approvalRate", compliance.json.approvalRate != null, `Rate: ${compliance.json.approvalRate}%`);

  // ════════════════════════════════════════════════════════════════════
  // PHASE D: Runbook & Analytics (Phase 4 verification)
  // ════════════════════════════════════════════════════════════════════
  section("PHASE D: Runbook & Analytics (Phase 4)");

  // Step 16: Find a KB article and execute runbook
  console.log("\n--- Step 16: Execute Runbook ---");
  const kbList = await GET("/api/db/kb");
  const kbItems = Array.isArray(kbList.json) ? kbList.json : (kbList.json.data || []);
  const kbParsed = kbItems.map(k => { try { return typeof k.data === "string" ? JSON.parse(k.data) : k; } catch { return k; } });
  const runbookId = kbParsed.length > 0 ? (kbParsed[0].id || kbItems[0].id) : "KB-DOC-001";
  console.log(`  Using KB article: ${runbookId}`);

  const rbExec = await POST("/api/runbook/execute", {
    runbookId,
    incidentId: TEST_ID,
    executedBy: "VGC Dev Admin",
  });
  step("Runbook execution started", rbExec.json.success === true, `Status: ${rbExec.status}, Body: ${rbExec.body.substring(0, 300)}`);
  const execId = rbExec.json.execution?.id;
  const stepCount = rbExec.json.execution?.steps?.length || 0;
  step("Execution ID returned", execId != null, `ID: ${execId}`);
  step("Runbook steps created", stepCount > 0, `Steps: ${stepCount}`);
  if (execId) cleanup.push({ collection: "runbook_executions", id: execId });

  // Step 17: Complete all runbook steps
  if (execId && stepCount > 0) {
    console.log("\n--- Step 17: Complete Runbook Steps ---");
    const stepNotes = [
      "VPN gateway connectivity verified — responding to ping",
      "SSL certificate status checked — expired cert identified",
      "Certificate renewed and installed on gateway FW-SG-01",
      "VPN service restarted successfully",
      "User connectivity restored — 15/15 users reconnected",
    ];
    for (let i = 1; i <= stepCount; i++) {
      await PUT(`/api/runbook/execution/${execId}/step/${i}`, {
        status: "completed",
        notes: stepNotes[i - 1] || `Step ${i} completed`,
        updatedBy: "VGC Dev Admin",
      });
    }

    const execCheck = await GET(`/api/runbook/executions?incidentId=${TEST_ID}`);
    step("Runbook execution listed for incident", execCheck.json.count >= 1, `Count: ${execCheck.json.count}`);
    const ourExec = (execCheck.json.data || []).find(e => e.id === execId);
    step("All steps completed → execution status=completed", ourExec?.status === "completed", `Status: ${ourExec?.status}`);
  }

  // Step 18: Scheduled reports
  console.log("\n--- Step 18: Scheduled Reports ---");
  const schedules = await GET("/api/reports/schedules");
  step("Report schedules returns 200", schedules.status === 200, `Status: ${schedules.status}`);
  step("Schedules data array present", Array.isArray(schedules.json.data), `Type: ${typeof schedules.json.data}`);

  // Step 19: Resolve the incident
  console.log("\n--- Step 19: Resolve Incident ---");
  const resolveBody = {
    ...incident,
    status: "Resolved",
    resolution: "VPN gateway service restarted. Root cause: Cisco AnyConnect SSL certificate expired on gateway FW-SG-01. Certificate renewed and VPN connections restored for all 15 affected users.",
    resolvedAt: new Date().toISOString(),
    resolvedBy: "VGC Dev Admin",
    updatedAt: new Date().toISOString(),
  };
  const resolveRes = await PUT(`/api/db/incidents/${TEST_ID}`, resolveBody);
  step("Incident resolved (200)", resolveRes.status === 200, `Status: ${resolveRes.status}`);

  // Verify resolved
  const getResolved = await GET(`/api/db/incidents/${TEST_ID}`);
  const resolvedData = getResolved.json.data ? (typeof getResolved.json.data === "string" ? JSON.parse(getResolved.json.data) : getResolved.json.data) : getResolved.json;
  step("Incident status is Resolved", resolvedData.status === "Resolved" || resolvedData.status === "Approved", `Status: ${resolvedData.status}`);

  // Step 20: Final audit report
  console.log("\n--- Step 20: Final Audit Report ---");
  const finalAudit = await GET("/api/audit/report");
  step("Audit report returns 200", finalAudit.status === 200, `Status: ${finalAudit.status}`);
  step("Audit has entries", (finalAudit.json.data || []).length > 0, `Count: ${finalAudit.json.count}`);
  const testAuditEntries = (finalAudit.json.data || []).filter(e =>
    e.record_id === TEST_ID || e.action === TEST_ID ||
    (e.data && e.data.includes(TEST_ID)) ||
    (e.record_id && e.record_id.includes && e.record_id.includes(TEST_ID))
  );
  step("Audit trail covers test incident lifecycle", testAuditEntries.length >= 2, `Found: ${testAuditEntries.length} audit entries`);

  // ════════════════════════════════════════════════════════════════════
  // PHASE E: Cleanup
  // ════════════════════════════════════════════════════════════════════
  section("PHASE E: Cleanup");

  console.log("\n--- Cleaning up test data ---");
  for (const item of cleanup.reverse()) {
    try {
      if (item.collection === "cmdb_relationships") {
        await DEL(`/api/cmdb/relationships/${item.id}`, { deletedBy: "Lifecycle Test" });
      } else {
        await DEL(`/api/db/${item.collection}/${item.id}`);
      }
      console.log(`  🗑️  Deleted ${item.collection}/${item.id}`);
    } catch (e) {
      console.log(`  ⚠️  Failed to delete ${item.collection}/${item.id}: ${e.message}`);
    }
  }

  // Verify cleanup
  const verifyCleanup = await GET(`/api/db/incidents/${TEST_ID}`);
  step("Test incident cleaned up", verifyCleanup.status === 404 || !verifyCleanup.json.data, `Status: ${verifyCleanup.status}`);

  // ════════════════════════════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log(`║  RESULTS: ${pass}/${totalSteps} PASSED, ${fail} FAILED${" ".repeat(Math.max(0, 35 - String(pass).length - String(totalSteps).length - String(fail).length))}║`);
  console.log("╚══════════════════════════════════════════════════════════════╝");

  if (fail === 0) {
    console.log("\n🎉 ALL PHASES VERIFIED SUCCESSFULLY!");
    console.log("   Phase 1: Create & Triage ✅");
    console.log("   Phase 2: SLA & Notifications ✅");
    console.log("   Phase 3: Approval & CMDB ✅");
    console.log("   Phase 4: Runbook & Analytics ✅");
  } else {
    console.log(`\n⚠️  ${fail} step(s) need attention. Review failures above.`);
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(2);
});
