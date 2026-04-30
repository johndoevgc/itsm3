import React, { useState } from 'react';
import { cardBase, cardColors, CardActions } from './CardStyles';

export default function ConfirmCard({ data, actions, onAction }) {
  const [decided, setDecided] = useState(null);

  const handleAction = (a) => {
    setDecided(a.type === 'confirm' ? 'confirmed' : 'cancelled');
    onAction(a);
  };

  if (decided) {
    return (
      <div style={{ ...cardBase, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>{decided === 'confirmed' ? '✅' : '✖️'}</span>
        <span style={{ fontSize: 11, color: decided === 'confirmed' ? cardColors.success : cardColors.textMuted, fontWeight: 600 }}>
          {decided === 'confirmed' ? 'Confirmed' : 'Cancelled'}
        </span>
      </div>
    );
  }

  return (
    <div style={{ ...cardBase }}>
      <div style={{ padding: '10px 12px 4px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 18 }}>{data.icon || '⚠️'}</span>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: cardColors.warning }}>{data.title}</div>
          <div style={{ fontSize: 10, color: cardColors.textMuted, marginTop: 3, lineHeight: 1.4 }}>{data.message}</div>
        </div>
      </div>
      <CardActions actions={actions} onAction={handleAction} />
    </div>
  );
}
