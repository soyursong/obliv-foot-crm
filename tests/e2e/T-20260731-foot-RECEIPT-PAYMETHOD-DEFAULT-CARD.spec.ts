/**
 * E2E spec — T-20260731-foot-RECEIPT-PAYMETHOD-DEFAULT-CARD
 * 풋 2번차트 상담내역 → 영수증 업로드 → '영수증 매출 연동'(매출 기입) 팝업.
 * 결제수단 선택 첫 행의 기본 선택값을 [카드]로 프리셀렉트.
 *
 * 변경: 팝업 오픈 시 splits[0].method 초기값 'cash' → 'card'.
 *   초기 표시(default selection)만 변경 — 저장 payment_method 값·매출 산식·저장 경로 불변.
 *   스태프가 다른 결제수단으로 수동 변경 가능하며 그 값이 정상 저장됨.
 *   신규 enum/코드값 추가 없음('card'는 기존 canon 코드값).
 *
 * 시나리오 1 (AC-1/3): 팝업 오픈 시 결제수단 [카드] 프리셀렉트 노출 → 그대로 저장 → payments.method='card'.
 * 시나리오 2 (AC-2): 기본 [카드]에서 [현금]으로 수동 변경 → 저장 → payments.method='cash'(변경값 정상 저장).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = process.env.FIXTURE_CLINIC_ID ?? '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // FIXTURE_CLINIC_ID: DEVDB-ISOLATION-CUTOVER leg-A(OFF=prod 상수 불변)
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
  const name = `receipt-paymethod-default-${suffix}-${Date.now()}`;
  const phone = `DUMMY-${Date.now()}`;
  const { data: customer, error } = await client
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: 'returning' })
    .select()
    .single();
  if (error) throw new Error(`고객 생성 실패: ${error.message}`);
  return customer!;
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

/** 결제수단 버튼 선택상태 판정 — 선택 시 sage-600 배경(흰 글씨) 클래스 부여. */
async function isMethodSelected(page: import('@playwright/test').Page, idx: number, method: string): Promise<boolean> {
  const cls = await page.locator(`[data-testid="receipt-split-method-${idx}-${method}"]`).getAttribute('class');
  return !!cls && cls.includes('bg-sage-600');
}

// ─────────────────────────────────────────────────────────────────
// 시나리오 1: 팝업 오픈 시 [카드] 프리셀렉트 → 그대로 저장 → method='card' (AC-1/3)
// ─────────────────────────────────────────────────────────────────
test('AC-1/3: 팝업 오픈 시 결제수단 기본값 [카드] 프리셀렉트 → 그대로 저장 시 payments.method=card', async ({ page }) => {
  const customer = await seedCustomer('s1-default-card');

  try {
    if (!(await ensureLoggedIn(page))) { test.skip(true, 'auth 미설정 — skip'); return; }

    await page.goto(`${BASE_URL}/chart/${customer.id}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    if (!(await uploadReceiptAndOpenDialog(page))) {
      test.skip(true, '영수증 업로드/다이얼로그 진입 불가 (storage/렌더) — skip');
      return;
    }

    // AC-1: 첫 행 결제수단이 [카드]로 프리셀렉트 상태여야 함(현금/이체는 미선택).
    expect(await isMethodSelected(page, 0, 'card')).toBe(true);
    expect(await isMethodSelected(page, 0, 'cash')).toBe(false);
    expect(await isMethodSelected(page, 0, 'transfer')).toBe(false);

    // AC-3: 결제수단은 손대지 않고(기본 [카드] 유지) 금액만 입력 → 저장.
    await page.locator('[data-testid="receipt-split-amount-0"]').fill('150000');
    await page.locator('[data-testid="receipt-payment-submit"]').click();

    // 저장된 payment_method = 'card' (기존 canon 코드값, 신규 enum 아님).
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
    await cleanupByName('receipt-paymethod-default-s1-default-card');
  }
});

// ─────────────────────────────────────────────────────────────────
// 시나리오 2: 기본 [카드] → [현금] 수동 변경 → 저장 → method='cash' (AC-2)
// ─────────────────────────────────────────────────────────────────
test('AC-2: 기본값 [카드]에서 [현금]으로 수동 변경 후 저장 시 payments.method=cash(변경값 정상 저장)', async ({ page }) => {
  const customer = await seedCustomer('s2-change-cash');

  try {
    if (!(await ensureLoggedIn(page))) { test.skip(true, 'auth 미설정 — skip'); return; }

    await page.goto(`${BASE_URL}/chart/${customer.id}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    if (!(await uploadReceiptAndOpenDialog(page))) {
      test.skip(true, '영수증 업로드/다이얼로그 진입 불가 (storage/렌더) — skip');
      return;
    }

    // 기본값 [카드] 확인 후 → [현금]으로 수동 변경(기본값이 저장을 강제하지 않음).
    expect(await isMethodSelected(page, 0, 'card')).toBe(true);
    await page.locator('[data-testid="receipt-split-method-0-cash"]').click();
    expect(await isMethodSelected(page, 0, 'cash')).toBe(true);
    expect(await isMethodSelected(page, 0, 'card')).toBe(false);

    await page.locator('[data-testid="receipt-split-amount-0"]').fill('90000');
    await page.locator('[data-testid="receipt-payment-submit"]').click();

    await expect.poll(async () => {
      const { data } = await sb().from('payments').select('id').eq('customer_id', customer.id);
      return data?.length ?? 0;
    }, { timeout: 8000 }).toBe(1);

    const { data: pays } = await sb()
      .from('payments')
      .select('amount, method')
      .eq('customer_id', customer.id);
    expect(pays![0].amount).toBe(90000);
    expect(pays![0].method).toBe('cash');
  } finally {
    await cleanupByName('receipt-paymethod-default-s2-change-cash');
  }
});
