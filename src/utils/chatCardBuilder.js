// ─── Chat Card Builder — Intent Detection → Card Generation ─────────────────
// Replaces detectAiActionCards() and smartSuggestions with role-aware card system
import {
  CARD_TYPES, ACTION_TYPES, ACTION_STYLES,
  makeQuickReplyCard, makeIncidentCard, makeFormCard, makeConfirmCard,
  makeApprovalCard, makeStatusCard, makeBriefingCard, makeSlaAlertCard,
  makeKbCard, makeListCard, makeTeamCard, makeProgressCard,
  makeCarouselCard, makeMetricCard,
  FORM_TEMPLATES, detectUserTier,
} from './chatCards';

// ─── Intent Detection ───────────────────────────────────────────────────────

const INTENT_PATTERNS = [
  { intent: 'create_incident',   patterns: [/create.*(?:ticket|incident)/i, /new.*incident/i, /raise.*incident/i, /log.*issue/i, /report.*issue/i, /submit.*ticket/i] },
  { intent: 'create_request',    patterns: [/create.*(?:request|service request)/i, /new.*request/i, /submit.*request/i, /need.*(?:laptop|software|access|equipment|license)/i] },
  { intent: 'create_change',     patterns: [/create.*change/i, /raise.*change/i, /new.*change/i, /change.*request/i] },
  { intent: 'create_problem',    patterns: [/create.*problem/i, /new.*problem/i, /log.*problem/i] },
  { intent: 'briefing',          patterns: [/morning.*briefing/i, /daily.*summary/i, /good morning/i, /briefing/i, /what.*happening/i, /status.*update/i, /overview/i, /what.*need.*attention/i] },
  { intent: 'sla_check',         patterns: [/sla/i, /breach/i, /at.*risk/i, /overdue/i, /response.*time/i] },
  { intent: 'open_tickets',      patterns: [/open.*ticket/i, /my.*ticket/i, /pending.*ticket/i, /show.*incident/i, /list.*incident/i, /ticket.*queue/i, /what.*open/i] },
  { intent: 'escalate',          patterns: [/escalat/i, /urgent/i, /critical.*issue/i] },
  { intent: 'assign',            patterns: [/assign.*ticket/i, /reassign/i, /delegate/i] },
  { intent: 'kb_search',         patterns: [/knowledge/i, /kb/i, /article/i, /search.*solution/i, /how.*to/i, /guide/i, /documentation/i] },
  { intent: 'approval',          patterns: [/approv/i, /pending.*approval/i, /review.*change/i] },
  { intent: 'reports',           patterns: [/report/i, /analytics/i, /dashboard/i, /statistics/i, /metrics/i, /performance/i, /kpi/i] },
  { intent: 'team',              patterns: [/team/i, /workload/i, /capacity/i, /who.*available/i, /staff/i, /engineer.*status/i] },
  { intent: 'email',             patterns: [/email/i, /draft.*email/i, /send.*email/i, /compose/i] },
  { intent: 'duplicates',        patterns: [/duplicate/i, /merge/i, /similar.*ticket/i] },
  { intent: 'patterns',          patterns: [/pattern/i, /root.*cause/i, /trend/i, /recurring/i] },
  { intent: 'train_ai',          patterns: [/train/i, /teach/i, /correct/i, /improve.*ai/i] },
  { intent: 'password',          patterns: [/password/i, /reset.*access/i, /locked.*out/i, /can.*t.*login/i, /account.*issue/i] },
  { intent: 'mfa',               patterns: [/mfa/i, /multi.*factor/i, /authenticator/i, /2fa/i, /two.*factor/i, /verification.*code/i] },
  { intent: 'onboarding',        patterns: [/onboard/i, /new.*joiner/i, /new.*starter/i, /first.*day/i, /setup.*account/i, /new.*employee/i, /getting.*started/i, /initial.*setup/i] },
  { intent: 'security',          patterns: [/security/i, /threat/i, /vulnerability/i, /phishing/i, /malware/i, /suspicious/i, /compromised/i] },
  { intent: 'connectivity',       patterns: [/vpn/i, /wifi/i, /wi-fi/i, /internet/i, /network/i, /can.*t.*connect/i, /no.*connection/i, /slow.*network/i, /disconnect/i] },
  { intent: 'software',           patterns: [/install/i, /software/i, /update/i, /upgrade/i, /app.*crash/i, /not.*working/i, /error.*message/i, /outlook/i, /teams/i, /excel/i, /word/i] },
  { intent: 'hardware',           patterns: [/printer/i, /laptop/i, /monitor/i, /keyboard/i, /mouse/i, /headset/i, /docking/i, /charger/i, /hardware/i, /device/i, /screen/i, /display/i] },
  { intent: 'help',              patterns: [/^\/help$/i, /what.*can.*you.*do/i, /help.*me/i] },
];

