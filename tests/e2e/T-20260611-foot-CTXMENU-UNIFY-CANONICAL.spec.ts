import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260611-foot-CTXMENU-UNIFY-CANONICAL — 우클릭 컨텍스트메뉴 정본(canonical) 통일
 * 원천: CORRECTION MSG-20260611-095134-jdej. 선행 5FIX(commit 09a40d4) 위에 적층.
 *
 * canonical = 정확히 5항목·고정순서:
 *   고객차트 → 진료차트 → 예약상세 → 수납 → 문자
 * 적용 대상 = (A) 대시보드 타임라인 예약 박스 우클릭  (B) 예약관리 행 우클릭 — 둘이 동일 항목·순서.
 *
 * 핵심 변경:
 *   1) [예약 취소]·[완전 삭제] 를 두 메뉴 와이어링에서 제거 → 예약상세 팝업(ReservationDetailPopup)
 *      내부 버튼([예약취소] cancelWithReason / [예약삭제] deleteReservation)으로만. (기능 손실 0)
 *   2) [예약하기] 라벨 제거 → 기존 예약 진입점은 reservationActionLabel="예약상세" 단일.
 *
 * §8 가드(추정 금지): 대시보드 "고객 카드"(체크인 고객) 우클릭 메뉴는 신규 예약 생성 진입점
 *   (handleNewReservation = LOGIC-LOCK L-002, label 기본 '예약하기')으로, 본 5항목 canonical 집합
 *   밖이다 → [예약하기] 미변경. 통일 대상 여부는 planner FOLLOWUP 으로 질의(임의 변경 금지).
 *
 * 거대-인라인 페이지(Reservations/Dashboard) 관례 = source-integrity gating(소스 정적 단언).
 * 실 브라우저 동작은 supervisor field-soak 로 닫음. DB 무관(FE-only).
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const DASH_PAGE = fs.readFileSync(path.resolve('src/pages/Dashboard.tsx'), 'utf-8');
const DETAIL_POPUP = fs.readFileSync(path.resolve('src/components/ReservationDetailPopup.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// AC1 — 5항목 canonical: 두 surface 우클릭 메뉴가 [예약상세] 라벨 + 동일 핸들러 패턴
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1: 5항목 canonical 통일 (대시보드 타임라인 + 예약관리)', () => {
  test('AC1-1: 예약관리 우클릭 메뉴 라벨 = [예약상세]', () => {
    expect(RESV_PAGE, '예약관리 우클릭 라벨이 예약상세 아님')
      .toContain('reservationActionLabel="예약상세"');
  });

  test('AC1-2: 대시보드 타임라인 우클릭 메뉴 라벨 = [예약상세]', () => {
    expect(DASH_PAGE, '대시보드 타임라인 우클릭 라벨이 예약상세 아님')
      .toContain('reservationActionLabel="예약상세"');
  });

  test('AC1-3: 대시보드 타임라인 메뉴 = CustomerQuickMenu (ReservationContextMenu import 제거)', () => {
    // 통일 = 타임라인도 CustomerQuickMenu(5항목) 사용. 구 3항목 ReservationContextMenu 컴포넌트 import 금지.
    expect(DASH_PAGE, 'ReservationContextMenu 컴포넌트 import 잔존(통일 미완)')
      .not.toContain("import { ReservationContextMenu }");
    expect(DASH_PAGE, '대시보드가 예약상세 팝업을 임베드하지 않음')
      .toContain("import { ReservationDetailPopup } from '@/components/ReservationDetailPopup'");
  });

  test('AC1-4: 두 surface 의 [예약상세] 동작 = 예약상세 팝업 오픈 핸들러로 연결', () => {
    // 예약관리: handleResvOpenDetailFromMenu, 대시보드 타임라인: handleResvOpenDetailFromCtx
    expect(RESV_PAGE).toContain('onNewReservation={handleResvOpenDetailFromMenu}');
    expect(DASH_PAGE).toContain('onNewReservation={handleResvOpenDetailFromCtx}');
    // 핸들러 정의 존재
    expect(RESV_PAGE).toContain('const handleResvOpenDetailFromMenu');
    expect(DASH_PAGE).toContain('const handleResvOpenDetailFromCtx');
    expect(DASH_PAGE).toContain('const handleResvOpenPaymentFromCtx');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC2 — [예약하기] 라벨 제거 + §8 가드(대시보드 고객카드 신규예약 진입점 미변경)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC2: 예약하기 라벨 제거 + §8 가드', () => {
  test('AC2-1: 기존 예약 진입점(예약관리/타임라인)에 [예약하기] 라벨 와이어링 없음', () => {
    // 두 surface 모두 reservationActionLabel="예약상세" 만 명시. '예약하기' 라벨 와이어링 금지.
    expect(RESV_PAGE).not.toContain('reservationActionLabel="예약하기"');
    expect(DASH_PAGE).not.toContain('reservationActionLabel="예약하기"');
  });

  test('AC2-2 [§8 가드]: 대시보드 고객카드 신규예약 진입점(handleNewReservation)은 미변경', () => {
    // 고객카드 우클릭 = 신규 예약 생성(LOGIC-LOCK L-002). canonical 5항목 집합 밖 → 변경 금지.
    // 통일 대상 여부는 planner FOLLOWUP 으로 질의(본 티켓에서 임의 변경 X).
    expect(DASH_PAGE, '대시보드 고객카드 신규예약 핸들러(handleNewReservation) 소실')
      .toContain('const handleNewReservation');
    expect(DASH_PAGE, '대시보드 고객카드 메뉴 onNewReservation 와이어링 소실')
      .toContain('onNewReservation={handleNewReservation}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC3 — 취소/삭제 메뉴 제거 → 예약상세 팝업 버튼으로만 (기능 손실 0)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC3: 취소/삭제는 예약상세 팝업 버튼으로만', () => {
  test('AC3-1: 두 surface 우클릭 메뉴 모두 취소/삭제 핸들러 와이어링 제거', () => {
    // 예약관리: handleResvCancelRequest/handleResvHardDelete 와이어링 제거(메뉴 prop).
    expect(RESV_PAGE).not.toContain('onCancelReservation={handleResvCancelRequest}');
    expect(RESV_PAGE).not.toContain('onDeleteReservation={handleResvHardDelete}');
    // 대시보드: 타임라인 우클릭 메뉴에 취소/삭제 prop 와이어링 없음(파일 전역 메뉴 경로 0).
    expect(DASH_PAGE, '대시보드에 취소 핸들러 메뉴 와이어링 잔존').not.toContain('onCancelReservation=');
    expect(DASH_PAGE, '대시보드에 삭제 핸들러 메뉴 와이어링 잔존').not.toContain('onDeleteReservation=');
  });

  test('AC3-2: 취소/삭제 로직은 ReservationDetailPopup 버튼에 보존 (기능 손실 0)', () => {
    // [예약취소] = status 전이(cancelled, 고객 keep) / [예약삭제] = hard-delete. 두 경로 분리 보존.
    expect(DETAIL_POPUP).toContain('data-testid="btn-reservation-cancel"');
    expect(DETAIL_POPUP).toContain("status: 'cancelled'");
    expect(DETAIL_POPUP).toContain('data-testid="btn-reservation-delete"');
    expect(DETAIL_POPUP).toContain(".from('reservations').delete()");
  });

  test('AC3-3: 예약관리 편집모달(ReservationEditor) 취소/삭제 경로는 별도 보존', () => {
    // 메뉴 제거와 무관하게 편집모달의 취소/삭제(handleEditorCancel/handleEditorDelete)는 유지.
    expect(RESV_PAGE).toContain('onCancelReservation={handleEditorCancel}');
    expect(RESV_PAGE).toContain('onDeleteReservation={handleEditorDelete}');
  });
});
