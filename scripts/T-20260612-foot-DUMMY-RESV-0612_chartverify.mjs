/**
 * T-20260612-foot-DUMMY-RESV-0612 — CHART OPEN 데이터 검증 (read-only) [AC-5 P0]
 * 초진·재진 각 ≥3건에 대해 chart1(CheckInDetailSheet)·chart2(CustomerChartSheet)
 * 열림 전제조건을 코드 분기 그대로 재현해 PASS/FAIL 판정.
 *
 * 코드 분기 (Dashboard/예약 카드 클릭 → openChart(customer_id)):
 *   chart1(CheckInDetailSheet): 예약 카드 클릭 → reservation.customer_id 직결 필요.
 *   chart2(CustomerChartSheet): openChart(customer_id) → customers row 존재 + chart_number.
 * 실패 분기(6/9 WSOD): customer_id NULL / clinic 동명이인>1 / customers row 없음.
 * 추가: is_simulation=true면 ADMIN-SIM-FILTER가 목록에서 숨겨 클릭 자체 불가 → false 확인.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DATE = '2026-06-12';
const MARKER = '[TEST-DUMMY 20260612]';

const { data: resv, error: re } = await sb.from('reservations')
  .select('id, reservation_time, visit_type, customer_name, customer_id, memo')
  .eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE).eq('memo', MARKER)
  .order('reservation_time', { ascending: true });
if (re) { console.error('resv err', re); process.exit(1); }
console.log(`[더미 6/12] reservations = ${resv?.length ?? 0}건`);

const news = (resv||[]).filter(r => r.visit_type === 'new');
const rets = (resv||[]).filter(r => r.visit_type === 'returning');
console.log(`  초진(new): ${news.length} / 재진(returning): ${rets.length}`);

// 초진 3 + 재진 3 (현장 명시: 각 최소 3건). 안전 위해 각 4건 검증.
const sampleNew = news.slice(0, 4);
const sampleRet = rets.slice(0, 4);

async function verifyCard(r) {
  const result = { time: (r.reservation_time||'').slice(0,5), vt: r.visit_type, name: r.customer_name };
  // chart1: 예약 카드 클릭 진입 → customer_id 직결 여부
  result.chart1_verify = r.customer_id ? 'OPEN' : 'FAIL(customer_id NULL)';
  if (!r.customer_id) { result.chart2_verify = 'FAIL(customer_id NULL)'; return result; }
  // chart2: openChart(customer_id) → customers row + chart_number + is_simulation 가시성
  const { data: c } = await sb.from('customers').select('id, name, chart_number, is_simulation').eq('id', r.customer_id).single();
  if (!c) { result.chart2_verify = 'FAIL(customer row 없음 → WSOD)'; return result; }
  if (c.is_simulation === true) { result.chart2_verify = 'FAIL(is_simulation=true → 목록 숨김)'; result.note='SIM_HIDDEN'; return result; }
  // clinic 내 동명이인 (homonym 거부 분기) 확인
  const { data: homonym } = await sb.from('customers').select('id').eq('clinic_id', CLINIC_ID).eq('name', r.customer_name);
  const hn = homonym?.length ?? 0;
  result.homonym = hn;
  result.chart_number = c.chart_number ?? '(미발번)';
  if (hn > 1) result.note = `clinic 동명 ${hn}건(직결 customer_id 사용으로 거부 회피)`;
  result.chart2_verify = 'OPEN';
  return result;
}

console.log('\n=== [AC-5 P0] CHART OPEN 검증 (초진 4 + 재진 4) ===');
const rows = [];
for (const r of [...sampleNew, ...sampleRet]) rows.push(await verifyCard(r));

console.log('time  | vt        | name   | chart1_verify | chart2_verify | chart_no | homonym');
for (const x of rows) {
  console.log(`${x.time} | ${(x.vt||'').padEnd(9)} | ${(x.name||'').padEnd(5)} | ${(x.chart1_verify||'').padEnd(13)} | ${(x.chart2_verify||'').padEnd(13)} | ${String(x.chart_number||'-').padEnd(8)} | ${x.homonym ?? '-'}${x.note ? ' '+x.note : ''}`);
}

const allOpen = rows.every(x => x.chart1_verify === 'OPEN' && x.chart2_verify === 'OPEN');
const totalNull = (resv||[]).filter(r => !r.customer_id).length;
console.log('\n=== 종합 ===');
console.log(`전체 더미 customer_id NULL: ${totalNull} (0이어야 PASS)`);
console.log(`샘플 8건 chart1+chart2 전부 OPEN: ${allOpen}`);
console.log(allOpen && totalNull === 0
  ? '\n✅ CHART OPEN 데이터검증 PASS — WSOD 유발 데이터조건 없음'
  : '\n❌ FAIL — responder P0 에스컬레이션 필요');
if (!(allOpen && totalNull === 0)) process.exit(1);