function detectIntent(userMsg) {
  const text = (userMsg || '').toLowerCase().trim();
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some(p => p.test(text))) return intent;
  }
  return null;
}

// ─── Card Builders Per Intent ───────────────────────────────────────────────

function buildBriefingCards(ctx) {
  const { incidents = [], changes = [], problems = [], requests = [], currentUser } = ctx;
  const now = new Date();
  const hour = now.getHours();
  const todayStr = now.toISOString().slice(0, 10);
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

  const open = incidents.filter(i => i.status === 'Open' || i.status === 'In Progress');
  const critical = open.filter(i => i.priority === 'Critical' || i.priority === 'P1');
  const high = open.filter(i => i.priority === 'High' || i.priority === 'P2');
  const createdToday = incidents.filter(i => (i.createdAt || i.created || '').toString().startsWith(todayStr));
  const resolvedToday = incidents.filter(i => (i.status === 'Resolved' || i.status === 'Closed') && (i.resolvedAt || '').startsWith(todayStr));
  const pendingApproval = changes.filter(c => c.status === 'Awaiting Approval');

  const cards = [];

  // Briefing card
  cards.push(makeBriefingCard({
    greeting: `Good ${timeOfDay}, ${currentUser.name?.split(' ')[0] || 'there'} ☀️`,
    timeOfDay,
    stats: [
      { label: 'Open', value: open.length, color: '#3B82F6' },
      { label: 'Critical', value: critical.length, color: critical.length > 0 ? '#EF4444' : '#22C55E' },
      { label: 'Created Today', value: createdToday.length },
      { label: 'Resolved Today', value: resolvedToday.length, color: '#22C55E' },
    ],
    highlights: [
      ...(critical.length > 0 ? [{ icon: '🔴', text: `${critical.length} critical incident${critical.length > 1 ? 's' : ''} need immediate attention`, severity: 'critical' }] : []),
      ...(high.length > 0 ? [{ icon: '🟠', text: `${high.length} high-priority ticket${high.length > 1 ? 's' : ''} in queue`, severity: 'warning' }] : []),
      ...(pendingApproval.length > 0 ? [{ icon: '📋', text: `${pendingApproval.length} change${pendingApproval.length > 1 ? 's' : ''} awaiting approval` }] : []),
      ...(open.length === 0 ? [{ icon: '✅', text: 'All clear — no open incidents!' }] : []),
    ],
    actions: [
      { label: 'Priority Actions', icon: '🎯', action: 'What are my top priority actions today?' },
      { label: 'SLA At-Risk', icon: '⏱️', action: 'Show SLA at-risk tickets' },
      { label: 'Team Status', icon: '👥', action: 'Show team workload' },
    ],
  }));

  // If critical incidents, add SLA alert
  if (critical.length > 0) {
    const slaTickets = critical.slice(0, 5).map(t => {
      const created = new Date(t.createdAt || t.created);
      const elapsed = Math.round((now - created) / 3600000 * 10) / 10;
      const target = t.slaTarget || 4;
      return { ...t, title: t.title || t.subject, elapsed, target: t.slaTarget || 4, percentUsed: Math.round(elapsed / target * 100) };
    });
    cards.push(makeSlaAlertCard(slaTickets));
  }

  return cards;
}

function buildOpenTicketCards(ctx) {
  const { incidents = [], currentUser } = ctx;
  const open = incidents.filter(i => i.status === 'Open' || i.status === 'In Progress');
  const cards = [];

  if (open.length === 0) {
    cards.push(makeStatusCard('Ticket Queue', [
      { icon: '✅', label: 'Status', value: 'All clear!', color: '#22C55E' },
    ]));
  } else {
    // Show top 5 by priority
    const sorted = [...open].sort((a, b) => {
      const po = { Critical: 0, P1: 0, High: 1, P2: 1, Medium: 2, P3: 2, Low: 3, P4: 3 };
      return (po[a.priority] ?? 4) - (po[b.priority] ?? 4);
    });
    sorted.slice(0, 5).forEach(inc => {
      cards.push(makeIncidentCard(inc, [
        { label: 'View', icon: '📋', style: ACTION_STYLES.SECONDARY, type: ACTION_TYPES.NAVIGATE, payload: { module: 'incidents', id: inc.id } },
        { label: 'Escalate', icon: '⚡', style: ACTION_STYLES.WARNING, type: ACTION_TYPES.CONFIRM, payload: { action: 'escalate', id: inc.id } },
      ]));
    });
    if (open.length > 5) {
      cards.push(makeQuickReplyCard([
        { label: `View all ${open.length} open tickets`, icon: '📋', action: 'Show all open tickets' },
      ]));
    }
  }
  return cards;
}

