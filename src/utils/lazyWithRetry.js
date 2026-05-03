// lazyWithRetry — wrap React.lazy with chunk-load retry + auto-reload recovery.
//
// Why: After a deploy, browsers holding a stale index.html try to fetch
// chunk hashes that no longer exist (e.g. mod-knowledge-OLDHASH.js → 404).
// Vite throws "Failed to fetch dynamically imported module".
//
// Strategy:
//   1. First failure → wait briefly, retry once (handles flaky network / CDN race).
//   2. Second failure → set a sessionStorage flag and force window.location.reload(true)
//      (which fetches a fresh index.html with current chunk hashes). Guard
//      against infinite reload loops by checking the flag before reloading.
//
// Usage:
//   import { lazyWithRetry } from "./src/utils/lazyWithRetry.js";
//   const Foo = lazyWithRetry(() => import("./Foo.jsx"));
import { lazy } from "react";

const RELOAD_FLAG = "__lazyChunkReload__";

function isChunkLoadError(err) {
  if (!err) return false;
  const msg = String(err.message || err);
  return /Failed to fetch dynamically imported module/i.test(msg)
      || /Loading chunk \S+ failed/i.test(msg)
      || /Importing a module script failed/i.test(msg)
      || /error loading dynamically imported module/i.test(msg);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

export function lazyWithRetry(factory) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err1) {
      if (!isChunkLoadError(err1)) throw err1;
      // First retry after 600ms — handles transient CDN/network blips.
      await delay(600);
      try {
        return await factory();
      } catch (err2) {
        if (!isChunkLoadError(err2)) throw err2;
        // Stale chunk after deploy. Hard-reload once. Guard against loops.
        try {
          const alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG);
          if (!alreadyReloaded) {
            sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
            // eslint-disable-next-line no-console
            console.warn("[lazyWithRetry] Stale chunk detected, forcing reload to fetch fresh index.html");
            window.location.reload();
            // Return a never-resolving promise so React doesn't render an error
            // before reload completes.
            return new Promise(() => {});
          }
        } catch { /* sessionStorage may be unavailable */ }
        throw err2;
      }
    }
  });
}

// Clear the reload guard once the app has rendered successfully (called from main.jsx).
export function clearLazyReloadGuard() {
  try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ }
}
