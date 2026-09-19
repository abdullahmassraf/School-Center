// ============================================================================
// scripts/rls-audit.mjs — Empirical RLS capability probe (read-only intent)
// Verifies what the PUBLIC anon/publishable key can actually do against
// production, using sacrificial rows that are always cleaned up. Never prints
// any credential. Exits non-zero when an unsafe capability is detected.
// ============================================================================
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SB_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// The browser's public key: read from index.html meta tags exactly as the app does.
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const PUBLIC_KEY = html.match(/name="supabase-anon-key"\s+content="([^"]+)"/)?.[1];
if (!SB_URL || !SERVICE_KEY || !PUBLIC_KEY) {
  console.error('FATAL: need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env and the meta tag key in index.html');
  process.exit(2);
}

const anon = createClient(SB_URL, PUBLIC_KEY, { auth: { persistSession: false } });
const admin = createClient(SB_URL, SERVICE_KEY, { auth: { persistSession: false } });

const findings = [];
const note = (t, m) => { findings.push({ t, m }); console.log(`${t === 'ok' ? '✅' : t === 'warn' ? '⚠️ ' : '❌'} ${m}`); };

// ---------------------------------------------------------------------------
// 1. Public READ of course content is intentional (public study site)
// ---------------------------------------------------------------------------
for (const table of ['courses', 'modules', 'materials']) {
  const { error, count } = await anon.from(table).select('*', { count: 'exact', head: true });
  note(error ? 'bad' : 'ok', `${table}: anon SELECT ${error ? `BLOCKED (${error.message})` : `allowed (${count} rows) — intended for public read`}`);
}

// ---------------------------------------------------------------------------
// 2. user_notes / user_assignments must be invisible without a session
// ---------------------------------------------------------------------------
for (const table of ['user_notes', 'user_assignments']) {
  const { data, error } = await anon.from(table).select('*').limit(1);
  const blocked = !!error || (data?.length === 0);
  note(blocked ? 'ok' : 'bad', `${table}: anon SELECT ${blocked ? 'blocked/empty ✒️ (RLS holds)' : 'LEAKED ROWS — RLS IS BROKEN'}`);
}

// ---------------------------------------------------------------------------
// 3. Write capabilities against course content (sacrificial row, cleaned up)
//    Uses a real course id so FK constraints hold.
// ---------------------------------------------------------------------------
const { data: course } = await admin.from('courses').select('id,code').limit(1).single();
if (!course) { console.error('no courses to probe against'); process.exit(2); }

// INSERT into materials via ANON key
const probeTitle = `__rls_probe_${Date.now()}`;
let insertedId = null;
{
  // Need a module id for the FK — use admin to fetch it, anon insert to test.
  const { data: mod } = await admin.from('modules').select('id').eq('course_id', course.id).limit(1).single();
  const { data, error } = await anon.from('materials').insert({
    module_id: mod.id, title: probeTitle, type: 'other', status: 'error', error_message: 'rls-audit sacrificial row'
  }).select('id').single();
  if (error) note('ok', `materials: anon INSERT blocked (${error.message})`);
  else { insertedId = data.id; note('bad', 'materials: anon INSERT ALLOWED — anyone can write course content'); }
}

// UPDATE via anon key (on our own sacrificial row if inserted, else generic)
{
  if (insertedId) {
    const { error } = await anon.from('materials').update({ title: probeTitle + '_x' }).eq('id', insertedId);
    note(error ? 'ok' : 'bad', error ? `materials: anon UPDATE blocked (${error.message})` : 'materials: anon UPDATE ALLOWED — anyone can edit course content');
  } else {
    const { error } = await anon.from('materials').update({ title: '__nope' }).eq('title', 'definitely-not-a-real-title-xyz');
    // 0 rows affected + success is ambiguous; a policy violation errors out.
    note(error ? 'ok' : 'warn', error ? `materials: anon UPDATE blocked (${error.message})` : 'materials: anon UPDATE returned success on 0 rows (policy may still allow writes — review in dashboard)');
  }
}

// DELETE via anon key: only meaningful if we managed to insert a sacrificial row
if (insertedId) {
  const { error } = await anon.from('materials').delete().eq('id', insertedId);
  note(error ? 'ok' : 'bad', error ? `materials: anon DELETE blocked (${error.message})` : 'materials: anon DELETE ALLOWED — anyone can destroy course content');
}

// Storage write probe (sacrificial object, cleaned up)
{
  const path = `${course.code}/__rls_probe_${Date.now()}.txt`;
  const { error } = await anon.storage.from('course-materials').upload(path, new Blob(['rls-audit probe']), { contentType: 'text/plain' });
  if (error) note('ok', `storage: anon UPLOAD blocked (${error.message})`);
  else {
    note('bad', `storage: anon UPLOAD ALLOWED — anyone can write files under ${course.code}/`);
    await admin.storage.from('course-materials').remove([path]);
  }
}

// Cleanup: remove sacrificial DB row if anon delete was blocked
if (insertedId) {
  const { error } = await admin.from('materials').delete().eq('id', insertedId);
  console.log(error ? `⚠️ cleanup failed for ${insertedId}: ${error.message}` : 'sacrificial row cleaned up (admin)');
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------
const unsafe = findings.filter(f => f.t === 'bad');
console.log('\n================ VERDICT ================');
if (unsafe.length) {
  console.log(`❌ ${unsafe.length} unsafe public capability(ies) detected:`);
  unsafe.forEach(f => console.log('  - ' + f.m));
  console.log('\nRecommended minimum model: keep public SELECT on courses/modules/materials;');
  console.log('drop public INSERT/UPDATE/DELETE on course content; require an authenticated');
  console.log('session for in-app uploads (frontend already signs users in for sync).');
  process.exit(1);
}
console.log('✅ No unsafe public write capability detected. Public read-only model holds.');
process.exit(0);
