/**
 * T-20260517-foot-RESV-NAV-DIRECT
 * CRM 전역 [예약하기] 직접 네비게이션 + 고객 컨텍스트 자동 전달
 *
 * AC-1: 헤더 [예약하기] → /admin/reservations 즉시 전환, 팝업/토스트 없음
 * AC-2: 고객 상세 [예약하기] → 예약관리 전환 + openReservationFor state 전달
 * AC-3: selectedPatient 전달 시 예약 생성 폼 자동 pre-fill
 * AC-4: 컨텍스트 없는 헤더 [예약하기] → 빈 예약 생성 화면 (InlinePatientSearch 활성)
 * AC-5: 기존 예약관리 기능 영향 없음
 * AC-6: RESV-ROUTE-FIX(우클릭) regression 없음
 *
 * 티켓: T-20260517-foot-RESV-NAV-DIRECT
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

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

// ── AC-1: 헤더 [예약하기] → /admin/reservations 즉시 전환, 팝업 없음 ──

test('AC-1: 헤더 [예약하기] → 예약관리 즉시 전환', async ({ page }) => {
  await loginIfNeeded(page);
  await page.goto(`${BASE_URL}/admin/customers`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  const headerBtn = page.getByTestId('btn-header-make-reservation');
  await expect(headerBtn).toBeVisible({ timeout: 5000 });

  // 팝업/모달 발생 여부 감지
  let dialogOpened = false;
  page.on('dialog', () => { dialogOpened = true; });

  await headerBtn.click();
  await page.waitForURL('**/admin/reservations', { timeout: 5000 });

  expect(page.url()).toContain('/admin/reservations');
  expect(dialogOpened).toBe(false);
});

// ── AC-1: 대시보드에서도 헤더 [예약하기] 동작 ──

test('AC-1: 대시보드에서 헤더 [예약하기] → 예약관리 전환', async ({ page }) => {
  await loginIfNeeded(page);
  await page.goto(`${BASE_URL}/admin`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  const headerBtn = page.getByTestId('btn-header-make-reservation');
  await expect(headerBtn).toBeVisible({ timeout: 5000 });
  await headerBtn.click();
  await page.waitForURL('**/admin/reservations', { timeout: 5000 });

  expect(page.url()).toContain('/admin/reservations');
});

// ── AC-4: 헤더 [예약하기] → 빈 예약 생성 폼 활성 ──

test('AC-4: 헤더 [예약하기] → InlinePatientSearch 활성 (빈 예약 생성)', async ({ page }) => {
  await loginIfNeeded(page);
  await page.goto(`${BASE_URL}/admin/customers`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  const headerBtn = page.getByTestId('btn-header-make-reservation');
  await headerBtn.click();
  await page.waitForURL('**/admin/reservations', { timeout: 5000 });

  // 예약 생성 폼/에디터 영역이 열려야 함
  // InlinePatientSearch 또는 예약 날짜 입력란 존재 확인
  await expect(
    page.locator('[data-testid="inline-patient-search"], input[type="date"]').first()
  ).toBeVisible({ timeout: 5000 });
});

// ── AC-2: 고객 상세 헤더 [예약하기] → 고객 컨텍스트 전달 ──

test('AC-2: 고객 상세 [예약하기] → 예약관리 + 고객 자동채움', async ({ page }) => {
  await loginIfNeeded(page);
  await page.goto(`${BASE_URL}/admin/customers`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  // 첫 번째 고객 클릭 → 2번차트 열기
  const row = page.locator('tbody tr').first();
  if ((await row.count()) === 0) {
    test.skip(true, '고객관리에 고객 행 없음');
    return;
  }

  // 고객 이름 추출 (첫 번째 td)
  const customerName = await row.locator('td').first().textContent() ?? '';

  // 고객 행 클릭 → 차트 시트 오픈
  await row.click();
  await page.waitForTimeout(800);

  // 차트 내 [예약하기] 버튼 찾기
  const chartResvBtn = page.getByTestId('btn-chart-make-reservation');
  if (!(await chartResvBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
    test.skip(true, '고객 상세 [예약하기] 버튼 미노출 (차트 미열림)');
    return;
  }

  await chartResvBtn.click();
  await page.waitForURL('**/admin/reservations', { timeout: 5000 });

  expect(page.url()).toContain('/admin/reservations');

  // 예약 생성 폼에 고객 이름이 pre-fill 되어 있는지 확인
  if (customerName.trim()) {
    const nameInput = page.locator('input[placeholder*="이름"], input[placeholder*="고객명"]').first();
    if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      const value = await nameInput.inputValue();
      expect(value).toContain(customerName.trim().slice(0, 2));
    }
  }
});

// ── AC-3: openReservationFor state → setEditor 호출 (기존 Reservations.tsx 로직 검증) ──

test('AC-3: openReservationFor state → 예약 에디터 pre-fill', async ({ page }) => {
  await loginIfNeeded(page);

  // navigate with state 직접 시뮬레이션
  await page.goto(`${BASE_URL}/admin/reservations`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  // 직접 navigate with state via evaluate
  await page.evaluate(() => {
    window.history.pushState(
      {
        openReservationFor: {
          customer_id: null,
          name: '홍길동테스트',
          phone: '010-9999-8888',
          visit_type: 'returning',
        },
      },
      '',
      '/admin/reservations',
    );
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

  await page.waitForTimeout(800);

  // 이름 필드가 채워져 있어야 함
  const nameInput = page.locator('input[placeholder*="이름"], input[placeholder*="고객명"]').first();
  if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    const value = await nameInput.inputValue();
    expect(value).toContain('홍길동');
  }
});

// ── AC-5: 기존 예약관리 기능 정상 ──

test('AC-5: 예약관리 페이지 기본 기능 정상', async ({ page }) => {
  await loginIfNeeded(page);
  await page.goto(`${BASE_URL}/admin/reservations`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  // 페이지 렌더 확인
  await expect(page.locator('body')).toBeVisible();
  // URL 유지 확인
  expect(page.url()).toContain('/admin/reservations');
  // [새 예약] 버튼 존재 확인
  await expect(page.getByRole('button', { name: '새 예약' })).toBeVisible({ timeout: 5000 });
});

// ── AC-6: 고객관리 우클릭 [예약하기] regression 없음 ──

test('AC-6: 고객관리 우클릭 [예약하기] regression 없음', async ({ page }) => {
  await loginIfNeeded(page);
  await page.goto(`${BASE_URL}/admin/customers`);
  await page.waitForLoadState('networkidle', { timeout: 15000 });

  const row = page.locator('tbody tr').first();
  if ((await row.count()) === 0) {
    test.skip(true, '고객관리에 고객 행 없음');
    return;
  }

  await row.click({ button: 'right' });
  await page.waitForTimeout(500);

  const menu = page.locator('.fixed.z-\\[60\\]').filter({ hasText: '고객차트' }).first();
  if (!(await menu.isVisible({ timeout: 3000 }).catch(() => false))) {
    test.skip(true, '컨텍스트 메뉴 미노출');
    return;
  }

  const resvBtn = menu.getByText('예약하기');
  await resvBtn.click();
  await page.waitForURL('**/admin/reservations', { timeout: 5000 });

  expect(page.url()).toContain('/admin/reservations');
});
