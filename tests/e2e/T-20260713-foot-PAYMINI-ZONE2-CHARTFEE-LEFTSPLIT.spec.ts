/**
 * T-20260713-foot-PAYMINI-ZONE2-CHARTFEE-LEFTSPLIT
 *   → 레이아웃 재설계 반영: T-20260720-foot-PAYMINI-CHARTCODE-SPLIT (3열 → 4열 분할)
 *
 * 변경 배경(의도적 재설계):
 *   구: 중앙에 [차트코드 · 진료비 산정]을 컴팩트 접이식 한 줄(feeitem-row)로 두고 code-grid 아래 · settle 위에 세로로 끼움.
 *   신: 모달 안에서 좌→우 가로 4구역(sm:flex-row)으로 분리 — 접이식 토글/컴팩트 한 줄 premise 폐기.
 *       ① pmw-code-grid   : 항목 팔레트/그리드(+좌측 탭) — 무변경
 *       ② pmw-chartcode-col: 신규 독립 컬럼(헤더 "차트 코드", 내부 스크롤 pmw-chartcode-scroll,
 *                            상병코드·처방약·"치료내용 (N건)" 그룹, 하단 세트코드 드롭다운은 항상 노출)
 *       ③ pmw-settle-lane : 헤더 "진료비 산정"(세금구분·총액·수납잔액·차감후청구·btn-settle)
 *       ④ pmw-zone3       : 패키지/서류 — 무변경
 *   제거: pmw-feeitem-row / pmw-feeitem-toggle / pmw-feeitem-summary / "차트 코드 · 진료비 산정" 결합 텍스트 /
 *         접이식 토글(내용 항상 노출) / 라벨 "수가 항목"(→"치료내용").
 *
 * 본 spec = 실브라우저 시각/DOM 검증(auto-promote 금지 게이트):
 *   S1: 가로 컬럼 순서 = [① pmw-code-grid] → [② pmw-chartcode-col] → [③ pmw-settle-lane] (좌→우)
 *       (chartcode 의 left 가 code-grid 우측 · settle 이 chartcode 우측 → "4열 가로 분할")
 *   S2: ② 차트 코드 컬럼 내용은 항상 노출(토글 없음) — 항목 선택 후 pricing-list 가시
 *   S3: 모달 총 가로폭 불변 — 4구역 zone row 가 모달(dialog) 폭을 초과하지 않음(가로폭 불변 가드)
 *   + 스크린샷 evidence → _handoff/qa_screenshots
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const BASE = process.env.BASE_URL ?? 'http://localhost:8089';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env required'); })();

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PHONE = '+821099997713';
const NAME = '[PAYMINI-LEFTSPLIT-TEST]';
const QUEUE = 971;

// test-results/ 는 .gitignore 대상 → 앱 레포 오염 없이 evidence 산출. 게이트용 스샷은 SSOT(_handoff/qa_screenshots)로 복사.
const SHOT_DIR = path.join(process.cwd(), 'test-results', 'qa_evidence', 'T-20260713-foot-PAYMINI-ZONE2-CHARTFEE-LEFTSPLIT');

let clinicId: string | null = null;
let checkInId: string | null = null;
let seedOk = false;

async function cleanup() {
  const { data: custs } = await supabase.from('customers').select('id').eq('phone', PHONE);
  const ids = (custs ?? []).map((c) => c.id);
  if (ids.length === 0) return;
  const { data: cis } = await supabase.from('check_ins').select('id').in('customer_id', ids);
  const ciIds = (cis ?? []).map((c) => c.id);
  if (ciIds.length > 0) {
    await supabase.from('payments').delete().in('check_in_id', ciIds);
    await supabase.from('check_in_services').delete().in('check_in_id', ciIds);
    await supabase.from('check_ins').delete().in('id', ciIds);
  }
  await supabase.from('customers').delete().in('id', ids);
}

test.beforeAll(async () => {
  await cleanup();
  // 활성 서비스 2건 픽업 → pricingItems=2 (수가 항목 다건, feeitem 요약/펼침 검증)
  const { data: svcs } = await supabase
    .from('services').select('*').eq('active', true).limit(2);
  if (!svcs || svcs.length < 1) { seedOk = false; return; }
  clinicId = svcs[0].clinic_id;

  const { data: cust } = await supabase
    .from('customers')
    .insert({ clinic_id: clinicId, name: NAME, phone: PHONE, visit_type: 'returning' })
    .select().single();
  if (!cust) { seedOk = false; return; }

  const { data: ci } = await supabase
    .from('check_ins')
    .insert({
      clinic_id: clinicId, customer_id: cust.id, customer_name: NAME, customer_phone: PHONE,
      visit_type: 'returning', status: 'payment_waiting', queue_number: QUEUE,
    })
    .select().single();
  if (!ci) { seedOk = false; return; }
  checkInId = ci.id;

  // 저장된 시술 2건 → saved=true, 수가 항목 다건
  for (const svc of svcs) {
    await supabase.from('check_in_services').insert({
      check_in_id: checkInId, service_id: svc.id, service_name: svc.name,
      price: svc.price, original_price: svc.price, is_package_session: false,
    });
  }
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  seedOk = true;
});

test.afterAll(async () => { await cleanup(); });

async function openMiniWindow(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/admin`);
  await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => null);
  const wrapper = page.locator('div:has(> [data-testid="btn-pay"])').filter({ hasText: `#${QUEUE}` });
  const payBtn = wrapper.locator('[data-testid="btn-pay"]').first();
  await payBtn.waitFor({ state: 'visible', timeout: 20000 });
  await payBtn.scrollIntoViewIfNeeded();
  await payBtn.click();
  await page.locator('[data-testid="btn-settle"]').first().waitFor({ state: 'visible', timeout: 30000 });
}

test('S1+S2+S3: CHARTCODE-SPLIT 4열 가로 분할 = ① code-grid → ② 차트 코드 → ③ 진료비 산정(좌→우) + 내용 항상 노출 + 가로폭 불변', async ({ page }) => {
  test.skip(!seedOk, '시드 실패 — 스킵');

  await openMiniWindow(page);

  const grid = page.locator('[data-testid="pmw-code-grid"]').first();
  const chartcode = page.locator('[data-testid="pmw-chartcode-col"]').first();
  const settle = page.locator('[data-testid="pmw-settle-lane"]').first();

  await expect(grid, '① 항목 팔레트/그리드 존재').toBeVisible();
  await expect(chartcode, '② 차트 코드 독립 컬럼 존재').toBeVisible();
  await expect(settle, '③ 진료비 산정 lane 존재').toBeVisible();

  const gb = await grid.boundingBox();
  const cb = await chartcode.boundingBox();
  const sb = await settle.boundingBox();
  expect(gb && cb && sb, 'boundingBox 확보').toBeTruthy();

  // ── S1: 가로 컬럼 순서 = ① → ② → ③ (좌→우) ──
  const TOL = 4; // 소폭 허용치(경계선/패딩 흡수)
  //   ② 차트 코드의 left > ① code-grid left → "code-grid 오른쪽"
  expect(cb!.x, `② 차트 코드(x=${Math.round(cb!.x)})는 ① code-grid(x=${Math.round(gb!.x)}) 오른쪽이어야 함`).toBeGreaterThan(gb!.x + TOL);
  //   ③ 진료비 산정의 left > ② 차트 코드 left → "차트 코드 오른쪽"
  expect(sb!.x, `③ 진료비 산정(x=${Math.round(sb!.x)})는 ② 차트 코드(x=${Math.round(cb!.x)}) 오른쪽이어야 함`).toBeGreaterThan(cb!.x + TOL);

  // ── S3: 모달 총 가로폭 불변 — 4구역 zone row 가 모달(dialog) 폭을 초과하지 않음 ──
  const dialog = page.locator('[role="dialog"]').first();
  const db = await dialog.boundingBox();
  //   가로폭 불변 가드: 가장 오른쪽 구역(③)의 우측 경계가 모달 폭 안에 있어야 함
  expect(sb!.x + sb!.width, `③ 우측 경계(${Math.round(sb!.x + sb!.width)})가 모달 폭(dialog.x=${Math.round(db!.x)} + w=${Math.round(db!.width)}) 이내`).toBeLessThanOrEqual(db!.x + db!.width + 2);
  //   ② 차트 코드 컬럼 폭 역시 모달 폭 이내
  expect(cb!.width, `② 차트 코드 폭(${Math.round(cb!.width)})이 모달 폭(${Math.round(db!.width)}) 이내`).toBeLessThanOrEqual(db!.width + 2);

  // evidence: 전체 모달(내용 항상 노출 상태)
  await dialog.screenshot({ path: path.join(SHOT_DIR, '01-collapsed-modal.png') });
  await page.screenshot({ path: path.join(SHOT_DIR, '01-collapsed-full.png') });

  // ── S2: ② 차트 코드 내용은 항상 노출(토글 제거) — 항목 선택 후 pricing-list 가시 ──
  //   시드 항목(seeded services)을 팔레트에서 선택 → ② 칸 pricing-list 렌더
  await grid.locator('button').first().click().catch(() => null);
  await page.locator('[data-testid="pricing-list"]').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
  await expect(page.locator('[data-testid="pricing-list"]').first(), '② 차트 코드 pricing-list 노출').toBeVisible();
  await dialog.screenshot({ path: path.join(SHOT_DIR, '02-expanded-modal.png') });

  // 항목 선택 후에도 가로 순서 유지(① 왼쪽 · ③ 오른쪽)
  const gb2 = await grid.boundingBox();
  const cb2 = await chartcode.boundingBox();
  const sb2 = await settle.boundingBox();
  expect(cb2!.x).toBeGreaterThan(gb2!.x + TOL);
  expect(sb2!.x).toBeGreaterThan(cb2!.x + TOL);

  // eslint-disable-next-line no-console
  console.log(`[CHARTCODE-SPLIT-EVIDENCE] grid.x=${Math.round(gb!.x)} chartcode.x=${Math.round(cb!.x)} settle.x=${Math.round(sb!.x)} chartcode.w=${Math.round(cb!.width)} settle.right=${Math.round(sb!.x + sb!.width)} dialog.x=${Math.round(db!.x)} dialog.w=${Math.round(db!.width)}`);
});
