// read-only 진단: 7/24·7/30 vs 정상일 예약현황 실측 (T-20260716-foot-RESVDETAIL-CAL-AVAILTIME-EMPTY-RCA)
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const URL=env.VITE_SUPABASE_URL, KEY=env.SUPABASE_SERVICE_ROLE_KEY;
const h={apikey:KEY,Authorization:`Bearer ${KEY}`};
async function q(path){const r=await fetch(`${URL}/rest/v1/${path}`,{headers:h});if(!r.ok)throw new Error(`${r.status} ${await r.text()}`);return r.json();}

// clinic 목록 확인
const clinics = await q('clinics?select=id,slug,name');
console.log('=== clinics ===');
for(const c of clinics) console.log(`  ${c.slug}  ${c.name}  id=${c.id}`);

const DATES=['2026-07-23','2026-07-24','2026-07-25','2026-07-30','2026-07-31'];
console.log('\n=== reservations per date (all clinics, status breakdown) ===');
for(const d of DATES){
  const rows=await q(`reservations?select=reservation_time,visit_type,is_healer_intent,healer_flag,status,clinic_id&reservation_date=eq.${d}`);
  const active=rows.filter(r=>r.status!=='cancelled');
  const slots=new Set(active.map(r=>String(r.reservation_time).slice(0,5)));
  const byStatus=rows.reduce((a,r)=>{a[r.status]=(a[r.status]||0)+1;return a;},{});
  const dow=['일','월','화','수','목','금','토'][new Date(d+'T00:00:00+09:00').getDay()];
  console.log(`  ${d}(${dow}): total=${rows.length} active=${active.length} distinctSlots=${slots.size} statuses=${JSON.stringify(byStatus)}`);
  if(active.length) console.log(`     slotTimes=[${[...slots].sort().join(', ')}]`);
}
