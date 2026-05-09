const crypto = require("crypto");

const ACTION_FORCE_SIGN_OUT = "forceSignOut";
const RUNBOOK_FORCE_REAUTH = "forceVpnReauth";
const RUNS_COLLECTION = "m365_agent_runs";
const ACTIONS_COLLECTION = "m365_agent_actions";

function parseStoredRecord(row) {
  if (!row) return null;
  const data = row.data !== undefined ? row.data : row;
  if (!data) return null;
  if (typeof data === "string") {
    try { return JSON.parse(data); } catch { return null; }
  }
  return typeof data === "object" ? data : null;
}

function parseStoredRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(parseStoredRecord).filter(Boolean);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeDomain(value) {
  return normalizeKey(value).replace(/^@+/, "");
}

function emailDomain(email) {
  const parts = normalizeKey(email).split("@");
  return parts.length === 2 ? parts[1] : "";
}

function isEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || ""));
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map(v => normalizeText(v)).filter(Boolean);
  if (typeof value === "string") return value.split(/[;,\n]/).map(v => normalizeText(v)).filter(Boolean);
  return [];
}

function customerDomains(customer = {}) {
  const domains = new Set();
  const primaryDomain = normalizeDomain(customer.primaryDomain || customer.domain || customer.emailDomain);
  if (primaryDomain) domains.add(primaryDomain);
  const contactDomain = emailDomain(customer.email);
  if (contactDomain) domains.add(contactDomain);
  for (const alias of normalizeArray(customer.aliasDomains || customer.allowedDomains)) {
    const domain = normalizeDomain(alias);
    if (domain) domains.add(domain);
  }
  return Array.from(domains);
}

function allowedActions(customer = {}) {
  const actions = normalizeArray(customer.allowedM365Actions);
  return actions.length > 0 ? actions : [];
}

function getIncidentCustomerName(incident) {
  return normalizeText(incident && (incident.customer || incident.company || incident.organization));
}

function getIncidentReporterEmail(incident) {
  return normalizeText(incident && (incident.reporterEmail || incident.customerEmail || incident.requesterEmail || incident.email));
}

function findCustomerForIncident(incident, customers) {
  const customerName = normalizeKey(getIncidentCustomerName(incident));
  if (customerName) {
    const byName = customers.find(customer => {
      const candidates = [customer.name, customer.company, customer.organization, customer.displayName].map(normalizeKey).filter(Boolean);
      return candidates.includes(customerName);
    });
    if (byName) return byName;
  }

  const reporterDomain = emailDomain(getIncidentReporterEmail(incident));
  if (reporterDomain) {
    return customers.find(customer => customerDomains(customer).includes(reporterDomain)) || null;
  }
  return null;
}

function makeRunId(prefix = "M365R") {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

function fail(code, message, status = 400, extra = {}) {
  return { ok: false, code, error: message, status, ...extra };
}

async function getIncident(db, incidentId) {
  if (!incidentId) return null;
  return parseStoredRecord(await db.getOne("incidents", incidentId));
}

async function getCustomers(db) {
  return parseStoredRows(await db.getAll("customers"));
}

async function resolveContext({ db, incidentId, targetUpn }) {
  if (!db || typeof db.getOne !== "function" || typeof db.getAll !== "function") {
    return fail("db_unavailable", "Database context unavailable", 500);
  }
  if (!incidentId) return fail("incident_required", "incidentId is required");
  const incident = await getIncident(db, incidentId);
  if (!incident) return fail("incident_not_found", `Incident not found: ${incidentId}`, 404);

  const customers = await getCustomers(db);
  const customer = findCustomerForIncident(incident, customers);
  if (!customer) return fail("customer_not_mapped", "Incident is not mapped to a customer record", 400, { incident });
  if (customer.m365AgentEnabled !== true) return fail("m365_agent_disabled", "M365/Azure expert is not enabled for this customer", 403, { incident, customer });
  if (!normalizeText(customer.m365TenantId || customer.entraTenantId)) return fail("tenant_id_missing", "Customer M365 tenant ID is required before Graph diagnostics can run", 400, { incident, customer });

  const upn = normalizeKey(targetUpn || getIncidentReporterEmail(incident));
  if (!isEmail(upn)) return fail("target_upn_invalid", "A valid target UPN is required", 400, { incident, customer });

  const domains = customerDomains(customer);
  const upnDomain = emailDomain(upn);
  if (!domains.includes(upnDomain)) {
    return fail("target_domain_not_allowed", `Target UPN domain ${upnDomain || "unknown"} is not allowed for ${customer.name || customer.id}`, 403, { incident, customer, domains, upn });
  }

  return { ok: true, incident, customer, targetUpn: upn, domains };
}

function graphCallerForTenant({ graphAppCallForTenant, graphAppCall, tenantId, currentTenantId }) {
  if (typeof graphAppCallForTenant === "function") {
    return (endpoint, extraHeaders, method, body) => graphAppCallForTenant(tenantId, endpoint, extraHeaders, method, body);
  }
  if (typeof graphAppCall === "function" && normalizeKey(tenantId) && normalizeKey(tenantId) === normalizeKey(currentTenantId)) return graphAppCall;
  return null;
}

async function optionalGraphCall(graph, endpoint) {
  try { return { ok: true, data: await graph(endpoint) }; }
  catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }
}

