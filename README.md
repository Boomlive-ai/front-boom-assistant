# SEO Optimizer (Node.js)

A small Express app that mirrors the BOOM **SEO Optimizer** UI, collects the
input fields, calls your FastAPI `/generate` endpoint, and renders the
response in editable fields with **Edit / Save** toggles.

## Requirements

- Node.js **18+** (needed for the built-in `fetch` used in `server.js`)
- Your FastAPI server running at `http://127.0.0.1:8000` (or override
  `GENERATE_API` env var).

## Setup

```bash
cd seo-optimizer
npm install
npm start
```

Open <http://localhost:3000>.

## Environment variables

| Var           | Default                          | Purpose                        |
|---------------|----------------------------------|--------------------------------|
| `PORT`        | `3000`                           | Port the web UI runs on        |
| `GENERATE_API`| `http://127.0.0.1:8000/generate` | Upstream FastAPI endpoint      |

Example:

```bash
GENERATE_API=http://192.168.1.20:8000/generate PORT=4000 npm start
```

## How it works

1. Browser POSTs the form to `/api/generate` on this Node server.
2. `server.js` forwards the JSON body to `GENERATE_API` (avoids CORS pain).
3. The upstream JSON response is rendered as a set of editable blocks.
4. Each block starts read-only; click **Edit** to modify, **Save** to lock
   it back in. Edits are stored in-memory, so **Copy JSON** exports the
   edited version.

Fields rendered:

- `headline`, `strapline`, `body_markdown`, `slug`
- `short_tail_keywords`, `long_tail_keywords`, `story_tags` (one per line)
- `claim_review` (validated as JSON on save)
- `suggested_rating` shown as a colored pill
- `flags` and `warnings` shown as warning boxes
- `usage` + `elapsed_seconds` shown as a footer line

## Files

```
seo-optimizer/
├── package.json
├── server.js            # Express + proxy
├── public/
│   ├── index.html       # Form + response layout
│   ├── style.css        # BOOM-style styling
│   └── script.js        # Fetch + editable rendering
└── README.md
```
