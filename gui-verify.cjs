const BASE = 'https://vgc-itsm1-app.azurewebsites.net';
const tests = [
  { name: 'Health', url: '/api/health' },
  { name: 'DB Stats', url: '/api/db-stats' },
  { name: 'Incidents', url: '/api/db/incidents' },
  { name: 'Users', url: '/api/db/users' },
  { name: 'Assets', url: '/api/db/assets' },
  { name: 'KB', url: '/api/db/kb' },
  { name: 'Services', url: '/api/db/services' },
  { name: 'Audit', url: '/api/audit?limit=5' },
  { name: 'AI Settings', url: '/api/settings/openai' },
  { name: 'AI Test', url: '/api/ai/test' },
  { name: 'Frontend', url: '/' },
];

(async () => {
  console.log("====== GUI Feature Verification ======\n");
  let pass = 0, fail = 0;

  for (const t of tests) {
    try {
      const r = await fetch(BASE + t.url);
      if (t.name === 'Frontend') {
        const html = await r.text();
        // Version/branding are in the JS bundle (React-rendered), not in the HTML shell
        const jsUrl = html.match(/src="([^"]*index-[^"]+\.js)"/)?.[1];
        let jsText = '';
        if (jsUrl) {
          jsText = await (await fetch(BASE + '/' + jsUrl.replace(/^\//, ''))).text();
        }
        const checks = [
          ['React root div', html.includes('id="root"')],
          ['Version 3.8.1', jsText.includes('3.8.1')],
          ['VGC-AI branding', jsText.includes('VGC-AI')],
          ['Login page renders', html.includes('VGC-ITSM') || jsText.includes('VGC-ITSM')],
          ['JS bundle loaded', !!jsUrl],
        ];
        for (const [label, ok] of checks) {
          console.log((ok ? 'PASS' : 'FAIL') + ': Frontend — ' + label);
          ok ? pass++ : fail++;
        }
      } else {
        const d = await r.json();
        const ok = r.ok;
        let detail = '';
        if (Array.isArray(d)) detail = d.length + ' records';
        else if (t.name === 'Health') {
          detail = 'status=' + d.status + ' db=' + d.database + ' ai=' + d.aiConfigured;
        } else if (t.name === 'DB Stats') {
          const colls = Object.keys(d).filter(k => typeof d[k] === 'number');
          detail = colls.map(c => c + ':' + d[c]).join(', ');
        } else {
          detail = JSON.stringify(d).substring(0, 80);
        }
        console.log((ok ? 'PASS' : 'FAIL') + ': ' + t.name + ' — ' + detail);
        ok ? pass++ : fail++;
      }
    } catch (e) {
      console.log('FAIL: ' + t.name + ' — ' + e.message);
      fail++;
    }
  }

  // Additional feature checks
  console.log("\n--- Feature-Specific Checks ---");

  // Check incident detail
  try {
    const incs = await (await fetch(BASE + '/api/db/incidents')).json();
    if (incs.length > 0) {
      const detail = await (await fetch(BASE + '/api/db/incidents/' + incs[0].id)).json();
      const ok = detail && detail.title;
      console.log((ok ? 'PASS' : 'FAIL') + ': Incident Detail — id=' + detail.id + ' title=' + (detail.title || '').substring(0, 40));
      ok ? pass++ : fail++;
    }
  } catch (e) { console.log('FAIL: Incident Detail — ' + e.message); fail++; }

  // Check AI chat
  try {
    const r = await fetch(BASE + '/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemPrompt: 'You are a helpful IT assistant. Reply briefly.', userPrompt: 'Hello' })
    });
    const d = await r.json();
    const ok = r.ok && d.text && d.text.length > 5;
    console.log((ok ? 'PASS' : 'FAIL') + ': AI Chat Response — ' + (d.text || '').substring(0, 60) + '...');
    ok ? pass++ : fail++;
  } catch (e) { console.log('FAIL: AI Chat — ' + e.message); fail++; }

  // Check SPA routing (unknown paths should return index.html)
  try {
    const r = await fetch(BASE + '/dashboard');
    const html = await r.text();
    const ok = r.status === 200 && html.includes('id="root"');
    console.log((ok ? 'PASS' : 'FAIL') + ': SPA Routing — /dashboard returns React app');
    ok ? pass++ : fail++;
  } catch (e) { console.log('FAIL: SPA Routing — ' + e.message); fail++; }

  // Check invalid collection returns 400
  try {
    const r = await fetch(BASE + '/api/db/invalid_xyz');
    const ok = r.status === 400;
    console.log((ok ? 'PASS' : 'FAIL') + ': Security — Invalid collection returns ' + r.status);
    ok ? pass++ : fail++;
  } catch (e) { console.log('FAIL: Security — ' + e.message); fail++; }

  console.log("\n====== RESULTS ======");
  console.log("PASSED: " + pass + " | FAILED: " + fail + " | TOTAL: " + (pass + fail));
  process.exit(fail > 0 ? 1 : 0);
})();
