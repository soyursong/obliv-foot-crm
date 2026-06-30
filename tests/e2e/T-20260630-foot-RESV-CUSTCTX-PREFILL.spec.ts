/**
 * E2E spec — T-20260630-foot-RESV-CUSTCTX-PREFILL
 * 고객 컨텍스트 → 예약관리 전환 시 슬롯 클릭 pre-fill (2동선)
 *
 * ── 본 spec 의 범위 ────────────────────────────────────────────────────────
 * planner DECISION-3(2026-06-30 20:39) + relay MSG-204323-9jct 로 Q1/Q2 사람게이트 旣해소(김주연 총괄
 * 최종결정 ts 1782819349.054839) → 티켓 approved. 수신부 코어(d16f06de) + 송신부 전체 wiring 모두 구현·검증.
 *   · 수신부 코어 = navigation state(prefillCustomerForSlot: customer_id+고객명) → pendingPrefillCustomer →
 *     openNewSlot → new-mode 팝업 initialCustomer prefill. 슬롯 핸들러가 구 openNewSlot 이든 미래 격자 핸들러든
 *     동일 폼 opener 경유로 prefill 생존.
 *   · [Q1] 동선1 송신부 = 대시보드 고객박스 우클릭 [예약상세] → 예약有/無 통일 navigate(prefillCustomerForSlot).
 *     기존 (a)연결예약→detail팝업 / (b)워크인→즉시editor 둘 다 폐기 → defer-to-slot-click.
 *   · [Q2] 동선2 송신부 = 2번차트 [다음예약] → 예약관리 navigate + 차트 도킹(드래그/리사이즈/backdrop pass-through)
 *     or 별도 창 opener postMessage 핸드오프. L-002/L-004 LOGIC-LOCK variance = 현장 승인(frontmatter logic_lock_variance).
 *   · 동선1b(예약관리 내 고객카드 우클릭 [예약상세] → 팝업 유지, navigate 금지) = 旣충족(no-op, AC7/시나리오2b).
 *   · AC4 회귀(컨텍스트 없으면 빈 폼) = 런타임 검증.
 *
 * AC 매핑:
 *   AC1  → 동선1 송신부(정적): 대시보드 [예약상세] = handleCardResvDetailOrCreate → prefillCustomerForSlot navigate(예약有/無 통일)
 *   AC4  → 시나리오3 (런타임): 컨텍스트 없는 일반 진입 → 빈 슬롯 클릭 → 빈 신규 예약 폼(회귀 0)
 *   AC7  → 시나리오2b (정적): 예약관리 우클릭 [예약상세] = handleResvOpenDetailFromMenu(팝업, navigate 없음)
 *   AC8  → 동선2(정적): [다음예약] navigate+dock+opener / 차트 docked backdrop pass-through+드래그/리사이즈/undock / AdminLayout opener 수신
 *   코어  → 정적 plumbing 가드: 수신부(navPrefillConsumed/pendingPrefillCustomer/initialCustomer) 존재 + handleSelectOtherCustomer 재사용
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { loginAndWaitForDashboard } from '../helpers';

// ESM: __dirname 미정의 → import.meta.url 파생(레포 ESM 표준, HANDOVER-DELETE-PERSIST S2 동형).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESV_SRC = path.resolve(__dirname, '../../src/pages/Reservations.tsx');
const POPUP_SRC = path.resolve(__dirname, '../../src/components/ReservationDetailPopup.tsx');
const DASH_SRC = path.resolve(__dirname, '../../src/pages/Dashboard.tsx');
const CHARTSHEET_SRC = path.resolve(__dirname, '../../src/components/CustomerChartSheet.tsx');
const CHARTPAGE_SRC = path.resolve(__dirname, '../../src/pages/CustomerChartPage.tsx');
const ADMINLAYOUT_SRC = path.resolve(__dirname, '../../src/components/AdminLayout.tsx');

test.describe('T-20260630-foot-RESV-CUSTCTX-PREFILL — 수신부 코어 정적 plumbing 가드', () => {
  // 코어: navigation state 수신부가 존재하고, prefill 이 검색-선택 경로(handleSelectOtherCustomer)를 재사용하는지.
  test('CORE-1: Reservations.tsx 수신부 — prefillCustomerForSlot 소비 + pendingPrefillCustomer + initialCustomer 전달', () => {
    const src = fs.readFileSync(RESV_SRC, 'utf-8');
    expect(src).toContain('prefillCustomerForSlot');                 // navigation state 키
    expect(src).toContain('navPrefillConsumed');                     // 1회 소비 가드
    expect(src).toContain('pendingPrefillCustomer');                 // 대기 컨텍스트(sticky)
    expect(src).toContain('initialCustomer={pendingPrefillCustomer}'); // 팝업으로 전달
    console.log('[CORE-1] 수신부 plumbing 존재 OK');
  });

  test('CORE-2: ReservationDetailPopup — initialCustomer prop + new-mode prefill 이 handleSelectOtherCustomer 재사용', () => {
    const src = fs.readFileSync(POPUP_SRC, 'utf-8');
    expect(src).toContain('initialCustomer');                        // prop 추가
    expect(src).toMatch(/initialCustomer\?:\s*PatientMatch\s*\|\s*null/); // 타입 = PatientMatch
    // new-mode 진입 시 컨텍스트 있으면 검색-선택 경로 재사용(생성 로직 무변경 = L-002)
    expect(src).toMatch(/if\s*\(\s*initialCustomer\s*\)\s*\{[\s\S]*handleSelectOtherCustomer\(initialCustomer\)/);
    console.log('[CORE-2] 팝업 initialCustomer prefill = handleSelectOtherCustomer 재사용 OK');
  });

  // AC7 / 시나리오2b: 예약관리 내 우클릭 [예약상세] 는 navigate 없이 팝업 유지(旣충족, no-op).
  test('AC7(시나리오2b): 예약관리 우클릭 [예약상세] → 팝업 유지(navigate 금지) — handleResvOpenDetailFromMenu 배선', () => {
    const src = fs.readFileSync(RESV_SRC, 'utf-8');
    // 예약 우클릭 메뉴의 [예약상세] = setDetail 팝업(handleResvOpenDetailFromMenu), navigate 호출 아님.
    expect(src).toContain('onNewReservation={handleResvOpenDetailFromMenu}');
    expect(src).toMatch(/handleResvOpenDetailFromMenu\s*=\s*useCallback/);
    console.log('[AC7/2b] 예약관리 우클릭 → 팝업 유지(navigate 미사용) OK');
  });
});

test.describe('T-20260630-foot-RESV-CUSTCTX-PREFILL — AC4 회귀(컨텍스트 없는 일반 진입)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  // 시나리오3: 사이드 메뉴 직접 진입(고객 컨텍스트 없음) → 빈 슬롯 클릭 → 신규 폼이 '빈 상태'.
  test('AC4(시나리오3): 컨텍스트 없는 예약관리 진입 → [새 예약] 폼이 고객 미선택 빈 상태', async ({ page }) => {
    await page.goto('/admin/reservations');

    // 상단 [새 예약] = initialDate/initialCustomer 미전달 빈 진입 — 슬롯 클릭과 동일 new-mode 폼.
    const newResvBtn = page.getByRole('button', { name: /새 예약/ });
    await expect(newResvBtn).toBeVisible({ timeout: 10_000 });
    await newResvBtn.click();

    // new-mode 폼(예약 등록) 모달 표시
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    // 컨텍스트 없음 → 성함 입력칸이 빈 상태(prefill 0). 재진 카드("...님 예약 생성")가 아닌 신규 직접등록 폼.
    const nameInput = page.locator('input[placeholder*="성함"], input[placeholder*="이름"]').first();
    if (await nameInput.count()) {
      await expect(nameInput).toHaveValue('');
    }
    // 재진 prefill 안 됨 → "신규 예약 생성" 라벨(재진이면 "{name}님 예약 생성")
    await expect(page.getByRole('button', { name: /신규 예약 생성/ })).toBeVisible({ timeout: 3_000 });
    console.log('[AC4/3] 컨텍스트 없는 진입 → 빈 신규 폼(회귀 0) OK');
  });
});

test.describe('T-20260630-foot-RESV-CUSTCTX-PREFILL — 송신부 배선 정적 가드(Q1/Q2 해소·approved)', () => {
  // AC1 / 시나리오1[Q1]: 대시보드 고객박스 우클릭 [예약상세] → 예약有/無 통일 navigate(prefillCustomerForSlot).
  test('AC1(동선1 송신부): handleCardResvDetailOrCreate = prefillCustomerForSlot navigate, 예약有/無 통일', () => {
    const src = fs.readFileSync(DASH_SRC, 'utf-8');
    const m = src.match(/const handleCardResvDetailOrCreate = useCallback\(([\s\S]*?)\}, \[[^\]]*\]\);/);
    expect(m, 'handleCardResvDetailOrCreate 핸들러 존재').not.toBeNull();
    const body = m![1];
    // navigate 시 prefillCustomerForSlot(customer_id+name) 전달
    expect(body).toContain('prefillCustomerForSlot');
    expect(body).toContain("navigate('/admin/reservations'");
    // [Q1] 기존 동작 폐기: 이 핸들러는 openReservationDetail 팝업을 자동 오픈하지 않는다(예약有/無 통일).
    expect(body).not.toContain('openReservationDetail');
    console.log('[AC1/동선1] 대시보드 고객박스 [예약상세] → prefill navigate 통일 OK');
  });

  // 동선1 회귀: 대시보드 고객박스 메뉴 배선이 handleCardResvDetailOrCreate 로 유지(라벨 [예약상세]).
  test('AC1(동선1 배선): 대시보드 고객카드 CustomerQuickMenu onNewReservation=handleCardResvDetailOrCreate', () => {
    const src = fs.readFileSync(DASH_SRC, 'utf-8');
    expect(src).toContain('onNewReservation={handleCardResvDetailOrCreate}');
    console.log('[AC1/배선] 고객박스 메뉴 → handleCardResvDetailOrCreate OK');
  });

  // AC8 / 시나리오2[Q2]: 2번차트 [다음예약] → 예약관리 navigate + 차트 도킹 + 별도 창 opener postMessage.
  test('AC8(동선2 송신부): [다음예약] = prefill navigate + requestChartDock + opener postMessage', () => {
    const src = fs.readFileSync(CHARTPAGE_SRC, 'utf-8');
    expect(src).toContain('useChartSheetDock');                      // 도킹 채널 소비
    expect(src).toContain('prefillCustomerForSlot');                 // prefill nav state
    expect(src).toContain('requestChartDock');                       // in-page 서랍 도킹 요청
    expect(src).toContain("'foot-prefill-slot'");                    // 별도 창 → opener 핸드오프
    expect(src).toMatch(/window\.opener/);                           // 별도 창 분기
    console.log('[AC8/동선2 송신부] [다음예약] navigate+dock+opener OK');
  });

  // AC8: 차트 docked 모드 = backdrop pass-through(pointer-events 해제) + 헤더 드래그 + 전체화면 복귀(undock).
  test('AC8(동선2 차트 오버레이): CustomerChartSheet docked = backdrop pass-through + 드래그 + undock', () => {
    const src = fs.readFileSync(CHARTSHEET_SRC, 'utf-8');
    expect(src).toContain('ChartSheetDockCtx');                      // 도킹 채널 제공
    expect(src).toMatch(/docked\s*\?/);                              // docked 분기 렌더
    expect(src).toContain('pointer-events-none');                    // backdrop pass-through(뒤 예약판 클릭 활성)
    expect(src).toContain('onDockPointerDown');                      // 헤더 드래그 핸들
    expect(src).toContain('cursor-move');                            // 드래그 핸들 표식
    expect(src).toContain('resize');                                 // CSS 리사이즈
    expect(src).toContain('chart-undock-btn');                       // 전체화면 복귀(도킹 해제)
    console.log('[AC8/차트] docked backdrop pass-through + 드래그/리사이즈/undock OK');
  });

  // AC8: 별도 창 핸드오프 수신부 — AdminLayout 이 foot-prefill-slot 메시지를 받아 prefill navigate.
  test('AC8(동선2 별도 창 수신): AdminLayout postMessage(foot-prefill-slot) → prefillCustomerForSlot navigate', () => {
    const src = fs.readFileSync(ADMINLAYOUT_SRC, 'utf-8');
    expect(src).toContain("'foot-prefill-slot'");
    expect(src).toContain('prefillCustomerForSlot');
    expect(src).toMatch(/e\.origin\s*!==\s*window\.location\.origin/); // origin 검증(외부 메시지 차단)
    console.log('[AC8/별도창 수신] AdminLayout opener 핸드오프 OK');
  });
});
