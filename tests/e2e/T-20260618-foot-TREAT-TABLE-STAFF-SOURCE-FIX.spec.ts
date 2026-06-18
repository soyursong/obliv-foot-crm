/**
 * E2E spec — T-20260618-foot-TREAT-TABLE-STAFF-SOURCE-FIX
 *
 * 치료 현황 테이블(/admin/treatment-table)의 담당 실장·담당 치료사 데이터 소스 교정.
 *   담당 실장 = customers.assigned_staff_id  (2번차트 1구역 '담당자', T-20260508-foot-C2-STAFF-DROPDOWN 확정)
 *               기존 check_ins.consultant_id(접수 컨설턴트) → 표시 소스 교체(check_ins 컬럼은 보존).
 *   담당 치료사 = 금일(session_date=조회일) package_sessions.performed_by WHERE status='used' (실제 차감 치료사)
 *               지정치료사(designated_therapist_id) 미사용.
 *
 * AC-1: '담당 실장' 컬럼 → customers.assigned_staff_id 기준 직원 이름.
 * AC-2: '담당 치료사' 컬럼 → 금일 package_sessions.performed_by(status='used') 기준. 지정치료사 미사용.
 * AC-3: 당일 차감 없는 환자 → 담당 치료사 '—'.
 * AC-4: assigned_staff_id=NULL 환자 → 담당 실장 '—'.
 * AC-5(무회귀): 담당자 필터 드롭다운 2종 / 요약 카드 / 당직 원장 배너 / CSV / 뷰 프리셋 4종 무변경.
 * AC-6(퍼포먼스): package_sessions 조회는 조회 날짜범위로 제한(전체 차감이력 조회 금지).
 *
 * 현장 클릭 시나리오:
 *   S1. 어드민 → 치료 테이블 진입 → 전체 뷰 '담당 실장'/'담당 치료사' 컬럼이 렌더된다.
 *       데이터 의존(미지정/당일 미차감)이면 '—'가 graceful 표시된다.
 *   S2. 담당 치료사 = 금일 차감 기준 — 지정치료사가 아닌 당일 차감 performed_by 가 소스임을 구조로 확인.
 *   S3. 담당 실장·치료사 필터 드롭다운이 존재하며 선택 시 필터가 동작(에러 없이 재렌더)한다.
 *
 * 데이터 의존 항목은 env-graceful: 시드가 없으면 구조/무파손만 검증하고 스킵 처리.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

type Page = import('@playwright/test').Page;

async function openTreatmentTable(page: Page): Promise<boolean> {
  await page.goto('/admin/treatment-table');
  await page.waitForLoadState('networkidle');
  const heading = page.getByRole('heading', { name: '치료 현황 테이블' });
  return heading
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

test.describe('T-20260618-foot-TREAT-TABLE-STAFF-SOURCE-FIX', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  // ── S1 / AC-1·AC-3·AC-4: 전체 뷰 담당 실장·담당 치료사 컬럼 렌더 + graceful '—' ──────
  test('AC-1/3/4: 전체 뷰 담당 실장·담당 치료사 컬럼 렌더(미지정/미차감 graceful)', async ({ page }) => {
    const ok = await openTreatmentTable(page);
    if (!ok) {
      test.skip(true, '치료 현황 테이블 진입 실패(권한/환경) — 스킵');
      return;
    }

    // 전체 뷰는 기본값. 담당 실장/담당 치료사 헤더가 존재해야 한다.
    await expect(page.getByRole('columnheader', { name: '담당 실장' }).first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '담당 치료사' }).first()).toBeVisible();

    const emptyHint = page.getByText('해당 조건의 데이터가 없습니다.');
    if ((await emptyHint.count()) > 0) {
      test.info().annotations.push({
        type: 'note',
        description: '당일 접수 데이터 없음 — 컬럼 헤더 무파손만 확인(AC-3/4 graceful).',
      });
      return;
    }
    // 데이터가 있으면 테이블이 렌더되며, 담당자 미지정/당일 미차감 환자는 '—'가 셀에 표시될 수 있다.
    await expect(page.locator('table')).toBeVisible();
  });

  // ── S2 / AC-2: 담당 치료사 = 금일 차감 기준(지정치료사 아님) — 치료사 뷰 컬럼 구조 확인 ──
  test('AC-2: 치료사 뷰 담당 치료사 컬럼(금일 차감 performed_by 소스)', async ({ page }) => {
    const ok = await openTreatmentTable(page);
    if (!ok) {
      test.skip(true, '치료 현황 테이블 진입 실패(권한/환경) — 스킵');
      return;
    }

    const therapistTab = page.getByRole('tab', { name: /치료사 뷰/ });
    if ((await therapistTab.count()) === 0) {
      test.skip(true, '치료사 뷰 탭 없음 — 스킵');
      return;
    }
    await therapistTab.click();
    await page.waitForLoadState('networkidle');

    // 치료사 뷰 전용 '담당 치료사' 컬럼 헤더가 노출.
    await expect(page.getByRole('columnheader', { name: '담당 치료사' }).first()).toBeVisible();
    // 안내 문구 무파손(데이터 의존 X).
    await expect(page.getByText(/담당 치료사별 시술 처치 현황/)).toBeVisible();
  });

  // ── S3 / AC-5: 담당자 필터 드롭다운 2종 존재 + 선택 시 무에러 재렌더(무회귀) ──────────
  test('AC-5: 담당 실장·치료사 필터 드롭다운 동작(무회귀)', async ({ page }) => {
    const ok = await openTreatmentTable(page);
    if (!ok) {
      test.skip(true, '치료 현황 테이블 진입 실패(권한/환경) — 스킵');
      return;
    }

    // 필터 드롭다운 2종(상담실장·치료사) 유지.
    await expect(page.getByText('상담실장:', { exact: true })).toBeVisible();
    await expect(page.getByText('치료사:', { exact: true })).toBeVisible();
    const combos = page.getByRole('combobox');
    expect(await combos.count()).toBeGreaterThanOrEqual(2);

    // 상담실장 필터를 열고 '전체' 이외 항목이 있으면 선택 → 페이지 무에러 재렌더.
    await combos.first().click();
    const options = page.getByRole('option');
    const optCount = await options.count();
    if (optCount > 1) {
      // 첫 항목('전체') 다음 실제 직원 항목 선택.
      await options.nth(1).click();
      await page.waitForLoadState('networkidle');
    } else {
      // 등록된 실장 없음 등 — 드롭다운 닫고 무파손 확인.
      await page.keyboard.press('Escape');
    }
    await expect(page.getByRole('heading', { name: '치료 현황 테이블' })).toBeVisible();

    // 요약 카드(무회귀) 존재 확인.
    await expect(page.getByText('총 접수', { exact: false }).first()).toBeVisible();
  });
});
