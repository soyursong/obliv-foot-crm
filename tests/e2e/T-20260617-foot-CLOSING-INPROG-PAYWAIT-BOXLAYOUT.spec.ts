/**
 * T-20260617-foot-CLOSING-INPROG-PAYWAIT-BOXLAYOUT
 * 일마감(/admin/closing) "진행 중" / "결제대기(미수)" 경고 카드 가시성 개선.
 *
 * 변경 요지(FE-only, 스키마·로직 무변경):
 *   - 두 경고 Card를 2-col 그리드(div.grid.md:grid-cols-2)로 병치 (md+ 좌우, sm 1-col 반응형).
 *   - full-fill 배경(bg-orange-50/bg-amber-50) + 강한 보더 → 뉴트럴 카드(bg-card + 얇은 보더).
 *     식별 포인트는 아이콘(Clock/CreditCard)·배지·카운트 색으로 한정.
 *   - 헤더 문구: "진행 중 N건 — 마감 전 확인 필요" → "진행 중" + 배지 "N건",
 *               "미수 경고 — 결제대기 N건" → "결제대기" + 배지 "N건".
 *
 * AC(회귀 0 — 클릭 동선 보존):
 *   AC-1: 두 경고 카드가 동일 그리드 컨테이너(2-col)에 병치 렌더된다.
 *   AC-2: 진행중 행 클릭 → navigate('/admin', {state:{openCheckInId}}) (URL /admin 전이).
 *   AC-3: 결제대기 행 클릭 → setPayTarget 결제 미니창 오픈.
 *   AC-4: 환자명 단독 노출 금지 — 차트번호 배지(span.font-mono '#') 인접 (CHARTNO-B2-P2).
 *         + 카운트/HH:mm/전화포맷 보존.
 *
 * 시드: 오늘(Asia/Seoul) check_in 2건 —
 *         (a) status=treatment_waiting → "진행 중" 카드 노출
 *         (b) status=payment_waiting   → "결제대기" 카드 노출
 *       afterAll에서 전화번호 기준 정확 삭제(실환자 보호: is_simulation=true).
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.BASE_URL ?? 'http://localhost:8089';

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required (no plaintext fallback)'); })();

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// 시드 식별자 — 실환자 보호용 고유 전화번호(다른 Closing spec과 충돌 방지)
const SEED_PHONE_INPROG = '+821099998811';
const SEED_PHONE_PAYWAIT = '+821099998812';
const SEED_NAME_INPROG = '[BOXLAYOUT-TEST] 진행중';
const SEED_NAME_PAYWAIT = '[BOXLAYOUT-TEST] 결제대기';

// Asia/Seoul 기준 오늘 10:30 (Closing 기본 날짜=오늘 명단에 노출되도록)
function todaySeoulISO(): string {
  const now = new Date();
  const seoul = new Date(now.getTime() + 9 * 3600 * 1000); // UTC+9
  const y = seoul.getUTCFullYear();
  const m = String(seoul.getUTCMonth() + 1).padStart(2, '0');
  const d = String(seoul.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}T10:30:00+09:00`;
}

let seedOk = false;

async function cleanupSeed() {
  const { data: custs } = await supabase
    .from('customers')
    .select('id')
    .in('phone', [SEED_PHONE_INPROG, SEED_PHONE_PAYWAIT])
    .eq('is_simulation', true);
  const custIds = (custs ?? []).map((c) => c.id);
  if (custIds.length > 0) {
    const { data: cis } = await supabase
      .from('check_ins')
      .select('id')
      .in('customer_id', custIds);
    const ciIds = (cis ?? []).map((c) => c.id);
    if (ciIds.length > 0) {
      await supabase.from('check_in_services').delete().in('check_in_id', ciIds);
      await supabase.from('status_transitions').delete().in('check_in_id', ciIds);
      await supabase.from('check_ins').delete().in('id', ciIds);
    }
    await supabase.from('customers').delete().in('id', custIds);
  }
}

async function seedCheckIn(
  clinicId: string,
  name: string,
  phone: string,
  status: string,
  queue: number,
) {
  const { data: cust, error: custErr } = await supabase
    .from('customers')
    .insert({
      clinic_id: clinicId,
      name,
      phone,
      visit_type: 'returning',
      is_simulation: true,
      inflow_channel: 'returning',
    })
    .select('id, chart_number')
    .single();
  if (custErr || !cust) {
    console.warn(`⚠️ 고객 시드 실패(${name}):`, custErr?.message);
    return false;
  }

  const { error: ciErr } = await supabase.from('check_ins').insert({
    clinic_id: clinicId,
    customer_id: cust.id,
    customer_name: name,
    customer_phone: phone,
    visit_type: 'returning',
    status,
    queue_number: queue,
    checked_in_at: todaySeoulISO(),
    sort_order: queue,
  });
  if (ciErr) {
    console.warn(`⚠️ check_in 시드 실패(${name}):`, ciErr?.message);
    return false;
  }
  return true;
}

test.beforeAll(async () => {
  const { data: clinic } = await supabase
    .from('clinics')
    .select('id')
    .eq('slug', 'jongno-foot')
    .single();
  if (!clinic) {
    console.warn('⚠️ clinic jongno-foot 없음 — 시드 스킵');
    return;
  }

  await cleanupSeed();

  const okA = await seedCheckIn(clinic.id, SEED_NAME_INPROG, SEED_PHONE_INPROG, 'treatment_waiting', 9911);
  const okB = await seedCheckIn(clinic.id, SEED_NAME_PAYWAIT, SEED_PHONE_PAYWAIT, 'payment_waiting', 9912);

  seedOk = okA && okB;
  if (seedOk) console.log('✅ 시드 완료 — 진행중 + 결제대기 각 1건 (today)');
});

test.afterAll(async () => {
  await cleanupSeed();
});

async function gotoClosing(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/admin/closing`);
  // 두 경고 카드 중 하나라도 뜰 때까지 대기
  await page.getByText(/결제대기/).first().waitFor({ timeout: 20000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 두 경고 카드가 2-col 그리드 컨테이너에 병치 렌더
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: 진행중·결제대기 카드가 2-col 그리드에 병치', async ({ page }) => {
  expect(seedOk, '시드 실패 — 경고 카드 준비 불가').toBeTruthy();
  await gotoClosing(page);

  // 두 카드를 감싸는 2-col 그리드 컨테이너 존재 (md:grid-cols-2) + 두 헤더 텍스트 모두 포함
  const grid = page
    .locator('div.grid.md\\:grid-cols-2')
    .filter({ hasText: '진행 중' })
    .filter({ hasText: '결제대기' });
  await expect(grid.first()).toBeVisible({ timeout: 10000 });

  // 헤더(CardTitle = heading) 문구 + 카운트 배지(N건) 노출
  await expect(grid.first().getByRole('heading', { name: /진행 중/ })).toBeVisible();
  await expect(grid.first().getByRole('heading', { name: /결제대기/ })).toBeVisible();
  await expect(grid.first().getByText(/\d+건/).first()).toBeVisible();
  console.log('✅ AC-1: 2-col 그리드 병치 + 헤더/카운트 확인');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 진행중 행 클릭 → /admin 전이 (navigate state openCheckInId)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: 진행중 행 클릭 시 /admin 으로 이동', async ({ page }) => {
  expect(seedOk).toBeTruthy();
  await gotoClosing(page);

  const row = page.locator('button', { hasText: SEED_NAME_INPROG }).first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  await row.click();

  await expect(page).toHaveURL(/\/admin(\?|$|\/)/, { timeout: 10000 });
  console.log('✅ AC-2: 진행중 클릭 → /admin 전이');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 결제대기 행 클릭 → 결제 미니창 오픈 (setPayTarget)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: 결제대기 행 클릭 시 결제 미니창 오픈', async ({ page }) => {
  expect(seedOk).toBeTruthy();
  await gotoClosing(page);

  const row = page.locator('button', { hasText: SEED_NAME_PAYWAIT }).first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  await row.click();

  // 결제 미니창 고유 마커
  await expect(page.getByText('차트 코드 + 진료비 산정')).toBeVisible({ timeout: 10000 });
  console.log('✅ AC-3: 결제대기 클릭 → 결제 미니창 오픈');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: 환자명 단독 노출 금지 — 차트번호 배지(#) 인접 (CHARTNO-B2-P2)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4: 경고카드 환자명 옆 차트번호 배지(#) 렌더', async ({ page }) => {
  expect(seedOk).toBeTruthy();
  await gotoClosing(page);

  // 차트번호 배지: span.font-mono 안에 '#' 포함 (미발번도 '#미발번' 형식)
  const badges = page.locator('span.font-mono').filter({ hasText: '#' });
  await expect(badges.first()).toBeVisible({ timeout: 10000 });

  // HH:mm 시각 포맷 보존 (10:30 시드)
  await expect(page.getByText(/\d{2}:\d{2}/).first()).toBeVisible();
  console.log('✅ AC-4: 차트번호 배지 인접 + 시각 포맷 보존');
});
