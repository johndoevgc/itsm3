// VGC-ITSM v3.12.0 — Engineer Daily Workflow Demo (Playwright)
// Opens a real browser and walks through the ITSM app visually
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const APP = "https://vgc-itsm1-app.azurewebsites.net?demo=true";
const SS = path.join(__dirname, "screenshots");
if (!fs.existsSync(SS)) fs.mkdirSync(SS);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let browserClosed = false;

async function highlight(page, selector, label) {
  if (browserClosed) return;
  try {
    await page.evaluate(({ sel, lbl }) => {
    // Remove old highlights
    document.querySelectorAll(".demo-hl").forEach(e => e.remove());
    const el = document.querySelector(sel);
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Highlight box
    const box = document.createElement("div");
    box.className = "demo-hl";
    Object.assign(box.style, {
      position: "fixed", left: (r.left - 4) + "px", top: (r.top - 4) + "px",
      width: (r.width + 8) + "px", height: (r.height + 8) + "px",
      border: "3px solid #6366F1", borderRadius: "8px", zIndex: "99999",
      pointerEvents: "none", boxShadow: "0 0 20px #6366F166",
      transition: "all 0.3s ease"
    });
    document.body.appendChild(box);
    // Label
    if (lbl) {
      const tag = document.createElement("div");
      tag.className = "demo-hl";
      tag.textContent = lbl;
      Object.assign(tag.style, {
        position: "fixed", left: (r.left) + "px", top: (r.top - 32) + "px",
        background: "#6366F1", color: "#fff", padding: "4px 12px", borderRadius: "6px",
        fontSize: "13px", fontWeight: "700", zIndex: "99999", pointerEvents: "none",
        fontFamily: "sans-serif", boxShadow: "0 2px 8px rgba(0,0,0,0.3)"
      });
      document.body.appendChild(tag);
    }
  }, { sel: selector, lbl: label });
  } catch {}
}

async function showBanner(page, text) {
  if (browserClosed) return;
  try {
    await page.evaluate((t) => {
    document.querySelectorAll(".demo-banner").forEach(e => e.remove());
    const banner = document.createElement("div");
    banner.className = "demo-banner";
    banner.textContent = t;
    Object.assign(banner.style, {
      position: "fixed", top: "10px", left: "50%", transform: "translateX(-50%)",
      background: "linear-gradient(135deg, #6366F1, #818CF8)", color: "#fff",
      padding: "12px 28px", borderRadius: "12px", fontSize: "16px", fontWeight: "700",
      zIndex: "99999", pointerEvents: "none", fontFamily: "sans-serif",
      boxShadow: "0 4px 20px rgba(99,102,241,0.5)", letterSpacing: "0.3px",
      animation: "fadeIn 0.5s ease"
    });
    document.body.appendChild(banner);
    // Add animation
    if (!document.querySelector("#demo-anim-style")) {
      const s = document.createElement("style");
      s.id = "demo-anim-style";
      s.textContent = "@keyframes fadeIn{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}";
      document.head.appendChild(s);
    }
  }, text);
  } catch {}
}

async function clearOverlays(page) {
  if (browserClosed) return;
  try {
    await page.evaluate(() => {
      document.querySelectorAll(".demo-hl, .demo-banner").forEach(e => e.remove());
    });
  } catch {}
}

async function clickSidebarNav(page, label) {
  if (browserClosed) return false;
  try {
    const clicked = await page.evaluate((lbl) => {
      const sidebar = document.querySelector('nav') || [...document.querySelectorAll("div")].find(d => d.clientWidth > 50 && d.clientWidth < 280 && d.clientHeight > 400);
      const scope = sidebar ? [...sidebar.querySelectorAll("div, span, button, a")] : [...document.querySelectorAll("div, span, button, a")];
      const exact = scope.filter(el => {
        const ownText = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join("");
        return (ownText === lbl || el.textContent.trim() === lbl) && el.offsetParent !== null && el.clientHeight > 0 && el.clientHeight < 80;
      });
      if (exact.length > 0) { exact[exact.length - 1].click(); return true; }
      const partial = scope.find(el => el.textContent.trim().includes(lbl) && el.offsetParent && el.clientHeight > 0 && el.clientHeight < 80);
      if (partial) { partial.click(); return true; }
      return false;
    }, label);
    if (clicked) await sleep(2500);
    return clicked;
  } catch { return false; }
}

