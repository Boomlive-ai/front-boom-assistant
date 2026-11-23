// report.js — the report page. The editor picks a From Date and a To Date (by
// default the month up to today) and clicks Generate Report. The page asks
// api/report/range for that range, with the text written by AI, and draws the
// reply in the layout of BOOM's monthly report PDF, with a sidebar of the
// range's topics that each open topic.html in a new tab.
//
// report-common.js is loaded first and supplies el(), the chart pieces, the
// date helpers and the sidebar — this file holds only what belongs to this page.

const form = document.getElementById('report-form');
const fromInput = document.getElementById('from-date');
const toInput = document.getElementById('to-date');
const datesNote = document.getElementById('dates-note');
const reportBtn = document.getElementById('report-btn');
const reportError = document.getElementById('report-error');
const reportLayout = document.getElementById('report-layout');
const topicNav = document.getElementById('topic-nav');
const report = document.getElementById('report');
const storyBox = document.getElementById('story-box');
const storyBtn = document.getElementById('story-btn');
const storyResult = document.getElementById('story-result');

// The backend refuses a longer range, so the page checks first.
const MAX_RANGE_DAYS = 366;

// What the database covers, from api/report/dates:
// {data_from, data_to, fact_checks, default_from, default_to}. null until it
// has loaded, or when it could not be loaded.
let dataSpan = null;

// The reply behind the report on the page — what Make a Story turns into a
// story. Set only by renderReport(), so it always matches what is shown: a
// failed Generate leaves the old report, and the old story, in place.
let currentReport = null;

// ---------- utilities ----------
function setLoading(loading) {
  reportBtn.disabled = loading;
  reportBtn.classList.toggle('loading', loading);
  // The text is always written by AI, which takes a while, so say so.
  reportBtn.querySelector('.btn-label').textContent = loading
    ? 'Writing the report with AI…'
    : 'Generate Report';
}

function setNote(node, parts, isError = false) {
  node.replaceChildren(...[].concat(parts).filter(Boolean));
  node.classList.toggle('is-error', isError);
}

// `extra` may hold null / false (from `cond && el(…)`), which are skipped —
// replaceChildren() would otherwise print them as the words "null" / "false".
function showError(message, ...extra) {
  reportError.replaceChildren(el('p', null, message), ...extra.filter(Boolean));
  reportError.hidden = false;
}

// ---------- dates ----------

// Today as YYYY-MM-DD in the editor's own time zone. (toISOString() would give
// the UTC date, which in India is still yesterday before 5:30 am.)
function todayIso() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

// The same day one month earlier: 23 Nov → 23 Oct. A day the earlier month
// does not have becomes its last day: 31 Mar → 28 Feb.
function oneMonthBefore(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const daysInPrevMonth = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 2, Math.min(d, daysInPrevMonth))).toISOString().slice(0, 10);
}

// Days from `from` to `to`, both counted: 1 Jan – 1 Feb is 32.
const daysCovered = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;

// The calendar only offers dates that keep From on or before To.
function linkDateLimits() {
  toInput.min = fromInput.value || '';
  fromInput.max = toInput.value || '';
}

function setDates(from, to) {
  fromInput.value = from;
  toInput.value = to;
  linkDateLimits();
  updateDatesNote();
}

// A button that fills in the last month the database has — it only fills the
// dates; the report still waits for Generate Report.
function latestMonthButton() {
  if (!dataSpan || !dataSpan.data_to) return null;
  const to = dataSpan.default_to || dataSpan.data_to;
  const from = dataSpan.default_from || oneMonthBefore(to);
  const btn = el('button', 'btn ghost small', `Use ${longDate(from)} – ${longDate(to)}`);
  btn.type = 'button';
  btn.title = 'The latest month that has fact-checks in the database';
  btn.addEventListener('click', () => {
    setDates(from, to);
    reportError.hidden = true;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    reportBtn.focus({ preventScroll: true });
    showToast('Dates filled in — click Generate Report');
  });
  return btn;
}

// The line under the dates: what the database covers, and a warning when the
// chosen dates fall completely outside it (the report would come back empty).
function updateDatesNote() {
  if (!dataSpan || !dataSpan.data_from) return;
  const span = `${longDate(dataSpan.data_from)} – ${longDate(dataSpan.data_to)}`;
  const from = fromInput.value;
  const to = toInput.value;
  const outside =
    isIsoDate(from) && isIsoDate(to) && (to < dataSpan.data_from || from > dataSpan.data_to);
  if (outside) {
    setNote(
      datesNote,
      // [`No fact-checks in these dates: the database has ${span}. `, latestMonthButton()],
      true
    );
  } else {
    // setNote(datesNote, `Data in the database: ${span} (${dataSpan.fact_checks} fact-checks).`);
  }
}

