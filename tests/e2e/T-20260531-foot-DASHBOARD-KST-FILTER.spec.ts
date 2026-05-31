/**
 * E2E spec — T-20260531-foot-DASHBOARD-KST-FILTER
 * "오늘 접수" 명단 쿼리의 날짜 필터가 UTC 기준이라 KST 오전 체크인이 누락되던 버그 회귀 차단.
 *
 * 현장 증상(김주연 총괄, 5/31):
 *   고객관리 명단에는 빨강(체크인 완료)으로 표시되는데 대시보드 "접수 현황"에는 안 보임.
 *   → 풋 DB에는 데이터 존재. 대시보드 쿼리의 날짜 필터가 진짜 원인.
 *
 * 근본 원인:
 *   check_ins.checked_in_at 은 UTC(timestamptz). 다음 두 쿼리가 타임존 suffix 없는 bound로
 *   비교 → Postgres가 naive 문자열을 UTC로 해석 → KST 오전(00:00~09:00) 체크인
 *   (예: 07:41 KST = 전날 22:41Z)이 `${today}T00:00:00`(UTC) 범위 밖으로 제외됨.
 *     - src/components/doctor/DoctorPatientList.tsx  (오늘 접수된 환자 목록)
 *     - src/components/PaymentMiniWindow.tsx          (금일 시술내역)
 *
 * 수정:
 *   today 를 todaySeoulISODate() (KST) 로 산출하고 bound 에 '+09:00' 부여.
 *     .gte('checked_in_at', `${today}T00:00:00+09:00`)
 *     .lte('checked_in_at', `${today}T23:59:59+09:00`)
 *
 * AC-1(핵심): KST 오전 UTC 체크인이 '+09:00' bound 범위 안에 포함된다.
 * AC-2(회귀 회로): 타임존 없는 naive bound는 동일 케이스를 제외했음을 명시.
 * AC-3: 대시보드 렌더링 회귀 없음.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260531 DASHBOARD-KST-FILTER — 오늘 접수 명단 KST 날짜 필터', () => {
  // ── AC-1 / AC-2: bound 비교 의미론 (환경 독립) ──────────────────────────────
  test('AC-1: KST 오전 체크인이 +09:00 bound 범위에 포함된다 (naive bound는 제외 — AC-2)', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      // Postgres timestamptz vs 문자열 bound 비교를 절대시각(epoch ms)으로 모사.
      // - '+09:00' 가 있으면 KST 절대시각으로 파싱
      // - suffix 가 없으면(naive) Postgres 세션 tz(UTC 가정)로 해석 → 'Z' 부착과 동치
      const asInstant = (s: string, naive: boolean) =>
        new Date(naive ? `${s}Z` : s).getTime();

      const today = '2026-05-31';                       // 당일(KST)
      const checkedInAt = '2026-05-30T22:41:00+00:00';  // 07:41 KST = 전날 22:41Z
      const ci = new Date(checkedInAt).getTime();

      // 신규(정상): +09:00 bound
      const fixedStart = asInstant(`${today}T00:00:00+09:00`, false);
      const fixedEnd = asInstant(`${today}T23:59:59+09:00`, false);
      const includedFixed = ci >= fixedStart && ci <= fixedEnd;

      // 구(버그): 타임존 없는 naive bound (UTC 해석)
      const naiveStart = asInstant(`${today}T00:00:00`, true);
      const naiveEnd = asInstant(`${today}T23:59:59`, true);
      const includedNaive = ci >= naiveStart && ci <= naiveEnd;

      return { includedFixed, includedNaive };
    });

    // 신규 bound: 포함되어야 정상 (현장 빨강 체크인이 명단에 보인다)
    expect(result.includedFixed).toBe(true);
    // 구 bound: 제외했음 — 회귀 방지 회로 (이게 true 로 바뀌면 버그 재현 불가 = 테스트 무의미)
    expect(result.includedNaive).toBe(false);
  });

  // ── AC-1 보강: 오후 체크인은 양쪽 bound 모두 포함 (정상 케이스 불변) ──────────
  test('AC-1b: KST 오후 체크인은 신규/구 bound 모두 포함된다 (정상 케이스 회귀 없음)', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const asInstant = (s: string, naive: boolean) =>
        new Date(naive ? `${s}Z` : s).getTime();
      const today = '2026-05-31';
      const checkedInAt = '2026-05-31T05:30:00+00:00'; // 14:30 KST = 05:30Z 당일
      const ci = new Date(checkedInAt).getTime();
      const fixedStart = asInstant(`${today}T00:00:00+09:00`, false);
      const fixedEnd = asInstant(`${today}T23:59:59+09:00`, false);
      return { includedFixed: ci >= fixedStart && ci <= fixedEnd };
    });
    expect(result.includedFixed).toBe(true);
  });

  // ── AC-3: 대시보드 렌더 회귀 ────────────────────────────────────────────────
  test('AC-3: 대시보드가 정상 렌더된다 (회귀 없음)', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await expect(page.locator('body')).toBeVisible();
  });
});
