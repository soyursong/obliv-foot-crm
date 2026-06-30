/**
 * T-20260630-foot-PROGRESS-ANALYSIS-DUMMY-SEED — APPLY (prod, INSERT only, DDL 0)
 *
 * 목적: 현장(김주연 총괄, jongno-foot)이 '경과분석 발행'을 직접 눌러 테스트할 수 있도록
 *   발행 가능한 더미 환자 1명 + before/after(≥2 시점) 시계열을 prod 에 시드.
 *
 * 역추적 결과(코드 근거):
 *   - '경과분석' 탭(ProgressTargetsSection.tsx:34-50) = reservations.progress_check_required=TRUE 당일 예약 read-only 노출.
 *     progress_check_required/label 은 트리거 없이 FE/직접 세팅(20260527000000_progress_check_resv.sql) → INSERT 시 직접 지정.
 *   - 실제 '발행'(소견서/진료서류)은 환자 2번차트에서 check_ins(금일 내원) 기반 동작 → 오늘자 check_in 필요.
 *   - 경과(before/after)는 회차 기반 → medical_charts 2시점(baseline 6/10 + 6회차 7/01)으로 호전 추세 표현.
 *   - opinion_doc form_template(active) 는 jongno 에 이미 존재(probe 확인) → 별도 INSERT 안 함.
 *
 * GO_WARN 가드 3종:
 *   ① cross_crm_data_contract: phone E.164(+8210...), visit_type 표준값, clinic_id=jongno slug.
 *   ② 테스트 식별: name '테스트' 접두 + customers.is_simulation=true + memo MARKER.
 *   ③ 정리 SQL 1발 동반(_cleanup.sql) — 현장 테스트 종료 후 일괄삭제.
 *
 * 실행:
 *   node scripts/...SEED_apply.mjs            # dry-run (계획 출력, write 0)
 *   node scripts/...SEED_apply.mjs --apply    # 실제 INSERT (planner prod-INSERT 인가, supervisor data-gate)
 *
 * 안전: 단계별 INSERT, 후속 단계 실패 시 직전 INSERT 롤백(delete). 동일 MARKER 기존행 있으면 abort(중복방지).
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--apply');

const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // jongno-foot (오블리브의원 서울 오리진점)
const MARKER = '[TEST-DUMMY 경과분석발행 20260701]';
const TODAY = '2026-07-01';
const BASE = '2026-06-10';
const NAME = '테스트경과분석';                 // '테스트' 접두 — 현장 실환자 혼동 방지
const PHONE = '+821088090701';                 // E.164, 테스트 prefix 8809
const LABEL = '6회 중간 경과분석';

console.log(`=== T-20260630-foot-PROGRESS-ANALYSIS-DUMMY-SEED ${APPLY ? 'APPLY' : 'DRY-RUN'} ===`);
console.log(`clinic=jongno-foot  patient="${NAME}"  phone=${PHONE}  marker="${MARKER}"`);

// 0) 중복 방지 — 동일 MARKER sim 고객 존재 시 abort
{
  const { data: dup, error } = await sb.from('customers')
    .select('id').eq('clinic_id', CLINIC_ID).eq('is_simulation', true).eq('memo', MARKER);
  if (error) { console.error('dup check fail:', error.message); process.exit(1); }
  if (dup && dup.length) { console.error(`ABORT: 동일 MARKER 더미 ${dup.length}건 이미 존재(id=${dup.map(d=>d.id).join(',')}). 정리 SQL 먼저 실행.`); process.exit(1); }
}

// ── 계획 데이터 ─────────────────────────────────────────────
const customerRow = {
  clinic_id: CLINIC_ID,
  name: NAME,
  phone: PHONE,
  visit_type: 'returning',
  birth_date: '1986-05-20',
  gender: 'F',
  is_simulation: true,
  memo: MARKER,
};

// before/after 시계열 정의 (visit_date 상이 → same-day 충돌 없음)
const visits = [
  { date: BASE,  time: '11:00:00', visit_type: 'new',       checkin: 'done', progress: false,
    chart: { chief_complaint: '양측 족부 조갑백선(무좀) 초진', diagnosis: 'B35.1 조갑백선',
             clinical_progress: 'baseline: 조갑 변색·비후 약 70%, 통증 VAS 3', treatment_record: '1회차 레이저(Nd:YAG) + 외용 항진균제',
             treatment_result: '치료 시작' } },
  { date: TODAY, time: '14:00:00', visit_type: 'returning', checkin: 'done', progress: true,
    chart: { chief_complaint: '6회차 경과분석', diagnosis: 'B35.1 조갑백선 — 호전 추세',
             clinical_progress: '6회차: 조갑 변색·비후 약 30%(↓40%p), 건강조갑 신생 증가, 통증 VAS 1',
             treatment_record: '6회차 레이저(Nd:YAG)', treatment_result: '경과 양호 — 호전. 잔여 회차 지속 권고' } },
];

console.log('\n[계획]');
console.log('  customers   : 1 (test patient)');
console.log(`  check_ins   : ${visits.length} (${visits.map(v=>v.date).join(', ')})`);
console.log(`  reservations: ${visits.length} (오늘=progress_check_required:true, label="${LABEL}")`);
console.log(`  medical_charts: ${visits.length} (before/after 시계열)`);

if (!APPLY) {
  console.log('\n[DRY-RUN] --apply 없음 → write 0. 계획만 출력.');
  process.exit(0);
}

// ── APPLY ───────────────────────────────────────────────────
let custId = null;
const inserted = { check_ins: [], reservations: [], medical_charts: [] };
async function rollback(reason) {
  console.error(`\n[ROLLBACK] ${reason}`);
  if (inserted.medical_charts.length) await sb.from('medical_charts').delete().in('id', inserted.medical_charts);
  if (inserted.reservations.length) await sb.from('reservations').delete().in('id', inserted.reservations);
  if (inserted.check_ins.length) await sb.from('check_ins').delete().in('id', inserted.check_ins);
  if (custId) await sb.from('customers').delete().eq('id', custId);
  console.error('[ROLLBACK] 완료 — 시드 전 상태 복원.');
  process.exit(1);
}

// 1) customer
{
  const { data, error } = await sb.from('customers').insert(customerRow).select('id').single();
  if (error) { console.error('CUSTOMER INSERT FAIL:', error.message); process.exit(1); }
  custId = data.id;
  console.log(`\nOK customers: ${custId}`);
}

// 2) check_ins + reservations + medical_charts (per visit)
for (const v of visits) {
  const ts = `${v.date}T${v.time}+09:00`;
  // check_in
  {
    const { data, error } = await sb.from('check_ins').insert({
      clinic_id: CLINIC_ID, customer_id: custId, customer_name: NAME, customer_phone: PHONE,
      checked_in_at: ts, status: v.checkin, visit_type: v.visit_type,
    }).select('id').single();
    if (error) await rollback(`check_ins(${v.date}) FAIL: ${error.message}`);
    inserted.check_ins.push(data.id);
    console.log(`OK check_in ${v.date} (${v.checkin}) ${data.id}`);
  }
  // reservation
  {
    const row = {
      clinic_id: CLINIC_ID, customer_id: custId, customer_name: NAME, customer_phone: PHONE,
      reservation_date: v.date, reservation_time: v.time, visit_type: v.visit_type,
      status: 'confirmed', memo: MARKER, registrar_name: '테스트시드',
      progress_check_required: v.progress, progress_check_label: v.progress ? LABEL : null,
    };
    const { data, error } = await sb.from('reservations').insert(row).select('id').single();
    if (error) await rollback(`reservations(${v.date}) FAIL: ${error.message}`);
    inserted.reservations.push(data.id);
    console.log(`OK reservation ${v.date} (progress=${v.progress}) ${data.id}`);
  }
  // medical_chart
  {
    const { data, error } = await sb.from('medical_charts').insert({
      clinic_id: CLINIC_ID, customer_id: custId, visit_date: v.date,
      chief_complaint: v.chart.chief_complaint, diagnosis: v.chart.diagnosis,
      clinical_progress: v.chart.clinical_progress, treatment_record: v.chart.treatment_record,
      treatment_result: v.chart.treatment_result,
      signing_doctor_id: 'cd2639d0-a3d6-47f9-901e-5b841a4ce6d0', // 문지은 대표원장(clinic_doctors, jongno) — 의료법 signing 필수
      signing_doctor_name: '문지은', created_by_name: '테스트시드',
    }).select('id').single();
    if (error) await rollback(`medical_charts(${v.date}) FAIL: ${error.message}`);
    inserted.medical_charts.push(data.id);
    console.log(`OK medical_chart ${v.date} ${data.id}`);
  }
}

// 3) 검증
console.log('\n=== 검증 ===');
const { data: vResv } = await sb.from('reservations')
  .select('id,reservation_date,progress_check_required,progress_check_label')
  .eq('customer_id', custId).eq('progress_check_required', true);
console.log(`경과분석 대상 예약(오늘): ${vResv?.length}건 — ${vResv?.map(r=>`${r.reservation_date}/${r.progress_check_label}`).join(', ')}`);
const { data: vMc } = await sb.from('medical_charts').select('id,visit_date').eq('customer_id', custId).order('visit_date');
console.log(`medical_charts 시계열: ${vMc?.length}건 — ${vMc?.map(m=>m.visit_date).join(' → ')}`);
const { data: vCi } = await sb.from('check_ins').select('id,checked_in_at').eq('customer_id', custId);
console.log(`check_ins: ${vCi?.length}건`);
console.log(`\n[APPLY DONE] customer_id=${custId}  patient="${NAME}"`);
console.log('정리: scripts/T-20260630-foot-PROGRESS-ANALYSIS-DUMMY-SEED_cleanup.sql 1발 실행.');
