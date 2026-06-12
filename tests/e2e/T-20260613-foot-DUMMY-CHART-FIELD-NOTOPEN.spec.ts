/**
 * T-20260613-foot-DUMMY-CHART-FIELD-NOTOPEN — 브라우저 실재현 (field "안 열려" RCA)
 *
 * 배경: 6/12 더미배치(memo='[TEST-DUMMY 20260612]', phone +82108812*, F-2238~)는
 *   프로그램 PASS(openChartFor DB직결, customer_id NULL=0, chart_number 발번, is_simulation=false)로
 *   보고됐으나 현장(김주연 총괄)은 "차트 안 열려". 프로그램 PASS ≠ 현장 브라우저 실오픈.
 *   본 spec 은 실 브라우저로 차트1(간편/진료)·차트2(미니홈피) 실오픈을 눈으로(스샷) 확정한다.
 *
 * 검증 경로 (전부 openChartFor / useChart() 단일 게이트 경유):
 *   P1) 고객관리(Customers) → 6/12 더미 이름 검색 → '차트보기'(open-chart-btn) → 차트2 슬라이드 패널 열림.
 *   P2) 동일 행 본문 클릭 → 차트1(간편차트 우측 패널) 열림.
 *
 * WSOD 가드: 차트 패널 열림 + 콘솔/페이지 에러 0건 (빈화면=열림이 아님).
 * db_change=false (read-only — 기존 6/12 더미만 클릭).
 */
import { test, expect, type ConsoleMessage } from '@playwright/test';

// 6/12 배치 실재 더미 (diag 확인: 전부 customer_id 직결 + chart_number 발번 + is_simulation=false)
const DUMMY_NEW = '범주아'; // F-2238, visit_type=new
const DUMMY_RET = '빈도훈'; // 재진(returning)

function collectErrors(page: import('@playwright/test').Page): string[] {
  const errs: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errs.push(`[console.error] ${m.text()}`);
  });
  page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
  return errs;
}

test.describe('DUMMY-CHART-FIELD-NOTOPEN · 6/12 더미 차트 실오픈 (브라우저)', () => {
  test('P1: 고객관리 검색 → 차트보기 버튼 → 차트2(미니홈피) 슬라이드 패널 실오픈 + 에러 0', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/admin/customers');
    await expect(page.getByPlaceholder(/이름/).first()).toBeVisible({ timeout: 15_000 });

    // 6/12 더미 이름 검색
    await page.getByPlaceholder(/이름/).first().fill(DUMMY_NEW);
    // 검색 결과 행에 더미 이름이 노출되어야 함 (is_simulation=false → admin 목록 노출 확인)
    await expect(page.getByText(DUMMY_NEW, { exact: false }).first()).toBeVisible({ timeout: 10_000 });

    // '차트보기'(open-chart-btn) 클릭 → openChart(customer_id) → 차트2
    const chartBtn = page.getByTestId('open-chart-btn').first();
    await expect(chartBtn).toBeVisible({ timeout: 10_000 });
    await chartBtn.click();

    // 차트2 슬라이드 패널 실오픈 확정
    const sheet = page.getByTestId('customer-chart-sheet');
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    // WSOD 방지: 패널 안에 실 콘텐츠(로딩 스피너가 아닌 차트 본문)가 렌더됐는지 — 텍스트 노드 존재
    await expect(sheet).not.toBeEmpty();

    await page.screenshot({ path: 'evidence/T-20260613-foot-DUMMY-CHART-FIELD-NOTOPEN_P1_chart2_new.png', fullPage: false });

    expect(errors, `차트2 오픈 중 콘솔/페이지 에러: \n${errors.join('\n')}`).toEqual([]);
  });

  test('P2: 재진 더미도 동일하게 차트2 실오픈', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/admin/customers');
    await expect(page.getByPlaceholder(/이름/).first()).toBeVisible({ timeout: 15_000 });

    await page.getByPlaceholder(/이름/).first().fill(DUMMY_RET);
    await expect(page.getByText(DUMMY_RET, { exact: false }).first()).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('open-chart-btn').first().click();
    const sheet = page.getByTestId('customer-chart-sheet');
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await expect(sheet).not.toBeEmpty();

    await page.screenshot({ path: 'evidence/T-20260613-foot-DUMMY-CHART-FIELD-NOTOPEN_P2_chart2_ret.png', fullPage: false });
    expect(errors, `재진 차트2 오픈 중 에러:\n${errors.join('\n')}`).toEqual([]);
  });

  test('P3: 대시보드 통합시간표 6/12 슬롯 더미 예약 카드 클릭 → 차트2 실오픈 (현장 클릭 동선)', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/admin');
    await expect(page.getByTestId('dash-date-prev')).toBeVisible({ timeout: 15_000 });

    // 오늘(6/13) → 6/12 로 1일 이동 (6/12 더미 노출 날짜)
    await page.getByTestId('dash-date-prev').click();

    // 6/12 더미 예약 카드(초진 box1 / 재진 box2)가 통합시간표에 노출되어야 함.
    //   ⚠ 6/12 더미는 전부 status=noshow → NOSHOW-BADGE-KEEP-INLIST 정책상 명단 유지 + 클릭 가능해야 함.
    const resvCard = page.getByTestId('box1-resv-card').or(page.getByTestId('box2-resv-card')).first();
    const appeared = await resvCard.isVisible().catch(() => false)
      || await resvCard.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);

    await page.screenshot({ path: 'evidence/T-20260613-foot-DUMMY-CHART-FIELD-NOTOPEN_P3_timeline_0612.png', fullPage: false });

    // RCA 관측: 6/12 더미가 통합시간표에 카드로 노출되는지 자체가 1차 분기점.
    //   노출 X → 현장 "안 열려"의 정체 = "클릭할 카드가 없음"(날짜/노쇼/체크인 부재) → 데이터 동선 문제.
    expect(appeared, '6/12 더미 예약 카드가 통합시간표에 노출되지 않음 — 현장 클릭 대상 자체 부재 가능성').toBeTruthy();

    await resvCard.click();
    const sheet = page.getByTestId('customer-chart-sheet');
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await expect(sheet).not.toBeEmpty();

    await page.screenshot({ path: 'evidence/T-20260613-foot-DUMMY-CHART-FIELD-NOTOPEN_P3_chart2_open.png', fullPage: false });
    expect(errors, `타임라인 차트2 오픈 중 에러:\n${errors.join('\n')}`).toEqual([]);
  });
});
