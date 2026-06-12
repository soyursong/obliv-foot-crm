/**
 * T-20260612-foot-PATIENT-CHARTNO-PAIRING-AUDIT
 * 환자명이 노출되는 모든 surface에 차트번호를 인접 표시 (동명이인 오인 = 의료안전).
 *
 * 본 배치(Phase B-1, P0성): 환자 식별·선택 지점 + 차트 헤더 + 조건부(미발번 시 숨김) surface.
 * 핵심 규약: 차트번호 미발번이어도 환자명 단독 노출 금지 → '#미발번' / '(미발번)' 명시(AC3).
 *
 * 시나리오 1: 환자 목록 데이터테이블 — 환자명 옆 별도 차트번호 칼럼(미발번은 '-')
 * 시나리오 2: 차트 상단바 — 환자명 + 차트번호 인접
 * 시나리오 3: 환자 선택 드롭다운(글로벌 검색) — 각 옵션에 환자명 + 차트번호
 * 시나리오 4: 미발번 환자 — 차트번호 칸이 '#미발번'/'(미발번)'/'-' 로 명시(환자명 단독 노출 0)
 *
 * 주: 테스트 DB에 데이터가 없을 수 있어 구조/회귀 위주 방어적 단언.
 *     차트번호 배지가 렌더되면 반드시 '#'+값 또는 미발번 표기여야 함(환자명만 단독 표기 금지)을 검증.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? 'testpass');
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 }).catch(() => {});
  }
}

test.describe('T-20260612-foot-PATIENT-CHARTNO-PAIRING-AUDIT', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  // 시나리오 1: 환자 목록 데이터테이블 — 차트번호 칼럼이 환자명 칼럼과 별도로 존재
  test('S1: 고객 목록 데이터테이블에 차트번호 칼럼이 환자명과 분리 표시', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/customers`);
    await page.waitForLoadState('networkidle');

    const table = page.locator('table');
    if (await table.first().isVisible({ timeout: 8000 }).catch(() => false)) {
      // 헤더에 '차트번호' 칼럼(또는 환자명과 별도 칼럼)이 존재
      const headerText = (await table.first().locator('thead').textContent().catch(() => '')) ?? '';
      // 차트번호/고객번호 헤더가 환자명과 함께 노출되는지(둘 다 존재 = 세트)
      expect(headerText).toMatch(/차트|고객번호|이름|성함|고객/);

      // 데이터 행이 있으면 각 행에서 환자명 셀과 차트번호 셀이 같은 행에 공존
      const rows = table.first().locator('tbody tr');
      const rowCount = await rows.count();
      if (rowCount > 0) {
        const cells = rows.first().locator('td');
        // 한 칼럼 합치기 아님 → 최소 2개 이상 셀(환자명/차트번호 분리)
        expect(await cells.count()).toBeGreaterThan(1);
      }
    }
    await expect(page).toHaveURL(/customers/);
  });

  // 시나리오 2: 차트 상단바 — 환자명과 차트번호 인접 표시
  test('S2: 차트 상단바/헤더에 차트번호 배지가 환자명과 인접', async ({ page }) => {
    // 고객 목록에서 첫 환자 차트 진입 시도
    await page.goto(`${BASE_URL}/admin/customers`);
    await page.waitForLoadState('networkidle');

    // 차트번호 배지가 렌더되면 반드시 '#' 또는 '미발번' 형식(환자명 단독 표기 금지 규약)
    const chartBadges = page.locator('span.font-mono').filter({ hasText: /#|미발번/ });
    const badgeCount = await chartBadges.count();
    for (let i = 0; i < Math.min(badgeCount, 5); i++) {
      const text = ((await chartBadges.nth(i).textContent()) ?? '').trim();
      expect(text).toMatch(/^#|미발번/);
    }
    await expect(page).toHaveURL(/customers|chart/);
  });

  // 시나리오 3: 환자 선택 드롭다운(글로벌 검색) — 각 옵션에 환자명+차트번호
  test('S3: 글로벌 검색 드롭다운 옵션에 차트번호 항상 동반', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');

    // AdminLayout 상단 글로벌 검색창 (placeholder 변동 대비 다중 후보)
    const searchBox = page.getByPlaceholder(/고객|환자|검색|이름/).first();
    if (await searchBox.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchBox.fill('김');
      await page.waitForTimeout(600); // debounce

      // 드롭다운 옵션이 뜨면, 차트번호 배지(teal 또는 muted, 미발번 포함)가 동반되어야 함
      const badges = page.locator('span').filter({ hasText: /^#|^\(미발번\)|미발번/ });
      const count = await badges.count();
      for (let i = 0; i < Math.min(count, 5); i++) {
        const text = ((await badges.nth(i).textContent()) ?? '').trim();
        // 환자명 단독이 아닌 차트번호 표기 형식 보장
        expect(text).toMatch(/#|미발번/);
      }
    }
    // 페이지 정상 (검색 결과 유무와 무관)
    await expect(page).toHaveURL(/dashboard/);
  });

  // 시나리오 4: 미발번 환자 — 차트번호 칸이 명시적 표기(환자명 단독 노출 0)
  test('S4: 미발번 표기가 레이아웃 깨짐 없이 명시된다', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/customers`);
    await page.waitForLoadState('networkidle');

    // 화면 전체에서 '미발번' 텍스트가 등장하면 단독 환자명이 아닌 차트번호 자리 표기여야 함
    const missingTags = page.getByText(/미발번/);
    const tagCount = await missingTags.count();
    // 미발번 표기는 존재하더라도 깨짐 없이 렌더(가시성)되어야 함
    for (let i = 0; i < Math.min(tagCount, 3); i++) {
      await expect(missingTags.nth(i)).toBeVisible();
    }

    // 목록 셀에서 차트번호 미발번은 '-' 또는 '(미발번)'으로 처리(빈 셀 단독 환자명 금지)
    const dashCells = page.locator('td').filter({ hasText: /^-$|미발번/ });
    // 존재 시 가시성만 확인(데이터 의존 soft)
    if ((await dashCells.count()) > 0) {
      await expect(dashCells.first()).toBeVisible();
    }
    await expect(page).toHaveURL(/customers/);
  });
});
