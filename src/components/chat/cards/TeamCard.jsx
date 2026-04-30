import React from 'react';
import { cardBase, cardColors } from './CardStyles';

export default function TeamCard({ data, onAction }) {
  const members = data?.members || [];
  const statusDot = (s) => ({
    available: cardColors.success,
    busy: cardColors.danger,
    away: cardColors.warning,
    offline: '#6B7280',
  }[s] || '#6B7280');

  return (
    <div style={{ ...cardBase }}>
      <div style={{ padding: '10px 12px 6px', fontSize: 11.5, fontWeight: 700, color: cardColors.textBright, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>👥</span> Team Overview ({members.length})
      </div>
      <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {members.slice(0, 8).map((m, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <div style={{
              width: 24, height: 24, borderRadius: 6, background: '#1E2130',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, color: cardColors.textBright, fontWeight: 700, flexShrink: 0, position: 'relative',
            }}>
              {m.avatar || m.name?.charAt(0) || '?'}
              <div style={{
                position: 'absolute', bottom: -1, right: -1, width: 7, height: 7, borderRadius: '50%',
                background: statusDot(m.status), border: `1.5px solid ${cardColors.bg}`,
              }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: cardColors.textBright }}>{m.name}</div>
              <div style={{ fontSize: 8, color: cardColors.textMuted }}>{m.role}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: cardColors.accent, fontFamily: "'JetBrains Mono', monospace" }}>{m.activeTickets}</div>
              <div style={{ fontSize: 7, color: cardColors.textMuted }}>active</div>
            </div>
            {m.resolvedToday > 0 && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: cardColors.success, fontFamily: "'JetBrains Mono', monospace" }}>{m.resolvedToday}</div>
                <div style={{ fontSize: 7, color: cardColors.textMuted }}>resolved</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
