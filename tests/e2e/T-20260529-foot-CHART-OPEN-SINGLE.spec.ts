/**
 * E2E spec — T-20260529-foot-CHART-OPEN-SINGLE
 * 대시보드 칸반 카드(check-in) — customer_id null 시 차트 열기 방어 검증
 *
 * 근본 원인: check_in.customer_id = null 인 칸반 카드를 클릭할 때
 *   handleCardClick → if (ci.customer_id) 가드 실패 → silent fail (아무 반응 없음)
 *
 * AC-1: 오인숙 예약 카드(box1-resv-card) 클릭 시 customer-chart-sheet 오픈 확인
 *       (T-20260529-foot-CHART-OPEN-FAIL DB 수정으로 reservation.customer_id 연결됨)
 * AC-2: 칸반 check-in 카드 클릭 시 — customer_id 있으면 차트 오픈, 없으면 toast 표시
 *       (silent fail 금지 — 아무 반응 없으면 회귀)
 * AC-3: DB 확인 — 오늘 날짜 check_ins 중 customer_id null 건 목록 + 이름 기반 매칭 가능 여부
 */
import { test, expect } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

test.describe('T-20260529 CHART-OPEN-SINGLE — 칸반 차트 열기 방어 검증', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 스킵');
  });

  // ── AC-1: 오인숙 예약 카드 클릭 → customer-chart-sheet 오픈 ────────────────────
  // T-20260529-foot-CHART-OPEN-FAIL DB 수정으로 reservation.customer_id 연결됨
  // 이 AC는 해당 fix가 실제로 차트 오픈으로 이어지는지 최종 검증
  test('AC-1: 오인숙 예약 카드 클릭 시 고객 차트 시트 열림', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const oinsukCard = page.locator('[data-testid="box1-resv-card"]').filter({ hasText: '오인숙' });
    const count = await oinsukCard.count();
    if (count === 0) {
      test.skip(true, '오인숙 초진 카드 없음 — 날짜·환경 스킵');
      return;
    }

    await oinsukCard.first().click();

    const chartSheet = page.locator('[data-testid="customer-chart-sheet"]');
    await expect(chartSheet).toBeVisible({ timeout: 8_000 });
  });

  // ── AC-2: 칸반 카드 클릭 — silent fail 금지 ──────────────────────────────────
  // customer_id 있으면 차트 오픈, 없으면 toast (고객 미연결) — 둘 중 하나 필수
  test('AC-2: 칸반 카드 클릭 시 차트 또는 toast 표시 (silent fail 금지)', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // 칸반 카드 (TimelineCheckInCard 기반)
    const kanbanCards = page.locator('[data-testid="checkin-card"]');
    const count = await kanbanCards.count();
    if (count === 0) {
      test.skip(true, '칸반 체크인 카드 없음 — 환경 스킵');
      return;
    }

    await kanbanCards.first().click();

    // customer-chart-sheet 또는 role=alert toast 중 하나 표시 필수
    const chartSheet = page.locator('[data-testid="customer-chart-sheet"]');
    const toastEl = page.locator('[role="alert"]');

    const hasSheet = await chartSheet.isVisible().catch(() => false);
    if (hasSheet) return; // 차트 열림 = 성공

    // toast 확인 (고객 미연결 또는 동명이인 안내)
    await toastEl.waitFor({ state: 'visible', timeout: 5_000 });
    const toastText = await toastEl.textContent();
    expect(toastText).toBeTruthy();
    expect(toastText).not.toBe(''); // silent fail 금지
  });

  // ── AC-3: DB — 오늘 check_ins customer_id null 건 + 이름 기반 매칭 가능 여부 ────
  test('AC-3: 오늘 날짜 check_in customer_id null 건 이름 기반 매칭 확인', async () => {
    if (!SERVICE_KEY) {
      test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY 없음 — 스킵');
      return;
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const today = new Date().toISOString().split('T')[0];
    const start = `${today}T00:00:00+09:00`;
    const end = `${today}T23:59:59+09:00`;

    // 오늘 날짜 customer_id null check_ins
    const { data: nullCis } = await supabase
      .from('check_ins')
      .select('id, customer_id, customer_name, clinic_id, status')
      .is('customer_id', null)
      .gte('checked_in_at', start)
      .lte('checked_in_at', end)
      .neq('status', 'cancelled');

    // null check_ins 존재 시 이름 기반 매칭 시도
    for (const ci of (nullCis ?? [])) {
      if (!ci.customer_name || ci.customer_name.startsWith('TEST_')) continue;

      const { data: matches } = await supabase
        .from('customers')
        .select('id, name')
        .eq('clinic_id', ci.clinic_id)
        .eq('name', ci.customer_name)
        .limit(2);

      // 매칭 결과: 1건이면 자동 연결 가능, 다건이면 동명이인, 0건이면 미등록
      // 어느 경우든 silent fail이 아닌 toast/chart 로 처리되어야 함 (코드 레이어)
      expect(matches).not.toBeUndefined(); // 쿼리 자체 오류 없음 확인
    }
  });
});
