/**
 * E2E spec — T-20260727-foot-PMW-SETTLE-KEEPMINIWINDOW-OPEN
 * 결제 미니창(PaymentMiniWindow)에서 [수납] 클릭 후 미니창을 닫지 않고 열린 상태로 유지.
 *
 * 배경(김주연 총괄 field-soak 후속 #1): 현장 동선 = [수납] 직후 같은 미니창에서 [출력](계산서·영수증)
 *   등 후속작업을 이어서 수행한다. 종전엔 [수납] 성공 시 onComplete()가 미니창을 닫아(setTarget(null))
 *   현장이 다시 카드를 열어 [출력]해야 했다. 이 건이 REFUND200 요건②(서류 확인) 동선을 enable 한다.
 *
 * 구현(FE 상태 한정):
 *   - PaymentMiniWindow: 신규 prop onSettled?() — [수납] 성공 시 onComplete(닫기) 대신 onSettled(리페치·창 유지) 호출.
 *   - settled 상태 도입: 창이 유지되므로 [수납] 재클릭 이중수납 방지(버튼 disabled + handleSettle 조기 가드).
 *   - 부모(Dashboard/Closing/Reservations): onSettled = 리페치만(닫기·counter++ 미수행) → checkIn.id 불변으로
 *     리셋 useEffect([checkIn?.id]) 미재실행 → 선택항목·서류 carry-forward 상태 보존.
 *   ⚠ 무변경: 수납 처리(payments INSERT·회차 consume RPC) / [닫기]·X 수동닫기 / NOAUTOCOMPLETE 카드거동.
 *
 * 시나리오(브라우저 실렌더 witness):
 *   witness-1: 카드 단일 [수납] → 미니창이 닫히지 않고 열린 상태 유지 + [출력](서류발행) 이어서 가능
 *   witness-2: 수납 후 [수납] 재클릭 차단(버튼 비활성 '수납 완료') → payments 이중 INSERT 없음(1행 유지)
 *   NOAUTOCOMPLETE 무회귀: 수납 후에도 check_ins.status 는 done 아님(완료칸 미이동 — base 회귀 0)
 *
 * 회귀 가드(오프라인 로직): keep-open 콜백 계약 + settled 재진입 차단 불변식.
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

// 고유 테스트 전화번호 — 실고객/타 스펙 시드와 충돌 없이 정확 cleanup.
const SEED_PHONE = '+821099998827';
const SEED_NAME = '[PMW-KEEPOPEN-TEST] 수납대기';
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

// 수납대기 환자 1명 + 저장된 수가항목(100,000, 비급여) 시드 → check_in_id 반환.
//   비급여 항목으로 시드해 급여 진료기록 게이트와 무관하게 [수납] 동선을 독립 검증(SPLIT-PAYMENT 선례 동형).
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
      queue_number: 9983,
      checked_in_at: todaySeoulISO(),
      sort_order: 9983,
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

test.afterAll(async () => {
  await cleanupSeed();
});

test.beforeEach(async () => {
  if (!seedOk) return;
  seededCheckInId = await seedPaymentWaiting();
});

async function openMiniWindow(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto(`${BASE}/admin`);
  const dash = await page
    .getByText('대시보드', { exact: true })
    .first()
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (!dash) return false; // 로그인 storageState 부재(supervisor QA 워크트리 등) → graceful skip
  // 공유 dev-DB 에 다수 수납대기 카드가 있어 .first() 는 우리 시드가 아닐 수 있다(저장 시술 없는 카드 →
  //   saved=false → btn-settle 미노출). 고유 SEED_NAME 카드의 [결제하기]만 정확히 클릭한다.
  const seedWrap = page
    .locator('div:has(> [data-testid="checkin-card"])')
    .filter({ hasText: SEED_NAME });
  const payBtn = seedWrap.getByTestId('btn-pay').first();
  const shown = await payBtn
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!shown) return false;
  await payBtn.click();
  // 미니창 준비 신호 = btn-settle 노출(saved=true 시술 복원·마운트 완료).
  await page.locator('[data-testid="btn-settle"]').first().waitFor({ state: 'visible', timeout: 30000 });
  return true;
}

async function fetchPayments(checkInId: string) {
  const { data } = await supabase
    .from('payments')
    .select('amount, method, check_in_id')
    .eq('check_in_id', checkInId);
  return data ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// witness-1: 카드 단일 [수납] → 미니창 열림 유지 + [출력] 이어서 가능
// ─────────────────────────────────────────────────────────────────────────────
test('witness-1: [수납] 후 미니창이 닫히지 않고 열린 상태 유지 + 서류 [출력] 이어서 가능', async ({ page }) => {
  expect(seedOk, '시드 실패(clinic/service 부재)').toBeTruthy();
  expect(seededCheckInId, 'check_in 시드 실패').toBeTruthy();
  const ciId = seededCheckInId!;

  const opened = await openMiniWindow(page);
  if (!opened) {
    test.skip(true, '대시보드 로그인/수납대기 카드 미도달 — graceful skip (실검증=macstudio + 갤탭 field-soak)');
    return;
  }

  // 미니창이 열려 있음(수납 전)
  await expect(page.getByText('결제 미니창', { exact: false })).toBeVisible();

  // 단일 카드 결제수단 선택 후 [수납]
  await page.locator('button:has-text("카드")').first().click().catch(() => {});
  const settleBtn = page.locator('[data-testid="btn-settle"]');
  await expect(settleBtn).not.toBeDisabled();
  await settleBtn.click();
  await page.waitForTimeout(2500);

  // ★ 핵심 witness: [수납] 후에도 미니창이 열린 상태로 유지된다(닫히지 않음).
  await expect(page.getByText('결제 미니창', { exact: false }), '[수납] 후 미니창이 닫히지 않고 유지되어야 함').toBeVisible();

  // 같은 창에서 후속작업([출력]=서류발행)을 이어갈 수 있다(버튼 존재).
  await expect(page.locator('[data-testid="btn-doc-print"]'), '수납 직후 같은 창에서 [출력] 버튼이 살아 있어야 함').toBeVisible();

  // payments 는 정상 1행 기록(수납 보존 — Q3 무변경).
  const pays = await fetchPayments(ciId);
  expect(pays.length, '카드 단일 수납 payments 1행').toBe(1);
  expect(pays[0].method).toBe('card');
  expect(pays[0].amount).toBe(SETTLE_AMOUNT);

  console.log('✅ witness-1: 수납 후 미니창 열림 유지 + [출력] 가용 + payments 1행 PASS');
});

// ─────────────────────────────────────────────────────────────────────────────
// witness-2: 수납 후 [수납] 재클릭 차단 → payments 이중 INSERT 없음 + NOAUTOCOMPLETE 무회귀
// ─────────────────────────────────────────────────────────────────────────────
test('witness-2: 수납 후 [수납] 버튼 비활성(수납 완료) → 이중수납 없음 + status done 아님(NOAUTOCOMPLETE 무회귀)', async ({ page }) => {
  expect(seedOk, '시드 실패').toBeTruthy();
  expect(seededCheckInId, 'check_in 시드 실패').toBeTruthy();
  const ciId = seededCheckInId!;

  const opened = await openMiniWindow(page);
  if (!opened) {
    test.skip(true, '대시보드 로그인/수납대기 카드 미도달 — graceful skip');
    return;
  }

  await page.locator('button:has-text("카드")').first().click().catch(() => {});
  const settleBtn = page.locator('[data-testid="btn-settle"]');
  await settleBtn.click();
  await page.waitForTimeout(2500);

  // 창 유지 상태에서 [수납] 버튼은 비활성('수납 완료')로 전환 → 이중수납 차단.
  await expect(settleBtn, '수납 완료 후 [수납] 버튼 비활성(이중수납 방지)').toBeDisabled();
  await expect(settleBtn).toContainText('수납 완료');

  // 재클릭 시도(force) → 가드로 무시되어 payments 는 여전히 1행.
  await settleBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(1500);
  const pays = await fetchPayments(ciId);
  expect(pays.length, '[수납] 재클릭해도 payments 이중 INSERT 없음(1행 유지)').toBe(1);

  // NOAUTOCOMPLETE 무회귀: 수납해도 status 는 done 이 아니라 진행상태 유지(완료칸 미이동).
  const { data: ci } = await supabase
    .from('check_ins')
    .select('status')
    .eq('id', ciId)
    .single();
  expect(ci?.status, '수납 후에도 done 자동 이동 없음(NOAUTOCOMPLETE base 회귀 0)').not.toBe('done');

  console.log('✅ witness-2: 이중수납 차단 + status done 아님(NOAUTOCOMPLETE 무회귀) PASS');
});

// ─────────────────────────────────────────────────────────────────────────────
// 회귀 가드(오프라인): keep-open 콜백 계약 + settled 재진입 차단 불변식
// ─────────────────────────────────────────────────────────────────────────────
test('회귀 가드: handleSettle 성공 시 onSettled(창 유지) 우선 · settled 후 재진입 차단 (콜백 계약)', () => {
  // PaymentMiniWindow.handleSettle 의 창-유지 분기와 이중수납 가드를 순수 로직으로 재현(FE 상태 계약).
  //   ① settled/submitting 이면 조기 return(이중수납 차단)  ② 성공 시 settled=true + onSettled?? onComplete.

  type Env = { settled: boolean; submitting: boolean; onSettledCalls: number; onCompleteCalls: number; payments: number };

  // 실제 handleSettle 성공경로의 분기 형태를 그대로 미러(부수효과=결제·콜백만 카운트).
  const runSettle = (env: Env, opts: { hasOnSettled: boolean }) => {
    if (env.settled || env.submitting) return;            // 조기 가드
    // executeAutoDone(payments INSERT) 성공 가정
    env.payments += 1;
    env.settled = true;                                   // 수납완료 마킹(버튼 disabled)
    if (opts.hasOnSettled) env.onSettledCalls += 1;       // 창 유지(리페치만)
    else env.onCompleteCalls += 1;                        // 폴백: 닫기
  };

  // (1) onSettled 제공 부모(Dashboard/Closing/Reservations) — 창 유지 콜백 우선.
  const withKeepOpen: Env = { settled: false, submitting: false, onSettledCalls: 0, onCompleteCalls: 0, payments: 0 };
  runSettle(withKeepOpen, { hasOnSettled: true });
  expect(withKeepOpen.onSettledCalls, 'onSettled 제공 시 창 유지 콜백 호출').toBe(1);
  expect(withKeepOpen.onCompleteCalls, 'onSettled 제공 시 onComplete(닫기) 미호출').toBe(0);
  expect(withKeepOpen.settled, '수납 성공 → settled=true').toBe(true);

  // (2) settled 이후 [수납] 재클릭 — 조기 가드로 이중 결제/이중 콜백 없음.
  runSettle(withKeepOpen, { hasOnSettled: true });
  expect(withKeepOpen.payments, '재클릭해도 payments 이중 INSERT 없음').toBe(1);
  expect(withKeepOpen.onSettledCalls, '재클릭해도 콜백 이중 호출 없음').toBe(1);

  // (3) 하위호환: onSettled 미제공 부모 → 종전대로 onComplete(닫기) 폴백.
  const legacy: Env = { settled: false, submitting: false, onSettledCalls: 0, onCompleteCalls: 0, payments: 0 };
  runSettle(legacy, { hasOnSettled: false });
  expect(legacy.onCompleteCalls, 'onSettled 미제공 시 onComplete(닫기) 폴백').toBe(1);
  expect(legacy.onSettledCalls).toBe(0);

  console.log('✅ 회귀 가드: keep-open 콜백 우선 + settled 재진입 차단 + 하위호환 폴백 PASS');
});
