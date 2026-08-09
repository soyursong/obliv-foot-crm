/**
 * T-20260806-foot-SALESDOCTOR-CUMUL-GROSS-REDEFINE (canonical; dedup of ...CUMULATIVE-GROSS-RECOMPUTE)
 * (forward-iteration of 4COL)
 * 매출집계 > 담당실장별 [누적매출]을 gross(환불 차감 前 원본 수납)로 재산식 → 환불 단일차감.
 *
 * 현장 확정(김주연 총괄 2026-08-06):
 *   AC-1(개정3) 누적매출 = gross(환불 차감 前 원본 수납 합계). 랭킹 verbatim(net) 소비 중단.
 *               = 단건(payments) gross + 패키지(package_payments) net · 귀속=assigned_staff_id.
 *   AC-4(유지)  환불금 = 단건(payments) 환불 · assigned_staff_id 귀속 · 환불처리월(accounting_date).
 *   AC-5(유지)  총 매출 = 누적매출 − 환불금 (환불 1회만 차감, 이중차감 해소).
 *   AC-회귀     4컬럼 구조·기간필터·인접 담당치료사별 탭·랭킹(별 surface) 무접촉.
 *
 * ★부모 4COL 대비 핵심 델타: 누적매출이 gross 로 커져(≥ net) 총매출이 '이중차감 이전 값'에서
 *   payments 환불 1회분만큼 회복된다. 빈 데이터(staging)에선 구조·문구·무에러로 대체.
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

/** "1,234,000원"/"−1,234,000원" → 부호 포함 숫자. '—'/빈값 → null. */
function parseWon(text: string | null): number | null {
  if (!text) return null;
  const head = text.split('원')[0];
  const neg = /[−-]/.test(head);
  const digits = head.replace(/[^0-9]/g, '');
  if (digits === '') return null;
  const n = Number(digits);
  return neg ? -n : n;
}

test.describe('T-20260806-foot-SALESDOCTOR-CUMULATIVE-GROSS-RECOMPUTE 누적매출 gross 재산식', () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── AC-회귀: 4컬럼 구조 유지 ─────────────────────────────────────────────────
  test('AC-회귀: [실장][누적매출][환불금][총 매출] 4열 구조 유지', async ({ page }) => {
    await gotoDoctorTab(page);
    if (!(await hasTable(page))) {
      await expect(page.locator('[data-testid="sales-doctor-empty"]')).toBeVisible();
      return;
    }
    const headers = page.locator('[data-testid="sales-doctor-tab"]').getByRole('columnheader');
    await expect(headers).toHaveCount(4);
    await expect(headers.nth(1)).toHaveText('누적매출');
    await expect(headers.nth(2)).toHaveText('환불금');
    await expect(headers.nth(3)).toHaveText('총 매출');
    console.log('[GROSS] 4컬럼 구조 유지 OK');
  });

  // ── AC-1(개정3): 누적매출 문구가 gross('환불 차감 전')로 전환 — 신 산식 shipped 증적 ──
  test("AC-1: 누적매출 문구가 '환불 차감 전' gross 로 전환(랭킹 연동 문구 제거)", async ({ page }) => {
    await gotoDoctorTab(page);
    const root = page.locator(
      '[data-testid="sales-doctor-tab"], [data-testid="sales-doctor-empty"]',
    );
    await expect(root).toBeVisible();
    if (await hasTable(page)) {
      const note = page.locator('[data-testid="sales-doctor-tab"] p');
      await expect(note).toContainText('환불 차감 전');
      await expect(note).toContainText('환불 1회 차감');
      // 부모(net·랭킹 연동) 문구가 사라졌는지 — 이중차감 유발 산식 잔존 금지
      await expect(note).not.toContainText('랭킹의 월매출과 동일 값');
      console.log('[GROSS] 누적매출 gross 문구 전환 OK');
    } else {
      console.log('[GROSS] empty state — 문구 검증 skip');
    }
  });

  // ── AC-5(핵심): 행별 총매출 == 누적 − 환불 + gross≥net(환불 단일차감) ───────────
  test('AC-5: 총매출 = 누적 − 환불 산술일치 & 환불행 gross≥총(단일차감 회복)', async ({ page }) => {
    await gotoDoctorTab(page);
    if (!(await hasTable(page))) {
      console.log('[GROSS] empty state — 산술 검증 skip(데이터 없음)');
      return;
    }
    const rows = await page.locator('[data-testid="sales-doctor-tab"] tbody tr').evaluateAll((trs) =>
      trs.map((tr) => {
        const pick = (frag: string) =>
          (tr.querySelector(`[data-testid^="sales-doctor-${frag}-"]`) as HTMLElement | null)
            ?.textContent ?? null;
        return { cum: pick('cumulative'), ref: pick('refund'), total: pick('total') };
      }),
    );
    let checked = 0;
    let refundRows = 0;
    for (const r of rows) {
      const total = parseWon(r.total);
      if (total == null) continue;
      const cum = parseWon(r.cum) ?? 0;
      const ref = parseWon(r.ref) ?? 0; // 환불금 −부호 표시 → 음수 반환
      // 총 = 누적 − |환불| = cum + ref(ref 이미 음수). 환불이 딱 1회만 반영됨을 산술로 검증.
      expect(Math.abs(total - (cum + ref)), `총 ${total} ≠ 누적 ${cum} − 환불 ${-ref}`)
        .toBeLessThanOrEqual(1);
      // gross ≥ net: 환불이 있는 행(ref<0)은 누적(gross) 이 총(net)보다 |환불|만큼 크다.
      if (ref < 0) {
        refundRows++;
        expect(cum, `환불행 누적(gross) ${cum} < 총(net) ${total} — gross 미반영`).toBeGreaterThanOrEqual(
          total,
        );
        expect(cum - total, `환불 단일차감 불일치: 누적−총 ${cum - total} ≠ |환불| ${-ref}`)
          .toBe(-ref);
      }
      checked++;
    }
    console.log(
      `[GROSS] AC-5 산술 정합 ${checked}행 · 환불이력 실장 ${refundRows}행 gross≥net(단일차감) 검증 완료`,
    );
  });

  // ── AC-회귀: 기간필터·인접 담당치료사별 탭·무에러 ────────────────────────────
  test('AC-회귀: 담당치료사별 탭 왕복 무회귀 + pageerror 0', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await gotoDoctorTab(page);
    await page.waitForTimeout(800);

    await page.getByRole('tab', { name: '담당치료사별' }).click();
    await expect(
      page.locator(
        '[data-testid="sales-staff-tab"], [data-testid="sales-staff-deduct-tab"], [data-testid="sales-staff-empty"], [data-testid="sales-staff-deduct-empty"]',
      ).first(),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole('tab', { name: TAB_NAME }).click();
    await expect(
      page.locator('[data-testid="sales-doctor-tab"], [data-testid="sales-doctor-empty"]'),
    ).toBeVisible({ timeout: 15_000 });

    expect(errors, `pageerror 발생: ${errors.join(' | ')}`).toHaveLength(0);
    console.log('[GROSS] 인접 탭 왕복·무에러 OK');
  });
});
