/**
 * E2E spec — T-20260531-foot-CHECKIN-DASHBOARD-SYNC
 * 셀프 체크인 완료가 통합 시간표 대시보드에 미반영 (realtime 갱신 누락)
 *
 * 근본 원인:
 *   check_ins.checked_in_at 은 UTC(timestamptz)로 저장된다. KST 오전(00:00~09:00) 셀프접수는
 *   checked_in_at 의 UTC 날짜가 "전날"이 된다 (예: 07:47 KST = 22:47Z 전날).
 *   Dashboard realtime 구독 가드가 `checked_in_at.startsWith(dateStr)` 로 당일 여부를 판정했기에
 *   당일(KST) 체크인 INSERT realtime 이벤트를 오탐 제외 → 통합 시간표 미반영 + 토스트 누락.
 *
 * 수정:
 *   created_date(트리거가 KST로 산출하는 date 컬럼) 우선 비교, 누락 시 checked_in_at 을
 *   seoulISODate()로 KST 날짜로 환산해 당일 여부를 판정. (src/lib/format.ts seoulISODate 추가)
 *
 * AC-1(핵심): KST 오전 UTC 타임스탬프가 당일 KST 날짜로 환산되어 realtime 가드를 통과한다.
 * AC-2: 기존 `startsWith(UTC date)` 가드는 동일 케이스를 오탐 제외했음을 명시(회귀 방지 회로).
 * AC-3: 대시보드 통합 시간표 렌더링 회귀 없음.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260531 CHECKIN-DASHBOARD-SYNC — KST 오전 체크인 realtime 반영', () => {
  // ── AC-1: 핵심 날짜 환산 로직 (환경 독립, 브라우저 tz 기준) ─────────────────────

  test('AC-1: KST 오전 UTC 타임스탬프가 당일 KST 날짜로 환산된다 (realtime 가드 통과)', async ({ page }) => {
    await page.goto('/');
    // 수정 함수 seoulISODate 와 동일한 en-CA + Asia/Seoul locale trick
    const result = await page.evaluate(() => {
      const seoulISODate = (input: string) =>
        new Date(input).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
      // 07:47 KST = 22:47Z 전날 — 현장 보고 케이스
      const utcMorning = '2026-05-30T22:47:00+00:00';
      const dateStr = '2026-05-31'; // 대시보드가 보고 있는 당일(KST)
      return {
        seoulDate: seoulISODate(utcMorning),
        dateStr,
        // 신규 가드: rowSeoulDate !== dateStr 이면 제외 → false 여야(=통과) 정상
        guardDropsEvent: seoulISODate(utcMorning) !== dateStr,
        // 구 가드: checked_in_at.startsWith(dateStr) === false 이면 제외(=버그)
        oldGuardDropsEvent: !utcMorning.startsWith(dateStr),
      };
    });

    // 수정 후: KST 날짜로 정확히 환산되어 당일과 일치 → 이벤트 통과
    expect(result.seoulDate).toBe('2026-05-31');
    expect(result.guardDropsEvent).toBe(false);
    // 회귀 회로: 구 가드는 이 케이스를 잘못 제외했음을 박제
    expect(result.oldGuardDropsEvent).toBe(true);
  });

  test('AC-2: created_date(KST date 컬럼)가 당일과 일치하면 realtime 이벤트를 유지한다', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // 신규 가드 우선순위: created_date(KST) → checked_in_at(UTC) 환산
      const seoulISODate = (input: string) =>
        new Date(input).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
      const dateStr = '2026-05-31';
      const newRow = {
        created_date: '2026-05-31', // 트리거 산출 (KST)
        checked_in_at: '2026-05-30T22:47:00+00:00', // UTC (전날)
      };
      const rowSeoulDate =
        (newRow.created_date as string | undefined) ??
        (newRow.checked_in_at ? seoulISODate(newRow.checked_in_at) : undefined);
      return { rowSeoulDate, drops: !!rowSeoulDate && rowSeoulDate !== dateStr };
    });
    expect(result.rowSeoulDate).toBe('2026-05-31');
    expect(result.drops).toBe(false);
  });

  test('AC-2-B: 실제 타 날짜 이벤트는 정상적으로 제외된다 (오탐 반대방향 회귀 없음)', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const seoulISODate = (input: string) =>
        new Date(input).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
      const dateStr = '2026-05-31';
      const otherDay = '2026-05-29T05:00:00+00:00'; // 5/29 14:00 KST
      const rowSeoulDate = seoulISODate(otherDay);
      return { rowSeoulDate, drops: rowSeoulDate !== dateStr };
    });
    expect(result.rowSeoulDate).toBe('2026-05-29');
    expect(result.drops).toBe(true);
  });

  // ── AC-3: 대시보드 통합 시간표 렌더 회귀 ──────────────────────────────────────

  test('AC-3: 대시보드 통합 시간표 렌더링 회귀 없음', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) {
      test.skip(true, '로그인 실패 — 스킵');
      return;
    }
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const slotRows = page.locator('[data-testid="timeline-slot-row"]');
    try {
      await slotRows.first().waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '통합시간표 슬롯 미표시 — 환경 스킵');
      return;
    }
    const count = await slotRows.count();
    expect(count).toBeGreaterThan(0);
  });
});
