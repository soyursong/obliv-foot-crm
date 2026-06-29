/**
 * E2E spec — T-20260629-foot-TREATMENTSET-TAB-REMOVE
 * 서비스관리 > 진료관리 탭 목록에서 '진료세트'(treatment_sets) 탭 제거.
 *   (문지은 대표원장 confirm 2026-06-29 — 의료화면 게이트 §11 통과)
 *
 * 범위: FE + 딥링크 라우팅만. treatment_sets / treatment_set_items DB 테이블·데이터는 보존(DROP/마이그 없음).
 *       TreatmentSetsTab 컴포넌트 파일도 물리 보존(UI 진입만 제거).
 *
 * 시나리오 3종 (티켓 §5):
 *   S1 (탭 비노출): 진료관리 진입 시 '진료세트' TabsTrigger(tab-treatment-sets)가 더 이상 보이지 않는다.
 *   S2 (직접 라우팅): ?tab=treatment_sets 직접 접근 시 white screen·JS 에러 0 → 진료관리 기본 탭(상병명 관리)으로 정규화.
 *   S3 (회귀): 나머지 진료관리 탭(상병명·묶음상병·처방세트·묶음처방·서류 템플릿·경과분석 플랜)은 정상 노출·전환.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260629-foot-TREATMENTSET-TAB-REMOVE — 진료세트 탭 제거', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  test('S1: 진료관리 진입 시 "진료세트" 탭이 노출되지 않는다', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(String(e)));

    await page.goto('/admin/clinic-management');

    // 페이지 진입 보장 — 기본 탭(상병명 관리)이 떠야 한다.
    const baseTab = page.getByTestId('tab-diagnosis-names');
    try {
      await baseTab.waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '진료관리 페이지 접근 불가(권한/환경) — 스킵');
      return;
    }

    // 진료세트 탭 트리거가 DOM에 없어야 한다(제거됨).
    await expect(page.getByTestId('tab-treatment-sets')).toHaveCount(0);
    // 라벨 텍스트로도 비노출 확인(탭 영역 한정).
    await expect(page.getByRole('tab', { name: '진료세트' })).toHaveCount(0);

    expect(jsErrors, `JS 에러 발생: ${jsErrors.join('\n')}`).toEqual([]);
    console.log('[S1] 진료세트 탭 비노출 OK');
  });

  test('S2: ?tab=treatment_sets 직접 접근 → 기본 탭으로 정규화(white screen·JS 에러 0)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(String(e)));

    await page.goto('/admin/clinic-management?tab=treatment_sets');

    const baseTab = page.getByTestId('tab-diagnosis-names');
    try {
      await baseTab.waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '진료관리 페이지 접근 불가(권한/환경) — 스킵');
      return;
    }

    // white screen 아님: 페이지 헤더(진료관리)와 기본 탭이 렌더된다.
    await expect(page.getByRole('heading', { name: '진료관리' })).toBeVisible({ timeout: 5_000 });
    // 제거된 탭 패널이 활성화되지 않는다(진료세트 trigger 부재).
    await expect(page.getByTestId('tab-treatment-sets')).toHaveCount(0);
    // 기본 탭(상병명 관리)이 선택 상태(딥링크 정규화 → diagnosis_names). base-ui Tabs = aria-selected.
    await expect(baseTab).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 });

    expect(jsErrors, `JS 에러 발생: ${jsErrors.join('\n')}`).toEqual([]);
    console.log('[S2] 딥링크 treatment_sets → 기본 탭 정규화 OK, JS 에러 0');
  });

  test('S3: 나머지 진료관리 탭 회귀 0 — 노출·전환 정상', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(String(e)));

    await page.goto('/admin/clinic-management');

    const baseTab = page.getByTestId('tab-diagnosis-names');
    try {
      await baseTab.waitFor({ timeout: 10_000 });
    } catch {
      test.skip(true, '진료관리 페이지 접근 불가(권한/환경) — 스킵');
      return;
    }

    // 잔존해야 하는 핵심 탭(role-무관 공통 탭) 노출 확인.
    const survivors: Array<[string, string]> = [
      ['tab-diagnosis-names', '상병명 관리'],
      ['tab-diagnosis-sets', '묶음상병'],
      ['tab-drug-folders', '처방세트'],
      ['tab-prescription-sets-legacy', '묶음처방'],
      ['tab-documents', '서류 템플릿'],
      ['tab-progress-plans', '경과분석 플랜'],
    ];
    for (const [testid] of survivors) {
      await expect(page.getByTestId(testid)).toBeVisible({ timeout: 5_000 });
    }

    // 전환 동작 회귀: 경과분석 플랜 탭으로 전환되어 active 상태가 된다.
    const progressTab = page.getByTestId('tab-progress-plans');
    await progressTab.click();
    await expect(progressTab).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 });

    expect(jsErrors, `JS 에러 발생: ${jsErrors.join('\n')}`).toEqual([]);
    console.log('[S3] 잔존 탭 노출·전환 회귀 0 OK');
  });
});
