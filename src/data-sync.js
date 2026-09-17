// ============================================================================
// src/data-sync.js — Real cross-device sync for Notes & Assignments
// ----------------------------------------------------------------------------
// Notes and assignments were previously localStorage-only, so "Push to Cloud"
// and "Sync from Cloud" in Settings did nothing for them. This module makes
// those buttons real. It reuses the same signed-in identity as the AI-history
// magic-link account (Settings -> AI history account) rather than inventing a
// second login system — sign in with the same email on each device.
// ============================================================================

import { getSupabase } from './supabase.js';
import { getCurrentAiUser } from './ai-history.js';
import { notesManager } from './notes.js';
import { assignmentsManager } from './assignments.js';

async function requireCloudIdentity() {
  const sb = getSupabase();
  const user = await getCurrentAiUser();
  if (!sb || !user) {
    throw new Error('Sign in under Settings → AI history account first, then sync will carry your notes and assignments across devices.');
  }
  return { sb, user };
}

async function upsertRows(table, idField, items) {
  if (!items.length) return;
  const { sb, user } = await requireCloudIdentity();
  const rows = items.map(item => ({
    user_id: user.id,
    [idField]: item.id,
    data: item,
    updated_at: new Date(item.updatedAt || Date.now()).toISOString()
  }));
  const { error } = await sb.from(table).upsert(rows, { onConflict: `user_id,${idField}` });
  if (error) throw error;
}

async function fetchRows(table) {
  const { sb, user } = await requireCloudIdentity();
  const { data, error } = await sb.from(table).select('*').eq('user_id', user.id);
  if (error) throw error;
  return data || [];
}

/** Upload every local note/assignment to the cloud (last-write-wins by id). */
export async function pushLocalDataToCloud() {
  await upsertRows('user_notes', 'note_id', notesManager.getAll());
  await upsertRows('user_assignments', 'assignment_id', assignmentsManager.getAll());
}

/** Pull cloud notes/assignments down and merge them into local state, newest wins. */
export async function pullCloudDataToLocal() {
  const [noteRows, assignmentRows] = await Promise.all([
    fetchRows('user_notes'),
    fetchRows('user_assignments')
  ]);
  notesManager.mergeCloudRecords(noteRows.map(r => ({
    id: r.note_id, data: r.data, updatedAt: new Date(r.updated_at).getTime()
  })));
  assignmentsManager.mergeCloudRecords(assignmentRows.map(r => ({
    id: r.assignment_id, data: r.data, updatedAt: new Date(r.updated_at).getTime()
  })));
}

/**
 * Pull first (so we don't clobber edits made on another device), then push —
 * this is what "Sync now" / "Push to Cloud" / signing in on a new device runs.
 */
export async function fullTwoWaySync() {
  await pullCloudDataToLocal().catch(() => {});
  await pushLocalDataToCloud();
}

/** True once a Supabase session + cloud config both exist. */
export async function canSyncUserData() {
  const sb = getSupabase();
  if (!sb) return false;
  const user = await getCurrentAiUser();
  return Boolean(user);
}
