/**
 * E2E spec — T-20260529-foot-CHART-OPEN-FAIL
 * 대시보드 초진 섹션 — 오인숙 고객 차트 열기 실패 버그 수정 검증
 *
 * 근본 원인: 예약(reservation) customer_id = null 인 경우
 *   handleReservationSelect → if (res.customer_id) 가드 실패 → 아무 반응 없음
 * 수정: customer_id null 이면 customer_name 으로 동일 클리닉 단일 매칭 고객을
 *   자동 조회(fallback)하여 차트 오픈 + 예약에 customer_id 백필.
 *
 * ── 검증 전략 (phase2 insufficient_verification 보강) ────────────────────────
 * 기존 spec 은 "오늘 대시보드에 오인숙/초진 카드가 실제 존재"에 의존 → 날짜가 지나면
 * 3개 AC 가 전부 skip 되어 무의미한 검증이었음.
 * → SUPABASE_SERVICE_ROLE_KEY(.env 로드됨)로 beforeAll 에서 **오늘 날짜 초진 예약을
 *   결정론적으로 seed** 하고 afterAll 에서 정리. 날짜·라이브 데이터와 무관하게 항상 검증.
 *
 * AC-1: customer_id 있는 초진 예약 카드 클릭 → 차트 시트 오픈 (직접 경로)
 * AC-2: customer_id = null 예약을 이름으로 1건 조회 → 차트 오픈 (fallback 핵심 버그)
 * AC-3: customer_id null 예약 클릭 후 reservations.customer_id 백필 확인 + 회귀 없음
 * AC-4: 실제 오인숙 예약 DB 수정 결과(customer_id 연결) 확인
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAndWaitForDashboard } from '../helpers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_SLUG = 'jongno-foot';

// ── seed 식별자 (afterAll 정리용) ─────────────────────────────────────────────
const SUFFIX = `${Date.now().toString().slice(-7)}`;
const NAME_DIRECT = `E2E자동직접${SUFFIX}`;   // AC-1: customer_id 연결된 케이스
const NAME_FALLBACK = `E2E자동누락${SUFFIX}`; // AC-2/3: customer_id null → 이름 fallback 케이스

interface SeedIds {
  clinicId: string;
  customerDirectId: string;
  customerFallbackId: string;
  resvDirectId: string;
  resvFallbackId: string;
}
let seed: SeedIds | null = null;
let admin: SupabaseClient | null = null;

/** Asia/Seoul 기준 오늘 (YYYY-MM-DD) — 대시보드 dateStr 과 일치 */
function todayKST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

/** 차트 시트 오픈 대기 — customer-chart-sheet OR chart-info-panel OR SMART DOCTOR 헤더 */
async function waitForChartOpen(page: Page, timeout = 10_000): Promise<boolean> {
  return Promise.race([
    page.locator('[data-testid="customer-chart-sheet"]')
      .waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false),
    page.locator('[data-testid="chart-info-panel"]')
      .waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false),
    page.getByText('SMART DOCTOR — 고객정보')
      .waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false),
    new Promise<boolean>((r) => setTimeout(() => r(false), timeout + 100)),
  ]);
}

