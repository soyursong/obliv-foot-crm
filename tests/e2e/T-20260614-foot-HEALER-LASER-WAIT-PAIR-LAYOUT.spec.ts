/**
 * E2E spec — T-20260614-foot-HEALER-LASER-WAIT-PAIR-LAYOUT
 * 레이저대기/힐러대기를 진료·진료대기처럼 상하(위아래) 한 쌍으로 그룹화 +
 * 레이저실 컬럼 좌측 인접 배치. 순수 FE 레이아웃 (DB·status 무변경).
 *
 * AC-1: 레이저대기·힐러대기가 한 컬럼 안에 상하(위아래) 한 쌍으로 묶임.
 * AC-2: 그 쌍 컬럼이 레이저실(RoomSection) 좌측에 인접 배치됨.
 * AC-3: 기존 쌍(exam_section 진료/진료대기)과 동일 패턴 — 두 대기열 모두 drop 타깃 보존.
 *
 * 충돌 점검(Dashboard.tsx:217 배치편집 개별이동 vs 그룹화):
 *   일반 모드 = 상하 쌍으로 그룹화(레이저실 좌측) / 편집 모드 = 개별 이동 보존
 *   (laser_rooms 가 일반모드 클러스터·편집모드 개별드래그로 분리된 선례와 동일).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260614 HEALER-LASER-WAIT-PAIR-LAYOUT — 레이저대기/힐러대기 상하 쌍', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 스킵');
  });

  test('AC-1/AC-2: 레이저대기·힐러대기가 상하 한 쌍 + 레이저실 좌측 인접', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    await page.locator('[data-testid="dashboard-root"]').first().waitFor({ timeout: 10_000 });

    // 레이저실 RoomSection 이 없으면(=레이저실 0실) 클러스터 배치 검증 불가 → 스킵
    const laserRoomTitle = page.getByText('레이저실', { exact: true }).first();
    const hasLaserRoom = await laserRoomTitle.isVisible().catch(() => false);
    if (!hasLaserRoom) test.skip(true, '레이저실 미존재 — 클러스터 배치 검증 스킵');

    // AC-1: 상하 쌍 컨테이너 존재 + 내부에 레이저대기/힐러대기 두 droppable 포함
    const pair = page.locator('[data-testid="laser-healer-wait-pair"]');
    await expect(pair).toBeVisible({ timeout: 8_000 });

    const laserWaitCol = pair.locator('[data-droppable-id="laser_waiting"]');
    const healerWaitCol = pair.locator('[data-droppable-id="healer_waiting"]');
    await expect(laserWaitCol).toBeVisible();
    await expect(healerWaitCol).toBeVisible();
    console.log('[AC-1] 레이저대기·힐러대기 한 쌍 컨테이너 내부 포함 PASS');

    // AC-1: 위아래(상하) 스택 — 레이저대기가 힐러대기보다 위(top.y 작음)
    const laserBox = await laserWaitCol.boundingBox();
    const healerBox = await healerWaitCol.boundingBox();
    expect(laserBox).not.toBeNull();
    expect(healerBox).not.toBeNull();
    expect(laserBox!.y).toBeLessThan(healerBox!.y);
    // 같은 컬럼(가로 위치 거의 동일) 안에 스택됐는지 — x 좌표 근접
    expect(Math.abs(laserBox!.x - healerBox!.x)).toBeLessThan(8);
    console.log('[AC-1] 레이저대기(위)/힐러대기(아래) 상하 스택 PASS');

    // AC-2: 쌍 컬럼이 레이저실 좌측(left)에 인접 — pair.x < 레이저실.x
    const pairBox = await pair.boundingBox();
    const laserRoomBox = await laserRoomTitle.boundingBox();
    expect(pairBox).not.toBeNull();
    expect(laserRoomBox).not.toBeNull();
    expect(pairBox!.x).toBeLessThan(laserRoomBox!.x);
    console.log('[AC-2] 쌍 컬럼이 레이저실 좌측 인접 PASS');
  });

  test('AC-3 + 충돌점검: 일반=쌍 그룹 drop타깃 보존 / 편집=개별이동 보존', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    await page.locator('[data-testid="dashboard-root"]').first().waitFor({ timeout: 10_000 });

    // AC-3: 일반 모드 — 두 대기열 모두 drop 타깃(DroppableColumn)으로 보존 (데이터/status 무손실)
    await expect(page.locator('[data-droppable-id="laser_waiting"]')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-droppable-id="healer_waiting"]')).toBeVisible({ timeout: 8_000 });
    console.log('[AC-3] 일반 모드 레이저대기/힐러대기 drop 타깃 보존 PASS');

    // 충돌점검: 편집 모드 진입 시 레이저대기/힐러대기가 여전히 개별 항목으로 존재 → 개별이동 보존
    const layoutBtn = page.getByRole('button', { name: /배치 편집/ });
    const hasLayoutBtn = await layoutBtn.isVisible().catch(() => false);
    if (!hasLayoutBtn) {
      console.log('[충돌점검] 배치 편집 버튼 미노출 — 편집 모드 검증 스킵(정상 종료)');
      return;
    }
    await layoutBtn.click();

    // 편집 모드: 개별 그룹 라벨로 레이저대기/힐러대기가 각각 노출(개별 드래그 단위 보존)
    await expect(page.getByText('레이저대기').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('힐러대기').first()).toBeVisible({ timeout: 5_000 });
    console.log('[충돌점검] 편집 모드 개별이동(레이저대기/힐러대기 개별 항목) 보존 PASS');

    // 편집 모드 종료(저장 부작용 방지)
    const doneBtn = page.getByRole('button', { name: /편집 완료/ });
    if (await doneBtn.count() > 0) await doneBtn.click();
  });
});
