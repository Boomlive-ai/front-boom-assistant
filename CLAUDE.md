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

Three tiers: a static vanilla-JS browser app (three pages: main, Monthly Report, topic) → a thin Express proxy → upstream services (the FastAPI `/generate` and `/boom-research/range-report` routes, and two Hocalwire `createFeedV2` addresses: one behind the main page's Create Feed, one behind the report page's Make a Story).

**`server.js`** does two things: serve `public/` statically, and proxy three POST routes — `/api/generate` → `GENERATE_API`, `/api/create-feed` → `CREATE_FEED_API` and `/api/report/story` → `REPORT_STORY_API` — plus two GETs, `/api/report/range` → `REPORT_RANGE_API` and `/api/report/dates` → `REPORT_DATES_API`. The POSTs use `proxyJson(targetUrl, req, res, headers?)`, the GETs `proxyGet(targetUrl, req, res)`; all hand off to one `forward()` that is deliberately dumb — it sends the body verbatim and mirrors the upstream status code and `Content-Type` back to the browser. It exists only to dodge CORS, so it never validates, reshapes, or knows the field schema. Upstream failures become a `502` with an `error`/`detail`/`hint` body.

`proxyGet` appends the browser's raw query string (`?from_date=…&to_date=…&narrative=…`) to the configured address — the query is the GET's "body", passed on unread; the host and path always come from the setting. There is no upload route any more: the month dropdown, the Excel upload, `POST /api/report` (multipart) and `/api/report/months` were all removed when the report switched to date ranges.

The only fields the server knows about are `sessionId` and `categoryId`, and only in the `/api/create-feed` route *before* it calls `proxyJson`. The token is a Hocalwire credential, so it must not sit in the page: the browser sends both keys empty plus the story's `language`, and the route stamps in `SESSION_IDS[language]` (from `SESSION_ID_EN` / `SESSION_ID_HI` / `SESSION_ID_BN`) and `FEED_CATEGORY_ID` (`796`, from `.env` like the tokens). A language with no token configured gets a `500` naming the missing variable rather than an empty token going upstream. Keep this transform in the route — `proxyJson` itself stays schema-blind.

