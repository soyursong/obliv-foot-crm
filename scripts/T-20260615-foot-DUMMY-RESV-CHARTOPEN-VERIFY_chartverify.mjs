/**
 * T-20260615-foot-DUMMY-RESV-CHARTOPEN-VERIFY — CHART OPEN 데이터 검증 (read-only)
 * 초진·재진 각 ≥3건에 대해 chart1(CheckInDetailSheet)·chart2(CustomerChartSheet)
 * 열림 전제조건을 코드 분기 그대로 재현해 PASS/FAIL 판정. WSOD 유발 데이터조건 0건 확인.
 *
 * 코드 분기: 예약 카드 클릭 → reservation.customer_id 직결 필요 →
 *            openChart(customer_id) → customers row 존재 + (동명이인 직결로 회피).
 * 실패 분기(WSOD): customer_id NULL / customers row 없음.
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',(process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })()),{auth:{persistSession:false}});

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DATE = '2026-06-15';
const CREATED_BY = 'TEST-20260615';

const { data: resv, error: re } = await sb.from('reservations')
  .select('id, reservation_time, visit_type, customer_name, customer_id')
  .eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE).eq('created_by', CREATED_BY)
  .order('reservation_time', { ascending: true });
if (re) { console.error('resv err', re); process.exit(1); }
console.log(`[더미 6/15] reservations = ${resv?.length ?? 0}건`);

const news = (resv||[]).filter(r => r.visit_type === 'new');
const rets = (resv||[]).filter(r => r.visit_type === 'returning');
console.log(`  초진(new): ${news.length} / 재진(returning): ${rets.length}`);

async function verifyCard(r) {
  const out = { time: (r.reservation_time||'').slice(0,5), vt: r.visit_type, name: r.customer_name };
  out.chart1 = r.customer_id ? 'OPEN' : 'FAIL(customer_id NULL)';
  if (!r.customer_id) { out.chart2 = 'FAIL(customer_id NULL)'; return out; }
  const { data: c } = await sb.from('customers').select('id, name, chart_number').eq('id', r.customer_id).single();
  if (!c) { out.chart2 = 'FAIL(customer row 없음 → WSOD)'; return out; }
  out.chart_number = c.chart_number ?? '(미발번)';
  out.chart2 = 'OPEN';
  return out;
}

console.log('\n=== CHART OPEN 검증 (초진 3 + 재진 3) ===');
const rows = [];
for (const r of [...news.slice(0,3), ...rets.slice(0,3)]) rows.push(await verifyCard(r));
console.log('time  | vt        | name   | chart1        | chart2        | chart_no');
for (const x of rows) console.log(`${x.time} | ${(x.vt||'').padEnd(9)} | ${(x.name||'').padEnd(5)} | ${(x.chart1||'').padEnd(13)} | ${(x.chart2||'').padEnd(13)} | ${x.chart_number||'-'}`);

const allOpen = rows.every(x => x.chart1 === 'OPEN' && x.chart2 === 'OPEN');
const totalNull = (resv||[]).filter(r => !r.customer_id).length;
console.log('\n=== 종합 ===');
console.log(`전체 더미 customer_id NULL: ${totalNull} (0이어야 PASS)`);
console.log(`샘플 6건 chart1+chart2 전부 OPEN: ${allOpen}`);
console.log(allOpen && totalNull === 0
  ? '\n[OK] CHART OPEN 데이터검증 PASS — WSOD 유발 데이터조건 없음'
  : '\n[FAIL] responder P0 에스컬레이션 필요');
if (!(allOpen && totalNull === 0)) process.exit(1);
