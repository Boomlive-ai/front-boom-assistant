// script.js — handles form submit, calls /api/generate, renders editable output.

const form = document.getElementById('seo-form');
const generateBtn = document.getElementById('generate-btn');
const responseCard = document.getElementById('response-card');
const fieldsContainer = document.getElementById('fields-container');
const ratingPill = document.getElementById('rating-pill');
const usageLine = document.getElementById('usage-line');
const copyAllBtn = document.getElementById('copy-all');
const toast = document.getElementById('toast');

// Field schema — describes each editable field we render from the API response.
// `kind` controls how the value is displayed / re-serialized.
const FIELDS = [
  { key: 'headline',          label: 'Headline',            kind: 'text',   rows: 2 },
  { key: 'strapline',         label: 'Strapline',           kind: 'text',   rows: 2 },
  { key: 'body_markdown',     label: 'Body (Markdown)',     kind: 'text',   rows: 16 },
  { key: 'slug',              label: 'Slug',                kind: 'single'          },
  { key: 'short_tail_keywords', label: 'Short-tail Keywords', kind: 'list', rows: 4 },
  { key: 'long_tail_keywords',  label: 'Long-tail Keywords',  kind: 'list', rows: 4 },
  { key: 'story_tags',        label: 'Story Tags',          kind: 'list',   rows: 4 },
];

// Latest response, kept in-memory so "Copy JSON" reflects edits.
let currentResponse = null;
// Latest submitted form values, kept so Create Feed can reuse the claim,
// source, caption and URLs the user typed — the generated output has none.
let currentRequest = null;

// ---------- utilities ----------
function showToast(msg, isError = false) {
  toast.textContent = msg;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2400);
}

function setLoading(loading) {
  generateBtn.disabled = loading;
  generateBtn.classList.toggle('loading', loading);
  generateBtn.querySelector('.btn-label').textContent = loading
    ? 'Generating…'
    : 'Generate';
}

