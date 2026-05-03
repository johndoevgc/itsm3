import React from "react";
import { USERS } from "../constants/rbac.js";
import { APP_VERSION } from "../constants/version.js";
import { allLoginScopes } from "../../msalConfig.js";

export default function LoginPage({ localUsername, setLocalUsername, localPassword, setLocalPassword, localLoginError, setLocalLoginError, localLoginLoading, setLocalLoginLoading, setCurrentUser, setIsLoggedIn, setErrorAdvisory, msalInstance }) {
const loginCards = [
  {
    id: "dev-admin",
    user: USERS[0] || null,
    icon: "🛡️",
    title: "VGC Dev Admin",
    subtitle: "Developer / Vendor",
    gradient: "linear-gradient(135deg, #FF6B6B22 0%, #6366F122 50%, #06B6D422 100%)",
    borderColor: "#FF6B6B",
    glowColor: "#FF6B6B",
    features: [
      { icon: "☁️", label: "Azure Services", desc: "Full cloud infrastructure, App Services, SQL, Functions, Storage, CDN, VMs" },
      { icon: "🤖", label: "AI Suggestions", desc: "Copilot-powered code & architecture recommendations, anomaly detection" },
      { icon: "📊", label: "Predictions", desc: "ML-driven capacity forecasting, incident trend analysis, SLA risk scoring" },
      { icon: "🔧", label: "Remediation", desc: "Automated runbook execution, self-healing infrastructure, rollback orchestration" },
      { icon: "💰", label: "Cost Optimization", desc: "Azure Advisor integration, right-sizing VMs, reserved instance savings" },
      { icon: "🔑", label: "API & Secrets", desc: "Key Vault, API management, Entra ID config, webhook & integration settings" },
    ],
    badge: "SUPER ADMIN",
    badgeColor: "#FF6B6B",
  },
  {
    id: "vgc-admin",
    user: USERS[1] || null,
    icon: "🏢",
    title: "VGC Admin",
    subtitle: "End Customer Admin",
    gradient: "linear-gradient(135deg, #EC489922 0%, #8B5CF622 50%, #6366F122 100%)",
    borderColor: "#EC4899",
    glowColor: "#EC4899",
    features: [
      { icon: "👥", label: "User Management", desc: "RBAC roles, Entra ID sync, group policies, SCIM provisioning" },
      { icon: "📋", label: "Compliance", desc: "PDPA, audit logs, data retention, regulatory reporting" },
      { icon: "⚙️", label: "Customisation", desc: "Tenant branding, workflow builder, SLA policy configuration" },
      { icon: "📈", label: "Analytics", desc: "KPI dashboards, trend reports, team performance metrics" },
    ],
    badge: "TENANT ADMIN",
    badgeColor: "#EC4899",
  },
  {
    id: "engineer",
    user: USERS[2] || null,
    icon: "🔧",
    title: "Service Support Engineers",
    subtitle: "End Customer Engineer",
    gradient: "linear-gradient(135deg, #06B6D422 0%, #81C78422 50%, #6366F122 100%)",
    borderColor: "#06B6D4",
    glowColor: "#06B6D4",
    features: [
      { icon: "🎫", label: "Ticket Management", desc: "Create, triage, escalate incidents & service requests" },
      { icon: "📚", label: "Knowledge Base", desc: "AI-powered article lookup, contribute & publish solutions" },
      { icon: "🔍", label: "Diagnostics", desc: "Root cause analysis, AI troubleshooting assistant" },
      { icon: "📡", label: "Monitoring", desc: "Real-time alerts, SLA tracking, asset health checks" },
    ],
    badge: "ENGINEER",
    badgeColor: "#06B6D4",
  },
];

const handleLogin = (_user) => {
  // intentionally no-op: demo bypass removed (production-only login).
  // Reserved as a placeholder hook for future env-isolated demo URL.
};
// eslint-disable-next-line no-unused-vars
void handleLogin;

// ─── Local Auth (Dev Admin only) ────────────────────────────────────
const handleLocalLogin = async () => {
  if (!localUsername.trim() || !localPassword) { setLocalLoginError("Enter username and password"); return; }
  setLocalLoginLoading(true); setLocalLoginError("");
  try {
    const resp = await fetch("/api/auth/local", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: localUsername.trim(), password: localPassword }),
    });
    const data = await resp.json();
    if (!resp.ok) { setLocalLoginError(data.error || "Authentication failed"); return; }
    setCurrentUser(data.user);
    setIsLoggedIn(true);
  } catch (err) {
    setLocalLoginError("Connection error — check server");
  } finally { setLocalLoginLoading(false); }
};

