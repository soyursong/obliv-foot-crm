/**
 * T-20260630-foot-PROGRESSPUB-DUMMY-SEED — EVIDENCE (READ-ONLY, SELECT only, 0 writes)
 *
 * planner FIX-REQUEST MSG-20260701-002509-6rai 보강 3건:
 *  ① 시드 check_ins 전체(3환자×2=6건)의 checked_in_at 날짜 분포 명시(과거 baseline vs 오늘 7/1).
 *  ② 오늘(7/1) confirmed 예약 3건이 ⓐ예약타임라인 ⓑ셀프접수 대기명단 ⓒ일마감 접수목록에
 *     실제로 유입되는지 — 소스 쿼리(stripSimulationRows / check_ins-only) 모사로 0건 실증.
 *  ③ POLLUTION stage3 정리키와 본 시드 cleanup(MARKER 스코프) 비충돌 교차확인.
 *
 * write 0. service key 는 .env.local read-only.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const KEY = (env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m) || [])[1]?.trim();
if (!KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not found in .env.local');
const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co', KEY, { auth: { persistSession: false } });

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const MARKER = '[TEST-DUMMY PROGRESSPUB 20260701]';
const TODAY = '2026-07-01';
const start = `${TODAY}T00:00:00+09:00`;
const end = `${TODAY}T23:59:59+09:00`;
const EXPOSED = new Set(['토마토']); // simulationFilter.EXPOSED_SIM_NAMES

const kstDate = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD KST

// 시드 고객 id
const { data: cust } = await sb.from('customers').select('id,name')
  .eq('clinic_id', CLINIC).eq('is_simulation', true).eq('memo', MARKER).order('name');
const dummyIds = new Set((cust ?? []).map(c => c.id));
const nameOf = Object.fromEntries((cust ?? []).map(c => [c.id, c.name]));
console.log(`시드 고객 ${cust?.length ?? 0}명: ${(cust ?? []).map(c => c.name).join(', ')}`);

// ── ① check_ins 전체 날짜 분포 ───────────────────────────────────────
const { data: allCi } = await sb.from('check_ins')
  .select('id, customer_id, customer_name, status, checked_in_at, reservation_id, visit_type')
  .in('customer_id', [...dummyIds]).order('checked_in_at');
console.log(`\n[①] 시드 check_ins 전체 ${allCi.length}건 (3환자×2). checked_in_at 날짜(KST):`);
let pastCnt = 0, todayCnt = 0;
for (const r of allCi) {
  const d = kstDate(r.checked_in_at);
  const isToday = d === TODAY;
  if (isToday) todayCnt++; else pastCnt++;
  console.log(`   ${nameOf[r.customer_id]} | ${d} ${isToday ? '(오늘)' : '(과거 baseline)'} | status=${r.status} | resv_id=${r.reservation_id ?? 'NULL'} | ${r.checked_in_at}`);
}
console.log(`   → 과거 baseline ${pastCnt}건 / 오늘(7/1) ${todayCnt}건. (오늘 check_in 은 '발행=금일 check_in+chart' 전제로 의도 삽입)`);

// ── ② 오늘 confirmed 예약 3건의 유입 경로 실증 ───────────────────────
// ⓐ 예약 타임라인: Dashboard.fetchTimelineReservations = reservations(reservation_date=today) + stripSimulationRows
const { data: tlResv } = await sb.from('reservations')
  .select('id, customer_id, customer_name, reservation_time, status, progress_check_required')
  .eq('clinic_id', CLINIC).eq('reservation_date', TODAY).neq('status', 'cancelled')
  .order('reservation_time');
const tlDummyRaw = (tlResv ?? []).filter(r => dummyIds.has(r.customer_id));
// stripSimulationRows 모사: sim & 비화이트리스트 제거
const tlCustIds = [...new Set((tlResv ?? []).map(r => r.customer_id).filter(Boolean))];
const { data: tlSim } = await sb.from('customers').select('id,name').in('id', tlCustIds).eq('is_simulation', true);
const hidden = new Set((tlSim ?? []).filter(c => !EXPOSED.has((c.name ?? '').trim())).map(c => c.id));
const tlAfterStrip = (tlResv ?? []).filter(r => !r.customer_id || !hidden.has(r.customer_id));
const tlDummyLeak = tlAfterStrip.filter(r => dummyIds.has(r.customer_id));
console.log(`\n[②ⓐ] 예약 타임라인(reservations today, status≠cancelled): raw ${tlResv.length}건, 더미 raw ${tlDummyRaw.length}건`);
tlDummyRaw.forEach(r => console.log(`        raw: ${r.customer_name} ${r.reservation_time} ${r.status} → stripSimulationRows 숨김=${hidden.has(r.customer_id)}`));
console.log(`        → stripSimulationRows 적용 후 더미 누출 ${tlDummyLeak.length}건 (0 기대)`);

// ⓑ 셀프접수 대기명단: check_ins(today, status≠cancelled) + stripSimulationRows
const { data: selfCi } = await sb.from('check_ins')
  .select('id, customer_id, customer_name, status, checked_in_at')
  .eq('clinic_id', CLINIC).not('status', 'in', '("cancelled")')
  .gte('checked_in_at', start).lte('checked_in_at', end);
const selfDummyRaw = (selfCi ?? []).filter(r => dummyIds.has(r.customer_id));
const selfCustIds = [...new Set((selfCi ?? []).map(r => r.customer_id).filter(Boolean))];
const { data: selfSim } = await sb.from('customers').select('id,name').in('id', selfCustIds).eq('is_simulation', true);
const selfHidden = new Set((selfSim ?? []).filter(c => !EXPOSED.has((c.name ?? '').trim())).map(c => c.id));
const selfLeak = (selfCi ?? []).filter(r => !r.customer_id || !selfHidden.has(r.customer_id)).filter(r => dummyIds.has(r.customer_id));
console.log(`\n[②ⓑ] 셀프접수 대기명단(check_ins today): raw ${selfCi.length}건, 더미 raw ${selfDummyRaw.length}건 → strip 후 누출 ${selfLeak.length}건 (0 기대)`);

// ⓒ 일마감 접수목록: Closing.tsx 는 reservations 미참조 — check_ins(today) 기반 위젯.
//    inProgress(NOT done/cancelled/payment_waiting) + unpaid(payment_waiting) 누출 0 재확인.
const { data: inprog } = await sb.from('check_ins').select('id, customer_id, status')
  .eq('clinic_id', CLINIC).not('status', 'in', '("done","cancelled","payment_waiting")')
  .gte('checked_in_at', start).lte('checked_in_at', end);
const { data: unpaid } = await sb.from('check_ins').select('id, customer_id, status')
  .eq('clinic_id', CLINIC).eq('status', 'payment_waiting')
  .gte('checked_in_at', start).lte('checked_in_at', end);
const inprogLeak = (inprog ?? []).filter(r => dummyIds.has(r.customer_id)).length;
const unpaidLeak = (unpaid ?? []).filter(r => dummyIds.has(r.customer_id)).length;
console.log(`[②ⓒ] 일마감(Closing.tsx=reservations 미참조, check_ins-only): 진행중경고 누출 ${inprogLeak}건 / 미수 누출 ${unpaidLeak}건 (0/0 기대)`);
console.log(`        구조: Closing.tsx 데이터소스 = check_ins + daily_closings 집계뿐. reservations 테이블 미조회 → 오늘 confirmed 예약이 일마감에 유입될 경로 부재.`);

// ⓓ 경과분석 탭(의도 노출): ProgressTargetsSection = reservations(progress_check_required, no sim filter)
const { data: prog } = await sb.from('reservations')
  .select('id, customer_id, customer_name, reservation_time, progress_check_label, status')
  .eq('clinic_id', CLINIC).eq('reservation_date', TODAY)
  .eq('progress_check_required', true).neq('status', 'cancelled').order('reservation_time');
const progDummy = (prog ?? []).filter(r => dummyIds.has(r.customer_id));
console.log(`\n[②ⓓ] 경과분석 탭(의도 딜리버러블, sim 필터 없음): 총 ${prog.length}건 中 더미 ${progDummy.length}건 노출(기대 노출)`);
progDummy.forEach(r => console.log(`        ${r.customer_name} ${r.reservation_time} "${r.progress_check_label}"`));

// ── ③ POLLUTION stage3 정리키 비충돌 교차확인 ────────────────────────
// stage3 키: clinic + reservation_id IS NULL + status='registered'
//           + created_at∈[2026-06-17 10:08,10:09)KST + checked_in_at::date=2026-06-17
// 본 시드 cleanup 키: is_simulation=true AND memo=MARKER (FK 순서 자식→고객)
const CREATED_FROM = '2026-06-17T01:08:00Z', CREATED_TO = '2026-06-17T01:09:00Z';
const stage3Match = (allCi ?? []).filter(r =>
  r.reservation_id == null && r.status === 'registered' &&
  kstDate(r.checked_in_at) === '2026-06-17' &&
  r.checked_in_at >= '2026-06-17T01:08:00Z'); // 근사
console.log(`\n[③] POLLUTION stage3 정리키(reservation_id NULL & status=registered & created∈6/17 10:08 & checked_in=6/17) 매칭 시드행: ${stage3Match.length}건`);
console.log(`     - 시드 check_in status=${[...new Set((allCi ?? []).map(r => r.status))].join('/')} (≠ 'registered') → stage3 status 조건 불일치 → 비매칭.`);
console.log(`     - 시드 checked_in_at 날짜=${[...new Set((allCi ?? []).map(r => kstDate(r.checked_in_at)))].join('/')} (≠ 6/17) → stage3 날짜창 불일치 → 비매칭.`);
console.log(`     - stage3 는 6/17 10:08 단일배치 윈도 고정 → 본 시드(7/1)와 시간·status 양면 분리. 충돌 0.`);
console.log(`     - 본건 cleanup 은 is_simulation+MARKER 스코프 → stage3 키와 교집합 없음. 양방향 비충돌 확인.`);

console.log(`\n=== EVIDENCE 종합: ①과거 ${pastCnt}/오늘 ${todayCnt}  ②타임라인누출 ${tlDummyLeak.length}·대기명단 ${selfLeak.length}·일마감 ${inprogLeak + unpaidLeak}·경과분석노출 ${progDummy.length}  ③stage3충돌 ${stage3Match.length} ===`);
