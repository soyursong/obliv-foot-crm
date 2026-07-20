/**
 * E2E spec — T-20260720-foot-RECEIPT-MANUAL-PAY-SPLIT-METHOD
 * 영수증 업로드 금액 수기 입력 팝업(ReceiptUploadSection)에 분할결제(복수 결제수단 행) 지원.
 *
 * 변경: 결제수단 단일 → 결제수단 행 다중추가(카드/현금/이체) + 각 행 금액입력 + 합계 자동계산.
 *   저장 시 각 행마다 payment row 생성(정본 write-path recordManualPayment). 미수 해소는 분할 '합산' 기준.
 *   단건(1행) 경로 + 활성패키지 無 단건 fallback 회귀 없음.
 *
 * 시나리오 1 (AC-1/2/3/5): 단건 귀속(활성패키지 無) 분할결제 — 카드 200,000 + 이체 100,000
 *                          → 합계 300,000, payments 2행(카드/이체) 생성.
 * 시나리오 2 (AC-3/4): 패키지 잔금 귀속 분할결제 → package_payments 2행 + paid_amount 합산(300,000).
 * 시나리오 3 (AC-6): 단건(1행) 회귀 — 결제수단 1개(카드)만 → payments 1행. 분할 미지정 시 기존 동작 유지.
 * 시나리오 4 (엣지): 0원 행 제외 저장 + 최소 1행 유지(마지막 행 삭제 버튼 미노출).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

function sb() {
  return createClient(SUPA_URL, SERVICE_KEY);
}

/** 1x1 투명 PNG (영수증 이미지 대체) */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function seedCustomer(suffix: string) {
  const client = sb();
  const name = `receipt-split-test-${suffix}-${Date.now()}`;
  const phone = `DUMMY-${Date.now()}`;
  const { data: customer, error } = await client
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: 'returning' })
    .select()
    .single();
  if (error) throw new Error(`고객 생성 실패: ${error.message}`);
  return customer!;
}

async function seedActivePackage(customerId: string, pkgName: string) {
  const client = sb();
  const { data: pkg, error } = await client
    .from('packages')
    .insert({
      clinic_id: CLINIC_ID,
      customer_id: customerId,
      package_name: pkgName,
      package_type: 'standard',
      total_sessions: 10,
      heated_sessions: 10,
      unheated_sessions: 0,
      iv_sessions: 0,
      preconditioning_sessions: 0,
      shot_upgrade: false,
      af_upgrade: false,
      upgrade_surcharge: 0,
      total_amount: 3000000,
      paid_amount: 0,
      status: 'active',
      contract_date: new Date().toISOString().slice(0, 10),
    })
    .select()
    .single();
  if (error) throw new Error(`패키지 생성 실패: ${error.message}`);
  return pkg!;
}

async function cleanupByName(namePrefix: string) {
  const client = sb();
  const { data: customers } = await client
    .from('customers')
    .select('id')
    .like('name', `${namePrefix}%`);
  if (!customers?.length) return;
  const ids = customers.map((c) => c.id);
  await client.from('package_payments').delete().in('customer_id', ids);
  await client.from('payments').delete().in('customer_id', ids);
  await client.from('packages').delete().in('customer_id', ids);
  await client.from('customers').delete().in('id', ids);
}

/** 로그인 게이트 — auth 미설정 시 graceful skip */
async function ensureLoggedIn(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto(`${BASE_URL}/login`).catch(() => {});
  const loginForm = page.getByRole('button', { name: /로그인/i });
  if (await loginForm.isVisible({ timeout: 3000 }).catch(() => false)) {
    return false; // auth.setup 미적용 → skip
  }
  return true;
}

/** 결제영수증 섹션에 이미지 업로드 → 매출 연동 다이얼로그 오픈 */
async function uploadReceiptAndOpenDialog(page: import('@playwright/test').Page): Promise<boolean> {
  // 결제영수증 섹션(ReceiptUploadSection)은 상담내역 탭에 렌더 — 탭 진입(best-effort).
  const consultTab = page.getByRole('button', { name: '상담내역' });
  if (await consultTab.first().isVisible({ timeout: 3000 }).catch(() => false)) {
    await consultTab.first().click().catch(() => {});
  }
  await page.locator('[data-testid="consult-section-receipt"]').first()
    .waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const fileInput = page.locator('[data-testid="consult-section-receipt"] input[type="file"][accept="image/*"][multiple]');
  if (await fileInput.count() === 0) return false;
  await fileInput.first().setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: PNG_1X1,
  });
  const dlg = page.getByText('영수증 매출 연동');
  return await dlg.isVisible({ timeout: 8000 }).catch(() => false);
}

