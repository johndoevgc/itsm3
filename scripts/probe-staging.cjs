// scripts/probe-staging.cjs — quick smoke test of new admin endpoints on staging
const https = require("https");
const HOST = "vgc-itsm1-app-staging.azurewebsites.net";
// SECURITY (#8 follow-up, 2026-05-03): hardcoded fallback hash removed.
const HASH = process.env.STG_HASH;
if (!HASH) {
  console.error("[probe-staging] STG_HASH env var not set. Aborting.");
  process.exit(2);
}
const AUTH = `Bearer local-hash:${HASH}`;

function req(method, path, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { Authorization: AUTH };
    if (data) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(data);
    }
    const r = https.request({ hostname: HOST, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => resolve({ s: res.statusCode, b: buf.slice(0, 400) }));
    });
    r.on("error", (e) => resolve({ err: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const h = await req("GET", "/api/health");
  console.log("health", h.s, h.b.slice(0, 120));

  const a = await req("POST", "/api/admin/purge-audit-records", { dryRun: true, targets: { incidents: ["NOPE"] } });
  console.log("audit", a.s, a.b);

  const p = await req("POST", "/api/purge-test-data", { dryRun: true, targets: { incidents: ["NOPE"] } });
  console.log("purge", p.s, p.b);

  // No-auth test should be 403
  const noauth = await new Promise((resolve) => {
    const data = JSON.stringify({ dryRun: true, targets: { incidents: ["NOPE"] } });
    const r2 = https.request({
      hostname: HOST, path: "/api/admin/purge-audit-records", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let buf = ""; res.on("data", c => buf += c);
      res.on("end", () => resolve({ s: res.statusCode, b: buf.slice(0, 200) }));
    });
    r2.on("error", () => resolve({ err: "x" }));
    r2.write(data); r2.end();
  });
  console.log("noauth", noauth.s, noauth.b);
})();
