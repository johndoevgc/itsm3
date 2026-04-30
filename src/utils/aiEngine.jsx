import React from "react";
import { COLORS } from "../constants/theme.js";
import { PRIORITY } from "../constants/status.js";
import { CATEGORIES } from "../constants/categories.js";
import { computeIncidentSla } from "./slaHelpers.js";
import { DEFAULT_SLA_POLICY } from "../constants/status.js";
import { SHAREPOINT_KB_CONFIG, KB_CATEGORIES } from "../constants/categories.js";

// ─── AI Engine (Simulated) ───────────────────────────────────────────────
export const AI_CONFIDENCE_COLORS = {
  high: { bg: "#0D2D1A", text: "#81C784", border: "#81C78444" },
  medium: { bg: "#2D1F0A", text: "#FFB347", border: "#FFB34744" },
  low: { bg: "#2D0A0A", text: "#FF6B6B", border: "#FF6B6B44" },
};

export const AI_KB_MAP = {
  "password": ["KB001", "KB007"], "reset": ["KB001"], "lockout": ["KB001", "KB007"], "login": ["KB001", "KB007"],
  "vpn": ["KB002", "KB005"], "network": ["KB002", "KB005", "KB009"], "firewall": ["KB005"],
  "software": ["KB003"], "install": ["KB003"], "license": ["KB003"],
  "email": ["KB004"], "outlook": ["KB004"], "exchange": ["KB004"], "mailbox": ["KB004"],
  "azure": ["KB006", "KB014"], "vm": ["KB006"], "cloud": ["KB006", "KB010"],
  "mfa": ["KB007", "KB001"], "sso": ["KB007", "KB001"], "conditional access": ["KB007"], "entra": ["KB007"],
  "incident": ["KB008"], "triage": ["KB008"], "escalation": ["KB008"], "sla": ["KB008"],
  "dns": ["KB009"], "dhcp": ["KB009"],
  "teams": ["KB010"], "sharepoint": ["KB010"], "onedrive": ["KB010"], "m365": ["KB010"],
  "rdp": ["KB011"], "remote desktop": ["KB011"], "remote session": ["KB011"],
  "iso": ["KB012"], "audit": ["KB012"], "compliance": ["KB012", "KB015"],
  "change management": ["KB013"], "rfc": ["KB013"], "cab": ["KB013"], "rollback": ["KB013"],
  "backup": ["KB014"], "restore": ["KB014"], "disaster recovery": ["KB014"], "dr": ["KB014"],
  "pdpa": ["KB015"], "dsar": ["KB015"], "data protection": ["KB015"], "privacy": ["KB015"],
  "security": ["KB007", "KB012", "KB015"], "access": ["KB001", "KB007", "KB012"],
};

// ─── KB Search & Relevance Engine ─────────────────────────────────────
export function searchKBArticles(query, kbArticles, maxResults = 5) {
  if (!query) return [];
  const lower = query.toLowerCase();
  const words = lower.split(/\s+/).filter(w => w.length > 2);
  const scored = kbArticles.map(art => {
    let score = 0;
    const searchable = `${art.title} ${art.category} ${art.content} ${(art.tags || []).join(" ")} ${art.whenToUse || ""} ${art.bestFor || ""}`.toLowerCase();
    // Direct KB ID match from AI_KB_MAP
    for (const [keyword, ids] of Object.entries(AI_KB_MAP)) {
      if (lower.includes(keyword) && ids.includes(art.id)) score += 30;
    }
    // Tag match (highest weight)
    (art.tags || []).forEach(tag => { if (lower.includes(tag.toLowerCase())) score += 20; });
    // Title match
    words.forEach(w => { if ((art.title || "").toLowerCase().includes(w)) score += 15; });
    // Category match
    if (lower.includes((art.category || "").toLowerCase())) score += 10;
    // Content/whenToUse match
    words.forEach(w => { if (searchable.includes(w)) score += 5; });
    return { ...art, relevanceScore: score };
  });
  return scored.filter(a => a.relevanceScore > 0).sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, maxResults);
}

export const AI_CATEGORY_KEYWORDS = {
  Hardware: ["laptop", "printer", "screen", "monitor", "keyboard", "mouse", "hardware", "device", "battery", "charger", "dock"],
  Software: ["sap", "application", "app", "software", "install", "update", "crash", "error", "login", "license"],
  Network: ["vpn", "wifi", "network", "internet", "connectivity", "dns", "firewall", "bandwidth", "latency"],
  Security: ["security", "breach", "virus", "malware", "phishing", "unauthorized", "access denied", "hack"],
  Access: ["password", "reset", "account", "locked", "permission", "role", "sso", "mfa", "authentication"],
  Email: ["email", "outlook", "exchange", "smtp", "mailbox", "calendar", "meeting"],
  Database: ["database", "sql", "query", "timeout", "connection", "migration", "backup", "replication"],
  Cloud: ["cloud", "azure", "aws", "vm", "container", "kubernetes", "storage", "blob"],
};

export const AI_PRIORITY_RULES = {
  "Sev-A": ["unresponsive", "down", "outage", "breach", "critical", "production", "all users", "data loss"],
  "Sev-B": ["cannot", "failure", "multiple users", "degraded", "slow", "timeout", "urgent"],
  "Sev-C": ["intermittent", "some users", "workaround", "delay"],
  "Sev-D": ["request", "question", "enhancement", "minor", "cosmetic", "how do i", "inquiry"],
};

export const AI_ASSIGNEE_SKILLS = {
  "Marcus Chen": ["Software", "Email", "Access", "Database"],
  "Sofia Rodriguez": ["Hardware", "Access", "Email"],
  "James Wright": ["Network", "Security", "Cloud", "Database"],
  "VGC Admin": ["Cloud", "Security", "Software"],
};

export const aiAnalyzeIncident = (title, description) => {
  const text = `${title} ${description}`.toLowerCase();
  let suggestedCategory = "Software";
  let catScore = 0;
  for (const [cat, keywords] of Object.entries(AI_CATEGORY_KEYWORDS)) {
    const score = keywords.filter(kw => text.includes(kw)).length;
    if (score > catScore) { catScore = score; suggestedCategory = cat; }
  }
  let suggestedPriority = "Sev-C";
  for (const [pri, keywords] of Object.entries(AI_PRIORITY_RULES)) {
    if (keywords.some(kw => text.includes(kw))) { suggestedPriority = pri; break; }
  }
  let suggestedAssignee = "";
  let bestMatch = 0;
  for (const [agent, skills] of Object.entries(AI_ASSIGNEE_SKILLS)) {
    const match = skills.includes(suggestedCategory) ? 1 : 0;
    if (match > bestMatch) { bestMatch = match; suggestedAssignee = agent; }
  }
  const kbSuggestions = [];
  for (const [keyword, kbIds] of Object.entries(AI_KB_MAP)) {
    if (text.includes(keyword)) kbIds.forEach(id => { if (!kbSuggestions.includes(id)) kbSuggestions.push(id); });
  }
  const confidence = Math.min(98, 65 + catScore * 10 + (suggestedAssignee ? 5 : 0));
  return { suggestedCategory, suggestedPriority, suggestedAssignee, confidence, kbSuggestions };
};

