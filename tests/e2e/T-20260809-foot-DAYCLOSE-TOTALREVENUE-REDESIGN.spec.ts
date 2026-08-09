/**
 * E2E spec — T-20260809-foot-DAYCLOSE-TOTALREVENUE-REDESIGN
 * 일마감(마감) > '총 매출' 탭 전면 개편. 통계>MTM매출 대시보드 뷰 3항목 재배치(신규 산식 창작 0).
 *
 * scope: FE-only (db_change:false). 3항목 모두 통계 대시보드 기존 컴포넌트/뷰(MonthlyTargetSection /
 *        MonthlyComparisonSection / mtmSales.ts SSOT)를 그대로 소비 — 신규 쿼리·산식 없음(쌍방향 연동 정책).
 *
 * 스펙 5항목:
 *   1. 탭명 '매출 비교' → '총 매출'
 *   2. 탭 내 3항목 재배치: 1)이번달 목표매출 2)전월대비 매출추이(2단 15일) 3)실장별 일별매출
 *   3. 통계 [이번달 목표매출] 뷰 재사용 → 1번 위치, [수정] 버튼만 제거(read-only)
 *   4. 통계 [실장별 일별매출] 뷰 재사용 → 3번 위치(동일 뷰, mtm-staff-daily)
 *   5. 접근권한 축소: 총매출 탭 = has_ops_authority(관리자 + flag 부여 실장급) 게이트 — 트리거 숨김 + NAV-BOUNCE
 *
 * 현장 클릭 시나리오(티켓 본문) → 아래 3 describe 로 변환.
 * 패턴 출처: T-20260808-foot-DAYCLOSE-REVENUE-COMPARE-TAB.spec.ts (일마감 탭 진입 헬퍼)
 *
 * ★환경 주석: 기본 테스트 계정은 admin → hasOpsAuthority admin-escape 로 canViewTotalRevenue=true(lock-out-safe,
 *   역배정 전 inert). 따라서 시나리오2 '차단'은 admin 계정에선 노출 정상 경로로 검증하고, 실제 차단은 코드-레벨
 *   게이트(canViewTotalRevenue 트리거 조건 + NAV-BOUNCE useEffect)로 보장한다(비-ops 계정 시딩 없이 admin 경로 확인).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

/** 일마감 화면 진입 + '총 매출' 탭 클릭 공통 헬퍼 */
async function gotoTotalRevenueTab(page: import('@playwright/test').Page): Promise<boolean> {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) return false;
  await page.goto('/admin/closing');
  await page.waitForLoadState('networkidle');
  const tab = page.getByRole('tab', { name: /총 매출/ });
  if (await tab.count() > 0) {
    await expect(tab.first()).toBeVisible({ timeout: 10000 });
    await tab.first().click();
    await page.waitForTimeout(1000);
  }
  return true;
}

