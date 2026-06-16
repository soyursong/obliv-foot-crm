/**
 * T-20260616-foot-CLOSING-PAYWAIT-PMW-SWAP
 * 일마감(Closing) 결제대기 명단 행 클릭 시 레거시 PaymentDialog → PaymentMiniWindow 교체.
 *
 * AC-1: 일마감 결제대기 명단에서 고객 행 클릭 시 PaymentMiniWindow가 열린다 (레거시 PaymentDialog 아님).
 * AC-2: 미니창에 클릭한 고객 정보(이름/차트번호 영역) 표시 + 결제 산정 UI(차트 코드 + 진료비 산정) 노출.
 * AC-3: 미니창 닫기 시 명단으로 정상 복귀, 잔여 모달/오버레이 없음.
 * AC-4: 레거시 PaymentDialog 전용 마크업(data-testid="btn-payment-submit")은 더 이상 뜨지 않는다.
 *
 * 구분 마커:
 *   - PaymentMiniWindow: text "차트 코드 + 진료비 산정", data-testid="fee-set-dropdown-btn"
 *   - 레거시 PaymentDialog: data-testid="btn-payment-submit" (이 spec에서 부재 검증)
 *
 * 시드: 오늘(Asia/Seoul) status=payment_waiting check_in 1건 → Closing "미수 경고 — 결제대기" 명단 노출.
 *       afterAll에서 전화번호 기준 정확 삭제(실환자 보호: is_simulation=true).
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

// 시드 식별자 — 실환자 보호용 고유 전화번호 + prefix (PMW-SCROLL spec과 다른 번호로 충돌 방지)
const SEED_PHONE = '+821099998802';
const SEED_NAME = '[CLOSING-PMW-TEST] 결제대기';

// Asia/Seoul 기준 오늘 10:30 (Closing 기본 날짜=오늘 명단에 노출되도록)
function todaySeoulISO(): string {
  const now = new Date();
  const seoul = new Date(now.getTime() + 9 * 3600 * 1000); // UTC+9
  const y = seoul.getUTCFullYear();
  const m = String(seoul.getUTCMonth() + 1).padStart(2, '0');
  const d = String(seoul.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}T10:30:00+09:00`;
}

let seededCheckInId: string | null = null;
let seedOk = false;

async function cleanupSeed() {
  const { data: custs } = await supabase
    .from('customers')
    .select('id')
    .eq('phone', SEED_PHONE)
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

  // 활성 서비스 1건 (check_in_service 시드 → PMW saved 상태 init)
  const { data: svc } = await supabase
    .from('services')
    .select('id, name, price')
    .eq('clinic_id', clinic.id)
    .eq('active', true)
    .order('display_order', { ascending: true })
    .limit(1)
    .maybeSingle();

  await cleanupSeed();

  const { data: cust, error: custErr } = await supabase
    .from('customers')
    .insert({
      clinic_id: clinic.id,
      name: SEED_NAME,
      phone: SEED_PHONE,
      visit_type: 'returning',
      is_simulation: true,
      inflow_channel: 'returning',
    })
    .select('id')
    .single();
  if (custErr || !cust) {
    console.warn('⚠️ 고객 시드 실패:', custErr?.message);
    return;
  }

  const { data: ci, error: ciErr } = await supabase
    .from('check_ins')
    .insert({
      clinic_id: clinic.id,
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
    return;
  }
  seededCheckInId = ci.id;

  if (svc) {
    const price = (svc as { price?: number }).price ?? 100000;
    await supabase.from('check_in_services').insert({
      check_in_id: ci.id,
      service_id: svc.id,
      service_name: (svc as { name?: string }).name ?? '시술',
      price,
      original_price: price,
      is_package_session: false,
    });
  }

  seedOk = true;
  console.log(`✅ 시드 완료 — check_in=${ci.id} (status=payment_waiting, today)`);
});

test.afterAll(async () => {
  await cleanupSeed();
});

// 일마감 화면 진입 → 결제대기 명단의 시드 고객 행 클릭
async function openPaymentFromClosing(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/admin/closing`);
  // 결제대기 명단 카드 헤더 대기
  await page.getByText(/미수 경고 — 결제대기/).waitFor({ timeout: 20000 });
  // 시드 고객 행 버튼(이름 포함) 클릭
  const row = page.locator('button', { hasText: SEED_NAME }).first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  await row.click();
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 / AC-2 / AC-4: 행 클릭 → PaymentMiniWindow 오픈, 레거시 PaymentDialog 부재
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1/2/4: 결제대기 명단 행 클릭 시 PaymentMiniWindow 오픈 (레거시 PaymentDialog 아님)', async ({ page }) => {
  expect(seedOk, '시드 실패 — 결제대기 고객 준비 불가').toBeTruthy();
  await openPaymentFromClosing(page);

  // PMW 고유 마커: "차트 코드 + 진료비 산정" 헤더 + fee-set-dropdown-btn
  await expect(page.getByText('차트 코드 + 진료비 산정')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="fee-set-dropdown-btn"]')).toBeVisible();

  // 레거시 PaymentDialog 전용 마커는 부재해야 함
  await expect(page.locator('[data-testid="btn-payment-submit"]')).toHaveCount(0);

  // 클릭한 고객 정보 반영 — 미니창 내 고객명 노출 확인
  await expect(page.getByText(SEED_NAME).first()).toBeVisible();
  console.log('✅ AC-1/2/4: PMW 오픈 + 레거시 PaymentDialog 부재 확인');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 닫기 → 명단 복귀, 잔여 오버레이 없음
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: 미니창 닫기 시 명단 복귀 + 잔여 오버레이 없음', async ({ page }) => {
  expect(seedOk, '시드 실패 — 결제대기 고객 준비 불가').toBeTruthy();
  await openPaymentFromClosing(page);

  await expect(page.getByText('차트 코드 + 진료비 산정')).toBeVisible({ timeout: 10000 });

  // 닫기(X) — PMW 헤더 닫기 버튼 (aria-label/title 또는 X 아이콘)
  const closeBtn = page
    .getByRole('button', { name: /닫기|취소|close/i })
    .first();
  if (await closeBtn.count()) {
    await closeBtn.click();
  } else {
    // 폴백: Escape
    await page.keyboard.press('Escape');
  }

  // 미니창 마커 사라짐 + 명단 헤더 그대로 유지
  await expect(page.getByText('차트 코드 + 진료비 산정')).toHaveCount(0, { timeout: 8000 });
  await expect(page.getByText(/미수 경고 — 결제대기/)).toBeVisible();
  // 잔여 레거시 다이얼로그 오버레이 없음
  await expect(page.locator('[data-testid="btn-payment-submit"]')).toHaveCount(0);
  console.log('✅ AC-3: 닫기 후 명단 복귀 + 잔여 오버레이 없음');
});
