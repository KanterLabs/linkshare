const ownerName = document.querySelector('meta[name="owner-name"]').content || 'Me';
const state = {
  target: 'owner',
  history: false,
  loading: false,
  failures: 0,
  lastUpdated: null,
  live: false,
  notify: localStorage.getItem('linkshare:notify') === '1',
};

const linksNode = document.querySelector('#links');
const noticeNode = document.querySelector('#notice');
const inboxHeading = document.querySelector('#inbox-heading');
const updatedNode = document.querySelector('#updated');
const updatedText = document.querySelector('#updated-text');
const liveDot = document.querySelector('#live-dot');
const notifyButton = document.querySelector('#notify');
const form = document.querySelector('#link-form');

let pollTimer;
let refreshQueued = false;
let seenView = '';
let seenIds = new Set();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.querySelector('#form-status');
  const button = form.querySelector('button[type="submit"]');
  status.textContent = 'Sharing…';
  button.disabled = true;
  try {
    const created = await api('/api/v1/links', {
      method: 'POST',
      body: JSON.stringify({
        url: document.querySelector('#url').value,
        title: document.querySelector('#title').value,
        note: document.querySelector('#note').value,
        target: document.querySelector('#target').value,
        submitted_by: ownerName,
      }),
    });
    form.reset();
    document.querySelector('#target').value = 'agents';
    document.querySelector('#details').open = false;
    status.textContent = `Shared · expires ${formatExpiry(created.expires_at)}`;
    await refresh();
    setTimeout(() => { status.textContent = ''; }, 3000);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.target) state.target = button.dataset.target;
  state.history = button.dataset.mode === 'history';
  document.querySelectorAll('.tab').forEach((item) => {
    const selected = item === button;
    item.classList.toggle('active', selected);
    item.setAttribute('aria-selected', selected);
  });
  inboxHeading.textContent = state.history ? 'History' : (state.target === 'owner' ? 'Waiting for you' : 'Waiting for agents');
  refresh();
}));

document.querySelector('#refresh').addEventListener('click', refresh);

notifyButton.addEventListener('click', async () => {
  if (state.notify) {
    setNotify(false);
    return;
  }
  if (!('Notification' in window)) {
    showError('This browser does not offer notifications here — plain-http pages usually need HTTPS. Server push via LINKSHARE_NOTIFY_URL works regardless.');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    showError('Notifications are blocked for this site — allow them in the browser settings, then try again.');
    return;
  }
  setNotify(true);
  noticeNode.hidden = true;
});

function setNotify(enabled) {
  state.notify = enabled;
  localStorage.setItem('linkshare:notify', enabled ? '1' : '');
  renderNotifyButton();
}

function renderNotifyButton() {
  const active = state.notify && 'Notification' in window && Notification.permission === 'granted';
  notifyButton.classList.toggle('active', active);
  notifyButton.setAttribute('aria-pressed', active);
  const label = active ? 'Notifications on — click to turn off' : 'Notify me when links arrive';
  notifyButton.title = label;
  notifyButton.setAttribute('aria-label', label);
}

function maybeNotify(item) {
  if (!state.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (item.submitted_by === ownerName) return;
  const host = new URL(item.url).hostname;
  const notification = new Notification(item.target === 'owner' ? 'New link for you' : 'New link for agents', {
    body: [item.title || host, item.note].filter(Boolean).join('\n').slice(0, 180),
    tag: `linkshare-${item.id}`,
  });
  notification.addEventListener('click', () => {
    window.focus();
    notification.close();
  });
}

function connectStream() {
  if (!('EventSource' in window)) return;
  const stream = new EventSource('/api/v1/events');
  stream.addEventListener('open', () => setLive(true));
  stream.addEventListener('error', () => setLive(false));
  stream.addEventListener('link_created', (event) => {
    queueRefresh();
    try {
      maybeNotify(JSON.parse(event.data));
    } catch {
      // event payload is informational only
    }
  });
  stream.addEventListener('link_consumed', queueRefresh);
}

function setLive(live) {
  if (state.live === live) return;
  state.live = live;
  renderUpdated();
  scheduleNext();
  if (live) queueRefresh();
}

function queueRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  setTimeout(() => {
    refreshQueued = false;
    refresh();
  }, 150);
}

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  document.querySelector('#refresh').classList.add('spinning');
  try {
    const [owner, agents] = await Promise.all([
      api('/api/v1/links?target=owner&limit=1'),
      api('/api/v1/links?target=agents&limit=1'),
    ]);
    document.querySelector('#owner-count').textContent = owner.total;
    document.querySelector('#agents-count').textContent = agents.total;
    document.title = owner.total > 0 ? `(${owner.total}) Linkshare` : 'Linkshare';

    const path = state.history
      ? `/api/v1/links?target=${state.target}&state=read&limit=200`
      : `/api/v1/links?target=${state.target}&limit=200`;
    const result = await api(path);
    renderLinks(result.items);
    noticeNode.hidden = true;
    state.failures = 0;
    state.lastUpdated = Date.now();
    renderUpdated();
  } catch (error) {
    state.failures += 1;
    renderUpdated();
    showError(error.message);
  } finally {
    state.loading = false;
    document.querySelector('#refresh').classList.remove('spinning');
  }
}

