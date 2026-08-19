/**
 * E2E spec — T-20260819-foot-DASHBOARD-LASER-FONT-BOLD
 * 대시보드 고객박스 "레이저 잔여시간"("남은 N분 N초") + 종료("완료") 표기 가독성 개선.
 * 현장(김주연 총괄, C0ATE5P6JTH) 스샷 F0BRANALJKE — 폰트/굵기 때문에 너무 안보임.
 *
 * ★ 조사 게이트 결론(대상 요소 특정 = 스샷 좌표 근거):
 *   스샷 빨간박스 2종(이진호 카드 "남은 2분 36초" / 김다연 카드 종료표기)은 모두 카드 배지행
 *   우측 끝(ml-auto)의 동일 컴포넌트 TimerCountdown(data-testid=card-timer-countdown) 출력이다.
 *     - 활성(ends_at 미래)  → remainingLabel="남은 N분 N초" (text-blue-700)
 *     - 종료(ends_at 과거, stopped_at=null) → remainingLabel="종료" (text-red-700)
 *   카드에 "완료" 리터럴 렌더는 없음(grep 확인). 미수 배지(OutstandingDueBadge)="미수"로 별개.
 *   → 현장 "완료"는 종료(finished) 표기를 지칭. 단일 컴포넌트 굵기/대비만 상향해 2종 동시 개선.
 *
 * 조치(표시 스타일만, behavior/텍스트/데이터/계산/레이아웃 무변경):
 *   TimerCountdown: font-semibold(600) → font-bold(700), 색 대비 600→700 shade.
 *   래퍼 폰트크기 text-[10px]→[11px] (compact) / text-[9px]→[10px] (non-compact).
 *
 * 시나리오:
 *   S-0: 활성 타이머 카드 → "남은…" 표기가 font-weight 700(bold)로 렌더 (가독성)
 *   S-1: 종료 타이머 카드(ends_at 과거·stopped_at null) → "종료" 표기도 font-weight 700(bold)
 *   S-2: 카운트다운 래퍼 폰트크기 ≥ 10px (기존 9~10px 대비 상향, 가독성)
 *
 * Supabase service env 미설정 시에만 skip (정당한 환경 예외).
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAndWaitForDashboard } from '../helpers';

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLINIC_ID = process.env.FIXTURE_CLINIC_ID ?? '74967aea-a60b-4da3-a0e7-9c997a930bc8';

const seedReady = Boolean(SUPA_URL && SERVICE_KEY);

let sb: SupabaseClient | null = null;
// 활성 타이머(미래) 카드
let ciActive: string | null = null;
let custActive: string | null = null;
let timerActiveId: string | null = null;
// 종료 타이머(과거) 카드
let ciExpired: string | null = null;
let custExpired: string | null = null;
let timerExpiredId: string | null = null;

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
      // 카운트다운은 status 무관하게 activeTimersMap(timerEndsAt) 기준 렌더 (T-20260808 검증 패턴 재사용).
      status: 'treatment_waiting',
      queue_number: 9500 + (Date.now() % 400),
    })
    .select('id')
    .single();
  if (ciErr || !checkIn) throw new Error(`[seed] 체크인 생성 실패: ${ciErr?.message ?? 'no row'}`);
  return { customerId: customer.id as string, checkInId: checkIn.id as string };
}

async function seedTimer(client: SupabaseClient, checkInId: string, endsAt: Date, startedAt: Date) {
  const { data: timer, error: tErr } = await client
    .from('timer_records')
    .insert({
      check_in_id: checkInId,
      clinic_id: CLINIC_ID,
      duration_minutes: 5,
      started_at: startedAt.toISOString(),
      ends_at: endsAt.toISOString(),
      // stopped_at=null → activeTimersMap(.is('stopped_at', null))에 잔존 → 종료(과거)도 "종료" 렌더.
    })
    .select('id')
    .single();
  if (tErr || !timer) throw new Error(`[seed] 타이머 생성 실패: ${tErr?.message ?? 'no row'}`);
  return timer.id as string;
}

test.describe('T-20260819-foot-DASHBOARD-LASER-FONT-BOLD — 고객박스 레이저 잔여시간/종료 표기 굵기 상향', () => {
  test.beforeAll(async () => {
    if (!seedReady) return;
    sb = createClient(SUPA_URL, SERVICE_KEY);

    const a = await seedCard(sb, `laser-font-active-${Date.now()}`);
    custActive = a.customerId;
    ciActive = a.checkInId;
    const e = await seedCard(sb, `laser-font-expired-${Date.now() + 1}`);
    custExpired = e.customerId;
    ciExpired = e.checkInId;

    const now = new Date();
    // 활성: 5분 뒤 종료 → "남은 4분 5x초"
    timerActiveId = await seedTimer(sb, ciActive, new Date(now.getTime() + 5 * 60 * 1000), now);
    // 종료: 이미 3분 전 종료(과거) but stopped_at null → "종료" 표기
    timerExpiredId = await seedTimer(sb, ciExpired, new Date(now.getTime() - 3 * 60 * 1000), new Date(now.getTime() - 8 * 60 * 1000));
    console.log(`[seed] active=${ciActive}(t=${timerActiveId}) expired=${ciExpired}(t=${timerExpiredId})`);
  });

  test.afterAll(async () => {
    if (!sb) return;
    for (const t of [timerActiveId, timerExpiredId]) if (t) await sb.from('timer_records').delete().eq('id', t);
    for (const ci of [ciActive, ciExpired]) {
      if (ci) {
        await sb.from('timer_records').delete().eq('check_in_id', ci);
        await sb.from('check_ins').delete().eq('id', ci);
      }
    }
    for (const c of [custActive, custExpired]) if (c) await sb.from('customers').delete().eq('id', c);
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

  // S-0: 활성 카드 "남은…" 표기가 font-weight 700(bold)
  test('S-0: 레이저 잔여시간("남은…") 표기가 굵게(font-weight 700) 렌더', async ({ page }) => {
    await gotoDashboard(page);
    const card = cardLocator(page, ciActive!);
    await card.waitFor({ state: 'visible', timeout: 15_000 });
    const countdown = card.locator('[data-testid="card-timer-countdown"]');
    await expect(countdown).toBeVisible({ timeout: 10_000 });
    await expect(countdown).toContainText('남은');
    const weight = await countdown.evaluate((el) => getComputedStyle(el).fontWeight);
    expect(weight, `잔여시간 표기 font-weight 미상향 (got=${weight})`).toBe('700');
  });

  // S-1: 종료 카드 "종료"(현장 "완료") 표기도 font-weight 700(bold)
  test('S-1: 종료("완료") 표기도 굵게(font-weight 700) 렌더', async ({ page }) => {
    await gotoDashboard(page);
    const card = cardLocator(page, ciExpired!);
    await card.waitFor({ state: 'visible', timeout: 15_000 });
    const countdown = card.locator('[data-testid="card-timer-countdown"]');
    await expect(countdown).toBeVisible({ timeout: 10_000 });
    await expect(countdown).toContainText('종료');
    const weight = await countdown.evaluate((el) => getComputedStyle(el).fontWeight);
    expect(weight, `종료 표기 font-weight 미상향 (got=${weight})`).toBe('700');
  });

  // S-2: 카운트다운 래퍼 폰트크기 ≥ 10px (기존 9~10px 대비 상향)
  test('S-2: 카운트다운 표기 폰트크기 ≥ 10px (가독성 상향)', async ({ page }) => {
    await gotoDashboard(page);
    const card = cardLocator(page, ciActive!);
    await card.waitFor({ state: 'visible', timeout: 15_000 });
    const countdown = card.locator('[data-testid="card-timer-countdown"]');
    await expect(countdown).toBeVisible({ timeout: 10_000 });
    const px = await countdown.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(px, `카운트다운 폰트크기 미상향 (got=${px}px)`).toBeGreaterThanOrEqual(10);
  });
});
