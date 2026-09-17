// ============================================================================
// src/supabase.js — Supabase Client & Database Service Layer
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

// Read configuration from meta tags, localStorage, or global env
function getConfig() {
  const metaUrl = document.querySelector('meta[name="supabase-url"]')?.content;
  const metaKey = document.querySelector('meta[name="supabase-anon-key"]')?.content;

  const url = metaUrl && !metaUrl.includes('YOUR_SUPABASE') 
    ? metaUrl 
    : (localStorage.getItem('sc_supabase_url') || '');

  const key = metaKey && !metaKey.includes('YOUR_SUPABASE') 
    ? metaKey 
    : (localStorage.getItem('sc_supabase_anon_key') || '');

  return { url: url.trim(), key: key.trim() };
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
        }
      });
    } catch (e) {
      console.warn('Failed to initialize Supabase client:', e);
    }
  }
  return client;
}

export function isSupabaseConfigured() {
  const { url, key } = getConfig();
  return Boolean(url && key);
}

export function saveSupabaseConfig(url, key) {
  if (url) localStorage.setItem('sc_supabase_url', url.trim());
  if (key) localStorage.setItem('sc_supabase_anon_key', key.trim());
  client = null; // reset so next getSupabase() recreates client
  return getSupabase();
}

/**
 * Fetches all courses with their modules and materials.
 */
export async function fetchCoursesWithMaterials() {
  const sb = getSupabase();
  if (!sb) return null;

  try {
    const { data, error } = await sb
      .from('courses')
      .select(`
        *,
        modules (
          *,
          materials (*)
        )
      `)
      .order('code');

    if (error) {
      console.error('Error fetching courses from Supabase:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Network exception fetching courses:', err);
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
    console.warn('Edge function direct invocation note:', error);
    // Even if edge function returns non-200, realtime subscription or fallback will track status
  }
  return data;
}

/**
 * Subscribes to real-time status updates on the materials table.
 */
export function subscribeToMaterials(onChange) {
  const sb = getSupabase();
  if (!sb) return null;

  const channel = sb
    .channel('materials-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'materials' },
      (payload) => {
        onChange(payload);
      }
    )
    .subscribe();

  return channel;
}