async function loadDataSpan() {
  try {
    // Relative on purpose — see README "Two addresses".
    const res = await fetch('api/report/dates', {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(extractErrorMessage(data, res.status));
    dataSpan = data;
    updateDatesNote();
  } catch (err) {
    // Only a hint is lost: the report itself can still be asked for.
    console.error('Could not load the dates the database covers:', err);
    setNote(datesNote, '');
  }
}

fromInput.addEventListener('change', () => {
  reportError.hidden = true;
  linkDateLimits();
  updateDatesNote();
});
toInput.addEventListener('change', () => {
  reportError.hidden = true;
  linkDateLimits();
  updateDatesNote();
});

// ---------- month charts ----------

// Vertical columns, one per month. Both monthly charts share one scale (`max`)
// so the AI columns can be compared with the totals honestly.
function columnChart(title, months, key, max) {
  const cols = el('div', 'rp-cols');
  const labels = el('div', 'rp-col-labels');
  months.forEach((m) => {
    const value = m[key] || 0;
    const bar = el('span', 'rp-col-bar');
    // 18px stays free above the tallest column for its number.
    bar.style.height = `calc((100% - 18px) * ${(value / max).toFixed(4)})`;
    const col = el(
      'div',
      'rp-col' + (m.selected ? ' is-selected' : ''),
      m.selected && el('span', 'rp-col-value', String(value)),
      bar
    );
    col.title = `${m.label}: ${value}`;
    cols.append(col);
    labels.append(
      el('span', m.selected ? 'is-selected' : null, m.short_label || m.month)
    );
  });
  return el('div', 'rp-colchart', el('h4', null, title), cols, labels);
}

// ---------- report sections ----------

function statCards(s) {
  // Compared with the period before when the database has it (the month before
  // for a whole month, otherwise the same number of days just before);
  // otherwise the busiest day.
  const prev = s.previous_period || s.previous_month;
  let firstSub = '';
  if (prev && prev.fact_checks != null) {
    const change =
      prev.change_percent ??
      (prev.fact_checks ? ((s.fact_checks - prev.fact_checks) / prev.fact_checks) * 100 : 0);
    firstSub = `${signed(change)}% vs ${prev.label || prev.month} (${prev.fact_checks})`;
  } else if (s.busiest_day && s.busiest_day.dates && s.busiest_day.dates.length) {
    firstSub = `Busiest day: ${s.busiest_day.dates.map(shortDate).join(', ')} (${s.busiest_day.fact_checks})`;
  }

  const ai = s.ai || {};
  const old = s.old_content || {};
  const media = s.media_misreporting || {};
  return el(
    'div',
    'rp-stats',
    statCard('Fact-checks published', s.fact_checks, firstSub),
    statCard('Involved AI', ai.count, ai.percent != null && `${pct(ai.percent)} of all`),
    statCard('Recycled old content', old.count, old.percent != null && `${pct(old.percent)} of all`),
    statCard(
      'Media misreporting',
      media.count,
      s.media_misreporting_ai != null && `${s.media_misreporting_ai} of them involved AI`
    )
  );
}

function highlightsBox(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return el(
    'div',
    'rp-box',
    el('h2', null, 'Key highlights'),
    el('ul', 'rp-highlights', ...list.map((h) => el('li', null, h)))
  );
}

function monthlyChart(monthly) {
  // A month still being filled in would look like a slump, so it is left out —
  // the PDF draft did the same with September.
  const months = (monthly || []).filter((m) => !m.partial);
  const partial = (monthly || []).filter((m) => m.partial);
  if (!months.length) return null;

  const max = Math.max(1, ...months.map((m) => m.fact_checks || 0));
  // `selected` marks every month the chosen dates touch.
  const selected = months.filter((m) => m.selected);
  const busiest =
    selected.length === 1 &&
    months.every((m) => (m.fact_checks || 0) <= selected[0].fact_checks) &&
    selected[0];

  const first = months[0].label || '';
  const last = months[months.length - 1].label || '';
  const sameYear = first.split(' ')[1] === last.split(' ')[1];
  const range = months.length > 1 ? `${sameYear ? monthName(first) : first}–${last}` : first;

  return chartCard(
    busiest ? `${busiest.label} was the busiest month in the data` : 'Fact-checks per month',
    `Fact-checks published per month, and how many of them involved AI, ${range}.` +
      (selected.length ? ' The months these dates cover have their numbers shown.' : ''),
    el(
      'div',
      'rp-two-col',
      columnChart('All fact-checks', months, 'fact_checks', max),
      columnChart('AI-related fact-checks', months, 'ai', max)
    ),
    note(
      partial.length &&
        `${joinAnd(partial.map((m) => m.label))} ${partial.length > 1 ? 'are' : 'is'} left out because the data for ${partial.length > 1 ? 'those months' : 'that month'} is incomplete.`
    )
  );
}

function languageChart(language, total, label) {
  if (!Array.isArray(language) || !language.length) return null;
  const top = language[0];
  return chartCard(
    `${top.label} made up ${pct(top.percent)} of the fact-checks`,
    `Share of fact-checks by publishing language, ${label} (n = ${total})`,
    stackedBar(language)
  );
}

function topicsChart(topics, label) {
  // "Uncoded" is a gap in the sheet, not a story, so it never takes a bar.
  const list = (topics || []).filter((t) => t.topic !== 'Uncoded').slice(0, 10);
  if (!list.length) return null;
  const top = leaders(list).map((t) => t.topic);
  return chartCard(
    `${joinAnd(top)} drew the most fact-checks`,
    `Fact-checks per topic, ${label}. The ${list.length} most fact-checked topics.`,
    barList(list.map((t) => ({ label: t.topic, value: t.count })))
  );
}

function timelineChart(themes, dates, meta, label) {
  if (!Array.isArray(themes) || !themes.length || !dates.length) return null;
  return chartCard(
    'When the biggest stories broke',
    'Each dot is one fact-check, placed on the day it was published. Hover a dot for its headline.',
    dotTimeline(themes, dates),
    el('p', 'rp-axis-title', meta.whole_month ? `Day of ${label}` : `Date, ${label}`)
  );
}

function targetsChart(targets, label) {
  if (!Array.isArray(targets) || !targets.length) return null;
  const top = leaders(targets).map((t) => t.label);
  return chartCard(
    `${joinAnd(top)} ${top.length > 1 ? 'were the most frequent targets' : 'was the most frequent target'}`,
    `Fact-checks naming each entity as a target, ${label}. The top ${targets.length}.`,
    barList(targets.map((t) => ({ label: t.label, value: t.count })))
  );
}

function aiSection(ai, paragraph, label) {
  if (!ai) return null;
  return section(
    `AI: ${ai.count} fact-checks (${pct(ai.percent)})`,
    ...paragraphs(paragraph),
    chartCard(
      'How the AI fact-checks break down',
      `${ai.count} AI-related fact-checks by format, type of deception and desk, ${label}`,
      stackedGroup('Format', ai.by_medium),
      stackedGroup('Type of deception', ai.by_type),
      stackedGroup('Desk', ai.by_language)
    )
  );
}

function mediaSection(media, paragraph) {
  if (!media) return null;
  const rows = (media.fact_checks || []).map((fc) => [
    shortDate(fc.date),
    (fc.outlets || []).join(', ') || 'Not named',
    el('span', null, link(fc.url, fc.headline), ' ', chip(fc.language, 'lang')),
    fc.ai ? chip('AI', 'ai') : '',
  ]);
  return section(
    'News media in the frame',
    ...paragraphs(paragraph),
    rows.length ? table(['Date', 'Outlet named in data', 'What was debunked', 'AI'], rows) : null
  );
}

function themesSection(themes) {
  if (!Array.isArray(themes) || !themes.length) return null;
  return section(
    'Theme assessment',
    ...themes.map((t) =>
      el(
        'div',
        'rp-theme',
        el('h3', null, t.topic),
        ...paragraphs(t.summary),
        el(
          'ul',
          'rp-fc-list',
          ...(t.fact_checks || []).map((fc) =>
            el(
              'li',
              null,
              el('span', 'rp-fc-date', shortDate(fc.date)),
              chip(fc.language, 'lang'),
              ' ',
              link(fc.url, fc.headline),
              ' ',
              flagChips(fc)
            )
          )
        )
      )
    )
  );
}

function breakdownsSection(b, total, label) {
  if (!b) return null;
  const medium = b.medium || [];
  return section(
    'Medium, intent and type of deception',
    chartCard(
      medium.length
        ? `${pct(medium[0].percent)} of fact-checks involved ${medium[0].label.toLowerCase()}`
        : 'Medium, intent and type of deception',
      `Share of fact-checks by medium, intent and type of deception, ${label} (n = ${total})`,
      stackedGroup('Medium', b.medium),
      stackedGroup('Intent', b.intent),
      stackedGroup('Type of deception', b.type)
    )
  );
}

function notesBox(dataNotes, flags) {
  const notes = (dataNotes && dataNotes.notes) || [];
  // `flags` is empty in every reply seen so far; whatever it holds is shown
  // as text, since its shape is not fixed.
  const flagLines = (flags || []).map((f) => `Flag: ${typeof f === 'string' ? f : JSON.stringify(f)}`);
  const lines = [...flagLines, ...notes];
  if (!lines.length) return null;
  return el(
    'div',
    'rp-notes',
    el('h3', null, 'Methodology and data notes'),
    el('ul', null, ...lines.map((n) => el('li', null, n)))
  );
}

function appendix(factChecks) {
  if (!Array.isArray(factChecks) || !factChecks.length) return null;
  return section(
    `Appendix: all ${factChecks.length} fact-checks`,
    el(
      'p',
      null,
      'Every fact-check counted in this report, with the topic it was coded under. Headlines link to the published fact-checks.'
    ),
    table(
      ['Date', 'Lang', 'Headline', 'Topic', 'Flags'],
      factChecks.map((fc) => [
        shortDate(fc.date),
        fc.language,
        link(fc.url, fc.headline),
        fc.topic,
        flagChips(fc),
      ])
    )
  );
}

// ---------- render the whole report ----------
function renderReport(data) {
  const meta = data.meta || {};
  const n = data.narrative || {};
  const s = data.summary || {};
  // "January 2026" for a whole month, otherwise "15 February – 20 March 2026".
  const label = meta.label || `${meta.from_date} – ${meta.to_date}`;

  // Every date of the range, in order: the x axis of the dot timeline.
  const daily = data.daily || [];
  const dates = daily.length ? daily.map((d) => d.date) : datesBetween(meta.from_date, meta.to_date);

  // "Period: 15 February – 20 March 2026 (34 days) · Based on … (Hindi, Bangla and English)"
  const languages = (data.language || []).map((l) => l.label);
  const period = [
    `Period: ${label}${meta.days ? ` (${meta.days} days)` : ''}`,
    `Based on BOOM's coded fact-check database${languages.length ? ` (${joinAnd(languages)})` : ''}`,
  ].join(' · ');

  report.replaceChildren(
    masthead(),
    el('p', 'rp-kicker', `${meta.whole_month ? 'Monthly misinformation' : 'Misinformation'} report · ${label}`),
    el('h1', 'rp-headline', n.headline || `BOOM Research Report: ${label}`),
    n.standfirst && el('p', 'rp-standfirst', n.standfirst),
    el('p', 'rp-period', period),
    statCards(s),
    highlightsBox(n.key_highlights),
    section(
      'Overview',
      ...paragraphs(n.overview),
      monthlyChart(data.monthly),
      languageChart(data.language, s.fact_checks, label)
    ),
    section(
      'What was fact-checked',
      topicsChart(data.topics, label),
      timelineChart(data.themes, dates, meta, label)
    ),
    data.targets && data.targets.length
      ? section('Who was targeted', targetsChart(data.targets, label))
      : null,
    aiSection(data.ai, n.ai_paragraph, label),
    mediaSection(data.media_misreporting, n.media_paragraph),
    themesSection(data.themes),
    breakdownsSection(data.breakdowns, s.fact_checks, label),
    notesBox(data.data_notes, data.flags),
    appendix(data.fact_checks),
    footnote(meta, data.narrative_source, label)
  );

  // There is no print button, but if someone prints anyway (Ctrl+P), the page
  // title becomes the file name and Chrome prints this footer on every page.
  document.title = `BOOM Report ${label}`;
  setPrintFooter(`BOOM Report · ${label} · Draft`);

  // Every topic in the range, each opening its own report in a new tab.
  showTopicSidebar(topicNav, reportLayout, data, { newTab: true });

  // A new report, so a new story: the line left by the last one goes.
  currentReport = data;
  storyResult.hidden = true;
  storyBox.hidden = false;

  report.hidden = false;
  reportLayout.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ==========================================================================
   Make a Story — turns the report on the page into a createFeedV2 payload and
   POSTs it through api/create-feed, the main page's Create Feed route, which
   adds the session token and the category from the server's settings.
   Nothing here asks for a new report: the story is the report that is
   already on the page.
   ========================================================================== */

// Fixed values the CMS needs that the report has no data for. These are the
// best guesses to confirm with the CMS — the sample payload was a fact-check,
// and a report has no claim, verdict or interview.
const STORY_TEXT = {
  // The sample's values, kept because they are the only ones known to be
  // accepted; ask the CMS team if a report should have another classification.
  articleType: 'NEWS_ARTICLE',
  classification: 'FACT_CHECK',
  reviewType: 'FULL',
  // The label on the story, where a fact-check says "Fact Check".
  newsLabel: 'Report',
  highlightsHeading: 'Key highlights',
  highlightName: 'Top story',
  location: 'Mumbai',
  reportedFrom: 'BOOM Live',
  langLabel1: 'Read in English',
  langLabel2: 'Hindi version',
  readUnit: 'min read',
};

// The story goes to the CMS as HTML, so every piece of text is escaped first:
// nothing in the data can turn into a tag.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A link only for a real web address (like link() on the page); otherwise
// just the text.
function htmlLink(url, text) {
  const href = String(url || '').trim();
  return /^https?:\/\//i.test(href)
    ? `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`
    : escapeHtml(text);
}

// Text that may be one string or a list of paragraphs, as a clean list.
const textList = (value) =>
  [].concat(value ?? []).map((s) => String(s ?? '').trim()).filter(Boolean);

// Trim, drop blanks and repeats, keep the order.
function cleanList(...lists) {
  const seen = new Set();
  return lists.flat().map((v) => String(v ?? '').trim()).filter((v) => v && !seen.has(v) && seen.add(v));
}

// ~200 words a minute, in whole minutes, at least one.
function readingTimeSeconds(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(60, Math.round(words / 200) * 60);
}

function truncate(str, max) {
  const s = String(str || '');
  return s.length > max ? s.slice(0, max).trimEnd() + '...' : s;
}

// ---------- the whole report, as story HTML ----------
// The story is the report exactly as it is drawn on the page: every section,
// every chart, the theme assessment, the data notes, the appendix and the
// footnote, in the same order. It is read from the #report article itself
// (not rebuilt from the reply), so anything the page shows ends up in the
// story too. The CMS only gets plain tags — <h4>, <p>, <ul>/<li>, <strong>,
// <em> and <a> — like the sample's story, so:
//   • section titles become <h4>; chart and theme titles <p><strong>;
//   • a chart becomes the list of its numbers ("Hindi: 48.8% (59)");
//   • a table becomes a list, its cells joined with " · ";
//   • the headline is left out (it is the story's `heading`), and so are the
//     timeline's axis labels, which mean nothing without the chart.
// Every piece of text is escaped, so nothing can turn into a tag.

const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// The text of one AI / Media / Old chip group: "AI, Old".
const chipsText = (node) =>
  [...node.querySelectorAll('.rp-chip')].map((c) => squash(c.textContent)).filter(Boolean).join(', ');

// The inside of a paragraph, list item or table cell: text, links and bold.
// A language chip after a headline reads "(Hindi)"; a flags group "(AI, Old)".
function inlineHtml(node) {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += escapeHtml(child.textContent);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      if (child.matches('a')) out += htmlLink(child.getAttribute('href'), squash(child.textContent));
      else if (child.matches('b, strong')) out += `<strong>${inlineHtml(child)}</strong>`;
      else if (child.matches('.rp-flags')) out += chipsText(child) ? ` (${chipsText(child)})` : '';
      else if (child.matches('.rp-chip')) out += ` (${escapeHtml(squash(child.textContent))})`;
      else out += inlineHtml(child);
    }
  });
  return out.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
}

