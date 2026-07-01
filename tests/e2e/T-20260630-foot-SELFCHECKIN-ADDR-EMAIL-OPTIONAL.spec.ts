/**
 * T-20260630-foot-SELFCHECKIN-ADDR-EMAIL-OPTIONAL
 * 셀프접수(외국인/English 흐름) 개인정보 단계 — 주소·이메일 택1 검증 완화(A안, at-least-one).
 *
 * 배경(현장, 김주연 총괄): 외국인은 숙소 주소가 없고 이메일만 있는 경우 등 대응.
 *   주소·이메일을 둘 다 선택필드로 완화하되 최소 1개는 충족해야 다음 단계로 진행.
 *   이메일 입력칸은 외국인(English) 흐름에만 노출되므로, 내국인(한국어)은 이메일 대체가 없어
 *   주소가 사실상 필수(기존 동작 그대로 보존 — AC-4 회귀).
 *
 * AC 커버:
 *   AC-1 주소만 입력·이메일 빈칸 → 다음 활성(택1 충족).
 *   AC-2 이메일만 입력·주소 빈칸 → 다음 활성(택1 충족).
 *   AC-3 둘 다 빈칸 → "주소 또는 이메일 중 하나를 입력해주세요" 안내 + 다음 비활성.
 *   AC-4 한국어(내국인) 흐름 무회귀 — 주소 빈칸이면 다음 비활성(주소 사실상 필수), 택1 안내 부재.
 *
 * 비고:
 *   카카오 로컬 API(체류지 숙소검색)는 외부 위젯이라 비결정적 → foreign-addr-input 직접 타이핑으로 주소 입력.
 *   개인정보/민감정보 동의는 기본 체크(true) 상태 → 본 스펙은 주소·이메일 게이트만 검증.
 *   DB submit(anon RPC) 은 검증 범위 외(RPC는 p_address/p_customer_email NULL 수용, DB변경 0).
 */
import { test, expect } from '@playwright/test';

function sfx() {
  return String(Date.now()).slice(-6);
}

async function gotoForeign(page: import('@playwright/test').Page) {
  await page.context().clearCookies();
  await page.goto('/checkin/jongno-foot');
  await page.waitForLoadState('networkidle');
  await page.locator('[data-testid="lang-toggle"]').click();
  await expect(page.getByText('한국어')).toBeVisible({ timeout: 4000 });
}

async function typePhone(page: import('@playwright/test').Page, digits: string) {
  for (const d of digits.replace(/\D/g, '').slice(0, 11)) {
    await page.getByRole('button', { name: d, exact: true }).first().click();
  }
}

// ── AC-2: 이메일만 입력·주소 빈칸 → 다음 활성 ────────────────────────────────
test.describe('T-20260630 AC-2 이메일만 입력(주소 빈칸)', () => {
  test('외국인 초진 personal_info: 이메일만 채우고 주소 빈칸이어도 다음 버튼 활성', async ({ page }) => {
    const s = sfx();
    await gotoForeign(page);

    await page.locator('#sc-name').fill(`f-email-${s}`);
    // 이메일만 입력(연락처 미입력) → contactComplete 충족(택1) → 입력단계 통과
    await page.locator('[data-testid="foreign-email-input"]').fill('email-only@example.com');
    await page.locator('[data-testid="btn-reserved"]').click();
    await page.locator('[data-testid="btn-visit-new"]').click();
    await page.locator('[data-testid="btn-checkin"]').click();
    await page.waitForTimeout(800);

    // 개인정보 단계 진입 — 체류지 위젯 노출
    await expect(page.locator('[data-testid="foreign-stay-address"]')).toBeVisible({ timeout: 6000 });
    // 주소 빈칸이지만 이메일 충족 → 택1 안내 부재 + 다음 활성
    await expect(page.locator('[data-testid="addr-email-hint"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="btn-personal-info-next"]')).toBeEnabled({ timeout: 3000 });
  });
});

// ── AC-1: 주소만 입력·이메일 빈칸 → 다음 활성 ────────────────────────────────
test.describe('T-20260630 AC-1 주소만 입력(이메일 빈칸)', () => {
  test('외국인 초진 personal_info: 주소만 채우고 이메일 빈칸이어도 다음 버튼 활성', async ({ page }) => {
    const s = sfx();
    await gotoForeign(page);

    await page.locator('#sc-name').fill(`f-addr-${s}`);
    // 연락처로 입력단계 통과(이메일 미입력)
    await typePhone(page, `010${s}11`);
    await page.locator('[data-testid="btn-reserved"]').click();
    await page.locator('[data-testid="btn-visit-new"]').click();
    await page.locator('[data-testid="btn-checkin"]').click();
    await page.waitForTimeout(800);

    // 진입 시점: 주소·이메일 둘 다 빈칸 → 안내 노출 + 다음 비활성
    await expect(page.locator('[data-testid="addr-email-hint"]')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('[data-testid="btn-personal-info-next"]')).toBeDisabled();

    // 주소 직접 입력 → 안내 사라짐 + 다음 활성
    await page.locator('[data-testid="foreign-addr-input"]').fill('Seoul Jongno-gu Hotel 101');
    await expect(page.locator('[data-testid="addr-email-hint"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="btn-personal-info-next"]')).toBeEnabled({ timeout: 3000 });
  });
});

// ── AC-3: 주소·이메일 둘 다 빈칸 → 안내 + 다음 비활성 ────────────────────────
test.describe('T-20260630 AC-3 둘 다 빈칸', () => {
  test('외국인 초진 personal_info: 주소·이메일 모두 빈칸이면 택1 안내 + 다음 비활성', async ({ page }) => {
    const s = sfx();
    await gotoForeign(page);

    await page.locator('#sc-name').fill(`f-none-${s}`);
    await typePhone(page, `010${s}22`);
    await page.locator('[data-testid="btn-reserved"]').click();
    await page.locator('[data-testid="btn-visit-new"]').click();
    await page.locator('[data-testid="btn-checkin"]').click();
    await page.waitForTimeout(800);

    await expect(page.locator('[data-testid="addr-email-hint"]')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('[data-testid="addr-email-hint"]')).toHaveText('Please enter at least one: address or email');
    await expect(page.locator('[data-testid="btn-personal-info-next"]')).toBeDisabled();
  });
});

// ── AC-4: 한국어(내국인) 흐름 무회귀 ─────────────────────────────────────────
test.describe('T-20260630 AC-4 한국어 흐름 무회귀', () => {
  test('내국인 초진 personal_info: 주소 빈칸이면 다음 비활성 + 택1 안내 부재(주소 사실상 필수 유지)', async ({ page }) => {
    const s = sfx();
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('#sc-name').fill(`ko-addr-${s}`);
    await typePhone(page, `010${s}33`);
    await page.locator('[data-testid="btn-reserved"]').click();
    await page.locator('[data-testid="btn-visit-new"]').click();
    await page.locator('[data-testid="btn-checkin"]').click();
    await page.waitForTimeout(800);

    // 내국인은 RRN + 주소 필수 → 주소/RRN 빈칸이면 다음 비활성. 외국인 택1 안내는 미노출.
    await expect(page.locator('[data-testid="addr-email-hint"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="btn-personal-info-next"]')).toBeDisabled();
  });
});