`/api/report/story` is the second (and only other) route that touches the body, the same way. Its upstream wants a key in an **`S-id` header** (`REPORT_STORY_SID`) — the reason `proxyJson` takes an optional `headers` argument — and the body is wrapped: `{language, sessionId, state, news: [story]}`. The route stamps `REPORT_STORY_SESSION_ID` into the top-level `sessionId` (each story's own `sessionId` stays `""`, as in the sample) and, only when `REPORT_STORY_CATEGORY_ID` is set, that into each `news[].categoryId`; otherwise `""` goes up, as the sample sends. **The API needs both credentials**: sending the `S-id` header without a `sessionId` was tried and got `401`, so do not drop either. It logs `maskToken()` of both the key and the token, never either whole.

Both sides log a create-feed attempt, since neither knows the whole picture: the browser prints the payload it built (with the two blank keys), and the route prints the upstream URL, the category and `maskToken(sessionId)`. Log `req.body` *before* stamping the token in, and keep the mask — Coolify keeps server logs, so a whole token must never reach one.

`loadEnvFile()` reads a `.env` next to `server.js` into `process.env` at startup (no `dotenv` dependency, since `node_modules/` is committed). Already-set variables win, so platform env vars beat the file, and a missing file is skipped silently — which is the normal case in Docker/Coolify. It must keep running before the `process.env` reads below it. `.env` is git-ignored; `.env.example` is the committed template.

**No setting has a value in the code.** `GENERATE_API`, `CREATE_FEED_API`, `REPORT_RANGE_API`, `REPORT_STORY_API`, `FEED_CATEGORY_ID`, the `SESSION_ID_*` tokens and Make a Story's `REPORT_STORY_SID` / `REPORT_STORY_SESSION_ID` (optional `REPORT_STORY_CATEGORY_ID`) are read through `setting()` (blank = missing) and come only from `.env` or the environment; `.env.example` holds the current values (the BOOM VPS URLs, `https://www.boomlive.in/dev/h-api/createFeedV2` for `REPORT_STORY_API`, and `http://127.0.0.1:8000/boom-research/range-report` for `REPORT_RANGE_API` because the VPS has no range-report route yet) and leaves the credentials blank. Do not add `|| 'https://…'` fallbacks back. A missing required one does not stop the server: startup prints `⚠️ Missing settings: …` from the `REQUIRED` map, and each route calls `needSetting(res, name, value)` first, which answers `500 {error, hint}` naming the variable (never a value). So on Coolify, where no `.env` exists, every required name must be set as an environment variable. Only `PORT` (3000), `BASE_PATH` (below) and `REPORT_DATES_API` (`REPORT_RANGE_API` with the trailing `/range-report` swapped for `/dates`) keep code defaults — they are not credentials.

This app never talks to Postgres. The research database (`boom_report`, table `research_fact_checks`) belongs to the FastAPI service, whose own `.env` holds `DB_HOST` / `DB_PASSWORD` / `RESEARCH_DB_NAME`. Keep it that way — no `pg` dependency and no database login in this repo.

## The app must keep working on two addresses

It is served both at a root URL (Coolify) and at a folder path on a host whose root belongs to a **different** app (`https://toolbox.boomlive.in/front-boom-assistant/`). Two mechanisms keep that true, and both are easy to break:

- **Never write a leading `/` on an internal link in `public/`.** They are relative on purpose — `style.css`, `script.js`, `api/generate`, `api/create-feed`, and for the report and topic pages `report.html`, `report.css`, `report-common.js`, `report.js`, `topic.html`, `topic.js`, `api/report/range`, `api/report/dates`, `api/report/story`, the `./` back link, and the links built in JS — `topicHref()`'s `topic.html?from=…&to=…&topic=…` and topic.js's `report.html?from=…&to=…`. A leading slash resolves against the host root, which on the toolbox host is the unrelated PHP app. Neither stylesheet contains `url()` or `@import`, so that is the complete set.
- **Links that leave this app stay absolute**, and are not covered by the rule above: `GENERATE_API`, `CREATE_FEED_API`, `REPORT_RANGE_API` and `REPORT_STORY_API` in `.env`, plus the header Home link and the footer Privacy Policy / Data Deletion links, which point at `https://toolbox.boomlive.in/…`. Those pages belong to the PHP app, so they must resolve to the toolbox host even when this app is served from the Coolify address. Making them relative would break them there.
- **The handlers live on an `express.Router()` mounted twice** — at `BASE_PATH` (default `/front-boom-assistant`) and at `/` — so the app works whether or not the reverse proxy strips the folder. Adding a route with `app.get`/`app.post` instead of `router.get`/`router.post` makes it reachable at the root only. The root mount is also what keeps `/health` available to the Docker `HEALTHCHECK`, which calls `127.0.0.1` directly.

Relative links depend on a trailing slash. Two independent guards supply it: Express 301-redirects `/front-boom-assistant` → `/front-boom-assistant/` when it sees the prefix, and an inline script at the top of `index.html` covers the case where the proxy has already stripped it. That script cannot move into `script.js` — it exists precisely because `script.js` fails to load in that situation.

**`public/script.js`** owns the entire request/response contract. Two separate places define field names, and both must be updated to add a field:

1. The `raw` object in the submit handler explicitly enumerates every request field via `fd.get(...)`. It does not iterate the `FormData`, so adding an `<input name="…">` to `index.html` alone will silently never reach the backend.
2. The `FIELDS` array declares which *response* keys get rendered, in order. Keys absent from `FIELDS` are dropped from the UI (but survive in `currentResponse`).

Blank values are stripped from the payload before POSTing — intentional, because upstream Pydantic validators for typed fields (`claim_date`, `claim_url`) reject empty strings but accept absence.

**Field `kind` drives serialization in both directions** via the `valueToDisplay` / `displayToValue` pair:

- `text` / `single` — raw string (textarea vs. input)
- `list` — array rendered as one comma-separated line; split on commas *or* newlines and trimmed on save, so a list pasted one-per-line still stores as separate items. Empty pieces are dropped, so trailing commas are harmless. The value written back to `currentResponse` stays an array, which is what `buildFeedPayload()`'s `highlights` depends on
- `json` — pretty-printed; `JSON.parse` on save, and a parse error surfaces as an error toast and aborts the save

Each rendered block starts read-only with an Edit/Save toggle. Saving writes the parsed value back into the module-level `currentResponse`, which is what `buildFeedPayload()` reads — so Create Feed sends the editor's changes, not the original API response. Neither page has a Copy JSON button any more; `index.html` keeps the old `copy-all` button only as an HTML comment, and `script.js` no longer looks it up (a `getElementById` that returns `null`, followed by `.addEventListener`, throws at load and silently kills every handler below it — Create Feed included).

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

The report page and the topic page do share code: `report-common.js` holds the helpers both need (`el()`, `link()`, the date/number formatters incl. `longDate()`, `isIsoDate()` and `datesBetween()`, `extractErrorMessage`, every chart piece, `statCard`, `masthead()`, `footnote()`, `setPrintFooter()` and the topics sidebar). Both HTML files load it with a plain `<script>` *before* their own script, so its top-level names are globals there. Two rules keep that working: it must never look up a page element when it loads (only inside functions, as `showToast` and `setPrintFooter` do), and `report.js` / `topic.js` must never declare a top-level name it already declares — two `const`s of one name across classic scripts is a load-time `SyntaxError` that blanks the page. Put a helper in `report-common.js` only once both pages use it.

The form is two `<input type="date">` boxes, **From Date** and **To Date** (both days included). By request they default to To = today and From = the same day one month earlier (`oneMonthBefore()`, which clamps 31 Mar → 28 Feb); `todayIso()` uses the browser's local date, not `toISOString()`, which is a day behind in India before 5:30 am. The defaults are set as each input's `defaultValue`, so **Reset** returns to them. `linkDateLimits()` keeps the calendars honest (To's `min` = From, From's `max` = To). `report.html?from=…&to=…` (the topic page's back link) fills in those dates instead.

The database only holds part of the calendar (Jan–Sep 2026 at the time of writing), so the default range is often empty. On load `loadDataSpan()` GETs `api/report/dates` (`{data_from, data_to, fact_checks, default_from, default_to}`) into `dataSpan`, and `updateDatesNote()` shows "Data in the database: …" under the boxes — or, when the chosen dates fall wholly outside it, a red note with `latestMonthButton()`, which fills in `default_from`–`default_to` (the last month with data). Losing `/dates` only loses the hint.

Submit checks the dates in the browser (both valid, From ≤ To, at most `MAX_RANGE_DAYS` = 366, the backend's limit) and GETs `api/report/range?from_date=…&to_date=…&narrative=true`. There is deliberately no AI on/off switch (the old "Write the text with AI" checkbox was removed on request): the text is always the model's, `narrative_source: "model"` in the reply, and the API drops to template text only if the model call fails, adding a flag that `notesBox()` shows. It takes ~15–20 s, so `setLoading()` labels the button "Writing the report with AI…". An empty range gets `404 {detail: {code: "no_data_in_range", message, data_from, data_to}}`, which the error box shows with the data dates and the same fill-in button. **Nothing submits the form except the Generate Report button** — no `requestSubmit()` anywhere, by request, since every report is an AI call; the fill-in buttons and the `?from&to` link only fill the dates.

After each report, `showTopicSidebar()` fills `<aside id="topic-nav">` from `topics` and adds `has-sidebar` to `#report-layout`, which turns it into a two-column grid (`.rp-page` widens `.page` to 1200px for it; the form card stays 860px). The links (`topicHref(from, to, topic)`) open `topic.html` for the same dates in a new tab, so the report stays put. "Uncoded" is left out, as in the topics chart. Below 900px the sidebar stacks above the report, and in print it is hidden.

`renderReport()` rebuilds `#report` from the reply in the order of the PDF draft (`BOOM_Monthly_Report_January_2026.pdf`): masthead, headline + standfirst, four stat cards, key highlights, then sections built from `monthly`, `language`, `topics`, `themes` (dot timeline and theme assessment), `targets`, `ai`, `media_misreporting`, `breakdowns`, `data_notes` / `flags` and the `fact_checks` appendix. Every node comes from `el()`, which adds strings as text, and `link()` only makes `http(s)` URLs clickable — so nothing from the sheet is ever HTML. Section text comes only from `narrative`; chart titles are computed (ties are named together by `leaders()`). The reply describes a range, not a month: `meta` has `from_date`, `to_date`, `days`, `label` ("January 2026" when `whole_month`, else "15 February – 20 March 2026") and no `month`, so titles never take a month name out of `label`. Months with `partial: true` are left out of the monthly columns, and every month the range touches is `selected` (numbers shown). The first stat card compares with `summary.previous_period` (the month before a whole month, else the same number of days just before) and falls back to the busiest day when it is `null`. The dot timeline's x axis is the range's own dates (`daily[].date`, or `datesBetween()`), so `dotTimeline()` places dots by date, never by day of month — 3 Feb and 3 Jan must not collide — and labels ticks with day numbers inside one month, otherwise "15 Feb"-style dates.

Charts are plain HTML/CSS, no library. Series colours are the classes `rp-c0`…`rp-c3` (the PDF's blue, orange, green, amber — green and amber darkened to pass a colour-blind check), always in that order, and `foldOther()` merges anything past the fourth into a grey "Other". Every stacked bar has a text legend. There is deliberately **no print / Save as PDF button** on either page (it was removed on request), but the print styles stay so a browser print (Ctrl+P) still comes out clean: the `@media print` block hides everything but the report and forces background colours (the bars are backgrounds), and the `@page` margin boxes print page numbers plus a footer naming the month (and, on the topic page, the topic) that `setPrintFooter()` writes into `<style id="print-footer">` (Chrome only; other browsers skip the margins).

## Make a Story

Under each report, `#story-box` (shown by `renderReport()`) has one button, **📝 Make a Story**, which turns the report on the page into a CMS story — no new AI call, and no new report: it reads `currentReport`, which only `renderReport()` sets, so the story always matches what is shown (a failed Generate leaves the old report and its story). `buildStoryPayload()` sends the body shape of the sample the user gave for this API — `{language: "en", sessionId: "", state: "SUBMITTED", news: [story]}` — with every key of the sample present, even blank. `/api/report/story` adds the `S-id` header, the token and the category (see Architecture).

The story's own fields come from the report: `heading` ← `narrative.headline`, `description` ← the standfirst (`seo_description` cut to 160), `highlights` ← `key_highlights` (an array), `keywords` / `tags` built from the label and the top 5 topics — **arrays here**, as in this API's sample, unlike the main page's comma-separated strings for its own endpoint — and the reading time from the story's word count.

`story` is **the whole report**, by request: `reportStoryHtml()` walks the rendered `#report` article (not the reply), so whatever the page shows — masthead, kicker, standfirst, period, stat cards, key highlights, every section and chart, theme assessment, data notes, appendix, footnote — goes in, in page order. Only the `h1` (it is `heading`) and the timeline's axis labels are skipped. The output uses only the sample's kind of tags, one per line: `h2` (and the notes box's `h3`) → `<h4>`, other titles → `<p><strong>`, `.rp-sub` / `.rp-note` → `<p><em>`, and each chart → a `<ul>` of its numbers, read from the chart's DOM: `.rp-bars` rows, `.rp-stack-wrap` legend items (`Hindi: 48.8% (59)`), `.rp-colchart` columns' `title` (`January 2026: 121`), `.rp-timeline` rows' dot `title`s (dates per theme), `.rp-stats` cards, and table rows with cells joined by ` · `. So `blocksHtml()` depends on those class names: **a new kind of widget in the report needs its own branch there**, or it falls through as plain text (an element with children is walked into; a leaf becomes a `<p>`). Text goes through `escapeHtml()` (a copy in `report.js`), links only through `htmlLink()`, which links `http(s)` URLs alone, so nothing from the data becomes a tag.

A report has no claim, verdict, interview or video, so those fields are blank, `claim_rating` is `0`, and `show_claim_review` / `show_fast_check` / `interview_check` are `false`. `STORY_TEXT` holds the fixed values, and some are **guesses to confirm with the CMS**: `classification` stays the sample's `FACT_CHECK` (and `articletype` `NEWS_ARTICLE`) because those are the only values known to be accepted, and `news_label` is `Report`. Success shows `✅ Story created successfully! (ID: …)` via a copy of `extractFeedId()`; a reply with no id prints the raw text under it.

## Topic page

`public/topic.html` + `topic.js`, opened as `topic.html?from=2026-01-01&to=2026-01-31&topic=Iran+unrest` from the sidebar. There is no topic route upstream: `loadTopic()` GETs the same `api/report/range` as the report page for the same dates, with `narrative=false` — so the range comes from the database without model cost (on purpose, even though the report page always uses AI: the topic page shows only counts, and `true` would mean a ~15 s model call on every topic click), then `renderTopic()` keeps the `fact_checks` whose `topic` equals the one in the URL. Each fact-check has exactly one `topic`, and `topics[].count` adds up to the range's total, so the page's counts match the report page. Everything on it is counted in the browser by `countBy()` (language, medium, type, intent, targets, claimed_by); the only text taken from the API is the theme summary, when `themes` has this topic, otherwise `topicSummary()` writes the same kind of sentence. The breakdown chart is skipped for a single fact-check (every bar would be 100%).

A range with no data gets the API's 404, shown in `#topic-status` with a link back. Missing or malformed `from` / `to` / `topic`, and a topic with no fact-checks in those dates, also end in `#topic-status`; in the last case the sidebar still renders so another topic can be picked. The back link is `report.html?from=…&to=…`, which fills the dates in without starting a report.

## Repo state to be aware of

- `node_modules/` is committed to git, and `.gitignore` holds only `.env` and `.claude/`.
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