// The same for one element itself (inlineHtml only reads what is inside it).
function ownHtml(node) {
  const holder = document.createElement('span');
  holder.append(node.cloneNode(true));
  return inlineHtml(holder);
}

// A piece that is nothing but chips — "(AI, Old)" — stands on its own in a
// list item or table cell, so it loses the brackets: "AI, Old".
const unwrap = (html) => html.replace(/^\(([^()]*)\)$/, '$1');

// One <ul>, skipping empty items. `items` are HTML already.
function ulHtml(items) {
  const list = items.filter(Boolean);
  return list.length ? `<ul>\n${list.map((i) => `<li>${i}</li>`).join('\n')}\n</ul>` : '';
}

// "Hindi 48.8% (59)" (a chart legend) → "Hindi: 48.8% (59)".
function legendText(item) {
  const text = squash(item.textContent);
  const m = text.match(/^(.*?) (\d[\d.,]*%) \((\d+)\)$/);
  return escapeHtml(m ? `${m[1]}: ${m[2]} (${m[3]})` : text);
}

// One row of the dot timeline: "Iran unrest (12 fact-checks): 09 Jan, 13 Jan (3), …".
function timelineRowText(row) {
  const name = squash(row.querySelector('.rp-tl-label span')?.textContent);
  const count = squash(row.querySelector('.rp-tl-label small')?.textContent);
  const dots = [...row.querySelectorAll('.rp-dot')].sort(
    (a, b) => parseFloat(a.style.left) - parseFloat(b.style.left)
  );
  const perDate = new Map();
  dots.forEach((dot) => {
    const date = dot.title.split(' · ')[0];
    perDate.set(date, (perDate.get(date) || 0) + 1);
  });
  const dates = [...perDate].map(([date, k]) => (k > 1 ? `${date} (${k})` : date)).join(', ');
  return escapeHtml(`${name}${count ? ` (${count})` : ''}${dates ? `: ${dates}` : ''}`);
}

