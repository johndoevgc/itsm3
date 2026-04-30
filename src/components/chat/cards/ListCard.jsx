import React from 'react';
import { cardBase, cardColors, CardActions } from './CardStyles';

export default function ListCard({ data, actions, onAction }) {
  const items = data?.items || [];
  return (
    <div style={{ ...cardBase }}>
      {data.title && (
        <div style={{ padding: '10px 12px 6px', fontSize: 11.5, fontWeight: 700, color: cardColors.textBright }}>
          {data.title}
        </div>
      )}
      <div style={{ padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.slice(0, 8).map((item, i) => (
          <div
            key={i}
            onClick={() => item.onClick && onAction(item.onClick)}
            style={{
              padding: '6px 8px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8,
              cursor: item.onClick ? 'pointer' : 'default', transition: 'background 0.15s',
              background: 'transparent',
            }}
            onMouseOver={e => { if (item.onClick) e.currentTarget.style.background = '#ffffff06'; }}
            onMouseOut={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            {item.icon && <span style={{ fontSize: 14, flexShrink: 0 }}>{item.icon}</span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: cardColors.textBright, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
              {item.subtitle && <div style={{ fontSize: 9, color: cardColors.textMuted, marginTop: 1 }}>{item.subtitle}</div>}
            </div>
            {item.badge && (
              <span style={{
                fontSize: 8, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                background: `${item.badgeColor || cardColors.accent}18`, color: item.badgeColor || cardColors.accent,
              }}>{item.badge}</span>
            )}
          </div>
        ))}
      </div>
      <CardActions actions={actions} onAction={onAction} />
    </div>
  );
}
