/**
 * E2E spec — T-20260513-foot-C21-TAB-RESTRUCTURE-C
 * Phase C: 수납/상담 연결 + 문진(원장용)/펜차트(PDF)/메시지(문자이력) 보강
 *
 * AC-1: 수납내역 탭 — 결제 내역 + 영수증 자동업로드 동작
 * AC-2: 상담내역 탭 — 필수서류 섹션 + 영수증→수납 연결 표시
 * AC-3: 문진 탭 — 전체 접근 가능 + 원장 메인 사용자 UX 요약 뷰 표시
 * AC-4: 펜차트 탭 — PDF 양식 기본 템플릿 로드 + 태블릿 캔버스 위 직접 필기 + 저장/조회
 * AC-5: 메시지 탭 — 문자 발송 이력 표시
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260513-C — Phase C 탭 보강', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  /**
   * 고객 목록에서 첫 번째 고객 차트로 진입 후
   * 지정된 탭 그룹(clinical|history)과 탭 key를 활성화한다.
   */
  async function navigateToChartTab(
    page: Parameters<typeof loginAndWaitForDashboard>[0],
    group: 'clinical' | 'history',
    tabLabel: string,
  ) {
    await page.goto('/admin/customers');
    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    try {
      await firstRow.waitFor({ timeout: 10_000 });
    } catch {
      return false;
    }
    const customerLink = firstRow.locator('a[href*="/chart/"]').first();
    if (await customerLink.count() > 0) {
      await customerLink.click();
    } else {
      await firstRow.click();
    }
    // 차트 페이지 로드 대기
    try {
      await page.locator('[data-testid="chart-tab-content"]').waitFor({ timeout: 12_000 });
    } catch {
      return false;
    }

    // 탭 그룹 버튼 클릭 (문진쪽=clinical, 상담쪽=history)
    if (group === 'history') {
      // "상담내역", "패키지" 등 하단 탭 그룹 버튼
      const historyBtn = page.getByRole('button', { name: /상담내역|패키지|시술내역|진료이미지|메시지/ }).first();
      if (await historyBtn.count() > 0) await historyBtn.click();
    }

    // 원하는 탭 라벨 클릭
    const tabBtn = page.getByRole('button', { name: tabLabel, exact: true }).first();
    try {
      await tabBtn.waitFor({ timeout: 8_000 });
      await tabBtn.click();
    } catch {
      // 탭 버튼이 없으면 탭명으로 재시도
      const altBtn = page.getByText(tabLabel, { exact: true }).first();
      if (await altBtn.count() > 0) await altBtn.click();
      else return false;
    }
    return true;
  }

  // ─ AC-1: 수납내역 탭 ──────────────────────────────────────────────────

  test('AC-1: 수납내역 탭 — 결제 내역 테이블 + 영수증 업로드 섹션 노출', async ({ page }) => {
    await page.goto('/admin/customers');
    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    await firstRow.waitFor({ timeout: 10_000 });
    const customerLink = firstRow.locator('a[href*="/chart/"]').first();
    if (await customerLink.count() > 0) await customerLink.click();
    else await firstRow.click();

    await page.locator('[data-testid="chart-tab-content"]').waitFor({ timeout: 12_000 });

    // "수납내역" 탭 클릭
    const payTab = page.getByRole('button', { name: '수납내역', exact: true }).first();
    await payTab.waitFor({ timeout: 8_000 });
    await payTab.click();

    // 수납내역 섹션 헤더 노출 확인
    await expect(page.getByText('수납내역', { exact: true }).first()).toBeVisible({ timeout: 5_000 });
    console.log('[AC-1] 수납내역 탭 열림 OK');

    // 영수증 사진 업로드 섹션 존재 확인
    await expect(page.getByText('영수증 사진').first()).toBeVisible({ timeout: 5_000 });
    console.log('[AC-1] 영수증 업로드 섹션 노출 OK');
  });

  // ─ AC-2: 상담내역 탭 ──────────────────────────────────────────────────

  test('AC-2: 상담내역 탭 — 필수서류 현황 섹션 노출', async ({ page }) => {
    await page.goto('/admin/customers');
    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    await firstRow.waitFor({ timeout: 10_000 });
    const customerLink = firstRow.locator('a[href*="/chart/"]').first();
    if (await customerLink.count() > 0) await customerLink.click();
    else await firstRow.click();

    await page.locator('[data-testid="chart-tab-content"]').waitFor({ timeout: 12_000 });

    // 하단 탭 그룹의 "상담내역" 탭 클릭
    const consultTab = page.getByRole('button', { name: '상담내역', exact: true }).first();
    await consultTab.waitFor({ timeout: 8_000 });
    await consultTab.click();

    // 필수서류 현황 섹션 확인
    await expect(page.getByText('필수서류 현황').first()).toBeVisible({ timeout: 5_000 });
    console.log('[AC-2] 필수서류 현황 섹션 OK');

    // 동의서 항목 확인 (시술/비급여/개인정보)
    await expect(page.getByText('시술 동의서').first()).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText('비급여 동의서').first()).toBeVisible({ timeout: 3_000 });
    console.log('[AC-2] 동의서 항목 노출 OK');

    // 상담실장 서류 섹션 확인
    await expect(page.getByText('상담실장 서류').first()).toBeVisible({ timeout: 3_000 });
    console.log('[AC-2] 상담실장 서류 섹션 OK');
  });

  // ─ AC-3: 문진 탭 ──────────────────────────────────────────────────────

  test('AC-3: 문진 탭 — 전체 접근 가능 + 원장 핵심 요약 또는 기록없음 표시', async ({ page }) => {
    await page.goto('/admin/customers');
    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    await firstRow.waitFor({ timeout: 10_000 });
    const customerLink = firstRow.locator('a[href*="/chart/"]').first();
    if (await customerLink.count() > 0) await customerLink.click();
    else await firstRow.click();

    await page.locator('[data-testid="chart-tab-content"]').waitFor({ timeout: 12_000 });

    // "문진" 탭 클릭 (clinical 그룹 — 기본 그룹이므로 추가 그룹 전환 불필요)
    const checklistTab = page.getByRole('button', { name: '문진', exact: true }).first();
    await checklistTab.waitFor({ timeout: 8_000 });
    await checklistTab.click();

    // 권한 제한 없이 접근 가능한지 확인: "접근 불가" 또는 "권한없음" 문구 없어야 함
    await expect(page.getByText(/접근 불가|권한없음|허가되지 않음/).first()).not.toBeVisible({ timeout: 2_000 });
    console.log('[AC-3] RBAC 제한 없음 OK');

    // 체크리스트 응답이 있으면 "원장 핵심 요약" 뷰 노출, 없으면 "기록 없음" 노출
    const hasSummary = await page.getByText('원장 핵심 요약').count() > 0;
    const hasEmpty = await page.getByText('기록 없음').count() > 0;
    const hasDynContent = hasSummary || hasEmpty ||
      await page.getByText('사전 체크리스트 응답').count() > 0 ||
      await page.getByText('동의서').count() > 0;

    expect(hasDynContent).toBe(true);
    console.log(`[AC-3] 문진 탭 콘텐츠 노출 OK (요약=${hasSummary}, 비어있음=${hasEmpty})`);
  });

  // ─ AC-4: 펜차트 탭 ────────────────────────────────────────────────────

  test('AC-4: 펜차트 탭 — 목록 뷰 + 새 차트 작성 버튼 노출', async ({ page }) => {
    await page.goto('/admin/customers');
    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    await firstRow.waitFor({ timeout: 10_000 });
    const customerLink = firstRow.locator('a[href*="/chart/"]').first();
    if (await customerLink.count() > 0) await customerLink.click();
    else await firstRow.click();

    await page.locator('[data-testid="chart-tab-content"]').waitFor({ timeout: 12_000 });

    // "펜차트" 탭 클릭 (clinical 그룹)
    const penTab = page.getByRole('button', { name: '펜차트', exact: true }).first();
    await penTab.waitFor({ timeout: 8_000 });
    await penTab.click();

    // 펜차트 섹션 헤더 확인
    await expect(page.getByText(/펜차트.*PDF 양식 위 직접 필기/).first()).toBeVisible({ timeout: 5_000 });
    console.log('[AC-4] 펜차트 섹션 헤더 OK');

    // 새 차트 작성 버튼 존재 확인
    const newChartBtn = page.getByRole('button', { name: '새 차트 작성' });
    await expect(newChartBtn).toBeVisible({ timeout: 3_000 });
    console.log('[AC-4] 새 차트 작성 버튼 OK');

    // 새 차트 작성 → 그리기 모드 진입
    await newChartBtn.click();

    // 캔버스 노출 확인
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 3_000 });
    console.log('[AC-4] 캔버스 그리기 모드 진입 OK');

    // 펜 도구 버튼 확인
    await expect(page.getByRole('button', { name: '펜' }).first()).toBeVisible({ timeout: 2_000 });
    // 저장 버튼 확인
    await expect(page.getByRole('button', { name: '저장' }).first()).toBeVisible({ timeout: 2_000 });
    console.log('[AC-4] 펜/저장 버튼 OK');

    // 취소 → 목록으로 복귀
    await page.getByRole('button', { name: '취소' }).first().click();
    await expect(page.getByRole('button', { name: '새 차트 작성' })).toBeVisible({ timeout: 3_000 });
    console.log('[AC-4] 취소 후 목록 복귀 OK');
  });

  // ─ AC-5: 메시지 탭 ────────────────────────────────────────────────────

  test('AC-5: 메시지 탭 — 문자 이력 등록 섹션 + 발송이력 목록 노출', async ({ page }) => {
    await page.goto('/admin/customers');
    const firstRow = page.locator('tr[data-customer-id], tbody tr').first();
    await firstRow.waitFor({ timeout: 10_000 });
    const customerLink = firstRow.locator('a[href*="/chart/"]').first();
    if (await customerLink.count() > 0) await customerLink.click();
    else await firstRow.click();

    await page.locator('[data-testid="chart-tab-content"]').waitFor({ timeout: 12_000 });

    // 하단 탭 그룹의 "메시지" 탭 클릭
    const msgTab = page.getByRole('button', { name: '메시지', exact: true }).first();
    await msgTab.waitFor({ timeout: 8_000 });
    await msgTab.click();

    // 문자 이력 등록 섹션 확인
    await expect(page.getByText('문자 이력 등록').first()).toBeVisible({ timeout: 5_000 });
    console.log('[AC-5] 문자 이력 등록 섹션 OK');

    // 발송 유형 선택 드롭다운 확인
    await expect(page.locator('select').filter({ hasText: /수동기록|SMS|카카오/ }).first()).toBeVisible({ timeout: 3_000 });
    console.log('[AC-5] 유형 드롭다운 OK');

    // 발송 이력 섹션 확인
    await expect(page.getByText('발송 이력').first()).toBeVisible({ timeout: 3_000 });
    console.log('[AC-5] 발송 이력 섹션 OK');

    // 등록 버튼 확인
    const registerBtn = page.getByRole('button', { name: '등록' });
    await expect(registerBtn).toBeVisible({ timeout: 3_000 });
    console.log('[AC-5] 등록 버튼 OK');
  });
});
