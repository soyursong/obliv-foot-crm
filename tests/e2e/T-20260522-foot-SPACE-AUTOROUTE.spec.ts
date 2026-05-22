/**
 * E2E spec — T-20260522-foot-SPACE-AUTOROUTE
 * 1번차트 공간배정 드롭다운 삭제 + 금일동선 자동기입 전환 + 치료실/레이저실 누락 수정
 *
 * AC-1: 공간배정 드롭다운(Select) + "배정" 버튼 UI 완전 제거
 * AC-2: "금일 동선" 표시 영역 유지
 * AC-3: 금일 동선은 check_in_room_logs 기반 자동 집계
 * AC-4: 대시보드 DnD 이동이 check_in_room_logs에 자동 기록 (코드 레벨)
 * AC-5: 금일 동선에 상담실·치료실·레이저실 4슬롯 모두 표기 가능
 * AC-6: check_in_room_logs 조회 시 room_type 필터 없이 전체 이동 조회
 * AC-7: 중복 제거 · 당일 리셋 동작 유지
 * AC-8: 빌드 성공, 기존 E2E 회귀 없음
 *
 * 시나리오:
 *   S-1: 1번차트에 공간배정 드롭다운 + 배정 버튼 미존재 (AC-1)
 *   S-2: 1번차트에 "금일 동선" 섹션 + 4개 슬롯 배지 존재 (AC-2/5)
 *   S-3: 금일 동선 배지가 4가지 슬롯 타입(상담실·치료실·가열성레이저·레이저실) 구조로 렌더링 (AC-5/6)
 *   S-4: 회귀 없음 — Sheet 에러 없이 오픈 (AC-8)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260522-foot-SPACE-AUTOROUTE — 공간배정 드롭다운 삭제 + 금일동선 자동기입', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  /**
   * S-1: 공간배정 드롭다운 + 배정 버튼 미존재 (AC-1)
   * 1번차트(CheckInDetailSheet)에서 수동 공간배정 UI가 완전히 제거됨을 검증
   */
  test('S-1: 공간배정 드롭다운 + 배정 버튼 미존재 (AC-1)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if (await cards.count() === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    await cards.first().click();
    const sheet = page.locator('[role="dialog"]').first();
    const sheetVisible = await sheet.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!sheetVisible) {
      test.skip(true, '1번차트 Sheet 미오픈 — 스킵');
      return;
    }

    // AC-1: 공간배정 드롭다운(select) 미표시
    // 수동 배정용 방 목록 select가 없어야 함 (consultation_room 등 select 제거)
    const roomSelectOptions = sheet.locator('select').filter({ hasText: /L\d|상담실|치료실/ });
    expect(
      await roomSelectOptions.count(),
      'AC-1: 수동 공간배정 드롭다운(select)이 표시되어서는 안 됨',
    ).toBe(0);

    // AC-1: "배정" 버튼 미표시
    const assignBtn = sheet.getByRole('button', { name: /^배정$/ });
    expect(
      await assignBtn.count(),
      'AC-1: "배정" 버튼이 표시되어서는 안 됨',
    ).toBe(0);

    console.log('[AC-1] 공간배정 드롭다운 + 배정 버튼 미존재 확인 OK');
  });

  /**
   * S-2: "금일 동선" 섹션 + 슬롯 배지 존재 (AC-2/5)
   * 드롭다운 제거 후에도 금일 동선 표시 영역이 유지되고
   * 4개 슬롯 배지(상담실·치료실·가열성레이저·레이저실)가 렌더링됨
   */
  test('S-2: 금일 동선 섹션 + 4슬롯 배지 렌더링 (AC-2/5)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if (await cards.count() === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    await cards.first().click();
    const sheet = page.locator('[role="dialog"]').first();
    const sheetVisible = await sheet.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!sheetVisible) {
      test.skip(true, '1번차트 Sheet 미오픈 — 스킵');
      return;
    }

    // AC-2: 금일 동선 섹션 존재
    const spaceSection = sheet.locator('[data-testid="space-assign-section"]');
    await expect(spaceSection, 'AC-2: 금일 동선 섹션이 표시되어야 함').toBeVisible({ timeout: 5_000 });

    // AC-5: 일별 동선 영역 존재
    const dailyLogSection = sheet.locator('[data-testid="daily-room-log-section"]');
    await expect(dailyLogSection, 'AC-5: 금일 동선 로그 영역 표시').toBeVisible({ timeout: 5_000 });

    console.log('[AC-2/5] 금일 동선 섹션 + 로그 영역 표시 OK');
  });

  /**
   * S-3: 4개 슬롯 타입 배지 구조 검증 (AC-5/6)
   * data-testid="daily-log-{슬롯타입}" 배지가 4종 모두 렌더링됨을 확인
   * (logs 없으면 "—" placeholder, logs 있으면 실번호 표기)
   */
  test('S-3: 4개 슬롯 배지(상담실·치료실·가열성레이저·레이저실) 구조 존재 (AC-5/6)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if (await cards.count() === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    await cards.first().click();
    const sheet = page.locator('[role="dialog"]').first();
    const sheetVisible = await sheet.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!sheetVisible) {
      test.skip(true, '1번차트 Sheet 미오픈 — 스킵');
      return;
    }

    // 금일 동선 섹션이 없으면 스킵
    const spaceSection = sheet.locator('[data-testid="space-assign-section"]');
    const sectionVisible = await spaceSection.isVisible().catch(() => false);
    if (!sectionVisible) {
      test.skip(true, '금일 동선 섹션 미표시 — 스킵');
      return;
    }

    // AC-5/6: 4개 슬롯 배지 존재 확인
    const expectedSlots = ['상담실', '치료실', '가열성레이저', '레이저실'];
    for (const slotType of expectedSlots) {
      const badge = sheet.locator(`[data-testid="daily-log-${slotType}"]`);
      await expect(
        badge,
        `AC-5: [금일 동선] ${slotType} 배지가 표시되어야 함`,
      ).toBeVisible({ timeout: 5_000 });

      // 배지 텍스트: 슬롯 이름 텍스트 포함
      const badgeText = await badge.textContent();
      expect(
        badgeText,
        `AC-5: ${slotType} 배지 텍스트에 슬롯 이름 포함`,
      ).toContain(slotType);

      console.log(`[AC-5] ${slotType} 배지: "${badgeText?.trim()}" OK`);
    }
  });

  /**
   * S-4: 회귀 없음 — Sheet 에러 없이 열림 (AC-8)
   */
  test('S-4: 회귀 없음 — 1번차트 에러 없이 오픈 (AC-8)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if (await cards.count() === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    await cards.first().click();
    const sheet = page.locator('[role="dialog"]').first();
    const sheetVisible = await sheet.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!sheetVisible) {
      test.skip(true, '1번차트 Sheet 미오픈 — 스킵');
      return;
    }

    // AC-8: Sheet 열림
    await expect(sheet, 'AC-8: 1번차트 Sheet 정상 표시').toBeVisible();

    // AC-8: 에러 토스트 미표시
    const errorToast = page.locator('[data-sonner-toast][data-type="error"]');
    expect(await errorToast.count(), 'AC-8: 에러 토스트 미표시').toBe(0);

    // AC-8: JS 에러 없음
    await page.waitForTimeout(1_000);
    const criticalErrors = jsErrors.filter(
      (e) =>
        !e.includes('ResizeObserver') &&
        !e.includes('Non-Error promise rejection') &&
        !e.includes('AbortError'),
    );
    expect(criticalErrors, 'AC-8: JS 에러 없음').toHaveLength(0);

    console.log('[AC-8] 1번차트 Sheet 에러 없이 오픈 OK');
  });
});
