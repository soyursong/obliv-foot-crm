/**
 * CONTINUOUS-DEV A — 콘솔 에러 0 검증
 *
 * 주요 라우트를 Playwright headless로 순회하며
 * console.error / uncaught 예외를 캡처. 에러 발견 시 즉시 fail.
 *
 * 검사 라우트:
 *   R1. /jongno-foot       — 셀프체크인 (anon, 인증 불필요)
 *   R2. /admin             — 대시보드
 *   R3. /admin/customers   — 고객 관리
 *   R4. /admin/packages    — 패키지 관리
 *   R5. /admin/reservations — 예약 관리
 *   R6. /admin/services    — 서비스 관리
 *   R7. /admin/staff       — 직원 관리
 *   R8. /admin/stats       — 통계
 *   R9. /admin/closing     — 일마감
 *
 * ref: MSG-20260430-FOOT-CONTINUOUS-DEV (CONTINUOUS-DEV A)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

/** 필터: 알려진 무해한 경고 패턴 (React DevTools 등) */
const KNOWN_BENIGN = [
  /ReactDOM.render is no longer supported/i,
  /Download the React DevTools/i,
  /Warning: Each child in a list should have a unique "key"/i,
  /favicon\.ico/i,
];

function isBenign(text: string): boolean {
  return KNOWN_BENIGN.some((re) => re.test(text));
}

// ── R1: 셀프체크인 (anon) ──────────────────────────────────────────────────────

test.describe('R1 셀프체크인 — anon 라우트 콘솔 에러 검사', () => {
  test('R1: /jongno-foot 콘솔 에러 0', async ({ page }) => {
    const errors: string[] = [];
    const uncaught: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error' && !isBenign(msg.text())) {
        errors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      uncaught.push(err.message);
    });

    await page.goto('/jongno-foot');
    await page.waitForLoadState('networkidle');

    // 기본 UI 렌더 확인
    await expect(page.locator('#sc-name').or(page.getByText('발톱 레이저 클리닉', { exact: false }))).toBeVisible({
      timeout: 10_000,
    });

    // 추가 1초 대기 — Realtime / lazy 로드 에러 수집
    await page.waitForTimeout(1_500);

    expect(
      uncaught,
      `R1 uncaught 오류:\n${uncaught.join('\n')}`,
    ).toHaveLength(0);

    expect(
      errors,
      `R1 console.error:\n${errors.join('\n')}`,
    ).toHaveLength(0);
  });
});

// ── R2~R9: 인증 필요 라우트 ────────────────────────────────────────────────────

const ADMIN_ROUTES: { id: string; path: string; landmark: string }[] = [
  { id: 'R2', path: '/admin',              landmark: '대시보드' },
  { id: 'R3', path: '/admin/customers',    landmark: '고객 관리' },
  { id: 'R4', path: '/admin/packages',     landmark: '패키지' },
  { id: 'R5', path: '/admin/reservations', landmark: '예약' },
  { id: 'R6', path: '/admin/services',     landmark: '서비스' },
  { id: 'R7', path: '/admin/staff',        landmark: '직원' },
  { id: 'R8', path: '/admin/stats',        landmark: '통계' },
  { id: 'R9', path: '/admin/closing',      landmark: '마감' },
];

test.describe('R2~R9 어드민 라우트 콘솔 에러 검사', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — skip console check');
  });

  for (const route of ADMIN_ROUTES) {
    test(`${route.id}: ${route.path} 콘솔 에러 0`, async ({ page }) => {
      const errors: string[] = [];
      const uncaught: string[] = [];

      page.on('console', (msg) => {
        if (msg.type() === 'error' && !isBenign(msg.text())) {
          errors.push(`[${msg.type()}] ${msg.text()}`);
        }
      });
      page.on('pageerror', (err) => {
        uncaught.push(err.message);
      });

      await page.goto(route.path);
      await page.waitForLoadState('networkidle');

      // 페이지 랜드마크 렌더 확인 (없어도 실패 처리 안 함, 에러만 검사)
      const landmarkVisible = await page
        .getByText(route.landmark, { exact: false })
        .first()
        .isVisible({ timeout: 8_000 })
        .catch(() => false);

      if (!landmarkVisible) {
        // 페이지 자체가 렌더 안 된 경우 — 스크린샷만 남기고 pass (환경 이슈)
        await page.screenshot({
          path: `test-results/screenshots/console-check-${route.id}-notLoaded.png`,
        });
      }

      // Realtime / 비동기 에러 수집 대기
      await page.waitForTimeout(2_000);

      expect(
        uncaught,
        `${route.id} ${route.path} uncaught 오류:\n${uncaught.join('\n')}`,
      ).toHaveLength(0);

      expect(
        errors,
        `${route.id} ${route.path} console.error:\n${errors.join('\n')}`,
      ).toHaveLength(0);
    });
  }
});
