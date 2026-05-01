import React, { Component } from "react";
import { createRoot } from "react-dom/client";
import { MsalProvider } from "@azure/msal-react";
import { apiScopes, msalInstance } from "./msalConfig.js";
import { I18nProvider } from "./src/i18n/i18nProvider.jsx";
import ITSMApp from "./itsm-tool.jsx";

// ─── H1: Global fetch interceptor ────────────────────────────────────────
// Attach an MSAL bearer token to every same-origin /api/* request so the
// server can identify the caller and apply RBAC. Frontend code keeps using
// plain `fetch(...)` — this wrapper is invisible to it.
//
// Scope: request the app's delegated API scope so the backend receives an
// app-audience access token (`api://<client-id>`) instead of a Graph token.
const _origFetch = window.fetch.bind(window);
let _tokenPromise = null;
const _mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function _apiRequestInfo(input, init) {
  const rawUrl = typeof input === "string" ? input : (input && input.url) || "";
  const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
  try {
    const parsed = new URL(rawUrl, window.location.origin);
    return { isApi: parsed.origin === window.location.origin && parsed.pathname.startsWith("/api/"), pathname: parsed.pathname, method };
  } catch {
    return { isApi: false, pathname: "", method };
  }
}

function _localAuthResponse(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function _getApiToken() {
  try {
    const accounts = msalInstance.getAllAccounts();
    if (!accounts || accounts.length === 0) return null;
    // Cache the in-flight acquireTokenSilent promise so a burst of fetches
    // doesn't trigger N parallel token acquisitions.
    if (!_tokenPromise) {
      _tokenPromise = msalInstance.acquireTokenSilent({
        scopes: apiScopes.access,
        account: accounts[0],
      }).then(r => r && r.accessToken).catch(() => null)
        .finally(() => { setTimeout(() => { _tokenPromise = null; }, 5000); });
    }
    return await _tokenPromise;
  } catch { return null; }
}

async function _waitForApiToken(timeoutMs = 8000) {
  const start = Date.now();
  let token = await _getApiToken();
  while (!token && Date.now() - start < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 250));
    token = await _getApiToken();
  }
  return token;
}

window.__vgcWaitForApiAuth = async function waitForApiAuth(timeoutMs = 8000) {
  return !!(await _waitForApiToken(timeoutMs));
};

function _currentPortalSessionId() {
  try {
    if (typeof window.__vgcGetPortalSessionId === "function") return window.__vgcGetPortalSessionId();
    return sessionStorage.getItem("vgc_portal_session_id") || "";
  } catch { return ""; }
}

function _notifyStalePortalSession(response) {
  if (!response || response.status !== 409) return;
  response.clone().json().then(data => {
    if (data && data.code === "STALE_SESSION") {
      window.dispatchEvent(new CustomEvent("vgc:portal-session-stale", { detail: data }));
    }
  }).catch(() => {});
}

window.fetch = async function patchedFetch(input, init) {
  try {
    const { isApi, pathname, method } = _apiRequestInfo(input, init);
    if (!isApi) return _origFetch(input, init);
    const requiresToken = _mutatingMethods.has(method) || pathname === "/api/db/users";
    const token = requiresToken ? await _waitForApiToken(8000) : await _getApiToken();
    if (!token) {
      if (requiresToken) return _localAuthResponse(401, "Authentication token is not ready. Please sign in again.");
      return _origFetch(input, init);
    }
    const headers = new Headers((init && init.headers) || (input && input.headers) || {});
    if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
    const portalSessionId = _currentPortalSessionId();
    if (portalSessionId && !headers.has("X-ITSM-Session-ID")) headers.set("X-ITSM-Session-ID", portalSessionId);
    const newInit = { ...(init || {}), headers };
    const response = await _origFetch(input, newInit);
    _notifyStalePortalSession(response);
    return response;
  } catch {
    return _origFetch(input, init);
  }
};

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error("React Error:", error, info);
    // v3.16: ship caught errors to /api/client-error so we can surface them
    // in the Audit dashboard and catch React #310-class regressions early.
    try {
      const payload = {
        message: String(error && error.message || error || "unknown").slice(0, 1000),
        stack: String(error && error.stack || "").slice(0, 4000),
        componentStack: String((info && info.componentStack) || "").slice(0, 2000),
        route: (typeof window !== "undefined" && window.location ? window.location.pathname + window.location.hash : ""),
        userAgent: (typeof navigator !== "undefined" ? navigator.userAgent : "").slice(0, 300),
        ts: new Date().toISOString(),
      };
      _origFetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    } catch {}
  }
  render() {
    if (this.state.error) return <div style={{color:"#FF6B6B",padding:40,fontFamily:"monospace",whiteSpace:"pre-wrap",background:"#080A12",minHeight:"100vh"}}>
      <h2>Application Error</h2>
      <p style={{color:"#A0AEC0",fontSize:13}}>The error has been logged. Reload to try again.</p>
      <button onClick={() => window.location.reload()} style={{padding:"8px 16px",background:"#6366F1",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",marginBottom:16}}>Reload</button>
      <pre style={{fontSize:11,opacity:0.7}}>{this.state.error.toString()}{"\n"}{this.state.error.stack}</pre>
    </div>;
    return this.props.children;
  }
}

function renderApp() {
  // Clean up MSAL auth hash (#code=...) so it doesn't linger in the URL
  if (window.location.hash && window.location.hash.includes("code=")) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  const rootEl = document.getElementById("root") || (() => { const el = document.createElement("div"); el.id = "root"; document.body.appendChild(el); return el; })();
  createRoot(rootEl).render(
    <ErrorBoundary>
      <MsalProvider instance={msalInstance}>
        <I18nProvider>
          <ITSMApp />
        </I18nProvider>
      </MsalProvider>
    </ErrorBoundary>
  );
}

// Initialize MSAL, process any redirect response, then ALWAYS render the app.
msalInstance.initialize().then(async () => {
  try {
    await msalInstance.handleRedirectPromise();
  } catch (e) {
    console.error("MSAL redirect error:", e);
  }
  renderApp();
}).catch(e => {
  console.error("MSAL init error:", e);
  renderApp(); // Still render — user can retry login
});
