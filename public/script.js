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
    const res = await fetch('/api/generate', {
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