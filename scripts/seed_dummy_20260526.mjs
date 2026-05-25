/**
 * 풋센터 CRM 더미 예약 데이터 — 5/26 초진/재진 시간대별 72건
 * T-20260525-foot-DUMMY-DATA-GEN (P1)
 *
 * 스펙:
 *   날짜:   2026-05-26
 *   슬롯:   11:00~19:00 (1시간 간격, 9슬롯)
 *   구성:   슬롯당 초진 4명 + 재진 4명 = 8명/슬롯
 *   합계:   초진 36명 + 재진 36명 = 72명
 *
 *   이름:   더미_초진_HHMM_N / 더미_재진_HHMM_N
 *   전화:   +821099050201~0236 (초진) / +821099050237~0272 (재진)
 *           ※ TEST5(5/17) +821099050001~0020 범위와 분리
 *
 * 마킹:   is_simulation=true, created_by='dummy-seed-20260526'
 * 롤백:   node scripts/rollback_dummy_20260526.mjs
 *
 * 선행:
 *   T-20260521-foot-DUMMY-TEST-DATA (V1, deployed)
 *   T-20260525-foot-DUMMY-TEST-DATA-V2 (deployed)
 *   T-20260525-foot-DUMMY-DATA-CLEANUP (deploy-ready)
 */

import { createClient } from '@supabase/supabase-js';

// ============================================================
// === 확정 파라미터 ===
// ============================================================
const TARGET_DATE = '2026-05-26';
const PAST_DATE   = '2026-05-01'; // 재진 판별용 과거 체크인 날짜
const SEED_TAG    = 'dummy-seed-20260526';

/** 9슬롯: 11:00~19:00 (1시간 간격) */
const SLOTS = [
  '11:00', '12:00', '13:00', '14:00', '15:00',
  '16:00', '17:00', '18:00', '19:00',
];

const NEW_PER_SLOT = 4; // 슬롯당 초진
const RET_PER_SLOT = 4; // 슬롯당 재진

/**
 * 전화번호 구간
 *   초진 seq 1~36  → +821099050201~+821099050236
 *   재진 seq 1~36  → +821099050237~+821099050272
 *
 * 기존 사용 구간과 충돌 없음:
 *   +821099050001~0020 : 5/17 [TEST5] 20건 (name: [TEST5]초진XX)
 *   +821000000201~0296 : 5/22 V1 96건
 *   +821099060001~0136 : 5/25 V2 136건
 *   +82109999XXXX      : 5/25 timeslot 64건
 *   +821099050201~0272 : ← 이번 (72건)
 */
const PHONE_BASE_NEW = 200; // 초진: 201~236
const PHONE_BASE_RET = 236; // 재진: 237~272

const SUPABASE_URL     = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── 유틸 ───────────────────────────────────────────────────
async function must(label, promise) {
  const { data, error } = await promise;
  if (error) {
    console.error(`❌ ${label}:`, error.message, JSON.stringify(error));
    throw new Error(`${label}: ${error.message}`);
  }
  return data;
}

/** 전화번호 생성 (E.164) */
function makePhone(type, seq) {
  const base = type === 'new' ? PHONE_BASE_NEW : PHONE_BASE_RET;
  return '+82109905' + String(base + seq).padStart(4, '0');
}

/**
 * 이름 생성
 *   더미_초진_1100_1, 더미_초진_1100_2, ...
 *   더미_재진_1100_1, 더미_재진_1100_2, ...
 */
function makeName(type, slotTime, idx) {
  const label = type === 'new' ? '초진' : '재진';
  const hhmm  = slotTime.replace(':', ''); // '11:00' → '1100'
  return `더미_${label}_${hhmm}_${idx}`;
}

/** 타임스탬프 생성 (KST) */
function makeTs(date, hour, min = 0) {
  return `${date}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+09:00`;
}

// ─── INSERT 헬퍼 ─────────────────────────────────────────────
async function insertCustomer(clinicId, name, phone, visitType) {
  const data = await must(`고객 ${name}`,
    supabase.from('customers').insert({
      clinic_id:      clinicId,
      name,
      phone,
      visit_type:     visitType,
      is_simulation:  true,
      inflow_channel: visitType === 'new' ? 'meta_ads' : 'returning',
      memo:           `[더미 5/26] ${visitType === 'new' ? '초진' : '재진'}`,
      created_by:     SEED_TAG,
    }).select('id').single()
  );
  return data.id;
}

