/**
 * 풋센터 CRM 더미 데이터 — 5/27 현장 테스트용
 * T-20260526-foot-TEST-RESV-DATA (P2)
 *
 * 구성: 초진 4명 + 재진 4명 = 총 8명 고객
 *   - 시간대: 8슬롯 (11:00~18:00, 1시간 간격)
 *   - 슬롯당: 초진 4건 + 재진 4건 = 8건
 *   - 총 예약: 초진 32건 + 재진 32건 = 64건
 *   - 이름: 동물명 (강아지·고양이·토끼·판다 = 초진 / 사자·호랑이·코끼리·기린 = 재진)
 *   - 전화 범위: 010-0000-0301 ~ 010-0000-0308 (기존 0201~0296 충돌 방지)
 * 마킹: is_simulation=true
 * 정리: rollback_testdata_20260527.mjs 실행
 */

import { createClient } from '@supabase/supabase-js';

// ============================================================
// === 확정 파라미터 ===
// ============================================================
const TARGET_DATE = '2026-05-27'; // 테스트 날짜 (내일)
const PAST_DATE   = '2026-05-01'; // 재진 판별용 과거 체크인 날짜

/** 8슬롯: 11:00~18:00, 1시간 간격 */
const SLOTS = [
  '11:00', '12:00', '13:00', '14:00',
  '15:00', '16:00', '17:00', '18:00',
];

/** 초진 동물 4마리 */
const NEW_ANIMALS = [
  { name: '강아지', phone: '+821000000301' },
  { name: '고양이', phone: '+821000000302' },
  { name: '토끼',   phone: '+821000000303' },
  { name: '판다',   phone: '+821000000304' },
];

/** 재진 동물 4마리 */
const RET_ANIMALS = [
  { name: '사자',   phone: '+821000000305' },
  { name: '호랑이', phone: '+821000000306' },
  { name: '코끼리', phone: '+821000000307' },
  { name: '기린',   phone: '+821000000308' },
];
// ============================================================
// 계산: 초진 4마리 × 8슬롯 = 32건 + 재진 4마리 × 8슬롯 = 32건 = 총 64건

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

