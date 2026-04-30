// ─── App Version ─────────────────────────────────────────────────────────
// version + build are injected by Vite from VERSION.json at build time.
// See vite.config.js (define block). Fallback only used in dev preview.
/* global __APP_VERSION__, __APP_BUILD__ */
const _VER = (typeof __APP_VERSION__ !== "undefined") ? __APP_VERSION__ : "dev";
const _BLD = (typeof __APP_BUILD__ !== "undefined") ? __APP_BUILD__ : "local";

export const APP_VERSION = {
  version: _VER,
  build: _BLD,
  date: _BLD,
  channel: "Production",
  name: "ITSM",
  engine: "ITSM-AI v4.0 (Multi-Model: Pro/Mini/Nano)",
  platform: "Azure App Service (Linux Node 20)",
  region: "AP-Southeast (Singapore)",
  license: "Enterprise — Per User Subscription",
  framework: "React 19 + Vite 8",
  auth: "Microsoft Entra ID + Local Auth",
  compliance: "ISO 27001, PDPA, CSA Cybertrust",
};
