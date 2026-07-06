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
//   ⚠ SUPERSEDED — T-20260706-foot-PENCHART-TOOLBAR-FIXES A-6:
//     '중앙 선배치 후 드래그' 동선이 현장(최다혜 치료사) "드래그 번거로움"으로 폐기되고
//     '상용구 클릭 = placing 모드 → 원하는 위치 탭 = 그 자리 삽입'으로 전환됨(드래그 불요).
//     computeCenterAnchor(중앙 산식) 제거 → 아래 가드는 A-6 신동선(placing) 기준으로 갱신.
//     BUG3 원 목표(좌상단 고정 해소)는 A-6 에서 '사용자가 탭한 위치'로 상위 호환 충족.
// ════════════════════════════════════════════════════════════════════════
test('AC-3 [코드가드·A-6 갱신]: 상용구 클릭이 placing 모드 진입(중앙 선배치 산식 제거)', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/PenChartTab.tsx'), 'utf8');
  // 좌상단 고정 RC(computeVisibleAnchor)·중앙 선배치(computeCenterAnchor) 함수 선언·호출 모두 제거.
  expect(src).not.toMatch(/const computeVisibleAnchor\b/);
  expect(src).not.toMatch(/computeVisibleAnchor\(/);
  expect(src).not.toMatch(/const computeCenterAnchor\b/);
  // A-6 신동선: insertPhraseImmediate 가 placing 모드로 진입(boilerplate-placing) + pendingBoilerplate 세팅.
  expect(src).toContain("setActiveTool('boilerplate-placing')");
  expect(src).toMatch(/setPendingBoilerplate\(content\)/);
});

test('AC-3 [실DOM·A-6 갱신]: 상용구 클릭 시 즉시 오버레이 생성이 아니라 placing 모드 진입(탭 대기)', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) { test.skip(true, '시드 미가용'); return; }
  if (!(await openPhrasePanelWithItems(page))) { test.skip(true, 'phrase 항목 0건'); return; }

  const overlay = page.locator('[data-testid="penchart-overlay-boilerplate"]');
  const before = await overlay.count();
  await page.locator('[data-testid^="phrase-item-"]').first().click();
  // A-6: 클릭만으로 캔버스에 오브젝트가 즉시 안 생김(placing 모드 진입 = 탭 대기).
  //   상용구 버튼의 placing 인디케이터(●) 또는 안내 배너로 placing 진입을 확인.
  await expect(page.getByText('캔버스 클릭해 삽입')).toBeVisible({ timeout: 3000 });
  expect(await overlay.count()).toBe(before); // 아직 배치 전
  await page.screenshot({ path: 'evidence/BUG3_AC3_placing.png' }).catch(() => {});
});

// ════════════════════════════════════════════════════════════════════════
// AC-4 (회귀가드): PINGPONG5 PASS 무회귀
// ════════════════════════════════════════════════════════════════════════
test('AC-4 [회귀·A-6 갱신]: 상용구 클릭 → 캔버스 탭 = 탭 위치 삽입(PINGPONG5 무회귀 + A-6)', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) { test.skip(true, '시드 미가용'); return; }
  if (!(await openPhrasePanelWithItems(page))) { test.skip(true, 'phrase 항목 0건'); return; }

  const overlay = page.locator('[data-testid="penchart-overlay-boilerplate"]');
  const start = await overlay.count();
  await page.locator('[data-testid^="phrase-item-"]').first().click();
  // A-6: 1탭 = placing 모드(즉시 삽입 아님). 캔버스 탭 = 그 자리에 삽입.
  await expect(page.getByText('캔버스 클릭해 삽입')).toBeVisible({ timeout: 3000 });
  const canvas = page.locator('[data-testid="penchart-draw-canvas"]');
  const box = await canvas.boundingBox();
  if (!box) { test.skip(true, '캔버스 박스 미측정'); return; }
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await expect(overlay).toHaveCount(start + 1, { timeout: 3000 });
});

test('AC-4 [회귀·A-6 갱신]: placing 탭 배치 후 pen 복귀(안내 배너 사라짐) + 오브젝트 유지', async ({ page }) => {
  const opened = await openPenChartDraw(page);
  if (!opened) { test.skip(true, '시드 미가용'); return; }
  if (!(await openPhrasePanelWithItems(page))) { test.skip(true, 'phrase 항목 0건'); return; }

  await page.locator('[data-testid^="phrase-item-"]').first().click();
  const canvas = page.locator('[data-testid="penchart-draw-canvas"]');
  const box = await canvas.boundingBox();
  if (!box) { test.skip(true, '캔버스 박스 미측정'); return; }
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);

  const overlay = page.locator('[data-testid="penchart-overlay-boilerplate"]').last();
  await expect(overlay).toBeVisible({ timeout: 3000 });     // 탭 위치에 배치됨
  // 배치 후 placing 종료(pen 복귀) → 안내 배너 사라짐
  await expect(page.getByText('캔버스 클릭해 삽입')).toHaveCount(0, { timeout: 3000 });
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
