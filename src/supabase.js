// ============================================================================
// src/supabase.js — Supabase Client & Database Service Layer
// School Center v0.9.9 — boot/auth stabilization
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const FALLBACK_URL = 'https://vxsphvrvulhbyhqmoeex.supabase.co';
// Public client key fallback. index.html can override this through the
// supabase-anon-key meta tag, and Settings can override it through localStorage.
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4c3BodnJ2d2xodnlxZXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1OTI4MjcsImV4cCI6MjEwNTE2ODgyN30.afO1iisTwEwgdQKTTcxEXmzgNRD0io1ptbFK2RZ6Z8w';

const memoryStorage = Object.create(null);

function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return memoryStorage[key] || null;
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_) {
    memoryStorage[key] = value;
  }
}

function getConfig() {
  try {
    const metaUrl = document.querySelector('meta[name="supabase-url"]')?.content?.trim();
    const metaKey = document.querySelector('meta[name="supabase-anon-key"]')?.content?.trim();

    const url = (metaUrl && !metaUrl.includes('YOUR_SUPABASE'))
      ? metaUrl
      : (safeGetItem('sc_supabase_url') || FALLBACK_URL);

    const key = (metaKey && !metaKey.includes('YOUR_SUPABASE'))
      ? metaKey
      : (safeGetItem('sc_supabase_anon_key') || FALLBACK_KEY);

    return {
      url: String(url || '').trim(),
      key: String(key || '').trim()
    };
  } catch (error) {
    console.error('Supabase config read error:', error);
    return { url: FALLBACK_URL, key: FALLBACK_KEY };
  }
}

// Config baked into the deployed index.html. A device that once saved an
// older or different key under sc_supabase_anon_key keeps overriding this
// good default forever (localStorage wins in getConfig), which is how a
// rotated Supabase key turned into a permanent "materials will not load"
// state on already-visited devices.
function getDeployedConfig() {
  try {
    return {
      url: document.querySelector('meta[name="supabase-url"]')?.content?.trim() || FALLBACK_URL,
      key: document.querySelector('meta[name="supabase-anon-key"]')?.content?.trim() || FALLBACK_KEY
    };
  } catch (_) {
    return { url: FALLBACK_URL, key: FALLBACK_KEY };
  }
}

let client = null;

export function getSupabase() {
  if (client) return client;

  const { url, key } = getConfig();

  if (!url || !key || key.includes('REPLACE_WITH')) {
    console.error('❌ Supabase is not configured.');
    return null;
  }

  try {
    client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce'
      },
      realtime: {
        params: { eventsPerSecond: 10 }
      }
    });

    console.log('✅ Supabase client initialized:', url);
    return client;
  } catch (error) {
    console.error('❌ Supabase client initialization failed:', error);
    client = null;
    return null;
  }
}

/** Detect Supabase auth/config failures: bad or rotated API key, expired or
 * malformed JWT, 401 responses. Accepts raw error objects AND the display
 * strings the app stores in state.materialsSyncError ("Cloud error: Invalid
 * API key"), because the self-heal check reads that state string.
 * These are recoverable by rebuilding the client from the deployed defaults
 * and clearing dead local session state. */
export function isAuthError(err) {
  if (!err) return false;
  let status = null;
  let text = '';
  if (typeof err === 'string') {
    text = err.toLowerCase();
  } else {
    status = err.status || err.statusCode || err.code;
    text = String(err.message || err.error_description || err.msg || '').toLowerCase();
  }
  if (status === 401 || status === '401') return true;
  return text.includes('invalid api key')
    || text.includes('no api key found')
    || (text.includes('jwt') && (text.includes('expired') || text.includes('invalid') || text.includes('malformed')));
}

/** Re-fetch the app's own index.html from the origin (bypassing the browser
 * cache) and re-read the deployed Supabase meta tags from it. A device that
 * is still holding a stale cached index.html — for example one carrying the
 * retired JWT anon key in its meta tag — keeps 401-ing no matter how many
 * times the user hits retry, because the cached meta wins in getConfig.
 * Returns true when the live DOM config differed from origin and was
 * repaired. */
