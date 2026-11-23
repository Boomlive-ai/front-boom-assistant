// server.js
// Small Express server that serves the SEO Optimizer UI and proxies
// the upstream API calls so the browser doesn't have to deal with CORS.

const express = require('express');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// .env support, without adding a dependency.
// Reads KEY=value lines and copies them into process.env. Variables that are
// already set win, so the real environment (Coolify, Docker, `X=1 npm start`)
// always beats the file. A missing file is normal — on the servers there is no
// .env at all, the platform sets the variables — so it is skipped in silence.
// Must run before anything below reads process.env.
// ---------------------------------------------------------------------------
function loadEnvFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    // Drop one pair of surrounding quotes, if the value has them.
    const quoted =
      value.length > 1 &&
      (value[0] === '"' || value[0] === "'") &&
      value[value.length - 1] === value[0];
    if (quoted) value = value.slice(1, -1);

    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, '.env'));

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Settings. Every address, token and ID comes from .env (or, on the servers,
// the platform's environment variables) — none is written in this file. A
// missing one is listed when the server starts, and the route that needs it
// answers 500 naming it (see needSetting below), rather than quietly using an
// old value. .env.example lists every name.
// ---------------------------------------------------------------------------

// One setting; blank counts as missing.
const setting = (name) => (process.env[name] || '').trim();

// The FastAPI /generate route.
const GENERATE_API = setting('GENERATE_API');
// Hocalwire createFeedV2.
const CREATE_FEED_API = setting('CREATE_FEED_API');
// The report pages: the FastAPI /boom-research/range-report route, which
// builds a report for any From–To dates from the research database. The
// FastAPI service reads Postgres, so this app never holds the database login.
const REPORT_RANGE_API = setting('REPORT_RANGE_API');
// The dates the database covers, shown under the date pickers. When it is not
// set, it is the /dates route next to REPORT_RANGE_API, so setting
// REPORT_RANGE_API alone moves both.
const REPORT_DATES_API =
  setting('REPORT_DATES_API') || REPORT_RANGE_API.replace(/\/range-report\/?$/, '/dates');

// Hocalwire session token, one per story language. The editor used to type
// this into the page; now the browser only sends the language and the token is
// filled in here (see /api/create-feed below). Keeping it server-side means the
// token never appears in the page source, where anyone could copy it.
const SESSION_IDS = {
  en: setting('SESSION_ID_EN'),
  hi: setting('SESSION_ID_HI'),
  bn: setting('SESSION_ID_BN'),
};

// Hocalwire section the feed is filed under (796 so far). It was a text box in
// the page that nobody ever changed, so it is a setting, like the tokens.
const FEED_CATEGORY_ID = setting('FEED_CATEGORY_ID');

// The report page's Make a Story button: a second createFeedV2 address, which
// turns the report into a story in the CMS. It needs two credentials: a key in
// the `S-id` header and a session token in the body's `sessionId` (without the
// token it answers 401). Like the tokens above, both are added by
// /api/report/story and never sent from the page. The category is optional:
// blank sends "" (as the sample payload does).
const REPORT_STORY_API = setting('REPORT_STORY_API');
const REPORT_STORY_SID = setting('REPORT_STORY_SID');
const REPORT_STORY_SESSION_ID = setting('REPORT_STORY_SESSION_ID');
const REPORT_STORY_CATEGORY_ID = setting('REPORT_STORY_CATEGORY_ID');

// The settings each route cannot work without (the session tokens are checked
// per language in /api/create-feed, and the story's key and token in
// /api/report/story).
const REQUIRED = {
  GENERATE_API,
  CREATE_FEED_API,
  FEED_CATEGORY_ID,
  REPORT_RANGE_API,
  REPORT_STORY_API,
};

// Answers 500 naming the setting when it is empty, and returns false; the
// route then stops. Only the name is sent — never a value.
function needSetting(res, name, value) {
  if (value) return true;
  res.status(500).json({
    error: `${name} is not set.`,
    hint: `Add ${name} to .env (or to the server's environment variables) and restart the server.`,
  });
  return false;
}

// Enough of a token to tell one from another in the log, never enough to reuse.
// Server logs are kept by the host (Coolify keeps them for anyone with access),
// so a whole session token must not end up in one.
function maskToken(value) {
  const s = String(value || '');
  return s.length > 12 ? `${s.slice(0, 8)}…${s.slice(-4)}` : '***';
}

// The app answers on two addresses: the Coolify root URL, and a folder path on
// another host (https://toolbox.boomlive.in/front-boom-assistant). A reverse
// proxy usually strips that folder before forwarding, but not always — so the
// routes are mounted at both places and it works either way, with no config.
// Set BASE_PATH="" to mount at the root only.
const BASE_PATH = process.env.BASE_PATH ?? '/front-boom-assistant';

app.use(express.json({ limit: '2mb' }));

// All routes live on a router so the same handlers can be mounted twice.
const router = express.Router();

router.use(express.static(path.join(__dirname, 'public')));

// Every proxy here is the same dumb pipe: forward req.body verbatim, mirror the
// upstream status code and Content-Type back to the browser. It exists only to
// dodge CORS, so it never validates or reshapes the field schema. `headers` is
// for a route whose upstream wants a key in a header (Make a Story's S-id).
function proxyJson(targetUrl, req, res, headers) {
  return forward(targetUrl, res, 'application/json', JSON.stringify(req.body), 'POST', headers);
}

// Same pipe for a plain GET. The browser's query string (?from_date=…) is
// passed on unchanged, so here too nothing is read or reshaped. Only the query
// travels: the address itself always comes from the setting.
function proxyGet(targetUrl, req, res) {
  const q = req.originalUrl.indexOf('?');
  const query = q === -1 ? '' : req.originalUrl.slice(q);
  return forward(targetUrl + query, res, null, undefined, 'GET');
}

async function forward(targetUrl, res, contentType, body, method = 'POST', extraHeaders) {
  try {
    const headers = { accept: 'application/json', ...extraHeaders };
    if (contentType) headers['Content-Type'] = contentType;
    const upstream = await fetch(targetUrl, { method, headers, body });

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/json'
    );
    res.send(text);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(502).json({
      error: `Failed to reach ${targetUrl}`,
      detail: String(err && err.message ? err.message : err),
      hint: `Is the upstream service reachable at ${targetUrl}?`,
    });
  }
}

