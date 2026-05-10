// ─── Chat Card Type System & Message Format ────────────────────────────────
// WhatsApp/iMessage-style interactive card system for VGC ITSM AI Chat

export const CARD_TYPES = {
  QUICK_REPLY:   'quick_reply',
  INCIDENT_CARD: 'incident_card',
  FORM_CARD:     'form_card',
  CONFIRM_CARD:  'confirm_card',
  APPROVAL_CARD: 'approval_card',
  STATUS_CARD:   'status_card',
  BRIEFING_CARD: 'briefing_card',
  SLA_ALERT_CARD:'sla_alert_card',
  KB_CARD:       'kb_card',
  LIST_CARD:     'list_card',
  TEAM_CARD:     'team_card',
  PROGRESS_CARD: 'progress_card',
  CAROUSEL_CARD: 'carousel_card',
  METRIC_CARD:   'metric_card',
};

// Card action button styles
export const ACTION_STYLES = {
  PRIMARY:   'primary',
  SECONDARY: 'secondary',
  SUCCESS:   'success',
  DANGER:    'danger',
  WARNING:   'warning',
  GHOST:     'ghost',
};

// Card action types — what happens on click
export const ACTION_TYPES = {
  NAVIGATE:     'navigate',      // go to a module
  OPEN_MODAL:   'open_modal',    // open a modal dialog
  API_CALL:     'api_call',      // call server API
  CHAT_REPLY:   'chat_reply',    // send text back to AI chat
  CONFIRM:      'confirm',       // show confirmation card first
  SUBMIT_FORM:  'submit_form',   // submit inline form data
  APPROVE:      'approve',       // approve workflow
  REJECT:       'reject',        // reject workflow
  COPY:         'copy',          // copy text to clipboard
  EXTERNAL:     'external',      // open external link
};

// ─── Card Schema Factories ──────────────────────────────────────────────────

export function makeQuickReplyCard(replies) {
  return {
    type: CARD_TYPES.QUICK_REPLY,
    id: `qr_${Date.now()}`,
    data: { replies }, // [{ label, icon?, action (text to send) }]
  };
}

export function makeIncidentCard(incident, actions = [], { customerSafe = false } = {}) {
  const data = {
    id: incident.id,
    title: incident.title || incident.subject,
    priority: incident.priority,
    status: incident.status,
    category: incident.category,
    created: incident.createdAt || incident.created,
    description: incident.description?.substring(0, 120),
  };
  if (!customerSafe) {
    data.assignee = incident.assignedTo || incident.assignee;
    data.slaTarget = incident.slaTarget;
  }
  return {
    type: CARD_TYPES.INCIDENT_CARD,
    id: `inc_${incident.id || Date.now()}`,
    data,
    actions,
  };
}

export function makeFormCard(formTemplate) {
  return {
    type: CARD_TYPES.FORM_CARD,
    id: `form_${formTemplate.name || Date.now()}`,
    data: {
      title: formTemplate.title,
      subtitle: formTemplate.subtitle,
      icon: formTemplate.icon,
      fields: formTemplate.fields, // [{ name, label, type, required, options?, placeholder?, defaultValue? }]
      submitLabel: formTemplate.submitLabel || 'Submit',
      submitAction: formTemplate.submitAction, // { type, payload }
    },
    actions: [],
  };
}

export function makeConfirmCard(title, message, onConfirm, onCancel) {
  return {
    type: CARD_TYPES.CONFIRM_CARD,
    id: `cfm_${Date.now()}`,
    data: { title, message, icon: '⚠️' },
    actions: [
      { label: 'Confirm', icon: '✅', style: ACTION_STYLES.SUCCESS, type: ACTION_TYPES.CONFIRM, payload: onConfirm },
      { label: 'Cancel', icon: '✖️', style: ACTION_STYLES.GHOST, type: ACTION_TYPES.REJECT, payload: onCancel },
    ],
  };
}

export function makeApprovalCard(item) {
  return {
    type: CARD_TYPES.APPROVAL_CARD,
    id: `apr_${item.id || Date.now()}`,
    data: {
      id: item.id,
      title: item.title || item.subject,
      type: item.type || 'Change Request',
      requestedBy: item.requestedBy || item.requester,
      risk: item.risk,
      impact: item.impact,
      description: item.description?.substring(0, 150),
      scheduledDate: item.scheduledDate,
    },
    actions: [
      { label: 'Approve', icon: '✅', style: ACTION_STYLES.SUCCESS, type: ACTION_TYPES.APPROVE, payload: { id: item.id } },
      { label: 'Reject', icon: '❌', style: ACTION_STYLES.DANGER, type: ACTION_TYPES.REJECT, payload: { id: item.id } },
      { label: 'View Details', icon: '📋', style: ACTION_STYLES.GHOST, type: ACTION_TYPES.NAVIGATE, payload: { module: 'changes', id: item.id } },
    ],
  };
}

