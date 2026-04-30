/**
 * AI routes (/api/ai/*) + CSAT + incident dedup
 * Extracted from server.js — Phase 4
 */
const https = require("https");

module.exports = function createAIRoutes(ctx) {
  return async function handleAIRoutes(req, res, pathname, auth, authResult, urlObj) {
    const { db, json, readBody, parseBody, sendText, callAI, extractAIText, wsServer, slaEngine, normalizeCategory, graphSendMail, AI_THRESHOLDS, AI_MODELS, getAIModel, shouldSkipAction, trackNewAction, getAiActionsDedupState, getSlaMap, getSlaDescription, getManagedIdentityToken, getOrgName, MERAKI_API_KEYS, SOPHOS_CLIENT_ID, SOPHOS_CLIENT_SECRET, AI_AUTONOMY_LEVEL, PROD_TEST_MODE, AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP } = ctx;
  if (pathname === "/api/ai/knowledge" && req.method === "GET") {
    try {
      const items = await db.getAll("ai_knowledge");
      const entries = items.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      return json(res, 200, { entries, total: entries.length });
    } catch (err) {
      console.error("[AI Knowledge GET]", err.message);
      return json(res, 500, { error: err.message });
    }
  }
  if (pathname === "/api/ai/knowledge" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const { title, category, content, tags, trainedBy } = body;
      if (!title || !content) return json(res, 400, { error: "title and content are required" });
      const id = `kb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const entry = { id, title: title.trim(), category: (category || "General").trim(), content: content.trim(), tags: (tags || []).map(t => t.trim().toLowerCase()), trainedBy: trainedBy || "Unknown", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await db.upsert("ai_knowledge", id, JSON.stringify(entry));
      await db.audit("ai_knowledge", id, "create", JSON.stringify({ title, category }), trainedBy || "Unknown");
      console.log(`[AI Knowledge] Created: "${title}" by ${trainedBy} (${category})`);
      return json(res, 201, { entry });
    } catch (err) {
      console.error("[AI Knowledge POST]", err.message);
      return json(res, 500, { error: err.message });
    }
  }
  if (pathname.startsWith("/api/ai/knowledge/") && req.method === "DELETE") {
    try {
      const id = pathname.split("/api/ai/knowledge/")[1];
      if (!id) return json(res, 400, { error: "ID required" });
      await db.deleteOne("ai_knowledge", decodeURIComponent(id));
      console.log(`[AI Knowledge] Deleted: ${id}`);
      return json(res, 200, { deleted: true });
    } catch (err) {
      console.error("[AI Knowledge DELETE]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI Knowledge: PUT /api/ai/knowledge/:id (Update with Version Control) ───
  if (pathname.match(/^\/api\/ai\/knowledge\/[^/]+$/) && req.method === "PUT") {
    try {
      const id = decodeURIComponent(pathname.split("/api/ai/knowledge/")[1]);
      if (!id) return json(res, 400, { error: "ID required" });
      const body = await parseBody(req);
      const existing = await db.getOne("ai_knowledge", id);
      if (!existing) return json(res, 404, { error: "Entry not found" });
      const prev = JSON.parse(existing.data);
      // Save version history
      const versionId = `ver_${id}_${Date.now()}`;
      const version = {
        id: versionId, docId: id, version: (prev.version || 1),
        title: prev.title, category: prev.category, content: prev.content,
        tags: prev.tags, updatedBy: prev.updatedBy || prev.trainedBy,
        updatedAt: prev.updatedAt, changeNote: body.changeNote || "Updated"
      };
      await db.upsert("ai_knowledge_versions", versionId, JSON.stringify(version));
      // Update the entry
      const updated = {
        ...prev,
        title: (body.title || prev.title).trim(),
        category: (body.category || prev.category).trim(),
        content: (body.content || prev.content).trim(),
        tags: body.tags || prev.tags,
        updatedBy: body.updatedBy || "Unknown",
        updatedAt: new Date().toISOString(),
        version: (prev.version || 1) + 1
      };
      await db.upsert("ai_knowledge", id, JSON.stringify(updated));
      await db.audit("ai_knowledge", id, "update", JSON.stringify({ version: updated.version, changeNote: body.changeNote }), body.updatedBy || "Unknown");
      console.log(`[AI Knowledge] Updated: "${updated.title}" v${updated.version} by ${body.updatedBy}`);
      return json(res, 200, { entry: updated });
    } catch (err) {
      console.error("[AI Knowledge PUT]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI Knowledge: GET /api/ai/knowledge/:id/versions ─────────────
  if (pathname.match(/^\/api\/ai\/knowledge\/[^/]+\/versions$/) && req.method === "GET") {
    try {
      const id = decodeURIComponent(pathname.split("/api/ai/knowledge/")[1].replace("/versions", ""));
      const allVersions = await db.getAll("ai_knowledge_versions");
      const versions = allVersions
        .map(r => { try { return JSON.parse(r.data); } catch { return null; } })
        .filter(v => v && v.docId === id)
        .sort((a, b) => b.version - a.version);
      return json(res, 200, { versions, total: versions.length });
    } catch (err) {
      console.error("[AI Knowledge Versions]", err.message);
      return json(res, 200, { versions: [], total: 0 });
    }
  }

  // ─── AI Knowledge: POST /api/ai/knowledge/correction — user corrects AI answer ─
  if (pathname === "/api/ai/knowledge/correction" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const { originalQuestion, originalAnswer, correctedAnswer, correctedBy } = body || {};
      if (!originalQuestion || !correctedAnswer || !correctedBy) {
        return json(res, 400, { error: "originalQuestion, correctedAnswer, and correctedBy are required" });
      }
      const correctionId = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const entry = {
        id: correctionId,
        title: `AI Correction: ${originalQuestion.substring(0, 80)}`,
        category: "AI Correction",
        content: `QUESTION: ${originalQuestion}\n\nCORRECT ANSWER: ${correctedAnswer}\n\nORIGINAL AI ANSWER (incorrect/incomplete): ${(originalAnswer || "").substring(0, 500)}`,
        tags: ["ai-correction", "human-verified", "training"],
        trainedBy: correctedBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: "user-correction",
        type: "correction",
        originalQuestion,
        originalAnswer: (originalAnswer || "").substring(0, 1000),
        correctedAnswer,
      };
      await db.upsert("ai_knowledge", correctionId, JSON.stringify(entry));
      await db.audit("ai_knowledge", correctionId, "create", JSON.stringify({ type: "ai-correction", correctedBy, question: originalQuestion.substring(0, 100) }), correctedBy);
      console.log(`[AI Correction] Saved by ${correctedBy}: "${originalQuestion.substring(0, 60)}"`);
      return json(res, 200, { success: true, id: correctionId, message: "Correction saved — VGC AI will use this in future responses" });
    } catch (err) {
      console.error("[AI Correction]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI Knowledge: POST /api/ai/knowledge/learn ───────────────────
  if (pathname === "/api/ai/knowledge/learn" && req.method === "POST") {
    try {
      const items = await db.getAll("ai_knowledge");
      const entries = items.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      const uploadedDocs = entries.filter(e => e.fileName || e.source === "uploaded" || (e.tags || []).includes("uploaded"));
      // Mark all as AI-processed
      let processed = 0;
      for (const doc of uploadedDocs) {
        if (doc.aiProcessed) continue;
        doc.aiProcessed = true;
        doc.aiProcessedAt = new Date().toISOString();
        await db.upsert("ai_knowledge", doc.id, JSON.stringify(doc));
        processed++;
      }
      console.log(`[AI Learn] Processed ${processed} uploaded documents for AI training`);
      return json(res, 200, { success: true, processed, totalUploaded: uploadedDocs.length });
    } catch (err) {
      console.error("[AI Learn]", err.message);
      return json(res, 500, { error: err.message });
    }
  }
  if (pathname === "/api/ai/knowledge/search" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const query = (body.query || "").toLowerCase();
      if (!query) return json(res, 400, { error: "query required" });
      const items = await db.getAll("ai_knowledge");
      const entries = items.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      // Score each entry by keyword match
      const scored = entries.map(e => {
        let score = 0;
        const words = query.split(/\s+/).filter(w => w.length > 2);
        const haystack = `${e.title || ""} ${e.content || ""} ${e.category || ""} ${(e.tags || []).join(" ")}`.toLowerCase();
        words.forEach(w => { if (haystack.includes(w)) score += 10; });
        if ((e.title || "").toLowerCase().includes(query)) score += 50;
        if (e.tags && e.tags.some(t => query.includes(t))) score += 30;
        return { ...e, score };
      }).filter(e => e.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
      return json(res, 200, { results: scored, total: scored.length });
    } catch (err) {
      console.error("[AI Knowledge Search]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI Knowledge File Upload: POST /api/ai/knowledge/upload ───────
  if (pathname === "/api/ai/knowledge/upload" && req.method === "POST") {
    try {
      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("multipart/form-data")) {
        return json(res, 400, { error: "multipart/form-data required" });
      }
      // Parse multipart form data manually (no external deps)
      const boundary = contentType.split("boundary=")[1];
      if (!boundary) return json(res, 400, { error: "Missing boundary" });
      const chunks = [];
      await new Promise((resolve, reject) => {
        req.on("data", c => chunks.push(c));
        req.on("end", resolve);
        req.on("error", reject);
      });
      const buf = Buffer.concat(chunks);
      const parts = buf.toString("binary").split("--" + boundary).filter(p => p.trim() && p.trim() !== "--");
      let title = "", category = "General", tags = "", trainedBy = "Unknown", fileName = "", fileType = "", fileSize = 0, fileContent = "";
      for (const part of parts) {
        const [headerSection, ...bodySections] = part.split("\r\n\r\n");
        const body = bodySections.join("\r\n\r\n").replace(/\r\n$/, "");
        const nameMatch = headerSection.match(/name="([^"]+)"/);
        const filenameMatch = headerSection.match(/filename="([^"]+)"/);
        if (!nameMatch) continue;
        const fieldName = nameMatch[1];
        if (filenameMatch) {
          fileName = filenameMatch[1];
          fileSize = Buffer.byteLength(body, "binary");
          const ext = fileName.split(".").pop().toLowerCase();
          const typeMap = { doc: "Word", docx: "Word", xls: "Excel", xlsx: "Excel", ppt: "PowerPoint", pptx: "PowerPoint", pdf: "PDF", txt: "Text", csv: "CSV", md: "Markdown", json: "JSON", png: "Image", jpg: "Image", jpeg: "Image", gif: "Image", webp: "Image", mp4: "Video", webm: "Video", mov: "Video" };
          fileType = typeMap[ext] || "Document";
          // For text-based files, extract content
          if (["txt", "csv", "md", "json"].includes(ext)) {
            fileContent = Buffer.from(body, "binary").toString("utf8").substring(0, 10000);
          }
        } else {
          const val = body.trim();
          if (fieldName === "title") title = val;
          else if (fieldName === "category") category = val;
          else if (fieldName === "tags") tags = val;
          else if (fieldName === "trainedBy") trainedBy = val;
        }
      }
      if (!fileName) return json(res, 400, { error: "No file uploaded" });
      const id = `kb_file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const entry = {
        id, title: (title || fileName).trim(), category: (category || "General").trim(),
        content: fileContent || `[Uploaded ${fileType}: ${fileName}] (${(fileSize / 1024).toFixed(1)} KB)\n\nFile type: ${fileType}. This document has been indexed for AI training reference.`,
        tags: tags ? tags.split(",").map(t => t.trim().toLowerCase()).filter(Boolean) : [fileType.toLowerCase()],
        trainedBy: trainedBy || "Unknown",
        fileName, fileType, fileSize,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      await db.upsert("ai_knowledge", id, JSON.stringify(entry));
      await db.audit("ai_knowledge", id, "upload", JSON.stringify({ fileName, fileType, fileSize }), trainedBy);
      console.log(`[AI Knowledge Upload] "${fileName}" (${fileType}, ${(fileSize / 1024).toFixed(1)}KB) by ${trainedBy}`);
      return json(res, 201, { entry });
    } catch (err) {
      console.error("[AI Knowledge Upload]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI Knowledge Sync: merge Zendesk + KB into unified training ───
  if (pathname === "/api/ai/knowledge/sync" && req.method === "POST") {
    try {
      let synced = 0;
      // Import all resolved Zendesk tickets as KB entries (if not already imported)
      try {
        const ticketRows = await db.getAll("zendesk_tickets");
        const tickets = ticketRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
        const resolved = tickets.filter(t => t.status === "solved" || t.status === "closed");
        const commentRows = await db.getAll("zendesk_comments");
        const allComments = commentRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
        const existingKb = await db.getAll("ai_knowledge");
        const existingIds = new Set(existingKb.map(r => { try { return JSON.parse(r.data).id; } catch { return ""; } }));

        for (const t of resolved) {
          const kbId = `kb_zd_${t.id}`;
          if (existingIds.has(kbId)) continue;
          const tComments = allComments.filter(c => c.ticketId === t.id && c.public);
          const resolution = tComments.length > 0 ? tComments[tComments.length - 1].body : t.description || "";
          const entry = {
            id: kbId, title: `[Zendesk #${t.id}] ${t.subject || "Ticket"}`, category: "Zendesk",
            content: `Subject: ${t.subject}\nStatus: ${t.status}\nPriority: ${t.priority || "Normal"}\nTags: ${(t.tags || []).join(", ")}\n\nDescription: ${(t.description || "").substring(0, 800)}\n\nResolution: ${(resolution || "").substring(0, 1000)}`,
            tags: ["zendesk", "auto-synced", ...(t.tags || []).slice(0, 5)],
            trainedBy: "Daily Sync", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            source: "zendesk-sync", type: "ticket-resolution"
          };
          await db.upsert("ai_knowledge", kbId, JSON.stringify(entry));
          synced++;
        }
      } catch (e) { console.warn("[AI Sync] Zendesk import:", e.message); }

      // Update sync metadata
      const syncMeta = {
        id: "sync_metadata", lastSync: new Date().toISOString(),
        totalEntries: (await db.getAll("ai_knowledge")).length,
        syncedThisRun: synced,
        nextSync: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      };
      await db.upsert("ai_knowledge", "sync_metadata", JSON.stringify(syncMeta));
      console.log(`[AI Sync] Completed — ${synced} new entries synced, total: ${syncMeta.totalEntries}`);
      return json(res, 200, syncMeta);
    } catch (err) {
      console.error("[AI Sync]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI Knowledge Sync Status ─────────────────────────────────────
  if (pathname === "/api/ai/knowledge/sync-status" && req.method === "GET") {
    try {
      const meta = await db.getOne("ai_knowledge", "sync_metadata");
      if (meta) {
        return json(res, 200, JSON.parse(meta.data));
      }
      return json(res, 200, { lastSync: null, totalEntries: (await db.getAll("ai_knowledge")).length, nextSync: null });
    } catch (err) {
      return json(res, 200, { lastSync: null, totalEntries: 0, nextSync: null });
    }
  }

  // ─── AI Generate Professional Guide from Zendesk History ───────────
  if (pathname === "/api/ai/generate-guide" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req);
      const { topic, category, includeScreenshots } = body || {};
      if (!topic) return json(res, 400, { error: "topic is required" });

      // Gather all Zendesk ticket history related to this topic
      let zdContext = "";
      try {
        const ticketRows = await db.getAll("zendesk_tickets");
        const tickets = ticketRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
        const topicLower = topic.toLowerCase();
        const topicWords = topicLower.split(/\s+/).filter(w => w.length > 2);

        const relevant = tickets.filter(t => {
          const searchable = `${t.subject || ""} ${t.description || ""} ${(t.tags || []).join(" ")}`.toLowerCase();
          return topicWords.some(w => searchable.includes(w));
        }).slice(0, 30);

        if (relevant.length > 0) {
          // Get comments for relevant tickets
          const commentRows = await db.getAll("zendesk_comments");
          const allComments = commentRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

          zdContext = "\n\n=== ZENDESK TICKET HISTORY (Use this as primary reference) ===\n";
          for (const t of relevant.slice(0, 15)) {
            const tComments = allComments.filter(c => c.ticketId === t.id && c.public);
            const resolution = tComments.length > 0 ? tComments[tComments.length - 1].body : "";
            zdContext += `\n--- Ticket #${t.id}: ${t.subject || "No subject"} ---\n`;
            zdContext += `Status: ${t.status} | Priority: ${t.priority || "Normal"} | Tags: ${(t.tags || []).join(", ")}\n`;
            zdContext += `Description: ${(t.description || "").substring(0, 400)}\n`;
            if (resolution) zdContext += `Resolution: ${resolution.substring(0, 600)}\n`;
          }
          zdContext += "\n=== END ZENDESK HISTORY ===\n";
        }
      } catch (e) { console.warn("[AI Guide] Zendesk data fetch:", e.message); }

      // Also gather internal KB entries
      let kbContext = "";
      try {
        const kbItems = await db.getAll("ai_knowledge");
        const kbEntries = kbItems.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
        const topicLower = topic.toLowerCase();
        const matched = kbEntries.filter(e => {
          const searchable = `${e.title} ${e.content} ${e.category} ${(e.tags || []).join(" ")}`.toLowerCase();
          return topicLower.split(/\s+/).some(w => w.length > 2 && searchable.includes(w));
        }).slice(0, 10);
        if (matched.length > 0) {
          kbContext = "\n\n=== INTERNAL KNOWLEDGE BASE ===\n" +
            matched.map(m => `[${m.category}] ${m.title}:\n${m.content}`).join("\n---\n") +
            "\n=== END INTERNAL KB ===\n";
        }
      } catch (e) { console.warn("[AI Guide] KB fetch:", e.message); }

      const systemPrompt = `You are a professional IT documentation writer for VGC Technology Pte Ltd, Singapore. You create comprehensive, user-friendly technical guides and documentation.

TASK: Generate a COMPLETE, professional-grade technical guide/documentation on the topic: "${topic}"
Category: ${category || "General"}

REQUIREMENTS — MUST follow ALL:
1. TITLE: Clear, professional title with document metadata (version, date, author, category)
2. TABLE OF CONTENTS: Numbered sections
3. OVERVIEW/INTRODUCTION: What this guide covers, who it's for, prerequisites
4. STEP-BY-STEP INSTRUCTIONS: Every step numbered, with clear actions. Each step MUST include:
   - 📸 [Screenshot: <description of what to capture>] — placeholder for where screenshots should be taken
   - 💡 Tip or Note callouts for important information
   - ⚠️ Warning callouts for critical steps
5. TROUBLESHOOTING SECTION: Common issues and fixes (based on Zendesk history if available)
6. FAQ SECTION: At least 5 frequently asked questions with answers
7. REFERENCE LINKS: Official vendor documentation, Microsoft Learn links, etc.
8. APPENDIX: Glossary of terms, related articles, version history

FORMATTING RULES:
- Use Markdown formatting throughout
- Include screenshot placeholders: 📸 [Screenshot: description]
- Use tables for structured data (settings, configurations, comparison)
- Use code blocks for commands, scripts, paths
- Use callout boxes: 💡 **Tip:** | ⚠️ **Warning:** | ℹ️ **Note:** | ✅ **Best Practice:**
- Include estimated time for each major section
- Professional tone but user-friendly and easy to follow
- Minimum 2000 words — be thorough and comprehensive

${zdContext}
${kbContext}

IMPORTANT: Reference real ticket data and resolutions from the Zendesk history above. Cite specific ticket numbers when referencing past issues and solutions. If no Zendesk data is available, generate based on industry best practices and common enterprise IT patterns.`;

      const userPrompt = `Generate a complete professional guide on: ${topic}`;

      const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 4000 };

      const aiUrl = new URL(ctx.AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({
          hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": ctx.AZURE_OPENAI_KEY },
        }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => {
            if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
            else reject(new Error(`Azure OpenAI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
          });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(120000, () => { aiReq.destroy(); reject(new Error("Azure OpenAI timeout (120s)")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      if (!text) return json(res, 502, { error: "Empty response from Azure OpenAI" });

      // Auto-save as KB entry
      const guideId = `kb_guide_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const entry = {
        id: guideId, title: `Guide: ${topic}`, category: category || "General",
        content: text, tags: ["ai-generated", "guide", ...topic.toLowerCase().split(/\s+/).filter(w => w.length > 2).slice(0, 5)],
        trainedBy: "AI Guide Generator", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: "ai-generated", type: "guide"
      };
      await db.upsert("ai_knowledge", guideId, JSON.stringify(entry));
      await db.audit("ai_knowledge", guideId, "create", JSON.stringify({ title: entry.title, category: entry.category, type: "ai-generated-guide" }), "AI Guide Generator");

      console.log(`[AI Guide] Generated guide: "${topic}" (${text.length} chars)`);
      return json(res, 200, { guide: text, id: guideId, title: entry.title, zdTicketsReferenced: zdContext ? zdContext.split("--- Ticket #").length - 1 : 0 });
    } catch (err) {
      console.error("[AI Guide Generator]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // ─── AI Generate Doc from SharePoint Link ─────────────────────────
  if (pathname === "/api/ai/generate-doc" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req);
      const { url, title, docType } = body || {};
      if (!url && !title) return json(res, 400, { error: "url or title is required" });

      const systemPrompt = `You are a professional IT documentation writer for VGC Technology Pte Ltd, Singapore.

TASK: Generate a professional documentation article based on the SharePoint document library resource.

SharePoint URL: ${url || "N/A"}
Document Title: ${title || "Untitled"}
Document Type: ${docType || "General Documentation"}

Create a COMPLETE professional documentation that includes:
1. **Document Header**: Title, version, date, classification, author
2. **Executive Summary**: 2-3 paragraph overview
3. **Scope & Purpose**: What this document covers
4. **Detailed Content**: Comprehensive step-by-step content with:
   - 📸 [Screenshot: <description>] placeholders for visual references
   - Numbered procedures with clear actions
   - Tables for configuration settings or comparisons
   - Code blocks for any commands or scripts
5. **Security & Compliance Notes**: PDPA, ISO 27001 considerations
6. **Related Documents**: Links to related SharePoint documents
7. **Revision History**: Version tracking table
8. **Approval Section**: Sign-off template

FORMATTING: Use professional Markdown. Include screenshot placeholders. Be thorough (1500+ words).
TONE: Professional, clear, suitable for enterprise IT documentation.
LINK BACK: Reference the SharePoint Document Library: ${url || "SharePoint > Shared Documents"}`;

      const userPrompt = `Generate professional documentation for: ${title || url}`;

      const payload = { model: ctx.AZURE_OPENAI_MODEL, input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 3000 };

      const aiUrl = new URL(ctx.AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({
          hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": ctx.AZURE_OPENAI_KEY },
        }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => {
            if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
            else reject(new Error(`Azure OpenAI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
          });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(90000, () => { aiReq.destroy(); reject(new Error("Azure OpenAI timeout (90s)")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      if (!text) return json(res, 502, { error: "Empty response from Azure OpenAI" });

      // Auto-save as KB entry
      const docId = `kb_sp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const entry = {
        id: docId, title: title || `SharePoint Doc: ${url}`, category: docType || "General",
        content: text, tags: ["sharepoint", "ai-generated", "documentation"],
        trainedBy: "SharePoint Doc Generator", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: "sharepoint", spUrl: url, type: "sharepoint-doc"
      };
      await db.upsert("ai_knowledge", docId, JSON.stringify(entry));
      await db.audit("ai_knowledge", docId, "create", JSON.stringify({ title: entry.title, url, type: "sharepoint-doc" }), "SharePoint Doc Generator");

      console.log(`[AI Doc] Generated from SharePoint: "${title || url}" (${text.length} chars)`);
      return json(res, 200, { document: text, id: docId, title: entry.title });
    } catch (err) {
      console.error("[AI Doc Generator]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // ─── AI Error Resolver ─────────────────────────────────────────────
  if (pathname === "/api/ai/resolve-error" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req);
      const { errorType, errorCode, errorMessage, errorDetails, errorStack, context } = body || {};
      if (!errorMessage) return json(res, 400, { error: "errorMessage is required" });

      // Check internal KB for similar past errors
      let pastResolutions = "";
      try {
        const kbItems = await db.getAll("ai_knowledge");
        const kbEntries = kbItems.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
        const errorLower = `${errorType} ${errorCode} ${errorMessage}`.toLowerCase();
        const matched = kbEntries.filter(e => {
          const searchable = `${e.title} ${e.content} ${(e.tags || []).join(" ")}`.toLowerCase();
          return errorLower.split(/\s+/).filter(w => w.length > 3).some(w => searchable.includes(w));
        }).slice(0, 5);
        if (matched.length > 0) {
          pastResolutions = "\n\nPAST RESOLUTIONS FROM KNOWLEDGE BASE:\n" +
            matched.map(m => `- ${m.title}: ${m.content.substring(0, 300)}`).join("\n");
        }
      } catch (e) { /* ignore */ }

      const systemPrompt = `You are an expert IT troubleshooter and error resolver for VGC Technology Pte Ltd. You MUST solve every error presented to you.

ERROR DETAILS:
- Type: ${errorType || "Unknown"}
- Code: ${errorCode || "N/A"}
- Message: ${errorMessage}
- Details: ${errorDetails || "N/A"}
- Stack: ${(errorStack || "").substring(0, 500)}
- Context: ${context || "VGC-ITSM application"}
${pastResolutions}

HARD RULES:
1. ALWAYS provide a solution — never say "I can't help" or "contact support"
2. Give IMMEDIATE actionable steps the user can try RIGHT NOW
3. Provide MULTIPLE resolution paths (primary fix + alternatives)
4. Explain WHY the error occurred in simple terms
5. Include prevention tips so it doesn't happen again

RESPONSE FORMAT:
## 🔍 Error Analysis
Brief explanation of what went wrong and why.

## ⚡ Immediate Fix (Try This First)
Step-by-step primary solution.

## 🔄 Alternative Solutions
2-3 alternative approaches if the primary fix doesn't work.

## 🛡️ Prevention
How to prevent this error in the future.

## 📚 References
Links to relevant documentation.

Keep it conversational, actionable, and human-friendly. Be a helpful colleague, not a bot.`;

      const userPrompt = `Resolve this error: ${errorType || "Error"} — ${errorMessage}`;

      const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 1500 };

      const aiUrl = new URL(ctx.AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({
          hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": ctx.AZURE_OPENAI_KEY },
        }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => {
            if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
            else reject(new Error(`Azure OpenAI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
          });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("Timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      if (!text) return json(res, 502, { error: "Empty response from AI" });
      return json(res, 200, { resolution: text, model: getAIModel("secondary") });
    } catch (err) {
      console.error("[AI Error Resolver]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // ─── AI Chat File Upload: POST /api/ai/chat/upload ──────────────────
  // Accepts file attachments, extracts text content, returns it for AI context
  if (pathname === "/api/ai/chat/upload" && req.method === "POST") {
    try {
      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("multipart/form-data")) {
        return json(res, 400, { error: "multipart/form-data required" });
      }
      const boundary = contentType.split("boundary=")[1];
      if (!boundary) return json(res, 400, { error: "Missing boundary" });

      // Size limit: 10MB
      const MAX_SIZE = 10 * 1024 * 1024;
      const chunks = [];
      let totalSize = 0;
      await new Promise((resolve, reject) => {
        req.on("data", c => {
          totalSize += c.length;
          if (totalSize > MAX_SIZE) { req.destroy(); reject(new Error("File too large (max 10MB)")); return; }
          chunks.push(c);
        });
        req.on("end", resolve);
        req.on("error", reject);
      });

      const buf = Buffer.concat(chunks);
      const parts = buf.toString("binary").split("--" + boundary).filter(p => p.trim() && p.trim() !== "--");

      // Dangerous file extensions to block
      const BLOCKED_EXTENSIONS = new Set([
        "exe", "bat", "cmd", "com", "msi", "scr", "pif", "vbs", "vbe", "js", "jse",
        "ws", "wsf", "wsc", "wsh", "ps1", "ps2", "psc1", "psc2", "msh", "msh1", "msh2",
        "inf", "reg", "rgs", "sct", "shb", "shs", "lnk", "dll", "sys", "drv", "ocx",
        "cpl", "hta", "jar", "class", "php", "asp", "aspx", "jsp", "cgi", "pl", "py",
        "rb", "sh", "bash", "zsh", "ksh", "csh", "app", "action", "command", "workflow",
        "iso", "img", "dmg", "vhd", "vmdk", "ova", "ovf"
      ]);

      const results = [];
      for (const part of parts) {
        const [headerSection, ...bodySections] = part.split("\r\n\r\n");
        const body = bodySections.join("\r\n\r\n").replace(/\r\n$/, "");
        const filenameMatch = headerSection.match(/filename="([^"]+)"/);
        if (!filenameMatch) continue;

        const fileName = filenameMatch[1];
        const ext = fileName.split(".").pop().toLowerCase();
        const fileSize = Buffer.byteLength(body, "binary");

        // Block dangerous file types
        if (BLOCKED_EXTENSIONS.has(ext)) {
          results.push({ fileName, error: `Blocked: .${ext} files are not allowed for security reasons`, blocked: true });
          continue;
        }

        // Extract text content based on file type
        let textContent = "";
        const textExts = ["txt", "csv", "md", "json", "xml", "html", "htm", "yaml", "yml", "toml", "ini", "cfg", "conf", "log", "sql", "tsv", "rtf"];
        const codeExts = ["ts", "tsx", "jsx", "css", "scss", "less", "sass", "c", "cpp", "h", "hpp", "java", "kt", "swift", "go", "rs", "r", "lua", "dart", "tf", "bicep"];

        if (textExts.includes(ext) || codeExts.includes(ext)) {
          textContent = Buffer.from(body, "binary").toString("utf8").substring(0, 15000);
        } else if (["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) {
          // Office files: extract readable text from binary (simplified — gets embedded strings)
          const raw = Buffer.from(body, "binary");
          // For docx/xlsx/pptx (ZIP-based XML), try to extract XML text
          if (ext.endsWith("x")) {
            const str = raw.toString("utf8", 0, Math.min(raw.length, 200000));
            // Extract text between XML tags
            const xmlText = str.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            textContent = xmlText.substring(0, 15000);
          } else {
            // Legacy formats: extract printable ASCII sequences
            const str = raw.toString("binary");
            const printable = str.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s{3,}/g, " ").trim();
            textContent = printable.substring(0, 10000);
          }
        } else if (["pdf"].includes(ext)) {
          // PDF: extract readable text strings
          const raw = Buffer.from(body, "binary").toString("binary");
          // Extract text between BT/ET markers and parentheses
          const textParts = [];
          const parenRegex = /\(([^)]{2,})\)/g;
          let m;
          while ((m = parenRegex.exec(raw)) !== null) {
            const t = m[1].replace(/[^\x20-\x7E]/g, "").trim();
            if (t.length > 1) textParts.push(t);
          }
          textContent = textParts.join(" ").substring(0, 15000) || `[PDF file: ${fileName}, ${(fileSize / 1024).toFixed(1)} KB — binary content, text extraction limited]`;
        } else if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tiff", "tif"].includes(ext)) {
          textContent = `[Image file: ${fileName}, ${(fileSize / 1024).toFixed(1)} KB, format: ${ext.toUpperCase()}] — Image content cannot be read as text. User may be asking you to discuss, analyze, or reference this image.`;
        } else if (["mp3", "wav", "ogg", "flac", "aac", "wma", "m4a"].includes(ext)) {
          textContent = `[Audio file: ${fileName}, ${(fileSize / 1024).toFixed(1)} KB, format: ${ext.toUpperCase()}]`;
        } else if (["mp4", "avi", "mkv", "mov", "wmv", "flv", "webm"].includes(ext)) {
          textContent = `[Video file: ${fileName}, ${(fileSize / 1024 / 1024).toFixed(1)} MB, format: ${ext.toUpperCase()}]`;
        } else if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(ext)) {
          textContent = `[Archive file: ${fileName}, ${(fileSize / 1024).toFixed(1)} KB, format: ${ext.toUpperCase()}] — Archive contents cannot be extracted in chat.`;
        } else {
          textContent = `[File: ${fileName}, ${(fileSize / 1024).toFixed(1)} KB, type: .${ext}] — Binary content, text extraction not supported for this format.`;
        }

        results.push({
          fileName,
          fileSize,
          fileType: ext.toUpperCase(),
          textContent: textContent.trim(),
          blocked: false
        });
      }

      if (results.length === 0) return json(res, 400, { error: "No files found in upload" });
      console.log(`[AI Chat Upload] ${results.length} file(s): ${results.map(r => r.fileName).join(", ")}`);
      return json(res, 200, { files: results });
    } catch (err) {
      console.error("[AI Chat Upload]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Azure OpenAI Proxy: POST /api/ai/chat ─────────────────────────
  if (pathname === "/api/ai/chat" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured on server" });
    }
    try {
      const body = await parseBody(req);
      const { systemPrompt, userPrompt } = body;
      if (!systemPrompt || !userPrompt) return json(res, 400, { error: "systemPrompt and userPrompt required" });

      // Search internal knowledge base first
      let kbContext = "";
      try {
        const kbItems = await db.getAll("ai_knowledge");
        const kbEntries = kbItems.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
        if (kbEntries.length > 0) {
          const query = userPrompt.toLowerCase();
          const words = query.split(/\s+/).filter(w => w.length > 2);
          const matched = kbEntries.map(e => {
            let score = 0;
            const haystack = `${e.title} ${e.content} ${e.category} ${(e.tags || []).join(" ")}`.toLowerCase();
            words.forEach(w => { if (haystack.includes(w)) score += 10; });
            if (e.title.toLowerCase().includes(query)) score += 50;
            if (e.tags && e.tags.some(t => query.includes(t))) score += 30;
            return { ...e, score };
          }).filter(e => e.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
          if (matched.length > 0) {
            kbContext = "\n\n=== INTERNAL KNOWLEDGE BASE (PRIORITY — use this first) ===\n" +
              matched.map(m => `[${m.category}] ${m.title}:\n${m.content}`).join("\n---\n") +
              "\n=== END INTERNAL KB ===\nIMPORTANT: Always reference internal knowledge base articles first. If the internal KB has relevant info, use it as the primary source and cite it. Only supplement with external knowledge if the internal KB doesn't fully answer the question.";
          }
        }
      } catch (e) { console.warn("[AI KB Search]", e.message); }

      const enrichedSystemPrompt = systemPrompt + kbContext;

      const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: enrichedSystemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 1500 };

      const aiUrl = new URL(ctx.AZURE_OPENAI_ENDPOINT);
      const aiReqOptions = {
        hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": ctx.AZURE_OPENAI_KEY },
      };
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request(aiReqOptions, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => {
            if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`Azure OpenAI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
            }
          });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("Azure OpenAI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      if (!text) return json(res, 502, { error: "Empty response from Azure OpenAI" });

      // ─── Server-side card hints — detect intent from user prompt ───
      const cardHints = [];
      const lc = (userPrompt || '').toLowerCase();
      if (lc.includes('create') && (lc.includes('incident') || lc.includes('ticket')))
        cardHints.push({ type: 'form', template: 'incident_quick' });
      if (lc.includes('approve') || lc.includes('approval'))
        cardHints.push({ type: 'approval', scope: 'pending' });
      if ((lc.includes('morning') || lc.includes('briefing') || lc.includes('summary')) && !lc.includes('email'))
        cardHints.push({ type: 'briefing' });
      if (lc.includes('sla') || lc.includes('breach'))
        cardHints.push({ type: 'sla_alert' });
      if (lc.includes('report') || lc.includes('metric') || lc.includes('kpi'))
        cardHints.push({ type: 'metrics' });
      if (lc.includes('knowledge') || lc.includes('kb') || lc.includes('article'))
        cardHints.push({ type: 'kb_search', query: userPrompt });

      return json(res, 200, { text, model: getAIModel("secondary"), cardHints: cardHints.length > 0 ? cardHints : undefined });
    } catch (err) {
      console.error("[Azure OpenAI Proxy]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // ─── Azure OpenAI Streaming Proxy: POST /api/ai/chat/stream ────────
  if (pathname === "/api/ai/chat/stream" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured on server" });
    }
    try {
      const body = await parseBody(req);
      const { systemPrompt, userPrompt } = body;
      if (!systemPrompt || !userPrompt) return json(res, 400, { error: "systemPrompt and userPrompt required" });

      // Search internal knowledge base first (same as non-streaming)
      let kbContext = "";
      try {
        const kbItems = await db.getAll("ai_knowledge");
        const kbEntries = kbItems.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
        if (kbEntries.length > 0) {
          const query = userPrompt.toLowerCase();
          const words = query.split(/\s+/).filter(w => w.length > 2);
          const matched = kbEntries.map(e => {
            let score = 0;
            const haystack = `${e.title} ${e.content} ${e.category} ${(e.tags || []).join(" ")}`.toLowerCase();
            words.forEach(w => { if (haystack.includes(w)) score += 10; });
            if (e.title.toLowerCase().includes(query)) score += 50;
            if (e.tags && e.tags.some(t => query.includes(t))) score += 30;
            return { ...e, score };
          }).filter(e => e.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
          if (matched.length > 0) {
            kbContext = "\n\n=== INTERNAL KNOWLEDGE BASE (PRIORITY — use this first) ===\n" +
              matched.map(m => `[${m.category}] ${m.title}:\n${m.content}`).join("\n---\n") +
              "\n=== END INTERNAL KB ===\nIMPORTANT: Always reference internal knowledge base articles first. If the internal KB has relevant info, use it as the primary source and cite it. Only supplement with external knowledge if the internal KB doesn't fully answer the question.";
          }
        }
      } catch (e) { console.warn("[AI KB Search]", e.message); }

      const enrichedSystemPrompt = systemPrompt + kbContext;

      // Build Chat Completions payload with stream: true
      const payload = {
        model: getAIModel("secondary"),
        input: [
          { role: "system", content: enrichedSystemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_output_tokens: 1500,
        stream: true
      };

      const aiUrl = new URL(ctx.AZURE_OPENAI_ENDPOINT);

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const aiReq = https.request({
        hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": ctx.AZURE_OPENAI_KEY },
      }, (aiRes) => {
        if (aiRes.statusCode < 200 || aiRes.statusCode >= 300) {
          let errData = "";
          aiRes.on("data", c => errData += c);
          aiRes.on("end", () => {
            res.write(`data: ${JSON.stringify({ error: `Azure OpenAI ${aiRes.statusCode}: ${errData.substring(0, 200)}` })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
          });
          return;
        }

        let buffer = "";
        aiRes.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // keep incomplete line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") {
              res.write(`data: ${JSON.stringify({ done: true, model: getAIModel("secondary") })}\n\n`);
              res.end();
              return;
            }
            try {
              const parsed = JSON.parse(data);
              // Responses API: response.output_text.delta has {delta: "text"} — often arrives as full text
              // Split into words for ChatGPT-like token-by-token streaming effect
              const rawToken = parsed.delta || parsed.choices?.[0]?.delta?.content;
              if (rawToken && rawToken.length > 0) {
                // If the text is long (full response), split into words for visual streaming
                if (rawToken.length > 20) {
                  const words = rawToken.split(/(\s+)/); // preserve whitespace
                  for (const word of words) {
                    if (word) res.write(`data: ${JSON.stringify({ token: word })}\n\n`);
                  }
                } else {
                  res.write(`data: ${JSON.stringify({ token: rawToken })}\n\n`);
                }
              }
              // Responses API: response.completed marks the end
              if (parsed.type === "response.completed") {
                res.write(`data: ${JSON.stringify({ done: true, model: getAIModel("secondary") })}\n\n`);
                res.end();
                return;
              }
            } catch { /* skip non-JSON lines */ }
          }
        });

        aiRes.on("end", () => {
          // Process remaining buffer
          if (buffer.trim()) {
            const trimmed = buffer.trim();
            if (trimmed.startsWith("data: ") && trimmed.slice(6) !== "[DONE]") {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                const token = parsed.delta || parsed.choices?.[0]?.delta?.content;
                if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`);
              } catch { /* skip */ }
            }
          }
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ done: true, model: getAIModel("secondary") })}\n\n`);
            res.end();
          }
        });
      });

      aiReq.on("error", (err) => {
        console.error("[AI Stream Error]", err.message);
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        }
      });
      aiReq.setTimeout(45000, () => {
        aiReq.destroy();
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: "Azure OpenAI streaming timeout" })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        }
      });

      // Handle client disconnect
      req.on("close", () => { if (!aiReq.destroyed) aiReq.destroy(); });

      aiReq.write(JSON.stringify(payload));
      aiReq.end();
      return; // streaming response — don't fall through
    } catch (err) {
      console.error("[AI Stream]", err.message);
      if (!res.headersSent) return json(res, 502, { error: err.message });
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
      return;
    }
  }

  // ─── Azure OpenAI Test Connection: GET /api/ai/test ─────────────────
  if (pathname === "/api/ai/test" && req.method === "GET") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured", configured: false });
    }
    try {
      const payload = { model: getAIModel("tertiary"), input: [{ role: "user", content: "Reply with exactly: OK" }], max_output_tokens: 16 };
      const aiUrl = new URL(ctx.AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({
          hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
          method: "POST", headers: { "Content-Type": "application/json", "api-key": ctx.AZURE_OPENAI_KEY },
        }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => {
            if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
            else reject(new Error(`Azure OpenAI ${aiRes.statusCode}: ${data.substring(0, 200)}`));
          });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(15000, () => { aiReq.destroy(); reject(new Error("Timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });
      const text = extractAIText(aiResult);
      return json(res, 200, { status: "connected", model: getAIModel("tertiary"), response: text.trim(), configured: true });
    } catch (err) {
      return json(res, 502, { error: err.message, configured: true });
    }
  }

  // ─── Cisco Meraki Dashboard API Proxy ──────────────────────────────
  if (pathname.startsWith("/api/meraki") && req.method === "GET") {
    if (MERAKI_API_KEYS.length === 0) return json(res, 503, { error: "Meraki API not configured" });
    const CACHE_TTL = 5 * 60 * 1000;
    if (!global._merakiCache) global._merakiCache = { data: null, ts: 0 };
    const mc = global._merakiCache;
    const forceRefresh = urlObj.searchParams.get("refresh") === "true";
    if (mc.data && (Date.now() - mc.ts < CACHE_TTL) && !forceRefresh) {
      return json(res, 200, { ...mc.data, cached: true, lastSync: new Date(mc.ts).toISOString() });
    }
    const merakiFetch = (path, apiKey) => new Promise((resolve, reject) => {
      const opts = { hostname: "api.meraki.com", path: `/api/v1${path}`, headers: { "X-Cisco-Meraki-API-Key": apiKey } };
      const r = https.get(opts, resp => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          const u = new URL(resp.headers.location);
          const opts2 = { hostname: u.hostname, path: u.pathname + u.search, headers: { "X-Cisco-Meraki-API-Key": apiKey } };
          const r2 = https.get(opts2, resp2 => { let d = ""; resp2.on("data", c => d += c); resp2.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } }); });
          r2.on("error", reject); r2.setTimeout(12000, () => { r2.destroy(); reject(new Error("Timeout")); });
          return;
        }
        let d = ""; resp.on("data", c => d += c); resp.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
      });
      r.on("error", reject); r.setTimeout(12000, () => { r.destroy(); reject(new Error("Timeout")); });
    });
    try {
      // Aggregate data from all API keys (each key = one MSP account with multiple orgs)
      let allOrgs = [], allDevices = [], allUplinks = [], allVpn = [], allNetworks = [];
      for (const apiKey of MERAKI_API_KEYS) {
        try {
          const orgs = await merakiFetch("/organizations", apiKey);
          if (!Array.isArray(orgs)) continue;
          allOrgs = allOrgs.concat(orgs.map(o => ({ id: o.id, name: o.name, licensing: o.licensing?.model })));
          // Fetch per-org data in parallel
          const orgPromises = orgs.map(async (org) => {
            const [devStatuses, uplinks, vpn, nets] = await Promise.allSettled([
              merakiFetch(`/organizations/${org.id}/devices/statuses`, apiKey),
              merakiFetch(`/organizations/${org.id}/uplinks/statuses`, apiKey),
              merakiFetch(`/organizations/${org.id}/appliance/vpn/statuses`, apiKey),
              merakiFetch(`/organizations/${org.id}/networks`, apiKey),
            ]);
            return {
              devices: devStatuses.status === "fulfilled" && Array.isArray(devStatuses.value) ? devStatuses.value.map(d => ({
                name: d.name || d.serial, model: d.model, serial: d.serial, status: d.status,
                lanIp: d.lanIp, publicIp: d.publicIp, networkId: d.networkId, org: org.name,
                lastReportedAt: d.lastReportedAt, firmware: d.firmware,
              })) : [],
              uplinks: uplinks.status === "fulfilled" && Array.isArray(uplinks.value) ? uplinks.value.map(u => ({
                serial: u.serial, model: u.model, networkId: u.networkId, org: org.name,
                highAvailability: u.highAvailability, lastReportedAt: u.lastReportedAt,
                uplinks: (u.uplinks || []).map(ul => ({ interface: ul.interface, status: ul.status, ip: ul.ip, publicIp: ul.publicIp, gateway: ul.gateway, dns: ul.primaryDns })),
              })) : [],
              vpn: vpn.status === "fulfilled" && Array.isArray(vpn.value) ? vpn.value.map(v => ({
                networkName: v.networkName, networkId: v.networkId, deviceStatus: v.deviceStatus,
                vpnMode: v.vpnMode, org: org.name,
                merakiPeers: (v.merakiVpnPeers || []).map(p => ({ name: p.networkName, reachability: p.reachability })),
                thirdPartyPeers: (v.thirdPartyVpnPeers || []).map(p => ({ name: p.name, ip: p.publicIp, reachability: p.reachability })),
                subnets: (v.exportedSubnets || []).map(s => ({ name: s.name, subnet: s.subnet })),
              })) : [],
              networks: nets.status === "fulfilled" && Array.isArray(nets.value) ? nets.value.map(n => ({
                id: n.id, name: n.name, org: org.name, productTypes: n.productTypes, timeZone: n.timeZone,
              })) : [],
            };
          });
          const orgResults = await Promise.all(orgPromises);
          orgResults.forEach(r => { allDevices = allDevices.concat(r.devices); allUplinks = allUplinks.concat(r.uplinks); allVpn = allVpn.concat(r.vpn); allNetworks = allNetworks.concat(r.networks); });
        } catch (e) { console.error(`[MERAKI] Error for key ${apiKey.substring(0,8)}...: ${e.message}`); }
      }
      const result = {
        organizations: allOrgs,
        devices: allDevices,
        uplinks: allUplinks,
        vpnStatus: allVpn,
        networks: allNetworks,
        summary: {
          totalOrgs: allOrgs.length,
          totalDevices: allDevices.length,
          onlineDevices: allDevices.filter(d => d.status === "online").length,
          offlineDevices: allDevices.filter(d => d.status === "offline").length,
          dormantDevices: allDevices.filter(d => d.status === "dormant").length,
          totalNetworks: allNetworks.length,
          vpnPeers: allVpn.reduce((s, v) => s + (v.merakiPeers?.length || 0) + (v.thirdPartyPeers?.length || 0), 0),
        },
      };
      mc.data = result; mc.ts = Date.now();
      console.log(`[MERAKI] Fetched ${allOrgs.length} orgs, ${allDevices.length} devices, ${allNetworks.length} networks`);
      return json(res, 200, { ...result, cached: false, lastSync: new Date(mc.ts).toISOString() });
    } catch (err) {
      console.error("[MERAKI] Error:", err.message);
      return json(res, 502, { error: "Failed to fetch Meraki data", detail: err.message });
    }
  }

  // ─── SolarWinds RMM — Test Connection ────────────────────────────────
  if (pathname === "/api/solarwinds/test" && req.method === "POST") {
    const body = await parseBody(req);
    const { apiKey, apiHost } = body || {};
    if (!apiKey) return json(res, 400, { ok: false, detail: "API key is required" });
    const host = (apiHost || "wwwasia.system-monitor.com").replace(/^(https?:\/\/)/, "").replace(/\/+$/, "");
    const testUrl = `https://${host}/api/?apikey=${encodeURIComponent(apiKey)}&service=list_clients`;
    try {
      const xml = await new Promise((resolve, reject) => {
        const doGet = (url) => {
          https.get(url, { headers: { "User-Agent": "VGC-ITSM/1.0" } }, resp => {
            if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) return doGet(resp.headers.location);
            let d = ""; resp.on("data", c => d += c); resp.on("end", () => resolve(d));
          }).on("error", reject).setTimeout(15000, function() { this.destroy(); reject(new Error("Timeout")); });
        };
        doGet(testUrl);
      });
      if (xml.includes("Login failed")) {
        return json(res, 200, { ok: false, detail: "Login failed — API key is invalid or expired. Generate a new key in N-able RMM → Settings → General Settings → API." });
      }
      // Parse clients to get summary
      const clients = []; const re = /<client[\s>]([\s\S]*?)<\/client>/gi; let m;
      while ((m = re.exec(xml))) {
        const block = m[1]; const item = {};
        block.replace(/<(\w+)>([\s\S]*?)<\/\1>/g, (_, k, v) => { item[k] = v.replace(/<!\[CDATA\[|\]\]>/g, "").trim(); });
        if (Object.keys(item).length > 0) clients.push(item);
      }
      return json(res, 200, { ok: true, summary: { totalClients: clients.length, totalServers: 0, totalWorkstations: 0 }, detail: `Authenticated successfully. Found ${clients.length} clients.` });
    } catch (err) {
      return json(res, 200, { ok: false, detail: `Connection error: ${err.message}` });
    }
  }

  // ─── Tenant Settings — Persist org info, timezone, etc to DB ────────
  if (pathname === "/api/settings/tenant" && req.method === "GET") {
    try {
      const row = await db.getOne("tenant_settings", "tenant_config");
      if (row) {
        const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
        return json(res, 200, data);
      }
      return json(res, 200, { orgName: "VGC Technology Pte Ltd", timezone: "Asia/Singapore", dateFormat: "DD-MM-YYYY", language: "en" });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }
  if (pathname === "/api/settings/tenant" && req.method === "PUT") {
    if (!auth.authenticated || !auth.role || !["admin", "super_admin"].includes(auth.role)) {
      return json(res, 403, { error: "Admin access required" });
    }
    try {
      const body = await parseBody(req);
      const { orgName, timezone, dateFormat, language } = body || {};
      const settings = { id: "tenant_config", orgName: orgName || "VGC Technology Pte Ltd", timezone: timezone || "Asia/Singapore", dateFormat: dateFormat || "DD-MM-YYYY", language: language || "en", updatedAt: new Date().toISOString() };
      await db.upsert("tenant_settings", "tenant_config", JSON.stringify(settings));
      return json(res, 200, { ok: true, ...settings });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  // ─── Azure OpenAI — Save Settings (runtime) ─────────────────────────
  if (pathname === "/api/settings/openai" && req.method === "POST") {
    if (!auth.authenticated || !auth.role || !["admin", "super_admin"].includes(auth.role)) {
      return json(res, 403, { error: "Admin access required to modify OpenAI settings" });
    }
    const body = await parseBody(req);
    const { endpoint, apiKey, model } = body || {};
    ctx.updateOpenAIConfig({ endpoint, key: apiKey, model });
    // Persist to DB so settings survive restart
    try { await db.upsert("tenant_settings", "openai_config", JSON.stringify({ id: "openai_config", endpoint: ctx.AZURE_OPENAI_ENDPOINT, apiKey: ctx.AZURE_OPENAI_KEY, model: ctx.AZURE_OPENAI_MODEL, updatedAt: new Date().toISOString() })); } catch {}
    console.log(`[OPENAI] Settings updated & persisted. Model=${ctx.AZURE_OPENAI_MODEL}, Endpoint=${ctx.AZURE_OPENAI_ENDPOINT.substring(0, 60)}...`);
    return json(res, 200, { ok: true, model: ctx.AZURE_OPENAI_MODEL, models: AI_MODELS, message: "Azure OpenAI settings updated and persisted to database." });
  }

  // ─── Azure OpenAI — Get Current Config: GET /api/settings/openai ────
  if (pathname === "/api/settings/openai" && req.method === "GET") {
    return json(res, 200, {
      model: ctx.AZURE_OPENAI_MODEL,
      models: AI_MODELS,
      endpoint: ctx.AZURE_OPENAI_ENDPOINT.replace(/api-key=[^&]+/, "api-key=***"),
      configured: !!(ctx.AZURE_OPENAI_KEY && ctx.AZURE_OPENAI_ENDPOINT),
    });
  }

  // ─── SolarWinds RMM — Save Settings ────────────────────────────────
  if (pathname === "/api/settings/solarwinds" && req.method === "POST") {
    if (!auth.authenticated || !auth.role || !["admin", "super_admin"].includes(auth.role)) {
      return json(res, 403, { error: "Admin access required to modify SolarWinds settings" });
    }
    const body = await parseBody(req);
    const { apiKey, apiHost } = body || {};
    if (!apiKey) return json(res, 400, { ok: false, detail: "API key is required" });
    ctx.updateSolarWindsConfig({ apiKey, apiHost: (apiHost || "wwwasia.system-monitor.com").replace(/^(https?:\/\/)/, "").replace(/\/+$/, "") });
    if (global._solarwindsCache) global._solarwindsCache = { data: null, ts: 0 };
    // Persist to DB
    try { await db.upsert("tenant_settings", "solarwinds_config", JSON.stringify({ id: "solarwinds_config", apiKey: ctx.SOLARWINDS_API_KEY, apiHost: ctx.SOLARWINDS_API_HOST, updatedAt: new Date().toISOString() })); } catch {}
    console.log(`[SOLARWINDS] API settings updated & persisted. Host=${ctx.SOLARWINDS_API_HOST}`);
    return json(res, 200, { ok: true, message: "SolarWinds RMM settings updated and persisted to database." });
  }

  // ─── SolarWinds RMM / N-able API Proxy ──────────────────────────────
  if (pathname.startsWith("/api/solarwinds") && req.method === "GET") {
    if (!ctx.SOLARWINDS_API_KEY) return json(res, 503, { error: "SolarWinds RMM API not configured" });
    const CACHE_TTL = 5 * 60 * 1000;
    if (!global._solarwindsCache) global._solarwindsCache = { data: null, ts: 0 };
    const swc = global._solarwindsCache;
    const forceRefresh = urlObj.searchParams.get("refresh") === "true";
    if (swc.data && (Date.now() - swc.ts < CACHE_TTL) && !forceRefresh) {
      return json(res, 200, { ...swc.data, cached: true, lastSync: new Date(swc.ts).toISOString() });
    }
    const swFetch = (service) => new Promise((resolve, reject) => {
      const host = ctx.SOLARWINDS_API_HOST.replace(/\/+$/, "");
      const u = `https://${host}/api/?apikey=${encodeURIComponent(ctx.SOLARWINDS_API_KEY)}&service=${service}`;
      const doGet = (url) => {
        https.get(url, { headers: { "User-Agent": "VGC-ITSM/1.0" } }, resp => {
          if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
            return doGet(resp.headers.location);
          }
          let d = ""; resp.on("data", c => d += c); resp.on("end", () => resolve(d));
        }).on("error", reject).setTimeout(15000, function() { this.destroy(); reject(new Error("Timeout")); });
      };
      doGet(u);
    });
    try {
      // N-able RMM XML API — parse clients and devices
      const [clientsXml, serversXml, workstationsXml] = await Promise.allSettled([
        swFetch("list_clients"), swFetch("list_servers"), swFetch("list_workstations"),
      ]);
      const parseXmlItems = (xml, tagName) => {
        if (!xml) return [];
        const items = []; const re = new RegExp(`<${tagName}[\\s>]([\\s\\S]*?)<\\/${tagName}>`, "gi"); let m;
        while ((m = re.exec(xml))) {
          const block = m[1]; const item = {};
          block.replace(/<(\w+)>([\s\S]*?)<\/\1>/g, (_, k, v) => { item[k] = v.replace(/<!\[CDATA\[|\]\]>/g, "").trim(); });
          if (Object.keys(item).length > 0) items.push(item);
        }
        return items;
      };
      const clients = clientsXml.status === "fulfilled" ? parseXmlItems(clientsXml.value, "client") : [];
      const servers = serversXml.status === "fulfilled" ? parseXmlItems(serversXml.value, "server") : [];
      const workstations = workstationsXml.status === "fulfilled" ? parseXmlItems(workstationsXml.value, "workstation") : [];
      // Check if auth failed
      const authFailed = [clientsXml, serversXml, workstationsXml].every(r => r.status === "fulfilled" && r.value.includes("Login failed"));
      const result = {
        configured: true,
        authenticated: !authFailed,
        clients, servers, workstations,
        summary: {
          totalClients: clients.length,
          totalServers: servers.length,
          totalWorkstations: workstations.length,
          onlineServers: servers.filter(s => s.status === "1" || s.online === "true").length,
          onlineWorkstations: workstations.filter(w => w.status === "1" || w.online === "true").length,
        },
      };
      swc.data = result; swc.ts = Date.now();
      console.log(`[SOLARWINDS] Auth=${!authFailed}, Clients=${clients.length}, Servers=${servers.length}, Workstations=${workstations.length}`);
      return json(res, 200, { ...result, cached: false, lastSync: new Date(swc.ts).toISOString() });
    } catch (err) {
      console.error("[SOLARWINDS] Error:", err.message);
      return json(res, 502, { error: "Failed to fetch SolarWinds data", detail: err.message });
    }
  }

  // ─── Sophos Central Firewall API Proxy ──────────────────────────────
  if (pathname.startsWith("/api/sophos") && req.method === "GET") {
    if (!SOPHOS_CLIENT_ID || !SOPHOS_CLIENT_SECRET) return json(res, 503, { error: "Sophos Central API not configured" });
    const CACHE_TTL = 5 * 60 * 1000;
    if (!global._sophosCache) global._sophosCache = { data: null, ts: 0, token: null, tokenExp: 0, tenantId: null, dataRegion: null };
    const sc = global._sophosCache;
    const forceRefresh = urlObj.searchParams.get("refresh") === "true";
    if (sc.data && (Date.now() - sc.ts < CACHE_TTL) && !forceRefresh) {
      return json(res, 200, { ...sc.data, cached: true, lastSync: new Date(sc.ts).toISOString() });
    }
    const httpsPost = (hostname, path, body, headers) => new Promise((resolve, reject) => {
      const opts = { hostname, path, method: "POST", headers: { ...headers, "Content-Length": Buffer.byteLength(body) } };
      const r = https.request(opts, resp => { let d = ""; resp.on("data", c => d += c); resp.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } }); });
      r.on("error", reject); r.setTimeout(15000, () => { r.destroy(); reject(new Error("Timeout")); });
      r.write(body); r.end();
    });
    const httpsGet = (fullUrl, headers) => new Promise((resolve, reject) => {
      const u = new URL(fullUrl);
      const opts = { hostname: u.hostname, path: u.pathname + u.search, headers };
      const r = https.get(opts, resp => { let d = ""; resp.on("data", c => d += c); resp.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } }); });
      r.on("error", reject); r.setTimeout(15000, () => { r.destroy(); reject(new Error("Timeout")); });
    });
    try {
      // Get/refresh OAuth2 token
      if (!sc.token || Date.now() >= sc.tokenExp) {
        const tokenBody = `grant_type=client_credentials&client_id=${encodeURIComponent(SOPHOS_CLIENT_ID)}&client_secret=${encodeURIComponent(SOPHOS_CLIENT_SECRET)}&scope=token`;
        const tokenResp = await httpsPost("id.sophos.com", "/api/v2/oauth2/token", tokenBody, { "Content-Type": "application/x-www-form-urlencoded" });
        if (!tokenResp?.access_token) throw new Error("Sophos OAuth2 token exchange failed");
        sc.token = tokenResp.access_token;
        sc.tokenExp = Date.now() + ((tokenResp.expires_in || 3600) - 120) * 1000;
      }
      // Get tenant info if not cached
      if (!sc.tenantId || !sc.dataRegion) {
        const whoami = await httpsGet("https://api.central.sophos.com/whoami/v1", { Authorization: `Bearer ${sc.token}` });
        if (!whoami?.id) throw new Error("Sophos whoami failed");
        sc.tenantId = whoami.id;
        sc.dataRegion = whoami.apiHosts?.dataRegion || "https://api.central.sophos.com";
      }
      const sophosHeaders = { Authorization: `Bearer ${sc.token}`, "X-Tenant-ID": sc.tenantId };
      // Fetch firewalls
      const firewalls = await httpsGet(`${sc.dataRegion}/firewall/v1/firewalls?pageSize=100`, sophosHeaders);
      const fwItems = (firewalls?.items || []).map(fw => ({
        id: fw.id, name: fw.name || fw.hostname, hostname: fw.hostname,
        serialNumber: fw.serialNumber, model: fw.model,
        firmware: fw.firmwareVersion,
        connected: fw.status?.connected || false,
        suspended: fw.status?.suspended || false,
        managingStatus: fw.status?.managingStatus,
        externalIps: fw.externalIpv4Addresses || [],
        capabilities: fw.capabilities || [],
        createdAt: fw.createdAt, updatedAt: fw.updatedAt,
        stateChangedAt: fw.stateChangedAt,
      }));
      // Try to fetch firewall groups (may fail with permissions)
      let fwGroups = [];
      try { const g = await httpsGet(`${sc.dataRegion}/firewall/v1/firewall-groups?pageSize=50`, sophosHeaders); fwGroups = g?.items || []; } catch {}
      // Try alerts (may need different permissions)
      let alerts = [];
      try { const a = await httpsGet(`${sc.dataRegion}/common/v1/alerts?pageSize=20`, sophosHeaders); alerts = (a?.items || []).map(al => ({ id: al.id, severity: al.severity, category: al.category, description: al.description, raisedAt: al.raisedAt, managedAgent: al.managedAgent })); } catch {}
      const result = {
        configured: true,
        tenantId: sc.tenantId,
        firewalls: fwItems,
        groups: fwGroups,
        alerts,
        summary: {
          totalFirewalls: fwItems.length,
          connectedFirewalls: fwItems.filter(f => f.connected).length,
          disconnectedFirewalls: fwItems.filter(f => !f.connected).length,
          suspendedFirewalls: fwItems.filter(f => f.suspended).length,
          totalAlerts: alerts.length,
        },
      };
      sc.data = result; sc.ts = Date.now();
      console.log(`[SOPHOS] Fetched ${fwItems.length} firewalls (${fwItems.filter(f=>f.connected).length} connected), ${alerts.length} alerts`);
      return json(res, 200, { ...result, cached: false, lastSync: new Date(sc.ts).toISOString() });
    } catch (err) {
      console.error("[SOPHOS] Error:", err.message);
      return json(res, 502, { error: "Failed to fetch Sophos data", detail: err.message });
    }
  }

  // ─── Cyber News: Live RSS Feeds ─────────────────────────────────────
  if (pathname === "/api/cybernews" && req.method === "GET") {
    // Cache for 10 minutes to avoid hammering feeds
    const CACHE_TTL = 10 * 60 * 1000;
    if (!global._cyberNewsCache) global._cyberNewsCache = { data: null, ts: 0 };
    const cache = global._cyberNewsCache;
    const forceRefresh = urlObj.searchParams.get("refresh") === "true";

    if (cache.data && (Date.now() - cache.ts < CACHE_TTL) && !forceRefresh) {
      return json(res, 200, { threats: cache.data, cached: true, lastSync: new Date(cache.ts).toISOString() });
    }

    const fetchUrl = (feedUrl, timeoutMs = 12000) => new Promise((resolve, reject) => {
      const proto = feedUrl.startsWith("https") ? https : http;
      const feedReq = proto.get(feedUrl, { headers: { "User-Agent": "VGC-ITSM-CyberNews/1.0" } }, resp => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          return fetchUrl(resp.headers.location, timeoutMs).then(resolve, reject);
        }
        let d = ""; resp.on("data", c => d += c); resp.on("end", () => resolve(d));
      });
      feedReq.on("error", reject);
      feedReq.setTimeout(timeoutMs, () => { feedReq.destroy(); reject(new Error("Timeout")); });
    });

    const parseRssItems = (xml, source, sourceUrl, maxItems = 8) => {
      const items = [];
      const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
      let match;
      while ((match = itemRegex.exec(xml)) && items.length < maxItems) {
        const block = match[1];
        const tag = (name) => { const m = block.match(new RegExp(`<${name}[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${name}>`, "i")); return m ? m[1].trim() : ""; };
        const title = tag("title").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        const link = tag("link") || tag("guid");
        const pubDate = tag("pubDate");
        const desc = tag("description").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").substring(0, 300);
        if (!title) continue;
        const published = pubDate ? new Date(pubDate) : new Date();
        const ageMs = Date.now() - published.getTime();
        const ageStr = ageMs < 3600000 ? `${Math.round(ageMs/60000)} min ago` : ageMs < 86400000 ? `${Math.round(ageMs/3600000)} hr ago` : `${Math.round(ageMs/86400000)} day ago`;
        const cveMatch = title.match(/CVE-\d{4}-\d+/i) || desc.match(/CVE-\d{4}-\d+/i);
        const sevGuess = /critical|emergency|urgent|zero.?day|actively.exploit/i.test(title + desc) ? "Critical"
          : /high|severe|important|rce|remote.code/i.test(title + desc) ? "High"
          : /medium|moderate/i.test(title + desc) ? "Medium" : "Low";
        const catGuess = /ransomware|lockbit|blackcat|alphv/i.test(title + desc) ? "Ransomware"
          : /phish/i.test(title + desc) ? "Phishing"
          : /apt|nation.state|espionage/i.test(title + desc) ? "APT"
          : /ddos|amplification|flood/i.test(title + desc) ? "DDoS"
          : /cve|vulnerabilit|patch|exploit|rce|xss|sqli/i.test(title + desc) ? "Vulnerability"
          : /malware|trojan|botnet|stealer/i.test(title + desc) ? "Malware"
          : "Advisory";
        items.push({
          id: `LIVE-${source.replace(/[^A-Z0-9]/gi,"").substring(0,4).toUpperCase()}-${items.length+1}`,
          severity: sevGuess,
          title,
          source,
          sourceUrl: link || sourceUrl,
          region: "Global",
          time: ageStr,
          timestamp: published.getTime(),
          isNew: ageMs < 6 * 3600000,
          aiSummary: desc || "No description available. Click the source link for full details.",
          affectsUs: false,
          category: catGuess,
          cve: cveMatch ? cveMatch[0].toUpperCase() : null,
          cvss: null, cvssVector: null,
          affectedSystems: [],
          mitreTactics: [],
          iocs: [],
          nextSteps: ["Review the advisory details via the source link", "Assess applicability to your environment", "Update security monitoring rules if relevant"],
          references: [{ title: `${source} — Full Article`, url: link || sourceUrl }],
          status: "open",
        });
      }
      return items;
    };

    try {
      const feeds = [
        { url: "https://feeds.feedburner.com/TheHackersNews", source: "The Hacker News", home: "https://thehackernews.com/" },
        { url: "https://www.bleepingcomputer.com/feed/", source: "BleepingComputer", home: "https://www.bleepingcomputer.com/" },
        { url: "https://www.cisa.gov/cybersecurity-advisories/all.xml", source: "CISA", home: "https://www.cisa.gov/cybersecurity-advisories" },
        { url: "https://cvefeed.io/rssfeed/latest.xml", source: "CVE Feed", home: "https://cvefeed.io/" },
      ];
      const results = await Promise.allSettled(feeds.map(f => fetchUrl(f.url).then(xml => parseRssItems(xml, f.source, f.home))));
      let allItems = [];
      results.forEach(r => { if (r.status === "fulfilled") allItems = allItems.concat(r.value); });
      // Sort by timestamp descending (newest first), then renumber IDs
      allItems.sort((a, b) => b.timestamp - a.timestamp);
      allItems = allItems.slice(0, 30);
      allItems.forEach((item, i) => { item.id = `LIVE-${String(i+1).padStart(3,"0")}`; });

      cache.data = allItems;
      cache.ts = Date.now();
      console.log(`[CYBER NEWS] Fetched ${allItems.length} items from ${results.filter(r=>r.status==="fulfilled").length}/${feeds.length} feeds`);
      return json(res, 200, { threats: allItems, cached: false, lastSync: new Date(cache.ts).toISOString(), feedsOk: results.filter(r=>r.status==="fulfilled").length, feedsTotal: feeds.length });
    } catch (err) {
      console.error("[CYBER NEWS] Fetch error:", err.message);
      return json(res, 502, { error: "Failed to fetch cyber news feeds", detail: err.message });
    }
  }

  // ─── AI Auto-Triage + Auto-Assignment Engine (Phase 1) ────────────────
  // POST /api/ai/auto-triage-assign — AI categorizes, prioritizes, and assigns a ticket
  if (pathname === "/api/ai/auto-triage-assign" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 50000);
      const { ticket, requestedBy } = body;
      if (!ticket || !requestedBy) return json(res, 400, { error: "ticket and requestedBy required" });

      // v3.13 Layer 2: ensure Zendesk ticket is fresh before AI triage (best-effort, ≤2s)
      if (ticket.zdTicketId && ctx.ZENDESK_SUBDOMAIN) {
        try {
          await new Promise((resolve) => {
            const http = require("http");
            const r = http.request({
              hostname: "127.0.0.1", port: ctx.PORT || process.env.PORT || 8080,
              path: `/api/zendesk/sync-ticket/${ticket.zdTicketId}`,
              method: "POST",
              headers: { "Content-Type": "application/json", "Content-Length": 0, "x-internal-sync": "1" },
            }, (rr) => { rr.on("data", () => {}); rr.on("end", resolve); });
            r.on("error", () => resolve());
            r.setTimeout(2000, () => { try { r.destroy(); } catch {} resolve(); });
            r.end();
          });
          // Re-read incident from DB in case timestamps were updated
          const fresh = await db.getOne("incidents", ticket.id);
          if (fresh) { try { Object.assign(ticket, JSON.parse(fresh.data)); } catch {} }
        } catch {}
      }

      // Gather context for AI
      const allUsersRaw = await db.getAll("users");
      const teamMembers = allUsersRaw.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

      const allIncRaw = await db.getAll("incidents");
      const allIncidents = allIncRaw.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

      // Calculate workload per assignee
      const openStatuses = new Set(["New", "Open", "In Progress", "Pending"]);
      const workload = {};
      for (const inc of allIncidents) {
        if (openStatuses.has(inc.status) && inc.assignee && inc.assignee !== "Unassigned") {
          workload[inc.assignee] = (workload[inc.assignee] || 0) + 1;
        }
      }

      // Get KB articles for category matching
      const kbRaw = await db.getAll("kb");
      const kbArticles = kbRaw.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      const kbCategories = [...new Set(kbArticles.map(a => a.category).filter(Boolean))];

      // Historical resolution stats (category → avg resolve time, best assignee)
      const resolvedInc = allIncidents.filter(i => i.status === "Resolved" || i.status === "Closed");
      const categoryStats = {};
      for (const inc of resolvedInc) {
        const cat = inc.category || "General";
        if (!categoryStats[cat]) categoryStats[cat] = { count: 0, totalHours: 0, assignees: {} };
        categoryStats[cat].count++;
        // Compute actual resolution hours from timestamps
        const created = inc.createdAt || inc.created;
        const resolved = inc.resolvedAt || inc.closedAt;
        if (created && resolved) {
          const hours = (new Date(resolved) - new Date(created)) / 3600000;
          if (!isNaN(hours) && hours > 0 && hours < 8760) categoryStats[cat].totalHours += hours;
        }
        if (inc.assignee) categoryStats[cat].assignees[inc.assignee] = (categoryStats[cat].assignees[inc.assignee] || 0) + 1;
      }

      const teamSummary = teamMembers.slice(0, 20).map(u => `${u.displayName || u.name || u.id} (${u.jobTitle || u.role || "Agent"}) workload:${workload[u.displayName || u.name] || 0}`).join("\n");
      const catStatsSummary = Object.entries(categoryStats).slice(0, 15).map(([cat, s]) => {
        const avgHrs = s.count > 0 ? (s.totalHours / s.count).toFixed(1) : "N/A";
        const bestAssignee = Object.entries(s.assignees).sort((a, b) => b[1] - a[1])[0];
        return `${cat}: ${s.count} resolved, avg ${avgHrs}h, top resolver: ${bestAssignee ? bestAssignee[0] : "N/A"}`;
      }).join("\n");

      // Gather open incident titles for AI duplicate detection context
      const openIncidents = allIncidents.filter(i => openStatuses.has(i.status));
      const openTicketsSummary = openIncidents.slice(0, 50).map(i => `${i.id}: ${(i.title || "").substring(0, 120)}`).join("\n");

      // Gather KB article titles for coverage gap analysis
      const kbTitlesSummary = kbArticles.slice(0, 60).map(a => `[${a.category || "General"}] ${(a.title || "").substring(0, 100)}`).join("\n");

      const systemPrompt = `You are the VGC-ITSM AI Auto-Triage Engine for VGC Technology Pte Ltd.
Analyze the incoming ticket and determine the best category, priority, assignee, and assignment group.

AVAILABLE CATEGORIES: ${kbCategories.join(", ")}, Network, Hardware, Software, Security, Email, Access Management, General, VPN, Printing, Telephony, Cloud Services, Database, Backup, Monitoring

PRIORITY LEVELS (VGC SLA Policy):
- Sev-A (CRITICAL): Complete service outage, business-critical systems unavailable. SLA: ${(slaEngine?.currentPolicy?.severities?.['Sev-A']?.firstResponse || 0.5)}h first response, ${(slaEngine?.currentPolicy?.severities?.['Sev-A']?.worstResponse || 4)}h resolution.
- Sev-B (HIGH): Major impact, VIP issues, >50% users affected. SLA: ${(slaEngine?.currentPolicy?.severities?.['Sev-B']?.firstResponse || 1)}h first response, ${(slaEngine?.currentPolicy?.severities?.['Sev-B']?.worstResponse || 4)}h resolution.
- Sev-C (MEDIUM/DEFAULT): Standard IT issues. SLA: ${(slaEngine?.currentPolicy?.severities?.['Sev-C']?.firstResponse || 4)}h first response, ${(slaEngine?.currentPolicy?.severities?.['Sev-C']?.worstResponse || 9)}h resolution.
- Sev-D (LOW): Non-actionable questions, informational. SLA: ${(slaEngine?.currentPolicy?.severities?.['Sev-D']?.firstResponse || 9)}h first response, ${(slaEngine?.currentPolicy?.severities?.['Sev-D']?.worstResponse || 27)}h resolution.

ASSIGNMENT GROUPS: Service Desk, Network Team, Security Team, Cloud Team, Desktop Support, Application Support, Infrastructure

TEAM MEMBERS & WORKLOAD:
${teamSummary || "No team members data available — assign to Service Desk"}

HISTORICAL RESOLUTION STATS:
${catStatsSummary || "No historical data yet"}

CURRENTLY OPEN TICKETS (check for duplicates):
${openTicketsSummary || "No open tickets"}

EXISTING KB ARTICLES (check for coverage gaps):
${kbTitlesSummary || "No KB articles"}

RULES:
1. Default priority is Sev-C unless clear evidence of higher severity.
2. Assign to the team member with lowest workload in the matching skill area.
3. If unsure about category, use the closest match from KB categories.
4. Never assign Sev-A or Sev-B unless the ticket clearly describes a major outage or VIP impact.
5. Consider historical resolution data to pick the best assignee for the category.
6. SENTIMENT: Analyze the reporter's tone — frustrated, neutral, or satisfied. Score 1-10 (1=very negative, 5=neutral, 10=very positive).
7. DUPLICATE CHECK: Compare the new ticket title+description against CURRENTLY OPEN TICKETS. If >70% semantically similar, flag it.
8. KB COVERAGE: Check if EXISTING KB ARTICLES already cover this issue topic. If not, flag the gap.

EXAMPLES:
Example 1 — Network outage affecting entire floor:
  Input: "Internet down on 3rd floor, 40+ users affected, no connectivity since 8am"
  Output: { "category": "Network", "priority": "Sev-A", "assignmentGroup": "Network Team", "confidence": 95 }

Example 2 — Password reset request:
  Input: "I forgot my password and need it reset for my laptop login"
  Output: { "category": "Access Management", "priority": "Sev-D", "assignmentGroup": "Service Desk", "confidence": 92 }

Example 3 — Application crash:
  Input: "SAP keeps crashing when I try to generate monthly report, error code 0x80041003"
  Output: { "category": "Software", "subcategory": "Application Error", "priority": "Sev-C", "assignmentGroup": "Application Support", "confidence": 88 }

Respond with ONLY valid JSON (no markdown):
{
  "category": "string",
  "subcategory": "string",
  "priority": "Sev-A|Sev-B|Sev-C|Sev-D",
  "assignee": "person name or Unassigned",
  "assignmentGroup": "group name",
  "confidence": 0-100,
  "reasoning": "brief explanation",
  "suggestedSlaTarget": number_in_hours,
  "tags": ["tag1","tag2"],
  "sentiment": "frustrated|neutral|satisfied",
  "sentimentScore": 1-10,
  "possibleDuplicateOf": "INC-xxx or null if no duplicate found",
  "duplicateSimilarity": 0-100,
  "kbCoverage": "covered|partial|gap",
  "suggestedKbTopic": "topic title if kbCoverage is gap or partial, else null"
}`;

      const userPrompt = `TICKET TO TRIAGE:
ID: ${ticket.id || "NEW"}
Title: ${ticket.title || "Untitled"}
Description: ${(ticket.description || "No description").substring(0, 3000)}
Reporter: ${ticket.reporter || ticket.reporterEmail || "Unknown"}
Customer: ${ticket.customer || "Unknown"}
Contact Method: ${ticket.contactMethod || "Portal"}
Current Priority: ${ticket.priority || "Not set"}
Current Category: ${ticket.category || "Not set"}
Current Assignee: ${ticket.assignee || "Unassigned"}
Zendesk Ticket: ${ticket.zdTicketId ? "#" + ticket.zdTicketId : "N/A"}
Created: ${ticket.createdAt || new Date().toISOString()}`;

      const payload = {
        model: getAIModel("primary"),
        input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        max_output_tokens: 1000,
        temperature: 0.1
      };

      const aiUrl = new URL(ctx.AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({
          hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
          method: "POST", headers: { "Content-Type": "application/json", "api-key": ctx.AZURE_OPENAI_KEY },
        }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => {
            if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
            else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
          });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let triage;
      try {
        triage = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch {
        return json(res, 502, { error: "AI returned invalid triage JSON", raw: text.substring(0, 500) });
      }

      const now = new Date().toISOString();
      const confidence = triage.confidence || 50;
      const slaMap = getSlaMap();

      // High confidence: auto-apply triage directly (configurable threshold)
      const autoApply = confidence >= AI_THRESHOLDS.autoApply;

      // Dedup: skip if pending auto_triage already exists for same incident, or total cap exceeded
      const dedupState = await getAiActionsDedupState();
      const skipReason = !autoApply ? shouldSkipAction(dedupState, { incidentId: ticket.id, type: "auto_triage" }) : null;
      if (skipReason) {
        console.log(`[AI Triage] Skipped pending_approval for ${ticket.id}: ${skipReason}`);
        // Still return the triage result so caller knows what AI recommended
        return json(res, 200, { action: { ...triage, skipped: true, skipReason }, triage, confidence, autoApplied: false, skipped: true });
      }

      const triageRecord = {
        id: `AIT-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        type: "auto_triage",
        severity: triage.priority === "Sev-A" ? "critical" : triage.priority === "Sev-B" ? "high" : triage.priority === "Sev-D" ? "low" : "medium",
        title: `Auto-Triage: ${ticket.id || "New Ticket"} → ${triage.category} [${triage.priority}] → ${triage.assignee}`,
        description: triage.reasoning || "AI auto-triage recommendation",
        incidentId: ticket.id || null,
        suggestedAction: `Set category=${triage.category}, priority=${triage.priority}, assignee=${triage.assignee}, group=${triage.assignmentGroup}`,
        triage: {
          category: triage.category,
          subcategory: triage.subcategory || "",
          priority: triage.priority,
          assignee: triage.assignee || "Unassigned",
          assignmentGroup: triage.assignmentGroup || "Service Desk",
          suggestedSlaTarget: triage.suggestedSlaTarget || slaMap[triage.priority] || 9,
          tags: triage.tags || [],
          sentiment: triage.sentiment || "neutral",
          sentimentScore: triage.sentimentScore || 5,
          possibleDuplicateOf: triage.possibleDuplicateOf || null,
          duplicateSimilarity: triage.duplicateSimilarity || 0,
          kbCoverage: triage.kbCoverage || "unknown",
          suggestedKbTopic: triage.suggestedKbTopic || null,
        },
        confidence,
        autoExecutable: autoApply,
        reasoning: triage.reasoning || "",
        status: autoApply ? "auto_applied" : "pending_approval",
        createdAt: now,
        createdBy: "AI Auto-Triage Engine",
        requestedBy,
        approvedBy: autoApply ? "AI Auto-Triage (high confidence)" : null,
        approvedAt: autoApply ? now : null,
        executedAt: null,
        executionResult: null,
      };

      // Save triage action
      await db.upsert("ai_actions", triageRecord.id, JSON.stringify(triageRecord));

      // AI Governance: audit log entry
      try {
        const auditId = `AUDIT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,5)}`;
        await db.upsert("ai_audit_log", auditId, JSON.stringify({
          id: auditId, type: "auto_triage", incidentId: ticket.id,
          input: { title: ticket.title, description: (ticket.description || "").slice(0, 200) },
          output: { category: triage.category, priority: triage.priority, assignee: triage.assignee, confidence },
          model: aiResult.model, autoApplied: autoApply, autonomyLevel: AI_AUTONOMY_LEVEL,
          timestamp: now
        }));
      } catch (e) { console.warn("[AI Audit] triage log failed:", e.message); }

      // Save triage history
      await db.upsert("ai_triage_history", triageRecord.id, JSON.stringify({
        id: triageRecord.id, ticketId: ticket.id, triage: triageRecord.triage,
        confidence, autoApplied: autoApply, timestamp: now, requestedBy,
        sentiment: triage.sentiment || "neutral",
        sentimentScore: triage.sentimentScore || 5,
        kbCoverage: triage.kbCoverage || "unknown",
        possibleDuplicateOf: triage.possibleDuplicateOf || null,
      }));

      // If auto-apply, update the actual incident
      if (autoApply && ticket.id) {
        const incRow = await db.getOne("incidents", ticket.id);
        if (incRow) {
          const inc = JSON.parse(incRow.data);
          inc.category = normalizeCategory(triage.category);
          inc.subcategory = triage.subcategory || inc.subcategory;
          inc.priority = triage.priority;
          inc.assignee = triage.assignee || inc.assignee;
          inc.assignmentGroup = triage.assignmentGroup || inc.assignmentGroup;
          inc.slaTarget = triage.suggestedSlaTarget || slaMap[triage.priority] || inc.slaTarget;
          inc.aiTriaged = true;
          inc.aiConfidence = confidence;
          inc.sentiment = triage.sentiment || "neutral";
          inc.sentimentScore = triage.sentimentScore || 5;
          if (triage.possibleDuplicateOf) inc.possibleDuplicateOf = triage.possibleDuplicateOf;
          if (triage.duplicateSimilarity) inc.duplicateSimilarity = triage.duplicateSimilarity;
          inc.kbCoverage = triage.kbCoverage || "unknown";
          if (triage.suggestedKbTopic) inc.suggestedKbTopic = triage.suggestedKbTopic;
          inc.activityLog = inc.activityLog || [];
          inc.activityLog.push({
            id: `AL-AIT-${Date.now().toString(36)}`, type: "ai_triage", user: "AI Auto-Triage",
            time: now, detail: `AI auto-triaged (${confidence}% confidence): ${triage.category} [${triage.priority}] → ${triage.assignee}. ${triage.reasoning}`,
          });
          await db.upsert("incidents", inc.id, JSON.stringify(inc));

          // ─── Auto-trigger AI Workflow Assist after triage (Production Pipeline) ───
          if (PROD_TEST_MODE || confidence >= 85) {
            try {
              const wfPayload = JSON.stringify({ requestedBy: "AI Post-Triage Pipeline", maxItems: 1, incidentId: inc.id });
              const wfReq = http.request({ hostname: "127.0.0.1", port: PORT, path: "/api/ai/workflow-assist", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(wfPayload) } }, (wfRes) => {
                let d = ""; wfRes.on("data", c => d += c);
                wfRes.on("end", () => { console.log(`[AI Pipeline] Workflow assist for ${inc.id}: ${d.substring(0, 200)}`); });
              });
              wfReq.on("error", e => console.warn(`[AI Pipeline] Workflow assist failed for ${inc.id}:`, e.message));
              wfReq.setTimeout(35000, () => { wfReq.destroy(); });
              wfReq.write(wfPayload);
              wfReq.end();
            } catch (wfErr) { console.warn("[AI Pipeline] Workflow assist trigger error:", wfErr.message); }
          }

          // ─── SLA Guardian: auto-trigger SLA prediction after triage ───
          try {
            const slaPredPayload = JSON.stringify({ incidents: [inc], requestedBy: "AI SLA Guardian (post-triage)" });
            const slaPredReq = http.request({ hostname: "127.0.0.1", port: PORT, path: "/api/ai/sla-predict", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(slaPredPayload) } }, (slaPredRes) => {
              let d = ""; slaPredRes.on("data", c => d += c);
              slaPredRes.on("end", () => {
                try {
                  const result = JSON.parse(d);
                  if (result.actions && result.actions.length > 0 && wsServer) {
                    wsServer.broadcast("sla_guardian", { action: "sla_risk_detected", atRiskCount: result.actions.length, predictions: result.predictions });
                  }
                } catch {}
                console.log(`[SLA Guardian] Post-triage prediction for ${inc.id}: ${d.substring(0, 200)}`);
              });
            });
            slaPredReq.on("error", e => console.warn(`[SLA Guardian] Post-triage prediction failed:`, e.message));
            slaPredReq.setTimeout(35000, () => { slaPredReq.destroy(); });
            slaPredReq.write(slaPredPayload);
            slaPredReq.end();
          } catch (slaErr) { console.warn("[SLA Guardian] Post-triage trigger error:", slaErr.message); }
        }
      }

      console.log(`[AI Triage] ${ticket.id || "NEW"} → ${triage.category} [${triage.priority}] → ${triage.assignee} (${confidence}% confidence, ${autoApply ? "auto-applied" : "pending approval"})`);
      return json(res, 200, {
        triage: triageRecord.triage, confidence, autoApplied: autoApply,
        actionId: triageRecord.id, status: triageRecord.status,
        reasoning: triage.reasoning,
      });
    } catch (err) {
      console.error("[AI Triage]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // POST /api/ai/auto-triage-assign/apply — apply a pending triage to the actual ticket
  if (pathname === "/api/ai/auto-triage-assign/apply" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const { actionId, appliedBy } = body;
      if (!actionId || !appliedBy) return json(res, 400, { error: "actionId and appliedBy required" });

      const existing = await db.getOne("ai_actions", actionId);
      if (!existing) return json(res, 404, { error: "Triage action not found" });
      const action = JSON.parse(existing.data);
      if (action.type !== "auto_triage") return json(res, 400, { error: "Action is not an auto-triage" });
      if (action.status !== "pending_approval") return json(res, 409, { error: `Action already ${action.status}` });

      const now = new Date().toISOString();
      const triage = action.triage;
      const slaMap = getSlaMap();

      // Update the incident
      if (action.incidentId) {
        const incRow = await db.getOne("incidents", action.incidentId);
        if (incRow) {
          const inc = JSON.parse(incRow.data);
          inc.category = normalizeCategory(triage.category);
          inc.subcategory = triage.subcategory || inc.subcategory;
          inc.priority = triage.priority;
          inc.assignee = triage.assignee || inc.assignee;
          inc.assignmentGroup = triage.assignmentGroup || inc.assignmentGroup;
          inc.slaTarget = triage.suggestedSlaTarget || slaMap[triage.priority] || inc.slaTarget;
          inc.aiTriaged = true;
          inc.aiConfidence = action.confidence;
          inc.activityLog = inc.activityLog || [];
          inc.activityLog.push({
            id: `AL-AIT-${Date.now().toString(36)}`, type: "ai_triage", user: appliedBy,
            time: now, detail: `AI triage approved by ${appliedBy}: ${triage.category} [${triage.priority}] → ${triage.assignee}`,
          });
          await db.upsert("incidents", inc.id, JSON.stringify(inc));
        }
      }

      // Update action status
      action.status = "applied";
      action.approvedBy = appliedBy;
      action.approvedAt = now;
      action.executedAt = now;
      action.executionResult = "Triage applied to ticket";
      await db.upsert("ai_actions", actionId, JSON.stringify(action));
      await db.audit("ai_actions", actionId, "triage_applied", JSON.stringify({ appliedBy, triage }), appliedBy);

      console.log(`[AI Triage] Applied ${actionId} to ${action.incidentId} by ${appliedBy}`);
      return json(res, 200, { success: true, actionId, ticketId: action.incidentId, triage });
    } catch (err) {
      console.error("[AI Triage Apply]", err.message);
      return json(res, 500, { error: err.message });
    }
  }


  // ─── Bulk AI Triage — batch-process multiple tickets ────────────────
  // POST /api/ai/batch-triage — triage up to 20 tickets in one call
  if (pathname === "/api/ai/batch-triage" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 200000);
      const { ticketIds, requestedBy } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });
      if (!Array.isArray(ticketIds) || ticketIds.length === 0) return json(res, 400, { error: "ticketIds array required" });
      if (ticketIds.length > 20) return json(res, 400, { error: "Maximum 20 tickets per batch" });

      const results = [];
      const CONCURRENCY = 3;

      // Process tickets in batches of CONCURRENCY
      for (let i = 0; i < ticketIds.length; i += CONCURRENCY) {
        const batch = ticketIds.slice(i, i + CONCURRENCY);
        const batchPromises = batch.map(async (ticketId) => {
          try {
            const incRow = await db.getOne("incidents", ticketId);
            if (!incRow) return { ticketId, status: "not_found", error: "Ticket not found" };
            const ticket = JSON.parse(incRow.data);
            if (ticket.status === "Resolved" || ticket.status === "Closed") {
              return { ticketId, status: "skipped", reason: "Already resolved/closed" };
            }
            if (ticket.aiTriaged) {
              return { ticketId, status: "skipped", reason: "Already triaged by AI" };
            }

            // Call the single-triage endpoint internally via HTTP
            const http = require("http");
            const triageResult = await new Promise((resolve, reject) => {
              const triagePayload = JSON.stringify({ ticket, requestedBy });
              const triageReq = http.request({
                hostname: "localhost", port: PORT, path: "/api/ai/auto-triage-assign",
                method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(triagePayload) },
              }, (r) => {
                let data = ""; r.on("data", c => data += c);
                r.on("end", () => {
                  try { resolve({ statusCode: r.statusCode, ...JSON.parse(data) }); }
                  catch { resolve({ statusCode: r.statusCode, raw: data.substring(0, 200) }); }
                });
              });
              triageReq.on("error", reject);
              triageReq.setTimeout(45000, () => { triageReq.destroy(); reject(new Error("Triage timeout")); });
              triageReq.write(triagePayload);
              triageReq.end();
            });

            return {
              ticketId,
              status: triageResult.statusCode === 200 ? "triaged" : "error",
              triage: triageResult.triage || null,
              confidence: triageResult.confidence || null,
              autoApplied: triageResult.autoApplied || false,
              actionId: triageResult.actionId || null,
            };
          } catch (err) {
            return { ticketId, status: "error", error: err.message };
          }
        });
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      }

      const summary = {
        total: results.length,
        triaged: results.filter(r => r.status === "triaged").length,
        skipped: results.filter(r => r.status === "skipped").length,
        errors: results.filter(r => r.status === "error").length,
        notFound: results.filter(r => r.status === "not_found").length,
      };
      console.log(`[AI Batch Triage] ${summary.triaged}/${summary.total} triaged, ${summary.skipped} skipped, ${summary.errors} errors`);
      return json(res, 200, { results, summary });
    } catch (err) {
      console.error("[AI Batch Triage]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI Semantic Duplicate Detection ──────────────────────────────────
  // POST /api/ai/detect-duplicates — AI-powered semantic duplicate detection
  if (pathname === "/api/ai/detect-duplicates" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 100000);
      const { ticketId, requestedBy } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });

      const allIncRaw = await db.getAll("incidents");
      const allIncidents = allIncRaw.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

      // Get the target ticket
      let targetTicket;
      if (ticketId) {
        targetTicket = allIncidents.find(i => i.id === ticketId);
        if (!targetTicket) return json(res, 404, { error: "Ticket not found" });
      }

      const openStatuses = new Set(["New", "Open", "In Progress", "Pending", "Reopened"]);
      const openIncidents = allIncidents.filter(i => openStatuses.has(i.status));
      if (openIncidents.length < 2) return json(res, 200, { groups: [], message: "Not enough open tickets for comparison" });

      // Build ticket summaries for AI
      const ticketSummaries = (targetTicket ? openIncidents.filter(i => i.id !== targetTicket.id) : openIncidents)
        .slice(0, 40).map(i => `${i.id}|${(i.title || "").substring(0, 100)}|${(i.description || "").substring(0, 200)}|${i.category || ""}|${i.reporter || ""}`).join("\n");

      const targetInfo = targetTicket
        ? `TARGET TICKET:\n${targetTicket.id}|${targetTicket.title}|${(targetTicket.description || "").substring(0, 300)}|${targetTicket.category || ""}|${targetTicket.reporter || ""}`
        : "Analyze ALL tickets below for duplicate groups.";

      const systemPrompt = `You are a duplicate ticket detection AI for VGC Technology ITSM.
${targetInfo}

OPEN TICKETS (ID|Title|Description|Category|Reporter):
${ticketSummaries}

${targetTicket ? `Find tickets that are semantically similar to the TARGET TICKET (same underlying issue, even if worded differently).` : `Group tickets that describe the same underlying issue. Not every ticket needs to be in a group.`}

Respond with ONLY valid JSON (no markdown):
{
  "groups": [
    {
      "primaryId": "INC-xxx",
      "duplicateIds": ["INC-yyy"],
      "similarity": 0-100,
      "reason": "brief explanation of why these are duplicates"
    }
  ]
}
If no duplicates found, return {"groups": []}.`;

      const payload = {
        model: getAIModel("secondary"),
        input: [{ role: "system", content: systemPrompt }],
        max_output_tokens: 800
      };

      const aiUrl = new URL(ctx.AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({
          hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
          method: "POST", headers: { "Content-Type": "application/json", "api-key": ctx.AZURE_OPENAI_KEY },
        }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => {
            if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
            else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
          });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let parsed;
      try {
        parsed = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch {
        parsed = { groups: [] };
      }

      // Enrich groups with ticket details
      const enrichedGroups = (parsed.groups || []).map(g => ({
        ...g,
        primaryTitle: allIncidents.find(i => i.id === g.primaryId)?.title || "",
        duplicates: (g.duplicateIds || []).map(id => {
          const inc = allIncidents.find(i => i.id === id);
          return inc ? { id: inc.id, title: inc.title, status: inc.status } : { id, title: "Unknown" };
        }),
      }));

      console.log(`[AI Dup Detect] Found ${enrichedGroups.length} duplicate group(s) for ${ticketId || "all tickets"}`);
      return json(res, 200, { groups: enrichedGroups, ticketId: ticketId || null });
    } catch (err) {
      console.error("[AI Dup Detect]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // ─── AI KB Gap Analysis Report ──────────────────────────────────────
  // POST /api/ai/kb-gaps — Analyze incidents vs KB articles to find coverage gaps
  if (pathname === "/api/ai/kb-gaps" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req);
      const { requestedBy } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });

      // Gather recent incidents (last 100)
      const allIncRaw = await db.getAll("incidents");
      const allIncidents = allIncRaw.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      const recentIncidents = allIncidents.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 100);

      // Gather KB articles
      const kbRaw = await db.getAll("kb");
      const kbArticles = kbRaw.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

      const incidentSummary = recentIncidents.map(i => `${i.category || "General"}|${(i.title || "").substring(0, 80)}|${i.status}`).join("\n");
      const kbSummary = kbArticles.map(a => `${a.category || "General"}|${(a.title || "").substring(0, 80)}`).join("\n");

      const systemPrompt = `You are a Knowledge Base coverage analyst for VGC Technology ITSM.

RECENT INCIDENTS (Category|Title|Status):
${incidentSummary || "No incidents"}

EXISTING KB ARTICLES (Category|Title):
${kbSummary || "No KB articles"}

Analyze the incidents and identify topics/issues that appear frequently but are NOT covered by existing KB articles.
For each gap, suggest an article title, category, and estimate how many incidents it would help.

Respond with ONLY valid JSON (no markdown):
{
  "gaps": [
    {
      "topic": "suggested article topic",
      "category": "category",
      "incidentCount": number_of_related_incidents,
      "severity": "high|medium|low",
      "suggestedTitle": "KB Article: ...",
      "reason": "brief explanation"
    }
  ],
  "coverageScore": 0-100,
  "summary": "brief overall assessment"
}`;

      const payload = {
        model: getAIModel("secondary"),
        input: [{ role: "system", content: systemPrompt }],
        max_output_tokens: 1000
      };

      const aiUrl = new URL(ctx.AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({
          hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
          method: "POST", headers: { "Content-Type": "application/json", "api-key": ctx.AZURE_OPENAI_KEY },
        }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => {
            if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
            else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
          });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let parsed;
      try {
        parsed = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch {
        parsed = { gaps: [], coverageScore: 0, summary: "Failed to parse AI response" };
      }

      console.log(`[KB Gaps] Found ${(parsed.gaps || []).length} gap(s), coverage: ${parsed.coverageScore}%`);
      return json(res, 200, { ...parsed, totalIncidents: recentIncidents.length, totalKbArticles: kbArticles.length });
    } catch (err) {
      console.error("[KB Gaps]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // ─── AI Resolution Summary Generator ────────────────────────────────
  // POST /api/ai/generate-resolution-summary — Generate a resolution summary for a resolved ticket
  if (pathname === "/api/ai/generate-resolution-summary" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 50000);
      const { ticketId, requestedBy } = body;
      if (!ticketId || !requestedBy) return json(res, 400, { error: "ticketId and requestedBy required" });

      const incRow = await db.getOne("incidents", ticketId);
      if (!incRow) return json(res, 404, { error: "Ticket not found" });
      const inc = JSON.parse(incRow.data);

      // Gather activity log for context
      const activities = (inc.activityLog || []).map(a => `[${a.time}] ${a.type}: ${a.detail}`).join("\n");

      const systemPrompt = `You are a VGC Technology ITSM Resolution Summary AI.
Generate a structured resolution summary for the following resolved/closed ticket.

TICKET:
ID: ${inc.id}
Title: ${inc.title}
Category: ${inc.category || "General"}
Priority: ${inc.priority || "Sev-C"}
Status: ${inc.status}
Description: ${(inc.description || "").substring(0, 1000)}
Workaround: ${inc.workaround || "None"}
Resolution Notes: ${inc.resolutionNotes || "None"}

ACTIVITY LOG:
${activities || "No activity log"}

Generate a professional resolution summary with:
1. Root cause (or suspected root cause)
2. Steps taken to resolve
3. Resolution outcome
4. Preventive recommendations
5. Customer communication draft (1-2 paragraphs)

Respond with ONLY valid JSON (no markdown):
{
  "rootCause": "string",
  "stepsTaken": ["step1", "step2"],
  "outcome": "string",
  "preventiveActions": ["action1", "action2"],
  "customerMessage": "string",
  "internalNotes": "string",
  "timeToResolve": "estimated hours"
}`;

      const payload = {
        model: getAIModel("tertiary"),
        input: [{ role: "system", content: systemPrompt }],
        max_output_tokens: 1000
      };

      const aiUrl = new URL(ctx.AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({
          hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
          method: "POST", headers: { "Content-Type": "application/json", "api-key": ctx.AZURE_OPENAI_KEY },
        }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => {
            if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
            else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
          });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let parsed;
      try {
        parsed = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch {
        parsed = { rootCause: "Unable to parse", stepsTaken: [], outcome: text.substring(0, 500), preventiveActions: [], customerMessage: "", internalNotes: "", timeToResolve: "N/A" };
      }

      console.log(`[Resolution Summary] Generated for ${ticketId}`);
      return json(res, 200, { ticketId, summary: parsed });
    } catch (err) {
      console.error("[Resolution Summary]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // ─── Phase 2: AI Predictive SLA Breach Prevention ───────────────────
  // POST /api/ai/sla-predict — AI predicts SLA breaches and suggests preventive actions
  if (pathname === "/api/ai/sla-predict" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 200000);
      const { incidents: clientIncidents, requests: clientRequests, requestedBy } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });

      const openIncidents = (clientIncidents || []).filter(i => !["Resolved", "Closed"].includes(i.status));
      if (openIncidents.length === 0) return json(res, 200, { predictions: [], message: "No open tickets" });

      const slaMap = getSlaMap();

      // Calculate SLA metrics for each open ticket
      const ticketSummaries = openIncidents.map(inc => {
        const slaTarget = inc.slaTarget || slaMap[inc.priority] || 9;
        const hoursElapsed = inc.created || 0;
        const pctUsed = Math.round((hoursElapsed / slaTarget) * 100);
        const hrsLeft = Math.max(0, slaTarget - hoursElapsed);
        const activityCount = (inc.activityLog || []).length;
        return `ID:${inc.id} Title:"${(inc.title||"").substring(0,60)}" Priority:${inc.priority} Status:${inc.status} Category:${inc.category||"?"} Assignee:${inc.assignee||"Unassigned"} Group:${inc.assignmentGroup||"?"} SLA:${pctUsed}% used (${hrsLeft.toFixed(1)}h left of ${slaTarget}h) Activities:${activityCount}`;
      }).join("\n");

      // Historical MTTR by category
      const allInc = clientIncidents || [];
      const resolved = allInc.filter(i => i.status === "Resolved" || i.status === "Closed");
      const mttrByCategory = {};
      resolved.forEach(i => {
        if (!mttrByCategory[i.category]) mttrByCategory[i.category] = [];
        mttrByCategory[i.category].push(i.created || 0);
      });
      const mttrSummary = Object.entries(mttrByCategory).map(([cat, times]) => {
        const avg = (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1);
        return `${cat}: avg ${avg}h (${times.length} resolved)`;
      }).join(", ");

      const systemPrompt = `You are VGC Technology's SLA prediction engine. Analyze open tickets and predict which ones will breach their SLA targets. VGC SLA Policy: ${getSlaDescription()}. Business hours: Mon-Fri 9AM-6PM SGT. Consider: time elapsed vs SLA target, ticket velocity (activity count), historical MTTR for category, assignee workload, priority severity. Return JSON array ONLY (no markdown): [{ "ticketId": "INC-XXX", "breachProbability": 0-100, "predictedBreachIn": "Xh Ym", "suggestedAction": "reassign|escalate|add_resources|notify_manager", "escalationTarget": "name or role", "reasoning": "brief explanation", "emailDraft": "escalation email body if needed" }]. Only include tickets with breachProbability >= 50. Sort by breach probability descending.`;

      const userPrompt = `Open tickets:\n${ticketSummaries}\n\nHistorical MTTR: ${mttrSummary || "No historical data yet"}\n\nPredict SLA breaches and suggest preventive actions.`;

      const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 2000 };
      const aiUrl = new URL(ctx.AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({ hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search, method: "POST", headers: { "Content-Type": "application/json", "api-key": ctx.AZURE_OPENAI_KEY } }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => { if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data)); else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`)); });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let predictions;
      try {
        predictions = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
        if (!Array.isArray(predictions)) predictions = [predictions];
      } catch { predictions = []; }

      const now = new Date().toISOString();
      const actions = [];
      // Unified dedup: use shared helper + per-incident cap
      const dedupState = await getAiActionsDedupState();
      for (const pred of predictions) {
        if ((pred.breachProbability || 0) >= AI_THRESHOLDS.slaRisk) {
          const skipReason = shouldSkipAction(dedupState, { incidentId: pred.ticketId, type: "sla_prevention" });
          if (skipReason) { console.log(`[AI SLA] Skipped ${pred.ticketId}: ${skipReason}`); continue; }
          const actionRecord = {
            id: `SLA-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
            type: "sla_prevention",
            severity: pred.breachProbability >= 90 ? "critical" : "high",
            title: `SLA Breach Risk: ${pred.ticketId} (${pred.breachProbability}% likely)`,
            description: pred.reasoning || "Predicted SLA breach",
            incidentId: pred.ticketId,
            suggestedAction: pred.suggestedAction || "escalate",
            escalationTarget: pred.escalationTarget || "",
            emailDraft: pred.emailDraft || "",
            predictedBreachIn: pred.predictedBreachIn || "unknown",
            breachProbability: pred.breachProbability,
            confidence: pred.breachProbability,
            autoExecutable: false,
            status: "pending_approval",
            createdAt: now,
            createdBy: "AI SLA Prediction Engine",
            requestedBy,
          };
          await db.upsert("ai_actions", actionRecord.id, JSON.stringify(actionRecord));
          trackNewAction(dedupState, { incidentId: pred.ticketId, type: "sla_prevention", title: actionRecord.title });
          actions.push(actionRecord);
        }
      }

      console.log(`[AI SLA] Predicted ${predictions.length} risks, created ${actions.length} actions`);
      return json(res, 200, { predictions, actions, count: predictions.length });
    } catch (err) {
      console.error("[AI SLA Predict]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/sla-audit — AI scans incidents for data quality issues
  if (pathname === "/api/ai/sla-audit" && req.method === "POST") {
    try {
      const allRows = await db.getAll("incidents");
      const slaMap = getSlaMap();
      const issues = [];
      let fixed = 0;

      for (const row of allRows) {
        try {
          const inc = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          if (!inc || !inc.id) continue;
          const incIssues = [];
          let changed = false;

          if (inc.slaTarget === undefined || inc.slaTarget === null) {
            incIssues.push("missing_slaTarget");
            inc.slaTarget = slaMap[inc.priority] || 9;
            changed = true;
          }
          if (inc.created === undefined || inc.created === null) {
            incIssues.push("missing_created");
            inc.created = 0;
            changed = true;
          }
          if (!inc.createdAt) {
            incIssues.push("missing_createdAt");
            if (Array.isArray(inc.activityLog) && inc.activityLog.length > 0) {
              const first = inc.activityLog.find(a => a.time);
              if (first) { inc.createdAt = first.time; changed = true; }
            }
          }
          if ((inc.status === "Resolved" || inc.status === "Closed") && !inc.resolvedAt) {
            incIssues.push("missing_resolvedAt");
            inc.resolvedAt = inc.updatedAt || inc.zdLastSync || new Date().toISOString();
            changed = true;
          }
          if (typeof inc.created === "number" && inc.created > 8760) {
            incIssues.push("stale_created_snapshot");
          }

          if (changed) {
            await db.upsert("incidents", inc.id, JSON.stringify(inc));
            fixed++;
          }
          if (incIssues.length > 0) {
            issues.push({ id: inc.id, priority: inc.priority, status: inc.status, issues: incIssues, fixed: changed });
          }
        } catch {}
      }

      return json(res, 200, {
        totalScanned: allRows.length,
        issuesFound: issues.length,
        autoFixed: fixed,
        issues: issues.slice(0, 100),
        summary: {
          missingSlaTarget: issues.filter(i => i.issues.includes("missing_slaTarget")).length,
          missingCreated: issues.filter(i => i.issues.includes("missing_created")).length,
          missingCreatedAt: issues.filter(i => i.issues.includes("missing_createdAt")).length,
          missingResolvedAt: issues.filter(i => i.issues.includes("missing_resolvedAt")).length,
          staleCreatedSnapshot: issues.filter(i => i.issues.includes("stale_created_snapshot")).length,
        },
      });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/sla-remediate — Recalculate SLA for resolved incidents using business hours, stamp results
  if (pathname === "/api/ai/sla-remediate" && req.method === "POST") {
    try {
      const allRows = await db.getAll("incidents");
      const slaMap = getSlaMap();
      const now = new Date();
      let remediated = 0, alreadyDone = 0, skipped = 0;
      const details = [];

      for (const row of allRows) {
        try {
          const inc = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
          if (!inc || !inc.id) continue;
          if (inc.status !== "Resolved" && inc.status !== "Closed") { skipped++; continue; }
          if (inc.slaRemediated) { alreadyDone++; continue; }

          const target = inc.slaTarget || slaMap[inc.priority] || 9;
          let elapsed = 0;
          if (inc.createdAt) {
            const start = new Date(inc.createdAt);
            if (!isNaN(start.getTime())) {
              const endTime = inc.resolvedAt ? new Date(inc.resolvedAt) : now;
              const BH_START = 9, BH_END = 18;
              let cursor = new Date(start);
              while (cursor < endTime) {
                const day = cursor.getDay();
                if (day >= 1 && day <= 5) {
                  const hrs = cursor.getHours() + cursor.getMinutes() / 60;
                  if (hrs >= BH_START && hrs < BH_END) {
                    const eob = new Date(cursor); eob.setHours(BH_END, 0, 0, 0);
                    const chunk = eob < endTime ? eob : endTime;
                    elapsed += (chunk - cursor) / 3600000;
                    cursor = new Date(chunk);
                  } else if (hrs < BH_START) { cursor.setHours(BH_START, 0, 0, 0); }
                  else { cursor.setDate(cursor.getDate() + 1); cursor.setHours(BH_START, 0, 0, 0); }
                } else {
                  const daysToMon = day === 0 ? 1 : 8 - day;
                  cursor.setDate(cursor.getDate() + daysToMon); cursor.setHours(BH_START, 0, 0, 0);
                }
                if (cursor >= endTime) break;
              }
            }
          } else {
            elapsed = inc.created || 0;
          }
          elapsed = Math.round(elapsed * 100) / 100;
          const breached = elapsed > target;

          inc.slaElapsedHours = elapsed;
          inc.slaStatus = breached ? "Breached" : "Met";
          inc.slaRemediated = true;
          inc.slaRemediatedAt = now.toISOString();
          inc.updatedAt = now.toISOString();

          await db.upsert("incidents", inc.id, JSON.stringify(inc));
          remediated++;
          details.push({ id: inc.id, priority: inc.priority, elapsed, target, breached, status: inc.slaStatus });
        } catch {}
      }

      console.log(`[AI SLA Remediate] Remediated ${remediated}, already done ${alreadyDone}, skipped ${skipped} active`);
      return json(res, 200, {
        totalScanned: allRows.length,
        remediated,
        alreadyDone,
        skippedActive: skipped,
        sample: details.slice(0, 50),
        summary: {
          met: details.filter(d => !d.breached).length,
          breached: details.filter(d => d.breached).length,
        },
      });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // GET /api/sla/compliance-report — Unified SLA metrics for all modules
  if (pathname === "/api/sla/compliance-report" && req.method === "GET") {
    try {
      const allRows = await db.getAll("incidents");
      const slaMap = getSlaMap();
      const now = new Date();

      const incidents = allRows.map(r => {
        try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; }
      }).filter(Boolean);

      const active = incidents.filter(i => i.status !== "Resolved" && i.status !== "Closed");
      const resolved = incidents.filter(i => i.status === "Resolved" || i.status === "Closed");

      // Business hours SLA computation
      const computeSla = (inc) => {
        const target = inc.slaTarget || slaMap[inc.priority] || 9;
        let elapsed = 0;
        if (inc.createdAt) {
          const start = new Date(inc.createdAt);
          if (!isNaN(start.getTime())) {
            const endTime = (inc.status === "Resolved" || inc.status === "Closed") && inc.resolvedAt ? new Date(inc.resolvedAt) : now;
            const BH_START = 9, BH_END = 18;
            let cursor = new Date(start);
            while (cursor < endTime) {
              const day = cursor.getDay();
              if (day >= 1 && day <= 5) {
                const hrs = cursor.getHours() + cursor.getMinutes() / 60;
                if (hrs >= BH_START && hrs < BH_END) {
                  const eob = new Date(cursor); eob.setHours(BH_END, 0, 0, 0);
                  const chunk = eob < endTime ? eob : endTime;
                  elapsed += (chunk - cursor) / 3600000;
                  cursor = new Date(chunk);
                } else if (hrs < BH_START) { cursor.setHours(BH_START, 0, 0, 0); }
                else { cursor.setDate(cursor.getDate() + 1); cursor.setHours(BH_START, 0, 0, 0); }
              } else {
                const daysToMon = day === 0 ? 1 : 8 - day;
                cursor.setDate(cursor.getDate() + daysToMon); cursor.setHours(BH_START, 0, 0, 0);
              }
              if (cursor >= endTime) break;
            }
          }
        } else {
          elapsed = inc.created || 0;
        }
        return { elapsed: Math.round(elapsed * 100) / 100, target, breached: elapsed > target, pct: Math.round((elapsed / target) * 100) };
      };

      const activeSla = active.map(i => ({ id: i.id, priority: i.priority, ...computeSla(i) }));
      const resolvedSla = resolved.map(i => ({ id: i.id, priority: i.priority, ...computeSla(i) }));

      const activeBreached = activeSla.filter(s => s.breached).length;
      const activeMet = activeSla.length - activeBreached;
      const resolvedBreached = resolvedSla.filter(s => s.breached).length;
      const resolvedMet = resolvedSla.length - resolvedBreached;

      // MTTR from resolved with timestamps
      const withTimestamps = resolved.filter(i => i.createdAt && i.resolvedAt);
      let mttrHours = 0;
      if (withTimestamps.length > 0) {
        const totalResolveTime = withTimestamps.reduce((sum, i) => {
          const s = computeSla(i);
          return sum + s.elapsed;
        }, 0);
        mttrHours = Math.round((totalResolveTime / withTimestamps.length) * 10) / 10;
      }

      const byPriority = {};
      for (const p of ["Sev-A", "Sev-B", "Sev-C", "Sev-D"]) {
        const pActive = activeSla.filter(s => s.priority === p);
        const pResolved = resolvedSla.filter(s => s.priority === p);
        byPriority[p] = {
          active: pActive.length,
          activeBreached: pActive.filter(s => s.breached).length,
          resolved: pResolved.length,
          resolvedBreached: pResolved.filter(s => s.breached).length,
          target: slaMap[p] || 9,
        };
      }

      return json(res, 200, {
        overall: {
          activeMet, activeBreached, activeTotal: active.length,
          resolvedMet, resolvedBreached, resolvedTotal: resolved.length,
          compliancePct: active.length > 0 ? Math.round((activeMet / active.length) * 100) : 100,
          mttrHours,
        },
        byPriority,
        generatedAt: now.toISOString(),
      });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Phase 4: Smart Workload Balancing ──────────────────────────────
  // POST /api/ai/workload-rebalance — AI analyzes team workload and suggests reassignments
  if (pathname === "/api/ai/workload-rebalance" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 50000);
      const { requestedBy } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });

      const allUsersRaw = await db.getAll("users");
      const teamMembers = allUsersRaw.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

      const allIncRaw = await db.getAll("incidents");
      const allIncidents = allIncRaw.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

      const openStatuses = new Set(["New", "Open", "In Progress", "Pending"]);
      const openIncidents = allIncidents.filter(i => openStatuses.has(i.status));

      // Build workload map: assignee → { count, sevA, sevB, totalSlaUsed, tickets[] }
      const workloadMap = {};
      for (const inc of openIncidents) {
        const assignee = inc.assignee || "Unassigned";
        if (!workloadMap[assignee]) workloadMap[assignee] = { count: 0, sevA: 0, sevB: 0, totalSlaUsed: 0, tickets: [] };
        workloadMap[assignee].count++;
        if (inc.priority === "Sev-A") workloadMap[assignee].sevA++;
        if (inc.priority === "Sev-B") workloadMap[assignee].sevB++;
        const slaTarget = inc.slaTarget || getSlaMap()[inc.priority] || 9;
        workloadMap[assignee].totalSlaUsed += Math.round(((inc.created || 0) / slaTarget) * 100);
        workloadMap[assignee].tickets.push({ id: inc.id, title: (inc.title || "").substring(0, 50), priority: inc.priority, category: inc.category, slaUsed: Math.round(((inc.created || 0) / slaTarget) * 100) });
      }

      // Historical resolution expertise
      const resolvedInc = allIncidents.filter(i => i.status === "Resolved" || i.status === "Closed");
      const expertise = {};
      for (const inc of resolvedInc) {
        if (!inc.assignee || inc.assignee === "Unassigned") continue;
        if (!expertise[inc.assignee]) expertise[inc.assignee] = {};
        const cat = inc.category || "General";
        expertise[inc.assignee][cat] = (expertise[inc.assignee][cat] || 0) + 1;
      }

      const workloadSummary = Object.entries(workloadMap).map(([name, w]) => {
        const avgSla = w.count > 0 ? Math.round(w.totalSlaUsed / w.count) : 0;
        const exp = expertise[name] ? Object.entries(expertise[name]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c}(${n})`).join(",") : "none";
        return `${name}: ${w.count} open (${w.sevA} Sev-A, ${w.sevB} Sev-B), avg SLA ${avgSla}% used, expertise: ${exp}`;
      }).join("\n");

      const teamList = teamMembers.slice(0, 20).map(u => `${u.displayName || u.name || u.id} (${u.jobTitle || u.role || "Agent"})`).join(", ");

      const systemPrompt = `You are the VGC-ITSM Workload Balancing Engine. Analyze team workload distribution and suggest reassignments to optimize performance.

CURRENT WORKLOAD:
${workloadSummary}

TEAM MEMBERS: ${teamList}

RULES:
1. Balance ticket count across agents — no one should have >2x the average
2. Match ticket category to agent expertise when possible
3. Prioritize reassigning Sev-A/Sev-B tickets at high SLA usage
4. Never reassign tickets already near resolution (>80% SLA used with activity)
5. Consider "Unassigned" tickets as top priority for assignment

Return JSON ONLY (no markdown): {
  "summary": "brief overall assessment",
  "avgWorkload": number,
  "maxWorkload": number,
  "imbalanceScore": 0-100 (0=perfectly balanced, 100=extremely unbalanced),
  "reassignments": [{ "ticketId": "INC-XXX", "from": "current assignee", "to": "suggested assignee", "reason": "brief reason", "priority": "high|medium|low" }],
  "unassignedActions": [{ "ticketId": "INC-XXX", "suggestedAssignee": "name", "reason": "why this person" }]
}`;

      const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: `Analyze current workload and suggest optimal reassignments. ${openIncidents.length} open tickets across ${Object.keys(workloadMap).length} agents.` }], max_output_tokens: 2000 };
      const aiUrl = new URL(ctx.AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({ hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search, method: "POST", headers: { "Content-Type": "application/json", "api-key": ctx.AZURE_OPENAI_KEY } }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => { if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data)); else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`)); });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let analysis;
      try {
        analysis = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch { analysis = { summary: "Could not parse AI response", imbalanceScore: 0, reassignments: [], unassignedActions: [] }; }

      // Create AI actions for recommended reassignments
      const dedupState = await getAiActionsDedupState();
      const now = new Date().toISOString();
      const actions = [];
      for (const r of (analysis.reassignments || [])) {
        const skipReason = shouldSkipAction(dedupState, { incidentId: r.ticketId, type: "workload_rebalance" });
        if (skipReason) { console.log(`[Workload] Skipped ${r.ticketId}: ${skipReason}`); continue; }
        const actionRecord = {
          id: `WLB-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          type: "workload_rebalance",
          severity: r.priority === "high" ? "high" : "medium",
          title: `Reassign ${r.ticketId}: ${r.from} → ${r.to}`,
          description: r.reason,
          incidentId: r.ticketId,
          suggestedAction: "reassign",
          fromAssignee: r.from,
          toAssignee: r.to,
          confidence: 80,
          autoExecutable: false,
          status: "pending_approval",
          createdAt: now,
          createdBy: "AI Workload Balancing Engine",
          requestedBy,
        };
        await db.upsert("ai_actions", actionRecord.id, JSON.stringify(actionRecord));
        trackNewAction(dedupState, { incidentId: r.ticketId, type: "workload_rebalance", title: actionRecord.title });
        actions.push(actionRecord);
      }

      console.log(`[Workload] Imbalance: ${analysis.imbalanceScore || 0}%, ${(analysis.reassignments || []).length} suggestions, ${actions.length} actions created`);
      return json(res, 200, { analysis, workloadMap, actions, count: actions.length });
    } catch (err) {
      console.error("[Workload Rebalance]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Phase 5: Root Cause Correlation ────────────────────────────────
  // POST /api/ai/correlate-incidents — AI finds patterns and common root causes across incidents
  if (pathname === "/api/ai/correlate-incidents" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 50000);
      const { requestedBy } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });

      const allIncRaw = await db.getAll("incidents");
      const allIncidents = allIncRaw.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);

      // Recent incidents (last 30 days or last 100)
      const recentIncidents = allIncidents.slice(-100);
      const openStatuses = new Set(["New", "Open", "In Progress", "Pending"]);
      const openIncidents = recentIncidents.filter(i => openStatuses.has(i.status));
      const resolvedIncidents = recentIncidents.filter(i => i.status === "Resolved" || i.status === "Closed");

      // Build category/priority clusters
      const clusters = {};
      for (const inc of recentIncidents) {
        const key = `${inc.category || "General"}|${inc.assignmentGroup || "Service Desk"}`;
        if (!clusters[key]) clusters[key] = { category: inc.category || "General", group: inc.assignmentGroup || "Service Desk", count: 0, open: 0, ids: [], priorities: {} };
        clusters[key].count++;
        if (openStatuses.has(inc.status)) clusters[key].open++;
        clusters[key].ids.push(inc.id);
        clusters[key].priorities[inc.priority] = (clusters[key].priorities[inc.priority] || 0) + 1;
      }

      const incidentSummaries = recentIncidents.slice(-50).map(inc => {
        return `ID:${inc.id} Title:"${(inc.title||"").substring(0,60)}" Cat:${inc.category||"?"} Priority:${inc.priority} Status:${inc.status} Group:${inc.assignmentGroup||"?"} Reporter:${inc.reporter||"?"} Created:${inc.createdAt||"?"}`;
      }).join("\n");

      const clusterSummary = Object.values(clusters).sort((a, b) => b.count - a.count).slice(0, 15).map(c => {
        return `${c.category} (${c.group}): ${c.count} total, ${c.open} open, priorities: ${Object.entries(c.priorities).map(([p, n]) => `${p}:${n}`).join(",")}`;
      }).join("\n");

      const systemPrompt = `You are the VGC-ITSM Root Cause Correlation Engine. Analyze recent incidents to identify patterns, recurring issues, and common root causes.

INCIDENT CLUSTERS:
${clusterSummary}

RECENT INCIDENTS:
${incidentSummaries}

ANALYSIS TASKS:
1. Identify recurring incident patterns (same category/type appearing multiple times)
2. Find potential common root causes linking multiple incidents
3. Detect category-specific trends (increasing/decreasing)
4. Spot related incidents that might have a shared underlying cause
5. Recommend proactive measures to prevent recurrence

Return JSON ONLY (no markdown): {
  "correlations": [{ "id": "COR-001", "title": "pattern title", "type": "recurring|related|trend|root_cause", "severity": "critical|high|medium|low", "affectedTickets": ["INC-XXX"], "description": "what was found", "rootCause": "likely root cause", "recommendation": "suggested fix", "confidence": 0-100 }],
  "trends": [{ "category": "...", "direction": "increasing|decreasing|stable", "count": number, "insight": "brief" }],
  "summary": "overall pattern analysis",
  "riskScore": 0-100
}`;

      const payload = { model: getAIModel("primary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: `Analyze ${recentIncidents.length} recent incidents (${openIncidents.length} open, ${resolvedIncidents.length} resolved) across ${Object.keys(clusters).length} clusters. Find patterns and root causes.` }], max_output_tokens: 2500 };
      const aiUrl = new URL(ctx.AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({ hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search, method: "POST", headers: { "Content-Type": "application/json", "api-key": ctx.AZURE_OPENAI_KEY } }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => { if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data)); else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`)); });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(45000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let analysis;
      try {
        analysis = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch { analysis = { correlations: [], trends: [], summary: "Could not parse AI response", riskScore: 0 }; }

      // Create AI actions for high-confidence correlations
      const dedupState = await getAiActionsDedupState();
      const now = new Date().toISOString();
      const actions = [];
      for (const cor of (analysis.correlations || [])) {
        if ((cor.confidence || 0) < 60) continue;
        const dedupId = (cor.affectedTickets || []).sort().join(",") || cor.id;
        const skipReason = shouldSkipAction(dedupState, { incidentId: dedupId, type: "root_cause_correlation" });
        if (skipReason) { console.log(`[Correlation] Skipped ${cor.id}: ${skipReason}`); continue; }
        const actionRecord = {
          id: `COR-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          type: "root_cause_correlation",
          severity: cor.severity || "medium",
          title: cor.title,
          description: `${cor.description}\n\nRoot Cause: ${cor.rootCause || "Under investigation"}\nRecommendation: ${cor.recommendation || "Review affected tickets"}`,
          incidentId: dedupId,
          affectedTickets: cor.affectedTickets || [],
          rootCause: cor.rootCause || "",
          recommendation: cor.recommendation || "",
          confidence: cor.confidence || 70,
          correlationType: cor.type || "related",
          autoExecutable: false,
          status: "pending_approval",
          createdAt: now,
          createdBy: "AI Root Cause Correlation Engine",
          requestedBy,
        };
        await db.upsert("ai_actions", actionRecord.id, JSON.stringify(actionRecord));
        trackNewAction(dedupState, { incidentId: dedupId, type: "root_cause_correlation", title: actionRecord.title });
        actions.push(actionRecord);
      }

      console.log(`[Correlation] Found ${(analysis.correlations || []).length} patterns, ${(analysis.trends || []).length} trends, created ${actions.length} actions`);
      if (wsServer && actions.length > 0) {
        wsServer.broadcast("ai_correlation", { action: "patterns_detected", correlations: analysis.correlations, trends: analysis.trends, riskScore: analysis.riskScore, count: actions.length });
      }
      return json(res, 200, { analysis, actions, count: actions.length });
    } catch (err) {
      console.error("[Correlation]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Phase 3: AI Knowledge Base Auto-Generation ─────────────────────
  // POST /api/ai/kb-auto-generate — generate KB article from resolved ticket
  if (pathname === "/api/ai/kb-auto-generate" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 100000);
      const { ticket, requestedBy } = body;
      if (!ticket || !requestedBy) return json(res, 400, { error: "ticket and requestedBy required" });

      // Get existing KB for dedup check
      const existingKB = await db.getAll("kb");
      const kbTitles = existingKB.map(k => { try { const d = JSON.parse(k.data); return d.title || ""; } catch { return ""; } }).filter(Boolean).join(", ");

      const activitySummary = (ticket.activityLog || []).map(a => `[${a.time}] ${a.user}: ${a.detail}`).join("\n");

      const orgName = await getOrgName();
      const systemPrompt = `You are ${orgName}'s knowledge management AI. Generate a professional, enterprise-grade KB article from a resolved ITSM incident. The article must help engineers resolve similar issues quickly and independently.

Structure requirements:
- **Problem Statement**: Clear description of the issue and symptoms
- **Root Cause**: Technical root cause analysis  
- **Solution Steps**: Numbered, actionable resolution steps (copy-paste commands where applicable)
- **Prevention**: How to prevent recurrence
- **When To Use**: One-line description of when this article applies
- **Best For**: Target audience (e.g., "L1 Service Desk", "Network Engineers")
- **Quick Fix**: 1-2 sentence emergency workaround if applicable
- **Related Services**: Affected services/systems
- **Estimated Resolution Time**: Typical time to resolve

Existing KB titles for deduplication: [${kbTitles.substring(0, 1500)}]. If this resolution is too similar to an existing article, set isDuplicate=true.

Return JSON ONLY: { "title": "clear article title", "category": "matching incident category", "content": "full structured article with above sections", "tags": ["tag1","tag2"], "whenToUse": "one-line", "bestFor": "role or scenario", "quickFix": "emergency workaround or empty string", "relatedServices": ["svc1"], "estimatedResolutionTime": "Xh Ym", "confidence": 0-100, "isDuplicate": false, "duplicateOf": "existing title if duplicate" }`;

      const userPrompt = `Resolved Incident:\nID: ${ticket.id}\nTitle: ${ticket.title}\nCategory: ${ticket.category || "General"}\nPriority: ${ticket.priority}\nDescription: ${(ticket.description || "").substring(0, 800)}\nResolution/Workaround: ${(ticket.workaround || ticket.resolution || "").substring(0, 800)}\n\nActivity Log:\n${activitySummary.substring(0, 3000)}\n\nGenerate a comprehensive KB article from this resolution.`;

      const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 2000 };
      const aiUrl = new URL(ctx.AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({ hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search, method: "POST", headers: { "Content-Type": "application/json", "api-key": ctx.AZURE_OPENAI_KEY } }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => { if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data)); else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`)); });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let kbDraft;
      try {
        kbDraft = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch {
        return json(res, 502, { error: "AI returned invalid KB JSON", raw: text.substring(0, 500) });
      }

      if (kbDraft.isDuplicate) {
        return json(res, 200, { isDuplicate: true, duplicateOf: kbDraft.duplicateOf, message: "Similar KB article already exists" });
      }

      const now = new Date().toISOString();
      const draftId = `KBD-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

      // Save KB draft to ai_actions for approval
      const actionRecord = {
        id: draftId,
        type: "kb_draft",
        severity: "low",
        title: `KB Draft: ${kbDraft.title}`,
        description: `Auto-generated from resolved ticket ${ticket.id}`,
        incidentId: ticket.id,
        suggestedAction: `Publish KB article: "${kbDraft.title}"`,
        kbDraft: {
          title: kbDraft.title,
          category: kbDraft.category || ticket.category || "General",
          content: kbDraft.content,
          tags: kbDraft.tags || [],
          whenToUse: kbDraft.whenToUse || "",
          bestFor: kbDraft.bestFor || "",
          quickFix: kbDraft.quickFix || "",
          relatedServices: kbDraft.relatedServices || [],
          estimatedResolutionTime: kbDraft.estimatedResolutionTime || "",
          sourceTicketId: ticket.id,
        },
        confidence: kbDraft.confidence || 75,
        autoExecutable: false,
        status: "pending_approval",
        createdAt: now,
        createdBy: "AI KB Generation Engine",
        requestedBy,
      };

      await db.upsert("ai_actions", actionRecord.id, JSON.stringify(actionRecord));
      console.log(`[AI KB] Generated draft "${kbDraft.title}" from ${ticket.id}`);
      return json(res, 200, { success: true, draftId, kbDraft: actionRecord.kbDraft, confidence: kbDraft.confidence });
    } catch (err) {
      console.error("[AI KB Generate]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/kb-auto-generate/approve — approve and publish a KB draft
  if (pathname === "/api/ai/kb-auto-generate/approve" && req.method === "POST") {
    try {
      const body = await parseBody(req, 50000);
      const { actionId, approvedBy, editedContent } = body;
      if (!actionId || !approvedBy) return json(res, 400, { error: "actionId and approvedBy required" });

      const row = await db.getOne("ai_actions", actionId);
      if (!row) return json(res, 404, { error: "KB draft action not found" });
      const action = JSON.parse(row.data);
      if (action.type !== "kb_draft") return json(res, 400, { error: "Not a KB draft action" });

      const draft = action.kbDraft;
      const now = new Date().toISOString();
      const kbId = `KB-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

      // Create published KB article
      const kbArticle = {
        id: kbId,
        title: draft.title,
        category: draft.category,
        content: editedContent || draft.content,
        tags: draft.tags,
        whenToUse: draft.whenToUse,
        bestFor: draft.bestFor,
        sourceTicketId: draft.sourceTicketId,
        status: "Published",
        author: approvedBy,
        createdAt: now,
        updatedAt: now,
        aiGenerated: true,
        views: 0, helpful: 0, notHelpful: 0,
      };

      await db.upsert("kb", kbId, JSON.stringify(kbArticle));

      // Update action status
      action.status = "applied";
      action.approvedBy = approvedBy;
      action.approvedAt = now;
      action.executedAt = now;
      action.executionResult = `Published as ${kbId}`;
      await db.upsert("ai_actions", actionId, JSON.stringify(action));

      console.log(`[AI KB] Published ${kbId} from draft ${actionId} by ${approvedBy}`);
      return json(res, 200, { success: true, kbId, article: kbArticle });
    } catch (err) {
      console.error("[AI KB Approve]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/kb-batch-generate — batch-generate KB from all recent resolved incidents
  if (pathname === "/api/ai/kb-batch-generate" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    if (!auth.authenticated || !auth.role || !["admin", "super_admin"].includes(auth.role)) {
      return json(res, 403, { error: "Admin access required" });
    }
    try {
      const body = await parseBody(req, 50000);
      const { requestedBy, sinceDays = 7, maxArticles = 10 } = body || {};
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });

      // Get resolved incidents from the last N days
      const cutoff = new Date(Date.now() - sinceDays * 86400000).toISOString();
      const allInc = await db.getAll("incidents");
      const resolved = allInc.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } })
        .filter(t => t && (t.status === "Resolved" || t.status === "Closed") && (t.workaround || t.resolution) && (t.resolvedAt || t.updatedAt || t.created) >= cutoff);

      // Get existing KB + existing drafts to skip
      const existingKB = await db.getAll("kb");
      const kbTitles = existingKB.map(k => { try { const d = JSON.parse(k.data); return d.title || ""; } catch { return ""; } }).filter(Boolean);
      const existingDrafts = await db.getAll("ai_actions");
      const draftSourceIds = new Set(existingDrafts.map(d => { try { const a = JSON.parse(d.data); return a.type === "kb_draft" ? a.incidentId : null; } catch { return null; } }).filter(Boolean));

      // Filter out incidents that already have KB drafts
      const candidates = resolved.filter(t => !draftSourceIds.has(t.id)).slice(0, maxArticles);

      if (candidates.length === 0) {
        return json(res, 200, { success: true, generated: 0, message: "No new resolved incidents need KB articles" });
      }

      // Get AI learning feedback to improve generation
      let feedbackContext = "";
      try {
        const fbRows = await db.getAll("ai_learning_feedback");
        const recentFb = fbRows.slice(-20).map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(f => f && f.type === "kb_quality");
        if (recentFb.length > 0) {
          feedbackContext = `\n\nRecent engineer feedback on KB quality:\n${recentFb.map(f => `- ${f.rating}: "${f.comment}"`).join("\n")}`;
        }
      } catch {}

      const orgName = await getOrgName();
      const results = [];

      for (const ticket of candidates) {
        try {
          const activitySummary = (ticket.activityLog || []).map(a => `[${a.time}] ${a.user}: ${a.detail}`).join("\n");

          const systemPrompt = `You are ${orgName}'s knowledge management AI. Generate a professional, enterprise-grade KB article from a resolved ITSM incident.${feedbackContext}

Structure: Problem Statement, Root Cause, Solution Steps (numbered), Prevention, When To Use, Best For, Quick Fix. Existing KB: [${kbTitles.join(", ").substring(0, 1500)}]. Set isDuplicate=true if too similar.

Return JSON ONLY: { "title": "string", "category": "string", "content": "full article", "tags": ["tag1"], "whenToUse": "string", "bestFor": "string", "quickFix": "string", "confidence": 0-100, "isDuplicate": false, "duplicateOf": "" }`;

          const userPrompt = `Incident ${ticket.id}: ${ticket.title}\nCategory: ${ticket.category || "General"}\nPriority: ${ticket.priority}\nDescription: ${(ticket.description || "").substring(0, 600)}\nResolution: ${(ticket.workaround || ticket.resolution || "").substring(0, 600)}\nActivity:\n${activitySummary.substring(0, 1500)}`;

          const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 2000 };
          const aiUrl = new URL(ctx.AZURE_OPENAI_ENDPOINT);
          const aiResult = await new Promise((resolve, reject) => {
            const aiReq = https.request({ hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search, method: "POST", headers: { "Content-Type": "application/json", "api-key": ctx.AZURE_OPENAI_KEY } }, (aiRes) => {
              let data = ""; aiRes.on("data", c => data += c);
              aiRes.on("end", () => { if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data)); else reject(new Error(`AI ${aiRes.statusCode}`)); });
            });
            aiReq.on("error", reject);
            aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
            aiReq.write(JSON.stringify(payload));
            aiReq.end();
          });

          const text = extractAIText(aiResult);
          const kbDraft = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());

          if (kbDraft.isDuplicate) {
            results.push({ ticketId: ticket.id, status: "skipped_duplicate", duplicateOf: kbDraft.duplicateOf });
            continue;
          }

          const draftId = `KBD-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
          const now = new Date().toISOString();
          const actionRecord = {
            id: draftId, type: "kb_draft", severity: "low",
            title: `KB Draft: ${kbDraft.title}`,
            description: `Auto-generated from resolved ticket ${ticket.id} (batch)`,
            incidentId: ticket.id,
            suggestedAction: `Publish KB article: "${kbDraft.title}"`,
            kbDraft: { title: kbDraft.title, category: kbDraft.category || ticket.category || "General", content: kbDraft.content, tags: kbDraft.tags || [], whenToUse: kbDraft.whenToUse || "", bestFor: kbDraft.bestFor || "", quickFix: kbDraft.quickFix || "", sourceTicketId: ticket.id },
            confidence: kbDraft.confidence || 75,
            autoExecutable: false, status: "pending_approval",
            createdAt: now, createdBy: "AI KB Batch Engine", requestedBy,
          };
          await db.upsert("ai_actions", draftId, JSON.stringify(actionRecord));
          kbTitles.push(kbDraft.title); // prevent dups within same batch
          results.push({ ticketId: ticket.id, draftId, title: kbDraft.title, confidence: kbDraft.confidence || 75, status: "draft_created" });
        } catch (err) {
          results.push({ ticketId: ticket.id, status: "error", error: err.message });
        }
      }

      console.log(`[AI KB Batch] Generated ${results.filter(r => r.status === "draft_created").length} drafts from ${candidates.length} candidates`);
      return json(res, 200, { success: true, generated: results.filter(r => r.status === "draft_created").length, skipped: results.filter(r => r.status === "skipped_duplicate").length, errors: results.filter(r => r.status === "error").length, results });
    } catch (err) {
      console.error("[AI KB Batch]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Phase 4: AI Daily Briefing + Shift Handover ────────────────────
  // POST /api/ai/daily-briefing — generate AI daily briefing report
  if (pathname === "/api/ai/daily-briefing" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 50000);
      const { requestedBy, shift, recipients, incidents: clientIncidents, changes: clientChanges, requests: clientRequests } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });

      const allInc = clientIncidents || [];
      const allChanges = clientChanges || [];
      const allReqs = clientRequests || [];

      const now = new Date();
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

      // Gather AI actions stats
      const aiActionsRows = await db.getAll("ai_actions");
      const recentActions = aiActionsRows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      const pendingActions = recentActions.filter(a => a.status === "pending_approval").length;
      const autoApplied = recentActions.filter(a => a.status === "auto_applied").length;

      const openInc = allInc.filter(i => !["Resolved", "Closed"].includes(i.status));
      const criticalOpen = openInc.filter(i => i.priority === "Sev-A" || i.priority === "Sev-B");
      const resolvedRecent = allInc.filter(i => (i.status === "Resolved" || i.status === "Closed"));

      // Business-hours SLA breach calculation for briefing
      const computeBriefingSla = (inc) => {
        const target = inc.slaTarget || 9;
        let elapsed = 0;
        if (inc.createdAt) {
          const start = new Date(inc.createdAt);
          if (!isNaN(start.getTime())) {
            const endTime = (inc.status === "Resolved" || inc.status === "Closed") && inc.resolvedAt ? new Date(inc.resolvedAt) : now;
            const BH_START = 9, BH_END = 18;
            let cursor = new Date(start);
            while (cursor < endTime) {
              const day = cursor.getDay();
              if (day >= 1 && day <= 5) {
                const hrs = cursor.getHours() + cursor.getMinutes() / 60;
                if (hrs >= BH_START && hrs < BH_END) {
                  const eob = new Date(cursor); eob.setHours(BH_END, 0, 0, 0);
                  const chunk = eob < endTime ? eob : endTime;
                  elapsed += (chunk - cursor) / 3600000;
                  cursor = new Date(chunk);
                } else if (hrs < BH_START) { cursor.setHours(BH_START, 0, 0, 0); }
                else { cursor.setDate(cursor.getDate() + 1); cursor.setHours(BH_START, 0, 0, 0); }
              } else {
                const daysToMon = day === 0 ? 1 : 8 - day;
                cursor.setDate(cursor.getDate() + daysToMon); cursor.setHours(BH_START, 0, 0, 0);
              }
              if (cursor >= endTime) break;
            }
          } else { elapsed = inc.created || 0; }
        } else { elapsed = inc.created || 0; }
        return elapsed > target;
      };
      const totalSLABreaches = openInc.filter(i => computeBriefingSla(i)).length;

      const dataSummary = `ITSM Overview (${now.toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}):\n- Total Incidents: ${allInc.length}\n- Open: ${openInc.length} (${criticalOpen.length} critical/high)\n- Resolved: ${resolvedRecent.length}\n- SLA Breaches: ${totalSLABreaches}\n- Open Requests: ${allReqs.filter(r => r.status !== "Completed" && r.status !== "Closed").length}\n- Scheduled Changes: ${allChanges.filter(c => c.status === "Scheduled" || c.status === "Approved").length}\n- AI Actions Pending: ${pendingActions}\n- AI Auto-Applied: ${autoApplied}\n\nCritical Items:\n${criticalOpen.map(i => `- ${i.id}: "${i.title}" [${i.priority}] assigned to ${i.assignee || "Unassigned"}, SLA ${Math.round((i.created / (i.slaTarget || 9)) * 100)}%`).join("\n") || "None"}`;

      const systemPrompt = `You are VGC Technology's ITSM briefing AI. Generate a concise, actionable ${shift || "daily"} briefing for the IT operations team. Format with clear sections. Be direct — highlight risks, blockers, and actions needed. Return JSON ONLY: { "executiveSummary": "2-3 sentence overview", "criticalItems": [{ "id": "ticket ID", "issue": "brief", "action": "needed action" }], "slaStatus": "overall SLA health description", "handoverNotes": "key things for next shift", "actionItems": ["action 1", "action 2"], "upcomingChanges": "scheduled changes summary", "aiInsights": "any AI-detected patterns or recommendations", "riskLevel": "low|medium|high|critical" }`;

      const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: dataSummary }], max_output_tokens: 2000 };
      const aiUrl = new URL(ctx.AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({ hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search, method: "POST", headers: { "Content-Type": "application/json", "api-key": ctx.AZURE_OPENAI_KEY } }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => { if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data)); else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`)); });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(30000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let briefing;
      try {
        briefing = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      } catch {
        briefing = { executiveSummary: text.substring(0, 500), criticalItems: [], slaStatus: "Unknown", handoverNotes: "", actionItems: [], riskLevel: "medium" };
      }

      const briefingId = `BRF-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
      const briefingRecord = {
        id: briefingId,
        ...briefing,
        generatedAt: now.toISOString(),
        generatedBy: requestedBy,
        shift: shift || "daily",
        recipients: recipients || [],
        stats: { totalIncidents: allInc.length, openIncidents: openInc.length, criticalOpen: criticalOpen.length, slaBreaches: totalSLABreaches, pendingAiActions: pendingActions },
      };

      await db.upsert("ai_briefings", briefingId, JSON.stringify(briefingRecord));

      // Send email if recipients provided and graphSendMail available
      if (recipients && recipients.length > 0) {
        const riskColors = { critical: "#FF4444", high: "#FF6B6B", medium: "#FFB347", low: "#81C784" };
        const emailBody = `<div style="font-family:Segoe UI,sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#6366F1">🤖 VGC ITSM Daily Briefing</h2><div style="background:#f8f9fa;padding:16px;border-radius:8px;margin-bottom:16px;border-left:4px solid ${riskColors[briefing.riskLevel] || "#6366F1"}"><strong>Risk Level:</strong> <span style="color:${riskColors[briefing.riskLevel] || "#333"};font-weight:700;text-transform:uppercase">${briefing.riskLevel || "medium"}</span><br><br>${briefing.executiveSummary || ""}</div><h3>📊 SLA Status</h3><p>${briefing.slaStatus || "N/A"}</p><h3>⚡ Action Items</h3><ul>${(briefing.actionItems || []).map(a => `<li>${a}</li>`).join("")}</ul><h3>📋 Handover Notes</h3><p>${briefing.handoverNotes || "None"}</p><h3>🤖 AI Insights</h3><p>${briefing.aiInsights || "No patterns detected"}</p><hr><p style="font-size:11px;color:#888">Generated by VGC AI Engine · ${now.toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}</p></div>`;
        try {
          await graphSendMail({ to: recipients, subject: `[VGC ITSM] ${shift || "Daily"} Briefing — Risk: ${(briefing.riskLevel || "medium").toUpperCase()}`, body: emailBody });
        } catch (emailErr) {
          console.error("[AI Briefing] Email send failed:", emailErr.message);
        }
      }

      console.log(`[AI Briefing] Generated ${briefingId} (${briefing.riskLevel}) by ${requestedBy}`);
      return json(res, 200, { success: true, briefingId, briefing: briefingRecord });
    } catch (err) {
      console.error("[AI Briefing]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // GET /api/ai/briefings — list past briefings
  if (pathname === "/api/ai/briefings" && req.method === "GET") {
    try {
      const rows = await db.getAll("ai_briefings");
      const briefings = rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      briefings.sort((a, b) => (b.generatedAt || "").localeCompare(a.generatedAt || ""));
      return json(res, 200, { briefings });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ─── Phase 5: AI Pattern Detection + Proactive Prevention ──────────
  // POST /api/ai/pattern-detect — analyze historical data for recurring patterns
  if (pathname === "/api/ai/pattern-detect" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 200000);
      const { incidents: clientIncidents, problems: clientProblems, changes: clientChanges, requestedBy } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });

      const allInc = clientIncidents || [];
      const allProblems = clientProblems || [];

      // Group incidents by category, subcategory, asset, customer
      const byCategory = {};
      const byAsset = {};
      const byCustomer = {};
      allInc.forEach(inc => {
        const cat = inc.category || "Other";
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(inc);
        if (inc.affectedAsset) {
          if (!byAsset[inc.affectedAsset]) byAsset[inc.affectedAsset] = [];
          byAsset[inc.affectedAsset].push(inc);
        }
        if (inc.customer) {
          if (!byCustomer[inc.customer]) byCustomer[inc.customer] = [];
          byCustomer[inc.customer].push(inc);
        }
      });

      const categorySummary = Object.entries(byCategory).map(([cat, incs]) => `${cat}: ${incs.length} incidents (${incs.filter(i => i.priority === "Sev-A" || i.priority === "Sev-B").length} critical/high)`).join("\n");
      const assetSummary = Object.entries(byAsset).filter(([, incs]) => incs.length >= 2).map(([asset, incs]) => `${asset}: ${incs.length} incidents`).join("\n");
      const customerSummary = Object.entries(byCustomer).filter(([, incs]) => incs.length >= 2).map(([cust, incs]) => `${cust}: ${incs.length} incidents`).join("\n");
      const problemSummary = allProblems.map(p => `${p.id}: "${p.title}" [${p.status}] Category:${p.category} LinkedIncidents:${(p.linkedIncidents || []).length}`).join("\n");

      const systemPrompt = `You are VGC Technology's pattern detection AI. Analyze historical ITSM data to find recurring patterns, correlations, seasonal trends, and predict future incidents. Focus on: (1) Recurring issues (same category/asset/customer), (2) Correlated incidents (related failures), (3) Trending issues (increasing frequency), (4) Seasonal patterns (time-based), (5) Asset health concerns. Return JSON array ONLY: [{ "patternId": "PAT-XXX", "type": "recurring|correlated|trending|seasonal|asset_health", "title": "pattern title", "description": "detailed explanation", "frequency": "how often", "affectedAssets": [], "affectedCustomers": [], "confidence": 0-100, "suggestedPrevention": "what to do", "estimatedImpact": "impact description", "nextPredictedOccurrence": "when likely next", "relatedIncidents": ["INC-XXX"] }]. Return max 10 patterns, sorted by confidence.`;

      const userPrompt = `Historical Data (${allInc.length} incidents, ${allProblems.length} problems):\n\nBy Category:\n${categorySummary}\n\nRepeat Assets:\n${assetSummary || "None"}\n\nRepeat Customers:\n${customerSummary || "None"}\n\nExisting Problems:\n${problemSummary || "None"}\n\nDetect patterns and predict future incidents.`;

      const payload = { model: getAIModel("secondary"), input: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], max_output_tokens: 2000 };
      const aiUrl = new URL(ctx.AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({ hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search, method: "POST", headers: { "Content-Type": "application/json", "api-key": ctx.AZURE_OPENAI_KEY } }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => { if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data)); else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`)); });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(45000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let patterns;
      try {
        patterns = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
        if (!Array.isArray(patterns)) patterns = [patterns];
      } catch { patterns = []; }

      const now = new Date().toISOString();
      const actions = [];
      // Unified dedup: use shared helper + per-incident/total cap + title dedup
      const dedupState = await getAiActionsDedupState();
      for (const pat of patterns) {
        const patId = pat.patternId || `PAT-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
        pat.id = patId;
        pat.detectedAt = now;
        pat.detectedBy = requestedBy;
        pat.status = "active";
        await db.upsert("ai_patterns", patId, JSON.stringify(pat));

        if ((pat.confidence || 0) >= AI_THRESHOLDS.patternConfidence) {
          const actionTitle = `Pattern: ${pat.title}`;
          const skipReason = shouldSkipAction(dedupState, { type: "preventive_action", title: actionTitle });
          if (skipReason) { console.log(`[AI Patterns] Skipped "${pat.title}": ${skipReason}`); continue; }
          const actionRecord = {
            id: `PRA-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
            type: "preventive_action",
            severity: pat.confidence >= 90 ? "critical" : "high",
            title: actionTitle,
            description: pat.description,
            patternId: patId,
            suggestedAction: pat.suggestedPrevention || "Investigate pattern",
            estimatedImpact: pat.estimatedImpact || "",
            confidence: pat.confidence,
            autoExecutable: false,
            status: "pending_approval",
            createdAt: now,
            createdBy: "AI Pattern Detection Engine",
            requestedBy,
          };
          await db.upsert("ai_actions", actionRecord.id, JSON.stringify(actionRecord));
          trackNewAction(dedupState, { type: "preventive_action", title: actionTitle });
          actions.push(actionRecord);
        }
      }

      console.log(`[AI Patterns] Detected ${patterns.length} patterns, created ${actions.length} actions`);
      return json(res, 200, { patterns, actions, count: patterns.length });
    } catch (err) {
      console.error("[AI Pattern Detect]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // GET /api/ai/patterns — list detected patterns
  if (pathname === "/api/ai/patterns" && req.method === "GET") {
    try {
      const rows = await db.getAll("ai_patterns");
      const patterns = rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      patterns.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      return json(res, 200, { patterns });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/patterns/:id/create-problem — convert pattern to Problem record
  if (pathname.match(/^\/api\/ai\/patterns\/[^/]+\/create-problem$/) && req.method === "POST") {
    try {
      const patternId = pathname.split("/")[4];
      const body = await parseBody(req, 10000);
      const { requestedBy } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });

      const row = await db.getOne("ai_patterns", patternId);
      if (!row) return json(res, 404, { error: "Pattern not found" });
      const pattern = JSON.parse(row.data);

      const now = new Date().toISOString();
      const actionRecord = {
        id: `PPC-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        type: "create_problem",
        severity: pattern.confidence >= 90 ? "critical" : "high",
        title: `Create Problem: ${pattern.title}`,
        description: `Based on detected pattern: ${pattern.description}`,
        patternId,
        suggestedAction: `Create Problem record from pattern "${pattern.title}"`,
        problemDraft: {
          title: `[AI Pattern] ${pattern.title}`,
          category: pattern.type || "Recurring",
          priority: pattern.confidence >= 90 ? "Sev-A" : "Sev-B",
          description: `AI-detected pattern: ${pattern.description}\n\nSuggested Prevention: ${pattern.suggestedPrevention || "N/A"}\n\nEstimated Impact: ${pattern.estimatedImpact || "N/A"}\n\nFrequency: ${pattern.frequency || "Unknown"}`,
          linkedIncidents: pattern.relatedIncidents || [],
          rootCause: pattern.suggestedPrevention || "",
          affectedAssets: pattern.affectedAssets || [],
        },
        confidence: pattern.confidence,
        autoExecutable: false,
        status: "pending_approval",
        createdAt: now,
        createdBy: "AI Pattern Detection Engine",
        requestedBy,
      };

      await db.upsert("ai_actions", actionRecord.id, JSON.stringify(actionRecord));
      console.log(`[AI Patterns] Created problem action for pattern ${patternId}`);
      return json(res, 200, { success: true, actionId: actionRecord.id, problemDraft: actionRecord.problemDraft });
    } catch (err) {
      console.error("[AI Pattern Create Problem]", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ─── AI Actions Engine: Proactive Monitor + Approval Workflow ────────
  // POST /api/ai/actions/scan — AI scans all open incidents/tickets for critical cases, generates action items
  if (pathname === "/api/ai/actions/scan" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_KEY || !ctx.AZURE_OPENAI_ENDPOINT) {
      return json(res, 503, { error: "Azure OpenAI not configured" });
    }
    try {
      const body = await parseBody(req, 100000);
      const { incidents: clientIncidents, changes: clientChanges, requestedBy } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy (Entra user) required" });
      const allIncidents = clientIncidents || [];
      const allChanges = clientChanges || [];

      // Filter critical/high priority open incidents
      const critical = allIncidents.filter(i =>
        (i.status === "Open" || i.status === "In Progress") &&
        (i.priority === "Sev-A" || i.priority === "Sev-B")
      );
      // SLA at-risk items
      const slaAtRisk = allIncidents.filter(i =>
        (i.status === "Open" || i.status === "In Progress") &&
        i.created && i.slaTarget && (i.created / i.slaTarget) >= 0.8
      );
      // Pending changes needing attention
      const pendingChanges = allChanges.filter(c => c.status === "Awaiting Approval" || c.status === "Implementing");

      if (critical.length === 0 && slaAtRisk.length === 0 && pendingChanges.length === 0) {
        return json(res, 200, { actions: [], message: "No critical items requiring AI action" });
      }

      const contextSummary = [
        critical.length > 0 ? `CRITICAL INCIDENTS (${critical.length}):\n${critical.map(i => `- ${i.id}: ${i.title} [${i.priority}] assigned:${i.assignee||'Unassigned'} SLA:${i.slaTarget}h status:${i.status} category:${i.category}`).join("\n")}` : "",
        slaAtRisk.length > 0 ? `SLA AT-RISK (${slaAtRisk.length}):\n${slaAtRisk.map(i => `- ${i.id}: ${i.title} [${i.priority}] SLA ${Math.round((i.created/i.slaTarget)*100)}% elapsed`).join("\n")}` : "",
        pendingChanges.length > 0 ? `PENDING CHANGES (${pendingChanges.length}):\n${pendingChanges.map(c => `- ${c.id}: ${c.title} [${c.status}] risk:${c.risk}`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n");

      const systemPrompt = `You are VGC-ITSM AI Assist Engine for VGC Technology Pte Ltd. Analyze the following ITSM data and generate a JSON array of action items that need human approval.

For each action, provide:
- id: unique action ID (format: AIA-<timestamp>-<seq>)
- type: one of "escalation", "notification", "assignment", "sla_warning", "follow_up", "change_review", "internal_note"
- severity: "critical", "high", "medium", "low"
- title: short action title (max 80 chars)
- description: detailed description of what needs to happen
- incidentId: related incident/change ID
- suggestedAction: exactly what AI recommends doing
- emailDraft: if type involves notification, include a draft email { to, subject, body }
- internalNote: note for the internal team only (never shown to customers)
- confidence: 0-100
- autoExecutable: true only for low-risk, routine actions (SLA warnings, internal notes, routine follow-ups). false for escalations, customer-facing, financial, or irreversible actions.
- reasoning: brief explanation of why this action is recommended

RULES:
- NEVER auto-execute customer-facing actions. All customer emails require human approval.
- Mark escalation actions as critical severity.
- For SLA at-risk items, suggest proactive customer notification.
- For unassigned critical tickets, suggest immediate assignment.
- Generate internal notes with clear action items for the team.
- All actions must be approvable/rejectable by any Entra-authenticated user.

Respond ONLY with a valid JSON array. No markdown wrapping.`;

      const payload = {
        model: getAIModel("secondary"),
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Current time: ${new Date().toISOString()}\nRequested by: ${requestedBy}\n\n${contextSummary}` }
        ],
        max_output_tokens: 2000
      };

      const aiUrl = new URL(ctx.AZURE_OPENAI_ENDPOINT);
      const aiResult = await new Promise((resolve, reject) => {
        const aiReq = https.request({
          hostname: aiUrl.hostname, port: 443, path: aiUrl.pathname + aiUrl.search,
          method: "POST", headers: { "Content-Type": "application/json", "api-key": ctx.AZURE_OPENAI_KEY },
        }, (aiRes) => {
          let data = ""; aiRes.on("data", c => data += c);
          aiRes.on("end", () => {
            if (aiRes.statusCode >= 200 && aiRes.statusCode < 300) resolve(JSON.parse(data));
            else reject(new Error(`AI ${aiRes.statusCode}: ${data.substring(0, 500)}`));
          });
        });
        aiReq.on("error", reject);
        aiReq.setTimeout(45000, () => { aiReq.destroy(); reject(new Error("AI timeout")); });
        aiReq.write(JSON.stringify(payload));
        aiReq.end();
      });

      const text = extractAIText(aiResult);
      let actions;
      try {
        actions = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
        if (!Array.isArray(actions)) actions = [actions];
      } catch {
        actions = [];
      }

      // Stamp each action with metadata and save to DB
      const now = new Date().toISOString();
      const savedActions = [];
      // Unified dedup: use shared helper — per-incident cap + type:incident + total cap
      const dedupState = await getAiActionsDedupState();
      let skippedCount = 0;
      for (const action of actions) {
        const skipReason = shouldSkipAction(dedupState, { incidentId: action.incidentId, type: action.type, title: action.title });
        if (skipReason) { skippedCount++; continue; }
        const actionId = action.id || `AIA-${Date.now().toString(36)}-${Math.random().toString(36).substring(2,6)}`;
        const record = {
          ...action,
          id: actionId,
          status: "pending_approval",
          createdAt: now,
          createdBy: "AI Assist Engine",
          requestedBy,
          approvedBy: null,
          approvedAt: null,
          executedAt: null,
          executionResult: null,
        };
        await db.upsert("ai_actions", actionId, JSON.stringify(record));
        trackNewAction(dedupState, { incidentId: action.incidentId, type: action.type, title: action.title });
        savedActions.push(record);
      }
      if (skippedCount > 0) console.log(`[AI Actions] Skipped ${skippedCount} actions (dedup/cap)`);

      console.log(`[AI Actions] Scan generated ${savedActions.length} action items for ${requestedBy}`);
      return json(res, 200, { actions: savedActions, scannedAt: now, criticalCount: critical.length, slaAtRiskCount: slaAtRisk.length });
    } catch (err) {
      console.error("[AI Actions Scan]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // GET /api/ai/actions — list all AI action items (with optional status filter)
  if (pathname === "/api/ai/actions" && req.method === "GET") {
    try {
      const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const statusFilter = qs.get("status"); // pending_approval, approved, rejected, executed
      const allRaw = await db.getAll("ai_actions");
      let actions = allRaw.map(r => { try { return JSON.parse(r.data); } catch { return null; } }).filter(Boolean);
      if (statusFilter) actions = actions.filter(a => a.status === statusFilter);
      actions.sort((a, b) => {
        const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return (sevOrder[a.severity] || 3) - (sevOrder[b.severity] || 3);
      });
      return json(res, 200, { actions, total: actions.length });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/actions/:id/approve — approve an AI action (requires Entra user)
  if (pathname.match(/^\/api\/ai\/actions\/([^/]+)\/approve$/) && req.method === "POST") {
    const actionId = pathname.match(/^\/api\/ai\/actions\/([^/]+)\/approve$/)[1];
    try {
      const body = await parseBody(req);
      const { approvedBy, approverEmail } = body;
      if (!approvedBy) return json(res, 400, { error: "approvedBy (Entra user name) required" });

      const existing = await db.getOne("ai_actions", actionId);
      if (!existing) return json(res, 404, { error: "Action not found" });
      const action = JSON.parse(existing.data);
      if (action.status !== "pending_approval") {
        return json(res, 409, { error: `Action already ${action.status}` });
      }

      action.status = "approved";
      action.approvedBy = approvedBy;
      action.approverEmail = approverEmail || "";
      action.approvedAt = new Date().toISOString();
      await db.upsert("ai_actions", actionId, JSON.stringify(action));

      console.log(`[AI Actions] Action ${actionId} APPROVED by ${approvedBy}`);

      // Auto-execute if the action is a notification/internal_note type
      let executionResult = null;
      if (action.type === "notification" && action.emailDraft) {
        try {
          const draft = action.emailDraft;
          if (draft.to && draft.subject && draft.body) {
            await graphSendMail({
              to: draft.to,
              subject: draft.subject,
              body: `<div style="font-family:Arial,sans-serif;max-width:650px;">
                ${draft.body.replace(/\n/g, "<br/>")}
                <hr style="border:none;border-top:1px solid #eee;margin:20px 0;"/>
                <p style="color:#888;font-size:11px;">This notification was generated by VGC AI Assist and approved by ${approvedBy}.<br/>
                Action ID: ${actionId} | ${new Date().toISOString()}<br/>
                VGC Technology Pte Ltd — IT Service Management</p>
              </div>`
            });
            executionResult = { emailSent: true, to: draft.to };
          }
        } catch (emailErr) {
          executionResult = { emailSent: false, error: emailErr.message };
        }
      }
      if (action.type === "internal_note" && action.incidentId) {
        executionResult = { noteAdded: true, incidentId: action.incidentId, note: action.suggestedAction };
      }

      if (executionResult) {
        action.status = "executed";
        action.executedAt = new Date().toISOString();
        action.executionResult = executionResult;
        await db.upsert("ai_actions", actionId, JSON.stringify(action));
      }

      // Send confirmation email to approver
      if (approverEmail) {
        try {
          await graphSendMail({
            to: approverEmail,
            subject: `[VGC AI Assist] Action Approved: ${action.title}`,
            body: `<div style="font-family:Arial,sans-serif;max-width:600px;">
              <div style="background:linear-gradient(135deg,#4CAF50,#06B6D4);padding:16px 20px;border-radius:8px 8px 0 0;">
                <h2 style="margin:0;color:#fff;font-size:18px;">✅ AI Action Approved</h2>
              </div>
              <div style="background:#f8f9fa;padding:20px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px;">
                <p style="margin:0 0 12px;color:#333;"><strong>Action:</strong> ${action.title}</p>
                <p style="margin:0 0 12px;color:#333;"><strong>Type:</strong> ${action.type} | <strong>Severity:</strong> ${action.severity}</p>
                <p style="margin:0 0 12px;color:#333;"><strong>Approved by:</strong> ${approvedBy}</p>
                <p style="margin:0 0 12px;color:#333;"><strong>Status:</strong> ${action.status === "executed" ? "Executed Successfully" : "Approved — Awaiting Execution"}</p>
                ${executionResult ? `<p style="margin:0 0 12px;color:#333;"><strong>Result:</strong> ${JSON.stringify(executionResult)}</p>` : ""}
                <p style="margin:0 0 12px;color:#666;"><strong>Description:</strong> ${action.description}</p>
                <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;"/>
                <p style="color:#888;font-size:11px;">VGC AI Assist — All actions are logged and auditable.<br/>Action ID: ${actionId}</p>
              </div>
            </div>`
          });
        } catch (e) { console.warn("[AI Actions] Confirmation email failed:", e.message); }
      }

      return json(res, 200, { success: true, action, executionResult });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/actions/:id/reject — reject an AI action
  if (pathname.match(/^\/api\/ai\/actions\/([^/]+)\/reject$/) && req.method === "POST") {
    const actionId = pathname.match(/^\/api\/ai\/actions\/([^/]+)\/reject$/)[1];
    try {
      const body = await parseBody(req);
      const { rejectedBy, reason } = body;
      if (!rejectedBy) return json(res, 400, { error: "rejectedBy required" });

      const existing = await db.getOne("ai_actions", actionId);
      if (!existing) return json(res, 404, { error: "Action not found" });
      const action = JSON.parse(existing.data);
      if (action.status !== "pending_approval") {
        return json(res, 409, { error: `Action already ${action.status}` });
      }

      action.status = "rejected";
      action.rejectedBy = rejectedBy;
      action.rejectedAt = new Date().toISOString();
      action.rejectionReason = reason || "";
      await db.upsert("ai_actions", actionId, JSON.stringify(action));

      console.log(`[AI Actions] Action ${actionId} REJECTED by ${rejectedBy}: ${reason || "No reason"}`);
      return json(res, 200, { success: true, action });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/actions/:id/execute — execute an approved action
  if (pathname.match(/^\/api\/ai\/actions\/([^/]+)\/execute$/) && req.method === "POST") {
    const actionId = pathname.match(/^\/api\/ai\/actions\/([^/]+)\/execute$/)[1];
    try {
      const body = await parseBody(req);
      const { executedBy } = body;
      if (!executedBy) return json(res, 400, { error: "executedBy required" });

      const existing = await db.getOne("ai_actions", actionId);
      if (!existing) return json(res, 404, { error: "Action not found" });
      const action = JSON.parse(existing.data);
      if (action.status !== "approved") {
        return json(res, 409, { error: `Action must be approved first (current: ${action.status})` });
      }

      let executionResult = { success: true };

      // Execute based on action type
      if (action.type === "notification" && action.emailDraft) {
        const draft = action.emailDraft;
        if (draft.to && draft.subject && draft.body) {
          try {
            await graphSendMail({
              to: draft.to,
              subject: draft.subject,
              body: `<div style="font-family:Arial,sans-serif;max-width:650px;">
                ${draft.body.replace(/\n/g, "<br/>")}
                <hr style="border:none;border-top:1px solid #eee;margin:20px 0;"/>
                <p style="color:#888;font-size:11px;">Sent by VGC AI Assist, approved by ${action.approvedBy}.<br/>
                Action ID: ${actionId}<br/>VGC Technology — IT Service Management</p>
              </div>`
            });
            executionResult = { emailSent: true, to: draft.to };
          } catch (emailErr) {
            executionResult = { emailSent: false, error: emailErr.message };
          }
        }
      } else if (action.type === "follow_up") {
        executionResult = { followUpScheduled: true, incidentId: action.incidentId, note: action.suggestedAction };
      } else if (action.type === "internal_note") {
        executionResult = { noteAdded: true, incidentId: action.incidentId, note: action.suggestedAction };
      }

      action.status = "executed";
      action.executedBy = executedBy;
      action.executedAt = new Date().toISOString();
      action.executionResult = executionResult;
      await db.upsert("ai_actions", actionId, JSON.stringify(action));

      console.log(`[AI Actions] Action ${actionId} EXECUTED by ${executedBy}:`, executionResult);
      return json(res, 200, { success: true, action, executionResult });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/ai/actions/send-approval-email — send approval request via Outlook
  if (pathname === "/api/ai/actions/send-approval-email" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const { actionId, approverEmails, appUrl } = body;
      if (!actionId || !approverEmails) return json(res, 400, { error: "actionId and approverEmails required" });

      const existing = await db.getOne("ai_actions", actionId);
      if (!existing) return json(res, 404, { error: "Action not found" });
      const action = JSON.parse(existing.data);
      const baseUrl = appUrl || "https://vgc-itsm1-app.azurewebsites.net";

      const severityColor = { critical: "#FF4444", high: "#FF8800", medium: "#FFB347", low: "#4CAF50" };
      const sevColor = severityColor[action.severity] || "#666";

      const emailBody = `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:650px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:20px 24px;border-radius:10px 10px 0 0;">
          <h2 style="margin:0;color:#fff;font-size:20px;">🤖 VGC AI Assist — Action Requires Your Approval</h2>
          <p style="margin:6px 0 0;color:#8B8FA3;font-size:13px;">AI has identified an action that needs engineer review</p>
        </div>
        <div style="background:#ffffff;padding:24px;border:1px solid #e0e0e0;border-top:none;">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
            <span style="display:inline-block;padding:4px 12px;border-radius:20px;background:${sevColor}22;color:${sevColor};font-weight:700;font-size:12px;text-transform:uppercase;">${action.severity}</span>
            <span style="display:inline-block;padding:4px 12px;border-radius:20px;background:#6366F122;color:#6366F1;font-weight:600;font-size:12px;">${action.type}</span>
            ${action.incidentId ? `<span style="display:inline-block;padding:4px 12px;border-radius:20px;background:#EC489922;color:#EC4899;font-weight:600;font-size:12px;">🎫 ${action.incidentId}</span>` : ""}
          </div>
          <h3 style="margin:0 0 12px;color:#1a1a2e;font-size:17px;">${action.title}</h3>
          <p style="margin:0 0 16px;color:#444;font-size:14px;line-height:1.6;">${action.description}</p>
          <div style="background:#f0f4ff;padding:14px 16px;border-radius:8px;border-left:4px solid #6366F1;margin:16px 0;">
            <p style="margin:0 0 4px;color:#6366F1;font-weight:700;font-size:13px;">💡 AI Suggested Action:</p>
            <p style="margin:0;color:#333;font-size:13px;line-height:1.5;">${action.suggestedAction || action.description}</p>
          </div>
          ${action.internalNote ? `<div style="background:#FFF8E1;padding:14px 16px;border-radius:8px;border-left:4px solid #FFB347;margin:16px 0;">
            <p style="margin:0 0 4px;color:#F57C00;font-weight:700;font-size:13px;">📋 Internal Note:</p>
            <p style="margin:0;color:#555;font-size:13px;line-height:1.5;">${action.internalNote}</p>
          </div>` : ""}
          <p style="margin:16px 0 8px;color:#333;font-size:13px;"><strong>AI Confidence:</strong> ${action.confidence || "N/A"}%</p>
          <p style="margin:0 0 20px;color:#333;font-size:13px;"><strong>Reasoning:</strong> ${action.reasoning || "Based on severity and SLA analysis"}</p>
          <div style="text-align:center;margin:24px 0 16px;">
            <p style="color:#666;font-size:13px;margin:0 0 12px;">Please review and take action in VGC ITSM:</p>
            <a href="${baseUrl}/#ai-actions" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#4CAF50,#45a049);color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;margin:0 8px;">✅ Review & Approve</a>
            <a href="${baseUrl}/#ai-actions" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#FF5252,#f44336);color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;margin:0 8px;">❌ Review & Reject</a>
          </div>
          <p style="text-align:center;color:#999;font-size:11px;margin-top:8px;">Click either button to open VGC ITSM and review the full action details</p>
        </div>
        <div style="background:#f8f9fa;padding:14px 24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 10px 10px;">
          <p style="margin:0;color:#999;font-size:11px;">VGC AI Assist — All actions require human approval before execution.<br/>
          Action ID: ${actionId} | Generated: ${action.createdAt}<br/>
          VGC Technology Pte Ltd — IT Service Management</p>
        </div>
      </div>`;

      const recipients = Array.isArray(approverEmails) ? approverEmails : [approverEmails];
      await graphSendMail({
        to: recipients,
        subject: `[Action Required] 🤖 AI Assist: ${action.severity.toUpperCase()} — ${action.title}`,
        body: emailBody
      });

      console.log(`[AI Actions] Approval email sent to ${recipients.join(", ")} for action ${actionId}`);
      return json(res, 200, { success: true, sentTo: recipients, actionId });
    } catch (err) {
      console.error("[AI Actions Email]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // POST /api/ai/actions/monitor — background AI monitor: scan + auto-email approvers for critical items
  if (pathname === "/api/ai/actions/monitor" && req.method === "POST") {
    try {
      const body = await parseBody(req, 200000);
      const { incidents: clientIncidents, changes: clientChanges, requestedBy, approverEmails, appUrl } = body;
      if (!requestedBy) return json(res, 400, { error: "requestedBy required" });

      // Step 1: Run AI scan
      const allIncidents = clientIncidents || [];
      const allChanges = clientChanges || [];
      const critical = allIncidents.filter(i =>
        (i.status === "Open" || i.status === "In Progress") &&
        (i.priority === "Sev-A" || i.priority === "Sev-B")
      );
      const slaAtRisk = allIncidents.filter(i =>
        (i.status === "Open" || i.status === "In Progress") &&
        i.created && i.slaTarget && (i.created / i.slaTarget) >= 0.8
      );

      if (critical.length === 0 && slaAtRisk.length === 0) {
        return json(res, 200, { actions: [], message: "All clear — no critical items detected", monitoredAt: new Date().toISOString() });
      }

      // Step 2: Generate actions via AI (reuse scan logic internally)
      const scanPayload = JSON.stringify({ incidents: clientIncidents, changes: clientChanges, requestedBy });
      const scanResult = await new Promise((resolve, reject) => {
        const scanReq = require("http").request({
          hostname: "localhost", port: PORT,
          path: "/api/ai/actions/scan", method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(scanPayload) }
        }, (r) => {
          let data = ""; r.on("data", c => data += c);
          r.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({ actions: [] }); } });
        });
        scanReq.on("error", reject);
        scanReq.setTimeout(50000, () => { scanReq.destroy(); reject(new Error("Monitor scan timeout")); });
        scanReq.write(scanPayload);
        scanReq.end();
      });

      const actions = scanResult.actions || [];

      // Step 3: Email approvers for critical/high actions
      let emailsSent = 0;
      if (approverEmails && actions.length > 0) {
        const criticalActions = actions.filter(a => a.severity === "critical" || a.severity === "high");
        for (const action of criticalActions.slice(0, 5)) { // max 5 emails per scan
          try {
            const emailPayload = JSON.stringify({ actionId: action.id, approverEmails, appUrl });
            await new Promise((resolve, reject) => {
              const eReq = require("http").request({
                hostname: "localhost", port: PORT,
                path: "/api/ai/actions/send-approval-email", method: "POST",
                headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(emailPayload) }
              }, (r) => {
                let data = ""; r.on("data", c => data += c);
                r.on("end", () => resolve(data));
              });
              eReq.on("error", reject);
              eReq.setTimeout(20000, () => { eReq.destroy(); reject(new Error("Email timeout")); });
              eReq.write(emailPayload);
              eReq.end();
            });
            emailsSent++;
          } catch (e) { console.warn("[AI Monitor] Email failed for action", action.id, e.message); }
        }
      }

      console.log(`[AI Monitor] Scan complete: ${actions.length} actions, ${emailsSent} approval emails sent`);
      return json(res, 200, {
        actions,
        totalActions: actions.length,
        emailsSent,
        monitoredAt: new Date().toISOString(),
        criticalIncidents: critical.length,
        slaAtRisk: slaAtRisk.length
      });
    } catch (err) {
      console.error("[AI Monitor]", err.message);
      return json(res, 502, { error: err.message });
    }
  }

  // ─── Azure Infrastructure Resources (Live from ARM API) ───────────────
  if (pathname === "/api/azure/resources") {
    try {
      const token = await getManagedIdentityToken("https://management.azure.com");
      const subId = AZURE_SUBSCRIPTION_ID;
      const rg = AZURE_RESOURCE_GROUP;
      if (!subId) return json(res, 200, { live: false, error: "AZURE_SUBSCRIPTION_ID not configured", resources: [] });

      const armGet = (urlPath) => new Promise((resolve, reject) => {
        const url = `https://management.azure.com${urlPath}`;
        const req = https.get(url, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }, (resp) => {
          let data = "";
          resp.on("data", c => data += c);
          resp.on("end", () => { try { resolve(JSON.parse(data)); } catch { reject(new Error("ARM parse error")); } });
        });
        req.on("error", reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error("ARM timeout")); });
      });

      // Fetch resources in the resource group
      const rgResources = await armGet(`/subscriptions/${subId}/resourceGroups/${rg}/resources?api-version=2021-04-01`);
      const resources = (rgResources.value || []).map(r => ({
        id: r.id, name: r.name, type: r.type, location: r.location, kind: r.kind,
        sku: r.sku, tags: r.tags,
      }));

      // Try to get App Service Plan details
      let appServicePlan = null;
      const plans = resources.filter(r => r.type === "Microsoft.Web/serverfarms");
      if (plans.length > 0) {
        try {
          const planDetail = await armGet(`${plans[0].id}?api-version=2022-03-01`);
          appServicePlan = {
            name: planDetail.name, sku: planDetail.sku, kind: planDetail.kind,
            status: planDetail.properties?.status, numberOfSites: planDetail.properties?.numberOfSites,
            tier: planDetail.sku?.tier, size: planDetail.sku?.size, capacity: planDetail.sku?.capacity,
          };
        } catch {}
      }

      // Try to get Web App details
      let webApp = null;
      const webApps = resources.filter(r => r.type === "Microsoft.Web/sites");
      if (webApps.length > 0) {
        try {
          const appDetail = await armGet(`${webApps[0].id}?api-version=2022-03-01`);
          webApp = {
            name: appDetail.name, state: appDetail.properties?.state, kind: appDetail.kind,
            defaultHostName: appDetail.properties?.defaultHostName,
            httpsOnly: appDetail.properties?.httpsOnly,
            linuxFxVersion: appDetail.properties?.siteConfig?.linuxFxVersion,
            ftpsState: appDetail.properties?.siteConfig?.ftpsState,
          };
        } catch {}
      }

      // Try to get MySQL Flexible Server details
      let mysqlServer = null;
      const mysqlServers = resources.filter(r => r.type === "Microsoft.DBforMySQL/flexibleServers");
      if (mysqlServers.length > 0) {
        try {
          const mysqlDetail = await armGet(`${mysqlServers[0].id}?api-version=2021-12-01-preview`);
          mysqlServer = {
            name: mysqlDetail.name, sku: mysqlDetail.sku, state: mysqlDetail.properties?.state,
            version: mysqlDetail.properties?.version, tier: mysqlDetail.sku?.tier,
            storageSizeGB: mysqlDetail.properties?.storage?.storageSizeGB,
            backupRetentionDays: mysqlDetail.properties?.backup?.backupRetentionDays,
            haEnabled: mysqlDetail.properties?.highAvailability?.mode !== "Disabled",
          };
        } catch {}
      }

      return json(res, 200, {
        live: true, subscriptionId: subId, resourceGroup: rg,
        resources, appServicePlan, webApp, mysqlServer,
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[Azure Resources]", err.message);
      return json(res, 200, { live: false, error: err.message, resources: [] });
    }
  }

  // ─── CSAT Survey Engine (Phase 7) ──────────────────────────────────────

  // POST /api/csat/submit — Record a CSAT survey response
  if (pathname === "/api/csat/submit" && req.method === "POST") {
    const body = await parseBody(req);
    const { ticketId, rating, comment, agentName, category, customerName, customerEmail } = body;
    if (!ticketId || !rating || rating < 1 || rating > 5) {
      return json(res, 400, { error: "ticketId and rating (1-5) are required" });
    }
    const id = `CSAT-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const response = {
      id, ticketId, rating: Number(rating), comment: (comment || "").substring(0, 2000),
      agentName: agentName || "Unknown", category: category || "General",
      customerName: customerName || "Anonymous", customerEmail: customerEmail || "",
      sentiment: null, createdAt: new Date().toISOString(),
    };
    // AI sentiment analysis on comment (if comment provided and AI enabled)
    if (response.comment && ctx.AZURE_OPENAI_ENDPOINT && ctx.AZURE_OPENAI_KEY) {
      try {
        const sentimentResult = await callAI(
          "Analyze the sentiment of this customer feedback comment. Return ONLY a JSON object: {\"sentiment\": \"positive\"|\"neutral\"|\"negative\", \"keywords\": [\"word1\",\"word2\"], \"summary\": \"one sentence summary\"}",
          response.comment,
          { tier: "tertiary", maxTokens: 150 }
        );
        const parsed = JSON.parse(sentimentResult.text.replace(/```json\n?|```/g, "").trim());
        response.sentiment = parsed.sentiment || null;
        response.keywords = parsed.keywords || [];
        response.aiSummary = parsed.summary || "";
      } catch { /* sentiment analysis optional */ }
    }
    await db.upsert("csat_responses", id, JSON.stringify(response));
    console.log(`[CSAT] Recorded rating ${rating}/5 for ${ticketId} by ${customerName || "anonymous"}`);
    // WebSocket broadcast
    if (wsServer) wsServer.broadcast("csat", { action: "new_response", ...response });
    return json(res, 200, { success: true, id, response });
  }

  // GET /api/csat/scores — Aggregate CSAT scores with breakdowns
  if (pathname === "/api/csat/scores" && req.method === "GET") {
    const rows = await db.getAll("csat_responses");
    const responses = rows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
    const total = responses.length;
    if (total === 0) return json(res, 200, { total: 0, average: 0, nps: 0, byAgent: {}, byCategory: {}, byRating: {}, trend: [] });

    const sum = responses.reduce((s, r) => s + r.rating, 0);
    const average = Math.round((sum / total) * 10) / 10;

    // NPS calculation: promoters (4-5) - detractors (1-2) / total * 100
    const promoters = responses.filter(r => r.rating >= 4).length;
    const detractors = responses.filter(r => r.rating <= 2).length;
    const nps = Math.round(((promoters - detractors) / total) * 100);

    // By rating
    const byRating = {};
    for (let i = 1; i <= 5; i++) byRating[i] = responses.filter(r => r.rating === i).length;

    // By agent
    const byAgent = {};
    for (const r of responses) {
      const agent = r.agentName || "Unknown";
      if (!byAgent[agent]) byAgent[agent] = { total: 0, sum: 0, count5: 0, count1: 0 };
      byAgent[agent].total++;
      byAgent[agent].sum += r.rating;
      if (r.rating === 5) byAgent[agent].count5++;
      if (r.rating <= 2) byAgent[agent].count1++;
    }
    for (const a in byAgent) byAgent[a].avg = Math.round((byAgent[a].sum / byAgent[a].total) * 10) / 10;

    // By category
    const byCategory = {};
    for (const r of responses) {
      const cat = r.category || "General";
      if (!byCategory[cat]) byCategory[cat] = { total: 0, sum: 0 };
      byCategory[cat].total++;
      byCategory[cat].sum += r.rating;
    }
    for (const c in byCategory) byCategory[c].avg = Math.round((byCategory[c].sum / byCategory[c].total) * 10) / 10;

    // Weekly trend (last 12 weeks)
    const trend = [];
    const now = Date.now();
    for (let w = 11; w >= 0; w--) {
      const weekStart = now - (w + 1) * 7 * 86400000;
      const weekEnd = now - w * 7 * 86400000;
      const weekR = responses.filter(r => { const t = new Date(r.createdAt).getTime(); return t >= weekStart && t < weekEnd; });
      trend.push({
        week: new Date(weekStart).toISOString().split("T")[0],
        count: weekR.length,
        avg: weekR.length > 0 ? Math.round((weekR.reduce((s, r) => s + r.rating, 0) / weekR.length) * 10) / 10 : null,
      });
    }

    // Sentiment breakdown
    const sentimentBreakdown = { positive: 0, neutral: 0, negative: 0 };
    for (const r of responses) { if (r.sentiment) sentimentBreakdown[r.sentiment] = (sentimentBreakdown[r.sentiment] || 0) + 1; }

    // Recent comments with sentiment
    const recentComments = responses.filter(r => r.comment).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20).map(r => ({
      ticketId: r.ticketId, rating: r.rating, comment: r.comment, sentiment: r.sentiment,
      keywords: r.keywords, aiSummary: r.aiSummary, customerName: r.customerName, agentName: r.agentName,
      createdAt: r.createdAt,
    }));

    return json(res, 200, { total, average, nps, byRating, byAgent, byCategory, trend, sentimentBreakdown, recentComments });
  }

  // POST /api/csat/ai-analyze — AI deep analysis of CSAT patterns
  if (pathname === "/api/csat/ai-analyze" && req.method === "POST") {
    if (!ctx.AZURE_OPENAI_ENDPOINT || !ctx.AZURE_OPENAI_KEY) return json(res, 400, { error: "Azure OpenAI not configured" });
    const rows = await db.getAll("csat_responses");
    const responses = rows.map(r => { try { return typeof r.data === "string" ? JSON.parse(r.data) : r.data; } catch { return null; } }).filter(Boolean);
    if (responses.length < 3) return json(res, 200, { analysis: "Not enough CSAT data for analysis. Need at least 3 survey responses.", recommendations: [] });

    const summary = responses.slice(-50).map(r => `${r.ticketId}: ${r.rating}/5 [${r.category}] ${r.agentName} — "${(r.comment || "no comment").substring(0, 100)}"`).join("\n");
    try {
      const aiResult = await callAI(`You are a customer experience analytics expert for an IT service desk (VGC Technology, Singapore). Analyze CSAT survey data and provide insights. Return ONLY a JSON object:
{
  "overallAssessment": "brief paragraph",
  "topStrengths": ["strength1", "strength2"],
  "areasForImprovement": ["area1", "area2"],
  "agentInsights": [{"agent": "name", "insight": "observation"}],
  "categoryInsights": [{"category": "name", "insight": "observation"}],
  "recommendations": [{"priority": "high|medium|low", "action": "what to do", "impact": "expected result"}],
  "riskAlerts": ["any concerning patterns"]
}`,
        `Analyze these ${responses.length} CSAT responses:\n${summary}`,
        { tier: "secondary", maxTokens: 1200 }
      );
      const parsed = JSON.parse(aiResult.text.replace(/```json\n?|```/g, "").trim());
      return json(res, 200, { success: true, analysis: parsed, responseCount: responses.length });
    } catch (err) {
      console.error("[CSAT AI Analysis]", err.message);
      return json(res, 200, { success: false, error: err.message });
    }
  }

  // ── POST /api/incidents/merge — Merge duplicate incidents into a primary ──
  if (pathname === "/api/incidents/merge" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const { primaryId, duplicateIds, mergedBy } = body;
      if (!primaryId || !Array.isArray(duplicateIds) || duplicateIds.length === 0) {
        return json(res, 400, { error: "primaryId and duplicateIds[] required" });
      }
      // Load primary
      const primaryRow = await db.getOne("incidents", primaryId);
      if (!primaryRow) return json(res, 404, { error: `Primary incident ${primaryId} not found` });
      const primary = typeof primaryRow === "string" ? JSON.parse(primaryRow) : primaryRow;

      const mergedIds = [];
      for (const dupId of duplicateIds) {
        if (dupId === primaryId) continue;
        const dupRow = await db.getOne("incidents", dupId);
        if (!dupRow) continue;
        const dup = typeof dupRow === "string" ? JSON.parse(dupRow) : dupRow;

        // Merge activity logs from duplicate into primary
        const dupLogs = Array.isArray(dup.activityLog) ? dup.activityLog : [];
        if (!Array.isArray(primary.activityLog)) primary.activityLog = [];
        for (const log of dupLogs) {
          primary.activityLog.push({ ...log, detail: `[Merged from ${dupId}] ${log.detail || ""}` });
        }

        // Mark duplicate as closed
        dup.status = "Closed";
        dup.duplicateOf = primaryId;
        dup.updatedAt = new Date().toISOString();
        if (!Array.isArray(dup.activityLog)) dup.activityLog = [];
        dup.activityLog.push({
          id: `AL-MERGE-${Date.now()}`,
          type: "merged",
          user: mergedBy || "System",
          time: new Date().toISOString(),
          detail: `Closed as duplicate — merged into ${primaryId}`,
        });
        await db.upsert("incidents", dupId, JSON.stringify(dup));
        await db.audit("incidents", dupId, "merge_close", JSON.stringify({ primaryId, mergedBy }), mergedBy || "system");
        mergedIds.push(dupId);
      }

      // Add merge summary to primary
      primary.activityLog.push({
        id: `AL-MERGE-P-${Date.now()}`,
        type: "merge_primary",
        user: mergedBy || "System",
        time: new Date().toISOString(),
        detail: `Merged ${mergedIds.length} duplicate(s): ${mergedIds.join(", ")}`,
      });
      primary.updatedAt = new Date().toISOString();
      await db.upsert("incidents", primaryId, JSON.stringify(primary));
      await db.audit("incidents", primaryId, "merge_primary", JSON.stringify({ mergedIds, mergedBy }), mergedBy || "system");

      if (wsServer) wsServer.broadcast("incidents", { action: "merge", primaryId, mergedIds });
      return json(res, 200, { success: true, primaryId, mergedIds, mergedCount: mergedIds.length });
    } catch (err) {
      console.error("[Incident Merge]", err.message);
      return json(res, 500, { error: "Merge failed", details: err.message });
    }
  }

  // ── GET /api/incidents/duplicates — Scan for potential duplicate groups ──
  if (pathname === "/api/incidents/duplicates" && req.method === "GET") {
    try {
      const allIncidents = await db.getAll("incidents");
      const openIncidents = allIncidents.filter(i => !["Closed", "Resolved"].includes(i.status));
      const normalizeSubject = (s) => (s || "").replace(/^(\s*(re|fw|fwd)\s*:\s*)+/gi, "").replace(/^\[.*?\]\s*/g, "").trim().toLowerCase();
      const wordSimilarity = (s1, s2) => {
        const w1 = s1.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2);
        const w2 = s2.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2);
        if (w1.length === 0 || w2.length === 0) return 0;
        const intersection = w1.filter(w => w2.includes(w)).length;
        return intersection / Math.max(w1.length, w2.length);
      };

      // Build groups: cluster by same reporter + high subject similarity + time proximity
      const groups = [];
      const visited = new Set();
      for (let i = 0; i < openIncidents.length; i++) {
        if (visited.has(openIncidents[i].id)) continue;
        const a = openIncidents[i];
        const cluster = [a];
        for (let j = i + 1; j < openIncidents.length; j++) {
          if (visited.has(openIncidents[j].id)) continue;
          const b = openIncidents[j];
          const sameSender = (a.reporterEmail || "").toLowerCase() === (b.reporterEmail || "").toLowerCase();
          const sim = wordSimilarity(normalizeSubject(a.title), normalizeSubject(b.title));
          const timeA = new Date(a.createdAt || 0).getTime();
          const timeB = new Date(b.createdAt || 0).getTime();
          const timeDiffMin = Math.abs(timeA - timeB) / 60000;
          // Same sender + (≥60% subject overlap OR created within 5 min)
          if (sameSender && (sim >= 0.6 || timeDiffMin <= 5)) {
            cluster.push(b);
            visited.add(b.id);
          }
        }
        if (cluster.length > 1) {
          visited.add(a.id);
          // Pick the earliest as suggested primary
          cluster.sort((x, y) => new Date(x.createdAt || 0) - new Date(y.createdAt || 0));
          groups.push({
            suggestedPrimary: cluster[0].id,
            incidents: cluster.map(inc => ({
              id: inc.id, title: inc.title, status: inc.status, priority: inc.priority,
              reporter: inc.reporterName || inc.reporterEmail, reporterEmail: inc.reporterEmail,
              createdAt: inc.createdAt, source: inc.source, category: inc.category,
              activityCount: Array.isArray(inc.activityLog) ? inc.activityLog.length : 0,
            })),
            similarity: cluster.length === 2
              ? Math.round(wordSimilarity(normalizeSubject(cluster[0].title), normalizeSubject(cluster[1].title)) * 100)
              : Math.round(cluster.slice(1).reduce((sum, c) => sum + wordSimilarity(normalizeSubject(cluster[0].title), normalizeSubject(c.title)), 0) / (cluster.length - 1) * 100),
            reporter: cluster[0].reporterEmail,
          });
        }
      }

      // ── Second pass: zdTicketId-based duplicate detection (definite duplicates) ──
      const zdMap = new Map(); // zdTicketId → [incidents]
      for (const inc of allIncidents) {
        if (inc.zdTicketId) {
          const key = String(inc.zdTicketId);
          if (!zdMap.has(key)) zdMap.set(key, []);
          zdMap.get(key).push(inc);
        }
      }
      const visitedZdGroups = new Set();
      for (const [zdId, zdIncs] of zdMap) {
        if (zdIncs.length < 2) continue;
        // Skip if all incidents in this group are already in a subject-similarity group
        const allAlreadyGrouped = zdIncs.every(i => visited.has(i.id));
        if (allAlreadyGrouped) continue;
        // Sort: oldest first as primary
        zdIncs.sort((a, b) => new Date(a.createdAt || a.created || 0) - new Date(b.createdAt || b.created || 0));
        groups.push({
          suggestedPrimary: zdIncs[0].id,
          type: "zdTicketId_match",
          zdTicketId: zdId,
          incidents: zdIncs.map(inc => ({
            id: inc.id, title: inc.title, status: inc.status, priority: inc.priority,
            reporter: inc.reporterName || inc.reporterEmail || inc.reporter, reporterEmail: inc.reporterEmail,
            createdAt: inc.createdAt, source: inc.source, category: inc.category,
            activityCount: Array.isArray(inc.activityLog) ? inc.activityLog.length : 0,
          })),
          similarity: 100,
          reporter: zdIncs[0].reporterEmail || zdIncs[0].reporter,
        });
      }

      return json(res, 200, { scanned: openIncidents.length, groupsFound: groups.length, groups });
    } catch (err) {
      return json(res, 500, { error: "Duplicate scan failed", details: err.message });
    }
  }

  // ── POST /api/incidents/dedup-by-zdticketid — Auto-merge zdTicketId duplicates ──
  if (pathname === "/api/incidents/dedup-by-zdticketid" && req.method === "POST") {
    try {
      const allIncidents = await db.getAll("incidents");
      const zdMap = new Map();
      for (const inc of allIncidents) {
        if (inc.zdTicketId) {
          const key = String(inc.zdTicketId);
          if (!zdMap.has(key)) zdMap.set(key, []);
          zdMap.get(key).push(inc);
        }
      }
      let totalMerged = 0;
      const mergedGroups = [];
      for (const [zdId, zdIncs] of zdMap) {
        if (zdIncs.length < 2) continue;
        // Keep oldest as primary
        zdIncs.sort((a, b) => new Date(a.createdAt || a.created || 0) - new Date(b.createdAt || b.created || 0));
        const primary = zdIncs[0];
        const duplicateIds = zdIncs.slice(1).map(i => i.id);

        // Merge activity logs from duplicates into primary
        if (!Array.isArray(primary.activityLog)) primary.activityLog = [];
        for (const dup of zdIncs.slice(1)) {
          const dupLogs = Array.isArray(dup.activityLog) ? dup.activityLog : [];
          for (const log of dupLogs) {
            primary.activityLog.push({ ...log, detail: `[Merged from ${dup.id}] ${log.detail || ""}` });
          }
          // Close the duplicate
          dup.status = "Closed";
          dup.duplicateOf = primary.id;
          dup.updatedAt = new Date().toISOString();
          if (!Array.isArray(dup.activityLog)) dup.activityLog = [];
          dup.activityLog.push({
            id: `AL-ZDDEDUP-${Date.now()}-${dup.id}`,
            type: "merged",
            user: "ZD Dedup Engine",
            time: new Date().toISOString(),
            detail: `Closed as duplicate — merged into ${primary.id} (same Zendesk ticket #${zdId})`,
          });
          await db.upsert("incidents", dup.id, JSON.stringify(dup));
          await db.audit("incidents", dup.id, "zd_dedup_close", JSON.stringify({ primaryId: primary.id, zdTicketId: zdId }), "ZD Dedup Engine");
        }
        // Update primary with merge summary
        primary.activityLog.push({
          id: `AL-ZDDEDUP-P-${Date.now()}-${primary.id}`,
          type: "merge_primary",
          user: "ZD Dedup Engine",
          time: new Date().toISOString(),
          detail: `Auto-merged ${duplicateIds.length} duplicate(s) for ZD#${zdId}: ${duplicateIds.join(", ")}`,
        });
        primary.updatedAt = new Date().toISOString();
        await db.upsert("incidents", primary.id, JSON.stringify(primary));
        await db.audit("incidents", primary.id, "zd_dedup_primary", JSON.stringify({ mergedIds: duplicateIds, zdTicketId: zdId }), "ZD Dedup Engine");

        totalMerged += duplicateIds.length;
        mergedGroups.push({ zdTicketId: zdId, primaryId: primary.id, mergedIds: duplicateIds });
      }
      if (wsServer) wsServer.broadcast("incidents", { action: "zd_dedup", totalMerged, mergedGroups });
      return json(res, 200, { success: true, groupsFound: mergedGroups.length, totalMerged, mergedGroups });
    } catch (err) {
      console.error("[ZD Dedup]", err.message);
      return json(res, 500, { error: "ZD dedup failed", details: err.message });
    }
  }

  // ── Dedup scan — one-time scan to find and flag existing duplicate incidents ──
  if (pathname === "/api/incidents/dedup-scan" && req.method === "POST") {
    try {
      const allIncidents = await db.getAll("incidents");
      const emailIncidents = allIncidents.filter(i => i.source === "email" && !["Closed", "Resolved"].includes(i.status));
      const normalizeSubject = (s) => (s || "").replace(/^(\s*(re|fw|fwd)\s*:\s*)+/gi, "").replace(/^\[.*?\]\s*/g, "").trim().toLowerCase();
      const wordSimilarity = (s1, s2) => {
        const w1 = s1.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2);
        const w2 = s2.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2);
        if (w1.length === 0 || w2.length === 0) return 0;
        return w1.filter(w => w2.includes(w)).length / Math.max(w1.length, w2.length);
      };
      const duplicates = [];
      for (let i = 0; i < emailIncidents.length; i++) {
        for (let j = i + 1; j < emailIncidents.length; j++) {
          const a = emailIncidents[i], b = emailIncidents[j];
          const sim = wordSimilarity(normalizeSubject(a.title), normalizeSubject(b.title));
          const sameSender = (a.reporterEmail || "").toLowerCase() === (b.reporterEmail || "").toLowerCase();
          if (sim >= 0.7 && sameSender) {
            duplicates.push({ incidentA: a.id, incidentB: b.id, similarity: Math.round(sim * 100), reporter: a.reporterEmail, titleA: a.title, titleB: b.title });
          }
        }
      }
      return json(res, 200, { scanned: emailIncidents.length, duplicatesFound: duplicates.length, duplicates });
    } catch (err) {
      return json(res, 500, { error: "Dedup scan failed", details: err.message });
    }
  }

  // ─── Kubernetes/Container Health Probes ─────────────────────────────
  if (pathname === "/healthz") {
    return json(res, 200, { status: "ok" });
  }
  if (pathname === "/readyz") {
    try {
      await db.ping();
      return json(res, 200, { status: "ready", database: "connected" });
    } catch {
      return json(res, 503, { status: "not ready", database: "disconnected" });
    }
  }

  // ─── Frontend Config Endpoint (no auth required) ──────────────────
    return false;
  };
};