export const aiAnalyzeChange = (title, description) => {
  const text = `${title} ${description}`.toLowerCase();
  let riskScore = 20;
  if (text.includes("production") || text.includes("database")) riskScore += 30;
  if (text.includes("migration") || text.includes("upgrade")) riskScore += 20;
  if (text.includes("emergency")) riskScore += 25;
  if (text.includes("firewall") || text.includes("security")) riskScore += 15;
  if (text.includes("minor") || text.includes("cosmetic")) riskScore -= 10;
  const risk = riskScore >= 70 ? "High" : riskScore >= 40 ? "Medium" : "Low";
  const confidence = Math.min(95, 70 + Math.floor(Math.random() * 15));
  return {
    riskLevel: risk, riskScore: Math.min(100, riskScore), confidence,
    impactAnalysis: riskScore >= 70 ? "High impact — may affect production services" : riskScore >= 40 ? "Moderate impact — limited service disruption possible" : "Low impact — minimal risk to services",
    recommendation: riskScore >= 70 ? "Recommend CAB review and off-hours implementation window" : riskScore >= 40 ? "Standard approval process recommended" : "Pre-approved — can proceed with standard change process"
  };
};

export const aiPredictSLA = (priority, category) => {
  const sev = DEFAULT_SLA_POLICY.severities[priority];
  const baseHours = sev ? sev.worstResponse : 9;
  const catMultiplier = { Hardware: 1.3, Network: 0.9, Database: 1.1, Security: 0.8, Software: 1.0, Email: 0.7, Access: 0.5, Cloud: 1.2 };
  const predicted = Math.round(baseHours * (catMultiplier[category] || 1.0));
  const confidence = Math.min(92, 75 + Math.floor(Math.random() * 12));
  return { predictedHours: predicted, confidence };
};

// ─── Smart AI Response Engine ─────────────────────────────────────────
export const AI_TOPIC_RESPONSES = [
  { keys: ["help", "what can you do", "how to", "guide", "tutorial", "menu", "options", "features"], topic: "help" },
  { keys: ["hello", "hi", "hey", "good morning", "good afternoon", "good evening", "yo", "sup"], topic: "greet" },
  { keys: ["thank", "thanks", "thx", "cheers", "appreciated", "great job", "awesome", "nice"], topic: "thanks" },
  { keys: ["incident", "ticket", "create ticket", "new ticket", "log ticket", "raise ticket", "open ticket"], topic: "incident" },
  { keys: ["sla", "service level", "breach", "overdue", "deadline", "response time", "resolution time"], topic: "sla" },
  { keys: ["change", "change request", "rfc", "change management", "cab", "approval", "deploy", "release"], topic: "change" },
  { keys: ["problem", "root cause", "rca", "pattern", "recurring", "trend", "workaround"], topic: "problem" },
  { keys: ["kb", "knowledge", "article", "documentation", "wiki", "how to fix", "solution", "troubleshoot"], topic: "kb" },
  { keys: ["report", "analytics", "dashboard", "metric", "kpi", "statistic", "automation rate"], topic: "report" },
  { keys: ["security", "threat", "cyber", "attack", "vulnerability", "phishing", "malware", "ransomware", "hack"], topic: "security" },
  { keys: ["email", "draft", "compose", "send email", "reply", "respond", "write email", "notification"], topic: "email" },
  { keys: ["asset", "cmdb", "hardware", "software", "inventory", "device", "laptop", "server"], topic: "asset" },
  { keys: ["user", "rbac", "role", "permission", "access"], topic: "user" },
  { keys: ["iso", "27001", "compliance", "audit", "control", "isms", "certification"], topic: "compliance" },
  { keys: ["pdpa", "data protection", "privacy", "personal data", "consent", "dsar"], topic: "pdpa" },
  { keys: ["entra", "azure ad", "sso", "single sign", "mfa", "authentication", "scim", "directory"], topic: "entra" },
  { keys: ["billing", "invoice", "license", "subscription", "cost", "pricing", "payment"], topic: "billing" },
  { keys: ["smtp", "mail server", "email config", "notification setting"], topic: "smtp" },
  { keys: ["integration", "connect", "slack", "teams", "jira", "servicenow", "pagerduty"], topic: "integration" },
  { keys: ["test", "testing", "check", "verify", "try", "demo", "sample", "ping", "status"], topic: "status" },
  { keys: ["weather", "temperature", "rain", "forecast"], topic: "weather" },
  { keys: ["who are you", "about", "your name", "what are you", "introduce", "yourself"], topic: "about" },
  { keys: ["morning", "briefing", "priority plan", "daily plan", "what should i do", "plan", "today", "urgent", "priority"], topic: "briefing" },
  { keys: ["schedule", "meeting", "appointment", "remote session", "calendar", "upcoming"], topic: "schedule" },
  { keys: ["notify", "notice", "alert engineer", "send notice", "inform", "escalate"], topic: "notify" },
  { keys: ["good", "bad", "how", "what", "why", "when", "where", "which", "can", "could", "would", "should", "tell", "show", "find", "get", "list", "give"], topic: null },
];

export function matchAiTopic(userMsg) {
  const lower = userMsg.toLowerCase();
  for (const entry of AI_TOPIC_RESPONSES) {
    for (const key of entry.keys) {
      if (key.includes(" ") && lower.includes(key)) return entry.topic;
    }
  }
  for (const entry of AI_TOPIC_RESPONSES) {
    for (const key of entry.keys) {
      if (!key.includes(" ") && lower.includes(key)) return entry.topic;
    }
  }
  return null;
}

// ─── AI Rich Text Renderer ──────────────────────────────────────────────
// Converts markdown-like AI text into React elements with clickable links, animated emoji, and highlights
export const ANIMATED_EMOJI_SET = new Set(["🚨","🔴","🟠","⚠️","❌","💥","🔥","⏱️","🛡️","✅","💡","📊","📋","⚡","🎯","🆕","📧","🔍","📚","🔗","📎","👁","👍","🧠","🤖","📈","📉","🔒","🔓","💬","🎫","🗂️","📝","🆘","🚀","💎","⭐","🏆","🏅"]);
export const TICKET_LINK_RE = /(INC\d{4,}|CHG\d{4,}|PRB\d{4,}|REQ\d{4,}|KB\d{3,}|SVC\d{3,})/g;
export const BOLD_RE = /\*\*(.+?)\*\*/g;
export const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

