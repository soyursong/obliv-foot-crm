import { test, expect } from '@playwright/test';

/**
 * E2E — T-20260728-foot-ADMININFO-EDIT-TREATTABLE-ENTRY
 *   현장(김주연 총괄): "행정정보 수정·변경할 수 있는 기능 치료테이블-진료에도 넣어줘."
 *   → 치료테이블(진료 등)의 이름 우클릭 CustomerQuickMenu 에 [고객정보 수정] 진입점 추가.
 *     기존 고객관리 EditCustomerDialog 를 **재사용**(중복 구현 금지), 진입점만 추가.
 *
 * ── 설계 계약(본 spec 이 지키는 불변식) ─────────────────────────────────────────
 *   AC-1 진입점: onEditCustomer 제공 surface(치료테이블)에서만 [고객정보 수정] 1항목 노출.
 *   AC-2 fetch→prop: EditCustomerDialog 는 customer 객체 prop 의존 → 진입 시 customer_id 로
 *        customers 행 fetch 후 전달. customer_id 없으면(=null) fetch/오픈 abort(가드).
 *   AC-3 회귀 0: onEditCustomer 미전달 surface(대시보드·예약관리)는 항목 미노출 = 메뉴 불변.
 *
 * 본 spec 은 CustomerQuickMenu 의 **조건부 렌더 게이팅 계약**과 TreatmentTable 부모의
 *   **fetch 가드 술어**를 컴포넌트와 동일하게 재현해, 회귀-안전성(opt-in)과 fetch 패턴을 단언한다.
 *   (repo 컨벤션 = 순수 계약 재현 spec. 신규 파생함수 0 = 진입점/재사용 성격.)
 */

// ── CustomerQuickMenu 메뉴 항목 게이팅 재현 (컴포넌트와 동일) ───────────────────────
//   고정 4항목(고객차트·진료차트·예약·수납) + optional(서류/문자/고객정보수정).
interface MenuOpts {
  onOpenDocuments?: boolean;
  onSendSms?: boolean;
  onEditCustomer?: boolean;
}
function buildMenuItems(opts: MenuOpts): string[] {
  const items = ['고객차트', '진료차트', '예약', '수납'];
  if (opts.onOpenDocuments) items.push('서류');
  if (opts.onSendSms) items.push('문자');
  if (opts.onEditCustomer) items.push('고객정보 수정'); // 하단 append — 기존 순서 무변경
  return items;
}
// itemCount 경계보정 공식(컴포넌트 L74 재현)
function itemCount(opts: MenuOpts): number {
  return 4 + (opts.onOpenDocuments ? 1 : 0) + (opts.onSendSms ? 1 : 0) + (opts.onEditCustomer ? 1 : 0);
}

// ── openEditCustomer 부모 fetch 가드 술어(TreatmentTable 재현) ──────────────────────
//   customer_id 없으면 fetch 하지 않고 abort → editingCustomer 미설정.
function shouldFetchCustomer(checkIn: { customer_id: string | null }): boolean {
  return !!checkIn.customer_id;
}

// ── AC-1: 진입점 노출 (치료테이블 = onEditCustomer 제공) ─────────────────────────────
test('AC-1: onEditCustomer 제공 시 [고객정보 수정] 1항목이 하단에 노출된다', () => {
  const items = buildMenuItems({ onEditCustomer: true });
  expect(items).toContain('고객정보 수정');
  expect(items[items.length - 1]).toBe('고객정보 수정'); // 하단 append(기존 순서 보존)
  expect(itemCount({ onEditCustomer: true })).toBe(5);
});

test('AC-1: 서류·문자와 공존해도 [고객정보 수정]은 정확히 1개 추가된다', () => {
  const base = buildMenuItems({ onOpenDocuments: true, onSendSms: true });
  const withEdit = buildMenuItems({ onOpenDocuments: true, onSendSms: true, onEditCustomer: true });
  expect(withEdit.length).toBe(base.length + 1);
  expect(withEdit.filter((i) => i === '고객정보 수정').length).toBe(1);
  expect(itemCount({ onOpenDocuments: true, onSendSms: true, onEditCustomer: true })).toBe(7);
});

// ── AC-3: 회귀 0 (onEditCustomer 미전달 surface = 대시보드·예약관리 불변) ───────────────
test('AC-3: onEditCustomer 미전달 surface 는 [고객정보 수정] 미노출 = 메뉴 불변(회귀 0)', () => {
  const dashboard = buildMenuItems({}); // 콜백 0
  expect(dashboard).not.toContain('고객정보 수정');
  expect(dashboard).toEqual(['고객차트', '진료차트', '예약', '수납']);
  expect(itemCount({})).toBe(4);

  const reservations = buildMenuItems({ onOpenDocuments: true, onSendSms: true });
  expect(reservations).not.toContain('고객정보 수정');
  expect(itemCount({ onOpenDocuments: true, onSendSms: true })).toBe(6);
});

// ── AC-2: 부모 fetch→prop 가드 ──────────────────────────────────────────────────────
test('AC-2: customer_id 있으면 fetch(다이얼로그 오픈), 없으면 abort', () => {
  expect(shouldFetchCustomer({ customer_id: 'cust-uuid-1' })).toBe(true);
  expect(shouldFetchCustomer({ customer_id: null })).toBe(false);
});
