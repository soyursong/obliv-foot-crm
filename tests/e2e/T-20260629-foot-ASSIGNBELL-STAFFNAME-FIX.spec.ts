/**
 * E2E — T-20260629-foot-ASSIGNBELL-STAFFNAME-FIX
 * 배정 알림(종/전광판)에 실제 담당자 이름(staff.name)을 노출한다.
 *
 * 배경: 부모 T-20260629-foot-ASSIGN-ALERT-MARQUEE(deploy-ready, 1ea43b9) 시점,
 *   AssignmentNotifyBell이 staff 조회를 `select('id, name, display_name')`로 했는데
 *   staff 테이블에 display_name 컬럼이 없어(STAFF-NAME-UNIFY 타입만 추가, 미마이그레이션)
 *   select가 400으로 실패 → staffMap이 비어 담당자명이 항상 '담당자'로 폴백되는 버그.
 *   (부모 spec 주석 L101-102에 폴백이 명시되어 있었음 — 본 티켓이 이를 해소)
 *
 * 수정: staff 조회를 `select('id, name')`로 정정(미존재 컬럼 참조 제거).
 *   담당자명 = staff.name. name이 null/빈 값일 때만 기존 '담당자' 폴백 유지.
 *
 * 검증(현장 클릭 시나리오):
 *  S1 (AC-1/AC-2): 전광판 스트립에 실제 담당자 이름(name)이 노출된다('담당자' 폴백 아님).
 *  S2 (AC-2): 종 패널의 알림 항목에도 실제 담당자 이름이 노출된다.
 *  S3 (AC-3): 노출 조건(미읽음 시에만)·모두 읽음 시 사라짐 — 부모 동작 무회귀.
 *
 * 비파괴: 시드(check_in + assignment_actions)는 종료 후 전량 회수.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard, seedTodayActiveCheckin, cleanupSeededCheckin, type SeededCheckin } from '../helpers';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function gotoAdmin(page: Page): Promise<boolean> {
  return loginAndWaitForDashboard(page);
}

test.describe('T-20260629-foot-ASSIGNBELL-STAFFNAME-FIX — 배정 알림 실명 노출', () => {
  let clinicId: string;
  let staffId: string;
  let staffName: string;
  let seed: SeededCheckin | null = null;
  let actionId: string | null = null;

  test.beforeAll(async () => {
    const { data: clinic } = await service
      .from('clinics').select('id').eq('slug', 'jongno-foot').single();
    expect(clinic?.id).toBeTruthy();
    clinicId = clinic!.id;

    // 배정 대상 담당자 1명 확보. staff 테이블엔 display_name 컬럼 없음 → name만 조회.
    // 이름이 비어있지 않은 staff를 골라 '담당자' 폴백과 구별되는 실명 단언이 가능하도록 보장.
    const { data: staffRows } = await service
      .from('staff').select('id, name').eq('clinic_id', clinicId).not('name', 'is', null).limit(20);
    expect(staffRows && staffRows.length > 0).toBeTruthy();
    const named = (staffRows ?? []).find((s) => (s.name ?? '').trim().length > 0 && (s.name ?? '').trim() !== '담당자');
    expect(named, '이름이 채워진 담당자 1명 필요').toBeTruthy();
    staffId = named!.id;
    staffName = (named!.name ?? '').trim();

    // 오늘자 미배정 check_in 1장 + auto_assign 액션 1건 시드 → 전광판 노출 조건 충족
    seed = await seedTodayActiveCheckin(service, clinicId);
    expect(seed).not.toBeNull();
    const { data: act, error } = await service
      .from('assignment_actions')
      .insert({
        clinic_id: clinicId,
        check_in_id: seed!.checkInId,
        action_type: 'auto_assign',
        role: 'consult',
        axis: 'inbound',
        to_staff_id: staffId,
        reason: null,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    actionId = act!.id;
  });

  test.afterAll(async () => {
    if (actionId) await service.from('assignment_actions').delete().eq('id', actionId);
    await cleanupSeededCheckin(service, seed);
  });

  // ── S1: 전광판에 실제 담당자 이름 노출 (핵심 회귀) ───────────────────────────────
  test('S1: 전광판 스트립에 실제 담당자 이름(name)이 노출된다 (담당자 폴백 아님)', async ({ page }) => {
    const ok = await gotoAdmin(page);
    expect(ok).toBeTruthy();

    const marquee = page.getByTestId('assign-notify-marquee');
    await expect(marquee).toBeVisible({ timeout: 20_000 });

    // 고객명 → 담당자 실명 배정. display_name 400 버그 수정 후 staff.name이 정상 노출.
    await expect(marquee).toContainText('담당자 배정 알림');
    await expect(marquee).toContainText(seed!.name);
    await expect(marquee).toContainText(staffName);
    await expect(marquee).toContainText('배정');
  });

  // ── S2: 종 패널 항목에도 실명 노출 ─────────────────────────────────────────────
  test('S2: 종 패널의 배정 항목에 실제 담당자 이름이 노출된다', async ({ page }) => {
    const ok = await gotoAdmin(page);
    expect(ok).toBeTruthy();

    await page.getByTestId('assign-notify-bell').click();
    await expect(page.getByTestId('assign-notify-panel')).toBeVisible();

    const item = page.getByTestId('assign-notify-item').first();
    await expect(item).toBeVisible();
    await expect(item).toContainText(seed!.name);
    await expect(item).toContainText(staffName);
    await expect(item).toContainText('배정됨');
  });

  // ── S3: 노출 조건·모두 읽음 무회귀 (부모 AC-3) ──────────────────────────────────
  test('S3: 모두 읽음 시 전광판/배지가 사라진다 (부모 노출 조건 무회귀)', async ({ page }) => {
    const ok = await gotoAdmin(page);
    expect(ok).toBeTruthy();

    const marquee = page.getByTestId('assign-notify-marquee');
    await expect(marquee).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('assign-notify-bell').click();
    await expect(page.getByTestId('assign-notify-panel')).toBeVisible();
    await page.getByTestId('assign-notify-readall').click();

    await expect(marquee).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId('assign-notify-count')).toHaveCount(0);
  });
});
