/**
 * 풋센터 CRM 더미 데이터 — 5/25 현장 테스트용 V2
 * T-20260525-foot-DUMMY-TEST-DATA-V2 (P1)
 *
 * 구성: 초진 68명 + 재진 68명 = 136명
 *   ┌─ 기본 12슬롯: 초진 4명 + 재진 4명 → 초진48 + 재진48 = 96명
 *   └─ 16시 이후 4슬롯 추가: 슬롯당 초진5 + 재진5 = 초진20 + 재진20 = 40명
 *
 *   시간대: 12슬롯 (오전 4 + 오후 8), 30분 간격
 *   이름:   테스트초진01~테스트초진68 / 테스트재진01~테스트재진68
 *   전화:   +821099050001~+821099050068 (초진) / +821099050069~+821099050136 (재진)
 *
 * 마킹: is_simulation=true
 * 선례: T-20260521-foot-DUMMY-TEST-DATA (5/22 96건)
 * 정리: node scripts/rollback_testdata_20260525.mjs
 */

import { createClient } from '@supabase/supabase-js';

// ============================================================
// === 확정 파라미터 ===
// ============================================================
const TARGET_DATE = '2026-05-25'; // 테스트 날짜
const PAST_DATE   = '2026-05-10'; // 재진 판별용 과거 체크인 날짜

/**
 * 기본 12슬롯: 오전 4타임 + 오후 8타임 (점심 12:00~13:30 제외)
 * 16:xx 슬롯은 기본 4+4 외에 추가 5+5 별도 적용
 */
const SLOTS = [
  '10:00', '10:30', '11:00', '11:30',           // 오전 4타임
  '14:00', '14:30', '15:00', '15:30',            // 오후 전반 4타임
  '16:00', '16:30', '17:00', '17:30',            // 오후 후반 4타임
];

const NEW_PER_SLOT = 4; // 기본 슬롯당 초진
const RET_PER_SLOT = 4; // 기본 슬롯당 재진

/** 16시 이후 추가 슬롯 — 슬롯당 10건 추가 (초진5 + 재진5) */
const EXTRA_SLOTS         = ['16:00', '16:30', '17:00', '17:30'];
const EXTRA_NEW_PER_SLOT  = 5; // 추가 초진
const EXTRA_RET_PER_SLOT  = 5; // 추가 재진

// ============================================================
// 계산: 기본 12×8 = 96 + 추가 4×10 = 40 → 총 136명
// 초진: 12×4 + 4×5 = 48+20 = 68명
// 재진: 12×4 + 4×5 = 48+20 = 68명
// ============================================================

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());

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

/**
 * E.164 전화번호 생성 (V2 전용 범위: +82109906XXXX)
 * 초진 seq 1~68  → +821099060001 ~ +821099060068
 * 재진 seq 1~68  → +821099060069 ~ +821099060136
 * ※ V1(5/22) 범위 +82100000020X~029X 와 완전 분리
 * ※ +82109905XXXX 는 5/17 [TEST5] 20건 점유 → +82109906으로 shift (2026-05-25)
 */
function makePhone(type, seq) {
  const offset = type === 'new' ? 0 : 68;
  return '+82109906' + String(seq + offset).padStart(4, '0');
}

/** 이름 생성: 테스트초진01~테스트초진68 / 테스트재진01~테스트재진68 */
function makeName(type, seq) {
  const label = type === 'new' ? '초진' : '재진';
  return `테스트${label}${String(seq).padStart(2, '0')}`;
}

/** 타임스탬프 생성 (KST) */
function makeTs(date, hour, min = 0) {
  return `${date}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+09:00`;
}

/** 슬롯 종료 시각 (+30분) */
function makeEndTs(date, slotTime, plusMin = 30) {
  const [h, m] = slotTime.split(':').map(Number);
  const total = h * 60 + m + plusMin;
  return makeTs(date, Math.floor(total / 60), total % 60);
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
      memo:             `더미 | ${visitType === 'new' ? '초진' : '재진'} ${slotTime}`,
      status:           'confirmed',
    })
  );
}

async function insertPastCheckIn(clinicId, customerId, name, phone, seq, slotTime) {
  const [h, m] = slotTime.split(':').map(Number);
  await must(`과거체크인 ${name}`,
    supabase.from('check_ins').insert({
      clinic_id:      clinicId,
      customer_id:    customerId,
      customer_name:  name,
      customer_phone: phone,
      visit_type:     'returning',
      status:         'done',
      queue_number:   seq + 200,
      checked_in_at:  makeTs(PAST_DATE, h, m),
      completed_at:   makeEndTs(PAST_DATE, slotTime, 30),
      sort_order:     seq + 200,
      notes:          JSON.stringify({ seed: 'testdata_20260525_v2', past_checkin: true }),
    })
  );
}

// ─── 단일 환자 삽입 ──────────────────────────────────────────
async function insertPatient(clinicId, type, seq, slotTime, queueBase) {
  const name  = makeName(type, seq);
  const phone = makePhone(type, seq);
  const vt    = type === 'new' ? 'new' : 'returning';

  const customerId = await insertCustomer(clinicId, name, phone, vt);
  await insertReservation(clinicId, customerId, name, phone, slotTime, vt);

  if (type === 'returning') {
    await insertPastCheckIn(clinicId, customerId, name, phone, seq, slotTime);
  }

  process.stdout.write(`  ✔ ${name}`);
  return customerId;
}

