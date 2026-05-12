/**
 * E2E spec — T-20260512-foot-NOTICE-SCROLL
 * 사이드바 공지 작성 폼 스크롤 짤림 — 저장/취소 버튼 접근 가능 확인
 *
 * AC-1: 공지 작성 폼에서 저장/취소 버튼이 모든 뷰포트에서 접근 가능
 * AC-2: 작은 뷰포트(1024×700)에서도 스크롤로 버튼에 접근 가능
 * AC-3: 저장 버튼 클릭 동작 정상 (제목 없으면 toast.error 노출)
 * AC-4: 취소 버튼 클릭 시 폼 닫힘
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

/** foot CRM인지 확인 — CalendarNoticePanel의 "공지 등록" 버튼 존재 여부 */
async function isFootCRM(page: Parameters<typeof loginAndWaitForDashboard>[0]): Promise<boolean> {
  const btn = page.getByRole('button', { name: '공지 등록' });
  return (await btn.count()) > 0;
}

test.describe('T-20260512 NOTICE-SCROLL 공지 작성 폼 저장/취소 버튼 접근', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
    // foot CRM 환경 확인 (body CRM 등 다른 앱 접속 시 스킵)
    const isFoot = await isFootCRM(page);
    if (!isFoot) test.skip(true, 'foot CRM CalendarNoticePanel 없음 — 환경 불일치');
  });

  test('AC-1: 기본 뷰포트(1280×800)에서 저장/취소 버튼 접근 가능', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // CalendarNoticePanel의 "공지 등록" 버튼 클릭
    const addNoticeBtn = page.getByRole('button', { name: '공지 등록' });
    await expect(addNoticeBtn).toBeVisible({ timeout: 10_000 });
    await addNoticeBtn.click();

    // 폼 헤더 확인
    await expect(page.getByText('새 공지 작성', { exact: true })).toBeVisible({ timeout: 5_000 });

    // 저장 버튼 — scrollIntoViewIfNeeded 후 visible 확인
    const saveBtn = page.getByRole('button', { name: '저장' }).first();
    await saveBtn.scrollIntoViewIfNeeded();
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });

    // 취소 버튼
    const cancelBtn = page.getByRole('button', { name: '취소' }).first();
    await cancelBtn.scrollIntoViewIfNeeded();
    await expect(cancelBtn).toBeVisible({ timeout: 5_000 });

    console.log('[AC-1] 기본 뷰포트에서 저장/취소 버튼 접근 가능 OK');
  });

  test('AC-2: 소형 뷰포트(1024×700)에서 스크롤로 저장/취소 버튼 접근 가능', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });

    // 페이지 재진입 (뷰포트 변경 후 리로드)
    await page.goto('/admin');
    try {
      await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '대시보드 로딩 실패');
      return;
    }

    // "공지 등록" 버튼 클릭
    const addNoticeBtn = page.getByRole('button', { name: '공지 등록' });
    await expect(addNoticeBtn).toBeVisible({ timeout: 10_000 });
    await addNoticeBtn.click();

    // 폼 열림 확인
    await expect(page.getByText('새 공지 작성', { exact: true })).toBeVisible({ timeout: 5_000 });

    // 저장 버튼: scrollIntoViewIfNeeded로 스크롤 후 visible 확인 (핵심 AC)
    const saveBtn = page.getByRole('button', { name: '저장' }).first();
    await saveBtn.scrollIntoViewIfNeeded();
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });

    // 취소 버튼도 동일
    const cancelBtn = page.getByRole('button', { name: '취소' }).first();
    await cancelBtn.scrollIntoViewIfNeeded();
    await expect(cancelBtn).toBeVisible({ timeout: 5_000 });

    console.log('[AC-2] 소형 뷰포트에서 스크롤 후 저장/취소 버튼 접근 가능 OK');
  });

  test('AC-3: 제목 없이 저장 클릭 시 toast.error 노출 (동작 확인)', async ({ page }) => {
    const addNoticeBtn = page.getByRole('button', { name: '공지 등록' });
    await expect(addNoticeBtn).toBeVisible({ timeout: 10_000 });
    await addNoticeBtn.click();

    await expect(page.getByText('새 공지 작성', { exact: true })).toBeVisible({ timeout: 5_000 });

    // 제목 비워둔 채 저장 → error toast
    const saveBtn = page.getByRole('button', { name: '저장' }).first();
    await saveBtn.scrollIntoViewIfNeeded();
    await saveBtn.click();

    await expect(page.getByText('제목을 입력해주세요', { exact: false })).toBeVisible({ timeout: 5_000 });

    console.log('[AC-3] 제목 없이 저장 → error toast 노출 OK');
  });

  test('AC-4: 취소 버튼 클릭 시 폼 닫힘', async ({ page }) => {
    const addNoticeBtn = page.getByRole('button', { name: '공지 등록' });
    await expect(addNoticeBtn).toBeVisible({ timeout: 10_000 });
    await addNoticeBtn.click();

    await expect(page.getByText('새 공지 작성', { exact: true })).toBeVisible({ timeout: 5_000 });

    // 취소 클릭
    const cancelBtn = page.getByRole('button', { name: '취소' }).first();
    await cancelBtn.scrollIntoViewIfNeeded();
    await cancelBtn.click();

    // 폼 사라짐 확인
    await expect(page.getByText('새 공지 작성', { exact: true })).not.toBeVisible({ timeout: 5_000 });

    console.log('[AC-4] 취소 클릭 → 폼 닫힘 OK');
  });
});
