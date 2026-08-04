/**
 * E2E spec — T-20260804-foot-DAYCLOSE-PAYTAB-LAYOUT-SUSUPOPUP
 * 일마감 > 결제내역 탭 항목구성·레이아웃 변경 3건
 *
 * ── 이 커밋(1차)에서 구현된 범위 ─────────────────────────────────────────────
 * AC-2 [구현]: 결제내역(CRM 수납) 테이블 레이아웃을 '환자별'(SalesPatientTab, 매출집계>환자별) 탭 기준으로 통일.
 *   폰트(text-xs=12px) + 헤더(sticky bg-muted/70 z-10, th py-1.5 px-2 font-medium text-muted-foreground) + 행간격(td py-1.5) + 정렬.
 *   1차 기준(source of truth) = 라이브 '환자별' 탭 실화면 계측.
 *
 * ── FOLLOWUP 확정 대기 중(본 커밋 미포함, planner 회신 후 후속) ───────────────
 * AC-1 [보류]: 컬럼 순서 재배치 — 현장 지정 11개 목록에 [시술명](현 결제내역 탭 미존재=신규) 포함 +
 *   현 [날짜]/[과세]/[비과세] 미포함(삭제?) → '누락 컬럼' 확인 FOLLOWUP 발행. 컬럼셋 확정 후 구현.
 * AC-3 [보류]: [시술명] 셀 클릭 → 수납상세 팝업. 데이터모델 선판정 결과 = 표시전용/기존필드 매핑(스키마 무접촉,
 *   상병명=claim_diagnoses.disease_name / 구분=check_in_services.services.category 기존 존재) → DA CONSULT 불요.
 *   단, 기존 팝업(PatientDetailModal)이 이미 '구분(category)' 표시 중 → '기입란 추가'와 중복 여부 현장 재확인 FOLLOWUP.
 *
 * 패턴 출처: T-20260530-foot-CLOSING-PAYMETHOD-FILTER.spec.ts (결제내역 탭 진입 패턴 재사용)
 * 레이아웃 기준: src/components/sales/SalesPatientTab.tsx (th py-1.5 px-2 / table text-xs)
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

/** 결제내역(CRM 수납) 탭으로 진입. 진입 성공 시 payments table locator 반환, 실패/미존재 시 null. */
async function gotoPaymentsTable(page: Page) {
  await page.goto('/admin/closing');
  await page.waitForLoadState('networkidle');
  const paymentsTab = page.getByRole('tab', { name: /결제내역/ });
  if (await paymentsTab.count() === 0) return null;
  await paymentsTab.click();
  await page.waitForTimeout(500);
  // CRM 수납 하위탭 (기본 활성이지만 명시 클릭으로 안정화)
  const crmSubTab = page.getByRole('tab', { name: /^CRM 수납$/ });
  if (await crmSubTab.count() > 0) {
    await crmSubTab.click();
    await page.waitForTimeout(300);
  }
  // 결제내역 테이블 헤더('결제금액' th가 있는 table)
  const header = page.locator('table thead th', { hasText: '결제금액' }).first();
  if (await header.count() === 0) return null;
  return header;
}

/** computed style 숫자(px) 추출 */
async function pxOf(locator: ReturnType<Page['locator']>, prop: string): Promise<number> {
  return locator.evaluate((el, p) => parseFloat(getComputedStyle(el as Element).getPropertyValue(p)) || 0, prop);
}

test.describe('T-20260804-DAYCLOSE-PAYTAB-LAYOUT-SUSUPOPUP — 일마감 결제내역 레이아웃 통일(AC-2)', () => {

  // ── AC-2-a: 결제내역 헤더가 '환자별' 기준(text-xs=12px, py-1.5=6px)으로 렌더 ─────────
  test('AC-2-a: 결제내역 테이블 헤더 폰트 12px(text-xs) + 헤더 상하 패딩 6px(py-1.5)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패(CI 자격증명 없음)'); return; }

    const header = await gotoPaymentsTable(page);
    if (!header) { test.skip(true, '결제내역 테이블 미노출(RBAC/데이터 없음)'); return; }

    await expect(header).toBeVisible({ timeout: 10000 });
    const fontSize = await pxOf(header, 'font-size');
    const padTop = await pxOf(header, 'padding-top');
    // text-xs = 0.75rem = 12px, py-1.5 = 0.375rem = 6px (기본 16px root 기준)
    expect(fontSize, '헤더 폰트=12px(text-xs, 환자별 탭 기준)').toBeCloseTo(12, 0);
    expect(padTop, '헤더 상단 패딩=6px(py-1.5, 환자별 탭 기준 행간격)').toBeCloseTo(6, 0);
  });

  // ── AC-2-b: '환자별' 탭과 결제내역 탭 헤더 폰트 사이즈 동일(레이아웃 통일 파리티) ──────
  test('AC-2-b: 결제내역 헤더 폰트 == 환자별(SalesPatientTab) 헤더 폰트 (통일 확인)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패(CI 자격증명 없음)'); return; }

    // 결제내역 헤더 폰트
    const closingHeader = await gotoPaymentsTable(page);
    if (!closingHeader) { test.skip(true, '결제내역 테이블 미노출(RBAC/데이터 없음)'); return; }
    await expect(closingHeader).toBeVisible({ timeout: 10000 });
    const closingFont = await pxOf(closingHeader, 'font-size');

    // 환자별(매출집계) 헤더 폰트 — admin/manager/director 전용(권한 없으면 skip)
    await page.goto('/admin/sales');
    await page.waitForLoadState('networkidle');
    const patientTab = page.getByRole('tab', { name: /환자별/ });
    if (await patientTab.count() === 0) { test.skip(true, '매출집계>환자별 미노출(RBAC)'); return; }
    await patientTab.click();
    await page.waitForTimeout(500);
    const patientHeader = page.locator('[data-testid="sales-patient-grid"] thead th').first();
    if (await patientHeader.count() === 0) { test.skip(true, '환자별 그리드 미노출(데이터 없음)'); return; }
    const patientFont = await pxOf(patientHeader, 'font-size');

    expect(closingFont, '결제내역 헤더 폰트 == 환자별 헤더 폰트(레이아웃 통일)').toBeCloseTo(patientFont, 0);
  });

  // ── AC-1: 컬럼 순서 재배치 — FOLLOWUP 컬럼셋 확정 후 구현 예정 ──────────────────
  test('AC-1: 결제내역 컬럼 순서 재배치 [시간][성함|차트][진료구분][내원경로][시술명][담당자]...', async () => {
    test.skip(true, 'FOLLOWUP 대기: 시술명(신규 컬럼) 추가 여부 + 날짜/과세/비과세 삭제 여부 현장 확정 후 구현');
  });

  // ── AC-3: [시술명] 셀 클릭 → 수납상세 팝업 — FOLLOWUP 중복확인 후 구현 예정 ─────────
  test('AC-3: [시술명] 셀 클릭 → 수납상세 팝업(기존+상병명+구분)', async () => {
    test.skip(true, 'FOLLOWUP 대기: 선판정=표시전용(스키마 무접촉). 기존 팝업 구분(category) 표시와 기입란 중복 여부 현장 재확인 후 구현');
  });
});
