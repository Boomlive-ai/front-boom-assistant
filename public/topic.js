// topic.js — one topic's report for one month, opened from the topics sidebar
// as topic.html?month=2026-01&topic=Iran%20unrest.
//
// There is no separate "topic" API: the page asks api/report for the whole
// month (from the database, without AI text, so it is quick and free) and
// keeps only the fact-checks coded under this topic. Every figure below is
// counted from those fact-checks, in the browser.
//
// report-common.js is loaded first and supplies el(), the chart pieces and the
// sidebar.

const statusBox = document.getElementById('topic-status');
const layout = document.getElementById('topic-layout');
const topicNav = document.getElementById('topic-nav');
const tools = document.getElementById('topic-tools');
const monthLink = document.getElementById('month-link');
const report = document.getElementById('report');
const printBtn = document.getElementById('print-btn');

const params = new URLSearchParams(location.search);
const month = (params.get('month') || '').trim();
const topic = (params.get('topic') || '').trim();

// ---------- small helpers ----------

// The grey box above the report: a loading line, or what went wrong. `extra`
// is more nodes to add under the message, such as a link.
function showStatus(message, isError = false, ...extra) {
  statusBox.replaceChildren(el('p', null, message), ...extra);
  statusBox.classList.toggle('is-error', isError);
  statusBox.hidden = false;
}

