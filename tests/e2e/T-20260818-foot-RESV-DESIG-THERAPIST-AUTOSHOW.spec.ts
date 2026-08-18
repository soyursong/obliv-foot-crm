/**
 * E2E spec — T-20260818-foot-RESV-DESIG-THERAPIST-AUTOSHOW
 * 예약관리 재진 고객 카드 — 지정치료사명 자동 표시 (메모 무의존, DB staff join)
 *
 * 김주연 총괄 정정 수렴본(선행 highlight 3건 supersede). 형광 배경색이 아니라,
 * customers.designated_therapist_id 배정 고객의 지정치료사명을 예약 카드 '고객 이름 하단'에
 * 코디팀 메모(notes) 수기입력 없이 DB(staff.name join)에서 자동 표시.
 *
 * AC1 (정상 동선): 재진 카드에 designated_therapist_id 있는 고객 → 이름 하단에 지정치료사명 자동 표시.
 * AC2 (경계/회귀0): designated_therapist_id NULL 고객 카드 → 지정치료사명 미표시(기존 동일).
 * AC3 (데이터 무의존): notes/메모 입력 없이 designated_therapist_id 기준으로 표시.
 *
 * 시나리오 1: 지정치료사 배정된 재진 고객이 예약 있는 날 → 카드에 지정치료사명(data-testid=resv-*-desig-therapist-*) 노출.
 * 시나리오 2: 지정치료사 미배정 고객 카드 → 지정치료사 배지 미노출(회귀).
 *
 * 참고: db_change=false. designated_therapist_id(기존 컬럼) + staff.name read-only join.
 * 배선 사이드맵 = resvDesigTherapistMap (chart_number 배치조회에 컬럼 병합, 별도 왕복 0).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = process.env.FIXTURE_CLINIC_ID ?? '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';

type SB = ReturnType<typeof createClient>;

/** 지정치료사 배정된 고객 + 재진(returning) 예약이 있는 날짜를 찾는다. */
async function findReturningResvWithDesignatedTherapist(sb: SB) {
  // 지정치료사 배정 고객
  const { data: custs } = await sb
    .from('customers')
    .select('id, name, designated_therapist_id')
    .eq('clinic_id', CLINIC_ID)
    .not('designated_therapist_id', 'is', null)
    .limit(50);
  const list = (custs ?? []) as { id: string; name: string; designated_therapist_id: string }[];
  for (const c of list) {
    const { data: resv } = await sb
      .from('reservations')
      .select('id, reservation_date, visit_type, status')
      .eq('clinic_id', CLINIC_ID)
      .eq('customer_id', c.id)
      .eq('visit_type', 'returning')
      .neq('status', 'cancelled')
      .order('reservation_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    const r = resv as { id: string; reservation_date: string } | null;
    if (r) {
      const { data: staff } = await sb.from('staff').select('name').eq('id', c.designated_therapist_id).maybeSingle();
      const name = (staff as { name: string } | null)?.name ?? null;
      if (name) return { customer: c, resvId: r.id, date: r.reservation_date, therapistName: name };
    }
  }
  return null;
}

async function gotoReservationsOnDate(page: import('@playwright/test').Page, date: string) {
  await page.goto(`${APP_URL}/reservations?date=${date}`);
  await page.waitForLoadState('networkidle');
}

test.describe('T-20260818-foot-RESV-DESIG-THERAPIST-AUTOSHOW', () => {
  let sb: SB;
  test.beforeAll(() => { sb = createClient(SUPA_URL, SERVICE_KEY); });

  test('시나리오 1 (AC1/AC3): 지정치료사 배정 재진 카드 → 이름 하단에 치료사명 자동 표시', async ({ page }) => {
    const fx = await findReturningResvWithDesignatedTherapist(sb);
    if (!fx) { test.skip(true, '지정치료사 배정 + 재진 예약 픽스처 없음 — 스킵'); return; }

    await gotoReservationsOnDate(page, fx.date);

    // 일간/주간 뷰 어느 쪽이든 해당 예약 카드의 지정치료사 배지가 노출되어야 함.
    const badge = page.locator(
      `[data-testid="resv-day-desig-therapist-${fx.resvId}"], [data-testid="resv-desig-therapist-${fx.resvId}"]`,
    ).first();
    await expect(badge).toBeVisible({ timeout: 8000 });
    // AC1/AC3: 메모 무의존, staff.name 자동 표시 — 배지에 치료사명 포함.
    await expect(badge).toContainText(fx.therapistName);
  });

  test('시나리오 2 (AC2 회귀): 지정치료사 미배정 고객 카드 → 지정치료사 배지 미노출', async ({ page }) => {
    // 미배정(designated_therapist_id NULL) + 재진 예약 고객 찾기
    const { data: custs } = await sb
      .from('customers')
      .select('id')
      .eq('clinic_id', CLINIC_ID)
      .is('designated_therapist_id', null)
      .limit(50);
    const ids = ((custs ?? []) as { id: string }[]).map((c) => c.id);
    let target: { resvId: string; date: string } | null = null;
    for (const id of ids) {
      const { data: resv } = await sb
        .from('reservations')
        .select('id, reservation_date')
        .eq('clinic_id', CLINIC_ID)
        .eq('customer_id', id)
        .eq('visit_type', 'returning')
        .neq('status', 'cancelled')
        .order('reservation_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      const r = resv as { id: string; reservation_date: string } | null;
      if (r) { target = { resvId: r.id, date: r.reservation_date }; break; }
    }
    if (!target) { test.skip(true, '미배정 재진 예약 픽스처 없음 — 스킵'); return; }

    await gotoReservationsOnDate(page, target.date);
    // 카드는 렌더되지만 지정치료사 배지는 없어야 함.
    const badge = page.locator(
      `[data-testid="resv-day-desig-therapist-${target.resvId}"], [data-testid="resv-desig-therapist-${target.resvId}"]`,
    );
    await expect(badge).toHaveCount(0);
  });
});
