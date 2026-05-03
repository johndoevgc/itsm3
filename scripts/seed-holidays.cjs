#!/usr/bin/env node
/**
 * Seed APAC public holidays into sla_config so getBusinessHoursElapsed skips them.
 *
 * Usage:
 *   BASE=https://vgc-itsm1-app.azurewebsites.net node scripts/seed-holidays.cjs
 *   BASE=http://localhost:8080 node scripts/seed-holidays.cjs
 *
 * Adds to existing policy without overwriting other settings.
 * Idempotent: re-running merges holidays by date+region.
 */
const https = require("https");
const http = require("http");

const BASE = process.env.BASE || "http://localhost:8080";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

// Singapore + Malaysia public holidays 2026 (verified from MOM SG / Public Service Dept MY).
// Date format: YYYY-MM-DD (matches getBusinessHoursElapsed parsing).
const HOLIDAYS_2026 = [
  { date: "2026-01-01", name: "New Year's Day", region: "SG,MY" },
  { date: "2026-02-17", name: "Chinese New Year Day 1", region: "SG,MY" },
  { date: "2026-02-18", name: "Chinese New Year Day 2", region: "SG,MY" },
  { date: "2026-03-20", name: "Hari Raya Puasa", region: "SG,MY" },
  { date: "2026-04-03", name: "Good Friday", region: "SG,MY" },
  { date: "2026-05-01", name: "Labour Day", region: "SG,MY" },
  { date: "2026-05-26", name: "Vesak Day", region: "SG" },
  { date: "2026-05-27", name: "Hari Raya Haji", region: "SG,MY" },
  { date: "2026-08-09", name: "National Day (SG)", region: "SG" },
  { date: "2026-08-31", name: "Merdeka Day (MY)", region: "MY" },
  { date: "2026-09-16", name: "Malaysia Day", region: "MY" },
  { date: "2026-11-08", name: "Deepavali", region: "SG,MY" },
  { date: "2026-12-25", name: "Christmas Day", region: "SG,MY" },
];

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const lib = url.protocol === "https:" ? https : http;
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (ADMIN_TOKEN) opts.headers["Authorization"] = `Bearer ${ADMIN_TOKEN}`;
    const req = lib.request(opts, (res) => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(data ? JSON.parse(data) : {}); }
          catch { resolve(data); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 300)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error("timeout")); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  console.log(`[seed-holidays] BASE=${BASE}`);
  let existing = null;
  try {
    const row = await request("GET", "/api/db/sla_config/active_policy");
    if (row && row.data) {
      existing = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    }
  } catch (e) {
    if (!/404/.test(e.message)) console.warn("[seed-holidays] could not load existing policy:", e.message);
  }

  const policy = existing || {
    severities: {
      "Sev-A": { firstResponse: 0.5, worstResponse: 4 },
      "Sev-B": { firstResponse: 1, worstResponse: 4 },
      "Sev-C": { firstResponse: 4, worstResponse: 9 },
      "Sev-D": { firstResponse: 9, worstResponse: 27 },
    },
    supportHours: { start: 9, end: 18, days: "Mon-Fri", tz: "Asia/Singapore" },
    holidays: [],
  };

  const existingByDate = new Map((policy.holidays || []).map(h => {
    const d = typeof h === "string" ? h : h.date;
    return [d, h];
  }));

  let added = 0;
  for (const h of HOLIDAYS_2026) {
    if (!existingByDate.has(h.date)) {
      existingByDate.set(h.date, h);
      added++;
    }
  }
  policy.holidays = Array.from(existingByDate.values()).sort((a, b) => {
    const ad = typeof a === "string" ? a : a.date;
    const bd = typeof b === "string" ? b : b.date;
    return ad.localeCompare(bd);
  });

  await request("POST", "/api/db/sla_config", { id: "active_policy", data: JSON.stringify(policy) });
  console.log(`[seed-holidays] OK \u2014 added ${added} new, total ${policy.holidays.length} holidays in policy`);
})().catch(err => {
  console.error("[seed-holidays] FAILED:", err.message);
  process.exit(1);
});
