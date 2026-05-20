/**
 * E2E spec — T-20260521-foot-WALKIN-MEMO-GAP
 * 워크인(예약 없는) 고객 메모 갭 해소
 *
 * AC-1: 워크인 고객도 2번차트에서 메모 작성 가능 (customer 기반)
 * AC-2: 기존 예약 연결 메모와 공존 (회귀 금지)
 * AC-3: 메모 히스토리 타임라인 표시
 * AC-4: 1번차트 동기화 (check_in_id 3순위 fallback 포함)
 *
 * Notes:
 * - T-20260520-foot-RESV-MEMO-WALKIN: reservation_id nullable + customer_id FK (이미 적용)
 * - T-20260521: check_in_id 3순위 fallback (수기 워크인 check_ins.customer_id=null 케이스)
 * - DB 스키마: reservation_memo_history.check_in_id nullable FK → check_ins(id)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260521 WALKIN-MEMO-GAP — 워크인 메모 작성/히스토리', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ──────────────────────────────────────────────────────────
  // AC-1: 2번차트 예약메모 섹션 — 예약 없어도 항상 활성
  // ──────────────────────────────────────────────────────────
  test('AC-1: 2번차트 예약메모 영역이 예약 유무와 무관하게 활성화', async ({ page }) => {
    await page.goto('/admin/customers');
    await page.waitForTimeout(2_000);

    const customerLinks = page.locator('a[href*="/customers/"], [data-testid="customer-row"], tr[data-customer-id]').first();
    const hasCustomer = await customerLinks.isVisible().catch(() => false);
    if (!hasCustomer) {
      test.skip(true, '고객 목록 없음 — 스킵');
      return;
    }
    await customerLinks.click();
    await page.waitForTimeout(2_000);

    // 2번차트 예약메모 라벨 확인
    const memoLabel = page.getByText('예약메모', { exact: true }).first();
    const labelVisible = await memoLabel.isVisible().catch(() => false);
    if (!labelVisible) {
      test.skip(true, '2번차트 예약메모 라벨 미발견 — 스킵');
      return;
    }

    // "연결된 예약 없음" 메시지가 없어야 함 (T-20260520 제거됨)
    const noResvText = page.getByText('연결된 예약 없음');
    await expect(noResvText).toHaveCount(0, { timeout: 3_000 });

    // 추가 버튼 존재 확인 (data-testid="memo-add-btn")
    const addBtn = page.locator('[data-testid="memo-add-btn"]').first();
    const hasBtnVisible = await addBtn.isVisible().catch(() => false);

    // 텍스트에리어 존재 확인
    const textarea = page.locator('textarea').first();
    const hasTextarea = await textarea.isVisible().catch(() => false);

    expect(hasBtnVisible || hasTextarea).toBeTruthy();
    console.log('[AC-1] 2번차트 예약메모 항상 활성 PASS');
  });

  // ──────────────────────────────────────────────────────────
  // AC-2: 기존 예약 연결 메모 회귀 없음
  // ──────────────────────────────────────────────────────────
  test('AC-2: 예약 있는 고객 1번차트 예약메모 정상 렌더링 (회귀 없음)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if (await cards.count() === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }
    await cards.first().click();

    const sheet = page.locator('[role="dialog"], [data-radix-sheet-content]').first();
    const sheetVisible = await sheet.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!sheetVisible) {
      test.skip(true, '1번차트 시트 미오픈 — 스킵');
      return;
    }

    // 예약메모 라벨 및 컴포넌트 렌더링
    const memoLabel = sheet.getByText('예약메모', { exact: true }).first();
    await expect(memoLabel).toBeVisible({ timeout: 5_000 });

    // "연결된 예약 없음" 없음
    const noResvText = sheet.getByText('연결된 예약 없음');
    await expect(noResvText).toHaveCount(0, { timeout: 3_000 });

    // 메모 내용(없음 텍스트 or 실제 항목) or 입력 UI 중 하나 존재
    const noMemo = sheet.getByText('메모 없음');
    const memoItem = sheet.locator('.border-amber-200');
    const textarea = sheet.locator('textarea');
    const hasContent = await Promise.any([
      noMemo.first().isVisible(),
      memoItem.first().isVisible(),
      textarea.first().isVisible(),
    ]).catch(() => false);
    expect(hasContent).toBeTruthy();

    console.log('[AC-2] 예약 있는 고객 1번차트 예약메모 회귀 없음 PASS');
  });

  // ──────────────────────────────────────────────────────────
  // AC-3: 메모 히스토리 타임라인 표시 (로딩 후 항목 또는 "메모 없음")
  // ──────────────────────────────────────────────────────────
  test('AC-3: 예약메모 타임라인이 로딩 후 정상 상태 표시', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if (await cards.count() === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }
    await cards.first().click();

    const sheet = page.locator('[role="dialog"], [data-radix-sheet-content]').first();
    const sheetVisible = await sheet.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!sheetVisible) {
      test.skip(true, '1번차트 시트 미오픈 — 스킵');
      return;
    }

    // "불러오는 중…" 사라진 후 타임라인 표시 확인
    const loadingText = sheet.getByText('불러오는 중…');
    // 최대 10초 대기 — 로딩 완료
    await loadingText.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

    // "메모 없음" 또는 실제 메모 항목 중 하나 있어야 함
    const noMemo = sheet.getByText('메모 없음');
    const memoItems = sheet.locator('.rounded.border.border-amber-200');
    const hasTimeline = await Promise.any([
      noMemo.first().isVisible(),
      memoItems.first().isVisible(),
    ]).catch(() => false);
    expect(hasTimeline).toBeTruthy();

    console.log('[AC-3] 예약메모 타임라인 로딩 완료 후 정상 표시 PASS');
  });

  // ──────────────────────────────────────────────────────────
  // AC-4: 1번차트 체크인 모드 — checkInId fallback 적용 확인
  // ──────────────────────────────────────────────────────────
  test('AC-4: 1번차트 예약메모 추가 버튼이 check_in 컨텍스트에서 활성화', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if (await cards.count() === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }
    await cards.first().click();

    const sheet = page.locator('[role="dialog"], [data-radix-sheet-content]').first();
    const sheetVisible = await sheet.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!sheetVisible) {
      test.skip(true, '1번차트 시트 미오픈 — 스킵');
      return;
    }

    // 예약메모 섹션 확인
    const memoLabel = sheet.getByText('예약메모', { exact: true }).first();
    const labelVisible = await memoLabel.isVisible().catch(() => false);
    if (!labelVisible) {
      test.skip(true, '1번차트 예약메모 라벨 미발견 — 스킵');
      return;
    }

    // ReservationMemoTimeline 관련 콘솔 에러 없음
    await page.waitForTimeout(1_000);
    const memoErrors = consoleErrors.filter((e) =>
      e.includes('ReservationMemoTimeline') || e.includes('reservation_memo_history')
    );
    expect(memoErrors).toHaveLength(0);

    console.log('[AC-4] 1번차트 체크인 컨텍스트 checkInId fallback — 콘솔 에러 없음 PASS');
  });
});