function summarizeSignIns(signIns) {
  const items = Array.isArray(signIns && signIns.value) ? signIns.value : [];
  return items.slice(0, 10).map(item => ({
    id: item.id,
    createdDateTime: item.createdDateTime,
    status: item.status || null,
    conditionalAccessStatus: item.conditionalAccessStatus || null,
    appDisplayName: item.appDisplayName || null,
    clientAppUsed: item.clientAppUsed || null,
    ipAddress: item.ipAddress || null,
    location: item.location || null,
  }));
}

function summarizeAuthMethods(methods) {
  const items = Array.isArray(methods && methods.value) ? methods.value : [];
  return items.map(method => ({
    id: method.id,
    type: method["@odata.type"] || method.type || "unknown",
    displayName: method.displayName || method.phoneNumber || method.emailAddress || null,
  }));
}

function buildFindings({ user, signIns, authMethods, riskyUser }) {
  const findings = [];
  if (user && user.accountEnabled === false) findings.push({ severity: "critical", title: "Account disabled", detail: "The Entra user account is disabled." });
  if (signIns.ok) {
    const recent = summarizeSignIns(signIns.data);
    const failures = recent.filter(item => item.status && item.status.errorCode && item.status.errorCode !== 0);
    const caFailures = recent.filter(item => String(item.conditionalAccessStatus || "").toLowerCase() === "failure");
    if (failures.length > 0) findings.push({ severity: "high", title: "Recent sign-in failures", detail: `${failures.length} recent sign-in failure(s) found.` });
    if (caFailures.length > 0) findings.push({ severity: "high", title: "Conditional Access failure", detail: `${caFailures.length} recent sign-in(s) failed Conditional Access.` });
  } else {
    findings.push({ severity: "info", title: "Sign-in logs unavailable", detail: signIns.error });
  }
  if (authMethods.ok && summarizeAuthMethods(authMethods.data).length === 0) findings.push({ severity: "medium", title: "No authentication methods returned", detail: "Graph returned no registered authentication methods for this user." });
  if (riskyUser.ok && riskyUser.data && riskyUser.data.riskState) findings.push({ severity: "medium", title: "Identity Protection risk signal", detail: `Risk state: ${riskyUser.data.riskState}` });
  if (findings.length === 0) findings.push({ severity: "low", title: "No blocking signal found", detail: "Read-only checks did not find a clear Entra auth blocker." });
  return findings;
}