function buildSlaCards(ctx) {
  const { incidents = [] } = ctx;
  const now = new Date();
  const open = incidents.filter(i => i.status === 'Open' || i.status === 'In Progress');
  const atRisk = open.filter(i => {
    if (!i.createdAt && !i.created) return false;
    const created = new Date(i.createdAt || i.created);
    const elapsed = (now - created) / 3600000;
    const target = i.slaTarget || (i.priority === 'Critical' || i.priority === 'P1' ? 4 : i.priority === 'High' || i.priority === 'P2' ? 8 : 24);
    return elapsed > target * 0.75;
  }).map(t => {
    const created = new Date(t.createdAt || t.created);
    const elapsed = Math.round((now - created) / 3600000 * 10) / 10;
    const target = t.slaTarget || (t.priority === 'Critical' || t.priority === 'P1' ? 4 : t.priority === 'High' || t.priority === 'P2' ? 8 : 24);
    return { ...t, title: t.title || t.subject, elapsed, target, percentUsed: Math.round(elapsed / target * 100) };
  });

  if (atRisk.length === 0) {
    return [makeStatusCard('SLA Status', [{ icon: '✅', label: 'All tickets', value: 'Within SLA', color: '#22C55E' }])];
  }
  return [makeSlaAlertCard(atRisk)];
}

function buildApprovalCards(ctx) {
  const { changes = [] } = ctx;
  const pending = changes.filter(c => c.status === 'Awaiting Approval');
  if (pending.length === 0) {
    return [makeStatusCard('Approvals', [{ icon: '✅', label: 'Pending Approvals', value: '0', color: '#22C55E' }])];
  }
  return pending.slice(0, 3).map(c => makeApprovalCard(c));
}

function buildCreateIncidentCards(ctx, tier) {
  if (tier === 'customer') {
    return [makeFormCard(FORM_TEMPLATES.incident_quick)];
  }
  return [
    makeFormCard(FORM_TEMPLATES.incident_full),
    makeQuickReplyCard([
      { label: 'Use quick form', icon: '⚡', action: '/create incident quick' },
    ]),
  ];
}

function buildReportsCards(ctx, tier) {
  const { incidents = [] } = ctx;
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const open = incidents.filter(i => i.status === 'Open' || i.status === 'In Progress');
  const resolvedToday = incidents.filter(i => (i.status === 'Resolved' || i.status === 'Closed') && (i.resolvedAt || '').startsWith(todayStr));

  return [
    makeMetricCard([
      { label: 'Open Incidents', value: open.length, icon: '🎫', color: '#3B82F6' },
      { label: 'Resolved Today', value: resolvedToday.length, icon: '✅', color: '#22C55E' },
      { label: 'Total', value: incidents.length, icon: '📊' },
      { label: 'Resolution Rate', value: incidents.length > 0 ? Math.round(resolvedToday.length / Math.max(open.length + resolvedToday.length, 1) * 100) : 0, unit: '%', icon: '📈', color: '#6366F1' },
    ]),
    makeQuickReplyCard([
      { label: 'Full Dashboard', icon: '📊', action: 'Show full analytics dashboard' },
      { label: 'Weekly Trend', icon: '📈', action: 'Show weekly incident trends' },
      { label: 'By Category', icon: '📁', action: 'Show incidents breakdown by category' },
    ]),
  ];
}

function buildKbCards(ctx) {
  const { kbArticles = [] } = ctx;
  if (!kbArticles || kbArticles.length === 0) {
    return [makeQuickReplyCard([
      { label: 'Create KB Article', icon: '📝', action: 'How do I create a knowledge base article?' },
      { label: 'Train AI', icon: '🧠', action: '/train' },
    ])];
  }
  return kbArticles.slice(0, 3).map(kb => makeKbCard(kb));
}

