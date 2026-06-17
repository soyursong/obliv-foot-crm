/**
 * T-20260617-foot-PENCHART-PHRASE-PANEL-3FIX
 * 펜차트 상용구 패널 3결함 재보고(김주연 총괄) — PINGPONG6 surface.
 *
 * ★ 타임라인: 본 티켓 제보(6/17 20:06)는 BUG3 커밋(6/17 20:22)보다 16분 빠름.
 *   → 현장은 BUG3 이전 빌드를 테스트. BUG3가 이슈2(이벤트 레이스)·이슈3(중앙배치)을 旣수정.
 *   본 티켓은 그 위에서 (a)이슈1 RC 재판정, (b)이슈2 갤탭 터치 타깃 하드닝, (c)이슈3 무회귀 검증.
 *
 * 이슈1(AC-1) 판정: **데이터 RC, 코드 결함 아님.**
 *   진단(scripts/..._diag.mjs): phrase_templates 34행 중 33행이 phrase_type='pen_chart',
 *   medical_chart는 단 1행. 현장이 빼고 싶어하는 처방(prescription 13건)·재진/초진(charting)이
 *   전부 pen_chart 라벨 → BUG3의 .eq('phrase_type','pen_chart') 필터로는 분리 불가
 *   (분리 식별자 VALUE가 데이터에 없음). → supervisor DB게이트 승격 + planner FOLLOWUP.
 *   코드는 旣배포 split 식별자(phrase_type) 재사용 상태 유지(회귀 차단만 가드).
 *
 * 이슈2(AC-2) 하드닝: 삭제 X 터치 타깃 18px→30px (갤탭 손가락 신뢰성). 이벤트 경로 불변.
 * 이슈3(AC-3) 무회귀: computeCenterAnchor(logical W/2 - objW/2) + 이중 rAF scrollIntoView 유지.
 *
 * NOTE: 시드(로그인/고객/양식) 미가용 환경에서는 인터랙션 test.skip — 코드 가드는 항상 PASS.
 *   최종 닫힘 = 갤탭 실기기 3건 재현→재확인(supervisor field-soak). green build/spec ≠ 종결.
 */

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(process.cwd(), 'src/components/PenChartTab.tsx'), 'utf8');
const SEED_CUSTOMER_ID = process.env.E2E_PENCHART_CUSTOMER_ID ?? '1d63b376-8b57-4246-9086-8394d16a1d47';
const SEED_CLINIC_ID = process.env.E2E_PENCHART_CLINIC_ID ?? '74967aea-a60b-4da3-a0e7-9c997a930bc8';

