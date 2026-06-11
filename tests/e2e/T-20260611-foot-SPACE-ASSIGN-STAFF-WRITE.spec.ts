/**
 * T-20260611-foot-SPACE-ASSIGN-STAFF-WRITE-PERM (P2, GO_WARN)
 * 김주연 총괄: 공간배정(상담/치료/레이저)에서 직원(staff) 계정이 권한 막혀 저장 불가 →
 *   공간배정 WRITE 권한을 staff 운영 role 에 scoped 부여.
 *
 * Phase 1 판별: 차단은 FE 게이트가 아니라 (1) RPC save_room_assignments 가드
 *   (is_admin_or_manager) + (2) room_assignments 직접 write RLS(INSERT 부재 / UPDATE 누락 role)
 *   = 백엔드 2지점. 본 spec 은 그 정책/RPC 가 scoped 로 열렸는지 + 범위한정 회귀가드를 가드한다.
 *
 * 회귀가드(티켓 5시나리오 → DB-policy 단정 변환):
 *   시나리오1/2 (직원 저장·unassign)  → AC-2: RPC 가드 can_assign_rooms + assign_insert/update 존재
 *   시나리오3 (민감 write 미개방)      → AC-3: room_assignments 한정, 타 테이블 미접촉
 *   시나리오4 (clinic 스코프)          → AC-4: 신규 INSERT/UPDATE WITH CHECK 에 clinic 스코프
 *   시나리오5 (RECUR5 미터치방 보존)   → AC-6: RPC 원자 DELETE+INSERT 본문 보존
 *   AC-5 (DELETE 미부여) / AC-7 (admin/floor staff 회귀 0)
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

// ─── 시나리오1/2: 직원 공간배정 저장·unassign (RPC 가드 + INSERT/UPDATE 정책) ───
test('S1/S2 AC-2: 직원 공간배정 write 경로가 열려 있다 (RPC can_assign_rooms + assign_insert/update)', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');

  // (a) RPC 가드가 can_assign_rooms 로 교체되고 is_admin_or_manager 가드는 제거됨
  const rpc = await dbQuery(request, `
    SELECT prosrc FROM pg_proc
    WHERE proname='save_room_assignments'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public');
  `) as Array<{ prosrc: string }>;
  expect(rpc.length, 'save_room_assignments RPC 없음').toBe(1);
  const src = rpc[0].prosrc.replace(/\s+/g, ' ');
  expect(src, 'RPC 가드가 can_assign_rooms 로 교체 안 됨').toContain('can_assign_rooms()');
  expect(src, 'RPC 에 is_admin_or_manager 가드 잔존(직원 차단)').not.toContain('IF NOT is_admin_or_manager()');

  // (b) 신규 INSERT/UPDATE 정책 존재
  const pols = await dbQuery(request, `
    SELECT policyname, cmd, with_check, qual FROM pg_policies
    WHERE schemaname='public' AND tablename='room_assignments'
      AND policyname IN ('room_assignments_assign_insert','room_assignments_assign_update');
  `) as Array<{ policyname: string; cmd: string; with_check: string | null; qual: string | null }>;
  const ins = pols.find(p => p.policyname === 'room_assignments_assign_insert');
  const upd = pols.find(p => p.policyname === 'room_assignments_assign_update');
  expect(ins, 'assign_insert(INSERT) 정책 없음').toBeTruthy();
  expect(ins!.cmd).toBe('INSERT');
  expect(upd, 'assign_update(UPDATE) 정책 없음').toBeTruthy();
  expect(upd!.cmd).toBe('UPDATE');
  expect(ins!.with_check).toContain('can_assign_rooms()');
  expect(upd!.qual).toContain('can_assign_rooms()');
  expect(upd!.with_check).toContain('can_assign_rooms()');   // unassign(staff_id=NULL) 후 row 도 clinic 고정
});

// ─── can_assign_rooms 헬퍼: 운영 8 role(tm 제외) ───
test('AC-2: can_assign_rooms() 헬퍼가 운영 직원(approved, tm 제외)을 판정한다', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT prosrc, prosecdef FROM pg_proc
    WHERE proname='can_assign_rooms'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public');
  `) as Array<{ prosrc: string; prosecdef: boolean }>;
  expect(rows.length, 'can_assign_rooms 헬퍼 없음').toBe(1);
  const src = rows[0].prosrc.replace(/\s+/g, ' ');
  expect(rows[0].prosecdef, 'SECURITY DEFINER 아님').toBeTruthy();
  expect(src).toContain('is_approved_user()');
  expect(src).toContain("'consultant'");
  expect(src).toContain("'coordinator'");
  expect(src).toContain("'therapist'");
  expect(src, 'tm 이 write 집합에 포함됨(최소권한 위반)').not.toContain("'tm'");
});

// ─── 시나리오4: clinic 스코프 (PHI/교차 clinic 회귀가드) ───
test('S4 AC-4: 직원 write 정책이 clinic_id = current_user_clinic_id() 스코프를 강제한다', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const pols = await dbQuery(request, `
    SELECT policyname, with_check, qual FROM pg_policies
    WHERE schemaname='public' AND tablename='room_assignments'
      AND policyname IN ('room_assignments_assign_insert','room_assignments_assign_update');
  `) as Array<{ policyname: string; with_check: string | null; qual: string | null }>;
  for (const p of pols) {
    expect(p.with_check, `${p.policyname} WITH CHECK 에 clinic 스코프 없음`).toContain('current_user_clinic_id()');
  }
  const upd = pols.find(p => p.policyname === 'room_assignments_assign_update');
  expect(upd!.qual, 'assign_update USING 에 clinic 스코프 없음').toContain('current_user_clinic_id()');
});

// ─── 시나리오3 + AC-5: 민감 write 미개방 + DELETE 미부여 ───
test('S3 AC-3/AC-5: room_assignments 한정 + 직원 DELETE 정책 미부여', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');

  // AC-5: room_assignments 의 DELETE 전용 정책 0건 (행 삭제는 admin_all ALL 로만)
  const del = await dbQuery(request, `
    SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='room_assignments' AND cmd='DELETE';
  `) as Array<{ policyname: string }>;
  expect(del.length, `직원 DELETE 정책이 부여됨(AC-5 위반): ${del.map(d=>d.policyname).join(',')}`).toBe(0);

  // AC-3: can_assign_rooms 를 참조하는 정책이 room_assignments 외 테이블에 없음(blanket 미개방)
  const spread = await dbQuery(request, `
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname='public'
      AND policyname IN ('room_assignments_assign_insert','room_assignments_assign_update')
      AND tablename <> 'room_assignments';
  `) as Array<{ tablename: string; policyname: string }>;
  expect(spread.length, `공간배정 정책이 타 테이블로 번짐(AC-3 위반): ${spread.map(s=>s.tablename).join(',')}`).toBe(0);
});

// ─── 시나리오5 AC-6: RECUR5 원자 저장 본문 보존 ───
test('S5 AC-6: save_room_assignments 가 원자 DELETE+INSERT(RECUR5) 본문을 유지한다', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rpc = await dbQuery(request, `
    SELECT prosrc FROM pg_proc WHERE proname='save_room_assignments'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname='public');
  `) as Array<{ prosrc: string }>;
  const src = rpc[0].prosrc.replace(/\s+/g, ' ');
  expect(src, 'DELETE 단계 소실').toMatch(/DELETE FROM room_assignments/i);
  expect(src, 'INSERT 단계 소실').toMatch(/INSERT INTO room_assignments/i);
  expect(src, 'unassign NULLIF 처리 소실').toContain("NULLIF(x.staff_id, '')");
  expect(src, 'clinic 가드 소실(AC-4)').toContain('current_user_clinic_id()');
});

// ─── AC-7: admin / floor staff 회귀 0 ───
test('AC-7: admin_all / approved_read / staff_update(is_floor_staff) 정책이 보존된다', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const pols = await dbQuery(request, `
    SELECT policyname, cmd, qual FROM pg_policies
    WHERE schemaname='public' AND tablename='room_assignments'
      AND policyname IN ('room_assignments_admin_all','room_assignments_approved_read','room_assignments_staff_update');
  `) as Array<{ policyname: string; cmd: string; qual: string | null }>;
  const admin = pols.find(p => p.policyname === 'room_assignments_admin_all');
  const read = pols.find(p => p.policyname === 'room_assignments_approved_read');
  const floor = pols.find(p => p.policyname === 'room_assignments_staff_update');
  expect(admin, 'admin_all 소실(AC-7 회귀)').toBeTruthy();
  expect(admin!.qual).toContain('is_admin_or_manager()');
  expect(read, 'approved_read 소실').toBeTruthy();
  expect(read!.qual).toContain('is_approved_user()');
  expect(floor, 'staff_update 소실(tm/floor staff 회귀)').toBeTruthy();
  expect(floor!.qual, 'staff_update 가 is_floor_staff 보존 안 함').toContain('is_floor_staff()');
});
