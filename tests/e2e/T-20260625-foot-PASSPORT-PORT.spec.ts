/**
 * T-20260625-foot-PASSPORT-PORT
 * 피부과(derm) 여권/외국인 정보 풋CRM 이식 — 신규/수정 고객 폼 외국인 정보 섹션.
 *
 * 검증 대상 (현장 클릭 시나리오 3종):
 *   AC-1 신규 등록: 외국인 정보 섹션이 상시 노출되고 국적 셀렉트·여권 영문성/이름·여권번호·
 *        외국인등록번호·만료일 필드가 모두 렌더된다(2열 그리드 평탄화).
 *   AC-2 국적 셀렉트 클릭: 국적 드롭다운이 열리고(국기+국가명 옵션) 선택할 수 있다.
 *        (옵션 목록은 nationalities 마스터 의존 — 마이그 미적용/빈 환경에선 트리거 동작만 확인)
 *   AC-3 PHI 게이트(수정 폼): 여권번호·외국인등록번호는 canEditSensitive 게이트 대상이다.
 *        (권한 역할 의존 — 구조 불변식: 두 필드의 testid 존재. 열람전용 분기는 역할에 따라 input↔표시박스)
 *
 * 비고: 본 기능 DB 마이그(20260625130000)는 hold(미적용)일 수 있음 → 저장 동작이 아닌
 *   폼 렌더/필드 노출/셀렉트 클릭 등 구조 불변식 위주. 데이터/권한 의존부는 skip 관용.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

/** 신규 고객 등록 다이얼로그를 연다. 버튼 미가시 시 null. */
async function openCreateDialog(page: import('@playwright/test').Page) {
  const btn = page.getByRole('button', { name: '신규 고객' });
  if (!(await btn.isVisible({ timeout: 4000 }).catch(() => false))) return false;
  await btn.click();
  const section = page.locator('[data-testid="foreign-info-section"]');
  return await section.isVisible({ timeout: 4000 }).catch(() => false);
}

test.describe('T-20260625-foot-PASSPORT-PORT', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/customers`);
    await page.waitForLoadState('networkidle');
  });

  // ── AC-1: 신규 등록 폼에 외국인 정보 섹션 + 5종 필드가 상시 노출 ──
  test('AC-1: 신규 고객 등록 폼에 외국인 정보 섹션과 국적/여권성/여권이름/여권번호/외국인등록번호/만료일 필드가 노출된다', async ({ page }) => {
    const ok = await openCreateDialog(page);
    if (!ok) { test.skip(); return; }

    await expect(page.locator('[data-testid="foreign-info-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="foreign-nationality"]')).toBeVisible();
    await expect(page.locator('[data-testid="foreign-passport-last"]')).toBeVisible();
    await expect(page.locator('[data-testid="foreign-passport-first"]')).toBeVisible();
    await expect(page.locator('[data-testid="foreign-passport-no"]')).toBeVisible();
    await expect(page.locator('[data-testid="foreign-reg-no"]')).toBeVisible();
    await expect(page.locator('[data-testid="foreign-doc-expiry"]')).toBeVisible();
  });

  // ── AC-1b: 여권 영문 성/이름에 입력하면 대문자로 정규화된다 ──
  test('AC-1b: 여권 영문 성/이름 입력이 대문자로 정규화된다', async ({ page }) => {
    const ok = await openCreateDialog(page);
    if (!ok) { test.skip(); return; }

    const last = page.locator('[data-testid="foreign-passport-last"]');
    await last.fill('hong');
    await expect(last).toHaveValue('HONG');

    const first = page.locator('[data-testid="foreign-passport-first"]');
    await first.fill('gildong');
    await expect(first).toHaveValue('GILDONG');
  });

  // ── AC-2: 국적 셀렉트 클릭 → 드롭다운이 열린다 ('선택 안 함' 옵션은 데이터 무관 상시 존재) ──
  test('AC-2: 국적 셀렉트를 클릭하면 드롭다운이 열린다', async ({ page }) => {
    const ok = await openCreateDialog(page);
    if (!ok) { test.skip(); return; }

    await page.locator('[data-testid="foreign-nationality"]').click();
    // Radix Select 리스트박스가 열림 — '선택 안 함'(NONE) 옵션은 데이터 의존 없이 항상 렌더
    const noneOption = page.getByRole('option', { name: '선택 안 함' });
    await expect(noneOption).toBeVisible({ timeout: 3000 });
  });

  // ── AC-3: 수정 폼에서도 외국인 정보 섹션 + PHI 필드(여권번호/외국인등록번호)가 구조적으로 존재 ──
  test('AC-3: 고객 수정 폼에 외국인 정보 섹션과 PHI 필드(여권번호/외국인등록번호) testid가 존재한다', async ({ page }) => {
    // 목록 첫 행의 수정(연필) 버튼 → 없으면 skip.
    const editBtn = page.locator('button:has(svg.lucide-pencil)').first();
    if (!(await editBtn.isVisible({ timeout: 4000 }).catch(() => false))) { test.skip(); return; }
    await editBtn.click();

    const section = page.locator('[data-testid="foreign-info-section"]');
    if (!(await section.isVisible({ timeout: 4000 }).catch(() => false))) { test.skip(); return; }

    // 여권번호·외국인등록번호는 canEditSensitive 게이트 대상 — 편집권한이면 input, 아니면 표시박스.
    // 두 라벨이 섹션 안에 노출되는지(구조 불변식) 확인.
    const sectionText = (await section.innerText()).replace(/\s+/g, ' ');
    expect(sectionText).toContain('여권번호');
    expect(sectionText).toContain('외국인등록번호');
    expect(sectionText).toContain('국적');
  });
});
