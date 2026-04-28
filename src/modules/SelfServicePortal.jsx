import React from "react";
import { btnStyle, inputStyle } from "../constants/theme.js";
import { PriorityDot, Modal } from "../components/SharedComponents.jsx";

export default function SelfServicePortal({ currentUser, incidents, requests, problems, changes, kbArticles, serviceCatalog, portalTab, setPortalTab, portalSearch, setPortalSearch, setActiveModule, setDetailItem, setModal }) {
  const userEmail = currentUser.email || currentUser.name;
  const myIncidents = incidents.filter(i => i.reporterEmail === userEmail || i.reporter === currentUser.name);
  const myRequests = requests.filter(r => r.requester === currentUser.name || r.requesterEmail === userEmail);
  const openCount = myIncidents.filter(i => !["Resolved","Closed"].includes(i.status)).length + myRequests.filter(r => !["Fulfilled","Cancelled"].includes(r.status)).length;
  const resolvedCount = myIncidents.filter(i => i.status === "Resolved" || i.status === "Closed").length;

  const statusColor = (s) => ({ "New": "#64B5F6", "In Progress": "#FFB347", "Pending": "#FFB347", "Awaiting Info": "#EC4899", "Resolved": "#4CAF50", "Closed": "#5A6178", "Open": "#64B5F6", "Fulfilled": "#4CAF50", "Cancelled": "#FF6B6B" })[s] || "#5A6178";

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
            <div style={{ fontSize: 20, fontWeight: 700, color: "#64B5F6", fontFamily: "'Space Grotesk', sans-serif" }}>{kbArticles.length}</div>
            <div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: "0.5px" }}>KB Articles</div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button style={{ ...btnStyle("#FF6B6B"), padding: "10px 20px", fontSize: 13, fontWeight: 700 }} onClick={() => setModal("newIncident")}>🎫 Report an Issue</button>
        <button style={{ ...btnStyle("#6366F1"), padding: "10px 20px", fontSize: 13, fontWeight: 700 }} onClick={() => setPortalTab("catalog")}>📋 Submit a Request</button>
      </div>

      {/* Portal Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "#0A0C14", padding: 4, borderRadius: 8 }}>
        {[{ id: "myTickets", label: "My Tickets", icon: "🎫", count: openCount }, { id: "myRequests", label: "My Requests", icon: "📋", count: myRequests.length }, { id: "kb", label: "Knowledge Base", icon: "📚" }, { id: "catalog", label: "Service Catalog", icon: "🛍️" }].map(tab => (
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

      {/* Knowledge Base Tab */}
      {portalTab === "kb" && (
        <div>
          <input style={{ ...inputStyle, marginBottom: 12 }} placeholder="🔍 Search knowledge base..." value={portalSearch} onChange={e => setPortalSearch(e.target.value)} />
          <div style={{ display: "grid", gap: 6 }}>
            {kbArticles.filter(kb => !portalSearch || kb.title?.toLowerCase().includes(portalSearch.toLowerCase()) || kb.content?.toLowerCase().includes(portalSearch.toLowerCase())).map(article => (
              <div key={article.id} onClick={() => { setDetailItem(article); setModal("kbDetail"); }} style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: "12px 16px", cursor: "pointer", transition: "border-color 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "#0078D444"} onMouseLeave={e => e.currentTarget.style.borderColor = "#1E2130"}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>📄 {article.title}</div>
                <div style={{ fontSize: 11, color: "#5A6178", marginTop: 4, lineHeight: 1.4 }}>{(article.content || article.description || "").substring(0, 120)}...</div>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  {article.category && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#0078D418", color: "#0078D4" }}>{article.category}</span>}
                  {article.views != null && <span style={{ fontSize: 9, color: "#5A6178" }}>👁 {article.views} views</span>}
                </div>
              </div>
            ))}
            {kbArticles.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "#5A6178", fontSize: 13 }}>No knowledge base articles available.</div>}
          </div>
        </div>
      )}

      {/* Service Catalog Tab */}
      {portalTab === "catalog" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {serviceCatalog.map(svc => (
            <div key={svc.id} style={{ background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130", padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", marginBottom: 4 }}>{svc.name || svc.title}</div>
              <div style={{ fontSize: 11, color: "#5A6178", lineHeight: 1.4, marginBottom: 8 }}>{(svc.description || "").substring(0, 100)}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                {svc.category && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#64B5F618", color: "#64B5F6" }}>{svc.category}</span>}
                <button style={{ ...btnStyle("#6366F1"), fontSize: 10, padding: "4px 12px" }} onClick={() => { setActiveModule("catalog"); }}>Request →</button>
              </div>
            </div>
          ))}
          {serviceCatalog.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "#5A6178", fontSize: 13, gridColumn: "1 / -1" }}>Service catalog is being updated. Check back soon.</div>}
        </div>
      )}
    </div>
  );
}
