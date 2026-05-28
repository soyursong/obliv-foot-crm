/**
 * 풋센터 CRM 더미 데이터 정리 — 5/29 테스트 롤백
 * T-20260529-foot-DUMMY-RESV-80
 *
 * 삭제 대상:
 *   - is_simulation=true + phone IN (+821000002901 ~ +821000002980) 고객 및 연관 레코드
 *   - 전화번호 기준으로 정확히 삭제 (실환자 보호)
 */

import { createClient } from '@supabase/supabase-js';

// 삭제 대상 전화번호 (초진 40 + 재진 40 = 80명)
const TARGET_PHONES = [
  // 초진(동물) +821000002901 ~ +821000002940
  ...Array.from({ length: 40 }, (_, i) => `+8210000029${String(i + 1).padStart(2, '0')}`),
  // 재진(과일) +821000002941 ~ +821000002980
  ...Array.from({ length: 40 }, (_, i) => `+8210000029${41 + i}`),
];

const SUPABASE_URL     = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  console.log('🗑️  더미 데이터 정리 시작 (5/29 테스트 롤백)');
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
  console.log(`  발견: ${targetIds.length}명 — ${targets.map(c => c.name).join(', ')}`);

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
    const { count: psCount } = await supabase
      .from('package_sessions')
      .delete({ count: 'exact' })
      .in('package_id', pkgIds);
    console.log(`  ✔ package_sessions 삭제: ${psCount ?? 0}건`);
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

  console.log('\n✅ 롤백 완료 (5/29 테스트 데이터 전체 삭제)');
}

main().catch(e => {
  console.error('❌ 롤백 실패:', e.message);
  process.exit(1);
});
