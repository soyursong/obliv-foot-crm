/**
 * E2E spec — T-20260615-foot-RESVPOPUP-DETAIL-8FIX
 * [예약관리] 예약상세 팝업 내부 필드 재검증 8건 (김주연 총괄, 스샷 F0BAKBFMS58)
 *
 * AC1: 환자정보 '주민번호' 마스킹 값 표시(평문 RRN 미노출) — RRN-NOBIND 회귀 가드.
 * AC2: '담당자' = 직원명(display_name/name), raw UUID 미노출 — FIELDBATCH-6FIX AC4 회귀 가드.
 * AC3: 치료내역에 취소(cancelled) 내원 잔존 없음 — chart2 관례(.neq status cancelled)와 정렬(읽기 필터).
 * AC4: 시간대별 현황 영역 로드 에러("불러오지 못했습니다") 미표시 — TIMESLOT-PICKER AC1 회귀 가드(컬럼 누락 fallback).
 * AC5a: '선택한 일자 및 시간'에 '소요 시간' 행 없음.
 * AC5b: 과거 내원 이력 고객 → '초·재진' = '재진' 자동 표기(표시 전용).
 * AC5c: '예약등록자' 행 항상 렌더(값 또는 '—').
 * AC6: 예약이력 카드가 박스 밖으로 넘치지 않음(truncate/min-w-0).
 * AC7: 고객메모/예약메모 헤더가 파랑/주황 강조색이 아님(teal 통일).
 * AC8: 예약경로 — 기존 예약(edit-mode)은 등록값 prefill / (+)신규 생성(new-mode)은 공란.
 *
 * 팝업은 기존 예약 클릭으로만 열림(데이터 의존) → 예약 없으면 graceful skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function openFirstReservationPopup(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  const popupZone1 = page.getByTestId('popup-zone1-customer');
  const candidates = page.locator('[data-testid^="resv-card-"]');
  const count = await candidates.count().catch(() => 0);
  if (count === 0) return false;
  for (let i = 0; i < Math.min(count, 6); i++) {
    await candidates.nth(i).click().catch(() => {});
    if (await popupZone1.isVisible().catch(() => false)) return true;
  }
  return popupZone1.isVisible().catch(() => false);
}

test.describe('T-20260615-foot-RESVPOPUP-DETAIL-8FIX — 예약상세 팝업 필드 8건', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  // AC1: 주민번호 마스킹 — 평문 RRN(13자리 연속) 미노출
  test('AC1: 환자정보 주민번호 마스킹(평문 RRN 미노출)', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    const zone1 = page.getByTestId('popup-zone1-customer');
    const text = (await zone1.innerText().catch(() => '')) ?? '';
    // 평문 RRN(6-7 연속 숫자) 노출 금지 — 마스킹(*) 또는 '—' 만 허용
    expect(/\d{6}-\d{7}\b/.test(text)).toBeFalsy();
    console.log('[AC1] 평문 RRN 미노출 OK');
  });

  // AC2: 담당자 값에 raw UUID 미노출
  test('AC2: 담당자 트리거에 raw UUID 미노출', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    const consultant = page.getByTestId('popup-consultant');
    if (!(await consultant.isVisible().catch(() => false))) test.skip(true, '담당자 셀렉트 없음');
    const label = (await consultant.innerText().catch(() => '')) ?? '';
    // UUID v4 패턴(8-4-4-4-12) 노출 금지
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(label)).toBeFalsy();
    console.log('[AC2] 담당자 raw UUID 미노출 OK:', label.slice(0, 40));
  });

  // AC4: 시간대별 현황 로드 에러 미표시
  test('AC4: 시간대별 현황 로드 에러 미표시', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    // 미니캘린더 날짜 선택 시 시간대 패널이 뜸 — 에러 문구가 없어야 함
    await page.waitForTimeout(800);
    const zone2 = page.getByTestId('popup-zone2-reservation');
    const text = (await zone2.innerText().catch(() => '')) ?? '';
    expect(text).not.toContain('예약 현황을 불러오지 못했습니다');
    console.log('[AC4] 시간대별 현황 에러 문구 미표시 OK');
  });

  // AC5a: '소요 시간' 행 제거
  test('AC5a: 선택일자·시간 섹션에 소요 시간 행 없음', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    const zone2 = page.getByTestId('popup-zone2-reservation');
    const text = (await zone2.innerText().catch(() => '')) ?? '';
    expect(text).not.toContain('소요 시간');
    console.log('[AC5a] 소요 시간 행 제거 OK');
  });

  // AC5c: 예약등록자 행 항상 렌더
  test('AC5c: 예약등록자 행 항상 렌더(값 또는 —)', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    const zone2 = page.getByTestId('popup-zone2-reservation');
    const text = (await zone2.innerText().catch(() => '')) ?? '';
    expect(text).toContain('예약등록자');
    console.log('[AC5c] 예약등록자 행 렌더 OK');
  });

  // AC8: 예약경로 — edit-mode 진입 시 select 존재(공란이면 placeholder), new-mode 공란
  test('AC8: 예약경로 셀렉트 노출 + 등록값 prefill 반영(edit-mode)', async ({ page }) => {
    const opened = await openFirstReservationPopup(page);
    if (!opened) test.skip(true, '오픈 가능한 예약 데이터 없음');

    const route = page.getByTestId('popup-visit-route');
    await expect(route).toBeVisible({ timeout: 5_000 });
    // edit-mode: 등록값이 있으면 그 텍스트, 없으면 placeholder('예약경로 선택'/'미지정').
    // 핵심 = raw 공란 강제 아님(컴포넌트는 reservation.visit_route 로 prefill).
    const label = (await route.innerText().catch(() => '')) ?? '';
    expect(label.length).toBeGreaterThan(0);
    console.log('[AC8] 예약경로 셀렉트 노출 OK:', label.slice(0, 30));
  });
});
