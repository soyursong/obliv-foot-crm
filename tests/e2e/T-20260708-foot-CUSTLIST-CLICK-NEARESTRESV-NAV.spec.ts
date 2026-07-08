import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260708-foot-CUSTLIST-CLICK-NEARESTRESV-NAV (A안)
 *   — 예약관리(/admin/reservations)에서 헤더 고객 검색·선택 시: 페이지 이동 없이 예약관리 화면에 머문 채
 *     그 고객의 '가장 가까운 다음 예약'(예약일시 >= now 중 최이른 1건)으로 뷰 점프 + 고객정보 팝업 유지.
 * 원천: NEW-TASK MSG-20260708-125044-ggr4 (planner) / REV2 MSG-bh1q. 요청자: 박민지 팀장(C0ATE5P6JTH).
 *
 * 변경:
 *   - AdminLayout 전역 검색(⌘K) 결과 클릭 핸들러: 현재 경로가 /admin/reservations 이면
 *     navigate('/admin/customers') 대신 navigate('/admin/reservations', {state:{jumpToNearestResvCustomerId, jumpNonce}})
 *     + openChart(팝업 유지). 그 외 페이지에서는 기존 동작(고객관리 전환 + 2번차트 오픈) 유지.
 *   - Reservations: state 소비(nonce 가드) → jumpToNearestUpcoming(customerId) 로 nearest upcoming 조회 →
 *     selectedDay/weekStart/viewMode(day) 점프 + selectedResvId 하이라이트 + 해당 카드 scrollIntoView.
 *   - nearest upcoming = status!='cancelled' & reservation_date>=today 중, 오늘이면 reservation_time>=now HH:mm,
 *     정렬 date asc→time asc 의 첫 매치. 0건이면 toast 안내 + 뷰/팝업 유지(페이지 이동 없음, AC-4).
 *
 * 거대-인라인 페이지(AdminLayout/Reservations) 관례 = source-integrity gating(정적 단언).
 * 실 브라우저 클릭/뷰 점프 동작은 supervisor field-soak(갤탭 실기기)로 닫음. db_change=false(reservations read-only).
 */