// ─── 메인 ───────────────────────────────────────────────────
async function main() {
  console.log('🚀 더미 데이터 삽입 시작 (5/27 현장 테스트)');
  console.log(`   날짜: ${TARGET_DATE}`);
  console.log(`   슬롯: ${SLOTS.length}개 (11:00~18:00, 1시간 간격)`);
  console.log(`   초진 동물: ${NEW_ANIMALS.map(a => a.name).join(', ')}`);
  console.log(`   재진 동물: ${RET_ANIMALS.map(a => a.name).join(', ')}`);
  console.log(`   예상: 초진 ${NEW_ANIMALS.length * SLOTS.length}건 + 재진 ${RET_ANIMALS.length * SLOTS.length}건 = ${(NEW_ANIMALS.length + RET_ANIMALS.length) * SLOTS.length}건`);

  // 클리닉 확인
  const clinic = await must('클리닉 조회',
    supabase.from('clinics').select('id').eq('slug', 'jongno-foot').single()
  );
  const clinicId = clinic.id;
  console.log(`✅ 클리닉 ID: ${clinicId}`);

  // 중복 방지: 테스트 동물 이미 존재하는지 확인
  const allAnimalNames = [...NEW_ANIMALS, ...RET_ANIMALS].map(a => a.name);
  const { data: dupCheck } = await supabase
    .from('customers')
    .select('id,name')
    .in('name', allAnimalNames)
    .eq('is_simulation', true);
  if (dupCheck && dupCheck.length > 0) {
    const existingNames = dupCheck.map(c => c.name).join(', ');
    console.warn(`⚠️  테스트 동물 데이터가 이미 존재합니다: ${existingNames}`);
    console.warn('   롤백 후 재실행하세요: node scripts/rollback_testdata_20260527.mjs');
    process.exit(1);
  }

  // ─── 1단계: 고객 생성 (8명) ───────────────────────────────
  console.log('\n── 고객 생성 (8명) ──────────────────────────────────────');

  const newCustomerIds = {}; // name → id
  for (const animal of NEW_ANIMALS) {
    const cust = await must(`고객(초진) ${animal.name}`,
      supabase.from('customers').insert({
        clinic_id:      clinicId,
        name:           animal.name,
        phone:          animal.phone,
        visit_type:     'new',
        is_simulation:  true,
        inflow_channel: 'meta_ads',
      }).select('id').single()
    );
    newCustomerIds[animal.name] = cust.id;
    console.log(`  ✔ 초진 ${animal.name} (${animal.phone}) — ID: ${cust.id.slice(0,8)}...`);
  }

  const retCustomerIds = {}; // name → id
  for (const animal of RET_ANIMALS) {
    const cust = await must(`고객(재진) ${animal.name}`,
      supabase.from('customers').insert({
        clinic_id:      clinicId,
        name:           animal.name,
        phone:          animal.phone,
        visit_type:     'returning',
        is_simulation:  true,
        inflow_channel: 'returning',
      }).select('id').single()
    );
    retCustomerIds[animal.name] = cust.id;
    console.log(`  ✔ 재진 ${animal.name} (${animal.phone}) — ID: ${cust.id.slice(0,8)}...`);
  }

  // ─── 2단계: 재진 과거 체크인 (재진 판별 근거) ─────────────
  console.log('\n── 재진 과거 체크인 생성 (4건) ──────────────────────────');
  // queue_number: 9001~9004 (기존 범위와 절대 충돌 없는 고번호 사용)
  let retSeqBase = 9000;
  for (const animal of RET_ANIMALS) {
    retSeqBase++;
    const customerId = retCustomerIds[animal.name];
    await must(`과거체크인(재진) ${animal.name}`,
      supabase.from('check_ins').insert({
        clinic_id:      clinicId,
        customer_id:    customerId,
        customer_name:  animal.name,
        customer_phone: animal.phone,
        visit_type:     'returning',
        status:         'done',
        queue_number:   retSeqBase,
        checked_in_at:  `${PAST_DATE}T10:00:00+09:00`,
        completed_at:   `${PAST_DATE}T11:30:00+09:00`,
        sort_order:     retSeqBase,
        notes:          JSON.stringify({ seed: 'testdata_20260527', past_checkin: true }),
      })
    );
    console.log(`  ✔ ${animal.name} 과거 체크인 (${PAST_DATE})`);
  }

  // ─── 3단계: 예약 생성 (64건) ─────────────────────────────
  console.log('\n── 예약 생성 (64건) ─────────────────────────────────────');
  let totalNew = 0;
  let totalRet = 0;

  for (const slotTime of SLOTS) {
    console.log(`\n⏰ 슬롯 ${slotTime}`);

    // 초진 4건
    for (const animal of NEW_ANIMALS) {
      const customerId = newCustomerIds[animal.name];
      await must(`예약(초진) ${animal.name} ${slotTime}`,
        supabase.from('reservations').insert({
          clinic_id:        clinicId,
          customer_id:      customerId,
          customer_name:    animal.name,
          customer_phone:   animal.phone,
          reservation_date: TARGET_DATE,
          reservation_time: slotTime,
          visit_type:       'new',
          memo:             `더미 | 초진 ${slotTime}`,
          status:           'confirmed',
        })
      );
      totalNew++;
      process.stdout.write(`  ✔ 초진 ${animal.name} `);
    }

    // 재진 4건
    for (const animal of RET_ANIMALS) {
      const customerId = retCustomerIds[animal.name];
      await must(`예약(재진) ${animal.name} ${slotTime}`,
        supabase.from('reservations').insert({
          clinic_id:        clinicId,
          customer_id:      customerId,
          customer_name:    animal.name,
          customer_phone:   animal.phone,
          reservation_date: TARGET_DATE,
          reservation_time: slotTime,
          visit_type:       'returning',
          memo:             `더미 | 재진 ${slotTime}`,
          status:           'confirmed',
        })
      );
      totalRet++;
      process.stdout.write(`  ✔ 재진 ${animal.name} `);
    }
    console.log();
  }

  console.log('\n============================================================');
  console.log(`✅ 더미 데이터 삽입 완료`);
  console.log(`   고객: 초진 ${NEW_ANIMALS.length}명 + 재진 ${RET_ANIMALS.length}명 = ${NEW_ANIMALS.length + RET_ANIMALS.length}명`);
  console.log(`   예약: 초진 ${totalNew}건 + 재진 ${totalRet}건 = ${totalNew + totalRet}건 (${TARGET_DATE})`);
  console.log(`   과거체크인(재진 판별): ${RET_ANIMALS.length}건 (${PAST_DATE})`);
  console.log('\n── 전화번호 범위 ────────────────────────────────────────');
  console.log(`   초진: 010-0000-0301 ~ 010-0000-0304 (강아지·고양이·토끼·판다)`);
  console.log(`   재진: 010-0000-0305 ~ 010-0000-0308 (사자·호랑이·코끼리·기린)`);
  console.log('\n── 시간대 ──────────────────────────────────────────────');
  console.log(`   ${SLOTS.join(' / ')}`);
  console.log('\n── 정리 (테스트 후) ─────────────────────────────────────');
  console.log('   node scripts/rollback_testdata_20260527.mjs');
  console.log('============================================================');
}

main().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
