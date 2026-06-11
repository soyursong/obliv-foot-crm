/**
 * T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL
 * 부모 우산(T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY) 부수발견 → 별도 write 트랙.
 *
 * 확정 RC: clinic_events 의 쓰기 3정책(insert/update/delete) 이 SELECT(G2) 와 동일하게
 *          비정규 신원 소스 (staff.id = auth.uid()) 사용 → 로그인 신원(user_profiles)과
 *          staff.id 미매칭 → 직원·관리자 거의 전원 일정 생성/수정/삭제 0건(write 파손).
 *          정규 패턴(is_approved_user() + current_user_clinic_id())으로 전환해 write 복원.
 *
 * 회귀가드:
 *  - AC-1/2: 쓰기 3정책이 정규 신원(user_profiles)+clinic 스코프 사용, staff.id 패턴 제거
 *  - AC-3: UPDATE 에 WITH CHECK(canonical) 존재 → 수정 후 타 clinic 이전(escape) 차단
 *  - AC-4: SELECT 정책(G2 canonical) 불변 — 본 write 마이그가 read 미접촉
 *  - AC-5: clinic 스코프 유지(blanket-open 미발생, true 미사용)
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

// ─── AC-1/2: 쓰기 3정책이 정규 패턴으로 전환됨 ───
test('W-1: clinic_events INSERT/UPDATE/DELETE 가 정규 신원(user_profiles)+clinic 스코프를 사용한다', async ({ request }) => {
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
  expect(ins, 'clinic_events_insert 정책 없음').toBeTruthy();
  expect(upd, 'clinic_events_update 정책 없음').toBeTruthy();
  expect(del, 'clinic_events_delete 정책 없음').toBeTruthy();

  // INSERT WITH CHECK canonical
  expect(ins!.with_check).toContain('is_approved_user()');
  expect(ins!.with_check).toContain('current_user_clinic_id()');
  expect(ins!.with_check).not.toContain('staff');
  // UPDATE USING canonical
  expect(upd!.qual).toContain('is_approved_user()');
  expect(upd!.qual).toContain('current_user_clinic_id()');
  expect(upd!.qual).not.toContain('staff');
  // DELETE USING canonical
  expect(del!.qual).toContain('is_approved_user()');
  expect(del!.qual).toContain('current_user_clinic_id()');
  expect(del!.qual).not.toContain('staff');
});

// ─── AC-3: UPDATE 에 WITH CHECK 존재 → clinic 이전 escape 차단 ───
test('W-2: clinic_events UPDATE 에 canonical WITH CHECK 가 존재해 타 clinic 이전을 차단한다', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT with_check FROM pg_policies
    WHERE schemaname='public' AND tablename='clinic_events' AND cmd='UPDATE';
  `) as Array<{ with_check: string | null }>;
  expect(rows.length).toBeGreaterThanOrEqual(1);
  expect(rows[0].with_check, 'UPDATE WITH CHECK 누락 (clinic 이전 escape 가능)').toBeTruthy();
  expect(rows[0].with_check).toContain('current_user_clinic_id()');
});

// ─── AC-4: SELECT 정책(G2 canonical) 불변 ───
test('W-3: clinic_events SELECT 정책이 canonical 그대로 보존된다(write 마이그가 read 미접촉)', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT qual FROM pg_policies
    WHERE schemaname='public' AND tablename='clinic_events' AND cmd='SELECT';
  `) as Array<{ qual: string }>;
  expect(rows.length).toBeGreaterThanOrEqual(1);
  // G2 적용 후 canonical 이어야 하며, write 마이그가 이를 staff 로 되돌리지 않는다.
  expect(rows[0].qual).toContain('is_approved_user()');
  expect(rows[0].qual).not.toContain('staff');
});

// ─── AC-5 / 헬퍼 존재 가드 ───
test('W-4: 정규 헬퍼 함수(is_approved_user / current_user_clinic_id)가 SECURITY DEFINER 로 존재', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT proname, prosecdef FROM pg_proc
    WHERE proname IN ('is_approved_user','current_user_clinic_id')
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public');
  `) as Array<{ proname: string; prosecdef: boolean }>;
  expect(rows.length).toBeGreaterThanOrEqual(2);
  expect(rows.every(r => r.prosecdef === true)).toBeTruthy();
});
