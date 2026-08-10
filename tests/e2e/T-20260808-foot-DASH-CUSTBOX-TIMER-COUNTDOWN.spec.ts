/**
 * E2E spec — T-20260808-foot-DASH-CUSTBOX-TIMER-COUNTDOWN
 * 2번차트 2구역 레이저 타이머 설정 시 → 대시보드 고객박스 우측 하단에
 * "남은 N분 N초" 실시간 카운트다운 표시.
 *
 * ★ 착수 전 조사 게이트 결론(구현 근거):
 *   1) 기존 대시보드 카드는 경과(count-up) mm:ss(stage_started_at 기준)만 표시.
 *      요청은 레이저 타이머(timer_records.ends_at) 남은시간 카운트다운 → 별도 신규 위젯 아님.
 *      대시보드는 이미 timer_records 를 Realtime 구독해 activeTimersMap(check_in_id→ends_at)을
 *      만들어 amber/red 깜빡임에만 사용 중 → 그 소스를 카드로 노출하는 "표시 배선갭"을 해소.
 *   2) 저장 위치 = timer_records.ends_at (기존). 신규 DB 필드 불필요 → db_change=false, DA CONSULT 불요.
 *   3) 실시간 tick = TimerCountdown 컴포넌트 자체 1초 setInterval(클라이언트 계산). 서버폴링 0(egress 안전).
 *      활성 타이머 보유 카드에서만 마운트 → 전체 카드 초당 re-render 없음.
 *
 * 위치 SSOT = 총괄 빨간박스 스샷(고객박스 우측 하단). 스샷 도착 후 픽셀정밀 재확정 가능.
 *   본 spec 은 "우측 하단 카운트다운 표시 + 실시간 감소 + 타이머 없는 카드 미표시" 동작을 검증한다.
 *
 * 시나리오:
 *   S-0: 활성 타이머 시드 카드 → 대시보드에서 우측 하단 카운트다운(card-timer-countdown) "남은" 표시
 *   S-1: 카운트다운이 실시간으로 감소(2초 후 표시값 변화) — 클라이언트 tick 검증
 *   S-2: 타이머 없는 카드는 카운트다운 행(card-timer-countdown-row) 미표시 (조건부 렌더)
 *
 * Supabase service env 미설정 시에만 skip (정당한 환경 예외).
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// 종로 풋센터 clinic_id (기존 spec 과 동일 상수)
const CLINIC_ID = process.env.FIXTURE_CLINIC_ID ?? '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // FIXTURE_CLINIC_ID: DEVDB-ISOLATION-CUTOVER leg-A(OFF=prod 상수 불변)

const seedReady = Boolean(SUPA_URL && SERVICE_KEY);

let sb: SupabaseClient | null = null;
// 타이머 有 카드
let ciWithTimer: string | null = null;
let custWithTimer: string | null = null;
// 타이머 無 카드
let ciNoTimer: string | null = null;
let custNoTimer: string | null = null;
let timerRecordId: string | null = null;

async function seedCard(client: SupabaseClient, name: string) {
  const phone = `DUMMY-${Date.now()}-${Math.floor((Date.now() % 9973))}`;
  const { data: customer, error: custErr } = await client
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name, phone, visit_type: 'returning' })
    .select('id')
    .single();
  if (custErr || !customer) throw new Error(`[seed] 고객 생성 실패: ${custErr?.message ?? 'no row'}`);

  const { data: checkIn, error: ciErr } = await client
    .from('check_ins')
    .insert({
      clinic_id: CLINIC_ID,
      customer_id: customer.id,
      customer_name: name,
      customer_phone: phone,
      visit_type: 'returning',
      // 카운트다운은 status 무관하게 activeTimersMap(timerEndsAt) 기준으로 렌더됨.
      // 'laser'는 룸 슬롯 배정 전 칸반 미노출 → 검증된 seed 패턴(T-20260523)과 동일하게 treatment_waiting 사용.
      status: 'treatment_waiting',
      queue_number: 9500 + (Date.now() % 400),
    })
    .select('id')
    .single();
  if (ciErr || !checkIn) throw new Error(`[seed] 체크인 생성 실패: ${ciErr?.message ?? 'no row'}`);
  return { customerId: customer.id as string, checkInId: checkIn.id as string };
}

test.describe('T-20260808-foot-DASH-CUSTBOX-TIMER-COUNTDOWN — 대시보드 고객박스 우측 하단 남은시간 카운트다운', () => {
  test.beforeAll(async () => {
    if (!seedReady) return;
    sb = createClient(SUPA_URL, SERVICE_KEY);

    const withT = await seedCard(sb, `timer-countdown-qa-${Date.now()}`);
    custWithTimer = withT.customerId;
    ciWithTimer = withT.checkInId;

    const noT = await seedCard(sb, `no-timer-qa-${Date.now() + 1}`);
    custNoTimer = noT.customerId;
    ciNoTimer = noT.checkInId;

    // 활성 타이머 시드 — ends_at 을 미래(약 5분 뒤)로 두어 카운트다운 "남은 4분 5x초"류 표시
    const now = new Date();
    const ends = new Date(now.getTime() + 5 * 60 * 1000);
    const { data: timer, error: tErr } = await sb
      .from('timer_records')
      .insert({
        check_in_id: ciWithTimer,
        clinic_id: CLINIC_ID,
        duration_minutes: 5,
        started_at: now.toISOString(),
        ends_at: ends.toISOString(),
      })
      .select('id')
      .single();
    if (tErr || !timer) throw new Error(`[seed] 타이머 생성 실패: ${tErr?.message ?? 'no row'}`);
    timerRecordId = timer.id;
    console.log(`[seed] 타이머 有 카드=${ciWithTimer}, 無 카드=${ciNoTimer}, timer=${timerRecordId}`);
  });

  test.afterAll(async () => {
    if (!sb) return;
    if (timerRecordId) await sb.from('timer_records').delete().eq('id', timerRecordId);
    for (const ci of [ciWithTimer, ciNoTimer]) {
      if (ci) {
        await sb.from('timer_records').delete().eq('check_in_id', ci);
        await sb.from('check_ins').delete().eq('id', ci);
      }
    }
    for (const c of [custWithTimer, custNoTimer]) {
      if (c) await sb.from('customers').delete().eq('id', c);
    }
    console.log('[seed] 정리 완료');
  });

  test.beforeEach(async ({ page }) => {
    if (!seedReady) {
      test.skip(true, 'Supabase service env(VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) 미설정 — 시드 불가, 스킵');
      return;
    }
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, '로그인 실패');
  });

  async function gotoDashboard(page: Page) {
    await page.goto('/admin');
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 15_000 });
  }

  function cardLocator(page: Page, checkInId: string) {
    return page.locator(`[data-testid="checkin-card"][data-checkin-id="${checkInId}"]`).first();
  }

  // S-0: 활성 타이머 시드 카드 → 우측 하단 카운트다운 "남은" 표시
  test('S-0: 타이머 있는 카드는 우측 하단에 "남은 N분 N초" 카운트다운 표시', async ({ page }) => {
    await gotoDashboard(page);
    const card = cardLocator(page, ciWithTimer!);
    await card.waitFor({ state: 'visible', timeout: 15_000 });

    const countdown = card.locator('[data-testid="card-timer-countdown"]');
    await expect(countdown).toBeVisible({ timeout: 10_000 });
    await expect(countdown).toContainText('남은');
    // 5분 시드 → 분 단위 표기 확인
    await expect(countdown).toContainText('분');
  });

  // S-1: 카운트다운 실시간 감소 (2.2초 후 표시값 변화)
  test('S-1: 카운트다운이 실시간으로 감소 (클라이언트 tick)', async ({ page }) => {
    await gotoDashboard(page);
    const card = cardLocator(page, ciWithTimer!);
    await card.waitFor({ state: 'visible', timeout: 15_000 });
    const countdown = card.locator('[data-testid="card-timer-countdown"]');
    await expect(countdown).toBeVisible({ timeout: 10_000 });

    const first = (await countdown.textContent())?.trim() ?? '';
    await page.waitForTimeout(2200); // 자체 1초 setInterval → 최소 2회 tick
    const second = (await countdown.textContent())?.trim() ?? '';
    expect(first, '카운트다운 초기값 비어있음').not.toBe('');
    expect(second, `카운트다운이 감소하지 않음 (first=${first}, second=${second})`).not.toBe(first);
  });

  // S-2: 타이머 없는 카드는 카운트다운 행 미표시
  test('S-2: 타이머 없는 카드는 카운트다운 행(card-timer-countdown-row) 미표시', async ({ page }) => {
    await gotoDashboard(page);
    const card = cardLocator(page, ciNoTimer!);
    await card.waitFor({ state: 'visible', timeout: 15_000 });

    await expect(card.locator('[data-testid="card-timer-countdown-row"]')).toHaveCount(0);
  });
});
