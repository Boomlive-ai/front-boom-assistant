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

Three tiers: a static vanilla-JS browser app (three pages: main, Monthly Report, topic) → a thin Express proxy → three upstream services (the FastAPI `/generate` and `/boom-research/report` routes, and the Hocalwire `createFeedV2` endpoint).

**`server.js`** does two things: serve `public/` statically, and proxy three POST routes — `/api/generate` → `GENERATE_API`, `/api/create-feed` → `CREATE_FEED_API`, and `/api/report` → `REPORT_API` — plus one GET, `/api/report/months` → `REPORT_MONTHS_API`. The first two use `proxyJson(targetUrl, req, res)`, the third `proxyUpload`, the GET `proxyGet`; all hand off to one `forward()` that is deliberately dumb — it sends the body verbatim and mirrors the upstream status code and `Content-Type` back to the browser. It exists only to dodge CORS, so it never validates, reshapes, or knows the field schema. Upstream failures become a `502` with an `error`/`detail`/`hint` body.

`/api/report` is a multipart file upload. The app-wide `express.json()` skips multipart bodies, so the route runs its own `express.raw({ type: 'multipart/form-data', limit: '25mb' })` and `proxyUpload` forwards the raw bytes with the browser's own `Content-Type` header — that header carries the boundary between the parts, so it must be passed on unchanged and the body never unpacked. A request that is not multipart gets a `400`.

The only fields the server knows about are `sessionId` and `categoryId`, and only in the `/api/create-feed` route *before* it calls `proxyJson`. The token is a Hocalwire credential, so it must not sit in the page: the browser sends both keys empty plus the story's `language`, and the route stamps in `SESSION_IDS[language]` (from `SESSION_ID_EN` / `SESSION_ID_HI` / `SESSION_ID_BN`) and `FEED_CATEGORY_ID` (default `796`). A language with no token configured gets a `500` naming the missing variable rather than an empty token going upstream. Keep this transform in the route — `proxyJson` itself stays schema-blind.

Both sides log a create-feed attempt, since neither knows the whole picture: the browser prints the payload it built (with the two blank keys), and the route prints the upstream URL, the category and `maskToken(sessionId)`. Log `req.body` *before* stamping the token in, and keep the mask — Coolify keeps server logs, so a whole token must never reach one.

`loadEnvFile()` reads a `.env` next to `server.js` into `process.env` at startup (no `dotenv` dependency, since `node_modules/` is committed). Already-set variables win, so platform env vars beat the file, and a missing file is skipped silently — which is the normal case in Docker/Coolify. It must keep running before the `process.env` reads below it. `.env` is git-ignored; `.env.example` is the committed template.

`GENERATE_API` and `CREATE_FEED_API` default to deployed BOOM VPS URLs. `REPORT_API` is the exception: it defaults to `http://127.0.0.1:8000/boom-research/report`, because the VPS has no report route yet (it answers `404`). Set `REPORT_API` on Coolify once it does. `REPORT_MONTHS_API` defaults to `REPORT_API` with the trailing `/report` swapped for `/months`, so it moves with it.

This app never talks to Postgres. The research database (`boom_report`, table `research_fact_checks`) belongs to the FastAPI service, whose own `.env` holds `DB_HOST` / `DB_PASSWORD` / `RESEARCH_DB_NAME`. Keep it that way — no `pg` dependency and no database login in this repo.

## The app must keep working on two addresses

It is served both at a root URL (Coolify) and at a folder path on a host whose root belongs to a **different** app (`https://toolbox.boomlive.in/front-boom-assistant/`). Two mechanisms keep that true, and both are easy to break:

