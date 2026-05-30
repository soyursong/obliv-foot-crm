/**
 * E2E spec — T-20260530-foot-DASHBOARD-NOTICE-SAVE-FAIL
 * 대시보드 좌측 사이드 패널(CalendarNoticePanel)에서 공지 저장 실패 — 회귀 검증
 *
 * 근본원인: notices.created_by FK → staff(id). FE가 profile.id(=auth.uid())를
 *   전달해 notices_created_by_fkey 위반(23503). 5/17 패치는 pages/Notices.tsx만
 *   수정하고 components/CalendarNoticePanel.tsx(대시보드 패널)를 놓침.
 * 수정: 패널 insert에서 created_by: null 고정.
 *
 * AC-1: 패널 '공지 등록' 클릭 → 폼 노출
 * AC-2: 제목 입력 후 저장 → 성공 toast('공지가 등록되었습니다'), 폼 닫힘 (FK 위반 없음)
 * AC-3: 저장된 공지가 패널 목록에 즉시 반영
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260530 DASHBOARD-NOTICE-SAVE-FAIL 대시보드 패널 공지 저장', () => {
  test.beforeEach(async ({ page }) => {
    // 데스크탑 뷰포트 — 패널 펼친 상태 보장 (PC 초기 pcCollapsed=false)
    await page.setViewportSize({ width: 1440, height: 900 });
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-1+2+3: 패널 공지 저장 성공 — FK 위반 없이 등록 + 목록 즉시 반영', async ({ page }) => {
    // 패널 '공지 등록' 버튼 (CalendarNoticePanel)
    const addBtn = page.getByRole('button', { name: '공지 등록' });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    // AC-1: 작성 폼 노출
    await expect(page.getByText('새 공지 작성', { exact: true })).toBeVisible({ timeout: 5_000 });

    // 제목 입력 (placeholder '제목 *')
    const testTitle = `[E2E-panel] 공지 저장 ${Date.now()}`;
    const titleInput = page.getByPlaceholder('제목 *');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill(testTitle);

    // 저장
    const saveBtn = page.getByRole('button', { name: '저장', exact: true });
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });
    await saveBtn.click();

    // AC-2 (durable gate): FK 위반이면 '저장 실패: ...' toast가 떴을 것 → 부재 검증.
    //   (성공 toast는 transient이므로 게이트로 쓰지 않음 — webapp-testing 모범사례)
    await expect(page.getByText(/저장 실패/)).toHaveCount(0);

    // AC-3 (durable gate): 패널 목록에 새 공지 즉시 반영
    //   → fetchNotices()는 insert 성공 후에만 호출되므로, 목록 반영 = 저장 성공의 결정적 증거
    await expect(page.getByText(testTitle)).toBeVisible({ timeout: 8_000 });

    // AC-2: 폼 닫힘 (성공 경로에서만 closeForm 호출)
    await expect(page.getByText('새 공지 작성', { exact: true })).not.toBeVisible({ timeout: 5_000 });

    console.log('[AC-1+2+3] 대시보드 패널 공지 저장 OK (FK 위반 없음, 목록 즉시 반영)');
  });

  test('AC-4: 제목 없이 저장 시 검증 에러', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: '공지 등록' });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();
    await expect(page.getByText('새 공지 작성', { exact: true })).toBeVisible({ timeout: 5_000 });

    const saveBtn = page.getByRole('button', { name: '저장', exact: true });
    await saveBtn.click();
    await expect(page.getByText('제목을 입력해주세요')).toBeVisible({ timeout: 5_000 });

    console.log('[AC-4] 제목 없이 저장 시 검증 에러 OK');
  });
});
