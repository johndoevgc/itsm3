import { cardBase, cardColors, priorityColors, CardBadge, CardActions } from './CardStyles';

export default function SlaAlertCard({ data, actions, onAction }) {
  const tickets = data?.tickets || [];
  return (
    <div style={{ ...cardBase, borderColor: `${cardColors.danger}33` }}>
      <div style={{ padding: '10px 12px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 16 }}>⏱️</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: cardColors.danger }}>SLA Alert — {tickets.length} ticket{tickets.length !== 1 ? 's' : ''} at risk</span>
      </div>
      <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {tickets.slice(0, 5).map((t, i) => {
          const pct = t.percentUsed || 0;
          const barColor = pct >= 100 ? cardColors.danger : pct >= 75 ? cardColors.warning : cardColors.success;
          return (
            <div key={i} style={{ padding: '6px 8px', borderRadius: 6, background: '#0A0C1488', border: `1px solid ${cardColors.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: cardColors.textBright }}>{t.id}</span>
                <CardBadge label={t.priority} color={priorityColors[t.priority]} />
              </div>
              <div style={{ fontSize: 9, color: cardColors.textMuted, marginTop: 2 }}>{t.title}</div>
              <div style={{ marginTop: 4, background: '#1E2130', borderRadius: 3, height: 4, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width 0.5s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                <span style={{ fontSize: 8, color: cardColors.textMuted }}>{t.elapsed}h elapsed</span>
                <span style={{ fontSize: 8, color: barColor, fontWeight: 700 }}>{pct}% of {t.target}h</span>
              </div>
            </div>
          );
        })}
      </div>
      <CardActions actions={actions} onAction={onAction} />
    </div>
  );
}
