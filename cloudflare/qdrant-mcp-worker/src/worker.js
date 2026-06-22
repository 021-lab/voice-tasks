const BASE_PATH = '/MCP/qdrant/user/MKhTjoZZXAlWGdyb3FYfIPZT3AYv4TQIc4ualUY9/';
const TEST_PATH = `${BASE_PATH}test`;
const INGEST_PATH = `${BASE_PATH}ingest`;
const VERIFY_PATH = `${BASE_PATH}verify`;
const HEALTH_JSON_PATH = '/health.json';

function corsHeaders(origin = '*') {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store'
  };
}

function json(data, status = 200, origin = '*') {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin)
    }
  });
}

function text(body, status = 200, origin = '*') {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ...corsHeaders(origin)
    }
  });
}

function html(body, status = 200, origin = '*') {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...corsHeaders(origin)
    }
  });
}

async function qdrant(env, path, method = 'GET', body) {
  if (!env.QDRANT_URL || !env.QDRANT_KEY) {
    throw new Error('Missing QDRANT_URL or QDRANT_KEY');
  }
  const response = await fetch(`${env.QDRANT_URL.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'api-key': env.QDRANT_KEY
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }
  if (!response.ok) {
    const err = new Error(`Qdrant ${method} ${path} -> ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function ensureCollection(env, name, vectorSize = 1) {
  try {
    await qdrant(env, `/collections/${name}`);
  } catch (error) {
    if (error.status !== 404) throw error;
    await qdrant(env, `/collections/${name}`, 'PUT', {
      vectors: { size: vectorSize, distance: 'Cosine' }
    });
  }
}

function buildSpec(origin) {
  return [
    'Qdrant MCP endpoint specification',
    '',
    `Base path: ${origin}${BASE_PATH}`,
    '',
    'Available HTTP endpoints:',
    `GET  ${BASE_PATH}`,
    '  Returns this text specification.',
    `GET  ${BASE_PATH}test`,
    '  Returns an HTML page that inserts a test point into Qdrant and verifies it.',
    `POST ${BASE_PATH}ingest`,
    '  Accepts JSON: {"collection":"...","id":"<uuid optional>","payload":{...},"vector":[0]}',
    '  Creates the collection when missing and upserts the point into Qdrant.',
    `GET  ${BASE_PATH}verify?collection=<name>&id=<point-id>`,
    '  Fetches the stored point back from Qdrant.',
    '',
    'Authentication model:',
    '- Browser clients do not receive the Qdrant key.',
    '- Qdrant credentials are stored in Cloudflare Worker secrets.',
    '',
    'CORS:',
    '- Enabled for browser-based testing.',
    '',
    'Expected Cloudflare secrets:',
    '- QDRANT_URL',
    '- QDRANT_KEY'
  ].join('\n');
}

function buildTestPage(origin) {
  const endpoint = `${origin}${BASE_PATH}`;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Qdrant MCP Test</title>
  <style>
    :root {
      --bg: #f6f1e8;
      --ink: #1f1d1a;
      --panel: rgba(255,255,255,0.82);
      --line: rgba(31,29,26,0.12);
      --accent: #c75b12;
      --accent-2: #146356;
      --danger: #9f1d35;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Iowan Old Style", serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(199,91,18,0.18), transparent 30%),
        radial-gradient(circle at bottom right, rgba(20,99,86,0.18), transparent 35%),
        var(--bg);
      min-height: 100vh;
    }
    .wrap {
      max-width: 960px;
      margin: 0 auto;
      padding: 32px 18px 48px;
    }
    .hero {
      margin-bottom: 24px;
      padding: 28px;
      border: 1px solid var(--line);
      border-radius: 24px;
      background: linear-gradient(135deg, rgba(255,255,255,0.9), rgba(255,255,255,0.72));
      box-shadow: 0 24px 60px rgba(31,29,26,0.08);
    }
    h1 {
      margin: 0 0 8px;
      font-size: clamp(2rem, 4vw, 3.7rem);
      line-height: 0.95;
      letter-spacing: -0.04em;
    }
    p {
      margin: 0;
      font-size: 1rem;
      line-height: 1.6;
      max-width: 60ch;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 18px;
      margin-bottom: 18px;
    }
    .card {
      padding: 20px;
      border-radius: 20px;
      border: 1px solid var(--line);
      background: var(--panel);
      backdrop-filter: blur(12px);
      box-shadow: 0 10px 30px rgba(31,29,26,0.06);
    }
    label {
      display: block;
      margin-bottom: 6px;
      font-size: 0.86rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: rgba(31,29,26,0.72);
    }
    input, textarea {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 14px;
      font: inherit;
      background: rgba(255,255,255,0.85);
      color: var(--ink);
    }
    textarea { min-height: 160px; resize: vertical; }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin: 20px 0;
    }
    button {
      border: none;
      border-radius: 999px;
      padding: 12px 18px;
      font: inherit;
      color: white;
      cursor: pointer;
      background: linear-gradient(135deg, var(--accent), #ef8b2c);
      box-shadow: 0 10px 24px rgba(199,91,18,0.24);
      transition: transform 160ms ease, box-shadow 160ms ease;
    }
    button.secondary {
      background: linear-gradient(135deg, var(--accent-2), #2f8f7d);
      box-shadow: 0 10px 24px rgba(20,99,86,0.24);
    }
    button:hover { transform: translateY(-1px); }
    .status {
      padding: 14px 16px;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.7);
      min-height: 54px;
    }
    .status.error {
      border-color: rgba(159,29,53,0.24);
      color: var(--danger);
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.5;
    }
    .foot {
      margin-top: 18px;
      color: rgba(31,29,26,0.68);
      font-size: 0.95rem;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>Qdrant write-check page</h1>
      <p>Эта страница отправляет тестовую запись в Cloudflare Worker, worker пишет её в Qdrant через секреты, затем страница тут же запрашивает точку обратно и показывает доказательство успешной записи.</p>
    </section>

    <section class="grid">
      <div class="card">
        <label for="collection">Collection</label>
        <input id="collection" value="mcp-test-points">
      </div>
      <div class="card">
        <label for="point-id">Point ID</label>
        <input id="point-id">
      </div>
      <div class="card" style="grid-column: 1 / -1;">
        <label for="payload">Payload JSON</label>
        <textarea id="payload"></textarea>
      </div>
    </section>

    <div class="actions">
      <button id="btn-run">Add And Verify</button>
      <button id="btn-random" class="secondary">Generate Sample</button>
    </div>

    <div id="status" class="status">Готово к проверке. Endpoint: ${endpoint}</div>

    <section class="grid" style="margin-top:18px;">
      <div class="card">
        <label>Ingest response</label>
        <pre id="ingest-out">-</pre>
      </div>
      <div class="card">
        <label>Verify response</label>
        <pre id="verify-out">-</pre>
      </div>
    </section>

    <p class="foot">Корень MCP endpoint: <a href="${endpoint}" target="_blank" rel="noreferrer">${endpoint}</a></p>
  </div>

  <script>
    const basePath = ${JSON.stringify(BASE_PATH)};
    const statusEl = document.getElementById('status');
    const collectionEl = document.getElementById('collection');
    const pointIdEl = document.getElementById('point-id');
    const payloadEl = document.getElementById('payload');
    const ingestOutEl = document.getElementById('ingest-out');
    const verifyOutEl = document.getElementById('verify-out');

    function fillSample() {
      const sampleId = crypto.randomUUID();
      pointIdEl.value = sampleId;
      payloadEl.value = JSON.stringify({
        id: sampleId,
        source: 'cloudflare-test-page',
        note: 'Inserted via Worker and then verified',
        createdAt: new Date().toISOString()
      }, null, 2);
    }

    function setStatus(text, isError) {
      statusEl.textContent = text;
      statusEl.className = isError ? 'status error' : 'status';
    }

    async function run() {
      setStatus('Отправляю точку в worker...', false);
      ingestOutEl.textContent = '-';
      verifyOutEl.textContent = '-';
      const collection = collectionEl.value.trim();
        const id = pointIdEl.value.trim();
      let payload;
      try {
        payload = JSON.parse(payloadEl.value);
      } catch (error) {
        setStatus('Payload JSON невалиден: ' + error.message, true);
        return;
      }
      try {
        const ingestRes = await fetch(basePath + 'ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collection, id, payload, vector: [0] })
        });
        const ingestJson = await ingestRes.json();
        ingestOutEl.textContent = JSON.stringify(ingestJson, null, 2);
        if (!ingestRes.ok || !ingestJson.ok) {
          throw new Error(ingestJson.error || 'Unknown ingest error');
        }

        setStatus('Проверяю, что точка читается из Qdrant...', false);
        const verifyRes = await fetch(basePath + 'verify?collection=' + encodeURIComponent(collection) + '&id=' + encodeURIComponent(id));
        const verifyJson = await verifyRes.json();
        verifyOutEl.textContent = JSON.stringify(verifyJson, null, 2);
        if (!verifyRes.ok || !verifyJson.ok || !verifyJson.result) {
          throw new Error(verifyJson.error || 'Verification failed');
        }
        setStatus('Успешно: точка добавлена в Qdrant и прочитана обратно.', false);
      } catch (error) {
        setStatus('Ошибка: ' + error.message, true);
      }
    }

    document.getElementById('btn-random').addEventListener('click', fillSample);
    document.getElementById('btn-run').addEventListener('click', run);
    fillSample();
  </script>
</body>
</html>`;
}

function buildHealthPage(origin) {
  const baseUrl = `${origin}${BASE_PATH}`;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Qdrant Health Check</title>
  <style>
    :root {
      --bg: #101418;
      --panel: #182028;
      --panel-2: #0f1720;
      --line: rgba(255,255,255,0.1);
      --text: #e6edf3;
      --muted: #8aa0b5;
      --accent: #36c2a6;
      --accent-2: #4d88ff;
      --danger: #ff6b6b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(77,136,255,0.18), transparent 30%),
        radial-gradient(circle at bottom right, rgba(54,194,166,0.16), transparent 35%),
        var(--bg);
      min-height: 100vh;
    }
    .wrap {
      max-width: 980px;
      margin: 0 auto;
      padding: 28px 18px 40px;
    }
    .hero, .card {
      background: linear-gradient(180deg, rgba(24,32,40,0.95), rgba(15,23,32,0.98));
      border: 1px solid var(--line);
      border-radius: 22px;
      box-shadow: 0 24px 80px rgba(0,0,0,0.28);
    }
    .hero {
      padding: 24px;
      margin-bottom: 18px;
    }
    .hero h1 {
      margin: 0 0 10px;
      font-size: clamp(2rem, 5vw, 3.6rem);
      line-height: 0.94;
      letter-spacing: -0.04em;
    }
    .hero p {
      margin: 0;
      color: var(--muted);
      line-height: 1.6;
      max-width: 70ch;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }
    .card {
      padding: 18px;
    }
    .label {
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin-bottom: 8px;
    }
    input, textarea {
      width: 100%;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.04);
      color: var(--text);
      padding: 12px 14px;
      font: inherit;
    }
    textarea {
      min-height: 160px;
      resize: vertical;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin: 18px 0;
    }
    button {
      border: none;
      border-radius: 999px;
      padding: 12px 18px;
      color: white;
      font: inherit;
      cursor: pointer;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
    }
    .status {
      padding: 14px 16px;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.04);
      min-height: 56px;
      line-height: 1.5;
    }
    .status.error {
      color: var(--danger);
      border-color: rgba(255,107,107,0.35);
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.5;
    }
    a { color: #7bc6ff; }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>Qdrant health page</h1>
      <p>Эта страница проверяет не только доступность worker, но и реальную запись в Qdrant: JavaScript на странице вызывает endpoint'ы worker, worker сохраняет тестовую точку в Qdrant и затем читает её обратно.</p>
    </section>

    <section class="grid">
      <div class="card">
        <div class="label">Collection</div>
        <input id="collection" value="mcp-health-check">
      </div>
      <div class="card">
        <div class="label">Point ID</div>
        <input id="point-id">
      </div>
      <div class="card" style="grid-column: 1 / -1;">
        <div class="label">Payload JSON</div>
        <textarea id="payload"></textarea>
      </div>
    </section>

    <div class="actions">
      <button id="btn-run">Run Qdrant Save Check</button>
      <button id="btn-random">Generate New Payload</button>
    </div>

    <div id="status" class="status">Готово. Нажмите кнопку или дождитесь автозапуска.</div>

    <section class="grid" style="margin-top:18px;">
      <div class="card">
        <div class="label">Health JSON</div>
        <pre id="health-out">-</pre>
      </div>
      <div class="card">
        <div class="label">Ingest Response</div>
        <pre id="ingest-out">-</pre>
      </div>
      <div class="card" style="grid-column: 1 / -1;">
        <div class="label">Verify Response</div>
        <pre id="verify-out">-</pre>
      </div>
    </section>

    <p style="margin-top:16px;color:var(--muted)">Worker endpoint: <a href="${baseUrl}" target="_blank" rel="noreferrer">${baseUrl}</a></p>
  </div>

  <script>
    const basePath = ${JSON.stringify(BASE_PATH)};
    const healthJsonPath = ${JSON.stringify(HEALTH_JSON_PATH)};
    const collectionEl = document.getElementById('collection');
    const pointIdEl = document.getElementById('point-id');
    const payloadEl = document.getElementById('payload');
    const statusEl = document.getElementById('status');
    const healthOutEl = document.getElementById('health-out');
    const ingestOutEl = document.getElementById('ingest-out');
    const verifyOutEl = document.getElementById('verify-out');

    function setStatus(text, isError) {
      statusEl.textContent = text;
      statusEl.className = isError ? 'status error' : 'status';
    }

    function fillSample() {
      const id = crypto.randomUUID();
      pointIdEl.value = id;
      payloadEl.value = JSON.stringify({
        id,
        source: 'health-page-js',
        note: 'Saved by JS on /health via worker endpoints',
        createdAt: new Date().toISOString()
      }, null, 2);
    }

    async function run() {
      setStatus('Проверяю health JSON...', false);
      healthOutEl.textContent = '-';
      ingestOutEl.textContent = '-';
      verifyOutEl.textContent = '-';
      const collection = collectionEl.value.trim();
      const id = pointIdEl.value.trim();
      let payload;
      try {
        payload = JSON.parse(payloadEl.value);
      } catch (error) {
        setStatus('Payload JSON невалиден: ' + error.message, true);
        return;
      }

      try {
        const healthRes = await fetch(healthJsonPath);
        const healthJson = await healthRes.json();
        healthOutEl.textContent = JSON.stringify(healthJson, null, 2);
        if (!healthRes.ok || !healthJson.ok) {
          throw new Error(healthJson.error || 'Health JSON failed');
        }

        setStatus('Сохраняю тестовую точку в Qdrant через /ingest...', false);
        const ingestRes = await fetch(basePath + 'ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collection, id, payload, vector: [0] })
        });
        const ingestJson = await ingestRes.json();
        ingestOutEl.textContent = JSON.stringify(ingestJson, null, 2);
        if (!ingestRes.ok || !ingestJson.ok) {
          throw new Error(ingestJson.error || 'Ingest failed');
        }

        setStatus('Читаю сохранённую точку из Qdrant через /verify...', false);
        const verifyRes = await fetch(basePath + 'verify?collection=' + encodeURIComponent(collection) + '&id=' + encodeURIComponent(id));
        const verifyJson = await verifyRes.json();
        verifyOutEl.textContent = JSON.stringify(verifyJson, null, 2);
        if (!verifyRes.ok || !verifyJson.ok || !verifyJson.result) {
          throw new Error(verifyJson.error || 'Verify failed');
        }

        setStatus('Успешно: JavaScript на /health вызвал worker, worker сохранил точку в Qdrant и прочитал её обратно.', false);
      } catch (error) {
        setStatus('Ошибка: ' + error.message, true);
      }
    }

    document.getElementById('btn-random').addEventListener('click', () => {
      fillSample();
      run();
    });
    document.getElementById('btn-run').addEventListener('click', run);
    fillSample();
    run();
  </script>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === '/health') {
      return html(buildHealthPage(url.origin), 200, origin);
    }

    if (url.pathname === HEALTH_JSON_PATH) {
      try {
        const info = await qdrant(env, '/collections');
        return json({
          ok: true,
          qdrantReachable: true,
          collectionsCount: Array.isArray(info.result?.collections) ? info.result.collections.length : null
        }, 200, origin);
      } catch (error) {
        return json({
          ok: false,
          qdrantReachable: false,
          error: error.message,
          details: error.data || null
        }, 500, origin);
      }
    }

    if (url.pathname === '/') {
      return html(
        `<html><body style="font-family:sans-serif;padding:24px"><h1>Qdrant MCP Worker</h1><p><a href="${BASE_PATH}">Open MCP spec</a></p><p><a href="${TEST_PATH}">Open test page</a></p></body></html>`,
        200,
        origin
      );
    }

    if (url.pathname === BASE_PATH) {
      return text(buildSpec(url.origin), 200, origin);
    }

    if (url.pathname === TEST_PATH || url.pathname === `${TEST_PATH}/`) {
      return html(buildTestPage(url.origin), 200, origin);
    }

    if (url.pathname === INGEST_PATH && request.method === 'POST') {
      try {
        const body = await request.json();
        const collection = String(body.collection || '').trim();
        const id = String(body.id || '').trim() || crypto.randomUUID();
        const payload = body.payload && typeof body.payload === 'object' ? body.payload : null;
        const vector = Array.isArray(body.vector) && body.vector.length ? body.vector : [0];

        if (!collection) return json({ ok: false, error: 'collection is required' }, 400, origin);
        if (!id) return json({ ok: false, error: 'id is required' }, 400, origin);
        if (!payload) return json({ ok: false, error: 'payload object is required' }, 400, origin);

        await ensureCollection(env, collection, vector.length);
        const upsert = await qdrant(env, `/collections/${collection}/points?wait=true`, 'PUT', {
          points: [{ id, vector, payload }]
        });
        return json({
          ok: true,
          collection,
          id,
          result: upsert.result || null,
          operationId: upsert.result?.operation_id || null
        }, 200, origin);
      } catch (error) {
        return json({
          ok: false,
          error: error.message,
          details: error.data || null
        }, 500, origin);
      }
    }

    if (url.pathname === VERIFY_PATH && request.method === 'GET') {
      try {
        const collection = String(url.searchParams.get('collection') || '').trim();
        const id = String(url.searchParams.get('id') || '').trim();
        if (!collection) return json({ ok: false, error: 'collection is required' }, 400, origin);
        if (!id) return json({ ok: false, error: 'id is required' }, 400, origin);
        const result = await qdrant(env, `/collections/${collection}/points`, 'POST', {
          ids: [id],
          with_payload: true,
          with_vector: true
        });
        return json({
          ok: true,
          collection,
          id,
          result: Array.isArray(result.result) ? result.result[0] || null : null
        }, 200, origin);
      } catch (error) {
        return json({
          ok: false,
          error: error.message,
          details: error.data || null
        }, 500, origin);
      }
    }

    return json({ ok: false, error: 'Not found' }, 404, origin);
  }
};
