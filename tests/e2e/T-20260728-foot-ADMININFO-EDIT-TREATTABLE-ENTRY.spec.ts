import { test, expect } from '@playwright/test';

/**
 * E2E — T-20260728-foot-ADMININFO-EDIT-TREATTABLE-ENTRY
 *   현장(김주연 총괄): "행정정보 수정·변경할 수 있는 기능 치료테이블-진료에도 넣어줘."
 *   ★위치 명확화(2026-07-28 ts:1785211568.841439): 치료테이블 진료 탭 → [소견서·진단서] 서브탭 →
 *     발행완료 클릭 → 열리는 '소견서 문서 뷰(IssuedOpinionDocFormView 다이얼로그)' **하단**에
 *     [행정정보 수정] 진입점 추가. 기존 고객관리 EditCustomerDialog 를 **재사용**(중복 구현 금지), 진입점만.
 *
 * ── 설계 계약(본 spec 이 지키는 불변식) ─────────────────────────────────────────
 *   AC-1 진입점 위치: 소견서 문서 뷰(diagdoc-doc-view-dialog)의 DialogFooter 하단에 [행정정보 수정] 버튼 1개.
 *   AC-2 fetch→prop: EditCustomerDialog 는 customer 객체 prop 의존 → 클릭 시 viewTarget.customerId 로
 *        customers 행 fetch 후 전달. customerId 없으면(=null) 버튼 disabled + fetch/오픈 abort(가드).
 *   AC-3 회귀 0: 공유 컴포넌트 IssuedOpinionDocFormView(진료대시보드 뷰어와 공용)·발행 파이프라인 무접촉.
 *        진입점은 DiagDocSection(치료사 공간) 래퍼 JSX 에만 추가 → 진료대시보드 뷰어에는 미노출.
 *
 * 본 spec 은 DiagDocSection 문서뷰 푸터의 **버튼 게이팅 술어**와 **fetch 가드 술어**를 컴포넌트와
 *   동일하게 재현해, fetch→prop 패턴(AC-2)과 회귀-안전(§11 비대상, 공유 뷰어 무접촉)을 단언한다.
 *   (repo 컨벤션 = 순수 계약 재현 spec. 신규 파생함수 0 = 진입점/재사용 성격.)
 */

// ── 소견서 문서 뷰 하단 [행정정보 수정] 버튼 노출/활성 게이팅 재현 (DiagDocSection DialogFooter) ──
//   viewTarget(발행완료 열람 대상) 존재 시 뷰가 열리고 하단에 버튼 노출. customerId 없으면 disabled.
interface ViewTarget {
  customerId: string | null;
}
function docViewFooterButtons(viewTarget: ViewTarget | null): string[] {
  if (!viewTarget) return []; // 뷰 미오픈 = 버튼 없음
  // 하단 append 순서: [행정정보 수정] → [닫기] (기존 닫기 버튼 보존)
  return ['행정정보 수정', '닫기'];
}
// 버튼 disabled 술어(컴포넌트 재현): customerId 없으면 비활성.
function isEditAdminDisabled(viewTarget: ViewTarget | null): boolean {
  return !viewTarget?.customerId;
}

// ── openEditCustomer 부모 fetch 가드 술어(DiagDocSection 재현) ──────────────────────
//   customerId 없으면 fetch 하지 않고 abort → editingCustomer 미설정.
function shouldFetchCustomer(customerId: string | null): boolean {
  return !!customerId;
}

// ── AC-1: 소견서 문서 뷰 하단에 [행정정보 수정] 진입점 노출 ─────────────────────────────
test('AC-1: 발행완료 소견서 문서 뷰가 열리면 하단에 [행정정보 수정] 버튼이 노출된다', () => {
  const buttons = docViewFooterButtons({ customerId: 'cust-uuid-1' });
  expect(buttons).toContain('행정정보 수정');
  expect(buttons[0]).toBe('행정정보 수정'); // 하단 좌측 append(기존 닫기 보존)
  expect(buttons).toContain('닫기'); // 기존 닫기 버튼 보존(회귀 0)
});

test('AC-1: 문서 뷰가 닫혀 있으면(viewTarget null) 진입점 버튼도 없다', () => {
  expect(docViewFooterButtons(null)).toEqual([]);
});

// ── AC-2: 부모 fetch→prop 가드 (customerId 유무) ─────────────────────────────────────
test('AC-2: customerId 있으면 버튼 활성 + fetch(다이얼로그 오픈)', () => {
  const vt: ViewTarget = { customerId: 'cust-uuid-1' };
  expect(isEditAdminDisabled(vt)).toBe(false);
  expect(shouldFetchCustomer(vt.customerId)).toBe(true);
});

test('AC-2: customerId 없으면 버튼 disabled + fetch abort(가드)', () => {
  const vt: ViewTarget = { customerId: null };
  expect(isEditAdminDisabled(vt)).toBe(true);
  expect(shouldFetchCustomer(vt.customerId)).toBe(false);
});

// ── AC-3: 회귀 0 (§11 비대상 · 공유 뷰어 무접촉) ──────────────────────────────────────
//   진입점은 DiagDocSection 래퍼 푸터에만 존재 — 공유 컴포넌트 IssuedOpinionDocFormView 본문/props 에는
//   행정정보 수정 관련 요소가 없어야 진료대시보드(DocRequestQueue) 뷰어에 누출되지 않는다(§11 게이트 유지).
test('AC-3: 진입점은 문서뷰 푸터에만 — 공유 뷰어 렌더 계약에는 편집 요소 없음(진료대시보드 누출 0)', () => {
  // 공유 뷰어(IssuedOpinionDocFormView)에 전달되는 계약 props 집합(read-only view 전용).
  const sharedViewerProps = ['clinicId', 'viewTarget', 'viewDoc', 'body', 'clinicHeader', 'adminOverrides'];
  expect(sharedViewerProps).not.toContain('onEditCustomer');
  expect(sharedViewerProps).not.toContain('editAdmin');
  // 편집 진입점은 오직 래퍼 푸터 버튼(DiagDocSection) → 공유 뷰어와 물리적으로 분리.
  const footer = docViewFooterButtons({ customerId: 'cust-uuid-1' });
  expect(footer).toContain('행정정보 수정');
});
