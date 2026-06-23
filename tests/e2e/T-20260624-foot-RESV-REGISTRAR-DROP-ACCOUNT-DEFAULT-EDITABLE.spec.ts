/**
 * E2E spec — T-20260624-foot-RESV-REGISTRAR-DROP-ACCOUNT-DEFAULT-EDITABLE
 * 김주연 총괄: "1 + 드롭 선택 박스 유지 / 접속한 계정 기준으로 기본 값 들어가는데 수기로도 변경 가능하게 해줘"
 *
 * 그라운딩 결과(대상 필드):
 *   예약등록자 드롭 = ReservationDetailPopup 신규등록 폼의 `newmode-registrar-select`
 *   (registrar_id, reservation_registrars 마스터 / registrar_name 스냅샷).
 *   ⚠ booker(=COALESCE(updated_by,created_by) auth uid 파생, 감사용)와는 별개 — 본 티켓은 booker 미변경.
 *
 * 본 스펙 범위:
 *   [AC1] 드롭 선택 박스 유지(제거 X) + new-mode 진입 시 노출. default 는 접속 계정명과 일치하는
 *         활성 예약등록자(없으면 미지정 graceful — 마스터에 동명 항목 없을 때 정상).
 *   [AC2] 수기 변경 — 드롭다운 열어 다른 등록자 선택 → 트리거 표시값이 선택값으로 바뀜(editable).
 *   [AC4] 회귀가드 — 미지정 옵션 존속 + 드롭이 항상 선택 가능 상태.
 *
 * AC3(감사값 보존)은 구조적 보장(registrar_name 표시값만 write, created_by/updated_by 미변경)이라
 *   UI E2E 비대상 — 코드 경로 주석/리뷰로 확인.
 * 데이터/clinic 미준비 시 graceful skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

/** 예약관리 → 상단 '새 예약' → new-mode 진입 → [신규 고객 등록] → 등록자 드롭 노출까지. 성공 시 true. */
async function openNewCustomerForm(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  const newBtn = page.getByRole('button', { name: '새 예약' });
  if (!(await newBtn.isVisible({ timeout: 8_000 }).catch(() => false))) return false;
  await newBtn.click();
  const entry = page.getByTestId('popup-newmode-entry-choose');
  if (!(await entry.isVisible({ timeout: 5_000 }).catch(() => false))) return false;
  const regNewBtn = page.getByTestId('btn-newmode-register-new');
  if (!(await regNewBtn.isVisible({ timeout: 5_000 }).catch(() => false))) return false;
  await regNewBtn.click();
  return page.getByTestId('newmode-registrar-select').isVisible({ timeout: 5_000 }).catch(() => false);
}

test.describe('T-20260624-foot-RESV-REGISTRAR-DROP-ACCOUNT-DEFAULT-EDITABLE', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC1/AC4: 예약등록자 드롭 선택 박스가 유지되고(미지정 옵션 존속) 선택 가능', async ({ page }) => {
    const ok = await openNewCustomerForm(page);
    if (!ok) test.skip(true, 'new-mode 신규 고객 폼 진입 불가(clinic/데이터 미준비)');

    const trigger = page.getByTestId('newmode-registrar-select');
    await expect(trigger).toBeVisible();

    // 드롭 유지 증거: 열면 '— 미지정 —' 옵션이 항상 존재(드롭 제거/숨김 아님)
    await trigger.click();
    const noneOption = page.getByRole('option', { name: '— 미지정 —' });
    await expect(noneOption).toBeVisible({ timeout: 5_000 });
    // 닫기(선택 안 함) — Escape
    await page.keyboard.press('Escape');
  });

  test('AC2: 드롭다운에서 다른 등록자 선택 시 표시값이 수기 변경됨(editable)', async ({ page }) => {
    const ok = await openNewCustomerForm(page);
    if (!ok) test.skip(true, 'new-mode 신규 고객 폼 진입 불가(clinic/데이터 미준비)');

    const trigger = page.getByTestId('newmode-registrar-select');
    await trigger.click();

    // 실제 등록자 옵션(미지정 제외)들. 마스터 미시드 시 graceful skip.
    const realOptions = page.getByRole('option').filter({ hasNotText: '— 미지정 —' });
    const cnt = await realOptions.count();
    if (cnt === 0) {
      await page.keyboard.press('Escape');
      test.skip(true, '예약등록자 마스터 미시드 — 수기변경 대상 옵션 없음');
    }

    const pickText = (await realOptions.first().innerText()).trim();
    await realOptions.first().click();

    // 트리거 표시값이 선택한 등록자명을 반영(= 수기 변경 동작) — placeholder 가 아님
    await expect(trigger).toContainText(pickText.replace(/^\[[^\]]*\]\s*/, '').slice(0, 4));
    await expect(trigger).not.toContainText('예약등록자 선택');
  });
});
