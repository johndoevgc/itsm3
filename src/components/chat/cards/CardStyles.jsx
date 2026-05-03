// ─── Shared card styling constants ──────────────────────────────────────────
export const cardColors = {
  bg: '#0F1117',
  bgHover: '#161822',
  border: '#1E213066',
  borderHover: '#6366F144',
  text: '#C4CAD6',
  textMuted: '#8B8FA3',
  textBright: '#E8ECF4',
  accent: '#6366F1',
  success: '#22C55E',
  danger: '#EF4444',
  warning: '#FFB347',
  info: '#06B6D4',
};

export const priorityColors = {
  Critical: '#EF4444', P1: '#EF4444',
  High: '#F97316', P2: '#F97316',
  Medium: '#FFB347', P3: '#FFB347',
  Low: '#22C55E', P4: '#22C55E',
};

export const statusColors = {
  Open: '#3B82F6', 'In Progress': '#F59E0B', Resolved: '#22C55E',
  Closed: '#6B7280', Pending: '#8B5CF6', 'Awaiting Approval': '#F59E0B',
  Approved: '#22C55E', Rejected: '#EF4444', Cancelled: '#6B7280',
};

export const cardBase = {
  borderRadius: 10,
  background: cardColors.bg,
  border: `1px solid ${cardColors.border}`,
  overflow: 'hidden',
  transition: 'all 0.2s ease',
};

export const cardHeader = {
  padding: '10px 12px 6px',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

export const cardBody = {
  padding: '4px 12px 10px',
};

export const actionButton = (style = 'primary') => {
  const colors = {
    primary: { bg: '#6366F1', hover: '#818CF8', text: '#fff' },
    secondary: { bg: 'transparent', hover: '#6366F118', text: '#6366F1', border: '#6366F144' },
    success: { bg: '#22C55E', hover: '#4ADE80', text: '#fff' },
    danger: { bg: '#EF4444', hover: '#F87171', text: '#fff' },
    warning: { bg: '#FFB347', hover: '#FFCC80', text: '#1a1a2e' },
    ghost: { bg: 'transparent', hover: '#ffffff08', text: '#8B8FA3', border: '#1E213066' },
  };
  const c = colors[style] || colors.primary;
  return {
    padding: '5px 12px',
    fontSize: 10,
    fontWeight: 600,
    borderRadius: 6,
    border: c.border ? `1px solid ${c.border}` : 'none',
    background: c.bg,
    color: c.text,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    transition: 'all 0.2s',
    fontFamily: "'Space Grotesk', sans-serif",
  };
};

// ─── Reusable Badge ─────────────────────────────────────────────────────────
export function CardBadge({ label, color }) {
  return (
    <span style={{
      fontSize: 8, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
      background: `${color || cardColors.accent}18`,
      color: color || cardColors.accent,
      border: `1px solid ${color || cardColors.accent}33`,
      fontFamily: "'JetBrains Mono', monospace",
      textTransform: 'uppercase', letterSpacing: 0.5,
    }}>{label}</span>
  );
}

// ─── Action Button Row ──────────────────────────────────────────────────────
export function CardActions({ actions, onAction }) {
  if (!actions || actions.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '6px 12px 10px' }}>
      {actions.map((a, i) => (
        <button
          key={i}
          onClick={() => onAction(a)}
          style={actionButton(a.style || 'primary')}
          onMouseOver={e => { e.currentTarget.style.opacity = '0.85'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
          onMouseOut={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'none'; }}
        >
          {a.icon && <span>{a.icon}</span>}
          {a.label}
        </button>
      ))}
    </div>
  );
}
