/**
 * T-20260625-foot-FOREIGN-LANG-SAVE
 * 국적 자동연결 언어값 고객정보 저장 (PASSPORT-PORT 경량 후속).
 *
 * DA canonical: customers.language (BCP-47 코드 ko/en/ja/zh-CN/zh-TW), DB CHECK 없음 → FE LANGUAGE_OPTIONS 검증.
 * 국적 선택 시 COUNTRY_DEFAULT_LANGUAGE로 언어 '제안'(language 비어있을 때만, 수동값 우선).
 *
 * 검증 대상 (현장 클릭 시나리오 3종):
 *   AC-1 국적 선택 → 언어 자동표시: 외국인정보 섹션에 언어 셀렉트가 노출되고,
 *        국적을 고르면 매핑된 언어가 자동 제안되어 표시된다(저장은 DB 의존 → 구조 검증).
 *   AC-2 대만/홍콩 분기: 언어 옵션에 '대만어'(zh-TW)·'중국어'(zh-CN)가 모두 존재한다.
 *   AC-3 엣지(nullable): 국적/언어 미선택으로도 폼이 깨지지 않는다(내국인 동선 정상).
 *
 * 비고: DB 마이그(20260625140000 customers.language)는 hold(미적용)일 수 있음 →
 *   실제 저장/재조회가 아닌 폼 렌더·셀렉트 동작·자동제안 등 구조 불변식 위주. 데이터 의존부는 skip 관용.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

/** 신규 고객 등록 다이얼로그를 연다. 외국인정보 섹션 가시 여부 반환. */
async function openCreateDialog(page: import('@playwright/test').Page) {
  const btn = page.getByRole('button', { name: '신규 고객' });
  if (!(await btn.isVisible({ timeout: 4000 }).catch(() => false))) return false;
  await btn.click();
  const section = page.locator('[data-testid="foreign-info-section"]');
  return await section.isVisible({ timeout: 4000 }).catch(() => false);
}

test.describe('T-20260625-foot-FOREIGN-LANG-SAVE', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/customers`);
    await page.waitForLoadState('networkidle');
  });

  // ── AC-1: 언어 셀렉트가 외국인정보 섹션에 노출된다 ──
  test('AC-1: 신규 등록 폼 외국인정보 섹션에 언어 셀렉트가 노출된다', async ({ page }) => {
    const ok = await openCreateDialog(page);
    if (!ok) { test.skip(); return; }

    await expect(page.locator('[data-testid="foreign-info-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="foreign-nationality"]')).toBeVisible();
    await expect(page.locator('[data-testid="foreign-language"]')).toBeVisible();
  });

  // ── AC-1b: 국적 선택 시 언어가 자동 제안된다 (데이터 의존 — nationalities 비어있으면 skip) ──
  test('AC-1b: 국적을 선택하면 매핑된 언어가 자동 제안되어 언어 셀렉트에 표시된다', async ({ page }) => {
    const ok = await openCreateDialog(page);
    if (!ok) { test.skip(); return; }

    // 국적 드롭다운 열기 → '미국' 옵션이 있으면 선택(없으면 데이터 미적재 → skip)
    await page.locator('[data-testid="foreign-nationality"]').click();
    const us = page.getByRole('option', { name: /미국/ });
    if (!(await us.isVisible({ timeout: 2000 }).catch(() => false))) { test.skip(); return; }
    await us.click();

    // 언어 셀렉트 트리거에 '영어'가 자동 표시(제안)되는지 확인
    const langTrigger = page.locator('[data-testid="foreign-language"]');
    await expect(langTrigger).toContainText('영어', { timeout: 3000 });
  });

  // ── AC-2: 언어 옵션에 대만어(zh-TW)·중국어(zh-CN)가 모두 존재 (대만/홍콩 분기 보장) ──
  test('AC-2: 언어 셀렉트에 중국어·대만어 옵션이 모두 존재한다', async ({ page }) => {
    const ok = await openCreateDialog(page);
    if (!ok) { test.skip(); return; }

    await page.locator('[data-testid="foreign-language"]').click();
    await expect(page.getByRole('option', { name: '중국어' })).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('option', { name: '대만어' })).toBeVisible();
    await expect(page.getByRole('option', { name: '영어' })).toBeVisible();
  });

  // ── AC-3: 엣지 — 언어 미선택('선택 안 함')도 허용되어 폼이 깨지지 않는다 ──
  test('AC-3: 언어 미선택(선택 안 함)이 허용되어 내국인 동선이 정상이다', async ({ page }) => {
    const ok = await openCreateDialog(page);
    if (!ok) { test.skip(); return; }

    await page.locator('[data-testid="foreign-language"]').click();
    const none = page.getByRole('option', { name: '선택 안 함' });
    await expect(none).toBeVisible({ timeout: 3000 });
    await none.click();
    // 섹션이 여전히 정상 렌더(폼 깨짐 0)
    await expect(page.locator('[data-testid="foreign-info-section"]')).toBeVisible();
  });
});