// How many fact-checks have each value of one field, biggest first, in the
// shape the bar charts take: [{label, count, percent}]. `pick` may return a
// list (targets) — each item is counted once. Blank values are left out.
function countBy(factChecks, pick) {
  const counts = new Map();
  factChecks.forEach((fc) => {
    [].concat(pick(fc) ?? []).forEach((value) => {
      const key = String(value ?? '').trim();
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
  });
  return [...counts]
    .map(([label, count]) => ({ label, count, percent: (count / factChecks.length) * 100 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// "2026-02" → 28.
function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// "1 fact-check" / "12 fact-checks".
const factChecksWord = (n) => `${n} fact-check${n === 1 ? '' : 's'}`;

// ---------- the topic report ----------

function topicStatCards(n, total, label, counts) {
  const ofThem = (k) => `${pct((k / n) * 100)} of them`;
  return el(
    'div',
    'rp-stats',
    statCard(
      'Fact-checks published',
      n,
      `${pct((n / total) * 100)} of ${monthName(label)}'s ${total}`
    ),
    statCard('Involved AI', counts.ai, ofThem(counts.ai)),
    statCard('Recycled old content', counts.old, ofThem(counts.old)),
    statCard('Media misreporting', counts.media, ofThem(counts.media))
  );
}

// The theme assessment's text when the month report has one for this topic
// (only the biggest topics get one); otherwise a sentence built the same way.
function topicSummary(theme, n, counts) {
  if (theme && theme.summary) return theme.summary;
  if (n === 1) {
    const what = [
      counts.old && 'relied on old footage',
      counts.falseContext && 'placed genuine visuals in a false context',
      counts.ai && 'involved AI',
    ].filter(Boolean);
    return what.length ? `This fact-check ${joinAnd(what)}.` : '';
  }
  const parts = [
    counts.old && `${counts.old} relied on old footage`,
    counts.falseContext && `${counts.falseContext} placed genuine visuals in a false context`,
    counts.ai && `${counts.ai} involved AI`,
  ].filter(Boolean);
  if (!parts.length) return '';
  return `Of the ${factChecksWord(n)}, ${joinAnd(parts)}.`;
}

function renderTopic(data) {
  const meta = data.meta || {};
  const label = meta.label || monthLabel(month);
  const all = data.fact_checks || [];
  const total = (data.summary && data.summary.fact_checks) || all.length;

  // The same topics list as on the month page, with this topic marked.
  showTopicSidebar(topicNav, layout, data, { current: topic });
  monthLink.href = 'report.html?' + new URLSearchParams({ month }).toString();
  monthLink.textContent = `← ${label} report`;
  tools.hidden = false;

  const fcs = all
    .filter((fc) => fc.topic === topic)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (!fcs.length) {
    report.hidden = true;
    showStatus(`No fact-checks are coded under “${topic}” in ${label}. Pick a topic from the list.`, true);
    return;
  }
  statusBox.hidden = true;

  const n = fcs.length;
  const count = (key) => fcs.filter((fc) => fc[key]).length;
  const counts = {
    ai: count('ai'),
    old: count('old_content'),
    media: count('media_misreporting'),
    falseContext: count('false_context'),
  };
  const first = fcs[0].date;
  const last = fcs[n - 1].date;
  const when = first === last ? `on ${shortDate(first)}` : `between ${shortDate(first)} and ${shortDate(last)}`;
  const theme = (data.themes || []).find((t) => t.topic === topic);

  const languages = countBy(fcs, (fc) => fc.language);
  const targets = countBy(fcs, (fc) => fc.targets).slice(0, 10);
  const claimedBy = countBy(fcs, (fc) => fc.claimed_by).slice(0, 8);

  report.replaceChildren(
    masthead(),
    el('p', 'rp-kicker', `Topic report · ${label}`),
    el('h1', 'rp-headline', topic),
    el(
      'p',
      'rp-standfirst',
      `BOOM published ${factChecksWord(n)} on ${topic} in ${label} — ${pct((n / total) * 100)} of the month's ${total} — ${when}.`
    ),
    el(
      'p',
      'rp-period',
      `Based on BOOM's coded fact-check database${languages.length ? ` (${joinAnd(languages.map((l) => l.label))})` : ''}`
    ),
    topicStatCards(n, total, label, counts),
    section(
      'Overview',
      ...paragraphs(topicSummary(theme, n, counts)),
      chartCard(
        'When the fact-checks were published',
        'Each dot is one fact-check, placed on the day it was published. Hover a dot for its headline.',
        dotTimeline([{ topic, count: n, fact_checks: fcs }], daysInMonth(month)),
        el('p', 'rp-axis-title', `Day of ${label}`)
      )
    ),
    // With one fact-check every bar would be 100%, so the breakdowns wait for two.
    n > 1 &&
      section(
        'How the claims were made',
        chartCard(
          'Language, medium, type of deception and intent',
          `Share of the ${factChecksWord(n)} on ${topic}, ${label}`,
          stackedGroup('Language', languages),
          stackedGroup('Medium', countBy(fcs, (fc) => fc.medium)),
          stackedGroup('Type of deception', countBy(fcs, (fc) => fc.type)),
          stackedGroup('Intent', countBy(fcs, (fc) => fc.intent))
        )
      ),
    // `> 0`, not just `.length`: el() skips false, but would print a 0.
    (targets.length > 0 || claimedBy.length > 0) &&
      section(
        'Who was involved',
        targets.length > 0 &&
          chartCard(
            (() => {
              const top = leaders(targets).map((t) => t.label);
              return `${joinAnd(top)} ${top.length > 1 ? 'were' : 'was'} targeted most often`;
            })(),
            `Fact-checks naming each entity as a target. The top ${targets.length}.`,
            barList(targets.map((t) => ({ label: t.label, value: t.count })))
          ),
        claimedBy.length > 0 &&
          chartCard(
            'Who spread the claims',
            `Fact-checks by who made the claim. The top ${claimedBy.length}.`,
            barList(claimedBy.map((c) => ({ label: c.label, value: c.count })))
          )
      ),
    section(
      `All ${factChecksWord(n)}`,
      el('p', null, 'Every fact-check on this topic, oldest first. Headlines link to the published fact-checks.'),
      table(
        ['Date', 'Lang', 'Fact-check', 'Flags'],
        fcs.map((fc) => [
          shortDate(fc.date),
          fc.language,
          el(
            'div',
            null,
            link(fc.url, fc.headline),
            fc.claim && el('p', 'rp-claim', `Claim: ${fc.claim}`)
          ),
          flagChips(fc),
        ])
      )
    ),
    footnote(meta, null, label)
  );
  report.hidden = false;

  // The page title becomes the file name in "Save as PDF".
  document.title = `BOOM Topic Report ${topic} ${label}`;
  setPrintFooter(`BOOM Topic Report · ${topic} · ${label} · Draft`);
}

// ---------- load ----------

async function loadTopic() {
  const back = el('a', 'rp-link', 'Go to the Monthly Report page');
  back.href = 'report.html';

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !topic) {
    showStatus(
      'This link is missing the month or the topic. Open a topic from the sidebar of a monthly report.',
      true,
      el('p', null, back)
    );
    return;
  }

  document.title = `BOOM Topic Report ${topic} ${monthLabel(month)}`;
  showStatus(`Loading ${topic} · ${monthLabel(month)}…`);

  // Same request as the Monthly Report page, minus the file: the API builds
  // the month from the database. narrative=false keeps it quick and free.
  const body = new FormData();
  body.append('month', month);
  body.append('narrative', 'false');

  try {
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
    if (!res.ok) throw new Error(extractErrorMessage(data, res.status));
    renderTopic(data);
  } catch (err) {
    console.error(err);
    showStatus(
      `Could not load ${monthLabel(month)} from the database: ${err.message || 'Request failed'}`,
      true,
      el('p', null, back)
    );
  }
}

printBtn.addEventListener('click', () => window.print());

loadTopic();