async function safeSS(page, name) {
  if (browserClosed) return;
  try { await page.screenshot({ path: path.join(SS, name) }); } catch {}
}

(async () => {
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  VGC-ITSM v3.12.0 — ENGINEER DAILY WORKFLOW DEMO");
  console.log("═══════════════════════════════════════════════════\n");

  let browser, context, page;

  try {
    browser = await chromium.launch({
      channel: "msedge",
      headless: false,
      args: ["--start-maximized"],
    });
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    });
    page = await context.newPage();
    page.on("close", () => { browserClosed = true; });
    context.on("close", () => { browserClosed = true; });
  } catch (e) {
    console.error("  ❌ Failed to launch browser:", e.message);
    console.log("\n  Tip: Close all Edge windows and retry, or kill stale msedge processes.");
    process.exit(1);
  }

  async function step(label, fn) {
    if (browserClosed) { console.log(`${label} — SKIPPED (browser closed)`); return; }
    console.log(label);
    try { await fn(); }
    catch (e) { console.log(`  ⚠ Error: ${e.message.split("\n")[0]}`); }
  }

  // ─── STEP 1: Open App ─────────────────────────────────────────────
  await step("STEP 1: Opening VGC-ITSM...", async () => {
    await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Wait for user to complete Microsoft login if needed
    console.log("  Waiting for ITSM app to load (sign in if prompted)...");
    try {
      await page.waitForSelector("text=Dashboard", { timeout: 180000 });
    } catch {
      console.log("  Timed out waiting for Dashboard. Continuing...");
    }
    await sleep(3000);
    await showBanner(page, "📋 Step 1: Engineer opens VGC-ITSM Dashboard");
    await safeSS(page, "demo-01-dashboard.png");
    await sleep(3000);
  });

  // ─── STEP 2: Dashboard Overview ───────────────────────────────────
  await step("STEP 2: Reviewing Dashboard...", async () => {
    await showBanner(page, "📊 Step 2: Morning Dashboard — Check KPIs & ticket counts");
    await sleep(4000);
    await page.evaluate(() => {
      const main = document.querySelector('[style*="overflow"]') || document.querySelector('main') || document.documentElement;
      if (main) main.scrollTop = 300;
    });
    await sleep(2000);
    await page.evaluate(() => {
      const main = document.querySelector('[style*="overflow"]') || document.querySelector('main') || document.documentElement;
      if (main) main.scrollTop = 0;
    });
    await safeSS(page, "demo-02-dashboard-kpis.png");
    await sleep(2000);
  });

  // ─── STEP 3: Click Tickets ────────────────────────────────────────
  await step("STEP 3: Opening Tickets view...", async () => {
    await clearOverlays(page);
    await showBanner(page, "🎫 Step 3: Open Tickets — Review incident queue");
    await clickSidebarNav(page, "Tickets");
    await safeSS(page, "demo-03-tickets.png");
    await sleep(2000);
  });

  // ─── STEP 4: Click on an incident ────────────────────────────────
  await step("STEP 4: Opening an incident...", async () => {
    await clearOverlays(page);
    await showBanner(page, "🔍 Step 4: Engineer opens a ticket to investigate");
    await sleep(2000);
    // Click first incident row via evaluate (more reliable than locator for dynamic lists)
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll("div, tr")];
      const incRow = rows.find(r => /INC[-\w]+/.test(r.textContent) && r.offsetParent && r.clientHeight > 20 && r.clientHeight < 120 && (r.style.cursor === "pointer" || r.onclick || r.getAttribute("role") === "row"));
      if (incRow) { incRow.click(); return; }
      // Fallback — any visible element with INC id
      const fallback = rows.find(r => /INC[-\w]+/.test(r.textContent) && r.offsetParent && r.clientHeight > 20 && r.clientHeight < 120);
      if (fallback) fallback.click();
    });
    await sleep(3000);
    await showBanner(page, "📝 Step 4: Viewing ticket details — status, SLA, activity log");
    await safeSS(page, "demo-04-incident-detail.png");
    await sleep(3000);
  });

  // ─── STEP 5: Navigate to Zendesk ─────────────────────────────────
  await step("STEP 5: Opening Zendesk Integration...", async () => {
    await clearOverlays(page);
    try { await page.keyboard.press("Escape"); await sleep(1000); } catch {}
    await showBanner(page, "🔗 Step 5: Zendesk Integration — Sync & view ZD tickets");
    await sleep(1500);
    await clickSidebarNav(page, "Tickets");
    // Look for Zendesk sub-tab
    await page.evaluate(() => {
      const els = [...document.querySelectorAll("div, button, span")];
      const zdEl = els.find(el => /Zendesk/i.test(el.textContent.trim()) && el.offsetParent && el.clientHeight < 60);
      if (zdEl) zdEl.click();
    });
    await sleep(3000);
    await showBanner(page, "📡 Zendesk: Open=3 | Pending=12 | Hold=10 | Solved=29");
    await safeSS(page, "demo-05-zendesk.png");
    await sleep(3000);
  });

  // ─── STEP 6: AI Assist ────────────────────────────────────────────
  await step("STEP 6: Opening AI Assist...", async () => {
    await clearOverlays(page);
    await showBanner(page, "🤖 Step 6: AI Assist — Multi-Model AI (Pro/Mini/Nano)");
    await sleep(1500);
    await clickSidebarNav(page, "AI Assist");

    // Type in AI chat if there's an input field
    try {
      const chatInput = await page.locator("textarea, input[type='text']").last();
      if (await chatInput.isVisible({ timeout: 3000 })) {
        await chatInput.click();
        await sleep(500);
        await chatInput.fill("Kellington printer Canon C3530i printing blank pages after toner replacement. What should I check?");
        await sleep(2000);
        await showBanner(page, "💬 Engineer asks AI about the printer issue");
        await sleep(2000);
        try {
          const sendBtn = await page.locator("button:has-text('Send'), button:has-text('Ask')").first();
          if (await sendBtn.isVisible({ timeout: 2000 })) { await sendBtn.click(); }
          else { await chatInput.press("Enter"); }
        } catch { await chatInput.press("Enter"); }
        await showBanner(page, "⏳ AI (gpt-5.4-mini) is analyzing the printer issue...");
        await sleep(8000);
        await showBanner(page, "✅ AI provided diagnosis: Check toner seals, drum unit, run test print");
        await sleep(4000);
      }
    } catch { console.log("  Could not find AI chat input"); }
    await safeSS(page, "demo-06-ai-assist.png");
  });

  // ─── STEP 7: Knowledge Base ───────────────────────────────────────
  await step("STEP 7: Opening Knowledge Portal...", async () => {
    await clearOverlays(page);
    await showBanner(page, "📚 Step 7: Knowledge Portal — AI-generated KB articles");
    await sleep(1500);
    await clickSidebarNav(page, "Knowledge Portal");
    await showBanner(page, "📖 Knowledge Base articles for troubleshooting reference");
    await safeSS(page, "demo-07-knowledge.png");
    await sleep(3000);
  });

  // ─── STEP 8: Admin / AI Config ────────────────────────────────────
  await step("STEP 8: Opening Admin Settings...", async () => {
    await clearOverlays(page);
    await showBanner(page, "⚙️ Step 8: Admin — Multi-Model AI Architecture");
    await sleep(1500);
    await clickSidebarNav(page, "Admin");
    await page.evaluate(() => {
      const main = document.querySelector('[style*="overflow-y"]') || document.documentElement;
      if (main) main.scrollTop = 600;
    });
    await sleep(2000);
    await showBanner(page, "🏗️ Multi-Model AI: gpt-5.4-pro | gpt-5.4-mini | gpt-5.4-nano");
    await safeSS(page, "demo-08-admin.png");
    await sleep(3000);
  });

  // ─── STEP 9: Back to Dashboard ────────────────────────────────────
  await step("STEP 9: Returning to Dashboard...", async () => {
    await clearOverlays(page);
    await clickSidebarNav(page, "Dashboard");
    await showBanner(page, "✅ Demo Complete — VGC-ITSM v3.12.0 Multi-Model AI Architecture");
    await safeSS(page, "demo-09-final.png");
    await sleep(5000);
    await clearOverlays(page);
  });

  console.log("\n✅ DEMO COMPLETE — Browser staying open for you to explore.");
  console.log("Press Ctrl+C to close the browser when done.\n");

  if (!browserClosed) {
    try { await sleep(300000); } catch {} // 5 minutes
  }
  try { await context.close(); } catch {}
  try { await browser.close(); } catch {}
})();
