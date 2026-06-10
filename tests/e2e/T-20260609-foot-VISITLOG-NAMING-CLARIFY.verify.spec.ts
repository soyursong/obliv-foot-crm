/**
 * T-20260609-foot-VISITLOG-NAMING-CLARIFY — [QA 검증 전용] '방문이력' 라벨 라이브 노출 확인
 *
 * 배경(QA 블로커 해소):
 *   supervisor QA가 prod deep-link URL 진입 시 ProtectedRoute → /login 리다이렉트로
 *   '방문이력' 노출을 확인하지 못함(인증 미보유). 이 spec은 그 "QA 전용 검증 경로"를
 *   자동화한 것 — Supabase SDK로 QA 테스트 계정 로그인 → 세션을 대상 origin localStorage에
 *   주입 → deep-link(?medchart=visit_hist) 진입 → 진료차트 패널 자동 오픈 → '방문이력' 탭
 *   라벨 visible 단언. 머지차단 게이트 아님(*.verify.spec.ts, dependencies/storageState 불요).
 *
 * 대상(기본 prod, env로 override):
 *   VERIFY_BASE_URL  (기본 https://obliv-foot-crm.vercel.app)
 *   VERIFY_CUSTOMER_ID (기본 5bc95429-aae4-40b3-98d4-91a42535c393 = prod 실존 고객 F-1485)
 *   TEST_EMAIL / TEST_PASSWORD (기본 test@medibuilder.com / TestPass2026! — auth.setup과 동일)
 *   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (.env 로드)
 *
 * 실행:
 *   # prod 배포본 직접 검증 (dev 서버 불요)
 *   npx playwright test tests/e2e/T-20260609-foot-VISITLOG-NAMING-CLARIFY.verify.spec.ts \
 *     --project=desktop-chrome
 *   # (storageState 의존 회피를 위해 이 spec은 자체 로그인하므로 setup 산출물 없어도 동작)
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// storageState(setup 산출물)에 의존하지 않고 매 실행 자체 로그인한다.
test.use({ storageState: { cookies: [], origins: [] } });

const BASE_URL = process.env.VERIFY_BASE_URL ?? 'https://obliv-foot-crm.vercel.app';
const CUSTOMER_ID =
  process.env.VERIFY_CUSTOMER_ID ?? '5bc95429-aae4-40b3-98d4-91a42535c393';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const TEST_EMAIL = process.env.TEST_EMAIL ?? process.env.TEST_USER_EMAIL ?? 'test@medibuilder.com';
const TEST_PASSWORD =
  process.env.TEST_PASSWORD ?? process.env.TEST_USER_PASSWORD ?? 'TestPass2026!';

test.describe('VISITLOG-NAMING-CLARIFY · prod 라이브 "방문이력" 노출 (QA 검증 경로)', () => {
  test('QA 세션 로그인 → deep-link 자동오픈 → 우측 탭 "방문이력" 노출', async ({ page }) => {
    test.skip(
      !SUPABASE_URL || !SUPABASE_ANON_KEY,
      'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 .env 에 없음 — QA 세션 발급 불가',
    );

    // 1) Supabase SDK 직접 로그인 → access/refresh token 획득 (UI 로그인 rate-limit 회피)
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    expect(error, `QA 계정 로그인 실패: ${error?.message ?? ''}`).toBeNull();
    expect(data.session, 'QA 세션 미발급').toBeTruthy();
    const session = data.session!;

    // 2) 대상 origin 으로 진입 후 Supabase JS 세션을 localStorage 에 주입
    //    키 형식: sb-{ref}-auth-token
    const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
    const storageKey = `sb-${ref}-auth-token`;
    const sessionPayload = JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      expires_at: session.expires_at,
      token_type: session.token_type,
      user: session.user,
    });

    // /login 진입(공개 라우트) → localStorage 주입
    await page.goto(`${BASE_URL}/login`);
    await page.evaluate(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: storageKey, value: sessionPayload },
    );

    // 3) deep-link 진입 — 진료차트 패널 자동 오픈 + visit_hist 탭 선택 배선(bd36a3b)
    await page.goto(`${BASE_URL}/chart/${CUSTOMER_ID}?medchart=visit_hist`);

    // 로그인 페이지로 다시 튕기면 세션 주입 실패 — 즉시 진단
    await page.waitForTimeout(1500);
    expect(
      page.url().includes('/login'),
      'QA 세션 주입 후에도 /login 리다이렉트 — 계정 미승인/만료 의심',
    ).toBe(false);

    // 4) 진료차트 패널(Drawer) 자동 오픈 대기
    await expect(page.getByTestId('medical-chart-drawer')).toBeVisible({ timeout: 20_000 });

    // 5) 우측 '방문이력' 탭 라벨 노출 + 선택 단언
    const visitTab = page.getByTestId('right-panel-tab-visit_hist');
    await expect(visitTab).toBeVisible({ timeout: 10_000 });
    await expect(visitTab).toContainText('방문이력');

    // 증거 스크린샷
    await page.screenshot({
      path: 'test-results/VISITLOG-NAMING-CLARIFY-visit-history-label.png',
      fullPage: false,
    });

    console.log(
      `[VISITLOG-VERIFY] base=${BASE_URL} customer=${CUSTOMER_ID} → '방문이력' 탭 visible 확인`,
    );
  });
});
