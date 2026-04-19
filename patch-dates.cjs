// Patch incidents: fix created field using ZD ticket createdAt dates
(async () => {
  const BASE = "https://vgc-itsm1-app.azurewebsites.net";
  const now = Date.now();

  // Fetch all incidents and ZD tickets
  const [incRes, zdRes] = await Promise.all([
    fetch(BASE + "/api/db/incidents").then(r => r.json()),
    fetch(BASE + "/api/db/zendesk_tickets").then(r => r.json()),
  ]);

  const incidents = incRes.data.map(d => typeof d.data === "string" ? JSON.parse(d.data) : (d.data || d));
  const zdTickets = zdRes.data;

  // Build ZD ticket lookup by ID
  const zdMap = new Map();
  for (const t of zdTickets) {
    zdMap.set(Number(t.id), t);
  }

  console.log("Incidents:", incidents.length);
  console.log("ZD Tickets:", zdTickets.length);

  let patched = 0;
  let skipped = 0;
  let errors = 0;

  for (const inc of incidents) {
    if (!inc.zdTicketId) { skipped++; continue; }

    const zd = zdMap.get(Number(inc.zdTicketId));
    if (!zd) {
      console.log("  No ZD match for", inc.id, "zdTicketId:", inc.zdTicketId);
      skipped++;
      continue;
    }

    const zdDate = zd.createdAt || zd.created_at;
    if (!zdDate) {
      console.log("  No date for ZD#" + zd.id);
      skipped++;
      continue;
    }

    const hoursAgo = Math.max(0, Math.round((now - new Date(zdDate).getTime()) / 3600000));
    
    if (hoursAgo === inc.created) {
      skipped++;
      continue;
    }

    // Also fix title: add [ZD#] prefix if missing
    let title = inc.title;
    if (!title.includes("[ZD#")) {
      title = "[ZD#" + inc.zdTicketId + "] " + title;
    }

    // Also add source field
    const updated = { ...inc, created: hoursAgo, title, source: "zendesk" };

    try {
      const r = await fetch(BASE + "/api/db/incidents/" + inc.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (r.ok) {
        patched++;
        console.log("  Patched", inc.id, "ZD#" + inc.zdTicketId, "created:", inc.created, "->", hoursAgo, "hrs ago (" + zdDate + ")");
      } else {
        errors++;
        console.log("  FAIL", inc.id, r.status);
      }
    } catch (e) {
      errors++;
      console.log("  ERROR", inc.id, e.message);
    }
  }

  console.log("\n=== PATCH RESULTS ===");
  console.log("Patched:", patched);
  console.log("Skipped:", skipped);
  console.log("Errors:", errors);
})();
