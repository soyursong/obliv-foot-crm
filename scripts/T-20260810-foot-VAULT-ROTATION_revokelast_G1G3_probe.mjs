#!/usr/bin/env node
/**
 * READ-ONLY — T-20260810-foot-VAULT-ROTATION-INTERNAL-CRON revoke-last 4-AND fresh evidence.
 *   G1: per-caller 401 attribution (residual 401 == jobid6 keep_warm ; secret-mismatch 401 == 0)
 *   G3: real-caller 200-on-NEW-leg (send-notification batch j5/j9/j10 + full X-Internal-Cron fleet)
 * Sources: Management API SQL query endpoint (net._http_response 6h retained + cron.job + pg_proc
 *          + notification_logs app-level) + Functions API (verify_jwt/deploy). NO prod mutation.
 * Usage: node scripts/...G1G3_probe.mjs   (reads ../.env.local: VITE_SUPABASE_URL, SUPABASE_ACCESS_TOKEN)
 */
import fs from 'node:fs';
const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const REF = g('VITE_SUPABASE_URL').match(/https:\/\/([a-z0-9]+)\.supabase/)[1];
const TOKEN = g('SUPABASE_ACCESS_TOKEN');
async function sql(query){
  const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',
    headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query})});
  const t=await r.text(); let j; try{j=JSON.parse(t)}catch{return{err:t.slice(0,400)}}
  return{rows:Array.isArray(j)?j:(j.result||[]),err:j.message};
}
console.log('ref',REF,'now',new Date().toISOString());
console.log('\n[G1] net._http_response retention + status dist');
console.log(JSON.stringify((await sql(`select count(*) n,min(created) mn,max(created) mx from net._http_response`)).rows[0]));
(await sql(`select status_code s,count(*) n from net._http_response group by s order by n desc`)).rows.forEach(x=>console.log(' ',x.s,x.n));
console.log('\n[G1] 401 content signatures');
(await sql(`select left(content,60) sig,count(*) n from net._http_response where status_code=401 group by sig order by n desc`)).rows.forEach(x=>console.log('  n='+x.n,JSON.stringify(x.sig)));
console.log('\n[G1] keep_warm 401 cadence: min-of-hour (expect all %5) + per-hour (expect 12)');
(await sql(`select extract(minute from created)::int m,count(*) n from net._http_response where status_code=401 and content='{"error":"Unauthorized"}' group by m order by m`)).rows.forEach(x=>console.log(`  :${String(x.m).padStart(2,'0')} n=${x.n} ${x.m%5?'<<NOT%5':''}`));
(await sql(`select date_trunc('hour',created) h,count(*) n from net._http_response where status_code=401 and content='{"error":"Unauthorized"}' group by h order by h`)).rows.forEach(x=>console.log(`  ${x.h} n=${x.n}`));
console.log('\n[G3] notification_logs sent since flip (Aug10 02:15Z) — real send-notification callers');
(await sql(`select date_trunc('day',coalesce(sent_at,created_at)) d,event_type e,status s,count(*) n from public.notification_logs where coalesce(sent_at,created_at)>='2026-08-10 02:15:00+00' group by d,e,s order by d desc,n desc limit 20`)).rows.forEach(x=>console.log(`  ${String(x.d).slice(0,10)} ${String(x.e).padEnd(22)} ${String(x.s).padEnd(8)} n=${x.n}`));
console.log('\n[G3] X-Internal-Cron fleet 200/non-401 (vault-NEW accepted) — content sig');
(await sql(`select status_code s,left(content,55) sig,count(*) n from net._http_response where status_code=200 group by s,sig order by n desc limit 6`)).rows.forEach(x=>console.log(`  ${x.s} n=${x.n} ${JSON.stringify(x.sig)}`));
