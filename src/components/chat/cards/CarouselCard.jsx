import React, { useState } from 'react';
import { cardBase, cardColors, CardActions } from './CardStyles';

export default function CarouselCard({ data, actions, onAction }) {
  const items = data?.items || [];
  const [idx, setIdx] = useState(0);
  if (items.length === 0) return null;
  const item = items[idx];

  return (
    <div style={{ ...cardBase }}>
      {data.title && (
        <div style={{ padding: '10px 12px 4px', fontSize: 11.5, fontWeight: 700, color: cardColors.textBright }}>{data.title}</div>
      )}
      <div style={{ padding: '6px 12px 8px' }}>
        <div style={{ padding: '8px 10px', borderRadius: 8, background: '#0A0C1488', border: `1px solid ${cardColors.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {item.icon && <span style={{ fontSize: 20 }}>{item.icon}</span>}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: cardColors.textBright }}>{item.title}</div>
              {item.subtitle && <div style={{ fontSize: 9, color: cardColors.textMuted, marginTop: 1 }}>{item.subtitle}</div>}
              {item.value !== undefined && (
                <div style={{ fontSize: 18, fontWeight: 800, color: cardColors.accent, fontFamily: "'JetBrains Mono', monospace", marginTop: 4 }}>
                  {item.value}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Pagination */}
        {items.length > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <button
              onClick={() => setIdx(i => Math.max(0, i - 1))}
              disabled={idx === 0}
              style={{ background: 'none', border: 'none', color: idx === 0 ? '#3A3F50' : cardColors.accent, cursor: idx === 0 ? 'default' : 'pointer', fontSize: 12, padding: '2px 6px' }}
            >◀</button>
            <span style={{ fontSize: 9, color: cardColors.textMuted }}>{idx + 1} / {items.length}</span>
            <button
              onClick={() => setIdx(i => Math.min(items.length - 1, i + 1))}
              disabled={idx === items.length - 1}
              style={{ background: 'none', border: 'none', color: idx === items.length - 1 ? '#3A3F50' : cardColors.accent, cursor: idx === items.length - 1 ? 'default' : 'pointer', fontSize: 12, padding: '2px 6px' }}
            >▶</button>
          </div>
        )}
      </div>
      <CardActions actions={actions} onAction={onAction} />
    </div>
  );
}
