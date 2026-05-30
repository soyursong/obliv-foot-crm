/**
 * E2E spec — T-20260530-foot-NOTICE-CREATEDBY-BACKFILL
 * 공지 작성자 추적 복원: created_by 를 로그인 사용자의 실제 staff.id 로 매핑.
 *
 * 변경: 기존 created_by=null 고정 → staff.user_id 역조회로 staff.id 매핑.
 *   매핑 실패(staff 미존재) 시 null graceful fallback (FK nullable·on delete set null).
 *
 * 회귀 핵심: 매핑 로직이 추가돼도 저장은 항상 성공해야 한다.
 *   - 매핑 성공 → created_by = staff.id (FK 충족)
 *   - 매핑 실패 → created_by = null (graceful fallback, FK 충족)
 *   두 경로 모두 notices_created_by_fkey 위반(23503) 없이 저장 성공.
 *
 * AC-2: 패널/페이지 공지 저장 → FK 위반 없이 성공 + 목록 즉시 반영
 * AC-3: 매핑 실패 시에도 graceful fallback 으로 저장 성공 (durable gate = 목록 반영)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260530 NOTICE-CREATEDBY-BACKFILL 작성자 추적 복원', () => {
  test.beforeEach(async ({ page }) => {
    // 데스크탑 뷰포트 — 좌측 패널 펼친 상태 보장 (PC 초기 pcCollapsed=false)
    await page.setViewportSize({ width: 1440, height: 900 });
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-2+3: 패널 공지 저장 — created_by 매핑 후에도 FK 위반 없이 성공 + 목록 반영', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: '공지 등록' });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    await expect(page.getByText('새 공지 작성', { exact: true })).toBeVisible({ timeout: 5_000 });

    const testTitle = `[E2E-createdby] 작성자추적 ${Date.now()}`;
    const titleInput = page.getByPlaceholder('제목 *');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill(testTitle);

    const saveBtn = page.getByRole('button', { name: '저장', exact: true });
    await saveBtn.click();

    // durable gate: created_by 매핑(또는 null fallback) 어느 경로든 FK 위반 toast 부재
    await expect(page.getByText(/저장 실패/)).toHaveCount(0);

    // durable gate: 목록 즉시 반영 = 저장 성공의 결정적 증거 (fetchNotices는 성공 후에만 호출)
    await expect(page.getByText(testTitle)).toBeVisible({ timeout: 8_000 });

    // 폼 닫힘 (성공 경로에서만 closeForm 호출)
    await expect(page.getByText('새 공지 작성', { exact: true })).not.toBeVisible({ timeout: 5_000 });

    console.log('[AC-2+3] 패널 공지 저장 OK — created_by 매핑/fallback 무관 FK 위반 없음, 목록 반영');
  });

  test('AC-2: 공지사항 페이지(/admin/notices) 저장 — created_by 매핑 후에도 성공', async ({ page }) => {
    await page.goto('/admin/notices');

    const addBtn = page.getByRole('button', { name: '새 공지' });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    await expect(page.getByText('새 공지 작성', { exact: true })).toBeVisible({ timeout: 5_000 });

    const testTitle = `[E2E-createdby-page] 작성자추적 ${Date.now()}`;
    const titleInput = page.getByPlaceholder('공지 제목');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill(testTitle);

    const saveBtn = page.getByRole('button', { name: '저장', exact: true });
    await saveBtn.click();

    await expect(page.getByText(/저장 실패/)).toHaveCount(0);
    await expect(page.getByText(testTitle)).toBeVisible({ timeout: 8_000 });

    console.log('[AC-2] 공지사항 페이지 저장 OK — created_by 매핑/fallback 무관 FK 위반 없음');
  });
});
