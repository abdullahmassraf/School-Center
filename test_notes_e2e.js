// ============================================================================
// test_notes_e2e.js — TRUE cross-device notes sync verification
// Two independent headless-Chrome profiles ("two devices"), same Supabase
// account. Device A creates a note → cloud → Device B sees it. Device B edits
// it → cloud → Device A sees the update. Exercises the real production path:
// notesManager → data-sync engine → Supabase (user_notes) → realtime/poll.
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the git-ignored .env
// (local test administration only; the key is never printed or transmitted).
// ============================================================================
import 'dotenv/config';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8935;
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error('FATAL: .env missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }

const TEST_EMAIL = `sc-e2e-sync-test+${Date.now()}@abdullahmassraf.dev`;
const TEST_PASS = 'SC-e2e-Sync!92741';
const NOTE_TITLE = `E2E SYNC NOTE ${Date.now()}`;
const EDIT_SUFFIX = ' [edited on device B]';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.resolve(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});
await new Promise(r => server.listen(PORT, r));

// ---------------------------------------------------------------------------
// Admin API: create a confirmed test user (local test administration only)
// ---------------------------------------------------------------------------
async function createTestUser() {
  const res = await fetch(`${SB_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS, email_confirm: true })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`admin createUser failed: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}
const user = await createTestUser();
console.log(`TEST USER: ${TEST_EMAIL} (id ${user.id})`);

// ---------------------------------------------------------------------------
// Minimal CDP driver per "device"
// ---------------------------------------------------------------------------
function launchDevice(name, cdpPort) {
  const userData = path.join(process.env.TEMP || '/tmp', `sc-e2e-${name}-${Date.now()}`);
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userData}`, '--window-size=1280,900', 'about:blank'
  ], { stdio: 'ignore' });
  return { name, proc, userData, cdpPort };
}

async function connectDevice(dev) {
  let target = null;
  for (let i = 0; i < 40; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${dev.cdpPort}/json/list`)).json(); target = list.find(t => t.type === 'page'); if (target) break; } catch (_) {}
    await new Promise(r => setTimeout(r, 250));
  }
  if (!target) throw new Error(`${dev.name}: no CDP target`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  dev.ws = ws;
  let msgId = 0; const pending = new Map(); dev.logs = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.consoleAPICalled') {
      dev.logs.push((msg.params.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description ?? '')).join(' '));
    }
  };
  dev.send = (method, params = {}) => {
    const id = ++msgId;
    return new Promise((res, rej) => {
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP timeout: ' + method)); } }, 30000);
    });
  };
  dev.eval = async expr => {
    const r = await dev.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`${dev.name} eval failed: ${JSON.stringify(r.result.exceptionDetails).slice(0, 300)}`);
    return r.result?.result?.value;
  };
  await dev.send('Runtime.enable');
  await dev.send('Page.enable');
  await dev.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    const len = await dev.eval(`(document.getElementById('app')?.innerHTML || '').length`).catch(() => -1);
    if (len > 100) return;
  }
  throw new Error(`${dev.name}: app did not render`);
}

async function signIn(dev) {
  const ok = await dev.eval(`(async () => {
    const m = await import('/src/ai-history.js');
    try {
      await m.signInAiWithPassword(${JSON.stringify(TEST_EMAIL)}, ${JSON.stringify(TEST_PASS)});
      return 'signed-in';
    } catch (e) { return 'error: ' + (e?.message || e); }
  })()`);
  console.log(`${dev.name}: signIn → ${ok}`);
  if (ok !== 'signed-in') throw new Error(`${dev.name} sign-in failed: ${ok}`);
  // Wait for the app's onAuthStateChange → startAutomaticDataSync() to run.
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const state = await dev.eval(`(async () => {
      const m = await import('/src/data-sync.js');
      const s = m.getDataSyncStatus();
      return JSON.stringify({ running: s.running, realtime: s.realtime, failures: s.consecutiveFailures, signedIn: !!JSON.parse(localStorage.getItem('sb-' + 'vxsphvrvulhbyhqmoeex' + '-auth-token') || 'null')?.user });
    })()`).catch(e => `evalerr ${e.message}`);
    const parsed = (() => { try { return JSON.parse(state); } catch (_) { return null; } })();
    if (parsed?.running) return parsed;
  }
  throw new Error(`${dev.name}: automatic data sync did not start`);
}

async function deviceNoteTitles(dev) {
  const titles = await dev.eval(`(async () => {
    const { notesManager } = await import('/src/notes.js');
    return JSON.stringify(notesManager.getAll().map(n => n.title));
  })()`);
  return JSON.parse(titles);
}

