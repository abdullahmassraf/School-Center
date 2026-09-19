#!/usr/bin/env node
/**
 * seed-sheridan-gap.mjs — idempotent gap-fill for the Sheridan archive.
 *
 * WHY THIS EXISTS
 * Live inspection (2026-09-18) found 139 materials in production but 187 unique
 * files in Sheridan/. 50 were never ingested; every one has an extension in the
 * set .pptx .xlsx .xlsm .doc .mlx .epw .ddy .stat .css .js .gif .jpeg. The
 * `course-materials` bucket has no MIME/size restriction, so the exclusion was
 * client-side. This script ingests exactly that gap and nothing else.
 *
 * SAFETY PROPERTIES
 *  - Never deletes or overwrites: existing storage objects and rows are skipped.
 *  - Idempotent: keyed on the final storage path; safe to rerun any number of times.
 *  - Storage upload happens BEFORE the row insert, so a row can never point at
 *    a missing object. A crash between the two leaves an orphan object (harmless,
 *    and healed on the next run, which inserts the missing row).
 *  - Collision-safe: files whose flat name collides get a deterministic
 *    content-hash suffix instead of overwriting each other.
 *  - Default mode is DRY RUN. Pass --apply to write.
 *  - The service-role key is read from the environment only. Never commit it.
 *
 * USAGE (run from the repo root, the folder containing Sheridan/)
 *   SUPABASE_URL=https://vxsphvrvulhbyhqmoeex.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/seed-sheridan-gap.mjs            # dry run, prints the plan
 *   node scripts/seed-sheridan-gap.mjs --apply    # performs the writes
 *
 * Requires Node 18+ and `@supabase/supabase-js` (already a project dependency).
 */
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep, extname, basename } from 'node:path';

const APPLY = process.argv.includes('--apply');
const ROOT = process.env.SHERIDAN_DIR || 'Sheridan';
const BUCKET = 'course-materials';
const CONCURRENCY = 4;
const MAX_BYTES = 50 * 1024 * 1024; // refuse anything larger than 50 MB

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  process.exit(2);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

// Explicit MIME map. Unknown types fall back to octet-stream rather than guessing.
const MIME = {
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.html': 'text/html', '.htm': 'text/html',
  '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
};

// Same sanitizer production paths were built with (verified against 139 live rows).
const sanitize = (n) => n.replace(/[^A-Za-z0-9._\-]/g, '_');
const courseCode = (folder) => (folder.match(/\b([A-Z]{4}\d{5}[A-Z]{1,2})\s*$/) || [])[1] || null;
const titleOf = (fn) => basename(fn, extname(fn)).replace(/[_]+/g, ' ').trim();
const typeOf = (fn) => {
  const l = fn.toLowerCase();
  if (/worksheet|tutorial|lab report|rubric|template|problems|review/.test(l)) return 'worksheet';
  if (/\.(pptx|pdf)$/.test(l) && /module|chapter|lecture|powerpoint|ppt/.test(l)) return 'lecture';
  return 'other';
};

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const sha = async (p) => createHash('sha256').update(await readFile(p)).digest('hex');

