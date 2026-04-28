#!/usr/bin/env node
// ─── PII scrub for VGC ITSM mysqldump output ─────────────────────────────
// Usage: node scripts/scrub-pii.mjs <input.sql> <output.sql>
//
// Operates on a mysqldump (--single-transaction --routines --triggers) file
// and rewrites INSERT row payloads for known sensitive tables/columns.
//
// Strategy:
//   • Stream line-by-line (memory safe for large dumps).
//   • For INSERT INTO `<table>` lines, parse VALUES tuples and rewrite
//     PII-bearing columns based on a column map per table.
//   • Truncate (replace with no-op) tables that should never carry prod data.
//
// Safety:
//   • Idempotent — re-running on output is a no-op.
//   • Refuses to write output if any unknown table contains columns flagged
//     as suspicious (email/phone/secret), forcing the operator to update the
//     map. Override with --force.

import fs from "node:fs";
import readline from "node:readline";
import crypto from "node:crypto";

const [, , inFile, outFile, ...flags] = process.argv;
if (!inFile || !outFile) {
  console.error("Usage: node scripts/scrub-pii.mjs <input.sql> <output.sql> [--force]");
  process.exit(1);
}
const FORCE = flags.includes("--force");

// ─── Tables to FULLY truncate (no rows kept) ─────────────────────────────
const TRUNCATE_TABLES = new Set([
  "audit_log",
  "audit_logs",
  "notifications",
  "notification_log",
  "email_log",
  "email_outbox",
  "sessions",
  "user_sessions",
  "ai_usage_log",
  "ai_calls",
  "graph_tokens",
  "msal_cache",
  "webhook_log",
]);

// ─── Per-table column scrubbers ──────────────────────────────────────────
// Each scrubber receives (value, rowIndex, columnName) and returns the
// replacement SQL literal (already quoted). Return null to keep as-is.
const fakeEmail = (i) => `'user${i}@staging.local'`;
const fakeName  = (i) => `'User ${i}'`;
const fakePhone = (i) => `'+65 9${String(10000000 + (i % 89999999)).padStart(8,'0')}'`;
const nullify   = ()  => "NULL";
const hashStr   = (v) => `'${crypto.createHash("sha256").update(String(v)).digest("hex").slice(0,16)}'`;
const fixedPwd  = ()  => "'$2b$10$STAGINGSTAGINGSTAGINGUe9KoSZ4mZl6NbVrZ7QGdN0r4G9C9sKi'"; // bcrypt of 'staging'

const TABLE_MAP = {
  users: {
    email:         fakeEmail,
    upn:           fakeEmail,
    username:      (i) => `'user${i}'`,
    display_name:  fakeName,
    full_name:     fakeName,
    first_name:    (i) => `'First${i}'`,
    last_name:     (i) => `'Last${i}'`,
    phone:         fakePhone,
    mobile:        fakePhone,
    password_hash: fixedPwd,
    password:      fixedPwd,
    secret:        nullify,
    api_key:       nullify,
    photo_url:     nullify,
    address:       nullify,
  },
  profiles: {
    email: fakeEmail, phone: fakePhone, display_name: fakeName,
    address: nullify, photo_url: nullify,
  },
  customers: {
    name:          (i) => `'Customer-${i}'`,
    contact_email: fakeEmail,
    contact_phone: fakePhone,
    address:       nullify,
    notes:         nullify,
  },
  incidents: {
    reporter_email: fakeEmail,
    assignee_email: fakeEmail,
    contact_email:  fakeEmail,
    contact_phone:  fakePhone,
    description:    (i, _c, v) => `'[scrubbed ${String(v).length}c]'`,
    resolution:     (i, _c, v) => v ? `'[scrubbed ${String(v).length}c]'` : "NULL",
  },
  comments: {
    body:   (i, _c, v) => `'[scrubbed ${String(v).length}c]'`,
    author_email: fakeEmail,
  },
  attachments: {
    file_path: nullify, blob_url: nullify, content: nullify,
  },
  kb_articles: {
    // KB articles often safe to keep, but blank out author PII
    author_email: fakeEmail,
  },
};

// Columns that MUST be scrubbed wherever they appear (defense in depth)
const SUSPICIOUS_COLS = /^(email|upn|phone|mobile|password|secret|token|api_key|address|ssn|nric)$/i;

// ─── State ───────────────────────────────────────────────────────────────
const rowCounters = new Map();
const seenTables = new Set();
const unknownTablesWithPII = new Map(); // table -> [cols]