// Serialise / parse per field kind.
function valueToDisplay(kind, value) {
  if (value === null || value === undefined) return '';
  if (kind === 'list' && Array.isArray(value)) return value.join('\n');
  if (kind === 'json') return JSON.stringify(value, null, 2);
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function displayToValue(kind, str) {
  if (kind === 'list') {
    return str
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (kind === 'json') {
    try {
      return JSON.parse(str);
    } catch (e) {
      throw new Error('Invalid JSON: ' + e.message);
    }
  }
  return str;
}

// ---------- render response ----------
function renderResponse(data) {
  currentResponse = data;
  responseCard.hidden = false;

  // Rating pill
  const rating = data.suggested_rating || '';
  ratingPill.textContent = rating ? `Rating: ${rating}` : '';
  ratingPill.className = 'rating-pill';
  const r = rating.toLowerCase();
  if (r.includes('true')) ratingPill.classList.add('true');
  else if (r.includes('mislead') || r.includes('partly')) ratingPill.classList.add('mixed');

  // Fields
  fieldsContainer.innerHTML = '';
  FIELDS.forEach((f) => {
    if (!(f.key in data)) return;
    fieldsContainer.appendChild(buildFieldBlock(f, data[f.key]));
  });

  // Usage
  if (data.usage) {
    const u = data.usage;
    const parts = [];
    if (u.input_tokens != null) parts.push(`input ${u.input_tokens}`);
    if (u.output_tokens != null) parts.push(`output ${u.output_tokens}`);
    if (u.judge_input_tokens != null) parts.push(`judge in ${u.judge_input_tokens}`);
    if (u.judge_output_tokens != null) parts.push(`judge out ${u.judge_output_tokens}`);
    const elapsed = data.elapsed_seconds
      ? ` · ${Number(data.elapsed_seconds).toFixed(2)}s`
      : '';
    usageLine.textContent = `Tokens — ${parts.join(', ')}${elapsed}`;
  } else {
    usageLine.textContent = '';
  }

  // Scroll to it
  responseCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildFieldBlock(field, value) {
  const wrap = document.createElement('div');
  wrap.className = 'resp-field' + (field.kind === 'json' ? ' mono' : '');
  wrap.dataset.key = field.key;
  wrap.dataset.kind = field.kind;

  const head = document.createElement('div');
  head.className = 'resp-head';

  const label = document.createElement('label');
  label.textContent = field.label;
  head.appendChild(label);

  const btnGroup = document.createElement('div');
  btnGroup.style.display = 'flex';
  btnGroup.style.gap = '6px';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn ghost small';
  editBtn.textContent = 'Edit';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn ghost small';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(input.value).then(
      () => showToast(`${field.label} copied`),
      () => showToast('Copy failed', true)
    );
  });

  btnGroup.appendChild(editBtn);
  btnGroup.appendChild(copyBtn);
  head.appendChild(btnGroup);
  wrap.appendChild(head);

  // Input element
  let input;
  if (field.kind === 'single') {
    input = document.createElement('input');
    input.type = 'text';
  } else {
    input = document.createElement('textarea');
    input.rows = field.rows || 4;
  }
  input.value = valueToDisplay(field.kind, value);
  input.readOnly = true;
  wrap.appendChild(input);

  // Edit / Save toggle
  editBtn.addEventListener('click', () => {
    if (input.readOnly) {
      // Enter edit mode
      input.readOnly = false;
      input.focus();
      editBtn.textContent = 'Save';
      editBtn.classList.remove('ghost');
      editBtn.classList.add('save');
    } else {
      // Save
      try {
        const parsed = displayToValue(field.kind, input.value);
        currentResponse[field.key] = parsed;
        // Re-format nicely (esp. for JSON / lists)
        input.value = valueToDisplay(field.kind, parsed);
        input.readOnly = true;
        editBtn.textContent = 'Edit';
        editBtn.classList.add('ghost');
        editBtn.classList.remove('save');
        showToast(`${field.label} saved`);
      } catch (err) {
        showToast(err.message, true);
      }
    }
  });

  return wrap;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Turn any API error shape into a readable string.
// Handles FastAPI's {detail: [{loc, msg, type}, ...]} validation errors
// as well as plain {detail: "…"}, {error: "…"}, {message: "…"}, etc.
function extractErrorMessage(data, status) {
  if (!data) return `HTTP ${status}`;
  const raw = data.detail ?? data.error ?? data.message;
  if (raw == null) return `HTTP ${status}`;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((e) => {
        if (typeof e === 'string') return e;
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
  if (typeof raw === 'object') {
    try {
      return JSON.stringify(raw);
    } catch {
      return `HTTP ${status}`;
    }
  }
  return String(raw);
}

// ---------- form submit ----------
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const fd = new FormData(form);
  const raw = {
    language: fd.get('language') || '',
    claim: (fd.get('claim') || '').trim(),
    claim_source: (fd.get('claim_source') || '').trim(),
    verdict: fd.get('verdict') || '',
    context: (fd.get('context') || '').trim(),
    facts_and_findings: (fd.get('facts_and_findings') || '').trim(),
    caption: (fd.get('caption') || '').trim(),
    claim_url: (fd.get('claim_url') || '').trim(),
    claim_date: fd.get('claim_date') || '',
    article_url: (fd.get('article_url') || '').trim(),
  };

  // Drop blank fields so the backend treats them as "not provided"
  // (empty strings fail typed validators like date / url on Pydantic).
  const payload = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== '' && v != null)
  );

  setLoading(true);
  try {
    // Relative on purpose, so the app also works when it is served from a
    // folder path such as /front-boom-assistant/ — see README "Two addresses".
    const res = await fetch('api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Server returned non-JSON: ' + text.slice(0, 200));
    }
    if (!res.ok) {
      throw new Error(extractErrorMessage(data, res.status));
    }
    // Recorded here, not before the fetch: currentResponse only updates on
    // success, so an early assignment would pair the NEW form values with the
    // OLD story after a failed generate, and Create Feed would splice the two
    // into one payload — a feed whose claim and links do not match its text.
    currentRequest = raw;
    renderResponse(data);
    showToast('Generated successfully');
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Request failed', true);
  } finally {
    setLoading(false);
  }
});

