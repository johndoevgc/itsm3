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

// ─── PIR/RCA Validators ─────────────────────────────────────────────────
const PIR_STATUSES = ["Draft", "In Review", "Approved", "Closed"];
const PIR_RCA_TYPES = ["human_error", "software_bug", "infrastructure", "process_gap", "external", "unknown"];
const PIR_ACTION_STATUSES = ["open", "in_progress", "completed", "cancelled"];

function validatePir(d) {
  const errs = [];
  if (!isNonEmpty(d.incidentId, 200)) errs.push("incidentId: Required, 1-200 chars");
  if (!isEnum(d.status, PIR_STATUSES)) errs.push("status: Invalid");
  if (d.rca !== undefined) {
    if (typeof d.rca !== "object" || Array.isArray(d.rca)) errs.push("rca: Must be object");
    else {
      if (!isEnum(d.rca.type, PIR_RCA_TYPES)) errs.push("rca.type: Invalid");
      if (!isOptStr(d.rca.rootCause, 5000)) errs.push("rca.rootCause: Max 5000 chars");
      if (!isOptStrArray(d.rca.contributingFactors)) errs.push("rca.contributingFactors: Must be array of strings");
      for (let i = 1; i <= 5; i++) { if (!isOptStr(d.rca["why" + i], 2000)) errs.push("rca.why" + i + ": Max 2000 chars"); }
    }
  }
  if (d.actionItems !== undefined) {
    if (!Array.isArray(d.actionItems)) errs.push("actionItems: Must be array");
    else {
      for (let i = 0; i < d.actionItems.length; i++) {
        const a = d.actionItems[i];
        if (!isNonEmpty(a.title, 500)) errs.push("actionItems[" + i + "].title: Required");
        if (!isOptStr(a.owner, 200)) errs.push("actionItems[" + i + "].owner: Max 200 chars");
        if (!isOptDate(a.dueDate)) errs.push("actionItems[" + i + "].dueDate: Invalid date");
        if (!isEnum(a.status, PIR_ACTION_STATUSES)) errs.push("actionItems[" + i + "].status: Invalid");
      }
    }
  }
  if (!isOptStrArray(d.lessonsLearned)) errs.push("lessonsLearned: Must be array of strings");
  if (d.impactAssessment !== undefined) {
    if (typeof d.impactAssessment !== "object" || Array.isArray(d.impactAssessment)) errs.push("impactAssessment: Must be object");
    else {
      if (!isOptNum(d.impactAssessment.affectedUsers)) errs.push("impactAssessment.affectedUsers: Must be number");
      if (!isOptStrArray(d.impactAssessment.systems)) errs.push("impactAssessment.systems: Must be array of strings");
      if (!isOptNum(d.impactAssessment.durationHours)) errs.push("impactAssessment.durationHours: Must be number");
    }
  }
  return errs;
}

// ─── CSI Register Validators ────────────────────────────────────────────
const CSI_STATUSES = ["Proposed", "Approved", "In Progress", "Completed", "Rejected"];
const CSI_PRIORITIES = ["Critical", "High", "Medium", "Low"];
const CSI_CATEGORIES = ["process", "technology", "people", "governance", "service_quality"];

function validateCsi(d) {
  const errs = [];
  if (!isNonEmpty(d.title, 500)) errs.push("title: Required, 1-500 chars");
  if (!isOptStr(d.description, 5000)) errs.push("description: Max 5000 chars");
  if (!isEnum(d.status, CSI_STATUSES)) errs.push("status: Invalid");
  if (!isEnum(d.priority, CSI_PRIORITIES)) errs.push("priority: Invalid");
  if (!isEnum(d.category, CSI_CATEGORIES)) errs.push("category: Invalid");
  if (!isOptStr(d.owner, 200)) errs.push("owner: Max 200 chars");
  if (!isOptStr(d.source, 200)) errs.push("source: Max 200 chars");
  if (!isOptDate(d.targetDate)) errs.push("targetDate: Invalid date");
  if (!isOptStr(d.expectedBenefit, 2000)) errs.push("expectedBenefit: Max 2000 chars");
  if (!isOptStr(d.actualOutcome, 2000)) errs.push("actualOutcome: Max 2000 chars");
  if (!isOptStrArray(d.relatedIncidents)) errs.push("relatedIncidents: Must be array of strings");
  if (!isOptStrArray(d.relatedPirs)) errs.push("relatedPirs: Must be array of strings");
  return errs;
}

