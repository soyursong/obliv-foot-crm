/**
 * T-20260619-foot-TESTDUMMY-ASSIGN — VERIFY (AC2, read-only)
 *   ① 차트오픈 데이터검증 (chart1 CheckInDetailSheet · chart2 CustomerChartSheet 전제조건)
 *      — 초진·재진 각 5건 샘플. WSOD 유발조건(customer_id NULL / customers row 부재 / 동명이인) 점검.
 *   ② 상담사 배정자동화 축(axis) 적용 검증 — autoAssign.deriveConsultAxis 로직 동형 재현.
 *      초진=visit_route(TM/인바운드/워크인) / 재진=returning(월 균등 제외). 80건 전수.
 *      + 재진 인지 전제(과거 check_in done + medical_chart) 충족 확인.
 *   ③ 치료사 배정 슬롯 정상 — 20슬롯 × 4건 분포, 시간/visit_type 정합. 당일 check_in 0건(라이브 무오염).
 *
 * deriveConsultAxis 로직 출처: src/lib/autoAssign.ts (returning→'returning';
 *   visit_route|lead_source ∈ {TM,인바운드,워크인} 면 그대로; 그 외=워크인). 본 스크립트 동형 재현.
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',(process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })()),{auth:{persistSession:false}});

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const DATE = '2026-06-19';
const MARKER = '[TEST-0619-ASSIGN]';
const CONSULT_AXES = ['TM','인바운드','워크인'];
const deriveConsultAxis = (c) => {
  if (c.visit_type === 'returning') return 'returning';
  const raw = (c.visit_route ?? c.lead_source ?? '').trim();
  return CONSULT_AXES.includes(raw) ? raw : '워크인';
};

let FAIL = 0;

// ── 데이터 적재 ──────────────────────────────────────────────────────────
const { data: resv } = await sb.from('reservations')
  .select('id, reservation_time, visit_type, customer_name, customer_id')
  .eq('clinic_id', CLINIC_ID).eq('reservation_date', DATE).eq('memo', MARKER)
  .order('reservation_time', { ascending: true });
const { data: cust } = await sb.from('customers')
  .select('id, name, visit_type, visit_route, lead_source, chart_number, is_simulation')
  .eq('clinic_id', CLINIC_ID).eq('memo', MARKER);
const custById = Object.fromEntries((cust ?? []).map((c) => [c.id, c]));

console.log(`reservations: ${resv?.length}건 / customers: ${cust?.length}건`);

// ── ① 차트오픈 데이터검증 (초진5 + 재진5) ────────────────────────────────
console.log('\n=== ① 차트오픈 데이터검증 (초진5 + 재진5) ===');
const news = (resv ?? []).filter((r) => r.visit_type === 'new').slice(0, 5);
const rets = (resv ?? []).filter((r) => r.visit_type === 'returning').slice(0, 5);
console.log('time  | vt        | name   | chart1 | chart2 | chart_no | homonym');
for (const r of [...news, ...rets]) {
  const chart1 = r.customer_id ? 'OPEN' : 'FAIL(cid NULL)';
  const c = custById[r.customer_id];
  let chart2 = 'OPEN', cn = '-', hn = 0;
  if (!r.customer_id) chart2 = 'FAIL(cid NULL)';
  else if (!c) chart2 = 'FAIL(customer row 없음→WSOD)';
  else {
    cn = c.chart_number ?? '(미발번)';
    const { data: hom } = await sb.from('customers').select('id').eq('clinic_id', CLINIC_ID).eq('name', r.customer_name);
    hn = hom?.length ?? 0;
    if (hn > 1) chart2 = `OPEN(동명${hn},cid직결)`;
  }
  if (chart1 !== 'OPEN' || !chart2.startsWith('OPEN')) FAIL++;
  console.log(`${(r.reservation_time||'').slice(0,5)} | ${r.visit_type.padEnd(9)} | ${(r.customer_name||'').padEnd(5)} | ${chart1.padEnd(6)} | ${chart2.padEnd(6)} | ${String(cn).padEnd(8)} | ${hn}`);
}
const totalNull = (resv ?? []).filter((r) => !r.customer_id).length;
console.log(`전체 더미 customer_id NULL: ${totalNull} (0이어야 PASS)`);
if (totalNull !== 0) FAIL++;

// ── ② 상담사 배정 축(axis) 검증 (80건 전수) ──────────────────────────────
console.log('\n=== ② 상담사 배정자동화 축(axis) 검증 ===');
const axisCount = {};
let axisBad = 0;
for (const c of cust ?? []) {
  const axis = deriveConsultAxis(c);
  axisCount[axis] = (axisCount[axis] ?? 0) + 1;
  if (c.visit_type === 'returning' && axis !== 'returning') axisBad++;
  if (c.visit_type === 'new' && axis === 'returning') axisBad++;
}
console.log('axis 분포:', JSON.stringify(axisCount));
console.log(`재진(returning) axis = 'returning'(월 균등 제외): ${axisCount['returning'] ?? 0}건 (기대 40)`);
console.log(`초진 axis 오분류: ${axisBad}건 (0이어야 PASS)`);
if (axisBad !== 0 || (axisCount['returning'] ?? 0) !== 40) FAIL++;

// 재진 인지 전제: 과거 check_in(done) + medical_chart 충족
const retIds = (cust ?? []).filter((c) => c.visit_type === 'returning').map((c) => c.id);
const { data: retCi } = await sb.from('check_ins').select('customer_id, status, checked_in_at').in('customer_id', retIds).eq('status', 'done');
const { data: retMc } = await sb.from('medical_charts').select('customer_id').in('customer_id', retIds);
const ciSet = new Set((retCi ?? []).map((r) => r.customer_id));
const mcSet = new Set((retMc ?? []).map((r) => r.customer_id));
const retBoth = retIds.filter((id) => ciSet.has(id) && mcSet.has(id)).length;
const retCiToday = (retCi ?? []).filter((r) => String(r.checked_in_at).slice(0,10) === DATE).length;
console.log(`재진 과거이력(done check_in + chart 동시보유): ${retBoth}/${retIds.length} (기대 40)`);
console.log(`재진 check_in 중 당일(${DATE}): ${retCiToday}건 (반드시 0 — 라이브 칸반 무오염)`);
if (retBoth !== 40 || retCiToday !== 0) FAIL++;

// ── ③ 치료사 배정 슬롯 분포 검증 ─────────────────────────────────────────
console.log('\n=== ③ 슬롯 분포 검증 (20슬롯 × 4) ===');
const bySlot = {};
for (const r of resv ?? []) {
  bySlot[r.reservation_time] = bySlot[r.reservation_time] ?? { new: 0, returning: 0 };
  bySlot[r.reservation_time][r.visit_type]++;
}
const slots = Object.keys(bySlot).sort();
const slotBad = slots.filter((s) => bySlot[s].new !== 2 || bySlot[s].returning !== 2);
console.log(`슬롯 수: ${slots.length} (기대 20) — 첫:${slots[0]?.slice(0,5)} 끝:${slots[slots.length-1]?.slice(0,5)}`);
console.log(`슬롯당 (초진2+재진2) 불일치 슬롯: ${slotBad.length}건 (0이어야 PASS)`);
if (slots.length !== 20 || slotBad.length !== 0) FAIL++;
// 당일 check_in 0건(전체 더미 기준)
const allIds = (cust ?? []).map((c) => c.id);
const { data: todayCiAll } = await sb.from('check_ins').select('id').in('customer_id', allIds).gte('checked_in_at', `${DATE}T00:00:00+09:00`).lte('checked_in_at', `${DATE}T23:59:59+09:00`);
console.log(`더미 고객의 당일(${DATE}) check_in: ${todayCiAll?.length ?? 0}건 (반드시 0)`);
if ((todayCiAll?.length ?? 0) !== 0) FAIL++;

console.log('\n=== 종합 ===');
console.log(FAIL === 0 ? '✅ AC2 ①②③ 데이터검증 PASS' : `❌ FAIL ${FAIL}건 — 조치 필요`);
process.exit(FAIL === 0 ? 0 : 1);
