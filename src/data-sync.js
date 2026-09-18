// ============================================================================
// src/data-sync.js — Automatic bidirectional cloud sync for Notes & Assignments
// ============================================================================

import { getSupabase } from './supabase.js';
import { getCurrentAiUser } from './ai-history.js';
import { notesManager } from './notes.js';
import { assignmentsManager } from './assignments.js';

/*
 * v1.3.0 — why cross-device sync stopped working
 * ---------------------------------------------------------------------------
 * The merge/tombstone logic below was never the problem. The transport was.
 *
 *  (a) startAutomaticDataSync() was called from three places during boot
 *      (app.js bootstrap, onAuthStateChange, and the loadAiChatHistory
 *      callback). All three ran concurrently. Each one awaited
 *      getCurrentAiUser() and then called attachRealtime(), which subscribed
 *      a channel named `school-center-notes-<uid>`. Subscribing a second
 *      channel on a topic that already has a live subscription is rejected by
 *      supabase-js, so the app ended up with leaked channels and, often, a
 *      surviving channel stuck in CHANNEL_ERROR. Realtime was dead while the
 *      UI happily reported "Connected". START_LOCK below makes the function
 *      single-flight; teardownChannels() makes channel removal exhaustive.
 *
 *  (b) subscribe() status was ignored entirely. A CHANNEL_ERROR / TIMED_OUT
 *      channel produced zero feedback and zero recovery. Status is now
 *      tracked, reported to the UI, and — critically — when realtime is not
 *      healthy the engine falls back to a 15s reconciliation poll, so notes
 *      still cross devices even with the websocket down (corporate wifi,
 *      captive portals, and blocked wss:// are all common causes).
 *
 *  (c) the periodic reconcile ran every 30s with no backoff, so a hard
 *      failure (e.g. missing migration) retried forever at full rate.
 */

const TOMBSTONES_KEY = 'schoolcenter_sync_tombstones_v2';
const SYNC_DEBOUNCE_MS = 300;
const PERIODIC_SYNC_MS = 5000;
const FALLBACK_POLL_MS = 3000;   // used when realtime is not healthy
const MAX_BACKOFF_MS = 300000;    // 5 min ceiling after repeated failures

let notesChannel = null;
let assignmentsChannel = null;
let autoSyncStarted = false;
let localSyncTimer = null;
let periodicSyncTimer = null;
let applyingRemoteChange = false;
let unsubscribeNotes = null;
let unsubscribeAssignments = null;
let wakeCleanup = null;
let syncGeneration = 0;
let localWatchersStarted = false;
let startInFlight = null;
let realtimeStatus = 'idle';
let consecutiveFailures = 0;
let lastSyncOkAt = 0;

export function getDataSyncStatus() {
  return {
    running: autoSyncStarted,
    realtime: realtimeStatus,
    consecutiveFailures,
    lastSyncOkAt
  };
}

function readTombstones() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOMBSTONES_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeTombstones(map) {
  try { localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(map)); } catch (_) {}
}

function keyFor(type, id) {
  return `${type}:${id}`;
}

function rememberDeletion(type, id, updatedAt = Date.now()) {
  const map = readTombstones();
  map[keyFor(type, id)] = updatedAt;
  writeTombstones(map);
}

function clearTombstone(type, id) {
  const map = readTombstones();
  if (map[keyFor(type, id)]) {
    delete map[keyFor(type, id)];
    writeTombstones(map);
  }
}

function getTombstone(type, id) {
  return Number(readTombstones()[keyFor(type, id)] || 0);
}

async function requireCloudIdentity() {
  const sb = getSupabase();
  const user = await getCurrentAiUser();
  if (!sb || !user) throw new Error('Not signed in. Open Settings → Account & cross-device sync and sign in with the same email on every device.');
  return { sb, user };
}

async function fetchRows(table) {
  const { sb, user } = await requireCloudIdentity();
  const { data, error } = await sb.from(table).select('*').eq('user_id', user.id);
  if (error) throw error;
  return data || [];
}

async function upsertActiveRows(table, idField, type, items) {
  if (!items.length) return;
  const { sb, user } = await requireCloudIdentity();
  const rows = items.map(item => ({
    user_id: user.id,
    [idField]: item.id,
    data: item,
    updated_at: new Date(item.updatedAt || Date.now()).toISOString(),
    deleted_at: null
  }));

  const { error } = await sb.from(table).upsert(rows, { onConflict: `user_id,${idField}` });
  if (error) throw error;
  items.forEach(item => clearTombstone(type, item.id));
}

