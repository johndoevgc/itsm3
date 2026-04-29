import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  COLORS, PRIORITY_COLORS, STATUS_COLORS, PERM_COLORS, inputStyle, btnStyle,
} from "../constants/theme.js";
import {
  RBAC_PERMISSIONS,
} from "../constants/rbac.js";
import {
  KB_CATEGORIES, SHAREPOINT_KB_CONFIG,
} from "../constants/categories.js";
import { APP_VERSION } from "../constants/version.js";
import {
  genId, timeAgo, sanitizeHTML,
} from "../utils/slaHelpers.js";
import {
  Badge, PriorityDot, Modal, FormField, SearchBar, WorkflowHeader, useStableComponent,
} from "../components/SharedComponents.jsx";
import {
  searchKBArticles,
} from "../utils/aiEngine.jsx";

// Knowledge Base module — extracted from itsm-tool.jsx
export default function KnowledgeModule({ ctx }) {
  const {
    currentUser, showToast, _save, kbArticles, setKbArticles,
    search, setActiveModule, setDetailItem, setModal,
    guideGenerating, setGuideGenerating, guideTopic, setGuideTopic,
    guideCategory, setGuideCategory, guideResult, setGuideResult,
    spDocUrl, setSpDocUrl, spDocTitle, setSpDocTitle,
    spDocType, setSpDocType, spDocGenerating, setSpDocGenerating,
    spDocResult, setSpDocResult,
    kpActiveTab, setKpActiveTab,
    kbDocPreview, setKbDocPreview,
    kbVersionHistory, setKbVersionHistory,
    kbBulkUploadFiles, setKbBulkUploadFiles,
    kbBulkUploading, setKbBulkUploading,
    kbAiLearning, setKbAiLearning,
    kbAiLearningProgress, setKbAiLearningProgress,
    kbAutoGenRunning, kbAutoGenProgress,
    kbGapReport, setKbGapReport,
    aiEngine, generateGuide, generateSpDoc, mdToHtml, exportToWord,
    bulkUploadAndTrain, loadVersionHistory,
  } = ctx;

const [kbCategoryFilter, setKbCategoryFilter] = useState("All");
const [kbTypeFilter, setKbTypeFilter] = useState("All");
const [kbViewMode, setKbViewMode] = useState("cards"); // cards | list
const KnowledgeModule = useStableComponent(() => {
  // Phase S1d — defer search so heavy filter doesn't block typing
  const deferredSearch = React.useDeferredValue(search);
  const filteredKB = useMemo(() => {
    const q = (deferredSearch || "").toLowerCase();
    return kbArticles.filter(a => {
      const matchSearch = !q || (a.title || "").toLowerCase().includes(q) || (a.category || "").toLowerCase().includes(q) || (a.tags || []).some(t => t.toLowerCase().includes(q)) || (a.whenToUse || "").toLowerCase().includes(q);
      const matchCat = kbCategoryFilter === "All" || a.category === kbCategoryFilter;
      const matchType = kbTypeFilter === "All" || a.bestFor === kbTypeFilter;
      return matchSearch && matchCat && matchType;
    });
  }, [kbArticles, deferredSearch, kbCategoryFilter, kbTypeFilter]);
  const uniqueCategories = ["All", ...new Set(kbArticles.map(a => a.category))];
  const catMeta = (cat) => KB_CATEGORIES.find(c => c.id === cat) || { icon: "📄", color: "#64B5F6" };

  return (
  <div>
    <WorkflowHeader module="knowledge" version={APP_VERSION.version} stepCounts={[kbArticles.filter(a => a.status === "Draft").length, kbArticles.filter(a => a.aiEnriched).length, kbArticles.filter(a => a.status === "Review").length, kbArticles.filter(a => a.status === "Published").length, kbArticles.length]} />
    {/* SharePoint Connection Banner */}
    <div style={{ background: "linear-gradient(135deg, #0078D408, #0089D618)", borderRadius: 10, border: "1px solid #0078D433", padding: "14px 20px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #0078D4, #0089D6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📚</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
            Knowledge Portal
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, fontSize: 9, fontWeight: 600, background: "#0D2D1A", color: "#81C784", border: "1px solid #81C78444" }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#81C784", boxShadow: "0 0 6px #81C78444" }} /> SharePoint Connected
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, fontSize: 9, fontWeight: 600, background: "#6366F118", color: "#6366F1", border: "1px solid #6366F144" }}>
              v{APP_VERSION.version}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "#5A6178", marginTop: 2 }}>{kbArticles.length} articles · {kbEntries.length} AI knowledge entries · Helpdesk Document Library linked · AI auto-doc enabled</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button disabled={kbLearningLoading} onClick={runKbLearning}
          style={{ ...btnStyle("#7C3AED"), fontSize: 11, padding: "6px 14px", display: "flex", alignItems: "center", gap: 4, opacity: kbLearningLoading ? 0.5 : 1 }}>
          {kbLearningLoading ? "⏳ Learning..." : "🧠 Learn from Incidents"}
        </button>
        <button style={{ ...btnStyle("#EC4899"), fontSize: 11, padding: "6px 14px", display: "flex", alignItems: "center", gap: 4 }} onClick={async () => {
          try {
            showToast("🔄 Batch generating KB articles from resolved incidents...", "info");
            const r = await fetch("/api/ai/kb-batch-generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestedBy: currentUser?.name || "Admin", sinceDays: 30, maxArticles: 10 }) });
            if (r.ok) {
              const data = await r.json();
              showToast(`✅ Generated ${data.generated} KB drafts, ${data.skipped} duplicates skipped. Review in Engineer Review Hub.`, "success");
            } else { const err = await r.json(); showToast(`❌ ${err.error}`, "error"); }
          } catch (e) { showToast("Batch generation failed: " + e.message, "error"); }
        }}>🤖 AI Batch Generate</button>
        <button style={{ ...btnStyle("#0078D4"), fontSize: 11, padding: "6px 14px", display: "flex", alignItems: "center", gap: 4 }} onClick={() => window.open(SHAREPOINT_KB_CONFIG.helpdeskLibraryUrl, "_blank", "noopener")}>📂 Helpdesk Library</button>
        <button style={{ ...btnStyle(), fontSize: 11, padding: "6px 14px", display: "flex", alignItems: "center", gap: 4 }} onClick={() => window.open(SHAREPOINT_KB_CONFIG.baseUrl, "_blank", "noopener")}>🔗 SharePoint Site</button>
        <button style={btnStyle()} onClick={() => setModal("newKBArticle")}>+ New Article</button>
        <button style={{ ...btnStyle("#0EA5E9"), fontSize: 11, padding: "6px 14px", display: "flex", alignItems: "center", gap: 4 }} onClick={() => window.open("/api/export/kb?format=csv", "_blank")}>📥 Export CSV</button>
        <button style={{ ...btnStyle("#06B6D4"), fontSize: 11, padding: "6px 14px", display: "flex", alignItems: "center", gap: 4 }} onClick={async () => {
          try {
            const r = await fetch("/api/db/kb");
            if (r.ok) {
              const data = await r.json();
              const items = (Array.isArray(data) ? data : (data.data || [])).map(d => { try { return typeof d.data === "string" ? JSON.parse(d.data) : (d.data || d); } catch { return null; } }).filter(Boolean);
              if (items.length > 0) {
                const existingIds = new Set(kbArticles.map(a => a.id));
                const newItems = items.filter(a => !existingIds.has(a.id));
                if (newItems.length > 0) { setKbArticles(prev => [...newItems, ...prev]); showToast(`📚 Loaded ${newItems.length} new article(s) from server`, "success"); }
                else { showToast("📚 KB articles already up-to-date", "info"); }
              } else { showToast("No articles found on server", "info"); }
            }
          } catch (e) { showToast("Refresh failed: " + e.message, "error"); }
        }}>🔄 Refresh from Server</button>
      </div>
    </div>

    {/* Knowledge Portal Tabs */}
    <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#0A0C14", padding: 4, borderRadius: 8, overflowX: "auto" }}>
      {[
        { id: "articles", label: "📚 Articles", count: filteredKB.length },
        { id: "generator", label: "🤖 AI Doc Generator", count: null },
        { id: "sharepoint", label: "📂 SharePoint Docs", count: null },
        { id: "upload", label: "📤 Upload & Train", count: kbBulkUploadFiles.length || null },
        { id: "generated", label: "📋 Generated Docs", count: kbEntries.filter(e => e.type === "guide" || e.type === "sharepoint-doc" || e.source === "ai-generated" || e.source === "sharepoint" || e.fileName).length },
        { id: "gaps", label: "🔍 KB Gaps", count: null },
      ].map(tab => (
        <button key={tab.id} onClick={() => setKpActiveTab(tab.id)} style={{
          padding: "8px 16px", borderRadius: 6, border: "none", cursor: "pointer",
          background: kpActiveTab === tab.id ? "linear-gradient(135deg, #6366F122, #06B6D418)" : "transparent",
          color: kpActiveTab === tab.id ? "#E8ECF4" : "#5A6178",
          fontSize: 12, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif",
          display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s", whiteSpace: "nowrap",
          borderBottom: kpActiveTab === tab.id ? "2px solid #6366F1" : "2px solid transparent"
        }}>
          {tab.label} {tab.count != null && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 10, background: kpActiveTab === tab.id ? "#6366F133" : "#1E2130", color: kpActiveTab === tab.id ? "#6366F1" : "#5A6178" }}>{tab.count}</span>}
        </button>
      ))}
    </div>

    {/* ─── Tab: AI Guide Generator ──────────────────────────── */}
    {kpActiveTab === "generator" && (
      <div>
        <div style={{ background: "linear-gradient(135deg, #6366F108, #06B6D408)", borderRadius: 10, border: "1px solid #6366F133", padding: 24, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #6366F1, #06B6D4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🤖</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>AI Professional Guide Generator</div>
              <div style={{ fontSize: 11, color: "#5A6178" }}>Generate comprehensive documentation from Zendesk ticket history, KB articles, and AI knowledge</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4, display: "block" }}>Guide Topic</label>
              <input style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} placeholder="e.g., VPN Setup Guide, Password Reset Procedure, Azure MFA Enrollment..." value={guideTopic} onChange={e => setGuideTopic(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && guideTopic.trim()) generateGuide(); }} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4, display: "block" }}>Category</label>
              <select style={{ ...inputStyle, width: "100%", boxSizing: "border-box", cursor: "pointer" }} value={guideCategory} onChange={e => setGuideCategory(e.target.value)}>
                {KB_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                <option value="General">📄 General</option>
                <option value="Troubleshooting">🔧 Troubleshooting</option>
                <option value="SOP">📋 SOP</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <span style={{ fontSize: 10, color: "#5A6178", alignSelf: "center" }}>Quick topics:</span>
            {["VPN Setup Guide", "Password Reset", "Azure MFA Enrollment", "Email Migration", "New Employee Onboarding", "Incident Response SOP", "Firewall Rule Changes", "Backup & Recovery"].map(t => (
              <button key={t} onClick={() => setGuideTopic(t)} style={{ padding: "3px 10px", borderRadius: 20, fontSize: 10, border: "1px solid #1E2130", background: guideTopic === t ? "#6366F122" : "#0A0C14", color: guideTopic === t ? "#6366F1" : "#8B92A8", cursor: "pointer", transition: "all 0.15s" }}>{t}</button>
            ))}
          </div>

          <div style={{ padding: 12, borderRadius: 8, background: "#0A0C14", border: "1px solid #1E2130", marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#06B6D4", marginBottom: 6 }}>📋 What AI will include in the guide:</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 10, color: "#8B92A8" }}>
              <span>✅ Professional title & metadata</span>
              <span>✅ Table of contents</span>
              <span>✅ Step-by-step instructions</span>
              <span>✅ 📸 Screenshot placeholders</span>
              <span>✅ Troubleshooting section</span>
              <span>✅ FAQ (5+ questions)</span>
              <span>✅ Reference links (Microsoft Learn, etc.)</span>
              <span>✅ Zendesk ticket history references</span>
            </div>
          </div>

          <button onClick={generateGuide} disabled={guideGenerating || !guideTopic.trim()} style={{
            ...btnStyle("#6366F1"), width: "100%", padding: "12px 24px", fontSize: 13, fontWeight: 700,
            opacity: (guideGenerating || !guideTopic.trim()) ? 0.5 : 1,
            background: guideGenerating ? "#1E2130" : "linear-gradient(135deg, #6366F1, #06B6D4)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8
          }}>
            {guideGenerating ? "⏳ Generating comprehensive guide... (this may take 30-60s)" : "🤖 Generate Professional Guide"}
          </button>
        </div>

        {/* Guide Result */}
        {guideResult && (
          <div style={{ background: "#0F1117", borderRadius: 10, border: `1px solid ${guideResult.error ? "#FF6B6B33" : "#81C78433"}`, overflow: "hidden" }}>
            {guideResult.error ? (
              <div style={{ padding: 20, color: "#FF6B6B", fontSize: 12 }}>❌ {guideResult.error}</div>
            ) : (
              <>
                <div style={{ padding: "14px 20px", background: "linear-gradient(135deg, #81C78408, #06B6D408)", borderBottom: "1px solid #1E2130", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#81C784", fontFamily: "'Space Grotesk', sans-serif" }}>✅ Guide Generated Successfully</div>
                    <div style={{ fontSize: 10, color: "#5A6178", marginTop: 2 }}>{guideResult.text.length.toLocaleString()} characters · {guideResult.zdRefs} Zendesk tickets referenced · Auto-saved to Knowledge Base</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button onClick={() => { navigator.clipboard.writeText(guideResult.text); }} style={{ ...btnStyle("#06B6D4"), fontSize: 10, padding: "5px 12px" }}>📋 Copy</button>
                    <button onClick={() => exportToWord(guideResult.text, guideResult.title || guideTopic)} style={{ ...btnStyle("#2B579A"), fontSize: 10, padding: "5px 12px" }}>📄 Word (.doc)</button>
                    <button onClick={() => { const blob = new Blob([guideResult.text], { type: "text/markdown" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${guideTopic.replace(/\s+/g, "-")}-Guide.md`; a.click(); URL.revokeObjectURL(url); }} style={{ ...btnStyle("#0078D4"), fontSize: 10, padding: "5px 12px" }}>📥 Markdown</button>
                  </div>
                </div>
                <div style={{ padding: 20, maxHeight: 600, overflow: "auto", fontSize: 12, color: "#C4CAD6", lineHeight: 1.7, fontFamily: "'DM Sans', sans-serif", whiteSpace: "pre-wrap" }}>
                  {guideResult.text}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    )}

    {/* ─── Tab: SharePoint Document Library ──────────────────── */}
    {kpActiveTab === "sharepoint" && (
      <div>
        <div style={{ background: "linear-gradient(135deg, #0078D408, #0089D618)", borderRadius: 10, border: "1px solid #0078D433", padding: 24, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #0078D4, #0089D6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📂</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>SharePoint Document Library Integration</div>
              <div style={{ fontSize: 11, color: "#5A6178" }}>Provide a SharePoint document library link and AI will auto-generate professional documentation</div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4, display: "block" }}>SharePoint Document URL</label>
              <input style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} placeholder="https://vgctechnology.sharepoint.com/sites/ITSM-KnowledgePortal/Shared Documents/..." value={spDocUrl} onChange={e => setSpDocUrl(e.target.value)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 12 }}>
              <div>
                <label style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4, display: "block" }}>Document Title</label>
                <input style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} placeholder="e.g., Network Architecture Overview, DR Runbook..." value={spDocTitle} onChange={e => setSpDocTitle(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4, display: "block" }}>Document Type</label>
                <select style={{ ...inputStyle, width: "100%", boxSizing: "border-box", cursor: "pointer" }} value={spDocType} onChange={e => setSpDocType(e.target.value)}>
                  <option>General Documentation</option>
                  <option>SOP / Procedure</option>
                  <option>Technical Guide</option>
                  <option>Architecture Document</option>
                  <option>Runbook / Playbook</option>
                  <option>Policy Document</option>
                  <option>Training Material</option>
                  <option>Troubleshooting Guide</option>
                </select>
              </div>
            </div>
          </div>

          {/* Quick SharePoint Links */}
          <div style={{ padding: 12, borderRadius: 8, background: "#0A0C14", border: "1px solid #1E2130", marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#0078D4", marginBottom: 8 }}>🔗 Quick SharePoint Links</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[
                { label: "📖 Helpdesk Library", url: SHAREPOINT_KB_CONFIG.helpdeskLibraryUrl },
                { label: "📚 Knowledge Portal", url: SHAREPOINT_KB_CONFIG.baseUrl },
                { label: "📋 IT Policies", url: SHAREPOINT_KB_CONFIG.baseUrl + "/SitePages/IT-Policies.aspx" },
                { label: "🔧 SOPs", url: SHAREPOINT_KB_CONFIG.baseUrl + "/SitePages/SOPs.aspx" },
                { label: "🛡️ Security Docs", url: SHAREPOINT_KB_CONFIG.baseUrl + "/SitePages/Security.aspx" },
              ].map(link => (
                <button key={link.label} onClick={() => { setSpDocUrl(link.url); setSpDocTitle(link.label.replace(/^[^\s]+\s/, "")); }} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 10, border: "1px solid #0078D433", background: "#0078D408", color: "#0078D4", cursor: "pointer", transition: "all 0.15s" }}
                  onMouseOver={e => e.currentTarget.style.background = "#0078D422"}
                  onMouseOut={e => e.currentTarget.style.background = "#0078D408"}>{link.label}</button>
              ))}
            </div>
          </div>

          <button onClick={generateSpDoc} disabled={spDocGenerating || (!spDocUrl.trim() && !spDocTitle.trim())} style={{
            ...btnStyle("#0078D4"), width: "100%", padding: "12px 24px", fontSize: 13, fontWeight: 700,
            opacity: (spDocGenerating || (!spDocUrl.trim() && !spDocTitle.trim())) ? 0.5 : 1,
            background: spDocGenerating ? "#1E2130" : "linear-gradient(135deg, #0078D4, #0089D6)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8
          }}>
            {spDocGenerating ? "⏳ AI is preparing professional documentation..." : "📝 Auto-Generate Documentation"}
          </button>
        </div>

        {/* SharePoint Doc Result */}
        {spDocResult && (
          <div style={{ background: "#0F1117", borderRadius: 10, border: `1px solid ${spDocResult.error ? "#FF6B6B33" : "#0078D433"}`, overflow: "hidden" }}>
            {spDocResult.error ? (
              <div style={{ padding: 20, color: "#FF6B6B", fontSize: 12 }}>❌ {spDocResult.error}</div>
            ) : (
              <>
                <div style={{ padding: "14px 20px", background: "linear-gradient(135deg, #0078D408, #0089D618)", borderBottom: "1px solid #1E2130", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0078D4", fontFamily: "'Space Grotesk', sans-serif" }}>✅ Documentation Generated</div>
                    <div style={{ fontSize: 10, color: "#5A6178", marginTop: 2 }}>{spDocResult.text.length.toLocaleString()} characters · Auto-saved to Knowledge Base · Ready for SharePoint upload</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button onClick={() => { navigator.clipboard.writeText(spDocResult.text); }} style={{ ...btnStyle("#06B6D4"), fontSize: 10, padding: "5px 12px" }}>📋 Copy</button>
                    <button onClick={() => exportToWord(spDocResult.text, spDocResult.title || spDocTitle || "SharePoint-Doc")} style={{ ...btnStyle("#2B579A"), fontSize: 10, padding: "5px 12px" }}>📄 Word (.doc)</button>
                    <button onClick={() => { const blob = new Blob([spDocResult.text], { type: "text/markdown" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${(spDocTitle || "SharePoint-Doc").replace(/\s+/g, "-")}.md`; a.click(); URL.revokeObjectURL(url); }} style={{ ...btnStyle("#0078D4"), fontSize: 10, padding: "5px 12px" }}>📥 Markdown</button>
                    {spDocUrl && <button onClick={() => window.open(spDocUrl, "_blank", "noopener")} style={{ ...btnStyle("#0089D6"), fontSize: 10, padding: "5px 12px" }}>🔗 Open in SharePoint</button>}
                  </div>
                </div>
                <div style={{ padding: 20, maxHeight: 600, overflow: "auto", fontSize: 12, color: "#C4CAD6", lineHeight: 1.7, fontFamily: "'DM Sans', sans-serif", whiteSpace: "pre-wrap" }}>
                  {spDocResult.text}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    )}

    {/* ─── Tab: Upload & AI Training ────────────────────────── */}
    {kpActiveTab === "upload" && (
      <div>
        <div style={{ background: "linear-gradient(135deg, #81C78408, #06B6D408)", borderRadius: 10, border: "1px solid #81C78433", padding: 24, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #81C784, #06B6D4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📤</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>Upload Documents & Train AI</div>
              <div style={{ fontSize: 11, color: "#5A6178" }}>Upload documents for AI to learn from. AI processes and generates proper knowledge articles automatically.</div>
            </div>
          </div>

          {/* Upload Zone */}
          <div style={{
            border: "2px dashed #81C78444", borderRadius: 12, padding: "40px 24px", textAlign: "center",
            cursor: "pointer", transition: "all 0.25s", background: "#0A0C14", marginBottom: 16
          }}
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#81C784"; e.currentTarget.style.background = "#81C78408"; }}
            onDragLeave={e => { e.currentTarget.style.borderColor = "#81C78444"; e.currentTarget.style.background = "#0A0C14"; }}
            onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#81C78444"; e.currentTarget.style.background = "#0A0C14"; handleKbBulkUpload(e.dataTransfer.files); }}
            onClick={() => document.getElementById("kb-bulk-upload-input")?.click()}>
            <input id="kb-bulk-upload-input" type="file" multiple accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.txt,.csv,.md,.json,.png,.jpg,.jpeg,.gif,.webp" style={{ display: "none" }} onChange={e => handleKbBulkUpload(e.target.files)} />
            <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#E8ECF4", marginBottom: 4 }}>Drop files here or click to upload</div>
            <div style={{ fontSize: 11, color: "#5A6178", marginBottom: 12 }}>Supports: Word, Excel, PowerPoint, PDF, Text, CSV, Markdown, JSON, Images</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {[
                { icon: "📄", label: "Word", color: "#2B579A" },
                { icon: "📊", label: "Excel", color: "#217346" },
                { icon: "📽️", label: "PPT", color: "#D24726" },
                { icon: "📕", label: "PDF", color: "#FF0000" },
                { icon: "📝", label: "Text", color: "#5A6178" },
                { icon: "🖼️", label: "Image", color: "#06B6D4" },
              ].map(t => (
                <span key={t.label} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: `${t.color}18`, color: t.color, border: `1px solid ${t.color}33` }}>{t.icon} {t.label}</span>
              ))}
            </div>
          </div>

          {/* Upload Queue */}
          {kbBulkUploadFiles.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#E8ECF4" }}>📎 Upload Queue ({kbBulkUploadFiles.length} files)</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setKbBulkUploadFiles([])} style={{ ...btnStyle("#FF6B6B"), fontSize: 10, padding: "3px 10px" }}>Clear All</button>
                </div>
              </div>
              <div style={{ maxHeight: 200, overflowY: "auto", borderRadius: 8, border: "1px solid #1E2130" }}>
                {kbBulkUploadFiles.map((f, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid #1E213033", background: f.status === "done" ? "#81C78408" : f.status === "error" ? "#FF6B6B08" : "#0F1117" }}>
                    <span style={{ fontSize: 16 }}>{f.type === "Word" ? "📄" : f.type === "Excel" ? "📊" : f.type === "PowerPoint" ? "📽️" : f.type === "PDF" ? "📕" : f.type === "Image" ? "🖼️" : f.type === "Video" ? "🎬" : "📎"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: "#C4CAD6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                      <div style={{ fontSize: 9, color: "#5A6178" }}>{f.type} · {(f.size / 1024).toFixed(1)} KB</div>
                    </div>
                    {f.status === "done" ? (
                      <span style={{ fontSize: 10, color: "#81C784", fontWeight: 600 }}>✅ Uploaded</span>
                    ) : f.status === "error" ? (
                      <span style={{ fontSize: 10, color: "#FF6B6B", fontWeight: 600 }}>❌ Failed</span>
                    ) : (
                      <button onClick={() => setKbBulkUploadFiles(prev => prev.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", color: "#FF6B6B88", cursor: "pointer", fontSize: 12, padding: 4 }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Learning Progress */}
          {kbAiLearningProgress.status && (
            <div style={{ padding: "12px 16px", borderRadius: 8, background: "#06B6D408", border: "1px solid #06B6D433", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 14 }}>{kbBulkUploading ? "⏳" : kbAiLearning ? "🧠" : "✅"}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#06B6D4" }}>{kbAiLearningProgress.status}</span>
              </div>
              {kbAiLearningProgress.total > 0 && (
                <div style={{ height: 6, borderRadius: 3, background: "#1E2130", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 3, background: "linear-gradient(90deg, #81C784, #06B6D4)", width: `${Math.round((kbAiLearningProgress.done / kbAiLearningProgress.total) * 100)}%`, transition: "width 0.3s" }} />
                </div>
              )}
            </div>
          )}

          {/* Upload & Train Button */}
          <button onClick={processKbBulkUpload} disabled={kbBulkUploadFiles.length === 0 || kbBulkUploading} style={{
            ...btnStyle("#81C784"), width: "100%", padding: "12px 24px", fontSize: 13, fontWeight: 700,
            opacity: (kbBulkUploadFiles.length === 0 || kbBulkUploading) ? 0.5 : 1,
            background: kbBulkUploading ? "#1E2130" : "linear-gradient(135deg, #81C784, #06B6D4)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8
          }}>
            {kbBulkUploading ? "⏳ Processing..." : `📤 Upload & Train AI (${kbBulkUploadFiles.filter(f => f.status === "pending").length} files)`}
          </button>
        </div>

        {/* AI Learning Info */}
        <div style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", marginBottom: 12 }}>🧠 How AI Learning Works</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {[
              { icon: "📤", title: "1. Upload", desc: "Upload documents (Word, Excel, PDF, etc.)", color: "#81C784" },
              { icon: "🔍", title: "2. Extract", desc: "AI extracts text content from supported files", color: "#06B6D4" },
              { icon: "🧠", title: "3. Learn", desc: "Content is indexed into AI knowledge base", color: "#6366F1" },
              { icon: "💡", title: "4. Assist", desc: "AI uses knowledge to answer questions accurately", color: "#FFB347" },
              { icon: "📄", title: "5. Generate", desc: "AI auto-generates SOPs, guides from learned content", color: "#EC4899" },
            ].map(step => (
              <div key={step.title} style={{ padding: 14, borderRadius: 8, background: "#0A0C14", border: `1px solid ${step.color}22` }}>
                <div style={{ fontSize: 20, marginBottom: 6 }}>{step.icon}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: step.color, marginBottom: 4 }}>{step.title}</div>
                <div style={{ fontSize: 10, color: "#5A6178", lineHeight: 1.4 }}>{step.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )}

    {/* ─── Tab: Generated Documents ──────────────────────────── */}
    {kpActiveTab === "generated" && (
      <div>
        <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>📋 AI-Generated Documents, Guides & Uploaded Files</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={fetchKbEntries} style={{ ...btnStyle(), fontSize: 10, padding: "5px 12px" }}>🔄 Refresh</button>
            <button onClick={() => window.open(SHAREPOINT_KB_CONFIG.helpdeskLibraryUrl, "_blank", "noopener")} style={{ ...btnStyle("#0078D4"), fontSize: 10, padding: "5px 12px" }}>📂 SharePoint</button>
          </div>
        </div>

        {/* Doc Preview Panel */}
        {kbDocPreview && (
          <div style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #6366F133", marginBottom: 16, overflow: "hidden" }}>
            <div style={{ padding: "12px 18px", background: "linear-gradient(135deg, #6366F108, #06B6D408)", borderBottom: "1px solid #1E2130", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>{kbDocPreview.source === "sharepoint" ? "📂" : kbDocPreview.fileName ? "📎" : "🤖"} {kbDocPreview.title}</div>
                <div style={{ fontSize: 10, color: "#5A6178", marginTop: 2, display: "flex", gap: 10 }}>
                  <span>📁 {kbDocPreview.category}</span>
                  <span>📝 {(kbDocPreview.content || "").length.toLocaleString()} chars</span>
                  <span>🕐 {new Date(kbDocPreview.createdAt).toLocaleDateString("en-SG")}</span>
                  {kbDocPreview.version && <span>📌 v{kbDocPreview.version}</span>}
                  <span>👤 {kbDocPreview.trainedBy || kbDocPreview.updatedBy}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => { navigator.clipboard.writeText(kbDocPreview.content); }} style={{ ...btnStyle("#06B6D4"), fontSize: 9, padding: "4px 10px" }}>📋 Copy</button>
                <button onClick={() => exportToWord(kbDocPreview.content, kbDocPreview.title)} style={{ ...btnStyle("#2B579A"), fontSize: 9, padding: "4px 10px" }}>📄 Word</button>
                <button onClick={() => { const blob = new Blob([kbDocPreview.content], { type: "text/markdown" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${kbDocPreview.title.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "-")}.md`; a.click(); URL.revokeObjectURL(url); }} style={{ ...btnStyle("#0078D4"), fontSize: 9, padding: "4px 10px" }}>📥 MD</button>
                <button onClick={() => { fetchKbVersionHistory(kbDocPreview.id); }} style={{ ...btnStyle("#FFB347"), fontSize: 9, padding: "4px 10px" }}>📌 Versions</button>
                <button onClick={() => setKbDocPreview(null)} style={{ ...btnStyle("#FF6B6B"), fontSize: 9, padding: "4px 10px" }}>✕ Close</button>
              </div>
            </div>
            {/* Version History (if loaded) */}
            {kbVersionHistory.length > 0 && (
              <div style={{ padding: "8px 18px", background: "#FFB34708", borderBottom: "1px solid #1E2130" }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#FFB347", marginBottom: 6 }}>📌 Version History</div>
                {kbVersionHistory.map(v => (
                  <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 10, color: "#5A6178" }}>
                    <span style={{ color: "#FFB347", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>v{v.version}</span>
                    <span>{new Date(v.updatedAt).toLocaleDateString("en-SG")}</span>
                    <span>by {v.updatedBy}</span>
                    <span style={{ color: "#8B92A8" }}>{v.changeNote}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ padding: 18, maxHeight: 400, overflow: "auto", fontSize: 12, color: "#C4CAD6", lineHeight: 1.7, fontFamily: "'DM Sans', sans-serif", whiteSpace: "pre-wrap" }}>
              {kbDocPreview.content}
            </div>
          </div>
        )}

        {/* AI Auto-Generation Progress Banner */}
        {(kbAutoGenRunning || kbAutoGenProgress.status) && (
          <div style={{ background: "linear-gradient(135deg, #6366F108, #06B6D408)", borderRadius: 10, border: "1px solid #6366F133", padding: 16, marginBottom: 16, animation: "aiBorderPulse 3s ease-in-out infinite" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 20 }}>{kbAutoGenRunning ? "⏳" : "✅"}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: kbAutoGenRunning ? "#06B6D4" : "#81C784", fontFamily: "'Space Grotesk', sans-serif" }}>
                  {kbAutoGenRunning ? "AI is generating essential documentation..." : "Documentation generation complete!"}
                </div>
                <div style={{ fontSize: 10, color: "#5A6178", marginTop: 2 }}>{kbAutoGenProgress.status}</div>
              </div>
            </div>
            {kbAutoGenProgress.total > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#5A6178", marginBottom: 4 }}>
                  <span>{kbAutoGenProgress.done} of {kbAutoGenProgress.total} documents</span>
                  <span>{Math.round((kbAutoGenProgress.done / kbAutoGenProgress.total) * 100)}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: "#1E2130", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 3, background: "linear-gradient(90deg, #6366F1, #06B6D4)", width: `${Math.round((kbAutoGenProgress.done / kbAutoGenProgress.total) * 100)}%`, transition: "width 0.5s ease" }} />
                </div>
              </div>
            )}
            {kbAutoGenProgress.current && (
              <div style={{ fontSize: 10, color: "#8B92A8", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ animation: "pulse 1.2s ease-in-out infinite" }}>📝</span> Currently generating: <strong style={{ color: "#C4CAD6" }}>{kbAutoGenProgress.current}</strong>
              </div>
            )}
          </div>
        )}

        {kbEntries.filter(e => e.type === "guide" || e.type === "sharepoint-doc" || e.source === "ai-generated" || e.source === "sharepoint" || e.fileName).length === 0 && !kbAutoGenRunning ? (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "#5A6178" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🤖</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#C4CAD6", marginBottom: 8 }}>No generated documents yet</div>
            <div style={{ fontSize: 12, marginBottom: 16 }}>AI can automatically generate essential IT documentation based on your SharePoint Helpdesk library and common use cases.</div>
            <button onClick={autoGenerateEssentialDocs} style={{
              ...btnStyle("#6366F1"), padding: "12px 24px", fontSize: 13, fontWeight: 700,
              background: "linear-gradient(135deg, #6366F1, #06B6D4)",
              display: "inline-flex", alignItems: "center", gap: 8
            }}>🤖 Auto-Generate Essential Documentation</button>
            <div style={{ fontSize: 10, color: "#5A6178", marginTop: 10 }}>AI will generate 6 essential guides (VPN, Password Reset, MFA, Onboarding, Email, Incident Response) — just review & approve.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {kbEntries.filter(e => e.type === "guide" || e.type === "sharepoint-doc" || e.source === "ai-generated" || e.source === "sharepoint" || e.fileName).map(doc => (
              <div key={doc.id} style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 16, cursor: "pointer", transition: "all 0.2s" }}
                onMouseOver={e => e.currentTarget.style.borderColor = "#6366F133"}
                onMouseOut={e => e.currentTarget.style.borderColor = "#1E2130"}
                onClick={() => { setKbDocPreview(doc); setKbVersionHistory([]); }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                      {doc.source === "sharepoint" ? "📂" : doc.fileName ? "📎" : doc.type === "guide" ? "🤖" : "📄"} {doc.title}
                      {doc.version && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#FFB34718", color: "#FFB347" }}>v{doc.version}</span>}
                    </div>
                    <div style={{ fontSize: 10, color: "#5A6178", display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <span>📁 {doc.category}</span>
                      <span>📝 {(doc.content || "").length.toLocaleString()} chars</span>
                      <span>🕐 {new Date(doc.createdAt).toLocaleDateString("en-SG")}</span>
                      <span>👤 {doc.trainedBy || doc.updatedBy}</span>
                      {doc.fileName && <span>📎 {doc.fileName}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={e => { e.stopPropagation(); exportToWord(doc.content, doc.title); }} style={{ ...btnStyle("#2B579A"), fontSize: 9, padding: "3px 8px" }} title="Export to Word">📄</button>
                    <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(doc.content); }} style={{ ...btnStyle("#06B6D4"), fontSize: 9, padding: "3px 8px" }} title="Copy content">📋</button>
                    <button onClick={e => { e.stopPropagation(); deleteKbEntry(doc.id); }} style={{ ...btnStyle("#FF6B6B"), fontSize: 9, padding: "3px 8px" }} title="Delete">🗑</button>
                  </div>
                </div>
                {(doc.tags || []).length > 0 && (
                  <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                    {doc.tags.slice(0, 8).map((tag, i) => (
                      <span key={i} style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#1E213044", color: "#5A6178" }}>#{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )}

    {/* ─── Tab: KB Gaps Analysis ──────────────────────────── */}
    {kpActiveTab === "gaps" && (
      <div>
        <div style={{ background: "linear-gradient(135deg, #8B5CF608, #EC489908)", borderRadius: 10, border: "1px solid #8B5CF633", padding: 24, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #8B5CF6, #EC4899)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🔍</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>KB Coverage Gap Analysis</div>
              <div style={{ fontSize: 11, color: "#5A6178" }}>AI analyzes recent incidents vs KB articles to identify missing documentation topics</div>
            </div>
            <button style={{ ...btnStyle("#8B5CF6"), fontSize: 11, padding: "8px 16px" }} onClick={async () => {
              showToast("⏳ Analyzing KB coverage gaps...", "info");
              try {
                const resp = await fetch("/api/ai/kb-gaps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestedBy: currentUser?.name || "Engineer" }) });
                const data = await resp.json();
                if (data.gaps) {
                  setKbGapReport(data);
                  showToast(`🔍 Found ${data.gaps.length} gap(s), coverage: ${data.coverageScore}%`, data.gaps.length > 0 ? "warning" : "success");
                } else {
                  showToast(`❌ ${data.error || "Analysis failed"}`, "error");
                }
              } catch (err) { showToast(`❌ ${err.message}`, "error"); }
            }}>🔍 Run Gap Analysis</button>
          </div>
          {kbGapReport && (
            <div>
              <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
                <div style={{ flex: 1, background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #1E213044" }}>
                  <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 4 }}>Coverage Score</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: kbGapReport.coverageScore >= 80 ? "#4CAF50" : kbGapReport.coverageScore >= 50 ? "#FFB347" : "#FF4444", fontFamily: "'Space Grotesk', sans-serif" }}>{kbGapReport.coverageScore}%</div>
                </div>
                <div style={{ flex: 1, background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #1E213044" }}>
                  <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 4 }}>Gaps Found</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#EC4899", fontFamily: "'Space Grotesk', sans-serif" }}>{kbGapReport.gaps.length}</div>
                </div>
                <div style={{ flex: 1, background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #1E213044" }}>
                  <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 4 }}>Incidents Analyzed</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#64B5F6", fontFamily: "'Space Grotesk', sans-serif" }}>{kbGapReport.totalIncidents}</div>
                </div>
                <div style={{ flex: 1, background: "#0A0C14", borderRadius: 8, padding: 14, border: "1px solid #1E213044" }}>
                  <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 4 }}>KB Articles</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#81C784", fontFamily: "'Space Grotesk', sans-serif" }}>{kbGapReport.totalKbArticles}</div>
                </div>
              </div>
              {kbGapReport.summary && <div style={{ fontSize: 12, color: "#C4CAD6", marginBottom: 16, padding: "10px 14px", background: "#0A0C14", borderRadius: 6, border: "1px solid #1E213044" }}>{kbGapReport.summary}</div>}
              {kbGapReport.gaps.length === 0 ? (
                <div style={{ textAlign: "center", padding: 20, color: "#4CAF50", fontSize: 13 }}>✅ No significant KB gaps detected — your documentation coverage is excellent!</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {kbGapReport.gaps.map((gap, i) => (
                    <div key={i} style={{ background: "#0F1117", borderRadius: 8, border: `1px solid ${gap.severity === "high" ? "#FF444433" : gap.severity === "medium" ? "#FFB34733" : "#1E2130"}`, padding: 16 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: gap.severity === "high" ? "#FF444422" : gap.severity === "medium" ? "#FFB34722" : "#4CAF5022", color: gap.severity === "high" ? "#FF6B6B" : gap.severity === "medium" ? "#FFB347" : "#4CAF50", fontWeight: 600, textTransform: "uppercase" }}>{gap.severity}</span>
                          <span style={{ fontSize: 10, color: "#5A6178" }}>{gap.category}</span>
                        </div>
                        <span style={{ fontSize: 10, color: "#64B5F6", fontFamily: "'JetBrains Mono', monospace" }}>~{gap.incidentCount} incidents</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#E8ECF4", marginBottom: 4 }}>{gap.suggestedTitle || gap.topic}</div>
                      <div style={{ fontSize: 11, color: "#8B92A8" }}>{gap.reason}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {!kbGapReport && (
            <div style={{ textAlign: "center", padding: "30px 20px", color: "#5A6178" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
              <div style={{ fontSize: 13, color: "#C4CAD6", marginBottom: 6 }}>No gap analysis run yet</div>
              <div style={{ fontSize: 11 }}>Click "Run Gap Analysis" to identify documentation topics that need coverage</div>
            </div>
          )}
        </div>
      </div>
    )}

    {/* ─── Tab: Articles (existing) ──────────────────────────── */}
    {kpActiveTab === "articles" && (<>

    {/* Search & Filters */}
    <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <SearchBar value={search} onChange={setSearch} placeholder="Search articles, tags, symptoms..." />
      </div>
      <select style={{ ...inputStyle, width: "auto", minWidth: 130, cursor: "pointer" }} value={kbCategoryFilter} onChange={e => setKbCategoryFilter(e.target.value)}>
        {uniqueCategories.map(c => <option key={c} value={c}>{c === "All" ? "📁 All Categories" : `${catMeta(c).icon} ${c}`}</option>)}
      </select>
      <select style={{ ...inputStyle, width: "auto", minWidth: 120, cursor: "pointer" }} value={kbTypeFilter} onChange={e => setKbTypeFilter(e.target.value)}>
        <option value="All">🎯 All Types</option>
        <option value="Incident">🎫 Incident</option>
        <option value="Request">📋 Request</option>
        <option value="Change">🔄 Change</option>
      </select>
      <div style={{ display: "flex", gap: 2, background: "#0A0C14", borderRadius: 6, border: "1px solid #1E2130", padding: 2 }}>
        <button onClick={() => setKbViewMode("cards")} style={{ padding: "4px 10px", fontSize: 11, borderRadius: 4, border: "none", background: kbViewMode === "cards" ? "#6366F122" : "transparent", color: kbViewMode === "cards" ? "#6366F1" : "#5A6178", cursor: "pointer" }}>▦ Cards</button>
        <button onClick={() => setKbViewMode("list")} style={{ padding: "4px 10px", fontSize: 11, borderRadius: 4, border: "none", background: kbViewMode === "list" ? "#6366F122" : "transparent", color: kbViewMode === "list" ? "#6366F1" : "#5A6178", cursor: "pointer" }}>☰ List</button>
      </div>
    </div>

    {/* Category Quick Filters */}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
      {KB_CATEGORIES.map(cat => {
        const count = kbArticles.filter(a => a.category === cat.id).length;
        if (count === 0) return null;
        return (
          <button key={cat.id} onClick={() => setKbCategoryFilter(kbCategoryFilter === cat.id ? "All" : cat.id)} style={{
            padding: "5px 12px", borderRadius: 20, fontSize: 11, cursor: "pointer", transition: "all 0.2s",
            background: kbCategoryFilter === cat.id ? `${cat.color}22` : "#0A0C14",
            border: `1px solid ${kbCategoryFilter === cat.id ? cat.color + "66" : "#1E2130"}`,
            color: kbCategoryFilter === cat.id ? cat.color : "#5A6178",
            fontFamily: "'Space Grotesk', sans-serif"
          }}>
            {cat.icon} {cat.label} ({count})
          </button>
        );
      })}
    </div>

    {/* Results Count */}
    <div style={{ fontSize: 11, color: "#5A6178", marginBottom: 12, fontFamily: "'JetBrains Mono', monospace" }}>
      Showing {filteredKB.length} of {kbArticles.length} articles {search && `· matching "${search}"`}
    </div>

    {/* Knowledge Cards Grid */}
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: kbViewMode === "cards" ? "repeat(auto-fill, minmax(380px, 1fr))" : "1fr" }}>
      {filteredKB.map(art => {
        const cm = catMeta(art.category);
        const spArticleUrl = art.spSlug ? SHAREPOINT_KB_CONFIG.articleUrl(art.spSlug) : SHAREPOINT_KB_CONFIG.baseUrl;
        const spDocUrl = art.spDocPath ? SHAREPOINT_KB_CONFIG.docUrl(art.spDocPath) : null;

        return (
        <div key={art.id} style={{
          background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130",
          padding: 0, cursor: "pointer", transition: "all 0.25s", overflow: "hidden",
          display: "flex", flexDirection: "column"
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = cm.color + "55"; e.currentTarget.style.boxShadow = `0 4px 20px ${cm.color}11`; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#1E2130"; e.currentTarget.style.boxShadow = "none"; }}
        >
          {/* Card Header */}
          <div style={{ padding: "14px 18px 10px", borderBottom: "1px solid #1E213044" }} onClick={() => { setDetailItem(art); setModal("kbDetail"); }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ color: cm.color, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", background: `${cm.color}11`, padding: "2px 6px", borderRadius: 4, border: `1px solid ${cm.color}22` }}>{art.id}</span>
                <Badge color={{ bg: `${cm.color}18`, text: cm.color }}>{cm.icon} {art.category}</Badge>
                {art.bestFor && <Badge color={{ bg: art.bestFor === "Incident" ? "#FF6B6B18" : art.bestFor === "Change" ? "#FFB34718" : "#81C78418", text: art.bestFor === "Incident" ? "#FF6B6B" : art.bestFor === "Change" ? "#FFB347" : "#81C784" }}>{art.bestFor}</Badge>}
                {art.source === "ai-incident-learning" && <Badge color={{ bg: "#7C3AED18", text: "#C084FC" }}>🧠 AI Learned</Badge>}
                {art.aiGenerated && !art.source && <Badge color={{ bg: "#06B6D418", text: "#22D3EE" }}>🤖 AI Generated</Badge>}
                {art.sourceTicketId && <Badge color={{ bg: "#FFB34718", text: "#FFB347" }}>📎 {art.sourceTicketId}</Badge>}
              </div>
              <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" }}>{art.updated}</div>
            </div>
            <div style={{ color: "#E8ECF4", fontSize: 14, fontWeight: 700, marginBottom: 6, fontFamily: "'Space Grotesk', sans-serif", lineHeight: 1.3 }}>{art.title}</div>
            <div style={{ color: "#5A6178", fontSize: 12, lineHeight: 1.5, marginBottom: 8 }}>{art.content}</div>
            {art.whenToUse && <div style={{ fontSize: 11, color: "#A0AEC0", background: "#0A0C14", padding: "6px 10px", borderRadius: 6, marginBottom: 8, lineHeight: 1.4 }}>💡 <strong style={{ color: "#C4CAD6" }}>When to use:</strong> {art.whenToUse}</div>}
          </div>

          {/* Quick Fix Section */}
          {Array.isArray(art.quickFix) && art.quickFix.length > 0 && (
            <div style={{ padding: "10px 18px", borderBottom: "1px solid #1E213044", background: "#0A0C1488" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6366F1", marginBottom: 6, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1 }}>⚡ Quick Fix Steps</div>
              {art.quickFix.slice(0, kbViewMode === "list" ? 5 : 3).map((step, si) => (
                <div key={si} style={{ display: "flex", gap: 6, marginBottom: 3, fontSize: 11, color: "#C4CAD6", lineHeight: 1.5 }}>
                  <span style={{ color: "#6366F1", fontWeight: 700, minWidth: 14, fontFamily: "'JetBrains Mono', monospace" }}>{si + 1}.</span>
                  <span>{step}</span>
                </div>
              ))}
              {art.quickFix.length > (kbViewMode === "list" ? 5 : 3) && <div style={{ fontSize: 10, color: "#5A6178", marginTop: 2 }}>+{art.quickFix.length - (kbViewMode === "list" ? 5 : 3)} more steps...</div>}
            </div>
          )}

          {/* Card Footer */}
          <div style={{ padding: "10px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
            <div style={{ display: "flex", gap: 14, fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>
              <span>👁 {art.views}</span>
              <span>👍 {art.helpful}%</span>
              {art.author && <span>✍️ {art.author}</span>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {Array.isArray(art.relatedArticles) && art.relatedArticles.length > 0 && (
                <span style={{ fontSize: 9, color: "#5A6178", padding: "2px 6px", background: "#0A0C14", borderRadius: 4, border: "1px solid #1E213066" }}>🔗 {art.relatedArticles.length} related</span>
              )}
              <button onClick={e => { e.stopPropagation(); window.open(spArticleUrl, "_blank", "noopener"); }} style={{
                padding: "4px 10px", fontSize: 10, borderRadius: 6, border: "1px solid #0078D433",
                background: "#0078D418", color: "#0078D4", cursor: "pointer", fontWeight: 600,
                fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 4, transition: "all 0.2s"
              }}
              onMouseOver={e => e.currentTarget.style.background = "#0078D433"}
              onMouseOut={e => e.currentTarget.style.background = "#0078D418"}>
                📎 Open in SharePoint
              </button>
            </div>
          </div>

          {/* Tags */}
          {Array.isArray(art.tags) && art.tags.length > 0 && (
            <div style={{ padding: "0 18px 10px", display: "flex", gap: 4, flexWrap: "wrap" }}>
              {art.tags.slice(0, 6).map((tag, ti) => (
                <span key={ti} onClick={e => { e.stopPropagation(); setSearch(tag); }} style={{
                  fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#1E213044",
                  color: "#5A6178", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace",
                  border: "1px solid transparent", transition: "all 0.15s"
                }}
                onMouseOver={e => { e.currentTarget.style.borderColor = "#6366F133"; e.currentTarget.style.color = "#6366F1"; }}
                onMouseOut={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.color = "#5A6178"; }}>
                  #{tag}
                </span>
              ))}
              {art.tags.length > 6 && <span style={{ fontSize: 9, color: "#5A6178" }}>+{art.tags.length - 6}</span>}
            </div>
          )}
        </div>
        );
      })}
    </div>

    {filteredKB.length === 0 && (
      <div style={{ textAlign: "center", padding: "60px 20px", color: "#5A6178" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#C4CAD6", marginBottom: 4 }}>No articles found</div>
        <div style={{ fontSize: 12 }}>Try adjusting your search or filters. <button onClick={() => { setSearch(""); setKbCategoryFilter("All"); setKbTypeFilter("All"); }} style={{ background: "none", border: "none", color: "#6366F1", cursor: "pointer", textDecoration: "underline", fontSize: 12 }}>Clear all filters</button></div>
      </div>
    )}

    {/* KB Stats Footer */}
    <div style={{ marginTop: 20, padding: "14px 18px", background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
      <div style={{ display: "flex", gap: 20, fontSize: 11, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", flexWrap: "wrap" }}>
        <span>📊 Total: {kbArticles.length} articles</span>
        <span>👁 {kbArticles.reduce((s, a) => s + a.views, 0).toLocaleString()} total views</span>
        <span>👍 {kbArticles.length > 0 ? Math.round(kbArticles.reduce((s, a) => s + a.helpful, 0) / kbArticles.length) : 0}% avg helpful</span>
        <span>✍️ {new Set(kbArticles.map(a => a.author).filter(Boolean)).size} contributors</span>
        <span>🤖 {kbEntries.filter(e => e.source === "ai-generated" || e.source === "sharepoint" || e.fileName).length} AI-generated docs</span>
        <span>📤 {kbEntries.filter(e => e.fileName).length} uploaded</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button onClick={() => window.open(SHAREPOINT_KB_CONFIG.helpdeskLibraryUrl, "_blank", "noopener")} style={{ padding: "4px 12px", fontSize: 10, borderRadius: 6, border: "1px solid #0078D433", background: "#0078D418", color: "#0078D4", cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>📂 Helpdesk Document Library</button>
        <button onClick={() => window.open(SHAREPOINT_KB_CONFIG.baseUrl, "_blank", "noopener")} style={{ padding: "4px 12px", fontSize: 10, borderRadius: 6, border: "1px solid #0078D433", background: "#0078D408", color: "#0078D4", cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif" }}>🌐 SharePoint Portal</button>
      </div>
    </div>
    </>)}
  </div>
  );
});
return <KnowledgeModule />;
}
