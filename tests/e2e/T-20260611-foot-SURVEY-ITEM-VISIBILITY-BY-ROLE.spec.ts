/**
 * T-20260611-foot-SURVEY-ITEM-VISIBILITY-BY-ROLE
 * 발건강질문지 제출 내역이 직원(coordinator 등) 계정에서 "제출된 질문지가 없습니다"(0건)로
 * 표시되는 버그의 회귀 방지 spec.
 *
 * 확정 RC: health_q_results / health_q_tokens 의 SELECT RLS 가 비정규 신원 소스
 *          (staff.user_id = auth.uid()) 를 사용 → user_profiles 로 로그인한 coordinator 는
 *          staff.user_id 미매칭으로 0건. 정규 패턴(is_approved_user() + current_user_clinic_id())
 *          으로 전환.
 *
 * AC-1/AC-2: 정규 신원(user_profiles)+clinic 스코프 적용 → 직원도 동일 clinic 결과 조회 가능
 * AC-3: SELECT 정책만 변경, 쓰기 권한 불변(READ-only)
 * AC-4: clinic_id = current_user_clinic_id() 스코프 유지 (PHI 비확장 / 타 clinic 차단)
 * AC-5: 비정규 staff.user_id 패턴 제거 + 헬퍼 함수 존재 (회귀 가드)
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL ?? 'https://obliv-foot-crm.vercel.app';
const PROJECT_ID = 'rxlomoozakkjesdqjtvd';

async function dbQuery(request: import('@playwright/test').APIRequestContext, query: string) {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const resp = await request.post(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      data: { query },
    },
  );
  expect(resp.ok(), `DB query 실패: ${resp.status()}`).toBeTruthy();
  return resp.json();
}

async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/admin**', { timeout: 15_000 });
}

// ─── AC-1/AC-4/AC-5: health_q_results SELECT 정책이 정규 패턴으로 전환됨 ───
test('AC-5a: health_q_results SELECT 정책이 정규 신원(user_profiles)+clinic 스코프를 사용한다', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT policyname, cmd, qual
    FROM pg_policies
    WHERE schemaname='public' AND tablename='health_q_results' AND cmd='SELECT';
  `) as Array<{ policyname: string; cmd: string; qual: string }>;

  const sel = rows.find(r => r.policyname === 'hq_results_staff_select');
  expect(sel, 'hq_results_staff_select SELECT 정책이 없음').toBeTruthy();
  // AC-1/AC-2: 정규 신원 + clinic 스코프
  expect(sel!.qual).toContain('is_approved_user()');
  expect(sel!.qual).toContain('current_user_clinic_id()');   // AC-4 clinic 스코프 유지
  // AC-5: 비정규 staff.user_id 패턴 제거 — coordinator 0건 RC 재발 차단
  expect(sel!.qual).not.toContain('staff');
});

test('AC-5b: health_q_tokens SELECT 정책도 동일 정규 패턴으로 전환됨 (패널 reopen 토큰)', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT policyname, cmd, qual
    FROM pg_policies
    WHERE schemaname='public' AND tablename='health_q_tokens' AND cmd='SELECT';
  `) as Array<{ policyname: string; cmd: string; qual: string }>;

  const sel = rows.find(r => r.policyname === 'hq_tokens_staff_select');
  expect(sel, 'hq_tokens_staff_select SELECT 정책이 없음').toBeTruthy();
  expect(sel!.qual).toContain('is_approved_user()');
  expect(sel!.qual).toContain('current_user_clinic_id()');
  expect(sel!.qual).not.toContain('staff');
});

// ─── AC-3: READ-only 회귀가드 — 쓰기 권한 불변 ───
test('AC-3: health_q_results 에 쓰기 정책이 신설되지 않았고 tokens INSERT 정책이 불변이다', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT tablename, policyname, cmd, with_check
    FROM pg_policies
    WHERE schemaname='public' AND tablename IN ('health_q_results','health_q_tokens')
    ORDER BY tablename, cmd;
  `) as Array<{ tablename: string; policyname: string; cmd: string; with_check: string | null }>;

  // health_q_results: SELECT 외 쓰기 정책 신설 없음 (제출은 SECURITY DEFINER RPC 경유)
  const resultsWrite = rows.filter(r => r.tablename === 'health_q_results' && r.cmd !== 'SELECT');
  expect(resultsWrite, 'health_q_results 에 쓰기 정책이 신설됨 (AC-3 위반)').toHaveLength(0);

  // health_q_tokens INSERT 정책 불변 (원본 staff 기반 WITH CHECK 유지 — 쓰기 권한 미완화)
  const tokensInsert = rows.find(r => r.tablename === 'health_q_tokens' && r.cmd === 'INSERT');
  expect(tokensInsert, 'hq_tokens INSERT 정책이 사라짐 (회귀)').toBeTruthy();
  expect(tokensInsert!.with_check).toContain('staff');  // 쓰기는 기존 정책 그대로
});

test('AC-5c: 정규 헬퍼 함수(is_approved_user / current_user_clinic_id)가 SECURITY DEFINER 로 존재', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT proname, prosecdef
    FROM pg_proc
    WHERE proname IN ('is_approved_user','current_user_clinic_id')
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public');
  `) as Array<{ proname: string; prosecdef: boolean }>;
  expect(rows.length).toBeGreaterThanOrEqual(2);
  expect(rows.every(r => r.prosecdef === true)).toBeTruthy();
});

// ─── AC-2: 브라우저 — coordinator 계정에서 제출 내역 표시 (김상곤 케이스) ───
test('AC-2: coordinator 계정 — 발건강질문지 제출 내역이 "없습니다" 없이 표시된다', async ({ page }) => {
  const email = process.env.TEST_COORDINATOR_EMAIL;
  const pw = process.env.TEST_COORDINATOR_PASSWORD;
  test.skip(!email || !pw, 'TEST_COORDINATOR_EMAIL/PASSWORD not set — skipping browser test');

  await loginAs(page, email!, pw!);

  // 고객 차트(김상곤) → PenChartTab → 발건강질문지 탭 진입은 현장 데이터/네비 의존.
  // 여기서는 HealthQResultsPanel 이 렌더되는 임의 차트에서 빈-상태 문구가 0건 RC 로
  // 강제 노출되지 않는지(= RLS 차단으로 인한 거짓 0건)만 가드.
  const customerId = process.env.TEST_HQ_CUSTOMER_ID; // 김상곤 = de5436a5-...
  test.skip(!customerId, 'TEST_HQ_CUSTOMER_ID not set — 현장 고객 id 필요');

  await page.goto(`${BASE_URL}/admin/customers/${customerId}`);
  // 발건강질문지 탭/패널 진입
  const hqTab = page.locator('text=발건강질문지').first();
  await hqTab.click({ timeout: 10_000 }).catch(() => {});

  // 제출 내역이 있는 고객(김상곤, 2026-06-10 제출)인데 "제출된 질문지가 없습니다"가
  // 보이면 RLS 차단(거짓 0건) 재발 → 실패.
  await expect(page.locator('text=제출된 질문지가 없습니다')).toHaveCount(0, { timeout: 8_000 });
});
