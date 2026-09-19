import { deadlinesManager } from './deadlines.js';
import { pullCloudDataToLocal, getDataSyncStatus } from './data-sync.js';

let cloudState = 'loading';
let cloudError = '';
let pullStarted = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function currentCourseId() {
  const code = document.querySelector('.course-header h2')?.textContent?.match(/^[A-Z0-9 ]+/)?.[0]?.trim();
  return code ? code.replace(/\s/g, '').toLowerCase() : null;
}

function renderPanel(host) {
  const courseCode = currentCourseId();
  const all = deadlinesManager.getAll().filter(item => item.status !== 'done');
  const visible = courseCode ? all.filter(item => String(item.courseId).replace(/\s/g, '').toLowerCase() === courseCode) : all;
  const list = visible.slice().sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  const body = cloudError
    ? `<div class="deadline-state deadline-error">Could not load deadlines: ${escapeHtml(cloudError)}<button class="btn-ghost" data-deadline-retry type="button">Retry</button></div>`
    : cloudState === 'loading'
      ? '<div class="deadline-state">Loading deadlines…</div>'
      : list.length
        ? `<div class="deadline-list">${list.map(item => `<div class="deadline-row"><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.type)} · ${new Date(item.dueAt).toLocaleString()}</small></div><button class="btn-ghost" data-deadline-done="${escapeHtml(item.id)}" type="button">Done</button></div>`).join('')}</div>`
        : '<div class="deadline-state">No upcoming deadlines yet.</div>';
  host.innerHTML = `<div class="deadline-panel-head"><div><h2>${courseCode ? 'Course deadlines' : 'Upcoming deadlines'}</h2><small>Assessments and due dates sync across devices</small></div><button class="btn-primary" data-deadline-add type="button">+ Add</button></div>${body}`;
  host.querySelector('[data-deadline-add]')?.addEventListener('click', () => {
    const title = window.prompt('Deadline title');
    if (!title?.trim()) return;
    const due = window.prompt('Due date/time (example: 2026-10-15T23:59)', new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16));
    if (!due) return;
    deadlinesManager.createDeadline({ title: title.trim(), courseId: courseCode || 'general', dueAt: new Date(due).toISOString(), type: 'other' });
    renderPanel(host);
  });
  host.querySelectorAll('[data-deadline-done]').forEach(button => button.addEventListener('click', () => {
    deadlinesManager.updateDeadline(button.dataset.deadlineDone, { status: 'done' });
    renderPanel(host);
  }));
  host.querySelector('[data-deadline-retry]')?.addEventListener('click', () => { cloudState = 'loading'; cloudError = ''; renderPanel(host); syncFromCloud(); });
}

function ensurePanel() {
  const app = document.getElementById('app');
  if (!app) return;
  const anchor = app.querySelector('main');
  if (!anchor) return;
  let host = anchor.querySelector('[data-deadlines-ui]');
  if (!host) {
    host = document.createElement('section');
    host.className = 'panel deadlines-ui-panel';
    host.dataset.deadlinesUi = 'true';
    anchor.prepend(host);
  }
  renderPanel(host);
}

async function syncFromCloud() {
  if (pullStarted) return;
  pullStarted = true;
  try {
    await pullCloudDataToLocal();
    cloudState = 'ready';
  } catch (error) {
    // Signed-out users still get the local empty state; authenticated users see
    // an actionable error rather than mistaking a missing migration for empty data.
    cloudState = getDataSyncStatus().running ? 'error' : 'ready';
    cloudError = getDataSyncStatus().running ? (error?.message || String(error)) : '';
  } finally {
    ensurePanel();
    pullStarted = false;
  }
}

deadlinesManager.subscribe(() => {
  cloudState = cloudState === 'loading' ? 'ready' : cloudState;
  ensurePanel();
});

const observer = new MutationObserver(records => {
  if (records.every(record => record.target.closest?.('[data-deadlines-ui]'))) return;
  ensurePanel();
});
function boot() {
  ensurePanel();
  const app = document.getElementById('app');
  if (app) observer.observe(app, { childList: true, subtree: true });
  setTimeout(syncFromCloud, 1200);
  setInterval(() => { if (getDataSyncStatus().running && cloudState === 'ready') syncFromCloud(); }, 30000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
