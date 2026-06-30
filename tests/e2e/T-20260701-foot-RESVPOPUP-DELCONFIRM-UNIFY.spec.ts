import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260701-foot-RESVPOPUP-DELCONFIRM-UNIFY — 예약삭제 confirm 문구 단일화
 * 원천: planner(MSG-20260701-035632-5fby). NAVSPLIT 폐기 후 잔류 관찰 1건 후속.
 *
 * 판단(planner): 현행 유지 대신 단일화 채택. AC2 confirm 게이트는 기능상 이미 충족
 *   (팝업/우클릭 둘 다 confirm 게이트·무방비 즉시삭제 0)이나, 우클릭 메뉴 문구의
 *   '(다시 올 고객이라면 [예약 취소]를 쓰세요)' 넛지가 재방문 고객 오삭제 방지 보호가치가
 *   있어 ReservationDetailPopup [예약삭제] confirm 도 그 문구로 통일.
 *
 * scope = 표시 문구만. confirm 게이트·hard-delete 전이 로직·soft/hard 정책 무변경.
 *
 * 상수 1곳 공유(=양쪽 import) 미채택 사유: ReservationContextMenu 의 confirm 리터럴은
 *   선행 source-integrity 스펙(T-20260610-...5FIX AC2-2/AC3-1)이 직접 단언 중이라,
 *   리터럴을 상수로 추출하면 인접 티켓 스펙이 깨진다(비용↑·인접 코드 침범). planner escape-hatch
 *   '비용 크면 문구 일치만으로 OK' 채택 — 대신 본 스펙의 '글자 단위 동일성 가드'가 재drift 를 차단한다.
 *
 * established 거대-인라인 컴포넌트 관례 = source-integrity gating(소스 정적 단언).
 * 실 브라우저 동작(confirm 취소→삭제 미실행)은 supervisor field-soak 로 닫음. DB 무관(FE-only).
 */

const CTX_MENU = fs.readFileSync(path.resolve('src/components/ReservationContextMenu.tsx'), 'utf-8');
const DETAIL_POPUP = fs.readFileSync(path.resolve('src/components/ReservationDetailPopup.tsx'), 'utf-8');

// 정본 — 우클릭 메뉴(ReservationContextMenu)가 보유한 보호 넛지 포함 삭제 확인 문구.
//   소스 리터럴에는 개행이 '\n'(역슬래시+n) 로 들어가므로 정규식도 \\n 로 매칭한다.
const CANONICAL_DELETE_CONFIRM_RE =
  /예약을 완전 삭제하시겠습니까\?\\n삭제하면 정보가 완전히 사라지며 복구할 수 없습니다\.\\n\(다시 올 고객이라면 \[예약 취소\]를 쓰세요\)/;

// 단일화로 폐기되는 구(舊) 팝업 문구 — 잔존하면 교체 누락.
const OLD_POPUP_CONFIRM_FRAGMENT = '이 작업은 되돌릴 수 없습니다';

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 — ReservationDetailPopup [예약삭제] confirm 문구 = 우클릭 메뉴 정본
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: 팝업 삭제 confirm 문구 단일화', () => {
  test('AC1-1: ReservationDetailPopup 삭제 confirm 이 정본(넛지 포함) 문구', () => {
    expect(DETAIL_POPUP, '팝업 삭제 confirm 이 우클릭 메뉴 정본 문구와 불일치')
      .toMatch(CANONICAL_DELETE_CONFIRM_RE);
  });

  test('AC1-2: 재방문 고객 오삭제 방지 넛지 안내 존재', () => {
    expect(DETAIL_POPUP, "팝업 삭제 confirm 에 '[예약 취소]를 쓰세요' 넛지 누락")
      .toContain('(다시 올 고객이라면 [예약 취소]를 쓰세요)');
  });

  test('AC1-3: 구(舊) 팝업 문구 잔존 0 (교체 누락 가드)', () => {
    expect(DETAIL_POPUP, "구 팝업 confirm 문구('이 작업은 되돌릴 수 없습니다') 잔존")
      .not.toContain(OLD_POPUP_CONFIRM_FRAGMENT);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 — 두 삭제 진입점(우클릭 메뉴 ↔ 상세 팝업) 글자 단위 동일 (재drift 가드)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 진입점 간 문구 동일성 (drift 가드)', () => {
  test('AC2-1: ReservationContextMenu 정본 문구 유지 (회귀 가드)', () => {
    expect(CTX_MENU, '우클릭 메뉴 삭제 confirm 정본 불일치').toMatch(CANONICAL_DELETE_CONFIRM_RE);
  });

  test('AC2-2: 두 진입점이 동일 정본 문구 공유 (향후 어느 한쪽 변경 시 본 가드가 차단)', () => {
    expect(CTX_MENU, '우클릭 메뉴 정본 누락').toMatch(CANONICAL_DELETE_CONFIRM_RE);
    expect(DETAIL_POPUP, '상세 팝업 정본 누락 — drift 발생').toMatch(CANONICAL_DELETE_CONFIRM_RE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3 — 무변경 가드: confirm 게이트·hard-delete 전이 로직 보존
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오3: confirm 게이트·삭제 로직 무변경 가드', () => {
  test('AC3-1: 삭제는 window.confirm 게이트 통과 후에만 (무방비 즉시삭제 0)', () => {
    // confirm 이 false 면 early-return — 게이트 패턴 보존.
    expect(DETAIL_POPUP, '삭제 confirm 게이트(early-return) 누락')
      .toMatch(/if \(!window\.confirm\([\s\S]*?\)\) return;/);
  });

  test('AC3-2: 삭제 = hard-delete 전이 로직 보존 (soft/hard 정책 무변경)', () => {
    expect(DETAIL_POPUP, "hard-delete(.from('reservations').delete()) 누락")
      .toContain(".from('reservations').delete()");
    expect(DETAIL_POPUP, '예약삭제 버튼 누락').toContain('data-testid="btn-reservation-delete"');
  });
});
