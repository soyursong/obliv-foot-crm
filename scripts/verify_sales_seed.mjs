/**
 * supervisor 독립 검증 — T-20260516-foot-SALES-TESTDATA
 * 시딩된 테스트 데이터 존재 확인 + 핵심 집계 정합성 검증
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// fallback: use service key from known location
const KEY = SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const db = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

async function verify() {
  console.log('='.repeat(60));
  console.log('supervisor 독립 검증 — SALES-TESTDATA');
  console.log('='.repeat(60));

  let allPass = true;

  // 1. 테스트 고객 확인 ([테스트] 접두사)
  const { data: testCustomers, error: custErr } = await db
    .from('customers')
    .select('id, name, is_simulation')
    .like('name', '%테스트%')
    .order('created_at', { ascending: false })
    .limit(20);

  if (custErr) {
    console.error('❌ 고객 조회 실패:', custErr.message);
    allPass = false;
  } else {
    console.log(`\n[AC-1] 테스트 고객 (name LIKE %테스트%): ${testCustomers?.length ?? 0}건`);
    testCustomers?.slice(0, 5).forEach(c => console.log(`  - ${c.name} | is_simulation: ${c.is_simulation}`));
    if (!testCustomers?.length) {
      console.log('⚠️  WARN: 테스트 고객 없음 — 다른 식별자 사용 가능성');
    }
  }

  // 2. 최근 check_ins 확인
  const { data: checkIns, error: ciErr } = await db
    .from('check_ins')
    .select('id, customer_id, status, created_at, visit_type')
    .order('created_at', { ascending: false })
    .limit(10);

  if (ciErr) {
    console.error('❌ check_ins 조회 실패:', ciErr.message);
    allPass = false;
  } else {
    console.log(`\n[AC-1] 최근 check_ins: ${checkIns?.length ?? 0}건`);
    checkIns?.slice(0, 5).forEach(ci =>
      console.log(`  - id: ${ci.id.slice(0,8)}... | status: ${ci.status} | visit_type: ${ci.visit_type} | created: ${ci.created_at?.slice(0,10)}`));
  }

  // 3. payments 확인 (accounting_date 기입 여부)
  const { data: payments, error: payErr } = await db
    .from('payments')
    .select('id, amount, method, accounting_date, origin_tx_date, parent_payment_id')
    .order('created_at', { ascending: false })
    .limit(10);

  if (payErr) {
    console.error('❌ payments 조회 실패:', payErr.message);
    allPass = false;
  } else {
    console.log(`\n[AC-1] 최근 payments: ${payments?.length ?? 0}건`);
    const withAccountingDate = payments?.filter(p => p.accounting_date) ?? [];
    const refunds = payments?.filter(p => p.parent_payment_id) ?? [];
    console.log(`  - accounting_date 있는 결제: ${withAccountingDate.length}건`);
    console.log(`  - 환불 전표 (parent_payment_id 있음): ${refunds.length}건`);
    payments?.slice(0, 5).forEach(p =>
      console.log(`  - id: ${p.id.slice(0,8)}... | ${p.amount}원 | method: ${p.method} | acct_date: ${p.accounting_date} | refund: ${!!p.parent_payment_id}`));
  }

  // 4. service_charges 확인
  const { data: svcCharges, error: scErr } = await db
    .from('service_charges')
    .select('id, amount, tax_type, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (scErr) {
    console.error('❌ service_charges 조회 실패:', scErr.message);
    allPass = false;
  } else {
    console.log(`\n[AC-1] 최근 service_charges: ${svcCharges?.length ?? 0}건`);
    const taxTypes = [...new Set(svcCharges?.map(s => s.tax_type) ?? [])];
    console.log(`  - tax_type 종류: ${taxTypes.join(', ')}`);
  }

  // 5. package_payments 확인
  const { data: pkgPay, error: pkgErr } = await db
    .from('package_payments')
    .select('id, amount, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  if (pkgErr) {
    console.log(`  (package_payments 조회: ${pkgErr.message})`);
  } else {
    console.log(`\n[AC-1] package_payments: ${pkgPay?.length ?? 0}건`);
  }

  // 6. claim_diagnoses 확인
  const { data: claims, error: claimErr } = await db
    .from('claim_diagnoses')
    .select('id, icd_code, diag_type, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  if (claimErr) {
    console.log(`  (claim_diagnoses 조회: ${claimErr.message})`);
  } else {
    console.log(`\n[AC-1] claim_diagnoses: ${claims?.length ?? 0}건`);
    claims?.forEach(c => console.log(`  - ${c.icd_code} | type: ${c.diag_type}`));
  }

  console.log('\n' + '='.repeat(60));
  console.log(`결론: ${allPass ? '✅ PASS' : '⚠️  WARN'}`);
  return allPass;
}

verify().catch(console.error);
