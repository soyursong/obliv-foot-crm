#!/usr/bin/env node
/** READ-ONLY: dopamine-visitcall-receiver 콘솔 로그(function_logs) — 404 vs OK 라인 파악 */
import fs from 'node:fs';
const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const REF = g('VITE_SUPABASE_URL').match(/https:\/\/([a-z0-9]+)\.supabase/)[1];
const TOKEN = g('SUPABASE_ACCESS_TOKEN');
const H = { Authorization: `Bearer ${TOKEN}` };

const q = encodeURIComponent(`
select function_logs.timestamp as ts, event_message, m.level
from function_logs
cross join unnest(metadata) as m
where event_message like '%visitcall-receiver%'
order by function_logs.timestamp desc
limit 200
`);
const url = `https://api.supabase.com/v1/projects/${REF}/analytics/endpoints/logs.all?sql=${q}`;
const res = await fetch(url, { headers: H });
const txt = await res.text();
console.log('http', res.status);
let j; try { j = JSON.parse(txt); } catch { console.log(txt.slice(0,1200)); process.exit(0); }
const rows = j.result || [];
console.log(`rows: ${rows.length}`);
const buckets = { OK: 0, '404': 0, '401': 0, other: 0 };
for (const r of rows) {
  const m = r.event_message;
  if (m.includes('OK rid=')) buckets.OK++;
  else if (m.includes('404')) buckets['404']++;
  else if (m.includes('401')) buckets['401']++;
  else buckets.other++;
}
console.log('버킷:', JSON.stringify(buckets));
console.log('\n--- 404 라인 (reservation id 추출) ---');
for (const r of rows.filter(x=>x.event_message.includes('404'))) console.log(`  ${r.ts}  ${r.event_message.trim()}`);
console.log('\n--- 최근 OK 라인 20 ---');
for (const r of rows.filter(x=>x.event_message.includes('OK rid=')).slice(0,20)) console.log(`  ${r.ts}  ${r.event_message.trim()}`);
