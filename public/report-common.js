// report-common.js — helpers shared by the Monthly Report page (report.js)
// and the topic page (topic.js). Loaded first by both pages, as a plain
// script, so everything here is a global the page script can call. Nothing in
// this file looks up page elements when it loads, so either page can use it.

// ---------- utilities ----------
function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2400);
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

// "2026-01" → "January 2026". Built in UTC, like shortDate().
function monthLabel(month) {
  const [y, m] = String(month || '').split('-').map(Number);
  if (!y || !m) return String(month || '');
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

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

// The strip at the top of every report: "BOOM RESEARCH … Draft for editorial review".
function masthead() {
  return el(
    'div',
    'rp-masthead',
    el('span', 'rp-brand', el('b', null, 'BOOM'), ' RESEARCH'),
    el('span', 'rp-draft', 'Draft for editorial review')
  );
}

// Chrome prints this in the bottom-left margin of every page (report.css adds
// the page numbers). Quotes, backslashes and line breaks are dropped so a
// label or topic name can never break out of the CSS string.
function setPrintFooter(text) {
  const safe = String(text || '').replace(/["\\\r\n]/g, '');
  document.getElementById('print-footer').textContent =
    `@page { @bottom-left { content: "${safe}"; } }`;
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

// ---------- topics sidebar ----------

// Address of one topic's report page, e.g.
// topic.html?month=2026-01&topic=Iran+unrest. Relative, like every internal
// link, so it works at both addresses (see README "Two addresses").
function topicHref(month, topic) {
  return 'topic.html?' + new URLSearchParams({ month, topic }).toString();
}

// The sidebar's contents: every topic of the month, most fact-checks first
// (the order the API sends), each a link to its own topic page, with a box to
// find one by name. "Uncoded" is a gap in the sheet, not a topic, so it is left
// out, as in the topics chart. `current` marks the topic being shown; `newTab`
// opens the links in a new tab, so the month report stays open behind them.
function topicSidebar(data, { current = '', newTab = false } = {}) {
  const meta = data.meta || {};
  const label = meta.label || monthLabel(meta.month);
  const topics = (data.topics || []).filter((t) => t.topic && t.topic !== 'Uncoded');

  const list = el('ul', 'rp-side-list');
  topics.forEach((t) => {
    const a = el(
      'a',
      'rp-side-link',
      el('span', 'rp-side-name', t.topic),
      el('span', 'rp-side-count', String(t.count))
    );
    a.href = topicHref(meta.month, t.topic);
    a.title = `${t.topic}: ${t.count} fact-check${t.count === 1 ? '' : 's'}`;
    if (newTab) {
      a.target = '_blank';
      a.rel = 'noopener';
    }
    if (t.topic === current) {
      a.classList.add('is-current');
      a.setAttribute('aria-current', 'page');
    }
    const item = el('li', null, a);
    item.dataset.name = t.topic.toLowerCase();
    list.append(item);
  });

  const empty = el('p', 'rp-side-empty', 'No topic matches.');
  empty.hidden = true;

  const search = el('input', 'rp-side-search');
  search.type = 'search';
  search.placeholder = 'Find a topic…';
  search.setAttribute('aria-label', 'Find a topic');
  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    let shown = 0;
    list.querySelectorAll('li').forEach((item) => {
      item.hidden = Boolean(query) && !item.dataset.name.includes(query);
      if (!item.hidden) shown += 1;
    });
    empty.hidden = shown > 0;
  });

  return [
    el('h2', 'rp-side-title', 'Topics'),
    el(
      'p',
      'rp-side-sub',
      `${label} · ${topics.length} topic${topics.length === 1 ? '' : 's'}. ` +
        (newTab ? 'Each one opens its own report in a new tab.' : 'Pick one to see its report.')
    ),
    search,
    list,
    empty,
  ];
}

// Fills the page's <aside id="topic-nav"> and switches `layout` to two
// columns. With no topics the sidebar stays hidden and the report keeps the
// full width.
function showTopicSidebar(aside, layout, data, options) {
  const parts = topicSidebar(data, options);
  const hasTopics = parts[3].children.length > 0;
  aside.replaceChildren(...parts);
  aside.hidden = !hasTopics;
  layout.classList.toggle('has-sidebar', hasTopics);
}
