/**
 * ITSM data validation — Phase 5 (zero-dependency)
 * Validates input for top collections at system boundaries.
 * No external dependencies — runs on Azure App Service without node_modules.
 */

// ─── Helpers ────────────────────────────────────────────────────────────
function isStr(v) { return typeof v === "string"; }
function isOptStr(v, max) { max = max || 5000; return v === undefined || v === null || v === "" || (isStr(v) && v.length <= max); }
function isNonEmpty(v, max) { max = max || 5000; return isStr(v) && v.length >= 1 && v.length <= max; }
function isEnum(v, vals) { return v === undefined || v === null || vals.includes(v); }
function isOptDate(v) { return v === undefined || v === null || v === "" || (isStr(v) && /^\d{4}-\d{2}-\d{2}/.test(v)); }
function isOptEmail(v) { return v === undefined || v === null || v === "" || (isStr(v) && v.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)); }
function isOptStrArray(v) { return v === undefined || v === null || (Array.isArray(v) && v.every(isStr)); }
function isOptNum(v) { return v === undefined || v === null || typeof v === "number"; }
function isOptBool(v) { return v === undefined || v === null || typeof v === "boolean"; }
function isOptDomain(v) { return v === undefined || v === null || v === "" || (isStr(v) && v.length <= 253 && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)); }
function isOptTenantId(v) { return v === undefined || v === null || v === "" || (isStr(v) && v.length <= 80 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)); }

// ─── Shared enums ──────────────────────────────────────────────────────
const PRIORITIES = ["Critical", "High", "Medium", "Low"];
const IMPACTS = ["High", "Medium", "Low"];

// ─── Per-collection enums ──────────────────────────────────────────────
const INCIDENT_STATUSES = ["New", "Open", "In Progress", "Pending", "Resolved", "Closed", "Cancelled"];
const CHANGE_STATUSES   = ["Draft", "Submitted", "Approved", "In Progress", "Completed", "Cancelled", "Rejected", "Pending Approval", "Scheduled"];
const PROBLEM_STATUSES  = ["New", "Open", "Investigation", "Root Cause Identified", "Resolved", "Closed"];
const REQUEST_STATUSES  = ["New", "Open", "In Progress", "Pending", "Fulfilled", "Closed", "Cancelled"];
const ASSET_STATUSES    = ["Active", "Inactive", "Retired", "In Stock", "Deployed", "Maintenance", "Disposed"];
const CHANGE_TYPES      = ["Standard", "Normal", "Emergency", "Major"];
const RISKS             = ["High", "Medium", "Low"];
const KB_STATUSES       = ["Draft", "Published", "Archived", "Under Review"];
const SERVICE_STATUSES  = ["Active", "Inactive", "Deprecated", "Under Maintenance"];

// ─── Validators ────────────────────────────────────────────────────────

function validateIncident(d) {
  const errs = [];
  if (!isNonEmpty(d.title)) errs.push("title: Required, 1-5000 chars");
  if (!isOptStr(d.description)) errs.push("description: Max 5000 chars");
  if (!isEnum(d.status, INCIDENT_STATUSES)) errs.push("status: Invalid");
  if (!isEnum(d.priority, PRIORITIES)) errs.push("priority: Invalid");
  if (!isEnum(d.impact, IMPACTS)) errs.push("impact: Invalid");
  if (!isEnum(d.urgency, IMPACTS)) errs.push("urgency: Invalid");
  if (!isOptEmail(d.reporterEmail)) errs.push("reporterEmail: Invalid email");
  if (!isOptStr(d.category, 200)) errs.push("category: Max 200 chars");
  if (!isOptStr(d.assignee, 200)) errs.push("assignee: Max 200 chars");
  if (!isOptStr(d.assignedTo, 200)) errs.push("assignedTo: Max 200 chars");
  if (!isOptDate(d.resolvedAt)) errs.push("resolvedAt: Invalid date");
  if (!isOptDate(d.closedAt)) errs.push("closedAt: Invalid date");
  return errs;
}

function validateChange(d) {
  const errs = [];
  if (!isNonEmpty(d.title)) errs.push("title: Required, 1-5000 chars");
  if (!isOptStr(d.description)) errs.push("description: Max 5000 chars");
  if (!isEnum(d.status, CHANGE_STATUSES)) errs.push("status: Invalid");
  if (!isEnum(d.priority, PRIORITIES)) errs.push("priority: Invalid");
  if (!isEnum(d.changeType, CHANGE_TYPES)) errs.push("changeType: Invalid");
  if (!isEnum(d.risk, RISKS)) errs.push("risk: Invalid");
  if (!isOptDate(d.scheduledStart)) errs.push("scheduledStart: Invalid date");
  if (!isOptDate(d.scheduledEnd)) errs.push("scheduledEnd: Invalid date");
  if (!isOptStr(d.implementationPlan, 10000)) errs.push("implementationPlan: Max 10000 chars");
  if (!isOptStr(d.rollbackPlan, 10000)) errs.push("rollbackPlan: Max 10000 chars");
  return errs;
}