async function upsertDeletionRows(table, idField, type) {
  const { sb, user } = await requireCloudIdentity();
  const tombstones = readTombstones();
  const rows = Object.entries(tombstones)
    .filter(([key]) => key.startsWith(`${type}:`))
    .map(([key, timestamp]) => {
      const deletedAt = new Date(Number(timestamp) || Date.now()).toISOString();
      return {
        user_id: user.id,
        [idField]: key.slice(type.length + 1),
        data: {},
        updated_at: deletedAt,
        deleted_at: deletedAt
      };
    });
  if (!rows.length) return;
  const { error } = await sb.from(table).upsert(rows, { onConflict: `user_id,${idField}` });
  if (error) throw error;
}

function notifyUiOfSync(type = 'remote', message = '') {
  try {
    window.dispatchEvent(new CustomEvent('schoolcenter:data-sync-changed', {
      detail: { type, message, realtime: realtimeStatus }
    }));
  } catch (_) {}
}

function localTime(item) {
  return Number(item?.updatedAt || 0);
}

function removeLocal(type, id) {
  if (type === 'note') notesManager.deleteNote(id, { silent: true });
  else assignmentsManager.deleteAssignment(id, { silent: true });
}

function mergeCloud(type, rows) {
  const manager = type === 'note' ? notesManager : assignmentsManager;
  const liveRecords = [];

  for (const row of rows) {
    const id = type === 'note' ? row.note_id : row.assignment_id;
    const cloudTime = new Date(row.deleted_at || row.updated_at || 0).getTime() || 0;

    if (row.deleted_at) {
      const existing = manager.getById(id);
      if (existing && cloudTime >= localTime(existing)) {
        rememberDeletion(type, id, cloudTime);
        removeLocal(type, id);
        notifyUiOfSync('delete');
      }
      continue;
    }

    if (getTombstone(type, id) > cloudTime) continue;
    liveRecords.push({ id, data: row.data, updatedAt: cloudTime });
  }

  if (type === 'note') notesManager.mergeCloudRecords(liveRecords);
  else assignmentsManager.mergeCloudRecords(liveRecords);

  // Once a newer active record is accepted, its local deletion tombstone is obsolete.
  liveRecords.forEach(record => {
    if (record.updatedAt >= getTombstone(type, record.id)) clearTombstone(type, record.id);
  });
}

async function handleRealtime(type, payload) {
  if (!payload || applyingRemoteChange) return;
  const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
  const id = type === 'note' ? row?.note_id : row?.assignment_id;
  if (!id) return;

  applyingRemoteChange = true;
  try {
    const manager = type === 'note' ? notesManager : assignmentsManager;
    const remoteTime = new Date(row.deleted_at || row.updated_at || Date.now()).getTime();

    if (payload.eventType === 'DELETE' || row.deleted_at) {
      const existing = manager.getById(id);
      if (existing && remoteTime >= localTime(existing)) {
        rememberDeletion(type, id, remoteTime);
        removeLocal(type, id);
        notifyUiOfSync('delete');
      }
      return;
    }

    const localDeletion = getTombstone(type, id);
    if (localDeletion > remoteTime) return;

    const existing = manager.getById(id);
    if (!existing || remoteTime > localTime(existing)) {
      manager.mergeCloudRecords([{ id, data: row.data, updatedAt: remoteTime }]);
      clearTombstone(type, id);
      notifyUiOfSync('upsert');
    }
  } finally {
    applyingRemoteChange = false;
  }
}

export async function pushLocalDataToCloud() {
  const notes = notesManager.getAll();
  const assignments = assignmentsManager.getAll();
  await upsertActiveRows('user_notes', 'note_id', 'note', notes);
  await upsertActiveRows('user_assignments', 'assignment_id', 'assignment', assignments);
  await upsertDeletionRows('user_notes', 'note_id', 'note');
  await upsertDeletionRows('user_assignments', 'assignment_id', 'assignment');
}

