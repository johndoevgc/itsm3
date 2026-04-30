// ─── AI Auto-Handle Automation Engine ─────────────────────────────────
// Provides automated workflows that AI triggers from card interactions.
// Handles common ITSM tasks: auto-categorize, auto-assign, auto-escalate,
// auto-close, password resets, and bulk operations.

/**
 * Auto-handle rules keyed by action type → handler function.
 * Each handler returns { success, message, updates? } or null to skip.
 */
export const AUTO_HANDLE_RULES = {
  // ─── Auto-categorize incident based on description ───
  auto_categorize: async (payload, ctx) => {
    const { incidentId, description } = payload;
    if (!description) return null;
    const lower = description.toLowerCase();
    const categoryMap = [
      [/\b(network|dns|vpn|firewall|connectivity|latency|packet)\b/, "Network", "Network Infrastructure"],
      [/\b(email|outlook|exchange|mailbox|smtp)\b/, "Email", "Email & Communication"],
      [/\b(password|login|access|auth|mfa|sso|ldap)\b/, "Access", "Identity & Access"],
      [/\b(server|cpu|memory|disk|storage|vm|database)\b/, "Infrastructure", "Server & Infrastructure"],
      [/\b(software|install|update|patch|license|app)\b/, "Software", "Software & Applications"],
      [/\b(printer|scanner|peripheral|monitor|keyboard)\b/, "Hardware", "Hardware & Peripherals"],
      [/\b(security|breach|malware|phishing|vulnerability)\b/, "Security", "Security Incident"],
    ];
    for (const [pattern, category, subcategory] of categoryMap) {
      if (pattern.test(lower)) {
        return { success: true, message: `Auto-categorized as ${category} → ${subcategory}`, updates: { category, subcategory } };
      }
    }
    return { success: true, message: "Could not auto-categorize — needs manual review", updates: null };
  },

  // ─── Auto-assign based on category + team workload ───
  auto_assign: async (payload, ctx) => {
    const { category, incidents = [] } = payload;
    const teamMap = {
      "Network": ["Network Engineer"],
      "Email": ["L2 Engineer"],
      "Access": ["L1 Engineer"],
      "Infrastructure": ["L2 Engineer", "Network Engineer"],
      "Software": ["L1 Engineer"],
      "Hardware": ["L1 Engineer"],
      "Security": ["Network Engineer", "L2 Engineer"],
    };
    const roles = teamMap[category] || ["L1 Engineer"];
    // Find least-loaded engineer by counting open assignments
    const assigneeCounts = {};
    incidents.filter(i => i.status !== "Resolved" && i.status !== "Closed").forEach(inc => {
      const a = inc.assignedTo || "Unassigned";
      assigneeCounts[a] = (assigneeCounts[a] || 0) + 1;
    });
    // Pick the assignee with the fewest open tickets (simple round-robin proxy)
    const sorted = Object.entries(assigneeCounts).sort((a, b) => a[1] - b[1]);
    const assigned = sorted.length > 0 ? sorted[0][0] : roles[0];
    return { success: true, message: `Auto-assigned to ${assigned} (${category} queue)`, updates: { assignedTo: assigned } };
  },

  // ─── Auto-escalate based on SLA threshold ───
  auto_escalate: async (payload) => {
    const { incidentId, priority, slaPercent } = payload;
    if (slaPercent >= 90 || priority === "Sev-A") {
      const newPriority = priority === "Sev-B" ? "Sev-A" : priority;
      return {
        success: true,
        message: `Escalated ${incidentId} — SLA at ${slaPercent}%`,
        updates: { priority: newPriority, escalated: true, escalationNote: `Auto-escalated: SLA ${slaPercent}% consumed` },
      };
    }
    return null;
  },

  // ─── Auto-close resolved incidents past threshold ───
  auto_close: async (payload) => {
    const { incidentId, status, resolvedAt } = payload;
    if (status !== "Resolved") return null;
    const daysSinceResolved = resolvedAt ? (Date.now() - new Date(resolvedAt).getTime()) / 86400000 : 0;
    if (daysSinceResolved >= 3) {
      return {
        success: true,
        message: `Auto-closed ${incidentId} (resolved ${Math.floor(daysSinceResolved)} days ago)`,
        updates: { status: "Closed", closedAt: new Date().toISOString(), closureNote: "Auto-closed after resolution threshold" },
      };
    }
    return null;
  },

  // ─── Password reset workflow ───
  password_reset: async (payload) => {
    const { userId, email } = payload;
    // Simulate password reset steps
    return {
      success: true,
      message: `Password reset initiated for ${email || userId}`,
      steps: [
        { step: 1, label: "Identity verified", status: "complete" },
        { step: 2, label: "Temporary password generated", status: "complete" },
        { step: 3, label: "Reset link sent to registered email", status: "complete" },
        { step: 4, label: "User must set new password on next login", status: "pending" },
      ],
    };
  },

  // ─── Bulk status update ───
  bulk_update: async (payload) => {
    const { ids, field, value } = payload;
    if (!ids?.length || !field) return null;
    return {
      success: true,
      message: `Bulk updated ${ids.length} items: ${field} → ${value}`,
      updates: { ids, field, value },
    };
  },
};

/**
 * Execute an auto-handle rule.
 * @param {string} ruleKey - Key from AUTO_HANDLE_RULES
 * @param {object} payload - Data for the rule
 * @param {object} ctx - App context (incidents, users, etc.)
 * @returns {Promise<object|null>}
 */
export async function executeAutoHandle(ruleKey, payload, ctx = {}) {
  const handler = AUTO_HANDLE_RULES[ruleKey];
  if (!handler) return { success: false, message: `Unknown auto-handle rule: ${ruleKey}` };
  try {
    return await handler(payload, ctx);
  } catch (err) {
    return { success: false, message: `Auto-handle failed: ${err.message}` };
  }
}

/**
 * Check if an incident qualifies for any auto-handle rules.
 * Returns array of applicable rule keys.
 */
export function detectAutoHandleOpportunities(incident) {
  const opportunities = [];
  if (!incident.category) opportunities.push("auto_categorize");
  if (!incident.assignedTo || incident.assignedTo === "Unassigned") opportunities.push("auto_assign");
  if (incident.slaPercent >= 80) opportunities.push("auto_escalate");
  if (incident.status === "Resolved") opportunities.push("auto_close");
  return opportunities;
}
