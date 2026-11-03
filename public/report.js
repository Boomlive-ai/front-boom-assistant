// report.js — Monthly Report page. Uploads the fact-check sheet to api/report
// and draws the reply in the layout of BOOM's monthly report PDF.

const form = document.getElementById('report-form');
const reportBtn = document.getElementById('report-btn');
const reportError = document.getElementById('report-error');
const reportTools = document.getElementById('report-tools');
const monthSwitch = document.getElementById('month-switch');
const report = document.getElementById('report');
const copyJsonBtn = document.getElementById('copy-json');
const printBtn = document.getElementById('print-btn');
const printFooter = document.getElementById('print-footer');
const toast = document.getElementById('toast');

// Latest reply, kept so Copy JSON can export it.
let currentReport = null;

// ---------- utilities ----------
function showToast(msg, isError = false) {
  toast.textContent = msg;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2400);
}

function setLoading(loading) {
  reportBtn.disabled = loading;
  reportBtn.classList.toggle('loading', loading);
  reportBtn.querySelector('.btn-label').textContent = loading
    ? 'Generating…'
    : 'Generate Report';
}

// Builds one element. Strings are added as text, never as HTML, so nothing
// from the sheet or the API can inject markup — the same rule as script.js.
// null / false children are skipped, so `cond && el(…)` can be passed in.
function el(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    if (child == null || child === false) continue;
    node.append(child);
  }
  return node;
}

