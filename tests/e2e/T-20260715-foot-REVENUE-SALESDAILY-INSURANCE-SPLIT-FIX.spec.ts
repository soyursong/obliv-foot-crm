/**
 * T-20260715-foot-REVENUE-SALESDAILY-INSURANCE-SPLIT-FIX (Stage A) — E2E spec
 *
 * DA CONSULT-REPLY / revenue_insurance_split_spec §0·§2-2·§2-3:
 *   SalesDailyTab 좌측 급여 3값(급여총액·본부금·공단청구액)의 권위 grain = 명세(service_charges).
 *   공단부담(insurance_covered_amount)은 payments에 영원히 없음 → service_charges에서만 산출.
 *
 * 검증:
 *   1) 급여 명세(service_charges, is_insurance_covered=TRUE) seed → 발생기준 3값 실값 렌더
 *      - 급여총액   = SUM(base_amount)              (testid sales-daily-ins-base)
 *      - 본부금     = SUM(copayment_amount)         (testid sales-daily-ins-copay)
 *      - 공단청구액 = SUM(insurance_covered_amount)  (testid sales-daily-ins-claim)  ← 하드코딩 0 제거 회귀
 *   2) 불변식: base_amount = copayment_amount + insurance_covered_amount + exempt_amount
 *   3) 공단청구액 > 0 (payments.tax_type='급여'만으로는 절대 못 만드는 값)
 *
 * 격리: clinic 개원(2026-05) 이전 고정 과거일(2025-01-02)에 seed → 실 prod 명세와 충돌 0.
 *   READ-ONLY 화면 검증. seed/cleanup은 서비스롤로 테스트 데이터만 조작(고유 phone 스코프).
 *
 * 실행: SUPABASE_SERVICE_ROLE_KEY=... npx playwright test T-20260715-foot-REVENUE-SALESDAILY-INSURANCE-SPLIT-FIX.spec.ts
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.BASE_URL ?? 'http://localhost:8089';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })();

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 인증 storageState는 desktop-chrome 프로젝트(dependencies: ['setup'])가 주입.
//   실행: npx playwright test <file> --project=desktop-chrome

// 개원 이전 고정 과거일 → 실 prod 명세와 충돌 0 (완전 격리).
const SEED_DATE = '2025-01-02';
const SEED_TS = `${SEED_DATE}T05:00:00.000Z`; // = 14:00 KST, 경계 안전
const TEST_PHONE = '+821000006715'; // 010-0000 중간블록 = KR MSIT 비할당 구조적 합성값(비PHI). phi-allowlist permit 등재.
const TEST_NAME = '[REVENUE-SPLIT] 급여';

// seed 급여 명세 2건 — 불변식 base = copay + insurance + exempt 준수.
const SEED_CHARGES = [
  { base_amount: 30000, copayment_amount: 9000, insurance_covered_amount: 20000, exempt_amount: 1000 },
  { base_amount: 10000, copayment_amount: 3000, insurance_covered_amount: 7000, exempt_amount: 0 },
];
const EXPECT_BASE = SEED_CHARGES.reduce((s, c) => s + c.base_amount, 0);        // 40000
const EXPECT_COPAY = SEED_CHARGES.reduce((s, c) => s + c.copayment_amount, 0);  // 12000
const EXPECT_CLAIM = SEED_CHARGES.reduce((s, c) => s + c.insurance_covered_amount, 0); // 27000
const EXPECT_EXEMPT = SEED_CHARGES.reduce((s, c) => s + c.exempt_amount, 0);    // 1000

let clinicId: string | null = null;
let serviceId: string | null = null;
let customerId: string | null = null;
let checkInId: string | null = null;
let seedOk = false;

function parseWon(s: string): number {
  return Number((s || '').replace(/[^0-9-]/g, ''));
}

async function cleanup() {
  const { data: custs } = await supabase.from('customers').select('id').eq('phone', TEST_PHONE);
  const ids = (custs ?? []).map((c) => c.id);
  if (!ids.length) return;
  await supabase.from('service_charges').delete().in('customer_id', ids);
  const { data: cis } = await supabase.from('check_ins').select('id').in('customer_id', ids);
  const ciIds = (cis ?? []).map((c) => c.id);
  if (ciIds.length) {
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

  const { data: svc } = await supabase
    .from('services').select('id').eq('clinic_id', clinic.id).eq('active', true).limit(1).single();
  if (!svc) { console.warn('⚠️ 활성 서비스 없음 — 스킵'); return; }
  serviceId = svc.id;

  await cleanup();

  // 실고객(is_simulation null) — 매출 방어필터에 걸리지 않음.
  const { data: cust, error: custErr } = await supabase
    .from('customers')
    .insert({ clinic_id: clinicId, name: TEST_NAME, phone: TEST_PHONE, visit_type: 'returning' })
    .select().single();
  if (custErr || !cust) { console.warn('⚠️ 고객 seed 실패 — 스킵', custErr?.message); return; }
  customerId = cust.id;

  const { data: ci, error: ciErr } = await supabase
    .from('check_ins')
    .insert({
      clinic_id: clinicId, customer_id: customerId, customer_name: TEST_NAME, customer_phone: TEST_PHONE,
      visit_type: 'returning', status: 'done', queue_number: 9971,
    })
    .select().single();
  if (ciErr || !ci) { console.warn('⚠️ check_in seed 실패 — 스킵', ciErr?.message); return; }
  checkInId = ci.id;

  const { error: scErr } = await supabase.from('service_charges').insert(
    SEED_CHARGES.map((c) => ({
      clinic_id: clinicId,
      check_in_id: checkInId,
      customer_id: customerId,
      service_id: serviceId,
      is_insurance_covered: true,
      base_amount: c.base_amount,
      copayment_amount: c.copayment_amount,
      insurance_covered_amount: c.insurance_covered_amount,
      exempt_amount: c.exempt_amount,
      customer_grade_at_charge: 'general',
      copayment_rate_at_charge: 0.3,
      calculated_at: SEED_TS,
    })),
  );
  if (scErr) { console.warn('⚠️ service_charges seed 실패 — 스킵', scErr.message); return; }
  seedOk = true;
});

test.afterAll(async () => { await cleanup(); });

async function gotoDailyForSeedDate(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/admin/sales`, { waitUntil: 'networkidle', timeout: 20_000 });
  await page.getByRole('tab', { name: /일일결산/ }).click();
  await page.getByTestId('sales-preset-custom').click();
  await page.getByTestId('sales-date-from').fill(SEED_DATE);
  await page.getByTestId('sales-date-to').fill(SEED_DATE);
  await page.waitForTimeout(1200); // debounce + query
  await expect(page.getByTestId('sales-daily-tab')).toBeVisible();
}

test('발생기준 급여 3값 = service_charges 명세 합계 실값 렌더 (공단청구액 하드코딩 0 회귀)', async ({ page }) => {
  test.skip(!seedOk, '시드 실패(clinic/서비스 없음)');

  await gotoDailyForSeedDate(page);

  const base = parseWon(await page.getByTestId('sales-daily-ins-base').innerText());
  const copay = parseWon(await page.getByTestId('sales-daily-ins-copay').innerText());
  const claim = parseWon(await page.getByTestId('sales-daily-ins-claim').innerText());

  // 발생기준 3값 실값 (명세 grain)
  expect(base).toBe(EXPECT_BASE);
  expect(copay).toBe(EXPECT_COPAY);
  expect(claim).toBe(EXPECT_CLAIM);

  // ★ 공단청구액 > 0 — payments.tax_type='급여'만으론 절대 못 만드는 값(하드코딩 0 제거 확증)
  expect(claim).toBeGreaterThan(0);

  // 불변식: 급여총액 = 본부금 + 공단청구액 + 면제분
  expect(base).toBe(copay + claim + EXPECT_EXEMPT);

  await page.getByTestId('sales-daily-left-matrix').screenshot({
    path: 'evidence/T-20260715-REVENUE-SALESDAILY-INSURANCE-SPLIT-left.png',
  });
  console.log(`[RENDER] 급여총액=${base} 본부금=${copay} 공단청구액=${claim} (불변식 base=copay+claim+exempt(${EXPECT_EXEMPT}) OK)`);
});

test('급여(발생기준)는 수납 대사(cash) 대상 아님 — 급여만 있는 날 대사 불일치 경고 미표시', async ({ page }) => {
  test.skip(!seedOk, '시드 실패(clinic/서비스 없음)');

  await gotoDailyForSeedDate(page);

  // 급여 명세만 있고 수납(payments) 0 → cashTotal=0, rightCashTotal=0 → mismatch 없음.
  //   (급여를 대사에 넣던 구버전이면 좌측 급여합계≠우측0 으로 오검출됐을 상황)
  await expect(page.getByTestId('sales-daily-mismatch-warning')).toHaveCount(0);
});
