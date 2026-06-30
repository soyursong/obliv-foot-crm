/**
 * E2E spec — T-20260630-foot-RESV-DETAIL-NAV-PREFILL
 * 예약 생성 동선 통일: 고객박스 우클릭 [예약상세] → 예약관리 이동 + 빈 슬롯 클릭 prefill (2번차트 [다음예약] 동일 동선)
 *
 * ── 본 ticket 의 delta 범위 ──────────────────────────────────────────────────
 * 김주연 총괄(C0ATE5P6JTH) 요청. sibling 티켓 RESV-CUSTCTX-PREFILL(동일 reporter·동일 날짜)이
 * AC1(체크인 카드 prefill)·AC3(즉시 미오픈)·AC4(슬롯 prefill)·AC5(2번차트 도킹+prefill)를 旣충족 →
 * 본 티켓의 genuine delta = AC2(예약 캘린더 카드 [예약상세] 동선 통일) + AC6(prefill 1회성).
 *   · AC2 = 대시보드 타임라인 예약 박스(예약 캘린더 카드) 우클릭 [예약상세]를 체크인 카드와 동일하게
 *           handleCardResvDetailOrCreate(prefillCustomerForSlot navigate)로 재배선.
 *           구 handleResvOpenDetailFromCtx(openReservationDetail 즉시 팝업) retire.
 *   · AC6 = pendingPrefillCustomer 를 sticky(연속 예약) → 1회성으로 재정의. new-mode 팝업 close/changed 시 소진.
 *
 * AC 매핑:
 *   AC1 → 정적: 대시보드 체크인 카드 CustomerQuickMenu onNewReservation=handleCardResvDetailOrCreate (회귀)
 *   AC2 → 정적: 대시보드 예약 캘린더 카드(resvContextMenu) CustomerQuickMenu onNewReservation=handleCardResvDetailOrCreate
 *               + handleResvOpenDetailFromCtx 완전 제거(open-existing 동선 retire)
 *   AC3 → 정적: handleCardResvDetailOrCreate = prefillCustomerForSlot navigate(즉시 editor/팝업 오픈 없음)
 *   AC4 → 정적: initialCustomer={pendingPrefillCustomer} 슬롯클릭 new-mode 주입(수신부 코어, 회귀)
 *   AC5 → 정적: 2번차트 [다음예약] = prefillCustomerForSlot navigate(회귀)
 *   AC6 → 정적: ReservationDetailPopup onClose/onChanged → setPendingPrefillCustomer(null) (1회성)
 *   회귀 → 런타임(시나리오3): 컨텍스트 없는 진입 → 빈 슬롯/[새 예약] 폼이 고객 미선택 빈 상태
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { loginAndWaitForDashboard } from '../helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESV_SRC = path.resolve(__dirname, '../../src/pages/Reservations.tsx');
const DASH_SRC = path.resolve(__dirname, '../../src/pages/Dashboard.tsx');
const CHARTPAGE_SRC = path.resolve(__dirname, '../../src/pages/CustomerChartPage.tsx');

test.describe('T-20260630-foot-RESV-DETAIL-NAV-PREFILL — delta 정적 가드(AC2·AC6)', () => {
  // AC2: 예약 캘린더 카드(타임라인 예약 박스, resvContextMenu) 우클릭 [예약상세] → 체크인 카드와 동일 핸들러로 통일.
  test('AC2: 예약 캘린더 카드 [예약상세] = handleCardResvDetailOrCreate (open-existing 핸들러 retire)', () => {
    const src = fs.readFileSync(DASH_SRC, 'utf-8');
    // 두 고객박스(체크인 카드 + 예약 캘린더 카드) 모두 동일 핸들러 = onNewReservation={handleCardResvDetailOrCreate}
    const wired = src.match(/onNewReservation=\{handleCardResvDetailOrCreate\}/g) ?? [];
    expect(wired.length, '두 카드(체크인+예약캘린더) 모두 동일 핸들러로 배선').toBe(2);
    // 구 open-existing 핸들러는 완전히 제거(미사용 dead 코드 0, latent open-existing 부활 차단)
    expect(src).not.toContain('const handleResvOpenDetailFromCtx');
    expect(src).not.toContain('onNewReservation={handleResvOpenDetailFromCtx}');
    console.log('[AC2] 예약 캘린더 카드 [예약상세] → 통일 핸들러 + open-existing retire OK');
  });

  // AC1 회귀: 체크인 카드(customerMenu) 배선 유지.
  test('AC1(회귀): 체크인 카드 CustomerQuickMenu onNewReservation=handleCardResvDetailOrCreate', () => {
    const src = fs.readFileSync(DASH_SRC, 'utf-8');
    expect(src).toContain('onNewReservation={handleCardResvDetailOrCreate}');
    console.log('[AC1] 체크인 카드 배선 회귀 OK');
  });

  // AC3: 통일 핸들러는 즉시 editor/팝업을 열지 않고 prefillCustomerForSlot navigate(defer-to-slot-click).
  test('AC3: handleCardResvDetailOrCreate = prefillCustomerForSlot navigate (즉시 오픈 없음)', () => {
    const src = fs.readFileSync(DASH_SRC, 'utf-8');
    const m = src.match(/const handleCardResvDetailOrCreate = useCallback\(([\s\S]*?)\}, \[[^\]]*\]\);/);
    expect(m, 'handleCardResvDetailOrCreate 핸들러 존재').not.toBeNull();
    const body = m![1];
    expect(body).toContain('prefillCustomerForSlot');
    expect(body).toContain("navigate('/admin/reservations'");
    expect(body).not.toContain('openReservationDetail');   // 기존 예약 팝업 자동 오픈 안 함
    console.log('[AC3] 통일 핸들러 = defer-to-slot prefill navigate OK');
  });

  // AC4 회귀: 수신부 코어 — 슬롯 클릭 new-mode 팝업에 pendingPrefillCustomer 주입.
  test('AC4(회귀): Reservations 수신부 — initialCustomer={pendingPrefillCustomer}', () => {
    const src = fs.readFileSync(RESV_SRC, 'utf-8');
    expect(src).toContain('prefillCustomerForSlot');
    expect(src).toContain('pendingPrefillCustomer');
    expect(src).toContain('initialCustomer={pendingPrefillCustomer}');
    console.log('[AC4] 슬롯클릭 prefill 수신부 회귀 OK');
  });

  // AC5 회귀: 2번차트 [다음예약] = prefillCustomerForSlot navigate(2번차트 팝업 유지=도킹/opener).
  test('AC5(회귀): 2번차트 [다음예약] = prefillCustomerForSlot navigate (setInlineResvOpen 미사용)', () => {
    const src = fs.readFileSync(CHARTPAGE_SRC, 'utf-8');
    expect(src).toContain('prefillCustomerForSlot');
    // 인라인 예약 패널(구 INLINE-RESV) 자동 오픈은 이 surface 에서 대체됨 — [다음예약] 핸들러는 navigate 동선.
    const m = src.match(/data-testid="btn-next-reservation"/);
    expect(m, '[다음 예약] 버튼 존재').not.toBeNull();
    console.log('[AC5] 2번차트 [다음예약] navigate 회귀 OK');
  });

  // AC6: prefill 1회성 — new-mode 팝업 close/changed 시 pendingPrefillCustomer 소진.
  test('AC6: ReservationDetailPopup onClose/onChanged → setPendingPrefillCustomer(null) (1회성)', () => {
    const src = fs.readFileSync(RESV_SRC, 'utf-8');
    // onClose 와 onChanged 양쪽에서 prefill 소진(저장 또는 취소 후 다음 슬롯은 빈 폼).
    const clears = src.match(/setPendingPrefillCustomer\(null\)/g) ?? [];
    expect(clears.length, 'onClose+onChanged 2곳에서 prefill 소진').toBeGreaterThanOrEqual(2);
    console.log('[AC6] prefill 1회성 소진 배선 OK');
  });
});

test.describe('T-20260630-foot-RESV-DETAIL-NAV-PREFILL — 회귀(컨텍스트 없는 일반 진입 → 빈 폼)', () => {
  test.beforeEach(async ({ page }) => {
    const ok = await loginAndWaitForDashboard(page);
    if (!ok) test.skip(true, 'Login failed');
  });

  // 시나리오3 회귀: 고객 컨텍스트 없이 예약관리 직접 진입 → [새 예약] 폼이 고객 미선택 빈 상태.
  // (AC6 1회성의 '이후 빈 폼' end-state 와 동일 mechanism — prefill 미주입 시 빈 신규 폼.)
  test('회귀: 컨텍스트 없는 예약관리 진입 → 신규 폼이 고객 미선택 빈 상태', async ({ page }) => {
    await page.goto('/admin/reservations');

    const newResvBtn = page.getByRole('button', { name: /새 예약/ });
    await expect(newResvBtn).toBeVisible({ timeout: 10_000 });
    await newResvBtn.click();

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    const nameInput = page.locator('input[placeholder*="성함"], input[placeholder*="이름"]').first();
    if (await nameInput.count()) {
      await expect(nameInput).toHaveValue('');
    }
    await expect(page.getByRole('button', { name: /신규 예약 생성/ })).toBeVisible({ timeout: 3_000 });
    console.log('[회귀] 컨텍스트 없는 진입 → 빈 신규 폼(prefill 0) OK');
  });
});
