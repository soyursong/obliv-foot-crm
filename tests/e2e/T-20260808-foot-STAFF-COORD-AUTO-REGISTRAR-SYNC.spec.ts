/**
 * T-20260808-foot-STAFF-COORD-AUTO-REGISTRAR-SYNC
 * 코디네이터 직원 신규 등록 시 예약등록자(원내) 목록 자동 연동
 *
 * DA CONSULT-REPLY MSG-20260809-101347-88ke (GO 조건부·verify-gated).
 * forward 메커니즘 = DB 트리거(AFTER INSERT ON staff, role='coordinator' → reservation_registrars 원내).
 *   ⚠ 이 spec 은 마이그(20260809130000_foot_coord_auto_registrar_sync) prod apply(supervisor GO-token) 후에만 PASS.
 *   apply 전에는 트리거 부재로 시나리오1 이 정당 FAIL(=미적용 신호). E2E 는 post-deploy 수용검증(Deploy Flow).
 *
 * 검증:
 *  - 시나리오1 정상동선: 코디네이터 신규 등록 → 예약등록자(원내) 목록에 자동 표시
 *  - 시나리오2 엣지: 비-코디(치료사) 등록 → 예약등록자 목록에 자동추가 안 됨 (H3 role-gate)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 동명이인/잔재 오염 회피용 유니크 마커 (staff_id 키 멱등이라 이름 충돌은 무해하나 검증 명료화)
const STAMP = process.env.COORD_SYNC_STAMP || 'CSYNC';
const COORD_NAME = `자동코디${STAMP}`;
const THERAPIST_NAME = `자동치료${STAMP}`;

async function openAddStaff(page: import('@playwright/test').Page) {
  await page.goto('/admin/staff?tab=staff');
  await page.getByRole('button', { name: /신규 직원/ }).click();
  await expect(page.getByText('신규 직원 등록')).toBeVisible();
}

async function createStaff(page: import('@playwright/test').Page, name: string, roleValue: string) {
  await openAddStaff(page);
  await page.getByPlaceholder('홍길동').fill(name);
  // 역할 native <select> — value 로 canonical role 선택
  await page.locator('select').selectOption(roleValue);
  await page.getByRole('button', { name: /^등록$/ }).click();
  await expect(page.getByText('신규 직원 등록')).toBeHidden({ timeout: 10_000 });
}

test.describe('코디네이터 자동 예약등록자 연동', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    expect(ok).toBeTruthy();
  });

  test('시나리오1: 코디네이터 신규 등록 → 예약등록자(원내) 자동 표시', async ({ page }) => {
    await createStaff(page, COORD_NAME, 'coordinator');

    // 예약등록자 탭 이동 (자동 연동 트리거 결과 확인)
    await page.goto('/admin/staff?tab=registrars');
    await expect(
      page.getByText(COORD_NAME, { exact: false }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('시나리오2(엣지): 비-코디(치료사) 등록 → 예약등록자 미추가 (role-gate H3)', async ({ page }) => {
    await createStaff(page, THERAPIST_NAME, 'therapist');

    await page.goto('/admin/staff?tab=registrars');
    // 치료사는 원내 명단에 자동 유입되면 안 됨
    await expect(page.getByText(THERAPIST_NAME, { exact: false })).toHaveCount(0);
  });
});
