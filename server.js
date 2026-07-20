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
  'https://amm2qzatdibi7ne73tfjs5z0.vps.boomlive.in/generate';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Proxy endpoint — forwards the JSON body to the FastAPI /generate route.
app.post('/api/generate', async (req, res) => {
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

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`SEO Optimizer running on http://localhost:${PORT}`);
  console.log(`Proxying /api/generate → ${GENERATE_API}`);
});