// ─── On-Call Schedule Validators ────────────────────────────────────────
const ONCALL_ROTATION_TYPES = ["weekly", "daily", "custom"];

function validateOncallSchedule(d) {
  const errs = [];
  if (!isNonEmpty(d.name, 200)) errs.push("name: Required, 1-200 chars");
  if (!isEnum(d.rotationType, ONCALL_ROTATION_TYPES)) errs.push("rotationType: Invalid");
  if (!Array.isArray(d.members) || d.members.length === 0) errs.push("members: Required non-empty array");
  else {
    for (let i = 0; i < d.members.length; i++) {
      if (!isNonEmpty(d.members[i].name, 200)) errs.push("members[" + i + "].name: Required");
      if (!isOptEmail(d.members[i].email)) errs.push("members[" + i + "].email: Invalid");
      if (!isOptStr(d.members[i].phone, 50)) errs.push("members[" + i + "].phone: Max 50 chars");
    }
  }
  if (!isOptBool(d.active)) errs.push("active: Must be boolean");
  if (d.holidayOverrides !== undefined && !Array.isArray(d.holidayOverrides)) errs.push("holidayOverrides: Must be array");
  return errs;
}

// ─── Customer SLA Policy Validators ─────────────────────────────────────
const SLA_TIERS = ["basic", "premium", "enterprise", "custom"];

function validateCustomerSlaPolicy(d) {
  const errs = [];
  if (!isNonEmpty(d.customerId, 200)) errs.push("customerId: Required, 1-200 chars");
  if (!isEnum(d.tier, SLA_TIERS)) errs.push("tier: Invalid");
  if (d.severities !== undefined && (typeof d.severities !== "object" || Array.isArray(d.severities))) errs.push("severities: Must be object");
  if (d.supportHours !== undefined && (typeof d.supportHours !== "object" || Array.isArray(d.supportHours))) errs.push("supportHours: Must be object");
  if (!isOptDate(d.effectiveFrom)) errs.push("effectiveFrom: Invalid date");
  if (!isOptDate(d.effectiveTo)) errs.push("effectiveTo: Invalid date");
  if (!isOptBool(d.active)) errs.push("active: Must be boolean");
  return errs;
}

// ─── Collection → validator map ─────────────────────────────────────────
const VALIDATORS = {
  incidents:              validateIncident,
  changes:                validateChange,
  problems:               validateProblem,
  requests:               validateRequest,
  assets:                 validateAsset,
  cmdb:                   validateAsset,
  customers:              validateCustomer,
  kb:                     validateKB,
  services:               validateService,
  pir_records:            validatePir,
  csi_register:           validateCsi,
  oncall_schedules:       validateOncallSchedule,
  customer_sla_policies:  validateCustomerSlaPolicy,
};

// ─── Endpoint-specific validators (Phase 1 security hardening) ─────────
// These validate dedicated POST/PUT endpoint payloads (not generic CRUD).

const SLA_CALENDAR_TIMEZONES = [
  "UTC", "US/Eastern", "US/Central", "US/Mountain", "US/Pacific",
  "Europe/London", "Europe/Berlin", "Europe/Paris", "Asia/Tokyo",
  "Asia/Singapore", "Australia/Sydney", "Pacific/Auckland",
];
const REPORT_FREQUENCIES = ["daily", "weekly", "monthly", "quarterly"];
const REPORT_FORMATS = ["pdf", "csv", "json", "html"];
const CMDB_REL_TYPES = ["runs_on", "depends_on", "connected_to", "part_of", "managed_by", "backed_up_by", "monitored_by"];
const APPROVAL_ACTIONS = ["approved", "rejected"];
const RUNBOOK_STEP_STATUSES = ["completed", "skipped", "failed"];
const FEEDBACK_VERDICTS = ["correct", "incorrect", "partial"];

function validateSlaConfig(d) {
  const errs = [];
  if (!d.severities || typeof d.severities !== "object" || Array.isArray(d.severities)) errs.push("severities: Required object");
  return errs;
}

function validateSlaCategoryModifier(d) {
  const errs = [];
  if (!isNonEmpty(d.category, 200)) errs.push("category: Required, 1-200 chars");
  const m = parseFloat(d.multiplier);
  if (isNaN(m) || m <= 0 || m > 10) errs.push("multiplier: Required number 0-10");
  return errs;
}