export async function verifyCloudState() {
  const { sb, user } = await requireCloudIdentity();
  const [notesResult, assignmentsResult] = await Promise.all([
    sb.from('user_notes').select('note_id,updated_at,deleted_at').eq('user_id', user.id),
    sb.from('user_assignments').select('assignment_id,updated_at,deleted_at').eq('user_id', user.id)
  ]);
  if (notesResult.error) throw notesResult.error;
  if (assignmentsResult.error) throw assignmentsResult.error;

  const noteRows = notesResult.data || [];
  const assignmentRows = assignmentsResult.data || [];
  const localNotes = notesManager.getAll();
  const localAssignments = assignmentsManager.getAll();

  const noteMap = new Map(noteRows.map(r => [r.note_id, r]));
  const assignmentMap = new Map(assignmentRows.map(r => [r.assignment_id, r]));

  for (const note of localNotes) {
    const row = noteMap.get(note.id);
    if (!row || (!row.deleted_at && new Date(row.updated_at).getTime() < localTime(note))) {
      throw new Error('Cloud verification failed for Notes. The latest local change was not confirmed by the server.');
    }
  }
  for (const assignment of localAssignments) {
    const row = assignmentMap.get(assignment.id);
    if (!row || (!row.deleted_at && new Date(row.updated_at).getTime() < localTime(assignment))) {
      throw new Error('Cloud verification failed for Assignments. The latest local change was not confirmed by the server.');
    }
  }
}

async function pullCloudDataToLocal() {
  const [noteRows, assignmentRows] = await Promise.all([
    fetchRows('user_notes'),
    fetchRows('user_assignments')
  ]);

  applyingRemoteChange = true;
  try {
    mergeCloud('note', noteRows);
    mergeCloud('assignment', assignmentRows);
  } finally {
    applyingRemoteChange = false;
  }
}

export async function fullTwoWaySync() {
  // Pull before push so a new device never overwrites newer cloud data.
  await pullCloudDataToLocal();
  await pushLocalDataToCloud();
}


function ensureLocalMutationWatchers() {
  if (localWatchersStarted) return;
  localWatchersStarted = true;
  unsubscribeNotes = notesManager.subscribe((_notes, event = {}) => {
    if (event.type === 'delete' && event.id) rememberDeletion('note', event.id, event.updatedAt || Date.now());
    scheduleLocalSync();
  });
  unsubscribeAssignments = assignmentsManager.subscribe((_assignments, event = {}) => {
    if (event.type === 'delete' && event.id) rememberDeletion('assignment', event.id, event.updatedAt || Date.now());
    scheduleLocalSync();
  });
}

async function syncAfterLocalChange() {
  try {
    await fullTwoWaySync();
    // Verify that the server accepted the latest state. This is deliberately
    // separate from Realtime: a successful websocket subscription must never
    // be mistaken for a successful database write.
    await verifyCloudState();
    consecutiveFailures = 0;
    lastSyncOkAt = Date.now();
    notifyUiOfSync('ok');
  } catch (err) {
    // Surface the failure to the UI instead of swallowing it silently —
    // a missing table/migration or an expired session previously failed
    // here with zero visible feedback, making sync look broken forever.
    consecutiveFailures += 1;
    notifyUiOfSync('error', err?.message || String(err));
  } finally {
    // Re-arm at the interval appropriate to the CURRENT health, so a run of
    // failures backs off instead of hammering, and a degraded websocket
    // polls faster than a healthy one.
    schedulePeriodicSync();
  }
}

/** Interval for the reconciliation loop. Fast when realtime is down (it is
 *  the only thing keeping devices in step), slow when realtime is healthy,
 *  exponentially backed off while requests keep failing. */
function nextSyncInterval() {
  const base = realtimeStatus === 'subscribed' ? PERIODIC_SYNC_MS : FALLBACK_POLL_MS;
  if (!consecutiveFailures) return base;
  return Math.min(base * Math.pow(2, Math.min(consecutiveFailures, 5)), MAX_BACKOFF_MS);
}

function schedulePeriodicSync() {
  if (!autoSyncStarted) return;
  if (periodicSyncTimer) clearTimeout(periodicSyncTimer);
  periodicSyncTimer = setTimeout(() => {
    periodicSyncTimer = null;
    if (autoSyncStarted) syncAfterLocalChange();
  }, nextSyncInterval());
}

function scheduleLocalSync() {
  if (!autoSyncStarted || applyingRemoteChange) return;
  if (localSyncTimer) clearTimeout(localSyncTimer);
  localSyncTimer = setTimeout(() => {
    localSyncTimer = null;
    syncAfterLocalChange();
  }, SYNC_DEBOUNCE_MS);
}

/** Removes every channel this module owns, including any orphan left behind
 *  on our topics by an earlier racing start. Called before every subscribe. */
