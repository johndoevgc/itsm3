// seed-kb-articles.cjs — Bulk-create 9 enterprise KB articles for VGC-ITSM Knowledge Portal
// Usage: node seed-kb-articles.cjs
const https = require("https");

const BASE = process.env.SEED_BASE || "https://vgc-itsm1-app-staging.azurewebsites.net";
if (/vgc-itsm1-app\.azurewebsites\.net/.test(BASE) && process.env.ALLOW_PROD_SEED_WRITES !== "true") {
  console.error(`[seed-kb-articles] Refusing to run against production (${BASE}). Set SEED_BASE to staging or ALLOW_PROD_SEED_WRITES=true.`);
  process.exit(2);
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    };
    const req = https.request(opts, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

const now = new Date().toISOString();

const articles = [
  // ───────────────────────────────────────────────────────────────────────
  // Article 1: ITSM Competitive Comparison
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "KB0010",
    title: "VGC-ITSM v3.20 — Competitive Comparison & Market Analysis",
    category: "SOP",
    status: "Published",
    author: "System",
    created: now,
    tags: ["comparison", "evaluation", "TCO", "ServiceNow", "Freshservice", "Jira", "ManageEngine", "HaloITSM", "SysAid"],
    whenToUse: "Use this article when evaluating ITSM platforms, preparing vendor comparison reports, or justifying VGC-ITSM adoption to stakeholders.",
    bestFor: "IT Decision Makers, Procurement Teams, C-Level Executives",
    quickFix: "See the Feature Matrix table below for a quick side-by-side comparison across 25+ capabilities.",
    content: `# VGC-ITSM v3.20 — Competitive Comparison & Market Analysis

## Executive Summary

VGC-ITSM v3.20 is an AI-first, cloud-native IT Service Management platform purpose-built for Singapore SMEs and mid-market enterprises. Unlike legacy ITSM tools requiring months of deployment and dedicated administrators, VGC-ITSM delivers enterprise-grade capabilities at a fraction of the cost — powered by Azure OpenAI GPT-5.4 models, React 19, and a modern single-page architecture.

This document compares VGC-ITSM against six leading platforms: **ServiceNow**, **Freshservice**, **Jira Service Management**, **ManageEngine ServiceDesk Plus**, **HaloITSM**, and **SysAid**.

---

## Platform Overview

| Platform | Target Market | Deployment | AI Engine | Pricing Model |
|----------|---------------|------------|-----------|---------------|
| **VGC-ITSM v3.20** | Singapore SME / Mid-Market | Azure App Service (SaaS) | Azure OpenAI GPT-5.4 (multi-model) | Per-tenant flat rate |
| ServiceNow | Enterprise (5000+ seats) | Cloud (proprietary) | Now Assist (GenAI) | Per-user, tiered modules |
| Freshservice | SMB / Mid-Market | Cloud (AWS) | Freddy AI | Per-agent / month |
| Jira Service Management | Dev-centric teams | Cloud (AWS) / DC | Atlassian Intelligence | Per-agent / month |
| ManageEngine SDP | SMB / On-prem preferred | On-prem / Cloud | Zia AI (basic) | Per-technician |
| HaloITSM | SMB / Mid-Market | Cloud / On-prem | Basic AI (limited) | Per-agent / month |
| SysAid | SMB | Cloud / On-prem | SysAid Copilot | Per-agent / month |

---

## Feature Matrix — 25 Capability Dimensions

### Core ITIL Processes

| Capability | VGC-ITSM v3.20 | ServiceNow | Freshservice | Jira SM | ManageEngine | HaloITSM | SysAid |
|-----------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Incident Management | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Problem Management | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Basic |
| Change Management (CAB) | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ⚠️ Basic |
| Service Request Fulfillment | ✅ 36 services | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Basic |
| Knowledge Management | ✅ AI-powered | ✅ Full | ✅ Full | ⚠️ Confluence | ✅ Full | ✅ Full | ⚠️ Basic |
| SLA Management | ✅ Business-hours aware | ✅ Full | ✅ Full | ⚠️ Limited | ✅ Full | ✅ Full | ✅ Full |
| Asset Management (CMDB) | ✅ 20+ assets | ✅ Full | ✅ Full | ⚠️ via Insight | ✅ Full | ✅ Full | ✅ Full |

### AI & Automation

| Capability | VGC-ITSM v3.20 | ServiceNow | Freshservice | Jira SM | ManageEngine | HaloITSM | SysAid |
|-----------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| AI Auto-Triage & Assignment | ✅ GPT-5.4 | ✅ Now Assist | ✅ Freddy AI | ⚠️ Basic | ⚠️ Basic | ❌ | ⚠️ Basic |
| AI Chat Assistant | ✅ Streaming + file upload | ✅ Virtual Agent | ✅ Freddy | ⚠️ Rovo | ❌ | ❌ | ✅ Copilot |
| AI SLA Breach Prediction | ✅ Built-in | ⚠️ Add-on | ❌ | ❌ | ❌ | ❌ | ❌ |
| AI Workload Rebalancing | ✅ Built-in | ⚠️ Custom | ❌ | ❌ | ❌ | ❌ | ❌ |
| AI Incident Correlation | ✅ Pattern detect | ✅ Built-in | ⚠️ Basic | ❌ | ❌ | ❌ | ❌ |
| AI KB Auto-Generation | ✅ From resolved tickets | ✅ Now Assist | ✅ Freddy | ❌ | ❌ | ❌ | ❌ |
| AI Daily Briefing | ✅ Executive report | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| AI Sentiment Analysis | ✅ Real-time on emails | ⚠️ Add-on | ❌ | ❌ | ❌ | ❌ | ❌ |
| AI Document Generation | ✅ SOPs, guides, reports | ⚠️ Custom | ❌ | ❌ | ❌ | ❌ | ❌ |
| Multi-Model AI Pipeline | ✅ GPT-5.4-mini + o3-mini | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Workflow Automation Rules | ✅ 9 built-in (WF001-WF009) | ✅ Flow Designer | ✅ Automator | ✅ Rules | ✅ Basic | ✅ Basic | ⚠️ Basic |

### Integration & Platform

| Capability | VGC-ITSM v3.20 | ServiceNow | Freshservice | Jira SM | ManageEngine | HaloITSM | SysAid |
|-----------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Zendesk Bi-directional Sync | ✅ Native | ⚠️ Connector | ⚠️ Connector | ⚠️ Plugin | ⚠️ Plugin | ❌ | ❌ |
| Microsoft 365 Integration | ✅ Graph API native | ✅ Full | ✅ Full | ⚠️ Basic | ✅ Full | ⚠️ Basic | ✅ Full |
| Entra ID SSO (MSAL) | ✅ Native PKCE | ✅ SAML/OIDC | ✅ SAML/OIDC | ✅ SAML | ✅ SAML | ✅ SAML | ✅ SAML |
| Email-to-Ticket (Graph) | ✅ Multi-mailbox AI | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Cisco Meraki Integration | ✅ Dashboard API | ⚠️ Custom | ⚠️ Custom | ❌ | ⚠️ Custom | ❌ | ❌ |
| Real-time WebSocket | ✅ Native | ✅ AMB | ❌ | ❌ | ❌ | ❌ | ❌ |
| RBAC (Role-Based Access) | ✅ 12 roles, 14 permissions | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Basic |

---

## Total Cost of Ownership (TCO) — Singapore SME (50 users, 3 years)

| Cost Component | VGC-ITSM v3.20 | ServiceNow | Freshservice (Pro) | Jira SM (Premium) |
|---------------|:---:|:---:|:---:|:---:|
| License / Subscription | ~SGD 2,400/yr flat | ~SGD 180,000/yr | ~SGD 36,000/yr | ~SGD 24,000/yr |
| Implementation | Included | SGD 100,000+ | SGD 15,000 | SGD 10,000 |
| Azure Hosting | ~SGD 600/yr (B2s) | Included | Included | Included |
| AI (Azure OpenAI) | ~SGD 1,200/yr | Included (limited) | SGD 6,000/yr add-on | N/A |
| Training | Self-service KB | SGD 20,000+ | SGD 5,000 | SGD 3,000 |
| **3-Year TCO** | **~SGD 15,600** | **~SGD 660,000+** | **~SGD 174,000** | **~SGD 103,000** |
| **Per-user/month** | **~SGD 8.67** | **~SGD 366.67** | **~SGD 96.67** | **~SGD 57.22** |

*Note: VGC-ITSM pricing assumes Azure App Service B2s hosting + Azure MySQL + Azure OpenAI consumption-based pricing.*

---

## Singapore SME Fit Analysis

### Why VGC-ITSM Excels for Singapore Market

1. **PDPA Compliance Built-in** — Data residency in Azure Southeast Asia (Singapore region), PDPA dashboard, consent tracking, and data masking
2. **SGT Business Hours** — SLA engine calculates in Singapore business hours (Mon–Fri 9AM–6PM SGT) with public holiday awareness
3. **Bilingual Support** — English interface with AI that understands Singlish, Mandarin, and Malay context in ticket descriptions
4. **Local Integration Stack** — Cisco Meraki (common in SG offices), FortiGate VPN, Sophos XGS, Microsoft 365 E3/E5
5. **Cost-Efficient** — Under SGD 10/user/month vs SGD 50–350+ for alternatives
6. **Zero Admin Overhead** — No dedicated ITSM administrator required; AI handles triage, escalation, and KB generation
7. **Instant Deployment** — Fully operational in hours, not weeks or months

### Ideal Customer Profile

- **Company Size**: 20–500 employees
- **Industry**: Technology, Professional Services, Financial Services, Healthcare
- **IT Team Size**: 2–20 support staff
- **Current Tools**: Shared inbox, spreadsheets, basic helpdesk, or outgrown Freshdesk/Zendesk
- **Key Pain Points**: Manual triage, SLA tracking gaps, no AI automation, compliance concerns

---

## Competitive Differentiators

### 1. AI-First Architecture
VGC-ITSM was built from the ground up with AI at its core — not bolted on as an add-on. Every ticket benefits from AI triage, SLA prediction, KB suggestions, and sentiment analysis automatically.

### 2. 48+ AI Endpoints
The most comprehensive AI API surface of any SME ITSM platform:
- Auto-triage & assignment
- Batch triage (up to 20 tickets)
- SLA breach prediction
- SLA audit & remediation
- Workload rebalancing
- Incident correlation & pattern detection
- KB auto-generation from resolved tickets
- Daily executive briefing
- AI chat with file upload & streaming
- Document & guide generation
- Error resolution assistant
- Knowledge base with version control, corrections, and learning
- Workflow-assist recommendations
- Sentiment analysis on inbound emails

### 3. Multi-Model AI Pipeline
Uses GPT-5.4-mini for fast triage/classification and o3-mini for complex reasoning — optimizing both speed and accuracy while controlling costs.

### 4. Real-Time Everything
WebSocket-based live updates across all modules. No polling, no page refresh needed. Every change propagates instantly to all connected users.

### 5. Modern Tech Stack
React 19 + Vite 8 frontend with zero-dependency server (pure Node.js 20, no Express). Sub-second page loads, offline-capable with localStorage caching.

---

## Migration Path

For organizations migrating from other platforms:

| From | Migration Effort | Data Import | Key Considerations |
|------|:---:|:---:|-------------------|
| Zendesk | Low | ✅ Native sync | Bi-directional sync means you can run in parallel |
| Freshservice | Medium | ✅ CSV import | Export incidents/assets as CSV, import via bulk API |
| ServiceNow | Medium | ✅ API import | Use ServiceNow REST API to export, VGC bulk upsert |
| Jira SM | Medium | ✅ CSV/API | Export issues via JQL, map fields to VGC schema |
| Spreadsheets | Low | ✅ CSV import | Direct CSV upload with AI field mapping |
| Shared Inbox | Low | ✅ Email sync | Connect mailbox via Graph API, AI auto-creates tickets |

---

## Conclusion

VGC-ITSM v3.20 delivers enterprise ITSM capabilities at SME pricing, with AI automation that rivals or exceeds platforms costing 10–40x more. For Singapore organizations seeking a modern, compliant, and cost-effective ITSM solution, VGC-ITSM represents the optimal balance of capability, cost, and operational simplicity.

*Document Version: 4.3.0 | Last Updated: ${new Date().toLocaleDateString("en-SG")} | Classification: Internal*`
  },

  // ───────────────────────────────────────────────────────────────────────
  // Article 2: Platform Architecture & Technical Reference
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "KB0011",
    title: "Platform Architecture & Technical Reference",
    category: "Azure",
    status: "Published",
    author: "System",
    created: now,
    tags: ["architecture", "technical", "Azure", "React", "Node.js", "infrastructure"],
    whenToUse: "Reference this article when onboarding developers, troubleshooting infrastructure, or planning capacity.",
    bestFor: "Developers, DevOps Engineers, Platform Administrators",
    quickFix: "See the Architecture Overview diagram for a quick understanding of system components.",
    content: `# Platform Architecture & Technical Reference — VGC-ITSM v3.20

## Architecture Overview

VGC-ITSM is a modern, cloud-native ITSM platform deployed on Microsoft Azure with a single-page application (SPA) frontend and a monolithic Node.js backend.

\`\`\`
┌──────────────────────────────────────────────────────────┐
│                    CLIENT BROWSER                         │
│  React 19 + Vite 8 SPA (itsm-tool.jsx ~ 23K lines)     │
│  MSAL.js 2.x (Entra ID PKCE auth)                       │
│  WebSocket client (real-time updates)                     │
│  localStorage cache (offline-capable)                     │
└──────────────────────┬───────────────────────────────────┘
                       │ HTTPS + WSS
┌──────────────────────▼───────────────────────────────────┐
│              AZURE APP SERVICE (B2s)                      │
│  Node.js 20 HTTP Server (server.js ~ 10K lines)         │
│  ├── REST API (/api/db/:collection CRUD)                 │
│  ├── AI Engine (/api/ai/* — 48+ endpoints)               │
│  ├── Graph API Proxy (/api/graph/*)                      │
│  ├── Zendesk Sync (/api/zendesk/*)                       │
│  ├── SLA Engine (slaEngine.js)                           │
│  ├── Workflow Engine (workflowEngine.js)                  │
│  ├── Notification Engine (notificationEngine.js)          │
│  ├── Analytics Engine (analyticsEngine.js)                │
│  ├── Cache Layer (cacheLayer.js)                          │
│  └── WebSocket Server (wsServer.js)                      │
└──────────────────────┬───────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│ Azure MySQL  │ │ Azure    │ │ Zendesk API  │
│ Flexible Srv │ │ OpenAI   │ │ (bi-dir sync)│
│ itsm_data    │ │ GPT-5.4  │ │              │
│ audit_log    │ │ o3-mini  │ │              │
└──────────────┘ └──────────┘ └──────────────┘
\`\`\`

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Frontend | React | 19 | UI framework (single JSX file) |
| Build Tool | Vite | 8.0.2 | Fast HMR dev + production bundling |
| Auth | MSAL.js | 2.x | Entra ID PKCE authentication |
| Backend | Node.js | 20 LTS | Zero-dependency HTTP server |
| Database | Azure MySQL | Flexible Server | Persistent storage (itsm_data table) |
| AI | Azure OpenAI | GPT-5.4-mini, o3-mini | Multi-model AI pipeline |
| Hosting | Azure App Service | B2s (Linux) | Production hosting |
| CDN/SSL | Azure App Service | Built-in | TLS 1.3, managed certificates |
| Real-time | WebSocket | Native ws | Live updates across clients |
| Email | Microsoft Graph | v1.0 | Send/receive emails, calendar |

## Database Schema

### itsm_data Table
\`\`\`sql
CREATE TABLE itsm_data (
  collection VARCHAR(64) NOT NULL,  -- e.g. "incidents", "kb", "customers"
  id VARCHAR(128) NOT NULL,         -- record unique ID
  data LONGTEXT,                    -- JSON-serialized record
  PRIMARY KEY (collection, id),
  INDEX idx_collection (collection)
);
\`\`\`

### Collections
| Collection | Description | Record Count (typical) |
|-----------|-------------|:---:|
| incidents | IT incidents & tickets | 50–500 |
| kb | Knowledge base articles | 10–100 |
| customers | Customer organizations | 20–200 |
| vendors | Vendor contacts | 5–50 |
| services | Service catalog items | 36 |
| workflow_rules | Automation rules | 9 |
| assets | CMDB asset inventory | 20+ |
| changes | Change requests | 10–100 |
| problems | Problem records | 5–50 |
| email_whitelist | Allowed email domains | 5–20 |
| ai_knowledge | AI training knowledge base | 10–100 |
| briefings | AI daily briefings | 1–30 |
| survey_templates | CSAT survey templates | 1–10 |
| managed_users | User directory | 10–100 |

## API Architecture

### REST API Pattern
All data access follows a unified pattern: \`/api/db/:collection\`
- **GET** \`/api/db/:collection\` — List all records (cached, paginated)
- **GET** \`/api/db/:collection/:id\` — Get single record
- **POST** \`/api/db/:collection\` — Create/upsert (single or bulk array)
- **PUT** \`/api/db/:collection/:id\` — Update single record
- **DELETE** \`/api/db/:collection/:id\` — Soft-delete record

### AI Endpoints (48+)
Organized by function:
- **Triage**: /api/ai/auto-triage-assign, /api/ai/batch-triage, /api/ai/auto-triage-assign/apply
- **SLA**: /api/ai/sla-predict, /api/ai/sla-audit, /api/ai/sla-remediate
- **Analytics**: /api/ai/workload-rebalance, /api/ai/correlate-incidents, /api/ai/pattern-detect, /api/ai/daily-briefing
- **Knowledge**: /api/ai/knowledge (CRUD), /api/ai/knowledge/search, /api/ai/knowledge/learn, /api/ai/knowledge/correction, /api/ai/knowledge/upload, /api/ai/knowledge/sync, /api/ai/kb-auto-generate
- **Chat**: /api/ai/chat, /api/ai/chat/stream, /api/ai/chat/upload
- **Generation**: /api/ai/generate-guide, /api/ai/generate-doc, /api/ai/resolve-error
- **Workflow**: /api/ai/workflow-assist

## Deployment Architecture

- **App Service Plan**: B2s (2 vCPU, 3.5 GB RAM)
- **Region**: Southeast Asia (Singapore)
- **Deployment Method**: Kudu VFS API (individual file upload)
- **Build Pipeline**: \`npx vite build\` → copy dist/* to deploy/ → VFS upload → restart
- **SSL**: Azure-managed TLS certificate
- **Custom Domain**: vgc-itsm1-app.azurewebsites.net

## Security Architecture

- **Authentication**: Microsoft Entra ID (Azure AD) via MSAL.js PKCE flow
- **Authorization**: 12-role RBAC with 14 permission dimensions
- **Data Encryption**: TLS 1.3 in transit, Azure-managed encryption at rest
- **Audit Trail**: Every CRUD operation logged to audit_log table
- **Session**: Token-based (Entra ID access tokens, 1-hour expiry)
- **CORS**: Restricted to application domain

*Document Version: 4.3.0 | Last Updated: ${new Date().toLocaleDateString("en-SG")} | Classification: Internal*`
  },

  // ───────────────────────────────────────────────────────────────────────
  // Article 3: AI Capabilities & Automation Guide
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "KB0012",
    title: "AI Capabilities & Automation Guide",
    category: "SOP",
    status: "Published",
    author: "System",
    created: now,
    tags: ["AI", "automation", "GPT", "triage", "machine learning", "Azure OpenAI"],
    whenToUse: "Reference when configuring AI features, training the AI knowledge base, or understanding AI-driven automation capabilities.",
    bestFor: "IT Administrators, Service Desk Leads, AI Configuration Managers",
    quickFix: "AI auto-triage is enabled by default. To train AI with custom knowledge, go to AI Assist → Train AI.",
    content: `# AI Capabilities & Automation Guide — VGC-ITSM v3.20

## AI Engine Overview

VGC-ITSM uses a **multi-model AI pipeline** powered by Azure OpenAI:

| Model | Use Case | Latency | Cost |
|-------|----------|---------|------|
| **GPT-5.4-mini** | Fast triage, classification, chat responses | ~1–2s | Low |
| **o3-mini** | Complex reasoning, pattern detection, document generation | ~3–8s | Medium |

The AI engine processes **every ticket automatically** — no manual configuration required. All AI actions go through a human-in-the-loop approval queue for critical decisions.

---

## AI Capabilities (48+ Endpoints)

### 1. Auto-Triage & Assignment
**Endpoint**: \`POST /api/ai/auto-triage-assign\`

When a new incident is created (manually or via email/Zendesk), the AI automatically:
- Categorizes the incident (Network, Hardware, Software, Security, etc.)
- Assigns priority (Sev-A Critical through Sev-D Low)
- Recommends the best team/engineer based on skills and workload
- Suggests relevant KB articles
- Predicts SLA compliance probability
- Generates workflow recommendations

**Batch Mode**: \`POST /api/ai/batch-triage\` processes up to 20 tickets in one call.

### 2. SLA Intelligence
**Endpoints**:
- \`POST /api/ai/sla-predict\` — Predicts which tickets will breach SLA
- \`POST /api/ai/sla-audit\` — Scans incidents for SLA data quality issues
- \`POST /api/ai/sla-remediate\` — Recalculates SLA using business hours

The AI SLA Guardian continuously monitors all open tickets and:
- Alerts when tickets reach 75% of SLA target
- Predicts breaches before they happen
- Suggests reassignment to prevent breaches
- Auto-escalates based on workflow rules (WF001, WF003)

### 3. Workload Rebalancing
**Endpoint**: \`POST /api/ai/workload-rebalance\`

Analyzes team workload distribution and suggests ticket reassignments to prevent burnout and improve response times. Considers:
- Current ticket count per engineer
- Ticket complexity and priority
- Engineer skills and expertise areas
- SLA deadlines

### 4. Incident Correlation & Pattern Detection
**Endpoints**:
- \`POST /api/ai/correlate-incidents\` — Finds patterns and common root causes
- \`POST /api/ai/pattern-detect\` — Analyzes historical data for recurring issues

Identifies when multiple incidents share a common root cause (e.g., network switch failure causing multiple connectivity tickets), enabling Problem Management.

### 5. Knowledge Base Automation
**Endpoints**:
- \`POST /api/ai/kb-auto-generate\` — Generates KB articles from resolved tickets
- \`POST /api/ai/kb-auto-generate/approve\` — Publishes approved KB drafts
- \`POST /api/ai/knowledge/learn\` — AI learns from user corrections
- \`POST /api/ai/knowledge/correction\` — User corrects AI answer
- \`POST /api/ai/knowledge/search\` — Semantic search across KB
- \`POST /api/ai/knowledge/upload\` — Upload documents for AI training
- \`POST /api/ai/knowledge/sync\` — Sync external knowledge sources

When a ticket is resolved, AI can automatically generate a KB article capturing the solution, categorize it, and submit for review.

### 6. AI Chat Assistant
**Endpoints**:
- \`POST /api/ai/chat\` — Standard chat completion
- \`POST /api/ai/chat/stream\` — Streaming chat (real-time token output)
- \`POST /api/ai/chat/upload\` — Upload files for AI analysis

Full-featured AI assistant that:
- Answers IT questions using trained knowledge base
- Analyzes uploaded documents (logs, configs, screenshots)
- Provides troubleshooting steps
- Generates scripts and documentation
- Supports real-time streaming responses

### 7. Document & Guide Generation
**Endpoints**:
- \`POST /api/ai/generate-guide\` — Generates step-by-step IT guides
- \`POST /api/ai/generate-doc\` — Creates formatted documentation
- \`POST /api/ai/resolve-error\` — Provides error resolution steps

Generate SOPs, troubleshooting guides, and technical documentation on-demand.

### 8. Daily Executive Briefing
**Endpoint**: \`POST /api/ai/daily-briefing\`

Generates a comprehensive daily report including:
- Ticket volume and trends
- SLA compliance summary
- Critical incidents requiring attention
- Team performance metrics
- AI automation statistics
- Recommendations for improvement

### 9. Workflow Assist
**Endpoint**: \`POST /api/ai/workflow-assist\`

Recommends workflow actions for incidents based on historical patterns. Suggests:
- Escalation paths
- Resolution strategies
- Similar past incidents and their solutions

### 10. Email Sentiment Analysis
Integrated into the email-to-ticket pipeline. When emails arrive:
- Detects customer sentiment (positive, neutral, frustrated, angry)
- Measures urgency score (0–100%)
- Auto-escalates priority for angry/frustrated customers with high urgency
- Logs emotional tone for agent preparation

---

## AI Configuration

### Admin → AI Settings
- **Primary Model**: GPT-5.4-mini (default for triage/chat)
- **Reasoning Model**: o3-mini (complex analysis)
- **Auto-Triage**: Enabled by default for all new incidents
- **Human-in-the-Loop**: Required for AI triage application (Zendesk AI Command Center)
- **KB Auto-Generate**: Enabled on ticket resolution
- **Confidence Threshold**: 
  - High (≥80%): Green indicator, safe to auto-apply
  - Medium (60–79%): Yellow, review recommended
  - Low (<60%): Red, manual review required

### Training AI with Custom Knowledge
1. Navigate to **AI Assist → Train AI**
2. Add knowledge entries (title + content)
3. Or upload documents (PDF, DOCX, TXT)
4. AI prioritizes custom knowledge over general training
5. Version history maintained for all knowledge edits

*Document Version: 4.3.0 | Last Updated: ${new Date().toLocaleDateString("en-SG")} | Classification: Internal*`
  },

  // ───────────────────────────────────────────────────────────────────────
  // Article 4: SLA Policy & Compliance Framework
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "KB0013",
    title: "SLA Policy & Compliance Framework",
    category: "SOP",
    status: "Published",
    author: "System",
    created: now,
    tags: ["SLA", "compliance", "response time", "resolution", "escalation", "business hours"],
    whenToUse: "Reference when setting SLA targets, investigating SLA breaches, or configuring escalation rules.",
    bestFor: "Service Desk Leads, IT Managers, Compliance Officers",
    quickFix: "SLA targets: Sev-A = 30min response / 4h resolution, Sev-B = 1h / 4h, Sev-C = 4h / 9h, Sev-D = 9h / 27h. All in business hours (Mon–Fri 9AM–6PM SGT).",
    content: `# SLA Policy & Compliance Framework — VGC-ITSM v3.20

## SLA Targets by Priority

| Priority | Severity | First Response | Worst-Case Resolution | Business Impact |
|----------|----------|:-:|:-:|-----------------|
| **Sev-A** | Critical | 0.5 hours (30 min) | 4 hours | System down, all users affected |
| **Sev-B** | High | 1 hour | 4 hours | Major feature unavailable, many users affected |
| **Sev-C** | Medium | 4 hours | 9 hours | Workaround available, some users affected |
| **Sev-D** | Low | 9 hours | 27 hours | Minor issue, single user, cosmetic |

*All times measured in business hours (Mon–Fri 9:00 AM – 6:00 PM SGT).*

---

## Business Hours Calculation

The SLA engine (slaEngine.js) calculates elapsed time using **Singapore business hours only**:

- **Business Days**: Monday through Friday
- **Business Hours**: 9:00 AM – 6:00 PM SGT (UTC+8)
- **Non-Business**: Weekends, Singapore public holidays
- **Clock Pauses**: Outside business hours (evenings, weekends, holidays)

### Example
A Sev-C ticket created at **4:00 PM Friday** has a 4-hour first response target:
- Friday 4:00 PM – 6:00 PM = 2 business hours
- Saturday & Sunday = 0 hours (paused)
- Monday 9:00 AM – 11:00 AM = 2 business hours
- **First response due**: Monday 11:00 AM SGT

---

## Escalation Rules

### Automatic Escalation (Workflow Rules)

| Rule | Trigger | Action |
|------|---------|--------|
| **WF001** | Sev-A + no response in 15 min | Escalate to IT Manager + SMS alert |
| **WF003** | Any ticket at 75% SLA consumed | Warning to assignee + manager |
| **WF005** | Reporter is VIP/Executive | Auto-set High priority, assign senior agent |
| **WF008** | Enterprise customer ticket | Apply customer-specific SLA, assign dedicated team |

### Manual Escalation Levels

| Level | Escalated To | When |
|-------|-------------|------|
| L1 → L2 | L2 Support Engineer | Issue requires deeper technical expertise |
| L2 → L3 | Network Engineer / Vendor | Infrastructure or vendor-specific issue |
| L2 → Problem | Problem Manager | Recurring issue requiring root cause analysis |
| Any → Manager | IT Manager / Service Desk Lead | SLA breach imminent or customer escalation |

---

## SLA Compliance Metrics

### Dashboard KPIs
- **SLA Compliance Rate**: % of tickets resolved within SLA target
- **MTTR (Mean Time To Resolve)**: Average resolution time across all priorities
- **First Response SLA**: % of tickets with first response within target
- **SLA Breach Count**: Number of tickets that exceeded resolution target

### SLA Status Indicators
- 🟢 **On Track**: < 50% of SLA consumed
- 🟡 **At Risk**: 50–75% of SLA consumed
- 🟠 **Warning**: 75–99% of SLA consumed
- 🔴 **Breached**: 100%+ of SLA consumed

### AI SLA Guardian
The AI continuously monitors all open tickets and:
1. Predicts which tickets will breach SLA (\`/api/ai/sla-predict\`)
2. Suggests preventive actions (reassignment, priority change)
3. Audits SLA data quality (\`/api/ai/sla-audit\`)
4. Recalculates SLA for resolved tickets using exact business hours (\`/api/ai/sla-remediate\`)

---

## SLA Reporting

### Available Reports
- SLA Compliance by Priority (daily/weekly/monthly)
- SLA Compliance by Team
- SLA Compliance by Category
- Breach Root Cause Analysis
- Customer SLA Performance

### Export Options
- PDF report generation
- CSV data export
- Email scheduled reports

*Document Version: 4.3.0 | Last Updated: ${new Date().toLocaleDateString("en-SG")} | Classification: Internal*`
  },

  // ───────────────────────────────────────────────────────────────────────
  // Article 5: Security & Compliance — ISO 27001 + PDPA
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "KB0014",
    title: "Security & Compliance — ISO 27001 & PDPA Guide",
    category: "Security",
    status: "Published",
    author: "System",
    created: now,
    tags: ["security", "PDPA", "ISO 27001", "compliance", "Entra ID", "RBAC", "audit", "encryption"],
    whenToUse: "Reference for security audits, compliance reviews, PDPA assessments, or onboarding security-conscious customers.",
    bestFor: "Security Officers, Compliance Managers, IT Auditors",
    quickFix: "VGC-ITSM uses Entra ID SSO, 12-role RBAC, full audit logging, and Azure-managed encryption. Data resides in Azure Southeast Asia (Singapore).",
    content: `# Security & Compliance Guide — VGC-ITSM v3.20

## Security Architecture Overview

VGC-ITSM implements defense-in-depth security aligned with ISO 27001 and Singapore PDPA requirements.

---

## Authentication & Identity

### Microsoft Entra ID (Azure AD) Integration
- **Protocol**: OAuth 2.0 Authorization Code Flow with PKCE
- **Library**: MSAL.js 2.x (Microsoft Authentication Library)
- **Token Lifetime**: 1 hour (configurable via Entra ID)
- **MFA**: Enforced via Entra ID Conditional Access policies
- **SSO**: Single Sign-On across all Microsoft 365 apps

### Authentication Flow
1. User navigates to VGC-ITSM
2. MSAL.js redirects to Entra ID login
3. User authenticates (password + MFA)
4. Entra ID returns access token via PKCE
5. Frontend sends token with every API request
6. Backend validates token against Entra ID

---

## Role-Based Access Control (RBAC)

### 12 Enterprise Roles

| Role | Level | Access Scope |
|------|:---:|-------------|
| VGC Dev Admin | -1 | Full system access, API keys, billing, infrastructure |
| Tenant Admin | 0 | Tenant management, compliance, customization (no API keys) |
| Administrator | 0 | Full system access, user management, AI config |
| Service Desk Lead | 1 | Team management, approvals, KB publishing |
| L1 Support Engineer | 2 | Create/edit incidents, fulfill requests |
| L2 Support Engineer | 2 | Escalated tickets, problem management |
| Network Engineer | 2 | Infrastructure support, change submissions |
| Change Manager | 1 | Change governance, risk assessment, approvals |
| Problem Manager | 1 | Root cause analysis, known error database |
| Asset Manager | 1 | CMDB management, asset lifecycle |
| End User | 3 | Self-service: raise tickets, view KB |
| Read Only | 4 | View-only dashboards and reports |

### 14 Permission Dimensions
Each role has permissions across: Dashboard, Incidents, Problems, Changes, Requests, Catalog, Knowledge, Assets, Approvals, SLA, AI, Admin, Customers, Reports.

Permission levels: full, manage, edit, publish, contribute, approve, submit, fulfill, use, create, view, limited, none.

---

## Data Protection & PDPA Compliance

### Singapore PDPA Alignment

| PDPA Obligation | VGC-ITSM Implementation |
|----------------|------------------------|
| Consent | Consent tracking on data collection forms |
| Purpose Limitation | Data used only for ITSM operations |
| Notification | Privacy notices in ticket submission forms |
| Access | Users can view their own tickets and data |
| Correction | Users can request data corrections |
| Protection | Azure-managed encryption, TLS 1.3, RBAC |
| Retention | Configurable data retention policies |
| Transfer | Data resides in Azure Southeast Asia (Singapore) |
| Openness | PDPA compliance dashboard in Admin module |
| Data Breach | Incident response workflow with notification timeline |

### Data Residency
- **Primary Region**: Azure Southeast Asia (Singapore)
- **Database**: Azure MySQL Flexible Server (Singapore)
- **AI Processing**: Azure OpenAI (regional endpoint)
- **No data leaves Singapore region** for processing or storage

### Data Masking
- PII fields masked in logs and exports
- Email addresses partially masked in audit trails
- Customer data access restricted by RBAC role

---

## Audit & Logging

### Comprehensive Audit Trail
Every operation in VGC-ITSM is logged to the audit_log table:

| Field | Description |
|-------|-------------|
| collection | Which data collection was affected |
| recordId | ID of the affected record |
| action | Type of operation (upsert, delete, bulk_upsert) |
| details | JSON details of the change |
| user | Email of the user who performed the action |
| timestamp | When the action occurred |

### What's Audited
- All CRUD operations on every collection
- User authentication events
- AI triage actions and approvals
- SLA recalculations
- Workflow rule executions
- Email send/receive events
- Configuration changes
- Bulk import/export operations

---

## Encryption

| Layer | Method | Standard |
|-------|--------|----------|
| In Transit | TLS 1.3 | HTTPS enforced, HSTS headers |
| At Rest | Azure-managed keys | AES-256 (Azure Storage/MySQL) |
| Tokens | Entra ID signed JWT | RS256 signing |
| API Keys | Environment variables | Not stored in code or database |

---

## Network Security

- **Firewall**: Azure App Service built-in firewall
- **IP Restrictions**: Configurable IP allowlists
- **DDoS Protection**: Azure platform-level DDoS mitigation
- **CORS**: Restricted to application domain only
- **Headers**: Security headers (X-Content-Type-Options, X-Frame-Options, CSP)

---

## Incident Response

### Security Incident Workflow
1. **Detection**: Automated alerts from security monitoring
2. **Classification**: AI assesses severity and impact
3. **Containment**: Immediate response actions
4. **Investigation**: Root cause analysis
5. **Remediation**: Fix and verify
6. **Notification**: PDPA-required breach notifications (within 3 days)
7. **Post-Incident**: Review and improve controls

### Cyber Threat Intelligence
- Real-time threat feed dashboard
- AI-powered threat relevance analysis
- Automated CVE correlation with CMDB assets
- Security alert notifications to security team

*Document Version: 4.3.0 | Last Updated: ${new Date().toLocaleDateString("en-SG")} | Classification: Internal*`
  },

  // ───────────────────────────────────────────────────────────────────────
  // Article 6: Integration Reference Guide
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "KB0015",
    title: "Integration Reference Guide — Zendesk, M365, Meraki & More",
    category: "SOP",
    status: "Published",
    author: "System",
    created: now,
    tags: ["integration", "Zendesk", "Microsoft 365", "Meraki", "Graph API", "email", "SSO"],
    whenToUse: "Reference when configuring integrations, troubleshooting sync issues, or planning new integration deployments.",
    bestFor: "IT Administrators, Integration Engineers, DevOps Teams",
    quickFix: "Zendesk sync runs every 60 seconds automatically. M365 email-to-ticket uses Graph API. Meraki dashboard data is fetched via Dashboard API.",
    content: `# Integration Reference Guide — VGC-ITSM v3.20

## Integration Architecture

VGC-ITSM integrates with multiple platforms via native APIs. All integrations are built-in — no plugins or marketplace add-ons required.

---

## 1. Zendesk Integration (Bi-directional)

### Overview
- **Sync Interval**: Every 60 seconds
- **Direction**: Bi-directional (Zendesk ↔ ITSM)
- **Data Synced**: Tickets, organizations, users, comments

### Features
- Auto-import Zendesk tickets to ITSM
- Sync ticket status changes both ways
- Import Zendesk organizations as ITSM customers
- AI auto-triage imported tickets
- Human-in-the-loop approval for AI actions
- Bulk historical import capability
- Unlinked ticket detection and import

### Zendesk AI Command Center
Dedicated module for managing the Zendesk integration:
- Real-time sync status dashboard
- AI triage approval queue
- Automation rule configuration
- Historical import tool
- Error and retry management

---

## 2. Microsoft 365 Integration (Graph API)

### Email-to-Ticket Pipeline
- **Protocol**: Microsoft Graph API v1.0
- **Authentication**: OAuth 2.0 client credentials
- **Mailbox Monitoring**: Configurable shared mailbox
- **Processing**: AI sentiment analysis → auto-categorize → create ticket

### Email Flow
1. Email arrives in monitored shared mailbox
2. Graph API webhook or polling detects new email
3. AI analyzes content, sentiment, and urgency
4. Incident created with AI-suggested category and priority
5. Confirmation email sent to reporter
6. AI suggests relevant KB articles

### Teams Integration
- Ticket notifications to Teams channels
- Status update messages
- Approval requests via Teams
- AI chat accessible from Teams

### Calendar Integration
- Change Calendar syncs with Outlook
- Maintenance window visibility
- Meeting scheduling for CAB reviews

---

## 3. Microsoft Entra ID (SSO & User Directory)

### Authentication
- MSAL.js PKCE flow for SPA authentication
- Conditional Access policy support
- MFA enforcement
- Token refresh handling

### User Directory Sync
- Auto-provision users from Entra ID
- Role mapping based on Entra ID groups
- Department and manager hierarchy sync
- Profile photo sync

---

## 4. Cisco Meraki Integration

### Dashboard API
- Network device status monitoring
- Client connectivity data
- WiFi health metrics
- Switch port utilization
- Security appliance events

### ITSM Integration Points
- Network incidents auto-enriched with Meraki data
- Device status visible in Asset Management
- WiFi issue tickets include AP health data
- Auto-created incidents for Meraki alerts

---

## 5. FortiGate VPN Integration

### Capabilities
- VPN tunnel status monitoring
- User connection tracking
- Bandwidth and latency metrics
- Security event correlation

---

## 6. Sophos XGS Integration

### Capabilities
- Web application firewall status
- Threat detection alerts
- Endpoint protection status
- Security event forwarding to ITSM

---

## 7. Azure OpenAI Integration

### Multi-Model Configuration
- **Primary**: GPT-5.4-mini (fast triage/classification)
- **Reasoning**: o3-mini (complex analysis)
- **Endpoint**: Azure OpenAI regional deployment
- **Rate Limiting**: Built-in retry with exponential backoff
- **Cost Tracking**: Token usage monitoring per operation

---

## Integration Health Monitoring

| Integration | Health Check | Alert Threshold |
|-------------|-------------|-----------------|
| Zendesk | Sync heartbeat every 60s | >5 min without sync |
| Graph API | Token refresh cycle | Auth failure |
| Azure OpenAI | Model availability check | Response >30s |
| Meraki | Dashboard API ping | Device offline |

### Admin → Integration Settings
All integrations are configurable via the Administration module:
- Enable/disable individual integrations
- Configure API keys and credentials
- Set sync intervals
- View integration logs
- Monitor health status

*Document Version: 4.3.0 | Last Updated: ${new Date().toLocaleDateString("en-SG")} | Classification: Internal*`
  },

  // ───────────────────────────────────────────────────────────────────────
  // Article 7: Service Catalog Reference
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "KB0016",
    title: "Service Catalog Reference — 36 IT Services with SLA & AI Explanations",
    category: "SOP",
    status: "Published",
    author: "System",
    created: now,
    tags: ["service catalog", "services", "SLA", "request", "self-service", "ITIL"],
    whenToUse: "Reference when submitting service requests, reviewing available IT services, or configuring the service catalog.",
    bestFor: "End Users, Service Desk Engineers, IT Managers",
    quickFix: "Browse the Service Catalog module in VGC-ITSM to submit a request. Each service card shows SLA target and description.",
    content: `# Service Catalog Reference — VGC-ITSM v3.20

## Overview

VGC-ITSM provides **36 IT services** organized across **10 categories**. Each service includes:
- Defined SLA target (in business hours)
- AI-powered explanation of when and how to use it
- Self-service request submission
- Automated routing to the correct fulfillment team

---

## Services by Category

### 🔑 Access & Identity (5 services)

| ID | Service | SLA (hrs) | Description |
|----|---------|:-:|-------------|
| SVC01 | Password Reset | 4 | Reset AD / M365 / VPN passwords, includes MFA re-enrollment |
| SVC09 | New User Onboarding | 24 | Full onboarding: AD, M365, email, security groups, laptop, VPN |
| SVC10 | User Offboarding | 8 | Disable account, revoke access, transfer mailbox, backup OneDrive |
| SVC11 | Permission / Group Change | 8 | Add/remove from security groups, SharePoint, shared mailboxes |
| SVC12 | MFA Reset / Enrollment | 4 | Re-enroll MFA for M365 or VPN |

### 💻 Hardware & Devices (5 services)

| ID | Service | SLA (hrs) | Description |
|----|---------|:-:|-------------|
| SVC02 | New Laptop Request | 72 | Standard SOE build with M365, VPN, security software |
| SVC13 | Monitor / Peripheral Request | 48 | Monitors, keyboards, mice, headsets, docking stations |
| SVC14 | Mobile Device Setup | 24 | Intune MDM enrollment, Outlook, Teams on phone/tablet |
| SVC15 | Printer Setup / Issue | 12 | Network printer install, print queue, driver issues |
| SVC16 | Hardware Repair / Warranty | 48 | Dell TechDirect warranty check and repair case |

### 📦 Software & Applications (4 services)

| ID | Service | SLA (hrs) | Description |
|----|---------|:-:|-------------|
| SVC03 | Software Installation | 24 | Install from company catalog via Intune |
| SVC17 | Software License Request | 24 | M365, Adobe, Visio, Project, AutoCAD licenses |
| SVC18 | Application Access Request | 12 | Access to ERP, CRM, HRMS, finance systems |
| SVC19 | Software Update / Patch | 24 | OS or application updates, security patches |

### 🌐 Network & Connectivity (4 services)

| ID | Service | SLA (hrs) | Description |
|----|---------|:-:|-------------|
| SVC04 | VPN Access Setup | 8 | FortiClient VPN with split-tunnel and MFA |
| SVC20 | Network Connectivity Issue | 8 | WiFi, LAN, internet troubleshooting |
| SVC21 | Firewall Rule Request | 24 | FortiGate port opening with risk assessment |
| SVC22 | WiFi Access / Guest WiFi | 4 | Corporate WiFi or temporary guest credentials |

### 📧 Email & Communication (4 services)

| ID | Service | SLA (hrs) | Description |
|----|---------|:-:|-------------|
| SVC05 | Email Distribution List | 12 | Create/modify DLs and shared mailboxes |
| SVC23 | Shared Mailbox Setup | 12 | Team mailboxes with access permissions |
| SVC24 | Email Signature Update | 8 | Company-wide signature template deployment |
| SVC25 | Teams Channel / Team Setup | 8 | Create Teams workspaces with channels and permissions |

### ☁️ Cloud & Infrastructure (4 services)

| ID | Service | SLA (hrs) | Description |
|----|---------|:-:|-------------|
| SVC06 | Cloud Storage Upgrade | 24 | OneDrive, SharePoint, Azure storage quotas |
| SVC26 | SharePoint Site Request | 24 | New team or communication site with permissions |
| SVC27 | Azure Resource Provisioning | 48 | VMs, databases, storage, web apps with cost estimate |
| SVC28 | Backup & Restore Request | 12 | File/VM/database restore from Azure Backup |

### 🛡️ Security (4 services)

| ID | Service | SLA (hrs) | Description |
|----|---------|:-:|-------------|
| SVC07 | Security Incident Report | 4 | Report phishing, malware, data breach attempts |
| SVC29 | Endpoint Protection Issue | 8 | CrowdStrike/Sophos agent issues, scan requests |
| SVC30 | SSL Certificate Request | 24 | New or renewal SSL/TLS certificates |
| SVC31 | Security Access Review | 48 | Quarterly access review and compliance audit |

### 🗄️ Database (1 service)

| ID | Service | SLA (hrs) | Description |
|----|---------|:-:|-------------|
| SVC32 | Database Performance Issue | 8 | Slow queries, deadlocks, CPU/storage issues |

### 📈 Analytics (2 services)

| ID | Service | SLA (hrs) | Description |
|----|---------|:-:|-------------|
| SVC33 | Power BI Report Request | 48 | New dashboards, reports, data source connections |
| SVC34 | Data Export / Extract | 24 | PDPA-compliant data export for reporting or audit |

### 🎥 Facilities (2 services)

| ID | Service | SLA (hrs) | Description |
|----|---------|:-:|-------------|
| SVC35 | Meeting Room AV Setup | 4 | Video conferencing, projector, audio equipment |
| SVC36 | Desk / Workspace Setup | 24 | Monitor, dock, keyboard, mouse, phone setup |

---

## How to Submit a Service Request

1. Navigate to **Service Catalog** in VGC-ITSM
2. Browse or search for the desired service
3. Click **"Request →"** on the service card
4. Fill in the request details
5. Submit — AI auto-routes to the fulfillment team
6. Track progress in **My Requests**

## AI-Enhanced Service Delivery

Each service request benefits from AI automation:
- **Smart Routing**: AI assigns to the best-qualified engineer
- **SLA Tracking**: Automatic countdown from submission
- **KB Suggestions**: Relevant self-help articles shown before submission
- **Status Updates**: Real-time notifications via WebSocket
- **Satisfaction Survey**: AI-generated CSAT survey on completion (WF009)

*Document Version: 4.3.0 | Last Updated: ${new Date().toLocaleDateString("en-SG")} | Classification: Internal*`
  },

  // ───────────────────────────────────────────────────────────────────────
  // Article 8: Workflow Automation & Rules Engine
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "KB0017",
    title: "Workflow Automation & Rules Engine — WF001 to WF009",
    category: "SOP",
    status: "Published",
    author: "System",
    created: now,
    tags: ["workflow", "automation", "rules", "escalation", "auto-close", "WF001", "WF009"],
    whenToUse: "Reference when configuring automation rules, troubleshooting workflow behavior, or designing new automation.",
    bestFor: "IT Administrators, Service Desk Leads, Workflow Designers",
    quickFix: "View active rules in Admin → Workflow Automation. Toggle rules on/off without deletion.",
    content: `# Workflow Automation & Rules Engine — VGC-ITSM v3.20

## Overview

VGC-ITSM includes a server-side **Workflow Engine** (workflowEngine.js) that evaluates automation rules in real-time. Rules trigger on events (ticket creation, status change, SLA threshold) and execute actions automatically.

The engine runs on a configurable interval and processes both:
- **Event-driven triggers**: Fired immediately when conditions are met
- **Periodic evaluation**: Scans all active tickets against time-based rules

---

## Built-in Workflow Rules (WF001–WF009)

### WF001 — Critical Incident Auto-Escalate
| Property | Value |
|----------|-------|
| **Trigger** | Priority = Sev-A (Critical) AND no response within 15 minutes |
| **Action** | Escalate to IT Manager + Send SMS alert |
| **Module** | Incidents |
| **Status** | Active |
| **SLA-Linked** | Yes |

Ensures critical incidents receive immediate attention. If no agent responds within 15 minutes, the incident is auto-escalated with an SMS notification to the IT Manager.

### WF002 — Auto-Approve Standard Changes
| Property | Value |
|----------|-------|
| **Trigger** | Change Type = Standard AND Risk = Low |
| **Action** | Auto-approve and notify assignee |
| **Module** | Changes |
| **Status** | Active |
| **SLA-Linked** | No |

Low-risk standard changes (e.g., minor config changes, software updates) are auto-approved without CAB review, reducing approval bottlenecks.

### WF003 — SLA Breach Alert
| Property | Value |
|----------|-------|
| **Trigger** | SLA usage exceeds 75% |
| **Action** | Send warning to assignee + manager |
| **Module** | SLA |
| **Status** | Active |
| **SLA-Linked** | Yes |

Early warning system. When any ticket reaches 75% of its SLA target, both the assignee and their manager receive an alert to prevent breaches.

### WF004 — Auto-Close Resolved (72h)
| Property | Value |
|----------|-------|
| **Trigger** | Status = Resolved for 72 hours |
| **Action** | Auto-close ticket and send satisfaction survey |
| **Module** | Incidents |
| **Status** | Active |
| **SLA-Linked** | No |

Tickets in "Resolved" status for 72 business hours are automatically closed. A customer satisfaction survey is triggered before closure.

### WF005 — VIP User Fast-Track
| Property | Value |
|----------|-------|
| **Trigger** | Reporter role = VIP / Executive |
| **Action** | Set priority to High, assign senior agent |
| **Module** | Requests |
| **Status** | Active |
| **SLA-Linked** | Yes |

Ensures executive and VIP users receive expedited service by auto-elevating priority and routing to experienced agents.

### WF006 — KB Article Auto-Suggest
| Property | Value |
|----------|-------|
| **Trigger** | New incident created |
| **Action** | AI searches KB and attaches relevant articles |
| **Module** | Knowledge |
| **Status** | Active |
| **SLA-Linked** | No |
| **AI-Suggested** | Yes |

When a new incident is created, AI automatically searches the knowledge base and attaches relevant articles that may help resolve the issue faster.

### WF007 — Duplicate Detection
| Property | Value |
|----------|-------|
| **Trigger** | New incident similar to existing open ticket |
| **Action** | Alert agent and suggest linking |
| **Module** | Incidents |
| **Status** | Beta |
| **SLA-Linked** | No |
| **AI-Suggested** | Yes |

AI detects when a new incident may be a duplicate of an existing open ticket and suggests linking them. Currently in Beta status.

### WF008 — Customer-Adaptive SLA Routing
| Property | Value |
|----------|-------|
| **Trigger** | Ticket created for enterprise customer |
| **Action** | Apply customer-specific SLA and assign dedicated team |
| **Module** | SLA |
| **Status** | Active |
| **SLA-Linked** | Yes |
| **AI-Suggested** | Yes |

Enterprise customers with custom SLA agreements get automatic SLA policy overrides and dedicated team routing.

### WF009 — Post-Resolution Survey Trigger
| Property | Value |
|----------|-------|
| **Trigger** | Ticket status changed to Resolved |
| **Action** | Generate AI customer satisfaction survey email |
| **Module** | Incidents |
| **Status** | Active |
| **SLA-Linked** | No |

When any ticket is resolved, AI generates and sends a personalized customer satisfaction survey email.

---

## Managing Workflow Rules

### Viewing Rules
Navigate to **Admin → Workflow Automation** to see all rules with:
- Status indicator (Active / Inactive / Beta)
- Trigger description
- Action summary
- Last modified date
- Creator information

### Creating Custom Rules
1. Go to **Admin → Workflow Automation**
2. Click **"+ Add Rule"**
3. Define: Name, Trigger condition, Action, Module
4. Set status to Active
5. Rule begins evaluating immediately

### AI-Suggested Rules
The AI can suggest new workflow rules based on ticket patterns:
- Go to **Admin → Workflow Automation**
- Click **"AI Suggest Rules"**
- Review AI recommendations
- Approve or reject each suggestion

### Rule Execution Audit
All workflow rule executions are logged to the audit trail:
- Rule ID and name
- Trigger event details
- Action taken
- Affected ticket IDs
- Timestamp
- Success/failure status

---

## Workflow Engine Architecture

The WorkflowEngine class (workflowEngine.js) operates as follows:

1. **Startup**: Engine starts with configurable evaluation interval
2. **Rule Loading**: Rules loaded from \`workflow_rules\` collection (cached with TTL)
3. **Evaluation**: Active rules evaluated against current events and ticket state
4. **Execution**: Matching rules trigger their configured actions
5. **Logging**: All executions recorded with statistics
6. **Stats**: rulesEvaluated, actionsExecuted, errorsEncountered tracked

*Document Version: 4.3.0 | Last Updated: ${new Date().toLocaleDateString("en-SG")} | Classification: Internal*`
  },

  // ───────────────────────────────────────────────────────────────────────
  // Article 9: User & Administration Guide
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "KB0018",
    title: "User & Administration Guide — Roles, Modules & Configuration",
    category: "SOP",
    status: "Published",
    author: "System",
    created: now,
    tags: ["user guide", "administration", "RBAC", "roles", "modules", "configuration", "onboarding"],
    whenToUse: "Reference when onboarding new users, configuring system settings, or understanding module access and permissions.",
    bestFor: "All Users, IT Administrators, New Staff Onboarding",
    quickFix: "Your role determines what you can see and do. Check with your admin if you need additional access.",
    content: `# User & Administration Guide — VGC-ITSM v3.20

## Getting Started

### First Login
1. Navigate to **https://vgc-itsm1-app.azurewebsites.net**
2. Click **"Sign in with Microsoft"**
3. Authenticate with your Entra ID credentials + MFA
4. VGC-ITSM loads your profile and role automatically
5. Your dashboard shows modules based on your assigned role

### Navigation
The left sidebar provides access to all modules. Modules are organized by function:
- **Dashboard** — Overview KPIs and widgets
- **Incidents** — IT incident management
- **Operations** — Problems, Changes, Service Requests
- **Service Catalog** — Self-service request portal
- **Knowledge Base** — IT knowledge articles
- **SLA Management** — SLA tracking and compliance
- **AI Assist** — AI chat and automation
- **Zendesk** — Zendesk AI Command Center
- **Reports** — Analytics and reporting
- **Assets** — CMDB and asset inventory
- **Customers** — Customer management
- **M365 Hub** — Microsoft 365 integration
- **Cyber Intel** — Security threat intelligence
- **Admin** — System configuration (admin only)

---

## RBAC Roles — Detailed Access Matrix

### Permission Levels Explained
| Level | Meaning |
|-------|---------|
| **full** | Complete read/write/delete/configure access |
| **manage** | Read/write/assign but no system configuration |
| **edit** | Read and modify existing records |
| **publish** | Create and publish content (e.g., KB articles) |
| **contribute** | Create drafts and submit for review |
| **approve** | Review and approve/reject items |
| **submit** | Create and submit for approval |
| **fulfill** | Execute and complete assigned tasks |
| **use** | Use features but not configure them |
| **create** | Create new records only |
| **view** | Read-only access |
| **limited** | Restricted subset of admin features |
| **none** | No access to this module |

### Role Comparison Matrix

| Module | VGC Dev Admin | Tenant Admin | Administrator | SD Lead | L1 Support | L2 Support | End User |
|--------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Dashboard | full | full | full | view | view | view | none |
| Incidents | full | full | full | manage | edit | manage | create |
| Problems | full | full | full | manage | view | edit | none |
| Changes | full | full | full | view | view | view | none |
| Requests | full | full | full | manage | fulfill | fulfill | create |
| Catalog | full | full | full | view | view | view | view |
| Knowledge | full | full | full | publish | contribute | contribute | view |
| Assets | full | full | full | view | view | view | none |
| Approvals | full | full | full | approve | none | none | none |
| SLA | full | full | full | view | view | view | none |
| AI | full | view | full | view | use | use | none |
| Admin | full | limited | full | limited | none | none | none |

---

## Module Guide

### Dashboard
The dashboard shows real-time KPIs and widgets. Management roles see executive KPIs, team workload, SLA compliance, and business impact. Engineers see personal KPIs, ticket queue, and AI co-pilot.

**Customizable Widgets**: Click the gear icon to enable/disable dashboard cards. Available widgets include:
- Executive KPIs, Zendesk Sync, Case Analysis, Priority Distribution
- SLA Status, Team Workload, Business Impact, Pending Approvals
- Operations Hub, Network & Security Hub, Personal KPIs
- My Ticket Queue, Quick Actions, AI Co-Pilot, Unassigned Queue
- Security Alerts, AI Performance KPI, Cyber Threat Feed
- PDPA Compliance, System Health, Change Calendar, Workflow Hub

### Incident Management
Create, track, and resolve IT incidents. Features:
- AI auto-triage on creation
- SLA countdown timer
- Activity log with full history
- KB article suggestions
- Linked assets and changes
- Zendesk sync status badge
- Priority-based color coding

### Operations (Problems, Changes, Requests)
Unified view for ITIL processes:
- **Problems**: Root cause analysis, known error database, linked incidents
- **Changes**: CAB approval workflow, risk assessment, implementation planning
- **Requests**: Service fulfillment from catalog, approval routing

### AI Assist
Your AI co-pilot for IT support:
- **Chat**: Ask questions, get troubleshooting steps
- **Train AI**: Add custom knowledge for better answers
- **Upload**: Share documents for AI analysis
- **History**: Review past AI interactions

### Administration (Admin Only)
System configuration hub:
- **Users & RBAC**: Manage user accounts and role assignments
- **AI Settings**: Configure AI models and automation behavior
- **SLA Policies**: Set response and resolution targets
- **Escalation Rules**: Configure automatic escalation paths
- **Workflow Automation**: Manage WF001–WF009 rules
- **Vendor Management**: Vendor contacts and contracts
- **Integration Settings**: Configure Zendesk, M365, Meraki connections
- **System Health**: Server status, database health, API metrics
- **PDPA Dashboard**: Compliance status and data protection

---

## Vendor Management

Manage IT vendors and supplier contacts:
- Vendor name, contact person, email, phone
- Contract details and renewal dates
- Associated assets and services
- Performance tracking

---

## Customer Management

Track customer organizations:
- Company details and contacts
- Associated incidents and requests
- SLA agreements
- Zendesk organization sync

---

## Reports & Analytics

Generate and view ITSM reports:
- Incident trends (daily/weekly/monthly)
- SLA compliance by priority/team/category
- AI efficiency metrics (triage accuracy, automation rate)
- Team performance scorecards
- Customer satisfaction scores
- Export to PDF and CSV

---

## Tips & Best Practices

1. **Use AI Chat** for quick troubleshooting before creating a ticket
2. **Check KB** articles — many common issues have step-by-step solutions
3. **Set priority accurately** — it determines SLA targets and escalation
4. **Update tickets promptly** — keeps SLA calculations accurate
5. **Use the Service Catalog** for standard requests (faster routing)
6. **Review AI suggestions** — AI auto-suggests solutions but verify before applying

*Document Version: 4.3.0 | Last Updated: ${new Date().toLocaleDateString("en-SG")} | Classification: Internal*`
  },
];

