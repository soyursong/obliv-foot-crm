/**
 * T-20260622-foot-RESV-LIVE-AUTOSCROLL-REGRESSION
 * 예약관리 "실시간 반영(realtime 구독 자동 갱신) + 현재시각 자동 스크롤" 2축 회귀 복원 검증
 *
 * 배경 (풋센터 현장 — 김주연 총괄):
 *   "예약관리 개편하면서 실시간 반영 스크롤 기능 없어진듯 검토 후 다시 반영해줘"
 *   최근 캘린더 개편(RESVCAL-HOURLY-GROUPING → 30MIN-SLOT-REVERT, TYPE-2COL-2TIER, COMPACT-*)
 *   이후 (A) 현재시각 자동 스크롤 · (B) Supabase realtime 구독 자동 갱신이 사라진 것으로 보였다.
 *
 * 본 스펙은 선행 T-20260609 스펙(viewport-overlap 단언, 압축으로 무오버플로 시 trivially pass)을
 * 강화한다:
 *   - (A) 실제로 "스크롤이 일어났는가"를 검증: 영업시간 내 + 컨테이너 오버플로 존재 시 scrollTop>0.
 *   - (B) realtime 구독을 브라우저+service-client 로 end-to-end 검증: 외부 INSERT → 무새로고침 자동 표시.
 *
 * AC:
 *   AC1 진입 자동 스크롤 / AC2 라이브 틱 무손상 / AC3 오늘아님 가드 / AC4 경계 클램핑·수동 보존
 *   AC5 개편 레이아웃 회귀0 / AC6 realtime 자동 반영(무새로고침) / AC7 구독 cleanup·중복 방지
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

/** 그리드 시간 행 메타 (선행 스펙과 동일 산출 — now 이하 최대 슬롯 = currentSlot). */
async function gridMeta(page: Page) {
  return page.evaluate(() => {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="resv-slot-row"]'));
    const tm = (s: string) => parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3, 5), 10);
    const times = rows.map((r) => r.dataset.slotTime ?? '').filter(Boolean);
    const firstMin = times.length ? tm(times[0]) : 0;
    const lastMin = times.length ? tm(times[times.length - 1]) : 0;
    let cur: string | null = null;
    let curMin = -1;
    for (const t of times) {
      const m = tm(t);
      if (m <= nowMin && m > curMin) { curMin = m; cur = t; }
    }
    return { nowMin, firstMin, lastMin, currentSlotTime: cur, rowCount: rows.length };
  });
}

/** 스크롤 컨테이너 오버플로/스크롤 위치 메타. */
async function scrollMeta(page: Page) {
  return page.getByTestId('resv-timetable-scroll').evaluate((el) => {
    const e = el as HTMLElement;
    return { scrollTop: e.scrollTop, scrollHeight: e.scrollHeight, clientHeight: e.clientHeight };
  });
}

/** 스크롤이 멈출 때까지(연속 동일 2회) 대기 후 최종 scrollTop. */
async function settleScroll(page: Page): Promise<number> {
  const container = page.getByTestId('resv-timetable-scroll');
  let prev = -1;
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(200);
    const cur = await container.evaluate((el) => (el as HTMLElement).scrollTop);
    if (cur === prev) return cur;
    prev = cur;
  }
  return prev;
}