// ════════════════════════════════════════════════════════════════════════
// 이슈1 (AC-1) [코드가드]: 旣배포 split 식별자(phrase_type) 재사용 — 새 분리모델 금지 확인.
//   데이터 분리는 DB 게이트(코드 외). 여기서는 필터 누락 회귀 + 모델 중복 생성 차단.
// ════════════════════════════════════════════════════════════════════════
test('AC-1 [코드가드]: 펜차트 phrase 로드가 旣배포 split 식별자 phrase_type=pen_chart 재사용', () => {
  const loadMatch = SRC.match(/from\('phrase_templates'\)[\s\S]{0,260}?\.then/);
  expect(loadMatch, 'phrase_templates 로드 블록 존재').not.toBeNull();
  const block = loadMatch![0];
  expect(block, "旣배포 split 식별자 .eq('phrase_type','pen_chart') 재사용").toMatch(
    /\.eq\(\s*['"]phrase_type['"]\s*,\s*['"]pen_chart['"]\s*\)/,
  );
  // 새 분리 컬럼/모델을 임의로 만들지 않았는지(scope/pen_only 등 신규 식별자 미도입) 가드
  expect(SRC).not.toMatch(/\.eq\(\s*['"](scope|pen_only|chart_kind)['"]/);
});

// ════════════════════════════════════════════════════════════════════════
// 이슈2 (AC-2) [코드가드]: 삭제 X 터치 타깃 하드닝 + 이벤트 경로 보존.
// ════════════════════════════════════════════════════════════════════════
test('AC-2 [코드가드]: 삭제 X 터치 타깃 ≥30px + onPointerUp 직접삭제 경로 유지', () => {
  // 삭제 버튼 블록 추출 (data-overlay-delete 마커 기준)
  const delBlock = SRC.match(/data-overlay-delete="true"[\s\S]{0,900}?title="삭제"/);
  expect(delBlock, '삭제 버튼 블록 존재').not.toBeNull();
  const b = delBlock![0];
  // 터치 타깃 30px (18px 회귀 차단)
  expect(b, 'width 30px 하드닝').toMatch(/width:\s*30\b/);
  expect(b, 'height 30px 하드닝').toMatch(/height:\s*30\b/);
  // 이벤트 경로 불변: pointerup에서 직접 onDelete + stopPropagation
  expect(b).toMatch(/onPointerUp=\{\(e\)\s*=>\s*\{\s*e\.stopPropagation\(\);\s*onDelete\(item\.id\)/);
  expect(b).toMatch(/onPointerDown=\{\(e\)\s*=>\s*e\.stopPropagation\(\)\}/);
});

// ════════════════════════════════════════════════════════════════════════
// 이슈3 (AC-3) [코드가드/무회귀]: 중앙 선배치 + 드래그 이동 보존.
// ════════════════════════════════════════════════════════════════════════
test('AC-3 [코드가드]: 즉시삽입이 computeCenterAnchor(중앙) 경유 + 드래그 onMove 보존', () => {
  // 즉시삽입이 좌상단(computeVisibleAnchor) 회귀로 되돌아가지 않음 — 정의·호출 부재 가드
  //   (주석에는 RC 설명상 식별자명이 남을 수 있어 '정의/호출' 패턴만 차단)
  expect(SRC, 'computeVisibleAnchor 정의 부재').not.toMatch(/const\s+computeVisibleAnchor/);
  expect(SRC, 'computeVisibleAnchor 호출 부재').not.toMatch(/=\s*computeVisibleAnchor\(/);
  expect(SRC).toMatch(/const\s*\{\s*x,\s*y\s*\}\s*=\s*computeCenterAnchor\(/);
  // computeCenterAnchor 가 논리 중앙(W/2 - objW/2) 계산 (정의 존재 + 중앙 산식)
  expect(SRC, 'computeCenterAnchor 정의 존재').toMatch(/const computeCenterAnchor\s*=\s*\(/);
  expect(SRC, 'x 중앙 산식').toMatch(/logicalW\s*\/\s*2\s*-\s*objW\s*\/\s*2/);
  expect(SRC, 'y 중앙 산식').toMatch(/logicalH\s*\/\s*2\s*-\s*objH\s*\/\s*2/);
  // 드래그 이동 동작 보존(onMove → placedItems x/y 갱신)
  expect(SRC).toMatch(/onMove=\{\(id,\s*dx,\s*dy\)\s*=>/);
  expect(SRC).toMatch(/it\.id === id \? \{ \.\.\.it, x: it\.x \+ dx, y: it\.y \+ dy \}/);
});

// ════════════════════════════════════════════════════════════════════════
// 실 DOM 인터랙션 (시드 가용 시) — 삭제 X 탭으로 오버레이 제거 확인.
//   최종 신뢰 근거는 갤탭 실기기(supervisor field-soak). 여기선 데스크톱 pointer 회귀만.
// ════════════════════════════════════════════════════════════════════════
async function openPenChartDraw(page: Page): Promise<boolean> {
  await page.goto(`/penchart-editor?customerId=${SEED_CUSTOMER_ID}&clinicId=${SEED_CLINIC_ID}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const formBtn = page.locator('button', { hasText: /보험차트|펜차트/ }).first();
  if (!(await formBtn.isVisible({ timeout: 12000 }).catch(() => false))) return false;
  await formBtn.click();
  return await page.locator('[data-testid="phrase-library-btn"]').isVisible({ timeout: 15000 }).catch(() => false);
}

test('AC-2 [실DOM]: 상용구 삽입 후 X 탭 시 오버레이 제거 (시드 가용 시)', async ({ page }) => {
  const ready = await openPenChartDraw(page);
  test.skip(!ready, '펜차트 draw 시드 미가용 — 코드가드로 대체');

  // 패널 열고 첫 상용구 즉시삽입
  await page.locator('[data-testid="phrase-library-btn"]').click().catch(() => {});
  const firstItem = page.locator('[data-testid^="phrase-item-"]').first();
  if (!(await firstItem.isVisible({ timeout: 3000 }).catch(() => false))) test.skip(true, '상용구 시드 없음');
  await firstItem.click();

  // 오버레이 생성 확인
  const overlay = page.locator('[data-testid="penchart-overlay-boilerplate"]').first();
  await expect(overlay).toBeVisible({ timeout: 5000 });

  // 삽입 후 select 도구 자동전환 + 자동선택 → 삭제 버튼 노출
  const delBtn = page.locator('[data-overlay-delete="true"]').first();
  await expect(delBtn).toBeVisible({ timeout: 3000 });

  const before = await page.locator('[data-testid="penchart-overlay-boilerplate"]').count();
  await delBtn.click();
  await expect
    .poll(() => page.locator('[data-testid="penchart-overlay-boilerplate"]').count())
    .toBe(before - 1);
});