export function makeStatusCard(title, statusItems) {
  return {
    type: CARD_TYPES.STATUS_CARD,
    id: `sts_${Date.now()}`,
    data: {
      title,
      items: statusItems, // [{ label, value, color?, icon? }]
    },
    actions: [],
  };
}

export function makeBriefingCard(briefing) {
  return {
    type: CARD_TYPES.BRIEFING_CARD,
    id: `brf_${Date.now()}`,
    data: {
      greeting: briefing.greeting,
      timeOfDay: briefing.timeOfDay,
      stats: briefing.stats, // [{ label, value, trend?, color? }]
      highlights: briefing.highlights, // [{ icon, text, severity? }]
      actions: briefing.actions, // [{ label, icon, action }]
    },
    actions: [],
  };
}

export function makeSlaAlertCard(tickets) {
  return {
    type: CARD_TYPES.SLA_ALERT_CARD,
    id: `sla_${Date.now()}`,
    data: {
      tickets: tickets.map(t => ({
        id: t.id,
        title: t.title || t.subject,
        priority: t.priority,
        elapsed: t.elapsed,
        target: t.slaTarget,
        percentUsed: t.percentUsed,
      })),
    },
    actions: [
      { label: 'View SLA Dashboard', icon: '⏱️', style: ACTION_STYLES.SECONDARY, type: ACTION_TYPES.NAVIGATE, payload: { module: 'sla' } },
    ],
  };
}

export function makeKbCard(article) {
  return {
    type: CARD_TYPES.KB_CARD,
    id: `kb_${article.id || Date.now()}`,
    data: {
      id: article.id,
      title: article.title,
      category: article.category,
      summary: article.summary || article.content?.substring(0, 150),
      tags: article.tags,
      views: article.views,
      helpful: article.helpful,
    },
    actions: [
      { label: 'View Article', icon: '📖', style: ACTION_STYLES.PRIMARY, type: ACTION_TYPES.NAVIGATE, payload: { module: 'knowledge', id: article.id } },
      { label: 'Apply Solution', icon: '✅', style: ACTION_STYLES.SUCCESS, type: ACTION_TYPES.CHAT_REPLY, payload: { text: `Apply the solution from KB article "${article.title}"` } },
    ],
  };
}

export function makeListCard(title, items, actions = []) {
  return {
    type: CARD_TYPES.LIST_CARD,
    id: `lst_${Date.now()}`,
    data: {
      title,
      items, // [{ icon, title, subtitle, badge?, badgeColor?, onClick? }]
    },
    actions,
  };
}

export function makeTeamCard(members) {
  return {
    type: CARD_TYPES.TEAM_CARD,
    id: `team_${Date.now()}`,
    data: {
      members: members.map(m => ({
        name: m.name,
        role: m.role || m.rbacRole,
        avatar: m.avatar,
        status: m.status || 'available',
        activeTickets: m.activeTickets || 0,
        resolvedToday: m.resolvedToday || 0,
      })),
    },
    actions: [],
  };
}

export function makeProgressCard(title, steps) {
  return {
    type: CARD_TYPES.PROGRESS_CARD,
    id: `prg_${Date.now()}`,
    data: {
      title,
      steps, // [{ label, status: 'done'|'active'|'pending', detail? }]
    },
    actions: [],
  };
}

export function makeCarouselCard(title, items) {
  return {
    type: CARD_TYPES.CAROUSEL_CARD,
    id: `crl_${Date.now()}`,
    data: {
      title,
      items, // [{ icon, title, subtitle, value?, actions? }]
    },
    actions: [],
  };
}

export function makeMetricCard(metrics) {
  return {
    type: CARD_TYPES.METRIC_CARD,
    id: `mtc_${Date.now()}`,
    data: {
      metrics: metrics.map(m => ({
        label: m.label,
        value: m.value,
        unit: m.unit,
        trend: m.trend,       // 'up'|'down'|'flat'
        trendValue: m.trendValue,
        color: m.color,
        icon: m.icon,
      })),
    },
    actions: [],
  };
}

// ─── Form Templates ─────────────────────────────────────────────────────────

