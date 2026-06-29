/**
 * 롤백: 5/22 현장 테스트 더미 데이터 삭제 — 테스트 종료 후 실행
 * T-20260521-foot-DUMMY-TEST-DATA
 *
 * 삭제 순서 (FK 의존성):
 *   check_ins → reservations → customers
 *
 * 대상: name LIKE '테스트초진%' OR name LIKE '테스트재진%'  AND is_simulation=true
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  console.log('🗑️  테스트 데이터 롤백 시작...');

  // Step 1: 테스트 고객 ID 목록 수집
  const { data: testCusts, error: findErr } = await supabase
    .from('customers')
    .select('id')
    .or('name.ilike.테스트초진%,name.ilike.테스트재진%')
    .eq('is_simulation', true);
  if (findErr) throw new Error(`고객 조회 실패: ${findErr.message}`);

  const ids = (testCusts || []).map(c => c.id);
  console.log(`  대상 고객: ${ids.length}명`);

  if (ids.length === 0) {
    console.log('  ℹ️  테스트 데이터가 없습니다. 이미 삭제되었거나 삽입 전입니다.');
    return;
  }

  // Step 2: check_ins 삭제 (과거 체크인 포함)
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

  // Step 4: packages/package_sessions 삭제 (만약 생성된 경우)
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

  console.log('\n✅ 테스트 데이터 롤백 완료');
}

main().catch(e => {
  console.error('❌ 롤백 실패:', e.message);
  process.exit(1);
});
