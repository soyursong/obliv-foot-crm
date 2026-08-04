/**
 * E2E spec — T-20260804-foot-DAYCLOSE-PAYHIST-REFUND-BADGE-VERTICAL
 * 일마감 > 결제내역 > CRM 수납: 환불 처리 시 상태 배지가 세로로 깨져 표기되는 버그 수정.
 *
 * ── RC(dev 확정) ──────────────────────────────────────────────────────────
 * 구분(status) 셀은 w-16(64px, px-2 제외 실폭 ~48px) 좁은 폭.
 * 환불 시 배지가 2~3개([단건/패키지][환불][완료]) 동시 렌더 → flex 컨테이너에서
 * CJK 텍스트가 문자 단위로 break 가능 → flex-shrink 로 배지가 한 글자 폭까지 수축 →
 * '환/불' 세로 쌓임(vertical stacking). 정상 결제행은 배지 1개라 수축 없음(그래서 환불만 깨짐).
 *
 * ── 수정 ─────────────────────────────────────────────────────────────────
 * 각 배지 whitespace-nowrap(문자 세로쪼갬 차단) + shrink-0(수축 차단),
 * 컨테이너 flex-wrap(넘치면 줄내림·각 배지는 항상 가로 한 줄) + 구분 컬럼 폭 w-16→w-24.
 *
 * ── 수용기준 ─────────────────────────────────────────────────────────────
 * AC-1: 환불 처리 후 배지가 가로 한 줄(세로 쌓임/내부 wrap 없음)
 * AC-2: 정상 결제 항목 배지 회귀 없음
 * AC-3: 배지 텍스트 길어도 셀 안에서 안 깨짐(nowrap/폭확보)
 *
 * 패턴 출처: T-20260804-foot-DAYCLOSE-PAYTAB-LAYOUT-SUSUPOPUP.spec.ts (결제내역 진입 helper 재사용)
 * 데이터-비의존 검증: refunded-badge testid + computed style(white-space/flex-shrink) + 단일행 높이.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

/** 결제내역(CRM 수납) 탭으로 진입. 진입 성공 시 payments table header locator 반환, 실패/미존재 시 null. */
async function gotoPaymentsTable(page: Page) {
  await page.goto('/admin/closing');
  await page.waitForLoadState('networkidle');
  const paymentsTab = page.getByRole('tab', { name: /결제내역/ });
  if (await paymentsTab.count() === 0) return null;
  await paymentsTab.click();
  await page.waitForTimeout(500);
  const crmSubTab = page.getByRole('tab', { name: /^CRM 수납$/ });
  if (await crmSubTab.count() > 0) {
    await crmSubTab.click();
    await page.waitForTimeout(300);
  }
  const header = page.locator('table thead th', { hasText: '결제금액' }).first();
  if (await header.count() === 0) return null;
  return header;
}

test.describe('T-20260804-DAYCLOSE-PAYHIST-REFUND-BADGE-VERTICAL — 환불 배지 세로깨짐 수정', () => {

  // ── AC-1/AC-3: 환불 배지가 존재하면 가로 한 줄 — white-space:nowrap + 수축차단 ──────
  test('AC-1: refunded-badge 는 white-space:nowrap + flex-shrink:0 (세로 쌓임 불가)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패(CI 자격증명 없음)'); return; }

    const header = await gotoPaymentsTable(page);
    if (!header) { test.skip(true, '결제내역 테이블 미노출(RBAC/데이터 없음)'); return; }

    const refundedBadge = page.locator('[data-testid="refunded-badge"]').first();
    if (await refundedBadge.count() === 0) {
      test.skip(true, '당일 환불 데이터 없음 — 정적 클래스 회귀는 AC-2에서 검증');
      return;
    }

    await expect(refundedBadge).toBeVisible({ timeout: 10000 });
    const whiteSpace = await refundedBadge.evaluate(el => getComputedStyle(el as Element).whiteSpace);
    const shrink = await refundedBadge.evaluate(el => getComputedStyle(el as Element).flexShrink);
    expect(whiteSpace, '배지 내부 텍스트 세로 쪼갬 차단(nowrap)').toBe('nowrap');
    expect(shrink, '좁은 셀에서 배지 수축 차단(shrink-0)').toBe('0');

    // 배지 높이가 1줄 범위 — 세로로 문자가 쌓이면 높이가 배로 커짐(대략 40px 초과 금지)
    const box = await refundedBadge.boundingBox();
    expect(box, '배지 박스 계측 가능').not.toBeNull();
    expect(box!.height, '배지 높이=단일 라인(세로 쌓임이면 2배↑)').toBeLessThan(40);
    // 가로가 세로보다 넓어야 정상(세로 쌓임이면 width<height 로 역전)
    expect(box!.width, '가로 폭 ≥ 높이(세로 쌓임이면 역전)').toBeGreaterThanOrEqual(box!.height);
  });

  // ── AC-2: 정상 결제 구분 배지(단건/패키지/수기) 회귀 없음 — 동일 nowrap 정책 ──────
  test('AC-2: 구분 셀의 status 배지 모두 nowrap + shrink-0 (정상 결제행 회귀 없음)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패(CI 자격증명 없음)'); return; }

    const header = await gotoPaymentsTable(page);
    if (!header) { test.skip(true, '결제내역 테이블 미노출(RBAC/데이터 없음)'); return; }

    // 구분 컬럼 셀 내 배지(성함/결제수단 등 다른 셀 배지 제외 위해 data-testid 없는 배지도 포함)
    // 단건/패키지/수기/환불 어느 라벨이든 rounded-full 배지가 세로로 깨지지 않아야 함.
    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    if (rowCount === 0) { test.skip(true, '결제내역 행 없음'); return; }

    // 구분 셀 = 각 행에서 '환불'(action) 컬럼 직전. status 배지는 flex-wrap 컨테이너 안.
    const statusBadges = page.locator('table tbody tr td div.flex-wrap span.rounded-full');
    const n = await statusBadges.count();
    if (n === 0) { test.skip(true, 'status 배지 미노출'); return; }

    for (let i = 0; i < Math.min(n, 20); i++) {
      const b = statusBadges.nth(i);
      const ws = await b.evaluate(el => getComputedStyle(el as Element).whiteSpace);
      const sh = await b.evaluate(el => getComputedStyle(el as Element).flexShrink);
      expect(ws, `status 배지[${i}] nowrap`).toBe('nowrap');
      expect(sh, `status 배지[${i}] shrink-0`).toBe('0');
      const box = await b.boundingBox();
      if (box) expect(box.height, `status 배지[${i}] 단일 라인 높이`).toBeLessThan(40);
    }
  });
});
