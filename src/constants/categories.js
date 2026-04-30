// ─── Security Alert Data (app-level) ─────────────────────────────────────
export const SECURITY_ALERTS = [];

export const CATEGORIES = ["Network", "Hardware", "Software", "Security", "Email", "Access/Identity", "Cloud", "Printing", "End User Computing", "Service Request", "General"];
export const SERVICES = [
  // ── Access & Identity ──
  { id: "SVC01", name: "Password Reset", category: "Access", sla: 4, icon: "🔑", description: "Reset Active Directory / M365 / VPN passwords. Includes MFA re-enrollment if needed.", aiExplain: "Submit this when a user is locked out or forgot their password. AI will verify identity via email and reset within SLA. Covers AD, M365, VPN, and app-specific credentials." },
  { id: "SVC09", name: "New User Onboarding", category: "Access", sla: 24, icon: "👤", description: "Full onboarding: AD account, M365 license, email, security groups, laptop setup, VPN access.", aiExplain: "Request this for new joiners. AI creates a checklist covering AD account, M365 license assignment, email setup, security group membership, laptop provisioning, VPN config, and orientation docs. Typically 1 business day." },
  { id: "SVC10", name: "User Offboarding", category: "Access", sla: 8, icon: "🚪", description: "Disable account, revoke access, transfer mailbox, backup OneDrive, collect assets.", aiExplain: "Submit when an employee leaves. AI triggers a multi-step offboarding: disable AD account, revoke MFA, forward email, backup OneDrive, revoke app access, and notify asset recovery. PDPA-compliant data handling." },
  { id: "SVC11", name: "Permission / Group Change", category: "Access", sla: 8, icon: "🔐", description: "Add or remove user from security groups, SharePoint sites, shared mailboxes, or Teams.", aiExplain: "Use this to modify access rights. Specify the user, target resource (SharePoint site, shared mailbox, Teams channel, file share), and whether to add or remove. Requires manager approval for sensitive groups." },
  { id: "SVC12", name: "MFA Reset / Enrollment", category: "Access", sla: 4, icon: "📱", description: "Re-enroll or reset Multi-Factor Authentication for Microsoft 365 or VPN.", aiExplain: "For users who lost their MFA device or need to switch methods. Identity verification required. AI will guide through re-enrollment with Microsoft Authenticator, SMS, or hardware token options." },

  // ── Hardware & Devices ──
  { id: "SVC02", name: "New Laptop Request", category: "Hardware", sla: 72, icon: "💻", description: "Request a new laptop with standard SOE build including M365, VPN, and security software.", aiExplain: "Submit for new or replacement laptops. Includes standard SOE image with Windows 11, M365, FortiClient VPN, CrowdStrike, and department-specific software. Dell ProSupport warranty included. Allow 3 business days." },
  { id: "SVC13", name: "Monitor / Peripheral Request", category: "Hardware", sla: 48, icon: "🖥️", description: "Request monitors, keyboards, mice, headsets, docking stations, or webcams.", aiExplain: "For additional or replacement peripherals. Standard options: Dell 27\" monitor, Logitech MK850 keyboard/mouse, Jabra Evolve2 headset. Submit with desk/location details for delivery." },
  { id: "SVC14", name: "Mobile Device Setup", category: "Hardware", sla: 24, icon: "📲", description: "Enroll company or BYOD mobile device into Intune MDM with email and Teams.", aiExplain: "For setting up work email and Teams on phones/tablets. Covers Intune enrollment, Outlook configuration, Teams install, and compliance policy. BYOD devices get Company Portal with managed app protection." },
  { id: "SVC15", name: "Printer Setup / Issue", category: "Hardware", sla: 12, icon: "🖨️", description: "Install network printer, fix print queue, driver issues, or paper jams.", aiExplain: "Submit for any printing issues. AI will first attempt remote fix (clear print queue, reinstall driver). If hardware issue, engineer dispatched. Covers network printers, local USB printers, and print server queues." },
  { id: "SVC16", name: "Hardware Repair / Warranty", category: "Hardware", sla: 48, icon: "🔧", description: "Report hardware fault for warranty repair: screen, keyboard, battery, docking station.", aiExplain: "For broken hardware under warranty. Provide asset tag and fault description. AI checks Dell TechDirect warranty status automatically and initiates repair case. ProSupport Plus includes next-business-day onsite." },

  // ── Software & Applications ──
  { id: "SVC03", name: "Software Installation", category: "Software", sla: 24, icon: "📦", description: "Install approved software from the company catalog via Intune or manual deployment.", aiExplain: "Request installation of approved applications. Standard catalog includes Adobe Acrobat, 7-Zip, Zoom, Slack, VS Code, Power BI Desktop. Non-standard software requires IT security review (add 24h)." },
  { id: "SVC17", name: "Software License Request", category: "Software", sla: 24, icon: "🏷️", description: "Request new or additional software licenses: M365, Adobe, Visio, Project, AutoCAD.", aiExplain: "For new license allocation or upgrades. AI checks current license pool availability. Common requests: M365 E3→E5, Visio Plan 2, Project Plan 3, Adobe Creative Cloud. Requires manager cost-center approval." },
  { id: "SVC18", name: "Application Access Request", category: "Software", sla: 12, icon: "🔓", description: "Request access to business applications: ERP, CRM, HRMS, finance systems.", aiExplain: "For access to line-of-business apps. Specify the application, access level (read/write/admin), and business justification. AI routes to app owner for approval. Common apps: SAP, Salesforce, Workday, NetSuite." },
  { id: "SVC19", name: "Software Update / Patch", category: "Software", sla: 24, icon: "🔄", description: "Request OS or application updates, security patches, or version upgrades.", aiExplain: "For updating software outside the normal patch cycle. AI checks compatibility and schedules deployment via Intune. Critical security patches are fast-tracked. Includes testing window for business-critical apps." },

  // ── Network & Connectivity ──
  { id: "SVC04", name: "VPN Access Setup", category: "Network", sla: 8, icon: "🌐", description: "Configure FortiClient VPN for remote access including split-tunnel and MFA.", aiExplain: "For new VPN access or troubleshooting. AI configures FortiClient with company profile, sets up split-tunnel routing, and enables MFA. Includes backup SSL VPN portal access. Test connection before closing." },
  { id: "SVC20", name: "Network Connectivity Issue", category: "Network", sla: 8, icon: "📡", description: "Report WiFi, LAN, or internet connectivity problems at office or remote.", aiExplain: "For any connectivity issues. AI runs remote diagnostics: ping, traceroute, DNS lookup, DHCP check. If remote, guides through router restart and config check. If office, checks switch port and VLAN assignment." },
  { id: "SVC21", name: "Firewall Rule Request", category: "Network", sla: 24, icon: "🧱", description: "Request new firewall rule or port opening on FortiGate for application or service.", aiExplain: "For opening ports or creating firewall rules. Requires source IP/network, destination, port/protocol, and business justification. AI performs risk assessment and routes to network security team. Change request auto-created." },
  { id: "SVC22", name: "WiFi Access / Guest WiFi", category: "Network", sla: 4, icon: "📶", description: "Request WiFi access for new devices or set up guest WiFi for visitors.", aiExplain: "For connecting new devices to corporate WiFi (802.1X cert-based) or creating temporary guest WiFi credentials. Guest access expires in 24h by default. Specify visitor name and duration for extended access." },

  // ── Email & Communication ──
  { id: "SVC05", name: "Email Distribution List", category: "Email", sla: 12, icon: "📧", description: "Create, modify, or delete email distribution lists and shared mailboxes.", aiExplain: "For managing email groups. AI creates the DL in Exchange Online, sets membership, and configures send-as/send-on-behalf permissions. Specify: DL name, email address, members, and whether external senders allowed." },
  { id: "SVC23", name: "Shared Mailbox Setup", category: "Email", sla: 12, icon: "📬", description: "Create shared mailbox for team/project with access permissions and auto-reply.", aiExplain: "For team mailboxes like support@, sales@, hr@. AI creates in Exchange Online, grants Full Access and Send As to specified users, configures auto-reply template if needed. No license required for shared mailboxes." },
  { id: "SVC24", name: "Email Signature Update", category: "Email", sla: 8, icon: "✍️", description: "Update email signature template company-wide or for specific users/departments.", aiExplain: "For updating standardized email signatures. AI applies the VGC branding template with name, title, phone, and legal disclaimer. Can deploy via Outlook policy for consistency across the organization." },
  { id: "SVC25", name: "Teams Channel / Team Setup", category: "Email", sla: 8, icon: "💬", description: "Create new Microsoft Teams team, channels, or configure settings and permissions.", aiExplain: "For setting up Teams workspaces. AI creates the team, adds standard channels (General, Announcements, Files), sets membership, and configures guest access policy. Includes SharePoint site auto-provisioning." },

  // ── Cloud & Infrastructure ──
  { id: "SVC06", name: "Cloud Storage Upgrade", category: "Cloud", sla: 24, icon: "☁️", description: "Increase OneDrive, SharePoint, or Azure storage quotas for users or sites.", aiExplain: "For additional cloud storage. Standard OneDrive quota: 1TB per user. AI checks current usage and provisions additional storage. For SharePoint sites, increases site collection quota. Azure Blob requests go to cloud team." },
  { id: "SVC26", name: "SharePoint Site Request", category: "Cloud", sla: 24, icon: "📂", description: "Create new SharePoint site for team, project, or department with permissions.", aiExplain: "For new SharePoint sites. AI provisions a Team Site or Communication Site, configures permissions (Owners, Members, Visitors), sets up document libraries, and applies company branding template." },
  { id: "SVC27", name: "Azure Resource Provisioning", category: "Cloud", sla: 48, icon: "⚡", description: "Provision Azure VMs, databases, storage accounts, or web apps.", aiExplain: "For Azure infrastructure requests. Specify resource type, size/tier, region (default: Southeast Asia), and purpose. AI creates a change request for CAB review. Includes cost estimate and security baseline configuration." },
  { id: "SVC28", name: "Backup & Restore Request", category: "Cloud", sla: 12, icon: "💾", description: "Request file/folder restore from backup, or configure new backup policy.", aiExplain: "For data recovery or backup configuration. AI checks Azure Backup vault for available restore points. Specify what to restore (files, VM, database) and target date/time. RPO and RTO details provided automatically." },

  // ── Security ──
  { id: "SVC07", name: "Security Badge Request", category: "Security", sla: 48, icon: "🛡️", description: "Request new or replacement physical security badge for office access.", aiExplain: "For office access badges. New badges require manager approval and photo. Replacement badges for lost/damaged: report immediately for security lockout of old badge. Temporary visitor badges available at reception." },
  { id: "SVC29", name: "Security Incident Report", category: "Security", sla: 4, icon: "🚨", description: "Report phishing, malware, data breach, unauthorized access, or suspicious activity.", aiExplain: "For reporting security events. AI escalates immediately for Sev-A/B incidents. Includes: isolate affected systems, preserve evidence, notify CISO, initiate incident response plan. Follow ISO 27001 procedures." },
  { id: "SVC30", name: "USB / External Device Policy", category: "Security", sla: 12, icon: "🔒", description: "Request USB device authorization or external storage exception with justification.", aiExplain: "USB storage is blocked by default policy. Submit with business justification for temporary exception. AI creates time-limited Intune policy exception (max 7 days). Requires manager and security team approval." },
  { id: "SVC31", name: "SSL Certificate Request", category: "Security", sla: 48, icon: "🔏", description: "Request new SSL/TLS certificate for web applications, APIs, or internal services.", aiExplain: "For SSL certificate provisioning. AI supports Let's Encrypt (auto-renewal), DigiCert, and internal CA certificates. Specify domain(s), certificate type (DV/OV/EV), and target server. Auto-creates change request." },

  // ── Database ──
  { id: "SVC08", name: "Database Access", category: "Database", sla: 24, icon: "🗄️", description: "Request read or write access to SQL Server, Azure SQL, or other databases.", aiExplain: "For database access provisioning. Specify server, database name, and access level (read-only, read-write, DBA). AI checks with data owner for approval. Includes connection string and SSMS/Azure Data Studio setup guide." },
  { id: "SVC32", name: "Database Performance Issue", category: "Database", sla: 8, icon: "📊", description: "Report slow queries, deadlocks, high CPU, or storage issues on databases.", aiExplain: "For database performance problems. AI analyzes recent query execution plans, index usage stats, and resource metrics. Provides recommendations: missing indexes, query optimization, resource scaling. For Azure SQL, checks DTU/vCore utilization." },

  // ── Reporting & Analytics ──
  { id: "SVC33", name: "Power BI Report Request", category: "Analytics", sla: 48, icon: "📈", description: "Request new Power BI dashboard, report, or data source connection.", aiExplain: "For business intelligence requests. Specify data source, KPIs, refresh schedule, and audience. AI creates a workspace, configures data gateway if on-prem, and sets up row-level security. Training provided on report usage." },
  { id: "SVC34", name: "Data Export / Extract", category: "Analytics", sla: 24, icon: "📤", description: "Request data export from systems for reporting, audit, or migration purposes.", aiExplain: "For exporting data from business systems. AI validates PDPA compliance, applies data masking for sensitive fields, and generates export in requested format (CSV, Excel, JSON). Audit trail recorded automatically." },

  // ── Meeting Room & Facilities ──
  { id: "SVC35", name: "Meeting Room AV Setup", category: "Facilities", sla: 4, icon: "🎥", description: "Set up video conferencing, projector, or audio equipment in meeting rooms.", aiExplain: "For meeting room technology support. AI checks room booking system, verifies Teams Room device status, and dispatches engineer if hardware issue. Covers: projector, Poly video bars, wireless presentation, and audio systems." },
  { id: "SVC36", name: "Desk / Workspace Setup", category: "Facilities", sla: 24, icon: "🪑", description: "Request desk setup with monitors, docking station, keyboard, mouse, and phone.", aiExplain: "For new or relocated workspaces. Standard setup: 2x Dell 27\" monitors, Dell WD19S dock, Logitech keyboard/mouse, IP phone. AI coordinates with facilities for desk assignment and IT for equipment delivery." },
];

