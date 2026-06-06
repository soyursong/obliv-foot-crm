/**
 * T-20260606-foot-DASH-REALTIME-ORDER-AUTOSCROLL
 * 셀프접수 예약자 명단("본인 성함을 선택해주세요") — 예약시간 정렬 고정 + 현재시각 자동 스크롤 선노출
 *
 * 현장 피드백(김주연 총괄, 6/6): 명단이 예약시간 순서로 쭉 나열돼야 하며, 갱신이 일어나도
 * 순서가 흔들리면(특정 항목이 하단 append) 안 된다. 그리고 현재 시각대 항목이 자동 스크롤로 선노출돼야 한다.
 *
 * 시나리오:
 *   AC-1 정렬 고정: RPC가 어떤 순서로 반환하든 명단은 reservation_time 오름차순으로 렌더.
 *   AC-1b 전체 나열: 영업시간 전체 슬롯을 범위 제한 없이 모두 나열(필터 없음).
 *   AC-2 현재시각 선노출: 현재 시각(KST) 이후 가장 가까운 항목(없으면 마지막)에 "지금" 배지 + 자동 스크롤 대상.
 *
 * 결정론: fn_selfcheckin_today_reservations RPC 를 route mock 으로 가로채 공유 DB 비의존.
 * AC-2 의 "지금" 대상은 테스트 실행 시각에 따라 달라지므로, 브라우저 KST now 를 읽어 동일 로직으로 기대값 계산.
 */
import { test, expect, Route } from '@playwright/test';

const RPC_GLOB = '**/rest/v1/rpc/fn_selfcheckin_today_reservations*';

// 의도적으로 시간 역순/뒤섞인 순서로 반환 — 클라이언트가 오름차순 재정렬해야 함.
// (reporter 재현: 10:00 이 15:00 뒤에 append 되던 케이스 포함)
const ROWS = [
  { id: 'a1', customer_id: 'c1', customer_name: '김분이', customer_phone: '01000000014', reservation_time: '15:00:00', visit_type: 'returning' },
  { id: 'a2', customer_id: 'c2', customer_name: '뚜벅이', customer_phone: '01000000015', reservation_time: '10:00:00', visit_type: 'returning' },
  { id: 'a3', customer_id: 'c3', customer_name: '고슴마', customer_phone: '01000000018', reservation_time: '18:00:00', visit_type: 'returning' },
  { id: 'a4', customer_id: 'c4', customer_name: '보라이', customer_phone: '01000000009', reservation_time: '09:30:00', visit_type: 'returning' },
  { id: 'a5', customer_id: 'c5', customer_name: '김주비', customer_phone: '01000000023', reservation_time: '23:30:00', visit_type: 'returning' },
];
const EXPECTED_ASC = ['09:30', '10:00', '15:00', '18:00', '23:30'];

async function mockReservations(route: Route, rows: unknown[]) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
}

async function openList(page: import('@playwright/test').Page) {
  await page.context().clearCookies();
  await page.goto('/checkin/jongno-foot');
  await page.waitForLoadState('networkidle');
  await page.locator('[data-testid="btn-reserved"]').click();
  await page.getByRole('button', { name: '재진' }).click();
  await page.locator('[data-testid="btn-open-reservation-list"]').click();
  await expect(page.locator('[data-testid="select-reservation-screen"]')).toBeVisible({ timeout: 6000 });
}

test.describe('T-20260606 명단 정렬 고정 + 현재시각 자동 스크롤', () => {
  test('AC-1: RPC 반환 순서가 뒤섞여도 예약시간 오름차순으로 렌더', async ({ page }) => {
    await page.route(RPC_GLOB, (route) => mockReservations(route, ROWS));
    await openList(page);

    const items = page.locator('[data-testid="reservation-item"]');
    await expect(items).toHaveCount(ROWS.length);

    // 렌더된 DOM 순서에서 시간 텍스트를 추출 → 오름차순이어야 함
    const texts = await items.allTextContents();
    const times = texts.map((t) => (t.match(/\d{2}:\d{2}/) ?? [''])[0]);
    expect(times).toEqual(EXPECTED_ASC);
  });

  test('AC-2: 현재 시각 이후 가장 가까운 항목(없으면 마지막)에 "지금" 배지 1개', async ({ page }) => {
    await page.route(RPC_GLOB, (route) => mockReservations(route, ROWS));
    await openList(page);

    // 배지는 항상 정확히 1개 (자동 스크롤 대상 = 현재시각대 항목)
    const badge = page.locator('[data-testid="reservation-now-badge"]');
    await expect(badge).toHaveCount(1);

    // 브라우저 KST now 로 기대 대상 시각 계산 (FE 와 동일 로직: 첫 >= now, 없으면 마지막)
    const nowHHMM = await page.evaluate(() =>
      new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }),
    );
    const expectedTime = EXPECTED_ASC.find((t) => t >= nowHHMM) ?? EXPECTED_ASC[EXPECTED_ASC.length - 1];

    // 배지가 달린 항목(data-now="true")의 시각이 기대 대상과 일치
    const nowItem = page.locator('[data-testid="reservation-item"][data-now="true"]');
    await expect(nowItem).toHaveCount(1);
    await expect(nowItem).toContainText(expectedTime);
  });

  test('AC-1b: 전체 명단 나열 (범위 제한 없이 모든 슬롯 노출)', async ({ page }) => {
    await page.route(RPC_GLOB, (route) => mockReservations(route, ROWS));
    await openList(page);
    // 09:30 ~ 23:30 전 구간이 잘리지 않고 모두 렌더되어야 함 (±N시간 범위 필터 없음)
    await expect(page.locator('[data-testid="reservation-item"]')).toHaveCount(ROWS.length);
    await expect(page.getByText('09:30')).toBeVisible();
    await expect(page.getByText('23:30')).toBeVisible();
  });
});
