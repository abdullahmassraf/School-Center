// ============================================================================
// src/supabase.js — Supabase Client & Database Service Layer (Auth FIXED)
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const FALLBACK_URL = 'https://vxsphvrvulhbyhqmoeex.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4c3BodnJ2dWxoYnlocW1vZWV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1OTI4MjcsImV4cCI6MjEwNTE2ODgyN30.afO1iisTwEwgdQKTTcxEXmzgNRD0io1ptbFK2RZ6Z8w';

let client = null;

export function getSupabase() {
  if (client) return client;

  client = createClient(FALLBACK_URL, FALLBACK_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    },
    realtime: {
      params: { eventsPerSecond: 10 }
    }
  });

  console.log('✅ Supabase connected (auth enabled)');
  return client;
}
