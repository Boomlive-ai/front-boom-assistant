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

// The backend refuses a longer range, so the page checks first.
const MAX_RANGE_DAYS = 366;

// What the database covers, from api/report/dates:
// {data_from, data_to, fact_checks, default_from, default_to}. null until it
// has loaded, or when it could not be loaded.
let dataSpan = null;

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
      [`No fact-checks in these dates: the database has ${span}. `, latestMonthButton()],
      true
    );
  } else {
    setNote(datesNote, `Data in the database: ${span} (${dataSpan.fact_checks} fact-checks).`);
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

  report.hidden = false;
  reportLayout.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

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
