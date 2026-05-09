import React, { useState, useEffect, useRef, useMemo, Suspense } from "react";
import {
  COLORS, PRIORITY_COLORS, STATUS_COLORS, PERM_COLORS, inputStyle, btnStyle,
} from "../constants/theme.js";
import {
  STATUS, OPEN_STATUSES, PRIORITY,
} from "../constants/status.js";
import {
  RBAC_PERMISSIONS, USERS,
} from "../constants/rbac.js";
import { lazyWithRetry } from "../utils/lazyWithRetry.js";
import M365ExpertPanel from "./M365ExpertPanel.jsx";

// Lazy-loaded co-pilot tab. Heavy enough (chat history, AI calls) to defer
// until an agent actually opens the "AI Co-Pilot" tab inside an incident.
const LazyChatAssistTab = lazyWithRetry(() => import("../components/ChatAssistTab.jsx")
  .then(m => ({ default: m.ChatAssistTab || m.default })));

/* ─── v3.32.0 (Phase 2) — AI Summary header for incident detail ─── */
function AiSummaryHeader({ inc }) {
  const [open, setOpen] = React.useState(true);
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async (force = false) => {
    if (!inc || !inc.id) return;
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/ai/ticket-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ticketId: inc.id, force }),
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`HTTP ${r.status} ${txt.slice(0, 120)}`);
      }
      const d = await r.json();
      setData(d);
    } catch (e) {
      setError(e.message || "Failed to load AI summary");
    } finally {
      setLoading(false);
    }
  }, [inc]);

  // Auto-load on first open and whenever ticket id changes.
  React.useEffect(() => { load(false); }, [load]);

  // Refresh on WS worklog event for this incident.
  React.useEffect(() => {
    if (!inc || !inc.id) return;
    const handler = (ev) => {
      const d = ev && ev.detail;
      if (d && d.incidentId === inc.id) load(false);
    };
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("vgc-worklog-updated", handler);
    }
    return () => {
      if (typeof window !== "undefined" && window.removeEventListener) {
        window.removeEventListener("vgc-worklog-updated", handler);
      }
    };
  }, [inc, load]);

  if (!inc) return null;
  return (
    <div role="region" aria-label="AI Summary" style={{ background: "#0F1117", border: "1px solid #6366F133", borderRadius: 10, padding: 14, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={() => setOpen(o => !o)} aria-expanded={open} style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", color: "#E8ECF4", cursor: "pointer", padding: 0, fontSize: 13, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>
          <span style={{ fontSize: 16 }}>🤖</span>
          AI Summary
          <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 8, background: "#6366F122", color: "#A5B4FC", fontWeight: 600 }}>v3.32 · {data?.cached ? "cached" : "live"}</span>
          <span style={{ marginLeft: 4, color: "#5A6178", fontSize: 11 }}>{open ? "▾" : "▸"}</span>
        </button>
        <button onClick={() => load(true)} disabled={loading} aria-label="Refresh AI summary" style={{ padding: "5px 12px", borderRadius: 6, background: "#6366F118", border: "1px solid #6366F133", color: "#A5B4FC", cursor: loading ? "wait" : "pointer", fontSize: 10, fontWeight: 600 }}>
          {loading ? "…" : "↻ Refresh"}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          {error && <div style={{ color: "#FF6B6B", fontSize: 11, padding: "6px 0" }}>⚠ {error}</div>}
          {!error && loading && !data && <div style={{ color: "#5A6178", fontSize: 11, padding: "6px 0" }}>Generating summary…</div>}
          {data && data.summary && (
            <div style={{ fontSize: 12, color: "#C4CAD6", lineHeight: 1.55, marginBottom: 8 }}>{data.summary}</div>
          )}
          {data && Array.isArray(data.openQuestions) && data.openQuestions.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Open questions</div>
              <ul style={{ margin: 0, paddingLeft: 18, color: "#A5B4FC", fontSize: 11.5, lineHeight: 1.5 }}>
                {data.openQuestions.map((q, i) => <li key={i}>{q}</li>)}
              </ul>
            </div>
          )}
          {data && data.suggestedNextStep && (
            <div style={{ background: "#0A0C14", border: "1px solid #6366F122", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 9, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 }}>Suggested next step</div>
              <div style={{ fontSize: 12, color: "#6EE7B7", fontWeight: 600 }}>{data.suggestedNextStep}</div>
            </div>
          )}
          {data && data.generatedAt && (
            <div style={{ marginTop: 6, fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>generated {new Date(data.generatedAt).toLocaleString()}</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Sub-component: AI Resolution Tab (hooks-safe) ─── */
function AiResolveTab({ inc, addActivity, showToast }) {
  const [aiSuggestions, setAiSuggestions] = React.useState(null);
  const [aiSugLoading, setAiSugLoading] = React.useState(false);
  const fetchSuggestions = async () => {
    setAiSugLoading(true);
    try {
      const resp = await fetch("/api/ai/resolve-error", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          errorType: "Incident Resolution",
          errorCode: inc?.id || "INCIDENT",
          errorMessage: `${inc?.title || "Incident"}. ${inc?.description || ""}`.slice(0, 4000),
          errorDetails: `Category: ${inc?.category || "N/A"}; Priority: ${inc?.priority || "N/A"}; Status: ${inc?.status || "N/A"}`,
          context: `Incident ${inc?.id || "N/A"}, category ${inc?.category || "N/A"}, priority ${inc?.priority || "N/A"}, status ${inc?.status || "N/A"}`,
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || `AI suggestions failed (${resp.status})`);
      setAiSuggestions(data);
    } catch (err) { setAiSuggestions({ error: err?.message || "Failed to get AI suggestions" }); }
    setAiSugLoading(false);
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #6366F1, #06B6D4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🤖</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>AI Resolution Assistant</div>
          <div style={{ fontSize: 11, color: "#5A6178" }}>AI analyzes this incident and suggests resolution steps from the knowledge base</div>
        </div>
        <button onClick={fetchSuggestions} disabled={aiSugLoading} style={{ ...btnStyle("#6366F1"), padding: "8px 16px", fontSize: 12, background: "linear-gradient(135deg, #6366F1, #8B5CF6)", opacity: aiSugLoading ? 0.6 : 1 }}>
          {aiSugLoading ? "⏳ Analyzing..." : "🤖 Get AI Suggestions"}
        </button>
      </div>

      {aiSugLoading && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 12, animation: "pulse 1.5s ease-in-out infinite" }}>🤖</div>
          <div style={{ color: "#818CF8", fontSize: 13, fontWeight: 600 }}>AI is analyzing the incident...</div>
          <div style={{ color: "#5A6178", fontSize: 11, marginTop: 4 }}>Searching knowledge base, analyzing patterns, generating resolution steps</div>
        </div>
      )}

      {aiSuggestions && !aiSuggestions.error && (
        <div style={{ display: "grid", gap: 12 }}>
          {aiSuggestions.rootCause && (
            <div style={{ background: "#0A0C14", borderRadius: 10, border: "1px solid #FF6B6B22", padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#FF6B6B", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace" }}>🔍 Root Cause Analysis</div>
              <div style={{ fontSize: 13, color: "#C4CAD6", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{aiSuggestions.rootCause}</div>
            </div>
          )}

          {(aiSuggestions.steps || aiSuggestions.resolution) && (
            <div style={{ background: "#0A0C14", borderRadius: 10, border: "1px solid #4CAF5022", padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#4CAF50", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace" }}>⚡ Resolution Steps</div>
              {Array.isArray(aiSuggestions.steps) ? aiSuggestions.steps.map((step, i) => (
                <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, fontSize: 13, color: "#C4CAD6", lineHeight: 1.6 }}>
                  <span style={{ color: "#4CAF50", fontWeight: 700, minWidth: 22, fontFamily: "'JetBrains Mono', monospace" }}>{i + 1}.</span>
                  <span>{typeof step === "string" ? step : step.description || step.step || JSON.stringify(step)}</span>
                </div>
              )) : (
                <div style={{ fontSize: 13, color: "#C4CAD6", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{aiSuggestions.resolution}</div>
              )}
            </div>
          )}

          {aiSuggestions.prevention && (
            <div style={{ background: "#0A0C14", borderRadius: 10, border: "1px solid #06B6D422", padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#06B6D4", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace" }}>🛡️ Prevention</div>
              <div style={{ fontSize: 13, color: "#C4CAD6", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{aiSuggestions.prevention}</div>
            </div>
          )}

          {(aiSuggestions.relatedArticles || aiSuggestions.kbArticles) && (
            <div style={{ background: "#0A0C14", borderRadius: 10, border: "1px solid #FFB34722", padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#FFB347", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace" }}>📚 Related Knowledge Articles</div>
              {(aiSuggestions.relatedArticles || aiSuggestions.kbArticles || []).map((kb, i) => (
                <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid #1E213044", fontSize: 12, color: "#C4CAD6" }}>
                  {typeof kb === "string" ? kb : kb.title || kb.id}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(aiSuggestions, null, 2)); showToast("📋 AI suggestions copied to clipboard", "success"); }} style={{ ...btnStyle("#06B6D4"), padding: "8px 16px", fontSize: 11 }}>📋 Copy</button>
            <button onClick={() => {
              addActivity("ai_resolution", `AI Resolution Suggestion applied.\n${aiSuggestions.rootCause ? "Root Cause: " + aiSuggestions.rootCause + "\n" : ""}${Array.isArray(aiSuggestions.steps) ? "Steps: " + aiSuggestions.steps.map((s, i) => `${i + 1}. ${typeof s === "string" ? s : s.description || s.step}`).join(", ") : ""}`);
              showToast("✅ AI resolution applied to activity log", "success");
            }} style={{ ...btnStyle("#4CAF50"), padding: "8px 16px", fontSize: 11 }}>✅ Apply to Activity Log</button>
          </div>
        </div>
      )}

      {aiSuggestions?.error && (
        <div style={{ textAlign: "center", padding: 30, color: "#FF6B6B", fontSize: 12 }}>❌ {aiSuggestions.error}</div>
      )}

      {!aiSuggestions && !aiSugLoading && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "#5A6178" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🤖</div>
          <div style={{ fontSize: 13, color: "#C4CAD6", marginBottom: 6 }}>Click "Get AI Suggestions" to analyze this incident</div>
          <div style={{ fontSize: 11 }}>AI will search the knowledge base, analyze patterns, and suggest resolution steps</div>
        </div>
      )}
    </div>
  );
}
import {
  CATEGORIES, SERVICES, KB_CATEGORIES, ASSETS, SHAREPOINT_KB_CONFIG,
} from "../constants/categories.js";
import { APP_VERSION } from "../constants/version.js";
import {
  computeIncidentSla, genId, timeAgo, sanitizeHTML, getBusinessHoursElapsed, formatSlaCountdown,
} from "../utils/slaHelpers.js";
import {
  Badge, PriorityDot, Modal, FormField, SearchBar,
} from "../components/SharedComponents.jsx";
import {
  aiAnalyzeIncident, aiAnalyzeChange, AI_CONFIDENCE_COLORS,
} from "../utils/aiEngine.jsx";

// All modals — extracted from itsm-tool.jsx
// Receives parent state/setters via ctx prop object
export default function ModalsModule({ ctx }) {
  const {
    currentUser, showToast, _save, incidents, setIncidents,
    problems, setProblems, changes, setChanges, requests, setRequests,
    assets, setAssets, kbArticles, setKbArticles,
    serviceCatalog, setServiceCatalog,
    customers, users, vendors, search,
    detailItem, setDetailItem, modal, setModal,
    setActiveModule, slaPolicy,
    isEntraProductionUser, aiEngine, softDelete,
    callAzureOpenAI = null,
    incidentTemplates = [],
    autoTriageTicket = null,
    surveyTemplates = [],
    setSurveyDrafts = () => {},
    azureOpenAI = null,
    generateKBFromTicket = () => {},
    smtpConfig = null,
    customFields = [],
    setShowAiPanel = () => {},
    handleAiChat = () => {},
    submitCsatResponse = () => {},
  } = ctx;

const NewIncidentModal = () => {
  const [form, setForm] = useState({ title: "", priority: "Sev-C", category: "Software", subcategory: "", urgency: "Sev-C", impact: "Individual", description: "", assignee: "", contactMethod: "Portal", affectedAsset: "", affectedService: "", location: "SG-HQ", reporterEmail: "", customerId: "", customerContact: "" });
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [createInZendesk, setCreateInZendesk] = useState(isEntraProductionUser);
  const [submitting, setSubmitting] = useState(false);
  const [wizardStep, setWizardStep] = useState(1); // 1=Describe, 2=AI Review, 3=Details

  const SUBCATEGORIES = {
    Network: ["VPN / Remote Access", "WiFi / LAN", "DNS / DHCP", "Bandwidth / Latency", "Firewall / Proxy"],
    Hardware: ["Laptop / Desktop", "Printer", "Monitor / Display", "Peripheral", "Server Hardware", "Mobile Device"],
    Software: ["Enterprise Application", "OS / System Software", "Browser / Plugin", "License Issue", "Installation / Update"],
    Security: ["Access Violation", "Malware / Virus", "Phishing", "Data Breach", "MFA / Auth Issue"],
    Email: ["Exchange Server", "Outlook Client", "Distribution List", "Calendar / Meeting", "Spam / Filtering"],
    "Access/Identity": ["Password Reset", "Account Locked", "Permission Request", "SSO / Federation", "Role Change", "MFA Enrollment"],
    Cloud: ["Azure Service", "AWS Service", "Container / K8s", "Storage / Blob", "VM / Compute", "M365 / SaaS"],
    Printing: ["Network Printer", "Local Printer", "Scanner / Fax", "Print Queue", "Driver Issue"],
    "End User Computing": ["Workstation Setup", "Onboarding", "Provisioning", "User Account", "Desktop Support"],
    "Service Request": ["Service Catalog", "Change Request", "Request Fulfilment", "Service Level"],
    General: ["Other", "Uncategorized"],
  };

  const IMPACT_LEVELS = ["Enterprise", "Department", "Multiple Users", "Individual"];
  const URGENCY_LEVELS = ["Sev-A", "Sev-B", "Sev-C", "Sev-D"];
  const CONTACT_METHODS = ["Portal", "Email", "Phone", "Chat", "Walk-in", "Monitoring Alert"];
  const LOCATIONS = ["SG-HQ", "SG-HQ-Floor1", "SG-HQ-Floor2", "SG-HQ-Floor3", "SG-HQ-Floor4", "SG-DC1", "Azure-SEA", "Remote"];
  const SERVICES_LIST = ["Email & Collaboration", "Network Services", "Database Services", "Business Applications", "End User Computing", "Print Services", "Remote Access", "Cloud Infrastructure", "Security Operations"];

  const runAiAnalysis = async () => {
    if (form.title.length < 3 && form.description.length < 3) return;
    setAiAnalyzing(true);
    try {
      const aiResult = callAzureOpenAI ? await callAzureOpenAI(
        `You are an expert IT support AI for VGC Technology Pte Ltd. Analyze the incident and return ONLY valid JSON with these fields:\n- suggestedCategory: one of Network, Hardware, Software, Security, Email, Access/Identity, Cloud, Printing, End User Computing, Service Request, General\n- suggestedPriority: one of Sev-A, Sev-B, Sev-C, Sev-D\n- suggestedAssignee: best agent name or empty string\n- confidence: 0-100\n- reasoning: brief explanation\nRespond ONLY with valid JSON, no markdown.`,
        `Title: ${form.title}\nDescription: ${form.description}`
      ) : null;
      if (aiResult) {
        try {
          const parsed = JSON.parse(aiResult.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
          const localResult = aiAnalyzeIncident(form.title, form.description);
          setAiSuggestion({
            suggestedCategory: parsed.suggestedCategory || localResult.suggestedCategory,
            suggestedPriority: parsed.suggestedPriority || localResult.suggestedPriority,
            suggestedAssignee: parsed.suggestedAssignee || localResult.suggestedAssignee,
            confidence: parsed.confidence || localResult.confidence,
            kbSuggestions: localResult.kbSuggestions,
            reasoning: parsed.reasoning || "",
            source: "azure",
          });
        } catch { setAiSuggestion({ ...aiAnalyzeIncident(form.title, form.description), source: "azure-fallback" }); }
      } else {
        setAiSuggestion({ ...aiAnalyzeIncident(form.title, form.description), source: "local" });
      }
    } catch {
      setAiSuggestion({ ...aiAnalyzeIncident(form.title, form.description), source: "local" });
    }
    setAiAnalyzing(false);
  };

  const applyAiSuggestions = () => {
    if (!aiSuggestion) return;
    setForm(prev => ({
      ...prev,
      category: aiSuggestion.suggestedCategory,
      priority: aiSuggestion.suggestedPriority,
      assignee: aiSuggestion.suggestedAssignee || prev.assignee,
    }));
  };

  const selectedCustomer = customers.find(c => c.id === form.customerId);

  // Auto-advance to step 2 when AI finishes analyzing
  const goToStep2 = () => { if (form.title.length >= 3) { runAiAnalysis(); setWizardStep(2); } };

  const wizardSteps = [
    { num: 1, label: "Describe", icon: "✏️" },
    { num: 2, label: "AI Review", icon: "🤖" },
    { num: 3, label: "Details", icon: "📋" },
  ];

  return (
    <Modal title="Create New Incident" onClose={() => setModal(null)} wide>
      {/* ─── Wizard Step Indicator ─────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 20, padding: "0 8px" }}>
        {wizardSteps.map((s, i) => (
          <React.Fragment key={s.num}>
            <div onClick={() => { if (s.num < wizardStep || (s.num === 2 && form.title.length >= 3)) setWizardStep(s.num); }}
              style={{ display: "flex", alignItems: "center", gap: 8, cursor: s.num <= wizardStep ? "pointer" : "default", flex: 1 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700, flexShrink: 0, transition: "all 0.2s",
                background: wizardStep === s.num ? "linear-gradient(135deg, #6366F1, #06B6D4)" : wizardStep > s.num ? "#4CAF5022" : "#1E2130",
                color: wizardStep === s.num ? "#fff" : wizardStep > s.num ? "#4CAF50" : "#5A6178",
                border: `2px solid ${wizardStep === s.num ? "#6366F1" : wizardStep > s.num ? "#4CAF5044" : "#1E2130"}`
              }}>{wizardStep > s.num ? "✓" : s.icon}</div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: wizardStep >= s.num ? "#E8ECF4" : "#5A6178", fontFamily: "'Space Grotesk', sans-serif" }}>{s.label}</div>
                <div style={{ fontSize: 8, color: "#5A617888" }}>Step {s.num} of 3</div>
              </div>
            </div>
            {i < wizardSteps.length - 1 && <div style={{ flex: 0.4, height: 2, background: wizardStep > s.num ? "#4CAF5044" : "#1E2130", borderRadius: 1, margin: "0 4px" }} />}
          </React.Fragment>
        ))}
      </div>

      {/* ─── Step 1: Describe the Issue ─────────────────────── */}
      {wizardStep === 1 && <>
        {incidentTemplates.length > 0 && (
          <FormField label="Quick Start — Use Template">
            <select style={inputStyle} onChange={e => {
              const tpl = incidentTemplates.find(t => t.id === e.target.value);
              if (tpl) setForm(prev => ({ ...prev, title: tpl.title || prev.title, category: tpl.category || prev.category, priority: tpl.priority || prev.priority, description: tpl.description || prev.description, assignee: tpl.assignee || prev.assignee }));
            }}>
              <option value="">— Select a template —</option>
              {incidentTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </FormField>
        )}
        <FormField label="What's the issue? *">
          <input style={{ ...inputStyle, fontSize: 14, padding: "12px 14px" }} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Cannot connect to VPN from home" autoFocus />
        </FormField>
        <FormField label="Tell us more (optional but helps AI triage)">
          <textarea style={{ ...inputStyle, minHeight: 100, resize: "vertical" }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Describe what happened, when it started, and any error messages you see..." />
        </FormField>
        <FormField label="How urgent is this for you?">
          <div style={{ display: "flex", gap: 8 }}>
            {[{ v: "Sev-A", label: "🔴 Critical", desc: "Business down" }, { v: "Sev-B", label: "🟠 High", desc: "Major impact" }, { v: "Sev-C", label: "🟡 Medium", desc: "Some impact" }, { v: "Sev-D", label: "🟢 Low", desc: "Minor issue" }].map(p => (
              <button key={p.v} onClick={() => setForm({ ...form, priority: p.v, urgency: p.v })} style={{
                flex: 1, padding: "10px 8px", borderRadius: 8, cursor: "pointer", textAlign: "center", transition: "all 0.15s",
                background: form.priority === p.v ? "#6366F118" : "#0A0C14",
                border: `2px solid ${form.priority === p.v ? "#6366F1" : "#1E2130"}`,
              }}>
                <div style={{ fontSize: 14 }}>{p.label.split(" ")[0]}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: form.priority === p.v ? "#E8ECF4" : "#8B92A8", marginTop: 2 }}>{p.label.split(" ").slice(1).join(" ")}</div>
                <div style={{ fontSize: 9, color: "#5A6178", marginTop: 1 }}>{p.desc}</div>
              </button>
            ))}
          </div>
        </FormField>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button style={{ ...btnStyle("#333"), color: "#A0AEC0" }} onClick={() => setModal(null)}>Cancel</button>
          <button style={{ ...btnStyle(), opacity: form.title.length < 3 ? 0.5 : 1 }} disabled={form.title.length < 3} onClick={goToStep2}>
            Next: AI Analysis →
          </button>
        </div>
      </>}

      {/* ─── Step 2: AI Review & Suggestions ───────────────── */}
      {wizardStep === 2 && <>
        <div style={{ padding: "10px 14px", background: "#0A0C14", borderRadius: 8, border: "1px solid #1E213044", marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>{form.title}</div>
          {form.description && <div style={{ fontSize: 11, color: "#5A6178", marginTop: 4, lineHeight: 1.4 }}>{form.description.substring(0, 200)}{form.description.length > 200 ? "..." : ""}</div>}
        </div>

        {aiAnalyzing && (
          <div style={{ padding: "20px", background: "linear-gradient(135deg, #6366F108, #06B6D408)", borderRadius: 8, border: "1px solid #6366F133", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20, animation: "zdSpin 1s linear infinite", display: "inline-block" }}>🤖</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#6366F1" }}>VGC-AI Engine Analyzing...</div>
              <div style={{ fontSize: 11, color: "#5A6178" }}>Classifying category, priority & recommended assignee</div>
            </div>
          </div>
        )}
        {aiSuggestion && !aiAnalyzing && (
          <div style={{ background: "linear-gradient(135deg, #6366F108, #06B6D408)", borderRadius: 8, border: "1px solid #6366F133", padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>🤖</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#6366F1", fontFamily: "'Space Grotesk', sans-serif" }}>AI Recommendations</span>
                <Badge color={aiSuggestion.confidence >= 85 ? AI_CONFIDENCE_COLORS.high : aiSuggestion.confidence >= 70 ? AI_CONFIDENCE_COLORS.medium : AI_CONFIDENCE_COLORS.low}>
                  {aiSuggestion.confidence}% confident
                </Badge>
              </div>
              <button style={{ ...btnStyle("#6366F1"), fontSize: 11, padding: "5px 12px" }} onClick={applyAiSuggestions}>Apply All ✓</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div style={{ padding: "8px 12px", background: "#0A0C14", borderRadius: 6, border: "1px solid #1E213044", cursor: "pointer" }}
                onClick={() => setForm(prev => ({ ...prev, category: aiSuggestion.suggestedCategory }))}>
                <div style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", marginBottom: 4 }}>Category</div>
                <div style={{ color: "#64B5F6", fontSize: 13, fontWeight: 600 }}>{aiSuggestion.suggestedCategory}</div>
              </div>
              <div style={{ padding: "8px 12px", background: "#0A0C14", borderRadius: 6, border: "1px solid #1E213044", cursor: "pointer" }}
                onClick={() => setForm(prev => ({ ...prev, priority: aiSuggestion.suggestedPriority }))}>
                <div style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", marginBottom: 4 }}>Priority</div>
                <PriorityDot priority={aiSuggestion.suggestedPriority} />
              </div>
              <div style={{ padding: "8px 12px", background: "#0A0C14", borderRadius: 6, border: "1px solid #1E213044", cursor: "pointer" }}
                onClick={() => { if (aiSuggestion.suggestedAssignee) setForm(prev => ({ ...prev, assignee: aiSuggestion.suggestedAssignee })); }}>
                <div style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", marginBottom: 4 }}>Assignee</div>
                <div style={{ color: "#CE93D8", fontSize: 13, fontWeight: 600 }}>{aiSuggestion.suggestedAssignee || "Manual"}</div>
              </div>
            </div>
            {(aiSuggestion.kbSuggestions || []).length > 0 && (
              <div>
                <div style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", marginBottom: 6 }}>Suggested KB Articles</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(aiSuggestion.kbSuggestions || []).map(kbId => {
                    const art = kbArticles.find(a => a.id === kbId);
                    return art ? (
                      <span key={kbId} style={{ cursor: "pointer" }} onClick={() => { setDetailItem(art); setModal("kbDetail"); }}>
                        <Badge color={{ bg: "#0D2137", text: "#64B5F6" }}>📖 {art.title}</Badge>
                      </span>
                    ) : null;
                  })}
                </div>
              </div>
            )}
            {aiSuggestion?.reasoning && (
              <div style={{ padding: "8px 12px", background: "#0A0C14", borderRadius: 6, border: "1px solid #6366F122", marginTop: 8 }}>
                <div style={{ fontSize: 9, color: "#6366F1", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>🧠 AI REASONING</div>
                <div style={{ fontSize: 11, color: "#A0AEC0", lineHeight: 1.4 }}>{aiSuggestion.reasoning}</div>
              </div>
            )}
          </div>
        )}
        {!aiSuggestion && !aiAnalyzing && (
          <div style={{ padding: "20px", background: "#0A0C14", borderRadius: 6, border: "1px dashed #6366F133", marginBottom: 16, textAlign: "center" }}>
            <span style={{ fontSize: 24 }}>🤖</span>
            <div style={{ fontSize: 12, color: "#5A6178", marginTop: 6 }}>AI analysis didn't return suggestions. You can set fields manually.</div>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FormField label="Category">
            <select style={inputStyle} value={form.category} onChange={e => setForm({ ...form, category: e.target.value, subcategory: "" })}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </FormField>
          <FormField label="Priority">
            <select style={inputStyle} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
              {["Sev-A", "Sev-B", "Sev-C", "Sev-D"].map(p => <option key={p}>{p}</option>)}
            </select>
          </FormField>
        </div>
        <FormField label="Assignee">
          <select style={inputStyle} value={form.assignee} onChange={e => setForm({ ...form, assignee: e.target.value })}>
            <option value="">AI Auto-assign</option>
            {USERS.filter(u => u.role !== "End User").map(u => <option key={u.id} value={u.name}>{u.name} — {u.role} ({u.team})</option>)}
          </select>
        </FormField>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 12 }}>
          <button style={{ ...btnStyle("#333"), color: "#A0AEC0" }} onClick={() => setWizardStep(1)}>← Back</button>
          <button style={btnStyle()} onClick={() => setWizardStep(3)}>Next: Additional Details →</button>
        </div>
      </>}

      {/* ─── Step 3: Additional Details & Submit ───────────── */}
      {wizardStep === 3 && <>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FormField label="Urgency">
            <select style={inputStyle} value={form.urgency} onChange={e => setForm({ ...form, urgency: e.target.value })}>
              {URGENCY_LEVELS.map(u => <option key={u}>{u}</option>)}
            </select>
          </FormField>
          <FormField label="Impact">
            <select style={inputStyle} value={form.impact} onChange={e => setForm({ ...form, impact: e.target.value })}>
              {IMPACT_LEVELS.map(i => <option key={i}>{i}</option>)}
            </select>
          </FormField>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FormField label="Subcategory">
            <select style={inputStyle} value={form.subcategory} onChange={e => setForm({ ...form, subcategory: e.target.value })}>
              <option value="">Select subcategory</option>
              {(SUBCATEGORIES[form.category] || []).map(s => <option key={s}>{s}</option>)}
            </select>
          </FormField>
          <FormField label="Contact Method">
            <select style={inputStyle} value={form.contactMethod} onChange={e => setForm({ ...form, contactMethod: e.target.value })}>
              {CONTACT_METHODS.map(c => <option key={c}>{c}</option>)}
            </select>
          </FormField>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FormField label="Affected Service">
            <select style={inputStyle} value={form.affectedService} onChange={e => setForm({ ...form, affectedService: e.target.value })}>
              <option value="">Select service</option>
              {SERVICES_LIST.map(s => <option key={s}>{s}</option>)}
            </select>
          </FormField>
          <FormField label="Location">
            <select style={inputStyle} value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}>
              {LOCATIONS.map(l => <option key={l}>{l}</option>)}
            </select>
          </FormField>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FormField label="Affected Asset / PC Name">
            <input style={inputStyle} value={form.affectedAsset} onChange={e => setForm({ ...form, affectedAsset: e.target.value })} placeholder="e.g. AST001 or VGC-MKT-PC05" />
          </FormField>
          <FormField label="Reporter Email">
            <input style={inputStyle} type="email" value={form.reporterEmail} onChange={e => setForm({ ...form, reporterEmail: e.target.value })} placeholder="user@vgctechnology.com.sg" />
          </FormField>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FormField label="Customer / Company">
            <select style={inputStyle} value={form.customerId} onChange={e => {
              const cust = customers.find(c => c.id === e.target.value);
              setForm({ ...form, customerId: e.target.value, customerContact: cust ? cust.contactPerson : "" });
            }}>
              <option value="">— Internal / Not a customer —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </FormField>
          {selectedCustomer && <FormField label="Contact Person">
            <input style={inputStyle} value={form.customerContact} onChange={e => setForm({ ...form, customerContact: e.target.value })} placeholder={selectedCustomer.contactPerson} />
          </FormField>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#0A0C14", borderRadius: 8, border: "1px solid #1E213044", marginBottom: 8 }}>
          <input type="checkbox" checked={createInZendesk} onChange={e => setCreateInZendesk(e.target.checked)} style={{ accentColor: "#EC4899" }} />
          <span style={{ fontSize: 12, color: "#E8ECF4" }}>🎫 Also create Zendesk ticket</span>
          <span style={{ fontSize: 10, color: "#5A6178", marginLeft: "auto" }}>{createInZendesk ? "Will sync to Zendesk" : "ITSM only"}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
          <button style={{ ...btnStyle("#333"), color: "#A0AEC0" }} onClick={() => setWizardStep(2)}>← Back</button>
          <button style={{ ...btnStyle(), opacity: submitting ? 0.6 : 1 }} disabled={submitting} onClick={async () => {
            if (!form.title || submitting) return;
            setSubmitting(true);
            const slaMap = { "Sev-A": 4, "Sev-B": 4, "Sev-C": 9, "Sev-D": 27 };
            const reporterUser = USERS.find(u => u.name === currentUser.name) || currentUser;
            const assigneeUser = form.assignee ? USERS.find(u => u.name === form.assignee) : null;
            const now = new Date();
            const newInc = {
              id: genId("INC"), title: form.title, priority: form.priority,
              status: "Open", category: form.category, subcategory: form.subcategory,
              urgency: form.urgency, impact: form.impact,
              assignee: form.assignee || (aiSuggestion?.suggestedAssignee) || "Unassigned",
              assignmentGroup: assigneeUser?.team || "Service Desk",
              reporter: reporterUser.name, reporterEmail: form.reporterEmail || reporterUser.email || "",
              customerId: form.customerId || "", customer: selectedCustomer?.name || "", customerContact: form.customerContact || selectedCustomer?.contactPerson || "", customerPhone: selectedCustomer?.phone || "", customerAddress: selectedCustomer?.address || "",
              reporterRole: reporterUser.rbacRole || "", contactMethod: form.contactMethod,
              created: 0, createdAt: now.toISOString(), slaTarget: slaMap[form.priority], description: form.description,
              affectedAsset: form.affectedAsset, affectedService: form.affectedService,
              location: form.location, firstResponseTime: null,
              resolutionNotes: "", closureCode: "", workaround: "",
              aiTriaged: !!aiSuggestion, aiConfidence: aiSuggestion?.confidence || 0,
              activityLog: [
                { id: genId("AL"), type: "status", user: "System", time: now.toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }).replace(",", ""), detail: `Ticket created via ${form.contactMethod || "Portal"}` },
                ...(aiSuggestion ? [{ id: genId("AL"), type: "status", user: "AI Engine", time: now.toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }).replace(",", ""), detail: `Auto-triaged: ${form.priority}, Category: ${form.category}, Confidence: ${aiSuggestion.confidence}%` }] : [])
              ]
            };
            setIncidents(prev => [newInc, ...prev]);
            try {
              await fetch("/api/db/incidents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: newInc.id, data: newInc }) });
            } catch (e) { console.warn("[DB] Failed to persist incident:", e.message); }
            if (!aiSuggestion) {
              autoTriageTicket?.(newInc)?.catch?.(() => {});
            }
            if (createInZendesk) {
              try {
                const zdRes = await fetch("/api/zendesk/push-to-zendesk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ incidentId: newInc.id, title: newInc.title, description: newInc.description, priority: newInc.priority, status: newInc.status, customer: newInc.customer, category: newInc.category }) });
                const zdData = await zdRes.json();
                if (zdData.zdTicketId) {
                  newInc.zdTicketId = zdData.zdTicketId;
                  setIncidents(prev => prev.map(i => i.id === newInc.id ? { ...i, zdTicketId: zdData.zdTicketId } : i));
                  showToast(`Incident ${newInc.id} created + Zendesk #${zdData.zdTicketId}`, "success");
                } else {
                  showToast(`Incident ${newInc.id} created (Zendesk sync pending)`, "info");
                }
              } catch (e) {
                showToast(`Incident created, Zendesk sync failed: ${e.message}`, "error");
              }
            } else {
              showToast(`Incident ${newInc.id} created successfully`, "success");
            }
            setSubmitting(false);
            setModal(null);
          }}>{submitting ? "⏳ Creating..." : "🚀 Create Incident"}</button>
        </div>
      </>}
    </Modal>
  );
};

// ─── Detail Modals ────────────────────────────────────────────────────
const IncidentDetailModal = () => {
  const inc = detailItem;
  // v3.16: Hooks MUST be called unconditionally before any early return.
  // Prior code returned null before useState calls → React error #310.
  const [detailTab, setDetailTab] = useState("details");
  const [replyMode, setReplyMode] = useState(null); // null | "external" | "internal"
  const [replyBody, setReplyBody] = useState("");
  const [replySubject, setReplySubject] = useState(inc ? `RE: ${inc.id} — ${inc.title}` : "");
  const [emailAttachments, setEmailAttachments] = useState([]);
  const [aiDraftPanel, setAiDraftPanel] = useState(false);
  const [aiDraftTone, setAiDraftTone] = useState("professional");
  const [aiDraftLoading, setAiDraftLoading] = useState(false);
  const [aiDraftResult, setAiDraftResult] = useState("");
  // v3.32.1 (Phase 2) — suggested replies + draft resolution.
  const [suggestedRepliesPanel, setSuggestedRepliesPanel] = useState(false);
  const [suggestedRepliesLoading, setSuggestedRepliesLoading] = useState(false);
  const [suggestedRepliesData, setSuggestedRepliesData] = useState(null);
  const [draftResolutionLoading, setDraftResolutionLoading] = useState(false);
  const [draftResolutionData, setDraftResolutionData] = useState(null);
  const fileInputRef = useRef(null);
  // ─── Live SLA Countdown Tick ───
  const [slaTick, setSlaTick] = useState(0);
  useEffect(() => {
    if (!inc) return;
    if (["Resolved","Closed","Pending","On Hold"].includes(inc.status)) return;
    const iv = setInterval(() => setSlaTick(t => t + 1), 60000);
    return () => clearInterval(iv);
  }, [inc?.status, inc]);

  if (!inc) return null;
  const reporterUser = USERS.find(u => u.name === inc.reporter);
  const activities = inc.activityLog || [];

  const addActivity = (type, detail, extra = {}) => {
    const entry = { id: genId("AL"), type, user: currentUser.name, time: new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }).replace(",", ""), detail, ...extra };
    const updated = { ...inc, activityLog: [...(inc.activityLog || []), entry] };
    setIncidents(prev => prev.map(i => i.id === inc.id ? updated : i));
    setDetailItem(updated);
  };

  const changeStatus = (newStatus, options = {}) => {
    const pauseStatuses = new Set(["Pending", "On Hold"]);
    const now = new Date().toISOString();
    let slaPauseHistory = [...(inc.slaPauseHistory || [])];

    // Entering a pause status — record pausedAt
    if (pauseStatuses.has(newStatus) && !pauseStatuses.has(inc.status)) {
      slaPauseHistory.push({ pausedAt: now, resumedAt: null });
    }
    // Leaving a pause status — record resumedAt on the last open pause entry
    if (pauseStatuses.has(inc.status) && !pauseStatuses.has(newStatus)) {
      const lastOpen = slaPauseHistory.findLast(e => !e.resumedAt);
      if (lastOpen) lastOpen.resumedAt = now;
    }

    const updated = { ...inc, status: newStatus, slaPauseHistory, activityLog: [...(inc.activityLog || []), { id: genId("AL"), type: "status", user: currentUser.name, time: new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }).replace(",", ""), detail: `Status changed: ${inc.status} → ${newStatus}` }] };
    setIncidents(prev => prev.map(i => i.id === inc.id ? { ...i, status: newStatus, slaPauseHistory, activityLog: updated.activityLog } : i));
    setDetailItem(updated);

    // ── Zendesk bidirectional sync — push status change to linked Zendesk ticket (skip for AI-resolved)
    if (inc.zdTicketId && !options.skipZendeskSync) {
      fetch("/api/zendesk/sync-incident", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zdTicketId: inc.zdTicketId, action: "status_change", status: newStatus, comment: `[ITSM ${inc.id}] Status changed to ${newStatus} by ${currentUser.name}` })
      }).then(r => r.json()).then(result => {
        if (result.success) {
          const syncEntry = { id: genId("AL"), type: "sync", user: "System", time: new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }).replace(",", ""), detail: `Synced to Zendesk #${inc.zdTicketId}: status → ${newStatus}` };
          setIncidents(prev => prev.map(i => i.id === inc.id ? { ...i, activityLog: [...(i.activityLog || []), syncEntry] } : i));
        }
      }).catch(() => {});
    }

    // AI Customer Survey — auto-generate draft on Resolved/Closed
    if (newStatus === "Resolved" || newStatus === "Closed") {
      const tpl = inc.priority === "Critical"
        ? surveyTemplates.find(t => t.id === "srvt-critical") || surveyTemplates[0]
        : (inc.activityLog || []).length <= 3
          ? surveyTemplates.find(t => t.id === "srvt-quick") || surveyTemplates[0]
          : surveyTemplates[0];
      if (tpl) {
        const preview = [
          `Dear ${inc.reporterName || "Customer"},`,
          "",
          `Thank you for contacting VGC Technology regarding ${inc.id} — "${inc.title}".`,
          `We're glad this has been ${newStatus.toLowerCase()}. Your feedback helps us improve.`,
          "",
          ...(tpl.questions || []).map((q, i) => `${i + 1}. ${q}`),
          "",
          tpl.signOff,
          `— VGC Technology ITSM`
        ].join("\n");
        const draft = { id: genId("SURV"), ticketId: inc.id, templateName: tpl.name, preview, status: "Pending Approval", createdAt: new Date().toISOString() };
        setSurveyDrafts?.(prev => [...prev, draft]);
      }

      // AI KB Auto-Generation — trigger on Resolved
      if (newStatus === "Resolved" && azureOpenAI?.enabled) {
        generateKBFromTicket?.(updated);
      }
    }
  };

  const sendReply = () => {
    if (!replyBody.trim()) return;
    const isInternal = replyMode === "internal";
    const entry = {
      id: genId("AL"), type: isInternal ? "note" : "email", user: currentUser.name,
      time: new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }).replace(",", ""),
      detail: isInternal ? `Internal note added` : `Email sent to ${inc.reporterEmail || "reporter"}${emailAttachments.length > 0 ? ` (${emailAttachments.length} attachment${emailAttachments.length > 1 ? "s" : ""})` : ""}`,
      isInternal,
      ...(isInternal ? {} : {
        to: inc.reporterEmail || "", from: currentUser.email,
        subject: replySubject,
        body: replyBody + (smtpConfig?.signature ? `<br/><hr style="border:none;border-top:1px solid #333;margin:16px 0"/>${smtpConfig.signature}` : ""),
        attachments: emailAttachments.map(a => ({ name: a.name, size: a.size, type: a.type }))
      }),
      ...(isInternal ? { body: replyBody } : {})
    };
    const updated = { ...inc, activityLog: [...(inc.activityLog || []), entry] };
    setIncidents(prev => prev.map(i => i.id === inc.id ? updated : i));
    setDetailItem(updated);
    setReplyMode(null); setReplyBody(""); setReplySubject(`RE: ${inc.id} — ${inc.title}`); setEmailAttachments([]);
  };

  const editorToolbar = (targetId) => (
    <div style={{ display: "flex", gap: 2, padding: "6px 8px", background: "#0A0C14", borderBottom: "1px solid #1E213044", flexWrap: "wrap" }}>
      {[
        { cmd: "bold", icon: "B", style: { fontWeight: 700 } },
        { cmd: "italic", icon: "I", style: { fontStyle: "italic" } },
        { cmd: "underline", icon: "U", style: { textDecoration: "underline" } },
        { cmd: "strikeThrough", icon: "S", style: { textDecoration: "line-through" } },
      ].map(b => (
        <button key={b.cmd} title={b.cmd} onMouseDown={e => { e.preventDefault(); document.execCommand(b.cmd, false, null); }}
          style={{ width: 28, height: 26, background: "#1E2130", border: "1px solid #2A2E3E", borderRadius: 4, color: "#C4CAD6", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", ...b.style }}>
          {b.icon}
        </button>
      ))}
      <span style={{ width: 1, background: "#2A2E3E", margin: "0 4px" }} />
      {[
        { cmd: "justifyLeft", icon: "≡" },
        { cmd: "justifyCenter", icon: "≡" },
        { cmd: "justifyRight", icon: "≡" },
      ].map((b, i) => (
        <button key={b.cmd + i} title={["Align Left", "Center", "Align Right"][i]} onMouseDown={e => { e.preventDefault(); document.execCommand(b.cmd, false, null); }}
          style={{ width: 28, height: 26, background: "#1E2130", border: "1px solid #2A2E3E", borderRadius: 4, color: "#C4CAD6", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", transform: i === 2 ? "scaleX(-1)" : "none" }}>
          {b.icon}
        </button>
      ))}
      <span style={{ width: 1, background: "#2A2E3E", margin: "0 4px" }} />
      <button title="Bullet List" onMouseDown={e => { e.preventDefault(); document.execCommand("insertUnorderedList", false, null); }}
        style={{ width: 28, height: 26, background: "#1E2130", border: "1px solid #2A2E3E", borderRadius: 4, color: "#C4CAD6", cursor: "pointer", fontSize: 13 }}>•≡</button>
      <button title="Numbered List" onMouseDown={e => { e.preventDefault(); document.execCommand("insertOrderedList", false, null); }}
        style={{ width: 28, height: 26, background: "#1E2130", border: "1px solid #2A2E3E", borderRadius: 4, color: "#C4CAD6", cursor: "pointer", fontSize: 12 }}>1.</button>
      <span style={{ width: 1, background: "#2A2E3E", margin: "0 4px" }} />
      <select title="Font Size" onChange={e => { document.execCommand("fontSize", false, e.target.value); e.target.value = ""; }}
        style={{ height: 26, background: "#1E2130", border: "1px solid #2A2E3E", borderRadius: 4, color: "#C4CAD6", cursor: "pointer", fontSize: 10, padding: "0 4px" }}>
        <option value="">Size</option><option value="1">Small</option><option value="3">Normal</option><option value="5">Large</option><option value="7">Huge</option>
      </select>
      <select title="Font Color" onChange={e => { if (e.target.value) document.execCommand("foreColor", false, e.target.value); e.target.value = ""; }}
        style={{ height: 26, background: "#1E2130", border: "1px solid #2A2E3E", borderRadius: 4, color: "#C4CAD6", cursor: "pointer", fontSize: 10, padding: "0 4px" }}>
        <option value="">Color</option><option value="#FF6B6B" style={{ color: "#FF6B6B" }}>Red</option><option value="#FFB347" style={{ color: "#FFB347" }}>Orange</option>
        <option value="#81C784" style={{ color: "#81C784" }}>Green</option><option value="#64B5F6" style={{ color: "#64B5F6" }}>Blue</option><option value="#CE93D8" style={{ color: "#CE93D8" }}>Purple</option><option value="#FFFFFF">White</option>
      </select>
      <button title="Insert Link" onMouseDown={e => { e.preventDefault(); const url = prompt("Enter URL:"); if (url) document.execCommand("createLink", false, url); }}
        style={{ width: 28, height: 26, background: "#1E2130", border: "1px solid #2A2E3E", borderRadius: 4, color: "#64B5F6", cursor: "pointer", fontSize: 12 }}>🔗</button>
      <button title="Attach File" onMouseDown={e => { e.preventDefault(); fileInputRef.current && fileInputRef.current.click(); }}
        style={{ width: 28, height: 26, background: "#1E2130", border: "1px solid #2A2E3E", borderRadius: 4, color: emailAttachments.length > 0 ? "#81C784" : "#A0AEC0", cursor: "pointer", fontSize: 12 }}>📎</button>
      <input ref={fileInputRef} type="file" multiple hidden onChange={e => {
        const files = Array.from(e.target.files || []);
        files.forEach(file => {
          if (file.size > 10 * 1024 * 1024) return; // Skip files > 10MB
          const reader = new FileReader();
          reader.onload = () => setEmailAttachments(prev => [...prev, { name: file.name, size: file.size, type: file.type, data: reader.result }]);
          reader.readAsDataURL(file);
        });
        e.target.value = "";
      }} />
      {emailAttachments.length > 0 && <span style={{ fontSize: 9, color: "#81C784", fontFamily: "'JetBrains Mono', monospace", marginLeft: 4 }}>{emailAttachments.length} file{emailAttachments.length > 1 ? "s" : ""}</span>}
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000088", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)", padding: 20 }}
      onClick={() => { setModal(null); setDetailItem(null); }}>
      <div style={{ background: "#12141E", borderRadius: "12px", border: "1px solid #1E2130", width: 900, maxWidth: "95vw", maxHeight: "90vh", overflow: "hidden", boxShadow: "0 24px 48px #00000066", display: "flex", flexDirection: "column" }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #1E2130", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#12141E", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ color: "#64B5F6", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{inc.id}</span>
            <h3 style={{ margin: 0, color: "#E8ECF4", fontSize: 15, fontFamily: "'Space Grotesk', sans-serif" }}>{inc.title}</h3>
            <Badge color={STATUS_COLORS[inc.status]}>{inc.status}</Badge>
            <PriorityDot priority={inc.priority} />
            {inc.zdTicketId && (
              <span onClick={() => { setActiveModule("zendesk"); setModal(null); setDetailItem(null); }}
                style={{ fontSize: 10, padding: "3px 10px", borderRadius: 6, background: "#EC489918", border: "1px solid #EC489933", color: "#EC4899", cursor: "pointer", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 4, transition: "all 0.2s" }}
                onMouseEnter={e => { e.currentTarget.style.background = "#EC489933"; e.currentTarget.style.transform = "scale(1.05)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "#EC489918"; e.currentTarget.style.transform = "scale(1)"; }}
                title={`View Zendesk Ticket #${inc.zdTicketId}`}>
                🎫 ZD#{inc.zdTicketId}
              </span>
            )}
            {inc.aiTriaged && (
              <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 6, background: "#6366F118", border: "1px solid #6366F133", color: "#6366F1", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                🤖 AI {inc.aiConfidence}%
              </span>
            )}
            {inc.sentiment && inc.sentiment !== "neutral" && (
              <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 6, background: inc.sentiment === "frustrated" ? "#FF634718" : "#4CAF5018", border: `1px solid ${inc.sentiment === "frustrated" ? "#FF634733" : "#4CAF5033"}`, color: inc.sentiment === "frustrated" ? "#FF6347" : "#4CAF50", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                {inc.sentiment === "frustrated" ? "😤 Frustrated" : "😊 Satisfied"}{inc.sentimentScore ? ` (${inc.sentimentScore}/10)` : ""}
              </span>
            )}
            {inc.kbCoverage === "gap" && (
              <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 6, background: "#8B5CF618", border: "1px solid #8B5CF633", color: "#8B5CF6", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                📚 KB Gap{inc.suggestedKbTopic ? `: ${inc.suggestedKbTopic}` : ""}
              </span>
            )}
              
            {/* SLA Countdown */}
            {inc.slaTarget > 0 && inc.status !== "Resolved" && inc.status !== "Closed" && (() => {
              const isPaused = inc.status === "Pending" || inc.status === "On Hold";
              const elapsed = inc.createdAt ? getBusinessHoursElapsed(inc.createdAt, undefined, inc.slaPauseHistory) : (inc.created || 0);
              const remaining = inc.slaTarget - elapsed;
              const pct = Math.min(Math.round((elapsed / inc.slaTarget) * 100), 100);
              const col = isPaused ? "#A0AEC0" : pct >= 100 ? "#FF4444" : pct >= 80 ? "#FFB347" : "#4CAF50";
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 6, background: col + "12", border: `1px solid ${col}33` }}>
                  <span style={{ fontSize: 10, color: col, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                    {isPaused ? "⏸ SLA Paused" : pct >= 100 ? "⏰ BREACHED" : `⏱ ${formatSlaCountdown(remaining)}`}
                  </span>
                  <div style={{ width: 60, height: 4, background: "#1E2130", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: col, borderRadius: 2, transition: "width 0.3s" }} />
                  </div>
                  <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{pct}%</span>
                </div>
              );
            })()}
          </div>
          <button onClick={() => { setModal(null); setDetailItem(null); }} style={{ background: "none", border: "none", color: "#5A6178", cursor: "pointer", fontSize: 20, padding: "4px 8px" }}>✕</button>
        </div>
        {/* Duplicate Banner */}
        {inc.duplicateOf && (
          <div style={{ padding: "8px 20px", background: "#FF444412", borderBottom: "1px solid #FF444433", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14 }}>🔗</span>
            <span style={{ color: "#FF6B6B", fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>DUPLICATE</span>
            <span style={{ color: "#C4CAD6", fontSize: 12 }}>This ticket was auto-closed as a duplicate of</span>
            <span onClick={() => { const orig = incidents.find(i => i.id === inc.duplicateOf); if (orig) { setDetailItem(orig); } }}
              style={{ color: "#64B5F6", fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline", fontFamily: "'JetBrains Mono', monospace" }}>{inc.duplicateOf}</span>
            {inc.closedReason && <span style={{ color: "#5A6178", fontSize: 10, marginLeft: 8 }}>({inc.closedReason})</span>}
          </div>
        )}
        {/* AI Possible Duplicate Banner */}
        {inc.possibleDuplicateOf && !inc.duplicateOf && (
          <div style={{ padding: "8px 20px", background: "#F59E0B12", borderBottom: "1px solid #F59E0B33", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14 }}>⚠️</span>
            <span style={{ color: "#F59E0B", fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>POSSIBLE DUPLICATE</span>
            <span style={{ color: "#C4CAD6", fontSize: 12 }}>AI detected {inc.duplicateSimilarity || "?"}% similarity with</span>
            <span onClick={() => { const orig = incidents.find(i => i.id === inc.possibleDuplicateOf); if (orig) { setDetailItem(orig); } }}
              style={{ color: "#64B5F6", fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline", fontFamily: "'JetBrains Mono', monospace" }}>{inc.possibleDuplicateOf}</span>
            <span style={{ color: "#5A6178", fontSize: 10, marginLeft: "auto" }}>Review before merging</span>
          </div>
        )}
        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #1E2130", background: "#0F1117", flexShrink: 0 }}>
          {[{ id: "details", label: "Details", icon: "📋" }, { id: "activity", label: "Activity & Communications", icon: "💬" }, { id: "worklog", label: "Work Log", icon: "⏱️" }, { id: "aiResolve", label: "AI Resolution", icon: "🤖" }, { id: "m365Expert", label: "M365/Azure Expert", icon: "🔷" }, { id: "copilot", label: "AI Co-Pilot", icon: "💫" }, { id: "majorIncident", label: "Major Incident", icon: "🚨" }, { id: "workflow", label: "Workflow", icon: "⚡" }, { id: "runbook", label: "Runbook", icon: "📖" }].map(t => (
            <button key={t.id} onClick={() => setDetailTab(t.id)}
              style={{ padding: "10px 20px", background: detailTab === t.id ? "#12141E" : "transparent", border: "none", borderBottom: detailTab === t.id ? "2px solid #6366F1" : "2px solid transparent", color: detailTab === t.id ? "#E8ECF4" : "#5A6178", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6 }}>
              <span>{t.icon}</span> {t.label}
              {t.id === "activity" && activities.length > 0 && <span style={{ background: "#6366F1", color: "#fff", borderRadius: 10, padding: "1px 6px", fontSize: 9, fontWeight: 700, marginLeft: 2 }}>{activities.length}</span>}
              {t.id === "worklog" && (inc.workLogs || []).length > 0 && <span style={{ background: "#FFB347", color: "#000", borderRadius: 10, padding: "1px 6px", fontSize: 9, fontWeight: 700, marginLeft: 2 }}>{(inc.workLogs || []).length}</span>}
            </button>
          ))}
        </div>
        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
          {detailTab === "details" && (
            <>
              {/* v3.32.0 (Phase 2) — AI Summary header */}
              <AiSummaryHeader inc={inc} />
              {/* Core Fields */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
                <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>STATUS</span><Badge color={STATUS_COLORS[inc.status]}>{inc.status}</Badge></div>
                <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>PRIORITY</span><PriorityDot priority={inc.priority} /></div>
                <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>URGENCY</span><span style={{ color: "#FFB347", fontSize: 13, fontWeight: 600 }}>{inc.urgency || "—"}</span></div>
                <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>IMPACT</span><Badge color={inc.impact === "Enterprise" ? PRIORITY_COLORS["Sev-A"] : inc.impact === "Department" ? PRIORITY_COLORS["Sev-B"] : PRIORITY_COLORS["Sev-D"]}>{inc.impact || "—"}</Badge></div>
                <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>CATEGORY</span><span style={{ color: "#C4CAD6", fontSize: 13 }}>{inc.category}{inc.subcategory ? ` › ${inc.subcategory}` : ""}</span></div>
                <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>CONTACT METHOD</span><span style={{ color: "#A0AEC0", fontSize: 13 }}>{inc.contactMethod || "—"}</span></div>
              </div>
              {/* Assignment & Reporter */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>ASSIGNEE</span><span style={{ color: "#C4CAD6", fontSize: 13 }}>{inc.assignee}</span>{inc.assignmentGroup && <span style={{ color: "#5A6178", fontSize: 11, marginLeft: 6 }}>({inc.assignmentGroup})</span>}</div>
                <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>REPORTER</span><span style={{ color: "#C4CAD6", fontSize: 13 }}>{inc.reporter}</span>{inc.reporterEmail && <div style={{ color: "#64B5F6", fontSize: 11, marginTop: 2 }}>{inc.reporterEmail}</div>}{inc.reporterRole && <div style={{ color: "#5A6178", fontSize: 10 }}>{inc.reporterRole}</div>}</div>
              </div>
              {/* Customer Info */}
              {inc.customer && <div style={{ background: "#0A0C14", borderRadius: 6, padding: 12, marginBottom: 16, border: "1px solid #1E213044" }}>
                <span style={{ fontSize: 11, color: "#CE93D8", fontFamily: "'JetBrains Mono', monospace", display: "block", marginBottom: 8 }}>🏢 CUSTOMER</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div><span style={{ fontSize: 10, color: "#5A6178", display: "block", marginBottom: 2 }}>COMPANY</span><span style={{ color: "#E8ECF4", fontSize: 13, fontWeight: 600 }}>{inc.customer}</span></div>
                  <div><span style={{ fontSize: 10, color: "#5A6178", display: "block", marginBottom: 2 }}>CONTACT PERSON</span><span style={{ color: "#C4CAD6", fontSize: 13 }}>{inc.customerContact || "—"}</span></div>
                  {inc.customerPhone && <div><span style={{ fontSize: 10, color: "#5A6178", display: "block", marginBottom: 2 }}>PHONE</span><span style={{ color: "#64B5F6", fontSize: 13 }}>{inc.customerPhone}</span></div>}
                  {inc.customerAddress && <div><span style={{ fontSize: 10, color: "#5A6178", display: "block", marginBottom: 2 }}>ADDRESS</span><span style={{ color: "#A0AEC0", fontSize: 12 }}>{inc.customerAddress}</span></div>}
                </div>
              </div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>AFFECTED SERVICE</span><span style={{ color: "#CE93D8", fontSize: 13 }}>{inc.affectedService || "—"}</span></div>
                <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>AFFECTED ASSET / PC</span><span style={{ color: "#64B5F6", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>{inc.affectedAsset || "—"}</span></div>
                <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>LOCATION</span><span style={{ color: "#C4CAD6", fontSize: 13 }}>{inc.location || "—"}</span></div>
                <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>CREATED</span><span style={{ color: "#C4CAD6", fontSize: 13 }}>{timeAgo(inc.created)}</span>{inc.firstResponseTime != null && <div style={{ color: "#81C784", fontSize: 10 }}>First response: {inc.firstResponseTime}h</div>}</div>
              </div>
              {/* SLA Progress */}
              {(() => {
                const isPaused = inc.status === "Pending" || inc.status === "On Hold";
                const slaCalc = computeIncidentSla(inc);
                const slaPct = slaCalc.hasValidSla ? slaCalc.pctUsed : Math.min(100, Math.round((inc.created / inc.slaTarget) * 100));
                const hrsElapsed = slaCalc.hasValidSla ? slaCalc.hoursElapsed : inc.created;
                const hrsLeft = slaCalc.hasValidSla ? slaCalc.remainingHours : Math.max(0, inc.slaTarget - inc.created);
                const isBreach = slaPct >= 100;
                const isCritical = slaPct > 90 && !isBreach;
                const isWarning = slaPct > 75 && !isCritical && !isBreach;
                const pauseEntries = inc.slaPauseHistory || [];
                const totalPausedHrs = pauseEntries.length > 0 ? pauseEntries.reduce((sum, p) => {
                  if (!p.pausedAt) return sum;
                  const pS = new Date(p.pausedAt), pE = p.resumedAt ? new Date(p.resumedAt) : new Date();
                  return sum + ((pE - pS) / 3600000);
                }, 0) : 0;
                return (
                  <div style={{
                    background: isBreach ? "linear-gradient(135deg, #1A080888, #2D0A0A88)" : isCritical ? "linear-gradient(135deg, #1A150888, #2D1F0A88)" : "#0A0C14",
                    borderRadius: 6, padding: 12, marginBottom: 16,
                    border: isBreach ? "1px solid #FF444444" : isCritical ? "1px solid #FF6B6B33" : "1px solid #1E213044",
                    animation: isBreach ? "criticalGlow 1.5s ease-in-out infinite" : isCritical ? "warningGlow 2s ease-in-out infinite" : "none"
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: isBreach ? "#FF6B6B" : "#5A6178", fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 4 }}>
                        {isBreach && <span style={{ animation: "slaBlinkFast 0.6s infinite" }}>🚨</span>}
                        {isCritical && <span style={{ animation: "slaBlink 0.8s infinite" }}>⚠️</span>}
                        SLA PROGRESS
                      </span>
                      <span style={{
                        fontSize: 11, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700,
                        color: isBreach ? "#FF4444" : isCritical ? "#FF6B6B" : isWarning ? "#FFB347" : "#81C784",
                        animation: isBreach ? "slaBreachPulse 0.8s infinite" : isCritical ? "slaBlinkFast 0.6s infinite" : isWarning ? "slaBlink 1.2s infinite" : "none"
                      }}>
                        {slaPct}% {isBreach ? "— BREACHED" : isCritical ? `— ${hrsLeft.toFixed(1)}h LEFT` : ""}
                      </span>
                    </div>
                    <div style={{ height: 6, background: "#1E2130", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", width: `${slaPct}%`,
                        background: isBreach ? "linear-gradient(90deg, #FF4444, #FF6B6B)" : isCritical ? "linear-gradient(90deg, #FF6B6B, #FFB347)" : isWarning ? "#FFB347" : "#81C784",
                        borderRadius: 3, transition: "width 0.3s",
                        animation: isBreach ? "slaBreachPulse 0.8s infinite" : "none"
                      }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "#5A6178" }}>
                      <span>Elapsed: {hrsElapsed.toFixed(1)}h{totalPausedHrs > 0 ? ` (${Math.round(totalPausedHrs * 10) / 10}h paused)` : ""}</span><span>Target: {inc.slaTarget}h</span>
                    </div>
                    {/* SLA Pause Indicator */}
                    {isPaused && (
                      <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 6, background: "#A0AEC00D", border: "1px solid #A0AEC022", display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 14 }}>⏸</span>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#A0AEC0", marginBottom: 1 }}>SLA CLOCK PAUSED</div>
                          <div style={{ fontSize: 9, color: "#5A6178" }}>Status: {inc.status} — SLA timer is not counting. Will resume when status changes to an active state.</div>
                        </div>
                      </div>
                    )}
                    {/* AI Assist Urgency Guidance */}
                    {(isBreach || isCritical || isWarning) && (
                      <div style={{
                        marginTop: 10, padding: "8px 12px", borderRadius: 6,
                        background: isBreach ? "#FF444411" : isCritical ? "#FF6B6B0D" : "#FFB3470D",
                        border: `1px solid ${isBreach ? "#FF444433" : isCritical ? "#FF6B6B22" : "#FFB34722"}`,
                        display: "flex", alignItems: "flex-start", gap: 8
                      }}>
                        <span style={{ fontSize: 14, flexShrink: 0, animation: isBreach ? "slaBlinkFast 0.6s infinite" : "slaBlink 1.2s infinite" }}>🤖</span>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: isBreach ? "#FF4444" : isCritical ? "#FF6B6B" : "#FFB347", marginBottom: 2 }}>
                            {isBreach ? "⚡ IMMEDIATE ACTION REQUIRED" : isCritical ? "⚠️ URGENT — SLA at risk" : "📋 Attention needed"}
                          </div>
                          <div style={{ fontSize: 10, color: "#C4CAD6", lineHeight: 1.5 }}>
                            {isBreach
                              ? "SLA has been breached. Escalate to management immediately. Document the delay reason and notify the customer with an updated timeline."
                              : isCritical
                              ? `Only ${hrsLeft.toFixed(1)}h remaining. Prioritize this ticket now. Consider escalating or reassigning if blocked. Update the customer proactively.`
                              : `SLA is ${slaPct}% consumed. Ensure progress is being made. Plan resolution steps to avoid breach.`}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* Description */}
              <div style={{ background: "#0A0C14", borderRadius: 6, padding: 14, marginBottom: 16, border: "1px solid #1E213044" }}>
                <span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>DESCRIPTION</span>
                <p style={{ color: "#C4CAD6", fontSize: 13, margin: 0, lineHeight: 1.6 }}>{inc.description}</p>
              </div>
              {/* Custom Fields */}
              {(() => {
                const moduleFields = customFields.filter(cf => cf.active !== false && cf.name && (cf.module === "incidents" || cf.module === "all"));
                if (moduleFields.length === 0) return null;
                const vals = inc.customFieldValues || {};
                return (
                  <div style={{ background: "#0A0C14", borderRadius: 6, padding: 14, marginBottom: 16, border: "1px solid #1E213044" }}>
                    <span style={{ fontSize: 11, color: "#CE93D8", fontFamily: "'JetBrains Mono', monospace", display: "block", marginBottom: 8 }}>🏷️ CUSTOM FIELDS</span>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {moduleFields.map(cf => (
                        <div key={cf.id}>
                          <label style={{ fontSize: 10, color: "#5A6178", display: "block", marginBottom: 3 }}>{cf.name}{cf.required ? " *" : ""}</label>
                          {cf.type === "checkbox" ? (
                            <input type="checkbox" checked={!!vals[cf.id]} onChange={e => {
                              const newVals = { ...vals, [cf.id]: e.target.checked };
                              const updated = { ...inc, customFieldValues: newVals };
                              setIncidents(prev => prev.map(i => i.id === inc.id ? { ...i, customFieldValues: newVals } : i));
                              setDetailItem(updated);
                            }} />
                          ) : cf.type === "dropdown" ? (
                            <select value={vals[cf.id] || ""} onChange={e => {
                              const newVals = { ...vals, [cf.id]: e.target.value };
                              const updated = { ...inc, customFieldValues: newVals };
                              setIncidents(prev => prev.map(i => i.id === inc.id ? { ...i, customFieldValues: newVals } : i));
                              setDetailItem(updated);
                            }} style={{ ...inputStyle, fontSize: 12, width: "100%" }}>
                              <option value="">— Select —</option>
                              {(cf.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : cf.type === "textarea" ? (
                            <textarea value={vals[cf.id] || ""} onChange={e => {
                              const newVals = { ...vals, [cf.id]: e.target.value };
                              const updated = { ...inc, customFieldValues: newVals };
                              setIncidents(prev => prev.map(i => i.id === inc.id ? { ...i, customFieldValues: newVals } : i));
                              setDetailItem(updated);
                            }} rows={2} style={{ ...inputStyle, fontSize: 12, width: "100%", resize: "vertical" }} />
                          ) : (
                            <input type={cf.type === "number" ? "number" : cf.type === "date" ? "date" : "text"} value={vals[cf.id] || ""} onChange={e => {
                              const newVals = { ...vals, [cf.id]: e.target.value };
                              const updated = { ...inc, customFieldValues: newVals };
                              setIncidents(prev => prev.map(i => i.id === inc.id ? { ...i, customFieldValues: newVals } : i));
                              setDetailItem(updated);
                            }} style={{ ...inputStyle, fontSize: 12, width: "100%" }} />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {inc.workaround && (
                <div style={{ background: "#0A1E2D", borderRadius: 6, padding: 12, border: "1px solid #06B6D422", marginBottom: 16 }}>
                  <span style={{ fontSize: 11, color: "#06B6D4", fontFamily: "'JetBrains Mono', monospace", display: "block", marginBottom: 4 }}>WORKAROUND</span>
                  <p style={{ color: "#C4CAD6", fontSize: 12, margin: 0 }}>{inc.workaround}</p>
                </div>
              )}
              {inc.resolutionNotes && (
                <div style={{ background: "#0D2D1A", borderRadius: 6, padding: 12, border: "1px solid #81C78422", marginBottom: 16 }}>
                  <span style={{ fontSize: 11, color: "#81C784", fontFamily: "'JetBrains Mono', monospace", display: "block", marginBottom: 4 }}>RESOLUTION NOTES</span>
                  <p style={{ color: "#C4CAD6", fontSize: 12, margin: 0 }}>{inc.resolutionNotes}</p>
                  {inc.closureCode && <div style={{ marginTop: 6, fontSize: 10, color: "#5A6178" }}>Closure Code: <span style={{ color: "#81C784" }}>{inc.closureCode}</span></div>}
                </div>
              )}
              {/* v3.32.1 (Phase 2) — Draft Resolution Notes panel (when empty) */}
              {!inc.resolutionNotes && !["Closed", "Cancelled"].includes(inc.status) && (
                <div style={{ background: "#0F1117", borderRadius: 8, padding: 12, border: "1px solid #6EE7B744", marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: draftResolutionData ? 10 : 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 14 }}>📝</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#6EE7B7", fontFamily: "'JetBrains Mono', monospace" }}>DRAFT RESOLUTION NOTES</span>
                      <span style={{ fontSize: 9, color: "#5A6178" }}>v3.32 · from worklog history</span>
                    </div>
                    <button disabled={draftResolutionLoading} onClick={async () => {
                      setDraftResolutionLoading(true);
                      try {
                        const r = await fetch("/api/ai/draft-resolution", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ticketId: inc.id }) });
                        if (r.ok) setDraftResolutionData(await r.json());
                        else setDraftResolutionData({ error: `HTTP ${r.status}` });
                      } catch (e) { setDraftResolutionData({ error: e.message }); }
                      setDraftResolutionLoading(false);
                    }} style={{ ...btnStyle("#6EE7B7"), padding: "5px 12px", fontSize: 10, opacity: draftResolutionLoading ? 0.6 : 1 }}>
                      {draftResolutionLoading ? "Drafting…" : draftResolutionData ? "↻ Re-draft" : "✨ Generate"}
                    </button>
                  </div>
                  {draftResolutionData && draftResolutionData.error && <div style={{ color: "#FF6B6B", fontSize: 11, marginTop: 8 }}>⚠ {draftResolutionData.error}</div>}
                  {draftResolutionData && draftResolutionData.resolutionDraft && (
                    <>
                      <textarea defaultValue={draftResolutionData.resolutionDraft}
                        onChange={e => setDraftResolutionData(d => ({ ...d, resolutionDraft: e.target.value }))}
                        style={{ width: "100%", minHeight: 110, padding: 10, background: "#0A0C14", color: "#C4CAD6", border: "1px solid #6EE7B722", borderRadius: 6, fontSize: 12, lineHeight: 1.55, fontFamily: "inherit", resize: "vertical" }} />
                      {draftResolutionData.rootCause && <div style={{ marginTop: 8, fontSize: 11, color: "#C4CAD6" }}><strong style={{ color: "#FBBF24" }}>Root cause:</strong> {draftResolutionData.rootCause}</div>}
                      {draftResolutionData.preventiveTip && <div style={{ marginTop: 4, fontSize: 11, color: "#C4CAD6" }}><strong style={{ color: "#A5B4FC" }}>Tip for customer:</strong> {draftResolutionData.preventiveTip}</div>}
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button onClick={() => {
                          const updated = { ...inc, resolutionNotes: draftResolutionData.resolutionDraft };
                          setIncidents(prev => prev.map(i => i.id === inc.id ? updated : i));
                          setDetailItem(updated);
                          addActivity("ai_resolution", `AI-drafted resolution notes posted (${draftResolutionData.resolutionDraft.length} chars).`);
                          showToast("✅ Resolution notes posted", "success");
                          setDraftResolutionData(null);
                        }} style={{ ...btnStyle("#4CAF50"), padding: "6px 14px", fontSize: 11 }}>✅ Post as Resolution</button>
                        <button onClick={() => setDraftResolutionData(null)} style={{ ...btnStyle("#333"), color: "#A0AEC0", padding: "6px 14px", fontSize: 11 }}>Cancel</button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {inc.linkedProblem && (
                <div style={{ background: "#1A0A2D", borderRadius: 6, padding: 12, border: "1px solid #CE93D822", marginBottom: 16, cursor: "pointer" }}
                  onClick={() => { const prb = problems.find(p => p.id === inc.linkedProblem); if (prb) { setDetailItem(prb); setModal("problemDetail"); } }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#CE93D866"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "#CE93D822"}>
                  <span style={{ fontSize: 11, color: "#CE93D8", fontFamily: "'JetBrains Mono', monospace" }}>Linked Problem: {inc.linkedProblem} <span style={{ color: "#5A6178" }}>(click to view)</span></span>
                </div>
              )}
              {/* Zendesk Ticket Link */}
              {inc.zdTicketId && (
                <div style={{ background: "#2D0A1A", borderRadius: 6, padding: 12, border: "1px solid #EC489822", marginBottom: 16, cursor: "pointer", transition: "all 0.2s" }}
                  onClick={() => { setActiveModule("zendesk"); setModal(null); setDetailItem(null); }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#EC489866"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#EC489822"; e.currentTarget.style.transform = "translateY(0)"; }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, color: "#EC4899", fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6 }}>
                      🎫 Linked Zendesk Ticket: #{inc.zdTicketId}
                    </span>
                    <span style={{ fontSize: 10, color: "#EC489988" }}>View in Zendesk →</span>
                  </div>
                  {inc.aiTriaged && (
                    <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                      <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#6366F122", color: "#6366F1", fontWeight: 600 }}>🤖 AI Triaged</span>
                      <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: inc.aiConfidence >= 85 ? "#81C78422" : "#FFB34722", color: inc.aiConfidence >= 85 ? "#81C784" : "#FFB347", fontWeight: 600 }}>{inc.aiConfidence}% confidence</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {detailTab === "activity" && (
            <>
              {/* Reply Buttons */}
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <button style={btnStyle("#3B82F6")} onClick={() => { setReplyMode("external"); setReplySubject(`RE: ${inc.id} — ${inc.title}`); }}>📧 Reply to Reporter</button>
                <button style={{ ...btnStyle("#06B6D4"), display: "flex", alignItems: "center", gap: 4 }} onClick={async () => {
                  setReplyMode("external");
                  setReplySubject(`RE: ${inc.id} — ${inc.title}`);
                  setSuggestedRepliesPanel(true);
                  if (!suggestedRepliesData) {
                    setSuggestedRepliesLoading(true);
                    try {
                      const r = await fetch("/api/ai/suggested-replies", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ticketId: inc.id }) });
                      if (r.ok) setSuggestedRepliesData(await r.json());
                      else setSuggestedRepliesData({ error: `HTTP ${r.status}` });
                    } catch (e) { setSuggestedRepliesData({ error: e.message }); }
                    setSuggestedRepliesLoading(false);
                  }
                }}>💡 Quick Replies</button>
                <button style={btnStyle("#6366F1")} onClick={() => setReplyMode("internal")}>📝 Add Internal Note</button>
                <button style={{ ...btnStyle("#8B5CF6"), display: "flex", alignItems: "center", gap: 4 }} onClick={() => { setReplyMode("external"); setReplySubject(`RE: ${inc.id} — ${inc.title}`); setAiDraftPanel(true); }}>✨ AI Compose</button>
              </div>

              {/* Compose Area */}
              {replyMode && (
                <div style={{ background: "#0A0C14", borderRadius: 8, border: `1px solid ${replyMode === "internal" ? "#FFB34744" : "#3B82F644"}`, marginBottom: 20, overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", background: replyMode === "internal" ? "#2D1F0A11" : "#0D213711", borderBottom: "1px solid #1E213044", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13 }}>{replyMode === "internal" ? "📝" : "📧"}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: replyMode === "internal" ? "#FFB347" : "#64B5F6", fontFamily: "'JetBrains Mono', monospace" }}>
                        {replyMode === "internal" ? "INTERNAL NOTE" : "REPLY TO REPORTER"}
                      </span>
                      {replyMode === "internal" && <span style={{ fontSize: 9, color: "#FFB347", background: "#FFB34718", padding: "2px 6px", borderRadius: 4 }}>Not visible to reporter</span>}
                    </div>
                    <button onClick={() => { setReplyMode(null); setReplyBody(""); }} style={{ background: "none", border: "none", color: "#5A6178", cursor: "pointer", fontSize: 14 }}>✕</button>
                  </div>
                  {replyMode === "external" && (
                    <div style={{ padding: "8px 14px", borderBottom: "1px solid #1E213044", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", minWidth: 32 }}>TO:</span>
                      <span style={{ fontSize: 12, color: "#64B5F6" }}>{inc.reporterEmail || "—"}</span>
                      <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginLeft: 12, minWidth: 32 }}>FROM:</span>
                      <span style={{ fontSize: 12, color: "#81C784" }}>{smtpConfig?.fromEmail || "—"}</span>
                    </div>
                  )}
                  {replyMode === "external" && (
                    <div style={{ padding: "8px 14px", borderBottom: "1px solid #1E213044", display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", minWidth: 32 }}>SUBJ:</span>
                      <input value={replySubject} onChange={e => setReplySubject(e.target.value)}
                        style={{ ...inputStyle, flex: 1, padding: "4px 8px", fontSize: 12, margin: 0 }} />
                    </div>
                  )}
                  {editorToolbar("reply-editor")}
                  {emailAttachments.length > 0 && (
                    <div style={{ padding: "6px 14px", background: "#0A0C14", borderBottom: "1px solid #1E213044", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>ATTACHMENTS:</span>
                      {emailAttachments.map((att, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, background: "#1E2130", borderRadius: 4, padding: "3px 8px", border: "1px solid #2A2E3E" }}>
                          <span style={{ fontSize: 10 }}>📄</span>
                          <span style={{ fontSize: 10, color: "#C4CAD6", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.name}</span>
                          <span style={{ fontSize: 9, color: "#5A6178" }}>({(att.size / 1024).toFixed(0)}KB)</span>
                          <button onClick={() => setEmailAttachments(prev => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: "#FF6B6B", cursor: "pointer", fontSize: 10, padding: 0, marginLeft: 2 }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* v3.32.1 (Phase 2) — Suggested Replies Panel */}
                  {suggestedRepliesPanel && replyMode === "external" && (
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid #06B6D444", background: "#06B6D408" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12 }}>💡</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#06B6D4", fontFamily: "'JetBrains Mono', monospace" }}>QUICK REPLIES</span>
                          <span style={{ fontSize: 9, color: "#5A6178" }}>v3.32 · grounded by KB</span>
                        </div>
                        <button onClick={() => setSuggestedRepliesPanel(false)} style={{ background: "none", border: "none", color: "#5A6178", cursor: "pointer", fontSize: 12 }}>✕</button>
                      </div>
                      {suggestedRepliesLoading && <div style={{ color: "#5A6178", fontSize: 11, padding: "6px 0" }}>Generating 3 drafts…</div>}
                      {suggestedRepliesData && suggestedRepliesData.error && <div style={{ color: "#FF6B6B", fontSize: 11, padding: "6px 0" }}>⚠ {suggestedRepliesData.error}</div>}
                      {suggestedRepliesData && Array.isArray(suggestedRepliesData.replies) && (
                        <div style={{ display: "grid", gap: 8 }}>
                          {suggestedRepliesData.replies.map((rep, i) => {
                            const toneAccent = rep.tone === "diagnostic" ? "#FBBF24" : rep.tone === "kb-link" ? "#A5B4FC" : "#6EE7B7";
                            const toneLabel = rep.tone === "diagnostic" ? "Diagnostic" : rep.tone === "kb-link" ? "KB Walk-through" : "Closing";
                            return (
                              <div key={i} style={{ background: "#0A0C14", borderRadius: 6, border: `1px solid ${toneAccent}33`, padding: 10 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                  <span style={{ fontSize: 9, fontWeight: 700, color: toneAccent, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>{toneLabel}</span>
                                  <button onClick={() => {
                                    const editor = document.getElementById("reply-editor");
                                    const html = String(rep.text).replace(/\n/g, "<br>");
                                    if (editor) { editor.innerHTML = html; setReplyBody(html); }
                                    setSuggestedRepliesPanel(false);
                                  }} style={{ ...btnStyle("#06B6D4"), padding: "4px 10px", fontSize: 10 }}>Use</button>
                                </div>
                                <div style={{ fontSize: 12, color: "#C4CAD6", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{rep.text}</div>
                              </div>
                            );
                          })}
                          {suggestedRepliesData.kbCited && suggestedRepliesData.kbCited.length > 0 && (
                            <div style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>
                              KB grounding: {suggestedRepliesData.kbCited.map(k => `[${k.id}]`).join(" ")}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {/* AI Email Draft Panel */}
                  {aiDraftPanel && replyMode === "external" && (
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid #8B5CF644", background: "#8B5CF608" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12 }}>✨</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#8B5CF6", fontFamily: "'JetBrains Mono', monospace" }}>AI EMAIL COMPOSER</span>
                        </div>
                        <button onClick={() => setAiDraftPanel(false)} style={{ background: "none", border: "none", color: "#5A6178", cursor: "pointer", fontSize: 12 }}>✕</button>
                      </div>
                      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                        {["professional", "empathetic", "technical", "escalation", "resolution"].map(tone => (
                          <button key={tone} onClick={() => setAiDraftTone(tone)}
                            style={{ padding: "3px 10px", borderRadius: 12, border: `1px solid ${aiDraftTone === tone ? "#8B5CF6" : "#2A2E3E"}`, background: aiDraftTone === tone ? "#8B5CF622" : "#0A0C14", color: aiDraftTone === tone ? "#8B5CF6" : "#5A6178", fontSize: 10, cursor: "pointer", textTransform: "capitalize", fontWeight: aiDraftTone === tone ? 600 : 400 }}>
                            {tone}
                          </button>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button disabled={aiDraftLoading} onClick={async () => {
                          setAiDraftLoading(true); setAiDraftResult("");
                          try {
                            const r = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ message: `Draft a ${aiDraftTone} email reply for IT support ticket:\nID: ${inc.id}\nTitle: ${inc.title}\nCategory: ${inc.category}\nPriority: ${inc.priority}\nStatus: ${inc.status}\nDescription: ${(inc.description || "").substring(0, 500)}\nReporter: ${inc.reporter}\n\nWrite a ${aiDraftTone} email response. Be concise, helpful, and include next steps. Do not include subject line.` })
                            });
                            const d = await r.json(); setAiDraftResult(d.reply || d.message || "Unable to generate draft.");
                          } catch { setAiDraftResult("AI service unavailable."); }
                          setAiDraftLoading(false);
                        }} style={{ ...btnStyle("#8B5CF6"), padding: "5px 14px", fontSize: 10, opacity: aiDraftLoading ? 0.6 : 1 }}>
                          {aiDraftLoading ? "⏳ Generating..." : "🪄 Generate Draft"}
                        </button>
                        {aiDraftResult && (
                          <button onClick={() => {
                            const editor = document.getElementById("reply-editor");
                            if (editor) { editor.innerHTML = aiDraftResult.replace(/\n/g, "<br>"); setReplyBody(aiDraftResult.replace(/\n/g, "<br>")); }
                            setAiDraftPanel(false);
                          }} style={{ ...btnStyle("#4CAF50"), padding: "5px 14px", fontSize: 10 }}>✅ Use This Draft</button>
                        )}
                      </div>
                      {aiDraftResult && (
                        <div style={{ marginTop: 8, padding: 10, background: "#0A0C14", borderRadius: 6, border: "1px solid #1E2130", maxHeight: 160, overflow: "auto" }}>
                          <div style={{ fontSize: 9, color: "#8B5CF6", fontWeight: 600, marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>PREVIEW — {aiDraftTone.toUpperCase()} TONE</div>
                          <div style={{ fontSize: 12, color: "#C4CAD6", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{aiDraftResult}</div>
                        </div>
                      )}
                    </div>
                  )}
                  <div id="reply-editor" contentEditable
                    onInput={e => setReplyBody(sanitizeHTML(e.currentTarget.innerHTML))}
                    style={{ minHeight: 120, maxHeight: 260, overflow: "auto", padding: "12px 14px", color: "#C4CAD6", fontSize: 13, lineHeight: 1.6, outline: "none", background: "#0F1117" }}
                    suppressContentEditableWarning />
                  <div style={{ padding: "10px 14px", borderTop: "1px solid #1E213044", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 10, color: "#5A617888" }}>
                      {replyMode === "external" ? `Via ${smtpConfig?.host || "—"}:${smtpConfig?.port || "—"} (${smtpConfig?.encryption || "—"})` : "Internal note — visible to agents only"}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => { setReplyMode(null); setReplyBody(""); }} style={{ ...btnStyle("#333"), color: "#A0AEC0", padding: "6px 14px", fontSize: 11 }}>Cancel</button>
                      <button onClick={sendReply} style={{ ...btnStyle(replyMode === "internal" ? "#FFB347" : "#3B82F6"), padding: "6px 14px", fontSize: 11 }}>
                        {replyMode === "internal" ? "💾 Save Note" : "📤 Send Email"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Activity Timeline */}
              <div style={{ position: "relative", paddingLeft: 24 }}>
                <div style={{ position: "absolute", left: 7, top: 4, bottom: 4, width: 2, background: "#1E2130" }} />
                {activities.slice().reverse().map((act, idx) => (
                  <div key={act.id || idx} style={{ position: "relative", marginBottom: 16 }}>
                    <div style={{ position: "absolute", left: -20, top: 4, width: 12, height: 12, borderRadius: "50%",
                      background: act.type === "email" ? "#3B82F6" : act.type === "note" ? "#FFB347" : act.type === "status" ? "#6366F1" : "#5A6178",
                      border: "2px solid #12141E", zIndex: 1 }} />
                    <div style={{ background: "#0A0C14", borderRadius: 8, border: `1px solid ${act.type === "email" ? "#3B82F622" : act.type === "note" ? "#FFB34722" : "#1E213044"}`, overflow: "hidden" }}>
                      <div style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: (act.type === "email" || (act.type === "note" && act.body)) ? "1px solid #1E213022" : "none" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 12 }}>{act.type === "email" ? "📧" : act.type === "note" ? "📝" : "🔄"}</span>
                          <span style={{ fontSize: 12, color: "#E8ECF4", fontWeight: 500 }}>{act.user}</span>
                          {act.isInternal && <span style={{ fontSize: 9, color: "#FFB347", background: "#FFB34718", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>INTERNAL</span>}
                        </div>
                        <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{act.time}</span>
                      </div>
                      <div style={{ padding: "8px 12px" }}>
                        <div style={{ fontSize: 12, color: "#A0AEC0", marginBottom: act.body ? 8 : 0 }}>{act.detail}</div>
                        {act.type === "email" && act.subject && (
                          <div style={{ fontSize: 11, color: "#64B5F6", marginBottom: 4, fontWeight: 600 }}>Subject: {act.subject}</div>
                        )}
                        {act.type === "email" && (
                          <div style={{ fontSize: 10, color: "#5A617888", marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>
                            {act.from && <span>From: {act.from}</span>}{act.to && <span style={{ marginLeft: 12 }}>To: {act.to}</span>}
                          </div>
                        )}
                        {act.body && (
                          <div style={{ background: "#0F1117", borderRadius: 4, padding: "8px 10px", border: "1px solid #1E213022", fontSize: 12, color: "#C4CAD6", lineHeight: 1.5 }}
                            dangerouslySetInnerHTML={{ __html: sanitizeHTML(act.body) }} />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {activities.length === 0 && (
                  <div style={{ padding: 30, textAlign: "center", color: "#5A6178", fontSize: 13 }}>No activity yet. Use the buttons above to reply or add notes.</div>
                )}
              </div>
            </>
          )}

          {/* ─── Work Log Tab ─── */}
          {detailTab === "worklog" && (() => {
            const workLogs = inc.workLogs || [];
            const totalHrs = workLogs.reduce((s, w) => s + (w.hours || 0), 0);
            return (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#FFB347", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1.2 }}>⏱️ WORK LOG</div>
                    <div style={{ fontSize: 10, color: "#5A6178", marginTop: 2 }}>Total logged: <span style={{ color: "#E8ECF4", fontWeight: 700 }}>{totalHrs.toFixed(1)}h</span> across {workLogs.length} entries</div>
                  </div>
                </div>
                {/* Add Work Log Form */}
                <div style={{ background: "#0A0C14", borderRadius: 8, padding: 14, marginBottom: 16, border: "1px solid #1E213044" }}>
                  <div style={{ fontSize: 10, color: "#6366F1", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>➕ LOG WORK</div>
                  <div style={{ display: "grid", gridTemplateColumns: "120px 120px 1fr", gap: 10, alignItems: "end" }}>
                    <div>
                      <label style={{ fontSize: 10, color: "#5A6178", display: "block", marginBottom: 4 }}>Hours Spent</label>
                      <input id="wl-hours" type="number" min="0.25" step="0.25" defaultValue="1" style={{ ...inputStyle, fontSize: 12, width: "100%" }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: "#5A6178", display: "block", marginBottom: 4 }}>Category</label>
                      <select id="wl-category" style={{ ...inputStyle, fontSize: 12, width: "100%" }}>
                        <option value="investigation">Investigation</option>
                        <option value="resolution">Resolution</option>
                        <option value="communication">Communication</option>
                        <option value="testing">Testing</option>
                        <option value="documentation">Documentation</option>
                        <option value="escalation">Escalation</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: "#5A6178", display: "block", marginBottom: 4 }}>Description</label>
                      <input id="wl-desc" type="text" placeholder="What was done..." style={{ ...inputStyle, fontSize: 12, width: "100%" }} />
                    </div>
                  </div>
                  <button style={{ ...btnStyle("#6366F1"), marginTop: 10, fontSize: 11 }} onClick={() => {
                    const hrs = parseFloat(document.getElementById("wl-hours")?.value) || 0;
                    const cat = document.getElementById("wl-category")?.value || "other";
                    const desc = document.getElementById("wl-desc")?.value?.trim() || "";
                    if (hrs <= 0 || !desc) return;
                    const entry = { id: genId("WL"), user: currentUser.name, hours: hrs, category: cat, description: desc, loggedAt: new Date().toISOString() };
                    const updatedLogs = [...(inc.workLogs || []), entry];
                    const updated = { ...inc, workLogs: updatedLogs };
                    setIncidents(prev => prev.map(i => i.id === inc.id ? { ...i, workLogs: updatedLogs } : i));
                    setDetailItem(updated);
                    const descEl = document.getElementById("wl-desc"); if (descEl) descEl.value = "";
                    const hrsEl = document.getElementById("wl-hours"); if (hrsEl) hrsEl.value = "1";
                  }}>
                    ➕ Log Work
                  </button>
                </div>
                {/* Work Log Entries */}
                {workLogs.length === 0 && <div style={{ padding: 30, textAlign: "center", color: "#5A6178", fontSize: 13 }}>No work logged yet. Use the form above to track time spent.</div>}
                {[...workLogs].reverse().map(wl => (
                  <div key={wl.id} style={{ background: "#0F1117", borderRadius: 8, padding: 12, marginBottom: 8, border: "1px solid #1E213033", display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#6366F118", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>⏱️</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "#E8ECF4", fontSize: 12, fontWeight: 600 }}>{wl.user}</span>
                        <span style={{ color: "#5A6178", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>{wl.loggedAt ? new Date(wl.loggedAt).toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }) : "—"}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#C4CAD6", marginTop: 4 }}>{wl.description}</div>
                      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "#FFB34718", color: "#FFB347", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{wl.hours}h</span>
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "#6366F118", color: "#6366F1", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", textTransform: "capitalize" }}>{wl.category}</span>
                      </div>
                    </div>
                    <button onClick={() => {
                      const updatedLogs = (inc.workLogs || []).filter(w => w.id !== wl.id);
                      const updated = { ...inc, workLogs: updatedLogs };
                      setIncidents(prev => prev.map(i => i.id === inc.id ? { ...i, workLogs: updatedLogs } : i));
                      setDetailItem(updated);
                    }} style={{ background: "none", border: "none", color: "#FF4444", cursor: "pointer", fontSize: 12, padding: 4, opacity: 0.5 }} title="Delete entry">✕</button>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* ─── AI Resolution Suggestions Tab ─── */}
          {detailTab === "aiResolve" && <AiResolveTab inc={inc} addActivity={addActivity} showToast={showToast} />}
          {detailTab === "m365Expert" && <M365ExpertPanel inc={inc} currentUser={currentUser} showToast={showToast} addActivity={addActivity} />}
          {detailTab === "copilot" && (
            <Suspense fallback={<div style={{ color: "#5A6178", fontSize: 12, padding: 20 }}>Loading AI Co-Pilot…</div>}>
              <LazyChatAssistTab
                currentUser={currentUser}
                showToast={showToast}
                ticketId={inc.id}
                compact={true}
              />
            </Suspense>
          )}

          {/* ─── Major Incident Management Tab ─── */}
          {detailTab === "majorIncident" && (
            <div>
              {/* Declaration Banner */}
              <div style={{ padding: 16, borderRadius: 8, marginBottom: 16, background: inc.isMajorIncident ? "#FF444412" : "#0A0C14", border: `1px solid ${inc.isMajorIncident ? "#FF444444" : "#1E213044"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{inc.isMajorIncident ? "🔴" : "⚪"}</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: inc.isMajorIncident ? "#FF6B6B" : "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>
                        {inc.isMajorIncident ? "MAJOR INCIDENT DECLARED" : "Not a Major Incident"}
                      </div>
                      <div style={{ fontSize: 10, color: "#5A6178" }}>{inc.isMajorIncident ? `Declared: ${new Date(inc.majorDeclaredAt).toLocaleString()}` : "Declare this incident as Major to activate MIM process"}</div>
                    </div>
                  </div>
                  <button onClick={() => {
                    const updated = { ...inc, isMajorIncident: !inc.isMajorIncident };
                    if (!inc.isMajorIncident) {
                      updated.majorDeclaredAt = new Date().toISOString();
                      updated.majorBridge = updated.majorBridge || { active: true, link: `https://teams.microsoft.com/l/meetup-join/vgc-mim-${inc.id}`, participants: [] };
                      updated.majorComms = updated.majorComms || [];
                      updated.majorTimeline = updated.majorTimeline || [{ time: new Date().toISOString(), event: "Major Incident Declared", user: currentUser.name }];
                    } else {
                      updated.majorResolvedAt = new Date().toISOString();
                      updated.majorTimeline = [...(updated.majorTimeline || []), { time: new Date().toISOString(), event: "Major Incident Revoked", user: currentUser.name }];
                    }
                    setIncidents(prev => prev.map(i => i.id === inc.id ? updated : i));
                    setDetailItem(updated);
                  }} style={btnStyle(inc.isMajorIncident ? "#FF4444" : "#FF6B6B")}>
                    {inc.isMajorIncident ? "🔕 Revoke MIM" : "🚨 Declare Major"}
                  </button>
                </div>
              </div>

              {inc.isMajorIncident && (
                <>
                  {/* War Room / Bridge */}
                  <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 14, marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>🏠 War Room / Bridge</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4CAF50", animation: "pulse 2s infinite" }} />
                        <span style={{ fontSize: 10, color: "#4CAF50", fontWeight: 600 }}>Active</span>
                      </div>
                    </div>
                    <div style={{ padding: 10, background: "#0A0C14", borderRadius: 6, border: "1px solid #6366F122", marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>Teams Bridge Link</div>
                      <div style={{ fontSize: 11, color: "#6366F1", fontFamily: "'JetBrains Mono', monospace", wordBreak: "break-all" }}>{(inc.majorBridge || {}).link || "—"}</div>
                    </div>
                    <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 6 }}>Participants</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                      {((inc.majorBridge || {}).participants || []).map((p, i) => (
                        <span key={i} style={{ padding: "2px 8px", borderRadius: 4, background: "#6366F112", color: "#6366F1", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>{p}</span>
                      ))}
                      {((inc.majorBridge || {}).participants || []).length === 0 && <span style={{ fontSize: 10, color: "#5A6178" }}>No participants added</span>}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input id="mim-participant" placeholder="Add participant name..." style={{ ...inputStyle, fontSize: 11, flex: 1 }} />
                      <button onClick={() => {
                        const inp = document.getElementById("mim-participant");
                        const name = inp?.value?.trim();
                        if (!name) return;
                        const updated = { ...inc, majorBridge: { ...(inc.majorBridge || {}), participants: [...((inc.majorBridge || {}).participants || []), name] } };
                        updated.majorTimeline = [...(updated.majorTimeline || []), { time: new Date().toISOString(), event: `${name} joined bridge`, user: currentUser.name }];
                        setIncidents(prev => prev.map(i => i.id === inc.id ? updated : i));
                        setDetailItem(updated);
                        inp.value = "";
                      }} style={btnStyle("#6366F1")}>Add</button>
                    </div>
                  </div>

                  {/* Stakeholder Communications */}
                  <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 14, marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", marginBottom: 10 }}>📢 Stakeholder Communications</div>
                    {(inc.majorComms || []).slice().reverse().map((comm, i) => (
                      <div key={i} style={{ padding: 10, background: "#0A0C14", borderRadius: 6, border: "1px solid #1E213044", marginBottom: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 10, color: "#6366F1", fontWeight: 600 }}>{comm.type}</span>
                          <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{new Date(comm.sentAt).toLocaleString()}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#C4CAD6" }}>{comm.message}</div>
                        <div style={{ fontSize: 9, color: "#5A6178", marginTop: 4 }}>By: {comm.sentBy}</div>
                      </div>
                    ))}
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                        <select id="mim-comm-type" style={{ ...inputStyle, fontSize: 11, width: 150 }}>
                          <option>Status Update</option><option>Executive Briefing</option><option>Customer Notice</option><option>Resolution Update</option><option>Post-Incident Summary</option>
                        </select>
                      </div>
                      <textarea id="mim-comm-msg" placeholder="Enter stakeholder communication..." rows={2} style={{ ...inputStyle, fontSize: 11, width: "100%", resize: "vertical", marginBottom: 6 }} />
                      <button onClick={() => {
                        const typeEl = document.getElementById("mim-comm-type");
                        const msgEl = document.getElementById("mim-comm-msg");
                        const msg = msgEl?.value?.trim();
                        if (!msg) return;
                        const comm = { type: typeEl?.value || "Status Update", message: msg, sentBy: currentUser.name, sentAt: new Date().toISOString() };
                        const updated = { ...inc, majorComms: [...(inc.majorComms || []), comm] };
                        updated.majorTimeline = [...(updated.majorTimeline || []), { time: new Date().toISOString(), event: `Comms sent: ${comm.type}`, user: currentUser.name }];
                        setIncidents(prev => prev.map(i => i.id === inc.id ? updated : i));
                        setDetailItem(updated);
                        msgEl.value = "";
                      }} style={btnStyle("#06B6D4")}>📤 Send Communication</button>
                    </div>
                  </div>

                  {/* MIM Timeline */}
                  <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 14, marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", marginBottom: 10 }}>📅 MIM Timeline</div>
                    {(inc.majorTimeline || []).slice().reverse().map((evt, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, marginBottom: 6, padding: "6px 10px", background: "#0A0C14", borderRadius: 6, border: "1px solid #1E213033" }}>
                        <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", minWidth: 130 }}>{new Date(evt.time).toLocaleString()}</span>
                        <span style={{ fontSize: 11, color: "#C4CAD6", flex: 1 }}>{evt.event}</span>
                        <span style={{ fontSize: 9, color: "#6366F1" }}>{evt.user}</span>
                      </div>
                    ))}
                  </div>

                  {/* Post-Incident Review */}
                  <div style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", marginBottom: 10 }}>📝 Post-Incident Review (PIR)</div>
                    <div style={{ display: "grid", gap: 10 }}>
                      <div>
                        <label style={{ fontSize: 10, color: "#5A6178", display: "block", marginBottom: 3 }}>Root Cause</label>
                        <textarea value={(inc.pir || {}).rootCause || ""} onChange={e => {
                          const updated = { ...inc, pir: { ...(inc.pir || {}), rootCause: e.target.value } };
                          setIncidents(prev => prev.map(i => i.id === inc.id ? updated : i));
                          setDetailItem(updated);
                        }} rows={2} style={{ ...inputStyle, fontSize: 11, width: "100%", resize: "vertical" }} placeholder="What caused this incident?" />
                      </div>
                      <div>
                        <label style={{ fontSize: 10, color: "#5A6178", display: "block", marginBottom: 3 }}>Impact Summary</label>
                        <textarea value={(inc.pir || {}).impact || ""} onChange={e => {
                          const updated = { ...inc, pir: { ...(inc.pir || {}), impact: e.target.value } };
                          setIncidents(prev => prev.map(i => i.id === inc.id ? updated : i));
                          setDetailItem(updated);
                        }} rows={2} style={{ ...inputStyle, fontSize: 11, width: "100%", resize: "vertical" }} placeholder="Business and service impact..." />
                      </div>
                      <div>
                        <label style={{ fontSize: 10, color: "#5A6178", display: "block", marginBottom: 3 }}>Corrective Actions</label>
                        <textarea value={(inc.pir || {}).actions || ""} onChange={e => {
                          const updated = { ...inc, pir: { ...(inc.pir || {}), actions: e.target.value } };
                          setIncidents(prev => prev.map(i => i.id === inc.id ? updated : i));
                          setDetailItem(updated);
                        }} rows={2} style={{ ...inputStyle, fontSize: 11, width: "100%", resize: "vertical" }} placeholder="What corrective actions will prevent recurrence?" />
                      </div>
                      <div>
                        <label style={{ fontSize: 10, color: "#5A6178", display: "block", marginBottom: 3 }}>Lessons Learned</label>
                        <textarea value={(inc.pir || {}).lessons || ""} onChange={e => {
                          const updated = { ...inc, pir: { ...(inc.pir || {}), lessons: e.target.value } };
                          setIncidents(prev => prev.map(i => i.id === inc.id ? updated : i));
                          setDetailItem(updated);
                        }} rows={2} style={{ ...inputStyle, fontSize: 11, width: "100%", resize: "vertical" }} placeholder="Key takeaways for the team..." />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ─── Workflow Process Tab ─── */}
          {detailTab === "workflow" && (
            <>
              <style>{`
                @keyframes wfSlideIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes wfPulseNode { 0%, 100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.4); } 50% { box-shadow: 0 0 0 10px rgba(99,102,241,0); } }
                @keyframes wfFlowLine { from { stroke-dashoffset: 20; } to { stroke-dashoffset: 0; } }
                @keyframes wfGlow { 0%, 100% { filter: drop-shadow(0 0 4px rgba(99,102,241,0.3)); } 50% { filter: drop-shadow(0 0 12px rgba(99,102,241,0.6)); } }
                @keyframes wfCheckPop { 0% { transform: scale(0); } 60% { transform: scale(1.3); } 100% { transform: scale(1); } }
              `}</style>
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: "#6366F1", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6 }}>⚡ INCIDENT LIFECYCLE WORKFLOW</div>
                <div style={{ fontSize: 12, color: "#5A617899", marginBottom: 16 }}>Visual process flow showing each stage of incident resolution. Active step is highlighted.</div>
              </div>
              {/* Workflow Flow Cards */}
              {(() => {
                const steps = [
                  { id: "new", label: "New", icon: "📩", desc: "Ticket created via portal, email, phone, or API. Auto-assigned default severity (Sev-C).", color: "#CE93D8" },
                  { id: "triage", label: "AI Triage", icon: "🤖", desc: "AI engine classifies category, suggests priority, identifies affected service, and routes to assignment group.", color: "#EC4899" },
                  { id: "open", label: "Open", icon: "📂", desc: "Engineer acknowledges ticket. SLA countdown begins based on severity level. First-response timer active.", color: "#A0AEC0" },
                  { id: "inprogress", label: "In Progress", icon: "🔧", desc: "Active investigation and remediation. Engineer updates ticket with findings, communicates with reporter.", color: "#64B5F6" },
                  { id: "pending", label: "Pending", icon: "⏳", desc: "Awaiting external input — customer response, vendor patch, or third-party action. SLA clock paused.", color: "#FFB347" },
                  { id: "resolved", label: "Resolved", icon: "✅", desc: "Root cause addressed, service restored. Resolution notes documented. Customer satisfaction survey triggered.", color: "#81C784" },
                  { id: "closed", label: "Closed", icon: "🔒", desc: "Confirmed by reporter or auto-closed after 5 business days. Linked to Problem record if recurring.", color: "#666" },
                ];
                const statusMap = { "New": "new", "Open": "open", "In Progress": "inprogress", "Pending": "pending", "On Hold": "pending", "Resolved": "resolved", "Closed": "closed", "Reopened": "open" };
                const currentStep = statusMap[inc.status] || "new";
                const currentIdx = steps.findIndex(s => s.id === currentStep);
                return (
                  <div style={{ position: "relative" }}>
                    {/* Horizontal connector line */}
                    <div style={{ position: "absolute", top: 32, left: 40, right: 40, height: 3, background: "#1E2130", borderRadius: 2, zIndex: 0 }}>
                      <div style={{ height: "100%", background: "linear-gradient(90deg, #6366F1, #06B6D4)", borderRadius: 2, width: `${Math.max(0, (currentIdx / (steps.length - 1)) * 100)}%`, transition: "width 1s ease", boxShadow: "0 0 8px #6366F144" }} />
                    </div>
                    {/* Step nodes */}
                    <div style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, 1fr)`, gap: 6, position: "relative", zIndex: 1 }}>
                      {steps.map((step, i) => {
                        const isPast = i < currentIdx;
                        const isActive = i === currentIdx;
                        const isFuture = i > currentIdx;
                        return (
                          <div key={step.id} style={{ textAlign: "center", animation: `wfSlideIn 0.5s ease ${i * 0.08}s both` }}>
                            {/* Node circle */}
                            <div style={{
                              width: 48, height: 48, borderRadius: "50%", margin: "0 auto 10px",
                              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
                              background: isActive ? `linear-gradient(135deg, ${step.color}33, ${step.color}11)` : isPast ? "#0D2D1A" : "#0A0C14",
                              border: `2px solid ${isActive ? step.color : isPast ? "#4CAF50" : "#1E2130"}`,
                              animation: isActive ? "wfPulseNode 2s infinite" : "none",
                              transition: "background 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease", position: "relative",
                              boxShadow: isActive ? `0 0 20px ${step.color}33` : "none",
                            }}>
                              {isPast ? <span style={{ animation: "wfCheckPop 0.4s ease", color: "#4CAF50", fontSize: 18, fontWeight: 700 }}>✓</span> : <span style={{ opacity: isFuture ? 0.35 : 1 }}>{step.icon}</span>}
                            </div>
                            {/* Label */}
                            <div style={{ fontSize: 10, fontWeight: 700, color: isActive ? step.color : isPast ? "#81C784" : "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, transition: "color 0.3s" }}>{step.label}</div>
                            {/* Description card */}
                            <div style={{
                              background: isActive ? `linear-gradient(135deg, ${step.color}08, #12141E)` : "#0A0C14",
                              border: `1px solid ${isActive ? step.color + "44" : "#1E213044"}`, borderRadius: 8, padding: "8px 6px",
                              fontSize: 10, color: isActive ? "#C4CAD6" : "#5A617888", lineHeight: 1.4,
                              transition: "all 0.4s ease", minHeight: 50,
                              boxShadow: isActive ? `0 4px 16px ${step.color}11` : "none",
                            }}>
                              {step.desc}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* SLA Workflow */}
              <div style={{ marginTop: 28, background: "#0A0C14", borderRadius: 10, border: "1px solid #1E213044", padding: 18, animation: "wfSlideIn 0.6s ease 0.6s both" }}>
                <div style={{ fontSize: 11, color: "#FFB347", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>⏱ SLA ESCALATION PATH</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                  {[
                    { sev: "Sev-A", label: "CRITICAL", first: "30 min", worst: "4 hrs", esc: "Immediate → IT Manager", color: "#FF6B6B", active: inc.priority === "Sev-A" },
                    { sev: "Sev-B", label: "HIGH", first: "1 hr", worst: "4 hrs", esc: "2 hrs → Team Lead", color: "#FFB347", active: inc.priority === "Sev-B" },
                    { sev: "Sev-C", label: "MEDIUM", first: "4 hrs", worst: "9 hrs", esc: "6 hrs → Team Lead", color: "#64B5F6", active: inc.priority === "Sev-C" },
                    { sev: "Sev-D", label: "LOW", first: "9 hrs", worst: "27 hrs", esc: "Next business day", color: "#81C784", active: inc.priority === "Sev-D" },
                  ].map((s, i) => (
                    <div key={s.sev} style={{
                      padding: 12, borderRadius: 8, textAlign: "center",
                      background: s.active ? `linear-gradient(135deg, ${s.color}15, ${s.color}08)` : "#12141E",
                      border: `1px solid ${s.active ? s.color + "66" : "#1E213022"}`,
                      animation: s.active ? "wfGlow 2.5s ease-in-out infinite" : `wfSlideIn 0.4s ease ${0.7 + i * 0.1}s both`,
                      transform: s.active ? "scale(1.04)" : "scale(1)", transition: "transform 0.3s",
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: s.color, fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>{s.sev}</div>
                      <div style={{ fontSize: 9, color: "#5A6178", marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontSize: 10, color: "#C4CAD6" }}>First: <strong style={{ color: s.color }}>{s.first}</strong></div>
                      <div style={{ fontSize: 10, color: "#C4CAD6" }}>Max: <strong style={{ color: s.color }}>{s.worst}</strong></div>
                      <div style={{ fontSize: 9, color: "#5A617899", marginTop: 4 }}>{s.esc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Feature Process Cards */}
              <div style={{ marginTop: 24, animation: "wfSlideIn 0.6s ease 0.8s both" }}>
                <div style={{ fontSize: 11, color: "#06B6D4", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>🔗 CONNECTED PROCESSES</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  {[
                    { icon: "🔍", title: "Problem Management", desc: "Recurring incidents trigger root cause analysis. Known Errors link back to prevent future occurrences.", color: "#CE93D8", flow: "Incident → Problem → Known Error → Fix" },
                    { icon: "🔄", title: "Change Management", desc: "Fixes requiring infrastructure changes create RFC with risk assessment, approvals, and rollback plan.", color: "#FFB347", flow: "Problem → RFC → Approve → Implement → Review" },
                    { icon: "📊", title: "SLA & Reporting", desc: "Real-time SLA tracking with auto-escalation and controlled report generation.", color: "#64B5F6", flow: "Track → Alert → Escalate → Report" },
                    { icon: "🤖", title: "AI Auto-Triage", desc: "NLP classification assigns category, priority, and routing. Confidence score determines manual review threshold.", color: "#EC4899", flow: "Ingest → Classify → Score → Route" },
                    { icon: "📧", title: "Communications", desc: "Bi-directional email with templates. Internal notes for agent collaboration. Full audit trail.", color: "#3B82F6", flow: "Receive → Template → Send → Log" },
                    { icon: "📋", title: "Customer Survey", desc: "Auto-generated satisfaction survey on resolution. Templates adapt based on severity and interaction count.", color: "#81C784", flow: "Resolve → Generate → Send → Analyse" },
                  ].map((card, i) => (
                    <div key={i} style={{
                      background: `linear-gradient(135deg, ${card.color}06, #0A0C14)`, borderRadius: 8,
                      border: `1px solid ${card.color}22`, padding: "12px 14px",
                      animation: `wfSlideIn 0.4s ease ${0.9 + i * 0.08}s both`,
                      transition: "border-color 0.3s, transform 0.2s", cursor: "default",
                    }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = card.color + "66"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = card.color + "22"; e.currentTarget.style.transform = "translateY(0)"; }}
                    >
                      <div style={{ fontSize: 16, marginBottom: 6 }}>{card.icon}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: card.color, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>{card.title}</div>
                      <div style={{ fontSize: 10, color: "#A0AEC0", lineHeight: 1.4, marginBottom: 8 }}>{card.desc}</div>
                      <div style={{ fontSize: 9, color: card.color + "99", fontFamily: "'JetBrains Mono', monospace", background: card.color + "08", padding: "3px 6px", borderRadius: 4, display: "inline-block" }}>{card.flow}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Runbook Execution (4B) */}
          {detailTab === "runbook" && (
            <div>
              <div style={{ fontSize: 11, color: "#6366F1", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 12 }}>📖 RUNBOOK EXECUTION</div>
              <p style={{ fontSize: 11, color: "#5A6178", marginBottom: 16 }}>Execute predefined runbooks for this incident. Steps are tracked and audited.</p>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <select id="runbookSelect" style={{ ...inputStyle, fontSize: 12, flex: 1 }}>
                  <option value="RB-NETWORK">Network Troubleshooting</option>
                  <option value="RB-EMAIL">Email Service Recovery</option>
                  <option value="RB-SECURITY">Security Incident Response</option>
                  <option value="RB-AZURE">Azure VM Recovery</option>
                  <option value="RB-AD">AD Account Recovery</option>
                </select>
                <button style={btnStyle("#10B981")} onClick={() => {
                  const rbId = document.getElementById("runbookSelect")?.value || "RB-NETWORK";
                  const stepsMap = {
                    "RB-NETWORK": ["Check connectivity", "Verify DNS resolution", "Check firewall rules", "Restart network service", "Validate resolution"],
                    "RB-EMAIL": ["Check Exchange service status", "Verify mail flow", "Check mailbox quota", "Clear message queue", "Confirm delivery"],
                    "RB-SECURITY": ["Isolate affected system", "Collect forensic data", "Identify attack vector", "Apply containment measures", "Document findings"],
                    "RB-AZURE": ["Check VM status in portal", "Review boot diagnostics", "Restart VM", "Verify application health", "Update monitoring"],
                    "RB-AD": ["Verify account status", "Reset password", "Check group membership", "Clear lockout", "Confirm access"],
                  };
                  fetch("/api/runbook/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runbookId: rbId, incidentId: inc.id, executor: currentUser.name, steps: (stepsMap[rbId] || []).map((s, i) => ({ step: i + 1, name: s, status: "pending" })) }) })
                    .then(r => r.json()).then(d => { if (d.ok) { showToast(`Runbook ${rbId} started`, "success"); addActivity("runbook", `Started runbook ${rbId}`); } })
                    .catch(() => showToast("Failed to start runbook", "error"));
                }}>▶ Execute</button>
              </div>
              <div style={{ background: "#0A0C14", borderRadius: 8, border: "1px solid #1E213044", padding: 16 }}>
                <div style={{ fontSize: 11, color: "#5A6178", marginBottom: 8 }}>Recent Executions for {inc.id}:</div>
                <button style={{ ...btnStyle("#1E2130"), fontSize: 10, marginBottom: 8 }} onClick={() => {
                  fetch(`/api/runbook/executions?incidentId=${inc.id}`).then(r => r.json()).then(d => {
                    if (d.ok && d.data.length > 0) {
                      const latest = d.data[0];
                      showToast(`Runbook ${latest.runbookId}: ${latest.status} (${latest.steps.filter(s => s.status === "completed").length}/${latest.steps.length} steps)`, "info");
                    } else { showToast("No runbook executions found", "info"); }
                  }).catch(() => showToast("Failed to load executions", "error"));
                }}>🔄 Refresh Executions</button>
                <div style={{ fontSize: 10, color: "#5A617888" }}>Click "Execute" to start a new runbook, or "Refresh" to view existing executions.</div>
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: "12px 20px", borderTop: "1px solid #1E2130", background: "#0F1117", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginRight: 8 }}>ACTIONS:</span>
          {/* New → Open */}
          {inc.status === "New" && <button style={btnStyle("#A0AEC0")} onClick={() => changeStatus("Open")}>Open Ticket</button>}
          {/* Open → In Progress */}
          {inc.status === "Open" && <button style={btnStyle("#3B82F6")} onClick={() => changeStatus("In Progress")}>▶ Start Working</button>}
          {/* In Progress → Pending / On Hold */}
          {inc.status === "In Progress" && <button style={btnStyle("#FFB347")} onClick={() => changeStatus("Pending")}>⏸ Pending</button>}
          {inc.status === "In Progress" && <button style={btnStyle("#FF6B6B")} onClick={() => changeStatus("On Hold")}>⏹ On Hold</button>}
          {/* Pending/On Hold → In Progress */}
          {(inc.status === "Pending" || inc.status === "On Hold") && <button style={btnStyle("#3B82F6")} onClick={() => changeStatus("In Progress")}>▶ Resume</button>}
          {/* Open/In Progress/Pending → Resolved */}
          {["Open", "In Progress", "Pending"].includes(inc.status) && <button style={btnStyle("#4CAF50")} onClick={() => changeStatus("Resolved")}>✓ Resolve</button>}
          {/* AI Resolution Summary — available on Resolved/Closed */}
          {["Resolved", "Closed"].includes(inc.status) && azureOpenAI?.enabled && <button style={{ ...btnStyle("#06B6D4"), fontSize: 11 }} onClick={async () => {
            showToast("⏳ Generating AI resolution summary...", "info");
            try {
              const resp = await fetch("/api/ai/generate-resolution-summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticketId: inc.id, requestedBy: currentUser?.name || "Engineer" }) });
              const data = await resp.json();
              if (data.summary) {
                const summary = data.summary;
                const summaryText = [
                  `🔍 Root Cause: ${summary.rootCause || "N/A"}`,
                  ``,
                  `📋 Steps Taken:`,
                  ...(summary.stepsTaken || []).map((s, i) => `  ${i + 1}. ${s}`),
                  ``,
                  `✅ Outcome: ${summary.outcome || "N/A"}`,
                  ``,
                  `🛡️ Preventive Actions:`,
                  ...(summary.preventiveActions || []).map((a, i) => `  ${i + 1}. ${a}`),
                  ``,
                  `📧 Customer Message:`,
                  summary.customerMessage || "N/A",
                  ``,
                  `📝 Internal Notes: ${summary.internalNotes || "N/A"}`,
                ].join("\n");
                // Store in resolution notes
                const updated = { ...inc, resolutionSummary: summary, resolutionNotes: (inc.resolutionNotes ? inc.resolutionNotes + "\n\n--- AI Summary ---\n" : "") + summaryText };
                setIncidents(prev => prev.map(i => i.id === inc.id ? updated : i));
                setDetailItem(updated);
                addActivity("ai_summary", `AI resolution summary generated`);
                showToast("✅ Resolution summary generated and saved", "success");
              } else {
                showToast(`❌ ${data.error || "Failed to generate summary"}`, "error");
              }
            } catch (err) { showToast(`❌ ${err.message}`, "error"); }
          }}>🤖 AI Summary</button>}
          {/* Resolved → Closed */}
          {inc.status === "Resolved" && <button style={btnStyle("#1A1A2E")} onClick={() => changeStatus("Closed")}>🔒 Close</button>}
          {/* Resolved/Closed → Reopened */}
          {(inc.status === "Resolved" || inc.status === "Closed") && <button style={btnStyle("#EC4899")} onClick={() => changeStatus("Reopened")}>↩ Reopen</button>}
          {/* Reopened → In Progress */}
          {inc.status === "Reopened" && <button style={btnStyle("#3B82F6")} onClick={() => changeStatus("In Progress")}>▶ Start Working</button>}
          {/* Create Problem (always available if not closed and no linked problem) */}
          {!inc.linkedProblem && !["Closed"].includes(inc.status) && <button style={btnStyle("#8B5CF6")} onClick={() => {
            const newPrb = { id: genId("PRB"), title: `Problem from ${inc.id}: ${inc.title}`, status: "Under Investigation", priority: inc.priority, category: inc.category, impact: inc.impact || "Individual", rootCause: "Pending analysis", linkedIncidents: [inc.id], assignee: inc.assignee, assignmentGroup: inc.assignmentGroup || "Service Desk", created: 0, affectedServices: inc.affectedService ? [inc.affectedService] : [], workaround: inc.workaround || "", knownErrorId: "" };
            setProblems(prev => [newPrb, ...prev]);
            const updated = { ...inc, linkedProblem: newPrb.id };
            setIncidents(prev => prev.map(i => i.id === inc.id ? { ...i, linkedProblem: newPrb.id } : i));
            setDetailItem(updated);
            addActivity("status", `Linked Problem ${newPrb.id} created`);
          }}>Create Problem</button>}
          {/* ═══ One-Click Escalation ═══ */}
          {!["Resolved", "Closed"].includes(inc.status) && inc.priority !== "Sev-A" && (
            <button style={{ ...btnStyle("#FF4444"), fontSize: 11, display: "flex", alignItems: "center", gap: 4, animation: "slaBlink 1.2s ease-in-out infinite" }} onClick={() => {
              const prevPriority = inc.priority;
              const escalatedPriority = prevPriority === "Sev-B" ? "Sev-A" : prevPriority === "Sev-C" ? "Sev-B" : "Sev-B";
              const escalatedSla = { "Sev-A": 4, "Sev-B": 8 }[escalatedPriority] || 8;
              const updated = {
                ...inc, priority: escalatedPriority, urgency: escalatedPriority === "Sev-A" ? "Critical" : "High",
                slaTarget: Math.min(inc.slaTarget, escalatedSla), escalated: true, escalatedAt: new Date().toISOString(),
                escalatedBy: currentUser.name, escalationReason: `One-click escalation by ${currentUser.name}`,
                status: inc.status === "New" ? "Open" : inc.status,
                activityLog: [...(inc.activityLog || []), {
                  id: genId("AL"), type: "escalation", user: currentUser.name,
                  time: new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }).replace(",", ""),
                  detail: `🚨 Escalated: ${prevPriority} → ${escalatedPriority} (SLA tightened to ${escalatedSla}h)`
                }]
              };
              setIncidents(prev => prev.map(i => i.id === inc.id ? updated : i));
              setDetailItem(updated);
              showToast(`🚨 ${inc.id} escalated to ${escalatedPriority}`, "warning");
            }}>🚨 Escalate</button>
          )}
          {/* Escalate */}
          {!["Closed", "Resolved"].includes(inc.status) && <button style={{ ...btnStyle("#333"), color: "#FFB347" }} onClick={() => {
            const newPri = inc.priority === "Sev-B" ? "Sev-A" : inc.priority === "Sev-C" ? "Sev-B" : inc.priority === "Sev-D" ? "Sev-C" : inc.priority;
            if (newPri !== inc.priority) {
              const updated = { ...inc, priority: newPri };
              setIncidents(prev => prev.map(i => i.id === inc.id ? { ...i, priority: newPri } : i));
              setDetailItem(updated);
              addActivity("status", `Escalated: Priority changed ${inc.priority} → ${newPri}`);
              // Sync escalation to Zendesk
              if (inc.zdTicketId) {
                fetch("/api/zendesk/sync-incident", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ zdTicketId: inc.zdTicketId, action: "escalation", priority: newPri, comment: `[ITSM ${inc.id}] Escalated: ${inc.priority} → ${newPri} by ${currentUser.name}` })
                }).catch(() => {});
              }
            }
          }}>⬆ Escalate</button>}
          {/* Zendesk Sync Actions */}
          {inc.zdTicketId && (
            <>
              <span style={{ width: 1, height: 24, background: "#2A2E3E", margin: "0 4px" }} />
              <button style={{ ...btnStyle("#EC4899"), fontSize: 10, display: "flex", alignItems: "center", gap: 4 }} onClick={() => {
                fetch(`/api/zendesk/ticket-updates/${inc.zdTicketId}`).then(r => r.json()).then(zd => {
                  if (zd.zdTicketId) {
                    const changes = [];
                    if (zd.status && zd.status !== inc.status) changes.push(`Status: ${inc.status} → ${zd.status}`);
                    if (zd.priority && zd.priority !== inc.priority) changes.push(`Priority: ${inc.priority} → ${zd.priority}`);
                    const upd = { ...inc };
                    if (zd.status && zd.status !== inc.status) upd.status = zd.status;
                    if (zd.priority && zd.priority !== inc.priority) upd.priority = zd.priority;
                    if (zd.subject && zd.subject !== inc.title) { upd.title = zd.subject; changes.push(`Title updated`); }
                    upd.zdLastSync = new Date().toISOString();
                    if (changes.length > 0) {
                      upd.activityLog = [...(upd.activityLog || []), { id: genId("AL"), type: "sync", user: "Zendesk", time: new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }).replace(",", ""), detail: `Synced from Zendesk #${inc.zdTicketId}: ${changes.join(", ")}` }];
                    } else {
                      upd.activityLog = [...(upd.activityLog || []), { id: genId("AL"), type: "sync", user: "Zendesk", time: new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }).replace(",", ""), detail: `Zendesk #${inc.zdTicketId} is in sync — no changes` }];
                    }
                    setIncidents(prev => prev.map(i => i.id === inc.id ? upd : i));
                    setDetailItem(upd);
                  }
                }).catch(() => {});
              }}>🔄 Pull from Zendesk</button>
              <button style={{ ...btnStyle("#8B5CF6"), fontSize: 10, display: "flex", alignItems: "center", gap: 4 }} onClick={() => {
                fetch("/api/zendesk/sync-incident", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ zdTicketId: inc.zdTicketId, action: "full_sync", status: inc.status, priority: inc.priority, comment: `[ITSM ${inc.id}] Full sync push — Status: ${inc.status}, Priority: ${inc.priority}` })
                }).then(r => r.json()).then(result => {
                  if (result.success) addActivity("sync", `Pushed to Zendesk #${inc.zdTicketId}: Status=${inc.status}, Priority=${inc.priority}`);
                }).catch(() => {});
              }}>⬆ Push to Zendesk</button>
            </>
          )}
          {!inc.zdTicketId && (
            <button style={{ ...btnStyle("#EC4899"), fontSize: 10, display: "flex", alignItems: "center", gap: 4 }} onClick={() => {
              fetch("/api/zendesk/tickets", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ticket: { subject: `[${inc.id}] ${inc.title}`, description: inc.description || inc.title, priority: ({ "Sev-A": "urgent", "Sev-B": "high", "Sev-C": "normal", "Sev-D": "low" })[inc.priority] || "normal", tags: ["itsm-synced", inc.category?.toLowerCase().replace(/\s+/g, "-")] } })
              }).then(r => r.json()).then(result => {
                const newTicketId = result?.ticket?.id;
                if (newTicketId) {
                  const upd = { ...inc, zdTicketId: newTicketId, activityLog: [...(inc.activityLog || []), { id: genId("AL"), type: "sync", user: currentUser.name, time: new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }).replace(",", ""), detail: `Created Zendesk ticket #${newTicketId} and linked` }] };
                  setIncidents(prev => prev.map(i => i.id === inc.id ? upd : i));
                  setDetailItem(upd);
                }
              }).catch(() => {});
            }}>🎫 Create Zendesk Ticket</button>
          )}
        </div>
      </div>
    </div>
  );
};

const ChangeDetailModal = () => {
  const ch = detailItem;
  if (!ch) return null;
  return (
    <Modal title={`${ch.id} — ${ch.title}`} onClose={() => { setModal(null); setDetailItem(null); }} wide>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>TYPE</span><Badge color={ch.type === "Emergency" ? PRIORITY_COLORS["Sev-A"] : { bg: "#0D2137", text: "#64B5F6" }}>{ch.type}</Badge></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>STATUS</span><Badge color={STATUS_COLORS[ch.status]}>{ch.status}</Badge></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>RISK</span><Badge color={PRIORITY_COLORS[ch.risk === "High" ? "Sev-A" : ch.risk === "Medium" ? "Sev-B" : "Sev-D"]}>{ch.risk}</Badge></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>IMPACT</span><Badge color={ch.impact === "Enterprise" ? PRIORITY_COLORS["Sev-A"] : ch.impact === "Department" ? PRIORITY_COLORS["Sev-B"] : PRIORITY_COLORS["Sev-D"]}>{ch.impact || "—"}</Badge></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>CATEGORY</span><span style={{ color: "#A0AEC0", fontSize: 13 }}>{ch.category || "—"}</span></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>ASSIGNEE</span><span style={{ color: "#C4CAD6", fontSize: 13 }}>{ch.assignee}</span>{ch.assignmentGroup && <span style={{ color: "#5A6178", fontSize: 10, marginLeft: 4 }}>({ch.assignmentGroup})</span>}</div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>SCHEDULED START</span><span style={{ color: "#C4CAD6", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{ch.scheduledStart}</span></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>SCHEDULED END</span><span style={{ color: "#C4CAD6", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{ch.scheduledEnd}</span></div>
        {ch.affectedServices?.length > 0 && <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>AFFECTED SERVICES</span><span style={{ color: "#CE93D8", fontSize: 12 }}>{Array.isArray(ch.affectedServices) ? ch.affectedServices.join(", ") : ch.affectedServices}</span></div>}
      </div>
      <div style={{ background: "#0A0C14", borderRadius: 6, padding: 14, marginBottom: 16, border: "1px solid #1E213044" }}>
        <span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>DESCRIPTION</span>
        <p style={{ color: "#C4CAD6", fontSize: 13, margin: 0, lineHeight: 1.6 }}>{ch.description}</p>
      </div>
      {ch.backoutPlan && (
        <div style={{ background: "#2D0A0A", borderRadius: 6, padding: 12, marginBottom: 16, border: "1px solid #FF6B6B22" }}>
          <span style={{ fontSize: 11, color: "#FF6B6B", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>BACKOUT / ROLLBACK PLAN</span>
          <p style={{ color: "#C4CAD6", fontSize: 12, margin: 0 }}>{ch.backoutPlan}</p>
        </div>
      )}
      {ch.testPlan && (
        <div style={{ background: "#0A1E2D", borderRadius: 6, padding: 12, marginBottom: 16, border: "1px solid #06B6D422" }}>
          <span style={{ fontSize: 11, color: "#06B6D4", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>TEST PLAN</span>
          <p style={{ color: "#C4CAD6", fontSize: 12, margin: 0 }}>{ch.testPlan}</p>
        </div>
      )}
      {ch.implementationNotes && (
        <div style={{ background: "#0D2D1A", borderRadius: 6, padding: 12, marginBottom: 16, border: "1px solid #81C78422" }}>
          <span style={{ fontSize: 11, color: "#81C784", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>IMPLEMENTATION NOTES</span>
          <p style={{ color: "#C4CAD6", fontSize: 12, margin: 0 }}>{ch.implementationNotes}</p>
        </div>
      )}
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>APPROVERS</span>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(ch.approvers || []).map((a, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 14px", borderRadius: 6, background: "#0A0C14",
              border: "1px solid #1E213044"
            }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: a.status === "Approved" ? "#4CAF50" : a.status === "Rejected" ? "#FF4444" : "#FFB347" }} />
              <span style={{ color: "#C4CAD6", fontSize: 13 }}>{a.name}</span>
              <span style={{ color: "#5A6178", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>({a.status})</span>
            </div>
          ))}
        </div>
      </div>
      {ch.status === "Awaiting Approval" && (
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btnStyle("#4CAF50")} onClick={() => {
            setChanges(prev => prev.map(c => c.id === ch.id ? { ...c, status: "Approved", approvers: (c.approvers || []).map(a => ({ ...a, status: "Approved" })) } : c));
            setDetailItem({ ...ch, status: "Approved", approvers: (ch.approvers || []).map(a => ({ ...a, status: "Approved" })) });
          }}>✓ Approve</button>
          <button style={btnStyle("#FF4444")} onClick={() => {
            setChanges(prev => prev.map(c => c.id === ch.id ? { ...c, status: "Closed", approvers: (c.approvers || []).map(a => ({ ...a, status: "Rejected" })) } : c));
            setModal(null); setDetailItem(null);
          }}>✕ Reject</button>
        </div>
      )}
      {ch.status === "Approved" && (
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btnStyle("#3B82F6")} onClick={() => {
            setChanges(prev => prev.map(c => c.id === ch.id ? { ...c, status: "Implementing" } : c));
            setDetailItem({ ...ch, status: "Implementing" });
          }}>Begin Implementation</button>
        </div>
      )}
      {ch.status === "Implementing" && (
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btnStyle("#4CAF50")} onClick={() => {
            setChanges(prev => prev.map(c => c.id === ch.id ? { ...c, status: "Closed" } : c));
            setModal(null); setDetailItem(null);
          }}>Complete Change</button>
          <button style={btnStyle("#FF4444")} onClick={() => {
            setChanges(prev => prev.map(c => c.id === ch.id ? { ...c, status: "Closed" } : c));
            setModal(null); setDetailItem(null);
          }}>Rollback</button>
        </div>
      )}
    </Modal>
  );
};

const ProblemDetailModal = () => {
  const prb = detailItem;
  if (!prb) return null;
  return (
    <Modal title={`${prb.id} — ${prb.title}`} onClose={() => { setModal(null); setDetailItem(null); }} wide>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>STATUS</span><Badge color={STATUS_COLORS[prb.status]}>{prb.status}</Badge></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>PRIORITY</span><PriorityDot priority={prb.priority} /></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>IMPACT</span><Badge color={prb.impact === "Enterprise" ? PRIORITY_COLORS["Sev-A"] : prb.impact === "Department" ? PRIORITY_COLORS["Sev-B"] : PRIORITY_COLORS["Sev-D"]}>{prb.impact || "—"}</Badge></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>CATEGORY</span><span style={{ color: "#A0AEC0", fontSize: 13 }}>{prb.category || "—"}</span></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>ASSIGNEE</span><span style={{ color: "#C4CAD6", fontSize: 13 }}>{prb.assignee}</span>{prb.assignmentGroup && <span style={{ color: "#5A6178", fontSize: 10, marginLeft: 4 }}>({prb.assignmentGroup})</span>}</div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>AGE</span><span style={{ color: "#C4CAD6", fontSize: 13 }}>{timeAgo(prb.created)}</span></div>
      </div>
      {prb.affectedServices?.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>AFFECTED SERVICES</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {prb.affectedServices.map(s => <Badge key={s} color={{ bg: "#1A0A2D", text: "#CE93D8" }}>{s}</Badge>)}
          </div>
        </div>
      )}
      <div style={{ background: "#0A0C14", borderRadius: 6, padding: 14, marginBottom: 16, border: "1px solid #1E213044" }}>
        <span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>ROOT CAUSE</span>
        <p style={{ color: "#C4CAD6", fontSize: 13, margin: 0, lineHeight: 1.6 }}>{prb.rootCause}</p>
      </div>
      {prb.workaround && (
        <div style={{ background: "#0A1E2D", borderRadius: 6, padding: 12, marginBottom: 16, border: "1px solid #06B6D422" }}>
          <span style={{ fontSize: 11, color: "#06B6D4", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>WORKAROUND</span>
          <p style={{ color: "#C4CAD6", fontSize: 12, margin: 0 }}>{prb.workaround}</p>
        </div>
      )}
      {prb.knownErrorId && (
        <div style={{ padding: "8px 12px", background: "#2D1F0A", borderRadius: 6, border: "1px solid #FFB34722", marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: "#FFB347", fontFamily: "'JetBrains Mono', monospace" }}>Known Error ID: {prb.knownErrorId}</span>
        </div>
      )}
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>LINKED INCIDENTS ({prb.linkedIncidents?.length || 0})</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {prb.linkedIncidents?.map(incId => {
            const inc = incidents.find(i => i.id === incId);
            return (
              <span key={incId} style={{ cursor: "pointer" }} onClick={() => {
                if (inc) { setDetailItem(inc); setModal("incidentDetail"); }
              }}>
                <Badge color={{ bg: "#0D2137", text: "#64B5F6" }}>{incId} {inc ? `— ${inc.title}` : ""} →</Badge>
              </span>
            );
          })}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {prb.status === "Under Investigation" && <button style={btnStyle("#FFB347")} onClick={() => {
          setProblems(prev => prev.map(p => p.id === prb.id ? { ...p, status: "Root Cause Identified" } : p));
          setDetailItem({ ...prb, status: "Root Cause Identified" });
        }}>Root Cause Found</button>}
        {prb.status === "Root Cause Identified" && <button style={btnStyle("#CE93D8")} onClick={() => {
          setProblems(prev => prev.map(p => p.id === prb.id ? { ...p, status: "Known Error" } : p));
          setDetailItem({ ...prb, status: "Known Error" });
        }}>Mark Known Error</button>}
        {prb.status !== "Closed" && <button style={btnStyle("#4CAF50")} onClick={() => {
          setProblems(prev => prev.map(p => p.id === prb.id ? { ...p, status: "Closed" } : p));
          setModal(null); setDetailItem(null);
        }}>Close Problem</button>}
      </div>
    </Modal>
  );
};

const KBDetailModal = () => {
  const art = detailItem;
  if (!art) return null;
  const catInfo = KB_CATEGORIES.find(c => c.id === art.category) || { icon: "📄", color: "#64B5F6" };
  const spArticleUrl = art.spSlug ? SHAREPOINT_KB_CONFIG.articleUrl(art.spSlug) : SHAREPOINT_KB_CONFIG.baseUrl;
  const spDocUrl = art.spDocPath ? SHAREPOINT_KB_CONFIG.docUrl(art.spDocPath) : null;
  const relatedArts = (art.relatedArticles || []).map(rid => kbArticles.find(a => a.id === rid)).filter(Boolean);
  return (
    <Modal title={art.title} onClose={() => { setModal(null); setDetailItem(null); }} wide>
      {/* Header badges */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <Badge color={{ bg: `${catInfo.color}18`, text: catInfo.color }}>{catInfo.icon} {art.category}</Badge>
        {art.bestFor && <Badge color={{ bg: art.bestFor === "Incident" ? "#FF6B6B18" : art.bestFor === "Change" ? "#FFB34718" : "#81C78418", text: art.bestFor === "Incident" ? "#FF6B6B" : art.bestFor === "Change" ? "#FFB347" : "#81C784" }}>🎯 {art.bestFor}</Badge>}
        <span style={{ fontSize: 11, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{art.id} · Updated: {art.updated}</span>
        {art.author && <span style={{ fontSize: 11, color: "#5A6178" }}>· ✍️ {art.author}</span>}
      </div>

      {/* When to use */}
      {art.whenToUse && (
        <div style={{ background: "#0A0C14", borderRadius: 8, padding: "12px 16px", border: "1px solid #1E213044", marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#FFB347", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>💡 When to Use</div>
          <p style={{ color: "#C4CAD6", fontSize: 13, margin: 0, lineHeight: 1.6 }}>{art.whenToUse}</p>
        </div>
      )}

      {/* Full Description */}
      <div style={{ background: "#0A0C14", borderRadius: 8, padding: "16px 18px", border: "1px solid #1E213044", marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#64B5F6", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>📋 Description</div>
        <p style={{ color: "#C4CAD6", fontSize: 14, margin: 0, lineHeight: 1.8 }}>{art.content}</p>
      </div>

      {/* Quick Fix Steps */}
      {Array.isArray(art.quickFix) && art.quickFix.length > 0 && (
        <div style={{ background: "linear-gradient(135deg, #6366F108, #06B6D408)", borderRadius: 8, padding: "16px 18px", border: "1px solid #6366F122", marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6366F1", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>⚡ Quick Fix Steps</div>
          {art.quickFix.map((step, si) => (
            <div key={si} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, background: "#6366F122", color: "#6366F1", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>{si + 1}</span>
              <span style={{ color: "#E8ECF4", fontSize: 13, lineHeight: 1.6, paddingTop: 2 }}>{step}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tags */}
      {Array.isArray(art.tags) && art.tags.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#5A6178", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>🏷️ Tags</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {art.tags.map((tag, ti) => (
              <span key={ti} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: "#1E213044", color: "#A0AEC0", fontFamily: "'JetBrains Mono', monospace" }}>#{tag}</span>
            ))}
          </div>
        </div>
      )}

      {/* Related Articles */}
      {relatedArts.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#5A6178", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>🔗 Related Articles</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {relatedArts.map(ra => (
              <button key={ra.id} onClick={() => setDetailItem(ra)} style={{ padding: "6px 12px", fontSize: 12, background: "#0A0C14", border: "1px solid #1E213066", borderRadius: 6, color: "#64B5F6", cursor: "pointer", textAlign: "left" }}>
                <span style={{ fontWeight: 600 }}>{ra.id}</span> · {ra.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stats Footer */}
      <div style={{ display: "flex", gap: 20, fontSize: 12, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginBottom: 16 }}>
        <span>👁 {art.views} views</span>
        <span>👍 {art.helpful}% found helpful</span>
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => window.open(spArticleUrl, "_blank", "noopener")} style={{ ...btnStyle("#0078D4"), display: "flex", alignItems: "center", gap: 6 }}>
          📎 Open in SharePoint
        </button>
        {spDocUrl && (
          <button onClick={() => window.open(spDocUrl, "_blank", "noopener")} style={{ ...btnStyle("#0089D6"), display: "flex", alignItems: "center", gap: 6 }}>
            📂 Download Document
          </button>
        )}
        <button onClick={() => { setModal(null); setDetailItem(null); setShowAiPanel(true); handleAiChat(`Tell me more about ${art.id}`); }} style={{ ...btnStyle("#6366F1"), display: "flex", alignItems: "center", gap: 6 }}>
          🤖 Ask AI About This
        </button>
      </div>
    </Modal>
  );
};

// ─── Asset Detail Modal ────────────────────────────────────────────────
const AssetDetailModal = () => {
  const ast = detailItem;
  if (!ast) return null;
  const linkedIncidents = incidents.filter(i => i.affectedAsset === ast.id || i.affectedAsset === ast.name);
  return (
    <Modal title={`${ast.id} — ${ast.name}`} onClose={() => { setModal(null); setDetailItem(null); }} wide>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>TYPE</span><Badge color={{ bg: "#1A1A2E", text: "#A0AEC0" }}>{ast.type}</Badge></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>STATUS</span><Badge color={STATUS_COLORS[ast.status] || STATUS_COLORS.Active}>{ast.status}</Badge></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>ASSIGNED TO</span><span style={{ color: "#C4CAD6", fontSize: 13 }}>{ast.assignee || "—"}</span></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>LOCATION</span><span style={{ color: "#C4CAD6", fontSize: 13 }}>{ast.location || "—"}</span></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>DEPARTMENT</span><span style={{ color: "#A0AEC0", fontSize: 13 }}>{ast.department || "—"}</span></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>MANUFACTURER</span><span style={{ color: "#C4CAD6", fontSize: 13 }}>{ast.manufacturer || "—"}</span></div>
        {ast.serialNumber && <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>SERIAL NO.</span><span style={{ color: "#64B5F6", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>{ast.serialNumber}</span></div>}
        {ast.ipAddress && <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>IP ADDRESS</span><span style={{ color: "#64B5F6", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>{ast.ipAddress}</span></div>}
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>PURCHASE DATE</span><span style={{ color: "#C4CAD6", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>{ast.purchaseDate || "—"}</span></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>WARRANTY</span><span style={{ color: ast.warranty && ast.warranty !== "N/A" && new Date(ast.warranty) < new Date() ? "#FF6B6B" : "#81C784", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>{ast.warranty || "—"}</span></div>
      </div>
      {linkedIncidents.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>LINKED INCIDENTS ({linkedIncidents.length})</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {linkedIncidents.map(inc => (
              <span key={inc.id} style={{ cursor: "pointer" }} onClick={() => { setDetailItem(inc); setModal("incidentDetail"); }}>
                <Badge color={{ bg: "#0D2137", text: "#64B5F6" }}>{inc.id} — {inc.title} →</Badge>
              </span>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {ast.status !== "Retired" && <button style={btnStyle("#FF6B6B")} onClick={() => {
          setAssets(prev => prev.map(a => a.id === ast.id ? { ...a, status: "Retired" } : a));
          setDetailItem({ ...ast, status: "Retired" });
        }}>Retire Asset</button>}
        {ast.status === "Retired" && <button style={btnStyle("#4CAF50")} onClick={() => {
          setAssets(prev => prev.map(a => a.id === ast.id ? { ...a, status: "Active" } : a));
          setDetailItem({ ...ast, status: "Active" });
        }}>Reactivate</button>}
        <button style={btnStyle("#3B82F6")} onClick={() => {
          setModal("newIncident");
        }}>Create Incident for Asset</button>
        <button style={btnStyle("#06B6D4")} onClick={() => {
          fetch(`/api/cmdb/impact/${ast.id}`).then(r => r.json()).then(d => {
            if (d.ok) { showToast(`Impact analysis: ${d.data.impactedAssets.length} affected CIs (depth ${d.data.maxDepth})`, "info"); }
          }).catch(() => showToast("Impact analysis failed", "error"));
        }}>🔍 Impact Analysis</button>
      </div>
    </Modal>
  );
};

// ─── New Problem Modal ─────────────────────────────────────────────────
const NewProblemModal = () => {
  const [form, setForm] = useState({ title: "", priority: "Sev-C", rootCause: "", assignee: "", linkedIncidents: [] });
  const unlinkedIncidents = incidents.filter(i => !i.linkedProblem && i.status !== "Closed");
  return (
    <Modal title="Create New Problem" onClose={() => setModal(null)}>
      <FormField label="Title">
        <input style={inputStyle} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Problem title" />
      </FormField>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <FormField label="Priority">
          <select style={inputStyle} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
            {["Sev-A", "Sev-B", "Sev-C", "Sev-D"].map(p => <option key={p}>{p}</option>)}
          </select>
        </FormField>
        <FormField label="Assignee">
          <select style={inputStyle} value={form.assignee} onChange={e => setForm({ ...form, assignee: e.target.value })}>
            <option value="">Select assignee</option>
            {USERS.filter(u => u.role !== "End User").map(u => <option key={u.id} value={u.name}>{u.name} — {u.role}</option>)}
          </select>
        </FormField>
      </div>
      <FormField label="Root Cause (if known)">
        <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={form.rootCause} onChange={e => setForm({ ...form, rootCause: e.target.value })} placeholder="Root cause analysis..." />
      </FormField>
      <FormField label="Link Incidents">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {(form.linkedIncidents || []).map(incId => (
            <span key={incId} style={{ cursor: "pointer" }} onClick={() => setForm({ ...form, linkedIncidents: (form.linkedIncidents || []).filter(id => id !== incId) })}>                
              <Badge color={{ bg: "#0D2137", text: "#64B5F6" }}>{incId} ✕</Badge>
            </span>
          ))}
        </div>
        {unlinkedIncidents.length > 0 && (
          <select style={inputStyle} value="" onChange={e => {
            if (e.target.value && !form.linkedIncidents.includes(e.target.value)) {
              setForm({ ...form, linkedIncidents: [...form.linkedIncidents, e.target.value] });
            }
          }}>
            <option value="">Add incident...</option>
            {unlinkedIncidents.filter(i => !form.linkedIncidents.includes(i.id)).map(i => (
              <option key={i.id} value={i.id}>{i.id} — {i.title}</option>
            ))}
          </select>
        )}
      </FormField>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <button style={{ ...btnStyle("#333"), color: "#A0AEC0" }} onClick={() => setModal(null)}>Cancel</button>
        <button style={btnStyle("#8B5CF6")} onClick={() => {
          if (!form.title) return;
          const newPrb = {
            id: genId("PRB"), title: form.title, status: "Under Investigation",
            priority: form.priority, rootCause: form.rootCause || "Pending analysis",
            linkedIncidents: form.linkedIncidents, assignee: form.assignee || "Unassigned", created: 0
          };
          setProblems(prev => [newPrb, ...prev]);
          if (form.linkedIncidents.length > 0) {
            setIncidents(prev => prev.map(i => form.linkedIncidents.includes(i.id) ? { ...i, linkedProblem: newPrb.id } : i));
          }
          setModal(null);
        }}>Create Problem</button>
      </div>
    </Modal>
  );
};

// ─── New Change Modal ─────────────────────────────────────────────────
const NewChangeModal = () => {
  const [form, setForm] = useState({ title: "", type: "Normal", priority: "Sev-C", risk: "Low", description: "", assignee: "", scheduledStart: "", scheduledEnd: "", approvers: [] });
  const managers = USERS.filter(u => u.role === "IT Manager" || u.role === "Change Manager");
  return (
    <Modal title="Create Change Request" onClose={() => setModal(null)} wide>
      <FormField label="Title">
        <input style={inputStyle} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Change request title" />
      </FormField>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <FormField label="Type">
          <select style={inputStyle} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
            {["Standard", "Normal", "Emergency"].map(t => <option key={t}>{t}</option>)}
          </select>
        </FormField>
        <FormField label="Priority">
          <select style={inputStyle} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
            {["Sev-A", "Sev-B", "Sev-C", "Sev-D"].map(p => <option key={p}>{p}</option>)}
          </select>
        </FormField>
        <FormField label="Risk Level">
          <select style={inputStyle} value={form.risk} onChange={e => setForm({ ...form, risk: e.target.value })}>
            {["Low", "Medium", "High"].map(r => <option key={r}>{r}</option>)}
          </select>
        </FormField>
      </div>
      <FormField label="Assignee">
        <select style={inputStyle} value={form.assignee} onChange={e => setForm({ ...form, assignee: e.target.value })}>
          <option value="">Select assignee</option>
          {USERS.filter(u => u.role !== "End User").map(u => <option key={u.id} value={u.name}>{u.name} — {u.role}</option>)}
        </select>
      </FormField>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <FormField label="Scheduled Start">
          <input type="datetime-local" style={inputStyle} value={form.scheduledStart} onChange={e => setForm({ ...form, scheduledStart: e.target.value })} />
        </FormField>
        <FormField label="Scheduled End">
          <input type="datetime-local" style={inputStyle} value={form.scheduledEnd} onChange={e => setForm({ ...form, scheduledEnd: e.target.value })} />
        </FormField>
      </div>
      <FormField label="Description / Implementation Plan">
        <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Describe the change, implementation plan, and rollback plan..." />
      </FormField>
      <FormField label="Approvers">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {(form.approvers || []).map(name => (
            <span key={name} style={{ cursor: "pointer" }} onClick={() => setForm({ ...form, approvers: (form.approvers || []).filter(n => n !== name) })}>                
              <Badge color={{ bg: "#2D1F0A", text: "#FFB347" }}>{name} ✕</Badge>
            </span>
          ))}
        </div>
        <select style={inputStyle} value="" onChange={e => {
          if (e.target.value && !form.approvers.includes(e.target.value)) {
            setForm({ ...form, approvers: [...(form.approvers || []), e.target.value] });
          }
        }}>
          <option value="">Add approver...</option>
          {managers.filter(u => !(form.approvers || []).includes(u.name)).map(u => (
            <option key={u.id} value={u.name}>{u.name} — {u.role}</option>
          ))}
        </select>
      </FormField>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <button style={{ ...btnStyle("#333"), color: "#A0AEC0" }} onClick={() => setModal(null)}>Cancel</button>
        <button style={btnStyle("#FFB347")} onClick={() => {
          if (!form.title) return;
          const newChange = {
            id: genId("CHG"), title: form.title, type: form.type,
            status: (form.approvers || []).length > 0 ? "Awaiting Approval" : "Approved",
            priority: form.priority, risk: form.risk,
            assignee: form.assignee || "Unassigned",
            approvers: (form.approvers || []).map(name => ({ name, status: "Pending" })),
            created: 0, scheduledStart: form.scheduledStart || "TBD",
            scheduledEnd: form.scheduledEnd || "TBD", description: form.description
          };
          setChanges(prev => [newChange, ...prev]);
          setModal(null);
        }}>Create Change Request</button>
      </div>
    </Modal>
  );
};

// ─── New Asset Modal ──────────────────────────────────────────────────
const NewAssetModal = () => {
  const [form, setForm] = useState({ name: "", type: "Laptop", status: "Active", assignee: "", location: "", purchaseDate: "", warranty: "" });
  return (
    <Modal title="Add New Asset" onClose={() => setModal(null)}>
      <FormField label="Asset Name">
        <input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Dell Latitude 5550" />
      </FormField>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <FormField label="Type">
          <select style={inputStyle} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
            {["Laptop", "Desktop", "Monitor", "Printer", "Switch", "Router", "Firewall", "Server", "Virtual Machine", "Phone", "Other"].map(t => <option key={t}>{t}</option>)}
          </select>
        </FormField>
        <FormField label="Status">
          <select style={inputStyle} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            {["Active", "In Use", "In Stock", "Retired", "Running"].map(s => <option key={s}>{s}</option>)}
          </select>
        </FormField>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <FormField label="Assigned To">
          <input style={inputStyle} value={form.assignee} onChange={e => setForm({ ...form, assignee: e.target.value })} placeholder="Person or location" />
        </FormField>
        <FormField label="Location">
          <input style={inputStyle} value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="e.g. SG-Floor3" />
        </FormField>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <FormField label="Purchase Date">
          <input type="date" style={inputStyle} value={form.purchaseDate} onChange={e => setForm({ ...form, purchaseDate: e.target.value })} />
        </FormField>
        <FormField label="Warranty Expiry">
          <input type="date" style={inputStyle} value={form.warranty} onChange={e => setForm({ ...form, warranty: e.target.value })} />
        </FormField>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <button style={{ ...btnStyle("#333"), color: "#A0AEC0" }} onClick={() => setModal(null)}>Cancel</button>
        <button style={btnStyle()} onClick={() => {
          if (!form.name) return;
          const newAsset = {
            id: genId("AST"), name: form.name, type: form.type, status: form.status,
            assignee: form.assignee || "Unassigned", location: form.location || "TBD",
            purchaseDate: form.purchaseDate || new Date().toISOString().split("T")[0],
            warranty: form.warranty || "N/A"
          };
          setAssets(prev => [newAsset, ...prev]);
          setModal(null);
        }}>Add Asset</button>
      </div>
    </Modal>
  );
};

// ─── New KB Article Modal ─────────────────────────────────────────────
const NewKBArticleModal = () => {
  const [form, setForm] = useState({ title: "", category: "Software", content: "" });
  return (
    <Modal title="Create Knowledge Base Article" onClose={() => setModal(null)}>
      <FormField label="Title">
        <input style={inputStyle} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Article title" />
      </FormField>
      <FormField label="Category">
        <select style={inputStyle} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
      </FormField>
      <FormField label="Content">
        <textarea style={{ ...inputStyle, minHeight: 120, resize: "vertical" }} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} placeholder="Write the article content..." />
      </FormField>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <button style={{ ...btnStyle("#333"), color: "#A0AEC0" }} onClick={() => setModal(null)}>Cancel</button>
        <button style={btnStyle()} onClick={() => {
          if (!form.title || !form.content) return;
          const newArt = {
            id: genId("KB"), title: form.title, category: form.category,
            views: 0, helpful: 0, content: form.content,
            author: currentUser?.name || "Unknown",
            status: "Published", tags: [],
            updated: new Date().toISOString().split("T")[0]
          };
          setKbArticles(prev => [newArt, ...prev]);
          setModal(null);
        }}>Publish Article</button>
      </div>
    </Modal>
  );
};

// ─── Request Detail Modal ─────────────────────────────────────────────
const RequestDetailModal = () => {
  const req = detailItem;
  if (!req) return null;
  return (
    <Modal title={`${req.id} — ${req.service}`} onClose={() => { setModal(null); setDetailItem(null); }} wide>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>STATUS</span><Badge color={STATUS_COLORS[req.status]}>{req.status}</Badge></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>PRIORITY</span><PriorityDot priority={req.priority} /></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>REQUESTER</span><span style={{ color: "#C4CAD6", fontSize: 13 }}>{req.requester}</span></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>ASSIGNEE</span><span style={{ color: "#C4CAD6", fontSize: 13 }}>{req.assignee || "Unassigned"}</span></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>SERVICE</span><span style={{ color: "#C4CAD6", fontSize: 13 }}>{req.service}</span></div>
        <div><span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>CREATED</span><span style={{ color: "#C4CAD6", fontSize: 13 }}>{timeAgo(req.created)}</span></div>
      </div>
      {req.notes && (
        <div style={{ background: "#0A0C14", borderRadius: 6, padding: 14, marginBottom: 16, border: "1px solid #1E213044" }}>
          <span style={{ fontSize: 11, color: "#5A6178", display: "block", marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>NOTES</span>
          <p style={{ color: "#C4CAD6", fontSize: 13, margin: 0, lineHeight: 1.6 }}>{req.notes}</p>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {req.status === "Open" && !req.assignee && <button style={btnStyle("#3B82F6")} onClick={() => {
          setRequests(prev => prev.map(r => r.id === req.id ? { ...r, assignee: "VGC Admin", status: "In Progress" } : r));
          setDetailItem({ ...req, assignee: "VGC Admin", status: "In Progress" });
        }}>Assign & Start</button>}
        {req.status === "Open" && req.assignee && <button style={btnStyle("#3B82F6")} onClick={() => {
          setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: "In Progress" } : r));
          setDetailItem({ ...req, status: "In Progress" });
        }}>Start Working</button>}
        {req.status === "Pending Approval" && <>
          <button style={btnStyle("#4CAF50")} onClick={() => {
            setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: "In Progress" } : r));
            setDetailItem({ ...req, status: "In Progress" });
          }}>Approve</button>
          <button style={btnStyle("#FF4444")} onClick={() => {
            setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: "Closed" } : r));
            setModal(null); setDetailItem(null);
          }}>Reject</button>
        </>}
        {req.status === "In Progress" && <button style={btnStyle("#4CAF50")} onClick={() => {
          setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: "Fulfilled" } : r));
          setModal(null); setDetailItem(null);
        }}>Fulfill</button>}
        {req.status === "Fulfilled" && <button style={btnStyle("#1A1A2E")} onClick={() => {
          setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: "Closed" } : r));
          setModal(null); setDetailItem(null);
        }}>Close</button>}
      </div>
    </Modal>
  );
};

// ─── Catalog Request Modal ────────────────────────────────────────────
const CatalogRequestModal = () => {
  const svc = detailItem;
  const [form, setForm] = useState({ requester: "", priority: "Sev-C", notes: "" });
  if (!svc) return null;
  return (
    <Modal title={`Request: ${svc.name}`} onClose={() => { setModal(null); setDetailItem(null); }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, padding: 14, background: "#0A0C14", borderRadius: 8, border: "1px solid #1E213044" }}>
        <span style={{ fontSize: 32 }}>{svc.icon}</span>
        <div>
          <div style={{ color: "#E8ECF4", fontSize: 15, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif" }}>{svc.name}</div>
          <div style={{ fontSize: 11, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{svc.category} · SLA: {svc.sla}h</div>
        </div>
      </div>
      <FormField label="Requester">
        <select style={inputStyle} value={form.requester} onChange={e => setForm({ ...form, requester: e.target.value })}>
          <option value="">Select requester</option>
          {USERS.map(u => <option key={u.id} value={u.name}>{u.name} — {u.team}</option>)}
        </select>
      </FormField>
      <FormField label="Priority">
        <select style={inputStyle} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
          {["Sev-A", "Sev-B", "Sev-C", "Sev-D"].map(p => <option key={p}>{p}</option>)}
        </select>
      </FormField>
      <FormField label="Additional Notes">
        <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Any specific requirements or details..." />
      </FormField>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <button style={{ ...btnStyle("#333"), color: "#A0AEC0" }} onClick={() => { setModal(null); setDetailItem(null); }}>Cancel</button>
        <button style={btnStyle("#4CAF50")} onClick={() => {
          const requesterUser = form.requester ? USERS.find(u => u.name === form.requester) : null;
          const newReq = {
            id: genId("REQ"), service: svc.name, status: "Open",
            requester: form.requester || "Current User",
            requesterEmail: requesterUser?.email || "",
            requesterRole: requesterUser?.rbacRole || "",
            assignee: null, assignmentGroup: "Service Desk",
            created: 0, priority: form.priority,
            category: svc.category, notes: form.notes,
            fulfillmentNotes: "", approver: ""
          };
          setRequests(prev => [newReq, ...prev]);
          setModal(null); setDetailItem(null);
          setActiveModule("requests");
        }}>Submit Request</button>
      </div>
    </Modal>
  );
};

// ─── Catalog Management Modal (Add/Edit Service) ─────────────────────
const CatalogManageModal = () => {
  const editing = detailItem;
  const [form, setForm] = useState(editing ? { name: editing.name, category: editing.category, sla: editing.sla, icon: editing.icon, description: editing.description || "" } : { name: "", category: "Software", sla: 24, icon: "🔧", description: "" });
  const ICON_OPTIONS = ["🔧", "💻", "📦", "🌐", "📧", "☁️", "🛡️", "🗄️", "🔑", "🎯", "📊", "🖥️", "📱", "🔒", "⚙️", "🚀"];
  return (
    <Modal title={editing ? `Edit Service: ${editing.name}` : "Add New Service"} onClose={() => { setModal(null); setDetailItem(null); }}>
      <FormField label="Service Name">
        <input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Password Reset, Software Installation" />
      </FormField>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <FormField label="Category">
          <select style={inputStyle} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </FormField>
        <FormField label="SLA Target (hours)">
          <input type="number" style={inputStyle} value={form.sla} onChange={e => setForm({ ...form, sla: parseInt(e.target.value) || 0 })} min="1" />
        </FormField>
      </div>
      <FormField label="Icon">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {ICON_OPTIONS.map(ic => (
            <button key={ic} onClick={() => setForm({ ...form, icon: ic })} style={{
              width: 36, height: 36, borderRadius: 6, border: form.icon === ic ? "2px solid #6366F1" : "1px solid #1E2130",
              background: form.icon === ic ? "#6366F111" : "#0A0C14", cursor: "pointer", fontSize: 18,
              display: "flex", alignItems: "center", justifyContent: "center"
            }}>{ic}</button>
          ))}
        </div>
      </FormField>
      <FormField label="Description">
        <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Brief description of this service offering..." />
      </FormField>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <button style={{ ...btnStyle("#333"), color: "#A0AEC0" }} onClick={() => { setModal(null); setDetailItem(null); }}>Cancel</button>
        <button style={btnStyle(editing ? "#3B82F6" : "#4CAF50")} onClick={() => {
          if (!form.name) return;
          if (editing) {
            setServiceCatalog(prev => prev.map(s => s.id === editing.id ? { ...s, name: form.name, category: form.category, sla: form.sla, icon: form.icon, description: form.description } : s));
          } else {
            const newSvc = { id: genId("SVC"), name: form.name, category: form.category, sla: form.sla, icon: form.icon, description: form.description };
            setServiceCatalog(prev => [...prev, newSvc]);
          }
          setModal(null); setDetailItem(null);
        }}>{editing ? "Save Changes" : "Add Service"}</button>
      </div>
    </Modal>
  );
};

  // Render active modal based on modal prop
  return (
    <>
      {modal === "newIncident" && <NewIncidentModal />}
      {modal === "incidentDetail" && <IncidentDetailModal />}
      {modal === "changeDetail" && <ChangeDetailModal />}
      {modal === "problemDetail" && <ProblemDetailModal />}
      {modal === "kbDetail" && <KBDetailModal />}
      {modal === "newProblem" && <NewProblemModal />}
      {modal === "newChange" && <NewChangeModal />}
      {modal === "newAsset" && <NewAssetModal />}
      {modal === "newKBArticle" && <NewKBArticleModal />}
      {modal === "assetDetail" && <AssetDetailModal />}
      {modal === "requestDetail" && <RequestDetailModal />}
      {modal === "catalogRequest" && <CatalogRequestModal />}
      {modal === "catalogManage" && <CatalogManageModal />}
    </>
  );
}