// Walks the report's elements in order and writes each one as story HTML.
function blocksHtml(node, out) {
  for (const child of node.children) {
    if (child.matches('h1, .rp-axis-title, .rp-axis, .rp-tl-axis')) continue;

    if (child.matches('.rp-masthead')) {
      out.push(`<p>${escapeHtml([...child.children].map((c) => squash(c.textContent)).join(' · '))}</p>`);
    } else if (child.matches('h2, .rp-notes > h3')) {
      out.push(`<h4>${escapeHtml(squash(child.textContent))}</h4>`);
    } else if (child.matches('h3, h4, h5, h6')) {
      out.push(`<p><strong>${escapeHtml(squash(child.textContent))}</strong></p>`);
    } else if (child.matches('.rp-sub, .rp-note')) {
      const html = inlineHtml(child);
      if (html) out.push(`<p><em>${html}</em></p>`);
    } else if (child.matches('p')) {
      const html = inlineHtml(child);
      if (html) out.push(`<p>${html}</p>`);
    } else if (child.matches('.rp-stats')) {
      // The four stat cards: "Fact-checks published: 121 — +36% vs December (89)".
      out.push(
        ulHtml(
          [...child.querySelectorAll('.rp-stat')].map((stat) => {
            const label = squash(stat.querySelector('.rp-stat-label')?.textContent);
            const value = squash(stat.querySelector('.rp-stat-value')?.textContent);
            const sub = squash(stat.querySelector('.rp-stat-sub')?.textContent);
            return `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}${sub ? ` — ${escapeHtml(sub)}` : ''}`;
          })
        )
      );
    } else if (child.matches('.rp-bars')) {
      out.push(
        ulHtml(
          [...child.querySelectorAll('.rp-bar-row')].map((row) =>
            escapeHtml(
              `${squash(row.querySelector('.rp-bar-label')?.textContent)}: ${squash(row.querySelector('.rp-bar-value')?.textContent)}`
            )
          )
        )
      );
    } else if (child.matches('.rp-stack-wrap')) {
      out.push(ulHtml([...child.querySelectorAll('.rp-legend-item')].map(legendText)));
    } else if (child.matches('.rp-colchart')) {
      // A monthly column chart: its title, then "January 2026: 121" per month.
      const title = squash(child.querySelector('h4')?.textContent);
      if (title) out.push(`<p><strong>${escapeHtml(title)}</strong></p>`);
      out.push(ulHtml([...child.querySelectorAll('.rp-col')].map((col) => escapeHtml(col.title))));
    } else if (child.matches('.rp-timeline')) {
      out.push(ulHtml([...child.querySelectorAll('.rp-tl-row:not(.rp-tl-axis)')].map(timelineRowText)));
    } else if (child.matches('table')) {
      out.push(
        ulHtml(
          [...child.querySelectorAll('tbody tr')].map((tr) =>
            [...tr.children].map((td) => unwrap(inlineHtml(td))).filter(Boolean).join(' · ')
          )
        )
      );
    } else if (child.matches('ul, ol')) {
      out.push(
        ulHtml(
          [...child.children].map((li) =>
            // A theme's fact-check: date · language · headline · flags.
            child.matches('.rp-fc-list')
              ? [...li.children].map((part) => unwrap(ownHtml(part))).filter(Boolean).join(' · ')
              : inlineHtml(li)
          )
        )
      );
    } else if (child.children.length) {
      // section, figure, footer, a box or column wrapper: what is inside it.
      blocksHtml(child, out);
    } else {
      // Anything else that holds text is kept as a paragraph.
      const html = inlineHtml(child);
      if (html) out.push(`<p>${html}</p>`);
    }
  }
  return out;
}

