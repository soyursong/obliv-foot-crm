/**
 * 풋센터 CRM 더미 데이터 — 5/27 현장 테스트용 (스펙 정합 v3)
 * T-20260526-foot-TEST-RESV-DATA
 *
 * 구성: 고객 8명 × 8슬롯(11:00~18:00) = 예약 64건
 *   - 초진 4명 (강아지·고양이·토끼·판다): 8슬롯 각 1건 = 32건
 *   - 재진 4명 (사자·호랑이·코끼리·기린): 8슬롯 각 1건 = 32건
 *   - 재진 4명: 2026-05-01 과거 체크인 1건씩 (재진 판별 충족)
 * 전화번호:
 *   - 초진: +821000000301~+821000000304
 *   - 재진: +821000000305~+821000000308
 * 마킹: is_simulation=true
 * 정리: node scripts/rollback_testdata_20260527.mjs
 */

import { createClient } from '@supabase/supabase-js';

const TARGET_DATE = '2026-05-27';
const PAST_DATE   = '2026-05-01';

const SLOTS = ['11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];

const ANIMALS_NEW = [
  { name: '강아지', phone: '+821000000301' },
  { name: '고양이', phone: '+821000000302' },
  { name: '토끼',   phone: '+821000000303' },
  { name: '판다',   phone: '+821000000304' },
];

const ANIMALS_RET = [
  { name: '사자',   phone: '+821000000305' },
  { name: '호랑이', phone: '+821000000306' },
  { name: '코끼리', phone: '+821000000307' },
  { name: '기린',   phone: '+821000000308' },
];

const ALL_ANIMALS = [...ANIMALS_NEW, ...ANIMALS_RET];

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) {
    console.error(`❌ ${label}:`, error.message, JSON.stringify(error));
    throw new Error(`${label}: ${error.message}`);
  }
  return data;
}

async function main() {
  console.log('🚀 더미 데이터 삽입 시작 (5/27 현장 테스트 v3 — 고객 8명 × 8슬롯)');
  console.log(`   날짜: ${TARGET_DATE}`);
  console.log(`   고객: ${ALL_ANIMALS.length}명 (초진 ${ANIMALS_NEW.length}명 + 재진 ${ANIMALS_RET.length}명)`);
  console.log(`   슬롯: ${SLOTS.length}개 (${SLOTS[0]}~${SLOTS[SLOTS.length - 1]})`);
  console.log(`   예상: ${ALL_ANIMALS.length}명 × ${SLOTS.length}슬롯 = ${ALL_ANIMALS.length * SLOTS.length}건 예약`);

  const clinic = await must('클리닉 조회',
    supabase.from('clinics').select('id').eq('slug', 'jongno-foot').single()
  );
  const clinicId = clinic.id;
  console.log(`\n✅ 클리닉 ID: ${clinicId}`);

  // 중복 방지 체크
  const { data: dupCheck } = await supabase
    .from('customers')
    .select('id,name')
    .in('name', ALL_ANIMALS.map(a => a.name))
    .eq('is_simulation', true);
  if (dupCheck && dupCheck.length > 0) {
    const existingNames = dupCheck.map(c => c.name).join(', ');
    console.warn(`⚠️  테스트 동물 데이터가 이미 존재합니다: ${existingNames}`);
    console.warn('   롤백 후 재실행하세요: node scripts/rollback_testdata_20260527.mjs');
    process.exit(1);
  }

  let totalCustomers = 0;
  let totalResvNew   = 0;
  let totalResvRet   = 0;
  let totalPastCI    = 0;

  // ── 초진 4명 생성 ────────────────────────────────────────
  console.log('\n── 초진 고객 생성 ──────────────────────────────────────');
  for (const animal of ANIMALS_NEW) {
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
    totalCustomers++;

    for (const slot of SLOTS) {
      await must(`예약(초진) ${animal.name} ${slot}`,
        supabase.from('reservations').insert({
          clinic_id:        clinicId,
          customer_id:      cust.id,
          customer_name:    animal.name,
          customer_phone:   animal.phone,
          reservation_date: TARGET_DATE,
          reservation_time: slot,
          visit_type:       'new',
          memo:             `더미 | 초진 ${slot}`,
          status:           'confirmed',
        })
      );
      totalResvNew++;
    }
    console.log(`  ✔ ${animal.name} (${animal.phone}) — 예약 ${SLOTS.length}건`);
  }

  // ── 재진 4명 생성 ────────────────────────────────────────
  console.log('\n── 재진 고객 생성 ──────────────────────────────────────');
  for (let i = 0; i < ANIMALS_RET.length; i++) {
    const animal = ANIMALS_RET[i];

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
    totalCustomers++;

    // 재진 판별용 과거 체크인 1건
    const queueNum = 9001 + i;
    await must(`과거체크인(재진) ${animal.name}`,
      supabase.from('check_ins').insert({
        clinic_id:      clinicId,
        customer_id:    cust.id,
        customer_name:  animal.name,
        customer_phone: animal.phone,
        visit_type:     'returning',
        status:         'done',
        queue_number:   queueNum,
        checked_in_at:  `${PAST_DATE}T10:00:00+09:00`,
        completed_at:   `${PAST_DATE}T11:30:00+09:00`,
        sort_order:     queueNum,
        notes:          JSON.stringify({ seed: 'testdata_20260527_v3', past_checkin: true }),
      })
    );
    totalPastCI++;

    for (const slot of SLOTS) {
      await must(`예약(재진) ${animal.name} ${slot}`,
        supabase.from('reservations').insert({
          clinic_id:        clinicId,
          customer_id:      cust.id,
          customer_name:    animal.name,
          customer_phone:   animal.phone,
          reservation_date: TARGET_DATE,
          reservation_time: slot,
          visit_type:       'returning',
          memo:             `더미 | 재진 ${slot}`,
          status:           'confirmed',
        })
      );
      totalResvRet++;
    }
    console.log(`  ✔ ${animal.name} (${animal.phone}) — 예약 ${SLOTS.length}건 + 과거체크인 1건`);
  }

  console.log('\n════════════════════════════════════════════════════════');
  console.log(`✅ 더미 데이터 삽입 완료 (5/27 v3 — 고객 8명 × 8슬롯)`);
  console.log(`   고객:   ${totalCustomers}명 (초진 ${ANIMALS_NEW.length}명 + 재진 ${ANIMALS_RET.length}명)`);
  console.log(`   예약:   초진 ${totalResvNew}건 + 재진 ${totalResvRet}건 = ${totalResvNew + totalResvRet}건`);
  console.log(`   과거체크인(재진 판별): ${totalPastCI}건 (${PAST_DATE})`);
  console.log('\n── 셀프접수 테스트 번호 ──────────────────────────────────');
  console.log('  초진: 010-0000-0301 ~ 010-0000-0304');
  console.log('  재진: 010-0000-0305 ~ 010-0000-0308');
  console.log('\n── 정리 (테스트 후) ─────────────────────────────────────');
  console.log('   node scripts/rollback_testdata_20260527.mjs');
  console.log('════════════════════════════════════════════════════════');
}

main().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
