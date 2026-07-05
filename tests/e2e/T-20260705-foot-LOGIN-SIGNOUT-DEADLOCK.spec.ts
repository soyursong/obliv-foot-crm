/**
 * T-20260705-foot-LOGIN-SIGNOUT-DEADLOCK — Login.tsx raw signOut() 데드락 치환 검증
 *
 * 배경: dev-women cross-CRM 감사(T-20260705-women-LOGIN-SIGNOUT-DEADLOCK-AUDIT, AC-2/AC-3)에서
 *   foot Login.tsx:39 가 women 과 **바이트-동일** 미승인 사용자 로그인 거부 경로에서
 *   raw supabase.auth.signOut() 을 직접 호출함이 확정 발견 → 본 후속 티켓으로 분기(도메인 격리).
 *
 *   foot auth.tsx 는 women 과 동일 fork — SIGNED_OUT 핸들러가 refreshSession() 재호출 +
 *   explicitSignOutRef 기전 보유. raw signOut() 은 explicitSignOutRef 를 세팅하지 않아
 *   AuthProvider(src/lib/auth.tsx) SIGNED_OUT 핸들러의 refreshSession 재호출과 supabase-js
 *   내부 락에서 데드락 → signOut await 영구 hang → 후속 setError/setLoading 미실행 →
 *   미승인 사용자 로그인 거부 화면 영구 정지(폼 재활성 실패).
 *
 * AC-1 수정(women 20538d8a 완치법 이식): Login 이 wrapped signOut()(useAuth, explicitSignOutRef
 *   경유로 refreshSession 디바운스 skip) 사용 + 이중 방어 타임아웃 가드(Promise.race 2s)로
 *   거부 UX 복귀 보장.
 * AC-3: auth.tsx AuthProvider 내부 signOut callback(canonical wrapper)은 정상 — 손대지 않음.
 *
 * 주의: 로컬 하니스는 '내부 락 데드락' 자체는 결정론적으로 재현되지 않음.
 *   → 본 spec 은 **관측 가능한 거부-경로 계약**(미승인 로그인 → 에러 안내 + 폼 재활성)과
 *     **타임아웃 가드 방어**(signOut 이 hang 해도 거부 안내·폼 복귀)를 회귀 가드한다.
 *     + 시나리오2(정상 로그인 회귀 가드): 승인 계정 → /admin 도달(치환이 정상 경로에 회귀 없음).
 *
 * 티켓: T-20260705-foot-LOGIN-SIGNOUT-DEADLOCK
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

const AUTH_USER = {
  id: '00000000-0000-4000-8000-0000000000aa',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'qa.login@example.com',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: '2026-07-05T00:00:00.000Z',
  updated_at: '2026-07-05T00:00:00.000Z',
};

function sessionBody() {
  return JSON.stringify({
    access_token: 'dummy-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 4102444800, // 2100년 — 만료/자동갱신 없이 세션 유지
    refresh_token: 'dummy-refresh-token',
    user: AUTH_USER,
  });
}

/**
 * 공통 목: signInWithPassword(token) 성공 + user_profiles 조회 결과 주입 + logout 응답.
 *  - profile: 미승인 거부(approved=false) / 정상(approved=true) 분기.
 *  - logoutDelayMs: signOut hang 재현(타임아웃 가드 검증).
 */
async function mockAuth(
  page: import('@playwright/test').Page,
  opts: { profile: Record<string, unknown>; logoutDelayMs?: number },
) {
  // signInWithPassword → POST /auth/v1/token?grant_type=password → 세션 반환
  await page.route('**/auth/v1/token**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: sessionBody() }),
  );
  // user_profiles 조회(maybeSingle) → 단일 객체 반환(approved/role)
  await page.route('**/rest/v1/user_profiles**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(opts.profile),
    }),
  );
  // 그 외 REST 소음 차단
  await page.route('**/rest/v1/**', (route) => {
    if (route.request().url().includes('/user_profiles')) return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  // signOut → POST /auth/v1/logout → 204 (옵션: 지연으로 hang 재현)
  await page.route('**/auth/v1/logout**', async (route) => {
    if (opts.logoutDelayMs) await new Promise((r) => setTimeout(r, opts.logoutDelayMs));
    await route.fulfill({ status: 204, body: '' });
  });
}

async function submitLogin(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.locator('#email').fill(AUTH_USER.email);
  await page.locator('#password').fill('whatever-pw');
  await page.locator('button[type="submit"]').click();
}

// ── 시나리오 1: 미승인 사용자 로그인 거부 → 영구 hang 없이 에러 안내 + 폼 재활성 ──
test('시나리오1: 미승인 사용자 로그인 거부 → 에러 안내 + 폼 재활성(영구 hang 없음)', async ({ page }) => {
  await mockAuth(page, { profile: { approved: false, role: 'staff' } });
  await submitLogin(page);

  // ★ 핵심: 거부 경로가 hang 하지 않고 에러 안내 표시(데드락이면 여기서 영원히 멈춤 → 타임아웃 실패)
  await expect(page.getByText('관리자 승인 대기 중입니다')).toBeVisible({ timeout: 8000 });

  // 폼이 다시 입력 가능 상태로 복귀(버튼 disabled 잔존 없음 = setLoading(false) 도달)
  const submitBtn = page.locator('button[type="submit"]');
  await expect(submitBtn).toBeEnabled();
  // 로그인 화면에 잔류(관리자 화면으로 진입하지 않음)
  await expect(page).toHaveURL(/\/login/);
});

// ── 시나리오 1(방어): signOut 이 hang 해도 2s 타임아웃 가드로 거부 안내·폼 복귀 ──
// logout 응답을 20s 지연시켜 signOut await 를 사실상 hang 상태로 만든 뒤,
// Login 의 Promise.race(2s) 가드가 거부 UX 복귀를 보장하는지 검증.
test('시나리오1(방어): signOut hang 시에도 2s 타임아웃 가드로 거부 안내 도달', async ({ page }) => {
  await mockAuth(page, { profile: { approved: false, role: 'staff' }, logoutDelayMs: 20000 });
  await submitLogin(page);

  // logout 이 20s 걸려도 2s 가드로 거부 안내 진행 → 8s 내 표시 + 폼 재활성
  await expect(page.getByText('관리자 승인 대기 중입니다')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('button[type="submit"]')).toBeEnabled();
});

// ── 시나리오 2: 정상 사용자 로그인(회귀 가드) → /admin 도달 ──
// signOut 치환이 정상 로그인 경로(승인 계정)에 회귀를 유발하지 않음을 확인.
test('시나리오2: 승인된 관리자 계정 로그인 → /admin 도달 (정상 경로 회귀 가드)', async ({ page }) => {
  await mockAuth(page, { profile: { approved: true, role: 'admin' } });
  await submitLogin(page);

  // 거부 경로를 타지 않고 /admin 으로 정상 진입
  await page.waitForURL(/\/admin/, { timeout: 8000 });
  await expect(page.getByText('관리자 승인 대기 중입니다')).toHaveCount(0);
});
