/**
 * 비가열 레이저 타이머 — 수동 QA 재현용 시드
 * T-20260523-foot-LASER-TIMER (FIX-REQUEST phase2)
 *
 * 목적: 브라우저 수동 QA 시 대시보드에 "오늘 날짜 활성 check-in" 카드가 1건 보장되도록
 *       시드한다. 카드를 좌클릭하면 2번차트(CustomerChartSheet)가 열리고
 *       [상세] 탭 상단의 비가열 레이저 타이머 패널을 즉시 검증할 수 있다.
 *
 * 자동 E2E(tests/e2e/T-20260523-foot-LASER-TIMER.spec.ts)는 자체적으로 동일 시드를
 *       beforeAll 에서 만들고 afterAll 에서 정리하므로 이 스크립트는 "사람 QA" 전용이다.
 *
 * 테스트 계정: test@medibuilder.com / TestPass2026!  (종로 풋센터)
 *
 * 실행:  node --env-file=.env scripts/seed_laser_timer_qa.mjs
 * 정리:  node --env-file=.env scripts/seed_laser_timer_qa.mjs --rollback
 */
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 종로 풋센터
const SEED_NAME = '레이저타이머QA';
const SEED_PHONE = '+821099069999';

if (!SUPA_URL || !SERVICE_KEY) {
  console.error('❌ VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 env 에 없습니다.');
  console.error('   실행 예: node --env-file=.env scripts/seed_laser_timer_qa.mjs');
  process.exit(1);
}

const sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
const rollback = process.argv.includes('--rollback');

async function cleanup() {
  // 기존 시드(고객→체크인→타이머) 제거
  const { data: cust } = await sb
    .from('customers')
    .select('id')
    .eq('clinic_id', CLINIC_ID)
    .eq('phone', SEED_PHONE);
  for (const c of cust ?? []) {
    const { data: cis } = await sb.from('check_ins').select('id').eq('customer_id', c.id);
    for (const ci of cis ?? []) {
      await sb.from('timer_records').delete().eq('check_in_id', ci.id);
    }
    await sb.from('check_ins').delete().eq('customer_id', c.id);
    await sb.from('customers').delete().eq('id', c.id);
  }
}

async function main() {
  if (rollback) {
    await cleanup();
    console.log('✅ 레이저 타이머 QA 시드 정리 완료');
    return;
  }

  // 재실행 시 중복 방지 — 먼저 정리
  await cleanup();

  const { data: customer, error: custErr } = await sb
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name: SEED_NAME, phone: SEED_PHONE, visit_type: 'returning', is_simulation: true })
    .select('id')
    .single();
  if (custErr) throw new Error(`고객 생성 실패: ${custErr.message}`);

  const { data: checkIn, error: ciErr } = await sb
    .from('check_ins')
    .insert({
      clinic_id: CLINIC_ID,
      customer_id: customer.id,
      customer_name: SEED_NAME,
      customer_phone: SEED_PHONE,
      visit_type: 'returning',
      status: 'treatment_waiting',
      queue_number: 9999,
    })
    .select('id')
    .single();
  if (ciErr) throw new Error(`체크인 생성 실패: ${ciErr.message}`);

  console.log('✅ 레이저 타이머 QA 시드 완료');
  console.log(`   고객: ${SEED_NAME} (${SEED_PHONE})  check_in_id=${checkIn.id}`);
  console.log('   대시보드(치료대기) → 카드 좌클릭 → 2번차트 [상세] 상단에서 타이머 확인');
  console.log('   정리: node --env-file=.env scripts/seed_laser_timer_qa.mjs --rollback');
}

main().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
