import React, { useState } from 'react';
import { cardBase, cardColors, priorityColors, CardBadge, actionButton } from './CardStyles';

export default function ApprovalCard({ data, actions, onAction }) {
  const [decision, setDecision] = useState(null);
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);

  const handleDecision = (type) => {
    setDecision(type);
    const action = actions?.find(a => a.type === type) || { type, payload: { id: data.id } };
    onAction({ ...action, payload: { ...action.payload, comment } });
  };

  if (decision) {
    return (
      <div style={{ ...cardBase, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>{decision === 'approve' ? '✅' : '❌'}</span>
        <div>
          <span style={{ fontSize: 11, color: decision === 'approve' ? cardColors.success : cardColors.danger, fontWeight: 600 }}>
            {decision === 'approve' ? 'Approved' : 'Rejected'}
          </span>
          {comment && <div style={{ fontSize: 9, color: cardColors.textMuted, marginTop: 2 }}>"{comment}"</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...cardBase }}>
      <div style={{ padding: '10px 12px 6px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 18 }}>📋</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: cardColors.accent, fontFamily: "'JetBrains Mono', monospace" }}>{data.id}</span>
            <CardBadge label={data.type || 'Change'} color={cardColors.info} />
            {data.risk && <CardBadge label={`Risk: ${data.risk}`} color={priorityColors[data.risk] || cardColors.warning} />}
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: cardColors.textBright, marginTop: 3 }}>{data.title}</div>
        </div>
      </div>
      <div style={{ padding: '2px 12px 6px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {data.requestedBy && <span style={{ fontSize: 9, color: cardColors.textMuted }}>👤 {data.requestedBy}</span>}
        {data.scheduledDate && <span style={{ fontSize: 9, color: cardColors.textMuted }}>📅 {data.scheduledDate}</span>}
        {data.impact && <span style={{ fontSize: 9, color: cardColors.textMuted }}>💥 Impact: {data.impact}</span>}
      </div>
      {data.description && (
        <div style={{ padding: '0 12px 6px', fontSize: 10, color: cardColors.textMuted, lineHeight: 1.4 }}>{data.description}</div>
      )}
      {showComment && (
        <div style={{ padding: '0 12px 6px' }}>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Add a comment (optional)..."
            rows={2}
            style={{
              width: '100%', padding: '6px 8px', fontSize: 10, background: '#0A0C14',
              border: '1px solid #1E2130', borderRadius: 6, color: cardColors.text,
              fontFamily: "'Space Grotesk', sans-serif", resize: 'none', outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, padding: '4px 12px 10px', flexWrap: 'wrap' }}>
        <button onClick={() => handleDecision('approve')} style={actionButton('success')}>✅ Approve</button>
        <button onClick={() => handleDecision('reject')} style={actionButton('danger')}>❌ Reject</button>
        <button onClick={() => setShowComment(!showComment)} style={actionButton('ghost')}>💬 {showComment ? 'Hide' : 'Comment'}</button>
        {actions?.find(a => a.type === 'navigate') && (
          <button onClick={() => onAction(actions.find(a => a.type === 'navigate'))} style={actionButton('ghost')}>📋 Details</button>
        )}
      </div>
    </div>
  );
}
