import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260611-foot-TOPBAR-RESV-BTN-REMOVE — 헤더 전역 [예약하기] 버튼 제거
 * 원천: NEW-TASK MSG-20260611-165502-yik9 (김주연 총괄 요청, P2).
 *
 * 변경:
 *   CRM 맨 상단 헤더(AdminLayout <header>)의 전역 [예약하기] 버튼(data-testid="btn-header-make-reservation")
 *   렌더 지점 + dead handler/import(CalendarPlus) 제거.
 *
 * §유일경로 가드(통과): 예약 등록은 헤더 버튼이 유일 진입점이 아님 —
 *   (1) 예약관리 페이지 '새 예약' 버튼(Reservations.tsx, T-20260513-foot-RESV-PLUS-PHONE-SEARCH)
 *   (2) 고객관리 우클릭 [예약하기](Customers.tsx)
 *   (3) 대시보드 고객카드(Dashboard.tsx, handleNewReservation)
 *   (4) 차트 내 [예약하기](CustomerChartPage.tsx)
 *   (5) 캘린더 날짜 클릭(CalendarNoticePanel.tsx)
 *   → 헤더 버튼 제거해도 예약 동선 손실 0. L-002 원칙(클릭 시 full page 전환)은 잔존 진입점에 그대로 유지.
 *
 * 거대-인라인 컴포넌트(AdminLayout) 관례 = source-integrity gating(소스 정적 단언).
 * 실 브라우저 렌더/콘솔에러는 supervisor field-soak 로 닫음. DB 무관(FE-only).
 */

const LAYOUT = fs.readFileSync(path.resolve('src/components/AdminLayout.tsx'), 'utf-8');
const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// AC1 — 상단 헤더 [예약하기] 버튼 미노출
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1: 헤더 전역 [예약하기] 버튼 제거', () => {
  test('AC1-1: btn-header-make-reservation testid 잔존 없음', () => {
    expect(LAYOUT, '헤더 예약하기 버튼 testid 가 아직 남아있음')
      .not.toContain('btn-header-make-reservation');
  });

  test('AC1-2: 헤더 영역에 [예약하기] 버튼 렌더 라벨 없음', () => {
    // <header> 영역 안에서 '예약하기' 텍스트 노드가 없어야 함.
    const headerStart = LAYOUT.indexOf('<header');
    const headerEnd = LAYOUT.indexOf('</header>');
    expect(headerStart, '<header> 마커를 찾을 수 없음').toBeGreaterThan(-1);
    expect(headerEnd, '</header> 마커를 찾을 수 없음').toBeGreaterThan(headerStart);
    const headerBlock = LAYOUT.slice(headerStart, headerEnd);
    expect(headerBlock, '헤더 블록에 예약하기 버튼 라벨 잔존')
      .not.toContain('예약하기');
  });

  test('AC1-3: 제거 사유 주석(티켓 ID) 남김', () => {
    expect(LAYOUT, '제거 사유 추적 주석 누락')
      .toContain('T-20260611-foot-TOPBAR-RESV-BTN-REMOVE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC2 — dead code 정리 (CalendarPlus import 제거 / navigate 유지)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC2: dead handler/import 정리', () => {
  test('AC2-1: CalendarPlus import 제거 (버튼 외 사용처 없었음)', () => {
    expect(LAYOUT, '버튼 제거 후에도 CalendarPlus import 잔존(dead import)')
      .not.toContain('CalendarPlus');
  });

  test('AC2-2: navigate 는 유지 (logout/customer 이동 등 타 사용처)', () => {
    // navigate 자체는 다른 경로(로그아웃, 고객 이동)에서 사용 → 제거 금지.
    expect(LAYOUT).toContain('useNavigate');
    expect(LAYOUT).toContain("navigate('/login')");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC3 — 기존 예약 동선 회귀 없음 (유일경로 가드: 대체 진입점 보존)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC3: 예약 등록 대체 진입점 보존 (회귀 없음)', () => {
  test('AC3-1: 예약관리 페이지 [새 예약] 버튼 보존', () => {
    expect(RESV_PAGE, '예약관리 새 예약 진입점 손실')
      .toContain('새 예약');
  });

  test('AC3-2: openReservationFor 동선(대시보드/차트 → 예약관리 자동오픈) 보존', () => {
    expect(RESV_PAGE, 'openReservationFor 자동오픈 처리 손실')
      .toContain('openReservationFor');
  });
});
