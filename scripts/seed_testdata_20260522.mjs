/**
 * 풋센터 CRM 더미 데이터 — 5/22 현장 테스트용
 * T-20260521-foot-DUMMY-TEST-DATA (P1)
 *
 * 구성: 초진 48명 + 재진 48명 = 96명
 *   - 시간대: 12슬롯 (오전 4 + 오후 8), 30분 간격
 *   - 슬롯당: 초진 4명 + 재진 4명 = 8명
 *   - 이름: 테스트초진01~테스트초진48 / 테스트재진01~테스트재진48
 *   - 전화: 010-0000-0001~010-0000-0048(초진) / 010-0000-0049~010-0000-0096(재진)
 * 마킹: is_simulation=true
 * 확정: 김주연 총괄 2026-05-21 22:17 최종 확인
 * 정리: rollback_testdata_20260522.mjs 실행
 */

import { createClient } from '@supabase/supabase-js';

// ============================================================
// === 확정 파라미터 (2026-05-21 22:17 김주연 총괄 최종 확정) ===
// ============================================================
const TARGET_DATE = '2026-05-22'; // 테스트 날짜
const PAST_DATE   = '2026-05-01'; // 재진 판별용 과거 체크인 날짜

/** 확정 12슬롯: 오전 4타임 + 오후 8타임 (점심 12:00~13:30 제외) */
const SLOTS = [
  '10:00', '10:30', '11:00', '11:30',           // 오전 4타임
  '14:00', '14:30', '15:00', '15:30',            // 오후 전반 4타임
  '16:00', '16:30', '17:00', '17:30',            // 오후 후반 4타임
];

const NEW_PER_SLOT = 4; // 슬롯당 초진 인원
const RET_PER_SLOT = 4; // 슬롯당 재진 인원
// ============================================================
// 계산: 12슬롯 × 8명 = 96명 (초진 48 + 재진 48)

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

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
 * E.164 전화번호 생성
 * ⚠️  범위 shift: 010-0000-0021~0023 이 기존 레코드(테스트환자21/22/23)와 충돌하여
 *     010-0000-0201 ~ 010-0000-0296 로 변경 (2026-05-21, FOLLOWUP 발행)
 * 초진 seq 1~48  → 010-0000-0201 ~ 010-0000-0248 (+821000000201 ~ +821000000248)
 * 재진 seq 1~48  → 010-0000-0249 ~ 010-0000-0296 (+821000000249 ~ +821000000296)
 */
function makePhone(type, seq) {
  const globalSeq = type === 'new' ? seq + 200 : seq + 248;
  return '+82100000' + String(globalSeq).padStart(4, '0');
}

/** 이름 생성: 테스트초진01~테스트초진48 / 테스트재진01~테스트재진48 */
function makeName(type, seq) {
  const label = type === 'new' ? '초진' : '재진';
  return `테스트${label}${String(seq).padStart(2, '0')}`;
}