export function renderAiRichText(text, onTicketClick) {
  if (!text) return null;
  const lines = text.split("\n");
  return lines.map((line, li) => {
    // Process each line into segments
    const segments = [];
    let remaining = line;
    let key = 0;

    // First extract markdown links [text](url)
    const parts = [];
    let lastIdx = 0;
    let linkMatch;
    const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((linkMatch = linkRe.exec(remaining)) !== null) {
      if (linkMatch.index > lastIdx) parts.push({ type: "text", value: remaining.slice(lastIdx, linkMatch.index) });
      parts.push({ type: "link", label: linkMatch[1], url: linkMatch[2] });
      lastIdx = linkRe.lastIndex;
    }
    if (lastIdx < remaining.length) parts.push({ type: "text", value: remaining.slice(lastIdx) });

    // Process text parts for bold, ticket IDs, animated emoji
    const processText = (str) => {
      const result = [];
      // Split by bold markers first
      const boldParts = str.split(/(\*\*.+?\*\*)/g);
      boldParts.forEach((bp, bpi) => {
        const boldMatch = bp.match(/^\*\*(.+?)\*\*$/);
        if (boldMatch) {
          // Bold text — check for ticket IDs inside
          const inner = boldMatch[1];
          const ticketParts = inner.split(TICKET_LINK_RE);
          result.push(
            React.createElement("strong", { key: `b${bpi}`, style: { color: "#E8ECF4", fontWeight: 700 } },
              ...ticketParts.map((tp, tpi) => {
                if (TICKET_LINK_RE.test(tp)) {
                  TICKET_LINK_RE.lastIndex = 0;
                  return React.createElement("span", {
                    key: `t${tpi}`,
                    onClick: (e) => { e.stopPropagation(); onTicketClick?.(tp); },
                    style: { color: "#6366F1", cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 },
                    onMouseOver: (e) => { e.target.style.color = "#818CF8"; e.target.style.textDecoration = "underline"; },
                    onMouseOut: (e) => { e.target.style.color = "#6366F1"; e.target.style.textDecoration = "underline"; e.target.style.textDecorationStyle = "dotted"; },
                    title: `Click to view ${tp}`
                  }, tp);
                }
                return tp;
              })
            )
          );
        } else if (bp) {
          // Non-bold text — process for ticket IDs and animated emoji
          const ticketParts = bp.split(TICKET_LINK_RE);
          ticketParts.forEach((tp, tpi) => {
            if (TICKET_LINK_RE.test(tp)) {
              TICKET_LINK_RE.lastIndex = 0;
              result.push(React.createElement("span", {
                key: `tl${bpi}-${tpi}`,
                onClick: (e) => { e.stopPropagation(); onTicketClick?.(tp); },
                style: { color: "#6366F1", cursor: "pointer", fontWeight: 600, textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3, fontFamily: "'JetBrains Mono', monospace", fontSize: "0.92em" },
                onMouseOver: (e) => { e.target.style.color = "#818CF8"; },
                onMouseOut: (e) => { e.target.style.color = "#6366F1"; },
                title: `Click to view ${tp}`
              }, tp));
            } else {
              // Check for animated emoji
              const emojiRe = /([\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{FE0F}][\u{FE0F}\u{20E3}]?)/gu;
              const emojiParts = tp.split(emojiRe);
              emojiParts.forEach((ep, epi) => {
                if (emojiRe.test(ep)) {
                  emojiRe.lastIndex = 0;
                  const isImportant = ANIMATED_EMOJI_SET.has(ep);
                  result.push(React.createElement("span", {
                    key: `e${bpi}-${tpi}-${epi}`,
                    style: isImportant ? { display: "inline-block", animation: "emojiBounce 2s ease-in-out infinite", fontSize: "1.05em" } : {}
                  }, ep));
                } else if (ep) {
                  // Highlight important keywords
                  const highlighted = ep.replace(/(CRITICAL|URGENT|BREACH|IMMEDIATE|WARNING|ESCALAT\w+|SLA\s*\d+%?\s*elapsed)/gi, (match) => `§HL§${match}§/HL§`);
                  if (highlighted.includes("§HL§")) {
                    highlighted.split(/(§HL§.+?§\/HL§)/g).forEach((hp, hpi) => {
                      const hlMatch = hp.match(/^§HL§(.+?)§\/HL§$/);
                      if (hlMatch) {
                        result.push(React.createElement("span", {
                          key: `h${bpi}-${tpi}-${epi}-${hpi}`,
                          style: { color: "#FF6B6B", fontWeight: 700, background: "#FF6B6B11", padding: "0 4px", borderRadius: 3, animation: "highlightPulse 3s ease-in-out infinite" }
                        }, hlMatch[1]));
                      } else if (hp) {
                        result.push(hp);
                      }
                    });
                  } else {
                    result.push(ep);
                  }
                }
              });
            }
          });
        }
      });
      return result;
    };

    const lineElements = parts.map((part, pi) => {
      if (part.type === "link") {
        return React.createElement("a", {
          key: `lk${pi}`,
          href: part.url,
          target: "_blank",
          rel: "noopener noreferrer",
          style: { color: "#06B6D4", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3, cursor: "pointer", fontWeight: 500 },
          onMouseOver: (e) => { e.target.style.color = "#22D3EE"; },
          onMouseOut: (e) => { e.target.style.color = "#06B6D4"; },
          onClick: (e) => e.stopPropagation()
        }, `🔗 ${part.label}`);
      }
      return React.createElement(React.Fragment, { key: `p${pi}` }, ...processText(part.value));
    });

    return React.createElement("span", { key: `ln${li}` }, ...lineElements, li < lines.length - 1 ? "\n" : null);
  });
}

