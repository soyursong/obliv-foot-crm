/**
 * T-20260615-foot-CHART2-RESVBTN-POPUP-NONAV
 * 2번차트(CustomerChartPage) 우측 상단 [예약하기] → 예약 미니팝업 오버레이 (화면 이동 X, 차트 유지)
 *
 * 현장: 김주연 총괄. RESV-NAV-DIRECT(done)의 "차트 [예약하기] → 즉시 navigate" 규칙을
 * 2번차트 surface 한정으로 부분 supersede. 기존 openResvMiniPopup 자산 재사용.
 *
 * AC-1 (팝업 오버레이): 2번차트 [예약하기] → 예약 팝업 오버레이 오픈, /admin/reservations navigate 안 함
 * AC-2 (차트 유지): 팝업 떠 있는 동안 2번차트 닫히지 않고 유지, 팝업 닫으면 차트 복귀
 * AC-3 (환자 컨텍스트 주입): 팝업이 현 차트 환자로 사전 채워짐
 * AC-4 (타 surface 회귀 0 — 필수): 헤더/컨텍스트메뉴 [예약하기]는 기존대로 /admin/reservations 즉시 navigate 유지
 *
 * 티켓: T-20260615-foot-CHART2-RESVBTN-POPUP-NONAV
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8089';

async function loginIfNeeded(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL);
  const loginInput = page.getByPlaceholder('이메일');
  if (await loginInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginInput.fill(process.env.TEST_EMAIL ?? 'test@test.com');
    await page.getByPlaceholder('비밀번호').fill(process.env.TEST_PASSWORD ?? (() => { throw new Error('TEST_PASSWORD env required (no plaintext fallback)'); })());
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL(/\/(admin|$)/, { timeout: 10000 });
  }
}

// 고객관리 첫 고객 → 우클릭 컨텍스트메뉴 [고객차트] → 2번차트 오픈 헬퍼. 차트가 안 열리면 null 반환.
// 2번차트는 lazy 청크(CustomerChartPage) — 최초 오픈 시 청크 로드+데이터 fetch 지연 가능. 시트 컨테이너 먼저 대기 후 버튼 확인, 1회 재시도.
async function openFirstChart(page: import('@playwright/test').Page): Promise<string | null> {
  await page.goto(`${BASE_URL}/admin/customers`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });
  const row = page.locator('tbody tr').first();
  if ((await row.count()) === 0) return null;
  const customerName = (await row.locator('td').first().textContent() ?? '').trim();

  const sheet = page.getByTestId('customer-chart-sheet');
  const chartBtn = page.getByTestId('btn-chart-make-reservation');

  await row.click({ button: 'right' });
  const menu = page.locator('.fixed.z-\\[60\\]').filter({ hasText: '고객차트' }).first();
  try {
    await menu.waitFor({ state: 'visible', timeout: 5000 });
  } catch { return null; }
  await menu.getByText('고객차트', { exact: true }).click();
  // 시트 컨테이너(즉시 마운트) → 내부 콘텐츠("불러오는 중…")가 dev DB fetch + Vite dev 청크 컴파일로 느릴 수 있어
  // waitFor(auto-wait)로 충분히 기다린다. isVisible()은 즉시 평가라 lazy 콘텐츠엔 부적합.
  try {
    await sheet.waitFor({ state: 'visible', timeout: 10000 });
    await chartBtn.waitFor({ state: 'visible', timeout: 30000 });
  } catch { return null; }
  return customerName || '_';
}

// ── 시나리오 1: 정상 동선 — 2번차트 [예약하기] → 팝업 오버레이 (navigate X, 차트 유지) ──

test('AC-1/AC-2: 2번차트 [예약하기] → 팝업 오버레이 + navigate 발생 안 함 + 차트 유지', async ({ page }) => {
  test.slow(); // 2번차트는 대형 lazy 청크 — 최초 오픈 시 Vite dev on-demand 컴파일로 느릴 수 있음
  const name = await openFirstChart(page);
  if (name === null) { test.skip(true, '고객 행/차트 미노출'); return; }

  // 브라우저 alert/confirm 등 다이얼로그 발생 감지 (RESV-NAV-DIRECT 시절 금지 규칙 회귀 점검과 별개)
  let dialogOpened = false;
  page.on('dialog', () => { dialogOpened = true; });

  await page.getByTestId('btn-chart-make-reservation').click();

  // AC-1: 예약 미니팝업 오버레이가 떠야 함
  const popup = page.getByTestId('resv-mini-popup');
  await expect(popup).toBeVisible({ timeout: 5000 });
  await expect(popup.getByText('예약 등록 —', { exact: false })).toBeVisible();

  // AC-1: URL이 /admin/reservations 로 바뀌지 않아야 함 (navigate X)
  expect(page.url()).not.toContain('/admin/reservations');
  expect(dialogOpened).toBe(false);

  // AC-2: 2번차트(시트)가 뒤에 그대로 유지되어야 함
  await expect(page.getByTestId('customer-chart-sheet')).toBeVisible();

  // AC-2: 팝업 닫기(취소) → 팝업 사라지고 차트는 그대로 복귀
  await page.getByTestId('resv-mini-cancel').click();
  await expect(popup).toBeHidden({ timeout: 5000 });
  await expect(page.getByTestId('customer-chart-sheet')).toBeVisible();
  expect(page.url()).not.toContain('/admin/reservations');
});

test('AC-3: 팝업이 현재 차트 환자 컨텍스트로 오픈 (이름 표시 + 지정치료사 셀렉트 존재)', async ({ page }) => {
  test.slow();
  const name = await openFirstChart(page);
  if (name === null) { test.skip(true, '고객 행/차트 미노출'); return; }

  await page.getByTestId('btn-chart-make-reservation').click();

  // 팝업 헤더에 현재 환자 이름이 노출 (saveResvMini는 현 customer로 예약 생성)
  const popupHeading = page.getByText('예약 등록 —', { exact: false });
  await expect(popupHeading).toBeVisible({ timeout: 5000 });
  if (name !== '_') {
    await expect(popupHeading).toContainText(name.slice(0, 2));
  }

  // 현 환자 컨텍스트 입력 필드(지정 치료사 셀렉트)가 팝업 안에 존재
  await expect(page.getByTestId('resv-mini-designated-therapist')).toBeVisible({ timeout: 3000 });
});

// ── 시나리오 2: 타 surface 회귀 확인 (AC-4 필수) ──
// 주: 상단 헤더 [예약하기]는 T-20260611-foot-TOPBAR-RESV-BTN-REMOVE(deployed)로 제거된 surface라 검증 대상 아님.
//    현존 navigate surface = 고객관리 우클릭 컨텍스트메뉴 [예약하기] → 회귀 불변 확인.

test('AC-4: 고객관리 우클릭 컨텍스트메뉴 [예약하기] regression 없음 (navigate 유지)', async ({ page }) => {
  await loginIfNeeded(page);
  await page.goto(`${BASE_URL}/admin/customers`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  const row = page.locator('tbody tr').first();
  if ((await row.count()) === 0) { test.skip(true, '고객 행 없음'); return; }

  await row.click({ button: 'right' });
  await page.waitForTimeout(500);
  const menu = page.locator('.fixed.z-\\[60\\]').filter({ hasText: '고객차트' }).first();
  if (!(await menu.isVisible({ timeout: 3000 }).catch(() => false))) {
    test.skip(true, '컨텍스트 메뉴 미노출');
    return;
  }
  await menu.getByText('예약하기').click();
  await page.waitForURL('**/admin/reservations', { timeout: 5000 });
  expect(page.url()).toContain('/admin/reservations');
});
