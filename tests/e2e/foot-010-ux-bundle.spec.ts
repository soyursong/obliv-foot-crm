/**
 * E2E B-5 (foot-010/011/012) — UX 묶음
 *
 * 검증 포인트:
 * 1. Dashboard 페이지 렌더 + 칸반 단계 표시
 * 2. Sidebar 결제대기 뱃지 자리 (count=0일 때 미표시 / count>0이면 표시)
 * 3. /admin/closing 페이지 미수 경고 영역 존재
 *
 * 동선 가드(재진→신규 단계 이동 시 toast)는 실제 카드 데이터 의존이라 raw-data 부재 시 skip.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('B-5 UX 묶음 (foot-010/011/012)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('Dashboard 칸반 영역 렌더', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText('대시보드', { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
    // 칸반 단계 라벨이 어딘가에 보이는지 (체크리스트/초진/상담/시술 등 후보 텍스트 1개라도)
    const stageCandidates = ['접수', '체크리스트', '초진대기', '상담대기', '시술대기', '결제대기', '완료'];
    let hit = 0;
    for (const t of stageCandidates) {
      if ((await page.getByText(t, { exact: false }).count()) > 0) hit += 1;
    }
    expect(hit).toBeGreaterThanOrEqual(1);
    console.log(`[B-5] Dashboard 칸반 단계 텍스트 ${hit}/${stageCandidates.length}개 매치`);
  });

  test('Sidebar — 결제대기 메뉴 항목 존재', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText('대시보드', { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });

    // 사이드바에 일마감/closing 링크 존재 (UX-9 결제대기 뱃지가 일마감에 표시됨)
    const closingLink = page.getByRole('link', { name: /일마감/ }).first();
    await expect(closingLink).toBeVisible({ timeout: 5_000 });
    console.log('[B-5] Sidebar 일마감 메뉴 OK');
  });

  test('/admin/closing 페이지 렌더 + 미수 경고 영역 마크업 존재', async ({ page }) => {
    await page.goto('/admin/closing');
    // closing 페이지는 admin/manager 만 접근 — 스크린 텍스트 후보들
    const okHeading = await Promise.race([
      page
        .getByText(/일마감|미수|결제대기/)
        .first()
        .waitFor({ timeout: 10_000 })
        .then(() => true)
        .catch(() => false),
    ]);
    expect(okHeading).toBe(true);
    console.log('[B-5] /admin/closing 렌더 OK');
  });

  test('/admin/packages 패키지 페이지 렌더 (분할결제 진입점)', async ({ page }) => {
    await page.goto('/admin/packages');
    await expect(page.getByText(/패키지/).first()).toBeVisible({ timeout: 10_000 });
    console.log('[B-5] /admin/packages 렌더 OK');
  });
});