// AI Feature Explainer lookup — maps feature/card IDs to AI explanations

// AI Feature Explainer lookup
export const AI_FEATURE_EXPLAINERS = {
  // Dashboard
  execKpis: { title: "Executive KPIs", explain: "Real-time overview of your ITSM health. Total Cases, Open Cases, SLA Compliance, MTTR (Mean Time To Resolve), Resolution Rate, and AI Triaged percentage — all computed live from your incident data and Zendesk sync. Click any KPI to jump to the relevant module." },
  zdSync: { title: "Zendesk ↔ ITSM Sync", explain: "Shows live bidirectional sync between Zendesk and ITSM. Auto-syncs every 60 seconds. Displays Zendesk ticket counts (Open/Pending/Hold/Solved) alongside ITSM totals. The 'Unlinked' warning means Zendesk tickets exist that haven't been imported to ITSM yet — click 'Import' to bring them in." },
  caseAnalysis: { title: "Case Analysis", explain: "Breaks down your incidents by category (Email, Network, Hardware, etc.) with visual bars. Helps identify which areas generate the most tickets so you can focus training, KB articles, or infrastructure improvements on high-volume categories." },
  priorityDist: { title: "Priority Distribution", explain: "Shows how your open tickets are distributed across severity levels (Sev-A Critical to Sev-D Low). A healthy distribution has most tickets at Sev-C/D. Too many Sev-A/B tickets may indicate systemic issues requiring Problem Management." },
  slaStatus: { title: "SLA Compliance", explain: "Tracks which tickets are within SLA, approaching breach, or already breached. Green = on track, Yellow = >75% of SLA consumed, Red = breached. Click to see the full SLA module with detailed timelines and escalation status." },
  businessImpact: { title: "Business Impact", explain: "Estimates the financial impact of IT incidents: total revenue at risk from open tickets, cost savings from AI automation, cost-per-ticket, and time saved by AI triage. Values are computed from your actual incident data." },
  // Modules
  incidents: { title: "Incidents Module", explain: "Your central incident management hub. Create, track, and resolve IT incidents. Each incident shows priority, SLA countdown, assignee, and AI triage status. Zendesk-linked incidents show a 'ZD' badge. Click any row to see full details, activity log, and AI recommendations." },
  operations: { title: "Operations Module", explain: "Unified view of Problems, Changes, and Service Requests. Problems track root causes affecting multiple incidents. Changes follow ITIL change management with CAB approval. Requests are service fulfillment tasks. Cross-referenced with Zendesk data automatically." },
  catalog: { title: "Service Catalog", explain: "Self-service portal where users can request IT services. Each card shows the service name, category, SLA target, and a description. Click 'Request →' to submit. Services are organized by category and based on common Zendesk ticket patterns." },
  knowledge: { title: "Knowledge Base", explain: "SharePoint-connected knowledge portal. Articles are organized by category with Quick Fix steps, related articles, and AI recommendations. When an incident matches a KB article, AI automatically suggests it. Engineers can create new articles from resolved incidents." },
  sla: { title: "SLA Management", explain: "Tracks SLA compliance for all tickets against VGC's official SLA policy. Shows response times, resolution targets, and breach alerts. SLA countdown pauses outside business hours (Mon-Fri 9AM-6PM SGT) and when ticket status is Pending or On Hold. Auto-escalation triggers when thresholds are exceeded." },
  ai: { title: "AI Assist", explain: "Your AI co-pilot dashboard. Shows automation rates, AI activity log, confidence scores, and the AI chat interface. Primary engine: VGC-AI Engine. Fallback: Local AI. Use 'Train AI' to add internal knowledge that AI references first when answering questions." },
  zendesk: { title: "Zendesk AI Command Center", explain: "Full Zendesk integration hub. Auto-triage incoming tickets using AI, manage the approval queue (human-in-the-loop), view real-time ticket sync, run historical imports, and configure automation rules. All AI actions require your approval before execution." },
  reports: { title: "Reports & Analytics", explain: "Generate and view ITSM reports: incident trends, SLA compliance, team performance, category breakdown, and AI efficiency metrics. Export to PDF or share via email. Data updates in real-time from all integrated sources." },
  admin: { title: "Administration", explain: "System configuration hub. Manage users & RBAC roles, VGC-AI Engine settings, SLA policies, escalation rules, workflow automation, vendor contacts, and system integrations. Only accessible to Admin and VGC Dev Admin roles." },
  assets: { title: "Asset Management", explain: "CMDB for tracking IT assets: laptops, servers, network devices, licenses. Each asset links to incidents, changes, and users. Supports lifecycle management from procurement to decommission. Auto-discovery integrates with Intune and Azure AD." },
  customers: { title: "Customer Management", explain: "Zendesk-sourced customer directory. Organizations from Zendesk are auto-synced every 60 seconds to keep your ITSM customer list up to date. Links customers to incidents, service requests, and SLA agreements. Supports manual entry and Zendesk org sync." },
  cybernews: { title: "Cyber Threat Intelligence", explain: "Real-time security alerts and vulnerability feeds. AI analyzes threats for relevance to your infrastructure, provides risk ratings, and suggests remediation steps. Critical threats trigger automatic notifications to the security team." },
  productivity: { title: "Microsoft 365 Hub", explain: "Integrated view of Outlook, Teams, and Microsoft 365 tools. AI can summarize email threads, flag urgent messages, draft replies, and monitor Teams channels for critical mentions. All within the ITSM interface." },
  approvals: { title: "Approvals Queue", explain: "Central approval workflow for changes, requests, and escalations. Shows pending items requiring your approval with risk assessment and AI recommendations. Approve, reject, or request more info — all tracked with full audit trail." },
  // Workflows
  workflows: { title: "Workflow Automation", explain: "Automated rules that trigger actions based on conditions. Examples: auto-escalate Sev-A incidents after 15min, auto-approve low-risk changes, SLA breach alerts. AI can suggest new rules based on your ticket patterns. All rules are auditable." },
};


