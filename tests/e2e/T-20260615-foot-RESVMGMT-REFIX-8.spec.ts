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
 *   AC7-registrar — DB 자가검증 완료(evidence/T-...-REFIX8-AC7_registrar_null.md): write 경로 무결(NOT 회귀),
 *        createReservationCanonical 생성시점 registrar 미수집이 근본 — planner (a)/feature 분기 판단 대기.
 *
 * 추가 구현(FIX-REQUEST MSG-20260615-135808-4si3 — 현장 1회 수렴 AC2·AC4 확정):
 *   AC2 '예약상세 예약 등록자 표시' — 신규 담당자 드롭 신설 아님(현장 "예약 등록자 그대로 가져와").
 *        예약상세 FieldRow '예약등록자'가 본 예약(anchor) 상세에서도 항상 렌더(기존 id!==anchor 게이트 해제).
 *        데이터 소스 = AC7과 동일(registrar_name) → 미할당 예약은 '—' graceful(AC7 DB검증: write 무결·생성시 미수집).
 *   AC4 '일자×시간 매트릭스' (옵션2 확정) — 5FIX AC2(a921cef) 좌측 시간축 '날짜 합산'(time-axis-kind-count) supersede →
 *        각 (날짜×시간) 셀에 per-cell 건수 분포(cell-kind-count) 표기. 집계 시맨틱(resvKind·cancelled 제외) 동일, 차원만 per-day 분리.
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

