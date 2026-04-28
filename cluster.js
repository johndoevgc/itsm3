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

  for (let i = 0; i < WORKERS; i++) cluster.fork();

  cluster.on("exit", (worker, code, signal) => {
    if (signal === "SIGTERM" || signal === "SIGINT") return;        // expected shutdown
    console.warn(`[Cluster] Worker ${worker.process.pid} exited (code ${code}). Restarting…`);
    cluster.fork();
  });

  // Forward signals to workers for graceful shutdown
  const shutdown = (sig) => {
    console.log(`[Cluster] ${sig} received — shutting down workers`);
    for (const id in cluster.workers) {
      try { cluster.workers[id].process.kill(sig); } catch {}
    }
    setTimeout(() => process.exit(0), 12000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
} else {
  // Each worker runs the full server (shared port via SO_REUSEPORT)
  require("./server");
  console.log(`[Cluster] Worker ${process.pid} started`);
}
