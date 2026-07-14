import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^["']|["']$/g,'')];}));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
// MANUAL popup-created only (source_system != dopamine), visit_route set, customer bound
const { data: resv } = await sb.from('reservations')
  .select('id,customer_id,visit_type,visit_route,created_via,source_system,created_at,updated_at')
  .gte('reservation_date','2026-07-01')
  .not('visit_route','is',null).neq('visit_route','')
  .not('customer_id','is',null)
  .or('source_system.is.null,source_system.neq.dopamine')
  .order('created_at',{ascending:false}).limit(80);
console.log(`\n[MANUAL(non-dopamine) resv since 07-01, visit_route set] n=${resv.length}`);
const cids=[...new Set(resv.map(r=>r.customer_id))];
const { data: custs } = await sb.from('customers').select('id,visit_route').in('id',cids);
const cmap=Object.fromEntries((custs||[]).map(c=>[c.id,c]));
let match=0,mismatch=0;const mmByVt={};const rows=[];
for(const r of resv){const c=cmap[r.customer_id];if(!c)continue;const same=c.visit_route===r.visit_route;if(same)match++;else{mismatch++;mmByVt[r.visit_type]=(mmByVt[r.visit_type]||0)+1;}rows.push({vt:r.visit_type,resv:r.visit_route,cust:c.visit_route,cv:r.created_via||'-',same,c_at:r.created_at?.slice(5,16),u_at:r.updated_at?.slice(5,16)});}
console.log(`match=${match} mismatch=${mismatch}  mismatch by visit_type=${JSON.stringify(mmByVt)}`);
console.log('\nsample:');
for(const x of rows.slice(0,30)) console.log(`  ${x.same?'OK ':'XX '} vt=${x.vt.padEnd(10)} resv=${(x.resv||'').padEnd(8)} cust=${(x.cust??'∅').padEnd(8)} cv=${x.cv.padEnd(8)} c@${x.c_at} u@${x.u_at}`);
// split created before vs after deploy of 031abb75 (~07-14T05:36 KST = ~07-13T20:36 UTC created_at). use created_at compare loosely
process.exit(0);
