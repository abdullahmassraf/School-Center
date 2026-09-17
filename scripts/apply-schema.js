// scripts/apply-schema.js — Push migration SQL to Supabase via Management API
import 'dotenv/config';
import fs from 'fs';

const sql = fs.readFileSync('./supabase/migrations/001_initial_schema.sql', 'utf8');
const projectRef = process.env.SUPABASE_URL
  .replace('https://', '')
  .replace('.supabase.co', '');

console.log('Applying schema to project:', projectRef);
console.log('SQL length:', sql.length, 'chars\n');

// Try via pg-based direct SQL endpoint (Management API)
const res = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({ query: sql })
  }
);

const body = await res.text();
console.log('Status:', res.status);
if (res.ok) {
  console.log('✅ Schema applied successfully!');
} else {
  console.log('❌ Management API failed (this is expected — service role key is not a management API key)');
  console.log('Response:', body.slice(0, 400));
  console.log('\n--- Trying via PostgREST RPC fallback ---\n');

  // PostgREST doesn't support arbitrary DDL, so we need a different approach.
  // Let's try each statement individually via the Supabase SQL API (available in dashboard)
  // For now, let's test if the anon key at least works for reading
}
