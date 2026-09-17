// ============================================================================
// src/data-sync.js — Automatic bidirectional cloud sync for Notes & Assignments
// ============================================================================

import { getSupabase } from './supabase.js';
import { getCurrentAiUser } from './ai-history.js';
import { notesManager } from './notes.js';
import { assignmentsManager } from './assignments.js';

const TOMBSTONES_KEY = 'schoolcenter_sync_tombstones_v2';
const SYNC_DEBOUNCE_MS = 300;
const PERIODIC_SYNC_MS = 30000;

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
  if (!sb || !user) throw new Error('Sign in under Settings → AI history account first.');
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
  try { window.dispatchEvent(new CustomEvent('schoolcenter:data-sync-changed', { detail: { type, message } })); } catch (_) {}
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

export async function pullCloudDataToLocal() {
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
    notifyUiOfSync('ok');
  } catch (err) {
    // Surface the failure to the UI instead of swallowing it silently —
    // a missing table/migration or an expired session previously failed
    // here with zero visible feedback, making sync look broken forever.
    notifyUiOfSync('error', err?.message || String(err));
  }
}

function scheduleLocalSync() {
  if (!autoSyncStarted || applyingRemoteChange) return;
  if (localSyncTimer) clearTimeout(localSyncTimer);
  localSyncTimer = setTimeout(() => {
    localSyncTimer = null;
    syncAfterLocalChange();
  }, SYNC_DEBOUNCE_MS);
}

function attachRealtime(userId) {
  const sb = getSupabase();
  if (!sb || !userId) return;

  notesChannel = sb.channel(`school-center-notes-${userId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'user_notes', filter: `user_id=eq.${userId}`
    }, payload => handleRealtime('note', payload).catch(() => {}))
    .subscribe();

  assignmentsChannel = sb.channel(`school-center-assignments-${userId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'user_assignments', filter: `user_id=eq.${userId}`
    }, payload => handleRealtime('assignment', payload).catch(() => {}))
    .subscribe();
}

export function stopAutomaticDataSync() {
  autoSyncStarted = false;
  syncGeneration += 1;
  if (localSyncTimer) clearTimeout(localSyncTimer);
  if (periodicSyncTimer) clearInterval(periodicSyncTimer);
  localSyncTimer = null;
  periodicSyncTimer = null;
  if (wakeCleanup) wakeCleanup();
  wakeCleanup = null;

  const sb = getSupabase();
  if (sb && notesChannel) sb.removeChannel(notesChannel);
  if (sb && assignmentsChannel) sb.removeChannel(assignmentsChannel);
  notesChannel = null;
  assignmentsChannel = null;

  // Local mutation watchers intentionally stay installed so deletions made
  // while signed out/offline are still remembered as durable tombstones.
}

export async function startAutomaticDataSync() {
  ensureLocalMutationWatchers();
  stopAutomaticDataSync();
  const generation = ++syncGeneration;
  const sb = getSupabase();
  const user = await getCurrentAiUser();
  if (!sb || !user) return false;

  autoSyncStarted = true;

  ensureLocalMutationWatchers();
  attachRealtime(user.id);

  try {
    await fullTwoWaySync();
    notifyUiOfSync('ok');
  } catch (err) {
    notifyUiOfSync('error', err?.message || String(err));
  }
  if (generation !== syncGeneration || !autoSyncStarted) return false;

  const wake = () => { if (autoSyncStarted) syncAfterLocalChange(); };
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);
  wakeCleanup = () => {
    window.removeEventListener('online', wake);
    window.removeEventListener('focus', wake);
  };

  periodicSyncTimer = setInterval(() => {
    if (autoSyncStarted) syncAfterLocalChange();
  }, PERIODIC_SYNC_MS);

  return true;
}

export async function canSyncUserData() {
  const sb = getSupabase();
  if (!sb) return false;
  const user = await getCurrentAiUser();
  return Boolean(user);
}