// ─── 메인 ───────────────────────────────────────────────────
async function main() {
  console.log('🚀 더미 데이터 삽입 시작 (5/22 현장 테스트)');
  console.log(`   날짜: ${TARGET_DATE}`);
  console.log(`   슬롯: ${SLOTS.length}개 (오전 4 + 오후 8), 슬롯당 초진${NEW_PER_SLOT}+재진${RET_PER_SLOT}=8명`);
  console.log(`   예상 합계: 초진${SLOTS.length * NEW_PER_SLOT}명 + 재진${SLOTS.length * RET_PER_SLOT}명 = ${SLOTS.length * (NEW_PER_SLOT + RET_PER_SLOT)}명`);

  // 클리닉 확인
  const clinic = await must('클리닉 조회',
    supabase.from('clinics').select('id').eq('slug', 'jongno-foot').single()
  );
  const clinicId = clinic.id;
  console.log(`✅ 클리닉 ID: ${clinicId}`);

  // 중복 방지: 테스트 데이터 이미 존재하는지 확인
  const { data: dupCheck } = await supabase
    .from('customers')
    .select('id')
    .or('name.ilike.테스트초진%,name.ilike.테스트재진%')
    .eq('is_simulation', true)
    .limit(1);
  if (dupCheck && dupCheck.length > 0) {
    console.warn('⚠️  테스트 데이터가 이미 존재합니다. 롤백 후 재실행하세요.');
    console.warn('   rollback: node scripts/rollback_testdata_20260522.mjs');
    process.exit(1);
  }

  console.log(`\n슬롯 목록 (${SLOTS.length}개): ${SLOTS.join(', ')}`);

  let newSeq = 0;
  let retSeq = 0;
  let totalNew = 0;
  let totalRet = 0;

  for (const slotTime of SLOTS) {
    const [slotHourStr, slotMinStr] = slotTime.split(':');
    const slotHour = parseInt(slotHourStr, 10);
    const slotMin  = parseInt(slotMinStr,  10);
    console.log(`\n⏰ 슬롯 ${slotTime}`);

    // ── 초진 ──────────────────────────────────────────────
    for (let i = 0; i < NEW_PER_SLOT; i++) {
      newSeq++;
      const name  = makeName('new', newSeq);
      const phone = makePhone('new', newSeq);

      // 고객 생성
      const cust = await must(`고객(초진) ${name}`,
        supabase.from('customers').insert({
          clinic_id:      clinicId,
          name,
          phone,
          visit_type:     'new',
          is_simulation:  true,
          inflow_channel: 'meta_ads',
        }).select('id').single()
      );
      const customerId = cust.id;

      // 예약 생성
      await must(`예약(초진) ${name}`,
        supabase.from('reservations').insert({
          clinic_id:        clinicId,
          customer_id:      customerId,
          customer_name:    name,
          customer_phone:   phone,
          reservation_date: TARGET_DATE,
          reservation_time: slotTime,
          visit_type:       'new',
          memo:             `더미 | 초진 ${slotTime}`,
          status:           'confirmed',
        })
      );

      totalNew++;
      process.stdout.write(`  ✔ ${name} `);
    }

    // ── 재진 ──────────────────────────────────────────────
    for (let i = 0; i < RET_PER_SLOT; i++) {
      retSeq++;
      const name  = makeName('returning', retSeq);
      const phone = makePhone('returning', retSeq);

      // 고객 생성 (visit_type=returning)
      const cust = await must(`고객(재진) ${name}`,
        supabase.from('customers').insert({
          clinic_id:      clinicId,
          name,
          phone,
          visit_type:     'returning',
          is_simulation:  true,
          inflow_channel: 'returning',
        }).select('id').single()
      );
      const customerId = cust.id;

      // 예약 생성 (재진)
      await must(`예약(재진) ${name}`,
        supabase.from('reservations').insert({
          clinic_id:        clinicId,
          customer_id:      customerId,
          customer_name:    name,
          customer_phone:   phone,
          reservation_date: TARGET_DATE,
          reservation_time: slotTime,
          visit_type:       'returning',
          memo:             `더미 | 재진 ${slotTime}`,
          status:           'confirmed',
        })
      );

      // 과거 체크인 1건 (재진 판별 근거)
      await must(`과거체크인(재진) ${name}`,
        supabase.from('check_ins').insert({
          clinic_id:      clinicId,
          customer_id:    customerId,
          customer_name:  name,
          customer_phone: phone,
          visit_type:     'returning',
          status:         'done',
          queue_number:   retSeq + 200,
          checked_in_at:  `${PAST_DATE}T${String(slotHour).padStart(2,'0')}:${String(slotMin).padStart(2,'0')}:00+09:00`,
          completed_at:   (() => {
            const endTotalMin = slotHour * 60 + slotMin + 30;
            const endH = Math.floor(endTotalMin / 60);
            const endM = endTotalMin % 60;
            return `${PAST_DATE}T${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}:00+09:00`;
          })(),
          sort_order:     retSeq + 200,
          notes:          JSON.stringify({ seed: 'testdata_20260522', past_checkin: true }),
        })
      );

      totalRet++;
      process.stdout.write(`  ✔ ${name} `);
    }
    console.log();
  }

  console.log('\n============================================================');
  console.log(`✅ 더미 데이터 삽입 완료`);
  console.log(`   초진: ${totalNew}명 | 재진: ${totalRet}명 | 합계: ${totalNew + totalRet}명`);
  console.log(`   예약: ${totalNew + totalRet}건 (${TARGET_DATE})`);
  console.log(`   과거체크인(재진 판별): ${totalRet}건 (${PAST_DATE})`);
  console.log('\n── 셀프접수 테스트 방법 ────────────────────────────────────');
  console.log(`   URL: https://obliv-foot-crm.vercel.app/checkin/jongno-foot`);
  console.log(`   초진 전화번호 예: 010-0000-0201 ~ 010-0000-0248`);
  console.log(`   재진 전화번호 예: 010-0000-0249 ~ 010-0000-0296`);
  console.log('\n── 시간대 ──────────────────────────────────────────────────');
  console.log(`   오전: 10:00 / 10:30 / 11:00 / 11:30`);
  console.log(`   오후: 14:00 / 14:30 / 15:00 / 15:30 / 16:00 / 16:30 / 17:00 / 17:30`);
  console.log('\n── 정리 (테스트 후) ─────────────────────────────────────────');
  console.log('   node scripts/rollback_testdata_20260522.mjs');
  console.log('============================================================');
}

main().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
