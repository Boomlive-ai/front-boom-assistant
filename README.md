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
npm install
npm start
```

Open <http://localhost:3000>.

## Environment variables

| Var           | Default                                | Purpose                                  |
|---------------|----------------------------------------|------------------------------------------|
| `PORT`           | `3000`                                | Port the web UI runs on                  |
| `GENERATE_API`   | the deployed BOOM VPS `/generate` URL | Upstream FastAPI endpoint                |
| `CREATE_FEED_API`| the Hocalwire `createFeedV2` URL      | Upstream endpoint for **Create Feed**    |
| `BASE_PATH`      | `/front-boom-assistant`               | Extra folder path to also serve under    |

Example:

```bash
GENERATE_API=http://192.168.1.20:8000/generate PORT=4000 npm start
```

## Two addresses

The app answers on **both** of these at the same time:

- the Coolify root address, where it sits at the top level — `https://<coolify-host>/`
- a folder path on a different host — `https://toolbox.boomlive.in/front-boom-assistant/`

`toolbox.boomlive.in` is a separate PHP project. This Node app only owns the
`/front-boom-assistant` folder there; the PHP app owns the root.

Two things make this work, and both must be kept:

1. **Internal links in `public/` never start with `/`.** They are written as
   `style.css`, `script.js`, `api/generate` and `api/create-feed`. A leading
   slash means "go back
   to the top of the website", which on the toolbox host lands on the PHP app.
   Adding a `/` in front of any of these silently breaks the folder address.
2. **The routes are mounted twice** — at `BASE_PATH` and at `/` — so it does not
   matter whether the reverse proxy strips the folder name before forwarding.
   Set `BASE_PATH=` (empty) to mount at the root only.

Relative links need a `/` at the end of the address. Both a server-side 301 and
a small inline script at the top of `index.html` add it, so
`…/front-boom-assistant` and `…/front-boom-assistant/` both work.

Test the folder address locally with:

```bash
npm start
```

then open <http://localhost:3000/front-boom-assistant/>.

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
- `suggested_rating` shown as a colored pill
- `usage` + `elapsed_seconds` shown as a footer line

## Create Feed

Below the generated output there is a **Create Feed** box that pushes the story
into Hocalwire as a new feed.

1. Fill in the three values the story cannot supply on its own — **Image URL**,
   **Category ID** (`796` by default) and **Session ID**.
2. Click **Create Feed**. The browser builds the full payload and POSTs it to
   `api/create-feed`, which `server.js` forwards to `CREATE_FEED_API`.
3. The upstream reply is printed in the box — green on success, red on failure.

**Copy Feed JSON** copies the exact payload without sending it, which is the
quickest way to check a mapping before creating anything.

The mapping lives in `buildFeedPayload()` in `public/script.js`. It combines the
generated output, the form values that were submitted, and those three inputs.
Two parts are best-guess and worth confirming against the CMS:

- `CLAIM_RATING` — the number stored for each verdict. Only `False → 2` is
  confirmed from the sample payload.
- `FEED_TEXT` — the fixed labels (`location`, `reviewed_by`, interview question
  and answer, and so on), one set per language.

`slug`, `long_tail_keywords` and `story_tags` are generated but have no matching
key in the feed payload, so they are not sent.

## Files

```
front-boom-assistant/
├── package.json
├── server.js            # Express + proxy, mounted at / and BASE_PATH
├── public/
│   ├── index.html       # Form + response layout, trailing-slash guard
│   ├── style.css        # BOOM-style styling
│   └── script.js        # Fetch + editable rendering
└── README.md
```
