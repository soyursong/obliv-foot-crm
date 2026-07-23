/**
 * T-20260723-foot-SALESDAILY-INSCOL-READSIDE-RESOURCE (Stage B / C4 read-side) — E2E spec
 *
 * 우측 매트릭스 '급여' 열 소스 re-source = payments.service_charge_id FK →
 *   service_charges.is_insurance_covered=TRUE 조인. (parent a1 write-path deployed 후 착지.)
 *
 * DA canon ruling: 급여 귀속은 오직 FK(is_insurance_covered)로만. tax_type='급여' 저장/신설 금지
 *   (tax_type=VAT축[과세/면세], is_insurance_covered=보험축 → conflation 금지).
 *   copay payment 는 write-path에서 tax_type=NULL(면세) + service_charge_id FK 로 적재됨.
 *
 * 검증(read-side):
 *   1) 급여 열 FK re-source — copay payment(tax_type=NULL, service_charge_id FK) 가 우측 '급여' 열에
 *      집계되고 '면세' 열엔 새지 않음. (tax_type만 봤다면 NULL→면세 로 오분류됐을 상황.)
 *   2) ⚠copay 이중계상 방지 (핵심 AC) — 좌측 FK skip: copay payment 가 좌측 비급여(면세) 버킷에
 *      새지 않아 총진료비(순매출)가 과대(=baseTotal + copay payment) 되지 않음.
 *      좌측 급여 3값(발생기준·명세)은 불변. 좌측 total = baseTotal + 비급여 뿐(copay payment 미포함).
 *   3) 좌우 대사(AC-2) grain 정합 — 급여 copay 는 양변 모두 제외 → 대사 불일치 경고 미표시.
 *
 * 격리: clinic 개원(2026-05) 이전 고정 과거일(2025-01-02)에 seed → 실 prod 데이터와 충돌 0.
 *   READ-ONLY 화면 검증. seed/cleanup은 서비스롤로 테스트 데이터만 조작(고유 phone 스코프).
 *
 * 실행: SUPABASE_SERVICE_ROLE_KEY=... npx playwright test T-20260723-foot-SALESDAILY-INSCOL-READSIDE-RESOURCE.spec.ts --project=desktop-chrome
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.BASE_URL ?? 'http://localhost:8089';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })();

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 개원 이전 고정 과거일 → 실 prod 데이터와 충돌 0 (완전 격리).
const SEED_DATE = '2025-01-02';
const SEED_TS = `${SEED_DATE}T05:00:00.000Z`; // = 14:00 KST, 경계 안전
const TEST_PHONE = '+821000007232'; // 010-0000 중간블록 = KR MSIT 비할당 구조적 합성값(비PHI). phi-allowlist permit 등재.
const TEST_NAME = '[INSCOL-READSIDE] 급여';

// 급여 명세 1건 (is_insurance_covered=TRUE). 불변식 base = copay + insurance + exempt.
const SC = { base_amount: 30000, copayment_amount: 9000, insurance_covered_amount: 20000, exempt_amount: 1000 };
// copay payment (본인부담 수납) — tax_type=NULL, service_charge_id FK. amount = copay.
const COPAY_PAY = 9000; // = SC.copayment_amount
// 비급여 과세 payment (FK 없음) — 대사·과세 열 대조군.
const NONINS_PAY = 50000;

const EXPECT_LEFT_TOTAL = SC.base_amount + NONINS_PAY; // 80000 (★copay payment 미포함 — 이중계상 방지)
const EXPECT_RIGHT_GYEOUB = COPAY_PAY;                 // 9000 (FK 기준, tax_type 아님)

let clinicId: string | null = null;
let serviceId: string | null = null;
let customerId: string | null = null;
let checkInId: string | null = null;
let scId: string | null = null;
let seedOk = false;

function parseWon(s: string): number {
  return Number((s || '').replace(/[^0-9-]/g, ''));
}

async function cleanup() {
  const { data: custs } = await supabase.from('customers').select('id').eq('phone', TEST_PHONE);
  const ids = (custs ?? []).map((c) => c.id);
  if (!ids.length) return;
  await supabase.from('payments').delete().in('customer_id', ids);
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
      visit_type: 'returning', status: 'done', queue_number: 9972,
    })
    .select().single();
  if (ciErr || !ci) { console.warn('⚠️ check_in seed 실패 — 스킵', ciErr?.message); return; }
  checkInId = ci.id;

  // 급여 명세 (is_insurance_covered=TRUE) — 발생기준 좌측 급여 3값 소스.
  const { data: sc, error: scErr } = await supabase.from('service_charges').insert({
    clinic_id: clinicId,
    check_in_id: checkInId,
    customer_id: customerId,
    service_id: serviceId,
    is_insurance_covered: true,
    base_amount: SC.base_amount,
    copayment_amount: SC.copayment_amount,
    insurance_covered_amount: SC.insurance_covered_amount,
    exempt_amount: SC.exempt_amount,
    customer_grade_at_charge: 'general',
    copayment_rate_at_charge: 0.3,
    calculated_at: SEED_TS,
  }).select('id').single();
  if (scErr || !sc) { console.warn('⚠️ service_charges seed 실패 — 스킵', scErr?.message); return; }
  scId = sc.id;

  // copay payment — tax_type=NULL(면세/VAT-exempt), service_charge_id FK link. 급여 귀속은 FK로만 판정.
  const { error: payErr } = await supabase.from('payments').insert([
    {
      clinic_id: clinicId, customer_id: customerId, check_in_id: checkInId,
      amount: COPAY_PAY, method: 'card', payment_type: 'payment',
      tax_type: null, service_charge_id: scId, accounting_date: SEED_DATE,
    },
    // 비급여 과세 (FK 없음) — 대조군.
    {
      clinic_id: clinicId, customer_id: customerId, check_in_id: checkInId,
      amount: NONINS_PAY, method: 'cash', payment_type: 'payment',
      tax_type: '과세_비급여', accounting_date: SEED_DATE,
    },
  ]);
  if (payErr) { console.warn('⚠️ payments seed 실패 — 스킵', payErr.message); return; }
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

test('① 급여 열 FK re-source — copay payment(tax_type=NULL, service_charge_id FK)가 우측 급여 열에 집계, 면세 열엔 미유입', async ({ page }) => {
  test.skip(!seedOk, '시드 실패(clinic/서비스 없음)');

  await gotoDailyForSeedDate(page);

  const gyeoub = parseWon(await page.getByTestId('sales-daily-right-coltotal-급여').innerText());
  const taxable = parseWon(await page.getByTestId('sales-daily-right-coltotal-과세').innerText());
  const taxfree = parseWon(await page.getByTestId('sales-daily-right-coltotal-면세').innerText());

  // ★ FK 기준: copay payment 가 급여 열에 (tax_type='급여' 없이도)
  expect(gyeoub).toBe(EXPECT_RIGHT_GYEOUB);
  // 과세 대조군
  expect(taxable).toBe(NONINS_PAY);
  // ★ 면세 열엔 새지 않음 — tax_type=NULL 만 봤다면 면세로 오분류됐을 상황(=9000). FK re-source로 0.
  expect(taxfree).toBe(0);

  console.log(`[C4 FK re-source] 급여열=${gyeoub}(copay FK) 과세열=${taxable} 면세열=${taxfree}(누수 없음)`);
});

test('② ⚠copay 이중계상 방지 — 좌측 FK skip: 순매출 총액이 copay payment로 과대 안 됨 (핵심 AC)', async ({ page }) => {
  test.skip(!seedOk, '시드 실패(clinic/서비스 없음)');

  await gotoDailyForSeedDate(page);

  // 좌측 급여 3값(발생기준·명세) 불변
  const base = parseWon(await page.getByTestId('sales-daily-ins-base').innerText());
  const copay = parseWon(await page.getByTestId('sales-daily-ins-copay').innerText());
  const claim = parseWon(await page.getByTestId('sales-daily-ins-claim').innerText());
  expect(base).toBe(SC.base_amount);
  expect(copay).toBe(SC.copayment_amount);
  expect(claim).toBe(SC.insurance_covered_amount);

  // ★ 총진료비 = baseTotal(발생기준 급여) + 비급여(과세). copay payment(수납 9000)는 미포함.
  //   좌측 FK skip 없었다면 tax_type=NULL copay payment 가 taxfree 로 유입 → 80000 + 9000 = 89000 (이중계상).
  const leftTotal = parseWon(await page.getByTestId('sales-daily-left-total').innerText());
  expect(leftTotal).toBe(EXPECT_LEFT_TOTAL);       // 80000
  expect(leftTotal).not.toBe(EXPECT_LEFT_TOTAL + COPAY_PAY); // ≠ 89000 (이중계상 금지 확증)

  await page.getByTestId('sales-daily-left-matrix').screenshot({
    path: 'evidence/T-20260723-SALESDAILY-INSCOL-READSIDE-left.png',
  });
  console.log(`[C4 copay 정합] 좌측 total=${leftTotal} (baseTotal ${base} + 과세 ${NONINS_PAY}; copay payment ${COPAY_PAY} 미포함=이중계상 방지)`);
});

test('③ 좌우 대사(AC-2) grain 정합 — 급여 copay 양변 제외 → 대사 불일치 경고 미표시', async ({ page }) => {
  test.skip(!seedOk, '시드 실패(clinic/서비스 없음)');

  await gotoDailyForSeedDate(page);

  // 좌측 cashTotal(비급여 과세 50000) vs 우측 급여 열 제외 소계(과세 50000) → 일치.
  await expect(page.getByTestId('sales-daily-mismatch-warning')).toHaveCount(0);
});
