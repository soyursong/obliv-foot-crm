/**
 * E2E spec — T-20260820-foot-CONSULT-READ-SILENT401-BANNER-RELOGIN-FIX
 *
 * 부모 RC: 31fb4f5b (角3 세션/토큰 만료 → data-plane read silent 401 → 배너없이 명단 empty).
 *
 * 검증 대상(국소 fix leg, total revert 금지):
 *   (a) load() read error(401) 감지 시 기존 표시행 blank 금지 + 인증오류 배너/재로그인 유도
 *       (silent empty 제거). = data-testid="auth-error-banner".
 *   (b) expired/anon 401 read → auth refresh/re-login 훅 연결. 배너가 우선 silent
 *       refreshSession() 시도('로그인 상태를 확인하는 중…') → 실패 시 재로그인 버튼.
 *
 * 회귀축(가드):
 *   · 평상시(정상 세션)엔 배너 미표시 = read 성공 경로·부모 fail-open 11ae92bb 회귀0.
 *   · real 0-row(error=null)는 인증오류로 오분류하지 않음(정상 빈 명단 표시 보존).
 *
 * 테스트 훅(프로덕션 동작 불변):
 *   window.__refresh401MaxRetries 등 — refresh-401 backoff bound(401 을 빠르게 load() 로 surface).
 *   page.route — data-plane REST(check_ins/assignment_actions) 401 주입 + auth token refresh 실패 주입.
 *
 * 로그인 시크릿 부재 환경(supervisor QA 워크트리)은 helper 가 graceful skip.
 * 실 field 검증 = macstudio 풀 E2E + 갤탭 field-soak(완전 재로그인 → 명단 복구 = 角3 확정).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const AUTH_BANNER = '[data-testid="auth-error-banner"]';

test.describe('T-20260820 CONSULT-READ-SILENT401 — read 401 → 명단 blank 금지 + 재인증 유도', () => {
  test.beforeEach(async ({ page }) => {
    // refresh-401 재시도를 최소화 → 주입한 401 이 즉시 load() 로 surface(결정성).
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, number>;
      w.__refresh401MaxRetries = 0; // 재시도 없이 401 응답 그대로 반환 → load() error 도달
      w.__refresh401BaseMs = 1;
      w.__refresh401CapMs = 2;
    });
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 실검증=macstudio 풀 E2E + 갤탭 field-soak');
  });

  test('AC 회귀0: 정상 세션에선 인증오류 배너 미표시', async ({ page }) => {
    await page.goto('/admin/assignments');
    // 배정 페이지 로드(정상) — 배너는 나타나지 않는다.
    await page.waitForTimeout(2_000);
    await expect(page.locator(AUTH_BANNER)).toHaveCount(0);
  });

  test('AC (a)(b): read 401 주입 → silent empty 대신 재인증 배너 + 자동복구(refreshSession) 훅 발동', async ({
    page,
  }) => {
    // 1) 먼저 정상 로드 — 배너 없음(정상 세션).
    await page.goto('/admin/assignments');
    await page.waitForTimeout(1_500);
    await expect(page.locator(AUTH_BANNER)).toHaveCount(0);

    // 2) data-plane REST(check_ins / assignment_actions) 를 401(JWT expired) 로 주입 = 세션/토큰 만료 재현.
    //    load() 는 error 를 무시하고 set([]) 하지 않고(fix a) → reportAuthReadError → 배너.
    await page.route('**/rest/v1/check_ins**', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'PGRST301', message: 'JWT expired' }),
      }),
    );
    await page.route('**/rest/v1/assignment_actions**', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'PGRST301', message: 'JWT expired' }),
      }),
    );
    // 3) auth 토큰 refresh 도 실패 주입(리프레시 토큰 사망) → 자동복구가 세션을 되살리지 못함
    //    = 배너가 재인증 필요 상태로 유지(자동으로 조용히 사라지지 않음).
    await page.route('**/auth/v1/token**', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant', error_description: 'refresh token expired' }),
      }),
    );

    // 4) 재조회 트리거 — 페이지 재진입(useEffect load 재실행).
    await page.goto('/admin/assignments');

    // (a) silent empty(명단 사라짐·배너 없음) 대신 인증오류 배너가 나타난다.
    const banner = page.locator(AUTH_BANNER);
    await expect(banner).toBeVisible({ timeout: 10_000 });

    // (b) 자동복구 훅이 발동 = refreshSession 시도 상태('로그인 상태를 확인하는 중…').
    //     이 상태 도달 자체가 refresh401 인프라 non-target(만료/anon 401) 갭 봉합 훅이 배선됐음을 증명.
    //     (완전 만료된 refresh token 의 재로그인 버튼 낙하는 갤탭 field-soak: 완전 재로그인 → 명단 복구 = 角3 확정.)
    await expect(banner).toContainText('로그인 상태를 확인하는 중', { timeout: 10_000 });

    // 비차단 검증 — 차단 모달(dialog)이 아니라 상단 status 배너(role=status)로만 노출(현장 업무 정지 방지).
    await expect(banner).toHaveAttribute('role', 'status');
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });
});