async function insertReservation(clinicId, customerId, name, phone, slotTime, visitType) {
  await must(`예약 ${name}`,
    supabase.from('reservations').insert({
      clinic_id:        clinicId,
      customer_id:      customerId,
      customer_name:    name,
      customer_phone:   phone,
      reservation_date: TARGET_DATE,
      reservation_time: slotTime,
      visit_type:       visitType,
      status:           'confirmed',
      memo:             `더미 | ${visitType === 'new' ? '초진' : '재진'} ${slotTime}`,
      created_by:       SEED_TAG,
    })
  );
}

async function insertPastCheckIn(clinicId, customerId, name, phone, seq, slotTime) {
  const [h, m] = slotTime.split(':').map(Number);
  const endTotalMin = h * 60 + m + 30;
  const endH = Math.floor(endTotalMin / 60);
  const endM = endTotalMin % 60;

  await must(`과거체크인 ${name}`,
    supabase.from('check_ins').insert({
      clinic_id:      clinicId,
      customer_id:    customerId,
      customer_name:  name,
      customer_phone: phone,
      visit_type:     'returning',
      status:         'done',
      queue_number:   seq + 300,
      checked_in_at:  makeTs(PAST_DATE, h, m),
      completed_at:   makeTs(PAST_DATE, endH, endM),
      sort_order:     seq + 300,
      notes:          JSON.stringify({ seed: SEED_TAG, past_checkin: true }),
    })
  );
}

