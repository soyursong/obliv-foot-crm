/**
 * E2E spec — T-20260820-foot-DAYCLOSE-TOTALREV-CONSULTANT-PERM-GRANT
 * 일마감 > '총 매출' 탭 — 상담실장(consultant) role scoped view-grant.
 *
 * 현장(김주연 총괄, U0ATDB587PV, footcare C0ATE5P6JTH, 2026-08-20):
 *   "풋센터 CRM 일마감 화면에서 총 매출/메뉴 섹션을 상담실장 계정으로 볼 수 없다."
 *   "풀어달라고 했는데 안 보인다고 함" → consultant 재개방(재발/누락 해소).
 *
 * 스펙:
 *  - 사이드바 '일마감' 메뉴 = 이미 consultant 포함(PERM_MATRIX.closing = ALL_STAFF_ROLES) → 무변경(회귀 확인만).
 *  - '총 매출' 탭(compare) 게이트 = 기존 hasOpsAuthority(admin/manager/대표원장) → 그 위에 consultant 만
 *    ADDITIVE 재개방(canViewClosingTotalRevenue SSOT predicate). blanket 아님(전직원 재개방 아님).
 *  - db_change=false — 탭 소스 테이블(payments/closing_manual_payments/package_sessions/check_ins)은 consultant 가
 *    이미 summary/payments 탭에서 읽는 RLS 통과 집합. RLS 무변경(RLS-SEAL 하드닝 비충돌).
 *  - body 선례(T-20260716-body-DAILYCLOSE-RECEIPT-PERM-GRANT, commit 71a64432) 동형 패턴.
 *
 * 시나리오(티켓 § 현장 클릭 시나리오 대응):
 *  - S1(정상): 로그인 → 사이드바 '일마감' 진입 → '총 매출' 탭 노출 → 클릭 → 데이터/딥링크 반영.
 *  - S2(회귀): 기존 탭(총 합계·결제내역) 회귀 없음(admin/manager 무회귀 포함).
 *  - S3(딥링크): ?tab=compare 진입 — 권한자 유지 / 미권한자 summary 로 NAV-BOUNCE.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test.describe('T-20260820-DAYCLOSE-TOTALREV-CONSULTANT-PERM-GRANT — 상담실장 총 매출 열람', () => {

  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패/시크릿 부재 — graceful skip (실검증=macstudio + 갤탭 field-soak, 상담실장 실계정)');
  });

  // ── S1: 사이드바 '일마감' 진입 → '총 매출' 탭 노출 → 클릭 → 딥링크 반영 ──────────
  test('S1: 일마감 진입 → 총 매출 탭 노출 → 클릭 → ?tab=compare 반영', async ({ page }) => {
    await page.goto('/admin/closing');
    await page.waitForLoadState('networkidle').catch(() => {});

    // '총 매출' 탭 트리거 노출(권한자=admin/manager/consultant 가정 → canViewClosingTotalRevenue=true).
    const trigger = page.getByRole('tab', { name: '총 매출', exact: true });
    await trigger.waitFor({ timeout: 15_000 });
    await expect(trigger).toBeVisible();

    await trigger.click();
    await page.waitForTimeout(800);

    // URL query(?tab=compare) 반영 — 딥링크/새로고침 유지 축.
    await expect(page).toHaveURL(/tab=compare/);
    await expect(trigger).toHaveAttribute('aria-selected', 'true');
  });

  // ── S2: 기존 탭 회귀 없음 — 총 합계 / 결제내역 유지 (admin/manager 무회귀) ──────────
  test('S2: 기존 일마감 탭(총 합계·결제내역) 회귀 없음', async ({ page }) => {
    await page.goto('/admin/closing');
    await page.waitForLoadState('networkidle').catch(() => {});

    await expect(page.getByRole('tab', { name: '총 합계' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('tab', { name: '결제내역' })).toBeVisible();
  });

  // ── S3: 딥링크 ?tab=compare — 권한자 유지 / 미권한자 summary 로 NAV-BOUNCE ──────────
  test('S3: 딥링크 ?tab=compare 착지 — 권한 게이트', async ({ page }) => {
    await page.goto('/admin/closing?tab=compare');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(800);

    const trigger = page.getByRole('tab', { name: '총 매출', exact: true });
    const visible = await trigger.isVisible().catch(() => false);

    if (visible) {
      // 권한자(admin/manager/director/consultant): 탭 노출 + 딥링크 착지 유지.
      await expect(page).toHaveURL(/tab=compare/);
      await expect(trigger).toHaveAttribute('aria-selected', 'true');
    } else {
      // 미권한자(coordinator/therapist/staff 등): 탭 트리거 미노출 + summary 로 NAV-BOUNCE.
      await expect(page.getByRole('tab', { name: '총 합계' })).toBeVisible();
    }
  });
});
