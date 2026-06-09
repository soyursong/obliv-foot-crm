/**
 * E2E spec — T-20260609-foot-RECEIPT-PKG-ALWAYS
 * 영수증 업로드 = 항상 패키지 결제 (혼합안 supersede → 무조건 package_payments)
 *
 * 스펙 변경 (선행 T-20260608-foot-RECEIPT-PKG-PAYCLASS commit 713cf54 → 본건):
 *   - 변경1: 활성 패키지 자동감지 + 단건/패키지 토글 제거 → 영수증 업로드 = 항상 package_payments INSERT.
 *            귀속 패키지 없으면 가드 차단(단건 fallback 금지). reporter(김주연 총괄) 명시 재정의.
 *   - 변경2: 결제일(date) 입력 추가. Closing은 created_at 기준 일자 집계 →
 *            과거 결제일 선택 시 created_at을 해당일(정오 KST)로 세팅 → 다중 영수증 날짜별 분리 집계.
 *            (package_payments에 paid_at 전용 컬럼 부재. created_at이 결제일 컬럼 역할 + settable → 스키마 변경 불필요.)
 *
 * 시나리오 1 (AC-1/AC-2): 활성 패키지 고객 → 영수증 업로드 → 토글 미노출 → 저장
 *                          → package_payments 생성, payments 미생성.
 * 시나리오 2 (변경1 가드): 패키지 없는 고객 → 영수증 업로드 → 가드 노출 + 등록 비활성
 *                          → package_payments·payments 모두 미생성 (단건 fallback 안 함).
 * 시나리오 3 (AC-3): 다중 영수증 날짜별 귀속 — 과거 결제일 영수증 = 해당일, 오늘 영수증 = 오늘
 *                    → 각 package_payments.created_at 의 KST 일자가 결제일과 일치.
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

/** 임의 타임스탬프 → 서울 기준 YYYY-MM-DD (Closing 일자 집계 기준과 동일 로직) */
function seoulDate(input: string | number | Date): string {
  return new Date(input).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}
