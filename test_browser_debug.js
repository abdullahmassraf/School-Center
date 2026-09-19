// Headless-Chrome debug harness for School Center course materials issue.
// Boots the real app (index.html) with real production Supabase credentials
// from index.html, navigates to Courses -> first course -> Materials tab,
// and reports what actually rendered.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8931;
// SC_TARGET_URL lets the harness point at the deployed GitHub Pages site so the
// live deployment itself can be verified end-to-end (not just local files).
const TARGET_URL = process.env.SC_TARGET_URL || `http://127.0.0.1:${PORT}/index.html`;
const IS_LOCAL = !process.env.SC_TARGET_URL;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const USER_DATA = path.join(process.env.TEMP || '/tmp', 'sc-debug-profile-' + Date.now());
const DEBUG_PORT = 9223;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  if (!IS_LOCAL) return res.end('remote mode: local server unused');
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.resolve(path.join(ROOT, urlPath));
  const allowed = filePath === ROOT || filePath.startsWith(ROOT + path.sep);
  console.log('SRV:', req.method, urlPath, '->', allowed && fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory() ? 'OK' : '404');
  if (!allowed || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});
await new Promise(r => server.listen(PORT, r));

// Self-test: confirm the server actually serves index.html content
if (IS_LOCAL) {
  const selfTest = await fetch(`http://127.0.0.1:${PORT}/index.html`).then(r => r.text());
  console.log('SELF-TEST: index.html length =', selfTest.length, '| has script tag:', selfTest.includes('src/app.js'));
}

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${USER_DATA}`,
  '--window-size=1280,900', 'about:blank'
], { stdio: 'ignore' });

const CDP_URL = `http://127.0.0.1:${DEBUG_PORT}`;
let target = null;
for (let i = 0; i < 40; i++) {
  try {
    const list = await (await fetch(`${CDP_URL}/json/list`)).json();
    target = list.find(t => t.type === 'page');
    if (target) break;
  } catch (_) {}
  await new Promise(r => setTimeout(r, 250));
}
if (!target) { console.error('FATAL: no CDP page target'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const consoleLogs = [];
const pageErrors = [];

ws.onmessage = ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args || []).map(a => {
      if (a.value !== undefined) return typeof a.value === 'object' ? JSON.stringify(a.value) : String(a.value);
      if (a.preview?.properties) return '{' + a.preview.properties.map(p => `${p.name}: ${String(p.value).slice(0, 120)}`).join(', ') + '}';
      return a.description ?? '';
    }).join(' ');
    consoleLogs.push(`[${msg.params.type}] ${text}`);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    pageErrors.push(`${d.text} ${d.exception?.description || ''}`);
  } else if (msg.method === 'Network.loadingFailed') {
    pageErrors.push(`NETWORK FAIL: ${msg.params.errorText} (${msg.params.type})`);
  }
};

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP timeout: ' + method)); } }, 20000);
  });
}

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('Eval failed: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result?.result?.value;
}

await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');

// Optional poisoned-device simulation: SC_POISON=1 seeds the exact failure
// state an older device would have — the retired JWT anon key saved in
// localStorage (it overrides the good deployed key and 401s every query).
if (process.env.SC_POISON === '1' || process.env.SC_STALE === '1') {
  const deadKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4c3BodnJ2d2xodnlxZXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1OTI4MjcsImV4cCI6MjEwNTE2ODgyN30.afO1iisTwEwgdQKTTcxEXmzgNRD0io1ptbFK2RZ6Z8w';
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try{localStorage.setItem('sc_supabase_anon_key', ${JSON.stringify(deadKey)});}catch(e){}`
  });
  console.log('POISON MODE: seeded retired JWT key into localStorage before app boot');
}
if (process.env.SC_STALE === '1') {
  // Simulate a browser-cached OLD index.html: rewrite the live DOM meta tags
  // to the retired JWT key the moment the parser creates them (MutationObserver,
  // because at document-start the <head> meta tags do not exist yet).
  const deadKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4c3BodnJ2d2xodnlxZXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1OTI4MjcsImV4cCI6MjEwNTE2ODgyN30.afO1iisTwEwgdQKTTcxEXmzgNRD0io1ptbFK2RZ6Z8w';
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){var dead=${JSON.stringify(deadKey)};var done=false;var obs=null;function rw(){if(done)return false;var m=document.querySelector('meta[name="supabase-anon-key"]');if(m&&m.getAttribute('content')!==dead){m.setAttribute('content',dead);done=true;if(obs)obs.disconnect();return true;}return false;}try{obs=new MutationObserver(function(){rw();});obs.observe(document,{childList:true,subtree:true});}catch(e){}if(!rw()){document.addEventListener('DOMContentLoaded',function(){if(!rw())setTimeout(rw,300);});}})();`
  });
  console.log('STALE MODE: DOM meta tag will be rewritten to retired key (simulates cached old index.html)');
}

