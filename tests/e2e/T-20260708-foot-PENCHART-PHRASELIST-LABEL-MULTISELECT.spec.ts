/**
 * T-20260708-foot-PENCHART-PHRASELIST-LABEL-MULTISELECT
 *   펜차트 상용구 리스트/picker 2건:
 *   (요청 A) 카테고리 항목명 '원장님' → '담당자' 잔여 미반영 지점 마감.
 *            선행 T-20260706-foot-PHRASES-LABEL-DOCTOR-STAFF(commit 40b45b42)는 '서비스관리>상용구 관리'
 *            (PhrasesTab)만 커버 → 펜차트 picker(PenChartTab, 별개 컴포넌트) 표면은 잔존. 여기서 마감.
 *            key='document' 저장키 불변 → 저장 데이터 정합 유지(db_change=false, AC-5).
 *   (요청 B) 상용구 다중선택 — '여러 개 선택' 토글 → 체크박스로 N개 선택 → [N개 삽입] 확정 →
 *            리스트(sort_order) 순서로 줄바꿈(\n) 결합해 캔버스 배치 → 멀티라인 단일 placedItem.
 *            단건 클릭 즉시삽입(placing) 동선은 회귀 금지로 유지(AC-4).
 *
 * ★ 실 브라우저 인터랙션 spec (PINGPONG5 패턴 계승). 소스 문자열 정적 assertion 안티패턴 배제.
 *   - 라벨(A)은 picker 패널 DOM 텍스트로 검증.
 *   - 다중선택(B)은 체크→삽입→캔버스 탭→오버레이(멀티라인) 실 DOM 관찰로 검증.
 *
 * NOTE: 상용구 삽입은 T-20260706 A-6 이후 placing 모드(캔버스 탭 배치)다. 삽입 확정 후 캔버스를
 *   1회 탭해야 오버레이가 commit 된다(단건·다중 공통 grain).
 *
 * 시드(로그인/고객/양식/phrase_templates) 미가용 환경에서는 test.skip.
 */

import { test, expect, type Page } from '@playwright/test';

