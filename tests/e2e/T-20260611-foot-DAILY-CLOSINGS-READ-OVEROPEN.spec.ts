/**
 * T-20260611-foot-DAILY-CLOSINGS-READ-OVEROPEN  (REVISE — policy_correction_jnz7)
 * ★ 정책 정정 (김주연 총괄 직접, §13.1.A reporter-authorized) ★
 *   일마감(daily closing workflow) = 직원 업무 = OPEN. '매출집계'로 오분류한 이전 LOCK 을 정정.
 *   매출집계(실장별·치료사별 성과)는 별도 /admin/sales(payments 직접쿼리, admin/manager EXCL) — 이 테이블 무관.
 *
 * 회귀가드(DB) — 보안 하드닝(over-open 제거)만, 일마감 수행 role 잠금 0:
 *  - daily_closings_read: over-open(USING true) → canonical (is_approved_user() AND clinic_id = current_user_clinic_id())
 *  - daily_closings finance_read(coordinator 포함)·staff_read(is_floor_staff)·therapist_read 유지(삭제·축소 안 함)
 *  - closing_manual_read: over-open → canonical clinic-scoped
 *  - 쓰기 정책(ALL×2 / insert·update·delete) 불변
 * 회귀가드(FE) — 3-gate 파리티(메뉴=route=PERM_MATRIX): 일마감 = 전직원(8역할, tm 제외) OPEN.
 */
import { test, expect } from '@playwright/test';
import { canAccess, ALL_STAFF_ROLES } from '../../src/lib/permissions';

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

// ─── DC-1: daily_closings over-open 제거 + 일마감 수행 role read 유지 ───
test('DC-1: daily_closings SELECT over-open(true) 제거(canonical clinic-scoped) + finance(coordinator)/staff/therapist read 유지', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT policyname, qual FROM pg_policies
    WHERE schemaname='public' AND tablename='daily_closings' AND cmd='SELECT';
  `) as Array<{ policyname: string; qual: string }>;

  // over-open(true) 제거 = 보안 하드닝(유지)
  expect(rows.some(r => (r.qual || '').trim() === 'true'), 'over-open(USING true) 잔존(누수 회귀)').toBeFalsy();
  // daily_closings_read 는 canonical clinic-scoped 로 교체
  const read = rows.find(r => r.policyname === 'daily_closings_read');
  expect(read, 'daily_closings_read 부재').toBeTruthy();
  expect(read!.qual, 'canonical approved 게이트 누락').toContain('is_approved_user()');
  expect(read!.qual, 'canonical clinic 스코프 누락').toContain('current_user_clinic_id()');
  // ★일마감 수행 role 잠금 0 — 정정: therapist_read 유지(이전 LOCK 의 DROP 취소)
  expect(rows.some(r => r.policyname === 'daily_closings_therapist_read'),
    'therapist_read 가 사라짐(일마감 role 잠금 회귀)').toBeTruthy();
  // ★coordinator 회수 취소 — finance_read 에 coordinator 유지
  const fin = rows.find(r => r.policyname === 'daily_closings_finance_read');
  expect(fin, 'finance_read 부재').toBeTruthy();
  expect(fin!.qual, 'coordinator 가 회수됨(일마감 role 잠금 회귀)').toContain('is_coordinator_or_above');
  // 데스크 운영직(일마감 수행 주체) 유지
  expect(rows.some(r => r.policyname === 'daily_closings_staff_read' && /is_floor_staff/.test(r.qual)),
    'staff_read(is_floor_staff) 가 사라짐(일마감 role 잠금 회귀)').toBeTruthy();
});

// ─── DC-2: closing_manual_payments over-open → canonical clinic-scoped ───
test('DC-2: closing_manual_payments read 가 canonical clinic-scoped(approved+clinic) 로 교체되었다', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT policyname, qual FROM pg_policies
    WHERE schemaname='public' AND tablename='closing_manual_payments' AND cmd='SELECT';
  `) as Array<{ policyname: string; qual: string }>;
  const read = rows.find(r => r.policyname === 'closing_manual_read');
  expect(read, 'closing_manual_read 부재').toBeTruthy();
  expect((read!.qual || '').trim(), 'over-open(true) 잔존(누수 회귀)').not.toBe('true');
  expect(read!.qual).toContain('is_approved_user()');
  expect(read!.qual).toContain('current_user_clinic_id()');
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

// ─── DC-FE: 일마감 = 전직원(8역할, tm 제외) OPEN, tm 만 차단 ───
test('DC-FE: closing PERM_MATRIX 가 전직원(8역할) OPEN + tm 제외(최소권한)', async () => {
  // 일마감 수행 role = ALL_STAFF_ROLES (admin/manager/director/consultant/coordinator/therapist/part_lead/staff)
  for (const role of ALL_STAFF_ROLES) {
    expect(canAccess(role, 'closing'), `${role} 가 일마감 접근 불가(NAV-BOUNCE 회귀)`).toBeTruthy();
  }
  // 정정 핵심: 이전 LOCK 으로 막혔던 staff/coordinator/therapist 가 다시 OPEN
  expect(canAccess('staff', 'closing'), 'staff 일마감 차단(직원 업무인데 잠김)').toBeTruthy();
  expect(canAccess('coordinator', 'closing'), 'coordinator 일마감 차단(회귀)').toBeTruthy();
  expect(canAccess('therapist', 'closing'), 'therapist 일마감 차단(회귀)').toBeTruthy();
  // tm 은 최소권한 — 일마감 메뉴 제외
  expect(canAccess('tm', 'closing'), 'tm 이 일마감 접근(최소권한 위반)').toBeFalsy();
});
