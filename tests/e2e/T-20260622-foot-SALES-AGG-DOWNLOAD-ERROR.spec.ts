/**
 * T-20260622-foot-SALES-AGG-DOWNLOAD-ERROR — 매출집계 엑셀 다운로드 오류 회귀 가드
 *
 * 근인(prod 실측 재현):
 *   - package_payments 조회의 packages(customers(...)) 임베드가 PGRST201(모호성)로 실패.
 *     packages↔customers FK 2개(packages_customer_id_fkey=구매자, packages_transferred_to_fkey=양도대상).
 *   - packages(name) 컬럼 부재(42703) — 실제 컬럼은 package_name.
 *   ⇒ pkgRes.error throw → catch → '다운로드 중 오류가 발생했습니다.' 토스트.
 *
 * 수정: 구매자 FK 명시(customers!packages_customer_id_fkey) + package_name 컬럼명 교정.
 *
 * 가드: 엑셀 다운로드 클릭 시 '다운로드 중 오류' 토스트가 절대 뜨지 않음
 *       (성공 토스트 또는 '매출 내역이 없습니다' 정보 토스트만 허용 = graceful).
 */

import { test, expect } from '@playwright/test';

// 네비게이션은 상대경로로 — playwright.config.ts 의 baseURL(http://localhost:8089)
// + 자동 기동 webServer 를 그대로 사용한다. (과거 'http://localhost:5173' 하드코딩이
//  config baseURL/webServer 를 우회해 net::ERR_CONNECTION_REFUSED 유발 → 회귀 차단)
// BASE_URL env 가 주어지면(예: prod soak) 절대 URL 로 override 가능.
const BASE_URL = process.env.BASE_URL ?? '';
const SALES_URL = `${BASE_URL}/admin/sales`;
const ERROR_TOAST = '다운로드 중 오류가 발생했습니다.';

// 인증은 desktop-chrome 프로젝트의 storageState(<repo>/.auth/user.json, auth.setup 이
// 매 run 갱신)를 그대로 상속한다. (과거 'playwright/.auth/user.json' 오버라이드는 28바이트
//  빈 세션 stub 을 가리켜 /admin/sales 가 /login 으로 리다이렉트 → sales-export-btn 미발견.
//  경로 drift 회귀 차단을 위해 spec 레벨 storageState 오버라이드를 제거.)

test.describe('매출집계 엑셀 다운로드 오류 회귀', () => {
  test('엑셀 다운로드 클릭 → 오류 토스트 미발생(성공/빈데이터만)', async ({ page }) => {
    await page.goto(SALES_URL);
    await page.waitForLoadState('networkidle');

    // 다운로드 이벤트(성공 시) 또는 토스트(빈데이터/오류) 중 하나를 기다림
    const downloadPromise = page
      .waitForEvent('download', { timeout: 8000 })
      .catch(() => null);

    await page.getByTestId('sales-export-btn').click();

    // 핵심 단언: 오류 토스트가 뜨면 실패 (PGRST201/42703 회귀 표면)
    await expect(page.getByText(ERROR_TOAST)).not.toBeVisible({ timeout: 6000 });

    // 다운로드 성공이든 빈데이터 안내든 — 둘 다 정상 동선
    await downloadPromise;
  });

  test('패키지 결제 임베드 모호성/컬럼명 회귀 가드 — 쿼리 셀렉트 문자열', async () => {
    // 소스에 양도대상 FK 모호성을 유발하는 비명시 임베드/오타 컬럼이 재유입되지 않도록 가드.
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/pages/Sales.tsx', 'utf8');

    // package_payments 셀렉트는 반드시 구매자 FK를 명시해야 함
    expect(src).toContain('customers!packages_customer_id_fkey');
    // 실제 컬럼명 package_name 사용 (packages(name) 비명시 임베드 금지)
    expect(src).toContain('packages(package_name');
    expect(src).not.toContain('packages(name,');
  });
});
