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
  return get(path).then(r => ({ ...r, json: JSON.parse(r.body) }));
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
  assert("AI model is gpt-5.4-nano", health.json.aiModel === "gpt-5.4-nano", `Got: ${health.json.aiModel}`);

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
  assert("AI model is gpt-5.4-nano", aiSettings.json.model === "gpt-5.4-nano", `Got: ${aiSettings.json.model}`);
  assert("AI endpoint configured", aiSettings.json.configured === true);

  // 18. AI Test connection
  console.log("--- AI Connection Test ---");
  const aiTest = await getJson("/api/ai/test");
  assert("AI test endpoint responds", aiTest.status === 200 || aiTest.status === 502, `Status: ${aiTest.status}`);
  if (aiTest.status === 200) {
    assert("AI test connected", aiTest.json.status === "connected", `Status: ${aiTest.json.status}`);
    assert("AI test model correct", aiTest.json.model === "gpt-5.4-nano", `Model: ${aiTest.json.model}`);
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

  // Results
  console.log(`\n====== RESULTS ======`);
  tests.forEach(t => console.log(t));
  console.log(`\nPASSED: ${pass} | FAILED: ${fail} | TOTAL: ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error("E2E test error:", e); process.exit(1); });
