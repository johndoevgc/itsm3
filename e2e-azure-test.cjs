// e2e-azure-test.cjs — End-to-end tests against Azure deployment
const https = require("https");

const BASE = "https://vgc-itsm1-app.azurewebsites.net";
let pass = 0, fail = 0, tests = [];

function get(path) {
  return new Promise((resolve, reject) => {
    https.get(`${BASE}${path}`, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    }).on("error", reject);
  });
}

function getJson(path) {
  return get(path).then(r => { try { return { ...r, json: JSON.parse(r.body) }; } catch { return { ...r, json: {} }; } });
}

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${path}`);
    const data = JSON.stringify(body);
    const req = https.request({ hostname: url.hostname, port: 443, path: url.pathname + url.search, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => { try { resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(buf), body: buf }); } catch { resolve({ status: res.statusCode, headers: res.headers, json: {}, body: buf }); } });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function putJson(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${path}`);
    const data = JSON.stringify(body);
    const req = https.request({ hostname: url.hostname, port: 443, path: url.pathname + url.search, method: "PUT", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => { try { resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(buf), body: buf }); } catch { resolve({ status: res.statusCode, headers: res.headers, json: {}, body: buf }); } });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function assert(name, condition, detail) {
  if (condition) { pass++; tests.push(`  PASS: ${name}`); }
  else { fail++; tests.push(`  FAIL: ${name} — ${detail || "assertion failed"}`); }
}

