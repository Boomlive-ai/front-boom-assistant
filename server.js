// server.js
// Small Express server that serves the SEO Optimizer UI and proxies
// the /generate call to your FastAPI backend so the browser doesn't
// have to deal with CORS.

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GENERATE_API =
  process.env.GENERATE_API || 'http://127.0.0.1:8000/generate';

// app.use(express.json({ limit: '2mb' }));
// app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json({ limit: '2mb' }));

const PUBLIC_DIR = path.join(__dirname, 'public');
const fs = require('fs');
if (!fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  console.error('❌  Missing public/index.html at', PUBLIC_DIR);
  console.error('    Make sure server.js and public/ are in the same folder.');
}
app.use(express.static(PUBLIC_DIR));

// Explicit root route so the error page is helpful
app.get('/', (_req, res) => {
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(500).send(
    `<h1>Setup problem</h1>
     <p>Could not find <code>public/index.html</code>.</p>
     <p>Expected at: <code>${indexPath}</code></p>`
  );
});

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
