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
const GENERATE_API =
  process.env.GENERATE_API ||
  'https://boom-assistant.vps.boomlive.in/generate';
const CREATE_FEED_API =
  process.env.CREATE_FEED_API ||
  'https://microservices.coolify.vps.boomlive.in/api/hocalwire/createFeedV2';

// Hocalwire session token, one per story language. The editor used to type
// this into the page; now the browser only sends the language and the token is
// filled in here (see /api/create-feed below). Keeping it server-side means the
// token never appears in the page source, where anyone could copy it.
const SESSION_IDS = {
  en: process.env.SESSION_ID_EN || '',
  hi: process.env.SESSION_ID_HI || '',
  bn: process.env.SESSION_ID_BN || '',
};

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
// dodge CORS, so it never validates or reshapes the field schema.
async function proxyJson(targetUrl, req, res) {
  try {
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });

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
router.post('/api/generate', (req, res) => proxyJson(GENERATE_API, req, res));

// Proxy endpoint — forwards the built feed payload to Hocalwire createFeedV2.
// The single exception to the dumb-pipe rule above: sessionId is a credential,
// so the browser never holds it. The payload arrives with sessionId empty, and
// the token for the story's own language is stamped in here.
router.post('/api/create-feed', (req, res) => {
  const lang = String((req.body && req.body.language) || '').toLowerCase();
  const sessionId = SESSION_IDS[lang];

  if (!sessionId) {
    const varName = `SESSION_ID_${(lang || 'xx').toUpperCase()}`;
    return res.status(500).json({
      error: `No session ID is set for language "${lang || '(missing)'}".`,
      hint: `Add ${varName} to .env (or to the server's environment variables) and restart the server.`,
    });
  }

  req.body = { ...req.body, sessionId };
  return proxyJson(CREATE_FEED_API, req, res);
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
  console.log(`Proxying /api/generate    → ${GENERATE_API}`);
  console.log(`Proxying /api/create-feed → ${CREATE_FEED_API}`);
  // Names only, never the tokens themselves — this line ends up in server logs.
  const withToken = Object.keys(SESSION_IDS).filter((l) => SESSION_IDS[l]);
  console.log(
    withToken.length
      ? `Session IDs loaded for: ${withToken.join(', ')}`
      : 'Session IDs: none set — Create Feed will fail until SESSION_ID_EN / SESSION_ID_HI / SESSION_ID_BN exist'
  );
});
