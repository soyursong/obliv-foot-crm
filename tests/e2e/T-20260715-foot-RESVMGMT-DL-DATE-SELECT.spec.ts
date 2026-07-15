/**
 * T-20260715-foot-RESVMGMT-DL-DATE-SELECT
 * 예약관리 '내려받기(다운로드)' — 대상 날짜(과거/미래 임의) 선택 옵션 추가.
 *
 * 기존(T-20260623-foot-RESVMGMT-DAILY-RESV-EXPORT): 오늘(KST) 고정 export.
 * 본 티켓: 내려받기 클릭 → 날짜 선택 다이얼로그(MiniMonthCalendar 재사용) → 선택일 export.
 *   read-only export(AC4): 예약 데이터 write/변경 0. 파일명=예약현황_YYYY-MM-DD.csv(선택일).
 *
 * 현장 클릭 시나리오(티켓 본문):
 *   S1: 과거 날짜 지정 다운로드 → 파일명이 선택한 과거 날짜(≠오늘)
 *   S2: 미래 날짜 지정 다운로드 → 파일명이 선택한 미래 날짜(≠오늘)
 *   S3: 기본값(오늘) 회귀 — 날짜 미변경 다운로드 시 오늘 날짜 그대로(회귀 0, AC3)
 */
import { test, expect } from '@playwright/test';

// baseURL 은 playwright.config.ts use.baseURL(http://localhost:8089) 에서 주입 → 상대경로 사용.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

function todayKst(): string {
  // 로컬(KST) 오늘 yyyy-MM-dd — FE는 new Date() 로컬 기준으로 파일명을 생성.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/admin(\/|$)/, { timeout: 10000 });
  }
}

test.describe('T-20260715-foot-RESVMGMT-DL-DATE-SELECT', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
    // 예약관리 라우트는 /admin 하위(/admin/reservations). '/reservations' 단독은
    // App.tsx 의 catch-all(path="*" → Navigate /admin)로 대시보드로 리다이렉트되어
    // day-summary-download 버튼이 없는 화면이 뜬다(FIX-REQUEST MSG-20260716-052902-tcce RC).
    await page.goto(`${BASE_URL}/admin/reservations`);
    await page.waitForLoadState('networkidle');
  });

  // 내려받기 클릭 시 날짜 선택 다이얼로그(캘린더)가 노출된다.
  test('내려받기 클릭 → 날짜 선택 다이얼로그가 열린다', async ({ page }) => {
    const btn = page.getByTestId('day-summary-download');
    await expect(btn).toBeVisible({ timeout: 10000 });
    await btn.click();

    const dialog = page.getByTestId('download-date-dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByTestId('popup-mini-calendar')).toBeVisible();
    // 기본 선택값 = 오늘
    await expect(page.getByTestId('download-selected-date'))
      .toHaveAttribute('data-selected-date', todayKst());
  });

  // S1: 과거 날짜(이전 달 15일) 지정 → 파일명이 선택한 과거 날짜.
  test('S1: 과거 날짜 지정 다운로드 → 파일명=선택한 과거 날짜(≠오늘)', async ({ page }) => {
    await page.getByTestId('day-summary-download').click();
    const dialog = page.getByTestId('download-date-dialog');
    await expect(dialog).toBeVisible();

    // 이전 달로 이동 후 15일 선택(15일은 항상 표시월 내 유일 셀 — overflow 없음).
    await dialog.getByRole('button', { name: '이전 달' }).click();
    await dialog.getByRole('button', { name: '15', exact: true }).click();

    const selected = await page.getByTestId('download-selected-date').getAttribute('data-selected-date');
    expect(selected).toBeTruthy();
    expect(selected).not.toBe(todayKst()); // 과거 날짜로 바뀜

    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.getByTestId('download-date-confirm').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(`예약현황_${selected}.csv`);
  });

  // S2: 미래 날짜(다음 달 15일) 지정 → 파일명이 선택한 미래 날짜.
  test('S2: 미래 날짜 지정 다운로드 → 파일명=선택한 미래 날짜(≠오늘)', async ({ page }) => {
    await page.getByTestId('day-summary-download').click();
    const dialog = page.getByTestId('download-date-dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: '다음 달' }).click();
    await dialog.getByRole('button', { name: '15', exact: true }).click();

    const selected = await page.getByTestId('download-selected-date').getAttribute('data-selected-date');
    expect(selected).toBeTruthy();
    expect(selected).not.toBe(todayKst()); // 미래 날짜로 바뀜

    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.getByTestId('download-date-confirm').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(`예약현황_${selected}.csv`);
  });

  // S3: 기본값(오늘) 회귀 — 날짜 미변경 후 바로 다운로드 → 오늘 날짜 그대로(AC3).
  test('S3: 날짜 미변경 다운로드 → 오늘 날짜 그대로(기존 동작 회귀 0)', async ({ page }) => {
    await page.getByTestId('day-summary-download').click();
    const dialog = page.getByTestId('download-date-dialog');
    await expect(dialog).toBeVisible();

    // 날짜 미변경(기본값=오늘) 상태로 바로 다운로드
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.getByTestId('download-date-confirm').click();
    const download = await downloadPromise;

    // 파일명이 오늘 날짜 — 기존 동작 회귀 없음. 본문에 기존 요약 항목 포함.
    expect(download.suggestedFilename()).toBe(`예약현황_${todayKst()}.csv`);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream ?? []) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString('utf-8');
    expect(text).toContain('초진');
    expect(text).toContain('재진');
    expect(text).toContain('HL(힐러)');
    expect(text).toContain('PD(재진)');
  });
});