console.log('TARGET:', TARGET_URL);
await send('Page.navigate', { url: TARGET_URL });
// Poll until the app has rendered, up to 25s
for (let i = 0; i < 50; i++) {
  await new Promise(r => setTimeout(r, 500));
  const len = await evaluate(`(document.getElementById('app')?.innerHTML || '').length`).catch(() => -1);
  if (len > 100) { console.log(`App rendered after ~${(i + 1) * 0.5}s (html length ${len})`); break; }
}

const bootInfo = await evaluate(`JSON.stringify({
  readyState: document.readyState,
  url: location.href,
  title: document.title,
  scripts: [...document.querySelectorAll('script')].map(s => s.src || 'inline'),
  appHtmlLength: (document.getElementById('app')?.innerHTML || '').length,
  hasCourseCards: document.querySelectorAll('.course-card').length
})`);
console.log('BOOT:', bootInfo);

// Navigate: Courses view -> first course card -> Materials tab
const navClicked = await evaluate(`(function(){
  const nav = document.querySelector('[data-view="courses"], .nav-item:nth-child(3)');
  if (nav) { nav.click(); return nav.className; }
  return null;
})()`);
console.log('NAV CLICK:', navClicked);
await new Promise(r => setTimeout(r, 1000));

await evaluate(`(function(){
  const card = document.querySelector('.course-card');
  if (card) card.click();
  return !!card;
})()`);
await new Promise(r => setTimeout(r, 1500));

// Click the Materials tab
const clickedTab = await evaluate(`(function(){
  const tabs = [...document.querySelectorAll('.course-tab')];
  const tab = tabs.find(t => t.textContent.trim().toLowerCase() === 'materials');
  if (tab) tab.click();
  return tabs.map(t => t.textContent.trim()).join(',');
})()`);
await new Promise(r => setTimeout(r, 9000)); // allow the self-heal cycle (origin fetch + signOut + rebuild + retry) to complete

const materialsInfo = await evaluate(`(function(){
  const panel = document.querySelector('.panel');
  return JSON.stringify({
    activeTab: document.querySelector('.course-tab.active')?.textContent?.trim(),
    lectureBlocks: document.querySelectorAll('.lecture-block').length,
    emptyStateText: (panel?.textContent || '').replace(/\\s+/g, ' ').slice(0, 300)
  });
})()`);
console.log('MATERIALS:', materialsInfo);

// Explicit assertions
const healFired = consoleLogs.some(l => l.includes('self-healing'));
const clientInits = consoleLogs.filter(l => l.includes('Supabase client initialized')).length;
const materialsLoaded = parseInt((materialsInfo.match(/"lectureBlocks":(\d+)/) || [])[1] || '0', 10) > 0;
console.log(`ASSERT: materialsLoaded=${materialsLoaded} healFired=${healFired} clientInits=${clientInits}${process.env.SC_STALE === '1' ? ' (stale mode: heal MUST fire)' : ''}`);
const healStage = await evaluate(`window.__scHealStage || 'never-started'`).catch(() => 'eval-error');
console.log('HEALSTAGE:', healStage);

const stateInfo = await evaluate(`JSON.stringify({
  storedKeyAfterRun: (localStorage.getItem('sc_supabase_anon_key') || 'PURGED-OR-NEVER-SET').slice(0, 40),
  cloudMaterialTitlesSample: [...document.querySelectorAll('.lecture-block h3')].slice(0, 8).map(h => h.textContent.trim())
})`).catch(e => 'state eval skipped: ' + e.message);
console.log('STATE:', stateInfo);

console.log('\n--- PAGE ERRORS ---');
console.log(pageErrors.length ? pageErrors.join('\n') : '(none)');
console.log('\n--- CONSOLE (all) ---');
console.log(consoleLogs.join('\n') || '(none)');

ws.close();
proc.kill();
server.close();
try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch (_) {}
process.exit(0);