- **Never write a leading `/` on an internal link in `public/`.** They are relative on purpose — `style.css`, `script.js`, `api/generate`, `api/create-feed`, and for the report and topic pages `report.html`, `report.css`, `report-common.js`, `report.js`, `topic.html`, `topic.js`, `api/report`, `api/report/months`, the `./` back link, and the links built in JS — `topicHref()`'s `topic.html?…` and topic.js's `report.html?month=…`. A leading slash resolves against the host root, which on the toolbox host is the unrelated PHP app. Neither stylesheet contains `url()` or `@import`, so that is the complete set.
- **Links that leave this app stay absolute**, and are not covered by the rule above: `GENERATE_API`, `CREATE_FEED_API` and `REPORT_API` in `server.js`, plus the header Home link and the footer Privacy Policy / Data Deletion links, which point at `https://toolbox.boomlive.in/…`. Those pages belong to the PHP app, so they must resolve to the toolbox host even when this app is served from the Coolify address. Making them relative would break them there.
- **The handlers live on an `express.Router()` mounted twice** — at `BASE_PATH` (default `/front-boom-assistant`) and at `/` — so the app works whether or not the reverse proxy strips the folder. Adding a route with `app.get`/`app.post` instead of `router.get`/`router.post` makes it reachable at the root only. The root mount is also what keeps `/health` available to the Docker `HEALTHCHECK`, which calls `127.0.0.1` directly.

Relative links depend on a trailing slash. Two independent guards supply it: Express 301-redirects `/front-boom-assistant` → `/front-boom-assistant/` when it sees the prefix, and an inline script at the top of `index.html` covers the case where the proxy has already stripped it. That script cannot move into `script.js` — it exists precisely because `script.js` fails to load in that situation.

**`public/script.js`** owns the entire request/response contract. Two separate places define field names, and both must be updated to add a field:

1. The `raw` object in the submit handler explicitly enumerates every request field via `fd.get(...)`. It does not iterate the `FormData`, so adding an `<input name="…">` to `index.html` alone will silently never reach the backend.
2. The `FIELDS` array declares which *response* keys get rendered, in order. Keys absent from `FIELDS` are dropped from the UI (but survive in `currentResponse` and in Copy JSON).

Blank values are stripped from the payload before POSTing — intentional, because upstream Pydantic validators for typed fields (`claim_date`, `claim_url`) reject empty strings but accept absence.

**Field `kind` drives serialization in both directions** via the `valueToDisplay` / `displayToValue` pair:

- `text` / `single` — raw string (textarea vs. input)
- `list` — array rendered as one comma-separated line; split on commas *or* newlines and trimmed on save, so a list pasted one-per-line still stores as separate items. Empty pieces are dropped, so trailing commas are harmless. The value written back to `currentResponse` stays an array, which is what Copy JSON and `buildFeedPayload()`'s `highlights` depend on
- `json` — pretty-printed; `JSON.parse` on save, and a parse error surfaces as an error toast and aborts the save

Each rendered block starts read-only with an Edit/Save toggle. Saving writes the parsed value back into the module-level `currentResponse`, which is what **Copy JSON** exports — so the export reflects editor changes, not the original API response.

`extractErrorMessage` normalizes the several error shapes the backend can return, including FastAPI's `{detail: [{loc, msg, type}]}` validation array, which it flattens into `field.path: message` strings.

## Create Feed

`buildFeedPayload()` maps the generated story onto the ~59 keys Hocalwire's `createFeedV2` expects. It reads from two sources, so both must be intact:

1. `currentResponse` — the generated output, after any Edit/Save changes.
2. `currentRequest` — the submitted form values, saved in the submit handler *only after a successful generate*, so it always describes the same story as `currentResponse`. Setting it earlier pairs new form values with the previous story when a generate fails. The payload needs the claim, source, caption and URLs, and none of those come back from `/generate`.

The Create Feed box has no inputs. `sessionId` and `categoryId` are built as `''` and stamped in by `/api/create-feed`, so no token and no configuration lives in the page. `image` is a `''` constant for the same reason the box lost its inputs, which leaves `mediaIds` / `fastcheck_media` as empty arrays.

Unlike `/generate`, blanks are **not** stripped: the sample payload includes empty strings (`news_speech_file_path: ""`), so every key is always sent.

