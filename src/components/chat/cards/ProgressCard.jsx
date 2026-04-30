import React from 'react';
import { cardBase, cardColors } from './CardStyles';

export default function ProgressCard({ data, onAction }) {
  const steps = data?.steps || [];
  return (
    <div style={{ ...cardBase }}>
      {data.title && (
        <div style={{ padding: '10px 12px 6px', fontSize: 11.5, fontWeight: 700, color: cardColors.textBright, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>📋</span> {data.title}
        </div>
      )}
      <div style={{ padding: '4px 12px 10px' }}>
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          const dotColor = step.status === 'done' ? cardColors.success : step.status === 'active' ? cardColors.accent : '#3A3F50';
          return (
            <div key={i} style={{ display: 'flex', gap: 10 }}>
              {/* Timeline */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%', background: dotColor,
                  border: step.status === 'active' ? `2px solid ${cardColors.accent}44` : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {step.status === 'done' && <span style={{ fontSize: 6, color: '#fff' }}>✓</span>}
                </div>
                {!isLast && <div style={{ width: 1.5, flex: 1, background: step.status === 'done' ? cardColors.success : '#3A3F50', minHeight: 16 }} />}
              </div>
              {/* Content */}
              <div style={{ paddingBottom: isLast ? 0 : 8 }}>
                <div style={{
                  fontSize: 10, fontWeight: 600,
                  color: step.status === 'done' ? cardColors.success : step.status === 'active' ? cardColors.textBright : cardColors.textMuted,
                }}>{step.label}</div>
                {step.detail && <div style={{ fontSize: 9, color: cardColors.textMuted, marginTop: 1 }}>{step.detail}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
