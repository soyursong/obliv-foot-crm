/**
 * E2E spec — T-20260629-foot-NEWRESV-REGISTRANT-UUID-LABEL
 * 버그: 신규 예약 모달 '예약등록자' 드롭다운 — 선택 후 표시값이 이름 대신 staff UUID 로 렌더됨.
 *
 * 근본 원인:
 *   @base-ui/react Select.Value 는 children(render-fn) 미제공 시 raw value(=registrar_id UUID)를 그대로 렌더.
 *   드롭다운 '목록' option 은 정상(이름)이나, 닫힌 트리거의 '선택값(SingleValue)'만 UUID 노출.
 *   → SelectValue 에 value→이름 resolver(render-fn) 주입(4FIX 담당자 드롭과 동일 패턴). 표시 전용, 저장값 무변경.
 *
 * 대상:
 *   [신규] ReservationDetailPopup new-mode `newmode-registrar-select`
 *   [재사용처/AC5] 예약상세 편집 팝업 `popup-registrar`
 *
 * AC 매핑:
 *   [AC1] 선택 후 표시값 = staff 이름, UUID raw 절대 비노출.
 *   [AC2] 목록 라벨 포맷([TM]/[원내] prefix) 유지.
 *   [엣지1] A→B 재선택 시 표시값 B 이름으로 정상 갱신.
 *   [엣지2] '미지정' 복귀 시 placeholder('예약등록자 선택') 표시.
 *   AC4(저장값 staff_id UUID 무변경)는 구조적 보장(표시 resolver 만 추가, write 경로 미변경) — 코드 리뷰 확인.
 *
 * 데이터/clinic 미준비 시 graceful skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** 예약관리 → '새 예약' → new-mode → [신규 고객 등록] → 등록자 드롭 노출까지. 성공 시 true. */
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

test.describe('T-20260629-foot-NEWRESV-REGISTRANT-UUID-LABEL', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('시나리오1/AC1·AC2: 등록자 선택 후 트리거 표시값 = 이름(UUID 아님)', async ({ page }) => {
    const ok = await openNewCustomerForm(page);
    if (!ok) test.skip(true, 'new-mode 신규 고객 폼 진입 불가(clinic/데이터 미준비)');

    const trigger = page.getByTestId('newmode-registrar-select');
    await expect(trigger).toBeVisible();
    await trigger.click();

    // ⚠ getByRole('option')은 같은 폼의 시간선택(07:00~) Select 옵션(닫힘·비가시)까지 매칭됨.
    //   예약등록자 옵션만 스코프: 목록 라벨이 [TM]/[원내] prefix 로 시작.
    const realOptions = page.getByRole('option').filter({ hasText: /\[(TM|원내)\]/ });
    // Base UI Select 옵션은 open 시 lazy 마운트 → 카운트 전 첫 옵션 가시화 대기(미시드면 graceful skip).
    await realOptions.first().waitFor({ state: 'visible', timeout: 6_000 }).catch(() => {});
    if ((await realOptions.count()) === 0) {
      await page.keyboard.press('Escape');
      test.skip(true, '예약등록자 마스터 미시드 — 검증 대상 옵션 없음');
    }

    const optText = (await realOptions.first().innerText()).trim();   // 예: "[원내] 김지혜"
    const name = optText.replace(/^\[[^\]]*\]\s*/, '');               // 이름만
    await realOptions.first().click();

    // AC1: 트리거에 이름이 보이고 raw UUID 는 절대 없음
    await expect(trigger).toContainText(name.slice(0, 2));
    await expect(trigger).not.toContainText('예약등록자 선택');
    const shown = (await trigger.innerText()).trim();
    expect(shown).not.toMatch(UUID_RE);
    // AC2: 목록 라벨 포맷([TM]/[원내] prefix) 유지
    expect(shown).toBe(optText);
  });

  test('시나리오2-엣지1: A→B 재선택 시 표시값이 B 이름으로 갱신(UUID 아님)', async ({ page }) => {
    const ok = await openNewCustomerForm(page);
    if (!ok) test.skip(true, 'new-mode 신규 고객 폼 진입 불가');

    const trigger = page.getByTestId('newmode-registrar-select');
    await trigger.click();
    // ⚠ getByRole('option')은 같은 폼의 시간선택(07:00~) Select 옵션(닫힘·비가시)까지 매칭됨.
    //   예약등록자 옵션만 스코프: 목록 라벨이 [TM]/[원내] prefix 로 시작.
    const realOptions = page.getByRole('option').filter({ hasText: /\[(TM|원내)\]/ });
    // Base UI Select 옵션은 open 시 lazy 마운트 → 카운트 전 첫 옵션 가시화 대기(미시드면 graceful skip).
    await realOptions.first().waitFor({ state: 'visible', timeout: 6_000 }).catch(() => {});
    if ((await realOptions.count()) < 2) {
      await page.keyboard.press('Escape');
      test.skip(true, '재선택 검증용 등록자 2명 미만');
    }

    const textA = (await realOptions.nth(0).innerText()).trim();
    await realOptions.nth(0).click();
    await expect(trigger).toContainText(textA.replace(/^\[[^\]]*\]\s*/, '').slice(0, 2));

    // B 로 변경
    await trigger.click();
    const textB = (await realOptions.nth(1).innerText()).trim();
    await realOptions.nth(1).click();
    const shown = (await trigger.innerText()).trim();
    expect(shown).toBe(textB);
    expect(shown).not.toBe(textA);
    expect(shown).not.toMatch(UUID_RE);
  });

  test('시나리오2-엣지2: 미지정 복귀 시 placeholder 표시(UUID 아님)', async ({ page }) => {
    const ok = await openNewCustomerForm(page);
    if (!ok) test.skip(true, 'new-mode 신규 고객 폼 진입 불가');

    const trigger = page.getByTestId('newmode-registrar-select');
    await trigger.click();
    // ⚠ getByRole('option')은 같은 폼의 시간선택(07:00~) Select 옵션(닫힘·비가시)까지 매칭됨.
    //   예약등록자 옵션만 스코프: 목록 라벨이 [TM]/[원내] prefix 로 시작.
    const realOptions = page.getByRole('option').filter({ hasText: /\[(TM|원내)\]/ });
    // Base UI Select 옵션은 open 시 lazy 마운트 → 카운트 전 첫 옵션 가시화 대기(미시드면 graceful skip).
    await realOptions.first().waitFor({ state: 'visible', timeout: 6_000 }).catch(() => {});
    if ((await realOptions.count()) === 0) {
      await page.keyboard.press('Escape');
      test.skip(true, '예약등록자 마스터 미시드');
    }
    await realOptions.first().click();

    // 미지정으로 되돌림
    await trigger.click();
    await page.getByRole('option', { name: '— 미지정 —' }).click();
    await expect(trigger).toContainText('예약등록자 선택');
    expect((await trigger.innerText()).trim()).not.toMatch(UUID_RE);
  });
});
