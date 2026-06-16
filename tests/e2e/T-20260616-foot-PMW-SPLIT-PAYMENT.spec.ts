/**
 * T-20260616-foot-PMW-SPLIT-PAYMENT
 * 결제 미니창(PaymentMiniWindow) 분할결제 — 하나의 수납 건을 복수 결제수단으로 나눠 받기
 *
 * AC-1: 결제수단 복수 선택 + 각 수단별 금액 입력 (행 추가/삭제 UI)
 * AC-2: 분할 합산 = 수납 총액일 때만 수납 버튼 활성, 불일치 시 차액(부족/초과) 표시 + 비활성
 * AC-3: 수납 확정 시 각 (method, amount)별 payments 행 분리 insert (동일 check_in_id)
 * AC-4: 단일 결제수단(분할 미사용) 기존 동선 회귀 없음 — 1행 insert
 * AC-5: 분할결제 후 수납 완료 상태 전이 정상 (payments 합산=수납액 기준 done)
 * AC-6: 카드 분할 행에 한해 카드 자동매칭 안내 유지
 *
 * 시드: payment_waiting check_in + 저장된 check_in_service(price 100,000) → 미니창 진입 시
 *       saved=true → btn-settle 즉시 노출 → 분할 UI 검증 가능.
 *       시나리오 1·3은 실제 수납까지 실행하므로 매 테스트 전 시드를 재생성(자동 done 후 재사용 불가).
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.BASE_URL ?? 'http://localhost:8089';

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const SEED_PHONE = '+821099998816';
const SEED_NAME = '[PMW-SPLIT-TEST] 수납대기';
const SETTLE_AMOUNT = 100000;

function todaySeoulISO(): string {
  const now = new Date();
  const seoul = new Date(now.getTime() + 9 * 3600 * 1000);
  const y = seoul.getUTCFullYear();
  const m = String(seoul.getUTCMonth() + 1).padStart(2, '0');
  const d = String(seoul.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}T10:30:00+09:00`;
}

let clinicId: string | null = null;
let serviceId: string | null = null;
let serviceName = '시술';
let seededCheckInId: string | null = null;
let seedOk = false;

async function cleanupSeed() {
  // 고유 테스트 전화번호(+821099998816)로만 매칭 — 실고객 보호.
  // (is_simulation=false 시드를 쓰므로 is_simulation 필터 없이 phone 기준 정확 삭제)
  const { data: custs } = await supabase
    .from('customers')
    .select('id')
    .eq('phone', SEED_PHONE);
  const custIds = (custs ?? []).map((c) => c.id);
  if (custIds.length > 0) {
    const { data: cis } = await supabase
      .from('check_ins')
      .select('id')
      .in('customer_id', custIds);
    const ciIds = (cis ?? []).map((c) => c.id);
    if (ciIds.length > 0) {
      await supabase.from('payments').delete().in('check_in_id', ciIds);
      await supabase.from('check_in_services').delete().in('check_in_id', ciIds);
      await supabase.from('status_transitions').delete().in('check_in_id', ciIds);
      await supabase.from('check_ins').delete().in('id', ciIds);
    }
    await supabase.from('customers').delete().in('id', custIds);
  }
}

// 수납대기 환자 1명 + 저장된 수가항목(100,000) 시드 → check_in_id 반환
async function seedPaymentWaiting(): Promise<string | null> {
  if (!clinicId || !serviceId) return null;
  await cleanupSeed();

  const { data: cust, error: custErr } = await supabase
    .from('customers')
    .insert({
      clinic_id: clinicId,
      name: SEED_NAME,
      phone: SEED_PHONE,
      visit_type: 'returning',
      // T-20260610-foot-ADMIN-SIM-FILTER: is_simulation=true 고객은 칸반에서 숨김 →
      //   btn-pay 미노출. 대시보드 진입점 검증을 위해 false로 시드(고유 테스트 전화번호로 정확 cleanup).
      is_simulation: false,
      inflow_channel: 'returning',
    })
    .select('id')
    .single();
  if (custErr || !cust) {
    console.warn('⚠️ 고객 시드 실패:', custErr?.message);
    return null;
  }

  const { data: ci, error: ciErr } = await supabase
    .from('check_ins')
    .insert({
      clinic_id: clinicId,
      customer_id: cust.id,
      customer_name: SEED_NAME,
      customer_phone: SEED_PHONE,
      visit_type: 'returning',
      status: 'payment_waiting',
      queue_number: 9982,
      checked_in_at: todaySeoulISO(),
      sort_order: 9982,
    })
    .select('id')
    .single();
  if (ciErr || !ci) {
    console.warn('⚠️ check_in 시드 실패:', ciErr?.message);
    return null;
  }

  const { error: cisErr } = await supabase.from('check_in_services').insert({
    check_in_id: ci.id,
    service_id: serviceId,
    service_name: serviceName,
    price: SETTLE_AMOUNT,
    original_price: SETTLE_AMOUNT,
    is_package_session: false,
  });
  if (cisErr) {
    console.warn('⚠️ check_in_service 시드 실패:', cisErr.message);
    return null;
  }
  return ci.id;
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
  clinicId = clinic.id;

  const { data: svc } = await supabase
    .from('services')
    .select('id, name')
    .eq('clinic_id', clinic.id)
    .eq('active', true)
    .order('display_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!svc) {
    console.warn('⚠️ 활성 서비스 없음 — 시드 스킵');
    return;
  }
  serviceId = svc.id;
  serviceName = (svc as { name?: string }).name ?? '시술';
  seedOk = true;
});

test.afterAll(async () => {
  await cleanupSeed();
});

// 매 테스트 전 신규 수납대기 시드 재생성 (수납 후 done 전이로 재사용 불가)
test.beforeEach(async () => {
  if (!seedOk) return;
  seededCheckInId = await seedPaymentWaiting();
});

async function openMiniWindow(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/admin`);
  await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => null);
  const payBtn = page.locator('[data-testid="btn-pay"]').first();
  await payBtn.waitFor({ state: 'visible', timeout: 15000 });
  await payBtn.click();
  await page.locator('[data-testid="btn-settle"]').first().waitFor({ timeout: 10000 }).catch(() => null);
}

async function enableSplit(page: import('@playwright/test').Page) {
  const toggle = page.locator('[data-testid="btn-split-toggle"]');
  await expect(toggle).toBeVisible({ timeout: 10000 });
  await toggle.click();
  await expect(page.locator('[data-testid="split-rows"]')).toBeVisible();
}

async function fetchPayments(checkInId: string) {
  const { data } = await supabase
    .from('payments')
    .select('amount, method, check_in_id')
    .eq('check_in_id', checkInId);
  return data ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 정상 동선 — 카드 70,000 + 현금 30,000 분할 → payments 2행 + done 전이
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오1: 카드+현금 분할 수납 → payments 2행 insert + 수납완료(done) 전이 (AC-1/3/5)', async ({ page }) => {
  expect(seedOk, '시드 실패').toBeTruthy();
  expect(seededCheckInId, 'check_in 시드 실패').toBeTruthy();
  const ciId = seededCheckInId!;
  await openMiniWindow(page);

  await enableSplit(page);

  // 1행: 카드 70,000 (토글 시 첫 행은 자동 pre-fill — method=card, amount=displayAmount)
  await page.locator('[data-testid="split-method-0"]').selectOption('card');
  await page.locator('[data-testid="split-amount-0"]').fill('70000');

  // 2행 추가 → 현금 30,000
  await page.locator('[data-testid="btn-split-add"]').click();
  await page.locator('[data-testid="split-method-1"]').selectOption('cash');
  await page.locator('[data-testid="split-amount-1"]').fill('30000');

  // 합산 100,000 = 수납액 → 차액 "일치" + 수납 버튼 활성
  await expect(page.locator('[data-testid="split-diff"]')).toHaveText('일치');
  const settleBtn = page.locator('[data-testid="btn-settle"]');
  await expect(settleBtn).not.toBeDisabled();

  await settleBtn.click();
  await page.waitForTimeout(2500);

  // payments 2행 분리 insert (동일 check_in_id, 카드 70,000 / 현금 30,000)
  const pays = await fetchPayments(ciId);
  expect(pays.length, 'payments 2행 insert').toBe(2);
  const byMethod = Object.fromEntries(pays.map((p) => [p.method, p.amount]));
  expect(byMethod['card']).toBe(70000);
  expect(byMethod['cash']).toBe(30000);

  // AC-5: 수납 완료 상태 전이 (done) — payments 합산=수납액 기준
  const { data: ci } = await supabase
    .from('check_ins')
    .select('status')
    .eq('id', ciId)
    .single();
  expect(ci?.status, 'check_in done 전이').toBe('done');
  console.log('✅ 시나리오1: 분할 2행 insert + done 전이 검증');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 엣지 — 합산 불일치 시 차액 표시 + 수납 버튼 비활성 (AC-2)
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오2: 합산 불일치 시 차액(부족/초과) 표시 + 수납 버튼 비활성 (AC-2)', async ({ page }) => {
  expect(seedOk, '시드 실패').toBeTruthy();
  await openMiniWindow(page);
  await enableSplit(page);

  const settleBtn = page.locator('[data-testid="btn-settle"]');
  const diff = page.locator('[data-testid="split-diff"]');

  // 카드 70,000 + 현금 20,000 (합 90,000) → 10,000 부족 + 비활성
  await page.locator('[data-testid="split-amount-0"]').fill('70000');
  await page.locator('[data-testid="btn-split-add"]').click();
  await page.locator('[data-testid="split-method-1"]').selectOption('cash');
  await page.locator('[data-testid="split-amount-1"]').fill('20000');
  await expect(diff).toHaveText('10,000 부족');
  await expect(settleBtn).toBeDisabled();

  // 현금 행 30,000으로 수정 → 차액 0 일치 + 활성
  await page.locator('[data-testid="split-amount-1"]').fill('30000');
  await expect(diff).toHaveText('일치');
  await expect(settleBtn).not.toBeDisabled();

  // 카드 80,000 + 현금 30,000 (합 110,000) → 10,000 초과 + 비활성
  await page.locator('[data-testid="split-amount-0"]').fill('80000');
  await expect(diff).toHaveText('10,000 초과');
  await expect(settleBtn).toBeDisabled();
  console.log('✅ 시나리오2: 부족/초과 차액 표시 + 버튼 비활성 검증');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 회귀 — 단일 결제수단 (분할 미사용) 종전 동작 1행 insert (AC-4)
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오3: 단일 결제수단 회귀 — 카드 100,000 단일 → payments 1행 insert + done (AC-4)', async ({ page }) => {
  expect(seedOk, '시드 실패').toBeTruthy();
  expect(seededCheckInId, 'check_in 시드 실패').toBeTruthy();
  const ciId = seededCheckInId!;
  await openMiniWindow(page);

  // 분할 미사용 — 단일 카드 선택 (split UI 미노출 확인)
  await expect(page.locator('[data-testid="split-rows"]')).toHaveCount(0);
  await page.locator('button:has-text("카드")').first().click();

  const settleBtn = page.locator('[data-testid="btn-settle"]');
  await expect(settleBtn).not.toBeDisabled();
  await settleBtn.click();
  await page.waitForTimeout(2500);

  const pays = await fetchPayments(ciId);
  expect(pays.length, 'payments 1행 insert (회귀)').toBe(1);
  expect(pays[0].method).toBe('card');
  expect(pays[0].amount).toBe(SETTLE_AMOUNT);

  const { data: ci } = await supabase
    .from('check_ins')
    .select('status')
    .eq('id', ciId)
    .single();
  expect(ci?.status).toBe('done');
  console.log('✅ 시나리오3: 단일 결제 1행 insert 회귀 검증');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-6: 카드 분할 행 있으면 카드 자동매칭 안내 노출
// ─────────────────────────────────────────────────────────────────────────────
test('AC-6: 분할에 카드 행 포함 시 카드 자동매칭 안내 노출', async ({ page }) => {
  expect(seedOk, '시드 실패').toBeTruthy();
  await openMiniWindow(page);
  await enableSplit(page);

  // 1행 카드 → 카드 안내 노출
  await page.locator('[data-testid="split-method-0"]').selectOption('card');
  await expect(page.locator('[data-testid="card-auto-match-info"]')).toBeVisible();

  // 1행을 현금으로 바꾸면(카드 행 0) 안내 숨김
  await page.locator('[data-testid="split-method-0"]').selectOption('cash');
  await expect(page.locator('[data-testid="card-auto-match-info"]')).toHaveCount(0);
  console.log('✅ AC-6: 카드 행 유무에 따른 안내 노출/숨김 검증');
});
