/**
 * T-20260804-foot-SALESAGG-STAFF-4METRIC-REDEFINE
 * 매출집계 > 담당실장별 섹션 4개 항목 재정비 — ②③④ 구현분 E2E.
 *
 * 현장 확정 스펙(김주연 총괄 2026-08-04, C0ATE5P6JTH):
 *   ② 패키지 = 실장별 패키지 결제 금액 SUM (기존 packageRevenue = tax_type='선수금' net). 라벨·값 유지.
 *   ③ 진찰료 = 급여 본인부담금만(비급여 진찰료 제외) = 기존 insuranceCopay(tax_type='급여' net).
 *      라벨 '급여 본부금' → '진찰료'로 변경, 값 불변(매출 급여/비급여/공단부담 산식 SSOT 준수).
 *   ④ 총 매출(섹션-로컬) = ②패키지 결제 합산 + ③급여 본인부담금 합산. 신규 최우측 컬럼(ADDITIVE).
 *      ★비급여·공단부담은 포함하지 않음(총괄 명시 산식, 섹션-로컬 정의).
 *
 *   ① '오더 건 수' → '상담 건 수': 데이터소스 이중 모호(무엇=상담발생 / 귀속축) → planner FOLLOWUP
 *      발행 후 보류. 본 커밋/스펙에서는 '오더 건수' 라벨·로직 불변(추정 착지 금지, KPI GO_WARN).
 *      → 이 스펙은 ①(상담 건수)을 검증 대상에서 제외한다(FOLLOWUP 확정 후 후속 커밋에서 추가).
 *
 * 현장 클릭 시나리오(티켓 §84) → E2E 변환. 빈 데이터(staging)에서는 헤더·구조·무에러로 대체.
 * ★AC-4 산술(총매출 = 패키지 + 진찰료)은 데이터가 있을 때 셀 값 파싱으로 구조적 검증.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const SALES_URL = '/admin/sales';
const TAB_NAME = '담당실장별';

async function gotoDoctorTab(page: import('@playwright/test').Page) {
  await page.goto(SALES_URL);
  await expect(page.getByRole('heading', { name: '매출집계' })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('tab', { name: TAB_NAME }).click();
  await expect(page.locator('[data-testid="sales-doctor-loading"]')).toHaveCount(0, {
    timeout: 25_000,
  });
  await expect(
    page.locator('[data-testid="sales-doctor-tab"], [data-testid="sales-doctor-empty"]'),
  ).toBeVisible({ timeout: 10_000 });
}

async function hasTable(page: import('@playwright/test').Page) {
  return page
    .locator('[data-testid="sales-doctor-tab"]')
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
}

/**
 * "1,234,000원 (13건)" → 1234000. 금액은 첫 '원' 앞부분만 파싱(뒤 '(N건)' 카운트 접미 무시).
 * 음수(-1,234,000원)·값 없음(—) 처리. 값 없으면 null.
 */
function parseWon(text: string | null): number | null {
  if (!text) return null;
  const head = text.split('원')[0]; // 금액부만(패키지 셀의 '(N건)' 접미 제거)
  const m = head.replace(/[^0-9-]/g, '');
  if (m === '' || m === '-') return null;
  return Number(m);
}

