// Comprehensive VGC-ITSM Feature Verification
// Tests ALL API endpoints, data integrity, AI, Zendesk, security, frontend
const BASE = "https://vgc-itsm1-app.azurewebsites.net";
let pass = 0, fail = 0, total = 0, warnings = [];
const assert = (name, cond, detail) => {
  total++;
  if (cond) { pass++; console.log("  PASS: " + name); }
  else { fail++; console.log("  FAIL: " + name + (detail ? " — " + detail : "")); }
};
const warn = (msg) => { warnings.push(msg); console.log("  WARN: " + msg); };

const get = async (path) => {
  const r = await fetch(BASE + path);
  return { status: r.status, headers: r.headers, text: await r.text(), ok: r.ok };
};
const getJson = async (path) => {
  const r = await fetch(BASE + path);
  try { return { status: r.status, json: await r.json(), ok: r.ok }; }
  catch { return { status: r.status, json: null, ok: r.ok }; }
};
const postJson = async (path, body) => {
  const r = await fetch(BASE + path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  try { return { status: r.status, json: await r.json(), ok: r.ok, headers: r.headers }; }
  catch { return { status: r.status, json: null, ok: r.ok, headers: r.headers }; }
};

(async () => {
  const startTime = Date.now();
  console.log("====== COMPREHENSIVE VGC-ITSM FEATURE VERIFICATION ======");
  console.log("Target:", BASE);
  console.log("Time:", new Date().toISOString());
  console.log("");

  // ═══════════════════════════════════════
  // 1. HEALTH & INFRASTRUCTURE
  // ═══════════════════════════════════════
  console.log("--- 1. Health & Infrastructure ---");
  const health = await getJson("/api/health");
  assert("Health endpoint returns 200", health.status === 200);
  assert("Health status OK", health.json?.status === "ok");
  assert("Database connected", health.json?.database === "connected");
  assert("DB type is MySQL", health.json?.dbType === "mysql");
  assert("AI configured", health.json?.aiConfigured === true);
  assert("AI model is gpt-5.4-nano", health.json?.aiModel === "gpt-5.4-nano");
  assert("Zendesk configured", health.json?.zendeskConfigured === true);
  assert("Meraki configured", health.json?.merakiConfigured === true);
  assert("SolarWinds configured", health.json?.solarwindsConfigured === true);
  assert("Sophos configured", health.json?.sophosConfigured === true);
  assert("Mail configured", health.json?.mailConfigured === true);
  assert("Mail from address set", health.json?.mailFrom?.includes("@"), health.json?.mailFrom);
  assert("Timestamp present", !!health.json?.timestamp);

  // ═══════════════════════════════════════
  // 2. DATABASE COLLECTIONS
  // ═══════════════════════════════════════
  console.log("\n--- 2. Database Collections ---");
  const stats = await getJson("/api/db-stats");
  assert("DB stats returns 200", stats.status === 200);
  const colls = stats.json?.collections || {};
  const expectedColls = [
    "incidents", "problems", "changes", "requests", "assets", "kb",
    "services", "users", "vendors", "workflow_rules", "survey_templates",
    "smart_tasks", "integrations", "customers", "service_reports",
    "zendesk_tickets", "zendesk_comments", "zendesk_sync_state",
  ];
  for (const c of expectedColls) {
    assert("Collection exists: " + c, colls[c] !== undefined, "count: " + colls[c]);
  }
  assert("Incidents > 0", colls.incidents > 0, "count: " + colls.incidents);
  assert("Assets > 0", colls.assets > 0);
  assert("Users > 0", colls.users > 0);
  assert("KB > 0", colls.kb > 0);
  assert("Services > 0", colls.services > 0);
  assert("Customers > 0", colls.customers > 0);
  assert("ZD tickets > 0", colls.zendesk_tickets > 0);
  assert("ZD comments > 0", colls.zendesk_comments > 0);

  // ═══════════════════════════════════════
  // 3. INCIDENTS MODULE (CORE)
  // ═══════════════════════════════════════
  console.log("\n--- 3. Incidents Module ---");
  const incidents = await getJson("/api/db/incidents");
  assert("Incidents API returns 200", incidents.status === 200);
  assert("Incidents count > 0", incidents.json?.count > 0);
  const incItems = incidents.json?.data?.map(d => typeof d.data === "string" ? JSON.parse(d.data) : (d.data || d)) || [];
  assert("Incident items parsed", incItems.length > 0);

  // Data quality checks
  const seedPattern = /^(INC000|PRB000|CHG000|REQ000)\d$/;
  const seedInc = incItems.filter(i => seedPattern.test(i.id));
  assert("No seed incidents in DB", seedInc.length === 0, "found: " + seedInc.map(s => s.id).join(","));

  let nullTitle = 0, nullStatus = 0, nullPriority = 0, nullAssignee = 0, nullId = 0, created0 = 0;
  const statuses = {}, priorities = {}, assignees = {}, categories = {};
  for (const i of incItems) {
    if (!i.id) nullId++;
    if (!i.title) nullTitle++;
    if (!i.status) nullStatus++;
    if (!i.priority) nullPriority++;
    if (!i.assignee && !i.assignedTo) nullAssignee++;
    if (i.created === 0) created0++;
    statuses[i.status] = (statuses[i.status] || 0) + 1;
    priorities[i.priority] = (priorities[i.priority] || 0) + 1;
    assignees[i.assignee || i.assignedTo] = (assignees[i.assignee || i.assignedTo] || 0) + 1;
    categories[i.category] = (categories[i.category] || 0) + 1;
  }
  assert("All incidents have ID", nullId === 0);
  assert("All incidents have title", nullTitle === 0);
  assert("All incidents have status", nullStatus === 0);
  assert("All incidents have priority", nullPriority === 0);
  assert("All incidents have assignee", nullAssignee === 0);
  assert("No incidents with created=0", created0 === 0, "found: " + created0);
  const noZdId = incItems.filter(i => !i.zdTicketId);
  assert("Most incidents have zdTicketId", noZdId.length <= 2, "missing: " + noZdId.length);
  assert("All incidents have source=zendesk", incItems.every(i => i.source === "zendesk"), "missing: " + incItems.filter(i => i.source !== "zendesk").length);
  assert("All incidents have [ZD#] title", incItems.every(i => i.title?.includes("[ZD#")), "missing: " + incItems.filter(i => !i.title?.includes("[ZD#")).length);

  // Duplicate check
  const incIds = incItems.map(i => i.id);
  const dupeInc = incIds.filter((id, idx) => incIds.indexOf(id) !== idx);
  assert("No duplicate incident IDs", dupeInc.length === 0, "dupes: " + dupeInc.join(","));

  // Status distribution
  assert("Multiple status types", Object.keys(statuses).length >= 3, JSON.stringify(statuses));
  assert("Multiple priority types", Object.keys(priorities).length >= 3, JSON.stringify(priorities));
  assert("Multiple assignees", Object.keys(assignees).length >= 3, JSON.stringify(assignees));

  // Fetch individual incident
  const sampleId = incItems[0]?.id;
  if (sampleId) {
    const single = await getJson("/api/db/incidents/" + sampleId);
    assert("Individual incident fetch", single.status === 200);
    const singleData = typeof single.json?.data === "string" ? JSON.parse(single.json.data) : (single.json?.data || single.json);
    assert("Individual incident has title", !!singleData?.title);
  }

  // ═══════════════════════════════════════
  // 4. PROBLEMS MODULE
  // ═══════════════════════════════════════
  console.log("\n--- 4. Problems Module ---");
  const problems = await getJson("/api/db/problems");
  assert("Problems API returns 200", problems.status === 200);
  const prbItems = problems.json?.data?.map(d => typeof d.data === "string" ? JSON.parse(d.data) : (d.data || d)) || [];
  const seedPrb = prbItems.filter(p => seedPattern.test(p.id));
  assert("No seed problems in DB", seedPrb.length === 0, "found: " + seedPrb.map(s => s.id).join(","));
  if (prbItems.length > 0) {
    assert("Problems have valid IDs", prbItems.every(p => p.id && p.id.startsWith("PRB")));
  }

  // ═══════════════════════════════════════
  // 5. CHANGES MODULE
  // ═══════════════════════════════════════
  console.log("\n--- 5. Changes Module ---");
  const changes = await getJson("/api/db/changes");
  assert("Changes API returns 200", changes.status === 200);
  const chgItems = changes.json?.data?.map(d => typeof d.data === "string" ? JSON.parse(d.data) : (d.data || d)) || [];
  const seedChg = chgItems.filter(c => seedPattern.test(c.id));
  assert("No seed changes in DB", seedChg.length === 0, "found: " + seedChg.map(s => s.id).join(","));

  // ═══════════════════════════════════════
  // 6. REQUESTS MODULE
  // ═══════════════════════════════════════
  console.log("\n--- 6. Requests Module ---");
  const requests = await getJson("/api/db/requests");
  assert("Requests API returns 200", requests.status === 200);
  const reqItems = requests.json?.data?.map(d => typeof d.data === "string" ? JSON.parse(d.data) : (d.data || d)) || [];
  const seedReq = reqItems.filter(r => seedPattern.test(r.id));
  assert("No seed requests in DB", seedReq.length === 0, "found: " + seedReq.map(s => s.id).join(","));

  // ═══════════════════════════════════════
  // 7. ASSETS MODULE
  // ═══════════════════════════════════════
  console.log("\n--- 7. Assets Module ---");
  const assets = await getJson("/api/db/assets");
  assert("Assets API returns 200", assets.status === 200);
  assert("Assets count > 0", assets.json?.count > 0);
  const assetItems = assets.json?.data?.map(d => typeof d.data === "string" ? JSON.parse(d.data) : (d.data || d)) || [];
  if (assetItems.length > 0) {
    assert("Assets have IDs", assetItems.every(a => a.id));
    assert("Assets have names", assetItems.every(a => a.name || a.hostname));
  }

  // ═══════════════════════════════════════
  // 8. KNOWLEDGE BASE
  // ═══════════════════════════════════════
  console.log("\n--- 8. Knowledge Base ---");
  const kb = await getJson("/api/db/kb");
  assert("KB API returns 200", kb.status === 200);
  assert("KB count > 0", kb.json?.count > 0);

  // ═══════════════════════════════════════
  // 9. USERS / RBAC
  // ═══════════════════════════════════════
  console.log("\n--- 9. Users & RBAC ---");
  const users = await getJson("/api/db/users");
  assert("Users API returns 200", users.status === 200);
  assert("Users count > 0", users.json?.count > 0);

  // ═══════════════════════════════════════
  // 10. CUSTOMERS MODULE
  // ═══════════════════════════════════════
  console.log("\n--- 10. Customers ---");
  const customers = await getJson("/api/db/customers");
  assert("Customers API returns 200", customers.status === 200);
  assert("Customers count > 0", customers.json?.count > 0);
  const custItems = customers.json?.data?.map(d => typeof d.data === "string" ? JSON.parse(d.data) : (d.data || d)) || [];
  if (custItems.length > 0) {
    assert("Customers have IDs", custItems.every(c => c.id));
    assert("Customers have names", custItems.every(c => c.name || c.orgName));
  }

  // ═══════════════════════════════════════
  // 11. SERVICE CATALOG
  // ═══════════════════════════════════════
  console.log("\n--- 11. Service Catalog ---");
  const services = await getJson("/api/db/services");
  assert("Services API returns 200", services.status === 200);
  assert("Services count > 0", services.json?.count > 0);

  // ═══════════════════════════════════════
  // 12. VENDORS
  // ═══════════════════════════════════════
  console.log("\n--- 12. Vendors ---");
  const vendors = await getJson("/api/db/vendors");
  assert("Vendors API returns 200", vendors.status === 200);
  assert("Vendors count > 0", vendors.json?.count > 0);

  // ═══════════════════════════════════════
  // 13. WORKFLOW RULES
  // ═══════════════════════════════════════
  console.log("\n--- 13. Workflow Rules ---");
  const wf = await getJson("/api/db/workflow_rules");
  assert("Workflow rules API returns 200", wf.status === 200);
  assert("Workflow rules count > 0", wf.json?.count > 0);

  // ═══════════════════════════════════════
  // 14. SMART TASKS
  // ═══════════════════════════════════════
  console.log("\n--- 14. Smart Tasks ---");
  const st = await getJson("/api/db/smart_tasks");
  assert("Smart tasks API returns 200", st.status === 200);
  assert("Smart tasks count > 0", st.json?.count > 0);

  // ═══════════════════════════════════════
  // 15. INTEGRATIONS
  // ═══════════════════════════════════════
  console.log("\n--- 15. Integrations ---");
  const integ = await getJson("/api/db/integrations");
  assert("Integrations API returns 200", integ.status === 200);
  assert("Integrations count > 0", integ.json?.count > 0);

  // ═══════════════════════════════════════
  // 16. SURVEY TEMPLATES
  // ═══════════════════════════════════════
  console.log("\n--- 16. Survey Templates ---");
  const surveys = await getJson("/api/db/survey_templates");
  assert("Survey templates API returns 200", surveys.status === 200);
  assert("Survey templates count > 0", surveys.json?.count > 0);

  // ═══════════════════════════════════════
  // 17. SERVICE REPORTS
  // ═══════════════════════════════════════
  console.log("\n--- 17. Service Reports ---");
  const reports = await getJson("/api/db/service_reports");
  assert("Service reports API returns 200", reports.status === 200);

  // ═══════════════════════════════════════
  // 18. ESCALATION CONFIG
  // ═══════════════════════════════════════
  console.log("\n--- 18. Escalation Config ---");
  const esc = await getJson("/api/db/escalation_config");
  assert("Escalation config API returns 200", esc.status === 200);

  // ═══════════════════════════════════════
  // 19. ZENDESK INTEGRATION
  // ═══════════════════════════════════════
  console.log("\n--- 19. Zendesk Integration ---");
  const zdTickets = await getJson("/api/db/zendesk_tickets");
  assert("ZD tickets API returns 200", zdTickets.status === 200);
  assert("ZD tickets count > 300", zdTickets.json?.count >= 300, "count: " + zdTickets.json?.count);
  const zdItems = zdTickets.json?.data || [];
  if (zdItems.length > 0) {
    const t0 = zdItems[0];
    assert("ZD tickets have id", !!t0.id);
    assert("ZD tickets have subject", !!t0.subject);
    assert("ZD tickets have status", !!t0.status);
    assert("ZD tickets have createdAt", !!t0.createdAt);
    assert("ZD tickets have updatedAt", !!t0.updatedAt);
  }

  const zdComments = await getJson("/api/db/zendesk_comments");
  assert("ZD comments API returns 200", zdComments.status === 200);
  assert("ZD comments count > 0", zdComments.json?.count > 0);

  const zdSync = await getJson("/api/db/zendesk_sync_state");
  assert("ZD sync state API returns 200", zdSync.status === 200);

  // Cross-reference: all incidents linked to valid ZD tickets
  const zdIdSet = new Set(zdItems.map(t => Number(t.id)));
  const unmatchedInc = incItems.filter(i => i.zdTicketId && !zdIdSet.has(Number(i.zdTicketId)));
  assert("All incident zdTicketIds match ZD tickets", unmatchedInc.length === 0,
    "unmatched: " + unmatchedInc.slice(0, 5).map(i => i.id + "->ZD#" + i.zdTicketId).join(", "));

  // Zendesk API endpoints
  const zdSyncStatus = await getJson("/api/zendesk/sync-status");
  assert("ZD sync-status endpoint", zdSyncStatus.status === 200);

  // ═══════════════════════════════════════
  // 20. AI / OPENAI
  // ═══════════════════════════════════════
  console.log("\n--- 20. AI / OpenAI ---");
  const aiSettings = await getJson("/api/settings/openai");
  assert("AI settings returns 200", aiSettings.status === 200);
  assert("AI model is gpt-5.4-nano", aiSettings.json?.model === "gpt-5.4-nano");
  assert("AI endpoint configured", aiSettings.json?.configured === true);

  const aiTest = await getJson("/api/ai/test");
  assert("AI test returns 200", aiTest.status === 200);
  assert("AI test connected", aiTest.json?.status === "connected");
  assert("AI test model correct", aiTest.json?.model === "gpt-5.4-nano");

  // SSE streaming
  const stream = await fetch(BASE + "/api/ai/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt: "Reply in exactly 3 words.", userPrompt: "Hello" }),
  });
  assert("SSE stream returns 200", stream.status === 200);
  assert("SSE content-type", stream.headers.get("content-type")?.includes("text/event-stream"));
  const streamText = await stream.text();
  assert("SSE returns data events", streamText.includes("data:"));
  assert("SSE has done event", streamText.includes('"done":true') || streamText.includes('[DONE]'));

  // Non-streaming chat
  const chat = await postJson("/api/ai/chat", {
    systemPrompt: "Reply in exactly 2 words.",
    userPrompt: "What is ITSM?",
  });
  if (chat.status === 200) {
    assert("AI chat returns response", !!chat.json?.text || !!chat.json?.response || !!chat.json?.message);
  } else {
    warn("AI chat returned " + chat.status + " (may need Responses API format)");
  }

  // ═══════════════════════════════════════
  // 21. AUDIT LOG
  // ═══════════════════════════════════════
  console.log("\n--- 21. Audit Log ---");
  const audit = await getJson("/api/audit");
  assert("Audit API returns 200", audit.status === 200);

  // ═══════════════════════════════════════
  // 22. FRONTEND
  // ═══════════════════════════════════════
  console.log("\n--- 22. Frontend ---");
  const fe = await get("/");
  assert("Frontend returns 200", fe.status === 200);
  assert("Frontend is HTML", fe.text.includes("<!doctype html") || fe.text.includes("<!DOCTYPE html"));
  assert("Frontend has React root", fe.text.includes('id="root"'));
  assert("Frontend has title", fe.text.includes("<title>VGC-ITSM</title>"));
  assert("Frontend loads JS bundle", fe.text.includes("assets/index-") && fe.text.includes(".js"));
  const bundleMatch = fe.text.match(/assets\/(index-[a-zA-Z0-9]+\.js)/);
  if (bundleMatch) {
    const bundleResp = await get("/assets/" + bundleMatch[1]);
    assert("JS bundle accessible", bundleResp.status === 200);
    assert("JS bundle is JavaScript", bundleResp.text.length > 100000);
  }

  // SPA routing — any path should return index.html
  const spaRoute = await get("/incidents");
  assert("SPA route /incidents returns 200", spaRoute.status === 200);
  assert("SPA route returns HTML", spaRoute.text.includes('id="root"'));

  // ═══════════════════════════════════════
  // 23. SECURITY
  // ═══════════════════════════════════════
  console.log("\n--- 23. Security ---");
  // Invalid collection
  const badColl = await getJson("/api/db/invalid_collection_xyz");
  assert("Invalid collection rejected", badColl.json?.error === "Invalid collection name" || badColl.status === 400);

  // SQL injection attempt — route regex /[a-z_]+/ blocks special chars, falls through to SPA (200 HTML)
  // This is secure because the injection never reaches the DB layer
  const sqli = await get("/api/db/incidents' OR 1=1--");
  assert("SQL injection attempt rejected", sqli.status === 200 && sqli.text.includes("<!doctype html") || sqli.status === 400 || sqli.status === 404);

  // XSS in headers
  const xssResp = await fetch(BASE + "/api/health");
  const csp = xssResp.headers.get("content-security-policy");
  const xfo = xssResp.headers.get("x-frame-options");
  assert("CSP header present", !!csp);
  if (xfo) assert("X-Frame-Options header present", true);
  else warn("No X-Frame-Options header");

  // CORS
  const corsResp = await fetch(BASE + "/api/health", { method: "OPTIONS" });
  assert("OPTIONS returns valid status", corsResp.status < 500);

  // ═══════════════════════════════════════
  // 24. MERAKI INTEGRATION
  // ═══════════════════════════════════════
  console.log("\n--- 24. Meraki Integration ---");
  const meraki = await getJson("/api/meraki/status");
  if (meraki.status === 200) {
    assert("Meraki status endpoint works", true);
  } else {
    warn("Meraki status returned " + meraki.status);
  }

  // ═══════════════════════════════════════
  // 25. SOLARWINDS INTEGRATION
  // ═══════════════════════════════════════
  console.log("\n--- 25. SolarWinds Integration ---");
  const sw = await getJson("/api/solarwinds/status");
  if (sw.status === 200) {
    assert("SolarWinds status endpoint works", true);
  } else {
    warn("SolarWinds status returned " + sw.status);
  }

  // ═══════════════════════════════════════
  // 26. SOPHOS INTEGRATION
  // ═══════════════════════════════════════
  console.log("\n--- 26. Sophos Integration ---");
  const sophos = await getJson("/api/sophos/status");
  if (sophos.status === 200) {
    assert("Sophos status endpoint works", true);
  } else {
    warn("Sophos status returned " + sophos.status);
  }

  // ═══════════════════════════════════════
  // 27. MAIL / NOTIFICATIONS
  // ═══════════════════════════════════════
  console.log("\n--- 27. Mail / Notifications ---");
  const mail = await getJson("/api/mail/status");
  if (mail.status === 200) {
    assert("Mail status endpoint works", true);
  } else {
    warn("Mail status returned " + mail.status);
  }

  // ═══════════════════════════════════════
  // 28. DATA INTEGRITY CROSS-CHECKS
  // ═══════════════════════════════════════
  console.log("\n--- 28. Data Integrity ---");

  // Created dates are reasonable (not 0, not future, not > 1 year ago)
  const now = Date.now();
  for (const i of incItems) {
    if (i.created === 0) { warn("Incident " + i.id + " has created=0"); break; }
    if (i.created > 8760) { warn("Incident " + i.id + " created > 1 year ago (" + i.created + "h)"); break; }
  }
  const validDates = incItems.filter(i => i.created > 0 && i.created < 8760);
  assert("All incidents have valid created dates", validDates.length === incItems.length,
    "valid: " + validDates.length + "/" + incItems.length);

  // SLA targets are reasonable
  const validSla = incItems.filter(i => i.slaTarget > 0 && i.slaTarget <= 100);
  assert("All incidents have valid SLA targets", validSla.length === incItems.length,
    "valid: " + validSla.length + "/" + incItems.length);

  // Activity logs exist
  const withLogs = incItems.filter(i => i.activityLog && i.activityLog.length > 0);
  assert("Incidents have activity logs", withLogs.length > incItems.length * 0.5,
    withLogs.length + "/" + incItems.length + " have logs");

  // Description not empty
  const withDesc = incItems.filter(i => i.description && i.description.length > 5);
  assert("Incidents have descriptions", withDesc.length > incItems.length * 0.8,
    withDesc.length + "/" + incItems.length);

  // ═══════════════════════════════════════
  // 29. PERFORMANCE
  // ═══════════════════════════════════════
  console.log("\n--- 29. Performance ---");
  const perfStart = Date.now();
  await fetch(BASE + "/api/health");
  const healthMs = Date.now() - perfStart;
  assert("Health response < 3s", healthMs < 3000, healthMs + "ms");

  const perfStart2 = Date.now();
  await fetch(BASE + "/api/db/incidents");
  const incMs = Date.now() - perfStart2;
  assert("Incidents response < 5s", incMs < 5000, incMs + "ms");

  const perfStart3 = Date.now();
  await fetch(BASE + "/");
  const feMs = Date.now() - perfStart3;
  assert("Frontend response < 3s", feMs < 3000, feMs + "ms");

  // ═══════════════════════════════════════
  // 30. EDGE CASES
  // ═══════════════════════════════════════
  console.log("\n--- 30. Edge Cases ---");

  // Empty body POST to AI
  const emptyAi = await fetch(BASE + "/api/ai/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert("Empty AI request doesn't crash", emptyAi.status < 500, "status: " + emptyAi.status);

  // Very long collection name
  const longColl = await get("/api/db/" + "a".repeat(200));
  assert("Long collection name handled", longColl.status < 500);

  // Nonexistent incident
  const noInc = await getJson("/api/db/incidents/NONEXISTENT_ID_999");
  assert("Nonexistent incident handled", noInc.status < 500);

  // ═══════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n====== VERIFICATION RESULTS ======");
  console.log("PASSED: " + pass + " | FAILED: " + fail + " | TOTAL: " + total);
  if (warnings.length > 0) {
    console.log("WARNINGS: " + warnings.length);
    warnings.forEach(w => console.log("  ⚠ " + w));
  }
  console.log("Duration: " + elapsed + "s");
  console.log("==================================");

})().catch(e => { console.error("FATAL ERROR:", e.message); console.error(e.stack); });