export const FORM_TEMPLATES = {
  incident_quick: {
    name: 'incident_quick',
    title: 'Quick Incident',
    subtitle: 'Report an issue in seconds',
    icon: '🎫',
    fields: [
      { name: 'title', label: 'What happened?', type: 'text', required: true, placeholder: 'Brief description of the issue...' },
      { name: 'priority', label: 'Priority', type: 'select', required: true, options: ['Low', 'Medium', 'High', 'Critical'], defaultValue: 'Medium' },
      { name: 'category', label: 'Category', type: 'select', required: false, options: ['Hardware', 'Software', 'Network', 'Access', 'Email', 'Other'] },
    ],
    submitLabel: '🎫 Create Incident',
    submitAction: { type: ACTION_TYPES.API_CALL, payload: { endpoint: '/api/ai/chat/create-ticket', method: 'POST' } },
  },
  incident_full: {
    name: 'incident_full',
    title: 'New Incident',
    subtitle: 'Full incident report',
    icon: '🎫',
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Brief summary...' },
      { name: 'description', label: 'Description', type: 'textarea', required: true, placeholder: 'Detailed description of the issue...' },
      { name: 'priority', label: 'Priority', type: 'select', required: true, options: ['Low', 'Medium', 'High', 'Critical'], defaultValue: 'Medium' },
      { name: 'category', label: 'Category', type: 'select', required: true, options: ['Hardware', 'Software', 'Network', 'Access', 'Email', 'Security', 'Other'] },
      { name: 'affectedUser', label: 'Affected User', type: 'text', required: false, placeholder: 'Who is affected?' },
    ],
    submitLabel: '🎫 Create Incident',
    submitAction: { type: ACTION_TYPES.API_CALL, payload: { endpoint: '/api/ai/chat/create-ticket', method: 'POST' } },
  },
  service_request: {
    name: 'service_request',
    title: 'Service Request',
    subtitle: 'Request a service or resource',
    icon: '📋',
    fields: [
      { name: 'title', label: 'What do you need?', type: 'text', required: true, placeholder: 'e.g., New laptop, Software access...' },
      { name: 'description', label: 'Details', type: 'textarea', required: false, placeholder: 'Additional details...' },
      { name: 'priority', label: 'Priority', type: 'select', required: true, options: ['Low', 'Medium', 'High'], defaultValue: 'Medium' },
      { name: 'requestedFor', label: 'Requested For', type: 'text', required: false, placeholder: 'If not for yourself...' },
    ],
    submitLabel: '📋 Submit Request',
    submitAction: { type: ACTION_TYPES.API_CALL, payload: { endpoint: '/api/db/requests', method: 'POST' } },
  },
  change_request: {
    name: 'change_request',
    title: 'Change Request',
    subtitle: 'Propose a change',
    icon: '🔄',
    fields: [
      { name: 'title', label: 'Change Title', type: 'text', required: true, placeholder: 'What change is proposed?' },
      { name: 'description', label: 'Description & Justification', type: 'textarea', required: true, placeholder: 'Describe the change and why it is needed...' },
      { name: 'type', label: 'Change Type', type: 'select', required: true, options: ['Standard', 'Normal', 'Emergency'], defaultValue: 'Normal' },
      { name: 'risk', label: 'Risk Level', type: 'select', required: true, options: ['Low', 'Medium', 'High', 'Critical'], defaultValue: 'Medium' },
      { name: 'scheduledDate', label: 'Planned Date', type: 'date', required: false },
    ],
    submitLabel: '🔄 Submit Change',
    submitAction: { type: ACTION_TYPES.API_CALL, payload: { endpoint: '/api/db/changes', method: 'POST' } },
  },
  feedback: {
    name: 'feedback',
    title: 'Quick Feedback',
    subtitle: 'Rate your experience',
    icon: '⭐',
    fields: [
      { name: 'rating', label: 'Rating', type: 'select', required: true, options: ['⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐'], defaultValue: '⭐⭐⭐⭐' },
      { name: 'comment', label: 'Comment', type: 'textarea', required: false, placeholder: 'Any feedback?' },
    ],
    submitLabel: '📤 Send Feedback',
    submitAction: { type: ACTION_TYPES.API_CALL, payload: { endpoint: '/api/feedback', method: 'POST' } },
  },
};

// ─── Role Detection Helpers ─────────────────────────────────────────────────

const MANAGEMENT_ROLES = new Set([
  'VGC Dev Admin', 'Tenant Admin', 'Administrator', 'Service Desk Lead',
  'Change Manager', 'Problem Manager', 'Asset Manager',
]);
const ENGINEER_ROLES = new Set([
  'L1 Engineer', 'L2 Engineer', 'Network Engineer',
  'Service Desk Lead', // dual role
]);
const CUSTOMER_ROLES = new Set(['End User', 'Read Only']);

export function detectUserTier(rbacRole) {
  if (MANAGEMENT_ROLES.has(rbacRole)) return 'management';
  if (ENGINEER_ROLES.has(rbacRole)) return 'engineer';
  if (CUSTOMER_ROLES.has(rbacRole)) return 'customer';
  return 'customer'; // safe default — least-privilege
}
