/**
 * T-20260613-foot-DUMMY-CHARTFIX — CHART OPEN 프로그램 검증 (read-only) [AC-3]
 * openChartFor 코드 분기(Dashboard.tsx 4732~) 그대로 재현:
 *   path1: customer_id SET → ctxOpenChart(customer_id) → OPEN (결정적)
 *   path2: cid NULL + 동명 1 → fallback OPEN
 *   path3: cid NULL + 동명>1 → 동명이인 토스트(미오픈) / 동명0 → 미연결 토스트(미오픈)
 * 표준 더미는 cid SET + 고유이름 → path1 결정적 OPEN 이어야 함.
 * + chart2(CustomerChartSheet): customers row 존재 + chart_number 필요.
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg',
  { auth: { persistSession: false } });
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DATE = '2026-06-13';
const MARKER = '[TEST-DUMMY 20260613]';

const { data: resv } = await sb.from('reservations')
  .select('id, reservation_time, visit_type, customer_name, customer_id')
  .eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE).eq('memo', MARKER).order('reservation_time');
const news = resv.filter(r=>r.visit_type==='new');
const rets = resv.filter(r=>r.visit_type==='returning');
console.log(`더미 ${resv.length}건 (초진 ${news.length}/재진 ${rets.length})`);

async function verify(r) {
  const out = { time:(r.reservation_time||'').slice(0,5), vt:r.visit_type, name:r.customer_name };
  // chart1: 예약카드 클릭 → customer_id 직결
  out.chart1 = r.customer_id ? 'OPEN(path1)' : 'FAIL(cid NULL)';
  // chart2: customers row + chart_number + 동명이인 0
  if (r.customer_id) {
    const { data: c } = await sb.from('customers').select('id,name,chart_number,is_simulation').eq('id', r.customer_id).single();
    const { data: hom } = await sb.from('customers').select('id').eq('clinic_id', CLINIC_ID).eq('name', r.customer_name);
    out.chart2 = (c && c.chart_number) ? 'OPEN' : `FAIL(${!c?'no row':'no chart_number'})`;
    out.chart_number = c?.chart_number; out.homonym = hom?.length; out.is_sim = c?.is_simulation;
  } else out.chart2 = 'FAIL(cid NULL)';
  return out;
}

console.log('\n=== 초진 검증 (4건) ===');
let pass=true;
for (const r of news.slice(0,4)) { const v=await verify(r); console.log(JSON.stringify(v)); if(!v.chart1.startsWith('OPEN')||!v.chart2.startsWith('OPEN')||v.homonym!==1) pass=false; }
console.log('=== 재진 검증 (4건) ===');
for (const r of rets.slice(0,4)) { const v=await verify(r); console.log(JSON.stringify(v)); if(!v.chart1.startsWith('OPEN')||!v.chart2.startsWith('OPEN')||v.homonym!==1) pass=false; }

// 전건 cid/chart_number/동명이인 일괄 점검
const cids = resv.map(r=>r.customer_id);
const { data: allC } = await sb.from('customers').select('id,name,chart_number').in('id', cids);
const noChart = (allC||[]).filter(c=>!c.chart_number).length;
const nullCid = resv.filter(r=>!r.customer_id).length;
const names = resv.map(r=>r.customer_name);
const { data: homAll } = await sb.from('customers').select('name').eq('clinic_id', CLINIC_ID).in('name', names);
const cnt={}; (homAll||[]).forEach(c=>cnt[c.name]=(cnt[c.name]||0)+1);
const homDup = Object.entries(cnt).filter(([,c])=>c>1);
console.log(`\n전건: cid NULL=${nullCid}(0기대) chart_number결손=${noChart}(0기대) 동명이인=${homDup.length}(0기대)`);
console.log(`\n=== CHART OPEN ${pass && !nullCid && !noChart && !homDup.length ? 'PASS' : 'FAIL'} (프로그램 분기) ===`);