// ─── Entra ID SSO Login (VGC Admin & Engineers) ─────────────────────
const handleSSOLogin = async (fallbackUser) => {
  try {
    // Store fallback user context so the post-redirect useEffect can recover it
    sessionStorage.setItem("itsm_sso_fallback", JSON.stringify(fallbackUser));
    // Use redirect (not popup) — avoids popup-blocker and white-page race conditions
    await msalInstance.loginRedirect({
      scopes: allLoginScopes,
      prompt: "select_account",
    });
    // Page navigates away — code below never executes
  } catch (err) {
    console.error("SSO Login failed:", err);
    if (err.errorCode === "user_cancelled") return;
    setErrorAdvisory({
      type: "SSO Login",
      code: err.errorCode || "MSAL_ERROR",
      message: err.message || "Single Sign-On authentication failed",
      timestamp: new Date().toISOString(),
      details: err.errorMessage || err.message || "The Microsoft Entra ID login encountered an error. This could be due to network issues or Azure AD configuration.",
      stack: err.stack?.substring(0, 500) || ""
    });
  }
};

return (
  <div style={{
    minHeight: "100vh", background: "#080A12", color: "#E8ECF4",
    fontFamily: "'DM Sans', -apple-system, sans-serif",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    position: "relative", overflow: "hidden",
  }}>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
      @keyframes loginGridMove { 0% { transform: translateY(0); } 100% { transform: translateY(-50px); } }
      @keyframes loginGlow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
      @keyframes loginCardFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
      @keyframes loginOrb1 { 0% { transform: translate(0,0) scale(1); } 33% { transform: translate(60px,-40px) scale(1.1); } 66% { transform: translate(-30px,50px) scale(0.9); } 100% { transform: translate(0,0) scale(1); } }
      @keyframes loginOrb2 { 0% { transform: translate(0,0) scale(1); } 33% { transform: translate(-50px,30px) scale(0.95); } 66% { transform: translate(40px,-60px) scale(1.08); } 100% { transform: translate(0,0) scale(1); } }
      @keyframes loginOrb3 { 0% { transform: translate(0,0) scale(1); } 33% { transform: translate(30px,50px) scale(1.05); } 66% { transform: translate(-60px,-20px) scale(0.92); } 100% { transform: translate(0,0) scale(1); } }
      @keyframes loginShimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
      @keyframes loginPulseRing { 0% { transform: scale(1); opacity: 0.4; } 100% { transform: scale(2.5); opacity: 0; } }
      @keyframes loginFeatureFade { 0% { opacity: 0; transform: translateX(-8px); } 100% { opacity: 1; transform: translateX(0); } }
      @keyframes loginBtnGlow { 0%, 100% { box-shadow: 0 0 8px var(--glow) ; } 50% { box-shadow: 0 0 20px var(--glow), 0 0 40px color-mix(in srgb, var(--glow) 40%, transparent); } }
      .login-card { transition: all 0.4s cubic-bezier(0.34,1.56,0.64,1); }
      .login-card:hover { transform: translateY(-8px) scale(1.02); }
      .login-btn { transition: all 0.3s ease; }
      .login-btn:hover { filter: brightness(1.15); transform: scale(1.03); }
      .login-feature-row { transition: all 0.25s ease; }
      .login-feature-row:hover { background: #ffffff08 !important; transform: translateX(3px); }
    `}</style>

    {/* Background animated orbs */}
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      <div style={{ position: "absolute", top: "10%", left: "15%", width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, #6366F115 0%, transparent 70%)", animation: "loginOrb1 12s ease-in-out infinite" }} />
      <div style={{ position: "absolute", top: "60%", right: "10%", width: 250, height: 250, borderRadius: "50%", background: "radial-gradient(circle, #EC489915 0%, transparent 70%)", animation: "loginOrb2 15s ease-in-out infinite" }} />
      <div style={{ position: "absolute", bottom: "20%", left: "50%", width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, #06B6D415 0%, transparent 70%)", animation: "loginOrb3 10s ease-in-out infinite" }} />
      {/* Grid pattern */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(#6366F108 1px, transparent 1px), linear-gradient(90deg, #6366F108 1px, transparent 1px)", backgroundSize: "40px 40px", animation: "loginGridMove 20s linear infinite" }} />
    </div>

    {/* Logo & Title */}
    <div style={{ textAlign: "center", marginBottom: 40, position: "relative", zIndex: 2 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
        <div style={{
          width: 62, height: 62, borderRadius: 16,
          background: "linear-gradient(135deg, #D4AF37, #FFD700, #B8860B, #F59E0B, #D4AF37)",
          backgroundSize: "300% 300%",
          animation: "logoGradient 4s ease infinite",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 20px #FFD70044, 0 0 40px #D4AF3722",
          position: "relative",
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: 12,
            background: "radial-gradient(ellipse at 30% 30%, #141620, #0A0C14)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{
              fontSize: 26, fontWeight: 900, fontFamily: "'Space Grotesk', sans-serif",
              background: "linear-gradient(135deg, #FFD700, #D4AF37, #FFF8DC, #FFD700, #B8860B)",
              backgroundSize: "300% 300%",
              animation: "goldShimmer 3s linear infinite",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}>V</span>
          </div>
          <div style={{ position: "absolute", inset: -4, borderRadius: 20, border: "1.5px solid #FFD70033", animation: "loginPulseRing 3s ease-out infinite" }} />
        </div>
        <div>
          <div style={{
            fontSize: 28, fontWeight: 800, fontFamily: "'Space Grotesk', sans-serif",
            background: "linear-gradient(90deg, #6366F1, #06B6D4, #EC4899, #F59E0B, #6366F1)",
            backgroundSize: "300% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            backgroundClip: "text", animation: "loginShimmer 4s linear infinite",
          }}>
            VGC-ITSM
          </div>
          <div style={{ fontSize: 11, color: "#5A6178", letterSpacing: 2.5, textTransform: "uppercase", fontWeight: 500 }}>
            AI-Powered IT Service Management
          </div>
        </div>
      </div>
      <div style={{ fontSize: 13, color: "#5A617899", maxWidth: 500, margin: "0 auto", lineHeight: 1.6 }}>
        Sign in to continue. This is the production environment — all actions are audited.
      </div>
    </div>

    {/* Login Cards */}
    <div style={{
      display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "center",
      maxWidth: 1200, padding: "0 20px", position: "relative", zIndex: 2,
    }}>
      {loginCards.map((card, ci) => (
        <div key={card.id} className="login-card" style={{
          width: 340, background: card.gradient, backdropFilter: "blur(20px)",
          border: `1.5px solid ${card.borderColor}33`, borderRadius: 20,
          padding: 0, overflow: "hidden", cursor: "default",
          boxShadow: `0 8px 32px ${card.glowColor}15, 0 0 0 1px #ffffff06`,
          animation: `loginCardFloat ${5 + ci}s ease-in-out infinite`,
          animationDelay: `${ci * 0.3}s`,
        }}>
          {/* Card Header */}
          <div style={{
            padding: "24px 24px 16px", display: "flex", alignItems: "center", gap: 14,
            borderBottom: `1px solid ${card.borderColor}15`,
          }}>
            <div style={{
              width: 50, height: 50, borderRadius: 14,
              background: `linear-gradient(135deg, ${card.borderColor}33, ${card.borderColor}11)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, position: "relative",
            }}>
              {card.icon}
              <div style={{ position: "absolute", inset: -3, borderRadius: 17, border: `1.5px solid ${card.borderColor}22`, animation: "loginGlow 3s ease-in-out infinite" }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#E8ECF4", fontFamily: "'Space Grotesk', sans-serif" }}>{card.title}</div>
              <div style={{ fontSize: 11, color: "#5A6178", marginTop: 2 }}>{card.subtitle}</div>
            </div>
            <div style={{
              padding: "3px 10px", borderRadius: 20, fontSize: 8, fontWeight: 700,
              background: `${card.badgeColor}22`, color: card.badgeColor,
              border: `1px solid ${card.badgeColor}44`, letterSpacing: 1.2, textTransform: "uppercase",
            }}>
              {card.badge}
            </div>
          </div>

          {/* Features */}
          <div style={{ padding: "12px 16px 8px" }}>
            {card.features.map((f, fi) => (
              <div key={fi} className="login-feature-row" style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px",
                borderRadius: 10, marginBottom: 2, cursor: "default",
                animation: `loginFeatureFade 0.5s ease-out ${fi * 0.08}s both`,
              }}>
                <span style={{ fontSize: 15, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{f.icon}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#C8CDD8" }}>{f.label}</div>
                  <div style={{ fontSize: 10, color: "#5A617899", lineHeight: 1.4, marginTop: 1 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Sign-in Button */}
          <div style={{ padding: "12px 20px 22px" }}>
            {card.id === "dev-admin" ? (
              <>
                {/* ─── Local Auth Form (Dev Admin Only) ────────────────── */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
                  <input type="text" placeholder="Username" value={localUsername}
                    onChange={e => { setLocalUsername(e.target.value); setLocalLoginError(""); }}
                    onKeyDown={e => e.key === "Enter" && handleLocalLogin()}
                    autoComplete="username"
                    style={{
                      width: "100%", padding: "10px 14px", borderRadius: 10,
                      background: "#0D0F1A", border: `1.5px solid ${localLoginError ? "#FF6B6B55" : "#FF6B6B33"}`,
                      color: "#E8ECF4", fontSize: 13, outline: "none",
                      fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box",
                    }} />
                  <input type="password" placeholder="Password" value={localPassword}
                    onChange={e => { setLocalPassword(e.target.value); setLocalLoginError(""); }}
                    onKeyDown={e => e.key === "Enter" && handleLocalLogin()}
                    autoComplete="current-password"
                    style={{
                      width: "100%", padding: "10px 14px", borderRadius: 10,
                      background: "#0D0F1A", border: `1.5px solid ${localLoginError ? "#FF6B6B55" : "#FF6B6B33"}`,
                      color: "#E8ECF4", fontSize: 13, outline: "none",
                      fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box",
                    }} />
                </div>
                {localLoginError && (
                  <div style={{ fontSize: 11, color: "#FF6B6B", textAlign: "center", marginBottom: 6 }}>
                    ⚠️ {localLoginError}
                  </div>
                )}
                <button className="login-btn" onClick={handleLocalLogin} disabled={localLoginLoading} style={{
                  width: "100%", padding: "13px 0", borderRadius: 12,
                  background: localLoginLoading ? "#FF6B6B88" : `linear-gradient(135deg, ${card.borderColor}, ${card.borderColor}CC)`,
                  border: "none", color: "#fff", fontSize: 13, fontWeight: 700, cursor: localLoginLoading ? "wait" : "pointer",
                  fontFamily: "'DM Sans', sans-serif", letterSpacing: 0.5,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                  "--glow": `${card.borderColor}66`, animation: "loginBtnGlow 3s ease-in-out infinite",
                }}>
                  🔐 {localLoginLoading ? "Authenticating..." : "Sign In (Local)"}
                </button>
                <div style={{ textAlign: "center", marginTop: 8, fontSize: 10, color: "#5A617866" }}>
                  🛡️ Local Authentication • Developer Access Only
                </div>
              </>
            ) : card.id === "vgc-admin" || card.id === "engineer" ? (
              <>
                <button className="login-btn" onClick={() => handleSSOLogin(card.user)} style={{
                  width: "100%", padding: "13px 0", borderRadius: 12,
                  background: `linear-gradient(135deg, ${card.borderColor}, ${card.borderColor}CC)`,
                  border: "none", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif", letterSpacing: 0.5,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                  "--glow": `${card.borderColor}66`, animation: "loginBtnGlow 3s ease-in-out infinite",
                }}>
                  <svg width="16" height="16" viewBox="0 0 23 23" fill="none"><path d="M1 1h10v10H1z" fill="#f25022"/><path d="M12 1h10v10H12z" fill="#7fba00"/><path d="M1 12h10v10H1z" fill="#00a4ef"/><path d="M12 12h10v10H12z" fill="#ffb900"/></svg>
                  Sign in with Microsoft Entra ID
                </button>
                <div style={{ textAlign: "center", marginTop: 8, fontSize: 10, color: "#5A617866" }}>
                  {card.id === "vgc-admin"
                    ? "🔐 Live SSO • MFA Enforced • vgcsg.com Tenant"
                    : "🔐 Live SSO • Entra ID Sync • Role assigned by Admin"}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ))}
    </div>

    {/* Footer */}
    <div style={{ marginTop: 48, textAlign: "center", position: "relative", zIndex: 2 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 16px", borderRadius: 20, background: "#6366F10A", border: "1px solid #6366F122", marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#6366F1", fontFamily: "'Space Grotesk', sans-serif" }}>v{APP_VERSION.version}</span>
        <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#81C784" }} />
        <span style={{ fontSize: 10, color: "#8A8FA8" }}>{APP_VERSION.engine}</span>
      </div>
      <div style={{ fontSize: 10, color: "#5A617866", letterSpacing: 1 }}>
        VGC Technology Pte Ltd • Singapore • PDPA Compliant
      </div>
      <div style={{ fontSize: 9, color: "#5A617855", marginTop: 4 }}>
        Build {APP_VERSION.build} • {APP_VERSION.platform} • Powered by Azure AI & Microsoft Entra ID
      </div>
    </div>
  </div>
);
}
