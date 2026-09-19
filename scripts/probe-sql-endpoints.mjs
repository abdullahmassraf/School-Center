// Probe which SQL-execution path (if any) the stored service key can use.
// Prints only HTTP status codes and response bodies, never the key.
import 'dotenv/config';
const REF = String(process.env.SUPABASE_URL || '').replace('https://', '').replace('.supabase.co', '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!REF || !KEY) { console.error('missing env'); process.exit(2); }

const probes = [
  ['db.pgsql (SQL-over-HTTP, text/plain)', `https://${REF}.supabase.co/db/pgsql`, 'text/plain', 'select 1 as ok'],
  ['pg/http (JSON)', `https://${REF}.supabase.co/pg/http`, 'application/json', JSON.stringify({ query: 'select 1 as ok' })],
  ['management query', `https://api.supabase.com/v1/projects/${REF}/database/query`, 'application/json', JSON.stringify({ query: 'select 1 as ok' })],
  ['management pg-meta', `https://api.supabase.com/v1/projects/${REF}/database/pg-meta/query?verbose=false&inline=all&drop_failures=true`, 'application/json', JSON.stringify({ query: 'select 1 as ok' })]
];

for (const [name, url, ctype, body] of probes) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': ctype },
      body
    });
    const text = await res.text();
    console.log(`${name}: ${res.status} ${text.slice(0, 160).replace(/\n/g, ' ')}`);
  } catch (e) {
    console.log(`${name}: THREW ${e.message}`);
  }
}
