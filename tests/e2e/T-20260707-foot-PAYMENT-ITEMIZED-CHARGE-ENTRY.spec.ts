/**
 * T-20260707-foot-PAYMENT-ITEMIZED-CHARGE-ENTRY
 * 결제 항목별 명세(payment_items) — 스코프 (C) 풀명세: 항목명+수가코드+급여/비급여+단가+횟수 각 행 분리.
 *
 * ── [P1 FIX 2026-07-10] surface-misplacement 재오픈 (MSG-20260710-155020-otdl) ──
 * RC: PaymentItemsEditor 가 PaymentDialog(L1149)에만 탑재되고, 현장 정본 결제 표면
 *     **PaymentMiniWindow** 엔 미탑재 → 장쳰 안내 경로(예약목록/대시보드→미니결제창) 그대로
 *     따라가면 항목별 입력 UI 부재 → 김주연 총괄 "적용 안 됨" 100% 재현.
 *     (SELFCHECKIN-ADDR 계열 동형 — dead/희소 표면 배포 + E2E 컴포넌트-only 검증으로 통과.)
 *
 * ∴ 본 스펙은 **현장 도달경로(field-reach) 기준**으로 재작성한다(컴포넌트-only 금지).
 *   L0 (surface-mount guard, auth-free): PaymentItemsEditor 가 PaymentMiniWindow 에 실제 탑재됐는지
 *       + payment_items insert + `!deductMode` 가드 + 양 진입 표면(예약관리·대시보드)이 PMW 를 mount.
 *       → 원래 놓쳤던 RC(표면 미탑재) 를 결정적으로 재발 차단.
 *   FIX-1/2/3 (browser field-reach):
 *     시나리오 A: 예약관리 → 환자(예약카드) → 미니결제창 → 항목별 입력 UI 렌더 확인.
 *     시나리오 B: 대시보드 수납대기 → 미니결제창 → 항목별 입력·저장(payment_items write)·조회.
 *   AC (DB 계약, 보조): 풀명세 저장·조회 / charge_class 2값 CHECK / CASCADE / lump-sum 회귀 0.
 *
 * 스키마 계약(DA-20260707-foot-PAYMENT-ITEMS): charge_class CHECK IN ('급여','비급여'),
 *   payment_id ON DELETE CASCADE, check_in_id ON DELETE SET NULL. db_change=false(기존 라이브 재사용).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BASE = process.env.BASE_URL ?? 'http://localhost:8089';
const SUPA_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLINIC_ID = '74967aea-a60b-4da3-a0e7-9c997a930bc8';

const __dirname_ = path.dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(path.resolve(__dirname_, '../../', rel), 'utf-8');

// ════════════════════════════════════════════════════════════════════════════
// L0 — surface-mount guard (auth-free, 결정적). RC(표면 미탑재) 재발 차단.
// ════════════════════════════════════════════════════════════════════════════
test.describe('L0 surface-mount — PaymentItemsEditor 가 현장 정본 결제 표면(PaymentMiniWindow)에 탑재', () => {
  test('PaymentMiniWindow 가 PaymentItemsEditor 를 import·render + payment_items insert + !deductMode 가드', () => {
    const s = src('src/components/PaymentMiniWindow.tsx');
    // import
    expect(s, 'PaymentItemsEditor import').toMatch(
      /import\s*\{[^}]*PaymentItemsEditor[^}]*\}\s*from\s*'@\/components\/PaymentItemsEditor'/,
    );
    // render (JSX 실제 탑재 — PaymentDialog 만이 아니라 PMW 에도)
    expect(s, 'PaymentItemsEditor JSX 렌더').toContain('<PaymentItemsEditor');
    // 단건 수납 전용 가드 = PaymentDialog `paymentMode==='single' && !balanceKind` 동형(PMW=!deductMode)
    expect(s, '!deductMode 가드(패키지 회차 grain 제외)').toMatch(/!deductMode\s*&&\s*pricingItems\.length\s*>\s*0/);
    // payment_items 부착 저장(best-effort)
    expect(s, 'insertPaymentItems 헬퍼').toContain('insertPaymentItems');
    expect(s, "payment_items insert").toMatch(/from\('payment_items'\)[\s\S]{0,40}\.insert/);
    // 저장 후 payment id 확보 (lump-sum 하위호환: lineItems 0행이면 스킵)
    expect(s, 'lineItems 0행이면 스킵(레거시 lump-sum 회귀 0)').toMatch(/lineItems\.length\s*>\s*0/);
  });

  test('양 진입 표면(예약관리·대시보드)이 PaymentMiniWindow 를 mount', () => {
    expect(src('src/pages/Reservations.tsx'), '예약관리 → PMW mount').toContain('<PaymentMiniWindow');
    expect(src('src/pages/Dashboard.tsx'), '대시보드 → PMW mount').toContain('<PaymentMiniWindow');
  });

  test('PaymentItemsEditor 자체가 항목별 축(항목명·수가코드·급여/비급여·단가·횟수)을 노출', () => {
    const s = src('src/components/PaymentItemsEditor.tsx');
    expect(s).toContain('data-testid="btn-add-payment-item"');
    expect(s).toContain('data-testid="input-payment-item-name"');
    expect(s).toContain('data-testid="input-payment-item-code"');   // 수가코드
    expect(s).toContain('data-testid="input-payment-item-qty"');    // 횟수
    expect(s).toContain('data-testid="input-payment-item-unit"');   // 단가
    expect(s).toContain('btn-charge-class-${cc}');                  // 급여/비급여 토글
    expect(s).toMatch(/CHARGE_CLASSES[\s\S]{0,40}'급여'[\s\S]{0,10}'비급여'/); // 2값 도메인
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 시나리오 A/B — browser field-reach (현장 도달경로). PMW 는 서버·인증 필요.
// ════════════════════════════════════════════════════════════════════════════
const supabase = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });

const A_PHONE = '+821099997701';
const A_NAME = '[PAYITEM-A] 예약관리진입';
const B_PHONE = '+821099997702';
const B_NAME = '[PAYITEM-B] 대시보드진입';
const B_QUEUE = 9771;
const SETTLE_AMOUNT = 45000;

let serviceId: string | null = null;
let serviceName = '시술';
let aReservationId: string | null = null;
let aCheckInId: string | null = null;
let bCheckInId: string | null = null;
let seedOk = false;

function todaySeoulDate(): string {
  const seoul = new Date(Date.now() + 9 * 3600 * 1000);
  return seoul.toISOString().slice(0, 10);
}
function todaySeoulISO(t = '10:30'): string {
  return `${todaySeoulDate()}T${t}:00+09:00`;
}

async function cleanupByPhone(phone: string) {
  const { data: custs } = await supabase.from('customers').select('id').eq('phone', phone);
  const custIds = (custs ?? []).map((c) => c.id);
  if (custIds.length === 0) return;
  const { data: cis } = await supabase.from('check_ins').select('id').in('customer_id', custIds);
  const ciIds = (cis ?? []).map((c) => c.id);
  if (ciIds.length > 0) {
    // payment_items 는 payment CASCADE 로도 지워지나, check_in_id 경로도 명시 정리
    const { data: pays } = await supabase.from('payments').select('id').in('check_in_id', ciIds);
    const payIds = (pays ?? []).map((p) => p.id);
    if (payIds.length > 0) await supabase.from('payment_items').delete().in('payment_id', payIds);
    await supabase.from('payment_items').delete().in('check_in_id', ciIds);
    await supabase.from('payments').delete().in('check_in_id', ciIds);
    await supabase.from('check_in_services').delete().in('check_in_id', ciIds);
    await supabase.from('status_transitions').delete().in('check_in_id', ciIds);
    await supabase.from('check_ins').delete().in('id', ciIds);
  }
  await supabase.from('reservations').delete().in('customer_id', custIds);
  await supabase.from('customers').delete().in('id', custIds);
}

async function seedCheckInServices(checkInId: string) {
  await supabase.from('check_in_services').insert({
    check_in_id: checkInId,
    service_id: serviceId,
    service_name: serviceName,
    price: SETTLE_AMOUNT,
    original_price: SETTLE_AMOUNT,
    is_package_session: false,
  });
}

async function reseed() {
  await cleanupByPhone(A_PHONE);
  await cleanupByPhone(B_PHONE);

  // ── A: 예약(오늘) + 예약연결 체크인(payment_waiting) + 저장된 시술 → 예약관리 카드 우클릭 진입 ──
  const { data: aCust } = await supabase
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name: A_NAME, phone: A_PHONE, visit_type: 'returning', is_simulation: false, inflow_channel: 'returning' })
    .select('id').single();
  if (aCust) {
    const { data: resv } = await supabase
      .from('reservations')
      .insert({
        clinic_id: CLINIC_ID, customer_id: aCust.id, customer_name: A_NAME, customer_phone: A_PHONE,
        reservation_date: todaySeoulDate(), reservation_time: '10:00', visit_type: 'returning', status: 'checked_in',
      })
      .select('id').single();
    if (resv) {
      aReservationId = resv.id;
      const { data: ci } = await supabase
        .from('check_ins')
        .insert({
          clinic_id: CLINIC_ID, customer_id: aCust.id, customer_name: A_NAME, customer_phone: A_PHONE,
          reservation_id: resv.id, visit_type: 'returning', status: 'payment_waiting',
          queue_number: 9770, checked_in_at: todaySeoulISO('10:05'), sort_order: 9770,
        })
        .select('id').single();
      if (ci) { aCheckInId = ci.id; await seedCheckInServices(ci.id); }
    }
  }

  // ── B: 대시보드 수납대기 체크인(오늘) + 저장된 시술 → 칸반 btn-pay 진입 ──
  const { data: bCust } = await supabase
    .from('customers')
    .insert({ clinic_id: CLINIC_ID, name: B_NAME, phone: B_PHONE, visit_type: 'returning', is_simulation: false, inflow_channel: 'returning' })
    .select('id').single();
  if (bCust) {
    const { data: ci } = await supabase
      .from('check_ins')
      .insert({
        clinic_id: CLINIC_ID, customer_id: bCust.id, customer_name: B_NAME, customer_phone: B_PHONE,
        visit_type: 'returning', status: 'payment_waiting',
        queue_number: B_QUEUE, checked_in_at: todaySeoulISO('10:30'), sort_order: B_QUEUE,
      })
      .select('id').single();
    if (ci) { bCheckInId = ci.id; await seedCheckInServices(ci.id); }
  }
}

test.describe('시나리오 A/B — 현장 도달경로 → PaymentMiniWindow 항목별 입력', () => {
  test.beforeAll(async () => {
    if (!SERVICE_KEY) return;
    // 의료법 제22조 게이트 회피 위해 비급여 항목으로 시드(MISU-PMW 선례 동형).
    const { data: svc } = await supabase
      .from('services')
      .select('id, name')
      .eq('clinic_id', CLINIC_ID)
      .eq('active', true)
      .eq('is_insurance_covered', false)
      .is('hira_code', null)
      .not('category_label', 'in', '("상병","처방약")')
      .order('display_order', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!svc) { console.warn('⚠️ 비급여 활성 서비스 없음 — 시드 스킵'); return; }
    serviceId = svc.id;
    serviceName = (svc as { name?: string }).name ?? '시술';
    seedOk = true;
  });

  test.beforeEach(async () => {
    if (!seedOk) return;
    await reseed();
  });

  test.afterAll(async () => {
    if (!SERVICE_KEY) return;
    await cleanupByPhone(A_PHONE);
    await cleanupByPhone(B_PHONE);
  });

  // ── FIX-2 시나리오 A: 예약관리 → 예약카드 우클릭 → 수납 → 미니결제창 → 항목별 입력 UI 렌더 ──
  test('FIX-2/A: 예약관리 → 환자 예약카드 → 미니결제창에서 항목별 입력 UI 렌더', async ({ page }) => {
    expect(seedOk, '시드 실패(clinic/service)').toBeTruthy();
    expect(aCheckInId && aReservationId, 'A 시드 실패').toBeTruthy();

    await page.goto(`${BASE}/admin/reservations`);
    await page.locator('[data-testid="resv-timetable-scroll"]').first().waitFor({ timeout: 20000 });

    const card = page.locator(`[data-testid="resv-card-${aReservationId}"]`).first();
    await card.waitFor({ state: 'visible', timeout: 20000 });
    await card.scrollIntoViewIfNeeded();
    await card.click({ button: 'right' });

    // CustomerQuickMenu → [수납] (아이콘 CreditCard, 텍스트 '수납')
    await page.getByRole('button', { name: '수납', exact: true }).first().click();

    // 미니결제창 진입 → 항목별 명세 입력 UI 가 렌더되어야 함(RC=미탑재 재발 차단)
    await expect(page.locator('[data-testid="btn-add-payment-item"]'), '항목 추가 버튼(PaymentItemsEditor) 렌더').toBeVisible({ timeout: 20000 });
    // check_in_services 자동 seed 하이브리드 → 최소 1행 프리필
    await expect(page.locator('[data-testid="payment-item-row"]').first(), 'check_in_services 자동 seed 행').toBeVisible();
    console.log('✅ FIX-2/A: 예약관리 진입 미니결제창에 항목별 입력 UI 렌더 + 자동 seed');
  });

  // ── FIX-1/2/3 시나리오 B: 대시보드 수납대기 → 미니결제창 → 항목별 입력·저장(payment_items)·조회 ──
  test('FIX-1/2/3/B: 대시보드 수납대기 → 미니결제창 항목별 입력 → 수납 시 payment_items 저장·조회', async ({ page }) => {
    expect(seedOk, '시드 실패(clinic/service)').toBeTruthy();
    expect(bCheckInId, 'B 시드 실패').toBeTruthy();
    const ciId = bCheckInId!;

    await page.goto(`${BASE}/admin`);
    await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => null);
    const wrapper = page.locator('div:has(> [data-testid="btn-pay"])').filter({ hasText: `#${B_QUEUE}` });
    const payBtn = wrapper.locator('[data-testid="btn-pay"]').first();
    await payBtn.waitFor({ state: 'visible', timeout: 20000 });
    await payBtn.scrollIntoViewIfNeeded();
    await payBtn.click();
    await page.locator('[data-testid="btn-settle"]').first().waitFor({ state: 'visible', timeout: 30000 });

    // 항목별 입력 UI 렌더 + 자동 seed(하이브리드)
    await expect(page.locator('[data-testid="btn-add-payment-item"]'), '항목별 입력 UI 렌더').toBeVisible();
    await expect(page.locator('[data-testid="payment-item-row"]').first(), '자동 seed 행').toBeVisible();

    // 수납 확정 → payment_items 부착 저장
    await page.locator('button:has-text("카드")').first().click();
    const settleBtn = page.locator('[data-testid="btn-settle"]').first();
    await expect(settleBtn).not.toBeDisabled();
    await settleBtn.click();
    await page.waitForTimeout(2500);

    // FIX-1/3: payment_items 가 check_in 경로로 저장·조회됨(항목명+단가+charge_class 스냅샷)
    const { data: items } = await supabase
      .from('payment_items')
      .select('service_name, line_amount, charge_class, quantity')
      .eq('check_in_id', ciId);
    expect((items ?? []).length, 'payment_items ≥ 1행 저장(현장 표면 경유)').toBeGreaterThan(0);
    const line = (items ?? [])[0];
    expect(line.line_amount, '라인금액 = seed 단가').toBe(SETTLE_AMOUNT);
    expect(['급여', '비급여']).toContain(line.charge_class); // 비급여 서비스 seed
    console.log('✅ FIX-1/2/3/B: 대시보드 진입 미니결제창 항목별 저장·조회 확인');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AC (DB 계약, 보조) — 스키마·회귀 결정적 단언 (auth-free service_role)
// ════════════════════════════════════════════════════════════════════════════
test.describe('AC — payment_items 스키마 계약 + lump-sum 회귀', () => {
  test('AC-1/2/3: 항목별 풀명세 저장·조회 + charge_class 2값 CHECK', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const phone = `010${String(Date.now()).slice(-8)}`;
    let customerId: string | null = null;
    let checkInId: string | null = null;
    let paymentId: string | null = null;
    try {
      const { data: customer } = await sb.from('customers')
        .insert({ clinic_id: CLINIC_ID, name: `pi-test-${Date.now()}`, phone, visit_type: 'new' })
        .select().single();
      customerId = customer!.id;
      const { data: ci } = await sb.from('check_ins')
        .insert({ clinic_id: CLINIC_ID, customer_id: customerId, customer_name: customer!.name, customer_phone: phone, visit_type: 'new', status: 'payment_waiting', queue_number: 998 })
        .select().single();
      checkInId = ci!.id;
      const { data: pay, error: payErr } = await sb.from('payments')
        .insert({ clinic_id: CLINIC_ID, check_in_id: checkInId, customer_id: customerId, amount: 100000, method: 'card', payment_type: 'payment' })
        .select('id').single();
      expect(payErr).toBeNull();
      paymentId = pay!.id;

      const { error: itemErr } = await sb.from('payment_items').insert([
        { payment_id: paymentId, check_in_id: checkInId, service_name: '발톱무좀 균검사', service_code: 'D6591', quantity: 1, unit_price: 30000, line_amount: 30000, charge_class: '급여' },
        { payment_id: paymentId, check_in_id: checkInId, service_name: '레이저 시술', service_code: 'LZ01', quantity: 2, unit_price: 35000, line_amount: 70000, charge_class: '비급여' },
      ]);
      expect(itemErr).toBeNull();

      const { data: items } = await sb.from('payment_items').select('*').eq('payment_id', paymentId).order('created_at', { ascending: true });
      expect(items).toHaveLength(2);
      expect((items ?? []).reduce((s, it) => s + it.line_amount, 0)).toBe(100000);
      expect((items ?? []).map((i) => i.charge_class).sort()).toEqual(['급여', '비급여']);
      const laser = (items ?? []).find((i) => i.service_name === '레이저 시술');
      expect(laser?.service_code).toBe('LZ01');
      expect(laser?.quantity).toBe(2);

      // charge_class CHECK — '공단부담' 등 확장 거부(급여 split 은 service_charges 소관)
      const { error: badErr } = await sb.from('payment_items').insert({ payment_id: paymentId, service_name: 'bad', quantity: 1, line_amount: 1000, charge_class: '공단부담' });
      expect(badErr).not.toBeNull();
    } finally {
      if (paymentId) { await sb.from('payment_items').delete().eq('payment_id', paymentId); await sb.from('payments').delete().eq('id', paymentId); }
      if (checkInId) await sb.from('check_ins').delete().eq('id', checkInId);
      if (customerId) await sb.from('customers').delete().eq('id', customerId);
    }
  });

  test('스키마 계약 — payment_id ON DELETE CASCADE (부모 수납 삭제 시 항목 동반 삭제)', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const phone = `010${String(Date.now()).slice(-8)}`;
    let customerId: string | null = null;
    let paymentId: string | null = null;
    try {
      const { data: customer } = await sb.from('customers')
        .insert({ clinic_id: CLINIC_ID, name: `pi-cascade-${Date.now()}`, phone, visit_type: 'new' })
        .select().single();
      customerId = customer!.id;
      const { data: pay } = await sb.from('payments')
        .insert({ clinic_id: CLINIC_ID, customer_id: customerId, amount: 50000, method: 'cash', payment_type: 'payment' })
        .select('id').single();
      paymentId = pay!.id;
      await sb.from('payment_items').insert({ payment_id: paymentId, service_name: 'cascade-line', quantity: 1, unit_price: 50000, line_amount: 50000, charge_class: '비급여' });
      await sb.from('payments').delete().eq('id', paymentId);
      const { data: orphans } = await sb.from('payment_items').select('id').eq('payment_id', paymentId);
      expect(orphans ?? []).toHaveLength(0);
      paymentId = null;
    } finally {
      if (paymentId) await sb.from('payments').delete().eq('id', paymentId);
      if (customerId) await sb.from('customers').delete().eq('id', customerId);
    }
  });

  test('AC-4 회귀 0 — 항목 없는 lump-sum 수납은 payments 단독 read 정상', async () => {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const phone = `010${String(Date.now()).slice(-8)}`;
    let customerId: string | null = null;
    let paymentId: string | null = null;
    try {
      const { data: customer } = await sb.from('customers')
        .insert({ clinic_id: CLINIC_ID, name: `pi-legacy-${Date.now()}`, phone, visit_type: 'new' })
        .select().single();
      customerId = customer!.id;
      const { data: pay, error } = await sb.from('payments')
        .insert({ clinic_id: CLINIC_ID, customer_id: customerId, amount: 80000, method: 'transfer', payment_type: 'payment' })
        .select('id, amount').single();
      expect(error).toBeNull();
      paymentId = pay!.id;
      expect(pay!.amount).toBe(80000);
      const { data: items } = await sb.from('payment_items').select('id').eq('payment_id', paymentId);
      expect(items ?? []).toHaveLength(0);
    } finally {
      if (paymentId) await sb.from('payments').delete().eq('id', paymentId);
      if (customerId) await sb.from('customers').delete().eq('id', customerId);
    }
  });
});
