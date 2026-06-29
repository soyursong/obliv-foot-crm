/**
 * T-20260620-foot-PMW-OUTSTANDING-PREFILL
 * 결제 미니창(PaymentMiniWindow) 미수금(잔금) 표면화 — 미수금 있는 고객 PMW 진입 시 담당자 즉시 인지.
 *
 * ★ 본 1차 구현 = 읽기 전용 미수금 배너.
 *   - 소스 = footBilling.loadCustomerOutstanding (T-20260616-foot-PKG-OUTSTANDING-BALANCE SSOT) 재사용, 신규 산출 0.
 *   - §4-A: 패키지 잔금 / 진료비 잔금 **별도 줄**(합산 단일 '총 미수금' 표기 금지).
 *   - 하드가드: payments 쓰기 경로/일마감 집계 불변(배너는 표시 전용 — amount 에 영향 없음).
 *     → "결제금액 자동 prefill" 은 PMW 가 항목기반(payable=grandTotal)이고, 미수금을 payments 로
 *        넣으면 당일매출 과대계상 + package_payments 미반영(패키지 여전히 미수)되는 정합 리스크가 있어
 *        planner FOLLOWUP 으로 방향 확정 후 진행(본 스펙 범위 아님).
 *
 * 시나리오(티켓 §5 → PMW 적용):
 *   1. 미수금 있는 고객 PMW 진입 → 배너 노출 + 패키지 잔금 별도 줄 + §4-A(총 미수금 라벨 없음)
 *   2. 미수금 0(완납) 고객 PMW 진입 → 배너 미노출
 *   3. 회귀 가드: 배너가 있어도 단일 카드 수납 시 payments=시술금액(grandTotal)만 insert
 *      (미수금이 결제 amount 에 섞이지 않음 — write 경로 불변)
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

// 미수금 있는 고객(활성 패키지 무결제 → packageDue>0) — 시술 1건 저장(saved=true)
const DUE_PHONE = '+821099998821';
const DUE_NAME = '[PMW-PREFILL-TEST] 미수금';
const DUE_OUTSTANDING = 360000; // 패키지 총액(무결제) → packageDue = 360,000

// 완납 고객(packageDue=0) — 배너 미노출 검증
const PAID_PHONE = '+821099998822';
const PAID_NAME = '[PMW-PREFILL-TEST] 완납';
const PAID_AMOUNT = 200000;

const SETTLE_AMOUNT = 100000; // 당일 시술금액(grandTotal) — 미수금과 명확히 구분되는 값

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
let dueCheckInId: string | null = null;
let paidCheckInId: string | null = null;
let seedOk = false;

async function cleanupByPhone(phone: string) {
  const { data: custs } = await supabase.from('customers').select('id').eq('phone', phone);
  const custIds = (custs ?? []).map((c) => c.id);
  if (custIds.length === 0) return;
  const { data: pkgs } = await supabase.from('packages').select('id').in('customer_id', custIds);
  const pkgIds = (pkgs ?? []).map((p) => p.id);
  if (pkgIds.length > 0) {
    await supabase.from('package_payments').delete().in('package_id', pkgIds);
    await supabase.from('packages').delete().in('id', pkgIds);
  }
  const { data: cis } = await supabase.from('check_ins').select('id').in('customer_id', custIds);
  const ciIds = (cis ?? []).map((c) => c.id);
  if (ciIds.length > 0) {
    await supabase.from('payments').delete().in('check_in_id', ciIds);
    await supabase.from('check_in_services').delete().in('check_in_id', ciIds);
    await supabase.from('status_transitions').delete().in('check_in_id', ciIds);
    await supabase.from('check_ins').delete().in('id', ciIds);
  }
  await supabase.from('customers').delete().in('id', custIds);
}

/** 수납대기 체크인 + 저장된 시술(100,000) 시드 → check_in_id. (PMW 진입 시 saved=true) */
async function seedCheckIn(
  customerId: string,
  name: string,
  phone: string,
  queue: number,
): Promise<string | null> {
  const { data: ci, error: ciErr } = await supabase
    .from('check_ins')
    .insert({
      clinic_id: clinicId,
      customer_id: customerId,
      customer_name: name,
      customer_phone: phone,
      visit_type: 'returning',
      status: 'payment_waiting',
      queue_number: queue,
      checked_in_at: todaySeoulISO(),
      sort_order: queue,
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

async function reseed() {
  await cleanupByPhone(DUE_PHONE);
  await cleanupByPhone(PAID_PHONE);

  // ── DUE: 활성 패키지(무결제 → packageDue=360,000) + 당일 수납대기(시술 100,000) ──
  const { data: dueCust } = await supabase
    .from('customers')
    .insert({
      clinic_id: clinicId,
      name: DUE_NAME,
      phone: DUE_PHONE,
      visit_type: 'returning',
      is_simulation: false, // 칸반 노출(btn-pay) 위해 false
      inflow_channel: 'returning',
    })
    .select('id')
    .single();
  if (dueCust) {
    const { error: pkgErr } = await supabase.from('packages').insert({
      clinic_id: clinicId,
      customer_id: dueCust.id,
      package_name: '미수금 프리필 테스트 패키지',
      package_type: 'preset_6',
      total_sessions: 6,
      total_amount: DUE_OUTSTANDING,
      paid_amount: 0,
      status: 'active',
    });
    if (!pkgErr) {
      dueCheckInId = await seedCheckIn(dueCust.id, DUE_NAME, DUE_PHONE, 9821);
    } else {
      console.warn('⚠️ DUE 패키지 시드 실패:', pkgErr.message);
    }
  }

  // ── PAID: 활성 패키지 전액결제(packageDue=0) + 당일 수납대기 ──
  const { data: paidCust } = await supabase
    .from('customers')
    .insert({
      clinic_id: clinicId,
      name: PAID_NAME,
      phone: PAID_PHONE,
      visit_type: 'returning',
      is_simulation: false,
      inflow_channel: 'returning',
    })
    .select('id')
    .single();
  if (paidCust) {
    const { data: paidPkg, error: pkgErr } = await supabase
      .from('packages')
      .insert({
        clinic_id: clinicId,
        customer_id: paidCust.id,
        package_name: '완납 프리필 테스트 패키지',
        package_type: 'preset_6',
        total_sessions: 6,
        total_amount: PAID_AMOUNT,
        paid_amount: PAID_AMOUNT,
        status: 'active',
      })
      .select('id')
      .single();
    if (!pkgErr && paidPkg) {
      await supabase.from('package_payments').insert({
        clinic_id: clinicId,
        package_id: paidPkg.id,
        customer_id: paidCust.id,
        amount: PAID_AMOUNT,
        method: 'card',
        payment_type: 'payment',
        fee_kind: 'package',
      });
      paidCheckInId = await seedCheckIn(paidCust.id, PAID_NAME, PAID_PHONE, 9822);
    } else {
      console.warn('⚠️ PAID 패키지 시드 실패:', pkgErr?.message);
    }
  }
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

  // 의료법 제22조 게이트 회피 위해 비급여 항목으로 시드(SPLIT 스펙과 동일 사유).
  const { data: svc } = await supabase
    .from('services')
    .select('id, name')
    .eq('clinic_id', clinic.id)
    .eq('active', true)
    .eq('is_insurance_covered', false)
    .is('hira_code', null)
    .not('category_label', 'in', '("상병","처방약")')
    .order('display_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!svc) {
    console.warn('⚠️ 비급여 활성 서비스 없음 — 시드 스킵');
    return;
  }
  serviceId = svc.id;
  serviceName = (svc as { name?: string }).name ?? '시술';
  seedOk = true;
});

test.beforeEach(async () => {
  if (!seedOk) return;
  await reseed();
});

test.afterAll(async () => {
  await cleanupByPhone(DUE_PHONE);
  await cleanupByPhone(PAID_PHONE);
});

/**
 * 특정 큐번호 환자의 결제 미니창 열기 (btn-pay → btn-settle 노출까지 대기).
 * 수납대기 컬럼의 per-card 래퍼 div(= btn-pay 를 직속 자식으로 가짐)를 큐번호(#NNNN)로 좁혀
 * 정확히 해당 환자의 결제 버튼만 클릭한다(실데이터/타 시드 카드 혼선 방지).
 */
async function openMiniWindowByQueue(page: import('@playwright/test').Page, queue: number) {
  await page.goto(`${BASE}/admin`);
  await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => null);
  const wrapper = page
    .locator('div:has(> [data-testid="btn-pay"])')
    .filter({ hasText: `#${queue}` });
  const payBtn = wrapper.locator('[data-testid="btn-pay"]').first();
  await payBtn.waitFor({ state: 'visible', timeout: 20000 });
  await payBtn.scrollIntoViewIfNeeded();
  await payBtn.click();
  await page.locator('[data-testid="btn-settle"]').first().waitFor({ state: 'visible', timeout: 30000 });
}

async function fetchPayments(checkInId: string) {
  const { data } = await supabase
    .from('payments')
    .select('amount, method, check_in_id')
    .eq('check_in_id', checkInId);
  return data ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 미수금 있는 고객 PMW 진입 → 배너 + 패키지 잔금 별도 줄 + §4-A
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오1: 미수금 고객 PMW 진입 → 미수금 배너 + 패키지 잔금 별도 줄(§4-A 총 미수금 라벨 없음)', async ({ page }) => {
  expect(seedOk, '시드 실패').toBeTruthy();
  expect(dueCheckInId, 'DUE 시드 실패').toBeTruthy();
  await openMiniWindowByQueue(page, 9821);

  const banner = page.locator('[data-testid="pmw-outstanding-banner"]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('미수금');

  const pkgRow = banner.locator('[data-testid="pmw-outstanding-package"]');
  await expect(pkgRow).toBeVisible();
  await expect(pkgRow).toContainText('360,000');

  // §4-A: 합산 단일 '총 미수금' 라벨 없음
  await expect(page.getByText('총 미수금')).toHaveCount(0);
  // consultationDue=0 → 진료비 잔금 줄 미노출
  await expect(banner.locator('[data-testid="pmw-outstanding-consultation"]')).toHaveCount(0);
  console.log('✅ 시나리오1: PMW 미수금 배너 + 패키지 잔금 별도 줄 + §4-A');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 미수금 0(완납) 고객 PMW 진입 → 배너 미노출
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오2: 완납(미수금 0) 고객 PMW 진입 → 미수금 배너 미노출', async ({ page }) => {
  expect(seedOk, '시드 실패').toBeTruthy();
  expect(paidCheckInId, 'PAID 시드 실패').toBeTruthy();
  await openMiniWindowByQueue(page, 9822);

  // 미니창은 떴지만(btn-settle 노출) 배너는 미노출
  await expect(page.locator('[data-testid="btn-settle"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="pmw-outstanding-banner"]')).toHaveCount(0);
  console.log('✅ 시나리오2: 완납 고객 배너 미노출');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 (회귀 가드): 배너 있어도 수납 amount=시술금액(grandTotal)만 — write 경로 불변
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오3(회귀): 미수금 배너 노출 상태에서 단일 카드 수납 → payments=시술금액(100,000)만 insert (미수금 미혼입)', async ({ page }) => {
  expect(seedOk, '시드 실패').toBeTruthy();
  expect(dueCheckInId, 'DUE 시드 실패').toBeTruthy();
  const ciId = dueCheckInId!;
  await openMiniWindowByQueue(page, 9821);

  // 배너 노출 확인
  await expect(page.locator('[data-testid="pmw-outstanding-banner"]')).toBeVisible();

  // 단일 카드 수납
  await page.locator('button:has-text("카드")').first().click();
  const settleBtn = page.locator('[data-testid="btn-settle"]');
  await expect(settleBtn).not.toBeDisabled();
  await settleBtn.click();
  await page.waitForTimeout(2500);

  // payments = 시술금액(grandTotal=100,000)만 — 미수금(360,000)이 amount 에 섞이지 않음
  const pays = await fetchPayments(ciId);
  expect(pays.length, 'payments 1행 insert').toBe(1);
  expect(pays[0].amount, '수납액 = 시술금액(grandTotal)만 — 미수금 미혼입').toBe(SETTLE_AMOUNT);
  console.log('✅ 시나리오3: 미수금 배너 표시 전용 — payments write 경로 불변 검증');
});
