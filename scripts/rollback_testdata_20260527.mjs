/**
 * 풋센터 CRM 더미 데이터 정리 — 5/27 테스트 롤백
 * T-20260526-foot-TEST-RESV-DATA
 *
 * 삭제 대상: 동물명 테스트 고객 8명 및 연관 레코드 전체
 */

import { createClient } from '@supabase/supabase-js';

const ANIMAL_NAMES = ['강아지', '고양이', '토끼', '판다', '사자', '호랑이', '코끼리', '기린'];
const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) {
    console.error(`❌ ${label}:`, error.message);
    throw new Error(`${label}: ${error.message}`);
  }
  return data;
}

async function main() {
  console.log('🗑️  더미 데이터 정리 시작 (5/27 테스트 롤백)');
  console.log(`   대상: ${ANIMAL_NAMES.join(', ')}`);

  // 대상 고객 ID 수집
  const { data: targets, error: fetchErr } = await supabase
    .from('customers')
    .select('id, name')
    .in('name', ANIMAL_NAMES)
    .eq('is_simulation', true);

  if (fetchErr) throw new Error(`고객 조회 실패: ${fetchErr.message}`);
  if (!targets || targets.length === 0) {
    console.log('⚠️  삭제할 테스트 데이터 없음 (이미 정리됨)');
    return;
  }

  const targetIds = targets.map(c => c.id);
  console.log(`  발견: ${targets.map(c => c.name).join(', ')} (${targetIds.length}명)`);

  // 1. payments
  const { count: payCount } = await supabase
    .from('payments')
    .delete({ count: 'exact' })
    .in('customer_id', targetIds);
  console.log(`  ✔ payments 삭제: ${payCount ?? 0}건`);

  // 2. check_ins
  const { count: ciCount } = await supabase
    .from('check_ins')
    .delete({ count: 'exact' })
    .in('customer_id', targetIds);
  console.log(`  ✔ check_ins 삭제: ${ciCount ?? 0}건`);

  // 3. reservations
  const { count: rsvCount } = await supabase
    .from('reservations')
    .delete({ count: 'exact' })
    .in('customer_id', targetIds);
  console.log(`  ✔ reservations 삭제: ${rsvCount ?? 0}건`);

  // 4. package_sessions
  const { data: pkgs } = await supabase
    .from('packages')
    .select('id')
    .in('customer_id', targetIds);
  if (pkgs && pkgs.length > 0) {
    const pkgIds = pkgs.map(p => p.id);
    await must('package_sessions 삭제',
      supabase.from('package_sessions').delete().in('package_id', pkgIds)
    );
  }

  // 5. packages
  const { count: pkgCount } = await supabase
    .from('packages')
    .delete({ count: 'exact' })
    .in('customer_id', targetIds);
  console.log(`  ✔ packages 삭제: ${pkgCount ?? 0}건`);

  // 6. customers
  const { count: custCount } = await supabase
    .from('customers')
    .delete({ count: 'exact' })
    .in('id', targetIds);
  console.log(`  ✔ customers 삭제: ${custCount ?? 0}명`);

  console.log('\n✅ 롤백 완료');
}

main().catch(e => {
  console.error('❌ 롤백 실패:', e.message);
  process.exit(1);
});
