/**
 * E2E spec — T-20260608-foot-PHRASE-PEN-MED-SPLIT
 *   상용구 펜차트/진료차트 분리 — 좌측 카테고리 카운트가 활성 phrase_type 기준으로 산출되는지.
 *   요청: 문지은 대표원장(C0ATE5P6JTH) — "진료차트 탭 눌러도 하단 카운트가 전체(펜차트 포함)"
 *
 * 근본원인(grounding): phrase_type 컬럼은 이미 존재(20260526210000_phrase_type.sql, pen_chart|medical_chart).
 *   표시 리스트는 phrase_type 필터를 반영하나, 좌측 카테고리 사이드바 카운트(PhrasesTab.tsx)만
 *   필터 미반영 → 전체수 표기 버그. 무DB FE 수정.
 *
 * 검증: 상용구 관리에서 phrase_type 세그먼트(전체/펜차트/진료차트) 전환 시 좌측 '전체' 카운트가
 *   상단 세그먼트 카운트와 일치한다(= 좌측 카운트가 phrase_type를 반영).
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

async function gotoPhrasesTab(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto('/doctor-tools');
  const tab = page.getByRole('tab', { name: /상용구/ });
  if ((await tab.count()) === 0) return false;
  await tab.first().click();
  // 사이드 메뉴 레이아웃 렌더 대기
  const layout = page.locator('[data-testid="phrase-side-menu-layout"]');
  if ((await layout.count()) === 0) return false;
  await expect(layout.first()).toBeVisible();
  return true;
}

// 좌측 '전체' 카테고리 버튼의 카운트 숫자를 읽는다.
async function readAllCatCount(page: import('@playwright/test').Page): Promise<number> {
  const allBtn = page.locator('[data-testid="phrase-cat-btn-all"]');
  const txt = (await allBtn.innerText()).replace(/[^0-9]/g, '');
  return Number(txt || '0');
}

// 상단 phrase_type 세그먼트 버튼의 카운트 숫자를 읽는다.
async function readTypeSegCount(page: import('@playwright/test').Page, type: string): Promise<number> {
  const btn = page.locator(`[data-testid="phrase-type-filter-${type}"]`);
  const txt = (await btn.innerText()).replace(/[^0-9]/g, '');
  return Number(txt || '0');
}

test('AC-2/3: 좌측 카테고리 "전체" 카운트가 활성 phrase_type 기준으로 산출된다', async ({ page }) => {
  const ok = await loginAndWaitForDashboard(page);
  test.skip(!ok, '로그인 실패 — 환경 스킵');
  const entered = await gotoPhrasesTab(page);
  test.skip(!entered, '어드민 권한 없거나 상용구 탭 미노출 — 환경 스킵');

  // 진료차트(medical_chart) 세그먼트 선택
  await page.locator('[data-testid="phrase-type-filter-medical_chart"]').click();
  const medSegCount = await readTypeSegCount(page, 'medical_chart');
  const leftAllWhenMed = await readAllCatCount(page);
  // 핵심 회귀 가드: 좌측 '전체' 카운트 == 진료차트 세그먼트 카운트(펜차트 미포함)
  expect(leftAllWhenMed).toBe(medSegCount);

  // 펜차트(pen_chart) 세그먼트로 전환 시에도 좌측 카운트가 따라 변한다
  await page.locator('[data-testid="phrase-type-filter-pen_chart"]').click();
  const penSegCount = await readTypeSegCount(page, 'pen_chart');
  const leftAllWhenPen = await readAllCatCount(page);
  expect(leftAllWhenPen).toBe(penSegCount);

  // '전체' 세그먼트면 좌측 '전체'는 총합
  await page.locator('[data-testid="phrase-type-filter-all"]').click();
  const allSegCount = await readTypeSegCount(page, 'all');
  const leftAllWhenAll = await readAllCatCount(page);
  expect(leftAllWhenAll).toBe(allSegCount);
});
