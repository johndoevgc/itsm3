#!/usr/bin/env node
// One-shot codemod: wrap inline-defined `*Module` components in useStableComponent.
// Strategy: scan file line-by-line. When a line matches `  const XxxModule = () => {`
// or `  const XxxModule = () => (`, find the matching closing brace/paren by
// balanced brace counting, then rewrite open + close.

const fs = require("fs");
const path = require("path");
const FILE = path.resolve(__dirname, "..", "itsm-tool.jsx");
const SKIP = new Set([
  "IncidentsModule", "CatalogModule", "KnowledgeModule", // already wrapped
  "renderModule", // not a component
]);

const src = fs.readFileSync(FILE, "utf8");
const lines = src.split("\n");

// Token-style brace counter that ignores chars inside strings, template literals,
// regex literals, line comments, and block comments. Returns position info.
function findMatching(text, startIdx, openChar, closeChar) {
  let depth = 0;
  let i = startIdx;
  let inSingle = false, inDouble = false, inTpl = false, inLineCmt = false, inBlockCmt = false;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (inLineCmt) { if (c === "\n") inLineCmt = false; i++; continue; }
    if (inBlockCmt) { if (c === "*" && next === "/") { inBlockCmt = false; i += 2; continue; } i++; continue; }
    if (inSingle) { if (c === "\\") { i += 2; continue; } if (c === "'") inSingle = false; i++; continue; }
    if (inDouble) { if (c === "\\") { i += 2; continue; } if (c === '"') inDouble = false; i++; continue; }
    if (inTpl) { if (c === "\\") { i += 2; continue; } if (c === "`") inTpl = false; i++; continue; }
    if (c === "/" && next === "/") { inLineCmt = true; i += 2; continue; }
    if (c === "/" && next === "*") { inBlockCmt = true; i += 2; continue; }
    if (c === "'") { inSingle = true; i++; continue; }
    if (c === '"') { inDouble = true; i++; continue; }
    if (c === "`") { inTpl = true; i++; continue; }
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

const moduleRe = /^( {2}const )(\w+Module)( = )\(\) => (\{|\()/;
const edits = []; // {start, end, replace}
const wrapped = [];
const skipped = [];

let cursor = 0;
for (let lineNo = 0; lineNo < lines.length; lineNo++) {
  const line = lines[lineNo];
  const m = line.match(moduleRe);
  if (!m) { cursor += line.length + 1; continue; }
  const [full, indentConst, name, eq, openChar] = m;
  if (SKIP.has(name)) { cursor += line.length + 1; continue; }
  const openIdx = src.indexOf(openChar, cursor + line.indexOf("=>"));
  const closeChar = openChar === "{" ? "}" : ")";
  const matchIdx = findMatching(src, openIdx, openChar, closeChar);
  if (matchIdx < 0) { skipped.push(`${name} (no match)`); cursor += line.length + 1; continue; }
  // Confirm next non-whitespace after closing is `;` then optional newline.
  let after = matchIdx + 1;
  while (after < src.length && /[ \t]/.test(src[after])) after++;
  if (src[after] !== ";") { skipped.push(`${name} (no trailing ;)`); cursor += line.length + 1; continue; }
  // Build edits:
  // open line: replace `() => {` / `() => (` with `useStableComponent(() => {` / `useStableComponent(() => (`
  const openLineStart = cursor;
  const openLineEnd = cursor + line.length;
  const newOpenLine = line.replace(`= () => ${openChar}`, `= useStableComponent(() => ${openChar}`);
  edits.push({ start: openLineStart, end: openLineEnd, replace: newOpenLine });
  // close: insert `)` immediately before the `;` that follows the matching close char.
  // i.e. transform `<close>;` → `<close>);`
  edits.push({ start: matchIdx + 1, end: after, replace: ")" });
  // Wait — matchIdx points to closing char itself. The `;` is at `after`. We want `<close>);` → leave the close char, then add `)` before the `;`.
  // We already pushed insert-style: replace whitespace-between-close-and-; with `)`. Simpler: just insert `)` at position `after` and don't replace anything between close and ;.
  // Fix the previous edit:
  edits.pop();
  edits.push({ start: after, end: after, replace: ")" });
  wrapped.push(`${name} (line ${lineNo + 1})`);
  cursor += line.length + 1;
}

// Apply edits in reverse order so positions remain valid.
edits.sort((a, b) => b.start - a.start);
let out = src;
for (const e of edits) out = out.slice(0, e.start) + e.replace + out.slice(e.end);

fs.writeFileSync(FILE, out, "utf8");
console.log(`Wrapped ${wrapped.length} modules:`);
wrapped.forEach(w => console.log("  + " + w));
if (skipped.length) {
  console.log(`Skipped ${skipped.length}:`);
  skipped.forEach(s => console.log("  - " + s));
}
