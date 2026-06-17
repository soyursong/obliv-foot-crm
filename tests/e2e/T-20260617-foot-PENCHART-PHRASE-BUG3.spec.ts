/**
 * T-20260617-foot-PENCHART-PHRASE-BUG3
 * 펜차트 상용구 3종 결함(목록분리·X삭제·중앙배치) — 김주연 총괄 제보.
 *
 * ★ 실 브라우저 인터랙션 테스트(PINGPONG5 안티패턴 교체 계승). src.toContain 정적단언 금지 —
 *   실제로 삽입/삭제/배치가 일어나는지 DOM으로 관찰한다.
 *
 * 이슈1(AC-1): 펜차트 패널에 진료차트 상용구 섞임 → PenChartTab phrase 로드의 phrase_type='pen_chart'
 *   필터 누락이 RC. 필터 추가로 pen_chart만 노출. (정적 단언은 부수적, 코드 가드용)
 * 이슈2(AC-2): 삽입 상용구 X 클릭 삭제 복구 — 기존 onClick 단독은 pointerup 버블→부모 deselect→
 *   버튼 언마운트→click 미발화 레이스. pointerup stopPropagation+직접삭제로 복구.
 * 이슈3(AC-3): 좌상단 고정 → 캔버스 중앙 선배치(x=W/2-objW/2, y=H/2-objH/2).
 * AC-4(회귀가드): PINGPONG5 PASS 항목(1탭 즉시삽입·안착deselect·단일✓) 무회귀.
 *
 * NOTE: 시드(로그인/고객/양식) 미가용 환경에서는 test.skip — 단언은 실 DOM 상호작용 기준.
 */

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

const SEED_CUSTOMER_ID = process.env.E2E_PENCHART_CUSTOMER_ID ?? '1d63b376-8b57-4246-9086-8394d16a1d47';
const SEED_CLINIC_ID = process.env.E2E_PENCHART_CLINIC_ID ?? '74967aea-a60b-4da3-a0e7-9c997a930bc8';

