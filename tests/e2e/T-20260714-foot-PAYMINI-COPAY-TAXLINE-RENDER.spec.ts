/**
 * T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT REOPEN#5 — 실브라우저 렌더 검증 (anti-fingerprint)
 *
 * 김주연 총괄(스크린샷+직접 요구): 결제미니창 '세금 구분' 내역의 '급여' 라인이 공단부담 포함
 *   전체 급여액(coveredTotal)을 표시 → 환자 자부담(30%)만 표시하도록.
 *   현재(잘못): "급여: 29,380" / 원하는: "급여 자부담(30%): 8,900".
 *
 * 본 스펙은 content-fingerprint 자기검증(5회 반증됨)을 대체하는 실제 DOM 렌더 검증이다.
 *   - 로컬 dev 서버(localhost:8089, 배포와 동일 소스)에서 급여환자 payment_waiting 시드 →
 *     대시보드 [결제하기] 실제 클릭 → PaymentMiniWindow 모달 오픈 →
 *     '세금 구분' 영역의 급여 라인 텍스트/금액을 브라우저 DOM 에서 직접 읽어 단언 + 스크린샷.
 *   - 배포 pages.dev 는 동일 번들 → supervisor 가 fresh session 으로 재QA.
 *
 * 실행: npx playwright test T-20260714-foot-PAYMINI-COPAY-TAXLINE-RENDER.spec.ts
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  computeFootBilling,
  type FootBillingItem,
  type BillingService,
} from '../../src/lib/footBilling';

const BASE = process.env.BASE_URL ?? 'http://localhost:8089';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })();

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TEST_PHONE = '+821099997145';
const TEST_NAME = '[PAYMINI-TAXLINE] 급여';
const QUEUE = 977;

let clinicId: string | null = null;
let coveredServices: Array<{ id: string; name: string; price: number; hira_code: string | null; vat_type: string | null }> = [];
let checkInId: string | null = null;
let customerId: string | null = null;
let seedOk = false;

function parseWon(s: string): number {
  return Number((s || '').replace(/[^0-9-]/g, ''));
}

async function cleanup() {
  const { data: custs } = await supabase.from('customers').select('id').eq('phone', TEST_PHONE);
  const ids = (custs ?? []).map((c) => c.id);
  if (!ids.length) return;
  const { data: cis } = await supabase.from('check_ins').select('id').in('customer_id', ids);
  const ciIds = (cis ?? []).map((c) => c.id);
  if (ciIds.length) {
    await supabase.from('payments').delete().in('check_in_id', ciIds);
    await supabase.from('check_in_services').delete().in('check_in_id', ciIds);
    await supabase.from('status_transitions').delete().in('check_in_id', ciIds);
    await supabase.from('check_ins').delete().in('id', ciIds);
  }
  await supabase.from('customers').delete().in('id', ids);
}

test.beforeAll(async () => {
  const { data: clinic } = await supabase.from('clinics').select('id').eq('slug', 'jongno-foot').single();
  if (!clinic) { console.warn('⚠️ clinic jongno-foot 없음 — 스킵'); return; }
  clinicId = clinic.id;

  // 급여(is_insurance_covered=true) 활성 서비스 2건 — 세금구분 '급여' 라인 렌더 대상.
  const { data: svcs } = await supabase
    .from('services')
    .select('id, name, price, hira_code, vat_type')
    .eq('clinic_id', clinic.id)
    .eq('active', true)
    .eq('is_insurance_covered', true)
    .not('category_label', 'in', '("상병","처방약")')
    .gt('price', 0)
    .order('display_order', { ascending: true })
    .limit(2);
  if (!svcs || svcs.length < 1) { console.warn('⚠️ 급여 활성 서비스 없음 — 스킵'); return; }
  coveredServices = svcs;
  seedOk = true;
});

test.beforeEach(async () => {
  if (!seedOk) return;
  await cleanup();
  const { data: cust } = await supabase
    .from('customers')
    .insert({ clinic_id: clinicId, name: TEST_NAME, phone: TEST_PHONE, visit_type: 'returning' })
    .select().single();
  customerId = cust!.id;
  const { data: ci } = await supabase
    .from('check_ins')
    .insert({
      clinic_id: clinicId, customer_id: customerId, customer_name: TEST_NAME, customer_phone: TEST_PHONE,
      visit_type: 'returning', status: 'payment_waiting', queue_number: QUEUE,
    })
    .select().single();
  checkInId = ci!.id;
  // saved=true 상태(check_in_services 영속) → PMW pricingItems 채워짐.
  await supabase.from('check_in_services').insert(
    coveredServices.map((s) => ({
      check_in_id: checkInId, service_id: s.id, service_name: s.name,
      price: s.price, original_price: s.price, is_package_session: false,
    })),
  );
});

test.afterAll(async () => { await cleanup(); });

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

test("세금구분 '급여' 라인 = '급여 자부담(30%)' + 자부담 금액(공단 제외) — 실 DOM 렌더", async ({ page }) => {
  test.skip(!seedOk, '시드 실패(clinic/급여서비스 없음)');

  // 배포 소스와 동일한 SSOT 로 기대값 산출(수납 grain, 등급 미상→30%).
  const items: FootBillingItem[] = coveredServices.map((s) => ({
    service: {
      id: s.id, name: s.name, service_code: null, hira_code: s.hira_code,
      vat_type: (s.vat_type as BillingService['vat_type']) ?? 'none',
      is_insurance_covered: true, category_label: null, price: s.price,
    },
    qty: 1, unitPrice: s.price,
  }));
  const pay = computeFootBilling(items, null, { unknownGradeCopay: 'general_default' });
  const expectedCopay = pay.copaymentTotal;
  const coveredTotal = pay.coveredTotal;
  const expectedNhis = pay.liveBillingValues.insuranceCovered;
  expect(coveredTotal).toBeGreaterThan(0);
  expect(expectedCopay).toBeLessThan(coveredTotal); // 자부담 < 전체 급여액 (공단 몫 존재)

  await openMiniWindow(page);

  // '세금 구분' 영역 컨테이너
  const taxBox = page.locator('div:has(> p:text-is("세금 구분"))').first();
  await expect(taxBox).toBeVisible();

  // ★ 급여 라인 = "급여 자부담(30%)" 라벨 (bare "급여" 아님)
  const copayRow = taxBox.locator('div.flex.justify-between', { hasText: '급여 자부담' }).first();
  await expect(copayRow).toBeVisible();
  await expect(copayRow).toContainText('급여 자부담(30%)');

  // ★ 급여 라인 금액 = 자부담(30%), 전체 급여액(coveredTotal) 아님
  const shownCopay = parseWon(await copayRow.locator('span').last().innerText());
  expect(shownCopay).toBe(expectedCopay);
  expect(shownCopay).not.toBe(coveredTotal);

  // 공단부담(70%)은 별도 '공단부담액(명세)' 라인으로 분리 표시
  const nhisRow = taxBox.locator('div.flex.justify-between', { hasText: '공단부담액(명세)' }).first();
  await expect(nhisRow).toBeVisible();
  expect(parseWon(await nhisRow.locator('span').last().innerText())).toBe(expectedNhis);

  // 불변식: 자부담 + 공단부담액 = 전체 급여액
  expect(shownCopay + expectedNhis).toBe(coveredTotal);

  // 스크린샷 evidence (모달 전체 + 세금구분 박스)
  await page.locator('[data-testid="btn-settle"]').first().scrollIntoViewIfNeeded().catch(() => null);
  await page.screenshot({ path: 'evidence/T-20260714-PAYMINI-COPAY-TAXLINE-render.png', fullPage: true });
  await taxBox.screenshot({ path: 'evidence/T-20260714-PAYMINI-COPAY-TAXLINE-taxbox.png' });

  console.log(`[RENDER] 세금구분 급여 라인 = "급여 자부담(30%)" ${shownCopay.toLocaleString()}원 / 공단부담액(명세) ${expectedNhis.toLocaleString()}원 / 전체 급여액 ${coveredTotal.toLocaleString()}원`);
});
