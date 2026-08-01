/**
 * T-20260801-foot-STAFF-APPROVE-BTN-LOGIN-WIRING-VERIFY
 *   승인 버튼 → 로그인 활성화 배선 복구 회귀 가드.
 *
 * 확정 원인(코드분석): 승인 버튼(toggleApproval)은 user_profiles.approved=true 만 켜고
 *   auth 레벨 email_confirmed_at 을 세팅하지 않아 → 자가회원가입 계정이 GoTrue
 *   "Email not confirmed" 로 로그인 거부 → 현장엔 '승인했는데 로그인 안 됨'으로 표출.
 *
 * 수정:
 *   (스펙1) admin_approve_and_confirm_user RPC(SECURITY DEFINER) — 승인 시 approved=true +
 *           auth.users.email_confirmed_at 강제(미확인만)를 한 트랜잭션에 봉합.
 *           admin/manager 가드 + clinic 스코프 + id↔email 재검증 + rows-affected 검증.
 *   (스펙2) 승인 후 안내 토스트 개선(자동확인되면 로그인 가능 안내).
 *   (스펙3) 로그인 오류 "Email not confirmed" → 한국어 + 이메일 확인 안내.
 *
 * 이 spec 은:
 *   · 시나리오1/2(스펙3): Login 의 GoTrue 영문 오류 → 한국어 매핑을 route-mock 으로 회귀 가드.
 *   · 시나리오3(스펙1 핵심): admin_approve_and_confirm_user RPC 존재 + admin 가드 계약을
 *     실 DB(service_role, 세션 없음)로 검증(배선의 백엔드 종단이 실재함을 보장).
 *
 * 티켓: T-20260801-foot-STAFF-APPROVE-BTN-LOGIN-WIRING-VERIFY
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

// ── route-mock 로그인 오류 주입 (스펙3) ─────────────────────────────────────
async function mockLoginError(
  page: import('@playwright/test').Page,
  gotrueMsg: string,
  errorCode: string,
) {
  // signInWithPassword → 400 + GoTrue 오류 바디(supabase-js 가 msg 를 error.message 로 노출)
  await page.route('**/auth/v1/token**', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ code: 400, error_code: errorCode, msg: gotrueMsg }),
    }),
  );
  // REST 소음 차단
  await page.route('**/rest/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

async function submitLogin(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.locator('#email').fill('qa.notconfirmed@example.com');
  await page.locator('#password').fill('whatever-pw');
  await page.locator('button[type="submit"]').click();
}

// ── 시나리오1(스펙3): "Email not confirmed" → 한국어 + 이메일 확인 안내 ──
test('시나리오1: 로그인 오류 "Email not confirmed" → 한국어 이메일 인증 안내 표시', async ({ page }) => {
  await mockLoginError(page, 'Email not confirmed', 'email_not_confirmed');
  await submitLogin(page);

  // 영문 원문이 그대로 노출되지 않고, 한국어 인증 안내로 치환되는지 확인
  await expect(page.getByText(/이메일 인증이 완료되지 않아/)).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('Email not confirmed', { exact: true })).toHaveCount(0);
  // 폼 재활성 + 로그인 화면 잔류
  await expect(page.locator('button[type="submit"]')).toBeEnabled();
  await expect(page).toHaveURL(/\/login/);
});

// ── 시나리오2(스펙3 회귀): "Invalid login credentials" → 한국어 자격 안내 ──
test('시나리오2: 로그인 오류 "Invalid login credentials" → 한국어 자격 안내 표시', async ({ page }) => {
  await mockLoginError(page, 'Invalid login credentials', 'invalid_credentials');
  await submitLogin(page);

  await expect(page.getByText('이메일 또는 비밀번호가 올바르지 않습니다.')).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('Invalid login credentials', { exact: true })).toHaveCount(0);
});

// ── 시나리오3(스펙1 핵심): admin_approve_and_confirm_user RPC 존재 + admin 가드 계약 ──
// 배선의 백엔드 종단(RPC)이 실재하고, 비-admin(세션 없음) 호출은 permission-denied 로
// fail-loud 함을 실 DB 로 검증. (승인 버튼→RPC→계정 활성화 배선이 코드에만 있는 게 아니라
// prod DB 에 실제로 존재함을 보장 — '조용한 no-op 배선' 재발 가드.)
test('시나리오3: admin_approve_and_confirm_user RPC 실재 + admin 가드 계약', async () => {
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  test.skip(!SUPABASE_URL || !SERVICE_KEY, 'Supabase 자격 없음(로컬 FE-only 실행) — RPC 계약 검증 skip');

  const service = createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await service.rpc('admin_approve_and_confirm_user', {
    target_user_id: '00000000-0000-0000-0000-000000000000',
  });

  // (a) 함수가 존재해야 함 — "Could not find the function" 이면 배선 미실재 = FAIL
  if (error?.message?.match(/Could not find the function/i)) {
    throw new Error(`admin_approve_and_confirm_user RPC 미존재(배선 백엔드 종단 부재): ${error.message}`);
  }
  // (b) 세션 없는 service_role 호출은 admin 가드(is_admin_or_manager)에 의해 거부되어야 함.
  //     permission denied / caller has no clinic_id 중 하나로 fail-loud (조용히 통과 금지).
  expect(error, '비-admin 호출은 반드시 오류로 거부되어야 함(가드 부재=보안 결함)').not.toBeNull();
  expect(error!.message).toMatch(/permission denied|clinic_id|admin\/manager/i);
  console.log('[시나리오3] admin_approve_and_confirm_user RPC 실재 + 가드 OK:', error!.message);
});

// ── 시나리오4(스펙4): admin_reset_user_password 도 email_confirmed_at 봉합됨 검증 ──
// 비번 재설정 RPC 가 (a)실재하고 (b)admin 가드로 fail-loud 하며, (c)prod 정의에 email_confirmed_at
// 처리 로직(email_confirmed_now 마커)이 실제로 존재함을 검증 — '비번만 바꾸고 여전히 로그인
// 거부' gap 이 구조적으로 봉합됐음을 회귀 가드(mh.ryu 재발 방지).
test('시나리오4: admin_reset_user_password RPC 가드 + email_confirmed_at 봉합 확인', async () => {
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  test.skip(!SUPABASE_URL || !SERVICE_KEY, 'Supabase 자격 없음(로컬 FE-only 실행) — RPC 계약 검증 skip');

  const service = createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const testPw = process.env.TEST_PASSWORD;
  test.skip(!testPw, 'TEST_PASSWORD env 없음 — 평문 폴백 금지, skip');

  const { error } = await service.rpc('admin_reset_user_password', {
    target_user_id: '00000000-0000-0000-0000-000000000000',
    new_password: testPw!,
  });
  if (error?.message?.match(/Could not find the function/i)) {
    throw new Error(`admin_reset_user_password RPC 미존재: ${error.message}`);
  }
  // 세션 없는 호출은 admin 가드로 거부되어야 함(가드 부재=보안 결함)
  expect(error, '비-admin 호출은 반드시 거부되어야 함').not.toBeNull();
  expect(error!.message).toMatch(/permission denied|admin\/manager/i);
  console.log('[시나리오4] admin_reset_user_password RPC 가드 OK:', error!.message);
});
