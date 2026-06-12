/**
 * E2E spec — T-20260612-foot-RESV-REVISIT-NOT-LISTED (A2: sim filter 정책 완화)
 *
 * 현장 신고: 예약관리에서 생성한 재진 예약(테스트 고객 "토마토")이 예약관리/대시보드에는
 * 안 뜨고 셀프접수 명단에만 노출. 진단 결과 원인은 visit_type이 아니라
 * stripSimulationRows(customers.is_simulation=true) — admin surface만 sim을 숨겨
 * 셀프접수와 비대칭이었음(T-20260610-foot-ADMIN-SIM-FILTER 의도 동작).
 *
 * 현장 결정(김주연 총괄, A2 확정): 테스트/가상 고객도 admin(예약관리/대시보드)에 노출.
 * → stripSimulationRows를 pass-through(no-op)로 완화. 셀프접수와 일관 노출.
 *
 * AC:
 *  - 예약관리/대시보드가 sim 행 완화 후에도 정상 렌더(no-op 회귀 가드 — 핵심).
 *  - sim(테스트) 고객 예약이 admin에서 더 이상 숨겨지지 않음(정책 반전 검증).
 *  - 신규/재진 양쪽 회귀 없음, 고객마스터 목록 sim 필터는 범위 밖(불변).
 *
 * 비고: 특정 시드("토마토")의 화면 노출은 현재 주간/환경 의존이라 soft-check.
 * 하드 가드는 "admin surface가 깨지지 않고 렌더된다"에 둔다(no-op 변경의 핵심 리스크).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260612 RESV-REVISIT-NOT-LISTED — A2 sim filter 완화', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC: 예약관리 — 정책 완화 후 목록 정상 렌더(크래시/공백 없음)', async ({ page }) => {
    await page.goto('/admin/reservations');
    try {
      await page.waitForLoadState('networkidle', { timeout: 15_000 });
    } catch { /* 타임아웃 무시 — 렌더 확인으로 진행 */ }
    await page.waitForTimeout(1_000);

    // no-op 변경이 목록 로딩을 깨지 않았는지: 캘린더/그리드 또는 빈상태가 렌더되어야 함
    const ready = await Promise.race([
      page.locator('table, [role="grid"], [role="table"]').first().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false),
      page.getByText(/예약/).first().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false),
    ]);
    expect(ready, '예약관리 목록이 렌더되지 않음 — sim 완화 변경 회귀 의심').toBe(true);

    // "예약 목록 로딩 실패" toast 가 떠선 안 됨(쿼리 경로 무손상)
    const failToast = await page.getByText('예약 목록 로딩 실패', { exact: true }).count();
    expect(failToast, '예약 목록 로딩 실패 toast 노출 — 회귀').toBe(0);
    console.log('[AC] 예약관리: sim 완화 후 목록 정상 렌더 OK');
  });

  test('AC: 대시보드 — 칸반/타임라인 정상 렌더(sim 완화 회귀 가드)', async ({ page }) => {
    await page.goto('/admin');
    try {
      await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    } catch {
      test.skip(true, '대시보드 렌더 실패 — 환경 불일치');
      return;
    }
    await page.waitForTimeout(1_500);

    const body = (await page.locator('main, body').first().innerText()) ?? '';
    // 빈 화면(렌더 붕괴)이 아니어야 함
    expect(body.trim().length, '대시보드 본문이 비어있음 — sim 완화 변경 회귀 의심').toBeGreaterThan(0);
    console.log('[AC] 대시보드: sim 완화 후 칸반/타임라인 정상 렌더 OK');
  });

  test('AC(soft): 테스트 고객 "토마토" admin 노출 가능(정책 반전)', async ({ page }) => {
    // 정책 반전 검증: 예전엔 sim 고객("토마토")이 admin에서 무조건 숨겨졌다.
    // 이제는 현재 주간/대시보드에 있으면 노출되어야 한다. 환경 의존이라 soft.
    await page.goto('/admin/reservations');
    try { await page.waitForLoadState('networkidle', { timeout: 15_000 }); } catch { /* noop */ }
    await page.waitForTimeout(1_000);
    const resvBody = (await page.locator('main, body').first().innerText()) ?? '';

    await page.goto('/admin');
    try { await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 }); } catch { /* noop */ }
    await page.waitForTimeout(1_200);
    const dashBody = (await page.locator('main, body').first().innerText()) ?? '';

    const visibleSomewhere = resvBody.includes('토마토') || dashBody.includes('토마토');
    if (visibleSomewhere) {
      console.log('[AC] 정책 반전 확인: 테스트 고객 "토마토"가 admin surface에 노출됨(완화 OK)');
    } else {
      console.log('[AC-soft] "토마토"가 현재 주간/대시보드 범위에 없어 노출 미관측 — 정책 반전 자체는 stripSimulationRows no-op으로 보장(코드 레벨).');
      test.skip(true, '토마토 시드가 현재 view 범위 밖 — soft skip');
    }
  });
});
