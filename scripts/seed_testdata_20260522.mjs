/**
 * 풋센터 CRM 더미 데이터 — 5/22 현장 테스트용
 * T-20260521-foot-DUMMY-TEST-DATA (P1)
 *
 * 구성: 초진 32명 + 재진 32명 = 64명
 *   - 시간대: 10:00~17:00, 1시간 간격 8슬롯
 *   - 슬롯당: 초진 4명 + 재진 4명
 * 마킹: [TEST6] prefix + is_simulation=true
 * 정리: rollback_testdata_20260522.mjs 실행
 *
 * ⚠️  파라미터 섹션만 수정하면 시간대·인원 즉시 조정 가능
 */

import { createClient } from '@supabase/supabase-js';

// ============================================================
// === 파라미터 (총괄 요청에 따라 조정) ===
// ============================================================
const TARGET_DATE    = '2026-05-22'; // 테스트 날짜
const START_HOUR     = 10;           // 시작 시간 (포함)
const END_HOUR       = 17;           // 마지막 슬롯 시간 (17:00)
const SLOT_INTERVAL  = 1;            // 간격 (시간 단위)
const NEW_PER_SLOT   = 4;            // 슬롯당 초진 인원
const RET_PER_SLOT   = 4;            // 슬롯당 재진 인원
const PAST_DATE      = '2026-05-01'; // 재진 판별용 과거 체크인 날짜
// ============================================================

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
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

/** 슬롯 시간 배열 생성 */
function buildSlots() {
  const slots = [];
  for (let h = START_HOUR; h <= END_HOUR; h += SLOT_INTERVAL) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
  }
  return slots;
}

/** E.164 전화번호 생성
 *  신규: +8210990600XX (XX = 01 ~ 32)
 *  재진: +8210990610XX (XX = 01 ~ 32)
 */
function makePhone(type, seq) {
  const base = type === 'new' ? '+821099060' : '+821099061';
  return base + String(seq).padStart(3, '0');
}

/** 이름 생성 */
function makeName(type, seq) {
  const label = type === 'new' ? '신규' : '재진';
  return `[TEST6] ${label}${String(seq).padStart(2, '0')}`;
}

// ─── 메인 ───────────────────────────────────────────────────
async function main() {
  console.log('🚀 [TEST6] 더미 데이터 삽입 시작');
  console.log(`   날짜: ${TARGET_DATE} / 슬롯: ${START_HOUR}~${END_HOUR}시 ${SLOT_INTERVAL}h간격`);
  console.log(`   슬롯당 초진${NEW_PER_SLOT} + 재진${RET_PER_SLOT} = ${NEW_PER_SLOT + RET_PER_SLOT}명`);

  // 클리닉 확인
  const clinic = await must('클리닉 조회',
    supabase.from('clinics').select('id').eq('slug', 'jongno-foot').single()
  );
  const clinicId = clinic.id;
  console.log(`✅ 클리닉 ID: ${clinicId}`);

  // 중복 방지: [TEST6] 이미 존재하는지 확인
  const { data: dupCheck } = await supabase
    .from('customers')
    .select('id')
    .ilike('name', '[TEST6]%')
    .eq('is_simulation', true)
    .limit(1);
  if (dupCheck && dupCheck.length > 0) {
    console.warn('⚠️  [TEST6] 데이터가 이미 존재합니다. 롤백 후 재실행하거나 건너뜁니다.');
    console.warn('   rollback: node scripts/rollback_testdata_20260522.mjs');
    process.exit(1);
  }

  const slots = buildSlots();
  console.log(`\n슬롯 목록 (${slots.length}개): ${slots.join(', ')}`);

  let newSeq = 0;   // 신규 환자 순번 (1~32)
  let retSeq = 0;   // 재진 환자 순번 (1~32)
  let totalNew = 0;
  let totalRet = 0;

  for (const slotTime of slots) {
    const slotHour = parseInt(slotTime.split(':')[0]);
    console.log(`\n⏰ 슬롯 ${slotTime}`);

    // ── 초진 ──────────────────────────────────────────────
    for (let i = 0; i < NEW_PER_SLOT; i++) {
      newSeq++;
      const name  = makeName('new', newSeq);
      const phone = makePhone('new', newSeq);

      // 고객 생성
      const cust = await must(`고객(신규) ${name}`,
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
      await must(`예약(신규) ${name}`,
        supabase.from('reservations').insert({
          clinic_id:        clinicId,
          customer_id:      customerId,
          customer_name:    name,
          customer_phone:   phone,
          reservation_date: TARGET_DATE,
          reservation_time: slotTime,
          visit_type:       'new',
          memo:             `[TEST6]더미 | 초진 ${slotTime}`,
          status:           'confirmed',
        })
      );

      totalNew++;
      process.stdout.write(`  ✔ 신규${String(newSeq).padStart(2,'0')} ${slotTime} `);
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
          memo:             `[TEST6]더미 | 재진 ${slotTime}`,
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
          checked_in_at:  `${PAST_DATE}T${String(slotHour).padStart(2,'0')}:00:00+09:00`,
          completed_at:   `${PAST_DATE}T${String(slotHour + 1).padStart(2,'0')}:00:00+09:00`,
          sort_order:     retSeq + 200,
          notes:          JSON.stringify({ test6: true, past_checkin: true }),
        })
      );

      totalRet++;
      process.stdout.write(`  ✔ 재진${String(retSeq).padStart(2,'0')} ${slotTime} `);
    }
    console.log();
  }

  console.log('\n============================================================');
  console.log(`✅ [TEST6] 삽입 완료`);
  console.log(`   신규: ${totalNew}명 | 재진: ${totalRet}명 | 합계: ${totalNew + totalRet}명`);
  console.log(`   예약: ${totalNew + totalRet}건 (${TARGET_DATE})`);
  console.log(`   과거체크인(재진 판별): ${totalRet}건 (${PAST_DATE})`);
  console.log('\n── 셀프접수 테스트 방법 ────────────────────────────────────');
  console.log(`   URL: https://obliv-foot-crm.vercel.app/checkin/jongno-foot`);
  console.log(`   신규 전화번호 예: +82 10-9906-0001 (또는 010-9906-0001)`);
  console.log(`   재진 전화번호 예: +82 10-9906-1001 (또는 010-9906-1001)`);
  console.log('\n── 정리 (테스트 후) ─────────────────────────────────────────');
  console.log('   node scripts/rollback_testdata_20260522.mjs');
  console.log('   또는 Supabase SQL: DELETE FROM customers');
  console.log("   WHERE name LIKE '[TEST6]%' AND is_simulation = true;");
  console.log('============================================================');
}

main().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
