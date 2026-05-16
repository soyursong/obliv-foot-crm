/**
 * E2E spec — T-20260516-foot-NOTICE-SAVE-FAIL
 * 공지사항 등록 저장 실패 — P0 핫픽스 검증
 *
 * AC-1: 등록 버튼 이벤트 — 저장 버튼 onClick 핸들러 정상 호출
 * AC-2: 저장 성공 — toast.success 표시 및 폼 닫힘
 * AC-3: 저장 후 목록 즉시 반영 — 새 공지 행 표시 (로컬 state 업데이트)
 * AC-4: 제목 없이 저장 시 toast.error 노출 (유효성 검사)
 * AC-5: 수정 성공 — 제목 변경 후 저장 시 목록 즉시 반영
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260516 NOTICE-SAVE-FAIL 공지사항 등록 저장', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-1 + AC-2 + AC-3: 공지사항 정상 등록 — 저장 버튼 작동 + 목록 즉시 반영', async ({ page }) => {
    // 공지사항 메뉴 진입
    await page.goto('/admin/notices');
    await expect(page.getByRole('heading', { name: '공지사항' })).toBeVisible({ timeout: 10_000 });

    // 새 공지 작성 버튼 클릭
    const newBtn = page.getByRole('button', { name: '새 공지' });
    await expect(newBtn).toBeVisible({ timeout: 5_000 });
    await newBtn.click();

    // 작성 폼 노출 확인
    await expect(page.getByText('새 공지 작성', { exact: true })).toBeVisible({ timeout: 5_000 });

    // 제목 입력
    const titleInput = page.getByPlaceholder('공지 제목');
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    const testTitle = `[E2E] 공지 저장 테스트 ${Date.now()}`;
    await titleInput.fill(testTitle);

    // 내용 입력
    const contentArea = page.getByPlaceholder('공지 내용을 입력하세요');
    await contentArea.fill('E2E 테스트 공지 내용입니다.');

    // 저장 버튼 클릭 (AC-1)
    const saveBtn = page.getByRole('button', { name: '저장' });
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });
    await saveBtn.click();

    // AC-2: toast.success 표시
    await expect(page.getByText('공지사항이 등록되었습니다')).toBeVisible({ timeout: 8_000 });

    // AC-2: 폼 닫힘 확인
    await expect(page.getByText('새 공지 작성', { exact: true })).not.toBeVisible({ timeout: 5_000 });

    // AC-3: 목록에 새 공지 즉시 반영
    await expect(page.getByText(testTitle)).toBeVisible({ timeout: 5_000 });

    console.log('[AC-1+2+3] 공지사항 저장 및 즉시 반영 OK');
  });

  test('AC-4: 제목 없이 저장 시 toast.error 노출', async ({ page }) => {
    await page.goto('/admin/notices');
    await expect(page.getByRole('heading', { name: '공지사항' })).toBeVisible({ timeout: 10_000 });

    const newBtn = page.getByRole('button', { name: '새 공지' });
    await newBtn.click();

    await expect(page.getByText('새 공지 작성', { exact: true })).toBeVisible({ timeout: 5_000 });

    // 제목 비워둔 채로 저장
    const saveBtn = page.getByRole('button', { name: '저장' });
    await saveBtn.click();

    // toast.error 노출 확인
    await expect(page.getByText('제목을 입력해주세요')).toBeVisible({ timeout: 5_000 });

    console.log('[AC-4] 제목 없이 저장 시 에러 toast OK');
  });
});
