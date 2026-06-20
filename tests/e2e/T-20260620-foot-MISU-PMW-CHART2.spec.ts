/**
 * T-20260620-foot-MISU-PMW-CHART2 — 결제 미니창 미수금 자동로드 + 2번차트 수납내역 미수이력 (확정 스펙 통합)
 *
 * 현장(김주연 총괄, C0ATE5P6JTH, thread 1781931424.728569) B안 전체 확정:
 *   AC-1 PMW(PaymentMiniWindow): 미수금 고객 진입 시 패키지 잔금 + 진료비 미수 **각각 따로 한 줄씩** 자동 표시(합산 한 줄 금지, §4-A).
 *   AC-2 2번차트(CustomerChartPage): 기존 수납내역 탭 안에 '미수이력' 섹션 ADDITIVE 추가 — 패키지 잔금 이력 + 진료비 미수 이력
 *        둘 다 + 유형 레이블 + 열[날짜|유형|금액|처리상태]. 기존 수납내역(받은 돈) 목록 회귀 금지.
 *
 * ★하드가드: DISPLAY/READ-ONLY 파생값. write·집계 경로 불변(일마감·매출 SSOT 무접촉).
 *   데이터 소스 = footBilling.loadCustomerOutstanding (T-20260616-foot-PKG-OUTSTANDING-BALANCE SSOT) 재사용, 신규 산출 0.
 *
 * 구성:
 *   - 시나리오1·3·회귀 = PMW 런타임 브라우저 테스트(칸반 btn-pay → 미니창, payments write 경로 회귀 가드).
 *   - 시나리오2 = CHART2 미수이력 정적 소스 가드(auth-free) — 선행 ADDITIVE 변경의 결정적 회귀 차단.
 *     (2번차트 진입은 풀 인증+고객선택 동선이 복잡 → 소스 가드로 결정적 단언; 선행 CHART2-PAYMENT-MISU-HISTORY와 동일 전략.)
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BASE = process.env.BASE_URL ?? 'http://localhost:8089';

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── 시드: 패키지 잔금 + 진료비 미수 **둘 다** 있는 고객 (AC-1 B안 핵심) ──
const BOTH_PHONE = '+821099998831';
const BOTH_NAME = '[MISU-PMW-CHART2-TEST] 둘다미수';
const PKG_DUE = 360000; // 패키지 총액(무결제) → packageDue = 360,000
const CONSULT_DUE = 50000; // 진료비(미결제) → consultationDue = 50,000

// ── 시드: 완납(미수 0) 고객 — 배너 미노출 회귀 가드 ──
const PAID_PHONE = '+821099998832';
const PAID_NAME = '[MISU-PMW-CHART2-TEST] 완납';
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
let bothCheckInId: string | null = null;
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
  await cleanupByPhone(BOTH_PHONE);
  await cleanupByPhone(PAID_PHONE);

  // ── BOTH: 활성 패키지(무결제, total_amount=360,000 + consultation_fee=50,000) → packageDue=360k & consultationDue=50k ──
  const { data: bothCust } = await supabase
    .from('customers')
    .insert({
      clinic_id: clinicId,
      name: BOTH_NAME,
      phone: BOTH_PHONE,
      visit_type: 'returning',
      is_simulation: false, // 칸반 노출(btn-pay) 위해 false
      inflow_channel: 'returning',
    })
    .select('id')
    .single();
  if (bothCust) {
    const { error: pkgErr } = await supabase.from('packages').insert({
      clinic_id: clinicId,
      customer_id: bothCust.id,
      package_name: '둘다미수 테스트 패키지',
      package_type: 'preset_6',
      total_sessions: 6,
      total_amount: PKG_DUE,
      consultation_fee: CONSULT_DUE, // §4-A 진료비 미수 — 패키지 잔금과 별도 산출(fee_kind='consultation')
      paid_amount: 0,
      status: 'active',
    });
    if (!pkgErr) {
      bothCheckInId = await seedCheckIn(bothCust.id, BOTH_NAME, BOTH_PHONE, 9831);
    } else {
      console.warn('⚠️ BOTH 패키지 시드 실패:', pkgErr.message);
    }
  }

  // ── PAID: 활성 패키지 전액결제(packageDue=0, consultation_fee 없음) + 당일 수납대기 ──
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
        package_name: '완납 테스트 패키지',
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
      paidCheckInId = await seedCheckIn(paidCust.id, PAID_NAME, PAID_PHONE, 9832);
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

  // 의료법 제22조 게이트 회피 위해 비급여 항목으로 시드.
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
  await cleanupByPhone(BOTH_PHONE);
  await cleanupByPhone(PAID_PHONE);
});

/** 특정 큐번호 환자의 결제 미니창 열기 (btn-pay → btn-settle 노출까지 대기). */
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
// 시나리오 1 (AC-1 B안): PMW 진입 → 패키지 잔금 + 진료비 미수 **각각 따로 한 줄씩** (합산 한 줄 없음)
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오1(AC-1): PMW 자동 표시 — 패키지 잔금 + 진료비 미수 각각 따로 한 줄(§4-A 합산 금지)', async ({ page }) => {
  expect(seedOk, '시드 실패').toBeTruthy();
  expect(bothCheckInId, 'BOTH 시드 실패').toBeTruthy();
  await openMiniWindowByQueue(page, 9831);

  const banner = page.locator('[data-testid="pmw-outstanding-banner"]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('미수금');

  // 패키지 잔금 줄 — 별도, 360,000
  const pkgRow = banner.locator('[data-testid="pmw-outstanding-package"]');
  await expect(pkgRow).toBeVisible();
  await expect(pkgRow).toContainText('360,000');

  // 진료비 미수 줄 — 별도, 50,000 (라벨 '진료비 미수' 확정 스펙·CHART2 일치)
  const consultRow = banner.locator('[data-testid="pmw-outstanding-consultation"]');
  await expect(consultRow).toBeVisible();
  await expect(consultRow).toContainText('50,000');
  await expect(banner).toContainText('진료비 미수');
  await expect(banner).toContainText('패키지 잔금');

  // §4-A: 합산 단일 '총 미수금' 라벨 없음
  await expect(page.getByText('총 미수금')).toHaveCount(0);
  console.log('✅ 시나리오1: 패키지 잔금/진료비 미수 각각 별도 줄 + §4-A 합산 금지');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1-b (회귀 가드): 미수금 0(완납) 고객 → 배너 미노출
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오1-b(회귀): 완납(미수금 0) 고객 PMW 진입 → 미수금 배너 미노출', async ({ page }) => {
  expect(seedOk, '시드 실패').toBeTruthy();
  expect(paidCheckInId, 'PAID 시드 실패').toBeTruthy();
  await openMiniWindowByQueue(page, 9832);

  await expect(page.locator('[data-testid="btn-settle"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="pmw-outstanding-banner"]')).toHaveCount(0);
  console.log('✅ 시나리오1-b: 완납 고객 배너 미노출');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3 (회귀 가드): 미수금 배너 노출 상태에서 단일 카드 수납 → payments=시술금액(grandTotal)만 — write 경로 불변
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오3(회귀): 미수금 배너 표시 상태 단일 카드 수납 → payments=시술금액(100,000)만 insert (미수금 미혼입)', async ({ page }) => {
  expect(seedOk, '시드 실패').toBeTruthy();
  expect(bothCheckInId, 'BOTH 시드 실패').toBeTruthy();
  const ciId = bothCheckInId!;
  await openMiniWindowByQueue(page, 9831);

  await expect(page.locator('[data-testid="pmw-outstanding-banner"]')).toBeVisible();

  await page.locator('button:has-text("카드")').first().click();
  const settleBtn = page.locator('[data-testid="btn-settle"]');
  await expect(settleBtn).not.toBeDisabled();
  await settleBtn.click();
  await page.waitForTimeout(2500);

  // payments = 시술금액(grandTotal=100,000)만 — 미수금(패키지360k/진료비50k)이 amount 에 섞이지 않음
  const pays = await fetchPayments(ciId);
  expect(pays.length, 'payments 1행 insert').toBe(1);
  expect(pays[0].amount, '수납액 = 시술금액(grandTotal)만 — 미수금 미혼입').toBe(SETTLE_AMOUNT);
  console.log('✅ 시나리오3: PMW 미수금 배너 표시 전용 — payments write 경로 불변');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2 (AC-2 B안): 2번차트 수납내역 탭 미수이력 섹션 — 정적 소스 가드(ADDITIVE/DISPLAY-ONLY 결정적 단언)
// ─────────────────────────────────────────────────────────────────────────────
const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const CHART_PAGE = path.resolve(__dirname2, '../../src/pages/CustomerChartPage.tsx');
function chartSrc(): string {
  return readFileSync(CHART_PAGE, 'utf-8');
}

test.describe('시나리오2(AC-2): 2번차트 수납내역 탭 미수이력 섹션', () => {
  test('S2-a: [미수이력] 섹션이 수납내역 탭에 존재', () => {
    const s = chartSrc();
    expect(s).toContain('data-testid="misu-history-section"');
    expect(s).toMatch(/미수이력/);
  });

  test('S2-b: 열 구성 [날짜|유형|금액|처리 상태]', () => {
    const s = chartSrc();
    expect(s).toMatch(
      /data-testid="misu-history-table"[\s\S]{0,800}>날짜<[\s\S]{0,300}>유형<[\s\S]{0,300}>금액<[\s\S]{0,300}>처리 상태</,
    );
  });

  test('S2-c: 유형 레이블 둘 다 — 패키지 잔금 / 진료비 미수', () => {
    const s = chartSrc();
    expect(s).toContain("feeLabel: '패키지 잔금'");
    expect(s).toContain("feeLabel: '진료비 미수'");
    // 납부 이벤트 fee_kind 분기로 유형 분리
    expect(s).toMatch(/fee_kind[\s\S]{0,40}===\s*'consultation'\s*\?\s*'진료비 미수'\s*:\s*'패키지 잔금'/);
  });

  test('S2-d: §4-A 현재 미수 요약 — 패키지/진료비 별도(단일 총미수 합산 금지)', () => {
    const s = chartSrc();
    expect(s).toContain('data-testid="misu-current-summary"');
    expect(s).toMatch(/현재 패키지 잔금/);
    expect(s).toMatch(/현재 진료비 미수/);
    // SSOT 재사용(computeOutstanding/netPaidFromPayments) — 신규 산출 금지
    expect(s).toMatch(/computeOutstanding\(/);
    expect(s).toMatch(/netPaidFromPayments\(/);
  });

  test('S2-e: ADDITIVE — 기존 수납내역(받은 돈) 로직 보존(회귀 금지)', () => {
    const s = chartSrc();
    // 미수이력은 별도 섹션으로만 추가 — 기존 수납내역 read-only 뷰어/필터 로직 불변
    expect(s).toContain("const feePayments = payments.filter((p) => !(p.memo ?? '').startsWith('영수증 업로드'));");
    expect(s).toContain('data-testid="misu-history-empty"');
  });
});