function teardownChannels() {
  const sb = getSupabase();
  if (!sb) { notesChannel = null; assignmentsChannel = null; return; }
  for (const ch of [notesChannel, assignmentsChannel]) {
    if (ch) { try { sb.removeChannel(ch); } catch (_) {} }
  }
  notesChannel = null;
  assignmentsChannel = null;

  // Belt and braces: supabase-js keeps its own registry, and a channel leaked
  // by a previous race would otherwise block a fresh subscribe on that topic.
  try {
    (sb.getChannels?.() || []).forEach(ch => {
      if (typeof ch?.topic === 'string' && ch.topic.includes('school-center-')) {
        try { sb.removeChannel(ch); } catch (_) {}
      }
    });
  } catch (_) {}
}

function onChannelStatus(status, error) {
  if (status === 'SUBSCRIBED') {
    realtimeStatus = 'subscribed';
  } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    // Not fatal: the reconciliation poll below keeps devices in step without
    // the websocket. Surfaced so Settings can say so rather than lying.
    realtimeStatus = 'degraded';
    notifyUiOfSync('realtime', error?.message || `Live updates unavailable (${status}). Falling back to periodic sync.`);
    schedulePeriodicSync();
  }
}

function attachRealtime(userId) {
  const sb = getSupabase();
  if (!sb || !userId) return;

  teardownChannels();
  realtimeStatus = 'connecting';

  try {
    notesChannel = sb.channel(`school-center-notes-${userId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'user_notes', filter: `user_id=eq.${userId}`
      }, payload => handleRealtime('note', payload).catch(() => {}))
      .subscribe(onChannelStatus);

    assignmentsChannel = sb.channel(`school-center-assignments-${userId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'user_assignments', filter: `user_id=eq.${userId}`
      }, payload => handleRealtime('assignment', payload).catch(() => {}))
      .subscribe(onChannelStatus);
  } catch (error) {
    realtimeStatus = 'degraded';
    notifyUiOfSync('realtime', error?.message || 'Live updates unavailable. Falling back to periodic sync.');
  }
}

export function stopAutomaticDataSync() {
  autoSyncStarted = false;
  syncGeneration += 1;
  if (localSyncTimer) clearTimeout(localSyncTimer);
  // NOTE: the periodic loop is a self-rescheduling setTimeout now (it used to
  // be a setInterval, which is why it could never change its own cadence).
  if (periodicSyncTimer) clearTimeout(periodicSyncTimer);
  localSyncTimer = null;
  periodicSyncTimer = null;
  if (wakeCleanup) wakeCleanup();
  wakeCleanup = null;
  realtimeStatus = 'idle';

  teardownChannels();

  // Local mutation watchers intentionally stay installed so deletions made
  // while signed out/offline are still remembered as durable tombstones.
}

/** Single-flight. Concurrent callers share one in-flight start instead of
 *  each tearing down and re-subscribing the others' realtime channels. This
 *  is the fix for the duplicate-channel race described at the top of this
 *  file. Safe to call from as many places as you like. */
export async function startAutomaticDataSync() {
  if (startInFlight) return startInFlight;
  startInFlight = (async () => {
    try {
      return await doStartAutomaticDataSync();
    } finally {
      startInFlight = null;
    }
  })();
  return startInFlight;
}

async function doStartAutomaticDataSync() {
  ensureLocalMutationWatchers();
  stopAutomaticDataSync();
  const generation = ++syncGeneration;
  const sb = getSupabase();
  const user = await getCurrentAiUser();
  if (!sb || !user) return false;
  if (generation !== syncGeneration) return false;

  autoSyncStarted = true;
  consecutiveFailures = 0;

  attachRealtime(user.id);

  try {
    await fullTwoWaySync();
    consecutiveFailures = 0;
    lastSyncOkAt = Date.now();
    notifyUiOfSync('ok');
  } catch (err) {
    consecutiveFailures += 1;
    notifyUiOfSync('error', err?.message || String(err));
  }
  if (generation !== syncGeneration || !autoSyncStarted) return false;

  const wake = () => { if (autoSyncStarted) syncAfterLocalChange(); };
  const onVisible = () => { if (autoSyncStarted && document.visibilityState === 'visible') syncAfterLocalChange(); };
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);
  // visibilitychange is what actually fires on mobile Safari/Chrome when the
  // user returns to a backgrounded tab; 'focus' alone often does not, which
  // is why phones felt like they never picked up changes made on desktop.
  document.addEventListener('visibilitychange', onVisible);
  wakeCleanup = () => {
    window.removeEventListener('online', wake);
    window.removeEventListener('focus', wake);
    document.removeEventListener('visibilitychange', onVisible);
  };

  schedulePeriodicSync();

  return true;
}

export async function canSyncUserData() {
  const sb = getSupabase();
  if (!sb) return false;
  const user = await getCurrentAiUser();
  return Boolean(user);
}
