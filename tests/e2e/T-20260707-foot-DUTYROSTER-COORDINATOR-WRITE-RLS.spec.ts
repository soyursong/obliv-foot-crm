/**
 * T-20260707-foot-DUTYROSTER-COORDINATOR-WRITE-RLS
 *
 * 현장(김주연 총괄): 코디네이터 계정(U0ATJ9SG4GY)이 근무스케줄표(DutyRosterTab)에 기입 불가.
 *
 * ── DA CONSULT-REPLY(MSG-20260707-204413-049e) 가설 A 확정 ──
 *   duty_roster write = 운영/HR 스케줄링 표면. §12-3 EXCL-3(통계/매출/계정관리)·진료관리 EDIT(director 단독)과 직교.
 *   현 admin/manager-only = 과소provisioning(버그), 의도된 director-lock 아님. coordinator=운영 staff → legitimate write.
 *   편집모델 = 중앙관리형(a): 한 운영자가 clinic 전체 원장 근무표를 셀 토글로 편집(편집자 자기 row 아님).
 *   → write set = {admin, manager, coordinator}. tm 제외.
 *
 * ── diagnose-first (실측, 본 세션 Management API + 소스) ──
 *   (A) prod pg_policies: INSERT/UPDATE/DELETE 3정책 모두 role IN('admin','manager') → coordinator 배제 실재. ⇒ db_change:true.
 *   (B) clinic_id 컬럼 존재 + clinics 2건(다지점) → clinic 스코프 술어 유지(role-only 아님).
 *   FE canEdit(L77) 도 admin/manager 한정 → coordinator 셀 disabled. NAV(DUTY_ROSTER_ROLES)는 coordinator 이미 포함(가시성 OK).
 *   fix = (i) ADDITIVE RLS: coordinator용 INSERT/UPDATE/DELETE 별도 permissive 정책 추가(기존 불변) (ii) FE canEdit 에 coordinator 추가.
 *   ❌ self-match(staff.id=auth.uid()) 미사용(§12-4) — 술어는 user_profiles.id=auth.uid() 앱신원 매핑.
 *
 * ── 현장 클릭 시나리오 2건 (티켓 본문) ──
 *   (1) 정상 동선: coordinator 로그인 → DutyRosterTab → 셀 편집/저장 성공(FE canEdit + RLS 둘 다 통과).
 *   (2) 권한 경계: admin/manager 무회귀 / 경계 role(therapist·staff 등)은 편집 차단 유지 / clinic 스코프 유지.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TAB_SRC = resolve(__dirname, '../../src/components/DutyRosterTab.tsx');
const HANDOVER_SRC = resolve(__dirname, '../../src/pages/Handover.tsx');
const tabSrc = readFileSync(TAB_SRC, 'utf8');
const handoverSrc = readFileSync(HANDOVER_SRC, 'utf8');

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

test.describe('T-20260707 근무스케줄표 — 코디네이터 기입 (FE canEdit + ADDITIVE RLS)', () => {
  // ───────────────────── 시나리오 (1): 정상 동선 (coordinator 편집 가능) ─────────────────────
  test('(1) FE canEdit 게이트에 coordinator 포함 (admin/manager 회귀 없음)', () => {
    const idx = tabSrc.indexOf('const canEdit');
    expect(idx, 'canEdit 정의 존재').toBeGreaterThan(-1);
    const body = tabSrc.slice(idx, idx + 260);
    expect(body, "canEdit 에 coordinator 포함").toContain("profile?.role === 'coordinator'");
    expect(body, 'admin 무회귀').toContain("profile?.role === 'admin'");
    expect(body, 'manager 무회귀').toContain("profile?.role === 'manager'");
  });

  test('(1) NAV 가시성(DUTY_ROSTER_ROLES) 에 coordinator 포함 — 탭 자체는 이미 노출(가시성 회귀 0)', () => {
    const idx = handoverSrc.indexOf('DUTY_ROSTER_ROLES =');
    expect(idx, 'DUTY_ROSTER_ROLES 정의 존재').toBeGreaterThan(-1);
    const line = handoverSrc.slice(idx, idx + 200);
    expect(line, '근무표 가시성에 coordinator 포함').toContain("'coordinator'");
  });

  test('(1) prod RLS: coordinator INSERT/UPDATE/DELETE 정책 실재 (ADDITIVE 적용 확인)', async ({ request }) => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
    const rows = await dbQuery(request, `
      SELECT policyname, cmd, qual, with_check FROM pg_policies
      WHERE schemaname='public' AND tablename='duty_roster'
        AND policyname LIKE '%coordinator%';
    `) as Array<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>;
    const cmds = rows.map(r => r.cmd).sort();
    expect(cmds, 'coordinator write 3정책(INSERT/UPDATE/DELETE) 실재').toEqual(['DELETE', 'INSERT', 'UPDATE']);
    for (const r of rows) {
      const blob = `${r.qual ?? ''} ${r.with_check ?? ''}`;
      // 술어에 coordinator role 게이트 + clinic 스코프 + 승인게이트 포함
      expect(blob, `${r.policyname}: coordinator role 게이트`).toContain("'coordinator'");
      expect(blob, `${r.policyname}: clinic 스코프 유지(다지점)`).toContain('clinic_id');
      expect(blob, `${r.policyname}: 승인게이트(approved) 유지`).toContain('approved');
      // ❌ self-match 금지 (§12-4) — auth.uid() 는 user_profiles.id 매핑에만 쓰이고 staff.id=auth.uid() 금지
      expect(/staff[^_]*\.id\s*=\s*auth\.uid\(\)/.test(blob), `${r.policyname}: self-match(staff.id=auth.uid()) 금지`).toBe(false);
    }
  });

  // ───────────────────── 시나리오 (2): 권한 경계 / 무회귀 ─────────────────────
  test('(2) 기존 admin/manager 정책 불변 — INSERT/UPDATE/DELETE + SELECT 회귀 0 (순수 ADDITIVE)', async ({ request }) => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
    const rows = await dbQuery(request, `
      SELECT policyname, cmd, qual, with_check FROM pg_policies
      WHERE schemaname='public' AND tablename='duty_roster'
        AND policyname NOT LIKE '%coordinator%'
      ORDER BY cmd, policyname;
    `) as Array<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>;
    const names = rows.map(r => r.policyname).sort();
    expect(names, '기존 4정책(select/insert/update/delete) 그대로 존재').toEqual(
      ['duty_roster_delete', 'duty_roster_insert', 'duty_roster_select', 'duty_roster_update'].sort(),
    );
    // 기존 write 정책은 여전히 admin/manager 리터럴 유지(coordinator 로 오염되지 않음 = 원 술어 불변)
    for (const r of rows.filter(x => x.cmd !== 'SELECT')) {
      const blob = `${r.qual ?? ''} ${r.with_check ?? ''}`;
      expect(blob, `${r.policyname}: 기존 admin/manager 술어 유지`).toContain("'admin'");
      expect(blob, `${r.policyname}: 기존 admin/manager 술어 유지`).toContain("'manager'");
    }
  });

  test('(2) 경계 role 편집 차단 유지 — FE canEdit 이 특정 role 화이트리스트(무분별 write-open 아님)', () => {
    const idx = tabSrc.indexOf('const canEdit');
    const body = tabSrc.slice(idx, idx + 260);
    // 화이트리스트 형태(=== 비교의 OR 체인)여야 함 — therapist/staff 등 미포함 role 은 자동 차단
    expect(body, '명시적 role 화이트리스트').toContain("profile?.role ===");
    // 편집 밖 role(therapist/staff/part_lead)이 canEdit 에 새로 들어오지 않음
    for (const r of ['therapist', 'staff', 'part_lead', 'director', 'consultant']) {
      expect(body.includes(`'${r}'`), `${r} 는 근무표 편집 write set 밖(차단 유지)`).toBe(false);
    }
    // 셀 disabled 게이트가 canEdit 에 묶여 있음(비편집 role 은 셀 비활성)
    expect(tabSrc, '셀 disabled 가 canEdit 에 연동').toContain('disabled={!canEdit}');
  });

  test('(2) clinic 스코프 유지 — duty_roster.clinic_id 컬럼 존재(다지점) 확인', async ({ request }) => {
    test.skip(!process.env.SUPABASE_ACCESS_TOKEN, 'SUPABASE_ACCESS_TOKEN not set');
    const cols = await dbQuery(request, `
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='duty_roster' AND column_name='clinic_id';
    `) as Array<{ column_name: string }>;
    expect(cols.length, 'clinic_id 존재 → coordinator 정책도 clinic 스코프 매칭 유지').toBe(1);
  });
});
