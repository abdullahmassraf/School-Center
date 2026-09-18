// ============================================================================
// src/supabase.js — Supabase Client & Database Service Layer (Fail-Safe)
// FIXED: Production config fallback + real error surfacing
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

// In-memory fallback if localStorage is blocked by browser security
const memStorage = {};

function safeGetItem(key) {
@@ -23,50 +23,54 @@ function safeSetItem(key, val) {
}
}

// Read configuration from meta tags, localStorage, or global env
// 🔥 CRITICAL FIX: hard fallback for GitHub Pages
const FALLBACK_URL = 'https://vxsphvrvulhbyhqmoeex.supabase.co';
const FALLBACK_KEY = 'REPLACE_WITH_REAL_ANON_KEY';

function getConfig() {
try {
const metaUrl = document.querySelector('meta[name="supabase-url"]')?.content;
const metaKey = document.querySelector('meta[name="supabase-anon-key"]')?.content;

    const url = metaUrl && !metaUrl.includes('YOUR_SUPABASE') 
      ? metaUrl 
      : (safeGetItem('sc_supabase_url') || '');
    const url = metaUrl && !metaUrl.includes('YOUR_SUPABASE')
      ? metaUrl
      : (safeGetItem('sc_supabase_url') || FALLBACK_URL);

    const key = metaKey && !metaKey.includes('YOUR_SUPABASE') 
      ? metaKey 
      : (safeGetItem('sc_supabase_anon_key') || '');
    const key = metaKey && !metaKey.includes('YOUR_SUPABASE')
      ? metaKey
      : (safeGetItem('sc_supabase_anon_key') || FALLBACK_KEY);

return { url: (url || '').trim(), key: (key || '').trim() };
} catch (e) {
    console.warn('Error reading Supabase config:', e);
    return { url: '', key: '' };
    console.error('Supabase config read error:', e);
    return { url: FALLBACK_URL, key: FALLBACK_KEY };
}
}

let client = null;

export function getSupabase() {
if (client) return client;

const { url, key } = getConfig();
  if (url && key) {
    try {
      client = createClient(url, key, {
        realtime: {
          params: {
            eventsPerSecond: 10
          }
        },
        auth: {
          persistSession: true,
          autoRefreshToken: true
        }
      });
    } catch (e) {
      console.warn('Failed to initialize Supabase client (using offline fallback):', e);
      client = null;
    }

  if (!url || !key) {
    console.error('❌ Supabase NOT configured — app offline');
    return null;
}

  try {
    client = createClient(url, key, {
      realtime: { params: { eventsPerSecond: 10 } },
      auth: { persistSession: true, autoRefreshToken: true }
    });

    console.log('✅ Supabase connected:', url);
  } catch (e) {
    console.error('❌ Supabase init failed:', e);
    client = null;
  }

return client;
}

@@ -78,146 +82,111 @@ export function isSupabaseConfigured() {
export function saveSupabaseConfig(url, key) {
if (url) safeSetItem('sc_supabase_url', url.trim());
if (key) safeSetItem('sc_supabase_anon_key', key.trim());
  client = null; // reset so next getSupabase() recreates client
  client = null;
return getSupabase();
}

/**
 * Fetches all courses with their modules and materials.
 * Gracefully times out after 8s to prevent blocking UI.
 */
export async function fetchCoursesWithMaterials() {
const sb = getSupabase();
  if (!sb) return null;
  if (!sb) throw new Error('Supabase not initialized');

try {
    // Timeout promise after 8 seconds
    const timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Supabase request timed out')), 8000)
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Supabase timeout')), 8000)
);

const fetchPromise = sb
.from('courses')
      .select(`
        *,
        modules (
          *,
          materials (*)
        )
      `)
      .select(`*, modules (*, materials (*))`)
.order('code');

const result = await Promise.race([fetchPromise, timeout]);
const { data, error } = result;

if (error) {
      console.warn('Supabase query returned error (using cached/static courses):', error.message);
      return null;
      console.error('❌ Fetch error:', error);
      throw error;
}

    console.log('✅ Loaded courses:', data?.length || 0);
return data;
} catch (err) {
    console.warn('Supabase network exception or timeout (using offline data):', err.message || err);
    return null;
    console.error('❌ Fetch failed:', err);
    throw err;
}
}

/**
 * Uploads a raw document file to the 'course-materials' Supabase Storage bucket.
 */
export async function uploadCourseFile(courseCode, file) {
const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured.');
  if (!sb) throw new Error('Supabase not configured');

const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
const filePath = `${courseCode}/${Date.now()}_${cleanFileName}`;

  const { data, error } = await sb.storage
  const { error } = await sb.storage
.from('course-materials')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false
    });
    .upload(filePath, file);

  if (error) throw error;
  if (error) {
    console.error('❌ Upload failed:', error);
    throw error;
  }

  const { data: publicUrlData } = sb.storage
  const { data } = sb.storage
.from('course-materials')
.getPublicUrl(filePath);

return {
filePath,
    publicUrl: publicUrlData?.publicUrl || ''
    publicUrl: data?.publicUrl || ''
};
}

/**
 * Inserts a new material record into public.materials.
 */
export async function insertMaterialRecord({ moduleId, title, type, filePath, fileUrl }) {
export async function insertMaterialRecord(payload) {
const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured.');
  if (!sb) throw new Error('Supabase not configured');

const { data, error } = await sb
.from('materials')
    .insert([
      {
        module_id: moduleId,
        title,
        type: type || 'other',
        file_path: filePath,
        file_url: fileUrl,
        status: 'pending'
      }
    ])
    .insert([payload])
.select()
.single();

  if (error) throw error;
  if (error) {
    console.error('❌ Insert failed:', error);
    throw error;
  }

return data;
}

/**
 * Invokes the 'process-document' Edge Function for AI processing.
 */
export async function triggerDocumentProcessing(materialId, filePath) {
const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured.');
  if (!sb) throw new Error('Supabase not configured');

const { data, error } = await sb.functions.invoke('process-document', {
body: { material_id: materialId, file_path: filePath }
});

if (error) {
    // Surface the failure to the caller. The upload layer can then keep the
    // actual Storage file usable instead of leaving a permanent "pending"
    // material when the optional processor is unavailable.
    console.error('❌ Processing failed:', error);
throw error;
}

return data;
}

/**
 * Subscribes to real-time status updates on the materials table.
 */
export function subscribeToMaterials(onChange) {
const sb = getSupabase();
if (!sb) return null;

try {
    const channel = sb
    return sb
.channel('materials-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'materials' },
        (payload) => {
          try { onChange(payload); } catch (e) {}
        }
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'materials' }, onChange)
.subscribe();

    return channel;
} catch (err) {
    console.warn('Failed to subscribe to realtime events:', err);
    console.error('❌ Realtime failed:', err);
return null;
}
}
