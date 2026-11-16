// report.js — Monthly Report page. The editor picks a month first: months
// saved in the research database are reported on straight away, and any other
// month needs the fact-check sheet uploaded. The reply from api/report is drawn
// in the layout of BOOM's monthly report PDF, with a sidebar of the month's
// topics that each open topic.html in a new tab.
//
// report-common.js is loaded first and supplies el(), the chart pieces and the
// sidebar — this file holds only what belongs to this page.

const form = document.getElementById('report-form');
const monthSelect = document.getElementById('month-select');
const otherMonthRow = document.getElementById('other-month-row');
const otherMonth = document.getElementById('other-month');
const monthStatus = document.getElementById('month-status');
const sheetField = document.getElementById('sheet-field');
const sheetStatus = document.getElementById('sheet-status');
const reportBtn = document.getElementById('report-btn');
const reportError = document.getElementById('report-error');
const reportTools = document.getElementById('report-tools');
const monthSwitch = document.getElementById('month-switch');
const reportLayout = document.getElementById('report-layout');
const topicNav = document.getElementById('topic-nav');
const report = document.getElementById('report');
const copyJsonBtn = document.getElementById('copy-json');

// Latest reply, kept so Copy JSON can export it.
let currentReport = null;

// Months saved in the database, "2026-01" → {month, label, fact_checks}.
// Filled by loadMonths(); empty when the list could not be loaded.
let savedMonths = new Map();

// Value of the dropdown's "Another month" option. Not a YYYY-MM, so it can
// never be mistaken for a real month.
const OTHER = 'other';

// ---------- utilities ----------
function setLoading(loading) {
  reportBtn.disabled = loading;
  reportBtn.classList.toggle('loading', loading);
  reportBtn.querySelector('.btn-label').textContent = loading
    ? 'Generating…'
    : 'Generate Report';
}

// ---------- month dropdown ----------

function setNote(node, text, isError = false) {
  node.replaceChildren(...[].concat(text).filter(Boolean));
  node.classList.toggle('is-error', isError);
}

// Asks the server which months the database has and rebuilds the dropdown:
// those months newest first, then "Another month". `keep` is the month to
// leave selected afterwards (after an upload, the month just reported on).
async function loadMonths(keep) {
  monthSelect.disabled = true;
  monthSelect.replaceChildren(el('option', null, 'Loading months…'));
  monthSelect.options[0].value = '';
  setNote(monthStatus, '');

  let months = [];
  let failure = '';
  try {
    // Relative on purpose — see README "Two addresses".
    const res = await fetch('api/report/months', {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Server returned non-JSON: ' + text.slice(0, 200));
    }
    if (!res.ok) throw new Error(extractErrorMessage(data, res.status));
    months = Array.isArray(data) ? data : data.months || [];
  } catch (err) {
    console.error('Could not load the saved months:', err);
    failure = err.message || 'Request failed';
  }

  savedMonths = new Map(
    months.filter((m) => m && /^\d{4}-\d{2}$/.test(m.month)).map((m) => [m.month, m])
  );

  const other = el('option', null, 'Another month (upload the sheet)…');
  other.value = OTHER;

  if (savedMonths.size) {
    const placeholder = el('option', null, 'Choose a month…');
    placeholder.value = '';
    placeholder.defaultSelected = true;
    const group = el('optgroup');
    group.label = 'In the database';
    [...savedMonths.values()]
      .sort((a, b) => b.month.localeCompare(a.month))
      .forEach((m) => {
        const opt = el(
          'option',
          null,
          `${m.label || monthLabel(m.month)} · ${m.fact_checks ?? '?'} fact-checks`
        );
        opt.value = m.month;
        group.append(opt);
      });
    const otherGroup = el('optgroup', null, other);
    otherGroup.label = 'Not in the database';
    monthSelect.replaceChildren(placeholder, group, otherGroup);
  } else {
    // Nothing to pick from, so "Another month" is the only choice — and the
    // one Reset goes back to.
    other.defaultSelected = true;
    monthSelect.replaceChildren(other);
  }
  monthSelect.disabled = false;

  if (failure) {
    const retry = el('button', 'rp-link-btn', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', () => loadMonths(keep));
    setNote(
      monthStatus,
      [`Could not load the months from the database (${failure}). You can still upload a sheet. `, retry],
      true
    );
  } else if (!savedMonths.size) {
    setNote(monthStatus, 'The database has no months yet. Upload a sheet to add some.');
  }

  if (keep) chooseMonth(keep);
  else syncMonthUi();
}

// Picks `month` in the form: from the dropdown when the database has it,
// otherwise as "Another month" with the month filled in.
function chooseMonth(month) {
  if (savedMonths.has(month)) {
    monthSelect.value = month;
  } else {
    monthSelect.value = OTHER;
    otherMonth.value = month;
  }
  syncMonthUi();
}

// The month the form will report on, and whether the database has it.
function selectedMonth() {
  const choice = monthSelect.value;
  if (savedMonths.has(choice)) return { month: choice, fromDb: true };
  if (choice === OTHER) return { month: otherMonth.value.trim(), fromDb: false };
  return { month: '', fromDb: false };
}

// Shows the month box for "Another month", and switches the sheet upload on
// only when it is needed: a month the database does not have.
function syncMonthUi() {
  const choice = monthSelect.value;
  const isOther = choice === OTHER;
  otherMonthRow.hidden = !isOther;
  sheetField.disabled = !isOther;

  const saved = savedMonths.get(choice);
  if (saved) {
    const label = saved.label || monthLabel(saved.month);
    setNote(sheetStatus, `Not needed: ${label} is already in the database.`);
  } else if (isOther) {
    setNote(
      sheetStatus,
      'Needed: choose the sheet that has this month. It is saved to the database, so next time you can pick the month from the list.'
    );
  } else {
    setNote(sheetStatus, 'Choose a month first.');
  }
}

// An old error is about the month that was picked before, so it goes.
monthSelect.addEventListener('change', () => {
  reportError.hidden = true;
  syncMonthUi();
  if (monthSelect.value === OTHER) otherMonth.focus();
});

// Typed a month the database already has? Pick it from the list instead, so no
// upload is asked for.
otherMonth.addEventListener('change', () => {
  reportError.hidden = true;
  const month = otherMonth.value;
  if (!savedMonths.has(month)) return;
  chooseMonth(month);
  showToast(`${monthLabel(month)} is already in the database — no upload needed`);
});

// ---------- month buttons ----------
// One button per month the report covers. Clicking one re-runs the report for
// that month: from the database when it has the month, otherwise with the
// file that is still selected in the form.
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
      chooseMonth(m.month);
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
      el('p', 'rp-error-hint', 'Months that have data:'),
      monthButtons(months, '')
    );
  }
  reportError.hidden = false;
}

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