On success the box shows one line — `✅ Feed created successfully! (ID: <id>)`, from `extractFeedId()` — not the raw JSON. A reply with no recognisable id prints the raw text under that line, so an unexpected response is never swallowed. `setFeedLoading` rewrites the button label, so the `📝` / `⏳` emoji live there as well as in `index.html`.

## Translation info box

`renderTranslationInfo()` fills `#translation-info` under the fields on every render. Labels come from `INFO_TEXT`, a third per-language table alongside `FEED_TEXT` (payload strings) and the `language` radios — a new language needs an entry in all three. Its `locale` also formats the date, so Hindi reads `2 सितंबर 2026` and Bangla `২ সেপ্টেম্বর, ২০২৬`.

`originalArticleId()` prefers `original_article_id` / `source_article_id` / `article_id` from the response, then falls back to the trailing number of `article_url` (BOOM URLs end in the story id). When neither exists the ID row is omitted entirely rather than rendered empty — `article_url` is an optional form field, so this is the normal case for an unpublished story.

Two things in there are guesses that should be confirmed against the CMS: the `CLAIM_RATING` map (only `False → 2` is confirmed from the sample payload), and the per-language constants in `FEED_TEXT`. `slug` is generated but has no matching key in the payload, so it is dropped.

`keywords` (short- + long-tail merged) and `tags` (story tags) are the two payload keys the CMS wants as a single **comma-separated string**, not an array — `"Bihar bridge, bridge collapse"` and `"Bihar,Misinformation"`. Keywords are spaced after the comma and tags are not, copying the sample payload. `cleanList()` still returns an array (it trims, drops blanks and de-duplicates across the lists it merges); the `.join()` happens at the payload key. `highlights` is the exception that stays an array.

`markdownToHtml` exists because the CMS stores `story` as HTML while the model returns Markdown. It escapes text first, so no raw HTML from the model can reach the payload.

## Monthly Report page

`public/report.html` + `report.css` + `report.js`, reached from the **📊 Monthly Report** `.nav-btn` in the main page's top bar (and back via `./`). It has no trailing-slash guard: `report.html` is a file name, so relative links already resolve inside the folder. `report.js` shares no code with `script.js` — `showToast` and `extractErrorMessage` are copies — because `script.js` binds to the main page's elements at load.

The report page and the topic page do share code: `report-common.js` holds the helpers both need (`el()`, `link()`, the date/number formatters, `extractErrorMessage`, every chart piece, `statCard`, `masthead()`, `footnote()`, `setPrintFooter()` and the topics sidebar). Both HTML files load it with a plain `<script>` *before* their own script, so its top-level names are globals there. Two rules keep that working: it must never look up a page element when it loads (only inside functions, as `showToast` and `setPrintFooter` do), and `report.js` / `topic.js` must never declare a top-level name it already declares — two `const`s of one name across classic scripts is a load-time `SyntaxError` that blanks the page. Put a helper in `report-common.js` only once both pages use it.

The month comes first. On load, `loadMonths()` GETs `api/report/months` (`{months: [{month, label, fact_checks}]}`) into `savedMonths` and fills the `<select>`: those months newest first under "In the database", then an "Another month" option whose value is `OTHER`. Picking `OTHER` shows the `#other-month` month box and enables `#sheet-field` (a `<fieldset disabled>`, so the file input is off for any month the database has). `syncMonthUi()` owns that show/enable state and must run after anything that changes the select — `chooseMonth()` and the `reset` handler (deferred a tick, since `reset` fires before the fields clear) both call it. Typing a saved month into the "Another month" box switches the select to it. If the list cannot load, the select holds only `OTHER`, with the error and a Try again link under it, so uploads still work.

