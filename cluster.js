/**
 * Phase 7 — Node Cluster entry point
 * Forks N workers for HTTP request handling.
 * Primary process manages no HTTP traffic — only coordinates restarts.
 *
 * Usage:  node cluster.js          (or set WEB_CONCURRENCY env var)
 * Fallback: node server.js         (single-process, unchanged)
 */
const cluster = require("node:cluster");
const os = require("node:os");

const WORKERS = parseInt(process.env.WEB_CONCURRENCY, 10) || Math.min(os.cpus().length, 4);

if (cluster.isPrimary) {
  console.log(`[Cluster] Primary ${process.pid} — forking ${WORKERS} workers`);

  // Track each worker's index so we can re-fork with the same role on crash.
  // The first worker (index 0) is the "scheduler" — it owns periodic jobs
  // (SLA snapshots, Zendesk auto-sync, log/audit purges, uptime probes).
  // Other workers only serve HTTP requests, preventing duplicated cron work.
  const workerIndexById = new Map();
  const forkWorker = (idx) => {
    // Pass WEB_CONCURRENCY explicitly so workers know the cluster size and
    // can scale per-worker quotas (e.g. rate limiter buckets) accordingly.
    const w = cluster.fork({ WORKER_INDEX: String(idx), WEB_CONCURRENCY: String(WORKERS) });
    workerIndexById.set(w.id, idx);
  };
  for (let i = 0; i < WORKERS; i++) forkWorker(i);

  cluster.on("exit", (worker, code, signal) => {
    if (signal === "SIGTERM" || signal === "SIGINT") return;        // expected shutdown
    const idx = workerIndexById.get(worker.id);
    workerIndexById.delete(worker.id);
    console.warn(`[Cluster] Worker ${worker.process.pid} (idx=${idx}) exited (code ${code}). Restarting…`);
    forkWorker(typeof idx === "number" ? idx : 0);
  });

  // Forward signals to workers for graceful shutdown
  const shutdown = (sig) => {
    console.log(`[Cluster] ${sig} received — shutting down workers`);
    for (const id in cluster.workers) {
      try { cluster.workers[id].process.kill(sig); } catch { /* ignore */ }
    }
    setTimeout(() => process.exit(0), 12000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
} else {
  // Defensive: log unhandled errors but do NOT exit. The previous behaviour
  // (default Node 22 --unhandled-rejections=throw) caused a crash-loop when
  // a single route handler threw a ReferenceError.
  process.on("unhandledRejection", (reason) => {
    console.error(`[Worker ${process.pid}] unhandledRejection:`, reason && reason.stack || reason);
  });
  process.on("uncaughtException", (err) => {
    console.error(`[Worker ${process.pid}] uncaughtException:`, err && err.stack || err);
  });

  // Each worker runs the full server (shared port via SO_REUSEPORT)
  require("./server");
  console.log(`[Cluster] Worker ${process.pid} started`);
}