// ═══════════════════════════════════════════════════════════════════════════
// AC3-b — (+) new-mode 팝업에서 '시스템에 없는 완전 신규 고객' 성함+연락처 직접 등록
//   FIX-REQUEST MSG-20260615-155004-k5le. 신규 컴포넌트/스키마 0, 기존 신규고객 생성 경로 재사용.
//   🔒 L-002: 팝업 내 customers/reservations.insert = 0 — 고객 INSERT 는 parent(onCreateReservation) 책임.
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC3-b: (+) 팝업 신규고객 직접 등록(성함+연락처)', () => {
  test('AC3b-1: 빈 상태에 직접 등록 진입 버튼(btn-newmode-manual-register) 노출', () => {
    expect(RESV_POPUP, '직접 등록 진입 버튼 누락')
      .toContain('data-testid="btn-newmode-manual-register"');
    // 진입 버튼이 setManualNew(true) 로 직접 등록 모드를 켬(attr 순서 무관 — 동일 button 블록 내)
    const btn = RESV_POPUP.match(/onClick=\{\(\) => \{ setManualNew\(true\); setSearchValue\(''\); \}\}[\s\S]{0,160}?btn-newmode-manual-register/);
    expect(btn, '직접 등록 토글(setManualNew(true)) 미배선').toBeTruthy();
  });

  test('AC3b-2: 직접 등록 폼에 성함·연락처 입력 필드 신설', () => {
    expect(RESV_POPUP, '성함 입력 필드 누락').toContain('data-testid="newmode-cust-name-input"');
    expect(RESV_POPUP, '연락처 입력 필드 누락').toContain('data-testid="newmode-cust-phone-input"');
  });

  test('AC3b-3: 연락처 입력은 기존 포맷터(formatPhoneInput) 적용 — 하이픈 표기', () => {
    expect(RESV_POPUP, 'formatPhoneInput import 누락').toMatch(/import \{[^}]*formatPhoneInput[^}]*\} from '@\/lib\/format'/);
    // 연락처 input(testid) 와 onChange 포맷터가 모두 존재(직접 등록 폼은 연락처 input 1개뿐 → 동일 input)
    expect(RESV_POPUP, '연락처 onChange 포맷터 미적용')
      .toContain('onChange={(e) => setNewCustPhone(formatPhoneInput(e.target.value))}');
  });

  test('AC3b-4: 성함/연락처 미입력 시 생성 버튼 disabled(빈 고객 INSERT 방지)', () => {
    // 생성 버튼(btn-newmode-create-entry) 존재 + disabled 가드에 직접 등록 성함/연락처 미입력 차단 포함
    expect(RESV_POPUP, 'create 버튼 testid 누락').toContain('data-testid="btn-newmode-create-entry"');
    const dis = RESV_POPUP.match(/disabled=\{\s*creatingResv \|\|\s*!pickedDate \|\|[\s\S]*?manualNew[\s\S]*?\}/);
    expect(dis, '직접 등록 disabled 가드 파싱 실패').toBeTruthy();
    expect(dis![0], '성함 미입력 가드 누락').toContain('!newCustName.trim()');
    expect(dis![0], '연락처 미입력 가드 누락').toContain('!newCustPhone.trim()');
  });

  test('AC3b-5: submitNewReservation이 직접 등록 시 customerId=null + 성함/연락처 위임', () => {
    const fn = RESV_POPUP.match(/async function submitNewReservation\(\)[\s\S]*?onChanged\(\);\s*\}/);
    expect(fn, 'submitNewReservation 파싱 실패').toBeTruthy();
    expect(fn![0], 'customerId null 위임(직접 등록) 누락')
      .toContain('customerId: loadedMatch ? loadedMatch.id : null');
    expect(fn![0], '직접 등록 성함/연락처 필수 가드 누락').toContain("'신규 고객 성함을 입력하세요.'");
    expect(fn![0], '직접 등록 연락처 필수 가드 누락').toContain("'신규 고객 연락처를 입력하세요.'");
  });

  test('AC3b-6: 🔒 L-002 — 팝업 내 customers/reservations INSERT 0(parent 위임)', () => {
    // 팝업은 onCreateReservation 콜백만 호출. 직접적인 .insert( customers/reservations ) 작성 금지.
    expect(RESV_POPUP, '팝업이 customers/reservations 직접 INSERT — L-002 위반')
      .not.toMatch(/\.from\('(customers|reservations)'\)\s*\.insert\(/);
  });

  test('AC3b-7: parent 콜백이 customerId null 수신 → phone resolve/신규 customers INSERT', () => {
    const fn = RESV_PAGE.match(/handleCreateReservationFromPopup = useCallback\([\s\S]*?\[clinic, changedBy, profile\?\.name\]/);
    expect(fn, 'handleCreateReservationFromPopup 파싱 실패').toBeTruthy();
    expect(fn![0], 'customerId null 수신 타입 미반영').toContain('customerId: string | null');
    expect(fn![0], 'E.164 정규화 누락').toContain('normalizeToE164(params.phone)');
    expect(fn![0], '신규 customers INSERT 경로 누락').toMatch(/\.from\('customers'\)\s*[\s\S]*?\.insert\(/);
    expect(fn![0], '중복 전화 23505 처리 누락').toContain("error.code === '23505'");
    expect(fn![0], '고객 정보 필수 가드 누락').toContain('고객 정보(성함·연락처)가 필요합니다.');
  });

  test('AC3b-8: 기존 고객 검색 선택 동선 불변(handleSelectOtherCustomer에서 직접 등록 모드 해제)', () => {
    const fn = RESV_POPUP.match(/function handleSelectOtherCustomer\(p: PatientMatch\)[\s\S]*?loadZone1Data\(p\.id\);\s*\}/);
    expect(fn, 'handleSelectOtherCustomer 파싱 실패').toBeTruthy();
    expect(fn![0], '검색 선택 시 직접 등록 모드 미해제(stale 입력 잔존)').toContain('setManualNew(false)');
    // 검색 선택은 여전히 loadedMatch set + zone1 로드(동선 불변)
    expect(fn![0], '검색 선택 동선 회귀(loadedMatch set 소실)').toContain('setLoadedMatch(p)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC2 — 예약상세에 '예약 등록자' 항상 표시 (현장 확정: 드롭 신설 X, 등록자 그대로)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC2: 예약상세 예약등록자 항상 렌더', () => {
  test('AC2-1: 예약등록자 FieldRow가 id!==anchor 게이트 밖으로 이동(항상 렌더)', () => {
    // 예약등록자 FieldRow 가 selectedResv.id !== reservation.id 조건 블록 안에 갇혀 있지 않아야 함.
    const gated = RESV_POPUP.match(/selectedResv\.id !== reservation\.id && \(\s*<FieldRow label="예약경로"[\s\S]*?\)\}/);
    expect(gated, 'id!==anchor 게이트 블록 파싱 실패').toBeTruthy();
    expect(gated![0], '예약등록자 FieldRow가 여전히 id!==anchor 게이트 안에 갇힘(anchor 상세 미표시)')
      .not.toContain('label="예약등록자"');
  });

  test('AC2-2: 예약등록자 FieldRow가 registrar_name(graceful — 미할당 시 —) 렌더', () => {
    expect(RESV_POPUP, '예약등록자 FieldRow 누락')
      .toContain('<FieldRow label="예약등록자" value={selectedResv.registrar_name ?? \'—\'} />');
  });

  test('AC2-3: 신규 담당자 드롭다운 신설 0 — 기존 registrar 소스 재사용(현장 의도)', () => {
    // AC2는 "예약 등록자 그대로 가져와" = 신규 staff 필터 드롭 신설 아님. registrar_name 소스 그대로.
    expect(RESV_POPUP, 'AC2 추적 주석 누락').toMatch(/REFIX-8 AC2[\s\S]{0,300}?예약 등록자 그대로/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC4 — 일자×시간 매트릭스: 좌측 시간축 날짜합산 supersede → per-cell 건수 분포
// ═══════════════════════════════════════════════════════════════════════════
test.describe('AC4: 일자×시간 per-cell 건수 매트릭스', () => {
  test('AC4-1: 좌측 시간축 날짜합산(time-axis-kind-count) 제거(5FIX AC2 supersede)', () => {
    expect(RESV_PAGE, 'time-axis-kind-count 잔존 — 날짜합산 supersede 미반영(매트릭스와 중복)')
      .not.toContain('time-axis-kind-count-${time}');
    // 시간축 셀 자체는 시간 라벨로 보존(회귀 가드)
    expect(RESV_PAGE, '시간축 셀(resv-time-col-cell) 소실(회귀)')
      .toContain('data-testid="resv-time-col-cell"');
  });

  test('AC4-2: 각 (날짜×시간) 셀에 per-cell 카운트(cell-kind-count) 신설', () => {
    expect(RESV_PAGE, 'per-cell 카운트 testid(cell-kind-count) 누락 — 매트릭스 미반영')
      .toContain('data-testid={`cell-kind-count-${dateStr}-${time}`}');
  });

  test('AC4-3: per-cell 집계 시맨틱 = resvByKey[key] 활성(취소 제외) 초/재/HL 분류', () => {
    // cell-kind-count 블록 추출 — 셀 단위(resvByKey[key]) 집계 확인.
    const m = RESV_PAGE.match(/cell-kind-count-\$\{dateStr\}-\$\{time\}[\s\S]*?\}\)\(\)\}/);
    // testid는 JSX attr 위치라 IIFE 본문은 그 위에 있음 → 직전 블록을 별도 추출.
    const block = RESV_PAGE.match(/AC4[\s\S]*?for \(const r of \(resvByKey\[key\] \?\? \[\]\)\)[\s\S]*?cell-kind-count-\$\{dateStr\}-\$\{time\}/);
    expect(block, 'per-cell 집계 블록(resvByKey[key] 순회) 파싱 실패').toBeTruthy();
    expect(block![0], '취소 제외 가드 누락').toContain("r.status === 'cancelled') continue");
    expect(block![0], '초진 분류 누락').toContain("kind === 'new') n += 1");
    expect(block![0], '재진 분류 누락').toContain("kind === 'returning') rr += 1");
    expect(block![0], '힐러 분류 누락').toContain("kind === 'healer') h += 1");
  });

  test('AC4-4: 전건 0 시 per-cell 칩 null 가드 + 초/재/HL 색상 코딩', () => {
    const block = RESV_PAGE.match(/AC4[\s\S]*?cell-kind-count[\s\S]*?HL \{h\}<\/span>/);
    expect(block, 'per-cell 칩 렌더 블록 파싱 실패').toBeTruthy();
    expect(block![0], '전건 0 null 가드 누락').toContain('if (n === 0 && rr === 0 && h === 0) return null');
    expect(block![0], '초진 emerald 칩 누락').toMatch(/n > 0 &&[\s\S]*?bg-emerald-100[\s\S]*?초 \{n\}/);
    expect(block![0], '재진 blue 칩 누락').toMatch(/rr > 0 &&[\s\S]*?bg-blue-100[\s\S]*?재 \{rr\}/);
    expect(block![0], 'HL yellow 칩 누락').toMatch(/h > 0 &&[\s\S]*?bg-yellow-100[\s\S]*?HL \{h\}/);
  });
});
