/**
 * E2E — T-20260701-foot-REVISIT-CONSULT-ALERT-FULLSKIP
 * 재진(returning) 상담 배정 알림 '완전' 제외 (B→A). 담당 상담사 지정 유무·휴무·미지정 전 조합 미노출.
 *
 * 배경(김주연 총괄, C0ATE5P6JTH):
 *   #1 T-20260630-foot-REVISIT-CHECKIN-AUTOASSIGN-SKIP(deployed 47032992)은 '재진 + 지정담당 정상배정'만
 *   상담 배정 알림을 억제하고, 담당자 휴무·미지정 재진은 fallback 알림을 유지했다(= 현장이 말하는 현재 동작 B).
 *   본 티켓은 그 fallback(B) 잔여 조건을 제거해, 재진이면 담당 상담사 유무 무관 항상 상담 배정 알림을
 *   노출하지 않는다(A). 치료사(therapy) 배정 흐름은 정상 유지(AC-2).
 *
 * 설계(fix-forward, 새 컴포넌트 0):
 *   reason 결정을 순수 함수 resolveAssignReason(SSOT)로 추출 — maybeAutoAssign / NewCheckInDialog 재진 autofill
 *   두 write 경로가 이 함수 하나로 sentinel 을 판정. 재진 consult → 지정/휴무/미지정 전 조합에서 sentinel
 *   → AssignmentNotifyBell(스타일·위치 불변) 노출에서 제외. 배정행은 그대로 INSERT(카운트 SSOT 보존).
 *
 * 검증:
 *   Part A (순수 함수 — B→A 판정 전수, auth 불요):
 *     - 재진 consult × {지정정상 / 휴무fallback / 시트미매칭fallback / 미지정} → 전부 sentinel  ← B→A 핵심
 *     - 초진(new)/워크인 consult → sentinel 아님(AC-3 회귀0)
 *     - 재진/초진 therapy → 기존 로직 불변(AC-2): 지정정상 sentinel · fallback 경고태그 유지
 *   Part B (현장 클릭 시나리오 3종 — bell UI, 시드 회수):
 *     - S1(시나리오1): 재진 지정담당(sentinel) → 알림 미노출(기존 유지)
 *     - S2(시나리오2, B→A): 재진 휴무/미지정(이제 sentinel) → 알림 미노출
 *     - S3(시나리오3): 초진(null) → 알림 노출(회귀0)
 *     - S4(회귀): sentinel 행도 assignment_actions 에 그대로 존재(카운트 SSOT 정합 보존)
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
import {
  resolveAssignReason,
  buildDesignatedFallbackReason,
  ASSIGN_SILENT_REASON,
} from '../../src/lib/autoAssign';

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
  role: 'consult' | 'therapy' = 'consult',
): Promise<string> {
  const { data, error } = await service
    .from('assignment_actions')
    .insert({
      clinic_id: clinicId,
      check_in_id: checkInId,
      action_type: 'auto_assign',
      role,
      axis: 'returning',
      to_staff_id: toStaffId,
      reason,
    })
    .select('id')
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Part A — resolveAssignReason 순수 함수 매트릭스 (B→A 판정 전수, auth/DB 불요)
//   ★ seed-reason UI 테스트는 '코드가 만들어낸 reason' 을 그대로 넣으므로 B(old)와 A(new)를 구분 못 한다.
//     B→A 의 실질(휴무·미지정 재진 consult 도 이제 sentinel)은 이 순수 함수 매트릭스가 유일하게 증명한다.
// ══════════════════════════════════════════════════════════════════════════════
test.describe('T-20260701-REVISIT-CONSULT-ALERT-FULLSKIP · Part A resolveAssignReason(B→A 판정)', () => {
  const tempOffFb = { kind: 'temp_off' as const, staffName: '김실장' };
  const sheetMissFb = { kind: 'not_in_working_ids' as const, staffName: '박실장' };

  // ── 재진 consult: 전 조합 sentinel (AC-1) — B→A 핵심 ──────────────────────────
  test('A1: 재진 consult + 지정담당 정상배정 → sentinel', () => {
    expect(
      resolveAssignReason({ role: 'consult', visitType: 'returning', usedDesignated: true, designatedFallback: null }),
    ).toBe(ASSIGN_SILENT_REASON);
  });

  test('A2(B→A): 재진 consult + 담당 임시휴무 fallback → sentinel (예전 B=알림노출)', () => {
    expect(
      resolveAssignReason({ role: 'consult', visitType: 'returning', usedDesignated: false, designatedFallback: tempOffFb }),
    ).toBe(ASSIGN_SILENT_REASON);
  });

  test('A3(B→A): 재진 consult + 시트미매칭 fallback → sentinel (예전 B=알림노출)', () => {
    expect(
      resolveAssignReason({ role: 'consult', visitType: 'returning', usedDesignated: false, designatedFallback: sheetMissFb }),
    ).toBe(ASSIGN_SILENT_REASON);
  });

  test('A4(B→A): 재진 consult + 담당 미지정(fallback 없음, 균등배정) → sentinel (예전 B=알림노출)', () => {
    expect(
      resolveAssignReason({ role: 'consult', visitType: 'returning', usedDesignated: false, designatedFallback: null }),
    ).toBe(ASSIGN_SILENT_REASON);
  });

  // ── 초진/워크인 consult: 미노출 대상 아님 (AC-3 회귀0) ───────────────────────────
  test('A5: 초진(new) consult + 미지정 → null(알림 노출 유지)', () => {
    expect(
      resolveAssignReason({ role: 'consult', visitType: 'new', usedDesignated: false, designatedFallback: null }),
    ).toBeNull();
  });

  test('A6: 초진(new) consult + fallback → fallback 경고태그(sentinel 아님)', () => {
    expect(
      resolveAssignReason({ role: 'consult', visitType: 'new', usedDesignated: false, designatedFallback: tempOffFb }),
    ).toBe(buildDesignatedFallbackReason('temp_off', '김실장'));
  });

  test('A7: 워크인(visit_type null) consult → null', () => {
    expect(
      resolveAssignReason({ role: 'consult', visitType: null, usedDesignated: false, designatedFallback: null }),
    ).toBeNull();
  });

  // ── 치료사(therapy) 경로 불변 (AC-2 영향 0) ────────────────────────────────────
  test('A8(AC-2): 재진 therapy + 지정 정상배정 → sentinel (기존 동작 그대로 유지)', () => {
    expect(
      resolveAssignReason({ role: 'therapy', visitType: 'returning', usedDesignated: true, designatedFallback: null }),
    ).toBe(ASSIGN_SILENT_REASON);
  });

  test('A9(AC-2): 재진 therapy + fallback → fallback 경고태그(SHEET-MATCH-GUARD 운영자 경고 유지)', () => {
    expect(
      resolveAssignReason({ role: 'therapy', visitType: 'returning', usedDesignated: false, designatedFallback: sheetMissFb }),
    ).toBe(buildDesignatedFallbackReason('not_in_working_ids', '박실장'));
  });

  test('A10(AC-2): 재진 therapy + 미지정 균등 → null(알림 노출 — 치료사 배정 인지 유지)', () => {
    expect(
      resolveAssignReason({ role: 'therapy', visitType: 'returning', usedDesignated: false, designatedFallback: null }),
    ).toBeNull();
  });

  test('A11(AC-2): 초진 therapy + fallback → fallback 경고태그', () => {
    expect(
      resolveAssignReason({ role: 'therapy', visitType: 'new', usedDesignated: false, designatedFallback: tempOffFb }),
    ).toBe(buildDesignatedFallbackReason('temp_off', '김실장'));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Part B — 현장 클릭 시나리오 3종 (bell UI, 시드 회수)
// ══════════════════════════════════════════════════════════════════════════════
test.describe('T-20260701-REVISIT-CONSULT-ALERT-FULLSKIP · Part B 알림 노출(bell UI)', () => {
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

  // ── S1(시나리오1): 재진 지정담당 → 알림 미노출 (기존 유지) ─────────────────────────
  //   대시보드는 showBell={false}(마키만 노출) — 진입점=전광판(마키). 마키가 뜨려면 미읽음 1건 필요하므로
  //   대조용 '초진(null)' 행을 동반 시드해 마키를 띄우고, 그 안에 sentinel(재진) 고객이 없는지로 억제를 검증.
  test('S1(시나리오1): 재진 지정담당(sentinel)은 전광판/패널에 노출되지 않는다(대조 초진행만 노출)', async ({ page }) => {
    const silentSeed = await seedTodayActiveCheckin(service, clinicId);
    const controlSeed = await seedTodayActiveCheckin(service, clinicId);
    expect(silentSeed).not.toBeNull();
    expect(controlSeed).not.toBeNull();
    seeds.push(silentSeed!, controlSeed!);
    actionIds.push(await insertAction(clinicId, silentSeed!.checkInId, staffId, ASSIGN_SILENT_REASON));
    actionIds.push(await insertAction(clinicId, controlSeed!.checkInId, staffId, null));

    const ok = await gotoAdmin(page);
    expect(ok).toBeTruthy();

    const marquee = page.getByTestId('assign-notify-marquee');
    await expect(marquee).toBeVisible({ timeout: 20_000 });
    await expect(marquee).toContainText(controlSeed!.name);
    await expect(marquee).not.toContainText(silentSeed!.name);

    // 패널(마키 클릭 진입)에도 sentinel 고객은 없음.
    const panel = page.getByTestId('assign-notify-panel');
    await marquee.click();
    await expect(panel).toBeVisible();
    await expect(panel.getByText(controlSeed!.name, { exact: false }).first()).toBeVisible();
    await expect(panel.getByText(silentSeed!.name, { exact: false })).toHaveCount(0);
  });

  // ── S2(시나리오2, B→A): 재진 휴무/미지정도 이제 sentinel → 알림 미노출 ────────────────
  //   Part A(A2~A4)가 '재진 휴무/미지정 consult → sentinel' 를 증명 → 여기선 그 sentinel 행이 전광판/패널에서
  //   가려지는지를 확인(체인 완결: 판정 sentinel → 노출 제외). 예전 B에선 이 케이스가 null → 노출됐다.
  test('S2(시나리오2·B→A): 재진 휴무/미지정 배정(sentinel)도 전광판/패널에 노출되지 않는다', async ({ page }) => {
    const silentSeed = await seedTodayActiveCheckin(service, clinicId);
    const controlSeed = await seedTodayActiveCheckin(service, clinicId);
    expect(silentSeed).not.toBeNull();
    expect(controlSeed).not.toBeNull();
    seeds.push(silentSeed!, controlSeed!);
    actionIds.push(await insertAction(clinicId, silentSeed!.checkInId, staffId, ASSIGN_SILENT_REASON));
    actionIds.push(await insertAction(clinicId, controlSeed!.checkInId, staffId, null));

    const ok = await gotoAdmin(page);
    expect(ok).toBeTruthy();

    const marquee = page.getByTestId('assign-notify-marquee');
    await expect(marquee).toBeVisible({ timeout: 20_000 });
    await expect(marquee).toContainText(controlSeed!.name);
    await expect(marquee).not.toContainText(silentSeed!.name);

    const panel = page.getByTestId('assign-notify-panel');
    await marquee.click();
    await expect(panel).toBeVisible();
    await expect(panel.getByText(silentSeed!.name, { exact: false })).toHaveCount(0);
  });

  // ── S3(시나리오3): 초진(null) → 알림 노출 (회귀0) ─────────────────────────────────
  test('S3: 초진/워크인 배정(reason=null)은 전광판/배지가 정상 노출된다(회귀0)', async ({ page }) => {
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

  // ── S4(회귀): sentinel 행도 assignment_actions 에 그대로 존재(카운트 SSOT 정합 보존) ──
  test('S4: sentinel 행도 assignment_actions 에 그대로 INSERT 된다(ASSIGN-COUNT-TOSS-3FIX 보존)', async () => {
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
    expect(data?.action_type).toBe('auto_assign');
    expect(data?.reason).toBe(ASSIGN_SILENT_REASON);
  });
});
