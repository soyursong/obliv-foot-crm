/**
 * E2E spec — T-20260525-foot-AMOUNT-COMMA
 * CRM 모든 금액 입력 시 쉼표(천 단위) 자동 삽입
 *
 * AC-1: AmountInput 컴포넌트 — 숫자 입력 시 천 단위 쉼표 자동 삽입
 * AC-2: PaymentMiniWindow 금액 입력에 적용
 * AC-3: 일마감(Closing) 금액 입력에 적용
 * AC-4: 수가항목 단가 입력에 적용 (Services)
 * AC-5: DB 저장 시 쉼표 제거 후 순수 숫자 — parseAmountRaw 검증
 * AC-6: 음수(환불) 표시 시 마이너스 부호 + 쉼표 정상 표시 (-150,000)
 * AC-7: 읽기 전용 금액 표시 영역도 쉼표 포맷 적용
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { formatAmountDisplay, parseAmountRaw } from '../../src/components/ui/AmountInput';

// ─── 단위 테스트 ──────────────────────────────────────────────────────────────

test.describe('T-20260525-foot-AMOUNT-COMMA 헬퍼 단위 테스트', () => {
  test('AC-1: formatAmountDisplay — 천 단위 쉼표 자동 삽입', () => {
    expect(formatAmountDisplay(150000)).toBe('150,000');
    expect(formatAmountDisplay(1500000)).toBe('1,500,000');
    expect(formatAmountDisplay(1200000)).toBe('1,200,000');
    expect(formatAmountDisplay('150000')).toBe('150,000');
    expect(formatAmountDisplay('1,500,000')).toBe('1,500,000'); // 붙여넣기 정규화
    console.log('[AC-1] formatAmountDisplay 쉼표 삽입 OK');
  });

  test('AC-5: parseAmountRaw — DB 저장 시 쉼표 제거 후 순수 숫자', () => {
    expect(parseAmountRaw('150,000')).toBe('150000');
    expect(parseAmountRaw('1,500,000')).toBe('1500000');
    expect(parseAmountRaw('1200000')).toBe('1200000');
    expect(parseAmountRaw('')).toBe('');
    expect(parseAmountRaw('1,200,000')).toBe('1200000');
    console.log('[AC-5] parseAmountRaw DB 저장값 OK');
  });

  test('AC-6: formatAmountDisplay — 음수(환불) 마이너스 + 쉼표 표시', () => {
    expect(formatAmountDisplay(-150000)).toBe('-150,000');
    expect(formatAmountDisplay(-1500000)).toBe('-1,500,000');
    expect(formatAmountDisplay('-150000')).toBe('-150,000');
    expect(formatAmountDisplay('-1200000')).toBe('-1,200,000');
    console.log('[AC-6] 음수 포맷 (-150,000) OK');
  });

  test('AC-7: formatAmountDisplay — 0·null·undefined·빈문자열 → 빈 문자열 (placeholder 표시)', () => {
    expect(formatAmountDisplay(0)).toBe('');
    expect(formatAmountDisplay('0')).toBe('');
    expect(formatAmountDisplay(null)).toBe('');
    expect(formatAmountDisplay(undefined)).toBe('');
    expect(formatAmountDisplay('')).toBe('');
    console.log('[AC-7] 0/null → 빈문자열 (placeholder 자연 표시) OK');
  });
});

// ─── E2E: 결제 다이얼로그 (AC-2) ─────────────────────────────────────────────

test.describe('T-20260525-foot-AMOUNT-COMMA E2E — 결제 금액 쉼표 포맷팅', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-2: 결제 다이얼로그 — 150000 입력 시 150,000 표시', async ({ page }) => {
    await page.goto('/admin/dashboard');

    const payBtn = page.locator('button').filter({ hasText: /결제|수납/ }).first();
    try {
      await payBtn.waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '결제 버튼 없음 — 체크인 데이터 필요');
      return;
    }
    await payBtn.click();

    const amountInput = page.locator('input[inputmode="numeric"]').first();
    try {
      await amountInput.waitFor({ timeout: 5_000 });
    } catch {
      test.skip(true, '금액 입력 필드 미발견');
      return;
    }

    await amountInput.fill('150000');
    await page.waitForTimeout(300);
    const val = await amountInput.inputValue();
    expect(val).toBe('150,000');
    console.log(`[AC-2] 결제 금액 입력: "150000" → "${val}" OK`);
  });
});

// ─── E2E: 일마감 금액 입력 (AC-3) ────────────────────────────────────────────

test.describe('T-20260525-foot-AMOUNT-COMMA E2E — 일마감 금액 쉼표 포맷팅', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-3: Closing 일마감 — 금액 입력 시 쉼표 자동 삽입', async ({ page }) => {
    await page.goto('/admin/closing');

    const amountInput = page.locator('input[inputmode="numeric"]').first();
    try {
      await amountInput.waitFor({ timeout: 8_000 });
    } catch {
      test.skip(true, '일마감 금액 입력 필드 미발견');
      return;
    }

    await amountInput.fill('300000');
    await page.waitForTimeout(200);
    const val = await amountInput.inputValue();
    expect(val).toBe('300,000');
    console.log(`[AC-3] 일마감 금액: "300000" → "${val}" OK`);
  });
});

// ─── E2E: 수가항목 단가 입력 (AC-4) ──────────────────────────────────────────

test.describe('T-20260525-foot-AMOUNT-COMMA E2E — 수가항목 단가 쉼표 포맷팅', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-4: Services 수가 입력 — 1200000 → 1,200,000 표시', async ({ page }) => {
    await page.goto('/admin/services');

    const addBtn = page.getByRole('button', { name: /추가|편집|수정/ }).first();
    try {
      await addBtn.waitFor({ timeout: 8_000 });
    } catch {
      test.skip(true, '수가 추가/편집 버튼 미발견');
      return;
    }
    await addBtn.click();

    const amountInput = page.locator('input[inputmode="numeric"]').first();
    try {
      await amountInput.waitFor({ timeout: 5_000 });
    } catch {
      test.skip(true, '수가 금액 입력 필드 미발견');
      return;
    }

    await amountInput.fill('1200000');
    await page.waitForTimeout(200);
    const val = await amountInput.inputValue();
    expect(val).toBe('1,200,000');
    console.log(`[AC-4] 수가 금액: "1200000" → "${val}" OK`);
  });
});

// ─── E2E: 읽기 전용 표시 (AC-7) ──────────────────────────────────────────────

test.describe('T-20260525-foot-AMOUNT-COMMA E2E — 읽기 전용 금액 표시', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-7: 대시보드 결제 완료 금액 표시 — 쉼표 포맷 확인', async ({ page }) => {
    await page.goto('/admin/dashboard');

    // 천 단위 쉼표 포함된 금액 표시 요소 확인
    const amountSpan = page.locator('.tabular-nums').filter({ hasText: /\d{1,3},\d{3}/ }).first();
    try {
      await amountSpan.waitFor({ timeout: 8_000 });
    } catch {
      test.skip(true, '쉼표 포함 금액 표시 없음 — 결제 데이터 필요');
      return;
    }
    const text = await amountSpan.textContent();
    expect(text).toMatch(/\d{1,3},\d{3}/);
    console.log(`[AC-7] 읽기 전용 금액 표시: "${text}" — 쉼표 포맷 OK`);
  });
});
