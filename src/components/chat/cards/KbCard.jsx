import { cardBase, cardColors, CardActions } from './CardStyles';

export default function KbCard({ data, actions, onAction }) {
  return (
    <div style={{ ...cardBase }}>
      <div style={{ padding: '10px 12px 6px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 16, flexShrink: 0 }}>📚</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: cardColors.textBright, lineHeight: 1.3 }}>{data.title}</div>
          {data.category && (
            <span style={{
              fontSize: 8, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
              background: `${cardColors.info}15`, color: cardColors.info,
              border: `1px solid ${cardColors.info}22`, marginTop: 3, display: 'inline-block',
            }}>{data.category}</span>
          )}
        </div>
      </div>
      {data.summary && (
        <div style={{ padding: '0 12px 6px', fontSize: 10, color: cardColors.textMuted, lineHeight: 1.5 }}>{data.summary}</div>
      )}
      {data.tags && data.tags.length > 0 && (
        <div style={{ padding: '0 12px 6px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {data.tags.slice(0, 5).map((tag, i) => (
            <span key={i} style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: '#1E2130', color: cardColors.textMuted }}>{tag}</span>
          ))}
        </div>
      )}
      <div style={{ padding: '0 12px 6px', display: 'flex', gap: 8 }}>
        {data.views !== undefined && <span style={{ fontSize: 8, color: cardColors.textMuted }}>👁️ {data.views} views</span>}
        {data.helpful !== undefined && <span style={{ fontSize: 8, color: cardColors.textMuted }}>👍 {data.helpful} helpful</span>}
      </div>
      <CardActions actions={actions} onAction={onAction} />
    </div>
  );
}
