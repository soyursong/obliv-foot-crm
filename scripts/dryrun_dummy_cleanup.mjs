/**
 * Dry-run: 운영 DB 테스트 더미 데이터 현황 조회
 * T-20260525-foot-DUMMY-DATA-CLEANUP
 *
 * 대상:
 *   - V1 (5/22): 테스트초진01~48 + 테스트재진01~48 (96건)
 *   - V2 (5/25): 테스트초진01~68 + 테스트재진01~68 (136건)
 *   조건: name LIKE '테스트초진%' OR name LIKE '테스트재진%' AND is_simulation=true
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  console.log('🔍 [DRY-RUN] 테스트 더미 데이터 현황 조회...\n');

  // customers 조회
  const { data: custs, error: custErr } = await supabase
    .from('customers')
    .select('id, name, phone, is_simulation, created_at')
    .or('name.ilike.테스트초진%,name.ilike.테스트재진%')
    .eq('is_simulation', true)
    .order('name');

  if (custErr) throw new Error(`customers 조회 실패: ${custErr.message}`);

  const ids = (custs || []).map(c => c.id);
  console.log(`✅ customers: ${ids.length}명`);

  // V1 vs V2 분류
  const v1 = (custs || []).filter(c => c.phone?.startsWith('+821000000'));
  const v2 = (custs || []).filter(c => c.phone?.startsWith('+82109906'));
  const other = (custs || []).filter(c => !c.phone?.startsWith('+821000000') && !c.phone?.startsWith('+82109906'));
  console.log(`   - V1 (5/22, +821000000xx): ${v1.length}명`);
  console.log(`   - V2 (5/25, +82109906xx): ${v2.length}명`);
  if (other.length > 0) {
    console.log(`   - 기타 전화번호: ${other.length}명`);
    other.forEach(c => console.log(`     ⚠️  ${c.name} / ${c.phone}`));
  }

  if (ids.length === 0) {
    console.log('\nℹ️  테스트 데이터가 없습니다. 이미 삭제되었습니다.');
    return;
  }

  // check_ins 조회
  const { data: cis, error: ciErr } = await supabase
    .from('check_ins')
    .select('id, customer_id, status, created_at')
    .in('customer_id', ids);
  if (ciErr) throw new Error(`check_ins 조회 실패: ${ciErr.message}`);
  console.log(`\n✅ check_ins: ${(cis || []).length}건`);

  // reservations 조회
  const { data: res, error: resErr } = await supabase
    .from('reservations')
    .select('id, customer_id, reservation_date, reservation_time, status')
    .in('customer_id', ids);
  if (resErr) throw new Error(`reservations 조회 실패: ${resErr.message}`);
  console.log(`✅ reservations: ${(res || []).length}건`);

  // packages 조회
  const { data: pkgs, error: pkgErr } = await supabase
    .from('packages')
    .select('id, customer_id')
    .in('customer_id', ids);
  if (pkgErr) throw new Error(`packages 조회 실패: ${pkgErr.message}`);
  console.log(`✅ packages: ${(pkgs || []).length}건`);

  console.log('\n📊 총 삭제 예정:');
  console.log(`   customers:    ${ids.length}명`);
  console.log(`   check_ins:    ${(cis || []).length}건`);
  console.log(`   reservations: ${(res || []).length}건`);
  console.log(`   packages:     ${(pkgs || []).length}건`);
  console.log('\n[DRY-RUN 완료 — 실제 삭제는 cleanup_testdata_dummy_20260525.mjs 실행]');
}

main().catch(e => {
  console.error('❌ 조회 실패:', e.message);
  process.exit(1);
});
