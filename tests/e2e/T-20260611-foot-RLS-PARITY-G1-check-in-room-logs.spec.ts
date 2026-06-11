/**
 * T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY  Phase 2-A / G1 (check_in_room_logs)
 * planner 재게이트 MSG-20260611-135000-b4sj: C그룹 GO. 단일 [ALL] room_logs_clinic_rw 를
 * 해체하여 SELECT 만 canonical(is_approved_user()+clinic)로 전환, 쓰기 3정책은 원
 * user_profiles 술어 보존(AC-4). 대시보드 CheckInDetailSheet 공유 메뉴 read parity / 하드닝.
 *
 * 회귀가드:
 *  - 단일 [ALL] 정책 해체(ALL cmd 0건)
 *  - SELECT 1개만 + canonical 신원(user_profiles)+clinic 스코프, staff.id 패턴 부재
 *  - AC-4: INSERT/UPDATE/DELETE 3정책 존재 + 원 user_profiles 술어 보존(의미 불변)
 */
import { test, expect } from '@playwright/test';

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

// ─── G1-1: 단일 [ALL] 해체 + SELECT canonical ───
test('G1-1: check_in_room_logs SELECT 가 canonical 신원이고 [ALL] 정책이 해체됐다', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT policyname, cmd, qual FROM pg_policies
    WHERE schemaname='public' AND tablename='check_in_room_logs';
  `) as Array<{ policyname: string; cmd: string; qual: string | null }>;

  // 단일 [ALL] 정책 해체
  expect(rows.some(r => r.cmd === 'ALL'), 'room_logs_clinic_rw [ALL] 가 남아있음(회귀)').toBeFalsy();
  const sel = rows.filter(r => r.cmd === 'SELECT');
  expect(sel.length, 'SELECT 정책은 정확히 1개여야 함').toBe(1);
  expect(sel[0].qual).toContain('is_approved_user()');
  expect(sel[0].qual).toContain('current_user_clinic_id()');   // AC-5 clinic 스코프
});

// ─── AC-4: 쓰기 3정책 = 원 user_profiles 술어 보존(의미 불변) ───
test('AC-4: check_in_room_logs INSERT/UPDATE/DELETE 가 원 user_profiles 술어를 보존한다', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT cmd, qual, with_check FROM pg_policies
    WHERE schemaname='public' AND tablename='check_in_room_logs' AND cmd <> 'SELECT'
    ORDER BY cmd;
  `) as Array<{ cmd: string; qual: string | null; with_check: string | null }>;

  const ins = rows.find(r => r.cmd === 'INSERT');
  const upd = rows.find(r => r.cmd === 'UPDATE');
  const del = rows.find(r => r.cmd === 'DELETE');
  expect(ins, 'INSERT 정책 부재(회귀)').toBeTruthy();
  expect(upd, 'UPDATE 정책 부재(회귀)').toBeTruthy();
  expect(del, 'DELETE 정책 부재(회귀)').toBeTruthy();
  // 원 [ALL] 술어 = clinic_id IN (user_profiles ...) 보존, approved 게이트는 SELECT 전용
  expect(ins!.with_check).toContain('user_profiles');
  expect(upd!.qual).toContain('user_profiles');
  expect(del!.qual).toContain('user_profiles');
  expect(ins!.with_check).not.toContain('is_approved_user');
});

// ─── 정규 헬퍼 존재 가드 ───
test('G1-3: 정규 헬퍼(is_approved_user / current_user_clinic_id)가 SECURITY DEFINER 로 존재', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT proname, prosecdef FROM pg_proc
    WHERE proname IN ('is_approved_user','current_user_clinic_id')
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public');
  `) as Array<{ proname: string; prosecdef: boolean }>;
  expect(rows.length).toBeGreaterThanOrEqual(2);
  expect(rows.every(r => r.prosecdef === true)).toBeTruthy();
});