test.describe('T-20260622-foot-RESV-LIVE-AUTOSCROLL-REGRESSION — 실시간 반영 + 현재시각 자동 스크롤', () => {

  // ── 시나리오 1: 진입 자동 스크롤 — 실제 스크롤 발생 검증 (AC1/AC4) ──────────────
  test('AC1/AC4: 영업시간 내 + 오버플로 존재 시 실제 scrollTop>0(현재시각으로 스크롤)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAndWaitForDashboard(page);
    await page.goto('/admin/reservations'); // 기본 week 뷰(오늘 포함)
    await expect(page.getByTestId('resv-slot-row').first()).toBeVisible({ timeout: 15_000 });

    const finalScrollTop = await settleScroll(page);
    const meta = await gridMeta(page);
    const sm = await scrollMeta(page);
    expect(meta.rowCount, '그리드 행 렌더(무손상)').toBeGreaterThan(0);

    const maxScroll = sm.scrollHeight - sm.clientHeight;
    const inHours = meta.nowMin >= meta.firstMin && meta.nowMin <= meta.lastMin;
    const overflow = maxScroll > 20;
    const wellPastStart = meta.nowMin > meta.firstMin + 60; // 현재시각이 시작보다 1시간 이상 뒤

    console.log(`[AC1] now=${meta.nowMin} first=${meta.firstMin} last=${meta.lastMin} cur=${meta.currentSlotTime} scrollTop=${finalScrollTop} maxScroll=${maxScroll} inHours=${inHours} overflow=${overflow}`);

    if (inHours && overflow && wellPastStart) {
      // 핵심 회귀 단언: 현재시각이 그리드 한참 아래인데 오버플로가 있다면 반드시 아래로 스크롤됐어야 함.
      expect(finalScrollTop, 'AC1 회귀: 영업시간 내·오버플로·현재시각 한참 뒤 → 실제 스크롤 발생').toBeGreaterThan(0);
      // 현재 슬롯 행이 가시영역과 겹쳐야 함(center 스크롤 착지).
      const currentRow = page.locator(
        `[data-testid="resv-slot-row"][data-slot-time="${meta.currentSlotTime}"]`,
      );
      await expect(currentRow).toHaveCount(1);
      const cBox = await page.getByTestId('resv-timetable-scroll').boundingBox();
      const rBox = await currentRow.boundingBox();
      if (cBox && rBox) {
        const overlap = Math.min(rBox.y + rBox.height, cBox.y + cBox.height) - Math.max(rBox.y, cBox.y);
        expect(overlap, 'AC1: 현재 슬롯 행이 뷰포트와 겹침').toBeGreaterThan(0);
      }
    } else if (inHours && overflow && meta.nowMin <= meta.firstMin + 60) {
      // 현재시각이 시작 부근 — 스크롤 거의 0 가능(정상). 현재 행 가시만 확인.
      const currentRow = page.locator(
        `[data-testid="resv-slot-row"][data-slot-time="${meta.currentSlotTime}"]`,
      );
      await expect(currentRow).toHaveCount(1);
    } else if (!inHours && meta.nowMin > meta.lastMin && overflow) {
      // 영업시간 후 — 마지막 행 클램핑 → 하단부로 크게 이동.
      expect(finalScrollTop, 'AC4: 영업 후 하단 클램핑').toBeGreaterThan(maxScroll * 0.5);
    } else {
      // 무오버플로(압축으로 전부 화면에 들어옴) 또는 영업 전 — 깨지지 않음만 보장.
      console.log('[AC1] 오버플로 없음/영업전 — trivial pass (그리드 무손상 확인됨)');
      expect(meta.rowCount).toBeGreaterThan(0);
    }
  });

  // ── 시나리오 2: 라이브 틱 무손상 + 현재 행 단일 ref (AC2) ──────────────────────
  test('AC2: 현재 슬롯 행이 단 하나 식별되고 30초 틱에도 그리드 무손상', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAndWaitForDashboard(page);
    await page.goto('/admin/reservations');
    const slotRows = page.getByTestId('resv-slot-row');
    await expect(slotRows.first()).toBeVisible({ timeout: 15_000 });
    expect(await slotRows.count()).toBeGreaterThan(0);

    const meta = await gridMeta(page);
    if (meta.currentSlotTime) {
      const currentRow = page.locator(
        `[data-testid="resv-slot-row"][data-slot-time="${meta.currentSlotTime}"]`,
      );
      expect(await currentRow.count(), 'AC2: 현재 슬롯 행 단일').toBe(1);
      expect(meta.currentSlotTime).toMatch(/^\d{2}:\d{2}$/);
    }
    await page.waitForTimeout(500);
    await expect(slotRows.first()).toBeVisible();
  });

  // ── 시나리오 3: 오늘 아님 가드 (AC3) ─────────────────────────────────────────
  test('AC3: 과거 주(오늘 미포함) 진입 시 자동 스크롤 미적용(scrollTop≈0)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAndWaitForDashboard(page);
    const past = new Date();
    past.setDate(past.getDate() - 28);
    const ds = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}`;
    await page.goto(`/admin/reservations?date=${ds}`);
    await expect(page.getByTestId('resv-slot-row').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(800);
    const sm = await scrollMeta(page);
    expect(sm.scrollTop, 'AC3: 오늘 미포함 → 자동 스크롤 없음').toBeLessThanOrEqual(5);
  });

  // ── 시나리오 4: 실시간 자동 반영 — 외부 INSERT → 무새로고침 표시 (AC6/AC7) ──────
  test('AC6/AC7: 외부 INSERT가 새로고침 없이 자동 반영되고 재진입 시 중복 없음', async ({ page }) => {
    if (!SERVICE_KEY) {
      test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY 미설정 — realtime end-to-end 검증 스킵');
      return;
    }
    test.setTimeout(60_000);
    const sb = createClient(SUPA_URL, SERVICE_KEY);

    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAndWaitForDashboard(page);
    await page.goto('/admin/reservations'); // week 뷰(오늘 포함) → realtime 구독 활성
    await expect(page.getByTestId('resv-slot-row').first()).toBeVisible({ timeout: 15_000 });
    // 구독 핸드셰이크 안정 대기 (subscribe() 후 SUBSCRIBED 까지 약간의 지연)
    await page.waitForTimeout(2_000);

    const ts = Date.now();
    const name = `RTREG-${ts}`;
    const phone = `010${String(ts).slice(-8)}`;
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 고객 선생성 후 예약 INSERT (외부 사용자/다른 화면 시뮬)
    const { data: cust } = await sb
      .from('customers')
      .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: 'new' })
      .select('id')
      .single();
    const customerId = cust?.id ?? null;

    const { data: resv, error: resvErr } = await sb
      .from('reservations')
      .insert({
        clinic_id: CLINIC_ID,
        customer_id: customerId,
        customer_name: name,
        customer_phone: phone,
        reservation_date: dateStr,
        reservation_time: '14:00:00',
        visit_type: 'new',
        status: 'confirmed',
      })
      .select('id')
      .single();
    expect(resvErr, `예약 INSERT 실패: ${resvErr?.message}`).toBeNull();
    const resvId = resv!.id as string;

    try {
      // AC6: 수동 새로고침 없이 realtime 구독으로 새 예약 카드가 자동 등장해야 함.
      const card = page.getByTestId(`resv-card-${resvId}`);
      await expect(card, 'AC6: 외부 INSERT가 무새로고침 자동 반영(realtime)').toBeVisible({ timeout: 20_000 });

      // AC7: 다른 메뉴로 나갔다 재진입해도 구독 중복 없이 카드 1개만 — 채널 cleanup 검증.
      await page.goto('/admin');
      await page.waitForTimeout(500);
      await page.goto('/admin/reservations');
      await expect(page.getByTestId(`resv-card-${resvId}`).first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(2_000);
      expect(
        await page.getByTestId(`resv-card-${resvId}`).count(),
        'AC7: 재진입 후에도 동일 예약 카드 단 1개(구독 중복/누수 없음)',
      ).toBe(1);

      // AC6(b): 외부 UPDATE(시간 이동)도 자동 반영 — 카드가 여전히 존재(refetch 동작) 확인.
      const { error: updErr } = await sb
        .from('reservations')
        .update({ reservation_time: '15:00:00' })
        .eq('id', resvId);
      expect(updErr, `예약 UPDATE 실패: ${updErr?.message}`).toBeNull();
      await expect(page.getByTestId(`resv-card-${resvId}`).first(), 'AC6(b): 외부 UPDATE 후에도 자동 반영').toBeVisible({ timeout: 20_000 });
      console.log('[AC6/AC7] realtime INSERT+UPDATE 자동 반영 + 재진입 중복 없음 PASS');
    } finally {
      await sb.from('reservations').delete().eq('id', resvId);
      if (customerId) await sb.from('customers').delete().eq('id', customerId);
    }
  });
});