// Only http(s) addresses become links, so a `javascript:` URL in the sheet
// can never turn into something clickable.
function link(url, text) {
  const href = String(url || '').trim();
  if (!/^https?:\/\//i.test(href)) return el('span', null, text);
  const a = el('a', 'rp-link', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function chip(text, kind) {
  return el('span', 'rp-chip' + (kind ? ' ' + kind : ''), text);
}

const pct = (n) => `${Number(n || 0).toFixed(1)}%`;

// "2026-01-02" → "02 Jan". Built in UTC so the day never shifts by time zone.
function shortDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return String(iso || '');
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

// "January 2026" → "January".
const monthName = (label) => String(label || '').split(' ')[0];

// ["a", "b", "c"] → "a, b and c".
function joinAnd(list) {
  const items = list.filter(Boolean);
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// +36 / −50, with a real minus sign.
function signed(n) {
  const v = Math.round(Number(n) || 0);
  if (v > 0) return `+${v}`;
  if (v < 0) return `−${Math.abs(v)}`;
  return '0';
}

// Every label sharing the top count, so ties are named together ("Iran unrest
// and UGC controversy"). Capped at three to keep the title short.
function leaders(items, key = 'count') {
  if (!items.length) return [];
  const top = items[0][key];
  return items.filter((i) => i[key] === top).slice(0, 3);
}

// Turn any API error shape into a readable string: FastAPI's validation array
// {detail: [{loc, msg}]}, the report route's {detail: {message}}, or a plain
// {detail | error | message: "…"}.
function extractErrorMessage(data, status) {
  if (!data) return `HTTP ${status}`;
  const raw = data.detail ?? data.error ?? data.message;
  if (raw == null) return `HTTP ${status}`;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((e) => {
        if (e && typeof e === 'object') {
          const loc = Array.isArray(e.loc)
            ? e.loc.filter((x) => x !== 'body').join('.')
            : e.loc || '';
          const msg = e.msg || e.message || JSON.stringify(e);
          return loc ? `${loc}: ${msg}` : msg;
        }
        return String(e);
      })
      .join(' · ');
  }
  if (typeof raw === 'object') return raw.message || JSON.stringify(raw);
  return String(raw);
}

// ---------- month buttons ----------
// One button per month the sheet covers. Clicking one re-runs the report for
// that month with the file that is still selected in the form.
function monthButtons(months, current) {
  const row = el('div', 'rp-month-row');
  months.forEach((m) => {
    const btn = el('button', 'btn ghost small', m.short_label || m.label || m.month);
    btn.type = 'button';
    btn.title = `${m.label}: ${m.fact_checks} fact-checks`;
    if (m.month === current) {
      btn.disabled = true;
      btn.classList.add('is-current');
    }
    btn.addEventListener('click', () => {
      form.elements.month.value = m.month;
      form.requestSubmit();
    });
    row.append(btn);
  });
  return row;
}

function showError(message, months) {
  reportError.replaceChildren(el('p', null, message));
  if (Array.isArray(months) && months.length) {
    reportError.append(
      el('p', 'rp-error-hint', 'Months in this sheet:'),
      monthButtons(months, '')
    );
  }
  reportError.hidden = false;
}

// ---------- chart pieces ----------

// The four series colours, in a fixed order (never cycled), are classes
// rp-c0 … rp-c3 in report.css. Anything past the fourth folds into "Other".
function foldOther(items) {
  if (items.length <= 4) return items;
  const rest = items.slice(3);
  return [
    ...items.slice(0, 3),
    {
      label: 'Other',
      count: rest.reduce((sum, i) => sum + (i.count || 0), 0),
      percent: rest.reduce((sum, i) => sum + (i.percent || 0), 0),
      other: true,
    },
  ];
}

function chartCard(title, subtitle, ...body) {
  return el(
    'figure',
    'rp-chart',
    el('h3', null, title),
    subtitle && el('p', 'rp-sub', subtitle),
    ...body
  );
}

const note = (text) => (text ? el('p', 'rp-note', text) : null);

// Horizontal bars, longest first, with the number at the end of each bar.
function barList(items) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const list = el('div', 'rp-bars');
  items.forEach(({ label, value }) => {
    const bar = el('span', 'rp-bar');
    // 36px is left free at the end of the track for the number.
    bar.style.width = `calc((100% - 36px) * ${(value / max).toFixed(4)})`;
    const row = el(
      'div',
      'rp-bar-row',
      el('span', 'rp-bar-label', label),
      el('span', 'rp-bar-track', bar, el('span', 'rp-bar-value', String(value)))
    );
    row.title = `${label}: ${value}`;
    list.append(row);
  });
  return list;
}

// One 100% bar split by share, with a legend that names every part, so the
// colour is never the only way to tell them apart.
function stackedBar(items) {
  const parts = foldOther(items.filter((i) => i.count > 0));
  const bar = el('div', 'rp-stack');
  const legend = el('div', 'rp-legend');
  parts.forEach((p, i) => {
    const cls = p.other ? 'rp-cother' : `rp-c${i}`;
    const seg = el('span', `rp-seg ${cls}`);
    seg.style.flexGrow = p.count;
    seg.title = `${p.label}: ${pct(p.percent)} (${p.count})`;
    bar.append(seg);
    legend.append(
      el(
        'span',
        'rp-legend-item',
        el('i', `rp-swatch ${cls}`),
        `${p.label} `,
        el('b', null, pct(p.percent)),
        ` (${p.count})`
      )
    );
  });
  return el('div', 'rp-stack-wrap', bar, legend);
}

// A labelled stacked bar, for charts that hold several of them.
const stackedGroup = (title, items) =>
  items && items.length
    ? el('div', 'rp-stack-group', el('h4', null, title), stackedBar(items))
    : null;

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

// Each dot is one fact-check, placed on the day it was published and stacked
// upwards when a story had several that day. One row per theme.
function dotTimeline(themes, days) {
  const span = Math.max(1, days - 1);
  const at = (day) => `${((day - 1) / span) * 100}%`;
  const wrap = el('div', 'rp-timeline');

  themes.forEach((theme) => {
    const byDay = new Map();
    (theme.fact_checks || []).forEach((fc) => {
      const day = Number(String(fc.date).slice(8, 10));
      if (!day) return;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(fc);
    });
    const tallest = Math.max(1, ...[...byDay.values()].map((l) => l.length));

    const track = el('div', 'rp-track');
    track.style.height = `${tallest * 10 + 10}px`;
    byDay.forEach((list, day) => {
      list.forEach((fc, i) => {
        const dot = el('span', 'rp-dot');
        dot.style.left = at(day);
        dot.style.bottom = `${5 + i * 10}px`;
        dot.title = `${shortDate(fc.date)} · ${fc.language} · ${fc.headline}`;
        track.append(dot);
      });
    });

    wrap.append(
      el(
        'div',
        'rp-tl-row',
        el(
          'div',
          'rp-tl-label',
          el('span', null, theme.topic),
          el('small', null, `${theme.count} fact-checks`)
        ),
        track
      )
    );
  });

  // Day ticks a week apart, like the PDF: 1, 8, 15, 22, 29.
  const axis = el('div', 'rp-track rp-axis');
  for (let day = 1; day <= days; day += 7) {
    const tick = el('span', 'rp-tick', String(day));
    tick.style.left = at(day);
    axis.append(tick);
  }
  wrap.append(el('div', 'rp-tl-row rp-tl-axis', el('div', 'rp-tl-label'), axis));
  return wrap;
}

function table(headers, rows) {
  const head = el('tr', null, ...headers.map((h) => el('th', null, h)));
  const body = el('tbody');
  rows.forEach((cells) => body.append(el('tr', null, ...cells.map((c) => el('td', null, c)))));
  return el('div', 'rp-table-wrap', el('table', 'rp-table', el('thead', null, head), body));
}

// AI / Media / Old chips for one fact-check.
function flagChips(fc) {
  const wrap = el('span', 'rp-flags');
  if (fc.ai) wrap.append(chip('AI', 'ai'));
  if (fc.media_misreporting) wrap.append(chip('Media'));
  if (fc.old_content) wrap.append(chip('Old'));
  return wrap;
}

// ---------- report sections ----------

const section = (title, ...children) =>
  el('section', 'rp-section', el('h2', null, title), ...children);

const paragraphs = (list) =>
  (Array.isArray(list) ? list : [list]).filter(Boolean).map((p) => el('p', null, p));

function statCard(label, value, sub) {
  return el(
    'div',
    'rp-stat',
    el('span', 'rp-stat-label', label),
    el('strong', 'rp-stat-value', String(value ?? '–')),
    sub && el('span', 'rp-stat-sub', sub)
  );
}

function statCards(s) {
  // Compared with the month before when the sheet has it; January has none,
  // so it shows the busiest day instead.
  const prev = s.previous_month;
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

function monthlyChart(monthly, label) {
  // A month still being filled in would look like a slump, so it is left out —
  // the PDF draft did the same with September.
  const months = (monthly || []).filter((m) => !m.partial);
  const partial = (monthly || []).filter((m) => m.partial);
  if (!months.length) return null;

  const max = Math.max(1, ...months.map((m) => m.fact_checks || 0));
  const selected = months.find((m) => m.selected);
  const busiest = selected && months.every((m) => (m.fact_checks || 0) <= selected.fact_checks);

  const first = months[0].label || '';
  const last = months[months.length - 1].label || '';
  const sameYear = first.split(' ')[1] === last.split(' ')[1];
  const range = months.length > 1 ? `${sameYear ? monthName(first) : first}–${last}` : first;

  return chartCard(
    busiest
      ? `${monthName(label)} was the busiest month in this sheet`
      : 'Fact-checks per month',
    `Fact-checks published per month, and how many of them involved AI, ${range}`,
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
    `${top.label} made up ${pct(top.percent)} of ${monthName(label)}'s fact-checks`,
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

function timelineChart(themes, daily, label) {
  if (!Array.isArray(themes) || !themes.length) return null;
  const days = (daily && daily.length) || 31;
  return chartCard(
    'When the biggest stories broke',
    'Each dot is one fact-check, placed on the day it was published. Hover a dot for its headline.',
    dotTimeline(themes, days),
    el('p', 'rp-axis-title', `Day of ${label}`)
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
      `Share of ${label} fact-checks by medium, intent and type of deception (n = ${total})`,
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

function appendix(factChecks, label) {
  if (!Array.isArray(factChecks) || !factChecks.length) return null;
  return section(
    `Appendix: all ${monthName(label)} fact-checks`,
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

function footnote(meta, narrativeSource, label) {
  const made = meta.generated_at
    ? new Date(meta.generated_at).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '';
  const details = [
    meta.source_file && `Source file: ${meta.source_file}`,
    made && `Generated ${made}`,
    narrativeSource && `Text: ${narrativeSource === 'template' ? 'template' : narrativeSource}`,
  ].filter(Boolean);
  return el(
    'footer',
    'rp-foot',
    el(
      'p',
      null,
      `Draft prepared from BOOM's coded fact-check data for ${label}. Figures should be checked against the newsroom database before publication.`
    ),
    details.length ? el('p', 'rp-foot-meta', details.join(' · ')) : null
  );
}

// ---------- render the whole report ----------
function renderReport(data) {
  currentReport = data;
  const meta = data.meta || {};
  const n = data.narrative || {};
  const s = data.summary || {};
  const label = meta.label || meta.month || '';

  // "Period: 1–31 January 2026 · Based on … (Hindi, Bangla and English)"
  const daily = data.daily || [];
  const languages = (data.language || []).map((l) => l.label);
  const period = [
    daily.length && `Period: ${daily[0].day}–${daily[daily.length - 1].day} ${label}`,
    `Based on BOOM's coded fact-check database${languages.length ? ` (${joinAnd(languages)})` : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');

  report.replaceChildren(
    el(
      'div',
      'rp-masthead',
      el('span', 'rp-brand', el('b', null, 'BOOM'), ' RESEARCH'),
      el('span', 'rp-draft', 'Draft for editorial review')
    ),
    el('p', 'rp-kicker', `Monthly misinformation report · ${label}`),
    el('h1', 'rp-headline', n.headline || `BOOM Monthly Report: ${label}`),
    n.standfirst && el('p', 'rp-standfirst', n.standfirst),
    el('p', 'rp-period', period),
    statCards(s),
    highlightsBox(n.key_highlights),
    section(
      'Overview',
      ...paragraphs(n.overview),
      monthlyChart(data.monthly, label),
      languageChart(data.language, s.fact_checks, label)
    ),
    section(
      'What was fact-checked',
      topicsChart(data.topics, label),
      timelineChart(data.themes, daily, label)
    ),
    data.targets && data.targets.length
      ? section('Who was targeted', targetsChart(data.targets, label))
      : null,
    aiSection(data.ai, n.ai_paragraph, label),
    mediaSection(data.media_misreporting, n.media_paragraph),
    themesSection(data.themes),
    breakdownsSection(data.breakdowns, s.fact_checks, label),
    notesBox(data.data_notes, data.flags),
    appendix(data.fact_checks, label),
    footnote(meta, data.narrative_source, label)
  );

  // The page title becomes the file name in "Save as PDF", and Chrome prints
  // the footer below in the margin of every page, like the PDF draft. Quotes
  // and backslashes are dropped so the label cannot break out of the CSS string.
  document.title = `BOOM Monthly Report ${label}`;
  const safeLabel = label.replace(/["\\\n]/g, '');
  printFooter.textContent = `@page { @bottom-left { content: "BOOM Monthly Report · ${safeLabel} · Draft"; } }`;

  monthSwitch.replaceChildren(
    el('span', 'rp-month-switch-label', 'Other months:'),
    monthButtons(data.monthly || [], meta.month)
  );
  reportTools.hidden = false;
  report.hidden = false;
  reportTools.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- form submit ----------
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const fd = new FormData(form);
  const file = fd.get('file');
  const month = String(fd.get('month') || '').trim();

  if (!file || !file.name) {
    showError('Choose the Excel sheet first.');
    return;
  }
  if (!/^\d{4}-\d{2}$/.test(month)) {
    showError('Pick the month to report on (YYYY-MM, for example 2026-01).');
    return;
  }

  // Built by hand rather than sending the form as it is: an unticked checkbox
  // would be missing entirely, and the API wants "true" or "false".
  const body = new FormData();
  body.append('file', file);
  body.append('month', month);
  body.append('narrative', fd.get('narrative') ? 'true' : 'false');

  reportError.hidden = true;
  setLoading(true);
  try {
    // Relative on purpose, so the app also works when it is served from a
    // folder path such as /front-boom-assistant/ — see README "Two addresses".
    // No Content-Type header: the browser adds it, with the multipart boundary.
    const res = await fetch('api/report', {
      method: 'POST',
      headers: { accept: 'application/json' },
      body,
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
      // The API lists the months it does have when the one asked for is empty.
      err.months = data && data.detail && data.detail.available_months;
      throw err;
    }
    renderReport(data);
    showToast('Report ready');
  } catch (err) {
    console.error(err);
    showError(err.message || 'Request failed', err.months);
    showToast(err.message || 'Request failed', true);
  } finally {
    setLoading(false);
  }
});

form.addEventListener('reset', () => {
  reportError.hidden = true;
});

copyJsonBtn.addEventListener('click', () => {
  if (!currentReport) return;
  navigator.clipboard.writeText(JSON.stringify(currentReport, null, 2)).then(
    () => showToast('Report copied as JSON'),
    () => showToast('Copy failed', true)
  );
});

printBtn.addEventListener('click', () => window.print());
