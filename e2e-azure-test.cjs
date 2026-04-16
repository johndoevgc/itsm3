// e2e-azure-test.cjs — End-to-end tests against Azure deployment
const https = require("https");

const BASE = "https://vgc-itsm-app.azurewebsites.net";
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
  assert("Entra configured", health.json.entraConfigured === true);

  // 2. DB Stats
  console.log("--- DB Stats ---");
  const stats = await getJson("/api/db-stats");
  assert("DB stats returns collections", stats.json.collections != null);
  assert("27 incidents in DB", stats.json.collections.incidents === 27);
  assert("12 assets in DB", stats.json.collections.assets === 12);
  assert("12 users in DB", stats.json.collections.users === 12);
  assert("3 problems in DB", stats.json.collections.problems === 3);
  assert("3 changes in DB", stats.json.collections.changes === 3);
  assert("15 KB articles in DB", stats.json.collections.kb === 15);
  assert("8 services in DB", stats.json.collections.services === 8);
  assert("4 requests in DB", stats.json.collections.requests === 4);

  // 3. Incidents API
  console.log("--- Incidents API ---");
  const incidents = await getJson("/api/db/incidents");
  assert("Incidents returns 27", incidents.json.count === 27);
  const incIds = incidents.json.data.map(i => i.id).sort();
  assert("INC0001 exists", incIds.includes("INC0001"));
  assert("INC0017 exists", incIds.includes("INC0017"));
  assert("INC0018 exists (new)", incIds.includes("INC0018"));
  assert("INC0027 exists (new)", incIds.includes("INC0027"));

  // 4. Verify all incidents are Closed
  console.log("--- All Incidents Closed ---");
  const allClosed = incidents.json.data.every(i => i.status === "Closed");
  assert("All 27 incidents are Closed", allClosed, `Some not closed: ${incidents.json.data.filter(i => i.status !== "Closed").map(i => i.id + "=" + i.status).join(", ")}`);

  // 5. Verify new incidents (INC0018-INC0027) have complete activity logs
  console.log("--- New Incidents Activity Logs ---");
  for (let n = 18; n <= 27; n++) {
    const id = `INC00${n}`;
    const inc = incidents.json.data.find(i => i.id === id);
    if (inc) {
      assert(`${id} has activity log`, inc.activityLog && inc.activityLog.length >= 8, `${id} activityLog length: ${inc.activityLog ? inc.activityLog.length : 0}`);
      assert(`${id} is Closed`, inc.status === "Closed");
    } else {
      assert(`${id} found in data`, false, "Not found");
    }
  }

  // 6. Verify individual incident detail
  console.log("--- Individual Incident Detail ---");
  const inc18 = await getJson("/api/db/incidents/INC0018");
  assert("INC0018 fetched by ID", inc18.status === 200);
  assert("INC0018 title correct", inc18.json.title.includes("File server"));
  assert("INC0018 has activity log", inc18.json.activityLog.length >= 10);
  assert("INC0018 assigned to Marcus Chen", inc18.json.assignee === "Marcus Chen");

  const inc19 = await getJson("/api/db/incidents/INC0019");
  assert("INC0019 is ransomware alert", inc19.json.title.includes("Ransomware"));
  assert("INC0019 Sev-A priority", inc19.json.priority === "Sev-A");
  assert("INC0019 assigned to Sofia Rodriguez", inc19.json.assignee === "Sofia Rodriguez");

  // 7. Users API
  console.log("--- Users API ---");
  const users = await getJson("/api/db/users");
  assert("Users returns 12", users.json.count === 12);

  // 8. Assets API
  console.log("--- Assets API ---");
  const assets = await getJson("/api/db/assets");
  assert("Assets returns 12", assets.json.count === 12);

  // 9. KB Articles
  console.log("--- KB Articles API ---");
  const kb = await getJson("/api/db/kb");
  assert("KB returns 15", kb.json.count === 15);

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
  const newIncs = incidents.json.data.filter(i => parseInt(i.id.replace("INC", "")) >= 18);
  const engCounts = {};
  newIncs.forEach(i => { engCounts[i.assignee] = (engCounts[i.assignee] || 0) + 1; });
  console.log(`  Engineers: ${JSON.stringify(engCounts)}`);
  assert("Marcus Chen has tickets", (engCounts["Marcus Chen"] || 0) >= 2);
  assert("James Wright has tickets", (engCounts["James Wright"] || 0) >= 2);
  assert("Sofia Rodriguez has tickets", (engCounts["Sofia Rodriguez"] || 0) >= 2);

  // 14. Check customer distribution across new tickets
  console.log("--- Customer Distribution (INC0018-INC0027) ---");
  const custCounts = {};
  newIncs.forEach(i => { const c = i.customer || i.title.split("—")[1]?.trim() || "unknown"; custCounts[c] = (custCounts[c] || 0) + 1; });
  console.log(`  Customers: ${JSON.stringify(custCounts)}`);
  const uniqueCustomers = Object.keys(custCounts).length;
  assert("At least 5 different customers", uniqueCustomers >= 5);

  // 15. Check category diversity
  console.log("--- Category Distribution (INC0018-INC0027) ---");
  const catCounts = {};
  newIncs.forEach(i => { catCounts[i.category] = (catCounts[i.category] || 0) + 1; });
  console.log(`  Categories: ${JSON.stringify(catCounts)}`);
  assert("At least 4 different categories", Object.keys(catCounts).length >= 4);

  // 16. Total activity log count for new incidents
  console.log("--- Activity Log Summary ---");
  const totalNewALs = newIncs.reduce((sum, i) => sum + (i.activityLog?.length || 0), 0);
  console.log(`  Total activity log entries (INC0018-INC0027): ${totalNewALs}`);
  assert("New incidents have 100+ activity logs total", totalNewALs >= 100);

  // Results
  console.log(`\n====== RESULTS ======`);
  tests.forEach(t => console.log(t));
  console.log(`\nPASSED: ${pass} | FAILED: ${fail} | TOTAL: ${pass + fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error("E2E test error:", e); process.exit(1); });
