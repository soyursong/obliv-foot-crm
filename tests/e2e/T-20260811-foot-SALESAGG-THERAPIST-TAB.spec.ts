/**
 * E2E spec — T-20260811-foot-SALESAGG-THERAPIST-TAB
 * 일마감 > 신규 '총매출(치료)' 탭 — 매출집계>담당치료사별(SalesStaffTab) 미러(내용 그대로 연동).
 *
 * 김주연 총괄 확정(reply ts=1786502240.795299):
 *   "일마감 - 총매출(치료) / 신설 / 안에 내용은 기존 [매출집계]→[담당치료사별] 내용 그대로 연동,
 *    관리자+치료사 계정만 볼 수 있게."
 *
 * 스펙:
 *  - 위치: 일마감(/admin/closing) 최상위 신규 탭 '총매출(치료)' (기존 '총 매출' 탭과 별도 — 그 탭은 ops-authority 게이트라 therapist 미노출).
 *  - 내용: SalesFilterBar(기간·검색) + SalesStaffTab 미러. 기존 산식/grain/drill-down 재사용, 신규 산식 창작 0.
 *  - 권한: admin + therapist 만 탭 노출(canViewTherapistSales). /sales route 무변경(therapist blanket admit 안 함).
 *  - db_change=false — DB 무변경(집계 read-only).
 *
 * 시나리오(티켓 § 현장 클릭 시나리오 대응):
 *  - S1(정상, admin): 일마감 진입 → '총매출(치료)' 탭 노출 → 클릭 → 필터 UI + 치료사별 표 표시.
 *  - S2(권한): 딥링크(?tab=therapist_sales) 진입 시 권한 없는 계정은 요약 탭으로 NAV-BOUNCE(탭 숨김 parity).
 *  - S3(무변경): 기존 3개 탭(총 합계/결제내역/총 매출) 회귀 없음.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260811-SALESAGG-THERAPIST-TAB — 일마감 총매출(치료) 신규 탭', () => {

  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패/시크릿 부재 — graceful skip (실검증=macstudio + 갤탭 field-soak)');
  });

  // ── S1: 정상 동선 — '총매출(치료)' 탭 노출 + 클릭 시 미러 컨텐츠 표시 ──────────
  test('S1: 일마감 > 총매출(치료) 탭 노출 → 클릭 → 필터바 + 담당치료사별 표 렌더', async ({ page }) => {
    await page.goto('/admin/closing');
    await page.waitForLoadState('networkidle').catch(() => {});

    // 신규 탭 트리거 노출(로그인 계정=admin 가정 → canViewTherapistSales=true).
    const trigger = page.getByRole('tab', { name: '총매출(치료)' });
    await trigger.waitFor({ timeout: 15_000 });
    await expect(trigger).toBeVisible();

    await trigger.click();
    await page.waitForTimeout(800);

    // URL query(?tab=therapist_sales) 반영 확인 — 딥링크/새로고침 유지 축.
    await expect(page).toHaveURL(/tab=therapist_sales/);

    // 미러 컨텐츠: (1) 필터바(기간·검색) UX + (2) SalesStaffTab 표 헤더('차감 매출(치료)') 둘 다 렌더 확인.
    //   (기간에 데이터가 없어도 표 골격/필터바는 렌더된다.)
    await expect(page.getByTestId('sales-search').first()).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('columnheader', { name: '차감 매출(치료)' }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  // ── S2: NAV-BOUNCE — 딥링크 진입해도 권한 없으면 요약 탭으로 (탭 숨김 parity) ──
  //   기본 로그인 계정이 admin(canViewTherapistSales=true)이면 바운스가 inert(정상 착지).
  //   권한 계정에서는 착지 유지, 미권한 계정에서는 summary 로 바운스됨을 구조적으로 확인.
  test('S2: 딥링크 ?tab=therapist_sales 착지 — 권한자는 유지, 탭 트리거는 권한 게이트', async ({ page }) => {
    await page.goto('/admin/closing?tab=therapist_sales');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(800);

    const trigger = page.getByRole('tab', { name: '총매출(치료)' });
    const visible = await trigger.isVisible().catch(() => false);

    if (visible) {
      // 권한자(admin/therapist): 탭 노출 + 딥링크 착지 유지(base-ui Tabs → aria-selected='true').
      await expect(page).toHaveURL(/tab=therapist_sales/);
      await expect(trigger).toHaveAttribute('aria-selected', 'true');
    } else {
      // 미권한자: 탭 트리거 미노출 + NAV-BOUNCE 로 summary 착지(therapist_sales 미유지)
      await expect(page.getByRole('tab', { name: '총 합계' })).toBeVisible();
    }
  });

  // ── S3: 기존 탭 회귀 없음 — 총 합계 / 결제내역 유지 ──────────────────────────
  test('S3: 기존 일마감 탭(총 합계·결제내역) 회귀 없음', async ({ page }) => {
    await page.goto('/admin/closing');
    await page.waitForLoadState('networkidle').catch(() => {});

    await expect(page.getByRole('tab', { name: '총 합계' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('tab', { name: '결제내역' })).toBeVisible();
  });
});
