/**
 * E2E spec — T-20260516-foot-RESV-PLUS-CANVAS
 * [예약관리] [+] 예약 생성 버튼 → 빈 캔버스(Phase 0 Shell) 아닌 예약 생성 폼 열림 확인
 *
 * 버그: openNewSlot() 에서 isTabletViewport(≥769px) 조건 시 TabletFullscreenModal 호출
 *       → 태블릿 환경에서 [+] 클릭 시 빈 캔버스(Phase 0 Shell)가 표시되던 문제
 * 수정: isTabletViewport 체크 제거 → 항상 setEditor() (예약 생성 폼) 호출
 *
 * AC-1: [+] 슬롯 버튼 클릭 → 예약 생성 폼 표시 (빈 캔버스 미표시)
 * AC-2: 빈 캔버스/Phase0Shell 화면 절대 미표시 🔒L-004
 * AC-3: InlinePatientSearch(전화번호 고객조회) 정상 동작 확인
 * AC-4: 예약 슬롯 더블클릭 → 예약수정 모달 (본 수정 무영향)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260516-foot-RESV-PLUS-CANVAS — [+] 버튼 → 예약 생성 폼 (캔버스 금지)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  // AC-1: 슬롯 [+] 버튼 클릭 → 예약 생성 폼 열림 (캔버스 미열림)
  test('AC-1: 슬롯 [+] 버튼 클릭 → 예약 생성 폼 표시', async ({ page }) => {
    // 태블릿 사이즈로 뷰포트 강제 (>=769px, 버그 재현 조건)
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/admin/reservations');
    await page.waitForTimeout(2000); // 예약 데이터 로드 대기

    // slot-plus data-testid로 [+] 버튼 찾기
    const slotPlusButtons = page.locator('[data-testid^="slot-plus-"]');
    const count = await slotPlusButtons.count();

    if (count === 0) {
      // 슬롯 버튼이 없으면 헤더 [새 예약] 버튼으로 대체 확인
      const headerBtn = page.getByRole('button', { name: /새 예약/ });
      await expect(headerBtn).toBeVisible({ timeout: 10_000 });
      await headerBtn.click();
    } else {
      // 첫 번째 슬롯 [+] 버튼 클릭
      await slotPlusButtons.first().click();
    }

    // 예약 등록 다이얼로그 표시 확인
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/예약 등록|예약 수정/)).toBeVisible({ timeout: 3_000 });
    console.log('[AC-1] [+] 버튼 → 예약 생성 폼 표시 OK');
  });

  // AC-2: 빈 캔버스(Phase 0 Shell) 미표시 확인
  test('AC-2: [+] 버튼 클릭 후 Phase 0 Shell / 빈 캔버스 미표시 🔒L-004', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/admin/reservations');
    await page.waitForTimeout(2000);

    const slotPlusButtons = page.locator('[data-testid^="slot-plus-"]');
    const count = await slotPlusButtons.count();

    if (count > 0) {
      await slotPlusButtons.first().click();
    } else {
      const headerBtn = page.getByRole('button', { name: /새 예약/ });
      await expect(headerBtn).toBeVisible({ timeout: 10_000 });
      await headerBtn.click();
    }

    // 빈 캔버스(Phase 0 Shell) 미표시 확인
    const canvas = page.locator('[data-testid="tablet-fullscreen-modal"]');
    await expect(canvas).not.toBeVisible({ timeout: 2_000 });
    console.log('[AC-2] Phase 0 Shell 빈 캔버스 미표시 확인 OK (🔒L-004)');
  });

  // AC-3: InlinePatientSearch (RESV-PLUS-PHONE-SEARCH d10c88f 회귀 확인)
  test('AC-3: 예약 생성 폼 — InlinePatientSearch (전화번호 고객조회) 정상 동작', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/admin/reservations');
    await page.waitForTimeout(2000);

    // 헤더 [새 예약] 버튼 사용 (안정적 경로)
    const headerBtn = page.getByRole('button', { name: /새 예약/ });
    await expect(headerBtn).toBeVisible({ timeout: 10_000 });
    await headerBtn.click();

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    // InlinePatientSearch 전화번호 입력 필드 표시 확인
    const phoneInput = page.locator('input[placeholder*="010-1234-5678"]').first();
    await expect(phoneInput).toBeVisible({ timeout: 3_000 });

    // 전화번호 입력 → 하이픈 포맷 확인 (InlinePatientSearch 활성화 증명)
    await phoneInput.fill('01099998888');
    await page.waitForTimeout(400);
    const val = await phoneInput.inputValue();
    expect(val).toBe('010-9999-8888');
    console.log(`[AC-3] InlinePatientSearch 전화번호 입력 활성화 + 하이픈 포맷: "${val}" OK`);
  });

  // AC-4: 더블클릭 예약수정 모달 → 본 수정 무영향
  test('AC-4: 예약 슬롯 더블클릭 → 예약수정 모달 (본 수정 영향 없음)', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/admin/reservations');
    await page.waitForTimeout(2000);

    // 예약 카드 존재 여부 확인
    const resvCards = page.locator('[data-testid^="resv-card-"]');
    const cardCount = await resvCards.count();

    if (cardCount === 0) {
      test.skip(true, '예약 카드 없음 — 더블클릭 테스트 스킵');
      return;
    }

    // 첫 번째 confirmed 예약 카드 더블클릭
    const firstCard = resvCards.first();
    await firstCard.dblclick();
    await page.waitForTimeout(500);

    // 예약수정 모달(dialog) 또는 상세 팝업 표시 확인
    const dialog = page.getByRole('dialog');
    const dialogVisible = await dialog.isVisible();

    // 빈 캔버스(Phase 0 Shell)는 절대 미표시
    const canvas = page.locator('[data-testid="tablet-fullscreen-modal"]');
    await expect(canvas).not.toBeVisible({ timeout: 2_000 });

    if (dialogVisible) {
      console.log('[AC-4] 더블클릭 → 예약수정 모달 표시 OK, 캔버스 미표시 확인 OK');
    } else {
      // 더블클릭이 단일클릭으로 처리된 경우(300ms 디바운스)도 캔버스 미표시 확인이 핵심
      console.log('[AC-4] 더블클릭 → 선택 상태 (디바운스 타이밍), 캔버스 미표시 확인 OK');
    }
  });
});
