import React from 'react';
import { Badge } from './Badge.js';
import type { TicketSeverity } from '../types.js';
import { SEVERITY_LABELS } from '../types.js';

const severityVariant: Record<TicketSeverity, 'destructive' | 'default' | 'secondary'> = {
  A: 'destructive',
  B: 'destructive',
  C: 'default',
  D: 'secondary',
};

interface SeverityBadgeProps {
  severity: TicketSeverity;
}

/**
 * Severity badge with accessible label.
 * P1/Sev A uses destructive (red) color with aria-label.
 */
export function SeverityBadge({ severity }: SeverityBadgeProps) {
  return (
    <Badge
      variant={severityVariant[severity]}
      aria-label={`Severity ${severity}: ${SEVERITY_LABELS[severity]}`}
    >
      {severity}
    </Badge>
  );
}
