/**
 * E2E — T-20260630-foot-REVISIT-CHECKIN-AUTOASSIGN-SKIP
 * 재진 환자 체크인 시 담당자 자동배정 알림/팝업 skip (이미 지정 담당 있음)
 *
 * 배경(김주연 총괄, #풋): 재진 환자는 이미 담당 상담사(assigned_staff_id)가 있어 체크인 시
 *   '담당자 배정 알림'이 redundant. 단 지정 담당이 당일 휴무/미지정인 재진은 fallback + 알림 노출 유지.
 *
 * 설계: 배정행(assignment_actions)은 그대로 INSERT(카운트 SSOT=check_ins, ASSIGN-COUNT-TOSS-3FIX 보존)하되
 *   재진+지정담당 정상배정만 reason=sentinel('silent_revisit_designated') → AssignmentNotifyBell 노출에서 제외.
 *
 * 검증(현장 클릭 시나리오 3종 + 회귀 전수):
 *  S1 (AC-1): 재진 지정담당 정상배정(reason=sentinel) → 알림(전광판/종 배지)에 미노출.
 *  S2 (AC-2/AC-4): 신규/워크인 배정(reason=null) → 알림 노출(회귀0).
 *  S3 (AC-3): 재진 휴무 fallback(reason=null) → 알림 노출 + sentinel 행은 표시만 제외(혼재 시 정상행만 노출).
 *  S4 (회귀): sentinel 행도 assignment_actions 에는 그대로 존재(카운트 정합 보존).
 *
 * 비파괴: 시드(check_in + assignment_actions)는 종료 후 전량 회수.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  loginAndWaitForDashboard,
  seedTodayActiveCheckin,
  cleanupSeededCheckin,
  type SeededCheckin,
} from '../helpers';

// ⚠ 반드시 src/lib/autoAssign.ts 의 ASSIGN_SILENT_REASON 과 동일해야 함(문자열 계약).
const ASSIGN_SILENT_REASON = 'silent_revisit_designated';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function gotoAdmin(page: Page): Promise<boolean> {
  return loginAndWaitForDashboard(page);
}

async function insertAction(
  clinicId: string,
  checkInId: string,
  toStaffId: string,
  reason: string | null,
): Promise<string> {
  const { data, error } = await service
    .from('assignment_actions')
    .insert({
      clinic_id: clinicId,
      check_in_id: checkInId,
      action_type: 'auto_assign',
      role: 'consult',
      axis: 'returning',
      to_staff_id: toStaffId,
      reason,
    })
    .select('id')
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

test.describe('T-20260630-foot-REVISIT-CHECKIN-AUTOASSIGN-SKIP — 재진 담당자 배정 알림 skip', () => {
  let clinicId: string;
  let staffId: string;
  const seeds: SeededCheckin[] = [];
  const actionIds: string[] = [];

  test.beforeAll(async () => {
    const { data: clinic } = await service
      .from('clinics').select('id').eq('slug', 'jongno-foot').single();
    expect(clinic?.id).toBeTruthy();
    clinicId = clinic!.id;

    const { data: staffRows } = await service
      .from('staff').select('id, name').eq('clinic_id', clinicId).limit(1);
    expect(staffRows && staffRows.length > 0).toBeTruthy();
    staffId = staffRows![0].id;
  });

  test.afterAll(async () => {
    for (const id of actionIds) await service.from('assignment_actions').delete().eq('id', id);
    for (const s of seeds) await cleanupSeededCheckin(service, s);
  });

  // ── S1 (AC-1): 재진 지정담당 정상배정(sentinel) → 알림 미노출 ─────────────────────
  test('S1: 재진 지정담당 정상배정(reason=sentinel)만 있으면 전광판/배지가 노출되지 않는다', async ({ page }) => {
    const seed = await seedTodayActiveCheckin(service, clinicId);
    expect(seed).not.toBeNull();
    seeds.push(seed!);
    actionIds.push(await insertAction(clinicId, seed!.checkInId, staffId, ASSIGN_SILENT_REASON));

    const ok = await gotoAdmin(page);
    expect(ok).toBeTruthy();

    // 종 자체는 상시 노출(컴포넌트 불변). AC-1 의 핵심 주장 = sentinel 배정행이 '알림에 나타나지 않는다'.
    //   ※ marquee 전역 hidden 단언은 공유 테스트DB의 타 미읽음 행에 취약 → 'sentinel 고객 부재'로 직접 검증.
    //   ※ 시드 체크인 성함은 대시보드 칸반 카드에도 뜨므로 반드시 '패널/전광판 내부'로 스코프.
    await expect(page.getByTestId('assign-notify-bell')).toBeVisible();

    const panel = page.getByTestId('assign-notify-panel');
    await page.getByTestId('assign-notify-bell').click();
    await expect(panel).toBeVisible();
    // 패널·알림 항목 어디에도 sentinel 고객(재진 지정담당 정상배정)은 없음.
    await expect(panel.getByText(seed!.name, { exact: false })).toHaveCount(0);
    await expect(
      panel.getByTestId('assign-notify-item').filter({ hasText: seed!.name }),
    ).toHaveCount(0);
  });

  // ── S2 (AC-2/AC-4): 신규/워크인 배정(reason=null) → 알림 노출(회귀0) ───────────────
  test('S2: 일반 배정(reason=null)은 전광판/배지가 정상 노출된다(초진·워크인 회귀0)', async ({ page }) => {
    const seed = await seedTodayActiveCheckin(service, clinicId);
    expect(seed).not.toBeNull();
    seeds.push(seed!);
    actionIds.push(await insertAction(clinicId, seed!.checkInId, staffId, null));

    const ok = await gotoAdmin(page);
    expect(ok).toBeTruthy();

    const marquee = page.getByTestId('assign-notify-marquee');
    await expect(marquee).toBeVisible({ timeout: 20_000 });
    await expect(marquee).toContainText('담당자 배정 알림');
    await expect(marquee).toContainText(seed!.name);
  });

  // ── S3 (AC-3): 휴무 fallback(null) + 재진 지정(sentinel) 혼재 → 정상행만 노출 ───────
  test('S3: sentinel + 일반 행 혼재 시, 일반 행만 알림에 노출되고 sentinel 고객은 제외된다', async ({ page }) => {
    const silentSeed = await seedTodayActiveCheckin(service, clinicId);
    const normalSeed = await seedTodayActiveCheckin(service, clinicId);
    expect(silentSeed).not.toBeNull();
    expect(normalSeed).not.toBeNull();
    seeds.push(silentSeed!, normalSeed!);
    actionIds.push(await insertAction(clinicId, silentSeed!.checkInId, staffId, ASSIGN_SILENT_REASON));
    actionIds.push(await insertAction(clinicId, normalSeed!.checkInId, staffId, null));

    const ok = await gotoAdmin(page);
    expect(ok).toBeTruthy();

    const marquee = page.getByTestId('assign-notify-marquee');
    await expect(marquee).toBeVisible({ timeout: 20_000 });
    // 일반(휴무 fallback) 고객은 노출.
    await expect(marquee).toContainText(normalSeed!.name);

    // 패널: 정상행만 노출, sentinel 고객은 제외.
    //   ※ 성함은 칸반 카드에도 뜨므로 '패널 내부'로 스코프하여 검사.
    const panel = page.getByTestId('assign-notify-panel');
    await page.getByTestId('assign-notify-bell').click();
    await expect(panel).toBeVisible();
    await expect(panel.getByText(normalSeed!.name, { exact: false }).first()).toBeVisible();
    await expect(panel.getByText(silentSeed!.name, { exact: false })).toHaveCount(0);
  });

  // ── S4 (회귀): sentinel 행도 assignment_actions 에는 존재(카운트 SSOT 정합 보존) ────
  test('S4: sentinel 행도 assignment_actions 에 그대로 INSERT 되어 있다(ASSIGN-COUNT-TOSS-3FIX 보존)', async () => {
    const seed = await seedTodayActiveCheckin(service, clinicId);
    expect(seed).not.toBeNull();
    seeds.push(seed!);
    const id = await insertAction(clinicId, seed!.checkInId, staffId, ASSIGN_SILENT_REASON);
    actionIds.push(id);

    const { data } = await service
      .from('assignment_actions')
      .select('id, action_type, reason')
      .eq('id', id)
      .single();
    // 알림에서만 제외될 뿐 행 자체는 auto_assign 으로 정상 적재 → 누적/부하 집계 정합 영향 0.
    expect(data?.action_type).toBe('auto_assign');
    expect(data?.reason).toBe(ASSIGN_SILENT_REASON);
  });
});
