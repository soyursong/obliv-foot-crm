/**
 * E2E spec — T-20260614-foot-RESVPOPUP-FIELDBATCH-6FIX
 * [예약관리] 예약상세 팝업 현장 피드백 6종 배치 (AC1·AC3·AC4·AC5·AC6 출하 / AC2 FOLLOWUP)
 *
 * AC1: 팝업 안에서 다른 고객(B) 검색 → 팝업 닫지 않고 1번구역만 B 로 교체.
 *      예약(A) 푸터 액션 전부 숨김(엉뚱저장 0) + "B 신규예약 등록"/"원래 고객으로" 노출.
 * AC3: 검색창 = 헤더 우상단(× 닫기 좌측), 보조문구 제거, 단일 입력창 이름 OR 연락처 매칭.
 * AC4: "담당 상담사" → "담당자" 라벨, 값 = 실제 직원명 (raw UUID 노출 버그 수정).
 * AC5: 활성패키지/치료내역 = 2번차트 패키지탭 양식 재사용 (read-only).
 * AC6: 캘린더 영역 "예약등록자 필터" 드롭다운 제거 — 상단 예약정보 예약등록자만 유지.
 *
 * 팝업은 기존 예약 클릭으로만 열림(데이터 의존) → 예약 없으면 graceful skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function openFirstReservationPopup(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  // 캘린더/리스트의 예약 카드 클릭 → 팝업(zone1) 오픈
  const popupZone1 = page.getByTestId('popup-zone1-customer');
  // 예약 셀/카드 후보 탐색 (visit_type 뱃지 또는 환자명 클릭 가능 요소)
  const candidates = page.locator('[data-testid^="resv-card"], [data-resv-id]');
  const count = await candidates.count().catch(() => 0);
  if (count === 0) return false;
  for (let i = 0; i < Math.min(count, 5); i++) {
    await candidates.nth(i).click().catch(() => {});
    if (await popupZone1.isVisible().catch(() => false)) return true;
  }
  return popupZone1.isVisible().catch(() => false);
}

test.describe('T-20260614-foot-RESVPOPUP-FIELDBATCH-6FIX — 예약상세 팝업 6종 배치', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  // AC3: 헤더 우상단 단일 검색창 — 이름 또는 연락처
  test('AC3: 예약상세 팝업 헤더 우상단 고객 검색창(이름/연락처) 노출', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    const search = page.locator('#resv-popup-customer-search');
    await expect(search).toBeVisible({ timeout: 5_000 });
    await expect(search).toHaveAttribute('placeholder', /이름 또는 연락처/);
    console.log('[AC3] 헤더 우상단 단일 검색창 OK');
  });

  // AC1: 다른 고객 검색 선택 → 팝업 유지 + 1번구역만 교체 + 푸터 가드
  test('AC1: 다른 고객 불러옴 → 팝업 닫힘 없음 + 신규예약 푸터 가드', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    const search = page.locator('#resv-popup-customer-search');
    await expect(search).toBeVisible({ timeout: 5_000 });
    await search.fill('김');
    // 드롭다운 후보 대기 — 검색 결과 없으면 graceful skip
    const firstOption = page.locator('button:has-text("기존 고객")').first();
    const dropdownBtn = page
      .locator('div.absolute button')
      .filter({ hasText: /···|·/ })
      .first();
    const hasResult = await dropdownBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasResult) test.skip(true, '검색 결과 데이터 없음');

    await dropdownBtn.click();

    // 팝업(zone1) 여전히 표시 — 닫히지 않음
    await expect(page.getByTestId('popup-zone1-customer')).toBeVisible();
    // 신규예약 대상 배너 노출
    await expect(page.getByTestId('popup-loaded-customer-banner')).toBeVisible({ timeout: 3_000 });
    // 푸터: 신규예약 등록 버튼 노출 / 저장 버튼 숨김 (엉뚱저장 0)
    await expect(page.getByTestId('btn-register-new-for-loaded')).toBeVisible();
    await expect(page.getByTestId('btn-reservation-save')).toHaveCount(0);
    void firstOption;
    console.log('[AC1] 팝업 유지 + 푸터 가드 OK');
  });

  // AC4: "담당자" 라벨 — raw UUID 미노출
  test('AC4: 담당자 라벨 표시 + raw UUID 노출 0', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    const zone1 = page.getByTestId('popup-zone1-customer');
    await expect(zone1.getByText('담당자', { exact: true })).toBeVisible({ timeout: 5_000 });
    // UUID 패턴(8-4-4-4-12)이 화면에 노출되지 않아야 함
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
    const popupText = (await page.getByRole('dialog').first().textContent()) ?? '';
    expect(popupText).not.toMatch(uuidPattern);
    console.log('[AC4] 담당자 라벨 + UUID 미노출 OK');
  });

  // AC5: 활성패키지 — 2번차트 양식(read-only) 재사용
  test('AC5: 활성패키지 영역 2번차트 양식 표시 (편집 버튼 0)', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    const pkgArea = page.getByTestId('popup-active-packages');
    await expect(pkgArea).toBeVisible({ timeout: 5_000 });
    // read-only — 추가/수정/삭제 버튼 없음
    await expect(pkgArea.getByRole('button', { name: /추가|수정|삭제/ })).toHaveCount(0);
    console.log('[AC5] 활성패키지 read-only 양식 OK');
  });

  // AC6: 캘린더 영역 예약등록자 필터 드롭다운 제거
  test('AC6: 예약등록자 필터(캘린더 영역) 중복 드롭다운 제거', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    // "예약등록자 필터" 라벨/문구가 팝업에 존재하지 않아야 함
    await expect(page.getByText('예약등록자 필터')).toHaveCount(0);
    console.log('[AC6] 예약등록자 필터 드롭다운 제거 OK');
  });
});