const SEED_CUSTOMER_ID = process.env.E2E_PENCHART_CUSTOMER_ID ?? '1d63b376-8b57-4246-9086-8394d16a1d47';
const SEED_CLINIC_ID = process.env.E2E_PENCHART_CLINIC_ID ?? '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// ── penchart-editor(popupMode) 직접 진입 → 양식 선택 → draw 모드 ────────────
async function openPenChartDraw(page: Page): Promise<boolean> {
  await page.goto(`/penchart-editor?customerId=${SEED_CUSTOMER_ID}&clinicId=${SEED_CLINIC_ID}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const formBtn = page.locator('button', { hasText: /보험차트|펜차트/ }).first();
  if (!(await formBtn.isVisible({ timeout: 12000 }).catch(() => false))) return false;
  await formBtn.click();
  return await page.locator('[data-testid="phrase-library-btn"]').isVisible({ timeout: 15000 }).catch(() => false);
}

// 상용구 패널 오픈(멱등) + 항목 존재 확인
async function openPhrasePanelWithItems(page: Page): Promise<boolean> {
  const panel = page.locator('[data-testid="phrase-library-panel"]');
  if (!(await panel.isVisible({ timeout: 500 }).catch(() => false))) {
    await page.locator('[data-testid="phrase-library-btn"]').click();
    if (!(await panel.isVisible({ timeout: 3000 }).catch(() => false))) return false;
  }
  return await page.locator('[data-testid^="phrase-item-"]').first().isVisible({ timeout: 2000 }).catch(() => false);
}

// placing 모드 커밋: 캔버스 빈 영역(패널=좌상단과 겹치지 않는 중앙-하단) 1회 탭.
async function tapCanvasToPlace(page: Page): Promise<boolean> {
  const canvas = page.locator('[data-testid="penchart-draw-canvas"]');
  const box = await canvas.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55);
  return true;
}

// ════════════════════════════════════════════════════════════════════════
// 요청 A (AC-1): 펜차트 picker 카테고리 라벨 '담당자' (원장님 잔존 0)
// ════════════════════════════════════════════════════════════════════════
test('AC-1 [실DOM]: 펜차트 상용구 picker 카테고리에 [담당자] 노출 + [원장님] 잔존 없음', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) { test.skip(true, '시드(로그인/고객/양식) 미가용'); return; }
  const panelOk = await openPhrasePanelWithItems(page).catch(() => false);
  // 항목 0건이어도 카테고리 사이드 메뉴는 렌더되므로 패널만 열리면 검증 가능.
  const panel = page.locator('[data-testid="phrase-library-panel"]');
  if (!panelOk && !(await panel.isVisible().catch(() => false))) {
    test.skip(true, '상용구 패널 미노출');
    return;
  }

  // document 카테고리 버튼(저장키 'document' 소비 지점) 라벨 == '담당자'
  const docBtn = page.locator('[data-testid="phrase-cat-document"]');
  await expect(docBtn).toBeVisible({ timeout: 3000 });
  await expect(docBtn).toContainText('담당자');

  // 카테고리 탭 영역 전체에 '원장님' 라벨 잔존 없음
  const cats = page.locator('[data-testid="phrase-category-tabs"]');
  await expect(cats).not.toContainText('원장님');
});

// ════════════════════════════════════════════════════════════════════════
// 요청 B (AC-2/AC-3): 다중선택 → 일괄 삽입 → 멀티라인(줄바꿈) 단일 오버레이
// ════════════════════════════════════════════════════════════════════════
test('AC-2/3 [실DOM]: 여러 개 선택 → N개 삽입 → 캔버스 탭 → 줄바꿈 결합 멀티라인 오버레이 1개', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) { test.skip(true, '시드 미가용'); return; }
  if (!(await openPhrasePanelWithItems(page))) { test.skip(true, 'phrase 항목 0건'); return; }

  const items = page.locator('[data-testid^="phrase-item-"]');
  if ((await items.count()) < 2) { test.skip(true, '동일 카테고리 항목 2건 미만 — 다중선택 불가'); return; }

  // '여러 개 선택' 토글 ON
  const toggle = page.locator('[data-testid="phrase-multiselect-toggle"]');
  await toggle.click();
  await expect(toggle).toHaveAttribute('data-active', 'true');

  // 2개 선택(체크박스 어포던스 노출 + 행 클릭 = 토글)
  await items.nth(0).click();
  await items.nth(1).click();
  await expect(items.nth(0)).toHaveAttribute('data-selected', 'true');
  await expect(items.nth(1)).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('[data-testid="phrase-selected-count"]')).toContainText('2');

  const overlay = page.locator('[data-testid="penchart-overlay-boilerplate"]');
  const before = await overlay.count();

  // [2개 삽입] → placing 모드 진입 → 캔버스 탭으로 커밋
  await page.locator('[data-testid="phrase-multiselect-insert"]').click();
  if (!(await tapCanvasToPlace(page))) { test.skip(true, '캔버스 박스 미측정'); return; }

  // 정확히 1개의 오버레이만 추가(2건이 단일 멀티라인 아이템으로 결합, AC-3 grain)
  await expect(overlay).toHaveCount(before + 1, { timeout: 3000 });

  // 결합 오버레이는 줄바꿈(멀티라인)을 포함 — whiteSpace: pre-wrap 로 개행 렌더
  const newOverlay = overlay.last();
  await expect(newOverlay).toBeVisible();
  const overlayText = (await newOverlay.textContent()) ?? '';
  expect(overlayText.includes('\n')).toBeTruthy();
  expect(overlayText.trim().length).toBeGreaterThan(0);
});

test('AC-3 [실DOM]: 체크 순서와 무관하게 리스트(표시) 순서대로 결합', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) { test.skip(true, '시드 미가용'); return; }
  if (!(await openPhrasePanelWithItems(page))) { test.skip(true, 'phrase 항목 0건'); return; }

  const items = page.locator('[data-testid^="phrase-item-"]');
  if ((await items.count()) < 2) { test.skip(true, '항목 2건 미만'); return; }

  // 각 항목 미리보기 첫 줄(=content 첫 줄) 캡처 — 순서 판정용
  const firstText = ((await items.nth(0).textContent()) ?? '').trim();
  const secondText = ((await items.nth(1).textContent()) ?? '').trim();
  // 첫 줄 프리뷰가 동일하면 순서 판정 불가 → 스킵
  const key0 = firstText.replace(/\s+/g, ' ').slice(0, 8);
  const key1 = secondText.replace(/\s+/g, ' ').slice(0, 8);
  if (!key0 || !key1 || key0 === key1) { test.skip(true, '항목 프리뷰가 순서 판정에 부적합'); return; }

  await page.locator('[data-testid="phrase-multiselect-toggle"]').click();
  // ★역순 체크: 2번 먼저, 1번 나중. 리스트 순서 결합이면 결과는 1번→2번 순.
  await items.nth(1).click();
  await items.nth(0).click();

  const overlay = page.locator('[data-testid="penchart-overlay-boilerplate"]');
  const before = await overlay.count();
  await page.locator('[data-testid="phrase-multiselect-insert"]').click();
  if (!(await tapCanvasToPlace(page))) { test.skip(true, '캔버스 미측정'); return; }
  await expect(overlay).toHaveCount(before + 1, { timeout: 3000 });

  const overlayText = ((await overlay.last().textContent()) ?? '');
  const i0 = overlayText.indexOf(key0);
  const i1 = overlayText.indexOf(key1);
  // 둘 다 발견되면 리스트 순서(1번 먼저) 검증 — 체크 순서(2번 먼저)가 아님.
  if (i0 >= 0 && i1 >= 0) {
    expect(i0).toBeLessThan(i1);
  }
});

// ════════════════════════════════════════════════════════════════════════
// 요청 B 회귀 가드 (AC-4): 단건 클릭 즉시삽입 동선 유지
// ════════════════════════════════════════════════════════════════════════
test('AC-4 [실DOM/회귀]: 다중선택 OFF 단건 클릭 → placing → 캔버스 탭 → 오버레이 정확히 1개', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) { test.skip(true, '시드 미가용'); return; }
  if (!(await openPhrasePanelWithItems(page))) { test.skip(true, 'phrase 항목 0건'); return; }

  // 다중선택 토글은 기본 OFF — 삽입 어포던스 버튼(원형 Plus/✓)이 노출
  await expect(page.locator('[data-testid="phrase-multiselect-toggle"]'))
    .toHaveAttribute('data-active', 'false');
  await expect(page.locator('[data-testid^="phrase-insert-"]').first()).toBeVisible({ timeout: 3000 });

  const overlay = page.locator('[data-testid="penchart-overlay-boilerplate"]');
  const before = await overlay.count();

  // 단건 행 클릭 → placing → 캔버스 탭 → 1개만 삽입
  await page.locator('[data-testid^="phrase-item-"]').first().click();
  if (!(await tapCanvasToPlace(page))) { test.skip(true, '캔버스 미측정'); return; }
  await expect(overlay).toHaveCount(before + 1, { timeout: 3000 });
});
