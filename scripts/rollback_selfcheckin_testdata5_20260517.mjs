/**
 * 롤백: [TEST5] 더미 데이터 삭제
 * T-20260517-foot-SELFCHECKIN-TESTDATA5
 * customers + reservations 에서 [TEST5] prefix 전부 삭제
 * check_ins는 삽입하지 않았으므로 삭제 불필요
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

async function main() {
  console.log('🗑️ [TEST5] 롤백 시작...');

  // 1. reservations 먼저 삭제 (FK 의존)
  const { data: delRes, error: resErr } = await supabase
    .from('reservations')
    .delete()
    .ilike('customer_name', '[TEST5]%')
    .select('id');
  if (resErr) throw new Error(`reservations 삭제 실패: ${resErr.message}`);
  console.log(`  ✅ reservations 삭제: ${delRes?.length || 0}건`);

  // 2. customers 삭제
  const { data: delCust, error: custErr } = await supabase
    .from('customers')
    .delete()
    .ilike('name', '[TEST5]%')
    .eq('is_simulation', true)
    .select('id');
  if (custErr) throw new Error(`customers 삭제 실패: ${custErr.message}`);
  console.log(`  ✅ customers 삭제: ${delCust?.length || 0}건`);

  console.log('✅ [TEST5] 롤백 완료');
}

main().catch(e => {
  console.error('❌ 롤백 실패:', e.message);
  process.exit(1);
});
