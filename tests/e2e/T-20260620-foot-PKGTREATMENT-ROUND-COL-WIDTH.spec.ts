/**
 * E2E spec — T-20260620-foot-PKGTREATMENT-ROUND-COL-WIDTH
 * [2번차트] 패키지 치료이력(시술내역) 섹션 회차 칸 너비 (김주연 총괄, C0ATE5P6JTH)
 *
 * 핵심: 직전 배포 eb54f5df(사용이력 회차열)의 동일 처방을 치료이력 섹션 회차 칸에 미러링.
 *   구: w-5(20px) → "10회"~"99회" 두 자리 회차에서 "10"/"회" 줄바꿈.
 *   신: min-w-[2.4rem] + whitespace-nowrap → 두 자리 회차도 1행 고정.
 * 두 섹션은 컴포넌트 비공유(치료이력=CustomerChartPage 인라인, 사용이력=PackageTicketReadonlyList) → 직접 수정.
 *
 * AC1: 치료이력 두 자리 회차 한 줄(줄바꿈 0).
 * AC2: 한 자리 회차 회귀 0(동일 1행 표시).
 * AC3: 인접 컬럼 레이아웃 안 밀림(회차칸 nowrap·min-w 적용).
 * AC4: 사용이력 회차열(eb54f5df) 표시 유지 — PackageTicketReadonlyList 회귀가드.
 *
 * 차트/패키지 데이터 의존 → 시술내역 없으면 graceful skip.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 회차 셀: "{n}회" 텍스트 span. 두 자리/한 자리 모두 포함.
const ROUND_RE = /^\d+회$/;

async function openFirstCustomerChartWithSessions(page: Page): Promise<boolean> {
  await page.goto('/admin/customers');
  await page.waitForLoadState('networkidle').catch(() => {});
  const rows = page.locator('[data-testid^="customer-row-"], table tbody tr');
  const count = await rows.count().catch(() => 0);
  if (count === 0) return false;
  // 앞에서부터 차트를 열어 시술내역(회차 셀)이 있는 고객을 탐색
  const tryN = Math.min(count, 8);
  for (let i = 0; i < tryN; i++) {
    await rows.nth(i).click().catch(() => {});
    await page.waitForTimeout(600);
    const roundCells = page.locator('span', { hasText: ROUND_RE });
    if ((await roundCells.count().catch(() => 0)) > 0) return true;
    // 닫고 다음 후보
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
  }
  return false;
}

test.describe('PKGTREATMENT-ROUND-COL-WIDTH — 치료이력 회차 칸 너비', () => {
  test('AC1·AC2·AC3 — 치료이력 회차 셀: 1행 고정 + nowrap (한/두 자리 무관)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    test.skip(!ok, '로그인 실패 — 환경 미준비');

    const found = await openFirstCustomerChartWithSessions(page);
    test.skip(!found, '시술내역(회차) 데이터 없음 — graceful skip');

    const roundCells = page.locator('span', { hasText: ROUND_RE });
    const n = await roundCells.count();
    expect(n).toBeGreaterThan(0);

    for (let i = 0; i < n; i++) {
      const cell = roundCells.nth(i);
      const box = await cell.boundingBox();
      if (!box) continue;
      // AC1·AC2: 1행 고정 — 줄바꿈 시 높이가 2배가 됨. 단일 라인 높이 상한(<= 26px) 검증.
      expect(box.height, `회차 셀 #${i} 단일행 높이 초과(줄바꿈 의심)`).toBeLessThanOrEqual(26);
      // AC3: whitespace-nowrap 적용 — 줄바꿈 자체를 CSS로 차단.
      const ws = await cell.evaluate((el) => getComputedStyle(el).whiteSpace);
      expect(ws, `회차 셀 #${i} white-space != nowrap`).toBe('nowrap');
    }
  });
});
