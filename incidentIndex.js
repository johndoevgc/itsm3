// ─── Incident Index ──────────────────────────────────────────────────────
// In-process Map<id, incident> with derived sets, kept hot via wrapped
// db.upsert / db.deleteOne calls. Eliminates the 15+ routes that previously
// did `db.getAll("incidents")` + JSON.parse on every row per request.
//
// Phase 9 — observed p50 ~120ms on incident-heavy routes drops to <10ms once
// the index is loaded (single boot-time scan + warm updates).
//
// Usage:
//   const idx = require("./incidentIndex").create({ db });
//   await idx.warm();                     // boot once
//   idx.wrapDb();                          // monkey-patch upsert/deleteOne
//   const all  = idx.all();                // Array<incident>  (no parse)
//   const open = idx.byOpenStatus();       // pre-filtered open set
//   const inc  = idx.get("INC-123");
//   const stats = idx.stats();

const OPEN_STATUSES = new Set(["New", "Open", "In Progress", "Pending", "On Hold", "Reopened"]);

function create({ db, collection = "incidents" } = {}) {
  if (!db) throw new Error("incidentIndex.create requires { db }");

  const map = new Map();           // id -> incident object
  const byZdId = new Map();        // String(zdTicketId) -> id
  let warmedAt = null;
  let lastUpdate = null;
  let upserts = 0;
  let deletes = 0;
  let warmMs = 0;

  function _safeParse(s) {
    if (!s) return null;
    if (typeof s === "object") return s;  // already parsed (e.g. row.data)
    try { return JSON.parse(s); } catch { return null; }
  }

  function _put(inc) {
    if (!inc || !inc.id) return;
    const prev = map.get(inc.id);
    if (prev && prev.zdTicketId && String(prev.zdTicketId) !== String(inc.zdTicketId || "")) {
      byZdId.delete(String(prev.zdTicketId));
    }
    map.set(inc.id, inc);
    if (inc.zdTicketId) byZdId.set(String(inc.zdTicketId), inc.id);
    lastUpdate = new Date().toISOString();
  }

  function _del(id) {
    const prev = map.get(id);
    if (!prev) return false;
    if (prev.zdTicketId) byZdId.delete(String(prev.zdTicketId));
    map.delete(id);
    deletes++;
    lastUpdate = new Date().toISOString();
    return true;
  }

  // ─── Warm: load all rows once at boot ────────────────────────────────
  async function warm() {
    const t0 = Date.now();
    const rows = await db.getAll(collection);
    map.clear(); byZdId.clear();
    let parseErrors = 0;
    for (const r of rows || []) {
      const inc = _safeParse(r.data);
      if (!inc || !inc.id) { parseErrors++; continue; }
      map.set(inc.id, inc);
      if (inc.zdTicketId) byZdId.set(String(inc.zdTicketId), inc.id);
    }
    warmedAt = new Date().toISOString();
    warmMs = Date.now() - t0;
    console.log(`[IncidentIndex] Warmed ${map.size} incidents in ${warmMs}ms${parseErrors ? ` (skipped ${parseErrors} parse errors)` : ""}`);
    return { count: map.size, ms: warmMs, parseErrors };
  }

  // ─── Wrap db.upsert / deleteOne so writes update the index live ──────
  // Idempotent — safe to call multiple times.
  function wrapDb() {
    if (db.__incidentIndexWrapped) return;
    const origUpsert = db.upsert.bind(db);
    const origDelete = db.deleteOne ? db.deleteOne.bind(db) : null;

    db.upsert = async (coll, id, data) => {
      const result = await origUpsert(coll, id, data);
      if (coll === collection) {
        const inc = _safeParse(data);
        if (inc) { _put(inc); upserts++; }
      }
      return result;
    };

    if (origDelete) {
      db.deleteOne = async (coll, id) => {
        const result = await origDelete(coll, id);
        if (coll === collection) _del(id);
        return result;
      };
    }
    db.__incidentIndexWrapped = true;
    console.log("[IncidentIndex] db.upsert + db.deleteOne wrapped");
  }

  // ─── Read API ────────────────────────────────────────────────────────
  function get(id) { return map.get(id) || null; }
  function getByZdTicketId(zdId) {
    if (zdId === undefined || zdId === null) return null;
    const ourId = byZdId.get(String(zdId));
    return ourId ? map.get(ourId) : null;
  }
  function all() { return Array.from(map.values()); }
  function size() { return map.size; }
  function filter(pred) {
    const out = [];
    for (const inc of map.values()) if (pred(inc)) out.push(inc);
    return out;
  }
  function byStatus(status) {
    return filter(i => (i.status || "").trim() === status);
  }
  function byOpenStatus() {
    return filter(i => OPEN_STATUSES.has((i.status || "").trim()));
  }
  function openWithZdLink() {
    return filter(i => OPEN_STATUSES.has((i.status || "").trim()) && i.zdTicketId);
  }
  function openWithoutZdLink() {
    return filter(i => OPEN_STATUSES.has((i.status || "").trim()) && !i.zdTicketId);
  }

  function stats() {
    return {
      size: map.size,
      zdLinked: byZdId.size,
      warmedAt,
      warmMs,
      lastUpdate,
      upserts,
      deletes,
      wrapped: !!db.__incidentIndexWrapped,
    };
  }

  // ─── Force re-sync from DB (rare; e.g. direct DB writes) ─────────────
  async function refresh() { return warm(); }

  return {
    warm, refresh, wrapDb,
    get, getByZdTicketId, all, size, filter,
    byStatus, byOpenStatus, openWithZdLink, openWithoutZdLink,
    stats,
    OPEN_STATUSES,
  };
}

module.exports = { create, OPEN_STATUSES };
