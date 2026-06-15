import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * T-20260615-foot-RESVMGMT-REFIX-8 — 풋 예약관리 레이아웃·동작 8건 리픽스
 * MQ: MSG-20260615-130038-dizc(NEW-TASK) + MSG-20260615-131441-ap23(INFO/CONSOLIDATION lf30).
 * reporter: 김주연 총괄(U0ATDB587PV). P1(AC2 배포-후-회귀 hotfix급).
 *
 * 본 spec 구현 범위 = AC1·AC5·AC6·AC7-color·AC8 (FE-only, DB 무변경, source-integrity gating).
 *   거대 인라인(Reservations.tsx) 관례 = 소스 정합 게이트. 실 렌더 검증은 supervisor field-soak(갤탭 실기기).
 *
 * 추가 구현(FIX-REQUEST MSG-20260615-134257-58f6 planner GO):
 *   AC3 '슬롯 (+) → 예약상세 팝업' — planner GO. openNewSlot = 구 ReservationEditor(setEditor) 스폰 폐기,
 *        ReservationDetailPopup new-mode 로 통일 + 클릭 슬롯 날짜/시간 prefill(initialDate/initialTime prop 신설).
 *        🔒L-002 준수(생성 capability 팝업 내 보존·단일소스 createReservationCanonical 위임, 진입 배선만 통일).
 *        🔒L-004 유지(new-mode 팝업 = 예약 생성 폼 affordance, 캔버스 연결 아님).
 *
 * 보류(현장 회신 대기, 본 커밋 미구현):
 *   AC2 '담당자 드롭' — 코드에 복구 대상 부재(ac105b6 diff 무변경). 현장 스샷 대기 → planner 별도 FIX-REQUEST.
 *   AC4 'per-day×per-time 최종형' — 5FIX AC2(a921cef) supersede. 최종 표시형 설계결정 → 현장 옵션 택1 대기.
 *   AC7-registrar — DB 자가검증 완료(evidence/T-...-REFIX8-AC7_registrar_null.md): write 경로 무결(NOT 회귀),
 *        createReservationCanonical 생성시점 registrar 미수집이 근본 — planner (a)/feature 분기 판단 대기.
 */

const RESV_PAGE = fs.readFileSync(path.resolve('src/pages/Reservations.tsx'), 'utf-8');
const HOVERCARD = fs.readFileSync(path.resolve('src/components/CustomerHoverCard.tsx'), 'utf-8');
const RESV_POPUP = fs.readFileSync(path.resolve('src/components/ReservationDetailPopup.tsx'), 'utf-8');

