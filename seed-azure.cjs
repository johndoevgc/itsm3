// seed-azure.cjs — Seeds the Azure MySQL database via API calls
// Usage: node seed-azure.cjs [base-url]
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const BASE = process.argv[2] || "https://vgc-itsm-app.azurewebsites.net";
// SECURITY (#4): refuse to run against production unless explicitly opted in.
if (/vgc-itsm1-app\.azurewebsites\.net/.test(BASE) && process.env.ALLOW_PROD_SEED_WRITES !== "true") {
  console.error(`[seed-azure] Refusing to run against production (${BASE}). Use staging or set ALLOW_PROD_SEED_WRITES=true.`);
  process.exit(2);
}
const isHttps = BASE.startsWith("https");
const client = isHttps ? https : http;

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const data = JSON.stringify(body);
    const req = client.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function apiGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    client.get(url, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try { resolve(JSON.parse(buf)); } catch { resolve(buf); }
      });
    }).on("error", reject);
  });
}

// Extract data from itsm-tool.jsx
function extractArray(src, varName) {
  // Find the array start: const VARNAME = [
  const re = new RegExp(`const\\s+${varName}\\s*=\\s*\\[`);
  const m = src.match(re);
  if (!m) return [];
  const start = m.index + m[0].length - 1; // position of [
  let depth = 0, i = start;
  for (; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") { depth--; if (depth === 0) break; }
  }
  const arrayStr = src.slice(start, i + 1);
  // Convert JS object literals to valid JSON-ish by eval
  try {
    return new Function(`return ${arrayStr}`)();
  } catch (e) {
    console.error(`Failed to parse ${varName}:`, e.message);
    return [];
  }
}

async function main() {
  console.log(`Seeding database at: ${BASE}`);

  // Check health first
  const health = await apiGet("/api/health");
  console.log("Health:", health);
  if (health.status !== "ok") {
    console.error("Server not healthy, aborting");
    process.exit(1);
  }

  // Read JSX source
  const jsxPath = path.join(__dirname, "itsm-tool.jsx");
  const src = fs.readFileSync(jsxPath, "utf8");

  // Extract all data arrays
  const collections = {
    incidents: "INITIAL_INCIDENTS",
    problems: "INITIAL_PROBLEMS",
    changes: "INITIAL_CHANGES",
    assets: "ASSETS",
    services: "SERVICES",
    users: "USERS",
    vendors: "INITIAL_VENDORS",
    kb: "KB_ARTICLES",
    requests: "INITIAL_REQUESTS",
  };

  let totalSeeded = 0;
  for (const [coll, varName] of Object.entries(collections)) {
    const items = extractArray(src, varName);
    if (items.length === 0) {
      console.log(`  ${coll}: skipped (${varName} not found or empty)`);
      continue;
    }
    console.log(`  ${coll}: seeding ${items.length} items...`);
    const result = await apiPost(`/api/db/${coll}`, items);
    console.log(`  ${coll}: ${result.status === 200 ? "OK" : "FAILED"} — ${JSON.stringify(result.body)}`);
    totalSeeded += items.length;
  }

  // Verify
  console.log("\nVerifying...");
  const stats = await apiGet("/api/db-stats");
  console.log("DB Stats:", JSON.stringify(stats, null, 2));
  console.log(`\nTotal seeded: ${totalSeeded} records`);
}

main().catch(e => { console.error("Seed failed:", e); process.exit(1); });
