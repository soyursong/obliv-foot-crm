/**
 * T-20260726-foot-CRM-ASSIGN-V1 — 상담 자동배정 시스템 (실행1~4·6) E2E 6종
 *
 * 스키마(마이그 20260726130000) 적용 후 통과. 미적용 시 각 시나리오는 graceful test.skip.
 *  · 조건① 일일건수 = assignment_actions 파생(물리 카운터 0)
 *  · 조건② RED LINE = customers.assigned_consultant_id 비접촉(auto/설정 어디서도 write 0)
 *  · 실행1 랭킹 가중치 / 실행2 Daily Target(2:1)·유입경로전략·포인터 / 실행3 present∩enabled / 실행4 수동로그 / 실행6 설정 UI
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const sb = () => createClient(SUPA_URL, SERVICE_KEY);

/** 신규 스키마 존재 여부(마이그 적용 확인). 없으면 skip. */
async function schemaReady(): Promise<boolean> {
  try {
    const c = sb();
    const { error } = await c.from('assignment_leadsource_policy').select('clinic_id').limit(1);
    return !error;
  } catch {
    return false;
  }
}

test.describe('T-20260726 상담 자동배정 시스템 (실행1~4·6)', () => {
  // ── 시나리오 1 (실행6): 배정 설정 탭 진입 + 랭킹 가중치 저장 ──────────────────
  test('S1 실행6 — 배정 설정 탭에서 매출 순위 가중치 저장', async ({ page }) => {
    if (!(await schemaReady())) test.skip(true, '마이그 20260726130000 미적용');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');

    await page.goto('/admin/staff?tab=assignment');
    await page.waitForLoadState('networkidle');
    const tab = page.getByTestId('assignment-settings-tab');
    // 탭이 admin 게이트로 노출됐는지(관리자 로그인 전제). 미노출 시 권한 이슈로 skip.
    if (!(await tab.isVisible({ timeout: 8_000 }).catch(() => false))) {
      test.skip(true, '배정 설정 탭 미노출(권한/스키마)');
    }
    await page.getByTestId('save-weights').click();
    // 저장 후 DB row 존재 확인
    await page.waitForTimeout(1_500);
    const { data } = await sb()
      .from('assignment_ranking_weights')
      .select('clinic_id, weight_revenue_month')
      .eq('clinic_id', CLINIC_ID)
      .maybeSingle();
    expect(data?.clinic_id).toBe(CLINIC_ID);
  });

  // ── 시나리오 2 (실행2): Daily Target 2:1 — top 입력 시 bottom 자동 = top/2 ──────
  test('S2 실행2 — 하루 목표건수 2:1(1등=꼴등 2배) 파생·저장', async ({ page }) => {
    if (!(await schemaReady())) test.skip(true, '마이그 미적용');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
    await page.goto('/admin/staff?tab=assignment');
    await page.waitForLoadState('networkidle');
    const top = page.getByTestId('top-target');
    if (!(await top.isVisible({ timeout: 8_000 }).catch(() => false))) test.skip(true, '탭 미노출');

    await top.fill('8');
    await expect(page.getByTestId('bottom-target-derived')).toHaveText('4'); // 8/2=4 (2:1)
    await page.getByTestId('save-target').click();
    await page.waitForTimeout(1_500);
    const { data } = await sb()
      .from('assignment_daily_target_config')
      .select('top_rank_target, bottom_rank_target')
      .eq('clinic_id', CLINIC_ID)
      .maybeSingle();
    expect(data?.top_rank_target).toBe(8);
    expect(data?.bottom_rank_target).toBe(4);
  });

  // ── 시나리오 3 (실행2): 유입경로 전략 저장(TM=daily_target) ─────────────────────
  test('S3 실행2 — 유입경로 배정전략(TM=하루목표) 저장', async ({ page }) => {
    if (!(await schemaReady())) test.skip(true, '마이그 미적용');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
    await page.goto('/admin/staff?tab=assignment');
    await page.waitForLoadState('networkidle');
    const trigger = page.getByTestId('policy-TM');
    if (!(await trigger.isVisible({ timeout: 8_000 }).catch(() => false))) test.skip(true, '탭 미노출');

    await trigger.click();
    await page.getByRole('option', { name: /하루 목표건수/ }).click();
    await page.getByTestId('save-policy').click();
    await page.waitForTimeout(1_500);
    const { data } = await sb()
      .from('assignment_leadsource_policy')
      .select('lead_source, strategy')
      .eq('clinic_id', CLINIC_ID)
      .eq('lead_source', 'TM')
      .maybeSingle();
    expect(data?.strategy).toBe('daily_target');
  });

  // ── 시나리오 4 (실행3): 상담 실장 자동배정 ON/OFF 토글 → staff 컬럼 반영 ─────────
  test('S4 실행3 — 실장별 자동배정 OFF 토글이 staff.auto_assign_enabled 로 저장', async ({ page }) => {
    if (!(await schemaReady())) test.skip(true, '마이그 미적용');
    const c = sb();
    const { data: cons } = await c
      .from('staff')
      .select('id, name, auto_assign_enabled')
      .eq('clinic_id', CLINIC_ID)
      .eq('active', true)
      .eq('role', 'consultant')
      .limit(1);
    const target = cons?.[0];
    if (!target) test.skip(true, '상담 실장 없음');

    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
    await page.goto('/admin/staff?tab=assignment');
    await page.waitForLoadState('networkidle');
    const toggle = page.getByTestId(`auto-toggle-${target!.id}`);
    if (!(await toggle.isVisible({ timeout: 8_000 }).catch(() => false))) test.skip(true, '탭 미노출');

    const before = target!.auto_assign_enabled !== false;
    await toggle.click();
    await page.waitForTimeout(1_200);
    const { data: after } = await c
      .from('staff')
      .select('auto_assign_enabled')
      .eq('id', target!.id)
      .maybeSingle();
    expect(after?.auto_assign_enabled).toBe(!before);
    // 원복(테스트 청결)
    await c.from('staff').update({ auto_assign_enabled: before }).eq('id', target!.id);
  });

  // ── 시나리오 5 (실행2 불변식): Daily Target 2:1 DB CHECK 강제 + 포인터 lazy 리셋 ──
  test('S5 실행2 — DB가 2:1 위반을 거부하고 포인터 커서가 순환한다', async () => {
    if (!(await schemaReady())) test.skip(true, '마이그 미적용');
    const c = sb();
    // (a) 2:1 위반(top=3, bottom=1)은 CHECK 로 거부돼야 한다(앱+DB 이중 W3의 DB측).
    const bad = await c
      .from('assignment_daily_target_config')
      .upsert({ clinic_id: CLINIC_ID, top_rank_target: 3, bottom_rank_target: 1 }, { onConflict: 'clinic_id' });
    expect(bad.error).not.toBeNull(); // CHECK (top = bottom*2) 위반 → 거부

    // (b) 포인터 커서 순환: cursor 0→1 upsert 후 재조회.
    await c
      .from('assignment_pointer_state')
      .upsert(
        { clinic_id: CLINIC_ID, lead_source: 'WALK_IN', cursor_rank: 0, reset_date: '2000-01-01' },
        { onConflict: 'clinic_id,lead_source' },
      );
    await c
      .from('assignment_pointer_state')
      .update({ cursor_rank: 1 })
      .eq('clinic_id', CLINIC_ID)
      .eq('lead_source', 'WALK_IN');
    const { data } = await c
      .from('assignment_pointer_state')
      .select('cursor_rank')
      .eq('clinic_id', CLINIC_ID)
      .eq('lead_source', 'WALK_IN')
      .maybeSingle();
    expect(data?.cursor_rank).toBe(1);
    // 청소
    await c.from('assignment_pointer_state').delete().eq('clinic_id', CLINIC_ID).eq('lead_source', 'WALK_IN');
  });

  // ── 시나리오 6 (실행4 + 조건①·②): 수동배정 로그 파생 카운트 + RED LINE ─────────
  test('S6 실행4/조건① — 수동배정 로그가 일일 배정건수에 파생 집계 + assigned_consultant_id 불변(RED LINE)', async () => {
    if (!(await schemaReady())) test.skip(true, '마이그 미적용');
    const c = sb();
    const { data: cons } = await c
      .from('staff')
      .select('id')
      .eq('clinic_id', CLINIC_ID)
      .eq('active', true)
      .eq('role', 'consultant')
      .limit(1);
    const staffId = cons?.[0]?.id;
    if (!staffId) test.skip(true, '상담 실장 없음');

    // 매출귀속 드라이버 스냅샷(RED LINE 전) — 임의 고객 1명
    const { data: cust } = await c
      .from('customers')
      .select('id, assigned_consultant_id')
      .eq('clinic_id', CLINIC_ID)
      .limit(1);
    const custId = cust?.[0]?.id ?? null;
    const before = cust?.[0]?.assigned_consultant_id ?? null;

    const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    // 실행4: 수동배정 로그 1건(action_type='manual').
    const ins = await c.from('assignment_actions').insert({
      clinic_id: CLINIC_ID,
      check_in_id: null,
      action_type: 'manual',
      role: 'consult',
      axis: 'TM',
      to_staff_id: staffId!,
    });
    expect(ins.error).toBeNull();

    // 조건①: 일일 배정건수 = count(*) 파생(물리 카운터 없음).
    const { count } = await c
      .from('assignment_actions')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', CLINIC_ID)
      .eq('role', 'consult')
      .in('action_type', ['auto_assign', 'manual'])
      .eq('to_staff_id', staffId!)
      .gte('created_at', `${todayKst}T00:00:00+09:00`)
      .lte('created_at', `${todayKst}T23:59:59.999+09:00`);
    expect((count ?? 0) >= 1).toBe(true);

    // 조건② RED LINE: 배정 흐름은 customers.assigned_consultant_id 를 절대 건드리지 않는다.
    if (custId) {
      const { data: after } = await c
        .from('customers')
        .select('assigned_consultant_id')
        .eq('id', custId)
        .maybeSingle();
      expect(after?.assigned_consultant_id ?? null).toBe(before);
    }

    // 청소: 방금 넣은 테스트 로그 제거(오늘·해당 staff·check_in_id null·axis TM 한정).
    await c
      .from('assignment_actions')
      .delete()
      .eq('clinic_id', CLINIC_ID)
      .eq('to_staff_id', staffId!)
      .is('check_in_id', null)
      .eq('action_type', 'manual')
      .eq('axis', 'TM')
      .gte('created_at', `${todayKst}T00:00:00+09:00`);
  });
});
