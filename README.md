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

No address, token or ID is written in the code — every one comes from these
variables, so the required ones must be set (in `.env`, or on the server).

| Var           | Required? / default                    | Purpose                                  |
|---------------|----------------------------------------|------------------------------------------|
| `GENERATE_API`   | **required**                          | Upstream FastAPI `/generate` endpoint (main page) |
| `CREATE_FEED_API`| **required**                          | Hocalwire `createFeedV2` endpoint for **Create Feed** |
| `FEED_CATEGORY_ID`| **required**                         | Hocalwire section new feeds are filed under (`796`) |
| `SESSION_ID_EN`  | **required** for English feeds        | Hocalwire session token for English stories |
| `SESSION_ID_HI`  | **required** for Hindi feeds          | Hocalwire session token for Hindi stories   |
| `SESSION_ID_BN`  | **required** for Bangla feeds         | Hocalwire session token for Bangla stories  |
| `REPORT_RANGE_API` | **required**                        | FastAPI `/boom-research/range-report` for the report and topic pages (`http://127.0.0.1:8000/boom-research/range-report` until the VPS has the route) |
| `REPORT_DATES_API` | `REPORT_RANGE_API` with `/range-report` → `/dates` | The dates the research database covers, shown under the date pickers |
| `PORT`           | `3000`                                | Port the web UI runs on                  |
| `BASE_PATH`      | `/front-boom-assistant`               | Extra folder path to also serve under    |

`.env.example` has the current value of each one. When a required one is
missing, the server still starts, but prints `⚠️ Missing settings: …` and the
page that needs it shows an error naming it.

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

The Docker image never contains `.env`, so on Coolify every **required**
variable above must be set in the platform's environment settings.

## Two addresses

The app answers on **both** of these at the same time:

- the Coolify root address, where it sits at the top level — `https://<coolify-host>/`
- a folder path on a different host — `https://toolbox.boomlive.in/front-boom-assistant/`

`toolbox.boomlive.in` is a separate PHP project. This Node app only owns the
`/front-boom-assistant` folder there; the PHP app owns the root.

Two things make this work, and both must be kept:

1. **Internal links in `public/` never start with `/`.** They are written as
   `style.css`, `script.js`, `api/generate`, `api/create-feed`, `report.html`,
   `report.css`, `report-common.js`, `report.js`, `topic.html`, `topic.js`,
   `api/report/range`, `api/report/dates` and `./`. A leading
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
   it back in. Edits are stored in-memory, so **Create Feed** sends the
   edited version.

Fields rendered:

- `headline`, `strapline`, `body_markdown`, `slug`
- `short_tail_keywords`, `long_tail_keywords`, `story_tags` (comma-separated;
  when you edit them, newlines work as separators too)
- `suggested_rating` shown as a colored pill
- `usage` + `elapsed_seconds` shown as a footer line

Under the fields sits a **translation info** box, written in the language the
story was generated in:

```
🔄 अनुवाद की जानकारी:
मूल लेख ID: 32124
अनुवाद समय: 2 सितंबर 2026
समीक्षाकर्ता: BOOM
```

The date is today's, in that language's script. The original article ID comes
from the API response if it sends one (`original_article_id`,
`source_article_id` or `article_id`), otherwise from the number a BOOM article
URL ends with — `…/bihar-bridge-photo-fact-check-32124`. With neither, the ID
line is left out and the other two still show. Labels live in `INFO_TEXT` in
`public/script.js`.

## Create Feed

Below the generated output there is a **Create Feed** box that pushes the story
into Hocalwire as a new feed.

1. Click **Create Feed** — there is nothing to fill in. The browser builds the
   full payload and POSTs it to `api/create-feed`, which `server.js` forwards
   to `CREATE_FEED_API`.
2. Success shows one green line, `✅ Feed created successfully! (ID: 4916)`.
   A failure shows the error message in red.

The box has no input fields. The payload leaves the browser with `sessionId`
and `categoryId` empty, and `/api/create-feed` fills them in from the server's
settings — the session token from `SESSION_ID_EN` / `SESSION_ID_HI` /
`SESSION_ID_BN` according to the story's `language`, and the category from
`FEED_CATEGORY_ID`. So the token is never typed in or visible in the page. A
language with no token set returns a `500` naming the variable to add. To
change a category, or when a token expires, update `.env` (or the platform's
env vars) and restart — nothing in the browser changes.

### Seeing what was sent

Pressing **Create Feed** logs in two places, because neither side knows
everything:

