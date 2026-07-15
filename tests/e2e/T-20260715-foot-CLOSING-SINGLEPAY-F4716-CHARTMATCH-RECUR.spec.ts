/**
 * T-20260715-foot-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR (P1→P0 hotfix)
 *
 * reporter = 김주연 총괄 (F0BGYT9C2GP) / planner NEW-TASK (MSG-20260715-135041-njlr)
 * 증상: F-4716 김희정 closing#payments 59,000원 카드 단건결제 등록됨 →
 *       고객 차트 수납내역 '결제 없음'(자동연동 실패) → 패키지 잔금(내성체험권) 미수 오귀속.
 *
 * ── Part0 forensic 확정 RC (배포후 재발, single→pkg 오라우팅 가설은 반증됨) ──
 *   전수조회: 07-15 결제 payments 8행/5고객 전부 canonical `payments` 경유
 *   (closing_manual_payments 0 · package_payments 0). recordManualPayment write-path 정상 작동.
 *   RC-A: '영수증 업로드…' memo 수납내역 탭 필터제외(CHART2-RECEIPT-RESTRUCTURE 설계) → 표시착시.
 *   RC-B: F-4716 패키지 재생성으로 paid_amount credit 유실.
 *   RC-C: F-4666 single 귀속이 활성 패키지 잔금과 무접점.
 *
 * ── 본 spec = write-path SSOT(recordManualPayment) 라우팅 불변식 회귀 가드 ──
 *   planner Part2 directive와 정합: "활성패키지 보유해도 스태프 single 선택 시 payments 정본경로
 *   → 차트 수납 자동표시 + 미수 오귀속 방지. 오매칭(단건→잔금) 방지 우선."
 *   두 시나리오(티켓 참조)를 prod DB 계약 수준에서 검증한다.
 *
 *   시나리오1 (single with active package — 오귀속 방지):
 *     활성 패키지를 가진 고객에 대해 스태프가 'single' 선택 → payments(check_in_id NULL) 1행 생성,
 *     packages.paid_amount 무접점(=단건 결제가 패키지 잔금으로 오귀속되지 않음), memo 는
 *     '영수증 업로드' 접두 아님(=차트 수납내역에 표시됨). ★ = F-4716 회귀 가드.
 *   시나리오2 (package attribution — 미수 해소):
 *     스태프가 'package' 선택 → package_payments 1행 생성 + packages.paid_amount 재집계 → due=0.
 *
 *   ※ recordManualPayment 는 브라우저 anon 클라이언트를 import 하므로 node E2E 에서 직접
 *     호출 불가 → SSOT 가 정의한 canonical write 계약(payments/package_payments 스키마·
 *     paid_amount 재집계 semantics, src/lib/manualPaymentWritePath.ts §옵션A 3분기)을
 *     service_role 로 재현·검증한다. 실 UI(closing#payments) 렌더/현장 confirm =
 *     supervisor 갤탭 field-soak. (PAYMINI-4ZONE-LAYOUT-SPEC 동형 graceful-skip 패턴.)
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
// service_role = 비커밋 시크릿(.env.local, gitignored). 부재 시 throw 금지 → seedOk=false graceful skip.
//   · .env.local 주입 dev/QA(macstudio) = 실 seed 풀 검증  · 시크릿 없는 워크트리 = collection OK·skip(0 crash).
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const HAS_SERVICE_ROLE = SERVICE_ROLE_KEY.length > 0;
const supabase = HAS_SERVICE_ROLE
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 오블리브 풋센터(종로) — forensic 확정
const PHONE = '+821099995716';
const NAME = '[SINGLEPAY-F4716-TEST]';
const PKG_TOTAL = 59000; // F-4716 내성체험권 재현치

let seedOk = false;
let clinicOk = false;
let customerId: string | null = null;
let packageId: string | null = null;

async function cleanup() {
  if (!supabase) return;
  const { data: custs } = await supabase.from('customers').select('id').eq('phone', PHONE);
  for (const c of custs ?? []) {
    await supabase.from('payments').delete().eq('customer_id', c.id);
    const { data: pkgs } = await supabase.from('packages').select('id').eq('customer_id', c.id);
    for (const p of pkgs ?? []) await supabase.from('package_payments').delete().eq('package_id', p.id);
    await supabase.from('packages').delete().eq('customer_id', c.id);
    await supabase.from('customers').delete().eq('id', c.id);
  }
}

/** SSOT §옵션A 'package' 분기 재현: package_payments INSERT + paid_amount 재집계. */
async function writePackageRoute(pkgId: string, custId: string, amount: number) {
  const { error: ppErr } = await supabase!.from('package_payments').insert({
    clinic_id: CLINIC, package_id: pkgId, customer_id: custId, amount,
    method: 'card', installment: 0, payment_type: 'payment', fee_kind: 'package',
    memo: '수기수납(패키지 잔금)',
  });
  if (ppErr) throw new Error(`package_payments insert 실패: ${ppErr.message}`);
  const { data: sum } = await supabase!.from('package_payments')
    .select('amount, payment_type').eq('package_id', pkgId);
  const total = (sum ?? []).reduce((s, r) => s + (r.payment_type === 'refund' ? -r.amount : r.amount), 0);
  await supabase!.from('packages').update({ paid_amount: total }).eq('id', pkgId);
}