function validateSlaPause(d) {
  const errs = [];
  if (!isNonEmpty(d.incidentId, 200)) errs.push("incidentId: Required");
  if (!isOptStr(d.reason, 1000)) errs.push("reason: Max 1000 chars");
  return errs;
}

function validateSlaResume(d) {
  const errs = [];
  if (!isNonEmpty(d.incidentId, 200)) errs.push("incidentId: Required");
  return errs;
}

function validateSlaCalendar(d) {
  const errs = [];
  if (!isNonEmpty(d.name, 200)) errs.push("name: Required, 1-200 chars");
  if (d.timezone !== undefined && !isEnum(d.timezone, SLA_CALENDAR_TIMEZONES)) errs.push("timezone: Invalid");
  if (d.businessHours !== undefined && (typeof d.businessHours !== "object" || Array.isArray(d.businessHours))) errs.push("businessHours: Must be object");
  if (d.holidays !== undefined && !Array.isArray(d.holidays)) errs.push("holidays: Must be array");
  if (!isOptBool(d.isDefault)) errs.push("isDefault: Must be boolean");
  return errs;
}

function validateNotificationSend(d) {
  const errs = [];
  if (!isOptStr(d.type, 200)) errs.push("type: Max 200 chars");
  if (!isOptStr(d.subject, 500)) errs.push("subject: Max 500 chars");
  if (!isOptStr(d.message, 10000)) errs.push("message: Max 10000 chars");
  if (!isOptStr(d.channel, 100)) errs.push("channel: Max 100 chars");
  if (!isOptEmail(d.to)) errs.push("to: Invalid email");
  if (d.recipients !== undefined && !isOptStrArray(d.recipients)) errs.push("recipients: Must be array of strings");
  return errs;
}

function validateNotificationTemplate(d) {
  const errs = [];
  if (!isNonEmpty(d.name, 200)) errs.push("name: Required, 1-200 chars");
  if (!isNonEmpty(d.eventType, 200)) errs.push("eventType: Required, 1-200 chars");
  if (d.channels !== undefined && !isOptStrArray(d.channels)) errs.push("channels: Must be array of strings");
  if (!isOptStr(d.subject, 500)) errs.push("subject: Max 500 chars");
  if (!isOptStr(d.bodyTemplate, 10000)) errs.push("bodyTemplate: Max 10000 chars");
  if (!isOptBool(d.active)) errs.push("active: Must be boolean");
  return errs;
}

function validateApprovalSubmit(d) {
  const errs = [];
  if (!isNonEmpty(d.chainId, 200)) errs.push("chainId: Required");
  if (!isNonEmpty(d.targetCollection, 100)) errs.push("targetCollection: Required");
  if (!isNonEmpty(d.targetId, 200)) errs.push("targetId: Required");
  if (!isOptStr(d.createdBy, 200)) errs.push("createdBy: Max 200 chars");
  return errs;
}

function validateApprovalAction(d) {
  const errs = [];
  if (!isEnum(d.action, APPROVAL_ACTIONS)) errs.push("action: Must be 'approved' or 'rejected'");
  if (d.action === undefined) errs.push("action: Required");
  if (!isOptStr(d.comment, 5000)) errs.push("comment: Max 5000 chars");
  if (!isOptStr(d.approvedBy, 200)) errs.push("approvedBy: Max 200 chars");
  return errs;
}

function validateApprovalGenerateToken(d) {
  const errs = [];
  if (!isNonEmpty(d.instanceId, 200)) errs.push("instanceId: Required");
  if (!isOptEmail(d.approverEmail) || !d.approverEmail) errs.push("approverEmail: Valid email required");
  return errs;
}

function validateCmdbRelationship(d) {
  const errs = [];
  if (!isNonEmpty(d.sourceId, 200)) errs.push("sourceId: Required");
  if (!isNonEmpty(d.targetId, 200)) errs.push("targetId: Required");
  if (!isNonEmpty(d.type, 100)) errs.push("type: Required");
  if (d.type && !isEnum(d.type, CMDB_REL_TYPES)) errs.push("type: Invalid relationship type");
  if (!isOptStr(d.createdBy, 200)) errs.push("createdBy: Max 200 chars");
  return errs;
}

