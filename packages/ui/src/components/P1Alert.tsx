import React from 'react';

interface P1AlertProps {
  ticketId: string;
  title: string;
  tenantName: string;
  warroomUrl?: string;
}

/**
 * P1 Alert banner — red pulse for critical incidents.
 * WCAG: role=alert, aria-live=assertive for screen readers.
 * Framer Motion: p1-pulse CSS animation (respects prefers-reduced-motion).
 */
export function P1Alert({ ticketId, title, tenantName, warroomUrl }: P1AlertProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="p1-pulse flex items-start gap-4 p-4 rounded-xl bg-destructive text-destructive-foreground"
    >
      <span className="text-2xl" aria-hidden="true">🚨</span>
      <div className="flex-1">
        <p className="font-bold text-lg">
          P1 Active — {tenantName}
        </p>
        <p className="text-sm opacity-90">
          #{ticketId}: {title}
        </p>
      </div>
      {warroomUrl && (
        <a
          href={warroomUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 px-3 py-1.5 bg-white text-destructive rounded-lg text-sm font-medium hover:bg-white/90 transition-colors"
          aria-label="Open Teams war-room for this P1 incident"
        >
          Join War-Room
        </a>
      )}
    </div>
  );
}
