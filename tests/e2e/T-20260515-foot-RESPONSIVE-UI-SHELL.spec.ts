/**
 * T-20260515-foot-RESPONSIVE-UI-SHELL
 * 풋센터 반응형 UI Shell 선행 검증 (Phase 0)
 *
 * Shell-1: 모바일 캘린더 방어 설계
 *   AC-1: 모바일(<=768px) 예약관리 시간표 — 좌측 시간축 sticky left-0 고정
 *   AC-2: 가로 스크롤 시 시간축 밀림 없음 확인
 *   AC-3: CSS/레이아웃만 (백엔드 없음)
 *
 * Shell-2: 태블릿 풀스크린 모달 전환 UX
 *   AC-5: 태블릿(>=769px) 빈 슬롯 탭 → 풀스크린 모달 열림
 *   AC-6: 모달이 화면 꽉 채움 (inset-0)
 *   AC-7: 닫기 → 원래 시간표 뷰로 복귀 (모달 사라짐)
 *   AC-8: 열기/닫기 전환 애니메이션 존재 (transition-transform)
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8082';
const RESV_URL = `${BASE}/admin/reservations`;

// ── Shell-1: 모바일 시간축 Sticky ─────────────────────────────────────────────

test.describe('Shell-1: 모바일 예약관리 시간축 Sticky', () => {
  test('AC-1: 모바일(390px) — 시간축 헤더 sticky left-0 적용', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(RESV_URL, { waitUntil: 'networkidle' });

    // 시간축 헤더 셀이 DOM에 존재
    const timeColHeader = page.getByTestId('resv-time-col-header');
    await expect(timeColHeader).toBeAttached();

    // sticky position 확인
    const position = await timeColHeader.evaluate((el) =>
      getComputedStyle(el).position,
    );
    expect(position).toBe('sticky');

    // left: 0px 확인
    const leftVal = await timeColHeader.evaluate((el) =>
      getComputedStyle(el).left,
    );
    expect(leftVal).toBe('0px');
  });

  test('AC-1: 모바일 — 시간축 body 셀도 sticky left-0 적용', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(RESV_URL, { waitUntil: 'networkidle' });

    // 첫 번째 시간 셀 (tbody td)
    const timeCell = page.getByTestId('resv-time-col-cell').first();
    await expect(timeCell).toBeAttached();

    const position = await timeCell.evaluate((el) =>
      getComputedStyle(el).position,
    );
    expect(position).toBe('sticky');

    const leftVal = await timeCell.evaluate((el) =>
      getComputedStyle(el).left,
    );
    expect(leftVal).toBe('0px');
  });

  test('AC-2: 모바일 — 가로 스크롤 후 시간축 헤더가 뷰포트 왼쪽에 고정됨', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(RESV_URL, { waitUntil: 'networkidle' });

    // 테이블 스크롤 컨테이너
    const container = page.locator('.overflow-auto.rounded-lg.border').first();
    await expect(container).toBeVisible();

    // 200px 가로 스크롤
    await container.evaluate((el) => { el.scrollLeft = 200; });

    // 스크롤 후 시간축 헤더 x 위치가 뷰포트 왼쪽 근처 (<=50px)
    const timeColHeader = page.getByTestId('resv-time-col-header');
    const bb = await timeColHeader.boundingBox();
    if (bb) {
      expect(bb.x).toBeLessThan(50);
    }
  });

  test('AC-3: PC(1280px) — 테이블 구조 정상, 시간축 헤더 존재', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(RESV_URL, { waitUntil: 'networkidle' });

    // PC에서도 시간축 헤더가 DOM에 존재 (레이아웃 깨지지 않음)
    await expect(page.getByTestId('resv-time-col-header')).toBeAttached();
  });
});

// ── Shell-2: 태블릿 풀스크린 모달 ─────────────────────────────────────────────

test.describe('Shell-2: 태블릿 풀스크린 모달 전환 UX', () => {
  /**
   * 태블릿 뷰포트 설정: Galaxy Tab S10 Lite 기준 (~800x1280)
   * 단, window.innerWidth >= 769 이 tablet 판정 기준 (isTabletViewport 함수)
   */
  const TABLET_VIEWPORT = { width: 800, height: 1280 };

  test('AC-5/AC-6: 태블릿(800px) — 슬롯 Plus 버튼 탭 시 풀스크린 모달 열림', async ({ page }) => {
    await page.setViewportSize(TABLET_VIEWPORT);
    await page.goto(RESV_URL, { waitUntil: 'networkidle' });

    // 풀스크린 모달 초기 상태: 미표시
    await expect(page.getByTestId('tablet-fullscreen-modal')).not.toBeVisible();

    // 첫 번째 slot-plus 버튼 클릭
    const plusBtn = page.getByTestId(/^slot-plus-/).first();
    await expect(plusBtn).toBeVisible();
    await plusBtn.click();

    // 모달 열림 확인
    const modal = page.getByTestId('tablet-fullscreen-modal');
    await expect(modal).toBeVisible();

    // AC-6: 모달이 화면을 꽉 채움 (fixed inset-0)
    const bb = await modal.boundingBox();
    if (bb) {
      // fixed inset-0 → x=0, y=0, w=viewport_w, h=viewport_h
      expect(bb.x).toBeLessThanOrEqual(1);
      expect(bb.y).toBeLessThanOrEqual(1);
      expect(bb.width).toBeGreaterThan(700);
      expect(bb.height).toBeGreaterThan(1000);
    }

    // 빈 캔버스 확인
    await expect(page.getByTestId('tablet-modal-canvas')).toBeVisible();
  });

  test('AC-7: 태블릿 — 닫기 버튼 탭 → 모달 사라지고 시간표 복귀', async ({ page }) => {
    await page.setViewportSize(TABLET_VIEWPORT);
    await page.goto(RESV_URL, { waitUntil: 'networkidle' });

    // 모달 열기
    const plusBtn = page.getByTestId(/^slot-plus-/).first();
    await plusBtn.click();
    await expect(page.getByTestId('tablet-fullscreen-modal')).toBeVisible();

    // 닫기 버튼 클릭
    await page.getByTestId('tablet-modal-close').click();

    // 모달 사라짐 (300ms 애니메이션 대기)
    await expect(page.getByTestId('tablet-fullscreen-modal')).not.toBeVisible({ timeout: 1000 });
  });

  test('AC-8: 태블릿 — 모달에 CSS transition-transform 속성 존재 (애니메이션)', async ({ page }) => {
    await page.setViewportSize(TABLET_VIEWPORT);
    await page.goto(RESV_URL, { waitUntil: 'networkidle' });

    const plusBtn = page.getByTestId(/^slot-plus-/).first();
    await plusBtn.click();

    const modal = page.getByTestId('tablet-fullscreen-modal');
    await expect(modal).toBeVisible();

    // transition-transform duration-300 클래스가 적용되었는지 확인
    const hasTransition = await modal.evaluate((el) => {
      const transition = getComputedStyle(el).transition;
      return transition.includes('transform');
    });
    expect(hasTransition).toBe(true);
  });

  test('AC-5/AC-7: 태블릿 — 모달 열기/닫기 반복 시 정상 동작', async ({ page }) => {
    await page.setViewportSize(TABLET_VIEWPORT);
    await page.goto(RESV_URL, { waitUntil: 'networkidle' });

    const plusBtn = page.getByTestId(/^slot-plus-/).first();

    // 3회 반복
    for (let i = 0; i < 3; i++) {
      await plusBtn.click();
      await expect(page.getByTestId('tablet-fullscreen-modal')).toBeVisible();
      await page.getByTestId('tablet-modal-close').click();
      await expect(page.getByTestId('tablet-fullscreen-modal')).not.toBeVisible({ timeout: 1000 });
    }
  });

  test('AC-5: 모바일(390px) — 슬롯 탭 시 풀스크린 모달 안 열리고 일반 다이얼로그', async ({ page }) => {
    // 모바일에서는 tabletModal이 트리거되지 않아야 함 (isTabletViewport = false)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(RESV_URL, { waitUntil: 'networkidle' });

    const plusBtn = page.getByTestId(/^slot-plus-/).first();
    await plusBtn.click();

    // 풀스크린 모달 미표시 확인
    await expect(page.getByTestId('tablet-fullscreen-modal')).not.toBeVisible();
  });
});

// ── Shell-3: 엣지 케이스 ─────────────────────────────────────────────────────

test.describe('Shell 엣지 케이스', () => {
  test('태블릿 가로 모드(1280x800) — 시간축 sticky + 풀스크린 모달 정상', async ({ page }) => {
    // 태블릿 가로 모드
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(RESV_URL, { waitUntil: 'networkidle' });

    // 시간축 sticky 유지
    const timeColHeader = page.getByTestId('resv-time-col-header');
    await expect(timeColHeader).toBeAttached();
    const pos = await timeColHeader.evaluate((el) => getComputedStyle(el).position);
    expect(pos).toBe('sticky');

    // 풀스크린 모달 트리거 가능
    const plusBtn = page.getByTestId(/^slot-plus-/).first();
    await plusBtn.click();
    await expect(page.getByTestId('tablet-fullscreen-modal')).toBeVisible();

    // 닫기
    await page.getByTestId('tablet-modal-close').click();
    await expect(page.getByTestId('tablet-fullscreen-modal')).not.toBeVisible({ timeout: 1000 });
  });
});
