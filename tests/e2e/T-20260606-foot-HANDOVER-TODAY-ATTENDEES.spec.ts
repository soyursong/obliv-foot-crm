/**
 * T-20260606-foot-HANDOVER-TODAY-ATTENDEES
 * [직원 근무 캘린더](/admin/handover) 금일 출근자 + 출근 인원수 배너 E2E
 *
 * 요청: 김주연 총괄 (C0ATE5P6JTH)
 * 데이터 소스: 옵션 A — duty_roster READ-only 집계(roster_type ∈ {regular,part} = 출근,
 *              resigned 제외). "오늘" = KST 당일(todaySeoulISODate).
 *
 * UI 원칙(김주연 총괄 확정 2026-06-06): 명단(list)이 화면 주체 — 출근한 직원명을
 *   한눈에 보여주고, 인원수(N명)는 헤더 보조 카운트로 병기. ("출근 인원수가 아니라
 *   출근한 명단이 필요한거야")
 *
 * 커버 시나리오:
 *   S1. 배너 노출 + "오늘 출근 명단" 제목 + 보조 카운트(N명)와 칩(명단) 개수 일치 (AC-1/AC-2)
 *   S2. 빈 상태/카운트 graceful (0명 시 빈 문구 + "0명") (AC-4)
 *   S3. 기존 인수인계 캘린더 3뷰·작성 패널 무회귀 (AC-5)
 *
 * 주의:
 *  - staging 데이터에 오늘 duty_roster 등록이 없을 수 있음 → 배너 존재 + 카운트/칩 정합만
 *    강하게 검증하고, 실제 인원 유무는 데이터 의존이라 graceful 처리.
 */
import { test, expect, type Page } from '@playwright/test';
import { format } from 'date-fns';
import { loginAndWaitForDashboard } from '../helpers';

const HANDOVER_URL = '/admin/handover';
const TODAY = format(new Date(), 'yyyy-MM-dd');

async function gotoHandover(page: Page) {
  await page.goto(HANDOVER_URL);
  await expect(page.getByRole('heading', { name: '직원 근무 캘린더' })).toBeVisible({ timeout: 15_000 });
}

test.describe('T-20260606-foot-HANDOVER-TODAY-ATTENDEES 금일 출근자 배너', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Dashboard not loaded — auth 실패');
  });

  // ── S1. 배너 노출 + 명단 제목 + 카운트/칩 정합 (AC-1/AC-2) ──────────────────
  test('S1 금일 출근자 명단 배너 노출 + 보조 카운트(N명)와 칩(명단) 개수 일치', async ({ page }) => {
    await gotoHandover(page);

    const banner = page.getByTestId('handover-today-attendees');
    await expect(banner).toBeVisible({ timeout: 10_000 });

    // 명단이 화면 주체임을 보장: "오늘 출근 명단" 제목이 보여야 한다
    await expect(banner.getByText('오늘 출근 명단')).toBeVisible({ timeout: 10_000 });

    // 인원수는 보조 카운트("N명")로 병기 — 로딩 '…' 해소 후 안정화될 때까지 대기
    const countEl = page.getByTestId('handover-attendees-count');
    await expect(countEl).toHaveText(/^\d+명$/, { timeout: 10_000 });

    // 헤더의 N 추출
    const text = (await countEl.innerText()).trim();
    const n = Number(text.match(/(\d+)명/)?.[1] ?? 'NaN');
    expect(Number.isFinite(n)).toBeTruthy();

    // 칩 개수 == N (AC-2: 목록과 카운트 항상 일치)
    const chipCount = await page.getByTestId('handover-attendee-chip').count();
    expect(chipCount).toBe(n);

    // N=0이면 빈 문구가 함께 떠야 함 (AC-4)
    if (n === 0) {
      await expect(page.getByTestId('handover-attendees-empty')).toBeVisible();
    }
    console.log(`[ATTENDEES] S1 카운트=${n}, 칩=${chipCount} 정합 OK`);
  });

  // ── S2. 빈 상태 graceful (AC-4) ─────────────────────────────────────────────
  test('S2 출근자 0명 시 빈 문구 + "0명", 에러 없이 렌더', async ({ page }) => {
    await gotoHandover(page);
    const countEl = page.getByTestId('handover-attendees-count');
    await expect(countEl).toHaveText(/^\d+명$/, { timeout: 10_000 });

    const n = Number((await countEl.innerText()).match(/(\d+)명/)?.[1] ?? '-1');
    if (n === 0) {
      await expect(page.getByTestId('handover-attendees-empty')).toBeVisible();
      await expect(countEl).toContainText('0명');
      console.log('[ATTENDEES] S2 빈 상태 확인 OK');
    } else {
      // 데이터가 있는 환경 — 빈 상태 미적용. 배너 자체가 에러 없이 떠 있으면 통과.
      await expect(page.getByTestId('handover-today-attendees')).toBeVisible();
      console.log(`[ATTENDEES] S2 출근자 ${n}명 — 빈 상태 N/A, 정상 렌더 OK`);
    }
  });

  // ── S3. 기존 인수인계 기능 무회귀 (AC-5) ────────────────────────────────────
  test('S3 배너 추가 후 기존 캘린더 3뷰·작성 패널 정상', async ({ page }) => {
    await gotoHandover(page);

    // 배너가 캘린더 위에 공존
    await expect(page.getByTestId('handover-today-attendees')).toBeVisible();

    // 기본 월별 + 3뷰 전환
    await expect(page.getByTestId('handover-view-month')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('handover-view-week').click();
    await expect(page.getByTestId('handover-view-week')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId(`handover-day-${TODAY}`)).toBeVisible();
    await page.getByTestId('handover-view-month').click();

    // 작성 다이얼로그 오픈 (HANDOVER-BOARD 기능 유지)
    await page.getByTestId(`handover-day-${TODAY}`).click();
    await page.getByTestId('handover-new-btn').click();
    await expect(page.getByTestId('handover-dialog')).toBeVisible({ timeout: 8_000 });
    console.log('[ATTENDEES] S3 기존 인수인계 무회귀 OK');
  });
});
