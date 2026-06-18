/**
 * T-20260617-foot-PMW-OUTSTANDING-BESIDE-TOTAL  (REVISED 2026-06-18, reporter-driven)
 * 일마감(Closing) "총 합계" 탭 — 합계(결제수단별) 박스 옆에 동일 박스 형태로 [일일 미수금] 박스 병치.
 *
 * 재정의(김주연 총괄 2026-06-18, MSG-20260618-160140-vanx / 위치 핀 스크린샷 F0BB8UA0RDH):
 *   旣존 "결제 미니창 1줄 인라인" 스펙(spec_superseded) → "일마감 합계 박스 옆 동일 박스" 로 reporter 직접 뒤집음.
 *
 * 변경: Closing.tsx 요약 그리드(합계 카드 옆)에 DailyOutstandingCard 추가.
 *   - 소스 = footBilling.loadCustomerOutstanding (T-20260616-foot-PKG-OUTSTANDING-BALANCE SSOT) 재사용, 신규 산출 0.
 *   - "당일" 윈도잉 = 화면 date 기준 payment_waiting 체크인 고객.
 *   - §4-A: 패키지 미수 / 진료비 미수 **별도 줄**(합산 단일 '총 미수금' 표기 금지).
 *   - 미수 0이면 '미수 없음 ₩0' 1줄(공간/스크롤 낭비 없음).
 *
 * 시나리오(티켓 §6 → Closing 적용):
 *   1. 당일 미수 고객 있음 → 합계 박스 옆 [일일 미수금] 박스에 패키지 미수 별도 줄 + §4-A(총 미수금 라벨 없음)
 *   2. 완납(미수 0)만 있는 날 → 박스 '미수 없음' 표기 (공간 절약)
 *   3. 회귀 0 — 기존 합계(결제수단별)·패키지/단건/수기 박스 유지 + 가로 스크롤 없음
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// 시드 식별자 — 실환자 보호용 고유 전화번호 + prefix
const DUE_PHONE = '+821099998811';
const DUE_NAME = '[PMW-OUTSTANDING-TEST] 미수금';
const DUE_AMOUNT = 480000; // 패키지 총액(무결제) → packageDue = 480000

const PAID_PHONE = '+821099998812';
const PAID_NAME = '[PMW-OUTSTANDING-TEST] 완납';
const PAID_AMOUNT = 300000; // 패키지 총액 = 전액 결제 → packageDue = 0 → 완납

function todaySeoulISO(): string {
  const now = new Date();
  const seoul = new Date(now.getTime() + 9 * 3600 * 1000);
  const y = seoul.getUTCFullYear();
  const m = String(seoul.getUTCMonth() + 1).padStart(2, '0');
  const d = String(seoul.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}T10:30:00+09:00`;
}

let clinicId: string | null = null;
let dueSeedOk = false;
let paidSeedOk = false;

async function cleanupByPhone(phone: string) {
  const { data: custs } = await supabase
    .from('customers')
    .select('id')
    .eq('phone', phone)
    .eq('is_simulation', true);
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
    await supabase.from('check_in_services').delete().in('check_in_id', ciIds);
    await supabase.from('status_transitions').delete().in('check_in_id', ciIds);
    await supabase.from('check_ins').delete().in('id', ciIds);
  }
  await supabase.from('customers').delete().in('id', custIds);
}

/** payment_waiting 체크인 시드(당일). 일일 미수금 박스 윈도잉(=payment_waiting 고객)에 포함되도록. */
async function seedCheckIn(
  customerId: string,
  name: string,
  phone: string,
  queue: number,
): Promise<boolean> {
  const { error } = await supabase
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
    });
  if (error) {
    console.warn('⚠️ check_in 시드 실패:', error.message);
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
  clinicId = clinic.id;

  await cleanupByPhone(DUE_PHONE);
  await cleanupByPhone(PAID_PHONE);

  // ── DUE 고객: 활성 패키지(무결제) + 당일 payment_waiting 체크인 → packageDue = DUE_AMOUNT ──
  const { data: dueCust } = await supabase
    .from('customers')
    .insert({
      clinic_id: clinicId,
      name: DUE_NAME,
      phone: DUE_PHONE,
      visit_type: 'returning',
      is_simulation: true,
      inflow_channel: 'returning',
    })
    .select('id')
    .single();
  if (dueCust) {
    const { error: pkgErr } = await supabase.from('packages').insert({
      clinic_id: clinicId,
      customer_id: dueCust.id,
      package_name: '미수금 테스트 패키지',
      package_type: 'preset_6',
      total_sessions: 6,
      total_amount: DUE_AMOUNT,
      paid_amount: 0,
      status: 'active',
    });
    if (!pkgErr) {
      dueSeedOk = await seedCheckIn(dueCust.id, DUE_NAME, DUE_PHONE, 9811);
    } else {
      console.warn('⚠️ DUE 패키지 시드 실패:', pkgErr.message);
    }
  }

  // ── PAID 고객: 활성 패키지 + 전액 결제 + 당일 payment_waiting 체크인 → packageDue = 0 ──
  const { data: paidCust } = await supabase
    .from('customers')
    .insert({
      clinic_id: clinicId,
      name: PAID_NAME,
      phone: PAID_PHONE,
      visit_type: 'returning',
      is_simulation: true,
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
      paidSeedOk = await seedCheckIn(paidCust.id, PAID_NAME, PAID_PHONE, 9812);
    } else {
      console.warn('⚠️ PAID 패키지 시드 실패:', pkgErr?.message);
    }
  }

  console.log(`✅ 시드 — DUE=${dueSeedOk} PAID=${paidSeedOk}`);
});