export async function repairConfigFromOrigin() {
  let changed = false;
  try {
    // Hard 6s cap: a captive portal or dead network must not stall the heal.
    const res = await fetch(window.location.href, {
      cache: 'reload',
      signal: AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined
    });
    if (res.ok) {
      const html = await res.text();
      const urlMatch = html.match(/<meta[^>]+name=["']supabase-url["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']supabase-url["']/i);
      const keyMatch = html.match(/<meta[^>]+name=["']supabase-anon-key["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']supabase-anon-key["']/i);
      const freshUrl = urlMatch?.[1]?.trim();
      const freshKey = keyMatch?.[1]?.trim();
      const setMeta = (name, value) => {
        if (!value) return;
        let el = document.querySelector(`meta[name="${name}"]`);
        if (!el) {
          el = document.createElement('meta');
          el.setAttribute('name', name);
          document.head.appendChild(el);
        }
        if (el.getAttribute('content') !== value) {
          el.setAttribute('content', value);
          changed = true;
        }
      };
      setMeta('supabase-url', freshUrl);
      setMeta('supabase-anon-key', freshKey);
    }
  } catch (_) {}
  if (changed) client = null; // force a rebuild with the repaired config
  return changed;
}

/** Clear dead cloud session/config state and force the next getSupabase()
 * call to rebuild the client. purgeStoredConfig removes a saved
 * sc_supabase_anon_key / sc_supabase_url when they differ from the deployed
 * defaults (or look like a retired JWT key), so a poisoned override cannot
 * survive a reload. Sign-out and legacy supabase-js session keys are always
 * cleared so a stale session from a previous project cannot block queries. */
export async function resetSupabaseAuthState({ purgeStoredConfig = false } = {}) {
  // Deliberately NO client.signOut() here. Against a dead/misconfigured
  // project, signOut cannot reach the auth server, and its internal
  // navigator-lock acquisition can hang — which then deadlocks every query
  // of the rebuilt client (same storageKey lock). The localStorage sweep
  // below fully forgets the dead session locally, which is the part that
  // actually unblocks the app; server-side revocation is a no-op anyway
  // when the key/URL is retired.
  let legacyCount = 0;
  try {
    const legacyKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.includes('-auth-token')) legacyKeys.push(k);
    }
    legacyKeys.forEach(k => {
      try { localStorage.removeItem(k); } catch (_) {}
    });
    legacyCount = legacyKeys.length;
  } catch (_) {}
  console.warn(`[self-heal] session cleared (legacy tokens removed: ${legacyCount})`);
  if (purgeStoredConfig) {
    // Repair the live meta config from origin FIRST, so the purge below
    // compares against what the site actually deploys today (not what a
    // stale cached index.html claims).
    let repaired = false;
    try {
      repaired = await Promise.race([
        repairConfigFromOrigin(),
        new Promise(resolve => setTimeout(() => resolve(false), 7000))
      ]);
    } catch (_) {}
    console.warn(`[self-heal] origin config repair applied: ${repaired}`);
    try {
      const deployed = getDeployedConfig();
      const storedUrl = localStorage.getItem('sc_supabase_url');
      const storedKey = localStorage.getItem('sc_supabase_anon_key');
      console.warn(`[self-heal] stored key present: ${!!storedKey}, differs from origin: ${storedKey !== deployed.key}`);
      if (storedKey && (storedKey !== deployed.key || storedKey.startsWith('eyJ'))) {
        localStorage.removeItem('sc_supabase_anon_key');
      }
      if (storedUrl && storedUrl !== deployed.url) {
        localStorage.removeItem('sc_supabase_url');
      }
    } catch (_) {}
    // Kill the materials realtime channel bound to the dead client —
    // otherwise it reconnects (and errors) forever on the retired key.
    if (materialsChannel && sb) {
      try { await sb.removeChannel(materialsChannel); } catch (_) {}
      materialsChannel = null;
    }
    client = null; // force a rebuild with the deployed defaults
    console.warn('[self-heal] client reset complete — rebuilding from origin config');
  }
}

