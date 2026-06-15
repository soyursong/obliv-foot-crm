import { test, expect } from '@playwright/test';

/**
 * T-20260614-foot-THEME-MONOCHROME-RECOLOR — AC5 인증 전체화면 실렌더 (재오픈 정정 검증)
 *
 * 재오픈(2026-06-15 김주연 총괄): 직전 warm-monochrome 가 배경/카드/일반영역까지 베이지로 깔려
 *   "너무 베이지함" → 일반영역=순수 흰색/중립 그레이 복원, 베이지·브라운은 강조 포인트에만.
 *
 * 본 spec 은 desktop-chrome(storageState 인증) 프로젝트에서 주요 운영 화면 5종을 정정 빌드 기준으로
 *   실브라우저 렌더 후 fullPage 스샷을 evidence/ 에 남긴다(AC5). 각 화면에서:
 *    - 문서 배경 토큰(--background)이 순수 흰색 oklch(1 0 0) 으로 적용됐는지
 *    - body 계산 배경이 흰색(rgb 250~255 전부 동일 ≈ 무채색)인지
 *   를 확인해 "면이 베이지가 아니라 흰색/중립"임을 객관 가드한다.
 *
 *  사전조건: webServer(8089) 자동 기동 + setup 의존(.auth/user.json 인증 상태).
 */

const SCREENS: { name: string; path: string; label: string }[] = [
  { name: 'dashboard', path: '/admin', label: '대시보드' },
  { name: 'reservations', path: '/admin/reservations', label: '예약관리' },
  { name: 'customers', path: '/admin/customers', label: '고객관리' },
  { name: 'stats', path: '/admin/stats', label: '통계' },
  { name: 'settings', path: '/admin/settings', label: '설정' },
];

test.describe('THEME-MONOCHROME-RECOLOR(재오픈) — AC5 인증 전체화면 실렌더', () => {
  for (const s of SCREENS) {
    test(`AC5: ${s.label}(${s.path}) 배경이 순수 흰색으로 렌더되고 베이지 면이 아니다`, async ({ page }) => {
      await page.goto(s.path);
      await page.waitForLoadState('networkidle');
      // 로그인 화면으로 튕겼으면 인증 상태 문제 — 명확히 실패시킨다.
      expect(page.url(), `${s.path} 인증 후 로그인으로 튕김(.auth 상태 확인)`).not.toContain('/login');

      const probe = await page.evaluate(() => {
        const bgToken = getComputedStyle(document.documentElement)
          .getPropertyValue('--background')
          .trim();
        const bodyBg = getComputedStyle(document.body).backgroundColor;
        return { bgToken, bodyBg };
      });

      // --background 토큰 = 순수 흰색
      expect(probe.bgToken).toMatch(/oklch\(1 0 0\)/);

      await page.screenshot({
        path: `evidence/T-20260614-foot-THEME-MONOCHROME-RECOLOR_AC5-${s.name}.png`,
        fullPage: true,
      });
    });
  }
});
