/**
 * T-20260514-foot-TESTDATA-CLEANUP
 * 셀프접수 테스트 더미 데이터 전체 정리 (5/14 수납대기 노출 해소)
 * 대상: [TEST]%, [TEST2]%, [TEST3]% prefix + is_simulation = true
 * ⚠️  is_simulation = true 필터 필수 — 실 환자 보호
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const DRY_RUN = process.argv.includes('--dry-run');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

// 대상 고객 식별 (is_simulation = true 필수 안전망)
const TEST_NAME_PATTERNS = ['[TEST]', '[TEST2]', '[TEST3]'];

async function getTestCustomerIds() {
  const { data, error } = await supabase
    .from('customers')
    .select('id, name, phone, is_simulation')
    .or('name.like.[TEST]%,name.like.[TEST2]%,name.like.[TEST3]%')
    .eq('is_simulation', true);

  if (error) throw new Error(`고객 조회 실패: ${error.message}`);
  return data || [];
}

async function main() {
  console.log('='.repeat(60));
  console.log('T-20260514-foot-TESTDATA-CLEANUP');
  console.log('셀프접수 테스트 더미 데이터 정리');
  console.log(DRY_RUN ? '🔍 DRY-RUN 모드 (실제 삭제 없음)' : '⚡ 실행 모드 (실제 삭제)');
  console.log('='.repeat(60));

  // ── STEP 1: 대상 고객 조회 (dry-run 포함 필수) ──
  console.log('\n[STEP 1] 대상 고객 조회 (is_simulation = true 필터)...');
  const customers = await getTestCustomerIds();

  if (customers.length === 0) {
    console.log('✅ 대상 테스트 고객 없음 — 이미 정리됐거나 데이터 없음');
    return;
  }

  const customerIds = customers.map(c => c.id);
  console.log(`\n📋 대상 고객 ${customers.length}건:`);
  customers.forEach(c => console.log(`  - ${c.name} (${c.phone}) [is_simulation=${c.is_simulation}]`));

  // ── STEP 2: 연관 레코드 카운트 조회 ──
  console.log('\n[STEP 2] 연관 레코드 카운트 조회...');

  // 예약 (reservation_date 기준으로도 확인)
  const { count: reservCount } = await supabase
    .from('reservations')
    .select('*', { count: 'exact', head: true })
    .in('customer_id', customerIds);

  // 체크인 (수납대기 건 포함)
  const { count: checkinCount } = await supabase
    .from('check_ins')
    .select('*', { count: 'exact', head: true })
    .in('customer_id', customerIds);

  // 결제
  const { count: paymentCount } = await supabase
    .from('payments')
    .select('*', { count: 'exact', head: true })
    .in('customer_id', customerIds);

  console.log(`  reservations  : ${reservCount}건`);
  console.log(`  check_ins     : ${checkinCount}건 (수납대기 포함)`);
  console.log(`  payments      : ${paymentCount}건`);

  // check_in 상세 (수납대기 칸 노출 건 확인)
  const { data: pendingCheckIns } = await supabase
    .from('check_ins')
    .select('id, customer_name, status, checked_in_at')
    .in('customer_id', customerIds)
    .neq('status', 'done');

  if (pendingCheckIns && pendingCheckIns.length > 0) {
    console.log(`\n⚠️  수납대기 등 미완료 check_ins ${pendingCheckIns.length}건:`);
    pendingCheckIns.forEach(ci =>
      console.log(`  - ${ci.customer_name} / status=${ci.status} / ${ci.checked_in_at}`)
    );
  }

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] 위 데이터가 삭제될 예정. --dry-run 플래그 제거 후 재실행하세요.');
    return;
  }

  // ── STEP 3: 실제 삭제 (FK 의존성 순서 준수) ──
  console.log('\n[STEP 3] 삭제 실행...');

  // 체크인 IDs 수집 (서브테이블 삭제에 필요)
  const { data: checkinRows } = await supabase
    .from('check_ins')
    .select('id')
    .in('customer_id', customerIds);
  const checkinIds = (checkinRows || []).map(r => r.id);

  // 패키지 IDs 수집
  const { data: packageRows } = await supabase
    .from('packages')
    .select('id')
    .in('customer_id', customerIds);
  const packageIds = (packageRows || []).map(r => r.id);

  async function del(table, filter, desc) {
    let q = supabase.from(table).delete();
    q = filter(q);
    const { error, count } = await q;
    if (error) throw new Error(`${table} 삭제 실패: ${error.message}`);
    console.log(`  ✅ ${table.padEnd(22)} ${desc} — ${count ?? '?'}건 삭제`);
  }

  // 1. check_in_services
  if (checkinIds.length > 0) {
    await del('check_in_services',
      q => q.in('check_in_id', checkinIds),
      'check_in_id IN test');
  }

  // 2. package_sessions
  if (packageIds.length > 0) {
    await del('package_sessions',
      q => q.in('package_id', packageIds),
      'package_id IN test');
  }

  // 3. status_transitions
  if (checkinIds.length > 0) {
    await del('status_transitions',
      q => q.in('check_in_id', checkinIds),
      'check_in_id IN test');
  }

  // 4. consent_forms
  await del('consent_forms',
    q => q.in('customer_id', customerIds),
    'customer_id IN test');

  // 5. checklists
  await del('checklists',
    q => q.in('customer_id', customerIds),
    'customer_id IN test');

  // 6. payments (customer_id 기준)
  await del('payments',
    q => q.in('customer_id', customerIds),
    'customer_id IN test');

  // 7. package_payments
  await del('package_payments',
    q => q.in('customer_id', customerIds),
    'customer_id IN test');

  // 7b. payment_audit_logs (check_in_id FK)
  if (checkinIds.length > 0) {
    await del('payment_audit_logs',
      q => q.in('check_in_id', checkinIds),
      'check_in_id IN test');
  }

  // 7c. service_charges (check_in_id FK)
  if (checkinIds.length > 0) {
    await del('service_charges',
      q => q.in('check_in_id', checkinIds),
      'check_in_id IN test');
  }

  // 8. check_ins (수납대기 포함 전체)
  await del('check_ins',
    q => q.in('customer_id', customerIds),
    'customer_id IN test');

  // 9. packages
  await del('packages',
    q => q.in('customer_id', customerIds),
    'customer_id IN test');

  // 10. reservations
  await del('reservations',
    q => q.in('customer_id', customerIds),
    'customer_id IN test');

  // 11. customers (마지막 — FK 상위)
  await del('customers',
    q => q.in('id', customerIds).eq('is_simulation', true),
    'id IN test + is_simulation=true');

  // ── STEP 4: 검증 ──
  console.log('\n[STEP 4] 삭제 후 검증...');

  const { data: remaining } = await supabase
    .from('customers')
    .select('id, name')
    .or('name.like.[TEST]%,name.like.[TEST2]%,name.like.[TEST3]%')
    .eq('is_simulation', true);

  if (!remaining || remaining.length === 0) {
    console.log('✅ 검증 완료 — [TEST/TEST2/TEST3] 테스트 고객 0건 잔여');
  } else {
    console.log(`⚠️  ${remaining.length}건 잔여 (확인 필요):`, remaining);
  }

  // AC-4: 수납대기 칸 잔여 확인
  const { data: pendingAfter } = await supabase
    .from('check_ins')
    .select('id, customer_name, status')
    .or('customer_name.like.[TEST]%,customer_name.like.[TEST2]%,customer_name.like.[TEST3]%')
    .neq('status', 'done');

  if (!pendingAfter || pendingAfter.length === 0) {
    console.log('✅ AC-4: 수납대기 칸 테스트 데이터 0건 — 현장 대시보드 정상');
  } else {
    console.log(`⚠️  수납대기 잔여 ${pendingAfter.length}건:`, pendingAfter);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ T-20260514-foot-TESTDATA-CLEANUP 완료');
  console.log('='.repeat(60));
}

main().catch(e => {
  console.error('\n❌ 오류 발생:', e.message);
  process.exit(1);
});
