/**
 * T-20260602-foot-RESVLIST-CRM-SYNC-EMPTY
 * 셀프접수 예약자 명단이 CRM 예약과 연동 안 됨 (빈 목록) — 회귀 방지
 *
 * 근본 원인 (진단 확정):
 *   1) [P0] fn_selfcheckin_today_reservations RPC 가 운영 DB 에 미적용(PGRST202).
 *      → T-20260601 배포 시 FE 코드만 올라가고 마이그레이션이 prod 에 적용되지 않아
 *        RPC 호출이 항상 에러 → catch → 빈 목록. (DB 마이그레이션 직접 적용으로 해소)
 *   2) [P1 하드닝] FE 의 KST '오늘' 계산이 toISOString()(UTC) 기반 →
 *      00:00~08:59 KST 새벽에 전날 날짜를 조회. 중앙 헬퍼 todaySeoulISODate() 로 통일.
 *
 * E2E 는 prod RPC 적용 여부(배포 게이트)는 검증하지 못하므로,
 * 여기서는 FE 회귀 두 가지를 못박는다:
 *   A) FE 가 RPC 를 호출할 때 p_date 가 KST '오늘'(YYYY-MM-DD)로 정확히 전달된다. (date-boundary 회귀)
 *   B) RPC 가 행을 반환하면 명단이 (마스킹된 형태로) 정상 노출된다 → CRM 연동 동선 복원. (AC-1)
 *      + 비마스킹 PII 미노출 (AC-3).
 */
import { test, expect, Route } from '@playwright/test';

const RPC_GLOB = '**/rest/v1/rpc/fn_selfcheckin_today_reservations*';

const RAW_NAME = '김도현';
const RAW_PHONE = '01012345609';
const MASKED_NAME = '김*현';
const MASKED_PHONE = '0*09';

/** 브라우저(앱)와 동일한 KST 오늘 날짜(en-CA + Asia/Seoul) — 테스트 측 기준값 */
function kstTodayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

async function fulfillRows(route: Route, rows: unknown[]) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
}

test.describe('T-20260602 예약자 명단 CRM 연동 복원', () => {
  test('A) FE 가 RPC 를 KST 오늘 날짜로 호출한다 (date-boundary 회귀 방지)', async ({ page }) => {
    let capturedBody: { p_clinic_id?: string; p_date?: string } | null = null;

    await page.route(RPC_GLOB, async (route) => {
      try {
        capturedBody = JSON.parse(route.request().postData() || '{}');
      } catch {
        capturedBody = null;
      }
      await fulfillRows(route, [
        {
          id: '11111111-1111-1111-1111-111111111111',
          customer_id: '22222222-2222-2222-2222-222222222222',
          customer_name: RAW_NAME,
          customer_phone: RAW_PHONE,
          reservation_time: '11:00:00',
          visit_type: 'new',
        },
      ]);
    });

    await page.context().clearCookies();
    await page.goto('/checkin/jongno-foot');
    await page.waitForLoadState('networkidle');

    await page.locator('[data-testid="btn-reserved"]').click();
    await page.getByRole('button', { name: '초진' }).click();
    await page.locator('[data-testid="btn-open-reservation-list"]').click();

    await expect(page.locator('[data-testid="select-reservation-screen"]')).toBeVisible({ timeout: 6000 });

    // p_date 가 KST 오늘(YYYY-MM-DD)로 전달되어야 한다 (UTC toISOString 회귀 금지)
    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.p_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(capturedBody!.p_date).toBe(kstTodayISO());
    // clinic_id 스코프가 함께 전달되어야 한다 (지점 격리 — AC-4 의 FE 측 보장)
    expect(typeof capturedBody!.p_clinic_id).toBe('string');
    expect((capturedBody!.p_clinic_id as string).length).toBeGreaterThan(10);
  });

  test('B) RPC 가 행을 반환하면 명단이 마스킹 형태로 노출된다 (CRM 연동 복원, AC-1/AC-3)', async ({ page }) => {
    await page.route(RPC_GLOB, (route) =>
      fulfillRows(route, [
        {
          id: '11111111-1111-1111-1111-111111111111',
          customer_id: '22222222-2222-2222-2222-222222222222',
          customer_name: RAW_NAME,
          customer_phone: RAW_PHONE,
          reservation_time: '11:00:00',
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

    // "오늘 예약자 명단에 없습니다" 가 아니라 실제 항목이 떠야 한다
    await expect(page.locator('[data-testid="reservation-item"]').first()).toBeVisible({ timeout: 6000 });
    await expect(page.locator('[data-testid="reservation-list-empty"]')).toHaveCount(0);

    // 마스킹 노출 + 비마스킹 PII 미노출
    await expect(page.getByText(MASKED_NAME)).toBeVisible();
    await expect(page.getByText(MASKED_PHONE)).toBeVisible();
    await expect(page.getByText(RAW_PHONE)).toHaveCount(0);
    await expect(page.getByText('1234-5609')).toHaveCount(0);
  });
});