test.afterAll(async () => {
  await cleanupByPhone(DUE_PHONE);
  await cleanupByPhone(PAID_PHONE);
});

/** 일마감 요약 탭 진입 + 미수금 박스 노출까지 대기. (route = /admin/closing — AdminLayout 중첩) */
async function gotoClosingSummary(page: import('@playwright/test').Page) {
  await page.goto('/admin/closing');
  await page.waitForLoadState('networkidle');
  // 요약 그리드(합계 박스, 페이지 고유 텍스트) 렌더 대기 — '일마감'은 nav 메뉴에도 있어 모호
  await expect(page.getByText('합계 (결제수단별)').first()).toBeVisible({ timeout: 20000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: 당일 미수 고객 있음 → 합계 박스 옆 [일일 미수금] 박스 패키지 미수 별도 줄
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오1: 합계 박스 옆 [일일 미수금] 박스 — 패키지 미수 별도 줄 + §4-A(총 미수금 라벨 없음)', async ({ page }) => {
  expect(dueSeedOk, 'DUE 시드 실패 — 미수금 고객 준비 불가').toBeTruthy();
  await gotoClosingSummary(page);

  // 일일 미수금 박스가 합계 박스 옆(동일 그리드)에 존재
  const box = page.locator('[data-testid="closing-daily-outstanding"]');
  await expect(box).toBeVisible();
  await expect(box).toContainText('일일 미수금');

  // §4-A: 패키지 미수 별도 줄 + 금액(480,000)
  const pkgRow = box.locator('[data-testid="closing-outstanding-package"]');
  await expect(pkgRow).toBeVisible();
  await expect(pkgRow).toContainText('패키지 미수');
  await expect(pkgRow).toContainText('480,000');

  // §4-A: 합산 단일 '총 미수금' 라벨 없음
  await expect(page.getByText('총 미수금')).toHaveCount(0);

  // consultationDue=0 → 진료비 미수 줄 미노출 (별도 줄, 0은 생략)
  await expect(box.locator('[data-testid="closing-outstanding-consultation"]')).toHaveCount(0);
  console.log('✅ 시나리오1: 합계 옆 일일 미수금 박스 + 패키지 미수 별도 줄 + §4-A');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: 미수 없는 날(미래 날짜) → '미수 없음' 박스 (공간 절약)
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오2: 당일 미수 0 → [일일 미수금] 박스 "미수 없음" 표기', async ({ page }) => {
  await gotoClosingSummary(page);

  // 미래 날짜 → payment_waiting 고객 없음 → 미수 없음
  const futureDate = '2099-12-31';
  const dateInput = page.locator('input[type="date"]').first();
  if (await dateInput.count() > 0) {
    await dateInput.fill(futureDate);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
  }

  const box = page.locator('[data-testid="closing-daily-outstanding"]');
  await expect(box).toBeVisible();
  await expect(box.locator('[data-testid="closing-outstanding-none"]')).toBeVisible();
  await expect(box).toContainText('미수 없음');
  // 미수 줄(패키지/진료비) 미노출
  await expect(box.locator('[data-testid="closing-outstanding-package"]')).toHaveCount(0);
  await expect(box.locator('[data-testid="closing-outstanding-consultation"]')).toHaveCount(0);
  console.log('✅ 시나리오2: 미수 없음 표기 (공간 절약)');
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 회귀 0 — 기존 요약 박스 유지 + 그리드 가로 스크롤 없음
// ─────────────────────────────────────────────────────────────────────────────
test('시나리오3: 기존 합계/패키지/단건/수기 박스 회귀 0 + 그리드 가로 스크롤 없음', async ({ page }) => {
  await gotoClosingSummary(page);

  // 기존 4개 박스 유지
  await expect(page.getByText('패키지 결제').first()).toBeVisible();
  await expect(page.getByText('단건 결제').first()).toBeVisible();
  await expect(page.getByText('수기결제').first()).toBeVisible();
  await expect(page.getByText('합계 (결제수단별)').first()).toBeVisible();
  // 신규 박스도 함께
  await expect(page.locator('[data-testid="closing-daily-outstanding"]')).toBeVisible();

  // 그리드가 가로 스크롤을 유발하지 않음(반응형 grid-cols — 줄바꿈으로 수직 배치)
  const grid = page.locator('[data-testid="closing-daily-outstanding"]').locator('xpath=ancestor::div[contains(@class,"grid")][1]');
  await expect(grid).toHaveCount(1);
  const overflowX = await grid.evaluate((el) => {
    return { scrollW: el.scrollWidth, clientW: el.clientWidth };
  });
  // 가로 오버플로우 없음(2px 허용 — 서브픽셀 반올림)
  expect(overflowX.scrollW - overflowX.clientW).toBeLessThanOrEqual(2);
  console.log('✅ 시나리오3: 회귀 0 + 가로 스크롤 없음', overflowX);
});
