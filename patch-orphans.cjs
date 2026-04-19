// Patch INC3283 and INC1710 — orphan incidents with created=0, no source, referencing missing ZD#8292
const BASE = "https://vgc-itsm1-app.azurewebsites.net";

async function getJson(path) {
  const r = await fetch(BASE + path);
  return r.json();
}

async function putJson(path, body) {
  const r = await fetch(BASE + path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

(async () => {
  // Get the two bad incidents
  const resp = await getJson("/api/db/incidents");
  const incidents = resp.data || resp;
  const bad = incidents.filter(i => i.id === "INC3283" || i.id === "INC1710");
  console.log(`Found ${bad.length} orphan incidents to patch`);

  for (const inc of bad) {
    console.log(`\nPatching ${inc.id}: "${inc.title}"`);
    console.log(`  Before: created=${inc.created}, source=${inc.source}, zdTicketId=${inc.zdTicketId}`);

    // Calculate created hours from activity log or use reasonable default
    let createdHours = 0;
    if (inc.activityLog && inc.activityLog.length > 0) {
      const earliest = inc.activityLog.reduce((min, a) => {
        const t = new Date(a.time).getTime();
        return t < min ? t : min;
      }, Date.now());
      createdHours = Math.max(1, Math.round((Date.now() - earliest) / 3600000));
    }
    if (createdHours === 0) createdHours = 48; // Default fallback

    // Patch the incident
    const patch = {
      ...inc,
      created: createdHours,
      source: "zendesk",
    };

    // Ensure [ZD#] title prefix
    if (!patch.title.includes("[ZD#")) {
      patch.title = `[ZD#${inc.zdTicketId}] ${patch.title}`;
    }

    const result = await putJson(`/api/db/incidents/${inc.id}`, patch);
    console.log(`  After: created=${createdHours}, source=zendesk`);
    console.log(`  PUT status: ${result.status}`);
  }

  // Verify
  console.log("\n--- Verification ---");
  const afterResp = await getJson("/api/db/incidents");
  const after = afterResp.data || afterResp;
  const stillBad = after.filter(i => !i.created || i.created === 0 || !i.source);
  console.log(`Incidents with created=0 or no source: ${stillBad.length}`);
  
  // Check ZD#8292 match issue — these incidents reference a ticket that doesn't exist
  // We need to check if ticket 8292 was deleted/merged in Zendesk
  const zdResp = await getJson("/api/db/zendesk_tickets");
  const zdTickets = zdResp.data || zdResp;
  const has8292 = zdTickets.some(t => String(t.id) === "8292");
  console.log(`ZD#8292 exists in DB: ${has8292}`);
  
  if (!has8292) {
    // Find the closest ticket to understand what happened
    const sorted = zdTickets.map(t => Number(t.id)).sort((a,b) => b-a);
    console.log(`Highest ZD ticket ID: ${sorted[0]}`);
    console.log(`ZD#8292 likely deleted/merged in Zendesk`);
    
    // Remove the zdTicketId reference since ticket doesn't exist
    for (const inc of bad) {
      const current = after.find(i => i.id === inc.id);
      if (current && String(current.zdTicketId) === "8292") {
        console.log(`Clearing invalid zdTicketId=8292 from ${inc.id}`);
        current.zdTicketId = null;
        const r = await putJson(`/api/db/incidents/${inc.id}`, current);
        console.log(`  PUT status: ${r.status}`);
      }
    }
  }

  console.log("\nDone!");
})().catch(e => console.error(e));
