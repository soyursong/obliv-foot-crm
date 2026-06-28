/**
 * T-20260615-foot-CONSENT-SENSITIVE
 * 셀프접수 personal_info 단계: 민감정보(건강·진료정보) 별도 동의 (개보법 §23)
 *
 * body(obliv-body-crm) 검증 패턴 이식. foot 아키텍처(fn_selfcheckin_update_personal_info) 맞춤.
 *
 * AC 커버:
 *   AC-1 민감정보 동의 체크박스 + 상세고지 div 존재 + 기본 체크(true)
 *   AC-2 상세고지 본문이 지정 문구(수집항목/수집목적/보유기간) 그대로 표시
 *   AC-3 민감정보 동의는 필수 — 체크 시 다음 버튼 활성, 미체크 시 비활성(게이팅)
 *   AC-4 회귀: 기존 개인정보/건강보험 동의 블록(pi-consent-detail) 불변 공존
 */
import { test, expect } from '@playwright/test';

function sfx() {
  return String(Date.now()).slice(-6);
}

// 초진 personal_info 단계 진입 헬퍼 (T-20260603 ADDR-CONSENT-LAYOUT 동선 재사용)
async function gotoPersonalInfo(page: import('@playwright/test').Page, name: string, phone: string) {
  await page.context().clearCookies();
  await page.goto('/checkin/jongno-foot');
  await page.waitForLoadState('networkidle');

  await page.locator('#sc-name').fill(name);
  const phoneDigits = phone.replace(/\D/g, '').slice(0, 11);
  for (const d of phoneDigits) {
    await page.getByRole('button', { name: d, exact: true }).first().click();
  }

  // 방문유형: 예약 → 초진(new)
  await page.locator('[data-testid="btn-reserved"]').click();
  await page.getByRole('button', { name: '초진' }).click();
  await page.locator('[data-testid="btn-checkin"]').click();
  await page.waitForTimeout(1000);
}

// 다음 버튼 활성 충족용 — 주민번호 6자리 + 기본주소 입력
async function fillRrnAndAddress(page: import('@playwright/test').Page) {
  for (const d of ['9', '0', '0', '1', '0', '1']) {
    await page.getByRole('button', { name: d, exact: true }).first().click();
  }
  await page.locator('[data-testid="pi-address-input"]').fill('서울특별시 종로구 종로 1');
}

// ── AC-1: 민감정보 동의 체크박스 + 상세고지 존재 + 기본 체크 ─────────────────
test.describe('T-20260615 AC-1 민감정보 동의 UI', () => {
  const s = sfx();

  test('민감정보 동의 체크박스 + 상세고지 div 존재 + 기본 체크(true)', async ({ page }) => {
    await gotoPersonalInfo(page, `sens-ui-${s}`, `010${s}0001`);

    const label = page.locator('[data-testid="pi-consent-sensitive-label"]');
    const checkbox = page.locator('[data-testid="pi-consent-sensitive-checkbox"]');
    const detail = page.locator('[data-testid="pi-consent-sensitive-detail"]');

    await expect(label).toBeVisible({ timeout: 6000 });
    await expect(checkbox).toBeVisible();
    await expect(detail).toBeVisible();

    // 폼 캡처 시점 기본 체크(true)
    await expect(checkbox).toBeChecked();

    // 레이블 문구 (개보법 §23 표기)
    await expect(label).toContainText('민감정보(건강·진료정보) 수집·이용에 동의합니다 (필수, 개보법 §23)');

    await page.screenshot({
      path: 'test-results/screenshots/consent-sensitive-ui.png',
      fullPage: true,
    });
  });
});

// ── AC-2: 상세고지 본문 문구 ────────────────────────────────────────────────
test.describe('T-20260615 AC-2 민감정보 동의 상세 고지', () => {
  const s = sfx();

  test('상세고지 본문이 지정 문구(수집항목/수집목적/보유기간) 그대로 표시', async ({ page }) => {
    await gotoPersonalInfo(page, `sens-det-${s}`, `010${s}0002`);

    const detail = page.locator('[data-testid="pi-consent-sensitive-detail"]');
    await expect(detail).toBeVisible({ timeout: 6000 });

    await expect(detail.getByText('민감정보(건강·진료정보) 수집·이용 동의 (필수)')).toBeVisible();
    await expect(detail.getByText('수집항목 : 건강정보, 진료기록, 상병명, 처방내역 등 민감 의료정보')).toBeVisible();
    await expect(detail.getByText('수집목적 : 발건강 케어 및 시술 서비스 제공, 진료 이력 관리')).toBeVisible();
    await expect(detail.getByText('보유기간 : 관련 법령(의료법 §22 등)에 따른 보관 기간 동안 보유')).toBeVisible();
  });
});

// ── AC-3: 필수 게이팅 — 미체크 시 다음 버튼 비활성 ──────────────────────────
test.describe('T-20260615 AC-3 민감정보 동의 필수 게이팅', () => {
  const s = sfx();

  test('체크 시 다음 활성 / 미체크 시 다음 비활성', async ({ page }) => {
    await gotoPersonalInfo(page, `sens-gate-${s}`, `010${s}0003`);
    await fillRrnAndAddress(page);

    const next = page.locator('[data-testid="btn-personal-info-next"]');
    const checkbox = page.locator('[data-testid="pi-consent-sensitive-checkbox"]');

    // 기본 체크 상태 → 다음 활성
    await expect(checkbox).toBeChecked();
    await expect(next).toBeEnabled({ timeout: 3000 });

    // 민감정보 동의 해제 → 필수 미충족 → 다음 비활성
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
    await expect(next).toBeDisabled({ timeout: 3000 });

    // 재체크 → 다시 활성 (회귀)
    await checkbox.check();
    await expect(next).toBeEnabled({ timeout: 3000 });
  });
});

// ── AC-4: 회귀 — 기존 개인정보/건강보험 동의 블록 불변 공존 ──────────────────
test.describe('T-20260615 AC-4 기존 동의 블록 회귀', () => {
  const s = sfx();

  test('기존 pi-consent-detail(개인정보+건강보험) 블록이 그대로 공존', async ({ page }) => {
    await gotoPersonalInfo(page, `sens-reg-${s}`, `010${s}0004`);

    // 기존 동의서 본문 블록(개인정보/건강보험) 불변 표시
    const legacyDetail = page.locator('[data-testid="pi-consent-detail"]');
    await expect(legacyDetail).toBeVisible({ timeout: 6000 });
    await expect(legacyDetail.getByText('개인정보 수집·이용 동의 (필수)')).toBeVisible();

    // 신규 민감정보 블록과 동시 공존
    await expect(page.locator('[data-testid="pi-consent-sensitive-detail"]')).toBeVisible();
  });
});