export const ASSETS = [];


// ─── SharePoint Knowledge Portal Config ─────────────────────────────
export const SHAREPOINT_KB_CONFIG = {
  tenantUrl: "https://vgctechnologysg.sharepoint.com",
  siteUrl: "/sites/Helpdesk",
  docLibrary: "/Shared%20Documents",
  helpdeskLibraryUrl: "https://vgctechnologysg.sharepoint.com/:f:/s/Helpdesk/IgAwyGv45OdSRrFICLjixJsbAXyYajkm9jSkaYagO7TtmvE?e=kZbkdi",
  get baseUrl() { return this.tenantUrl + this.siteUrl; },
  get docsUrl() { return this.baseUrl + this.docLibrary; },
  articleUrl(slug) { return `${this.baseUrl}/SitePages/${slug}.aspx`; },
  docUrl(path) { return `${this.docsUrl}/${path}`; },
};


export const KB_CATEGORIES = [
  { id: "M365", label: "Microsoft 365", icon: "☁️", color: "#0078D4" },
  { id: "Azure", label: "Azure / Cloud", icon: "⚡", color: "#0089D6" },
  { id: "Network", label: "Network & VPN", icon: "🌐", color: "#06B6D4" },
  { id: "Security", label: "Security & Compliance", icon: "🛡️", color: "#FF6B6B" },
  { id: "SOP", label: "Standard Procedures", icon: "📋", color: "#FFB347" },
  { id: "Remote", label: "Remote Support", icon: "🖥️", color: "#CE93D8" },
  { id: "Access", label: "Identity & Access", icon: "🔑", color: "#81C784" },
  { id: "Hardware", label: "Hardware & Devices", icon: "💻", color: "#64B5F6" },
  { id: "Email", label: "Email & Exchange", icon: "📧", color: "#EC4899" },
  { id: "Database", label: "Database & SQL", icon: "🗄️", color: "#A78BFA" },
];


