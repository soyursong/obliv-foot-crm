// Phase0 read-only 실측: 최근 예약 visit_route ↔ 해당 고객 customers.visit_route 정합 확인
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^["']|["']$/g,'')];}));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const since = '2026-07-10';
const { data: resv, error } = await sb.from('reservations')
  .select('id,customer_id,visit_type,visit_route,created_via,source_system,created_at')
  .gte('reservation_date', since)
  .not('visit_route','is',null).neq('visit_route','')
  .not('customer_id','is',null)
  .order('created_at',{ascending:false}).limit(60);
if(error){console.error('resv err',error);process.exit(1);}
console.log(`\n[reservations since ${since} with visit_route set, customer bound] n=${resv.length}`);
const cids=[...new Set(resv.map(r=>r.customer_id))];
const { data: custs } = await sb.from('customers').select('id,visit_route,lead_source').in('id',cids);
const cmap=Object.fromEntries((custs||[]).map(c=>[c.id,c]));
let match=0,mismatch=0,custNull=0;
const rows=[];
for(const r of resv){
  const c=cmap[r.customer_id]; if(!c)continue;
  const same=c.visit_route===r.visit_route;
  if(c.visit_route==null) custNull++;
  if(same)match++; else mismatch++;
  rows.push({vt:r.visit_type,resv:r.visit_route,cust:c.visit_route,src:r.source_system||'-',same, at:r.created_at?.slice(5,16)});
}
console.log(`match=${match} mismatch=${mismatch} (customer.visit_route NULL among these=${custNull})`);
console.log('\nsample (newest 25):');
for(const x of rows.slice(0,25)) console.log(`  ${x.same?'OK ':'XX '} vt=${x.vt.padEnd(9)} resv=${(x.resv||'').padEnd(8)} cust=${(x.cust??'∅')} src=${x.src} @${x.at}`);
// visit_type split of mismatches
const mmByVt={};
for(const x of rows.filter(r=>!r.same)) mmByVt[x.vt]=(mmByVt[x.vt]||0)+1;
console.log('\nmismatch by visit_type:', JSON.stringify(mmByVt));
process.exit(0);
