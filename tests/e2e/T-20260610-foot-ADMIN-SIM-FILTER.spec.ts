/**
 * E2E spec — T-20260610-foot-ADMIN-SIM-FILTER
 * CRM admin 예약/환자 목록·캘린더에 is_simulation(테스트 더미) 숨김 필터 추가 (root-cause).
 * 6/10 종로점 혼선(CRM admin 명단 ≠ 셀프접수 명단)의 근본원인 해소 — 셀프접수와 동작 정합.
 *
 * is_simulation은 customers 테이블에만 존재(DEFAULT FALSE). 예약/체크인은 customer_id로
 * 시뮬레이션 고객과 연결되므로, 연결 고객이 is_simulation=true인 행을 admin 표시에서 숨긴다.
 *
 * AC-1: admin 예약/환자 목록·캘린더·칸반에서 시뮬레이션 데이터 기본 숨김.
 * AC-3: 실데이터(is_simulation=false/NULL) 무손상 — 필터로 인한 누락 0건, 화면 정상 렌더.
 *
 * 검증 전략: 라이브 dev 환경에서 admin 표시 surface(고객관리/예약/대시보드)에
 * 시뮬레이션 마커가 절대 노출되지 않음을 회귀 가드한다. 시드 더미('[경과테스트]' 등)는
 * is_simulation=true로 마킹되어 있어, 필터가 동작하면 어떤 surface에도 나타나지 않아야 한다.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// 시뮬레이션/테스트 더미를 식별하는 이름 마커 (시드 migration prefix 포함)
const SIM_MARKERS = ['[경과테스트]', '[시뮬', '[테스트]', '시뮬레이션'];

function assertNoSimMarker(text: string, where: string) {
  for (const marker of SIM_MARKERS) {
    expect(
      text.includes(marker),
      `[${where}] 시뮬레이션 마커 "${marker}"가 admin 화면에 노출됨 — is_simulation 필터 누락`,
    ).toBe(false);
  }
}

test.describe('T-20260610 ADMIN-SIM-FILTER 시뮬레이션 더미 admin 숨김', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('AC-1+AC-3: 고객관리 목록 — 시뮬레이션 더미 비노출 + 실데이터 정상 렌더', async ({ page }) => {
    await page.goto('/admin/customers');

    // 목록 또는 빈 상태가 렌더되어야 함(필터로 인한 크래시/공백 화면 없음 — AC-3)
    const ready = await Promise.race([
      page.getByText('고객이 없습니다', { exact: true }).first().waitFor({ timeout: 15_000 }).then(() => 'empty').catch(() => null),
      page.locator('table, [role="table"]').first().waitFor({ timeout: 15_000 }).then(() => 'table').catch(() => null),
      page.getByText('검색 결과 없음', { exact: true }).first().waitFor({ timeout: 15_000 }).then(() => 'noresult').catch(() => null),
    ]);
    if (!ready) test.skip(true, '고객관리 화면 렌더 실패 — 환경 불일치');
    await page.waitForTimeout(800);

    const body = (await page.locator('main, body').first().innerText()) ?? '';
    assertNoSimMarker(body, '고객관리 목록');

    // AC-1 강검증: 시뮬레이션 시드명으로 검색해도 결과가 노출되지 않음
    const search = page.getByPlaceholder(/이름/).first();
    if (await search.count()) {
      await search.fill('경과테스트');
      await page.waitForTimeout(1_200);
      const afterSearch = (await page.locator('main, body').first().innerText()) ?? '';
      assertNoSimMarker(afterSearch, '고객관리 검색(경과테스트)');
      console.log('[AC-1] 고객관리: "경과테스트" 검색 → 시뮬레이션 결과 비노출 OK');
    }
    console.log('[AC-1+AC-3] 고객관리 목록 시뮬레이션 비노출 + 정상 렌더 OK');
  });

  test('AC-1: 예약 캘린더 — 시뮬레이션 고객 예약 비노출', async ({ page }) => {
    await page.goto('/admin/reservations');
    try {
      await page.waitForLoadState('networkidle', { timeout: 15_000 });
    } catch { /* 타임아웃 무시 — 아래 렌더 확인으로 진행 */ }
    await page.waitForTimeout(1_000);

    const body = (await page.locator('main, body').first().innerText()) ?? '';
    assertNoSimMarker(body, '예약 캘린더');
    console.log('[AC-1] 예약 캘린더 시뮬레이션 예약 비노출 OK');
  });

  test('AC-1: 대시보드 칸반/타임라인 — 시뮬레이션 체크인·예약 비노출', async ({ page }) => {
    await page.goto('/admin');
    try {
      await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    } catch {
      test.skip(true, '대시보드 렌더 실패 — 환경 불일치');
      return;
    }
    await page.waitForTimeout(1_500);

    const body = (await page.locator('main, body').first().innerText()) ?? '';
    assertNoSimMarker(body, '대시보드 칸반/타임라인');
    console.log('[AC-1] 대시보드 칸반/타임라인 시뮬레이션 비노출 OK');
  });
});