// The whole report article as one HTML string, one tag per line — the shape
// of the sample's `story`.
const reportStoryHtml = () => blocksHtml(report, []).filter(Boolean).join('\n');

// The createFeedV2 payload: one flat object, the same shape (and the same
// keys) as the main page's Create Feed sends, because it goes through the same
// route, api/create-feed → CREATE_FEED_API. sessionId and categoryId leave the
// page blank on purpose — that route fills them in from the server's settings
// (SESSION_ID_EN, since the report is English, and FEED_CATEGORY_ID). Every
// key is always sent, even when it is blank.
// `data` is the reply behind the report on the page; the story's text is read
// from the page itself (reportStoryHtml), which renderReport() drew from it.
function buildStoryPayload(data) {
  const meta = data.meta || {};
  const n = data.narrative || {};
  const label = meta.label || `${meta.from_date} – ${meta.to_date}`;
  const t = STORY_TEXT;

  const heading = String(n.headline || `BOOM Research Report: ${label}`).trim();
  const standfirst = textList(n.standfirst).join(' ');
  const story = reportStoryHtml();
  // Counted on the text only, without the tags.
  const readSec = readingTimeSeconds(story.replace(/<[^>]+>/g, ' '));
  const topTopics = (data.topics || [])
    .filter((x) => x.topic && x.topic !== 'Uncoded')
    .slice(0, 5)
    .map((x) => x.topic);
  const reportKind = meta.whole_month ? 'Monthly Report' : 'Report';
  const caption = `BOOM misinformation report, ${label}`;

  return {
    ReviewBoxcheckbox_2: true,
    ReviewBoximage_advanced_5: '',
    articletype: t.articleType,
    avatarId: 1,
    // Empty like sessionId below: api/create-feed fills both in.
    categoryId: '',
    // A report has no single claim or verdict, so the claim fields are blank
    // and the claim-review and fast-check boxes are switched off below.
    claim_fact_check: '',
    claim_rating: 0,
    claim_review: '',
    claim_source: '',
    claimed_by: '',
    classification: t.classification,
    description: standfirst,
    fact_check_summary: '',
    fact_check_summary_claim: '',
    fast_check_claim: '',
    fast_check_previous_url: '',
    fast_check_review_type: t.reviewType,
    fast_check_your_fact: '',
    fastcheck_media: [],
    guest_name: '',
    heading,
    highlightLinkPost: '',
    highlightNamePost: t.highlightName,
    highlight_icon: 'flag',
    highlights: textList(n.key_highlights),
    highlights_heading: t.highlightsHeading,
    // One comma-separated string each, as the main page's Create Feed sends
    // them to this endpoint: keywords spaced after the comma, tags not.
    keywords: cleanList(
      `BOOM ${reportKind.toLowerCase()}`,
      `misinformation ${label}`,
      `fact-checks ${label}`,
      topTopics,
      data.ai && data.ai.count ? 'AI misinformation' : []
    ).join(', '),
    tags: cleanList('Misinformation', reportKind, topTopics).join(','),
    // No interview in a report.
    interview_ans: [],
    interview_check: false,
    interview_ques: [],
    interviewer_name: '',
    language: 'en',
    location: t.location,
    mediaIds: [],
    news_label: t.newsLabel,
    news_label_url: '',
    news_read_time_sec: readSec,
    news_speech_file_path: '',
    // A new story has not been read yet.
    news_trending_view_count: 0,
    news_type: 'USER',
    point_lat: 13.0368,
    point_long: 80.2676,
    rating_explanation: '',
    read_duration: `${Math.round(readSec / 60)} ${t.readUnit}`,
    reviewed_by: 'BOOM',
    seo_description: truncate(standfirst, 160),
    // Left empty on purpose. The session token is a credential, so it lives in
    // the server's settings: api/create-feed picks the one for `language`.
    sessionId: '',
    show_claim_review: false,
    show_fast_check: false,
    state: 'SUBMITTED',
    story,
    story_language_label_1: t.langLabel1,
    story_language_label_2: t.langLabel2,
    story_language_link_1: '',
    story_language_link_2: '',
    story_reported_from: t.reportedFrom,
    'test-cap': caption,
    'test-lang': 'en',
    text_caption: caption,
    // No video in a report.
    video_duration: '',
  };
}

