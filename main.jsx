import React, { Component, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MsalProvider } from "@azure/msal-react";
import { msalInstance } from "./msalConfig.js";
import ITSMApp from "./itsm-tool.jsx";

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("React Error:", error, info); }
  render() {
    if (this.state.error) return <div style={{color:"#FF6B6B",padding:40,fontFamily:"monospace",whiteSpace:"pre-wrap",background:"#080A12",minHeight:"100vh"}}><h2>React Error Caught</h2><pre>{this.state.error.toString()}{"\n"}{this.state.error.stack}</pre></div>;
    return this.props.children;
  }
}

function renderApp() {
  // Clean up MSAL auth hash (#code=...) so it doesn't linger in the URL
  if (window.location.hash && window.location.hash.includes("code=")) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  createRoot(document.getElementById("root")).render(
    <ErrorBoundary>
      <MsalProvider instance={msalInstance}>
        <ITSMApp />
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
