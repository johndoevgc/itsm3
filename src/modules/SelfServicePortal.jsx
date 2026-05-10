import { useState, useMemo, useCallback, useRef } from "react";
import { btnStyle, inputStyle } from "../constants/theme.js";
import { PriorityDot } from "../components/SharedComponents.jsx";
import { genId } from "../utils/slaHelpers.js";
import { KB_CATEGORIES } from "../constants/categories.js";
import CardRenderer from "../components/chat/CardRenderer.jsx";
import { buildChatCards } from "../utils/chatCardBuilder.js";
import { CustomerChatTab } from "../components/CustomerChatTab.jsx";

/* ═══════════════════════════════════════════════════════════════
   Enterprise Knowledge Portal — compact, professional, AI-embedded
   ═══════════════════════════════════════════════════════════════ */
const KB_CAT_MAP = Object.fromEntries(KB_CATEGORIES.map(c => [c.id, c]));
const catMeta = (id) => KB_CAT_MAP[id] || { icon: "📄", color: "#5A6178", label: id || "General" };
const readTime = (text) => { const words = (text || "").split(/\s+/).length; return Math.max(1, Math.ceil(words / 200)); };
// Freshness label — relative time since article was last updated
const freshness = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days < 1) return { label: "Updated today", color: "#22C55E" };
  if (days < 7) return { label: `${days}d ago`, color: "#22C55E" };
  if (days < 30) return { label: `${Math.floor(days/7)}w ago`, color: "#A3E635" };
  if (days < 90) return { label: `${Math.floor(days/30)}mo ago`, color: "#FBBF24" };
  return { label: `${Math.floor(days/30)}mo ago`, color: "#9CA3AF" };
};
const isAiAuthored = (a) => !!(a && (a.aiGenerated || a.source === "ai-incident-learning" || /\bai\b/i.test(a.author || "")));

