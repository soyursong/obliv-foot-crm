/**
 * T-20260811-foot-CUSTBOX-HOVER-REDBOX-RM-TOOLTIP-FIELDS
 * doAI 대시보드 고객박스(카드) hover UI 2건 (김주연 총괄, 스샷 F0BPHD028SY)
 *
 * 변경 1 (제거): hover 시 카드 위에 겹쳐 뜨던 네이티브 title 힌트 툴팁
 *   ('드래그=이동 · 우클릭=고객차트·예약 · ⋮=상태변경 · 클릭=상세') 제거.
 * 변경 2 (추가): 간단정보(CustomerHoverCard) tooltip에 '접수 시간'·'생년월일' 2행 추가.
 *
 * AC-1: 대시보드 고객박스에 title 힌트 툴팁(빨간박스)이 없다.
 * AC-2: 고객박스 hover → 간단정보 tooltip에 접수/생년월일 항목이 표시된다.
 * AC-3: 데이터 없어도 tooltip 미붕괴('-' graceful).
 * AC-4: 기존 tooltip 항목(성함/예약시간/고객메모/치료메모) + 타이머·배지 렌더 유지(회귀 0).
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(
      process.env.TEST_PASSWORD ??
        (() => {
          throw new Error('TEST_PASSWORD env required (no plaintext fallback)');
        })(),
    );
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  }
}

test.describe('T-20260811-foot-CUSTBOX-HOVER-REDBOX-RM-TOOLTIP-FIELDS', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await loginIfNeeded(page);
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle');
  });

  // AC-1: 카드에 힌트 title 툴팁(빨간박스) 잔재 없음
  test('AC-1: 대시보드 고객박스에 드래그 힌트 title 툴팁이 없다', async ({ page }) => {
    // 힌트 문구를 title 로 가진 요소가 0개여야 한다(제거 확인).
    const hintTitled = page.locator('[title*="⋮=상태변경 · 클릭=상세"]');
    await expect(hintTitled).toHaveCount(0);

    const cards = page.locator('[data-testid="checkin-card"]');
    if ((await cards.count()) > 0) {
      // 실제 카드에도 해당 title 속성이 남아있지 않음
      const title = await cards.first().getAttribute('title');
      expect(title ?? '').not.toContain('드래그=이동');
    }
  });

  // AC-1b (재보고 잔존원): 카드 div title 은 이미 제거됐으나, 성함 인접 자식요소
  //   (차트#='차트 열기' / 슬롯배지='현재 위치…')의 네이티브 title 힌트가 hover 시
  //   간단정보 팝업 위에 겹쳐 뜨던 '빨간박스'의 잔존원 → 자식요소 title 도 0개여야 함.
  test('AC-1b: 고객박스 자식요소(차트#·슬롯배지)에 네이티브 title 힌트가 없다', async ({ page }) => {
    const cards = page.locator('[data-testid="checkin-card"]');
    if ((await cards.count()) === 0) {
      test.skip(true, '대기 카드 없는 환경 — 구조 검증 skip');
      return;
    }
    // 차트# 링크에 '차트 열기' 힌트 title 잔존 금지
    const chartnoTitled = page.locator(
      '[data-testid="waiting-card-chartno"][title*="차트 열기"]',
    );
    await expect(chartnoTitled).toHaveCount(0);
    // 슬롯 위치 배지에 '현재 위치' 힌트 title 잔존 금지
    const locBadgeTitled = page.locator(
      '[data-testid="card-location-badge"][title*="현재 위치"]',
    );
    await expect(locBadgeTitled).toHaveCount(0);
  });

  // AC-2 & AC-3 & AC-4: hover → 간단정보 tooltip 에 접수/생년월일 표시 + 기존 항목 유지
  test('AC-2: 고객박스 hover 시 간단정보 tooltip에 접수시간·생년월일 항목이 표시된다', async ({ page }) => {
    const cards = page.locator('[data-testid="checkin-card"]');
    if ((await cards.count()) === 0) {
      test.skip(true, '대시보드에 대기 카드가 없는 환경 — 구조 검증만');
      return;
    }

    const nameTrigger = cards
      .first()
      .locator('[data-testid^="customer-hover-card-name"]')
      .first();
    await nameTrigger.hover();

    // hover 지연(280ms) + fetch 대기 후 tooltip 등장
    const tooltip = page.locator('[data-testid="customer-hover-card"]');
    await expect(tooltip).toBeVisible({ timeout: 4000 });

    // 추가 2항목 라벨/행 존재
    await expect(tooltip.getByText('접수', { exact: false })).toBeVisible();
    await expect(tooltip.locator('[data-testid="hover-checkin-time"]')).toBeVisible();
    await expect(tooltip.getByText('생년월일', { exact: false })).toBeVisible();
    await expect(tooltip.locator('[data-testid="hover-birth-date"]')).toBeVisible();

    // AC-4: 기존 항목(고객메모/치료메모) 유지
    await expect(tooltip.getByText('고객메모', { exact: false })).toBeVisible();
    await expect(tooltip.getByText('치료메모', { exact: false })).toBeVisible();
  });

  // AC-3: 데이터 없을 때 graceful('-' 등), 연속 hover 잔상 없음
  test('AC-3: 접수/생년월일 행이 데이터 유무와 무관하게 tooltip을 깨지 않는다', async ({ page }) => {
    const cards = page.locator('[data-testid="checkin-card"]');
    const n = await cards.count();
    if (n === 0) {
      test.skip(true, '카드 없는 환경');
      return;
    }

    // 첫 카드 hover → tooltip
    await cards.first().locator('[data-testid^="customer-hover-card-name"]').first().hover();
    const tooltip = page.locator('[data-testid="customer-hover-card"]');
    await expect(tooltip).toBeVisible({ timeout: 4000 });
    // 접수/생년월일 행은 항상 존재(값 없으면 '-')
    await expect(tooltip.locator('[data-testid="hover-checkin-time"]')).toBeVisible();
    await expect(tooltip.locator('[data-testid="hover-birth-date"]')).toBeVisible();

    // 다른 카드로 이동 → 이전 tooltip 잔상 없이 tooltip 단일 유지
    if (n > 1) {
      await page.mouse.move(5, 5); // hover 해제
      await expect(tooltip).toBeHidden({ timeout: 3000 });
      await cards.nth(1).locator('[data-testid^="customer-hover-card-name"]').first().hover();
      await expect(page.locator('[data-testid="customer-hover-card"]')).toHaveCount(1);
    }
  });
});
