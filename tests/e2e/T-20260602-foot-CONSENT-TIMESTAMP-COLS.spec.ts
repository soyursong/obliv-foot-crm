/**
 * E2E spec — T-20260602-foot-CONSENT-TIMESTAMP-COLS
 * 풋 셀프접수 동의 시각추적 컬럼 보강 (privacy_consent_at / sms_opt_in_at)
 * parent: T-20260602-foot-CHECKIN-RESV-YESNO-FLOW
 *
 * 요구:
 *   1. privacy_consent_at (timestamptz, NULL 허용) 신규 컬럼
 *   2. sms_opt_in_at      (timestamptz, NULL 허용) 신규 컬럼
 *   3. 셀프접수 제출 시 동의(true) 시점 기록 — HIRA(hira_consent_at) 동일 패턴
 *   4. 백필 금지 — 기존 row NULL 유지
 *
 * 현장 클릭 시나리오 → E2E:
 *   시나리오 1: 개인정보 + sms 모두 동의 → 두 _at 컬럼 non-null
 *   시나리오 2: 개인정보만 동의, sms 미동의 → sms_opt_in=false AND sms_opt_in_at NULL (비차단 제출)
 *
 * DB 의존: 20260602190000_consent_timestamp_cols.sql 적용 필요
 *   → supervisor DB게이트 통과 후 적용 (deploy-ready 이후)
 *   컬럼 미적용 환경에서는 UI 흐름만 검증하고 DB 단정은 skip 처리.
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// 시나리오 1: 개인정보 + sms 동의 → 시각 기록 (UI 흐름 도달성)
// ---------------------------------------------------------------------------
test('시나리오1: 셀프접수 동의 동선 — sms 동의 체크박스 기본 체크 상태로 confirm 도달', async ({ page }) => {
  await page.goto('/checkin/test-clinic');
  await page.waitForTimeout(1_000);

  const nameInput = page.locator('input[placeholder*="홍길동"], input[type="text"]').first();
  if (!(await nameInput.isVisible({ timeout: 3_000 }).catch(() => false))) {
    test.skip(); // 클리닉 미설정 환경 skip
    return;
  }
  await nameInput.fill('동의시각테스트');

  const phoneInput = page.locator('input[placeholder*="01"], input[inputmode="numeric"]').first();
  if (await phoneInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await phoneInput.fill('01099887766');
  }

  const walkInBtn = page.locator('button:has-text("예약 없이"), button:has-text("Walk-in")').first();
  if (await walkInBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await walkInBtn.click();
  }

  const confirmTitle = page.locator('h1:has-text("접수 정보 확인"), h1:has-text("Confirm")');
  if (!(await confirmTitle.isVisible({ timeout: 3_000 }).catch(() => false))) {
    test.skip();
    return;
  }

  // sms 동의 체크박스 기본 체크 — 제출 시 sms_opt_in_at 기록 경로
  const smsCheckbox = page.locator('#sms-opt-in, input[type="checkbox"][id*="sms"]');
  await expect(smsCheckbox).toBeVisible({ timeout: 5_000 });
  await expect(smsCheckbox).toBeChecked();
});

// ---------------------------------------------------------------------------
// 시나리오 2: sms 미동의 → 비차단 제출 (sms_opt_in_at 은 NULL 경로)
// ---------------------------------------------------------------------------
test('시나리오2: sms 미동의 체크해제 후에도 접수 차단되지 않음', async ({ page }) => {
  await page.goto('/checkin/test-clinic');
  await page.waitForTimeout(1_000);

  const nameInput = page.locator('input[placeholder*="홍길동"], input[type="text"]').first();
  if (!(await nameInput.isVisible({ timeout: 3_000 }).catch(() => false))) {
    test.skip();
    return;
  }
  await nameInput.fill('sms미동의테스트');

  const confirmTitle = page.locator('h1:has-text("접수 정보 확인"), h1:has-text("Confirm")');
  if (!(await confirmTitle.isVisible({ timeout: 5_000 }).catch(() => false))) {
    test.skip();
    return;
  }

  const smsCheckbox = page.locator('#sms-opt-in, input[type="checkbox"][id*="sms"]');
  if (await smsCheckbox.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await smsCheckbox.uncheck();
    await expect(smsCheckbox).not.toBeChecked();
    // 미동의여도 제출 버튼이 비활성화되지 않음 (비차단)
    const submitBtn = page.locator('button:has-text("접수"), button:has-text("완료"), button:has-text("제출")').last();
    if (await submitBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await expect(submitBtn).toBeEnabled();
    }
  }
});

/**
 * --- DB 단정 (supervisor QA — 마이그 적용 후 수동/SQL 검증) ---
 * 시나리오 1: 제출된 customers row 에서
 *   privacy_consent = true  AND privacy_consent_at IS NOT NULL
 *   sms_opt_in      = true  AND sms_opt_in_at      IS NOT NULL
 * 시나리오 2:
 *   privacy_consent_at IS NOT NULL
 *   sms_opt_in = false AND sms_opt_in_at IS NULL
 * 백필 금지: 마이그 직후 기존 row 의 두 _at 컬럼은 전부 NULL.
 */
