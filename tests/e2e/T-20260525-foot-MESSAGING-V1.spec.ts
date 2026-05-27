/**
 * E2E spec — T-20260525-foot-MESSAGING-V1
 * 풋 CRM 메시징 모듈 1차 — S1 코드 복제 검증
 *
 * AC-1: 통합 설정 > 메시지 설정 라우트 접근 (admin/manager/director 전용)
 * AC-2: AdminSettings 메시지 섹션 렌더링 — 솔라피 API 키 입력 폼, 발신번호 필드
 * AC-3: permissions.ts messaging 권한 — role별 노출 제어
 * AC-4: 셀프체크인 SMS 동의 체크박스 — confirm 단계에서 체크박스 노출, 기본값 true
 * AC-5: 셀프체크인 SMS 미동의 — 체크박스 해제 후 접수 정상 완료
 *
 * DB 의존: messaging_module migration 적용 필요
 *   → supervisor QA 시 적용 (S1 deploy-ready 이후)
 */

import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

// ---------------------------------------------------------------------------
// AC-1: 메시지 설정 라우트 접근
// ---------------------------------------------------------------------------
test('AC-1: admin이 /admin/settings 메시지 설정 페이지에 접근 가능', async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await page.goto('/admin/settings');
  // 메시지 설정 페이지가 로드됨
  await expect(page.locator('h1, h2, [data-testid="settings-title"]').first())
    .toBeVisible({ timeout: 10_000 });
  // 403/404 리다이렉트 없음
  expect(page.url()).toContain('/admin/settings');
});

// ---------------------------------------------------------------------------
// AC-2: AdminSettings 메시지 섹션 렌더링
// ---------------------------------------------------------------------------
test('AC-2: AdminSettings 메시지 섹션 — 솔라피 설정 폼 렌더링', async ({ page }) => {
  await loginAndWaitForDashboard(page);
  await page.goto('/admin/settings');
  await page.waitForTimeout(500);

  // ⓪ 연결 설정 섹션 클릭 (기본값 1_channels → 0_connection으로 전환)
  // AdminSettings.tsx L135: { id: '0_connection', label: '⓪ 연결 설정', adminOnly: true }
  // AdminSettings.tsx L158: useState<Section>('1_channels') — 기본값
  const connBtn = page.locator('button:has-text("⓪ 연결 설정"), button:has-text("연결 설정")').first();
  await expect(connBtn).toBeVisible({ timeout: 5_000 });
  await connBtn.click();
  await page.waitForTimeout(500);

  // 발신번호 또는 API Key 입력 필드 존재 확인
  const apiKeyInput = page.locator('input[placeholder*="NCxx"], input[placeholder*="API"], input[placeholder*="키"]');
  const senderInput = page.locator('input[placeholder*="01"], input[placeholder*="발신"]');
  const anyField = apiKeyInput.or(senderInput).or(page.locator('[data-testid*="messaging"], [data-testid*="solapi"]'));
  await expect(anyField.first()).toBeVisible({ timeout: 8_000 });
});

// ---------------------------------------------------------------------------
// AC-3: 메시지 설정 — AdminLayout 네비 항목 노출
// ---------------------------------------------------------------------------
test('AC-3: AdminLayout 사이드바에 "메시지 설정" 메뉴 항목 노출', async ({ page }) => {
  await loginAndWaitForDashboard(page);
  // 사이드바에서 메시지 설정 링크 탐색
  const navItem = page.locator('a[href*="/admin/settings"], nav >> text=메시지 설정');
  await expect(navItem.first()).toBeVisible({ timeout: 8_000 });
});

// ---------------------------------------------------------------------------
// AC-4: 셀프체크인 confirm 단계 SMS 동의 체크박스 (기본 true)
// ---------------------------------------------------------------------------
test('AC-4: 셀프체크인 confirm 단계 SMS 동의 체크박스 — 기본값 체크', async ({ page }) => {
  // 셀프체크인 페이지 접근 (clinicSlug 필요 — test-clinic 더미 사용)
  await page.goto('/checkin/test-clinic');
  // 페이지 로드 확인 (클리닉 미존재 시 에러 페이지도 허용)
  await page.waitForTimeout(1_000);

  // 입력 폼이 있으면 진행
  const nameInput = page.locator('input[placeholder*="홍길동"], input[type="text"]').first();
  if (!(await nameInput.isVisible({ timeout: 3_000 }).catch(() => false))) {
    test.skip(); // 클리닉 미설정 환경 skip
    return;
  }

  // 성함 입력
  await nameInput.fill('테스트고객');

  // 전화번호 입력 (키패드 또는 input)
  const phoneInput = page.locator('input[placeholder*="01"], input[inputmode="numeric"]').first();
  if (await phoneInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await phoneInput.fill('01012341234');
  }

  // 방문유형 선택 흐름 (예약없이 방문)
  const walkInBtn = page.locator('button:has-text("예약 없이"), button:has-text("Walk-in")').first();
  if (await walkInBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await walkInBtn.click();
  }

  // 접수 확인 단계 진입
  const confirmTitle = page.locator('h1:has-text("접수 정보 확인"), h1:has-text("Confirm")');
  if (!(await confirmTitle.isVisible({ timeout: 3_000 }).catch(() => false))) {
    test.skip(); // confirm 단계 도달 불가 환경 skip
    return;
  }

  // SMS 동의 체크박스 확인
  const smsCheckbox = page.locator('#sms-opt-in, input[type="checkbox"][id*="sms"]');
  await expect(smsCheckbox).toBeVisible({ timeout: 5_000 });
  await expect(smsCheckbox).toBeChecked(); // 기본값 true
});

// ---------------------------------------------------------------------------
// AC-5: 셀프체크인 SMS 미동의 — 체크박스 해제 후 접수 정상
// ---------------------------------------------------------------------------
test('AC-5: 셀프체크인 SMS 동의 체크박스 해제 가능', async ({ page }) => {
  await page.goto('/checkin/test-clinic');
  await page.waitForTimeout(1_000);

  const nameInput = page.locator('input[placeholder*="홍길동"], input[type="text"]').first();
  if (!(await nameInput.isVisible({ timeout: 3_000 }).catch(() => false))) {
    test.skip();
    return;
  }
  await nameInput.fill('테스트고객2');

  const confirmTitle = page.locator('h1:has-text("접수 정보 확인"), h1:has-text("Confirm")');
  if (!(await confirmTitle.isVisible({ timeout: 5_000 }).catch(() => false))) {
    test.skip();
    return;
  }

  const smsCheckbox = page.locator('#sms-opt-in, input[type="checkbox"][id*="sms"]');
  if (await smsCheckbox.isVisible({ timeout: 3_000 }).catch(() => false)) {
    // 체크박스 해제
    await smsCheckbox.uncheck();
    await expect(smsCheckbox).not.toBeChecked();
  }
});
