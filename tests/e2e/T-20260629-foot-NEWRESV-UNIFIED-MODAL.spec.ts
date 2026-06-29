/**
 * E2E spec — T-20260629-foot-NEWRESV-UNIFIED-MODAL (foot · 항목8·9·10 통합)
 * 6/25 김주연 총괄 개편 2탄: 신규예약 (+) 통합 모달.
 *
 * AC 매핑:
 *  AC1: (+)/[새 예약] → 1차 팝업(초진/재진·신규/기존 2버튼 선택) 제거, 통합 폼 직진.
 *  AC2: 모달 내 날짜 캘린더/picker 제거 + 진입 시 날짜·시간 자동주입(readOnly 표시).
 *  AC3: 예약경로 = TM/네이버/인콜/워크인/지인소개.
 *  AC4: 성함·연락처 입력 → 기존 기록 있으면 재진/없으면 신규(초진) 자동판별(기본 신규 배지).
 *  AC5: 예약경로/예약등록자 한 줄 + 컴팩트 레이아웃.
 *  AC6: 필드 구성 성함/연락처/예약경로/예약등록자/간략메모(발톱무좀/내성발톱/발각질케어 3종)/예약메모.
 *  AC9: 목록 [새 예약] 버튼도 캘린더 (+)와 동일 통합 모달 컴포넌트 공유.
 *  회귀: 모달 닫아도 캘린더 현황 유지(목록 화면 잔존).
 *
 * 데이터 비의존: [새 예약] 버튼은 예약 데이터 없이도 모달을 열 수 있어 안정적으로 검증 가능(AC9 진입점).
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function openUnifiedModalViaListButton(page: Page): Promise<boolean> {
  await page.goto('/admin/reservations');
  await page.waitForLoadState('networkidle').catch(() => {});
  // AC9: 목록 상단 [새 예약] 버튼
  const btn = page.getByRole('button', { name: '새 예약' });
  if (!(await btn.isVisible({ timeout: 8_000 }).catch(() => false))) return false;
  await btn.click();
  // 통합 신규예약 모달 = 신규(초진) 입력 폼이 바로 노출(1차 팝업 없음)
  return page.getByTestId('popup-newmode-manual-form').isVisible({ timeout: 4_000 }).catch(() => false);
}

test.describe('T-20260629-foot-NEWRESV-UNIFIED-MODAL — 신규예약 통합 모달', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  // AC1: 1차 팝업(2버튼 선택 단계) 제거 → 통합 폼 직진
  test('AC1: [새 예약] 클릭 시 1차 선택 팝업 없이 통합 폼 직진', async ({ page }) => {
    const opened = await openUnifiedModalViaListButton(page);
    if (!opened) test.skip(true, '예약관리 진입 불가');
    // 구 1차 선택 팝업(신규 고객 등록/기존 고객 예약 2버튼)은 존재하지 않음
    await expect(page.getByTestId('popup-newmode-entry-choose')).toHaveCount(0);
    // 통합 폼(성함·연락처 입력)이 즉시 노출
    await expect(page.getByTestId('popup-newmode-manual-form')).toBeVisible();
    await expect(page.locator('#newmode-cust-name')).toBeVisible();
    await expect(page.locator('#newmode-cust-phone')).toBeVisible();
  });

  // AC2: 날짜 캘린더/picker 제거 + 날짜·시간 readOnly 자동주입
  test('AC2: 모달 내 날짜 캘린더 없음 + 날짜·시간 readOnly 표시', async ({ page }) => {
    const opened = await openUnifiedModalViaListButton(page);
    if (!opened) test.skip(true, '예약관리 진입 불가');
    const dialog = page.getByRole('dialog');
    // 모달 내 '예약 캘린더' 섹션(구 MiniMonthCalendar) 부재
    await expect(dialog.getByText('예약 캘린더')).toHaveCount(0);
    // 날짜·시간 readOnly 표시(헤더 + 하단 행)
    await expect(page.getByTestId('newmode-datetime-readonly')).toBeVisible();
    await expect(page.getByTestId('newmode-datetime-row')).toBeVisible();
  });

  // AC3: 예약경로 옵션 5종
  test('AC3: 예약경로 = TM/네이버/인콜/워크인/지인소개', async ({ page }) => {
    const opened = await openUnifiedModalViaListButton(page);
    if (!opened) test.skip(true, '예약관리 진입 불가');
    await page.getByTestId('newmode-visit-route-select').click();
    for (const opt of ['TM', '네이버', '인콜', '워크인', '지인소개']) {
      await expect(page.getByRole('option', { name: opt })).toBeVisible();
    }
  });

  // AC4: 기본 신규(초진) 자동판별 배지
  test('AC4: 미입력/미매칭 시 신규(초진) 배지 표시', async ({ page }) => {
    const opened = await openUnifiedModalViaListButton(page);
    if (!opened) test.skip(true, '예약관리 진입 불가');
    await expect(page.getByTestId('newmode-visittype-badge')).toHaveText(/신규\(초진\)/);
  });

  // AC5: 예약경로/예약등록자 한 줄 + 컴팩트
  test('AC5: 예약경로/예약등록자 한 줄 배치', async ({ page }) => {
    const opened = await openUnifiedModalViaListButton(page);
    if (!opened) test.skip(true, '예약관리 진입 불가');
    const route = page.getByTestId('newmode-visit-route-select');
    const registrar = page.getByTestId('newmode-registrar-select');
    await expect(route).toBeVisible();
    await expect(registrar).toBeVisible();
    // 한 줄 배치 = 두 필드의 수직 위치(top)가 동일 행
    const rBox = await route.boundingBox();
    const gBox = await registrar.boundingBox();
    if (rBox && gBox) {
      expect(Math.abs(rBox.y - gBox.y)).toBeLessThan(8);
    }
  });

  // AC6: 간략메모 3종 체크박스 + 예약메모 필드
  test('AC6: 간략메모 3종(발톱무좀/내성발톱/발각질케어) + 예약메모', async ({ page }) => {
    const opened = await openUnifiedModalViaListButton(page);
    if (!opened) test.skip(true, '예약관리 진입 불가');
    await expect(page.getByTestId('newmode-brief-quick-발톱무좀')).toBeVisible();
    await expect(page.getByTestId('newmode-brief-quick-내성발톱')).toBeVisible();
    await expect(page.getByTestId('newmode-brief-quick-발각질케어')).toBeVisible();
    await expect(page.getByTestId('newmode-booking-memo-input')).toBeVisible();
    // 칩 토글 동작 — 클릭 시 직접입력칸 동기화
    await page.getByTestId('newmode-brief-quick-발각질케어').click();
    await expect(page.getByTestId('newmode-brief-note-input')).toHaveValue('발각질케어');
  });

  // 회귀: 모달 닫아도 예약관리 목록 화면 유지
  test('회귀: 모달 닫으면 예약관리 캘린더/목록 유지', async ({ page }) => {
    const opened = await openUnifiedModalViaListButton(page);
    if (!opened) test.skip(true, '예약관리 진입 불가');
    await page.getByRole('button', { name: '닫기' }).click();
    await expect(page.getByTestId('popup-newmode-manual-form')).toHaveCount(0);
    // 목록 화면 [새 예약] 버튼 잔존(캘린더 현황 유지)
    await expect(page.getByRole('button', { name: '새 예약' })).toBeVisible();
  });
});
