// seed-kb-docs.cjs — Seed in-app KB with documentation articles
// Run: node seed-kb-docs.cjs
const http = require('http');

const BASE = process.env.ITSM_URL || 'https://vgc-itsm1-app.azurewebsites.net';

const docs = [
  { title: 'Architecture Guide', category: 'Documentation', tags: ['architecture','system','deployment'], summary: 'System overview, tech stack, architecture layers, AI system, auth pipeline, deployment topology.', content: 'See docs/Architecture-Guide.html for full documentation. Covers: React 19 + Vite 8, Node.js 20 raw HTTP server, Azure MySQL document store, 3-tier Azure OpenAI, Microsoft Entra ID SSO, WebSocket real-time updates.', doc_file: 'Architecture-Guide.html' },
  { title: 'API Reference', category: 'Documentation', tags: ['api','endpoints','rest'], summary: '250+ REST API endpoints organized in 25 groups with method badges.', content: 'See docs/API-Reference.html. Covers all CRUD operations, AI endpoints, Zendesk sync, SLA management, compliance, reporting, and admin APIs.', doc_file: 'API-Reference.html' },
  { title: 'User Guide v2.0', category: 'Documentation', tags: ['user-guide','features','howto'], summary: 'Complete user guide covering all Phase 1-5 features (52 steps).', content: 'See docs/User-Guide.html. 25 sections covering incident management, AI triage, SLA tracking, change management, CMDB, reporting, dashboards, and UX features.', doc_file: 'User-Guide.html' },
  { title: 'Release Notes v2.0', category: 'Documentation', tags: ['release-notes','changelog','phases'], summary: 'All 52 feature steps across 5 development phases.', content: 'See docs/Release-Notes.html. Phase 1: Core ITIL Gaps (10 steps), Phase 2: AI Enhancement (10), Phase 3: Enterprise (10), Phase 4: Analytics (10), Phase 5: UX Polish (12). Total: 359 E2E tests.', doc_file: 'Release-Notes.html' },
  { title: 'Data Dictionary', category: 'Documentation', tags: ['database','collections','schema'], summary: '67 collections in Azure MySQL document store with categories.', content: 'See docs/Data-Dictionary.html. Physical tables: itsm_data (JSON documents) and audit_log. 67 logical collections across Core, AI, Integration, SLA, Admin, Enterprise, and UX categories.', doc_file: 'Data-Dictionary.html' },
  { title: 'Administrator Guide', category: 'Documentation', tags: ['admin','setup','deployment','config'], summary: 'Setup, configuration, deployment, and troubleshooting for admins.', content: 'See docs/Admin-Guide.html. Covers environment variables, AI configuration, integration setup (Zendesk, Entra, Teams), SLA config, deployment via Kudu VFS, and troubleshooting.', doc_file: 'Admin-Guide.html' },
  { title: 'Workflow Diagrams', category: 'Documentation', tags: ['workflows','diagrams','mermaid','processes'], summary: '12 interactive Mermaid workflow diagrams for all ITIL processes.', content: 'See docs/Workflow-Diagrams.html. Diagrams: Incident Lifecycle, Change Management, Problem Management, AI Triage Pipeline, Email-to-Ticket, Approval Chain, SLA Engine, Automation Rules, Release Management, MIM, Runbook Execution, Request Pipeline.', doc_file: 'Workflow-Diagrams.html' },
  { title: 'Security & Compliance', category: 'Documentation', tags: ['security','rbac','audit','compliance'], summary: 'Authentication, 11-level RBAC, rate limiting, audit trail, compliance evidence.', content: 'See docs/Security-Compliance.html. Entra ID SSO with PKCE, 11 RBAC roles (super_admin to end_user), per-IP/user rate limiting, immutable audit log, SOC2/ISO evidence collection.', doc_file: 'Security-Compliance.html' },
  { title: 'Integration Guide', category: 'Documentation', tags: ['integrations','zendesk','teams','entra','openai'], summary: '8 external system integrations with setup instructions.', content: 'See docs/Integration-Guide.html. Zendesk bi-directional sync, Entra ID SSO, Microsoft Graph, Teams webhooks, Azure OpenAI 3-tier, SolarWinds, CMDB Discovery, Email-to-Ticket.', doc_file: 'Integration-Guide.html' },
  { title: 'AI Capabilities', category: 'Documentation', tags: ['ai','openai','triage','chatbot','ml'], summary: 'Three-tier Azure OpenAI architecture with 12 AI features.', content: 'See docs/AI-Capabilities.html. Models: gpt-5.4-pro/mini/nano with auto-failover. Features: triage, resolution suggestion, virtual agent, KB auto-gen, risk assessment, semantic search, anomaly detection, forecasting, daily briefing, learning feedback.', doc_file: 'AI-Capabilities.html' }
];

async function seedKB() {
  let ok = 0, fail = 0;
  for (const doc of docs) {
    const body = JSON.stringify({ data: { ...doc, status: 'published', version: '2.0', created_at: new Date().toISOString() } });
    try {
      const url = new URL('/api/db/kb', BASE);
      const mod = url.protocol === 'https:' ? require('https') : require('http');
      await new Promise((resolve, reject) => {
        const req = mod.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => { console.log(`  ${res.statusCode} - ${doc.title}`); res.statusCode < 300 ? ok++ : fail++; resolve(); });
        });
        req.on('error', e => { console.error(`  FAIL - ${doc.title}: ${e.message}`); fail++; resolve(); });
        req.write(body);
        req.end();
      });
    } catch (e) { console.error(`  FAIL - ${doc.title}: ${e.message}`); fail++; }
  }
  console.log(`\nDone: ${ok} seeded, ${fail} failed`);
}

console.log(`Seeding KB docs to ${BASE}...`);
seedKB();
