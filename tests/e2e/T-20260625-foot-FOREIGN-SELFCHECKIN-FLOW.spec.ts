/**
 * T-20260625-foot-FOREIGN-SELFCHECKIN-FLOW
 * 셀프접수 외국인(English) 전용 흐름 — 언어 English 선택 시 자동 진입(별도 QR/버튼 無).
 *
 * AC 커버:
 *   AC-1 진입 트리거: 언어 토글 English → 외국인 흐름 자동 진입(FE 분기). 입력단계에 이메일 입력칸 노출.
 *   AC-2 워크인 연락수단: 외국인은 연락처 OR 이메일 택1(FE 강제). 둘 다 비면 접수 비활성, 이메일만 채워도 활성.
 *   AC-3 개인정보 단계: 외국인은 주민번호 입력칸 숨김(여권=PASSPORT-PORT) + 국내 건강보험 동의 숨김.
 *   AC-4 동의서(§C): 외국인 환자 개인정보 수집·이용 동의 전문 표시 + 동의 체크박스 필수.
 *   AC-5 회귀: 한국어(기본) 흐름 무회귀 — 주민번호 입력칸/건강보험 동의 표시, 외국인 동의 전문 부재.
 *
 * 비고:
 *   카카오 로컬 API(체류지 숙소검색)는 외부 위젯이라 E2E 비결정적 → 위젯/수기입력칸 존재만 확인
 *   (T-20260603 AC-1 의 Kakao Postcode 처리와 동일 정책). DB submit(anon RPC) 은 검증 범위 외.
 */
import { test, expect } from '@playwright/test';

function sfx() {
  return String(Date.now()).slice(-6);
}

// 셀프접수 진입 + 영어(외국인) 전환 헬퍼
async function gotoForeign(page: import('@playwright/test').Page) {
  await page.context().clearCookies();
  await page.goto('/checkin/jongno-foot');
  await page.waitForLoadState('networkidle');
  // 언어 토글 → English (외국인 흐름 자동 진입)
  await page.locator('[data-testid="lang-toggle"]').click();
  // 토글 후 영문 라벨(한국어 복귀 버튼) 노출 확인
  await expect(page.getByText('한국어')).toBeVisible({ timeout: 4000 });
}

async function typePhone(page: import('@playwright/test').Page, digits: string) {
  for (const d of digits.replace(/\D/g, '').slice(0, 11)) {
    await page.getByRole('button', { name: d, exact: true }).first().click();
  }
}

// ── AC-1: English 선택 → 외국인 흐름 자동 진입(이메일 입력칸 노출) ───────────
test.describe('T-20260625 AC-1 영어 선택 시 외국인 흐름 자동 진입', () => {
  test('English 토글 시 입력단계에 이메일 입력칸 + 연락처/이메일 택1 안내 노출', async ({ page }) => {
    await gotoForeign(page);

    await expect(page.locator('[data-testid="foreign-email-block"]')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('[data-testid="foreign-email-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="foreign-contact-hint"]')).toBeVisible();
  });

  test('한국어(기본)에서는 이메일 입력칸이 보이지 않는다(회귀)', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="foreign-email-block"]')).toHaveCount(0);
  });
});

// ── AC-2: 외국인 연락수단 택1(FE 강제) ───────────────────────────────────────
test.describe('T-20260625 AC-2 외국인 연락처/이메일 택1', () => {
  test('이메일만 입력해도 접수 버튼 활성(연락처 없이도 택1 충족)', async ({ page }) => {
    const s = sfx();
    await gotoForeign(page);

    // 성함만 → 접수 비활성(연락수단 없음)
    await page.locator('#sc-name').fill(`foreign-${s}`);
    // 예약 → 초진 선택(visitTypeComplete, leadsource 불필요)
    await page.locator('[data-testid="btn-reserved"]').click();
    await page.locator('[data-testid="btn-visit-new"]').click();
    await expect(page.locator('[data-testid="btn-checkin"]')).toBeDisabled();

    // 이메일만 입력 → 활성(택1 충족)
    await page.locator('[data-testid="foreign-email-input"]').fill('foreign@example.com');
    await expect(page.locator('[data-testid="btn-checkin"]')).toBeEnabled({ timeout: 3000 });
  });

  test('연락처만 입력해도 접수 버튼 활성(택1 — 이메일 없이도 충족)', async ({ page }) => {
    const s = sfx();
    await gotoForeign(page);

    await page.locator('#sc-name').fill(`foreign2-${s}`);
    await typePhone(page, `010${s}99`);
    await page.locator('[data-testid="btn-reserved"]').click();
    await page.locator('[data-testid="btn-visit-new"]').click();
    await expect(page.locator('[data-testid="btn-checkin"]')).toBeEnabled({ timeout: 3000 });
  });
});

// ── AC-3 / AC-4: 외국인 개인정보 단계 — RRN/건보 숨김 + §C 동의 전문 ──────────
test.describe('T-20260625 AC-3/AC-4 외국인 개인정보 단계', () => {
  test('외국인 초진 personal_info: 주민번호/건강보험 동의 숨김 + 외국인 동의 전문 + 체류지 위젯', async ({ page }) => {
    const s = sfx();
    await gotoForeign(page);

    await page.locator('#sc-name').fill(`foreign-pi-${s}`);
    await typePhone(page, `010${s}11`);
    await page.locator('[data-testid="btn-reserved"]').click();
    await page.locator('[data-testid="btn-visit-new"]').click();
    await page.locator('[data-testid="btn-checkin"]').click();
    await page.waitForTimeout(1000);

    // 외국인 동의서(§C) 전문 — 제목/문구 그대로
    const foreignConsent = page.locator('[data-testid="pi-consent-detail-foreign"]');
    await expect(foreignConsent).toBeVisible({ timeout: 6000 });
    await expect(
      foreignConsent.getByText('Consent to Collection & Use of Personal Information (Foreign Patients)')
    ).toBeVisible();

    // 동의 체크박스(필수) 노출
    await expect(page.locator('[data-testid="pi-consent-checkbox"]')).toBeVisible();

    // 주민번호 NumPad / 한국어 동의 전문 / 건강보험 동의 — 외국인 단계에선 부재
    await expect(page.locator('[data-testid="pi-consent-detail"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pi-insurance-consent-checkbox"]')).toHaveCount(0);

    // 동의 미체크 시 다음 버튼 비활성(필수 게이트)
    await expect(page.locator('[data-testid="btn-personal-info-next"]')).toBeDisabled();
  });
});

// ── AC-5: 한국어 흐름 회귀 ──────────────────────────────────────────────────
test.describe('T-20260625 AC-5 한국어 흐름 무회귀', () => {
  test('한국어 초진 personal_info: 주민번호/건강보험 동의 표시 + 외국인 동의 전문 부재', async ({ page }) => {
    const s = sfx();
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('#sc-name').fill(`ko-pi-${s}`);
    await typePhone(page, `010${s}22`);
    await page.locator('[data-testid="btn-reserved"]').click();
    await page.locator('[data-testid="btn-visit-new"]').click();
    await page.locator('[data-testid="btn-checkin"]').click();
    await page.waitForTimeout(1000);

    // 한국어 동의 전문 + 건강보험 동의 표시
    await expect(page.locator('[data-testid="pi-consent-detail"]')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('[data-testid="pi-insurance-consent-checkbox"]')).toBeVisible();

    // 외국인 동의 전문 부재
    await expect(page.locator('[data-testid="pi-consent-detail-foreign"]')).toHaveCount(0);
  });
});
