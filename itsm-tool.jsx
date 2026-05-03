import React, { useState, useMemo, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { allLoginScopes, graphScopes } from "./msalConfig.js";
import { getMyProfile, getMyPhoto, getRecentEmails, getUnreadCount, getTodayEvents, getUpcomingEvents, getRecentChats, getJoinedTeams, getMyPresence } from "./graphService.js";
import {
  APP_VERSION, COLORS, PRIORITY_COLORS, STATUS_COLORS, PERM_COLORS, inputStyle, btnStyle,
  STATUS, OPEN_STATUSES, PRIORITY, SLA_TARGETS, DEFAULT_SLA_POLICY,
  RBAC_ROLES, RBAC_PERMISSIONS, DEV_ADMIN_EMAILS, ADMIN_EMAILS, USERS, INITIAL_CUSTOMERS,
  SECURITY_ALERTS, CATEGORIES, SERVICES, AI_FEATURE_EXPLAINERS, ASSETS,
  SHAREPOINT_KB_CONFIG, KB_CATEGORIES, KB_ARTICLES, INTEGRATION_CATALOG,
  INITIAL_INCIDENTS, INITIAL_PROBLEMS, INITIAL_CHANGES, INITIAL_REQUESTS,
} from "./src/constants/index.js";
import {
  getBusinessHoursElapsed, formatSlaCountdown, computeIncidentSla, computeMTTR,
  genId, timeAgo, sanitizeHTML,
} from "./src/utils/slaHelpers.js";
import {
  Badge, PriorityDot, StatCard, DataTable, WORKFLOW_STEPS, WorkflowHeader,
  Modal, FormField, useStableComponent, SearchBar,
} from "./src/components/SharedComponents.jsx";
import {
  EmailAuditTab, FeatureFlagsTab, AIDecisionsTab, ComplianceTab,
} from "./src/components/AdminTabs.jsx";
import { useLocale, SUPPORTED_LOCALES } from "./src/i18n/i18nProvider.jsx";
// ─── Lazy-loaded modules (code-split into separate chunks) ───────────
const AdminSettingsModule = lazy(() => import("./src/modules/AdminSettingsModule.jsx"));
const DashboardModule = lazy(() => import("./src/modules/DashboardModule.jsx"));
const ModalsModule = lazy(() => import("./src/modules/ModalsModule.jsx"));
const ZendeskModule = lazy(() => import("./src/modules/ZendeskModule.jsx"));
const ReportingModule = lazy(() => import("./src/modules/ReportingModule.jsx"));
const KnowledgeModule = lazy(() => import("./src/modules/KnowledgeModule.jsx"));
const CyberNewsModule = lazy(() => import("./src/modules/CyberNewsModule.jsx"));
const ProductivityDashboard = lazy(() => import("./src/modules/ProductivityDashboard.jsx"));
const SelfServicePortal = lazy(() => import("./src/modules/SelfServicePortal.jsx"));
const CustomersModule = lazy(() => import("./src/modules/CustomersModule.jsx"));
const IncidentsModule = lazy(() => import("./src/modules/IncidentsModule.jsx"));
const SLATrackerModule = lazy(() => import("./src/modules/SLATrackerModule.jsx"));
const ServiceStatusModule = lazy(() => import("./src/modules/ServiceStatusModule.jsx"));
const ArchitectureDiagram = lazy(() => import("./src/modules/ArchitectureDiagram.jsx"));
const ChangeCalendarModule = lazy(() => import("./src/modules/ChangeCalendarModule.jsx"));
const AIAssistModule = lazy(() => import("./src/modules/AIAssistModule.jsx"));
const AnalyticsModuleWrapper = lazy(() => import("./src/modules/AnalyticsModule.jsx"));
const EngineerReviewHub = lazy(() => import("./src/modules/EngineerReviewHub.jsx"));
const VendorPortalModule = lazy(() => import("./src/modules/VendorPortalModule.jsx"));
// ─── Eagerly-loaded (rendered before/around the lazy <Suspense>) ─────
import LoginPage from "./src/modules/LoginPage.jsx";
import { markdownToHtml, exportToWord } from "./src/utils/docHelpers.js";
import CardRenderer from "./src/components/chat/CardRenderer.jsx";
import { buildChatCards } from "./src/utils/chatCardBuilder.js";
import { createActionHandler } from "./src/utils/chatActionEngine.js";
import { createChatMemory, addToMemory, buildMemoryContext, clearMemory } from "./src/utils/chatMemory.js";
import { injectChatAnimations } from "./src/components/chat/ChatUxStyles.jsx";
import {
  matchAiTopic,
  renderAiRichText, buildAiResponse,
} from "./src/utils/aiEngine.jsx";

export default function ITSMApp() {
  // (#A follow-up, 2026-05-03) `isDemoMode` removed — it was hardcoded `false` and
  // every guard that read it was dead code. The DashboardModule context no longer
  // receives it.

  // ─── Runtime Config (fetched from server /api/config) ──────────────
  const [runtimeConfig, setRuntimeConfig] = useState(null);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [setupStep, setSetupStep] = useState(0);
  const [setupData, setSetupData] = useState({ companyName: "", companyShortName: "", adminEmail: "", timezone: "Asia/Singapore", businessHoursStart: 9, businessHoursEnd: 18, businessDays: "Mon-Fri", logoUrl: "" });
  useEffect(() => {
    fetch("/api/config").then(r => r.json()).then(cfg => {
      setRuntimeConfig(cfg);
      if (cfg.appName) APP_VERSION.name = cfg.appName;
      if (cfg.aiEngineName) APP_VERSION.engine = cfg.aiEngineName + " (Multi-Model: Pro/Mini/Nano)";
      // Check setup wizard status
      if (cfg.features?.setupWizard) {
        fetch("/api/setup/status").then(r => r.json()).then(s => {
          if (!s.completed) setShowSetupWizard(true);
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const [activeModule, setActiveModule] = useState("dashboard");
  const [ticketsSubTab, setTicketsSubTab] = useState("incidents");
  const [slaApprovalsSubTab, setSlaApprovalsSubTab] = useState("sla");
  const [analyticsSubTab, setAnalyticsSubTab] = useState("reports");
  const [aiTrainingTab, setAiTrainingTab] = useState("documents");
  const [aiAutoTraining, setAiAutoTraining] = useState(() => { try { return JSON.parse(localStorage.getItem("vgc_ai_auto_training") || "false"); } catch { return false; } });
  const [aiFeedback, setAiFeedback] = useState(() => { try { return JSON.parse(localStorage.getItem("vgc_ai_feedback") || "[]"); } catch { return []; } });
  const DATA_VERSION = "v2.9";
  const PRODUCTION_COLLECTIONS = ["vgc_incidents","vgc_problems","vgc_changes","vgc_requests","vgc_customers","vgc_service_reports","vgc_assets","vgc_kb","vgc_services"];
  const CUSTOMER_BOUND_COLLECTIONS = new Set(["vgc_customers", "vgc_service_reports"]);
  // Universal filter: remove any E2E/test/seed records by ID pattern
  const _isTestRecord = (id) => /^(INC-D|INC-[A-Z]{4,}|INC000|PRB000|CHG000|REQ000|DCUS-|DEMO-)/.test(id);
  const _cleanTestRecords = (arr) => Array.isArray(arr) ? arr.filter(r => !_isTestRecord(r.id)) : arr;
  const _ls = (key, fallback) => {
    try {
      if (key === "vgc_current_user") {
        const sessionUser = sessionStorage.getItem(key);
        localStorage.removeItem(key);
        return sessionUser ? JSON.parse(sessionUser) : fallback;
      }
      // Entra users: start empty, hydrate from DB
      const savedUser = sessionStorage.getItem("vgc_current_user");
      if (CUSTOMER_BOUND_COLLECTIONS.has(key) && !savedUser) {
        localStorage.removeItem(key);
        return [];
      }
      if (savedUser) {
        try {
          const u = JSON.parse(savedUser);
          if (CUSTOMER_BOUND_COLLECTIONS.has(key) && u.authType !== "entra") {
            localStorage.removeItem(key);
            return [];
          }
          if (u.authType === "entra" && PRODUCTION_COLLECTIONS.includes(key)) {
            const s = localStorage.getItem(key);
            if (s) {
              const parsed = JSON.parse(s);
              return _cleanTestRecords(parsed);
            }
            return [];
          }
        } catch (e) { /* ignore */ }
      }
      const curVer = localStorage.getItem("vgc_data_version");
      if (curVer !== DATA_VERSION) {
        ["vgc_incidents","vgc_problems","vgc_changes","vgc_requests","vgc_assets","vgc_kb","vgc_services","vgc_zd_ai_queue","vgc_zd_tickets","vgc_zd_stats","vgc_zd_auto_log","vgc_zd_auto_stats","vgc_customers","vgc_service_reports"].forEach(k => localStorage.removeItem(k));
        localStorage.setItem("vgc_data_version", DATA_VERSION);
        return CUSTOMER_BOUND_COLLECTIONS.has(key) ? [] : fallback;
      }
      const s = localStorage.getItem(key);
      if (s && PRODUCTION_COLLECTIONS.includes(key)) {
        const parsed = JSON.parse(s);
        return _cleanTestRecords(parsed);
      }
      return s ? JSON.parse(s) : fallback;
    } catch { return fallback; }
  };

  const DEFAULT_ZD_AUTO_STATS = { totalTriaged: 0, autoSent: 0, humanReview: 0, incidentsCreated: 0, avgConfidence: 0, safeSolved: 0, safeSolveBlocked: 0 };
  const safeStatNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  const normalizeZdAutoStats = (stats) => {
    const source = stats && typeof stats === "object" ? stats : {};
    return {
      totalTriaged: safeStatNumber(source.totalTriaged ?? source.processed),
      autoSent: safeStatNumber(source.autoSent ?? source.success),
      humanReview: safeStatNumber(source.humanReview),
      incidentsCreated: safeStatNumber(source.incidentsCreated),
      avgConfidence: safeStatNumber(source.avgConfidence),
      safeSolved: safeStatNumber(source.safeSolved),
      safeSolveBlocked: safeStatNumber(source.safeSolveBlocked),
    };
  };

  // ─── Microsoft Entra ID SSO & Graph API ─────────────────────────────
  const { instance: msalInstance, accounts } = useMsal();
  const isMsalAuthenticated = useIsAuthenticated();
  const [msalUser, setMsalUser] = useState(null); // Graph profile data
  const [msalPhoto, setMsalPhoto] = useState(null); // Profile photo blob URL
  const [graphEmails, setGraphEmails] = useState(null); // Outlook inbox
  const [graphCalendar, setGraphCalendar] = useState(null); // Today's events
  const [graphChats, setGraphChats] = useState(null); // Teams chats
  const [graphTeams, setGraphTeams] = useState(null); // Teams list
  const [graphUnread, setGraphUnread] = useState(0); // Unread email count
  const [graphPresence, setGraphPresence] = useState(null); // User presence
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState(null);
  const graphFetchedRef = useRef(false);

  const [incidents, setIncidents] = useState(() => {
    const stored = _cleanTestRecords(_ls("vgc_incidents", INITIAL_INCIDENTS));
    return stored;
  });
  const [problems, setProblems] = useState(() => {
    const stored = _cleanTestRecords(_ls("vgc_problems", INITIAL_PROBLEMS));
    return stored.filter(p => !p.title?.includes?.("[E2E"));
  });
  const [changes, setChanges] = useState(() => _cleanTestRecords(_ls("vgc_changes", INITIAL_CHANGES)));
  const [assets, setAssets] = useState(() => _ls("vgc_assets", ASSETS));
  const [kbArticles, setKbArticles] = useState(() => _ls("vgc_kb", KB_ARTICLES));
  const [requests, setRequests] = useState(() => _cleanTestRecords(_ls("vgc_requests", INITIAL_REQUESTS)));
  const [serviceCatalog, setServiceCatalog] = useState(() => _ls("vgc_services", SERVICES));
  const [search, setSearch] = useState("");

  // ─── Production Test Mode detection ─────────────────────────────────
  const [prodTestMode, setProdTestMode] = useState(false);
  const [aiPipelineStats, setAiPipelineStats] = useState(null);
  useEffect(() => {
    const checkProdMode = async () => {
      try {
        const r = await fetch("/api/health");
        if (r.ok) {
          const data = await r.json();
          if (data.prodTestMode) setProdTestMode(true);
        }
      } catch (e) { /* ignore */ }
    };
    checkProdMode();
    const iv = setInterval(checkProdMode, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);
  // Tab visibility tracker — heavy polls skip work when tab is hidden to reduce battery/network drain.
  const tabVisibleRef = useRef(typeof document === "undefined" ? true : !document.hidden);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => { tabVisibleRef.current = !document.hidden; };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  const [modal, setModal] = useState(null);
  const [incidentTemplates, setIncidentTemplates] = useState([]);
  const [approvalChains, setApprovalChains] = useState([]);
  const [approvalInstances, setApprovalInstances] = useState([]);
  const [reportSchedules, setReportSchedules] = useState([]);
  const [detailItem, setDetailItem] = useState(null);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [navExplainId, setNavExplainId] = useState(null);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showAlertPanel, setShowAlertPanel] = useState(false);
  // ─── Toast Notification System ─────────────────────────────────────────
  const [toasts, setToasts] = useState([]);
  const showToast = (message, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
    // Feed important toasts to the notification bell
    if (type === "success" || type === "error" || type === "warning") {
      setInAppNotifs(prev => [{ id: `toast-${id}`, title: message.replace(/^[^\w]*/, ""), type, read: false, time: new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }).replace(",", "") }, ...prev].slice(0, 50));
    }
  };
  // ─── WebSocket Live Connection ─────────────────────────────────────────
  const wsRef = useRef(null);
  const wsReconnectRef = useRef(null);
  const [wsConnected, setWsConnected] = useState(false);
  // ─── Recycle Bin & Undo ────────────────────────────────────────────────
  const [recycleBin, setRecycleBin] = useState(() => _ls("vgc_recycle_bin", []));
  const [undoToast, setUndoToast] = useState(null); // { id, label, type, timer }
  const undoTimerRef = useRef(null);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [cmdSearch, setCmdSearch] = useState("");
  const [globalLastSync, setGlobalLastSync] = useState(null);
  const [globalSyncActive, setGlobalSyncActive] = useState(false);
  const globalSyncRef = useRef(null);
  const [showFloatingKbTraining, setShowFloatingKbTraining] = useState(false);
  const [slaTick, setSlaTick] = useState(0); // SLA live refresh counter
  const [aiTypingState, setAiTypingState] = useState({ active: false, fullText: "", displayedText: "", msgIndex: -1 }); // AI typing animation
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState(() => _ls("vgc_notif_prefs", { email: true, teams: true, inApp: true, sms: false, severityFilter: ["Sev-A", "Sev-B", "Sev-C", "Sev-D"], quietHoursEnabled: false, quietStart: "22:00", quietEnd: "07:00", digestEnabled: true, digestTime: "08:00" }));
  const [showAvatarCustomizer, setShowAvatarCustomizer] = useState(false);
  const [errorAdvisory, setErrorAdvisory] = useState(null); // AI Error Advisory overlay
  const [disasterAlert, setDisasterAlert] = useState(null); // Weather disaster alert toast

  // ─── Knowledge Portal: AI Guide Generator & SharePoint Doc State ──────
  const [guideGenerating, setGuideGenerating] = useState(false);
  const [guideTopic, setGuideTopic] = useState("");
  const [guideCategory, setGuideCategory] = useState("General");
  const [guideResult, setGuideResult] = useState(null);
  const [spDocUrl, setSpDocUrl] = useState("");
  const [spDocTitle, setSpDocTitle] = useState("");
  const [spDocType, setSpDocType] = useState("General Documentation");
  const [spDocGenerating, setSpDocGenerating] = useState(false);
  const [spDocResult, setSpDocResult] = useState(null);
  const [kpActiveTab, setKpActiveTab] = useState("articles"); // articles | generator | sharepoint | generated | upload | versions
  const [kbDocPreview, setKbDocPreview] = useState(null); // KB doc preview panel
  const [kbVersionHistory, setKbVersionHistory] = useState([]); // version history for a doc
  const [kbBulkUploadFiles, setKbBulkUploadFiles] = useState([]); // bulk file upload queue
  const [kbBulkUploading, setKbBulkUploading] = useState(false);
  const [kbAiLearning, setKbAiLearning] = useState(false); // AI learning from uploads
  const [kbAiLearningProgress, setKbAiLearningProgress] = useState({ total: 0, done: 0, status: "" });
  const [aiChatExpanded, setAiChatExpanded] = useState(false); // AI Chatbox expand/compact
  const [kbAutoGenRunning, setKbAutoGenRunning] = useState(false); // auto-gen docs on first load
  const [kbAutoGenProgress, setKbAutoGenProgress] = useState({ total: 0, done: 0, current: "", status: "" }); // progress for auto-gen
  const [kbGapReport, setKbGapReport] = useState(null); // KB gap analysis report
  const kbAutoGenRanRef = useRef(false);

  // ─── Global AI Error Resolver ─────────────────────────────────────────
  const [aiErrorResolving, setAiErrorResolving] = useState(false);
  const [aiErrorResolution, setAiErrorResolution] = useState(null);

  // ─── High-Severity Auto-Escalation State ──────────────────────────────
  const [globalHighAlert, setGlobalHighAlert] = useState(null); // Active Sev-A alert needing pickup
  const [escalationLog, setEscalationLog] = useState(() => _ls("vgc_escalation_log", [])); // Permanent log
  const [escalationConfig, setEscalationConfig] = useState(() => {
    const saved = _ls("vgc_escalation_config", null);
    // v3.16: feature disabled by default — engine + banner produced inaccurate triggers.
    // Force `enabled: false` even on previously-persisted configs.
    return { ...(saved || {}), ...{
      enabled: false,
      sevAPickupWindow: 5,   // minutes
      sevBPickupWindow: 15,  // minutes
      autoCallEnabled: true,
      callOrder: "sequential", // "sequential" | "parallel"
      callNumbers: [
        { id: "C1", label: "VGC Helpdesk", number: "+65 6978 1299", priority: 1, sevAOnly: false },
        { id: "C2", label: "Dev VGC Admin", number: "+65 9697 1296", priority: 2, sevAOnly: false },
      ],
      teamsChannelNotify: true,
      emailFallback: true,
      dashboardAlertDismissible: false, // Sev-A alerts cannot be dismissed
      rateLimitMinutes: 10,  // Min gap between auto-calls for same incident
      vipCustomers: [],
      ispAlertDuration: 10,  // seconds for ISP outage alerts
    } };
  });
  // v3.16: also wipe any active in-memory alert from a stale prior session
  useEffect(() => { setGlobalHighAlert(null); injectChatAnimations(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const escalationTimerRef = useRef(null);
  const escalationCallRef = useRef(new Map()); // Track call attempts per incident

  const [profilePhoto, setProfilePhoto] = useState(() => _ls("vgc_profile_photo", null));
  const profilePhotoRef = useRef();
  const chatEndRef = useRef(null);
  const floatingChatEndRef = useRef(null);
  const [aiIdleNudge, setAiIdleNudge] = useState(null);
  const aiIdleTimerRef = useRef(null);
  // ─── Draggable AI Chatbox State ─────────────────────────────────────
  const [aiPos, setAiPos] = useState(() => _ls("vgc_ai_pos", { x: 24, y: 24 }));
  const aiDragRef = useRef({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0, moved: false });
  const aiContainerRef = useRef(null);
  const handleAiDragStart = (e) => {
    e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;
    aiDragRef.current = { dragging: true, startX: touch.clientX, startY: touch.clientY, origX: aiPos.x, origY: aiPos.y, moved: false };
    const onMove = (ev) => {
      const t = ev.touches ? ev.touches[0] : ev;
      const dx = t.clientX - aiDragRef.current.startX;
      const dy = t.clientY - aiDragRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) aiDragRef.current.moved = true;
      const newX = Math.max(0, aiDragRef.current.origX - dx);
      const newY = Math.max(0, aiDragRef.current.origY + dy);
      setAiPos({ x: newX, y: newY });
    };
    const onUp = () => {
      aiDragRef.current.dragging = false;
      setAiPos(p => { _save("vgc_ai_pos", p); return p; });
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
  };
  const [avatarConfig, setAvatarConfig] = useState(() => {
    const defaults = { borderStyle: "gradient", borderColor: "#6366F1", glowColor: "#6366F1", mood: "smart", shape: "rounded", animation: "float", theme: "singapore", showHeadset: true, showStatusRing: true, showSparkles: true };
    const saved = _ls("vgc_avatar", null);
    return saved ? { ...defaults, ...saved } : defaults;
  });
  const [proactiveAlerts, setProactiveAlerts] = useState([]);
  const [dismissedProactiveAlerts, setDismissedProactiveAlerts] = useState(() => {
    try { const saved = localStorage.getItem("vgc_dismissed_alerts"); return saved ? JSON.parse(saved) : []; } catch { return []; }
  });
  // ─── AI Actions Engine State ────────────────────────────────────────
  const [aiActions, setAiActions] = useState(() => _ls("vgc_ai_actions", []));
  const [aiActionsLoading, setAiActionsLoading] = useState(false);
  const [showAiActionsPanel, setShowAiActionsPanel] = useState(false);
  const [aiMonitorEnabled, setAiMonitorEnabled] = useState(() => _ls("vgc_ai_monitor", true));
  const [aiMonitorLastRun, setAiMonitorLastRun] = useState(null);
  const aiMonitorRef = useRef(null);
  // ─── In-App Notification Bell State ────────────────────────────────
  const [inAppNotifs, setInAppNotifs] = useState([]);
  const [showNotifTray, setShowNotifTray] = useState(false);
  const unreadNotifCount = inAppNotifs.filter(n => !n.read).length;
  const [reviewTab, setReviewTab] = useState("all");
  const [portalTab, setPortalTab] = useState("myTickets");
  const [portalSearch, setPortalSearch] = useState("");
  // ─── AI Historical Incident Closure State ───────────────────────────
  const [historicalCloseRunning, setHistoricalCloseRunning] = useState(false);
  const [historicalCloseResult, setHistoricalCloseResult] = useState(null);
  const [historicalCloseCutoff, setHistoricalCloseCutoff] = useState("2026-04-01");
  // ─── AI Auto-Resolve Queue State ───────────────────────────────────
  const [aiResolveQueue, setAiResolveQueue] = useState([]);
  const [aiResolveLoading, setAiResolveLoading] = useState(false);
  const [aiResolveScanLoading, setAiResolveScanLoading] = useState(false);
  const [aiResolveFilter, setAiResolveFilter] = useState("pending"); // "pending" | "all" | "dismissed"
  const [aiBulkDismissLoading, setAiBulkDismissLoading] = useState(false);
  const [aiBulkApproveLoading, setAiBulkApproveLoading] = useState(false);
  // ─── AI Workflow Assist State ──────────────────────────────────
  const [aiWorkflowQueue, setAiWorkflowQueue] = useState([]);
  const [aiWorkflowLoading, setAiWorkflowLoading] = useState(false);
  const [aiWorkflowScanLoading, setAiWorkflowScanLoading] = useState(false);
  // ─── AI Follow-Up & Cleanup State ─────────────────────────────
  const [aiFollowUpLoading, setAiFollowUpLoading] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  // ─── KB Learning from Incidents State ─────────────────────────
  const [kbLearningLoading, setKbLearningLoading] = useState(false);
  // ─── AI Chat Correction/Edit State ──────────────────────────────────
  const [aiEditingIdx, setAiEditingIdx] = useState(null);
  // ─── AI Workload & Correlation State ──────────────────────────────
  const [workloadData, setWorkloadData] = useState(null);
  const [workloadLoading, setWorkloadLoading] = useState(false);
  const [correlationData, setCorrelationData] = useState(null);
  const [correlationLoading, setCorrelationLoading] = useState(false);
  const [aiEditText, setAiEditText] = useState("");
  const [aiEditSaving, setAiEditSaving] = useState(false);
  const [aiMessages, setAiMessages] = useState([
    { role: "ai", text: `👋 VGC AI ready — triage, SLA alerts, KB search, drafts & security monitoring. Try "Good morning" for your briefing.`, suggestions: [
      { label: "📊 Morning Briefing", action: "Give me my morning briefing" },
      { label: "📚 Knowledge Portal", action: "Search knowledge base" },
      { label: "🎫 Open Tickets", action: "Show open incidents" },
      { label: "🛡️ Security Check", action: "Any security threats?" }
    ] }
  ]);
  const chatMemoryRef = useRef(createChatMemory());
  const chatContainerRef = useRef(null);
  const chatInputRef = useRef(null);
  const [aiInput, setAiInput] = useState("");
  const [aiAttachments, setAiAttachments] = useState([]);
  const [aiUploadingFiles, setAiUploadingFiles] = useState(false);
  const [aiNudge, setAiNudge] = useState(null);
  const aiNudgeDismissed = useRef(false);
  const [aiFilePreview, setAiFilePreview] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [adminTab, setAdminTab] = useState("ai");
  const [emailWhitelist, setEmailWhitelist] = useState([]);
  const [emailRejections, setEmailRejections] = useState([]);
  const [wfAnimStep, setWfAnimStep] = useState(0); // animated workflow diagram step
  const [wfAnimPlaying, setWfAnimPlaying] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditFilter, setAuditFilter] = useState({ module: "all", actor: "all", search: "" });
  const [auditLoading, setAuditLoading] = useState(false);
  const [versionHistory, setVersionHistory] = useState([]);
  const [uatResults, setUatResults] = useState([]);
  const [uatRunning, setUatRunning] = useState(false);
  const [uatLastRun, setUatLastRun] = useState(null);
  const [slaPolicy, setSlaPolicy] = useState(() => _ls("vgc_sla_policy", DEFAULT_SLA_POLICY));
  const [notifChannels, setNotifChannels] = useState(() => _ls("vgc_notif_channels", [
    { id: "email", channel: "Email", desc: "Send notifications via email (SMTP / Exchange Online)", enabled: true, icon: "📧" },
    { id: "teams", channel: "Microsoft Teams", desc: "Post adaptive cards to Teams channels via Webhooks", enabled: true, icon: "💬" },
    { id: "slack", channel: "Slack", desc: "Post to configured Slack channels", enabled: true, icon: "🔗" },
    { id: "sms", channel: "SMS", desc: "Send critical alerts via SMS (Twilio / Azure Comms)", enabled: false, icon: "📱" },
    { id: "inapp", channel: "In-App", desc: "Push notifications within VGC-ITSM", enabled: true, icon: "🔔" },
    { id: "pagerduty", channel: "PagerDuty", desc: "Trigger PagerDuty incidents for P1 alerts", enabled: false, icon: "🚨" },
    { id: "webhook", channel: "Webhook", desc: "Send JSON payloads to custom HTTP endpoints", enabled: false, icon: "🌐" },
  ]));
  const [slaEditingSev, setSlaEditingSev] = useState(null);
  useEffect(() => { _save("vgc_sla_policy", slaPolicy); }, [slaPolicy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _save("vgc_notif_channels", notifChannels); }, [notifChannels]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Load server-side collections for admin ───────────────────────────
  useEffect(() => {
    if (adminTab === "slaCalendars") {
      fetch("/api/sla/calendars").then(r => r.json()).then(d => setSlaCalendars(d.data || [])).catch(() => {});
    }
    if (adminTab === "notifTemplates") {
      fetch("/api/notification-templates").then(r => r.json()).then(d => setNotifTemplates(d.data || [])).catch(() => {});
    }
  }, [adminTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Global Keyboard Shortcuts ──────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Escape: close modal / command palette / recycle bin / alert panel / AI panel
      if (e.key === "Escape") {
        if (showCommandPalette) { setShowCommandPalette(false); setCmdSearch(""); return; }
        if (showRecycleBin) { setShowRecycleBin(false); return; }
        if (showAlertPanel) { setShowAlertPanel(false); return; }
        if (showAiActionsPanel) { setShowAiActionsPanel(false); return; }
        if (showAiPanel) { setShowAiPanel(false); return; }
        if (modal) { setModal(null); setDetailItem(null); return; }
      }
      // Ctrl+K : toggle command palette
      if (e.ctrlKey && e.key === "k") { e.preventDefault(); setShowCommandPalette(p => !p); setCmdSearch(""); }
      // Ctrl+/ : toggle AI assistant
      if (e.ctrlKey && e.key === "/") { e.preventDefault(); setShowAiPanel(p => !p); }
      // Ctrl+Shift+A : toggle AI Actions panel
      if (e.ctrlKey && e.shiftKey && (e.key === "A" || e.key === "a")) { e.preventDefault(); setShowAiActionsPanel(p => !p); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showRecycleBin, showAlertPanel, showAiPanel, showAiActionsPanel, modal, showCommandPalette]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Onboarding Guided Tour ──────────────────────────────────────────
  const [tourStep, setTourStep] = useState(() => {
    const seen = typeof localStorage !== "undefined" && localStorage.getItem("vgc_tour_done");
    return seen ? -1 : 0; // 0 = welcome modal, 1+ = tour steps, -1 = completed/dismissed
  });
  const dismissTour = () => { setTourStep(-1); if (typeof localStorage !== "undefined") localStorage.setItem("vgc_tour_done", "1"); };
  const restartTour = () => { setTourStep(0); if (typeof localStorage !== "undefined") localStorage.removeItem("vgc_tour_done"); };
  const TOUR_STEPS = [
    { id: "welcome", title: "👋 Welcome to VGC-ITSM!", body: "Hey there! I'm your AI — Assisted by your login. I'm super excited to show you around! 🎉\n\nThis quick tour will walk you through the key features so you can start managing IT services like a pro. Ready? Let's go!", position: "center", icon: "🚀" },
    { id: "sidebar", title: "📌 Navigation Sidebar", body: "This is your navigation hub! 🧭 Browse through all modules — from Incidents & Problems to Changes, Assets, and more.\n\n💡 Tip: Click the arrow at the top to collapse it for more screen space!", position: "right", anchor: "sidebar", icon: "🗂️" },
    { id: "dashboard", title: "📊 Your Dashboard", body: "Your personalized home base! 🏠 See KPIs, ticket queues, and real-time metrics all in one place.\n\n✨ The view adapts to your role — Managers see team analytics, Engineers see their ticket queue!", position: "top", anchor: "content", icon: "📈" },
    { id: "personalize", title: "⚙️ Personalize Cards", body: "Make it yours! 🎨 Click the \"Personalize\" button to show/hide dashboard cards.\n\n🔒 Important cards are managed by your Admin. You can toggle the rest based on what matters to you!", position: "bottom", anchor: "roleBar", icon: "🎯" },
    { id: "search", title: "🔍 Smart Search", body: "Need to find something fast? Just type here! ⚡\n\nSearch across incidents, problems, changes, assets — everything in one place. No more hunting through menus!", position: "bottom", anchor: "header", icon: "🔎" },
    { id: "weather", title: "🌤️ Singapore Weather", body: "A little local touch! ☀️ Real-time Singapore weather right in your header.\n\nBecause even IT heroes need to know if they should bring an umbrella! ☂️", position: "bottom", anchor: "header", icon: "🌏" },
    { id: "threats", title: "🚨 Security Alerts", body: "Stay safe! 🛡️ Critical and High severity cyber threats automatically pop up here with AI-powered recommendations.\n\n📧 You can even auto-draft emails to notify your team instantly!", position: "left", anchor: "threats", icon: "🔐" },
    { id: "aiAssistant", title: "🤖 Your AI Co-Pilot", body: "That's me! 👋😊 Click my avatar anytime to chat.\n\nI can help you triage incidents, recommend Knowledge Portal articles from SharePoint, analyze change risks, predict SLA breaches, and much more!", position: "left", anchor: "aiButton", icon: "🧠" },
    { id: "admin", title: "🔧 Admin & Settings", body: "Admins, this one's for you! ⚡ Head to the Admin panel to configure:\n\n⚙️ AI Settings\n👥 Users & RBAC\n🔐 Entra ID SSO\n🛡️ PDPA Compliance\n💳 Licensing & Billing\n\nEverything you need to run a world-class ITSM!", position: "right", anchor: "sidebar", icon: "⚙️" },
    { id: "done", title: "🎉 You're All Set!", body: "Awesome! You now know the essentials! 🌟\n\nRemember, I'm always here in the bottom-right corner if you need help. Just click my avatar! 💜\n\n🔄 You can restart this tour anytime from Admin → General settings.\n\nHappy ITSM-ing! 🚀", position: "center", icon: "✨" },
  ];
  const [dismissedThreats, setDismissedThreats] = useState([]);
  const [cyberNewsLog, setCyberNewsLog] = useState([]);
  const [threatEmailDraft, setThreatEmailDraft] = useState(null);
  const [dashboardThreats, setDashboardThreats] = useState([]);
  const [workflowHubTab, setWorkflowHubTab] = useState("pipeline");
  const [networkSecTab, setNetworkSecTab] = useState("meraki");
  const [merakiData, setMerakiData] = useState(null);
  const [merakiLoading, setMerakiLoading] = useState(false);
  const [solarwindsData, setSolarwindsData] = useState(null);
  const [solarwindsLoading, setSolarwindsLoading] = useState(false);
  const [sophosData, setSophosData] = useState(null);
  const [sophosLoading, setSophosLoading] = useState(false);
  const [expandedMerakiOrg, setExpandedMerakiOrg] = useState(null);
  const [showKbTraining, setShowKbTraining] = useState(false);
  const [kbEntries, setKbEntries] = useState([]);
  const [kbLoading, setKbLoading] = useState(false);
  const [kbForm, setKbForm] = useState({ title: "", category: "General", content: "", tags: "" });
  const [kbUploadFiles, setKbUploadFiles] = useState([]); // files pending upload for AI training
  const [showCardSettings, setShowCardSettings] = useState(false);
  const [dashboardEditMode, setDashboardEditMode] = useState(false);
  const [cardLayout, setCardLayout] = useState(() => {
    try { const s = localStorage.getItem("vgc_card_layout"); if (s) return JSON.parse(s); } catch (e) { /* ignore */ }
    return {};
  });
  const [dragState, setDragState] = useState(null);
  const [cardVisibility, setCardVisibility] = useState({
    zdSync:          { on: true, important: false, label: "Zendesk Integration",    roles: ["all"] },
    execKpis:        { on: true, important: false, label: "Executive KPIs",        roles: ["management"] },
    caseAnalysis:    { on: true, important: false, label: "Case Analysis",          roles: ["management"] },
    priorityDist:    { on: true, important: false, label: "Priority Distribution",  roles: ["management"] },
    slaStatus:       { on: true, important: false, label: "SLA by Priority",        roles: ["management"] },
    teamWorkload:    { on: true, important: false, label: "Team Workload",          roles: ["management"] },
    businessImpact:  { on: false, important: false, label: "Business Impact & Cost", roles: ["management"] },
    pendingApprovals:{ on: true, important: false, label: "Pending Approvals",      roles: ["management"] },
    opsHub:          { on: true, important: false, label: "Operations Hub",         roles: ["all"] },
    networkSecurity:  { on: true, important: false, label: "Network & Security Hub",  roles: ["all"] },
    personalKpis:    { on: true, important: false, label: "Personal KPIs",          roles: ["engineer"] },
    ticketQueue:     { on: true, important: false, label: "My Ticket Queue",        roles: ["engineer"] },
    quickActions:    { on: true, important: false, label: "Quick Actions",          roles: ["engineer"] },
    aiCoPilot:       { on: true, important: false, label: "My AI Co-Pilot",         roles: ["engineer"] },
    unassignedQueue: { on: true, important: false, label: "Unassigned Queue",       roles: ["engineer"] },
    securityAlerts:  { on: true, important: true,  label: "Security Alerts",        roles: ["all"] },
    aiPerformance:   { on: true, important: true,  label: "AI Performance KPI",     roles: ["all"] },
    threatFeed:      { on: true, important: true,  label: "Cyber Threat Feed",      roles: ["all"] },
    pdpaCompliance:  { on: true, important: true,  label: "PDPA Compliance",        roles: ["management"] },
    systemHealth:    { on: true, important: true,  label: "System Health",          roles: ["management"] },
    changeCalendar:  { on: true, important: false, label: "Change Calendar",        roles: ["management"] },
    workflowHub:     { on: true, important: false, label: "Workflow & Architecture Hub", roles: ["all"] },
    slaCountdown:    { on: true, important: false, label: "SLA Countdown Tracker",    roles: ["all"] },
    incidentHeatmap: { on: true, important: false, label: "Incident Heatmap",         roles: ["all"] },
    aiConfTrend:     { on: true, important: false, label: "AI Confidence Trends",     roles: ["all"] },
  });
  const [billingConfig, setBillingConfig] = useState({
    pricePerUser: 20, currency: "SGD", gstRate: 9, billingCycle: "Monthly",
    devAdmin: "VGC Dev Admin", devAdminEmail: "devadmin@vgctechnology.com",
    licensedUsers: USERS.length, maxUsers: 50, planName: "Enterprise",
    invoicePrefix: "VGC-INV", companyUEN: "202400001A",
    billingAddress: "1 Raffles Place, #20-61, One Raffles Place, Singapore 048616",
    paymentTerms: 30, autoRenew: true, trialEndsAt: null,
    invoices: [
      { id: "VGC-INV-2026-003", date: "25-03-2026", users: 6, subtotal: 120, gst: 10.80, total: 130.80, status: "Current", period: "Mar 2026" },
      { id: "VGC-INV-2026-002", date: "25-02-2026", users: 6, subtotal: 120, gst: 10.80, total: 130.80, status: "Paid", period: "Feb 2026" },
      { id: "VGC-INV-2026-001", date: "25-01-2026", users: 5, subtotal: 100, gst: 9.00, total: 109.00, status: "Paid", period: "Jan 2026" },
    ]
  });
  const [aiConfig, setAiConfig] = useState({
    autoTriage: true, autoAssign: true, kbSuggestions: true, slaPrediction: true,
    riskAnalysis: true, sentimentAnalysis: true, autoCategories: true,
    confidenceThreshold: 75, automationLevel: 90, humanLoopPct: 10
  });
  const [azureOpenAI, setAzureOpenAI] = useState(() => {
    const saved = typeof localStorage !== "undefined" && localStorage.getItem("vgc_azure_openai");
    const defaults = {
      endpoint: "Server-side proxy (/api/ai/chat)",
      apiKey: "Managed server-side",
      model: "gpt-5.4-pro",
      enabled: true,
      showKey: false,
      testStatus: null, // null | "testing" | "success" | "error"
      lastTested: null,
      totalCalls: 0,
    };
    if (saved) { const parsed = JSON.parse(saved); return { ...defaults, ...parsed, enabled: true }; }
    return defaults;
  });
  const [aiLoading, setAiLoading] = useState(false);
  // ─── Zendesk Integration State ──────────────────────────────────────────
  const [zdConnected, setZdConnected] = useState(false);
  const [zdUser, setZdUser] = useState(null);
  const [zdTickets, setZdTickets] = useState(() => _ls("vgc_zd_tickets", [
    { id: 48201, subject: "Cannot access VPN from home network", status: "open", priority: "high", type: "incident", created_at: "2026-04-15T09:28:00Z", updated_at: "2026-04-15T09:31:00Z", tags: ["vpn","remote-access","network"], requester_id: 401, assignee_id: 301 },
    { id: 48202, subject: "Outlook keeps crashing on startup", status: "open", priority: "normal", type: "incident", created_at: "2026-04-15T10:12:00Z", updated_at: "2026-04-15T10:16:00Z", tags: ["outlook","crash","email"], requester_id: 402, assignee_id: 302 },
    { id: 48203, subject: "Suspicious phishing email received", status: "open", priority: "urgent", type: "incident", created_at: "2026-04-15T10:58:00Z", updated_at: "2026-04-15T11:01:00Z", tags: ["phishing","security"], requester_id: 403, assignee_id: 301 },
    { id: 48204, subject: "Request for additional monitor", status: "open", priority: "low", type: "request", created_at: "2026-04-15T08:45:00Z", updated_at: "2026-04-15T08:50:00Z", tags: ["hardware","monitor","request"], requester_id: 404, assignee_id: 302 },
    { id: 48205, subject: "SharePoint site not loading", status: "open", priority: "normal", type: "incident", created_at: "2026-04-14T16:30:00Z", updated_at: "2026-04-15T09:00:00Z", tags: ["sharepoint","cloud","access"], requester_id: 405, assignee_id: 303 },
    { id: 48206, subject: "Slow internet in meeting room 3A", status: "pending", priority: "normal", type: "incident", created_at: "2026-04-14T14:20:00Z", updated_at: "2026-04-14T15:00:00Z", tags: ["network","wifi","meeting-room"], requester_id: 406, assignee_id: 301 },
    { id: 48207, subject: "Adobe Creative Cloud license expired", status: "pending", priority: "normal", type: "request", created_at: "2026-04-14T11:10:00Z", updated_at: "2026-04-14T12:00:00Z", tags: ["software","license","adobe"], requester_id: 407, assignee_id: 304 },
    { id: 48208, subject: "MFA prompt appearing every login", status: "open", priority: "high", type: "incident", created_at: "2026-04-14T09:05:00Z", updated_at: "2026-04-14T10:00:00Z", tags: ["mfa","authentication","entra-id"], requester_id: 408, assignee_id: 303 },
    { id: 48195, subject: "New laptop setup request", status: "solved", priority: "low", type: "request", created_at: "2026-04-14T14:28:00Z", updated_at: "2026-04-14T15:00:00Z", tags: ["hardware","laptop","onboarding"], requester_id: 409, assignee_id: 302 },
    { id: 48198, subject: "Printer not printing — HP LaserJet 5th floor", status: "solved", priority: "low", type: "incident", created_at: "2026-04-13T10:25:00Z", updated_at: "2026-04-13T11:00:00Z", tags: ["printer","hardware"], requester_id: 410, assignee_id: 302 },
    { id: 48190, subject: "Teams call quality poor during peak hours", status: "hold", priority: "normal", type: "problem", created_at: "2026-04-12T15:30:00Z", updated_at: "2026-04-13T09:00:00Z", tags: ["teams","network","qos"], requester_id: 411, assignee_id: 301 },
    { id: 48188, subject: "Need access to Finance SharePoint", status: "pending", priority: "normal", type: "request", created_at: "2026-04-12T10:15:00Z", updated_at: "2026-04-12T11:00:00Z", tags: ["access","sharepoint","permissions"], requester_id: 412, assignee_id: 303 },
  ]));
  const [zdStats, setZdStats] = useState(() => _ls("vgc_zd_stats", { open: 12, pending: 5, hold: 3, solved: 47 }));
  const [zdLoading, setZdLoading] = useState(false);
  const [zdError, setZdError] = useState(null);
  const [zdSelectedTicket, setZdSelectedTicket] = useState(null);
  const [zdComments, setZdComments] = useState([]);
  const [zdFilter, setZdFilter] = useState("open");
  const [zdPage, setZdPage] = useState(1);
  const [zdRenderLimit, setZdRenderLimit] = useState(200); // Phase 2A: cap initial render to keep UI snappy
  const [zdAiQueue, setZdAiQueue] = useState(() => _ls("vgc_zd_ai_queue", []));
  const [zdAiProcessing, setZdAiProcessing] = useState(false);
  const zdFetchedRef = useRef(false);
  const zdPollingRef = useRef(null);
  const [zdAutoMode, setZdAutoMode] = useState(() => _ls("vgc_zd_auto_mode", true));
  const [zdRequireHumanApproval, setZdRequireHumanApproval] = useState(() => _ls("vgc_zd_require_human_approval", false));
  const [zdAutoLog, setZdAutoLog] = useState(() => _ls("vgc_zd_auto_log", []));
  const [zdTriagedIds, setZdTriagedIds] = useState(() => { try { const v = JSON.parse(localStorage.getItem("vgc_zd_triaged_ids")); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); } });
  const [zdAutoStats, setZdAutoStats] = useState(() => normalizeZdAutoStats(_ls("vgc_zd_auto_stats", DEFAULT_ZD_AUTO_STATS)));
  const [zdAgents, setZdAgents] = useState([]);
  const [zdGroups, setZdGroups] = useState([]);
  const [zdTab, setZdTab] = useState("automation"); // automation | tickets | queue | history | settings | analytics
  const [zdExpandedRule, setZdExpandedRule] = useState(null);
  const [zdDetailItem, setZdDetailItem] = useState(null); // queue item detail modal
  const [zdAnalytics, setZdAnalytics] = useState(null);
  const [zdCsat, setZdCsat] = useState(null);
  // ─── Zendesk Full Sync State ────────────────────────────────────────
  const [zdSyncStatus, setZdSyncStatus] = useState(null);
  const [zdSyncProgress, setZdSyncProgress] = useState(null); // { phase, message }
  const [zdSyncInProgress, setZdSyncInProgress] = useState(false);
  const [zdRealTimeEnabled, setZdRealTimeEnabled] = useState(() => _ls("vgc_zd_realtime", true));
  const zdRealTimePollRef = useRef(null);
  const [zdEditingDraft, setZdEditingDraft] = useState(null);
  const [zdEditedText, setZdEditedText] = useState("");
  const [zdExpandedSections, setZdExpandedSections] = useState({}); // { "ZDAI-xxx:customer": true, ... }
  const zdToggleSection = (qId, section) => setZdExpandedSections(prev => ({ ...prev, [`${qId}:${section}`]: !prev[`${qId}:${section}`] }));
  const [zdImportProgress, setZdImportProgress] = useState(null);
  const zdBatchThrottleRef = useRef(0);
  // ─── Duplicate Detection & Merge State ───────────────────────────────────
  const [dupGroups, setDupGroups] = useState([]);
  const [showDupPanel, setShowDupPanel] = useState(false);
  const [dupScanning, setDupScanning] = useState(false);
  const [dupMerging, setDupMerging] = useState(null); // groupIndex being merged
  // ─── Workflow Automation Rules State ─────────────────────────────────────
  const [workflowRules, setWorkflowRules] = useState(() => {
    const saved = _ls("vgc_workflow_rules", null);
    return saved || [
      { id: "WF001", name: "Critical Incident Auto-Escalate", trigger: "Priority = Critical & No response in 15min", action: "Escalate to IT Manager + Send SMS alert", status: "Active", module: "Incidents", createdBy: "VGC Dev Admin", aiSuggested: false, lastModified: "2026-03-20", conditions: { field: "priority", operator: "equals", value: "Sev-A" }, slaLinked: true },
      { id: "WF002", name: "Auto-Approve Standard Changes", trigger: "Change Type = Standard & Risk = Low", action: "Auto-approve and notify assignee", status: "Active", module: "Changes", createdBy: "VGC Dev Admin", aiSuggested: false, lastModified: "2026-03-18", conditions: {}, slaLinked: false },
      { id: "WF003", name: "SLA Breach Alert", trigger: "SLA usage > 75%", action: "Send warning to assignee + manager", status: "Active", module: "SLA", createdBy: "Tenant Admin", aiSuggested: false, lastModified: "2026-03-15", conditions: {}, slaLinked: true },
      { id: "WF004", name: "Auto-Close Resolved (72h)", trigger: "Status = Resolved for 72 hours", action: "Auto-close ticket and send survey", status: "Active", module: "Incidents", createdBy: "VGC Dev Admin", aiSuggested: false, lastModified: "2026-03-22", conditions: {}, slaLinked: false },
      { id: "WF005", name: "VIP User Fast-Track", trigger: "Reporter role = VIP/Executive", action: "Set priority to High, assign senior agent", status: "Active", module: "Requests", createdBy: "Tenant Admin", aiSuggested: false, lastModified: "2026-03-10", conditions: {}, slaLinked: true },
      { id: "WF006", name: "KB Article Auto-Suggest", trigger: "New incident created", action: "AI searches KB and attaches relevant articles", status: "Active", module: "Knowledge", createdBy: "VGC Dev Admin", aiSuggested: true, lastModified: "2026-03-24", conditions: {}, slaLinked: false },
      { id: "WF007", name: "Duplicate Detection", trigger: "New incident similar to existing open ticket", action: "Alert agent and suggest linking", status: "Beta", module: "Incidents", createdBy: "VGC Dev Admin", aiSuggested: true, lastModified: "2026-03-25", conditions: {}, slaLinked: false },
      { id: "WF008", name: "Customer-Adaptive SLA Routing", trigger: "Ticket created for enterprise customer", action: "Apply customer-specific SLA and assign dedicated team", status: "Active", module: "SLA", createdBy: "AI Assist", aiSuggested: true, lastModified: "2026-03-26", conditions: {}, slaLinked: true },
      { id: "WF009", name: "Post-Resolution Survey Trigger", trigger: "Ticket status changed to Resolved", action: "Generate AI customer satisfaction survey email", status: "Active", module: "Incidents", createdBy: "VGC Dev Admin", aiSuggested: false, lastModified: "2026-03-26", conditions: {}, slaLinked: false },
    ];
  });
  const [showAddRule, setShowAddRule] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [aiRuleSuggestions, setAiRuleSuggestions] = useState([]);
  // ─── Product Vendors Contact State ──────────────────────────────────────
  const [generalSettings, setGeneralSettings] = useState(() => _ls("vgc_general_settings", { orgName: "VGC Technology Pte Ltd", timezone: "Asia/Singapore", dateFormat: "DD-MM-YYYY", language: "en" }));
  const [aiGovData, setAiGovData] = useState(null);
  const [brandingSettings, setBrandingSettings] = useState(() => _ls("vgc_branding", { productName: "", logoUrl: "", primaryColor: "#6366F1", accentColor: "#4CAF50", supportEmail: "", footerText: "" }));
  const [vendors, setVendors] = useState(() => {
    const saved = _ls("vgc_vendors", null);
    return saved || [
      { id: "V001", name: "Microsoft", category: "Cloud & Productivity", supportEmail: "support@microsoft.com", supportPhone: "+1 800-642-7676", escalationSOP: "1. Log case via Microsoft 365 Admin Center\n2. For Sev-A: call direct support line\n3. Escalate to TAM if no response in 2h", docLinks: [{ label: "Microsoft 365 Admin", url: "https://admin.microsoft.com" }, { label: "Azure Portal", url: "https://portal.azure.com" }, { label: "Service Health", url: "https://status.office.com" }], responseExpectation: "Sev-A: 1hr, Sev-B: 4hrs, Sev-C: 8hrs", notes: "Premier support contract active" },
      { id: "V002", name: "Crayon", category: "CSP / Licensing Partner", supportEmail: "support@crayon.com", supportPhone: "+65 6816 5850", escalationSOP: "1. Email support with ticket reference\n2. Call for urgent licensing issues\n3. Escalate to account manager for contract matters", docLinks: [{ label: "Crayon Portal", url: "https://www.crayon.com" }], responseExpectation: "Standard: 24hrs, Urgent: 4hrs", notes: "CSP partner for Microsoft licensing" },
      { id: "V003", name: "Dell Technologies", category: "Hardware & Infrastructure", supportEmail: "support@dell.com", supportPhone: "+65 6871 8200", escalationSOP: "1. Log case via Dell TechDirect\n2. Provide service tag and asset details\n3. For ProSupport Plus: escalate via priority line", docLinks: [{ label: "Dell TechDirect", url: "https://techdirect.dell.com" }, { label: "Dell Support", url: "https://www.dell.com/support" }], responseExpectation: "ProSupport: 2hrs onsite, Basic: NBD", notes: "ProSupport Plus warranty on all servers" },
      { id: "V004", name: "Fortinet", category: "Network Security", supportEmail: "support@fortinet.com", supportPhone: "+1 408-235-7700", escalationSOP: "1. Open ticket via FortiCare portal\n2. For critical security: call 24/7 hotline\n3. Engage SE for configuration issues", docLinks: [{ label: "FortiCare", url: "https://support.fortinet.com" }, { label: "FortiGuard", url: "https://www.fortiguard.com" }], responseExpectation: "Critical: 1hr, High: 4hrs, Medium: 8hrs", notes: "FortiGate firewall and FortiClient" },
      { id: "V005", name: "Cisco", category: "Networking & Communication", supportEmail: "tac@cisco.com", supportPhone: "+1 800-553-2447", escalationSOP: "1. Open TAC case via Cisco Support\n2. For Sev1/Sev2: call TAC directly\n3. Request duty manager for stalled cases", docLinks: [{ label: "Cisco TAC", url: "https://www.cisco.com/c/en/us/support" }], responseExpectation: "Sev1: 15min, Sev2: 1hr, Sev3: 4hrs", notes: "SmartNet contract for switches & routers" },
    ];
  });
  const [showVendorCard, setShowVendorCard] = useState(false);
  const [vendorDetailId, setVendorDetailId] = useState(null);
  const [showAddVendor, setShowAddVendor] = useState(false);
  // ─── Users & RBAC Management State ──────────────────────────────────────
  const [rbacUserSearch, setRbacUserSearch] = useState("");
  const [rbacRoleFilter, setRbacRoleFilter] = useState("all");
  const [showInviteUser, setShowInviteUser] = useState(false);
  const [inviteForm, setInviteForm] = useState({ name: "", email: "", role: "Service Desk", department: "", rbacRole: "L1 Support Engineer", phone: "", location: "" });
  const [editingUserId, setEditingUserId] = useState(null);
  const [rbacViewMode, setRbacViewMode] = useState("table"); // "table" | "cards"
  const [rbacAuditLog, setRbacAuditLog] = useState(() => _ls("vgc_rbac_audit", [
    { id: "RA001", action: "Role Changed", user: "Marcus Chen", from: "End User", to: "L1 Support Engineer", by: "VGC Admin", timestamp: "2026-03-15 09:30" },
    { id: "RA002", action: "User Invited", user: "Sofia Rodriguez", from: "—", to: "L2 Support Engineer", by: "VGC Admin", timestamp: "2026-03-16 14:15" },
    { id: "RA003", action: "Feature Updated", user: "James Wright", from: "AI: none", to: "AI: use", by: "VGC Dev Admin", timestamp: "2026-03-20 11:00" },
    { id: "RA004", action: "Role Changed", user: "David Kim", from: "L2 Support Engineer", to: "Change Manager", by: "VGC Admin", timestamp: "2026-03-22 16:45" },
  ]));
  const [customPermissions, setCustomPermissions] = useState(() => _ls("vgc_custom_permissions", RBAC_PERMISSIONS));
  const [permMatrixEditing, setPermMatrixEditing] = useState(false);
  const [permMatrixDraft, setPermMatrixDraft] = useState(null);
  const [aiRoleSuggestions, setAiRoleSuggestions] = useState({});
  // ─── Entra ID Import State ──────────────────────────────────────────────
  const [showEntraImport, setShowEntraImport] = useState(false);
  const [entraImportMode, setEntraImportMode] = useState("individual"); // "individual" | "group"
  const [entraSearchQuery, setEntraSearchQuery] = useState("");
  const [entraSearchResults, setEntraSearchResults] = useState([]);
  const [entraSearching, setEntraSearching] = useState(false);
  const [entraGroups, setEntraGroups] = useState([]);
  const [entraGroupMembers, setEntraGroupMembers] = useState([]);
  const [entraSelectedGroup, setEntraSelectedGroup] = useState(null);
  const [entraSelectedUsers, setEntraSelectedUsers] = useState([]); // [{id, displayName, mail, jobTitle, department, userPrincipalName}]
  const [entraRoleMappings, setEntraRoleMappings] = useState({}); // {userId: rbacRole}
  const [entraAiSuggestions, setEntraAiSuggestions] = useState({}); // {userId: {role, reason, confidence}}
  const [entraImporting, setEntraImporting] = useState(false);
  // ─── Custom Fields State ───────────────────────────────────────────────
  const [customFields, setCustomFields] = useState(() => _ls("vgc_custom_fields", []));
  // ─── Contracts State ──────────────────────────────────────────────────
  const [contracts, setContracts] = useState(() => _ls("vgc_contracts", []));
  // ─── Automation Rules State ──────────────────────────────────────────
  const [automationRules, setAutomationRules] = useState(() => _ls("vgc_automation_rules", []));
  // ─── SLA Calendars State ──────────────────────────────────────────────
  const [slaCalendars, setSlaCalendars] = useState([]);
  // ─── Notification Templates State ─────────────────────────────────────
  const [notifTemplates, setNotifTemplates] = useState([]);
  // ─── AI Customer Survey State ───────────────────────────────────────────
  const [surveyDraft, setSurveyDraft] = useState(null); // { incidentId, subject, body, recipient, status: "draft"|"sent" }
  const [surveyDrafts, setSurveyDrafts] = useState([]);
  const [surveyTemplates, setSurveyTemplates] = useState(() => {
    const saved = _ls("vgc_survey_templates", null);
    return saved || [
      { id: "TPL001", name: "Standard Resolution Survey", subject: "How was your experience? — {{ticketId}}", body: "Dear {{customerName}},\n\nThank you for reaching out to VGC Technology Helpdesk. We're glad to inform you that your ticket has been resolved.\n\n📋 Ticket Summary:\n• Ticket ID: {{ticketId}}\n• Issue: {{ticketTitle}}\n• Priority: {{priority}}\n• Resolved by: {{assignee}}\n• Resolution: {{resolution}}\n\nWe'd love to hear your feedback:\n\n⭐ How satisfied are you with the resolution? (1-5)\n💬 Any additional comments?\n\nYour feedback helps us improve! 🙏\n\nWarm regards,\nVGC Technology Helpdesk\n📧 help@vgctechnology.com | ☎ +65 6978 1299", severity: "all", active: true },
      { id: "TPL002", name: "Critical Incident Follow-up", subject: "Important: Follow-up on Critical Incident {{ticketId}}", body: "Dear {{customerName}},\n\nWe understand this was a critical issue that may have impacted your operations. We sincerely apologize for any inconvenience.\n\n📋 Incident Summary:\n• Ticket ID: {{ticketId}}\n• Issue: {{ticketTitle}}\n• Severity: {{priority}} (Critical)\n• Resolution Time: {{resolutionTime}}\n• Root Cause: {{resolution}}\n\nPreventive Measures:\n• We have taken steps to prevent recurrence\n• Our team will monitor closely for the next 48 hours\n\n⭐ We value your patience — please share your feedback:\n• Overall satisfaction (1-5)\n• Communication quality (1-5)\n• Resolution effectiveness (1-5)\n\nThank you for your trust.\n\nBest regards,\nVGC Technology Helpdesk", severity: "critical", active: true },
    ];
  });
  // ─── CSAT Survey Engine State (Phase 7) ────────────────────────────────
  const [csatScores, setCsatScores] = useState(null); // { total, average, nps, byAgent, byCategory, byRating, trend, sentimentBreakdown, recentComments }
  const [csatLoading, setCsatLoading] = useState(false);
  const [csatAiAnalysis, setCsatAiAnalysis] = useState(null);
  const [csatAiLoading, setCsatAiLoading] = useState(false);
  const [csatSubmitForm, setCsatSubmitForm] = useState({ ticketId: "", rating: 0, comment: "", category: "General" });
  const [csatSubmitting, setCsatSubmitting] = useState(false);
  const [csatView, setCsatView] = useState("overview"); // overview | agents | categories | comments | submit
  // ─── Change Calendar State (Phase 8) ───────────────────────────────────
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth() + 1);
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarData, setCalendarData] = useState(null); // { changes, freezeWindows, conflicts, stats }
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarSelectedDay, setCalendarSelectedDay] = useState(null);
  const [calendarView, setCalendarView] = useState("month");
  const [showCalendarForm, setShowCalendarForm] = useState(false);
  const [freezeForm, setFreezeForm] = useState({ startDate: "", endDate: "", reason: "", show: false });
  const [conflictCheckResult, setConflictCheckResult] = useState(null);
  // ─── Productivity Dashboard State ──────────────────────────────────────
  const [productivityView, setProductivityView] = useState("overview"); // overview | outlook | teams | tasks
  const [smartTasks, setSmartTasks] = useState(() => {
    const saved = _ls("vgc_smart_tasks", null);
    if (saved && Array.isArray(saved) && saved.length > 0) return saved;
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
    return [
      { id: "ST001", title: "Review & close resolved incidents older than 7 days", recurrence: "daily", category: "Incident Mgmt", priority: "High", status: "pending", nextDue: today, assignee: "All Engineers", aiSuggested: true, notes: "" },
      { id: "ST002", title: "Check SLA compliance for Sev-A tickets", recurrence: "daily", category: "SLA", priority: "Critical", status: "pending", nextDue: today, assignee: "Service Desk Lead", aiSuggested: true, notes: "" },
      { id: "ST003", title: "Review unassigned ticket queue", recurrence: "daily", category: "Queue Mgmt", priority: "High", status: "pending", nextDue: today, assignee: "L1 Support Engineer", aiSuggested: false, notes: "" },
      { id: "ST004", title: "Weekly team standup — review open incidents & changes", recurrence: "weekly", category: "Team Mgmt", priority: "Medium", status: "pending", nextDue: nextWeek, assignee: "Service Desk Lead", aiSuggested: false, notes: "" },
      { id: "ST005", title: "Update Knowledge Portal articles from resolved tickets", recurrence: "weekly", category: "Knowledge Mgmt", priority: "Medium", status: "pending", nextDue: nextWeek, assignee: "L2 Support Engineer", aiSuggested: true, notes: "" },
      { id: "ST006", title: "Patch Tuesday — review & schedule OS patching", recurrence: "monthly", category: "Change Mgmt", priority: "High", status: "pending", nextDue: "2026-04-08", assignee: "Network Engineer", aiSuggested: true, notes: "" },
      { id: "ST007", title: "Monthly SLA & KPI performance report for management", recurrence: "monthly", category: "Reports", priority: "Medium", status: "pending", nextDue: "2026-04-01", assignee: "Service Desk Lead", aiSuggested: false, notes: "" },
      { id: "ST008", title: "Quarterly PDPA compliance audit", recurrence: "quarterly", category: "Compliance", priority: "High", status: "pending", nextDue: "2026-06-01", assignee: "Tenant Admin", aiSuggested: true, notes: "" },
      { id: "ST009", title: "Bi-annual disaster recovery drill & documentation", recurrence: "6-monthly", category: "DR/BCP", priority: "Critical", status: "pending", nextDue: "2026-06-15", assignee: "VGC Dev Admin", aiSuggested: true, notes: "" },
      { id: "ST010", title: "Annual license & subscription renewal review", recurrence: "yearly", category: "Asset Mgmt", priority: "Medium", status: "pending", nextDue: "2026-12-01", assignee: "Tenant Admin", aiSuggested: false, notes: "" },
      { id: "ST011", title: "Escalate overdue Sev-B incidents to L2 support", recurrence: "daily", category: "Incident Mgmt", priority: "High", status: "pending", nextDue: yesterday, assignee: "Service Desk Lead", aiSuggested: true, notes: "" },
      { id: "ST012", title: "Verify backup completion for production servers", recurrence: "daily", category: "Infrastructure", priority: "Critical", status: "pending", nextDue: yesterday, assignee: "Network Engineer", aiSuggested: true, notes: "" },
    ];
  });
  const [currentUser, setCurrentUser] = useState(() => _ls("vgc_current_user", null));
  const [isLoggedIn, setIsLoggedIn] = useState(() => _ls("vgc_current_user", null) !== null);

  // ─── HARD RULE: Data Isolation Mode ────────────────────────────────
  // User classification for data isolation
  // (#4 follow-up, 2026-05-03) `isLocalDemoUser` was a heuristic that never matched
  // any real user (LOCAL admin has id `LOCAL-vgcdevadmin` / role `Administrator`,
  // not `DEMO-001` / `VGC Dev Admin`). Demo Experience buttons were removed in 2026-05-02,
  // so the only remaining auth paths are Entra SSO (production) and the local Dev Admin
  // (also production). All ~20 `if (isLocalDemoUser) return;` guards have been deleted.
  // isEntraProductionUser still distinguishes Entra-authed sessions for write-path gating.
  const isEntraProductionUser = !!(currentUser && currentUser.authType === "entra");
  const isEditAdmin = !!(currentUser && ["VGC Dev Admin", "Tenant Admin", "Administrator"].includes(currentUser.rbacRole));
  const portalSessionIdRef = useRef(null);
  const portalSessionStaleRef = useRef(false);

  const createPortalSessionId = useCallback(() => {
    try {
      const existing = sessionStorage.getItem("vgc_portal_session_id");
      if (existing) { portalSessionIdRef.current = existing; return existing; }
      const nextId = crypto?.randomUUID ? crypto.randomUUID() : `ps-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem("vgc_portal_session_id", nextId);
      portalSessionIdRef.current = nextId;
      return nextId;
    } catch {
      const fallback = `ps-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      portalSessionIdRef.current = fallback;
      return fallback;
    }
  }, []);

  const clearPortalSessionId = useCallback(() => {
    portalSessionIdRef.current = null;
    try { sessionStorage.removeItem("vgc_portal_session_id"); } catch (e) { /* ignore */ }
  }, []);

  const startPortalSessionNow = useCallback(async (sessionId) => {
    const activeSessionId = sessionId || createPortalSessionId();
    try {
      if (window.__vgcWaitForApiAuth) {
        const authReady = await window.__vgcWaitForApiAuth(15000);
        if (!authReady) return { ok: false, status: 401 };
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await fetch("/api/auth/session/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: activeSessionId }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) return { ok: true, data, sessionId: activeSessionId };
        if (attempt === 2) return { ok: false, status: response.status, data, sessionId: activeSessionId };
        await new Promise(resolve => setTimeout(resolve, 500 + attempt * 750));
      }
    } catch (e) {
      return { ok: false, error: e.message, sessionId: activeSessionId };
    }
    return { ok: false, sessionId: activeSessionId };
  }, [createPortalSessionId]);

  const [localUsername, setLocalUsername] = useState("");
  const [localPassword, setLocalPassword] = useState("");
  const [localLoginError, setLocalLoginError] = useState("");
  const [localLoginLoading, setLocalLoginLoading] = useState(false);
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      const { showKey, testStatus, ...persist } = azureOpenAI;
      localStorage.setItem("vgc_azure_openai", JSON.stringify(persist));
    }
  }, [azureOpenAI]);
  useEffect(() => {
    try { localStorage.setItem("vgc_dismissed_alerts", JSON.stringify(dismissedProactiveAlerts)); } catch (e) { /* ignore */ }
  }, [dismissedProactiveAlerts]);
  useEffect(() => {
    try { localStorage.setItem("vgc_card_layout", JSON.stringify(cardLayout)); } catch (e) { /* ignore */ }
  }, [cardLayout]);

  // ─── GLOBAL AI ERROR INTERCEPTOR (Hard Rule: AI must solve every error) ──
  useEffect(() => {
    const handleGlobalError = (event) => {
      // Ignore benign errors (ResizeObserver, script loading, etc.)
      const msg = event?.message || event?.reason?.message || String(event?.reason || "");
      if (/ResizeObserver|Script error|Loading chunk|dynamically imported module/i.test(msg)) return;
      // Avoid infinite loops — don't trigger on AI resolver errors
      if (/ai\/resolve-error|AI Error Resolver/i.test(msg)) return;
      setErrorAdvisory({
        type: "Application Error",
        code: event?.error?.name || event?.reason?.name || "UNCAUGHT",
        message: msg || "An unexpected error occurred",
        timestamp: new Date().toISOString(),
        details: event?.filename ? `File: ${event.filename}:${event.lineno}:${event.colno}` : "Unhandled promise rejection",
        stack: event?.error?.stack || event?.reason?.stack || ""
      });
    };
    window.addEventListener("error", handleGlobalError);
    const handleRejection = (e) => handleGlobalError({ message: e.reason?.message || String(e.reason), error: e.reason, reason: e.reason });
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleGlobalError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── HARD RULE: Data Isolation — Demo vs Production ─────────────────
  // Rule 1: Demo user (devadmin) must NEVER see production Zendesk data
  // Rule 2: Entra ID users must ONLY see production data — zero demo/hardcoded data
  useEffect(() => {
    if (!currentUser) return;
    if (isEntraProductionUser) {
      // Always clear Zendesk demo state for Entra users
      setZdTickets([]);
      setZdStats({ open: 0, pending: 0, hold: 0, solved: 0 });
      setZdAiQueue([]);
      setZdAutoLog([]);
      setZdAutoStats(DEFAULT_ZD_AUTO_STATS);
      // Clear any cached demo data from localStorage
      ["vgc_zd_tickets","vgc_zd_stats","vgc_zd_ai_queue","vgc_zd_auto_log","vgc_zd_auto_stats",
       "vgc_incidents","vgc_problems","vgc_changes","vgc_requests","vgc_assets","vgc_customers"].forEach(k => localStorage.removeItem(k));
      // ALWAYS re-hydrate ITSM data from server DB for production users
      // This ensures Entra users ONLY see Zendesk-synced production data
      (async () => {
        try {
          const seedPattern = /^(INC000|PRB000|CHG000|REQ000)\d$/;
          const isSeedLinked = (item) => item.title?.includes("Problem from INC000") || item.linkedIncidents?.some(id => /^INC000\d$/.test(id)) || item.incidents?.some?.(id => /^INC000\d$/.test(id));
          const collections = [
            ["incidents", setIncidents], ["problems", setProblems],
            ["changes", setChanges], ["requests", setRequests],
            ["assets", setAssets], ["customers", setCustomers],
            ["kb", setKbArticles],
          ];
          // Hydrate all collections in parallel for faster initial load
          await Promise.all(collections.map(async ([coll, setter]) => {
            try {
              const r = await fetch(`/api/db/${coll}`);
              if (!r.ok) return;
              const data = await r.json();
              const items = Array.isArray(data) ? data.map(d => typeof d.data === "string" ? JSON.parse(d.data) : (d.data || d)) : (data.data || []);
              const productionItems = items.filter(item => !seedPattern.test(item.id) && !isSeedLinked(item));
              setter(productionItems.length > 0 ? productionItems : []);
            } catch (e) { /* per-collection error isolated */ }
          }));
          // Also clean seed data from the DB itself
          // SECURITY (#1 follow-up, 2026-05-03): auto-call removed. /api/db-clean-seed is now
          // admin-gated and dry-run by default; admins can trigger it from the Data Hygiene UI.
          // Previously this fired on every Entra login and produced harmless 401s in network/audit logs.
        } catch (e) { console.warn("[DATA ISOLATION] DB re-hydration failed:", e.message); }
      })();
    }
  }, [currentUser, isEntraProductionUser]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.__vgcGetPortalSessionId = () => portalSessionIdRef.current || sessionStorage.getItem("vgc_portal_session_id") || "";
    return () => { if (window.__vgcGetPortalSessionId) delete window.__vgcGetPortalSessionId; };
  }, []);

  const clearAppSessionState = useCallback(() => {
    setIsLoggedIn(false);
    setCurrentUser(null);
    setCustomers([]);
    setServiceReports([]);
    setZdTickets([]);
    setZdStats({ open: 0, pending: 0, hold: 0, solved: 0 });
    setZdAiQueue([]);
    clearPortalSessionId();
    try {
      sessionStorage.removeItem("vgc_current_user");
      localStorage.removeItem("vgc_current_user");
      ["vgc_customers","vgc_service_reports","vgc_zd_tickets","vgc_zd_stats","vgc_zd_ai_queue","vgc_zd_auto_log","vgc_zd_auto_stats"].forEach(k => localStorage.removeItem(k));
    } catch (e) { /* ignore */ }
  }, [clearPortalSessionId]);

  const endPortalSession = useCallback(async () => {
    const sessionId = portalSessionIdRef.current || sessionStorage.getItem("vgc_portal_session_id");
    if (!sessionId || !isEntraProductionUser) { clearPortalSessionId(); return; }
    try {
      await fetch("/api/auth/session/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    } catch (e) { /* ignore */ }
    clearPortalSessionId();
  }, [clearPortalSessionId, isEntraProductionUser]);

  useEffect(() => {
    if (!isEntraProductionUser || !currentUser?.email) return;
    portalSessionStaleRef.current = false;
    let stopped = false;
    let heartbeatTimer = null;
    const email = currentUser.email.toLowerCase();
    const sessionId = createPortalSessionId();
    const staleSignOut = (detail) => {
      if (portalSessionStaleRef.current) return;
      portalSessionStaleRef.current = true;
      showToast("This ITSM session was signed out because another active session was opened for your Entra user.", "warning");
      setErrorAdvisory({
        type: "Session Control",
        code: detail?.code || "STALE_SESSION",
        message: "Another ITSM session is active for this Entra user.",
        timestamp: new Date().toISOString(),
        details: "The previous app session was cleared to prevent concurrent access to production ITSM data.",
        stack: "",
      });
      clearAppSessionState();
    };
    const heartbeat = async () => {
      try {
        const response = await fetch("/api/auth/session/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        if (response.status === 409) return staleSignOut(await response.json().catch(() => ({})));
        if (!response.ok) return;
        const data = await response.json().catch(() => ({}));
        if (data && data.active === false) staleSignOut(data);
      } catch (e) { /* ignore */ }
    };
    const start = async () => {
      try {
        const result = await startPortalSessionNow(sessionId);
        if (!result.ok) return;
        localStorage.setItem("vgc_active_session_marker", JSON.stringify({ email, sessionId, ts: Date.now() }));
        if (!stopped) {
          await heartbeat();
          heartbeatTimer = setInterval(heartbeat, 30000);
        }
      } catch (e) { /* ignore */ }
    };
    const onStorage = (event) => {
      if (event.key !== "vgc_active_session_marker" || !event.newValue) return;
      try {
        const marker = JSON.parse(event.newValue);
        if (marker.email === email && marker.sessionId && marker.sessionId !== sessionId) staleSignOut({ code: "STALE_SESSION" });
      } catch (e) { /* ignore */ }
    };
    const onServerStale = (event) => staleSignOut(event.detail || { code: "STALE_SESSION" });
    window.addEventListener("storage", onStorage);
    window.addEventListener("vgc:portal-session-stale", onServerStale);
    start();
    return () => {
      stopped = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("vgc:portal-session-stale", onServerStale);
    };
  }, [clearAppSessionState, createPortalSessionId, currentUser?.email, isEntraProductionUser, startPortalSessionNow]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── DEMO MODE REMOVED ─── Production data only, loaded from DB

  // Fetch live cyber news for dashboard threat feed
  useEffect(() => {
    fetch("/api/cybernews").then(r => r.json()).then(data => {
      if (data.threats && data.threats.length > 0) setDashboardThreats(data.threats.slice(0, 5));
    }).catch(() => {});
  }, []);

  // Fetch live Meraki data
  useEffect(() => {
    setMerakiLoading(true);
    fetch("/api/meraki").then(r => r.json()).then(data => {
      if (!data.error) setMerakiData(data);
    }).catch(() => {}).finally(() => setMerakiLoading(false));
  }, []);

  // Fetch live SolarWinds RMM data
  useEffect(() => {
    setSolarwindsLoading(true);
    fetch("/api/solarwinds").then(r => r.json()).then(data => {
      if (!data.error) setSolarwindsData(data);
    }).catch(() => {}).finally(() => setSolarwindsLoading(false));
  }, []);

  // Fetch live Sophos data
  useEffect(() => {
    setSophosLoading(true);
    fetch("/api/sophos").then(r => r.json()).then(data => {
      if (!data.error) setSophosData(data);
    }).catch(() => {}).finally(() => setSophosLoading(false));
  }, []);

  // ─── Microsoft Entra ID SSO — Token & Graph Logic ────────────────────
  const getAccessToken = useCallback(async (scopes) => {
    if (!accounts || accounts.length === 0) return null;
    try {
      const resp = await msalInstance.acquireTokenSilent({ scopes, account: accounts[0] });
      return resp.accessToken;
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        try {
          const resp = await msalInstance.acquireTokenPopup({ scopes });
          return resp.accessToken;
        } catch { return null; }
      }
      return null;
    }
  }, [msalInstance, accounts]);

  const fetchGraphData = useCallback(async () => {
    if (graphFetchedRef.current) return;
    graphFetchedRef.current = true;
    setGraphLoading(true);
    setGraphError(null);
    try {
      const profileToken = await getAccessToken(graphScopes.login);
      if (profileToken) {
        const [profile, photo] = await Promise.all([
          getMyProfile(profileToken).catch(() => null),
          getMyPhoto(profileToken).catch(() => null),
        ]);
        if (profile) setMsalUser(profile);
        if (photo) { setMsalPhoto(photo); setProfilePhoto(photo); }
      }
      const mailToken = await getAccessToken([...graphScopes.login, ...graphScopes.mail]);
      if (mailToken) {
        const [emailsResp, unreadCount] = await Promise.all([
          getRecentEmails(mailToken, 10).catch(() => null),
          getUnreadCount(mailToken).catch(() => null),
        ]);
        if (emailsResp?.value) setGraphEmails(emailsResp.value);
        if (unreadCount !== null) setGraphUnread(unreadCount);
      }
      const calToken = await getAccessToken([...graphScopes.login, ...graphScopes.calendar]);
      if (calToken) {
        const events = await getTodayEvents(calToken).catch(() => null);
        if (events?.value) setGraphCalendar(events.value);
      }
      const chatToken = await getAccessToken([...graphScopes.login, ...graphScopes.chat]);
      if (chatToken) {
        const [chats, teams] = await Promise.all([
          getRecentChats(chatToken, 10).catch(() => null),
          getJoinedTeams(chatToken).catch(() => null),
        ]);
        if (chats?.value) setGraphChats(chats.value);
        if (teams?.value) setGraphTeams(teams.value);
      }
      const presToken = await getAccessToken([...graphScopes.login, ...graphScopes.presence]);
      if (presToken) {
        const presence = await getMyPresence(presToken).catch(() => null);
        if (presence) setGraphPresence(presence);
      }
    } catch (err) {
      console.error("Graph API error:", err);
      setGraphError(err.message || "Unknown error fetching Graph data");
      graphFetchedRef.current = false;
      setErrorAdvisory({
        type: "Microsoft 365 Graph API",
        code: err.statusCode || err.code || "GRAPH_API_ERROR",
        message: err.message || "Failed to fetch Microsoft 365 data",
        timestamp: new Date().toISOString(),
        details: "The Microsoft Graph API returned an error while fetching your email, calendar, or Teams data. This may be due to insufficient API permissions, expired tokens, or network connectivity issues.",
        stack: err.stack?.substring(0, 500) || ""
      });
    } finally {
      setGraphLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (isMsalAuthenticated && accounts.length > 0 && !graphFetchedRef.current) {
      fetchGraphData();
    }
  }, [isMsalAuthenticated, accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isMsalAuthenticated && accounts.length > 0 && !currentUser) {
      const acct = accounts[0];
      if (!acct || !acct.username) return;
      const email = acct.username.toLowerCase();
      const matched = USERS.find(u => (u.email || "").toLowerCase() === email);

      // Recover fallback user stored before loginRedirect navigated away
      let fallbackUser = null;
      try {
        const stored = sessionStorage.getItem("itsm_sso_fallback");
        if (stored) { fallbackUser = JSON.parse(stored); sessionStorage.removeItem("itsm_sso_fallback"); }
      } catch (e) { /* ignore */ }

      // Enrich with live Entra ID data, load DB-stored role, then set user
      (async () => {
        let entraProfile = null;
        let entraUsersList = [];
        try {
          const sync = await fetch("/api/entra/users");
          if (sync.ok) {
            const syncData = await sync.json();
            entraUsersList = syncData.users || [];
            entraProfile = entraUsersList.find(u => u.email === email);
          }
        } catch (e) { /* ignore */ }

        // ─── Bulk-prefetch Entra user photos (cached server-side, 24h TTL) ──
        // Stored in localStorage `vgc_entra_photos` and exposed globally via
        // window.__getEntraPhoto(emailOrId). Existing avatar render sites can
        // light up automatically when photos arrive.
        try {
          if (entraUsersList.length > 0) {
            const cached = JSON.parse(localStorage.getItem("vgc_entra_photos") || "{}");
            const cacheTs = Number(localStorage.getItem("vgc_entra_photos_ts") || 0);
            const isStale = (Date.now() - cacheTs) > 12 * 3600 * 1000;
            const ids = entraUsersList.map(u => u.entraObjectId).filter(Boolean);
            const missing = isStale ? ids : ids.filter(id => !(id in cached));
            if (missing.length > 0) {
              // Chunk to keep request bodies small (max 200 per call on server)
              for (let i = 0; i < missing.length; i += 100) {
                const slice = missing.slice(i, i + 100);
                fetch("/api/entra/users/photos", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ entraIds: slice }),
                }).then(r => r.ok ? r.json() : null).then(d => {
                  if (!d || !d.photos) return;
                  const merged = { ...cached, ...d.photos };
                  localStorage.setItem("vgc_entra_photos", JSON.stringify(merged));
                  localStorage.setItem("vgc_entra_photos_ts", String(Date.now()));
                  // Build email→photo lookup for O(1) access
                  const byEmail = {};
                  entraUsersList.forEach(u => { if (u.email && merged[u.entraObjectId]) byEmail[u.email.toLowerCase()] = merged[u.entraObjectId]; });
                  window.__vgcEntraPhotos = { byId: merged, byEmail };
                  window.dispatchEvent(new CustomEvent("vgc:photos-updated"));
                }).catch(() => {});
              }
            } else {
              const byEmail = {};
              entraUsersList.forEach(u => { if (u.email && cached[u.entraObjectId]) byEmail[u.email.toLowerCase()] = cached[u.entraObjectId]; });
              window.__vgcEntraPhotos = { byId: cached, byEmail };
            }
            window.__getEntraPhoto = (emailOrId) => {
              if (!emailOrId || !window.__vgcEntraPhotos) return null;
              const key = String(emailOrId).toLowerCase();
              return window.__vgcEntraPhotos.byEmail[key] || window.__vgcEntraPhotos.byId[emailOrId] || null;
            };
          }
        } catch (e) { /* photo prefetch is best-effort */ }

        // Load DB-stored role (persisted from GUI edits)
        let dbStoredRole = null;
        try {
          const dbResp = await fetch("/api/db/users");
          if (dbResp.ok) {
            const dbUsers = await dbResp.json();
            const dbUser = (Array.isArray(dbUsers) ? dbUsers : []).find(u => {
              const d = typeof u.data === "string" ? JSON.parse(u.data) : (u.data || u);
              return d.email?.toLowerCase() === email;
            });
            if (dbUser) {
              const d = typeof dbUser.data === "string" ? JSON.parse(dbUser.data) : (dbUser.data || dbUser);
              dbStoredRole = d.rbacRole || null;
            }
          }
        } catch (e) { /* ignore */ }

        // Determine role: DB-stored > DEV_ADMIN check > ADMIN check > default L1 Support
        const determineRole = (baseRole) => {
          if (dbStoredRole) return dbStoredRole;
          const isDevAdmin = DEV_ADMIN_EMAILS.some(ae => ae.toLowerCase() === email);
          if (isDevAdmin) return "VGC Dev Admin";
          const isAdmin = ADMIN_EMAILS.some(ae => ae.toLowerCase() === email);
          if (isAdmin) return "Tenant Admin";
          return baseRole || "L1 Support Engineer";
        };

        let nextCurrentUser;
        if (matched) {
          nextCurrentUser = {
            ...matched,
            rbacRole: determineRole(matched.rbacRole),
            authType: "entra",
            entraEmail: email,
            ...(entraProfile ? { department: entraProfile.department, location: entraProfile.location, phone: entraProfile.phone, entraObjectId: entraProfile.entraObjectId } : {}),
          };
        } else if (fallbackUser) {
          const role = determineRole(fallbackUser.rbacRole);
          nextCurrentUser = {
            ...fallbackUser,
            id: "SSO-" + (acct.localAccountId || "").substring(0, 8),
            name: acct.name || fallbackUser.name,
            email: acct.username || fallbackUser.email,
            avatar: (acct.name || fallbackUser.name).substring(0, 2).toUpperCase(),
            rbacRole: role,
            authType: "entra",
            entraEmail: email,
            ...(entraProfile ? { department: entraProfile.department, location: entraProfile.location, phone: entraProfile.phone, role: entraProfile.role, entraObjectId: entraProfile.entraObjectId } : {}),
          };
        } else {
          const role = determineRole(null);
          nextCurrentUser = {
            id: "SSO-" + (acct.localAccountId || "").substring(0, 8),
            name: acct.name || acct.username,
            role: entraProfile?.role || "IT Staff",
            avatar: (acct.name || "U").substring(0, 2).toUpperCase(),
            team: "IT Operations",
            gender: "unspecified",
            rbacRole: role,
            email: acct.username,
            phone: "",
            location: "Singapore",
            department: "IT",
            pcName: "",
            employeeId: "",
            authType: "entra",
            entraEmail: email,
            ...(entraProfile ? { department: entraProfile.department, location: entraProfile.location, phone: entraProfile.phone, role: entraProfile.role, entraObjectId: entraProfile.entraObjectId } : {}),
          };
        }

        await startPortalSessionNow();
        setCurrentUser(nextCurrentUser);

        // Auto-add to managedUsers if first-time login (enables GUI role editing & DB persistence)
        setManagedUsers(prev => {
          const exists = prev.some(u => u.email?.toLowerCase() === email);
          if (exists) return prev;
          const newUser = {
            id: "SSO-" + (acct.localAccountId || "").substring(0, 8),
            name: acct.name || acct.username,
            role: entraProfile?.role || "IT Staff",
            avatar: (acct.name || "U").substring(0, 2).toUpperCase(),
            team: entraProfile?.department || "IT Operations",
            gender: "unspecified",
            rbacRole: determineRole(null),
            email: acct.username?.toLowerCase(),
            phone: entraProfile?.phone || "",
            location: entraProfile?.location || "Singapore",
            department: entraProfile?.department || "IT",
            pcName: "",
            employeeId: "",
            authType: "entra",
            entraObjectId: entraProfile?.entraObjectId || "",
            ssoProvider: "Entra ID",
            firstLoginAt: new Date().toISOString(),
          };
          return [...prev, newUser];
        });

        setIsLoggedIn(true);
      })();
    }
  }, [isMsalAuthenticated, accounts, currentUser, startPortalSessionNow]);

  // ─── Prevent Browser Back Button (keep session alive until sign-out) ──
  useEffect(() => {
    if (!isLoggedIn) return;
    const handlePopState = () => {
      window.history.pushState(null, "", window.location.href);
    };
    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isLoggedIn]);

  // ─── Live Weather Advisory Alert (trusted official sources only) ──────
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    let autoDismissTimer;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/weather/disaster-alert");
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.active || !data.alert) return;
        const alert = data.alert;
        const alertId = alert.id || `${alert.type || "weather"}:${alert.updatedAt || alert.checkedAt || Date.now()}`;
        const dismissKey = `vgc_disaster_dismissed:${alertId}`;
        const sessionKey = `vgc_disaster_seen:${alertId}`;
        try {
          if (localStorage.getItem(dismissKey) === "true" || sessionStorage.getItem(sessionKey) === "true") return;
          sessionStorage.setItem(sessionKey, "true");
        } catch (e) { /* ignore */ }
        if (cancelled) return;
        setDisasterAlert({ ...alert, id: alertId });
        autoDismissTimer = setTimeout(() => setDisasterAlert(null), 10000);
      } catch (e) {
        // No popup on source errors. Accuracy beats noisy fallback alerts.
      }
    }, 4000);
    return () => { cancelled = true; clearTimeout(timer); clearTimeout(autoDismissTimer); };
  }, [isLoggedIn]);

  const dismissDisasterAlert = useCallback(() => {
    const alertId = disasterAlert?.id;
    setDisasterAlert(null);
    try { if (alertId) localStorage.setItem(`vgc_disaster_dismissed:${alertId}`, "true"); } catch (e) { /* ignore */ }
  }, [disasterAlert]);

  // ─── High-Severity Incident Auto-Escalation Engine ────────────────────
  // Generates correlation IDs for all escalation actions
  const genCorrelationId = useCallback(() => `ESC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`, []);

  // Log escalation action with correlation ID
  const logEscalation = useCallback((entry) => {
    const logEntry = { ...entry, timestamp: new Date().toISOString(), correlationId: entry.correlationId || genCorrelationId() };
    setEscalationLog(prev => { const updated = [logEntry, ...prev].slice(0, 200); _save("vgc_escalation_log", updated); return updated; });
    return logEntry;
  }, [genCorrelationId]);

  // Initiate Teams Phone auto-call (simulated — real implementation needs Graph Communications API)
  const initiateAutoCall = useCallback((incident, contactList, correlationId) => {
    if (!escalationConfig.autoCallEnabled) {
      logEscalation({ type: "CALL_SKIPPED", incidentId: incident.id, reason: "Auto-call disabled by admin", correlationId });
      return;
    }
    // Rate limiting check
    const lastCall = escalationCallRef.current.get(incident.id);
    if (lastCall && (Date.now() - lastCall) < escalationConfig.rateLimitMinutes * 60000) {
      logEscalation({ type: "CALL_RATE_LIMITED", incidentId: incident.id, reason: `Rate limit: ${escalationConfig.rateLimitMinutes}min cooldown`, correlationId });
      return;
    }
    escalationCallRef.current.set(incident.id, Date.now());

    const callTargets = [...contactList].sort((a, b) => a.priority - b.priority);
    callTargets.forEach((contact, idx) => {
      const delay = escalationConfig.callOrder === "sequential" ? idx * 30000 : 0; // 30s gap for sequential
      setTimeout(() => {
        const callLog = logEscalation({
          type: "AUTO_CALL_INITIATED",
          incidentId: incident.id,
          incidentTitle: incident.title,
          priority: incident.priority,
          contactName: contact.label,
          contactNumber: contact.number,
          callOrder: idx + 1,
          message: `This is an automated critical alert from VGC AI Assist. A ${incident.priority} incident "${incident.title}" has not been picked up and requires immediate attention. Incident ID: ${incident.id}.`,
          status: "attempted",
          correlationId,
        });
        // Simulate call result after 15s (in production: use Graph Communications Cloud API)
        setTimeout(() => {
          logEscalation({ type: "AUTO_CALL_RESULT", incidentId: incident.id, contactName: contact.label, contactNumber: contact.number, result: "voicemail", duration: "12s", correlationId });
        }, 15000);
      }, delay);
    });
  }, [escalationConfig, logEscalation]);

  // Teams channel notification (simulated — real: Graph POST /teams/{id}/channels/{id}/messages)
  const notifyTeamsChannel = useCallback((incident, correlationId) => {
    if (!escalationConfig.teamsChannelNotify) return;
    logEscalation({
      type: "TEAMS_CHANNEL_NOTIFY",
      incidentId: incident.id,
      incidentTitle: incident.title,
      priority: incident.priority,
      channel: "#critical-incidents",
      message: `🚨 AUTO-ESCALATION: ${incident.priority} incident ${incident.id} — "${incident.title}" has exceeded pickup window. Immediate action required. @on-call`,
      status: "sent",
      correlationId,
    });
  }, [escalationConfig, logEscalation]);

  // Email fallback
  const sendEscalationEmail = useCallback((incident, correlationId) => {
    if (!escalationConfig.emailFallback) return;
    logEscalation({
      type: "EMAIL_FALLBACK",
      incidentId: incident.id,
      incidentTitle: incident.title,
      to: "devadmin@vgctechnology.com",
      subject: `🚨 AUTO-ESCALATION: ${incident.priority} — ${incident.id} — ${incident.title}`,
      status: "queued",
      correlationId,
    });
  }, [escalationConfig, logEscalation]);

  // Core escalation monitor — runs every 30 seconds
  useEffect(() => {
    if (!isLoggedIn || !escalationConfig.enabled) return;
    const checkEscalation = () => {
      const now = Date.now();
      // Find unassigned or unacknowledged Sev-A/B incidents
      const criticalUnpicked = incidents.filter(inc => {
        if (inc.status === "Resolved" || inc.status === "Closed") return false;
        if (inc.priority !== "Sev-A" && inc.priority !== "Sev-B") return false;
        // Check if within pickup window
        const createdMs = now - (inc.created * 3600000); // inc.created is hours ago
        const windowMs = (inc.priority === "Sev-A" ? escalationConfig.sevAPickupWindow : escalationConfig.sevBPickupWindow) * 60000;
        // If incident is older than pickup window and still Open (not In Progress)
        if (inc.status === "Open" && createdMs > windowMs) return true;
        return false;
      });

      if (criticalUnpicked.length > 0) {
        const worst = criticalUnpicked.sort((a, b) => (a.priority === "Sev-A" ? -1 : 1))[0];
        const correlationId = genCorrelationId();

        // Step 1: Global high alert
        setGlobalHighAlert({
          incident: worst,
          allCritical: criticalUnpicked,
          startedAt: now,
          correlationId,
          escalationPhase: "pickup_window", // pickup_window → auto_escalating → escalated
          callsInitiated: false,
        });

        logEscalation({
          type: "GLOBAL_HIGH_ALERT",
          incidentId: worst.id,
          incidentTitle: worst.title,
          priority: worst.priority,
          totalUnpicked: criticalUnpicked.length,
          correlationId,
        });

        // Step 2: If past pickup window — auto-escalate
        const worstAge = now - (worst.created * 3600000);
        const worstWindow = (worst.priority === "Sev-A" ? escalationConfig.sevAPickupWindow : escalationConfig.sevBPickupWindow) * 60000;
        if (worstAge > worstWindow * 1.5) {
          // Full escalation — calls, Teams, email
          setGlobalHighAlert(prev => prev ? { ...prev, escalationPhase: "auto_escalating", callsInitiated: true } : prev);

          logEscalation({ type: "AUTO_ESCALATION_TRIGGERED", incidentId: worst.id, priority: worst.priority, reason: "No engineer picked up within SLA window", correlationId });

          // Determine call targets — Sev-A always calls helpdesk
          const callTargets = escalationConfig.callNumbers.filter(c => !c.sevAOnly || worst.priority === "Sev-A");
          initiateAutoCall(worst, callTargets, correlationId);
          notifyTeamsChannel(worst, correlationId);
          sendEscalationEmail(worst, correlationId);
        }
      } else {
        // Clear alert if all critical incidents are handled
        setGlobalHighAlert(prev => {
          if (prev) logEscalation({ type: "HIGH_ALERT_CLEARED", reason: "All critical incidents assigned or resolved", correlationId: prev.correlationId });
          return null;
        });
      }
    };

    // Run immediately then every 30s
    checkEscalation();
    escalationTimerRef.current = setInterval(checkEscalation, 30000);
    return () => { if (escalationTimerRef.current) clearInterval(escalationTimerRef.current); };
  }, [isLoggedIn, incidents, escalationConfig, genCorrelationId, initiateAutoCall, notifyTeamsChannel, sendEscalationEmail, logEscalation]);

  // Persist escalation config
  useEffect(() => { _save("vgc_escalation_config", escalationConfig); _dbSync("escalation_config", [{ id: "config", ...escalationConfig }]); }, [escalationConfig]); // eslint-disable-line react-hooks/exhaustive-deps
  // Sync additional collections to DB
  useEffect(() => { _dbSync("vendors", vendors); }, [vendors]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _dbSync("workflow_rules", workflowRules); }, [workflowRules]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _dbSync("survey_templates", surveyTemplates); }, [surveyTemplates]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _dbSync("smart_tasks", smartTasks); }, [smartTasks]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _dbSync("escalation_log", escalationLog); }, [escalationLog]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Chat Auto-Scroll ──────────────────────────────────────────────────
  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    if (floatingChatEndRef.current) floatingChatEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [aiMessages, aiLoading]);

  // ─── AI Idle Nudge System ──────────────────────────────────────────────
  useEffect(() => {
    if (aiIdleTimerRef.current) clearTimeout(aiIdleTimerRef.current);
    setAiIdleNudge(null);
    aiIdleTimerRef.current = setTimeout(() => {
      const pendingApprovals = changes.filter(c => c.status === "Submitted" || c.status === "Review");
      const criticalOpen = incidents.filter(i => i.priority === "Sev-A" && i.status !== "Resolved" && i.status !== "Closed");
      const nearBreach = incidents.filter(i => i.status !== "Resolved" && i.status !== "Closed" && computeIncidentSla(i).pctUsed >= 80);
      if (criticalOpen.length > 0) {
        setAiIdleNudge({ icon: "🔴", text: `${criticalOpen.length} critical ticket${criticalOpen.length > 1 ? "s" : ""} need attention`, action: "Show me all Sev-A incidents", urgency: "critical" });
      } else if (pendingApprovals.length > 0) {
        setAiIdleNudge({ icon: "📋", text: `${pendingApprovals.length} change${pendingApprovals.length > 1 ? "s" : ""} awaiting your approval`, action: "Show pending change approvals", urgency: "medium" });
      } else if (nearBreach.length > 0) {
        setAiIdleNudge({ icon: "⏱️", text: `${nearBreach.length} ticket${nearBreach.length > 1 ? "s" : ""} near SLA breach`, action: "Which tickets are near SLA breach?", urgency: "high" });
      } else {
        setAiIdleNudge({ icon: "💡", text: "All clear! Ask me for your morning briefing", action: "Give me my morning briefing", urgency: "info" });
      }
    }, 15000);
    return () => { if (aiIdleTimerRef.current) clearTimeout(aiIdleTimerRef.current); };
  }, [aiMessages, incidents, changes]); // removed aiInput — was recreating timer on every keystroke

  // ─── AI Nudge Auto-Dismiss (5 seconds) ──────────────────────────────
  useEffect(() => {
    if (!aiIdleNudge) return;
    const t = setTimeout(() => setAiIdleNudge(null), 5000);
    return () => clearTimeout(t);
  }, [aiIdleNudge]);

  // ─── Proactive AI Alert Engine ──────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return;
    const checkProactiveAlerts = () => {
      const newAlerts = [];
      const now = Date.now();
      // Check SLA breaches about to happen
      incidents.filter(i => i.assignee === currentUser.name && i.status !== "Resolved" && i.status !== "Closed").forEach(inc => {
        const sla = computeIncidentSla(inc);
        if (sla.pctUsed >= 90 && !sla.isBreached && !dismissedProactiveAlerts.includes(`sla-${inc.id}`)) {
          newAlerts.push({ id: `sla-${inc.id}`, type: "sla_warning", severity: "high", title: `⏱️ SLA About to Breach: ${inc.id}`, detail: `${inc.title} — only ${Math.round(sla.remainingHours)}h remaining. Act now to avoid breach.`, action: "Escalate or resolve immediately", ticketId: inc.id, timestamp: now });
        }
        if (sla.isBreached && !dismissedProactiveAlerts.includes(`breach-${inc.id}`)) {
          newAlerts.push({ id: `breach-${inc.id}`, type: "sla_breach", severity: "critical", title: `🚨 SLA BREACHED: ${inc.id}`, detail: `${inc.title} — SLA target exceeded by ${Math.round(sla.hoursElapsed - sla.slaTarget)}h. Immediate action required.`, action: "Escalate to management immediately", ticketId: inc.id, timestamp: now });
        }
      });
      // Check for critical security alerts
      SECURITY_ALERTS.filter(a => a.severity === "Critical" && a.status === "Active" && !dismissedProactiveAlerts.includes(`sec-${a.id}`)).forEach(alert => {
        newAlerts.push({ id: `sec-${alert.id}`, type: "security", severity: "critical", title: `🛡️ Critical Security: ${alert.title}`, detail: `${alert.type} — Active critical security threat detected. Business impact: potential data loss or service disruption.`, action: "Initiate incident response protocol", timestamp: now });
      });
      // Workload overload detection
      const openCount = incidents.filter(i => i.assignee === currentUser.name && i.status !== "Resolved" && i.status !== "Closed").length;
      if (openCount >= 5 && !dismissedProactiveAlerts.includes("workload-high")) {
        newAlerts.push({ id: "workload-high", type: "workload", severity: "medium", title: "📊 High Workload Detected", detail: `You have ${openCount} open tickets. AI suggests delegating low-priority items to maintain quality and well-being.`, action: "Review and delegate Sev-C/D tickets", timestamp: now });
      }
      // Pattern detection — repeated category
      const cats = incidents.filter(i => i.status !== "Resolved" && i.status !== "Closed").map(i => i.category);
      const catCount = {};
      cats.forEach(c => { catCount[c] = (catCount[c] || 0) + 1; });
      Object.entries(catCount).filter(([, c]) => c >= 3).forEach(([cat, cnt]) => {
        if (!dismissedProactiveAlerts.includes(`pattern-${cat}`)) {
          newAlerts.push({ id: `pattern-${cat}`, type: "prediction", severity: "medium", title: `🔮 Pattern: ${cnt} recurring ${cat} incidents`, detail: `${cnt} open ${cat} incidents detected. This may indicate a systemic issue requiring a Problem record.`, action: `Create Problem record for ${cat} category`, timestamp: now });
        }
      });
      if (newAlerts.length > 0) setProactiveAlerts(prev => { const ids = prev.map(a => a.id); return [...prev, ...newAlerts.filter(a => !ids.includes(a.id))]; });
    };
    checkProactiveAlerts();
    const interval = setInterval(() => { if (!tabVisibleRef.current) return; checkProactiveAlerts(); }, 30000);
    return () => clearInterval(interval);
  }, [incidents, dismissedProactiveAlerts, currentUser]);

  // ─── AI Actions Engine: Monitor + Approval Workflow ──────────────────
  // Fetch AI actions from server
  const fetchAiActions = useCallback(async (statusFilter) => {
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : "";
      const r = await fetch(`/api/ai/actions${qs}`);
      if (r.ok) {
        const data = await r.json();
        setAiActions(data.actions || []);
        _save("vgc_ai_actions", data.actions || []);
        return data.actions;
      }
    } catch (e) { console.warn("[AI Actions] Fetch error:", e.message); }
    return [];
  }, []);

  // Run AI monitor scan
  const runAiMonitor = useCallback(async () => {
    if (aiActionsLoading || !isLoggedIn) return;
    setAiActionsLoading(true);
    try {
      const openIncidents = incidents.filter(i => i.status === "Open" || i.status === "In Progress");
      const openChanges = changes.filter(c => c.status === "Awaiting Approval" || c.status === "Implementing");
      if (openIncidents.length === 0 && openChanges.length === 0) {
        setAiActionsLoading(false);
        setAiMonitorLastRun(new Date().toISOString());
        return;
      }
      const r = await fetch("/api/ai/actions/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incidents: openIncidents,
          changes: openChanges,
          requestedBy: currentUser.name
        })
      });
      if (r.ok) {
        const data = await r.json();
        const newActions = data.actions || [];
        if (newActions.length > 0) {
          setAiActions(prev => {
            const existingIds = new Set(prev.map(a => a.id));
            const merged = [...prev, ...newActions.filter(a => !existingIds.has(a.id))];
            _save("vgc_ai_actions", merged);
            return merged;
          });
          // Auto-show panel for critical actions
          if (newActions.some(a => a.severity === "critical")) {
            setShowAiActionsPanel(true);
          }
        }
        setAiMonitorLastRun(new Date().toISOString());
      }
    } catch (e) { console.warn("[AI Monitor] Scan error:", e.message); }
    setAiActionsLoading(false);
  }, [aiActionsLoading, isLoggedIn, incidents, changes, currentUser]);

  const trackAction = (module, action, detail, actor) => {
    const entry = {
      id: `VH${Date.now()}`,
      timestamp: new Date().toISOString(),
      module,
      action,
      detail: typeof detail === "string" ? detail : JSON.stringify(detail),
      actor: actor || currentUser?.name || "System",
      actorType: (actor === "AI" || actor === "System" || module === "ai_chat") ? "ai" : "human",
    };
    setVersionHistory(prev => [entry, ...prev].slice(0, 500));
    return entry;
  };

  // Approve AI action
  const approveAiAction = useCallback(async (actionId) => {
    try {
      const r = await fetch(`/api/ai/actions/${encodeURIComponent(actionId)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedBy: currentUser.name, approverEmail: currentUser.email })
      });
      if (r.ok) {
        const data = await r.json();
        setAiActions(prev => {
          const updated = prev.map(a => a.id === actionId ? data.action : a);
          _save("vgc_ai_actions", updated);
          return updated;
        });
        trackAction("AI Actions", "Action Approved", `${actionId}: ${data.action?.title}`, currentUser.name);
        return data;
      }
    } catch (e) { console.warn("[AI Actions] Approve error:", e.message); }
    return null;
  }, [currentUser, trackAction]);

  // Reject AI action (with retry on 429)
  const rejectAiAction = useCallback(async (actionId, reason) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`/api/ai/actions/${encodeURIComponent(actionId)}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rejectedBy: currentUser.name, reason })
        });
        if (r.status === 429) {
          const wait = Math.min((attempt + 1) * 2000, 5000);
          await new Promise(ok => setTimeout(ok, wait));
          continue;
        }
        if (r.ok) {
          const data = await r.json();
          setAiActions(prev => {
            const updated = prev.map(a => a.id === actionId ? data.action : a);
            _save("vgc_ai_actions", updated);
            return updated;
          });
          trackAction("AI Actions", "Action Rejected", `${actionId}: ${reason}`, currentUser.name);
          return data;
        }
      } catch (e) { console.warn("[AI Actions] Reject error:", e.message); }
    }
    return null;
  }, [currentUser, trackAction]);

  // Send approval email for an action
  const sendAiApprovalEmail = useCallback(async (actionId) => {
    try {
      const r = await fetch("/api/ai/actions/send-approval-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionId,
          approverEmails: [currentUser.email].filter(Boolean),
          appUrl: window.location.origin
        })
      });
      if (r.ok) {
        trackAction("AI Actions", "Approval Email Sent", actionId, currentUser.name);
        return await r.json();
      }
    } catch (e) { console.warn("[AI Actions] Email error:", e.message); }
    return null;
  }, [currentUser, trackAction]);

  // ─── AI Auto-Triage Engine (Phase 1) ─────────────────────────────────
  const autoTriageTicket = useCallback(async (ticket) => {
    if (!azureOpenAI.enabled || !ticket) return null;
    try {
      const res = await fetch("/api/ai/auto-triage-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket, requestedBy: currentUser?.name || "System" })
      });
      if (!res.ok) return null;
      const data = await res.json();

      if (data.autoApplied && data.triage) {
        // Auto-applied: update local state with enriched AI fields
        setIncidents(prev => prev.map(i => i.id === ticket.id ? {
          ...i,
          category: data.triage.category,
          subcategory: data.triage.subcategory || i.subcategory,
          priority: data.triage.priority,
          assignee: data.triage.assignee || i.assignee,
          assignmentGroup: data.triage.assignmentGroup || i.assignmentGroup,
          slaTarget: data.triage.suggestedSlaTarget || i.slaTarget,
          aiTriaged: true, aiConfidence: data.confidence,
          sentiment: data.triage.sentiment || i.sentiment,
          sentimentScore: data.triage.sentimentScore || i.sentimentScore,
          ...(data.triage.possibleDuplicateOf ? { possibleDuplicateOf: data.triage.possibleDuplicateOf, duplicateSimilarity: data.triage.duplicateSimilarity } : {}),
          kbCoverage: data.triage.kbCoverage || i.kbCoverage,
          ...(data.triage.suggestedKbTopic ? { suggestedKbTopic: data.triage.suggestedKbTopic } : {}),
        } : i));
        const sentimentEmoji = data.triage.sentiment === "frustrated" ? "😤" : data.triage.sentiment === "satisfied" ? "😊" : "😐";
        const dupNote = data.triage.possibleDuplicateOf ? ` | ⚠️ Possible dup of ${data.triage.possibleDuplicateOf}` : "";
        const kbNote = data.triage.kbCoverage === "gap" ? " | 📚 KB gap detected" : "";
        showToast(`🤖 AI auto-triaged ${ticket.id}: ${data.triage.category} [${data.triage.priority}] → ${data.triage.assignee} (${data.confidence}%) ${sentimentEmoji}${dupNote}${kbNote}`, "success");
      } else if (data.actionId) {
        // Pending approval: refresh AI actions
        showToast(`🤖 AI triage for ${ticket.id} needs approval (${data.confidence}% confidence)`, "info");
        fetchAiActions();
        setShowAiActionsPanel(true);
      }
      return data;
    } catch (err) {
      console.warn("[AI Triage]", err.message);
      return null;
    }
  }, [azureOpenAI.enabled, currentUser?.name]);

  const applyAiTriage = useCallback(async (actionId) => {
    try {
      const res = await fetch("/api/ai/auto-triage-assign/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, appliedBy: currentUser?.name || "Unknown" })
      });
      if (!res.ok) { const err = await res.json(); showToast(err.error || "Failed to apply triage", "error"); return; }
      const data = await res.json();
      if (data.success && data.triage && data.ticketId) {
        setIncidents(prev => prev.map(i => i.id === data.ticketId ? {
          ...i,
          category: data.triage.category,
          subcategory: data.triage.subcategory || i.subcategory,
          priority: data.triage.priority,
          assignee: data.triage.assignee || i.assignee,
          assignmentGroup: data.triage.assignmentGroup || i.assignmentGroup,
          slaTarget: data.triage.suggestedSlaTarget || i.slaTarget,
          aiTriaged: true, aiConfidence: 100,
        } : i));
        // Update action status in local state
        setAiActions(prev => prev.map(a => a.id === actionId ? { ...a, status: "applied" } : a));
        showToast(`✅ AI triage applied to ${data.ticketId}`, "success");
      }
    } catch (err) {
      showToast("Failed to apply triage: " + err.message, "error");
    }
  }, [currentUser?.name]);

  // ─── Phase 2: AI SLA Breach Prediction ────────────────────────────
  const [slaPredictions, setSlaPredictions] = useState([]);
  const runSlaPrediction = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/sla-predict", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidents, requests, requestedBy: currentUser?.name || "System" })
      });
      if (!res.ok) return;
      const data = await res.json();
      setSlaPredictions(data.predictions || []);
      if (data.actions?.length > 0) {
        fetchAiActions();
        showToast(`🔮 AI predicted ${data.predictions.length} SLA risks, ${data.actions.length} actions created`, "warning");
      }
    } catch (err) { console.error("[SLA Predict]", err.message); }
  }, [incidents, requests, currentUser?.name]);

  // ─── Phase 3: AI KB Auto-Generation ───────────────────────────────
  const generateKBFromTicket = useCallback(async (ticket) => {
    try {
      showToast("🤖 AI generating KB article from resolution...", "info");
      const res = await fetch("/api/ai/kb-auto-generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket, requestedBy: currentUser?.name || "System" })
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.isDuplicate) {
        showToast(`📚 Similar KB already exists: "${data.duplicateOf}"`, "info");
      } else if (data.success) {
        fetchAiActions();
        showToast(`📝 KB draft created: "${data.kbDraft.title}" — review in AI Actions`, "success");
      }
    } catch (err) { console.error("[KB Generate]", err.message); }
  }, [currentUser?.name]);

  const approveKBDraft = useCallback(async (actionId, editedContent) => {
    try {
      const res = await fetch("/api/ai/kb-auto-generate/approve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, approvedBy: currentUser?.name || "System", editedContent })
      });
      if (!res.ok) { const err = await res.json(); showToast(err.error || "Failed", "error"); return; }
      const data = await res.json();
      if (data.success) {
        setAiActions(prev => prev.map(a => a.id === actionId ? { ...a, status: "applied" } : a));
        showToast(`📚 KB article published: ${data.kbId}`, "success");
      }
    } catch (err) { showToast("KB approve failed: " + err.message, "error"); }
  }, [currentUser?.name]);

  // ─── Phase 4: AI Daily Briefing ───────────────────────────────────
  const [aiBriefings, setAiBriefings] = useState([]);
  const [currentBriefing, setCurrentBriefing] = useState(null);
  const generateBriefing = useCallback(async (shift, recipients) => {
    try {
      showToast("🤖 Generating AI briefing...", "info");
      const res = await fetch("/api/ai/daily-briefing", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedBy: currentUser?.name || "System", shift: shift || "daily", recipients: recipients || [], incidents, changes, requests })
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setCurrentBriefing(data.briefing);
        setAiBriefings(prev => [data.briefing, ...prev]);
        showToast(`📋 ${shift || "Daily"} briefing generated (Risk: ${data.briefing.riskLevel})`, "success");
      }
    } catch (err) { showToast("Briefing failed: " + err.message, "error"); }
  }, [currentUser?.name, incidents, changes, requests]);

  const fetchBriefings = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/briefings");
      if (res.ok) { const data = await res.json(); setAiBriefings(data.briefings || []); }
    } catch (e) { /* ignore */ }
  }, []);

  // ─── Phase 5: AI Pattern Detection ────────────────────────────────
  const [aiPatterns, setAiPatterns] = useState([]);

  // ─── Phase 9: AI Learning Dashboard ────────────────────────────────
  const [aiLearningMetrics, setAiLearningMetrics] = useState(null);
  const [aiLearningTrends, setAiLearningTrends] = useState([]);
  const [aiModelHealth, setAiModelHealth] = useState(null);
  const [aiLearningFeedback, setAiLearningFeedback] = useState([]);
  const [aiLearningLoading, setAiLearningLoading] = useState(false);
  const [aiLearningTrendPeriod, setAiLearningTrendPeriod] = useState("weekly");

  const fetchAiLearningData = useCallback(async () => {
    if (aiLearningLoading || !isLoggedIn) return;
    setAiLearningLoading(true);
    try {
      const [metricsRes, trendsRes, healthRes, feedbackRes] = await Promise.all([
        fetch("/api/ai/learning/metrics").then(r => r.json()),
        fetch(`/api/ai/learning/trends?period=${aiLearningTrendPeriod}`).then(r => r.json()),
        fetch("/api/ai/learning/model-health").then(r => r.json()),
        fetch("/api/ai/learning/feedback").then(r => r.json()),
      ]);
      setAiLearningMetrics(metricsRes);
      setAiLearningTrends(trendsRes.trends || []);
      setAiModelHealth(healthRes);
      setAiLearningFeedback(feedbackRes.feedback || []);
    } catch (e) { console.error("AI Learning fetch error:", e); }
    setAiLearningLoading(false);
  }, [aiLearningLoading, isLoggedIn, aiLearningTrendPeriod]);

  const submitAiFeedback = useCallback(async (triageId, verdict, notes) => {
    try {
      const res = await fetch("/api/ai/learning/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triageId, verdict, notes }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✅ Feedback recorded: ${verdict}`, "success");
        setAiLearningFeedback(prev => [data.feedback, ...prev]);
      }
    } catch (e) { showToast("Failed to submit feedback", "error"); }
  }, []);

  const deleteAiFeedback = useCallback(async (feedbackId) => {
    try {
      await fetch(`/api/ai/learning/feedback/${feedbackId}`, { method: "DELETE" });
      setAiLearningFeedback(prev => prev.filter(f => f.id !== feedbackId));
      showToast("Feedback deleted", "info");
    } catch (e) { showToast("Failed to delete feedback", "error"); }
  }, []);
  const runPatternDetection = useCallback(async () => {
    try {
      showToast("🔍 AI analyzing patterns...", "info");
      const res = await fetch("/api/ai/pattern-detect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidents, problems, changes, requestedBy: currentUser?.name || "System" })
      });
      if (!res.ok) return;
      const data = await res.json();
      setAiPatterns(data.patterns || []);
      if (data.actions?.length > 0) fetchAiActions();
      showToast(`🔮 Detected ${data.count} patterns, ${data.actions?.length || 0} actions created`, "success");
    } catch (err) { showToast("Pattern detection failed: " + err.message, "error"); }
  }, [incidents, problems, changes, currentUser?.name]);

  const fetchPatterns = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/patterns");
      if (res.ok) { const data = await res.json(); setAiPatterns(data.patterns || []); }
    } catch (e) { /* ignore */ }
  }, []);

  const createProblemFromPattern = useCallback(async (patternId) => {
    try {
      const res = await fetch(`/api/ai/patterns/${patternId}/create-problem`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedBy: currentUser?.name || "System" })
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        fetchAiActions();
        showToast(`🎫 Problem creation action queued for approval`, "success");
      }
    } catch (err) { showToast("Failed: " + err.message, "error"); }
  }, [currentUser?.name]);

  // ─── Shared: refresh incidents from DB ─────────────────────────────
  const refreshIncidentsFromDB = useCallback(async () => {
    try {
      const incR = await fetch("/api/db/incidents");
      if (incR.ok) {
        const incData = await incR.json();
        const items = (Array.isArray(incData) ? incData : (incData.data || []))
          .map(d => { try { return typeof d.data === "string" ? JSON.parse(d.data) : (d.data || d); } catch { return null; } })
          .filter(Boolean);
        setIncidents(items.filter(i => !/^(INC000)\d$/.test(i.id)));
      }
    } catch (e) { /* ignore */ }
  }, []);

  // ─── Phase 6: AI Historical Incident Closure ──────────────────────
  const runHistoricalClose = useCallback(async (dryRun = true) => {
    setHistoricalCloseRunning(true);
    try {
      const res = await fetch("/api/ai/historical-close", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cutoffDate: historicalCloseCutoff, requestedBy: currentUser?.name || "System", dryRun })
      });
      if (!res.ok) { const err = await res.json(); showToast(err.error || "Historical close failed", "error"); setHistoricalCloseRunning(false); return; }
      const data = await res.json();
      setHistoricalCloseResult(data);
      if (!dryRun && data.success) {
        showToast(`🗄️ AI closed ${data.closedCount} historical incidents (no notifications sent)`, "success");
        await refreshIncidentsFromDB();
      } else if (dryRun) {
        showToast(`🔍 Found ${data.eligibleCount} incidents eligible for closure`, "info");
      }
    } catch (err) { showToast("Historical close failed: " + err.message, "error"); }
    setHistoricalCloseRunning(false);
  }, [historicalCloseCutoff, currentUser?.name]);

  // ─── AI Auto-Resolve: Scan + Queue Management ─────────────────────
  const fetchAiResolveQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/resolve-queue");
      if (res.ok) {
        const data = await res.json();
        const items = (data.items || []).filter(i => !_isTestRecord(i.incidentId));
        setAiResolveQueue(items);
      }
    } catch (e) { /* ignore */ }
  }, []);

  const runAiAutoResolve = useCallback(async () => {
    setAiResolveScanLoading(true);
    try {
      const res = await fetch("/api/ai/auto-resolve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedBy: currentUser?.name || "System", idleHours: 24, maxItems: 10 })
      });
      if (!res.ok) { const err = await res.json(); showToast(err.error || "AI scan failed", "error"); setAiResolveScanLoading(false); return; }
      const data = await res.json();
      const dismissed = data.autoDismissed || 0;
      const queued = data.queued || 0;
      showToast(`🤖 AI scanned ${data.total} incidents: ${queued} queued for review, ${dismissed} auto-dismissed (noise/routine)`, "success");
      await fetchAiResolveQueue();
    } catch (err) { showToast("AI scan failed: " + err.message, "error"); }
    setAiResolveScanLoading(false);
  }, [currentUser?.name, fetchAiResolveQueue]);

  const handleBulkDismiss = useCallback(async () => {
    setAiBulkDismissLoading(true);
    try {
      const res = await fetch("/api/ai/resolve-queue/bulk-dismiss", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedBy: currentUser?.name || "System", maxItems: 50 })
      });
      if (!res.ok) { const err = await res.json(); showToast(err.error || "Bulk dismiss failed", "error"); setAiBulkDismissLoading(false); return; }
      const data = await res.json();
      showToast(`🧹 AI classified ${data.processed} items: ${data.dismissed} dismissed, ${data.kept} kept for review`, "success");
      await fetchAiResolveQueue();
    } catch (err) { showToast("Bulk dismiss failed: " + err.message, "error"); }
    setAiBulkDismissLoading(false);
  }, [currentUser?.name, fetchAiResolveQueue]);

  const handleBulkApprove = useCallback(async (consultedBy = []) => {
    setAiBulkApproveLoading(true);
    try {
      const res = await fetch("/api/ai/resolve-queue/bulk-approve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedBy: currentUser?.name || "System", minConfidence: 80, consultedBy: Array.isArray(consultedBy) ? consultedBy : [] })
      });
      if (!res.ok) { const err = await res.json(); showToast(err.error || "Bulk approve failed", "error"); setAiBulkApproveLoading(false); return; }
      const data = await res.json();
      showToast(`✅ Bulk approved ${data.approved} items (≥${data.threshold}% confidence). ${data.skipped} skipped (Sev-A/RACI).`, "success");
      await fetchAiResolveQueue();
      await refreshIncidentsFromDB();
    } catch (err) { showToast("Bulk approve failed: " + err.message, "error"); }
    setAiBulkApproveLoading(false);
  }, [currentUser?.name, fetchAiResolveQueue]);

  const handleAiResolveAction = useCallback(async (suggestionId, action, editedResolution, editedCustomerEmail, rejectionReason) => {
    setAiResolveLoading(true);
    try {
      const res = await fetch("/api/ai/resolve-queue/action", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestionId, action, approvedBy: currentUser?.name || "System", editedResolution, editedCustomerEmail, rejectionReason })
      });
      if (!res.ok) { const err = await res.json(); showToast(err.error || "Action failed", "error"); setAiResolveLoading(false); return; }
      const data = await res.json();
      if (action === "approve") {
        showToast(`✅ Incident ${data.suggestion.incidentId} resolved by AI (approved by ${currentUser?.name}). Zendesk NOT updated (one-way pull).`, "success");
        await refreshIncidentsFromDB();
      } else {
        showToast(`❌ AI suggestion rejected`, "info");
      }
      setAiResolveQueue(prev => prev.filter(s => s.id !== suggestionId));
    } catch (err) { showToast("Action failed: " + err.message, "error"); }
    setAiResolveLoading(false);
  }, [currentUser?.name]);

  // ─── AI Auto Follow-Up Handler ──────────────────────────────────────
  const runAiAutoFollowUp = useCallback(async () => {
    setAiFollowUpLoading(true);
    try {
      const res = await fetch("/api/ai/auto-followup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedBy: currentUser?.name || "System" })
      });
      if (!res.ok) { const err = await res.json(); showToast(err.error || "Follow-up failed", "error"); setAiFollowUpLoading(false); return; }
      const data = await res.json();
      showToast(`📨 AI Follow-Up: ${data.processed || 0} incidents reviewed, ${data.emailsSent || 0} emails sent`, "success");
    } catch (err) { showToast("Follow-up failed: " + err.message, "error"); }
    setAiFollowUpLoading(false);
  }, [currentUser?.name]);

  // ─── Cleanup Stale Queue Handler ────────────────────────────────────
  const runCleanupQueue = useCallback(async () => {
    setCleanupLoading(true);
    try {
      const res = await fetch("/api/ai/cleanup-queue", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedBy: currentUser?.name || "System", maxAgeDays: 7 })
      });
      if (!res.ok) { const err = await res.json(); showToast(err.error || "Cleanup failed", "error"); setCleanupLoading(false); return; }
      const data = await res.json();
      showToast(`🧹 Queue cleanup: ${data.dismissed || 0} stale dismissed, ${data.deduped || 0} deduped`, "success");
      await fetchAiResolveQueue();
    } catch (err) { showToast("Cleanup failed: " + err.message, "error"); }
    setCleanupLoading(false);
  }, [currentUser?.name, fetchAiResolveQueue]);

  // Fetch AI resolve queue on login
  useEffect(() => {
    if (isLoggedIn) fetchAiResolveQueue();
  }, [isLoggedIn, fetchAiResolveQueue]);

  // ─── AI Workflow Assist: Scan + Queue Management ──────────────────────
  const fetchAiWorkflowQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/workflow-queue");
      if (res.ok) {
        const data = await res.json();
        setAiWorkflowQueue((data.items || []).filter(i => i.status === "pending"));
      }
    } catch (e) { /* ignore */ }
  }, []);

  const runAiWorkflowAssist = useCallback(async () => {
    setAiWorkflowScanLoading(true);
    try {
      const res = await fetch("/api/ai/workflow-assist", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedBy: currentUser?.name || "System", maxItems: 10 })
      });
      if (!res.ok) { const err = await res.json(); showToast(err.error || "AI workflow scan failed", "error"); setAiWorkflowScanLoading(false); return; }
      const data = await res.json();
      showToast(`🤖 AI analyzed ${data.total} open incidents, ${data.actions.filter(a => !a.error).length} workflow suggestions ready`, "success");
      await fetchAiWorkflowQueue();
    } catch (err) { showToast("AI workflow scan failed: " + err.message, "error"); }
    setAiWorkflowScanLoading(false);
  }, [currentUser?.name, fetchAiWorkflowQueue]);

  const handleAiWorkflowAction = useCallback(async (suggestionId, action) => {
    setAiWorkflowLoading(true);
    try {
      const res = await fetch("/api/ai/workflow-queue/action", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestionId, action, approvedBy: currentUser?.name || "System" })
      });
      if (!res.ok) { const err = await res.json(); showToast(err.error || "Action failed", "error"); setAiWorkflowLoading(false); return; }
      const data = await res.json();
      if (action === "approve") {
        showToast(`✅ Workflow action "${data.suggestion.action}" applied to ${data.suggestion.incidentId}${data.suggestion.zdSynced ? " (internal note posted to Zendesk)" : ""}`, "success");
        await refreshIncidentsFromDB();
      } else {
        showToast(`❌ Workflow suggestion rejected`, "info");
      }
      setAiWorkflowQueue(prev => prev.filter(s => s.id !== suggestionId));
    } catch (err) { showToast("Action failed: " + err.message, "error"); }
    setAiWorkflowLoading(false);
  }, [currentUser?.name]);

  // Fetch AI workflow queue on login
  useEffect(() => {
    if (isLoggedIn) fetchAiWorkflowQueue();
  }, [isLoggedIn, fetchAiWorkflowQueue]);

  // ─── AI Learn from Incidents → KB Articles ─────────────────────────────
  const runKbLearning = useCallback(async () => {
    setKbLearningLoading(true);
    try {
      const res = await fetch("/api/ai/learn-incidents-kb", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedBy: currentUser?.name || "System" })
      });
      if (!res.ok) { const err = await res.json(); showToast(err.error || "KB learning failed", "error"); setKbLearningLoading(false); return; }
      const data = await res.json();
      if (data.articlesCreated > 0) {
        showToast(`🧠 Created ${data.articlesCreated} professional KB articles from ${data.totalIncidentsAnalyzed} resolved incidents!`, "success");
        // Add learned articles to kbArticles state
        setKbArticles(prev => [...data.articles, ...prev]);
      } else {
        showToast(`📊 Analyzed ${data.totalIncidentsAnalyzed} incidents but no new unique articles to create`, "info");
      }
    } catch (err) { showToast("KB learning failed: " + err.message, "error"); }
    setKbLearningLoading(false);
  }, [currentUser?.name]);

  // ─── AI Bulk Close Past Tickets ─────────────────────────────────────────
  const runBulkCloseTickets = useCallback(async (dryRun = true) => {
    setHistoricalCloseRunning(true);
    try {
      const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const res = await fetch("/api/ai/historical-close", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cutoffDate, requestedBy: currentUser?.name || "System", dryRun })
      });
      if (!res.ok) { const err = await res.json(); showToast(err.error || "Bulk close failed", "error"); setHistoricalCloseRunning(false); return; }
      const data = await res.json();
      if (dryRun) {
        if (data.eligibleCount > 0) {
          if (confirm(`🗄️ Found ${data.eligibleCount} incidents older than 30 days eligible for AI closure.\n\nProceed with closing them? (No Zendesk updates will be made)`)) {
            setHistoricalCloseRunning(false);
            await runBulkCloseTickets(false);
            return;
          }
        } else {
          showToast("No incidents older than 30 days eligible for closure", "info");
        }
      } else if (data.closedCount > 0) {
        showToast(`🗄️ AI closed ${data.closedCount} historical incidents (no Zendesk sync, no notifications)`, "success");
        await refreshIncidentsFromDB();
      }
    } catch (err) { showToast("Bulk close failed: " + err.message, "error"); }
    setHistoricalCloseRunning(false);
  }, [currentUser?.name]);

  // Auto-monitor: run every 5 minutes when enabled
  // Placed after all Phase 1-5 function definitions to avoid forward references
  useEffect(() => {
    if (!aiMonitorEnabled || !isLoggedIn) return;
    const runFullMonitor = async () => {
      if (!tabVisibleRef.current) return; // skip when tab hidden
      await runAiMonitor();
      try { await runSlaPrediction(); } catch (e) { console.warn("[AI Monitor] SLA predict error:", e.message); }
      try { await runPatternDetection(); } catch (e) { console.warn("[AI Monitor] Pattern detect error:", e.message); }
    };
    // Initial scan after 15s
    const initialTimeout = setTimeout(runFullMonitor, 15000);
    // Then every 15 minutes (configurable via AI_THRESHOLDS.monitorIntervalMin)
    aiMonitorRef.current = setInterval(runFullMonitor, 15 * 60 * 1000);
    return () => { clearTimeout(initialTimeout); if (aiMonitorRef.current) clearInterval(aiMonitorRef.current); };
  }, [aiMonitorEnabled, isLoggedIn, runAiMonitor, runSlaPrediction, runPatternDetection]);

  // ─── Fetch AI Actions from server on login (so Engineer Review Hub shows data) ──
  useEffect(() => {
    if (!isLoggedIn) return;
    fetchAiActions();
  }, [isLoggedIn, fetchAiActions]);

  // ─── VGC-AI Engine API Helper (via server proxy — avoids CORS) ───────
  const callAzureOpenAI = async (systemPrompt, userPrompt) => {
    if (!azureOpenAI.enabled) {
      return null; // Fall back to local responses
    }
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt, userPrompt })
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.warn(`[VGC-AI] Server proxy error ${res.status}:`, errBody);
        throw new Error(`API ${res.status}`);
      }
      const data = await res.json();
      if (!data.text) { console.warn("[VGC-AI] Empty response from API"); return null; }
      setAzureOpenAI(prev => ({ ...prev, totalCalls: prev.totalCalls + 1, lastTested: new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore" }) }));
      return data.text;
    } catch (err) {
      console.warn("[VGC-AI] Call failed, falling back to local:", err.message);
      return null; // Fallback to local
    }
  };

  // ─── VGC-AI Streaming Helper (SSE — real-time token display) ─────────
  const callAzureOpenAIStream = async (systemPrompt, userPrompt, onToken) => {
    if (!azureOpenAI.enabled) return null;
    try {
      const res = await fetch("/api/ai/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt, userPrompt })
      });
      if (!res.ok) {
        console.warn(`[VGC-AI Stream] Error ${res.status}`);
        return null; // fallback to non-streaming
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let model = "";
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) { console.warn("[VGC-AI Stream]", parsed.error); return null; }
            if (parsed.done) { model = parsed.model || model; continue; }
            if (parsed.token) {
              fullText += parsed.token;
              if (onToken) onToken(parsed.token, fullText);
            }
          } catch { /* skip non-JSON */ }
        }
      }
      if (fullText) {
        setAzureOpenAI(prev => ({ ...prev, totalCalls: prev.totalCalls + 1, lastTested: new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore" }) }));
      }
      return fullText || null;
    } catch (err) {
      console.warn("[VGC-AI Stream] Failed, falling back:", err.message);
      return null;
    }
  };

  // ─── CSAT Survey Engine Functions (Phase 7) ────────────────────────────
  const fetchCsatScores = async () => {
    setCsatLoading(true);
    try {
      const res = await fetch("/api/csat/scores");
      if (res.ok) { const data = await res.json(); setCsatScores(data); }
    } catch (e) { console.warn("[CSAT] Fetch failed:", e.message); }
    setCsatLoading(false);
  };

  const submitCsatResponse = async (form) => {
    setCsatSubmitting(true);
    try {
      const res = await fetch("/api/csat/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, agentName: currentUser, customerName: form.customerName || "Customer" }) });
      if (res.ok) { const data = await res.json(); showToast(`Survey response recorded: ${form.rating}/5 for ${form.ticketId}`, "success"); setCsatSubmitForm({ ticketId: "", rating: 0, comment: "", category: "General" }); fetchCsatScores(); return data; }
    } catch (e) { showToast(`CSAT submit failed: ${e.message}`, "error"); }
    setCsatSubmitting(false);
    return null;
  };

  const runCsatAiAnalysis = async () => {
    setCsatAiLoading(true);
    try {
      const res = await fetch("/api/csat/ai-analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (res.ok) { const data = await res.json(); setCsatAiAnalysis(data.analysis || data); }
    } catch (e) { console.warn("[CSAT AI]", e.message); }
    setCsatAiLoading(false);
  };

  // ─── Change Calendar Functions (Phase 8) ───────────────────────────────
  const fetchCalendarData = async (month, year) => {
    setCalendarLoading(true);
    try {
      const res = await fetch(`/api/changes/calendar?month=${month || calendarMonth}&year=${year || calendarYear}`);
      if (res.ok) { const data = await res.json(); setCalendarData(data); }
    } catch (e) { console.warn("[Calendar] Fetch failed:", e.message); }
    setCalendarLoading(false);
  };

  const createFreezeWindow = async () => {
    if (!freezeForm.startDate || !freezeForm.endDate || !freezeForm.reason) return;
    try {
      const res = await fetch("/api/changes/freeze-window", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...freezeForm, createdBy: currentUser.name || "Admin" }),
      });
      if (res.ok) {
        showToast(`Freeze window created: ${freezeForm.reason}`, "success");
        setFreezeForm({ startDate: "", endDate: "", reason: "", show: false });
        fetchCalendarData();
      }
    } catch (e) { showToast(`Change Calendar failed: ${e.message}`, "error"); }
  };

  const deleteFreezeWindow = async (id) => {
    try {
      const res = await fetch(`/api/changes/freeze-window?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) { showToast("Freeze window deleted", "success"); fetchCalendarData(); }
    } catch (e) { console.warn("[Calendar] Delete freeze failed:", e.message); }
  };

  const runConflictCheck = async (changeData) => {
    try {
      const res = await fetch("/api/changes/conflict-check", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changeData),
      });
      if (res.ok) { const data = await res.json(); setConflictCheckResult(data); return data; }
    } catch (e) { console.warn("[Calendar] Conflict check failed:", e.message); }
    return null;
  };

  // ─── AI Knowledge Base Functions ────────────────────────────────────
  const fetchKbEntries = async () => {
    setKbLoading(true);
    try {
      const res = await fetch("/api/ai/knowledge");
      if (res.ok) { const data = await res.json(); setKbEntries(data.entries || []); }
    } catch (e) { console.warn("[KB] Fetch failed:", e.message); }
    setKbLoading(false);
  };
  const submitKbEntry = async () => {
    if (!kbForm.title.trim() || !kbForm.content.trim()) return;
    try {
      const res = await fetch("/api/ai/knowledge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...kbForm, tags: kbForm.tags.split(",").map(t => t.trim()).filter(Boolean), trainedBy: currentUser.name })
      });
      if (res.ok) {
        trackAction("AI Training", "KB Entry Created", `${kbForm.title} [${kbForm.category}]`, "AI");
        setKbForm({ title: "", category: "General", content: "", tags: "" });
        fetchKbEntries();
        setAiMessages(prev => [...prev, { role: "ai", text: `✅ **Knowledge trained successfully!**\n\n📝 **${kbForm.title}** has been added to the internal knowledge base.\n\nCategory: ${kbForm.category}\nTrained by: ${currentUser.name}\n\nI will now prioritize this knowledge when answering related questions.`, source: "azure" }]);
      }
    } catch (e) { console.warn("[KB] Submit failed:", e.message); }
  };
  const deleteKbEntry = async (id) => {
    try {
      await fetch(`/api/ai/knowledge/${encodeURIComponent(id)}`, { method: "DELETE" });
      fetchKbEntries();
      trackAction("AI Training", "KB Entry Deleted", `Entry ${id} removed`, currentUser.name);
    } catch (e) { console.warn("[KB] Delete failed:", e.message); }
  };

  // ─── AI Guide Generator (from Zendesk History) ─────────────────────
  const generateGuide = async () => {
    if (!guideTopic.trim()) return;
    setGuideGenerating(true);
    setGuideResult(null);
    try {
      const res = await fetch("/api/ai/generate-guide", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: guideTopic.trim(), category: guideCategory, includeScreenshots: true })
      });
      const data = await res.json();
      if (res.ok && data.guide) {
        setGuideResult({ text: data.guide, id: data.id, title: data.title, zdRefs: data.zdTicketsReferenced || 0 });
        fetchKbEntries();
        trackAction("Knowledge", "AI Guide Generated", guideTopic, "AI");
      } else {
        setGuideResult({ error: data.error || "Failed to generate guide" });
      }
    } catch (e) {
      setGuideResult({ error: e.message });
    }
    setGuideGenerating(false);
  };

  // ─── SharePoint Doc Generator ──────────────────────────────────────
  const generateSpDoc = async () => {
    if (!spDocUrl.trim() && !spDocTitle.trim()) return;
    setSpDocGenerating(true);
    setSpDocResult(null);
    try {
      const res = await fetch("/api/ai/generate-doc", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: spDocUrl.trim(), title: spDocTitle.trim(), docType: spDocType })
      });
      const data = await res.json();
      if (res.ok && data.document) {
        setSpDocResult({ text: data.document, id: data.id, title: data.title });
        fetchKbEntries();
        trackAction("Knowledge", "SharePoint Doc Generated", spDocTitle || spDocUrl, "AI");
      } else {
        setSpDocResult({ error: data.error || "Failed to generate documentation" });
      }
    } catch (e) {
      setSpDocResult({ error: e.message });
    }
    setSpDocGenerating(false);
  };

  // markdownToHtml and exportToWord moved to src/utils/docHelpers.js
  const mdToHtml = markdownToHtml; // alias for ctx passthrough

  // ─── Bulk Upload & AI Training ─────────────────────────────────────
  const handleKbBulkUpload = (files) => {
    const arr = Array.from(files);
    const mapped = arr.map(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      const typeMap = { doc: "Word", docx: "Word", xls: "Excel", xlsx: "Excel", ppt: "PowerPoint", pptx: "PowerPoint", pdf: "PDF", txt: "Text", csv: "CSV", md: "Markdown", json: "JSON", png: "Image", jpg: "Image", jpeg: "Image", gif: "Image", webp: "Image", mp4: "Video", webm: "Video", mov: "Video" };
      return { file: f, name: f.name, size: f.size, type: typeMap[ext] || "Document", ext, status: "pending", kbId: null };
    });
    setKbBulkUploadFiles(prev => [...prev, ...mapped]);
  };

  const processKbBulkUpload = async () => {
    if (kbBulkUploadFiles.length === 0) return;
    setKbBulkUploading(true);
    setKbAiLearningProgress({ total: kbBulkUploadFiles.length, done: 0, status: "Uploading files..." });
    const updated = [...kbBulkUploadFiles];
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].status === "done") continue;
      setKbAiLearningProgress({ total: updated.length, done: i, status: `Uploading ${updated[i].name}...` });
      try {
        const formData = new FormData();
        formData.append("file", updated[i].file);
        formData.append("title", updated[i].name.replace(/\.[^.]+$/, ''));
        formData.append("category", "Uploaded");
        formData.append("tags", `uploaded,${updated[i].type.toLowerCase()},bulk-import`);
        formData.append("trainedBy", currentUser?.name || "Unknown");
        const res = await fetch("/api/ai/knowledge/upload", { method: "POST", body: formData });
        if (res.ok) {
          const data = await res.json();
          updated[i].status = "done";
          updated[i].kbId = data.entry?.id;
        } else {
          updated[i].status = "error";
        }
      } catch {
        updated[i].status = "error";
      }
      setKbBulkUploadFiles([...updated]);
    }
    setKbAiLearningProgress({ total: updated.length, done: updated.length, status: "AI is learning from uploaded documents..." });
    // Trigger AI learning/summary for uploaded docs
    setKbAiLearning(true);
    try {
      await fetch("/api/ai/knowledge/learn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "learn-from-uploads" }) });
    } catch { /* AI learning is best-effort */ }
    setKbAiLearning(false);
    setKbAiLearningProgress({ total: updated.length, done: updated.length, status: "Complete! AI has processed all documents." });
    setKbBulkUploading(false);
    fetchKbEntries();
    trackAction("AI Training", "Bulk Document Upload", `${updated.filter(u => u.status === 'done').length}/${updated.length} files uploaded & learned`, "AI");
  };

  // ─── KB Version History ────────────────────────────────────────────
  const fetchKbVersionHistory = async (docId) => {
    try {
      const res = await fetch(`/api/ai/knowledge/${encodeURIComponent(docId)}/versions`);
      if (res.ok) {
        const data = await res.json();
        setKbVersionHistory(data.versions || []);
      }
    } catch { setKbVersionHistory([]); }
  };

  const updateKbEntry = async (id, updates) => {
    try {
      const res = await fetch(`/api/ai/knowledge/${encodeURIComponent(id)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...updates, updatedBy: currentUser?.name || "Unknown" })
      });
      if (res.ok) { fetchKbEntries(); trackAction("AI Training", "KB Entry Updated", `Entry ${id} updated`, "AI"); return true; }
    } catch { /* ignore */ }
    return false;
  };

  // ─── Global AI Error Resolver (HARD RULE: solve every error) ───────
  const resolveErrorWithAI = async (errorInfo) => {
    setAiErrorResolving(true);
    setAiErrorResolution(null);
    try {
      const res = await fetch("/api/ai/resolve-error", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          errorType: errorInfo.type || "Application Error",
          errorCode: errorInfo.code || "UNKNOWN",
          errorMessage: errorInfo.message || "Unknown error",
          errorDetails: errorInfo.details || "",
          errorStack: errorInfo.stack || "",
          context: errorInfo.context || `VGC-ITSM v${APP_VERSION.version} — ${currentUser?.name || "User"}`
        })
      });
      const data = await res.json();
      if (res.ok && data.resolution) {
        setAiErrorResolution(data.resolution);
        trackAction("AI Assist", "Error Auto-Resolved", `${errorInfo.type || 'Error'}: ${(errorInfo.message || '').substring(0, 80)}`, "AI");
      } else {
        setAiErrorResolution("⚠️ AI Error Resolver is temporarily unavailable. Please try again or contact IT support.");
      }
    } catch (e) {
      setAiErrorResolution(`⚠️ Could not reach AI Error Resolver: ${e.message}. Check your network connection.`);
    }
    setAiErrorResolving(false);
  };

  // ─── Document Upload for AI Training ────────────────────────────────
  const SUPPORTED_UPLOAD_TYPES = {
    // Microsoft Office
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
    "application/msword": "Word",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
    "application/vnd.ms-excel": "Excel",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
    "application/vnd.ms-powerpoint": "PowerPoint",
    "application/pdf": "PDF",
    // Images
    "image/png": "Image", "image/jpeg": "Image", "image/gif": "Image", "image/webp": "Image", "image/svg+xml": "Image",
    // Video
    "video/mp4": "Video", "video/webm": "Video", "video/quicktime": "Video",
    // Text
    "text/plain": "Text", "text/csv": "CSV", "text/markdown": "Markdown",
    "application/json": "JSON",
  };

  const handleKbFileUpload = async (files) => {
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files);
    const newUploads = [];
    for (const file of fileArr) {
      const typeLabel = SUPPORTED_UPLOAD_TYPES[file.type] || (file.name.match(/\.(docx?|xlsx?|pptx?|pdf|csv|md|json|txt)$/i) ? "Document" : null);
      if (!typeLabel && !file.type.startsWith("image/") && !file.type.startsWith("video/")) {
        setAiMessages(prev => [...prev, { role: "ai", text: `⚠️ Unsupported file type: **${file.name}** (${file.type || "unknown"})\n\nSupported: Word, Excel, PowerPoint, PDF, Images, Videos, Text, CSV, Markdown, JSON`, source: "local" }]);
        continue;
      }
      newUploads.push({ file, name: file.name, size: file.size, type: typeLabel || "File", uploading: false, done: false });
    }
    setKbUploadFiles(prev => [...prev, ...newUploads]);
  };

  const submitKbWithFiles = async () => {
    if (!kbForm.title.trim() && kbUploadFiles.length === 0) return;
    // Upload text knowledge if provided
    if (kbForm.title.trim() && kbForm.content.trim()) {
      await submitKbEntry();
    }
    // Upload files
    for (let i = 0; i < kbUploadFiles.length; i++) {
      const upload = kbUploadFiles[i];
      setKbUploadFiles(prev => prev.map((u, idx) => idx === i ? { ...u, uploading: true } : u));
      try {
        const formData = new FormData();
        formData.append("file", upload.file);
        formData.append("title", kbForm.title.trim() || upload.name);
        formData.append("category", kbForm.category);
        formData.append("tags", kbForm.tags);
        formData.append("trainedBy", currentUser.name);
        const res = await fetch("/api/ai/knowledge/upload", { method: "POST", body: formData });
        if (res.ok) {
          setKbUploadFiles(prev => prev.map((u, idx) => idx === i ? { ...u, uploading: false, done: true } : u));
        } else {
          // Fallback: save file metadata as knowledge entry
          const fileEntry = { title: kbForm.title.trim() || upload.name, category: kbForm.category, content: `[Uploaded ${upload.type}: ${upload.name}] (${(upload.size / 1024).toFixed(1)} KB)\n\nThis document has been uploaded for AI training reference. File type: ${upload.type}.`, tags: kbForm.tags };
          await fetch("/api/ai/knowledge", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...fileEntry, tags: fileEntry.tags.split(",").map(t => t.trim()).filter(Boolean), trainedBy: currentUser.name })
          });
          setKbUploadFiles(prev => prev.map((u, idx) => idx === i ? { ...u, uploading: false, done: true } : u));
        }
      } catch (e) {
        console.warn("[KB Upload]", e.message);
        setKbUploadFiles(prev => prev.map((u, idx) => idx === i ? { ...u, uploading: false } : u));
      }
    }
    fetchKbEntries();
    trackAction("AI Training", "Knowledge Trained", `${kbForm.title || 'Files'} — ${kbUploadFiles.length} file(s) uploaded`, "AI");
    setKbForm({ title: "", category: "General", content: "", tags: "" });
    setTimeout(() => setKbUploadFiles([]), 2000);
    setAiMessages(prev => [...prev, { role: "ai", text: `✅ **Knowledge trained successfully!**\n\n${kbForm.title ? `📝 **${kbForm.title}**` : ""} ${kbUploadFiles.length > 0 ? `\n📎 **${kbUploadFiles.length} file(s)** uploaded and indexed` : ""}\n\nI'll reference this knowledge in future conversations. The more you train me, the smarter and more accurate I get! 🧠`, source: "azure", suggestions: [
      { label: "🧠 Train More", action: "I want to add more training knowledge" },
      { label: "📚 View KB", action: "Show all trained knowledge entries" },
      { label: "🧪 Test Knowledge", action: "Test if AI remembers what I just trained" }
    ] }]);
  };
  useEffect(() => { fetchKbEntries(); }, []);

  // ─── Auto-Generate Essential Docs on First Load (if empty) ──────────
  const autoGenerateEssentialDocs = async () => {
    if (kbAutoGenRanRef.current || kbAutoGenRunning) return;
    kbAutoGenRanRef.current = true;
    const essentialTopics = [
      { topic: "VPN Setup & Troubleshooting Guide", category: "Networking" },
      { topic: "Password Reset & Account Unlock Procedure", category: "Security" },
      { topic: "Azure MFA Enrollment & Troubleshooting", category: "Security" },
      { topic: "New Employee IT Onboarding Checklist", category: "SOP" },
      { topic: "Email Migration & Configuration Guide", category: "Email" },
      { topic: "Incident Response & Escalation SOP", category: "SOP" },
    ];
    setKbAutoGenRunning(true);
    setKbAutoGenProgress({ total: essentialTopics.length, done: 0, current: "", status: "Starting AI documentation generation..." });
    for (let i = 0; i < essentialTopics.length; i++) {
      const t = essentialTopics[i];
      setKbAutoGenProgress({ total: essentialTopics.length, done: i, current: t.topic, status: `Generating: ${t.topic}` });
      try {
        await fetch("/api/ai/generate-guide", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: t.topic, category: t.category, includeScreenshots: true })
        });
      } catch { /* best-effort */ }
    }
    setKbAutoGenProgress({ total: essentialTopics.length, done: essentialTopics.length, current: "", status: "All essential documents generated!" });
    setKbAutoGenRunning(false);
    fetchKbEntries();
    trackAction("AI Training", "Auto-Generated Essential Docs", `${essentialTopics.length} documents generated automatically`, "AI");
    setTimeout(() => setKbAutoGenProgress({ total: 0, done: 0, current: "", status: "" }), 5000);
  };

  // ─── SLA Live Refresh Timer (every 60s, paused when tab hidden) ───
  useEffect(() => {
    const slaTimer = setInterval(() => {
      // Only tick when the tab is actually visible — invisible ticks just
      // burn CPU on background re-renders.
      if (typeof document !== "undefined" && document.hidden) return;
      setSlaTick(t => t + 1);
    }, 60000);
    return () => clearInterval(slaTimer);
  }, []);

  // ─── Audit Log & Version History Functions ────────────────────────────
  const fetchAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const res = await fetch("/api/audit?limit=500");
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.data || []);
      }
    } catch (e) { console.warn("[Audit] Fetch failed:", e.message); }
    setAuditLoading(false);
  };
  // Seed version history from local state changes
  useEffect(() => {
    const seed = [];
    incidents.forEach(inc => {
      seed.push({ id: `VH_INC_${inc.id}`, timestamp: inc.createdAt || new Date().toISOString(), module: "Incidents", action: "Created", detail: `${inc.id}: ${inc.title}`, actor: inc.assignedTo || "System", actorType: "human" });
      if (inc.status === "Resolved" || inc.status === "Closed") seed.push({ id: `VH_INC_R_${inc.id}`, timestamp: inc.resolvedAt || inc.createdAt || new Date().toISOString(), module: "Incidents", action: inc.status, detail: `${inc.id}: ${inc.title}`, actor: inc.assignedTo || "System", actorType: "human" });
    });
    changes.forEach(ch => seed.push({ id: `VH_CHG_${ch.id}`, timestamp: ch.submittedDate || new Date().toISOString(), module: "Changes", action: ch.status, detail: `${ch.id}: ${ch.title}`, actor: ch.submittedBy || "System", actorType: "human" }));
    problems.forEach(pr => seed.push({ id: `VH_PRB_${pr.id}`, timestamp: pr.createdAt || new Date().toISOString(), module: "Problems", action: pr.status, detail: `${pr.id}: ${pr.title}`, actor: pr.assignedTo || "System", actorType: "human" }));
    requests.forEach(rq => seed.push({ id: `VH_REQ_${rq.id}`, timestamp: rq.createdAt || new Date().toISOString(), module: "Requests", action: rq.status, detail: `${rq.id}: ${rq.title}`, actor: rq.requestedBy || "System", actorType: "human" }));
    aiMessages.filter(m => m.role === "ai" && m.source === "azure").forEach((m, i) => seed.push({ id: `VH_AI_${i}`, timestamp: new Date().toISOString(), module: "AI Chat", action: "AI Response", detail: (m.text || "").substring(0, 120), actor: "AI", actorType: "ai" }));
    aiMessages.filter(m => m.role === "ai" && m.source === "local").forEach((m, i) => seed.push({ id: `VH_AI_L_${i}`, timestamp: new Date().toISOString(), module: "AI Chat", action: "AI Response (Local)", detail: (m.text || "").substring(0, 120), actor: "AI", actorType: "ai" }));
    rbacAuditLog.forEach(r => seed.push({ id: `VH_RBAC_${r.id}`, timestamp: r.timestamp || new Date().toISOString(), module: "RBAC", action: r.action, detail: `${r.user}: ${r.from} → ${r.to}`, actor: r.by || "System", actorType: "human" }));
    seed.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    setVersionHistory(prev => {
      const existingIds = new Set(prev.map(e => e.id));
      const newEntries = seed.filter(s => !existingIds.has(s.id));
      return [...prev, ...newEntries].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 500);
    });
  }, [incidents.length, changes.length, problems.length, requests.length, aiMessages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const [integrations, setIntegrations] = useState(() => {
    const saved = _ls("vgc_integrations", INTEGRATION_CATALOG);
    // Merge any new catalog entries that don't exist in saved state
    const savedIds = new Set(saved.map(i => i.id));
    const merged = [...saved, ...INTEGRATION_CATALOG.filter(c => !savedIds.has(c.id))];
    return merged;
  });
  const [swSettingsOpen, setSwSettingsOpen] = useState(false);
  const [swConfig, setSwConfig] = useState({ apiKey: "", apiHost: "wwwasia.system-monitor.com", testing: false, testResult: null, saving: false });
  const [smtpConfig, setSmtpConfig] = useState({
    host: "smtp.office365.com", port: 587, encryption: "STARTTLS",
    username: "itsm-noreply@vgctechnology.com.sg", password: "",
    fromName: "VGC ITSM", fromEmail: "itsm-noreply@vgctechnology.com.sg",
    replyTo: "help@vgctechnology.com", enabled: true,
    testStatus: null, lastTested: null,
    templates: {
      ticketCreated: { enabled: true, subject: "[{ticketId}] Ticket Created: {title}" },
      ticketUpdated: { enabled: true, subject: "[{ticketId}] Ticket Updated: {title}" },
      ticketResolved: { enabled: true, subject: "[{ticketId}] Resolved: {title}" },
      ticketClosed: { enabled: true, subject: "[{ticketId}] Closed: {title}" },
      slaWarning: { enabled: true, subject: "[{ticketId}] SLA Warning: {title}" },
      slaBreach: { enabled: true, subject: "[{ticketId}] SLA BREACH: {title}" },
    },
    signature: "<p>Best regards,<br/><b>VGC Technology Pte Ltd</b><br/>IT Service Management<br/>📧 help@vgctechnology.com | 📞 +65 6234 0000</p>"
  });
  const [emailCompose, setEmailCompose] = useState(null); // {ticketId, to, subject, body, isInternal}
  const [managedUsers, setManagedUsers] = useState(() => _ls("vgc_managed_users", USERS));
  // ─── Customer Management State ──────────────────────────────────────────
  const [customers, setCustomers] = useState(() => _ls("vgc_customers", INITIAL_CUSTOMERS));
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerCategoryFilter, setCustomerCategoryFilter] = useState("All");
  const [customerStatusFilter, setCustomerStatusFilter] = useState("All");
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState(null);
  const [customerForm, setCustomerForm] = useState({ name: "", category: "Ad-Hoc", contactPerson: "", email: "", phone: "", address: "", status: "Active", contractStart: "", contractEnd: "", services: [], notes: "" });
  const [customerViewMode, setCustomerViewMode] = useState("table");
  // ─── Service Reports State ──────────────────────────────────────────────
  const [serviceReports, setServiceReports] = useState(() => _ls("vgc_service_reports", []));
  const [showAddReport, setShowAddReport] = useState(false);
  const [editingReportId, setEditingReportId] = useState(null);
  const [reportForm, setReportForm] = useState({ customerId: "", title: "", reportDate: new Date().toISOString().slice(0,10), periodFrom: "", periodTo: "", engineer: "", summary: "", incidents: [], status: "Draft" });
  const [reportViewId, setReportViewId] = useState(null);
  const [entraIdConfig, setEntraIdConfig] = useState({
    enabled: true, tenantId: "13756b13-6db9-4266-9737-baf100cf340c", clientId: "be40e7d3-69a7-4414-90ba-4391d152f70b",
    redirectUri: "https://vgcitsm.vgcsg.com", scimEnabled: true,
    groupSync: true, conditionalAccess: true, mfaEnforced: true,
    groupMappings: [
      { entraGroup: "SG-ITSM-Admins", rbacRole: "Administrator" },
      { entraGroup: "SG-ITSM-ServiceDesk", rbacRole: "L1 Support Engineer" },
      { entraGroup: "SG-ITSM-Engineers", rbacRole: "Network Engineer" },
      { entraGroup: "SG-ITSM-ChangeBoard", rbacRole: "Change Manager" },
      { entraGroup: "SG-ITSM-AllUsers", rbacRole: "End User" },
    ]
  });
  const [pdpaConfig, setPdpaConfig] = useState({
    enabled: true, dpoName: "VGC Admin", dpoEmail: "dpo@vgctechnology.com",
    retentionPolicies: [
      { entity: "Incidents", retention: 365, action: "Anonymize", enabled: true },
      { entity: "Problems", retention: 730, action: "Anonymize", enabled: true },
      { entity: "Changes", retention: 1095, action: "Archive", enabled: true },
      { entity: "Service Requests", retention: 365, action: "Delete", enabled: true },
      { entity: "User Activity Logs", retention: 180, action: "Delete", enabled: true },
      { entity: "AI Training Data", retention: 90, action: "Anonymize", enabled: true },
      { entity: "Chat Transcripts", retention: 30, action: "Delete", enabled: false },
    ],
    consentManagement: true, dsarWorkflow: true, dataClassification: true,
    auditLog: []
  });
  const INFRA_DEFAULTS = {
    database: { type: "Azure MySQL Flexible Server", region: "Southeast Asia (Singapore)", server: "vgc-itsm1-mysql.mysql.database.azure.com", database: "itsmdb", tier: "Burstable", sku: "Standard_B1ms", version: "8.0.21", storage: "20 GB", ha: "Disabled", backupRetention: "7 days", status: "Ready" },
    webApp: { name: "vgc-itsm1-app", region: "Southeast Asia (Singapore)", plan: "P1v3 (PremiumV3)", runtime: "Node.js 20 LTS", status: "Running", url: "vgc-itsm1-app.azurewebsites.net", ssl: "Azure Managed", scaling: "Manual (1 instance)", deployment: "ZIP Deploy (az webapp deploy)" },
    openAI: { name: "hlain-mo2f4i57", region: "East US 2", sku: "S0", endpoint: "https://hlain-mo2f4i57-eastus2.cognitiveservices.azure.com/", model: "gpt-5.4-pro", rg: "AI-Models-RG1", status: "Active" },
    identity: { name: "oidc-msi-b517", type: "User Assigned Managed Identity" },
    zendesk: { domain: "vgctech.zendesk.com", status: "Connected" },
    cost: {
      appService: { name: "App Service P1v3 Linux", monthly: 108.41, note: "2 cores, 8 GB RAM" },
      mysql: { name: "MySQL Flexible B1ms", monthly: 12.41, storage: 2.30, note: "1 vCore, 2 GB RAM, 20 GB storage" },
      openAI: { name: "VGC-AI Engine (S0)", monthly: 3.00, note: "Pay-per-token, est. light usage" },
      total: 126.12,
      currency: "USD",
      alerts: [
        { level: "info", text: "P1v3 PremiumV3 plan provides 2 cores, 8 GB RAM with auto-scale support and zone redundancy options." },
        { level: "warning", text: "MySQL HA is disabled — single point of failure. Enable HA (+$12.41/mo) for production reliability." },
        { level: "tip", text: "VGC-AI Engine cost is usage-based. Monitor token consumption to avoid surprise charges." },
        { level: "info", text: "Total hosting cost is ~$126/mo — production-grade ITSM + AI platform with PremiumV3 performance." },
      ]
    }
  };
  const [infraConfig, setInfraConfig] = useState(INFRA_DEFAULTS);
  const [infraLive, setInfraLive] = useState(false);
  const [infraLoading, setInfraLoading] = useState(false);
  const [infraResources, setInfraResources] = useState([]);

  // Live fetch Azure infrastructure data
  useEffect(() => {
    const fetchInfra = async () => {
      setInfraLoading(true);
      try {
        const r = await fetch("/api/azure/resources");
        const data = await r.json();
        if (data.live && !data.error) {
          setInfraLive(true);
          setInfraResources(data.resources || []);
          setInfraConfig(prev => {
            const updated = { ...prev };
            if (data.appServicePlan) {
              const p = data.appServicePlan;
              updated.webApp = { ...prev.webApp,
                plan: `${p.size || p.sku?.size || "?"} (${p.tier || "?"})`,
                status: p.status || prev.webApp.status,
                scaling: `${p.capacity || 1} instance(s)`,
              };
              updated.cost = { ...prev.cost,
                appService: { ...prev.cost.appService, name: `App Service ${p.tier} ${p.size || ""}`.trim() },
              };
            }
            if (data.webApp) {
              const w = data.webApp;
              updated.webApp = { ...updated.webApp,
                name: w.name || updated.webApp.name,
                status: w.state || updated.webApp.status,
                runtime: w.linuxFxVersion ? w.linuxFxVersion.replace("|", " ") : updated.webApp.runtime,
                url: w.defaultHostName || updated.webApp.url,
                ssl: w.httpsOnly ? "HTTPS Enforced" : "HTTP",
              };
            }
            if (data.mysqlServer) {
              const m = data.mysqlServer;
              updated.database = { ...prev.database,
                tier: m.tier || prev.database.tier,
                sku: m.sku?.name || prev.database.sku,
                status: m.state || prev.database.status,
                version: m.version || prev.database.version,
                storage: m.storageSizeGB ? `${m.storageSizeGB} GB` : prev.database.storage,
                ha: m.haEnabled ? "Enabled" : "Disabled",
                backupRetention: m.backupRetentionDays ? `${m.backupRetentionDays} days` : prev.database.backupRetention,
              };
              updated.cost = { ...updated.cost,
                mysql: { ...updated.cost.mysql, name: `MySQL Flexible ${m.sku?.name || "?"}` },
              };
            }
            return updated;
          });
        }
      } catch (e) { console.warn("[Infra] Live fetch failed:", e.message); }
      finally { setInfraLoading(false); }
    };
    fetchInfra();
    const interval = setInterval(() => { if (!tabVisibleRef.current) return; fetchInfra(); }, 60000);
    return () => clearInterval(interval);
  }, []);

  // ─── Persist to localStorage + SQLite Database ─────────────────────────
  const DB_API = "/api/db";
  const _save = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ } };

  // ─── Recycle Bin helpers ───────────────────────────────────────────────
  const RECYCLE_LABELS = { customers: "Customer", vendors: "Vendor", workflow_rules: "Workflow Rule", service_reports: "Service Report", service_catalog: "Catalog Item", managed_users: "User", kb_articles: "KB Article", survey_templates: "Survey Template", ai_actions: "AI Action" };

  const softDelete = useCallback((type, item, listSetter, storageKey) => {
    if (!item || !item.id) return;
    const entry = { ...item, _recycleType: type, _deletedAt: new Date().toISOString(), _deletedBy: currentUser?.name || "System" };
    setRecycleBin(prev => { const updated = [entry, ...prev].slice(0, 100); _save("vgc_recycle_bin", updated); return updated; });
    listSetter(prev => { const updated = prev.filter(x => x.id !== item.id); if (storageKey) _save(storageKey, updated); return updated; });
    // Show undo toast
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const toastId = Date.now();
    setUndoToast({ id: toastId, label: `${RECYCLE_LABELS[type] || type} "${item.name || item.title || item.id}" deleted`, type, item, listSetter, storageKey });
    undoTimerRef.current = setTimeout(() => { setUndoToast(prev => prev?.id === toastId ? null : prev); }, 8000);
  }, [currentUser]);

  const undoDelete = useCallback(() => {
    if (!undoToast) return;
    const { item, listSetter, storageKey } = undoToast;
    const { _recycleType, _deletedAt, _deletedBy, ...cleanItem } = item;
    listSetter(prev => { const updated = [cleanItem, ...prev]; if (storageKey) _save(storageKey, updated); return updated; });
    setRecycleBin(prev => { const updated = prev.filter(x => !(x.id === item.id && x._recycleType === item._recycleType)); _save("vgc_recycle_bin", updated); return updated; });
    setUndoToast(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, [undoToast]);

  const emptyRecycleBin = useCallback(() => { setRecycleBin([]); _save("vgc_recycle_bin", []); }, []);

  // Sync an array collection to the SQLite backend (fire-and-forget, debounced 800ms per collection)
  // HARD RULE: Demo users must NEVER write to the shared production DB
  const _dbSyncTimers = useRef({});
  const _dbSync = useCallback((collection, data) => {
    if (!data || !Array.isArray(data)) return;
    if (!isEntraProductionUser) return;
    // Trailing debounce per collection — coalesces bursts (bulk imports, undo/redo, rapid edits)
    if (_dbSyncTimers.current[collection]) clearTimeout(_dbSyncTimers.current[collection]);
    _dbSyncTimers.current[collection] = setTimeout(async () => {
      if (isEntraProductionUser && window.__vgcWaitForApiAuth) {
        const authReady = await window.__vgcWaitForApiAuth(8000);
        if (!authReady) return;
      }
      fetch(`${DB_API}/${collection}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).catch(() => {}); // silent fail — localStorage is primary fallback
    }, 800);
  }, [isEntraProductionUser]);

  // Sync a single record to the SQLite backend
  // HARD RULE: Demo users must NEVER write to the shared production DB
  const _dbSyncOne = useCallback((collection, record) => {
    if (!record || !record.id) return;
    (async () => {
      if (!isEntraProductionUser) return;
      if (isEntraProductionUser && window.__vgcWaitForApiAuth) {
        const authReady = await window.__vgcWaitForApiAuth(8000);
        if (!authReady) return;
      }
      fetch(`${DB_API}/${collection}/${encodeURIComponent(record.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      }).catch(() => {});
    })();
  }, [isEntraProductionUser]);

  const dbInitRef = useRef(false);

  // ─── Initial DB hydration: load from backend on first load if localStorage is empty ───
  useEffect(() => {
    if (dbInitRef.current) return;
    if (!isEntraProductionUser) return;
    dbInitRef.current = true;
    fetch(`${DB_API}-stats`).then(r => r.json()).then(async (stats) => {
      // Hydrate state from DB if localStorage was empty (new browser/device)
      const hydrateMap = [
        ["users", stats.collections?.users, setManagedUsers, "vgc_managed_users"],
        ["incidents", stats.collections?.incidents, setIncidents, "vgc_incidents"],
        ["problems", stats.collections?.problems, setProblems, "vgc_problems"],
        ["changes", stats.collections?.changes, setChanges, "vgc_changes"],
        ["requests", stats.collections?.requests, setRequests, "vgc_requests"],
        ["assets", stats.collections?.assets, setAssets, "vgc_assets"],
        ["kb", stats.collections?.kb, setKbArticles, "vgc_kb"],
        ["customers", stats.collections?.customers, setCustomers, "vgc_customers"],
      ];
      for (const [coll, count, setter, lsKey] of hydrateMap) {
        // For Entra users: always hydrate from DB (production data only)
        // HARD RULE: Demo users must NEVER read production data from shared DB
        const shouldHydrate = isEntraProductionUser ? (count > 0) : false;
        if (shouldHydrate) {
          try {
            const r = await fetch(`${DB_API}/${coll}`);
            if (r.ok) {
              const data = await r.json();
              if (Array.isArray(data) && data.length > 0) {
                const items = data.map(d => typeof d.data === "string" ? JSON.parse(d.data) : (d.data || d));
                // For Entra users: filter out any seed data that leaked into DB
                if (isEntraProductionUser) {
                  const filtered = _cleanTestRecords(items).filter(item => !item.title?.includes("Problem from INC000") && !item.linkedIncidents?.some(id => /^(INC000\d|INC-D\d)$/.test(id)));
                  if (filtered.length > 0) setter(filtered);
                } else {
                  const filtered = _cleanTestRecords(items).filter(item => !item.title?.includes("Problem from INC000") && !item.linkedIncidents?.some(id => /^(INC000\d|INC-D\d)$/.test(id)));
                  if (filtered.length > 0) setter(filtered);
                }
              }
            }
          } catch (e) { /* ignore */ }
        }
      }
      // Seed DB from state if DB is empty — ONLY for demo/local users
      // HARD RULE: Entra production users must NEVER seed the DB with demo data

      // ─── Load SLA Policy from server (always prefer server-saved policy) ─────
      try {
        const slr = await fetch(`/api/sla/config`);
        if (slr.ok) {
          const saved = await slr.json();
          if (saved && saved.severities) {
            // Merge server policy with client defaults (server wins for matching keys)
            setSlaPolicy(prev => ({ ...prev, ...saved, severities: { ...prev.severities, ...saved.severities }, supportHours: { ...prev.supportHours, ...(saved.supportHours || {}) } }));
          }
        }
      } catch (e) { /* ignore */ }

      // ─── Load Tenant Settings from server (persists across deploys) ─────
      try {
        const tsr = await fetch("/api/settings/tenant");
        if (tsr.ok) {
          const ts = await tsr.json();
          if (ts && ts.orgName) {
            setGeneralSettings(ts);
            _save("vgc_general_settings", ts);
          }
        }
      } catch (e) { /* ignore */ }

      // ─── Load Incident Templates from server ─────
      try {
        const tplr = await fetch(`${DB_API}/incident_templates`);
        if (tplr.ok) {
          const tplData = await tplr.json();
          if (tplData.data && tplData.data.length > 0) setIncidentTemplates(tplData.data);
        }
      } catch (e) { /* ignore */ }

      // ─── Load Approval Chains + Instances ─────
      try {
        const acr = await fetch(`${DB_API}/approval_chains`);
        if (acr.ok) { const d = await acr.json(); if (d.data) setApprovalChains(d.data); }
        const air = await fetch(`${DB_API}/approval_instances`);
        if (air.ok) { const d = await air.json(); if (d.data) setApprovalInstances(d.data); }
      } catch (e) { /* ignore */ }

      // ─── Load Report Schedules ─────
      try {
        const rsr = await fetch("/api/reports/schedules");
        if (rsr.ok) { const d = await rsr.json(); if (d.data) setReportSchedules(d.data); }
      } catch (e) { /* ignore */ }

      // ─── Load Email Whitelist ─────
      try {
        const ewlr = await fetch(`${DB_API}/email_whitelist`);
        if (ewlr.ok) { const d = await ewlr.json(); if (d.data && d.data.length > 0) setEmailWhitelist(d.data); }
      } catch (e) { /* ignore */ }

      if (!isEntraProductionUser) {
        const syncMap = [
          ["incidents", incidents], ["problems", problems], ["changes", changes],
          ["requests", requests], ["assets", assets], ["kb", kbArticles],
          ["services", serviceCatalog], ["users", managedUsers], ["vendors", vendors],
          ["workflow_rules", workflowRules], ["survey_templates", surveyTemplates],
          ["smart_tasks", smartTasks],
          ["customers", customers], ["service_reports", serviceReports],
        ];
        for (const [coll, data] of syncMap) {
          if ((!stats.collections[coll] || stats.collections[coll] === 0) && data && data.length > 0) {
            _dbSync(coll, data);
          }
        }
      }
    }).catch(() => {});
  }, [isEntraProductionUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dual-write: localStorage + DB — for Entra users, block seed data from contaminating DB
  const _seedPattern = /^(INC-D\d|INC000|PRB000|CHG000|REQ000|DCUS-|DEMO-)\d*$/;
  const _isSeedLinked = (item) => item.title?.includes("Problem from INC000") || item.linkedIncidents?.some(id => /^(INC000\d|INC-D\d)$/.test(id));
  const _safeDbSync = (coll, data) => {
    if (!data || !Array.isArray(data) || data.length === 0) return;
    // For Entra users: filter out seed data and seed-linked records before syncing
    if (isEntraProductionUser) {
      const clean = data.filter(r => !_seedPattern.test(r.id) && !_isSeedLinked(r));
      if (clean.length > 0) _dbSync(coll, clean);
      return;
    }
    _dbSync(coll, data);
  };
  useEffect(() => { _save("vgc_incidents", incidents); _safeDbSync("incidents", incidents); }, [incidents]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _save("vgc_problems", problems); _safeDbSync("problems", problems); }, [problems]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _save("vgc_changes", changes); _safeDbSync("changes", changes); }, [changes]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _save("vgc_requests", requests); _safeDbSync("requests", requests); }, [requests]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _save("vgc_assets", assets); _dbSync("assets", assets); }, [assets]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _save("vgc_kb", kbArticles); _dbSync("kb", kbArticles); }, [kbArticles]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _save("vgc_services", serviceCatalog); _dbSync("services", serviceCatalog); }, [serviceCatalog]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _save("vgc_profile_photo", profilePhoto); }, [profilePhoto]);
  useEffect(() => { _save("vgc_custom_fields", customFields); _dbSync("custom_fields", customFields); }, [customFields]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _save("vgc_notif_prefs", notifPrefs); }, [notifPrefs]);
  useEffect(() => { _save("vgc_contracts", contracts); _dbSync("contracts", contracts); }, [contracts]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _save("vgc_automation_rules", automationRules); _dbSync("automation_rules", automationRules); }, [automationRules]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _save("vgc_avatar", avatarConfig); }, [avatarConfig]);
  useEffect(() => {
    try {
      localStorage.removeItem("vgc_current_user");
      if (currentUser) sessionStorage.setItem("vgc_current_user", JSON.stringify(currentUser));
      else sessionStorage.removeItem("vgc_current_user");
    } catch (e) { /* ignore */ }
  }, [currentUser]);
  useEffect(() => { _save("vgc_integrations", integrations); _dbSync("integrations", integrations); }, [integrations]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _save("vgc_managed_users", managedUsers); _dbSync("users", managedUsers); }, [managedUsers]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _save("vgc_rbac_audit", rbacAuditLog); }, [rbacAuditLog]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _save("vgc_custom_permissions", customPermissions); }, [customPermissions]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _save("vgc_customers", customers); _dbSync("customers", customers); }, [customers]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { _save("vgc_service_reports", serviceReports); _dbSync("service_reports", serviceReports); }, [serviceReports]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (emailWhitelist.length > 0) _dbSync("email_whitelist", emailWhitelist); }, [emailWhitelist]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Global Auto-Sync: Zendesk ↔ ITSM (every 60s) ─────────────────
  // HARD RULE: Demo user must NEVER trigger production API calls
  useEffect(() => {
    if (!isEntraProductionUser) return;
    const doSync = async () => {
      try {
        setGlobalSyncActive(true);
        // 1) Refresh Zendesk stats
        const statsR = await fetch("/api/zendesk/stats");
        if (statsR.ok) { const d = await statsR.json(); setZdStats({ open: Number(d?.open) || 0, pending: Number(d?.pending) || 0, hold: Number(d?.hold) || 0, solved: Number(d?.solved) || 0 }); setZdConnected(true); }
        // 2) Fetch Zendesk user
        const meR = await fetch("/api/zendesk/me");
        if (meR.ok) { const d = await meR.json(); if (d?.user) { setZdUser(d.user); setZdConnected(true); } }
        // 3) Run incremental sync to pull new/updated tickets into ITSM
        const incSyncR = await fetch("/api/zendesk/incremental-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (incSyncR.ok) {
          const syncData = await incSyncR.json();
          if (syncData.stats && (syncData.stats.ticketsCreated > 0 || syncData.stats.ticketsUpdated > 0)) {
            await refreshIncidentsFromDB();
          }
        }
        // 4) Auto-sync Zendesk organizations → ITSM customers
        try {
          await fetch("/api/zendesk/sync-organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          const custR = await fetch("/api/db/customers");
          if (custR.ok) { const custData = await custR.json(); if (Array.isArray(custData.data) && custData.data.length > 0) setCustomers(custData.data); }
        } catch (e) { /* ignore */ }
        setGlobalLastSync(new Date());
      } catch (e) { /* ignore */ } finally { setGlobalSyncActive(false); }
    };
    doSync(); // immediate on mount
    globalSyncRef.current = setInterval(() => { if (!tabVisibleRef.current) return; doSync(); }, 60000); // every 60s
    return () => { if (globalSyncRef.current) clearInterval(globalSyncRef.current); };
  }, [isEntraProductionUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Phase T6: WebSocket real-time push ───────────────────────────────
  // Backend already broadcasts on every DB write/update/delete via wsServer.
  // We connect once on mount, subscribe to the channels we care about, and
  // refetch the affected collection when a broadcast arrives. Refetches are
  // coalesced (250 ms debounce per collection) so a burst of writes triggers
  // only one fetch. Auto-reconnects with exponential backoff (1s → 30s).
  // Falls back gracefully — if WS never connects, the existing 60 s polls
  // continue to work.
  const [wsBridgeConnected, setWsBridgeConnected] = React.useState(false);
  React.useEffect(() => {
    if (!isEntraProductionUser) return;
    let ws = null;
    let reconnectTimer = null;
    let reconnectDelay = 1000;
    let stopped = false;
    const refreshTimers = new Map(); // collection -> timeoutId
    const setterMap = {
      incidents: setIncidents,
      problems: setProblems,
      changes: setChanges,
      requests: setRequests,
      customers: setCustomers,
      assets: setAssets,
    };
    const scheduleRefresh = (collection) => {
      if (!setterMap[collection]) return;
      if (refreshTimers.has(collection)) clearTimeout(refreshTimers.get(collection));
      refreshTimers.set(collection, setTimeout(async () => {
        refreshTimers.delete(collection);
        try {
          const r = await fetch(`/api/db/${collection}`);
          if (!r.ok) return;
          const d = await r.json();
          if (d?.data) setterMap[collection](d.data);
        } catch { /* ignore */ }
      }, 250));
    };
    const connect = () => {
      if (stopped) return;
      try {
        const proto = window.location.protocol === "https:" ? "wss" : "ws";
        ws = new WebSocket(`${proto}://${window.location.host}/api/ws`);
        ws.onopen = () => {
          reconnectDelay = 1000;
          setWsBridgeConnected(true);
          try { ws.send(JSON.stringify({ type: "subscribe", channels: ["incidents", "sla", "notifications", "escalations", "dashboard", "zendesk", "ai_actions", "ai_cards", "system"] })); } catch { /* ignore */ }
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (!msg || !msg.collection) return;
            // ─── Proactive AI Card Push (real-time card notifications) ───
            if (msg.collection === "ai_cards" && msg.data) {
              const cardData = msg.data;
              // Inject proactive card as an AI message
              setAiMessages(prev => [...prev, {
                role: "ai",
                text: cardData.text || "",
                source: "proactive",
                cards: cardData.cards || [],
                suggestionCards: cardData.suggestions || [],
                _proactive: true,
              }]);
              if (cardData.toast) {
                showToast(cardData.toast, cardData.toastType || "info");
              }
            }
            // ─── In-App Notification Bell ───
            if (msg.collection === "notifications" && msg.data) {
              const nArr = Array.isArray(msg.data) ? msg.data : [msg.data];
              setInAppNotifs(prev => {
                const ids = new Set(prev.map(n => n.id));
                const fresh = nArr.filter(n => n && n.id && !ids.has(n.id)).map(n => ({ ...n, read: false }));
                return fresh.length ? [...fresh, ...prev].slice(0, 50) : prev;
              });
            }
            if (msg.action === "delete" || msg.action === "upsert" || msg.action === "update" || msg.action === "bulk_upsert" || msg.action === "bulk_update" || msg.action === "merge") {
              scheduleRefresh(msg.collection);
            }
          } catch { /* ignore non-JSON */ }
        };
        ws.onclose = () => {
          setWsBridgeConnected(false);
          if (stopped) return;
          reconnectTimer = setTimeout(connect, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        };
        ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
      } catch {
        if (!stopped) reconnectTimer = setTimeout(connect, reconnectDelay);
      }
    };
    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      for (const t of refreshTimers.values()) clearTimeout(t);
      try { ws && ws.close(); } catch { /* ignore */ }
    };
  }, [isEntraProductionUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // SVG Icon Components — Enterprise Cybersecurity Grade
  const NavIcon = ({ type, isActive }) => {
    const c = isActive ? "#E8ECF4" : "#5A6178";
    const ac = isActive ? "#6366F1" : "none";
    const sz = 16;
    const icons = {
      dashboard: <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none">{/* Command Center Grid */}<rect x="1" y="1" width="6" height="6" rx="1.5" stroke={c} strokeWidth="1.5" fill={ac+"22"}/><rect x="9" y="1" width="6" height="4" rx="1.5" stroke={c} strokeWidth="1.5" fill={ac+"11"}/><rect x="9" y="7" width="6" height="8" rx="1.5" stroke={c} strokeWidth="1.5" fill={ac+"11"}/><rect x="1" y="9" width="6" height="6" rx="1.5" stroke={c} strokeWidth="1.5"/>{isActive && <><circle cx="4" cy="4" r="1" fill="#6366F1"><animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite"/></circle><circle cx="12" cy="11" r="0.8" fill="#06B6D4"><animate attributeName="opacity" values="0.3;1;0.3" dur="2s" repeatCount="indefinite"/></circle></>}</svg>,
      incidents: <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none">{/* Threat Alert Triangle */}<path d="M8 1.5L14.5 13H1.5L8 1.5Z" stroke={isActive?"#FF6B6B":c} strokeWidth="1.5" strokeLinejoin="round" fill={isActive?"#FF6B6B11":"none"}/><line x1="8" y1="5.5" x2="8" y2="8.5" stroke={isActive?"#FF6B6B":c} strokeWidth="1.8" strokeLinecap="round"><animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite"/></line><circle cx="8" cy="10.5" r="0.9" fill={isActive?"#FF6B6B":c}>{isActive && <animate attributeName="opacity" values="1;0.4;1" dur="1.2s" repeatCount="indefinite"/>}</circle></svg>,
      problems: <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none">{/* Root Cause Radar */}<circle cx="8" cy="8" r="6.5" stroke={c} strokeWidth="1.3"/><circle cx="8" cy="8" r="3.5" stroke={isActive?"#CE93D8":c} strokeWidth="0.8" strokeDasharray="2 2"/><circle cx="8" cy="8" r="1.5" fill={isActive?"#CE93D8":c+"66"}/><line x1="8" y1="1.5" x2="8" y2="3.5" stroke={c} strokeWidth="0.8"/><line x1="8" y1="12.5" x2="8" y2="14.5" stroke={c} strokeWidth="0.8"/><line x1="1.5" y1="8" x2="3.5" y2="8" stroke={c} strokeWidth="0.8"/><line x1="12.5" y1="8" x2="14.5" y2="8" stroke={c} strokeWidth="0.8"/>{isActive && <circle cx="8" cy="8" r="3.5" fill="none" stroke="#CE93D8" strokeWidth="0.5"><animate attributeName="r" values="3.5;5.5;3.5" dur="3s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.6;0;0.6" dur="3s" repeatCount="indefinite"/></circle>}</svg>,
      changes: <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none">{/* Deploy Pipeline */}<circle cx="4" cy="3" r="2" stroke={c} strokeWidth="1.3" fill={isActive?"#FFB34722":"none"}/><circle cx="12" cy="3" r="2" stroke={c} strokeWidth="1.3"/><circle cx="8" cy="13" r="2" stroke={isActive?"#FFB347":c} strokeWidth="1.3" fill={isActive?"#FFB34722":"none"}/><path d="M4 5V8L8 11" stroke={c} strokeWidth="1.2" strokeLinecap="round"/><path d="M12 5V8L8 11" stroke={c} strokeWidth="1.2" strokeLinecap="round"/>{isActive && <circle cx="8" cy="13" r="2" stroke="#FFB347" strokeWidth="0.5"><animate attributeName="r" values="2;3;2" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite"/></circle>}</svg>,
      requests: <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none">{/* Service Request Clipboard */}<rect x="3" y="0.5" width="10" height="14.5" rx="1.5" stroke={c} strokeWidth="1.3"/><rect x="5.5" y="0" width="5" height="2" rx="1" stroke={c} strokeWidth="1" fill="#0A0C14"/><path d="M5.5 5.5H10.5" stroke={isActive?"#81C784":c} strokeWidth="1.2" strokeLinecap="round"/><path d="M5.5 8H10.5" stroke={c} strokeWidth="1" strokeLinecap="round"/><path d="M5.5 10.5H9" stroke={c} strokeWidth="1" strokeLinecap="round"/>{isActive && <circle cx="13" cy="1.5" r="2" fill="#81C784"><animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite"/></circle>}</svg>,
      catalog: <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none">{/* Service Store Grid */}<rect x="1" y="1" width="6" height="6" rx="1.5" stroke={c} strokeWidth="1.3" fill={isActive?"#64B5F611":"none"}/><rect x="9" y="1" width="6" height="6" rx="1.5" stroke={c} strokeWidth="1.3" fill={isActive?"#EC489911":"none"}/><rect x="1" y="9" width="6" height="6" rx="1.5" stroke={c} strokeWidth="1.3"/><rect x="9" y="9" width="6" height="6" rx="1.5" stroke={c} strokeWidth="1.3" fill={isActive?"#81C78411":"none"}/>{isActive && <><circle cx="4" cy="4" r="1" fill="#64B5F6"/><circle cx="12" cy="4" r="1" fill="#EC4899"/><circle cx="12" cy="12" r="1" fill="#81C784"/></>}</svg>,
      knowledge: <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none">{/* Secure Knowledge Vault */}<path d="M2 2.5H7L8 4L9 2.5H14V13.5H9L8 15L7 13.5H2V2.5Z" stroke={c} strokeWidth="1.3" strokeLinejoin="round" fill={ac+"11"}/><line x1="8" y1="4" x2="8" y2="15" stroke={c} strokeWidth="0.8"/>{isActive && <><path d="M4 5.5H6.5" stroke="#06B6D4" strokeWidth="0.8" strokeLinecap="round"/><path d="M4 7.5H6" stroke="#06B6D4" strokeWidth="0.8" strokeLinecap="round"/><path d="M4 9.5H6.5" stroke="#06B6D4" strokeWidth="0.8" strokeLinecap="round"/><path d="M9.5 5.5H12" stroke="#64B5F6" strokeWidth="0.8" strokeLinecap="round"/><path d="M9.5 7.5H11.5" stroke="#64B5F6" strokeWidth="0.8" strokeLinecap="round"/><path d="M9.5 9.5H12" stroke="#64B5F6" strokeWidth="0.8" strokeLinecap="round"/></>}</svg>,
      assets: <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none">{/* CMDB Network Topology */}<rect x="5" y="1" width="6" height="4" rx="1" stroke={c} strokeWidth="1.3" fill={isActive?"#06B6D411":"none"}/><rect x="0.5" y="11" width="5" height="3.5" rx="1" stroke={c} strokeWidth="1.3"/><rect x="10.5" y="11" width="5" height="3.5" rx="1" stroke={c} strokeWidth="1.3"/><line x1="8" y1="5" x2="8" y2="8" stroke={c} strokeWidth="1.2"/><line x1="3" y1="11" x2="8" y2="8" stroke={c} strokeWidth="1"/><line x1="13" y1="11" x2="8" y2="8" stroke={c} strokeWidth="1"/>{isActive && <circle cx="8" cy="8" r="1.5" fill="#06B6D4"><animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite"/></circle>}</svg>,
      approvals: <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none">{/* Secure Approval Shield */}<path d="M8 1L14 4V8.5C14 11.5 11.5 14 8 15C4.5 14 2 11.5 2 8.5V4L8 1Z" stroke={c} strokeWidth="1.3" fill={isActive?"#4CAF5011":"none"}/><path d="M5.5 8L7.2 10L10.5 5.5" stroke={isActive?"#4CAF50":c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>{isActive && <path d="M8 1L14 4V8.5C14 11.5 11.5 14 8 15C4.5 14 2 11.5 2 8.5V4L8 1Z" stroke="#4CAF50" strokeWidth="0.4" fill="none"><animate attributeName="opacity" values="0.5;0;0.5" dur="2.5s" repeatCount="indefinite"/></path>}</svg>,
      sla: <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none">{/* SLA Timer Gauge */}<circle cx="8" cy="8.5" r="6" stroke={c} strokeWidth="1.3"/><circle cx="8" cy="8.5" r="6" stroke={isActive?"#FFB347":"none"} strokeWidth="2" strokeDasharray="9.42 28.27" strokeLinecap="round" transform="rotate(-90 8 8.5)" fill="none">{isActive && <animate attributeName="strokeDashoffset" values="0;-37.7;0" dur="6s" repeatCount="indefinite"/>}</circle><line x1="8" y1="8.5" x2="8" y2="4.5" stroke={isActive?"#FFB347":c} strokeWidth="1.5" strokeLinecap="round"/><circle cx="8" cy="8.5" r="1" fill={isActive?"#FFB347":c}/><line x1="8" y1="1.5" x2="8" y2="2.5" stroke={c} strokeWidth="1.2"/></svg>,
      ai: <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none">{/* Neural AI Brain */}<circle cx="8" cy="8" r="6.5" stroke={isActive?"#6366F1":c} strokeWidth="1.3" fill={ac+"08"}/><path d="M5 6C5 6 6.5 5 8 5C9.5 5 11 6 11 6" stroke={isActive?"#06B6D4":c} strokeWidth="1" strokeLinecap="round"/><path d="M5 10C5 10 6.5 11 8 11C9.5 11 11 10 11 10" stroke={isActive?"#EC4899":c} strokeWidth="1" strokeLinecap="round"/><line x1="5" y1="8" x2="11" y2="8" stroke={c} strokeWidth="0.6"/><circle cx="5.5" cy="8" r="1" fill={isActive?"#06B6D4":c}><animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite"/></circle><circle cx="8" cy="8" r="1" fill={isActive?"#6366F1":c}><animate attributeName="opacity" values="0.5;1;0.5" dur="1.5s" repeatCount="indefinite"/></circle><circle cx="10.5" cy="8" r="1" fill={isActive?"#EC4899":c}><animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite"/></circle>{isActive && <circle cx="8" cy="8" r="6.5" stroke="#6366F1" strokeWidth="0.4"><animate attributeName="r" values="6.5;7.5;6.5" dur="3s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.4;0;0.4" dur="3s" repeatCount="indefinite"/></circle>}</svg>,
      admin: <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none">{/* Security Gear */}<circle cx="8" cy="8" r="2.5" stroke={c} strokeWidth="1.3"/><path d="M8 0.5V2.5M8 13.5V15.5M0.5 8H2.5M13.5 8H15.5M2.3 2.3L3.8 3.8M12.2 12.2L13.7 13.7M13.7 2.3L12.2 3.8M3.8 12.2L2.3 13.7" stroke={isActive?"#6366F1":c} strokeWidth="1" strokeLinecap="round"/>{isActive && <><circle cx="8" cy="8" r="1" fill="#6366F1"/><animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="20s" repeatCount="indefinite"/></>}</svg>,
      reports: <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none">{/* Analytics Dashboard */}<rect x="1" y="1" width="14" height="14" rx="2" stroke={c} strokeWidth="1.3"/><path d="M1 5H15" stroke={c} strokeWidth="0.6"/><rect x="3" y="7" width="2" height="6" rx="0.5" fill={isActive?"#64B5F6":c+"44"} stroke="none">{isActive && <animate attributeName="height" values="2;6;2" dur="2s" repeatCount="indefinite"/>}</rect><rect x="7" y="8" width="2" height="5" rx="0.5" fill={isActive?"#81C784":c+"33"} stroke="none">{isActive && <animate attributeName="height" values="1;5;1" dur="2.5s" repeatCount="indefinite"/>}</rect><rect x="11" y="6.5" width="2" height="6.5" rx="0.5" fill={isActive?"#EC4899":c+"33"} stroke="none">{isActive && <animate attributeName="height" values="3;6.5;3" dur="3s" repeatCount="indefinite"/>}</rect></svg>,
      cybernews: <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none">{/* Threat Intelligence Shield */}<path d="M8 1L14 3.5V7.5C14 11 11.5 13.5 8 15C4.5 13.5 2 11 2 7.5V3.5L8 1Z" stroke={isActive?"#FF6B6B":c} strokeWidth="1.3" fill={isActive?"#FF6B6B08":"none"}/><path d="M6 7.5L7.5 9L10.5 6" stroke={isActive?"#FF6B6B":c} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="13" cy="2" r="2" fill={isActive?"#FF4444":"#FF6B6B"} stroke="none"><animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite"/></circle></svg>,
      productivity: <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none">{/* Productivity Rocket */}<path d="M8 1L10 4H6L8 1Z" stroke={isActive?"#0078D4":c} strokeWidth="1.2" fill={isActive?"#0078D422":"none"}/><rect x="6" y="4" width="4" height="7" rx="1" stroke={isActive?"#0078D4":c} strokeWidth="1.2" fill={isActive?"#0078D411":"none"}/><path d="M4.5 7L6 6V9L4.5 8Z" stroke={isActive?"#00BCF2":c} strokeWidth="0.8" fill={isActive?"#00BCF222":"none"}/><path d="M11.5 7L10 6V9L11.5 8Z" stroke={isActive?"#00BCF2":c} strokeWidth="0.8" fill={isActive?"#00BCF222":"none"}/><path d="M6.5 11L7 14H9L9.5 11" stroke={isActive?"#FF8C00":c} strokeWidth="0.8" strokeLinecap="round"/>{isActive && <><circle cx="8" cy="7" r="0.8" fill="#0078D4"><animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite"/></circle><path d="M7 14L8 15.5L9 14" stroke="#FF8C00" strokeWidth="0.6" strokeLinecap="round"><animate attributeName="opacity" values="1;0.2;1" dur="1s" repeatCount="indefinite"/></path></>}</svg>,
      zendesk: <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none">{/* Zendesk */}<path d="M8 2L14 8L8 14L2 8L8 2Z" stroke={isActive?"#FFB347":c} strokeWidth="1.3" fill={isActive?"#FFB34711":"none"}/><circle cx="8" cy="8" r="2.5" stroke={isActive?"#FFB347":c} strokeWidth="1" fill={isActive?"#FFB34722":"none"}/>{isActive && <circle cx="8" cy="8" r="1" fill="#FFB347"><animate attributeName="r" values="0.8;1.5;0.8" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite"/></circle>}</svg>,
      customers: <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none">{/* Customer Building */}<rect x="2" y="4" width="12" height="11" rx="1.5" stroke={c} strokeWidth="1.3" fill={isActive?"#EC489911":"none"}/><rect x="5" y="1" width="6" height="5" rx="1" stroke={isActive?"#EC4899":c} strokeWidth="1" fill={isActive?"#EC489908":"none"}/><circle cx="8" cy="3" r="1" fill={isActive?"#EC4899":c}/><rect x="4.5" y="7" width="2.5" height="2" rx="0.5" stroke={isActive?"#64B5F6":c} strokeWidth="0.8"/><rect x="9" y="7" width="2.5" height="2" rx="0.5" stroke={isActive?"#64B5F6":c} strokeWidth="0.8"/><rect x="6" y="11" width="4" height="4" rx="0.5" stroke={isActive?"#FFB347":c} strokeWidth="0.8" fill={isActive?"#FFB34711":"none"}/>{isActive && <circle cx="8" cy="3" r="1" fill="#EC4899"><animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite"/></circle>}</svg>,
    };
    return <span style={{ width: 20, textAlign: "center", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{icons[type] || <span style={{ fontSize: 15 }}>•</span>}</span>;
  };

  const NAV = [
    { id: "dashboard", label: "Dashboard", count: 0, accent: "#6366F1", gradient: "linear-gradient(135deg, #6366F108, #6366F118)" },
    { section: "CORE" },
    { id: "tickets", label: "Tickets", count: incidents.filter(i => i.status !== "Resolved" && i.status !== "Closed").length + (zdStats?.open || 0) + (zdStats?.pending || 0) + problems.filter(p => !["Resolved","Closed"].includes(p.status)).length + changes.filter(c => ["New","Awaiting Approval","Approved"].includes(c.status)).length + requests.filter(r => ["Open","In Progress"].includes(r.status)).length, critical: incidents.some(i => i.priority === "Sev-A" && i.status !== "Resolved" && i.status !== "Closed") || zdAiQueue.filter(q => q.status === "pending_approval").length > 0, accent: "#FF6B6B", gradient: "linear-gradient(135deg, #FF6B6B08, #FF6B6B18)" },
    { id: "catalog", label: "Service Catalog", accent: "#64B5F6", gradient: "linear-gradient(135deg, #64B5F608, #64B5F618)" },
    { id: "knowledge", label: "Knowledge Portal", accent: "#0078D4", gradient: "linear-gradient(135deg, #0078D408, #0089D618)" },
    { id: "assets", label: "Assets / CMDB", accent: "#06B6D4", gradient: "linear-gradient(135deg, #06B6D408, #06B6D418)" },
    { section: "MONITORING" },
    { id: "humanReview", label: "Engineer Review", count: aiActions.filter(a => a.status === "pending_approval").length + zdAiQueue.filter(q => q.status === "pending_approval").length + changes.filter(c => c.status === "Awaiting Approval").length + requests.filter(r => r.status === "Pending Approval").length, critical: aiActions.filter(a => a.status === "pending_approval" && (a.severity === "critical" || a.severity === "high")).length > 0 || zdAiQueue.filter(q => q.status === "pending_approval").length > 0, accent: "#EC4899", gradient: "linear-gradient(135deg, #EC489908, #6366F118)" },
    { id: "slaApprovals", label: "SLA & Approvals", count: changes.filter(c => c.status === "Awaiting Approval").length + requests.filter(r => r.status === "Pending Approval").length, accent: "#FFB347", gradient: "linear-gradient(135deg, #FFB34708, #FFB34718)" },
    { id: "analytics", label: "Analytics", count: serviceReports.filter(r => r.status === "Draft").length, accent: "#64B5F6", gradient: "linear-gradient(135deg, #64B5F608, #64B5F618)" },
    { id: "serviceStatus", label: "Service Status", accent: "#4CAF50", gradient: "linear-gradient(135deg, #4CAF5008, #4CAF5018)" },
    { id: "customers", label: "Customers", count: customers.filter(c => c.status === "Active").length, accent: "#EC4899", gradient: "linear-gradient(135deg, #EC489908, #EC489918)" },
    { id: "vendorPortal", label: "Vendor Portal", count: vendors.length, accent: "#8B5CF6", gradient: "linear-gradient(135deg, #8B5CF608, #8B5CF618)" },
    { section: "AI & SYSTEM" },
    { id: "ai", label: "AI Assist", accent: "#EC4899", gradient: "linear-gradient(135deg, #EC489908, #6366F118)" },
    { id: "admin", label: "Admin Settings", accent: "#6366F1", gradient: "linear-gradient(135deg, #6366F108, #6366F118)" },
    { id: "productivity", label: "Productivity", count: smartTasks.filter(t => t.status === "pending").length, accent: "#0078D4", gradient: "linear-gradient(135deg, #0078D408, #00BCF218)" },
  ];

  // ─── Dashboard (extracted to src/modules/DashboardModule.jsx) ──

  // ─── Incidents Module ─────────────────────────────────────────────────
  // ─── Incidents Module (extracted) ──

  // ─── Problems Module ──────────────────────────────────────────────────
  const ProblemsModule = useStableComponent(() => (
    <div>
      <WorkflowHeader module="problems" version={APP_VERSION.version} stepCounts={[problems.filter(p => p.status === "Open").length, problems.filter(p => p.status === "Investigating").length, problems.filter(p => p.status === "Known Error").length, problems.filter(p => p.status === "In Progress").length, problems.filter(p => p.status === "Resolved" || p.status === "Closed").length]} />
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <SearchBar value={search} onChange={setSearch} placeholder="Search problems..." />
        <button style={btnStyle()} onClick={() => setModal("newProblem")}>+ New Problem</button>
        <button style={{ ...btnStyle("#0EA5E9"), fontSize: 11, display: "flex", alignItems: "center", gap: 4 }} onClick={() => window.open("/api/export/problems?format=csv", "_blank")}>📥 Export CSV</button>
      </div>
      <DataTable
        columns={[
          { label: "ID", key: "id", mono: true, minWidth: 90, render: r => <span style={{ color: "#CE93D8" }}>{r.id}</span> },
          { label: "Title", key: "title", maxWidth: 280, wrap: true },
          { label: "Priority", render: r => <PriorityDot priority={r.priority} /> },
          { label: "Impact", render: r => <Badge color={r.impact === "Enterprise" ? PRIORITY_COLORS["Sev-A"] : r.impact === "Department" ? PRIORITY_COLORS["Sev-B"] : PRIORITY_COLORS["Sev-D"]}>{r.impact || "—"}</Badge> },
          { label: "Status", render: r => <Badge color={STATUS_COLORS[r.status]}>{r.status}</Badge> },
          { label: "Category", render: r => <span style={{ color: "#A0AEC0", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{r.category || "—"}</span> },
          { label: "Linked Incidents", render: r => <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#64B5F6" }}>{r.linkedIncidents?.length || 0}</span> },
          { label: "Root Cause", maxWidth: 200, wrap: true, render: r => <span style={{ color: "#5A6178", fontSize: 12 }}>{r.rootCause?.substring(0, 60) || "—"}{r.rootCause?.length > 60 ? "..." : ""}</span> },
          { label: "Assignee", key: "assignee" },
          { label: "Group", render: r => <span style={{ color: "#A0AEC0", fontSize: 11 }}>{r.assignmentGroup || "—"}</span> },
          { label: "Age", render: r => <span style={{ color: "#5A6178" }}>{timeAgo(r.created)}</span> },
        ]}
        data={problems.filter(p => (p.title || "").toLowerCase().includes(search.toLowerCase()) || (p.id || "").toLowerCase().includes(search.toLowerCase()))}
        onRowClick={row => { setDetailItem(row); setModal("problemDetail"); }}
      />
    </div>
  ));

  // ─── Changes Module ───────────────────────────────────────────────────
  const ChangesModule = useStableComponent(() => (
    <div>
      <WorkflowHeader module="changes" version={APP_VERSION.version} stepCounts={[changes.filter(c => c.status === "New").length, changes.filter(c => c.status === "Awaiting Approval").length, changes.filter(c => c.status === "Approved").length, changes.filter(c => ["In Progress","Implementing"].includes(c.status)).length, changes.filter(c => c.status === "Completed" || c.status === "Closed").length]} />
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <SearchBar value={search} onChange={setSearch} placeholder="Search changes..." />
        <button style={btnStyle()} onClick={() => setModal("newChange")}>+ New Change Request</button>
        <button style={{ ...btnStyle("#0EA5E9"), fontSize: 11, display: "flex", alignItems: "center", gap: 4 }} onClick={() => window.open("/api/export/changes?format=csv", "_blank")}>📥 Export CSV</button>
      </div>
      <DataTable
        columns={[
          { label: "ID", key: "id", mono: true, minWidth: 90, render: r => <span style={{ color: "#FFB347" }}>{r.id}</span> },
          { label: "Title", key: "title", maxWidth: 280, wrap: true },
          { label: "Type", render: r => <Badge color={r.type === "Emergency" ? PRIORITY_COLORS["Sev-A"] : r.type === "Normal" ? { bg: "#0D2137", text: "#64B5F6" } : { bg: "#0A2D1A", text: "#81C784" }}>{r.type}</Badge> },
          { label: "Status", render: r => <Badge color={STATUS_COLORS[r.status]}>{r.status}</Badge> },
          { label: "Risk", render: r => <Badge color={PRIORITY_COLORS[r.risk === "High" ? "Sev-A" : r.risk === "Medium" ? "Sev-B" : "Sev-D"]}>{r.risk}</Badge> },
          { label: "Impact", render: r => <Badge color={r.impact === "Enterprise" ? PRIORITY_COLORS["Sev-A"] : r.impact === "Department" ? PRIORITY_COLORS["Sev-B"] : PRIORITY_COLORS["Sev-D"]}>{r.impact || "—"}</Badge> },
          { label: "Category", render: r => <span style={{ color: "#A0AEC0", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{r.category || "—"}</span> },
          { label: "Scheduled", render: r => <span style={{ fontSize: 11, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{r.scheduledStart}</span> },
          { label: "Assignee", key: "assignee" },
        ]}
        data={changes.filter(c => (c.title || "").toLowerCase().includes(search.toLowerCase()) || (c.id || "").toLowerCase().includes(search.toLowerCase()))}
        onRowClick={row => { setDetailItem(row); setModal("changeDetail"); }}
      />
    </div>
  ));

  // ─── Change Calendar (extracted) ──

  // ─── Service Requests Module ──────────────────────────────────────────
  const RequestsModule = useStableComponent(() => (
    <div>
      <WorkflowHeader module="requests" version={APP_VERSION.version} stepCounts={[requests.filter(r => r.status === "Open").length, requests.filter(r => r.status === "Pending Approval").length, requests.filter(r => r.status === "In Progress").length, requests.filter(r => r.status === "Fulfilled").length, requests.filter(r => r.status === "Closed").length]} />
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <SearchBar value={search} onChange={setSearch} placeholder="Search requests..." />
        <button style={btnStyle()} onClick={() => setActiveModule("catalog")}>Browse Catalog →</button>
        <button style={{ ...btnStyle("#0EA5E9"), fontSize: 11, display: "flex", alignItems: "center", gap: 4 }} onClick={() => window.open("/api/export/requests?format=csv", "_blank")}>📥 Export CSV</button>
      </div>
      <DataTable
        columns={[
          { label: "ID", key: "id", mono: true, minWidth: 80, render: r => <span style={{ color: "#81C784" }}>{r.id}</span> },
          { label: "Service", key: "service", maxWidth: 200, wrap: true },
          { label: "Status", render: r => <Badge color={STATUS_COLORS[r.status]}>{r.status}</Badge> },
          { label: "Priority", render: r => <PriorityDot priority={r.priority} /> },
          { label: "Category", render: r => <span style={{ color: "#A0AEC0", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{r.category || "—"}</span> },
          { label: "Requester", key: "requester", maxWidth: 150 },
          { label: "Email", render: r => <span style={{ color: "#64B5F6", fontSize: 11 }}>{r.requesterEmail || "—"}</span> },
          { label: "Assignee", render: r => r.assignee || <span style={{ color: "#5A617888" }}>Unassigned</span> },
          { label: "Group", render: r => <span style={{ color: "#A0AEC0", fontSize: 11 }}>{r.assignmentGroup || "—"}</span> },
          { label: "Created", render: r => <span style={{ color: "#5A6178" }}>{timeAgo(r.created)}</span> },
        ]}
        data={requests.filter(r => (r.service || "").toLowerCase().includes(search.toLowerCase()) || (r.id || "").toLowerCase().includes(search.toLowerCase()))}
        onRowClick={row => { setDetailItem(row); setModal("requestDetail"); }}
      />
    </div>
  ));

  // ─── Operations Module (Combined Problems + Changes + Requests) ────
  const [opsTab, setOpsTab] = useState("problems");
  const OperationsModule = useStableComponent(() => {
    const opsTabStyle = (id) => ({
      padding: "10px 20px", background: opsTab === id ? "#12141E" : "transparent",
      border: "none", borderBottom: opsTab === id ? "2px solid #6366F1" : "2px solid transparent",
      color: opsTab === id ? "#E8ECF4" : "#5A6178", cursor: "pointer", fontSize: 12,
      fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6
    });
    return (
      <div>
        {/* Stats Row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
          {[
            { label: "Open Problems", value: problems.filter(p => !["Resolved","Closed"].includes(p.status)).length, accent: "#CE93D8", icon: "🔍" },
            { label: "Known Errors", value: problems.filter(p => p.status === "Known Error").length, accent: "#FF6B6B", icon: "⚠️" },
            { label: "Pending Changes", value: changes.filter(c => ["New","Awaiting Approval","Approved"].includes(c.status)).length, accent: "#FFB347", icon: "🔄" },
            { label: "Emergency Changes", value: changes.filter(c => c.type === "Emergency").length, accent: "#FF4444", icon: "🚨" },
            { label: "Active Requests", value: requests.filter(r => ["Open","In Progress"].includes(r.status)).length, accent: "#81C784", icon: "📋" },
            { label: "Pending Approval", value: requests.filter(r => r.status === "Pending Approval").length, accent: "#6366F1", icon: "⏳" },
          ].map((s, i) => (
            <div key={i} style={{ padding: "12px 16px", background: "#0F1117", borderRadius: 8, border: `1px solid ${s.accent}33`, cursor: "pointer" }}
              onClick={() => { if (i < 2) setOpsTab("problems"); else if (i < 4) setOpsTab("changes"); else setOpsTab("requests"); }}>
              <div style={{ fontSize: 10, color: "#5A6178", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.accent }}>{s.value}</div>
            </div>
          ))}
        </div>
        {/* Cross-Reference: Incidents ↔ Operations */}
        <div style={{ display: "flex", gap: 10, marginBottom: 14, padding: "6px 14px", background: "#0A0C14", borderRadius: 6, border: "1px solid #1E213033", alignItems: "center", fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", flexWrap: "wrap" }}>
          <span>📊 ITSM: {incidents.length} incidents</span><span style={{ color: "#1E2130" }}>|</span>
          <span style={{ color: "#EC4899" }}>🎫 Zendesk linked: {incidents.filter(i => i.zdTicketId).length}</span><span style={{ color: "#1E2130" }}>|</span>
          <span style={{ color: "#CE93D8" }}>🔍 Problems: {problems.length}</span><span style={{ color: "#1E2130" }}>|</span>
          <span style={{ color: "#FFB347" }}>🔄 Changes: {changes.length}</span><span style={{ color: "#1E2130" }}>|</span>
          <span style={{ color: "#81C784" }}>📋 Requests: {requests.length}</span>
          {incidents.filter(i => i.linkedProblem).length > 0 && <><span style={{ color: "#1E2130" }}>|</span><span style={{ color: "#64B5F6" }}>🔗 Linked to problems: {incidents.filter(i => i.linkedProblem).length}</span></>}
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
            {globalSyncActive && <span style={{ color: "#06B6D4", animation: "pulse 1s infinite" }}>⟳</span>}
            <span style={{ color: "#5A617855" }}>Auto-sync 60s{globalLastSync ? ` · ${globalLastSync.toLocaleTimeString("en-SG", { hour12: false })}` : ""}</span>
          </span>
        </div>
        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #1E2130", marginBottom: 16 }}>
          <button onClick={() => setOpsTab("problems")} style={opsTabStyle("problems")}>
            🔍 Problems <span style={{ background: "#CE93D822", color: "#CE93D8", padding: "1px 6px", borderRadius: 8, fontSize: 9 }}>{problems.length}</span>
          </button>
          <button onClick={() => setOpsTab("changes")} style={opsTabStyle("changes")}>
            🔄 Changes <span style={{ background: "#FFB34722", color: "#FFB347", padding: "1px 6px", borderRadius: 8, fontSize: 9 }}>{changes.length}</span>
          </button>
          <button onClick={() => setOpsTab("requests")} style={opsTabStyle("requests")}>
            📋 Service Requests <span style={{ background: "#81C78422", color: "#81C784", padding: "1px 6px", borderRadius: 8, fontSize: 9 }}>{requests.length}</span>
          </button>
          <button onClick={() => setOpsTab("calendar")} style={opsTabStyle("calendar")}>
            📅 Calendar {calendarData?.stats?.conflictCount > 0 && <span style={{ background: "#FF444422", color: "#FF4444", padding: "1px 6px", borderRadius: 8, fontSize: 9 }}>⚠ {calendarData.stats.conflictCount}</span>}
          </button>
        </div>
        {/* Tab Content */}
        {opsTab === "problems" && <ProblemsModule />}
        {opsTab === "changes" && <ChangesModule />}
        {opsTab === "requests" && <RequestsModule />}
        {opsTab === "calendar" && <ChangeCalendarModule ctx={{ changes, setDetailItem, setModal, calendarView, setCalendarView, calendarMonth, setCalendarMonth, calendarYear, setCalendarYear, showCalendarForm, setShowCalendarForm, calendarData, fetchCalendarData, calendarSelectedDay, setCalendarSelectedDay }} />}
      </div>
    );
  });

  // ─── Service Catalog ──────────────────────────────────────────────────
  const [catalogCategoryFilter, setCatalogCategoryFilter] = useState("All");
  const [catalogExplainId, setCatalogExplainId] = useState(null);
  const CatalogModule = useStableComponent(() => {
    const isAdmin = currentUser.rbacRole === "VGC Dev Admin" || currentUser.rbacRole === "Administrator" || currentUser.rbacRole === "Tenant Admin" || currentUser.rbacRole === "Asset Manager";
    const catalogCategories = ["All", ...new Set(serviceCatalog.map(s => s.category))];
    // Phase S1d — defer search so heavy filter doesn't block typing
    // eslint-disable-next-line react-hooks/rules-of-hooks -- hooks inside useStableComponent render callback are valid
    const deferredSearch = React.useDeferredValue(search);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const filteredCatalog = useMemo(() => {
      const q = (deferredSearch || "").toLowerCase();
      return serviceCatalog.filter(s => {
        const matchSearch = !q || (s.name || "").toLowerCase().includes(q) || (s.category || "").toLowerCase().includes(q) || (s.description || "").toLowerCase().includes(q);
        const matchCat = catalogCategoryFilter === "All" || s.category === catalogCategoryFilter;
        return matchSearch && matchCat;
      });
    }, [serviceCatalog, deferredSearch, catalogCategoryFilter]);
    return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}><SearchBar value={search} onChange={setSearch} placeholder="Search services..." /></div>
        {isAdmin && <button style={btnStyle()} onClick={() => { setDetailItem(null); setModal("catalogManage"); }}>+ Add Service</button>}
        <span style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{filteredCatalog.length} of {serviceCatalog.length} services</span>
      </div>
      {/* Category Quick Filters */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {catalogCategories.map(cat => {
          const count = cat === "All" ? serviceCatalog.length : serviceCatalog.filter(s => s.category === cat).length;
          const isActive = catalogCategoryFilter === cat;
          return (
            <button key={cat} onClick={() => setCatalogCategoryFilter(cat)} style={{
              padding: "5px 12px", borderRadius: 20, fontSize: 11, cursor: "pointer", transition: "all 0.2s",
              background: isActive ? "#6366F122" : "#0A0C14",
              border: `1px solid ${isActive ? "#6366F166" : "#1E2130"}`,
              color: isActive ? "#6366F1" : "#5A6178",
              fontFamily: "'Space Grotesk', sans-serif"
            }}>
              {cat === "All" ? "📁" : cat === "Access" ? "🔑" : cat === "Hardware" ? "💻" : cat === "Software" ? "📦" : cat === "Network" ? "🌐" : cat === "Email" ? "📧" : cat === "Cloud" ? "☁️" : cat === "Security" ? "🛡️" : cat === "Database" ? "🗄️" : cat === "Analytics" ? "📈" : cat === "Facilities" ? "🎥" : "📋"} {cat} ({count})
            </button>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
        {filteredCatalog.map(svc => (
          <div key={svc.id} style={{
            background: "#0F1117", borderRadius: 10, border: "1px solid #1E2130",
            padding: 0, cursor: "pointer", transition: "border-color 0.2s, transform 0.15s, box-shadow 0.2s", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column"
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#3B82F644"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 4px 20px #3B82F611"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#1E2130"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
          >
            <div style={{ padding: "16px 18px 12px" }} onClick={() => { setDetailItem(svc); setModal("catalogRequest"); }}>
              {isAdmin && (
                <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 4 }}>
                  <button onClick={e => { e.stopPropagation(); setDetailItem(svc); setModal("catalogManage"); }} style={{ background: "#1E2130", border: "none", borderRadius: 4, padding: "2px 6px", cursor: "pointer", fontSize: 10, color: "#64B5F6" }} title="Edit">✏️</button>
                  <button onClick={e => { e.stopPropagation(); softDelete("service_catalog", svc, setServiceCatalog, "vgc_services"); }} style={{ background: "#1E2130", border: "none", borderRadius: 4, padding: "2px 6px", cursor: "pointer", fontSize: 10, color: "#FF6B6B" }} title="Delete">🗑️</button>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 26 }}>{svc.icon}</div>
                <div>
                  <div style={{ color: "#E8ECF4", fontSize: 13, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", lineHeight: 1.2 }}>{svc.name}</div>
                  <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>{svc.category} · SLA: {svc.sla}h</div>
                </div>
              </div>
              {svc.description && <div style={{ fontSize: 11, color: "#A0AEC0", lineHeight: 1.5, marginBottom: 8 }}>{svc.description}</div>}
            </div>
            {/* Footer with AI Explainer */}
            <div style={{ padding: "8px 18px 12px", marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1E213044" }}>
              <button onClick={e => { e.stopPropagation(); setCatalogExplainId(catalogExplainId === svc.id ? null : svc.id); }} style={{
                background: catalogExplainId === svc.id ? "#6366F122" : "transparent", border: `1px solid ${catalogExplainId === svc.id ? "#6366F166" : "#1E2130"}`,
                borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontSize: 10, color: catalogExplainId === svc.id ? "#6366F1" : "#5A6178",
                display: "flex", alignItems: "center", gap: 4, transition: "all 0.2s", fontFamily: "'Space Grotesk', sans-serif"
              }}>🤖 AI Explain</button>
              <span onClick={() => { setDetailItem(svc); setModal("catalogRequest"); }} style={{ fontSize: 11, color: "#3B82F6", fontWeight: 600, cursor: "pointer" }}>Request →</span>
            </div>
            {/* AI Explain Overlay */}
            {catalogExplainId === svc.id && svc.aiExplain && (
              <div style={{ padding: "12px 18px", background: "linear-gradient(135deg, #6366F108, #6366F115)", borderTop: "1px solid #6366F133" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#6366F1", marginBottom: 6, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1, display: "flex", alignItems: "center", gap: 6 }}>🤖 How this service works</div>
                <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.6 }}>{svc.aiExplain}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
    );
  });

  // ─── Knowledge Base (extracted to src/modules/KnowledgeModule.jsx) ──

  // ─── Assets / CMDB ────────────────────────────────────────────────────
  const AssetsModule = useStableComponent(() => (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <SearchBar value={search} onChange={setSearch} placeholder="Search assets..." />
        <button style={btnStyle()} onClick={() => setModal("newAsset")}>+ Add Asset</button>
        <button style={{ ...btnStyle("#0EA5E9"), fontSize: 11, display: "flex", alignItems: "center", gap: 4 }} onClick={() => window.open("/api/export/assets?format=csv", "_blank")}>📥 Export CSV</button>
      </div>
      <DataTable
        columns={[
          { label: "Asset ID", key: "id", mono: true, minWidth: 80, render: r => <span style={{ color: "#CE93D8" }}>{r.id}</span> },
          { label: "Name", key: "name", maxWidth: 200, wrap: true },
          { label: "Customer", maxWidth: 180, render: r => <span style={{ color: "#FFB347", fontSize: 12 }}>{r.customer || "—"}</span> },
          { label: "User / Assigned To", key: "assignee", maxWidth: 160 },
          { label: "Type", render: r => <Badge color={{ bg: "#1A1A2E", text: "#A0AEC0" }}>{r.type}</Badge> },
          { label: "Status", render: r => <Badge color={STATUS_COLORS[r.status] || STATUS_COLORS.Active}>{r.status}</Badge> },
          { label: "Serial No.", render: r => <span style={{ color: "#A0AEC0", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{r.serialNumber || "—"}</span> },
          { label: "Manufacturer", render: r => <span style={{ color: "#C4CAD6", fontSize: 12 }}>{r.manufacturer || "—"}</span> },
          { label: "Department", render: r => <span style={{ color: "#A0AEC0", fontSize: 12 }}>{r.department || "—"}</span> },
          { label: "IP Address", render: r => <span style={{ color: "#64B5F6", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{r.ipAddress || "—"}</span> },
          { label: "Location", key: "location", mono: true },
          { label: "Warranty", render: r => {
            if (r.warranty === "N/A") return <span style={{ color: "#5A6178" }}>N/A</span>;
            const exp = new Date(r.warranty) < new Date();
            return <span style={{ color: exp ? "#FF6B6B" : "#81C784", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{r.warranty}</span>;
          }},
        ]}
        data={assets.filter(a => (a.name || "").toLowerCase().includes(search.toLowerCase()) || (a.id || "").toLowerCase().includes(search.toLowerCase()) || (a.type || "").toLowerCase().includes(search.toLowerCase()))}
        onRowClick={row => { setDetailItem(row); setModal("assetDetail"); }}
      />
    </div>
  ));

  // ─── Approvals ────────────────────────────────────────────────────────
  const ApprovalsModule = useStableComponent(() => {
    const pendingChanges = changes.filter(c => c.status === "Awaiting Approval");
    const pendingRequests = requests.filter(r => r.status === "Pending Approval");
    return (
      <div>
        <h3 style={{ margin: "0 0 16px", fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>Change Approvals</h3>
        {pendingChanges.map(ch => (
          <div key={ch.id} style={{
            background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130",
            padding: 20, marginBottom: 12
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <div>
                <span style={{ color: "#FFB347", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{ch.id}</span>
                <div style={{ color: "#E8ECF4", fontSize: 14, fontWeight: 600, marginTop: 2, fontFamily: "'Space Grotesk', sans-serif" }}>{ch.title}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Badge color={PRIORITY_COLORS[ch.risk === "High" ? "Sev-A" : ch.risk === "Medium" ? "Sev-B" : "Sev-D"]}>{ch.risk} Risk</Badge>
                <Badge color={{ bg: "#0D2137", text: "#64B5F6" }}>{ch.type}</Badge>
              </div>
            </div>
            <div style={{ color: "#5A6178", fontSize: 13, marginBottom: 14 }}>{ch.description}</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              {(ch.approvers || []).map((a, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "4px 10px", borderRadius: 4, background: "#0A0C14",
                  border: "1px solid #1E213044", fontSize: 12
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: a.status === "Approved" ? "#4CAF50" : a.status === "Rejected" ? "#FF4444" : "#FFB347" }} />
                  <span style={{ color: "#C4CAD6" }}>{a.name}</span>
                  <span style={{ color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>({a.status})</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={btnStyle("#4CAF50")} onClick={() => {
                setChanges(prev => prev.map(c => c.id === ch.id ? { ...c, status: "Approved", approvers: (c.approvers || []).map(a => ({ ...a, status: "Approved" })) } : c));
              }}>✓ Approve</button>
              <button style={btnStyle("#FF4444")} onClick={() => {
                setChanges(prev => prev.map(c => c.id === ch.id ? { ...c, status: "Closed", approvers: (c.approvers || []).map(a => ({ ...a, status: "Rejected" })) } : c));
              }}>✕ Reject</button>
            </div>
          </div>
        ))}

        <h3 style={{ margin: "24px 0 16px", fontSize: 14, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>Service Request Approvals</h3>
        {pendingRequests.map(req => (
          <div key={req.id} style={{
            background: "#0F1117", borderRadius: 8, border: "1px solid #1E2130",
            padding: 20, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center"
          }}>
            <div>
              <span style={{ color: "#81C784", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{req.id}</span>
              <div style={{ color: "#E8ECF4", fontSize: 14, marginTop: 2 }}>{req.service}</div>
              <div style={{ color: "#5A6178", fontSize: 12, marginTop: 2 }}>Requested by {req.requester}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={btnStyle("#4CAF50")} onClick={() => {
                setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: "In Progress" } : r));
              }}>✓ Approve</button>
              <button style={btnStyle("#FF4444")} onClick={() => {
                setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: "Closed" } : r));
              }}>✕ Reject</button>
            </div>
          </div>
        ))}
        {pendingChanges.length === 0 && pendingRequests.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "#5A6178" }}>No pending approvals 🎉</div>
        )}
      </div>
    );
  });

  // ─── SLA Tracker (extracted) ──

  // ─── Modals (extracted to src/modules/ModalsModule.jsx) ──

  // ─── AI Ticket Link Click Handler ──────────────────────────────────────
  const handleTicketLinkClick = (ticketId) => {
    const prefix = ticketId.replace(/\d+/g, "");
    if (prefix === "INC") {
      const item = incidents.find(i => i.id === ticketId);
      if (item) { setDetailItem(item); setModal("incidentDetail"); }
      else setActiveModule("incidents");
    } else if (prefix === "CHG") {
      const item = changes.find(c => c.id === ticketId);
      if (item) { setDetailItem(item); setModal("changeDetail"); }
      else setActiveModule("changes");
    } else if (prefix === "PRB") {
      const item = problems.find(p => p.id === ticketId);
      if (item) { setDetailItem(item); setModal("problemDetail"); }
      else setActiveModule("problems");
    } else if (prefix === "REQ") {
      const item = requests.find(r => r.id === ticketId);
      if (item) { setDetailItem(item); setModal("requestDetail"); }
      else setActiveModule("requests");
    } else if (prefix === "KB") {
      const item = kbArticles.find(k => k.id === ticketId);
      if (item) { setDetailItem(item); setModal("kbDetail"); }
      else setActiveModule("knowledge");
    } else if (prefix === "SVC") {
      setActiveModule("catalog");
    }
  };

  // ─── AI Chat Handler (Parent Scope — used by AIAssistModule + Sidebar) ──
  // ─── AI Typing Animation (human-like 2s delay) ────────────────────
  const typeAiMessage = (text, suggestions, source, prompt) => {
    const words = text.split(/(\s+)/);
    const totalWords = words.filter(w => w.trim()).length;
    const delay = Math.max(30, Math.min(80, 2000 / totalWords)); // spread over ~2 seconds
    let displayed = "";
    let idx = 0;
    const placeholderMsg = { role: "ai", text: "", source, suggestions, prompt, _typing: true };
    setAiMessages(prev => [...prev, placeholderMsg]);
    const msgIdx = -1; // will use functional update
    const typeNext = () => {
      if (idx < words.length) {
        displayed += words[idx];
        idx++;
        setAiMessages(prev => {
          const updated = [...prev];
          const last = updated.length - 1;
          if (updated[last]?._typing) {
            updated[last] = { ...updated[last], text: displayed };
          }
          return updated;
        });
        setTimeout(typeNext, delay);
      } else {
        // Finished typing — remove _typing flag
        setAiMessages(prev => {
          const updated = [...prev];
          const last = updated.length - 1;
          if (updated[last]?._typing) {
            updated[last] = { role: "ai", text, source, suggestions, prompt };
          }
          return updated;
        });
        setAiLoading(false);
      }
    };
    setTimeout(typeNext, 400); // brief pause before typing starts
  };

  // ─── AI Chat File Attachment Handler ──────────────────────────────────
  const handleAiFileAttach = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const BLOCKED = new Set(["exe","bat","cmd","com","msi","scr","pif","vbs","vbe","jse","ws","wsf","wsc","wsh","ps1","ps2","psc1","psc2","msh","msh1","msh2","inf","reg","rgs","sct","shb","shs","lnk","dll","sys","drv","ocx","cpl","hta","jar","class","php","asp","aspx","jsp","cgi","pl","py","rb","sh","bash","zsh","ksh","csh","app","action","command","workflow","iso","img","dmg","vhd","vmdk","ova","ovf"]);
    const blocked = files.filter(f => BLOCKED.has(f.name.split(".").pop().toLowerCase()));
    if (blocked.length > 0) {
      showToast(`Blocked: ${blocked.map(f => f.name).join(", ")} — dangerous file types not allowed`, "error");
      return;
    }
    if (files.some(f => f.size > 10 * 1024 * 1024)) {
      showToast("File too large — max 10MB per file", "error");
      return;
    }
    setAiUploadingFiles(true);
    try {
      const formData = new FormData();
      files.forEach(f => formData.append("files", f));
      const res = await fetch("/api/ai/chat/upload", { method: "POST", body: formData });
      if (!res.ok) { const err = await res.json(); showToast(err.error || "Upload failed", "error"); setAiUploadingFiles(false); return; }
      const data = await res.json();
      const uploaded = (data.files || []).filter(f => !f.blocked);
      const blockedServer = (data.files || []).filter(f => f.blocked);
      if (blockedServer.length > 0) showToast(`Blocked by server: ${blockedServer.map(f => f.fileName).join(", ")}`, "error");
      if (uploaded.length > 0) {
        setAiAttachments(prev => [...prev, ...uploaded]);
        showToast(`📎 ${uploaded.length} file(s) attached: ${uploaded.map(f => f.fileName).join(", ")}`, "success");
      }
    } catch (err) { showToast("File upload failed: " + err.message, "error"); }
    setAiUploadingFiles(false);
  };

  const handleAiChat = (overrideMsg) => {
    const userMsg = overrideMsg || aiInput.trim();
    if (!userMsg && aiAttachments.length === 0) return;
    const attachmentNames = aiAttachments.map(a => `📎 ${a.fileName}`).join(", ");
    const displayText = userMsg + (attachmentNames ? `\n${attachmentNames}` : "");
    setAiMessages(prev => [...prev, { role: "user", text: displayText, attachments: aiAttachments.length > 0 ? [...aiAttachments] : undefined }]);
    if (!overrideMsg) setAiInput("");
    const currentAttachments = [...aiAttachments];
    setAiAttachments([]);
    setAiLoading(true);
    (async () => {
      const systemPrompt = [
        `You are VGC AI — the intelligent assistant for VGC Technology Pte Ltd, Singapore. You work alongside ${currentUser.name} (${currentUser.rbacRole || "ITSM User"}) as a helpful, friendly colleague — not a bot. Always answer directly in your FIRST sentence — no preamble, no "let me check", no clarifying questions. Jump straight to the solution.`,
        `CURRENT DATA MODE: PRODUCTION. You are in PRODUCTION MODE — all data comes from live Zendesk and ITSM APIs. NEVER show demo/hardcoded data. If any response contains placeholder ticket IDs (like INC0001 or #48201-48208 from seed data), flag it immediately and refresh from live sources.`,
        `DATA ISOLATION GUARD (HARD RULE): If you detect a human mistake that could mix demo data into production or vice versa — IMMEDIATELY alert the user with a clear warning. Examples: trying to use demo ticket IDs in production, attempting to connect Zendesk in demo mode, referencing hardcoded data in production mode. Say: "⚠️ Data Isolation Alert: [explain the issue]. This could compromise data integrity."`,
        `TONE & STYLE: Be warm, conversational, and human. Write like a brilliant senior engineer who always has the answer. NEVER ask the user clarifying questions — ALWAYS give a direct, confident answer immediately. If the question is ambiguous, cover ALL likely scenarios in your response instead of asking which one they mean. Use natural language, contractions, and a friendly tone. Break responses into short conversational chunks — never dump a wall of text. Use casual phrasing like "Here's exactly what you need to do...", "Got it — the fix is...", "I've seen this before — here's the solution...". Think like a real expert: anticipate what they need and deliver it upfront. Never say "Could you clarify?", "What do you mean by?", "Can you provide more details?" — instead, give the answer directly and cover edge cases.`,
        `REFERENCE LINKS (HARD RULE): When recommending solutions, ALWAYS include relevant reference links. Priority order: 1) Official vendor documentation (Microsoft Learn, Cisco docs, Fortinet KB, Dell Support, etc.) 2) Trusted industry sources (NIST, CIS, OWASP, ITIL) 3) Community-verified solutions (Stack Overflow, Spiceworks, Reddit r/sysadmin) — but ONLY if they have accepted/verified answers. Format links as markdown: [Title](URL). For Microsoft products, always link to https://learn.microsoft.com/... For Cisco, use https://www.cisco.com/c/en/us/support/... For Fortinet, use https://docs.fortinet.com/... Include 1-3 reference links per response when applicable. If you don't have a specific URL, still mention the official documentation source (e.g., "Check Microsoft Learn for the latest guidance on this").`,
        `CORE ROLE: Help engineers and administrators resolve IT tickets, incidents, requests, and problems. Provide fast, accurate, DIRECT answers — like a senior engineer who already knows the solution. Jump straight to the fix. If multiple solutions exist, list them ranked by likelihood. Never hesitate or hedge — be confident and decisive. Advise on best practices. Use context clues to infer what the user needs.`,
        `LEARN FROM ITSM DATA FIRST: Always check internal ITSM data (tickets, incidents, KB articles, change records, Zendesk historical data) before searching external sources. Learn patterns from past tickets — similar issues, recurring problems, what worked before. Reference historical resolutions when relevant. When the internal Knowledge Base has trained entries, ALWAYS reference them FIRST and cite the entry title. Show that you "remember" what you've been taught — say things like "Based on our internal guide [Title]..." or "I recall we documented this — here's what we know...". This makes you smarter and more useful every day as more knowledge is added.`,
        `ZENDESK HISTORICAL DATA: When available, learn from Zendesk ticket history — past resolutions, customer interactions, common issues, and response patterns. Use this context to provide more accurate and personalized assistance.`,
        `EMAIL DRAFTING: When drafting emails, write with sufficient detail and context. Include relevant ticket IDs, timestamps, and specifics. When referencing Microsoft products or services, include official Microsoft documentation links as hyperlinks (e.g., https://learn.microsoft.com/...). Be thorough but not over-written — professional and clear.`,
        `PROACTIVE BEHAVIOR: Give the complete answer FIRST, then proactively offer next steps. Never gate your answer behind a question. After delivering the solution, add 2-3 actionable follow-up suggestions at the end (not as questions, but as offers): "I can also check...", "Next step would be...", "You might also want to...". Anticipate what they need and deliver it — don't wait to be asked twice.`,
        `CONTEXT: Singapore timezone (SGT), PDPA compliance, ISO 27001:2022 certified. Use available ticket data, KB articles, session context, and Zendesk data.`,
        `HIGH/CRITICAL RULES: If severity High/Critical — start with "⚠️ Urgency" line, provide containment steps, recommend escalation path, ask for approval BEFORE sending notices/escalations.`,
        `APPROVAL-FIRST POLICY: Before any outbound action (customer updates, escalations, meeting scheduling, remote sessions) — propose the action, explain why, and ask "Shall I go ahead?" with 3-6 suggested options.`,
        `HARD RULE — ENGINEER REVIEW REQUIRED: NEVER commit, approve, or execute any action that involves financial cost, budget changes, license purchases, infrastructure deletion, data loss, production deployments, or any potentially high-damage/irreversible change. ALWAYS flag these as requiring "Engineer Review" and present the action plan for explicit approval. Say: "This needs your sign-off before I proceed — [describe what and why]."`,
        `KB INTEGRATION: When relevant, recommend 1-3 Knowledge Cards with title, category, quick fix summary, and SharePoint link. If no KB exists, recommend creating one.`,
        `RESPONSE FORMAT: Keep it conversational and ACTION-ORIENTED. Use: 1) Direct answer / solution immediately 2) Step-by-step fix or recommendation 3) Knowledge Cards (if relevant) 4) Proactive next-step offers (not questions). NEVER end with "What would you like to do?" or "Can you tell me more?" — instead end with actionable suggestions like "Here's what I'd recommend next: ...". Be decisive. Be the expert who already knows what to do.`,
        `BRANDING: Never reveal model names, versions, or internal engine details. Do not show any footer branding text.`,
        `SECURITY: Follow PDPA. Never output secrets, passwords, MFA codes, private keys. Minimize personal data.`,
        `Suggest 2-3 relevant next actions after each response. Be a teammate, not a tool.`,
      ].join(" ");

      // ─── Role-Adaptive Prompt — tailor AI responses by persona ───
      const role = (currentUser.rbacRole || '').toLowerCase();
      const isManagement = ['vgc dev admin', 'tenant admin', 'administrator', 'service desk lead'].some(r => role.includes(r.toLowerCase()));
      const isEngineer = ['l1 support', 'l2 support', 'network engineer', 'change manager', 'problem manager', 'asset manager'].some(r => role.includes(r.toLowerCase()));
      const isCustomer = ['end user', 'read only'].some(r => role.includes(r.toLowerCase()));

      let rolePrompt = '';
      if (isManagement) {
        rolePrompt = `\n\nROLE-ADAPTIVE RESPONSE STYLE (Management/Leadership):
- Lead with an EXECUTIVE SUMMARY — 2-3 sentence overview with key numbers first
- Use business impact language: cost, risk, SLA compliance %, team utilization, customer satisfaction
- Highlight decisions needed and recommended actions
- Show trends and comparisons (week-over-week, month-over-month)
- Include team workload distribution when relevant
- Suggest delegation actions: "You may want to assign this to..." or "I recommend escalating to..."
- Format key metrics as bold numbers for quick scanning
- End with strategic next steps, not technical details
- When showing incidents, group by business impact, not technical category
- For approvals, show risk assessment and business justification`;
      } else if (isEngineer) {
        rolePrompt = `\n\nROLE-ADAPTIVE RESPONSE STYLE (Engineer/Technical):
- Lead with the TECHNICAL SOLUTION — exact steps, commands, configs
- Include relevant ticket IDs, system names, error codes
- Provide copy-paste ready commands, scripts, or config snippets when applicable
- Reference vendor documentation with direct links
- Show root cause analysis and related patterns from past incidents
- Include diagnostic steps: what to check, expected vs actual, how to verify the fix
- When discussing SLA, show time remaining in hours/minutes, not percentages
- Suggest knowledge base articles to create from resolutions
- For recurring issues, suggest permanent fixes (automation, monitoring rules, config changes)
- Use technical terminology appropriate for the engineer's specialty (L1=basic, L2=advanced, Network=infra)`;
      } else if (isCustomer) {
        rolePrompt = `\n\nROLE-ADAPTIVE RESPONSE STYLE (End User/Customer):
- Use SIMPLE, friendly language — avoid ITSM jargon and technical terminology
- Lead with reassurance: "I can help with that!" or "Let me get this sorted for you"
- Provide step-by-step instructions with numbered steps (1, 2, 3...)
- Include expected wait times and what happens next
- Offer to create a ticket on their behalf if the issue needs engineer attention
- Show only their own tickets — never reference internal team discussions
- Use encouraging language: "This should be quick to fix" or "We'll have this resolved soon"
- Suggest self-service KB articles before escalation
- For status queries, show simple status (Submitted → In Progress → Resolved) without technical details
- Never mention internal escalation procedures, SLA internals, or team assignments`;
      }

      // ─── Inject real-time ITSM data context so AI can answer accurately ───
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const openInc = incidents.filter(i => i.status === "Open" || i.status === "In Progress");
      const resolvedToday = incidents.filter(i => (i.status === "Resolved" || i.status === "Closed") && i.resolvedAt?.startsWith(todayStr));
      const createdToday = incidents.filter(i => i.createdAt?.startsWith(todayStr) || i.created?.toString().startsWith(todayStr));
      const criticalInc = openInc.filter(i => i.priority === "Critical" || i.priority === "P1" || i.severity === "Critical");
      const highInc = openInc.filter(i => i.priority === "High" || i.priority === "P2");
      const openChanges = changes.filter(c => c.status !== "Closed" && c.status !== "Completed" && c.status !== "Cancelled");
      const pendingApproval = changes.filter(c => c.status === "Awaiting Approval");
      const openProblems = problems.filter(p => p.status === "Open" || p.status === "In Progress" || p.status === "Investigating");
      const openRequests = requests.filter(r => r.status === "Open" || r.status === "In Progress" || r.status === "Pending");
      const resolvedRequestsToday = requests.filter(r => (r.status === "Fulfilled" || r.status === "Closed") && r.resolvedAt?.startsWith(todayStr));

      // Build concise ticket summaries (limit to avoid token bloat)
      const incidentSummary = openInc.slice(0, 25).map(i => `${i.id}: "${i.title || i.subject || i.description?.substring(0, 60) || 'N/A'}" | Priority: ${i.priority || 'N/A'} | Status: ${i.status} | Assigned: ${i.assignedTo || i.assignee || 'Unassigned'} | Created: ${i.createdAt || i.created || 'N/A'}${i.category ? ` | Category: ${i.category}` : ''}${i.slaTarget ? ` | SLA: ${i.slaTarget}h` : ''}`).join("\n");
      const changeSummary = openChanges.slice(0, 10).map(c => `${c.id}: "${c.title || c.subject || 'N/A'}" | Status: ${c.status} | Risk: ${c.risk || 'N/A'} | Type: ${c.type || 'N/A'}`).join("\n");
      const problemSummary = openProblems.slice(0, 10).map(p => `${p.id}: "${p.title || p.subject || 'N/A'}" | Status: ${p.status} | Priority: ${p.priority || 'N/A'} | Root Cause: ${p.rootCause || 'Under investigation'}`).join("\n");
      const requestSummary = openRequests.slice(0, 15).map(r => `${r.id}: "${r.title || r.subject || r.description?.substring(0, 60) || 'N/A'}" | Status: ${r.status} | Priority: ${r.priority || 'N/A'} | Requested By: ${r.requestedBy || r.requester || 'N/A'}`).join("\n");
      const recentResolved = incidents.filter(i => i.status === "Resolved" || i.status === "Closed").slice(0, 10).map(i => `${i.id}: "${i.title || i.subject || 'N/A'}" | Resolved: ${i.resolvedAt || 'N/A'} | Resolution: ${i.resolution?.substring(0, 80) || i.resolutionNotes?.substring(0, 80) || 'N/A'}`).join("\n");
      const kbSummary = (kbArticles || []).slice(0, 10).map(k => `"${k.title}" [${k.category || 'General'}]`).join(", ");

      // SLA stats
      const slaAtRisk = openInc.filter(i => {
        if (!i.createdAt && !i.created) return false;
        const created = new Date(i.createdAt || i.created);
        const elapsed = (now - created) / 3600000;
        const target = i.slaTarget || (i.priority === "Critical" || i.priority === "P1" ? 4 : i.priority === "High" || i.priority === "P2" ? 8 : 24);
        return elapsed > target * 0.75;
      });

      const dataContext = `

=== LIVE ITSM DATA SNAPSHOT (${now.toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}) ===
DASHBOARD SUMMARY:
- Total Incidents: ${incidents.length} | Open: ${openInc.length} | Critical: ${criticalInc.length} | High: ${highInc.length}
- Created Today: ${createdToday.length} | Resolved Today: ${resolvedToday.length}
- SLA At-Risk: ${slaAtRisk.length} tickets approaching/past SLA target
- Open Changes: ${openChanges.length} | Pending Approval: ${pendingApproval.length}
- Open Problems: ${openProblems.length}
- Open Service Requests: ${openRequests.length} | Fulfilled Today: ${resolvedRequestsToday.length}
- Knowledge Base Articles: ${(kbArticles || []).length}

OPEN INCIDENTS (${openInc.length}):
${incidentSummary || "(none)"}

RECENTLY RESOLVED:
${recentResolved || "(none)"}

OPEN CHANGES (${openChanges.length}):
${changeSummary || "(none)"}

OPEN PROBLEMS (${openProblems.length}):
${problemSummary || "(none)"}

OPEN SERVICE REQUESTS (${openRequests.length}):
${requestSummary || "(none)"}

KB ARTICLES: ${kbSummary || "(none)"}

ZENDESK TICKETING:
- Zendesk Open: ${zdStats?.open || 0} | Pending: ${zdStats?.pending || 0} | On Hold: ${zdStats?.hold || 0} | Solved: ${zdStats?.solved || 0}
- Total Zendesk Tickets in ITSM: ${zdTickets.length}
- Zendesk-Linked ITSM Incidents: ${incidents.filter(i => i.zdTicketId).length}
${zdTickets.length > 0 ? "ZENDESK TICKETS:\n" + zdTickets.slice(0, 20).map(t => `ZD#${t.id}: "${t.subject || t.title || 'N/A'}" | Status: ${t.status || 'N/A'} | Priority: ${t.priority || 'N/A'} | Requester: ${t.requester?.name || t.requester_name || t.requester || 'N/A'} | Created: ${t.created_at || t.createdAt || 'N/A'}${t.assignee?.name || t.assignee_name ? ` | Assigned: ${t.assignee?.name || t.assignee_name}` : ''}${t.tags?.length ? ` | Tags: ${t.tags.join(",")}` : ''}`).join("\n") : ""}

CURRENT USER: ${currentUser.name} (${currentUser.rbacRole || "User"}) | Email: ${currentUser.email || "N/A"} | Team: ${currentUser.team || "N/A"}

APP CAPABILITIES — You have access to and can discuss ALL of these features:
MODULES: Dashboard (real-time KPIs, donut charts, AI metrics), Tickets (unified view: Incidents, Problems, Changes, Requests — filterable by status/priority/assignee), Service Catalog (browse & request services), Knowledge Portal (KB articles, search, AI-powered suggestions), Assets/CMDB (hardware/software inventory, config items), SLA & Approvals (SLA compliance tracking, approval workflows for changes/requests), Analytics (reports, trend analysis, performance metrics, MTTR/FCR), Customers (customer profiles, organizations, contact management), AI Assist (AI chatbot, auto-triage, auto-assignment, SLA prediction, pattern detection, KB auto-generation, daily briefing), Admin Settings (user management, RBAC roles, AI config, Zendesk integration, system settings), Productivity (smart tasks, calendar, reminders)
ZENDESK INTEGRATION: Bidirectional sync (Zendesk↔ITSM), AI auto-triage of incoming Zendesk tickets, human approval queue, real-time webhook sync, incremental polling every 90s, full data mirror for AI analysis, ticket import/export
AI FEATURES: VGC-AI Chatbot (you — context-aware, streaming responses), AI Auto-Triage (auto-classify priority/category/assignment), AI Auto-Assignment (smart routing to best engineer), SLA Prediction (predict breaches before they happen), AI Pattern Detection (find recurring issues → create problems), AI KB Auto-Generation (auto-create KB from resolved tickets), AI Daily Briefing (shift handover reports), AI Actions & Approvals (human-in-the-loop for all AI suggestions), AI Email Drafting, AI Threat Analysis
COMMUNICATION: Microsoft 365 integration (Outlook email, Teams channels, Calendar), Email drafting with AI, Escalation management (auto-call, Teams notify, email), Proactive alerts
SECURITY: RBAC (VGC Dev Admin, Tenant Admin, Administrator, Service Desk Lead, L1/L2 Support, Network Engineer, Change/Problem/Asset Manager, End User, Read Only), PDPA compliance, ISO 27001:2022, Cyber News feed, Security alerts
OTHER: Version history & audit trail, Recycle bin (soft delete), Data import/export, UAT testing suite, Guided tour/onboarding, Dark theme UI
=== END LIVE DATA ===

INSTRUCTION: Use the LIVE ITSM DATA above to answer ALL questions about tickets, statistics, SLA, workload, trends, and status. Calculate metrics, counts, and summaries directly from this data. When the user asks about "today's stats", "open tickets", "resolution rate", "SLA breaches", "what needs attention", etc. — answer with SPECIFIC numbers and ticket IDs from the data above. NEVER say you "can't access" or "don't have" the data — you have it right here. Be specific, cite ticket IDs, give real numbers. When asked about Zendesk tickets, use the ZENDESK TICKETING data above. When asked about app features or what you can do, reference the APP CAPABILITIES section.`;

      // Generate context-aware smart suggestion cards (computed before streaming starts)
      const smartSuggestions = (() => {
        const lc = userMsg.toLowerCase();
        const activeInc = incidents.filter(i => i.status !== "Resolved" && i.status !== "Closed");
        const breachedCount = activeInc.filter(i => computeIncidentSla(i).isBreached).length;
        if (lc.includes("vpn") || lc.includes("network") || lc.includes("connectivity")) return [
          { label: "🔧 VPN Troubleshoot Steps", action: "Give me step-by-step VPN troubleshooting guide" },
          { label: "📡 Check Network Status", action: "Show network device health status" },
          { label: "📚 VPN KB Articles", action: "Search knowledge base for VPN solutions" }
        ];
        if (lc.includes("sla") || lc.includes("breach") || lc.includes("compliance")) return [
          { label: `🚨 ${breachedCount} At Risk`, action: "Show tickets approaching SLA breach" },
          { label: "📊 SLA Dashboard", action: "Open SLA compliance dashboard" },
          { label: "⚡ Escalation Plan", action: "What's the escalation procedure for SLA breaches?" }
        ];
        if (lc.includes("security") || lc.includes("threat") || lc.includes("vulnerability")) return [
          { label: "🛡️ Security Scan", action: "Run a security posture check" },
          { label: "📋 Patch Status", action: "Show pending security patches" },
          { label: "🔐 Compliance Check", action: "Check ISO 27001 compliance status" }
        ];
        if (lc.includes("email") || lc.includes("draft") || lc.includes("outlook")) return [
          { label: "✉️ Draft Response", action: "Draft a professional email response" },
          { label: "📧 Email Template", action: "Show available email templates" },
          { label: "📬 Check Inbox", action: "Summarize recent important emails" }
        ];
        if (lc.includes("morning") || lc.includes("briefing") || lc.includes("summary") || lc.includes("good morning")) return [
          { label: "🎯 Priority Actions", action: "What are my top priority actions today?" },
          { label: "📈 Team Performance", action: "How is the team performing this week?" },
          { label: "⚠️ Risk Assessment", action: "Any risks I should know about?" }
        ];
        if (lc.includes("password") || lc.includes("mfa") || lc.includes("access") || lc.includes("account")) return [
          { label: "🔑 Reset Guide", action: "Guide me through password reset process" },
          { label: "📱 MFA Setup", action: "How to set up MFA for a user?" },
          { label: "🔐 Access Review", action: "Check user access permissions" }
        ];
        if (lc.includes("training") || lc.includes("knowledge") || lc.includes("learn") || lc.includes("train") || lc.includes("improve")) return [
          { label: "🧠 Train with Answer", action: "I want to correct/improve an AI answer — let me provide the right information" },
          { label: "📎 Upload Document", action: "I want to upload a document for AI training" },
          { label: "📚 View All KB", action: "Show all trained knowledge entries" }
        ];
        const hour = new Date().getHours();
        if (hour >= 7 && hour <= 9) return [
          { label: "☀️ Morning Briefing", action: "Give me my morning briefing — what needs attention today?" },
          { label: "🎯 Today's Priorities", action: "What are my top priority actions for today?" },
          { label: "⚠️ Overnight Issues", action: "Were there any overnight issues or alerts I should know about?" }
        ];
        if (hour >= 17 && hour <= 19) return [
          { label: "📋 End of Day Summary", action: "Give me an end-of-day summary of what was handled today" },
          { label: "🔄 Handover Report", action: "Generate a shift handover report for the next team" },
          { label: "📊 Today's Stats", action: "Show today's ticket resolution statistics" }
        ];
        return [
          { label: "📊 Morning Briefing", action: "Give me my morning briefing" },
          { label: "🎫 Open Tickets", action: `Show my open tickets and what needs action` },
          { label: "📚 Search KB", action: "Search knowledge base for a solution" }
        ];
      })();

      // Inject past corrections into system prompt so AI learns from human feedback
      let enrichedPrompt = systemPrompt + rolePrompt + dataContext;

      // ─── Conversational Memory Context ───
      addToMemory(chatMemoryRef.current, { role: "user", text: userMsg, _intent: null });
      const memoryCtx = buildMemoryContext(chatMemoryRef.current);
      if (memoryCtx) enrichedPrompt += memoryCtx;

      try {
        const corrRes = await fetch("/api/ai/knowledge/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: userMsg }) });
        if (corrRes.ok) {
          const corrData = await corrRes.json();
          const corrections = (corrData.results || []).filter(e => e.type === "correction" || e.source === "user-correction");
          if (corrections.length > 0) {
            const corrBlock = corrections.slice(0, 3).map(c => `Q: ${c.originalQuestion}\nCorrect Answer: ${c.correctedAnswer}`).join("\n---\n");
            enrichedPrompt += `\n\nIMPORTANT — HUMAN-VERIFIED CORRECTIONS (prioritize these over your training data):\n${corrBlock}`;
          }
        }
      } catch { /* ignore correction lookup failures */ }

      // Inject file attachment content into user message for AI context
      let finalUserMsg = userMsg;
      if (currentAttachments.length > 0) {
        const attachContext = currentAttachments.map(a => `\n--- ATTACHED FILE: ${a.fileName} (${a.fileType}, ${(a.fileSize / 1024).toFixed(1)} KB) ---\n${a.textContent}\n--- END FILE ---`).join("\n");
        finalUserMsg = userMsg + "\n\n" + attachContext;
      }

      // Real-time streaming: add placeholder message and stream tokens into it
      const streamPlaceholder = { role: "ai", text: "", source: "azure", suggestions: smartSuggestions, prompt: userMsg, _typing: true };
      setAiMessages(prev => [...prev, streamPlaceholder]);

      // Build interactive cards based on intent + role
      const cardCtx = { incidents, changes, problems, requests, currentUser, proactiveAlerts, kbArticles };
      const { cards: chatCards, suggestions: suggestionCards } = buildChatCards(userMsg, cardCtx);

      const streamResult = await callAzureOpenAIStream(enrichedPrompt, finalUserMsg, (token, fullText) => {
        setAiMessages(prev => {
          const updated = [...prev];
          const last = updated.length - 1;
          if (updated[last]?._typing) {
            updated[last] = { ...updated[last], text: fullText };
          }
          return updated;
        });
      });

      if (streamResult) {
        // Streaming succeeded — finalize message with interactive cards
        setAiMessages(prev => {
          const updated = [...prev];
          const last = updated.length - 1;
          if (updated[last]?._typing) {
            updated[last] = { role: "ai", text: streamResult, source: "azure", suggestions: smartSuggestions, prompt: userMsg, cards: chatCards, suggestionCards };
          }
          return updated;
        });
        addToMemory(chatMemoryRef.current, { role: "ai", text: streamResult });
        setAiLoading(false);
        trackAction("AI Chat", "AI Response (Stream)", `Q: ${userMsg.substring(0, 80)}${userMsg.length > 80 ? '...' : ''} → VGC-AI Engine`, "AI");
      } else {
        // Streaming failed — remove placeholder and try non-streaming, then local fallback
        setAiMessages(prev => {
          const updated = [...prev];
          if (updated[updated.length - 1]?._typing && !updated[updated.length - 1]?.text) {
            updated.pop();
          }
          return updated;
        });
        const aiResp = await callAzureOpenAI(enrichedPrompt, finalUserMsg);
        if (aiResp) {
          typeAiMessage(aiResp, smartSuggestions, "azure", userMsg);
          trackAction("AI Chat", "AI Response", `Q: ${userMsg.substring(0, 80)}${userMsg.length > 80 ? '...' : ''} → VGC-AI Engine`, "AI");
        } else {
          const topic = matchAiTopic(userMsg);
          const ctx = { incidents, changes, problems, requests, currentUser, proactiveAlerts, kbArticles };
          const result = buildAiResponse(topic, userMsg, ctx);
          typeAiMessage(result.text, result.suggestions?.length > 0 ? result.suggestions : smartSuggestions, "local", userMsg);
          trackAction("AI Chat", "AI Response (Local)", `Q: ${userMsg.substring(0, 80)}${userMsg.length > 80 ? '...' : ''}`, "AI");
        }
      }
    })();
  };

  // ─── Slash Command Definitions ───
  const SLASH_COMMANDS = useMemo(() => [
    { cmd: "/create incident", icon: "🎫", label: "Create Incident", desc: "Open a new incident ticket", category: "Create" },
    { cmd: "/create request", icon: "📋", label: "Create Service Request", desc: "Submit a new service request", category: "Create" },
    { cmd: "/create change", icon: "🔄", label: "Raise Change Request", desc: "Submit a change for approval", category: "Create" },
    { cmd: "/create problem", icon: "🔗", label: "Create Problem", desc: "Log a new problem record", category: "Create" },
    { cmd: "/briefing", icon: "📊", label: "Morning Briefing", desc: "Get your daily ITSM summary", category: "Insights" },
    { cmd: "/sla", icon: "⏱️", label: "SLA Status", desc: "Check SLA compliance & at-risk tickets", category: "Insights" },
    { cmd: "/open tickets", icon: "🎫", label: "Open Tickets", desc: "List all open incidents", category: "Find" },
    { cmd: "/search kb", icon: "📚", label: "Search Knowledge Base", desc: "Find articles & solutions", category: "Find" },
    { cmd: "/find", icon: "🔍", label: "Find Ticket", desc: "Search for a specific ticket by ID or keyword", category: "Find" },
    { cmd: "/escalate", icon: "⚡", label: "Escalate", desc: "Escalate a ticket to L2/L3", category: "Actions" },
    { cmd: "/assign", icon: "👤", label: "Assign Ticket", desc: "Assign a ticket to a team member", category: "Actions" },
    { cmd: "/email", icon: "📧", label: "Draft Email", desc: "Draft a professional email", category: "Actions" },
    { cmd: "/security", icon: "🛡️", label: "Security Check", desc: "Review security alerts & threats", category: "Insights" },
    { cmd: "/reports", icon: "📈", label: "Reports", desc: "View analytics & dashboards", category: "Insights" },
    { cmd: "/duplicates", icon: "🔗", label: "Scan Duplicates", desc: "Find & merge duplicate tickets", category: "Actions" },
    { cmd: "/patterns", icon: "🧩", label: "Detect Patterns", desc: "AI pattern detection across tickets", category: "Insights" },
    { cmd: "/train", icon: "🧠", label: "Train AI", desc: "Add knowledge to improve AI", category: "Actions" },
    { cmd: "/help", icon: "❓", label: "Help", desc: "Show all available commands", category: "General" },
  ], []);

  // ─── AI Chat Action Card Detection ───
  const detectAiActionCards = useCallback((userMsg) => {
    const lc = (userMsg || "").toLowerCase();
    const cards = [];
    if (lc.includes("create") && (lc.includes("ticket") || lc.includes("incident")))
      cards.push({ type: "create_incident", icon: "🎫", title: "Create New Incident", description: "Open a new incident ticket from this conversation", btnLabel: "Create Incident →", action: () => { setShowAiPanel(false); setModal("newIncident"); } });
    if (lc.includes("create") && (lc.includes("request") || lc.includes("service request")))
      cards.push({ type: "create_request", icon: "📋", title: "Create Service Request", description: "Submit a new service request", btnLabel: "Create Request →", action: () => { setShowAiPanel(false); setModal("newRequest"); } });
    if (lc.includes("escalat"))
      cards.push({ type: "escalate", icon: "⚡", title: "Escalate Ticket", description: "Escalate to L2/L3 support or management", btnLabel: "Escalate →", action: () => { setShowAiPanel(false); setActiveModule("incidents"); } });
    if (lc.includes("change") && (lc.includes("create") || lc.includes("raise") || lc.includes("new")))
      cards.push({ type: "create_change", icon: "🔄", title: "Raise Change Request", description: "Submit a new change request for approval", btnLabel: "Create Change →", action: () => { setShowAiPanel(false); setModal("newChange"); } });
    if (lc.includes("knowledge") || lc.includes("kb") || lc.includes("article"))
      cards.push({ type: "open_kb", icon: "📚", title: "Knowledge Base", description: "Search or browse knowledge articles", btnLabel: "Open KB →", action: () => { setShowAiPanel(false); setActiveModule("knowledge"); } });
    if (lc.includes("sla") || lc.includes("breach"))
      cards.push({ type: "sla_check", icon: "⏱️", title: "SLA Dashboard", description: "View SLA compliance and at-risk tickets", btnLabel: "View SLA →", action: () => { setShowAiPanel(false); setActiveModule("sla"); } });
    if (lc.includes("report") || lc.includes("analytics"))
      cards.push({ type: "reports", icon: "📈", title: "Service Reports", description: "View analytics and performance reports", btnLabel: "View Reports →", action: () => { setShowAiPanel(false); setActiveModule("reports"); } });
    if (lc.includes("ai action") || lc.includes("approval") || lc.includes("monitor"))
      cards.push({ type: "ai_actions", icon: "🛡️", title: "AI Actions & Approvals", description: "Review AI-suggested actions pending your approval", btnLabel: "Open AI Actions →", action: () => { setShowAiPanel(false); setShowAiActionsPanel(true); } });
    if (lc.includes("duplicate") || lc.includes("merge"))
      cards.push({ type: "scan_duplicates", icon: "🔗", title: "Duplicate Scanner", description: "Find and merge duplicate incidents", btnLabel: "Scan Now →", action: () => { setShowAiPanel(false); setActiveModule("incidents"); setShowDupPanel(true); } });
    if (lc.includes("assign") && !lc.includes("auto"))
      cards.push({ type: "assign_ticket", icon: "👤", title: "Assign Ticket", description: "Navigate to incidents to assign a ticket", btnLabel: "Go to Incidents →", action: () => { setShowAiPanel(false); setActiveModule("incidents"); } });
    if (lc.includes("email") || lc.includes("draft"))
      cards.push({ type: "email_draft", icon: "📧", title: "Email Module", description: "Open email management for drafting", btnLabel: "Open Email →", action: () => { setShowAiPanel(false); setActiveModule("email"); } });
    if (lc.includes("pattern") || lc.includes("root cause"))
      cards.push({ type: "patterns", icon: "🧩", title: "AI Pattern Detection", description: "View detected patterns across tickets", btnLabel: "View Patterns →", action: () => { setShowAiPanel(false); setActiveModule("problems"); } });
    if (lc.includes("problem") && (lc.includes("create") || lc.includes("new") || lc.includes("raise")))
      cards.push({ type: "create_problem", icon: "🔗", title: "Create Problem Record", description: "Log a new problem for root cause analysis", btnLabel: "Create Problem →", action: () => { setShowAiPanel(false); setModal("newProblem"); } });
    if (lc.includes("train") || lc.includes("teach"))
      cards.push({ type: "train_ai", icon: "🧠", title: "Train AI", description: "Add knowledge to improve AI accuracy", btnLabel: "Open Training →", action: () => { setShowFloatingKbTraining(true); } });
    return cards;
  }, []);

  // ─── Card Action Handler (interactive card system) ──
  const addCards = useCallback((newCards) => {
    setAiMessages(prev => {
      const updated = [...prev];
      const last = updated.length - 1;
      if (last >= 0 && updated[last]?.role === 'ai') {
        const existing = updated[last].cards || [];
        updated[last] = { ...updated[last], cards: [...existing, ...newCards] };
      }
      return updated;
    });
  }, []);

  const handleAiChatRef = useRef(handleAiChat);
  handleAiChatRef.current = handleAiChat;

  const handleCardAction = useMemo(() => createActionHandler({
    setActiveModule,
    setModal,
    setShowAiPanel,
    handleAiChat: (...args) => handleAiChatRef.current(...args),
    showToast,
    addCards,
    setShowDupPanel,
    setShowAiActionsPanel,
    setShowFloatingKbTraining,
  }), [addCards]);

  // ─── AI File Upload Handler ──
  const handleFileUpload = useCallback(async (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    setAiFilePreview({ name: file.name, size: file.size, type: file.type });
    showToast(`File attached: ${file.name}`, "info");
  }, []);

  // ─── Zendesk Approve & Send (Engineer Review Hub) ──
  const zdApproveAndSend = useCallback(async (itemId) => {
    const item = zdAiQueue.find(q => q.ticketId === itemId || q.id === itemId);
    if (!item) { showToast("Queue item not found", "error"); return; }
    try {
      const r = await fetch("/api/zendesk/auto-respond", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: item.ticketId, response: item.draftResponse || item.aiDraft, priority: item.priority, tags: item.tags || [], approvedBy: `${currentUser.name} (engineer-approved)` }),
      });
      if (r.ok) {
        setZdAiQueue(prev => prev.map(q => (q.ticketId === item.ticketId ? { ...q, status: "sent", reviewedBy: currentUser.name } : q)));
        showToast(`✅ Response sent for ticket #${item.ticketId}`, "success");
      } else {
        showToast(`Failed to send response for #${item.ticketId}`, "error");
      }
    } catch (e) { showToast(`Error: ${e.message}`, "error"); }
  }, [zdAiQueue, currentUser]);

  // ─── AI Assist Module (extracted) ──

  // ─── Extracted Tab Components (moved to src/components/ExtractedTabs.jsx) ──

  // ─── Admin Settings Module (extracted to src/modules/AdminSettingsModule.jsx) ──

  // ─── Customer Management (extracted to src/modules/CustomersModule.jsx) ──


  // ─── Reporting Module (extracted to src/modules/ReportingModule.jsx) ──


  // ─── Cyber News Module (extracted to src/modules/CyberNewsModule.jsx) ──


  // ─── Service Status Page (extracted) ──

  // ─── Productivity Dashboard (extracted to src/modules/ProductivityDashboard.jsx) ──



  // ─── Zendesk Core Functions & Effects (parent scope — stable lifecycle) ──
  // Extracted from ZendeskModule to prevent remount-triggered effect loops.
  // ZendeskModule is now a pure render component (no hooks).
  const zdProcessingRef = useRef(false);

  // ── Core Functions ──
  const zdConnect = async () => {
    setZdLoading(true); setZdError(null);
    try {
      const r = await fetch("/api/zendesk/me");
      if (!r.ok) throw new Error((await r.json()).error || "Connection failed");
      const data = await r.json();
      setZdUser(data.user); setZdConnected(true);
      zdFetchTickets(); zdFetchStats();
      // Fetch agents & groups for routing
      try {
        const ar = await fetch("/api/zendesk/agents");
        if (ar.ok) { const ad = await ar.json(); setZdAgents(ad.agents || []); setZdGroups(ad.groups || []); }
      } catch (e) { /* ignore */ }
    } catch (e) { setZdError(e.message); setZdConnected(false); }
    finally { setZdLoading(false); }
  };

  const zdFetchTickets = async (status, page) => {
    const s = status || zdFilter; const p = page || 1;
    setZdLoading(true);
    try {
      const r = await fetch(`/api/zendesk/tickets?status=${s}&page=${p}&per_page=25&sort_order=desc`);
      if (!r.ok) throw new Error((await r.json()).error);
      const data = await r.json();
      setZdTickets(data.tickets || data.results || []);
      setZdPage(p);
    } catch (e) { setZdError(e.message); }
    finally { setZdLoading(false); }
  };

  const zdFetchStats = async () => {
    try {
      const r = await fetch("/api/zendesk/stats");
      if (r.ok) {
        const data = await r.json();
        setZdStats({
          open: Number(data?.open) || 0,
          pending: Number(data?.pending) || 0,
          hold: Number(data?.hold) || 0,
          solved: Number(data?.solved) || 0,
        });
      }
    } catch (e) {
      setZdStats({ open: 0, pending: 0, hold: 0, solved: 0 });
    }
  };

  const zdFetchComments = async (ticketId) => {
    try {
      const r = await fetch(`/api/zendesk/tickets/${ticketId}/comments`);
      if (r.ok) { const data = await r.json(); setZdComments(data.comments || []); }
    } catch (e) { /* ignore */ }
  };

  const zdSelectTicket = async (ticket) => {
    setZdSelectedTicket(ticket);
    await zdFetchComments(ticket.id);
  };

  const addAutoLog = (entry) => {
    setZdAutoLog(prev => [{ ...entry, id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, timestamp: new Date().toISOString() }, ...prev].slice(0, 200));
  };

  // ── AI Auto-Triage (server-side) ──
  const zdAiTriageSingle = async (ticketId) => {
    try {
      const r = await fetch("/api/zendesk/auto-triage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId }),
      });
      if (!r.ok) throw new Error("Triage failed");
      const data = await r.json();
      const triage = data.triage;
      const ticket = data.ticket;
      const requester = data.requester;

      // Compute SLA deadline from creation time + target hours
      const slaTargetHours = data.slaTargetHours || 9;
      const ticketCreated = ticket?.created_at || new Date().toISOString();
      const slaDeadline = new Date(new Date(ticketCreated).getTime() + slaTargetHours * 3600000).toISOString();

      const queueItem = {
        id: `ZDAI-${Date.now()}-${ticketId}`,
        ticketId, ticketSubject: ticket?.subject || "No subject",
        ticketStatus: ticket?.status,
        requesterName: requester?.name || ticket?.via?.source?.from?.name || "",
        requesterEmail: requester?.email || "",
        category: triage.category || "General", suggestedPriority: triage.priority,
        suggestedTags: triage.tags || [], draftResponse: triage.draft_response,
        internalNote: triage.internal_note, confidence: triage.confidence || 75,
        suggestedAssignee: triage.suggested_assignee || "L1 Support",
        autoSendable: triage.auto_sendable === true && (triage.confidence || 0) >= 85,
        itsmCategory: triage.itsm_category || triage.category || "General",
        slaPriority: triage.sla_priority || "Sev-D",
        status: "pending_approval",
        createdAt: new Date().toISOString(), reviewedBy: null,
        // Enriched context for engineer review
        ticketDescription: data.ticketDescription || ticket?.description || "",
        ticketComments: data.recentComments || [],
        customerCompany: data.organization?.name || data.itsmCustomer?.name || "",
        customerContract: data.itsmCustomer?.contract || "",
        customerCategory: data.itsmCustomer?.category || "",
        customerServices: data.itsmCustomer?.services || "",
        orgDomains: data.organization?.domains || [],
        historicalTicketCount: data.historicalTicketCount || 0,
        lastTicketDate: data.lastTicketDate || null,
        slaTargetHours,
        slaDeadline,
      };

      setZdTriagedIds(prev => new Set(prev).add(ticketId));
      setZdAutoStats(prev => {
        const stats = normalizeZdAutoStats(prev);
        const nextTotal = stats.totalTriaged + 1;
        return { ...stats, totalTriaged: nextTotal, avgConfidence: Math.round(((stats.avgConfidence * stats.totalTriaged) + (triage.confidence || 75)) / nextTotal) };
      });

      // ═══ CONFIGURABLE: Require Human Approval toggle ═══
      // When zdRequireHumanApproval=true → ALL responses go to engineer review queue (no auto-send)
      // When zdRequireHumanApproval=false → High-confidence (≥85%) routine items auto-send
      if (!zdRequireHumanApproval && queueItem.autoSendable && (triage.confidence || 0) >= 85) {
        // AI AUTO-SEND: High confidence, routine issue — send immediately
        try {
          const autoR = await fetch("/api/zendesk/auto-respond", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticketId, response: triage.draft_response, priority: triage.priority, tags: triage.tags || [], internalNote: triage.internal_note, approvedBy: `AI Engine (${triage.confidence}% confidence — auto-approved)` }),
          });
          if (autoR.ok) {
            const autoResult = await autoR.json();
            queueItem.status = "sent";
            queueItem.reviewedBy = "AI Auto-Approved";
            setZdAutoStats(prev => { const stats = normalizeZdAutoStats(prev); return { ...stats, autoSent: stats.autoSent + 1 }; });
            const emailNote = autoResult.email?.sent ? ` ✉️ Email sent to ${autoResult.email.to}` : "";
            addAutoLog({ type: "auto_send", ticketId, subject: ticket?.subject, confidence: triage.confidence, category: triage.category, message: `#${ticketId} AI auto-sent (${triage.confidence}% confidence, ${triage.category})${emailNote}` });
            // Set Zendesk ticket to "pending" so it auto-closes if no reply within 48h
            fetch(`/api/zendesk/tickets/${ticketId}/status`, {
              method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "pending" }),
            }).catch(() => {});
          } else {
            // Auto-send failed — fall back to engineer review
            queueItem.status = "pending_approval";
            setZdAutoStats(prev => { const stats = normalizeZdAutoStats(prev); return { ...stats, humanReview: stats.humanReview + 1 }; });
            addAutoLog({ type: "human_review", ticketId, subject: ticket?.subject, confidence: triage.confidence, message: `#${ticketId} auto-send failed — queued for engineer review` });
          }
        } catch {
          queueItem.status = "pending_approval";
          setZdAutoStats(prev => { const stats = normalizeZdAutoStats(prev); return { ...stats, humanReview: stats.humanReview + 1 }; });
          addAutoLog({ type: "human_review", ticketId, subject: ticket?.subject, confidence: triage.confidence, message: `#${ticketId} auto-send error — queued for engineer review` });
        }
      } else {
        // ENGINEER REVIEW: Low confidence or sensitive — needs engineer approval (the 10%)
        setZdAutoStats(prev => { const stats = normalizeZdAutoStats(prev); return { ...stats, humanReview: stats.humanReview + 1 }; });
        addAutoLog({ type: "human_review", ticketId, subject: ticket?.subject, confidence: triage.confidence, category: triage.category, message: `#${ticketId} queued for engineer review (${triage.confidence}% confidence) — ${(triage.confidence || 0) < 85 ? "low confidence" : "sensitive/complex issue"}` });
      }

      // AUTO-CREATE ITSM INCIDENT for Sev-A/Sev-B only — server-side deduped endpoint
      const _existingZdInc = incidents.find(i => String(i.zdTicketId) === String(ticketId) || i.id === `INC-ZD${ticketId}`);
      if (_existingZdInc) {
        addAutoLog({ type: "info", ticketId, subject: ticket?.subject, message: `#${ticketId} already tracked as ${_existingZdInc.id} — skipped duplicate creation` });
        queueItem.itsmIncidentId = _existingZdInc.id;
        setZdAiQueue(prev => [queueItem, ...prev.filter(q => q.ticketId !== ticketId)]);
        setAzureOpenAI(prev => ({ ...prev, totalCalls: (prev.totalCalls || 0) + 1 }));
        return queueItem;
      }
      const _slaPri = triage.sla_priority || "Sev-D";
      if (_slaPri === "Sev-A" || _slaPri === "Sev-B") {
        try {
          const incRes = await fetch("/api/zendesk/create-incident", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticketId, subject: ticket?.subject, description: ticket?.description, priority: triage.priority, slaPriority: _slaPri, category: triage.itsm_category || triage.category || "General", assignee: triage.suggested_assignee || "Unassigned", requesterName: requester?.name, requesterEmail: requester?.email, confidence: triage.confidence, internalNote: triage.internal_note }),
          });
          if (incRes.ok) {
            const incData = await incRes.json();
            if (incData.success && incData.incident) {
              // New incident created
              queueItem.itsmIncidentId = incData.incident.id;
              setIncidents(prev => [incData.incident, ...prev]);
              setZdAutoStats(prev => { const stats = normalizeZdAutoStats(prev); return { ...stats, incidentsCreated: stats.incidentsCreated + 1 }; });
              addAutoLog({ type: "incident_created", ticketId, subject: ticket?.subject, incidentId: incData.incident.id, priority: _slaPri, customer: requester?.name || "", message: `ITSM ${incData.incident.id} auto-created from #${ticketId} — ${_slaPri} (${requester?.name || "unknown requester"})` });
            } else if (incData.skipped && incData.incident) {
              // Already existed — just link, don't duplicate
              queueItem.itsmIncidentId = incData.incident.id;
              addAutoLog({ type: "info", ticketId, subject: ticket?.subject, message: `#${ticketId} already tracked as ${incData.incident.id} (server dedup)` });
            }
          }
        } catch (incErr) {
          addAutoLog({ type: "error", ticketId, message: `Incident creation failed for #${ticketId}: ${incErr.message}` });
        }
      } else {
        addAutoLog({ type: "info", ticketId, subject: ticket?.subject, message: `#${ticketId} is ${_slaPri} — no ITSM incident created (Sev-C/D handled by AI)` });
      }

      setZdAiQueue(prev => [queueItem, ...prev.filter(q => q.ticketId !== ticketId)]);
      setAzureOpenAI(prev => ({ ...prev, totalCalls: (prev.totalCalls || 0) + 1 }));
      return queueItem;
    } catch (e) {
      addAutoLog({ type: "error", ticketId, message: `Triage failed for #${ticketId}: ${e.message}` });
      return null;
    }
  };

  const zdAiSolveTicket = async (ticketId, options = {}) => {
    const dryRun = options.dryRun !== false;
    setZdAiProcessing(true);
    try {
      const r = await fetch("/api/zendesk/ai-solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId,
          dryRun,
          confirmSafety: options.confirmSafety === true,
          sendCustomerEmail: options.sendCustomerEmail === true,
          requestedBy: currentUser?.email || currentUser?.name || "AI Front",
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "AI Safe Solve failed");

      const ticket = data.ticket || {};
      const decision = data.decision || {};
      const status = data.applied ? "safe_solved" : decision.eligible ? "safe_solve_ready" : "safe_solve_blocked";
      const existing = zdAiQueue.find(q => String(q.ticketId) === String(ticketId));
      const queueItem = {
        ...(existing || {}),
        id: existing?.id || `ZDSAFE-${Date.now()}-${ticketId}`,
        ticketId,
        ticketSubject: existing?.ticketSubject || ticket.subject || `Ticket #${ticketId}`,
        status,
        confidence: decision.confidence ?? existing?.confidence ?? 0,
        category: decision.category || existing?.category || "General",
        suggestedPriority: decision.priority || existing?.suggestedPriority || ticket.priority || "normal",
        suggestedAssignee: decision.suggestedAssignee || existing?.suggestedAssignee || "AI Safe Solve",
        slaPriority: decision.slaPriority || existing?.slaPriority || "Sev-C",
        slaDeadline: decision.slaDecision?.deadline || existing?.slaDeadline || ticket.created_at,
        slaTargetHours: decision.slaDecision?.targetHours || existing?.slaTargetHours || 9,
        draftResponse: decision.customerResponse || existing?.draftResponse || "",
        internalNote: decision.internalNote || existing?.internalNote || "AI Safe Solve decision returned from server.",
        requesterName: existing?.requesterName || data.requester?.name || "Zendesk requester",
        requesterEmail: existing?.requesterEmail || data.requester?.email || "",
        autoSendable: decision.autoSendable === true,
        safeSolve: data,
        reviewedBy: data.applied ? "AI Safe Solve" : existing?.reviewedBy || null,
        reviewedAt: data.applied ? new Date().toISOString() : existing?.reviewedAt,
        createdAt: existing?.createdAt || new Date().toISOString(),
      };
      setZdAiQueue(prev => [queueItem, ...prev.filter(q => String(q.ticketId) !== String(ticketId))]);

      if (data.applied) {
        setZdAutoStats(prev => { const stats = normalizeZdAutoStats(prev); return { ...stats, safeSolved: stats.safeSolved + 1 }; });
        addAutoLog({ type: "auto_send", ticketId, subject: ticket.subject, confidence: decision.confidence, message: `#${ticketId} AI Safe Solve applied (${decision.confidence || 0}% confidence) — no public Zendesk comment; email target ${decision.safeCustomerContact?.customerEmailTarget || "johndoe@vgcsg.com"}` });
        showToast(`AI Safe Solve applied for #${ticketId}`, "success");
        zdFetchTickets(); zdFetchStats();
      } else if (decision.eligible) {
        addAutoLog({ type: "info", ticketId, subject: ticket.subject, confidence: decision.confidence, message: `#${ticketId} AI Safe Check passed — ready to solve safely (${decision.confidence || 0}%)` });
        showToast(`AI Safe Check passed for #${ticketId}`, "success");
      } else {
        setZdAutoStats(prev => { const stats = normalizeZdAutoStats(prev); return { ...stats, safeSolveBlocked: stats.safeSolveBlocked + 1 }; });
        addAutoLog({ type: "human_review", ticketId, subject: ticket.subject, confidence: decision.confidence, message: `#${ticketId} AI Safe Solve blocked: ${(decision.blockedReasons || []).join(", ") || "review required"}` });
        showToast(`AI Safe Solve sent #${ticketId} to review`, "warning");
      }
      return data;
    } catch (e) {
      addAutoLog({ type: "error", ticketId, message: `AI Safe Solve failed for #${ticketId}: ${e.message}` });
      showToast(`AI Safe Solve failed: ${e.message}`, "error");
      return null;
    } finally {
      setZdAiProcessing(false);
    }
  };

  // ── Batch Auto-Triage (triggered by polling or manual) ──
  const zdAutoTriageBatch = async () => {
    if (zdProcessingRef.current) return;
    zdProcessingRef.current = true; setZdAiProcessing(true);
    try {
      const r = await fetch("/api/zendesk/new-tickets");
      if (!r.ok) return;
      const data = await r.json();
      const tickets = data.results || data.tickets || [];
      const untriaged = tickets.filter(t => !zdTriagedIds.has(t.id));
      if (untriaged.length === 0) { addAutoLog({ type: "info", message: "Polling: No new tickets to triage" }); return; }

      addAutoLog({ type: "info", message: `Found ${untriaged.length} new ticket(s) — starting AI triage...` });
      for (const ticket of untriaged.slice(0, 15)) {
        await zdAiTriageSingle(ticket.id);
      }
      zdFetchStats();
    } catch (e) { addAutoLog({ type: "error", message: `Batch triage error: ${e.message}` }); }
    finally { zdProcessingRef.current = false; setZdAiProcessing(false); }
  };

  // ── Auto-connect & start polling ──
  React.useEffect(() => {
    if (!zdFetchedRef.current) {
      zdFetchedRef.current = true;
      zdConnect().then(() => {
        // Auto-start first triage pass on connect
        if (azureOpenAI.enabled) {
          setTimeout(() => { if (Date.now() - zdBatchThrottleRef.current > 60000) { zdBatchThrottleRef.current = Date.now(); zdAutoTriageBatch(); } }, 3000);
        }
      });
    }
  }, []);

  // ── Migrate cached zdAiQueue: fix status "pending" → "pending_approval" (one-time) ──
  React.useEffect(() => {
    if (localStorage.getItem("vgc_zd_queue_v2")) return;
    const raw = localStorage.getItem("vgc_zd_ai_queue");
    if (raw) {
      try {
        const q = JSON.parse(raw);
        if (Array.isArray(q) && q.some(i => i.status === "pending")) {
          const fixed = q.map(i => i.status === "pending" ? { ...i, status: "pending_approval" } : i);
          localStorage.setItem("vgc_zd_ai_queue", JSON.stringify(fixed));
          setZdAiQueue(fixed);
        }
      } catch (e) { /* ignore */ }
    }
    localStorage.setItem("vgc_zd_queue_v2", "1");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist AI queue, triaged IDs, stats, and logs to localStorage ──
  React.useEffect(() => { try { localStorage.setItem("vgc_zd_ai_queue", JSON.stringify(zdAiQueue)); } catch (e) { /* ignore */ } }, [zdAiQueue]);
  React.useEffect(() => { try { localStorage.setItem("vgc_zd_triaged_ids", JSON.stringify([...zdTriagedIds])); } catch (e) { /* ignore */ } }, [zdTriagedIds]);
  React.useEffect(() => { try { localStorage.setItem("vgc_zd_auto_stats", JSON.stringify(normalizeZdAutoStats(zdAutoStats))); } catch (e) { /* ignore */ } }, [zdAutoStats]);
  React.useEffect(() => { try { localStorage.setItem("vgc_zd_auto_log", JSON.stringify(zdAutoLog.slice(0, 100))); } catch (e) { /* ignore */ } }, [zdAutoLog]);
  React.useEffect(() => { try { if (zdStats && typeof zdStats === "object") localStorage.setItem("vgc_zd_stats", JSON.stringify(zdStats)); } catch (e) { /* ignore */ } }, [zdStats]);
  React.useEffect(() => { try { localStorage.setItem("vgc_zd_tickets", JSON.stringify(zdTickets)); } catch (e) { /* ignore */ } }, [zdTickets]);

  // Auto-polling for new tickets (every 120s when automation is on)
  React.useEffect(() => {
    if (zdConnected && zdAutoMode && azureOpenAI.enabled) {
      // Run immediately on enable (throttled to prevent spam on remounts)
      if (Date.now() - zdBatchThrottleRef.current > 60000) { zdBatchThrottleRef.current = Date.now(); zdAutoTriageBatch(); }
      zdPollingRef.current = setInterval(() => { if (!tabVisibleRef.current) return; zdBatchThrottleRef.current = Date.now(); zdAutoTriageBatch(); }, 120000);
      return () => clearInterval(zdPollingRef.current);
    }
    return () => { if (zdPollingRef.current) clearInterval(zdPollingRef.current); };
  }, [zdConnected, zdAutoMode, azureOpenAI.enabled]);

  // Real-time incremental sync polling (every 90s)
  React.useEffect(() => {
    if (zdConnected && zdRealTimeEnabled) {
      // Fetch sync status on connect
      fetch("/api/zendesk/sync-status").then(r => r.json()).then(data => setZdSyncStatus(data)).catch(() => {});

      zdRealTimePollRef.current = setInterval(async () => {
        if (!tabVisibleRef.current) return; // skip when tab hidden
        try {
          // Run incremental sync
          const r = await fetch("/api/zendesk/incremental-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          if (r.ok) {
            const data = await r.json();
            if (data.stats && (data.stats.ticketsUpdated > 0 || data.stats.ticketsCreated > 0)) {
              addAutoLog({ type: "info", message: `Real-time sync: ${data.stats.ticketsCreated} new, ${data.stats.ticketsUpdated} updated, ${data.stats.commentsAdded} comments` });
              zdFetchTickets(); zdFetchStats();
              // Refresh ITSM incidents — sync may have updated status/priority in DB
              await refreshIncidentsFromDB();
              // Auto-triage newly discovered tickets (90% AI rule)
              if (data.stats.ticketsCreated > 0 && zdAutoMode && azureOpenAI.enabled) {
                addAutoLog({ type: "info", message: `${data.stats.ticketsCreated} new ticket(s) found — triggering AI auto-triage...` });
                setTimeout(() => zdAutoTriageBatch(), 2000);
              }
            }
          }
          // Always refresh sync status & incidents
          const statusR = await fetch("/api/zendesk/sync-status");
          if (statusR.ok) setZdSyncStatus(await statusR.json());
        } catch (e) { /* ignore */ }
      }, 90000);
      return () => clearInterval(zdRealTimePollRef.current);
    }
    return () => { if (zdRealTimePollRef.current) clearInterval(zdRealTimePollRef.current); };
  }, [zdConnected, zdRealTimeEnabled]);

  // ─── Zendesk Module (extracted to src/modules/ZendeskModule.jsx) ──


  // ─── Architecture Diagram (extracted) ──

  // ─── Render Module Content ────────────────────────────────────────────
  // ─── Tickets Module (Merged: Incidents + Zendesk + Operations) ────────
  const TicketsModule = useStableComponent(() => {
    const tabStyle = (id) => ({
      padding: "10px 20px", background: ticketsSubTab === id ? "#12141E" : "transparent",
      border: "none", borderBottom: ticketsSubTab === id ? "2px solid #FF6B6B" : "2px solid transparent",
      color: ticketsSubTab === id ? "#E8ECF4" : "#5A6178", cursor: "pointer", fontSize: 12,
      fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6
    });
    return (
      <div>
        <div style={{ display: "flex", borderBottom: "1px solid #1E2130", marginBottom: 16 }}>
          <button onClick={() => setTicketsSubTab("incidents")} style={tabStyle("incidents")}>
            🚨 Incidents <span style={{ background: "#FF6B6B22", color: "#FF6B6B", padding: "1px 6px", borderRadius: 8, fontSize: 9 }}>{incidents.filter(i => i.status !== "Resolved" && i.status !== "Closed").length}</span>
          </button>
          <button onClick={() => setTicketsSubTab("zendesk")} style={tabStyle("zendesk")}>
            🎫 Zendesk AI <span style={{ background: "#EC489922", color: "#EC4899", padding: "1px 6px", borderRadius: 8, fontSize: 9 }}>{(zdStats?.open || 0) + (zdStats?.pending || 0)}</span>
          </button>
          <button onClick={() => setTicketsSubTab("operations")} style={tabStyle("operations")}>
            ⚙️ Operations <span style={{ background: "#CE93D822", color: "#CE93D8", padding: "1px 6px", borderRadius: 8, fontSize: 9 }}>{problems.filter(p => !["Resolved","Closed"].includes(p.status)).length + changes.filter(c => ["New","Awaiting Approval","Approved"].includes(c.status)).length + requests.filter(r => ["Open","In Progress"].includes(r.status)).length}</span>
          </button>
        </div>
        {ticketsSubTab === "incidents" && (<IncidentsModule ctx={{ incidents, setIncidents, search, setSearch, currentUser, showToast, _save, setDetailItem, setModal, setActiveModule, computeIncidentSlaFn: computeIncidentSla, users: managedUsers, aiResolveQueue, aiResolveFilter, setAiResolveFilter, aiResolveLoading, aiBulkDismissLoading, aiBulkApproveLoading, handleAiResolveAction, handleBulkDismiss, handleBulkApprove, runAiAutoResolve, aiResolveScanLoading, aiWorkflowQueue, aiWorkflowLoading, handleAiWorkflowAction, runAiWorkflowAssist, aiWorkflowScanLoading, historicalCloseRunning, runBulkCloseTickets, runAiAutoFollowUp, aiFollowUpLoading, runCleanupQueue, cleanupLoading, zdStats, globalSyncActive, globalLastSync }} />)}
        {ticketsSubTab === "zendesk" && (<ZendeskModule
          assets={assets} changes={changes} currentUser={currentUser} customers={customers} incidents={incidents} requests={requests}
          setActiveModule={setActiveModule} setDetailItem={setDetailItem} setModal={setModal} showToast={showToast} users={managedUsers}
          setIncidents={setIncidents} setCustomers={setCustomers} azureOpenAI={azureOpenAI}
          zdState={{
            zdTab, zdTickets, zdStats, zdConnected, zdLoading, zdError, zdFilter, zdSelectedTicket, zdPage, zdRenderLimit,
            zdExpandedSections, zdComments, zdTriagedIds, zdAiQueue, zdAutoMode, zdAutoStats, zdAiProcessing,
            zdSyncInProgress, zdSyncProgress, zdSyncStatus, zdImportProgress, zdUser, zdAutoLog,
            zdRealTimeEnabled, zdRequireHumanApproval, zdEditingDraft, zdEditedText, zdExpandedRule,
          }}
          zdActions={{
            setZdTab, setZdTickets, setZdStats, setZdConnected, setZdLoading, setZdError, setZdFilter, setZdSelectedTicket,
            setZdPage, setZdRenderLimit, setZdExpandedSections, setZdComments, setZdTriagedIds, setZdAiQueue,
            setZdAutoMode, setZdAutoStats, setZdAiProcessing, setZdSyncInProgress, setZdSyncProgress, setZdSyncStatus,
            setZdImportProgress, setZdUser, setZdAutoLog, setZdRealTimeEnabled, setZdRequireHumanApproval,
            setZdEditingDraft, setZdEditedText, setZdExpandedRule, addAutoLog,
            zdConnect, zdFetchTickets, zdFetchStats, zdAutoTriageBatch, zdAiTriageSingle, zdAiSolveTicket, zdSelectTicket, zdToggleSection,
          }}
        />)}
        {ticketsSubTab === "operations" && (<OperationsModule />)}
      </div>
    );
  });

  // ─── SLA & Approvals Module (Merged) ──────────────────────────────────
  const SLAApprovalsModule = useStableComponent(() => {
    const tabStyle = (id) => ({
      padding: "10px 20px", background: slaApprovalsSubTab === id ? "#12141E" : "transparent",
      border: "none", borderBottom: slaApprovalsSubTab === id ? "2px solid #FFB347" : "2px solid transparent",
      color: slaApprovalsSubTab === id ? "#E8ECF4" : "#5A6178", cursor: "pointer", fontSize: 12,
      fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6
    });
    return (
      <div>
        <div style={{ display: "flex", borderBottom: "1px solid #1E2130", marginBottom: 16 }}>
          <button onClick={() => setSlaApprovalsSubTab("sla")} style={tabStyle("sla")}>
            ⏱️ SLA Tracker
          </button>
          <button onClick={() => setSlaApprovalsSubTab("approvals")} style={tabStyle("approvals")}>
            ✅ Approvals <span style={{ background: "#4CAF5022", color: "#4CAF50", padding: "1px 6px", borderRadius: 8, fontSize: 9 }}>{changes.filter(c => c.status === "Awaiting Approval").length + requests.filter(r => r.status === "Pending Approval").length}</span>
          </button>
        </div>
        {slaApprovalsSubTab === "sla" && <SLATrackerModule ctx={{ incidents, slaPolicy, currentUser, showToast, search, setSearch }} />}
        {slaApprovalsSubTab === "approvals" && <ApprovalsModule />}
      </div>
    );
  });

  // ─── Analytics Module (Merged: Reports + Cyber News + Architecture) ──
  // ─── Analytics Module (extracted to src/modules/AnalyticsModule.jsx) ──
  // ─── Engineer Review Hub (extracted to src/modules/EngineerReviewHub.jsx) ──

  // ─── Self-Service Portal (extracted to src/modules/SelfServicePortal.jsx) ──


  const safeZdAutoStats = normalizeZdAutoStats(zdAutoStats);

  const dashboardCtx = {
    currentUser, showToast, _save, incidents, problems, changes, requests,
    assets, kbArticles, serviceCatalog, customers, users: managedUsers, vendors, search,
    setActiveModule, setDetailItem, setModal, setSearch,
    slaPolicy, slaTick, proactiveAlerts, dismissedProactiveAlerts, setDismissedProactiveAlerts,
    dashboardThreats, dismissedThreats, setDismissedThreats, threatEmailDraft, setThreatEmailDraft,
    graphEmails, graphCalendar, graphUnread, graphPresence,
    cardVisibility, setCardVisibility, showCardSettings, setShowCardSettings,
    dashboardEditMode, setDashboardEditMode,
    cardLayout, setCardLayout, dragState, setDragState,
    merakiData, merakiLoading, setMerakiLoading, setMerakiData,
    solarwindsData, solarwindsLoading, setSolarwindsLoading, setSolarwindsData,
    sophosData, sophosLoading, setSophosLoading, setSophosData,
    expandedMerakiOrg, setExpandedMerakiOrg,
    networkSecTab, setNetworkSecTab,
    workflowHubTab, setWorkflowHubTab,
    wfAnimStep, setWfAnimStep, wfAnimPlaying, setWfAnimPlaying,
    wsConnected, globalLastSync, globalSyncActive,
    aiActions, showAiActionsPanel, setShowAiActionsPanel,
    setTicketsSubTab, setAnalyticsSubTab,
    approvalInstances, escalationConfig,
    prodTestMode, runtimeConfig,
    aiPipelineStats,
    setVendors, softDelete,
    zdConnected, wsBridgeConnected, zdAutoStats: safeZdAutoStats, zdAiQueue, setZdTab,
    showAiPanel, setShowAiPanel,
    fetchCsatScores, csatLoading, csatScores,
    fetchAiActions, setIncidents, pdpaConfig,
    zdStats, aiConfig,
  };

  const renderModule = () => {
    // End Users always get the self-service portal
    if (currentUser.rbacRole === "End User" && !["knowledge", "catalog"].includes(activeModule)) return (<SelfServicePortal currentUser={currentUser} incidents={incidents} setIncidents={setIncidents} requests={requests} problems={problems} changes={changes} kbArticles={kbArticles} serviceCatalog={serviceCatalog} portalTab={portalTab} setPortalTab={setPortalTab} portalSearch={portalSearch} setPortalSearch={setPortalSearch} setActiveModule={setActiveModule} setDetailItem={setDetailItem} setModal={setModal} showToast={showToast} />);
    switch (activeModule) {
      case "selfService": return (<SelfServicePortal currentUser={currentUser} incidents={incidents} setIncidents={setIncidents} requests={requests} problems={problems} changes={changes} kbArticles={kbArticles} serviceCatalog={serviceCatalog} portalTab={portalTab} setPortalTab={setPortalTab} portalSearch={portalSearch} setPortalSearch={setPortalSearch} setActiveModule={setActiveModule} setDetailItem={setDetailItem} setModal={setModal} showToast={showToast} />);
      case "dashboard": return (<DashboardModule ctx={dashboardCtx} />);
      case "tickets": return (<TicketsModule />);
      case "incidents": return (<TicketsModule />);
      case "zendesk": return (<TicketsModule />);
      case "operations": return (<OperationsModule />);
      case "problems": return (<OperationsModule />);
      case "changes": return (<OperationsModule />);
      case "requests": return (<OperationsModule />);
      case "slaApprovals": return (<SLAApprovalsModule />);
      case "sla": return (<SLAApprovalsModule />);
      case "approvals": return (<SLAApprovalsModule />);
      case "humanReview": return (<EngineerReviewHub ctx={{
        aiActions, aiActionsLoading,
        zdAiQueue,
        changes, requests,
        reviewTab, setReviewTab,
        runAiMonitor,
        setShowAiActionsPanel,
        approveAiAction, rejectAiAction, sendAiApprovalEmail,
        applyAiTriage, approveKBDraft,
        zdApproveAndSend,
        setActiveModule, setZdTab,
        setDetailItem, setModal,
      }} />);
      case "catalog": return (<CatalogModule />);
      case "knowledge": return (<KnowledgeModule ctx={{
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
        generateGuide, generateSpDoc, mdToHtml, exportToWord,
      }} />);
      case "assets": return (<AssetsModule />);
      case "customers": return (<CustomersModule ctx={{
        currentUser, showToast, _save,
        customers, setCustomers,
        incidents, requests,
        customerSearch, setCustomerSearch,
        customerCategoryFilter, setCustomerCategoryFilter,
        customerStatusFilter, setCustomerStatusFilter,
        showAddCustomer, setShowAddCustomer,
        customerForm, setCustomerForm,
        editingCustomerId, setEditingCustomerId,
      }} />);
      case "vendorPortal": return (<VendorPortalModule ctx={{
        currentUser, showToast, _save,
        vendors, setVendors, incidents,
      }} />);
      case "ai": return (<AIAssistModule ctx={{
        currentUser, showToast,
        aiMessages, setAiMessages,
        aiInput, setAiInput, aiLoading, setAiLoading,
        aiError, setAiError, handleAiChat, SLASH_COMMANDS,
        chatContainerRef, chatInputRef,
        aiNudge, setAiNudge, aiNudgeDismissed,
        aiFilePreview, setAiFilePreview,
        handleFileUpload, aiEditingIdx, setAiEditingIdx,
        aiEditText, setAiEditText,
        detectAiActionCards, handleCardAction,
        incidents, requests, problems, changes, azureOpenAI,
        setActiveModule, zdAiQueue, zdAutoStats, zdStats,
      }} />);
      case "analytics":
      case "reports":
      case "cybernews":
      case "architecture": {
        const analyticsCtx = {
          analyticsSubTab, setAnalyticsSubTab,
          serviceReports, setServiceReports,
          csatAiAnalysis,
          incidents,
          currentUser, customers, problems, requests, changes, assets,
          users: managedUsers, vendors,
          setActiveModule, showToast, softDelete,
          fetchAiLearningData, deleteAiFeedback,
          aiLearningLoading, aiLearningMetrics, aiModelHealth,
          aiLearningTrends, aiLearningTrendPeriod, setAiLearningTrendPeriod,
          aiLearningFeedback,
        };
        return (<AnalyticsModuleWrapper ctx={analyticsCtx} />);
      }
      case "serviceStatus": return (<ServiceStatusModule ctx={{ currentUser, incidents, changes }} />);
      case "admin": return (<AdminSettingsModule ctx={{
        currentUser, showToast, _save, adminTab, setAdminTab,
        incidents, problems, changes, requests, assets, kbArticles, serviceCatalog, customers,
        users: managedUsers, vendors, search,
        slaPolicy, setSlaPolicy, slaEditingSev, setSlaEditingSev,
        notifChannels, setNotifChannels,
        emailWhitelist, setEmailWhitelist, emailRejections,
        escalationConfig, setEscalationConfig, escalationLog, setEscalationLog,
        billingConfig, setBillingConfig,
        aiConfig, setAiConfig, azureOpenAI, setAzureOpenAI,
        incidentTemplates, setIncidentTemplates,
        approvalChains, setApprovalChains, approvalInstances, setApprovalInstances,
        reportSchedules, setReportSchedules,
        customFields, setCustomFields, contracts, setContracts,
        automationRules, setAutomationRules,
        slaCalendars, setSlaCalendars,
        notifTemplates, setNotifTemplates,
        auditLogs, auditFilter, setAuditFilter, auditLoading,
        versionHistory, uatResults, uatRunning, uatLastRun,
        setUatResults, setUatRunning, setUatLastRun,
        tourStep, runtimeConfig, profilePhoto, profilePhotoRef,
        avatarConfig, notifPrefs, cardVisibility,
        wsConnected, globalLastSync, globalSyncActive, prodTestMode,
        aiPipelineStats, modal, setModal, recycleBin, setRecycleBin,
        wfAnimStep, setWfAnimStep, wfAnimPlaying, setWfAnimPlaying,
        historicalCloseCutoff, setHistoricalCloseCutoff,
        setVendors, setSearch, zdStats, zdConnected, zdAiQueue, zdAutoMode,
      }} />);
      case "productivity": return (<ProductivityDashboard changes={changes} incidents={incidents} smartTasks={smartTasks} setSmartTasks={setSmartTasks} _save={_save} productivityView={productivityView} setProductivityView={setProductivityView} />);
      default: return (<DashboardModule ctx={dashboardCtx} />);
    }
  };

  const moduleTitle = NAV.find(n => n.id === activeModule)?.label || ({ incidents: "Tickets", zendesk: "Tickets", operations: "Tickets", problems: "Tickets", changes: "Tickets", requests: "Tickets", sla: "SLA & Approvals", approvals: "SLA & Approvals", reports: "Analytics", cybernews: "Analytics", architecture: "Analytics" })[activeModule] || "Dashboard";

  // ─── Login Page (extracted to src/modules/LoginPage.jsx) ──
  if (!isLoggedIn || !currentUser) {
    return <LoginPage localUsername={localUsername} setLocalUsername={setLocalUsername} localPassword={localPassword} setLocalPassword={setLocalPassword} localLoginError={localLoginError} setLocalLoginError={setLocalLoginError} localLoginLoading={localLoginLoading} setLocalLoginLoading={setLocalLoginLoading} setCurrentUser={setCurrentUser} setIsLoggedIn={setIsLoggedIn} setErrorAdvisory={setErrorAdvisory} msalInstance={msalInstance} />;
  }

  // ─── Setup Wizard Modal ─────────────────────────────────────────────
  if (showSetupWizard) {
    const wizardSteps = ["Welcome", "Company Info", "Business Hours", "Complete"];
    const submitSetup = async () => {
      try {
        const r = await fetch("/api/setup/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(setupData) });
        if (r.ok) { setShowSetupWizard(false); window.location.reload(); }
      } catch (e) { console.error("Setup error:", e); }
    };
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#09090B", color: "#FAFAFA", fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ background: "#111318", borderRadius: 16, padding: 40, maxWidth: 520, width: "100%", border: "1px solid #1E2030" }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🚀</div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>ITSM Setup Wizard</h1>
            <p style={{ color: "#71717A", fontSize: 13, marginTop: 6 }}>Step {setupStep + 1} of {wizardSteps.length}: {wizardSteps[setupStep]}</p>
            <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 12 }}>
              {wizardSteps.map((_, i) => <div key={i} style={{ width: 40, height: 4, borderRadius: 2, background: i <= setupStep ? "#6366F1" : "#27272A" }} />)}
            </div>
          </div>
          {setupStep === 0 && <div style={{ textAlign: "center" }}>
            <p style={{ color: "#A1A1AA", fontSize: 14, lineHeight: 1.6 }}>Welcome! Let's set up your ITSM environment.<br/>This will configure your organization details, business hours, and SLA policies.</p>
            <button onClick={() => setSetupStep(1)} style={{ marginTop: 20, padding: "10px 32px", background: "#6366F1", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Get Started</button>
          </div>}
          {setupStep === 1 && <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ fontSize: 13, color: "#A1A1AA" }}>Company Name *
              <input value={setupData.companyName} onChange={e => setSetupData(p => ({ ...p, companyName: e.target.value }))} style={{ display: "block", width: "100%", marginTop: 4, padding: "8px 12px", background: "#1A1D27", border: "1px solid #27272A", borderRadius: 6, color: "#fff", fontSize: 14, boxSizing: "border-box" }} />
            </label>
            <label style={{ fontSize: 13, color: "#A1A1AA" }}>Short Name
              <input value={setupData.companyShortName} onChange={e => setSetupData(p => ({ ...p, companyShortName: e.target.value }))} placeholder="e.g. ACME" style={{ display: "block", width: "100%", marginTop: 4, padding: "8px 12px", background: "#1A1D27", border: "1px solid #27272A", borderRadius: 6, color: "#fff", fontSize: 14, boxSizing: "border-box" }} />
            </label>
            <label style={{ fontSize: 13, color: "#A1A1AA" }}>Admin Email
              <input value={setupData.adminEmail} onChange={e => setSetupData(p => ({ ...p, adminEmail: e.target.value }))} type="email" style={{ display: "block", width: "100%", marginTop: 4, padding: "8px 12px", background: "#1A1D27", border: "1px solid #27272A", borderRadius: 6, color: "#fff", fontSize: 14, boxSizing: "border-box" }} />
            </label>
            <label style={{ fontSize: 13, color: "#A1A1AA" }}>Logo URL (optional)
              <input value={setupData.logoUrl} onChange={e => setSetupData(p => ({ ...p, logoUrl: e.target.value }))} placeholder="https://..." style={{ display: "block", width: "100%", marginTop: 4, padding: "8px 12px", background: "#1A1D27", border: "1px solid #27272A", borderRadius: 6, color: "#fff", fontSize: 14, boxSizing: "border-box" }} />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={() => setSetupStep(0)} style={{ flex: 1, padding: "10px", background: "#27272A", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, cursor: "pointer" }}>Back</button>
              <button onClick={() => setSetupStep(2)} disabled={!setupData.companyName} style={{ flex: 1, padding: "10px", background: setupData.companyName ? "#6366F1" : "#3F3F46", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Next</button>
            </div>
          </div>}
          {setupStep === 2 && <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ fontSize: 13, color: "#A1A1AA" }}>Timezone
              <select value={setupData.timezone} onChange={e => setSetupData(p => ({ ...p, timezone: e.target.value }))} style={{ display: "block", width: "100%", marginTop: 4, padding: "8px 12px", background: "#1A1D27", border: "1px solid #27272A", borderRadius: 6, color: "#fff", fontSize: 14 }}>
                <option value="Asia/Singapore">Asia/Singapore (SGT, UTC+8)</option>
                <option value="Asia/Kuala_Lumpur">Asia/Kuala_Lumpur (MYT, UTC+8)</option>
                <option value="Asia/Hong_Kong">Asia/Hong_Kong (HKT, UTC+8)</option>
                <option value="Asia/Jakarta">Asia/Jakarta (WIB, UTC+7)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (JST, UTC+9)</option>
                <option value="Australia/Sydney">Australia/Sydney (AEST, UTC+10/11)</option>
              </select>
            </label>
            <div style={{ display: "flex", gap: 12 }}>
              <label style={{ flex: 1, fontSize: 13, color: "#A1A1AA" }}>Start Hour
                <input type="number" min={0} max={23} value={setupData.businessHoursStart} onChange={e => setSetupData(p => ({ ...p, businessHoursStart: parseInt(e.target.value) || 9 }))} style={{ display: "block", width: "100%", marginTop: 4, padding: "8px 12px", background: "#1A1D27", border: "1px solid #27272A", borderRadius: 6, color: "#fff", fontSize: 14, boxSizing: "border-box" }} />
              </label>
              <label style={{ flex: 1, fontSize: 13, color: "#A1A1AA" }}>End Hour
                <input type="number" min={0} max={23} value={setupData.businessHoursEnd} onChange={e => setSetupData(p => ({ ...p, businessHoursEnd: parseInt(e.target.value) || 18 }))} style={{ display: "block", width: "100%", marginTop: 4, padding: "8px 12px", background: "#1A1D27", border: "1px solid #27272A", borderRadius: 6, color: "#fff", fontSize: 14, boxSizing: "border-box" }} />
              </label>
            </div>
            <label style={{ fontSize: 13, color: "#A1A1AA" }}>Business Days
              <select value={setupData.businessDays} onChange={e => setSetupData(p => ({ ...p, businessDays: e.target.value }))} style={{ display: "block", width: "100%", marginTop: 4, padding: "8px 12px", background: "#1A1D27", border: "1px solid #27272A", borderRadius: 6, color: "#fff", fontSize: 14 }}>
                <option value="Mon-Fri">Monday – Friday</option>
                <option value="Mon-Sat">Monday – Saturday</option>
                <option value="24/7">24/7</option>
              </select>
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={() => setSetupStep(1)} style={{ flex: 1, padding: "10px", background: "#27272A", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, cursor: "pointer" }}>Back</button>
              <button onClick={() => setSetupStep(3)} style={{ flex: 1, padding: "10px", background: "#6366F1", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Next</button>
            </div>
          </div>}
          {setupStep === 3 && <div style={{ textAlign: "center" }}>
            <div style={{ background: "#1A1D27", borderRadius: 8, padding: 16, marginBottom: 16, textAlign: "left", fontSize: 13 }}>
              <div style={{ color: "#A1A1AA" }}>Company: <span style={{ color: "#fff" }}>{setupData.companyName}</span></div>
              <div style={{ color: "#A1A1AA", marginTop: 4 }}>Admin: <span style={{ color: "#fff" }}>{setupData.adminEmail || "—"}</span></div>
              <div style={{ color: "#A1A1AA", marginTop: 4 }}>Hours: <span style={{ color: "#fff" }}>{setupData.businessHoursStart}:00 – {setupData.businessHoursEnd}:00 ({setupData.businessDays})</span></div>
              <div style={{ color: "#A1A1AA", marginTop: 4 }}>Timezone: <span style={{ color: "#fff" }}>{setupData.timezone}</span></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setSetupStep(2)} style={{ flex: 1, padding: "10px", background: "#27272A", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, cursor: "pointer" }}>Back</button>
              <button onClick={submitSetup} style={{ flex: 1, padding: "10px", background: "#22C55E", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Complete Setup</button>
            </div>
          </div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh", background: "#09090B",
      color: "#FAFAFA", fontFamily: "'DM Sans', -apple-system, sans-serif",
      overflow: "hidden"
    }}>
      {/* Skip link — keyboard users can Tab to jump past the sidebar */}
      <a href="#main-content" style={{
        position: "absolute", left: "-9999px", top: "auto",
        width: "1px", height: "1px", overflow: "hidden",
        zIndex: 9999, background: "#6366F1", color: "#fff",
        padding: "8px 16px", borderRadius: 4, fontSize: 13,
        fontWeight: 600, textDecoration: "none"
      }}
      onFocus={e => { e.currentTarget.style.position = "fixed"; e.currentTarget.style.left = "16px"; e.currentTarget.style.top = "16px"; e.currentTarget.style.width = "auto"; e.currentTarget.style.height = "auto"; }}
      onBlur={e => { e.currentTarget.style.position = "absolute"; e.currentTarget.style.left = "-9999px"; e.currentTarget.style.width = "1px"; e.currentTarget.style.height = "1px"; }}
      >Skip to main content</a>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #27272A; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #3F3F46; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes flowDot { 0% { left: 0; opacity: 0; } 20% { opacity: 1; } 80% { opacity: 1; } 100% { left: 20px; opacity: 0; } }
        @keyframes flowDotDown { 0% { top: 0; opacity: 0; } 20% { opacity: 1; } 80% { opacity: 1; } 100% { top: 16px; opacity: 0; } }
        @keyframes logoGradient { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        @keyframes logoGlow { 0%, 100% { box-shadow: 0 0 8px #FFD70033, 0 0 18px #D4AF371A, inset 0 0 0 1px #FFD70022; filter: brightness(1); } 50% { box-shadow: 0 0 16px #FFD70066, 0 0 30px #D4AF3733, 0 0 44px #B8860B1A, inset 0 0 0 1px #FFD70044; filter: brightness(1.08); } }
        @keyframes logoPulseRing { 0% { transform: scale(0.98); opacity: 0; } 18% { opacity: 0.42; } 72% { transform: scale(1.18); opacity: 0; } 100% { transform: scale(1.18); opacity: 0; } }
        @keyframes logoSheen { 0% { transform: translateX(-130%) skewX(-20deg); opacity: 0; } 38% { opacity: 0; } 52% { opacity: 0.55; } 70% { opacity: 0.25; } 100% { transform: translateX(230%) skewX(-20deg); opacity: 0; } }
        @keyframes logoTextShimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
        @keyframes orbitDot { 0% { transform: rotate(0deg) translateX(28px) rotate(0deg); } 100% { transform: rotate(360deg) translateX(28px) rotate(-360deg); } }
        @keyframes goldVBounce { 0%, 100% { transform: scale(1) translateY(0); text-shadow: 0 0 8px #FFD70044, 0 0 16px #D4AF371A; filter: brightness(1); } 50% { transform: scale(1.035) translateY(-1px); text-shadow: 0 0 14px #FFD70088, 0 0 26px #D4AF3744, 0 0 36px #FFD7001A; filter: brightness(1.12); } }
        @keyframes goldShimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
        @keyframes nudgeSlideIn { 0% { transform: translateY(8px) scale(0.95); opacity: 0; } 100% { transform: translateY(0) scale(1); opacity: 1; } }
        @keyframes nudgePulse { 0%, 100% { box-shadow: 0 2px 12px #6366F122; } 50% { box-shadow: 0 4px 20px #6366F144, 0 0 30px #06B6D422; } }
        @keyframes aiFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        @keyframes aiBreathe { 0%, 100% { transform: scale(1); filter: brightness(1); } 50% { transform: scale(1.025); filter: brightness(1.08); } }
        @keyframes aiBounce { 0%, 100% { transform: translateY(0) scale(1); } 45% { transform: translateY(-3px) scale(1.01); } 70% { transform: translateY(-1px) scale(1); } }
        @keyframes aiSmartPulse { 0%, 100% { box-shadow: 0 8px 24px var(--ai-glow-soft, #6366F144), 0 0 36px var(--ai-glow-faint, #6366F122); filter: brightness(1); } 33% { box-shadow: 0 9px 26px #06B6D444, 0 0 40px #6366F122; filter: brightness(1.05); } 66% { box-shadow: 0 9px 26px #EC489933, 0 0 38px #06B6D422; filter: brightness(1.04); } }
        @keyframes aiNeonBorder { 0%, 100% { border-color: #6366F188; box-shadow: 0 0 8px #6366F144, inset 0 0 8px #6366F111; } 25% { border-color: #06B6D488; box-shadow: 0 0 8px #06B6D444, inset 0 0 8px #06B6D411; } 50% { border-color: #EC489988; box-shadow: 0 0 8px #EC489944, inset 0 0 8px #EC489911; } 75% { border-color: #81C78488; box-shadow: 0 0 8px #81C78444, inset 0 0 8px #81C78411; } }
        @keyframes aiSparkle { 0%, 100% { opacity: 0; transform: scale(0) rotate(0deg); } 50% { opacity: 1; transform: scale(1) rotate(180deg); } }
        @keyframes aiThinkingRing { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes aiStatusOrbit { 0% { transform: rotate(0deg) translateX(32px) rotate(0deg); } 100% { transform: rotate(360deg) translateX(32px) rotate(-360deg); } }
        @keyframes proactiveSlideIn { 0% { transform: translateX(120%); opacity: 0; } 100% { transform: translateX(0); opacity: 1; } }
        @keyframes proactiveUrgent { 0%, 100% { border-color: #FF6B6B44; box-shadow: 0 0 8px #FF6B6B22; } 50% { border-color: #FF6B6B88; box-shadow: 0 0 20px #FF6B6B44, 0 0 40px #FF6B6B22; } }
        @keyframes aiBorderPulse { 0%, 100% { border-color: #6366F133; } 50% { border-color: #6366F166; } }
        @keyframes iconBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
        @keyframes iconSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes avatarBlink { 0%, 90%, 100% { transform: scaleY(1); } 95% { transform: scaleY(0.1); } }
        @keyframes slideInRight { 0% { transform: translateX(100%); opacity: 0; } 100% { transform: translateX(0); opacity: 1; } }
        @keyframes threatAutoClose { from { width: 100%; } to { width: 0%; } }
        @keyframes aiShimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes aiPulseGlow { 0%, 100% { box-shadow: 0 0 8px #6366F122, 0 0 20px #06B6D411; } 50% { box-shadow: 0 0 16px #6366F144, 0 0 40px #06B6D422, 0 0 60px #EC489911; } }
        @keyframes tourFadeIn { 0% { opacity: 0; transform: scale(0.92) translateY(8px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes tourBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes tourSpotlight { 0%, 100% { box-shadow: 0 0 0 4px #6366F133, 0 0 0 8px #6366F111; } 50% { box-shadow: 0 0 0 6px #6366F155, 0 0 0 14px #6366F122; } }
        @keyframes tourWave { 0% { transform: rotate(0deg); } 15% { transform: rotate(14deg); } 30% { transform: rotate(-8deg); } 40% { transform: rotate(10deg); } 50% { transform: rotate(-4deg); } 60% { transform: rotate(6deg); } 100% { transform: rotate(0deg); } }
        @keyframes tourConfetti { 0% { transform: translateY(0) rotate(0deg); opacity: 1; } 100% { transform: translateY(-30px) rotate(720deg); opacity: 0; } }
        @keyframes tourProgressFill { from { width: 0; } }
        @keyframes headerTitleGlow { 0% { text-shadow: 0 0 8px rgba(99,102,241,0.3); } 50% { text-shadow: 0 0 16px rgba(6,182,212,0.4), 0 0 30px rgba(99,102,241,0.2); } 100% { text-shadow: 0 0 8px rgba(99,102,241,0.3); } }
        @keyframes bellShake { 0% { transform: rotate(0); } 15% { transform: rotate(12deg); } 30% { transform: rotate(-10deg); } 45% { transform: rotate(8deg); } 60% { transform: rotate(-6deg); } 75% { transform: rotate(3deg); } 100% { transform: rotate(0); } }
        @keyframes alertSlideDown { 0% { opacity: 0; transform: translateY(-10px) scale(0.96); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes criticalGlow { 0%, 100% { box-shadow: 0 0 4px #FF444422; border-color: #FF444433; } 50% { box-shadow: 0 0 14px #FF444455, 0 0 28px #FF444422; border-color: #FF444466; } }
        @keyframes criticalBadgePulse { 0%, 100% { transform: scale(1); box-shadow: 0 0 4px #FF444444; } 50% { transform: scale(1.15); box-shadow: 0 0 12px #FF444488; } }
        @keyframes emojiBounce { 0%, 100% { transform: translateY(0) scale(1); } 25% { transform: translateY(-2px) scale(1.12); } 50% { transform: translateY(0) scale(1); } }
        @keyframes highlightPulse { 0%, 100% { background: #FF6B6B11; } 50% { background: #FF6B6B22; } }
        @keyframes sidebarCollapseHover { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.15); } }
        @keyframes warningGlow { 0%, 100% { box-shadow: 0 0 4px #FFB34722; border-color: #FFB34733; } 50% { box-shadow: 0 0 10px #FFB34744, 0 0 20px #FFB34722; border-color: #FFB34755; } }
        @keyframes criticalRowFlash { 0%, 100% { background: #1A080866; } 50% { background: #2D0A0A88; } }
        @keyframes slaBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes slaBlinkFast { 0%, 100% { opacity: 1; } 50% { opacity: 0.15; } }
        @keyframes slaBreachPulse { 0%, 100% { color: #FF4444; text-shadow: 0 0 4px #FF444444; } 50% { color: #FF6666; text-shadow: 0 0 12px #FF444488, 0 0 24px #FF444444; } }
        @keyframes wfIconPulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.12); opacity: 0.85; } }
        @keyframes wfCardFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes wfPulseLive { 0%, 100% { transform: scale(1); opacity: 0.7; } 50% { transform: scale(1.5); opacity: 1; } }
        @keyframes gradientSlide { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
        @keyframes subtleFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        @keyframes archNodeGlow { 0%, 100% { box-shadow: 0 0 16px #818CF844, 0 0 32px #22D3EE22; } 50% { box-shadow: 0 0 24px #818CF866, 0 0 48px #22D3EE44; } }
        @keyframes archDataFlow { 0% { left: 0; opacity: 0; } 20% { opacity: 1; } 80% { opacity: 1; } 100% { left: 40px; opacity: 0; } }
        @keyframes archHubOrbit { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes weatherSunPulse { 0%, 100% { transform: scale(1); filter: brightness(1); } 50% { transform: scale(1.08); filter: brightness(1.15); } }
        @keyframes weatherRayPulse { 0%, 100% { opacity: 0.6; transform: scaleY(1); } 50% { opacity: 1; transform: scaleY(1.3); } }
        @keyframes weatherMoonGlow { 0%, 100% { filter: brightness(1) drop-shadow(0 0 4px rgba(200,210,255,0.3)); } 50% { filter: brightness(1.15) drop-shadow(0 0 10px rgba(200,210,255,0.6)); } }
        @keyframes weatherStarTwinkle { 0%, 100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.4); } }
        @keyframes weatherCloudDrift { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(3px); } }
        @keyframes disasterSlideIn { 0% { transform: translateX(120%); opacity: 0; } 60% { transform: translateX(-8px); opacity: 1; } 100% { transform: translateX(0); opacity: 1; } }
        @keyframes disasterSlideOut { 0% { transform: translateX(0); opacity: 1; } 100% { transform: translateX(120%); opacity: 0; } }
        @keyframes disasterIconPulse { 0%, 100% { transform: scale(1); } 30% { transform: scale(1.3) rotate(-5deg); } 60% { transform: scale(1.1) rotate(5deg); } }
        @keyframes disasterGlow { 0%, 100% { box-shadow: 0 4px 20px rgba(255,68,68,0.15), inset 0 1px 0 rgba(255,255,255,0.05); } 50% { box-shadow: 0 4px 30px rgba(255,68,68,0.35), 0 0 40px rgba(255,68,68,0.1), inset 0 1px 0 rgba(255,255,255,0.05); } }
        @keyframes disasterProgress { 0% { width: 100%; } 100% { width: 0%; } }
        @keyframes disasterFadeOut { 0% { opacity: 1; transform: translateX(0); } 100% { opacity: 0; transform: translateX(120%); } }
        @keyframes escalationBannerGlow { 0%, 100% { box-shadow: 0 4px 20px rgba(255,68,68,0.1); } 50% { box-shadow: 0 4px 40px rgba(255,68,68,0.3), 0 0 60px rgba(255,68,68,0.08); } }
        @keyframes escalationIconPulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.15); opacity: 0.85; } }
        @keyframes escalationTextBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        .vgc-logo-box { position: relative; overflow: hidden; animation: logoGradient 12s ease-in-out infinite, logoGlow 8s ease-in-out infinite; transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.35s ease; will-change: transform, box-shadow; }
        .vgc-logo-box::after { content: ''; position: absolute; top: 0; left: 0; width: 35%; height: 100%; background: linear-gradient(120deg, transparent, rgba(255,248,220,0.45), transparent); animation: logoSheen 8s ease-in-out 1.2s infinite; pointer-events: none; mix-blend-mode: screen; }
        .vgc-logo-box:hover { transform: scale(1.06) rotate(-1.5deg); box-shadow: 0 0 22px #FFD70088, 0 0 44px #D4AF3744; }
        .vgc-logo-text { background: linear-gradient(90deg, #FFD700, #FFF8DC, #D4AF37, #B8860B, #FFD700); background-size: 300% auto; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; animation: logoTextShimmer 9s linear infinite; letter-spacing: 0; }
        .vgc-logo-collapsed { position: relative; overflow: hidden; animation: logoGradient 12s ease-in-out infinite, logoGlow 8s ease-in-out infinite; transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1); will-change: transform; }
        .vgc-logo-collapsed::after { content: ''; position: absolute; top: 0; left: 0; width: 35%; height: 100%; background: linear-gradient(120deg, transparent, rgba(255,248,220,0.42), transparent); animation: logoSheen 8s ease-in-out 1.2s infinite; pointer-events: none; mix-blend-mode: screen; }
        .vgc-logo-collapsed:hover { transform: scale(1.10); }
        select { appearance: none; background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23A1A1AA' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e"); background-repeat: no-repeat; background-position: right 8px center; background-size: 14px; padding-right: 28px !important; }
        option { background: #09090B; color: #FAFAFA; }

        /* ─── Sidebar Glassy Nav Items ─── */
        .vgc-nav-btn { position: relative; overflow: hidden; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); background: linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01)) !important; border: 1px solid rgba(255,255,255,0.04) !important; border-left: 2px solid var(--nav-accent, transparent) !important; margin-bottom: 2px !important; }
        .vgc-nav-btn::before { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, var(--nav-accent, #6366F1)08, transparent); opacity: 0.5; transition: opacity 0.3s; }
        .vgc-nav-btn:hover { background: linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)) !important; border-color: rgba(255,255,255,0.08) !important; }
        .vgc-nav-btn:hover::before { opacity: 1; }
        .vgc-nav-btn::after { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent); }
        .vgc-nav-active { background: linear-gradient(135deg, color-mix(in srgb, var(--nav-accent, #6366F1) 12%, transparent), color-mix(in srgb, var(--nav-accent, #6366F1) 6%, transparent)) !important; border-left: 2px solid var(--nav-accent, #6366F1) !important; border-color: color-mix(in srgb, var(--nav-accent, #6366F1) 20%, transparent) !important; box-shadow: inset 0 0 20px color-mix(in srgb, var(--nav-accent, #6366F1) 8%, transparent), 0 0 16px color-mix(in srgb, var(--nav-accent, #6366F1) 10%, transparent); }
        .vgc-nav-active::after { background: linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent) !important; }

        /* ─── Responsive Breakpoints ─── */
        @media (max-width: 1024px) {
          .vgc-kpi-grid-6 { grid-template-columns: repeat(3, 1fr) !important; }
          .vgc-kpi-grid-5 { grid-template-columns: repeat(3, 1fr) !important; }
          .vgc-kpi-grid-3 { grid-template-columns: 1fr 1fr !important; }
          .vgc-grid-2-1 { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 768px) {
          .vgc-kpi-grid-6 { grid-template-columns: repeat(2, 1fr) !important; }
          .vgc-kpi-grid-5 { grid-template-columns: repeat(2, 1fr) !important; }
          .vgc-kpi-grid-3 { grid-template-columns: 1fr !important; }
          .vgc-donut-grid { grid-template-columns: repeat(3, 1fr) !important; }
          .vgc-sidebar { position: fixed !important; z-index: 900; height: 100vh !important; box-shadow: 4px 0 24px rgba(0,0,0,0.5) !important; }
          .vgc-sidebar.collapsed { width: 0 !important; padding: 0 !important; border: none !important; }
          .vgc-mobile-toggle { display: flex !important; }
        }
        @media (max-width: 480px) {
          .vgc-kpi-grid-6 { grid-template-columns: 1fr !important; }
          .vgc-kpi-grid-5 { grid-template-columns: 1fr !important; }
          .vgc-donut-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        /* Respect user preference to reduce motion (accessibility) */
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
        /* Print styles */
        @media print {
          .vgc-sidebar, .vgc-mobile-toggle, .sidebar-collapse-btn { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>

      {/* ─── Production Test Mode Banner ──────────────────────────────────── */}
      {prodTestMode && (
        <div style={{
          flexShrink: 0, zIndex: 9999,
          background: "linear-gradient(90deg, #F59E0B, #D97706, #F59E0B)",
          color: "#1A1A1A", textAlign: "center", padding: "6px 16px",
          fontSize: 12, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif",
          letterSpacing: 0.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
          boxShadow: "0 2px 12px rgba(245, 158, 11, 0.4)"
        }}>
          <span style={{ fontSize: 14 }}>⚠</span>
          <span>PRODUCTION TEST MODE — All emails redirected to itsupport@vgctechnology.com • AI Pipeline: Full Auto • ZD→ITSM: One-Way Sync</span>
          <span style={{ fontSize: 14 }}>⚠</span>
        </div>
      )}

      {/* Main Layout Row */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* Sidebar */}
      <div className={`vgc-sidebar${sideCollapsed ? ' collapsed' : ''}`} style={{
        width: sideCollapsed ? 56 : 240, background: "linear-gradient(180deg, #09090B 0%, #0C0D12 50%, #09090B 100%)",
        borderRight: "1px solid #27272A66", display: "flex", flexDirection: "column",
        transition: "width 0.25s cubic-bezier(0.4, 0, 0.2, 1)", flexShrink: 0, overflow: "hidden",
        backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        boxShadow: "1px 0 16px rgba(0,0,0,0.3), inset -1px 0 0 rgba(255,255,255,0.02)"
      }}>
        <div style={{
          padding: sideCollapsed ? "16px 12px" : "16px 18px",
          borderBottom: "1px solid #1E2130",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          minHeight: 68
        }}>
          {!sideCollapsed ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div className="vgc-logo-box" style={{
                width: 62, height: 62, borderRadius: 16, position: "relative",
                background: "linear-gradient(135deg, #D4AF37, #FFD700, #B8860B, #F59E0B, #D4AF37)",
                backgroundSize: "300% 300%",
                animation: "logoGradient 12s ease-in-out infinite, logoGlow 8s ease-in-out infinite",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", flexShrink: 0
              }}>
                {/* Inner dark shield */}
                <div style={{
                  width: 52, height: 52, borderRadius: 12,
                  background: "radial-gradient(ellipse at 30% 30%, #141620, #0A0C14)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  position: "relative", overflow: "hidden"
                }}>
                  {/* Circuit pattern accent */}
                  <div style={{ position: "absolute", top: 4, left: 6, width: 14, height: 1, background: "#FFD70033", borderRadius: 1 }} />
                  <div style={{ position: "absolute", bottom: 5, right: 6, width: 12, height: 1, background: "#D4AF3733", borderRadius: 1 }} />
                  <div style={{ position: "absolute", top: 8, right: 5, width: 1, height: 12, background: "#FFD70022", borderRadius: 1 }} />
                  <div style={{ position: "absolute", bottom: 8, left: 5, width: 1, height: 10, background: "#D4AF3722", borderRadius: 1 }} />
                  <span style={{
                    fontSize: 26, fontWeight: 900, fontFamily: "'Space Grotesk', sans-serif",
                    background: "linear-gradient(135deg, #FFD700, #D4AF37, #FFF8DC, #FFD700, #B8860B)",
                    backgroundSize: "300% 300%",
                    animation: "goldVBounce 7s ease-in-out infinite, goldShimmer 10s linear infinite",
                    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                    backgroundClip: "text", letterSpacing: "-0.5px",
                    display: "inline-block"
                  }}>V</span>
                </div>
                {/* Orbiting dot */}
                <div style={{
                  position: "absolute", width: 5, height: 5, borderRadius: "50%",
                  background: "#FFD700", boxShadow: "0 0 8px #FFD700, 0 0 16px #D4AF3744",
                  animation: "orbitDot 16s linear infinite",
                  top: "calc(50% - 2.5px)", left: "calc(50% - 2.5px)"
                }} />
                {/* Pulse ring */}
                <div style={{
                  position: "absolute", inset: -4, borderRadius: 20,
                  border: "1.5px solid #FFD70033",
                  animation: "logoPulseRing 8s ease-in-out infinite"
                }} />
              </div>
              <div>
                <span className="vgc-logo-text" style={{
                  fontSize: 20, fontWeight: 800, fontFamily: "'Space Grotesk', sans-serif",
                  letterSpacing: "-0.5px", display: "block", lineHeight: 1.1
                }}>VGC-ITSM</span>
                <span style={{ fontSize: 9, color: "#5A617899", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "1.5px", textTransform: "uppercase" }}>Service Management</span>
                <span style={{ fontSize: 7, color: "#5A617855", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.3px", display: "block", marginTop: 2 }}>Developed by VGC Technology Pte Ltd</span>
                {/* Data Mode Indicator — Hard Rule */}
                <span style={{
                  fontSize: 7, fontWeight: 700, padding: "1px 6px", borderRadius: 4, display: "inline-block", marginTop: 3,
                  fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.5px",
                  background: "#4CAF5022",
                  color: "#4CAF50",
                  border: "1px solid #4CAF5033"
                }}>PRODUCTION</span>
              </div>
            </div>
          ) : (
            <div className="vgc-logo-collapsed" style={{
              width: 42, height: 42, borderRadius: 12, margin: "0 auto",
              background: "linear-gradient(135deg, #D4AF37, #FFD700, #B8860B, #F59E0B, #D4AF37)",
              backgroundSize: "300% 300%",
              animation: "logoGradient 12s ease-in-out infinite, logoGlow 8s ease-in-out infinite",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", position: "relative"
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: 8, background: "radial-gradient(ellipse at 30% 30%, #141620, #0A0C14)",
                display: "flex", alignItems: "center", justifyContent: "center"
              }}>
                <span style={{
                  fontSize: 18, fontWeight: 900, fontFamily: "'Space Grotesk', sans-serif",
                  background: "linear-gradient(135deg, #FFD700, #D4AF37, #FFF8DC, #FFD700, #B8860B)",
                  backgroundSize: "300% 300%",
                  animation: "goldVBounce 7s ease-in-out infinite, goldShimmer 10s linear infinite",
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                  backgroundClip: "text", display: "inline-block"
                }}>V</span>
              </div>
              <div style={{
                position: "absolute", width: 4, height: 4, borderRadius: "50%",
                background: "#FFD700", boxShadow: "0 0 6px #FFD700, 0 0 12px #D4AF3744",
                animation: "orbitDot 16s linear infinite",
                top: "calc(50% - 2px)", left: "calc(50% - 2px)"
              }} />
              {/* Data mode dot indicator on collapsed sidebar */}
              <div style={{ width: 6, height: 6, borderRadius: "50%", margin: "6px auto 0", background: "#4CAF50", boxShadow: "0 0 6px #4CAF5088" }} title="Production" />
            </div>
          )}
          <button onClick={() => setSideCollapsed(!sideCollapsed)} className="sidebar-collapse-btn" style={{
            width: 30, height: 30, borderRadius: 8,
            background: "linear-gradient(135deg, #6366F122, #06B6D411)",
            border: "1px solid #6366F133", color: "#6366F1",
            cursor: "pointer", fontSize: 14, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.3s cubic-bezier(0.34,1.56,0.64,1)",
            boxShadow: "0 2px 8px #6366F111"
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "linear-gradient(135deg, #6366F144, #06B6D422)"; e.currentTarget.style.transform = "scale(1.15)"; e.currentTarget.style.boxShadow = "0 4px 16px #6366F133"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "linear-gradient(135deg, #6366F122, #06B6D411)"; e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 2px 8px #6366F111"; }}
          aria-label={sideCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >{sideCollapsed ? "▸" : "◂"}</button>
        </div>

        <nav role="navigation" aria-label="Main navigation" style={{ flex: 1, padding: "8px 0", overflowY: "auto" }}>
          {(currentUser.rbacRole === "End User" ? [
            { id: "selfService", label: "Self-Service Portal", accent: "#6366F1", gradient: "linear-gradient(135deg, #6366F108, #6366F118)" },
            { id: "knowledge", label: "Knowledge Base", accent: "#0078D4", gradient: "linear-gradient(135deg, #0078D408, #0089D618)" },
            { id: "catalog", label: "Service Catalog", accent: "#64B5F6", gradient: "linear-gradient(135deg, #64B5F608, #64B5F618)" },
          ] : NAV).map((item, idx) => {
            if (item.section) {
              return !sideCollapsed ? (
                <div key={`sec-${idx}`} style={{ padding: "10px 16px 4px", fontSize: 9, fontWeight: 700, color: "#3A3F55", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "1.5px", textTransform: "uppercase" }}>{item.section}</div>
              ) : (
                <div key={`sec-${idx}`} style={{ height: 1, background: "#1E213044", margin: "6px 8px" }} />
              );
            }
            const isActive = activeModule === item.id;
            return (
            <React.Fragment key={item.id}>
            <button className={`vgc-nav-btn${isActive ? ' vgc-nav-active' : ''}`}
              onClick={() => { setActiveModule(item.id); setSearch(""); setNavExplainId(null); }}
              style={{
                "--nav-accent": item.accent,
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: sideCollapsed ? "11px 0" : "11px 16px",
                margin: sideCollapsed ? "2px 0" : "2px 8px 2px 0",
                borderRadius: sideCollapsed ? 0 : "0 8px 8px 0",
                justifyContent: sideCollapsed ? "center" : "flex-start",
                background: isActive ? item.gradient : "transparent",
                border: "none", borderLeft: isActive ? `2px solid ${item.accent}` : "2px solid transparent",
                color: "#E8ECF4",
                cursor: "pointer", fontSize: 13, fontFamily: "inherit",
                transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)", whiteSpace: "nowrap",
                position: "relative"
              }}
              onMouseEnter={e => { if (!isActive) { e.currentTarget.style.borderLeftColor = item.accent + "88"; } }}
              onMouseLeave={e => { if (!isActive) { e.currentTarget.style.borderLeftColor = item.accent + "33"; } }}
            >
              <NavIcon type={item.id} isActive={isActive} />
              {!sideCollapsed && <span style={{ flex: 1, textAlign: "left", fontSize: 13, fontWeight: isActive ? 600 : 400 }}>{item.label}</span>}
              {!sideCollapsed && item.count > 0 && (
                <span style={{
                  background: item.critical ? "#FF4444" : `${item.accent}cc`,
                  color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 7px",
                  borderRadius: 10, fontFamily: "'JetBrains Mono', monospace", minWidth: 20, textAlign: "center",
                  animation: item.critical ? "criticalBadgePulse 1.5s ease-in-out infinite" : "none",
                  boxShadow: item.critical ? "0 0 8px #FF444466" : `0 0 6px ${item.accent}33`
                }}>{item.count}</span>
              )}
            </button>
            {!sideCollapsed && navExplainId === item.id && AI_FEATURE_EXPLAINERS[item.id] && (
              <div style={{ margin: "0 8px 4px 0", padding: "8px 12px", background: "linear-gradient(135deg, #6366F108, #6366F115)", borderRadius: "0 0 8px 8px", border: "1px solid #6366F133", borderTop: "none" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#6366F1", marginBottom: 3, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1 }}>💡 {AI_FEATURE_EXPLAINERS[item.id].title}</div>
                <div style={{ fontSize: 10, color: "#C4CAD6", lineHeight: 1.5 }}>{AI_FEATURE_EXPLAINERS[item.id].explain}</div>
              </div>
            )}
            </React.Fragment>
          );
          })}
        </nav>

        {!sideCollapsed && (
          <div style={{ padding: "14px 16px", borderTop: "1px solid #1E213066", background: "linear-gradient(180deg, transparent, rgba(99,102,241,0.03))" }}>
            <div onClick={() => setShowProfileModal(true)} role="button" tabIndex={0} aria-label="Open user profile"
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowProfileModal(true); } }}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.08)", backdropFilter: "blur(8px)", cursor: "pointer", transition: "all 0.2s" }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(99,102,241,0.12)"; e.currentTarget.style.borderColor = "rgba(99,102,241,0.2)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(99,102,241,0.06)"; e.currentTarget.style.borderColor = "rgba(99,102,241,0.08)"; }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10, position: "relative",
                background: profilePhoto ? `url(${profilePhoto}) center/cover no-repeat` : "linear-gradient(135deg, #6366F1, #06B6D4, #EC4899)",
                backgroundSize: profilePhoto ? "cover" : "200% 200%",
                animation: profilePhoto ? "none" : "logoGradient 5s ease infinite",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700, color: "#fff",
                boxShadow: "0 2px 8px rgba(99,102,241,0.3)"
              }}>{!profilePhoto && currentUser.avatar}
                <span style={{ position: "absolute", bottom: -2, right: -2, width: 10, height: 10, borderRadius: "50%", background: "#4CAF50", border: "2px solid #0A0C14", boxShadow: "0 0 4px #4CAF5066" }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#E8ECF4", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{msalUser?.displayName || currentUser.name}</div>
                <div style={{ fontSize: 10, color: "#EC4899", fontFamily: "'JetBrains Mono', monospace" }}>{msalUser?.jobTitle || currentUser.rbacRole}</div>
                <div style={{ fontSize: 8, color: isMsalAuthenticated ? "#4CAF50" : "#FFB347", fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 3 }}>
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: isMsalAuthenticated ? "#4CAF50" : "#FFB347", animation: "pulse 2s infinite" }} /> {isMsalAuthenticated ? "Entra ID Connected" : "Local Admin"}
                </div>
                {msalUser?.mail && <div style={{ fontSize: 7, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{msalUser.mail}</div>}
              </div>
            </div>
            {/* Sign Out */}
            <button aria-label="Sign out" onClick={() => {
              endPortalSession();
              setIsLoggedIn(false); setCurrentUser(null); _save("vgc_current_user", null);
              setMsalUser(null); setMsalPhoto(null); setProfilePhoto(null); setGraphEmails(null); setGraphCalendar(null);
              setGraphChats(null); setGraphTeams(null); setGraphPresence(null); setGraphUnread(0);
              graphFetchedRef.current = false;
              if (accounts && accounts.length > 0) {
                msalInstance.logoutPopup({ account: accounts[0] }).catch(() => {});
              }
            }} style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              width: "100%", marginTop: 8, padding: "7px 0", borderRadius: 8,
              background: "rgba(255,107,107,0.06)", border: "1px solid rgba(255,107,107,0.15)",
              color: "#FF6B6B", cursor: "pointer", fontSize: 11, fontWeight: 500,
              fontFamily: "'DM Sans', sans-serif", letterSpacing: 0.3,
              transition: "all 0.2s ease"
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,107,107,0.12)"; e.currentTarget.style.borderColor = "rgba(255,107,107,0.3)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,107,107,0.06)"; e.currentTarget.style.borderColor = "rgba(255,107,107,0.15)"; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Sign Out
            </button>
            <div style={{ textAlign: "center", marginTop: 8, fontSize: 8, color: "#5A617844", fontFamily: "'JetBrains Mono', monospace" }}>
              © {new Date().getFullYear()} VGC Technology Pte Ltd
            </div>
          </div>
        )}
      </div>

      {/* Main Content */}
      <main id="main-content" role="main" aria-label="Main content" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{
          padding: "12px 28px", borderBottom: "1px solid #1E2130",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: "#0A0C14", position: "relative"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* Mobile hamburger toggle — only visible below 768px */}
            <button className="vgc-mobile-toggle" aria-label="Toggle navigation menu" onClick={() => setSideCollapsed(!sideCollapsed)} style={{
              display: "none", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: 8,
              background: "#6366F118", border: "1px solid #6366F133",
              color: "#818CF8", cursor: "pointer", fontSize: 18, flexShrink: 0
            }}>☰</button>
            <h1 style={{
              fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: "-0.5px",
              fontFamily: "'Space Grotesk', sans-serif",
              background: activeModule === "dashboard" ? "linear-gradient(135deg, #6366F1, #06B6D4, #EC4899, #6366F1)" : "none",
              backgroundSize: activeModule === "dashboard" ? "300% auto" : "auto",
              WebkitBackgroundClip: activeModule === "dashboard" ? "text" : "unset",
              WebkitTextFillColor: activeModule === "dashboard" ? "transparent" : "#E8ECF4",
              backgroundClip: activeModule === "dashboard" ? "text" : "unset",
              animation: activeModule === "dashboard" ? "logoTextShimmer 4s linear infinite" : "none",
              filter: activeModule === "dashboard" ? "drop-shadow(0 0 12px rgba(99,102,241,0.3))" : "none"
            }}>{moduleTitle}</h1>
            {AI_FEATURE_EXPLAINERS[activeModule] && activeModule !== "dashboard" && (
              <button onClick={() => setNavExplainId(navExplainId === activeModule ? null : activeModule)} style={{
                background: navExplainId === activeModule ? "#6366F122" : "transparent", border: `1px solid ${navExplainId === activeModule ? "#6366F166" : "#1E213066"}`,
                borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 10, color: navExplainId === activeModule ? "#6366F1" : "#5A6178",
                display: "flex", alignItems: "center", gap: 4, transition: "all 0.2s", fontFamily: "'Space Grotesk', sans-serif"
              }}>🤖 How it works</button>
            )}
            {activeModule === "dashboard" && (
              <span style={{
                padding: "3px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                background: "linear-gradient(135deg, #6366F118, #06B6D418)",
                border: "1px solid #6366F133",
                color: "#06B6D4", letterSpacing: 0.5
              }}>AI-POWERED</span>
            )}
            <span style={{ fontSize: 9, color: "#3A3F55", fontFamily: "'JetBrains Mono', monospace", marginLeft: 4 }}>v{APP_VERSION.version}</span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {/* Language Switcher */}
            {(() => { const { locale, setLocale } = useLocale(); return ( // eslint-disable-line react-hooks/rules-of-hooks -- IIFE renders inline
              <select value={locale} onChange={e => setLocale(e.target.value)} title="Language" style={{
                background: "#0F1117", border: "1px solid #1E2130", borderRadius: 8,
                color: "#E8ECF4", fontSize: 11, padding: "6px 28px 6px 8px", cursor: "pointer",
                fontFamily: "'Space Grotesk', sans-serif", minWidth: 80
              }}>
                {SUPPORTED_LOCALES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            ); })()}
            {/* Glassy Singapore Weather + Date/Time */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10, padding: "7px 14px",
              background: "linear-gradient(135deg, rgba(100, 181, 246, 0.08), rgba(6, 182, 212, 0.06), rgba(129, 199, 132, 0.04))",
              backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
              border: "1px solid rgba(100, 181, 246, 0.15)", borderRadius: 10,
              cursor: "default", position: "relative", overflow: "hidden",
              boxShadow: "0 4px 16px rgba(100, 181, 246, 0.06), inset 0 1px 0 rgba(255,255,255,0.06)"
            }}>
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,0.04), transparent 60%)", pointerEvents: "none" }} />
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg, transparent, rgba(100,181,246,0.3), rgba(6,182,212,0.3), rgba(129,199,132,0.2), transparent)" }} />
              {/* Date & Time */}
              <div style={{ lineHeight: 1.2, position: "relative", textAlign: "right", minWidth: 80 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>
                  {new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit" })}
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", marginLeft: 3 }}>SGT</span>
                </div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", fontFamily: "'JetBrains Mono', monospace" }}>
                  {(() => { const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" })); const d = String(now.getDate()).padStart(2, "0"); const m = now.toLocaleString("en-US", { month: "short" }); const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]; return `${days[now.getDay()]}, ${d} ${m} ${now.getFullYear()}`; })()}
                </div>
              </div>
              <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)" }} />
              {/* Weather — dynamic time-aware */}
              {(() => {
                const sgNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
                const hr = sgNow.getHours();
                const isNight = hr >= 19 || hr < 6;
                const isDusk = hr >= 18 && hr < 19;
                const isDawn = hr >= 6 && hr < 7;
                const isMorning = hr >= 7 && hr < 11;
                const isMidday = hr >= 11 && hr < 14;
                const isAfternoon = hr >= 14 && hr < 18;
                const tempBase = isNight ? 25 : isDawn || isMorning ? 26 : isMidday ? 31 : isAfternoon ? 30 : 28;
                const temp = tempBase + (sgNow.getMinutes() % 2);
                const desc = isNight ? "Clear Night" : isDawn ? "Early Dawn" : isMorning ? "Partly Cloudy" : isMidday ? "Warm & Humid" : isAfternoon ? "Partly Cloudy" : isDusk ? "Sunset Glow" : "Fair";
                const humidity = isNight ? 85 : isMidday ? 72 : 78;
                const wind = isNight ? 8 : isAfternoon ? 14 : 11;
                const weatherIcon = isNight ? (
                  <svg width="26" height="26" viewBox="0 0 26 26" style={{ filter: "drop-shadow(0 0 6px rgba(200,210,255,0.5))" }}>
                    <defs>
                      <radialGradient id="moonGrd" cx="40%" cy="40%"><stop offset="0%" stopColor="#F0F4FF"/><stop offset="70%" stopColor="#C8D6FF"/><stop offset="100%" stopColor="#A0B4F0"/></radialGradient>
                    </defs>
                    <circle cx="13" cy="13" r="8" fill="url(#moonGrd)" style={{ animation: "weatherMoonGlow 4s ease-in-out infinite" }}/>
                    <circle cx="17" cy="10" r="6" fill="#0A0C14"/>
                    <circle cx="10" cy="11" r="1" fill="#A0B4F088" opacity="0.5"/>
                    <circle cx="12" cy="15" r="0.7" fill="#A0B4F066" opacity="0.4"/>
                    {[{x:4,y:4,r:0.6,d:"0.3s"},{x:22,y:6,r:0.5,d:"0.8s"},{x:6,y:21,r:0.4,d:"1.4s"},{x:23,y:19,r:0.5,d:"0.6s"},{x:2,y:13,r:0.3,d:"1.1s"},{x:20,y:24,r:0.4,d:"1.8s"}].map((s,i)=>(
                      <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#E8ECF4" style={{ animation: `weatherStarTwinkle 2.5s ease-in-out ${s.d} infinite` }}/>
                    ))}
                  </svg>
                ) : (isDusk || isDawn) ? (
                  <svg width="26" height="26" viewBox="0 0 26 26" style={{ filter: "drop-shadow(0 0 6px rgba(255,150,50,0.5))" }}>
                    <defs>
                      <radialGradient id="sunsetGrd" cx="50%" cy="50%"><stop offset="0%" stopColor="#FFD93D"/><stop offset="50%" stopColor="#FF8C42"/><stop offset="100%" stopColor="#FF6B6B"/></radialGradient>
                    </defs>
                    <circle cx="13" cy="15" r="6" fill="url(#sunsetGrd)" style={{ animation: "weatherSunPulse 3s ease-in-out infinite" }}/>
                    {[0,45,90,135,180,225,270,315].map((a,i)=>{const rad=a*Math.PI/180;return(
                      <line key={i} x1={13+Math.cos(rad)*8} y1={15+Math.sin(rad)*8} x2={13+Math.cos(rad)*10} y2={15+Math.sin(rad)*10} stroke="#FF8C42" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" style={{ animation: `weatherRayPulse 2s ease-in-out ${i*0.2}s infinite`, transformOrigin: "13px 15px" }}/>
                    )})}
                    <rect x="0" y="18" width="26" height="10" fill="#0A0C14" opacity="0.6"/>
                    <line x1="2" y1="18" x2="24" y2="18" stroke="#FF8C4266" strokeWidth="0.5"/>
                  </svg>
                ) : (
                  <svg width="26" height="26" viewBox="0 0 26 26" style={{ filter: "drop-shadow(0 0 8px rgba(255,200,50,0.4))" }}>
                    <defs>
                      <radialGradient id="sunGrd" cx="50%" cy="50%"><stop offset="0%" stopColor="#FFF7AE"/><stop offset="40%" stopColor="#FFD93D"/><stop offset="100%" stopColor="#F59E0B"/></radialGradient>
                    </defs>
                    <circle cx="13" cy="13" r="5.5" fill="url(#sunGrd)" style={{ animation: "weatherSunPulse 3s ease-in-out infinite" }}/>
                    {[0,45,90,135,180,225,270,315].map((a,i)=>{const rad=a*Math.PI/180;return(
                      <line key={i} x1={13+Math.cos(rad)*8} y1={13+Math.sin(rad)*8} x2={13+Math.cos(rad)*11} y2={13+Math.sin(rad)*11} stroke="#FFD93D" strokeWidth="1.5" strokeLinecap="round" style={{ animation: `weatherRayPulse 2s ease-in-out ${i*0.25}s infinite`, transformOrigin: "13px 13px" }}/>
                    )})}
                    {isMorning || isAfternoon ? <>
                      <ellipse cx="19" cy="18" rx="5" ry="3" fill="#E8ECF4" opacity="0.2" style={{ animation: "weatherCloudDrift 8s ease-in-out infinite" }}/>
                      <ellipse cx="17" cy="17" rx="3" ry="2" fill="#E8ECF4" opacity="0.15" style={{ animation: "weatherCloudDrift 8s ease-in-out 1s infinite" }}/>
                    </> : null}
                  </svg>
                );
                return <>
                  <div style={{ width: 26, height: 26, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>{weatherIcon}</div>
                  <div style={{ lineHeight: 1.2, position: "relative" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#ffffff", fontFamily: "'Space Grotesk', sans-serif", textShadow: "0 1px 3px rgba(0,0,0,0.3)" }}>{temp}°C</div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.65)", fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}>Singapore · {desc}</div>
                  </div>
                  <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)" }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, position: "relative" }}>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", fontFamily: "'JetBrains Mono', monospace" }}>💧 {humidity}%</span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", fontFamily: "'JetBrains Mono', monospace" }}>🌬️ {wind}km/h</span>
                  </div>
                </>;
              })()}
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: disasterAlert ? disasterAlert.color : "#4CAF50", boxShadow: disasterAlert ? `0 0 8px ${disasterAlert.color}88, 0 0 16px ${disasterAlert.color}44` : "0 0 8px #4CAF5088, 0 0 16px #4CAF5044", animation: disasterAlert ? "criticalBadgePulse 1.5s infinite" : "pulse 2s infinite", marginLeft: 2, flexShrink: 0 }} title={disasterAlert ? `⚠️ ${disasterAlert.type} Alert Active` : "Weather Normal"} />
            </div>

            {/* ═══ Notification Bell ═══ */}
            <div style={{ position: "relative" }}>
              <div onClick={() => { setShowNotifTray(!showNotifTray); }} title="Notifications" style={{
                width: 38, height: 38, borderRadius: 8,
                background: unreadNotifCount > 0 ? "#FFB34710" : "#0F1117",
                border: `1px solid ${unreadNotifCount > 0 ? "#FFB34733" : "#1E2130"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", fontSize: 16, transition: "all 0.2s",
                animation: unreadNotifCount > 0 ? "slaBlink 1.2s ease-in-out infinite" : "none"
              }}>
                🔔
                {unreadNotifCount > 0 && (
                  <span style={{
                    position: "absolute", top: -4, right: -4, minWidth: 18, height: 18,
                    borderRadius: 9, background: "#FF6B6B", color: "#fff",
                    fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    border: "2px solid #0A0C14", padding: "0 3px"
                  }}>{unreadNotifCount > 9 ? "9+" : unreadNotifCount}</span>
                )}
              </div>
              {showNotifTray && (
                <div style={{
                  position: "absolute", top: 44, right: 0, width: 340, maxHeight: 420,
                  background: "#0F1117", border: "1px solid #1E2130", borderRadius: 12,
                  boxShadow: "0 12px 40px rgba(0,0,0,0.6)", zIndex: 9999, overflow: "hidden"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #1E2130" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>Notifications</span>
                    <div style={{ display: "flex", gap: 8 }}>
                      {unreadNotifCount > 0 && <button style={{ fontSize: 10, color: "#818CF8", background: "none", border: "none", cursor: "pointer" }} onClick={() => setInAppNotifs(prev => prev.map(n => ({ ...n, read: true })))}>Mark all read</button>}
                      {inAppNotifs.length > 0 && <button style={{ fontSize: 10, color: "#5A6178", background: "none", border: "none", cursor: "pointer" }} onClick={() => setInAppNotifs([])}>Clear</button>}
                    </div>
                  </div>
                  <div style={{ overflowY: "auto", maxHeight: 360 }}>
                    {inAppNotifs.length === 0 ? (
                      <div style={{ padding: 32, textAlign: "center", color: "#5A6178", fontSize: 12 }}>No notifications</div>
                    ) : inAppNotifs.map((n, i) => (
                      <div key={n.id || i} onClick={() => setInAppNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x))} style={{
                        padding: "10px 16px", borderBottom: "1px solid #1E213044", cursor: "pointer",
                        background: n.read ? "transparent" : "#6366F108", transition: "background 0.15s"
                      }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                          {!n.read && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6366F1", marginTop: 5, flexShrink: 0 }} />}
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, color: "#E8ECF4", fontWeight: n.read ? 400 : 600, lineHeight: 1.4 }}>{n.title || n.message || "Notification"}</div>
                            {n.detail && <div style={{ fontSize: 10, color: "#5A6178", marginTop: 3, lineHeight: 1.3 }}>{n.detail}</div>}
                            <div style={{ fontSize: 9, color: "#5A617866", marginTop: 4 }}>{n.time || n.timestamp || ""}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ═══ Recycle Bin Button ═══ */}
            <div onClick={() => setShowRecycleBin(true)} title="Recycle Bin" style={{
              position: "relative", width: 38, height: 38, borderRadius: 8,
              background: recycleBin.length > 0 ? "#6366F10A" : "#0F1117",
              border: `1px solid ${recycleBin.length > 0 ? "#6366F133" : "#1E2130"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", fontSize: 16, transition: "all 0.2s"
            }}>
              🗑️
              {recycleBin.length > 0 && (
                <span style={{
                  position: "absolute", top: -4, right: -4, minWidth: 18, height: 18,
                  borderRadius: 9, background: "#6366F1", color: "#fff",
                  fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: "2px solid #0A0C14", padding: "0 3px"
                }}>{recycleBin.length}</span>
              )}
            </div>

            {/* ═══ AI Actions Button — Global Access ═══ */}
            <div style={{ position: "relative" }}>
              <div onClick={() => setShowAiActionsPanel(!showAiActionsPanel)} style={{
                position: "relative", width: 38, height: 38, borderRadius: 8,
                background: aiActions.filter(a => a.status === "pending_approval").length > 0 ? "linear-gradient(135deg, #EC489912, #6366F108)" : "#0F1117",
                border: `1px solid ${aiActions.filter(a => a.status === "pending_approval").length > 0 ? "#EC489933" : "#1E2130"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", transition: "all 0.2s", fontSize: 16
              }}
                title="AI Actions & Approvals"
                onMouseOver={e => e.currentTarget.style.background = "#EC489918"}
                onMouseOut={e => e.currentTarget.style.background = aiActions.filter(a => a.status === "pending_approval").length > 0 ? "linear-gradient(135deg, #EC489912, #6366F108)" : "#0F1117"}>
                🛡️
                {aiActions.filter(a => a.status === "pending_approval").length > 0 && (
                  <span style={{
                    position: "absolute", top: -4, right: -4, minWidth: 18, height: 18,
                    borderRadius: 9, background: "#EC4899", color: "#fff",
                    fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    border: "2px solid #0A0C14", padding: "0 3px",
                    animation: "pulse 2s infinite"
                  }}>{aiActions.filter(a => a.status === "pending_approval").length}</span>
                )}
              </div>
            </div>

            {/* ═══ Bell Icon — AI Alert Panel ═══ */}
            {(() => {
              const critIncidents = incidents.filter(i => (i.priority === "Sev-A" || i.priority === "Sev-B") && i.status !== "Resolved" && i.status !== "Closed");
              const alertCount = critIncidents.length;
              const aiActions = critIncidents.map(inc => {
                const sevA = inc.priority === "Sev-A";
                let action = "", detail = "";
                if (inc.category === "Network" || inc.title?.toLowerCase().includes("network")) { action = "Restart affected network services & check firewall rules"; detail = "Run diagnostics on core switches, verify VLAN configs, escalate to Network team if persists > 15min"; }
                else if (inc.category === "Security" || inc.title?.toLowerCase().includes("security") || inc.title?.toLowerCase().includes("breach")) { action = "Isolate affected systems & initiate incident response"; detail = "Block suspicious IPs, enable enhanced logging, notify CISO, preserve forensic evidence"; }
                else if (inc.category === "Email" || inc.title?.toLowerCase().includes("email") || inc.title?.toLowerCase().includes("exchange")) { action = "Check Exchange health & restart mail transport services"; detail = "Verify mail queue, check certificate validity, restart MSExchangeTransport, monitor delivery"; }
                else if (inc.category === "SAP" || inc.title?.toLowerCase().includes("sap") || inc.title?.toLowerCase().includes("erp")) { action = "Verify SAP application servers & restart work processes"; detail = "Check SM21 system log, ST22 dumps, restart SAP services, verify DB connectivity"; }
                else if (inc.title?.toLowerCase().includes("vpn") || inc.title?.toLowerCase().includes("remote")) { action = "Check VPN concentrator health & user authentication"; detail = "Verify AnyConnect profiles, check Entra ID sync, restart VPN services, test connectivity"; }
                else if (inc.title?.toLowerCase().includes("server") || inc.title?.toLowerCase().includes("down")) { action = "Run server health checks & attempt service restart"; detail = "Check CPU/RAM/Disk, review event logs, restart primary services, fail-over if needed"; }
                else { action = sevA ? "Escalate immediately & begin root cause analysis" : "Investigate and apply standard troubleshooting"; detail = sevA ? "Engage L2/L3 support, notify service owner, start P1 bridge call" : "Follow KB runbook, check recent changes, gather diagnostics"; }
                return { ...inc, aiAction: action, aiDetail: detail, isSevA: sevA };
              });
              return (
                <div style={{ position: "relative" }}>
                  <div onClick={() => setShowAlertPanel(!showAlertPanel)} style={{
                    position: "relative", width: 38, height: 38, borderRadius: 8,
                    background: alertCount > 0 ? "linear-gradient(135deg, #FF444412, #FF6B6B08)" : "#0F1117",
                    border: `1px solid ${alertCount > 0 ? "#FF444433" : "#1E2130"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", fontSize: 16,
                    animation: alertCount > 0 ? "bellShake 2s ease-in-out infinite" : "none",
                    transition: "all 0.2s"
                  }}>
                    🔔
                    {alertCount > 0 && (
                      <span style={{
                        position: "absolute", top: -4, right: -4, minWidth: 18, height: 18,
                        borderRadius: 9, background: "#FF4444", color: "#fff",
                        fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        border: "2px solid #0A0C14", padding: "0 3px",
                        animation: "criticalBadgePulse 2s infinite"
                      }}>{alertCount}</span>
                    )}
                  </div>

                  {/* AI Alert Panel Dropdown */}
                  {showAlertPanel && (
                    <div style={{
                      position: "absolute", top: 46, right: 0, width: 440, maxHeight: "75vh",
                      background: "#0F1117", borderRadius: 12,
                      border: "1px solid #1E2130", boxShadow: "0 16px 48px #000000AA, 0 4px 12px #00000066",
                      overflow: "hidden", zIndex: 999,
                      animation: "alertSlideDown 0.25s ease-out"
                    }}>
                      {/* Panel Header */}
                      <div style={{ padding: "12px 16px", background: "linear-gradient(135deg, #FF444410, #6366F108)", borderBottom: "1px solid #1E2130", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 14 }}>🤖</span>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>AI Action Center</div>
                            <div style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{alertCount} active alert{alertCount !== 1 ? "s" : ""} · AI recommendations ready</div>
                          </div>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); setShowAlertPanel(false); }} style={{ background: "none", border: "none", color: "#5A6178", cursor: "pointer", fontSize: 15, padding: "2px 4px" }}>✕</button>
                      </div>

                      {/* Alert Items */}
                      <div style={{ overflow: "auto", maxHeight: "calc(75vh - 100px)", padding: "8px" }}>
                        {aiActions.length === 0 ? (
                          <div style={{ textAlign: "center", padding: "30px 20px" }}>
                            <span style={{ fontSize: 28 }}>✅</span>
                            <div style={{ fontSize: 13, color: "#81C784", fontWeight: 600, marginTop: 8 }}>All Clear</div>
                            <div style={{ fontSize: 11, color: "#5A6178", marginTop: 4 }}>No high-priority incidents requiring immediate action</div>
                          </div>
                        ) : (
                          aiActions.map(item => (
                            <div key={item.id} onClick={() => { setShowAlertPanel(false); setDetailItem(item); setModal("incidentDetail"); }} style={{
                              padding: "10px 12px", marginBottom: 6, borderRadius: 8,
                              background: item.isSevA ? "#FF444408" : "#0A0C14",
                              border: `1px solid ${item.isSevA ? "#FF444433" : "#1E2130"}`,
                              borderLeft: `3px solid ${item.isSevA ? "#FF4444" : "#FF6B6B"}`,
                              cursor: "pointer", transition: "all 0.2s"
                            }}
                              onMouseEnter={e => { e.currentTarget.style.background = item.isSevA ? "#FF444412" : "#1E213044"; e.currentTarget.style.transform = "translateX(2px)"; }}
                              onMouseLeave={e => { e.currentTarget.style.background = item.isSevA ? "#FF444408" : "#0A0C14"; e.currentTarget.style.transform = "translateX(0)"; }}
                            >
                              {/* Ticket Header */}
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                                <span style={{ width: 7, height: 7, borderRadius: "50%", background: item.isSevA ? "#FF4444" : "#FF6B6B", boxShadow: item.isSevA ? "0 0 6px #FF444488" : "none", flexShrink: 0, animation: item.isSevA ? "pulse 2s infinite" : "none" }} />
                                <span style={{ fontSize: 10, fontWeight: 700, color: item.isSevA ? "#FF4444" : "#FF6B6B", fontFamily: "'JetBrains Mono', monospace" }}>{item.priority}</span>
                                <span style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{item.id}</span>
                                {item.isSevA && <span style={{ padding: "1px 5px", borderRadius: 3, background: "#FF4444", color: "#fff", fontSize: 8, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", animation: "pulse 2s infinite" }}>URGENT</span>}
                                <span style={{ padding: "1px 5px", borderRadius: 3, background: "#1E2130", fontSize: 8, color: "#A0AEC0" }}>{item.status}</span>
                                <span style={{ fontSize: 9, color: "#5A6178", marginLeft: "auto" }}>{item.assignee || "Unassigned"}</span>
                              </div>
                              {/* Title */}
                              <div style={{ fontSize: 11, color: "#E8ECF4", fontWeight: 500, marginBottom: 6, lineHeight: 1.4 }}>{item.title}</div>
                              {/* AI Action — highlighted */}
                              <div style={{ padding: "7px 10px", background: "linear-gradient(135deg, #6366F108, #06B6D408)", borderRadius: 6, border: "1px solid #6366F122", marginBottom: 4 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                                  <span style={{ fontSize: 10 }}>⚡</span>
                                  <span style={{ fontSize: 9, fontWeight: 700, color: "#6366F1", fontFamily: "'JetBrains Mono', monospace" }}>AI RECOMMENDED ACTION</span>
                                </div>
                                <div style={{ fontSize: 11, color: "#81C784", fontWeight: 600, marginBottom: 2 }}>{item.aiAction}</div>
                                <div style={{ fontSize: 10, color: "#A0AEC0", lineHeight: 1.4 }}>{item.aiDetail}</div>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 4 }}>
                                <span style={{ fontSize: 9, color: "#6366F1", fontFamily: "'JetBrains Mono', monospace" }}>Open ticket →</span>
                              </div>
                            </div>
                          ))
                        )}

                        {/* Quick Actions Footer */}
                        {aiActions.length > 0 && (
                          <div style={{ padding: "8px 4px 4px", borderTop: "1px solid #1E213044", marginTop: 4 }}>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button onClick={(e) => { e.stopPropagation(); setShowAlertPanel(false); setActiveModule("incidents"); }} style={{
                                flex: 1, padding: "7px 10px", borderRadius: 6, border: "1px solid #FF444433", background: "#FF444412",
                                color: "#FF6B6B", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace"
                              }}>🎫 All Incidents</button>
                              <button onClick={(e) => { e.stopPropagation(); setShowAlertPanel(false); setActiveModule("cybernews"); }} style={{
                                flex: 1, padding: "7px 10px", borderRadius: 6, border: "1px solid #6366F133", background: "#6366F112",
                                color: "#6366F1", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace"
                              }}>🛡️ Cyber News</button>
                              <button onClick={(e) => { e.stopPropagation(); setShowAlertPanel(false); setActiveModule("sla"); }} style={{
                                flex: 1, padding: "7px 10px", borderRadius: 6, border: "1px solid #FFB34733", background: "#FFB34712",
                                color: "#FFB347", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace"
                              }}>⏱️ SLA Tracker</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: 28 }}>
          {navExplainId === activeModule && AI_FEATURE_EXPLAINERS[activeModule] && activeModule !== "dashboard" && (
            <div style={{ margin: "0 0 20px", padding: "14px 18px", background: "linear-gradient(135deg, #6366F108, #6366F115)", borderRadius: 10, border: "1px solid #6366F133" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#6366F1", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1, display: "flex", alignItems: "center", gap: 6 }}>🤖 {AI_FEATURE_EXPLAINERS[activeModule].title} — How it works</div>
                <button onClick={() => setNavExplainId(null)} style={{ background: "none", border: "none", color: "#5A6178", cursor: "pointer", fontSize: 14 }}>✕</button>
              </div>
              <div style={{ fontSize: 12, color: "#C4CAD6", lineHeight: 1.7 }}>{AI_FEATURE_EXPLAINERS[activeModule].explain}</div>
            </div>
          )}
          <Suspense fallback={<div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 200, color: "#8B92A5" }}>Loading module…</div>}>
            {renderModule()}
          </Suspense>
        </div>
        {/*div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ fontSize: 9, color: "#5A617844", fontFamily: "'JetBrains Mono', monospace" }}>
              <kbd style={{ padding: "1px 4px", borderRadius: 3, background: "#1E213044", border: "1px solid #2A2E3F44", marginRight: 2 }}>Ctrl+K</kbd> Commands
            </span>
            <span style={{ fontSize: 9, color: "#5A617844", fontFamily: "'JetBrains Mono', monospace" }}>
              <kbd style={{ padding: "1px 4px", borderRadius: 3, background: "#1E213044", border: "1px solid #2A2E3F44", marginRight: 2 }}>Ctrl+/</kbd> AI
            </span>
            <span style={{ fontSize: 9, color: "#5A617844", fontFamily: "'JetBrains Mono', monospace" }}>
              <kbd style={{ padding: "1px 4px", borderRadius: 3, background: "#1E213044", border: "1px solid #2A2E3F44", marginRight: 2 }}>Esc</kbd> Close
            </span>
          </div>
          < Footer */}
        <div style={{ padding: "6px 28px", borderTop: "1px solid #1E213033", background: "#0A0C14", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "#5A617855", fontFamily: "'JetBrains Mono', monospace" }}>© {new Date().getFullYear()} VGC Technology Pte Ltd — All rights reserved</span>
          <span style={{ fontSize: 9, color: "#5A617844", fontFamily: "'JetBrains Mono', monospace" }}>VGC-ITSM v{APP_VERSION.version} · Enterprise Service Management</span>
        </div>
      </main>
      </div>{/* End Main Layout Row */}

      {/* Modals */}
      <Suspense fallback={null}>
        <ModalsModule ctx={{
          currentUser, showToast, _save, incidents, setIncidents,
          problems, setProblems, changes, setChanges, requests, setRequests,
          assets, setAssets, kbArticles, setKbArticles,
          serviceCatalog, setServiceCatalog,
          customers, users: managedUsers, vendors, search,
          detailItem, setDetailItem, modal, setModal,
          setActiveModule, slaPolicy,
          isEntraProductionUser, softDelete,
        }} />
      </Suspense>

      {/* ═══ TOAST NOTIFICATIONS ═══ */}
      {toasts.length > 0 && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 10000, display: "flex", flexDirection: "column", gap: 6, maxWidth: 320 }}>
          {toasts.map(t => (
            <div key={t.id} style={{
              padding: "8px 12px", borderRadius: 6, display: "flex", alignItems: "center", gap: 6,
              background: t.type === "success" ? "#0D2D1A" : t.type === "error" ? "#2D0A0A" : "#0D2137",
              border: `1px solid ${t.type === "success" ? "#4CAF5044" : t.type === "error" ? "#FF444444" : "#64B5F644"}`,
              boxShadow: "0 4px 16px #00000055", animation: "fadeIn 0.3s",
            }}>
              <span style={{ fontSize: 13 }}>{t.type === "success" ? "✅" : t.type === "error" ? "❌" : "ℹ️"}</span>
              <span style={{ fontSize: 11, color: "#E8ECF4", flex: 1, fontFamily: "'DM Sans', sans-serif" }}>{t.message}</span>
              <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} style={{ background: "none", border: "none", color: "#5A6178", cursor: "pointer", fontSize: 12, padding: 0 }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* ═══ UNDO TOAST ═══ */}
      {undoToast && (
        <div style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", zIndex: 9999, display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", background: "#1A1C2B", border: "1px solid #6366F144", borderRadius: 10, boxShadow: "0 8px 32px #00000066", animation: "fadeIn 0.25s", maxWidth: 500 }}>
          <span style={{ fontSize: 16 }}>🗑️</span>
          <span style={{ fontSize: 12, color: "#E8ECF4", flex: 1, fontFamily: "'DM Sans', sans-serif" }}>{undoToast.label}</span>
          <button onClick={undoDelete} style={{ padding: "5px 14px", borderRadius: 6, border: "1px solid #6366F155", background: "#6366F122", color: "#6366F1", cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" }}>↩ Undo</button>
          <button onClick={() => { setUndoToast(null); if (undoTimerRef.current) clearTimeout(undoTimerRef.current); }} style={{ background: "none", border: "none", color: "#5A6178", cursor: "pointer", fontSize: 14, padding: 0 }}>✕</button>
        </div>
      )}

      {/* ═══ RECYCLE BIN MODAL ═══ */}
      {showRecycleBin && (
        <div style={{ position: "fixed", inset: 0, background: "#000000AA", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setShowRecycleBin(false); }}>
          <div style={{ width: 680, maxHeight: "80vh", background: "#0F1117", borderRadius: 12, border: "1px solid #1E2130", overflow: "hidden", boxShadow: "0 20px 60px #00000066", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px 20px", background: "linear-gradient(135deg, #FF6B6B08, #FFB34708)", borderBottom: "1px solid #1E2130", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18 }}>🗑️</span>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>Recycle Bin</div>
                  <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{recycleBin.length} item{recycleBin.length !== 1 ? "s" : ""} · auto-expires after 100 items</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {recycleBin.length > 0 && <button onClick={() => { if (confirm("Permanently delete all items in the Recycle Bin?")) emptyRecycleBin(); }} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #FF6B6B33", background: "#FF6B6B11", color: "#FF6B6B", fontSize: 10, cursor: "pointer", fontWeight: 600 }}>🗑️ Empty All</button>}
                <button onClick={() => setShowRecycleBin(false)} style={{ background: "none", border: "none", color: "#5A6178", cursor: "pointer", fontSize: 18 }}>✕</button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "12px 20px" }}>
              {recycleBin.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 20px", color: "#5A6178" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🗑️</div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Recycle Bin is empty</div>
                  <div style={{ fontSize: 11 }}>Deleted customers, vendors, workflow rules, and other items will appear here</div>
                </div>
              ) : recycleBin.map((entry, idx) => {
                const typeLabel = RECYCLE_LABELS[entry._recycleType] || entry._recycleType;
                const typeColors = { customers: "#06B6D4", vendors: "#FFB347", workflow_rules: "#CE93D8", service_reports: "#64B5F6", service_catalog: "#81C784", managed_users: "#EC4899", kb_articles: "#6366F1", survey_templates: "#F59E0B", ai_actions: "#EC4899" };
                const color = typeColors[entry._recycleType] || "#5A6178";
                const deletedAgo = (() => { const ms = Date.now() - new Date(entry._deletedAt).getTime(); const mins = Math.floor(ms / 60000); if (mins < 1) return "just now"; if (mins < 60) return `${mins}m ago`; const hrs = Math.floor(mins / 60); if (hrs < 24) return `${hrs}h ago`; return `${Math.floor(hrs / 24)}d ago`; })();
                return (
                  <div key={`${entry.id}-${entry._deletedAt}-${idx}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", marginBottom: 6, background: "#0A0C14", borderRadius: 8, border: "1px solid #1E213044" }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: `${color}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
                      {entry._recycleType === "customers" ? "🏢" : entry._recycleType === "vendors" ? "🏭" : entry._recycleType === "workflow_rules" ? "⚙️" : entry._recycleType === "managed_users" ? "👤" : entry._recycleType === "kb_articles" ? "📚" : entry._recycleType === "service_reports" ? "📋" : entry._recycleType === "service_catalog" ? "📦" : entry._recycleType === "ai_actions" ? "🤖" : "📄"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: "#E8ECF4", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name || entry.title || entry.label || entry.id}</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
                        <span style={{ padding: "1px 6px", borderRadius: 4, background: `${color}15`, color, fontSize: 9, fontWeight: 600 }}>{typeLabel}</span>
                        <span style={{ fontSize: 9, color: "#5A6178" }}>{entry.id}</span>
                        <span style={{ fontSize: 9, color: "#5A617866" }}>·</span>
                        <span style={{ fontSize: 9, color: "#5A6178" }}>deleted {deletedAgo} by {entry._deletedBy}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button onClick={() => { const { _recycleType, _deletedAt, _deletedBy, ...cleanItem } = entry; const setterMap = { customers: setCustomers, vendors: setVendors, workflow_rules: setWorkflowRules, service_reports: setServiceReports, service_catalog: setServiceCatalog, managed_users: setManagedUsers, kb_articles: setKbArticles, survey_templates: setSurveyTemplates }; const keyMap = { customers: "vgc_customers", vendors: "vgc_vendors", workflow_rules: "vgc_workflow_rules", service_reports: "vgc_service_reports", service_catalog: "vgc_services", managed_users: "vgc_managed_users", kb_articles: "vgc_kb", survey_templates: "vgc_survey_templates" }; const setter = setterMap[_recycleType]; if (setter) { setter(prev => { const updated = [cleanItem, ...prev]; _save(keyMap[_recycleType], updated); return updated; }); } setRecycleBin(prev => { const updated = prev.filter((x, i) => i !== idx); _save("vgc_recycle_bin", updated); return updated; }); }}
                        style={{ padding: "4px 10px", borderRadius: 5, border: "1px solid #4CAF5033", background: "#4CAF5011", color: "#4CAF50", fontSize: 10, cursor: "pointer", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>↩ Restore</button>
                      <button onClick={() => { setRecycleBin(prev => { const updated = prev.filter((x, i) => i !== idx); _save("vgc_recycle_bin", updated); return updated; }); }}
                        style={{ padding: "4px 10px", borderRadius: 5, border: "1px solid #FF6B6B33", background: "#FF6B6B11", color: "#FF6B6B", fontSize: 10, cursor: "pointer", fontWeight: 600 }}>✕ Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══ COMMAND PALETTE (Ctrl+K) ═══ */}
      {showCommandPalette && (() => {
        const commands = [
          { icon: "📝", label: "New Incident", action: () => { setActiveModule("incidents"); setModal("createIncident"); } },
          { icon: "🔧", label: "New Problem", action: () => { setActiveModule("incidents"); setModal("createProblem"); } },
          { icon: "📋", label: "New Change Request", action: () => { setActiveModule("incidents"); setModal("createChange"); } },
          { icon: "👥", label: "Go to Customers", action: () => setActiveModule("customers") },
          { icon: "🏢", label: "Go to Vendors", action: () => setActiveModule("customers") },
          { icon: "📊", label: "Go to Dashboard", action: () => setActiveModule("dashboard") },
          { icon: "🎫", label: "Go to Tickets", action: () => setActiveModule("incidents") },
          { icon: "📦", label: "Go to Assets", action: () => setActiveModule("assets") },
          { icon: "📚", label: "Go to Knowledge Base", action: () => setActiveModule("knowledge") },
          { icon: "⚙️", label: "Go to Settings", action: () => setActiveModule("settings") },
          { icon: "🤖", label: "Open AI Assistant", action: () => setShowAiPanel(true) },
          { icon: "🛡️", label: "AI Actions & Approvals", action: () => setShowAiActionsPanel(true) },
          { icon: "🔗", label: "Go to Zendesk", action: () => setActiveModule("zendesk") },
          { icon: "📈", label: "Go to Service Reports", action: () => setActiveModule("reports") },
          { icon: "🗑️", label: "Open Recycle Bin", action: () => setShowRecycleBin(true) },
          { icon: "📧", label: "Go to Email Intelligence", action: () => setActiveModule("emailIntelligence") },
          { icon: "🛡️", label: "Go to Admin Panel", action: () => setActiveModule("admin") },
        ];
        const q = cmdSearch.toLowerCase();
        const filtered = q ? commands.filter(c => (c.label || "").toLowerCase().includes(q)) : commands;

        // AI Smart Search — search incidents, KB, and everything when command palette is open
        const smartResults = q && q.length >= 2 ? (() => {
          const results = [];
          // Search incidents
          incidents.filter(inc => inc.title?.toLowerCase().includes(q) || inc.id?.toLowerCase().includes(q) || inc.description?.toLowerCase().includes(q)).slice(0, 3).forEach(inc => {
            results.push({ type: "incident", icon: "🎫", label: `${inc.id} — ${inc.title}`, sublabel: `${inc.status} · ${inc.priority} · ${inc.category || ""}`, action: () => { setDetailItem(inc); setModal("incidentDetail"); } });
          });
          // Search KB
          kbArticles.filter(kb => kb.title?.toLowerCase().includes(q) || kb.content?.toLowerCase().includes(q) || (kb.tags || []).some(t => t.toLowerCase().includes(q))).slice(0, 3).forEach(kb => {
            results.push({ type: "kb", icon: "📚", label: kb.title, sublabel: `${kb.category || "KB"} · ${kb.id}`, action: () => { setDetailItem(kb); setModal("kbDetail"); } });
          });
          // Search requests
          (requests || []).filter(r => r.title?.toLowerCase().includes(q) || r.id?.toLowerCase().includes(q)).slice(0, 2).forEach(r => {
            results.push({ type: "request", icon: "📋", label: `${r.id} — ${r.title || r.type}`, sublabel: `${r.status}`, action: () => { setDetailItem(r); setModal("requestDetail"); } });
          });
          // Search changes
          (changes || []).filter(c => c.title?.toLowerCase().includes(q) || c.id?.toLowerCase().includes(q)).slice(0, 2).forEach(c => {
            results.push({ type: "change", icon: "🔄", label: `${c.id} — ${c.title}`, sublabel: `${c.status}`, action: () => { setDetailItem(c); setModal("changeDetail"); } });
          });
          return results;
        })() : [];

        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 10001, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "15vh" }}
            onClick={e => { if (e.target === e.currentTarget) { setShowCommandPalette(false); setCmdSearch(""); } }}>
            <div style={{ width: 560, background: "#0F1117", borderRadius: 12, border: "1px solid #1E2130", boxShadow: "0 24px 64px #000000CC", overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #1E2130", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, color: "#6366F1" }}>🔍</span>
                <input autoFocus value={cmdSearch} onChange={e => setCmdSearch(e.target.value)}
                  placeholder="Search everything or type a command... (AI-powered)" style={{ flex: 1, background: "none", border: "none", outline: "none", color: "#E8ECF4", fontSize: 14, fontFamily: "'Space Grotesk', sans-serif" }}
                  onKeyDown={e => { if (e.key === "Enter") { if (filtered.length > 0) { filtered[0].action(); } else if (smartResults.length > 0) { smartResults[0].action(); } setShowCommandPalette(false); setCmdSearch(""); } }} />
                <kbd style={{ padding: "2px 6px", borderRadius: 4, background: "#1E2130", color: "#5A6178", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", border: "1px solid #2A2E3F" }}>ESC</kbd>
              </div>
              <div style={{ maxHeight: 440, overflowY: "auto", padding: "6px 0" }}>
                {/* Smart Search Results */}
                {smartResults.length > 0 && (
                  <>
                    <div style={{ padding: "6px 16px", fontSize: 10, fontWeight: 700, color: "#6366F1", textTransform: "uppercase", letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace" }}>🔍 Search Results</div>
                    {smartResults.map((r, i) => (
                      <div key={`sr-${i}`} onClick={() => { r.action(); setShowCommandPalette(false); setCmdSearch(""); }}
                        style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", transition: "background 0.15s" }}
                        onMouseEnter={e => e.currentTarget.style.background = "#1E213066"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{r.icon}</span>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>{r.label}</span>
                          {r.sublabel && <div style={{ fontSize: 10, color: "#5A6178", marginTop: 1 }}>{r.sublabel}</div>}
                        </div>
                        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 6, background: "#1E2130", color: "#5A6178" }}>{r.type}</span>
                      </div>
                    ))}
                  </>
                )}

                {/* Commands */}
                {filtered.length > 0 && (
                  <>
                    {smartResults.length > 0 && <div style={{ padding: "6px 16px", fontSize: 10, fontWeight: 700, color: "#5A6178", textTransform: "uppercase", letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace", borderTop: "1px solid #1E2130", marginTop: 4, paddingTop: 10 }}>⌘ Commands</div>}
                    {filtered.map((cmd, i) => (
                      <div key={i} onClick={() => { cmd.action(); setShowCommandPalette(false); setCmdSearch(""); }}
                        style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", transition: "background 0.15s" }}
                        onMouseEnter={e => e.currentTarget.style.background = "#1E213066"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{cmd.icon}</span>
                        <span style={{ fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>{cmd.label}</span>
                      </div>
                    ))}
                  </>
                )}

                {filtered.length === 0 && smartResults.length === 0 && <div style={{ padding: "20px 16px", textAlign: "center", color: "#5A6178", fontSize: 12 }}>No results found for "{cmdSearch}"</div>}
              </div>
              <div style={{ padding: "8px 16px", borderTop: "1px solid #1E2130", display: "flex", gap: 16, fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>
                <span>↵ Select</span><span>ESC Close</span><span>Ctrl+K Toggle</span><span style={{ color: "#6366F1" }}>🤖 AI-powered search</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ 
      )}

      {/* ═══ PROFILE MODAL ═══ */}
      {showProfileModal && (
        <div style={{ position: "fixed", inset: 0, background: "#000000AA", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setShowProfileModal(false); }}>
          <div style={{ width: 520, maxHeight: "85vh", background: "#0F1117", borderRadius: 12, border: "1px solid #1E2130", overflow: "auto", boxShadow: "0 20px 60px #00000066" }}>
            <div style={{ padding: "16px 20px", background: "linear-gradient(135deg, #6366F108, #06B6D408)", borderBottom: "1px solid #1E2130", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 16 }}>👤</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>My Profile</div>
                  <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>Manage your account & Entra ID sync</div>
                </div>
              </div>
              <button onClick={() => setShowProfileModal(false)} style={{ background: "none", border: "none", color: "#5A6178", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <div style={{ padding: 20 }}>
              {/* Photo Section */}
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{ position: "relative", width: 80, height: 80, margin: "0 auto 12px" }}>
                  <div style={{
                    width: 80, height: 80, borderRadius: 20,
                    background: profilePhoto ? `url(${profilePhoto}) center/cover no-repeat` : "linear-gradient(135deg, #6366F1, #06B6D4, #EC4899, #F59E0B)",
                    backgroundSize: profilePhoto ? "cover" : "300% 300%",
                    animation: profilePhoto ? "none" : "logoGradient 4s ease infinite",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 24, fontWeight: 700, color: "#fff",
                    boxShadow: "0 4px 16px rgba(99,102,241,0.3)",
                    border: "3px solid #6366F133"
                  }}>{!profilePhoto && currentUser.avatar}</div>
                  <button onClick={() => profilePhotoRef.current?.click()} style={{
                    position: "absolute", bottom: -4, right: -4, width: 28, height: 28, borderRadius: 8,
                    background: "#6366F1", border: "2px solid #0F1117", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, color: "#fff", boxShadow: "0 2px 8px rgba(99,102,241,0.4)"
                  }}>📷</button>
                  <input ref={profilePhotoRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={e => {
                    const file = e.target.files?.[0];
                    if (file && file.size <= 5 * 1024 * 1024 && /^image\/(png|jpe?g|gif|webp)$/i.test(file.type)) {
                      const reader = new FileReader();
                      reader.onload = ev => setProfilePhoto(ev.target.result);
                      reader.readAsDataURL(file);
                    }
                  }} />
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>{currentUser.name}</div>
                <div style={{ fontSize: 11, color: "#EC4899", fontFamily: "'JetBrains Mono', monospace" }}>{currentUser.rbacRole}</div>
              </div>

              {/* Entra ID Sync Status */}
              <div style={{ padding: "10px 14px", borderRadius: 8, background: "#4CAF5008", border: "1px solid #4CAF5022", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1L14 4V8.5C14 11.5 11.5 14 8 15C4.5 14 2 11.5 2 8.5V4L8 1Z" stroke="#4CAF50" strokeWidth="1.3"/><path d="M5.5 8L7 9.5L10.5 6" stroke="#4CAF50" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#4CAF50" }}>Microsoft Entra ID — Synced</div>
                  <div style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>Last sync: {new Date().toLocaleString("en-GB", { timeZone: "Asia/Singapore" })} SGT</div>
                </div>
                <button style={{ padding: "4px 10px", borderRadius: 5, border: "1px solid #4CAF5033", background: "#4CAF5012", color: "#4CAF50", cursor: "pointer", fontSize: 9, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>🔄 Sync Now</button>
              </div>

              {/* Profile Fields */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { label: "Full Name", value: currentUser.name, icon: "👤" },
                  { label: "Employee ID", value: currentUser.employeeId, icon: "🆔" },
                  { label: "Email Address", value: currentUser.email, icon: "📧" },
                  { label: "Office Phone", value: currentUser.phone, icon: "📞" },
                  { label: "Mobile Number", value: "+65 9123 4567", icon: "📱" },
                  { label: "Department", value: currentUser.department, icon: "🏢" },
                  { label: "Role / Title", value: currentUser.role, icon: "💼" },
                  { label: "Team", value: currentUser.team, icon: "👥" },
                  { label: "Location", value: currentUser.location, icon: "📍" },
                  { label: "PC Name", value: currentUser.pcName, icon: "💻" },
                  { label: "RBAC Role", value: currentUser.rbacRole, icon: "🔐" },
                  { label: "Entra ID UPN", value: currentUser.email, icon: "☁️" },
                ].map((f, i) => (
                  <div key={i} style={{ padding: "8px 10px", background: "#0A0C14", borderRadius: 6, border: "1px solid #1E213044" }}>
                    <div style={{ fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginBottom: 3, display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 10 }}>{f.icon}</span> {f.label}</div>
                    <div style={{ fontSize: 12, color: "#E8ECF4", fontWeight: 500 }}>{f.value}</div>
                  </div>
                ))}
              </div>

              {/* Notification Preferences */}
              <div style={{ marginTop: 16, background: "#0A0C14", borderRadius: 8, border: "1px solid #1E213044", padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#E8ECF4", marginBottom: 10, fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 6 }}>🔔 Notification Preferences</div>
                {/* Channel Toggles */}
                <div style={{ fontSize: 10, fontWeight: 600, color: "#5A6178", marginBottom: 6, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>Channels</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
                  {[{ key: "email", label: "📧 Email" }, { key: "teams", label: "💬 Teams" }, { key: "inApp", label: "🔔 In-App" }, { key: "sms", label: "📱 SMS" }].map(ch => (
                    <div key={ch.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "#12141E", borderRadius: 6, border: "1px solid #1E213044" }}>
                      <span style={{ fontSize: 11, color: "#C4CAD6" }}>{ch.label}</span>
                      <div onClick={() => setNotifPrefs(prev => ({ ...prev, [ch.key]: !prev[ch.key] }))} style={{ width: 36, height: 20, borderRadius: 10, cursor: "pointer", background: notifPrefs[ch.key] ? "#6366F1" : "#1E2130", padding: 2 }}>
                        <div style={{ width: 16, height: 16, borderRadius: 8, background: "#fff", transform: notifPrefs[ch.key] ? "translateX(16px)" : "translateX(0)", transition: "transform 0.2s" }} />
                      </div>
                    </div>
                  ))}
                </div>
                {/* Severity Filter */}
                <div style={{ fontSize: 10, fontWeight: 600, color: "#5A6178", marginBottom: 6, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>Severity Filter</div>
                <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                  {["Sev-A", "Sev-B", "Sev-C", "Sev-D"].map(sev => {
                    const active = (notifPrefs.severityFilter || []).includes(sev);
                    const colors = { "Sev-A": "#FF4444", "Sev-B": "#FF6B6B", "Sev-C": "#FFB347", "Sev-D": "#5A6178" };
                    return (
                      <button key={sev} onClick={() => setNotifPrefs(prev => ({ ...prev, severityFilter: active ? prev.severityFilter.filter(s => s !== sev) : [...(prev.severityFilter || []), sev] }))}
                        style={{ padding: "4px 10px", borderRadius: 5, border: `1px solid ${active ? colors[sev] + "66" : "#1E2130"}`, background: active ? colors[sev] + "18" : "#12141E", color: active ? colors[sev] : "#5A6178", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{sev}</button>
                    );
                  })}
                </div>
                {/* Quiet Hours */}
                <div style={{ fontSize: 10, fontWeight: 600, color: "#5A6178", marginBottom: 6, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>Quiet Hours</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div onClick={() => setNotifPrefs(prev => ({ ...prev, quietHoursEnabled: !prev.quietHoursEnabled }))} style={{ width: 36, height: 20, borderRadius: 10, cursor: "pointer", background: notifPrefs.quietHoursEnabled ? "#6366F1" : "#1E2130", padding: 2, flexShrink: 0 }}>
                    <div style={{ width: 16, height: 16, borderRadius: 8, background: "#fff", transform: notifPrefs.quietHoursEnabled ? "translateX(16px)" : "translateX(0)", transition: "transform 0.2s" }} />
                  </div>
                  <span style={{ fontSize: 11, color: "#C4CAD6" }}>Enable quiet hours</span>
                  {notifPrefs.quietHoursEnabled && (
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
                      <input type="time" value={notifPrefs.quietStart || "22:00"} onChange={e => setNotifPrefs(prev => ({ ...prev, quietStart: e.target.value }))} style={{ ...inputStyle, fontSize: 10, padding: "3px 6px", width: 80 }} />
                      <span style={{ color: "#5A6178", fontSize: 10 }}>to</span>
                      <input type="time" value={notifPrefs.quietEnd || "07:00"} onChange={e => setNotifPrefs(prev => ({ ...prev, quietEnd: e.target.value }))} style={{ ...inputStyle, fontSize: 10, padding: "3px 6px", width: 80 }} />
                    </div>
                  )}
                </div>
                {/* Daily Digest */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div onClick={() => setNotifPrefs(prev => ({ ...prev, digestEnabled: !prev.digestEnabled }))} style={{ width: 36, height: 20, borderRadius: 10, cursor: "pointer", background: notifPrefs.digestEnabled ? "#6366F1" : "#1E2130", padding: 2, flexShrink: 0 }}>
                    <div style={{ width: 16, height: 16, borderRadius: 8, background: "#fff", transform: notifPrefs.digestEnabled ? "translateX(16px)" : "translateX(0)", transition: "transform 0.2s" }} />
                  </div>
                  <span style={{ fontSize: 11, color: "#C4CAD6" }}>Daily digest summary</span>
                  {notifPrefs.digestEnabled && (
                    <input type="time" value={notifPrefs.digestTime || "08:00"} onChange={e => setNotifPrefs(prev => ({ ...prev, digestTime: e.target.value }))} style={{ ...inputStyle, fontSize: 10, padding: "3px 6px", width: 80, marginLeft: "auto" }} />
                  )}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
                {profilePhoto && <button onClick={() => setProfilePhoto(null)} style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #FF444433", background: "#FF444412", color: "#FF6B6B", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>Remove Photo</button>}
                <button onClick={() => setShowProfileModal(false)} style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #1E2130", background: "#0A0C14", color: "#5A6178", cursor: "pointer", fontSize: 11 }}>Close</button>
                <button onClick={() => { _save("vgc_profile_photo", profilePhoto); _save("vgc_avatar", avatarConfig); _save("vgc_notif_prefs", notifPrefs); setShowProfileModal(false); }} style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #6366F1, #06B6D4)", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>💾 Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ AI AUTO-DRAFT EMAIL MODAL ═══ */}
      {threatEmailDraft && (
        <div style={{ position: "fixed", inset: 0, background: "#000000AA", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setThreatEmailDraft(null); }}>
          <div style={{ width: 620, maxHeight: "85vh", background: "#0F1117", borderRadius: 12, border: "1px solid #1E2130", overflow: "hidden", boxShadow: "0 20px 60px #00000066" }}>
            <div style={{ padding: "16px 20px", background: "#0A0C14", borderBottom: "1px solid #1E2130", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 16 }}>📧</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>AI Auto-Draft Email</div>
                  <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>
                    {azureOpenAI.enabled ? "Powered by VGC-AI Engine" : "Generated by VGC-AI Engine"} · {threatEmailDraft.id}
                  </div>
                </div>
              </div>
              <button onClick={() => setThreatEmailDraft(null)} style={{ background: "none", border: "none", color: "#5A6178", cursor: "pointer", fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 20, overflow: "auto", maxHeight: "65vh" }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>TO:</div>
                <input style={{ width: "100%", padding: "8px 12px", background: "#0A0C14", border: "1px solid #1E2130", borderRadius: 6, color: "#C4CAD6", fontSize: 12, fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box" }} defaultValue="itsupport@vgctechnology.com; helpdesk@vgctechnology.com" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>CC:</div>
                <input style={{ width: "100%", padding: "8px 12px", background: "#0A0C14", border: "1px solid #1E2130", borderRadius: 6, color: "#C4CAD6", fontSize: 12, fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box" }} defaultValue="hlaing@vgctechnology.com" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>SUBJECT:</div>
                <input style={{ width: "100%", padding: "8px 12px", background: "#0A0C14", border: "1px solid #1E2130", borderRadius: 6, color: "#E8ECF4", fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box" }} defaultValue={threatEmailDraft.emailSubject} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>BODY:</div>
                <textarea style={{ width: "100%", minHeight: 220, padding: "12px 14px", background: "#0A0C14", border: "1px solid #1E2130", borderRadius: 6, color: "#C4CAD6", fontSize: 12, lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif", resize: "vertical", boxSizing: "border-box" }} defaultValue={threatEmailDraft.emailBody} />
              </div>
              <div style={{ padding: "10px 12px", background: "#6366F108", borderRadius: 6, border: "1px solid #6366F122", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12 }}>⚠️</span>
                  <span style={{ fontSize: 10, color: "#FFB347", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                    This email draft by AI, you need to verify before sent
                  </span>
                  {azureOpenAI.enabled && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#81C784", boxShadow: "0 0 6px #81C78444", animation: "pulse 2s infinite", marginLeft: 4 }} />}
                </div>
                <div style={{ fontSize: 10, color: "#A0AEC0", marginTop: 4 }}>AI-generated content may contain inaccuracies. Please review all details carefully before sending.</div>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setThreatEmailDraft(null)} style={{ padding: "8px 20px", borderRadius: 6, border: "1px solid #1E2130", background: "#0A0C14", color: "#5A6178", cursor: "pointer", fontSize: 12 }}>Cancel</button>
                {azureOpenAI.enabled && (
                  <button onClick={async () => {
                    const aiBody = await callAzureOpenAI(
                      "You are VGC-ITSM security email drafter for VGC Technology Pte Ltd, Singapore. Write professional security advisory emails. Include threat details, risk level, actions required, and sign off as VGC Technology Pte Ltd IT Security Operations.",
                      `Draft a professional security advisory email about: ${threatEmailDraft.title}. Severity: ${threatEmailDraft.severity}. Summary: ${threatEmailDraft.aiSummary}. Include specific action items.`
                    );
                    if (aiBody) setThreatEmailDraft(prev => ({ ...prev, emailBody: aiBody }));
                  }} style={{ padding: "8px 20px", borderRadius: 6, border: "1px solid #6366F133", background: "#6366F118", color: "#6366F1", cursor: "pointer", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                    🔄 Regenerate with AI
                  </button>
                )}
                <button onClick={() => { setThreatEmailDraft(null); }} style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #6366F1, #06B6D4)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>✉️ Send via M365</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ AI Actions Panel — Global Overlay (accessible from all tabs) ═══ */}
      {showAiActionsPanel && (
        <div style={{ position: "fixed", inset: 0, background: "#00000088", zIndex: 1100, display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 60 }}
          onClick={e => { if (e.target === e.currentTarget) setShowAiActionsPanel(false); }}>
          <div style={{ width: 720, maxHeight: "80vh", background: "#12141E", borderRadius: 14, border: "1px solid #6366F133", boxShadow: "0 24px 48px #00000088", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {/* Header */}
            <div style={{ padding: "16px 20px", background: "linear-gradient(135deg, #EC4899, #6366F1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20 }}>🤖</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: "#fff", fontFamily: "'Space Grotesk', sans-serif" }}>AI Assist Actions</div>
                  <div style={{ fontSize: 11, color: "#ffffffaa" }}>Proactive monitoring with human-in-the-loop approval</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => runAiMonitor()} disabled={aiActionsLoading} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #ffffff33", background: aiActionsLoading ? "#ffffff11" : "#ffffff22", color: "#fff", cursor: aiActionsLoading ? "wait" : "pointer", fontSize: 11, fontWeight: 600 }}>
                  {aiActionsLoading ? "Scanning..." : "Scan Now"}
                </button>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={aiMonitorEnabled} onChange={e => { setAiMonitorEnabled(e.target.checked); _save("vgc_ai_monitor", e.target.checked); }} style={{ accentColor: "#EC4899" }} />
                  <span style={{ fontSize: 11, color: "#ffffffaa" }}>Auto-Monitor</span>
                </label>
                <button onClick={() => setShowAiActionsPanel(false)} style={{ background: "none", border: "none", color: "#ffffff88", cursor: "pointer", fontSize: 18 }}>✕</button>
              </div>
            </div>
            {/* Stats Bar */}
            <div style={{ padding: "10px 20px", background: "#0F1117", display: "flex", gap: 16, borderBottom: "1px solid #1E2130" }}>
              {[
                { label: "Pending", count: aiActions.filter(a => a.status === "pending_approval").length, color: "#FFB347" },
                { label: "Approved", count: aiActions.filter(a => a.status === "approved" || a.status === "executed" || a.status === "applied" || a.status === "auto_applied").length, color: "#4CAF50" },
                { label: "Rejected", count: aiActions.filter(a => a.status === "rejected").length, color: "#FF5252" },
                { label: "Auto-Triaged", count: aiActions.filter(a => a.type === "auto_triage").length, color: "#06B6D4" },
                { label: "Total", count: aiActions.length, color: "#6366F1" },
              ].map(s => (
                <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{s.count}</span>
                  <span style={{ fontSize: 10, color: "#5A6178" }}>{s.label}</span>
                </div>
              ))}
              {aiMonitorLastRun && <span style={{ fontSize: 10, color: "#5A6178", marginLeft: "auto" }}>Last scan: {new Date(aiMonitorLastRun).toLocaleTimeString("en-SG")}</span>}
            </div>
            {/* Action List */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
              {aiActions.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: "#5A6178" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>🛡️</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>All Clear</div>
                  <div style={{ fontSize: 12, marginTop: 6 }}>AI is actively monitoring. No action items detected.</div>
                  <button onClick={() => runAiMonitor()} style={{ marginTop: 16, padding: "8px 20px", borderRadius: 6, border: "1px solid #6366F133", background: "#6366F118", color: "#6366F1", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                    Run Manual Scan
                  </button>
                </div>
              ) : (
                aiActions.slice().sort((a, b) => {
                  const statusOrder = { pending_approval: 0, approved: 1, executed: 2, rejected: 3 };
                  const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
                  if ((statusOrder[a.status] || 0) !== (statusOrder[b.status] || 0)) return (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
                  return (sevOrder[a.severity] || 3) - (sevOrder[b.severity] || 3);
                }).map(action => {
                  const sevColors = { critical: "#FF4444", high: "#FF8800", medium: "#FFB347", low: "#4CAF50" };
                  const sevColor = sevColors[action.severity] || "#666";
                  const statusIcons = { pending_approval: "⏳", approved: "✅", executed: "🚀", rejected: "❌", failed: "⚠️" };
                  const statusLabels = { pending_approval: "Pending Approval", approved: "Approved", executed: "Executed", rejected: "Rejected", failed: "Failed" };
                  return (
                    <div key={action.id} style={{
                      padding: "14px 16px", marginBottom: 10, borderRadius: 10,
                      background: action.status === "pending_approval" ? "#1E213044" : "#0F111788",
                      border: `1px solid ${action.status === "pending_approval" ? sevColor + "44" : "#1E213033"}`,
                      transition: "all 0.2s"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                            <span style={{ fontSize: 14 }}>{statusIcons[action.status] || "⏳"}</span>
                            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: sevColor + "22", color: sevColor, fontWeight: 700, textTransform: "uppercase" }}>{action.severity}</span>
                            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#6366F122", color: "#6366F1", fontWeight: 600 }}>{action.type}</span>
                            {action.incidentId && <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#EC489922", color: "#EC4899", fontWeight: 600 }}>🎫 {action.incidentId}</span>}
                            <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#0F1117", color: "#5A6178" }}>{statusLabels[action.status]}</span>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#E8ECF4", marginBottom: 4 }}>{action.title}</div>
                          <div style={{ fontSize: 11, color: "#8B8FA3", lineHeight: 1.5 }}>{action.description}</div>
                        </div>
                        {action.confidence && (
                          <div style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "#81C78422", color: "#81C784", fontWeight: 600, whiteSpace: "nowrap" }}>🎯 {action.confidence}%</div>
                        )}
                      </div>
                      {action.suggestedAction && (
                        <div style={{ padding: "8px 12px", background: "#6366F108", borderRadius: 6, border: "1px solid #6366F122", marginBottom: 8 }}>
                          <div style={{ fontSize: 9, color: "#6366F1", fontWeight: 700, marginBottom: 2 }}>💡 AI Suggested Action</div>
                          <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.4 }}>{action.suggestedAction}</div>
                        </div>
                      )}
                      {/* AI Auto-Triage Card (Phase 1) */}
                      {action.type === "auto_triage" && action.triage && (
                        <div style={{ padding: "10px 14px", background: "linear-gradient(135deg, #6366F108, #06B6D408)", borderRadius: 8, border: "1px solid #6366F133", marginBottom: 8 }}>
                          <div style={{ fontSize: 9, color: "#06B6D4", fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>🤖 AI TRIAGE RECOMMENDATION</div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                            <div style={{ padding: "6px 8px", background: "#0A0C14", borderRadius: 6, textAlign: "center" }}>
                              <div style={{ fontSize: 8, color: "#5A6178", textTransform: "uppercase", marginBottom: 3 }}>Category</div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#64B5F6" }}>{action.triage.category}</div>
                            </div>
                            <div style={{ padding: "6px 8px", background: "#0A0C14", borderRadius: 6, textAlign: "center" }}>
                              <div style={{ fontSize: 8, color: "#5A6178", textTransform: "uppercase", marginBottom: 3 }}>Priority</div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: action.triage.priority === "Sev-A" ? "#FF4444" : action.triage.priority === "Sev-B" ? "#FF8800" : action.triage.priority === "Sev-D" ? "#4CAF50" : "#FFB347" }}>{action.triage.priority}</div>
                            </div>
                            <div style={{ padding: "6px 8px", background: "#0A0C14", borderRadius: 6, textAlign: "center" }}>
                              <div style={{ fontSize: 8, color: "#5A6178", textTransform: "uppercase", marginBottom: 3 }}>Assignee</div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#CE93D8" }}>{action.triage.assignee}</div>
                            </div>
                            <div style={{ padding: "6px 8px", background: "#0A0C14", borderRadius: 6, textAlign: "center" }}>
                              <div style={{ fontSize: 8, color: "#5A6178", textTransform: "uppercase", marginBottom: 3 }}>SLA Target</div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#81C784" }}>{action.triage.suggestedSlaTarget}h</div>
                            </div>
                          </div>
                          {action.reasoning && (
                            <div style={{ padding: "6px 10px", background: "#0A0C14", borderRadius: 4, border: "1px solid #6366F111" }}>
                              <div style={{ fontSize: 9, color: "#6366F1", fontWeight: 600, marginBottom: 2 }}>🧠 Reasoning</div>
                              <div style={{ fontSize: 10, color: "#A0AEC0", lineHeight: 1.4 }}>{action.reasoning}</div>
                            </div>
                          )}
                          {action.confidence && (
                            <div style={{ marginTop: 8, height: 4, background: "#1E2130", borderRadius: 2, overflow: "hidden" }}>
                              <div style={{ width: `${action.confidence}%`, height: "100%", borderRadius: 2, background: action.confidence >= 85 ? "#4CAF50" : action.confidence >= 60 ? "#FFB347" : "#FF5252" }} />
                            </div>
                          )}
                        </div>
                      )}
                      {/* SLA Prevention Card */}
                      {action.type === "sla_prevention" && action.prediction && (
                        <div style={{ padding: "10px 14px", background: "linear-gradient(135deg, #EC489908, #FF444408)", borderRadius: 8, border: "1px solid #EC489933", marginBottom: 8 }}>
                          <div style={{ fontSize: 9, color: "#EC4899", fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>🔮 SLA BREACH PREDICTION</div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                            <div style={{ padding: "6px 8px", background: "#0A0C14", borderRadius: 6, textAlign: "center" }}>
                              <div style={{ fontSize: 8, color: "#5A6178", textTransform: "uppercase", marginBottom: 3 }}>Breach Risk</div>
                              <div style={{ fontSize: 14, fontWeight: 700, color: action.prediction.breachProbability >= 90 ? "#FF4444" : "#FFB347" }}>{action.prediction.breachProbability}%</div>
                            </div>
                            <div style={{ padding: "6px 8px", background: "#0A0C14", borderRadius: 6, textAlign: "center" }}>
                              <div style={{ fontSize: 8, color: "#5A6178", textTransform: "uppercase", marginBottom: 3 }}>ETA to Breach</div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#FF6B6B" }}>{action.prediction.predictedBreachIn}</div>
                            </div>
                            <div style={{ padding: "6px 8px", background: "#0A0C14", borderRadius: 6, textAlign: "center" }}>
                              <div style={{ fontSize: 8, color: "#5A6178", textTransform: "uppercase", marginBottom: 3 }}>Action</div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "#06B6D4" }}>{action.prediction.suggestedAction}</div>
                            </div>
                          </div>
                        </div>
                      )}
                      {/* KB Draft Card */}
                      {action.type === "kb_draft" && action.kbDraft && (
                        <div style={{ padding: "10px 14px", background: "linear-gradient(135deg, #81C78408, #06B6D408)", borderRadius: 8, border: "1px solid #81C78433", marginBottom: 8 }}>
                          <div style={{ fontSize: 9, color: "#81C784", fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>📚 AI-GENERATED KB ARTICLE</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#E8ECF4", marginBottom: 4 }}>{action.kbDraft.title}</div>
                          <div style={{ fontSize: 10, color: "#8B92A8", marginBottom: 4 }}>Category: {action.kbDraft.category} · Tags: {(action.kbDraft.tags || []).join(", ")}</div>
                          <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.4, maxHeight: 80, overflow: "hidden", padding: "6px 10px", background: "#0A0C14", borderRadius: 4 }}>{(action.kbDraft.content || "").substring(0, 300)}...</div>
                        </div>
                      )}
                      {/* Preventive Action Card */}
                      {action.type === "preventive_action" && action.pattern && (
                        <div style={{ padding: "10px 14px", background: "linear-gradient(135deg, #FFB34708, #FF8C0008)", borderRadius: 8, border: "1px solid #FFB34733", marginBottom: 8 }}>
                          <div style={{ fontSize: 9, color: "#FFB347", fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>🔍 PATTERN-BASED PREVENTION</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#E8ECF4", marginBottom: 4 }}>{action.pattern.title || action.title}</div>
                          <div style={{ fontSize: 10, color: "#8B92A8", marginBottom: 4 }}>Type: {action.pattern.type} · Confidence: {action.pattern.confidence}%</div>
                          <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.4 }}>{action.pattern.suggestedPrevention}</div>
                        </div>
                      )}
                      {/* Create Problem Card */}
                      {action.type === "create_problem" && action.problemDraft && (
                        <div style={{ padding: "10px 14px", background: "linear-gradient(135deg, #CE93D808, #6366F108)", borderRadius: 8, border: "1px solid #CE93D833", marginBottom: 8 }}>
                          <div style={{ fontSize: 9, color: "#CE93D8", fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>🎯 PROBLEM RECORD DRAFT</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#E8ECF4", marginBottom: 4 }}>{action.problemDraft.title}</div>
                          <div style={{ fontSize: 10, color: "#8B92A8", marginBottom: 4 }}>Priority: {action.problemDraft.priority} · Category: {action.problemDraft.category}</div>
                          <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.4, marginBottom: 4 }}>{(action.problemDraft.description || "").substring(0, 200)}</div>
                          {action.problemDraft.linkedIncidents && <div style={{ fontSize: 9, color: "#6366F1" }}>Linked: {action.problemDraft.linkedIncidents.join(", ")}</div>}
                        </div>
                      )}
                      {action.internalNote && (
                        <div style={{ padding: "8px 12px", background: "#FFB34708", borderRadius: 6, border: "1px solid #FFB34722", marginBottom: 8 }}>
                          <div style={{ fontSize: 9, color: "#FFB347", fontWeight: 700, marginBottom: 2 }}>📋 Internal Note</div>
                          <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.4 }}>{action.internalNote}</div>
                        </div>
                      )}
                      {action.emailDraft && (
                        <div style={{ padding: "8px 12px", background: "#06B6D408", borderRadius: 6, border: "1px solid #06B6D422", marginBottom: 8 }}>
                          <div style={{ fontSize: 9, color: "#06B6D4", fontWeight: 700, marginBottom: 2 }}>📧 Email Draft</div>
                          <div style={{ fontSize: 10, color: "#8B8FA3" }}>To: {action.emailDraft.to}</div>
                          <div style={{ fontSize: 10, color: "#8B8FA3" }}>Subject: {action.emailDraft.subject}</div>
                          <div style={{ fontSize: 11, color: "#C4CAD6", lineHeight: 1.4, marginTop: 4 }}>{(action.emailDraft.body || "").substring(0, 200)}...</div>
                        </div>
                      )}
                      {action.executionResult && (
                        <div style={{ padding: "6px 12px", background: "#4CAF5008", borderRadius: 6, border: "1px solid #4CAF5022", marginBottom: 8, fontSize: 10, color: "#4CAF50" }}>
                          🚀 Result: {JSON.stringify(action.executionResult)}
                        </div>
                      )}
                      {/* Action Buttons — Only for pending items */}
                      {action.status === "pending_approval" && (
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          {action.type === "auto_triage" ? (
                            <>
                              <button onClick={() => applyAiTriage(action.id)} style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #6366F1, #06B6D4)", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                                🤖 Apply Triage
                              </button>
                              <button onClick={() => rejectAiAction(action.id, "Triage not applicable")} style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid #FF525244", background: "#FF525211", color: "#FF5252", cursor: "pointer", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                                ❌ Reject
                              </button>
                            </>
                          ) : action.type === "kb_draft" ? (
                            <>
                              <button onClick={() => approveKBDraft(action.id)} style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #81C784, #4CAF50)", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                                📚 Publish KB Article
                              </button>
                              <button onClick={() => rejectAiAction(action.id, "KB not needed")} style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid #FF525244", background: "#FF525211", color: "#FF5252", cursor: "pointer", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                                ❌ Reject
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => approveAiAction(action.id)} style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "none", background: "linear-gradient(135deg, #4CAF50, #45a049)", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                                ✅ Approve & Execute
                              </button>
                              <button onClick={() => rejectAiAction(action.id, "Not needed")} style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid #FF525244", background: "#FF525211", color: "#FF5252", cursor: "pointer", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                                ❌ Reject
                              </button>
                              <button onClick={() => sendAiApprovalEmail(action.id)} title="Send approval request via Outlook email" style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #06B6D444", background: "#06B6D411", color: "#06B6D4", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                                📧
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      {action.status === "auto_applied" && (
                        <div style={{ padding: "6px 12px", background: "#4CAF5008", borderRadius: 6, border: "1px solid #4CAF5022", marginTop: 6, fontSize: 10, color: "#4CAF50", display: "flex", alignItems: "center", gap: 6 }}>
                          ✅ Auto-applied (high confidence: {action.confidence}%)
                        </div>
                      )}
                      {action.status === "applied" && (
                        <div style={{ padding: "6px 12px", background: "#6366F108", borderRadius: 6, border: "1px solid #6366F122", marginTop: 6, fontSize: 10, color: "#6366F1", display: "flex", alignItems: "center", gap: 6 }}>
                          ✅ Triage applied by {action.approvedBy} at {action.approvedAt ? new Date(action.approvedAt).toLocaleString("en-SG") : ""}
                        </div>
                      )}
                      {(action.approvedBy || action.rejectedBy) && (
                        <div style={{ fontSize: 10, color: "#5A6178", marginTop: 6 }}>
                          {action.approvedBy && `Approved by ${action.approvedBy} at ${new Date(action.approvedAt).toLocaleString("en-SG")}`}
                          {action.rejectedBy && `Rejected by ${action.rejectedBy} at ${new Date(action.rejectedAt).toLocaleString("en-SG")}${action.rejectionReason ? ` — "${action.rejectionReason}"` : ""}`}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            {/* Footer */}
            <div style={{ padding: "10px 20px", background: "#0A0C14", borderTop: "1px solid #1E2130", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 10, color: "#5A6178" }}>All AI actions require human approval before execution. Results are internal only.</div>
              <button onClick={() => { setAiActions([]); _save("vgc_ai_actions", []); }} style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid #1E2130", background: "none", color: "#5A6178", cursor: "pointer", fontSize: 10 }}>Clear History</button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Assisted by AI Button — 3D Avatar */}
      <div ref={aiContainerRef} style={{
        position: "fixed", bottom: aiPos.y, right: aiPos.x, zIndex: 999,
        display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12
      }}>
        {showAiPanel && (
          <div style={{
            width: aiChatExpanded ? 680 : 420, background: "#12141E", borderRadius: 16, border: "1px solid #6366F133",
            boxShadow: "0 24px 48px #00000066, 0 0 30px #6366F111",
            overflow: "hidden", animation: "aiBorderPulse 3s ease-in-out infinite",
            transition: "width 0.3s ease, max-height 0.3s ease",
            maxHeight: aiChatExpanded ? "85vh" : "auto", display: "flex", flexDirection: "column"
          }}>
            {/* Header — VGC AI Command Center */}
            <div
              onMouseDown={handleAiDragStart} onTouchStart={handleAiDragStart}
              style={{
              padding: "12px 18px", background: "linear-gradient(135deg, #6366F1, #4F46E5)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              cursor: "grab", userSelect: "none"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, cursor: "grab", color: "#ffffff55" }}>⠿</span>
                <div style={{ width: 30, height: 30, borderRadius: 10, overflow: "hidden", background: profilePhoto ? `url(${profilePhoto}) center/cover no-repeat` : "linear-gradient(135deg, #1E2130, #0F1117)", display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #ffffff33" }}>
                  {!profilePhoto && <span style={{ fontSize: 11, fontWeight: 700, color: "#E8ECF4" }}>{currentUser.avatar}</span>}
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: "'Space Grotesk', sans-serif" }}>VGC AI Command Center</span>
                  <span style={{ fontSize: 9, color: "#ffffff88", fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: azureOpenAI.enabled ? "#81C784" : "#FFB347", display: "inline-block" }} />
                    {azureOpenAI.enabled ? "VGC-AI Engine" : "Local AI"} · {currentUser.name}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button onClick={() => { setAiMessages(prev => [prev[0]]); setAiEditingIdx(null); }} style={{ background: "none", border: "none", color: "#ffffff55", cursor: "pointer", fontSize: 12, padding: "2px 4px", borderRadius: 4, transition: "background 0.2s" }} title="Clear chat"
                  onMouseOver={e => e.currentTarget.style.background = "#ffffff22"}
                  onMouseOut={e => e.currentTarget.style.background = "none"}>🗑️</button>
                <button onClick={() => setAiChatExpanded(!aiChatExpanded)} style={{ background: "none", border: "none", color: "#ffffffaa", cursor: "pointer", fontSize: 14, padding: "2px 4px", borderRadius: 4, transition: "background 0.2s" }} title={aiChatExpanded ? "Compact" : "Expand"}
                  onMouseOver={e => e.currentTarget.style.background = "#ffffff22"}
                  onMouseOut={e => e.currentTarget.style.background = "none"}>
                  {aiChatExpanded ? "⊟" : "⊞"}
                </button>
                <button onClick={() => { setShowAiPanel(false); setShowSlashMenu(false); }} style={{ background: "none", border: "none", color: "#ffffff88", cursor: "pointer", fontSize: 16 }}>✕</button>
              </div>
            </div>
            {/* WhatsApp-style Messages Area */}
            <div style={{ padding: "14px 16px", maxHeight: aiChatExpanded ? "60vh" : 400, overflowY: "auto", scrollBehavior: "smooth", flex: 1, background: "#0D0F18" }}>
              {/* Welcome state when only initial message */}
              {aiMessages.length <= 1 && (
                <div style={{ textAlign: "center", padding: "24px 12px" }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>🚀</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", marginBottom: 6 }}>VGC AI Command Center</div>
                  <div style={{ fontSize: 11, color: "#8B92A8", lineHeight: 1.5, marginBottom: 16 }}>Create tickets, check SLA, draft emails, search KB, and more.<br/>Type <code style={{ background: "#1E2130", padding: "1px 4px", borderRadius: 3, color: "#6366F1", fontSize: 10 }}>/</code> to see all commands.</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[
                      { icon: "📊", label: "Morning Briefing", action: "Give me my morning briefing" },
                      { icon: "🎫", label: "Open Tickets", action: "Show open incidents" },
                      { icon: "⏱️", label: "SLA Status", action: "Check SLA compliance" },
                      { icon: "📧", label: "Draft Email", action: "Help me draft an email" },
                      { icon: "📚", label: "Search KB", action: "Search knowledge base" },
                      { icon: "🛡️", label: "Security Check", action: "Any security threats?" },
                    ].map(q => (
                      <button key={q.action} onClick={() => handleAiChat(q.action)} style={{
                        padding: "10px 12px", borderRadius: 10, background: "#12141E", border: "1px solid #1E2130",
                        cursor: "pointer", display: "flex", alignItems: "center", gap: 8, transition: "all 0.2s",
                        textAlign: "left"
                      }}
                      onMouseOver={e => { e.currentTarget.style.borderColor = "#6366F144"; e.currentTarget.style.background = "#1E213044"; }}
                      onMouseOut={e => { e.currentTarget.style.borderColor = "#1E2130"; e.currentTarget.style.background = "#12141E"; }}>
                        <span style={{ fontSize: 18, flexShrink: 0 }}>{q.icon}</span>
                        <span style={{ fontSize: 11, color: "#C4CAD6", fontWeight: 600 }}>{q.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {aiMessages.map((msg, i) => {
                if (i === 0 && aiMessages.length <= 1) return null; // skip welcome msg when showing welcome state
                return (
                <div key={i} className={msg._proactive ? "chat-proactive-bubble" : "chat-msg-bubble"} style={{ marginBottom: 12, display: "flex", flexDirection: msg.role === "user" ? "row-reverse" : "row", gap: 8 }}>
                  {/* Avatar */}
                  <div style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0, marginTop: 2,
                    background: msg.role === "ai" ? "linear-gradient(135deg, #6366F1, #4F46E5)" : (profilePhoto ? `url(${profilePhoto}) center/cover no-repeat` : "#1E2130"),
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: msg.role === "ai" ? 11 : 9, color: "#fff", fontWeight: 700,
                    border: msg.role === "ai" ? "1.5px solid #6366F144" : "1px solid #1E213066",
                    overflow: "hidden"
                  }}>{msg.role === "ai" ? "V" : (!profilePhoto ? currentUser.avatar : "")}</div>
                  <div style={{ maxWidth: "82%", display: "flex", flexDirection: "column", gap: 4 }}>
                    {/* Bubble */}
                    <div style={{
                      padding: "10px 14px",
                      borderRadius: msg.role === "user" ? "14px 4px 14px 14px" : "4px 14px 14px 14px",
                      fontSize: 12.5,
                      background: msg.role === "ai" ? "#12141E" : "linear-gradient(135deg, #6366F1, #4F46E5)",
                      border: msg.role === "ai" ? "1px solid #1E213066" : "none",
                      color: msg.role === "user" ? "#fff" : "#C4CAD6", lineHeight: 1.6, whiteSpace: "pre-line",
                      boxShadow: msg.role === "user" ? "0 2px 8px #6366F133" : "0 1px 4px #00000022"
                    }}>
                      {msg.role === "ai" ? renderAiRichText(msg.text, handleTicketLinkClick) : msg.text}
                      {msg.role === "ai" && !msg._typing && (
                        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 4, fontSize: 8, color: "#5A617888" }}>
                          <span style={{
                            color: msg.source === "azure" ? "#06B6D4" : "#FFB347",
                            fontFamily: "'JetBrains Mono', monospace",
                            display: "inline-flex", alignItems: "center", gap: 3
                          }}>
                            {msg.source === "azure" ? "⚡ VGC AI" : "🧠 Local AI"}
                          </span>
                          {i > 0 && msg.prompt && (
                            <button onClick={() => { if (aiEditingIdx === i) { setAiEditingIdx(null); setAiEditText(""); } else { setAiEditingIdx(i); setAiEditText(msg.text); } }} style={{ background: "none", border: "1px solid #6366F122", borderRadius: 3, padding: "1px 5px", fontSize: 8, color: "#6366F1", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 2 }} title="Edit & correct this answer — VGC AI will learn">
                              ✏️ {aiEditingIdx === i ? "Cancel" : "Correct"}
                            </button>
                          )}
                        </div>
                      )}
                      {msg.role === "ai" && msg._typing && (
                        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 4, borderTop: "1px solid #1E213044", paddingTop: 4 }}>
                          <span style={{ fontSize: 8, color: "#06B6D4", background: "#06B6D411", border: "1px solid #06B6D422", padding: "1px 6px", borderRadius: 3, fontFamily: "'JetBrains Mono', monospace", display: "inline-flex", alignItems: "center", gap: 3 }}>⚡ VGC AI</span>
                        </div>
                      )}
                    </div>
                    {/* Inline Edit/Correction Form */}
                    {aiEditingIdx === i && (
                      <div style={{ padding: "8px 10px", borderRadius: 8, background: "#0F1117", border: "1px solid #FFB34733" }}>
                        <div style={{ fontSize: 9, color: "#FFB347", fontWeight: 700, marginBottom: 4, fontFamily: "'Space Grotesk', sans-serif" }}>✏️ Correct this answer — VGC AI will learn</div>
                        <textarea value={aiEditText} onChange={e => setAiEditText(e.target.value)} style={{ width: "100%", minHeight: 60, padding: "6px 8px", fontSize: 11, background: "#0A0C14", border: "1px solid #1E2130", borderRadius: 6, color: "#E8ECF4", resize: "vertical", fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.4, boxSizing: "border-box" }} />
                        <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
                          <button onClick={() => { setAiEditingIdx(null); setAiEditText(""); }} style={{ padding: "4px 10px", fontSize: 9, background: "none", border: "1px solid #1E2130", borderRadius: 4, color: "#5A6178", cursor: "pointer" }}>Cancel</button>
                          <button disabled={aiEditSaving || !aiEditText.trim()} onClick={async () => {
                            setAiEditSaving(true);
                            try {
                              const r = await fetch("/api/ai/knowledge/correction", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ originalQuestion: msg.prompt, originalAnswer: msg.text, correctedAnswer: aiEditText.trim(), correctedBy: currentUser.name }) });
                              if (r.ok) {
                                setAiMessages(prev => { const u = [...prev]; u[i] = { ...u[i], text: aiEditText.trim(), corrected: true }; return u; });
                              }
                            } catch(e) { console.error('[VGC AI Correct]', e.message); }
                            setAiEditSaving(false);
                          }} style={{ padding: "4px 12px", fontSize: 9, background: aiEditSaving ? "#FFB34744" : "linear-gradient(135deg, #FFB347, #FF9800)", border: "none", borderRadius: 4, color: "#fff", cursor: aiEditSaving ? "wait" : "pointer", fontWeight: 700 }}>
                            {aiEditSaving ? "Saving..." : "💾 Save & Train"}
                      
                    {/* AI Interactive Cards — new card system */}
                    {msg.role === "ai" && !msg._typing && msg.cards && msg.cards.length > 0 && (
                      <CardRenderer cards={msg.cards} onAction={handleCardAction} />
                    )}
                    {/* Legacy AI Action Cards — backward compat */}
                    {msg.role === "ai" && !msg._typing && !msg.cards && msg.actionCards && msg.actionCards.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
                        {msg.actionCards.map((card, ci) => (
                          <div key={ci} onClick={card.action} style={{
                            padding: "8px 12px", borderRadius: 8, background: "#6366F108", border: "1px solid #6366F122",
                            cursor: "pointer", display: "flex", alignItems: "center", gap: 8, transition: "all 0.2s"
                          }}
                          onMouseOver={e => { e.currentTarget.style.background = "#6366F118"; e.currentTarget.style.borderColor = "#6366F144"; }}
                          onMouseOut={e => { e.currentTarget.style.background = "#6366F108"; e.currentTarget.style.borderColor = "#6366F122"; }}>
                            <span style={{ fontSize: 16, flexShrink: 0 }}>{card.icon}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#E8ECF4" }}>{card.title}</div>
                              <div style={{ fontSize: 9, color: "#8B8FA3", marginTop: 1 }}>{card.description}</div>
                            </div>
                            <span style={{ fontSize: 9, color: "#6366F1", fontWeight: 600, whiteSpace: "nowrap" }}>{card.btnLabel}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Corrected badge */}
                    {msg.corrected && (
                      <div style={{ fontSize: 8, color: "#81C784", display: "flex", alignItems: "center", gap: 3, marginTop: 2 }}>
                        <span>✅</span> Corrected by {currentUser.name} — VGC AI will use this in future
                      </div>
                    )}    </button>
                        </div>
                      </div>
                    )}
                    {/* Suggestion Cards — new card system */}
                    {msg.role === "ai" && !msg._typing && msg.suggestionCards && msg.suggestionCards.length > 0 && i === aiMessages.length - 1 && (
                      <CardRenderer cards={msg.suggestionCards} onAction={handleCardAction} />
                    )}
                    {/* Legacy Suggested Reply Mini-Cards — backward compat */}
                    {msg.role === "ai" && !msg._typing && !msg.suggestionCards && msg.suggestions && msg.suggestions.length > 0 && i === aiMessages.length - 1 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}> 
                        {msg.suggestions.slice(0, 4).map((s, si) => (
                          <button key={si} onClick={() => handleAiChat(s.action)} style={{
                            padding: "6px 12px", fontSize: 10, background: "#12141E",
                            border: "1px solid #6366F133", borderRadius: 10, color: "#C4CAD6", cursor: "pointer",
                            fontFamily: "'Space Grotesk', sans-serif", transition: "all 0.2s",
                            display: "inline-flex", alignItems: "center", gap: 4
                          }}
                          onMouseOver={e => { e.currentTarget.style.background = "#6366F118"; e.currentTarget.style.borderColor = "#6366F155"; e.currentTarget.style.color = "#E8ECF4"; }}
                          onMouseOut={e => { e.currentTarget.style.background = "#12141E"; e.currentTarget.style.borderColor = "#6366F133"; e.currentTarget.style.color = "#C4CAD6"; }}>
                            💡 {s.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
              })}
              {aiLoading && (
                <div style={{ marginBottom: 8, display: "flex", gap: 8 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                    background: "linear-gradient(135deg, #6366F1, #4F46E5)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#fff", fontWeight: 700,
                    border: "1.5px solid #6366F144"
                  }}>V</div>
                  <div style={{
                    padding: "10px 14px", borderRadius: "4px 14px 14px 14px", background: "#12141E",
                    border: "1px solid #1E213066", display: "flex", gap: 4, alignItems: "center"
                  }}>
                    {[0,1,2].map(d => (
                      <div key={d} style={{
                        width: 6, height: 6, borderRadius: "50%", background: "#6366F1",
                        animation: `pulse 1.2s ease-in-out ${d * 0.2}s infinite`
                      }} />
                    ))}
                    <span style={{ color: "#5A6178", fontSize: 10, marginLeft: 6 }}>
                      {azureOpenAI.enabled ? "Typing a response..." : "Thinking..."}
                    </span>
                  </div>
                </div>
              )}
              <div ref={floatingChatEndRef} />
            </div>
            {/* Slash Command Palette */}
            {showSlashMenu && (
              <div style={{ maxHeight: 240, overflowY: "auto", borderTop: "1px solid #1E2130", background: "#0D0F18", padding: "8px 0" }}>
                <div style={{ padding: "2px 14px 6px", fontSize: 9, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1 }}>Commands</div>
                {(() => {
                  const filtered = SLASH_COMMANDS.filter(c => !slashFilter || c.cmd.toLowerCase().includes(slashFilter.toLowerCase()) || c.label.toLowerCase().includes(slashFilter.toLowerCase()));
                  const groups = {};
                  filtered.forEach(c => { (groups[c.category] = groups[c.category] || []).push(c); });
                  return Object.entries(groups).map(([cat, cmds]) => (
                    <div key={cat}>
                      <div style={{ padding: "4px 14px 2px", fontSize: 8, color: "#6366F1", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", textTransform: "uppercase", letterSpacing: 1 }}>{cat}</div>
                      {cmds.map(c => (
                        <div key={c.cmd} onClick={() => { setAiInput(""); setShowSlashMenu(false); setSlashFilter(""); handleAiChat(c.cmd); }}
                          style={{ padding: "6px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, transition: "background 0.15s" }}
                          onMouseOver={e => e.currentTarget.style.background = "#1E213044"}
                          onMouseOut={e => e.currentTarget.style.background = "transparent"}>
                          <span style={{ fontSize: 16, flexShrink: 0 }}>{c.icon}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "#E8ECF4" }}>{c.label}</div>
                            <div style={{ fontSize: 9, color: "#5A6178" }}>{c.desc}</div>
                          </div>
                          <span style={{ fontSize: 9, color: "#5A617855", fontFamily: "'JetBrains Mono', monospace" }}>{c.cmd}</span>
                        </div>
                      ))}
                    </div>
                  ));
                })()}
              </div>
            )}
            {/* Input Footer */}
            <div style={{ padding: "10px 14px", borderTop: "1px solid #1E2130", display: "flex", gap: 8, alignItems: "center", background: "#12141E" }}>
              <input style={{ ...inputStyle, flex: 1, fontSize: 12, borderRadius: 10, padding: "8px 14px" }} value={aiInput}
                onChange={e => {
                  setAiInput(e.target.value);
                  if (e.target.value === "/") { setShowSlashMenu(true); setSlashFilter(""); }
                  else if (e.target.value.startsWith("/")) { setShowSlashMenu(true); setSlashFilter(e.target.value.slice(1)); }
                  else { setShowSlashMenu(false); setSlashFilter(""); }
                }}
                placeholder={azureOpenAI.enabled ? "Message VGC AI... (type / for commands)" : "Ask me anything..."}
                disabled={aiLoading}
                onKeyDown={e => {
                  if (e.key === "Enter" && aiInput.trim() && !aiLoading) { setShowSlashMenu(false); setSlashFilter(""); handleAiChat(); }
                  if (e.key === "Escape") { setShowSlashMenu(false); setSlashFilter(""); }
                }} />
              <button style={{
                background: "linear-gradient(135deg, #6366F1, #4F46E5)", border: "none", borderRadius: 10, padding: "8px 14px",
                fontSize: 13, color: "#fff", cursor: aiLoading ? "wait" : "pointer", opacity: aiLoading ? 0.5 : 1, transition: "all 0.2s",
                fontWeight: 700, display: "flex", alignItems: "center", gap: 4
              }} disabled={aiLoading} onClick={() => { setShowSlashMenu(false); setSlashFilter(""); handleAiChat(); }}>⚡</button>
              <button onClick={() => document.getElementById("kb-quick-upload-chat")?.click()} style={{ ...btnStyle("#2B579A"), fontSize: 11, padding: "6px 10px", borderRadius: 8 }} title="Upload document for AI training">📎</button>
              <input id="kb-quick-upload-chat" type="file" multiple accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.txt,.csv,.md,.json" style={{ display: "none" }} onChange={e => {
                const files = Array.from(e.target.files);
                if (files.length === 0) return;
                setShowFloatingKbTraining(true);
                handleKbFileUpload(e.target.files);
                e.target.value = "";
              }} />
            </div>
            {/* Inline AI Training Panel */}
            {showFloatingKbTraining && (
              <div style={{ padding: "10px 14px", borderTop: "1px solid #00BF6F33", background: "#0A0C14", maxHeight: aiChatExpanded ? 400 : 260, overflowY: "auto" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#00BF6F", marginBottom: 6, display: "flex", alignItems: "center", gap: 6, fontFamily: "'Space Grotesk', sans-serif" }}>
                  <span>🧠</span> Train AI — Improve Answers
                  <span style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
                    <span style={{ fontSize: 8, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>{kbEntries.length} entries</span>
                    <button onClick={async () => {
                      try { const r = await fetch("/api/ai/knowledge/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); const d = await r.json(); fetchKbEntries(); trackAction("AI Training", "Knowledge Sync", `${d.syncedThisRun || 0} new entries synced. Total: ${d.totalEntries}`, "AI"); setAiMessages(prev => [...prev, { role: "ai", text: `🔄 Synced! ${d.syncedThisRun || 0} new entries. Total: ${d.totalEntries}`, source: "azure" }]); } catch (e) { /* ignore */ }
                    }} style={{ background: "none", border: "1px solid #06B6D433", borderRadius: 3, padding: "1px 5px", fontSize: 8, color: "#06B6D4", cursor: "pointer" }} title="Sync all knowledge system-wide">🔄</button>
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 4, background: "#06B6D408", border: "1px solid #06B6D418", marginBottom: 6 }}>
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#81C784" }} />
                  <span style={{ fontSize: 8, color: "#8A8FA8" }}>Provide correct answers, upload docs — AI learns and improves accuracy</span>
                </div>
                <input style={{ ...inputStyle, fontSize: 10, width: "100%", marginBottom: 6, boxSizing: "border-box" }} placeholder="Title (e.g. VPN Setup Guide)" value={kbForm.title} onChange={e => setKbForm(p => ({ ...p, title: e.target.value }))} />
                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <select style={{ ...inputStyle, fontSize: 10, flex: 1 }} value={kbForm.category} onChange={e => setKbForm(p => ({ ...p, category: e.target.value }))}>
                    {["General", "Networking", "Security", "Hardware", "Software", "Email", "VPN", "Firewall", "Printing", "SOP", "Troubleshooting"].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input style={{ ...inputStyle, fontSize: 10, flex: 1 }} placeholder="Tags (comma-sep)" value={kbForm.tags} onChange={e => setKbForm(p => ({ ...p, tags: e.target.value }))} />
                </div>
                <textarea style={{ ...inputStyle, fontSize: 10, width: "100%", minHeight: 50, resize: "vertical", marginBottom: 6, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.4, boxSizing: "border-box" }} placeholder="Knowledge content — procedures, solutions, troubleshooting..." value={kbForm.content} onChange={e => setKbForm(p => ({ ...p, content: e.target.value }))} />
                {/* File Upload */}
                <div style={{ marginBottom: 6, border: "1px dashed #1E213066", borderRadius: 6, padding: 8, cursor: "pointer", transition: "border-color 0.2s" }}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#6366F1"; }}
                  onDragLeave={e => { e.currentTarget.style.borderColor = "#1E213066"; }}
                  onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#1E213066"; handleKbFileUpload(e.dataTransfer.files); }}
                  onClick={() => document.getElementById("kb-file-upload-floating")?.click()}>
                  <input id="kb-file-upload-floating" type="file" multiple accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.txt,.csv,.md,.json,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.mov" style={{ display: "none" }} onChange={e => handleKbFileUpload(e.target.files)} />
                  <div style={{ fontSize: 9, color: "#8A8FA8" }}>📎 Drop files or click — Word, Excel, PPT, PDF, Images, Videos</div>
                </div>
                {kbUploadFiles.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    {kbUploadFiles.map((f, idx) => (
                      <div key={idx} style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 6px", marginBottom: 2, background: "#0F1117", borderRadius: 3, fontSize: 9 }}>
                        <span>{f.type === "Word" ? "📄" : f.type === "Excel" ? "📊" : f.type === "PowerPoint" ? "📽️" : f.type === "Image" ? "🖼️" : f.type === "Video" ? "🎬" : "📎"}</span>
                        <span style={{ color: "#C4CAD6", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                        {f.done ? <span style={{ color: "#81C784" }}>✅</span> : <button onClick={() => setKbUploadFiles(prev => prev.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", color: "#FF6B6B", cursor: "pointer", fontSize: 8, padding: 0 }}>✕</button>}
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={kbUploadFiles.length > 0 ? submitKbWithFiles : submitKbEntry} disabled={!kbForm.title.trim() || (!kbForm.content.trim() && kbUploadFiles.length === 0)} style={{ ...btnStyle("#00BF6F"), fontSize: 10, width: "100%", opacity: (!kbForm.title.trim() || (!kbForm.content.trim() && kbUploadFiles.length === 0)) ? 0.4 : 1 }}>💾 {kbUploadFiles.length > 0 ? `Save + Upload (${kbUploadFiles.length})` : "Save Knowledge"}</button>
                {kbEntries.length > 0 && (
                  <div style={{ marginTop: 8, maxHeight: 100, overflowY: "auto" }}>
                    {kbEntries.slice(0, 5).map(e => (
                      <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", marginBottom: 3, background: "#0F1117", borderRadius: 4, border: "1px solid #1E213033" }}>
                        <span style={{ flex: 1, fontSize: 9, color: "#C4CAD6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</span>
                        <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 3, background: "#6366F118", color: "#6366F1" }}>{e.category}</span>
                        <button onClick={() => deleteKbEntry(e.id)} style={{ background: "none", border: "none", color: "#FF6B6B88", cursor: "pointer", fontSize: 8, padding: 1 }}>✕</button>
                      </div>
                    ))}
                    {kbEntries.length > 5 && <div style={{ fontSize: 8, color: "#5A6178", textAlign: "center", marginTop: 2 }}>+{kbEntries.length - 5} more — open AI Assist module for full list</div>}
                  </div>
                )}
              </div>
            )}
            {/* AI Status Footer */}
            <div style={{
              padding: "6px 14px", borderTop: "1px solid #1E213022",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6
            }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: azureOpenAI.enabled ? "#81C784" : "#FFB347", boxShadow: azureOpenAI.enabled ? "0 0 6px #81C78444" : "0 0 6px #FFB34744", animation: "pulse 2s infinite" }} />
              <span style={{ color: "#5A617855", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}>
                {azureOpenAI.enabled ? "VGC-AI Engine · Ready" : "Local AI · Online"}
              </span>
              <span style={{ color: "#6366F133", fontSize: 8 }}>·</span>
              <span style={{ color: "#6366F133", fontSize: 8, fontFamily: "'JetBrains Mono', monospace" }}>I assist, you lead 🤝</span>
            </div>
          </div>
        )}
        {/* AI Idle Nudge Tooltip */}
        {!showAiPanel && aiIdleNudge && (
          <div
            onClick={() => { handleAiChat(aiIdleNudge.action); setShowAiPanel(true); setAiIdleNudge(null); }}
            style={{
              background: "#12141E", borderRadius: 10,
              border: `1px solid ${aiIdleNudge.urgency === "critical" ? "#FF6B6B44" : aiIdleNudge.urgency === "high" ? "#FFB34744" : "#6366F133"}`,
              padding: "10px 14px", cursor: "pointer",
              animation: "nudgeSlideIn 0.4s ease, nudgePulse 3s ease-in-out infinite",
              boxShadow: "0 8px 24px #00000044",
              display: "flex", alignItems: "center", gap: 8, maxWidth: 280,
              transition: "all 0.2s"
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#6366F166"; e.currentTarget.style.transform = "scale(1.02)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = aiIdleNudge.urgency === "critical" ? "#FF6B6B44" : "#6366F133"; e.currentTarget.style.transform = "scale(1)"; }}
          >
            <span style={{ fontSize: 16, flexShrink: 0 }}>{aiIdleNudge.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: aiIdleNudge.urgency === "critical" ? "#FF6B6B" : aiIdleNudge.urgency === "high" ? "#FFB347" : "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", lineHeight: 1.3 }}>{aiIdleNudge.text}</div>
              <div style={{ fontSize: 8, color: "#5A617888", fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>Click to take action</div>
            </div>
            <button onClick={e => { e.stopPropagation(); setAiIdleNudge(null); }} style={{ background: "none", border: "none", color: "#5A617844", cursor: "pointer", fontSize: 10, padding: 2, flexShrink: 0 }}>✕</button>
          </div>
        )}
        {/* 3D Avatar Button — Profile Photo Based with Smart Animations */}
        <button onMouseDown={!showAiPanel ? handleAiDragStart : undefined} onTouchStart={!showAiPanel ? handleAiDragStart : undefined} onClick={(e) => { if (aiDragRef.current.moved) { e.preventDefault(); return; } setShowAiPanel(!showAiPanel); }} style={{
          width: 64, height: 64,
          borderRadius: avatarConfig.shape === "circle" ? "50%" : avatarConfig.shape === "hexagon" ? 16 : 18,
          border: avatarConfig.borderStyle === "neon" ? `2.5px solid ${avatarConfig.glowColor}88` : "3px solid transparent",
          cursor: "pointer",
          background: avatarConfig.borderStyle === "gradient" ? "linear-gradient(135deg, #6366F1, #06B6D4, #EC4899)" : avatarConfig.borderStyle === "merlion" ? "linear-gradient(135deg, #D4AF37, #B8860B, #FFD700)" : `linear-gradient(135deg, ${avatarConfig.glowColor}, ${avatarConfig.glowColor}88)`,
          backgroundSize: "200% 200%",
          animation: `logoGradient 12s ease-in-out infinite, ${avatarConfig.animation === "float" ? "aiFloat 7s ease-in-out infinite" : avatarConfig.animation === "pulse" ? "aiSmartPulse 8s ease-in-out infinite" : avatarConfig.animation === "breathe" ? "aiBreathe 8s ease-in-out infinite" : "aiBounce 7s ease-in-out infinite"}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: `0 8px 24px ${avatarConfig.glowColor}44, 0 0 40px ${avatarConfig.glowColor}22`,
          position: "relative", padding: 3, overflow: "visible"
        }}>
          {/* Profile photo or avatar initials */}
          <div style={{
            width: "100%", height: "100%",
            borderRadius: avatarConfig.shape === "circle" ? "50%" : avatarConfig.shape === "hexagon" ? 12 : 14,
            background: profilePhoto ? `url(${profilePhoto}) center/cover no-repeat` : "linear-gradient(135deg, #1E2130, #0F1117)",
            display: "flex", alignItems: "center", justifyContent: "center",
            overflow: "hidden", position: "relative"
          }}>
            {!profilePhoto && (
              <span style={{ fontSize: 18, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", textShadow: `0 0 12px ${avatarConfig.glowColor}66` }}>{currentUser.avatar}</span>
            )}
            {/* Smart mood overlay */}
            <div style={{
              position: "absolute", inset: 0,
              background: avatarConfig.mood === "smart" ? "linear-gradient(180deg, transparent 60%, #6366F122)" : avatarConfig.mood === "energetic" ? "linear-gradient(180deg, transparent 60%, #EC489922)" : avatarConfig.mood === "calm" ? "linear-gradient(180deg, transparent 60%, #81C78422)" : "linear-gradient(180deg, transparent 60%, #06B6D422)",
              borderRadius: "inherit"
            }} />
          </div>
          {/* Headset overlay (optional) */}
          {avatarConfig.showHeadset && (
            <>
              <div style={{ position: "absolute", top: 2, left: 2, right: 2, height: 20, borderRadius: "50% 50% 0 0", border: `2px solid ${avatarConfig.glowColor}88`, borderBottom: "none", zIndex: 4, pointerEvents: "none" }} />
              <div style={{ position: "absolute", top: 14, left: -1, width: 8, height: 10, borderRadius: "30%", background: `linear-gradient(135deg, ${avatarConfig.glowColor}, ${avatarConfig.glowColor}88)`, zIndex: 4, pointerEvents: "none" }} />
              <div style={{ position: "absolute", top: 14, right: -1, width: 8, height: 10, borderRadius: "30%", background: `linear-gradient(135deg, ${avatarConfig.glowColor}, ${avatarConfig.glowColor}88)`, zIndex: 4, pointerEvents: "none" }} />
              <div style={{ position: "absolute", bottom: 8, left: 0, width: 12, height: 2, background: avatarConfig.glowColor, borderRadius: 2, transform: "rotate(20deg)", zIndex: 4, pointerEvents: "none" }}>
                <div style={{ position: "absolute", right: -3, top: -3, width: 7, height: 7, borderRadius: "50%", background: `linear-gradient(135deg, #06B6D4, ${avatarConfig.glowColor})`, boxShadow: `0 0 5px ${avatarConfig.glowColor}44` }} />
              </div>
            </>
          )}
          {/* Status ring (orbiting) */}
          {avatarConfig.showStatusRing && (
            <div style={{ position: "absolute", inset: -6, borderRadius: "50%", border: `1.5px dashed ${avatarConfig.glowColor}33`, animation: "aiThinkingRing 8s linear infinite", pointerEvents: "none" }}>
              <div style={{ position: "absolute", top: -2, left: "50%", width: 5, height: 5, borderRadius: "50%", background: avatarConfig.glowColor, boxShadow: `0 0 6px ${avatarConfig.glowColor}88` }} />
            </div>
          )}
          {/* Sparkle effects */}
          {avatarConfig.showSparkles && (
            <>
              <div style={{ position: "absolute", top: -4, right: 6, fontSize: 8, animation: "aiSparkle 2s ease-in-out infinite", pointerEvents: "none" }}>✨</div>
              <div style={{ position: "absolute", bottom: 2, left: -2, fontSize: 7, animation: "aiSparkle 2.5s ease-in-out 0.5s infinite", pointerEvents: "none" }}>⚡</div>
              <div style={{ position: "absolute", top: 8, right: -4, fontSize: 6, animation: "aiSparkle 3s ease-in-out 1s infinite", pointerEvents: "none" }}>💡</div>
            </>
          )}
          {/* Online indicator + proactive alert count */}
          <span style={{
            position: "absolute", top: -2, right: -2, width: 14, height: 14,
            borderRadius: "50%",
            background: proactiveAlerts.filter(a => !dismissedProactiveAlerts.includes(a.id)).length > 0 ? "#FF6B6B" : "#4CAF50",
            border: "2.5px solid #12141E",
            animation: proactiveAlerts.filter(a => !dismissedProactiveAlerts.includes(a.id)).length > 0 ? "criticalBadgePulse 1.5s infinite" : "pulse 2s infinite",
            zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 7, fontWeight: 700, color: "#fff"
          }}>{proactiveAlerts.filter(a => !dismissedProactiveAlerts.includes(a.id)).length > 0 ? proactiveAlerts.filter(a => !dismissedProactiveAlerts.includes(a.id)).length : ""}</span>
          {/* Customize button */}
          <span onClick={e => { e.stopPropagation(); setShowAvatarCustomizer(!showAvatarCustomizer); }} style={{
            position: "absolute", bottom: -4, left: -4, width: 18, height: 18,
            borderRadius: "50%", background: "#1E2130", border: "1.5px solid #6366F144",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 9, cursor: "pointer", zIndex: 5
          }}>⚙️</span>
        </button>

        {/* ═══ Avatar Customizer Panel ═══ */}
        {showAvatarCustomizer && (
          <div style={{
            position: "absolute", bottom: 80, right: 0, width: 300, background: "#12141E",
            borderRadius: 12, border: "1px solid #6366F133", boxShadow: "0 16px 40px #00000066",
            padding: 16, zIndex: 10000, animation: "alertSlideDown 0.3s ease"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h4 style={{ margin: 0, fontSize: 13, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>🎨 Customise My AI Avatar</h4>
              <button onClick={() => setShowAvatarCustomizer(false)} style={{ background: "none", border: "none", color: "#5A6178", cursor: "pointer", fontSize: 14 }}>✕</button>
            </div>
            {/* Shape */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Shape</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[{ val: "rounded", label: "Rounded" }, { val: "circle", label: "Circle" }, { val: "hexagon", label: "Hex" }].map(s => (
                  <button key={s.val} onClick={() => setAvatarConfig(p => ({ ...p, shape: s.val }))} style={{ flex: 1, padding: "5px 0", fontSize: 10, background: avatarConfig.shape === s.val ? "#6366F122" : "#0A0C14", border: `1px solid ${avatarConfig.shape === s.val ? "#6366F1" : "#1E2130"}`, borderRadius: 4, color: avatarConfig.shape === s.val ? "#6366F1" : "#5A6178", cursor: "pointer" }}>{s.label}</button>
                ))}
              </div>
            </div>
            {/* Animation */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Animation</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[{ val: "float", label: "🌊 Float" }, { val: "pulse", label: "💫 Pulse" }, { val: "breathe", label: "🧘 Breathe" }, { val: "bounce", label: "⚡ Bounce" }].map(a => (
                  <button key={a.val} onClick={() => setAvatarConfig(p => ({ ...p, animation: a.val }))} style={{ flex: 1, padding: "5px 0", fontSize: 9, background: avatarConfig.animation === a.val ? "#6366F122" : "#0A0C14", border: `1px solid ${avatarConfig.animation === a.val ? "#6366F1" : "#1E2130"}`, borderRadius: 4, color: avatarConfig.animation === a.val ? "#6366F1" : "#5A6178", cursor: "pointer" }}>{a.label}</button>
                ))}
              </div>
            </div>
            {/* Mood */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>AI Mood</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[{ val: "smart", label: "🧠 Smart", color: "#6366F1" }, { val: "energetic", label: "🔥 Energetic", color: "#EC4899" }, { val: "calm", label: "🌿 Calm", color: "#81C784" }, { val: "focused", label: "🎯 Focused", color: "#06B6D4" }].map(m => (
                  <button key={m.val} onClick={() => setAvatarConfig(p => ({ ...p, mood: m.val, glowColor: m.color }))} style={{ flex: 1, padding: "5px 0", fontSize: 9, background: avatarConfig.mood === m.val ? `${m.color}22` : "#0A0C14", border: `1px solid ${avatarConfig.mood === m.val ? m.color : "#1E2130"}`, borderRadius: 4, color: avatarConfig.mood === m.val ? m.color : "#5A6178", cursor: "pointer" }}>{m.label}</button>
                ))}
              </div>
            </div>
            {/* Border Style */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Border Style</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[{ val: "gradient", label: "🌈 Gradient" }, { val: "neon", label: "💡 Neon" }, { val: "merlion", label: "🇸🇬 Merlion" }, { val: "solid", label: "⬜ Solid" }].map(b => (
                  <button key={b.val} onClick={() => setAvatarConfig(p => ({ ...p, borderStyle: b.val }))} style={{ flex: 1, padding: "5px 0", fontSize: 9, background: avatarConfig.borderStyle === b.val ? "#6366F122" : "#0A0C14", border: `1px solid ${avatarConfig.borderStyle === b.val ? "#6366F1" : "#1E2130"}`, borderRadius: 4, color: avatarConfig.borderStyle === b.val ? "#6366F1" : "#5A6178", cursor: "pointer" }}>{b.label}</button>
                ))}
              </div>
            </div>
            {/* Theme */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: "#5A6178", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Theme</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[{ val: "singapore", label: "🇸🇬 SG" }, { val: "tech", label: "💻 Tech" }, { val: "nature", label: "🌿 Nature" }, { val: "minimal", label: "⬛ Minimal" }].map(t => (
                  <button key={t.val} onClick={() => setAvatarConfig(p => ({ ...p, theme: t.val }))} style={{ flex: 1, padding: "5px 0", fontSize: 9, background: avatarConfig.theme === t.val ? "#6366F122" : "#0A0C14", border: `1px solid ${avatarConfig.theme === t.val ? "#6366F1" : "#1E2130"}`, borderRadius: 4, color: avatarConfig.theme === t.val ? "#6366F1" : "#5A6178", cursor: "pointer" }}>{t.label}</button>
                ))}
              </div>
            </div>
            {/* Toggles */}
            <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
              {[{ key: "showHeadset", label: "🎧 Headset" }, { key: "showStatusRing", label: "💫 Ring" }, { key: "showSparkles", label: "✨ Sparkles" }].map(t => (
                <label key={t.key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#C4CAD6", cursor: "pointer" }}>
                  <input type="checkbox" checked={avatarConfig[t.key]} onChange={e => setAvatarConfig(p => ({ ...p, [t.key]: e.target.checked }))} style={{ accentColor: "#6366F1" }} />
                  {t.label}
                </label>
              ))}
            </div>
            {/* Auto-save indicator */}
            <div style={{ marginTop: 10, padding: "6px 10px", borderRadius: 6, background: "#4CAF5010", border: "1px solid #4CAF5022", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10, animation: "pulse 2s infinite" }}>✅</span>
              <span style={{ fontSize: 9, color: "#4CAF50", fontFamily: "'JetBrains Mono', monospace" }}>Changes auto-saved — persists until you change again</span>
            </div>
          </div>
        )}
      </div>

      {/* ═══ PROACTIVE AI ALERT NOTIFICATIONS ═══ */}
      {proactiveAlerts.filter(a => !dismissedProactiveAlerts.includes(a.id)).length > 0 && (
        <div style={{
          position: "fixed", bottom: 100, right: 90, zIndex: 9998,
          display: "flex", flexDirection: "column", gap: 8, maxWidth: 360
        }}>
          {proactiveAlerts.filter(a => !dismissedProactiveAlerts.includes(a.id)).slice(0, 3).map((alert, i) => (
            <div key={alert.id} style={{
              background: "#12141E", borderRadius: 10,
              border: `1px solid ${alert.severity === "critical" ? "#FF6B6B44" : alert.severity === "high" ? "#FFB34744" : "#6366F133"}`,
              boxShadow: `0 8px 24px #00000066, 0 0 20px ${alert.severity === "critical" ? "#FF6B6B22" : "#6366F111"}`,
              padding: "14px 16px", animation: `proactiveSlideIn 0.4s ease ${i * 0.1}s both${alert.severity === "critical" ? ", proactiveUrgent 2s ease-in-out infinite" : ""}`,
              overflow: "hidden", position: "relative"
            }}>
              {/* Severity accent bar */}
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: alert.severity === "critical" ? "#FF6B6B" : alert.severity === "high" ? "#FFB347" : "#6366F1" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {/* Mini profile photo */}
                  <div style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0, overflow: "hidden",
                    background: profilePhoto ? `url(${profilePhoto}) center/cover no-repeat` : `linear-gradient(135deg, ${avatarConfig.glowColor}, ${avatarConfig.glowColor}88)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    border: `1.5px solid ${alert.severity === "critical" ? "#FF6B6B44" : avatarConfig.glowColor + "44"}`,
                    animation: alert.severity === "critical" ? "criticalBadgePulse 1.5s infinite" : "none"
                  }}>
                    {!profilePhoto && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff" }}>{currentUser.avatar}</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: alert.severity === "critical" ? "#FF6B6B" : alert.severity === "high" ? "#FFB347" : "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>{alert.title}</div>
                    <div style={{ fontSize: 8, color: "#5A6178", fontFamily: "'JetBrains Mono', monospace" }}>Assisted by {currentUser.name} AI · Just now</div>
                  </div>
                </div>
                <button onClick={() => setDismissedProactiveAlerts(prev => [...prev, alert.id])} style={{ background: "none", border: "none", color: "#5A617866", cursor: "pointer", fontSize: 12, flexShrink: 0, padding: 0 }}>✕</button>
              </div>
              <div style={{ fontSize: 10, color: "#C4CAD6", marginBottom: 6, lineHeight: 1.4 }}>{alert.detail}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 9, color: "#81C784", fontStyle: "italic" }}>💡 {alert.action}</span>
                <div style={{ display: "flex", gap: 4 }}>
                  {alert.ticketId && <button onClick={() => { const t = incidents.find(i => i.id === alert.ticketId); if (t) { setDetailItem(t); setModal("incidentDetail"); } setDismissedProactiveAlerts(prev => [...prev, alert.id]); }} style={{ padding: "3px 8px", fontSize: 9, background: "#6366F122", border: "1px solid #6366F133", borderRadius: 4, color: "#6366F1", cursor: "pointer" }}>📋 View</button>}
                  <button onClick={() => setDismissedProactiveAlerts(prev => [...prev, alert.id])} style={{ padding: "3px 8px", fontSize: 9, background: "#81C78411", border: "1px solid #81C78433", borderRadius: 4, color: "#81C784", cursor: "pointer" }}>✅ Got it</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ GLOBAL HIGH-SEVERITY ALERT OVERLAY ═══ (v3.16: disabled — kept for future re-enable) */}
      {/* eslint-disable-next-line no-constant-binary-expression -- intentionally disabled block */}
      {false && globalHighAlert && (() => {
        const ga = globalHighAlert;
        const inc = ga.incident;
        const isSevA = inc.priority === "Sev-A";
        const canDismiss = !isSevA || escalationConfig.dashboardAlertDismissible;
        const phaseLabels = { pickup_window: "AWAITING PICKUP", auto_escalating: "AUTO ESCALATION IN PROGRESS", escalated: "ESCALATED" };
        return (
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, zIndex: 999999,
            background: "linear-gradient(135deg, #1A0A0A 0%, #2D0A0AEE 100%)",
            backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
            borderBottom: `3px solid ${isSevA ? "#FF4444" : "#FFB347"}`,
            animation: "escalationBannerGlow 2s ease-in-out infinite",
            padding: "0 24px",
          }}>
            <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", gap: 16, padding: "14px 0" }}>
              {/* Pulsing icon */}
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: isSevA ? "#FF444422" : "#FFB34722",
                border: `2px solid ${isSevA ? "#FF4444" : "#FFB347"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: "escalationIconPulse 1s ease-in-out infinite", flexShrink: 0
              }}>
                <span style={{ fontSize: 22 }}>🚨</span>
              </div>

              {/* Alert content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 800, color: "#fff", padding: "2px 10px", borderRadius: 4,
                    background: isSevA ? "#FF4444" : "#FFB347",
                    fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1,
                    animation: isSevA ? "escalationTextBlink 0.8s ease-in-out infinite" : "none"
                  }}>{inc.priority}</span>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
                    background: ga.escalationPhase === "auto_escalating" ? "#FF444444" : "#FFB34733",
                    color: ga.escalationPhase === "auto_escalating" ? "#FF6B6B" : "#FFB347",
                    fontFamily: "'JetBrains Mono', monospace", letterSpacing: 0.5,
                    animation: ga.escalationPhase === "auto_escalating" ? "escalationTextBlink 1s ease-in-out infinite" : "none"
                  }}>{phaseLabels[ga.escalationPhase] || "ALERT ACTIVE"}</span>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "'JetBrains Mono', monospace" }}>
                    {ga.correlationId}
                  </span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#FFFFFF", fontFamily: "'Space Grotesk', sans-serif" }}>
                  {ga.escalationPhase === "auto_escalating"
                    ? `🚨 NO ENGINEER PICKED UP — AUTO ESCALATION IN PROGRESS`
                    : `🚨 High-Severity incident detected. Immediate pickup required.`}
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 2 }}>
                  {inc.id} — {inc.title} {ga.allCritical.length > 1 ? `(+${ga.allCritical.length - 1} more)` : ""}
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button onClick={() => {
                  // Pick up / acknowledge — assign to current user
                  setIncidents(prev => prev.map(i => i.id === inc.id ? { ...i, status: "In Progress", assignee: currentUser?.name || "Assigned" } : i));
                  logEscalation({ type: "ENGINEER_PICKUP", incidentId: inc.id, engineer: currentUser?.name, correlationId: ga.correlationId });
                  setGlobalHighAlert(null);
                  setActiveModule("incidents");
                  setDetailItem(incidents.find(i => i.id === inc.id));
                }} style={{
                  padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: "#81C784", color: "#0A0C14", fontSize: 12, fontWeight: 700,
                  fontFamily: "'Space Grotesk', sans-serif", animation: "pulse 2s infinite"
                }}>✋ Pick Up Now</button>

                {canDismiss && (
                  <button onClick={() => setGlobalHighAlert(null)} style={{
                    padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)",
                    fontSize: 11, cursor: "pointer"
                  }}>Dismiss</button>
                )}
              </div>
            </div>

            {/* AI Advisory Row */}
            <div style={{
              maxWidth: 1200, margin: "0 auto", padding: "8px 0 12px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              display: "flex", alignItems: "center", gap: 12
            }}>
              <span style={{ fontSize: 11 }}>🤖</span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontStyle: "italic" }}>
                AI Assist: "{inc.priority === "Sev-A" ? "Critical incident requires immediate L2/L3 engagement. P1 bridge call recommended. All engineers notified." : "High-priority incident approaching SLA threshold. Assign an available engineer promptly."}"
              </span>
              {ga.callsInitiated && (
                <span style={{ fontSize: 9, color: "#FF6B6B", fontFamily: "'JetBrains Mono', monospace", padding: "2px 8px", background: "#FF444418", borderRadius: 4, animation: "escalationTextBlink 1.5s ease-in-out infinite" }}>
                  📞 AUTO-CALLS ACTIVE
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* ═══ WEATHER DISASTER ALERT TOAST ═══ */}
      {disasterAlert && (
        <div style={{
          position: "fixed", top: 80, right: 24, zIndex: 99999, width: 420, maxWidth: "calc(100vw - 48px)",
          background: "linear-gradient(135deg, #1A1D2E 0%, #12141F 100%)",
          border: `1px solid ${disasterAlert.color}44`,
          borderRadius: 16, overflow: "hidden",
          animation: "disasterSlideIn 0.6s cubic-bezier(0.34,1.56,0.64,1) forwards, disasterGlow 3s ease-in-out 0.6s infinite",
          backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
        }}>
          {/* Top accent bar */}
          <div style={{ height: 3, background: `linear-gradient(90deg, ${disasterAlert.color}, ${disasterAlert.color}88, transparent)` }} />
          {/* Progress bar (auto-dismiss countdown) */}
          <div style={{ height: 2, background: "rgba(255,255,255,0.05)", position: "relative" }}>
            <div style={{ height: "100%", background: `${disasterAlert.color}88`, animation: "disasterProgress 10s linear forwards" }} />
          </div>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px 8px" }}>
            <span style={{ fontSize: 28, animation: "disasterIconPulse 1.5s ease-in-out infinite", flexShrink: 0 }}>{disasterAlert.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: disasterAlert.color, padding: "2px 8px", borderRadius: 4, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {disasterAlert.severity} Alert
                </span>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono', monospace" }}>
                  {new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit" })} SGT
                </span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif", marginTop: 4 }}>
                {disasterAlert.headline || `Official ${disasterAlert.type} Advisory — ${disasterAlert.region}`}
              </div>
            </div>
            <button onClick={dismissDisasterAlert} style={{
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "rgba(255,255,255,0.5)", fontSize: 14, flexShrink: 0,
              transition: "all 0.2s"
            }} onMouseEnter={e => { e.target.style.background = "rgba(255,68,68,0.15)"; e.target.style.color = "#FF6B6B"; }}
               onMouseLeave={e => { e.target.style.background = "rgba(255,255,255,0.06)"; e.target.style.color = "rgba(255,255,255,0.5)"; }}>✕</button>
          </div>
          {/* Summary */}
          <div style={{ padding: "0 16px 10px", fontSize: 11, color: "rgba(255,255,255,0.7)", lineHeight: 1.5, fontFamily: "'Inter', sans-serif" }}>
            {disasterAlert.summary}
          </div>
          {/* AI Advisory */}
          <div style={{
            margin: "0 12px 12px", padding: "10px 12px", borderRadius: 10,
            background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(6,182,212,0.05))",
            border: "1px solid rgba(99,102,241,0.15)"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 12 }}>🤖</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#818CF8", fontFamily: "'Space Grotesk', sans-serif", letterSpacing: 0.5 }}>AI SAFETY ADVISORY</span>
            </div>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.8)", lineHeight: 1.6, fontFamily: "'Inter', sans-serif" }}>
              {disasterAlert.aiAdvice}
            </div>
          </div>
          {/* Trusted Sources */}
          <div style={{ padding: "0 16px 8px" }}>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5 }}>
              Official references: {Array.isArray(disasterAlert.sources) ? disasterAlert.sources.map((source, index) => (
                <React.Fragment key={source.url || source.title || index}>
                  {index > 0 ? " · " : ""}
                  <a href={source.url} target="_blank" rel="noreferrer" style={{ color: disasterAlert.color, textDecoration: "none" }}>
                    {source.title || source.url}
                  </a>
                </React.Fragment>
              )) : disasterAlert.sources}
            </div>
            {(disasterAlert.updatedAt || disasterAlert.validPeriod) && (
              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.28)", fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5, marginTop: 4 }}>
                Source updated: {disasterAlert.updatedAt || "official feed"}{disasterAlert.validPeriod ? ` · Valid: ${disasterAlert.validPeriod}` : ""}
              </div>
            )}
          </div>
          {/* Footer */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px 12px" }}>
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", fontFamily: "'JetBrains Mono', monospace" }}>
              Auto-dismiss in 10s · Official live-source alert only
            </span>
            <button onClick={dismissDisasterAlert} style={{
              background: `${disasterAlert.color}22`, border: `1px solid ${disasterAlert.color}44`,
              borderRadius: 8, padding: "5px 14px", fontSize: 10, fontWeight: 600,
              color: disasterAlert.color, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif",
              transition: "all 0.2s"
            }} onMouseEnter={e => { e.target.style.background = `${disasterAlert.color}44`; e.target.style.color = "#fff"; }}
               onMouseLeave={e => { e.target.style.background = `${disasterAlert.color}22`; e.target.style.color = disasterAlert.color; }}>
              Dismiss This Alert
            </button>
          </div>
        </div>
      )}

      {/* ═══ AI ERROR ADVISORY OVERLAY ═══ */}
      {errorAdvisory && (() => {
        const ea = errorAdvisory;
        const sgTime = new Date(ea.timestamp).toLocaleString("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "medium" });
        const screenshotInfo = `Error Type: ${ea.type}\nError Code: ${ea.code}\nMessage: ${ea.message}\nTimestamp: ${sgTime}\nBrowser: ${navigator.userAgent}\nURL: ${window.location.href}\n\nDetails:\n${ea.details}\n\nStack Trace:\n${ea.stack || "N/A"}`;
        const emailSubject = encodeURIComponent(`[VGC-ITSM] Error Report — ${ea.type} (${ea.code})`);
        const emailBody = encodeURIComponent(
          `Dear VGC Technology Support Team,\n\nI encountered an error while using VGC-ITSM. Please find the details below:\n\n` +
          `━━━━━━━━━━ ERROR REPORT ━━━━━━━━━━\n` +
          `Error Type: ${ea.type}\n` +
          `Error Code: ${ea.code}\n` +
          `Error Message: ${ea.message}\n` +
          `Timestamp: ${sgTime}\n` +
          `Browser: ${navigator.userAgent}\n` +
          `URL: ${window.location.href}\n` +
          `User: ${currentUser?.name || "Unknown"} (${currentUser?.email || "N/A"})\n` +
          `SSO Status: ${isMsalAuthenticated ? "Entra ID Connected" : "Local Admin"}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Technical Details:\n${ea.details}\n\n` +
          `Stack Trace:\n${ea.stack || "N/A"}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Steps I tried:\n[Please describe what you were doing when the error occurred]\n\n` +
          `[!] Please attach a screenshot of your browser showing the error if possible.\n\n` +
          `Thank you.\n` +
          `${currentUser?.name || "User"}\n` +
          `${currentUser?.department || ""} · ${currentUser?.team || ""}`
        );
        const mailtoLink = `mailto:help@vgctechnology.com?subject=${emailSubject}&body=${emailBody}`;

        // Auto-trigger AI resolution on mount
        if (!aiErrorResolution && !aiErrorResolving) {
          resolveErrorWithAI(ea);
        }

        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", animation: "alertSlideDown 0.3s ease-out" }}
            onClick={e => { if (e.target === e.currentTarget) { setErrorAdvisory(null); setAiErrorResolution(null); } }}>
            <div style={{ width: 620, maxHeight: "90vh", background: "#0F1117", borderRadius: 16, border: "1px solid #FF6B6B33", overflow: "hidden", boxShadow: "0 24px 64px rgba(255,107,107,0.15), 0 8px 24px #00000088", animation: "alertSlideDown 0.35s ease-out" }}>
              {/* Header */}
              <div style={{ padding: "16px 20px", background: "linear-gradient(135deg, #FF6B6B10, #FF444408)", borderBottom: "1px solid #FF6B6B22", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #FF6B6B22, #FF444411)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, animation: "aiBreathe 3s ease-in-out infinite" }}>🤖</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>AI Error Resolver</div>
                    <div style={{ fontSize: 10, color: "#FF6B6B", fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: aiErrorResolving ? "#FFB347" : "#FF6B6B", animation: "pulse 1.5s infinite" }} />
                      {aiErrorResolving ? "AI is analyzing and resolving..." : `${ea.type} Error Detected — AI Solution Ready`}
                    </div>
                  </div>
                </div>
                <button onClick={() => { setErrorAdvisory(null); setAiErrorResolution(null); }} style={{ background: "none", border: "none", color: "#5A6178", cursor: "pointer", fontSize: 18, padding: "4px 6px", borderRadius: 6, transition: "all 0.2s" }}
                  onMouseEnter={e => e.currentTarget.style.color = "#FF6B6B"}
                  onMouseLeave={e => e.currentTarget.style.color = "#5A6178"}>✕</button>
              </div>

              {/* Content */}
              <div style={{ padding: 20, maxHeight: "65vh", overflow: "auto" }}>
                {/* Error Info Card */}
                <div style={{ padding: 14, borderRadius: 10, background: "#FF6B6B08", border: "1px solid #FF6B6B1A", marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <span style={{ fontSize: 12 }}>⚠️</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#FF6B6B", fontFamily: "'Space Grotesk', sans-serif" }}>Error Details</span>
                    <span style={{ marginLeft: "auto", fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "#FF6B6B15", color: "#FF8888", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{ea.code}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#E8ECF4", marginBottom: 6, lineHeight: 1.5, fontFamily: "'DM Sans', sans-serif" }}>{ea.message}</div>
                  <div style={{ fontSize: 10, color: "#5A6178", lineHeight: 1.5, fontFamily: "'JetBrains Mono', monospace" }}>{ea.details}</div>
                  <div style={{ marginTop: 8, fontSize: 9, color: "#5A617866", fontFamily: "'JetBrains Mono', monospace" }}>🕐 {sgTime}</div>
                </div>

                {/* AI Resolution — Dynamic, not hardcoded */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#06B6D4", marginBottom: 10, display: "flex", alignItems: "center", gap: 6, fontFamily: "'Space Grotesk', sans-serif" }}>
                    <span style={{ fontSize: 13 }}>🤖</span> AI-Powered Resolution
                    <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "#6366F122", color: "#6366F1", fontFamily: "'JetBrains Mono', monospace" }}>GPT-5.4-Pro</span>
                  </div>
                  {aiErrorResolving ? (
                    <div style={{ padding: 20, borderRadius: 10, background: "#06B6D408", border: "1px solid #06B6D422", textAlign: "center" }}>
                      <div style={{ fontSize: 24, marginBottom: 10, animation: "aiBreathe 2s ease-in-out infinite" }}>🤖</div>
                      <div style={{ fontSize: 12, color: "#06B6D4", fontWeight: 600 }}>AI is analyzing the error...</div>
                      <div style={{ fontSize: 10, color: "#5A6178", marginTop: 4 }}>Checking knowledge base, Zendesk history, and generating resolution steps</div>
                      <div style={{ marginTop: 12, width: 200, height: 3, borderRadius: 3, background: "#1E2130", margin: "12px auto 0" }}>
                        <div style={{ width: "60%", height: "100%", borderRadius: 3, background: "linear-gradient(90deg, #6366F1, #06B6D4)", animation: "shimmerBg 1.5s ease-in-out infinite" }} />
                      </div>
                    </div>
                  ) : aiErrorResolution ? (
                    <div style={{ padding: 16, borderRadius: 10, background: "#ffffff03", border: "1px solid #1E2130", fontSize: 12, color: "#C4CAD6", lineHeight: 1.7, fontFamily: "'DM Sans', sans-serif", whiteSpace: "pre-wrap" }}>
                      {aiErrorResolution}
                    </div>
                  ) : null}
                </div>

                {/* Screenshot Tip */}
                <div style={{ padding: 10, borderRadius: 8, background: "#FFB34708", border: "1px solid #FFB34718", marginBottom: 16, display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <span style={{ fontSize: 13, flexShrink: 0 }}>📸</span>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#FFB347", marginBottom: 3 }}>Take a Screenshot</div>
                    <div style={{ fontSize: 10, color: "#5A6178", lineHeight: 1.5 }}>
                      Press <kbd style={{ padding: "1px 5px", borderRadius: 3, background: "#1E2130", border: "1px solid #2A2F45", fontSize: 9, color: "#E8ECF4", fontFamily: "'JetBrains Mono', monospace" }}>Win + Shift + S</kbd> to capture a screenshot, then paste it into the email below.
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <button onClick={() => { navigator.clipboard.writeText(screenshotInfo + "\n\n─── AI RESOLUTION ───\n" + (aiErrorResolution || "Pending...")); }}
                    style={{ flex: 1, padding: "9px 0", borderRadius: 8, background: "#1E2130", border: "1px solid #2A2F45", color: "#E8ECF4", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "#2A2F45"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "#1E2130"; }}
                  >📋 Copy Error + AI Resolution</button>
                  {!aiErrorResolving && <button onClick={() => resolveErrorWithAI(ea)}
                    style={{ padding: "9px 16px", borderRadius: 8, background: "#6366F115", border: "1px solid #6366F133", color: "#6366F1", cursor: "pointer", fontSize: 11, fontWeight: 600, transition: "all 0.2s" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "#6366F125"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "#6366F115"; }}
                  >🔄 Re-analyze</button>}
                </div>
              </div>

              {/* Footer Actions */}
              <div style={{ padding: "14px 20px", borderTop: "1px solid #1E2130", background: "#0A0C14", display: "flex", gap: 8, alignItems: "center" }}>
                <a href={mailtoLink} target="_blank" rel="noopener noreferrer" style={{ flex: 1, padding: "11px 0", borderRadius: 10, background: "linear-gradient(135deg, #6366F1, #06B6D4)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", textDecoration: "none", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 16px #6366F144", transition: "all 0.2s" }}
                  onMouseEnter={e => e.currentTarget.style.transform = "translateY(-1px)"}
                  onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  Email Developer — help@vgctechnology.com
                </a>
                <button onClick={() => { setErrorAdvisory(null); setAiErrorResolution(null); if (ea.type !== "SSO Login") { graphFetchedRef.current = false; fetchGraphData(); } }}
                  style={{ padding: "11px 20px", borderRadius: 10, background: "#FF6B6B15", border: "1px solid #FF6B6B33", color: "#FF6B6B", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", transition: "all 0.2s", whiteSpace: "nowrap" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#FF6B6B25"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "#FF6B6B15"; }}
                >🔄 Retry</button>
                <button onClick={() => { setErrorAdvisory(null); setAiErrorResolution(null); }}
                  style={{ padding: "11px 16px", borderRadius: 10, background: "transparent", border: "1px solid #1E2130", color: "#5A6178", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.color = "#E8ECF4"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "#5A6178"; }}
                >Dismiss</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════ ONBOARDING GUIDED TOUR ═══════════ */}
      {tourStep >= 0 && (() => {
        const step = TOUR_STEPS[tourStep];
        if (!step) return null;
        const totalSteps = TOUR_STEPS.length;
        const isWelcome = tourStep === 0;
        const isDone = tourStep === totalSteps - 1;
        const isCenter = step.position === "center";
        const progress = ((tourStep) / (totalSteps - 1)) * 100;

        // Position calculations for anchored tooltips
        const getTooltipStyle = () => {
          if (isCenter) return {
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            width: isWelcome ? 480 : isDone ? 460 : 420, zIndex: 10001
          };
          const positions = {
            sidebar: { top: step.id === "admin" ? "60%" : "30%", left: 240, transform: "translateY(-50%)" },
            header: { top: 70, left: step.id === "weather" ? "70%" : "50%", transform: "translateX(-50%)" },
            content: { top: "40%", left: "50%", transform: "translate(-50%, -50%)" },
            roleBar: { top: 160, left: "50%", transform: "translateX(-50%)" },
            threats: { top: 120, right: 460, left: "auto", transform: "none" },
            aiButton: { bottom: 100, right: 90, top: "auto", left: "auto", transform: "none" },
          };
          return { position: "fixed", width: 380, zIndex: 10001, ...positions[step.anchor] };
        };

        // Arrow direction for anchored tooltips
        const getArrowStyle = () => {
          if (isCenter) return null;
          const base = { position: "absolute", width: 0, height: 0 };
          if (step.position === "right") return { ...base, left: -8, top: 24, borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderRight: "8px solid #1A1D2E" };
          if (step.position === "left") return { ...base, right: -8, top: 24, borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderLeft: "8px solid #1A1D2E" };
          if (step.position === "bottom") return { ...base, top: -8, left: step.id === "weather" ? "70%" : "50%", transform: "translateX(-50%)", borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderBottom: "8px solid #1A1D2E" };
          if (step.position === "top") return { ...base, bottom: -8, left: "50%", transform: "translateX(-50%)", borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderTop: "8px solid #1A1D2E" };
          return null;
        };

        return (
          <>
            {/* Backdrop overlay */}
            <div onClick={dismissTour} style={{
              position: "fixed", inset: 0, zIndex: 10000,
              background: isCenter ? "#000000CC" : "#000000AA",
              transition: "background 0.3s"
            }} />

            {/* Tooltip card */}
            <div style={{
              ...getTooltipStyle(),
              background: "linear-gradient(135deg, #12141E 0%, #1A1D2E 100%)",
              borderRadius: 16, border: "1px solid #6366F133",
              boxShadow: "0 20px 60px #00000088, 0 0 40px #6366F118",
              overflow: "hidden",
              animation: "tourFadeIn 0.4s cubic-bezier(0.34,1.56,0.64,1)"
            }}>
              {/* Arrow pointer */}
              {getArrowStyle() && <div style={getArrowStyle()} />}

              {/* Animated gradient top bar */}
              <div style={{
                height: 3, background: "linear-gradient(90deg, #6366F1, #06B6D4, #EC4899, #FFB347, #6366F1)",
                backgroundSize: "200% 100%", animation: "aiShimmer 2s linear infinite"
              }} />

              {/* Header with icon + step counter */}
              <div style={{ padding: "16px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: "linear-gradient(135deg, #6366F1, #06B6D4)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 20, animation: isWelcome ? "tourWave 1.5s ease-in-out 0.5s" : isDone ? "tourBounce 1s ease-in-out infinite" : "tourSpotlight 2s ease-in-out infinite",
                    boxShadow: "0 4px 16px #6366F144"
                  }}>{step.icon}</div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>{step.title}</div>
                    {!isWelcome && !isDone && (
                      <div style={{ fontSize: 10, color: "#5A617888", fontFamily: "'JetBrains Mono', monospace", marginTop: 1 }}>
                        Step {tourStep} of {totalSteps - 2}
                      </div>
                    )}
                  </div>
                </div>
                <button onClick={dismissTour} title="Close tour" style={{
                  background: "#ffffff08", border: "1px solid #ffffff11", borderRadius: 8,
                  width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: "#5A6178", fontSize: 14, transition: "all 0.15s"
                }} onMouseEnter={e => { e.currentTarget.style.background = "#ffffff15"; e.currentTarget.style.color = "#E8ECF4"; }}
                   onMouseLeave={e => { e.currentTarget.style.background = "#ffffff08"; e.currentTarget.style.color = "#5A6178"; }}>✕</button>
              </div>

              {/* Progress bar */}
              {!isWelcome && (
                <div style={{ margin: "12px 20px 0", height: 3, background: "#1E2130", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 2, transition: "width 0.4s cubic-bezier(0.34,1.56,0.64,1)",
                    background: "linear-gradient(90deg, #6366F1, #06B6D4)",
                    width: `${progress}%`
                  }} />
                </div>
              )}

              {/* Body content */}
              <div style={{
                padding: "14px 20px 16px", fontSize: 13, color: "#C4CAD6", lineHeight: 1.7,
                whiteSpace: "pre-line", fontFamily: "'DM Sans', sans-serif"
              }}>{step.body}</div>

              {/* Confetti particles on final step */}
              {isDone && (
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, pointerEvents: "none", overflow: "hidden", height: 50 }}>
                  {["#6366F1","#06B6D4","#EC4899","#FFB347","#81C784","#FF6B6B","#FFD700","#9B59B6"].map((c, i) => (
                    <div key={i} style={{
                      position: "absolute", width: 6, height: 6, borderRadius: i % 2 === 0 ? "50%" : 1,
                      background: c, top: 10, left: `${8 + i * 12}%`,
                      animation: `tourConfetti 1.5s ease-out ${i * 0.15}s forwards`
                    }} />
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div style={{
                padding: "0 20px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10
              }}>
                <div style={{ display: "flex", gap: 6 }}>
                  {!isWelcome && !isDone && TOUR_STEPS.slice(1, -1).map((_, i) => (
                    <div key={i} style={{
                      width: tourStep - 1 === i ? 16 : 6, height: 6, borderRadius: 3,
                      background: tourStep - 1 >= i ? "#6366F1" : "#1E2130",
                      transition: "all 0.3s", cursor: "pointer"
                    }} onClick={() => setTourStep(i + 1)} />
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {!isWelcome && !isDone && (
                    <button onClick={() => setTourStep(prev => prev - 1)} style={{
                      padding: "8px 16px", borderRadius: 8, border: "1px solid #1E2130",
                      background: "#0A0C14", color: "#5A6178", cursor: "pointer",
                      fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif"
                    }}>← Back</button>
                  )}
                  {isWelcome && (
                    <button onClick={dismissTour} style={{
                      padding: "8px 16px", borderRadius: 8, border: "1px solid #1E2130",
                      background: "transparent", color: "#5A6178", cursor: "pointer",
                      fontSize: 12, fontFamily: "'DM Sans', sans-serif"
                    }}>Skip Tour</button>
                  )}
                  {isDone ? (
                    <button onClick={dismissTour} style={{
                      padding: "8px 22px", borderRadius: 8, border: "none",
                      background: "linear-gradient(135deg, #6366F1, #06B6D4)",
                      color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700,
                      fontFamily: "'Space Grotesk', sans-serif",
                      boxShadow: "0 4px 16px #6366F144"
                    }}>🚀 Let's Go!</button>
                  ) : (
                    <button onClick={() => setTourStep(prev => prev + 1)} style={{
                      padding: "8px 22px", borderRadius: 8, border: "none",
                      background: "linear-gradient(135deg, #6366F1, #06B6D4)",
                      color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700,
                      fontFamily: "'Space Grotesk', sans-serif",
                      boxShadow: "0 4px 16px #6366F144",
                      display: "flex", alignItems: "center", gap: 6
                    }}>
                      {isWelcome ? "Start Tour ✨" : "Next →"}
                    </button>
                  )}
                </div>
              </div>

              {/* Don't show again checkbox on welcome */}
              {isWelcome && (
                <div style={{
                  padding: "0 20px 14px", display: "flex", alignItems: "center", gap: 6,
                  fontSize: 10, color: "#5A617866", fontFamily: "'JetBrains Mono', monospace"
                }}>
                  💡 You can restart this tour anytime from Admin → General
                </div>
              )}
            </div>
          </>
        );
      })()}

    </div>
  );
}
