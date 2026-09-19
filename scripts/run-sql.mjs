// ============================================================================
// scripts/run-sql.mjs — apply a SQL file to production via the Supabase
// management API. Credential precedence (both from the git-ignored .env,
// never printed, never committed):
//   1. SUPABASE_ACCESS_TOKEN  (personal access token — can run DDL)
//   2. SUPABASE_SERVICE_ROLE_KEY (runs data SQL via REST but NOT DDL)
// Usage: node scripts/run-sql.mjs <file.sql>
// ============================================================================
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/run-sql.mjs <migrations/005_....sql>'); process.exit(2); }
const filePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', file);
const sql = fs.readFileSync(filePath, 'utf8');

const projectRef = String(process.env.SUPABASE_URL || '')
  .replace('https://', '').replace('.supabase.co', '');
const pat = process.env.SUPABASE_ACCESS_TOKEN;
const key = pat || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!projectRef || !key) { console.error('FATAL: put SUPABASE_URL and (SUPABASE_ACCESS_TOKEN or SUPABASE_SERVICE_ROLE_KEY) in .env'); process.exit(2); }
if (!pat) console.warn('Note: no SUPABASE_ACCESS_TOKEN in .env — DDL (CREATE POLICY etc.) requires one. Add it to .env yourself; never paste secrets into chat.');

console.log(`Applying ${path.basename(filePath)} (${sql.length} chars) to project ${projectRef}…`);
const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({ query: sql })
});
const text = await res.text();
if (res.ok) {
  console.log(`✅ Applied successfully (status ${res.status}).`);
  if (text && text !== '[]' && text !== 'null') console.log('Result:', text.slice(0, 500));
  process.exit(0);
}
console.error(`❌ Failed (status ${res.status}): ${text.slice(0, 600)}`);

// Common failure mode: the account token can't use the legacy query endpoint.
console.error('\nFalling back to the pg-meta SQL endpoint…');
const meta = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/pg-meta/query?verbose=false&inline=all&drop_failures=true`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({ query: sql })
});
const metaText = await meta.text();
if (meta.ok) {
  console.log(`✅ Applied via pg-meta (status ${meta.status}).`);
  if (metaText && metaText !== '[]') console.log('Result:', metaText.slice(0, 500));
  process.exit(0);
}
console.error(`❌ pg-meta also failed (status ${meta.status}): ${metaText.slice(0, 600)}`);
console.error('\nManual fallback: paste the file contents into Supabase Dashboard → SQL Editor and run once.');
process.exit(1);
