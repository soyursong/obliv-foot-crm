import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260610-foot-RESV-MGMT-CTXMENU-DETAIL-5FIX — 예약관리 & 취소/삭제 재정비
 * 원천: 김주연 총괄(C0ATE5P6JTH) 5건. 게이트 3답(MSG-181801-wotc) 수신 후 착수.
 *
 * 본 커밋 구현 범위 = item1~3 (FE-only, 게이트 무관):
 *   item1 일관 매핑   — 취소/삭제가 두 우클릭 진입점에서 동일 핸들러·동일 문구.
 *   item2 의미 구분   — 삭제=완전제거(복구불가) / 취소=정보 keep·재예약 가능. 라벨·확인문구로 명확화.
 *   item3 항목명+동작 — 예약관리 우클릭 [예약상세](라벨 확정) + 클릭 시 ReservationDetailPopup 오픈(Q2 확정).
 *
 * item4(예약경로/예약등록자 드롭)·item5(드롭 수정 어드민)은 자매 티켓
 *   T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS(status: blocked, supervisor DB 게이트 대기 — migration
 *   20260610110000 prod 미적용)이 DB+FE 단일 소유. 본 티켓에서 중복 구현 금지 → planner FOLLOWUP 이관.
 *   (해당 분 시나리오는 아래 test.fixme 로 명시 보류.)
 *
 * 거대-인라인/established 컴포넌트 관례 = source-integrity gating(소스 정적 단언)으로 회귀 차단.
 * 실 브라우저 동작은 supervisor field-soak 로 닫음. DB 무관(FE-only).
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const QUICK_MENU = fs.readFileSync(path.resolve('src/components/CustomerQuickMenu.tsx'), 'utf-8');
const CTX_MENU = fs.readFileSync(path.resolve('src/components/ReservationContextMenu.tsx'), 'utf-8');
const CANCEL_MODAL = fs.readFileSync(path.resolve('src/components/ReservationCancelModal.tsx'), 'utf-8');
// T-20260611-foot-CTXMENU-UNIFY-CANONICAL: 취소/삭제가 우클릭 메뉴 와이어링 → 예약상세 팝업 버튼으로 단일화.
//   AC2-5 의 status-전이 vs hard-delete 분리 가드를 새 위치(ReservationDetailPopup)에서 검증.
const DETAIL_POPUP = fs.readFileSync(path.resolve('src/components/ReservationDetailPopup.tsx'), 'utf-8');