// ─── 메인 ───────────────────────────────────────────────────
async function main() {
  const TOTAL_NEW = SLOTS.length * NEW_PER_SLOT; // 36
  const TOTAL_RET = SLOTS.length * RET_PER_SLOT; // 36
  const TOTAL     = TOTAL_NEW + TOTAL_RET;        // 72

  console.log('='.repeat(62));
  console.log('T-20260525-foot-DUMMY-DATA-GEN');
  console.log('5/26 초진/재진 시간대별 더미 예약 데이터 72건 삽입');
  console.log('='.repeat(62));
  console.log(`날짜:   ${TARGET_DATE}`);
  console.log(`슬롯:   ${SLOTS.join(' / ')}`);
  console.log(`슬롯당: 초진 ${NEW_PER_SLOT}명 + 재진 ${RET_PER_SLOT}명`);
  console.log(`예상:   초진 ${TOTAL_NEW}명 + 재진 ${TOTAL_RET}명 = 총 ${TOTAL}명`);
  console.log(`전화:   +821099050201~0236(초진) / +821099050237~0272(재진)`);
  console.log(`태그:   created_by='${SEED_TAG}'`);

  // ── STEP 1: 클리닉 조회 ──────────────────────────────────
  console.log('\n[STEP 1] 클리닉 조회...');
  const clinic = await must('클리닉 조회',
    supabase.from('clinics').select('id, name').eq('slug', 'jongno-foot').single()
  );
  const clinicId = clinic.id;
  console.log(`  ✅ ${clinic.name} (${clinicId})`);

  // ── STEP 2: 중복 방지 ────────────────────────────────────
  console.log('\n[STEP 2] 중복 체크...');
  const { data: dupCheck } = await supabase
    .from('customers')
    .select('id')
    .eq('created_by', SEED_TAG)
    .eq('clinic_id', clinicId)
    .limit(1);
  if (dupCheck && dupCheck.length > 0) {
    console.warn(`  ⚠️  '${SEED_TAG}' 태그 데이터가 이미 존재합니다.`);
    console.warn('  롤백 후 재실행: node scripts/rollback_dummy_20260526.mjs');
    process.exit(1);
  }
  console.log('  ✅ 중복 없음 — 삽입 가능');

  // ── STEP 3: 슬롯별 데이터 삽입 ──────────────────────────
  console.log('\n[STEP 3] 슬롯별 데이터 삽입...\n');

  let newSeq      = 0;
  let retSeq      = 0;
  let insertedNew = 0;
  let insertedRet = 0;

  for (const slotTime of SLOTS) {
    console.log(`  ⏰ ${slotTime}`);

    // 초진 4명
    for (let i = 1; i <= NEW_PER_SLOT; i++) {
      newSeq++;
      const name  = makeName('new', slotTime, i);
      const phone = makePhone('new', newSeq);
      const cId   = await insertCustomer(clinicId, name, phone, 'new');
      await insertReservation(clinicId, cId, name, phone, slotTime, 'new');
      insertedNew++;
      process.stdout.write(`    ✔ ${name}  ${phone}\n`);
    }

    // 재진 4명
    for (let i = 1; i <= RET_PER_SLOT; i++) {
      retSeq++;
      const name  = makeName('returning', slotTime, i);
      const phone = makePhone('returning', retSeq);
      const cId   = await insertCustomer(clinicId, name, phone, 'returning');
      await insertReservation(clinicId, cId, name, phone, slotTime, 'returning');
      await insertPastCheckIn(clinicId, cId, name, phone, retSeq, slotTime);
      insertedRet++;
      process.stdout.write(`    ✔ ${name}  ${phone}  (과거체크인: ${PAST_DATE})\n`);
    }

    console.log();
  }

  // ── STEP 4: AC 검증 ──────────────────────────────────────
  console.log('[STEP 4] AC 검증...');

  // AC-1: customers 72건
  const { count: custCount } = await supabase
    .from('customers')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', SEED_TAG)
    .eq('clinic_id', clinicId);
  console.log(`  AC-1 customers: ${custCount}건 ${custCount === TOTAL ? '✅' : '❌'} (예상: ${TOTAL})`);

  // AC-2: reservations 72건 (TARGET_DATE)
  const { count: rsvCount } = await supabase
    .from('reservations')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', SEED_TAG)
    .eq('clinic_id', clinicId)
    .eq('reservation_date', TARGET_DATE);
  console.log(`  AC-2 reservations(${TARGET_DATE}): ${rsvCount}건 ${rsvCount === TOTAL ? '✅' : '❌'} (예상: ${TOTAL})`);

  // AC-3: 각 슬롯별 8건 확인 (샘플 2슬롯)
  for (const sampleSlot of ['11:00', '19:00']) {
    const { count: slotCount } = await supabase
      .from('reservations')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', SEED_TAG)
      .eq('reservation_date', TARGET_DATE)
      .eq('reservation_time', sampleSlot + ':00');
    // reservation_time 저장 형식이 'HH:MM:SS' 일 수 있음
    const { count: slotCount2 } = await supabase
      .from('reservations')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', SEED_TAG)
      .eq('reservation_date', TARGET_DATE)
      .eq('reservation_time', sampleSlot);
    const cnt = (slotCount || 0) + (slotCount2 || 0);
    const expected = NEW_PER_SLOT + RET_PER_SLOT;
    console.log(`  AC-3 슬롯 ${sampleSlot}: ${cnt}건 ${cnt === expected ? '✅' : '❌'} (예상: ${expected})`);
  }

  // 샘플 출력
  const { data: samples } = await supabase
    .from('reservations')
    .select('customer_name, customer_phone, reservation_time, visit_type, status')
    .eq('created_by', SEED_TAG)
    .eq('reservation_date', TARGET_DATE)
    .order('reservation_time')
    .limit(8);
  console.log('\n  샘플 8건:');
  samples?.forEach(s =>
    console.log(`    ${s.customer_name}  ${s.customer_phone}  ${s.reservation_time}  ${s.visit_type}  ${s.status}`)
  );

  console.log('\n' + '='.repeat(62));
  console.log('✅ 5/26 더미 예약 데이터 삽입 완료');
  console.log(`   초진: ${insertedNew}명 | 재진: ${insertedRet}명 | 합계: ${insertedNew + insertedRet}명`);
  console.log(`   예약: ${insertedNew + insertedRet}건 (${TARGET_DATE})`);
  console.log(`   과거체크인(재진 판별): ${insertedRet}건 (${PAST_DATE})`);
  console.log('\n── 이름 패턴 ────────────────────────────────────────────');
  console.log('   초진: 더미_초진_1100_1~4 / 더미_초진_1200_1~4 / ...');
  console.log('   재진: 더미_재진_1100_1~4 / 더미_재진_1200_1~4 / ...');
  console.log('\n── 전화번호 ─────────────────────────────────────────────');
  console.log('   초진: 010-9905-0201 ~ 010-9905-0236');
  console.log('   재진: 010-9905-0237 ~ 010-9905-0272');
  console.log('\n── 롤백 ─────────────────────────────────────────────────');
  console.log('   node scripts/rollback_dummy_20260526.mjs');
  console.log('='.repeat(62));
}

main().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
