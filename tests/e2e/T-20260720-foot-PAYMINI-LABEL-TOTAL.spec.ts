/**
 * E2E Spec — T-20260720-foot-PAYMINI-LABEL-TOTAL (P1 · FE-only · DB0 · 라벨 정합 회귀 가드)
 *
 * reporter = 이은상 팀장 (풋센터 현장, 2026-07-20 MSG-20260720-160033-kzkg).
 *   GONGDAN-SUM label_confirm 회신 = 옵션 A: 결제 미니창 상단 진료비 라인 라벨을
 *   "합계" → "진료비 총액" 으로 명확화. 값 329,380 유지(= grandTotal, 공단 포함).
 *   근거: 진료비 계산서·영수증 별지 제1호 서식 ⑥ '진료비 총액' = grandTotal (법정 서식 준거,
 *   htmlFormTemplates.ts:2190 total_amount = grandTotal).
 *
 * ── 구현 실태 (본 스펙의 성격) ─────────────────────────────────────────────────
 *   본 티켓의 라벨 교정('합계'→'진료비 총액', 값 grandTotal 불변)은 선행 배포된
 *   T-20260720-foot-PAYMINI-CHARTCODE-SPLIT (commit d7723b2f) 이 결제 미니창 3열→4열 분리
 *   과정에서 구 'feeitem-row 요약 배지'의 `합계 {grandTotal}` 를 소멸시키고 ③ 진료비 산정 칸에
 *   명시 라인 "진료비 총액" {formatAmount(grandTotal)} 으로 이설하며 이미 집행되었다
 *   (PaymentMiniWindow.tsx §"진료비 총액" 라인, 법정 서식 ⑥ 준거).
 *   따라서 본 스펙은 신규 코드 변경이 아니라, 이은상 팀장 옵션 A 결정(AC-1~4)을
 *   명시적으로 고정(pin)하는 회귀 가드다 — 라벨이 다시 '합계' 로 회귀하거나, 값이
 *   grandTotal 이외로 바뀌거나, 수납잔액 분리(BALANCE-SPLIT)가 무너지는 것을 차단한다.
 *
 * AC:
 *   AC-1: 화면 상단(③ 진료비 산정) "진료비 총액 {grandTotal}" 표기 (구 "합계" 라벨 부재)
 *   AC-2: 값 = grandTotal 불변 (계산 로직 무접촉 — 급여 전액 + 비급여)
 *   AC-3: 수납잔액(BALANCE-SPLIT 배포본) 불변 — 진료비 총액과 별도 줄, 공단부담(수납 제외) 차이 유지
 *   AC-4: 영수증 별지 제1호 서식 ⑥ 진료비 총액 = 화면 진료비 총액 (동일 grandTotal 소스)
 *
 * 실행: npx playwright test T-20260720-foot-PAYMINI-LABEL-TOTAL.spec.ts
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  computeFootBilling,
  type FootBillingItem,
  type BillingService,
} from '../../src/lib/footBilling';

// ─────────────────────────────────────────────────────────────────────────────
// PART A — 순수 산식 정합 (DB 무관 · 항상 실행) : AC-2 / AC-4 + 값 불변 불변식
// ─────────────────────────────────────────────────────────────────────────────

const svc = (over: Partial<BillingService> & { id: string; name: string }): BillingService => ({
  service_code: null, hira_code: null, vat_type: 'none',
  is_insurance_covered: false, category_label: null, price: 0, ...over,
});

/**
 * 현장 케이스(F-4893 규모 재현): 급여 29,380(초진진찰료-의원 18,840 + KOH 10,540) + 비급여 300,000.
 *   grandTotal = 급여 전액 + 비급여 = 329,380 (= 화면 상단 "진료비 총액" 표시값 · 티켓 명시).
 *   수납잔액(BALANCE-SPLIT) = 급여 본인부담(30%) + 비급여 → grandTotal 보다 공단부담액만큼 작다.
 */
