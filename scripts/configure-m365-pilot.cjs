#!/usr/bin/env node
const mysql = require("mysql2/promise");

const REQUIRED = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE", "M365_TENANT_ID"];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

function boolEnv(name, defaultValue) {
  if (process.env[name] === undefined) return defaultValue;
  return String(process.env[name]).toLowerCase() === "true";
}

function normalizeEnv(value) {
  const v = String(value || "staging").toLowerCase();
  return v === "production" ? "prod" : v;
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function emailDomain(email) {
  const parts = normalizeKey(email).split("@");
  return parts.length === 2 ? parts[1] : "";
}

function customerDomains(customer = {}) {
  const domains = new Set();
  for (const value of [customer.primaryDomain, customer.domain, customer.emailDomain, emailDomain(customer.email)]) {
    const domain = normalizeKey(value).replace(/^@+/, "");
    if (domain) domains.add(domain);
  }
  for (const list of [customer.aliasDomains, customer.allowedDomains]) {
    if (Array.isArray(list)) list.forEach(item => { const domain = normalizeKey(item).replace(/^@+/, ""); if (domain) domains.add(domain); });
  }
  return Array.from(domains);
}

function testIncidentId(upn) {
  const local = normalizeKey(upn).split("@")[0].replace(/[^a-z0-9]/g, "").toUpperCase().slice(0, 24) || "USER";
  return `M365-PILOT-${local}`;
}

async function main() {
  for (const name of REQUIRED) requireEnv(name);

  const targetEnv = normalizeEnv(process.env.TARGET_ENV || "staging");
  if (!["staging", "prod"].includes(targetEnv)) throw new Error("TARGET_ENV must be staging or prod");

  const tenantId = requireEnv("M365_TENANT_ID");
  const primaryDomain = normalizeKey(process.env.M365_PRIMARY_DOMAIN || "vgcsg.com");
  const customerName = process.env.M365_CUSTOMER_NAME || "VGC SG";
  const testUpns = String(process.env.M365_TEST_UPNS || "app1@vgcsg.com,app2@vgcsg.com")
    .split(/[;,\n]/).map(v => normalizeKey(v)).filter(Boolean);
  const enableFlags = boolEnv("ENABLE_M365_FLAGS", targetEnv === "staging");
  const createTestIncidents = boolEnv("CREATE_TEST_INCIDENTS", targetEnv === "staging");
  const scope = targetEnv === "prod" ? "prod" : "staging";
  const now = new Date().toISOString();
  const userName = `m365-pilot-config/${targetEnv}`;

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    ssl: process.env.MYSQL_SSL === "false" ? undefined : { rejectUnauthorized: true },
  });

  async function getAll(collection) {
    const [rows] = await conn.execute("SELECT id, data FROM itsm_data WHERE collection=?", [collection]);
    return rows.map(row => ({ id: row.id, data: parseJson(row.data) })).filter(row => row.data);
  }

  async function upsert(collection, id, data) {
    await conn.execute(
      "INSERT INTO itsm_data (collection, id, data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data=VALUES(data), updated_at=CURRENT_TIMESTAMP",
      [collection, id, JSON.stringify(data)]
    );
  }

  async function audit(collection, id, action, data) {
    await conn.execute(
      "INSERT INTO audit_log (collection, record_id, action, data, user_name) VALUES (?, ?, ?, ?, ?)",
      [collection, id, action, JSON.stringify(data || {}), userName]
    );
  }

  const customers = await getAll("customers");
  const existingCustomer = customers.find(row => {
    const c = row.data;
    const names = [c.name, c.company, c.organization, c.displayName].map(normalizeKey).filter(Boolean);
    return names.includes(normalizeKey(customerName)) || customerDomains(c).includes(primaryDomain);
  });

  const customerId = existingCustomer?.id || "CUS-M365-VGCSG";
  const existing = existingCustomer?.data || {};
  const notes = String(existing.notes || "");
  const noteLine = `M365/Azure Expert pilot configured ${now} for ${primaryDomain}.`;
  const customer = {
    id: customerId,
    name: existing.name || customerName,
    category: existing.category || "CSP",
    contactPerson: existing.contactPerson || "VGC SG IT Admin",
    email: existing.email || `helpdesk@${primaryDomain}`,
    phone: existing.phone || "",
    address: existing.address || "",
    status: existing.status || "Active",
    services: Array.isArray(existing.services) ? existing.services : ["Microsoft 365", "Azure"],
    ...existing,
    primaryDomain,
    m365TenantId: tenantId,
    partnerCustomerId: existing.partnerCustomerId || "",
    gdapStatus: "ready",
    m365AgentEnabled: true,
    allowedM365Actions: Array.from(new Set([...(Array.isArray(existing.allowedM365Actions) ? existing.allowedM365Actions : []), "forceSignOut"])),
    notes: notes.includes("M365/Azure Expert pilot configured") ? notes : [notes, noteLine].filter(Boolean).join("\n"),
    updatedAt: now,
  };
  await upsert("customers", customerId, customer);
  await audit("customers", customerId, existingCustomer ? "m365_pilot_update" : "m365_pilot_create", { primaryDomain, tenantId, targetEnv });

  const flags = [];
  if (enableFlags) {
    flags.push(
      { id: "m365_agent.enabled", enabled: true, scope, payload: { pilotDomains: [primaryDomain] } },
      { id: "m365_agent.entraDiagnostics", enabled: true, scope, payload: { maxSignIns: 10 } },
      { id: "self_healing.forceVpnReauth", enabled: true, scope, payload: { shadowOnly: true, dailyCap: 20 } }
    );
    for (const flag of flags) {
      await upsert("feature_flags", flag.id, { ...flag, updatedAt: now });
      await audit("feature_flags", flag.id, "m365_pilot_set", { enabled: flag.enabled, scope: flag.scope, payload: flag.payload });
    }
  }

  const incidents = [];
  if (createTestIncidents) {
    const existingIncidents = new Map((await getAll("incidents")).map(row => [row.id, row.data]));
    for (const upn of testUpns) {
      if (emailDomain(upn) !== primaryDomain) throw new Error(`test UPN outside ${primaryDomain}: ${upn}`);
      const id = testIncidentId(upn);
      const prev = existingIncidents.get(id) || {};
      const activityLog = Array.isArray(prev.activityLog) ? prev.activityLog : [];
      const incident = {
        id,
        title: `M365/Azure Expert pilot - Entra sign-in check for ${upn}`,
        description: "Staging pilot incident for read-only Entra diagnostics. Inserted directly in DB to avoid customer email side effects.",
        priority: "Sev-D",
        category: "Access Management",
        status: prev.status || "Open",
        customer: customer.name,
        company: customer.name,
        reporterEmail: upn,
        requesterEmail: upn,
        contactEmail: upn,
        assignedTeam: prev.assignedTeam || "Service Desk",
        assignee: prev.assignee || "Service Desk",
        source: "m365-agent-pilot",
        environment: targetEnv,
        createdAt: prev.createdAt || now,
        updatedAt: now,
        activityLog: activityLog.some(item => item.type === "m365_pilot") ? activityLog : [
          ...activityLog,
          { id: `AL-${Date.now()}-${id}`, type: "m365_pilot", user: userName, time: now, detail: "M365/Azure Expert pilot test incident created without API-side email sends." },
        ],
      };
      await upsert("incidents", id, incident);
      await audit("incidents", id, prev.id ? "m365_pilot_update" : "m365_pilot_create", { upn, customerId, targetEnv });
      incidents.push(id);
    }
  }

  await conn.end();
  console.log(JSON.stringify({ ok: true, targetEnv, customerId, primaryDomain, flags: flags.map(f => f.id), incidents }, null, 2));
}

main().catch(err => {
  console.error(`[configure-m365-pilot] FAILED: ${err.message}`);
  process.exit(1);
});