function validateProblem(d) {
  const errs = [];
  if (!isNonEmpty(d.title)) errs.push("title: Required, 1-5000 chars");
  if (!isOptStr(d.description)) errs.push("description: Max 5000 chars");
  if (!isEnum(d.status, PROBLEM_STATUSES)) errs.push("status: Invalid");
  if (!isEnum(d.priority, PRIORITIES)) errs.push("priority: Invalid");
  if (!isOptStrArray(d.relatedIncidents)) errs.push("relatedIncidents: Must be array of strings");
  if (!isOptStr(d.rootCause)) errs.push("rootCause: Max 5000 chars");
  if (!isOptStr(d.workaround)) errs.push("workaround: Max 5000 chars");
  return errs;
}

function validateRequest(d) {
  const errs = [];
  if (!isNonEmpty(d.title)) errs.push("title: Required, 1-5000 chars");
  if (!isOptStr(d.description)) errs.push("description: Max 5000 chars");
  if (!isEnum(d.status, REQUEST_STATUSES)) errs.push("status: Invalid");
  if (!isEnum(d.priority, PRIORITIES)) errs.push("priority: Invalid");
  if (!isOptEmail(d.requesterEmail)) errs.push("requesterEmail: Invalid email");
  if (!isOptStr(d.requestedFor, 200)) errs.push("requestedFor: Max 200 chars");
  return errs;
}

function validateAsset(d) {
  const errs = [];
  if (!isNonEmpty(d.name)) errs.push("name: Required, 1-5000 chars");
  if (!isEnum(d.status, ASSET_STATUSES)) errs.push("status: Invalid");
  if (!isOptStr(d.serialNumber, 200)) errs.push("serialNumber: Max 200 chars");
  if (!isOptStr(d.manufacturer, 200)) errs.push("manufacturer: Max 200 chars");
  if (!isOptStr(d.model, 200)) errs.push("model: Max 200 chars");
  if (!isOptStr(d.location, 500)) errs.push("location: Max 500 chars");
  if (!isOptStr(d.assignedTo, 200)) errs.push("assignedTo: Max 200 chars");
  if (!isOptDate(d.purchaseDate)) errs.push("purchaseDate: Invalid date");
  if (!isOptDate(d.warrantyExpiry)) errs.push("warrantyExpiry: Invalid date");
  return errs;
}

function validateCustomer(d) {
  const errs = [];
  if (!isNonEmpty(d.name, 500)) errs.push("name: Required, 1-500 chars");
  if (!isOptEmail(d.email)) errs.push("email: Invalid email");
  if (!isOptStr(d.company, 500)) errs.push("company: Max 500 chars");
  if (!isOptStr(d.phone, 50)) errs.push("phone: Max 50 chars");
  if (!isOptStr(d.department, 200)) errs.push("department: Max 200 chars");
  if (!isOptTenantId(d.m365TenantId)) errs.push("m365TenantId: Invalid tenant ID");
  if (!isOptDomain(d.primaryDomain)) errs.push("primaryDomain: Invalid domain");
  if (!isOptStr(d.partnerCustomerId, 200)) errs.push("partnerCustomerId: Max 200 chars");
  if (!isEnum(d.gdapStatus, ["unknown", "not_configured", "partial", "ready"])) errs.push("gdapStatus: Invalid");
  if (!isOptBool(d.m365AgentEnabled)) errs.push("m365AgentEnabled: Must be boolean");
  if (!isOptStrArray(d.allowedM365Actions)) errs.push("allowedM365Actions: Must be array of strings");
  if (Array.isArray(d.allowedM365Actions) && d.allowedM365Actions.some(a => !["forceSignOut"].includes(a))) errs.push("allowedM365Actions: Unsupported action");
  return errs;
}

function validateKB(d) {
  const errs = [];
  if (!isNonEmpty(d.title)) errs.push("title: Required, 1-5000 chars");
  if (!isOptStr(d.content, 50000)) errs.push("content: Max 50000 chars");
  if (!isEnum(d.status, KB_STATUSES)) errs.push("status: Invalid");
  if (!isOptStr(d.category, 200)) errs.push("category: Max 200 chars");
  if (!isOptStrArray(d.tags)) errs.push("tags: Must be array of strings");
  return errs;
}

function validateService(d) {
  const errs = [];
  if (!isNonEmpty(d.name, 500)) errs.push("name: Required, 1-500 chars");
  if (!isOptStr(d.description, 10000)) errs.push("description: Max 10000 chars");
  if (!isEnum(d.status, SERVICE_STATUSES)) errs.push("status: Invalid");
  if (!isOptStr(d.category, 200)) errs.push("category: Max 200 chars");
  if (!isOptStr(d.owner, 200)) errs.push("owner: Max 200 chars");
  return errs;
}

// ─── Collection → validator map ─────────────────────────────────────────
const VALIDATORS = {
  incidents:  validateIncident,
  changes:    validateChange,
  problems:   validateProblem,
  requests:   validateRequest,
  assets:     validateAsset,
  cmdb:       validateAsset,
  customers:  validateCustomer,
  kb:         validateKB,
  services:   validateService,
};

/**
 * Validate data for a collection. Returns { success, data, error }.
 * Unknown collections pass through without validation.
 */
function validate(collection, data) {
  const fn = VALIDATORS[collection];
  if (!fn) return { success: true, data };
  if (data === null || data === undefined || typeof data !== "object" || Array.isArray(data)) {
    return { success: false, error: "Request body must be a non-null object" };
  }
  const errs = fn(data);
  if (errs.length === 0) return { success: true, data };
  return { success: false, error: errs.join("; ") };
}

module.exports = { validate, VALIDATORS };
