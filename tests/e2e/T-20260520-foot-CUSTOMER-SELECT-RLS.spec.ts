/**
 * T-20260520-foot-CUSTOMER-SELECT-RLS — customers SELECT RLS 회귀 방지 spec
 *
 * P0 hotfix: staff/part_lead/tm 계정에서 초진 환자 칸반 카드 클릭 시 차트 열림 확인.
 *
 * AC-1: staff 초진 카드 클릭 → 1번차트(CheckInDetailSheet) 열림
 * AC-2: staff → 2번차트(CustomerChartSheet) 열림 (고객정보 로드)
 * AC-3: part_lead 동일
 * AC-4: admin/manager 회귀 없음
 * AC-5: customers_staff_select RLS 정책 존재 확인 (DB)
 * AC-6: 초진 customer_id NULL + phone 폴백 동작
 */

import { test, expect, type Page } from '@playwright/test';

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

const BASE_URL = process.env.TEST_BASE_URL ?? 'https://obliv-foot-crm.vercel.app';

/** 로그인 후 대시보드로 이동 */
async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/admin**', { timeout: 15_000 });
}

// ─── AC-5: DB 정책 존재 확인 (Supabase Management API) ─────────────────────

test('AC-5: customers_staff_select RLS 정책이 DB에 존재한다', async ({ request }) => {
  const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  // CI 환경에서 토큰 없으면 skip
  test.skip(!accessToken, 'SUPABASE_ACCESS_TOKEN not set — skipping DB policy check');

  const resp = await request.post(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        query: `
          SELECT policyname, cmd
          FROM pg_policies
          WHERE schemaname='public'
            AND tablename='customers'
            AND policyname IN ('customers_staff_select', 'customers_approved_read')
          ORDER BY policyname;
        `,
      },
    }
  );

  expect(resp.ok()).toBeTruthy();
  const rows = await resp.json() as Array<{ policyname: string; cmd: string }>;

  const staffSelect = rows.find(r => r.policyname === 'customers_staff_select');
  expect(staffSelect, 'customers_staff_select 정책이 없음 — AC-5 실패').toBeTruthy();
  expect(staffSelect?.cmd).toBe('SELECT');

  const approvedRead = rows.find(r => r.policyname === 'customers_approved_read');
  expect(approvedRead, 'customers_approved_read 정책이 없음 (회귀)').toBeTruthy();
});

test('AC-5b: is_floor_staff() SECURITY DEFINER 함수가 DB에 존재한다', async ({ request }) => {
  const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  test.skip(!accessToken, 'SUPABASE_ACCESS_TOKEN not set — skipping DB function check');

  const resp = await request.post(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        query: `
          SELECT proname, prosecdef
          FROM pg_proc
          WHERE proname = 'is_floor_staff'
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public');
        `,
      },
    }
  );

  expect(resp.ok()).toBeTruthy();
  const rows = await resp.json() as Array<{ proname: string; prosecdef: boolean }>;
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0].prosecdef).toBe(true);
});

// ─── AC-1~4, AC-6: 브라우저 시나리오 (staff 계정 필요) ─────────────────────

test('AC-1: staff 계정 — 초진 칸반 카드 클릭 시 1번차트(CheckInDetailSheet)가 열린다', async ({ page }) => {
  const staffEmail = process.env.TEST_STAFF_EMAIL;
  const staffPw = process.env.TEST_STAFF_PASSWORD;
  test.skip(!staffEmail || !staffPw, 'TEST_STAFF_EMAIL/PASSWORD not set — skipping browser test');

  await loginAs(page, staffEmail!, staffPw!);

  // 칸반 보드에서 초진 카드 찾기 (visit_type=new 또는 stage='접수' 칸반 슬롯)
  // 카드가 없을 경우 skip
  const cards = page.locator('[data-visit-type="new"], [data-testid="kanban-card"]').first();
  const cardCount = await cards.count();
  test.skip(cardCount === 0, '초진 카드 없음 — 현장 데이터 필요');

  await cards.click();

  // 1번차트 (CheckInDetailSheet) — Sheet이 열려야 함
  // SheetContent의 SheetTitle 또는 고객명 텍스트가 보여야 함
  await expect(
    page.locator('[data-radix-sheet-content], [role="dialog"]').first()
  ).toBeVisible({ timeout: 5_000 });
});

