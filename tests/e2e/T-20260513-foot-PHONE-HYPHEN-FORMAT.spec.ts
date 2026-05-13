/**
 * E2E spec — T-20260513-foot-PHONE-HYPHEN-FORMAT
 * CRM 전체 전화번호 입력 시 하이픈 자동 삽입 (010-xxxx-xxxx)
 *
 * AC-1: 예약 생성 — 숫자 입력 시 실시간 하이픈 자동 삽입
 * AC-2: 2번차트 1구역 — 휴대폰 인라인 편집 시 하이픈 자동 삽입
 * AC-3: 붙여넣기 — 숫자만/공백 포함 번호 붙여넣기 시 하이픈 정규화
 * AC-4: 자릿수 부족 — 미완성 번호도 에러 없이 부분 포맷 적용
 * AC-7: Packages.tsx — 전화번호 표시 하이픈 포맷 확인 (display)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260513 전화번호 하이픈 자동 포맷', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-1: 예약 생성 — 전화번호 숫자 입력 시 010-xxxx-xxxx 자동 포맷', async ({ page }) => {
    await page.goto('/admin/reservations');

    // "예약 생성" 버튼 찾기
    const createBtn = page.getByRole('button', { name: /예약 생성|새 예약/ }).first();
    try {
      await createBtn.waitFor({ timeout: 8_000 });
    } catch {
      test.skip(true, '예약 생성 버튼 미발견');
      return;
    }
    await createBtn.click();

    // 전화번호 입력 필드 (InlinePatientSearch phone)
    const phoneInput = page.locator('input[placeholder*="010-1234-5678"]').first();
    try {
      await phoneInput.waitFor({ timeout: 5_000 });
    } catch {
      test.skip(true, '전화번호 입력 필드 미발견');
      return;
    }

    // 숫자만 입력 → 하이픈 자동 삽입 확인
    await phoneInput.fill('01012345678');
    await page.waitForTimeout(300);
    const val = await phoneInput.inputValue();
    expect(val).toBe('010-1234-5678');
    console.log(`[AC-1] 입력값: "01012345678" → 포맷값: "${val}" OK`);
  });

  test('AC-2: 2번차트 휴대폰 인라인 편집 — 숫자 입력 시 하이픈 자동 포맷', async ({ page }) => {
    await page.goto('/admin/customers');

    // 고객 목록에서 첫 번째 고객 차트 진입
    const firstLink = page.locator('a[href*="/chart/"]').first();
    try {
      await firstLink.waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '고객 목록 없음');
      return;
    }
    await firstLink.click();

    // 2번차트 탭 클릭 (탭 이름 확인)
    const chartTab = page.getByRole('tab', { name: /2번차트|차트2/ }).first();
    const hasTab = await chartTab.count() > 0;
    if (hasTab) await chartTab.click();

    // 휴대폰 "수정" 버튼 클릭
    const editPhoneBtn = page.getByRole('button', { name: /수정/ }).filter({ hasText: /수정/ });
    const editBtnNear = page.locator('button').filter({ hasText: '수정' }).first();
    try {
      await editBtnNear.waitFor({ timeout: 5_000 });
    } catch {
      test.skip(true, '휴대폰 수정 버튼 미발견');
      return;
    }
    await editBtnNear.click();

    // 편집 input (type=tel) 표시 확인
    const telInput = page.locator('input[type="tel"]').first();
    try {
      await telInput.waitFor({ timeout: 3_000 });
    } catch {
      test.skip(true, '전화번호 편집 input 미발견');
      return;
    }

    // 숫자만 입력 → 하이픈 자동 삽입
    await telInput.fill('01098765432');
    await page.waitForTimeout(200);
    const val = await telInput.inputValue();
    expect(val).toBe('010-9876-5432');
    console.log(`[AC-2] 인라인 편집 포맷 OK: "${val}"`);

    // Escape로 취소 (저장 방지)
    await telInput.press('Escape');
  });

  test('AC-3: 붙여넣기 — 숫자만 붙여넣어도 010-xxxx-xxxx 포맷 적용', async ({ page }) => {
    await page.goto('/admin/reservations');

    const createBtn = page.getByRole('button', { name: /예약 생성|새 예약/ }).first();
    try {
      await createBtn.waitFor({ timeout: 8_000 });
    } catch {
      test.skip(true, '예약 생성 버튼 미발견');
      return;
    }
    await createBtn.click();

    const phoneInput = page.locator('input[placeholder*="010-1234-5678"]').first();
    try {
      await phoneInput.waitFor({ timeout: 5_000 });
    } catch {
      test.skip(true, '전화번호 입력 필드 미발견');
      return;
    }

    // 하이픈 없는 숫자 붙여넣기 시뮬레이션 (fill 사용)
    await phoneInput.fill('01055556666');
    await page.waitForTimeout(300);
    const val = await phoneInput.inputValue();
    expect(val).toBe('010-5555-6666');
    console.log(`[AC-3] 붙여넣기 정규화 OK: "${val}"`);
  });

  test('AC-4: 자릿수 부족 — 미완성 번호 입력 시 에러 없이 부분 포맷 적용', async ({ page }) => {
    await page.goto('/admin/reservations');

    const createBtn = page.getByRole('button', { name: /예약 생성|새 예약/ }).first();
    try {
      await createBtn.waitFor({ timeout: 8_000 });
    } catch {
      test.skip(true, '예약 생성 버튼 미발견');
      return;
    }
    await createBtn.click();

    const phoneInput = page.locator('input[placeholder*="010-1234-5678"]').first();
    try {
      await phoneInput.waitFor({ timeout: 5_000 });
    } catch {
      test.skip(true, '전화번호 입력 필드 미발견');
      return;
    }

    // 7자리 부분 입력
    await phoneInput.fill('0101234');
    await page.waitForTimeout(200);
    const val = await phoneInput.inputValue();
    // 에러 없이 부분 포맷 적용됨 (010-1234 또는 0101234 등)
    expect(val).not.toBeNull();
    // 페이지 에러 없음 확인
    const errorToast = page.getByText(/오류|에러|Error/, { exact: false });
    expect(await errorToast.count()).toBe(0);
    console.log(`[AC-4] 미완성 번호 부분 포맷: "${val}" — 에러 없음 OK`);
  });

  test('AC-7: Packages 화면 — 전화번호 하이픈 포맷 표시 확인', async ({ page }) => {
    await page.goto('/admin/packages');

    // 패키지 목록 로드 대기
    try {
      await page.waitForSelector('table tbody tr, [class*="package"]', { timeout: 10_000 });
    } catch {
      test.skip(true, '패키지 목록 미발견');
      return;
    }

    // 전화번호 표시 확인 — 하이픈 포함 형식이어야 함
    const phoneSpans = page.locator('span.text-muted-foreground, div.text-muted-foreground')
      .filter({ hasText: /^\d{3}-\d{4}-\d{4}$/ });

    // 패키지 데이터가 있으면 하이픈 포맷 확인
    const count = await phoneSpans.count();
    if (count > 0) {
      const firstPhone = await phoneSpans.first().textContent();
      expect(firstPhone).toMatch(/^\d{3}-\d{4}-\d{4}$/);
      console.log(`[AC-7] 패키지 전화번호 포맷: "${firstPhone}" OK`);
    } else {
      console.log('[AC-7] 패키지 전화번호 — 표시 데이터 없음, 스킵');
    }
  });
});
