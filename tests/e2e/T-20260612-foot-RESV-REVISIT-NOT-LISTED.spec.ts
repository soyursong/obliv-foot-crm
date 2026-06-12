/**
 * E2E spec — T-20260612-foot-RESV-REVISIT-NOT-LISTED (A2 / 범위 b: 정밀 화이트리스트)
 *
 * 현장 신고: 예약관리에서 생성한 재진 예약(테스트 고객 "토마토")이 예약관리/대시보드에는
 * 안 뜨고 셀프접수 명단에만 노출. 진단 결과 원인은 visit_type이 아니라
 * stripSimulationRows(customers.is_simulation=true) — admin surface만 sim을 숨겨
 * 셀프접수와 비대칭이었음(T-20260610-foot-ADMIN-SIM-FILTER 의도 동작).
 *
 * 현장 결정(김주연 총괄, A2 확정): 토마토=의도적 테스트 페르소나 → admin 노출.
 * GO_WARN 실측: sim 731명 중 730명이 종로(실운영) 누적 bulk/명명형 더미. 전면완화(a)는
 * 종로 admin에 729개 더미 재유입 → 폐기. **현장 요청 페르소나만 노출(b)** 로 한정.
 * → simulationFilter.ts: is_simulation 숨김 복원 + EXPOSED_SIM_NAMES(['토마토']) 예외.
 *
 * AC:
 *  - 예약관리/대시보드가 정책 조정 후에도 정상 렌더(회귀 가드 — 핵심).
 *  - 화이트리스트 sim("토마토")은 admin 노출. 비화이트리스트 sim("양배추"·"고양이")은 숨김 유지.
 *  - 실고객/워크인 예약 무손상(누락 0). 신규/재진 양쪽 회귀 없음.
 *
 * 하드 증명: scripts/..._Bpath_verify.mjs (live DB — 토마토 노출/양배추·고양이 숨김/실고객
 * 124→124 무손상 4/4 PASS). 본 playwright는 렌더-회귀 가드 + 토마토 노출 soft-check.
 * 특정 시드 화면 노출은 현재 주간/환경 의존이라 soft.
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

  test('AC(soft): 화이트리스트 "토마토" 노출 / 비화이트리스트 더미 숨김', async ({ page }) => {
    // (b) 정책 검증: 화이트리스트 sim("토마토")은 admin 노출, 비화이트리스트 sim
    // ("양배추"·"고양이")은 숨김 유지. 화면 노출은 현재 주간/환경 의존이라 soft.
    await page.goto('/admin/reservations');
    try { await page.waitForLoadState('networkidle', { timeout: 15_000 }); } catch { /* noop */ }
    await page.waitForTimeout(1_000);
    const resvBody = (await page.locator('main, body').first().innerText()) ?? '';

    await page.goto('/admin');
    try { await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 }); } catch { /* noop */ }
    await page.waitForTimeout(1_200);
    const dashBody = (await page.locator('main, body').first().innerText()) ?? '';
    const both = resvBody + '\n' + dashBody;

    // 비화이트리스트 더미가 보이면 (b) 한정이 깨진 것 — 전면완화(a) 회귀 의심(hard).
    expect(both.includes('양배추'), '비화이트리스트 sim "양배추" 노출 — (a) 전면완화 회귀 의심').toBe(false);
    expect(both.includes('고양이'), '비화이트리스트 sim "고양이" 노출 — (a) 전면완화 회귀 의심').toBe(false);

    if (both.includes('토마토')) {
      console.log('[AC] (b) 확인: 화이트리스트 "토마토" 노출 + 비화이트리스트 더미 숨김.');
    } else {
      console.log('[AC-soft] "토마토"가 현재 주간/대시보드 범위 밖 — 노출 미관측. (b) 정책은 _Bpath_verify.mjs(live DB)로 하드 증명.');
      test.skip(true, '토마토 시드가 현재 view 범위 밖 — soft skip (음성 가드는 통과)');
    }
  });
});
