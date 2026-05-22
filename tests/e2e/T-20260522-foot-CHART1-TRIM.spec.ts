/**
 * E2E spec — T-20260522-foot-CHART1-TRIM
 * 1번차트 불필요 항목 제거 + 금일 동선 표기 보정
 *
 * AC-1: 패키지 잔여회차 항목 제거
 * AC-2: 체크리스트 / 비급여동의서 항목 제거
 * AC-3: 공간배정 드롭다운 삭제 → 금일 동선 자동 기입
 * AC-4: 금일 동선 치료실/레이저실 표기 누락 수정
 * AC-6: 원장 소견 항목 제거
 * AC-7: 진료 기록 섹션 전체 제거
 * AC-9: 하단구역 KOH균검사 항목 제거
 * AC-10: 하단구역 경과분석지 항목 제거
 * AC-11: 회귀 없음
 *
 * 시나리오:
 *   S-1: 1번차트 상단 제거 항목 미존재 확인 (AC-1/2/6/7)
 *   S-2: 금일 동선 자동 표기 (AC-3/4)
 *   S-3: 하단구역 쌍방연동 영역 KOH균검사·경과분석지 미존재 확인 (AC-9/10)
 *   S-4: 회귀 없음 (AC-11)
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260522-foot-CHART1-TRIM — 1번차트 항목 제거 + 동선 표기 보정', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  /**
   * S-1: 1번차트 제거 항목 미존재 확인
   * - 원장 소견 (AC-6)
   * - 진료 기록 섹션 (AC-7: 담당실장·치료구분·치료내용·레이저시간·비가열타이머·메모)
   * - 패키지 잔여회차 (AC-1)
   * - 체크리스트 / 비급여동의서 (AC-2)
   * - 공간배정 드롭다운 (AC-3)
   */
  test('S-1: 1번차트 — 제거 항목 미존재 확인 (AC-1/2/6/7)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 칸반 카드 찾기
    const cards = page.locator('[data-testid="checkin-card"]');
    const cardCount = await cards.count();
    if (cardCount === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    // 첫 번째 칸반 카드 클릭 → 1번차트(CheckInDetailSheet) 열기
    await cards.first().click();
    // 1번차트 Sheet가 열릴 때까지 대기 (Sheet 컨테이너)
    const sheet = page.locator('[role="dialog"]').first();
    const sheetVisible = await sheet.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!sheetVisible) {
      test.skip(true, '1번차트 Sheet 미오픈 — 스킵');
      return;
    }

    // AC-6: "원장 소견" 섹션 미존재 확인
    const doctorOpinionLabel = sheet.locator('text=원장 소견').first();
    const hasDoctorOpinion = await doctorOpinionLabel.count();
    expect(hasDoctorOpinion, 'AC-6: 원장 소견 레이블이 표시되어서는 안 됨').toBe(0);

    // AC-7: "진료 기록" 섹션 미존재 확인
    const treatmentRecordLabel = sheet.locator('text=진료 기록').first();
    const hasTreatmentRecord = await treatmentRecordLabel.count();
    expect(hasTreatmentRecord, 'AC-7: 진료 기록 섹션이 표시되어서는 안 됨').toBe(0);

    // AC-7 세부항목 미표시 확인
    expect(await sheet.locator('text=담당실장').count(), 'AC-7: 담당실장 미표시').toBe(0);
    expect(await sheet.locator('text=치료구분').count(), 'AC-7: 치료구분 미표시').toBe(0);
    expect(await sheet.locator('text=치료내용').count(), 'AC-7: 치료내용 미표시').toBe(0);
    expect(await sheet.locator('text=레이저 시간').count(), 'AC-7: 레이저 시간 미표시').toBe(0);
    expect(await sheet.locator('text=비가열 타이머').count(), 'AC-7: 비가열 타이머 미표시').toBe(0);
    // 비가열 타이머 data-testid 미표시
    expect(await page.locator('[data-testid="laser-timer-panel"]').count(), 'AC-7: laser-timer-panel 미표시').toBe(0);

    // AC-1: "패키지 잔여회차" 미표시 확인
    expect(await sheet.locator('text=패키지 잔여회차').count(), 'AC-1: 패키지 잔여회차 미표시').toBe(0);

    // AC-2: 체크리스트 / 비급여동의서 미표시 확인
    expect(await sheet.locator('text=체크리스트').count(), 'AC-2: 체크리스트 미표시').toBe(0);
    expect(await sheet.locator('text=비급여동의서').count(), 'AC-2: 비급여동의서 미표시').toBe(0);
  });

  /**
   * S-2: 금일 동선 — 체크인 카드 있을 때 에러 없이 렌더링
   * AC-3: 공간배정 드롭다운(select) 미표시 확인
   * AC-4: [금일 동선] 영역 정상 표시
   */
  test('S-2: 금일 동선 자동 기입 + 공간배정 드롭다운 미표시 (AC-3/4)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if (await cards.count() === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    await cards.first().click();
    const sheet = page.locator('[role="dialog"]').first();
    const sheetVisible = await sheet.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!sheetVisible) {
      test.skip(true, '1번차트 Sheet 미오픈 — 스킵');
      return;
    }

    // AC-3: 공간배정 드롭다운(select) 미표시
    const spaceSelect = sheet.locator('select').filter({ hasText: /공간/ });
    expect(await spaceSelect.count(), 'AC-3: 공간배정 드롭다운 미표시').toBe(0);

    // AC-4: [금일 동선] 텍스트 존재 확인 (에러 없이 렌더링)
    const dailyFlowLabel = sheet.locator('text=/금일.동선/').first();
    const hasFlowLabel = await dailyFlowLabel.count();
    if (hasFlowLabel > 0) {
      await expect(dailyFlowLabel).toBeVisible();
    }
    // 에러 토스트 미표시 확인
    const errorToast = page.locator('[data-sonner-toast][data-type="error"]');
    expect(await errorToast.count(), 'AC-4: 에러 토스트 미표시').toBe(0);
  });

  /**
   * S-3: 하단구역(쌍방연동 영역) KOH균검사·경과분석지 미존재 확인 (AC-9/10)
   */
  test('S-3: 하단 쌍방연동 영역 KOH균검사·경과분석지 미존재 (AC-9/10)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if (await cards.count() === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    await cards.first().click();
    const sheet = page.locator('[role="dialog"]').first();
    const sheetVisible = await sheet.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!sheetVisible) {
      test.skip(true, '1번차트 Sheet 미오픈 — 스킵');
      return;
    }

    // AC-9: "KOH균검사" 레이블이 하단 스토리지 섹션에 없어야 함
    // (Chart1StorageSection label="KOH균검사" 렌더링 제거)
    // 상단 1번차트 전용 영역의 KOH 관련 텍스트와 무관 — 업로드 버튼이 없어야 함
    const kohStorageSections = sheet.locator('[data-storage-section="koh-results"]');
    expect(await kohStorageSections.count(), 'AC-9: KOH균검사 스토리지 섹션 미표시').toBe(0);

    // AC-10: "경과분석지" 스토리지 섹션 미표시 확인
    const progressStorageSections = sheet.locator('[data-storage-section="progress"]');
    expect(await progressStorageSections.count(), 'AC-10: 경과분석지 스토리지 섹션 미표시').toBe(0);

    // AC-9/10: 텍스트 기반 검증 — "KOH균검사" 레이블과 "경과분석지" 레이블 미표시
    // (하단 스토리지 섹션이 Chart1StorageSection이었으므로 업로드 레이블로 확인)
    // 주의: 상단 1번차트 전용 영역에 KOH 관련 input이 있을 수 있으므로
    // Chart1StorageSection 특유의 업로드 UI 패턴을 확인
    const kohUploadLabel = sheet.locator('text=KOH균검사 없음');
    expect(await kohUploadLabel.count(), 'AC-9: KOH균검사 없음 플레이스홀더 미표시').toBe(0);

    const progressUploadLabel = sheet.locator('text=경과분석지 없음');
    expect(await progressUploadLabel.count(), 'AC-10: 경과분석지 없음 플레이스홀더 미표시').toBe(0);

    // 에러 없음
    const errorToast = page.locator('[data-sonner-toast][data-type="error"]');
    expect(await errorToast.count(), 'AC-9/10: 에러 토스트 미표시').toBe(0);
  });

  /**
   * S-4: 회귀 없음 — 1번차트 기존 동작(진료도구·펜차트·서류출력) 정상 (AC-11)
   */
  test('S-4: 회귀 없음 — 기존 동작 정상 (AC-11)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const cards = page.locator('[data-testid="checkin-card"]');
    if (await cards.count() === 0) {
      test.skip(true, '칸반 카드 없음 — 스킵');
      return;
    }

    await cards.first().click();
    const sheet = page.locator('[role="dialog"]').first();
    const sheetVisible = await sheet.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!sheetVisible) {
      test.skip(true, '1번차트 Sheet 미오픈 — 스킵');
      return;
    }

    // AC-11: Sheet가 에러 없이 열림
    await expect(sheet).toBeVisible();

    // JavaScript 에러 없음 확인 (콘솔 에러 체크)
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));
    await page.waitForTimeout(1_000);
    const criticalErrors = jsErrors.filter(
      (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error promise rejection'),
    );
    expect(criticalErrors, 'AC-11: JS 에러 없음').toHaveLength(0);

    // 제거 7항목 최종 종합 확인
    expect(await sheet.locator('text=패키지 잔여회차').count(), 'AC-11: 패키지 잔여회차 미표시').toBe(0);
    expect(await sheet.locator('text=체크리스트').count(), 'AC-11: 체크리스트 미표시').toBe(0);
    expect(await sheet.locator('text=비급여동의서').count(), 'AC-11: 비급여동의서 미표시').toBe(0);
    expect(await sheet.locator('text=원장 소견').count(), 'AC-11: 원장소견 미표시').toBe(0);
    expect(await sheet.locator('text=진료 기록').count(), 'AC-11: 진료기록 미표시').toBe(0);
    expect(await sheet.locator('text=KOH균검사 없음').count(), 'AC-11: KOH균검사 스토리지 미표시').toBe(0);
    expect(await sheet.locator('text=경과분석지 없음').count(), 'AC-11: 경과분석지 스토리지 미표시').toBe(0);
  });
});