// Context-aware AI response builder (runs inside component with access to state)
export function buildAiResponse(topic, userMsg, ctx) {
  const { incidents, changes, problems, requests, currentUser, proactiveAlerts, kbArticles: ctxKbArticles } = ctx;
  const openInc = incidents.filter(i => i.status === "Open" || i.status === "In Progress");
  const criticalInc = openInc.filter(i => i.priority === "Sev-A");
  const highInc = openInc.filter(i => i.priority === "Sev-B");
  const myTickets = openInc.filter(i => i.assignee === currentUser.name);
  const pendingChanges = changes.filter(c => c.status === "Awaiting Approval" || c.status === "Implementing");
  const activeAlerts = proactiveAlerts || [];
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // Build urgency header if critical/high issues exist
  const urgencyBlock = (criticalInc.length > 0 || highInc.length > 0) ? 
    `\n\n🚨 **ATTENTION — ${criticalInc.length} Critical & ${highInc.length} High priority tickets active**` +
    criticalInc.map(i => { const s = computeIncidentSla(i); return `\n   🔴 **${i.id}**: ${i.title} — ${i.assignee} (${s.pctUsed}% SLA elapsed)`; }).join("") +
    highInc.slice(0, 3).map(i => `\n   🟠 **${i.id}**: ${i.title} — ${i.assignee}`).join("") : "";

  // Suggested actions based on context
  const suggestActions = [];

  switch (topic) {
    case "greet":
      if (criticalInc.length > 0) {
        suggestActions.push({ label: "🔴 View critical tickets", action: "Show me all Sev-A incidents" });
        suggestActions.push({ label: "⏱️ Check SLA status", action: "What tickets are near SLA breach?" });
      }
      suggestActions.push({ label: "📋 My open tickets", action: "Show my assigned tickets" });
      suggestActions.push({ label: "📊 Daily briefing", action: "Give me my morning briefing" });
      return {
        text: `${greeting}, ${currentUser.name}! 👋 Great to have you here.\n\n📊 **Quick Status:**\n• 🎫 Open tickets: **${openInc.length}** (${criticalInc.length} Critical, ${highInc.length} High)\n• 🔄 Pending changes: **${pendingChanges.length}**\n• 👤 Your assigned: **${myTickets.length}** tickets${urgencyBlock}\n\nHow can I help you today?`,
        suggestions: suggestActions
      };

    case "briefing": {
      const atRiskSLA = openInc.filter(i => { const s = computeIncidentSla(i); return s.pctUsed >= 70; });
      const emergencyChanges = changes.filter(c => c.type === "Emergency" && c.status === "Implementing");
      suggestActions.push({ label: "🔴 Handle critical first", action: criticalInc[0] ? `Tell me about ${criticalInc[0].id}` : "Show all incidents" });
      if (atRiskSLA.length > 0) suggestActions.push({ label: "⏱️ Address SLA risks", action: "Which tickets are near SLA breach?" });
      if (pendingChanges.length > 0) suggestActions.push({ label: "📋 Review pending changes", action: "Show pending change approvals" });
      suggestActions.push({ label: "📧 Draft status update", action: "Draft a morning status email" });
      
      let briefing = `📋 **${greeting}, ${currentUser.name} — Your Priority Plan for Today**\n\n`;
      briefing += `**🔴 CRITICAL — Do First:**\n`;
      if (criticalInc.length > 0) {
        criticalInc.forEach(i => { const s = computeIncidentSla(i); briefing += `• **${i.id}**: ${i.title} — SLA ${s.pctUsed}% elapsed (${Math.round(s.remainingHours)}h remaining)\n  → Recommended: Escalate to ${i.assignmentGroup}, verify workaround in place\n`; });
      } else {
        briefing += `• ✅ No critical incidents — great start!\n`;
      }
      briefing += `\n**🟠 HIGH PRIORITY — Address Next:**\n`;
      if (highInc.length > 0) {
        highInc.forEach(i => { briefing += `• **${i.id}**: ${i.title} — ${i.status} (${i.assignee})\n`; });
      } else {
        briefing += `• ✅ No high-priority tickets pending\n`;
      }
      briefing += `\n**🔄 CHANGES IN PROGRESS:**\n`;
      if (emergencyChanges.length > 0) {
        emergencyChanges.forEach(c => { briefing += `• ⚡ **${c.id}**: ${c.title} — EMERGENCY (${c.scheduledEnd})\n`; });
      }
      pendingChanges.filter(c => c.type !== "Emergency").forEach(c => { briefing += `• **${c.id}**: ${c.title} — ${c.status}\n`; });
      if (pendingChanges.length === 0 && emergencyChanges.length === 0) briefing += `• No active changes\n`;
      briefing += `\n**📊 Risk Summary:**\n`;
      briefing += `• SLA at risk: **${atRiskSLA.length}** tickets\n`;
      briefing += `• Active security alerts: **${activeAlerts.filter(a => a.severity === "critical" || a.severity === "high").length}**\n`;
      briefing += `• Open problems: **${problems.filter(p => p.status !== "Closed").length}**\n`;
      briefing += `\n💡 *Shall I help you work through these items one by one?*`;
      return { text: briefing, suggestions: suggestActions };
    }

    case "incident": {
      suggestActions.push({ label: "📋 View all open", action: "List all open incidents" });
      if (criticalInc.length > 0) suggestActions.push({ label: "🔴 Critical tickets", action: "Show Sev-A incidents" });
      suggestActions.push({ label: "➕ Create new", action: "How do I create a new incident?" });
      suggestActions.push({ label: "📊 Incident trends", action: "Show incident analytics" });
      let resp = `📋 **Incident Overview**\n\n`;
      resp += `**Active Tickets:** ${openInc.length}\n`;
      resp += `• 🔴 Sev-A (Critical): ${criticalInc.length}\n• 🟠 Sev-B (High): ${highInc.length}\n`;
      resp += `• 🟡 Sev-C: ${openInc.filter(i => i.priority === "Sev-C").length}\n• 🟢 Sev-D: ${openInc.filter(i => i.priority === "Sev-D").length}\n`;
      if (criticalInc.length > 0) {
        resp += `\n⚡ **Requires Immediate Attention:**\n`;
        criticalInc.forEach(i => {
          resp += `• **${i.id}**: ${i.title}\n  → Assigned: ${i.assignee} | SLA: ${computeIncidentSla(i).pctUsed}% elapsed\n  → Impact: ${i.impact} | Category: ${i.category}\n`;
          // Show relevant KB for this incident's category
          const kbHits = searchKBArticles(i.category + " " + i.title, ctxKbArticles || [], 1);
          if (kbHits.length > 0) resp += `  → 📚 KB: **${kbHits[0].title}** (${kbHits[0].id}) — [Open in SharePoint](${kbHits[0].spSlug ? SHAREPOINT_KB_CONFIG.articleUrl(kbHits[0].spSlug) : '#'})\n`;
        });
        resp += `\n**Suggested Actions:**\n`;
        resp += `1. Review critical tickets above and apply KB quick-fix steps\n`;
        resp += `2. Escalate if containment not achieved within 30 minutes\n`;
        resp += `3. Notify stakeholders (I'll draft — you approve)\n\n`;
        resp += `💡 *Do you want me to draft an escalation email for your approval?*`;
        suggestActions.push({ label: "📧 Draft escalation", action: "Draft escalation email for critical incidents" });
      } else {
        resp += `\n✅ No critical incidents right now.\n\n`;
        // Suggest KB articles for most common open incident category
        const topCat = {};
        openInc.forEach(i => { topCat[i.category] = (topCat[i.category] || 0) + 1; });
        const topCategory = Object.entries(topCat).sort((a, b) => b[1] - a[1])[0];
        if (topCategory) {
          const kbHits = searchKBArticles(topCategory[0], ctxKbArticles || [], 2);
          if (kbHits.length > 0) {
            resp += `📚 **Relevant Knowledge Articles for ${topCategory[0]} tickets:**\n`;
            kbHits.forEach(art => { resp += `• **${art.title}** (${art.id}) — ${art.helpful}% helpful\n`; });
            resp += `\n`;
          }
        }
      }
      return { text: resp, suggestions: suggestActions };
    }

    case "sla": {
      const atRisk = openInc.filter(i => { const s = computeIncidentSla(i); return s.pctUsed >= 90; });
      const breached = openInc.filter(i => computeIncidentSla(i).isBreached);
      suggestActions.push({ label: "🚨 Breached tickets", action: "Show SLA breached tickets" });
      suggestActions.push({ label: "⏱️ At-risk tickets", action: "Which tickets are near breach?" });
      suggestActions.push({ label: "📧 Notify stakeholders", action: "Draft SLA warning email" });
      let resp = `⏱️ **SLA Compliance Dashboard**\n\n`;
      if (breached.length > 0) {
        resp += `🚨 **BREACHED (${breached.length}):**\n`;
        breached.forEach(i => { resp += `• **${i.id}**: ${i.title} — ${computeIncidentSla(i).pctUsed}% (OVER TARGET)\n`; });
        resp += `\n⚠️ *Immediate escalation recommended. Shall I draft an escalation notice for your approval?*\n\n`;
      }
      if (atRisk.length > breached.length) {
        resp += `⚠️ **At Risk (${atRisk.length - breached.length}):**\n`;
        atRisk.filter(i => !computeIncidentSla(i).isBreached).forEach(i => { resp += `• **${i.id}**: ${i.title} — ${computeIncidentSla(i).pctUsed}% elapsed\n`; });
        resp += `\n`;
      }
      resp += `**SLA Targets:** Sev-A: 4h | Sev-B: 8h | Sev-C: 24h | Sev-D: 72h\n`;
      resp += `**Healthy Tickets:** ${openInc.length - atRisk.length} within SLA\n`;
      resp += `\n💡 *I can proactively alert you at 80% SLA elapsed. Want me to draft a status update?*`;
      return { text: resp, suggestions: suggestActions };
    }

    case "change": {
      suggestActions.push({ label: "📋 View pending", action: "Show pending changes" });
      suggestActions.push({ label: "➕ New change request", action: "How to create a change request?" });
      suggestActions.push({ label: "⚡ Emergency changes", action: "Show emergency changes" });
      let resp = `🔄 **Change Management Summary**\n\n`;
      const grouped = { "Awaiting Approval": [], "Approved": [], "Implementing": [], "Completed": [] };
      changes.forEach(c => { if (grouped[c.status]) grouped[c.status].push(c); });
      if (grouped["Implementing"].length > 0) {
        resp += `⚡ **Currently Implementing:**\n`;
        grouped["Implementing"].forEach(c => { resp += `• **${c.id}**: ${c.title} (${c.type}, Risk: ${c.risk})\n  → Window: ${c.scheduledStart} to ${c.scheduledEnd}\n`; });
        resp += `\n`;
      }
      if (grouped["Awaiting Approval"].length > 0) {
        resp += `⏳ **Awaiting Approval:**\n`;
        grouped["Awaiting Approval"].forEach(c => { resp += `• **${c.id}**: ${c.title} — ${Array.isArray(c.approvers) ? c.approvers.map(a => `${a.name}: ${a.status}`).join(", ") : "No approvers"}\n`; });
        resp += `\n💡 *Shall I notify the approvers for a faster review?*\n\n`;
      }
      resp += `📊 Total changes: ${changes.length} | Pending: ${grouped["Awaiting Approval"].length}`;
      return { text: resp, suggestions: suggestActions };
    }

    case "problem": {
      const openProblems = problems.filter(p => p.status !== "Closed");
      suggestActions.push({ label: "🔍 View problems", action: "List all open problems" });
      suggestActions.push({ label: "📈 Pattern analysis", action: "Analyze incident patterns" });
      let resp = `🔍 **Problem Management Summary**\n\n`;
      openProblems.forEach(p => { resp += `• **${p.id}**: ${p.title}\n  → Status: ${p.status} | Priority: ${p.priority}\n  → Root Cause: ${p.rootCause}\n  → Linked Incidents: ${Array.isArray(p.linkedIncidents) ? p.linkedIncidents.join(", ") : (p.linkedIncidents || "None")}\n\n`; });
      if (openProblems.length === 0) resp += `✅ No open problems.\n\n`;
      const cats = {};
      openInc.forEach(i => { cats[i.category] = (cats[i.category] || 0) + 1; });
      const repeating = Object.entries(cats).filter(([, c]) => c >= 2);
      if (repeating.length > 0) {
        resp += `📈 **Pattern Alert:** Recurring categories detected:\n`;
        repeating.forEach(([cat, count]) => { resp += `• ${cat}: ${count} incidents — consider creating a Problem record\n`; });
        suggestActions.push({ label: "🆕 Create problem", action: `Create problem for ${repeating[0][0]} incidents` });
      }
      return { text: resp, suggestions: suggestActions };
    }

    case "security": {
      suggestActions.push({ label: "🛡️ View all threats", action: "Show all security alerts" });
      suggestActions.push({ label: "📧 Draft alert email", action: "Draft security notification email" });
      suggestActions.push({ label: "📋 ISO 27001 status", action: "Check ISO 27001 compliance" });
      let resp = `🛡️ **Security & Threat Intelligence**\n\n`;
      const secAlerts = activeAlerts.filter(a => a.id?.startsWith("sec-"));
      if (secAlerts.length > 0 || criticalInc.some(i => i.category === "Security")) {
        resp += `🚨 **Active Threats:**\n`;
        secAlerts.forEach(a => { resp += `• ${a.title}\n`; });
        resp += `\n⚠️ *Recommend immediate review and stakeholder notification. Shall I draft an alert email for your approval?*\n\n`;
      } else {
        resp += `✅ No critical security alerts at this time.\n\n`;
      }
      resp += `**Security Posture:**\n• ISO 27001:2022: Compliant\n• PDPA: Active monitoring\n• Last security scan: Today\n• MFA enforcement: Active\n`;
      return { text: resp, suggestions: suggestActions };
    }

    case "notify": {
      suggestActions.push({ label: "✅ Approve & send", action: "Yes, send the notification" });
      suggestActions.push({ label: "✏️ Let me customize", action: "Let me review the draft first" });
      suggestActions.push({ label: "❌ Cancel", action: "No, don't send anything" });
      let resp = `📢 **Engineer Notification — Approval Required**\n\n`;
      resp += `Before I send any notice, I'll prepare a draft for your review.\n\n`;
      if (criticalInc.length > 0) {
        resp += `**Suggested Notification:**\n`;
        resp += `📧 Subject: "URGENT: ${criticalInc.length} Critical Incident(s) Require Attention"\n`;
        resp += `👥 Recipients: ${[...new Set(criticalInc.map(i => i.assignee))].join(", ")}\n`;
        resp += `📝 Content: Escalation notice for ${criticalInc.map(i => i.id).join(", ")}\n\n`;
        resp += `⚠️ *I will NOT send this until you approve. Shall I draft the full email?*`;
      } else {
        resp += `No critical items requiring immediate notification.\n`;
        resp += `💡 *Tell me what you'd like to notify the team about and I'll draft it for your approval.*`;
      }
      return { text: resp, suggestions: suggestActions };
    }

    case "schedule": {
      suggestActions.push({ label: "📅 View schedule", action: "What meetings do I have today?" });
      suggestActions.push({ label: "🔄 Prep for next session", action: "Prepare agenda for my next meeting" });
      suggestActions.push({ label: "📋 Action items", action: "Show my action items" });
      const upcomingChanges = changes.filter(c => c.scheduledStart && (c.status === "Approved" || c.status === "Implementing"));
      let resp = `📅 **Schedule & Upcoming Sessions**\n\n`;
      if (upcomingChanges.length > 0) {
        resp += `**Upcoming Change Windows:**\n`;
        upcomingChanges.forEach(c => { resp += `• **${c.id}**: ${c.title}\n  → ${c.scheduledStart} – ${c.scheduledEnd}\n  → Status: ${c.status} | Risk: ${c.risk}\n`; });
        resp += `\n💡 *I can prepare a pre-change checklist and notify stakeholders before the window opens. Shall I proceed?*\n\n`;
        suggestActions.push({ label: "📧 Notify stakeholders", action: `Prepare notification for ${upcomingChanges[0].id}` });
      } else {
        resp += `No scheduled change windows at this time.\n\n`;
      }
      resp += `**Planned Actions:**\n`;
      resp += `• Review open tickets assigned to you: ${myTickets.length}\n`;
      resp += `• Pending approvals: ${changes.filter(c => c.status === "Awaiting Approval").length}\n`;
      resp += `\n*I'll proactively remind you 30 minutes before any scheduled session and suggest preparation steps.*`;
      return { text: resp, suggestions: suggestActions };
    }

    case "email": {
      suggestActions.push({ label: "📧 Draft incident update", action: criticalInc[0] ? `Draft email for ${criticalInc[0].id}` : "Draft incident update email" });
      suggestActions.push({ label: "📢 Team notification", action: "Draft team status update" });
      suggestActions.push({ label: "⚙️ SMTP settings", action: "Show SMTP configuration" });
      let resp = `📧 **Email & Communications**\n\nI can draft professional emails and seek your approval before sending:\n\n`;
      resp += `**Available Templates:**\n`;
      resp += `• 🎫 Ticket response (first response, update, resolution)\n• 🚨 Security threat notification\n• ⏱️ SLA warning to stakeholders\n• 📊 Daily/weekly status report\n• 📢 Change notification to affected users\n\n`;
      if (criticalInc.length > 0) {
        resp += `⚡ **Suggested:** Draft an escalation email for ${criticalInc.map(i => i.id).join(", ")}?\n`;
        resp += `*I'll prepare it for your review — nothing sends without your OK.*`;
      } else {
        resp += `💡 *Tell me what to draft and I'll prepare it for your approval.*`;
      }
      return { text: resp, suggestions: suggestActions };
    }

    case "status": {
      suggestActions.push({ label: "📊 Full dashboard", action: "Show dashboard summary" });
      suggestActions.push({ label: "📋 My tickets", action: "Show my assigned tickets" });
      suggestActions.push({ label: "🛡️ Security status", action: "Check security alerts" });
      const totalTickets = incidents.length + requests.length + problems.length + changes.length;
      let resp = `✅ **VGC-ITSM System Status — All Systems Operational**\n\n`;
      resp += `• 🟢 Application: Online\n• 🟢 AI Engine: Active & Learning\n• 🟢 Email Service: Configured\n• 🟢 Security: ISO 27001 compliant\n\n`;
      resp += `**Live Stats:**\n`;
      resp += `• Total tickets managed: ${totalTickets}\n• Open incidents: ${openInc.length}\n• SLA compliance: ${openInc.length > 0 ? Math.round((openInc.filter(i => !computeIncidentSla(i).isBreached).length / openInc.length) * 100) : 100}%\n`;
      resp += `• AI triage accuracy: 92%\n\n`;
      resp += `💡 *I'm learning from every interaction to serve you better!*`;
      return { text: resp, suggestions: suggestActions };
    }

    case "help":
      suggestActions.push({ label: "📊 Daily briefing", action: "Give me my morning briefing" });
      suggestActions.push({ label: "🎫 Open tickets", action: "Show open incidents" });
      suggestActions.push({ label: "📚 Knowledge Portal", action: "Search knowledge base" });
      suggestActions.push({ label: "🛡️ Security check", action: "Any security threats?" });
      suggestActions.push({ label: "📧 Draft email", action: "Help me draft an email" });
      return {
        text: `I'm your VGC-ITSM AI Co-Pilot — enterprise-grade assistance at your fingertips! 🚀\n\n**Core Capabilities:**\n🎫 **Incident Triage** — Severity assessment, smart routing & containment steps\n🔍 **Problem Analysis** — Pattern detection, root cause suggestions\n📋 **Change Management** — Risk analysis, approval tracking & rollback planning\n📚 **Knowledge Portal** — SharePoint-linked articles with quick-fix steps\n⏱️ **SLA Monitoring** — Proactive breach prevention & escalation\n🛡️ **Security & Compliance** — Threat alerts, ISO 27001, PDPA\n📧 **Communications** — Drafts for your approval before sending\n📊 **Morning Briefing** — Priority plan, risks & ready-to-go actions\n📅 **Schedule Planning** — Meeting prep & proactive reminders\n\n**How to use me best:**\n• Give me a ticket ID or describe an issue — I'll find the right KB article\n• Say "morning briefing" for your daily priority plan\n• Ask me to draft emails — I'll always seek your approval first\n• Describe symptoms — I'll recommend Knowledge Cards from SharePoint\n\n💡 *Try: "I have a VPN issue" or "Check SLA status"*`,
        suggestions: suggestActions
      };

    case "thanks":
      suggestActions.push({ label: "📊 What's next?", action: "What should I focus on next?" });
      suggestActions.push({ label: "📋 More help", action: "help" });
      return { text: `You're welcome, ${currentUser.name}! 😊 Happy to help. I'm always here — just ask!\n\n${criticalInc.length > 0 ? `⚡ Heads up: ${criticalInc.length} critical ticket(s) still need attention.` : "✅ Everything looks good right now!"}`, suggestions: suggestActions };

    case "about":
      suggestActions.push({ label: "📊 System status", action: "Check system status" });
      suggestActions.push({ label: "💡 What can you do?", action: "help" });
      suggestActions.push({ label: "📚 Knowledge Portal", action: "Show me knowledge base articles" });
      return {
        text: `I'm your **VGC-ITSM AI Co-Pilot** 🚀\n\nEnterprise-grade AI assistant for VGC Technology Pte Ltd, Singapore.\n\n**What I do:**\n• 🧠 Context-aware incident triage & smart routing\n• 📚 SharePoint Knowledge Portal — instant article search & recommendations\n• 📋 Daily priority planning & risk assessment\n• ⚡ SLA breach prevention & proactive alerting\n• 📧 Communications drafting (you always approve first)\n• 🛡️ Security monitoring & ISO 27001 compliance\n• 🔄 Change risk analysis & approval tracking\n\n**How I work:**\nI work alongside you — never replacing you. Your expertise + my speed = better outcomes.\nI adapt within this session based on ticket outcomes and KB updates.`,
        suggestions: suggestActions
      };

    case "weather":
      suggestActions.push({ label: "📊 Back to work", action: "Give me my morning briefing" });
      return { text: `🌤️ Singapore weather is shown in the top header bar! Tropical climate: 25-32°C year-round.\n\nBut let's get back to what matters — ${criticalInc.length > 0 ? `you have ${criticalInc.length} critical ticket(s) that need attention!` : "your tickets are looking good today!"}`, suggestions: suggestActions };

    case "kb": {
      // Search KB for relevant articles based on user message
      const kbResults = searchKBArticles(userMsg, ctx.kbArticles || [], 5);
      suggestActions.push({ label: "📚 Browse All KB", action: "Show all knowledge base articles" });
      suggestActions.push({ label: "🔍 Search KB", action: "Search knowledge base for a solution" });
      suggestActions.push({ label: "🌐 Open SharePoint", action: "Open SharePoint Knowledge Portal" });
      
      let resp = `📚 **Knowledge Portal** — SharePoint Connected\n\n`;
      if (kbResults.length > 0) {
        resp += `I found **${kbResults.length} relevant article(s)** for your query:\n\n`;
        kbResults.forEach((art, idx) => {
          const catInfo = KB_CATEGORIES.find(c => c.id === art.category) || { icon: "📄" };
          resp += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          resp += `**${catInfo.icon} ${art.title}** (${art.id})\n`;
          resp += `📁 ${art.category} · 🎯 Best for: ${art.bestFor || "All"}\n`;
          if (art.whenToUse) resp += `💡 When to use: ${art.whenToUse}\n`;
          resp += `\n⚡ **Quick Fix:**\n`;
          (art.quickFix || []).slice(0, 3).forEach((step, si) => { resp += `  ${si + 1}. ${step}\n`; });
          if ((art.quickFix || []).length > 3) resp += `  ... +${(art.quickFix || []).length - 3} more steps\n`;
          resp += `📎 [Open in SharePoint](${art.spSlug ? SHAREPOINT_KB_CONFIG.articleUrl(art.spSlug) : '#'})\n`;
          if (art.relatedArticles && art.relatedArticles.length > 0) resp += `🔗 Related: ${Array.isArray(art.relatedArticles) ? art.relatedArticles.join(", ") : art.relatedArticles}\n`;
          resp += `👁 ${art.views} views · 👍 ${art.helpful}% helpful\n\n`;
        });
        resp += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        resp += `💡 *Click "Open in SharePoint" for the full article with attachments and comments.*`;
        kbResults.slice(0, 2).forEach(art => {
          suggestActions.push({ label: `📖 ${art.id}: ${art.title.substring(0, 30)}...`, action: `Tell me more about ${art.id}` });
        });
      } else {
        resp += `I searched the Knowledge Portal but couldn't find a direct match. Here's what I can do:\n\n`;
        resp += `• 🔍 Try different keywords or check the portal directly\n`;
        resp += `• 📝 I can help you **draft a new KB article** for this topic\n`;
        resp += `• 💬 Describe the issue and I'll search across all categories\n\n`;
        resp += `**Quick search tips:** Use symptoms, error codes, or application names.\n`;
        resp += `\n📂 [Browse SharePoint Document Library](${SHAREPOINT_KB_CONFIG.docsUrl})`;
        suggestActions.push({ label: "📝 Create new KB article", action: "Help me create a new knowledge base article" });
      }
      return { text: resp, suggestions: suggestActions };
    }

    case "report":
      suggestActions.push({ label: "📊 View dashboard", action: "Open dashboard" });
      suggestActions.push({ label: "📈 SLA report", action: "Show SLA compliance report" });
      return { text: `📊 **Reports & Analytics**\n\nKey metrics:\n• AI Automation Rate: 80% target\n• Triage Accuracy: 92%+\n• Open Incidents: ${openInc.length}\n• SLA Compliance: ${openInc.length > 0 ? Math.round((openInc.filter(i => !computeIncidentSla(i).isBreached).length / openInc.length) * 100) : 100}%\n\nAll metrics are on the Dashboard.`, suggestions: suggestActions };

    case "asset":
      suggestActions.push({ label: "💻 View CMDB", action: "Show all assets" });
      return { text: `💻 **Asset Management (CMDB)**\n\nTrack all IT assets: Hardware, Software, Licenses & Configuration Items.\nGo to **Assets** in the sidebar to view the full CMDB.\n\nNeed to look up a specific asset?`, suggestions: suggestActions };

    case "user":
      suggestActions.push({ label: "👥 Manage users", action: "Show user management" });
      return { text: `👥 **User & Access Management**\n\nRBAC roles: VGC Dev Admin, Tenant Admin, Administrator, Service Desk Lead, L1/L2 Support, End User.\nManage users in **Admin → Users & RBAC**.`, suggestions: suggestActions };

    case "compliance":
      suggestActions.push({ label: "📋 View controls", action: "Show ISO 27001 controls" });
      suggestActions.push({ label: "🔍 Risk register", action: "View risk register" });
      return { text: `🏛️ **ISO 27001:2022 Compliance**\n\nVGC Technology maintains ISO 27001:2022 certification:\n• Information Security Controls — Annex A implemented\n• Risk Assessment — Ongoing register management\n• Access Control — RBAC + MFA + Conditional Access\n• Audit Trail — Comprehensive logging\n\nCheck **Admin → ISO 27001** for full compliance dashboard.`, suggestions: suggestActions };

    case "pdpa":
      suggestActions.push({ label: "🔐 PDPA settings", action: "Show PDPA configuration" });
      return { text: `🔐 **PDPA Compliance**\n\nSingapore Personal Data Protection Act:\n• Data Retention Policies — Auto-enforce per entity type\n• DSAR Workflow — Process data subject access requests\n• Consent Management — Track & manage consents\n\nCheck **Admin → PDPA** for compliance settings.`, suggestions: suggestActions };

    case "entra":
      suggestActions.push({ label: "🔑 Entra settings", action: "Show Entra ID configuration" });
      return { text: `🔑 **Microsoft Entra ID Integration**\n\nSSO & identity management: Single Sign-On, SCIM Provisioning, Group Mapping, Conditional Access, MFA Enforcement.\nConfigure in **Admin → Entra ID**.`, suggestions: suggestActions };

    case "billing":
      suggestActions.push({ label: "💳 View billing", action: "Show billing details" });
      return { text: `💳 **Licensing & Billing**\n\nCurrent plan: Enterprise (SGD $20/user/month + 9% GST).\nView invoices in **Admin → Billing**.`, suggestions: suggestActions };

    case "smtp":
      suggestActions.push({ label: "⚙️ SMTP settings", action: "Show SMTP configuration" });
      return { text: `📬 **SMTP Configuration**\n\nEmail server: smtp.office365.com:587 (STARTTLS)\nTemplates: Ticket Created/Updated/Resolved/Closed/SLA\nConfigure in **Admin → SMTP Settings**.`, suggestions: suggestActions };

    case "integration":
      suggestActions.push({ label: "🔌 View integrations", action: "Show all integrations" });
      return { text: `🔌 **Integrations**\n\n✅ Microsoft Teams — Connected\n✅ Slack — Connected\n✅ Azure AD — Connected\n🔧 Jira, ServiceNow, PagerDuty — Available\n\nManage in **Admin → Integrations**.`, suggestions: suggestActions };

    default: {
      // Context-aware fallback: search KB + analyze message for relevant response
      const kbResults = searchKBArticles(userMsg, ctx.kbArticles || [], 3);
      suggestActions.push({ label: "📊 Daily briefing", action: "Give me my morning briefing" });
      suggestActions.push({ label: "🎫 View tickets", action: "Show open incidents" });
      suggestActions.push({ label: "📚 Knowledge Portal", action: "Search knowledge base" });
      if (criticalInc.length > 0) suggestActions.push({ label: "🔴 Critical alerts", action: "Show critical incidents" });
      
      let resp = `Thanks for your message, ${currentUser.name}. Let me help you with that.\n\n`;
      
      // Auto-detect if message contains a ticket ID
      const ticketMatch = userMsg.match(/\b(INC|CHG|PRB|REQ|KB)\d{3,}/i);
      if (ticketMatch) {
        const tid = ticketMatch[0].toUpperCase();
        const foundInc = incidents.find(i => i.id === tid);
        const foundChg = changes.find(c => c.id === tid);
        const foundKB = (ctx.kbArticles || []).find(a => a.id === tid);
        if (foundInc) {
          resp += `📋 **Ticket Found: ${foundInc.id}**\n`;
          resp += `• Title: ${foundInc.title}\n• Priority: ${foundInc.priority} | Status: ${foundInc.status}\n• Assigned: ${foundInc.assignee} | Category: ${foundInc.category}\n• SLA: ${Math.round((foundInc.created/foundInc.slaTarget)*100)}% elapsed\n\n`;
          suggestActions.unshift({ label: `📖 KB for ${foundInc.category}`, action: `Find KB article for ${foundInc.category} issue` });
        } else if (foundChg) {
          resp += `🔄 **Change Found: ${foundChg.id}**\n`;
          resp += `• Title: ${foundChg.title}\n• Status: ${foundChg.status} | Risk: ${foundChg.risk}\n• Window: ${foundChg.scheduledStart} – ${foundChg.scheduledEnd}\n\n`;
        } else if (foundKB) {
          resp += `📚 **KB Article: ${foundKB.id}**\n• ${foundKB.title}\n• Category: ${foundKB.category}\n\n`;
          if (foundKB.quickFix) {
            resp += `⚡ **Quick Fix:**\n`;
            foundKB.quickFix.forEach((s, i) => { resp += `  ${i+1}. ${s}\n`; });
            resp += `\n📎 [Open in SharePoint](${foundKB.spSlug ? SHAREPOINT_KB_CONFIG.articleUrl(foundKB.spSlug) : '#'})\n\n`;
          }
        } else {
          resp += `I couldn't find ticket **${tid}** in the current records.\n\n`;
        }
      }
      
      // Show KB matches if found
      if (kbResults.length > 0 && !ticketMatch) {
        resp += `📚 **Relevant Knowledge Articles:**\n`;
        kbResults.forEach(art => {
          const catInfo = KB_CATEGORIES.find(c => c.id === art.category) || { icon: "📄" };
          resp += `• ${catInfo.icon} **${art.title}** (${art.id}) — ${art.helpful}% helpful\n`;
        });
        resp += `\n💡 *Say "tell me more about ${kbResults[0].id}" for full details and quick fix steps.*\n\n`;
        suggestActions.unshift({ label: `📖 ${kbResults[0].id} details`, action: `Tell me about ${kbResults[0].id}` });
      }
      
      if (criticalInc.length > 0) {
        resp += `⚡ **Heads up:** ${criticalInc.length} critical incident(s) active.\n\n`;
      }
      if (!ticketMatch && kbResults.length === 0) {
        resp += `Here are some things I can help with:\n`;
        resp += `• 📊 "Morning briefing" — Priority plan for today\n`;
        resp += `• 🎫 "Show incidents" — Current ticket overview\n`;
        resp += `• 📚 "Search KB for VPN" — Find knowledge articles\n`;
        resp += `• ⏱️ "Check SLA" — Compliance monitoring\n`;
        resp += `• 📧 "Draft an email" — I'll draft, you approve\n\n`;
      }
      resp += `*Just tell me naturally what you need — I understand context, ticket IDs, and symptoms.*`;
      return { text: resp, suggestions: suggestActions };
    }
  }
}