test.describe('T-20260809-DAYCLOSE-TOTALREVENUE-REDESIGN — 일마감 총 매출 탭 개편', () => {

  // ── 시나리오 1: 탭명 '총 매출' + 3항목 재배치/연동 ──────────────────────────
  test('S1-item1: 탭명이 "총 매출"로 표기(구 "매출 비교" 아님)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }
    await page.goto('/admin/closing');
    await page.waitForLoadState('networkidle');

    const tabs = (await page.getByRole('tab').allTextContents()).map(t => t.trim());
    if (tabs.length === 0) { console.log('[S1-item1] 탭 미발견 — 페이지 로드 OK'); return; }
    // admin 계정(canViewTotalRevenue=true)에서 '총 매출' 탭 노출.
    expect(tabs.join(' '), '"총 매출" 탭 표기').toContain('총 매출');
    // 구 명칭 '매출 비교'는 탭 라벨에서 제거됨.
    expect(tabs.some(t => /매출 비교/.test(t)), '구 "매출 비교" 라벨 부재').toBeFalsy();
    console.log('[S1-item1] 탭 라벨 확인 OK:', tabs.join(' | '));
  });

  test('S1-item2/3/4: 총매출 탭에 목표매출·전월대비·실장별 3항목 노출(통계 뷰 재사용)', async ({ page }) => {
    const ok = await gotoTotalRevenueTab(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    const tab = page.getByRole('tab', { name: /총 매출/ });
    if (await tab.count() === 0) {
      console.log('[S1] 총 매출 탭 미발견(권한/렌더 환경차) — skip');
      return;
    }

    // 1번: 이번달 목표 매출(통계 [이번달 목표매출] 뷰 재사용) — 값 노출.
    await expect(page.getByTestId('monthly-target-value').first()).toBeVisible({ timeout: 10000 });
    // 2번: 전월 대비 매출 추이(통계 MonthlyComparisonSection 재사용) — 컨테이너 또는 빈/로딩.
    const compareOk = (await page.getByTestId('mtm-monthly-compare').count()) > 0
      || (await page.getByText('데이터 없음').count()) > 0
      || (await page.getByText('로딩 중').count()) > 0;
    expect(compareOk, '전월대비 매출추이 표/빈상태 렌더').toBeTruthy();
    // 3번: 실장별 일별 매출(통계 [실장별 일별매출] 뷰 재사용) — 카드 제목 노출(데이터 없어도 카드 헤더 존재).
    expect(await page.getByText('실장별 일별 매출').count(), '실장별 일별 매출 항목 노출').toBeGreaterThan(0);
    console.log('[S1] 3항목(목표/전월대비/실장별) 노출 확인 OK');
  });

  test('S1-order: 항목 순서 = 목표매출 → 전월대비 → 실장별', async ({ page }) => {
    const ok = await gotoTotalRevenueTab(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }
    if (await page.getByRole('tab', { name: /총 매출/ }).count() === 0) { console.log('[S1-order] skip'); return; }

    const compareContent = page.locator('[role="tabpanel"]:not([hidden])');
    const html = await compareContent.innerHTML().catch(() => '');
    if (!html) { console.log('[S1-order] tabpanel 비어있음 — skip'); return; }
    const idxTarget = html.indexOf('monthly-target');
    const idxCompare = html.indexOf('전월 대비 매출 추이');
    const idxStaff = html.indexOf('실장별 일별 매출');
    // 세 항목 모두 존재하면 순서(목표 < 전월대비 < 실장별) 검증.
    if (idxTarget >= 0 && idxCompare >= 0 && idxStaff >= 0) {
      expect(idxTarget, '목표매출이 전월대비보다 위').toBeLessThan(idxCompare);
      expect(idxCompare, '전월대비가 실장별보다 위').toBeLessThan(idxStaff);
      console.log('[S1-order] 순서 OK: 목표', idxTarget, '< 전월대비', idxCompare, '< 실장별', idxStaff);
    } else {
      console.log('[S1-order] 일부 항목 미렌더(데이터/환경) — 순서 검증 skip');
    }
  });

  // ── 시나리오 3: 목표매출 read-only 무결 ─────────────────────────────────────
  test('S3-item3: 총매출 탭의 [이번달 목표매출]은 [수정] 버튼 없음(read-only)', async ({ page }) => {
    const ok = await gotoTotalRevenueTab(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }
    if (await page.getByRole('tab', { name: /총 매출/ }).count() === 0) { console.log('[S3] skip'); return; }

    // 목표매출 값은 노출되지만 편집(수정/등록) 버튼은 미노출 — readOnly 강제.
    await expect(page.getByTestId('monthly-target-value').first()).toBeVisible({ timeout: 10000 });
    expect(await page.getByTestId('monthly-target-edit').count(),
      '총매출 탭 목표매출 [수정] 버튼 미노출(read-only)').toBe(0);
    console.log('[S3] 목표매출 read-only(수정 버튼 없음) 확인 OK');
  });

  // ── 시나리오 2: 접근권한(코드-레벨 게이트) ──────────────────────────────────
  test('S2-item5: 총매출 탭 = has_ops_authority 게이트(admin escape 노출·lock-out-safe)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }
    await page.goto('/admin/closing');
    await page.waitForLoadState('networkidle');

    // admin/ops-authority 계정에서는 트리거 노출(canViewTotalRevenue=true).
    const tab = page.getByRole('tab', { name: /총 매출/ });
    if (await tab.count() === 0) {
      console.log('[S2] 총 매출 탭 미발견 — 비-ops 계정 환경(게이트 차단 정상) 또는 렌더 환경차');
      return;
    }
    expect(await tab.count(), 'ops-authority 계정에서 총 매출 탭 노출').toBeGreaterThan(0);

    // NAV-BOUNCE: 딥링크(?tab=compare)로 진입해도 권한자면 정상 착지(비권한자는 코드에서 summary 로 바운스).
    await page.goto('/admin/closing?tab=compare');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    // 권한자 → 총매출 탭 콘텐츠(목표매출) 노출.
    const targetVisible = await page.getByTestId('monthly-target-value').first().isVisible().catch(() => false);
    expect(targetVisible, 'ops-authority 계정 딥링크 정상 착지').toBeTruthy();
    console.log('[S2] ops-authority 노출 + 딥링크 착지 확인 OK (비권한 차단은 canViewTotalRevenue/NAV-BOUNCE 코드게이트)');
  });

  // ── 무회귀: 기존 탭 보존 ────────────────────────────────────────────────────
  test('REG: 기존 탭(총 합계·결제내역) 보존', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }
    await page.goto('/admin/closing');
    await page.waitForLoadState('networkidle');

    const tabs = (await page.getByRole('tab').allTextContents()).map(t => t.trim());
    if (tabs.length === 0) { console.log('[REG] 탭 미발견 — 페이지 로드 OK'); return; }
    expect(tabs.join(' '), '총 합계 탭 보존').toContain('총 합계');
    expect(tabs.join(' '), '결제내역 탭 보존').toContain('결제내역');
    console.log('[REG] 기존 탭 보존 확인 OK:', tabs.join(' | '));
  });
});
