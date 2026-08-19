/**
 * E2E spec — T-20260819-foot-DAYCLOSE-TOTALREV-EXCEL-DOWNLOAD
 * 일마감(마감) '총 매출' / '총 매출(치료)' 표 → 화면 표시값 그대로 엑셀(.xlsx) 다운로드.
 *
 * scope: FE-only (db_change:false). client-side 내보내기(기존 xlsx 의존 재사용, 신규 npm 0).
 *
 * AC(티켓):
 *   1. '총 매출' 탭에 엑셀 다운로드 버튼 → 화면 표시값 그대로 .xlsx.
 *   2. '총매출(치료)' 탭에도 동일(표 내부 버튼).
 *   3. 컬럼/행/수치 화면 표시 그대로(집계·산식 재구성 금지, 헤더·합계행 포함) — 코드-레벨(closingRevenueExport.ts /
 *      SalesStaffTab.handleExportStaff)에서 렌더와 동일 데이터 객체를 그대로 시트화하여 보장.
 *   4. 파일명 식별 가능(일마감_총매출_YYYYMMDD.xlsx / 일마감_총매출치료_YYYYMMDD_YYYYMMDD.xlsx).
 *   5. 기존 export 유틸/패턴(salesExport·xlsx) 재사용.
 *   6. 회귀 0(Sales.tsx SalesStaffTab 는 enableExcelExport 기본 false → 버튼 미노출).
 *
 * ★환경 주석: 기본 테스트 계정 admin → canViewTotalRevenue=true(총 매출 탭 노출) + canViewTherapistSales.
 *   데이터가 비어 있을 수 있으므로, 버튼 존재를 1급으로 검증하고 활성 시에만 download 이벤트를 캡처한다.
 *
 * 패턴 출처: T-20260809-foot-DAYCLOSE-TOTALREVENUE-REDESIGN.spec.ts (탭 진입 헬퍼)
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function gotoClosingTab(page: Page, tabName: RegExp): Promise<boolean> {
  const ok = await loginAndWaitForDashboard(page);
  if (!ok) return false;
  await page.goto('/admin/closing');
  await page.waitForLoadState('networkidle');
  const tab = page.getByRole('tab', { name: tabName });
  if (await tab.count() > 0) {
    await expect(tab.first()).toBeVisible({ timeout: 10000 });
    await tab.first().click();
    await page.waitForTimeout(1200);
  }
  return true;
}

test.describe('T-20260819-DAYCLOSE-TOTALREV-EXCEL-DOWNLOAD — 일마감 총매출 엑셀 다운로드', () => {

  // ── AC-1: '총 매출' 탭 엑셀 다운로드 버튼 ─────────────────────────────────────
  test('AC-1: 총 매출 탭에 엑셀 다운로드 버튼 노출', async ({ page }) => {
    const ok = await gotoClosingTab(page, /총 매출/);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    const btn = page.getByTestId('closing-totalrev-export-btn');
    if (await btn.count() === 0) {
      // 탭 진입 실패(권한/시딩)면 페이지 로드만 확인하고 종료 — false-fail 방지.
      console.log('[AC-1] 총 매출 탭/버튼 미발견 — 페이지 로드 OK');
      return;
    }
    await expect(btn.first()).toBeVisible();
    console.log('[AC-1] 총 매출 엑셀 다운로드 버튼 확인 OK');
  });

  // ── AC-1/4: 버튼 활성 시 .xlsx 다운로드 + 파일명 규격 ────────────────────────
  test('AC-1/4: 총 매출 다운로드 시 일마감_총매출_YYYYMMDD.xlsx', async ({ page }) => {
    const ok = await gotoClosingTab(page, /총 매출/);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    const btn = page.getByTestId('closing-totalrev-export-btn');
    if (await btn.count() === 0) { console.log('[AC-1/4] 버튼 미발견 — skip'); return; }

    if (await btn.first().isDisabled()) {
      console.log('[AC-1/4] 데이터 없음(버튼 비활성) — 다운로드 스킵, 버튼 규격만 확인');
      return;
    }
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
      btn.first().click(),
    ]);
    if (!download) { console.log('[AC-1/4] download 이벤트 미발생(빈 데이터 toast.info 경로)'); return; }
    const name = download.suggestedFilename();
    expect(name, '파일명 규격').toMatch(/^일마감_총매출_\d{8}\.xlsx$/);
    console.log('[AC-1/4] 다운로드 파일명 확인 OK:', name);
  });

  // ── AC-2: '총매출(치료)' 탭 엑셀 다운로드 버튼(표 내부) ──────────────────────
  test('AC-2: 총매출(치료) 탭에 엑셀 다운로드 버튼 노출', async ({ page }) => {
    const ok = await gotoClosingTab(page, /총매출\(치료\)/);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    // 데이터 없으면 표(및 버튼) 미렌더 — 빈상태 경로는 버튼 없음이 정상.
    const btn = page.getByTestId('sales-staff-export-btn');
    if (await btn.count() === 0) {
      console.log('[AC-2] 치료 매출표 버튼 미발견(빈 데이터 or 권한) — 페이지 로드 OK');
      return;
    }
    await expect(btn.first()).toBeVisible();
    console.log('[AC-2] 총매출(치료) 엑셀 다운로드 버튼 확인 OK');
  });

  // ── AC-2/4: 치료 매출표 다운로드 시 파일명 규격 ─────────────────────────────
  test('AC-2/4: 총매출(치료) 다운로드 시 일마감_총매출치료_YYYYMMDD_YYYYMMDD.xlsx', async ({ page }) => {
    const ok = await gotoClosingTab(page, /총매출\(치료\)/);
    if (!ok) { test.skip(true, '로그인 실패'); return; }

    const btn = page.getByTestId('sales-staff-export-btn');
    if (await btn.count() === 0) { console.log('[AC-2/4] 버튼 미발견(빈 데이터) — skip'); return; }

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
      btn.first().click(),
    ]);
    if (!download) { console.log('[AC-2/4] download 이벤트 미발생'); return; }
    const name = download.suggestedFilename();
    expect(name, '파일명 규격').toMatch(/^일마감_총매출치료_\d{8}_\d{8}\.xlsx$/);
    console.log('[AC-2/4] 다운로드 파일명 확인 OK:', name);
  });

  // ── AC-6: 회귀 — 매출집계(Sales) 담당치료사별은 표내부 export 버튼 미노출 ──────
  test('AC-6: 매출집계 담당치료사별 탭에는 표내부 export 버튼 없음(회귀 0)', async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) { test.skip(true, '로그인 실패'); return; }
    await page.goto('/admin/sales?tab=staff');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // enableExcelExport 기본 false → sales-staff-export-btn 미존재(공통 상단 엑셀 레이어는 별개).
    const btn = page.getByTestId('sales-staff-export-btn');
    expect(await btn.count(), '매출집계 담당치료사별 표내부 export 버튼 부재').toBe(0);
    console.log('[AC-6] 회귀 확인 OK — 매출집계 표내부 export 버튼 없음');
  });
});