// Direct cloud check (administration only — the browser path is what matters)
async function cloudNoteRows() {
  const res = await fetch(`${SB_URL}/rest/v1/user_notes?select=note_id,updated_at,deleted_at`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
  });
  return res.json();
}
// Rows belonging to THIS test note only (a fresh account also carries the
// app's seeded starter notes pushed on first sign-in — those are legitimate).
async function cloudRowsForTestNote() {
  const res = await fetch(`${SB_URL}/rest/v1/user_notes?select=note_id,updated_at,deleted_at&data->>title=eq.${encodeURIComponent(NOTE_TITLE)}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// Run the two-device scenario
// ---------------------------------------------------------------------------
const failures = [];
const A = launchDevice('deviceA', 9226);
const B = launchDevice('deviceB', 9227);
try {
  await connectDevice(A);
  await connectDevice(B);
  console.log('Both devices booted the real app.');

  const sa = await signIn(A);
  const sbSt = await signIn(B);
  console.log(`DeviceA sync: ${JSON.stringify(sa)} | DeviceB sync: ${JSON.stringify(sbSt)}`);

  // STEP 1 — Device A creates a note (same manager the UI calls)
  await A.eval(`(async () => {
    const { notesManager } = await import('/src/notes.js');
    notesManager.createNote({ title: ${JSON.stringify(NOTE_TITLE)}, content: 'Created on device A for cross-device verification.', courseId: 'math15325d' });
    return true;
  })()`);
  console.log('STEP1: note created on Device A. Waiting for it to reach the cloud…');
  let inCloud = false;
  for (let i = 0; i < 30 && !inCloud; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const rows = await cloudRowsForTestNote();
    inCloud = rows.some(r => r.note_id && !r.deleted_at);
  }
  const rowsAfterCreate = await cloudRowsForTestNote();
  console.log(`STEP1: note row in cloud = ${inCloud} (test-note rows: ${rowsAfterCreate.length})`);
  if (!inCloud) failures.push('note never reached user_notes in the cloud');

  // STEP 2 — Device B must see the note
  let bSees = false;
  for (let i = 0; i < 40 && !bSees; i++) {
    await new Promise(r => setTimeout(r, 1000));
    bSees = (await deviceNoteTitles(B)).includes(NOTE_TITLE);
  }
  console.log(`STEP2: Device B sees the note = ${bSees}`);
  if (!bSees) failures.push('note created on A did not appear on B within 40s');

  // STEP 3 — Device B edits the note; Device A must see the update
  await B.eval(`(async () => {
    const { notesManager } = await import('/src/notes.js');
    const note = notesManager.getAll().find(n => n.title === ${JSON.stringify(NOTE_TITLE)});
    if (!note) return 'note-missing';
    notesManager.updateNote(note.id, { content: (note.content || '') + ${JSON.stringify(EDIT_SUFFIX)} });
    return 'edited';
  })()`);
  console.log('STEP3: Device B edited the note. Waiting for Device A…');
  let aSeesEdit = false;
  for (let i = 0; i < 40 && !aSeesEdit; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const content = await A.eval(`(async () => {
      const { notesManager } = await import('/src/notes.js');
      const n = notesManager.getAll().find(n => n.title === ${JSON.stringify(NOTE_TITLE)});
      return n ? n.content : '';
    })()`).catch(() => '');
    aSeesEdit = String(content).includes(EDIT_SUFFIX);
  }
  console.log(`STEP3: Device A sees B's edit = ${aSeesEdit}`);
  if (!aSeesEdit) failures.push('edit made on B did not appear on A within 40s');

  // STEP 4 — duplicate prevention: the cloud must hold exactly ONE row for
  // this note id (upsert on (user_id, note_id) makes duplicates impossible).
  const finalRows = await cloudRowsForTestNote();
  const dupes = finalRows.length !== 1;
  console.log(`STEP4: cloud rows for the test note = ${finalRows.length} (expect 1) ${dupes ? '❌' : '✅'}`);
  if (dupes) failures.push(`expected 1 cloud row for the test note, found ${finalRows.length}`);

  // Cleanup: soft-delete via A so both devices converge on deletion (real path)
  await A.eval(`(async () => {
    const { notesManager } = await import('/src/notes.js');
    const n = notesManager.getAll().find(n => n.title === ${JSON.stringify(NOTE_TITLE)});
    if (n) notesManager.deleteNote(n.id);
    return true;
  })()`);
} catch (err) {
  failures.push(`harness error: ${err.message}`);
} finally {
  console.log('\n--- Device A console (sync-relevant) ---');
  console.log(A.logs?.filter(l => /sync|error|heal|init/i.test(l)).slice(-8).join('\n') || '(none)');
  console.log('\n--- Device B console (sync-relevant) ---');
  console.log(B.logs?.filter(l => /sync|error|heal|init/i.test(l)).slice(-8).join('\n') || '(none)');

  try { A.ws?.close(); } catch (_) {}
  try { B.ws?.close(); } catch (_) {}
  try { A.proc.kill(); } catch (_) {}
  try { B.proc.kill(); } catch (_) {}
  try { fs.rmSync(A.userData, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(B.userData, { recursive: true, force: true }); } catch (_) {}

  // Remove the test user (admin cleanup; the cloud user_notes rows cascade)
  try {
    await fetch(`${SB_URL}/auth/v1/admin/users?id=${user.id}`, {
      method: 'DELETE', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
    });
    console.log('\nTest user deleted (rows cascade).');
  } catch (_) {}

  server.close();
}

console.log('\n========================================');
if (failures.length) { console.log('❌ E2E SYNC TEST FAILED:\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('✅ E2E SYNC TEST PASSED: A→cloud→B create, B→cloud→A edit, single row (no duplicates).');
process.exit(0);
