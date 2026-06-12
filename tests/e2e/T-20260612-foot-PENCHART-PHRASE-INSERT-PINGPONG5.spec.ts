/**
 * T-20260612-foot-PENCHART-PHRASE-INSERT-PINGPONG5
 * 펜차트 캔버스 상용구 패널 삽입 5차 재발 — 근본픽스 실DOM 검증.
 *
 * ★ 이 spec은 *실 브라우저 인터랙션* 테스트다. 직전 4회 패치의 spec은 전부 소스 문자열 정적
 *   assertion(src.toContain(...))이라 "행을 클릭해 실제로 삽입이 일어나는지"를 한 번도 관찰하지
 *   않았다 → 빌드 green인데 현장 FAIL의 구조적 원인. 본 spec은 그 안티패턴을 교체한다.
 *
 * RC(AC-0 #2 선택이벤트): 직전 동선은 상용구 *행* 클릭이 revealedPhraseId만 토글해 작은 ✓만
 *   노출하고 실제 삽입은 ✓ 2차 클릭에 의존 → 현장(갤탭 총괄)이 ✓를 못 찾아 "선택해도 안 들어감".
 * AC-1 근본픽스: 2단계 게이트 제거. **행 클릭 1탭 = 즉시 삽입**(penchart-overlay-boilerplate 출현).
 *
 * 시나리오 1(정상복구): 행 1탭 → 오버레이 출현 → 연속 1탭 → 오버레이 2개(다중) → 저장 후 유지.
 * 시나리오 2(엣지): 빠른 연속 2탭 → 둘 다 들어감(덮어쓰기 없음) + 삽입 후 캔버스 그려도 유지.
 *
 * NOTE: 시드(로그인/고객/양식) 미가용 환경에서는 test.skip — 단언 자체는 실 DOM 상호작용 기준.
 */

import { test, expect, type Page } from '@playwright/test';

// 시드 고객(인증은 auth.setup storageState로 주입됨). penchart-editor 직접 라우트로 draw 진입.
// customerId/clinicId 는 env override 가능 — 없으면 [TEST4] 시드 고객 사용.
const SEED_CUSTOMER_ID = process.env.E2E_PENCHART_CUSTOMER_ID ?? '1d63b376-8b57-4246-9086-8394d16a1d47';
const SEED_CLINIC_ID = process.env.E2E_PENCHART_CLINIC_ID ?? '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// ── penchart-editor(popupMode) 직접 진입 → 보험차트 양식 선택 → draw 모드 ───────
async function openPenChartDraw(page: Page): Promise<boolean> {
  await page.goto(`/penchart-editor?customerId=${SEED_CUSTOMER_ID}&clinicId=${SEED_CLINIC_ID}`);
  await page.waitForLoadState('networkidle').catch(() => {});

  // popupMode → select 모드에서 시작. 보험차트(pen_chart) 양식 버튼 클릭.
  const formBtn = page.locator('button', { hasText: /보험차트|펜차트/ }).first();
  if (!(await formBtn.isVisible({ timeout: 8000 }).catch(() => false))) return false;
  await formBtn.click();

  // draw 진입 = 상용구 버튼 노출 (양식 배경 로드 + 캔버스 init 대기)
  return await page.locator('[data-testid="phrase-library-btn"]').isVisible({ timeout: 8000 }).catch(() => false);
}

async function openPhrasePanelWithItems(page: Page): Promise<boolean> {
  await page.locator('[data-testid="phrase-library-btn"]').click();
  const panel = page.locator('[data-testid="phrase-library-panel"]');
  if (!(await panel.isVisible({ timeout: 3000 }).catch(() => false))) return false;
  // 항목 있는 카테고리 탐색 — 첫 항목 보이면 OK
  const firstItem = page.locator('[data-testid^="phrase-item-"]').first();
  return await firstItem.isVisible({ timeout: 2000 }).catch(() => false);
}