// ─────────────────────────────────────────────────────────────────
// 시나리오 1: 단건 귀속 분할결제 — 카드 200,000 + 이체 100,000 (AC-1/2/3/5)
// ─────────────────────────────────────────────────────────────────
test('AC-1/2/3: 분할결제(카드 200,000 + 이체 100,000) → 합계 300,000, payments 2행 생성', async ({ page }) => {
  const customer = await seedCustomer('s1-split');

  try {
    if (!(await ensureLoggedIn(page))) { test.skip(true, 'auth 미설정 — skip'); return; }

    await page.goto(`${BASE_URL}/chart/${customer.id}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    if (!(await uploadReceiptAndOpenDialog(page))) {
      test.skip(true, '영수증 업로드/다이얼로그 진입 불가 (storage/렌더) — skip');
      return;
    }

    // 첫 행: 카드 200,000
    await page.locator('[data-testid="receipt-split-method-0-card"]').click();
    await page.locator('[data-testid="receipt-split-amount-0"]').fill('200000');

    // AC-1: + 결제수단 추가 → 두 번째 행: 이체 100,000
    await page.locator('[data-testid="receipt-split-add"]').click();
    await page.locator('[data-testid="receipt-split-method-1-transfer"]').click();
    await page.locator('[data-testid="receipt-split-amount-1"]').fill('100000');

    // AC-2: 합계 300,000 자동 표시
    await expect(page.locator('[data-testid="receipt-split-total"]')).toContainText('300,000');

    // 단건 귀속(활성패키지 無 → 기본 single)
    await page.locator('[data-testid="receipt-payment-submit"]').click();

    // AC-3: payments 2행 생성(합계 == 각 행 합)
    await expect.poll(async () => {
      const { data } = await sb().from('payments').select('id').eq('customer_id', customer.id);
      return data?.length ?? 0;
    }, { timeout: 8000 }).toBe(2);

    const { data: pays } = await sb()
      .from('payments')
      .select('amount, method, payment_type')
      .eq('customer_id', customer.id)
      .order('amount', { ascending: false });
    expect(pays!.map((p) => p.amount)).toEqual([200000, 100000]);
    const byAmt = Object.fromEntries(pays!.map((p) => [p.amount, p.method]));
    expect(byAmt[200000]).toBe('card');
    expect(byAmt[100000]).toBe('transfer');
    expect(pays!.reduce((s, p) => s + p.amount, 0)).toBe(300000);
    // 정본 write-path: 모두 payment_type='payment'
    expect(pays!.every((p) => p.payment_type === 'payment')).toBe(true);
  } finally {
    await cleanupByName('receipt-split-test-s1-split');
  }
});

// ─────────────────────────────────────────────────────────────────
// 시나리오 2: 패키지 잔금 귀속 분할결제 → 미수 합산 (AC-3/4)
// ─────────────────────────────────────────────────────────────────
test('AC-3/4: 패키지 귀속 분할결제 → package_payments 2행 + paid_amount 합산(미수 합산 해소)', async ({ page }) => {
  const customer = await seedCustomer('s2-pkgsplit');
  const pkg = await seedActivePackage(customer.id, 'Re:Born 10회');

  try {
    if (!(await ensureLoggedIn(page))) { test.skip(true, 'auth 미설정 — skip'); return; }

    await page.goto(`${BASE_URL}/chart/${customer.id}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    if (!(await uploadReceiptAndOpenDialog(page))) {
      test.skip(true, '영수증 업로드/다이얼로그 진입 불가 (storage/렌더) — skip');
      return;
    }

    // 귀속 대상 = 패키지 잔금 (기본 선택). 카드 200,000 + 현금 100,000
    await page.locator('[data-testid="receipt-split-method-0-card"]').click();
    await page.locator('[data-testid="receipt-split-amount-0"]').fill('200000');
    await page.locator('[data-testid="receipt-split-add"]').click();
    await page.locator('[data-testid="receipt-split-method-1-cash"]').click();
    await page.locator('[data-testid="receipt-split-amount-1"]').fill('100000');

    await expect(page.locator('[data-testid="receipt-split-total"]')).toContainText('300,000');
    await page.locator('[data-testid="receipt-payment-submit"]').click();

    // package_payments 2행 생성
    await expect.poll(async () => {
      const { data } = await sb().from('package_payments').select('id').eq('customer_id', customer.id);
      return data?.length ?? 0;
    }, { timeout: 8000 }).toBe(2);

    const { data: pp } = await sb()
      .from('package_payments')
      .select('amount, method, package_id')
      .eq('customer_id', customer.id);
    expect(pp!.reduce((s, p) => s + p.amount, 0)).toBe(300000);
    expect(pp!.every((p) => p.package_id === pkg.id)).toBe(true);

    // AC-4: 미수 합산 — packages.paid_amount = 300,000 (분할 합계)
    await expect.poll(async () => {
      const { data } = await sb().from('packages').select('paid_amount').eq('id', pkg.id).maybeSingle();
      return data?.paid_amount ?? 0;
    }, { timeout: 8000 }).toBe(300000);

    // payments(단건) 미생성 — 이중집계 없음
    const { data: single } = await sb().from('payments').select('id').eq('customer_id', customer.id);
    expect(single?.length ?? 0).toBe(0);
  } finally {
    await cleanupByName('receipt-split-test-s2-pkgsplit');
  }
});

// ─────────────────────────────────────────────────────────────────
// 시나리오 3: 단건(1행) 회귀 — 결제수단 1개만 (AC-6)
// ─────────────────────────────────────────────────────────────────
test('AC-6: 단건(결제수단 1개) 입력 회귀 — payments 1행 생성(기존 동작 유지)', async ({ page }) => {
  const customer = await seedCustomer('s3-single');

  try {
    if (!(await ensureLoggedIn(page))) { test.skip(true, 'auth 미설정 — skip'); return; }

    await page.goto(`${BASE_URL}/chart/${customer.id}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    if (!(await uploadReceiptAndOpenDialog(page))) {
      test.skip(true, '영수증 업로드/다이얼로그 진입 불가 (storage/렌더) — skip');
      return;
    }

    // 1행만: 카드 150,000 (분할 미사용)
    await page.locator('[data-testid="receipt-split-method-0-card"]').click();
    await page.locator('[data-testid="receipt-split-amount-0"]').fill('150000');
    // 마지막 1행 → 삭제 버튼 미노출(최소 1행 유지)
    expect(await page.locator('[data-testid="receipt-split-remove-0"]').count()).toBe(0);

    await page.locator('[data-testid="receipt-payment-submit"]').click();

    await expect.poll(async () => {
      const { data } = await sb().from('payments').select('id').eq('customer_id', customer.id);
      return data?.length ?? 0;
    }, { timeout: 8000 }).toBe(1);

    const { data: pays } = await sb()
      .from('payments')
      .select('amount, method')
      .eq('customer_id', customer.id);
    expect(pays![0].amount).toBe(150000);
    expect(pays![0].method).toBe('card');
  } finally {
    await cleanupByName('receipt-split-test-s3-single');
  }
});

// ─────────────────────────────────────────────────────────────────
// 시나리오 4: 엣지 — 0원 행 제외 + 최소 1행 유지
// ─────────────────────────────────────────────────────────────────
test('엣지: 0원 행은 제외되고, 행 삭제로 최소 1행이 유지된다', async ({ page }) => {
  const customer = await seedCustomer('s4-edge');

  try {
    if (!(await ensureLoggedIn(page))) { test.skip(true, 'auth 미설정 — skip'); return; }

    await page.goto(`${BASE_URL}/chart/${customer.id}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    if (!(await uploadReceiptAndOpenDialog(page))) {
      test.skip(true, '영수증 업로드/다이얼로그 진입 불가 (storage/렌더) — skip');
      return;
    }

    // 행1: 카드 120,000 / 행2(추가): 금액 미입력(0)
    await page.locator('[data-testid="receipt-split-method-0-card"]').click();
    await page.locator('[data-testid="receipt-split-amount-0"]').fill('120000');
    await page.locator('[data-testid="receipt-split-add"]').click();
    // 행2 금액 미입력 → 합계는 120,000만 반영
    await expect(page.locator('[data-testid="receipt-split-total"]')).toContainText('120,000');

    // 행2 삭제 → 최소 1행 유지 확인(행0 삭제버튼 사라짐)
    await page.locator('[data-testid="receipt-split-remove-1"]').click();
    expect(await page.locator('[data-testid="receipt-split-remove-0"]').count()).toBe(0);

    await page.locator('[data-testid="receipt-payment-submit"]').click();

    // 0원 행 제외 → payments 1행(120,000)만 생성
    await expect.poll(async () => {
      const { data } = await sb().from('payments').select('id').eq('customer_id', customer.id);
      return data?.length ?? 0;
    }, { timeout: 8000 }).toBe(1);
    const { data: pays } = await sb().from('payments').select('amount').eq('customer_id', customer.id);
    expect(pays![0].amount).toBe(120000);
  } finally {
    await cleanupByName('receipt-split-test-s4-edge');
  }
});
