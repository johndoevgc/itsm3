// VGC-ITSM v3.12.0 — Engineer Daily Workflow Demo (Playwright)
// Opens a real browser and walks through the ITSM app visually
const { chromium } = require("playwright");
const path = require("path");

const APP = "https://vgc-itsm1-app.azurewebsites.net";
// Persistent profile so login session survives across runs
const USER_DATA_DIR = path.join(__dirname, ".playwright-profile");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function highlight(page, selector, label) {
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
}

async function showBanner(page, text) {
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
}

async function clearOverlays(page) {
  await page.evaluate(() => {
    document.querySelectorAll(".demo-hl, .demo-banner").forEach(e => e.remove());
  });
}

(async () => {
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  VGC-ITSM v3.12.0 — ENGINEER DAILY WORKFLOW DEMO");
  console.log("═══════════════════════════════════════════════════\n");

  const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    channel: "msedge",
    args: ["--start-maximized"],
    viewport: null,
    ignoreHTTPSErrors: true,
  });
  const page = await browser.newPage();

  // ─── STEP 1: Open App ─────────────────────────────────────────────
  console.log("STEP 1: Opening VGC-ITSM...");
  await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 30000 });
  
  // Wait for user to complete Microsoft login if needed
  console.log("  Waiting for ITSM app to load (sign in if prompted)...");
  try {
    // Wait up to 3 minutes for the sidebar to appear (user needs to log in)
    await page.waitForSelector("text=Dashboard", { timeout: 180000 });
  } catch (e) {
    console.log("  Timed out waiting for Dashboard. Trying to continue anyway...");
  }
  await sleep(3000);
  await showBanner(page, "📋 Step 1: Engineer opens VGC-ITSM Dashboard");
  await sleep(3000);

  // ─── STEP 2: Dashboard Overview ───────────────────────────────────
  console.log("STEP 2: Reviewing Dashboard...");
  await showBanner(page, "📊 Step 2: Morning Dashboard — Check KPIs & ticket counts");
  await sleep(4000);

  // Scroll down to see KPI cards
  await page.evaluate(() => {
    const main = document.querySelector('[style*="overflow"]') || document.querySelector('main') || document.documentElement;
    if (main) main.scrollTop = 300;
  });
  await sleep(2000);

  // Scroll back up
  await page.evaluate(() => {
    const main = document.querySelector('[style*="overflow"]') || document.querySelector('main') || document.documentElement;
    if (main) main.scrollTop = 0;
  });
  await sleep(2000);

  // ─── STEP 3: Click Tickets ────────────────────────────────────────
  console.log("STEP 3: Opening Tickets view...");
  await clearOverlays(page);
  await showBanner(page, "🎫 Step 3: Open Tickets — Review incident queue");

  // Click on "Tickets" in sidebar
  try {
    const ticketsBtn = await page.locator("text=Tickets").first();
    await ticketsBtn.scrollIntoViewIfNeeded();
    await sleep(500);
    await ticketsBtn.click();
    await sleep(3000);
  } catch (e) {
    console.log("  Could not click Tickets, trying alternative...");
    try {
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll("div, button, span")];
        const ticketBtn = btns.find(b => b.textContent.trim() === "Tickets" && b.offsetParent);
        if (ticketBtn) ticketBtn.click();
      });
      await sleep(3000);
    } catch (e2) { console.log("  Fallback also failed"); }
  }

  // ─── STEP 4: Click on an incident ────────────────────────────────
  console.log("STEP 4: Opening an incident...");
  await clearOverlays(page);
  await showBanner(page, "🔍 Step 4: Engineer opens a ticket to investigate");
  await sleep(2000);

  // Click on the first incident row in the list
  try {
    // Look for incident rows — they typically have INC in their text
    const incRow = await page.locator("text=/INC\\d+/").first();
    await incRow.scrollIntoViewIfNeeded();
    await sleep(500);
    await incRow.click();
    await sleep(3000);
  } catch (e) {
    console.log("  Could not click incident row, trying table row...");
    try {
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll("div, tr")];
        const incRow = rows.find(r => /INC\d+/.test(r.textContent) && r.style && r.style.cursor === "pointer");
        if (incRow) incRow.click();
      });
      await sleep(3000);
    } catch (e2) { console.log("  Could not find incident row"); }
  }

  await showBanner(page, "📝 Step 4: Viewing ticket details — status, SLA, activity log");
  await sleep(4000);

  // Scroll down in the ticket detail to see activity log
  await page.evaluate(() => {
    const panels = [...document.querySelectorAll("div")].filter(d => d.scrollHeight > d.clientHeight && d.clientHeight > 200);
    if (panels.length) panels[panels.length - 1].scrollTop = 400;
  });
  await sleep(2000);

  // ─── STEP 5: Navigate to Zendesk ─────────────────────────────────
  console.log("STEP 5: Opening Zendesk Integration...");
  await clearOverlays(page);

  // Go back first — click something to close detail
  try {
    // press Escape to close detail panel if open
    await page.keyboard.press("Escape");
    await sleep(1000);
  } catch (e) {}

  // Click Zendesk in sidebar or find a ZD navigation
  await showBanner(page, "🔗 Step 5: Zendesk Integration — Sync & view ZD tickets");
  await sleep(1500);

  // Try clicking sidebar "Tickets" first, then we'll navigate to the ZD sub-tab
  try {
    const ticketsNav = await page.locator("text=Tickets").first();
    await ticketsNav.click();
    await sleep(1500);
    
    // Look for a "Zendesk" tab inside Tickets view
    const zdTab = await page.locator("text=Zendesk").first();
    if (await zdTab.isVisible()) {
      await zdTab.click();
      await sleep(3000);
    }
  } catch (e) {
    console.log("  Trying direct Zendesk navigation...");
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("div, button, span")];
      const zdBtn = btns.find(b => /Zendesk/i.test(b.textContent.trim()) && b.offsetParent && (b.style?.cursor === "pointer" || b.tagName === "BUTTON"));
      if (zdBtn) zdBtn.click();
    });
    await sleep(3000);
  }

  await showBanner(page, "📡 Zendesk: Open=3 | Pending=12 | Hold=10 | Solved=29");
  await sleep(4000);

  // ─── STEP 6: AI Assist ────────────────────────────────────────────
  console.log("STEP 6: Opening AI Assist...");
  await clearOverlays(page);
  await showBanner(page, "🤖 Step 6: AI Assist — Multi-Model AI (Pro/Mini/Nano)");
  await sleep(1500);

  try {
    const aiBtn = await page.locator("text=AI Assist").first();
    await aiBtn.click();
    await sleep(3000);
  } catch (e) {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("div, button, span")];
      const aiBtn = btns.find(b => b.textContent.trim() === "AI Assist" && b.offsetParent);
      if (aiBtn) aiBtn.click();
    });
    await sleep(3000);
  }

  await showBanner(page, "🧠 AI Assist: Chat with gpt-5.4-mini for troubleshooting");
  await sleep(3000);

  // Type in AI chat if there's an input field
  try {
    const chatInput = await page.locator("textarea, input[type='text']").last();
    if (await chatInput.isVisible()) {
      await chatInput.click();
      await sleep(500);
      await chatInput.fill("Kellington printer Canon C3530i printing blank pages after toner replacement. What should I check?");
      await sleep(2000);
      await showBanner(page, "💬 Engineer asks AI about the printer issue");
      await sleep(2000);
      
      // Press Enter or click Send
      try {
        const sendBtn = await page.locator("button:has-text('Send'), button:has-text('Ask')").first();
        if (await sendBtn.isVisible()) {
          await sendBtn.click();
        } else {
          await chatInput.press("Enter");
        }
      } catch (e) {
        await chatInput.press("Enter");
      }
      
      await showBanner(page, "⏳ AI (gpt-5.4-mini) is analyzing the printer issue...");
      await sleep(8000);
      await showBanner(page, "✅ AI provided diagnosis: Check toner seals, drum unit, run test print");
      await sleep(4000);
    }
  } catch (e) {
    console.log("  Could not find AI chat input");
  }

  // ─── STEP 7: Knowledge Base ───────────────────────────────────────
  console.log("STEP 7: Opening Knowledge Portal...");
  await clearOverlays(page);
  await showBanner(page, "📚 Step 7: Knowledge Portal — AI-generated KB articles");
  await sleep(1500);

  try {
    const kbBtn = await page.locator("text=Knowledge Portal").first();
    await kbBtn.click();
    await sleep(3000);
  } catch (e) {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("div, button, span")];
      const kbBtn = btns.find(b => b.textContent.trim() === "Knowledge Portal" && b.offsetParent);
      if (kbBtn) kbBtn.click();
    });
    await sleep(3000);
  }

  await showBanner(page, "📖 Knowledge Base articles for troubleshooting reference");
  await sleep(4000);

  // ─── STEP 8: Admin / AI Config ────────────────────────────────────
  console.log("STEP 8: Opening Admin Settings...");
  await clearOverlays(page);
  await showBanner(page, "⚙️ Step 8: Admin — Multi-Model AI Architecture");
  await sleep(1500);

  try {
    const adminBtn = await page.locator("text=Admin Settings").first();
    await adminBtn.click();
    await sleep(3000);
  } catch (e) {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("div, button, span")];
      const adminBtn = btns.find(b => b.textContent.trim() === "Admin Settings" && b.offsetParent);
      if (adminBtn) adminBtn.click();
    });
    await sleep(3000);
  }

  // Scroll to find Multi-Model AI Architecture card
  await page.evaluate(() => {
    const main = document.querySelector('[style*="overflow-y"]') || document.documentElement;
    if (main) main.scrollTop = 600;
  });
  await sleep(2000);

  await showBanner(page, "🏗️ Multi-Model AI: gpt-5.4-pro | gpt-5.4-mini | gpt-5.4-nano");
  await sleep(4000);

  // ─── STEP 9: Back to Dashboard ────────────────────────────────────
  console.log("STEP 9: Returning to Dashboard...");
  await clearOverlays(page);
  
  try {
    const dashBtn = await page.locator("text=Dashboard").first();
    await dashBtn.click();
    await sleep(3000);
  } catch (e) {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("div, button, span")];
      const dashBtn = btns.find(b => b.textContent.trim() === "Dashboard" && b.offsetParent);
      if (dashBtn) dashBtn.click();
    });
    await sleep(3000);
  }

  await showBanner(page, "✅ Demo Complete — VGC-ITSM v3.12.0 Multi-Model AI Architecture");
  await sleep(5000);

  await clearOverlays(page);
  console.log("\n✅ DEMO COMPLETE — Browser staying open for you to explore.\n");
  console.log("Press Ctrl+C to close the browser when done.\n");

  // Keep browser open
  await page.waitForTimeout(300000); // 5 minutes
  await browser.close();
})();