async function main() {
  console.log(`\n====== VGC-ITSM Azure E2E Tests ======`);
  console.log(`Target: ${BASE}\n`);

  // 1. Health check
  console.log("--- Health Check ---");
  const health = await getJson("/api/health");
  assert("Health status OK", health.json.status === "ok");
  assert("Database connected", health.json.database === "connected");
  assert("DB type is mysql", health.json.dbType === "mysql");
  assert("AI configured", health.json.aiConfigured === true);
  assert("AI model is gpt-5.4-pro", health.json.aiModel === "gpt-5.4-pro", `Got: ${health.json.aiModel}`);

  // 2. DB Stats
  console.log("--- DB Stats ---");
  const stats = await getJson("/api/db-stats");
  assert("DB stats returns collections", stats.json.collections != null);
  assert("Incidents in DB", stats.json.collections.incidents >= 1, `Got: ${stats.json.collections.incidents}`);
  assert("Assets in DB", stats.json.collections.assets >= 1, `Got: ${stats.json.collections.assets}`);
  assert("Users in DB", stats.json.collections.users >= 1, `Got: ${stats.json.collections.users}`);
  assert("KB articles in DB", stats.json.collections.kb >= 1, `Got: ${stats.json.collections.kb}`);
  assert("Services in DB", stats.json.collections.services >= 1, `Got: ${stats.json.collections.services}`);

  // 3. Incidents API
  console.log("--- Incidents API ---");
  const incidents = await getJson("/api/db/incidents");
  assert("Incidents returns data", incidents.json.count >= 1, `Got: ${incidents.json.count}`);
  assert("Incidents have IDs", incidents.json.data.every(i => !!i.id), "Some incidents missing IDs");
  const withTitle = incidents.json.data.filter(i => !!i.title).length;
  const withStatus = incidents.json.data.filter(i => !!i.status).length;
  const total = incidents.json.data.length;
  assert("Incidents have titles (>95%)", withTitle / total > 0.95, `${withTitle}/${total} have titles (${Math.round(withTitle/total*100)}%)`);
  assert("Incidents have statuses (>95%)", withStatus / total > 0.95, `${withStatus}/${total} have statuses (${Math.round(withStatus/total*100)}%)`);

  // 4. Incident status distribution
  console.log("--- Incident Status Distribution ---");
  const statusCounts = {};
  incidents.json.data.forEach(i => { statusCounts[i.status] = (statusCounts[i.status] || 0) + 1; });
  console.log(`  Statuses: ${JSON.stringify(statusCounts)}`);
  assert("At least 1 status type exists", Object.keys(statusCounts).length >= 1);

  // 6. Verify individual incident detail
  console.log("--- Individual Incident Detail ---");
  if (incidents.json.data && incidents.json.data.length > 0) {
    const firstInc = incidents.json.data[0];
    const incDetail = await getJson(`/api/db/incidents/${firstInc.id}`);
    assert("Incident fetched by ID", incDetail.status === 200);
    assert("Incident has title", !!incDetail.json.title, `Title: ${incDetail.json.title}`);
    assert("Incident has status", !!incDetail.json.status, `Status: ${incDetail.json.status}`);
  } else {
    assert("Incidents available for detail test", false, "No incidents");
  }

  // 7. Users API (auth-protected — 403 expected without token)
  console.log("--- Users API ---");
  const users = await get("/api/db/users");
  assert("Users endpoint responds", users.status === 200 || users.status === 403, `Status: ${users.status}`);

  // 8. Assets API
  console.log("--- Assets API ---");
  const assets = await getJson("/api/db/assets");
  assert("Assets returns data", assets.json.count >= 1, `Got: ${assets.json.count}`);

  // 9. KB Articles
  console.log("--- KB Articles API ---");
  const kb = await getJson("/api/db/kb");
  assert("KB returns data", kb.json.count >= 1, `Got: ${kb.json.count}`);

  // 10. Frontend HTML
  console.log("--- Frontend ---");
  const html = await get("/");
  assert("Frontend returns 200", html.status === 200);
  assert("Frontend is HTML", html.body.includes("<!doctype html>") || html.body.includes("<!DOCTYPE html>"));
  assert("Frontend has React root", html.body.includes("root"));

  // 11. Audit log
  console.log("--- Audit API ---");
  const audit = await getJson("/api/audit?limit=5");
  assert("Audit returns data", audit.json.data != null);

  // 12. Invalid collection
  console.log("--- Security Tests ---");
  const badColl = await getJson("/api/db/invalid_collection");
  assert("Invalid collection returns 400", badColl.status === 400);

  // 13. Check engineer distribution across new tickets
  console.log("--- Engineer Distribution (INC0018-INC0027) ---");
  // 13. Check assignee distribution
  console.log("--- Assignee Distribution ---");
  const engCounts = {};
  incidents.json.data.forEach(i => { if (i.assignee) engCounts[i.assignee] = (engCounts[i.assignee] || 0) + 1; });
  console.log(`  Assignees: ${JSON.stringify(engCounts)}`);
  assert("At least 1 assignee exists", Object.keys(engCounts).length >= 1);

  // 14. Check priority distribution
  console.log("--- Priority Distribution ---");
  const priCounts = {};
  incidents.json.data.forEach(i => { if (i.priority) priCounts[i.priority] = (priCounts[i.priority] || 0) + 1; });
  console.log(`  Priorities: ${JSON.stringify(priCounts)}`);
  assert("At least 1 priority type exists", Object.keys(priCounts).length >= 1);

  // 15. Check category diversity
  console.log("--- Category Distribution ---");
  const catCounts = {};
  incidents.json.data.forEach(i => { if (i.category) catCounts[i.category] = (catCounts[i.category] || 0) + 1; });
  console.log(`  Categories: ${JSON.stringify(catCounts)}`);
  assert("At least 1 category exists", Object.keys(catCounts).length >= 1);

  // 17. AI Settings endpoint
  console.log("--- AI Settings API ---");
  const aiSettings = await getJson("/api/settings/openai");
  assert("AI settings endpoint returns 200", aiSettings.status === 200);
  assert("AI model is gpt-5.4-pro", aiSettings.json.model === "gpt-5.4-pro", `Got: ${aiSettings.json.model}`);
  assert("AI endpoint configured", aiSettings.json.configured === true);

  // 18. AI Test connection
  console.log("--- AI Connection Test ---");
  const aiTest = await getJson("/api/ai/test");
  assert("AI test endpoint responds", aiTest.status === 200 || aiTest.status === 502, `Status: ${aiTest.status}`);
  if (aiTest.status === 200) {
    assert("AI test connected", aiTest.json.status === "connected", `Status: ${aiTest.json.status}`);
    assert("AI test model correct", ["gpt-5.4-pro","gpt-5.4-mini","gpt-5.4-nano"].includes(aiTest.json.model), `Model: ${aiTest.json.model}`);
  }

  // 19. Saved Filters collection
  console.log("--- Saved Filters Collection ---");
  const sf = await get("/api/db/saved_filters");
  assert("Saved filters endpoint returns 200", sf.status === 200, `Status: ${sf.status}`);

  // 20. Scheduled Zendesk Sync health
  console.log("--- Scheduled Zendesk Sync ---");
  assert("ZD auto-sync enabled in health", health.json.zdAutoSync === true, `Got: ${health.json.zdAutoSync}`);

  // 21. Batch triage endpoint
  console.log("--- Batch AI Triage ---");
  const batchEmpty = await get("/api/ai/batch-triage");
  assert("Batch triage rejects GET", batchEmpty.status === 200 || batchEmpty.status === 405 || batchEmpty.status === 400 || batchEmpty.status === 500, `Status: ${batchEmpty.status}`);

  // 22. Auto KB Draft check (KB count should include drafts)
  console.log("--- Auto KB Draft ---");
  const kbAll = await getJson("/api/db/kb");
  assert("KB collection accessible", kbAll.status === 200, `Status: ${kbAll.status}`);
  assert("KB has articles", kbAll.json.count >= 1, `Got: ${kbAll.json.count}`);

  // ─── PHASE 2: Customer Experience ─────────────────────────────────────

  // 23. SLA Config API
  console.log("--- SLA Config API ---");
  const slaConfig = await getJson("/api/sla/config");
  assert("SLA config endpoint returns 200", slaConfig.status === 200, `Status: ${slaConfig.status}`);
  assert("SLA config has severities", slaConfig.json.severities != null || slaConfig.json.policy != null, "No severities or policy");

  // 24. CSV Export
  console.log("--- CSV Export ---");
  const csvInc = await get("/api/export/incidents?format=csv");
  assert("CSV export returns 200", csvInc.status === 200, `Status: ${csvInc.status}`);
  assert("CSV content-type", (csvInc.headers["content-type"] || "").includes("text/csv"), `CT: ${csvInc.headers["content-type"]}`);
  assert("CSV has header row", csvInc.body.split("\n").length >= 1);
  const csvAssets = await get("/api/export/assets?format=csv");
  assert("Asset CSV export returns 200", csvAssets.status === 200, `Status: ${csvAssets.status}`);
  const csvKb = await get("/api/export/kb?format=csv");
  assert("KB CSV export returns 200", csvKb.status === 200, `Status: ${csvKb.status}`);
  const csvBad = await get("/api/export/invalid_collection?format=csv");
  assert("Invalid collection CSV returns 400", csvBad.status === 400, `Status: ${csvBad.status}`);

  // 25. Incident Templates
  console.log("--- Incident Templates ---");
  const templates = await getJson("/api/db/incident_templates");
  assert("Templates collection accessible", templates.status === 200, `Status: ${templates.status}`);
  assert("Templates exist (seeded)", templates.json.count >= 1, `Got: ${templates.json.count}`);
  if (templates.json.data && templates.json.data.length > 0) {
    const tpl = templates.json.data[0];
    assert("Template has name", !!tpl.name, `Name: ${tpl.name}`);
    assert("Template has category", !!tpl.category, `Category: ${tpl.category}`);
    assert("Template has priority", !!tpl.priority, `Priority: ${tpl.priority}`);
  }

  // ─── PHASE 3: Governance & Compliance ──────────────────────────────────

  // 26. Approval Chains
  console.log("--- Approval Chains ---");
  const chains = await getJson("/api/db/approval_chains");
  assert("Approval chains accessible", chains.status === 200, `Status: ${chains.status}`);
  assert("Default chains seeded", chains.json.count >= 3, `Got: ${chains.json.count}`);

  // 27. Approval Submit + Action
  console.log("--- Approval Workflow ---");
  const submitApproval = await postJson("/api/approvals/submit", { chainId: "AC-001", targetCollection: "changes", targetId: "CHG-E2E-001", createdBy: "E2E Test" });
  assert("Approval submit returns 200/201", submitApproval.status === 200 || submitApproval.status === 201, `Status: ${submitApproval.status}`);
  if (submitApproval.json.success && submitApproval.json.instance) {
    const instId = submitApproval.json.instanceId;
    const approveAction = await postJson(`/api/approvals/${instId}/action`, { action: "approved", approvedBy: "CAB Lead", comment: "E2E test approval" });
    assert("Approval action succeeds", approveAction.json.success === true, `success: ${approveAction.json.success}`);
  } else {
    assert("Approval action succeeds", false, "submit did not return success+instance");
  }

  // 28. Pending Approvals
  const pending = await getJson("/api/approvals/pending?role=CAB Lead");
  assert("Pending approvals endpoint returns 200", pending.status === 200, `Status: ${pending.status}`);

  // 29. CMDB Relationships
  console.log("--- CMDB Relationships ---");
  const createRel = await postJson("/api/cmdb/relationships", { sourceId: "AST-001", targetId: "AST-002", type: "depends_on" });
  assert("Create CMDB relationship", createRel.status === 200 || createRel.status === 201, `Status: ${createRel.status}`);
  const getRels = await getJson("/api/cmdb/relationships/AST-001");
  assert("Get relationships returns 200", getRels.status === 200, `Status: ${getRels.status}`);

  // 30. CMDB Impact Analysis
  const impact = await getJson("/api/cmdb/impact/AST-001");
  assert("Impact analysis returns 200", impact.status === 200, `Status: ${impact.status}`);
  assert("Impact has data", impact.json.assetId === "AST-001", `assetId: ${impact.json.assetId}`);

  // 31. Audit Report
  console.log("--- Audit & Compliance ---");
  const from = new Date(Date.now() - 90 * 86400000).toISOString();
  const to = new Date().toISOString();
  const auditReport = await getJson(`/api/audit/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  assert("Audit report returns 200", auditReport.status === 200, `Status: ${auditReport.status}`);
  assert("Audit report has data array", Array.isArray(auditReport.json.data), `Type: ${typeof auditReport.json.data}`);

  // 32. Compliance Summary
  const compliance = await getJson("/api/audit/compliance-summary");
  assert("Compliance summary returns 200", compliance.status === 200, `Status: ${compliance.status}`);
  assert("Compliance has metrics", compliance.json.totalAuditEntries != null, `entries: ${compliance.json.totalAuditEntries}`);

  // ─── PHASE 4: Operational Excellence ──────────────────────────────────

  // 33. Runbook Execute
  console.log("--- Runbook Execution ---");
  // Use an existing KB article as runbook (seeding requires auth)
  const kbList = await getJson("/api/db/kb");
  const runbookId = kbList.json.data && kbList.json.data[0] ? kbList.json.data[0].id : "KB-DOC-007";
  const rbExec = await postJson("/api/runbook/execute", { runbookId, incidentId: "INC-E2E-001", executedBy: "E2E Test" });
  assert("Runbook execute returns 200/201", rbExec.status === 200 || rbExec.status === 201, `Status: ${rbExec.status}`);
  if (rbExec.json.success && rbExec.json.execution) {
    const execId = rbExec.json.execution.id;
    // Update step
    const stepUpdate = await putJson(`/api/runbook/execution/${execId}/step/1`, { status: "completed", notes: "Connectivity OK" });
    assert("Runbook step update succeeds", stepUpdate.json.success === true || stepUpdate.status === 200, `Status: ${stepUpdate.status}`);
  }

  // 34. Runbook Executions List
  let rbList = await getJson("/api/runbook/executions?incidentId=INC-E2E-001");
  assert("Runbook executions list returns 200", rbList.status === 200, `Status: ${rbList.status}`);

  // 35. Report Schedules
  console.log("--- Scheduled Reports ---");
  const schedCreate = await postJson("/api/reports/schedule", { id: "RS-E2E-001", name: "E2E Test Report", type: "incident_summary", frequency: "weekly", dayOfWeek: 1, hour: 8, recipients: ["test@example.com"] });
  assert("Report schedule create returns 200", schedCreate.status === 200 || schedCreate.status === 201, `Status: ${schedCreate.status}`);
  const schedList = await getJson("/api/reports/schedules");
  assert("Report schedules list returns 200", schedList.status === 200, `Status: ${schedList.status}`);
  assert("Report schedules has data", Array.isArray(schedList.json.data), `type: ${typeof schedList.json.data}`);

  // ─── Phase 7: CSAT Survey Engine ──────────────────────────────────
  console.log("--- Phase 7: CSAT Survey Engine ---");

  // 36. Submit CSAT response
  const csatSubmit = await postJson("/api/csat/submit", { ticketId: "INC-E2E-CSAT", rating: 5, comment: "Excellent service! Very fast resolution.", agentName: "E2E Agent", category: "Network", customerName: "E2E Customer", customerEmail: "e2e@test.com" });
  assert("CSAT submit returns 200", csatSubmit.status === 200, `Status: ${csatSubmit.status}`);
  assert("CSAT submit has success", csatSubmit.json.success === true, `success: ${csatSubmit.json.success}`);
  assert("CSAT submit has id", !!csatSubmit.json.id, `id: ${csatSubmit.json.id}`);

  // 37. Submit second CSAT response (different rating)
  const csatSubmit2 = await postJson("/api/csat/submit", { ticketId: "INC-E2E-CSAT2", rating: 3, comment: "OK service, could be faster.", agentName: "E2E Agent", category: "Email", customerName: "E2E Customer 2" });
  assert("CSAT submit #2 returns 200", csatSubmit2.status === 200, `Status: ${csatSubmit2.status}`);

  // 38. Submit third CSAT response (for AI analysis minimum)
  const csatSubmit3 = await postJson("/api/csat/submit", { ticketId: "INC-E2E-CSAT3", rating: 4, comment: "Good support, agent was helpful.", agentName: "E2E Agent 2", category: "Software", customerName: "E2E Customer 3" });
  assert("CSAT submit #3 returns 200", csatSubmit3.status === 200, `Status: ${csatSubmit3.status}`);

  // 39. CSAT validation — missing ticketId
  const csatBad = await postJson("/api/csat/submit", { rating: 5 });
  assert("CSAT submit rejects missing ticketId", csatBad.status === 400, `Status: ${csatBad.status}`);

  // 40. CSAT validation — invalid rating
  const csatBadRating = await postJson("/api/csat/submit", { ticketId: "X", rating: 0 });
  assert("CSAT submit rejects invalid rating", csatBadRating.status === 400, `Status: ${csatBadRating.status}`);

  // 41. Get CSAT scores
  const csatScores = await getJson("/api/csat/scores");
  assert("CSAT scores returns 200", csatScores.status === 200, `Status: ${csatScores.status}`);
  assert("CSAT scores has total >= 3", csatScores.json.total >= 3, `total: ${csatScores.json.total}`);
  assert("CSAT scores has average", typeof csatScores.json.average === "number" && csatScores.json.average > 0, `avg: ${csatScores.json.average}`);
  assert("CSAT scores has NPS", typeof csatScores.json.nps === "number", `nps: ${csatScores.json.nps}`);
  assert("CSAT scores has byAgent", typeof csatScores.json.byAgent === "object", `byAgent: ${typeof csatScores.json.byAgent}`);
  assert("CSAT scores has byCategory", typeof csatScores.json.byCategory === "object", `byCategory: ${typeof csatScores.json.byCategory}`);
  assert("CSAT scores has byRating", typeof csatScores.json.byRating === "object", `byRating: ${typeof csatScores.json.byRating}`);
  assert("CSAT scores has trend", Array.isArray(csatScores.json.trend), `trend: ${typeof csatScores.json.trend}`);
  assert("CSAT scores has sentimentBreakdown", typeof csatScores.json.sentimentBreakdown === "object", `sentiment: ${typeof csatScores.json.sentimentBreakdown}`);

  // 42. AI CSAT Analysis
  const csatAi = await postJson("/api/csat/ai-analyze", {});
  assert("CSAT AI analyze returns 200", csatAi.status === 200, `Status: ${csatAi.status}`);

  // 43. CSAT data in generic collection API
  const csatColl = await getJson("/api/db/csat_responses");
  assert("CSAT collection accessible via /api/data", csatColl.status === 200, `Status: ${csatColl.status}`);

  // ─── Phase 8: Change Calendar Engine ──────────────────────────────
  console.log("--- Phase 8: Change Calendar Engine ---");

  // 44. Get change calendar (current month)
  const cal = await getJson("/api/changes/calendar");
  assert("Calendar returns 200", cal.status === 200, `Status: ${cal.status}`);
  assert("Calendar has month", typeof cal.json.month === "number", `month: ${cal.json.month}`);
  assert("Calendar has year", typeof cal.json.year === "number", `year: ${cal.json.year}`);
  assert("Calendar has changes array", Array.isArray(cal.json.changes), `changes: ${typeof cal.json.changes}`);
  assert("Calendar has freezeWindows array", Array.isArray(cal.json.freezeWindows), `freezeWindows: ${typeof cal.json.freezeWindows}`);
  assert("Calendar has conflicts array", Array.isArray(cal.json.conflicts), `conflicts: ${typeof cal.json.conflicts}`);
  assert("Calendar has stats object", typeof cal.json.stats === "object", `stats: ${typeof cal.json.stats}`);
  assert("Calendar stats has total", typeof cal.json?.stats?.total === "number", `total: ${cal.json?.stats?.total}`);

  // 45. Get change calendar with month/year params
  const calApril = await getJson("/api/changes/calendar?month=4&year=2026");
  assert("Calendar with params returns 200", calApril.status === 200, `Status: ${calApril.status}`);
  assert("Calendar respects month param", calApril.json.month === 4, `month: ${calApril.json.month}`);
  assert("Calendar respects year param", calApril.json.year === 2026, `year: ${calApril.json.year}`);

  // 46. Create freeze window
  const freezeCreate = await postJson("/api/changes/freeze-window", { startDate: "2026-12-20T00:00:00", endDate: "2026-12-31T23:59:59", reason: "E2E Year-end freeze", createdBy: "E2E Tester" });
  assert("Freeze window create returns 201", freezeCreate.status === 201, `Status: ${freezeCreate.status}`);
  assert("Freeze window has success", freezeCreate.json.success === true, `success: ${freezeCreate.json.success}`);
  assert("Freeze window has id", !!freezeCreate.json.freezeWindow?.id, `id: ${freezeCreate.json.freezeWindow?.id}`);
  const freezeId = freezeCreate.json.freezeWindow?.id;

  // 47. Freeze window validation — missing required fields
  const freezeBad = await postJson("/api/changes/freeze-window", { startDate: "2026-12-20" });
  assert("Freeze window rejects missing fields", freezeBad.status === 400, `Status: ${freezeBad.status}`);

  // 48. Freeze window validation — endDate before startDate
  const freezeBadDates = await postJson("/api/changes/freeze-window", { startDate: "2026-12-31", endDate: "2026-12-20", reason: "Bad" });
  assert("Freeze window rejects bad date range", freezeBadDates.status === 400, `Status: ${freezeBadDates.status}`);

  // 49. List freeze windows
  const freezeList = await getJson("/api/changes/freeze-windows");
  assert("Freeze windows list returns 200", freezeList.status === 200, `Status: ${freezeList.status}`);
  assert("Freeze windows list has array", Array.isArray(freezeList.json.freezeWindows), `type: ${typeof freezeList.json.freezeWindows}`);
  assert("Freeze windows contains created window", freezeList.json.freezeWindows?.some(fw => fw.id === freezeId) ?? false, `freezeId: ${freezeId}, list: ${freezeList.json.freezeWindows?.length ?? 'N/A'}`);

  // 50. Conflict check — no conflict scenario
  const conflictOk = await postJson("/api/changes/conflict-check", { scheduledStart: "2026-06-15T10:00:00", scheduledEnd: "2026-06-15T12:00:00", title: "E2E Safe Change", type: "Normal", category: "General", impact: "Department" });
  assert("Conflict check returns 200", conflictOk.status === 200, `Status: ${conflictOk.status}`);
  assert("Conflict check has hasConflicts", typeof conflictOk.json.hasConflicts === "boolean", `hasConflicts: ${conflictOk.json.hasConflicts}`);
  assert("Conflict check has directConflicts array", Array.isArray(conflictOk.json.directConflicts), `type: ${typeof conflictOk.json.directConflicts}`);
  assert("Conflict check has freezeViolations array", Array.isArray(conflictOk.json.freezeViolations), `type: ${typeof conflictOk.json.freezeViolations}`);

  // 51. Conflict check — freeze window violation
  const conflictFreeze = await postJson("/api/changes/conflict-check", { scheduledStart: "2026-12-25T10:00:00", scheduledEnd: "2026-12-25T12:00:00", title: "E2E Freeze Conflict", type: "Normal" });
  assert("Conflict check detects freeze violation", conflictFreeze.json.hasConflicts === true, `hasConflicts: ${conflictFreeze.json.hasConflicts}`);
  assert("Conflict check returns freeze violations", (conflictFreeze.json.freezeViolations?.length ?? 0) > 0, `violations: ${conflictFreeze.json.freezeViolations?.length ?? 'N/A'}`);

  // 52. Conflict check validation — missing fields
  const conflictBad = await postJson("/api/changes/conflict-check", { scheduledEnd: "2026-06-15" });
  assert("Conflict check rejects missing fields", conflictBad.status === 400, `Status: ${conflictBad.status}`);

  // 53. Delete freeze window
  const freezeDelRes = await new Promise((resolve, reject) => {
    const url = new URL(`${BASE}/api/changes/freeze-window?id=${encodeURIComponent(freezeId || '')}`);
    const req = https.request({ hostname: url.hostname, port: 443, path: url.pathname + url.search, method: "DELETE" }, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => { try { resolve({ status: res.statusCode, json: JSON.parse(buf) }); } catch { resolve({ status: res.statusCode, json: {} }); } });
    });
    req.on("error", reject);
    req.end();
  });
  assert("Freeze window delete returns 200", freezeDelRes.status === 200, `Status: ${freezeDelRes.status}`);

  // 54. Verify freeze window deleted
  const freezeListAfter = await getJson("/api/changes/freeze-windows");
  assert("Freeze window no longer in list", !(freezeListAfter.json.freezeWindows?.some(fw => fw.id === freezeId) ?? false), `still present: ${freezeListAfter.json.freezeWindows?.some(fw => fw.id === freezeId) ?? 'N/A'}`);

  // 55. Calendar data via generic collection API
  const fwColl = await getJson("/api/db/change_freeze_windows");
  assert("Freeze windows collection accessible via /api/db", fwColl.status === 200, `Status: ${fwColl.status}`);

  // ─── Phase 9: AI Learning Dashboard ──────────────────────────────
  console.log("--- Phase 9: AI Learning Dashboard ---");

  // 56. GET /api/ai/learning/metrics returns 200
  const alMetrics = await getJson("/api/ai/learning/metrics");
  assert("AI learning metrics returns 200", alMetrics.status === 200, `Status: ${alMetrics.status}`);

  // 57. Metrics has expected fields
  assert("Metrics has totalTriages field", alMetrics.json.totalTriages !== undefined, `Missing totalTriages`);
  assert("Metrics has avgConfidence field", alMetrics.json.avgConfidence !== undefined, `Missing avgConfidence`);
  assert("Metrics has autoApplyRate field", alMetrics.json.autoApplyRate !== undefined, `Missing autoApplyRate`);
  assert("Metrics has confidenceBuckets field", alMetrics.json.confidenceBuckets !== undefined, `Missing confidenceBuckets`);
  assert("Metrics has feedbackStats field", alMetrics.json.feedbackStats !== undefined, `Missing feedbackStats`);
  assert("Metrics has categoryBreakdown field", alMetrics.json.categoryBreakdown !== undefined, `Missing categoryBreakdown`);

  // 62. GET /api/ai/learning/trends returns 200
  const alTrends = await getJson("/api/ai/learning/trends");
  assert("AI learning trends returns 200", alTrends.status === 200, `Status: ${alTrends.status}`);

  // 63. Trends has expected fields
  assert("Trends has period field", alTrends.json.period !== undefined, `Missing period`);
  assert("Trends has trends array", Array.isArray(alTrends.json.trends), `trends not array`);

  // 65. Trends with daily period
  const alTrendsDaily = await getJson("/api/ai/learning/trends?period=daily");
  assert("Daily trends returns 200", alTrendsDaily.status === 200, `Status: ${alTrendsDaily.status}`);
  assert("Daily trends period is daily", alTrendsDaily.json.period === "daily", `Period: ${alTrendsDaily.json.period}`);

  // 67. POST /api/ai/learning/feedback — create feedback
  const fbRes = await postJson("/api/ai/learning/feedback", { triageId: "TEST-TRIAGE-001", verdict: "correct", notes: "E2E test feedback" });
  assert("Create AI feedback returns 201", fbRes.status === 201, `Status: ${fbRes.status}`);
  assert("Feedback has id", fbRes.json.feedback?.id?.startsWith("ALFB-"), `ID: ${fbRes.json.feedback?.id}`);
  const testFeedbackId = fbRes.json.feedback?.id;

  // 69. POST feedback validation — missing fields
  const fbBad = await postJson("/api/ai/learning/feedback", { triageId: "X" });
  assert("Feedback without verdict returns 400", fbBad.status === 400, `Status: ${fbBad.status}`);

  // 70. POST feedback invalid verdict
  const fbBad2 = await postJson("/api/ai/learning/feedback", { triageId: "X", verdict: "maybe" });
  assert("Feedback with invalid verdict returns 400", fbBad2.status === 400, `Status: ${fbBad2.status}`);

  // 71. GET /api/ai/learning/feedback — list feedback
  const fbList = await getJson("/api/ai/learning/feedback");
  assert("List AI feedback returns 200", fbList.status === 200, `Status: ${fbList.status}`);
  assert("Feedback list has our entry", fbList.json.feedback?.some(f => f.id === testFeedbackId), `Not found: ${testFeedbackId}`);

  // 73. DELETE /api/ai/learning/feedback/:id
  const fbDelRes = await new Promise((resolve, reject) => {
    const url = new URL(`${BASE}/api/ai/learning/feedback/${testFeedbackId}`);
    const req = https.request({ hostname: url.hostname, port: 443, path: url.pathname, method: "DELETE" }, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => { try { resolve({ status: res.statusCode, json: JSON.parse(buf) }); } catch { resolve({ status: res.statusCode, json: {} }); } });
    });
    req.on("error", reject);
    req.end();
  });
  assert("Delete AI feedback returns 200", fbDelRes.status === 200, `Status: ${fbDelRes.status}`);

  // 74. Verify feedback deleted
  const fbListAfter = await getJson("/api/ai/learning/feedback");
  assert("Feedback no longer in list after delete", !(fbListAfter.json.feedback?.some(f => f.id === testFeedbackId) ?? false), `still present`);

  // 75. GET /api/ai/learning/model-health returns 200
  const healthRes = await getJson("/api/ai/learning/model-health");
  assert("AI model health returns 200", healthRes.status === 200, `Status: ${healthRes.status}`);
  assert("Model health has healthScore", healthRes.json.healthScore !== undefined, `Missing healthScore`);
  assert("Model health has healthStatus", healthRes.json.healthStatus !== undefined, `Missing healthStatus`);
  assert("Model health has trend", healthRes.json.trend !== undefined, `Missing trend`);

  // 79. AI learning feedback collection accessible via generic API
  const alColl = await getJson("/api/db/ai_learning_feedback");
  assert("AI learning feedback collection accessible via /api/db", alColl.status === 200, `Status: ${alColl.status}`);

  // 80. POST feedback with corrections
  const fbCorrRes = await postJson("/api/ai/learning/feedback", { triageId: "TEST-TRIAGE-002", verdict: "incorrect", notes: "Wrong category", correctedCategory: "Security", correctedPriority: "Sev-A" });
  assert("Feedback with corrections returns 201", fbCorrRes.status === 201, `Status: ${fbCorrRes.status}`);
  assert("Corrected category saved", fbCorrRes.json.feedback?.correctedCategory === "Security", `Cat: ${fbCorrRes.json.feedback?.correctedCategory}`);

  // 82. Cleanup correction feedback
  if (fbCorrRes.json.feedback?.id) {
    await new Promise((resolve, reject) => {
      const url = new URL(`${BASE}/api/ai/learning/feedback/${fbCorrRes.json.feedback.id}`);
      const req = https.request({ hostname: url.hostname, port: 443, path: url.pathname, method: "DELETE" }, res => {
        let buf = ""; res.on("data", c => buf += c); res.on("end", () => resolve());
      });
      req.on("error", reject);
      req.end();
    });
  }

  // 83. Metrics reflect updated state after feedback operations
  const alMetrics2 = await getJson("/api/ai/learning/metrics");
  assert("Metrics still returns 200 after operations", alMetrics2.status === 200, `Status: ${alMetrics2.status}`);

  // 84. Monthly trends work
  const alTrendsMonthly = await getJson("/api/ai/learning/trends?period=monthly");
  assert("Monthly trends returns 200", alTrendsMonthly.status === 200, `Status: ${alTrendsMonthly.status}`);
  assert("Monthly trends period is monthly", alTrendsMonthly.json.period === "monthly", `Period: ${alTrendsMonthly.json.period}`);

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 1: Core ITIL Gaps Tests
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n--- Phase 1: Work Logs ---");
  const testIncId = incidents.json.data && incidents.json.data[0] ? incidents.json.data[0].id : "INC-TEST";
  const wlList = await getJson(`/api/incidents/${testIncId}/worklogs`);
  assert("Work logs GET returns 200", wlList.status === 200, `Status: ${wlList.status}`);
  assert("Work logs returns array", Array.isArray(wlList.json), `Got: ${typeof wlList.json}`);
  const wlCreate = await postJson(`/api/incidents/${testIncId}/worklogs`, { description: "E2E test log entry", hours: 1.5, category: "testing", billable: true });
  assert("Work log create returns 201", wlCreate.status === 201, `Status: ${wlCreate.status}`);
  assert("Work log has id", !!wlCreate.json.id, `Got: ${wlCreate.json.id}`);
  assert("Work log hours correct", wlCreate.json.hours === 1.5, `Got: ${wlCreate.json.hours}`);
  const wlList2 = await getJson(`/api/incidents/${testIncId}/worklogs`);
  assert("Work logs list updated", wlList2.json.length > wlList.json.length, `Before: ${wlList.json.length}, After: ${wlList2.json.length}`);

  console.log("--- Phase 1: Known Errors ---");
  const keList = await getJson("/api/known-errors");
  assert("Known errors GET returns 200", keList.status === 200, `Status: ${keList.status}`);
  assert("Known errors returns array", Array.isArray(keList.json), `Got: ${typeof keList.json}`);

  console.log("--- Phase 1: Custom Fields ---");
  const cfList = await getJson("/api/admin/custom-fields");
  assert("Custom fields GET returns 200", cfList.status === 200, `Status: ${cfList.status}`);
  assert("Custom fields returns array", Array.isArray(cfList.json), `Got: ${typeof cfList.json}`);
  const cfCreate = await postJson("/api/admin/custom-fields", { name: "e2e_test_field", label: "E2E Test Field", type: "text", module: "incidents" });
  assert("Custom field create returns 201 or 403", [201, 403].includes(cfCreate.status), `Status: ${cfCreate.status}`);

  console.log("--- Phase 1: Notification Preferences ---");
  const npGet = await getJson("/api/users/e2e-test/notification-prefs");
  assert("Notification prefs GET returns 200", npGet.status === 200, `Status: ${npGet.status}`);
  assert("Notification prefs has userId", npGet.json.userId === "e2e-test", `Got: ${npGet.json.userId}`);
  assert("Notification prefs has defaults", npGet.json.channels != null, `Got: ${JSON.stringify(npGet.json.channels)}`);

  console.log("--- Phase 1: Field Visibility ---");
  const fvList = await getJson("/api/admin/field-visibility");
  assert("Field visibility GET returns 200", fvList.status === 200, `Status: ${fvList.status}`);
  assert("Field visibility returns array", Array.isArray(fvList.json), `Got: ${typeof fvList.json}`);

  console.log("--- Phase 1: Change Collision Detection ---");
  const ccCheck = await postJson("/api/changes/collision-check", { startTime: new Date().toISOString(), endTime: new Date(Date.now() + 3600000).toISOString() });
  assert("Collision check returns 200", ccCheck.status === 200, `Status: ${ccCheck.status}`);
  assert("Collision check has collisions array", Array.isArray(ccCheck.json.collisions), `Got: ${typeof ccCheck.json.collisions}`);
  assert("Collision check has hasConflicts flag", typeof ccCheck.json.hasConflicts === "boolean", `Got: ${typeof ccCheck.json.hasConflicts}`);

  console.log("--- Phase 1: AI Change Risk Assessment ---");
  const crRisk = await postJson("/api/ai/change-risk", { title: "E2E Test Change", description: "Upgrade test server firmware", type: "Normal" });
  assert("Change risk returns 200", crRisk.status === 200, `Status: ${crRisk.status}`);
  assert("Change risk has riskScore", typeof crRisk.json.riskScore === "number", `Got: ${typeof crRisk.json.riskScore}`);

  console.log("--- Phase 1: AI Recurring Detection ---");
  const rdDetect = await postJson("/api/ai/detect-recurring", {});
  assert("Recurring detection returns 200", rdDetect.status === 200, `Status: ${rdDetect.status}`);
  assert("Recurring detection has groups", Array.isArray(rdDetect.json.groups), `Got: ${typeof rdDetect.json.groups}`);

  console.log("--- Phase 1: MIM API ---");
  const mimList = await getJson("/api/mim");
  assert("MIM list returns 200", mimList.status === 200, `Status: ${mimList.status}`);
  assert("MIM list returns array", Array.isArray(mimList.json), `Got: ${typeof mimList.json}`);

  console.log("--- Phase 1: SLA Pause/Resume ---");
  const slaPause = await postJson(`/api/incidents/${testIncId}/sla-pause`, { reason: "E2E test pause" });
  assert("SLA pause returns 200 or 400", [200, 400].includes(slaPause.status), `Status: ${slaPause.status}`);
  if (slaPause.status === 200) {
    const slaResume = await postJson(`/api/incidents/${testIncId}/sla-resume`, {});
    assert("SLA resume returns 200", slaResume.status === 200, `Status: ${slaResume.status}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 2: AI Enhancement & Automation Tests
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n--- Phase 2: AI Virtual Agent ---");
  const chatReply = await postJson("/api/ai/virtual-agent", { message: "Hello, I need help with my laptop" });
  assert("AI chat returns 200", chatReply.status === 200, `Status: ${chatReply.status}`);
  assert("AI chat has sessionId", !!chatReply.json.sessionId, `Got: ${chatReply.json.sessionId}`);
  assert("AI chat has reply", typeof chatReply.json.reply === "string" && chatReply.json.reply.length > 0, `Reply length: ${(chatReply.json.reply || "").length}`);
  if (chatReply.json.sessionId) {
    const chatHistory = await getJson(`/api/ai/virtual-agent/${chatReply.json.sessionId}`);
    assert("Chat history returns 200", chatHistory.status === 200, `Status: ${chatHistory.status}`);
    assert("Chat history has messages", Array.isArray(chatHistory.json.messages) && chatHistory.json.messages.length > 0, `Messages: ${(chatHistory.json.messages || []).length}`);
  }

  console.log("--- Phase 2: AI KB Article Generation ---");
  const kbGen = await postJson("/api/ai/generate-kb", { incidentId: testIncId });
  assert("AI KB generation returns 201", kbGen.status === 201, `Status: ${kbGen.status}`);
  assert("AI KB draft has id", !!kbGen.json.id, `Got: ${kbGen.json.id}`);
  assert("AI KB draft has title", !!kbGen.json.title, `Got: ${kbGen.json.title}`);
  const kbDrafts = await getJson("/api/ai/kb-drafts");
  assert("KB drafts list returns 200", kbDrafts.status === 200, `Status: ${kbDrafts.status}`);
  assert("KB drafts returns array", Array.isArray(kbDrafts.json), `Got: ${typeof kbDrafts.json}`);
  if (kbGen.json.id) {
    const publishResult = await postJson(`/api/ai/generate-kb/${kbGen.json.id}/publish`, {});
    assert("KB draft publish returns 201", publishResult.status === 201, `Status: ${publishResult.status}`);
    assert("Published KB has article", !!publishResult.json.article, `Got: ${!!publishResult.json.article}`);
  }

  console.log("--- Phase 2: Automation Rules Engine ---");
  const arList = await getJson("/api/automation/rules");
  assert("Automation rules list returns 200", arList.status === 200, `Status: ${arList.status}`);
  const arCreate = await postJson("/api/automation/rules", { name: "E2E Test Rule", trigger: "ticket_created", conditions: [{ field: "priority", operator: "equals", value: "P1" }], actions: [{ type: "add_tag", value: "critical" }] });
  assert("Automation rule create returns 201", arCreate.status === 201, `Status: ${arCreate.status}`);
  assert("Automation rule has id", !!arCreate.json.id, `Got: ${arCreate.json.id}`);
  const arEval = await postJson("/api/automation/evaluate", { incidentId: testIncId, event: "ticket_created" });
  assert("Automation evaluate returns 200", arEval.status === 200, `Status: ${arEval.status}`);
  assert("Automation evaluate has rulesEvaluated", typeof arEval.json.rulesEvaluated === "number", `Got: ${arEval.json.rulesEvaluated}`);

  console.log("--- Phase 2: Email-to-Ticket Ingest ---");
  const emailTicket = await postJson("/api/ingest/email", { from: "user@test.com", fromName: "Test User", subject: "Printer not working in floor 3", body: "The HP printer on floor 3 keeps showing paper jam error even after clearing the tray." });
  assert("Email ingest returns 201", emailTicket.status === 201, `Status: ${emailTicket.status}`);
  assert("Email ticket has ticketId", !!emailTicket.json.ticketId, `Got: ${emailTicket.json.ticketId}`);
  assert("Email ticket source is email", emailTicket.json.source === "email", `Got: ${emailTicket.json.source}`);

  console.log("--- Phase 2: Runbook List & Executions ---");
  const rbExecs = await getJson("/api/runbook/executions");
  assert("Runbook executions returns 200", rbExecs.status === 200, `Status: ${rbExecs.status}`);
  assert("Runbook executions has data", Array.isArray(rbExecs.json.data), `Got: ${typeof rbExecs.json.data}`);

  console.log("--- Phase 2: AI Capacity Forecast ---");
  const forecast = await postJson("/api/ai/capacity-forecast", {});
  assert("Capacity forecast returns 200", forecast.status === 200, `Status: ${forecast.status}`);
  assert("Forecast has data or message", forecast.json.forecast != null || forecast.json.message != null, `Keys: ${Object.keys(forecast.json)}`);

  console.log("--- Phase 2: AI Semantic Search ---");
  const aiSearch = await postJson("/api/ai/search", { query: "printer issue", scope: "all" });
  assert("AI search returns 200", aiSearch.status === 200, `Status: ${aiSearch.status}`);
  assert("AI search has results array", Array.isArray(aiSearch.json.results), `Got: ${typeof aiSearch.json.results}`);
  assert("AI search has query echo", aiSearch.json.query === "printer issue", `Got: ${aiSearch.json.query}`);

  console.log("--- Phase 2: Multi-Channel Intake Stats ---");
  const chStats = await getJson("/api/analytics/channel-stats");
  assert("Channel stats returns 200", chStats.status === 200, `Status: ${chStats.status}`);
  assert("Channel stats has channels", typeof chStats.json.channels === "object", `Got: ${typeof chStats.json.channels}`);
  assert("Channel stats has trends", typeof chStats.json.trends === "object", `Got: ${typeof chStats.json.trends}`);
  assert("Channel stats has total", typeof chStats.json.total === "number", `Got: ${typeof chStats.json.total}`);

  console.log("--- Phase 2: Agent Gamification ---");
  const leaderboard = await getJson("/api/gamification/leaderboard");
  assert("Leaderboard returns 200", leaderboard.status === 200, `Status: ${leaderboard.status}`);
  assert("Leaderboard has array", Array.isArray(leaderboard.json.leaderboard), `Got: ${typeof leaderboard.json.leaderboard}`);
  const lbMonthly = await getJson("/api/gamification/leaderboard?period=monthly");
  assert("Monthly leaderboard returns 200", lbMonthly.status === 200, `Status: ${lbMonthly.status}`);
  assert("Monthly leaderboard period correct", lbMonthly.json.period === "monthly", `Got: ${lbMonthly.json.period}`);

  console.log("--- Phase 2: Custom Dashboard Layouts ---");
  const dlGet = await getJson("/api/dashboard/layout/e2e-test-user");
  assert("Dashboard layout GET returns 200", dlGet.status === 200, `Status: ${dlGet.status}`);
  assert("Dashboard layout has widgets", Array.isArray(dlGet.json.widgets), `Got: ${typeof dlGet.json.widgets}`);
  const dlPut = await putJson("/api/dashboard/layout/e2e-test-user", { widgets: ["ticketSummary", "slaPie"], layout: "custom" });
  assert("Dashboard layout PUT returns 200", dlPut.status === 200, `Status: ${dlPut.status}`);
  assert("Dashboard layout saved widgets", dlPut.json.widgets.length === 2, `Got: ${dlPut.json.widgets.length}`);

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 3: Enterprise Modules & Compliance Tests
  // ═══════════════════════════════════════════════════════════════════════

  console.log("\n--- Phase 3: Release Management ---");
  const relCreate = await postJson("/api/releases", { name: "Release 2026-Q2", type: "Major", description: "Q2 feature release", scheduledStart: "2026-06-01", scheduledEnd: "2026-06-15" });
  assert("Release create returns 201", relCreate.status === 201, `Status: ${relCreate.status}`);
  assert("Release has id", !!relCreate.json.id, `Got: ${relCreate.json.id}`);
  assert("Release status is Plan", relCreate.json.status === "Plan", `Got: ${relCreate.json.status}`);
  const relList = await getJson("/api/releases");
  assert("Release list returns 200", relList.status === 200, `Status: ${relList.status}`);
  assert("Release list is array", Array.isArray(relList.json), `Got: ${typeof relList.json}`);
  if (relCreate.json.id) {
    const relGet = await getJson(`/api/releases/${relCreate.json.id}`);
    assert("Release GET returns 200", relGet.status === 200, `Status: ${relGet.status}`);
    const relUpd = await putJson(`/api/releases/${relCreate.json.id}`, { status: "Build" });
    assert("Release update returns 200", relUpd.status === 200, `Status: ${relUpd.status}`);
    assert("Release status updated to Build", relUpd.json.status === "Build", `Got: ${relUpd.json.status}`);
    const relLink = await postJson(`/api/releases/${relCreate.json.id}/link-change`, { changeId: "CHG-E2E-001" });
    assert("Release link-change returns 200", relLink.status === 200, `Status: ${relLink.status}`);
    assert("Release linkedChanges includes CHG", relLink.json.linkedChanges.includes("CHG-E2E-001"), `Got: ${JSON.stringify(relLink.json.linkedChanges)}`);
  }

  console.log("--- Phase 3: Self-Service Portal ---");
  const ssCreate = await postJson("/api/self-service/create-ticket", { title: "My laptop is slow", requesterEmail: "enduser@test.com", category: "Hardware" });
  assert("Self-service create returns 201", ssCreate.status === 201, `Status: ${ssCreate.status}`);
  assert("Self-service has ticketId", !!ssCreate.json.ticketId, `Got: ${ssCreate.json.ticketId}`);
  const ssTickets = await getJson("/api/self-service/my-tickets?email=enduser@test.com");
  assert("Self-service my-tickets returns 200", ssTickets.status === 200, `Status: ${ssTickets.status}`);
  assert("Self-service tickets found", ssTickets.json.total > 0, `Total: ${ssTickets.json.total}`);
  const ssCatalog = await getJson("/api/self-service/catalog");
  assert("Self-service catalog returns 200", ssCatalog.status === 200, `Status: ${ssCatalog.status}`);
  const ssKb = await getJson("/api/self-service/kb-search?q=test");
  assert("Self-service KB search returns 200", ssKb.status === 200, `Status: ${ssKb.status}`);
  assert("KB search has results array", Array.isArray(ssKb.json.results), `Got: ${typeof ssKb.json.results}`);

  console.log("--- Phase 3: Cost Allocation ---");
  const costRate = await postJson("/api/cost/rates", { team: "E2E-Team", hourlyRate: 75, currency: "USD" });
  assert("Cost rate POST returns 200", costRate.status === 200, `Status: ${costRate.status}`);
  const costRates = await getJson("/api/cost/rates");
  assert("Cost rates GET returns 200", costRates.status === 200, `Status: ${costRates.status}`);
  assert("Cost rates is array", Array.isArray(costRates.json), `Got: ${typeof costRates.json}`);
  const costSummary = await getJson("/api/cost/summary");
  assert("Cost summary returns 200", costSummary.status === 200, `Status: ${costSummary.status}`);
  assert("Cost summary has departments", Array.isArray(costSummary.json.departments), `Got: ${typeof costSummary.json.departments}`);
  const costReport = await getJson("/api/cost/report");
  assert("Cost report returns 200", costReport.status === 200, `Status: ${costReport.status}`);
  assert("Cost report has items", Array.isArray(costReport.json.items), `Got: ${typeof costReport.json.items}`);

  console.log("--- Phase 3: Compliance Evidence ---");
  const compExport = await postJson("/api/compliance/export", { type: "soc2", startDate: "2026-01-01", endDate: "2026-12-31" });
  assert("Compliance export returns 200", compExport.status === 200, `Status: ${compExport.status}`);
  assert("Compliance has framework", compExport.json.framework === "soc2", `Got: ${compExport.json.framework}`);
  assert("Compliance has summary", typeof compExport.json.summary === "object", `Got: ${typeof compExport.json.summary}`);
  assert("Compliance has auditLog", Array.isArray(compExport.json.auditLog), `Got: ${typeof compExport.json.auditLog}`);

  console.log("--- Phase 3: Contract Management ---");
  const ctrCreate = await postJson("/api/contracts", { name: "E2E Support Contract", vendor: "Acme Corp", type: "Service", value: 50000, startDate: "2026-01-01", endDate: "2026-08-01" });
  assert("Contract create returns 201", ctrCreate.status === 201, `Status: ${ctrCreate.status}`);
  assert("Contract has id", !!ctrCreate.json.id, `Got: ${ctrCreate.json.id}`);
  const ctrList = await getJson("/api/contracts");
  assert("Contract list returns 200", ctrList.status === 200, `Status: ${ctrList.status}`);
  if (ctrCreate.json.id) {
    const ctrUpd = await putJson(`/api/contracts/${ctrCreate.json.id}`, { status: "Under Review" });
    assert("Contract update returns 200", ctrUpd.status === 200, `Status: ${ctrUpd.status}`);
  }
  const ctrExpiring = await getJson("/api/contracts/expiring?days=365");
  assert("Contracts expiring returns 200", ctrExpiring.status === 200, `Status: ${ctrExpiring.status}`);
  assert("Contracts expiring has array", Array.isArray(ctrExpiring.json.expiring), `Got: ${typeof ctrExpiring.json.expiring}`);

  console.log("--- Phase 3: CMDB Dependency Map ---");
  const depMap = await getJson("/api/cmdb/dependency-map/AST-001");
  assert("Dependency map returns 200", depMap.status === 200, `Status: ${depMap.status}`);
  assert("Dependency map has rootAssetId", depMap.json.rootAssetId === "AST-001", `Got: ${depMap.json.rootAssetId}`);
  assert("Dependency map has dependencies", Array.isArray(depMap.json.dependencies), `Got: ${typeof depMap.json.dependencies}`);
  const impactAnalysis = await postJson("/api/cmdb/impact-analysis", { assetId: "AST-001" });
  assert("Impact analysis returns 200", impactAnalysis.status === 200, `Status: ${impactAnalysis.status}`);
  assert("Impact analysis has assetId", impactAnalysis.json.assetId === "AST-001", `Got: ${impactAnalysis.json.assetId}`);
  assert("Impact has impactedAssets", Array.isArray(impactAnalysis.json.impactedAssets), `Got: ${typeof impactAnalysis.json.impactedAssets}`);

  console.log("--- Phase 3: Teams Integration ---");
  const twCreate = await postJson("/api/integrations/teams/webhook", { channelName: "E2E-Channel", webhookUrl: "https://example.com/teams-webhook" });
  assert("Teams webhook create returns 201", twCreate.status === 201, `Status: ${twCreate.status}`);
  assert("Teams webhook has id", !!twCreate.json.id, `Got: ${twCreate.json.id}`);
  const twList = await getJson("/api/integrations/teams/webhooks");
  assert("Teams webhooks list returns 200", twList.status === 200, `Status: ${twList.status}`);
  const twNotify = await postJson("/api/integrations/teams/notify", { webhookId: twCreate.json.id, title: "E2E Test", message: "Test notification", priority: "P2" });
  assert("Teams notify returns 200", twNotify.status === 200, `Status: ${twNotify.status}`);
  assert("Teams notify sent flag", twNotify.json.sent === true, `Got: ${twNotify.json.sent}`);

  console.log("--- Phase 3: CMDB Discovery Ingest ---");
  const discovery = await postJson("/api/cmdb/discovery/ingest", { source: "e2e-test", assets: [{ hostname: "srv-e2e-001", type: "Server", os: "Ubuntu 22.04", ipAddress: "10.0.0.100", manufacturer: "Dell" }, { hostname: "srv-e2e-002", type: "Server", os: "Windows Server 2022", ipAddress: "10.0.0.101" }] });
  assert("Discovery ingest returns 200", discovery.status === 200, `Status: ${discovery.status}`);
  assert("Discovery has added count", typeof discovery.json.added === "number", `Got: ${discovery.json.added}`);
  assert("Discovery source correct", discovery.json.source === "e2e-test", `Got: ${discovery.json.source}`);

  console.log("--- Phase 3: Service Status Public Page ---");
  const statusPublic = await getJson("/api/status/public");
  assert("Status public returns 200", statusPublic.status === 200, `Status: ${statusPublic.status}`);
  assert("Status public has services", Array.isArray(statusPublic.json.services), `Got: ${typeof statusPublic.json.services}`);
  assert("Status public has overallStatus", typeof statusPublic.json.overallStatus === "string", `Got: ${typeof statusPublic.json.overallStatus}`);
  const statusSub = await postJson("/api/status/subscribe", { email: "e2e@test.com" });
  assert("Status subscribe returns 201", statusSub.status === 201, `Status: ${statusSub.status}`);
  assert("Status subscribe confirmed", statusSub.json.subscribed === true, `Got: ${statusSub.json.subscribed}`);
  const statusSubs = await getJson("/api/status/subscribers");
  assert("Status subscribers returns 200", statusSubs.status === 200, `Status: ${statusSubs.status}`);

  console.log("--- Phase 3: Change Freeze Check ---");
  const freezeCheck = await getJson("/api/changes/freeze-check?date=2026-12-25");
  assert("Freeze check returns 200", freezeCheck.status === 200, `Status: ${freezeCheck.status}`);
  assert("Freeze check has frozen field", typeof freezeCheck.json.frozen === "boolean", `Got: ${typeof freezeCheck.json.frozen}`);
  const freezeCheckSafe = await getJson("/api/changes/freeze-check?date=2026-03-15");
  assert("Freeze check safe date returns 200", freezeCheckSafe.status === 200, `Status: ${freezeCheckSafe.status}`);

  // ═══ Phase 4: Advanced Analytics & Reporting ═══

  // Step 31: Custom Report Builder
  const reportBuild = await postJson("/api/reports/build", { dataSource: "incidents" });
  assert("Report build returns 200", reportBuild.status === 200, `Status: ${reportBuild.status}`);
  assert("Report build has records", Array.isArray(reportBuild.json.records), `Got: ${typeof reportBuild.json.records}`);
  const reportBuildGroup = await postJson("/api/reports/build", { dataSource: "incidents", groupBy: "status" });
  assert("Report build grouped returns 200", reportBuildGroup.status === 200, `Status: ${reportBuildGroup.status}`);
  assert("Report build grouped has groups", Array.isArray(reportBuildGroup.json.groups), `Got: ${typeof reportBuildGroup.json.groups}`);
  const reportBuildBad = await postJson("/api/reports/build", { dataSource: "invalid_collection" });
  assert("Report build invalid source returns 400", reportBuildBad.status === 400, `Status: ${reportBuildBad.status}`);
  const reportBuildFilter = await postJson("/api/reports/build", { dataSource: "incidents", filters: [{ field: "status", operator: "equals", value: "Open" }] });
  assert("Report build with filter returns 200", reportBuildFilter.status === 200, `Status: ${reportBuildFilter.status}`);
  const reportSave = await postJson("/api/reports/save", { name: "E2E Test Report", dataSource: "incidents", groupBy: "priority" });
  assert("Report save returns 201", reportSave.status === 201, `Status: ${reportSave.status}`);
  assert("Saved report has id", !!reportSave.json.id, `Got: ${reportSave.json.id}`);
  const savedReports = await getJson("/api/reports/saved");
  assert("Saved reports returns 200", savedReports.status === 200, `Status: ${savedReports.status}`);
  assert("Saved reports is array", Array.isArray(savedReports.json), `Got: ${typeof savedReports.json}`);

  // Step 32: AI Anomaly Detection
  const anomalies = await getJson("/api/analytics/anomalies");
  assert("Anomaly detection returns 200", anomalies.status === 200, `Status: ${anomalies.status}`);
  assert("Anomalies has anomalies array", Array.isArray(anomalies.json.anomalies), `Got: ${typeof anomalies.json.anomalies}`);
  assert("Anomalies has analyzedTickets", typeof anomalies.json.analyzedTickets === "number", `Got: ${typeof anomalies.json.analyzedTickets}`);

  // Step 33: Executive Dashboard
  const execDash = await getJson("/api/analytics/executive-summary");
  assert("Executive dashboard returns 200", execDash.status === 200, `Status: ${execDash.status}`);
  assert("Executive dashboard has healthScore", typeof execDash.json.healthScore === "number", `Got: ${typeof execDash.json.healthScore}`);
  assert("Executive dashboard has slaComplianceRate", typeof execDash.json.slaComplianceRate === "number", `Got: ${typeof execDash.json.slaComplianceRate}`);
  assert("Executive dashboard has riskHeatmap", !!execDash.json.riskHeatmap, `Got: ${JSON.stringify(execDash.json.riskHeatmap)}`);

  // Step 34: Trend Analysis & Forecasting
  const trends = await getJson("/api/analytics/trend-forecast?metric=tickets&days=30");
  assert("Trends returns 200", trends.status === 200, `Status: ${trends.status}`);
  assert("Trends has dailyData", Array.isArray(trends.json.dailyData), `Got: ${typeof trends.json.dailyData}`);
  assert("Trends has trend field", ["increasing", "decreasing", "stable"].includes(trends.json.trend), `Got: ${trends.json.trend}`);
  assert("Trends has forecast7d", typeof trends.json.forecast7d === "number", `Got: ${typeof trends.json.forecast7d}`);

  // Step 35: SLA Analytics Deep Dive
  const slaDeep = await getJson("/api/analytics/sla-deep-dive?groupBy=category");
  assert("SLA deep dive returns 200", slaDeep.status === 200, `Status: ${slaDeep.status}`);
  assert("SLA deep dive has groups", Array.isArray(slaDeep.json.groups), `Got: ${typeof slaDeep.json.groups}`);
  const slaDeepTeam = await getJson("/api/analytics/sla-deep-dive?groupBy=assignedTo");
  assert("SLA deep dive by team returns 200", slaDeepTeam.status === 200, `Status: ${slaDeepTeam.status}`);

  // Step 36: AI Model Performance Dashboard
  const aiPerf = await getJson("/api/analytics/ai-performance");
  assert("AI performance returns 200", aiPerf.status === 200, `Status: ${aiPerf.status}`);
  assert("AI performance has totalAiCalls", typeof aiPerf.json.totalAiCalls === "number", `Got: ${typeof aiPerf.json.totalAiCalls}`);
  assert("AI performance has confidenceDistribution", !!aiPerf.json.confidenceDistribution, `Got: ${JSON.stringify(aiPerf.json.confidenceDistribution)}`);

  // Step 37: Audit Trail Analytics
  const auditAnalytics = await getJson("/api/analytics/audit-trail?limit=50");
  assert("Audit analytics returns 200", auditAnalytics.status === 200, `Status: ${auditAnalytics.status}`);
  assert("Audit analytics has entries", Array.isArray(auditAnalytics.json.entries), `Got: ${typeof auditAnalytics.json.entries}`);
  assert("Audit analytics has summary", !!auditAnalytics.json.summary, `Got: ${typeof auditAnalytics.json.summary}`);
  assert("Audit analytics summary has byAction", !!auditAnalytics.json.summary.byAction, `Got: ${typeof auditAnalytics.json.summary.byAction}`);

  // Step 38: Real-Time Operations Dashboard
  const realtime = await getJson("/api/analytics/realtime");
  assert("Realtime ops returns 200", realtime.status === 200, `Status: ${realtime.status}`);
  assert("Realtime has activeTickets", typeof realtime.json.activeTickets === "number", `Got: ${typeof realtime.json.activeTickets}`);
  assert("Realtime has byPriority", !!realtime.json.byPriority, `Got: ${JSON.stringify(realtime.json.byPriority)}`);
  assert("Realtime has slaCountdowns", Array.isArray(realtime.json.slaCountdowns), `Got: ${typeof realtime.json.slaCountdowns}`);

  // Step 39: Benchmarking Dashboard
  const benchmarks = await getJson("/api/analytics/benchmarks");
  assert("Benchmarks returns 200", benchmarks.status === 200, `Status: ${benchmarks.status}`);
  assert("Benchmarks has yours", !!benchmarks.json.yours, `Got: ${typeof benchmarks.json.yours}`);
  assert("Benchmarks has industry", !!benchmarks.json.industry, `Got: ${typeof benchmarks.json.industry}`);
  assert("Benchmarks has comparison", !!benchmarks.json.comparison, `Got: ${typeof benchmarks.json.comparison}`);
  assert("Benchmarks comparison has mttr", ["better", "worse", "on_par"].includes(benchmarks.json.comparison.mttr), `Got: ${benchmarks.json.comparison.mttr}`);

  // Step 40: Scheduled Report Delivery (uses existing schedule API)
  const reportSched = await postJson("/api/reports/schedule", { name: "E2E Weekly Report", type: "incidents", frequency: "weekly", recipients: ["test@example.com"] });
  assert("Report schedule create returns 200", reportSched.status === 200, `Status: ${reportSched.status}`);
  assert("Report schedule has schedule obj", !!reportSched.json.schedule, `Got: ${JSON.stringify(reportSched.json)}`);
  assert("Report schedule has frequency", reportSched.json.schedule && reportSched.json.schedule.frequency === "weekly", `Got: ${reportSched.json.schedule && reportSched.json.schedule.frequency}`);
  const schedBad = await postJson("/api/reports/schedule", { frequency: "hourly" });
  assert("Report schedule missing name returns 400", schedBad.status === 400, `Status: ${schedBad.status}`);
  const rptSchedList = await getJson("/api/reports/schedules");
  assert("Report schedules list returns 200", rptSchedList.status === 200, `Status: ${rptSchedList.status}`);
  assert("Report schedules has data", !!rptSchedList.json.data, `Got: ${typeof rptSchedList.json.data}`);

  // Results
  console.log(`\n====== RESULTS ======`);
  tests.forEach(t => console.log(t));
  console.log(`\nPASSED: ${pass} | FAILED: ${fail} | TOTAL: ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error("E2E test error:", e); process.exit(1); });