function validateRunbookExecute(d) {
  const errs = [];
  if (!isNonEmpty(d.runbookId, 200)) errs.push("runbookId: Required");
  if (!isOptStr(d.incidentId, 200)) errs.push("incidentId: Max 200 chars");
  if (!isOptStr(d.executedBy, 200)) errs.push("executedBy: Max 200 chars");
  return errs;
}

function validateRunbookStepUpdate(d) {
  const errs = [];
  if (!isEnum(d.status, RUNBOOK_STEP_STATUSES)) errs.push("status: Must be completed, skipped, or failed");
  if (d.status === undefined) errs.push("status: Required");
  if (!isOptStr(d.notes, 5000)) errs.push("notes: Max 5000 chars");
  if (!isOptStr(d.updatedBy, 200)) errs.push("updatedBy: Max 200 chars");
  return errs;
}

function validateRunbookActionExecute(d) {
  const errs = [];
  if (!isNonEmpty(d.actionId, 200)) errs.push("actionId: Required");
  if (d.params !== undefined && (typeof d.params !== "object" || Array.isArray(d.params))) errs.push("params: Must be object");
  if (!isOptStr(d.incidentId, 200)) errs.push("incidentId: Max 200 chars");
  return errs;
}

function validateReportSchedule(d) {
  const errs = [];
  if (!isNonEmpty(d.name, 200)) errs.push("name: Required, 1-200 chars");
  if (!isNonEmpty(d.type, 100)) errs.push("type: Required");
  if (d.frequency !== undefined && !isEnum(d.frequency, REPORT_FREQUENCIES)) errs.push("frequency: Invalid");
  if (d.format !== undefined && !isEnum(d.format, REPORT_FORMATS)) errs.push("format: Invalid");
  if (d.recipients !== undefined && !isOptStrArray(d.recipients)) errs.push("recipients: Must be array of strings");
  if (!isOptBool(d.active)) errs.push("active: Must be boolean");
  if (!isOptNum(d.hour)) errs.push("hour: Must be number");
  if (!isOptNum(d.dayOfWeek)) errs.push("dayOfWeek: Must be number");
  return errs;
}

function validateFeatureFlag(d) {
  const errs = [];
  if (!isNonEmpty(d.name, 200)) errs.push("name: Required, 1-200 chars");
  if (!isOptBool(d.enabled)) errs.push("enabled: Must be boolean");
  if (!isOptStr(d.scope, 100)) errs.push("scope: Max 100 chars");
  return errs;
}

function validateChangeFreezeWindow(d) {
  const errs = [];
  if (!isOptDate(d.startDate) || !d.startDate) errs.push("startDate: Valid date required");
  if (!isOptDate(d.endDate) || !d.endDate) errs.push("endDate: Valid date required");
  if (!isNonEmpty(d.reason, 1000)) errs.push("reason: Required, 1-1000 chars");
  if (!isOptStr(d.createdBy, 200)) errs.push("createdBy: Max 200 chars");
  return errs;
}

function validateChangeConflictCheck(d) {
  const errs = [];
  if (!isOptDate(d.scheduledStart) || !d.scheduledStart) errs.push("scheduledStart: Valid date required");
  if (!isOptDate(d.scheduledEnd)) errs.push("scheduledEnd: Invalid date");
  if (!isNonEmpty(d.title, 5000)) errs.push("title: Required");
  if (!isOptStr(d.type, 100)) errs.push("type: Max 100 chars");
  if (!isOptStr(d.category, 200)) errs.push("category: Max 200 chars");
  if (!isEnum(d.impact, IMPACTS)) errs.push("impact: Invalid");
  return errs;
}

function validateM365Diagnose(d) {
  const errs = [];
  if (!isOptStr(d.incidentId, 200)) errs.push("incidentId: Max 200 chars");
  if (!isOptStr(d.targetUpn, 320)) errs.push("targetUpn: Max 320 chars");
  if (!isOptStr(d.executedBy, 200)) errs.push("executedBy: Max 200 chars");
  return errs;
}

