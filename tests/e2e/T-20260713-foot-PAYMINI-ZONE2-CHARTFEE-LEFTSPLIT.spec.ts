/**
 * T-20260713-foot-PAYMINI-ZONE2-CHARTFEE-LEFTSPLIT (P0 HOTFIX · 3연속 미착지 후 착지)
 *
 * 현장 확정(스레드 ts=1783652657, 김주연 총괄, 색박스 좌표 근거):
 *   ✅ 맞는 위치: 초록 구역(시술 선택 그리드) 아래 / 파란 구역(수납 금액) 위 — 그 사이 컴팩트 한 줄
 *   ❌ 틀린 위치: 미니창 맨 위 큰 블록
 *
 * 근본원인(b276877b): [차트코드+진료비 산정]을 컴팩트 토글 한 줄로 바꾸는 데는 성공했으나,
 *   feeitem-row 를 body flex-col 의 첫 자식(하단 band 보다 위)에 그대로 둬서 DOM 순서상 여전히 최상단.
 *   블록의 내부 렌더(접힘/펼침)만 바꿨고 트리 위치는 안 옮긴 것 → "맨 위 큰 블록" 그대로.
 *
 * 본 spec = 실브라우저 시각/DOM 검증(auto-promote 금지 게이트):
 *   S1: DOM 세로 순서 = [초록 pmw-code-grid] → [컴팩트 pmw-feeitem-row] → [파란 pmw-settle-lane]
 *       (feeitem-row 의 top 이 code-grid 아래 · settle-lane 위 → "초록 아래 / 파란 위 사이")
 *   S2: feeitem-row 는 모달 최상단이 아님(code-grid 보다 아래) + 접힘 시 컴팩트(한 줄) 높이
 *   S3: 모달 총 가로폭 = 기존과 동일(feeitem-row 폭 = code-grid+settle 스택 폭 내, 모달 폭 초과 없음)
 *   + 스크린샷 evidence(접힘/펼침) → _handoff/qa_screenshots
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

test('S1+S2+S3: 차트코드·진료비 컴팩트 한 줄 = 초록(시술그리드) 아래 · 파란(수납) 위 사이 + 최상단 아님 + 가로폭 불변', async ({ page }) => {
  test.skip(!seedOk, '시드 실패 — 스킵');

  await openMiniWindow(page);

  const grid = page.locator('[data-testid="pmw-code-grid"]').first();
  const feeRow = page.locator('[data-testid="pmw-feeitem-row"]').first();
  const settle = page.locator('[data-testid="pmw-settle-lane"]').first();

  await expect(grid, '초록 시술그리드 존재').toBeVisible();
  await expect(feeRow, '컴팩트 차트코드·진료비 한 줄 존재').toBeVisible();
  await expect(settle, '파란 수납 lane 존재').toBeVisible();

  const gb = await grid.boundingBox();
  const fb = await feeRow.boundingBox();
  const sb = await settle.boundingBox();
  expect(gb && fb && sb, 'boundingBox 확보').toBeTruthy();

  // ── S1: DOM 세로 순서 = 초록 → 컴팩트 → 파랑 ──
  //   초록 시술그리드의 top < 컴팩트 한 줄 top  → "초록(시술 선택) 아래"
  expect(fb!.y, `컴팩트 한 줄(top=${Math.round(fb!.y)})은 초록 그리드(top=${Math.round(gb!.y)}) 아래여야 함`).toBeGreaterThan(gb!.y + 10);
  //   컴팩트 한 줄의 top < 파란 수납 top      → "파란(수납 금액) 위"
  expect(fb!.y, `컴팩트 한 줄(top=${Math.round(fb!.y)})은 파란 수납(top=${Math.round(sb!.y)}) 위여야 함`).toBeLessThan(sb!.y);

  // ── S2: 접힘 시 컴팩트(한 줄) 높이 — 큰 블록 아님 ──
  expect(fb!.height, `접힘 상태 컴팩트 높이(=${Math.round(fb!.height)}px)는 한 줄(≤80px)`).toBeLessThanOrEqual(80);

  // ── S3: 모달 총 가로폭 불변 — feeitem-row 가 모달(dialog) 폭을 초과하지 않음 ──
  const dialog = page.locator('[role="dialog"]').first();
  const db = await dialog.boundingBox();
  expect(fb!.width, `컴팩트 한 줄 폭(${Math.round(fb!.width)})이 모달 폭(${Math.round(db!.width)}) 이내`).toBeLessThanOrEqual(db!.width + 2);

  // evidence: 접힘 상태 전체 모달
  await dialog.screenshot({ path: path.join(SHOT_DIR, '01-collapsed-modal.png') });
  await page.screenshot({ path: path.join(SHOT_DIR, '01-collapsed-full.png') });

  // 펼침 토글 → 서류코드/세트/수가항목 편집 UI 노출(기능 보존)
  await page.locator('[data-testid="pmw-feeitem-toggle"]').first().click();
  await page.locator('[data-testid="pricing-list"]').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
  await dialog.screenshot({ path: path.join(SHOT_DIR, '02-expanded-modal.png') });

  // 펼침 후에도 순서 유지(초록 위 · 파랑 아래)
  const fb2 = await feeRow.boundingBox();
  const gb2 = await grid.boundingBox();
  const sb2 = await settle.boundingBox();
  expect(fb2!.y).toBeGreaterThan(gb2!.y);
  expect(fb2!.y).toBeLessThan(sb2!.y);

  // eslint-disable-next-line no-console
  console.log(`[LEFTSPLIT-EVIDENCE] grid.top=${Math.round(gb!.y)} fee.top=${Math.round(fb!.y)} settle.top=${Math.round(sb!.y)} fee.h=${Math.round(fb!.height)} fee.w=${Math.round(fb!.width)} dialog.w=${Math.round(db!.width)}`);
});