// Proxy endpoint — forwards the JSON body to the FastAPI /generate route.
router.post('/api/generate', (req, res) => {
  if (!needSetting(res, 'GENERATE_API', GENERATE_API)) return;
  return proxyJson(GENERATE_API, req, res);
});

// Proxy endpoint — forwards the built feed payload to Hocalwire createFeedV2.
// The single exception to the dumb-pipe rule above: the two settings values.
// The browser sends sessionId and categoryId empty and they are stamped in
// here, so no token and no configuration has to live in the page.
router.post('/api/create-feed', (req, res) => {
  if (!needSetting(res, 'CREATE_FEED_API', CREATE_FEED_API)) return;
  if (!needSetting(res, 'FEED_CATEGORY_ID', FEED_CATEGORY_ID)) return;
  const lang = String((req.body && req.body.language) || '').toLowerCase();
  const sessionId = SESSION_IDS[lang];

  if (!sessionId) {
    const varName = `SESSION_ID_${(lang || 'xx').toUpperCase()}`;
    return res.status(500).json({
      error: `No session ID is set for language "${lang || '(missing)'}".`,
      hint: `Add ${varName} to .env (or to the server's environment variables) and restart the server.`,
    });
  }

  // What actually goes upstream, printed in the terminal running the server.
  // The payload is logged as the browser sent it — that is, before the token is
  // stamped in — so the token appears only on its own masked line.
  console.log('🚀 Sending request with config:');
  console.log('👉 Language:', lang);
  console.log('👉 URL:', CREATE_FEED_API);
  console.log('👉 SessionId:', maskToken(sessionId));
  console.log('👉 CategoryId:', FEED_CATEGORY_ID);
  console.log('👉 Payload:', JSON.stringify(req.body, null, 2));

  req.body = { ...req.body, sessionId, categoryId: FEED_CATEGORY_ID };
  return proxyJson(CREATE_FEED_API, req, res);
});

// Proxy endpoint — one report for a range of dates:
// api/report/range?from_date=2026-01-01&to_date=2026-02-01&narrative=true
// → the FastAPI /boom-research/range-report route. Read-only; nothing is
// uploaded or saved.
router.get('/api/report/range', (req, res) => {
  if (!needSetting(res, 'REPORT_RANGE_API', REPORT_RANGE_API)) return;
  console.log(`📊 Report request → ${REPORT_RANGE_API} ${req.originalUrl.split('?')[1] || ''}`);
  return proxyGet(REPORT_RANGE_API, req, res);
});