// ---------- month report sections ----------

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
    masthead(),
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

  // There is no print button, but if someone prints anyway (Ctrl+P), the page
  // title becomes the file name and Chrome prints this footer on every page.
  document.title = `BOOM Monthly Report ${label}`;
  setPrintFooter(`BOOM Monthly Report · ${label} · Draft`);

  // Every topic of the month, each opening its own report in a new tab.
  showTopicSidebar(topicNav, reportLayout, data, { newTab: true });

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

  const { month, fromDb } = selectedMonth();
  const file = form.elements.file.files[0];

  if (!month) {
    showError(
      monthSelect.value === OTHER
        ? 'Pick the month to report on in the "Which month?" box.'
        : 'Choose a month first.'
    );
    return;
  }
  if (!/^\d{4}-\d{2}$/.test(month)) {
    showError('Pick the month to report on (YYYY-MM, for example 2026-01).');
    return;
  }
  if (!fromDb && !file) {
    showError(`${monthLabel(month)} is not in the database yet, so choose the Excel sheet that has it.`);
    return;
  }

  // Built by hand rather than sending the form as it is: an unticked checkbox
  // would be missing entirely, and the API wants "true" or "false". The file
  // goes only for a month the database lacks — without one, the API builds the
  // report from the database.
  const body = new FormData();
  if (!fromDb) body.append('file', file);
  body.append('month', month);
  body.append('narrative', form.elements.narrative.checked ? 'true' : 'false');

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
    // The API saves an uploaded sheet to the database, so its months belong
    // in the dropdown now; the month just reported on stays picked.
    if (!fromDb) loadMonths((data.meta && data.meta.month) || month);
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
  // The reset event fires before the fields are cleared, so wait a tick.
  setTimeout(syncMonthUi);
});

// report.html?month=2026-01 (the link back from a topic page) opens that
// month's report straight away, when the database has it. Otherwise the form
// simply waits, as usual.
const startMonth = new URLSearchParams(location.search).get('month');
loadMonths().then(() => {
  if (startMonth && savedMonths.has(startMonth)) {
    chooseMonth(startMonth);
    form.requestSubmit();
  }
});

copyJsonBtn.addEventListener('click', () => {
  if (!currentReport) return;
  navigator.clipboard.writeText(JSON.stringify(currentReport, null, 2)).then(
    () => showToast('Report copied as JSON'),
    () => showToast('Copy failed', true)
  );
});
