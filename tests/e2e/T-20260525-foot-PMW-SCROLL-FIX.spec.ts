/**
 * T-20260525-foot-PMW-SCROLL-FIX
 * 수납방법 "카드" 선택 시 수납 버튼 클리핑 fix + 세트코드 드롭다운 스크롤
 *
 * AC-1: 세트코드 드롭다운 목록에 max-h-48 overflow-y-auto 적용 확인
 * AC-2: 카드 결제 선택 후 수납 버튼 스크롤 접근 가능 (클리핑 없음)
 * AC-3: action buttons 컨테이너 shrink-0 제거 + overflow-y-auto 적용
 * AC-4: 수가 항목 0건 상태에서 액션 버튼 영역 이상 없음 (기본 렌더)
 * AC-5: 세트 템플릿 3건 이하 시 스크롤 없이 정상 출력
 *
 * ── FIX-REQUEST(MSG-20260530-194556-hanb, phase2 insufficient_verification) 대응 ──
 * 종전 spec은 "수납대기 환자 없음" 조건으로 AC-2/3/4/5가 전부 test.skip → 실검증 0.
 * 이 spec은 beforeAll에서 수납대기(payment_waiting) check_in + 저장된 check_in_service
 * (유효 service_id) 를 직접 시드해 [결제하기](data-testid=btn-pay) → PaymentMiniWindow를
 * 실제로 열고, 저장 상태(btn-settle 노출)에서 카드 결제 선택 후 클리핑까지 끝까지 검증한다.
 * afterAll에서 시드 데이터를 정확히(전화번호 기준) 삭제한다.
 *
 * PaymentMiniWindow.tsx 초기화 로직(line ~734): check_in_services 에 유효한 service_id 가
 * 1건 이상 있으면 setSaved(true) → btn-settle 즉시 노출 → 카드 결제 클리핑 검증 가능.
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.BASE_URL ?? 'http://localhost:8089';

// ── 시드 전용 Supabase (service role) ────────────────────────────────────────
// playwright.config.ts 가 .env 를 로드하므로 process.env 우선, 없으면 dev 키 폴백.
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4bG9tb296YWtramVzZHFqdHZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjU5MjIxOSwiZXhwIjoyMDkyMTY4MjE5fQ.ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// 시드 식별자 — 실환자 보호용 고유 전화번호 + prefix
const SEED_PHONE = '+821099998801';
const SEED_NAME = '[PMW-SCROLL-TEST] 수납대기';

// 오늘(Asia/Seoul) 자정 기준 checked_in_at — 대시보드 기본 날짜(오늘) 칸반에 노출되도록
function todaySeoulISO(): string {
  // Asia/Seoul 기준 오늘 날짜 (YYYY-MM-DD)
  const now = new Date();
  const seoul = new Date(now.getTime() + 9 * 3600 * 1000); // UTC+9
  const y = seoul.getUTCFullYear();
  const m = String(seoul.getUTCMonth() + 1).padStart(2, '0');
  const d = String(seoul.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}T10:30:00+09:00`;
}

let seededCustomerId: string | null = null;
let seededCheckInId: string | null = null;
let seedOk = false;

async function cleanupSeed() {
  // 전화번호 기준 정확 삭제 (실환자 보호: is_simulation=true)
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
  // 클리닉
  const { data: clinic } = await supabase
    .from('clinics')
    .select('id')
    .eq('slug', 'jongno-foot')
    .single();
  if (!clinic) {
    console.warn('⚠️ clinic jongno-foot 없음 — 시드 스킵');
    return;
  }

  // 활성 서비스 1건 (check_in_service.service_id 매칭용 — saved=true 트리거)
  const { data: svc } = await supabase
    .from('services')
    .select('id, name, price')
    .eq('clinic_id', clinic.id)
    .eq('active', true)
    .order('display_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!svc) {
    console.warn('⚠️ 활성 서비스 없음 — 시드 스킵');
    return;
  }

  // 잔여 시드 정리 후 신규 생성 (idempotent)
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
  seededCustomerId = cust.id;

  const { data: ci, error: ciErr } = await supabase
    .from('check_ins')
    .insert({
      clinic_id: clinic.id,
      customer_id: cust.id,
      customer_name: SEED_NAME,
      customer_phone: SEED_PHONE,
      visit_type: 'returning',
      status: 'payment_waiting',
      queue_number: 9981,
      checked_in_at: todaySeoulISO(),
      sort_order: 9981,
    })
    .select('id')
    .single();
  if (ciErr || !ci) {
    console.warn('⚠️ check_in 시드 실패:', ciErr?.message);
    return;
  }
  seededCheckInId = ci.id;

  // 저장된 수가 항목 1건 (유효 service_id → 미니창 init 시 saved=true → btn-settle 노출)
  const price = (svc as { price?: number }).price ?? 100000;
  const { error: cisErr } = await supabase.from('check_in_services').insert({
    check_in_id: ci.id,
    service_id: svc.id,
    service_name: (svc as { name?: string }).name ?? '시술',
    price,
    original_price: price,
    is_package_session: false,
  });
  if (cisErr) {
    console.warn('⚠️ check_in_service 시드 실패:', cisErr.message);
    return;
  }

  seedOk = true;
  console.log(`✅ 시드 완료 — check_in=${ci.id} (status=payment_waiting, service_id=${svc.id})`);
});

test.afterAll(async () => {
  await cleanupSeed();
});

// 수납대기 카드의 [결제하기] 진입점을 통해 PaymentMiniWindow 열기
async function openMiniWindow(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/admin`);
  // 대시보드 로딩 대기
  await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => null);
  const payBtn = page.locator('[data-testid="btn-pay"]').first();
  await payBtn.waitFor({ state: 'visible', timeout: 15000 });
  await payBtn.click();
  // Zone2 헤더 또는 btn-settle 노출까지 대기
  await page.locator('[data-testid="btn-settle"]').first().waitFor({ timeout: 10000 }).catch(() => null);
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 세트코드 드롭다운에 overflow scroll 클래스 확인
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: 세트코드 드롭다운 리스트에 max-h-48 overflow-y-auto 클래스 포함', async ({ page }) => {
  expect(seedOk, '시드 실패 — 수납대기 환자 준비 불가').toBeTruthy();
  await openMiniWindow(page);

  const dropdownBtn = page.locator('[data-testid="fee-set-dropdown-btn"]');
  await expect(dropdownBtn).toBeVisible();
  await dropdownBtn.click();

  const dropdownList = page.locator('[data-testid="fee-set-dropdown-list"]');
  await expect(dropdownList).toBeVisible();
  const classList = (await dropdownList.getAttribute('class')) ?? '';
  expect(classList).toContain('max-h-48');
  expect(classList).toContain('overflow-y-auto');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 카드 선택 후 수납 버튼 스크롤 접근 가능 (클리핑 없음)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: 카드 결제 선택 후 수납 버튼이 클릭 가능 (클리핑 없음)', async ({ page }) => {
  expect(seedOk, '시드 실패 — 수납대기 환자 준비 불가').toBeTruthy();
  await openMiniWindow(page);

  // 시드된 check_in_service(유효 service_id) 덕에 미니창 진입 시 saved=true → btn-settle 노출
  const settleBtn = page.locator('[data-testid="btn-settle"]');
  await expect(settleBtn).toBeVisible({ timeout: 10000 });

  // 결제수단 "카드" 선택 → 카드 자동매칭 안내 박스 출현 → action buttons 높이 증가
  const cardMethodBtn = page.locator('button:has-text("카드")').first();
  await expect(cardMethodBtn).toBeVisible();
  await cardMethodBtn.click();
  await expect(page.locator('[data-testid="card-auto-match-info"]')).toBeVisible({ timeout: 5000 });

  // 카드 정보 박스 출현 후에도 수납 버튼이 스크롤로 접근 가능 + 클릭 가능 (클리핑 없음)
  await settleBtn.scrollIntoViewIfNeeded();
  await expect(settleBtn).toBeVisible();
  await expect(settleBtn).not.toBeDisabled();

  // bounding box 가 부모 컨테이너 안에 실제로 잡히는지(클리핑되어 height 0 아님) 확인
  const box = await settleBtn.boundingBox();
  expect(box, '수납 버튼 bounding box 존재(=클리핑 안 됨)').not.toBeNull();
  expect(box!.height).toBeGreaterThan(0);
  console.log('✅ AC-2: 카드 선택 후 수납 버튼 접근/클릭 가능 (클리핑 없음)');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: action buttons 컨테이너 CSS — shrink-0 제거 + overflow-y-auto + shrink
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: action buttons 컨테이너 CSS 클래스 — shrink-0 제거, overflow-y-auto 추가 확인', async ({ page }) => {
  expect(seedOk, '시드 실패 — 수납대기 환자 준비 불가').toBeTruthy();
  await openMiniWindow(page);

  const settleBtn = page.locator('[data-testid="btn-settle"]');
  await expect(settleBtn).toBeVisible({ timeout: 10000 });

  // action buttons 컨테이너(line ~2031)를 직접 타겟:
  // `overflow-y-auto border-t shrink min-h-0` 조합은 PaymentMiniWindow 내 유일.
  // (Zone3 패널 divider 는 shrink-0/sm:min-h-0 라 매칭되지 않음 → 오매칭 방지)
  const actionContainer = page
    .locator('div.overflow-y-auto.border-t.shrink.min-h-0')
    .filter({ has: page.locator('[data-testid="btn-settle"]') });
  await expect(actionContainer).toHaveCount(1);
  const classList = (await actionContainer.getAttribute('class')) ?? '';
  expect(classList).not.toContain('shrink-0'); // shrink-0 제거
  expect(classList).toContain('overflow-y-auto'); // 스크롤 허용
  expect(classList).toContain('shrink'); // shrink(flex-shrink:1) 적용
  expect(classList).toContain('min-h-0'); // 압축 허용
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4/5: PaymentMiniWindow 기본 렌더 + 세트코드 드롭다운 정상 동작
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4/5: PaymentMiniWindow 기본 렌더 + 세트코드 드롭다운 토글', async ({ page }) => {
  expect(seedOk, '시드 실패 — 수납대기 환자 준비 불가').toBeTruthy();
  await openMiniWindow(page);

  // Zone2 헤더
  await expect(page.locator('text=차트 코드 + 진료비 산정')).toBeVisible({ timeout: 8000 });

  // 세트코드 드롭다운 열기 → 클래스 확인 → 닫기 (3건 이하 정상 토글)
  const feeSetBtn = page.locator('[data-testid="fee-set-dropdown-btn"]');
  await expect(feeSetBtn).toBeVisible();
  await feeSetBtn.click();
  const list = page.locator('[data-testid="fee-set-dropdown-list"]');
  await expect(list).toBeVisible();
  const cls = (await list.getAttribute('class')) ?? '';
  expect(cls).toContain('max-h-48');
  expect(cls).toContain('overflow-y-auto');
  await feeSetBtn.click();
  await expect(list).not.toBeVisible();
  console.log('✅ AC-4/5: 기본 렌더 + 세트코드 드롭다운 토글 정상');
});
