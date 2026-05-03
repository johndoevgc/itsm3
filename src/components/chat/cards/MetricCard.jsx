import { cardBase, cardColors } from './CardStyles';

export default function MetricCard({ data, onAction }) {
  const metrics = data?.metrics || [];
  return (
    <div style={{ ...cardBase }}>
      <div style={{ padding: '10px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {metrics.map((m, i) => (
          <div key={i} style={{
            flex: '1 1 70px', padding: '8px 10px', borderRadius: 8,
            background: '#0A0C1488', border: `1px solid ${cardColors.border}`, textAlign: 'center',
          }}>
            {m.icon && <div style={{ fontSize: 14, marginBottom: 2 }}>{m.icon}</div>}
            <div style={{
              fontSize: 18, fontWeight: 800, color: m.color || cardColors.textBright,
              fontFamily: "'JetBrains Mono', monospace",
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
            }}>
              {m.value}{m.unit && <span style={{ fontSize: 9, fontWeight: 400, color: cardColors.textMuted }}>{m.unit}</span>}
              {m.trend && (
                <span style={{ fontSize: 9, color: m.trend === 'up' ? (m.trendIsGood ? cardColors.success : cardColors.danger) : (m.trendIsGood !== false ? cardColors.success : cardColors.danger) }}>
                  {m.trend === 'up' ? '▲' : m.trend === 'down' ? '▼' : '—'}
                  {m.trendValue && <span style={{ fontSize: 8 }}>{m.trendValue}</span>}
                </span>
              )}
            </div>
            <div style={{ fontSize: 8, color: cardColors.textMuted, marginTop: 2 }}>{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
