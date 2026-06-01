/**
 * T-20260601-foot-SELFLOGIN-RESV-LIST-QR
 * 셀프접수 — 예약자 목록 선택 동선 + 셀프접수 URL QR 노출 E2E 검증
 *
 * 현장 시나리오 (티켓 §현장 클릭 시나리오):
 *   시나리오 1: "예약하고 왔어요" → 초진/재진 → 오늘 예약자 목록(마스킹) → 본인 탭 → 고객정보 자동 로드 → confirm
 *   시나리오 2: 셀프접수 화면에 QR 코드가 깨지지 않고 렌더 (OQ1 가정 A — 페이지 URL QR)
 *   시나리오 3: 엣지 — 오늘 예약 없음 → 안내 문구 + 폴백(전화번호 접수) 동선
 *
 * 결정론 확보를 위해 fn_selfcheckin_today_reservations RPC 응답을 route mock 으로 가로챈다.
 * (공유 DB 의 실예약 상태에 의존하지 않음 + DB 정리 불필요)
 *
 * PII 가드 검증: 목록·DOM 에 비마스킹 원본 전화번호가 노출되지 않아야 함.
 */
import { test, expect, Route } from '@playwright/test';

const RPC_GLOB = '**/rest/v1/rpc/fn_selfcheckin_today_reservations*';

// 마스킹 검증용 원본 — 이름/전화는 마스킹되어야 함
const RAW_NAME = '김도현';
const RAW_PHONE = '01012345609'; // maskPhone → "0*09"
const MASKED_NAME = '김*현';
const MASKED_PHONE = '0*09';

async function mockReservations(route: Route, rows: unknown[]) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(rows),
  });
}

// ── 시나리오 1: 예약자 목록 선택 정상 동선 ───────────────────────────────────
test.describe('T-20260601 예약자 목록 선택 동선', () => {
  test('재진 → 목록(마스킹) → 본인 탭 → confirm 으로 고객정보 자동 로드', async ({ page }) => {
    await page.route(RPC_GLOB, (route) =>
      mockReservations(route, [
        {
          id: '11111111-1111-1111-1111-111111111111',
          customer_id: '22222222-2222-2222-2222-222222222222',
          customer_name: RAW_NAME,
          customer_phone: RAW_PHONE,
          reservation_time: '14:30:00',
          visit_type: 'returning',
        },
      ]),
    );

    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    // "예약하고 왔어요"
    await page.locator('[data-testid="btn-reserved"]').click();
    // 초진/재진 — 재진 선택
    await page.getByRole('button', { name: '재진' }).click();
    // 예약자 명단에서 찾기
    await page.locator('[data-testid="btn-open-reservation-list"]').click();

    // 목록 화면 진입
    await expect(page.locator('[data-testid="select-reservation-screen"]')).toBeVisible({ timeout: 6000 });

    // 마스킹 표시 확인
    await expect(page.locator('[data-testid="reservation-item"]').first()).toBeVisible();
    await expect(page.getByText(MASKED_NAME)).toBeVisible();
    await expect(page.getByText(MASKED_PHONE)).toBeVisible();
    await expect(page.getByText('14:30')).toBeVisible();

    // PII 가드: 비마스킹 원본 전화번호가 목록에 노출되면 안 됨
    await expect(page.getByText(RAW_PHONE)).toHaveCount(0);
    await expect(page.getByText('1234-5609')).toHaveCount(0);

    // 본인 항목 탭 → 고객정보 자동 로드 → confirm
    await page.locator('[data-testid="reservation-item"]').first().click();

    // confirm 단계에서 원본 이름이 본인 확인용으로 표시됨
    await expect(page.getByText(RAW_NAME)).toBeVisible({ timeout: 6000 });
    await expect(page.getByRole('button', { name: '접수하기' })).toBeVisible();
  });

  test('초진 항목 선택 시 personal_info 단계로 진입', async ({ page }) => {
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
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('[data-testid="btn-reserved"]').click();
    await page.getByRole('button', { name: '초진' }).click();
    await page.locator('[data-testid="btn-open-reservation-list"]').click();

    await expect(page.locator('[data-testid="reservation-item"]').first()).toBeVisible({ timeout: 6000 });
    await page.locator('[data-testid="reservation-item"]').first().click();

    // 초진 → personal_info (주민번호/주소 안내) 진입
    await expect(page.getByText(/주민번호|생년월일|주소/i).first()).toBeVisible({ timeout: 6000 });
  });
});

// ── 시나리오 2: QR 코드 노출 (OQ1 가정 A) ───────────────────────────────────
test.describe('T-20260601 셀프접수 URL QR 노출', () => {
  test('입력 화면에 셀프접수 URL QR 이미지가 렌더된다', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    const qr = page.locator('[data-testid="selfcheckin-url-qr-image"]');
    await expect(qr).toBeVisible({ timeout: 6000 });

    // src 가 QR 생성 API + 현재 페이지 URL 인코딩을 포함해야 함
    const src = await qr.getAttribute('src');
    expect(src).toContain('api.qrserver.com');
    expect(src).toContain(encodeURIComponent('checkin/jongno-foot'));
  });
});

// ── 시나리오 3: 엣지 — 오늘 예약 없음 ───────────────────────────────────────
test.describe('T-20260601 오늘 예약 없음 폴백', () => {
  test('빈 목록 → 안내 문구 + 전화번호 접수 폴백 버튼', async ({ page }) => {
    await page.route(RPC_GLOB, (route) => mockReservations(route, []));

    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('[data-testid="btn-reserved"]').click();
    await page.getByRole('button', { name: '재진' }).click();
    await page.locator('[data-testid="btn-open-reservation-list"]').click();

    // 빈 안내 + 폴백 버튼
    await expect(page.locator('[data-testid="reservation-list-empty"]')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('[data-testid="btn-back-to-phone-checkin"]')).toBeVisible();

    // 폴백 → input 화면 복귀 (전화번호 접수 가능)
    await page.locator('[data-testid="btn-back-to-phone-checkin"]').click();
    await expect(page.locator('#sc-name')).toBeVisible({ timeout: 6000 });
  });
});
