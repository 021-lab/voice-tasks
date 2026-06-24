const BASE_PATH = '/MCP/qdrant/user/MKhTjoZZXAlWGdyb3FYfIPZT3AYv4TQIc4ualUY9/';
const TEST_PATH = `${BASE_PATH}test`;
const INGEST_PATH = `${BASE_PATH}ingest`;
const VERIFY_PATH = `${BASE_PATH}verify`;
const V2_PREFIX = '/MCP/qdrant2/user/';
const HEALTH_JSON_PATH = '/health.json';
const ALLOWED_BROWSER_ORIGINS = new Set([
  'https://021-lab.github.io'
]);
const DEMO_USERS = [
  'MKhTjoZZXAlWGdyb3FYfIPZT3AYv4TQIc4ualUY9',
  'Claude-AlWGdyb3FYfIPZT3A'
];

function corsHeaders(origin = '*') {
  const allowOrigin = ALLOWED_BROWSER_ORIGINS.has(origin) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
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

function errJson(error, origin = '*', status = 500) {
  return json({
    ok: false,
    error: error.message,
    details: error.data || null
  }, status, origin);
}

function parseJsonOrNull(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return null;
  }
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

function normalizeUser(user) {
  const value = String(user || '').trim();
  if (!/^[A-Za-z0-9_-]{6,120}$/.test(value)) {
    const error = new Error('Invalid user name in /user/... path');
    error.status = 400;
    throw error;
  }
  return value;
}

function physicalCollectionName(user, logicalCollection) {
  const logical = String(logicalCollection || '').trim();
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(logical)) {
    const error = new Error('Invalid collection name');
    error.status = 400;
    throw error;
  }
  return `${logical}.${user}`;
}

function logicalCollectionName(user, physicalCollection) {
  const suffix = `.${user}`;
  return physicalCollection.endsWith(suffix)
    ? physicalCollection.slice(0, -suffix.length)
    : null;
}

async function listAllCollections(env) {
  const result = await qdrant(env, '/collections');
  return Array.isArray(result.result?.collections) ? result.result.collections : [];
}

async function listUserCollections(env, user) {
  const collections = await listAllCollections(env);
  return collections
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(`.${user}`))
    .map((physical) => ({
      logical: logicalCollectionName(user, physical),
      physical
    }))
    .filter((entry) => entry.logical);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeScopedData(value, user) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeScopedData(item, user));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, sanitizeScopedData(inner, user)])
    );
  }
  if (typeof value === 'string') {
    return value.replace(new RegExp(`\\.${escapeRegExp(user)}\\b`, 'g'), '');
  }
  return value;
}

function rewriteCollectionsListResponse(data, user) {
  if (!data?.result?.collections || !Array.isArray(data.result.collections)) return data;
  return {
    ...data,
    result: {
      ...data.result,
      collections: data.result.collections
        .filter((entry) => typeof entry?.name === 'string' && entry.name.endsWith(`.${user}`))
        .map((entry) => ({
          ...entry,
          name: logicalCollectionName(user, entry.name)
        }))
        .filter((entry) => entry.name)
    }
  };
}

function rewriteQdrantResponseForUser(data, user, route) {
  if (route[0] === 'collections' && route.length === 1) {
    return rewriteCollectionsListResponse(data, user);
  }
  return sanitizeScopedData(data, user);
}

function buildScopedQdrantPath(user, route) {
  if (!route.length) return '/';
  const nextRoute = [...route];
  if (nextRoute[0] === 'collections' && nextRoute[1]) {
    nextRoute[1] = encodeURIComponent(physicalCollectionName(user, decodeURIComponent(nextRoute[1])));
  }
  return `/${nextRoute.join('/')}`;
}

async function proxyQdrantJson(env, pathWithQuery, method, bodyText) {
  let body;
  if (bodyText !== undefined && bodyText !== null && bodyText !== '') {
    body = parseJsonOrNull(bodyText);
    if (body === null) {
      const error = new Error('Only JSON request bodies are supported in this MCP mirror');
      error.status = 400;
      throw error;
    }
  }
  return qdrant(env, pathWithQuery, method, body);
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
    `GET  ${BASE_PATH}verify?collection=<name>&id=<point-id>`,
    '  Reads the stored point back from Qdrant.',
    '',
    'V2 scoped endpoint:',
    `GET  ${origin}${V2_PREFIX}<user>/`,
    '  Returns the V2 specification with collection scoping by user name from /user/...',
    '',
    'Authentication model:',
    '- Browser clients do not receive the Qdrant key.',
    '- Qdrant credentials are stored in Cloudflare Worker secrets.'
  ].join('\n');
}

