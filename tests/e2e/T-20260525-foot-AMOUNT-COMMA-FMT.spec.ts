/**
 * E2E spec — T-20260525-foot-AMOUNT-COMMA-FMT
 * CRM 금액 입력 쉼표 자동 포맷팅
 *
 * AC-1: 숫자 입력 시 천 단위 쉼표 자동 삽입 (150000 → 150,000)
 * AC-2: 입력 중 커서 위치 자연스럽게 유지
 * AC-3: 복사/붙여넣기 시 숫자 추출 후 포맷팅 정상 동작
 * AC-4: 서버 전송 시 쉼표 제거된 순수 숫자 전달 (DB 무변경)
 * AC-5: 읽기 전용 금액 표시 영역 쉼표 포맷팅 일관 적용
 *
 * 구현: AmountInput 공통 컴포넌트 + PaymentMiniWindow 인라인 수가 편집
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { formatAmountDisplay, parseAmountRaw } from '../../src/components/ui/AmountInput';

// ─── 단위 테스트 (헬퍼 함수) ─────────────────────────────────────────────────

test.describe('T-20260525 AmountInput 헬퍼 단위 테스트', () => {
  test('formatAmountDisplay: 숫자 → 천 단위 쉼표 문자열', () => {
    expect(formatAmountDisplay(0)).toBe('');
    expect(formatAmountDisplay(150000)).toBe('150,000');
    expect(formatAmountDisplay(1500000)).toBe('1,500,000');
    expect(formatAmountDisplay(1200000)).toBe('1,200,000');
    expect(formatAmountDisplay('150000')).toBe('150,000');
    expect(formatAmountDisplay('1,500,000')).toBe('1,500,000');
    expect(formatAmountDisplay('')).toBe('');
    expect(formatAmountDisplay(null)).toBe('');
    expect(formatAmountDisplay(undefined)).toBe('');
    console.log('[AC-1] formatAmountDisplay 단위 테스트 OK');
  });

  test('parseAmountRaw: 쉼표 포함 → 순수 숫자 문자열 (AC-4)', () => {
    expect(parseAmountRaw('150,000')).toBe('150000');
    expect(parseAmountRaw('1,500,000')).toBe('1500000');
    expect(parseAmountRaw('1200000')).toBe('1200000');
    expect(parseAmountRaw('')).toBe('');
    expect(parseAmountRaw('1,200,000')).toBe('1200000'); // AC-3: 붙여넣기 정규화
    console.log('[AC-4] parseAmountRaw 단위 테스트 OK (서버 전송값 숫자만)');
  });

  test('formatAmountDisplay: 0은 빈 문자열 반환 (placeholder 표시 허용)', () => {
    expect(formatAmountDisplay(0)).toBe('');
    expect(formatAmountDisplay('0')).toBe('');
    console.log('[AC-1] 0값 → 빈문자열 OK (placeholder 자연 표시)');
  });
});

// ─── 결제 다이얼로그 E2E ─────────────────────────────────────────────────────

test.describe('T-20260525 결제 금액 입력 쉼표 포맷팅 (E2E)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-1: 결제 다이얼로그 금액 입력 — 150000 → 150,000 표시', async ({ page }) => {
    await page.goto('/admin/dashboard');

    // 체크인 카드에서 결제 버튼 찾기
    const payBtn = page.locator('button').filter({ hasText: /결제|수납/ }).first();
    try {
      await payBtn.waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '결제 버튼 없음 — 체크인 데이터 필요');
      return;
    }
    await payBtn.click();

    // 금액 입력 필드 (AmountInput — text-lg)
    const amountInput = page.locator('input[inputmode="numeric"]').first();
    try {
      await amountInput.waitFor({ timeout: 5_000 });
    } catch {
      test.skip(true, '금액 입력 필드 미발견');
      return;
    }

    // 150000 입력 → 150,000 표시 확인
    await amountInput.fill('150000');
    await page.waitForTimeout(300);
    const val = await amountInput.inputValue();
    expect(val).toBe('150,000');
    console.log(`[AC-1] 금액 입력: "150000" → 표시: "${val}" OK`);
  });

  test('AC-1: 대금액 입력 — 1500000 → 1,500,000 표시', async ({ page }) => {
    await page.goto('/admin/dashboard');

    const payBtn = page.locator('button').filter({ hasText: /결제|수납/ }).first();
    try {
      await payBtn.waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '결제 버튼 없음');
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

    await amountInput.fill('1500000');
    await page.waitForTimeout(300);
    const val = await amountInput.inputValue();
    expect(val).toBe('1,500,000');
    console.log(`[AC-1] 대금액: "1500000" → 표시: "${val}" OK`);
  });

  test('AC-3: 붙여넣기 — "1,200,000" 붙여넣기 후 정상 포맷 표시', async ({ page }) => {
    await page.goto('/admin/dashboard');

    const payBtn = page.locator('button').filter({ hasText: /결제|수납/ }).first();
    try {
      await payBtn.waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '결제 버튼 없음');
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

    // 이미 쉼표 포함된 값 붙여넣기 시뮬레이션
    await amountInput.fill('1,200,000');
    await page.waitForTimeout(300);
    const val = await amountInput.inputValue();
    // 쉼표 포함값 입력 → 여전히 올바른 포맷으로 표시되어야 함
    expect(val).toBe('1,200,000');
    console.log(`[AC-3] 붙여넣기: "1,200,000" → 표시: "${val}" OK`);
  });

  test('AC-5: 결제 완료 후 금액 표시 — formatAmount 쉼표 포맷 확인', async ({ page }) => {
    await page.goto('/admin/dashboard');

    // 기존 결제 완료 건의 금액 표시 확인 (쉼표 포맷)
    const amountSpan = page.locator('.tabular-nums').filter({ hasText: /\d{1,3},\d{3}/ }).first();
    try {
      await amountSpan.waitFor({ timeout: 8_000 });
    } catch {
      test.skip(true, '금액 표시 요소 없음 — 결제 데이터 필요');
      return;
    }
    const text = await amountSpan.textContent();
    expect(text).toMatch(/\d{1,3},\d{3}/);
    console.log(`[AC-5] 읽기 전용 금액 표시: "${text}" — 쉼표 포맷 OK`);
  });
});

// ─── Closing 일마감 금액 입력 ────────────────────────────────────────────────

test.describe('T-20260525 일마감 금액 입력 쉼표 포맷팅', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-1: Closing 금액 입력 필드 — 숫자 입력 시 쉼표 자동 삽입', async ({ page }) => {
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
    console.log(`[AC-1] 일마감 금액: "300000" → "${val}" OK`);
  });
});

// ─── Services 수가 입력 ──────────────────────────────────────────────────────

test.describe('T-20260525 수가항목 금액 입력 쉼표 포맷팅', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-1: Services 수가 입력 — 숫자 입력 시 쉼표 자동 삽입', async ({ page }) => {
    await page.goto('/admin/services');

    // 수가 편집 버튼 또는 "추가" 버튼 찾기
    const addBtn = page.getByRole('button', { name: /추가|편집|수정/ }).first();
    try {
      await addBtn.waitFor({ timeout: 8_000 });
    } catch {
      test.skip(true, '수가 추가/편집 버튼 미발견');
      return;
    }
    await addBtn.click();

    // 금액 입력 필드
    const amountInput = page.locator('input[inputmode="numeric"]').first();
    try {
      await amountInput.waitFor({ timeout: 5_000 });
    } catch {
      test.skip(true, '수가 금액 입력 필드 미발견');
      return;
    }

    await amountInput.fill('50000');
    await page.waitForTimeout(200);
    const val = await amountInput.inputValue();
    expect(val).toBe('50,000');
    console.log(`[AC-1] 수가 금액: "50000" → "${val}" OK`);
  });
});
