/**
 * Zod schemas for ITSM data validation — Phase 5
 * Validates input for top collections at system boundaries.
 */
const { z } = require("zod");

// ─── Shared primitives ─────────────────────────────────────────────────
const isoDate = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional();
const nonEmptyStr = z.string().min(1).max(5000);
const optStr = z.string().max(5000).optional().or(z.literal(""));
const email = z.string().email().max(320).optional().or(z.literal(""));

// ─── Incident ───────────────────────────────────────────────────────────
const incidentSchema = z.object({
  id: optStr,
  title: nonEmptyStr,
  description: optStr,
  status: z.enum(["New", "Open", "In Progress", "Pending", "Resolved", "Closed", "Cancelled"]).optional().default("New"),
  priority: z.enum(["Critical", "High", "Medium", "Low"]).optional().default("Medium"),
  category: optStr,
  subcategory: optStr,
  assignee: optStr,
  assignedTeam: optStr,
  reporter: optStr,
  reporterEmail: email,
  impact: z.enum(["High", "Medium", "Low"]).optional(),
  urgency: z.enum(["High", "Medium", "Low"]).optional(),
  resolution: optStr,
  resolutionNotes: optStr,
  created: isoDate,
  updated: isoDate,
  resolvedAt: isoDate,
  closedAt: isoDate,
  slaDeadline: isoDate,
  source: optStr,
}).passthrough();

// ─── Change Request ─────────────────────────────────────────────────────
const changeSchema = z.object({
  id: optStr,
  title: nonEmptyStr,
  description: optStr,
  status: z.enum(["Draft", "Submitted", "Approved", "In Progress", "Completed", "Cancelled", "Rejected", "Pending Approval", "Scheduled"]).optional().default("Draft"),
  priority: z.enum(["Critical", "High", "Medium", "Low"]).optional().default("Medium"),
  category: optStr,
  changeType: z.enum(["Standard", "Normal", "Emergency", "Major"]).optional().default("Normal"),
  risk: z.enum(["High", "Medium", "Low"]).optional().default("Low"),
  requester: optStr,
  assignee: optStr,
  approver: optStr,
  implementationPlan: optStr,
  rollbackPlan: optStr,
  scheduledStart: isoDate,
  scheduledEnd: isoDate,
  created: isoDate,
  updated: isoDate,
}).passthrough();

// ─── Problem ────────────────────────────────────────────────────────────
const problemSchema = z.object({
  id: optStr,
  title: nonEmptyStr,
  description: optStr,
  status: z.enum(["New", "Open", "Investigation", "Root Cause Identified", "Resolved", "Closed"]).optional().default("New"),
  priority: z.enum(["Critical", "High", "Medium", "Low"]).optional().default("Medium"),
  category: optStr,
  assignee: optStr,
  rootCause: optStr,
  workaround: optStr,
  relatedIncidents: z.array(z.string()).optional(),
  created: isoDate,
  updated: isoDate,
}).passthrough();

// ─── Service Request ────────────────────────────────────────────────────
const requestSchema = z.object({
  id: optStr,
  title: nonEmptyStr,
  description: optStr,
  status: z.enum(["New", "Open", "In Progress", "Pending", "Fulfilled", "Closed", "Cancelled"]).optional().default("New"),
  priority: z.enum(["Critical", "High", "Medium", "Low"]).optional().default("Medium"),
  category: optStr,
  requester: optStr,
  requesterEmail: email,
  assignee: optStr,
  created: isoDate,
  updated: isoDate,
}).passthrough();

// ─── Asset / CMDB ───────────────────────────────────────────────────────
const assetSchema = z.object({
  id: optStr,
  name: nonEmptyStr,
  type: optStr,
  status: z.enum(["Active", "Inactive", "Retired", "In Stock", "Deployed", "Maintenance", "Disposed"]).optional().default("Active"),
  serialNumber: optStr,
  manufacturer: optStr,
  model: optStr,
  location: optStr,
  assignedTo: optStr,
  department: optStr,
  purchaseDate: isoDate,
  warrantyExpiry: isoDate,
  created: isoDate,
  updated: isoDate,
}).passthrough();

// ─── Collection → Schema map ────────────────────────────────────────────
const SCHEMAS = {
  incidents: incidentSchema,
  changes: changeSchema,
  problems: problemSchema,
  requests: requestSchema,
  assets: assetSchema,
  cmdb: assetSchema,
};

/**
 * Validate data for a collection. Returns { success, data, error }.
 * Unknown collections pass through without validation.
 */
function validate(collection, data) {
  const schema = SCHEMAS[collection];
  if (!schema) return { success: true, data };
  const result = schema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  const issues = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
  return { success: false, error: issues.join("; ") };
}

module.exports = { validate, SCHEMAS, incidentSchema, changeSchema, problemSchema, requestSchema, assetSchema };
