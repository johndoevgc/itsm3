// ─── RBAC Enterprise Roles & Permissions ─────────────────────────────────
export const RBAC_ROLES = [
  { id: "VGC Dev Admin", label: "VGC Dev Admin", level: -1, color: "#FF6B6B", description: "Platform super-admin — full system access, AI config, API keys, billing, infrastructure, all dev tools" },
  { id: "Tenant Admin", label: "Tenant Admin", level: 0, color: "#EC4899", description: "Customer admin — tenant user management, compliance, customisation, SLA policies (no API keys, billing, or platform tools)" },
  { id: "Administrator", label: "Administrator", level: 0, color: "#EC4899", description: "Full system access — user management, AI config, compliance, all modules" },
  { id: "Service Desk Lead", label: "Service Desk Lead", level: 1, color: "#6366F1", description: "Team lead — manage tickets, approve requests, KB publishing" },
  { id: "L1 Support Engineer", label: "L1 Support Engineer", level: 2, color: "#06B6D4", description: "First-level support — create/edit incidents, fulfill requests" },
  { id: "L2 Support Engineer", label: "L2 Support Engineer", level: 2, color: "#06B6D4", description: "Second-level support — escalated tickets, problem management" },
  { id: "Network Engineer", label: "Network Engineer", level: 2, color: "#81C784", description: "Infrastructure support — network, security, cloud operations" },
  { id: "Change Manager", label: "Change Manager", level: 1, color: "#FFB347", description: "Change governance — approve/reject changes, risk assessment" },
  { id: "Problem Manager", label: "Problem Manager", level: 1, color: "#CE93D8", description: "Problem management — root cause analysis, known error DB" },
  { id: "Asset Manager", label: "Asset Manager", level: 1, color: "#F59E0B", description: "CMDB management — asset lifecycle, inventory control" },
  { id: "End User", label: "End User", level: 3, color: "#5A6178", description: "Self-service — raise tickets, view KB articles, track requests" },
  { id: "Read Only", label: "Read Only", level: 4, color: "#3A3F55", description: "View-only — dashboards, reports, no write operations" },
];

export const RBAC_PERMISSIONS = {
  "VGC Dev Admin":       { dashboard: "full", incidents: "full", problems: "full", changes: "full", requests: "full", catalog: "full", knowledge: "full", assets: "full", approvals: "full", sla: "full", ai: "full", admin: "full", customers: "full", reports: "full" },
  "Tenant Admin":        { dashboard: "full", incidents: "full", problems: "full", changes: "full", requests: "full", catalog: "full", knowledge: "full", assets: "full", approvals: "full", sla: "full", ai: "view", admin: "limited", customers: "full", reports: "full" },
  "Administrator":       { dashboard: "full", incidents: "full", problems: "full", changes: "full", requests: "full", catalog: "full", knowledge: "full", assets: "full", approvals: "full", sla: "full", ai: "full", admin: "full", customers: "full", reports: "full" },
  "Service Desk Lead":   { dashboard: "view", incidents: "manage", problems: "manage", changes: "view", requests: "manage", catalog: "view", knowledge: "publish", assets: "view", approvals: "approve", sla: "view", ai: "view", admin: "limited", customers: "manage", reports: "manage" },
  "L1 Support Engineer": { dashboard: "view", incidents: "edit", problems: "view", changes: "view", requests: "fulfill", catalog: "view", knowledge: "contribute", assets: "view", approvals: "none", sla: "view", ai: "use", admin: "none", customers: "edit", reports: "edit" },
  "L2 Support Engineer": { dashboard: "view", incidents: "manage", problems: "edit", changes: "view", requests: "fulfill", catalog: "view", knowledge: "contribute", assets: "view", approvals: "none", sla: "view", ai: "use", admin: "none", customers: "edit", reports: "edit" },
  "Network Engineer":    { dashboard: "view", incidents: "edit", problems: "edit", changes: "submit", requests: "fulfill", catalog: "view", knowledge: "contribute", assets: "edit", approvals: "none", sla: "view", ai: "use", admin: "none", customers: "edit", reports: "edit" },
  "Change Manager":      { dashboard: "view", incidents: "view", problems: "view", changes: "full", requests: "view", catalog: "view", knowledge: "view", assets: "view", approvals: "approve", sla: "view", ai: "view", admin: "none", customers: "view", reports: "view" },
  "Problem Manager":     { dashboard: "view", incidents: "view", problems: "full", changes: "view", requests: "view", catalog: "view", knowledge: "publish", assets: "view", approvals: "none", sla: "view", ai: "view", admin: "none", customers: "view", reports: "view" },
  "Asset Manager":       { dashboard: "view", incidents: "view", problems: "view", changes: "view", requests: "view", catalog: "manage", knowledge: "view", assets: "full", approvals: "none", sla: "view", ai: "view", admin: "none", customers: "view", reports: "view" },
  "End User":            { dashboard: "none", incidents: "create", problems: "none", changes: "none", requests: "create", catalog: "view", knowledge: "view", assets: "none", approvals: "none", sla: "none", ai: "none", admin: "none", customers: "none", reports: "none" },
  "Read Only":           { dashboard: "view", incidents: "view", problems: "view", changes: "view", requests: "view", catalog: "view", knowledge: "view", assets: "view", approvals: "none", sla: "view", ai: "none", admin: "none", customers: "view", reports: "view" },
};

// ─── Users ───────────────────────────────────────────────────────────
export const DEV_ADMIN_EMAILS = [
  "hlaing@vgctechnology.com",
];
export const ADMIN_EMAILS = [
  "hlaing@vgctechnology.com",
];

export const USERS = [];

export const INITIAL_CUSTOMERS = [];
