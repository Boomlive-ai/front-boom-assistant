// topic.js — one topic's report for the same dates as the report it came
// from, opened from the topics sidebar as
// topic.html?from=2026-01-01&to=2026-01-31&topic=Iran%20unrest.
//
// There is no separate "topic" API: the page asks api/report/range for the
// whole range (from the database, without AI text, so it is quick and free)
// and keeps only the fact-checks coded under this topic. Every figure below is
// counted from those fact-checks, in the browser.
//
// report-common.js is loaded first and supplies el(), the chart pieces, the
// date helpers and the sidebar.

const statusBox = document.getElementById('topic-status');
const layout = document.getElementById('topic-layout');
const topicNav = document.getElementById('topic-nav');
const tools = document.getElementById('topic-tools');
const backLink = document.getElementById('month-link');
const report = document.getElementById('report');

const params = new URLSearchParams(location.search);
const fromDate = (params.get('from') || '').trim();
const toDate = (params.get('to') || '').trim();
const topic = (params.get('topic') || '').trim();
// "02 Jan 2026 – 31 Jan 2026", for messages shown before the reply arrives.
const datesText = `${longDate(fromDate)} – ${longDate(toDate)}`;

// ---------- small helpers ----------

// The grey box above the report: a loading line, or what went wrong. `extra`
// is more nodes to add under the message, such as a link.
function showStatus(message, isError = false, ...extra) {
  statusBox.replaceChildren(el('p', null, message), ...extra.filter(Boolean));
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

// "1 fact-check" / "12 fact-checks".
const factChecksWord = (n) => `${n} fact-check${n === 1 ? '' : 's'}`;

// ---------- the topic report ----------

function topicStatCards(n, total, counts) {
  const ofThem = (k) => `${pct((k / n) * 100)} of them`;
  return el(
    'div',
    'rp-stats',
    statCard('Fact-checks published', n, `${pct((n / total) * 100)} of all ${total} in these dates`),
    statCard('Involved AI', counts.ai, ofThem(counts.ai)),
    statCard('Recycled old content', counts.old, ofThem(counts.old)),
    statCard('Media misreporting', counts.media, ofThem(counts.media))
  );
}

// The theme assessment's text when the report has one for this topic
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
  // "January 2026" for a whole month, otherwise "15 February – 20 March 2026".
  const label = meta.label || datesText;
  const all = data.fact_checks || [];
  const total = (data.summary && data.summary.fact_checks) || all.length;
  // Every date of the range, in order: the x axis of the dot timeline.
  const daily = data.daily || [];
  const dates = daily.length ? daily.map((d) => d.date) : datesBetween(fromDate, toDate);

  // The same topics list as on the report page, with this topic marked.
  showTopicSidebar(topicNav, layout, data, { current: topic });
  // Back to the report page with these dates filled in (not started).
  backLink.href = 'report.html?' + new URLSearchParams({ from: fromDate, to: toDate }).toString();
  backLink.textContent = `← ${label} report`;
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
      `BOOM published ${factChecksWord(n)} on ${topic} ${meta.whole_month ? 'in' : 'during'} ${label} — ${pct((n / total) * 100)} of all ${total} in these dates — ${when}.`
    ),
    el(
      'p',
      'rp-period',
      `Based on BOOM's coded fact-check database${languages.length ? ` (${joinAnd(languages.map((l) => l.label))})` : ''}`
    ),
    topicStatCards(n, total, counts),
    section(
      'Overview',
      ...paragraphs(topicSummary(theme, n, counts)),
      chartCard(
        'When the fact-checks were published',
        'Each dot is one fact-check, placed on the day it was published. Hover a dot for its headline.',
        dotTimeline([{ topic, count: n, fact_checks: fcs }], dates),
        el('p', 'rp-axis-title', meta.whole_month ? `Day of ${label}` : `Date, ${label}`)
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

  // The page title is also the file name if someone prints the page (Ctrl+P).
  document.title = `BOOM Topic Report ${topic} ${label}`;
  setPrintFooter(`BOOM Topic Report · ${topic} · ${label} · Draft`);
}

// ---------- load ----------

async function loadTopic() {
  const back = el('a', 'rp-link', 'Go to the report page');
  back.href = 'report.html';

  if (!isIsoDate(fromDate) || !isIsoDate(toDate) || fromDate > toDate || !topic) {
    showStatus(
      'This link is missing the dates or the topic. Open a topic from the sidebar of a report.',
      true,
      el('p', null, back)
    );
    return;
  }

  document.title = `BOOM Topic Report ${topic} ${datesText}`;
  showStatus(`Loading ${topic} · ${datesText}…`);

  // Same route as the report page, for the same dates. narrative=false: this
  // page shows only counts, so there is no AI call — it is quick and free.
  const query = new URLSearchParams({ from_date: fromDate, to_date: toDate, narrative: 'false' });

  try {
    // Relative on purpose — see README "Two addresses".
    const res = await fetch(`api/report/range?${query}`, {
      headers: { accept: 'application/json' },
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
      `Could not load ${datesText} from the database: ${err.message || 'Request failed'}`,
      true,
      el('p', null, back)
    );
  }
}

loadTopic();
