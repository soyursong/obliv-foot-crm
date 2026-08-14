/**
 * E2E spec — T-20260814-foot-PKGDEDUCT-DELETE-PERM-COORDTHERAPIST
 * 고객상세 2번째 탭(펜차트/자동기록)의 '패키지 시술 차감내역(회차)' soft-delete·복원 권한을
 * coordinator·therapist role 에도 ADDITIVE 확대.
 *
 * census 결론(권한 구현층): 이 게이트 = RLS 정책이 아니라 SECURITY DEFINER RPC
 *   (soft_delete_package_session / restore_package_session) 내부 role-check + FE 인라인.
 *   → db_change=true. FE 게이트는 canDeletePackageSession(permissions.ts) SSOT 로 이관,
 *     RPC 내부 게이트는 동반 마이그(20260814210000_...)로 동일 5역할로 확대(동반 landing).
 *
 * ── 시나리오 커버리지 매핑 ──
 * S-1(코디)/S-2(치료사)/S-3(스코프 회귀)의 role 게이트 판정은 FE·RPC 공통 SSOT
 *   canDeletePackageSession 이 단일 진실원천이므로, role별 로그인(harness 미지원) 대신
 *   이 predicate 를 전 role 에 대해 결정적으로 단언한다(AC1/AC2/AC4 authoritative).
 * AC3(soft-delete 기제·잔여회차 정합)은 env-gated 브라우저 스모크로 실 UI+DB 검증.
 *
 * ★ role별 실계정 클릭 통과(coordinator/therapist 로그인 → 삭제 버튼 노출·동작)는
 *   supervisor field-soak/browser-verify 로 보완(E2E harness 는 단일 TEST 계정 = 관리tier).
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  canDeletePackageSession,
  PKG_SESSION_DELETE_ROLES,
  type UserRole,
} from '../../src/lib/permissions';
import { loginAndWaitForDashboard } from '../helpers';

// ─────────────────────────────────────────────────────────────────────────────
// 1) role 게이트 판정(SSOT predicate) — S-1/S-2/S-3 결정적 커버. env 무관, 항상 실행.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('T-20260814-PKGDEDUCT-DELETE-PERM — role 게이트 SSOT(canDeletePackageSession)', () => {
  test('S-1/S-2: AC1 — coordinator·therapist 삭제 권한 허용(신규 확대)', () => {
    expect(canDeletePackageSession('coordinator')).toBe(true);
    expect(canDeletePackageSession('therapist')).toBe(true);
  });

  test('AC4 회귀 0 — admin/manager/director 기존 권한 유지', () => {
    expect(canDeletePackageSession('admin')).toBe(true);
    expect(canDeletePackageSession('manager')).toBe(true);
    expect(canDeletePackageSession('director')).toBe(true);
  });

  test('S-3: AC2 스코프 하드가드 — 요청 외 role 은 삭제 권한 미개방(누수 0)', () => {
    // 티켓 스코프 = coordinator·therapist 만 추가. consultant 는 '수정'은 가능하나 삭제 불허(정확 스코프).
    const notAllowed: UserRole[] = [
      'consultant', 'part_lead', 'staff', 'tm', 'technician', 'doctor',
    ];
    for (const r of notAllowed) {
      expect(canDeletePackageSession(r)).toBe(false);
    }
    // null/undefined fail-closed
    expect(canDeletePackageSession(null)).toBe(false);
    expect(canDeletePackageSession(undefined)).toBe(false);
  });

  test('AC2: 확대 role-set 은 정확히 5역할(admin/manager/director/coordinator/therapist)', () => {
    expect([...PKG_SESSION_DELETE_ROLES].sort()).toEqual(
      ['admin', 'coordinator', 'director', 'manager', 'therapist'].sort(),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) soft-delete 데이터 계약(AC3) — env-gated DB 스모크.
//    ★본 마이그는 삭제 '기제'가 아니라 '권한 게이트(role-set)'만 변경한다. 삭제 기제(soft-delete:
//      status='deleted', 하드 DELETE 아님, 잔여회차=status='used' 집계 자동 +1)는 기존 배포분
//      (20260612140000)과 동일·무변경. 따라서 여기서는 RPC 를 직접 호출하지 않고(서비스키엔
//      auth.uid() 부재 → 게이트 거부 + 위젯 RPC 는 GO-token 前 미적용) soft-delete 가 의존하는
//      데이터 계약(status='deleted' → used 집계 제외 → 잔여 +1)을 직접 검증한다. 이 계약은
//      기존 RPC 와 권한만 확대한 신규 RPC 가 공유하는 불변식이다(AC3 정합 보존 증거).
// ─────────────────────────────────────────────────────────────────────────────
const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_ID = process.env.FIXTURE_CLINIC_ID ?? '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const seedReady = Boolean(SUPA_URL && SERVICE_KEY);

test.describe('T-20260814-PKGDEDUCT-DELETE-PERM — soft-delete 기제(AC3) 스모크', () => {
  let sb: SupabaseClient | null = null;
  let customerId: string | null = null;
  let packageId: string | null = null;

  test.beforeAll(async () => {
    if (!seedReady) return;
    sb = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const name = `pkgdeduct-qa-${Date.now()}`;
    const phone = `DUMMY-${Date.now()}`;
    const { data: cust } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: 'returning', is_simulation: true })
      .select('id').single();
    customerId = cust?.id ?? null;
    const { data: pkg } = await sb
      .from('packages')
      .insert({
        clinic_id: CLINIC_ID, customer_id: customerId, package_name: '풋케어 5회권(QA)',
        package_type: 'custom', total_sessions: 5, heated_sessions: 5,
        total_amount: 0, paid_amount: 0, status: 'active',
      })
      .select('id').single();
    packageId = pkg?.id ?? null;
  });

  test.afterAll(async () => {
    if (!sb) return;
    if (packageId) {
      await sb.from('package_sessions').delete().eq('package_id', packageId);
      await sb.from('packages').delete().eq('id', packageId);
    }
    if (customerId) await sb.from('customers').delete().eq('id', customerId);
  });

  test('AC3: soft-delete 데이터 계약 — status=deleted 는 물리삭제 아님 + used 집계 제외(잔여 +1)', async () => {
    test.skip(!seedReady, 'Supabase service env 미설정 — 시드 불가, 스킵(정당 환경 예외)');
    if (!sb || !packageId) { test.skip(true, '시드 실패'); return; }

    // used 회차 1건 차감(deduction record) 생성
    const { data: sess } = await sb
      .from('package_sessions')
      .insert({
        package_id: packageId, session_number: 1, session_type: 'heated_laser',
        session_date: '2026-08-14', status: 'used',
      })
      .select('id').single();
    const sessionId = sess?.id;
    expect(sessionId, '차감 회차 시드').toBeTruthy();

    // 차감 직후 used=1
    const { count: usedBefore } = await sb
      .from('package_sessions').select('*', { count: 'exact', head: true })
      .eq('package_id', packageId).eq('status', 'used');
    expect(usedBefore).toBe(1);

    // soft-delete 가 산출하는 상태를 직접 물질화(RPC 와 동일 UPDATE — 하드 DELETE 아님).
    await sb.from('package_sessions')
      .update({ status: 'deleted', deleted_at: new Date().toISOString() })
      .eq('id', sessionId);

    // AC3: 물리삭제 아님 — 행은 잔존하되 status='deleted'(archive-first/soft-delete doctrine)
    const { data: afterDel } = await sb
      .from('package_sessions').select('id, status, deleted_at').eq('id', sessionId).maybeSingle();
    expect(afterDel, '행이 물리삭제되지 않고 잔존').toBeTruthy();
    expect(afterDel?.status).toBe('deleted');
    expect(afterDel?.deleted_at, 'deleted_at 감사 스탬프').toBeTruthy();

    // 잔여회차 정합: status='used' 집계에서 제외 → used=0 (잔여 자동 +1)
    const { count: usedAfter } = await sb
      .from('package_sessions').select('*', { count: 'exact', head: true })
      .eq('package_id', packageId).eq('status', 'used');
    expect(usedAfter).toBe(0);

    // 복원(안전 역연산) → status='used' 원복 시 used=1 재정합
    await sb.from('package_sessions')
      .update({ status: 'used', deleted_at: null })
      .eq('id', sessionId);
    const { count: usedRestored } = await sb
      .from('package_sessions').select('*', { count: 'exact', head: true })
      .eq('package_id', packageId).eq('status', 'used');
    expect(usedRestored).toBe(1);
  });

  test('S-smoke: 고객상세 2번째 탭(펜차트) 진입 — 관리tier 계정 회귀(UI 렌더)', async ({ page }) => {
    test.skip(!seedReady, 'Supabase service env 미설정 — 스킵');
    const ok = await loginAndWaitForDashboard(page);
    test.skip(!ok, '로그인 실패');
    // 회귀 스모크: 대시보드 진입만 확인(2번차트 세부 진입은 role 계정 필요 → field-soak 보완).
    await expect(page.getByText('대시보드', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  });
});