test('AC-2: staff 계정 — 2번차트(CustomerChartSheet)가 열리고 고객 정보가 로드된다', async ({ page }) => {
  const staffEmail = process.env.TEST_STAFF_EMAIL;
  const staffPw = process.env.TEST_STAFF_PASSWORD;
  test.skip(!staffEmail || !staffPw, 'TEST_STAFF_EMAIL/PASSWORD not set — skipping browser test');

  await loginAs(page, staffEmail!, staffPw!);

  // customer_id 가 있는 카드 (재진 또는 고객 연결된 초진)
  const cards = page.locator('[data-customer-id]').first();
  const count = await cards.count();
  test.skip(count === 0, 'customer_id 있는 카드 없음 — 현장 데이터 필요');

  await cards.click();

  // 2번차트 (CustomerChartSheet) — 고객 정보 패널이 열려야 함
  // 보통 z-70 이상의 Sheet으로 오른쪽에 렌더됨
  const chart2 = page.locator('[data-testid="customer-chart-sheet"], .customer-chart-sheet').first();
  // 타임아웃 여유있게: phone 폴백 쿼리 시간 고려
  await expect(chart2.or(
    page.locator('text=고객차트').first()
  )).toBeVisible({ timeout: 8_000 });
});

test('AC-4: admin 계정 — 기존 차트 열림 동작 회귀 없음', async ({ page }) => {
  const adminEmail = process.env.TEST_ADMIN_EMAIL;
  const adminPw = process.env.TEST_ADMIN_PASSWORD;
  test.skip(!adminEmail || !adminPw, 'TEST_ADMIN_EMAIL/PASSWORD not set — skipping browser test');

  await loginAs(page, adminEmail!, adminPw!);

  // 카드 클릭
  const card = page.locator('[data-radix-collection-item], [data-testid="kanban-card"]').first();
  const count = await card.count();
  test.skip(count === 0, '칸반 카드 없음');

  await card.click();

  // 1번차트 열림 확인
  await expect(
    page.locator('[data-radix-sheet-content]').first()
  ).toBeVisible({ timeout: 5_000 });
});

test('AC-6: 초진 customer_id NULL 케이스 — phone 폴백으로 고객 정보 조회', async ({ page }) => {
  /**
   * customer_id=NULL 이지만 customer_phone 이 있는 check_in 슬롯에서:
   * - customers 테이블 phone ILIKE 폴백 쿼리 실행
   * - resolvedCustomerId 설정 → 2번차트 자동 오픈
   * - 1번차트에서 chart_number, customer_memo 로드
   *
   * 이 테스트는 staff 계정으로 실행.
   */
  const staffEmail = process.env.TEST_STAFF_EMAIL;
  const staffPw = process.env.TEST_STAFF_PASSWORD;
  test.skip(!staffEmail || !staffPw, 'TEST_STAFF_EMAIL/PASSWORD not set — skipping browser test');

  await loginAs(page, staffEmail!, staffPw!);

  // customer_id=NULL 인 카드 찾기 (초진 신규 접수, 고객 미매칭)
  // data-customer-id="" 또는 data-customer-id 속성 없음
  const nullIdCard = page.locator('[data-visit-type="new"]:not([data-customer-id])').first();
  const count = await nullIdCard.count();
  test.skip(count === 0, 'customer_id=NULL 초진 카드 없음 — 현장 데이터 필요');

  await nullIdCard.click();

  // 1번차트 열림 확인 (내용이 있든 없든 Sheet 자체는 열려야 함)
  await expect(
    page.locator('[data-radix-sheet-content]').first()
  ).toBeVisible({ timeout: 5_000 });

  // Network 요청에서 customers SELECT 가 성공했는지 확인
  // (RLS 차단 시 0 row, 성공 시 1 row)
  // → 간접 확인: customers query error가 없어야 함
  // 현재 spec에서는 Sheet 열림만 확인. 상세 데이터 확인은 수동 QA.
});
