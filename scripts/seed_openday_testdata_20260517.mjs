/**
 * 풋센터 종로 개원일(5/18) 테스트용 초진 20명 시간대별 생성
 * T-20260517-foot-OPENDAY-TESTSEED
 *
 * 실행 방법:
 *   DRY_RUN=true  node scripts/seed_openday_testdata_20260517.mjs   ← dry-run (조회만)
 *   DRY_RUN=false node scripts/seed_openday_testdata_20260517.mjs   ← 실제 INSERT
 *
 * 롤백: rollback_openday_testdata_20260517.mjs (또는 아래 SQL 직접 실행)
 *   DELETE FROM reservations WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE '[TEST-D1]%');
 *   DELETE FROM customers WHERE name LIKE '[TEST-D1]%';
 */

import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────
const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const CLINIC_SLUG = 'jongno-foot';
const TARGET_DATE = '2026-05-18'; // 개원 D-Day
const DRY_RUN = process.env.DRY_RUN !== 'false'; // 기본값: true (dry-run)

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

// ─────────────────────────────────────────────
// 20슬롯 시간표 (09:00~18:30, 30분 간격)
// ─────────────────────────────────────────────
const TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '12:30',
  '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30', '18:00', '18:30',
];

// 더미 전화번호 — E.164, 실번호 충돌 없는 범위
// 010-9999-0001 ~ 010-9999-0020
function dummyPhone(i) {
  return `+821099990${String(i).padStart(3, '0')}`;
}

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────
async function must(label, promise) {
  const { data, error } = await promise;
  if (error) {
    console.error(`❌ ${label}:`, error.message);
    throw new Error(`${label}: ${error.message}`);
  }
  return data;
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60));
  console.log('T-20260517-foot-OPENDAY-TESTSEED');
  console.log('개원일(5/18) 테스트용 초진 20명 시드');
  console.log(DRY_RUN ? '🔍 DRY-RUN 모드 (실제 INSERT 없음)' : '⚡ 실행 모드 (실제 INSERT)');
  console.log('='.repeat(60));

  // ── STEP 1: 클리닉 ID 조회 ──
  console.log('\n[STEP 1] 클리닉 조회...');
  const clinic = await must('clinic jongno-foot',
    supabase.from('clinics').select('id, name').eq('slug', CLINIC_SLUG).single()
  );
  const clinicId = clinic.id;
  console.log(`  ✅ 클리닉: ${clinic.name} (${clinicId})`);

  // ── STEP 2: 중복 체크 ──
  console.log('\n[STEP 2] 중복 체크 ([TEST-D1] prefix)...');
  const { data: dupCheck } = await supabase
    .from('customers')
    .select('id, name, phone')
    .like('name', '[TEST-D1]%')
    .eq('clinic_id', clinicId);

  if (dupCheck && dupCheck.length > 0) {
    console.log(`  ⚠️  [TEST-D1] 고객 ${dupCheck.length}건 이미 존재:`);
    dupCheck.forEach(c => console.log(`     - ${c.name} (${c.phone})`));
    console.log('\n  ❌ 중복 감지 → 실행 중단. 롤백 후 재시도:');
    console.log('     node scripts/rollback_openday_testdata_20260517.mjs');
    process.exit(0);
  }
  console.log('  ✅ 중복 없음 — 삽입 가능');

  // ── STEP 3: DRY-RUN 프리뷰 ──
  console.log('\n[STEP 3] 삽입 예정 데이터 프리뷰:');
  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    const name = `[TEST-D1] 테스트환자${num}`;
    const phone = dummyPhone(i);
    const time = TIME_SLOTS[i - 1];
    console.log(`  ${num}. ${name}  ${phone}  ${TARGET_DATE} ${time}  new`);
  }

  if (DRY_RUN) {
    console.log('\n🔍 DRY-RUN 완료 — INSERT 없음.');
    console.log('   실행: DRY_RUN=false node scripts/seed_openday_testdata_20260517.mjs');
    return;
  }

  // ── STEP 4: customers 20건 INSERT ──
  console.log('\n[STEP 4] customers 20건 INSERT...');
  const customerIds = [];

  for (let i = 1; i <= 20; i++) {
    const num = String(i).padStart(2, '0');
    const name = `[TEST-D1] 테스트환자${num}`;
    const phone = dummyPhone(i);

    const cust = await must(`고객 INSERT ${name}`,
      supabase.from('customers').insert({
        clinic_id: clinicId,
        name,
        phone,
        visit_type: 'new',
        memo: '[TEST-D1] 개원일 테스트 더미 — 현장 확인 완료 후 삭제',
        is_simulation: false,
      }).select('id').single()
    );
    customerIds.push({ id: cust.id, name, phone });
    console.log(`  ✅ [${num}] ${name} → ${cust.id}`);
  }

  console.log(`\n  ✅ customers ${customerIds.length}/20건 삽입 완료`);

  // ── STEP 5: reservations 20건 INSERT ──
  console.log('\n[STEP 5] reservations 20건 INSERT (5/18 시간대별)...');
  const reservationIds = [];

  for (let i = 0; i < 20; i++) {
    const cust = customerIds[i];
    const time = TIME_SLOTS[i];

    const resv = await must(`예약 INSERT ${cust.name} ${time}`,
      supabase.from('reservations').insert({
        clinic_id: clinicId,
        customer_id: cust.id,
        customer_name: cust.name,
        customer_phone: cust.phone,
        reservation_date: TARGET_DATE,
        reservation_time: time,
        visit_type: 'new',
        status: 'confirmed',
        memo: '[TEST-D1] 개원일 테스트 예약',
      }).select('id').single()
    );
    reservationIds.push(resv.id);
    console.log(`  ✅ [${String(i + 1).padStart(2, '0')}] ${cust.name}  ${TARGET_DATE} ${time}  confirmed`);
  }

  console.log(`\n  ✅ reservations ${reservationIds.length}/20건 삽입 완료`);

  // ── STEP 6: AC 검증 ──
  console.log('\n[STEP 6] AC 검증...');

  // AC-1 검증: customers count
  const { count: custCount } = await supabase
    .from('customers')
    .select('*', { count: 'exact', head: true })
    .like('name', '[TEST-D1]%')
    .eq('clinic_id', clinicId);
  console.log(`  AC-1: [TEST-D1] customers = ${custCount}건 ${custCount === 20 ? '✅' : '❌'}`);

  // AC-2 검증: reservations count on 5/18
  const { count: resvCount } = await supabase
    .from('reservations')
    .select('*', { count: 'exact', head: true })
    .eq('reservation_date', TARGET_DATE)
    .eq('clinic_id', clinicId)
    .like('customer_name', '[TEST-D1]%');
  console.log(`  AC-2: 5/18 reservations = ${resvCount}건 ${resvCount === 20 ? '✅' : '❌'}`);

  // 샘플 확인 (처음 3건 + 마지막 1건)
  console.log('\n  샘플 조회 (4건):');
  const { data: samples } = await supabase
    .from('reservations')
    .select('customer_name, customer_phone, reservation_time, visit_type, status')
    .eq('reservation_date', TARGET_DATE)
    .like('customer_name', '[TEST-D1]%')
    .order('reservation_time')
    .limit(4);
  samples?.forEach(s =>
    console.log(`    ${s.customer_name}  ${s.customer_phone}  ${s.reservation_time}  ${s.visit_type}  ${s.status}`)
  );

  console.log('\n' + '='.repeat(60));
  console.log('✅ SEED 완료');
  console.log(`   customers: ${custCount}/20건`);
  console.log(`   reservations: ${resvCount}/20건`);
  console.log(`   예약일: ${TARGET_DATE}`);
  console.log('\n🗑  롤백 필요 시:');
  console.log('   node scripts/rollback_openday_testdata_20260517.mjs');
  console.log('='.repeat(60));
}

main().catch(e => {
  console.error('\n❌ 스크립트 실패:', e.message);
  process.exit(1);
});
