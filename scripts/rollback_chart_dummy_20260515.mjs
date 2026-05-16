/**
 * 롤백: [TEST-CHART] prefix 기준 더미데이터 전체 삭제
 * T-20260515-foot-CHART-DUMMY-RICH
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

async function run() {
  console.log('=== [TEST-CHART] 더미데이터 롤백 시작 ===\n');

  // 1. [TEST-CHART] 고객 ID 조회
  const { data: customers, error: cErr } = await supabase
    .from('customers')
    .select('id')
    .ilike('name', '[TEST-CHART]%');
  if (cErr) throw new Error(`고객 조회 실패: ${cErr.message}`);
  if (!customers || customers.length === 0) {
    console.log('삭제할 [TEST-CHART] 고객 없음. 종료.');
    return;
  }
  const customerIds = customers.map(c => c.id);
  console.log(`대상 고객 ${customerIds.length}명: ${customerIds.join(', ')}`);

  // 2. check_in IDs 조회 (cascade 전에 payments / package_sessions 삭제)
  const { data: checkIns } = await supabase
    .from('check_ins')
    .select('id')
    .in('customer_id', customerIds);
  const checkInIds = (checkIns ?? []).map(c => c.id);

  // 3. package IDs 조회
  const { data: packages } = await supabase
    .from('packages')
    .select('id')
    .in('customer_id', customerIds);
  const packageIds = (packages ?? []).map(p => p.id);

  // 4. package_sessions 삭제
  if (packageIds.length > 0) {
    const { error } = await supabase.from('package_sessions').delete().in('package_id', packageIds);
    if (error) throw new Error(`package_sessions 삭제 실패: ${error.message}`);
    console.log(`package_sessions 삭제 완료 (pkg: ${packageIds.length})`);
  }

  // 5. payments 삭제
  if (customerIds.length > 0) {
    const { error } = await supabase.from('payments').delete().in('customer_id', customerIds);
    if (error) throw new Error(`payments 삭제 실패: ${error.message}`);
    console.log('payments 삭제 완료');
  }

  // 6. package_payments 삭제
  if (customerIds.length > 0) {
    const { error } = await supabase.from('package_payments').delete().in('customer_id', customerIds);
    if (error) console.warn(`package_payments 삭제 경고: ${error.message}`);
  }

  // 7. check_ins 먼저 삭제 (packages FK 해제 위해)
  if (checkInIds.length > 0) {
    const { error } = await supabase.from('check_ins').delete().in('id', checkInIds);
    if (error) throw new Error(`check_ins 삭제 실패: ${error.message}`);
    console.log(`check_ins 삭제 완료 (${checkInIds.length}건)`);
  }

  // 8. packages 삭제
  if (packageIds.length > 0) {
    const { error } = await supabase.from('packages').delete().in('id', packageIds);
    if (error) throw new Error(`packages 삭제 실패: ${error.message}`);
    console.log(`packages 삭제 완료 (${packageIds.length}건)`);
  }

  // 9. reservations 삭제
  if (customerIds.length > 0) {
    const { error } = await supabase.from('reservations').delete().in('customer_id', customerIds);
    if (error) console.warn(`reservations 삭제 경고: ${error.message}`);
  }

  // 10. 고객 삭제
  const { error: delCErr } = await supabase
    .from('customers')
    .delete()
    .in('id', customerIds);
  if (delCErr) throw new Error(`고객 삭제 실패: ${delCErr.message}`);
  console.log(`고객 삭제 완료 (${customerIds.length}명)`);

  console.log('\n=== 롤백 완료 ===');
}

run().catch(e => {
  console.error('롤백 실패:', e.message);
  process.exit(1);
});
