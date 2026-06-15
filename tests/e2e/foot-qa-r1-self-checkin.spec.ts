/**
 * QA Round 1 — anon 셀프체크인 진입 동선
 *
 * T-20260615-foot-REGRESSION-SUITE-DEROT RC-A:
 * 6/2 CF-CUTOVER + 6/3 OLDURL-DEPRECATE 이후 /checkin/jongno-foot 의 네이티브
 * SelfCheckIn 폼(#sc-name 등)은 폐기되고 canonical 이 foot-checkin.pages.dev(별도
 * 레포)로 단일 이전됨. obliv-foot-crm 은 deprecated slug 진입 시 canonical 로
 * 강제 리다이렉트하는 고지 화면만 책임진다. 따라서 회귀 검증 대상은
 * "네이티브 접수 폼 → DB INSERT" 가 아니라 "deprecated slug → canonical 리다이렉트".
 * 네이티브 폼 직타 검증(#sc-name)은 dead-code 검증이라 false-fail 을 냈으므로
 * 결정적(offline-safe) 리다이렉트 검증으로 교체한다.
 */
import { test, expect } from '@playwright/test';
import { expectDeprecatedCheckinRedirect } from '../helpers';

test.describe('QA-R1 셀프체크인 (anon)', () => {
  test('비로그인 anon 진입 → 페이지 200', async ({ page }) => {
    await page.context().clearCookies();
    const resp = await page.goto('/checkin/jongno-foot');
    expect(resp?.status()).toBeLessThan(400);
  });

  test('deprecated slug 진입 → canonical 셀프접수 리다이렉트 고지 (네이티브 폼 폐기)', async ({ page }) => {
    await expectDeprecatedCheckinRedirect(page);
  });
});
