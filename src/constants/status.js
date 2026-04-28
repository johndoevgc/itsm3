// ─── Status & Priority Constants ─────────────────────────────────────────
export const STATUS = {
  NEW:         "New",
  OPEN:        "Open",
  IN_PROGRESS: "In Progress",
  PENDING:     "Pending",
  RESOLVED:    "Resolved",
  CLOSED:      "Closed",
};
export const OPEN_STATUSES = new Set([STATUS.NEW, STATUS.OPEN, STATUS.IN_PROGRESS, STATUS.PENDING]);

export const PRIORITY = {
  SEV_A: "Sev-A",
  SEV_B: "Sev-B",
  SEV_C: "Sev-C",
  SEV_D: "Sev-D",
};

// SLA targets in hours by priority
export const SLA_TARGETS = {
  [PRIORITY.SEV_A]: 4,
  [PRIORITY.SEV_B]: 4,
  [PRIORITY.SEV_C]: 9,
  [PRIORITY.SEV_D]: 27,
};

// ─── VGC Official SLA Policy (Defaults — editable via Admin Settings) ─────
export const DEFAULT_SLA_POLICY = {
  supportHours: { start: 9, end: 18, days: "Mon–Fri", hours: "9:00 AM – 6:00 PM", tz: "Asia/Singapore" },
  defaultSeverity: "Sev-C",
  ticketChannels: ["help@vgctechnology.com", "ITSM Portal"],
  severities: {
    "Sev-A": { label: "CRITICAL", firstResponse: 0.5, worstResponse: 4, definition: "Complete service outage. Business-critical systems unavailable.", examples: ["Complete network failure", "Server room fire"], escalation: "Immediate to IT Manager" },
    "Sev-B": { label: "HIGH", firstResponse: 1, worstResponse: 4, definition: "Major impact to operations. VIP user issues not resolvable remotely. Significant outage affecting >50% of users.", examples: ["VPN failure for department", "VIP laptop down"], escalation: "After 2 hrs to Team Lead" },
    "Sev-C": { label: "MEDIUM (DEFAULT)", firstResponse: 4, worstResponse: 9, definition: "Standard actionable IT issues. Any issue not qualifying as Severity A or B.", examples: ["Software crash", "Printer issue", "Password reset"], escalation: "After 6 hrs to Team Lead" },
    "Sev-D": { label: "LOW / INQUIRY", firstResponse: 9, worstResponse: 27, definition: "Non-actionable questions. Informational or 'How do I' requests.", examples: ["How to use feature X", "General IT inquiry"], escalation: "After next business day" },
  },
  rules: [
    "All support requests MUST exist as a ticket before any work starts",
    "Default severity for all new tickets = Severity C (Medium)",
    "Manual escalation to Severity A or B must be explicit",
    "Severity D tickets MUST NOT be used for actionable issues",
    "SLA countdown pauses outside business hours (Mon-Fri 9AM-6PM SGT) and when status is Pending or On Hold",
    "SLA breach alerts trigger when Worst Response Time is exceeded",
    "Ticket updates must be logged within the ITSM system",
    "Engineers must update ticket status upon: First response, Work in progress, Resolution, Closure",
  ]
};