function KnowledgePortal({ kbArticles, portalSearch, setPortalSearch, setDetailItem: _setDetailItem, setModal: _setModal, showToast: _showToast, currentUser, incidents, setActiveModule }) {
  const [kpCategory, setKpCategory] = useState("all");
  const [kpArticle, setKpArticle] = useState(null);
  const [kpAiQuery, setKpAiQuery] = useState("");
  const [kpAiAnswer, setKpAiAnswer] = useState(null);
  const [kpAiLoading, setKpAiLoading] = useState(false);
  const [kpSortBy, setKpSortBy] = useState("relevance");
  const searchRef = useRef(null);

  // Category counts
  const catCounts = useMemo(() => {
    const counts = { all: (kbArticles || []).length };
    kbArticles.forEach(a => { const c = a.category || "General"; counts[c] = (counts[c] || 0) + 1; });
    return counts;
  }, [kbArticles]);

  // Filtered & sorted articles
  const filtered = useMemo(() => {
    let arts = kbArticles;
    if (kpCategory !== "all") arts = arts.filter(a => a.category === kpCategory);
    if (portalSearch) {
      const q = portalSearch.toLowerCase();
      arts = arts.filter(a =>
        a.title?.toLowerCase().includes(q) ||
        a.content?.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q) ||
        (a.tags || []).some(t => t.toLowerCase().includes(q)) ||
        a.whenToUse?.toLowerCase().includes(q)
      );
    }
    if (kpSortBy === "newest") arts = [...arts].sort((a, b) => (b.updated || b.createdAt || "").localeCompare(a.updated || a.createdAt || ""));
    if (kpSortBy === "title") arts = [...arts].sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    return arts;
  }, [kbArticles, kpCategory, portalSearch, kpSortBy]);

  // Featured articles (first 3 with most content)
  const featured = useMemo(() => [...kbArticles].sort((a, b) => (b.content || "").length - (a.content || "").length).slice(0, 3), [kbArticles]);

  // AI Ask handler
  const askAI = useCallback(async () => {
    if (!kpAiQuery.trim()) return;
    setKpAiLoading(true);
    setKpAiAnswer(null);
    // Build customer-focused cards for the query
    const cardCtx = { incidents: incidents || [], currentUser, kbArticles, changes: [], problems: [], requests: [], proactiveAlerts: [] };
    const { cards: aiCards } = buildChatCards(kpAiQuery, cardCtx);
    try {
      const resp = await fetch("/api/ai/knowledge/search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: kpAiQuery, topK: 3 })
      });
      const data = await resp.json();
      if (data.answer || data.results) {
        setKpAiAnswer({ answer: data.answer || "Here are the most relevant articles:", results: data.results || [], query: kpAiQuery, cards: aiCards });
      } else {
        setKpAiAnswer({ answer: "I couldn't find a specific answer. Try browsing the categories below.", results: [], query: kpAiQuery, cards: aiCards });
      }
    } catch {
      setKpAiAnswer({ answer: "AI search is temporarily unavailable. Please browse articles manually.", results: [], query: kpAiQuery, cards: aiCards });
    }
    setKpAiLoading(false);
  }, [kpAiQuery, incidents, currentUser, kbArticles]);

  // ─── Article Reader View ───
  if (kpArticle) {
    const cm = catMeta(kpArticle.category);
    const sections = (kpArticle.content || "").split(/\n(?=#{1,3}\s)/).filter(Boolean);
    const relatedArts = kbArticles.filter(a => a.id !== kpArticle.id && a.category === kpArticle.category).slice(0, 4);
    return (
      <div>
        {/* Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16, fontSize: 12, color: "#5A6178" }}>
          <span style={{ cursor: "pointer", color: "#6366F1" }} onClick={() => setKpArticle(null)}>Knowledge Base</span>
          <span>›</span>
          <span style={{ cursor: "pointer", color: "#6366F1" }} onClick={() => { setKpArticle(null); setKpCategory(kpArticle.category); }}>{cm.icon} {cm.label}</span>
          <span>›</span>
          <span style={{ color: "#8B92A8" }}>{kpArticle.id}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 20 }}>
          {/* Main Article */}
          <div style={{ background: "#0F1117", borderRadius: 12, border: "1px solid #1E2130", overflow: "hidden" }}>
            {/* Article Header */}
            <div style={{ padding: "28px 32px 20px", borderBottom: "1px solid #1E2130", background: `linear-gradient(135deg, ${cm.color}06, transparent)` }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 12, background: `${cm.color}18`, color: cm.color, fontWeight: 600 }}>{cm.icon} {cm.label}</span>
                {kpArticle.status && <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 12, background: kpArticle.status === "Published" ? "#4CAF5018" : "#FFB34718", color: kpArticle.status === "Published" ? "#4CAF50" : "#FFB347", fontWeight: 600 }}>{kpArticle.status}</span>}
                {kpArticle.bestFor && <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 12, background: "#6366F118", color: "#818CF8" }}>Best for: {kpArticle.bestFor}</span>}
                {(() => { const f = freshness(kpArticle.updated || kpArticle.createdAt); return f ? <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 12, background: f.color + "18", color: f.color, fontWeight: 600 }}>● {f.label}</span> : null; })()}
                {isAiAuthored(kpArticle) && <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 12, background: "#7C3AED18", color: "#C084FC", fontWeight: 600 }} title="Curated/refreshed by AI from real ticket and email patterns">🧠 AI-curated · auto-updates from tickets</span>}
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: "#F1F5F9", fontFamily: "'Space Grotesk', sans-serif", margin: 0, lineHeight: 1.3 }}>{kpArticle.title}</h1>
              <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 11, color: "#5A6178" }}>
                <span>✏️ {kpArticle.author || "System"}</span>
                <span>🕐 {kpArticle.updated || kpArticle.createdAt || "—"}</span>
                <span>📖 {readTime(kpArticle.content)} min read</span>
                {kpArticle.views != null && <span>👁 {kpArticle.views} views</span>}
              </div>
              {kpArticle.whenToUse && (
                <div style={{ marginTop: 14, padding: "10px 14px", background: "#6366F108", border: "1px solid #6366F122", borderRadius: 8, fontSize: 12, color: "#A0AEC0", lineHeight: 1.5 }}>
                  💡 <strong style={{ color: "#C4CAD6" }}>When to use:</strong> {kpArticle.whenToUse}
                </div>
              )}
            </div>

            {/* Quick Fix Steps */}
            {Array.isArray(kpArticle.quickFix) && kpArticle.quickFix.length > 0 && (
              <div style={{ padding: "16px 32px", borderBottom: "1px solid #1E2130", background: "#0A0C1466" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#06B6D4", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace" }}>⚡ Quick Fix</div>
                {kpArticle.quickFix.map((step, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, marginBottom: 6, fontSize: 13, color: "#C4CAD6", lineHeight: 1.6 }}>
                    <span style={{ color: "#06B6D4", fontWeight: 700, minWidth: 20, fontFamily: "'JetBrains Mono', monospace" }}>{i + 1}.</span>
                    <span>{typeof step === "string" ? step : step.step || step}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Article Content */}
            <div style={{ padding: "24px 32px 32px", fontSize: 13.5, color: "#C4CAD6", lineHeight: 1.85, fontFamily: "'DM Sans', sans-serif" }}>
              {sections.map((sec, i) => {
                const headMatch = sec.match(/^(#{1,3})\s+(.+)/);
                if (headMatch) {
                  const level = headMatch[1].length;
                  const title = headMatch[2];
                  const body = sec.replace(/^#{1,3}\s+.+\n?/, "").trim();
                  return (
                    <div key={i} style={{ marginBottom: 20 }}>
                      <h2 style={{ fontSize: level === 1 ? 18 : level === 2 ? 15 : 13, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", margin: "24px 0 8px", borderBottom: level <= 2 ? "1px solid #1E2130" : "none", paddingBottom: level <= 2 ? 8 : 0 }}>{title}</h2>
                      <div style={{ whiteSpace: "pre-wrap" }}>{body}</div>
                    </div>
                  );
                }
                return <div key={i} style={{ whiteSpace: "pre-wrap", marginBottom: 16 }}>{sec}</div>;
              })}
            </div>

            {/* Tags */}
            {(kpArticle.tags || []).length > 0 && (
              <div style={{ padding: "12px 32px 20px", borderTop: "1px solid #1E2130", display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, color: "#5A6178", marginRight: 4 }}>Tags:</span>
                {kpArticle.tags.map((tag, i) => (
                  <span key={i} onClick={() => { setKpArticle(null); setPortalSearch(tag); }} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "#1E2130", color: "#8B92A8", cursor: "pointer", transition: "all 0.15s" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "#6366F122"; e.currentTarget.style.color = "#818CF8"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "#1E2130"; e.currentTarget.style.color = "#8B92A8"; }}>
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Table of Contents */}
            <div style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", padding: 16, position: "sticky", top: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6366F1", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace" }}>📑 Contents</div>
              {sections.filter(s => /^#{1,3}\s/.test(s)).map((s, i) => {
                const m = s.match(/^(#{1,3})\s+(.+)/);
                if (!m) return null;
                return (
                  <div key={i} style={{ fontSize: 11, color: "#8B92A8", padding: "4px 0", paddingLeft: (m[1].length - 1) * 12, cursor: "pointer", transition: "color 0.15s", lineHeight: 1.4 }}
                    onMouseEnter={e => e.currentTarget.style.color = "#E8ECF4"}
                    onMouseLeave={e => e.currentTarget.style.color = "#8B92A8"}>
                    {m[2]}
                  </div>
                );
              })}
            </div>

            {/* Article Info Card */}
            <div style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#5A6178", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Article Info</div>
              {[
                ["ID", kpArticle.id],
                ["Category", `${cm.icon} ${cm.label}`],
                ["Author", kpArticle.author || "System"],
                ["Updated", kpArticle.updated || "—"],
                ["Read Time", `${readTime(kpArticle.content)} min`],
                ["Words", `${(kpArticle.content || "").split(/\s+/).length.toLocaleString()}`],
              ].map(([label, val]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "4px 0", borderBottom: "1px solid #1E213044" }}>
                  <span style={{ color: "#5A6178" }}>{label}</span>
                  <span style={{ color: "#C4CAD6", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>{val}</span>
                </div>
              ))}
            </div>

            {/* Related Articles */}
            {relatedArts.length > 0 && (
              <div style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#5A6178", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Related Articles</div>
                {relatedArts.map(ra => (
                  <div key={ra.id} onClick={() => setKpArticle(ra)} style={{ padding: "8px 0", borderBottom: "1px solid #1E213044", cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.querySelector(".ra-title").style.color = "#6366F1"}
                    onMouseLeave={e => e.currentTarget.querySelector(".ra-title").style.color = "#C4CAD6"}>
                    <div className="ra-title" style={{ fontSize: 11, color: "#C4CAD6", fontWeight: 600, lineHeight: 1.3, transition: "color 0.15s" }}>{ra.title}</div>
                    <div style={{ fontSize: 9, color: "#5A6178", marginTop: 2 }}>{catMeta(ra.category).icon} {ra.category} · {readTime(ra.content)} min read</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Portal Home View ───
  return (
    <div>
      {/* Hero Section with AI Search */}
      <div style={{ background: "linear-gradient(135deg, #6366F10A, #06B6D40A, #8B5CF60A)", borderRadius: 14, border: "1px solid #6366F122", padding: "32px 28px 24px", marginBottom: 20, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -40, right: -40, width: 160, height: 160, borderRadius: "50%", background: "radial-gradient(circle, #6366F108, transparent)", pointerEvents: "none" }} />
        <div style={{ textAlign: "center", marginBottom: 20, position: "relative" }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#F1F5F9", fontFamily: "'Space Grotesk', sans-serif", margin: "0 0 6px" }}>Knowledge Base</h2>
          <p style={{ fontSize: 12, color: "#5A6178", margin: 0 }}>Search our library or ask AI for instant answers</p>
        </div>

        {/* AI-Powered Search Bar */}
        <div style={{ display: "flex", gap: 8, maxWidth: 600, margin: "0 auto", position: "relative" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input ref={searchRef} style={{ ...inputStyle, paddingLeft: 36, paddingRight: 12, fontSize: 13, height: 42, borderRadius: 10, background: "#0A0C14", border: "1px solid #1E2130" }}
              placeholder="Ask a question or search articles..."
              value={kpAiQuery || portalSearch}
              onChange={e => { setKpAiQuery(e.target.value); setPortalSearch(e.target.value); }}
              onKeyDown={e => { if (e.key === "Enter" && kpAiQuery.trim()) askAI(); }}
            />
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, pointerEvents: "none" }}>🔍</span>
          </div>
          <button onClick={askAI} disabled={kpAiLoading || !kpAiQuery.trim()} style={{ ...btnStyle("#6366F1"), fontSize: 12, padding: "0 20px", height: 42, borderRadius: 10, display: "flex", alignItems: "center", gap: 6, background: "linear-gradient(135deg, #6366F1, #8B5CF6)", opacity: kpAiLoading || !kpAiQuery.trim() ? 0.5 : 1 }}>
            {kpAiLoading ? "⏳" : "🤖"} Ask AI
          </button>
        </div>

        {/* AI Answer Panel */}
        {kpAiAnswer && (
          <div style={{ marginTop: 16, background: "#0A0C14", borderRadius: 10, border: "1px solid #6366F133", padding: 18, maxWidth: 600, marginLeft: "auto", marginRight: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 16 }}>🤖</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#818CF8", fontFamily: "'JetBrains Mono', monospace" }}>AI Answer</span>
              </div>
              <button onClick={() => setKpAiAnswer(null)} style={{ background: "none", border: "none", color: "#5A6178", cursor: "pointer", fontSize: 12 }}>✕</button>
            </div>
            <div style={{ fontSize: 13, color: "#C4CAD6", lineHeight: 1.7, marginBottom: kpAiAnswer.results?.length ? 12 : 0 }}>{kpAiAnswer.answer}</div>
            {/* AI Interactive Cards for customer self-service */}
            {kpAiAnswer.cards && kpAiAnswer.cards.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <CardRenderer cards={kpAiAnswer.cards} onAction={(action) => {
                  if (action.type === "CHAT_REPLY") { setKpAiQuery(action.payload || action.text || ""); }
                  else if (action.type === "NAVIGATE" && action.target) { setActiveModule?.(action.target); }
                }} />
              </div>
            )}
            {kpAiAnswer.results?.length > 0 && (
              <div style={{ borderTop: "1px solid #1E2130", paddingTop: 10 }}>
                <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 6 }}>Related articles:</div>
                {kpAiAnswer.results.slice(0, 3).map((r, i) => {
                  const matchedArt = kbArticles.find(a => a.id === r.id || a.title === r.title);
                  return (
                    <div key={i} onClick={() => matchedArt && setKpArticle(matchedArt)} style={{ padding: "6px 10px", borderRadius: 6, marginBottom: 4, background: "#1E213044", cursor: matchedArt ? "pointer" : "default", transition: "background 0.15s" }}
                      onMouseEnter={e => matchedArt && (e.currentTarget.style.background = "#6366F111")}
                      onMouseLeave={e => e.currentTarget.style.background = "#1E213044"}>
                      <div style={{ fontSize: 12, color: "#E8ECF4", fontWeight: 600 }}>{r.title}</div>
                      {r.score != null && <div style={{ fontSize: 9, color: "#5A6178" }}>Relevance: {Math.round(r.score * 100)}%</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Category Navigation */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={() => setKpCategory("all")} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.2s", background: kpCategory === "all" ? "#6366F118" : "#0A0C14", border: `1px solid ${kpCategory === "all" ? "#6366F144" : "#1E2130"}`, color: kpCategory === "all" ? "#818CF8" : "#5A6178", fontFamily: "'Space Grotesk', sans-serif" }}>
          📁 All ({catCounts.all || 0})
        </button>
        {KB_CATEGORIES.map(cat => {
          const cnt = catCounts[cat.id] || 0;
          if (cnt === 0) return null;
          return (
            <button key={cat.id} onClick={() => setKpCategory(kpCategory === cat.id ? "all" : cat.id)} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.2s", background: kpCategory === cat.id ? `${cat.color}18` : "#0A0C14", border: `1px solid ${kpCategory === cat.id ? cat.color + "44" : "#1E2130"}`, color: kpCategory === cat.id ? cat.color : "#5A6178", fontFamily: "'Space Grotesk', sans-serif" }}>
              {cat.icon} {cat.label} ({cnt})
            </button>
          );
        })}
      </div>

      {/* Featured Articles (only when no search/filter active) */}
      {kpCategory === "all" && !portalSearch && featured.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", marginBottom: 12, fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 6 }}>⭐ Featured Articles</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {featured.map(art => {
              const cm = catMeta(art.category);
              return (
                <div key={art.id} onClick={() => setKpArticle(art)} style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", padding: 18, cursor: "pointer", transition: "all 0.2s", position: "relative", overflow: "hidden" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = cm.color + "44"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 8px 24px ${cm.color}11`; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#1E2130"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${cm.color}, transparent)` }} />
                  <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                    <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: `${cm.color}18`, color: cm.color, fontWeight: 600 }}>{cm.icon} {cm.label}</span>
                    <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: "#1E2130", color: "#5A6178" }}>📖 {readTime(art.content)} min</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", marginBottom: 6, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{art.title}</div>
                  <div style={{ fontSize: 11, color: "#5A6178", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{(art.content || "").replace(/^#.*\n*/gm, "").substring(0, 150)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sort Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>
          {filtered.length} article{filtered.length !== 1 ? "s" : ""}{portalSearch ? ` matching "${portalSearch}"` : ""}
        </div>
        <div style={{ display: "flex", gap: 4, background: "#0A0C14", borderRadius: 6, border: "1px solid #1E2130", padding: 2 }}>
          {[["relevance", "Relevant"], ["newest", "Newest"], ["title", "A–Z"]].map(([val, label]) => (
            <button key={val} onClick={() => setKpSortBy(val)} style={{ padding: "4px 10px", fontSize: 10, borderRadius: 4, border: "none", cursor: "pointer", background: kpSortBy === val ? "#6366F118" : "transparent", color: kpSortBy === val ? "#818CF8" : "#5A6178", fontWeight: 600 }}>{label}</button>
          ))}
        </div>
      </div>

      {/* Article List */}
      <div style={{ display: "grid", gap: 8 }}>
        {filtered.map(art => {
          const cm = catMeta(art.category);
          return (
            <div key={art.id} onClick={() => setKpArticle(art)} style={{ background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130", padding: "16px 20px", cursor: "pointer", transition: "all 0.2s", display: "flex", gap: 16, alignItems: "flex-start" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#6366F133"; e.currentTarget.style.background = "#0F111Bcc"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#1E2130"; e.currentTarget.style.background = "#0F1117"; }}>
              {/* Category Icon */}
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `${cm.color}12`, border: `1px solid ${cm.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{cm.icon}</div>
              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", lineHeight: 1.3 }}>{art.title}</span>
                </div>
                <div style={{ fontSize: 12, color: "#5A6178", lineHeight: 1.5, marginBottom: 6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {art.whenToUse || (art.content || "").replace(/^#.*\n*/gm, "").substring(0, 160)}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: `${cm.color}14`, color: cm.color, fontWeight: 600 }}>{cm.label}</span>
                  {art.bestFor && <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: "#1E2130", color: "#8B92A8" }}>{art.bestFor === "Incident" ? "🎫" : art.bestFor === "Change" ? "🔄" : "📋"} {art.bestFor}</span>}
                  {(art.tags || []).slice(0, 3).map((tag, i) => (
                    <span key={i} style={{ fontSize: 9, padding: "2px 6px", borderRadius: 8, background: "#1E213066", color: "#5A6178" }}>#{tag}</span>
                  ))}
                </div>
              </div>
              {/* Meta */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{art.id}</span>
                <span style={{ fontSize: 10, color: "#5A6178" }}>📖 {readTime(art.content)} min</span>
                {(() => { const f = freshness(art.updated || art.createdAt); return f ? <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 6, background: f.color + "18", color: f.color, fontWeight: 600 }}>● {f.label}</span> : null; })()}
                {isAiAuthored(art) && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 6, background: "#7C3AED14", color: "#C084FC", fontWeight: 600 }} title="Generated or refreshed by AI from recent ticket trends">🧠 AI-curated</span>}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "#5A6178" }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📚</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#C4CAD6", marginBottom: 6 }}>No articles found</div>
          <div style={{ fontSize: 12 }}>{portalSearch ? `No results for "${portalSearch}". Try a different search term.` : "No articles in this category yet."}</div>
        </div>
      )}
    </div>
  );
}

export default function SelfServicePortal({ currentUser, incidents, setIncidents, requests, problems: _problems, changes: _changes, kbArticles, serviceCatalog, portalTab, setPortalTab, portalSearch, setPortalSearch, setActiveModule, setDetailItem, setModal, showToast }) {
  const [showQuickForm, setShowQuickForm] = useState(false);
  const [qf, setQf] = useState({ title: "", description: "", urgency: "Standard", contactMethod: "Portal" });
  const [qfSubmitting, setQfSubmitting] = useState(false);
  const userEmail = currentUser.email || currentUser.name;
  const myIncidents = (incidents || []).filter(i => i.reporterEmail === userEmail || i.reporter === currentUser.name);
  const myRequests = (requests || []).filter(r => r.requester === currentUser.name || r.requesterEmail === userEmail);
  const openCount = myIncidents.filter(i => !["Resolved","Closed"].includes(i.status)).length + myRequests.filter(r => !["Fulfilled","Cancelled"].includes(r.status)).length;
  const resolvedCount = myIncidents.filter(i => i.status === "Resolved" || i.status === "Closed").length;

  const statusColor = (s) => ({ "New": "#64B5F6", "In Progress": "#FFB347", "Pending": "#FFB347", "Awaiting Info": "#EC4899", "Resolved": "#4CAF50", "Closed": "#5A6178", "Open": "#64B5F6", "Fulfilled": "#4CAF50", "Cancelled": "#FF6B6B" })[s] || "#5A6178";

  // v3.36: SLA status badge for customer transparency
  const slaStatusBadge = (inc) => {
    if (["Resolved", "Closed"].includes(inc.status)) return null;
    const target = inc.slaTarget || 24;
    const created = inc.createdAt || inc.created_at;
    if (!created) return null;
    const hoursElapsed = (Date.now() - new Date(created).getTime()) / 3600000;
    const pct = Math.min(Math.round((hoursElapsed / target) * 100), 999);
    const remaining = Math.max(0, Math.round((target - hoursElapsed) * 10) / 10);
    const slaPaused = inc.slaPaused;
    if (slaPaused) return <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 6, background: "#6366F122", color: "#818CF8", fontWeight: 600 }} title="SLA clock paused">⏸ Paused</span>;
    const color = pct >= 100 ? "#FF4444" : pct >= 80 ? "#FFB347" : "#4CAF50";
    const label = pct >= 100 ? "Overdue" : `${remaining}h left`;
    return <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 6, background: color + "18", color, fontWeight: 600 }} title={`SLA: ${pct}% used (${remaining}h remaining of ${target}h target)`}>{label}</span>;
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      {/* Portal Header */}
      <div style={{ marginBottom: 24, background: "linear-gradient(135deg, #6366F108, #06B6D408)", borderRadius: 12, border: "1px solid #6366F122", padding: 24 }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 20, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>👋 Welcome, {currentUser.name.split(" ")[0]}</h2>
        <p style={{ margin: 0, fontSize: 12, color: "#5A6178" }}>Self-Service IT Portal — Submit requests, track tickets, and browse the knowledge base.</p>
        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <div style={{ background: "#0A0C14", borderRadius: 8, padding: "10px 16px", border: "1px solid #1E2130", flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#FFB347", fontFamily: "'Space Grotesk', sans-serif" }}>{openCount}</div>
            <div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: "0.5px" }}>Open Tickets</div>
          </div>
          <div style={{ background: "#0A0C14", borderRadius: 8, padding: "10px 16px", border: "1px solid #1E2130", flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#4CAF50", fontFamily: "'Space Grotesk', sans-serif" }}>{resolvedCount}</div>
            <div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: "0.5px" }}>Resolved</div>
          </div>
          <div style={{ background: "#0A0C14", borderRadius: 8, padding: "10px 16px", border: "1px solid #1E2130", flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#64B5F6", fontFamily: "'Space Grotesk', sans-serif" }}>{(kbArticles || []).length}</div>
            <div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: "0.5px" }}>KB Articles</div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <button style={{ ...btnStyle(showQuickForm ? "#333" : "#FF6B6B"), padding: "10px 20px", fontSize: 13, fontWeight: 700 }} onClick={() => setShowQuickForm(!showQuickForm)}>{showQuickForm ? "✕ Cancel" : "🎫 Report an Issue"}</button>
        <button style={{ ...btnStyle("#6366F1"), padding: "10px 20px", fontSize: 13, fontWeight: 700 }} onClick={() => setPortalTab("catalog")}>📋 Submit a Request</button>
        <button style={{ ...btnStyle("#06B6D4"), padding: "10px 20px", fontSize: 13, fontWeight: 700 }} onClick={() => setPortalTab("chat")}>💬 Chat with AI</button>
        <a
          href="/docs/Customer-Quick-Guide.html"
          target="_blank"
          rel="noopener noreferrer"
          title="How to log an issue, request a service, and chat with AI"
          style={{
            marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6,
            background: "#1E2130", border: "1px solid #2A2F44", borderRadius: 8,
            padding: "10px 16px", fontSize: 12, color: "#A8B0C4", fontWeight: 600,
            textDecoration: "none", cursor: "pointer",
          }}
        >
          📘 Help
        </a>
      </div>

      {/* ═══ Simplified Quick Issue Form ═══ */}
      {showQuickForm && (
        <div style={{ marginBottom: 20, padding: 20, background: "linear-gradient(135deg, #FF6B6B08, #6366F108)", borderRadius: 12, border: "1px solid #FF6B6B33" }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 15, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>📝 Quick Issue Report</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input style={{ ...inputStyle, fontSize: 14, padding: "10px 14px" }} placeholder="What's the issue? (e.g. Can't access email)" value={qf.title} onChange={e => setQf(p => ({ ...p, title: e.target.value }))} autoFocus />
            <textarea style={{ ...inputStyle, fontSize: 12, padding: "10px 14px", minHeight: 80, resize: "vertical" }} placeholder="Describe what happened and any error messages..." value={qf.description} onChange={e => setQf(p => ({ ...p, description: e.target.value }))} />
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={{ fontSize: 10, color: "#5A6178", display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>How urgent?</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {["Low", "Standard", "High", "Critical"].map(u => (
                    <button key={u} onClick={() => setQf(p => ({ ...p, urgency: u }))} style={{
                      padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
                      background: qf.urgency === u ? (u === "Critical" ? "#FF6B6B22" : u === "High" ? "#FFB34722" : u === "Low" ? "#4CAF5022" : "#6366F122") : "#0A0C14",
                      border: `1px solid ${qf.urgency === u ? (u === "Critical" ? "#FF6B6B" : u === "High" ? "#FFB347" : u === "Low" ? "#4CAF50" : "#6366F1") : "#1E2130"}`,
                      color: qf.urgency === u ? "#E8ECF4" : "#5A6178"
                    }}>{u}</button>
                  ))}
                </div>
              </div>
              <div style={{ minWidth: 140 }}>
                <label style={{ fontSize: 10, color: "#5A6178", display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>Preferred contact</label>
                <select style={{ ...inputStyle, fontSize: 12, padding: "6px 10px" }} value={qf.contactMethod} onChange={e => setQf(p => ({ ...p, contactMethod: e.target.value }))}>
                  <option>Portal</option><option>Email</option><option>Phone</option><option>Teams</option>
                </select>
              </div>
            </div>
            <button style={{ ...btnStyle("#4CAF50"), padding: "10px 20px", fontSize: 13, fontWeight: 700, alignSelf: "flex-start", opacity: qf.title.length >= 3 ? 1 : 0.5 }}
              disabled={qf.title.length < 3 || qfSubmitting}
              onClick={async () => {
                setQfSubmitting(true);
                const urgencyToPriority = { Critical: "Sev-A", High: "Sev-B", Standard: "Sev-C", Low: "Sev-D" };
                const urgencyToSla = { Critical: 4, High: 8, Standard: 24, Low: 48 };
                const now = new Date().toISOString();
                const newInc = {
                  title: qf.title, description: qf.description || qf.title,
                  category: "General", priority: urgencyToPriority[qf.urgency] || "Sev-C",
                  urgency: qf.urgency, impact: "Individual",
                  createdBy: currentUser.name, requesterEmail: userEmail,
                  contactMethod: qf.contactMethod, source: "self_service_portal",
                };
                let createdTicket = null;
                try {
                  const r = await fetch("/api/ai/chat/create-ticket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newInc) });
                  if (r.ok) createdTicket = await r.json();
                  else throw new Error(`HTTP ${r.status}`);
                } catch (err) {
                  if (showToast) showToast(`Failed to submit issue: ${err.message}`, "error");
                  setQfSubmitting(false);
                  return;
                }
                if (createdTicket && setIncidents) {
                  setIncidents(prev => [{ ...newInc, id: createdTicket.id, status: "Open", createdAt: createdTicket.createdAt || now }, ...prev]);
                }
                if (showToast) showToast(`✅ Issue "${qf.title}" submitted as ${createdTicket.id}! We'll get back to you soon.`, "success");
                setQf({ title: "", description: "", urgency: "Standard", contactMethod: "Portal" });
                setShowQuickForm(false);
                setQfSubmitting(false);
              }}>🚀 Submit Issue</button>
          </div>
        </div>
      )}

      {/* Portal Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "#0A0C14", padding: 4, borderRadius: 8 }}>
        {[{ id: "myTickets", label: "My Tickets", icon: "🎫", count: openCount }, { id: "myRequests", label: "My Requests", icon: "📋", count: myRequests.length }, { id: "kb", label: "Knowledge Base", icon: "📚" }, { id: "catalog", label: "Service Catalog", icon: "🛍️" }, { id: "chat", label: "Chat with Support", icon: "💬" }].map(tab => (
          <button key={tab.id} onClick={() => setPortalTab(tab.id)} style={{
            padding: "8px 14px", borderRadius: 6, border: "none", cursor: "pointer",
            background: portalTab === tab.id ? "#1E2130" : "transparent",
            color: portalTab === tab.id ? "#E8ECF4" : "#5A6178",
            fontSize: 12, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif",
            display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s"
          }}>
            <span style={{ fontSize: 14 }}>{tab.icon}</span> {tab.label}
            {tab.count > 0 && <span style={{ background: "#6366F133", color: "#818CF8", padding: "1px 6px", borderRadius: 8, fontSize: 10, fontWeight: 700 }}>{tab.count}</span>}
          </button>
        ))}
      </div>

      {/* My Tickets Tab */}
      {portalTab === "myTickets" && (
        <div>
          {myIncidents.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#5A6178", fontSize: 13 }}>No tickets found. Click "Report an Issue" to create one.</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {myIncidents.map(inc => (
                <div key={inc.id} onClick={() => { setDetailItem(inc); setModal("incidentDetail"); }} style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, transition: "border-color 0.2s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#6366F144"} onMouseLeave={e => e.currentTarget.style.borderColor = "#1E2130"}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor(inc.status), flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>{inc.title}</div>
                    <div style={{ fontSize: 10, color: "#5A6178", marginTop: 2 }}>{inc.id} · {inc.category} · <span style={{ color: statusColor(inc.status) }}>{inc.status}</span></div>
                  </div>
                  {slaStatusBadge(inc)}
                  <PriorityDot priority={inc.priority} />
                  <div style={{ fontSize: 10, color: "#5A6178" }}>{inc.createdAt ? new Date(inc.createdAt).toLocaleDateString() : "—"}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* My Requests Tab */}
      {portalTab === "myRequests" && (
        <div>
          {myRequests.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#5A6178", fontSize: 13 }}>No service requests found. Click "Submit a Request" to create one.</div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {myRequests.map(req => (
                <div key={req.id} onClick={() => { setDetailItem(req); setModal("requestDetail"); }} style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, transition: "border-color 0.2s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#6366F144"} onMouseLeave={e => e.currentTarget.style.borderColor = "#1E2130"}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor(req.status), flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>{req.title}</div>
                    <div style={{ fontSize: 10, color: "#5A6178", marginTop: 2 }}>{req.id} · {req.type || "General"} · <span style={{ color: statusColor(req.status) }}>{req.status}</span></div>
                  </div>
                  <div style={{ fontSize: 10, color: "#5A6178" }}>{req.createdAt ? new Date(req.createdAt).toLocaleDateString() : "—"}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Knowledge Base Tab — Enterprise Knowledge Portal */}
      {portalTab === "kb" && (
        <KnowledgePortal kbArticles={kbArticles} portalSearch={portalSearch} setPortalSearch={setPortalSearch} setDetailItem={setDetailItem} setModal={setModal} showToast={showToast} currentUser={currentUser} incidents={incidents} setActiveModule={setActiveModule} />
      )}

      {/* Chat with Support Tab — KB-grounded customer chat with handoff to live agent */}
      {portalTab === "chat" && (
        <CustomerChatTab currentUser={currentUser} showToast={showToast} />
      )}

      {/* Service Catalog Tab — enterprise grouped layout */}
      {portalTab === "catalog" && (() => {
        // Group services by category, derive metadata, support search
        const q = (portalSearch || "").trim().toLowerCase();
        const norm = (s) => (s || "").toString();
        const filtered = serviceCatalog.filter(s => {
          if (!q) return true;
          return norm(s.name || s.title).toLowerCase().includes(q)
            || norm(s.description).toLowerCase().includes(q)
            || norm(s.category).toLowerCase().includes(q)
            || (s.tags || []).some(t => norm(t).toLowerCase().includes(q));
        });
        const groups = {};
        filtered.forEach(s => {
          const c = s.category || "General Services";
          (groups[c] = groups[c] || []).push(s);
        });
        const catColors = ["#6366F1","#06B6D4","#8B5CF6","#22C55E","#F59E0B","#EC4899","#0EA5E9","#A78BFA"];
        const catColor = (i) => catColors[i % catColors.length];
        const popular = [...filtered].sort((a,b) => (b.requestCount||0) - (a.requestCount||0)).slice(0, 4);
        const slaBadge = (svc) => {
          const sla = svc.slaHours || svc.fulfillmentHours || svc.deliveryHours;
          if (sla == null) return null;
          const txt = sla < 1 ? `${Math.round(sla*60)} min` : sla < 24 ? `${sla} hrs` : `${Math.round(sla/24)} d`;
          return <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: "#06B6D414", color: "#22D3EE", fontWeight: 600 }}>⏱ {txt}</span>;
        };
        const approvalBadge = (svc) => svc.requiresApproval ? <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: "#F59E0B14", color: "#FBBF24", fontWeight: 600 }}>✓ Approval</span> : null;
        const costBadge = (svc) => svc.cost ? <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: "#1E2130", color: "#9CA3AF", fontWeight: 600 }}>{svc.cost}</span> : null;

        const renderCard = (svc) => (
          <div key={svc.id} style={{ background: "#0F1117", borderRadius: 12, border: "1px solid #1E2130", padding: 18, transition: "all 0.18s", display: "flex", flexDirection: "column", gap: 10, cursor: "default", position: "relative", overflow: "hidden" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#6366F133"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 20px #6366F111"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#1E2130"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ width: 42, height: 42, borderRadius: 10, background: "#6366F112", border: "1px solid #6366F133", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{svc.icon || "🛍️"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#F1F5F9", fontFamily: "'Space Grotesk', sans-serif", lineHeight: 1.3, marginBottom: 4 }}>{svc.name || svc.title}</div>
                <div style={{ fontSize: 11, color: "#8B92A8", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{svc.description || "Submit this request via the catalog."}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
              {slaBadge(svc)}
              {approvalBadge(svc)}
              {costBadge(svc)}
              {(svc.tags || []).slice(0, 2).map((t, ti) => (
                <span key={ti} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: "#1E2130", color: "#7B89A0" }}>#{t}</span>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1E213044", paddingTop: 10, marginTop: "auto" }}>
              <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{svc.id || "—"}</span>
              <button style={{ ...btnStyle("#6366F1"), fontSize: 11, padding: "6px 14px", fontWeight: 700, background: "linear-gradient(135deg, #6366F1, #8B5CF6)", borderRadius: 8 }} onClick={() => { setActiveModule("catalog"); }}>Request →</button>
            </div>
          </div>
        );

        return (
          <div>
            {/* Hero */}
            <div style={{ background: "linear-gradient(135deg, #6366F10A, #06B6D40A)", borderRadius: 14, border: "1px solid #6366F122", padding: "24px 28px", marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: "#F1F5F9", fontFamily: "'Space Grotesk', sans-serif", margin: "0 0 4px" }}>🛍️ Service Catalog</h2>
                  <p style={{ fontSize: 12, color: "#8B92A8", margin: 0 }}>Browse and request standard IT services. Track every request through fulfillment.</p>
                </div>
                <div style={{ position: "relative", minWidth: 280 }}>
                  <input style={{ ...inputStyle, paddingLeft: 34, fontSize: 12, height: 38, borderRadius: 8, background: "#0A0C14" }}
                    placeholder="Search services…" value={portalSearch} onChange={e => setPortalSearch(e.target.value)} />
                  <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, pointerEvents: "none" }}>🔍</span>
                </div>
              </div>
              {/* Result count */}
              <div style={{ marginTop: 12, display: "flex", gap: 16, fontSize: 11, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>
                <span>{filtered.length} service{filtered.length !== 1 ? "s" : ""} available</span>
                <span>·</span>
                <span>{Object.keys(groups).length} categor{Object.keys(groups).length === 1 ? "y" : "ies"}</span>
                {q && <><span>·</span><span>matching "{q}"</span></>}
              </div>
            </div>

            {/* Popular row (only when no search) */}
            {!q && popular.length > 0 && popular.some(p => p.requestCount > 0) && (
              <div style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#E8ECF4", marginBottom: 10, fontFamily: "'Space Grotesk', sans-serif", textTransform: "uppercase", letterSpacing: 0.6 }}>⭐ Most Requested</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                  {popular.map(renderCard)}
                </div>
              </div>
            )}

            {/* Grouped categories */}
            {Object.keys(groups).sort().map((cat, ci) => (
              <div key={cat} style={{ marginBottom: 22 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ width: 4, height: 18, background: catColor(ci), borderRadius: 2 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#F1F5F9", fontFamily: "'Space Grotesk', sans-serif" }}>{cat}</span>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: catColor(ci) + "18", color: catColor(ci), fontWeight: 600 }}>{groups[cat].length}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                  {groups[cat].map(renderCard)}
                </div>
              </div>
            ))}

            {filtered.length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#5A6178" }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>🛍️</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#C4CAD6", marginBottom: 6 }}>{q ? "No services match your search" : "Service catalog is being updated"}</div>
                <div style={{ fontSize: 12 }}>{q ? `Try a different keyword or clear the search.` : "Check back soon."}</div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
