import { cardBase, cardColors, priorityColors, statusColors, CardBadge, CardActions } from './CardStyles';

export default function IncidentCard({ data, actions, onAction }) {
  const pColor = priorityColors[data.priority] || cardColors.textMuted;
  const sColor = statusColors[data.status] || cardColors.textMuted;
  return (
    <div style={{ ...cardBase }}>
      <div style={{ padding: '10px 12px 6px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 18, flexShrink: 0 }}>🎫</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: cardColors.accent, fontFamily: "'JetBrains Mono', monospace" }}>{data.id}</span>
            <CardBadge label={data.priority} color={pColor} />
            <CardBadge label={data.status} color={sColor} />
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: cardColors.textBright, marginTop: 3, lineHeight: 1.3 }}>
            {data.title}
          </div>
        </div>
      </div>
      <div style={{ padding: '2px 12px 8px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {data.assignee && (
          <span style={{ fontSize: 9, color: cardColors.textMuted }}>👤 {data.assignee}</span>
        )}
        {data.category && (
          <span style={{ fontSize: 9, color: cardColors.textMuted }}>📁 {data.category}</span>
        )}
        {data.slaTarget && (
          <span style={{ fontSize: 9, color: cardColors.textMuted }}>⏱️ SLA: {data.slaTarget}h</span>
        )}
      </div>
      {data.description && (
        <div style={{ padding: '0 12px 8px', fontSize: 10, color: cardColors.textMuted, lineHeight: 1.4 }}>
          {data.description}
        </div>
      )}
      <CardActions actions={actions} onAction={onAction} />
    </div>
  );
}
