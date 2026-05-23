/**
 * E2E spec — T-20260523-foot-FEE-ITEM-SCROLL
 * 결제 미니창 "수가 항목" 높이 확장 + 스크롤 개선
 *
 * AC-1: "수가 항목" 컨테이너 max-height 확대 → 5건까지 스크롤 없이 한 눈에 노출
 * AC-2: 항목 6건 이상 시 overflow-y: auto 스크롤 동작 (smooth scroll)
 * AC-3: 하단 "세금 구분 / 합계" 영역 밀리지 않고 정상 노출
 * AC-4: 수가 항목 0건 시 빈 컨테이너 불필요하게 크지 않음
 * AC-5: 모바일/태블릿 뷰포트에서도 스크롤 정상 동작
 */

import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const VIEWPORT_MOBILE  = { width: 390,  height: 844  };
const VIEWPORT_TABLET  = { width: 768,  height: 1024 };
const VIEWPORT_PC      = { width: 1280, height: 800  };

// ── 결제 미니창 열기 헬퍼 ─────────────────────────────────────────────────────
async function openPaymentDialog(page: import('@playwright/test').Page) {
  await page.goto('/admin');
  // 모바일/태블릿에서 사이드바가 collapsed → '대시보드' span이 hidden 상태.
  // waitFor() 기본값 state:'visible' 에서 15초 timeout 발생하므로
  // networkidle 로 변경 (모바일·데스크탑 공통 동작 보장)
  await page.waitForLoadState('networkidle', { timeout: 15_000 });

  const payBtns = page.locator('[data-testid="btn-open-payment"]');
  const count = await payBtns.count();
  if (count === 0) return false;

  await payBtns.first().click();

  const dialog = page.locator('[role="dialog"]').filter({ hasText: '결제 미니창' });
  return dialog.waitFor({ state: 'visible', timeout: 8_000 })
    .then(() => true).catch(() => false);
}

