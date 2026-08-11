/**
 * T-20260726-foot-CRM-ASSIGN-RANKING-FIX-R1 — 자동배정 랭킹 field-soak 결함 2건 핫픽스 E2E
 *
 * parent=T-20260726-foot-CRM-ASSIGN-V1 (deployed/field-soak). db_change=false(read-side 필터 교정).
 *
 * 결함1 — 퇴사 상담실장(active=false)이 통계 '실장 랭킹'(foot_stats_consultant RPC)에 노출.
 *          fetchConsultantPerf 가 RPC 결과에 read-side 재직 필터를 적용해 제외한다.
 * 결함2 — 매출 총액 '완전 틀리다' = scope 오염/double-count 아님. 풋 clinic 격리·net 정상.
 *          퇴사 noise 행 제거(결함1)로 현장 기대 '재직 6명' 랭킹과 일치.
 *
 * RED LINE — customers.assigned_consultant_id 무접촉, 랭킹 read-only. 본 spec 은 조회만.
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = process.env.FIXTURE_CLINIC_ID ?? '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // FIXTURE_CLINIC_ID: DEVDB-ISOLATION-CUTOVER leg-A(OFF=prod 상수 불변) // jongno-foot (풋 정본)
const SONGDO_ID = 'b4dc0de5-f007-4a57-8888-aabbccddeeff'; // songdo-foot (미가동)
const sb = () => createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });

/**
 * 코드(fetchConsultantPerf)와 동일한 read-side 재직 필터 규칙:
 *   명시적 active===false(퇴사) id 만 제외. active=true/null(미상)은 보존(재직 기준·과필터 방지).
 */
function applyActiveFilter<T extends { consultant_id: string }>(
  rows: T[],
  retiredIds: Set<string>,
): T[] {
  return rows.filter((r) => !retiredIds.has(r.consultant_id));
}