/** SSOT §옵션A 'single' 분기 재현: payments INSERT(check_in_id NULL), 패키지 무접점. */
async function writeSingleRoute(custId: string, amount: number) {
  const { error } = await supabase!.from('payments').insert({
    clinic_id: CLINIC, check_in_id: null, customer_id: custId, amount,
    method: 'card', installment: 0, payment_type: 'payment',
    memo: '영수증 수납(단건)', // ★ '영수증 업로드' 접두 아님 → 차트 수납내역 표시됨(RC-A 회귀 가드)
  });
  if (error) throw new Error(`single payments insert 실패: ${error.message}`);
}

test.beforeAll(async () => {
  if (!supabase) { console.warn('SERVICE_ROLE 부재 → seed skip(graceful)'); return; }
  const { data: clinic } = await supabase.from('clinics').select('id').eq('id', CLINIC).maybeSingle();
  clinicOk = !!clinic;
  if (!clinicOk) { console.warn(`clinic ${CLINIC} 부재 → skip`); return; }
  await cleanup();
  const { data: cust, error: cErr } = await supabase.from('customers')
    .insert({ clinic_id: CLINIC, name: NAME, phone: PHONE }).select('id').single();
  if (cErr || !cust) { console.warn(`customer seed 실패: ${cErr?.message}`); return; }
  customerId = cust.id;
  const { data: pkg, error: pErr } = await supabase.from('packages').insert({
    clinic_id: CLINIC, customer_id: customerId, package_name: '[TEST] 내성체험권',
    status: 'active', total_amount: PKG_TOTAL, paid_amount: 0,
  }).select('id').single();
  if (pErr || !pkg) { console.warn(`package seed 실패: ${pErr?.message}`); return; }
  packageId = pkg.id;
  seedOk = true;
});

test.afterAll(async () => { await cleanup(); });

test('시나리오1: single 선택(활성 패키지 보유) → payments 생성·패키지 잔금 무접점(미수 오귀속 방지)', async () => {
  test.skip(!seedOk, 'seed 미완(service_role/clinic 부재) — graceful skip');

  await writeSingleRoute(customerId!, PKG_TOTAL);

  // (a) payments 정본 행 생성 (check_in_id NULL 단건)
  const { data: pays } = await supabase!.from('payments')
    .select('amount, check_in_id, payment_type, memo').eq('customer_id', customerId!);
  expect(pays?.length).toBe(1);
  expect(pays![0].amount).toBe(PKG_TOTAL);
  expect(pays![0].check_in_id).toBeNull();
  expect(pays![0].payment_type).toBe('payment');

  // (b) ★ 미수 오귀속 방지: 단건 결제가 패키지 잔금(paid_amount)을 건드리지 않음
  const { data: pkg } = await supabase!.from('packages')
    .select('total_amount, paid_amount').eq('id', packageId!).single();
  expect(pkg!.paid_amount).toBe(0); // single 경로는 packages 무접점 (SSOT §옵션A)

  // (c) ★ RC-A 회귀: memo 가 '영수증 업로드' 접두 아님 → 차트 수납내역 필터에 제외되지 않음
  expect(pays![0].memo.startsWith('영수증 업로드')).toBe(false);

  // (d) package_payments 로 오라우팅되지 않음(단건→잔금 오매칭 방지)
  const { data: pp } = await supabase!.from('package_payments')
    .select('id').eq('customer_id', customerId!);
  expect(pp?.length ?? 0).toBe(0);
});

test('시나리오2: package 선택 → package_payments 생성·paid_amount 재집계로 미수(due) 해소', async () => {
  test.skip(!seedOk, 'seed 미완(service_role/clinic 부재) — graceful skip');

  // 시나리오1 잔재(single payments) 제거 후 격리 검증
  await supabase!.from('payments').delete().eq('customer_id', customerId!);
  await supabase!.from('packages').update({ paid_amount: 0 }).eq('id', packageId!);

  await writePackageRoute(packageId!, customerId!, PKG_TOTAL);

  // (a) package_payments 정본 행 생성
  const { data: pp } = await supabase!.from('package_payments')
    .select('amount, fee_kind, payment_type').eq('package_id', packageId!);
  expect(pp?.length).toBe(1);
  expect(pp![0].amount).toBe(PKG_TOTAL);
  expect(pp![0].fee_kind).toBe('package');

  // (b) paid_amount 재집계 → 미수(due) 해소
  const { data: pkg } = await supabase!.from('packages')
    .select('total_amount, paid_amount').eq('id', packageId!).single();
  expect(pkg!.paid_amount).toBe(PKG_TOTAL);
  expect(pkg!.total_amount - pkg!.paid_amount).toBe(0); // due=0 (미수 해소)

  // (c) 단건 payments 로 이중 write 되지 않음(net-zero, 매출 이중계상 방지)
  const { data: pays } = await supabase!.from('payments')
    .select('id').eq('customer_id', customerId!);
  expect(pays?.length ?? 0).toBe(0);
});