// Proxy endpoint — Make a Story: the report page builds a createFeedV2 body
// from the report ({language, sessionId: "", state, news: [story]}) and this
// route sends it to REPORT_STORY_API. As in /api/create-feed, the credentials
// are added here, so none of them is ever in the page: the session token goes
// into the body's top-level sessionId, the category (if one is set) into each
// story, and the S-id key into a header.
router.post('/api/report/story', (req, res) => {
  if (!needSetting(res, 'REPORT_STORY_API', REPORT_STORY_API)) return;
  if (!needSetting(res, 'REPORT_STORY_SID', REPORT_STORY_SID)) return;
  if (!needSetting(res, 'REPORT_STORY_SESSION_ID', REPORT_STORY_SESSION_ID)) return;
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  // Logged as the browser sent it, before the token goes in; the key and the
  // token appear only masked, on their own lines.
  console.log('📰 Make a Story — sending request with config:');
  console.log('👉 URL:', REPORT_STORY_API);
  console.log('👉 S-id:', maskToken(REPORT_STORY_SID));
  console.log('👉 SessionId:', maskToken(REPORT_STORY_SESSION_ID));
  console.log('👉 CategoryId:', REPORT_STORY_CATEGORY_ID || '(blank)');
  console.log('👉 Payload:', JSON.stringify(body, null, 2));

  const news = Array.isArray(body.news)
    ? body.news.map((story) =>
        REPORT_STORY_CATEGORY_ID ? { ...story, categoryId: REPORT_STORY_CATEGORY_ID } : story
      )
    : body.news;
  req.body = { ...body, sessionId: REPORT_STORY_SESSION_ID, news };
  return proxyJson(REPORT_STORY_API, req, res, { 'S-id': REPORT_STORY_SID });
});

// Proxy endpoint — the first and last dates the research database has, shown
// under the report page's date pickers.
router.get('/api/report/dates', (req, res) => {
  if (!needSetting(res, 'REPORT_DATES_API (or REPORT_RANGE_API)', REPORT_DATES_API)) return;
  return proxyGet(REPORT_DATES_API, req, res);
});

router.get('/health', (_req, res) => res.json({ ok: true }));

// Specific path first, then the root. Express strips the mount path from
// req.url before the router runs and restores it after, so both work; a router
// that matches nothing calls next(), so ordering never traps a request.
// The root mount also keeps /health reachable for the Docker HEALTHCHECK,
// which calls 127.0.0.1 directly and never passes through the proxy.
if (BASE_PATH) app.use(BASE_PATH, router);
app.use('/', router);

app.listen(PORT, () => {
  console.log(`SEO Optimizer running on http://localhost:${PORT}`);
  if (BASE_PATH) {
    console.log(`Also serving under http://localhost:${PORT}${BASE_PATH}/`);
  }
  const shown = (value) => value || '(not set)';
  console.log(`Proxying /api/generate    → ${shown(GENERATE_API)}`);
  console.log(`Proxying /api/create-feed → ${shown(CREATE_FEED_API)}`);
  console.log(`Proxying /api/report/range → ${shown(REPORT_RANGE_API)}`);
  console.log(`Proxying /api/report/dates → ${shown(REPORT_DATES_API)}`);
  console.log(`Proxying /api/report/story → ${shown(REPORT_STORY_API)}`);
  console.log(`Feed category ID          → ${shown(FEED_CATEGORY_ID)}`);
  const missing = Object.keys(REQUIRED).filter((name) => !REQUIRED[name]);
  if (missing.length) {
    console.warn(
      `⚠️  Missing settings: ${missing.join(', ')}. Add them to .env (see .env.example) and restart — the pages that need them will show an error until then.`
    );
  }
  // Names only, never the tokens themselves — this line ends up in server logs.
  const withToken = Object.keys(SESSION_IDS).filter((l) => SESSION_IDS[l]);
  console.log(
    withToken.length
      ? `Session IDs loaded for: ${withToken.join(', ')}`
      : 'Session IDs: none set — Create Feed will fail until SESSION_ID_EN / SESSION_ID_HI / SESSION_ID_BN exist'
  );
  const storyMissing = Object.entries({ REPORT_STORY_SID, REPORT_STORY_SESSION_ID })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (storyMissing.length) {
    console.log(`Make a Story: ${storyMissing.join(' and ')} not set — the button will fail until it is added`);
  }
});