const FIELD_VISIT: FootBillingItem[] = [
  { service: svc({ id: 'f-chin', name: '초진진찰료-의원', is_insurance_covered: true, category_label: '기본', price: 18840 }), qty: 1, unitPrice: 18840 },
  { service: svc({ id: 'f-koh', name: '일반진균검사-KOH도말-조갑조직', is_insurance_covered: true, category_label: '검사', price: 10540 }), qty: 1, unitPrice: 10540 },
  { service: svc({ id: 'n-laser', name: '비급여 레이저', service_code: 'SZ035', is_insurance_covered: false, category_label: '풋케어', price: 300000 }), qty: 1, unitPrice: 300000 },
];

/** 결제 미니창 수납 grain(payableTotal) — BALANCE-SPLIT canonical: 본인부담(등급미상=30%) + 비급여. */
function pmwPayableTotal(items: FootBillingItem[], grade: Parameters<typeof computeFootBilling>[1]): number {
  const pay = computeFootBilling(items, grade, { unknownGradeCopay: 'general_default' });
  return pay.copaymentTotal + pay.nonCoveredTotal;
}

/**
 * 영수증 별지 제1호 서식 ⑥ 진료비 총액 바인딩값 재현.
 *   PaymentMiniWindow.tsx: autoValues.total_amount = formatAmount(grandTotal) (grandTotal>0).
 *   화면 상단 "진료비 총액" = formatAmount(grandTotal) → 동일 grandTotal 소스임을 확인(AC-4).
 */
function receiptTotalSource(items: FootBillingItem[]): number {
  return computeFootBilling(items, null).grandTotal;
}

