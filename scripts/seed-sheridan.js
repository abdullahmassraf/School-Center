// ============================================================================
// scripts/seed-sheridan.js — Automation Seed Script for Sheridan Course Data
// ============================================================================

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// CLI Arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const triggerAi = args.includes('--trigger-ai');

console.log('================================================================');
console.log(' School Center — Sheridan Automated Seeding Pipeline');
console.log(` Mode: ${isDryRun ? '🔍 DRY RUN (Preview only)' : '🚀 LIVE SEED'}`);
console.log(` AI Extraction: ${triggerAi ? 'ENABLED (--trigger-ai)' : 'DISABLED (queue only)'}`);
console.log('================================================================\n');

// Course folder mappings
const COURSE_MAPPINGS = [
  {
    folder: 'Linear Algebra MATH15325D',
    code: 'MATH15325D',
    name: 'Linear Algebra',
    instructor: 'Cyrus Hosseini, PhD PEng',
    color: '#8B7CF6'
  },
  {
    folder: 'Introduction to Energy Systems ENGR36035D',
    code: 'ENGR36035D',
    name: 'Introduction to Energy Systems',
    instructor: 'Dr. Amin',
    color: '#34D1BF'
  },
  {
    folder: 'Engineering Economics and Entrepreneurship ENGR43301D',
    code: 'ENGR43301D',
    name: 'Economics & Entrepreneurship',
    instructor: 'Prof. Stewart',
    color: '#F5A623'
  },
  {
    folder: 'Anthropology of Health ANTH17028GD',
    code: 'ANTH17028GD',
    name: 'Anthropology of Health',
    instructor: 'Jaime Ginter',
    color: '#F0608A'
  },
  {
    folder: 'Composition and Rhetoric ENGL17889GD',
    code: 'ENGL17889GD',
    name: 'Composition & Rhetoric',
    instructor: 'Professor',
    color: '#5FD37A'
  }
];

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB threshold for seeding

// Find Sheridan course base directory
let sheridanBase = path.join(ROOT_DIR, 'Sheridan', 'Sheridan');
if (!fs.existsSync(sheridanBase)) {
  sheridanBase = path.join(ROOT_DIR, 'Sheridan');
}

if (!fs.existsSync(sheridanBase)) {
  console.error(`Error: Could not locate Sheridan directory at: ${sheridanBase}`);
  process.exit(1);
}

