# VGC-ITSM User Guide

**AI-Powered IT Service Management Platform**
*Version 1.0 · April 2026*

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Dashboard](#2-dashboard)
3. [Tickets Module](#3-tickets-module)
4. [Service Catalog](#4-service-catalog)
5. [Knowledge Portal](#5-knowledge-portal)
6. [Assets / CMDB](#6-assets--cmdb)
7. [SLA & Approvals](#7-sla--approvals)
8. [Analytics](#8-analytics)
9. [Customers](#9-customers)
10. [AI Assist](#10-ai-assist)
11. [Admin Settings](#11-admin-settings)
12. [Productivity](#12-productivity)
13. [Keyboard Shortcuts & Command Palette](#13-keyboard-shortcuts--command-palette)
14. [Recycle Bin](#14-recycle-bin)
15. [Frequently Asked Questions](#15-frequently-asked-questions)

---

## 1. Getting Started

### 1.1 Accessing the Application

Open your browser and navigate to:

```
https://vgc-itsm1-app.azurewebsites.net
```

You will see the login screen with three sign-in options:

| Login Method | Who It's For | Authentication |
|---|---|---|
| **VGC Admin (SSO)** | Tenant Administrators | Microsoft Entra ID Single Sign-On |
| **Engineer (SSO)** | L1/L2 Support Engineers | Microsoft Entra ID Single Sign-On |
| **Dev Admin (Local)** | Developer / System Admin | Username & Password |

#### SSO Sign-In (Recommended)
1. Click **Sign In with Microsoft** on the VGC Admin or Engineer card
2. Authenticate with your Microsoft 365 account
3. You will be redirected into the platform automatically

#### Local Sign-In (Dev Admin)
1. Enter your **Username** and **Password** in the Dev Admin card
2. Click **Sign In (Local)**

### 1.2 Navigation Overview

The platform uses a **left sidebar** for navigation. Modules are grouped into three sections:

| Section | Modules |
|---|---|
| **CORE** | Tickets, Service Catalog, Knowledge Portal, Assets / CMDB |
| **MONITORING** | SLA & Approvals, Analytics, Customers |
| **AI & SYSTEM** | AI Assist, Admin Settings, Productivity |

**Sidebar Controls:**
- Click the **collapse arrow** (◀) at the bottom of the sidebar to minimize it to icon-only mode
- Click any module icon or label to navigate

**Top Header Bar:**
- Displays current module name, global search, notification bell, and user avatar
- Click your avatar to open **My Profile**

---

## 2. Dashboard

The **Dashboard** is your command center — the first screen you see after login.

### 2.1 KPI Summary Cards (Top Row)

Six key performance indicators display real-time operational health:

| Card | Description | Color |
|---|---|---|
| **Total Incidents** | All incidents in the system | Red |
| **Open Tickets** | Tickets not yet resolved | Orange |
| **Avg Resolution** | Average time to resolve incidents | Blue |
| **SLA Compliance** | Percentage of tickets meeting SLA | Green |
| **AI Actions** | Total AI-assisted actions taken | Purple |
| **Active Assets** | Number of monitored assets | Cyan |

Each card shows a trend indicator (▲ up / ▼ down) comparing to the previous period.

### 2.2 System Health Weather

A visual weather indicator shows overall system health:
- ☀️ **Sunny** — All systems operational, SLA compliance high
- ⛅ **Cloudy** — Minor issues detected
- 🌧️ **Rainy** — Multiple open incidents
- ⛈️ **Stormy** — Critical incidents or SLA breaches

### 2.3 Donut Charts (Status Breakdown)

Six interactive donut charts provide at-a-glance status distribution:
- **Incidents by Status** — New, In Progress, Resolved, Closed
- **Incidents by Priority** — Sev-A (Critical), Sev-B, Sev-C, Sev-D
- **Problems** — By status
- **Changes** — By status
- **Service Requests** — By status
- **SLA Performance** — Met vs. Breached

Click any segment to filter the corresponding data.

### 2.4 Recent Activity & Team Workload

- **Recent Activity Timeline** — Live feed of latest actions (ticket creation, status changes, AI actions)
- **Team Workload** — Bar chart showing workload distribution across team members

### 2.5 Role-Based Dashboard

The dashboard adapts based on your role:
- **Management** roles see high-level KPIs, trends, and team performance
- **Engineer** roles see their assigned tickets, workload, and actionable tasks

---

## 3. Tickets Module

The Tickets module is the core of ITSM operations. It contains three sub-tabs:

### 3.1 Incidents Tab (🚨)

#### Viewing Incidents
- The incident list displays all tickets with columns: ID, Title, Status, Priority, Assignee, SLA, Created Date
- **Color-coded priority badges**: Sev-A (Red), Sev-B (Orange), Sev-C (Yellow), Sev-D (Green)
- **SLA indicators** flash when a ticket is approaching or has breached its SLA target
- Click any row to expand incident details

#### Creating a New Incident
1. Click the **+ New Incident** button (top right)
2. Fill in the form:
   - **Title** — Brief description of the issue
   - **Description** — Detailed information
   - **Priority** — Sev-A through Sev-D
   - **Category** — Network, Hardware, Software, Security, Access, Email, etc.
   - **Assignee** — Select team member
   - **Affected Asset** — Link to CMDB asset (optional)
   - **Customer** — Associated customer (optional)
3. Click **Create** to save

#### Incident Actions
- **Update Status** — Move through workflow: New → In Progress → Pending → Resolved → Closed
- **Add Notes** — Internal or public notes for communication
- **Escalate** — Promote to higher support tier
- **Link to Problem** — Associate with a root cause problem record
- **AI Triage** — Let AI analyze and suggest category, priority, and resolution

#### Incident Detail Panel
Click any incident to open the detail panel showing:
- Full description and metadata
- Activity timeline with all updates
- SLA countdown timer
- Linked problems, changes, and assets
- AI-suggested resolution (if available)

### 3.2 Zendesk AI Tab (🎫)

The Zendesk integration provides bidirectional ticket sync with AI-powered automation.

#### Connection Setup
1. The connection status banner shows whether Zendesk is connected
2. If not connected, configure credentials in **Admin Settings > Integrations**

#### Ticket Statistics
Four status cards at the top show:
- **Open** — Tickets awaiting action
- **Pending** — Tickets waiting on customer response
- **Hold** — Tickets temporarily paused
- **Solved** — Resolved tickets

Click any status card to filter the ticket list.

#### AI Auto-Triage
The AI engine automatically:
1. Categorizes incoming tickets by type (Network, Software, Hardware, etc.)
2. Assigns priority level (Sev-A through Sev-D)
3. Drafts response using knowledge base and historical patterns
4. Routes to the **Human Review Queue** for approval

#### Human Review Queue
- View AI-drafted responses before they are sent
- **Approve** — Send the AI draft as-is
- **Edit & Send** — Modify the draft before sending
- **Reject** — Discard the AI suggestion
- Confidence score shown for each draft (High ≥90%, Good 80-89%, Moderate 70-79%, Low <70%)

#### Historical Import
Import all past Zendesk tickets:
1. Click **📥 Import All Historical Tickets**
2. Progress bar shows imported/skipped/error counts
3. Imported tickets are mapped to ITSM incident format with priority, category, and SLA

#### Analytics Dashboard
The Zendesk analytics sub-tab shows:
- Category breakdown with bar charts
- Priority distribution
- AI confidence distribution
- Recent triage activity log

### 3.3 Operations Tab (⚙️)

Manages Problems, Changes, and Service Requests in a unified view.

#### Problems
- **Purpose:** Track root causes behind recurring incidents
- **Workflow:** New → Investigation → Root Cause Identified → Known Error → Resolved → Closed
- **Key fields:** Root Cause, Workaround, Known Error status, Linked Incidents

#### Changes
- **Purpose:** Manage planned changes to IT infrastructure
- **Workflow:** New → Pending Approval → Approved → Scheduled → Implementing → Completed → Closed
- **Key fields:** Change Type (Standard/Normal/Emergency), Risk Level, Implementation Plan, Rollback Plan, CAB Approval
- **CAB (Change Advisory Board):** Changes requiring approval appear in the Approvals module

#### Service Requests
- **Purpose:** Handle user service requests (new accounts, software installs, etc.)
- **Workflow:** Open → In Progress → Fulfilled → Closed
- **Key fields:** Request Type, Fulfillment Group, Due Date

---

## 4. Service Catalog

The Service Catalog presents available IT services that users can request.

### 4.1 Browsing Services
- Services are displayed in a card grid layout
- Each card shows: Service Name, Description, Category, SLA Target, and availability status
- Filter by category using the dropdown at the top

### 4.2 Requesting a Service
1. Click on a service card
2. Review the service description, delivery timeline, and SLA
3. Click **Request This Service**
4. Fill in required details and submit
5. A Service Request record is automatically created

### 4.3 Service Categories
Common categories include:
- 🖥️ Hardware — Laptop, monitor, peripheral requests
- 💻 Software — Application install, license requests
- 🔐 Access — Account creation, permission changes
- 📧 Email — Distribution lists, shared mailboxes
- 🌐 Network — VPN access, firewall changes
- ☁️ Cloud — Azure resource provisioning

---

## 5. Knowledge Portal

The Knowledge Portal (KB) is a searchable repository of IT solutions, how-to guides, and best practices.

### 5.1 Browsing Articles
- Articles are displayed in a card layout with title, category, and excerpt
- Search bar at the top for keyword search
- Filter by category tags

### 5.2 Article Content
Each article includes:
- **Title** and **Category** tag
- **Full content** with formatted text
- **Related incidents** — Links to incidents this article helped resolve
- **AI-generated** badge if the article was auto-created by the AI engine

### 5.3 Creating Articles
1. Click **+ New Article**
2. Enter Title, Category, and Content (supports rich text)
3. Add relevant tags for search discoverability
4. Click **Publish** to make it available to all users

### 5.4 AI Knowledge Extraction
The AI engine can automatically generate KB articles from resolved incidents:
- When an incident is resolved with a detailed resolution, AI suggests creating a KB article
- The article is drafted with problem description, solution steps, and prevention tips

---

## 6. Assets / CMDB

The Configuration Management Database (CMDB) tracks all IT assets and their relationships.

### 6.1 Asset Inventory
- View all hardware, software, and cloud assets in a table or grid layout
- Columns: Asset ID, Name, Type, Status, Location, Owner, Last Updated
- Search and filter by type (Server, Workstation, Network Device, Software, Cloud Resource)

### 6.2 Asset Details
Click any asset to view:
- Full specifications (model, serial number, OS, IP address)
- Ownership and location history
- Linked incidents — Issues related to this asset
- Warranty and lifecycle information
- Network topology connections (for network devices)

### 6.3 Asset Types
| Type | Examples |
|---|---|
| **Servers** | Azure VMs, on-premises servers |
| **Workstations** | Laptops, desktops |
| **Network** | Switches, routers, firewalls, access points |
| **Software** | Licenses, subscriptions |
| **Cloud** | Azure resources, SaaS subscriptions |
| **Mobile** | Company phones, tablets |

### 6.4 Integration with Monitoring
- **N-able RMM** — Pulls real-time device status, alerts, and patch compliance
- **Meraki** — Network device health and connectivity
- **Sophos** — Endpoint security status

---

## 7. SLA & Approvals

### 7.1 SLA Tracker (⏱️)

The SLA Tracker monitors service level agreements across all ticket types.

#### SLA Dashboard
- **Overall SLA Compliance** — Percentage gauge showing met vs. breached
- **By Priority** — SLA performance per priority level
- **Approaching Breach** — Tickets nearing their SLA deadline (highlighted in amber)
- **Breached** — Tickets that have exceeded their SLA target (highlighted in red)

#### SLA Targets
| Priority | Response Time | Resolution Time |
|---|---|---|
| **Sev-A (Critical)** | 15 minutes | 4 hours |
| **Sev-B (High)** | 30 minutes | 8 hours |
| **Sev-C (Medium)** | 2 hours | 24 hours |
| **Sev-D (Low)** | 4 hours | 48 hours |

#### SLA Alerts
- Blinking amber badge when a ticket is within 20% of SLA deadline
- Red alert with animation when SLA is breached
- Automatic escalation notification for breached Sev-A tickets

### 7.2 Approvals (✅)

The Approvals module manages pending approval requests for changes and service requests.

#### Approval Workflow
1. A Change or Service Request requiring approval appears in the queue
2. Reviewer sees: Request details, Risk assessment, Implementation plan, Requestor information
3. Actions available:
   - **✅ Approve** — Allow the change/request to proceed
   - **❌ Reject** — Deny with reason
   - **↩ Return** — Send back for more information

#### CAB (Change Advisory Board) Approvals
- Normal and Emergency changes require CAB review
- Multiple approvers can be assigned
- Approval chain shows who has approved and who is pending

---

## 8. Analytics

The Analytics module provides comprehensive reporting and intelligence. It has three sub-tabs:

### 8.1 Reports (📊)

#### Service Reports
- Generate reports on incident trends, resolution times, SLA compliance, and team performance
- Reports can be in **Draft** or **Published** status
- Export capabilities for management review

#### Key Metrics
- Incident volume over time (line chart)
- Mean Time to Resolution (MTTR) by category
- Top incident categories (bar chart)
- Team performance comparison
- Customer satisfaction trends

### 8.2 Cyber News (🛡️)

The **Threat Intelligence Feed** keeps your team updated on the latest cybersecurity threats.

#### Threat Feed
- Live feed of security advisories from industry sources
- Each threat card shows:
  - **Severity** — Critical, High, Medium, Low
  - **CVE ID** — Common Vulnerabilities and Exposures identifier
  - **CVSS Score** — Severity rating (0-10 scale)
  - **AI Threat Analysis** — AI-generated impact summary
  - **Affects Us** badge — Highlights threats relevant to your infrastructure

#### Emergency Actions
- Critical and High severity threats that affect your systems are flagged
- Actionable next steps are provided with checkboxes to track progress
- One-click email draft to notify your team

#### Response Tracker
- Track response status for each threat: Open → Acknowledged → In Progress → Mitigated → Closed
- Step-by-step progress tracking for remediation actions

#### IoC Database
- Indicators of Compromise database with affected systems
- References to NVD, vendor advisories, and security bulletins

### 8.3 Architecture (🏗️)

Interactive system architecture diagram showing:
- **Frontend Layer** — React SPA, MSAL Auth, Dark UI
- **API Layer** — REST API, Graph API, Zendesk API
- **Service Layer** — AI Engine, Workflow Engine, SLA Monitor
- **Data Layer** — MySQL Database, Local Cache, Audit Log
- **Cloud Infrastructure** — Azure App Service, Entra ID, Monitor

Click any layer to see detailed technology information.

---

## 9. Customers

### 9.1 Customer List
- View all customers in a table with: Name, Contact, Status, Total Tickets, SLA Tier
- **Active** customers shown with green badge, **Inactive** with gray
- Search and filter by status or name

### 9.2 Customer Details
Click a customer to view:
- Contact information (name, email, phone, company)
- Associated incidents and ticket history
- SLA tier and compliance metrics
- Vendor assignments

### 9.3 Managing Customers
- **Add Customer** — Click **+ New Customer** and fill in details
- **Edit Customer** — Click edit icon on any customer record
- **Delete Customer** — Deleted customers move to the **Recycle Bin** (can be restored)

### 9.4 Vendor Management
- Manage IT vendors and service providers
- Track vendor contacts, contracts, and service categories
- Link vendors to specific assets or service catalog items

---

## 10. AI Assist

The AI Assist module is powered by **Azure OpenAI (GPT-5.4-nano)** and provides intelligent automation.

### 10.1 AI Chat Assistant
- Access via the **floating AI button** (bottom-right corner) or the AI Assist sidebar module
- Ask natural language questions like:
  - *"What are the top 5 incidents this week?"*
  - *"Suggest a resolution for VPN connectivity issues"*
  - *"Draft a KB article about password reset procedures"*
- AI responds with contextual answers using your ITSM data

### 10.2 AI Actions & Approvals
View all AI-performed actions:
- Auto-triage results
- Draft responses generated
- Knowledge articles suggested
- Pattern detection alerts

### 10.3 AI Patterns
The AI engine detects patterns across your incident data:
- Recurring issues by category
- Time-based patterns (peak hours, seasonal trends)
- Correlation between assets and incident types
- Proactive recommendations to prevent future issues

### 10.4 AI Capabilities Summary
| Capability | Description |
|---|---|
| **Auto-Triage** | Categorizes and prioritizes incoming tickets |
| **Draft Response** | Generates response using KB and historical data |
| **Knowledge Extraction** | Creates KB articles from resolved incidents |
| **Pattern Detection** | Identifies recurring issues and trends |
| **Threat Analysis** | Summarizes cybersecurity threat impact |
| **Proactive Alerts** | Suggests preventive actions |

---

## 11. Admin Settings

The Admin Settings module provides system configuration across multiple tabs:

### 11.1 General Settings
- **Tenant Configuration** — Organization name, timezone (Asia/Singapore), date format
- **Feature Toggles** — Enable/disable modules and features
- **Theme & Branding** — Logo, color scheme (dark theme)

### 11.2 User Management
- View and manage all platform users
- Assign RBAC roles: VGC Dev Admin, Tenant Admin, Administrator, Service Desk Lead, L1/L2 Support Engineer, Network Engineer, Change Manager, Problem Manager, Asset Manager
- Entra ID sync status for SSO users

### 11.3 Notifications
- Configure notification rules by event type
- Channel options: Email, Microsoft Teams, SMS
- Delivery timing: Immediate, Scheduled (e.g., 08:00 SGT digest)
- Rules include: SLA Breach Warning, Incident Escalation, Change Approved, Security Critical Alert, Daily Summary Digest

### 11.4 Email / SMTP
- **SMTP Configuration** — Host, port, encryption (STARTTLS/SSL), authentication
- **Sender Identity** — From name, from email, reply-to address
- **Email Signature** — HTML signature with live preview
- **Email Templates** — Customize templates for incident created, resolved, SLA breach, etc.
- **Test Connection** — Verify SMTP settings before going live

### 11.5 Workflow Automation
- Define workflow rules for automated actions
- Trigger types: On ticket creation, status change, SLA threshold, priority change
- Actions: Auto-assign, escalate, send notification, update field, create sub-task

### 11.6 Integrations
Configure external service connections:

| Integration | Purpose | Status |
|---|---|---|
| **Zendesk** | Helpdesk ticket sync | ✅ Connected |
| **N-able RMM** | Remote monitoring & management | ✅ Connected (Asia) |
| **Meraki** | Network infrastructure monitoring | ✅ Configured |
| **Sophos** | Endpoint security | ✅ Configured |
| **Microsoft Graph** | Email, calendar, Teams | ✅ Configured |
| **Azure OpenAI** | AI engine (GPT-5.4-nano) | ✅ Active |

### 11.7 Surveys
- Create and manage customer satisfaction surveys
- Survey templates with customizable questions
- Link surveys to resolved incidents for feedback collection

### 11.8 Business Impact
- **KPI Cards** (4-column grid):
  - Estimated Downtime Cost
  - AI Cost Savings
  - Average Cost per Ticket
  - Productivity Hours Saved
- **Weekly Case Volume Trend** — Bar chart showing ticket volume by week

### 11.9 Vendor Contacts
- Manage vendor directory with contact details
- Categorize by service type (Cloud, Security, Network, Hardware)
- Quick-access contact cards for emergency situations

### 11.10 Import & Migration
- Import data from other ITSM platforms: ServiceNow, Zendesk, Jira Service Management, Freshservice, ManageEngine
- Custom CSV/JSON import support
- Field mapping preview with source-to-target field configuration
- Data types: Incidents, Problems, Changes, Service Requests, Assets, Users, KB Articles, SLA Policies

### 11.11 API Configuration
- **API Endpoint** — REST API for programmatic access
- **API Key Management** — Generate and regenerate API keys
- **Webhooks** — Configure outbound webhooks for events (incident.created, change.approved, sla.breach)
- **Rate Limit** — 1000 requests per minute

---

## 12. Productivity

The Productivity module integrates with Microsoft 365 for unified workplace management.

### 12.1 Overview Tab (🏠)

#### Smart Task Scheduler
- Create recurring IT tasks (Daily, Weekly, Bi-weekly, Monthly)
- Visual calendar showing task due dates
- Tasks color-coded by recurrence schedule
- Overdue tasks highlighted in red with priority badges

#### Task Management
- **Add Task** — Set title, description, due date, recurrence, and assignee
- **Complete Task** — Mark tasks as done with timestamp
- **Reschedule** — Drag or edit to change due date

#### AI Daily Guidance
Three AI-generated insight cards:
- **🎯 Priority Focus** — What to work on first today
- **📊 Productivity Insight** — Completion stats and momentum tracking
- **💡 AI Recommendation** — Suggested improvements and automation tips

### 12.2 Outlook Tab (📧)

#### Inbox Preview
- View latest emails with unread indicators
- Sender name, subject line, timestamp
- Click to open in Outlook Web
- Shows live data when authenticated via Microsoft Graph API

#### Calendar Preview
- Today's meetings and events with color-coded time blocks
- Online meeting status indicator (🟢 Online / 🏢 In-Person)
- Join meeting links for Microsoft Teams calls

### 12.3 Teams Tab (💬)

- Microsoft Teams channel overview
- Recent conversations and mentions
- Quick links to active team channels

### 12.4 Tasks Tab (📋)

- Microsoft To-Do integration
- Task lists with completion tracking
- Priority-based task ordering

---

## 13. Keyboard Shortcuts & Command Palette

### 13.1 Command Palette (Ctrl+K)

Press **Ctrl+K** anywhere in the application to open the Command Palette — a quick-action search dialog.

Available commands:
| Command | Action |
|---|---|
| **New Incident** | Opens the create incident form |
| **New Problem** | Opens the create problem form |
| **New Change Request** | Opens the create change form |
| **Go to Dashboard** | Navigate to Dashboard |
| **Go to Tickets** | Navigate to Tickets |
| **Go to Assets** | Navigate to Assets / CMDB |
| **Go to Knowledge Base** | Navigate to Knowledge Portal |
| **Go to Settings** | Navigate to Admin Settings |
| **Open AI Assistant** | Opens the AI chat panel |
| **AI Actions & Approvals** | Opens the AI actions review panel |
| **Go to Zendesk** | Navigate to Zendesk AI tab |
| **Go to Service Reports** | Navigate to Reports |
| **Open Recycle Bin** | Opens the deleted items bin |
| **Go to Email Intelligence** | Navigate to Email module |

**Usage:**
1. Press **Ctrl+K**
2. Start typing a command name
3. Press **Enter** to execute the highlighted command
4. Press **Esc** to close

---

## 14. Recycle Bin

The Recycle Bin provides a safety net for deleted items.

### 14.1 How It Works
- When you delete a customer, vendor, workflow rule, KB article, or other managed item, it moves to the Recycle Bin instead of being permanently deleted
- Items are stored with metadata: who deleted it, when, and the item type
- Auto-expires after 100 items (oldest items removed first)

### 14.2 Restoring Items
1. Click the **🗑️ Recycle Bin** icon in the top header bar (or use Command Palette)
2. Find the deleted item in the list
3. Click **↩ Restore** to bring it back to its original location

### 14.3 Permanent Deletion
- Click **✕ Delete** on an individual item to permanently remove it
- Click **🗑️ Empty All** to permanently delete everything in the Recycle Bin
- ⚠️ Permanent deletion cannot be undone

### 14.4 Supported Item Types
| Type | Icon |
|---|---|
| Customers | 🏢 |
| Vendors | 🏭 |
| Workflow Rules | ⚙️ |
| Managed Users | 👤 |
| KB Articles | 📚 |
| Service Reports | 📋 |
| Service Catalog Items | 📦 |
| Survey Templates | 📄 |

---

## 15. Frequently Asked Questions

### Q: How do I change my profile photo?
Navigate to **My Profile** (click your avatar in the top-right) and use the Photo Section to upload a new image. Entra ID synced users will see their Microsoft 365 photo automatically.

### Q: What happens when an SLA is breached?
The system automatically:
1. Highlights the ticket in red with a blinking SLA badge
2. Sends an escalation notification to the assigned team lead
3. Logs the breach in the audit trail
4. Updates the SLA compliance dashboard metrics

### Q: Can I use the app on mobile?
Yes. The interface is responsive with breakpoints at 1024px, 768px, and 480px. On mobile devices, the sidebar auto-collapses and KPI grids stack vertically.

### Q: How does the AI auto-triage work?
1. A new Zendesk ticket is received
2. The AI engine (GPT-5.4-nano) analyzes the ticket content
3. It assigns: Category, Priority, Suggested Tags, and Draft Response
4. The draft is placed in the **Human Review Queue** with a confidence score
5. A human reviewer approves, edits, or rejects the draft
6. If approved, the response is sent to the customer and an ITSM incident is created

### Q: How do I connect N-able RMM?
1. Go to **Admin Settings > Integrations**
2. Enter your N-able API Key and Host (e.g., `wwwasia.system-monitor.com`)
3. Click **Test Connection** — should show "Authenticated successfully"
4. N-able device data will appear in the Assets / CMDB module

### Q: Is my data secure?
Yes. The platform includes:
- **Microsoft Entra ID** SSO authentication
- **Role-Based Access Control (RBAC)** with 10+ roles
- **Audit logging** for all data changes
- **SPA security** — Path traversal attempts return the app shell, not server files
- **Data isolation** — Demo mode users cannot access production data
- All API communications use **HTTPS/TLS**

### Q: How do I export data?
Use the **Reports** section under Analytics to generate and export reports. For raw data, use the **API** configuration in Admin Settings to access data programmatically.

### Q: What integrations are supported?
| Service | Type | Data Flow |
|---|---|---|
| Zendesk | Helpdesk | Bidirectional ticket sync |
| N-able RMM | Monitoring | Device status, alerts, patches |
| Meraki | Network | Device health, connectivity |
| Sophos | Security | Endpoint protection status |
| Microsoft Graph | Productivity | Email, calendar, Teams, users |
| Azure OpenAI | AI | Triage, drafting, analysis |

---

## Support & Contact

- **Application URL:** https://vgc-itsm1-app.azurewebsites.net
- **IT Support Email:** itsupport@vgctechnology.com
- **Platform:** Azure App Service (Node.js 20 + React 19)
- **AI Engine:** Azure OpenAI GPT-5.4-nano

---

*© 2026 VGC Technology Pte Ltd. All rights reserved.*
*This guide is for internal use only. Do not distribute externally.*
