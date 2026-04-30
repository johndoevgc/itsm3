const BASE = 'https://vgc-itsm1-app.azurewebsites.net';
let pass = 0, fail = 0;

function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS:', name); }
  else { fail++; console.log('  FAIL:', name, '-', detail || ''); }
}

async function get(path) {
  const r = await fetch(BASE + path);
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('json') ? await r.json() : await r.text();
  return { status: r.status, body };
}

async function post(path, data) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('json') ? await r.json() : await r.text();
  return { status: r.status, body };
}

(async () => {
  console.log('=== LIVE PRODUCTION VERIFICATION ===');
  console.log('Target:', BASE);
  console.log('Time:', new Date().toISOString());
  console.log('');

  // 1. Health
  console.log('--- Health ---');
  const h = await get('/api/health');
  check('Health returns 200', h.status === 200);
  check('Version is 3.20', h.body.version === '3.20');
  check('Database connected', h.body.database === 'connected');
  check('AI configured', h.body.aiConfigured === true);
  check('AI model', h.body.aiModel === 'gpt-5.4-pro', 'Got: ' + h.body.aiModel);
  check('SLA engine running', h.body.slaEngineRunning === true);
  check('Workflow running', h.body.workflowStats?.running === true);
  check('Entra configured', h.body.entraConfigured === true);

  // 2. Frontend
  console.log('--- Frontend ---');
  const idx = await get('/');
  check('Index returns 200', idx.status === 200);
  check('Index has DOCTYPE', typeof idx.body === 'string' && idx.body.includes('<!DOCTYPE'));
  check('Index has app root', typeof idx.body === 'string' && idx.body.includes('id="root"'));
  check('Index has script tag', typeof idx.body === 'string' && idx.body.includes('<script'));

  // 3. Static assets
  console.log('--- Static Assets ---');
  if (typeof idx.body === 'string') {
    const jsMatch = idx.body.match(/src="(\/assets\/[^"]+\.js)"/);
    if (jsMatch) {
      const jsAsset = await get(jsMatch[1]);
      check('JS bundle loads (' + jsMatch[1] + ')', jsAsset.status === 200);
    }
    const cssMatch = idx.body.match(/href="(\/assets\/[^"]+\.css)"/);
    if (cssMatch) {
      const cssAsset = await get(cssMatch[1]);
      check('CSS bundle loads (' + cssMatch[1] + ')', cssAsset.status === 200);
    }
  }

  // 4. DB Stats
  console.log('--- DB Stats ---');
  const db = await get('/api/db-stats');
  check('DB stats returns 200', db.status === 200);
  check('Has incidents count', typeof db.body.incidents === 'number', 'Got: ' + db.body.incidents);
  console.log('  Data:', JSON.stringify(db.body));

  // 5. Collection APIs
  const collections = ['incidents', 'changes', 'problems', 'requests', 'assets', 'kb', 'services', 'customers'];
  console.log('--- Collection APIs ---');
  for (const col of collections) {
    const r = await get('/api/db/' + col);
    check(col + ' returns 200', r.status === 200);
    check(col + ' is array', Array.isArray(r.body), 'Type: ' + typeof r.body);
    console.log('    ' + col + ': ' + (Array.isArray(r.body) ? r.body.length + ' records' : 'not array'));
  }

  // 6. Validation - bad input
  console.log('--- Input Validation ---');
  const bad1 = await post('/api/db/incidents', { priority: 'Urgent' });
  check('Rejects incident without title (400)', bad1.status === 400, 'Status: ' + bad1.status);

  const bad2 = await post('/api/db/incidents', { title: 'Test', priority: 'INVALID_PRIORITY' });
  check('Rejects invalid priority (400)', bad2.status === 400, 'Status: ' + bad2.status);

  const bad3 = await post('/api/db/incidents', []);
  check('Rejects array body (400)', bad3.status === 400, 'Status: ' + bad3.status);

  // 7. Analytics
  console.log('--- Analytics ---');
  const an = await get('/api/analytics/executive-dashboard');
  check('Executive dashboard returns 200', an.status === 200);
  check('Has healthScore', typeof an.body.healthScore === 'number', 'Got: ' + an.body.healthScore);

  // 8. SLA
  console.log('--- SLA ---');
  const sla = await get('/api/sla/config');
  check('SLA config returns 200', sla.status === 200);

  // 9. Deep health
  console.log('--- Deep Health ---');
  const dh = await get('/api/deep-health');
  check('Deep health returns 200', dh.status === 200);
  check('Has checks array', Array.isArray(dh.body.checks));
  if (Array.isArray(dh.body.checks)) {
    const passed = dh.body.checks.filter(c => c.status === 'pass' || c.status === 'ok').length;
    console.log('  Deep health checks: ' + passed + '/' + dh.body.checks.length + ' passing');
  }

  // 10. Feature flags
  console.log('--- Feature Flags ---');
  const ff = await get('/api/feature-flags');
  check('Feature flags returns 200', ff.status === 200);

  // Summary
  console.log('');
  console.log('========================================');
  console.log('  PASSED: ' + pass + ' | FAILED: ' + fail + ' | TOTAL: ' + (pass + fail));
  console.log('========================================');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(2);
});