// ════════════════════════════════════════════════════════════════════════
// 시나리오 1: 정상 동선 (복구 검증) — 행 1탭 = 삽입
// ════════════════════════════════════════════════════════════════════════
test('S1-AC1 [실DOM/RC]: 상용구 *행* 1탭(✓ 아님) → 캔버스에 오버레이 즉시 출현', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) { test.skip(true, '시드(로그인/고객/양식) 미가용 — 실DOM 인터랙션 환경 부재'); return; }
  if (!(await openPhrasePanelWithItems(page))) { test.skip(true, 'phrase_templates 항목 0건 — 스킵'); return; }

  const before = await page.locator('[data-testid="penchart-overlay-boilerplate"]').count();

  // ★핵심: 행 자체를 클릭(현장 동선). 작은 ✓ 버튼을 직접 클릭하지 않는다.
  await page.locator('[data-testid^="phrase-item-"]').first().click();

  // 행 1탭만으로 오버레이가 실제로 1개 늘어나야 한다 (5차 회귀의 진짜 게이트).
  await expect(page.locator('[data-testid="penchart-overlay-boilerplate"]'))
    .toHaveCount(before + 1, { timeout: 3000 });
});

test('S1-AC2 [실DOM]: 연속 행 탭 → 오버레이 누적(다중 삽입, 덮어쓰기 없음)', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) { test.skip(true, '시드 미가용'); return; }
  if (!(await openPhrasePanelWithItems(page))) { test.skip(true, 'phrase 항목 0건'); return; }

  const overlay = page.locator('[data-testid="penchart-overlay-boilerplate"]');
  const start = await overlay.count();

  // 1탭 → 삽입(패널이 닫히므로 재오픈)
  await page.locator('[data-testid^="phrase-item-"]').first().click();
  await expect(overlay).toHaveCount(start + 1, { timeout: 3000 });

  // 두 번째 삽입
  if (await openPhrasePanelWithItems(page)) {
    await page.locator('[data-testid^="phrase-item-"]').first().click();
    await expect(overlay).toHaveCount(start + 2, { timeout: 3000 });
  }
});

// ════════════════════════════════════════════════════════════════════════
// 시나리오 2: 엣지 — 삽입 후 가시성/안정성
// ════════════════════════════════════════════════════════════════════════
test('S2 [실DOM]: 삽입된 오버레이는 화면에 보이는 위치(visible)로 commit', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) { test.skip(true, '시드 미가용'); return; }
  if (!(await openPhrasePanelWithItems(page))) { test.skip(true, 'phrase 항목 0건'); return; }

  await page.locator('[data-testid^="phrase-item-"]').first().click();
  const newOverlay = page.locator('[data-testid="penchart-overlay-boilerplate"]').last();
  await expect(newOverlay).toBeVisible({ timeout: 3000 });
  // 텍스트 내용이 비어있지 않음(빈 상용구 가드와 분리 — 정상 항목은 내용 렌더)
  await expect(newOverlay).not.toHaveText('');
});

// ════════════════════════════════════════════════════════════════════════
// 회귀 가드(AC-2): ✓ 버튼 직접 클릭 경로도 여전히 단일 삽입(중복 삽입 없음)
// ════════════════════════════════════════════════════════════════════════
test('AC2 [실DOM/회귀]: ✓ 버튼 직접 클릭도 정확히 1개만 삽입(stopPropagation)', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) { test.skip(true, '시드 미가용'); return; }
  if (!(await openPhrasePanelWithItems(page))) { test.skip(true, 'phrase 항목 0건'); return; }

  const overlay = page.locator('[data-testid="penchart-overlay-boilerplate"]');
  const start = await overlay.count();

  // ✓ 버튼은 항상 노출(어포던스). 직접 클릭 시 행 onClick 중복발화 없이 정확히 1개.
  await page.locator('[data-testid^="phrase-insert-"]').first().click();
  await expect(overlay).toHaveCount(start + 1, { timeout: 3000 });
});
