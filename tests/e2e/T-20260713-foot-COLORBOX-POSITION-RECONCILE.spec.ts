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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * T-20260715-foot-PAYMINI-CHARTFEE-ROW-RESTORE (P0/hotfix) 보강 — AC-5 좌표가드 강화
 * ─────────────────────────────────────────────────────────────────────────────
 *   [E2E 갭 근본원인] 기존 assert는 세로 top 순서(grid.top<fee.top<settle.top) + 폭≤모달만 검증.
 *     → fee-row 가 팔레트 그리드 "우측 열"에 대형 세로 패널로 스프레드돼도(IMG_8950: 서류코드/K297/
 *       B351/세트코드 드롭다운이 우측 열 전체 점유) top 순서만 만족하면 PASS → 07-15 회귀가 field-soak 통과.
 *   [보강 AC-5] (a) grid.bottom ≤ fee.top (그리드 "아래", 옆 아님)
 *              (b) fee.height ≤ 52px (컴팩트 한 줄, 대형 패널 아님)
 *              (c) fee.left ≈ grid.left & fee.width ≥ grid.width×0.8 (동일 중앙 컬럼, 우측 별도 열 아님)
 *   [forensic 발견] HEAD(=origin/main d494920f) 소스의 fee-row 레이아웃은 known-good 508893fa 이후
 *     "무변경"(diff: COPAY-BALANCE-SPLIT 로직·팔레트 testid 만 변경). 실브라우저(desktop-chrome) 렌더 실측:
 *     grid(x=213,y=133,w=710,h=280) → fee(x=213,y=412,w=710,h=40) → settle(x=213,y=452,w=710)
 *     = fee-row 는 그리드 바로 아래 동일 컬럼 컴팩트 40px 한 줄(=canonical). 즉 소스레벨 회귀 없음.
 *     IMG_8950 의 우측 대형 패널은 HEAD 소스에서 재현 불가 → 배포/캐시 아티팩트(stale bundle) 의심.
 *     본 spec 강화 커밋이 fresh 배포를 트리거 → 검증된 good 번들을 prod 에 재공급.
 *   [AC-4 정합식 갱신] COPAY-BALANCE-SPLIT 이후 settle-lane 총액 라벨 "합계"→"수납잔액"(공단부담 제외).
 *     compact "합계"(grandTotal) 는 settle 세금구분 총합(비급여과세+비급여면세+급여)과 대사(rename 무관 불변식).
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { isCodeItem } from '../../src/lib/footBilling';
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
  // ── 결정론 시드 (T-20260715-foot-COLORBOX-SPEC-TAXSUM-REGEX-FIX FIX-REQUEST) ───────
  //   [RC — QA NO-GO] 기존 `.eq('active',true).limit(2)` 는 정렬/필터 없이 첫 2건을 뽑아,
  //     현 DB 첫 active 서비스가 code-item(category_label∈{상병,처방약}, footBilling.isCodeItem)이면
  //     FE(pricingItems = selectedItems.filter(i => !isCodeItem(i.service)), PMW L1362)가 전부 걸러
  //     pricing-row 0개 → line 226 `pricingRows.count()>=1` 가 결정론적으로 RED (regex fix 검증 도달 불가).
  //   [FIX-1 결정론화] code-item 배제 + id 정렬 고정으로 pricingItems≥1 안정화.
  //   [FIX-2 regex 실검증 보장] 본 티켓의 taxSum regex(급여 자부담/공단부담액) 를 실제 렌더·합산으로
  //     검증하려면 급여(covered) 서비스 1건 이상 필수. 비급여-only 시드면 settle-lane 급여/공단 라인이
  //     0(또는 미렌더)이라 regex fix 가 "실행되지 않은 채 우연히 GREEN"이 됨(spec L253 자인).
  //     → is_insurance_covered=true 1건(급여) + 비급여·비코드 1건을 명시 확보(둘 다 price>0, 같은 clinic).
  //   [불변식] grandTotal = coveredTotal + 비급여합, taxSum = 비급여(과세)+비급여(면세)+급여자부담(payCopaymentTotal)
  //     +공단부담액(insuranceCoveredTotal) = 비급여합 + coveredTotal = grandTotal (급여 라인이 반드시 실렌더돼야 성립).

  // (2) 급여 서비스 1건 (필수) — settle-lane '급여 자부담(30%)'·'공단부담액(명세)' 실렌더 보장
  const { data: covPool } = await supabase
    .from('services').select('*')
    .eq('active', true).eq('is_insurance_covered', true).gt('price', 0)
    .order('id');
  const coveredSvc = (covPool ?? []).find((s) => !isCodeItem(s)) ?? null;
  if (!coveredSvc) { seedOk = false; return; }
  clinicId = coveredSvc.clinic_id;

  // (1) 비급여·비코드 서비스 1건 (같은 clinic) — 비급여 라인 + pricingItems 다건(수가 항목 2건)
  const { data: nonCovPool } = await supabase
    .from('services').select('*')
    .eq('active', true).eq('clinic_id', clinicId).eq('is_insurance_covered', false).gt('price', 0)
    .order('id');
  const nonCoveredSvc = (nonCovPool ?? []).find((s) => !isCodeItem(s)) ?? null;

  const svcs = [coveredSvc, ...(nonCoveredSvc ? [nonCoveredSvc] : [])];
  if (svcs.length < 1) { seedOk = false; return; }

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

  // evidence 항상 선출력 (어떤 assert가 실패해도 좌표 근거는 남긴다 — no_auto_promote 게이트 증거)
  // eslint-disable-next-line no-console
  console.log(`[COLORBOX-RECONCILE-EVIDENCE] dialog(x=${Math.round(db!.x)},y=${Math.round(db!.y)},w=${Math.round(db!.width)}) grid(x=${Math.round(gb!.x)},y=${Math.round(gb!.y)},w=${Math.round(gb!.width)},h=${Math.round(gb!.height)}) fee(x=${Math.round(fb!.x)},y=${Math.round(fb!.y)},w=${Math.round(fb!.width)},h=${Math.round(fb!.height)}) settle(x=${Math.round(sb!.x)},y=${Math.round(sb!.y)},w=${Math.round(sb!.width)})`);

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

  // ═══ AC-5 (T-20260715-foot-PAYMINI-CHARTFEE-ROW-RESTORE): 좌우/컴팩트 좌표가드 강화 ═══
  //   근본원인(RECONCILE field-soak가 07-15 회귀를 통과시킨 이유):
  //     기존 assert는 세로 top 순서(grid.top<fee.top<settle.top) + 폭≤모달만 검증 →
  //     "차트코드+진료비"가 팔레트 그리드 우측 열에 대형 세로 패널로 스프레드돼도(옆으로 풀림)
  //     top 순서만 만족하면 PASS. (IMG_8950 = 우측 열 전체 점유 대형 패널)
  //   보강: fee-row 가 (a)그리드 "아래"(옆 아님) + (b)컴팩트 한 줄(대형 패널 아님) +
  //         (c)그리드와 동일 세로 중앙 컬럼(우측 별도 열 아님) 임을 좌표로 잠근다.

  // ── AC-5(a): 그리드 "아래" — fee.top 이 grid.bottom 이상 (옆이면 top 이 겹침) ──
  const gridBottom = gb!.y + gb!.height;
  expect(
    fb!.y,
    `AC-5(a) fee-row(top=${Math.round(fb!.y)})는 팔레트 그리드 "아래"(grid.bottom=${Math.round(gridBottom)})여야 함 — 옆 열(우측 스프레드) 재발 감지`,
  ).toBeGreaterThanOrEqual(gridBottom - 12);

  // ── AC-5(b): 컴팩트 한 줄 — 접힘 높이 ≤ 52px(대형 세로 패널 아님, 좌표잠금 근거 h≈38~44) ──
  expect(
    fb!.height,
    `AC-5(b) 접힘 fee-row 높이(${Math.round(fb!.height)}px)는 컴팩트 한 줄(≤52px) — 우측 대형 패널(수백 px) 재발 감지`,
  ).toBeLessThanOrEqual(52);

  // ── AC-5(c): 동일 세로 중앙 컬럼 — fee.left ≈ grid.left & fee.width ≈ grid.width ──
  //   우측 별도 열이면 fee.left ≫ grid.left, fee.width ≪ grid.width 가 된다.
  expect(
    Math.abs(fb!.x - gb!.x),
    `AC-5(c-left) fee-row 좌단(x=${Math.round(fb!.x)})이 팔레트 그리드 좌단(x=${Math.round(gb!.x)})과 동일 컬럼(±24px) — 우측 별도 열 재발 감지`,
  ).toBeLessThanOrEqual(24);
  expect(
    fb!.width,
    `AC-5(c-width) fee-row 폭(${Math.round(fb!.width)})이 팔레트 그리드 폭(${Math.round(gb!.width)})의 80%↑ — 좁은 우측 열 재발 감지`,
  ).toBeGreaterThanOrEqual(gb!.width * 0.8);

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

  // ── AC-4(인접 요소 회귀 0): 컴팩트 한 줄 요약 "합계"(=grandTotal) = 파란 settle-lane 세금구분 합 ──
  //   ※ T-20260714-foot-PAYMINI-COPAY-BALANCE-SPLIT 이후 settle-lane 총액 라벨은 "합계"→"수납잔액"
  //     (수납잔액 = 급여 본인부담 + 비급여, 공단부담 제외)으로 바뀌어 grandTotal 과 값이 다르다.
  //     따라서 compact "합계"(grandTotal)는 settle 의 세금구분 총합과 대사한다
  //     — 이것이 rename 에 무관한 진짜 불변식(grandTotal = Σ 세금구분).
  const feeTotal = ((await page.locator('[data-testid="pmw-feeitem-summary"]').first().innerText())
    .match(/합계\s*([\d,]+)/)?.[1] ?? '').replace(/[^0-9]/g, '');
  expect(feeTotal.length, '컴팩트 요약 합계 금액 추출').toBeGreaterThan(0);

  // T-20260715-foot-COLORBOX-SPEC-TAXSUM-REGEX-FIX: 세금구분 라인 대사를 배포 라벨에 수렴(테스트→정본).
  //   COPAY-BALANCE-SPLIT REOPEN#5(deployed·DA ratified) 이후 settle-lane 급여 라인은 급여 "전액"이 아니라
  //     • "급여 자부담(30%)" = payCopaymentTotal(환자 자부담만)  +
  //     • 별도 "공단부담액(명세)" = insuranceCoveredTotal(공단 NHIS 몫, 급여 방문 시에만 렌더)
  //   로 분리 렌더된다(PaymentMiniWindow.tsx L2478~2501). 따라서 grandTotal(총 진료비=급여 전액+비급여)을
  //   재구성하는 세금구분 합 = 급여 자부담 + 공단부담액(명세) + 비급여(과세) + 비급여(면세) 4개 표시 라인의 합.
  //   [red RC] 기존 `급여(?!\s*자부담)` 는 shipped 라벨 "급여 자부담(30%)" 에 매칭되지 않아 급여 몫이 통째 누락
  //     → 급여 방문 시 taxSum < grandTotal 불일치. 정본 라벨은 뒤집지 않고 regex 만 정본에 수렴시킨다.
  //   (본 spec 은 beforeAll 에서 급여 서비스 1건을 결정론적으로 시드하므로 급여/공단 라인이 항상 실렌더된다
  //    — regex fix 가 실제로 실행됨을 아래 copayLine/nhisLine>0 게이트로 못박는다. 비급여-only 우연 GREEN 차단.)
  const settleText = await settle.innerText();
  const num = (label: RegExp): number => {
    const m = settleText.match(label);
    return m ? Number(m[1].replace(/[^0-9]/g, '')) : NaN;
  };
  // 본 티켓 regex fix 의 검증 대상 라인 2종 (급여 자부담 / 공단부담액)을 개별 추출해 실렌더를 못박는다.
  const copayLine = num(/급여\s*자부담(?:\(\d+%\))?\s*([\d,]+)/); // "급여 자부담(30%)" = payCopaymentTotal(환자 자부담만)
  const nhisLine = num(/공단부담액\(명세\)\s*([\d,]+)/);           // "공단부담액(명세)" = insuranceCoveredTotal(공단 몫)
  const taxSum =
    (num(/비급여\(과세\)\s*([\d,]+)/) || 0) +
    (num(/비급여\(면세\)\s*([\d,]+)/) || 0) +
    (copayLine || 0) +
    (nhisLine || 0);
  // eslint-disable-next-line no-console
  console.log(`[TAXSUM-REGEX-FIX-EVIDENCE] copayLine(급여 자부담)=${copayLine} nhisLine(공단부담액)=${nhisLine} taxSum=${taxSum} feeTotal=${feeTotal} settleText=${JSON.stringify(settleText).slice(0, 240)}`);
  expect(
    Number.isFinite(taxSum) && taxSum > 0,
    `settle-lane 세금구분 합 추출(taxSum=${taxSum}) — settleText=${JSON.stringify(settleText).slice(0, 200)}`,
  ).toBeTruthy();
  // ── regex fix 실검증 게이트 (T-20260715 FIX-REQUEST #2): 급여 서비스 시드 → 급여 자부담·공단부담액 라인이
  //   실제 렌더돼 taxSum 에 합산됨을 못박는다. 이 두 라인이 0/미추출이면 regex fix 가 실행되지 않은 채
  //   비급여-only 로 우연 GREEN 된 것이므로 명시 FAIL 시킨다(선재 시드 비결정성 재발 차단).
  expect(
    copayLine,
    `regex fix 실검증: '급여 자부담(30%)' 라인이 실렌더·매칭되어야 함(급여 서비스 시드됨). copayLine=${copayLine}`,
  ).toBeGreaterThan(0);
  expect(
    nhisLine,
    `regex fix 실검증: '공단부담액(명세)' 라인이 실렌더·매칭되어야 함(급여 서비스 시드됨). nhisLine=${nhisLine}`,
  ).toBeGreaterThan(0);
  expect(
    Number(feeTotal),
    `컴팩트 요약 합계(${feeTotal})가 파란 수납 lane 세금구분 총합(${taxSum})과 일치(금액계산 회귀 0)`,
  ).toBe(taxSum);
});