// ─── Smart Suggestion Cards (QuickReply) by Role + Context ──────────────────

function buildContextualSuggestions(userMsg, tier, ctx) {
  const lc = (userMsg || '').toLowerCase();
  const hour = new Date().getHours();

  // Role-specific default suggestions
  if (tier === 'management') {
    if (hour >= 7 && hour <= 9) return [makeQuickReplyCard([
      { label: 'Morning Briefing', icon: '☀️', action: 'Give me my morning briefing' },
      { label: 'Pending Approvals', icon: '📋', action: 'Show pending approvals' },
      { label: 'Team Workload', icon: '👥', action: 'Show team workload' },
    ])];
    return [makeQuickReplyCard([
      { label: 'KPI Dashboard', icon: '📊', action: 'Show KPI metrics for today' },
      { label: 'Approvals', icon: '📋', action: 'Show pending approvals' },
      { label: 'Risk Overview', icon: '⚠️', action: 'Show risk assessment' },
    ])];
  }

  if (tier === 'engineer') {
    if (hour >= 7 && hour <= 9) return [makeQuickReplyCard([
      { label: 'My Queue', icon: '🎫', action: 'Show my open tickets' },
      { label: 'SLA At-Risk', icon: '⏱️', action: 'Show SLA at-risk tickets' },
      { label: 'Overnight Issues', icon: '🌙', action: 'Any overnight issues?' },
    ])];
    return [makeQuickReplyCard([
      { label: 'Open Tickets', icon: '🎫', action: 'Show my open tickets' },
      { label: 'Search KB', icon: '📚', action: 'Search knowledge base' },
      { label: 'Create Incident', icon: '➕', action: '/create incident' },
    ])];
  }

  // Customer
  return [makeQuickReplyCard([
    { label: 'Report Issue', icon: '🎫', action: 'I need to report an issue' },
    { label: 'Check Status', icon: '🔍', action: 'Check my ticket status' },
    { label: 'Get Help', icon: '❓', action: 'I need help with something' },
  ])];
}

// ─── Navigation Action Cards (replaces old detectAiActionCards) ─────────────

function buildNavigationCards(intent) {
  const navMap = {
    escalate:     [{ type: 'navigate', label: 'Go to Incidents', icon: '⚡', module: 'incidents', style: ACTION_STYLES.WARNING }],
    kb_search:    [{ type: 'navigate', label: 'Open Knowledge Base', icon: '📚', module: 'knowledge', style: ACTION_STYLES.PRIMARY }],
    reports:      [{ type: 'navigate', label: 'View Reports', icon: '📈', module: 'reports', style: ACTION_STYLES.PRIMARY }],
    email:        [{ type: 'navigate', label: 'Open Email', icon: '📧', module: 'email', style: ACTION_STYLES.PRIMARY }],
    duplicates:   [{ type: 'navigate', label: 'Scan Duplicates', icon: '🔗', module: 'incidents', style: ACTION_STYLES.PRIMARY }],
    patterns:     [{ type: 'navigate', label: 'View Patterns', icon: '🧩', module: 'problems', style: ACTION_STYLES.PRIMARY }],
    security:     [{ type: 'navigate', label: 'Security Dashboard', icon: '🛡️', module: 'security', style: ACTION_STYLES.DANGER }],
  };

  const navActions = navMap[intent];
  if (!navActions) return [];

  return [makeListCard(null, navActions.map(a => ({
    icon: a.icon,
    title: a.label,
    subtitle: `Navigate to ${a.module} module`,
    onClick: { type: ACTION_TYPES.NAVIGATE, payload: { module: a.module } },
  })))];
}

// ─── Management-Specific Flow Cards ─────────────────────────────────────────

