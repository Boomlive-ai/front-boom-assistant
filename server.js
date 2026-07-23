// server.js
// Small Express server that serves the SEO Optimizer UI and proxies
// the /generate call to your FastAPI backend so the browser doesn't
// have to deal with CORS.

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GENERATE_API =
  process.env.GENERATE_API ||
  'https://boom-assistant.vps.boomlive.in/generate';

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

// Proxy endpoint — forwards the JSON body to the FastAPI /generate route.
router.post('/api/generate', async (req, res) => {
  try {
    const upstream = await fetch(GENERATE_API, {
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
      error: 'Failed to reach the /generate API.',
      detail: String(err && err.message ? err.message : err),
      hint: `Is the FastAPI server running at ${GENERATE_API}?`,
    });
  }
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
  console.log(`Proxying /api/generate → ${GENERATE_API}`);
});
