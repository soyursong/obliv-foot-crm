/**
 * T-20260623-foot-RESVMGMT-EXPORT-CANCEL-EXCL-NOSHOW
 * 예약현황 내려받기(parent: T-20260623-foot-RESVMGMT-DAILY-RESV-EXPORT)에
 * 취소/노쇼 별도 버킷 카운트 노출 — 김주연 총괄 (A)안 확정.
 *   '제외(excluded)'는 풋센터 예약 시스템에 없는 분류 → 화면 배너·CSV 양쪽에서 완전 제거.
 *
 * 산식 불변식(이중 산식 금지):
 *   - 초진/재진(HL/PD) 합계 = 유효예약만(취소 제외, 노쇼 포함) — parent 분모 *불변*.
 *   - 취소(cancelled)/노쇼(noshow)만 별도 버킷 카운트로 노출. '제외'는 비표기.
 *   - SSOT = @/lib/resvSlotAgg.summarizeKinds (cancelled/noshow 필드).
 *
 * 시나리오 1: CSV 하단 '상태별 집계' 블록에 취소·노쇼만 있고 '제외' 행/컬럼은 없다.
 * 시나리오 2: 기존 유효합계 블록(초진/재진/HL/PD/합계)이 그대로 보존된다(분모 회귀 가드).
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

async function downloadCsvText(page: import('@playwright/test').Page): Promise<string> {
  const btn = page.getByTestId('day-summary-download');
  await expect(btn).toBeVisible({ timeout: 10000 });
  const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
  await btn.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^예약현황_\d{4}-\d{2}-\d{2}\.csv$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

test.describe('T-20260623-foot-RESVMGMT-EXPORT-CANCEL-EXCL-NOSHOW', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/reservations`);
    await page.waitForLoadState('networkidle');
  });

  // 시나리오 1: 상태별 집계 블록은 취소/노쇼만 — '제외' 행/컬럼 없음.
  test('S1: CSV 상태별 집계 블록에 취소·노쇼만 있고 제외는 없다', async ({ page }) => {
    const text = await downloadCsvText(page);
    // 별도 집계 블록 헤더 + 2개 버킷 라벨(빈 데이터여도 0값으로 존재).
    expect(text).toContain('상태별 집계');
    expect(text).toMatch(/취소,\d+/);
    expect(text).toMatch(/노쇼,\d+/);
    // (A)안 확정: '제외' 행/컬럼은 CSV 어디에도 없어야 한다.
    expect(text).not.toContain('제외');
  });

  // 시나리오 2: 유효합계 블록 분모 불변(회귀 가드) — 취소/제외/노쇼는 합계와 분리.
  test('S2: 기존 유효합계 블록(초진/재진/HL/PD/합계)이 보존된다', async ({ page }) => {
    const text = await downloadCsvText(page);
    expect(text).toContain('당일 예약 현황');
    expect(text).toContain('초진');
    expect(text).toContain('재진');
    expect(text).toContain('HL(힐러)');
    expect(text).toContain('PD(재진)');
    // 합계(초진+재진) 행이 그대로 존재 — 상태 버킷이 합계에 섞이지 않음(이중 산식 금지).
    expect(text).toMatch(/합계\(초진\+재진\),\d+/);
  });
});
