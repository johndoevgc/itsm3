import { cardColors } from './CardStyles';

export default function QuickReplyCard({ data, onAction }) {
  const replies = data?.replies || [];
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
      {replies.slice(0, 6).map((r, i) => (
        <button
          key={i}
          onClick={() => onAction({ type: 'chat_reply', payload: { text: r.action || r.label } })}
          style={{
            padding: '6px 12px', fontSize: 10, background: '#12141E',
            border: `1px solid ${cardColors.accent}33`, borderRadius: 10,
            color: cardColors.text, cursor: 'pointer',
            fontFamily: "'Space Grotesk', sans-serif", transition: 'all 0.2s',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
          onMouseOver={e => { e.currentTarget.style.background = `${cardColors.accent}18`; e.currentTarget.style.borderColor = `${cardColors.accent}55`; e.currentTarget.style.color = cardColors.textBright; }}
          onMouseOut={e => { e.currentTarget.style.background = '#12141E'; e.currentTarget.style.borderColor = `${cardColors.accent}33`; e.currentTarget.style.color = cardColors.text; }}
        >
          {r.icon || '💡'} {r.label}
        </button>
      ))}
    </div>
  );
}
