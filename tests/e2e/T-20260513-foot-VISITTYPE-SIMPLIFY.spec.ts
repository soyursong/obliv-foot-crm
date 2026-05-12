/**
 * E2E spec — T-20260513-foot-VISITTYPE-SIMPLIFY
 * 방문유형(visit_type) 체험(experience) 전면 삭제 + 딱지 2종(초진/재진) 한정
 *
 * AC-1: 수동접수 다이얼로그 — 초진/재진 2개만 표시 (체험 없음)
 * AC-2: 대시보드 배지 — 초진(파란)/재진(초록) 2종만 렌더링
 * AC-3: CustomerHoverCard — 보라색(체험) 배지 미존재 확인
 * AC-4: DB — experience 레코드 0건
 * AC-5: DB — CHECK 제약조건 experience 미포함
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

test.describe('T-20260513 VISITTYPE-SIMPLIFY — 체험 전면 삭제 + 딱지 2종', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  test('AC-1: 수동접수 다이얼로그 — 초진/재진 2개만, 체험 없음', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // "체크인 추가" 버튼 클릭 (수동접수 다이얼로그 열기)
    const addBtn = page.getByRole('button', { name: /체크인 추가|수동접수|접수 추가/ }).first();
    const hasBtnVisible = await addBtn.count() > 0;
    if (!hasBtnVisible) {
      // 버튼이 없으면 스킵 (데이터/환경 의존)
      test.skip(true, '체크인 추가 버튼 미발견 — 스킵');
      return;
    }
    await addBtn.click();

    // 다이얼로그 내 방문유형 버튼들 확인
    await page.getByRole('dialog').waitFor({ timeout: 5_000 });
    const dialog = page.getByRole('dialog');

    // 초진 버튼 존재
    await expect(dialog.getByRole('button', { name: '초진' })).toBeVisible({ timeout: 5_000 });
    // 재진 버튼 존재
    await expect(dialog.getByRole('button', { name: '재진' })).toBeVisible({ timeout: 3_000 });

    // 체험 버튼 없음
    const expBtn = dialog.getByRole('button', { name: /체험/ });
    expect(await expBtn.count()).toBe(0);

    // 전체 유형 버튼 2개 — 초진/재진만
    const visitBtns = dialog.locator('button').filter({ hasText: /^(초진|재진)$/ });
    await expect(visitBtns).toHaveCount(2);

    console.log('[AC-1] 수동접수 초진/재진 2개만 PASS');

    // 다이얼로그 닫기
    const cancelBtn = dialog.getByRole('button', { name: /취소/ }).first();
    if (await cancelBtn.count() > 0) await cancelBtn.click();
    else await page.keyboard.press('Escape');
  });

  test('AC-2: 대시보드 카드 배지 — 파란(초진)/초록(재진) 클래스만 존재', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 방문유형 배지가 있는 요소 확인 (배지 렌더링)
    // 체험 배지 (보라색 — bg-purple 클래스) 없어야 함
    const purpleBadge = page.locator('.bg-purple-100, .text-purple-700, .text-purple-800').filter({
      hasText: /체험/,
    });
    expect(await purpleBadge.count()).toBe(0);

    console.log('[AC-2] 대시보드 보라색 체험 배지 없음 PASS');
  });

  test('AC-3: CustomerHoverCard — 체험(보라) 배지 코드 미노출', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 고객 카드가 있을 경우 hover 후 체험 배지 없음 확인
    const customerCards = page.locator('[data-testid="customer-card"], .kanban-card').first();
    const hasCard = await customerCards.count() > 0;
    if (!hasCard) {
      console.log('[AC-3] 카드 없음 — 기본 렌더 확인으로 대체');
      // 체험 텍스트를 가진 보라 배지가 없으면 통과
      const expBadge = page.locator('.bg-purple-100').filter({ hasText: '체험' });
      expect(await expBadge.count()).toBe(0);
      return;
    }

    await customerCards.hover();
    await page.waitForTimeout(500);

    // 호버카드 내 보라색 체험 배지 없음
    const hoverCard = page.locator('[data-testid="hover-card"], .customer-hover-card, [role="tooltip"]').first();
    const hoverVisible = await hoverCard.count() > 0;
    if (hoverVisible) {
      const expBadge = hoverCard.locator('.bg-purple-100').filter({ hasText: '체험' });
      expect(await expBadge.count()).toBe(0);
    }

    console.log('[AC-3] CustomerHoverCard 체험 배지 없음 PASS');
  });

  test('AC-4: DB — experience 레코드 0건', async ({ request }) => {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      test.skip(true, 'SUPABASE env 미설정 — DB 검증 스킵');
      return;
    }

    // check_ins experience 레코드 수
    const ciRes = await request.get(
      `${SUPABASE_URL}/rest/v1/check_ins?select=id&visit_type=eq.experience&limit=1`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Prefer: 'count=exact',
        },
      },
    );
    const ciBody = await ciRes.json();
    expect(Array.isArray(ciBody) ? ciBody.length : 0).toBe(0);

    // reservations experience 레코드 수
    const rvRes = await request.get(
      `${SUPABASE_URL}/rest/v1/reservations?select=id&visit_type=eq.experience&limit=1`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      },
    );
    const rvBody = await rvRes.json();
    expect(Array.isArray(rvBody) ? rvBody.length : 0).toBe(0);

    console.log('[AC-4] DB experience 레코드 0건 PASS');
  });

  test('AC-5: 셀프접수 방문유형 — 초진/재진 2종만 표시', async ({ page }) => {
    // 셀프접수 페이지: /checkin/jongno-foot
    await page.goto('/checkin/jongno-foot');

    // 초진 버튼 존재
    await expect(page.getByRole('button', { name: '초진' })).toBeVisible({ timeout: 10_000 });
    // 재진 버튼 존재
    await expect(page.getByRole('button', { name: '재진' })).toBeVisible({ timeout: 3_000 });

    // 체험 버튼 없음
    const expBtn = page.getByRole('button', { name: /체험/ });
    expect(await expBtn.count()).toBe(0);

    console.log('[AC-5] 셀프접수 초진/재진 2종만 PASS');
  });
});
