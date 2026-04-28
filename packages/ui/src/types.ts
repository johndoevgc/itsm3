export type TicketSeverity = 'A' | 'B' | 'C' | 'D';
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export const SEVERITY_LABELS: Record<TicketSeverity, string> = {
  A: 'Critical',
  B: 'High',
  C: 'Medium',
  D: 'Low',
};