function renderUpdated() {
  liveDot.classList.toggle('on', state.live);
  if (state.failures >= 2) {
    updatedNode.classList.add('stale');
    updatedText.textContent = 'connection lost — retrying';
    return;
  }
  updatedNode.classList.remove('stale');
  if (state.live) {
    updatedText.textContent = 'live';
    return;
  }
  if (!state.lastUpdated) {
    updatedText.textContent = '';
    return;
  }
  const minutes = Math.floor((Date.now() - state.lastUpdated) / 60000);
  updatedText.textContent = minutes < 1 ? 'updated just now' : `updated ${minutes}m ago`;
}

function renderLinks(items) {
  const view = `${state.history}:${state.target}`;
  const sameView = view === seenView;
  linksNode.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = state.history
      ? 'No history yet.'
      : (state.target === 'owner' ? 'Nothing waiting for you.' : 'Nothing waiting for agents.');
    linksNode.append(empty);
  } else {
    items.forEach((item) => {
      const row = linkRow(item);
      if (sameView && !state.history && !seenIds.has(item.id)) row.classList.add('fresh');
      linksNode.append(row);
    });
  }
  seenView = view;
  seenIds = new Set(items.map((item) => item.id));
}

function linkRow(item) {
  const row = document.createElement('article');
  row.className = 'link-row';
  const parsed = new URL(item.url);

  const content = document.createElement('div');
  content.className = 'link-content';
  const title = document.createElement('a');
  title.className = 'link-title';
  title.href = item.url;
  title.target = '_blank';
  title.rel = 'noopener noreferrer';
  title.textContent = item.title || parsed.hostname;
  if (!item.read_at) {
    title.addEventListener('click', () => consume(item.id, row));
  }
  content.append(title);

  if (item.note) {
    const note = document.createElement('p');
    note.className = 'link-note';
    note.textContent = item.note;
    content.append(note);
  }

  const meta = document.createElement('p');
  meta.className = 'link-meta';
  if (item.read_at) {
    const consumed = document.createElement('span');
    consumed.textContent = `consumed ${formatAgo(item.read_at)}`;
    consumed.title = new Date(item.read_at).toLocaleString();
    meta.append(`${parsed.hostname} · from ${item.submitted_by} · `, consumed);
  } else {
    const expiry = document.createElement('span');
    expiry.textContent = formatExpiry(item.expires_at);
    expiry.title = new Date(item.expires_at).toLocaleString();
    meta.append(`${parsed.hostname} · from ${item.submitted_by} · `, expiry);
  }
  content.append(meta);

  if (item.read_at) {
    row.append(content);
    return row;
  }

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  const open = document.createElement('a');
  open.className = 'open-link';
  open.href = item.url;
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.setAttribute('aria-label', `Open ${title.textContent}`);
  open.title = 'Open and clear';
  open.textContent = '↗';
  open.addEventListener('click', () => consume(item.id, row));
  const dismiss = document.createElement('button');
  dismiss.className = 'dismiss';
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', `Dismiss ${title.textContent}`);
  dismiss.title = 'Dismiss';
  dismiss.textContent = '×';
  dismiss.addEventListener('click', () => consume(item.id, row));
  actions.append(open, dismiss);

  row.append(content, actions);
  return row;
}

async function consume(id, row) {
  row.classList.add('leaving');
  try {
    await api(`/api/v1/links/${id}`, { method: 'DELETE' });
    row.remove();
    await refresh();
  } catch (error) {
    row.classList.remove('leaving');
    showError(`${error.message} — if you opened the link, dismiss it manually`);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Request failed (${response.status})`);
  return data;
}

function formatExpiry(value) {
  const milliseconds = new Date(value).getTime() - Date.now();
  const hours = Math.max(0, Math.ceil(milliseconds / 3600000));
  if (hours < 24) return `expires in ${hours}h`;
  return `expires in ${Math.ceil(hours / 24)}d`;
}

function formatAgo(value) {
  const milliseconds = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(milliseconds / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function showError(message) {
  noticeNode.textContent = message;
  noticeNode.hidden = false;
}

function scheduleNext() {
  clearTimeout(pollTimer);
  const base = state.live ? 120000 : 15000;
  const delay = Math.min(base * 2 ** state.failures, 300000);
  pollTimer = setTimeout(async () => {
    if (!document.hidden) await refresh();
    scheduleNext();
  }, delay);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});

setInterval(renderUpdated, 30000);

renderNotifyButton();
connectStream();
refresh();
scheduleNext();