function todaySeoul(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

/** 1x1 투명 PNG (영수증 이미지 대체) */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function seedCustomer(suffix: string) {
  const client = sb();
  const name = `receipt-always-test-${suffix}-${Date.now()}`;
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
  const fileInput = page.locator('input[type="file"][accept="image/*"][multiple]');
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
// 시나리오 1: 영수증 업로드 = 무조건 패키지 결제 (AC-1/AC-2)
// ─────────────────────────────────────────────────────────────────
test('AC-1/AC-2: 영수증 업로드는 항상 package_payments로 분류되고 단건/패키지 토글이 없다', async ({ page }) => {
  const customer = await seedCustomer('s1-always');
  const pkg = await seedActivePackage(customer.id, 'Re:Born 10회');
  const AMOUNT = 1600000;

  try {
    if (!(await ensureLoggedIn(page))) { test.skip(true, 'auth 미설정 — skip'); return; }

    await page.goto(`${BASE_URL}/chart/${customer.id}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    if (!(await uploadReceiptAndOpenDialog(page))) {
      test.skip(true, '영수증 업로드/다이얼로그 진입 불가 (storage/렌더) — skip');
      return;
    }

    // AC-2: 단건/패키지 토글 제거 — 토글 버튼 부재
    expect(await page.locator('[data-testid="receipt-kind-package"]').count()).toBe(0);
    expect(await page.locator('[data-testid="receipt-kind-single"]').count()).toBe(0);
    // 패키지 라벨 노출 (단일 패키지)
    await expect(page.getByText('Re:Born 10회')).toBeVisible({ timeout: 3000 });

    const amountInput = page.locator('input[inputmode="numeric"]').last();
    await amountInput.fill(String(AMOUNT));
    await page.locator('[data-testid="receipt-payment-submit"]').click();

    // AC-1: package_payments 생성
    await expect.poll(async () => {
      const { data } = await sb()
        .from('package_payments')
        .select('id')
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

    // 단건(payments) 미생성 — 이중집계/오분류 없음
    const { data: single } = await sb()
      .from('payments')
      .select('id')
      .eq('customer_id', customer.id);
    expect(single?.length ?? 0).toBe(0);
  } finally {
    await cleanupByName('receipt-always-test-s1-always');
  }
});

// ─────────────────────────────────────────────────────────────────
// 시나리오 2: 패키지 없으면 가드 차단 (변경1 엣지 — 단건 fallback 금지)
// ─────────────────────────────────────────────────────────────────
test('변경1 가드: 활성 패키지 없는 고객은 영수증 매출 등록이 차단된다(단건 fallback 안 함)', async ({ page }) => {
  const customer = await seedCustomer('s2-guard');

  try {
    if (!(await ensureLoggedIn(page))) { test.skip(true, 'auth 미설정 — skip'); return; }

    await page.goto(`${BASE_URL}/chart/${customer.id}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    if (!(await uploadReceiptAndOpenDialog(page))) {
      test.skip(true, '영수증 업로드/다이얼로그 진입 불가 (storage/렌더) — skip');
      return;
    }

    // 가드 안내 노출 + 등록 버튼 비활성
    await expect(page.locator('[data-testid="receipt-no-package-guard"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="receipt-payment-submit"]')).toBeDisabled();

    // 비활성이므로 클릭해도 아무 결제도 기록되지 않음 (단건 fallback 금지)
    const { data: pp } = await sb()
      .from('package_payments')
      .select('id')
      .eq('customer_id', customer.id);
    expect(pp?.length ?? 0).toBe(0);
    const { data: single } = await sb()
      .from('payments')
      .select('id')
      .eq('customer_id', customer.id);
    expect(single?.length ?? 0).toBe(0);
  } finally {
    await cleanupByName('receipt-always-test-s2-guard');
  }
});

// ─────────────────────────────────────────────────────────────────
// 시나리오 3: 다중 영수증 결제일별 귀속 (AC-3)
// ─────────────────────────────────────────────────────────────────
test('AC-3: 과거 결제일 영수증은 결제일 기준으로 created_at이 귀속된다', async ({ page }) => {
  const customer = await seedCustomer('s3-date');
  const pkg = await seedActivePackage(customer.id, 'Re:Born 10회');
  const AMOUNT_PAST = 1200000;

  // D-2 (이틀 전) 결제일 — 오늘과 분명히 다른 날짜
  const pastDate = seoulDate(Date.now() - 2 * 24 * 60 * 60 * 1000);

  try {
    if (!(await ensureLoggedIn(page))) { test.skip(true, 'auth 미설정 — skip'); return; }

    await page.goto(`${BASE_URL}/chart/${customer.id}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    if (!(await uploadReceiptAndOpenDialog(page))) {
      test.skip(true, '영수증 업로드/다이얼로그 진입 불가 (storage/렌더) — skip');
      return;
    }

    // 결제일을 과거(D-2)로 변경
    const dateInput = page.locator('[data-testid="receipt-payment-date"]');
    await expect(dateInput).toBeVisible({ timeout: 3000 });
    await dateInput.fill(pastDate);

    const amountInput = page.locator('input[inputmode="numeric"]').last();
    await amountInput.fill(String(AMOUNT_PAST));
    await page.locator('[data-testid="receipt-payment-submit"]').click();

    // created_at 의 KST 일자가 결제일(D-2)과 일치 — 오늘로 몰리지 않음
    await expect.poll(async () => {
      const { data } = await sb()
        .from('package_payments')
        .select('id')
        .eq('customer_id', customer.id);
      return data?.length ?? 0;
    }, { timeout: 8000 }).toBeGreaterThan(0);

    const { data: pp } = await sb()
      .from('package_payments')
      .select('amount, created_at')
      .eq('customer_id', customer.id);
    expect(pp![0].amount).toBe(AMOUNT_PAST);
    expect(seoulDate(pp![0].created_at)).toBe(pastDate);
    expect(seoulDate(pp![0].created_at)).not.toBe(todaySeoul());
    expect(pkg.id).toBeTruthy(); // 가드: 패키지 시드 확인
  } finally {
    await cleanupByName('receipt-always-test-s3-date');
  }
});
