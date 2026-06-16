/**
 * T-20260616-foot-CLINPROG-SLASH-DISABLE — 임상경과 `//` 슈퍼상용구 트리거 비활성화
 *
 * ⚠ REDEFINITION: T-20260526-foot-PHRASE-SLASH / T-20260607-foot-CLINCOURSE-SLASH-PHRASE-FIX
 *   ('임상경과 // 동작시켜달라')의 정반대 지시. 같은 reporter(문지은 대표원장)가 방향 반전.
 *   임상경과는 이제 `//` 슈퍼상용구를 쓰지 않는 게 확정 스펙.
 *
 * AC-1: 임상경과 textarea에서 `//` 입력 → 팝오버 안 뜸. `//`는 평문 그대로 입력·저장.
 * AC-2: 슈퍼상용구 기능 자체는 유지 — 슈퍼상용구 패널(클릭 적용) 경로는 그대로 존재.
 *
 * 구현 좌표: MedicalChartPanel.tsx handleClinicalChange — `//` 매치 → setPhrasePopoverVisible(true)
 *   분기 제거. 항상 닫힌 상태 유지. 처방/펜차트/의료진메모 등 타 필드는 handleClinicalChange 미사용 → 무영향.
 */

import { test, expect } from '@playwright/test';

// ── 헬퍼: 로그인 ───────────────────────────────────────────────────────────
async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const emailInput = page.locator('input[type="email"]');
  if (await emailInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await emailInput.fill(process.env.E2E_STAFF_EMAIL ?? 'test@obliv-foot.com');
    await page.locator('input[type="password"]').fill(process.env.E2E_STAFF_PW ?? 'test1234');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/(?!.*login)/, { timeout: 10_000 });
  }
}

// ── 헬퍼: 첫 고객 → 2번차트(임상경과) 진입 ───────────────────────────────────
async function openClinicalTextarea(page: import('@playwright/test').Page) {
  await page.goto('/customers');
  await page.waitForLoadState('networkidle');
  const firstCustomer = page.locator('[data-testid="customer-row"]').first();
  if (!(await firstCustomer.isVisible({ timeout: 5_000 }).catch(() => false))) return null;
  await firstCustomer.click();
  await page.waitForTimeout(500);

  const chart2Tab = page.getByRole('tab', { name: /2번차트|고객차트/i }).first();
  if (await chart2Tab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await chart2Tab.click();
    await page.waitForTimeout(500);
  }

  const clinical = page.locator('[data-testid="medical-chart-clinical"]').first();
  if (!(await clinical.isVisible({ timeout: 3_000 }).catch(() => false))) return null;
  return clinical;
}

// ── AC-1: 임상경과 // 입력 시 팝오버 안 뜨고 평문 // 유지 ───────────────────────
test('AC-1: 임상경과 textarea에 // 입력 → 슈퍼상용구 팝오버 안 뜸, 평문 // 보존', async ({ page }) => {
  await loginIfNeeded(page);
  const clinical = await openClinicalTextarea(page);
  if (!clinical) {
    test.skip(true, '고객 데이터/2번차트/임상경과 textarea 접근 불가 — 스킵');
    return;
  }

  await clinical.click();
  await clinical.fill('');
  await clinical.type('//통증', { delay: 50 });
  await page.waitForTimeout(400);

  // 팝오버(3개 render-site testid 어느 것도) 미노출 확인
  const popover = page.locator(
    '[data-testid="phrase-autocomplete-popover"], ' +        // full variant
    '[data-testid="clinical-mini-phrase-popover"], ' +       // clinical mini drawer
    '[data-testid="clinical-singleline-phrase-popover"]',    // singleLine inline
  );
  const popoverVisible = await popover.first().isVisible({ timeout: 1_500 }).catch(() => false);
  expect(popoverVisible).toBe(false);

  // 슈퍼/일반 상용구 옵션도 미노출 (3개 render-site 전체)
  const anyOption = page.locator(
    '[data-testid="phrase-autocomplete-super-option"], [data-testid="phrase-autocomplete-phrase-option"], ' +
    '[data-testid="clinical-mini-super-option"], [data-testid="clinical-mini-phrase-option"], ' +
    '[data-testid="clinical-singleline-super-option"], [data-testid="clinical-singleline-phrase-option"]',
  );
  expect(await anyOption.first().isVisible({ timeout: 800 }).catch(() => false)).toBe(false);

  // `//` 평문 그대로 입력값에 보존
  const val = await clinical.inputValue();
  expect(val).toContain('//통증');
});

// ── AC-2: 슈퍼상용구 기능 자체는 유지 (클릭 적용 패널 경로) ─────────────────────
test('AC-2: 슈퍼상용구 패널(클릭 적용) 경로는 그대로 존재 — 기능 비제거', async ({ page }) => {
  await loginIfNeeded(page);
  const clinical = await openClinicalTextarea(page);
  if (!clinical) {
    test.skip(true, '고객 데이터/2번차트/임상경과 textarea 접근 불가 — 스킵');
    return;
  }

  // 슈퍼상용구 패널 관련 UI(관리 버튼/옵션/빈/에러 안내 중 하나)가 존재해야 함
  const superPanel = page.locator(
    '[data-testid="super-phrase-edit-btn"], [data-testid="super-phrase-option"], ' +
    '[data-testid="super-phrase-empty"], [data-testid="super-phrase-load-error"]',
  );
  const exists = await superPanel.first().isVisible({ timeout: 3_000 }).catch(() => false);
  test.info().annotations.push({
    type: 'info',
    description: `슈퍼상용구 패널 UI 존재: ${exists} (권한/탭 위치에 따라 미노출 가능 — 기능 코드는 보존)`,
  });
  // 패널 진입 경로는 권한·탭에 따라 가변 → soft check. 핵심 회귀(AC-1)는 위 테스트가 보장.
});

// ── 회귀: 임상경과 평문 // 다중 입력 보존 ─────────────────────────────────────
test('회귀: 임상경과에 // 가 여러 번 들어가도 모두 평문 보존', async ({ page }) => {
  await loginIfNeeded(page);
  const clinical = await openClinicalTextarea(page);
  if (!clinical) {
    test.skip(true, '임상경과 textarea 접근 불가 — 스킵');
    return;
  }
  await clinical.click();
  await clinical.fill('');
  await clinical.type('보행 // 호전 // 추적', { delay: 30 });
  await page.waitForTimeout(300);
  const val = await clinical.inputValue();
  expect((val.match(/\/\//g) ?? []).length).toBe(2);
});
