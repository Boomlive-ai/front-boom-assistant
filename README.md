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
| `SESSION_ID_EN`  | _(none)_                              | Hocalwire session token for English stories |
| `SESSION_ID_HI`  | _(none)_                              | Hocalwire session token for Hindi stories   |
| `SESSION_ID_BN`  | _(none)_                              | Hocalwire session token for Bangla stories  |
| `FEED_CATEGORY_ID`| `796`                                | Hocalwire section new feeds are filed under |

Example:

```bash
GENERATE_API=http://192.168.1.20:8000/generate PORT=4000 npm start
```

### The `.env` file

`server.js` reads a `.env` file sitting next to it (`KEY=value`, one per line,
`#` for comments) — no extra package needed. Real environment variables win
over the file, so on Coolify or Docker you set the same names in the platform
instead and no `.env` has to be shipped. Copy `.env.example` to `.env` to start:

```bash
cp .env.example .env
```

`.env` is git-ignored because the session tokens are credentials. After editing
it, restart the server — it is only read at startup.

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

1. Click **Create Feed** — there is nothing to fill in. The browser builds the
   full payload and POSTs it to `api/create-feed`, which `server.js` forwards
   to `CREATE_FEED_API`.
2. Success shows one green line, `Feed created — 4916`. A failure shows the
   error message in red.

The box has no input fields. The payload leaves the browser with `sessionId`
and `categoryId` empty, and `/api/create-feed` fills them in from the server's
settings — the session token from `SESSION_ID_EN` / `SESSION_ID_HI` /
`SESSION_ID_BN` according to the story's `language`, and the category from
`FEED_CATEGORY_ID`. So the token is never typed in or visible in the page. A
language with no token set returns a `500` naming the variable to add. To
change a category, or when a token expires, update `.env` (or the platform's
env vars) and restart — nothing in the browser changes.

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
