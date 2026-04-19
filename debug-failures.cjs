const BASE = "https://vgc-itsm1-app.azurewebsites.net";

(async () => {
  // 1. ZD status endpoint
  console.log("=== ZD Status ===");
  const zd = await fetch(BASE + "/api/zendesk/status");
  console.log("Status:", zd.status);
  const zdTxt = await zd.text();
  console.log("Body:", zdTxt.substring(0, 300));

  // 2. SSE done event
  console.log("\n=== SSE Stream ===");
  const stream = await fetch(BASE + "/api/ai/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt: "Reply OK.", userPrompt: "Hi" }),
  });
  const txt = await stream.text();
  console.log("Last 400 chars:", txt.substring(txt.length - 400));
  console.log("Has [DONE]:", txt.includes("[DONE]"));
  console.log("Has data: [DONE]:", txt.includes("data: [DONE]"));

  // 3. AI chat non-streaming
  console.log("\n=== AI Chat ===");
  const chat = await fetch(BASE + "/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt: "Reply OK.", userPrompt: "Hi" }),
  });
  console.log("Status:", chat.status);
  const chatTxt = await chat.text();
  console.log("Body:", chatTxt.substring(0, 500));

  // 4. SQL injection path
  console.log("\n=== SQLi Path ===");
  const sqli = await fetch(BASE + "/api/db/incidents%27%20OR%201%3D1--");
  console.log("Status:", sqli.status);
  const sqliTxt = await sqli.text();
  console.log("Body:", sqliTxt.substring(0, 300));
})().catch(e => console.error(e.message));
