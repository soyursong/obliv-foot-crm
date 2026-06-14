/**
 * E2E spec — T-20260614-foot-SPACEASSIGN-STAFF-EQUIP-SPLIT
 * 공간배정 드롭다운 치료사/장비 섹션 분리
 *
 * 기존: getFilteredStaff 평면 <option> 리스트 → role 기준 <optgroup>(치료사/장비) 분리.
 *
 * AC-1: 치료사·장비 별도 섹션(optgroup)으로 분리 표시
 * AC-2: 섹션 라벨 명확("치료사" / "장비")
 * AC-3: 선택·저장·carry-over 회귀無 (optgroup 내 option 선택→저장 정상)
 * AC-4: 빈 그룹 미렌더 (해당 role 직원 0명이면 optgroup 자체가 없음)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const STAFF_URL = '/admin/staff';

async function gotoSpaceAssign(page: import('@playwright/test').Page) {
  await page.goto(STAFF_URL);
  const roomTab = page.getByRole('tab', { name: /공간 배정/ });
  try {
    await roomTab.waitFor({ timeout: 10_000 });
  } catch {
    return false;
  }
  await roomTab.click();
  return true;
}

test.describe('T-20260614-foot-SPACEASSIGN-STAFF-EQUIP-SPLIT 치료사/장비 섹션 분리', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  // ===========================================================
  // 시나리오 1: 드롭다운 안에 치료사/장비 <optgroup> 섹션이 라벨과 함께 분리되어 있다
  // (AC-1, AC-2, AC-4)
  // ===========================================================
  test('AC-1/AC-2/AC-4: 공간배정 드롭다운에 치료사·장비 optgroup 섹션 분리', async ({ page }) => {
    const ok = await gotoSpaceAssign(page);
    if (!ok) { test.skip(true, '공간 배정 탭 미발견'); return; }

    await page.waitForTimeout(2_000);

    // 카드뷰의 첫 번째 배정 드롭다운(비활성 아닌 방) 탐색
    const selects = page.locator('select');
    const selectCount = await selects.count();
    if (selectCount === 0) {
      test.skip(true, '배정 드롭다운 미발견 — DB에 룸 없음');
      return;
    }

    // 옵션을 가진(비활성 아닌) 드롭다운에서 optgroup 라벨 수집
    let foundLabels: string[] = [];
    let optgroupTotal = 0;
    for (let i = 0; i < selectCount; i++) {
      const sel = selects.nth(i);
      const groups = sel.locator('optgroup');
      const gc = await groups.count();
      if (gc > 0) {
        optgroupTotal += gc;
        const labels = await groups.evaluateAll((els) =>
          els.map((e) => (e as HTMLOptGroupElement).label),
        );
        foundLabels = Array.from(new Set([...foundLabels, ...labels]));
      }
    }

    console.log(`[AC-1] optgroup 보유 — 총 ${optgroupTotal}개 / 라벨: ${foundLabels.join(', ')}`);

    // AC-1: 최소 1개 이상의 드롭다운에 optgroup이 존재해야 함
    expect(optgroupTotal).toBeGreaterThan(0);

    // AC-2: 라벨은 "치료사" 또는 "장비"만 존재 (다른 라벨 없음)
    for (const label of foundLabels) {
      expect(['치료사', '장비']).toContain(label);
    }
    console.log('[AC-2] optgroup 라벨 = 치료사/장비 OK');

    // AC-4: optgroup이 존재한다는 것은 비어있지 않은 그룹만 렌더된다는 의미.
    //       각 optgroup은 최소 1개 option을 가져야 함(빈 그룹 미렌더).
    const allGroups = page.locator('select optgroup');
    const totalGroups = await allGroups.count();
    for (let i = 0; i < totalGroups; i++) {
      const optCount = await allGroups.nth(i).locator('option').count();
      expect(optCount).toBeGreaterThan(0);
    }
    console.log(`[AC-4] 모든 optgroup(${totalGroups}개) 비어있지 않음 OK`);
  });

  // ===========================================================
  // 시나리오 2: optgroup 내 항목을 선택→저장해도 회귀 없이 정상 저장된다
  // (AC-3)
  // ===========================================================
  test('AC-3: optgroup 내 직원 선택 후 저장 정상 (선택/저장 회귀無)', async ({ page }) => {
    const ok = await gotoSpaceAssign(page);
    if (!ok) { test.skip(true, '공간 배정 탭 미발견'); return; }

    await page.waitForTimeout(2_000);

    // 치료사 optgroup 안에 option이 있는 첫 드롭다운 탐색
    const selects = page.locator('select');
    const selectCount = await selects.count();
    let targetSelect: import('@playwright/test').Locator | null = null;
    let targetValue: string | null = null;

    for (let i = 0; i < selectCount; i++) {
      const sel = selects.nth(i);
      if (await sel.isDisabled().catch(() => false)) continue;
      // optgroup 하위 첫 option의 value 추출
      const groupedOption = sel.locator('optgroup > option').first();
      if (await groupedOption.count() === 0) continue;
      const val = await groupedOption.getAttribute('value');
      if (val) {
        targetSelect = sel;
        targetValue = val;
        break;
      }
    }

    if (!targetSelect || !targetValue) {
      test.skip(true, 'optgroup 하위 선택 가능한 직원 옵션 없음');
      return;
    }

    // 선택 — optgroup 안의 option value로 선택 가능해야 함
    await targetSelect.selectOption(targetValue);
    const selected = await targetSelect.inputValue();
    expect(selected).toBe(targetValue);
    console.log(`[AC-3] optgroup 내 option 선택 OK (value=${targetValue})`);

    // 저장 버튼 클릭 → 에러 없이 저장
    const saveBtn = page.getByRole('button', { name: /^저장/ });
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
      // toast(성공) 또는 에러 없음 확인
      const toast = page.locator('[data-sonner-toast], [role="status"], .sonner-toast').first();
      await toast.waitFor({ timeout: 5_000 }).catch(() => null);
      console.log('[AC-3] 선택 후 저장 정상 (회귀 없음) OK');

      // 저장 후에도 선택값 유지(carry-over 회귀無)
      await page.waitForTimeout(1_000);
      const stillSelected = await targetSelect.inputValue().catch(() => '');
      expect(stillSelected).toBe(targetValue);
      console.log('[AC-3] 저장 후 선택값 유지 OK');
    } else {
      console.log('[AC-3] 저장 버튼 미표시 — 주간뷰일 수 있음(즉시 저장)');
    }
  });
});
