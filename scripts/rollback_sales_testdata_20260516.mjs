/**
 * rollback — T-20260516-foot-SALES-TESTDATA
 * 매출집계 더미 데이터 삭제 (name LIKE '테스트_%' 고객 기준)
 *
 * 주의:
 *  - is_simulation = false 이므로 기존 cleanup_testdata_20260514.mjs 로 삭제 불가
 *  - 이 스크립트는 '테스트_' 접두사 기반으로 연관 데이터를 cascade 삭제
 *  - 실행 전 반드시 --dry-run 으로 확인
 *
 * 사용법:
 *   node scripts/rollback_sales_testdata_20260516.mjs --dry-run   # 삭제 대상 확인
 *   node scripts/rollback_sales_testdata_20260516.mjs              # 실제 삭제
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const DRY_RUN = process.argv.includes('--dry-run');

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const NAME_PREFIX = '테스트_';

async function main() {
  console.log('='.repeat(60));
  console.log('rollback_sales_testdata_20260516');
  console.log(DRY_RUN ? '🔍 DRY-RUN (실제 삭제 없음)' : '⚡ 실행 모드 (실제 삭제)');
  console.log('='.repeat(60));

  // STEP 1: 테스트 고객 조회
  const { data: customers, error: custErr } = await db
    .from('customers')
    .select('id, name')
    .like('name', `${NAME_PREFIX}%`);

  if (custErr) throw new Error(`고객 조회 실패: ${custErr.message}`);
  console.log(`\n대상 고객 (${customers.length}건):`);
  customers.forEach((c) => console.log(`  - ${c.name} (${c.id})`));

  if (!customers.length) {
    console.log('삭제할 데이터 없음. 종료.');
    return;
  }

  const customerIds = customers.map((c) => c.id);

  // STEP 2: check_ins 조회
  const { data: checkIns } = await db
    .from('check_ins')
    .select('id')
    .in('customer_id', customerIds);

  const checkInIds = (checkIns ?? []).map((ci) => ci.id);
  console.log(`\ncheck_ins: ${checkInIds.length}건`);

  // STEP 3: payments 조회 (check_in 연관)
  const { data: payments } = checkInIds.length
    ? await db.from('payments').select('id').in('check_in_id', checkInIds)
    : { data: [] };

  const paymentIds = (payments ?? []).map((p) => p.id);
  console.log(`payments: ${paymentIds.length}건 (환불 포함)`);

  // DRY-RUN 종료
  if (DRY_RUN) {
    console.log('\n[DRY-RUN] 실제 삭제 없음. --dry-run 플래그 제거 후 재실행.');
    return;
  }

  // STEP 4: 삭제 (cascade 순서: 하위 → 상위)
  if (paymentIds.length) {
    // claim_diagnoses (payment_id FK)
    const { error: e1 } = await db.from('claim_diagnoses').delete().in('payment_id', paymentIds);
    if (e1) console.error('claim_diagnoses 삭제 오류:', e1.message);
    else console.log('✅ claim_diagnoses 삭제');

    // payments (환불 먼저 삭제 — parent_payment_id FK)
    const { error: e2 } = await db
      .from('payments')
      .delete()
      .not('parent_payment_id', 'is', null)
      .in('id', paymentIds);
    if (e2) console.error('환불 payments 삭제 오류:', e2.message);

    const { error: e3 } = await db.from('payments').delete().in('id', paymentIds);
    if (e3) console.error('payments 삭제 오류:', e3.message);
    else console.log('✅ payments 삭제');
  }

  if (checkInIds.length) {
    // service_charges
    const { error: e4 } = await db
      .from('service_charges')
      .delete()
      .in('check_in_id', checkInIds);
    if (e4) console.error('service_charges 삭제 오류:', e4.message);
    else console.log('✅ service_charges 삭제');

    // check_ins
    const { error: e5 } = await db.from('check_ins').delete().in('id', checkInIds);
    if (e5) console.error('check_ins 삭제 오류:', e5.message);
    else console.log('✅ check_ins 삭제');
  }

  // package_payments (고객 ID 기반)
  const { error: e6 } = await db
    .from('package_payments')
    .delete()
    .in('customer_id', customerIds);
  if (e6) console.error('package_payments 삭제 오류:', e6.message);
  else console.log('✅ package_payments 삭제');

  // customers 마지막
  const { error: e7 } = await db.from('customers').delete().in('id', customerIds);
  if (e7) console.error('customers 삭제 오류:', e7.message);
  else console.log('✅ customers 삭제');

  console.log('\n완료.');
}

main().catch(console.error);
