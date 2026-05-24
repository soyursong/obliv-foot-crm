/**
 * 롤백: 5/25 현장 테스트 더미 데이터 V2 삭제 — 테스트 종료 후 실행
 * T-20260525-foot-DUMMY-TEST-DATA-V2
 *
 * 대상: phone LIKE '+82109906%' AND is_simulation=true
 *   → +821099060001~+821099060136 (초진68 + 재진68)
 *
 * 삭제 순서 (FK 의존성):
 *   check_ins → reservations → packages → customers
 *
 * ※ V1(5/22) 데이터 (+82100000020X~029X) 는 영향 없음
 * ※ +82109905XXXX (5/17 [TEST5] 20건) 는 영향 없음
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  console.log('🗑️  V2 테스트 데이터 롤백 시작 (T-20260525-foot-DUMMY-TEST-DATA-V2)');
  console.log('   대상 전화번호 범위: +82109906xxxx');

  // Step 1: V2 대상 고객 ID 수집 (전화번호 범위로 식별)
  const { data: testCusts, error: findErr } = await supabase
    .from('customers')
    .select('id')
    .like('phone', '+82109906%')
    .eq('is_simulation', true);
  if (findErr) throw new Error(`고객 조회 실패: ${findErr.message}`);

  const ids = (testCusts || []).map(c => c.id);
  console.log(`\n  대상 고객: ${ids.length}명`);

  if (ids.length === 0) {
    console.log('  ℹ️  V2 테스트 데이터가 없습니다. 이미 삭제되었거나 삽입 전입니다.');
    return;
  }

  // Step 2: check_ins 삭제 (과거 체크인 + 오늘 체크인 모두)
  const { data: delCI, error: ciErr } = await supabase
    .from('check_ins')
    .delete()
    .in('customer_id', ids)
    .select('id');
  if (ciErr) throw new Error(`check_ins 삭제 실패: ${ciErr.message}`);
  console.log(`  ✅ check_ins 삭제: ${delCI?.length || 0}건`);

  // Step 3: reservations 삭제
  const { data: delRes, error: resErr } = await supabase
    .from('reservations')
    .delete()
    .in('customer_id', ids)
    .select('id');
  if (resErr) throw new Error(`reservations 삭제 실패: ${resErr.message}`);
  console.log(`  ✅ reservations 삭제: ${delRes?.length || 0}건`);

  // Step 4: packages + package_sessions 삭제 (시드에서는 생성 안 하지만 혹시를 위해)
  const { data: pkgs } = await supabase
    .from('packages')
    .select('id')
    .in('customer_id', ids);
  if (pkgs && pkgs.length > 0) {
    const pkgIds = pkgs.map(p => p.id);
    await supabase.from('package_sessions').delete().in('package_id', pkgIds);
    await supabase.from('packages').delete().in('customer_id', ids);
    console.log(`  ✅ packages 삭제: ${pkgIds.length}건`);
  }

  // Step 5: customers 삭제
  const { data: delCust, error: custErr } = await supabase
    .from('customers')
    .delete()
    .in('id', ids)
    .select('id');
  if (custErr) throw new Error(`customers 삭제 실패: ${custErr.message}`);
  console.log(`  ✅ customers 삭제: ${delCust?.length || 0}명`);

  console.log('\n✅ V2 테스트 데이터 롤백 완료');
  console.log('   V1(5/22) 데이터는 영향 없음');
}

main().catch(e => {
  console.error('❌ 롤백 실패:', e.message);
  process.exit(1);
});
