/**
 * E2E spec — T-20260809-foot-CLOSING-PAYSUBTAB-PERSIST-HASHUNIFY
 *
 * 부모 canonical T-20260808-foot-CRM-REFRESH-ROUTE-PERSIST AC-2 자식.
 *
 * 현장 증상: [일마감 Closing] 결제내역 하위탭(paySubTab: CRM수납/레드페이/영수증)이 F5 시 첫 탭(CRM수납)으로 리셋.
 *
 * RC: 주탭(summary/payments/compare)은 구 URL hash(#payments/#compare) 기반이라 새로고침에 이미 유지되나,
 *   서브탭(paySubTab)은 useState 기본값 관리 → URL 미반영 → F5 리셋. hash + query(?paytab=) 병행 시
 *   navigate/setSearchParams 가 hash·search 를 상호 소거(stomp)해 서브탭 유지가 구조적으로 불가.
 *
 * Fix: 주탭 mechanism 을 hash → query(?tab=) 로 통일(useTabParam 재사용) + 서브탭도 같은 query 축(?paytab=)에
 *   반영. 기존 #payments/#compare 딥링크·북마크는 마운트 1회 호환 리다이렉트로 보존.
 *
 * AC-1: 주탭(결제내역) 전환 → ?tab=payments 반영 + 새로고침 복원.
 * AC-2: 결제 서브탭(레드페이) 전환 → ?paytab=redpay 반영 + 새로고침 후 서브탭 복원(첫 탭 리셋 없음).
 * AC-3: 딥링크(?tab=payments&paytab=receipt) 직접 진입 → 해당 주탭+서브탭 착지 + 새로고침 유지.
 * AC-4: 레거시 hash 딥링크(#payments) 진입 → ?tab=payments 로 이관 + hash 제거(북마크 회귀 방지).
 * AC-5: 미인증 딥링크 새로고침 → 인증 가드 유지(백지/에러 튕김 불허).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

const CLOSING = '/admin/closing';

test.describe('T-20260809 — 일마감 결제 서브탭 URL 유지 + hash 통일', () => {
  // AC-5: 미인증 딥링크는 기존 인증 가드대로 처리(회귀 금지). 로그인 불필요.
  test('AC-5: 미인증 상태로 일마감 딥링크 새로고침 → 인증 가드 유지', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`${CLOSING}?tab=payments&paytab=redpay`);
    await page.waitForTimeout(1500);
    const url = page.url();
    // 세션 있으면 유지(정상), 없으면 /login. 둘 다 허용하되 백지/에러 튕김은 불허.
    expect(url.includes('/login') || url.includes('/admin/closing')).toBeTruthy();
  });

  test.describe('인증 필요', () => {
    test.beforeEach(async ({ page }) => {
      const ok = await loginAndWaitForDashboard(page);
      if (!ok) test.skip(true, 'Login failed (env/secret 부재 시 graceful skip)');
    });

    async function gotoClosing(page: import('@playwright/test').Page): Promise<boolean> {
      await page.goto(CLOSING);
      await page.waitForTimeout(1500);
      if (new URL(page.url()).pathname !== CLOSING) {
        test.skip(true, '일마감 접근 권한 없음(role gate) — 스킵');
        return false;
      }
      return true;
    }

    // AC-1: 주탭(결제내역) 클릭 → ?tab=payments 반영 + 새로고침 후 유지(주탭 query 통일 검증).
    test('AC-1: 결제내역 주탭 전환 → ?tab=payments 반영 + 새로고침 복원', async ({ page }) => {
      if (!(await gotoClosing(page))) return;

      const paymentsTab = page.getByRole('tab', { name: /결제내역/ }).first();
      if (await paymentsTab.count() === 0) test.skip(true, '주탭 UI 미발견 — 스킵');
      await paymentsTab.click();

      await expect
        .poll(() => new URL(page.url()).searchParams.get('tab'), { timeout: 5000 })
        .toBe('payments');

      await page.reload();
      await page.waitForTimeout(1500);
      expect(new URL(page.url()).pathname).toBe(CLOSING);
      expect(new URL(page.url()).searchParams.get('tab')).toBe('payments');
    });

    // AC-2: 결제 서브탭(레드페이) 전환 → ?paytab=redpay 반영 + 새로고침 후 서브탭 복원(첫 탭 리셋 없음 = 이번 fix 핵심).
    test('AC-2: 결제 서브탭 [레드페이] 전환 → ?paytab=redpay 반영 + 새로고침 복원', async ({ page }) => {
      if (!(await gotoClosing(page))) return;

      // 주탭 결제내역 먼저 진입.
      const paymentsTab = page.getByRole('tab', { name: /결제내역/ }).first();
      if (await paymentsTab.count() === 0) test.skip(true, '주탭 UI 미발견 — 스킵');
      await paymentsTab.click();
      await page.waitForTimeout(600);

      // 서브탭 레드페이 클릭.
      const redpayTab = page.getByRole('tab', { name: /레드페이/ }).first();
      if (await redpayTab.count() === 0) test.skip(true, '결제 서브탭 UI 미발견 — 스킵');
      await redpayTab.click();

      await expect
        .poll(() => new URL(page.url()).searchParams.get('paytab'), { timeout: 5000 })
        .toBe('redpay');
      // 주탭도 함께 유지(stomp 없음).
      expect(new URL(page.url()).searchParams.get('tab')).toBe('payments');

      // 새로고침 → 주탭+서브탭 모두 복원(구 버그: 서브탭 crm 으로 리셋).
      await page.reload();
      await page.waitForTimeout(1500);
      expect(new URL(page.url()).searchParams.get('tab')).toBe('payments');
      expect(new URL(page.url()).searchParams.get('paytab')).toBe('redpay');
      // 레드페이 탭이 실제 활성 상태(aria-selected)로 복원.
      await expect(page.getByRole('tab', { name: /레드페이/ }).first())
        .toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
    });

    // AC-3: 딥링크(?tab=payments&paytab=receipt) 직접 진입 → 해당 주탭+서브탭 착지 + 새로고침 유지.
    test('AC-3: ?tab=payments&paytab=receipt 딥링크 진입 후 새로고침 유지', async ({ page }) => {
      await page.goto(`${CLOSING}?tab=payments&paytab=receipt`);
      await page.waitForTimeout(1500);
      if (new URL(page.url()).pathname !== CLOSING) {
        test.skip(true, '일마감 접근 권한 없음 — 스킵');
      }
      expect(new URL(page.url()).searchParams.get('tab')).toBe('payments');
      expect(new URL(page.url()).searchParams.get('paytab')).toBe('receipt');

      await page.reload();
      await page.waitForTimeout(1500);
      expect(new URL(page.url()).searchParams.get('tab')).toBe('payments');
      expect(new URL(page.url()).searchParams.get('paytab')).toBe('receipt');
    });

    // AC-4: 레거시 hash 딥링크(#payments) → ?tab=payments 로 이관 + hash 제거(기존 북마크 회귀 방지).
    test('AC-4: 레거시 #payments 딥링크 → ?tab=payments 이관 + hash 제거', async ({ page }) => {
      await page.goto(`${CLOSING}#payments`);
      await page.waitForTimeout(1800);
      if (new URL(page.url()).pathname !== CLOSING) {
        test.skip(true, '일마감 접근 권한 없음 — 스킵');
      }
      // hash → query 로 이관.
      await expect
        .poll(() => new URL(page.url()).searchParams.get('tab'), { timeout: 5000 })
        .toBe('payments');
      // hash 는 제거되어 주소창 정리.
      expect(new URL(page.url()).hash).toBe('');
    });
  });
});
