/**
 * T-20260606-foot-HANDOVER-TODAY-ATTENDEES (REV-1)
 * [직원 근무 캘린더](/admin/handover) 금일 출근 "명단" 배너 E2E
 *
 * 요청: 김주연 총괄 (C0ATE5P6JTH)
 * 데이터 소스(REV-1): 구글시트 근무 캘린더 직접 read — Edge Function `duty-sheet-read`
 *   프록시 → gviz CSV → 블록 캘린더 파싱(lib/dutySheet.ts). 기존 옵션 A(duty_roster
 *   import) 폐기. "오늘"=KST 당일(todaySeoulISODate, AC-3). 시트 오늘 열에 이름 있으면
 *   출근, 빈 칸이면 휴무(셀 존재=출근).
 *
 * UI 원칙(김주연 총괄 확정 2026-06-06): 명단(list)이 화면 주체 — 출근 직원명을
 *   한눈에, 인원수(N명)는 헤더 보조 카운트로 병기.
 *
 * 결정적 테스트: 실제 시트 데이터에 의존하지 않도록 `duty-sheet-read` 응답을 route
 *   mock 으로 가로채 "오늘 열에 이름 N명" / "오늘 열 비어있음" CSV 를 주입한다.
 *
 * 커버 시나리오:
 *   S1. 시트에 오늘 출근자 → 명단 칩 노출 + 보조 카운트(N명)와 칩 개수 일치 (AC-1/AC-2)
 *   S2. 시트 오늘 열 비어있음(휴진일 등) → 빈 문구 + "0명" graceful (AC-4)
 *   S3. 시트 read 실패(프록시 5xx) → 빈 상태 graceful, 페이지·인수인계 무회귀 (AC-4/AC-5)
 *   S4. 기존 인수인계 캘린더 3뷰·작성 패널 무회귀 (AC-5)
 */
import { test, expect, type Page } from '@playwright/test';
import { format } from 'date-fns';
import { loginAndWaitForDashboard } from '../helpers';

const HANDOVER_URL = '/admin/handover';
const TODAY = format(new Date(), 'yyyy-MM-dd');
const DUTY_FN_GLOB = '**/functions/v1/duty-sheet-read*';

/** KST 기준 오늘의 (month, day) — 앱의 todaySeoulISODate 와 정합 */
function kstMonthDay(): { m: number; d: number } {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return { m: kst.getUTCMonth() + 1, d: kst.getUTCDate() };
}

/** 오늘 열에 names 가 들어간 최소 블록 캘린더 CSV(gviz 따옴표 포맷) 생성 */
function buildSheetCsv(names: string[]): string {
  const { m, d } = kstMonthDay();
  // 날짜 행: 오늘(d)을 1번 열에 두고, 서로 다른 날짜 3개 이상 채워 isDateRow 충족
  const others = [d <= 25 ? d + 1 : d - 1, d <= 25 ? d + 2 : d - 2, d <= 25 ? d + 3 : d - 3];
  const dateRow = [d, ...others];
  const q = (arr: (string | number)[]) => arr.map((c) => `"${c}"`).join(',');
  const lines: string[] = [];
  lines.push(q(['', '2026', `${m}월`, '', '', '']));
  lines.push(q(['', '월', '화', '수', '목', '금']));
  lines.push(q(['', ...dateRow, '']));
  // 이름 행들: 오늘 열(index 1)에 name, 나머지 열은 빈칸
  for (const name of names) {
    lines.push(q(['', name, '', '', '']));
  }
  return lines.join('\n');
}

async function mockDutySheet(page: Page, names: string[], opts?: { fail?: boolean }) {
  await page.route(DUTY_FN_GLOB, async (route) => {
    if (opts?.fail) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'UPSTREAM' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, gid: '341864863', csv: buildSheetCsv(names) }),
    });
  });
}

async function gotoHandover(page: Page) {
  await page.goto(HANDOVER_URL);
  await expect(page.getByRole('heading', { name: '직원 근무 캘린더' })).toBeVisible({ timeout: 15_000 });
}

