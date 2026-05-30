/**
 * 대시보드 패키지 보유 배지 — 수동 QA 재현용 시드
 * T-20260522-foot-PKG-BOX-INDICATOR (FIX-REQUEST phase2 browser_diag_fail)
 *
 * 목적: 브라우저 수동 QA 시 대시보드에 "오늘 활성 check-in + 잔여>0 활성 패키지" 고객
 *       카드가 1건 보장되도록 시드한다. 해당 카드 우상단에 보라색 패키지 배지(📦)가
 *       즉시 보여야 한다. 비교용으로 패키지 미보유 고객 카드도 1건 함께 시드한다.
 *
 * 자동 E2E(tests/e2e/T-20260522-foot-PKG-BOX-INDICATOR.spec.ts)는 동일 시드를
 *       beforeAll 에서 만들고 afterAll 에서 정리하므로 이 스크립트는 "사람 QA" 전용이다.
 *
 * 테스트 계정: test@medibuilder.com / TestPass2026!  (종로 풋센터)
 *
 * 실행:  node --env-file=.env scripts/seed_pkg_box_indicator_qa.mjs
 * 정리:  node --env-file=.env scripts/seed_pkg_box_indicator_qa.mjs --rollback
 */
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 종로 풋센터
const PKG_NAME = '패키지배지QA';
const PKG_PHONE = '+821099068888';
const NOPKG_NAME = '미보유QA';
const NOPKG_PHONE = '+821099067777';

if (!SUPA_URL || !SERVICE_KEY) {
  console.error('❌ VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 env 에 없습니다.');
  console.error('   실행 예: node --env-file=.env scripts/seed_pkg_box_indicator_qa.mjs');
  process.exit(1);
}

const sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
const rollback = process.argv.includes('--rollback');

async function cleanupOne(phone) {
  const { data: cust } = await sb
    .from('customers')
    .select('id')
    .eq('clinic_id', CLINIC_ID)
    .eq('phone', phone);
  for (const c of cust ?? []) {
    const { data: pkgs } = await sb.from('packages').select('id').eq('customer_id', c.id);
    for (const p of pkgs ?? []) {
      await sb.from('package_sessions').delete().eq('package_id', p.id);
    }
    await sb.from('packages').delete().eq('customer_id', c.id);
    await sb.from('check_ins').delete().eq('customer_id', c.id);
    await sb.from('customers').delete().eq('id', c.id);
  }
}

async function cleanup() {
  await cleanupOne(PKG_PHONE);
  await cleanupOne(NOPKG_PHONE);
}

async function seedCustomer(name, phone) {
  const { data: customer, error: custErr } = await sb
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: 'returning', is_simulation: true })
    .select('id')
    .single();
  if (custErr) throw new Error(`고객 생성 실패(${name}): ${custErr.message}`);

  const { data: checkIn, error: ciErr } = await sb
    .from('check_ins')
    .insert({
      clinic_id: CLINIC_ID,
      customer_id: customer.id,
      customer_name: name,
      customer_phone: phone,
      visit_type: 'returning',
      status: 'treatment_waiting',
      queue_number: 9990 + Math.floor(Math.random() * 9),
    })
    .select('id')
    .single();
  if (ciErr) throw new Error(`체크인 생성 실패(${name}): ${ciErr.message}`);
  return { customerId: customer.id, checkInId: checkIn.id };
}

async function main() {
  if (rollback) {
    await cleanup();
    console.log('✅ 패키지 배지 QA 시드 정리 완료');
    return;
  }

  await cleanup(); // 재실행 중복 방지

  // (A) 패키지 보유 고객 — 잔여>0 활성 패키지
  const a = await seedCustomer(PKG_NAME, PKG_PHONE);
  const { error: pkgErr } = await sb.from('packages').insert({
    clinic_id: CLINIC_ID,
    customer_id: a.customerId,
    package_name: '풋케어 10회권(QA)',
    package_type: 'custom',
    total_sessions: 10,
    heated_sessions: 10,
    total_amount: 0,
    paid_amount: 0,
    status: 'active',
  });
  if (pkgErr) throw new Error(`패키지 생성 실패: ${pkgErr.message}`);

  // (B) 패키지 미보유 고객 — 비교용
  await seedCustomer(NOPKG_NAME, NOPKG_PHONE);

  console.log('✅ 패키지 배지 QA 시드 완료');
  console.log(`   보유: ${PKG_NAME} (${PKG_PHONE}) — 카드에 보라색 📦 배지 표시되어야 함`);
  console.log(`   미보유: ${NOPKG_NAME} (${NOPKG_PHONE}) — 배지 미표시`);
  console.log('   대시보드(치료대기) 칸반에서 두 카드 비교 확인');
  console.log('   정리: node --env-file=.env scripts/seed_pkg_box_indicator_qa.mjs --rollback');
}

main().catch((e) => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