The form sends `month` (`YYYY-MM`) and `narrative` to `api/report`, plus `file` **only** for a month not in `savedMonths` — with no file the API builds the report from the database. The `FormData` is rebuilt by hand so the checkbox always arrives as `"true"`/`"false"` (an unticked box would otherwise be missing), and no `Content-Type` header is set, so the browser adds the boundary. The API saves an uploaded sheet to the database, so after an upload succeeds `loadMonths(month)` refreshes the list and keeps that month picked. When the month has no data the API answers `{detail: {message, available_months}}`, and the error box turns `available_months` into buttons; after a successful report the same `monthButtons()` fills the "Other months" bar from `monthly`. Both go through `chooseMonth()` and re-submit — from the database when it has the month, otherwise with the file still in the form. `report.html?month=YYYY-MM` (the topic page's back link) picks that month and submits once `loadMonths()` resolves, but only when the database has it.

After each report, `showTopicSidebar()` fills `<aside id="topic-nav">` from `topics` and adds `has-sidebar` to `#report-layout`, which turns it into a two-column grid (`.rp-page` widens `.page` to 1200px for it; the form card stays 860px). The links open `topic.html` in a new tab, so the month report stays put. "Uncoded" is left out, as in the topics chart. Below 900px the sidebar stacks above the report, and in print it is hidden.

`renderReport()` rebuilds `#report` from the reply in the order of the PDF draft (`BOOM_Monthly_Report_January_2026.pdf`): masthead, headline + standfirst, four stat cards, key highlights, then sections built from `monthly`, `language`, `topics`, `themes` (dot timeline and theme assessment), `targets`, `ai`, `media_misreporting`, `breakdowns`, `data_notes` / `flags` and the `fact_checks` appendix. Every node comes from `el()`, which adds strings as text, and `link()` only makes `http(s)` URLs clickable — so nothing from the sheet is ever HTML. Section text comes only from `narrative`; chart titles are computed (ties are named together by `leaders()`). Months with `partial: true` are left out of the monthly columns, and the first stat card falls back to the busiest day when `summary.previous_month` is `null`.

Charts are plain HTML/CSS, no library. Series colours are the classes `rp-c0`…`rp-c3` (the PDF's blue, orange, green, amber — green and amber darkened to pass a colour-blind check), always in that order, and `foldOther()` merges anything past the fourth into a grey "Other". Every stacked bar has a text legend. There is deliberately **no print / Save as PDF button** on either page (it was removed on request), but the print styles stay so a browser print (Ctrl+P) still comes out clean: the `@media print` block hides everything but the report and forces background colours (the bars are backgrounds), and the `@page` margin boxes print page numbers plus a footer naming the month (and, on the topic page, the topic) that `setPrintFooter()` writes into `<style id="print-footer">` (Chrome only; other browsers skip the margins).

## Topic page

`public/topic.html` + `topic.js`, opened as `topic.html?month=2026-01&topic=Iran+unrest` from the sidebar. There is no topic route upstream: `loadTopic()` POSTs the same `api/report` form as the report page — `month` plus `narrative=false`, no file — so the month comes from the database without model cost, then `renderTopic()` keeps the `fact_checks` whose `topic` equals the one in the URL. Each fact-check has exactly one `topic`, and `topics[].count` adds up to the month total, so the page's counts match the month report. Everything on it is counted in the browser by `countBy()` (language, medium, type, intent, targets, claimed_by); the only text taken from the API is the theme summary, when `themes` has this topic, otherwise `topicSummary()` writes the same kind of sentence. The breakdown chart is skipped for a single fact-check (every bar would be 100%).

So a topic page only works for months the database has — an uploaded sheet that failed to save gets the API's 404, shown in `#topic-status` with a link back. A missing or malformed `month` / `topic`, and a topic with no fact-checks that month, also end in `#topic-status`; in the last case the sidebar still renders so another topic can be picked.

## Repo state to be aware of

- `node_modules/` is committed to git, and `.gitignore` holds only `.env`.
- `escapeHtml` in `script.js` is used only by `markdownToHtml`. The renderer never touches it — it builds DOM nodes and assigns `.textContent` / `.value`, never HTML strings.
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

