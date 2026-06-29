/**
 * T-20260629-foot-VISITLOG-LINKAGE-AUDIT — DIAGNOSE (READ-ONLY, no writes)
 * 방문이력탭 0건 근본원인 판정.
 *  AC-1: 더미 환자 1명 기준 (방문이력=check_ins / 상담차트=check_ins / 진료차트=medical_charts / 진료경과=medical_charts)
 *        가 공통키(customer_id, 날짜)로 연동되는지 추적.
 *  AC-2: 0건이 (a)연동끊김 vs (b)EMPTYROW-HIDE 표시정책 배제 vs (c)혼합 판정.
 *        FE 필터: visibleVisitHistory = check_ins where (treatment_kind || treatment_memo.details || doctor_note).
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })());
const sb = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

const log = (...a) => console.log(...a);
const dkey = (s) => (s ? String(s).slice(0, 10) : '(null)');

// EMPTYROW-HIDE 필터 미러 (MedicalChartPanel.tsx L746-752)
function visibleByEmptyRowFilter(ci) {
  const treatDetails = (ci.treatment_memo?.details ?? '').toString().trim();
  return !!ci.treatment_kind || !!treatDetails || !!(ci.doctor_note ?? '').toString().trim();
}

log('=== 0. clinics ===');
const { data: clinics } = await sb.from('clinics').select('id, slug, name');
log(JSON.stringify(clinics, null, 2));

// 더미 환자 후보 추출: 더미 표식이 있는 customers (name like '더미'/'테스트' or 최근 더미 reservations source)
log('\n=== 1. 더미 환자 후보 (check_ins 보유 상위) ===');
// check_ins 보유 customer_id 별 카운트
const { data: allCheckins } = await sb
  .from('check_ins')
  .select('id, customer_id, checked_in_at, treatment_kind, treatment_memo, doctor_note, status, visit_type, consultation_done')
  .order('checked_in_at', { ascending: false })
  .limit(3000);
log('check_ins 총 조회 rows:', allCheckins?.length ?? 0);

const byCust = {};
for (const ci of allCheckins ?? []) {
  (byCust[ci.customer_id] ??= []).push(ci);
}
const ranked = Object.entries(byCust).sort((a, b) => b[1].length - a[1].length).slice(0, 10);
log('check_ins 보유 상위 10 customer_id (id → count):');
for (const [cid, rows] of ranked) log(`  ${cid} → ${rows.length}건`);

// 이름 조회
const topIds = ranked.map(([id]) => id);
const { data: custNames } = await sb.from('customers').select('id, name, visit_type, chart_number, created_at').in('id', topIds);
const nameMap = Object.fromEntries((custNames ?? []).map((c) => [c.id, c]));

// 더미로 보이는 후보 1명 선택: 가장 check_ins 많은 사람 (실데이터일 수도 있으니 표식 같이 출력)
log('\n=== 2. 상위 후보 이름/표식 ===');
for (const [cid, rows] of ranked) {
  const c = nameMap[cid];
  log(`  ${c?.name ?? '(이름없음)'} | id=${cid} | check_ins ${rows.length}건 | visit_type=${c?.visit_type} | chart#=${c?.chart_number}`);
}

// 진단 대상 = 상위 후보 (필요시 인자로 교체)
const TARGET = process.env.TARGET_CUSTOMER_ID || topIds[0];
log(`\n=== 3. 진단 대상 customer_id = ${TARGET} (${nameMap[TARGET]?.name ?? '?'}) ===`);

// 3-1. 방문이력/상담 = check_ins
const visits = (byCust[TARGET] ?? []).slice().sort((a, b) => (b.checked_in_at > a.checked_in_at ? 1 : -1));
log(`\n[방문이력=check_ins] 총 ${visits.length}건`);
let visibleCnt = 0;
for (const ci of visits) {
  const vis = visibleByEmptyRowFilter(ci);
  if (vis) visibleCnt++;
  log(`  ${dkey(ci.checked_in_at)} | status=${ci.status} | visit_type=${ci.visit_type} | treatment_kind=${JSON.stringify(ci.treatment_kind)} | treat_memo.details=${JSON.stringify(ci.treatment_memo?.details ?? null)} | doctor_note=${JSON.stringify((ci.doctor_note ?? '').slice(0, 20))} | consultation_done=${ci.consultation_done} → ${vis ? 'VISIBLE' : 'HIDDEN(empty-row)'}`);
}
log(`  >>> EMPTYROW 필터 통과(방문이력탭 표시) = ${visibleCnt} / ${visits.length}건`);

// 3-2. 진료차트/진료경과 = medical_charts
const { data: charts } = await sb
  .from('medical_charts')
  .select('id, customer_id, clinic_id, visit_date, created_at')
  .eq('customer_id', TARGET)
  .order('visit_date', { ascending: false });
log(`\n[진료차트/진료경과=medical_charts] 총 ${charts?.length ?? 0}건`);
for (const m of charts ?? []) log(`  visit_date=${dkey(m.visit_date)} | clinic_id=${m.clinic_id}`);

// 3-3. 치료메모
const { data: tmemos } = await sb
  .from('customer_treatment_memos')
  .select('id, customer_id, content, created_at, memo_type')
  .eq('customer_id', TARGET)
  .order('created_at', { ascending: false });
log(`\n[치료메모=customer_treatment_memos] 총 ${tmemos?.length ?? 0}건`);

// AC-1: 날짜 교차 매트릭스
log('\n=== 4. AC-1 날짜별 4종 교차 (공통키 customer_id + 날짜) ===');
const dates = new Set();
visits.forEach((v) => dates.add(dkey(v.checked_in_at)));
(charts ?? []).forEach((m) => dates.add(dkey(m.visit_date)));
(tmemos ?? []).forEach((t) => dates.add(dkey(t.created_at)));
const sortedDates = [...dates].sort().reverse();
log('날짜 | check_in(visible/total) | medical_chart | treat_memo');
for (const d of sortedDates) {
  const vAll = visits.filter((v) => dkey(v.checked_in_at) === d);
  const vVis = vAll.filter(visibleByEmptyRowFilter);
  const mc = (charts ?? []).filter((m) => dkey(m.visit_date) === d);
  const tm = (tmemos ?? []).filter((t) => dkey(t.created_at) === d);
  log(`  ${d} | check_in ${vVis.length}/${vAll.length} | medical_chart ${mc.length} | treat_memo ${tm.length}`);
}

// AC-3: 전체 dummy 분포 — check_ins treatment_kind/doctor_note 채워진 비율
log('\n=== 5. AC-3 전체 check_ins treatment 충전율 (dummy 한정 여부 단서) ===');
const total = allCheckins?.length ?? 0;
const withKind = (allCheckins ?? []).filter((c) => !!c.treatment_kind).length;
const withMemo = (allCheckins ?? []).filter((c) => !!(c.treatment_memo?.details ?? '').toString().trim()).length;
const withNote = (allCheckins ?? []).filter((c) => !!(c.doctor_note ?? '').toString().trim()).length;
const anyVisible = (allCheckins ?? []).filter(visibleByEmptyRowFilter).length;
log(`  전체 check_ins ${total}건 중: treatment_kind ${withKind} | treat_memo.details ${withMemo} | doctor_note ${withNote} | EMPTYROW통과 ${anyVisible}`);

log('\n=== DONE ===');
