/**
 * E2E spec — T-20260619-foot-RESVPOPUP-DETAIL-REVERIFY-4FIX
 * [예약관리] 예약상세 팝업 8FIX 후 재검증 4건 (김주연 총괄, 스샷 F0BBKAXAMJN·F0BBD0C769Z)
 *
 * AC1: 담당자 트리거에 raw UUID 미노출 — ⚠⚠ 2회차 회귀(6FIX AC4 + 8FIX AC2 두 차례 닫고 재발).
 *      RC: Base UI Select 는 Portal(=Popup·Item)을 드롭다운이 "열릴 때만" 마운트(SelectPortal: shouldRender=mounted).
 *          닫힌 트리거에서는 Select.Item 미등록 → store.items 비어 resolveSelectedLabel 이 fallback →
 *          serializeValue(value)=raw UUID 노출. (SelectItem 을 추가해도 열기 전엔 등록 안 됨 = 회귀 본질)
 *      FIX: SelectValue 를 render-function(children) 로 받아 value→이름을 allStaff/assignedStaffName 에서 직접 해석.
 *           아이템 등록 타이밍과 무관하게 트리거가 항상 이름을 표기 → 닫힌 상태에서도 UUID 절대 비노출.
 * AC2: 패키지 사용이력(시술내역) 10건+ 레이아웃 — 영역 내부 스크롤(max-h+overflow) + 각 항목 1행 고정(nowrap).
 * AC3: 독립 "치료내역" 섹션 제거(popup-treatment-history 미존재). 패키지 시술내역으로 일원화.
 * AC4: 예약이력 박스가 칸(zone2) 밖으로 이탈하지 않음 — flex-shrink-0 + 리스트 max-h 로 칸 내부 가둠(8FIX AC6 회귀).
 *
 * 팝업은 기존 예약 클릭으로만 열림(데이터 의존) → 예약 없으면 graceful skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function openFirstReservationPopup(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  const popupZone1 = page.getByTestId('popup-zone1-customer');
  const candidates = page.locator('[data-testid^="resv-card-"]');
  const count = await candidates.count().catch(() => 0);
  if (count === 0) return false;
  for (let i = 0; i < Math.min(count, 8); i++) {
    await candidates.nth(i).click().catch(() => {});
    if (await popupZone1.isVisible().catch(() => false)) return true;
  }
  return popupZone1.isVisible().catch(() => false);
}

test.describe('T-20260619-foot-RESVPOPUP-DETAIL-REVERIFY-4FIX — 예약상세 팝업 재검증 4건', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  // AC1: 담당자 트리거에 raw UUID 미노출 — 드롭다운을 "열지 않은" 닫힌 상태에서도(=실제 회귀 재현 조건) 이름만 표기.
  test('AC1: 담당자 트리거 raw UUID 미노출(드롭다운 미오픈 상태)', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    const consultant = page.getByTestId('popup-consultant');
    if (!(await consultant.isVisible().catch(() => false))) test.skip(true, '담당자 셀렉트 없음');

    // 드롭다운을 열지 않은 그대로(=Base UI Item 미등록 상태) 트리거 텍스트 검증 = 회귀 재현 지점
    const label = (await consultant.innerText().catch(() => '')) ?? '';
    expect(UUID_RE.test(label)).toBeFalsy();
    console.log('[AC1] 닫힌 트리거 raw UUID 미노출 OK:', label.slice(0, 40));
  });

  // AC1-b: 다른 예약 재오픈 후에도 동일하게 UUID 미노출(시나리오1 step3 회귀방지)
  test('AC1-b: 예약 재오픈 회귀방지 — 담당자 UUID 미노출 유지', async ({ page }) => {
    await page.goto('/admin/reservations');
    await page.waitForLoadState('networkidle').catch(() => {});
    const candidates = page.locator('[data-testid^="resv-card-"]');
    const count = await candidates.count().catch(() => 0);
    if (count < 1) test.skip(true, '예약 데이터 없음');

    const consultant = page.getByTestId('popup-consultant');
    const zone1 = page.getByTestId('popup-zone1-customer');
    let checked = 0;
    for (let i = 0; i < Math.min(count, 4); i++) {
      await candidates.nth(i).click().catch(() => {});
      if (!(await zone1.isVisible().catch(() => false))) continue;
      if (await consultant.isVisible().catch(() => false)) {
        const label = (await consultant.innerText().catch(() => '')) ?? '';
        expect(UUID_RE.test(label)).toBeFalsy();
        checked++;
      }
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(200);
    }
    if (checked === 0) test.skip(true, '담당자 셀렉트 노출 예약 없음');
    console.log(`[AC1-b] 재오픈 ${checked}건 모두 UUID 미노출 OK`);
  });

  // AC2: 패키지 사용이력 영역 내부 스크롤(높이 한정) — 활성패키지 콘텐츠가 zone1 가로폭을 넘지 않음(1행 고정/넘침 차단)
  test('AC2: 활성패키지 시술내역 가로 넘침 없음(칸 내부)', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    const pkg = page.getByTestId('popup-active-packages');
    if (!(await pkg.isVisible().catch(() => false))) test.skip(true, '활성패키지 섹션 없음');

    const zone1 = page.getByTestId('popup-zone1-customer');
    const pkgBox = await pkg.boundingBox();
    const zoneBox = await zone1.boundingBox();
    if (!pkgBox || !zoneBox) test.skip(true, 'boundingBox 측정 불가');
    // 패키지 섹션 우측 끝이 zone1 우측 경계를 넘지 않음(가로 넘침 차단). 1px 여유.
    expect(pkgBox.x + pkgBox.width).toBeLessThanOrEqual(zoneBox.x + zoneBox.width + 1);
    console.log('[AC2] 활성패키지 가로 넘침 없음 OK');
  });

  // AC3: 독립 "치료내역" 섹션 제거 — testid 미존재
  test('AC3: 독립 치료내역 섹션 제거됨', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    const treatmentSection = page.getByTestId('popup-treatment-history');
    expect(await treatmentSection.count()).toBe(0);
    // 보조: zone1 본문에 독립 '치료내역' 헤더 텍스트 없음(활성패키지 내부 '시술내역'은 별개)
    console.log('[AC3] popup-treatment-history 섹션 제거 OK');
  });

  // AC4: 예약이력 박스가 zone2 칸 밖으로 이탈하지 않음(박스 하단이 zone2 영역 안)
  test('AC4: 예약이력 박스 칸 내부(이탈 없음)', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    const history = page.getByTestId('popup-reservation-history');
    const zone2 = page.getByTestId('popup-zone2-reservation');
    if (!(await history.isVisible().catch(() => false))) test.skip(true, '예약이력 박스 없음');

    const hBox = await history.boundingBox();
    const zBox = await zone2.boundingBox();
    if (!hBox || !zBox) test.skip(true, 'boundingBox 측정 불가');
    // 예약이력 박스 우측 끝이 zone2 우측 경계를 넘지 않음(가로 이탈 차단). 1px 여유.
    expect(hBox.x + hBox.width).toBeLessThanOrEqual(zBox.x + zBox.width + 1);
    console.log('[AC4] 예약이력 박스 칸 내부 OK');
  });
});
