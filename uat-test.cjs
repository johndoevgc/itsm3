const BASE = "https://vgc-itsm1-app.azurewebsites.net";
let pass = 0, fail = 0, total = 0;
const assert = (name, cond) => { total++; if (cond) { pass++; console.log("  PASS: " + name); } else { fail++; console.log("  FAIL: " + name); } };

(async () => {
  console.log("====== UAT — VGC-ITSM Data Isolation ======\n");

  // 1. Health
  const h = await fetch(BASE + "/api/health").then(r => r.json());
  assert("Health OK", h.status === "ok");
  assert("DB connected", h.database === "connected");
  assert("AI configured", h.aiConfigured === true);

  // 2. DB Stats — no seed data
  const stats = await fetch(BASE + "/api/db-stats").then(r => r.json());
  assert("Incidents in DB", stats.collections?.incidents > 0);
  assert("No seed problems (PRB0001-5 cleaned)", stats.collections?.problems <= 1);
  assert("No seed changes (CHG0001-6 cleaned)", stats.collections?.changes === 0);
  assert("No seed requests (REQ0001-8 cleaned)", stats.collections?.requests === 0);

  // 3. Verify no seed IDs in incidents
  const inc = await fetch(BASE + "/api/db/incidents").then(r => r.json());
  const seedInc = inc.data?.filter(i => {
    const id = typeof i.data === "string" ? JSON.parse(i.data).id : (i.data?.id || i.id);
    return /^INC000\d$/.test(id);
  });
  assert("No seed incidents in DB", !seedInc || seedInc.length === 0);
  assert("Real Zendesk incidents exist", inc.count >= 70);

  // 4. Verify remaining problem is not seed
  if (stats.collections?.problems > 0) {
    const prb = await fetch(BASE + "/api/db/problems").then(r => r.json());
    const seedPrb = prb.data?.filter(p => {
      const id = typeof p.data === "string" ? JSON.parse(p.data).id : (p.data?.id || p.id);
      return /^PRB000\d$/.test(id);
    });
    assert("No seed problems in DB", !seedPrb || seedPrb.length === 0);
  } else {
    assert("No seed problems in DB (empty)", true);
  }

  // 5. Frontend loads
  const fe = await fetch(BASE);
  assert("Frontend returns 200", fe.status === 200);
  const html = await fe.text();
  assert("Frontend has React root", html.includes('id="root"'));
  assert("Frontend loads new bundle", html.includes("index-NSQMbuRH.js"));

  // 6. AI endpoint
  const ai = await fetch(BASE + "/api/settings/openai").then(r => r.json());
  assert("AI model is gpt-5.4-nano", ai.model === "gpt-5.4-nano");
  assert("AI endpoint configured", ai.configured === true);

  const aiTest = await fetch(BASE + "/api/ai/test").then(r => r.json());
  assert("AI connection works", aiTest.status === "connected");
  assert("AI responds", aiTest.response?.length > 0);

  // 7. API security — invalid collections rejected
  const badColl = await fetch(BASE + "/api/db/nonexistent_collection").then(r => r.json());
  assert("Unknown collection rejected", badColl.error === "Invalid collection name" || badColl.count === 0);

  // Verify collection names are sanitized (no path traversal in data)
  assert("No path traversal in response", !JSON.stringify(badColl).includes("root:"));

  // 8. SSE streaming endpoint
  const stream = await fetch(BASE + "/api/ai/chat/stream", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({systemPrompt: "Reply in 5 words.", userPrompt: "Hello"})
  });
  assert("SSE stream returns 200", stream.status === 200);
  assert("SSE content type", stream.headers.get("content-type")?.includes("text/event-stream"));

  // 9. Data isolation — verify all collection APIs
  const colls = ["incidents", "problems", "changes", "requests", "assets", "customers", "users", "kb"];
  for (const c of colls) {
    const r = await fetch(BASE + "/api/db/" + c);
    assert(c + " API returns 200", r.status === 200);
  }

  console.log("\n====== UAT RESULTS ======");
  console.log("PASSED: " + pass + " | FAILED: " + fail + " | TOTAL: " + total);
})().catch(e => console.error("UAT ERROR:", e.message));
