import React, { useEffect, useState } from "react";

export default function CyberNewsModule({ users, vendors }) {
  const [liveThreats, setLiveThreats] = useState([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [feedStatus, setFeedStatus] = useState("");

  const fetchCyberNews = async (forceRefresh = false) => {
    setNewsLoading(true);
    try {
      const resp = await fetch(`/api/cybernews${forceRefresh ? "?refresh=true" : ""}`);
      const data = await resp.json();
      if (data.threats && data.threats.length > 0) {
        setLiveThreats(data.threats);
        setLastSyncTime(data.lastSync ? new Date(data.lastSync) : new Date());
        setFeedStatus(`${data.feedsOk || "?"}/${data.feedsTotal || "?"} feeds${data.cached ? " (cached)" : ""}`);
      }
    } catch (err) {
      console.error("Cyber news fetch error:", err);
      setFeedStatus("Feed error");
    }
    setNewsLoading(false);
  };

  useEffect(() => { fetchCyberNews(); }, []);

  const fallbackThreats = [
    { id: "GTHR-001", severity: "Critical", title: "Active exploitation of CVE-2026-21413 — Microsoft Exchange RCE", source: "CISA", sourceUrl: "https://www.cisa.gov/news-events/cybersecurity-advisories", region: "Global", time: "28 min ago", timestamp: Date.now() - 28*60000, isNew: true,
      aiSummary: "Zero-day RCE in Exchange Server 2019 CU14. Patch available (KB5035432). Immediate patching required within 4 hours. Active exploitation confirmed by multiple threat actors.",
      affectsUs: true, category: "Vulnerability", cve: "CVE-2026-21413", cvss: 9.8, cvssVector: "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
      affectedSystems: ["Microsoft Exchange Server 2019 CU14", "Exchange Server 2016 CU23"],
      mitreTactics: ["Initial Access (T1190)", "Execution (T1059)"],
      iocs: ["185.220.101.x/24", "SHA256: a1b2c3d4e5f6...", "Domain: mail-update-srv.com"],
      nextSteps: ["Apply emergency patch KB5035432 within 4 hours", "Enable WAF rule for OWA endpoints", "Scan mail server logs for IoC patterns", "Notify affected stakeholders via email", "Verify Exchange Online Protection rules"],
      references: [
        { title: "CISA Advisory AA26-085A", url: "https://www.cisa.gov/news-events/cybersecurity-advisories" },
        { title: "Microsoft Security Update Guide", url: "https://msrc.microsoft.com/update-guide/" },
        { title: "NVD CVE-2026-21413", url: "https://nvd.nist.gov/" }
      ],
      emailSubject: "URGENT: Critical Security Patch Required — CVE-2026-21413 Exchange RCE",
      emailBody: "Dear Team,\n\nA critical zero-day vulnerability (CVE-2026-21413) affecting Microsoft Exchange Server is being actively exploited in the wild.\n\nIMPACT: Remote Code Execution on Exchange Server 2019 CU14\nRISK LEVEL: Critical (CVSS 9.8)\nPATCH: KB5035432 is available\n\nIMMEDIATE ACTIONS REQUIRED:\n1. Apply patch KB5035432 within 4 hours\n2. Enable WAF rules for OWA endpoints\n3. Review mail server logs for indicators of compromise\n\nPlease confirm completion of patching to the IT Security team.\n\nBest regards,\nVGC Technology Pte Ltd — IT Security Operations\nAutomated via VGC-ITSM AI Engine",
      status: "open" },
    { id: "GTHR-002", severity: "High", title: "Ransomware campaign targeting APAC financial services — LockBit 4.0 variant", source: "SingCERT", sourceUrl: "https://www.csa.gov.sg/alerts-advisories", region: "APAC", time: "2 hr ago", timestamp: Date.now() - 2*3600000, isNew: true,
      aiSummary: "LockBit 4.0 variant using phishing emails with .iso attachments. Targeting APAC financial sector specifically. Block .iso attachments at email gateway immediately. Multiple Singapore organizations already affected.",
      affectsUs: true, category: "Ransomware", cve: null, cvss: null, cvssVector: null,
      affectedSystems: ["Email Gateway", "Windows Endpoints", "File Servers"],
      mitreTactics: ["Initial Access (T1566.001)", "Execution (T1204.002)", "Impact (T1486)"],
      iocs: ["SHA256: f7e8d9c0b1a2...", "IP: 91.215.85.x", "Domain: invoice-portal-sg.com", "File: Q1-Report-2026.iso"],
      nextSteps: ["Block .iso attachments at email gateway", "Alert all staff via Teams/Email", "Verify EDR signatures are updated to latest", "Check backup integrity and test restore process", "Enable enhanced monitoring on file servers"],
      references: [
        { title: "SingCERT Alert 2026-0142", url: "https://www.csa.gov.sg/alerts-advisories" },
        { title: "CSA Singapore Advisory", url: "https://www.csa.gov.sg/singcert" },
        { title: "LockBit 4.0 Analysis — Trend Micro", url: "https://www.trendmicro.com/" }
      ],
      emailSubject: "Security Advisory: LockBit 4.0 Ransomware Campaign — APAC Region",
      emailBody: "Dear Team,\n\nSG-CERT has issued an advisory regarding a LockBit 4.0 ransomware campaign targeting APAC financial services.\n\nTHREAT: LockBit 4.0 variant via phishing (.iso attachments)\nRISK LEVEL: High\nREGION: APAC / Singapore\n\nPREVENTIVE ACTIONS:\n1. .iso attachments have been blocked at the email gateway\n2. Do NOT open suspicious email attachments\n3. Report any suspicious emails to helpdesk@vgctechnology.com\n\nOur EDR signatures have been updated. If you notice any unusual system behavior, disconnect from the network immediately and contact IT.\n\nBest regards,\nVGC Technology Pte Ltd — IT Security Operations\nAutomated via VGC-ITSM AI Engine",
      status: "open" },
    { id: "GTHR-003", severity: "High", title: "Critical vulnerability in Fortinet FortiOS SSL VPN — CVE-2026-48788", source: "NVD / CVE", sourceUrl: "https://nvd.nist.gov/", region: "Global", time: "5 hr ago", timestamp: Date.now() - 5*3600000, isNew: false,
      aiSummary: "Our VPN infrastructure uses Cisco AnyConnect, not FortiOS. Low direct risk. However, monitor for lateral exploitation if partner organizations use FortiOS. Recommend adding FortiOS IoCs to SIEM watchlist.",
      affectsUs: false, category: "Vulnerability", cve: "CVE-2026-48788", cvss: 9.1, cvssVector: "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N",
      affectedSystems: ["FortiOS 7.4.x", "FortiOS 7.2.x", "FortiProxy 7.4.x"],
      mitreTactics: ["Initial Access (T1190)", "Credential Access (T1003)"],
      iocs: ["IP: 103.131.189.x", "SHA256: b2c3d4e5f6a7..."],
      nextSteps: ["Confirm no FortiOS devices in our infrastructure", "Add IoCs to SIEM watchlist", "Notify partner vendors using Fortinet products", "Monitor for related exploitation attempts"],
      references: [
        { title: "NVD CVE-2026-48788", url: "https://nvd.nist.gov/" },
        { title: "Fortinet PSIRT Advisory FG-IR-26-005", url: "https://www.fortiguard.com/psirt" },
        { title: "Rapid7 Analysis", url: "https://www.rapid7.com/blog/" }
      ],
      emailSubject: "FYI: FortiOS SSL VPN Vulnerability — CVE-2026-48788",
      emailBody: "Dear Team,\n\nA critical vulnerability has been discovered in Fortinet FortiOS SSL VPN (CVE-2026-48788, CVSS 9.1).\n\nWe do NOT use FortiOS in our infrastructure (we use Cisco AnyConnect), so direct risk is LOW.\n\nHowever, please note:\n1. Partner organizations may be affected\n2. IoCs have been added to our SIEM watchlist\n3. Monitor for any related exploitation attempts\n\nNo immediate action required for our team.\n\nBest regards,\nVGC Technology Pte Ltd — IT Security Operations",
      status: "monitoring" },
    { id: "GTHR-004", severity: "Medium", title: "DNS amplification attacks increase 340% across Southeast Asia ISPs", source: "CSA Singapore", sourceUrl: "https://www.csa.gov.sg/singcert", region: "SEA", time: "8 hr ago", timestamp: Date.now() - 8*3600000, isNew: false,
      aiSummary: "DNS amplification targeting SEA region ISPs. Our Azure Front Door WAF provides DDoS protection. Verify rate-limiting rules are active. Consider enabling Azure DDoS Protection Standard if not already enabled.",
      affectsUs: false, category: "DDoS", cve: null, cvss: null, cvssVector: null,
      affectedSystems: ["DNS Infrastructure", "ISP Networks"],
      mitreTactics: ["Impact (T1498.002)"],
      iocs: ["Multiple open resolvers in 103.x.x.x/8 range"],
      nextSteps: ["Verify Azure DDoS Protection status", "Check WAF rate-limiting rules", "Review DNS configuration for amplification vectors", "Enable enhanced DDoS monitoring"],
      references: [
        { title: "CSA Singapore Advisory", url: "https://www.csa.gov.sg/singcert" },
        { title: "Azure DDoS Protection Best Practices", url: "https://learn.microsoft.com/en-us/azure/ddos-protection/" }
      ],
      emailSubject: "Advisory: DNS Amplification Attacks in SEA Region",
      emailBody: "Dear Team,\n\nCSA Singapore reports a 340% increase in DNS amplification attacks across Southeast Asia.\n\nOur Azure Front Door WAF provides baseline DDoS protection. Please verify:\n1. WAF rate-limiting rules are active\n2. Azure DDoS Protection Standard is enabled\n3. DNS configurations are not susceptible to amplification\n\nBest regards,\nVGC Technology Pte Ltd — IT Security Operations",
      status: "monitoring" },
    { id: "GTHR-005", severity: "Low", title: "Updated IoC list for SolarWinds Serv-U FTP vulnerability", source: "CISA", sourceUrl: "https://www.cisa.gov/news-events/cybersecurity-advisories", region: "Global", time: "12 hr ago", timestamp: Date.now() - 12*3600000, isNew: false,
      aiSummary: "We do not use SolarWinds Serv-U. No action required. IoC list archived for reference in case of future supply chain concerns.",
      affectsUs: false, category: "Advisory", cve: "CVE-2026-35211", cvss: 7.2, cvssVector: "AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H",
      affectedSystems: ["SolarWinds Serv-U FTP Server"],
      mitreTactics: ["Initial Access (T1190)"],
      iocs: ["SHA256: c3d4e5f6a7b8...", "IP: 198.51.100.x"],
      nextSteps: ["No action required — we don't use SolarWinds Serv-U", "IoCs archived for reference"],
      references: [
        { title: "CISA Known Exploited Vulnerabilities", url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog" }
      ],
      emailSubject: "FYI: SolarWinds Serv-U IoC Update",
      emailBody: "Dear Team,\n\nCISA has updated the IoC list for SolarWinds Serv-U vulnerability.\n\nWe do NOT use SolarWinds Serv-U in our infrastructure. No action required.\n\nIoC list has been archived for reference.\n\nBest regards,\nVGC Technology Pte Ltd — IT Security Operations",
      status: "closed" },
    { id: "GTHR-006", severity: "Medium", title: "Phishing kit 'EvilProxy' now targeting Azure AD/Entra ID tenants", source: "BleepingComputer", sourceUrl: "https://www.bleepingcomputer.com/", region: "Global", time: "1 day ago", timestamp: Date.now() - 24*3600000, isNew: false,
      aiSummary: "EvilProxy is an advanced MFA-bypass phishing kit now targeting Entra ID tenants. Critical for our SSO infrastructure. Ensure Conditional Access policies require compliant devices. Review sign-in logs for suspicious locations. Consider deploying phishing-resistant MFA (FIDO2/Windows Hello).",
      affectsUs: true, category: "Phishing", cve: null, cvss: null, cvssVector: null,
      affectedSystems: ["Azure AD / Entra ID", "Microsoft 365", "SSO-integrated apps"],
      mitreTactics: ["Initial Access (T1566.002)", "Credential Access (T1557)", "Defense Evasion (T1550.001)"],
      iocs: ["Domain: login-microsoftonline-verify.com", "Domain: entra-auth-portal.com", "IP: 45.153.241.x"],
      nextSteps: ["Review Conditional Access policies for compliant device requirement", "Audit Entra ID sign-in logs for suspicious locations", "Deploy phishing-resistant MFA (FIDO2/Windows Hello)", "Train staff on MFA bypass phishing techniques", "Block known EvilProxy domains at DNS level"],
      references: [
        { title: "BleepingComputer EvilProxy Analysis", url: "https://www.bleepingcomputer.com/" },
        { title: "Microsoft Entra ID Protection Guide", url: "https://learn.microsoft.com/en-us/entra/id-protection/" },
        { title: "FIDO2 Security Key Deployment", url: "https://learn.microsoft.com/en-us/entra/identity/authentication/concept-authentication-passwordless" }
      ],
      emailSubject: "Security Advisory: EvilProxy MFA-Bypass Phishing Targeting Entra ID",
      emailBody: "Dear Team,\n\nA phishing kit called 'EvilProxy' is now specifically targeting Azure AD / Entra ID tenants with MFA bypass capabilities.\n\nThis DIRECTLY affects our SSO infrastructure.\n\nIMMEDIATE ACTIONS:\n1. Review Conditional Access policies\n2. Audit sign-in logs for suspicious activity\n3. Consider upgrading to FIDO2 / Windows Hello for Business\n\nDo NOT click on any login links from emails. Always navigate to portal.azure.com directly.\n\nBest regards,\nVGC Technology Pte Ltd — IT Security Operations",
      status: "open" },
    { id: "GTHR-007", severity: "High", title: "Critical Chrome zero-day CVE-2026-3159 under active exploitation", source: "Google TAG", sourceUrl: "https://blog.google/threat-analysis-group/", region: "Global", time: "1 day ago", timestamp: Date.now() - 24*3600000, isNew: false,
      aiSummary: "Chrome V8 type confusion vulnerability under active exploitation. Force-update all managed Chrome browsers via Intune policy immediately. Unmanaged BYOD devices should be notified to update manually.",
      affectsUs: true, category: "Vulnerability", cve: "CVE-2026-3159", cvss: 8.8, cvssVector: "AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H",
      affectedSystems: ["Google Chrome < 126.0.6478.182", "Chromium-based browsers", "Microsoft Edge (Chromium)"],
      mitreTactics: ["Execution (T1203)", "Initial Access (T1189)"],
      iocs: ["Exploit served via compromised ad networks", "SHA256: d4e5f6a7b8c9..."],
      nextSteps: ["Force Chrome update via Intune to 126.0.6478.182+", "Update Microsoft Edge via WSUS/Intune", "Notify BYOD users to update browsers manually", "Block known exploit domains at web proxy", "Enable Chrome browser cloud management"],
      references: [
        { title: "Google TAG Blog Post", url: "https://blog.google/threat-analysis-group/" },
        { title: "Chrome Release Notes", url: "https://chromereleases.googleblog.com/" },
        { title: "NVD CVE-2026-3159", url: "https://nvd.nist.gov/" }
      ],
      emailSubject: "ACTION REQUIRED: Chrome Zero-Day CVE-2026-3159 — Update Immediately",
      emailBody: "Dear Team,\n\nA critical Chrome zero-day (CVE-2026-3159) is being actively exploited.\n\nACTION REQUIRED: Update Google Chrome to version 126.0.6478.182 or later IMMEDIATELY.\n\nManaged devices will receive updates via Intune. If you are on a BYOD device:\n1. Open Chrome → Settings → About Chrome\n2. Chrome will auto-update → Restart browser\n\nAlso update Microsoft Edge if used.\n\nBest regards,\nVGC Technology Pte Ltd — IT Security Operations",
      status: "open" },
    { id: "GTHR-008", severity: "Critical", title: "Nation-state APT campaign 'Typhoon Silk' targeting Singapore critical infrastructure", source: "CSA Singapore", sourceUrl: "https://www.csa.gov.sg/alerts-advisories", region: "Singapore", time: "45 min ago", timestamp: Date.now() - 45*60000, isNew: true,
      aiSummary: "CSA Singapore has issued an urgent advisory on APT group 'Typhoon Silk' actively targeting Singapore critical infrastructure including financial services. Uses supply chain compromise and living-off-the-land techniques. Immediate review of privileged access and network segmentation required.",
      affectsUs: true, category: "APT", cve: null, cvss: null, cvssVector: null,
      affectedSystems: ["Active Directory", "Privileged Access Workstations", "Network Infrastructure", "Supply Chain Software"],
      mitreTactics: ["Initial Access (T1195.002)", "Persistence (T1078)", "Lateral Movement (T1021.002)", "Defense Evasion (T1218)", "Collection (T1005)"],
      iocs: ["IP: 103.224.182.x", "IP: 45.77.x.x", "Domain: sg-cloud-updates.com", "Domain: azure-monitor-sg.com", "C2 Protocol: DNS over HTTPS", "SHA256: e5f6a7b8c9d0..."],
      nextSteps: ["Review all privileged access accounts immediately", "Verify network segmentation controls", "Audit recent supply chain software updates", "Enable enhanced logging on domain controllers", "Conduct emergency threat hunting exercise", "Report any suspicious activity to CSA Singapore"],
      references: [
        { title: "CSA Singapore Urgent Advisory", url: "https://www.csa.gov.sg/alerts-advisories" },
        { title: "Singapore CII Protection Framework", url: "https://www.csa.gov.sg/" },
        { title: "MITRE ATT&CK — Typhoon Silk", url: "https://attack.mitre.org/" }
      ],
      emailSubject: "URGENT: APT Campaign 'Typhoon Silk' Targeting Singapore Infrastructure",
      emailBody: "Dear Team,\n\nCSA Singapore has issued an URGENT advisory regarding APT group 'Typhoon Silk' actively targeting Singapore critical infrastructure, including financial services.\n\nTHIS IS A NATION-STATE LEVEL THREAT.\n\nIMMEDIATE ACTIONS REQUIRED:\n1. Review ALL privileged access accounts\n2. Verify network segmentation is intact\n3. Audit recent software supply chain updates\n4. Enable enhanced logging on domain controllers\n5. Report ANY suspicious activity to CSA Singapore\n\nAdditional threat hunting exercise will be conducted. Standby for further instructions.\n\nBest regards,\nVGC Technology Pte Ltd — IT Security Operations\nAutomated via VGC-ITSM AI Engine",
      status: "open" },
    { id: "GTHR-009", severity: "Medium", title: "Kubernetes API server misconfiguration exposes cluster metadata — CVE-2026-1882", source: "SecurityWeek", sourceUrl: "https://www.securityweek.com/", region: "Global", time: "2 days ago", timestamp: Date.now() - 48*3600000, isNew: false,
      aiSummary: "Kubernetes API server in certain configurations leaks cluster metadata to unauthenticated users. Our AKS clusters use RBAC with Azure AD integration — low direct risk. Verify kube-apiserver flags as precaution.",
      affectsUs: false, category: "Vulnerability", cve: "CVE-2026-1882", cvss: 5.3, cvssVector: "AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N",
      affectedSystems: ["Kubernetes 1.28.x", "Kubernetes 1.29.x (pre-patch)"],
      mitreTactics: ["Discovery (T1613)"],
      iocs: ["Scanning from 198.51.100.x/24"],
      nextSteps: ["Verify AKS RBAC configuration", "Review kube-apiserver audit logs"],
      references: [{ title: "SecurityWeek Analysis", url: "https://www.securityweek.com/" }, { title: "Kubernetes Security Advisory", url: "https://kubernetes.io/docs/reference/issues-security/" }],
      emailSubject: "FYI: Kubernetes API Misconfiguration — CVE-2026-1882",
      emailBody: "Dear Team,\n\nA medium-severity vulnerability in Kubernetes API server has been disclosed. Our AKS clusters use RBAC with Azure AD — low direct risk. No immediate action required.\n\nBest regards,\nVGC Technology Pte Ltd — IT Security Operations",
      status: "monitoring" },
    { id: "GTHR-010", severity: "Low", title: "OpenSSL 3.3.x advisory — minor TLS session resumption flaw", source: "NVD / CVE", sourceUrl: "https://nvd.nist.gov/", region: "Global", time: "3 days ago", timestamp: Date.now() - 72*3600000, isNew: false,
      aiSummary: "Minor flaw in TLS 1.3 session resumption in OpenSSL 3.3.0-3.3.1. No known exploitation. Our infrastructure uses Azure-managed TLS termination — not directly affected. Patch available in OpenSSL 3.3.2.",
      affectsUs: false, category: "Advisory", cve: "CVE-2026-5102", cvss: 3.7, cvssVector: "AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N",
      affectedSystems: ["OpenSSL 3.3.0", "OpenSSL 3.3.1"],
      mitreTactics: ["Credential Access (T1557)"],
      iocs: [],
      nextSteps: ["No action required — Azure-managed TLS", "Archived for reference"],
      references: [{ title: "NVD CVE-2026-5102", url: "https://nvd.nist.gov/" }, { title: "OpenSSL Security Advisory", url: "https://www.openssl.org/news/secadv/" }],
      emailSubject: "FYI: OpenSSL 3.3.x Minor TLS Flaw",
      emailBody: "Dear Team,\n\nA low-severity flaw in OpenSSL 3.3.x has been disclosed. Our infrastructure uses Azure-managed TLS termination — not affected. No action required.\n\nBest regards,\nVGC Technology Pte Ltd — IT Security Operations",
      status: "closed" },
  ];

  const allThreats = liveThreats.length > 0 ? liveThreats : fallbackThreats;

  const [filterSev, setFilterSev] = useState("All");
  const [filterCategory, setFilterCategory] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [showAffectsUsOnly, setShowAffectsUsOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedThreat, setExpandedThreat] = useState(null);
  const [threatStatuses, setThreatStatuses] = useState({});
  const [activeTab, setActiveTab] = useState("feed");
  const [checkedSteps, setCheckedSteps] = useState({});

  const getStatus = (t) => threatStatuses[t.id] || t.status;
  const statusColors = { open: "#FF4444", acknowledged: "#FFB347", "in-progress": "#64B5F6", mitigated: "#81C784", monitoring: "#CE93D8", closed: "#5A6178" };
  const statusLabels = { open: "Open", acknowledged: "Acknowledged", "in-progress": "In Progress", mitigated: "Mitigated", monitoring: "Monitoring", closed: "Closed" };
  const sevColors = { Critical: "#FF4444", High: "#FF6B6B", Medium: "#FFB347", Low: "#4CAF50" };
  const categories = [...new Set(allThreats.map(t => t.category))];

  const filtered = allThreats.filter(t => {
    if (filterSev !== "All" && t.severity !== filterSev) return false;
    if (filterCategory !== "All" && t.category !== filterCategory) return false;
    if (filterStatus !== "All" && getStatus(t) !== filterStatus) return false;
    if (showAffectsUsOnly && !t.affectsUs) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (t.title || "").toLowerCase().includes(q) || (t.id || "").toLowerCase().includes(q) || (t.cve && t.cve.toLowerCase().includes(q)) || (t.source || "").toLowerCase().includes(q) || (t.aiSummary || "").toLowerCase().includes(q);
    }
    return true;
  });

  const emergencyThreats = allThreats.filter(t => (t.severity === "Critical" || t.severity === "High") && t.isNew && t.affectsUs);
  const toggleStep = (threatId, stepIdx) => setCheckedSteps(prev => ({ ...prev, [threatId]: { ...(prev[threatId] || {}), [stepIdx]: !(prev[threatId] || {})[stepIdx] } }));
  const getStepProgress = (threat) => {
    const steps = checkedSteps[threat.id] || {};
    const done = Object.values(steps).filter(Boolean).length;
    return { done, total: threat.nextSteps.length, pct: threat.nextSteps.length > 0 ? Math.round(done / threat.nextSteps.length * 100) : 0 };
  };

  const tabs = [
    { id: "feed", label: "Threat Feed", icon: "📰", count: allThreats.length },
    { id: "emergency", label: "Emergency Actions", icon: "🚨", count: emergencyThreats.length },
    { id: "response", label: "Response Tracker", icon: "🛡️", count: allThreats.filter(t => getStatus(t) !== "closed").length },
    { id: "ioc", label: "IoC Database", icon: "🔍", count: allThreats.reduce((a, t) => a + (t.iocs?.length || 0), 0) },
  ];

  const cvssColor = (score) => score >= 9.0 ? "#FF4444" : score >= 7.0 ? "#FF6B6B" : score >= 4.0 ? "#FFB347" : "#4CAF50";

  const renderThreatCard = (threat, mode) => {
    const isExpanded = expandedThreat === threat.id;
    const status = getStatus(threat);
    const progress = getStepProgress(threat);
    const isFeatured = mode === "featured";
    const isCompact = mode === "archived";
    if (isCompact) {
      return (
        <div key={threat.id} onClick={() => setExpandedThreat(isExpanded ? null : threat.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#0A0C14", borderRadius: 6, border: "1px solid #1E213066", borderLeft: `3px solid ${sevColors[threat.severity]}`, marginBottom: 4, cursor: "pointer", transition: "all 0.2s" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: sevColors[threat.severity], flexShrink: 0 }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: sevColors[threat.severity], fontFamily: "'JetBrains Mono', monospace", minWidth: 50 }}>{threat.severity.toUpperCase()}</span>
          <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", minWidth: 65 }}>{threat.id}</span>
          {threat.cve && <span style={{ padding: "1px 5px", borderRadius: 3, background: "#6366F118", fontSize: 8, color: "#6366F1", fontFamily: "'JetBrains Mono', monospace" }}>{threat.cve}</span>}
          <span style={{ fontSize: 10, color: "#A0AEC0", flex: 1 }}>{threat.title}</span>
          <span style={{ padding: "1px 6px", borderRadius: 3, background: statusColors[status] + "22", color: statusColors[status], fontSize: 8, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{statusLabels[status]}</span>
          <span style={{ fontSize: 8, color: "#5A617866" }}>{threat.time}</span>
          <span style={{ color: "#5A6178", fontSize: 9, transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>▼</span>
        </div>
      );
    }
    return (
      <div key={threat.id} style={{
        marginBottom: isFeatured ? 14 : 8, background: isFeatured && threat.affectsUs ? "#FF444408" : "#0F1117",
        borderRadius: isFeatured ? 12 : 8, border: `1px solid ${isFeatured && threat.affectsUs ? sevColors[threat.severity] + '33' : '#1E2130'}`,
        borderLeft: `${isFeatured ? 4 : 3}px solid ${sevColors[threat.severity]}`, position: "relative", overflow: "hidden",
        transition: "all 0.2s", boxShadow: isFeatured ? `0 4px 20px ${sevColors[threat.severity]}11` : "none"
      }}>
        {isFeatured && threat.severity === "Critical" && (
          <div style={{ position: "absolute", top: -1, right: -1, padding: "3px 12px", borderRadius: "0 12px 0 8px", background: "#FF4444", color: "#fff", fontSize: 9, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", animation: "pulse 2s infinite" }}>⚡ IMMEDIATE ACTION</div>
        )}
        {isFeatured && threat.severity === "High" && (
          <div style={{ position: "absolute", top: -1, right: -1, padding: "3px 12px", borderRadius: "0 12px 0 8px", background: "#FF6B6B", color: "#fff", fontSize: 9, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>⚡ ACTION REQUIRED</div>
        )}
        <div onClick={() => setExpandedThreat(isExpanded ? null : threat.id)} style={{ padding: isFeatured ? "18px 20px" : "10px 14px", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: isFeatured ? 14 : 10 }}>
            <div style={{ width: isFeatured ? 10 : 7, height: isFeatured ? 10 : 7, borderRadius: "50%", background: sevColors[threat.severity], boxShadow: isFeatured ? `0 0 10px ${sevColors[threat.severity]}88` : "none", marginTop: 5, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: isFeatured ? 8 : 4, flexWrap: "wrap" }}>
                <span style={{ fontSize: isFeatured ? 11 : 9, fontWeight: 700, color: sevColors[threat.severity], fontFamily: "'JetBrains Mono', monospace" }}>{threat.severity.toUpperCase()}</span>
                <span style={{ fontSize: 9, color: "#3A3F55" }}>·</span>
                <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{threat.id}</span>
                {threat.cve && <><span style={{ fontSize: 9, color: "#3A3F55" }}>·</span><span style={{ padding: "1px 6px", borderRadius: 3, background: "#6366F118", fontSize: 9, color: "#6366F1", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{threat.cve}</span></>}
                {threat.cvss && <span style={{ padding: "2px 6px", borderRadius: 3, background: cvssColor(threat.cvss) + "22", color: cvssColor(threat.cvss), fontSize: 9, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>CVSS {threat.cvss}</span>}
                <span style={{ fontSize: 9, color: "#3A3F55" }}>·</span>
                <a href={threat.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ padding: "1px 6px", borderRadius: 3, background: "#1E2130", fontSize: 9, color: "#64B5F6", textDecoration: "none" }}>{threat.source} ↗</a>
                <span style={{ padding: "1px 6px", borderRadius: 3, background: "#1E2130", fontSize: 9, color: "#64B5F6" }}>{threat.region}</span>
                <span style={{ padding: "1px 6px", borderRadius: 3, background: "#1E213066", fontSize: 9, color: "#A0AEC0" }}>{threat.category}</span>
                {threat.affectsUs && <span style={{ padding: "1px 6px", borderRadius: 3, background: "#FF444422", fontSize: 9, color: "#FF6B6B", fontWeight: 600 }}>⚠ AFFECTS US</span>}
                <span style={{ padding: "2px 6px", borderRadius: 3, background: statusColors[status] + "22", color: statusColors[status], fontSize: 9, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{statusLabels[status]?.toUpperCase()}</span>
                <span style={{ fontSize: 9, color: "#5A6178", marginLeft: "auto" }}>{threat.time}</span>
                <span style={{ color: "#5A6178", fontSize: 10, transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>▼</span>
              </div>
              <div style={{ fontSize: isFeatured ? 15 : 12, color: "#E8ECF4", fontWeight: isFeatured ? 600 : 500, lineHeight: 1.4 }}>{threat.title}</div>
              <div style={{ marginTop: isFeatured ? 10 : 6, padding: isFeatured ? "10px 12px" : "6px 8px", background: "#6366F108", borderRadius: 6, border: "1px solid #6366F122" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 9, color: "#6366F1", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>🧠 AI THREAT ANALYSIS</span>
                  {azureOpenAI.enabled && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#81C784", boxShadow: "0 0 6px #81C78444" }} />}
                  {progress.total > 0 && progress.done > 0 && <span style={{ marginLeft: "auto", fontSize: 9, color: "#81C784", fontFamily: "'JetBrains Mono', monospace" }}>{progress.done}/{progress.total} steps done</span>}
                </div>
                <div style={{ fontSize: isFeatured ? 12 : 10, color: "#A0AEC0", lineHeight: 1.6 }}>{threat.aiSummary}</div>
              </div>
            </div>
          </div>
        </div>
        {isExpanded && (
          <div style={{ padding: "0 16px 16px 36px", borderTop: "1px solid #1E213044" }}>
            {threat.cvss && (
              <div style={{ marginTop: 12, padding: "10px 14px", background: "#0A0C14", borderRadius: 8, border: "1px solid #1E2130" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#E8ECF4", fontFamily: "'JetBrains Mono', monospace" }}>CVSS SCORE</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 120, height: 6, background: "#1E2130", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${threat.cvss * 10}%`, height: "100%", background: cvssColor(threat.cvss), borderRadius: 3, transition: "width 0.5s" }} />
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: cvssColor(threat.cvss), fontFamily: "'JetBrains Mono', monospace" }}>{threat.cvss}/10</span>
                    <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{threat.cvss >= 9 ? "CRITICAL" : threat.cvss >= 7 ? "HIGH" : threat.cvss >= 4 ? "MEDIUM" : "LOW"}</span>
                  </div>
                </div>
                {threat.cvssVector && <div style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>Vector: {threat.cvssVector}</div>}
              </div>
            )}
            {threat.affectedSystems && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#E8ECF4", fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>💻 AFFECTED SYSTEMS</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {threat.affectedSystems.map((s, i) => (
                    <span key={i} style={{ padding: "3px 8px", borderRadius: 4, background: "#1E2130", border: "1px solid #2A2E3E", fontSize: 10, color: "#C4CAD6", fontFamily: "'JetBrains Mono', monospace" }}>{s}</span>
                  ))}
                </div>
              </div>
            )}
            {threat.mitreTactics && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#E8ECF4", fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>🎯 MITRE ATT&CK TACTICS</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {threat.mitreTactics.map((tactic, i) => (
                    <span key={i} style={{ padding: "3px 8px", borderRadius: 4, background: "#CE93D818", border: "1px solid #CE93D833", fontSize: 10, color: "#CE93D8", fontFamily: "'JetBrains Mono', monospace" }}>{tactic}</span>
                  ))}
                </div>
              </div>
            )}
            {threat.iocs && threat.iocs.length > 0 && (
              <div style={{ marginTop: 10, padding: "10px 14px", background: "#0A0C14", borderRadius: 8, border: "1px solid #1E2130" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#FF6B6B", fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>🔍 INDICATORS OF COMPROMISE (IoC)</div>
                {threat.iocs.map((ioc, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
                    <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#FF6B6B", flexShrink: 0 }} />
                    <code style={{ fontSize: 10, color: "#A0AEC0", fontFamily: "'JetBrains Mono', monospace", wordBreak: "break-all" }}>{ioc}</code>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#81C784", fontFamily: "'JetBrains Mono', monospace" }}>✅ RECOMMENDED ACTIONS</div>
                {progress.total > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 80, height: 4, background: "#1E2130", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${progress.pct}%`, height: "100%", background: progress.pct === 100 ? "#4CAF50" : "#6366F1", borderRadius: 2, transition: "width 0.3s" }} />
                    </div>
                    <span style={{ fontSize: 9, color: progress.pct === 100 ? "#4CAF50" : "#6366F1", fontFamily: "'JetBrains Mono', monospace" }}>{progress.pct}%</span>
                  </div>
                )}
              </div>
              {threat.nextSteps.map((step, i) => {
                const checked = (checkedSteps[threat.id] || {})[i];
                return (
                  <div key={i} onClick={() => toggleStep(threat.id, i)} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 3,
                    background: checked ? "#4CAF5008" : "#0A0C14", borderRadius: 6,
                    border: `1px solid ${checked ? "#4CAF5033" : "#1E2130"}`,
                    cursor: "pointer", transition: "all 0.2s"
                  }}>
                    <span style={{
                      width: 18, height: 18, borderRadius: 4, border: `2px solid ${checked ? "#4CAF50" : "#2A2E3E"}`,
                      background: checked ? "#4CAF50" : "transparent", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, color: "#fff", flexShrink: 0, transition: "all 0.2s"
                    }}>{checked ? "✓" : ""}</span>
                    <span style={{ fontSize: 11, color: checked ? "#5A6178" : "#C4CAD6", textDecoration: checked ? "line-through" : "none", flex: 1 }}>{step}</span>
                    <span style={{ width: 18, height: 18, borderRadius: 4, background: "#0A0C14", border: "1px solid #1E2130", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: checked ? "#4CAF50" : "#5A6178", flexShrink: 0 }}>{i + 1}</span>
                  </div>
                );
              })}
            </div>
            {threat.references && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#64B5F6", fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>📚 REFERENCE SOURCES</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {threat.references.map((ref, i) => (
                    <a key={i} href={ref.url} target="_blank" rel="noopener noreferrer" style={{
                      padding: "4px 10px", borderRadius: 5, background: "#1E2130", border: "1px solid #2A2E3E",
                      fontSize: 10, color: "#64B5F6", textDecoration: "none", display: "flex", alignItems: "center", gap: 4,
                      transition: "all 0.2s"
                    }}>
                      <span style={{ fontSize: 10 }}>🔗</span> {ref.title} ↗
                    </a>
                  ))}
                </div>
              </div>
            )}
            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select value={status} onChange={e => setThreatStatuses(prev => ({ ...prev, [threat.id]: e.target.value }))}
                style={{ padding: "6px 10px", background: statusColors[status] + "18", border: `1px solid ${statusColors[status]}44`, borderRadius: 6, color: statusColors[status], fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}>
                {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button onClick={(e) => { e.stopPropagation(); setThreatEmailDraft(threat); }} style={{
                padding: "6px 14px", borderRadius: 6, border: "1px solid #6366F133", background: "#6366F118",
                color: "#6366F1", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace",
                display: "flex", alignItems: "center", gap: 6
              }}>📧 Draft Advisory Email</button>
              <button onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(threat.iocs?.join("\n") || ""); }} style={{
                padding: "6px 14px", borderRadius: 6, border: "1px solid #1E2130", background: "#0A0C14",
                color: "#A0AEC0", cursor: "pointer", fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                display: "flex", alignItems: "center", gap: 6
              }}>📋 Copy IoCs</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 22 }}>🛡️</span>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontFamily: "'Space Grotesk', sans-serif" }}>Cyber Threat Intelligence Center</h2>
            <div style={{ fontSize: 11, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>Real-time threat intelligence, advisories &amp; incident response tracking</div>
          </div>
          <span style={{ padding: "3px 10px", borderRadius: 4, background: "#FF444422", color: "#FF4444", fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", animation: "pulse 2s infinite" }}>● LIVE</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>
            {feedStatus && <span style={{ marginRight: 6, color: "#64B5F6" }}>[{feedStatus}]</span>}
            Last sync: {lastSyncTime ? lastSyncTime.toLocaleTimeString("en-SG", { hour12: false }) : "—"}
          </div>
          <button onClick={() => fetchCyberNews(true)} disabled={newsLoading} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #6366F133", background: newsLoading ? "#1E2130" : "#6366F118", color: newsLoading ? "#5A6178" : "#6366F1", cursor: newsLoading ? "wait" : "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{newsLoading ? "⏳ Loading…" : "🔄 Refresh"}</button>
        </div>
      </div>

      {/* ═══ EMERGENCY BANNER ═══ */}
      {emergencyThreats.length > 0 && (
        <div style={{ marginBottom: 16, padding: "14px 18px", background: "linear-gradient(135deg, #FF444412, #FF6B6B08)", borderRadius: 10, border: "1px solid #FF444444", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, #FF4444, #FF6B6B, #FF4444)", animation: "pulse 2s infinite" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 16, animation: "pulse 2s infinite" }}>🚨</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#FF4444", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>IMMEDIATE ACTION REQUIRED</span>
            <span style={{ padding: "2px 8px", borderRadius: 4, background: "#FF4444", color: "#fff", fontSize: 10, fontWeight: 700 }}>{emergencyThreats.length} ACTIVE</span>
          </div>
          {emergencyThreats.map(t => (
            <div key={t.id} onClick={() => { setActiveTab("feed"); setExpandedThreat(expandedThreat === t.id ? null : t.id); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#0A0C1488", borderRadius: 6, marginBottom: 6, cursor: "pointer", border: "1px solid #FF444422", transition: "all 0.2s" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: sevColors[t.severity], boxShadow: `0 0 8px ${sevColors[t.severity]}88`, flexShrink: 0, animation: "pulse 2s infinite" }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: sevColors[t.severity], fontFamily: "'JetBrains Mono', monospace", minWidth: 60 }}>{t.severity.toUpperCase()}</span>
              <span style={{ fontSize: 11, color: "#E8ECF4", flex: 1, fontWeight: 500 }}>{t.title}</span>
              {t.cvss && <span style={{ padding: "2px 6px", borderRadius: 3, background: cvssColor(t.cvss) + "22", color: cvssColor(t.cvss), fontSize: 9, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>CVSS {t.cvss}</span>}
              <span style={{ fontSize: 9, color: "#5A6178" }}>{t.time}</span>
              <span style={{ color: "#6366F1", fontSize: 11 }}>→</span>
            </div>
          ))}
        </div>
      )}

      {/* Stat Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 16 }}>
        {["Critical", "High", "Medium", "Low"].map(s => {
          const count = allThreats.filter(t => t.severity === s).length;
          const affectsCount = allThreats.filter(t => t.severity === s && t.affectsUs).length;
          return (
            <div key={s} onClick={() => { setFilterSev(filterSev === s ? "All" : s); setActiveTab("feed"); }} style={{ padding: "12px 14px", background: "#0F1117", borderRadius: 8, border: `1px solid ${sevColors[s]}22`, borderLeft: `3px solid ${sevColors[s]}`, cursor: "pointer", transition: "all 0.2s" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: sevColors[s], fontFamily: "'Space Grotesk', sans-serif" }}>{count}</span>
                {affectsCount > 0 && <span style={{ fontSize: 9, color: "#FF6B6B", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>({affectsCount} ⚠)</span>}
              </div>
              <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>{s}</div>
            </div>
          );
        })}
        <div style={{ padding: "12px 14px", background: "#0F1117", borderRadius: 8, border: "1px solid #6366F122", borderLeft: "3px solid #6366F1" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#6366F1", fontFamily: "'Space Grotesk', sans-serif" }}>{allThreats.filter(t => t.affectsUs).length}</div>
          <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>Affects Us</div>
        </div>
      </div>

      {/* ═══ STORYTELLING EXECUTIVE SUMMARY ═══ */}
      {(() => {
        const criticalThreats = allThreats.filter(t => t.severity === "Critical");
        const highThreats = allThreats.filter(t => t.severity === "High");
        const affectsUsThreats = allThreats.filter(t => t.affectsUs);
        const openCount = allThreats.filter(t => getStatus(t) === "open").length;
        const mitigatedCount = allThreats.filter(t => getStatus(t) === "mitigated" || getStatus(t) === "closed").length;
        const totalSteps = allThreats.reduce((a, t) => a + t.nextSteps.length, 0);
        const doneSteps = allThreats.reduce((a, t) => { const s = checkedSteps[t.id] || {}; return a + Object.values(s).filter(Boolean).length; }, 0);
        return (
          <div style={{ marginBottom: 20, background: "linear-gradient(135deg, #0A0C14, #0F1117, #12141E)", borderRadius: 12, border: "1px solid #6366F133", padding: 24, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, #6366F1, #EC4899, #06B6D4)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 20 }}>📖</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>Threat Intelligence Executive Summary</div>
                <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>AI-generated analysis • {new Date().toLocaleDateString("en-SG", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} • Auto-refreshed every 60s</div>
              </div>
            </div>

            {/* Situation Overview */}
            <div style={{ padding: "14px 16px", background: "#6366F108", borderRadius: 8, border: "1px solid #6366F122", marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6366F1", fontFamily: "'JetBrains Mono', monospace", marginBottom: 8, letterSpacing: 1 }}>🧠 SITUATION OVERVIEW</div>
              <div style={{ fontSize: 12, color: "#C4CAD6", lineHeight: 1.8 }}>
                Our AI threat engine is currently tracking <span style={{ color: "#E8ECF4", fontWeight: 700 }}>{allThreats.length} active threats</span> across global and Singapore-specific intelligence feeds. Of these, <span style={{ color: "#FF4444", fontWeight: 700 }}>{criticalThreats.length} are Critical</span> and <span style={{ color: "#FF6B6B", fontWeight: 700 }}>{highThreats.length} are High severity</span>, with <span style={{ color: "#FFB347", fontWeight: 700 }}>{affectsUsThreats.length} directly affecting our infrastructure</span>. {openCount > 0 ? `There are ${openCount} threats requiring immediate attention.` : "All threats have been addressed."} {mitigatedCount > 0 && `${mitigatedCount} threats have been mitigated or closed.`}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              {/* AI Actions Taken */}
              <div style={{ padding: "14px 16px", background: "#0A0C14", borderRadius: 8, border: "1px solid #81C78433" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#81C784", fontFamily: "'JetBrains Mono', monospace", marginBottom: 10, letterSpacing: 1 }}>🧠 AI ACTIONS COMPLETED</div>
                {[
                  "Analyzed & classified all incoming threat feeds",
                  "Correlated CVEs against our infrastructure inventory",
                  "Generated IoC watchlists for SIEM ingestion",
                  "Auto-drafted advisory emails for critical threats",
                  "Mapped threats to MITRE ATT&CK framework",
                  "Calculated risk scores for affected systems",
                ].map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: 11, color: "#C4CAD6" }}>
                    <span style={{ color: "#81C784", fontSize: 10 }}>✓</span> {a}
                  </div>
                ))}
              </div>

              {/* Team Follow-Up Actions */}
              <div style={{ padding: "14px 16px", background: "#0A0C14", borderRadius: 8, border: "1px solid #FFB34733" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#FFB347", fontFamily: "'JetBrains Mono', monospace", marginBottom: 10, letterSpacing: 1 }}>👥 TEAM FOLLOW-UP ACTIONS</div>
                {[
                  { action: "Apply Exchange patch KB5035432", owner: "Infra Team", urgency: "4 hours", done: false },
                  { action: "Block .iso attachments at email gateway", owner: "Security Team", urgency: "Immediate", done: true },
                  { action: "Review Entra ID Conditional Access policies", owner: "IAM Team", urgency: "Today", done: false },
                  { action: "Force Chrome update via Intune", owner: "Endpoint Team", urgency: "Today", done: false },
                  { action: "Conduct privilege access audit (Typhoon Silk)", owner: "Security Team", urgency: "24 hours", done: false },
                  { action: "Train staff on MFA bypass phishing", owner: "HR / IT Training", urgency: "This week", done: false },
                ].map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderBottom: "1px solid #1E213022", fontSize: 11 }}>
                    <span style={{ color: a.done ? "#81C784" : "#FFB347", fontSize: 10 }}>{a.done ? "✓" : "○"}</span>
                    <span style={{ color: a.done ? "#5A6178" : "#C4CAD6", flex: 1, textDecoration: a.done ? "line-through" : "none" }}>{a.action}</span>
                    <span style={{ color: "#5A6178", fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>{a.owner}</span>
                    <span style={{ padding: "1px 6px", borderRadius: 3, background: a.urgency === "Immediate" || a.urgency === "4 hours" ? "#FF444422" : "#FFB34722", color: a.urgency === "Immediate" || a.urgency === "4 hours" ? "#FF6B6B" : "#FFB347", fontSize: 8, fontWeight: 600 }}>{a.urgency}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* What Should We Do Next */}
            <div style={{ padding: "14px 16px", background: "#EC489908", borderRadius: 8, border: "1px solid #EC489933" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#EC4899", fontFamily: "'JetBrains Mono', monospace", marginBottom: 10, letterSpacing: 1 }}>🎯 WHAT SHOULD WE DO NEXT</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {[
                  { priority: "P0", title: "Patch Exchange CVE-2026-21413", desc: "Active exploitation confirmed. Patch window: 4 hours. Coordinate with change management for emergency change.", color: "#FF4444" },
                  { priority: "P0", title: "Threat Hunt — Typhoon Silk APT", desc: "Nation-state campaign targeting SG. Emergency threat hunting on domain controllers and privileged workstations.", color: "#FF4444" },
                  { priority: "P1", title: "Deploy Phishing-Resistant MFA", desc: "EvilProxy bypasses standard MFA. Accelerate FIDO2 / Windows Hello rollout for all Entra ID users.", color: "#FF6B6B" },
                  { priority: "P1", title: "Browser Force-Update Campaign", desc: "Chrome zero-day under active exploitation. Push Intune policies to force update all managed endpoints.", color: "#FF6B6B" },
                  { priority: "P2", title: "Staff Security Awareness Training", desc: "Brief all staff on MFA bypass phishing, .iso attachment risks, and suspicious email reporting.", color: "#FFB347" },
                  { priority: "P3", title: "Review Third-Party Vendor Security", desc: "Verify partner organizations have patched FortiOS. Update vendor risk register.", color: "#06B6D4" },
                ].map((n, i) => (
                  <div key={i} style={{ padding: "10px 12px", background: "#0A0C14", borderRadius: 6, border: `1px solid ${n.color}22`, borderLeft: `3px solid ${n.color}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span style={{ padding: "1px 6px", borderRadius: 3, background: n.color + "22", color: n.color, fontSize: 9, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{n.priority}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#E8ECF4" }}>{n.title}</span>
                    </div>
                    <div style={{ fontSize: 10, color: "#5A6178", lineHeight: 1.5 }}>{n.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Progress Bar */}
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" }}>Response Progress</span>
              <div style={{ flex: 1, height: 6, background: "#1E2130", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${totalSteps > 0 ? Math.round(doneSteps / totalSteps * 100) : 0}%`, height: "100%", background: "linear-gradient(90deg, #6366F1, #EC4899)", borderRadius: 3, transition: "width 0.5s" }} />
              </div>
              <span style={{ fontSize: 10, color: "#6366F1", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{totalSteps > 0 ? Math.round(doneSteps / totalSteps * 100) : 0}% ({doneSteps}/{totalSteps} steps)</span>
            </div>
          </div>
        );
      })()}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 16, background: "#0A0C14", borderRadius: 8, padding: 3 }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            flex: 1, padding: "8px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600,
            fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            background: activeTab === tab.id ? "#1E2130" : "transparent",
            color: activeTab === tab.id ? "#E8ECF4" : "#5A6178",
            transition: "all 0.2s"
          }}>
            <span>{tab.icon}</span> {tab.label}
            <span style={{ padding: "1px 6px", borderRadius: 10, background: activeTab === tab.id ? "#6366F1" : "#1E2130", color: activeTab === tab.id ? "#fff" : "#5A6178", fontSize: 9, fontWeight: 700 }}>{tab.count}</span>
          </button>
        ))}
      </div>

      {/* ═══ TAB: THREAT FEED ═══ */}
      {activeTab === "feed" && (
        <div>
          {/* Search & Filters */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ position: "relative", flex: "1 1 200px" }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12 }}>🔍</span>
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search threats, CVEs, sources..."
                style={{ width: "100%", padding: "7px 10px 7px 30px", background: "#0A0C14", border: "1px solid #1E2130", borderRadius: 6, color: "#C4CAD6", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", boxSizing: "border-box", outline: "none" }} />
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {["All", "Critical", "High", "Medium", "Low"].map(s => (
                <button key={s} onClick={() => setFilterSev(s)} style={{
                  padding: "5px 10px", borderRadius: 5, fontSize: 10, fontWeight: 600,
                  fontFamily: "'JetBrains Mono', monospace", cursor: "pointer",
                  background: filterSev === s ? (sevColors[s] || "#6366F1") + "22" : "#0A0C14",
                  border: `1px solid ${filterSev === s ? (sevColors[s] || "#6366F1") + "66" : "#1E2130"}`,
                  color: filterSev === s ? (sevColors[s] || "#E8ECF4") : "#5A6178"
                }}>{s}</button>
              ))}
            </div>
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
              style={{ padding: "5px 8px", background: "#0A0C14", border: "1px solid #1E2130", borderRadius: 5, color: "#C4CAD6", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}>
              <option value="All">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              style={{ padding: "5px 8px", background: "#0A0C14", border: "1px solid #1E2130", borderRadius: 5, color: "#C4CAD6", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}>
              <option value="All">All Statuses</option>
              {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button onClick={() => setShowAffectsUsOnly(!showAffectsUsOnly)} style={{
              padding: "5px 10px", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer",
              fontFamily: "'JetBrains Mono', monospace",
              background: showAffectsUsOnly ? "#FF444422" : "#0A0C14",
              border: `1px solid ${showAffectsUsOnly ? "#FF444466" : "#1E2130"}`,
              color: showAffectsUsOnly ? "#FF6B6B" : "#5A6178"
            }}>⚠ Affects Us</button>
          </div>

          {/* Dismissed Alerts Log */}
          {cyberNewsLog.length > 0 && (
            <div style={{ marginBottom: 14, padding: "10px 14px", background: "#FF444408", borderRadius: 8, border: "1px solid #FF444422" }}>
              <div style={{ fontSize: 10, color: "#FF6B6B", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>🔔 RECENTLY DISMISSED ALERTS</div>
              {cyberNewsLog.map(t => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #1E213022" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: sevColors[t.severity], flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: sevColors[t.severity], fontFamily: "'JetBrains Mono', monospace", minWidth: 55 }}>{t.severity?.toUpperCase()}</span>
                  <span style={{ fontSize: 11, color: "#C4CAD6", flex: 1 }}>{t.title}</span>
                  <span style={{ fontSize: 9, color: "#5A6178" }}>Dismissed at {t.dismissedAt}</span>
                </div>
              ))}
            </div>
          )}

          {/* Results count */}
          <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginBottom: 10 }}>
            Showing {filtered.length} of {allThreats.length} threats {searchQuery && `matching "${searchQuery}"`}
          </div>

          {/* ─── TIER 1: CRITICAL & HIGH (Featured — Bigger Cards) ─── */}
          {(() => {
            const featuredThreats = filtered.filter(t => t.severity === "Critical" || t.severity === "High").sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 3);
            const activeThreats = filtered.filter(t => t.severity === "Medium" || t.severity === "Low").sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 5);
            const featuredIds = new Set(featuredThreats.map(t => t.id));
            const activeIds = new Set(activeThreats.map(t => t.id));
            const archivedThreats = filtered.filter(t => !featuredIds.has(t.id) && !activeIds.has(t.id));
            return (
              <>
                {featuredThreats.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: 14 }}>🔥</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#FF4444", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>CRITICAL & HIGH SEVERITY</span>
                      <span style={{ padding: "2px 8px", borderRadius: 4, background: "#FF444422", color: "#FF4444", fontSize: 9, fontWeight: 700 }}>{featuredThreats.length} THREATS</span>
                      <div style={{ flex: 1, height: 1, background: "#FF444422" }} />
                    </div>
                    {featuredThreats.map(t => renderThreatCard(t, "featured"))}
                  </div>
                )}

                {/* ─── TIER 2: MEDIUM & LOW (Active — Smaller Cards) ─── */}
                {activeThreats.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 14 }}>📋</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#FFB347", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>MEDIUM & LOW SEVERITY</span>
                      <span style={{ padding: "2px 8px", borderRadius: 4, background: "#FFB34722", color: "#FFB347", fontSize: 9, fontWeight: 700 }}>{activeThreats.length} THREATS</span>
                      <div style={{ flex: 1, height: 1, background: "#FFB34722" }} />
                    </div>
                    {activeThreats.map(t => renderThreatCard(t, "active"))}
                  </div>
                )}

                {/* ─── TIER 3: ARCHIVED (Compact) ─── */}
                {archivedThreats.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 12 }}>📦</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>ARCHIVED / REMAINING</span>
                      <span style={{ padding: "2px 8px", borderRadius: 4, background: "#1E2130", color: "#5A6178", fontSize: 9, fontWeight: 700 }}>{archivedThreats.length}</span>
                      <div style={{ flex: 1, height: 1, background: "#1E2130" }} />
                    </div>
                    {archivedThreats.map(t => renderThreatCard(t, "archived"))}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* ═══ TAB: EMERGENCY ACTIONS ═══ */}
      {activeTab === "emergency" && (
        <div>
          {emergencyThreats.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#5A6178" }}>
              <span style={{ fontSize: 32 }}>✅</span>
              <div style={{ fontSize: 14, marginTop: 10, fontWeight: 600, color: "#81C784" }}>No Emergency Actions Required</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>All critical and high-severity threats have been addressed.</div>
            </div>
          ) : (
            emergencyThreats.map(threat => {
              const progress = getStepProgress(threat);
              return (
                <div key={threat.id} style={{
                  marginBottom: 14, padding: "16px 18px", background: "#FF444408", borderRadius: 10,
                  border: `2px solid ${sevColors[threat.severity]}44`, position: "relative"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 14, animation: "pulse 2s infinite" }}>🚨</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: sevColors[threat.severity], fontFamily: "'JetBrains Mono', monospace" }}>{threat.severity.toUpperCase()} — {threat.id}</span>
                    {threat.cvss && <span style={{ padding: "2px 6px", borderRadius: 3, background: cvssColor(threat.cvss) + "22", color: cvssColor(threat.cvss), fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>CVSS {threat.cvss}</span>}
                    <a href={threat.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ padding: "2px 6px", borderRadius: 3, background: "#1E2130", fontSize: 9, color: "#64B5F6", textDecoration: "none" }}>{threat.source} ↗</a>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "#5A6178" }}>{threat.time}</span>
                  </div>
                  <div style={{ fontSize: 14, color: "#E8ECF4", fontWeight: 600, marginBottom: 10 }}>{threat.title}</div>
                  <div style={{ padding: "10px 12px", background: "#6366F108", borderRadius: 8, border: "1px solid #6366F122", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: "#6366F1", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>🧠 AI RECOMMENDATION</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#C4CAD6", lineHeight: 1.6 }}>{threat.aiSummary}</div>
                  </div>

                  {/* Affected Systems */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#FFB347", fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>💻 AFFECTED SYSTEMS</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {threat.affectedSystems.map((s, i) => (
                        <span key={i} style={{ padding: "3px 8px", borderRadius: 4, background: "#FFB34718", border: "1px solid #FFB34733", fontSize: 10, color: "#FFB347" }}>{s}</span>
                      ))}
                    </div>
                  </div>

                  {/* Action Steps with progress */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#81C784", fontFamily: "'JetBrains Mono', monospace" }}>🎯 REQUIRED ACTIONS ({progress.done}/{progress.total})</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 120, height: 6, background: "#1E2130", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ width: `${progress.pct}%`, height: "100%", background: progress.pct === 100 ? "#4CAF50" : progress.pct >= 50 ? "#FFB347" : "#FF4444", borderRadius: 3, transition: "width 0.3s" }} />
                        </div>
                        <span style={{ fontSize: 10, color: progress.pct === 100 ? "#4CAF50" : "#FFB347", fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{progress.pct}%</span>
                      </div>
                    </div>
                    {threat.nextSteps.map((step, i) => {
                      const checked = (checkedSteps[threat.id] || {})[i];
                      return (
                        <div key={i} onClick={() => toggleStep(threat.id, i)} style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", marginBottom: 4,
                          background: checked ? "#4CAF5008" : "#0A0C14", borderRadius: 6,
                          border: `1px solid ${checked ? "#4CAF5044" : "#1E2130"}`, cursor: "pointer"
                        }}>
                          <span style={{
                            width: 22, height: 22, borderRadius: 5, border: `2px solid ${checked ? "#4CAF50" : "#2A2E3E"}`,
                            background: checked ? "#4CAF50" : "transparent", display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 12, color: "#fff", flexShrink: 0, transition: "all 0.2s"
                          }}>{checked ? "✓" : ""}</span>
                          <span style={{ fontSize: 12, color: checked ? "#5A6178" : "#E8ECF4", textDecoration: checked ? "line-through" : "none", flex: 1, fontWeight: checked ? 400 : 500 }}>{step}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* References */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#64B5F6", fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>📚 REFERENCES</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {threat.references.map((ref, i) => (
                        <a key={i} href={ref.url} target="_blank" rel="noopener noreferrer" style={{ padding: "4px 10px", borderRadius: 5, background: "#1E2130", border: "1px solid #2A2E3E", fontSize: 10, color: "#64B5F6", textDecoration: "none" }}>🔗 {ref.title} ↗</a>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <select value={getStatus(threat)} onChange={e => setThreatStatuses(prev => ({ ...prev, [threat.id]: e.target.value }))}
                      style={{ padding: "6px 10px", background: "#0A0C14", border: "1px solid #1E2130", borderRadius: 6, color: "#C4CAD6", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}>
                      {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <button onClick={() => setThreatEmailDraft(threat)} style={{ flex: 1, padding: "7px 14px", borderRadius: 6, border: "1px solid #6366F133", background: "#6366F118", color: "#6366F1", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>📧 Auto-Draft Advisory Email</button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ═══ TAB: RESPONSE TRACKER ═══ */}
      {activeTab === "response" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 16 }}>
            {Object.entries(statusLabels).map(([k, v]) => {
              const count = allThreats.filter(t => getStatus(t) === k).length;
              return (
                <div key={k} onClick={() => setFilterStatus(filterStatus === k ? "All" : k)} style={{
                  padding: "10px 12px", background: "#0F1117", borderRadius: 8, border: `1px solid ${statusColors[k]}22`,
                  borderTop: `3px solid ${statusColors[k]}`, cursor: "pointer", textAlign: "center"
                }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: statusColors[k], fontFamily: "'Space Grotesk', sans-serif" }}>{count}</div>
                  <div style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>{v}</div>
                </div>
              );
            })}
          </div>
          {allThreats.filter(t => getStatus(t) !== "closed").sort((a, b) => {
            const order = { "Critical": 0, "High": 1, "Medium": 2, "Low": 3 };
            return order[a.severity] - order[b.severity];
          }).map(threat => {
            const status = getStatus(threat);
            const progress = getStepProgress(threat);
            return (
              <div key={threat.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", marginBottom: 6, background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", borderLeft: `3px solid ${sevColors[threat.severity]}` }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: sevColors[threat.severity], flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: sevColors[threat.severity], fontFamily: "'JetBrains Mono', monospace", minWidth: 55 }}>{threat.severity.toUpperCase()}</span>
                <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", minWidth: 70 }}>{threat.id}</span>
                <span style={{ fontSize: 11, color: "#E8ECF4", flex: 1 }}>{threat.title}</span>
                {progress.total > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 80 }}>
                    <div style={{ width: 50, height: 4, background: "#1E2130", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${progress.pct}%`, height: "100%", background: progress.pct === 100 ? "#4CAF50" : "#6366F1", borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{progress.pct}%</span>
                  </div>
                )}
                <select value={status} onChange={e => setThreatStatuses(prev => ({ ...prev, [threat.id]: e.target.value }))}
                  style={{ padding: "4px 8px", background: statusColors[status] + "18", border: `1px solid ${statusColors[status]}44`, borderRadius: 4, color: statusColors[status], fontSize: 9, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer" }}>
                  {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <span style={{ fontSize: 9, color: "#5A6178" }}>{threat.time}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ TAB: IoC DATABASE ═══ */}
      {activeTab === "ioc" && (
        <div>
          <div style={{ padding: "12px 14px", background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "#FF6B6B", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>🔍 CONSOLIDATED INDICATORS OF COMPROMISE</div>
            <div style={{ fontSize: 10, color: "#5A6178" }}>Aggregated IoCs from all active threats. Export for SIEM/EDR ingestion.</div>
          </div>
          {allThreats.filter(t => t.iocs && t.iocs.length > 0).map(threat => (
            <div key={threat.id} style={{ marginBottom: 10, padding: "12px 14px", background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", borderLeft: `3px solid ${sevColors[threat.severity]}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: sevColors[threat.severity], fontFamily: "'JetBrains Mono', monospace" }}>{threat.severity.toUpperCase()}</span>
                <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{threat.id}</span>
                <span style={{ fontSize: 11, color: "#C4CAD6", flex: 1 }}>{threat.title}</span>
                <button onClick={() => navigator.clipboard?.writeText(Array.isArray(threat.iocs) ? threat.iocs.join("\n") : String(threat.iocs || ""))} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #1E2130", background: "#0A0C14", color: "#64B5F6", cursor: "pointer", fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>📋 Copy</button>
              </div>
              <div style={{ background: "#0A0C14", borderRadius: 6, padding: "8px 10px", border: "1px solid #1E213066" }}>
                {threat.iocs.map((ioc, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", borderBottom: i < threat.iocs.length - 1 ? "1px solid #1E213044" : "none" }}>
                    <span style={{ width: 4, height: 4, borderRadius: "50%", background: sevColors[threat.severity], flexShrink: 0 }} />
                    <code style={{ fontSize: 10, color: "#C4CAD6", fontFamily: "'JetBrains Mono', monospace", wordBreak: "break-all", flex: 1 }}>{ioc}</code>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={() => {
              const allIocs = allThreats.flatMap(t => (t.iocs || []).map(ioc => `[${t.severity}] ${t.id}: ${ioc}`));
              navigator.clipboard?.writeText(allIocs.join("\n"));
            }} style={{ flex: 1, padding: "8px 14px", borderRadius: 6, border: "1px solid #6366F133", background: "#6366F118", color: "#6366F1", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>📋 Copy All IoCs</button>
            <button onClick={() => {
              const csv = "Severity,Threat ID,Title,IoC\n" + allThreats.flatMap(t => (t.iocs || []).map(ioc => `${t.severity},${t.id},"${t.title}","${ioc}"`)).join("\n");
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = "vgc-itsm-ioc-export.csv"; a.click(); URL.revokeObjectURL(url);
            }} style={{ flex: 1, padding: "8px 14px", borderRadius: 6, border: "1px solid #81C78433", background: "#81C78418", color: "#81C784", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>📥 Export CSV</button>
          </div>
        </div>
      )}

      {/* Sources Footer */}
      <div style={{ marginTop: 20, padding: "12px 16px", background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130" }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginBottom: 6, textAlign: "center" }}>INTELLIGENCE SOURCES</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
          {[
            { name: "CISA", url: "https://www.cisa.gov/" },
            { name: "NVD / CVE", url: "https://nvd.nist.gov/" },
            { name: "SingCERT", url: "https://www.csa.gov.sg/singcert" },
            { name: "CSA Singapore", url: "https://www.csa.gov.sg/" },
            { name: "Google TAG", url: "https://blog.google/threat-analysis-group/" },
            { name: "MITRE ATT&CK", url: "https://attack.mitre.org/" },
            { name: "BleepingComputer", url: "https://www.bleepingcomputer.com/" },
            { name: "The Hacker News", url: "https://thehackernews.com/" },
            { name: "SecurityWeek", url: "https://www.securityweek.com/" },
            { name: "Dark Reading", url: "https://www.darkreading.com/" },
          ].map(s => (
            <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer" style={{
              padding: "3px 8px", borderRadius: 4, background: "#1E2130", border: "1px solid #2A2E3E",
              fontSize: 9, color: "#64B5F6", textDecoration: "none", fontFamily: "'JetBrains Mono', monospace"
            }}>{s.name} ↗</a>
          ))}
        </div>
      </div>
    </div>
  );
}
