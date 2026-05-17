/**
 * [TEST-D1] 개원일 테스트 데이터 롤백
 * T-20260517-foot-OPENDAY-TESTSEED — AC-5 Cleanup
 *
 * 실행 방법:
 *   DRY_RUN=true  node scripts/rollback_openday_testdata_20260517.mjs   ← 카운트만 확인
 *   DRY_RUN=false node scripts/rollback_openday_testdata_20260517.mjs   ← 실제 삭제
 *
 * 삭제 순서: reservations → customers (FK 참조 순)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const DRY_RUN = process.env.DRY_RUN !== 'false'; // 기본값: true (dry-run)

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

async function main() {
  console.log('='.repeat(60));
  console.log('T-20260517-foot-OPENDAY-TESTSEED — Rollback (AC-5)');
  console.log('[TEST-D1] 테스트 데이터 삭제');
  console.log(DRY_RUN ? '🔍 DRY-RUN 모드 (실제 삭제 없음)' : '⚡ 실행 모드 (실제 삭제)');
  console.log('='.repeat(60));

  // ── STEP 1: 대상 고객 조회 ──
  console.log('\n[STEP 1] [TEST-D1] 고객 조회...');
  const { data: customers, error: custErr } = await supabase
    .from('customers')
    .select('id, name, phone')
    .like('name', '[TEST-D1]%');

  if (custErr) throw new Error(`고객 조회 실패: ${custErr.message}`);

  if (!customers || customers.length === 0) {
    console.log('  ✅ [TEST-D1] 고객 없음 — 이미 정리됐거나 데이터 없음');
    return;
  }

  const customerIds = customers.map(c => c.id);
  console.log(`  📋 대상 고객 ${customers.length}건:`);
  customers.forEach(c => console.log(`     ${c.name}  ${c.phone}`));

  // ── STEP 2: 연관 예약 카운트 ──
  const { count: resvCount } = await supabase
    .from('reservations')
    .select('*', { count: 'exact', head: true })
    .in('customer_id', customerIds);

  // 연관 check_ins 카운트
  const { count: ciCount } = await supabase
    .from('check_ins')
    .select('*', { count: 'exact', head: true })
    .in('customer_id', customerIds);

  console.log(`\n  연관 레코드:`);
  console.log(`    reservations: ${resvCount}건`);
  console.log(`    check_ins:    ${ciCount}건`);

  if (DRY_RUN) {
    console.log('\n🔍 DRY-RUN 완료 — 삭제 없음.');
    console.log('   실행: DRY_RUN=false node scripts/rollback_openday_testdata_20260517.mjs');
    return;
  }

  // ── STEP 3: check_ins 삭제 (있는 경우) ──
  if (ciCount > 0) {
    console.log('\n[STEP 3] check_ins 삭제...');
    const { error: ciErr } = await supabase
      .from('check_ins')
      .delete()
      .in('customer_id', customerIds);
    if (ciErr) throw new Error(`check_ins 삭제 실패: ${ciErr.message}`);
    console.log(`  ✅ check_ins ${ciCount}건 삭제`);
  }

  // ── STEP 4: reservations 삭제 ──
  console.log('\n[STEP 4] reservations 삭제...');
  const { error: resvErr } = await supabase
    .from('reservations')
    .delete()
    .in('customer_id', customerIds);
  if (resvErr) throw new Error(`reservations 삭제 실패: ${resvErr.message}`);
  console.log(`  ✅ reservations ${resvCount}건 삭제`);

  // ── STEP 5: customers 삭제 ──
  console.log('\n[STEP 5] customers 삭제...');
  const { error: custDelErr } = await supabase
    .from('customers')
    .delete()
    .in('id', customerIds);
  if (custDelErr) throw new Error(`customers 삭제 실패: ${custDelErr.message}`);
  console.log(`  ✅ customers ${customers.length}건 삭제`);

  // ── STEP 6: 최종 확인 ──
  const { count: remaining } = await supabase
    .from('customers')
    .select('*', { count: 'exact', head: true })
    .like('name', '[TEST-D1]%');

  console.log('\n' + '='.repeat(60));
  console.log('✅ 롤백 완료');
  console.log(`   삭제 customers: ${customers.length}건`);
  console.log(`   삭제 reservations: ${resvCount}건`);
  console.log(`   삭제 check_ins: ${ciCount}건`);
  console.log(`   잔여 [TEST-D1] 고객: ${remaining}건 ${remaining === 0 ? '✅' : '❌ 확인 필요'}`);
  console.log('='.repeat(60));
}

main().catch(e => {
  console.error('\n❌ 롤백 실패:', e.message);
  process.exit(1);
});
