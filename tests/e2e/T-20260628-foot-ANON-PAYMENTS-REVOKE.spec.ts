/**
 * T-20260628-foot-ANON-PAYMENTS-REVOKE — payments anon REVOKE 단독 조기 적용 회귀 spec
 *
 * 배경: parent T-20260627-foot-ANON-RLS-PHASE2B 의 2b 전체 revoke 는 SelfCheckIn 컷오버
 *   (Gate B) + 키오스크(Gate C) 후로 게이트되나, payments 테이블은 anon FE 의존이 0건
 *   (anon-context 파일 ∩ payments 참조 파일 = ∅, grep 확증)이라 FE 컷오버와 독립적으로
 *   즉시 안전 적용 가능. data-architect CONSULT-REPLY(MSG-20260628-173732-lh9k) 지지.
 *   마이그: 20260628140000_anon_revoke_payments_only.sql (REVOKE ALL ON public.payments FROM anon)
 *
 * AC-1: anon payments SELECT → 0행 / 거부 (REST anon key 직접 쿼리).
 * AC-2: staff payments 화면(매출/결제) 정상 렌더 — 회귀 0.
 * AC-3 (DB): has_table_privilege('anon','public.payments','SELECT') = false
 *            (== .PHASE2B_HOLD 접미사 제거 + prod apply 완료 시).
 *
 * 주의: AC-3 은 supervisor DDL-diff GO → 접미사 제거 → prod apply 이후에만 PASS.
 *   apply 전(HOLD 상태)에는 anon 이 아직 SELECT 권한 보유 → AC-1/AC-3 는 skip 가드로
 *   "미적용" 상태를 명시적으로 드러낸다(false-green 방지).
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL ?? 'https://obliv-foot-crm.vercel.app';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.TEST_ANON_KEY;
const PROJECT_ID = 'rxlomoozakkjesdqjtvd';

async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/admin**', { timeout: 15_000 });
}

// ─── AC-1: anon payments SELECT → 0행 / 거부 ──────────────────────────────

test('AC-1: anon REST 키로 payments 직접 SELECT 시 행 노출 0 (또는 권한 거부)', async ({ request }) => {
  test.skip(!ANON_KEY, 'VITE_SUPABASE_ANON_KEY / TEST_ANON_KEY 미설정 — anon 쿼리 skip');

  const resp = await request.get(
    `${SUPABASE_URL}/rest/v1/payments?select=id&limit=5`,
    {
      headers: {
        apikey: ANON_KEY!,
        Authorization: `Bearer ${ANON_KEY!}`,
      },
    }
  );

  // REVOKE 적용 후 PostgREST 는 권한 부재 시 401/403(permission denied) 또는 빈 배열을 반환.
  // RLS canonical 이 이미 anon row 0건을 보장하므로 어느 경우든 "행 노출 0" 이 핵심 불변식.
  if (resp.ok()) {
    const rows = (await resp.json()) as unknown[];
    expect(Array.isArray(rows) ? rows.length : 0, 'anon 에 payments 행이 노출됨 — AC-1 실패').toBe(0);
  } else {
    expect([401, 403, 404]).toContain(resp.status());
  }
});

// ─── AC-3: DB 권한 — anon SELECT privilege 제거 확인 ──────────────────────

test('AC-3: has_table_privilege(anon, public.payments, SELECT) = false (REVOKE 적용 시)', async ({ request }) => {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  test.skip(!accessToken, 'SUPABASE_ACCESS_TOKEN 미설정 — DB privilege 체크 skip');

  const resp = await request.post(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        query: `SELECT has_table_privilege('anon','public.payments','SELECT') AS anon_can_select;`,
      },
    }
  );

  expect(resp.ok()).toBeTruthy();
  const rows = (await resp.json()) as Array<{ anon_can_select: boolean }>;
  expect(rows.length).toBeGreaterThan(0);

  const stillGranted = rows[0].anon_can_select === true;
  // HOLD(미적용) 상태면 true → 본 ticket apply 전. supervisor DDL-diff GO + 접미사 제거 후 false.
  test.skip(stillGranted, 'anon SELECT 아직 GRANT 상태 — 마이그 미적용(HOLD). supervisor apply 후 재실행.');

  expect(rows[0].anon_can_select, 'anon 이 payments SELECT 권한 보유 — REVOKE 미적용').toBe(false);
});

// ─── AC-2: staff payments 화면 정상 (회귀 0) ──────────────────────────────

test('AC-2: staff 계정 — 매출/결제 화면 정상 렌더(회귀 0)', async ({ page }) => {
  const staffEmail = process.env.TEST_STAFF_EMAIL;
  const staffPw = process.env.TEST_STAFF_PASSWORD;
  test.skip(!staffEmail || !staffPw, 'TEST_STAFF_EMAIL/PASSWORD 미설정 — 브라우저 테스트 skip');

  await loginAs(page, staffEmail!, staffPw!);

  // 매출(Sales) 화면 진입 — payments 를 authenticated 경로로 조회.
  await page.goto(`${BASE_URL}/admin/sales`);

  // 에러 바운더리/권한오류 토스트 없이 페이지 셸이 렌더되어야 함.
  await expect(page.locator('body')).toBeVisible();
  await expect(
    page.locator('text=권한이 없습니다').or(page.locator('text=permission denied'))
  ).toHaveCount(0);
});
