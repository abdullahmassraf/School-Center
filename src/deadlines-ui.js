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

function courseForDeadline(deadline) {
  if (deadline.courseCode) return deadline.courseCode;
  return String(deadline.courseId || '')
    .replace(/([a-z]+)(\d)/i, '$1 $2')
    .toUpperCase();
}

function renderPanel(host) {
  const courseCode = currentCourseId();
  const all = deadlinesManager.getAll().filter(item => item.status !== 'done');
  const visible = courseCode ? all.filter(item => String(item.courseId).replace(/\s/g, '').toLowerCase() === courseCode) : all;
  const list = visible.slice().sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  const body = cloudError
    ? `<div class="deadline-state deadline-error">Could not load deadlines: ${escapeHtml(cloudError)}<button class="btn-ghost" data-deadline-retry type="button">Retry</button></div>`
    : cloudState === 'loading'
      ? '<div class="deadline-state">Loading course-outline deadlines…</div>'
      : list.length
        ? `<div class="deadline-list">${list.map(item => `<div class="deadline-row"><div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.type)} · ${new Date(item.dueAt).toLocaleString()}</small></div><button class="btn-ghost" data-deadline-done="${escapeHtml(item.id)}" type="button">Done</button></div>`).join('')}</div>`
        : '<div class="deadline-state">No dated assessments found in this course outline yet.</div>';
  host.innerHTML = `<div class="deadline-panel-head"><div><h2>${courseCode ? 'Course deadlines' : 'Upcoming deadlines'}</h2><small>Extracted from course outlines · syncs across devices</small></div><button class="btn-primary" data-deadline-add type="button">+ Add</button></div>${body}`;
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

function selectedCalendarDate() {
  const selected = document.querySelector('.date-strip-cell.selected')?.dataset.daykey
    || document.querySelector('.month-cell.selected')?.dataset.calDay;
  return selected ? new Date(selected) : null;
}

function calendarDeadlineRows(deadlines) {
  return deadlines.map(deadline => `
    <div class="agenda-item outline-deadline-item" data-outline-deadline="${escapeHtml(deadline.id)}" style="--item-color:var(--accent-3);">
      <div class="agenda-time">Due Date</div>
      <div class="agenda-main">
        <div class="agenda-course">${escapeHtml(courseForDeadline(deadline))}</div>
        <div class="agenda-title">📅 ${escapeHtml(deadline.title)}</div>
        <div style="font-size:0.75rem;color:var(--muted);margin-top:2px;">${escapeHtml(deadline.type)}${deadline.weight ? ` · ${deadline.weight}%` : ''}</div>
      </div>
    </div>
  `).join('');
}

function decorateCalendar() {
  const cells = document.querySelectorAll('.date-strip-cell[data-daykey], .month-cell[data-cal-day]');
  cells.forEach(cell => {
    const key = cell.dataset.daykey || cell.dataset.calDay;
    const hasDeadline = deadlinesManager.getAll().some(item => item.status !== 'done' && new Date(item.dueAt).toDateString() === key);
    const dots = cell.querySelector('.month-cell-dots');
    if (!dots || !hasDeadline || dots.querySelector('.deadline-dot')) return;
    dots.insertAdjacentHTML('beforeend', '<span class="cell-dot deadline-dot" title="Course assessment deadline"></span>');
  });

  const selected = selectedCalendarDate();
  if (!selected) return;
  const deadlines = deadlinesManager.getAll().filter(item => item.status !== 'done' && new Date(item.dueAt).toDateString() === selected.toDateString());
  const agendaHosts = [
    document.querySelector('.date-strip')?.closest('.panel')?.querySelector('.agenda-list'),
    document.querySelector('.month-cal-agenda .agenda-list')
  ].filter(Boolean);
  agendaHosts.forEach(agenda => {
    agenda.querySelectorAll('[data-outline-deadline]').forEach(row => row.remove());
    if (deadlines.length) agenda.insertAdjacentHTML('beforeend', calendarDeadlineRows(deadlines));
  });
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
  // The app shell is rendered before the course view. Re-anchor on every pass
  // so a host created during boot never remains above the course header/tabs.
  const courseTabs = anchor.querySelector('.course-tabs');
  if (courseTabs && host.previousElementSibling !== courseTabs) courseTabs.after(host);
  else if (!courseTabs && host.parentElement !== anchor) anchor.prepend(host);
  renderPanel(host);
  decorateCalendar();
}

async function syncFromCloud() {
  if (pullStarted) return;
  pullStarted = true;
  try {
    await pullCloudDataToLocal();
    cloudState = 'ready';
  } catch (error) {
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