async function main() {
  // 1. Existing state (source of truth): which storage paths and rows already exist.
  const { data: courses, error: ce } = await sb.from('courses').select('id, code');
  if (ce) throw new Error(`courses query failed: ${ce.message}`);
  const courseByCode = new Map(courses.map((c) => [c.code, c.id]));

  const { data: mods, error: me } = await sb.from('modules').select('id, course_id, order_index').order('order_index');
  if (me) throw new Error(`modules query failed: ${me.message}`);
  const moduleByCourse = new Map();
  for (const m of mods) if (!moduleByCourse.has(m.course_id)) moduleByCourse.set(m.course_id, m.id);

  const existing = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('materials').select('file_path').range(from, from + 999);
    if (error) throw new Error(`materials query failed: ${error.message}`);
    data.forEach((r) => r.file_path && existing.add(r.file_path));
    if (data.length < 1000) break;
  }

  // 2. Build the plan from the local archive.
  const abs = await walk(ROOT);
  const items = [];
  for (const full of abs) {
    const rel = relative(ROOT, full).split(sep);
    const code = courseCode(rel[0]);
    if (!code) continue;
    items.push({ full, code, rel: rel.slice(1).join('/'), name: rel[rel.length - 1] });
  }

  // Group by flat key to detect collisions deterministically.
  const groups = new Map();
  for (const it of items) {
    const k = `${it.code}/${sanitize(it.name)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }

  const plan = [];
  for (const [flatKey, members] of groups) {
    // Distinct contents under one flat key: identical files dedupe to one; differing
    // files each get a hash suffix so none overwrite another.
    const seen = new Map();
    for (const m of members) {
      m.sha = await sha(m.full);
      if (!seen.has(m.sha)) seen.set(m.sha, m);
    }
    const distinct = [...seen.values()];
    for (const m of distinct) {
      const path = distinct.length === 1
        ? flatKey
        : flatKey.replace(/(\.[^./]+)?$/, `__${m.sha.slice(0, 8)}$1`);
      if (existing.has(path)) continue; // already ingested -> skip (idempotent)
      const size = (await stat(m.full)).size;
      plan.push({ ...m, path, size, mime: MIME[extname(m.name).toLowerCase()] || 'application/octet-stream' });
    }
  }

  // 3. Validate before touching anything.
  const problems = [];
  for (const p of plan) {
    if (!courseByCode.has(p.code)) problems.push(`no course record for ${p.code}: ${p.rel}`);
    else if (!moduleByCourse.has(courseByCode.get(p.code))) problems.push(`no module for ${p.code}`);
    if (p.size > MAX_BYTES) problems.push(`too large (${(p.size / 1e6).toFixed(1)} MB): ${p.rel}`);
    if (p.size === 0) problems.push(`empty file: ${p.rel}`);
  }

  const perCourse = {};
  plan.forEach((p) => { perCourse[p.code] = (perCourse[p.code] || 0) + 1; });
  console.log(`\nExisting rows: ${existing.size}   Local unique files: ${groups.size}   To ingest: ${plan.length}`);
  console.log('By course:', perCourse);
  if (problems.length) { console.error('\nPlan REFUSED — fix these first:\n  ' + problems.join('\n  ')); process.exit(1); }
  if (!APPLY) { plan.forEach((p) => console.log('  +', p.path, `(${p.mime})`)); console.log('\nDRY RUN — nothing written. Re-run with --apply.'); return; }

  // 4. Apply with bounded concurrency; report exactly what succeeded and failed.
  const ok = []; const failed = [];
  let i = 0;
  async function worker() {
    while (i < plan.length) {
      const p = plan[i++];
      try {
        const buf = await readFile(p.full);
        // upsert:false -> never overwrite. "already exists" is treated as success (healing a prior partial run).
        const up = await sb.storage.from(BUCKET).upload(p.path, buf, { contentType: p.mime, upsert: false });
        if (up.error && !/already exists|Duplicate/i.test(up.error.message)) throw new Error(`upload: ${up.error.message}`);
        const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(p.path);
        const { error: ie } = await sb.from('materials').insert({
          module_id: moduleByCourse.get(courseByCode.get(p.code)),
          title: titleOf(p.name), type: typeOf(p.name),
          file_path: p.path, file_url: pub.publicUrl,
          status: 'completed', created_by: 'seed-sheridan-gap',
        });
        // 23505 = unique_violation from uq_materials_file_path: another run already inserted
        // this row. That is the desired end state, so count it as success, not failure.
        if (ie && ie.code !== '23505') throw new Error(`insert: ${ie.message}`);
        ok.push(p.path);
      } catch (e) { failed.push({ path: p.path, error: e.message }); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\nSucceeded: ${ok.length}   Failed: ${failed.length}`);
  failed.forEach((f) => console.error(`  ✗ ${f.path} — ${f.error}`));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
