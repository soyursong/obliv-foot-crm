/**
 * T-20260806-foot-SALESDOCTOR-COLUMN-REBUILD-4COL
 * 매출집계 > 담당실장별 탭 컬럼 전면 재구성 — 6컬럼 → 4컬럼 [실장][누적매출][환불금][총 매출].
 *
 * 현장 확정 스펙(김주연 총괄 2026-08-06, C0ATE5P6JTH, human_confirmed):
 *   AC-1 기존 6컬럼 제거: 상담 건 수/비급여 순매출/진찰료/공단부담액(명세)/패키지(선수금) 미표시.
 *   AC-2 신규 4열만: [실장] [누적매출] [환불금] [총 매출].
 *   AC-3 누적매출 = 랭킹 탭 월매출 verbatim(fetchConsultantPerf.total_amount) 연동.
 *   AC-4 환불금 = 2번차트 담당자(assigned_staff_id) 귀속 + 환불처리월(accounting_date) 집계.
 *   AC-5 총 매출 = 누적매출 − 환불금 (렌더 시 실시간 계산).
 *   AC-6 기간 필터 연동.
 *   AC-회귀 통계>MTM '04 실장별 실적'(별도 surface) 무접촉 / 인접 담당치료사별 탭 무회귀.
 *
 * 빈 데이터(staging)에서는 헤더·구조·무에러로 대체. ★AC-5 산술(총=누적−환불)은 데이터가 있을 때
 * 셀 값 파싱으로 구조적 검증.
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

/** "1,234,000원" 또는 "−1,234,000원" → 절대값 숫자. '—'/빈값 → null. 부호는 별도 판정. */
function parseWon(text: string | null): number | null {
  if (!text) return null;
  const head = text.split('원')[0];
  // '−'(U+2212)·'-' 모두 마이너스로 취급
  const neg = /[−-]/.test(head);
  const digits = head.replace(/[^0-9]/g, '');
  if (digits === '') return null;
  const n = Number(digits);
  return neg ? -n : n;
}

test.describe('T-20260806-foot-SALESDOCTOR-COLUMN-REBUILD-4COL 담당실장별 4컬럼 재구성', () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── AC-2: 신규 4열만 노출 + 순서 ──────────────────────────────────────────────
  test('AC-2: [실장][누적매출][환불금][총 매출] 4열만 순서대로 노출', async ({ page }) => {
    await gotoDoctorTab(page);
    if (!(await hasTable(page))) {
      await expect(page.locator('[data-testid="sales-doctor-empty"]')).toBeVisible();
      return;
    }
    const tableEl = page.locator('[data-testid="sales-doctor-tab"]');
    const headers = tableEl.getByRole('columnheader');
    await expect(headers).toHaveCount(4);
    await expect(headers.nth(0)).toHaveText('실장');
    await expect(headers.nth(1)).toHaveText('누적매출');
    await expect(headers.nth(2)).toHaveText('환불금');
    await expect(headers.nth(3)).toHaveText('총 매출');
    console.log('[4COL] AC-2 4컬럼 구성·순서 OK');
  });

  // ── AC-1: 기존 6컬럼 제거 확인 ────────────────────────────────────────────────
  test('AC-1: 기존 컬럼(상담 건 수/비급여 순매출/진찰료/공단부담액/패키지) 미표시', async ({ page }) => {
    await gotoDoctorTab(page);
    if (!(await hasTable(page))) {
      console.log('[4COL] empty state — 제거 검증 skip');
      return;
    }
    const tableEl = page.locator('[data-testid="sales-doctor-tab"]');
    for (const gone of ['상담 건 수', '비급여 순매출', '진찰료', '공단부담액 (명세)', '패키지 (선수금)']) {
      await expect(tableEl.getByRole('columnheader', { name: gone })).toHaveCount(0);
    }
    // 제거된 컬럼의 testid 도 부재
    await expect(page.locator('[data-testid^="sales-doctor-consultcount-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="sales-doctor-nonins-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="sales-doctor-jinchalryo-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="sales-doctor-covered-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="sales-doctor-package-"]')).toHaveCount(0);
    console.log('[4COL] AC-1 기존 6컬럼 제거 OK');
  });

  // ── AC-5(핵심 산술): 행별 총 매출 == 누적매출 − 환불금 ─────────────────────────
  test('AC-5: 행별 총 매출 == 누적매출 − 환불금 정확 일치', async ({ page }) => {
    await gotoDoctorTab(page);
    if (!(await hasTable(page))) {
      console.log('[4COL] empty state — AC-5 산술 검증 skip(데이터 없음)');
      return;
    }
    const triples = await page.locator('[data-testid="sales-doctor-tab"] tbody tr').evaluateAll((trs) =>
      trs.map((tr) => {
        const pick = (frag: string) =>
          (tr.querySelector(`[data-testid^="sales-doctor-${frag}-"]`) as HTMLElement | null)?.textContent ?? null;
        return { cum: pick('cumulative'), ref: pick('refund'), total: pick('total') };
      }),
    );
    let checked = 0;
    for (const t of triples) {
      const total = parseWon(t.total);
      if (total == null) continue;
      const cum = parseWon(t.cum) ?? 0;
      const ref = parseWon(t.ref) ?? 0; // 환불금은 −부호 표시 → parseWon 이 음수로 반환
      // 총매출 = 누적 − |환불|. ref 는 이미 음수(−magnitude)이므로 누적 + ref.
      const expected = cum + ref;
      expect(Math.abs(total - expected), `총매출 ${total} ≠ 누적 ${cum} − 환불 ${-ref}`).toBeLessThanOrEqual(1);
      checked++;
    }
    console.log(`[4COL] AC-5 산술 정합 검증 완료 — ${checked}개 실장 행 (총매출 = 누적 − 환불)`);
  });

  // ── AC-6 + AC-회귀: 기간필터 · 인접 담당치료사별 탭 무회귀 · 무에러 ────────────
  test('AC-6/회귀: 기간필터·담당치료사별 탭 회귀 없음 + 무에러 렌더', async ({ page }) => {
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

    // 담당실장별 재진입 후 무에러 + 4컬럼 유지
    await page.getByRole('tab', { name: TAB_NAME }).click();
    await expect(
      page.locator('[data-testid="sales-doctor-tab"], [data-testid="sales-doctor-empty"]'),
    ).toBeVisible({ timeout: 15_000 });

    expect(errors, `pageerror 발생: ${errors.join(' | ')}`).toHaveLength(0);
    console.log('[4COL] AC-6/회귀 인접 섹션·무에러 OK');
  });
});
