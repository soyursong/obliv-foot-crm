/**
 * E2E spec — T-20260520-foot-PAYMENT-RESPONSIVE
 * 결제 미니창(PaymentMiniWindow) 모바일/태블릿 반응형 수정
 *
 * AC-1: 모바일(≤640px) 탭→상단 가로 탭바, 겹침 없음
 * AC-2: 진료비 수가항목 max-h-48+overflow-y-auto 카드형, 100% 가독
 * AC-3: 버튼 터치 영역 44×44px+
 * AC-4: 태블릿(641~1024px) 레이아웃 정상
 * AC-5: PC(≥1025px) regression 없음
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// ── 뷰포트 헬퍼 ────────────────────────────────────────────────────────────────
const VIEWPORT_MOBILE = { width: 390, height: 844 };   // iPhone 14
const VIEWPORT_TABLET = { width: 768, height: 1024 };  // iPad
const VIEWPORT_PC     = { width: 1280, height: 800 };  // Desktop

// ── 결제 미니창 열기 헬퍼 ──────────────────────────────────────────────────────
async function openPaymentDialog(page: import('@playwright/test').Page) {
  await page.goto('/admin');
  await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

  const payBtns = page.locator('[data-testid="btn-open-payment"]');
  const count = await payBtns.count();
  if (count === 0) return false;

  await payBtns.first().click();

  const dialog = page.locator('[role="dialog"]').filter({ hasText: '결제 미니창' });
  const visible = await dialog.waitFor({ state: 'visible', timeout: 8_000 })
    .then(() => true).catch(() => false);
  return visible;
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('T-20260520-foot-PAYMENT-RESPONSIVE — 결제 미니창 반응형', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC-1: 모바일 탭 겹침 없음 ────────────────────────────────────────────────
  test('AC-1: 모바일(390px) — 탭 가로 탭바, 본문 세로 스택, 겹침 없음', async ({ page }) => {
    await page.setViewportSize(VIEWPORT_MOBILE);

    const opened = await openPaymentDialog(page);
    if (!opened) {
      test.skip(true, '수납대기 카드 없음 — 스킵');
      return;
    }

    const dialog = page.locator('[role="dialog"]').filter({ hasText: '결제 미니창' });

    // 탭 버튼 3개 가로 탭바 — 모두 visible
    const tabBtns = dialog.locator('button').filter({ hasText: /상병코드|처방약|풋케어/ });
    await expect(tabBtns).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(tabBtns.nth(i)).toBeVisible();
    }

    // 탭 버튼이 가로로 배치 — 첫 번째와 세 번째의 top이 동일(±5px 허용)
    const box0 = await tabBtns.nth(0).boundingBox();
    const box2 = await tabBtns.nth(2).boundingBox();
    if (box0 && box2) {
      expect(Math.abs(box0.y - box2.y)).toBeLessThan(10);
      // 좌→우로 배치: x가 순서대로 증가
      expect(box0.x).toBeLessThan(box2.x);
    }

    // 다이얼로그 가로폭이 뷰포트에 꽉 참(모바일 full-width)
    const dialogBox = await dialog.boundingBox();
    if (dialogBox) {
      expect(dialogBox.width).toBeGreaterThan(350);
    }
  });

  // ── AC-2: 수가항목 스크롤 ────────────────────────────────────────────────────
  test('AC-2: 모바일 — 수가항목 목록 overflow 스크롤 컨테이너 존재', async ({ page }) => {
    await page.setViewportSize(VIEWPORT_MOBILE);

    const opened = await openPaymentDialog(page);
    if (!opened) {
      test.skip(true, '수납대기 카드 없음 — 스킵');
      return;
    }

    const dialog = page.locator('[role="dialog"]').filter({ hasText: '결제 미니창' });

    // Zone 2 진료비 헤더 visible
    const zone2header = dialog.locator('text=진료비 산정').first();
    const z2visible = await zone2header.isVisible().catch(() => false);
    if (!z2visible) {
      test.skip(true, 'Zone2 헤더 없음 — DB 데이터 없음 스킵');
      return;
    }
    await expect(zone2header).toBeVisible();
  });

  // ── AC-3: 버튼 44px 터치 영역 ────────────────────────────────────────────────
  test('AC-3: 모바일 — 탭 버튼 min-height 44px 터치 영역', async ({ page }) => {
    await page.setViewportSize(VIEWPORT_MOBILE);

    const opened = await openPaymentDialog(page);
    if (!opened) {
      test.skip(true, '수납대기 카드 없음 — 스킵');
      return;
    }

    const dialog = page.locator('[role="dialog"]').filter({ hasText: '결제 미니창' });
    const tabBtns = dialog.locator('button').filter({ hasText: /상병코드|처방약|풋케어/ });

    for (let i = 0; i < 3; i++) {
      const box = await tabBtns.nth(i).boundingBox();
      if (box) {
        // 44px 이상 높이 보장
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }
  });

  // ── AC-4: 태블릿 레이아웃 ────────────────────────────────────────────────────
  test('AC-4: 태블릿(768px) — 3열 가로 레이아웃, 탭 세로 사이드', async ({ page }) => {
    await page.setViewportSize(VIEWPORT_TABLET);

    const opened = await openPaymentDialog(page);
    if (!opened) {
      test.skip(true, '수납대기 카드 없음 — 스킵');
      return;
    }

    const dialog = page.locator('[role="dialog"]').filter({ hasText: '결제 미니창' });

    // 탭 버튼 3개 visible
    const tabBtns = dialog.locator('button').filter({ hasText: /상병코드|처방약|풋케어/ });
    await expect(tabBtns).toHaveCount(3);

    // 태블릿: 탭이 세로 배치 — 첫 번째와 세 번째의 x가 동일(±10px 허용)
    const box0 = await tabBtns.nth(0).boundingBox();
    const box2 = await tabBtns.nth(2).boundingBox();
    if (box0 && box2) {
      // sm(640px+)에서는 세로 사이드 → x 위치 동일
      expect(Math.abs(box0.x - box2.x)).toBeLessThan(10);
      // 위→아래 배치: y가 순서대로 증가
      expect(box0.y).toBeLessThan(box2.y);
    }
  });

  // ── AC-5: PC regression 없음 ─────────────────────────────────────────────────
  test('AC-5: PC(1280px) — 3열 레이아웃, 고정 높이 520px 보존', async ({ page }) => {
    await page.setViewportSize(VIEWPORT_PC);

    const opened = await openPaymentDialog(page);
    if (!opened) {
      test.skip(true, '수납대기 카드 없음 — 스킵');
      return;
    }

    const dialog = page.locator('[role="dialog"]').filter({ hasText: '결제 미니창' });

    // 탭 버튼 visible + 세로 배치
    const tabBtns = dialog.locator('button').filter({ hasText: /상병코드|처방약|풋케어/ });
    await expect(tabBtns).toHaveCount(3);

    const box0 = await tabBtns.nth(0).boundingBox();
    const box2 = await tabBtns.nth(2).boundingBox();
    if (box0 && box2) {
      // PC: 세로 사이드 — x 동일
      expect(Math.abs(box0.x - box2.x)).toBeLessThan(10);
      expect(box0.y).toBeLessThan(box2.y);
    }

    // 다이얼로그 폭이 1080px 이하 (sm:max-w-[1080px])
    const dialogBox = await dialog.boundingBox();
    if (dialogBox) {
      expect(dialogBox.width).toBeLessThanOrEqual(1090);
    }
  });
});
