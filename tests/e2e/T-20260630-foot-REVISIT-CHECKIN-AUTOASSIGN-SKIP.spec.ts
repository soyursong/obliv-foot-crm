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
 * 검증(현장 클릭 시나리오 + 회귀 전수):
 *  S1 [폐기 — T-20260701-foot-REVISIT-SKIP-SPEC-MARQUEE-REFRESH]: 06-29 종→마키 이전으로 진입점 소멸 +
 *      S3/FULLSKIP Part B S1 과 커버리지 중복 → 폐기(하단 폐기 사유 주석 참조).
 *  S2 (AC-2/AC-4): 신규/워크인 배정(reason=null) → 알림 노출(회귀0).
 *  S3 (AC-3): 재진 휴무 fallback(reason=null) → 알림 노출 + sentinel 행은 표시만 제외(혼재 시 정상행만 노출).
 *              진입점을 마키(전광판) 클릭으로 재정합(06-29 종 이전 반영).
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

  // ── S1: 폐기(T-20260701-foot-REVISIT-SKIP-SPEC-MARQUEE-REFRESH) ─────────────────
  //   [폐기 사유]
  //   원 S1 의도 = '재진 지정담당 정상배정(sentinel)만 있으면 알림 미노출'을 대시보드 종(assign-notify-bell)
  //   +패널을 열어 sentinel 고객 부재로 검증. 그러나 T-20260629-foot-STAFFASSIGN-ALERT-MOVE-MARQUEE(deployed
  //   06-29)가 배정 알림 종을 대시보드에서 제거(showBell={false}, 마키/전광판으로 진입점 이전)하면서
  //   assign-notify-bell 이 대시보드에 더는 렌더되지 않아 진입점이 소멸 → 본 케이스가 stale 로 사전 실패했다.
  //   진입점을 마키(assign-notify-marquee)로 재정합하려면 마키가 뜨도록 대조용 null-reason 행을 동반 시드해야
  //   하는데, 그 형태는 아래 S3(혼재: normal 노출·sentinel 제외) 및 신규 spec
  //   T-20260701-foot-REVISIT-CONSULT-ALERT-FULLSKIP Part B S1(대조 초진행 동반·마키/패널에서 sentinel 제외)
  //   과 커버리지가 완전히 중복된다. 또한 sentinel 단독 시드는 unreadCount=0 → 마키 자체가 렌더되지 않아
  //   '단독 미노출'을 robust 하게 단언할 진입점이 없다(원 코드도 marquee 전역 hidden 단언을 공유 DB 취약성으로
  //   회피했음). → 중복·비검증가능 → 폐기. sentinel 억제 커버리지는 S3 + FULLSKIP Part B S1 이 유지한다.

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
    // sentinel(재진 지정담당) 고객은 전광판에서도 제외.
    await expect(marquee).not.toContainText(silentSeed!.name);

    // 패널: 정상행만 노출, sentinel 고객은 제외.
    //   ※ T-20260701-foot-REVISIT-SKIP-SPEC-MARQUEE-REFRESH: 06-29 종 이전(showBell={false})으로
    //     대시보드에 assign-notify-bell 이 없다 → 패널 진입점을 마키(전광판) 클릭으로 재정합(FULLSKIP 패턴).
    //   ※ 성함은 칸반 카드에도 뜨므로 '패널 내부'로 스코프하여 검사.
    const panel = page.getByTestId('assign-notify-panel');
    await marquee.click();
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
