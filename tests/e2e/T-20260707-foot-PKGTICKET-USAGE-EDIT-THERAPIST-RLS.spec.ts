/**
 * T-20260707-foot-PKGTICKET-USAGE-EDIT-THERAPIST-RLS
 *
 * 현장(김주연 총괄): 2번차트 구매패키지(티켓) '시술내역 수정' 저장 → 치료사(therapist) 계정 권한 오류.
 *
 * ── diagnose-first (실측, 본 세션 Management API + 소스) ──
 *   DA 원문 테이블(package_ticket_usages / treatment_session_records)은 foot 스키마에 없음 → 실 테이블 = package_sessions.
 *   prod RLS 실재(pg_policies 측정):
 *     · package_sessions_write [FOR ALL, PERMISSIVE] = role IN(admin,manager,consultant,coordinator,therapist),
 *       self-match(performed_by) 없음 → therapist UPDATE 를 무조건(OR) 허용. ⇒ RLS lock-out 아님.
 *     · package_sessions_therap_update [UPDATE] = therapist AND performed_by=self(strict) 는 위 정책과 OR 되어 무해.
 *   package_sessions 에 clinic_id 컬럼 없음 → DA canonical 술어(clinic_id=current_user_clinic_id())는 적용 불가.
 *   ⇒ ADDITIVE RLS 는 no-op(회귀 0이나 fix 0) → 신규 마이그 미생성(db_change=false). RC = FE 게이트.
 *   first-failing-link = '시술내역 수정' 버튼 게이트가 admin/manager/director/consultant 하드코딩 →
 *     therapist/coordinator 미노출("수정 권한 없음") = FE/RLS 불일치. fix = isStaffUnlockRole 정합(형제 T-20260702 패턴).
 *
 * ── Q3 차감 카운트 정합(실측) ──
 *   packages 에 stored used/remaining 카운터 컬럼 없음 + package_sessions 트리거는 BEFORE INSERT(unit_price)뿐.
 *   잔여 = computeRemainingFromSessionRows: status='used' 행을 session_type 별로 COUNT (완전 derived).
 *   ⇒ 시술유형 변경 = 단일행 session_type UPDATE → read-time 집계가 자동 정합:
 *      total_used 불변(행은 'used' 유지), old_type -1·new_type +1 만 이동 = 이중차감/누락 0.
 *
 * ── 현장 클릭 시나리오 2건 ──
 *   (1) 정상 저장: therapist 가 '수정' 버튼을 보고, 저장 핸들러가 단일행(session_type/date/performed_by)만
 *       package_sessions .eq('id') UPDATE (카운터/ clinic_id 쓰기 없음).
 *   (2.3) 저장 후 티켓 차감 카운트 정합(누락/중복 0): session_type 변경 시 derived 집계 불변식 증명.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { isStaffUnlockRole, STAFF_UNLOCK_ROLES } from '../../src/lib/permissions';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHART_SRC = resolve(__dirname, '../../src/pages/CustomerChartPage.tsx');
const src = readFileSync(CHART_SRC, 'utf8');

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

test.describe('T-20260707 시술내역 수정 — 치료사 권한 (RC=FE 게이트, RLS 이미 허용)', () => {
  // ───────────────────────── 시나리오 (1): 정상 저장 ─────────────────────────
  test('(1) 회차 수정 게이트 role-set = STAFF_UNLOCK_ROLES: therapist/coordinator 포함, floor 제외', () => {
    // 현장 증상: 치료사가 막힘 → 이제 노출/저장 가능해야 함
    expect(isStaffUnlockRole('therapist')).toBe(true);
    expect(isStaffUnlockRole('coordinator')).toBe(true);
    // 관리자군 회귀 없음
    for (const r of ['admin', 'manager', 'director', 'consultant'] as const) {
      expect(isStaffUnlockRole(r)).toBe(true);
    }
    // floor(비해제) 제외 = 무분별 write-open 아님
    for (const r of ['part_lead', 'staff'] as const) expect(isStaffUnlockRole(r)).toBe(false);
    expect(isStaffUnlockRole(null)).toBe(false);
    expect(isStaffUnlockRole(undefined)).toBe(false);
    expect([...STAFF_UNLOCK_ROLES].sort()).toEqual(
      ['admin', 'consultant', 'coordinator', 'director', 'manager', 'therapist'].sort(),
    );
  });

  test('(1) 수정 버튼 게이트가 isStaffUnlockRole 로 정합 (옛 consultant-한정 하드코딩 재유입 금지)', () => {
    const idx = src.indexOf('setEditSessionDlg(s)');
    expect(idx, 'setEditSessionDlg(s) 진입점(회차 수정 버튼) 존재').toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, idx - 900), idx);
    expect(before, '수정 버튼 게이트가 isStaffUnlockRole(profile?.role) 여야 함')
      .toContain('isStaffUnlockRole(profile?.role)');
    // 옛 하드코딩(consultant-한정 4역할 OR 체인)이 수정 버튼 게이트로 되돌아오지 않음
    expect(
      /profile\?\.role === 'consultant'\)\s*&&\s*\(\s*<span className="ml-auto hidden group-hover:flex/.test(src),
      '옛 consultant-한정 하드코딩 게이트가 수정 버튼에 재유입되면 안 됨',
    ).toBe(false);
  });

  test('(1) 저장 핸들러 = 단일행 package_sessions UPDATE(session_type/date/performed_by)만, 카운터/clinic_id 쓰기 없음', () => {
    const s = src.indexOf('const saveEditSession');
    expect(s, 'saveEditSession 핸들러 존재').toBeGreaterThan(-1);
    const body = src.slice(s, s + 700);
    expect(body).toContain(".from('package_sessions')");
    expect(body).toContain('.update({');
    expect(body).toContain('session_type: editSessionForm.sessionType');
    expect(body).toContain('session_date: editSessionForm.sessionDate');
    expect(body).toContain('performed_by: editSessionForm.therapistId');
    // 단일행 타깃(.eq('id', ...)) — 광역 업데이트 아님
    expect(body).toMatch(/\.eq\('id', editSessionDlg\.id\)/);
    // stored counter / clinic_id 를 이 저장 경로에서 만지지 않음(derived 집계 유지, 스코프 밖 컬럼 미기입)
    expect(/total_sessions|total_used|remaining|clinic_id/.test(body),
      '저장 핸들러가 카운터/clinic_id 컬럼을 써서는 안 됨(derived 정합 유지)').toBe(false);
  });

  test('(1) 삭제 버튼 게이트 불변 — admin/manager/director 한정(회귀 0)', () => {
    // 삭제는 확대 대상 아님(is_admin_or_manager DELETE 정책 정합)
    expect(src).toContain("{/* 삭제 버튼 — admin/manager/director만");
  });

  test('(1) 시술내역 수정 표면에 진료관리 config 가드(canEditClinicMgmt 류) 오적용 없음', () => {
    // DA 점검 항목: 진료관리 EDIT 가드가 이 표면에 잘못 걸려 과잉제한 유발했는지
    expect(/canEditClinicMgmt/.test(src), '시술내역 화면에 진료관리 config 가드가 없어야 함').toBe(false);
  });

  // ───────────────────── 시나리오 (2.3): 저장 후 차감 카운트 정합 ─────────────────────
  test('(2.3) 차감 = derived (status=used 행 COUNT) — 저장 핸들러가 SSOT 집계함수 invariant 를 깨지 않음', () => {
    const f = src.indexOf('function computeRemainingFromSessionRows');
    expect(f, 'computeRemainingFromSessionRows(잔여 집계 SSOT) 존재').toBeGreaterThan(-1);
    const fn = src.slice(f, f + 2200);
    // 완전 derived 불변식: status='used' 행만, session_type 별 +1 카운트
    expect(fn).toContain("if (s.status !== 'used') continue;");
    expect(fn).toContain('byType[s.session_type] = (byType[s.session_type] ?? 0) + 1;');
    // stored 카운터 의존 제거(회귀 가드): total_remaining 은 개별 회차 컬럼 합 - derived used
    expect(fn).toContain('total_remaining: Math.max(0, totalAvailable - totalUsed)');
  });

  test('(2.3) session_type 변경 = 단일행 이동: total_used 불변, old_type -1 / new_type +1 (이중차감·누락 0)', () => {
    // computeRemainingFromSessionRows 의 derived 집계 로직 미러(SSOT 불변식 증명).
    // 소스 정적 가드(위 테스트)가 미러-드리프트를 잡음.
    type Row = { package_id: string; session_type: string; status: string };
    const countByType = (rows: Row[]) => {
      const m: Record<string, number> = {};
      for (const r of rows) {
        if (r.status !== 'used') continue;
        m[r.session_type] = (m[r.session_type] ?? 0) + 1;
      }
      return m;
    };
    // 편집 전: heated 3 used, unheated 1 used
    const before: Row[] = [
      { package_id: 'p1', session_type: 'heated_laser', status: 'used' },
      { package_id: 'p1', session_type: 'heated_laser', status: 'used' },
      { package_id: 'p1', session_type: 'heated_laser', status: 'used' },
      { package_id: 'p1', session_type: 'unheated_laser', status: 'used' },
    ];
    const b = countByType(before);
    const totalBefore = Object.values(b).reduce((a, c) => a + c, 0);
    expect(b['heated_laser']).toBe(3);
    expect(b['unheated_laser']).toBe(1);
    expect(totalBefore).toBe(4);

    // 저장 핸들러가 하는 일: 한 행의 session_type 만 heated_laser → unheated_laser 로 UPDATE
    // (status 는 'used' 유지, 행 추가/삭제 없음 = 단일행 원자 UPDATE)
    const after: Row[] = before.map((r, i) =>
      i === 0 ? { ...r, session_type: 'unheated_laser' } : r,
    );
    const a = countByType(after);
    const totalAfter = Object.values(a).reduce((x, c) => x + c, 0);

    // 이중차감/누락 0: 총 소진은 불변, old -1 / new +1 만 이동
    expect(totalAfter, 'total_used 불변(누락/중복 0)').toBe(totalBefore);
    expect(a['heated_laser'], 'old_type 차감 -1').toBe(2);
    expect(a['unheated_laser'], 'new_type 차감 +1').toBe(2);
  });

  // ───────────────────── prod RLS 실측 단언 (추가 마이그 불요 증명) ─────────────────────
  test('(RLS) prod package_sessions_write[FOR ALL] 가 therapist 를 이미 허용(self-match 없음) → 추가 마이그 불요', async ({ request }) => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
    const rows = await dbQuery(request, `
      SELECT policyname, cmd, qual FROM pg_policies
      WHERE schemaname='public' AND tablename='package_sessions' AND cmd IN ('ALL','UPDATE');
    `) as Array<{ policyname: string; cmd: string; qual: string }>;
    const write = rows.find(r => r.policyname === 'package_sessions_write');
    expect(write, 'package_sessions_write(FOR ALL) 정책 부재').toBeTruthy();
    expect(write!.cmd).toBe('ALL');
    // therapist 포함 + performed_by self-match 없음 = UPDATE 무조건 허용
    expect(write!.qual).toContain("'therapist'");
    expect(/performed_by/.test(write!.qual), 'write 정책에 self-match(performed_by)가 있으면 안 됨').toBe(false);
  });

  test('(RLS) package_sessions 에 clinic_id 컬럼 없음 → DA canonical 술어(clinic_id=...) 적용 불가(스코프 정정 근거)', async ({ request }) => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
    const rows = await dbQuery(request, `
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='package_sessions' AND column_name='clinic_id';
    `) as Array<{ column_name: string }>;
    expect(rows.length, 'clinic_id 가 있으면 canonical clinic 술어를 재검토해야 함').toBe(0);
  });
});