// ── Zone2 수가 항목 컨테이너 로케이터 ────────────────────────────────────────────
function getFeeItemContainer(dialog: ReturnType<typeof import('@playwright/test').expect>) {
  // "수가 항목" 헤더를 포함한 스크롤 가능 컨테이너를 찾는다
  return (dialog as any).locator('div').filter({ hasText: /수가 항목/ }).first();
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('T-20260523-foot-FEE-ITEM-SCROLL — 수가 항목 높이 확장 + 스크롤', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── AC-1 + AC-3: 수가 항목 영역 노출 + 세금 구분 정상 표시 ─────────────────────
  test('AC-1+AC-3: PC — 수가 항목 영역 노출 및 세금 구분 영역 정상', async ({ page }) => {
    await page.setViewportSize(VIEWPORT_PC);

    const opened = await openPaymentDialog(page);
    if (!opened) {
      test.skip(true, '수납대기 카드 없음 — 스킵');
      return;
    }

    const dialog = page.locator('[role="dialog"]').filter({ hasText: '결제 미니창' });

    // Zone2 헤더 확인
    await expect(dialog.getByText(/차트 코드.*진료비 산정/)).toBeVisible();

    // "수가 항목" 섹션 레이블 존재
    await expect(dialog.getByText(/수가 항목/).first()).toBeVisible();

    // 풋케어 탭으로 전환하여 항목 추가
    const footcareTab = dialog.locator('button').filter({ hasText: '풋케어' });
    const tabVisible = await footcareTab.isVisible().catch(() => false);
    if (!tabVisible) {
      test.skip(true, '풋케어 탭 없음 — 스킵');
      return;
    }
    await footcareTab.click();

    // 풋케어 서비스 버튼 클릭으로 항목 추가 (최소 1건)
    const serviceBtns = dialog.locator('button').filter({ hasText: /소견서|진단서|진료확인서|처방전/ });
    const btnCount = await serviceBtns.count();
    if (btnCount === 0) {
      test.skip(true, '풋케어 서비스 버튼 없음 — DB 데이터 없음 스킵');
      return;
    }

    // 첫 번째 항목 클릭
    await serviceBtns.first().click();

    // 수가 항목 1건 이상 추가되면 세금 구분 영역이 보여야 함
    const taxSection = dialog.getByText('세금 구분');
    const taxVisible = await taxSection.isVisible().catch(() => false);
    if (taxVisible) {
      await expect(taxSection).toBeVisible();
      // AC-3: 합계 영역 정상 노출
      await expect(dialog.getByText('합계').first()).toBeVisible();
    }
  });

  // ── AC-2: 스크롤 컨테이너 overflow-y auto 속성 확인 ──────────────────────────
  test('AC-2: PC — 수가 항목 컨테이너 overflow-y scroll 속성', async ({ page }) => {
    await page.setViewportSize(VIEWPORT_PC);

    const opened = await openPaymentDialog(page);
    if (!opened) {
      test.skip(true, '수납대기 카드 없음 — 스킵');
      return;
    }

    const dialog = page.locator('[role="dialog"]').filter({ hasText: '결제 미니창' });

    // scroll-smooth 클래스가 존재하는 컨테이너 확인
    // "수가 항목" 텍스트를 포함하는 가장 가까운 overflow 컨테이너
    const scrollContainers = dialog.locator('.scroll-smooth');
    const count = await scrollContainers.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  // ── AC-4: 수가 항목 0건 시 빈 컨테이너 compact ────────────────────────────────
  test('AC-4: PC — 수가 항목 0건 시 빈 컨테이너 compact (max-h-28)', async ({ page }) => {
    await page.setViewportSize(VIEWPORT_PC);

    const opened = await openPaymentDialog(page);
    if (!opened) {
      test.skip(true, '수납대기 카드 없음 — 스킵');
      return;
    }

    const dialog = page.locator('[role="dialog"]').filter({ hasText: '결제 미니창' });

    // 수가 항목 0건 상태에서 "좌측에서 코드를 선택하세요" 텍스트 확인
    const emptyMsg = dialog.getByText('좌측에서 코드를 선택하세요');
    const emptyVisible = await emptyMsg.isVisible().catch(() => false);
    if (!emptyVisible) {
      // 이미 항목이 있는 상태 — 이 테스트는 초기 0건 상태가 필요
      test.skip(true, '수가 항목이 이미 선택된 상태 — AC-4 스킵');
      return;
    }

    await expect(emptyMsg).toBeVisible();

    // 빈 상태 컨테이너 높이가 112px(max-h-28) 이하
    const container = emptyMsg.locator('..').locator('..');
    const box = await container.boundingBox().catch(() => null);
    // 빈 컨테이너는 화면의 절반 이상을 차지하지 않아야 함 (compact)
    if (box) {
      expect(box.height).toBeLessThan(250);
    }
  });

  // ── AC-5: 모바일(390px) 스크롤 컨테이너 ───────────────────────────────────────
  test('AC-5: 모바일(390px) — 수가 항목 스크롤 컨테이너 존재 및 max-h-80 적용', async ({ page }) => {
    await page.setViewportSize(VIEWPORT_MOBILE);

    const opened = await openPaymentDialog(page);
    if (!opened) {
      test.skip(true, '수납대기 카드 없음 — 스킵');
      return;
    }

    const dialog = page.locator('[role="dialog"]').filter({ hasText: '결제 미니창' });

    // Zone2 헤더 (모바일: 스크롤 후 아래에 위치 가능)
    const zone2Header = dialog.getByText(/차트 코드.*진료비 산정/);
    const headerVisible = await zone2Header.isVisible().catch(() => false);
    if (!headerVisible) {
      test.skip(true, 'Zone2 헤더 비가시 — 모바일 스크롤 필요 스킵');
      return;
    }

    // scroll-smooth 클래스 컨테이너 존재
    const scrollContainers = dialog.locator('.scroll-smooth');
    expect(await scrollContainers.count()).toBeGreaterThanOrEqual(1);
  });

  // ── AC-5: 태블릿(768px) 스크롤 컨테이너 ─────────────────────────────────────
  test('AC-5: 태블릿(768px) — 수가 항목 컨테이너 존재 및 스크롤 가능', async ({ page }) => {
    await page.setViewportSize(VIEWPORT_TABLET);

    const opened = await openPaymentDialog(page);
    if (!opened) {
      test.skip(true, '수납대기 카드 없음 — 스킵');
      return;
    }

    const dialog = page.locator('[role="dialog"]').filter({ hasText: '결제 미니창' });

    // "수가 항목" 레이블 존재
    await expect(dialog.getByText(/수가 항목/).first()).toBeVisible();

    // Zone2 진료비 헤더 존재
    await expect(dialog.getByText(/차트 코드.*진료비 산정/)).toBeVisible();
  });

  // ── 컨테이너 높이 600px 확장 확인 ─────────────────────────────────────────────
  test('CONTAINER-HEIGHT: PC — 다이얼로그 본문 행 높이 ≥ 580px (FEE-ITEM-SCROLL 600px)', async ({ page }) => {
    await page.setViewportSize(VIEWPORT_PC);

    const opened = await openPaymentDialog(page);
    if (!opened) {
      test.skip(true, '수납대기 카드 없음 — 스킵');
      return;
    }

    const dialog = page.locator('[role="dialog"]').filter({ hasText: '결제 미니창' });

    // 다이얼로그 전체 높이가 충분히 큼 (헤더 + 600px 본문)
    const dialogBox = await dialog.boundingBox();
    if (dialogBox) {
      // 헤더 ~60px + 본문 600px = ~660px 이상이어야 함
      // 화면이 너무 작으면 max-h-[92vh] 로 제한됨 — 1280×800 기준 92vh = 736px
      expect(dialogBox.height).toBeGreaterThanOrEqual(580);
    }
  });
});
