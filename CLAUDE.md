# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm start          # or `npm run dev` — identical, no watcher; restart manually after edits
```

Serves on <http://localhost:3000>. There is no build step, no test suite, and no linter configured.

```bash
GENERATE_API=http://127.0.0.1:8000/generate PORT=4000 npm start
```

The folder-path address is served too, so <http://localhost:3000/front-boom-assistant/> exercises it locally without any proxy. `BASE_PATH=` (empty) disables that second mount.

Docker (multi-stage, non-root, `HEALTHCHECK` hits `/health`):

```bash
docker build -t front-boom-assistant . && docker run -p 3000:3000 front-boom-assistant
```

Requires Node 18+ — `server.js` uses global `fetch` with no polyfill.

## Architecture

Three tiers: a static vanilla-JS browser app → a thin Express proxy → an upstream FastAPI `/generate` service.

**`server.js`** does two things: serve `public/` statically, and proxy `POST /api/generate` to `GENERATE_API`. The proxy is deliberately dumb — it forwards `req.body` verbatim and mirrors the upstream status code and `Content-Type` back to the browser. It exists only to dodge CORS, so it never validates, reshapes, or knows the field schema. Upstream failures become a `502` with an `error`/`detail`/`hint` body.

The `GENERATE_API` default in `server.js` is a deployed BOOM VPS URL, not `127.0.0.1:8000`.

## The app must keep working on two addresses

It is served both at a root URL (Coolify) and at a folder path on a host whose root belongs to a **different** app (`https://toolbox.boomlive.in/front-boom-assistant/`). Two mechanisms keep that true, and both are easy to break:

- **Never write a leading `/` on an internal link in `public/`.** They are relative on purpose — `style.css`, `script.js`, `api/generate`. A leading slash resolves against the host root, which on the toolbox host is the unrelated PHP app. `style.css` contains no `url()` or `@import`, so those three are the complete set.
- **Links that leave this app stay absolute**, and are not covered by the rule above: `GENERATE_API` in `server.js`, plus the header Home link and the footer Privacy Policy / Data Deletion links, which point at `https://toolbox.boomlive.in/…`. Those pages belong to the PHP app, so they must resolve to the toolbox host even when this app is served from the Coolify address. Making them relative would break them there.
- **The handlers live on an `express.Router()` mounted twice** — at `BASE_PATH` (default `/front-boom-assistant`) and at `/` — so the app works whether or not the reverse proxy strips the folder. Adding a route with `app.get`/`app.post` instead of `router.get`/`router.post` makes it reachable at the root only. The root mount is also what keeps `/health` available to the Docker `HEALTHCHECK`, which calls `127.0.0.1` directly.

Relative links depend on a trailing slash. Two independent guards supply it: Express 301-redirects `/front-boom-assistant` → `/front-boom-assistant/` when it sees the prefix, and an inline script at the top of `index.html` covers the case where the proxy has already stripped it. That script cannot move into `script.js` — it exists precisely because `script.js` fails to load in that situation.

**`public/script.js`** owns the entire request/response contract. Two separate places define field names, and both must be updated to add a field:

1. The `raw` object in the submit handler explicitly enumerates every request field via `fd.get(...)`. It does not iterate the `FormData`, so adding an `<input name="…">` to `index.html` alone will silently never reach the backend.
2. The `FIELDS` array declares which *response* keys get rendered, in order. Keys absent from `FIELDS` are dropped from the UI (but survive in `currentResponse` and in Copy JSON).

Blank values are stripped from the payload before POSTing — intentional, because upstream Pydantic validators for typed fields (`claim_date`, `claim_url`) reject empty strings but accept absence.

**Field `kind` drives serialization in both directions** via the `valueToDisplay` / `displayToValue` pair:

- `text` / `single` — raw string (textarea vs. input)
- `list` — array rendered one item per line; re-split and trimmed on save
- `json` — pretty-printed; `JSON.parse` on save, and a parse error surfaces as an error toast and aborts the save

Each rendered block starts read-only with an Edit/Save toggle. Saving writes the parsed value back into the module-level `currentResponse`, which is what **Copy JSON** exports — so the export reflects editor changes, not the original API response.

`extractErrorMessage` normalizes the several error shapes the backend can return, including FastAPI's `{detail: [{loc, msg, type}]}` validation array, which it flattens into `field.path: message` strings.

## Repo state to be aware of

- `node_modules/` is committed to git and `.gitignore` is empty.
- `escapeHtml` in `script.js` is dead code — the renderer builds DOM nodes and assigns `.textContent` / `.value`, never HTML strings.
- The `package.json` name is still `seo-optimizer`, while the repo and the folder path are `front-boom-assistant`.






# How to talk to me

- Always use simple, easy English. No hard or fancy words.
- I am a beginner. Explain everything like you are teaching a new student.
- When you explain something technical, break it into small, easy steps.
- Use examples to make things clear.
- Avoid jargon. If you must use a technical word, explain what it means right after.




# Git workflow
- Always work on the `main` branch. Only switch to, or create, a different branch when I clearly ask for it.
- Never create a new branch by yourself.
- After writing code, only commit it. Never push. I will push it myself.

