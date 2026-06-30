/**
 * E2E spec — T-20260630-foot-RESV-CUSTCTX-PREFILL
 * 고객 컨텍스트 → 예약관리 전환 시 슬롯 클릭 pre-fill (2동선)
 *
 * ── 본 spec 의 범위(현재 단계) ──────────────────────────────────────────────
 * planner DECISION-2(2026-06-30 20:33, (B) GO)로 **risk-free 수신부 코어**만 먼저 구현·검증한다.
 *   · 수신부 코어 = navigation state(prefillCustomerForSlot: customer_id+고객명) → pendingPrefillCustomer →
 *     openNewSlot → new-mode 팝업 initialCustomer prefill. 슬롯 핸들러가 구 openNewSlot 이든 미래 격자 핸들러든
 *     동일 폼 opener 경유로 prefill 생존.
 *   · 동선1b(예약관리 내 고객카드 우클릭 [예약상세] → 팝업 유지, navigate 금지) = 旣충족(no-op, AC7/시나리오2b).
 *   · AC4 회귀(컨텍스트 없으면 빈 폼) = 런타임 검증.
 *
 * ── 사람 게이트(human_pending) 대기 중 — 본 spec 에서 fixme ─────────────────
 *   · 시나리오1(동선1 송신부: 대시보드 고객박스 우클릭 [예약상세]→navigate+prefill) = Q1(진입점 semantics) 확정 후 wiring.
 *   · 시나리오2(동선2: 2번차트 [다음예약]→예약관리 navigate+차트팝업 유지+prefill) = Q2(L-004 차트 오버레이/L-002) 확정 후 wiring.
 *   → 송신부 미배선 상태라 UI end-to-end prefill 은 fixme. 수신부 코어는 (a)정적 plumbing 가드 + (b)AC4 런타임으로 보호.
 *
 * AC 매핑:
 *   AC4  → 시나리오3 (런타임): 컨텍스트 없는 일반 진입 → 빈 슬롯 클릭 → 빈 신규 예약 폼(회귀 0)
 *   AC7  → 시나리오2b (정적): 예약관리 우클릭 [예약상세] = handleResvOpenDetailFromMenu(팝업, navigate 없음)
 *   코어  → 정적 plumbing 가드: 수신부(navPrefillConsumed/pendingPrefillCustomer/initialCustomer) 존재 + handleSelectOtherCustomer 재사용
 *   AC1/2/3/5/6 → 송신부 배선(Q1/Q2) 후 fixme 해제
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

test.describe('T-20260630-foot-RESV-CUSTCTX-PREFILL — 송신부 배선 후 완결(human_pending Q1/Q2)', () => {
  // Q1 확정 후 wiring: 대시보드 고객박스 우클릭 [예약상세] → /admin/reservations navigate(prefillCustomerForSlot) → 슬롯 클릭 prefill.
  test.fixme('AC1(시나리오1): 대시보드 고객박스 우클릭 [예약상세] → 슬롯 클릭 시 해당 고객 pre-fill', async () => {
    // 송신부(대시보드 진입점) 배선 = Q1(진입점 semantics: 연결예약 compose / 워크인 defer) 현장 confirm 후.
  });

  // Q2 확정 후 wiring: 2번차트 [다음예약] → 예약관리 navigate + 차트팝업 유지 + 슬롯 prefill.
  test.fixme('AC2/AC3(시나리오2): 2번차트 [다음예약] → 차트팝업 유지 + 배경 예약관리 전환 + 슬롯 prefill', async () => {
    // 송신부(차트 오버레이) 배선 = Q2(L-004 차트 접근경로 lock / L-002 full-page 전환) 현장 결정 후.
  });
});