// ═══════════════════════════════════════════════════════════════════════════
// AC1 — 상단 컨트롤 재구성: 내예약 토글→이번주 옆 이동 + 새예약→경과분석→뷰토글 순
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC1: 상단 컨트롤 재배치', () => {
  test('AC1-1: 내예약 select(myresv-filter)가 "이번 주" 버튼 직후(좌측 기간 그룹)로 이동', () => {
    const idxThisWeek = RESV_PAGE.indexOf("viewMode === 'week' ? '이번 주' : '오늘'");
    const idxMyResv = RESV_PAGE.indexOf('data-testid="myresv-filter"');
    const idxProgressBtn = RESV_PAGE.indexOf('data-testid="progress-filter-btn"');
    expect(idxThisWeek, '"이번 주" 토글 텍스트 누락').toBeGreaterThan(-1);
    expect(idxMyResv, 'myresv-filter 누락').toBeGreaterThan(-1);
    // 내예약 select가 '이번 주' 직후, 그리고 경과분석 버튼보다 *앞*(좌측 그룹)에 위치
    expect(idxMyResv, '내예약 select가 "이번 주"보다 앞 — 이동 미반영').toBeGreaterThan(idxThisWeek);
    expect(idxMyResv, '내예약 select가 경과분석 버튼 뒤 — 우측 그룹 잔존(이동 미반영)').toBeLessThan(idxProgressBtn);
  });

  test('AC1-2: 우측 그룹 순서 = 새 예약 → 경과분석 (새예약이 경과분석보다 앞)', () => {
    const idxNew = RESV_PAGE.indexOf('새 예약');
    const idxProgressBtn = RESV_PAGE.indexOf('data-testid="progress-filter-btn"');
    expect(idxNew, '"새 예약" 버튼 누락').toBeGreaterThan(-1);
    expect(idxNew, '새 예약이 경과분석보다 뒤 — 순서 재배치 미반영').toBeLessThan(idxProgressBtn);
  });

  test('AC1-3: AC1 의도 주석으로 추적성 확보', () => {
    expect(RESV_PAGE).toMatch(/REFIX-8 AC1[\s\S]*?이번 주/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC5 — 일괄배치 기능 제거 (버튼 + batchCheckIn 핸들러 + dead-code)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC5: 일괄배치 제거', () => {
  test('AC5-1: batchCheckIn 핸들러 정의 제거', () => {
    expect(RESV_PAGE, 'batchCheckIn 핸들러 잔존').not.toContain('const batchCheckIn = async');
  });

  test('AC5-2: "일괄 배치" 버튼 렌더 제거', () => {
    expect(RESV_PAGE, '일괄 배치 버튼 라벨 잔존').not.toContain('일괄 배치 (');
    expect(RESV_PAGE, 'batchCheckIn 호출 잔존').not.toContain('batchCheckIn(confirmed)');
  });

  test('AC5-3: 제거 의도 주석 기록(잔존 RPC 무해 명시)', () => {
    expect(RESV_PAGE).toMatch(/REFIX-8 AC5[\s\S]*?일괄 배치[\s\S]*?제거/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC6 — 요일·일자 헤더 중앙정렬 + 폰트 확대
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC6: 헤더 중앙정렬·폰트 확대', () => {
  test('AC6-1: 날짜 헤더 th className = text-center + text-sm font-semibold', () => {
    // AC6 주석 직후 헤더 셀 base className 문자열(좌측정렬/소형 → 중앙/확대) 검증.
    const m = RESV_PAGE.match(/REFIX-8 AC6[^\n]*\n\s*'([^']*overflow-hidden[^']*)'/);
    expect(m, 'AC6 헤더 base className 문자열 파싱 실패').toBeTruthy();
    const head = m![1];
    expect(head, '헤더 중앙정렬(text-center) 누락').toContain('text-center');
    expect(head, '헤더 폰트 확대(text-sm) 누락').toContain('text-sm');
    expect(head, '헤더 굵기(font-semibold) 누락').toContain('font-semibold');
    expect(head, '구 좌측정렬(text-left) 잔존').not.toContain('text-left');
  });

  test('AC6-2: 헤더 하단 day-summary 칩도 중앙정렬(justify-center)', () => {
    const m = RESV_PAGE.match(/data-testid=\{`day-summary-[\s\S]{0,120}?className="([^"]+)"/);
    expect(m, 'day-summary className 파싱 실패').toBeTruthy();
    expect(m![1], 'day-summary 중앙정렬(justify-center) 누락').toContain('justify-center');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC7-color — 고객박스 성함 검정 통일
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC7: 성함 검정 통일', () => {
  test('AC7-1: 취소/미연결 plain span 성함 = text-gray-900', () => {
    const m = RESV_PAGE.match(/REFIX-8 AC7[\s\S]{0,120}?'font-semibold text-gray-900'/);
    expect(m, 'plain span 성함 검정(text-gray-900) 적용 누락').toBeTruthy();
  });

  test('AC7-2: CustomerHoverCard compact 트리거 성함 = text-gray-900 (활성카드 상태색 상속 차단)', () => {
    const m = HOVERCARD.match(/compact \? '([^']*text-gray-900[^']*)'/);
    expect(m, 'hovercard compact 성함 검정(text-gray-900) 적용 누락').toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC8 — 취소고객 클릭 시 별도창 차트 → 인앱 차트 패널 통일
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC8: 취소고객 인앱 차트 통일', () => {
  test('AC8-1: window.open( 차트 호출(별도창) 완전 제거 — 코드 호출 0', () => {
    // 취소 분기 span onClick이 window.open(`/chart/...`)로 별도창을 열던 코드 제거(주석 텍스트는 'window.open '로 paren 없음).
    expect(RESV_PAGE, 'window.open( 호출 잔존(별도창 차트 버그)').not.toContain('window.open(');
  });

  test('AC8-2: 취소 고객 클릭이 정상예약과 동일 인앱 차트(handleResvOpenChart)로 통일', () => {
    const m = RESV_PAGE.match(/REFIX-8 AC8[\s\S]{0,500}?handleResvOpenChart\(resvAsCheckIn\(r\)\)/);
    expect(m, 'AC8 인앱 차트(handleResvOpenChart) 동선 통일 미반영').toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC3 — 슬롯 (+) → 예약상세 팝업 new-mode 통일 + 슬롯 날짜/시간 prefill (planner GO)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC3: 슬롯(+) → 예약상세 팝업 new-mode 통일', () => {
  test('AC3-1: openNewSlot이 구 ReservationEditor(setEditor) 스폰 폐기 → new-mode 라우팅', () => {
    // openNewSlot 본문에서 setEditor 호출 제거, setNewReservationMode(true) + prefill 운반으로 전환.
    const m = RESV_PAGE.match(/const openNewSlot = \(d: Date, time: string\) => \{([\s\S]*?)\n  \};/);
    expect(m, 'openNewSlot 함수 본문 파싱 실패').toBeTruthy();
    const body = m![1];
    expect(body, 'openNewSlot이 여전히 setEditor(구 모달 스폰) 호출 — 배선 통일 미반영').not.toContain('setEditor(');
    expect(body, 'openNewSlot → new-mode 전환 누락').toContain('setNewReservationMode(true)');
    expect(body, '슬롯 날짜/시간 prefill 운반 누락').toContain('setNewReservationInitial({ date: format(d');
  });

  test('AC3-2: 팝업에 initialDate/initialTime prop 전달 + 상단 "새 예약"은 빈 진입(initial 클리어)', () => {
    expect(RESV_PAGE, 'ReservationDetailPopup initialDate prop 미전달').toMatch(/initialDate=\{newReservationInitial\?\.date \?\? null\}/);
    expect(RESV_PAGE, 'ReservationDetailPopup initialTime prop 미전달').toMatch(/initialTime=\{newReservationInitial\?\.time \?\? null\}/);
    // 상단 '새 예약' 버튼 = prefill 없는 빈 진입(initial 클리어)
    expect(RESV_PAGE, '상단 새 예약 빈 진입(initial null) 미반영').toContain('setNewReservationInitial(null); setNewReservationMode(true);');
  });

  test('AC3-3: 팝업 컴포넌트가 initialDate/initialTime prop 수신 + newMode reset에서 pickedDate prefill', () => {
    expect(RESV_POPUP, 'initialDate prop 선언 누락').toMatch(/initialDate\?: string \| null/);
    expect(RESV_POPUP, 'initialTime prop 선언 누락').toMatch(/initialTime\?: string \| null/);
    // newMode 진입 reset effect가 initialDate를 pickedDate로 prefill하고 deps에 포함
    const m = RESV_POPUP.match(/if \(newMode\) \{([\s\S]*?)\}\s*\}, \[newMode, initialDate, initialTime\]\);/);
    expect(m, 'newMode reset effect deps에 initialDate/initialTime 미포함').toBeTruthy();
    expect(m![1], 'initialDate → pickedDate prefill 누락').toContain('setPickedDate(new Date(y, m - 1, d))');
    expect(m![1], 'initialTime → newResvTime prefill 누락').toContain("setNewResvTime(initialTime || '10:00')");
  });

  test('AC3-4: prefill 시간이 클리닉 슬롯간격(비30분)일 때 select 옵션 합류 가드', () => {
    expect(RESV_POPUP, 'newResvTimeOptions 가드 누락').toContain('const newResvTimeOptions = NEW_RESV_TIME_SLOTS.includes(newResvTime)');
    expect(RESV_POPUP, 'time select가 가드된 옵션 미사용(NEW_RESV_TIME_SLOTS 직접 map 잔존)').not.toContain('NEW_RESV_TIME_SLOTS.map');
    expect(RESV_POPUP, 'newResvTimeOptions.map 미적용').toContain('newResvTimeOptions.map');
  });

  test('AC3-5: L-002/L-004 준수 추적 주석', () => {
    expect(RESV_PAGE).toMatch(/REFIX-8 AC3[\s\S]{0,400}?L-002/);
    expect(RESV_PAGE).toMatch(/REFIX-8 AC3[\s\S]{0,400}?L-004/);
  });
});
