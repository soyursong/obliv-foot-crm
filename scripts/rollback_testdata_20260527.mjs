/**
 * 풋센터 CRM 더미 데이터 정리 — 5/27 테스트 롤백 (v3)
 * T-20260526-foot-TEST-RESV-DATA
 *
 * 삭제 대상: is_simulation=true 동물명 테스트 고객 및 연관 레코드 전체
 * v3(현행): 고객 8명(강아지~기린), 예약 64건
 * v2(이전): 고객 64명(슬롯별 고유 동물) — 이미 삽입된 경우 함께 처리
 * v1(최초): 고객 8명(강아지~기린) — v3와 동일 이름풀
 */

import { createClient } from '@supabase/supabase-js';

// v1 동물 (8마리)
const V1_ANIMALS = ['강아지', '고양이', '토끼', '판다', '사자', '호랑이', '코끼리', '기린'];

// v2 동물 (64마리 — 슬롯별 고유)
const V2_ANIMALS = [
  // 11:00
  '강아지', '고양이', '토끼', '판다', '사자', '호랑이', '코끼리', '기린',
  // 12:00
  '햄스터', '앵무새', '거북이', '고슴도치', '여우', '늑대', '곰', '원숭이',
  // 13:00
  '다람쥐', '공작새', '독수리', '학', '펭귄', '북극곰', '캥거루', '코알라',
  // 14:00
  '오리', '참새', '까치', '비둘기', '치타', '표범', '하이에나', '재규어',
  // 15:00
  '돌고래', '고래', '상어', '바다사자', '악어', '이구아나', '도마뱀', '카멜레온',
  // 16:00
  '낙타', '얼룩말', '하마', '코뿔소', '두루미', '황새', '왜가리', '해오라기',
  // 17:00
  '수달', '밍크', '오소리', '족제비', '사슴', '노루', '고라니', '염소',
  // 18:00
  '문어', '오징어', '낙지', '꽃게', '개구리', '두꺼비', '도롱뇽', '뱀',
];

// 중복 제거 (강아지 등 v1과 v2 겹치는 경우)
const ALL_ANIMALS = [...new Set([...V1_ANIMALS, ...V2_ANIMALS])];

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })());

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  console.log('🗑️  더미 데이터 정리 시작 (5/27 테스트 롤백 v2)');
  console.log(`   대상 이름 풀: ${ALL_ANIMALS.length}개`);

  // 대상 고객 ID 수집 (is_simulation=true 필터로 실환자 보호)
  const { data: targets, error: fetchErr } = await supabase
    .from('customers')
    .select('id, name')
    .in('name', ALL_ANIMALS)
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

  console.log('\n✅ 롤백 완료');
}

main().catch(e => {
  console.error('❌ 롤백 실패:', e.message);
  process.exit(1);
});
