import { useState } from "react";

export default function ProductivityDashboard({  changes, incidents, smartTasks, setSmartTasks, _save, productivityView, setProductivityView,
  isMsalAuthenticated, graphLoading, graphError, graphFetchedRef, fetchGraphData, graphUnread, graphEmails, graphCalendar, graphPresence, graphChats, graphTeams
 }) {
  const cardBase = { background: "#0F1117", borderRadius: 12, border: "1px solid #1E2130", padding: 20, transition: "all 0.3s ease" };
  const headerGrad = "linear-gradient(135deg, #0078D4, #00BCF2)";
  const recurrenceColors = { daily: "#FF6B6B", weekly: "#FFB347", monthly: "#6366F1", quarterly: "#06B6D4", "6-monthly": "#CE93D8", yearly: "#81C784" };
  const recurrenceLabels = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", "6-monthly": "6-Monthly", yearly: "Yearly" };
  const taskFilterOptions = ["all", "daily", "weekly", "monthly", "quarterly", "6-monthly", "yearly"];
  const [taskFilter, setTaskFilter] = useState("all");
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ title: "", recurrence: "daily", category: "General", priority: "Medium", assignee: "", notes: "" });

  const safeSmartTasks = Array.isArray(smartTasks) ? smartTasks : [];
  const pendingTasks = safeSmartTasks.filter(t => t.status === "pending");
  const completedTasks = safeSmartTasks.filter(t => t.status === "done");
  const filteredTasks = taskFilter === "all" ? safeSmartTasks : safeSmartTasks.filter(t => t.recurrence === taskFilter);
  const todayStr = new Date().toISOString().split("T")[0];
  const todayTasks = pendingTasks.filter(t => {
    if (!t.nextDue) return false;
    if (t.nextDue === todayStr) return true;
    const d = new Date(t.nextDue);
    return !isNaN(d.getTime()) && d.toDateString() === new Date().toDateString();
  });
  const overdueTasks = pendingTasks.filter(t => t.nextDue && t.nextDue < todayStr);

  const completeTask = (id) => {
    const updated = smartTasks.map(t => t.id === id ? { ...t, status: "done", completedAt: new Date().toISOString() } : t);
    setSmartTasks(updated);
    _save("vgc_smart_tasks", updated);
  };
  const resetTask = (id) => {
    const updated = smartTasks.map(t => t.id === id ? { ...t, status: "pending", completedAt: null } : t);
    setSmartTasks(updated);
    _save("vgc_smart_tasks", updated);
  };
  const addTask = () => {
    if (!newTask.title.trim()) return;
    const maxId = Math.max(...safeSmartTasks.map(t => parseInt(t.id?.slice(2)) || 0), 0);
    const id = "ST" + String(maxId + 1).padStart(3, "0");
    const task = { ...newTask, id, status: "pending", nextDue: new Date().toISOString().split("T")[0], aiSuggested: false };
    const updated = [...smartTasks, task];
    setSmartTasks(updated);
    _save("vgc_smart_tasks", updated);
    setNewTask({ title: "", recurrence: "daily", category: "General", priority: "Medium", assignee: "", notes: "" });
    setShowAddTask(false);
  };
  const deleteTask = (id) => {
    const updated = smartTasks.filter(t => t.id !== id);
    setSmartTasks(updated);
    _save("vgc_smart_tasks", updated);
  };

  // M365 App Quick Access
  const m365Apps = [
    { name: "Outlook", icon: "📧", color: "#0078D4", url: "https://outlook.office.com" },
    { name: "Teams", icon: "💬", color: "#6264A7", url: "https://teams.microsoft.com" },
    { name: "OneDrive", icon: "☁️", color: "#0078D4", url: "https://onedrive.live.com" },
    { name: "Word", icon: "📄", color: "#2B579A", url: "https://www.office.com/launch/word" },
    { name: "Excel", icon: "📊", color: "#217346", url: "https://www.office.com/launch/excel" },
    { name: "PowerPoint", icon: "📽️", color: "#B7472A", url: "https://www.office.com/launch/powerpoint" },
    { name: "SharePoint", icon: "🌐", color: "#038387", url: "https://www.office.com/launch/sharepoint" },
    { name: "Planner", icon: "📋", color: "#31752F", url: "https://tasks.office.com" },
  ];

  // ─── Overview Tab ────────────────────────────────────────────────
  if (productivityView === "overview") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ ...cardBase, background: headerGrad, border: "none", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>🚀 AI-Powered Productivity Hub</div>
          <div style={{ fontSize: 12, color: "#ffffffcc", marginTop: 2 }}>Smart scheduling, M365 integration & AI-driven task management</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => {
            localStorage.removeItem("vgc_smart_tasks");
            const td = new Date().toISOString().split("T")[0];
            const yd = new Date(Date.now() - 86400000).toISOString().split("T")[0];
            const nw = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
            const fresh = [
              { id: "ST001", title: "Review & close resolved incidents older than 7 days", recurrence: "daily", category: "Incident Mgmt", priority: "High", status: "pending", nextDue: td, assignee: "All Engineers", aiSuggested: true, notes: "" },
              { id: "ST002", title: "Check SLA compliance for Sev-A tickets", recurrence: "daily", category: "SLA", priority: "Critical", status: "pending", nextDue: td, assignee: "Service Desk Lead", aiSuggested: true, notes: "" },
              { id: "ST003", title: "Review unassigned ticket queue", recurrence: "daily", category: "Queue Mgmt", priority: "High", status: "pending", nextDue: td, assignee: "L1 Support Engineer", aiSuggested: false, notes: "" },
              { id: "ST004", title: "Weekly team standup — review open incidents & changes", recurrence: "weekly", category: "Team Mgmt", priority: "Medium", status: "pending", nextDue: nw, assignee: "Service Desk Lead", aiSuggested: false, notes: "" },
              { id: "ST005", title: "Update Knowledge Portal articles from resolved tickets", recurrence: "weekly", category: "Knowledge Mgmt", priority: "Medium", status: "pending", nextDue: nw, assignee: "L2 Support Engineer", aiSuggested: true, notes: "" },
              { id: "ST006", title: "Patch Tuesday — review & schedule OS patching", recurrence: "monthly", category: "Change Mgmt", priority: "High", status: "pending", nextDue: "2026-04-08", assignee: "Network Engineer", aiSuggested: true, notes: "" },
              { id: "ST007", title: "Monthly SLA & KPI performance report for management", recurrence: "monthly", category: "Reports", priority: "Medium", status: "pending", nextDue: "2026-04-01", assignee: "Service Desk Lead", aiSuggested: false, notes: "" },
              { id: "ST008", title: "Quarterly PDPA compliance audit", recurrence: "quarterly", category: "Compliance", priority: "High", status: "pending", nextDue: "2026-06-01", assignee: "Tenant Admin", aiSuggested: true, notes: "" },
              { id: "ST009", title: "Bi-annual disaster recovery drill & documentation", recurrence: "6-monthly", category: "DR/BCP", priority: "Critical", status: "pending", nextDue: "2026-06-15", assignee: "VGC Dev Admin", aiSuggested: true, notes: "" },
              { id: "ST010", title: "Annual license & subscription renewal review", recurrence: "yearly", category: "Asset Mgmt", priority: "Medium", status: "pending", nextDue: "2026-12-01", assignee: "Tenant Admin", aiSuggested: false, notes: "" },
              { id: "ST011", title: "Escalate overdue Sev-B incidents to L2 support", recurrence: "daily", category: "Incident Mgmt", priority: "High", status: "pending", nextDue: yd, assignee: "Service Desk Lead", aiSuggested: true, notes: "" },
              { id: "ST012", title: "Verify backup completion for production servers", recurrence: "daily", category: "Infrastructure", priority: "Critical", status: "pending", nextDue: yd, assignee: "Network Engineer", aiSuggested: true, notes: "" },
            ];
            setSmartTasks(fresh); _save("vgc_smart_tasks", fresh);
          }} style={{ padding: "5px 10px", borderRadius: 5, background: "#ffffff11", border: "1px solid #ffffff22", color: "#ffffffcc", fontSize: 10, cursor: "pointer" }} title="Reset to default tasks">🔄 Reset</button>
          {["overview", "outlook", "teams", "tasks"].map(v => (
            <button key={v} onClick={() => setProductivityView(v)} style={{
              padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: productivityView === v ? "#ffffff33" : "#ffffff11", color: "#fff",
              border: productivityView === v ? "1px solid #ffffff55" : "1px solid #ffffff22",
              transition: "all 0.2s", textTransform: "capitalize"
            }}>{v === "overview" ? "🏠 Overview" : v === "outlook" ? "📧 Outlook" : v === "teams" ? "💬 Teams" : "📋 Tasks"}</button>
          ))}
        </div>
      </div>

      {/* M365 Quick Access Row */}
      <div style={{ ...cardBase, padding: "14px 20px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#8B8FA3", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Microsoft 365 Quick Access</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {m365Apps.map(app => (
            <a key={app.name} href={app.url} target="_blank" rel="noopener noreferrer" style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "10px 14px",
              borderRadius: 10, background: app.color + "11", border: "1px solid " + app.color + "33",
              cursor: "pointer", textDecoration: "none", transition: "all 0.2s", minWidth: 64
            }} onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = app.color + "66"; }}
               onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = app.color + "33"; }}>
              <span style={{ fontSize: 22 }}>{app.icon}</span>
              <span style={{ fontSize: 10, color: "#E8ECF4", fontWeight: 500 }}>{app.name}</span>
            </a>
          ))}
        </div>
      </div>

      {/* Three-column layout: Business Impact (small) | Outlook (large) | Teams (large) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr 1.5fr", gap: 16 }}>
        {/* Business Impact & Cost Card (smaller) */}
        <div style={{ ...cardBase, background: "linear-gradient(135deg, #0F1117, #131620)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
            <span>💰</span> Business Impact
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { label: "Hours Saved / Week", value: "12.5h", icon: "⏱️", color: "#06B6D4", sub: "via automated scheduling" },
              { label: "Tasks Auto-Completed", value: `${completedTasks.length}`, icon: "✅", color: "#81C784", sub: "this period" },
              { label: "Escalations Prevented", value: "8", icon: "🛡️", color: "#FFB347", sub: "AI early warnings" },
              { label: "Productivity Score", value: pendingTasks.length > 0 ? Math.round((completedTasks.length / (completedTasks.length + pendingTasks.length)) * 100) + "%" : "—", icon: "📈", color: "#6366F1", sub: "completion rate" },
            ].map((m, i) => (
              <div key={i} style={{ padding: "10px 12px", borderRadius: 8, background: m.color + "08", border: "1px solid " + m.color + "22" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 10, color: "#8B8FA3" }}>{m.icon} {m.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: m.color }}>{m.value}</div>
                </div>
                <div style={{ fontSize: 9, color: "#5A6178", marginTop: 2 }}>{m.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Outlook Dashboard Card (large) */}
        <div style={{ ...cardBase, cursor: "pointer", position: "relative" }} onClick={() => setProductivityView("outlook")}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "#0078D466"; e.currentTarget.style.transform = "translateY(-2px)"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#1E2130"; e.currentTarget.style.transform = "translateY(0)"; }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "#0078D422", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📧</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4" }}>Microsoft Outlook</div>
              <div style={{ fontSize: 10, color: "#5A6178" }}>Email, Calendar & Tasks</div>
            </div>
            <div style={{ marginLeft: "auto", padding: "3px 8px", borderRadius: 4, background: "#0078D422", color: "#0078D4", fontSize: 9, fontWeight: 600 }}>GRAPH API</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { icon: "📥", label: "Inbox", desc: "View & manage emails with AI-prioritized inbox", color: "#0078D4" },
              { icon: "📅", label: "Calendar", desc: "Meetings, events & schedule management", color: "#00BCF2" },
              { icon: "✉️", label: "Compose", desc: "AI-assisted email drafting & templates", color: "#6366F1" },
            ].map((f, i) => (
              <div key={i} style={{ padding: "8px 12px", borderRadius: 6, background: f.color + "08", border: "1px solid " + f.color + "15", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 16 }}>{f.icon}</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#E8ECF4" }}>{f.label}</div>
                  <div style={{ fontSize: 9, color: "#5A6178" }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6, background: "#0078D411", border: "1px solid #0078D422", textAlign: "center" }}>
            <span style={{ fontSize: 10, color: "#0078D4", fontWeight: 600 }}>Click to open Outlook Dashboard →</span>
          </div>
        </div>

        {/* Teams Dashboard Card (large) */}
        <div style={{ ...cardBase, cursor: "pointer", position: "relative" }} onClick={() => setProductivityView("teams")}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "#6264A766"; e.currentTarget.style.transform = "translateY(-2px)"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#1E2130"; e.currentTarget.style.transform = "translateY(0)"; }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "#6264A722", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>💬</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4" }}>Microsoft Teams</div>
              <div style={{ fontSize: 10, color: "#5A6178" }}>Chat, Channels & Meetings</div>
            </div>
            <div style={{ marginLeft: "auto", padding: "3px 8px", borderRadius: 4, background: "#6264A722", color: "#6264A7", fontSize: 9, fontWeight: 600 }}>GRAPH API</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { icon: "💬", label: "Chats", desc: "Recent conversations & group chats", color: "#6264A7" },
              { icon: "📢", label: "Channels", desc: "Team channels & announcements", color: "#00BCF2" },
              { icon: "📞", label: "Teams Phone", desc: "Call history, voicemail & contacts", color: "#81C784" },
            ].map((f, i) => (
              <div key={i} style={{ padding: "8px 12px", borderRadius: 6, background: f.color + "08", border: "1px solid " + f.color + "15", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 16 }}>{f.icon}</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#E8ECF4" }}>{f.label}</div>
                  <div style={{ fontSize: 9, color: "#5A6178" }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6, background: "#6264A711", border: "1px solid #6264A722", textAlign: "center" }}>
            <span style={{ fontSize: 10, color: "#6264A7", fontWeight: 600 }}>Click to open Teams Dashboard →</span>
          </div>
        </div>
      </div>

      {/* Smart Task Overview — Today + Overdue */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Today's Tasks */}
        <div style={{ ...cardBase }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4" }}>📌 Today's Tasks</div>
            <span style={{ padding: "2px 8px", borderRadius: 10, background: todayTasks.length > 0 ? "#FF6B6B22" : "#81C78422", color: todayTasks.length > 0 ? "#FF6B6B" : "#81C784", fontSize: 10, fontWeight: 600 }}>{todayTasks.length} pending</span>
          </div>
          {todayTasks.length === 0 ? (
            <div style={{ textAlign: "center", padding: 20, color: "#5A6178", fontSize: 12 }}>✅ All caught up! No tasks due today.</div>
          ) : todayTasks.slice(0, 5).map(t => (
            <div key={t.id} style={{ padding: "8px 10px", borderRadius: 6, background: "#ffffff04", marginBottom: 6, display: "flex", alignItems: "center", gap: 8, border: "1px solid #1E2130" }}>
              <button onClick={() => completeTask(t.id)} style={{ width: 18, height: 18, borderRadius: 4, border: "1.5px solid #5A6178", background: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#5A6178" }} title="Mark done">○</button>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "#E8ECF4" }}>{t.title}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
                  <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: recurrenceColors[t.recurrence] + "22", color: recurrenceColors[t.recurrence] }}>{recurrenceLabels[t.recurrence]}</span>
                  <span style={{ fontSize: 8, color: "#5A6178" }}>{t.category}</span>
                  {t.aiSuggested && <span style={{ fontSize: 8, color: "#6366F1" }}>🤖 AI</span>}
                </div>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 8, textAlign: "center" }}>
            <button onClick={() => setProductivityView("tasks")} style={{ background: "none", border: "1px solid #1E2130", color: "#0078D4", fontSize: 10, padding: "5px 12px", borderRadius: 5, cursor: "pointer" }}>View All Tasks →</button>
          </div>
        </div>

        {/* Overdue / Upcoming */}
        <div style={{ ...cardBase }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4" }}>⚠️ Overdue & Upcoming</div>
            <span style={{ padding: "2px 8px", borderRadius: 10, background: overdueTasks.length > 0 ? "#FF6B6B22" : "#81C78422", color: overdueTasks.length > 0 ? "#FF6B6B" : "#81C784", fontSize: 10, fontWeight: 600 }}>{overdueTasks.length} overdue</span>
          </div>
          {overdueTasks.length === 0 ? (
            <div style={{ textAlign: "center", padding: 20, color: "#5A6178", fontSize: 12 }}>🎉 No overdue tasks!</div>
          ) : overdueTasks.slice(0, 5).map(t => (
            <div key={t.id} style={{ padding: "8px 10px", borderRadius: 6, background: "#FF6B6B06", marginBottom: 6, display: "flex", alignItems: "center", gap: 8, border: "1px solid #FF6B6B22" }}>
              <span style={{ fontSize: 12 }}>🔴</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "#E8ECF4" }}>{t.title}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
                  <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#FF6B6B22", color: "#FF6B6B" }}>Due: {t.nextDue}</span>
                  <span style={{ fontSize: 8, color: "#5A6178" }}>{t.category}</span>
                </div>
              </div>
              <button onClick={() => completeTask(t.id)} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #81C78444", background: "#81C78411", color: "#81C784", fontSize: 9, cursor: "pointer" }}>Done</button>
            </div>
          ))}
        </div>
      </div>

      {/* AI Daily Guidance */}
      <div style={{ ...cardBase, background: "linear-gradient(135deg, #6366F108, #06B6D408)", border: "1px solid #6366F122" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", marginBottom: 10 }}>🤖 AI Daily Guidance</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {[
            { icon: "🎯", title: "Priority Focus", text: overdueTasks.length > 0 ? `You have ${overdueTasks.length} overdue task(s). Address these first to stay on track.` : todayTasks.length > 0 ? `${todayTasks.length} task(s) due today. Start with the highest priority ones.` : "All tasks up to date! Consider reviewing upcoming weekly tasks.", color: "#FF6B6B" },
            { icon: "📊", title: "Productivity Insight", text: `${completedTasks.length} tasks completed so far. ${pendingTasks.length} pending across ${Object.keys(recurrenceColors).length} schedules. Keep the momentum going!`, color: "#06B6D4" },
            { icon: "💡", title: "AI Recommendation", text: "Review Knowledge Portal for common resolutions. Auto-schedule monthly patching tasks via the Smart Task Scheduler.", color: "#6366F1" },
          ].map((g, i) => (
            <div key={i} style={{ padding: "12px 14px", borderRadius: 8, background: "#0F1117", border: "1px solid " + g.color + "22" }}>
              <div style={{ fontSize: 16, marginBottom: 4 }}>{g.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: g.color, marginBottom: 4 }}>{g.title}</div>
              <div style={{ fontSize: 10, color: "#8B8FA3", lineHeight: 1.5 }}>{g.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ─── Outlook Tab ──────────────────────────────────────────────────
  if (productivityView === "outlook") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header with back */}
      <div style={{ ...cardBase, background: "linear-gradient(135deg, #0078D4, #00BCF2)", border: "none", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setProductivityView("overview")} style={{ background: "#ffffff22", border: "1px solid #ffffff33", color: "#fff", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>← Back</button>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>📧 Microsoft Outlook</div>
            <div style={{ fontSize: 11, color: "#ffffffbb" }}>Email, Calendar & Scheduling — Powered by Microsoft Graph</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["overview", "outlook", "teams", "tasks"].map(v => (
            <button key={v} onClick={() => setProductivityView(v)} style={{
              padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: productivityView === v ? "#ffffff33" : "#ffffff11", color: "#fff",
              border: productivityView === v ? "1px solid #ffffff55" : "1px solid #ffffff22",
              textTransform: "capitalize"
            }}>{v === "overview" ? "🏠" : v === "outlook" ? "📧" : v === "teams" ? "💬" : "📋"}</button>
          ))}
        </div>
      </div>

      {/* Graph Connection Status */}
      {isMsalAuthenticated && (
        <div style={{ ...cardBase, padding: "8px 16px", display: "flex", alignItems: "center", gap: 8, background: graphLoading ? "#FFB34708" : graphError ? "#FF6B6B08" : "#4CAF5008", border: "1px solid " + (graphLoading ? "#FFB34722" : graphError ? "#FF6B6B22" : "#4CAF5022") }}>
          <span style={{ fontSize: 12 }}>{graphLoading ? "⏳" : graphError ? "⚠️" : "✅"}</span>
          <span style={{ fontSize: 10, color: graphLoading ? "#FFB347" : graphError ? "#FF6B6B" : "#4CAF50", fontWeight: 600 }}>
            {graphLoading ? "Loading Microsoft 365 data..." : graphError ? `Graph API: ${graphError}` : "Connected to Microsoft 365 Graph API — Live Data"}
          </span>
          {!graphLoading && (
            <button onClick={() => { graphFetchedRef.current = false; fetchGraphData(); }} style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: 4, background: "#0078D411", border: "1px solid #0078D433", color: "#0078D4", fontSize: 9, cursor: "pointer", fontWeight: 600 }}>🔄 Refresh</button>
          )}
        </div>
      )}

      {/* Outlook Feature Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Inbox Preview */}
        <div style={{ ...cardBase }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
            📥 Inbox
            {isMsalAuthenticated && graphUnread > 0 && <span style={{ padding: "1px 7px", borderRadius: 10, background: "#0078D4", color: "#fff", fontSize: 9, fontWeight: 700 }}>{graphUnread}</span>}
            {isMsalAuthenticated && <span style={{ marginLeft: "auto", fontSize: 8, padding: "2px 6px", borderRadius: 3, background: "#4CAF5011", color: "#4CAF50", border: "1px solid #4CAF5022" }}>LIVE</span>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(graphEmails || [
              { from: { emailAddress: { name: "IT Security Team" } }, subject: "🔒 Monthly Security Patch Schedule — April 2026", receivedDateTime: "2026-03-26T09:15:00Z", isRead: false, importance: "high" },
              { from: { emailAddress: { name: "Service Desk" } }, subject: "INC0005 Escalation — VPN connectivity issue", receivedDateTime: "2026-03-26T08:47:00Z", isRead: false, importance: "high" },
              { from: { emailAddress: { name: "Azure DevOps" } }, subject: "Build Pipeline #247 completed successfully", receivedDateTime: "2026-03-26T08:30:00Z", isRead: true, importance: "normal" },
              { from: { emailAddress: { name: "HR Department" } }, subject: "Q2 Training Calendar — IT Team", receivedDateTime: "2026-03-25T14:00:00Z", isRead: true, importance: "low" },
              { from: { emailAddress: { name: "Microsoft 365" } }, subject: "Your weekly productivity summary", receivedDateTime: "2026-03-25T10:00:00Z", isRead: true, importance: "low" },
            ]).slice(0, 8).map((e, i) => {
              const isUnread = !e.isRead;
              const fromName = e.from?.emailAddress?.name || e.from?.emailAddress?.address || "Unknown";
              const time = e.receivedDateTime ? new Date(e.receivedDateTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
              const dateStr = e.receivedDateTime ? new Date(e.receivedDateTime).toLocaleDateString() : "";
              const isToday = dateStr === new Date().toLocaleDateString();
              return (
                <div key={e.id || i} style={{ padding: "10px 12px", borderRadius: 6, background: isUnread ? "#0078D406" : "#ffffff03", border: "1px solid " + (isUnread ? "#0078D422" : "#1E2130"), display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ width: 6, height: 6, borderRadius: 3, background: isUnread ? "#0078D4" : "transparent", marginTop: 5, flexShrink: 0 }}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 11, fontWeight: isUnread ? 700 : 500, color: "#E8ECF4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fromName}</div>
                      <div style={{ fontSize: 9, color: "#5A6178", flexShrink: 0 }}>{isToday ? time : dateStr}</div>
                    </div>
                    <div style={{ fontSize: 10, color: isUnread ? "#8B8FA3" : "#5A6178", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.subject}</div>
                    {e.bodyPreview && <div style={{ fontSize: 9, color: "#5A617866", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.bodyPreview.substring(0, 80)}</div>}
                  </div>
                  {e.hasAttachments && <span style={{ fontSize: 10, color: "#5A6178", flexShrink: 0 }}>📎</span>}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 10, borderTop: "1px solid #1E2130", paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 9, color: "#5A6178" }}>{graphEmails ? `Showing ${Math.min(graphEmails.length, 8)} of ${graphEmails.length} emails` : "Showing 5 mock emails"}</span>
            <a href="https://outlook.office.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#0078D4", textDecoration: "none", fontWeight: 600 }}>Open in Outlook ↗</a>
          </div>
        </div>

        {/* Calendar Preview */}
        <div style={{ ...cardBase }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
            📅 Today's Calendar
            {isMsalAuthenticated && <span style={{ marginLeft: "auto", fontSize: 8, padding: "2px 6px", borderRadius: 3, background: "#4CAF5011", color: "#4CAF50", border: "1px solid #4CAF5022" }}>LIVE</span>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(graphCalendar || [
              { start: { dateTime: "2026-03-26T09:00:00" }, end: { dateTime: "2026-03-26T09:30:00" }, subject: "Daily Standup — IT Team", isOnlineMeeting: true, _color: "#6264A7" },
              { start: { dateTime: "2026-03-26T10:30:00" }, end: { dateTime: "2026-03-26T11:15:00" }, subject: "Incident Review — INC0005 VPN Issue", isOnlineMeeting: true, _color: "#FF6B6B" },
              { start: { dateTime: "2026-03-26T13:00:00" }, end: { dateTime: "2026-03-26T14:00:00" }, subject: "Change Advisory Board Meeting", isOnlineMeeting: false, _color: "#FFB347" },
              { start: { dateTime: "2026-03-26T14:30:00" }, end: { dateTime: "2026-03-26T15:30:00" }, subject: "Azure Infrastructure Review", isOnlineMeeting: true, _color: "#0078D4" },
              { start: { dateTime: "2026-03-26T16:00:00" }, end: { dateTime: "2026-03-26T16:30:00" }, subject: "Knowledge Portal Update Session", isOnlineMeeting: true, _color: "#06B6D4" },
            ]).slice(0, 8).map((e, i) => {
              const startTime = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
              const endTime = e.end?.dateTime ? new Date(e.end.dateTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
              const colors = ["#6264A7", "#0078D4", "#FF6B6B", "#FFB347", "#06B6D4", "#81C784", "#EC4899"];
              const color = e._color || colors[i % colors.length];
              return (
                <div key={e.id || i} style={{ padding: "8px 12px", borderRadius: 6, background: "#ffffff04", border: "1px solid #1E2130", display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ width: 3, height: 28, borderRadius: 2, background: color, flexShrink: 0 }}/>
                  <div style={{ width: 42, fontSize: 11, fontWeight: 600, color: "#E8ECF4", flexShrink: 0 }}>{startTime}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "#E8ECF4" }}>{e.subject}</div>
                  <div style={{ fontSize: 9, color: "#5A6178" }}>{startTime} – {endTime} · {e.isOnlineMeeting ? "🟢 Online" : "🏢 In-Person"}</div>
                </div>
                {e.onlineMeetingUrl && <a href={e.onlineMeetingUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#6264A7", textDecoration: "none", fontWeight: 600 }}>Join</a>}
              </div>
              );
            })}
          </div>
          <div style={{ marginTop: 10, borderTop: "1px solid #1E2130", paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 9, color: "#5A6178" }}>{graphCalendar ? `${graphCalendar.length} events today (Live)` : "5 events today (Demo)"}</span>
            <a href="https://outlook.office.com/calendar" target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#0078D4", textDecoration: "none", fontWeight: 600 }}>Open Calendar ↗</a>
          </div>
        </div>
      </div>

      {/* AI Email Assist + Compose */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ ...cardBase, background: "linear-gradient(135deg, #6366F108, #0078D408)", border: "1px solid #6366F122" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", marginBottom: 10 }}>🤖 AI Email Assistant</div>
          <div style={{ fontSize: 11, color: "#8B8FA3", lineHeight: 1.6, marginBottom: 12 }}>
            Your AI assistant can help you draft replies, summarize long email threads, prioritize your inbox, and flag emails requiring urgent action.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { icon: "📝", label: "Draft Reply", desc: "AI composes contextual replies" },
              { icon: "📋", label: "Summarize Thread", desc: "Get a TL;DR of long chains" },
              { icon: "🔔", label: "Priority Alerts", desc: "Flag urgent emails automatically" },
            ].map((f, i) => (
              <div key={i} style={{ padding: "6px 10px", borderRadius: 5, background: "#ffffff04", border: "1px solid #1E2130", display: "flex", alignItems: "center", gap: 8 }}>
                <span>{f.icon}</span>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#E8ECF4" }}>{f.label}</div>
                  <div style={{ fontSize: 9, color: "#5A6178" }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ ...cardBase }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", marginBottom: 10 }}>⚡ Quick Actions</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { icon: "✉️", label: "New Email", action: "https://outlook.office.com/mail/deeplink/compose" },
              { icon: "📅", label: "New Event", action: "https://outlook.office.com/calendar/deeplink/compose" },
              { icon: "👥", label: "Contacts", action: "https://outlook.office.com/people" },
              { icon: "📎", label: "Attachments", action: "https://outlook.office.com" },
            ].map((a, i) => (
              <a key={i} href={a.action} target="_blank" rel="noopener noreferrer" style={{
                padding: "12px", borderRadius: 8, background: "#ffffff04", border: "1px solid #1E2130",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4, textDecoration: "none",
                cursor: "pointer", transition: "all 0.2s"
              }} onMouseEnter={e => { e.currentTarget.style.borderColor = "#0078D444"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#1E2130"; }}>
                <span style={{ fontSize: 18 }}>{a.icon}</span>
                <span style={{ fontSize: 10, color: "#E8ECF4", fontWeight: 500 }}>{a.label}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // ─── Teams Tab ──────────────────────────────────────────────────
  if (productivityView === "teams") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header with back */}
      <div style={{ ...cardBase, background: "linear-gradient(135deg, #6264A7, #8B8CC7)", border: "none", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setProductivityView("overview")} style={{ background: "#ffffff22", border: "1px solid #ffffff33", color: "#fff", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>← Back</button>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>💬 Microsoft Teams</div>
            <div style={{ fontSize: 11, color: "#ffffffbb" }}>Chat, Channels, Meetings & Phone — Powered by Microsoft Graph</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["overview", "outlook", "teams", "tasks"].map(v => (
            <button key={v} onClick={() => setProductivityView(v)} style={{
              padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: productivityView === v ? "#ffffff33" : "#ffffff11", color: "#fff",
              border: productivityView === v ? "1px solid #ffffff55" : "1px solid #ffffff22",
              textTransform: "capitalize"
            }}>{v === "overview" ? "🏠" : v === "outlook" ? "📧" : v === "teams" ? "💬" : "📋"}</button>
          ))}
        </div>
      </div>

      {/* Graph Connection Status */}
      {isMsalAuthenticated && (
        <div style={{ ...cardBase, padding: "8px 16px", display: "flex", alignItems: "center", gap: 8, background: graphLoading ? "#FFB34708" : "#4CAF5008", border: "1px solid " + (graphLoading ? "#FFB34722" : "#4CAF5022") }}>
          <span style={{ fontSize: 12 }}>{graphLoading ? "⏳" : "✅"}</span>
          <span style={{ fontSize: 10, color: graphLoading ? "#FFB347" : "#4CAF50", fontWeight: 600 }}>{graphLoading ? "Loading Teams data..." : "Connected to Microsoft Graph — Live Data"}</span>
          {graphPresence && <span style={{ marginLeft: 8, fontSize: 9, padding: "2px 8px", borderRadius: 10, background: graphPresence.availability === "Available" ? "#4CAF5022" : graphPresence.availability === "Busy" ? "#FF6B6B22" : "#FFB34722", color: graphPresence.availability === "Available" ? "#4CAF50" : graphPresence.availability === "Busy" ? "#FF6B6B" : "#FFB347" }}>● {graphPresence.availability}</span>}
          <button onClick={() => { graphFetchedRef.current = false; fetchGraphData(); }} style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: 4, background: "#6264A711", border: "1px solid #6264A733", color: "#6264A7", fontSize: 9, cursor: "pointer", fontWeight: 600 }}>🔄 Refresh</button>
        </div>
      )}

      {/* Teams Content Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Recent Chats */}
        <div style={{ ...cardBase }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
            💬 Recent Chats
            {isMsalAuthenticated && <span style={{ marginLeft: "auto", fontSize: 8, padding: "2px 6px", borderRadius: 3, background: "#4CAF5011", color: "#4CAF50", border: "1px solid #4CAF5022" }}>LIVE</span>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(graphChats ? graphChats.map((c, i) => {
              const avatarEmojis = ["🟢", "🔵", "🟡", "🟠", "🔴", "🟣", "⚪"];
              const name = c.topic || (c.chatType === "oneOnOne" ? "Direct Message" : c.chatType === "group" ? "Group Chat" : "Meeting Chat");
              const lastMsg = c.lastMessagePreview?.body?.content?.replace(/<[^>]*>/g, "").substring(0, 60) || "No recent messages";
              const time = c.lastUpdatedDateTime ? new Date(c.lastUpdatedDateTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
              return (
                <div key={c.id} style={{ padding: "8px 12px", borderRadius: 6, background: "#6264A706", border: "1px solid #6264A722", display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 16 }}>{avatarEmojis[i % avatarEmojis.length]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#E8ECF4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                      <div style={{ fontSize: 9, color: "#5A6178" }}>{time}</div>
                    </div>
                    <div style={{ fontSize: 10, color: "#5A6178", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lastMsg}</div>
                  </div>
                </div>
              );
            }) : [
              { name: "IT Support Team", message: "INC0005 has been escalated to L2", time: "10 min ago", unread: 3, avatar: "🟢" },
              { name: "John Doe", message: "Can you check the VPN config?", time: "25 min ago", unread: 1, avatar: "🔵" },
              { name: "Change Advisory Board", message: "CAB meeting rescheduled to 1 PM", time: "1 hr ago", unread: 0, avatar: "🟡" },
              { name: "Security Team", message: "New vulnerability advisory posted", time: "2 hr ago", unread: 0, avatar: "🔴" },
              { name: "Azure DevOps Bot", message: "Pipeline #247 — all checks passed", time: "3 hr ago", unread: 0, avatar: "🤖" },
            ].map((c, i) => (
              <div key={i} style={{ padding: "8px 12px", borderRadius: 6, background: c.unread > 0 ? "#6264A706" : "#ffffff03", border: "1px solid " + (c.unread > 0 ? "#6264A722" : "#1E2130"), display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 16 }}>{c.avatar}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 11, fontWeight: c.unread > 0 ? 700 : 500, color: "#E8ECF4" }}>{c.name}</div>
                    <div style={{ fontSize: 9, color: "#5A6178" }}>{c.time}</div>
                  </div>
                  <div style={{ fontSize: 10, color: "#5A6178", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.message}</div>
                </div>
                {c.unread > 0 && <span style={{ width: 18, height: 18, borderRadius: 9, background: "#6264A7", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{c.unread}</span>}
              </div>
            )))}
          </div>
          <div style={{ marginTop: 10, borderTop: "1px solid #1E2130", paddingTop: 10, textAlign: "right" }}>
            <a href="https://teams.microsoft.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#6264A7", textDecoration: "none", fontWeight: 600 }}>Open in Teams ↗</a>
          </div>
        </div>

        {/* Channels */}
        <div style={{ ...cardBase }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4", marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
            📢 {graphTeams ? "Joined Teams" : "Active Channels"}
            {isMsalAuthenticated && <span style={{ marginLeft: "auto", fontSize: 8, padding: "2px 6px", borderRadius: 3, background: "#4CAF5011", color: "#4CAF50", border: "1px solid #4CAF5022" }}>LIVE</span>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(graphTeams ? graphTeams.map((t, i) => {
              const colors = ["#0078D4", "#FF6B6B", "#FFB347", "#81C784", "#06B6D4", "#6264A7", "#EC4899"];
              return (
                <div key={t.id} style={{ padding: "8px 12px", borderRadius: 6, background: "#ffffff04", border: "1px solid #1E2130", display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ width: 3, height: 24, borderRadius: 2, background: colors[i % colors.length], flexShrink: 0 }}/>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#E8ECF4" }}>{t.displayName}</div>
                    <div style={{ fontSize: 9, color: "#5A6178" }}>{t.description?.substring(0, 50) || "Team"}</div>
                  </div>
                </div>
              );
            }) : [
              { name: "IT-Service-Desk", team: "IT Operations", activity: "5 new messages", color: "#0078D4" },
              { name: "Security-Alerts", team: "Cybersecurity", activity: "2 new alerts", color: "#FF6B6B" },
              { name: "Change-Management", team: "IT Governance", activity: "CAB notes posted", color: "#FFB347" },
              { name: "General", team: "IT Operations", activity: "Team outing poll", color: "#81C784" },
              { name: "Azure-Infrastructure", team: "Cloud Ops", activity: "Deployment update", color: "#06B6D4" },
            ].map((ch, i) => (
              <div key={i} style={{ padding: "8px 12px", borderRadius: 6, background: "#ffffff04", border: "1px solid #1E2130", display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ width: 3, height: 24, borderRadius: 2, background: ch.color, flexShrink: 0 }}/>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#E8ECF4" }}>#{ch.name}</div>
                  <div style={{ fontSize: 9, color: "#5A6178" }}>{ch.team} · {ch.activity}</div>
                </div>
              </div>
            )))}
          </div>
        </div>
      </div>

      {/* Teams Phone + Meetings */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Teams Phone */}
        <div style={{ ...cardBase }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>📞 Teams Phone</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { type: "📞 Incoming", from: "VGC Networks Pte Ltd", time: "09:45 AM", duration: "5 min", missed: false },
              { type: "📱 Outgoing", from: "Customer contact", time: "09:15 AM", duration: "12 min", missed: false },
              { type: "❌ Missed", from: "Unknown +65 8XXX XXXX", time: "08:30 AM", duration: "—", missed: true },
            ].map((c, i) => (
              <div key={i} style={{ padding: "8px 12px", borderRadius: 6, background: c.missed ? "#FF6B6B06" : "#ffffff04", border: "1px solid " + (c.missed ? "#FF6B6B22" : "#1E2130"), display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12 }}>{c.type.split(" ")[0]}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: c.missed ? "#FF6B6B" : "#E8ECF4" }}>{c.from}</div>
                  <div style={{ fontSize: 9, color: "#5A6178" }}>{c.time} · {c.duration}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 5, background: "#6264A711", border: "1px solid #6264A722", textAlign: "center" }}>
            <a href="https://teams.microsoft.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#6264A7", textDecoration: "none", fontWeight: 600 }}>Open Teams Phone ↗</a>
          </div>
        </div>

        {/* Upcoming Meetings */}
        <div style={{ ...cardBase }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>🗓️ Upcoming Meetings</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { title: "Sprint Retrospective", time: "Tomorrow, 10:00 AM", organizer: "Team Lead", type: "🟢 Online" },
              { title: "Quarterly IT Review", time: "Fri, 2:00 PM", organizer: "CTO", type: "🏢 Hybrid" },
              { title: "Security Awareness Training", time: "Mon, 11:00 AM", organizer: "CISO", type: "🟢 Online" },
            ].map((m, i) => (
              <div key={i} style={{ padding: "8px 12px", borderRadius: 6, background: "#ffffff04", border: "1px solid #1E2130" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#E8ECF4" }}>{m.title}</div>
                <div style={{ fontSize: 9, color: "#5A6178", marginTop: 2 }}>{m.time} · {m.organizer} · {m.type}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AI Teams Assistant */}
      <div style={{ ...cardBase, background: "linear-gradient(135deg, #6264A708, #6366F108)", border: "1px solid #6264A722" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", marginBottom: 8 }}>🤖 AI Teams Assistant</div>
        <div style={{ fontSize: 11, color: "#8B8FA3", lineHeight: 1.6 }}>
          Your AI assistant monitors Teams channels for critical mentions, summarizes long chat threads, and can draft messages for your review before sending. It highlights messages that need your attention and suggests optimal meeting times.
        </div>
      </div>
    </div>
  );

  // ─── Tasks Tab (Smart Scheduler) ─────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ ...cardBase, background: "linear-gradient(135deg, #0078D4, #6366F1)", border: "none", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setProductivityView("overview")} style={{ background: "#ffffff22", border: "1px solid #ffffff33", color: "#fff", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>← Back</button>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>📋 Smart Task & Routine Scheduler</div>
            <div style={{ fontSize: 11, color: "#ffffffbb" }}>AI-driven scheduling with daily, weekly, monthly, quarterly & yearly recurrence</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["overview", "outlook", "teams", "tasks"].map(v => (
            <button key={v} onClick={() => setProductivityView(v)} style={{
              padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: productivityView === v ? "#ffffff33" : "#ffffff11", color: "#fff",
              border: productivityView === v ? "1px solid #ffffff55" : "1px solid #ffffff22",
              textTransform: "capitalize"
            }}>{v === "overview" ? "🏠" : v === "outlook" ? "📧" : v === "teams" ? "💬" : "📋"}</button>
          ))}
        </div>
      </div>

      {/* Filter Tabs + Add Button */}
      <div style={{ ...cardBase, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {taskFilterOptions.map(f => (
            <button key={f} onClick={() => setTaskFilter(f)} style={{
              padding: "5px 12px", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer",
              background: taskFilter === f ? (recurrenceColors[f] || "#0078D4") + "22" : "#ffffff06",
              color: taskFilter === f ? (recurrenceColors[f] || "#0078D4") : "#5A6178",
              border: "1px solid " + (taskFilter === f ? (recurrenceColors[f] || "#0078D4") + "44" : "#1E2130"),
              textTransform: "capitalize"
            }}>{f === "all" ? "All Tasks" : recurrenceLabels[f] || f}</button>
          ))}
        </div>
        <button onClick={() => setShowAddTask(!showAddTask)} style={{
          padding: "6px 14px", borderRadius: 6, background: "#0078D4", color: "#fff", fontSize: 11, fontWeight: 600,
          border: "none", cursor: "pointer"
        }}>{showAddTask ? "✕ Cancel" : "＋ Add Task"}</button>
      </div>

      {/* Add Task Form */}
      {showAddTask && (
        <div style={{ ...cardBase, border: "1px solid #0078D433" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", marginBottom: 12 }}>➕ New Scheduled Task</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 4 }}>Task Title *</div>
              <input value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })} placeholder="Enter task description..." style={{ width: "100%", padding: "6px 10px", borderRadius: 5, border: "1px solid #1E2130", background: "#0A0C14", color: "#E8ECF4", fontSize: 11, outline: "none", boxSizing: "border-box" }}/>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 4 }}>Recurrence</div>
              <select value={newTask.recurrence} onChange={e => setNewTask({ ...newTask, recurrence: e.target.value })} style={{ width: "100%", padding: "6px 10px", borderRadius: 5, border: "1px solid #1E2130", background: "#0A0C14", color: "#E8ECF4", fontSize: 11, outline: "none" }}>
                {Object.entries(recurrenceLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 4 }}>Priority</div>
              <select value={newTask.priority} onChange={e => setNewTask({ ...newTask, priority: e.target.value })} style={{ width: "100%", padding: "6px 10px", borderRadius: 5, border: "1px solid #1E2130", background: "#0A0C14", color: "#E8ECF4", fontSize: 11, outline: "none" }}>
                {["Critical", "High", "Medium", "Low"].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 4 }}>Category</div>
              <input value={newTask.category} onChange={e => setNewTask({ ...newTask, category: e.target.value })} placeholder="e.g., Incident Mgmt" style={{ width: "100%", padding: "6px 10px", borderRadius: 5, border: "1px solid #1E2130", background: "#0A0C14", color: "#E8ECF4", fontSize: 11, outline: "none", boxSizing: "border-box" }}/>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 4 }}>Assignee</div>
              <input value={newTask.assignee} onChange={e => setNewTask({ ...newTask, assignee: e.target.value })} placeholder="e.g., L1 Support Engineer" style={{ width: "100%", padding: "6px 10px", borderRadius: 5, border: "1px solid #1E2130", background: "#0A0C14", color: "#E8ECF4", fontSize: 11, outline: "none", boxSizing: "border-box" }}/>
            </div>
          </div>
          <button onClick={addTask} style={{ padding: "8px 20px", borderRadius: 6, background: "#0078D4", color: "#fff", fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer" }}>Create Task</button>
        </div>
      )}

      {/* Task Summary Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
        {Object.entries(recurrenceLabels).map(([key, label]) => {
          const count = safeSmartTasks.filter(t => t.recurrence === key).length;
          const pending = safeSmartTasks.filter(t => t.recurrence === key && t.status === "pending").length;
          return (
            <div key={key} style={{ ...cardBase, padding: "12px 14px", textAlign: "center", cursor: "pointer", border: taskFilter === key ? "1px solid " + recurrenceColors[key] + "66" : "1px solid #1E2130" }}
              onClick={() => setTaskFilter(key)}>
              <div style={{ fontSize: 18, fontWeight: 700, color: recurrenceColors[key] }}>{count}</div>
              <div style={{ fontSize: 10, color: "#8B8FA3", marginTop: 2 }}>{label}</div>
              <div style={{ fontSize: 9, color: "#5A6178", marginTop: 1 }}>{pending} pending</div>
            </div>
          );
        })}
      </div>

      {/* Task List */}
      <div style={{ ...cardBase }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", marginBottom: 14 }}>
          {taskFilter === "all" ? "All Scheduled Tasks" : recurrenceLabels[taskFilter] + " Tasks"} ({filteredTasks.length})
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filteredTasks.map(t => {
            const isOverdue = t.status === "pending" && new Date(t.nextDue) < new Date() && new Date(t.nextDue).toDateString() !== new Date().toDateString();
            return (
              <div key={t.id} style={{
                padding: "10px 14px", borderRadius: 8,
                background: t.status === "done" ? "#81C78406" : isOverdue ? "#FF6B6B06" : "#ffffff04",
                border: "1px solid " + (t.status === "done" ? "#81C78422" : isOverdue ? "#FF6B6B22" : "#1E2130"),
                display: "flex", alignItems: "center", gap: 10, opacity: t.status === "done" ? 0.6 : 1
              }}>
                {t.status === "pending" ? (
                  <button onClick={() => completeTask(t.id)} style={{ width: 20, height: 20, borderRadius: 5, border: "1.5px solid " + recurrenceColors[t.recurrence], background: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: recurrenceColors[t.recurrence], flexShrink: 0 }} title="Mark done">○</button>
                ) : (
                  <button onClick={() => resetTask(t.id)} style={{ width: 20, height: 20, borderRadius: 5, border: "1.5px solid #81C784", background: "#81C78422", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#81C784", flexShrink: 0 }} title="Reset">✓</button>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "#E8ECF4", textDecoration: t.status === "done" ? "line-through" : "none" }}>{t.title}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: recurrenceColors[t.recurrence] + "22", color: recurrenceColors[t.recurrence], fontWeight: 600 }}>{recurrenceLabels[t.recurrence]}</span>
                    <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: "#ffffff08", color: "#8B8FA3" }}>{t.category}</span>
                    <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: t.priority === "Critical" ? "#FF6B6B22" : t.priority === "High" ? "#FFB34722" : "#ffffff08", color: t.priority === "Critical" ? "#FF6B6B" : t.priority === "High" ? "#FFB347" : "#8B8FA3" }}>{t.priority}</span>
                    {t.aiSuggested && <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: "#6366F122", color: "#6366F1" }}>🤖 AI Suggested</span>}
                    {isOverdue && <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: "#FF6B6B22", color: "#FF6B6B", fontWeight: 600 }}>OVERDUE</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 9, color: isOverdue ? "#FF6B6B" : "#5A6178" }}>Due: {t.nextDue}</div>
                  <div style={{ fontSize: 9, color: "#5A6178", marginTop: 2 }}>{t.assignee}</div>
                </div>
                <button onClick={() => deleteTask(t.id)} style={{ width: 18, height: 18, borderRadius: 4, border: "1px solid #FF6B6B33", background: "none", cursor: "pointer", color: "#FF6B6B", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: 0.5 }} title="Delete task">✕</button>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI Scheduling Guidance */}
      <div style={{ ...cardBase, background: "linear-gradient(135deg, #6366F108, #06B6D408)", border: "1px solid #6366F122" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", marginBottom: 8 }}>🤖 AI Scheduling Intelligence</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {[
            { icon: "📊", title: "Pattern Analysis", desc: "AI analyzes your task completion history and suggests optimal scheduling times based on your productivity patterns." },
            { icon: "🔮", title: "Proactive Reminders", desc: "Get AI-driven reminders before tasks are due. Monthly patching, quarterly audits, and yearly reviews — never miss a deadline." },
            { icon: "🧠", title: "Smart Suggestions", desc: "Based on incident trends and case history, AI automatically suggests new routine tasks to prevent recurring issues." },
          ].map((g, i) => (
            <div key={i} style={{ padding: "12px 14px", borderRadius: 8, background: "#0F1117", border: "1px solid #1E2130" }}>
              <div style={{ fontSize: 16, marginBottom: 4 }}>{g.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#06B6D4", marginBottom: 4 }}>{g.title}</div>
              <div style={{ fontSize: 10, color: "#8B8FA3", lineHeight: 1.5 }}>{g.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return null;
}