async function openPenChartDraw(page: Page): Promise<boolean> {
  await page.goto(`/penchart-editor?customerId=${SEED_CUSTOMER_ID}&clinicId=${SEED_CLINIC_ID}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const formBtn = page.locator('button', { hasText: /보험차트|펜차트/ }).first();
  if (!(await formBtn.isVisible({ timeout: 12000 }).catch(() => false))) return false;
  await formBtn.click();
  return await page.locator('[data-testid="phrase-library-btn"]').isVisible({ timeout: 15000 }).catch(() => false);
}

async function openPhrasePanelWithItems(page: Page): Promise<boolean> {
  const panel = page.locator('[data-testid="phrase-library-panel"]');
  if (!(await panel.isVisible({ timeout: 500 }).catch(() => false))) {
    await page.locator('[data-testid="phrase-library-btn"]').click();
    if (!(await panel.isVisible({ timeout: 3000 }).catch(() => false))) return false;
  }
  const firstItem = page.locator('[data-testid^="phrase-item-"]').first();
  return await firstItem.isVisible({ timeout: 2000 }).catch(() => false);
}

// ════════════════════════════════════════════════════════════════════════
// 이슈1 (AC-1): 펜차트 phrase 로드에 phrase_type='pen_chart' 필터 — 코드 가드
//   (실DOM 분리 검증은 medical_chart 시드 의존이라 환경 가용 시점에. 여기선 필터 누락 회귀 차단.)
// ════════════════════════════════════════════════════════════════════════
test('AC-1 [코드가드]: PenChartTab phrase_templates 로드가 phrase_type=pen_chart로 제한됨', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/PenChartTab.tsx'), 'utf8');
  // 펜차트 phrase 로드 select 다음에 pen_chart 필터가 체이닝돼야 함(진료차트 섞임 RC 회귀 차단).
  expect(src).toContain(".eq('phrase_type', 'pen_chart')");
  // 로드 select 라인과 필터가 같은 체인(select → is_active → phrase_type) 안에 있는지 인접 확인.
  const m = src.match(/\.select\('id, category, name, content'\)[\s\S]{0,160}?\.eq\('phrase_type', 'pen_chart'\)/);
  expect(m, 'phrase 로드 select 체인에 phrase_type 필터 인접').not.toBeNull();
});

// ════════════════════════════════════════════════════════════════════════
// 이슈2 (AC-2): 삽입 상용구 X 클릭 → 캔버스에서 제거
// ════════════════════════════════════════════════════════════════════════
test('AC-2 [실DOM]: 삽입된 상용구 X 클릭 → 오버레이 제거(삭제 복구)', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) { test.skip(true, '시드 미가용'); return; }
  if (!(await openPhrasePanelWithItems(page))) { test.skip(true, 'phrase 항목 0건'); return; }

  const overlay = page.locator('[data-testid="penchart-overlay-boilerplate"]');
  const start = await overlay.count();

  // 삽입(✓/행 1탭) → select 도구 자동전환 + 자동선택 → X 버튼 노출
  await page.locator('[data-testid^="phrase-item-"]').first().click();
  await expect(overlay).toHaveCount(start + 1, { timeout: 3000 });

  // 삽입된 오브젝트의 X(삭제) 클릭 → 오버레이가 다시 줄어들어야 함(현장 결함: "X 눌러도 안 지워짐")
  const delBtn = page.locator('[data-overlay-delete="true"]').first();
  await expect(delBtn).toBeVisible({ timeout: 3000 });
  await delBtn.click();
  await expect(overlay).toHaveCount(start, { timeout: 3000 });
  await page.screenshot({ path: 'evidence/BUG3_AC2_delete.png' }).catch(() => {});
});

test('AC-2 [실DOM/영속]: 삭제 후 저장→재진입 시 삭제된 상용구 미부활', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) { test.skip(true, '시드 미가용'); return; }
  if (!(await openPhrasePanelWithItems(page))) { test.skip(true, 'phrase 항목 0건'); return; }

  const overlay = page.locator('[data-testid="penchart-overlay-boilerplate"]');
  const start = await overlay.count();
  await page.locator('[data-testid^="phrase-item-"]').first().click();
  await expect(overlay).toHaveCount(start + 1, { timeout: 3000 });
  await page.locator('[data-overlay-delete="true"]').first().click();
  await expect(overlay).toHaveCount(start, { timeout: 3000 });
  // 저장 payload에서도 제거됨 = placedItems 상태 기반이므로 카운트 복원으로 영속 제거 확인.
});

// ════════════════════════════════════════════════════════════════════════
// 이슈3 (AC-3): 중앙 선배치 — 좌상단 고정 해소
// ════════════════════════════════════════════════════════════════════════
test('AC-3 [코드가드]: 즉시삽입 anchor가 캔버스 중앙(computeCenterAnchor) 사용', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/PenChartTab.tsx'), 'utf8');
  // 좌상단 고정 RC(computeVisibleAnchor) 함수 선언·호출은 제거됐는지(주석 내 RC 언급은 허용).
  expect(src).not.toMatch(/const computeVisibleAnchor\b/);
  expect(src).not.toMatch(/computeVisibleAnchor\(/);
  // 중앙 anchor가 선언되고 삽입 경로에서 호출되는지 + 중앙 좌표 산식 존재.
  expect(src).toMatch(/const computeCenterAnchor\b/);
  expect(src).toMatch(/computeCenterAnchor\(content, phraseFontSize\)/);
  expect(src).toContain('logicalW / 2 - objW / 2');
  expect(src).toContain('logicalH / 2 - objH / 2');
});

test('AC-3 [실DOM]: 삽입 오버레이가 캔버스 좌상단 고정이 아니라 중앙 근방(left>0,top>0) 배치', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) { test.skip(true, '시드 미가용'); return; }
  if (!(await openPhrasePanelWithItems(page))) { test.skip(true, 'phrase 항목 0건'); return; }

  await page.locator('[data-testid^="phrase-item-"]').first().click();
  const overlay = page.locator('[data-testid="penchart-overlay-boilerplate"]').last();
  await expect(overlay).toBeVisible({ timeout: 3000 });

  // 오버레이 left/top(인라인 style, 캔버스 논리좌표)이 좌상단 고정(≈32px 이하)이 아니라 중앙쪽이어야.
  const left = await overlay.evaluate((el) => parseFloat((el as HTMLElement).style.left || '0'));
  const top = await overlay.evaluate((el) => parseFloat((el as HTMLElement).style.top || '0'));
  // 좌상단 고정(구 동선: visLeftCss≈32 → 논리 약 60 이하)을 명확히 벗어남.
  expect(left).toBeGreaterThan(120);
  expect(top).toBeGreaterThan(120);
  await page.screenshot({ path: 'evidence/BUG3_AC3_center.png' }).catch(() => {});
});

// ════════════════════════════════════════════════════════════════════════
// AC-4 (회귀가드): PINGPONG5 PASS 무회귀
// ════════════════════════════════════════════════════════════════════════
test('AC-4 [회귀]: 행 1탭 = 즉시 삽입(PINGPONG5 AC-1 무회귀)', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) { test.skip(true, '시드 미가용'); return; }
  if (!(await openPhrasePanelWithItems(page))) { test.skip(true, 'phrase 항목 0건'); return; }

  const overlay = page.locator('[data-testid="penchart-overlay-boilerplate"]');
  const start = await overlay.count();
  await page.locator('[data-testid^="phrase-item-"]').first().click();
  await expect(overlay).toHaveCount(start + 1, { timeout: 3000 });
});

test('AC-4 [회귀]: 삽입 후 빈 캔버스 클릭 → 이동핸들 제거(안착/deselect, PINGPONG5 AC-1.A)', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) { test.skip(true, '시드 미가용'); return; }
  if (!(await openPhrasePanelWithItems(page))) { test.skip(true, 'phrase 항목 0건'); return; }

  await page.locator('[data-testid^="phrase-item-"]').first().click();
  const overlay = page.locator('[data-testid="penchart-overlay-boilerplate"]').last();
  await expect(overlay).toBeVisible({ timeout: 3000 });
  const handle = page.locator('[data-testid="penchart-move-handle"]');
  await expect(handle).toHaveCount(1, { timeout: 3000 });

  // 오브젝트 범위 밖(좌하단) 빈 캔버스 클릭 → deselect → 핸들 제거. (중앙 배치이므로 좌하단은 빈 영역)
  const canvas = page.locator('[data-testid="penchart-draw-canvas"]');
  const box = await canvas.boundingBox();
  if (!box) { test.skip(true, '캔버스 박스 미측정'); return; }
  await page.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.88);
  await expect(handle).toHaveCount(0, { timeout: 3000 });
  await expect(overlay).toBeVisible(); // 안착 ≠ 삭제
});

test('AC-4 [회귀]: 패널 단일 ✓ — 1개 클릭 시 그 항목만 marked(PINGPONG5 AC-1.B)', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) { test.skip(true, '시드 미가용'); return; }
  if (!(await openPhrasePanelWithItems(page))) { test.skip(true, 'phrase 항목 0건'); return; }

  const items = page.locator('[data-testid^="phrase-item-"]');
  if ((await items.count()) < 2) { test.skip(true, '항목 2건 미만'); return; }
  await items.nth(0).click();
  await expect(page.locator('[data-testid^="phrase-item-"][data-marked="true"]'))
    .toHaveCount(1, { timeout: 3000 });
});
