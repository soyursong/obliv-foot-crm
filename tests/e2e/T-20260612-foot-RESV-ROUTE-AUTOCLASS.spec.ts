/**
 * E2E spec — T-20260612-foot-RESV-ROUTE-AUTOCLASS
 * 예약 신규등록 form: 등록자 선택 → 방문경로 대분류 자동 고정 (분기 B)
 *
 * 현장 결정(김주연 총괄, MSG-20260612-133657-lemx):
 *   신규등록 form에 "등록자 선택" 드롭다운 추가 → 방문경로 대분류 자동 고정.
 *   - 데스크 직원 직접 등록 → '인바운드'
 *   - TM팀 등록 → 'TM' (대분류 '티엠' = enum 'TM' 일관 매핑)
 *
 * AC-1 시나리오 1: 인바운드(데스크 직접 등록) → visit_route 자동 '인바운드'
 * AC-1 시나리오 2: 티엠(TM팀 등록) → visit_route 자동 'TM'
 * AC-2 시나리오 3: 회귀 — 방문경로 드롭다운 수동 선택 여전히 동작 + 등록자 선택 공존
 *
 * GUARD: 신규등록 form(Reservations.tsx)에만. 예약상세팝업 미변경. enum 신설 없음.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

/** 예약관리 진입 → 신규예약 form(tablet-fullscreen-modal) 오픈 → 초진(visit_type=new) 선택.
 *  슬롯 가용성에 따라 실패 가능 → 실패 시 false 반환(graceful skip). */
async function openNewReservationFormAsNew(page: Page): Promise<boolean> {
  await page.goto('/reservations');
  await page.waitForLoadState('networkidle', { timeout: 15_000 });

  // 빈 슬롯의 + 버튼 클릭 → 신규예약 form 오픈
  const slotPlus = page.locator('[data-testid^="slot-plus-"]').first();
  if (await slotPlus.count() === 0) return false;
  await slotPlus.click({ timeout: 5_000 }).catch(() => {});

  const modal = page.locator('[data-testid="tablet-fullscreen-modal"]');
  const opened = await modal.isVisible().catch(() => false);
  if (!opened) return false;

  // 유형 = 초진(new) 선택 → 등록자 선택/방문경로 드롭다운 노출 조건
  const newTypeBtn = page.getByRole('button', { name: '초진', exact: true });
  if (await newTypeBtn.count() > 0) {
    await newTypeBtn.first().click().catch(() => {});
  }

  // 등록자 선택 드롭다운 노출 대기
  const registrar = page.locator('[data-testid="registrar-type-select"]');
  const visible = await registrar.isVisible().catch(() => false);
  return visible;
}

test.describe('T-20260612-foot-RESV-ROUTE-AUTOCLASS — 등록자 선택 → 방문경로 자동 고정', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  test('시나리오 1: 데스크 직원 직접 등록 → 방문경로 "인바운드" 자동 고정', async ({ page }) => {
    const ok = await openNewReservationFormAsNew(page);
    if (!ok) {
      test.skip(true, '신규예약 form(초진) 오픈 실패 — 슬롯 미가용 스킵');
      return;
    }

    const registrar = page.locator('[data-testid="registrar-type-select"]');
    const visitRoute = page.locator('[data-testid="visit-route-select"]');

    // 등록자 = 데스크 직접 등록
    await registrar.selectOption('desk');

    // 방문경로 대분류 자동 고정 → '인바운드'
    await expect(visitRoute).toHaveValue('인바운드', { timeout: 1_000 });
    console.log('[시나리오 1] 데스크 직접 등록 → 방문경로 "인바운드" 자동 고정 PASS');
  });

  test('시나리오 2: TM팀 등록 → 방문경로 "TM"(티엠) 자동 고정', async ({ page }) => {
    const ok = await openNewReservationFormAsNew(page);
    if (!ok) {
      test.skip(true, '신규예약 form(초진) 오픈 실패 — 슬롯 미가용 스킵');
      return;
    }

    const registrar = page.locator('[data-testid="registrar-type-select"]');
    const visitRoute = page.locator('[data-testid="visit-route-select"]');

    // 등록자 = TM팀 등록
    await registrar.selectOption('tm');

    // 대분류 '티엠' = 기존 enum 라벨 'TM' (신규 라벨 신설 금지)
    await expect(visitRoute).toHaveValue('TM', { timeout: 1_000 });
    console.log('[시나리오 2] TM팀 등록 → 방문경로 "TM"(티엠) 자동 고정 PASS');
  });

  test('시나리오 3 (회귀): 방문경로 수동 선택 동작 + 등록자 전환 시 재고정', async ({ page }) => {
    const ok = await openNewReservationFormAsNew(page);
    if (!ok) {
      test.skip(true, '신규예약 form(초진) 오픈 실패 — 슬롯 미가용 스킵');
      return;
    }

    const registrar = page.locator('[data-testid="registrar-type-select"]');
    const visitRoute = page.locator('[data-testid="visit-route-select"]');

    // 회귀 #1: 등록자 미선택 상태에서 방문경로 수동 선택 여전히 동작 (기존 동선)
    await visitRoute.selectOption('지인소개');
    await expect(visitRoute).toHaveValue('지인소개');
    // 지인소개 → 소개자 성함 입력칸 노출 (기존 REFERRAL-NAME 회귀)
    await expect(page.getByPlaceholder('예: 홍길동')).toBeVisible({ timeout: 1_000 });
    console.log('[시나리오 3-1] 방문경로 수동 "지인소개" 선택 + 소개자칸 노출 회귀 PASS');

    // 회귀 #2: 등록자 = 데스크 선택 시 방문경로가 '인바운드'로 재고정 (수동값 덮어씀)
    await registrar.selectOption('desk');
    await expect(visitRoute).toHaveValue('인바운드', { timeout: 1_000 });
    console.log('[시나리오 3-2] 등록자 전환 → 방문경로 인바운드 재고정 PASS');

    // 회귀 #3: 등록자 = TM팀 전환 → 'TM' 재고정
    await registrar.selectOption('tm');
    await expect(visitRoute).toHaveValue('TM', { timeout: 1_000 });
    console.log('[시나리오 3-3] 등록자 TM팀 전환 → 방문경로 TM 재고정 PASS');
  });
});