- **Browser console** (F12 → Console) — language, the URL the page posted to,
  the original article ID and the whole payload. `sessionId` and `categoryId`
  read blank there, because the server adds them.
- **Terminal running the server** — language, the real upstream URL, the
  category, and the session token *masked* (`RDWEBJ79…R11S`). Enough to tell
  which token was used; never the whole thing, since hosts keep their logs.

The reply from the CMS is logged in the browser too.

The mapping lives in `buildFeedPayload()` in `public/script.js`. It combines the
generated output and the form values that were submitted; the session token and
the category are added by the server. Two parts are best-guess and worth
confirming against the CMS:

- `CLAIM_RATING` — the number stored for each verdict. Only `False → 2` is
  confirmed from the sample payload.
- `FEED_TEXT` — the fixed labels (`location`, `reviewed_by`, interview question
  and answer, and so on), one set per language.

`slug`, `long_tail_keywords` and `story_tags` are generated but have no matching
key in the feed payload, so they are not sent.

## Monthly Report

The **📊 Monthly Report** button in the top bar opens `report.html`, which turns
BOOM's coded fact-check data (the research database, `boom_report`) into a
misinformation report for **any range of dates**, laid out like the PDF draft.

1. Pick a **From Date** and a **To Date** (both days are included). They start
   as one month up to today, for example 23-10-2026 → 23-11-2026; **Reset**
   goes back to that. Under the boxes the page shows which dates the database
   has (from `api/report/dates`). If your dates are all outside them, the note
   turns red and offers a button that fills in the latest month that has data.
2. Click **Generate Report**. The page asks
   `api/report/range?from_date=…&to_date=…&narrative=true`, which `server.js`
   forwards to `REPORT_RANGE_API` (the FastAPI `/boom-research/range-report`
   route). Before asking, it checks that From is not after To and that the
   range is at most 366 days. The report text is **always written by AI** —
   there is no on/off switch — so while it works the button reads "Writing the
   report with AI…" (about 15–20 seconds). If the AI fails, the API falls back
   to template text and says so in the data notes.
3. The report appears below: headline, stat cards, key highlights, charts
   (months, languages, topics, a dot timeline of the range, targets, AI,
   medium / intent / type), the media-misreporting table, theme assessment,
   data notes and an appendix of every fact-check.

A report starts **only when you click Generate Report** — never by itself.
Buttons that fill in dates, and the topic page's "← … report" link, only fill
the boxes. There is no file upload, Copy JSON or print / PDF button; if you
print with the browser (Ctrl+P) anyway, only the report is printed.

### Topic reports

Next to the report, a **Topics** sidebar lists every topic in those dates, the
biggest first, with its number of fact-checks. Type in **Find a topic…** to
narrow the list. Clicking a topic opens its own report, for the same dates, in
a new tab (`topic.html?from=2026-01-01&to=2026-02-01&topic=Iran+unrest`):

- a headline and stat cards — how many fact-checks, their share of the range,
  and how many involved AI, old content or media misreporting;
- a dot timeline of when they were published;
- the split by language, medium, type of deception and intent;
- who was targeted and who spread the claims;
- every fact-check on the topic, with its claim.

The topic page asks for the same dates from the database again (without AI
text, so it takes under a second) and keeps only that topic's fact-checks. It
has the same sidebar, so you can jump between topics, and a link back to the
report page with the dates filled in.

`REPORT_RANGE_API` points at `127.0.0.1:8000` in `.env.example`, because the
deployed service has no range-report route yet. Change it when it does —
`REPORT_DATES_API` follows it on its own when left out.

This app never connects to Postgres. The database login (`DB_HOST`,
`DB_PASSWORD`, `RESEARCH_DB_NAME`, …) lives only in the FastAPI service's own
`.env`, so it never appears in this app, its logs or the page.

## Files

```
front-boom-assistant/
├── package.json
├── server.js            # Express + proxy, mounted at / and BASE_PATH
├── public/
│   ├── index.html       # Form + response layout, trailing-slash guard
│   ├── style.css        # BOOM-style styling (shared by all pages)
│   ├── script.js        # Fetch + editable rendering
│   ├── report.html      # Monthly Report page
│   ├── report.css       # Report + topic layout, sidebar, charts, print styles
│   ├── report-common.js # Helpers shared by report.js and topic.js
│   ├── report.js        # From/To dates, report rendering
│   ├── topic.html       # One topic's report for a date range
│   └── topic.js         # Loads the range, keeps one topic, draws it
└── README.md
```
