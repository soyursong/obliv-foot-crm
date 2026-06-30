/**
 * E2E spec — T-20260630-foot-RESV-LEFTPANEL-SCROLL-CLIP
 *
 * 예약관리 좌측 사이드 패널(달력 + 근무캘린더 + 인수인계 + 공지사항)에 패널 내부 단일
 * 스크롤(overflow-y-auto)을 적용해, 인수인계 항목이 많아 패널 높이를 넘어도 하단까지
 * 스크롤로 전부 도달(클리핑 해소)한다.
 *
 * 현장 시나리오: 예약관리 진입 → 좌측 패널 펼침 → 패널 내부를 아래로 스크롤하면
 *   근무캘린더/인수인계 하단·공지사항까지 모두 확인 가능.
 *
 * AC1: 좌측 패널 컨테이너에 단일 스크롤 영역(overflow-y: auto) + 높이 제약(flex-1 min-h-0).
 * AC2: 패널 하단(공지사항)까지 스크롤로 도달(인수인계 多 시 하단 클리핑 해소).
 * AC3: 데이터·조회 로직 무변경 — 근무캘린더/인수인계 섹션 정상 렌더(순수 레이아웃).
 * AC4: overflow-y-auto → 콘텐츠 짧으면 스크롤바 미생성(불필요 스크롤 X) + 중앙(일간그리드) 무회귀.
 *
 * 검증 방식: 실브라우저(desktop-chrome, 1280px).
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

test.describe('T-20260630-foot-RESV-LEFTPANEL-SCROLL-CLIP — 좌측 패널 스크롤 클리핑 해소', () => {
  test('AC1: 좌측 패널에 단일 스크롤 영역(overflow-y:auto) 존재', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin/reservations', { waitUntil: 'networkidle' });

    // 예약관리 진입 시 패널 펼침(접힘 바 미노출)
    await expect(page.getByTestId('pc-cal-bar')).toHaveCount(0);

    const scrollArea = page.getByTestId('panel-scroll-area');
    await expect(scrollArea).toBeVisible();

    // overflow-y === 'auto' (scroll/hidden 아님 → 짧을 때 스크롤바 없음, AC4)
    const overflowY = await scrollArea.evaluate(
      (el) => getComputedStyle(el).overflowY,
    );
    expect(overflowY).toBe('auto');
  });

  test('AC2: 인수인계/공지사항 섹션이 스크롤 영역 안에 있고 하단까지 스크롤로 도달', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin/reservations', { waitUntil: 'networkidle' });

    const scrollArea = page.getByTestId('panel-scroll-area');
    await expect(scrollArea).toBeVisible();

    // 근무캘린더/인수인계 섹션은 스크롤 영역 자손이어야 함(클리핑 대상이 스크롤로 흡수됨)
    const handover = page.getByTestId('duty-roster-handover');
    await expect(handover).toHaveCount(1);
    const handoverInside = await scrollArea.evaluate(
      (el, sel) => !!el.querySelector(sel),
      '[data-testid="duty-roster-handover"]',
    );
    expect(handoverInside).toBe(true);

    // 패널 최하단(공지사항)까지 스크롤 → 클리핑 없이 노출
    await scrollArea.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const notice = page.getByText('공지사항', { exact: true }).first();
    await notice.scrollIntoViewIfNeeded();
    await expect(notice).toBeVisible();
  });

  test('AC3: 근무캘린더/인수인계 조회 정상(데이터 로직 무변경)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin/reservations', { waitUntil: 'networkidle' });

    // 근무캘린더 섹션 렌더
    await expect(page.getByTestId('duty-roster-section')).toBeVisible();
    // 인수인계 섹션 렌더(목록/빈상태/로딩 중 하나는 존재 → 조회 동선 무회귀)
    await expect(page.getByTestId('duty-roster-handover')).toBeVisible();
    const handoverStates = page
      .getByTestId('handover-list')
      .or(page.getByTestId('handover-empty'))
      .or(page.getByTestId('handover-loading'));
    await expect(handoverStates.first()).toBeVisible();
  });

  test('AC4: 중앙 일간 그리드 무회귀(스크롤 변경이 본문에 영향 없음)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE + '/admin/reservations', { waitUntil: 'networkidle' });
    // 예약관리 본문(일간 가로 그리드) 정상 렌더
    await expect(page.getByTestId('resv-day-horizontal')).toBeVisible();
  });
});
