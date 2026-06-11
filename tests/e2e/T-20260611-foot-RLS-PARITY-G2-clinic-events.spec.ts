/**
 * T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY  Phase 2-A / G2 (clinic_events)
 * 대시보드 사이드바 ClinicCalendar(전 role 공유 메뉴)의 일정 이벤트가 비정규 신원 소스
 * (staff.id = auth.uid()) SELECT 정책 때문에 직원·관리자 거의 전원 0건으로 보이는
 * 망가진 RLS 의 회귀 방지 spec.
 *
 * 확정 RC: clinic_events_select USING = (clinic_id IN (SELECT staff.clinic_id FROM staff
 *          WHERE staff.id = auth.uid())). 로그인 신원은 user_profiles 기준인데 staff.id 는
 *          staff PK 라 auth.uid() 와 사실상 미매칭 → SELECT 0건. health_q outlier 와 동일 RC.
 *          정규 패턴(is_approved_user() + current_user_clinic_id())으로 전환.
 *
 * 회귀가드:
 *  - SELECT 정책이 정규 신원(user_profiles)+clinic 스코프 사용, staff.id 패턴 제거
 *  - AC-4: INSERT/UPDATE/DELETE 3정책 불변(쓰기 권한 미접촉, READ parity 범위)
 *  - AC-5: clinic 스코프 유지(PHI 비확장)
 *  - 정규 헬퍼 SECURITY DEFINER 존재
 */

import { test, expect } from '@playwright/test';

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

// ─── G2-1: SELECT 정책이 정규 패턴으로 전환됨 ───
test('G2-1: clinic_events SELECT 정책이 정규 신원(user_profiles)+clinic 스코프를 사용한다', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT policyname, cmd, qual
    FROM pg_policies
    WHERE schemaname='public' AND tablename='clinic_events' AND cmd='SELECT';
  `) as Array<{ policyname: string; cmd: string; qual: string }>;

  const sel = rows.find(r => r.policyname === 'clinic_events_select');
  expect(sel, 'clinic_events_select SELECT 정책이 없음').toBeTruthy();
  expect(sel!.qual).toContain('is_approved_user()');
  expect(sel!.qual).toContain('current_user_clinic_id()');   // AC-5 clinic 스코프 유지
  // 비정규 staff.id 패턴 제거 — 직원·관리자 0건 RC 재발 차단
  expect(sel!.qual).not.toContain('staff');
});

// ─── AC-4: READ-only 회귀가드 — 쓰기 3정책 불변(staff 패턴 그대로) ───
test('AC-4: clinic_events INSERT/UPDATE/DELETE 3정책이 불변이며 쓰기 권한이 미접촉이다', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname='public' AND tablename='clinic_events' AND cmd <> 'SELECT'
    ORDER BY cmd;
  `) as Array<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>;

  const ins = rows.find(r => r.cmd === 'INSERT');
  const upd = rows.find(r => r.cmd === 'UPDATE');
  const del = rows.find(r => r.cmd === 'DELETE');
  expect(ins, 'clinic_events_insert(INSERT) 정책이 사라짐 (회귀)').toBeTruthy();
  expect(upd, 'clinic_events_update(UPDATE) 정책이 사라짐 (회귀)').toBeTruthy();
  expect(del, 'clinic_events_delete(DELETE) 정책이 사라짐 (회귀)').toBeTruthy();
  // 본 마이그는 SELECT 만 변경 → 쓰기 3정책은 기존 staff 기반 그대로 (의도적 미접촉)
  expect(ins!.with_check).toContain('staff');
  expect(upd!.qual).toContain('staff');
  expect(del!.qual).toContain('staff');
});

// ─── 정규 헬퍼 존재 가드 ───
test('G2-3: 정규 헬퍼 함수(is_approved_user / current_user_clinic_id)가 SECURITY DEFINER 로 존재', async ({ request }) => {
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
