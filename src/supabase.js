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
