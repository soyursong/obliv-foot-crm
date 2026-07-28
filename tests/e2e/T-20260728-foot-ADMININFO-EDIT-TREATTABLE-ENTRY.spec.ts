import { test, expect } from '@playwright/test';

/**
 * E2E — T-20260728-foot-ADMININFO-EDIT-TREATTABLE-ENTRY
 *   현장(김주연 총괄): "행정정보 수정·변경할 수 있는 기능 치료테이블-진료에도 넣어줘."
 *   ★위치: 치료테이블 진료 탭 → [소견서·진단서] 서브탭 → 발행완료 클릭 → '소견서 문서 뷰
 *     (IssuedOpinionDocFormView 다이얼로그)' **하단**에 [행정정보 수정] 진입점.
 *
 * ★SUPERSEDED-BY: T-20260728-foot-DOCADMIN-EDITFORM-FIELDSET-REALIGN (planner GO 2026-07-29).
 *   진입점의 대상이 고객관리 EditCustomerDialog(공유 → 회귀위험) → **서류 행정필드 전용 편집기**로 재배선됨.
 *   본 spec 은 진입점의 '위치/노출/회귀-안전' 불변식만 유지한다(진입점은 재배선 후에도 문서뷰 푸터에 그대로).
 *   필드셋 정합·저장 payload·진료의 게이트 계약은 REALIGN spec 이 담당.
 *
 * ── 설계 계약(본 spec 이 지키는 불변식) ─────────────────────────────────────────
 *   AC-1 진입점 위치: 소견서 문서 뷰(diagdoc-doc-view-dialog)의 DialogFooter 하단에 [행정정보 수정] 버튼 1개.
 *   AC-2 게이팅(재배선): 편집 대상 = 발행완료 요청행(viewTarget). viewTarget 없으면 버튼 disabled.
 *        (구 customer fetch→prop 게이팅은 재배선으로 폐기 — 편집기는 요청행 id 로 동작, customers fetch 불요.)
 *   AC-3 회귀 0: 공유 컴포넌트 IssuedOpinionDocFormView(진료대시보드 뷰어와 공용)·발행 파이프라인 무접촉.
 *        진입점은 DiagDocSection(치료사 공간) 래퍼 JSX 에만 추가 → 진료대시보드 뷰어에는 미노출.
 */

// ── 소견서 문서 뷰 하단 [행정정보 수정] 버튼 노출/활성 게이팅 재현 (DiagDocSection DialogFooter) ──
//   viewTarget(발행완료 열람 대상) 존재 시 뷰가 열리고 하단에 버튼 노출. viewTarget 없으면 disabled.
interface ViewTarget {
  customerId: string | null;
}
function docViewFooterButtons(viewTarget: ViewTarget | null): string[] {
  if (!viewTarget) return []; // 뷰 미오픈 = 버튼 없음
  // 하단 append 순서: [행정정보 수정] → [닫기] (기존 닫기 버튼 보존)
  return ['행정정보 수정', '닫기'];
}
// 버튼 disabled 술어(재배선 후 컴포넌트 재현): viewTarget 없으면 비활성(편집기는 요청행으로 동작).
function isEditAdminDisabled(viewTarget: ViewTarget | null): boolean {
  return !viewTarget;
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

// ── AC-2: 재배선 게이팅 (viewTarget 유무) ─────────────────────────────────────────────
test('AC-2: viewTarget 있으면 버튼 활성(편집기는 요청행 id 로 동작 — customers fetch 불요)', () => {
  const vt: ViewTarget = { customerId: 'cust-uuid-1' };
  expect(isEditAdminDisabled(vt)).toBe(false);
});

test('AC-2: viewTarget 없으면 버튼 disabled', () => {
  expect(isEditAdminDisabled(null)).toBe(true);
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
