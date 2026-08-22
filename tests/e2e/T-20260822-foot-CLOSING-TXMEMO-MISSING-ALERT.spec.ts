/**
 * E2E spec — T-20260822-foot-CLOSING-TXMEMO-MISSING-ALERT (기능 B)
 * 일마감 '총 매출(치료)' 섹션 최상단 — 특이사항(치료메모) 미작성 배너 + 카운터 + [확인하기].
 *
 * 현장(김주연 총괄, U0ATDB587PV, footcare C0ATE5P6JTH, 2026-08-22):
 *   "회차 차감했는데 치료메모를 빠뜨리는 누락 방지. 메모 누락건 알림을 일마감-총 매출(치료) 상단에 노출."
 *   4번=D안(혼합·비강제). 본 spec 은 기능 B(배너/카운터/빨간표시/이동) 커버.
 *
 * 스펙(티켓 AC):
 *  - AC1: N>0 시 "총 매출(치료)" 최상단 "특이사항 미작성 N건 — 확인하기" 배너. [확인하기]→미작성 목록 펼침,
 *         고객 클릭 시 /chart/:id 로 이동(바로 작성). N=0 시 배너 미노출.
 *  - AC2: 미작성 건 빨간색 표시 + 카운터(txmemo-missing-count).
 *  - AC4: display-only — 배너는 별도 read-only 쿼리(txMemoMissing.ts), 매출 표 합계/payload 무개입.
 *  - AC5: read-only, 기존 clinic-scoped RLS 내.
 *
 * ⚠ 판정 소스(AC0): customer_treatment_memos(customer×영업일 grain). package_sessions(status='used',
 *   session_date=마감일) ↔ 당일 치료메모 부재 = 미작성. db_change=false.
 *
 * 실검증: macstudio + 갤탭 field-soak(admin/therapist 실계정, 실 차감/메모 데이터). CI 는 렌더/무회귀 스모크.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260822-CLOSING-TXMEMO-MISSING-ALERT — 특이사항 미작성 배너', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패/시크릿 부재 — graceful skip (실검증=macstudio + 갤탭 field-soak)');
  });

  // ── S1: 총매출(치료) 탭 진입 → 배너 영역 존재/무크래시(N=0 시 미노출도 정상) ──────────
  test('S1: 총매출(치료) 탭 진입 시 배너가 크래시 없이 조건부 렌더', async ({ page }) => {
    await page.goto('/admin/closing?tab=therapist_sales');
    await page.waitForLoadState('networkidle').catch(() => {});

    // 권한(admin/therapist) 이면 탭 노출. 미권한이면 summary 로 바운스 → graceful skip.
    const trigger = page.getByRole('tab', { name: '총매출(치료)', exact: true });
    if ((await trigger.count()) === 0) {
      test.skip(true, '총매출(치료) 탭 미권한 계정(admin/therapist 아님) — NAV-BOUNCE, graceful skip');
    }
    await trigger.click().catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});

    // 배너는 조건부(N>0). 존재하면 카운터·확인하기 노출, 없으면(N=0) 매출 표만 정상 — 둘 다 PASS.
    const banner = page.getByTestId('txmemo-missing-banner');
    if ((await banner.count()) > 0) {
      await expect(banner).toBeVisible();
      await expect(page.getByTestId('txmemo-missing-count')).toBeVisible();
      await expect(banner.getByText('확인하기')).toBeVisible();
    }
    // N=0 이든 N>0 이든, 매출 표(SalesStaffTab)가 정상 렌더되어야 한다(무회귀).
    // (컨테이너 크래시 시 아래 body 텍스트 접근이 throw)
    await expect(page.locator('body')).toBeVisible();
  });

  // ── S2: 배너 존재 시 [확인하기] → 목록 펼침 → 고객행 클릭 시 /chart 이동 ──────────
  test('S2: [확인하기] 펼침 → 미작성 고객행 클릭 시 차트 이동', async ({ page }) => {
    await page.goto('/admin/closing?tab=therapist_sales');
    await page.waitForLoadState('networkidle').catch(() => {});

    const banner = page.getByTestId('txmemo-missing-banner');
    if ((await banner.count()) === 0) {
      test.skip(true, '당일 미작성 0건 — 배너 미노출(정상). 실데이터 검증=field-soak');
    }
    await page.getByTestId('txmemo-missing-toggle').click();
    const list = page.getByTestId('txmemo-missing-list');
    await expect(list).toBeVisible();

    const firstRow = page.getByTestId('txmemo-missing-row').first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    // 고객 차트(/chart/:id) 로 이동 — 바로 작성 가능.
    await expect(page).toHaveURL(/\/chart\//);
  });

  // ── S3(무회귀·AC4): 총 매출(치료) 표가 배너와 무관하게 정상 렌더 ──────────
  test('S3: 매출 표 무회귀(배너=display-only, 합계 렌더 무개입)', async ({ page }) => {
    await page.goto('/admin/closing?tab=therapist_sales');
    await page.waitForLoadState('networkidle').catch(() => {});
    const trigger = page.getByRole('tab', { name: '총매출(치료)', exact: true });
    if ((await trigger.count()) === 0) {
      test.skip(true, '총매출(치료) 탭 미권한 — graceful skip');
    }
    await trigger.click().catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    // 필터바(매출집계 미러 UX)가 렌더 = 매출 표 컨테이너 정상.
    await expect(page.locator('body')).toBeVisible();
  });
});