export const KB_ARTICLES = [];

export const INTEGRATION_CATALOG = [
  { id: "INT01", name: "ServiceNow", category: "ITSM", icon: "🔧", status: "available", description: "Bi-directional sync with ServiceNow CMDB and incidents" },
  { id: "INT02", name: "Jira", category: "Project Management", icon: "📋", status: "available", description: "Link ITSM tickets to Jira stories and epics" },
  { id: "INT03", name: "Slack", category: "Communication", icon: "💬", status: "connected", description: "Real-time notifications and ticket creation from Slack" },
  { id: "INT04", name: "Microsoft Teams", category: "Communication", icon: "👥", status: "connected", description: "Teams bot for ticket updates and approvals" },
  { id: "INT05", name: "PagerDuty", category: "Alerting", icon: "🚨", status: "available", description: "Escalation and on-call management integration" },
  { id: "INT06", name: "Azure AD", category: "Identity", icon: "🔐", status: "connected", description: "SSO, user provisioning, and group sync" },
  { id: "INT07", name: "Datadog", category: "Monitoring", icon: "📊", status: "available", description: "Auto-create incidents from monitoring alerts" },
  { id: "INT08", name: "Confluence", category: "Documentation", icon: "📝", status: "available", description: "Sync KB articles with Confluence spaces" },
  { id: "INT09", name: "Okta", category: "Identity", icon: "🔑", status: "available", description: "Identity and access management integration" },
  { id: "INT10", name: "AWS CloudWatch", category: "Monitoring", icon: "☁️", status: "available", description: "Ingest AWS alerts as incidents automatically" },
  { id: "INT11", name: "Zendesk", category: "Support", icon: "💛", status: "connected", description: "AI Command Center — 90% auto-triage, auto-respond, auto-route, ITSM sync" },
  { id: "INT12", name: "GitHub", category: "DevOps", icon: "🐙", status: "available", description: "Link incidents to code changes and deployments" },
  { id: "INT13", name: "SolarWinds RMM", category: "Monitoring", icon: "🖥️", status: "connected", description: "N-able RMM endpoint monitoring — clients, servers & workstations" },
  { id: "INT14", name: "Cisco Meraki", category: "Networking", icon: "📡", status: "connected", description: "Dashboard API — orgs, devices, networks, uplinks & VPN status" },
  { id: "INT15", name: "Sophos Central", category: "Security", icon: "🛡️", status: "connected", description: "Firewall management — groups, firewalls, alerts & threat intelligence" },
];

export const INITIAL_INCIDENTS = [];

export const INITIAL_PROBLEMS = [];
export const INITIAL_CHANGES = [];
export const INITIAL_REQUESTS = [];

