/**
 * T-20260817-foot-DIRECTORINFO-HEADER-NAME-MISMATCH
 *
 * 버그: 직원·공간 > 원장정보 탭에서 박스 헤더(원장 성함) ↔ 박스 안 성명 필드 불일치.
 *   재현: 원장정보 목록 위/아래 순서 변경 버튼 클릭 후.
 * 근본원인: ClinicSettings.tsx 헤더가 doctors[idx](DB 원본 고정배열) 를 읽고,
 *   폼 필드는 doctorForms[idx](UI 재정렬 상태) 를 읽음 → 위/아래 swap 시 doctorForms 만 이동.
 * 수정: 헤더 표시 소스를 map 콜백의 form.name 으로 통일 → 재정렬 반영 상태로 정합.
 *
 * 순수 표시 계층 정합 검증. 저장/write 경로·순서 실제 반영·권한 무접촉.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('원장정보 헤더↔성명 정합 (순서 변경 후)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded');
  });

  test('위/아래 순서 변경 후 각 박스 헤더 == 성명 입력값', async ({ page }) => {
    // 설정 > 직원·공간 > 원장정보 진입
    await page.goto('/settings');
    await page.waitForTimeout(1500);

    // 원장정보 섹션이 없으면(권한/미노출) skip
    const doctorCards = page.locator('div.rounded-md.border').filter({
      has: page.locator('input'),
    });

    // 성명 입력 + 헤더 span 쌍을 담는 박스 후보 탐색
    const nameInputs = page.getByPlaceholder(/성함|이름|성명/);
    const count = await nameInputs.count();
    if (count < 2) {
      test.skip(true, `원장 2명 미만(count=${count}) — 재정렬 검증 불가`);
    }

    // 위로/아래로 버튼 존재 확인
    const upBtns = page.locator('button[title="위로"]');
    const downBtns = page.locator('button[title="아래로"]');
    if ((await downBtns.count()) === 0) {
      test.skip(true, '순서 변경 버튼 미노출(권한 없음)');
    }

    // 헤더 성함 ↔ 성명 필드가 동일 박스 안에서 일치하는지 검사하는 헬퍼
    const assertConsistent = async () => {
      const cards = doctorCards;
      const n = await cards.count();
      for (let i = 0; i < n; i++) {
        const card = cards.nth(i);
        const header = (await card.locator('span.font-semibold').first().textContent())?.trim() ?? '';
        const nameVal = (await card.locator('input').first().inputValue())?.trim() ?? '';
        if (nameVal) {
          expect(header, `박스 ${i}: 헤더 != 성명`).toBe(nameVal);
        }
      }
    };

    // 초기 정합
    await assertConsistent();

    // 첫 박스를 아래로 이동 → swap 후 정합 유지되어야 함
    await downBtns.first().click();
    await page.waitForTimeout(300);
    await assertConsistent();

    // 두 번째 박스를 위로 이동(원복 방향) → 여전히 정합
    await upBtns.nth(1).click();
    await page.waitForTimeout(300);
    await assertConsistent();
  });
});