test.describe('T-20260804-foot-SALESAGG-STAFF-4METRIC-REDEFINE 담당실장별 4항목 재정비(②③④)', () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── ③ 진찰료 라벨: '급여 본부금' 제거 + '진찰료' 노출 ─────────────────────────
  test('③ 진찰료: 헤더 라벨 "진찰료" 노출 + "급여 본부금" 미노출', async ({ page }) => {
    await gotoDoctorTab(page);
    if (!(await hasTable(page))) {
      await expect(page.locator('[data-testid="sales-doctor-empty"]')).toBeVisible();
      return;
    }
    const tableEl = page.locator('[data-testid="sales-doctor-tab"]');
    await expect(tableEl.getByRole('columnheader', { name: '진찰료' })).toBeVisible();
    await expect(tableEl.getByRole('columnheader', { name: '급여 본부금' })).toHaveCount(0);
    console.log('[4METRIC] ③ 진찰료 라벨 변경 OK');
  });

  // ── ② 패키지 컬럼 유지(값=선수금 SUM) ─────────────────────────────────────────
  test('② 패키지: "패키지 (선수금)" 컬럼 유지 + "원" 금액 포맷', async ({ page }) => {
    await gotoDoctorTab(page);
    if (!(await hasTable(page))) {
      console.log('[4METRIC] empty state — 패키지 검증 skip');
      return;
    }
    const tableEl = page.locator('[data-testid="sales-doctor-tab"]');
    await expect(tableEl.getByRole('columnheader', { name: '패키지 (선수금)' })).toBeVisible();
    const totalPkg = page.locator('[data-testid="sales-doctor-total-package"]');
    await expect(totalPkg).toBeVisible();
    await expect(totalPkg).toContainText('원');
    console.log('[4METRIC] ② 패키지 SUM 컬럼 OK');
  });

  // ── ④ 총 매출 컬럼: 신규 최우측 + "원" 포맷 ──────────────────────────────────
  test('④ 총 매출: 신규 최우측 컬럼 노출 + 합계 "원" 포맷', async ({ page }) => {
    await gotoDoctorTab(page);
    if (!(await hasTable(page))) {
      console.log('[4METRIC] empty state — 총매출 검증 skip');
      return;
    }
    const tableEl = page.locator('[data-testid="sales-doctor-tab"]');
    const headers = tableEl.getByRole('columnheader');
    await expect(tableEl.getByRole('columnheader', { name: '총 매출' })).toBeVisible();
    // 최우측 배치
    await expect(headers.last()).toHaveText('총 매출');
    // 총 7컬럼 (담당실장·오더건수·비급여·진찰료·공단·패키지·총매출)
    await expect(headers).toHaveCount(7);
    const totalSection = page.locator('[data-testid="sales-doctor-total-sectiontotal"]');
    await expect(totalSection).toBeVisible();
    await expect(totalSection).toContainText('원');
    console.log('[4METRIC] ④ 총 매출 컬럼 최우측 ADDITIVE OK');
  });

  // ── AC-4(핵심 산술): 행별 총매출 == 패키지 + 진찰료 ──────────────────────────
  test('AC-4: 행별 총 매출 == 패키지(선수금) + 진찰료(급여 본인부담금) 정확 일치', async ({ page }) => {
    await gotoDoctorTab(page);
    if (!(await hasTable(page))) {
      console.log('[4METRIC] empty state — AC-4 산술 검증 skip(데이터 없음)');
      return;
    }
    // 성능: 행 3셀(패키지·진찰료·총매출) 텍스트를 브라우저 컨텍스트에서 한 번에 수집(루프 locator 왕복 제거).
    const triples = await page.locator('[data-testid="sales-doctor-tab"] tbody tr').evaluateAll((trs) =>
      trs.map((tr) => {
        const pick = (frag: string) =>
          (tr.querySelector(`[data-testid^="sales-doctor-${frag}-"]`) as HTMLElement | null)?.textContent ?? null;
        return { pkg: pick('package'), jin: pick('jinchalryo'), total: pick('sectiontotal') };
      }),
    );
    let checked = 0;
    for (const t of triples) {
      const total = parseWon(t.total);
      if (total == null) continue;
      const pkg = parseWon(t.pkg);
      const jin = parseWon(t.jin);
      // ④ 정의: 총매출 = (패키지 ?? 0) + (진찰료 ?? 0). 반올림 표시오차 ±1원 허용.
      const expected = (pkg ?? 0) + (jin ?? 0);
      expect(Math.abs(total - expected), `총매출 ${total} ≠ 패키지 ${pkg} + 진찰료 ${jin}`).toBeLessThanOrEqual(1);
      checked++;
    }
    console.log(`[4METRIC] AC-4 산술 정합 검증 완료 — ${checked}개 실장 행 (총매출 = 패키지 + 진찰료)`);
  });

  // ── AC-5(회귀): 인접 섹션(담당치료사별)·기간필터 무회귀 + 무에러 ────────────────
  test('AC-5: 담당치료사별 탭·기간필터 회귀 없음 + 무에러 렌더', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await gotoDoctorTab(page);
    await page.waitForTimeout(1_000);

    // 인접 섹션(담당치료사별) 정상 전환
    await page.getByRole('tab', { name: '담당치료사별' }).click();
    await expect(
      page.locator(
        '[data-testid="sales-staff-tab"], [data-testid="sales-staff-deduct-tab"], [data-testid="sales-staff-empty"], [data-testid="sales-staff-deduct-empty"]',
      ).first(),
    ).toBeVisible({ timeout: 15_000 });

    // 담당실장별 재진입 후 무에러
    await page.getByRole('tab', { name: TAB_NAME }).click();
    await expect(
      page.locator('[data-testid="sales-doctor-tab"], [data-testid="sales-doctor-empty"]'),
    ).toBeVisible({ timeout: 15_000 });

    expect(errors, `pageerror 발생: ${errors.join(' | ')}`).toHaveLength(0);
    console.log('[4METRIC] AC-5 인접 섹션·회귀 무에러 OK');
  });
});