// ---------- copy full JSON ----------
copyAllBtn.addEventListener('click', () => {
  if (!currentResponse) return;
  navigator.clipboard
    .writeText(JSON.stringify(currentResponse, null, 2))
    .then(
      () => showToast('Full response copied as JSON'),
      () => showToast('Copy failed', true)
    );
});
/* ==========================================================================
   Create Feed — builds the Hocalwire payload from the generated output and
   POSTs it through the api/create-feed proxy.
   ========================================================================== */

const createFeedBtn = document.getElementById('create-feed-btn');
const copyFeedBtn = document.getElementById('copy-feed-json');
const feedImageInput = document.getElementById('feed-image');
const feedCategoryInput = document.getElementById('feed-category');
const feedSessionInput = document.getElementById('feed-session');
const feedResult = document.getElementById('feed-result');

// Numeric rating Hocalwire stores for the verdict. Only False → 2 is confirmed
// from the sample payload; adjust the rest if the CMS uses another scale.
const CLAIM_RATING = {
  'true': 1,
  'false': 2,
  'misleading': 3,
  'partly false': 4,
  'unverified': 5,
};

// Fixed strings the payload needs but the model never returns. One set per
// language so a Hindi story doesn't get English labels and vice versa.
const FEED_TEXT = {
  en: {
    claimSource: 'Social media',
    claimedBy: 'Social media user',
    factCheckSummary: 'Fact-check report translated from BOOM Live.',
    yourFact: 'Fact verified by BOOM Live.',
    guestName: 'Expert',
    highlightName: 'Top story',
    highlightsHeading: 'Article highlights',
    interviewQues: 'What is your view on this subject?',
    interviewAns: 'This is an important issue that needed to be investigated.',
    interviewerName: 'Reporter',
    location: 'Mumbai',
    newsLabel: 'Fact Check',
    ratingExplanation: 'Rating decided on the basis of verification.',
    readUnit: 'min read',
    langLabel1: 'Read in English',
    langLabel2: 'Hindi version',
    reportedFrom: 'Translated article — from BOOM Live',
    sampleCaption: 'Sample caption',
    caption: 'A glimpse of the translated news article.',
  },
  hi: {
    claimSource: 'सोशल मीडिया',
    claimedBy: 'सामाजिक मीडिया उपयोगकर्ता',
    factCheckSummary: 'BOOM Live से अनुवादित फैक्ट चेक रिपोर्ट।',
    yourFact: 'BOOM Live द्वारा सत्यापित तथ्य।',
    guestName: 'विशेषज्ञ',
    highlightName: 'मुख्य समाचार',
    highlightsHeading: 'लेख की मुख्य बातें',
    interviewQues: 'इस विषय पर आपका क्या मत है?',
    interviewAns: 'यह एक महत्वपूर्ण मुद्दा है जिसकी जांच आवश्यक थी।',
    interviewerName: 'रिपोर्टर',
    location: 'मुंबई',
    newsLabel: 'फैक्ट चेक',
    ratingExplanation: 'सत्यापन के आधार पर निर्धारित रेटिंग।',
    readUnit: 'मिनट',
    langLabel1: 'हिंदी में पढ़ें',
    langLabel2: 'अंग्रेज़ी संस्करण',
    reportedFrom: 'अनुवादित लेख - BOOM Live से',
    sampleCaption: 'नमूना कैप्शन',
    caption: 'अनुवादित समाचार लेख की एक झलक।',
  },
  bn: {
    claimSource: 'সোশ্যাল মিডিয়া',
    claimedBy: 'সোশ্যাল মিডিয়া ব্যবহারকারী',
    factCheckSummary: 'BOOM Live থেকে অনূদিত ফ্যাক্ট চেক প্রতিবেদন।',
    yourFact: 'BOOM Live দ্বারা যাচাই করা তথ্য।',
    guestName: 'বিশেষজ্ঞ',
    highlightName: 'প্রধান খবর',
    highlightsHeading: 'প্রতিবেদনের মূল বিষয়',
    interviewQues: 'এই বিষয়ে আপনার মত কী?',
    interviewAns: 'এটি একটি গুরুত্বপূর্ণ বিষয় যার তদন্ত প্রয়োজন ছিল।',
    interviewerName: 'প্রতিবেদক',
    location: 'মুম্বই',
    newsLabel: 'ফ্যাক্ট চেক',
    ratingExplanation: 'যাচাইয়ের ভিত্তিতে নির্ধারিত রেটিং।',
    readUnit: 'মিনিট',
    langLabel1: 'বাংলায় পড়ুন',
    langLabel2: 'ইংরেজি সংস্করণ',
    reportedFrom: 'অনূদিত প্রতিবেদন — BOOM Live থেকে',
    sampleCaption: 'নমুনা ক্যাপশন',
    caption: 'অনূদিত সংবাদ প্রতিবেদনের একটি ঝলক।',
  },
};

