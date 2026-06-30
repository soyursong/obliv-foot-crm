/**
 * T-20260630-foot-PROGRESSPUB-DUMMY-SEED — APPLY (prod, INSERT only, DDL 0)
 *
 * 목적: 김주연 총괄(jongno-foot)이 '경과분석 발행'을 직접 화면에서 테스트할 수 있도록,
 *   '경과분석' 탭 오늘(2026-07-01) 대상자로 잡히는 더미 환자 3명 + 각자 before/after(≥2 시점)
 *   시계열을 prod 에 시드. (선행 단건 시드 T-20260630-foot-PROGRESS-ANALYSIS-DUMMY-SEED 의 멀티-환자 확장판)
 *
 * 역추적(코드 근거 — ProgressTargetsSection.tsx:40-52 정본쿼리):
 *   경과분석 탭 노출조건 = reservations
 *     .eq(clinic_id, jongno) .eq(reservation_date, 오늘) .eq(progress_check_required, true) .neq(status,'cancelled')
 *   → is_simulation 필터 없음. progress_check_required/label 은 트리거 없이 직접세팅 가능
 *     (20260527000000_progress_check_resv.sql). 발행(2번차트 소견서)은 금일 check_in + medical_charts 시계열 전제.
 *   opinion_doc form_template(active)=jongno 이미 존재(probe 확인) → 별도 INSERT 안 함.
 *
 * GO_WARN 가드 3종:
 *   ① cross_crm_data_contract: phone E.164(+8210...), visit_type 표준값, clinic_id=jongno slug.
 *   ② 테스트 식별: name '테스트경과0N' + customers.is_simulation=true + memo MARKER + 가짜 전화(00000).
 *   ③ 정리 SQL 1발 동반(_cleanup.sql) — 현장 테스트 종료 후 일괄삭제(MARKER 스코프).
 *
 * 실행:
 *   node scripts/...PROGRESSPUB-DUMMY-SEED_apply.mjs            # dry-run (계획만, write 0)
 *   node scripts/...PROGRESSPUB-DUMMY-SEED_apply.mjs --apply    # 실제 INSERT (prod, supervisor data-gate)
 *
 * 안전: 환자별 단계 INSERT, 실패 시 그 시점까지 INSERT 전체 롤백(delete). 동일 MARKER 기존행 있으면 abort(중복방지).
 * 금지: DDL 0, 실환자 행 수정/삭제 0, db_change=false 유지.
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--apply');

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot (오블리브의원 서울 오리진점)
const MARKER = '[TEST-DUMMY PROGRESSPUB 20260701]';
const TODAY = '2026-07-01';
const SIGNING_DOCTOR_ID = 'cd2639d0-a3d6-47f9-901e-5b841a4ce6d0'; // 문지은 대표원장(clinic_doctors, jongno) — 의료법 signing
const SIGNING_DOCTOR_NAME = '문지은';

// ── 더미 환자 3명 (각자 baseline → 오늘 호전 시계열) ────────────────────────
const PATIENTS = [
  {
    name: '테스트경과01', phone: '+821000000701', birth: '1986-05-20', gender: 'F',
    baseDate: '2026-06-03', baseTime: '11:00:00', todayTime: '14:00:00', label: '6회 중간 경과분석',
    base:  { chief_complaint: '양측 족부 조갑백선(무좀) 초진', diagnosis: 'B35.1 조갑백선',
             clinical_progress: 'baseline: 조갑 변색·비후 약 70%, 통증 VAS 3', treatment_record: '1회차 레이저(Nd:YAG) + 외용 항진균제',
             treatment_result: '치료 시작' },
    today: { chief_complaint: '6회차 경과분석', diagnosis: 'B35.1 조갑백선 — 호전 추세',
             clinical_progress: '6회차: 조갑 변색·비후 약 30%(↓40%p), 건강조갑 신생 증가, 통증 VAS 1',
             treatment_record: '6회차 레이저(Nd:YAG)', treatment_result: '경과 양호 — 호전. 잔여 회차 지속 권고' },
  },
  {
    name: '테스트경과02', phone: '+821000000702', birth: '1979-11-08', gender: 'M',
    baseDate: '2026-05-20', baseTime: '10:30:00', todayTime: '14:30:00', label: '10회 경과분석',
    base:  { chief_complaint: '우측 무지 조갑백선 + 조갑감입 초진', diagnosis: 'B35.1 조갑백선',
             clinical_progress: 'baseline: 조갑 변색 약 80%, 측연 비후, 통증 VAS 4', treatment_record: '1회차 레이저 + 교정',
             treatment_result: '치료 시작' },
    today: { chief_complaint: '10회차 경과분석', diagnosis: 'B35.1 조갑백선 — 현저한 호전',
             clinical_progress: '10회차: 변색 약 25%(↓55%p), 신생 조갑 절반 이상, 통증 VAS 0',
             treatment_record: '10회차 레이저(Nd:YAG)', treatment_result: '경과 우수 — 마무리 단계 진입' },
  },
  {
    name: '테스트경과03', phone: '+821000000703', birth: '1993-02-14', gender: 'F',
    baseDate: '2026-06-17', baseTime: '15:30:00', todayTime: '15:00:00', label: '3개월차 경과분석',
    base:  { chief_complaint: '양측 족저 각질·균열 + 무좀 의심 초진', diagnosis: 'B35.3 족부백선',
             clinical_progress: 'baseline: 각질 비후·균열 다수, 소양감 VAS 3', treatment_record: '1회차 레이저 + 보습 프로토콜',
             treatment_result: '치료 시작' },
    today: { chief_complaint: '3개월차 경과분석', diagnosis: 'B35.3 족부백선 — 호전',
             clinical_progress: '3개월차: 각질 비후 약 20% 수준, 균열 소실, 소양감 VAS 0',
             treatment_record: '레이저 + 보습 유지요법', treatment_result: '경과 양호 — 유지관리 전환 권고' },
  },
];

console.log(`=== T-20260630-foot-PROGRESSPUB-DUMMY-SEED ${APPLY ? 'APPLY' : 'DRY-RUN'} ===`);
console.log(`clinic=jongno-foot  patients=${PATIENTS.length}  marker="${MARKER}"  today=${TODAY}`);

// 0) 중복 방지 — 동일 MARKER sim 고객 존재 시 abort
{
  const { data: dup, error } = await sb.from('customers')
    .select('id,name').eq('clinic_id', CLINIC_ID).eq('is_simulation', true).eq('memo', MARKER);
  if (error) { console.error('dup check fail:', error.message); process.exit(1); }
  if (dup && dup.length) { console.error(`ABORT: 동일 MARKER 더미 ${dup.length}건 이미 존재(${dup.map(d=>d.name).join(',')}). 정리 SQL 먼저 실행.`); process.exit(1); }
}

console.log('\n[계획] (환자당 customers 1 + check_ins 2 + reservations 2 + medical_charts 2)');
for (const p of PATIENTS) {
  console.log(`  - ${p.name} | ${p.phone} | baseline ${p.baseDate} → 오늘 ${TODAY} ${p.todayTime} "${p.label}"`);
}
console.log(`  총 INSERT: customers ${PATIENTS.length}, check_ins ${PATIENTS.length*2}, reservations ${PATIENTS.length*2}, medical_charts ${PATIENTS.length*2}`);

if (!APPLY) {
  console.log('\n[DRY-RUN] --apply 없음 → write 0. 계획만 출력.');
  process.exit(0);
}

// ── APPLY ───────────────────────────────────────────────────
const inserted = { customers: [], check_ins: [], reservations: [], medical_charts: [] };
async function rollback(reason) {
  console.error(`\n[ROLLBACK] ${reason}`);
  if (inserted.medical_charts.length) await sb.from('medical_charts').delete().in('id', inserted.medical_charts);
  if (inserted.reservations.length) await sb.from('reservations').delete().in('id', inserted.reservations);
  if (inserted.check_ins.length) await sb.from('check_ins').delete().in('id', inserted.check_ins);
  if (inserted.customers.length) await sb.from('customers').delete().in('id', inserted.customers);
  console.error('[ROLLBACK] 완료 — 시드 전 상태 복원.');
  process.exit(1);
}

for (const p of PATIENTS) {
  // visits: baseline(new) + today(returning, progress_check_required=true)
  const visits = [
    { date: p.baseDate,  time: p.baseTime,  visit_type: 'new',       checkin: 'done', progress: false, chart: p.base },
    { date: TODAY,       time: p.todayTime, visit_type: 'returning', checkin: 'done', progress: true,  chart: p.today },
  ];

  // 1) customer
  let custId = null;
  {
    const { data, error } = await sb.from('customers').insert({
      clinic_id: CLINIC_ID, name: p.name, phone: p.phone,
      visit_type: 'returning', birth_date: p.birth, gender: p.gender,
      is_simulation: true, memo: MARKER,
    }).select('id').single();
    if (error) await rollback(`customers(${p.name}) FAIL: ${error.message}`);
    custId = data.id; inserted.customers.push(custId);
    console.log(`\nOK customers ${p.name}: ${custId}`);
  }

  // 2) per visit: check_in + reservation + medical_chart
  for (const v of visits) {
    const ts = `${v.date}T${v.time}+09:00`;
    {
      const { data, error } = await sb.from('check_ins').insert({
        clinic_id: CLINIC_ID, customer_id: custId, customer_name: p.name, customer_phone: p.phone,
        checked_in_at: ts, status: v.checkin, visit_type: v.visit_type,
      }).select('id').single();
      if (error) await rollback(`check_ins(${p.name},${v.date}) FAIL: ${error.message}`);
      inserted.check_ins.push(data.id);
      console.log(`  OK check_in ${v.date} (${v.checkin})`);
    }
    {
      const { data, error } = await sb.from('reservations').insert({
        clinic_id: CLINIC_ID, customer_id: custId, customer_name: p.name, customer_phone: p.phone,
        reservation_date: v.date, reservation_time: v.time, visit_type: v.visit_type,
        status: 'confirmed', memo: MARKER, registrar_name: '테스트시드',
        progress_check_required: v.progress, progress_check_label: v.progress ? p.label : null,
      }).select('id').single();
      if (error) await rollback(`reservations(${p.name},${v.date}) FAIL: ${error.message}`);
      inserted.reservations.push(data.id);
      console.log(`  OK reservation ${v.date} (progress=${v.progress}${v.progress?', "'+p.label+'"':''})`);
    }
    {
      const { data, error } = await sb.from('medical_charts').insert({
        clinic_id: CLINIC_ID, customer_id: custId, visit_date: v.date,
        chief_complaint: v.chart.chief_complaint, diagnosis: v.chart.diagnosis,
        clinical_progress: v.chart.clinical_progress, treatment_record: v.chart.treatment_record,
        treatment_result: v.chart.treatment_result,
        signing_doctor_id: SIGNING_DOCTOR_ID, signing_doctor_name: SIGNING_DOCTOR_NAME, created_by_name: '테스트시드',
      }).select('id').single();
      if (error) await rollback(`medical_charts(${p.name},${v.date}) FAIL: ${error.message}`);
      inserted.medical_charts.push(data.id);
      console.log(`  OK medical_chart ${v.date}`);
    }
  }
}

// 3) 검증 — 오늘 경과분석 대상(정본쿼리 모사)
console.log('\n=== 검증 (ProgressTargetsSection 정본쿼리 모사) ===');
const { data: tab, error: tabErr } = await sb.from('reservations')
  .select('customer_name,reservation_time,progress_check_label,status')
  .eq('clinic_id', CLINIC_ID).eq('reservation_date', TODAY)
  .eq('progress_check_required', true).neq('status', 'cancelled')
  .order('reservation_time', { ascending: true });
if (tabErr) console.error('verify err:', tabErr.message);
console.log(`경과분석 탭 오늘(${TODAY}) 대상: ${tab?.length}건`);
(tab||[]).forEach(r => console.log(`   ${r.reservation_time?.slice(0,5)} | ${r.customer_name} | ${r.progress_check_label}`));
console.log(`\n[APPLY DONE] 더미 ${inserted.customers.length}명 시드 완료.`);
console.log('정리: scripts/T-20260630-foot-PROGRESSPUB-DUMMY-SEED_cleanup.sql 1발 실행.');