test.describe('T-20260606-foot-HANDOVER-TODAY-ATTENDEES (REV-1) 구글시트 금일 출근 명단', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── S1. 시트 오늘 열 이름 → 명단 + 카운트 정합 (AC-1/AC-2) ───────────────────
  test('S1 시트 오늘 출근자 → 명단 칩 노출 + 보조 카운트(N명) 일치', async ({ page }) => {
    const names = ['김주연', '김수린', '엄경은'];
    await mockDutySheet(page, names);
    await gotoHandover(page);

    const banner = page.getByTestId('handover-today-attendees');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner.getByText('오늘 출근 명단')).toBeVisible({ timeout: 10_000 });

    const countEl = page.getByTestId('handover-attendees-count');
    await expect(countEl).toHaveText(/^\d+명$/, { timeout: 10_000 });
    const n = Number((await countEl.innerText()).match(/(\d+)명/)?.[1] ?? 'NaN');
    expect(n).toBe(names.length);

    const chipCount = await page.getByTestId('handover-attendee-chip').count();
    expect(chipCount).toBe(n);
    // 주입한 이름이 실제로 칩에 보이는지(명단 주체)
    for (const nm of names) {
      await expect(banner.getByTestId('handover-attendee-chip').filter({ hasText: nm })).toHaveCount(1);
    }
    console.log(`[ATTENDEES] S1 시트 ${n}명 명단 정합 OK`);
  });

  // ── S2. 시트 오늘 열 비어있음 → 빈 상태 graceful (AC-4) ──────────────────────
  test('S2 시트 오늘 열 비어있음(휴진일) → 빈 문구 + "0명"', async ({ page }) => {
    await mockDutySheet(page, []); // 오늘 열에 이름 없음
    await gotoHandover(page);

    const countEl = page.getByTestId('handover-attendees-count');
    await expect(countEl).toHaveText('0명', { timeout: 10_000 });
    await expect(page.getByTestId('handover-attendees-empty')).toBeVisible();
    await expect(page.getByTestId('handover-attendee-chip')).toHaveCount(0);
    console.log('[ATTENDEES] S2 빈 상태 graceful OK');
  });

  // ── S3. 시트 read 실패 → graceful, 무회귀 (AC-4/AC-5) ───────────────────────
  test('S3 시트 프록시 5xx → 빈 상태 graceful, 페이지·인수인계 정상', async ({ page }) => {
    await mockDutySheet(page, [], { fail: true });
    await gotoHandover(page);

    // 배너는 떠 있고 에러 없이 빈 상태로 graceful
    await expect(page.getByTestId('handover-today-attendees')).toBeVisible({ timeout: 10_000 });
    const countEl = page.getByTestId('handover-attendees-count');
    await expect(countEl).toHaveText('0명', { timeout: 10_000 });
    await expect(page.getByTestId('handover-attendees-empty')).toBeVisible();
    // 인수인계 캘린더 무회귀
    await expect(page.getByTestId('handover-view-month')).toHaveAttribute('aria-selected', 'true');
    console.log('[ATTENDEES] S3 read 실패 graceful + 무회귀 OK');
  });

  // ── S4. 기존 인수인계 기능 무회귀 (AC-5) ────────────────────────────────────
  test('S4 배너 + 기존 캘린더 3뷰·작성 패널 정상', async ({ page }) => {
    await mockDutySheet(page, ['김주연']);
    await gotoHandover(page);

    await expect(page.getByTestId('handover-today-attendees')).toBeVisible();
    await expect(page.getByTestId('handover-view-month')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('handover-view-week').click();
    await expect(page.getByTestId('handover-view-week')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId(`handover-day-${TODAY}`)).toBeVisible();
    await page.getByTestId('handover-view-month').click();

    await page.getByTestId(`handover-day-${TODAY}`).click();
    await page.getByTestId('handover-new-btn').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible({ timeout: 8_000 });
    console.log('[ATTENDEES] S4 기존 인수인계 무회귀 OK');
  });
});