function buildManagementCards(intent, ctx) {
  const { incidents = [], changes = [], problems = [], requests = [] } = ctx;
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const open = incidents.filter(i => i.status === 'Open' || i.status === 'In Progress');
  const critical = open.filter(i => i.priority === 'Critical' || i.priority === 'P1');
  const resolvedToday = incidents.filter(i => (i.status === 'Resolved' || i.status === 'Closed') && (i.resolvedAt || '').startsWith(todayStr));
  const pendingApproval = changes.filter(c => c.status === 'Awaiting Approval');

  const cards = [];

  if (intent === 'briefing' || intent === 'reports') {
    // Executive KPI summary
    cards.push(makeMetricCard([
      { label: 'Open Incidents', value: open.length, icon: '🎫', color: '#3B82F6' },
      { label: 'Critical', value: critical.length, icon: '🔴', color: critical.length > 0 ? '#EF4444' : '#22C55E' },
      { label: 'Resolved Today', value: resolvedToday.length, icon: '✅', color: '#22C55E' },
      { label: 'Pending Approvals', value: pendingApproval.length, icon: '📋', color: pendingApproval.length > 0 ? '#F59E0B' : '#6B7280' },
      { label: 'Open Changes', value: changes.filter(c => c.status !== 'Closed' && c.status !== 'Completed').length, icon: '🔄' },
      { label: 'Open Problems', value: problems.filter(p => p.status === 'Open' || p.status === 'Investigating').length, icon: '🔗' },
    ]));
  }

  if (intent === 'team') {
    // Team workload summary — group incidents by assignee
    const assigneeMap = {};
    open.forEach(i => {
      const assignee = i.assignedTo || i.assignee || 'Unassigned';
      assigneeMap[assignee] = (assigneeMap[assignee] || 0) + 1;
    });
    const teamMembers = Object.entries(assigneeMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({
        name,
        role: 'Engineer',
        status: count > 5 ? 'busy' : count > 2 ? 'away' : 'online',
        workload: count,
      }));
    if (teamMembers.length > 0) {
      cards.push(makeTeamCard(teamMembers));
    }
  }

  if (intent === 'approval') {
    // Approval queue with batch actions
    if (pendingApproval.length > 0) {
      pendingApproval.slice(0, 5).forEach(c => cards.push(makeApprovalCard(c)));
      if (pendingApproval.length > 5) {
        cards.push(makeQuickReplyCard([
          { label: `View all ${pendingApproval.length} approvals`, icon: '📋', action: 'Show all pending approvals' },
        ]));
      }
    }
  }

  return cards;
}

// ─── Engineer-Specific Flow Cards ───────────────────────────────────────────

function buildEngineerCards(intent, ctx) {
  const { incidents = [], currentUser } = ctx;
  const open = incidents.filter(i => i.status === 'Open' || i.status === 'In Progress');
  const cards = [];

  if (intent === 'open_tickets') {
    // Show tickets assigned to the current engineer
    const myTickets = open.filter(i =>
      (i.assignedTo || i.assignee || '').toLowerCase() === (currentUser.name || '').toLowerCase()
    );
    const otherTickets = open.filter(i =>
      (i.assignedTo || i.assignee || '').toLowerCase() !== (currentUser.name || '').toLowerCase()
    );

    if (myTickets.length > 0) {
      const sorted = [...myTickets].sort((a, b) => {
        const po = { Critical: 0, P1: 0, High: 1, P2: 1, Medium: 2, P3: 2, Low: 3, P4: 3 };
        return (po[a.priority] ?? 4) - (po[b.priority] ?? 4);
      });
      sorted.slice(0, 5).forEach(inc => {
        cards.push(makeIncidentCard(inc, [
          { label: 'View', icon: '📋', style: ACTION_STYLES.SECONDARY, type: ACTION_TYPES.NAVIGATE, payload: { module: 'incidents', id: inc.id } },
          { label: 'Update', icon: '✏️', style: ACTION_STYLES.PRIMARY, type: ACTION_TYPES.NAVIGATE, payload: { module: 'incidents', id: inc.id } },
          { label: 'Escalate', icon: '⚡', style: ACTION_STYLES.WARNING, type: ACTION_TYPES.CONFIRM, payload: { action: 'escalate', id: inc.id } },
        ]));
      });
    }

    if (myTickets.length === 0 && otherTickets.length > 0) {
      cards.push(makeStatusCard('Your Queue', [
        { icon: '✅', label: 'Assigned to you', value: '0 tickets', color: '#22C55E' },
        { icon: '📊', label: 'Team queue', value: `${otherTickets.length} open`, color: '#3B82F6' },
      ]));
    }
  }

  if (intent === 'escalate') {
    // Show escalation workflow
    cards.push(makeProgressCard('Escalation Workflow', [
      { label: 'Identify Issue', status: 'done' },
      { label: 'Document Impact', status: 'active' },
      { label: 'L2/L3 Review', status: 'pending' },
      { label: 'Resolution', status: 'pending' },
    ]));
  }

  if (intent === 'train_ai') {
    cards.push(makeListCard('AI Training Options', [
      { icon: '🧠', title: 'Correct an AI Answer', subtitle: 'Provide the right answer for a question', onClick: { type: ACTION_TYPES.CHAT_REPLY, payload: { text: 'I want to correct an AI answer' } } },
      { icon: '📎', title: 'Upload Document', subtitle: 'Train AI with a document or guide', onClick: { type: ACTION_TYPES.CHAT_REPLY, payload: { text: 'Upload a document for AI training' } } },
      { icon: '📚', title: 'View Trained Knowledge', subtitle: 'Browse all trained entries', onClick: { type: ACTION_TYPES.NAVIGATE, payload: { module: 'knowledge' } } },
    ]));
  }

  return cards;
}

