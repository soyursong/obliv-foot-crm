import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(readFileSync(join(here,'..','.env.local'),'utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const TOK=(process.env.SUPABASE_ACCESS_TOKEN||env.SUPABASE_ACCESS_TOKEN||'').trim();
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/rxlomoozakkjesdqjtvd/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOK}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
// 정명희 #4270 (JMH) cross-check
const cust=await q(`SELECT id,name,chart_number,visit_type FROM public.customers WHERE chart_number='4270' OR chart_number='F-4270' OR name='정명희' ORDER BY created_at;`);
console.log('JMH 정명희 customers:');console.table(cust);
if(cust.length){
 const ids=cust.map(c=>`'${c.id}'`).join(',');
 const ci=await q(`SELECT id,status,visit_type,deleted_at,checked_in_at,clinic_id FROM public.check_ins WHERE customer_id IN (${ids}) ORDER BY checked_in_at;`);
 console.log('JMH check_ins:');console.table(ci);
 const done=await q(`SELECT count(*) done_before_today FROM public.check_ins WHERE customer_id IN (${ids}) AND status='done' AND deleted_at IS NULL AND checked_in_at < (now() AT TIME ZONE 'Asia/Seoul')::date::timestamptz;`);
 console.log('JMH done-before-today (recency input):');console.table(done);
}
