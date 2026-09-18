// ============================================================================
// src/supabase.js — Supabase Client & Database Service Layer (Fail-Safe)
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

// In-memory fallback if localStorage is blocked by browser security
const memStorage = {};

function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return memStorage[key] || null;
  }
}

function safeSetItem(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch (e) {
    memStorage[key] = val;
  }
}

// Read configuration from meta tags, localStorage, or global env
function getConfig() {
  try {
    const metaUrl = document.querySelector('meta[name="supabase-url"]')?.content;
    const metaKey = document.querySelector('meta[name="supabase-anon-key"]')?.content;

    const url = metaUrl && !metaUrl.includes('YOUR_SUPABASE') 
      ? metaUrl 
      : (safeGetItem('sc_supabase_url') || '');

    const key = metaKey && !metaKey.includes('YOUR_SUPABASE') 
      ? metaKey 
      : (safeGetItem('sc_supabase_anon_key') || '');

    return { url: (url || '').trim(), key: (key || '').trim() };
  } catch (e) {
    console.warn('Error reading Supabase config:', e);
    return { url: '', key: '' };
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
  }
  return client;
}

export function isSupabaseConfigured() {
  const { url, key } = getConfig();
  return Boolean(url && key);
}

export function saveSupabaseConfig(url, key) {
  if (url) safeSetItem('sc_supabase_url', url.trim());
  if (key) safeSetItem('sc_supabase_anon_key', key.trim());
  client = null; // reset so next getSupabase() recreates client
  return getSupabase();
}

/**
 * Fetches all courses with their modules and materials.
 * Gracefully times out after 8s to prevent blocking UI.
 */
export async function fetchCoursesWithMaterials() {
  const sb = getSupabase();
  if (!sb) return null;

  try {
    // Timeout promise after 8 seconds
    const timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Supabase request timed out')), 8000)
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
      .order('code');

    const result = await Promise.race([fetchPromise, timeout]);
    const { data, error } = result;

    if (error) {
      console.warn('Supabase query returned error (using cached/static courses):', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('Supabase network exception or timeout (using offline data):', err.message || err);
    return null;
  }
}

/**
 * Uploads a raw document file to the 'course-materials' Supabase Storage bucket.
 */
export async function uploadCourseFile(courseCode, file) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured.');

  const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `${courseCode}/${Date.now()}_${cleanFileName}`;

  const { data, error } = await sb.storage
    .from('course-materials')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false
    });

  if (error) throw error;

  const { data: publicUrlData } = sb.storage
    .from('course-materials')
    .getPublicUrl(filePath);

  return {
    filePath,
    publicUrl: publicUrlData?.publicUrl || ''
  };
}

/**
 * Inserts a new material record into public.materials.
 */
export async function insertMaterialRecord({ moduleId, title, type, filePath, fileUrl }) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured.');

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
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Invokes the 'process-document' Edge Function for AI processing.
 */
export async function triggerDocumentProcessing(materialId, filePath) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured.');

  const { data, error } = await sb.functions.invoke('process-document', {
    body: { material_id: materialId, file_path: filePath }
  });

  if (error) {
    // Surface the failure to the caller. The upload layer can then keep the
    // actual Storage file usable instead of leaving a permanent "pending"
    // material when the optional processor is unavailable.
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
      .channel('materials-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'materials' },
        (payload) => {
          try { onChange(payload); } catch (e) {}
        }
      )
      .subscribe();

    return channel;
  } catch (err) {
    console.warn('Failed to subscribe to realtime events:', err);
    return null;
  }
}