async function diagnoseEntraSignIn(options) {
  const ctx = await resolveContext(options);
  if (!ctx.ok) return ctx;

  const tenantId = normalizeText(ctx.customer.m365TenantId || ctx.customer.entraTenantId);
  const graph = graphCallerForTenant({ graphAppCallForTenant: options.graphAppCallForTenant, graphAppCall: options.graphAppCall, tenantId, currentTenantId: options.currentTenantId });
  if (!graph) return fail("tenant_graph_unavailable", "Tenant-aware Graph access is not configured for this customer tenant", 503, ctx);

  let user;
  try {
    user = await graph(`/users/${encodeURIComponent(ctx.targetUpn)}?$select=id,displayName,userPrincipalName,mail,accountEnabled,userType,createdDateTime`);
  } catch (err) {
    return fail("user_lookup_failed", err && err.message ? err.message : String(err), 502, ctx);
  }
  if (!user || !user.id) return fail("user_not_found", `User not found: ${ctx.targetUpn}`, 404, ctx);

  const escapedUpn = ctx.targetUpn.replace(/'/g, "''");
  const signInQuery = new URLSearchParams({ "$top": "10", "$orderby": "createdDateTime desc", "$filter": `userPrincipalName eq '${escapedUpn}'` });
  const [signIns, authMethods, riskyUser] = await Promise.all([
    optionalGraphCall(graph, `/auditLogs/signIns?${signInQuery.toString()}`),
    optionalGraphCall(graph, `/users/${encodeURIComponent(user.id)}/authentication/methods`),
    optionalGraphCall(graph, `/identityProtection/riskyUsers/${encodeURIComponent(user.id)}`),
  ]);

  const findings = buildFindings({ user, signIns, authMethods, riskyUser });
  const forceSignOutAllowed = allowedActions(ctx.customer).includes(ACTION_FORCE_SIGN_OUT);
  return {
    ok: true,
    runId: makeRunId(),
    incidentId: options.incidentId,
    incident: ctx.incident,
    targetUpn: ctx.targetUpn,
    customer: {
      id: ctx.customer.id || null,
      name: ctx.customer.name || ctx.customer.company || null,
      primaryDomain: ctx.customer.primaryDomain || ctx.domains[0] || null,
      m365TenantId: tenantId,
      gdapStatus: ctx.customer.gdapStatus || "unknown",
    },
    diagnostics: {
      account: { id: user.id, displayName: user.displayName || null, userPrincipalName: user.userPrincipalName || ctx.targetUpn, mail: user.mail || null, accountEnabled: user.accountEnabled, userType: user.userType || null, createdDateTime: user.createdDateTime || null },
      signIns: { available: signIns.ok, error: signIns.error || null, recent: signIns.ok ? summarizeSignIns(signIns.data) : [] },
      authenticationMethods: { available: authMethods.ok, error: authMethods.error || null, methods: authMethods.ok ? summarizeAuthMethods(authMethods.data) : [] },
      riskyUser: { available: riskyUser.ok, error: riskyUser.error || null, data: riskyUser.ok ? riskyUser.data : null },
    },
    findings,
    recommendedActions: [{ id: ACTION_FORCE_SIGN_OUT, runbookActionId: RUNBOOK_FORCE_REAUTH, label: "Force sign-out", requiresApproval: true, enabled: forceSignOutAllowed, reason: forceSignOutAllowed ? "Allowed for this customer" : "Not enabled on customer record" }],
    generatedAt: new Date().toISOString(),
  };
}

function buildDiagnosticRecord(result, executedBy) {
  return { id: result.runId, type: "entra_signin_diagnostics", status: result.ok ? "completed" : "failed", ok: result.ok, incidentId: result.incidentId || null, targetUpn: result.targetUpn || null, customer: result.customer || null, findings: result.findings || [], diagnostics: result.diagnostics || null, error: result.error || null, code: result.code || null, createdBy: executedBy || "system", createdAt: new Date().toISOString() };
}

function buildActionProposal({ incidentId, targetUpn, customer, diagnosticRunId, requestedBy }) {
  return { id: makeRunId("M365A"), type: "m365_force_sign_out", status: "pending_approval", incidentId, targetUpn, customer: { id: customer.id || null, name: customer.name || customer.company || null, primaryDomain: customer.primaryDomain || customerDomains(customer)[0] || null, m365TenantId: customer.m365TenantId || customer.entraTenantId || null, gdapStatus: customer.gdapStatus || "unknown" }, actionId: ACTION_FORCE_SIGN_OUT, runbookActionId: RUNBOOK_FORCE_REAUTH, diagnosticRunId: diagnosticRunId || null, requiresApprovalRole: "Administrator", requestedBy: requestedBy || "system", requestedAt: new Date().toISOString() };
}

async function appendIncidentActivity(db, incident, entry) {
  if (!db || !incident || !incident.id) return null;
  const activity = { id: `AL-${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`, type: entry.type || "m365_action", user: entry.user || "M365/Azure Expert", time: new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }).replace(",", ""), detail: entry.detail || "M365/Azure Expert update", ...entry.extra };
  const updated = { ...incident, activityLog: [...(incident.activityLog || []), activity] };
  await db.upsert("incidents", incident.id, JSON.stringify(updated));
  return activity;
}

module.exports = { ACTION_FORCE_SIGN_OUT, RUNBOOK_FORCE_REAUTH, RUNS_COLLECTION, ACTIONS_COLLECTION, parseStoredRecord, parseStoredRows, customerDomains, allowedActions, findCustomerForIncident, resolveContext, diagnoseEntraSignIn, buildDiagnosticRecord, buildActionProposal, appendIncidentActivity };