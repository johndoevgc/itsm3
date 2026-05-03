#!/usr/bin/env node
/**
 * Direct-DB seed for SG/MY 2026 holidays into sla_config.active_policy.
 * Bypasses HTTP auth. Idempotent (merges by date string).
 *
 * Required env: MYSQL_HOST MYSQL_USER MYSQL_PASSWORD MYSQL_DATABASE
 */
const mysql = require("mysql2/promise");

const HOLIDAYS_2026 = [
  "2026-01-01", // New Year
  "2026-02-17", // CNY day 1
  "2026-02-18", // CNY day 2
  "2026-03-20", // Hari Raya Puasa
  "2026-04-03", // Good Friday
  "2026-05-01", // Labour Day
  "2026-05-26", // Vesak
  "2026-05-27", // Hari Raya Haji
  "2026-08-09", // SG National Day
  "2026-08-31", // MY Merdeka
  "2026-09-16", // Malaysia Day
  "2026-11-08", // Deepavali
  "2026-12-25", // Christmas
];

(async () => {
  for (const k of ["MYSQL_HOST","MYSQL_USER","MYSQL_PASSWORD","MYSQL_DATABASE"]) {
    if (!process.env[k]) { console.error(`missing env ${k}`); process.exit(2); }
  }
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    ssl: process.env.MYSQL_SSL === "false" ? undefined : { rejectUnauthorized: true },
  });
  console.log(`[seed-holidays-direct] connected to ${process.env.MYSQL_HOST}`);

  const [rows] = await conn.execute(
    "SELECT data FROM itsm_data WHERE collection=? AND id=?",
    ["sla_config", "active_policy"]
  );

  let policy;
  if (rows.length) {
    try {
      policy = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
    } catch (e) { console.warn("parse failed:", e.message); }
  }
  if (!policy || typeof policy !== "object") policy = {};
  if (!Array.isArray(policy.holidays)) policy.holidays = [];

  const set = new Set(policy.holidays.map(h => typeof h === "string" ? h : h.date));
  let added = 0;
  for (const d of HOLIDAYS_2026) {
    if (!set.has(d)) { set.add(d); added++; }
  }
  policy.holidays = Array.from(set).sort();

  const payload = JSON.stringify(policy);
  await conn.execute(
    "INSERT INTO itsm_data (collection, id, data) VALUES (?, ?, ?) " +
    "ON DUPLICATE KEY UPDATE data=VALUES(data)",
    ["sla_config", "active_policy", payload]
  );
  console.log(`[seed-holidays-direct] OK — added ${added} new, total ${policy.holidays.length} holidays.`);
  console.log(`[seed-holidays-direct] holidays: ${policy.holidays.join(", ")}`);
  await conn.end();
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
