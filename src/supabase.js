// ============================================================================
// src/supabase.js — Supabase Client & Database Service Layer (Fail-Safe)
// FIXED: Production config fallback + real error surfacing
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

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

// 🔥 CRITICAL FIX: hard fallback for GitHub Pages
const FALLBACK_URL = 'https://vxsphvrvulhbyhqmoeex.supabase.co';
const FALLBACK_KEY = 'REPLACE_WITH_REAL_ANON_KEY';

function getConfig() {
  try {
    const metaUrl = document.querySelector('meta[name="supabase-url"]')?.content;
    const metaKey = document.querySelector('meta[name="supabase-anon-key"]')?.content;

    const url = metaUrl && !metaUrl.includes('YOUR_SUPABASE')
      ? metaUrl
      : (safeGetItem('sc_supabase_url') || FALLBACK_URL);

    const key = metaKey && !metaKey.includes('YOUR_SUPABASE')
      ? metaKey
      : (safeGetItem('sc_supabase_anon_key') || FALLBACK_KEY);

    return { url: (url || '').trim(), key: (key || '').trim() };
  } catch (e) {
    console.error('Supabase config read error:', e);
    return { url: FALLBACK_URL, key: FALLBACK_KEY };
  }
}

let client = null;

export function getSupabase() {
  if (client) return client;

  const { url, key } = getConfig();

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

export function isSupabaseConfigured() {
  const { url, key } = getConfig();
  return Boolean(url && key);
}

export function saveSupabaseConfig(url, key) {
  if (url) safeSetItem('sc_supabase_url', url.trim());
  if (key) safeSetItem('sc_supabase_anon_key', key.trim());
  client = null;
  return getSupabase();
}

export async function fetchCoursesWithMaterials() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not initialized');

  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Supabase timeout')), 8000)
    );

    const fetchPromise = sb
      .from('courses')
      .select(`*, modules (*, materials (*))`)
      .order('code');

    const result = await Promise.race([fetchPromise, timeout]);
    const { data, error } = result;

    if (error) {
      console.error('❌ Fetch error:', error);
      throw error;
    }

    console.log('✅ Loaded courses:', data?.length || 0);
    return data;
  } catch (err) {
    console.error('❌ Fetch failed:', err);
    throw err;
  }
}

export async function uploadCourseFile(courseCode, file) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not configured');

  const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `${courseCode}/${Date.now()}_${cleanFileName}`;

  const { error } = await sb.storage
    .from('course-materials')
    .upload(filePath, file);

  if (error) {
    console.error('❌ Upload failed:', error);
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
  if (!sb) throw new Error('Supabase not configured');

  const { data, error } = await sb
    .from('materials')
    .insert([payload])
    .select()
    .single();

  if (error) {
    console.error('❌ Insert failed:', error);
    throw error;
  }

  return data;
}

export async function triggerDocumentProcessing(materialId, filePath) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase not configured');

  const { data, error } = await sb.functions.invoke('process-document', {
    body: { material_id: materialId, file_path: filePath }
  });

  if (error) {
    console.error('❌ Processing failed:', error);
    throw error;
  }

  return data;
}

export function subscribeToMaterials(onChange) {
  const sb = getSupabase();
  if (!sb) return null;

  try {
    return sb
      .channel('materials-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'materials' }, onChange)
      .subscribe();
  } catch (err) {
    console.error('❌ Realtime failed:', err);
    return null;
  }
}
