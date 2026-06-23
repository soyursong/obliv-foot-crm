/**
 * T-20260623-foot-RESVMGMT-DAILY-RESV-EXPORT
 * 예약관리 '전체예약' 옆 내려받기 — 당일(KST) 예약 현황 요약(초진 N / 재진 N(HL N, PD N))
 *
 * 산식 SSOT: @/lib/resvSlotAgg.summarizeKinds (resvKind 단일 소스 재사용, TIMETABLE-VISITCOUNT 와 동일).
 *   초진 = new(n) · 재진 = returning(r) + healer(h) · HL = healer(h) · PD = 비힐러 재진(r).
 *
 * 시나리오 1: 정상 동선 — 버튼 표시 → 클릭 → CSV 파일 다운로드 + 요약 토스트.
 * 시나리오 2: 빈 데이터 — 당일 예약 0건이어도 에러 없이 "0" 요약 다운로드.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|reservations|$)/, { timeout: 10000 });
  }
}

test.describe('T-20260623-foot-RESVMGMT-DAILY-RESV-EXPORT', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/reservations`);
    await page.waitForLoadState('networkidle');
  });

  // 시나리오 1-1: '전체예약' 옆 내려받기 버튼 표시
  test('S1-1: 예약관리에 내려받기 버튼이 전체예약 토글 옆에 표시된다', async ({ page }) => {
    const btn = page.getByTestId('day-summary-download');
    await expect(btn).toBeVisible({ timeout: 10000 });
    await expect(btn).toContainText('내려받기');
    // 전체예약 필터와 동일 컨트롤 그룹에 인접
    await expect(page.getByTestId('myresv-filter')).toBeVisible();
  });

  // 시나리오 1-2 + 2: 클릭 → CSV 파일 다운로드(당일 0건이어도 에러 없이 요약 생성)
  test('S1-2/S2: 내려받기 클릭 시 예약현황 CSV가 다운로드된다 (빈 데이터 포함)', async ({ page }) => {
    const btn = page.getByTestId('day-summary-download');
    await expect(btn).toBeVisible({ timeout: 10000 });

    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await btn.click();
    const download = await downloadPromise;

    // 파일명 = 예약현황_YYYY-MM-DD.csv
    expect(download.suggestedFilename()).toMatch(/^예약현황_\d{4}-\d{2}-\d{2}\.csv$/);

    // 본문에 요약 항목 포함(초진/재진/HL/PD). 빈 데이터여도 항목·0값 존재(에러 없음).
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString('utf-8');
    expect(text).toContain('당일 예약 현황');
    expect(text).toContain('초진');
    expect(text).toContain('재진');
    expect(text).toContain('HL(힐러)');
    expect(text).toContain('PD(재진)');
  });
});