function validateM365ActionPropose(d) {
  const errs = [];
  if (!isNonEmpty(d.actionId, 200)) errs.push("actionId: Required");
  if (!isOptStr(d.incidentId, 200)) errs.push("incidentId: Max 200 chars");
  if (!isOptStr(d.targetUpn, 320)) errs.push("targetUpn: Max 320 chars");
  if (!isOptStr(d.diagnosticRunId, 200)) errs.push("diagnosticRunId: Max 200 chars");
  if (!isOptStr(d.requestedBy, 200)) errs.push("requestedBy: Max 200 chars");
  return errs;
}

function validateM365ApproveExecute(d) {
  const errs = [];
  if (!isNonEmpty(d.proposalId, 200)) errs.push("proposalId: Required");
  if (!isOptStr(d.approvedBy, 200)) errs.push("approvedBy: Max 200 chars");
  return errs;
}

function validateIncidentLinkChild(d) {
  const errs = [];
  if (!isNonEmpty(d.childId, 200)) errs.push("childId: Required");
  return errs;
}

function validateIncidentCascadeResolve(d) {
  const errs = [];
  if (!isOptStr(d.resolution, 5000)) errs.push("resolution: Max 5000 chars");
  return errs;
}

function validateAiLearningFeedback(d) {
  const errs = [];
  if (!isNonEmpty(d.triageId, 200)) errs.push("triageId: Required");
  if (!isEnum(d.verdict, FEEDBACK_VERDICTS) || !d.verdict) errs.push("verdict: Required, must be correct/incorrect/partial");
  if (!isOptStr(d.notes, 5000)) errs.push("notes: Max 5000 chars");
  if (!isOptStr(d.correctedCategory, 200)) errs.push("correctedCategory: Max 200 chars");
  if (!isEnum(d.correctedPriority, PRIORITIES)) errs.push("correctedPriority: Invalid");
  return errs;
}

function validateI18nPack(d) {
  const errs = [];
  if (!isNonEmpty(d.lang, 10)) errs.push("lang: Required, 1-10 chars");
  if (!d.strings || typeof d.strings !== "object" || Array.isArray(d.strings)) errs.push("strings: Required object");
  return errs;
}

// Endpoint name → validator (used by validateEndpoint)
const ENDPOINT_VALIDATORS = {
  "sla_config":               validateSlaConfig,
  "sla_category_modifier":    validateSlaCategoryModifier,
  "sla_pause":                validateSlaPause,
  "sla_resume":               validateSlaResume,
  "sla_calendar":             validateSlaCalendar,
  "notification_send":        validateNotificationSend,
  "notification_template":    validateNotificationTemplate,
  "approval_submit":          validateApprovalSubmit,
  "approval_action":          validateApprovalAction,
  "approval_generate_token":  validateApprovalGenerateToken,
  "cmdb_relationship":        validateCmdbRelationship,
  "runbook_execute":          validateRunbookExecute,
  "runbook_step_update":      validateRunbookStepUpdate,
  "runbook_action_execute":   validateRunbookActionExecute,
  "report_schedule":          validateReportSchedule,
  "feature_flag":             validateFeatureFlag,
  "change_freeze_window":     validateChangeFreezeWindow,
  "change_conflict_check":    validateChangeConflictCheck,
  "m365_diagnose":            validateM365Diagnose,
  "m365_action_propose":      validateM365ActionPropose,
  "m365_approve_execute":     validateM365ApproveExecute,
  "incident_link_child":      validateIncidentLinkChild,
  "incident_cascade_resolve": validateIncidentCascadeResolve,
  "ai_learning_feedback":     validateAiLearningFeedback,
  "i18n_pack":                validateI18nPack,
  "pir":                      validatePir,
  "csi":                      validateCsi,
  "oncall_schedule":          validateOncallSchedule,
  "customer_sla_policy":      validateCustomerSlaPolicy,
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

/**
 * Validate data for a specific endpoint. Returns { success, data, error }.
 * Unknown endpoints pass through without validation.
 */
function validateEndpoint(endpoint, data) {
  const fn = ENDPOINT_VALIDATORS[endpoint];
  if (!fn) return { success: true, data };
  if (data === null || data === undefined || typeof data !== "object" || Array.isArray(data)) {
    return { success: false, error: "Request body must be a non-null object" };
  }
  const errs = fn(data);
  if (errs.length === 0) return { success: true, data };
  return { success: false, error: errs.join("; ") };
}

module.exports = { validate, validateEndpoint, VALIDATORS, ENDPOINT_VALIDATORS };