// ─── Customer-Specific Flow Cards ───────────────────────────────────────────

function buildCustomerCards(intent, ctx) {
  const { incidents = [], requests = [], currentUser, kbArticles = [] } = ctx;
  const cards = [];
  const userDomain = (currentUser?.email || '').split('@')[1] || '';
  const firstName = (currentUser?.name || '').split(' ')[0] || 'there';

  if (intent === 'create_incident' || intent === 'create_request') {
    // Simple form for customers
    cards.push(makeFormCard(FORM_TEMPLATES.incident_quick));
    cards.push(makeQuickReplyCard([
      { label: "I'll describe it instead", icon: '💬', action: 'Let me describe my issue in detail' },
    ]));
  }

  if (intent === 'open_tickets') {
    // Show only customer's own tickets
    const myTickets = [...incidents, ...requests].filter(t =>
      (t.requestedBy || t.requester || t.createdBy || t.requesterEmail || '').toLowerCase() === (currentUser.email || currentUser.name || '').toLowerCase()
    );
    if (myTickets.length === 0) {
      cards.push(makeStatusCard('Your Tickets', [
        { icon: '📭', label: 'Status', value: 'No open requests', color: '#6B7280' },
      ]));
      cards.push(makeQuickReplyCard([
        { label: '🎫 Create a ticket', icon: '🎫', action: 'I need to report an issue' },
        { label: '📚 Browse help articles', icon: '📚', action: 'Search knowledge base' },
      ]));
    } else {
      const statusList = myTickets.slice(0, 5).map(t => ({
        icon: t.status === 'Resolved' || t.status === 'Closed' ? '✅' : t.status === 'In Progress' ? '🔄' : '📋',
        title: t.title || t.subject || t.description?.substring(0, 50) || 'Request',
        subtitle: `Status: ${t.status}${t.id ? ` • ID: ${t.id}` : ''}`,
      }));
      cards.push(makeListCard('Your Requests', statusList));
    }
  }

  if (intent === 'kb_search') {
    if (kbArticles && kbArticles.length > 0) {
      kbArticles.slice(0, 3).forEach(kb => cards.push(makeKbCard(kb)));
    }
    cards.push(makeQuickReplyCard([
      { label: 'Still need help?', icon: '🙋', action: 'I still need help with my issue' },
      { label: 'Create a ticket', icon: '🎫', action: 'Please create a ticket for my issue' },
    ]));
  }

  if (intent === 'password') {
    cards.push(makeProgressCard('Password Reset Steps', [
      { label: 'Go to portal.office.com', status: 'active' },
      { label: "Click 'Can't access account'", status: 'pending' },
      { label: 'Verify identity via MFA', status: 'pending' },
      { label: 'Set new password', status: 'pending' },
    ]));
    cards.push(makeQuickReplyCard([
      { label: 'MFA not working', icon: '📱', action: 'My MFA is not working' },
      { label: 'Account locked', icon: '🔒', action: 'My account is locked out' },
      { label: 'Create ticket for me', icon: '🎫', action: 'Please create a ticket for password reset' },
    ]));
  }

  if (intent === 'mfa') {
    cards.push(makeProgressCard('MFA Reset Steps', [
      { label: 'Go to aka.ms/mfasetup', status: 'active' },
      { label: 'Sign in with your work account', status: 'pending' },
      { label: "Select 'Security info' > 'Add method'", status: 'pending' },
      { label: 'Choose Authenticator app / Phone', status: 'pending' },
      { label: 'Follow the setup wizard', status: 'pending' },
    ]));
    cards.push(makeQuickReplyCard([
      { label: 'Lost my phone', icon: '📱', action: 'I lost my phone and cannot receive MFA codes' },
      { label: 'Authenticator not working', icon: '🔐', action: 'My authenticator app is not generating correct codes' },
      { label: 'Create ticket for me', icon: '🎫', action: 'Please create a ticket for MFA reset' },
    ]));
  }

  if (intent === 'onboarding') {
    cards.push(makeProgressCard('New Employee Setup Checklist', [
      { label: 'Activate your email at portal.office.com', status: 'active' },
      { label: 'Set up MFA (Authenticator app)', status: 'pending' },
      { label: 'Install Microsoft Teams', status: 'pending' },
      { label: 'Connect to corporate WiFi / VPN', status: 'pending' },
      { label: 'Access internal portals & shared drives', status: 'pending' },
    ]));
    cards.push(makeQuickReplyCard([
      { label: 'Set up email', icon: '📧', action: 'Help me set up my work email' },
      { label: 'Set up MFA', icon: '🔐', action: 'I need to set up MFA on my new account' },
      { label: 'VPN access', icon: '🌐', action: 'How do I connect to the company VPN' },
      { label: 'Create ticket', icon: '🎫', action: 'I need help with my onboarding setup' },
    ]));
  }

  if (intent === 'security') {
    cards.push(makeQuickReplyCard([
      { label: '🚨 Report phishing', icon: '🚨', action: 'I received a suspicious phishing email' },
      { label: '🔒 Account compromised', icon: '🔒', action: 'I think my account has been compromised' },
      { label: '🎫 Create security ticket', icon: '🎫', action: 'Create a security incident ticket' },
    ]));
  }

  if (intent === 'connectivity') {
    cards.push(makeProgressCard('Quick Connectivity Fix', [
      { label: 'Restart your device', status: 'active' },
      { label: 'Check WiFi/cable connection', status: 'pending' },
      { label: 'Try disconnecting & reconnecting VPN', status: 'pending' },
      { label: 'Clear browser cache (Ctrl+Shift+Del)', status: 'pending' },
    ]));
    cards.push(makeQuickReplyCard([
      { label: '🌐 VPN issue', icon: '🌐', action: 'I cannot connect to VPN' },
      { label: '📶 WiFi issue', icon: '📶', action: 'WiFi is not working' },
      { label: '🎫 Still not working', icon: '🎫', action: 'Network still not working, please create a ticket' },
    ]));
  }

  if (intent === 'software') {
    cards.push(makeQuickReplyCard([
      { label: '📧 Outlook issue', icon: '📧', action: 'I have an issue with Outlook email' },
      { label: '💬 Teams issue', icon: '💬', action: 'Microsoft Teams is not working properly' },
      { label: '📊 Office apps', icon: '📊', action: 'I need help with Excel/Word/PowerPoint' },
      { label: '🎫 Create ticket', icon: '🎫', action: 'I need to report a software issue' },
    ]));
  }

  if (intent === 'hardware') {
    cards.push(makeQuickReplyCard([
      { label: '🖨️ Printer issue', icon: '🖨️', action: 'My printer is not working' },
      { label: '💻 Laptop issue', icon: '💻', action: 'I have a laptop hardware problem' },
      { label: '🖥️ Monitor/display', icon: '🖥️', action: 'My monitor or display is not working' },
      { label: '🎫 Request equipment', icon: '🎫', action: 'I need to request new equipment' },
    ]));
  }

  if (intent === 'help') {
    cards.push(makeListCard(`Hi ${firstName}! Here's what I can help with:`, [
      { icon: '🎫', title: 'Report an issue', subtitle: 'Create a ticket for any IT problem' },
      { icon: '🔑', title: 'Password & login help', subtitle: 'Reset password, unlock account' },
      { icon: '🔐', title: 'MFA / Authenticator', subtitle: 'Set up or reset multi-factor authentication' },
      { icon: '🆕', title: 'New employee onboarding', subtitle: 'Email, VPN, Teams, and account setup' },
      { icon: '📋', title: 'Check my tickets', subtitle: 'View status of your requests' },
      { icon: '📚', title: 'Search help articles', subtitle: 'Find self-service solutions' },
      { icon: '💻', title: 'Software & hardware help', subtitle: 'Get help with apps, devices, and equipment' },
      { icon: '🌐', title: 'Network & connectivity', subtitle: 'WiFi, VPN, internet issues' },
    ].map(item => ({ ...item, onClick: { type: ACTION_TYPES.CHAT_REPLY, payload: { text: item.title } } }))));
  }

  // If no specific cards but we have an intent, add a helpful suggestion
  if (cards.length === 0 && intent) {
    cards.push(makeQuickReplyCard([
      { label: '🎫 Create a ticket', icon: '🎫', action: 'I need to report an issue' },
      { label: '📚 Search help articles', icon: '📚', action: 'Search knowledge base for help' },
      { label: '📋 Check my tickets', icon: '📋', action: 'Show my open tickets' },
    ]));
  }

  return cards;
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Build cards for an AI response based on the user message and context.
 * Returns { cards: Card[], suggestions: Card[] }
 */
export function buildChatCards(userMsg, ctx) {
  const tier = detectUserTier(ctx.currentUser?.rbacRole);
  const intent = detectIntent(userMsg);
  let cards = [];

  // ─── Role-specific card flows (take priority) ───
  if (tier === 'management') {
    const mgmtCards = buildManagementCards(intent, ctx);
    if (mgmtCards.length > 0) cards.push(...mgmtCards);
  } else if (tier === 'engineer') {
    const engCards = buildEngineerCards(intent, ctx);
    if (engCards.length > 0) cards.push(...engCards);
  } else if (tier === 'customer') {
    const custCards = buildCustomerCards(intent, ctx);
    if (custCards.length > 0) cards.push(...custCards);
  }

  // ─── Shared intent cards (when no role-specific cards produced) ───
  if (cards.length === 0) {
    switch (intent) {
      case 'briefing':
        cards = buildBriefingCards(ctx);
        break;
      case 'open_tickets':
        cards = buildOpenTicketCards(ctx);
        break;
      case 'sla_check':
        cards = buildSlaCards(ctx);
        break;
      case 'approval':
        cards = buildApprovalCards(ctx);
        break;
      case 'create_incident':
        cards = buildCreateIncidentCards(ctx, tier);
        break;
      case 'create_request':
        cards = [makeFormCard(FORM_TEMPLATES.service_request)];
        break;
      case 'create_change':
        cards = [makeFormCard(FORM_TEMPLATES.change_request)];
        break;
      case 'create_problem':
        cards = [...buildNavigationCards('create_problem'), makeQuickReplyCard([
          { label: 'Create Problem', icon: '🔗', action: '/create problem' },
        ])];
        break;
      case 'reports':
        cards = buildReportsCards(ctx, tier);
        break;
      case 'kb_search':
        cards = buildKbCards(ctx);
        break;
      case 'team':
        cards = buildNavigationCards('team');
        break;
      case 'help':
        cards = [makeListCard('Available Commands', [
          { icon: '🎫', title: '/create incident', subtitle: 'Open a new incident' },
          { icon: '📋', title: '/create request', subtitle: 'Submit a service request' },
          { icon: '🔄', title: '/create change', subtitle: 'Raise a change request' },
          { icon: '📊', title: '/briefing', subtitle: 'Daily summary' },
          { icon: '⏱️', title: '/sla', subtitle: 'SLA compliance status' },
          { icon: '📚', title: '/search kb', subtitle: 'Search knowledge base' },
          { icon: '⚡', title: '/escalate', subtitle: 'Escalate a ticket' },
          { icon: '📧', title: '/email', subtitle: 'Draft an email' },
          { icon: '🧠', title: '/train', subtitle: 'Train AI with new knowledge' },
        ].map(item => ({ ...item, onClick: { type: ACTION_TYPES.CHAT_REPLY, payload: { text: item.title } } })))];
        break;
      default:
        cards = buildNavigationCards(intent);
        break;
    }
  }

  // Always add contextual quick reply suggestions
  const suggestions = buildContextualSuggestions(userMsg, tier, ctx);

  return { cards, suggestions };
}

// ─── Legacy Adapter — drop-in replacement for detectAiActionCards ────────────

export function buildLegacyActionCards(userMsg, ctx) {
  const { cards } = buildChatCards(userMsg, ctx);
  return cards;
}

export function buildSmartSuggestions(userMsg, ctx) {
  const { suggestions } = buildChatCards(userMsg, ctx);
  // Flatten to legacy format for backward compat
  if (suggestions.length > 0 && suggestions[0].type === CARD_TYPES.QUICK_REPLY) {
    return suggestions[0].data.replies.map(r => ({ label: r.label, action: r.action || r.label }));
  }
  return [];
}