async function main() {
  console.log(`\n=== VGC-ITSM KB Article Seeder ===`);
  console.log(`Posting ${articles.length} articles to ${BASE}/api/db/kb\n`);

  let ok = 0, fail = 0;
  for (const art of articles) {
    try {
      const res = await post("/api/db/kb", art);
      if (res.status === 200 && res.body?.ok) {
        console.log(`  ✅ ${art.id} — ${art.title.substring(0, 60)}...`);
        ok++;
      } else {
        console.log(`  ❌ ${art.id} — HTTP ${res.status}: ${JSON.stringify(res.body).substring(0, 100)}`);
        fail++;
      }
    } catch (err) {
      console.log(`  ❌ ${art.id} — Error: ${err.message}`);
      fail++;
    }
  }

  console.log(`\n=== Done: ${ok} succeeded, ${fail} failed ===`);

  // Verify
  try {
    const verifyRes = await new Promise((resolve, reject) => {
      https.get(`${BASE}/api/db/kb`, (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try { resolve(JSON.parse(buf)); } catch { resolve(buf); }
        });
      }).on("error", reject);
    });
    if (Array.isArray(verifyRes)) {
      console.log(`\n📚 Total KB articles in database: ${verifyRes.length}`);
      verifyRes.forEach(a => {
        const d = typeof a.data === "string" ? JSON.parse(a.data) : a;
        console.log(`   ${d.id} — ${(d.title || "").substring(0, 70)}`);
      });
    }
  } catch (e) {
    console.log(`\n⚠️  Verify failed: ${e.message}`);
  }
}

main().catch(console.error);