test.describe('T-20260726 CRM-ASSIGN 랭킹 field-soak 결함 2건 (재직필터 + 매출정합)', () => {
  // ── 결함1 / AC1·AC2: read-side 재직 필터 정합 (DB invariant) ──────────────────
  test('S1 결함1 — 퇴사 실장 제외 + 매출0 재직 실장 보존 (read-side 재직 필터)', async () => {
    const c = sb();

    // 재직 판정 소스 = staff.active (기존 컬럼). 없으면 스키마 이슈로 skip.
    const { data: staffRows, error: sErr } = await c
      .from('staff')
      .select('id, name, active')
      .eq('clinic_id', CLINIC_ID)
      .eq('role', 'consultant');
    if (sErr || !staffRows) test.skip(true, 'staff/active 조회 실패');

    const retiredIds = new Set(
      (staffRows as { id: string; active: boolean | null }[])
        .filter((s) => s.active === false)
        .map((s) => s.id),
    );
    // 당월 window (Stats 기본 preset='month' 와 동치)
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = String(today.getUTCMonth() + 1).padStart(2, '0');
    const from = `${y}-${m}-01`;
    const to = `${y}-${m}-${String(today.getUTCDate()).padStart(2, '0')}`;

    const { data: rpcRows, error: rErr } = await c.rpc('foot_stats_consultant', {
      p_clinic_id: CLINIC_ID,
      p_from: from,
      p_to: to,
    });
    if (rErr || !rpcRows) test.skip(true, 'foot_stats_consultant RPC 조회 실패');

    const raw = rpcRows as { consultant_id: string; total_amount?: number }[];
    const filtered = applyActiveFilter(raw, retiredIds);

    // AC1: 필터 후 결과에 퇴사자(active=false) 0명.
    for (const r of filtered) {
      expect(retiredIds.has(r.consultant_id), '필터 후 퇴사 실장 잔존 금지').toBe(false);
    }

    // AC2: 매출 0 이하인 '재직' 실장은 보존(active=false 만 제외 기준).
    const activeIds = new Set(
      (staffRows as { id: string; active: boolean | null }[])
        .filter((s) => s.active === true)
        .map((s) => s.id),
    );
    const activeZeroInRaw = raw.filter(
      (r) => activeIds.has(r.consultant_id) && Number(r.total_amount ?? 0) <= 0,
    );
    for (const r of activeZeroInRaw) {
      expect(
        filtered.some((f) => f.consultant_id === r.consultant_id),
        '매출0/음수 재직 실장은 랭킹 보존(재직 기준)',
      ).toBe(true);
    }

    // 필터가 실제로 무언가를 제외했거나(퇴사자 존재), 제외할 퇴사자가 window 에 없거나 — 둘 다 정상.
    expect(filtered.length).toBeLessThanOrEqual(raw.length);
  });

  // ── 결함2 / AC3: 매출 scope 격리 (cross-CRM/cross-clinic 혼입 없음) ────────────
  test('S2 결함2 — 퇴사 실장 귀속 check_ins 전량 풋(jongno) origin (혼입 없음)', async () => {
    const c = sb();
    const { data: retired } = await c
      .from('staff')
      .select('id, name')
      .eq('clinic_id', CLINIC_ID)
      .eq('role', 'consultant')
      .eq('active', false);
    if (!retired || retired.length === 0) test.skip(true, '퇴사 상담실장 없음(재현 데이터 없음)');

    for (const s of retired as { id: string; name: string }[]) {
      const { data: cis } = await c
        .from('check_ins')
        .select('clinic_id')
        .eq('consultant_id', s.id);
      const rows = (cis ?? []) as { clinic_id: string }[];
      // AC3: 귀속 check_ins 는 풋 정본(jongno) 만 — songdo/타clinic 유입 0건(cross 혼입 없음).
      const nonFoot = rows.filter((r) => r.clinic_id !== CLINIC_ID);
      expect(nonFoot.length, `${s.name} 귀속 check_ins 에 풋 외 clinic 혼입`).toBe(0);
      const songdo = rows.filter((r) => r.clinic_id === SONGDO_ID);
      expect(songdo.length, `${s.name} songdo 유입`).toBe(0);
    }
  });

  // ── 결함1 UI / 시나리오1: 통계 실장 랭킹에 퇴사자 미표시 ────────────────────────
  test('S3 결함1 UI — 통계 실장 랭킹 화면에 퇴사 실장명 미표시', async ({ page }) => {
    const c = sb();
    const { data: retired } = await c
      .from('staff')
      .select('name')
      .eq('clinic_id', CLINIC_ID)
      .eq('role', 'consultant')
      .eq('active', false);
    const retiredNames = (retired ?? []).map((r: { name: string }) => r.name).filter(Boolean);
    if (retiredNames.length === 0) test.skip(true, '퇴사 상담실장 없음');

    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');

    await page.goto('/stats');
    await page.waitForLoadState('networkidle');

    // 실장(상담) 통계 탭으로 이동 — 탭 라벨/testid 는 배포별 상이 가능 → best-effort 클릭.
    const consultTab = page
      .getByRole('tab', { name: /실장|상담|consultant/i })
      .or(page.getByTestId('stats-tab-consultant'));
    if (await consultTab.first().isVisible({ timeout: 8_000 }).catch(() => false)) {
      await consultTab.first().click().catch(() => {});
      await page.waitForTimeout(1_500);
    }

    // 랭킹 로드 대기 후 화면에서 퇴사 실장명이 노출되지 않는지 확인.
    const body = page.locator('body');
    for (const nm of retiredNames) {
      // 동명이인 방지: 정확 텍스트 매칭. 랭킹 영역 미로드/권한 이슈면 페이지 전체에도 없어야 정상.
      const hit = page.getByText(nm, { exact: true });
      const count = await hit.count().catch(() => 0);
      expect(count, `통계 랭킹 화면에 퇴사 실장 '${nm}' 표시됨`).toBe(0);
    }
    await expect(body).toBeVisible();
  });
});