function buildV2Spec(origin, user) {
  const base = `${origin}${V2_PREFIX}${user}/`;
  return [
    'Qdrant MCP v2 user-scoped specification',
    '',
    'Reference docs:',
    '- https://api.qdrant.tech/api-reference',
    '- https://qdrant.tech/documentation/',
    '',
    `User detected from URL: ${user}`,
    `Base path: ${base}`,
    '',
    'Mirror contract:',
    '- This endpoint mirrors the basic Qdrant REST API for collection and point operations.',
    '- The user works only with collection names as they are requested through this endpoint.',
    '- GET /collections returns only collections available to this URL-scoped user.',
    '',
    'Examples of mirrored paths:',
    `- PUT    ${base}collections/new-collection`,
    `- PATCH  ${base}collections/new-collection`,
    `- DELETE ${base}collections/new-collection`,
    `- PUT    ${base}collections/new-collection/points`,
    `- POST   ${base}collections/new-collection/points`,
    `- POST   ${base}collections/new-collection/points/scroll`,
    `- POST   ${base}collections/new-collection/points/query`,
    '',
    'Non-mirrored helpers:',
    `- GET ${base}`,
    `- GET ${base}test`
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
    :root { --bg:#f6f1e8; --ink:#1f1d1a; --panel:rgba(255,255,255,.82); --line:rgba(31,29,26,.12); --accent:#c75b12; --accent-2:#146356; --danger:#9f1d35; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Georgia,"Iowan Old Style",serif; color:var(--ink); background:radial-gradient(circle at top left, rgba(199,91,18,.18), transparent 30%), radial-gradient(circle at bottom right, rgba(20,99,86,.18), transparent 35%), var(--bg); min-height:100vh; }
    .wrap { max-width:960px; margin:0 auto; padding:32px 18px 48px; }
    .hero,.card { border:1px solid var(--line); border-radius:24px; background:linear-gradient(135deg, rgba(255,255,255,.9), rgba(255,255,255,.72)); box-shadow:0 24px 60px rgba(31,29,26,.08); }
    .hero { margin-bottom:24px; padding:28px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:18px; margin-bottom:18px; }
    .card { padding:20px; }
    label { display:block; margin-bottom:6px; font-size:.86rem; text-transform:uppercase; letter-spacing:.08em; color:rgba(31,29,26,.72); }
    input,textarea { width:100%; padding:12px 14px; border:1px solid var(--line); border-radius:14px; font:inherit; background:rgba(255,255,255,.85); color:var(--ink); }
    textarea { min-height:160px; resize:vertical; }
    .actions { display:flex; flex-wrap:wrap; gap:12px; margin:20px 0; }
    button { border:none; border-radius:999px; padding:12px 18px; font:inherit; color:white; cursor:pointer; background:linear-gradient(135deg, var(--accent), #ef8b2c); }
    button.secondary { background:linear-gradient(135deg, var(--accent-2), #2f8f7d); }
    .status { padding:14px 16px; border-radius:16px; border:1px solid var(--line); background:rgba(255,255,255,.7); min-height:54px; }
    .status.error { border-color:rgba(159,29,53,.24); color:var(--danger); }
    pre { margin:0; white-space:pre-wrap; word-break:break-word; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; line-height:1.5; }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>Qdrant write-check page</h1>
      <p>Эта страница пишет тестовую запись в worker V1 и проверяет, что она читается обратно из Qdrant.</p>
    </section>
    <section class="grid">
      <div class="card"><label for="collection">Collection</label><input id="collection" value="mcp-test-points"></div>
      <div class="card"><label for="point-id">Point ID</label><input id="point-id"></div>
      <div class="card" style="grid-column: 1 / -1;"><label for="payload">Payload JSON</label><textarea id="payload"></textarea></div>
    </section>
    <div class="actions">
      <button id="btn-run">Add And Verify</button>
      <button id="btn-random" class="secondary">Generate Sample</button>
    </div>
    <div id="status" class="status">Готово к проверке. Endpoint: ${endpoint}</div>
    <section class="grid" style="margin-top:18px;">
      <div class="card"><label>Ingest response</label><pre id="ingest-out">-</pre></div>
      <div class="card"><label>Verify response</label><pre id="verify-out">-</pre></div>
    </section>
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
      payloadEl.value = JSON.stringify({ id: sampleId, source: 'cloudflare-test-page', note: 'Inserted via Worker and then verified', createdAt: new Date().toISOString() }, null, 2);
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
      const payload = ${'null'};
      let parsedPayload;
      try { parsedPayload = JSON.parse(payloadEl.value); } catch (error) { setStatus('Payload JSON невалиден: ' + error.message, true); return; }
      try {
        const ingestRes = await fetch(basePath + 'ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collection, id, payload: parsedPayload, vector: [0] }) });
        const ingestJson = await ingestRes.json();
        ingestOutEl.textContent = JSON.stringify(ingestJson, null, 2);
        if (!ingestRes.ok || !ingestJson.ok) throw new Error(ingestJson.error || 'Unknown ingest error');
        const verifyRes = await fetch(basePath + 'verify?collection=' + encodeURIComponent(collection) + '&id=' + encodeURIComponent(id));
        const verifyJson = await verifyRes.json();
        verifyOutEl.textContent = JSON.stringify(verifyJson, null, 2);
        if (!verifyRes.ok || !verifyJson.ok || !verifyJson.result) throw new Error(verifyJson.error || 'Verification failed');
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

function buildUserTestPage(origin, user) {
  const base = `${origin}${V2_PREFIX}${user}/`;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Qdrant2 User Test</title>
</head>
<body style="font-family:sans-serif;padding:24px">
  <h1>Qdrant2 user-scoped test</h1>
  <p>User from URL: <strong>${user}</strong></p>
  <p>Base: <a href="${base}">${base}</a></p>
  <p>Mirror docs: <a href="https://api.qdrant.tech/api-reference">https://api.qdrant.tech/api-reference</a></p>
  <p>Use mirrored paths like <code>PUT ${base}collections/new-collection</code> and <code>PUT ${base}collections/new-collection/points</code>.</p>
</body>
</html>`;
}

function buildHealthPage(origin) {
  const scopedBase = `${origin}${V2_PREFIX}`;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Qdrant2 Access Test</title>
  <style>
    :root { --bg:#101418; --panel:#182028; --line:rgba(255,255,255,.1); --text:#e6edf3; --muted:#8aa0b5; --accent:#36c2a6; --accent2:#4d88ff; --danger:#ff6b6b; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--text); background:radial-gradient(circle at top left, rgba(77,136,255,.18), transparent 30%), radial-gradient(circle at bottom right, rgba(54,194,166,.16), transparent 35%), var(--bg); min-height:100vh; }
    .wrap { max-width:1100px; margin:0 auto; padding:28px 18px 40px; }
    .hero,.card { background:linear-gradient(180deg, rgba(24,32,40,.95), rgba(15,23,32,.98)); border:1px solid var(--line); border-radius:22px; box-shadow:0 24px 80px rgba(0,0,0,.28); }
    .hero { padding:24px; margin-bottom:18px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:16px; }
    .card { padding:18px; }
    .actions { display:flex; flex-wrap:wrap; gap:12px; margin:18px 0; }
    button { border:none; border-radius:999px; padding:12px 18px; color:white; font:inherit; cursor:pointer; background:linear-gradient(135deg, var(--accent), var(--accent2)); }
    .status { padding:14px 16px; border-radius:16px; border:1px solid var(--line); background:rgba(255,255,255,.04); min-height:56px; line-height:1.5; }
    .status.error { color:var(--danger); border-color:rgba(255,107,107,.35); }
    pre { margin:0; white-space:pre-wrap; word-break:break-word; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; line-height:1.5; }
    .meta { color:var(--muted); }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>Qdrant2 access test</h1>
      <p class="meta">Страница прогоняет mirror-тест для двух пользователей через пути Qdrant API. Каждый пользователь работает только со своими именами коллекций и видит только свои данные через свой URL.</p>
    </section>
    <div class="actions">
      <button id="btn-run">Run visibility test</button>
      <button id="btn-rerun">Run with fresh IDs</button>
    </div>
    <div id="status" class="status">Готово. Нажмите Run visibility test.</div>
    <section class="grid" style="margin-top:18px;">
      <div class="card"><div class="meta">Health JSON</div><pre id="health-out">-</pre></div>
      <div class="card"><div class="meta">User A result</div><pre id="user-a-out">-</pre></div>
      <div class="card"><div class="meta">User B result</div><pre id="user-b-out">-</pre></div>
      <div class="card" style="grid-column:1 / -1;"><div class="meta">Visibility assertions</div><pre id="assert-out">-</pre></div>
    </section>
  </div>
  <script>
    const healthJsonPath = ${JSON.stringify(HEALTH_JSON_PATH)};
    const basePrefix = ${JSON.stringify(scopedBase)};
    const users = ${JSON.stringify(DEMO_USERS)};
    const statusEl = document.getElementById('status');
    const healthOutEl = document.getElementById('health-out');
    const userAOutEl = document.getElementById('user-a-out');
    const userBOutEl = document.getElementById('user-b-out');
    const assertOutEl = document.getElementById('assert-out');

    function setStatus(text, isError) {
      statusEl.textContent = text;
      statusEl.className = isError ? 'status error' : 'status';
    }

    function testData(user) {
      const suffix = user === users[0] ? 'alpha' : 'bravo';
      return {
        sharedCollection: 'new-collection',
        privateCollection: 'private-' + suffix,
        id: crypto.randomUUID(),
        payload: {
          note: 'scoped test for ' + user,
          createdAt: new Date().toISOString()
        }
      };
    }

    async function runForUser(user) {
      const data = testData(user);
      const base = basePrefix + encodeURIComponent(user) + '/';
      const createSharedRes = await fetch(base + 'collections/' + encodeURIComponent(data.sharedCollection), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vectors: { size: 1, distance: 'Cosine' } })
      });
      const createPrivateRes = await fetch(base + 'collections/' + encodeURIComponent(data.privateCollection), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vectors: { size: 1, distance: 'Cosine' } })
      });
      const createdShared = await createSharedRes.json();
      const createdPrivate = await createPrivateRes.json();
      const addRes = await fetch(base + 'collections/' + encodeURIComponent(data.sharedCollection) + '/points?wait=true', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: [{ id: data.id, vector: [0], payload: data.payload }] })
      });
      const added = await addRes.json();
      const listRes = await fetch(base + 'collections');
      const listed = await listRes.json();
      const verifyRes = await fetch(base + 'collections/' + encodeURIComponent(data.sharedCollection) + '/points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [data.id], with_payload: true, with_vector: true })
      });
      const verified = await verifyRes.json();
      return { base, data, createdShared, createdPrivate, added, listed, verified };
    }

    async function runAll() {
      setStatus('Проверяю доступность worker и Qdrant...', false);
      healthOutEl.textContent = '-';
      userAOutEl.textContent = '-';
      userBOutEl.textContent = '-';
      assertOutEl.textContent = '-';
      try {
        const healthRes = await fetch(healthJsonPath);
        const healthJson = await healthRes.json();
        healthOutEl.textContent = JSON.stringify(healthJson, null, 2);
        if (!healthRes.ok || !healthJson.ok) throw new Error(healthJson.error || 'Health failed');

        setStatus('Создаю коллекции и записи для двух пользователей...', false);
        const first = await runForUser(users[0]);
        const second = await runForUser(users[1]);
        userAOutEl.textContent = JSON.stringify(first, null, 2);
        userBOutEl.textContent = JSON.stringify(second, null, 2);

        const aCollections = new Set(((first.listed.result && first.listed.result.collections) || []).map((entry) => entry.name));
        const bCollections = new Set(((second.listed.result && second.listed.result.collections) || []).map((entry) => entry.name));
        const checks = {
          userASeesSharedLogicalCollection: aCollections.has(first.data.sharedCollection),
          userASeesOwnPrivateCollection: aCollections.has(first.data.privateCollection),
          userASeesUserBPrivateCollection: aCollections.has(second.data.privateCollection),
          userBSeesSharedLogicalCollection: bCollections.has(second.data.sharedCollection),
          userBSeesOwnPrivateCollection: bCollections.has(second.data.privateCollection),
          userBSeesUserAPrivateCollection: bCollections.has(first.data.privateCollection),
          userAVerifyOk: Array.isArray(first.verified.result) && first.verified.result.length === 1,
          userBVerifyOk: Array.isArray(second.verified.result) && second.verified.result.length === 1
        };
        assertOutEl.textContent = JSON.stringify(checks, null, 2);

        if (!checks.userASeesSharedLogicalCollection || !checks.userASeesOwnPrivateCollection || checks.userASeesUserBPrivateCollection || !checks.userBSeesSharedLogicalCollection || !checks.userBSeesOwnPrivateCollection || checks.userBSeesUserAPrivateCollection || !checks.userAVerifyOk || !checks.userBVerifyOk) {
          throw new Error('Visibility restriction test failed');
        }
        setStatus('Успешно: mirror API работает, общая коллекция доступна обоим через их URL, приватные коллекции изолированы, а пользователь видит только своё пространство имён.', false);
      } catch (error) {
        setStatus('Ошибка: ' + error.message, true);
      }
    }

    document.getElementById('btn-run').addEventListener('click', runAll);
    document.getElementById('btn-rerun').addEventListener('click', runAll);
    runAll();
  </script>
</body>
</html>`;
}

function parseV2Request(pathname) {
  if (!pathname.startsWith(V2_PREFIX)) return null;
  const suffix = pathname.slice(V2_PREFIX.length);
  const parts = suffix.split('/').filter(Boolean);
  if (!parts.length) return null;
  return {
    user: normalizeUser(parts[0]),
    route: parts.slice(1)
  };
}

async function handleV1(request, env, url, origin) {
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
      if (!payload) return json({ ok: false, error: 'payload object is required' }, 400, origin);
      await ensureCollection(env, collection, vector.length);
      const upsert = await qdrant(env, `/collections/${collection}/points?wait=true`, 'PUT', {
        points: [{ id, vector, payload }]
      });
      return json({ ok: true, collection, id, result: upsert.result || null, operationId: upsert.result?.operation_id || null }, 200, origin);
    } catch (error) {
      return errJson(error, origin);
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
      return json({ ok: true, collection, id, result: Array.isArray(result.result) ? result.result[0] || null : null }, 200, origin);
    } catch (error) {
      return errJson(error, origin);
    }
  }
  return null;
}

async function handleV2(request, env, url, origin) {
  const parsed = parseV2Request(url.pathname);
  if (!parsed) return null;
  const { user, route } = parsed;
  const routeKey = route.join('/');

  if (!route.length || (route.length === 1 && route[0] === '')) {
    return text(buildV2Spec(url.origin, user), 200, origin);
  }
  if (routeKey === 'test') {
    return html(buildUserTestPage(url.origin, user), 200, origin);
  }
  if (!route.length || route[0] !== 'collections') {
    return json({
      status: {
        error: 'This V2 mirror currently supports the basic Qdrant collection and point API under /collections/...'
      },
      time: 0
    }, 404, origin);
  }
  try {
    if (route.length === 1 && request.method === 'GET') {
      const upstream = await qdrant(env, '/collections');
      return json(rewriteCollectionsListResponse(upstream, user), 200, origin);
    }
    const bodyText = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
    const scopedPath = buildScopedQdrantPath(user, route);
    const upstream = await proxyQdrantJson(env, `${scopedPath}${url.search}`, request.method, bodyText);
    return json(rewriteQdrantResponseForUser(upstream, user, route), 200, origin);
  } catch (error) {
    const status = error.status || 500;
    const payload = error.data ? rewriteQdrantResponseForUser(error.data, user, route) : {
      status: { error: sanitizeScopedData(error.message, user) },
      time: 0
    };
    return json(payload, status, origin);
  }
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
          collectionsCount: Array.isArray(info.result?.collections) ? info.result.collections.length : null,
          demoUsers: DEMO_USERS
        }, 200, origin);
      } catch (error) {
        return errJson(error, origin);
      }
    }

    if (url.pathname === '/') {
      return html(
        `<html><body style="font-family:sans-serif;padding:24px"><h1>Qdrant MCP Worker</h1><p><a href="${BASE_PATH}">Open V1 spec</a></p><p><a href="${url.origin}/health">Open V2 health test</a></p><p><a href="${url.origin}${V2_PREFIX}${DEMO_USERS[0]}/">Open V2 user spec</a></p></body></html>`,
        200,
        origin
      );
    }

    const v1 = await handleV1(request, env, url, origin);
    if (v1) return v1;

    const v2 = await handleV2(request, env, url, origin);
    if (v2) return v2;

    return json({ ok: false, error: 'Not found' }, 404, origin);
  }
};
