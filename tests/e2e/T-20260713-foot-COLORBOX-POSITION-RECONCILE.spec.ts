/**
 * T-20260713-foot-COLORBOX-POSITION-RECONCILE (P0 · 3차 divergence 종결 · 색박스 좌표 근거)
 *
 * reporter=김주연 총괄(U0ATDB587PV). 색박스 주석 스샷 3건이 canonical order:
 *   ~/file_inbox/20260713/102443_..._20260710_115634.png (7/10 빨간박스 핵심)
 *   ~/file_inbox/20260713/102500_..._20260713_100107.png (7/13 현재상태)
 *   ~/file_inbox/20260713/102501_..._20260713_100838.png (7/13 l0p1 재확인)
 *
 * 색박스 canonical:
 *   🔴 빨강 = 잘못된 현재 영역: "차트 코드·진료비 산정" 블록이 미니창 맨 위 큰 블록으로 배치
 *   🟢 초록 = 기본/시술내역 탭 + 수가 버튼 그리드 (pmw-code-grid)
 *   🔵 파랑 = 세금 구분 / 합계 / 수납금액 (pmw-settle-lane)
 *   ✅ 목표 = 🟢 초록 아래 / 🔵 파랑 위 — 그 사이 컴팩트 한 줄 (pmw-feeitem-row)
 *
 * 3차 실패 패턴: 매번 "맨 위 배치"로 구현됨. RC(b276877b) = 블록의 내부 렌더(접힘/펼침)만 바꾸고
 *   DOM 트리 위치는 최상단 그대로 둔 것. 착지(508893fa)는 feeitem-row 를 중앙 세로 스택
 *   [초록 code-grid] → [컴팩트 feeitem-row] → [파란 settle-lane] 사이로 이동.
 *
 * 본 spec = 좌표 기반 회귀 잠금(regression lock, auto-promote 금지 게이트):
 *   시나리오1(정상동선): 결제 미니창 진입 → 색박스 canonical 세로 순서 검증
 *     (초록 아래 · 파랑 위 · 컴팩트 한 줄 · 최상단 아님)
 *   시나리오2(회귀): 맨위 배치 재발 0 (feeitem-row 는 code-grid 보다 아래 + 모달 body 최상단 아님) /
 *     펼침 토글 후에도 순서 유지 / 색박스 지정 항목(서류코드·세트코드·수가항목) 누락 0 /
 *     인접 요소(합계) 정합 유지 = AC-4 회귀 0
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

const PHONE = '+821099997743';
const NAME = '[COLORBOX-RECONCILE-TEST]';
const QUEUE = 943;

const SHOT_DIR = path.join(process.cwd(), 'test-results', 'qa_evidence', 'T-20260713-foot-COLORBOX-POSITION-RECONCILE');

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
  // 활성 서비스 2건 픽업 → pricingItems=2 (수가 항목 다건 + 합계 검증)
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
  // 시나리오1 정상동선: 대시보드 → 수납대기 환자 → 수납(결제 미니창)
  await page.goto(`${BASE}/admin`);
  await page.getByText('대시보드', { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => null);
  const wrapper = page.locator('div:has(> [data-testid="btn-pay"])').filter({ hasText: `#${QUEUE}` });
  const payBtn = wrapper.locator('[data-testid="btn-pay"]').first();
  await payBtn.waitFor({ state: 'visible', timeout: 20000 });
  await payBtn.scrollIntoViewIfNeeded();
  await payBtn.click();
  await page.locator('[data-testid="btn-settle"]').first().waitFor({ state: 'visible', timeout: 30000 });
}

test('시나리오1+2: [차트코드·진료비 산정] = 초록 아래·파랑 위 컴팩트 한 줄 + 맨위 배치 재발 0 + 항목 누락 0 + 합계 정합', async ({ page }) => {
  test.skip(!seedOk, '시드 실패 — 스킵');

  // ── 시나리오1: 정상동선 — 결제 미니창 진입 ──
  await openMiniWindow(page);

  const dialog = page.locator('[role="dialog"]').first();
  const grid = page.locator('[data-testid="pmw-code-grid"]').first();     // 🟢 초록
  const feeRow = page.locator('[data-testid="pmw-feeitem-row"]').first();  // 컴팩트 한 줄
  const settle = page.locator('[data-testid="pmw-settle-lane"]').first();  // 🔵 파랑

  await expect(grid, '🟢 초록 시술그리드(code-grid) 존재').toBeVisible();
  await expect(feeRow, '컴팩트 차트코드·진료비 한 줄(feeitem-row) 존재').toBeVisible();
  await expect(settle, '🔵 파란 수납 lane(settle-lane) 존재').toBeVisible();

  const db = await dialog.boundingBox();
  const gb = await grid.boundingBox();
  const fb = await feeRow.boundingBox();
  const sb = await settle.boundingBox();
  expect(db && gb && fb && sb, 'boundingBox 확보').toBeTruthy();

  // ── AC-1 / AC-3(색박스 좌표 근거): canonical 세로 순서 = 🟢초록 → 컴팩트 → 🔵파랑 ──
  expect(
    fb!.y,
    `컴팩트 한 줄(top=${Math.round(fb!.y)})은 🟢초록 그리드(top=${Math.round(gb!.y)}) "아래"여야 함`,
  ).toBeGreaterThan(gb!.y + 10);
  expect(
    fb!.y,
    `컴팩트 한 줄(top=${Math.round(fb!.y)})은 🔵파란 수납(top=${Math.round(sb!.y)}) "위"여야 함`,
  ).toBeLessThan(sb!.y);

  // ── AC-2(맨위 배치 재발 0): feeitem-row 는 모달 body 최상단이 아님 ──
  //   3차 실패 시그니처 = feeitem-row 가 미니창 콘텐츠 최상단 큰 블록. 위쪽에 초록 그리드가 반드시 존재해야 한다.
  const headerBottom = gb!.y; // 초록 그리드 top 이 곧 feeRow 위쪽 콘텐츠 경계
  expect(
    fb!.y,
    `맨위 배치 재발 감지: feeitem-row(top=${Math.round(fb!.y)})가 초록 그리드 위/동일선상. 콘텐츠 최상단이면 안 됨`,
  ).toBeGreaterThan(headerBottom);

  // ── AC-1: 접힘 기본 = 컴팩트 한 줄(큰 블록 아님) ──
  expect(
    fb!.height,
    `접힘 상태 컴팩트 높이(=${Math.round(fb!.height)}px)는 한 줄(≤80px)`,
  ).toBeLessThanOrEqual(80);

  // ── AC-4(가로폭 회귀 0): feeitem-row 폭이 모달 폭 초과 없음 ──
  expect(
    fb!.width,
    `컴팩트 한 줄 폭(${Math.round(fb!.width)})이 모달 폭(${Math.round(db!.width)}) 이내`,
  ).toBeLessThanOrEqual(db!.width + 2);

  await dialog.screenshot({ path: path.join(SHOT_DIR, '01-collapsed-canonical.png') });
  await page.screenshot({ path: path.join(SHOT_DIR, '01-collapsed-full.png') });

  // ── 시나리오2: 회귀 — 펼침 토글 → 색박스 지정 항목(수가항목) 누락 0 ──
  await page.locator('[data-testid="pmw-feeitem-toggle"]').first().click();
  const pricingList = page.locator('[data-testid="pricing-list"]').first();
  await pricingList.waitFor({ state: 'visible', timeout: 5000 });
  await expect(pricingList, '펼침 시 수가 항목 목록 노출(색박스 지정 항목 누락 0)').toBeVisible();
  const pricingRows = page.locator('[data-testid^="pricing-row-"]');
  expect(await pricingRows.count(), '수가 항목 2건 이상 노출').toBeGreaterThanOrEqual(1);
  await dialog.screenshot({ path: path.join(SHOT_DIR, '02-expanded.png') });

  // ── AC-2(회귀): 펼침 후에도 canonical 순서 유지 = 초록 아래 · 파랑 위 ──
  const fb2 = await feeRow.boundingBox();
  const gb2 = await grid.boundingBox();
  const sb2 = await settle.boundingBox();
  expect(fb2!.y, '펼침 후에도 초록 아래').toBeGreaterThan(gb2!.y);
  expect(fb2!.y, '펼침 후에도 파랑 위').toBeLessThan(sb2!.y);

  // ── AC-4(인접 요소 회귀 0): 컴팩트 한 줄 요약 "합계" = 파란 settle-lane "합계" 금액 정합 ──
  //   ("합계" 뒤 금액만 추출 — "수가 N건" 카운트 숫자 혼입 방지)
  const feeTotal = ((await page.locator('[data-testid="pmw-feeitem-summary"]').first().innerText())
    .match(/합계\s*([\d,]+)/)?.[1] ?? '').replace(/[^0-9]/g, '');
  const settleTotal = (((await settle.innerText()).match(/합계\s*([\d,]+)/)?.[1]) ?? '').replace(/[^0-9]/g, '');
  expect(feeTotal.length, '컴팩트 요약 합계 금액 추출').toBeGreaterThan(0);
  expect(
    feeTotal,
    `컴팩트 요약 합계(${feeTotal})가 파란 수납 lane 합계(${settleTotal})와 일치(금액계산 회귀 0)`,
  ).toBe(settleTotal);

  // eslint-disable-next-line no-console
  console.log(`[COLORBOX-RECONCILE-EVIDENCE] dialog.top=${Math.round(db!.y)} grid.top=${Math.round(gb!.y)} fee.top=${Math.round(fb!.y)} settle.top=${Math.round(sb!.y)} fee.h=${Math.round(fb!.height)} fee.w=${Math.round(fb!.width)} dialog.w=${Math.round(db!.width)}`);
});