// ---------- payload helpers ----------

// The CMS stores `story` as HTML but the model returns Markdown. This covers
// exactly what the model emits: ###-headings, blank-line paragraphs, - / 1.
// lists, **bold**, *italic* and [text](url). Text is escaped first, so no raw
// HTML from the model can reach the page or the payload.
function markdownToHtml(md) {
  if (!md) return '';

  const inline = (s) =>
    escapeHtml(s)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

  const out = [];
  let para = [];
  let list = null; // 'ul' | 'ol' | null

  const flushPara = () => {
    if (para.length) {
      out.push('<p>' + inline(para.join(' ')) + '</p>');
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push('</' + list + '>');
      list = null;
    }
  };

  String(md)
    .split(/\r?\n/)
    .forEach((line) => {
      const t = line.trim();

      if (!t) {
        flushPara();
        flushList();
        return;
      }

      const heading = t.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        flushPara();
        flushList();
        // "# " becomes h2 — the page title is already the only h1.
        const level = Math.min(heading[1].length + 1, 6);
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        return;
      }

      const bullet = t.match(/^[-*+]\s+(.*)$/);
      const numbered = t.match(/^\d+[.)]\s+(.*)$/);
      if (bullet || numbered) {
        flushPara();
        const want = bullet ? 'ul' : 'ol';
        if (list !== want) {
          flushList();
          out.push('<' + want + '>');
          list = want;
        }
        out.push('<li>' + inline((bullet || numbered)[1]) + '</li>');
        return;
      }

      flushList();
      para.push(t);
    });

  flushPara();
  flushList();
  return out.join('\n');
}

// ~200 words a minute, rounded to whole minutes and floored at one — the same
// shape as the sample payload's 300 seconds / "5 मिनट" pair.
function readingTimeSeconds(text) {
  const words = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(60, Math.round(words / 200) * 60);
}

function truncate(str, max) {
  const s = String(str || '');
  return s.length > max ? s.slice(0, max).trimEnd() + '...' : s;
}

function ratingCode(verdict) {
  const key = String(verdict || '').trim().toLowerCase();
  return CLAIM_RATING[key] != null ? CLAIM_RATING[key] : 2;
}

