import { cardBase, cardColors, actionButton } from './CardStyles';

export default function BriefingCard({ data, onAction }) {
  return (
    <div style={{ ...cardBase, background: 'linear-gradient(135deg, #0F1117 0%, #131520 100%)' }}>
      {/* Header */}
      <div style={{ padding: '12px 14px 6px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: cardColors.textBright }}>
          {data.greeting || `Good ${data.timeOfDay || 'morning'} ☀️`}
        </div>
        <div style={{ fontSize: 9, color: cardColors.textMuted, marginTop: 2 }}>Here's your ITSM briefing</div>
      </div>
      {/* Stats row */}
      {data.stats && data.stats.length > 0 && (
        <div style={{ padding: '4px 14px 8px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {data.stats.map((s, i) => (
            <div key={i} style={{
              flex: '1 1 60px', padding: '6px 8px', borderRadius: 6,
              background: '#0A0C1488', border: `1px solid ${cardColors.border}`, textAlign: 'center',
            }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: s.color || cardColors.textBright, fontFamily: "'JetBrains Mono', monospace" }}>
                {s.value}
                {s.trend && (
                  <span style={{ fontSize: 8, marginLeft: 3, color: s.trend === 'up' ? cardColors.danger : cardColors.success }}>
                    {s.trend === 'up' ? '▲' : '▼'}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 8, color: cardColors.textMuted, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}
      {/* Highlights */}
      {data.highlights && data.highlights.length > 0 && (
        <div style={{ padding: '2px 14px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.highlights.map((h, i) => (
            <div key={i} style={{
              fontSize: 10, color: h.severity === 'critical' ? cardColors.danger : h.severity === 'warning' ? cardColors.warning : cardColors.text,
              display: 'flex', alignItems: 'flex-start', gap: 6, lineHeight: 1.4,
            }}>
              <span style={{ flexShrink: 0 }}>{h.icon || '•'}</span>
              <span>{h.text}</span>
            </div>
          ))}
        </div>
      )}
      {/* Quick actions */}
      {data.actions && data.actions.length > 0 && (
        <div style={{ padding: '4px 14px 10px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {data.actions.map((a, i) => (
            <button
              key={i}
              onClick={() => onAction({ type: 'chat_reply', payload: { text: a.action } })}
              style={actionButton('secondary')}
            >
              {a.icon && <span>{a.icon}</span>} {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
