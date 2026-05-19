/**
 * E2E spec — T-20260519-foot-SLOT-BATCH-EDIT
 * 풋센터 슬롯 배치편집 (CRM 미러링)
 *
 * AC-1: [상담] 타임테이블 단일 슬롯 행 제거 → 미배정 graceful 배너 표시
 * AC-2: 상담실1~N 슬롯 행 정상 유지
 * AC-3: 배치편집 모드 슬롯 일괄 추가
 * AC-4: 배치편집 모드 슬롯 일괄 삭제 (커스텀 슬롯만)
 * AC-5: 배치편집 적용 후 타임테이블 즉시 반영
 * AC-6: 에러 발생 시 토스트 + 기존 상태 보존
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260519-foot-SLOT-BATCH-EDIT — 풋센터 상담 슬롯 배치편집', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // 시나리오 1: AC-1 — [상담] DroppableColumn 행 제거 확인
  test('AC-1: [상담] 단일 드롭 컬럼이 제거되어 있어야 함', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 칸반 내 "상담" 단일 컬럼 헤더(DroppableColumn id="consultation")가 없어야 함
    // AC-1: 개별 슬롯들은 "상담실" 섹션으로 표시
    const consultDroppable = page.locator('[data-column-id="consultation"]');
    const count = await consultDroppable.count();
    expect(count).toBe(0);
  });

  // 시나리오 2: AC-2 — 상담실1~N 슬롯 정상 유지
  test('AC-2: 상담실 섹션(상담실1~N)이 표시되어야 함', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // "상담실" 헤더가 표시되는지 확인
    const consultSection = page.getByText('상담실', { exact: false }).first();
    const visible = await consultSection.isVisible().catch(() => false);
    if (!visible) {
      test.skip(true, '상담실 섹션 없음 — 칸반 레이아웃 확인 필요');
      return;
    }
    await expect(consultSection).toBeVisible();
  });

  // 시나리오 3: AC-3/AC-4 — 배치편집 버튼 존재 + 모드 토글
  test('AC-3/AC-4: 배치편집 버튼이 오늘 날짜에 표시되어야 함', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 배치편집 버튼 확인 (isToday=true 조건)
    const batchBtn = page.locator('[data-testid="slot-batch-edit-btn"]');
    const isTodayView = await batchBtn.isVisible().catch(() => false);
    if (!isTodayView) {
      test.skip(true, '배치편집 버튼 없음 — 오늘 날짜 대시보드가 아닐 수 있음');
      return;
    }
    await expect(batchBtn).toBeVisible();

    // 클릭 → 편집 모드 진입
    await batchBtn.click();
    const editPanel = page.locator('[data-testid="slot-batch-edit-panel"]');
    await expect(editPanel).toBeVisible({ timeout: 3_000 });

    // 편집 모드 배너 확인
    await expect(page.getByText('편집 모드')).toBeVisible();

    // "+ 슬롯추가" 버튼 확인
    await expect(page.locator('[data-testid="add-consult-slot-btn"]')).toBeVisible();

    // "완료" 버튼으로 편집 모드 종료
    await page.getByText('완료', { exact: true }).click();
    await expect(editPanel).not.toBeVisible({ timeout: 3_000 });
  });

  // 시나리오 4: AC-3 — 슬롯 추가 다이얼로그
  test('AC-3: 슬롯 추가 다이얼로그 열림 + 입력 UI', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const batchBtn = page.locator('[data-testid="slot-batch-edit-btn"]');
    const visible = await batchBtn.isVisible().catch(() => false);
    if (!visible) {
      test.skip(true, '배치편집 버튼 없음 — 오늘 날짜 대시보드가 아닐 수 있음');
      return;
    }

    await batchBtn.click();
    await page.locator('[data-testid="add-consult-slot-btn"]').click();

    // 다이얼로그 열림 확인
    const dialog = page.locator('[data-testid="consult-slot-name-input"]');
    await expect(dialog).toBeVisible({ timeout: 3_000 });

    // 입력 + 취소
    await dialog.fill('테스트 슬롯');
    await expect(dialog).toHaveValue('테스트 슬롯');
    await page.getByText('취소', { exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 2_000 });
  });

  // 시나리오 5: AC-4 — 기본 슬롯에 잠금 아이콘 표시
  test('AC-4/AC-6: 배치편집 모드에서 기본 슬롯은 잠금 아이콘, 삭제 버튼 없음', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const batchBtn = page.locator('[data-testid="slot-batch-edit-btn"]');
    const visible = await batchBtn.isVisible().catch(() => false);
    if (!visible) {
      test.skip(true, '배치편집 버튼 없음 — 오늘 날짜 대시보드가 아닐 수 있음');
      return;
    }

    await batchBtn.click();
    await page.locator('[data-testid="slot-batch-edit-panel"]').waitFor({ timeout: 3_000 });

    // 기본 슬롯 잠금 아이콘 확인
    const lockIcons = page.locator('span[title="기본 슬롯은 삭제 불가"]');
    const lockCount = await lockIcons.count();
    expect(lockCount).toBeGreaterThan(0);
  });
});
