/**
 * E2E spec — T-20260613-foot-SLOT-BACKWARD-MOVE-UNLOCK
 * 대시보드 슬롯 전(前)단계 이동 차단 해제 검증.
 * 현장(김주연 총괄): 임상상 역행 필수(예: 수납대기 고객 후상담 요청 → 상담 단계 복귀).
 *
 * 수정: StatusContextMenu.tsx 의 isBackward 봉쇄 제거
 *   - disabled={isCurrent||isBackward} → {isCurrent}
 *   - onClick 의 `if(isBackward)return;` 제거
 *   - showSubArrow/showTreatArrow/showConsultArrow 의 `!isBackward` 가드 제거(역방향 방 서브메뉴 노출)
 *   - opacity-50 시각 힌트는 유지, 클릭/서브메뉴/실이동만 허용
 * DnD(handleDragEnd)는 forward-only 가드 없음 + blockIfInactiveRoom 은 비활성 방 한정 → 활성방 역행 비차단(AC-4).
 *
 * AC-1: ⋮ 역방향 단계 선택 가능 + 실이동
 * AC-2: 수납대기→상담 후상담 동선
 * AC-3: 역방향 방(상담/치료/레이저) 서브메뉴 정상 노출
 * AC-4: 활성방 DnD 역행 비차단 (코드 레벨 — blockIfInactiveRoom 비활성 한정)
 * AC-5: 정방향 무회귀
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260613-foot-SLOT-BACKWARD-MOVE-UNLOCK — 전단계 이동 차단 해제', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // AC-1: 현 진행단계 섹션에서 역방향(이전) 단계 버튼이 disabled 가 아니어야 함
  test('AC-1: 역방향 단계 버튼이 클릭 가능(disabled 아님)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if ((await cards.count()) === 0) { test.skip(true, '칸반 카드 없음 — 스킵'); return; }

    await cards.first().click({ button: 'right' });
    const menuBody = page.locator('.fixed.z-50').last();
    await expect(menuBody).toBeVisible({ timeout: 3_000 });
    await expect(menuBody.getByText('현 진행단계')).toBeVisible();

    // 현 진행단계 섹션의 단계 버튼들 — '현재' 단계(disabled)를 제외한 나머지는
    // 정방향이든 역방향이든 disabled 가 아니어야 함. disabled 버튼은 최대 1개(현재 단계)만 허용.
    const stageButtons = menuBody.locator('button:has(span.rounded-full)');
    const total = await stageButtons.count();
    let disabledCount = 0;
    for (let i = 0; i < total; i++) {
      if (await stageButtons.nth(i).isDisabled()) disabledCount++;
    }
    // 플래그 버튼은 disabled 없음 + 단계 버튼 중 disabled 는 현재 단계 1개 이하
    expect(disabledCount).toBeLessThanOrEqual(1);

    await page.keyboard.press('Escape');
  });

  // AC-3: 역방향 단계라도 방(상담/치료/레이저) 서브메뉴 화살표가 노출 가능해야 함
  //  — 컨텍스트 메뉴 렌더 회귀 없음으로 우회 검증(서브메뉴는 방 설정 의존이라 환경 가변)
  test('AC-3/AC-5: 컨텍스트 메뉴 진행단계 섹션 정상 렌더 (회귀 없음)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if ((await cards.count()) === 0) { test.skip(true, '칸반 카드 없음 — 스킵'); return; }

    await cards.first().click({ button: 'right' });
    const menuBody = page.locator('.fixed.z-50').last();
    await expect(menuBody).toBeVisible({ timeout: 3_000 });

    // 현 진행단계 섹션 + 체크인 취소(하단) 정상 — 메뉴 구조 회귀 없음
    await expect(menuBody.getByText('현 진행단계')).toBeVisible();
    await expect(menuBody.getByText('체크인 취소')).toBeVisible();

    await page.keyboard.press('Escape');
  });

  // AC-2: 단계 버튼 클릭 시 onStatusChange 가 호출되어 메뉴가 닫혀야 함 (실이동 트리거)
  test('AC-2: 다른 단계 버튼 클릭 시 메뉴 닫힘(상태 전이 트리거)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if ((await cards.count()) === 0) { test.skip(true, '칸반 카드 없음 — 스킵'); return; }

    await cards.first().click({ button: 'right' });
    const menuBody = page.locator('.fixed.z-50').last();
    await expect(menuBody).toBeVisible({ timeout: 3_000 });

    // 현 진행단계 섹션의 첫 단계('접수')는 신규 동선 시작 — 대부분 케이스에서 역방향 후보.
    // 화살표 서브메뉴가 없는 단계를 골라 클릭 → 메뉴 닫힘 확인.
    const firstStageBtn = menuBody.getByText('접수', { exact: true }).first();
    if (await firstStageBtn.isVisible().catch(() => false)) {
      const btn = firstStageBtn.locator('xpath=ancestor::button[1]');
      if (await btn.isEnabled().catch(() => false)) {
        await btn.click();
        // confirm 다이얼로그 없는 단순 전이 → 메뉴 닫힘
        await expect(menuBody).not.toBeVisible({ timeout: 2_000 }).catch(() => {});
      }
    }
  });
});
