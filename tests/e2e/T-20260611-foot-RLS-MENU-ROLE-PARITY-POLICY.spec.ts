/**
 * T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY — 우산(전수감사) 회귀 spec
 *
 * 정책(김주연 총괄): "권한 풀린(관리자·직원 모두 메뉴 진입 가능) 메뉴는 그 안의
 *   데이터 조회도 manager=staff 동일 보장." audit-first / blanket-open 금지.
 *
 * Phase 2-A 최종 범위 = G2 clinic_events_select 단독(planner eih9).
 *   - G1 check_in_room_logs = NO-OP 종결(already-parity, WITHDRAWN) → 본 우산 변경 0.
 *   - clinic_events 쓰기 비정규 RC 는 별도 트랙
 *     T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL 가 소유(본 우산 AC-4 = 쓰기 불변).
 *
 * 본 spec(티켓 ID 매칭)은 우산이 실제 집행한 단 하나의 READ 변경(G2)을 우산 수용기준
 * (AC-4/AC-5)으로 회귀가드한다. 세부 G2 단위 spec 는
 *   tests/e2e/T-20260611-foot-RLS-PARITY-G2-clinic-events.spec.ts 가 보유(상호보완, 중복가드).
 *
 * 우산 수용기준(Acceptance Criteria):
 *   AC-PARITY : clinic_events SELECT = 정규 신원(is_approved_user) → manager=staff parity
 *   AC-5      : clinic_id 스코프(current_user_clinic_id) 유지 — PHI 비확장
 *   AC-OUTLIER: 비정규 staff.id=auth.uid() 패턴 제거 (전원 deny RC 재발 차단)
 *   AC-4      : INSERT/UPDATE/DELETE 쓰기 권한 불변(존재 보존) — READ parity 범위 한정
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

// ─── AC-PARITY + AC-5 + AC-OUTLIER: G2 clinic_events SELECT 가 정규 패턴으로 전환 ───
test('우산-1(AC-PARITY/AC-5/AC-OUTLIER): clinic_events SELECT 가 정규 신원+clinic 스코프이고 staff.id 비정규 패턴이 제거됨', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT policyname, cmd, qual
    FROM pg_policies
    WHERE schemaname='public' AND tablename='clinic_events' AND cmd='SELECT';
  `) as Array<{ policyname: string; cmd: string; qual: string }>;

  const sel = rows.find(r => r.policyname === 'clinic_events_select');
  expect(sel, 'clinic_events_select SELECT 정책이 없음').toBeTruthy();
  // AC-PARITY: 정규 신원 헬퍼 → 전 직원(approved) 동일 read (manager=staff)
  expect(sel!.qual).toContain('is_approved_user()');
  // AC-5: clinic 스코프 유지 (PHI 비확장)
  expect(sel!.qual).toContain('current_user_clinic_id()');
  // AC-OUTLIER: 비정규 staff.id=auth.uid() 패턴 제거 → 직원·관리자 전원 deny RC 재발 차단
  expect(sel!.qual).not.toContain('staff');
});

// ─── AC-4: 쓰기 3정책 불변(존재 보존) — 우산 READ 변경이 쓰기 권한을 제거하지 않음 ───
// ⚠ 쓰기 술어(staff vs canonical)는 별도 write 트랙
//    T-20260611-foot-CLINIC-EVENTS-WRITE-RLS-CANONICAL 가 소유 → 여기서는 술어 단정 금지, 존재만 가드.
test('우산-2(AC-4): clinic_events INSERT/UPDATE/DELETE 3정책이 모두 존재하여 쓰기 권한이 READ 변경으로 제거되지 않음', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT policyname, cmd
    FROM pg_policies
    WHERE schemaname='public' AND tablename='clinic_events' AND cmd <> 'SELECT'
    ORDER BY cmd;
  `) as Array<{ policyname: string; cmd: string }>;

  const ins = rows.find(r => r.cmd === 'INSERT');
  const upd = rows.find(r => r.cmd === 'UPDATE');
  const del = rows.find(r => r.cmd === 'DELETE');
  expect(ins, 'clinic_events INSERT 정책이 사라짐 (AC-4 위반/회귀)').toBeTruthy();
  expect(upd, 'clinic_events UPDATE 정책이 사라짐 (AC-4 위반/회귀)').toBeTruthy();
  expect(del, 'clinic_events DELETE 정책이 사라짐 (AC-4 위반/회귀)').toBeTruthy();
});

// ─── 정규 헬퍼 존재 가드 — parity 판정 근거가 SECURITY DEFINER 로 존재 ───
test('우산-3: 정규 헬퍼(is_approved_user / current_user_clinic_id)가 SECURITY DEFINER 로 존재', async ({ request }) => {
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

// ─── AC-OUTLIER(가드 보강): G1 은 우산 변경 0(already-parity) — read parity 이미 충족 회귀 감시 ───
// check_in_room_logs 는 NO-OP 종결(planner eih9). user_profiles 기반 [ALL] 정책이 유지되어
// read 가 전 role parity 임을 가드(우산이 G1 을 잘못 건드려 write 를 깨뜨리지 않았는지 회귀 확인).
test('우산-4(G1 NO-OP 보존): check_in_room_logs read 가 user_profiles 기반으로 전 role parity 유지(우산 무변경 회귀가드)', async ({ request }) => {
  test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
  const rows = await dbQuery(request, `
    SELECT policyname, cmd, qual
    FROM pg_policies
    WHERE schemaname='public' AND tablename='check_in_room_logs';
  `) as Array<{ policyname: string; cmd: string; qual: string | null }>;
  // SELECT 가능 정책(전용 SELECT 또는 ALL)이 user_profiles 기반 clinic 스코프로 존재해야 함
  const readable = rows.filter(r =>
    (r.cmd === 'SELECT' || r.cmd === 'ALL') && (r.qual ?? '').includes('user_profiles'));
  expect(readable.length, 'check_in_room_logs read parity 정책이 사라짐(우산이 G1 을 잘못 변경?)').toBeGreaterThanOrEqual(1);
  // NO-OP 보존: clinic_events 처럼 staff.id 로 전환되지 않았는지(잘못된 fold 방지)
  const readQual = readable.map(r => r.qual ?? '').join(' ');
  expect(readQual).toContain('clinic_id');
});