const LAYOUT = fs.readFileSync(path.resolve('src/components/AdminLayout.tsx'), 'utf-8');
const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 1 — 예약관리 검색 시: 페이지 이동 없이 뷰 점프 신호 + 팝업 유지 (AC-1, AC-5)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오1: 예약관리 헤더 검색 → 페이지 유지 + 뷰 점프 신호 + 팝업 유지', () => {
  test('S1-1: /admin/reservations 경로에서는 고객관리 이동 대신 예약관리 유지 + 점프 state 전달', () => {
    const idx = LAYOUT.indexOf("if (location.pathname === '/admin/reservations')");
    expect(idx, '예약관리 경로 분기 없음(A안 미구현)').toBeGreaterThan(-1);
    const block = LAYOUT.slice(idx, idx + 400);
    // 페이지 이동 없이 예약관리 유지 + 그 고객 점프 요청 state
    expect(block, '예약관리 유지 + 점프 state(jumpToNearestResvCustomerId) 전달 경로 없음')
      .toContain("navigate('/admin/reservations'");
    expect(block, 'jumpToNearestResvCustomerId state 전달 없음').toContain('jumpToNearestResvCustomerId: c.id');
    // 반복 검색도 매번 소비되도록 nonce 동봉
    expect(block, '반복 검색 소비용 jumpNonce 없음').toContain('jumpNonce: Date.now()');
  });

  test('S1-2: AC-5 — 예약관리 분기에서도 openChart(고객정보 팝업) 유지(제거 X)', () => {
    const idx = LAYOUT.indexOf("if (location.pathname === '/admin/reservations')");
    const block = LAYOUT.slice(idx, idx + 400);
    expect(block, '예약관리 분기에서 openChart(팝업 유지) 호출 소실').toContain('openChart(c.id)');
  });

  test('S1-3: 그 외 페이지는 기존 동작(고객관리 전환 + 차트 오픈) 회귀 없이 유지', () => {
    const idx = LAYOUT.indexOf("if (location.pathname === '/admin/reservations')");
    const block = LAYOUT.slice(idx, idx + 500);
    // else 분기 = 기존 navigate('/admin/customers') + openChart
    expect(block, '비예약관리 페이지 기존 동작(고객관리 전환) 소실').toContain("navigate('/admin/customers')");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 2 — Reservations 가 점프 state 를 소비해 nearest upcoming 으로 뷰 점프 (AC-1, AC-3)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오2: 예약관리 nearest upcoming 뷰 점프 소비', () => {
  test('S2-1: state.jumpToNearestResvCustomerId → jumpToNearestUpcoming 호출(nonce 1회 소비)', () => {
    expect(RESV_PAGE, '예약관리가 jumpToNearestResvCustomerId state 를 읽지 않음')
      .toContain('jumpToNearestResvCustomerId');
    expect(RESV_PAGE, 'jumpToNearestUpcoming 호출 경로 없음').toContain('jumpToNearestUpcoming(state.jumpToNearestResvCustomerId)');
    // nonce 기반 소비(반복 검색 대응) + state 정리
    expect(RESV_PAGE, 'nonce 소비 가드(jumpConsumedNonceRef) 없음').toContain('jumpConsumedNonceRef.current');
    const eff = RESV_PAGE.slice(RESV_PAGE.indexOf('jumpConsumedNonceRef.current = state.jumpNonce'));
    expect(eff.slice(0, 200), '새로고침/뒤로가기 재점프 방지용 replaceState 없음')
      .toContain("window.history.replaceState({}, '')");
  });

  test('S2-2: AC-3 — nearest upcoming = 취소 제외 & 예약일시>=now 중 date asc→time asc 최이른 1건', () => {
    const start = RESV_PAGE.indexOf('const jumpToNearestUpcoming');
    expect(start, 'jumpToNearestUpcoming 함수 없음').toBeGreaterThan(-1);
    const block = RESV_PAGE.slice(start, start + 1400);
    expect(block, 'reservations read 조회 아님').toContain(".from('reservations')");
    expect(block, '해당 고객 필터(customer_id) 없음').toContain(".eq('customer_id', customerId)");
    expect(block, '취소 예약 제외 없음').toContain(".neq('status', 'cancelled')");
    expect(block, '과거 날짜 제외(오늘 이후) 필터 없음').toContain(".gte('reservation_date', todayStr)");
    expect(block, 'date asc 정렬 없음').toContain("order('reservation_date', { ascending: true })");
    expect(block, 'time asc 정렬 없음').toContain("order('reservation_time', { ascending: true })");
    // 오늘이면 현재 시각(HH:mm) 이후만 upcoming — 지난 시간 예약으로 점프 금지
    expect(block, '오늘 예약의 현재시각 이후 필터 없음').toContain('nowHM');
  });

  test('S2-3: 점프 = selectedDay/weekStart/viewMode(day) + 하이라이트 + 해당 카드 scrollIntoView', () => {
    const start = RESV_PAGE.indexOf('const jumpToNearestUpcoming');
    const block = RESV_PAGE.slice(start, start + 1400);
    expect(block, '대상 날짜로 selectedDay 점프 없음').toContain('setSelectedDay(target)');
    expect(block, 'day 뷰 전환 없음').toContain("setViewMode('day')");
    expect(block, '대상 예약 하이라이트(selectedResvId) 없음').toContain('setSelectedResvId(upcoming.id)');
    expect(block, '스크롤 대기(pendingJumpScrollId) 설정 없음').toContain('setPendingJumpScrollId(upcoming.id)');
    // 스크롤 effect: 대상 카드 data-testid 로 scrollIntoView
    expect(RESV_PAGE, '점프 카드 scrollIntoView 경로 없음').toContain('data-testid="resv-card-${pendingJumpScrollId}"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 3 — 예정 예약 0건 폴백(AC-4) + FE-only read (db_change=false)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오3: 0건 폴백 + read-only', () => {
  test('S3-1: AC-4 — upcoming 0건이면 안내 + 뷰/팝업 유지(페이지 이동/점프 없음, 크래시 없음)', () => {
    const start = RESV_PAGE.indexOf('const jumpToNearestUpcoming');
    const block = RESV_PAGE.slice(start, start + 1400);
    // upcoming 미발견 시 toast 안내 후 early return(setSelectedDay 등 점프 미실행)
    expect(block, '0건 폴백 안내(toast) 없음').toContain('예정된 다음 예약이 없습니다');
    const noneIdx = block.indexOf('if (!upcoming)');
    expect(noneIdx, '0건 분기(if (!upcoming)) 없음').toBeGreaterThan(-1);
    const noneBlock = block.slice(noneIdx, noneIdx + 200);
    expect(noneBlock, '0건 시 early return(점프 미실행) 없음').toContain('return;');
  });

  test('S3-2: FE-only — jumpToNearestUpcoming 은 reservations read 만(write 혼입 0, db_change=false)', () => {
    const start = RESV_PAGE.indexOf('const jumpToNearestUpcoming');
    const block = RESV_PAGE.slice(start, start + 1400);
    expect(block, 'nearest 조회 함수에 insert 혼입').not.toContain('.insert(');
    expect(block, 'nearest 조회 함수에 update 혼입').not.toContain('.update(');
    expect(block, 'nearest 조회 함수에 delete 혼입').not.toContain('.delete(');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 시나리오 4 — 차트 진입경로 보존(열린질문 2 대체 진입점) + 인접 무접촉
// ═══════════════════════════════════════════════════════════════════════════
test.describe('시나리오4: 차트 진입경로 보존 + 인접 무접촉', () => {
  test('S4-1: 차트 진입점 보존 — 예약관리 예약카드 이름 클릭 openChart(2번차트) 동선 불변', () => {
    // 클릭 목적지 변경(검색→뷰점프)으로도 차트 접근이 사라지지 않음: 예약카드/고객박스 openChart 잔존.
    expect(RESV_PAGE, '예약카드 openChart(차트 진입) 동선 소실').toContain('openChart');
    // AdminLayout 비예약관리 페이지 검색은 여전히 차트 오픈 경로 보유(S1-3과 상보).
    expect(LAYOUT, '전역 검색 차트 오픈(openChart) 경로 소실').toContain('openChart(c.id)');
  });

  test('S4-2: 인접 무접촉 — 기존 openReservationDetail/openReservationFor 수신부 회귀 없음', () => {
    expect(RESV_PAGE, '예약상세 라우팅 수신부(openReservationDetail) 회귀').toContain('openReservationDetail');
    expect(RESV_PAGE, '예약하기 바로가기 수신부(openReservationFor) 회귀').toContain('openReservationFor');
    expect(RESV_PAGE, '고객 prefill 수신부(prefillCustomerForSlot) 회귀').toContain('prefillCustomerForSlot');
  });
});
