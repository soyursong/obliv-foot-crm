/**
 * 풋센터 CRM 더미 데이터 정리 — 6/1 테스트 롤백
 *
 * 삭제 대상:
 *   - is_simulation=true + phone IN (+821099070001 ~ +821099070084) 고객 및 연관 레코드
 *   - 전화번호 기준으로 정확히 삭제 (실환자 보호)
 */

import { createClient } from '@supabase/supabase-js';

// 삭제 대상 전화번호 (초진 42 + 재진 42 = 84명)
const TARGET_PHONES = [
  // 초진(채소) +821099070001 ~ +821099070042
  ...Array.from({ length: 42 }, (_, i) => `+821099070${String(i + 1).padStart(3, '0')}`),
  // 재진(색깔) +821099070043 ~ +821099070084
  ...Array.from({ length: 42 }, (_, i) => `+821099070${String(43 + i).padStart(3, '0')}`),
];

const SUPABASE_URL     = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  console.log('🗑️  더미 데이터 정리 시작 (6/1 테스트 롤백)');
  console.log(`   대상 전화번호: ${TARGET_PHONES.length}개`);

  // 대상 고객 ID 수집 (is_simulation=true 필터로 실환자 보호)
  const { data: targets, error: fetchErr } = await supabase
    .from('customers')
    .select('id, name, phone')
    .in('phone', TARGET_PHONES)
    .eq('is_simulation', true);

  if (fetchErr) throw new Error(`고객 조회 실패: ${fetchErr.message}`);
  if (!targets || targets.length === 0) {
    console.log('⚠️  삭제할 테스트 데이터 없음 (이미 정리됨)');
    return;
  }

  const targetIds = targets.map(c => c.id);
  console.log(`  발견: ${targetIds.length}명 — ${targets.slice(0, 10).map(c => c.name).join(', ')}${targets.length > 10 ? ` 외 ${targets.length - 10}명` : ''}`);

  // 1. payments
  const { count: payCount } = await supabase
    .from('payments')
    .delete({ count: 'exact' })
    .in('customer_id', targetIds);
  console.log(`  ✔ payments 삭제: ${payCount ?? 0}건`);

  // 2. check_in_services
  const { data: ciTargets } = await supabase
    .from('check_ins')
    .select('id')
    .in('customer_id', targetIds);
  if (ciTargets && ciTargets.length > 0) {
    const ciIds = ciTargets.map(ci => ci.id);
    const { count: cisCount } = await supabase
      .from('check_in_services')
      .delete({ count: 'exact' })
      .in('check_in_id', ciIds);
    console.log(`  ✔ check_in_services 삭제: ${cisCount ?? 0}건`);

    // 3. status_transitions
    const { count: stCount } = await supabase
      .from('status_transitions')
      .delete({ count: 'exact' })
      .in('check_in_id', ciIds);
    console.log(`  ✔ status_transitions 삭제: ${stCount ?? 0}건`);
  }

  // 4. check_ins
  const { count: ciCount } = await supabase
    .from('check_ins')
    .delete({ count: 'exact' })
    .in('customer_id', targetIds);
  console.log(`  ✔ check_ins 삭제: ${ciCount ?? 0}건`);

  // 5. reservations
  const { count: rsvCount } = await supabase
    .from('reservations')
    .delete({ count: 'exact' })
    .in('customer_id', targetIds);
  console.log(`  ✔ reservations 삭제: ${rsvCount ?? 0}건`);

  // 6. package_sessions (packages 경유)
  const { data: pkgs } = await supabase
    .from('packages')
    .select('id')
    .in('customer_id', targetIds);
  if (pkgs && pkgs.length > 0) {
    const pkgIds = pkgs.map(p => p.id);
    const { count: psCount } = await supabase
      .from('package_sessions')
      .delete({ count: 'exact' })
      .in('package_id', pkgIds);
    console.log(`  ✔ package_sessions 삭제: ${psCount ?? 0}건`);
  }

  // 7. packages
  const { count: pkgCount } = await supabase
    .from('packages')
    .delete({ count: 'exact' })
    .in('customer_id', targetIds);
  console.log(`  ✔ packages 삭제: ${pkgCount ?? 0}건`);

  // 8. consent_forms
  const { count: cfCount } = await supabase
    .from('consent_forms')
    .delete({ count: 'exact' })
    .in('customer_id', targetIds);
  console.log(`  ✔ consent_forms 삭제: ${cfCount ?? 0}건`);

  // 9. customers (마지막 — FK 의존)
  const { count: custCount } = await supabase
    .from('customers')
    .delete({ count: 'exact' })
    .in('id', targetIds);
  console.log(`  ✔ customers 삭제: ${custCount ?? 0}명`);

  console.log('\n✅ 롤백 완료 (6/1 테스트 데이터 전체 삭제)');
}

main().catch(e => {
  console.error('❌ 롤백 실패:', e.message);
  process.exit(1);
});
