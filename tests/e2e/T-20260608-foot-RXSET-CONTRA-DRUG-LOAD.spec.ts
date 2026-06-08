/**
 * E2E spec — T-20260608-foot-RXSET-CONTRA-DRUG-LOAD
 *   금기증관리 약품검색 빈 결과 원인 안내(AC-2 빈 상태 정합).
 *   요청: 문지은 대표원장(C0ATE5P6JTH) — "약품검색 처방세트에서 약 불러오기 디비연결안됨"
 *
 * 근본원인(grounding): prescribableDrugs.ts 의 read 경로(prescription_sets.items → prescription_codes)는
 *   정상. 처방세트에 등록된 약이 0건이면 무엇을 검색해도 결과가 비어 "DB연결 안됨"처럼 보이는 것.
 *   → 빈 결과 시 원인 구분 안내 추가: (a)처방세트 출처 없음 / (b)검색 결과 없음. 무DB FE.
 *
 * 검증: 매칭 0건이 보장되는 난수 토큰을 검색 → 빈 드롭다운 대신 안내 메시지가 노출된다
 *   (contra-drug-no-source 또는 contra-drug-no-match 중 하나). 무한 빈 상태 방지.
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';

test('AC-2: 약품검색 빈 결과 시 원인 안내 메시지가 노출된다(빈 드롭다운 방지)', async ({ page }) => {
  const ok = await loginAndWaitForDashboard(page);
  test.skip(!ok, '로그인 실패 — 환경 스킵');

  await page.goto('/doctor-tools');
  const tab = page.getByRole('tab', { name: /금기증/ });
  test.skip((await tab.count()) === 0, '어드민 권한 없거나 금기증관리 탭 미노출 — 환경 스킵');
  await tab.first().click();

  const search = page.locator('[data-testid="contra-drug-search-input"]');
  await expect(search).toBeVisible();

  // 매칭 0건 보장 난수 토큰
  const noMatch = `ZZ존재안함${Date.now().toString().slice(-6)}`;
  await search.fill(noMatch);

  // 빈 결과 안내(출처 없음 OR 결과 없음) 둘 중 하나가 반드시 노출되어야 한다.
  const noSource = page.locator('[data-testid="contra-drug-no-source"]');
  const noMatchMsg = page.locator('[data-testid="contra-drug-no-match"]');
  await expect(noSource.or(noMatchMsg)).toBeVisible({ timeout: 5000 });

  // 빈 결과 드롭다운(결과 행)이 표시되지 않아야 한다(혼동 방지).
  const results = page.locator('[data-testid="contra-drug-result-item"]');
  expect(await results.count()).toBe(0);
});