function setStoryLoading(loading) {
  storyBtn.disabled = loading;
  storyBtn.classList.toggle('loading', loading);
  // Keep the emoji — this overwrites the label set in report.html.
  storyBtn.querySelector('.btn-label').textContent = loading ? '⏳ Making the story…' : '📝 Make a Story';
}

function showStoryResult(text, isError) {
  storyResult.hidden = false;
  storyResult.textContent = text;
  storyResult.classList.toggle('error', Boolean(isError));
}

// The new story's id, as the main page's Create Feed reads it: {feedId: 4916}
// so far, a few other spellings accepted, and one {data: {...}} unwrapped.
function extractFeedId(data) {
  if (!data || typeof data !== 'object') return '';
  const id = data.feedId ?? data.feed_id ?? data.id;
  if (id != null && id !== '') return String(id);
  if (data.data && typeof data.data === 'object') return extractFeedId(data.data);
  return '';
}

storyBtn.addEventListener('click', async () => {
  if (!currentReport) {
    showToast('Generate a report first.', true);
    return;
  }
  const payload = buildStoryPayload(currentReport);

  // Printed to the browser console (F12 → Console) so it is clear what left the
  // page. sessionId and categoryId are blank here on purpose — the server adds
  // them — and the terminal running the server prints those two.
  console.log('📰 Make a Story — sending request with config:');
  console.log('👉 Language:', payload.language);
  console.log('👉 URL:', new URL('api/create-feed', location.href).href);
  console.log('👉 SessionId:', '(added by the server, from .env)');
  console.log('👉 CategoryId:', '(added by the server, from .env)');
  console.log('👉 Payload:', JSON.stringify(payload, null, 2));

  setStoryLoading(true);
  try {
    // The same route as the main page's Create Feed. Relative on purpose —
    // see README "Two addresses".
    const res = await fetch('api/create-feed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!res.ok) {
      throw new Error(data ? extractErrorMessage(data, res.status) : text.slice(0, 300));
    }
    console.log('✅ Story created. Reply from the CMS:', data ?? text);

    // One short line; the raw reply only when it has no id, so a surprise
    // answer is never hidden.
    const id = extractFeedId(data);
    const done = '✅ Story created successfully!';
    showStoryResult(id ? `${done} (ID: ${id})` : `${done}\n${text}`.trim(), false);
    showToast(done);
  } catch (err) {
    console.error(err);
    showStoryResult(err.message || 'Request failed', true);
    showToast(err.message || 'Make a Story failed', true);
  } finally {
    setStoryLoading(false);
  }
});