export function isSupabaseConfigured() {
  const { url, key } = getConfig();
  return Boolean(url && key && !key.includes('REPLACE_WITH'));
}

export function saveSupabaseConfig(url, key) {
  if (url) safeSetItem('sc_supabase_url', String(url).trim());
  if (key) safeSetItem('sc_supabase_anon_key', String(key).trim());

  client = null;
  return getSupabase();
}

export async function fetchCoursesWithMaterials() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not initialized.');

  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Supabase request timed out.')), 10000);
  });

  const request = sb
    .from('courses')
    .select('*, modules (*, materials (*))')
    .order('code');

  const { data, error } = await Promise.race([request, timeout]);

  if (error) {
    console.error('❌ Course/material fetch failed:', error);
    throw error;
  }

  return data || [];
}

export async function uploadCourseFile(courseCode, file) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured.');

  if (!courseCode) throw new Error('A course code is required.');
  if (!file) throw new Error('No file was supplied.');

  const cleanCourseCode = String(courseCode).replace(/[^a-zA-Z0-9_-]/g, '');
  const cleanFileName = String(file.name || 'upload')
    .replace(/[^a-zA-Z0-9._-]/g, '_');

  const filePath = `${cleanCourseCode}/${Date.now()}_${cleanFileName}`;

  const { error } = await sb.storage
    .from('course-materials')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream'
    });

  if (error) {
    console.error('❌ Course file upload failed:', error);
    throw error;
  }

  const { data } = sb.storage
    .from('course-materials')
    .getPublicUrl(filePath);

  return {
    filePath,
    publicUrl: data?.publicUrl || ''
  };
}

export async function insertMaterialRecord(payload) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured.');
  if (!payload?.moduleId && !payload?.module_id) {
    throw new Error('A module ID is required for a material record.');
  }

  const row = {
    ...payload,
    module_id: payload.module_id || payload.moduleId,
    title: payload.title || 'Untitled material',
    type: payload.type || 'other',
    file_path: payload.file_path || payload.filePath || null,
    file_url: payload.file_url || payload.fileUrl || null,
    status: payload.status || 'pending',
    updated_at: payload.updated_at || new Date().toISOString()
  };

  delete row.moduleId;
  delete row.filePath;
  delete row.fileUrl;

  const { data, error } = await sb
    .from('materials')
    .insert(row)
    .select()
    .single();

  if (error) {
    console.error('❌ Material record insert failed:', error);
    throw error;
  }

  return data;
}

export async function triggerDocumentProcessing(materialId, filePath) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured.');

  const { data, error } = await sb.functions.invoke('process-document', {
    body: {
      material_id: materialId,
      file_path: filePath
    }
  });

  if (error) {
    console.error('❌ Document processing function failed:', error);
    throw error;
  }

  return data;
}

let materialsChannel = null;

export function subscribeToMaterials(onChange) {
  const sb = getSupabase();
  if (!sb || typeof onChange !== 'function') return null;

  if (materialsChannel) {
    try { sb.removeChannel(materialsChannel); } catch (_) {}
    materialsChannel = null;
  }

  try {
    materialsChannel = sb
      .channel('school-center-materials')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'materials'
        },
        payload => {
          try {
            onChange(payload);
          } catch (error) {
            console.error('Material realtime handler failed:', error);
          }
        }
      )
      .subscribe((status, error) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('Material realtime degraded:', status, error);
        }
      });

    return materialsChannel;
  } catch (error) {
    console.error('❌ Material realtime initialization failed:', error);
    materialsChannel = null;
    return null;
  }
}
