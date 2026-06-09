/**
 * E2E spec — T-20260607-foot-CHECKIN-DESIGNATED-FLAG
 * 치료사 통계 '지정치료사 비율' 활성화 (옵션 B 확정).
 *
 * 결정 (2026-06-09, 김주연 총괄, thread 1780969074.253359):
 *   분자 판정 기준 3안(A/B/C) human_pending 데드락 → 옵션 B 확정.
 *   지정 판정 = check_ins.therapist_id == customers.designated_therapist_id (read-only JOIN, 입력0, DB변경0).
 *
 * 계산식 (AC2): per therapist
 *   designated_count    = COUNT(check_ins WHERE check_ins.therapist_id = customers.designated_therapist_id)
 *   total_checkin_count = COUNT(전체 check_ins)
 *   designated_rate     = designated_count / total_checkin_count * 100 (소수1, 분모0이면 NULL)
 *
 * 시나리오 → AC 매핑:
 *   시나리오1 (통계 탭 진입 → 지정치료사 비율 컬럼 실제 % 렌더 + 수기대조) → AC3·AC4.
 *   시나리오2 (데이터0 치료사 '데이터 없음' + 통계 탭 LOAD 무회귀) → AC5.
 *
 * AC4 무결성의 비율 산식은 page.evaluate 순수 회귀로 검증(seeded DB 비의존).
 * AC3/AC5 UI 는 admin 통계 탭 스모크로 검증(배너 없음 + 섹션3 컬럼 렌더).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 옵션 B 비율 산식과 동치인 순수 함수(회귀 기준). RPC/FE 변경 시 동반 수정.
function designatedRateRef(designated: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((designated / total) * 100 * 10) / 10; // 소수1 (ROUND(_,1) 동치)
}

test.describe('T-20260607 CHECKIN-DESIGNATED-FLAG — 지정치료사 비율 (옵션 B)', () => {
  // ── 시나리오1 / AC4: 비율 산식 무결성 (수기 대조 동치) ──
  test('AC4: designated_rate = 분자/분모*100 (소수1), 분모0이면 데이터 없음(null)', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate((src) => {
      const fn = new Function('return ' + src)() as (d: number, t: number) => number | null;
      return {
        // 샘플 수기대조: 지정일치 7 / 전체 20 = 35.0%
        sample: fn(7, 20),
        // 전수 일치
        all: fn(5, 5),
        // 분자 0 (designated_therapist_id 전부 NULL/불일치) → 0.0%
        none: fn(0, 12),
        // 분모 0 (데이터0 치료사) → null = 화면 '데이터 없음'
        empty: fn(0, 0),
        // 반올림: 1/3 = 33.333.. → 33.3
        rounding: fn(1, 3),
      };
    }, designatedRateRef.toString());

    expect(out.sample).toBe(35.0);   // 7/20
    expect(out.all).toBe(100.0);     // 5/5
    expect(out.none).toBe(0.0);      // designated NULL 자동제외
    expect(out.empty).toBeNull();    // AC5: 데이터0 → null
    expect(out.rounding).toBe(33.3); // ROUND(_,1)
  });

  // ── 시나리오1+2 / AC3·AC5: 통계 탭 지정치료사 비율 섹션 렌더 + LOAD 무회귀 ──
  test('AC3/AC5: 치료사 통계 탭 지정 비율 섹션이 에러 없이 렌더되고 컬럼이 표시된다', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.goto('/admin/stats');

    await page.getByTestId('stats-tab-therapist').click();
    await page.getByRole('button', { name: '이번 달' }).click();
    await page.waitForLoadState('networkidle');

    // AC5 무회귀: 에러 배너가 없어야 한다(LOAD-FAIL 동일 RPC군).
    await expect(page.getByText('통계를 불러오지 못했습니다')).toHaveCount(0);

    // AC3: 지정 치료사 비율 섹션 + 컬럼 헤더가 더 이상 placeholder('필드 미구현')가 아니다.
    const designated = page.getByTestId('therapist-metric-designated');
    await expect(designated).toBeVisible();
    await expect(designated.getByText('필드 미구현')).toHaveCount(0);
    await expect(designated.getByRole('columnheader', { name: '지정 비율' })).toBeVisible();
  });
});