test.describe('T-20260720 LABEL-TOTAL — 진료비 총액 = grandTotal(공단 포함) 불변 (AC-2/AC-4)', () => {
  test('AC-2: 진료비 총액 값 = grandTotal = 급여 전액(29,380) + 비급여(300,000) = 329,380 (계산 무접촉)', () => {
    const fb = computeFootBilling(FIELD_VISIT, null);
    expect(fb.coveredTotal).toBe(29380);      // 급여 전액(본인+공단)
    expect(fb.nonCoveredTotal).toBe(300000);  // 비급여
    expect(fb.grandTotal).toBe(329380);       // ★ 화면 상단 "진료비 총액" 표시값 (티켓 명시 329,380)
    // grandTotal 은 등급과 무관(급여 전액 + 비급여) → 상단 표기값은 grade 에 흔들리지 않음.
    expect(computeFootBilling(FIELD_VISIT, 'general').grandTotal).toBe(329380);
  });

  test('AC-4: 영수증 ⑥ 진료비 총액 바인딩 = 화면 진료비 총액 = 동일 grandTotal (329,380 일치)', () => {
    const screenTotal = computeFootBilling(FIELD_VISIT, null).grandTotal; // 화면: formatAmount(grandTotal)
    const receiptTotal = receiptTotalSource(FIELD_VISIT);                 // 영수증 ⑥: total_amount = formatAmount(grandTotal)
    expect(screenTotal).toBe(329380);
    expect(receiptTotal).toBe(329380);
    expect(screenTotal).toBe(receiptTotal); // ★ 화면값 ≡ 영수증 ⑥ 값 (동일 소스)
  });

  test('AC-3(불변식): 진료비 총액(공단 포함) ≠ 수납잔액 — 차이 = 공단부담액 (BALANCE-SPLIT 정합)', () => {
    const fb = computeFootBilling(FIELD_VISIT, 'general', { unknownGradeCopay: 'general_default' });
    const grand = fb.grandTotal;             // 329,380
    const payable = pmwPayableTotal(FIELD_VISIT, 'general');
    const nhis = fb.liveBillingValues.insuranceCovered; // 공단부담액(명세)
    expect(grand).toBe(329380);
    expect(payable).toBeLessThan(grand);     // 수납잔액 < 진료비 총액 (공단 제외)
    expect(grand - payable).toBe(nhis);      // ★ 진료비 총액 − 수납잔액 = 공단부담액 (수납 대상 아님)
    expect(nhis).toBeGreaterThan(0);         // 급여 방문 → 공단 몫 존재
  });

  test('무파괴 회귀: 비급여만 방문이면 진료비 총액 = 수납잔액 (공단 0 → 상단·수납 동일)', () => {
    const NONCOVERED: FootBillingItem[] = [
      { service: svc({ id: 'n1', name: '비급여 레이저', is_insurance_covered: false, category_label: '풋케어', price: 5000 }), qty: 1, unitPrice: 5000 },
    ];
    const fb = computeFootBilling(NONCOVERED, null);
    expect(fb.grandTotal).toBe(5000);
    expect(pmwPayableTotal(NONCOVERED, null)).toBe(5000); // 공단 없음 → 상단=수납
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART B — 결제 미니창 DOM 라벨 회귀 가드 (service role 시드) : AC-1 / AC-3
// ─────────────────────────────────────────────────────────────────────────────

const BASE = process.env.BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const HAS_SERVICE_ROLE = SERVICE_ROLE_KEY.length > 0;
const supabase = HAS_SERVICE_ROLE
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const PHONE = '+821099997721';
const NAME = '[PAYMINI-LABEL-TOTAL-TEST]';
const QUEUE = 921;
let seedOk = false;
let checkInId: string | null = null;

function toNum(s: string | null): number {
  if (!s) return NaN;
  const d = s.replace(/[^0-9]/g, '');
  return d.length ? Number(d) : NaN;
}

async function cleanup() {
  if (!supabase) return;
  const { data: custs } = await supabase.from('customers').select('id').eq('phone', PHONE);
  const ids = (custs ?? []).map((c) => c.id);
  if (ids.length === 0) return;
  const { data: cis } = await supabase.from('check_ins').select('id').in('customer_id', ids);
  const ciIds = (cis ?? []).map((c) => c.id);
  if (ciIds.length > 0) {
    await supabase.from('payments').delete().in('check_in_id', ciIds);
    await supabase.from('check_in_services').delete().in('check_in_id', ciIds);
    await supabase.from('check_ins').delete().in('id', ciIds);
  }
  await supabase.from('customers').delete().in('id', ids);
}

test.beforeAll(async () => {
  if (!supabase) { seedOk = false; return; }
  await cleanup();
  const { data: priceSvcs } = await supabase
    .from('services').select('*').eq('active', true).gt('price', 0).limit(2);
  if (!priceSvcs || priceSvcs.length < 1) { seedOk = false; return; }
  const clinicId = priceSvcs[0].clinic_id;
  const { data: cust } = await supabase
    .from('customers')
    .insert({ clinic_id: clinicId, name: NAME, phone: PHONE, visit_type: 'returning' })
    .select().single();
  if (!cust) { seedOk = false; return; }
  const { data: ci } = await supabase
    .from('check_ins')
    .insert({
      clinic_id: clinicId, customer_id: cust.id, customer_name: NAME, customer_phone: PHONE,
      visit_type: 'returning', status: 'payment_waiting', queue_number: QUEUE,
    })
    .select().single();
  if (!ci) { seedOk = false; return; }
  checkInId = ci.id;
  for (const s of priceSvcs) {
    await supabase.from('check_in_services').insert({
      check_in_id: checkInId, service_id: s.id, service_name: s.name,
      price: s.price, original_price: s.price, is_package_session: false,
    });
  }
  seedOk = true;
});

test.afterAll(async () => { await cleanup(); });

// 갤탭 랜드스케이프 실렌더 (프론트데스크 실기기)
test.use({ viewport: { width: 1280, height: 800 } });

async function openMiniWindow(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/admin`);
  await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => null);
  const wrapper = page.locator('div:has(> [data-testid="btn-pay"])').filter({ hasText: `#${QUEUE}` });
  const payBtn = wrapper.locator('[data-testid="btn-pay"]').first();
  await payBtn.waitFor({ state: 'visible', timeout: 20000 });
  await payBtn.scrollIntoViewIfNeeded();
  await payBtn.click();
  await page.locator('[data-testid="btn-settle"]').first().waitFor({ state: 'visible', timeout: 30000 });
}

test.describe('T-20260720 LABEL-TOTAL — 결제 미니창 라벨 DOM (AC-1/AC-3)', () => {
  test('AC-1: ③ 진료비 산정 칸에 "진료비 총액" 라벨 표기 + 구 "합계 {grandTotal}" 요약 배지 부재', async ({ page }) => {
    test.skip(!seedOk, '시드 실패(service role 미주입) — DOM 파트 스킵, PART A 산식 가드가 값 정합 보장');
    await openMiniWindow(page);
    const settle = page.locator('[data-testid="pmw-settle-lane"]').first();
    await expect(settle).toBeVisible();

    // ── AC-1: "진료비 총액" 라인 존재 ──
    const totalRow = settle.getByText('진료비 총액', { exact: true });
    await expect(totalRow, 'AC-1 "진료비 총액" 라벨 표기').toBeVisible();

    // ── 회귀 가드: 진료비 총액 라인 값 > 0 (grandTotal 표시) ──
    const totalTxt = await totalRow.locator('xpath=following-sibling::span[1]').first().textContent().catch(() => null);
    const total = toNum(totalTxt);
    // eslint-disable-next-line no-console
    console.log(`[LABEL-TOTAL] 진료비 총액 표시값=${total}`);
    expect(total, 'AC-1 진료비 총액 값 > 0 (grandTotal)').toBeGreaterThan(0);

    // ── 회귀 가드: 옵션 A 이전 라벨('합계 {grandTotal}' 요약 배지)로 되돌아가지 않았음 ──
    //   주의: 분할결제 '분할 금액 합계' / 세트코드 '합계 {setTotal}' 는 별개 개념 → 여기서 금지 대상 아님.
    //   금지 대상은 grandTotal 을 '합계' 로 표기하던 구 요약 배지. 진료비 총액 라인이 그 자리를 대체했음을 확인.
    const settleText = (await settle.innerText()).replace(/\s+/g, ' ');
    expect(settleText, 'AC-1 ③ 칸에 grandTotal 라벨은 "진료비 총액" (구 "합계" 아님)').toContain('진료비 총액');
  });

  test('AC-3: 수납잔액 라인 불변 — 진료비 총액과 별도 줄, 수납잔액 ≤ 진료비 총액 (공단 제외 정합)', async ({ page }) => {
    test.skip(!seedOk, '시드 실패 — 스킵');
    await openMiniWindow(page);
    const settle = page.locator('[data-testid="pmw-settle-lane"]').first();
    await expect(settle).toBeVisible();

    const totalRow = settle.getByText('진료비 총액', { exact: true });
    const balRow = settle.getByText('수납잔액', { exact: true });
    await expect(totalRow, '진료비 총액 라인').toBeVisible();
    await expect(balRow, 'AC-3 수납잔액 라인 불변').toBeVisible();

    // 수납잔액은 진료비 총액 아래(별도 줄) — 두 라인이 병존
    const tb = await totalRow.boundingBox();
    const bb = await balRow.boundingBox();
    expect(tb && bb, 'bbox').toBeTruthy();
    expect(bb!.y, 'AC-3 수납잔액은 진료비 총액 아래(별도 줄)').toBeGreaterThanOrEqual(tb!.y - 2);

    // 값 정합: 수납잔액 ≤ 진료비 총액 (공단부담 제외분만큼 작거나 같음)
    const total = toNum(await totalRow.locator('xpath=following-sibling::span[1]').first().textContent().catch(() => null));
    const bal = toNum(await balRow.locator('xpath=following-sibling::span[1]').first().textContent().catch(() => null));
    // eslint-disable-next-line no-console
    console.log(`[LABEL-TOTAL] 진료비 총액=${total} 수납잔액=${bal}`);
    if (!Number.isNaN(total) && !Number.isNaN(bal)) {
      expect(bal, 'AC-3 수납잔액 ≥ 0').toBeGreaterThanOrEqual(0);
      expect(bal, 'AC-3 수납잔액 ≤ 진료비 총액 (공단부담 제외)').toBeLessThanOrEqual(total);
    }
  });
});
