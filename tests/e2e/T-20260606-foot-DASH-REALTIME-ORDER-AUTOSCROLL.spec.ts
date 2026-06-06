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
 * 결정론: 클리닉 조회 + fn_selfcheckin_today_reservations RPC 를 route mock 으로 가로채 공유 DB 비의존.
 * AC-2 의 "지금" 대상은 테스트 실행 시각에 따라 달라지므로, 브라우저 KST now 를 읽어 동일 로직으로 기대값 계산.
 *
 * FIX(2026-06-06, qa_fail spec_fail_new/click-timeout): 기존 spec 은 RPC 만 mock 했으나
 * SelfCheckIn 진입 시 from('clinics').select('id,name').eq('slug',…).maybeSingle() 이 선행한다.
 * 맥스튜디오/CI 의 실 Supabase 차단 시 이 조회가 끝나지 않아 loading=true 로 고정 → input 화면
 * (btn-reserved)이 영영 렌더되지 않아 첫 click 에서 타임아웃했다. 클리닉 조회도 mock 해 결정적으로 진입.
 *
 * FIX2(2026-06-06, supervisor click-timeout 재현): 결정성 추가 강화.
 *   (a) 셀렉터 의존 제거 — 재진 클릭이 라벨 텍스트(getByRole name='재진', desc 텍스트 포함 substring)
 *       에 의존하던 부분을 안정 data-testid(btn-visit-returning)로 교체.
 *   (b) 공개 라우트(/checkin)는 인증 세션 불필요 → storageState 를 비워 auth.setup(실 Supabase 로그인)
 *       성공 여부와 무관하게 동작. RPC + clinics route mock 만으로 완전 DB 비의존.
 */
import { test, expect, Route } from '@playwright/test';

// /checkin 은 anon 공개 라우트 — 로그인 세션 불필요. 빈 storageState 로 auth 의존 제거.
test.use({ storageState: { cookies: [], origins: [] } });

const RPC_GLOB = '**/rest/v1/rpc/fn_selfcheckin_today_reservations*';
// 클리닉 조회 mock — maybeSingle() 은 단일 객체(application/vnd.pgrst.object+json)를 기대.
const CLINIC_GLOB = '**/rest/v1/clinics*';
const CLINIC_ROW = { id: 'clinic-jongno-foot', name: '오블리브 종로 풋센터' };

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

// 클리닉 조회 + RPC 를 mock 한 뒤 SelfCheckIn 진입 → input 화면 렌더 대기 → 예약자 명단까지 도달.
async function openList(page: import('@playwright/test').Page, rows: unknown[] = ROWS) {
  // route 는 goto 이전에 등록해야 첫 요청부터 가로챈다.
  await page.route(CLINIC_GLOB, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CLINIC_ROW) }),
  );
  await page.route(RPC_GLOB, (route) => mockReservations(route, rows));

  await page.context().clearCookies();
  // slug 는 비-deprecated 값을 사용해야 native SelfCheckIn 이 렌더된다.
  // ('jongno-foot' 은 App.tsx CheckinRoute 에서 foot-checkin.pages.dev 로 강제 리다이렉트 — 별도 repo).
  // 클리닉 조회는 mock 이므로 slug 값 자체는 데이터에 영향 없음.
  await page.goto('/checkin/e2e-foot');
  // loading=false → input 화면. btn-reserved 가시화로 클리닉 조회 완료를 결정적으로 확인.
  await expect(page.locator('[data-testid="btn-reserved"]')).toBeVisible({ timeout: 10000 });

  await page.locator('[data-testid="btn-reserved"]').click();
  // 재진 선택 — 안정 data-testid (라벨/desc 텍스트 비의존).
  await page.locator('[data-testid="btn-visit-returning"]').click();
  await page.locator('[data-testid="btn-open-reservation-list"]').click();
  await expect(page.locator('[data-testid="select-reservation-screen"]')).toBeVisible({ timeout: 6000 });
}

test.describe('T-20260606 명단 정렬 고정 + 현재시각 자동 스크롤', () => {
  test('AC-1: RPC 반환 순서가 뒤섞여도 예약시간 오름차순으로 렌더', async ({ page }) => {
    await openList(page);

    const items = page.locator('[data-testid="reservation-item"]');
    await expect(items).toHaveCount(ROWS.length);

    // 렌더된 DOM 순서에서 시간 텍스트를 추출 → 오름차순이어야 함
    const texts = await items.allTextContents();
    const times = texts.map((t) => (t.match(/\d{2}:\d{2}/) ?? [''])[0]);
    expect(times).toEqual(EXPECTED_ASC);
  });

  test('AC-2: 현재 시각 이후 가장 가까운 항목(없으면 마지막)에 "지금" 배지 1개', async ({ page }) => {
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
    await openList(page);
    // 09:30 ~ 23:30 전 구간이 잘리지 않고 모두 렌더되어야 함 (±N시간 범위 필터 없음)
    await expect(page.locator('[data-testid="reservation-item"]')).toHaveCount(ROWS.length);
    await expect(page.getByText('09:30')).toBeVisible();
    await expect(page.getByText('23:30')).toBeVisible();
  });
});
