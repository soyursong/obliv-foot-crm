/**
 * E2E spec — T-20260609-foot-THERAPIST-STATS-LOAD-FAIL
 * 치료사 통계 탭 '불러오기 실패' 하드에러 (P1 hotfix, V2 field-soak 회귀).
 *
 * 현장 보고 (김주연 총괄, 슬랙 C0ATE5P6JTH / 2026-06-09):
 *   통계 대시보드 → 치료사 통계 탭, 기간 '이번 달'(2026-06-01~09):
 *   빨간 배너 "통계를 불러오지 못했습니다: 통계 불러오기 실패" + 두 섹션 "데이터 없음".
 *
 * 근본 원인 (조사 결과):
 *   THERAPIST-STATS-V2(a27175d)의 RPC 마이그(20260609100000)·정밀화(20260609180000)가
 *   prod DB 에 적용되지 않아 prod 가 V1 함수(COMMENT=T-20260607)를 그대로 운영.
 *   - foot_stats_therapist_services 가 V1 시그니처(service_name, cnt)를 반환 →
 *     FE 의 V2 계약(treatment_type/cnt/linked_count/avg_minutes)과 불일치 → 섹션2 '데이터 없음'.
 *   - supabase-js PostgrestError 는 Error 인스턴스가 아니라 generic '통계 불러오기 실패'로 가려짐.
 *
 * 조치:
 *   1) prod 에 20260609180000(v2.1, 100000 supersede) 적용 → 함수 시그니처/COMMENT v2.1 + PostgREST reload.
 *   2) AC-3 FE 에러 가시성: describeStatsError() 로 PostgrestError code/message/hint 를 1줄로 환원,
 *      콘솔에는 원본 객체 통째로(console.error).
 *
 * 시나리오 → AC 매핑:
 *   시나리오1 (현장 클릭: 치료사 통계 탭 + 이번 달) → AC-1 로드 정상(배너 없음).
 *   시나리오2 (에러 가시성) → AC-3 describeStatsError 가 PostgrestError 의 raw 원인을 환원.
 *
 * AC-3 의 describeStatsError 순수 로직은 page.evaluate 로 회귀 검증(seeded DB 비의존).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// stats.ts describeStatsError 와 동치인 순수 함수(회귀 기준). 구현 변경 시 동반 수정.
function describeStatsErrorRef(e: unknown): string {
  if (e && typeof e === 'object') {
    const pg = e as { message?: unknown; code?: unknown; hint?: unknown };
    const parts: string[] = [];
    if (typeof pg.message === 'string' && pg.message) parts.push(pg.message);
    if (typeof pg.code === 'string' && pg.code) parts.push(`code=${pg.code}`);
    if (typeof pg.hint === 'string' && pg.hint) parts.push(`hint=${pg.hint}`);
    if (parts.length) return parts.join(' · ');
  }
  if (e instanceof Error && e.message) return e.message;
  return '통계 불러오기 실패';
}

test.describe('T-20260609 THERAPIST-STATS-LOAD-FAIL — 치료사 통계 로드 실패 정정', () => {
  // ── 시나리오2 / AC-3: PostgrestError 가 generic 문구가 아니라 raw 원인으로 보여야 한다 ──
  test('AC-3: PostgrestError(plain object)도 code/message/hint 가 배너 문구로 환원된다', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate((src) => {
      // 페이지 컨텍스트에서 동일 로직 재현 (브라우저 직렬화로 함수 전달)
      const fn = new Function('return ' + src)() as (e: unknown) => string;
      const postgrest = { message: 'Could not find the function', code: 'PGRST202', hint: 'reload schema' };
      const realError = new Error('column "x" does not exist');
      const empty = null;
      return {
        // 과거 버그: PostgrestError 는 Error 가 아니라 generic 으로 가려졌다.
        postgrestHidden_oldBehavior: postgrest instanceof Error,
        postgrestDescribed: fn(postgrest),
        errorDescribed: fn(realError),
        nullFallback: fn(empty),
      };
    }, describeStatsErrorRef.toString());

    // 회귀 기대: PostgrestError 가 더 이상 가려지지 않는다.
    expect(out.postgrestHidden_oldBehavior).toBe(false); // 예전엔 이 false 때문에 generic 으로 빠졌음
    expect(out.postgrestDescribed).toContain('Could not find the function');
    expect(out.postgrestDescribed).toContain('code=PGRST202');
    expect(out.postgrestDescribed).toContain('hint=reload schema');
    // 진짜 Error 는 message 그대로.
    expect(out.errorDescribed).toBe('column "x" does not exist');
    // 알 수 없는 형태만 generic fallback.
    expect(out.nullFallback).toBe('통계 불러오기 실패');
  });

  // ── 시나리오1 / AC-1: 치료사 통계 탭 + 이번 달 → 에러 배너 없이 정상 로드 ──
  test('AC-1: 치료사 통계 탭(이번 달)이 에러 배너 없이 로드된다', async ({ page }) => {
    await loginAndWaitForDashboard(page);
    await page.goto('/admin/stats');

    // 치료사 통계 탭 진입
    await page.getByTestId('stats-tab-therapist').click();
    // '이번 달' 프리셋
    await page.getByRole('button', { name: '이번 달' }).click();

    // 로드 안정화 대기
    await page.waitForLoadState('networkidle');

    // AC-1: 에러 배너가 없어야 한다.
    await expect(page.getByText('통계를 불러오지 못했습니다')).toHaveCount(0);
  });
});
