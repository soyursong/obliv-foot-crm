/**
 * T-20260613-foot-SELFCHECKIN-BANNER-NAME
 * 셀프접수 예약 배너에 예약자 성함 표기 ("{name}님, " 접두)
 *
 * 현장 클릭 시나리오 3종 (티켓 §AC):
 *   AC-1(재진): 예약자 목록 → 재진 본인 항목 클릭 → confirm 배너에 "{name}님, …" 성함 표기
 *   AC-2(초진): 예약자 목록 → 초진 본인 항목 클릭 → personal_info 배너에 "{name}님, …" 성함 표기
 *   AC-3(성함결손+비마스킹): name 빈값 → "님," 접두 생략(빈값 가드) / 표기되는 성함은 비마스킹 원본
 *   AC-4: i18n 키(reservationBanner) 유지 — 배너 본문 "오늘 예약이 있습니다: {time} {type}" 그대로
 *
 * 결정론 확보: fn_selfcheckin_today_reservations RPC + clinics 조회를 route mock 으로 가로챈다.
 * (공유 DB 실예약 비의존 — T-20260601-foot-SELFLOGIN-RESV-LIST-QR 패턴 재사용)
 * DB 변경/추가 조회 없음 — 배너 name 은 선택 시점 ref 원본(rawReservationsRef)에서 주입.
 */
import { test, expect, Route } from '@playwright/test';

// /checkin 은 anon 공개 라우트 — 빈 storageState 로 auth 의존 제거.
test.use({ storageState: { cookies: [], origins: [] } });

const RPC_GLOB = '**/rest/v1/rpc/fn_selfcheckin_today_reservations*';
const CLINIC_GLOB = '**/rest/v1/clinics*';
const CLINIC_ROW = { id: 'clinic-e2e-foot', name: '오블리브 풋센터(E2E)' };

// 비-deprecated slug 사용해야 native SelfCheckIn 이 렌더된다.
const CHECKIN_PATH = '/checkin/e2e-foot';

const RAW_NAME = '김도현';

async function mockReservations(route: Route, rows: unknown[]) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(rows),
  });
}

async function mockClinic(page: import('@playwright/test').Page) {
  await page.route(CLINIC_GLOB, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CLINIC_ROW) }),
  );
}

// ── AC-1: 재진 → confirm 배너 성함 표기 ──────────────────────────────────────
test.describe('T-20260613 배너 성함 표기', () => {
  test('AC-1 재진: 본인 항목 클릭 → confirm 배너 "{name}님, …" 성함 표기', async ({ page }) => {
    await mockClinic(page);
    await page.route(RPC_GLOB, (route) =>
      mockReservations(route, [
        {
          id: '11111111-1111-1111-1111-111111111111',
          customer_id: '22222222-2222-2222-2222-222222222222',
          customer_name: RAW_NAME,
          customer_phone: '01012345609',
          reservation_time: '14:30:00',
          visit_type: 'returning',
        },
      ]),
    );

    await page.context().clearCookies();
    await page.goto(CHECKIN_PATH);
    await expect(page.locator('[data-testid="btn-reserved"]')).toBeVisible({ timeout: 10000 });

    await page.locator('[data-testid="btn-reserved"]').click();
    await page.locator('[data-testid="btn-visit-returning"]').click();
    await page.locator('[data-testid="btn-open-reservation-list"]').click();

    await expect(page.locator('[data-testid="reservation-item"]').first()).toBeVisible({ timeout: 6000 });
    await page.locator('[data-testid="reservation-item"]').first().click();

    // confirm 단계 진입 + 배너 성함 접두 + i18n 본문 유지(AC-4)
    const banner = page.locator('[data-testid="reservation-banner"]');
    await expect(banner).toBeVisible({ timeout: 6000 });
    await expect(banner).toContainText(`${RAW_NAME}님,`);
    await expect(banner).toContainText('오늘 예약이 있습니다');
    await expect(banner).toContainText('재진');
  });

  test('AC-2 초진: 본인 항목 클릭 → personal_info 배너 "{name}님, …" 성함 표기', async ({ page }) => {
    await mockClinic(page);
    await page.route(RPC_GLOB, (route) =>
      mockReservations(route, [
        {
          id: '33333333-3333-3333-3333-333333333333',
          customer_id: '44444444-4444-4444-4444-444444444444',
          customer_name: '이초진',
          customer_phone: '01099887766',
          reservation_time: '10:00:00',
          visit_type: 'new',
        },
      ]),
    );

    await page.context().clearCookies();
    await page.goto(CHECKIN_PATH);
    await expect(page.locator('[data-testid="btn-reserved"]')).toBeVisible({ timeout: 10000 });

    await page.locator('[data-testid="btn-reserved"]').click();
    await page.locator('[data-testid="btn-visit-new"]').click();
    await page.locator('[data-testid="btn-open-reservation-list"]').click();

    await expect(page.locator('[data-testid="reservation-item"]').first()).toBeVisible({ timeout: 6000 });
    await page.locator('[data-testid="reservation-item"]').first().click();

    // personal_info 단계 배너 성함 접두 + i18n 본문 유지
    const banner = page.locator('[data-testid="reservation-banner"]');
    await expect(banner).toBeVisible({ timeout: 6000 });
    await expect(banner).toContainText('이초진님,');
    await expect(banner).toContainText('오늘 예약이 있습니다');
    await expect(banner).toContainText('초진');
  });

  test('AC-3 성함결손: name 빈값 → "님," 접두 생략(빈값 가드), 본문은 유지', async ({ page }) => {
    await mockClinic(page);
    await page.route(RPC_GLOB, (route) =>
      mockReservations(route, [
        {
          id: '55555555-5555-5555-5555-555555555555',
          customer_id: '66666666-6666-6666-6666-666666666666',
          customer_name: '', // 성함 결손
          customer_phone: '01055554444',
          reservation_time: '16:00:00',
          visit_type: 'returning',
        },
      ]),
    );

    await page.context().clearCookies();
    await page.goto(CHECKIN_PATH);
    await expect(page.locator('[data-testid="btn-reserved"]')).toBeVisible({ timeout: 10000 });

    await page.locator('[data-testid="btn-reserved"]').click();
    await page.locator('[data-testid="btn-visit-returning"]').click();
    await page.locator('[data-testid="btn-open-reservation-list"]').click();

    await expect(page.locator('[data-testid="reservation-item"]').first()).toBeVisible({ timeout: 6000 });
    await page.locator('[data-testid="reservation-item"]').first().click();

    const banner = page.locator('[data-testid="reservation-banner"]');
    await expect(banner).toBeVisible({ timeout: 6000 });
    // 성함 접두 없이 본문만 — "님," 접두가 본문 앞에 붙지 않아야 함
    await expect(banner).toContainText('오늘 예약이 있습니다');
    await expect(banner).not.toContainText('님,');
  });
});
