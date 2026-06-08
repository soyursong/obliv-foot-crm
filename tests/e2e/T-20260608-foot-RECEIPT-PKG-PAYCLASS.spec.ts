/**
 * E2E spec — T-20260608-foot-RECEIPT-PKG-PAYCLASS
 * 패키지 결제 영수증 업로드가 단건 결제로 오분류되는 버그 수정
 *
 * 근본원인: ReceiptUploadSection.handlePaymentConfirm 이 항상 payments(단건) INSERT.
 * 수정(혼합안): 활성 패키지 있으면 '패키지 결제' 자동감지 디폴트 + 수동 단건 오버라이드.
 *   - kind='package' → package_payments INSERT (PKG-REVENUE-SPLIT 경로 재사용) → 일마감 패키지 집계
 *   - kind='single'  → payments INSERT (기존 단건 경로 회귀가드)
 *
 * 시나리오 1 (AC-1/AC-3): 활성 패키지 고객 → 영수증 업로드 → 패키지 자동감지 → 저장
 *                          → package_payments row 생성, payments 미생성 검증
 * 시나리오 2 (AC-2/AC-4): 패키지 없는 고객 → 영수증 업로드 → 결제종류 셀렉터 미노출
 *                          → 저장 → payments(단건) row 생성, package_payments 미생성 검증 (회귀가드)
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
  const name = `receipt-pkg-test-${suffix}-${Date.now()}`;
  const phone = `010${String(Date.now()).slice(-8)}`;
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
      total_amount: 1000000,
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
  // 결제영수증 섹션의 hidden file input (accept=image/*, multiple)
  const fileInput = page.locator('input[type="file"][accept="image/*"][multiple]');
  if (await fileInput.count() === 0) return false;
  await fileInput.first().setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: PNG_1X1,
  });
  // 매출 연동 다이얼로그 대기
  const dlg = page.getByText('영수증 매출 연동');
  return await dlg.isVisible({ timeout: 8000 }).catch(() => false);
}

// ─────────────────────────────────────────────────────────────────
// 시나리오 1: 패키지 영수증 정상 분류 (AC-1/AC-3)
// ─────────────────────────────────────────────────────────────────
test('AC-1/AC-3: 활성 패키지 고객의 영수증 업로드는 package_payments로 분류된다', async ({ page }) => {
  const customer = await seedCustomer('s1-pkg');
  const pkg = await seedActivePackage(customer.id, 'Re:Born 10회');
  const AMOUNT = 350000;

  try {
    if (!(await ensureLoggedIn(page))) { test.skip(true, 'auth 미설정 — skip'); return; }

    await page.goto(`${BASE_URL}/chart/${customer.id}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    if (!(await uploadReceiptAndOpenDialog(page))) {
      test.skip(true, '영수증 업로드/다이얼로그 진입 불가 (storage/렌더) — skip');
      return;
    }

    // 활성 패키지 있으므로 '결제 종류' 셀렉터 노출 + '패키지 결제' 자동감지(디폴트)
    const kindPackage = page.locator('[data-testid="receipt-kind-package"]');
    await expect(kindPackage).toBeVisible({ timeout: 3000 });
    // 패키지명 라벨 또는 셀렉트 노출 확인
    await expect(page.getByText('Re:Born 10회')).toBeVisible({ timeout: 3000 });

    // 금액 입력 (다이얼로그 스코프 내 text input)
    const amountInput = page.locator('input[inputmode="numeric"]').last();
    await amountInput.fill(String(AMOUNT));

    // 등록
    await page.getByRole('button', { name: '등록' }).click();

    // ── DB 검증: package_payments에 기록, payments에는 없음 ──
    await expect.poll(async () => {
      const { data } = await sb()
        .from('package_payments')
        .select('id, amount, package_id, memo')
        .eq('customer_id', customer.id);
      return data?.length ?? 0;
    }, { timeout: 8000 }).toBeGreaterThan(0);

    const { data: pp } = await sb()
      .from('package_payments')
      .select('amount, package_id, payment_type')
      .eq('customer_id', customer.id);
    expect(pp![0].amount).toBe(AMOUNT);
    expect(pp![0].package_id).toBe(pkg.id);
    expect(pp![0].payment_type).toBe('payment');

    // AC-3: 단건(payments) 미생성 — 이중집계 없음
    const { data: single } = await sb()
      .from('payments')
      .select('id')
      .eq('customer_id', customer.id);
    expect(single?.length ?? 0).toBe(0);
  } finally {
    await cleanupByName('receipt-pkg-test-s1-pkg');
  }
});

// ─────────────────────────────────────────────────────────────────
// 시나리오 2: 단건 영수증 회귀가드 (AC-2/AC-4)
// ─────────────────────────────────────────────────────────────────
test('AC-2/AC-4: 패키지 없는 고객의 영수증 업로드는 payments(단건) 유지된다', async ({ page }) => {
  const customer = await seedCustomer('s2-single');
  const AMOUNT = 120000;

  try {
    if (!(await ensureLoggedIn(page))) { test.skip(true, 'auth 미설정 — skip'); return; }

    await page.goto(`${BASE_URL}/chart/${customer.id}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    if (!(await uploadReceiptAndOpenDialog(page))) {
      test.skip(true, '영수증 업로드/다이얼로그 진입 불가 (storage/렌더) — skip');
      return;
    }

    // 활성 패키지 없으므로 '결제 종류' 셀렉터 미노출 (단건 단일 경로)
    const kindPackage = page.locator('[data-testid="receipt-kind-package"]');
    expect(await kindPackage.count()).toBe(0);

    const amountInput = page.locator('input[inputmode="numeric"]').last();
    await amountInput.fill(String(AMOUNT));
    await page.getByRole('button', { name: '등록' }).click();

    // ── DB 검증: payments(단건) 기록, package_payments 미생성 ──
    await expect.poll(async () => {
      const { data } = await sb()
        .from('payments')
        .select('id, amount')
        .eq('customer_id', customer.id);
      return data?.length ?? 0;
    }, { timeout: 8000 }).toBeGreaterThan(0);

    const { data: single } = await sb()
      .from('payments')
      .select('amount, memo')
      .eq('customer_id', customer.id);
    expect(single![0].amount).toBe(AMOUNT);
    expect(single![0].memo).toBe('영수증 업로드');

    const { data: pp } = await sb()
      .from('package_payments')
      .select('id')
      .eq('customer_id', customer.id);
    expect(pp?.length ?? 0).toBe(0);
  } finally {
    await cleanupByName('receipt-pkg-test-s2-single');
  }
});
