/**
 * T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN  (RLS-MENU-ROLE-PARITY 우산 WS-2 child)
 * 매출집계(daily_closings + closing_manual_payments) read over-exposure(누수) 회수의 회귀 방지 spec.
 * planner MSG-20260611-135000-b4sj #2: EXCL 확정 + LOCK. coordinator/therapist + over-open 회수.
 *
 * 회귀가드(DB):
 *  - daily_closings: over-open(USING true) 부재, therapist_read 부재, finance_read coordinator 부재,
 *    staff_read(is_floor_staff) 유지, 쓰기(ALL×2) 불변
 *  - closing_manual_payments: over-open 부재(consultant_or_above ∪ floor_staff), 쓰기 불변
 * 회귀가드(FE): closing PERM_MATRIX 에서 coordinator/therapist 제거.
 */
import { test, expect } from '@playwright/test';
import { canAccess } from '../../src/lib/permissions';

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';

async function dbQuery(request: import('@playwright/test').APIRequestContext, query: string) {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const resp = await request.post(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, data: { query } },
  );
  expect(resp.ok(), `DB query 실패: ${resp.status()}`).toBeTruthy();
  return resp.json();
}

// ─── DC-1: daily_closings over-open / therapist / coordinator 회수 ───
test('DC-1: daily_closings SELECT 에 over-open(true)·therapist 부재, finance_read 는 coordinator 회수', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT policyname, qual FROM pg_policies
    WHERE schemaname='public' AND tablename='daily_closings' AND cmd='SELECT';
  `) as Array<{ policyname: string; qual: string }>;

  expect(rows.some(r => (r.qual || '').trim() === 'true'), 'over-open(USING true) 잔존(누수 회귀)').toBeFalsy();
  expect(rows.some(r => r.policyname === 'daily_closings_therapist_read'), 'therapist_read 잔존(회귀)').toBeFalsy();
  const fin = rows.find(r => r.policyname === 'daily_closings_finance_read');
  expect(fin, 'finance_read 부재').toBeTruthy();
  expect(fin!.qual).toContain('is_consultant_or_above()');
  expect(fin!.qual, 'coordinator 잔존(회귀)').not.toContain('is_coordinator_or_above');
  // 데스크 운영직(일마감 수행 주체)은 유지
  expect(rows.some(r => r.policyname === 'daily_closings_staff_read' && /is_floor_staff/.test(r.qual)),
    'staff_read(is_floor_staff) 가 사라짐(과잉 회수)').toBeTruthy();
});

// ─── DC-2: closing_manual_payments over-open 회수 ───
test('DC-2: closing_manual_payments read 가 consultant_or_above ∪ floor_staff 로 잠겼다', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT policyname, qual FROM pg_policies
    WHERE schemaname='public' AND tablename='closing_manual_payments' AND cmd='SELECT';
  `) as Array<{ policyname: string; qual: string }>;
  const read = rows.find(r => r.policyname === 'closing_manual_read');
  expect(read, 'closing_manual_read 부재').toBeTruthy();
  expect((read!.qual || '').trim(), 'over-open(true) 잔존(누수 회귀)').not.toBe('true');
  expect(read!.qual).toContain('is_consultant_or_above()');
  expect(read!.qual).toContain('is_floor_staff()');
});

// ─── AC-4: 쓰기 정책 불변 ───
test('AC-4: daily_closings(ALL×2) / closing_manual(insert·update·delete) 쓰기 정책이 보존된다', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const dc = await dbQuery(request, `
    SELECT policyname, cmd FROM pg_policies
    WHERE schemaname='public' AND tablename='daily_closings' AND cmd='ALL';
  `) as Array<{ policyname: string; cmd: string }>;
  expect(dc.some(r => r.policyname === 'daily_closings_admin_all')).toBeTruthy();
  expect(dc.some(r => r.policyname === 'daily_closings_write')).toBeTruthy();

  const cm = await dbQuery(request, `
    SELECT cmd FROM pg_policies
    WHERE schemaname='public' AND tablename='closing_manual_payments' AND cmd <> 'SELECT';
  `) as Array<{ cmd: string }>;
  const kinds = new Set(cm.map(r => r.cmd));
  expect(kinds.has('INSERT') && kinds.has('UPDATE') && kinds.has('DELETE'),
    'closing_manual 쓰기 정책 소실(회귀)').toBeTruthy();
});

// ─── DC-FE: closing 메뉴에서 coordinator/therapist 차단 ───
test('DC-FE: closing PERM_MATRIX 에서 coordinator/therapist 가 차단되고 finance/desk 는 유지된다', async () => {
  expect(canAccess('coordinator', 'closing'), 'coordinator 가 일마감 접근(회귀)').toBeFalsy();
  expect(canAccess('therapist', 'closing'), 'therapist 가 일마감 접근(회귀)').toBeFalsy();
  expect(canAccess('admin', 'closing')).toBeTruthy();
  expect(canAccess('manager', 'closing')).toBeTruthy();
  expect(canAccess('consultant', 'closing')).toBeTruthy();
  expect(canAccess('part_lead', 'closing')).toBeTruthy();
});
