import React, { useState } from 'react';
import { cardBase, cardColors, actionButton } from './CardStyles';

export default function FormCard({ data, onAction }) {
  const [values, setValues] = useState(() => {
    const init = {};
    (data.fields || []).forEach(f => { init[f.name] = f.defaultValue || ''; });
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (name, val) => setValues(prev => ({ ...prev, [name]: val }));

  const handleSubmit = () => {
    const missing = (data.fields || []).filter(f => f.required && !values[f.name]?.toString().trim());
    if (missing.length > 0) return; // basic validation
    setSubmitting(true);
    onAction({ type: 'submit_form', payload: { ...data.submitAction?.payload, formData: values, formName: data.title } });
    setTimeout(() => { setSubmitting(false); setSubmitted(true); }, 600);
  };

  if (submitted) {
    return (
      <div style={{ ...cardBase, padding: '14px 16px', textAlign: 'center' }}>
        <span style={{ fontSize: 24 }}>✅</span>
        <div style={{ fontSize: 11, fontWeight: 600, color: cardColors.success, marginTop: 4 }}>
          {data.title} submitted successfully
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...cardBase }}>
      <div style={{ padding: '10px 12px 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 16 }}>{data.icon || '📝'}</span>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: cardColors.textBright }}>{data.title}</div>
          {data.subtitle && <div style={{ fontSize: 9, color: cardColors.textMuted }}>{data.subtitle}</div>}
        </div>
      </div>
      <div style={{ padding: '6px 12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(data.fields || []).map(f => (
          <div key={f.name}>
            <label style={{ fontSize: 9, fontWeight: 600, color: cardColors.textMuted, display: 'block', marginBottom: 3 }}>
              {f.label} {f.required && <span style={{ color: cardColors.danger }}>*</span>}
            </label>
            {f.type === 'select' ? (
              <select
                value={values[f.name] || ''}
                onChange={e => handleChange(f.name, e.target.value)}
                style={{
                  width: '100%', padding: '6px 8px', fontSize: 10.5, background: '#0A0C14',
                  border: `1px solid #1E2130`, borderRadius: 6, color: cardColors.text,
                  fontFamily: "'Space Grotesk', sans-serif", outline: 'none',
                }}
              >
                <option value="">Select...</option>
                {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea
                value={values[f.name] || ''}
                onChange={e => handleChange(f.name, e.target.value)}
                placeholder={f.placeholder}
                rows={3}
                style={{
                  width: '100%', padding: '6px 8px', fontSize: 10.5, background: '#0A0C14',
                  border: `1px solid #1E2130`, borderRadius: 6, color: cardColors.text,
                  fontFamily: "'Space Grotesk', sans-serif", resize: 'vertical', outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            ) : (
              <input
                type={f.type || 'text'}
                value={values[f.name] || ''}
                onChange={e => handleChange(f.name, e.target.value)}
                placeholder={f.placeholder}
                style={{
                  width: '100%', padding: '6px 8px', fontSize: 10.5, background: '#0A0C14',
                  border: `1px solid #1E2130`, borderRadius: 6, color: cardColors.text,
                  fontFamily: "'Space Grotesk', sans-serif", outline: 'none', boxSizing: 'border-box',
                }}
              />
            )}
          </div>
        ))}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          style={{ ...actionButton('primary'), width: '100%', justifyContent: 'center', padding: '8px 14px', fontSize: 11, marginTop: 4 }}
        >
          {submitting ? '⏳ Submitting...' : (data.submitLabel || '📤 Submit')}
        </button>
      </div>
    </div>
  );
}