// Recursively find files in directory
function getFilesRecursively(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      results = results.concat(getFilesRecursively(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

// Determine file type
function inferMaterialType(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.includes('worksheet') || lower.includes('tutorial') || lower.includes('problem') || lower.includes('assignment')) {
    return 'worksheet';
  } else if (lower.includes('syllabus') || lower.includes('outline')) {
    return 'syllabus';
  } else if (lower.includes('lecture') || lower.includes('week') || lower.includes('note') || lower.includes('chapter')) {
    return 'lecture';
  }
  return 'other';
}

async function runSeed() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!isDryRun && (!supabaseUrl || !supabaseKey || supabaseUrl.includes('your-project'))) {
    console.error('❌ Error: Supabase credentials missing from .env');
    console.error('Please configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
    console.error('Run with --dry-run to preview file parsing without Supabase credentials.\n');
    process.exit(1);
  }

  let supabase = null;
  if (!isDryRun) {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log(`Connected to Supabase at: ${supabaseUrl}\n`);
  }

  let totalDiscovered = 0;
  let totalEligible = 0;
  let totalUploaded = 0;

  for (const mapping of COURSE_MAPPINGS) {
    console.log(`\n────────────────────────────────────────────────────────`);
    console.log(`Course: ${mapping.code} — ${mapping.name}`);
    console.log(`Folder: ${mapping.folder}`);

    const courseDir = path.join(sheridanBase, mapping.folder);
    if (!fs.existsSync(courseDir)) {
      console.warn(`  [!] Folder not found on disk: ${courseDir}`);
      continue;
    }

    const allFiles = getFilesRecursively(courseDir);
    totalDiscovered += allFiles.length;

    // Filter files by type (under size limit).
    // v1.5.1: this whitelist previously only allowed .pdf/.txt/.html/.htm/.docx/.png/.jpg,
    // which silently dropped 57 archive files (all .pptx lectures, .xlsx/.xlsm, .doc,
    // .mlx, .epw/.ddy/.stat, .css/.js, .gif/.jpeg) — the root cause of the v1.5.0 gap.
    // The 'course-materials' bucket has no MIME/size restrictions server-side, so any
    // extension not in MIME_MAP below simply uploads as application/octet-stream.
    // Duplicate material inserts on rerun are now blocked by the unique index
    // uq_materials_file_path (migration 004) instead of creating duplicate rows.
    const eligibleFiles = allFiles.filter(filePath => {
      const ext = path.extname(filePath).toLowerCase();
      const stats = fs.statSync(filePath);
      const isSupportedType = [
        '.pdf', '.txt', '.md', '.html', '.htm', '.doc', '.docx',
        '.ppt', '.pptx', '.xls', '.xlsx', '.xlsm', '.csv',
        '.mlx', '.epw', '.ddy', '.stat',
        '.css', '.js', '.mjs', '.json',
        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'
      ].includes(ext);
      const isUnderLimit = stats.size <= MAX_FILE_SIZE_BYTES;
      return isSupportedType && isUnderLimit;
    });

    totalEligible += eligibleFiles.length;
    console.log(`  Discovered: ${allFiles.length} files | Eligible for AI seed: ${eligibleFiles.length}`);

    if (isDryRun) {
      eligibleFiles.slice(0, 5).forEach(f => {
        const stats = fs.statSync(f);
        const rel = path.relative(courseDir, f);
        console.log(`    • ${rel} (${(stats.size / 1024).toFixed(1)} KB, type: ${inferMaterialType(f)})`);
      });
      if (eligibleFiles.length > 5) {
        console.log(`    ... and ${eligibleFiles.length - 5} more files`);
      }
      continue;
    }

    // 1. Upsert course record
    const { data: courseRecord, error: courseErr } = await supabase
      .from('courses')
      .upsert(
        {
          code: mapping.code,
          name: mapping.name,
          instructor: mapping.instructor,
          color: mapping.color
        },
        { onConflict: 'code' }
      )
      .select()
      .single();

    if (courseErr) {
      console.error(`  ❌ Failed to upsert course ${mapping.code}:`, courseErr.message);
      continue;
    }
    console.log(`  ✓ Course record synced (ID: ${courseRecord.id})`);

    // 2. Upsert default module — use course_id+title as the natural key
    // First try to select existing module, then insert if missing
    let moduleRecord;
    const { data: existingMod } = await supabase
      .from('modules')
      .select()
      .eq('course_id', courseRecord.id)
      .eq('title', 'Course Materials & Readings')
      .maybeSingle();

    if (existingMod) {
      moduleRecord = existingMod;
    } else {
      const { data: newMod, error: modErr } = await supabase
        .from('modules')
        .insert({
          course_id: courseRecord.id,
          title: 'Course Materials & Readings',
          order_index: 0
        })
        .select()
        .single();

      if (modErr) {
        console.error(`  ❌ Failed to create module:`, modErr.message);
        continue;
      }
      moduleRecord = newMod;
    }


    // 3. Upload eligible files & insert materials
    for (const filePath of eligibleFiles) {
      const fileName = path.basename(filePath);
      const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${mapping.code}/${cleanName}`;
      const matType = inferMaterialType(fileName);
      const fileBytes = fs.readFileSync(filePath);

      // Upload to Storage bucket
      const MIME_MAP = {
        '.pdf':  'application/pdf',
        '.txt':  'text/plain',
        '.html': 'text/html',
        '.htm':  'text/html',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.png':  'image/png',
        '.jpg':  'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif':  'image/gif',
        '.webp': 'image/webp',
        '.svg':  'image/svg+xml',
        '.JPG':  'image/jpeg',
        '.JPEG': 'image/jpeg',
        '.PNG':  'image/png',
      };
      const fileExt = path.extname(fileName);
      const contentType = MIME_MAP[fileExt] || 'application/octet-stream';

      const { error: uploadErr } = await supabase.storage
        .from('course-materials')
        .upload(storagePath, fileBytes, {
          upsert: true,
          contentType
        });


      if (uploadErr) {
        console.error(`    ❌ Storage upload failed for ${fileName}:`, uploadErr.message);
        continue;
      }

      const { data: pubData } = supabase.storage
        .from('course-materials')
        .getPublicUrl(storagePath);

      // Insert material record
      const cleanTitle = path.parse(fileName).name.replace(/[-_]/g, ' ');
      const { data: matRecord, error: matErr } = await supabase
        .from('materials')
        .insert([
          {
            module_id: moduleRecord.id,
            title: cleanTitle,
            type: matType,
            file_path: storagePath,
            file_url: pubData?.publicUrl || '',
            status: 'pending'
          }
        ])
        .select()
        .single();

      if (matErr) {
        console.error(`    ❌ Database insert failed for ${fileName}:`, matErr.message);
        continue;
      }

      totalUploaded++;
      console.log(`    ✓ Stored & recorded: ${cleanTitle}`);

      // Trigger AI if requested
      if (triggerAi) {
        try {
          const { error: fnErr } = await supabase.functions.invoke('process-document', {
            body: { material_id: matRecord.id, file_path: storagePath }
          });
          if (fnErr) console.warn(`      ⚠️  AI Edge Function trigger notice: ${fnErr.message}`);
          else console.log(`      ⚡ AI Extraction invoked!`);
        } catch (fnEx) {
          console.warn(`      ⚠️  AI invoke note:`, fnEx.message);
        }
      }
    }
  }

  console.log('\n================================================================');
  console.log(' SEED EXECUTION SUMMARY');
  console.log('================================================================');
  console.log(` Total files discovered: ${totalDiscovered}`);
  console.log(` Total eligible files:   ${totalEligible}`);
  if (!isDryRun) {
    console.log(` Total uploaded to cloud: ${totalUploaded}`);
  }
  console.log('================================================================\n');
}

runSeed().catch(err => {
  console.error('Fatal error during seed execution:', err);
  process.exit(1);
});