// ---------- form submit ----------
// The only thing that ever asks for a report: every report is an AI call.
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const from = fromInput.value;
  const to = toInput.value;

  if (!isIsoDate(from) || !isIsoDate(to)) {
    showError('Pick both dates: a From Date and a To Date.');
    return;
  }
  if (from > to) {
    showError('The From Date must be on or before the To Date.');
    return;
  }
  const days = daysCovered(from, to);
  if (days > MAX_RANGE_DAYS) {
    showError(`A report can cover at most ${MAX_RANGE_DAYS} days; these dates cover ${days}.`);
    return;
  }

  // narrative is always "true": the report text is always written by AI (the
  // API falls back to template text only if that fails, and then says so in
  // `flags`).
  const params = new URLSearchParams({ from_date: from, to_date: to, narrative: 'true' });

  reportError.hidden = true;
  setLoading(true);
  try {
    // Relative on purpose, so the app also works when it is served from a
    // folder path such as /front-boom-assistant/ — see README "Two addresses".
    const res = await fetch(`api/report/range?${params}`, {
      headers: { accept: 'application/json' },
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Server returned non-JSON: ' + text.slice(0, 200));
    }
    if (!res.ok) {
      const err = new Error(extractErrorMessage(data, res.status));
      // A range with no fact-checks: {detail: {code: "no_data_in_range",
      // message, data_from, data_to}}.
      err.detail = data && data.detail;
      throw err;
    }
    renderReport(data);
    showToast('Report ready');
  } catch (err) {
    console.error(err);
    const detail = err.detail && typeof err.detail === 'object' ? err.detail : null;
    if (detail && detail.data_from && !dataSpan) {
      dataSpan = { data_from: detail.data_from, data_to: detail.data_to };
    }
    showError(
      err.message || 'Request failed',
      detail &&
        detail.data_from &&
        el(
          'p',
          'rp-error-hint',
          `The database has fact-checks from ${longDate(detail.data_from)} to ${longDate(detail.data_to)}. `
        ),
      detail && detail.code === 'no_data_in_range' && latestMonthButton()
    );
    showToast(err.message || 'Request failed', true);
  } finally {
    setLoading(false);
  }
});

form.addEventListener('reset', () => {
  reportError.hidden = true;
  // The reset event fires before the fields go back to their defaults.
  setTimeout(() => {
    linkDateLimits();
    updateDatesNote();
  });
});

// ---------- start ----------
// Defaults: To = today, From = one month earlier. Set as the fields' default
// values, so Reset goes back to them too.
const today = todayIso();
toInput.defaultValue = today;
fromInput.defaultValue = oneMonthBefore(today);

// report.html?from=…&to=… (the link back from a topic page) fills in those
// dates instead — but, like everything else, does not start the report.
const startParams = new URLSearchParams(location.search);
const startFrom = startParams.get('from');
const startTo = startParams.get('to');
if (isIsoDate(startFrom) && isIsoDate(startTo) && startFrom <= startTo) {
  fromInput.value = startFrom;
  toInput.value = startTo;
}
linkDateLimits();
loadDataSpan();
// The ↑ button that appears once the long report is scrolled down.
addBackToTop();