// 두 진입점이 공유해야 하는 삭제 확인 문구(복구불가 경고) — item1 일관 + item2 의미.
const DELETE_CONFIRM = '삭제하면 정보가 완전히 사라지며 복구할 수 없습니다.';

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 (item3) — 예약관리 우클릭 [예약상세] 라벨 + 클릭 시 예약상세 팝업 오픈
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: 예약상세 항목명 + 팝업 오픈 (item3 / Q2)', () => {
  test('AC1-1: 예약관리 CustomerQuickMenu 라벨이 [예약상세]', () => {
    expect(RESV_PAGE, '예약관리 우클릭 라벨이 예약상세가 아님').toContain('reservationActionLabel="예약상세"');
  });

  test('AC1-2: [예약상세] 클릭 동작 = ReservationDetailPopup 오픈 (신규예약 editor 아님)', () => {
    // onNewReservation 와이어링이 상세팝업 핸들러로 연결되어야 한다(라벨만 X, 동작까지).
    expect(RESV_PAGE, 'onNewReservation 가 상세팝업 핸들러로 연결되지 않음')
      .toContain('onNewReservation={handleResvOpenDetailFromMenu}');
  });

  test('AC1-3: handleResvOpenDetailFromMenu 가 setDetail(원본 예약) 호출', () => {
    const m = RESV_PAGE.match(/const handleResvOpenDetailFromMenu = useCallback\(\(ci: CheckIn\) => \{([\s\S]*?)\}, \[rows\]\);/);
    expect(m, 'handleResvOpenDetailFromMenu 미정의 또는 deps≠[rows]').toBeTruthy();
    const body = m![1];
    expect(body, 'reservation_id 기반 원본 조회 누락').toContain('rows.find((r) => r.id === resvId)');
    expect(body, 'setDetail 로 상세팝업 오픈 누락').toContain('setDetail(resv)');
  });

  test('AC1-4: 기존 [예약하기](신규예약) 메뉴 핸들러는 제거 — 데드코드 0', () => {
    expect(RESV_PAGE, '구 handleResvNewReservation 잔존(예약상세로 repurpose 누락)')
      .not.toContain('handleResvNewReservation');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 (item2) — 취소 vs 삭제 의미 구분 (라벨·확인문구)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 취소 vs 삭제 의미 구분 (item2)', () => {
  // STALEGUARD-QUICKMENU-DELCONFIRM-DROP (T-20260701): CANONICAL(T-20260611-foot-CTXMENU-UNIFY-CANONICAL,
  //   deployed fbb843b)이 reporter 권위로 모든 우클릭 surface에서 [완전 삭제]·삭제 confirm 제거 →
  //   CustomerQuickMenu 의 삭제 confirm 진입점이 소멸. CANONICAL 스펙은 RESV/DASH/DETAIL_POPUP 만 읽고
  //   CustomerQuickMenu.tsx 는 읽지 않아(AC3-1은 page-level 핸들러 와이어링만 가드) 컴포넌트-소스 부재
  //   회귀를 직접 단언하지 않는다 → 본 1건만 .not.toContain 부재가드로 용도변경해 보존, 나머지 stale 2건 삭제.
  test('AC2-1: CustomerQuickMenu 삭제 confirm 부재 — CANONICAL 우클릭 삭제항목 제거 회귀 가드', () => {
    expect(QUICK_MENU, 'CustomerQuickMenu 에 삭제 confirm 문구 잔존(CANONICAL 삭제항목 제거 위반)')
      .not.toContain(DELETE_CONFIRM);
  });

  test('AC2-2: 완전 삭제 확인문구 = 복구불가 경고 (ReservationContextMenu)', () => {
    expect(CTX_MENU, '타임라인 삭제 확인문구에 복구불가 경고 없음').toContain(DELETE_CONFIRM);
  });

  test('AC2-3: 삭제 확인문구가 [예약 취소] 대안을 안내 (혼동 방지)', () => {
    // STALEGUARD-QUICKMENU-DELCONFIRM-DROP: CustomerQuickMenu 단언은 CANONICAL 삭제항목 제거로 stale → 삭제.
    //   ReservationContextMenu(타임라인)는 confirm 진입점 보존 → CANONICAL 정합 현존 단언으로 유지.
    expect(CTX_MENU).toContain('[예약 취소]를 쓰세요');
  });

  test('AC2-4: 취소 모달은 정보 keep·재예약 가능 안내 (취소≠삭제)', () => {
    expect(CANCEL_MODAL, '취소 모달에 재예약 가능 안내 없음')
      .toContain('같은 고객으로 다시 예약할 수 있습니다');
  });

  test('AC2-5: 취소=status 전이(고객 keep) vs 삭제=hard-delete 분리 유지 — 회귀 가드', () => {
    // T-20260611-foot-CTXMENU-UNIFY-CANONICAL 으로 취소/삭제는 우클릭 메뉴 와이어링에서 제거되고
    // 예약상세 팝업(ReservationDetailPopup)의 [예약취소]/[예약삭제] 버튼으로 단일화됐다.
    //   → 예약관리 메뉴는 더이상 취소/삭제 핸들러를 와이어링하지 않는다(canonical 5항목).
    expect(RESV_PAGE, '예약관리 우클릭 메뉴에 취소 핸들러 잔존(canonical 위반)')
      .not.toContain('onCancelReservation={handleResvCancelRequest}');
    expect(RESV_PAGE, '예약관리 우클릭 메뉴에 삭제 핸들러 잔존(canonical 위반)')
      .not.toContain('onDeleteReservation={handleResvHardDelete}');
    // 취소 = status 전이(고객 keep) — 행 보존, 사유 기록
    expect(DETAIL_POPUP, '취소가 status 전이(cancelled)로 고객 keep 하지 않음')
      .toContain("status: 'cancelled'");
    expect(DETAIL_POPUP, '예약취소 버튼 누락').toContain('data-testid="btn-reservation-cancel"');
    // 삭제 = hard-delete — 행 제거 (취소와 명확히 분리)
    expect(DETAIL_POPUP, '삭제가 hard-delete(.delete())가 아님')
      .toContain(".from('reservations').delete()");
    expect(DETAIL_POPUP, '예약삭제 버튼 누락').toContain('data-testid="btn-reservation-delete"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3 (item1) — 일관 매핑: 두 진입점이 동일 핸들러·동일 삭제문구
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오3: 일관 매핑 (item1)', () => {
  test('AC3-1: 우클릭 메뉴 삭제 확인문구가 정본 형식과 글자 단위로 동일 (ReservationContextMenu)', () => {
    // STALEGUARD-QUICKMENU-DELCONFIRM-DROP: CustomerQuickMenu 정본 매치는 CANONICAL 삭제항목 제거로 stale → 삭제.
    //   삭제 confirm 을 보유한 ReservationContextMenu 의 정본 형식 회귀만 가드(현존·CANONICAL 정합).
    const re = /예약을 완전 삭제하시겠습니까\?\\n삭제하면 정보가 완전히 사라지며 복구할 수 없습니다\.\\n\(다시 올 고객이라면 \[예약 취소\]를 쓰세요\)/;
    expect(CTX_MENU, 'ReservationContextMenu 삭제문구 정본 불일치').toMatch(re);
  });

  test('AC3-2: 기존 보존 동작 — [완전 삭제]·[SMS/문자]·취소 항목 유지 (직렬화 회귀 가드)', () => {
    // CTXMENU-STALE-PHONE / SMS-SEND / HARDDELETE 등 선행 티켓 산출 보존.
    // STALEGUARD-QUICKMENU-FALSEPASS-DROP (T-20260701, parent DELCONFIRM-DROP 同型 클로즈):
    //   기존 QUICK_MENU.toContain('완전 삭제')/('예약 취소') 2건은 false-pass였음 — CANONICAL
    //   (T-20260611-foot-CTXMENU-UNIFY-CANONICAL, deployed fbb843b)이 CustomerQuickMenu 의
    //   [완전 삭제]·[예약 취소] 메뉴 항목을 제거했고, 실 렌더 항목은 고객차트/진료차트/예약액션/수납/문자뿐.
    //   두 문자열은 CustomerQuickMenu.tsx 의 *주석*(이력 L4·L8, 제거고지 L148-150)에만 잔존해
    //   toContain 이 주석-residual 로 GREEN 가장 → stale 청소(clean 삭제). 부재가드는 .not.toContain 으로
    //   용도변경 불가(주석이 동일 문자열을 합법 보유 → 부재단언이 주석에 도로 결합). QuickMenu 삭제항목
    //   부재는 부모 DELCONFIRM-DROP 의 AC2-1 .not.toContain(DELETE_CONFIRM)(L71-74)이 이미 가드.
    //   CTX_MENU(타임라인)는 [완전 삭제]·[예약 취소] 실항목 보존 → 아래 현존 단언 유지.
    expect(CTX_MENU).toContain('완전 삭제');
    expect(CTX_MENU).toContain('SMS 보내기');
    expect(CTX_MENU).toContain('예약 취소');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1(드롭)·4 — item4/item5: 자매 티켓 REGISTRAR-ROUTE-FIELDS DB 게이트 대기 → 보류
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1(드롭)/4: 예약경로·예약등록자 드롭 + 어드민 (item4/item5)', () => {
  test.fixme('item4: 예약상세 팝업 예약경로/예약등록자 드롭 — REGISTRAR-ROUTE-FIELDS(blocked, supervisor DB 게이트) 단일 소유. 본 티켓 중복 구현 금지.', () => {});
  test.fixme('item5: 예약등록자 드롭 수정 어드민 — 배치 design-open(현장 확인) + DB 게이트 대기.', () => {});
});
