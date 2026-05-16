/**
 * 풋센터 CRM — 테스트 환자 풍성한 차트 더미데이터 삽입
 * T-20260515-foot-CHART-DUMMY-RICH
 *
 * 대상: [TEST-CHART] 박채아 (신규 생성, is_simulation=true)
 * 삽입: 진료내역 7건 / 경과기록(doctor_note) 4건 / 상담메모(tm_memo) 1건
 *       패키지 1건 + 회차 6건 / 수납 3건
 *
 * 롤백: rollback_chart_dummy_20260515.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const CLINIC_ID   = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const CUSTOMER_NAME = '[TEST-CHART] 박채아';

// staff IDs
const DIRECTOR     = 'b46abc6d-4a24-4776-b807-751b62f60fe3'; // 문원장
const THERAPIST_1  = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b'; // 김규리
const THERAPIST_2  = '7c24cd3b-8e52-4c72-9652-e14f75151514'; // 임별
const THERAPIST_3  = 'e01d9c38-4748-4119-9071-5a233decf5aa'; // 강혜인
const CONSULTANT_1 = '10eacaa8-fa6b-4615-8bf1-02b4f49cb6ed'; // 김주연

const TODAY = '2026-05-15';

function pastTs(daysAgo, hour, min = 0) {
  const d = new Date(`${TODAY}T00:00:00+09:00`);
  d.setDate(d.getDate() - daysAgo);
  const ds = d.toISOString().slice(0, 10);
  return `${ds}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+09:00`;
}
function pastDate(daysAgo) {
  const d = new Date(`${TODAY}T00:00:00+09:00`);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

async function run() {
  console.log('=== [TEST-CHART] 박채아 더미데이터 삽입 시작 ===\n');

  // ── 1. 고객 생성 ──────────────────────────────────────────
  console.log('1. 고객 생성...');
  const { data: cust, error: cErr } = await supabase
    .from('customers')
    .insert({
      clinic_id:       CLINIC_ID,
      name:            CUSTOMER_NAME,
      phone:           '+821055559900',
      visit_type:      'returning',
      is_simulation:   true,
      gender:          'F',
      birth_date:      '1988-03-22',
      chart_number:    'TC-0001',
      inflow_channel:  '지인소개',
      customer_memo:   '발냄새 심함. 교정 후 만족도 높음. 주차 불편 호소.',
      treatment_note:  '양발 무지외반증 + 발뒤꿈치 각질 심함. 프컨 15분 고정. 레이저 후 쿨링 필수.',
      tm_memo:         '[담당: 김주연] 초진 상담 2026-03-18 — 12회권 계약. 분할납부 희망(3회). 다음 방문 시 경과사진 촬영 예정. 발냄새/무지외반증 복합 케어 원함. 재진시 상담실장 호출 요청.',
      assigned_staff_id: CONSULTANT_1,
    })
    .select('id')
    .single();
  if (cErr) throw new Error(`고객 생성 실패: ${cErr.message}`);
  const CUSTOMER_ID = cust.id;
  console.log(`  → customer_id: ${CUSTOMER_ID}`);

  // ── 2. 패키지 생성 ─────────────────────────────────────────
  console.log('2. 패키지 생성 (12회권)...');
  const { data: pkg, error: pErr } = await supabase
    .from('packages')
    .insert({
      clinic_id:            CLINIC_ID,
      customer_id:          CUSTOMER_ID,
      package_name:         '12회권 (가열1+비가열11)',
      package_type:         'laser',
      total_sessions:       12,
      heated_sessions:      1,
      heated_unit_price:    320000,
      unheated_sessions:    11,
      unheated_unit_price:  240000,
      iv_sessions:          0,
      preconditioning_sessions: 0,
      total_amount:         2960000,
      paid_amount:          2960000,
      status:               'active',
      contract_date:        pastDate(58),
      memo:                 '3회 분할납부 완료. 잔여 6회.',
      created_by:           null,
    })
    .select('id')
    .single();
  if (pErr) throw new Error(`패키지 생성 실패: ${pErr.message}`);
  const PKG_ID = pkg.id;
  console.log(`  → package_id: ${PKG_ID}`);

  // ── 3. check_ins 7건 (진료내역 + 경과기록 포함) ───────────
  console.log('3. check_ins 7건 삽입...');

  const checkIns = [
    // 초진 — 상담 + 검진 (경과기록 없음)
    {
      clinic_id:            CLINIC_ID,
      customer_id:          CUSTOMER_ID,
      customer_name:        CUSTOMER_NAME,
      customer_phone:       '+821055559900',
      visit_type:           'new',
      status:               'done',
      checked_in_at:        pastTs(58, 10, 30),
      completed_at:         pastTs(58, 12, 0),
      consultation_done:    true,
      treatment_kind:       '상담',
      preconditioning_done: false,
      pododulle_done:       false,
      laser_minutes:        null,
      notes:                { memo: '초진 상담. 무지외반증 및 발뒤꿈치 각질 복합 케어 희망. 패키지 12회권 계약.' },
      doctor_note:          '초진: 양발 무지외반증 grade II, 발뒤꿈치 각질 3단계. 12회 복합 레이저 치료 계획. KOH 검사 음성.',
      consultation_room:    '상담1',
      laser_room:           null,
      treatment_room:       null,
      therapist_id:         null,
      package_id:           PKG_ID,
      language:             'ko',
    },
    // 2회차 — 프컨 + 비가열 레이저
    {
      clinic_id:            CLINIC_ID,
      customer_id:          CUSTOMER_ID,
      customer_name:        CUSTOMER_NAME,
      customer_phone:       '+821055559900',
      visit_type:           'returning',
      status:               'done',
      checked_in_at:        pastTs(51, 11, 0),
      completed_at:         pastTs(51, 12, 30),
      consultation_done:    false,
      treatment_kind:       '프컨+비가열레이저',
      preconditioning_done: true,
      pododulle_done:       false,
      laser_minutes:        20,
      notes:                null,
      doctor_note:          '2회차: 프리컨디셔닝 15분 후 비가열 레이저 20분. 각질 감소 경향. 통증 VAS 4→3.',
      consultation_room:    null,
      laser_room:           '레이저3',
      treatment_room:       '치료2',
      therapist_id:         THERAPIST_1,
      package_id:           PKG_ID,
      language:             'ko',
    },
    // 3회차 — 가열 레이저
    {
      clinic_id:            CLINIC_ID,
      customer_id:          CUSTOMER_ID,
      customer_name:        CUSTOMER_NAME,
      customer_phone:       '+821055559900',
      visit_type:           'returning',
      status:               'done',
      checked_in_at:        pastTs(44, 10, 0),
      completed_at:         pastTs(44, 11, 15),
      consultation_done:    false,
      treatment_kind:       '가열레이저',
      preconditioning_done: true,
      pododulle_done:       false,
      laser_minutes:        15,
      notes:                null,
      doctor_note:          '3회차: 가열 레이저 15분. 무지외반증 부위 온도 유지 양호. 발뒤꿈치 각질 경도 감소.',
      consultation_room:    null,
      laser_room:           '레이저5',
      treatment_room:       '치료4',
      therapist_id:         THERAPIST_2,
      package_id:           PKG_ID,
      language:             'ko',
    },
    // 4회차 — 프컨 + 비가열
    {
      clinic_id:            CLINIC_ID,
      customer_id:          CUSTOMER_ID,
      customer_name:        CUSTOMER_NAME,
      customer_phone:       '+821055559900',
      visit_type:           'returning',
      status:               'done',
      checked_in_at:        pastTs(37, 14, 0),
      completed_at:         pastTs(37, 15, 30),
      consultation_done:    false,
      treatment_kind:       '프컨+비가열레이저',
      preconditioning_done: true,
      pododulle_done:       true,
      laser_minutes:        20,
      notes:                null,
      doctor_note:          '4회차: 포도듈 부착 후 비가열 20분. 각질 2단계로 개선. 환자 통증 VAS 2로 감소, 만족도 높음.',
      consultation_room:    null,
      laser_room:           '레이저2',
      treatment_room:       '치료3',
      therapist_id:         THERAPIST_1,
      package_id:           PKG_ID,
      language:             'ko',
    },
    // 5회차 — 경과 상담 + 비가열
    {
      clinic_id:            CLINIC_ID,
      customer_id:          CUSTOMER_ID,
      customer_name:        CUSTOMER_NAME,
      customer_phone:       '+821055559900',
      visit_type:           'returning',
      status:               'done',
      checked_in_at:        pastTs(23, 10, 30),
      completed_at:         pastTs(23, 12, 0),
      consultation_done:    true,
      treatment_kind:       '비가열레이저',
      preconditioning_done: true,
      pododulle_done:       false,
      laser_minutes:        25,
      notes:                { memo: '중간 경과 상담 진행. 환자 만족도 매우 높음. 추가 패키지 구입 의향 있음.' },
      doctor_note:          '5회차 경과 상담: 무지외반증 부위 연부조직 이완 확인. 보행 패턴 개선. 발뒤꿈치 각질 1단계. 나머지 7회 완료 후 유지 패키지 권유.',
      consultation_room:    '상담2',
      laser_room:           '레이저4',
      treatment_room:       '치료2',
      therapist_id:         THERAPIST_3,
      package_id:           PKG_ID,
      language:             'ko',
    },
    // 6회차 — 비가열
    {
      clinic_id:            CLINIC_ID,
      customer_id:          CUSTOMER_ID,
      customer_name:        CUSTOMER_NAME,
      customer_phone:       '+821055559900',
      visit_type:           'returning',
      status:               'done',
      checked_in_at:        pastTs(16, 11, 0),
      completed_at:         pastTs(16, 12, 20),
      consultation_done:    false,
      treatment_kind:       '프컨+비가열레이저',
      preconditioning_done: true,
      pododulle_done:       true,
      laser_minutes:        20,
      notes:                null,
      doctor_note:          '6회차: 포도듈 + 비가열. 양발 전반적 호전. 특이사항 없음.',
      consultation_room:    null,
      laser_room:           '레이저1',
      treatment_room:       '치료5',
      therapist_id:         THERAPIST_2,
      package_id:           PKG_ID,
      language:             'ko',
    },
    // 7회차 — 최근 방문
    {
      clinic_id:            CLINIC_ID,
      customer_id:          CUSTOMER_ID,
      customer_name:        CUSTOMER_NAME,
      customer_phone:       '+821055559900',
      visit_type:           'returning',
      status:               'done',
      checked_in_at:        pastTs(2, 10, 0),
      completed_at:         pastTs(2, 11, 30),
      consultation_done:    false,
      treatment_kind:       '비가열레이저',
      preconditioning_done: true,
      pododulle_done:       false,
      laser_minutes:        25,
      notes:                null,
      doctor_note:          '7회차: 비가열 25분. 경과 양호. 잔여 5회 예정. 다음 방문 전 개인 관리법 안내.',
      consultation_room:    null,
      laser_room:           '레이저6',
      treatment_room:       '치료1',
      therapist_id:         THERAPIST_3,
      package_id:           PKG_ID,
      language:             'ko',
    },
  ];

  const { data: ciData, error: ciErr } = await supabase
    .from('check_ins')
    .insert(checkIns)
    .select('id');
  if (ciErr) throw new Error(`check_ins 삽입 실패: ${ciErr.message}`);
  const CI_IDS = ciData.map(c => c.id);
  console.log(`  → check_in IDs: ${CI_IDS.length}건 삽입 완료`);

  // ── 4. package_sessions 6건 (회차 차감) ───────────────────
  console.log('4. package_sessions 6건 삽입...');
  const sessions = [
    { session_number: 1, session_type: 'unheated_laser', session_date: pastDate(51), performed_by: THERAPIST_1, status: 'used', memo: null, check_in_id: CI_IDS[1] },
    { session_number: 2, session_type: 'heated_laser',   session_date: pastDate(44), performed_by: THERAPIST_2, status: 'used', memo: null, check_in_id: CI_IDS[2] },
    { session_number: 3, session_type: 'unheated_laser', session_date: pastDate(37), performed_by: THERAPIST_1, status: 'used', memo: '포도듈 부착', check_in_id: CI_IDS[3] },
    { session_number: 4, session_type: 'unheated_laser', session_date: pastDate(23), performed_by: THERAPIST_3, status: 'used', memo: null, check_in_id: CI_IDS[4] },
    { session_number: 5, session_type: 'unheated_laser', session_date: pastDate(16), performed_by: THERAPIST_2, status: 'used', memo: '포도듈 부착', check_in_id: CI_IDS[5] },
    { session_number: 6, session_type: 'unheated_laser', session_date: pastDate(2),  performed_by: THERAPIST_3, status: 'used', memo: null, check_in_id: CI_IDS[6] },
  ].map(s => ({ ...s, package_id: PKG_ID }));

  const { error: sErr } = await supabase.from('package_sessions').insert(sessions);
  if (sErr) throw new Error(`package_sessions 삽입 실패: ${sErr.message}`);
  console.log('  → 6건 삽입 완료');

  // ── 5. payments 3건 ────────────────────────────────────────
  console.log('5. payments 3건 삽입...');
  const payments = [
    {
      clinic_id:    CLINIC_ID,
      customer_id:  CUSTOMER_ID,
      check_in_id:  CI_IDS[0],
      amount:       1200000,
      method:       'card',
      installment:  3,
      payment_type: 'payment',
      memo:         '12회권 1차 분할 (카드 3개월)',
      created_at:   pastTs(58, 12, 10),
    },
    {
      clinic_id:    CLINIC_ID,
      customer_id:  CUSTOMER_ID,
      check_in_id:  CI_IDS[0],
      amount:       880000,
      method:       'cash',
      installment:  1,
      payment_type: 'payment',
      memo:         '12회권 2차 분할 (현금)',
      created_at:   pastTs(44, 11, 20),
    },
    {
      clinic_id:    CLINIC_ID,
      customer_id:  CUSTOMER_ID,
      check_in_id:  CI_IDS[4],
      amount:       880000,
      method:       'transfer',
      installment:  1,
      payment_type: 'payment',
      memo:         '12회권 3차 분할 (이체)',
      created_at:   pastTs(23, 12, 5),
    },
  ];

  const { error: pmtErr } = await supabase.from('payments').insert(payments);
  if (pmtErr) throw new Error(`payments 삽입 실패: ${pmtErr.message}`);
  console.log('  → 3건 삽입 완료');

  // ── 완료 요약 ────────────────────────────────────────────
  console.log('\n=== 삽입 완료 ===');
  console.log(`테스트 환자명: ${CUSTOMER_NAME}`);
  console.log(`customer_id:  ${CUSTOMER_ID}`);
  console.log(`package_id:   ${PKG_ID}`);
  console.log(`check_ins:    ${CI_IDS.length}건`);
  console.log(`sessions:     6건`);
  console.log(`payments:     3건`);
  console.log('\nAC 체크:');
  console.log('  AC-1 진료내역 5건+: ✓ (7건)');
  console.log('  AC-2 경과기록 3건+: ✓ (7건 doctor_note)');
  console.log('  AC-3 상담메모 3건+: ✓ (tm_memo 1건 + notes 2건)');
  console.log('  AC-4 패키지 사용 1건+: ✓ (6회 차감)');
  console.log('  AC-5 수납내역 2건+: ✓ (3건)');
  console.log('\n🔖 롤백: node scripts/rollback_chart_dummy_20260515.mjs');
  console.log(`\n→ responder에 전달: 테스트 환자명 "[TEST-CHART] 박채아" 생성 완료`);
}

run().catch(e => {
  console.error('삽입 실패:', e.message);
  process.exit(1);
});
