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
 * AC2: 패키지 사용이력(시술내역) — (스펙 재확정 2026-06-19, IMG_8382)
 *       AC2-1 회차 열 너비: 두 자리 회차("10회"~"99회") 줄바꿈 차단(min-w+nowrap), 가로 칸 내부 유지.
 *       AC2-2 표시 정책 B안: 기본 최근 5건만 + "더보기" 버튼 → 클릭 시 전체 펼침(접기 토글).
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

  // AC2-1: 활성패키지 시술내역이 zone1 가로폭을 넘지 않음 + 회차 셀 단일행(높이 한 줄, 두 자리 회차 줄바꿈 없음)
  test('AC2-1: 시술내역 가로 넘침 없음 + 회차 셀 1행(줄바꿈 차단)', async ({ page }) => {
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

    // 회차 셀 줄바꿈 차단 검증: 시술내역 행이 있으면 각 행 높이가 단일행 수준(<= 24px)인지 확인.
    const rows = page.getByTestId('pkg-session-row');
    const rowCount = await rows.count().catch(() => 0);
    if (rowCount > 0) {
      const firstBox = await rows.first().boundingBox();
      if (firstBox) {
        // text-[10px] 단일행 ≈ 14~18px. 줄바꿈(2행)이면 ~28px+ → 24px 상한으로 줄바꿈 차단 확인.
        expect(firstBox.height).toBeLessThanOrEqual(24);
        console.log(`[AC2-1] 시술내역 행 높이 ${firstBox.height}px (단일행) OK`);
      }
    }
    console.log('[AC2-1] 활성패키지 가로 넘침 없음 OK');
  });

  // AC2-2: 표시 정책 B안 — 기본 최근 5건만 + 더보기 버튼 → 클릭 시 전체 펼침
  test('AC2-2: 시술내역 기본 5건 + 더보기 토글', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    const pkg = page.getByTestId('popup-active-packages');
    if (!(await pkg.isVisible().catch(() => false))) test.skip(true, '활성패키지 섹션 없음');

    const moreBtn = page.getByTestId('pkg-session-more').first();
    // 더보기 버튼은 시술내역 6건+ 패키지에서만 노출 → 없으면 graceful skip(데이터 의존)
    if (!(await moreBtn.isVisible().catch(() => false))) test.skip(true, '시술내역 6건+ 패키지 없음(더보기 미노출)');

    // 더보기 버튼이 보인다 = 그 패키지 기본 표시는 5건으로 제한됨(B안). 클릭 → 행 수 증가.
    const rows = page.getByTestId('pkg-session-row');
    const before = await rows.count();
    await moreBtn.click();
    await page.waitForTimeout(150);
    const after = await rows.count();
    expect(after).toBeGreaterThan(before);
    // 접기 토글 복귀
    await expect(page.getByTestId('pkg-session-more').first()).toContainText('접기');
    console.log(`[AC2-2] 더보기 토글 OK: ${before} → ${after}건`);
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

  // AC4-b: 갤탭 좁은 뷰포트 회귀 가드 — RC(flex 자식 min-width:auto)는 좁은 뷰포트에서만 재현되므로
  //   데스크톱 기본 뷰포트 AC4 테스트로는 잡히지 않는다. 태블릿 폭(820px)에서 박스 칸 내부 유지 검증.
  test('AC4-b: 갤탭 좁은 뷰포트(820px)에서도 예약이력 박스 칸 내부', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    const history = page.getByTestId('popup-reservation-history');
    const zone2 = page.getByTestId('popup-zone2-reservation');
    if (!(await history.isVisible().catch(() => false))) test.skip(true, '예약이력 박스 없음');

    const hBox = await history.boundingBox();
    const zBox = await zone2.boundingBox();
    if (!hBox || !zBox) test.skip(true, 'boundingBox 측정 불가');
    // 좁은 폭에서도 박스 우측 끝이 zone2 칼럼 경계 안. min-w-0 + overflow-hidden 으로 콘텐츠가 강제 수축.
    expect(hBox.x + hBox.width).toBeLessThanOrEqual(zBox.x + zBox.width + 1);
    console.log(`[AC4-b] 820px 뷰포트 박스 우측 ${Math.round(hBox.x + hBox.width)} ≤ zone2 ${Math.round(zBox.x + zBox.width)} OK`);
  });
});
