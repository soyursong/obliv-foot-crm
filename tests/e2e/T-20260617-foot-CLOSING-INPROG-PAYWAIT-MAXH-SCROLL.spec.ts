/**
 * T-20260617-foot-CLOSING-INPROG-PAYWAIT-MAXH-SCROLL
 * 일마감(/admin/closing) "진행 중" / "결제대기(미수)" 박스 내부 스크롤(max-height) 추가.
 *
 * 변경 요지(FE-only, 스키마·로직 무변경 — BOXLAYOUT 2-col 병치 위 상보 적용):
 *   - 각 박스의 리스트 영역(CardContent)에 고정 max-height(max-h-48) + overflow-y-auto.
 *   - 항목이 많아도 박스 외형 높이는 일정, 박스 *내부에서만* 세로 스크롤 → 페이지 과길이 방지.
 *   - 헤더(제목 "진행 중"/"결제대기" + 카운트 배지)는 CardHeader로 스크롤 영역 *밖* 고정.
 *   - 두 박스 동일 max-h → 2-col 병치 시 높이 균형.
 *
 * AC(회귀 0):
 *   AC-1: 진행중 리스트 영역(CardContent)에 max-h-48 + overflow-y-auto 클래스 적용.
 *   AC-2: 항목 다수(8건+) 시 해당 박스 리스트 영역 scrollHeight > clientHeight (내부 스크롤 활성).
 *   AC-3: 헤더(제목/카운트 배지)는 스크롤 영역(CardContent) 밖 — 스크롤해도 제목 고정.
 *   AC-4: 결제대기 박스도 동일 max-h-48 → 두 박스 max-height 균형.
 *
 * 시드: 오늘(Asia/Seoul) check_in — 진행중 9건(overflow 유발) + 결제대기 1건.
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

// 시드 식별자 — 실환자 보호용 고유 전화번호(다른 Closing spec과 충돌 방지)
const SEED_PREFIX_INPROG = '+8210999988'; // + 2자리 인덱스 (20~28)
const SEED_PHONE_PAYWAIT = '+821099998830';
const SEED_NAME_PREFIX = '[MAXHSCROLL-TEST]';
const INPROG_COUNT = 9;

function todaySeoulISO(): string {
  const now = new Date();
  const seoul = new Date(now.getTime() + 9 * 3600 * 1000); // UTC+9
  const y = seoul.getUTCFullYear();
  const m = String(seoul.getUTCMonth() + 1).padStart(2, '0');
  const d = String(seoul.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}T10:30:00+09:00`;
}

function seedPhones(): string[] {
  const list: string[] = [SEED_PHONE_PAYWAIT];
  for (let i = 0; i < INPROG_COUNT; i++) {
    list.push(`${SEED_PREFIX_INPROG}${String(20 + i).padStart(2, '0')}`);
  }
  return list;
}

let seedOk = false;

async function cleanupSeed() {
  const { data: custs } = await supabase
    .from('customers')
    .select('id')
    .in('phone', seedPhones())
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
    .select('id')
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

  let allOk = true;
  // 진행중 9건 (overflow 유발)
  for (let i = 0; i < INPROG_COUNT; i++) {
    const phone = `${SEED_PREFIX_INPROG}${String(20 + i).padStart(2, '0')}`;
    const ok = await seedCheckIn(
      clinic.id,
      `${SEED_NAME_PREFIX} 진행중${i + 1}`,
      phone,
      'treatment_waiting',
      9920 + i,
    );
    allOk = allOk && ok;
  }
  // 결제대기 1건 (균형 비교용)
  const okPay = await seedCheckIn(
    clinic.id,
    `${SEED_NAME_PREFIX} 결제대기`,
    SEED_PHONE_PAYWAIT,
    'payment_waiting',
    9930,
  );

  seedOk = allOk && okPay;
  if (seedOk) console.log(`✅ 시드 완료 — 진행중 ${INPROG_COUNT}건 + 결제대기 1건 (today)`);
});

test.afterAll(async () => {
  await cleanupSeed();
});

async function gotoClosing(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/admin/closing`);
  await page.getByText(/결제대기/).first().waitFor({ timeout: 20000 });
}

// 진행중 박스의 리스트 영역(CardContent) locator — 헤더 "진행 중"을 가진 Card 내부 CardContent
function inProgContent(page: import('@playwright/test').Page) {
  return page
    .locator('div.grid.md\\:grid-cols-2 > div', { hasText: '진행 중' })
    .first()
    .locator('.overflow-y-auto')
    .first();
}
function payWaitContent(page: import('@playwright/test').Page) {
  return page
    .locator('div.grid.md\\:grid-cols-2 > div', { hasText: '결제대기' })
    .first()
    .locator('.overflow-y-auto')
    .first();
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-1: 진행중 리스트 영역에 max-h + overflow-y-auto 적용
// ─────────────────────────────────────────────────────────────────────────────
test('AC-1: 진행중 리스트 영역 max-h-48 + overflow-y-auto 클래스', async ({ page }) => {
  expect(seedOk, '시드 실패 — 박스 준비 불가').toBeTruthy();
  await gotoClosing(page);

  const content = inProgContent(page);
  await expect(content).toBeVisible({ timeout: 10000 });
  const cls = (await content.getAttribute('class')) ?? '';
  expect(cls, '진행중 CardContent에 max-h-48 누락').toContain('max-h-48');
  expect(cls, '진행중 CardContent에 overflow-y-auto 누락').toContain('overflow-y-auto');
  console.log('✅ AC-1: 진행중 리스트 max-h-48 + overflow-y-auto 확인');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2: 항목 다수 시 내부 스크롤 활성 (scrollHeight > clientHeight)
// ─────────────────────────────────────────────────────────────────────────────
test('AC-2: 진행중 9건 시 박스 내부 세로 스크롤 활성', async ({ page }) => {
  expect(seedOk).toBeTruthy();
  await gotoClosing(page);

  const content = inProgContent(page);
  await expect(content).toBeVisible({ timeout: 10000 });

  const { scrollH, clientH } = await content.evaluate((el) => ({
    scrollH: el.scrollHeight,
    clientH: el.clientHeight,
  }));
  // 9건은 max-h-48(192px)를 초과 → 내부 스크롤 발생
  expect(scrollH, `scrollHeight(${scrollH}) > clientHeight(${clientH}) 여야 내부 스크롤`).toBeGreaterThan(
    clientH,
  );
  // 박스 외형 높이는 max-h-48(192px) 이내로 고정
  expect(clientH, `clientHeight(${clientH})가 max-h-48(192px) 부근 고정`).toBeLessThanOrEqual(200);
  console.log(`✅ AC-2: 내부 스크롤 활성 (scroll=${scrollH} > client=${clientH}, 박스 고정)`);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3: 헤더(제목/카운트)는 스크롤 영역 밖 — 스크롤 영역 내부에 제목 미포함
// ─────────────────────────────────────────────────────────────────────────────
test('AC-3: 헤더(제목·카운트)는 스크롤 영역 밖 고정', async ({ page }) => {
  expect(seedOk).toBeTruthy();
  await gotoClosing(page);

  const content = inProgContent(page);
  await expect(content).toBeVisible({ timeout: 10000 });

  // 스크롤 영역(CardContent) 안에는 행 button만 — 제목 heading은 밖(CardHeader)
  await expect(content.getByRole('heading', { name: /진행 중/ })).toHaveCount(0);
  // 제목 heading 자체는 페이지에 존재(스크롤 영역 밖)
  await expect(page.getByRole('heading', { name: /진행 중/ }).first()).toBeVisible();
  console.log('✅ AC-3: 제목/카운트 헤더는 스크롤 영역 밖 고정');
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-4: 결제대기 박스도 동일 max-h-48 → 두 박스 높이 균형
// ─────────────────────────────────────────────────────────────────────────────
test('AC-4: 결제대기 박스도 동일 max-h-48 (2-col 균형)', async ({ page }) => {
  expect(seedOk).toBeTruthy();
  await gotoClosing(page);

  const pay = payWaitContent(page);
  await expect(pay).toBeVisible({ timeout: 10000 });
  const cls = (await pay.getAttribute('class')) ?? '';
  expect(cls, '결제대기 CardContent에 max-h-48 누락').toContain('max-h-48');
  expect(cls, '결제대기 CardContent에 overflow-y-auto 누락').toContain('overflow-y-auto');
  console.log('✅ AC-4: 결제대기 박스 동일 max-h-48 — 2-col 균형');
});
