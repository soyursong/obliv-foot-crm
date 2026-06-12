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
 *
 * FIX(2026-06-06, T-20260606-foot-SELFLOGIN-SPEC-SLUG-REFRESH — 4건 RED 복구):
 *   RC 는 구현 회귀가 아니라 spec 환경 노후화. 진입 slug `jongno-foot` 이 6/3
 *   CHECKIN-OLDURL-DEPRECATE 로 CheckinRoute 에서 canonical(foot-checkin.pages.dev)로 강제
 *   리다이렉트 대상이 되어 native SelfCheckIn 이 렌더되지 않고 `btn-reserved` 가 영구 미렌더 →
 *   4 시나리오 전부 첫 click 에서 타임아웃(RED). DASH-REALTIME(59c5590)에서 검증한 패턴 그대로 적용:
 *     ① slug `jongno-foot` → `e2e-foot`(비-deprecated, native SelfCheckIn 렌더)
 *     ② clinics route mock 추가(maybeSingle 호환 단일 객체) → clinic 조회 loading 고정 방지
 *     ③ 공개 라우트(/checkin) auth 디커플(빈 storageState) → 실 Supabase 비의존, RPC + clinics mock 만으로 결정적 통과
 *     ④ 재진/초진 선택을 안정 data-testid(btn-visit-returning/new)로 교체(라벨 텍스트 비의존)
 *   구현 파일 무변경 — diff 는 본 spec 1파일 한정.
 */
import { test, expect, Route } from '@playwright/test';

// /checkin 은 anon 공개 라우트 — 로그인 세션 불필요. 빈 storageState 로 auth 의존 제거.
test.use({ storageState: { cookies: [], origins: [] } });

const RPC_GLOB = '**/rest/v1/rpc/fn_selfcheckin_today_reservations*';
// 클리닉 조회 mock — maybeSingle() 은 단일 객체(application/vnd.pgrst.object+json)를 기대.
const CLINIC_GLOB = '**/rest/v1/clinics*';
const CLINIC_ROW = { id: 'clinic-e2e-foot', name: '오블리브 풋센터(E2E)' };

// 진입 slug 는 비-deprecated 값을 사용해야 native SelfCheckIn 이 렌더된다.
// ('jongno-foot' 은 CheckinRoute 에서 canonical(foot-checkin.pages.dev)로 강제 리다이렉트.)
// 클리닉 조회는 mock 이므로 slug 값 자체는 데이터에 영향 없음.
const CHECKIN_PATH = '/checkin/e2e-foot';

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

// 클리닉 조회 route mock 등록 — goto 이전에 호출해야 첫 요청부터 가로챈다.
async function mockClinic(page: import('@playwright/test').Page) {
  await page.route(CLINIC_GLOB, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CLINIC_ROW) }),
  );
}

// ── 시나리오 1: 예약자 목록 선택 정상 동선 ───────────────────────────────────
test.describe('T-20260601 예약자 목록 선택 동선', () => {
  test('재진 → 목록(마스킹) → 본인 탭 → confirm 으로 고객정보 자동 로드', async ({ page }) => {
    await mockClinic(page);
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
    await page.goto(CHECKIN_PATH);
    // 클리닉 조회 완료(loading=false) → input 화면 진입을 btn-reserved 가시화로 결정적 확인.
    await expect(page.locator('[data-testid="btn-reserved"]')).toBeVisible({ timeout: 10000 });

    // "예약하고 왔어요"
    await page.locator('[data-testid="btn-reserved"]').click();
    // 초진/재진 — 재진 선택 (안정 data-testid)
    await page.locator('[data-testid="btn-visit-returning"]').click();
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
    // (T-20260613-foot-SELFCHECKIN-BANNER-NAME 이후 confirm 에 예약 배너도 성함을 포함하므로
    //  요약 카드 행 1건만 단언하도록 .first() 로 명확화 — strict-mode 모호성 제거)
    await expect(page.getByText(RAW_NAME).first()).toBeVisible({ timeout: 6000 });
    await expect(page.getByRole('button', { name: '접수하기' })).toBeVisible();
  });

  test('초진 항목 선택 시 personal_info 단계로 진입', async ({ page }) => {
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

    // 초진 → personal_info (주민번호/주소 안내) 진입
    await expect(page.getByText(/주민번호|생년월일|주소/i).first()).toBeVisible({ timeout: 6000 });
  });
});

// ── 시나리오 2: QR 코드 노출 (OQ1 가정 A) ───────────────────────────────────
test.describe('T-20260601 셀프접수 URL QR 노출', () => {
  test('입력 화면에 셀프접수 URL QR 이미지가 렌더된다', async ({ page }) => {
    await mockClinic(page);

    await page.context().clearCookies();
    await page.goto(CHECKIN_PATH);

    const qr = page.locator('[data-testid="selfcheckin-url-qr-image"]');
    await expect(qr).toBeVisible({ timeout: 10000 });

    // src 가 QR 생성 API + 현재 페이지 URL 인코딩을 포함해야 함
    const src = await qr.getAttribute('src');
    expect(src).toContain('api.qrserver.com');
    expect(src).toContain(encodeURIComponent('checkin/e2e-foot'));
  });
});

// ── 시나리오 3: 엣지 — 오늘 예약 없음 ───────────────────────────────────────
test.describe('T-20260601 오늘 예약 없음 폴백', () => {
  test('빈 목록 → 안내 문구 + 전화번호 접수 폴백 버튼', async ({ page }) => {
    await mockClinic(page);
    await page.route(RPC_GLOB, (route) => mockReservations(route, []));

    await page.context().clearCookies();
    await page.goto(CHECKIN_PATH);
    await expect(page.locator('[data-testid="btn-reserved"]')).toBeVisible({ timeout: 10000 });

    await page.locator('[data-testid="btn-reserved"]').click();
    await page.locator('[data-testid="btn-visit-returning"]').click();
    await page.locator('[data-testid="btn-open-reservation-list"]').click();

    // 빈 안내 + 폴백 버튼
    await expect(page.locator('[data-testid="reservation-list-empty"]')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('[data-testid="btn-back-to-phone-checkin"]')).toBeVisible();

    // 폴백 → input 화면 복귀 (전화번호 접수 가능)
    await page.locator('[data-testid="btn-back-to-phone-checkin"]').click();
    await expect(page.locator('#sc-name')).toBeVisible({ timeout: 6000 });
  });
});
