import React from 'react';
import { cardBase, cardColors } from './CardStyles';

export default function StatusCard({ data, onAction }) {
  return (
    <div style={{ ...cardBase }}>
      <div style={{ padding: '10px 12px 6px', fontSize: 11.5, fontWeight: 700, color: cardColors.textBright, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>📊</span> {data.title}
      </div>
      <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {(data.items || []).map((item, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: i < data.items.length - 1 ? `1px solid ${cardColors.border}` : 'none' }}>
            <span style={{ fontSize: 10, color: cardColors.textMuted, display: 'flex', alignItems: 'center', gap: 4 }}>
              {item.icon && <span>{item.icon}</span>}
              {item.label}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: item.color || cardColors.textBright, fontFamily: "'JetBrains Mono', monospace" }}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