// ─── 메인 ───────────────────────────────────────────────────
async function main() {
  const totalNew = SLOTS.length * NEW_PER_SLOT + EXTRA_SLOTS.length * EXTRA_NEW_PER_SLOT;
  const totalRet = SLOTS.length * RET_PER_SLOT + EXTRA_SLOTS.length * EXTRA_RET_PER_SLOT;

  console.log('🚀 더미 데이터 삽입 시작 (T-20260525-foot-DUMMY-TEST-DATA-V2)');
  console.log(`   날짜:    ${TARGET_DATE}`);
  console.log(`   과거:    ${PAST_DATE} (재진 판별용)`);
  console.log(`   기본:    12슬롯 × (초진${NEW_PER_SLOT}+재진${RET_PER_SLOT}) = 96건`);
  console.log(`   추가:    4슬롯(16xx) × (초진${EXTRA_NEW_PER_SLOT}+재진${EXTRA_RET_PER_SLOT}) = 40건`);
  console.log(`   예상:    초진${totalNew}명 + 재진${totalRet}명 = 총 ${totalNew + totalRet}명`);
  console.log(`   전화:    +821099060001~${'+82109906' + String(totalNew + totalRet).padStart(4,'0')}`);

  // 클리닉 확인
  const clinic = await must('클리닉 조회',
    supabase.from('clinics').select('id').eq('slug', 'jongno-foot').single()
  );
  const clinicId = clinic.id;
  console.log(`\n✅ 클리닉 ID: ${clinicId}`);

  // 중복 방지: V2 전용 전화번호 범위 확인 (+82109906XXXX)
  const { data: dupCheck } = await supabase
    .from('customers')
    .select('id')
    .like('phone', '+82109906%')
    .eq('is_simulation', true)
    .limit(1);
  if (dupCheck && dupCheck.length > 0) {
    console.warn('\n⚠️  V2 테스트 데이터(+82109906xxxx)가 이미 존재합니다.');
    console.warn('   롤백 후 재실행: node scripts/rollback_testdata_20260525.mjs');
    process.exit(1);
  }

  let newSeq = 0;
  let retSeq = 0;
  let insertedNew = 0;
  let insertedRet = 0;

  // ══════════════════════════════════════════════════════════
  // Phase 1: 기본 12슬롯 — 슬롯당 초진4 + 재진4
  // ══════════════════════════════════════════════════════════
  console.log('\n━━━ Phase 1: 기본 12슬롯 (초진4+재진4) ━━━');
  for (const slot of SLOTS) {
    console.log(`\n⏰ [기본] ${slot}`);
    for (let i = 0; i < NEW_PER_SLOT; i++) {
      newSeq++;
      await insertPatient(clinicId, 'new', newSeq, slot, newSeq);
      insertedNew++;
    }
    console.log();
    for (let i = 0; i < RET_PER_SLOT; i++) {
      retSeq++;
      await insertPatient(clinicId, 'returning', retSeq, slot, retSeq);
      insertedRet++;
    }
    console.log();
  }

  // ══════════════════════════════════════════════════════════
  // Phase 2: 16시 이후 4슬롯 추가 — 슬롯당 초진5 + 재진5
  // ══════════════════════════════════════════════════════════
  console.log('\n━━━ Phase 2: 16시 이후 추가 4슬롯 (초진5+재진5) ━━━');
  for (const slot of EXTRA_SLOTS) {
    console.log(`\n⏰ [추가] ${slot}`);
    for (let i = 0; i < EXTRA_NEW_PER_SLOT; i++) {
      newSeq++;
      await insertPatient(clinicId, 'new', newSeq, slot, newSeq);
      insertedNew++;
    }
    console.log();
    for (let i = 0; i < EXTRA_RET_PER_SLOT; i++) {
      retSeq++;
      await insertPatient(clinicId, 'returning', retSeq, slot, retSeq);
      insertedRet++;
    }
    console.log();
  }

  // ══════════════════════════════════════════════════════════
  const grand = insertedNew + insertedRet;
  console.log('\n============================================================');
  console.log('✅ 더미 데이터 삽입 완료');
  console.log(`   초진: ${insertedNew}명 | 재진: ${insertedRet}명 | 합계: ${grand}명`);
  console.log(`   예약: ${grand}건 (${TARGET_DATE})`);
  console.log(`   과거체크인(재진 판별): ${insertedRet}건 (${PAST_DATE})`);
  console.log('\n── 슬롯별 인원 ─────────────────────────────────────────────');
  console.log('   10:00/10:30/11:00/11:30 → 각 8명 (초진4+재진4)');
  console.log('   14:00/14:30/15:00/15:30 → 각 8명 (초진4+재진4)');
  console.log('   16:00/16:30/17:00/17:30 → 각 18명 (초진9+재진9)');
  console.log('\n── 셀프접수 테스트 방법 ─────────────────────────────────────');
  console.log('   URL: https://obliv-foot-crm.vercel.app/checkin/jongno-foot');
  console.log('   초진 전화번호: 010-9906-0001 ~ 010-9906-0068');
  console.log('   재진 전화번호: 010-9906-0069 ~ 010-9906-0136');
  console.log('\n── 정리 (테스트 종료 후) ─────────────────────────────────');
  console.log('   node scripts/rollback_testdata_20260525.mjs');
  console.log('============================================================');
}

main().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