// ---------- build the payload ----------
// Every key below is one createFeedV2 expects. Values come from three places:
// the generated response, the form the user filled in, and the three inputs
// in the Create Feed box.
function buildFeedPayload() {
  if (!currentResponse) throw new Error('Generate a story first.');

  const res = currentResponse;
  const req = currentRequest || {};
  const lang = req.language || 'en';
  const t = FEED_TEXT[lang] || FEED_TEXT.en;

  const image = (feedImageInput.value || '').trim();
  const claim = (req.claim || '').trim();
  const source = (req.claim_source || '').trim();
  const caption = (req.caption || '').trim();
  const strapline = (res.strapline || '').trim();
  const body = res.body_markdown || '';
  // The published article if there is one, otherwise the post being checked.
  const link = (req.article_url || req.claim_url || '').trim();
  const media = image ? [image] : [];
  const readSec = readingTimeSeconds(body);

  return {
    ReviewBoxcheckbox_2: true,
    ReviewBoximage_advanced_5: image,
    articletype: 'NEWS_ARTICLE',
    avatarId: 1,
    categoryId: (feedCategoryInput.value || '').trim(),
    claim_fact_check: claim,
    claim_rating: ratingCode(req.verdict),
    claim_review: claim,
    claim_source: source || t.claimSource,
    claimed_by: source || t.claimedBy,
    classification: 'FACT_CHECK',
    description: strapline,
    fact_check_summary: t.factCheckSummary,
    fact_check_summary_claim: claim,
    fast_check_claim: claim,
    fast_check_previous_url: link,
    fast_check_review_type: 'FULL',
    fast_check_your_fact: t.yourFact,
    fastcheck_media: media,
    guest_name: t.guestName,
    heading: (res.headline || '').trim(),
    highlightLinkPost: link,
    highlightNamePost: t.highlightName,
    highlight_icon: 'flag',
    highlights: Array.isArray(res.short_tail_keywords)
      ? res.short_tail_keywords
      : [],
    highlights_heading: t.highlightsHeading,
    interview_ans: [t.interviewAns],
    interview_check: true,
    interview_ques: [t.interviewQues],
    interviewer_name: t.interviewerName,
    language: lang,
    location: t.location,
    mediaIds: media,
    news_label: t.newsLabel,
    news_label_url: link,
    news_read_time_sec: readSec,
    news_speech_file_path: '',
    news_trending_view_count: 1250,
    news_type: 'USER',
    point_lat: 13.0368,
    point_long: 80.2676,
    rating_explanation: t.ratingExplanation,
    read_duration: `${Math.round(readSec / 60)} ${t.readUnit}`,
    reviewed_by: 'BOOM',
    seo_description: truncate(strapline, 160),
    sessionId: (feedSessionInput.value || '').trim(),
    show_claim_review: true,
    show_fast_check: true,
    state: 'SUBMITTED',
    story: markdownToHtml(body),
    story_language_label_1: t.langLabel1,
    story_language_label_2: t.langLabel2,
    story_language_link_1: link,
    story_language_link_2: link,
    story_reported_from: t.reportedFrom,
    'test-cap': caption || t.sampleCaption,
    'test-lang': lang,
    text_caption: caption || t.caption,
    video_duration: '2:30',
  };
}

// ---------- send it ----------
function setFeedLoading(loading) {
  createFeedBtn.disabled = loading;
  createFeedBtn.classList.toggle('loading', loading);
  createFeedBtn.querySelector('.btn-label').textContent = loading
    ? 'Creating…'
    : 'Create Feed';
}

function showFeedResult(text, isError) {
  feedResult.hidden = false;
  feedResult.textContent = text;
  feedResult.classList.toggle('error', Boolean(isError));
}

createFeedBtn.addEventListener('click', async () => {
  let payload;
  try {
    payload = buildFeedPayload();
  } catch (err) {
    showToast(err.message, true);
    return;
  }

  if (!payload.ReviewBoximage_advanced_5) {
    showToast('Image URL is required.', true);
    feedImageInput.focus();
    return;
  }
  if (!payload.categoryId) {
    showToast('Category ID is required.', true);
    feedCategoryInput.focus();
    return;
  }
  if (!payload.sessionId) {
    showToast('Session ID is required.', true);
    feedSessionInput.focus();
    return;
  }

  setFeedLoading(true);
  try {
    // Relative on purpose, so the app also works when it is served from a
    // folder path such as /front-boom-assistant/ — see README "Two addresses".
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
      throw new Error(
        data ? extractErrorMessage(data, res.status) : text.slice(0, 300)
      );
    }
    showFeedResult(data ? JSON.stringify(data, null, 2) : text, false);
    showToast('Feed created');
  } catch (err) {
    console.error(err);
    showFeedResult(err.message || 'Request failed', true);
    showToast(err.message || 'Create Feed failed', true);
  } finally {
    setFeedLoading(false);
  }
});

// Handy for checking exactly what would be sent before sending it.
copyFeedBtn.addEventListener('click', () => {
  let payload;
  try {
    payload = buildFeedPayload();
  } catch (err) {
    showToast(err.message, true);
    return;
  }
  navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(
    () => showToast('Feed payload copied as JSON'),
    () => showToast('Copy failed', true)
  );
});