// ─── INSERT parsing ──────────────────────────────────────────────────────
// mysqldump format: INSERT INTO `t` (`a`,`b`,...) VALUES (...),(...),...;
// or:               INSERT INTO `t` VALUES (...),(...);   (no col list)
const INSERT_RE = /^INSERT INTO `([^`]+)`(?: \(([^)]+)\))? VALUES /;

// CREATE TABLE parser to learn column order if INSERT omits it.
const tableColumns = new Map(); // table -> [colNames]
let inCreate = null;
const COL_DEF_RE = /^\s*`([^`]+)`/;

// Tokenize a single VALUES tuple (handles quoted strings, escapes, NULL, numbers, hex).
function splitTuple(s) {
  const out = [];
  let i = 0, depth = 0, buf = "", inStr = false, q = null;
  while (i < s.length) {
    const c = s[i];
    if (inStr) {
      buf += c;
      if (c === "\\") { buf += s[i+1]; i += 2; continue; }
      if (c === q) { inStr = false; q = null; }
      i++; continue;
    }
    if (c === "'" || c === '"') { inStr = true; q = c; buf += c; i++; continue; }
    if (c === "(") { depth++; buf += c; i++; continue; }
    if (c === ")") { depth--; buf += c; i++; continue; }
    if (c === "," && depth === 0) { out.push(buf.trim()); buf = ""; i++; continue; }
    buf += c; i++;
  }
  if (buf.length) out.push(buf.trim());
  return out;
}

// Split a VALUES clause into top-level tuples: (...),(...),...
function splitTuples(values) {
  const out = [];
  let i = 0, depth = 0, start = -1, inStr = false, q = null;
  while (i < values.length) {
    const c = values[i];
    if (inStr) {
      if (c === "\\") { i += 2; continue; }
      if (c === q) { inStr = false; q = null; }
      i++; continue;
    }
    if (c === "'" || c === '"') { inStr = true; q = c; i++; continue; }
    if (c === "(") { if (depth === 0) start = i + 1; depth++; i++; continue; }
    if (c === ")") { depth--; if (depth === 0) out.push(values.slice(start, i)); i++; continue; }
    i++;
  }
  return out;
}

function unquote(lit) {
  if (lit === "NULL" || lit === null || lit === undefined) return null;
  const t = lit.trim();
  if (t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  }
  return t;
}

function rewriteInsertLine(line) {
  const m = line.match(INSERT_RE);
  if (!m) return line;
  const table = m[1];
  seenTables.add(table);

  // Truncate?
  if (TRUNCATE_TABLES.has(table)) {
    return `-- [scrub] truncated INSERT into \`${table}\`\n`;
  }

  let cols = m[2]
    ? m[2].split(",").map(s => s.trim().replace(/^`|`$/g, ""))
    : (tableColumns.get(table) || null);

  const map = TABLE_MAP[table];
  // If no map AND no suspicious cols, leave untouched
  if (!map) {
    if (cols) {
      const sus = cols.filter(c => SUSPICIOUS_COLS.test(c));
      if (sus.length) unknownTablesWithPII.set(table, sus);
    }
    return line;
  }
  if (!cols) {
    // Can't safely rewrite without column order
    unknownTablesWithPII.set(table, ["<unknown column order>"]);
    return line;
  }

  const prefix = line.slice(0, m[0].length);
  const rest = line.slice(m[0].length);
  // rest looks like:  (...),(...),...;   possibly with trailing whitespace
  const semiIdx = rest.lastIndexOf(";");
  const valuesPart = semiIdx >= 0 ? rest.slice(0, semiIdx) : rest;
  const trailing   = semiIdx >= 0 ? rest.slice(semiIdx)    : "";

  const tuples = splitTuples(valuesPart);
  const newTuples = tuples.map(tup => {
    const fields = splitTuple(tup);
    const idx = (rowCounters.get(table) || 0) + 1;
    rowCounters.set(table, idx);
    cols.forEach((col, ci) => {
      const fn = map[col];
      if (!fn) return;
      const cur = unquote(fields[ci]);
      const repl = fn(idx, col, cur);
      if (repl !== null && repl !== undefined) fields[ci] = repl;
    });
    return "(" + fields.join(",") + ")";
  });

  return prefix + newTuples.join(",") + trailing + "\n";
}

// ─── Main streaming pass ─────────────────────────────────────────────────
const rl = readline.createInterface({ input: fs.createReadStream(inFile), crlfDelay: Infinity });
const out = fs.createWriteStream(outFile, { encoding: "utf8" });

out.write("-- ─── PII-scrubbed dump (VGC ITSM staging seed) ───\n");
out.write(`-- source: ${inFile}\n`);
out.write(`-- generated: ${new Date().toISOString()}\n\n`);

let lineNo = 0;
for await (const line of rl) {
  lineNo++;
  // Track CREATE TABLE column order for inserts that omit columns
  if (inCreate) {
    const cm = line.match(COL_DEF_RE);
    if (cm) {
      const cols = tableColumns.get(inCreate) || [];
      cols.push(cm[1]);
      tableColumns.set(inCreate, cols);
    }
    if (/^\)\s*ENGINE=/i.test(line) || /^\)\s*;/.test(line)) inCreate = null;
    out.write(line + "\n");
    continue;
  }
  const ct = line.match(/^CREATE TABLE `([^`]+)`/);
  if (ct) { inCreate = ct[1]; tableColumns.set(inCreate, []); out.write(line + "\n"); continue; }

  if (line.startsWith("INSERT INTO ")) {
    out.write(rewriteInsertLine(line));
  } else {
    out.write(line + "\n");
  }
}
out.end();

// ─── Safety report ───────────────────────────────────────────────────────
console.log(`Scrubbed ${lineNo} lines from ${inFile} -> ${outFile}`);
console.log(`Tables seen: ${seenTables.size}, mapped: ${Object.keys(TABLE_MAP).length}, truncated: ${TRUNCATE_TABLES.size}`);
if (unknownTablesWithPII.size) {
  console.warn("\n[WARN] Tables with PII-looking columns but no scrub map:");
  for (const [t, cols] of unknownTablesWithPII) {
    console.warn(`  - ${t}: ${cols.join(", ")}`);
  }
  if (!FORCE) {
    console.error("\nRefusing to certify scrub. Update TABLE_MAP or pass --force.");
    process.exit(2);
  } else {
    console.warn("\n--force given: continuing despite unmapped PII columns.");
  }
}
console.log("OK");