test.describe('T-20260529 CHART-OPEN-FAIL — 초진 차트 열기 수정 검증', () => {
  // ── seed: 오늘 날짜 초진 예약 2건(직접/누락) + 고객 2건 ────────────────────────
  test.beforeAll(async () => {
    if (!SERVICE_KEY) return; // SERVICE_KEY 없으면 seed 불가 → 각 테스트가 환경 스킵 처리
    admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: clinic, error: clinicErr } = await admin
      .from('clinics').select('id').eq('slug', CLINIC_SLUG).single();
    if (clinicErr || !clinic) throw new Error(`clinic(${CLINIC_SLUG}) 조회 실패: ${clinicErr?.message}`);
    const clinicId = clinic.id as string;
    const date = todayKST();

    // 고객 2명 등록 (이름은 SUFFIX 로 클리닉 내 유일 보장 → fallback 단일 매칭)
    const { data: custDirect, error: cdErr } = await admin.from('customers')
      .insert({ clinic_id: clinicId, name: NAME_DIRECT, phone: `+8201${SUFFIX}01` })
      .select('id').single();
    if (cdErr || !custDirect) throw new Error(`customer(direct) seed 실패: ${cdErr?.message}`);

    const { data: custFallback, error: cfErr } = await admin.from('customers')
      .insert({ clinic_id: clinicId, name: NAME_FALLBACK, phone: `+8201${SUFFIX}02` })
      .select('id').single();
    if (cfErr || !custFallback) throw new Error(`customer(fallback) seed 실패: ${cfErr?.message}`);

    // 예약 2건: 오늘·초진(new)·confirmed → box1(셀프접수 대기) 카드로 렌더
    const { data: resvDirect, error: rdErr } = await admin.from('reservations')
      .insert({
        clinic_id: clinicId, customer_id: custDirect.id, customer_name: NAME_DIRECT,
        reservation_date: date, reservation_time: '11:00:00', visit_type: 'new', status: 'confirmed',
      }).select('id').single();
    if (rdErr || !resvDirect) throw new Error(`reservation(direct) seed 실패: ${rdErr?.message}`);

    // 핵심: customer_id = null (버그 재현 조건) — 이름은 custFallback 과 동일
    const { data: resvFallback, error: rfErr } = await admin.from('reservations')
      .insert({
        clinic_id: clinicId, customer_id: null, customer_name: NAME_FALLBACK,
        reservation_date: date, reservation_time: '11:30:00', visit_type: 'new', status: 'confirmed',
      }).select('id').single();
    if (rfErr || !resvFallback) throw new Error(`reservation(fallback) seed 실패: ${rfErr?.message}`);

    seed = {
      clinicId,
      customerDirectId: custDirect.id, customerFallbackId: custFallback.id,
      resvDirectId: resvDirect.id, resvFallbackId: resvFallback.id,
    };
  });

  // ── cleanup: 예약 → 고객 순서 (FK) · best-effort ──────────────────────────────
  test.afterAll(async () => {
    if (!admin || !seed) return;
    await admin.from('reservations').delete().in('id', [seed.resvDirectId, seed.resvFallbackId]);
    await admin.from('customers').delete().in('id', [seed.customerDirectId, seed.customerFallbackId]);
  });

  test.beforeEach(async ({ page }) => {
    if (!SERVICE_KEY || !seed) test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY 없음 — seed 불가, 환경 스킵');
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패 — 스킵');
  });

  // ── AC-1: customer_id 있는 초진 카드 클릭 → 차트 시트 오픈 (직접 경로) ──────────
  test('AC-1: 초진 예약(customer_id 연결) 카드 클릭 시 고객 차트 열림', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const card = page.locator('[data-testid="box1-resv-card"]').filter({ hasText: NAME_DIRECT });
    await expect(card, 'seed 한 직접 예약 카드가 box1 에 렌더되어야 함').toHaveCount(1, { timeout: 10_000 });

    await card.first().click();
    const opened = await waitForChartOpen(page);
    expect(opened, 'customer_id 연결 예약 클릭 시 차트가 열려야 함').toBe(true);
  });

  // ── AC-2: customer_id null 예약 → 이름 fallback → 차트 오픈 (핵심 버그) ─────────
  test('AC-2: customer_id 누락 예약 클릭 시 이름 fallback 으로 차트 열림', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    const card = page.locator('[data-testid="box1-resv-card"]').filter({ hasText: NAME_FALLBACK });
    await expect(card, 'seed 한 누락 예약 카드가 box1 에 렌더되어야 함').toHaveCount(1, { timeout: 10_000 });

    await card.first().click();
    // 버그 수정 전: 아무 반응 없음 / 수정 후: 이름 단일매칭 → 차트 오픈
    const opened = await waitForChartOpen(page);
    expect(opened, 'customer_id null 이어도 이름 fallback 으로 차트가 열려야 함 (회귀 시 버그 재발)').toBe(true);
  });

  // ── AC-3: fallback 클릭 후 reservations.customer_id 백필 + 회귀 없음 ───────────
  test('AC-3: fallback 클릭 후 예약 customer_id 백필 + 직접 예약 회귀 없음', async ({ page }) => {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });

    // fallback 카드 클릭 → 백그라운드에서 reservations.customer_id 자동 연결
    const fbCard = page.locator('[data-testid="box1-resv-card"]').filter({ hasText: NAME_FALLBACK });
    await expect(fbCard).toHaveCount(1, { timeout: 10_000 });
    await fbCard.first().click();
    expect(await waitForChartOpen(page)).toBe(true);

    // 백필 반영 대기 후 DB 직접 확인 (handler 의 background update)
    await expect.poll(async () => {
      const { data } = await admin!.from('reservations')
        .select('customer_id').eq('id', seed!.resvFallbackId).single();
      return data?.customer_id ?? null;
    }, { timeout: 8_000, message: 'fallback 예약 customer_id 가 백필되어야 함' })
      .toBe(seed!.customerFallbackId);

    // 회귀: 직접 예약 카드도 여전히 정상 오픈
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
    const dirCard = page.locator('[data-testid="box1-resv-card"]').filter({ hasText: NAME_DIRECT });
    await expect(dirCard).toHaveCount(1, { timeout: 10_000 });
    await dirCard.first().click();
    expect(await waitForChartOpen(page), '직접 예약 회귀 없음').toBe(true);
  });

  // ── AC-4: 실제 오인숙 예약 DB 수정 결과 확인 ───────────────────────────────────
  test('AC-4: 실제 오인숙 예약(2026-05-29) customer_id 연결 확인', async () => {
    if (!SERVICE_KEY) {
      test.skip(true, 'SUPABASE_SERVICE_ROLE_KEY 없음 — 스킵');
      return;
    }
    const { data } = await admin!
      .from('reservations')
      .select('id, customer_id, customer_name')
      .eq('id', '066b2cc3-af5a-4745-87fd-4c48b09a1a02')
      .single();

    expect(data).not.toBeNull();
    expect(data?.customer_id).toBe('edaba167-f53f-472f-b17a-39d636e5860f');
  });
});
